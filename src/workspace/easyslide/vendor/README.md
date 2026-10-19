# EasySlide (прототип) — веб-збірка DeckCraft

Редактор презентацій для EasyWAR у гілці `claude/easyslide-prototype`. У `main` не зливається.

| Файл | Що це |
|---|---|
| `deckcraft-web.js`, `deckcraft-web_bg.wasm` | Веб-збірка застосунку `apps/deckcraft-web` з DeckCraft 0.8.0 (архів `deckcraft-main`, github.com/storytold/deckcraft), зібрана `wasm-bindgen` 0.2.129 (`--target web --weak-refs`), без `wasm-opt` |
| `licenses/DeckCraft-*` | Ліцензія DeckCraft: MIT OR Apache-2.0, і його NOTICE |
| `licenses/Inter-OFL.txt`, `licenses/BIZUDPGothic-OFL.txt` | Шрифти, вбудовані у збірку (craft-fonts, ревізія 43913056ce82a3fdad0ef69f6b88d1dc922a8104), SIL OFL 1.1 |

Логотипи ArtCraft не входять у збірку й під ліцензію MIT/Apache не підпадають.

## Що змінено в коді DeckCraft

Лише `apps/deckcraft-web/src/web.rs` (патч `script/easyslide/easyslide-web.patch`): якщо сторінка
визначає `window.easyslideHost`, редактор відкриває файли через `easyslideHost.open(purpose)` і
зберігає через `easyslideHost.save(name, bytes)`, тобто системними вікнами EasyWAR (команди
`open_easyslide_file` і `save_easyslide_file`), а не вибором файлу й завантаженням браузера.
Міст — `src/workspace/easyslide/host-core.js`, сторінка — `src/workspace/easyslide/index.html` (з `?blank` починає з порожньої презентації, без `?blank` відкриває англомовний зразок DeckCraft).

## Перезбірка

`script/easyslide/build.sh <deckcraft-main> <craft-fonts>` — лише в окремій теці поза репозиторієм.
Під час роботи застосунку нічого не завантажується з мережі.

SHA-256 цієї збірки:

```
07273981deb930d40b08aee3b1bf2f6430a7bfae981028fddc8ef1bd5df9c4a8  deckcraft-web.js
38a9b9711a8bb4255e738887c67b5687dfff39e62fe73fd4915dc5fd915534c0  deckcraft-web_bg.wasm
```
