#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="$ROOT_DIR/src-tauri/target/debug/bundle/macos/EasyWAR.app"
DMG_PATH="$ROOT_DIR/src-tauri/target/debug/bundle/dmg/EasyWAR_0.5.0_aarch64.dmg"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Перевірка macOS bundle доступна лише на macOS." >&2
  exit 1
fi

if [[ ! -d "$APP_PATH" || ! -f "$DMG_PATH" ]]; then
  echo "Не знайдено очікувані EasyWAR.app і DMG після збірки." >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=4 "$APP_PATH"
hdiutil verify "$DMG_PATH"
shasum -a 256 "$DMG_PATH"
