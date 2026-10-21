# E3-П: синтетична матриця приймання

**Стан:** план тестів, жоден із них цим пакетом не виконано на продуктивній БД. Усі XLSX/SQLite фікстури генеруються в тимчасовому каталозі з вигаданими назвами й значеннями. `R` = майбутній Rust unit/integration test, `J` = Node test рушія/адаптера, `S` = SQLite migration/startup/restore test, `UI` = локальний сценарій у Tauri на синтетичному профілі. Для кожного сценарію перевіряти відсутність змін вхідного XLSX (SHA-256 до/після) там, де він є.

| № | Підготовка | Очікувана поведінка | Потрібний тест | Критерій приймання |
|---:|---|---|---|---|
| 1 | Нова синтетична БД 17, профіль без таблиць. | Список джерел порожній; `recommend()` нічого не створює. | R `empty_profile_sources`; UI порожній стан. | 0 `e3_data_sources`, 0 `dashboard_modules`; без помилок. |
| 2 | Профіль із прив'язаним одноаркушевим XLSX, явна шапка/межі/ролі. | Сталий `sourceId`, data/schema v1, файл незмінний. | R `link_one_xlsx`; J preview→persisted. | Перезапуск повертає той самий ID/підтвердження; SHA файла однаковий. |
| 3 | Одне підтверджене джерело, дві різні E1-рекомендації. | Обидві посилаються на той самий `sourceId`; рядки не копіюються. | R `shared_source_two_consumers`; J рекомендації. | Рівно один source, жодної нової `dashboard_data_*`, два DTO з одним ID. |
| 4 | У шапці дві колонки «Кількість», різні позиції. | `c1`/`c2` окремі, потрібне точне підтвердження поля. | J `duplicate_headers`; R `binding_physical_index`. | Жодне підтвердження не переходить на сусідню колонку. |
| 5 | Невідомий заголовок і числова вибірка. | Роль лише запропонована, не записана як confirmed. | J `unknown_header`; R `reject_unconfirmed_role`. | Немає `ready`/binding без вибору користувача. |
| 6 | Один псевдонім має дві E1 ролі та Rust field collision. | Усі альтернативи з provenance видимі; підтвердження точне за source/column/field. | J `catalogAliasCollision`, `rustAliasCollision`; R scope. | Жодна роль не вибрана за порядком каталогу. |
| 7 | Колонка має «м» у шапці, «км» у значенні або невідому одиницю. | Несумісність збережена як warning; жодної конвертації/суми. | J `unit_conflict`; R `incompatible_unit`. | Статус не `ready`, доки одиницю явно не вирішено. |
| 8 | Один порожній рядок між двома записами XLSX. | Рядки після прогалини лишаються в одній ділянці, прогалина показана. | J `internal_blank_row`; R `source_row_locator`. | Всі непорожні source row numbers присутні, жодного тихого пропуску. |
| 9 | На аркуші дві таблиці з різними шапками. | Пояснена split/join-пропозиція, окреме підтвердження меж; E3 бере лише обрану ділянку. | J `two_regions`; UI підтвердження. | Непідтверджені межі не дають `ready`; жодна ділянка не зникає з preview. |
| 10 | Підтвердити binding, закрити застосунок і відкрити знову. | Схема/binding завантажуються з SQLite, валідуються за fingerprint. | R `binding_survives_restart`; UI reopen. | `sourceId`, `schemaVersion`, роль і одиниця збігаються; без нового вгадування. |
| 11 | Додати до Rust/E1 визначення необов'язкове поле без зміни старих requirements. | Старий binding чинний; нове поле лише кандидат. | R `compatible_catalog_update`; J. | Підпис/порядок користувача й confirmed поля не зникають. |
| 12 | Вставити колонку в XLSX або змінити її тип/шапку. | Fingerprint інший, source stale; affected binding потребує підтвердження. | R `incompatible_source_schema`; J. | Немає мовчазного ремапу; старі події й версії доступні. |
| 13 | Видалити/зіпсувати прив'язаний XLSX після v1. | Стан unavailable, останній schema snapshot збережено, рекомендації не ready. | R `missing_or_bad_xlsx`; UI. | Жодного перезапису файла/SQLite-рядків; явна причина. |
| 14 | Два профілі A/B; A має source/binding, B знає його ID. | B не читає й не змінює A. | R `cross_profile_not_found`; SQLite trigger FK. | Однакова `NotFound` для чужого/невідомого ID, дані A незмінні. |
| 15 | Два вікна читають schema v1; перше записує v2. | Друге з expected v1 отримує `VersionConflict`. | R `cas_stale_editor`; UI. | Рівно одна нова версія/event; жодного часткового запису другого. |
| 16 | Синтетична БД має `manual_corrections` і `dashboard_module_corrections`. | E3-додавання і restart їх не змінюють. | S `preserve_corrections`; R old module read. | Побайтові значення й FK старих корекцій ті самі. |
| 17 | Ін'єкція збою після INSERT schema column, до binding/event/commit. | Вся E3-транзакція скасована. | R `interrupted_binding_transaction`. | Pointer, версії, квитанція та events лишаються попередніми. |
| 18 | Створити synthetic v16 backup, мігрувати до v17, відновити v16. | Backup валідний; нова програма може повторно оновити 16→17. | S `restore_old_database`; startup retry. | Всі старі профілі/ряди/корекції однакові; E3 після backup не вигадується. |
| 19 | Двічі викликати persist/refresh з тим самим digest та request ID. | Друга відповідь повертає той самий результат, без копії рядків і версій. | R `idempotent_refresh_and_receipt`; S count. | 1 source, 1 data version, 1 receipt, 0 нових `dashboard_data_*`. |
| 20 | Аркуш > ліміту Rust або лише `sample` 25 рядків; відомий rowCount більший. | `partial`, невідомий точний підсумок, причини/coverage у UI. | R `truncated_sheet`; J `partial_sample`; UI. | Немає `ready` і точних агрегатів, жоден прочитаний рядок не загублений. |

## Додаткові крайові випадки й gates

| Підготовка | Очікування / перевірка |
|---|---|
| Багаторядкова шапка, повторний заголовок у середині, порожній аркуш. | Окреме підтвердження header/boundary; `rowCoverage` і warning зберігають усі видимі source row numbers. J + UI. |
| Однакові XLSX-байти при іншій назві файла. | Той самий `DataSource` тільки після явного relink; digest сам по собі не зливає профілі/джерела. R. |
| Зміна `definitionId`, `fieldKey`, типу/агрегації або невідомий E1 manifest. | `needs_reconfirmation` чи unsupported; старий binding історично доступний. R + J. |
| Обрив під час startup-кандидата та file swap. | Чинний verified backup/live зберігаються; `recover_interrupted_swap()` має однозначний результат або зупинку. S. |
| Невідома новіша міграція/checksum. | Запуск без E3-запису; жодного downgrade. S. |
| Спроба E3 `module_sqlite` за чужим `module_id` або видалення старого модуля. | Trigger/Rust відхиляє чужий ID; старе видалення не блокується, E3 effective state стає unavailable. R + S. |

**Gates майбутньої реалізації:** `cargo test --locked` для Rust/міграції, `cargo clippy --locked --all-targets --all-features -- -D warnings`, `cargo fmt --check`, `npm run test:unit`, `npm run build`, `git diff --check` і ручний локальний Tauri сценарій на синтетичному профілі. Звіт окремо відмічає непроведені Windows/macOS перевірки; проходження unit-тестів не є дозволом на продуктивну міграцію.
