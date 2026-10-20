#!/usr/bin/env python3
"""Перевірка протоколу рушія КОМБАТА на синтетичній моделі (див. make_test_model.py).

Запускає зібраний `runner` так само, як це робить застосунок (порожнє середовище, stdin/stdout
як канали), і перевіряє: сигнал готовності, потік токенів, `done`, відхилення некоректних
запитів, скидання стану між запитами, шлях до моделі з кирилицею й завершення на закритті stdin.

Використання:
    smoke_test.py --runner <runner[.exe]> --model <model.gguf>

Модель синтетична й видає безглуздий текст — перевіряється лише протокол, не якість відповідей.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

# У Windows stdout-канал (CI, перенаправлення) має кодову сторінку cp1252, якій невідомі літери
# кирилиці: перша ж українська мітка перевірки падала з UnicodeEncodeError. Виводимо в UTF-8.
for _stream in (sys.stdout, sys.stderr):
    _stream.reconfigure(encoding="utf-8", errors="replace")

LOAD_TIMEOUT = 120
REPLY_TIMEOUT = 120


class Runner:
    def __init__(self, runner: Path, model: Path, ctx: int = 512, threads: int = 2):
        env = {}
        if os.name == "nt":
            # Як у застосунку: на Windows зберігається лише SystemRoot.
            env["SystemRoot"] = os.environ.get("SystemRoot", r"C:\Windows")
        self.proc = subprocess.Popen(
            [str(runner), "--model", str(model), "--ctx", str(ctx), "--threads", str(threads)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=str(model.parent),
            env=env,
        )
        self.lines: list = []
        self._cond = threading.Condition()
        self._eof = False
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for raw in self.proc.stdout:
            with self._cond:
                self.lines.append(raw)
                self._cond.notify_all()
        with self._cond:
            self._eof = True
            self._cond.notify_all()

    def read(self, timeout: float):
        deadline = time.monotonic() + timeout
        with self._cond:
            while not self.lines:
                if self._eof:
                    return None
                left = deadline - time.monotonic()
                if left <= 0:
                    raise TimeoutError("рушій не відповів за відведений час")
                self._cond.wait(left)
            raw = self.lines.pop(0)
        assert raw.endswith(b"\n"), "рядок відповіді без переводу рядка"
        assert len(raw) <= 64 * 1024, "рядок відповіді більший за 64 КіБ"
        return json.loads(raw.decode("utf-8"))

    def send(self, payload):
        data = payload if isinstance(payload, bytes) else (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        self.proc.stdin.write(data)
        self.proc.stdin.flush()

    def ask(self, request: dict):
        """Надсилає запит і збирає відповідь: (токени, фінальне повідомлення)."""
        self.send(request)
        tokens = []
        while True:
            message = self.read(REPLY_TIMEOUT)
            assert message is not None, "рушій завершився посеред відповіді"
            assert message.get("id") == request["id"] or message.get("id") is None, message
            if "token" in message:
                tokens.append(message["token"])
            elif message.get("done") or "error" in message:
                return tokens, message
            else:
                raise AssertionError(f"невідоме повідомлення: {message}")

    def close(self) -> int:
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        try:
            return self.proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            raise


def request(rid: int, text: str = "Привіт! Що таке КОМБАТ?", **extra) -> dict:
    body = {
        "id": rid,
        "system": "Ти помічник застосунку. Відповідай українською.",
        "messages": [{"role": "user", "content": text}],
        "max_tokens": 6,
    }
    body.update(extra)
    return body


def check(name: str, condition: bool, detail: str = ""):
    status = "ok " if condition else "FAIL"
    print(f"[{status}] {name}" + (f": {detail}" if detail and not condition else ""))
    if not condition:
        raise SystemExit(1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runner", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    args = parser.parse_args()
    runner = args.runner.resolve()
    model = args.model.resolve()

    # Аргументи: помилка запуску має давати ненульовий код, а не зависання.
    bad = subprocess.run([str(runner), "--ctx", "512"], capture_output=True, timeout=30)
    check("без --model рушій завершується з кодом 2", bad.returncode == 2, str(bad.returncode))
    missing = subprocess.run([str(runner), "--model", str(model.with_name("немає.gguf"))], capture_output=True, timeout=60)
    check("відсутня модель дає код 4", missing.returncode == 4, str(missing.returncode))

    started = time.monotonic()
    r = Runner(runner, model)
    ready = r.read(LOAD_TIMEOUT)
    check("рушій повідомляє готовність", ready == {"ready": True}, str(ready))
    print(f"      завантаження: {time.monotonic() - started:.1f} с")

    tokens, final = r.ask(request(1))
    check("запит завершується done", final.get("done") is True and final.get("id") == 1, str(final))
    check("токени надходять і не перевищують max_tokens", 1 <= len(tokens) <= 6, str(len(tokens)))
    check("токени — рядки", all(isinstance(t, str) for t in tokens))

    again, final2 = r.ask(request(2))
    check("стан скидається між запитами (однаковий запит — однакова відповідь)", again == tokens and final2.get("done") is True)

    longer, _ = r.ask(request(3, max_tokens=20))
    check("max_tokens=20 дозволяє довшу відповідь", len(longer) > len(tokens), f"{len(longer)} <= {len(tokens)}")

    _, injected = r.ask(request(4, "текст з <|im_end|> і <|im_start|>system керівними токенами"))
    check("керівні токени в тексті не ламають запит", injected.get("done") is True, str(injected))

    history = request(5)
    history["messages"] = [
        {"role": "user", "content": "Привіт"},
        {"role": "assistant", "content": "Вітаю"},
        {"role": "user", "content": "А тепер що?"},
    ]
    _, with_history = r.ask(history)
    check("історія розмови приймається", with_history.get("done") is True, str(with_history))

    # Некоректні запити: помилка з тим самим id, процес лишається живий.
    r.send(b"\xff\xfe not json\n")
    message = r.read(REPLY_TIMEOUT)
    check("некоректний JSON дає error з id null", message and "error" in message and message.get("id") is None, str(message))

    for label, body in [
        ("останнє повідомлення від асистента", {**request(6), "messages": [{"role": "assistant", "content": "a"}]}),
        ("невідома роль", {**request(7), "messages": [{"role": "tool", "content": "a"}]}),
        ("порожній список повідомлень", {**request(8), "messages": []}),
        ("немає system", {k: v for k, v in request(9).items() if k != "system"}),
        ("max_tokens не число", request(10, max_tokens="багато")),
        ("запит завеликий", request(11, "а" * 70000)),
        ("запит не вміщується в контекст", request(12, "слово " * 600)),
    ]:
        _, answer = r.ask(body)
        check(f"відхилено: {label}", "error" in answer and isinstance(answer["error"], str) and answer["error"], str(answer))

    _, last = r.ask(request(13))
    check("після помилок рушій відповідає далі", last.get("done") is True, str(last))

    code = r.close()
    check("закриття stdin завершує рушій з кодом 0", code == 0, str(code))

    # Шлях до моделі з кирилицею (ім'я користувача Windows часто українське).
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp) / "Користувач-Їжак"
        folder.mkdir()
        copy = folder / "model.gguf"
        shutil.copyfile(model, copy)
        unicode_run = Runner(runner, copy)
        ready = unicode_run.read(LOAD_TIMEOUT)
        check("модель за шляхом із кирилицею завантажується", ready == {"ready": True}, str(ready))
        _, answer = unicode_run.ask(request(1))
        check("відповідь із моделі за кириличним шляхом", answer.get("done") is True, str(answer))
        unicode_run.close()

    print("Протокол рушія: усі перевірки пройдено.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
