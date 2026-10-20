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
out="${EASYSLIDE_OUT:-$repo/src/public/workspace/easyslide}"

# egui з гачком перекладу (egui-l10n.patch): вихідний пакет egui 0.36.2 з кешу cargo, перевірений
# за контрольною сумою Cargo.lock DeckCraft (до патча lock посилається на crates.io).
if [ ! -d "$src/vendor/egui" ]; then
  (cd "$src" && cargo fetch --locked)
  crate="$(ls "${CARGO_HOME:-$HOME/.cargo}"/registry/cache/*/egui-0.36.2.crate | head -1)"
  mkdir -p "$src/vendor"
  tar -xzf "$crate" -C "$src/vendor"
  mv "$src/vendor/egui-0.36.2" "$src/vendor/egui"
  patch -d "$src/vendor/egui" -p0 --batch < "$repo/script/easyslide/egui-l10n.patch"
fi
patch -d "$src" -p0 --forward --batch < "$repo/script/easyslide/easyslide-web.patch" || true
grep -q easyslideHost "$src/apps/deckcraft-web/src/web.rs" || { echo "патч EasySlide не застосовано" >&2; exit 1; }
# Український інтерфейс: словник script/easyslide/uk.tsv → таблиці Rust.
node "$repo/script/easyslide/l10n.mjs" "$repo/script/easyslide/uk.tsv" "$src/apps/deckcraft-web/src/uk_table.rs"
(cd "$src" && CRAFT_FONTS_DIR="$fonts" CRAFT_FONTS_REQUIRED=1 \
  cargo build --locked --offline --release --target wasm32-unknown-unknown -p deckcraft-web)
wasm-bindgen --target web --weak-refs --no-typescript --out-dir "$out" \
  "${CARGO_TARGET_DIR:-$src/target}/wasm32-unknown-unknown/release/deckcraft-web.wasm"
sha256sum "$out"/deckcraft-web.js "$out"/deckcraft-web_bg.wasm
