#!/usr/bin/env bash
# Справжня десктопна оболонка EasyWAR (Tauri + WebKitGTK) під Xvfb, керування через xdotool.
# У WebKitGTK немає CDP, тож тут лише екранні координати, клавіатура й знімки екрана.
#
#   .claude/skills/run-easywar/desktop.sh start          # Xvfb :99 + target/debug/easywar, чекає вікно
#   .claude/skills/run-easywar/desktop.sh click X Y      # клік у координатах екрана 1440x900
#   .claude/skills/run-easywar/desktop.sh scroll X Y N   # N кроків колеса вниз над X,Y (N<0 — вгору)
#   .claude/skills/run-easywar/desktop.sh key ctrl+l     # клавіша (синтаксис xdotool)
#   .claude/skills/run-easywar/desktop.sh type 'текст'   # набрати текст
#   .claude/skills/run-easywar/desktop.sh open-file PATH # у відкритому GTK-діалозі: Ctrl+L, шлях, Enter
#   .claude/skills/run-easywar/desktop.sh ss NAME        # знімок усього екрана -> $SHOTS/NAME.png
#   .claude/skills/run-easywar/desktop.sh stop
set -euo pipefail
cd "$(dirname "$0")/../../.."
export DISPLAY="${EASYWAR_DISPLAY:-:99}"
SHOTS="${EASYWAR_SHOTS:-/tmp/easywar-shots}"
BIN=src-tauri/target/debug/easywar
RUN=/tmp/easywar-desktop
mkdir -p "$SHOTS" "$RUN"

case "${1:-}" in
  start)
    [ -x "$BIN" ] || { echo "немає $BIN — спершу: npm run tauri build -- --debug --no-bundle" >&2; exit 1; }
    Xvfb "$DISPLAY" -screen 0 1440x900x24 >"$RUN/xvfb.log" 2>&1 &
    echo $! >"$RUN/xvfb.pid"
    for _ in $(seq 1 20); do xdotool getdisplaygeometry >/dev/null 2>&1 && break; sleep .25; done
    # Окремі XDG-теки: щоразу чистий стан (easywar.db, localStorage WebKit), реальні дані
    # користувача в ~/.config/com.hellwikcoop.easywar не зачіпаються.
    rm -rf "$RUN/home"; mkdir -p "$RUN/home/config" "$RUN/home/data" "$RUN/home/cache"
    XDG_CONFIG_HOME="$RUN/home/config" XDG_DATA_HOME="$RUN/home/data" XDG_CACHE_HOME="$RUN/home/cache" \
      "$BIN" >"$RUN/app.log" 2>&1 &
    echo $! >"$RUN/app.pid"
    win=""
    for _ in $(seq 1 60); do
      win=$(xdotool search --name '^EasyWAR$' 2>/dev/null | head -1 || true)
      [ -n "$win" ] && break
      sleep .5
    done
    [ -n "$win" ] || { echo "вікно EasyWAR не з'явилося; див. $RUN/app.log" >&2; exit 1; }
    # Вікно з'являється білим; WebKit малює лаунчер ще 5–10 с (з холодним кешем). Порожній екран
    # (чорний корінь Xvfb чи біле вікно) — однотонний, лаунчер — ні: чекаємо на контраст.
    for i in $(seq 1 60); do
      sd=$(import -window root png:- | convert - -colorspace gray -format '%[fx:standard_deviation]' info:)
      awk "BEGIN{exit !($sd > .03)}" && { sleep 1; echo "ready: window $win painted after ${i}x0.5s, log $RUN/app.log"; exit 0; }
      sleep .5
    done
    echo "вікно $win так і не намалювалося; див. $RUN/app.log" >&2; exit 1 ;;
  click) xdotool mousemove "$2" "$3" click 1; sleep .6; echo "clicked $2,$3" ;;
  scroll) # scroll X Y N — N кроків колеса вниз (від'ємне N — вгору) над точкою X,Y
    b=5; n="${4:-5}"; [ "$n" -lt 0 ] && { b=4; n=$((-n)); }
    xdotool mousemove "$2" "$3" click --repeat "$n" --delay 60 "$b"; sleep .8; echo "scrolled $4 at $2,$3" ;;
  key) xdotool key "$2"; sleep .4; echo "key $2" ;;
  type) xdotool type --delay 20 -- "$2"; echo "typed" ;;
  open-file)
    # GTK-діалог відкривається вікном «Select File»; без нього Ctrl+L і шлях підуть у сам застосунок.
    dlg=""
    for _ in $(seq 1 30); do
      dlg=$(xdotool search --onlyvisible --name '^Select File$' 2>/dev/null | head -1 || true)
      [ -n "$dlg" ] && break
      sleep .5
    done
    [ -n "$dlg" ] || { echo "немає діалогу «Select File» — кнопку натиснуто зарано чи не туди?" >&2; exit 1; }
    sleep .5; xdotool key ctrl+l; sleep .4
    xdotool type --delay 10 -- "$2"; sleep .3; xdotool key Return
    for _ in $(seq 1 30); do xdotool search --onlyvisible --name '^Select File$' >/dev/null 2>&1 || break; sleep .5; done
    echo "file $2" ;;
  ss) import -window root "$SHOTS/$2.png"; echo "saved $SHOTS/$2.png" ;;
  stop)
    for p in app xvfb; do [ -f "$RUN/$p.pid" ] && kill "$(cat "$RUN/$p.pid")" 2>/dev/null || true; rm -f "$RUN/$p.pid"; done
    echo stopped ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
