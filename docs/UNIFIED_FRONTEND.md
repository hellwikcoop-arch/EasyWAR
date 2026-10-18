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

## Локальний помічник — етап 1

Панель «КОМБАТ» підключена через наявний `src/local-profiles.js` у
лаунчері; legacy HTML і iframe-модулі не потребують нових вбудованих
скриптів. Налаштування **Увімкнути локального помічника** в діалозі профілів
за замовчуванням увімкнене після входу в профіль; вимкнення діє лише протягом поточного входу. Кнопка панелі
стоїть у правому нижньому куті поверх відкритого модуля.

| Файл | Роль |
|---|---|
| `src/assistant/assistant-session-core.js` | Стан явного увімкнення для поточного входу в профіль і відхилення застарілих асинхронних результатів; без сховищ |
| `src/assistant/assistant-state-core.js` | Відповіді про фактичну версію, прив'язані модулі й уже відомий стан оновлення лише з типізованого локального стану, без шляхів |
| `src/app-update-state-core.js` | Тимчасовий знімок стану штатного оновлювача без запуску перевірки; `backup.js` публікує результати вже наявних дій |
| `src/assistant/assistant-knowledge-core.js` | Чисті компіляція й пошук уривків фіксованої локальної довідки з джерелом «файл → розділ» |
| `src/assistant/assistant-explain-core.js` | Чисте ядро режиму пояснень для ПС/РВ: дескриптор елемента → що це й на чому засновано (лише з `DATA_REFERENCE.md`) |
| `src/assistant/assistant-explain-udshv-core.js` | Те саме для УДШВ і вкладки «Наші втрати» (гілка `dshv`) |
| `src/assistant/assistant-explain.js` | DOM-контролер режиму пояснень: перехоплення кліків у capture, підсвітка, Esc, зняття при закритті; без змін файлів модулів |
| `src/assistant/assistant-rules-core.js` | Каталог постійних ID, пояснень і пропозицій; адаптер наявного `reviewData` без застосування виправлень |
| `src/assistant/assistant-context-core.js` | Вибір підтримуваного вже відкритого контексту УДШВ, ПС/РВ або «Наші втрати» |
| `src/assistant/assistant-context.js` | Читання активного розблокованого iframe лише після явної кнопки перевірки; знімок видимих власних втрат або вже відкриті байти в пам'яті |
| `src/assistant/assistant-retrieval-core.js` | Чистий толерантний пошук (BM25 з основами слів і синонімами) поверх строгого `searchKnowledge`; пакети фактів ≤3 уривків; слабкий збіг дає лише назви розділів |
| `src/assistant/assistant-dialogue-core.js` | Чистий контролер розмови: маршрутизація, контекст з останніх реплік, продовження й уточнення, типізовані кнопки дій, бюджет запиту, перевірка відповіді моделі, точна відповідь-запасний варіант |
| `src/assistant/assistant-song.js` | Контролер звуку пасхалки КОМБАТА: одна локальна пісня (`assets/favorite-song.mp3`) без відео, стани «грає / зупинено / автозапуск заблоковано / недоступна», зупинка при згортанні, очищенні й виході; мережі та сховищ немає |
| `src/assistant/assistant-draft-core.js` | Чиста логіка чернетки доповіді: дозволені модулі (ПС, РВ), очищення тексту, перевірка стану поля, рядки підтвердження; без DOM і сховищ |
| `src/assistant/assistant-draft.js` | DOM-обв'язка чернетки: читання стану `#paste`/`#autoToggle` і підстановка тексту у вкладці «Внесення доповідей» лише після підтвердження; кнопок модуля не натискає |
| `src/assistant/assistant-llm.js` | Клієнт семи Tauri-команд локальної моделі (`Channel`, скасування); без DOM і сховищ, `invoke` підміняється в тестах |
| `src/assistant/assistant-ui.js`, `assistant-ui.css` | Панель, вкладки довідки, навігації й перевірки (кнопки модулів, блок «Чернетка доповіді»), тимчасова розмова на `runDialogueTurn` (кнопки дій, підказки, «КОМБАТ думає…» із зупинкою), блок «Локальна мовна модель» у налаштуванні помічника, очищення при вимкненні та завершенні сесії профілю |
| `src/assistant/knowledge/index.json` | Детермінований індекс, вбудований у збірку |
| `script/assistant_index.mjs` | Генерація індексу з дозволених документів; `--check` перевіряє відповідність джерелам |

Немає нових Rust-команд, міграцій, сховища розмов чи мережевої взаємодії.
Зміна модуля скидає результат перевірки; вихід, блокування або зміна профілю
вимикають помічника й очищують розмову. Дані й уривки відображаються як
текст. Основна таблиця ПВК та Артилерія ще не мають підтримки перевірок
помічника. Поведінка, каталог правил і джерела індексу —
[ASSISTANT.md](ASSISTANT.md).

Результат відповідає знімку на момент явної перевірки. SQLite-джерело
дашборда не підтримується й не замінюється старими байтами XLSX.

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

## 3D-довідники (хаб і шість довідників)

Кнопка «3D-довідники» на головному екрані відкриває хаб інтерактивних довідників у накладці поверх лаунчера. Довідники — окремі сторінки збірки, тому legacy HTML (`index.html`, `air.html`, `rocket.html`) для них не змінювався, а `script/import_unified_html.mjs` їх не чіпає. Опис моделей, авторства й завантаження — в `docs/3D_MODELS.md` (розділ «3D-довідники»).

| Файл | Роль |
| --- | --- |
| `src/guides-launcher.js`, `src/guides-launcher.css` | кнопка (`prepend` у `.appbar-right`; імпорт останній у `launcher-tools.js`, тож кнопка стоїть крайньою ліворуч) і накладка з `<iframe>` на `guides/index.html`; «Закрити» та `Esc` ставлять `about:blank`, щоб WebGL-сцена не лишалась у пам'яті |
| `src/guides/index.html`, `hub.js`, `hub.css` | хаб: шість карток (кількість і назви моделей беруться з `credits.js`) і легенда походження моделей; посилання «До EasyWAR» видиме лише тоді, коли хаб відкрито не в накладці |
| `src/guides/<id>/` | довідник (`rvia`, `ppo`, `ground-forces`, `uav`, `aviation`, `enemy-ground`): `index.html` без вбудованих скриптів, `main.js`, `style.css`, `models.js`, `models/*.glb`, поділ моделей на частини (`specs.js`, `meta.js`, `rig.js`, `spec.js`) |
| `src/guides/credits.js` | авторство всіх моделей і ландшафту; від нього залежать підписи, хаб і `src/models/CREDITS.md` |
| `src/guides/guide-kit.js`, `room-env.js`, `base.css`, `fonts/` | спільне: читання GLB, годинник, заплатка відбиттів three, копія `RoomEnvironment` із three r160 (MIT), базові стилі, локальні шрифти woff2 (SIL OFL, тексти ліцензій у `fonts/licenses`) |

- `vite.config.js` має сім входів: `guides` (хаб) і `guides-rvia`, `guides-ppo`, `guides-ground-forces`, `guides-uav`, `guides-aviation`, `guides-enemy-ground`. Новий довідник потребує входу тут, рядка в `GUIDES` у `script/guides-credits.mjs` і в `hub.js`; `tests/guides.test.mjs` бере перелік із `GUIDES` і для кожного довідника перевіряє вхід збірки, хаб, моделі та авторство.
- Кеш переглядача для телефона (`viewerServiceWorker`) не бере ні сторінок `guides*`, ні `.woff2`: ≈ 105 МБ моделей телефонному файлу не потрібні.
- Мережі немає: three із npm, шрифти й ландшафт лежать у збірці, на сторінках довідників немає `eval`, `new Function` і вбудованих скриптів (перевіряє `tests/guides.test.mjs`).
- CSP у `tauri.conf.json` не змінювали (вона `null`). Якщо її колись посилять, довідникам, імовірно, знадобляться `'wasm-unsafe-eval'` (декодер meshopt — WASM), `blob:` для текстур із GLB і `font-src 'self'`; з посиленою CSP довідники не перевіряли.
- Довідники налаштовано під three r160, а проєкт на r186. Різницю гасять `room-env.js` і заплатка `LEGACY_REFLECTIONS` у `guide-kit.js`; тест «вигляд, затверджений на three r160» падає, коли відповідний шматок шейдера three змінюється, — це сигнал переглянути `guide-kit.js`.

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

## Manual entry («Довільне внесення»)

The «Внесення доповідей» tab of `air.html` and `rocket.html` has a second way to
add rows next to «Зі звіту»: a form whose fields are the columns of the open
table (header + Excel column letter next to each field; Rocket Forces also gets
«Підрозділ (від кого машина)» and «Вогнева бригада» when the table has them).

| File | Role |
| --- | --- |
| `src/manual-entry-core.js` | pure rules, no DOM: fields by table columns (`manualFields`), cleaning and normalising values (time, count, target numbers, crew, DPI/MGRS), `analyzeDraft` (errors / warnings / empty columns), `previewCells`, suggestions; takes `AVCORE` as an argument (tested in `tests/manual-entry.test.mjs` against the real CORE of both pages) |
| `src/manual-entry.js` | DOM: mode switch, form, preview row, duplicate confirmation; loaded as a module at the end of both pages |
| `src/manual-entry.css` | only what the pages lack (mode switch, column badge, field errors, preview row); everything else reuses `.panel .grid .f .chips .btn .notice .dupnote` |

- **The write path is the page's own.** The only legacy edits are in each page's
  `addSelected(fromAuto, explicit)` (four one-line changes: an optional list of
  records that replaces the parsed report, and no clearing of the report text or
  focus change when it is given) and one `<script type="module">` tag. The form
  calls `window.__AV.addSelected(false, [record])`, so № and «Місяць», the
  `appendRows` self-check, the duplicate rule, the session list, undo and the
  write-through-handle behaviour are exactly those of the report path.
- **Safety check.** The module checks `addSelected.length >= 2` and offers manual
  entry only then: an unpatched page would add the parsed report instead of the form.
- **Mode.** The report section and the results panel get `ew-report-only` and are
  hidden by `#view-entry.ew-manual-on`; `#sessionWrap` (list and undo) stays.
  The choice is kept in `localStorage` (`ew.entry.mode.air|rocket`, under the
  module's own storage prefix); the draft is never stored. Ctrl/⌘+Enter is
  intercepted on `window` in the capture phase so the page's own handler cannot
  add a pending parsed report. A Signal review forces «Зі звіту».
- **Re-importing `rocket.html`** (`script/import_unified_html.mjs`) removes both
  edits like it removes the other module tags; `tests/manual-entry-pages.test.mjs`
  fails until they are applied again. Keep new fields in sync with `FIELD_ORDER` of
  the page's CORE: the form only shows columns that exist in the open table.

## Rocket Forces reference styling

`src/public/rocket-refs.js` (built by `script/rocket-refs/build.py` from
`template.js` and the images in `script/rocket-refs/img/`, cut from the
September 2026 mockups) adds target-type photos, the M30A1 / M31A1 / ATACMS / M26
banners, a unified KPI card layout, and munition/target details to the selected-
group strip. It only decorates the rendered DOM and module maps via the editor
hook; the v3.1 source stays unchanged, and every image can be replaced in the
editor.

## Емблеми підрозділів і значки боєприпасів

- `src/unit-emblems-core.js` (чиста логіка, тест `tests/unit-emblem-names.test.mjs`): `emblemFile(name)` зіставляє назву підрозділу з
  одним із файлів `src/unit-art/` (шаблони `PATTERNS` і загальний номер + тип `одшбр/ошп/оабр/реабр/омбр/оєбр`).
- `src/unit-emblems.js`: `emblemOf(name)` (адреса через `import.meta.glob`, у Node-тестах обгорнуто в `try/catch`), `crestImg(name, cls, placeholder)` —
  `img.crest` або порожній круг `span.crest.crest-ph`. Використовують `udshv-dashboard.js` (`.ud-crest`) і `artillery-app.js` (`unitCell`).
- `src/artillery-icons-core.js`: `AMMO_BY_GROUP`, `ammoFile`, `chargeIconFile` — назва боєприпасу чи заряду → файл у `src/ammo-art/`
  (`charge-*.webp` — знімки процедурних моделей зарядів). Плитки «Зведення» в Артилерії беруть фон з атрибута `data-art` (`artillery.css`).
- Вкладка «Довідник» Артилерії викликає `ref-wiki.mount(..., { illustrationOnly })`: лише список, 3D-сцена й підпис про походження моделі; повну
  статтю вмикає прапорець `REF_ILLUSTRATION_ONLY = false` в `artillery-app.js`.

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

## Спільний шар оформлення дашбордів (`ui-kit`)

`src/ui-kit.css` і `src/public/ui-kit.js` підключені в `air.html` та `rocket.html`
останніми в `<head>`. Це лише вигляд, розміщення й Motion: логіка, метрики й дані
дашбордів не змінюються. Акцент береться з `--accent` модуля (ПС синій, РВ золотий);
панелі, панель інструментів, сегментовані перемикачі, таблиці, банер «Основні показники»
і дашборди ПВК та УДШВ мають спільні радіуси, межі, тіні та рух. Поява елементів
анімується лише при першому відкритті (клас `html.ew-boot`), рух вимикається
`prefers-reduced-motion` і перемикачем `html[data-motion="off"]`. Фото й візуалізації
карток не вилучаються. Дашборди ПВК і УДШВ мають власний акцент (синій і малиновий) через
локальні `--ew-accent`; тло шапки ПВК — абстрактний рельєф `src/pvk-art/relief-banner.webp`.

`artillery.html` теж підключає `ui-kit.css`/`ui-kit.js` (`data-ew-module="artillery"`), але має власні токени в
`artillery.css`: блок «Спільний вигляд дашбордів» у кінці файлу перетворює вкладки на бічне меню
(CSS через `body:has(#tabs:not([hidden]))`, від 900 px; нижче — рядок вкладок із прокруткою), перемальовує
картки KPI, панелі, таблиці й додає Motion (`html.ew-boot`). Обгортки сторінки мають клас `.stack`
з колонкою `minmax(0, 1fr)`, щоб широкі таблиці прокручувались усередині панелей і не розтягували сторінку.

Розкладка дашборда ПС за замовчуванням збігається з РВ: угорі карта й праворуч «Топ-5 підрозділів» та «Тип цілі»,
нижче блок «Основні показники» з шістьма картками в один ряд. Ключ збереженого макета ПС змінено на
`easywar.layout.air.reference.v1`, тож власні розкладки, збережені раніше (`easywar.layout.v2`), скидаються
до нової типової; їх можна знову налаштувати в «Розташуванні блоків». Стилі прив'язані до
`html[data-ew-module="air"]`, який виставляє вбудований скрипт теми в `air.html` (у `rocket.html` — `rocket`).

### Перший екран без прокручування (ПС і РВ)

На вікнах від 1400×850 перший екран дашборда (карта, праворуч «Топ-5 підрозділів» і «Тип цілі», банер із шістьма
картками) вміщується без прокручування: висота ряду з картою рахується від висоти вікна (`--fit-card`,
`--fit-kh`, `--fit-top` у `ui-kit.css`), картки мають однакову висоту, а шість карток завжди в одному рядку.
На менших вікнах лишається звичайне прокручування. У ПС панель «Період / Ефективність» схована за кнопкою
фільтрів у шапці (клас `filters-open` на `.dmain`, функція `filterToggleInit` в `air.html`), як у РВ.
На першому екрані приховано лише підпис «від 5 вильотів» у «Топ-5» (є на сторінці «Підрозділи»), короткий
пояснювальний рядок під 3D-картою та рядок-слоган під типами цілей у ПС.

### Шапка й бічне меню ПС — як у РВ

Шапка ПС — один рядок (бренд, вкладки, кнопки), тема — іконкою ☀/☾, зарезервованого під плаваючі кнопки
лаунчера місця (`padding-right: 196px`) більше немає, як і в РВ. Лічильник «60 записів» у чипі файла
ховається на вікнах вужче 1560 px, кнопка джерела (лише в десктопі) обмежена за шириною. Бічне меню ПС
вужче (`--sw: 188px`), пункти компактні (38 px, 13 px), активний — рамка й підсвітка акцентом, фото-картка
знизу має рамку. Усе в `src/ui-kit.css` під `html[data-ew-module="air"]`.

### Карта й банер ПС — як у РВ

У панелі «Карта операцій» ПС підкладка, шари й довідковий рядок схована за кнопкою «Параметри карти»
(іконка з чотирма квадратиками в шапці панелі; клас `options-open` на `#p-map`), шапка панелі компактна,
як у РВ. Літак у банері «Основні показники» розтягнуто на всю ширину банера, текст і показники лежать поверх.

### Адаптивність і світла тема (ПС, РВ, ПВК, УДШВ)

Блоки «Адаптивність і світла тема», «Панель вибору» й «Легенда кільцевої діаграми» в кінці `src/ui-kit.css`:
шапка ПС перебудовується на вікнах ≤1365, ≤1319 і ≤720 px; шапка панелі карти РВ на вікнах вужче 1280 px має
`height: auto`; заголовки таблиці «Топ-5» компактніші на вікнах вужче 1400 px; панелі вибору (`.dsel`, показники
`.ds-st`) мають колонки `minmax(0, 1fr)` — від 1100 px вони двоколонкові, від 720 px одноколонкові, показники
переносяться, а панель типу цілей РВ на 1101–1439 px стискає колонки й не виходить за межі; легенда кільцевої діаграми
переносить назви; банер ПВК на вікнах ≤900 px затемнений по всій ширині. У світлій темі РВ картки типів цілей і
підписи показників мають контрастні кольори. У `air.html` і `rocket.html` функція `markNav()` на самому верху
сторінки (прокрутка <24 px) підсвічує «Зведення», бо перший екран вміщується у вікно й нижчі розділи не мають
перебивати підсвітку. У вбудованій карті (`src/map.css`) на вікнах ≤640 і ≤420 px панель шарів піднято над
підписами джерел.

### Стартовий екран (лаунчер)

`src/index.html` має `<style id="easywar-start-shared-look">`: картки командувань і родів військ — скляні, з кадрами
з `launcher-bg.webp` (позиція й масштаб кадру задаються змінними `--sl-x`, `--sl-y`, `--sl-size`), ПВК має синю межу,
ДШВ — червону, картки з'являються з Motion (`slRise`, вимикається `prefers-reduced-motion`). На широких вікнах
(від 1000 px і співвідношення сторін від 3:2) картки згруповано в секції «Командування» і «Роди військ» (заголовки
малюються псевдоелементами `.branch-cards::before/::after`), картки командувань горизонтальні, ряд родів військ —
ПС, РВ, Артилерія, Армійська авіація. Розмітка, обробники й дані лаунчера не змінюються, тому картки командувань
і далі розкриваються за кліком, а РВ й Артилерія лишаються окремими картками. Світлої теми лаунчер не має.

### Довідник: силует і контур літаків

`src/ref-art/<id>-sil.webp` (чорний силует) і `<id>-lin.webp` (лінійний профіль): чорні зображення на прозорому тлі для МіГ-29, F-16, Су-27, Су-25, Mirage 2000 (`id` статті з `ref-data.js`). `ref-wiki.js` підвантажує адреси динамічно з `ref-art-urls.js` (`import.meta.glob`, лише збірка Vite; у Node-тестах модуль не вантажиться й розділ мовчки пропускається). Розділ «Силует і контур» з'являється, коли для статті є файли; без `media.thumb` силует стає мініатюрою списку. У темній темі зображення інвертуються CSS-фільтром, у світлій показуються як є.
