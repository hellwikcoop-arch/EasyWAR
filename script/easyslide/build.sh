#!/usr/bin/env bash
# Збирає редактор EasySlide (веб-збірка DeckCraft) у src/public/workspace/easyslide/.
# Прототип. Чужий код збирається лише в окремій теці поза репозиторієм; під час роботи
# застосунку нічого не завантажується з мережі.
#
#   script/easyslide/build.sh <тека з кодом deckcraft-main> <тека craft-fonts>
#
# Потрібні: Rust ≥ 1.95 з ціллю wasm32-unknown-unknown, wasm-bindgen-cli тієї ж версії, що
# в Cargo.lock DeckCraft (0.2.129). craft-fonts — git-ревізія 43913056ce82a3fdad0ef69f6b88d1dc922a8104
# (Inter і BIZ UDPGothic, OFL-1.1; та сама, що в CI DeckCraft).
set -euo pipefail
src="$(cd "$1" && pwd)"
fonts="$(cd "$2" && pwd)"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="$repo/src/public/workspace/easyslide"

patch -d "$src" -p0 --forward --batch < "$repo/script/easyslide/easyslide-web.patch" || true
grep -q easyslideHost "$src/apps/deckcraft-web/src/web.rs" || { echo "патч EasySlide не застосовано" >&2; exit 1; }
(cd "$src" && CRAFT_FONTS_DIR="$fonts" CRAFT_FONTS_REQUIRED=1 \
  cargo build --locked --release --target wasm32-unknown-unknown -p deckcraft-web)
wasm-bindgen --target web --weak-refs --no-typescript --out-dir "$out" \
  "$src/target/wasm32-unknown-unknown/release/deckcraft-web.wasm"
sha256sum "$out"/deckcraft-web.js "$out"/deckcraft-web_bg.wasm
