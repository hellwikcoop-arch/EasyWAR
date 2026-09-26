# Unified frontend (EasyWAR v3.1)

The single-file `EasyWAR_UNIFIED` HTML is a launcher that embeds two complete
branch modules as base64 `srcdoc` payloads. The desktop build ships the same
application as three same-origin pages:

| File | Source | Notes |
| --- | --- | --- |
| `src/index.html` | launcher from the unified HTML | payloads removed; iframes load `./air.html` / `./rocket.html`; Air controls aligned with the desktop toolbar |
| `src/rocket.html` | «Ракетні Війська і Артилерія» module | v3.1 plus the module-editor hook and scripts |
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

## Importing a new unified HTML

```text
node script/import_unified_html.mjs /path/to/EasyWAR_UNIFIED.html --air-out /tmp/unified-air.html
```

The script rewrites `src/index.html` and `src/rocket.html` (adding the module
editor hook and scripts) and saves the Air module for review. `src/air.html` is **not** overwritten: port the Air changes
by hand with narrow anchored patches (see `AGENTS.md`), then run
`npm run test:unit`.
