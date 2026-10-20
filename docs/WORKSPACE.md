# Робоче середовище: розділ «Офіс» і контракт підключення застосунків

Модуль «Робоче середовище» (англійський id `workspace`) відкривається кнопкою **Робоче
середовище** на стартовому екрані. У ньому поки один розділ — **Офіс** — з трьома
застосунками:

| id | Назва | Аналог | Основа | Типові файли |
|---|---|---|---|---|
| `easygreen` | EasyGreen | Excel | GridCraft | `.xlsx`, `.csv` |
| `easydoc` | EasyDoc | Word | WordCraft | `.docx`, `.txt` |
| `easyslide` | EasySlide | PowerPoint | DeckCraft | `.pptx` |

Застосунки працюють офлайн у вікні EasyWAR (веб-збірки WASM лежать у збірці, з їхніх сайтів
нічого не вантажиться). Поки застосунок не підключено, його картка відкриває сторінку
«у розробці». Реєстр застосунків — `OFFICE_APPS` у `src/workspace/workspace-core.js`.

## Як підключити застосунок (контракт версії 1)

Підключення не потребує змін в оболонці: досить додати файл `src/workspace/<id>/app.js`.
Оболонка знаходить його через `import.meta.glob('./*/app.js')`, і картка з «У розробці»
стає «Відкрити».

```js
// src/workspace/easygreen/app.js
export const contract = 1; // необов'язково; новіша версія за оболонку не запуститься

export async function mount(container, host) {
  // container — порожній <div> на всю сторінку застосунку (app.html?app=<id>)
  // host — див. нижче
  return {
    unmount() {},          // або destroy(): закриття застосунку, звільнити WebGL/WASM
    isDirty() { return false; }, // необов'язково: чи є незбережені зміни
  };
}
```

- **Де лежить код.** Модуль і стилі — у `src/workspace/<id>/` (Vite збирає їх в окремий чанк
  `assets/workspace-app-*.js`, який вантажиться лише при відкритті). Великі статичні файли
  (WASM, шрифти, сторінка веб-збірки) — у `src/public/workspace/<id>/`; у збірці вони
  лежать у `dist/workspace/<id>/`. Адресу до них дає `host.resolve('workspace/<id>/…')`.
  Офлайн-кеш телефона не бере ні `workspace/`, ні `assets/workspace-*`, ні `.wasm`.
- **Контейнер.** Кожен застосунок працює на власній сторінці `workspace/app.html?app=<id>` в
  `<iframe>` оболонки (у настільному застосунку — в окремому вікні редактора, див. «Ізоляція»), тож його CSS і глобальні змінні не перетинаються з EasyWAR, а
  закриття вивантажує сторінку разом із пам'яттю WASM. `mount` може сам вкласти ще один
  `<iframe>` зі своєю веб-збіркою.
- **Мова.** EasyWAR — лише українською: `host.language === 'uk'`, `host.locale === 'uk-UA'`.
  Усі написи застосунку, які бачить користувач, мають бути українською.
- **Незбережені зміни.** `host.setDirty(true/false)` або `isDirty()` у результаті `mount`.
  Перед закриттям («← Офіс», «Закрити», `Esc`) оболонка показує смугу «Є незбережені
  зміни…» з кнопками «Залишитися» / «Закрити без збереження» (без системних діалогів).
  `host.setTitle(text)` показує назву файлу в смузі оболонки.

### Об'єкт `host`

| Поле | Що робить |
|---|---|
| `contract` | версія контракту оболонки (`1`) |
| `appId` | id застосунку |
| `language`, `locale` | `'uk'`, `'uk-UA'` |
| `desktop` | `true` у застосунку Tauri, `false` у браузері (`vite preview`) |
| `rootUrl`, `resolve(path)` | корінь збірки й адреса файлу відносно нього |
| `openFile({ extensions?, title?, filterName? })` | вікно вибору файла → `{ handle, name, bytes: Uint8Array }` або `null` (скасовано) |
| `saveFile({ handle, bytes })` | «Зберегти» у файл, відкритий чи збережений раніше → `{ handle, name }` |
| `saveFileAs({ bytes, suggestedName?, extensions?, title?, filterName? })` | «Зберегти як…» → `{ handle, name }` або `null` |
| `closeFile(handle)` | застосунок закрив файл; номер більше не приймається |
| `setTitle(text)`, `setDirty(flag)` | назва в смузі оболонки й позначка незбережених змін |

Типові `extensions` і `filterName` беруться з реєстру; застосунок може передати свої
(до 8 розширень, лише латиниця й цифри, без крапки). Перше розширення дописується до назви,
якщо користувач його прибрав. Найбільший файл — 256 МБ.

## Правила відкриття й збереження

- Застосунок **не бачить шляхів**. У Tauri `host` викликає команди
  `office_open_file`, `office_save_file`, `office_save_file_as`, `office_close_file`
  (`src-tauri/src/office_files.rs`, реєстрація в `lib.rs`): шлях лишається в пам'яті Rust
  під непрозорим номером (`handle`), прив'язаним до активного профілю. Без активного
  профілю команди відмовляють.
- **Сире джерело не переписується.** Таблиці, прив'язані до будь-якого профілю, і їхні
  ротовані копії (`*.easywar-prev.xlsx`) ні «Зберегти», ні «Зберегти як…» не перезаписують:
  відкрити таку таблицю можна, а зберегти — лише під іншою назвою.
- Запис атомарний (тимчасовий файл → перейменування). «Зберегти як…» замінює наявний файл
  лише тоді, коли заміну підтвердило системне вікно.
- У браузері без Tauri `openFile` — це `<input type="file">`, а збереження — завантаження
  файлу браузером. Нічого не надсилається в мережу й не пишеться в `localStorage`/IndexedDB.
- Capabilities Tauri і CSP для модуля не змінювалися (`core:default`, CSP `null`). Якщо CSP
  колись посилять, застосункам WASM знадобиться щонайменше `'wasm-unsafe-eval'`.

## Ізоляція редакторів (F-01, T-Office-06)

Стан у гілці `claude/office-isolation` (у `main` ще не злито; до злиття діє ризик F-01, див. нижче):

- **Окреме вікно.** У настільному застосунку картка «Офісу» не відкриває редактор в `<iframe>` головного
  вікна, а викликає `workspace_open_editor` (лише з вікна `main`). Rust створює вікно з міткою
  `office-editor` (`desktop_shell::open_office_editor`) того самого розміру й положення, що й головне,
  на сторінці `workspace/index.html`; скрипт ініціалізації ставить `window.__EW_EDITOR_APP` (лише зі списку
  `office_files::EDITOR_APPS`), і оболонка одразу відкриває застосунок (`shellMode` у `workspace-core.js`).
  «← Офіс» і `Esc` (якщо фокус в оболонці) з підтвердженням незбережених змін викликають
  `office_editor_close`, і вікно закривається; користувач повертається до карток у головному вікні.
  Системна кнопка закриття вікна спершу питає сторінку (`EW_WORKSPACE.requestClose()`); закриття
  головного вікна закриває й редактор. Без Tauri (`vite preview`) усе працює як раніше, в `<iframe>`.
- **Дозволи Tauri.** Усі 78 власних команд перелічено в `src-tauri/build.rs`
  (`tauri_build::AppManifest::commands`): команда, якої немає в capability вікна, для нього заборонена.
  Без цього Tauri дозволяє кожну команду з `generate_handler!` будь-якому вікну.
  `capabilities/default.json` (вікно `main`): `core:default` і всі власні команди, крім файлових команд
  редактора. `capabilities/office-editor.json` (вікно `office-editor`): лише `allow-office-open-file`,
  `allow-office-save-file`, `allow-office-save-file-as`, `allow-office-close-file`, `allow-office-editor-close`;
  жодних `core:*` чи дозволів плагінів (dialog, sql, updater). Інших capability для цих вікон немає.
- **Перевірка в Rust.** Кожна команда `office_*` перевіряє мітку webview, яку дає Tauri, а не JavaScript
  (`office_files::ensure_editor_window`); номер файлу прив'язано до профілю й мітки webview.
- **Що перевірено.** `tests/office-isolation.test.mjs` зіставляє `generate_handler!`, `build.rs` і
  capabilities; `cargo test` — мітки й номери файлів; у справжньому WebKitGTK (tauri-driver, Xvfb,
  `tauri dev`) з вікна редактора й з його `<iframe>` відхилено 13 викликів поза `office_*` (команди EasyWAR,
  `plugin:dialog|open`, `plugin:sql|load`, `plugin:updater|check`, `plugin:event|emit`,
  `plugin:window|close`, `plugin:webview|create_webview_window`), а `office_close_file` пройшов перевірку
  дозволів. Головне вікно не може викликати `office_*`.
- **Не перевірено.** Зібраний застосунок (`tauri://`), WKWebView (macOS), WebView2 (Windows); смуга
  незбережених змін і системна кнопка закриття у вікні редактора; CSP лишається `null` (окреме рішення).

### Ризик F-01 у `main` (до злиття ізоляції)

- `workspace-host.js` (`findInvoke`) шукає `__TAURI_INTERNALS__.invoke` у своєму вікні й до трьох
  батьківських; застосунок працює в `<iframe>` головного вікна без `sandbox`.
- `csp` у `tauri.conf.json` — `null`, а `capabilities/default.json` у `main` не обмежує власних команд, тож
  код стороннього редактора може викликати будь-яку команду EasyWAR. Для користувача в `USER_GUIDE.md` і
  нотатках випуску 2.2.0 — застереження не відкривати в «Офісі» файли з недовірених джерел.

## Вигляд

Оболонку перенесено з макета, специфікація й еталонні знімки — у
[`design/workspace-office/`](design/workspace-office/SPEC.md): токени кольорів (`--interactive-line`,
`--weak` для контрасту 4,5:1), шрифт UAF Sans (`src/fonts/UAFSans.ttf`,
рішення власника замість IBM Plex з макета; дрібні підписи — тим самим шрифтом), власні монохромні іконки (`APP_ICONS` у `workspace-core.js`). Екран
завантаження показує етапи «Завантаження…» (вантажиться `app.js`) → «Підготовка…» (працює
`mount`) → «Готово» (зникає); що відбувається в редакторі після `mount`, показує сам застосунок.
Кольори — темно-синя схема лаунчера з акцентом роду військ (рішення власника 20.10.2026, замість
сіро-золотої з макета). Лаунчер відкриває модуль як `workspace/index.html?branch=<id>`, де `<id>` —
останній відкритий рід військ (`body[data-active-branch]`), до першого — `air`. Оболонка передає
той самий `branch` у `app.html`, обидві сторінки ставлять `html[data-branch]`, а `workspace.css`
підміняє лише `--accent`, `--accent-hover`, `--accent-pressed`: ПС і ПВК — синій, РВ — жовто-оливковий,
Артилерія — бурштиновий, УДШВ — рожево-бордовий. Ключі й типовий рід — `BRANCHES` і
`normalizeBranch` у `workspace-core.js`. Окреме вікно редактора (настільний застосунок, F-01) відкривається без параметра, тому його смуга має типовий синій акцент ПС; передати рід у це вікно потребує зміни `workspace_open_editor` у Rust і лишається в беклозі. Самі редактори (світлі) свої кольори поки не змінюють.
Непідключений застосунок має справжній `disabled`; заглушку «у розробці» видно лише за прямою
адресою `app.html?app=<id>`.

## Файли оболонки

| Файл | Роль |
|---|---|
| `src/workspace-launcher.js`, `.css` | кнопка на стартовому екрані й накладка з `<iframe>` на `workspace/index.html` (без власної смуги); закривається на повідомлення `CLOSE_MESSAGE` від модуля («← На стартову», `Esc` на картках) і перед закриттям питає `EW_WORKSPACE.requestClose()` |
| `src/workspace/index.html`, `workspace.js`, `workspace.css` | оболонка: верхня смуга, розділ «Офіс», картки, смуга застосунку «← Офіс · значок · назва — файл • · Закрити», смуга підтвердження закриття |
| `src/workspace/app.html`, `app-frame.js` | сторінка одного застосунку: «Підготовка редактора…» з етапами, помилка запуску з «Спробувати ще раз», заглушка «у розробці» або `mount(container, host)` |
| `src/workspace/workspace-dom.js` | іконки застосунків (SVG з `APP_ICONS` через `createElementNS`) і стрілка дії картки |
| `src/workspace/workspace-registry.js` | `import.meta.glob('./*/app.js')`: де шукати код застосунків |
| `src/workspace/workspace-core.js` | чиста логіка: реєстр, контракт, параметри вікон, повідомлення між кадрами (тести — `tests/workspace.test.mjs`) |
| `src/workspace/workspace-host.js` | об'єкт `host`: Tauri-команди `office_*` або запасний шлях браузера |
| `src-tauri/src/office_files.rs` | перевірка розширень і розміру, таблиця номерів файлів, захист таблиць профілів |

Legacy HTML (`index.html`, `air.html`, `rocket.html`) для модуля не змінювався. Модуль не є
вибором профілю при реєстрації (як роди військ), тож `local_profiles::MODULES` не змінено:
кнопку бачать усі профілі.
