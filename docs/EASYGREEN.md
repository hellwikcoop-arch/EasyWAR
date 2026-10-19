# EasyGreen — електронні таблиці (прототип)

EasyGreen — редактор електронних таблиць для модуля «Робоче середовище» (розділ «Офіс»), поруч із
EasyDoc і EasySlide. Це прототип: його підключає оболонка модуля, власної кнопки на головному екрані
й картки в каталозі модулів у нього немає.

## Що це

- Основа — **GridCraft 0.8.0** (ArtCraft, github.com/storytold/gridcraft): відкритий клон Excel на Rust
  з веб-версією на WASM. Ліцензія MIT OR Apache-2.0. Тексти ліцензій і `NOTICE` лежать поруч зі
  збіркою в `src/public/workspace/easygreen/app/`. Логотипи ArtCraft не використовуються.
- Сам проєкт GridCraft оцінює свою готовність до реальної роботи приблизно в 50% (альфа).
- Працює повністю офлайн: збірка лежить у застосунку, мережевих запитів немає (перевіряє
  `tests/easygreen-core.test.mjs`). Канал керування агентами й MCP у веб-версію GridCraft не входять.

## Файли

| Файл | Роль |
|---|---|
| `src/public/workspace/easygreen/app/` | Зібрана таблиця: `index.html`, обв'язка `.js`, `_bg.wasm` (≈19 МБ), ліцензії |
| `src/workspace/easygreen/easygreen-core.js` | Чиста логіка: протокол повідомлень, перевірка файлів, тексти стану |
| `src/workspace/easygreen/easygreen-panel.js` | `mountEasyGreen(container, { appUrl, onClose })` → `{ destroy(), isDirty() }` |
| `src/workspace/easygreen/easygreen.css` | Смуга дій і рамка таблиці |
| `src/workspace/easygreen/index.html` | EasyGreen окремою сторінкою (сторінка Vite `workspace-easygreen`) |
| `src-tauri/src/easygreen.rs` | Перевірки збереження: дозволені типи, розмір, назва, захист таблиць профілів |
| `script/easygreen/build.sh`, `gridcraft-easygreen.patch` | Відтворювана збірка з архіву GridCraft і наші зміни до нього |

## Як підключити в оболонку

Варіант 1 — iframe на сторінку `workspace/easygreen/index.html` (відносно `index.html`).
Варіант 2 — змонтувати панель напряму:

```js
import { mountEasyGreen } from './workspace/easygreen/easygreen-panel.js';
const panel = mountEasyGreen(container, { appUrl: 'workspace/easygreen/app/index.html' });
// перед закриттям вкладки: panel.isDirty() → спитати; потім panel.destroy()
```

Таблиця має бути того самого походження, що й сторінка, яка її монтує (протокол `?host=parent`).

## Як працюють файли

- **Відкриття.** Кнопка «Відкрити файл…» на смузі або «Файл → Відкрити» в самій таблиці. Файл
  читається в пам'ять: таблиця працює з копією і ніколи не пише у файл, з якого його відкрито.
- **Збереження.** «Зберегти», «Зберегти як» і експорт (PDF, CSV, HTML) передаються в Rust-команду
  `save_easygreen_file`. Вона відкриває системне вікно збереження й пише через тимчасовий файл.
  Таблиці, прив'язані до профілів, і їхні копії `<назва>.easywar-prev.xlsx` команда **не
  перезаписує**: сире джерело змінюється лише штатним записом таблиці профілю.
- Capabilities Tauri і CSP не змінювалися: діалог викликається з Rust, як для презентацій.

## Наші зміни до GridCraft

`script/easygreen/gridcraft-easygreen.patch`:

1. Українська мова інтерфейсу (`i18n/uk.rs`, 939 рядків; назви функцій у формулах лишаються
   англійськими, як у вихідному коді).
2. Параметр `?lang=uk`: мову обирає сторінка, що вбудовує таблицю, а не мова системи.
3. Сторінка таблиці: `lang="uk"`, заголовок і текст завантаження «EasyGreen».

## Збірка

```bash
script/easygreen/build.sh /шлях/до/gridcraft-main.zip
```

Потрібні Rust із ціллю `wasm32-unknown-unknown`, `trunk` 0.21, `wasm-bindgen` 0.2.129 і `wasm-opt`
у `PATH`. Архів розпаковується в тимчасову теку поза репозиторієм. SHA-256 архіву, з якого зібрано
прототип: `e279dd082c0a107f534a45d6941e6d01963930ce32bbf226ae2908c463da127f`.

## Що перевірено і що ні

- Перевірено в Chromium (Playwright, WebGL2 через SwiftShader): запуск, український інтерфейс,
  відкриття синтетичної таблиці ПС (4 аркуші, 240 рядків), збереження. Значення у збереженому файлі
  збігаються з оригіналом на всіх аркушах.
- **Не перевірено:** вікна Tauri на macOS (WKWebView) і Windows (WebView2), зокрема WebGL/WebGPU,
  введення кирилиці, буфер обміну й друк; нативне вікно збереження; автозбереження в режимі iframe.
