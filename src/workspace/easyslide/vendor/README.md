# EasySlide (прототип) — веб-збірка DeckCraft

Редактор презентацій для EasyWAR у гілці `claude/easyslide-prototype`. У `main` не зливається.

| Файл | Що це |
|---|---|
| `deckcraft-web.js`, `deckcraft-web_bg.wasm` | Веб-збірка застосунку `apps/deckcraft-web` з DeckCraft 0.8.0 (архів `deckcraft-main`, github.com/storytold/deckcraft), зібрана `wasm-bindgen` 0.2.129 (`--target web --weak-refs`), без `wasm-opt` |
| `licenses/DeckCraft-*` | Ліцензія DeckCraft: MIT OR Apache-2.0, і його NOTICE |
| `licenses/Inter-OFL.txt`, `licenses/BIZUDPGothic-OFL.txt` | Шрифти, вбудовані у збірку (craft-fonts, ревізія 43913056ce82a3fdad0ef69f6b88d1dc922a8104), SIL OFL 1.1 |

Логотипи ArtCraft не входять у збірку й під ліцензію MIT/Apache не підпадають.

## Що змінено в коді DeckCraft

Патч `script/easyslide/easyslide-web.patch` (три файли): `apps/deckcraft-web/src/web.rs` — якщо сторінка
визначає `window.easyslideHost`, редактор відкриває файли через `easyslideHost.open(purpose)` і
зберігає через `easyslideHost.save(name, bytes)`, тобто системними вікнами EasyWAR (команди
`open_easyslide_file` і `save_easyslide_file`), а не вибором файлу й завантаженням браузера.
`crates/engine/src/recovery.rs` — без `std::process::id()` у WASM (інакше редактор падає на старті);
`crates/ui-egui/src/lib.rs` — у веб-збірці «Зберегти» пропонує `.pptx`, а не `.deckcraft`.
Міст — `src/workspace/easyslide/host-core.js`, сторінка — `src/workspace/easyslide/index.html` (з `?blank` починає з порожньої презентації, без `?blank` відкриває англомовний зразок DeckCraft).

## Перезбірка

`script/easyslide/build.sh <deckcraft-main> <craft-fonts>` — лише в окремій теці поза репозиторієм.
Під час роботи застосунку нічого не завантажується з мережі.

SHA-256 цієї збірки:

```
7186b90f4ee77cc2fb7512a26137685e8c311120a37de224b29d0baf068f0cf4  deckcraft-web.js
7fcb48edf85759466d3f2a03e8ff0c2dd54b0fc8315e3547da2212c998381a50  deckcraft-web_bg.wasm
```
