# EasySlide (прототип) — веб-збірка DeckCraft

Редактор презентацій для EasyWAR у гілці `claude/easyslide-prototype`. У `main` не зливається.

| Файл | Що це |
|---|---|
| `deckcraft-web.js`, `deckcraft-web_bg.wasm` | Веб-збірка застосунку `apps/deckcraft-web` з DeckCraft 0.8.0 (архів `deckcraft-main`, github.com/storytold/deckcraft), зібрана `wasm-bindgen` 0.2.129 (`--target web --weak-refs`), без `wasm-opt` |
| `licenses/DeckCraft-*` | Ліцензія DeckCraft: MIT OR Apache-2.0, і його NOTICE |
| `licenses/Inter-OFL.txt`, `licenses/BIZUDPGothic-OFL.txt` | Шрифти, вбудовані у збірку (craft-fonts, ревізія 43913056ce82a3fdad0ef69f6b88d1dc922a8104), SIL OFL 1.1 |

Логотипи ArtCraft не входять у збірку й під ліцензію MIT/Apache не підпадають.

## Що змінено в коді DeckCraft

Патч `script/easyslide/easyslide-web.patch`:

- `apps/deckcraft-web/src/web.rs` — якщо сторінка визначає `window.easyslideHost`, редактор
  починає з порожньої презентації, відкриває файли через `easyslideHost.open(purpose)`, зберігає
  через `easyslideHost.save(name, bytes)` (системні вікна EasyWAR замість вибору файлу й
  завантаження браузера) і повідомляє `easyslideHost.setState(dirty, title)`; після підтвердженого
  збереження `.pptx` знімає позначку змін.
- `crates/engine/src/recovery.rs` — без `std::process::id()` у WASM (інакше редактор падає).
- `crates/ui-egui/src/lib.rs` — у веб-збірці «Зберегти» пропонує `.pptx`, а не `.deckcraft`.

Міст і запуск — `src/workspace/easyslide/` (`app.js`, `host-core.js`), див. `docs/UNIFIED_FRONTEND.md`.

## Перезбірка

`script/easyslide/build.sh <deckcraft-main> <craft-fonts>` — лише в окремій теці поза репозиторієм.
Під час роботи застосунку нічого не завантажується з мережі.

SHA-256 цієї збірки:

```
e79723326d5a0b8ca98cedf0102913914c49c5cd241a112049f2cee3dcec34cb  deckcraft-web.js
28da0cf6d471223e66d9d4d96ab77916b6c67b731c01bb340d16822ae0c4a0c2  deckcraft-web_bg.wasm
```
