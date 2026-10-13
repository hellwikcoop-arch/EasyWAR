# Unified frontend (EasyWAR v3.1)

The single-file `EasyWAR_UNIFIED` HTML is a launcher that embeds two complete
branch modules as base64 `srcdoc` payloads. The desktop build ships the same
application as three same-origin pages:

| File | Source | Notes |
| --- | --- | --- |
| `src/index.html` | launcher from the unified HTML | payloads removed; iframes load `./air.html` / `./rocket.html`; Air controls aligned with the desktop toolbar |
| `src/rocket.html` | «Ракетні Війська» module | v3.1 plus the module-editor hook and scripts |
| `src/air.html` | previous desktop frontend + v3.1 Air changes | storage namespace `easywar.air::`, branch brand styles/mark, updated F-16 image; keeps «База даних», Signal, SQLite, XLSX, backup and profiles |

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
