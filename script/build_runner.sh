#!/usr/bin/env bash
# Збирає рушій локальної моделі КОМБАТА (runner/, оболонка над llama.cpp) у файл, який Tauri
# пакує в інсталятор як sidecar: src-tauri/binaries/easywar-llm-runner-<triple>[.exe].
#
#   script/build_runner.sh [triple]
#
# triple за замовчуванням — хост (rustc -vV). Підтримані: x86_64-pc-windows-msvc,
# aarch64-apple-darwin, x86_64-apple-darwin, universal-apple-darwin, x86_64-unknown-linux-gnu.
# universal-apple-darwin кладе поруч і копії для кожної архітектури (їх вимагає Tauri).
# Потрібні cmake, git і компілятор C++17 (MSVC, Xcode або g++). Мережа потрібна лише для
# завантаження llama.cpp; для збірки без мережі задайте LLAMA_SRC=<локальна копія b11715>.
# RUNNER_JOBS — кількість паралельних завдань компілятора (за замовчуванням 3).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
triple="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
out_dir="$root/src-tauri/binaries"
mkdir -p "$out_dir"

cmake_args=(-DCMAKE_BUILD_TYPE=Release)
if [ -n "${LLAMA_SRC:-}" ]; then
  cmake_args+=("-DFETCHCONTENT_SOURCE_DIR_LLAMA=$LLAMA_SRC")
fi

# Збирає одну архітектуру в окрему папку й друкує шлях до готового файла.
build_one() {
  local name="$1"; shift
  local dir="$root/runner/build/$name"
  rm -rf "$dir"
  cmake -S "$root/runner" -B "$dir" "${cmake_args[@]}" "$@" >&2
  cmake --build "$dir" --config Release --target runner --parallel "${RUNNER_JOBS:-3}" >&2
  local found
  found="$(find "$dir" -maxdepth 2 \( -name runner -o -name runner.exe \) -type f | head -1)"
  [ -n "$found" ] || { echo "Не знайдено зібраний runner у $dir" >&2; exit 1; }
  echo "$found"
}

case "$triple" in
  *-pc-windows-msvc)
    arch=x64
    [ "${triple%%-*}" = aarch64 ] && arch=ARM64
    built="$(build_one "$triple" -A "$arch")"
    install -m 755 "$built" "$out_dir/easywar-llm-runner-$triple.exe"
    ;;
  aarch64-apple-darwin)
    built="$(build_one "$triple" -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0)"
    install -m 755 "$built" "$out_dir/easywar-llm-runner-$triple"
    ;;
  x86_64-apple-darwin)
    built="$(build_one "$triple" -DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_OSX_DEPLOYMENT_TARGET=10.15)"
    install -m 755 "$built" "$out_dir/easywar-llm-runner-$triple"
    ;;
  universal-apple-darwin)
    # ggml підбирає набір інструкцій за архітектурою, тому збираємо дві окремі копії й зшиваємо.
    arm="$(build_one aarch64-apple-darwin -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0)"
    intel="$(build_one x86_64-apple-darwin -DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_OSX_DEPLOYMENT_TARGET=10.15)"
    # `tauri build --target universal-apple-darwin` збирає кожну архітектуру окремо, і tauri-build
    # у build.rs вимагає sidecar саме для її triple; зшитий файл потрібен лише пакувальнику.
    install -m 755 "$arm" "$out_dir/easywar-llm-runner-aarch64-apple-darwin"
    install -m 755 "$intel" "$out_dir/easywar-llm-runner-x86_64-apple-darwin"
    lipo -create "$arm" "$intel" -output "$out_dir/easywar-llm-runner-$triple"
    chmod 755 "$out_dir/easywar-llm-runner-$triple"
    ;;
  *-linux-*)
    built="$(build_one "$triple")"
    install -m 755 "$built" "$out_dir/easywar-llm-runner-$triple"
    ;;
  *)
    echo "Непідтримувана платформа: $triple" >&2
    exit 2
    ;;
esac

if [ "$triple" = universal-apple-darwin ]; then
  ls -l "$out_dir"/easywar-llm-runner-{aarch64,x86_64,universal}-apple-darwin
else
  ls -l "$out_dir"/easywar-llm-runner-"$triple"*
fi
