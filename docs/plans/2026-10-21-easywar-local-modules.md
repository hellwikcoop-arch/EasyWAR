# EasyWAR Local Modules Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Побудувати універсальний конструктор поверх спільних локальних джерел, зберігши імпорт, виправлення, старі модулі та файли користувача.

**Architecture:** `DataSource → ColumnBinding → ModuleDefinition → ModuleInstance → DashboardPlacement`. Наявні `dashboard_data_<hex>` підключаються адаптером; нова копія картки не створює окремий набір робочих рядків.

**Tech Stack:** Чисті JS `*-core.js`, наявні HTML/CSS, Rust/sqlx/SQLite, Node test runner.

## Global Constraints

Усі обмеження [головного ROADMAP](2026-10-21-easywar-codex-roadmap.md) діють тут. База: `dba28417cd0e54b89c8db87d52cd8ec34d9df0f1`. Нові файли й інтерфейси нижче — **пропоновані**; існуючі названі як «змінити». E1+ потребують дозволу власника; цей файл його не надає.

## Перевірки й спільний контракт

Команди виконуються з кореня EasyWAR:

```bash
npm run test:unit
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --all-features --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Для JS-коду чинний workflow вимагає повний `test:unit`, навіть якщо перед ним є вузький тест. Для Rust — усі три Rust-команди. Для міграцій додатково тести clean/upgrade/restart і документація бази. Запуск UI на підтримуваній ОС не замінюється перевіркою тексту файлів.

Пропоновані спільні структури:

- `DataSourceRef { sourceId, profileId, sourceKind, confirmedRevision, schemaVersion }`.
- `ColumnBinding { sourceId, schemaVersion, bindings, confirmedBy }`, де елемент `bindings` зберігає стабільний ID стовпця, смислову роль та одиницю, якщо вона визначена користувачем.
- `ModuleDefinition { definitionId, version, requirements, rendererKey, branchTags }`.
- `ModuleInstance { instanceId, definitionId, sourceId, filters, period, style }`.
- `DashboardPlacement { profileId, dashboardId, instanceId, position, size }`.
- `SourceRead { revision, completeness, rows, provenance }`: `completeness` явно відрізняє повне, часткове й невдале читання.
- `Preview { baseRevision, candidateRevision, added, changed, missing, ambiguous }`: застосовується лише до тієї `baseRevision`, яку користувач переглянув.

Типи, допустимі агрегації та правила полів брати з визначення конкретного модуля. Не вигадувати загальних обов'язкових полів чи нових автоматичних перетворень значень.

### L0. Узгодити актуальний стан документації

**Файли:** змінити `docs/PROJECT_CONTEXT.md`, `docs/BACKLOG.md`, `docs/ROADMAP.md`, `docs/MODULES_ROADMAP.md`, `docs/COLLECTIVES_PLAN.md`; читати `src-tauri/build.rs`, capabilities, список міграцій, `package.json`.  
**Вхід:** поточний HEAD і D/O-таблиці головного плану. **Вихід:** точний статус «існує / тестовано / прийнято / відкрите рішення». Залежність: немає.

- [ ] Звірити суперечності: 2.1.1/2.2.0; ACL «немає» проти AppManifest; F-01 «не злито» проти наявного коду; міграції 0010–0011 проти 0016; старий milestone 1.1 проти існуючих PPTX/PDF.
- [ ] Не ставити «закрито» лише за наявністю функції: залишити macOS/Windows/live Signal окремими перевірками.
- [ ] Перенести ціль до 100 учасників із відповіді власника; відділити її від погоджених показників швидкості, яких немає.
- [ ] Зберегти E1-hold, точний статус Q12/Q13/К3. Не замінювати акаунт локальним профілем без рішення O12.
- [ ] Перевірити відносні посилання, індекс довідки та його наявні тести, якщо ці документи в нього включені. Якщо актуальна довідка генерується, використати процедуру з `docs/ASSISTANT.md`.
- [ ] Коміт: `docs: reconcile current implementation and decision status`.

**Приймання:** для кожної зміненої позначки є шлях/коміт чи доказ тесту; не додано фіктивних результатів CI.

### L1. E1 — повний реєстр визначень і залежностей

**Файли:** змінити `src/catalog-core.js`, `src/dashboard-module-catalog-core.js`, `src-tauri/src/dashboard_modules.rs` лише за потреби адаптера; створити `src/module-definition-core.js`, `tests/module-definition.test.mjs`, `docs/MODULE_DEFINITIONS.md`.  
**Інтерфейси:** `listDefinitions(catalogV1, rustTemplates, legacyDescriptors) → ModuleDefinition[]`; `requirementsFor(definitionId) → requirements`; `dependentsOf(columnRole) → definitionId[]`. Залежність: L0 та O01.

- [ ] Додати тести: кожне визначення має унікальний ID; кожна вимога посилається на відому роль; шість KPI ПС — шість визначень; Office-застосунки не є віджетами.
- [ ] Вузька команда: `node --test tests/module-definition.test.mjs`. До реалізації очікується відсутній реєстр або неповне покриття.
- [ ] Інвентаризувати фактичні блоки ПС, РВ, ПВК, УДШВ, «Наші втрати» та нинішні Rust-шаблони. Не зафіксовувати кількість 26 як незмінну вимогу: звірити актуальний `catalog()`.
- [ ] Зберегти походження опису: sourceCatalog, sourceId, definitionVersion. Новий файл є узгоджувальним адаптером, не третім незалежним вручну підтримуваним каталогом. Тест ловить розходження з обома джерелами.
- [ ] Запустити вузький тест і `npm run test:unit`; якщо змінено Rust — Rust-перевірки. UI й дані не переносити в цій задачі.
- [ ] Коміт: `feat: add reconciled module definition registry`.

**Приймання:** повний перелік з обчисленнями, ролями, місцем використання й тестом сумісності; граф залежностей відтворюється з реєстру.

### L2. E2 — один спільний блок без зміни результату

**Файли:** змінити `src/pvk-dashboard-core.js`, `src/pvk-dashboard.js`; створити `src/module-adapters/pvk-summary-core.js`, `tests/module-adapter-pvk.test.mjs`; торкатися іншого дашборда лише наступним окремим комітом.  
**Інтерфейси:** `buildPvkSummary({ rows, period, bindings }) → SummaryView`; старий UI та новий adapter споживають однакову модель. Залежність: L1.

- [ ] Взяти один інвентаризований простий підсумок ПВК; зафіксувати синтетичні входи й фактичні виходи до переносу. Не придумувати нову формулу.
- [ ] Тести: порожні дані, період з граничними датами, відсутнє необов'язкове поле, значення нуль, невідомий результат без автоматичного домислення.
- [ ] Команда `node --test tests/module-adapter-pvk.test.mjs tests/pvk-dashboard.test.mjs`; новий виклик має спочатку провалитися як ще не підключений.
- [ ] Винести тільки обчислення вибраного блока; старий renderer отримує ту саму модель. Зняти до/після на однакових даних, розмірі й темі; пояснити будь-яку різницю.
- [ ] Вузькі тести → `npm run test:unit` → `npm run build`; перевірка старої вкладки у UI.
- [ ] Коміт: `refactor: share verified pvk summary calculation`.

**Приймання:** старий екран і бібліотечний виклик дають однаковий результат. Аналогічні переноси УДШВ/втрат/ПС/РВ — окремі повторення цього контракту зі своїми тестами, а не один масовий diff.

### L3. E3 — стабільне локальне джерело й підтверджені зіставлення

**Файли:** створити `src/data-source-core.js`, `src-tauri/src/data_sources.rs`, `tests/data-source.test.mjs`, нову append-only міграцію (пропонована на базовому SHA `src-tauri/migrations/0017_universal_sources.sql`); змінити `module_source.rs`, `dashboard_modules.rs`, `lib.rs`, `build.rs`, main capability, `docs/DATABASE.md`, `migrations/README.md`.  
**Інтерфейси:** `registerSource(profileId, descriptor) → DataSourceRef`; `confirmBindings(sourceId, expectedSchemaVersion, bindings) → ColumnBinding`; `readSource(profileId, sourceId, revision, page) → SourceRead`. Залежність: L2, дозвіл міграції в завданні.

- [ ] Тести: переставлені/перейменовані стовпці; невідомий заголовок не підтверджується сам; перезапуск/оновлення шаблону зберігає вибір; профіль B не читає source A.
- [ ] `node --test tests/data-source.test.mjs`; Rust-тести модуля `data_sources::tests` через `cargo test --locked --manifest-path src-tauri/Cargo.toml data_sources::tests`. Спочатку інтерфейс/схема відсутні.
- [ ] Спершу один адаптер: наявна таблиця модуля SQLite. XLSX вводити як версійний read-only snapshot через наявний inspector, не як live-перезапис файла.
- [ ] Відділити profile bindings/order/labels від полів Rust-шаблону. Читання `synchronize_template_schema` не повинно стирати ці дані. `row_id` не вважати ключем XLSX.
- [ ] Clean/upgrade/restart перевірки міграції з поточного 0016; помилка → відкат транзакції, попередні джерела/виправлення лишаються доступними. Номер 0017 перерахувати перед реалізацією, якщо зайнятий.
- [ ] Вузькі тести → усі перевірки шару → коміт `feat: persist versioned local data sources and bindings`.

**Приймання:** один стабільний source ID, незмінний оригінал, підтверджені зіставлення переживають перезапуск; чинні `dashboard_data_*` не видаляються.

### L4. Контрольна точка — спільне джерело, екземпляри й повторний імпорт

**Файли:** створити `src/dashboard-instance-core.js`, `src/source-reimport-core.js`, `src-tauri/src/dashboard_instances.rs`, `tests/dashboard-instance.test.mjs`, `tests/source-reimport.test.mjs`; змінити `dashboard-module-catalog.js`, `dashboard-module-catalog-core.js`, `data_sources.rs` та потрібні IPC/міграції за правилами L3.  
**Інтерфейси:** `createInstance(profileId, definitionId, sourceId, settings)`; `previewReimport(sourceId, candidate, rowIdentityRule) → Preview`; `applyReimport(sourceId, preview, expectedRevision) → confirmedRevision`; `queryModule(instanceId, sourceRevision, effectiveFilters) → boundedView`. Залежність: L3.

- [ ] Тести: одна таблиця/два визначення; дві копії одного визначення з різними періодами; 5-та копія відхиляється з поясненням; прибирання placement не видаляє source.
- [ ] Імпорт: reorder рядків не нові записи; duplicate/missing key → ambiguous; зниклий рядок показано, але не видалено мовчки; змінена база після preview → stale, потрібен новий preview.
- [ ] Виправлення: незмінний raw зберігає ручну правку; зміна raw у виправленій клітинці показує конфлікт; рішення людини й нова ревізія зберігаються окремо.
- [ ] Вузько: `node --test tests/dashboard-instance.test.mjs tests/source-reimport.test.mjs`, потім Rust `data_sources::tests`/`dashboard_instances::tests`. Спочатку відсутня незалежна модель placement/revision.
- [ ] Реалізувати транзакційне застосування preview. Список карток читає metadata + агрегати, повні рядки лише відкритій таблиці. Кожний async-result прив'язаний до профілю/revision; результат після logout ігнорується.
- [ ] Показувати окремо loading/error/stale/partial/«Немає даних». Partial/error не можна зберегти як порожнє повне джерело. Пропоновану межу 10 000 не прибирати без сторінкового читання.
- [ ] Вузькі й повні перевірки шару, UI сценарій → коміт `feat: add shared-source dashboard instances and reviewed reimport`.

**Приймання:** M1 із головного ROADMAP. Періоди «тиждень/місяць» мають отримати точне значення меж і часової зони перед новим глобальним обчисленням; до того зберігати підтверджену семантику адаптера.

### L5. E3б — зв'язати кілька таблиць без прихованого множення рядків

**Файли:** створити `src/table-links-core.js`, `src/table-links.js`, `src-tauri/src/table_links.rs`, `tests/table-links.test.mjs`; змінити `data_sources.rs` та міграції/IPC у межах задачі.  
**Інтерфейси:** `suggestLinks(sources) → candidates`; `previewLink({ sourceRevisions, confirmedKey, mode }) → LinkPreview`; `applyLink(preview, resolutions) → derivedSourceOrLink`. Залежність: L4.

- [ ] Тести: унікальний ключ, дублікати ключа з обох сторін, різні значення, порожній ключ, різні дати, неповна пара. Кандидат ніколи не стає підтвердженим сам.
- [ ] `node --test tests/table-links.test.mjs` → очікуваний провал нового preview; Rust `table_links::tests`.
- [ ] Preview показує кардинальність та конфлікти; без рішення не множить рядки й не обирає «останнє значення». Невизначений тип join/поведінку unmatched уточнити перед застосуванням, зберегти в LinkSpec.
- [ ] Реалізувати три обрані режими: залишити зв'язок; створити об'єднане локальне джерело; сформувати групи по ключах. Прив'язати результат до версій обох джерел і провенансу.
- [ ] Видалення зв'язку показує залежні модулі; підтверджений вибір дозволено виконати. Наявні вихідні файли залишаються історичними джерелами.
- [ ] Тести шару й UI → коміт `feat: add reviewed table linking and merge previews`.

### L6. E5 — розширити схему й завантажити нову таблицю

**Файли:** змінити `src/catalog-core.js` (`deriveTable`), `dashboard-module-catalog.js`, `src-tauri/src/xlsx_export.rs`; створити `src/profile-schema-core.js`, `tests/profile-schema.test.mjs`; використати `data_sources.rs` для профільної схеми.  
**Інтерфейси:** `previewSchemaExtension(sourceId, definitionId, target) → SchemaDiff`; `acceptSchemaExtension(diff, expectedSchemaVersion)`; `exportSchemaCopy(sourceId, revision, destination) → newFile`. Залежність: L4; L5 не обов'язкова для однієї таблиці.

- [ ] Тести: доступний модуль не додає дубль стовпця; недоступний називає брак; користувач обирає основну/окрему таблицю; cancel нічого не змінює.
- [ ] `node --test tests/profile-schema.test.mjs tests/catalog-core.test.mjs`; Rust-тест експорту синтетичної книги з формулами/кількома аркушами.
- [ ] Прийнятий diff змінює схему профілю. «Скачати таблицю» створює новий XLSX; якщо destination уже існує, вимагати іншої назви або явної процедури перезапису за чинним exporter contract.
- [ ] Непідтримувані елементи книги не губити мовчки: показати обмеження й не видавати результат за точну копію. Діапазони/формули/validation перевірити повторним відкриттям у Excel/LibreOffice.
- [ ] Після прибирання модуля стовпець з даними лишається; видалення стовпця — окремий preview залежностей і рішення людини.
- [ ] Перевірки шару → коміт `feat: extend profile schemas with explicit xlsx copy export`.

### L7. E4/E6 — фільтри, персоналізація й решта видів

**Файли:** змінити `dashboard-module-charts-core.js`, `dashboard-module-charts.js`, `dashboard-module-catalog-core.js`, `dashboard-module-catalog.js`, Rust `catalog()`; створити `src/dashboard-filter-core.js`, `src/dashboard-personalization-core.js`, `tests/dashboard-filter.test.mjs`, `tests/dashboard-personalization.test.mjs`.  
**Інтерфейси:** `resolveFilters(global, instance, selectionPolicy) → EffectiveFilters`; `buildPersonalization(definition, dataView) → view`; `nextCarouselItem(state, event) → state`. Залежність: L4, O18; повний перелік типів персоналізації погоджувати окремо.

- [ ] Фільтри: усі чотири періоди; власний період перевизначає лише часову частину; одна смислова роль передає selection, інша — ні; без дати → «Не залежить від періоду»; чип скидання.
- [ ] Персоналізація: live-число лише з джерела; static-текст не маскується під обчислений показник; карусель вручну/60 секунд/auto off; порожній список, видалення активного елемента, вихід з профілю.
- [ ] `node --test tests/dashboard-filter.test.mjs tests/dashboard-personalization.test.mjs tests/dashboard-module-charts.test.mjs`; спочатку відсутня нова поведінка.
- [ ] Додавати pivot/histogram/timeline/варіанти dynamics окремими незалежно проходячими комітами. Calendar уже існує; gauge не видаляти, але не розширювати як новий пріоритет. Для кожного виду виконати точний checklist `AGENTS.md` (BUILDERS/RENDERERS/VISUAL_KINDS/catalog/sampleRows/tests).
- [ ] Рекомендація: малювати лише активний елемент каруселі, поважати reduced motion і клавіатуру. Це технічна рекомендація, не новий затверджений тип модуля.
- [ ] Перевірки шару, обидві теми, keyboard/zoom/resize → коміти по виду, фінальний `feat: complete dashboard filters and personalization`.

### L8. E7 — поступовий перехід старих дашбордів

**Файли:** змінити `src/pvk-dashboard*.js`, `src/udshv-dashboard*.js`, `src/own-losses-dashboard*.js`, пізніше вузькі ділянки `src/air.html`/`src/rocket.html`; використати `dashboard_instances.rs`; тести відповідних старих модулів.  
**Інтерфейси:** `previewLegacyLayout(profileId, branch, legacyLayout) → placements`; `acceptLegacyLayout(preview)`; адаптер викликає спільне визначення L1. Залежність: L4, потрібні блоки L2/L7.

- [ ] Тести з точними файлами: `tests/pvk-dashboard.test.mjs`, `tests/udshv-dashboard.test.mjs`, `tests/own-losses-dashboard.test.mjs`, `tests/desktop-frontend.test.mjs`: результат до/після, повторна міграція, два профілі, пошкоджений старий layout.
- [ ] Перенесення layout ідемпотентне, не вгадує власника старого `localStorage` між профілями. Якщо походження неясне — запропонувати імпорт, не прив'язувати мовчки.
- [ ] По одному блоку замінювати виклик, зберігати старий шлях як контроль до приймання; резервна копія й bounded stripped copy для legacy HTML обов'язкові.
- [ ] Порівняти числові результати та скриншоти однакових синтетичних даних; невідповідність означає незавершений перенос.
- [ ] Тести JS, синтаксис кожного inline-скрипта зміненого HTML, build, нативний smoke → коміт по перенесеному блоку.

## Відкриті рішення цього плану

O01, O18–O20 головного ROADMAP; повний перелік персоналізації. Вони не є дозволом змінювати формули чи нормалізувати поля за власним розсудом.
