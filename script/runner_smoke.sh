#!/usr/bin/env bash
# Перевіряє протокол зібраного рушія на синтетичній моделі (runner/smoke_test.py).
#
#   script/runner_smoke.sh <runner> [каталог llama.cpp]
#
# Каталог llama.cpp за замовчуванням — той, що завантажила збірка (runner/build/*/_deps/llama-src).
# Потрібні python3 і доступ до pip (numpy, pyyaml, tqdm, requests — залежності gguf-py).
set -euo pipefail

# У Git Bash на Windows шляхи вигляду /d/a/... Python не розуміє: переводимо їх у рідний формат.
native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi
}

root="$(cd "$(dirname "$0")/.." && pwd)"
runner="$(cd "$(dirname "${1:?вкажіть шлях до runner}")" && pwd)/$(basename "$1")"
llama="${2:-$(ls -d "$root"/runner/build/*/_deps/llama-src 2>/dev/null | head -1)}"
[ -d "$llama/gguf-py" ] || { echo "Не знайдено gguf-py у '$llama'" >&2; exit 1; }

sys_python="$(command -v python3 || command -v python || true)"
[ -n "$sys_python" ] || { echo "Потрібен python3" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
"$sys_python" -m venv "$work/venv"
if [ -x "$work/venv/bin/python" ]; then py="$work/venv/bin/python"; else py="$work/venv/Scripts/python.exe"; fi
"$py" -m pip install --quiet numpy pyyaml tqdm requests

"$py" -I "$(native "$root/runner/make_test_model.py")" --llama-src "$(native "$llama")" --out "$(native "$work/model.gguf")"
"$py" -I "$(native "$root/runner/smoke_test.py")" --runner "$(native "$runner")" --model "$(native "$work/model.gguf")"
