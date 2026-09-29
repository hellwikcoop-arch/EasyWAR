---
name: run-easywar
description: Build, run, and drive EasyWAR (Tauri 2 desktop app with a Vite frontend - launcher, ПС and РВіА modules). Use when asked to start EasyWAR, run its tests, build it, take a screenshot of its UI, load a table into a dashboard, open a mission card or 3D munition model, or otherwise interact with the running app in a browser or in the real desktop window.
---

EasyWAR is a Tauri 2 app whose whole UI is a Vite multi-page frontend (`index.html` launcher, `air.html` ПС, `rocket.html` РВіА). The agent path is: build the frontend, serve `dist/` with `vite preview`, and drive it with **`.claude/skills/run-easywar/driver.mjs`**. That is a Playwright/Chromium REPL that reads one command per stdin line and writes screenshots to `/tmp/easywar-shots/`. For what exists only in the desktop shell (native file dialog, profiles, backup, updates, Signal), build the debug binary and drive the real WebKitGTK window under Xvfb with **`.claude/skills/run-easywar/desktop.sh`** (xdotool clicks plus full-screen screenshots). Test tables come from **`.claude/skills/run-easywar/fixtures.py`**: synthetic data only, never real operational tables.

All paths are relative to the repo root.

## Prerequisites

Ubuntu packages: the four Tauri libraries match CI and `.claude/hooks/session-start.sh`; `xvfb xdotool imagemagick` are only for the desktop path. In a root container, drop `sudo`.

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev xvfb xdotool imagemagick
```

This container already had Node 22, Rust/cargo 1.94, `python3` with `openpyxl`, a global `playwright` npm package, and Chromium at `/opt/pw-browsers/chromium`. The driver loads `playwright` from the project first, then from `npm root -g`.

## Setup

```bash
npm install --no-save --no-audit --no-fund
python3 .claude/skills/run-easywar/fixtures.py
```

`fixtures.py` fills the empty base templates (`src-tauri/resources/base-tables/`) with 240 deterministic fake rows each and writes `/tmp/easywar-fixtures/air.xlsx` and `/tmp/easywar-fixtures/rocket.xlsx`. The rows use «Тестове N» places, TS- numbers and valid 37U MGRS squares. Pass a directory as the first argument to write elsewhere. Never commit the generated XLSX.

## Build

```bash
npm run build
```

This writes the frontend to `dist/`. For the desktop path, also build the debug binary (about 1 min with a warm cargo cache):

```bash
npm run tauri build -- --debug --no-bundle
```

The binary lands at `src-tauri/target/debug/easywar`.

## Run (agent path): browser + driver

Start the preview server and poll until it answers:

```bash
lsof -ti:4173 -sTCP:LISTEN | xargs -r kill
nohup npx vite preview --port 4173 --strictPort >/tmp/easywar-preview.log 2>&1 &
timeout 30 bash -c 'until curl -sf http://localhost:4173/ >/dev/null; do sleep .5; done'
```

One representative flow: launcher → ПС module → load a table (the module switches to «База даних», 240 rows) → GBU-39 mission card with its 3D model → turn the model.

```bash
node .claude/skills/run-easywar/driver.mjs --reduced-motion <<'EOF'
open index.html
wait-for .branch-card[data-branch=air]
ss launcher
click .branch-card[data-branch=air]
frame air
load /tmp/easywar-fixtures/air.xlsx
wait 1500
ss air-database
passport GBU-39
wait 1500
ss-el .mw-stage gbu39-3d
drag 160
wait 1000
ss-el .mw-stage gbu39-3d-turned
errors
EOF
```

Expected output: `rows 240`, `passport GBU-39 3d: true`. `errors` should show only the launcher's favicon 404 (see Gotchas). Look at the PNGs in `/tmp/easywar-shots/`.

A module can also be opened directly, without the launcher and its iframe:

```bash
node .claude/skills/run-easywar/driver.mjs <<'EOF'
open rocket.html
load /tmp/easywar-fixtures/rocket.xlsx
wait 2000
ss rocket-dashboard
text .kpi-grid
EOF
```

For step-by-step work, keep the driver open in tmux and poll for each command's echo:

```bash
tmux new-session -d -s ew -x 200 -y 50
tmux send-keys -t ew 'node .claude/skills/run-easywar/driver.mjs --reduced-motion' Enter
timeout 30 bash -c 'until tmux capture-pane -t ew -p | grep -q "^ready"; do sleep .2; done'
tmux send-keys -t ew 'open air.html' Enter
timeout 30 bash -c 'until tmux capture-pane -t ew -p | grep -q "^url"; do sleep .2; done'
tmux send-keys -t ew 'load /tmp/easywar-fixtures/air.xlsx' Enter
timeout 30 bash -c 'until tmux capture-pane -t ew -p | grep -q "^rows"; do sleep .2; done'
tmux capture-pane -t ew -p | grep -v '^$' | tail -4
tmux send-keys -t ew 'quit' Enter
tmux kill-session -t ew
```

Stop the preview server when done:

```bash
lsof -ti:4173 -sTCP:LISTEN | xargs -r kill
```

Driver options:
- `--url` (default `http://localhost:4173/`, or `$EASYWAR_URL`);
- `--reduced-motion`;
- `--width 1600` and `--height 1000`;
- `--scale 1`;
- `--shots /tmp/easywar-shots`;
- `CHROMIUM_PATH` env var to use another Chromium.

The driver echoes every line as `> cmd`. A failing command prints `error: …` and the run continues.

| command | what it does |
|---|---|
| `open <page>` | go to `index.html` / `air.html` / `rocket.html` (relative to `--url`); context = page |
| `frame <air\|rocket\|main>` | switch context into the launcher's `#frame-air` / `#frame-rocket` iframe, or back |
| `load <xlsx>` | connect a table in the current module through `window.__AV.connect`, the same path as «Відкрити таблицю…»; prints `rows N` |
| `passport <munition>` | open the mission card for the first row whose munition contains the text; waits for the 3D stage; prints `3d: true/false` |
| `drag <dx>` | drag the 3D model horizontally by dx px (turns it) |
| `click <sel>` / `fill <sel> <text>` / `press <key>` | Playwright actions in the current context |
| `wait <ms>` / `wait-for <sel>` | fixed pause / wait for a selector (20 s) |
| `text <sel>` / `eval <js>` | print innerText / result of a JS expression in the current context |
| `ss [name]` / `ss-el <sel> [name]` | screenshot of the viewport / of one element → `/tmp/easywar-shots/<name>.png` |
| `errors` | page errors, console errors and HTTP ≥ 400 responses collected so far |
| `quit` | close the browser (also happens at end of stdin) |

## Run (agent path): real desktop window

Needs the debug binary from Build. The window fills a 1440×900 Xvfb screen at 0,0, so the coordinates below are stable. Each `start` uses throwaway XDG dirs under `/tmp/easywar-desktop/home`, so the app starts from a clean state and never touches `~/.config/com.hellwikcoop.easywar`.

```bash
D=.claude/skills/run-easywar/desktop.sh
$D start
$D ss desktop-launcher
$D click 583 528
sleep 4
$D click 128 655
$D open-file /tmp/easywar-fixtures/air.xlsx
sleep 6
$D ss desktop-air-loaded
$D click 700 825
sleep 9
$D scroll 720 500 10
sleep 4
$D ss desktop-passport-3d
$D stop
```

The script above does this:
- `583 528` is the «Повітряні сили» card on the launcher. The module takes a few seconds to load; a click sent earlier is lost.
- `128 655` is «Відкрити таблицю…» in the empty ПС module; it opens the GTK file dialog.
- `open-file` waits for the dialog window (`Select File`), then types the path into it (Ctrl+L, path, Enter). If the dialog never appears, it exits 1 instead of typing into the app.
- After loading, the module shows «База даних» with 240 rows.
- `700 825` is a table row (with the fixture data, operation №235, GBU-39); clicking it opens its mission card.
- The scroll brings «Схема боєприпасу» (the 3D model) into view.

Screenshots go to `/tmp/easywar-shots/` and the app log to `/tmp/easywar-desktop/app.log`. Other subcommands: `key <xdotool key>` and `type <text>`. `EASYWAR_DISPLAY` (default `:99`) and `EASYWAR_SHOTS` override the display and the screenshot directory.

## Run (human path)

`./script/build_and_run.sh` wraps `npm run tauri dev` (Vite dev server plus a desktop window; stop with Ctrl-C). It was not exercised headless here; use the desktop path above instead.

## Test

These are the same checks as the CI `checks` job:

```bash
node script/release_version.mjs
npm run test:unit
npm run build
```

`npm run test:unit` → 116 tests, all pass. It includes the XLSX contract test, which runs `cargo run --example xlsx_contract_runner` (warm after the session hook).

## Gotchas

- **Launcher modules are iframes.** After clicking `.branch-card[data-branch=air]`, selectors and `load` only work after `frame air`. Alternatively, `open air.html` skips the launcher.
- **The browser build hides desktop-only UI.** The launcher's «Профілі / Резервна копія / Оновлення / Signal» buttons only render in the Tauri shell. The SQLite dashboard source says «Доступно лише в десктоп-застосунку». To see or test them, use `desktop.sh`.
- **3D runs on software WebGL, and it is slow.** The driver passes `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` so WebGL does not depend on a GPU; in this container WebGL2 and the 3D stage worked even without those flags. Frames lag, so screenshots taken during the wing-deploy animation land on arbitrary frames. Use `--reduced-motion` (static pose, wings open) and `drag` for other angles.
- **`ss-el` clips by bounding box** instead of using Playwright's element screenshot. That is instant; an element screenshot of the 3D stage waited ~3.3 s for the running render loop to look "stable".
- **After `open index.html`, `errors` lists `console: Failed to load resource: the server responded with a status of 404 (Not Found)`** with no URL. It is `/favicon.ico`: the launcher has no `<link rel="icon">`, while `air.html` and `rocket.html` inline theirs. It is harmless; every other entry is real.
- **Fixture MGRS must be valid 100 km squares.** Random letter pairs put points thousands of km away, and the dashboard map zooms out to fit them. `fixtures.py` only uses 37U C–F × P–Q (about 48–49.5° N).
- **No CDP in WebKitGTK.** The desktop shell can only be driven by screen coordinates, keys and screenshots. Run web-side logic (selectors, `eval`) through `driver.mjs`; it is the same frontend code.
- **The desktop window paints late.** It appears white and the launcher paints 5–10 s later with a cold cache. `desktop.sh start` waits until the screen has contrast. After the file dialog closes, the loaded table repaints about 3 s later; a mission card takes about 5–9 s after the click. Earlier screenshots show the old screen (for example, the empty «Відкрийте таблицю…» state) or only the blurred backdrop, even though the app has already moved on.
- **Harmless desktop log noise:** `libEGL warning: DRI3 error: Could not get DRI3 device` and `dconf-WARNING … Failed to execute child process "dbus-launch"`.

## Troubleshooting

- **`Error: Port 4173 is already in use`** from `vite preview --strictPort`: an older preview server is still running. Run `lsof -ti:4173 -sTCP:LISTEN | xargs -r kill`, then start again.
- **`xdpyinfo: command not found`** while waiting for Xvfb: it is not installed here. `desktop.sh` polls with `xdotool getdisplaygeometry` instead.
- **`немає src-tauri/target/debug/easywar`** from `desktop.sh start`: run `npm run tauri build -- --debug --no-bundle` first.
- **Desktop screenshot is all white or all black:** the webview has not painted yet. Wait and take the screenshot again; `start` already does this for the launcher.
