#!/usr/bin/env bash
# EasyDoc (прототип): збирає веб-версію WordCraft (WASM) з наших правок і кладе її в
# src/public/workspace/easydoc/, звідки Vite копіює її в збірку. Мережа потрібна лише під час збірки
# (залежності cargo); готовий редактор працює офлайн.
#
#   script/build_easydoc.sh <тека з розпакованим wordcraft-main>
#
# Потрібні: rustup-ціль wasm32-unknown-unknown і wasm-bindgen-cli тієї версії, що в Cargo.lock
# WordCraft (0.2.129). Чужий код не змінюється на місці: копіюється в тимчасову теку, туди
# накладається script/easydoc/wordcraft-web.patch.
set -euo pipefail

src="${1:?вкажіть теку з розпакованим wordcraft-main}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$repo/src/public/workspace/easydoc"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cp -R "$src" "$work/wordcraft"
patch -d "$work/wordcraft" -p1 < "$repo/script/easydoc/wordcraft-web.patch"
(cd "$work/wordcraft" && CARGO_TARGET_DIR="${EASYDOC_TARGET_DIR:-$work/target}" \
  cargo build --locked --release -p wordcraft-web --target wasm32-unknown-unknown)
wasm-bindgen --target web --no-typescript --remove-name-section --remove-producers-section --out-dir "$work/web" \
  "${EASYDOC_TARGET_DIR:-$work/target}/wasm32-unknown-unknown/release/wordcraft-web.wasm"
if command -v wasm-opt >/dev/null; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int \
    -o "$work/web/wordcraft-web_bg.wasm" "$work/web/wordcraft-web_bg.wasm"
fi
cp "$work/web/wordcraft-web.js" "$work/web/wordcraft-web_bg.wasm" "$out/"
echo "EasyDoc зібрано: $out"
