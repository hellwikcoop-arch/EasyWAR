# EasyFLY для iPhone — оболонка Tauri 2

Тонка оболонка: Rust без команд, плагінів, SQLite й мережі. Увесь застосунок — вебзбірка
`dist-easyfly-phone/` (`npm run build:easyfly-phone`, сторінка `src/mobile/easyfly/index.html`,
спільне ядро `src/workspace/easyfly/`). Та сама збірка працює і як PWA в Safari без оболонки.

## Збірка (лише macOS з Xcode; у хмарній сесії не перевірено)

```bash
npm ci
cargo install tauri-cli --version "^2"      # або npx tauri
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
cd mobile/easyfly-ios
cargo tauri ios init                        # один раз: створює gen/apple (Xcode-проєкт)
cargo tauri ios dev                         # симулятор або під'єднаний iPhone
cargo tauri ios build                       # IPA для TestFlight (потрібен Apple Developer-акаунт)
```

`gen/apple/` після `ios init` комітиться (крім `build`, `Externals`, `xcuserdata`); у ньому
треба вказати Team у Xcode. Іконки поки взято з настільного EasyWAR (`src-tauri/icons`),
окремого значка EasyFLY ще немає.

## Межі

- Відкриття `.easyfly`: `<input type="file">` → системний вибір «Файли» (WKWebView підтримує).
- Копія у файл: Web Share API («Зберегти у Файли», AirDrop). Якщо WKWebView не покаже меню
  «Поділитися», потрібне нативне збереження (плагін `dialog`/`fs` або власна команда) — це
  нова можливість у `capabilities/default.json`, яку додаємо лише за рішенням власника.
- Дані профілю: IndexedDB у WKWebView, зашифровані PBKDF2 + AES-GCM парольною фразою
  (`src/mobile/easyfly/vault-core.js`). Резервна копія — файл `.easyfly`.
- CSP у `tauri.conf.json` суворий (`default-src 'self'`); `style-src 'unsafe-inline'` потрібен
  для атрибутів `style` у EasyFLY. Мережевих адрес немає.
