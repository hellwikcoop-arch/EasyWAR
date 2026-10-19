#!/usr/bin/env bash
# Тимчасова діагностика CI (не для main): запускає команду, зберігає її код виходу, а хвіст
# виводу дублює в анотації перевірки, бо журнали запусків недоступні з хмарної сесії.
#   script/ci_diag.sh <мітка> <команда> [аргументи…]
label="$1"; shift
log="$(mktemp)"
{
  echo "== env"; uname -a
  for p in python3 python py bash cmake; do printf '%s: ' "$p"; command -v "$p" || echo "-"; done
  python3 --version 2>&1 || true
  python --version 2>&1 || true
  echo "== cwd $(pwd)"
  echo "== $*"
  "$@"
  echo "exit=$?"
} >"$log" 2>&1
code="$(sed -n 's/^exit=//p' "$log" | tail -1)"
[ "${code:-1}" = 0 ] && exit 0
tail -c 9000 "$log" | tr -d '\r' | sed 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}' > "$log.enc"
n=0
total=$(wc -c < "$log.enc")
while [ "$((n * 3000))" -lt "$total" ]; do
  chunk="$(head -c "$(( (n + 1) * 3000 ))" "$log.enc" | tail -c 3000)"
  n=$((n + 1))
  echo "::error title=diag $label $n::${chunk}"
done
exit "${code:-1}"
