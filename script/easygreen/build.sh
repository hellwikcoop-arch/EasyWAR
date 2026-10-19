#!/usr/bin/env bash
# Збирає таблицю EasyGreen (веб-версію GridCraft) у src/public/workspace/easygreen/app/.
# Використання: script/easygreen/build.sh <шлях до gridcraft-main.zip>
# Потрібні: Rust із ціллю wasm32-unknown-unknown, trunk 0.21, wasm-bindgen 0.2.129 і wasm-opt у PATH.
# Чужий код розпаковується в окрему тимчасову теку поза репозиторієм; збірка йде з --offline
# (trunk нічого не завантажує сам).
set -euo pipefail

zip="${1:?Вкажіть шлях до gridcraft-main.zip}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
patch_file="$repo/script/easygreen/gridcraft-easygreen.patch"
out="$repo/src/public/workspace/easygreen/app"

work="$(mktemp -d)"
trap 'rm -rf "${work:?}"' EXIT
unzip -q "$zip" -d "$work"
src="$work/gridcraft-main"
patch -d "$src" -p1 < "$patch_file"

(cd "$src/apps/gridcraft-web" && trunk build --release --offline)

mkdir -p "$out"
find "$out" -mindepth 1 -maxdepth 1 -type f -delete
cp "$src"/dist/web/* "$out"/
cp "$src/LICENSE-MIT" "$src/LICENSE-APACHE" "$src/NOTICE" "$out"/
echo "EasyGreen зібрано в $out"
