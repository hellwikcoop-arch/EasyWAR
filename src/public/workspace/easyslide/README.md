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
- Український інтерфейс: `apps/deckcraft-web/src/uk.rs` ставить перекладач у гачок egui
  (`egui::l10n`, патч `script/easyslide/egui-l10n.patch` до egui 0.36.2, підключеного через
  `[patch.crates-io]` з `vendor/egui`). egui пропускає крізь нього підписи, кнопки, підказки й текст
  `Painter` перед розкладкою; текст, який редагують (`TextEdit`, вміст слайдів), не перекладається.
  Словник — `script/easyslide/uk.tsv` (≈1750 рядків і ≈90 шаблонів із `{}`), у таблиці Rust його
  перетворює `script/easyslide/l10n.mjs`. Ширину стрічкових кнопок і вкладок
  (`crates/ui-egui/src/widgets.rs`, `ribbon.rs`, `status.rs`) DeckCraft міряє за перекладеним текстом.

Міст і запуск — `src/workspace/easyslide/` (`app.js`, `host-core.js`), див. `docs/UNIFIED_FRONTEND.md`.

## Перезбірка

`script/easyslide/build.sh <deckcraft-main> <craft-fonts>` — лише в окремій теці поза репозиторієм.
Під час роботи застосунку нічого не завантажується з мережі.

SHA-256 цієї збірки:

```
55a24a268ae790baabdd7558e0e45d9f0662b67b4da6df4591a9ea06ba90e609  deckcraft-web.js
72ebb6fbd3a3aefd3dde12b79458825e241cdba48b589b798de83fb04af264f1  deckcraft-web_bg.wasm
```
