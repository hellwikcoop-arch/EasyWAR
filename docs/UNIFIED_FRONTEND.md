# Unified frontend (EasyWAR v3.1)

The single-file `EasyWAR_UNIFIED` HTML is a launcher that embeds two complete
branch modules as base64 `srcdoc` payloads. The desktop build ships the same
application as three same-origin pages:

| File | Source | Notes |
| --- | --- | --- |
| `src/index.html` | launcher from the unified HTML | payloads removed; iframes load `./air.html` / `./rocket.html`; Air controls aligned with the desktop toolbar |
| `src/rocket.html` | «Ракетні Війська» module | v3.1 plus the module-editor hook and scripts |
| `src/air.html` | previous desktop frontend + v3.1 Air changes | storage namespace `easywar.air::`, branch brand styles/mark, updated F-16 image; keeps «База даних», Signal, SQLite, XLSX, backup and profiles |
| `src/aircraft-viewer.html` | interactive aircraft viewer for the Air «Довідник» tab | classic (non-module) page opened in an `iframe` by `ref-wiki.js` as `aircraft-viewer.html?embed=1&a=<key>`; three r128, GLTFLoader and the meshopt decoder plus the model data live in `src/public/aircraft-3d/` (no CDN, no network); `embed` hides the aircraft row and hotkeys so the article chooses the aircraft; kept out of the phone offline cache |

Each module isolates its `localStorage` keys and IndexedDB names by prefix
(`easywar.air::`, `easywar.rocket::`), so both work side by side in one origin.

## Dashboard motion (PVK, UDSHV, «Наші втрати»)

`src/dashboard-motion.css` and `src/dashboard-motion.js` are shared by the PVK and
UDSHV dashboards (and the «Наші втрати» tab inside them). The dashboards rebuild the
whole page on every filter change, so entrance animations are not attached to node
creation: `playMotion(root, viewKey)` is called at the end of `render()` and sets
`data-dash-motion="first|enter"` on the dashboard root only when the section changed
(or on first open); otherwise it removes the attribute and the page appears instantly.
All animation rules are gated by that attribute and by
`prefers-reduced-motion: no-preference`. The application toggle «Анімації»
(`html[data-motion="off"]`, defined in `air.html` / `rocket.html`) stays the global
switch: it neutralises these animations through the existing `animation-duration`
override, and `playMotion` also skips the number count-up. Do not reuse the
`data-motion` name on a dashboard root: it would match the `<html>` toggle.

Time budget: every entrance animation plus its stagger delay (`--dm-d`, capped per group
in `STAGGER_GROUPS`) must finish within 1200 ms (design system v1.1, motion rule 1).
`tests/dashboard-motion.test.mjs` computes the worst-case delay of each group and fails
when a new rule or a longer duration breaks the budget; a new rule that uses `--dm-d`
needs an entry in the test's `FAMILIES` table.

## Dashboard theme (PVK, UDSHV, «Наші втрати»)

`src/dashboard-theme.css` — шар кольорів і поверхонь поверх `pvk-dashboard.css`, `udshv-dashboard.css` і `own-losses-dashboard.css`, підключений у `air.html` і `rocket.html` після `dashboard-motion.css`. Усі правила стоять під `html:not([data-theme="light"])`, анімацій у файлі немає, а зображення — лише локальні `webp`/`svg` з папок `udshv-art` і `pvk-art` (перевіряє `tests/dashboard-theme.test.mjs`). Картки показників ПВК: `kpi(label, value, detail, tone, { icon, series, ring })` у `pvk-dashboard.js` будує `article.pvk-kpi` з плиткою `i.pvk-kpi-ic[data-ic]`, текстом `.pvk-kpi-text` і міні-графіком `svg.pvk-kpi-spark` (ряд по днях із `summary.dynamics`, який рахує `pvk-dashboard-core.js`) або кільцем `.pvk-kpi-ring` (`--p` — відсоток). Структура й адаптація (container query `pvk-kpi`: графік зникає від 219px, іконка від 169px вмісту) — у `pvk-dashboard.css`, маски іконок за `data-ic` — у `dashboard-layout.css` (той самий набір `--ic-*`, що й меню; новий ключ потребує `--ic-<key>` і правила `.pvk-kpi-ic[data-ic]`), світіння — у темі. Ряди не вигадуються на фронтенді: нова картка з графіком потребує ряду в `summary.dynamics` (тест `tests/dashboard-layout.test.mjs` це перевіряє). Із лівим меню `dashboard-layout.css` тримає 6 плиток по 3, а 7–8 по 4 в ряд (7–8 в ряд лише від 2200px). Картки УДШВ (`kpiCard` в `udshv-dashboard.js`): плитка `i.ud-kpi-ic` з наявним SVG-значком, графік `svg.ud-spark` із заливкою `.ud-spark-area`; розкладка — `grid-template-areas` у `udshv-dashboard.css` (ic / label / value / delta / spark / hint) з тими самими container query-порогами, що й ПВК. Число лишається прямим нащадком `.ud-kpi` (його шукає лічильник у `dashboard-motion.js`). Із меню 9 карток стоять по 3 в ряд, 9 в ряд — від 2400px. Палітри задано змінними `--ud-*` / `--pvk-*` та спільними `--th-*` на коренях `#udshv-dashboard-root` і `#pvk-dashboard-root`; `.ol-root` успадковує їх.

## Dashboard layout (PVK, UDSHV)

`src/dashboard-layout.css` (підключений у `air.html` і `rocket.html` перед `dashboard-theme.css`) від 1200px робить із `<nav>` дашборда ліву колонку сітки кореня: `grid-column: 1; grid-row: 1 / span 12`, решта блоків — у колонці 2. Проміжки між блоками задано полями, а не `gap`, щоб порожні неявні рядки сітки не додавали висоти. Іконки меню — CSS-маски за атрибутом `data-nav` кнопки (його ставлять `udshv-dashboard.js` і `pvk-dashboard.js`; ключ — ключ розділу). Новому розділу потрібен рядок `--nav-icon` у цьому файлі, інакше буде іконка за замовчуванням. Фото шапок — `udshv-art/hero-photo.webp` (десантник під куполом: права частина банера УДШВ від власника, пропорції 760:142 під висоту шапки, згасання зліва вшите в альфа-канал) і `pvk-art/hero-photo.webp`, підключені в `dashboard-theme.css` лише для темної теми. Шапка УДШВ використовує `background-size: auto 100%`, тому фото не розтягується при зміні ширини вікна; нове фото для неї печеться під те саме співвідношення сторін. Картки внизу лівого меню (`pvk-art/pilot-card.webp`, `udshv-art/badge.webp`) задані в кінці `dashboard-layout.css` через `::after` меню, лише в темній темі й лише від 1200px.

## Startup splash

A short intro covers the launcher from the first paint and then fades into it.

| File | Role |
| --- | --- |
| `src/startup-splash-core.js` | pure timings, tile list, progress rules (tested in `tests/startup-splash.test.mjs`) |
| `src/startup-splash.js` | DOM: video, tiles, «Завантаження…» bar, skip button; loaded as a module after `launcher-tools.js` |
| `src/startup-splash.css` | overlay styles, ultrawide rule, CSS failsafe that hides the overlay after 20 s even if the script never runs |
| `src/splash/easywar-intro.mp4` | 5.33 s, silent, H.264 High, 1280×720, 24 fps, ≈0.5 MB |

`src/index.html` carries only three anchored additions: the stylesheet link, an
empty `<div class="ew-splash" id="ew-splash">` right after `<body>`, and the
module script before `</body>`. `script/import_unified_html.mjs` rewrites
`index.html`, so after an import re-apply those three lines;
`tests/startup-splash.test.mjs` fails if any of them is lost.

- The video is fetched and played from a blob, because WKWebView on macOS may
  not play media from the `tauri://` scheme without Range support. If the fetch
  fails it falls back to the plain URL; if the video errors or does not start
  within 2.5 s, the splash is removed at once.
- Tiles are labels only (no navigation). The loading bar holds at 90 % until the
  page and fonts are loaded.
- `prefers-reduced-motion: reduce` skips the splash. The launcher is `inert`
  while it is shown.
- The clip has a slogan baked in («ОБЕРИ СВІЙ РІД ВІЙСЬК», types in from ≈2.6 s) that
  cannot be edited. `.ew-splash__plate` (inside `.ew-splash__stage`) is an opaque
  plate that closes over it at `SPLASH.plateInMs` and then shows `SPLASH_SLOGAN`
  from the core. The stage has the size of the visible video frame and is scaled
  by `videoZoom()` (the video slowly zooms out 1.07 → 1.0 around 50% / 37.5%), so
  the plate stays glued to the same spot. Change the text only in `SPLASH_SLOGAN`.
  If the clip is replaced, re-measure the plate position (`top: 71.9%`, height,
  width in `startup-splash.css`) and `VIDEO_ZOOM_KEYS` in the core.
- `vite.config.js` keeps `.mp4` out of the phone viewer's offline cache.
- Source clip: generated by the owner with an AI video tool and trimmed to its
  first 5.33 s; the original is not stored in the repository. To replace the
  video keep it silent and small, and re-encode with
  `ffmpeg -i in.mp4 -t 5.3 -an -vf scale=1280:720,format=yuv420p -c:v libx264 -profile:v high -preset veryslow -crf 28 -r 24 -movflags +faststart src/splash/easywar-intro.mp4`
  (adjust `SPLASH.videoMs` and the tile timings in the core if the length changes).
  Every committed version stays in git history and ships in each update package
  (backlog P2-6), so do not commit iterations.


## Registration and sign-in gate

After the splash the launcher is covered by a registration wizard (no profiles
yet) or a sign-in screen (any later launch). The gate is mounted at startup under
the splash (`z-index` 4000 vs 5000), so it is already in place when the splash
ends, and the launcher stays `inert` until sign-in.

| File | Role |
| --- | --- |
| `src/profile-gate-core.js` | pure rules: form validation, module list, table slots per module, retry delay, which screen to show (tested in `tests/profile-gate.test.mjs`) |
| `src/profile-gate.js` | DOM: login, three-step registration (profile → modules → tables), error screen; `html.ew-locked` + `inert` on the page; no network, no browser storage |
| `src/profile-gate.css` | gate styles; `.ew-module-off` hides unchosen module cards (selectors carry `#view-start` because `index.html` uses `!important` ids) |
| `src/local-profiles.js` | creates the gate, hides unchosen modules (`applyModules`), keeps the profile dialog; sign-out sets the splash skip flag and reloads |
| `src/startup-splash-core.js` | `requestSplashSkip` / `consumeSplashSkip`: one-shot `sessionStorage` flag so sign-out does not replay the video |

- `src/index.html` is unchanged. Module cards and tiles are found by the selectors
  in `GATE_MODULES`; `tests/profile-gate.test.mjs` fails if one disappears from
  `index.html`, so re-check it after `script/import_unified_html.mjs`.
- Outside Tauri (plain browser, `npm run dev`) there is no profile backend, so no
  gate is shown.
- The gate is a UI barrier plus the Rust unlock check of data commands, not
  protection against file tampering; see `docs/DATABASE.md` (Local profiles).

## Desktop behaviour

- **Tauri IPC in the iframe.** Tauri injects its bridge only into the top-level
  document. `air.html` starts with `easywar-desktop-frame-bridge`, which reuses
  the launcher's `__TAURI_INTERNALS__`.
- **Downloads** (`<a download>`: XLSX, CSV, zones JSON) are saved to the user's
  Downloads folder with a unique name; a native message shows the saved path.
- **External links** (Signal contact, DiMap) open in the system browser; the
  application window never navigates away from the local pages.
- **`confirm()` / `alert()` on macOS.** WKWebView shows no JavaScript panels by
  default, so `src-tauri/src/desktop_shell.rs` adds native NSAlert panels.
  Windows (WebView2) shows its own dialogs.

## Module editor («Оформлення»)

`src/public/module-editor-core.js` (pure logic, unit-tested) and
`src/public/module-editor.js` (UI and runtime) are loaded as classic scripts at
the end of both modules. The dashboard code of each module lives in a closure,
so `script/module-editor-hook.js` is inserted inside it, right before
`window.__DASH = …`. The hook exposes the reference maps (`EMBK`, `MUN_INFO`,
`CARRIERS`, …), the table rows, a re-render callback, and lets the editor
extend `munKey` / `carrierKey` for custom weapons.

Settings are stored per module in IndexedDB (namespaced by the module's storage
shim) and exported and imported as JSON. Imported files are sanitized: only
`data:image/*` images, `#hex` colors and `p-*` block ids are accepted, and texts
are inserted as text nodes only.

### Public units and weapons, owner-only rest

Every module shows a **Підрозділи й озброєння** button. It opens only the
`units` and `weapons` tabs (`PUBLIC_TABS`), so anyone can add a unit logo or a
new weapon or carrier with images. Entries carry `owner: true` when the owner
made them; others see those read-only. An entry added by someone else never
replaces a built-in one: a unit logo is applied only where the module has no
built-in emblem, and `resolveWeapon` tries the owner's entries, then the
module's built-in keys, then the rest. Settings from config version 1, when the
editor was owner-only, are treated as the owner's. Importing a file (owner-only)
keeps the units and weapons added on that computer unless the file has the same
name.

The other tabs (images, texts, colours, blocks, file) need the owner password.
A hidden trigger opens a password prompt;
the password is checked with PBKDF2-SHA256 (600 000 iterations, WebCrypto)
against `src/public/module-editor-access.js`, which holds only the salt and hash.
Change the password with `node script/set_editor_password.mjs` and rebuild —
older builds keep accepting the old password. Five wrong attempts pause input for
60 s. Unlocking lasts until the module reloads; the button then reads
**Оформлення** and **Заблокувати** returns it to the public mode.

This protects the in-app UI; it is not a boundary against someone who can modify
the installed application files or the local IndexedDB on that computer.

## Rocket Forces reference styling

`src/public/rocket-refs.js` (built by `script/rocket-refs/build.py` from
`template.js` and the images in `script/rocket-refs/img/`, cut from the
September 2026 mockups) adds target-type photos, the M30A1 / M31A1 / ATACMS / M26
banners, a unified KPI card layout, and munition/target details to the selected-
group strip. It only decorates the rendered DOM and module maps via the editor
hook; the v3.1 source stays unchanged, and every image can be replaced in the
editor.

## Довідник: сцена «Інтерактивної моделі»

Вкладка «Довідник» (ПС і РВіА) складається з ES-модулів у `src/`, які збирає Vite (three — з npm). Усе працює без мережі:
моделі лежать у `src/models/*.glb`, ландшафт — у `src/public/aircraft-3d/landscape.js`. `aircraft-viewer.html` лишається окремою
сторінкою для літаків і вертольотів, що мають власний переглядач.

| Модуль | Призначення |
| --- | --- |
| `ref-wiki.js` | вкладка: список статей, стаття, кнопки фаз, ряди кнопок керування машиною (будуються зі списку `controls` рушія), підпис дії |
| `ref-viewer.js` | `RefViewer`: сцена, завантаження `.glb`, камера-орбіта, позначки; `startSim` бере рушій `Machine` за `cfg.machine`, інакше `Sim` |
| `ref-sim-data.js` | дані сценаріїв: фази за типом (`SIM_PHASES`, `MACHINE_PHASES`), `simOf(entry)`, `legacySim` (запасний простий сценарій) |
| `ref-sim.js` | `Sim`: прості сценарії (літак, вертоліт, ракета, бомба, снаряд); модель стоїть у центрі, земля їде під нею |
| `ref-spin.js` | гвинти, повітряні гвинти й колеса літаків і вертольотів, вирізані з мешів моделі (таблиця `SPINS`) |
| `ref-machine.js` | `Machine`: рушій наземної техніки — рельєф, ходова, вузли (`RIGS`), політ ракет залпу, камера за ракетою, клавіші |
| `ref-launchers.js`, `ref-tel.js` | вузли пускових: пакети з кліпом (HIMARS, M270) і піднімний пакет на опорах (Вільха, Сапсан) |
| `ref-crane.js` | вузли машин забезпечення: стріла, телескоп чи жираф, гак, сошники, відвал |
| `ref-gear.js` | колеса (повертають і крутяться) і гусениці (ланки по колу) |
| `ref-terrain.js` | ландшафт і сітка висот, на яку лягає корпус |
| `ref-flight.js` | ракети залпу (`ROCKETS`, `Flight`) і уламки (`Debris`) |
| `ref-mesh.js` | розрізання меша на вузли: зв'язні компоненти, вибір за коробками й циліндрами, `carve`, `attach` |
| `ref-rig-data.js` | виміряні дані вузлів кожної моделі: пускові, ходова, крани, гвинти й колеса |
| `ref-fx.js` | спільні функції й пул частинок диму, пилу та вогню |

Файли моделей не змінюються: вузли, що рухаються, вирізаються з мешів у пам'яті один раз на модель (`entry.parts`), а в спокої
кожна вершина лежить там, де була у файлі. Якщо вирізання не вдалося, стаття лишається без цього вузла, а коли не запустився
рушій техніки, `RefViewer` показує запасний простий `Sim` тієї самої статті. Модульні тести (`npm run test:unit`) вантажать
справжні `.glb` у Node (`tests/helpers/glb-scene.mjs`, текстури відкидаються) і порівнюють геометрію до й після розрізання
(`tests/helpers/mesh-compare.mjs`). Перевірки в браузері — лише в програмному WebGL (SwiftShader).

## Importing a new unified HTML

```text
node script/import_unified_html.mjs /path/to/EasyWAR_UNIFIED.html --air-out /tmp/unified-air.html
```

The script rewrites `src/index.html` and `src/rocket.html` (adding the module
editor hook and scripts) and saves the Air module for review. `src/air.html` is **not** overwritten: port the Air changes
by hand with narrow anchored patches (see `AGENTS.md`), then run
`npm run test:unit`.
