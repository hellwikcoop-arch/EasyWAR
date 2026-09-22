#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="easywar"
BUNDLE_NAME="EasyWAR"
BUNDLE_ID="com.hellwikcoop.easywar"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -x "$BUNDLE_NAME" >/dev/null 2>&1 || true

if [[ ! -d node_modules ]]; then
  npm ci
fi

run_dev() {
  npm run tauri dev
}

case "$MODE" in
  run)
    run_dev
    ;;
  --debug|debug)
    RUST_BACKTRACE=full npm run tauri dev -- --verbose
    ;;
  --logs|logs)
    run_dev &
    DEV_PID=$!
    trap 'kill "$DEV_PID" >/dev/null 2>&1 || true' EXIT INT TERM
    /usr/bin/log stream --info --style compact \
      --predicate 'process == "easywar" OR process == "EasyWAR"'
    ;;
  --telemetry|telemetry)
    run_dev &
    DEV_PID=$!
    trap 'kill "$DEV_PID" >/dev/null 2>&1 || true' EXIT INT TERM
    /usr/bin/log stream --info --style compact \
      --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    npm run tauri build -- --debug --no-bundle
    APP_BINARY="$ROOT_DIR/src-tauri/target/debug/$APP_NAME"
    "$APP_BINARY" &
    APP_PID=$!
    trap 'kill "$APP_PID" >/dev/null 2>&1 || true' EXIT INT TERM
    for _ in {1..20}; do
      if pgrep -x "$APP_NAME" >/dev/null || pgrep -x "$BUNDLE_NAME" >/dev/null; then
        echo "EasyWAR запущено та перевірено."
        exit 0
      fi
      sleep 1
    done
    echo "EasyWAR зібрано, але процес не підтверджено." >&2
    exit 1
    ;;
  *)
    echo "Використання: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
