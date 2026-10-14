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
