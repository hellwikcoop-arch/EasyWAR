#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="$ROOT_DIR/src-tauri/target/debug/bundle/macos/EasyWAR.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Перевірка macOS bundle доступна лише на macOS." >&2
  exit 1
fi

# Ім'я DMG Tauri будує як <productName>_<версія>_<архітектура>.dmg; версію беремо з
# package.json (її тримає в узгодженому стані script/release_version.mjs), а не прошиваємо.
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT_DIR/package.json")"
if [[ -z "$VERSION" || "$VERSION" == "undefined" ]]; then
  echo "Не вдалося прочитати версію з package.json." >&2
  exit 1
fi
DMG_PATH="$ROOT_DIR/src-tauri/target/debug/bundle/dmg/EasyWAR_${VERSION}_aarch64.dmg"

if [[ ! -d "$APP_PATH" || ! -f "$DMG_PATH" ]]; then
  echo "Не знайдено очікувані EasyWAR.app і DMG ($DMG_PATH) після збірки." >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=4 "$APP_PATH"
hdiutil verify "$DMG_PATH"
shasum -a 256 "$DMG_PATH"
