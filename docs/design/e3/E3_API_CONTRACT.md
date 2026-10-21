# E3-П: контракти Rust / JS (проєкт)

**Стан:** інтерфейси для рецензії; жодну команду не додано до `generate_handler!` або capabilities. Назви й типи нижче не є чинним API.

## 1. Обов'язкові інваріанти

- Кожна команда бере власника з `ProfileSession`, а не довіряє `profileId` із JS. Усі SELECT/UPDATE містять `profile_id = active_profile_id`; для `module_sqlite` Rust перевіряє `dashboard_modules.profile_id`. Чужий ID повертає однаковий `NotFound`, без метаданих. Сеанс входу/вікно перевіряються для preview selection як нині в `module_source_selection.rs`.
- Frontend не передає абсолютний шлях у create/read. `linked_xlsx` створюється лише з наявного `local_profile_tables` та чинного selection token. `picked` лишається preview, поки користувач явно не прив'яже файл до профілю.
- Rust повторно читає/хешує джерело перед commit; fingerprint, ділянку, шапку, індекси колонок і повноту звіряє із запитом. JS-типи й кандидати ролей — підказки, не довіра. Жодна невідома одиниця, суперечлива роль або частковий аркуш не набуває статусу `ready` автоматично.
- Усі зміни з `expectedDataVersion` + `expectedSchemaVersion` і `idempotencyKey` (непрозорий UUID випадкового запиту). Повтор із тим самим ключем повертає той самий результат або контрольований `AlreadyApplied`; інший вміст під тим самим ключем — помилка. Механізм дедуплікації запитів у БД є окремим питанням JE; без нього клієнт повторно читає після невідомого результату, перш ніж надсилати зміну.
- Схема `definitionId`/`fieldKey`/`role` бере E1 `listDefinitions()` та чинний Rust-каталог. Rust має перевіряти signature авторитетного **генерованого з E1** manifest; це не третій вручну підтримуваний каталог. Якщо manifest ще не погоджено/реалізовано, persist/`ready` для визначень, яких Rust не може перевірити, відкласти; показати preview з причиною.

## 2. DTO

```ts
type DataSourceKind = 'linked_xlsx' | 'module_sqlite';
type Availability = 'complete' | 'partial' | 'unavailable' | 'stale';
type Version = number; // монотонна в межах sourceId; 0 = ще немає знімка

type DataSourceSummary = {
  sourceId: string; kind: DataSourceKind; availability: Availability;
  dataVersion: Version; schemaVersion: Version;
  sourceLabel: string; // без повного шляху
  selectedSheet?: string; rowCount: number | null; truncated: boolean;
  needsReconfirmation: boolean; reasonCodes: string[];
};
type RowOrigin = {
  sourceId: string; dataVersion: Version; sheetIndex?: number;
  regionStart?: number; sourceRowNumber?: number;
  moduleId?: string; rowId?: number;
};
type ColumnOrigin = { columnId: string; physicalIndex: number; originalHeader: string };
type ConfirmedBinding = {
  sourceId: string; schemaVersion: Version; definitionId: string;
  fieldKey: string; columnId: string; role: string;
  dataType: string; unit: string | null; aggregation: string;
  nullRule: 'skip' | 'zero' | 'error' | 'keep_null';
  definitionSignature: string; confirmationState: 'confirmed' | 'needs_reconfirmation';
  confirmedAt: string;
};
type SourceRead = {
  source: DataSourceSummary; sourceVersionToken: string;
  workbook: { sheets: Array<{ name: string; rows: Array<{ number: number; cells: unknown[] }>; truncated: boolean; rowCount?: number }> };
  originByRow: RowOrigin[]; // співвідноситься з прочитаними рядками
  selectedRegion: { sheetIndex: number; firstRow: number; lastRow: number | null; headerRow: number } | null;
  confirmations: { header: 'confirmed' | 'needs_confirmation'; boundaries: 'confirmed' | 'needs_confirmation'; bindings: ConfirmedBinding[] };
  warnings: string[];
};
```

`sourceVersionToken` для `profileSource()` — детермінований серіалізований токен `(dataVersion, contentSha256, schemaVersion)`, сформований Rust, а не filename чи preview ID. Повний SHA може лишатися в Rust; JS отримує достатній непрозорий токен. `sourceId + sourceVersionToken` дає відтворюваний recommendation ID для того самого підтвердженого стану. Ідентичність майбутнього екземпляра модуля створюється окремо E4.

## 3. Запропоновані Tauri-команди (після окремого дозволу)

| Команда | Вхід | Вихід | Запис / помилка |
|---|---|---|---|
| `list_data_sources()` | без `profileId` | `DataSourceSummary[]` | Лише читання, scoped active profile. |
| `get_data_source(sourceId)` | ID | `DataSourceSummary` + остання схема/історія | `NotFound` для чужого ID. |
| `inspect_data_source(sourceId)` | ID, опційно `expectedDataVersion` | `SourceRead` | Читає локально; якщо інший вміст, повертає `StaleSource` + нову кандидатну версію, не змінює binding. |
| `create_data_source(request)` | `selectionToken`, `kind`, `linkedBranch` або `moduleId`, підтверджені координати, `expectedDigest`, `idempotencyKey` | `DataSourceSummary` + `SourceRead` | Одна транзакція після повторної перевірки; заборонено довільний шлях і preview ID як source ID. |
| `confirm_source_schema(request)` | `sourceId`, expected версії, окремі `headerRow`, `boundaryDecisions`, обрана ділянка, `idempotencyKey` | новий `schemaVersion`, `SourceRead` | Шапка й межі підтверджуються незалежно; неоднозначна/часткова ділянка не стає ready. |
| `confirm_column_binding(request)` | `sourceId`, expected версії, `definitionId`, `fieldKey`, `columnId`, `role`, тип, одиниця, агрегація, `nullRule`, manifest signature, `idempotencyKey` | нова версія схеми + `ConfirmedBinding` | Перевірка фізичної колонки, E1-ролі й одиниці; одна зміна = новий знімок + event. |
| `revise_profile_schema(request)` | expected версії, новий підпис/порядок/вибір джерела або явне відкликання binding | нова версія схеми | Не переписує старий знімок; при зміні фізичної схеми переносить лише сумісні binding, інші `needs_reconfirmation`. |
| `refresh_data_source(sourceId, expectedDataVersion)` | ID + версія | стан/нова версія/список конфліктів | Локальна перевірка; не переписує XLSX і не переносить рядки. |

`create_data_source` першої реалізації підтримує `linked_xlsx` і одну ділянку; `module_sqlite` проєктується у схемі й читається після окремого маленького адаптера. Для `module_sqlite` результат ніколи не читає довільне ім'я таблиці з JS: Rust знаходить перевірений `dashboard_modules.storage_table` за ID/профілем і використовує чинний валідатор ідентифікатора.

Помилки з кодами: `ProfileRequired`, `NotFound`, `InvalidSelection`, `SourceChanged`, `PartialRead`, `InvalidBoundary`, `InvalidHeader`, `InvalidColumn`, `AmbiguousRole`, `IncompatibleUnit`, `UnknownDefinition`, `SchemaIncompatible`, `VersionConflict`, `UnsupportedSchema`, `StorageFailure`. Жодна помилка не повертає шлях іншого профілю або операційні значення. `VersionConflict` повертає лише поточні номери/стан, після чого UI перечитує.

## 4. JS-послідовність з прийнятим рушієм

```js
// Preview: selection існує лише у поточному сеансі; це не persisted source.
const preview = profileSource(workbook); // previewOnly === true
const previewBindings = proposeBindings(preview, { rustTemplates, catalogs });
// UI окремо питає про sheet/region/header, потім про кожну роль/одиницю.
// Rust повторно перевіряє файл та атомарно зберігає підтверджені рішення.
const saved = await invoke('create_data_source', { request: confirmedRequest });
const inspected = await invoke('inspect_data_source', { sourceId: saved.sourceId });
const profile = profileSource(inspected.workbook, {
  sourceId: saved.sourceId, sourceVersion: inspected.sourceVersionToken,
  headerConfirmations: storedHeadersFor(profileKey(saved, inspected)),
  boundaryConfirmations: storedBoundariesFor(profileKey(saved, inspected)),
});
const suggestions = recommend(profile, listDefinitions({ rustTemplates, catalogs }), {
  rustTemplates, catalogs, confirmations: storedBindingsFor(profile.sourceKey, inspected),
});
```

Це **ілюстрація майбутньої інтеграції**, не готові функції UI. Адаптер `stored*For()` має перетворити збережені координати/ID на чинний `sourceKey`; він відкидає binding, якщо `schemaVersion`, фізичний fingerprint, E1 signature, поле, тип або одиниця не збігаються. Рішення header не підміняє binding; рішення boundary не підміняє header. При двох таблицях на аркуші UI показує пояснення split/join; лише вибрана й підтверджена ділянка йде в E3. Порожні внутрішні рядки лишаються у coverage як прогалини номерів.

`recommend()` уже позначає `previewOnly`, `readiness`, `warnings`, `variantsIncomplete`. Інтегратор знижує `ready` до `needs_confirmation`, коли `availability != complete`, непідтверджена шапка/межа, застарілий binding, неоднозначна одиниця або неповне читання. Обрізані таблиці показуються з явним числом прочитаних рядків і невідомим повним підсумком; відсутні дані не видаються за нулі.

## 5. Транзакції й перевірка перед записом

1. Зовні транзакції відкрити локальне джерело через чинний selection/профільний шлях, перевірити ZIP-ліміти, SHA-256 і coverage. Не утримувати SQLite write-lock під час довгого парсингу XLSX.
2. Почати `BEGIN IMMEDIATE` (або еквівалентний write-lock через SQLx). Першим DML зробити `UPDATE e3_data_sources SET current_* = … WHERE id = ? AND profile_id = ? AND current_data_version = ? AND current_schema_version = ?`; для створення спершу `INSERT` з унікальним ID. Якщо 0 рядків — rollback і `VersionConflict`.
3. У тій самій транзакції перевірити джерело/власника/manifest, записати `e3_source_versions` за потреби, цілий новий `e3_profile_schema_versions` із колонками/binding, event, потім current pointer. Для однієї дії — один commit. Відкритий файл між кроками міг змінитися: перед commit звірити локатор і digest із зафіксованим; якщо змінено — rollback, новий огляд.
4. Після commit знову прочитати актуальний summary. При аварії до commit SQLite відкотить транзакцію; після commit повторний запит має перечитати або використати ідемпотентний ключ. Не створювати окрему таблицю даних модуля у цій транзакції.

Нинішній `dashboard_modules.replace_rows()` застосовує CAS за `updated_at`; E3 використовує окремі монотонні integer-версії, щоб не покладатися лише на однакові часові мітки. Наявний SQL-режим не змінюється; прямий SQL-доступ користувача до його локальної БД не є межею ізоляції профілів, тому гарантія E3 стосується Rust-команд застосунку та FK/тригерів, а не довільного ручного SQL.
