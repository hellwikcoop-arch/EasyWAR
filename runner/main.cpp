// Рушій локальної мовної моделі КОМБАТА для EasyWAR.
//
// Тонка оболонка над llama.cpp (MIT). Застосунок запускає її як дочірній процес без мережі
// і говорить JSON-рядками через stdin/stdout. Протокол описано в docs/ASSISTANT.md та
// реалізовано з боку застосунку в src-tauri/src/local_model.rs; цей файл мусить йому відповідати.
//
//   аргументи:  --model <шлях> --ctx <токенів> --threads <потоків> [--verbose]
//   готовність: {"ready":true}
//   запит:      {"id":N,"system":"…","messages":[{"role":"user|assistant","content":"…"}],"max_tokens":N}
//   відповідь:  {"id":N,"token":"…"} … {"id":N,"done":true}   або   {"id":N,"error":"…"}
//
// Один запит за раз. Закриття stdin завершує процес. Мережі, файлів поза моделлю та змінних
// середовища рушій не використовує.

#include "llama.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#if defined(_WIN32)
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <fcntl.h>
#  include <io.h>
#  include <windows.h>
#endif

#if defined(_MSC_VER) && (defined(_M_X64) || defined(_M_AMD64))
#  include <immintrin.h>
#  include <intrin.h>
#endif

using json = nlohmann::json;

namespace {

constexpr size_t kMaxRequestBytes = 256 * 1024;  // більший рядок відкидаємо
constexpr size_t kMaxPromptChars = 64 * 1024;    // запас над лімітами застосунку (≈6500 символів)
constexpr int kMaxNewTokens = 256;               // ліміт протоколу
constexpr int kMaxMessages = 16;
constexpr size_t kMaxErrorChars = 300;

struct Options {
    std::string model;
    int ctx = 2048;
    int threads = 2;
    bool verbose = false;
};

// ---------------------------------------------------------------- допоміжне

bool cpu_supported() {
#if defined(__x86_64__) || defined(_M_X64) || defined(_M_AMD64)
    // Збірка ggml без -march=native вимагає AVX2, FMA, F16C і BMI2 (ЦП Intel Haswell / AMD Excavator і новіші).
#  if defined(_MSC_VER)
    int r[4];
    __cpuid(r, 0);
    if (r[0] < 7) return false;
    __cpuid(r, 1);
    const bool osxsave = (r[2] & (1 << 27)) != 0;
    const bool avx = (r[2] & (1 << 28)) != 0;
    const bool fma = (r[2] & (1 << 12)) != 0;
    const bool f16c = (r[2] & (1 << 29)) != 0;
    if (!(osxsave && avx && fma && f16c)) return false;
    if ((_xgetbv(0) & 6) != 6) return false;  // ОС зберігає стан YMM
    __cpuidex(r, 7, 0);
    const bool avx2 = (r[1] & (1 << 5)) != 0;
    const bool bmi2 = (r[1] & (1 << 8)) != 0;
    return avx2 && bmi2;
#  else
    __builtin_cpu_init();
    return __builtin_cpu_supports("avx2") && __builtin_cpu_supports("fma") &&
           __builtin_cpu_supports("f16c") && __builtin_cpu_supports("bmi2");
#  endif
#else
    return true;
#endif
}

void set_binary_stdio() {
#if defined(_WIN32)
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
}

void write_line(const json& value) {
    // replace: некоректний UTF-8 (обірваний токен) не повинен ламати рядок.
    std::string text = value.dump(-1, ' ', false, json::error_handler_t::replace);
    text.push_back('\n');
    std::fwrite(text.data(), 1, text.size(), stdout);
    std::fflush(stdout);
}

std::string clip(std::string text) {
    if (text.size() > kMaxErrorChars) {
        text.resize(kMaxErrorChars);
    }
    return text;
}

void write_error(const json& id, const std::string& message) {
    write_line(json{{"id", id}, {"error", clip(message)}});
}

// Читає один рядок із stdin. Повертає false на кінці потоку. Надто довгий рядок дочитується
// й відкидається (too_long = true), щоб не розростатися в пам'яті.
bool read_line(std::string& line, bool& too_long) {
    line.clear();
    too_long = false;
    int c;
    bool any = false;
    while ((c = std::getchar()) != EOF) {
        any = true;
        if (c == '\n') break;
        if (line.size() < kMaxRequestBytes) {
            line.push_back(static_cast<char>(c));
        } else {
            too_long = true;
        }
    }
    if (!any) return false;
    if (!line.empty() && line.back() == '\r') line.pop_back();
    return true;
}

// Довжина префікса, який не закінчується обірваною багатобайтовою послідовністю UTF-8.
size_t utf8_complete_prefix(const std::string& s) {
    const size_t n = s.size();
    for (size_t back = 1; back <= 3 && back <= n; ++back) {
        const unsigned char c = static_cast<unsigned char>(s[n - back]);
        if ((c & 0xC0) == 0x80) continue;  // байт-продовження: шукаємо початок далі
        size_t need = 1;
        if ((c & 0xE0) == 0xC0) need = 2;
        else if ((c & 0xF0) == 0xE0) need = 3;
        else if ((c & 0xF8) == 0xF0) need = 4;
        return need > back ? n - back : n;
    }
    return n;
}

// Керівні токени ChatML у тексті запиту не повинні стати справжніми керівними токенами.
std::string neutralize_special(std::string text) {
    std::string out;
    out.reserve(text.size());
    for (size_t i = 0; i < text.size(); ++i) {
        out.push_back(text[i]);
        if (text[i] == '<' && i + 1 < text.size() && text[i + 1] == '|') {
            out.push_back(' ');
        }
    }
    return out;
}

void silent_log(enum ggml_log_level, const char*, void*) {}

// ---------------------------------------------------------------- рушій

class Engine {
public:
    ~Engine() {
        if (sampler_) llama_sampler_free(sampler_);
        if (ctx_) llama_free(ctx_);
        if (model_) llama_model_free(model_);
        if (backend_) llama_backend_free();
    }

    bool load(const Options& options, std::string& error) {
        llama_backend_init();
        backend_ = true;

        llama_model_params mp = llama_model_default_params();
        mp.n_gpu_layers = 0;
        mp.load_mode = LLAMA_LOAD_MODE_MMAP;
        model_ = llama_model_load_from_file(options.model.c_str(), mp);
        if (!model_) {
            error = "не вдалося завантажити модель";
            return false;
        }
        vocab_ = llama_model_get_vocab(model_);

        int n_ctx = options.ctx;
        const int train = llama_model_n_ctx_train(model_);
        if (train > 0) n_ctx = std::min(n_ctx, train);
        n_ctx_ = n_ctx;

        llama_context_params cp = llama_context_default_params();
        cp.n_ctx = static_cast<uint32_t>(n_ctx);
        cp.n_batch = static_cast<uint32_t>(std::min(n_ctx, 512));
        cp.n_ubatch = cp.n_batch;
        cp.n_seq_max = 1;
        cp.n_threads = options.threads;
        cp.n_threads_batch = options.threads;
        cp.no_perf = true;
        n_batch_ = static_cast<int>(cp.n_batch);
        ctx_ = llama_init_from_model(model_, cp);
        if (!ctx_) {
            error = "не вдалося створити контекст моделі";
            return false;
        }

        // Помірна температура з обмеженням повторів: малі моделі на жадібному відборі зациклюються.
        llama_sampler_chain_params sp = llama_sampler_chain_default_params();
        sp.no_perf = true;
        sampler_ = llama_sampler_chain_init(sp);
        llama_sampler_chain_add(sampler_, llama_sampler_init_penalties(llama_vocab_n_tokens(vocab_), 64, 1.1f, 0.0f, 0.0f));
        llama_sampler_chain_add(sampler_, llama_sampler_init_top_k(40));
        llama_sampler_chain_add(sampler_, llama_sampler_init_top_p(0.9f, 1));
        llama_sampler_chain_add(sampler_, llama_sampler_init_temp(0.3f));
        llama_sampler_chain_add(sampler_, llama_sampler_init_dist(1234));

        // Qwen3 за замовчуванням «думає» вголос; порожній блок <think> вимикає це, як у його шаблоні.
        const char* tmpl = llama_model_chat_template(model_, nullptr);
        empty_think_ = tmpl != nullptr && std::strstr(tmpl, "<think>") != nullptr;

        return warm_up(error);
    }

    // Виконує один запит. Токени одразу йдуть у stdout. Повертає false, якщо запит завершився помилкою
    // (повідомлення вже надіслано).
    bool run(const json& request) {
        const json id = request.contains("id") ? request["id"] : json(nullptr);
        std::string error;
        std::vector<llama_token> prompt;
        int max_new = 0;
        if (!prepare(request, prompt, max_new, error)) {
            write_error(id, error);
            return false;
        }
        if (!generate(id, prompt, max_new, error)) {
            write_error(id, error);
            return false;
        }
        write_line(json{{"id", id}, {"done", true}});
        return true;
    }

private:
    bool warm_up(std::string& error) {
        // Один прохід через вагові таблиці піднімає mmap-сторінки в пам'ять до сигналу «готово»,
        // тож перший справжній запит не платить за читання файлу з диска.
        std::vector<llama_token> tokens;
        if (!tokenize("Привіт", tokens, true) || tokens.empty()) {
            error = "не вдалося підготувати модель до роботи";
            return false;
        }
        if (llama_decode(ctx_, llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()))) != 0) {
            error = "не вдалося прогріти модель";
            return false;
        }
        reset_context();
        return true;
    }

    void reset_context() {
        llama_memory_clear(llama_get_memory(ctx_), true);
        llama_sampler_reset(sampler_);
    }

    bool tokenize(const std::string& text, std::vector<llama_token>& out, bool add_special) {
        int n = llama_tokenize(vocab_, text.c_str(), static_cast<int32_t>(text.size()), nullptr, 0, add_special, true);
        if (n == INT32_MIN) return false;
        n = -n;
        if (n <= 0) return false;
        out.assign(static_cast<size_t>(n), 0);
        const int got = llama_tokenize(vocab_, text.c_str(), static_cast<int32_t>(text.size()), out.data(),
                                       static_cast<int32_t>(out.size()), add_special, true);
        if (got < 0) return false;
        out.resize(static_cast<size_t>(got));
        return true;
    }

    bool prepare(const json& request, std::vector<llama_token>& prompt, int& max_new, std::string& error) {
        if (!request.is_object() || !request.contains("id") || !request["id"].is_number_unsigned()) {
            error = "запит без числового id";
            return false;
        }
        if (!request.contains("system") || !request["system"].is_string()) {
            error = "немає системної інструкції";
            return false;
        }
        if (!request.contains("messages") || !request["messages"].is_array() || request["messages"].empty() ||
            request["messages"].size() > static_cast<size_t>(kMaxMessages)) {
            error = "некоректний список повідомлень";
            return false;
        }
        int requested = kMaxNewTokens;
        if (request.contains("max_tokens")) {
            if (!request["max_tokens"].is_number_integer()) {
                error = "некоректний max_tokens";
                return false;
            }
            requested = static_cast<int>(
                std::clamp<long long>(request["max_tokens"].get<long long>(), 1, kMaxNewTokens));
        }

        std::vector<std::string> roles;
        std::vector<std::string> contents;
        size_t total = 0;
        roles.push_back("system");
        contents.push_back(neutralize_special(request["system"].get<std::string>()));
        total += contents.back().size();
        for (const auto& message : request["messages"]) {
            if (!message.is_object() || !message.contains("role") || !message["role"].is_string() ||
                !message.contains("content") || !message["content"].is_string()) {
                error = "некоректне повідомлення";
                return false;
            }
            const std::string role = message["role"].get<std::string>();
            if (role != "user" && role != "assistant") {
                error = "невідома роль повідомлення";
                return false;
            }
            roles.push_back(role);
            contents.push_back(neutralize_special(message["content"].get<std::string>()));
            total += contents.back().size();
        }
        if (roles.back() != "user") {
            error = "останнє повідомлення має бути від користувача";
            return false;
        }
        if (total > kMaxPromptChars) {
            error = "запит завеликий";
            return false;
        }

        std::vector<llama_chat_message> chat;
        chat.reserve(roles.size());
        for (size_t i = 0; i < roles.size(); ++i) {
            chat.push_back({roles[i].c_str(), contents[i].c_str()});
        }
        std::vector<char> buffer(total * 2 + 1024);
        int len = llama_chat_apply_template("chatml", chat.data(), chat.size(), true, buffer.data(),
                                            static_cast<int32_t>(buffer.size()));
        if (len > static_cast<int>(buffer.size())) {
            buffer.resize(static_cast<size_t>(len));
            len = llama_chat_apply_template("chatml", chat.data(), chat.size(), true, buffer.data(),
                                            static_cast<int32_t>(buffer.size()));
        }
        if (len < 0) {
            error = "не вдалося застосувати шаблон розмови";
            return false;
        }
        std::string text(buffer.data(), static_cast<size_t>(len));
        if (empty_think_) text += "<think>\n\n</think>\n\n";

        if (!tokenize(text, prompt, true)) {
            error = "не вдалося розбити запит на токени";
            return false;
        }
        // Місце для відповіді: хоча б один токен і запас.
        const int room = n_ctx_ - static_cast<int>(prompt.size()) - 1;
        if (room < 1) {
            error = "запит не вміщується в контекст моделі";
            return false;
        }
        max_new = std::min(requested, room);
        return true;
    }

    bool generate(const json& id, const std::vector<llama_token>& prompt, int max_new, std::string& error) {
        reset_context();

        // Запит обробляється шматками не більше n_batch.
        for (size_t start = 0; start < prompt.size(); start += static_cast<size_t>(n_batch_)) {
            const int n = static_cast<int>(std::min<size_t>(static_cast<size_t>(n_batch_), prompt.size() - start));
            if (llama_decode(ctx_, llama_batch_get_one(const_cast<llama_token*>(prompt.data() + start), n)) != 0) {
                error = "модель не змогла обробити запит";
                return false;
            }
        }

        std::string pending;
        char piece[256];
        for (int produced = 0; produced < max_new; ++produced) {
            llama_token token = llama_sampler_sample(sampler_, ctx_, -1);
            if (llama_vocab_is_eog(vocab_, token)) break;

            int n = llama_token_to_piece(vocab_, token, piece, sizeof(piece), 0, false);
            std::string text;
            if (n >= 0) {
                text.assign(piece, static_cast<size_t>(n));
            } else {
                std::vector<char> big(static_cast<size_t>(-n));
                const int m = llama_token_to_piece(vocab_, token, big.data(), static_cast<int32_t>(big.size()), 0, false);
                if (m > 0) text.assign(big.data(), static_cast<size_t>(m));
            }
            pending += text;
            const size_t ready = utf8_complete_prefix(pending);
            if (ready > 0) {
                write_line(json{{"id", id}, {"token", pending.substr(0, ready)}});
                pending.erase(0, ready);
            }

            if (llama_decode(ctx_, llama_batch_get_one(&token, 1)) != 0) {
                error = "модель перервала відповідь";
                return false;
            }
        }
        if (!pending.empty()) {
            write_line(json{{"id", id}, {"token", pending}});
        }
        return true;
    }

    llama_model* model_ = nullptr;
    llama_context* ctx_ = nullptr;
    llama_sampler* sampler_ = nullptr;
    const llama_vocab* vocab_ = nullptr;
    int n_ctx_ = 0;
    int n_batch_ = 0;
    bool empty_think_ = false;
    bool backend_ = false;
};

bool parse_args(const std::vector<std::string>& args, Options& options, std::string& error) {
    for (size_t i = 1; i < args.size(); ++i) {
        const std::string& arg = args[i];
        auto value = [&](std::string& out) {
            if (i + 1 >= args.size()) return false;
            out = args[++i];
            return true;
        };
        std::string text;
        if (arg == "--model") {
            if (!value(options.model)) { error = "--model без значення"; return false; }
        } else if (arg == "--ctx") {
            if (!value(text)) { error = "--ctx без значення"; return false; }
            options.ctx = std::atoi(text.c_str());
        } else if (arg == "--threads") {
            if (!value(text)) { error = "--threads без значення"; return false; }
            options.threads = std::atoi(text.c_str());
        } else if (arg == "--verbose") {
            options.verbose = true;
        } else {
            error = "невідомий аргумент: " + arg;
            return false;
        }
    }
    if (options.model.empty()) { error = "не вказано --model"; return false; }
    if (options.ctx < 256 || options.ctx > 8192) { error = "--ctx поза межами 256..8192"; return false; }
    if (options.threads < 1) { error = "--threads має бути додатним"; return false; }
    options.threads = std::min(options.threads, 16);
    return true;
}

int run_main(const std::vector<std::string>& args) {
    set_binary_stdio();

    Options options;
    std::string error;
    if (!parse_args(args, options, error)) {
        std::fprintf(stderr, "runner: %s\n", error.c_str());
        return 2;
    }
    if (!cpu_supported()) {
        std::fprintf(stderr, "runner: ЦП не підтримує AVX2/FMA/F16C/BMI2\n");
        return 3;
    }
    if (!options.verbose) {
        llama_log_set(silent_log, nullptr);
    }

    Engine engine;
    if (!engine.load(options, error)) {
        std::fprintf(stderr, "runner: %s\n", error.c_str());
        return 4;
    }
    write_line(json{{"ready", true}});

    std::string line;
    bool too_long = false;
    while (read_line(line, too_long)) {
        if (line.empty() && !too_long) continue;
        if (too_long) {
            write_error(json(nullptr), "запит завеликий");
            continue;
        }
        json request = json::parse(line, nullptr, false);
        if (request.is_discarded()) {
            write_error(json(nullptr), "некоректний JSON");
            continue;
        }
        try {
            engine.run(request);
        } catch (const std::exception& e) {
            const json id = request.is_object() && request.contains("id") ? request["id"] : json(nullptr);
            write_error(id, std::string("внутрішня помилка: ") + e.what());
        }
    }
    return 0;
}

}  // namespace

#if defined(_WIN32)
namespace {
std::string wide_to_utf8(const wchar_t* wide) {
    const int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) return std::string();
    std::string out(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide, -1, out.data(), size, nullptr, nullptr);
    out.resize(static_cast<size_t>(size - 1));
    return out;
}
}  // namespace

// Шлях до моделі на Windows може містити кирилицю (ім'я користувача), тому беремо аргументи в UTF-16.
int wmain(int argc, wchar_t** argv) {
    std::vector<std::string> args;
    for (int i = 0; i < argc; ++i) args.push_back(wide_to_utf8(argv[i]));
    return run_main(args);
}
#else
int main(int argc, char** argv) {
    std::vector<std::string> args(argv, argv + argc);
    return run_main(args);
}
#endif
