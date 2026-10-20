# Робоче середовище: розділ «Офіс» і контракт підключення застосунків

Модуль «Робоче середовище» (англійський id `workspace`) відкривається кнопкою **Робоче
середовище** на стартовому екрані. Головна сторінка має дві вкладки: **Офіс** — картки
трьох застосунків — і **Бібліотека** — зашифроване сховище документів профілю (див.
«Бібліотека» нижче). Застосунки «Офісу»:

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
| `pendingFile` | `{ name }` документа бібліотеки, що чекає на перший `openFile` цього вікна редактора, або `null` (у браузері завжди `null`); див. «Бібліотека» |

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
- **Дозволи Tauri.** Усі власні команди (100 на 20.10.2026; число росте з кожною новою командою,
  актуальне — кількість записів у `generate_handler!` у `src-tauri/src/lib.rs`) перелічено в `src-tauri/build.rs`
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

## Бібліотека (T-Office-03, T-Office-04)

Захищене сховище документів профілю: ядро — `src-tauri/src/office_library.rs` (ключі,
шифрування, версії, пошук; див. «Office library» у [DATABASE.md](DATABASE.md)), дані для шаблонів —
`office_sources.rs`, команди `library_*` — `lib.rs`. Сценарії користувача — розділ «Бібліотека»
в [USER_GUIDE.md](USER_GUIDE.md).

- **Вкладки оболонки.** `index.html` має панель вкладок `#ws-tabs` («Офіс», «Бібліотека» з
  лічильником застарілих документів) за шаблоном WAI-ARIA tabs (стрілки, Home/End). У режимі
  вікна редактора вкладок немає. Код бібліотеки (`library.js`) підвантажується динамічним
  `import('./library.js')` лише при першому відкритті вкладки й лише в настільному режимі; у
  браузері (`vite preview`) вкладка пише «Бібліотека доступна лише в застосунку EasyWAR.».
  Vite виносить його в окремий чанк `assets/library-*.js`, який тягне спільний чанк `jszip`.
  Правило `workspace[-/]` у `vite.config.js` цей чанк не ловить, тож офлайн-кеш телефона поки
  його бере (≈80 КБ коду, без даних); щоб виключити, `chunkFileNames` має давати префікс
  `workspace-` і для `src/workspace/library.js`.
- **Команди.** Усі команди бібліотеки дозволені лише головному вікну (`capabilities/default.json`).
  Виклики зібрано в `libraryApi(invoke)` у `library-ui-core.js` з точними назвами й ключами
  контракту; `library.js` сам `invoke` не викликає. `tests/library-ui.test.mjs` розбирає виклики
  в коді й сигнатури `#[tauri::command]` у `src-tauri/src/*.rs`: назва чи ключ, яких Rust не приймає,
  ламає тест (необов'язковий параметр Rust поза контрактом, як `include_hidden` у `library_search`,
  допустимий).
- **Блокування.** Будь-яка помилка, що починається з «бібліотека заблокована» (`isLockedError`),
  повертає вкладку до екрана розблокування з поясненням (30 хвилин без дій, вихід із профілю,
  закриття «Робочого середовища»). У головному вікні `pagehide` сторінки `workspace/index.html`
  викликає `library_lock` (без очікування відповіді).
- **Створення з шаблону** (`generateDocument` у `library-ui-core.js`): `library_read_version`
  (байти шаблону, `ArrayBuffer`) → `library_source_data` → `buildContext` (`field-dictionary-core.js`)
  → `fillTemplate(…, { JSZip })` (`template-core.js`) → `library_save_generated` з байтами масивом
  чисел і відбитком джерела. «Оновити з джерела» робить те саме для пов'язаного документа з його
  параметрами; нова версія стає поточною лише тоді, коли поточна не має ручних правок
  (`shouldMakeCurrent`). «Оновити всі» йде за `regenerationPlan` і завершується `summarizeBulk`.
- **Документ бібліотеки в редакторі.** `library_open_in_editor({ versionId })` відкриває вікно
  редактора застосунку документа й лишає документ «очікуваним»: скрипт ініціалізації вікна ставить
  `window.__EW_PENDING_FILE` (назва рядком або `null`), а перший `office_open_file` цього застосунку
  повертає документ без вікна вибору. Номер такого файлу прив'язано до профілю, мітки вікна й
  документа бібліотеки: `office_save_file` записує нову версію (походження «Ручні правки», якщо
  відкрита версія згенерована чи вже з правками, інакше «Збережено»; нова версія стає поточною), а при заблокованій бібліотеці
  відмовляє з «бібліотека заблокована…»; `office_close_file` забуває й такі номери. Очікування
  знімається, коли документ узято, коли вікно редактора закрито й при блокуванні.
- **`host.pendingFile`.** `workspace-host.js` (`findPendingFile`) шукає `__EW_PENDING_FILE` у своєму
  вікні й до трьох батьківських (як `findInvoke`, лише того самого походження), `parsePendingFile`
  (`workspace-core.js`) прибирає керівні символи й символи зміни напрямку тексту й обрізає назву до
  200 символів. EasyGreen після `gridcraft:ready` сам викликає свій шлях відкриття
  (`openIntoFrame` у `easygreen/easygreen-core.js`). Веб-збірки EasyDoc і EasySlide не змінювали:
  оболонка у вікні редактора показує смугу ««<назва>» з бібліотеки: натисніть «Відкрити…» у
  редакторі — файл відкриється без вибору.» (`pendingFileNotice`).
- **Видалення профілю.** `delete_local_profile` для профілю з бібліотекою відмовляє текстом
  «у профілю є захищена бібліотека; …». Вікно «Профілі» (`local-profiles.js`,
  `deleteProfileWithLibraryFallback` у `local-profiles-core.js`) тоді пропонує «Видалити профіль
  разом з бібліотекою» з введенням імені профілю й порадою спершу зберегти архів і викликає
  `delete_local_profile_with_library({ profileId })`.
- **Резервні копії.** Бібліотека лежить у `easywar.db`, тож потрапляє в кожну копію; вікно
  «Резервна копія» про це попереджає (`LIBRARY_BACKUP_NOTE`, `LIBRARY_RESTORE_NOTE` у
  `backup-core.js`), докладно — [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
- **Перевірено.** `tests/library-ui.test.mjs` (контракт викликів, звірка з Rust, екрани, форми,
  створення з синтетичного DOCX, «Оновити з джерела», «Оновити всі»), `tests/workspace.test.mjs`
  (`pendingFile`, обхід кадрів, `ArrayBuffer` з іншого кадру, текстові контракти оболонки),
  `tests/easygreen-core.test.mjs` (автовідкриття з підробленим `host`),
  `tests/local-profiles.test.mjs`, `tests/backup.test.mjs`; вкладка в Chromium (`vite preview`) з
  підробленим `invoke`. **Не перевірено**: справжній Tauri (WebKitGTK, WKWebView, WebView2), Argon2id
  з виробничими параметрами в інтерфейсі, екран входу з кодом відновлення (його ще немає).

## Файли оболонки

| Файл | Роль |
|---|---|
| `src/workspace-launcher.js`, `.css` | кнопка на стартовому екрані й накладка з `<iframe>` на `workspace/index.html`; перед закриттям питає `EW_WORKSPACE.requestClose()` |
| `src/workspace/index.html`, `workspace.js`, `workspace.css` | оболонка: вкладки «Офіс» і «Бібліотека», картки, смуга застосунку з «← Офіс», підтвердження закриття, смуга про файл з бібліотеки |
| `src/workspace/library.js` | вкладка «Бібліотека» (окремий чанк): екрани створення, розблокування, відновлення, список, історія версій, створення з шаблону, застарілі документи |
| `src/workspace/library-ui-core.js` | чиста логіка вкладки: виклики `library_*` (`libraryApi`), перевірки форм, параметри джерел, створення й оновлення документів (тести — `tests/library-ui.test.mjs`) |
| `src/workspace/library-core.js`, `template-core.js`, `field-dictionary-core.js` | підписи, план «Оновити всі»; заповнення шаблонів DOCX/PPTX/XLSX; словник полів джерел |
| `src/workspace/app.html`, `app-frame.js` | сторінка одного застосунку: заглушка «у розробці» або `mount(container, host)` |
| `src/workspace/workspace-registry.js` | `import.meta.glob('./*/app.js')`: де шукати код застосунків |
| `src/workspace/workspace-core.js` | чиста логіка: реєстр, контракт, параметри вікон, повідомлення між кадрами (тести — `tests/workspace.test.mjs`) |
| `src/workspace/workspace-host.js` | об'єкт `host`: Tauri-команди `office_*` або запасний шлях браузера, `pendingFile` |
| `src-tauri/src/office_files.rs` | перевірка розширень і розміру, таблиця номерів файлів (і документів бібліотеки), захист таблиць профілів |
| `src-tauri/src/office_library.rs`, `office_sources.rs` | ядро бібліотеки; дані джерел для шаблонів і їхні відбитки |

Legacy HTML (`index.html`, `air.html`, `rocket.html`) для модуля не змінювався. Модуль не є
вибором профілю при реєстрації (як роди військ), тож `local_profiles::MODULES` не змінено:
кнопку бачать усі профілі.
