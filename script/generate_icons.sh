#!/usr/bin/env bash
# Регенерує всі іконки застосунку з векторних джерел у src-tauri/icons/source/.
# Потрібно: rsvg-convert (librsvg2-bin), png2icns (icnsutils), ImageMagick, npm-залежності проєкту.
#   icon-full.svg  — повний логотип (Windows, Linux, мобільні, плитки);
#   icon-mac.svg   — логотип у сітці Apple (тіло 824 px із тінню) для macOS;
#   icon-small.svg — лише тризуб для розмірів до 48 px, де напис нечитабельний.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src-tauri/icons/source"
OUT="$ROOT/src-tauri/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

render() { rsvg-convert -w "$2" -h "$2" "$SRC/$1.svg" -o "$TMP/$1-$2.png"; }
for s in 16 24 32 48 64; do render icon-small "$s"; done
for s in 64 128 256 512 1024; do render icon-full "$s"; done
for s in 128 256 512 1024; do render icon-mac "$s"; done

# Базовий набір Tauri (PNG, плитки Windows Store, Android, iOS) з повного логотипа.
(cd "$ROOT" && npx tauri icon "$TMP/icon-full-1024.png" -o "$OUT" >/dev/null)

# Дрібні розміри — тризуб без напису.
cp "$TMP/icon-small-32.png" "$OUT/32x32.png"
cp "$TMP/icon-small-64.png" "$OUT/64x64.png"

# Windows .ico: 16–48 без напису, 64–256 з написом.
convert "$TMP/icon-small-16.png" "$TMP/icon-small-24.png" "$TMP/icon-small-32.png" "$TMP/icon-small-48.png" \
  "$TMP/icon-full-64.png" "$TMP/icon-full-128.png" "$TMP/icon-full-256.png" "$OUT/icon.ico"

# macOS .icns: 16/32 без напису, решта — у сітці Apple.
png2icns "$OUT/icon.icns" "$TMP/icon-small-16.png" "$TMP/icon-small-32.png" "$TMP/icon-small-48.png" \
  "$TMP/icon-mac-128.png" "$TMP/icon-mac-256.png" "$TMP/icon-mac-512.png" "$TMP/icon-mac-1024.png" >/dev/null

cp "$SRC/icon-full.svg" "$OUT/app-icon.svg"
echo "Іконки оновлено в $OUT"
