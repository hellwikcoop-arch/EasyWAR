#!/bin/bash
# Prepares a Claude Code on the web session so `npm run test:unit`, `npm run build`
# and the Rust checks work: npm packages, the Tauri Linux libraries and a warm
# Cargo build of the XLSX contract runner that tests/xlsx-legacy-contract.test.mjs
# starts with `cargo run`.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# The same system packages as the Linux `checks` job in .github/workflows/desktop-build.yml.
tauri_linux_deps=(libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev)
if ! dpkg -s "${tauri_linux_deps[@]}" >/dev/null 2>&1; then
  sudo=""
  [ "$(id -u)" -eq 0 ] || sudo="sudo"
  # Third-party PPAs in the base image may be blocked by the network policy;
  # the Ubuntu archive alone has everything these packages need.
  $sudo apt-get update -qq || true
  $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${tauri_linux_deps[@]}"
fi

# `npm install` rather than `npm ci`: it keeps node_modules from the cached container.
# `--no-save` leaves package-lock.json as committed (an older npm would rewrite it).
npm install --no-save --no-audit --no-fund

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi
if command -v cargo >/dev/null 2>&1; then
  cargo build --quiet --manifest-path src-tauri/Cargo.toml --example xlsx_contract_runner
else
  echo "session-start: cargo not found; the XLSX contract test will be skipped." >&2
fi
