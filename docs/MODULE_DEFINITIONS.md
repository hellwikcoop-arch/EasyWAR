# Реєстр визначень модулів (етап E1)

Статус: **E1 виконано в коді 2026-10-21** (дозвіл власника від 2026-10-21, лише E1). Реєстр
нічого не малює, не переносить даних і не змінює старих вкладок. Він зводить в один перелік
усі наявні модулі й показує, яких даних кожен потребує. План: [`MODULES_ROADMAP.md`](MODULES_ROADMAP.md),
розділ 5; зведений план — [`plans/2026-10-21-easywar-local-modules.md`](plans/2026-10-21-easywar-local-modules.md), L1.

## Як влаштовано

- Код: `src/module-definition-core.js` (чисте ядро), тест: `tests/module-definition.test.mjs`.
- **Три джерела, а не третій каталог.** Шаблони «Мого дашборда» реєстр читає з Rust-каталогу
  `catalog()` (`src-tauri/src/dashboard_modules.rs`), картки ПС — з каталогу v1
  (`src/catalogs/ps-builtin.js` через `src/ps-kpi.js`). Ці описи не копіюються. Окремо описано
  лише блоки старих вкладок (`LEGACY_DEFINITIONS`), бо інакше їх ніде не описано; тест звіряє
  цей опис із кодом сторінок: блоки розкладки `LAY_IDS` у `air.html` і `rocket.html`, масиви KPI
  ядер УДШВ і «Наших втрат», заголовки розділів і карток у `pvk-dashboard.js`,
  `udshv-dashboard.js`, `own-losses-dashboard.js`. Новий блок на сторінці без запису в реєстрі
  провалює тест.
- **Модуль — окремий блок на екрані** (рішення власника 2026-10-20). Шість карток основних
  показників ПС — шість визначень `catalog-v1:tile.ps-*`, шість карток РВ — шість визначень
  `legacy:rv-kpi-*`. Контейнер `p-kpis` і блок `block.ps-kpis` — розкладка, не модуль.
- **Вимоги — смисловими ролями** (`ROLES`), не назвами заголовків: «Тип ЛА» (ПС) і «Тип РСЗВ»
  (РВ) — одна роль `platform-type`. Шаблони Rust поки мають лише технічні ролі графіка
  (`category`, `measure`, `label`…); смислові ролі для них — робота E3 (`ColumnBinding`), тут
  їх не вигадано. Позначка `?` — необов'язкова роль, у дужках — який саме показник книги чи
  значення результату.
- **Роди військ** (`branchTags`) — у яких вкладках модуль стоїть сьогодні. Шаблони Rust
  універсальні (усі чотири роди). Блоки ПС і РВ з однаковим кодом мають обидва роди;
  «Наші втрати» — ПВК і УДШВ.
- **Відповідник** (`counterpart`) — лише там, де код рахує те саме: «Пуски» РВ і «Вильоти» ПС,
  «Використано БП» РВ і ПС. Інші картки РВ мають інші значення результату (знищено,
  пошкоджено / подавлено), тому не зведені.
- Застосунки «Робочого середовища» (EasyGreen, EasyDoc, EasySlide, EasyFLY, easyPay) — не
  віджети, у реєстр не входять; тест це перевіряє.

API: `listDefinitions({ rustTemplates, catalogs, catalogUsage })`, `requirementsFor(definitions, id)`,
`dependentsOf(definitions, role, { requiredOnly })`, `dependencyGraph(definitions)`,
`validateRegistry(definitions)`, `registryMarkdown(definitions)`.

Таблиці нижче генерує `node script/module_definitions.mjs`; тест перевіряє, що вони збігаються з
реєстром.

## Що не перевірено

- Описи обчислень старих блоків складено читанням коду сторінок; застосунок не запускався,
  числа на синтетичних даних з реєстром не звірялися (це порівняння до/після — етап E2).
- Межі ролей (`report-metric` для книг ПВК, УДШВ і «Наших втрат») грубіші, ніж знадобиться для
  E3: там показник книги визначає структура аркуша, а не довільний стовпець.

## Перелік

<!-- registry:start -->
### rust-template (26)

| Визначення | Назва | Вигляд | Роди | Де | Вимоги | Обчислення |
|---|---|---|---|---|---|---|
| `rust-template:flight-hours` | Журнал хронометражу польотів | horizontal-bar | air, rocket, pvk, dshv | my-dashboard: flight-hours | order?, category, category?, category?, category?, category?, note?, note?, note?, note?, measure?, measure?, category?, category?, measure, measure, measure?, status?, status?, measure?, measure?, measure?, measure?, status?, measure?, measure?, measure?, category?, category?, category?, category?, measure?, measure?, measure?, measure? | за «Тип ПС»: «Кількість польотів» — сума; «Запуск, проба, год:хв» — сума; «Наліт (повітря), год:хв» — сума; «Наліт (загальний), год:хв» — сума; «Висота польоту, м» — average; «Верхня межа хмар (ВМХ), м» — average; «Нижня межа хмар (НМХ), м» — average; «Хмарність, 0–10» — average; «Видимість, км» — average; «Час у хмарах, год:хв» — сума; «Час під шторкою, год:хв» — сума; «Витрата палива, л» — сума; «Пасажири» — сума; «Вантаж, кг» — сума; «Заходів РСП» — сума; «Посадок РСП» — сума |
| `rust-template:kpi` | Ключовий показник | kpi | air, rocket, pvk, dshv | my-dashboard: kpi | label, measure, measure?, note? | «Значення» — сума; «Зміна, %» — average |
| `rust-template:line` | Лінійний графік | line | air, rocket, pvk, dshv | my-dashboard: line | category, measure, series? | за «Період»: «Значення» — сума |
| `rust-template:area` | Графік із площею | area | air, rocket, pvk, dshv | my-dashboard: area | category, measure, series? | за «Період»: «Значення» — сума |
| `rust-template:columns` | Вертикальні стовпчики | columns | air, rocket, pvk, dshv | my-dashboard: columns | category, measure, series? | за «Категорія»: «Значення» — сума |
| `rust-template:horizontal-bars` | Горизонтальні смуги | horizontal-bar | air, rocket, pvk, dshv | my-dashboard: horizontal-bars | category, measure, series? | за «Категорія»: «Значення» — сума |
| `rust-template:grouped-columns` | Згруповані стовпчики | grouped-columns | air, rocket, pvk, dshv | my-dashboard: grouped-columns | category, measure, measure | за «Категорія»: «Основне значення» — сума; «Порівняльне значення» — сума |
| `rust-template:donut` | Кільцева діаграма | donut | air, rocket, pvk, dshv | my-dashboard: donut | category, measure | за «Категорія»: «Значення» — сума |
| `rust-template:radial-progress` | Радіальний прогрес | radial-progress | air, rocket, pvk, dshv | my-dashboard: radial-progress | label, measure, measure | «Поточне значення» — сума; «Цільове значення» — сума |
| `rust-template:multi-ring` | Кілька радіальних шкал | multi-ring | air, rocket, pvk, dshv | my-dashboard: multi-ring | label, measure, measure, order? | «Поточне значення» — сума; «Цільове значення» — сума |
| `rust-template:radar` | Радарна діаграма | radar | air, rocket, pvk, dshv | my-dashboard: radar | category, measure, series? | за «Вісь»: «Значення» — сума |
| `rust-template:gauge` | Шкала-прилад | gauge | air, rocket, pvk, dshv | my-dashboard: gauge | label, measure, measure?, measure | «Значення» — сума; «Мінімум» — minimum; «Максимум» — maximum |
| `rust-template:progress-bars` | Смуги виконання | progress-bars | air, rocket, pvk, dshv | my-dashboard: progress-bars | label, measure, measure | «Поточне значення» — сума; «Цільове значення» — сума |
| `rust-template:calendar` | Календар активності | calendar | air, rocket, pvk, dshv | my-dashboard: calendar | category, measure | за «Дата»: «Значення» — сума |
| `rust-template:table` | Оперативна таблиця | table | air, rocket, pvk, dshv | my-dashboard: table | label, measure, measure?, status?, note? | «Значення» — сума; «Виконання, %» — average |
| `rust-template:funnel` | Воронка | funnel | air, rocket, pvk, dshv | my-dashboard: funnel | category, measure, order | за «Етап»: «Значення» — сума |
| `rust-template:map` | Карта подій | map | air, rocket, pvk, dshv | my-dashboard: map | label, latitude, longitude, measure, status? | «Значення» — сума |
| `rust-template:weather` | Метеоумови | weather | air, rocket, pvk, dshv | my-dashboard: weather | category, label, latitude, longitude, measure, measure?, measure?, measure?, measure?, status? | за «Час спостереження»: «Хмарність, 0–10» — average; «Нижня межа хмар (НМХ), м» — average; «Верхня межа хмар (ВМХ), м» — average; «Видимість, км» — average; «Вітер, м/с» — average |
| `rust-template:cohort` | Когортна матриця | cohort | air, rocket, pvk, dshv | my-dashboard: cohort | category, category, measure | за «Когорта», «Період»: «Значення» — сума |
| `rust-template:activity` | Стрічка активності | activity | air, rocket, pvk, dshv | my-dashboard: activity | category, label, status?, measure? | за «Час події»: «Значення» — сума |
| `rust-template:waveform` | Двобічна гістограма | waveform | air, rocket, pvk, dshv | my-dashboard: waveform | category, measure, measure, series? | за «Час»: «Верхнє значення» — сума; «Нижнє значення» — сума |
| `rust-template:combo` | Стовпчики з лінією | combo | air, rocket, pvk, dshv | my-dashboard: combo | category, measure, measure? | за «Період»: «Значення (стовпчики)» — сума; «Лінія (план)» — сума |
| `rust-template:stacked-columns` | Накопичені стовпчики | stacked-columns | air, rocket, pvk, dshv | my-dashboard: stacked-columns | category, measure, series | за «Категорія»: «Значення» — сума |
| `rust-template:diverging-bars` | Приріст і втрати | diverging-bars | air, rocket, pvk, dshv | my-dashboard: diverging-bars | category, measure, note? | за «Категорія»: «Зміна» — сума |
| `rust-template:leaderboard` | Рейтинг | leaderboard | air, rocket, pvk, dshv | my-dashboard: leaderboard | label, category?, measure, measure? | «Значення» — сума; «Зміна, %» — average |
| `rust-template:ridgeline` | Гребені за годинами доби | ridgeline | air, rocket, pvk, dshv | my-dashboard: ridgeline | category, series, measure? | за «Час події»: «Вага події» — сума |

### catalog-v1 (8)

| Визначення | Назва | Вигляд | Роди | Де | Вимоги | Обчислення |
|---|---|---|---|---|---|---|
| `catalog-v1:tile.ps-sorties` | Вильоти | kpi | air | air: p-kpis | event-date, munition-count, abort-flag | кількість записів. |
| `catalog-v1:tile.ps-munitions` | Використано БП | kpi | air | air: p-kpis | munition-count, event-date, munition-type | сума «К-сть боєприпасів». |
| `catalog-v1:tile.ps-hit` | Уражено | kpi | air | air: p-kpis | strike-result, event-date | кількість записів, де «Результат ураження» = «Уражено». |
| `catalog-v1:tile.ps-partial` | Пошкоджено | kpi | air | air: p-kpis | strike-result, event-date | кількість записів, де «Результат ураження» = «Пошкоджено». |
| `catalog-v1:tile.ps-miss` | Не уражено | kpi | air | air: p-kpis | strike-result, event-date | кількість записів, де «Результат ураження» = «Не уражено». |
| `catalog-v1:tile.ps-unknown` | Не відомо | kpi | air | air: p-kpis | strike-result, event-date | кількість записів, де «Результат ураження» = «Не відомо». |
| `catalog-v1:block.ps-ops` | Журнал вильотів | table | air | air: view:ops | event-date, munition-type, munition-count, strike-result, abort-flag | Рядки зі стовпцями блока. |
| `catalog-v1:block.ps-mun` | Боєприпаси | breakdown | air | air: view:mun | munition-type, munition-count | сума «К-сть боєприпасів» за «Тип боєприпасу». |

### legacy (83)

| Визначення | Назва | Вигляд | Роди | Де | Вимоги | Обчислення |
|---|---|---|---|---|---|---|
| `legacy:strike-map` | Карта операцій | map | air, rocket | air: p-map; rocket: p-map | coordinates, strike-result, event-date | Точки координат записів за період, колір — результат; фільтр за результатом. |
| `legacy:result-dynamics` | Результати у динаміці | stacked-columns | air, rocket | air: p-dyn; rocket: p-dyn | event-date, strike-result | Кількість записів за днями або тижнями з розбивкою за результатом ураження. |
| `legacy:strike-depth` | Глибина ураження | histogram | air, rocket | air: p-depth; rocket: p-depth | coordinates, contact-line, event-date, strike-result, munition-type?, abort-flag? | Медіана відстані точок запису до знімка ЛБЗ на дату запису; розподіл кроком 5 км; медіана за типом БП (від 3 записів). |
| `legacy:result-distribution` | Розподіл результатів | donut | air, rocket | air: p-dist; rocket: p-dist | strike-result | Частки результатів ураження серед записів періоду. |
| `legacy:platform-types` | Тип носія (ЛА / РСЗВ) | list | air, rocket | air: p-plat; rocket: p-plat | platform-type | Кількість записів за типом носія, перші 5, частка від усіх. |
| `legacy:munition-use` | Використання боєприпасів | bars | air, rocket | air: p-mun; rocket: p-mun | munition-type, munition-count | Сума кількості БП за типом: два найбільші й «Інші», частка від усіх використаних. |
| `legacy:top-units` | Топ-5 підрозділів (за ефектом) | table | air, rocket | air: p-units; rocket: p-units | unit, strike-result, abort-flag? | Ефективність підрозділу = (уражено + k·пошкоджено) / (записи − відбої), k = 1 або 0,75; лише підрозділи з 5+ записами. |
| `legacy:activity-by-day` | Активність за днями | combo | air, rocket | air: p-act; rocket: p-act | event-date, munition-count | Кількість записів і сума БП за днями, тижнями чи місяцями; зміна до попереднього періоду. |
| `legacy:target-types` | Тип цілі | list | air, rocket | air: p-types; rocket: p-types | target-type | Кількість записів за типом цілі, перші 12. |
| `legacy:records-journal` | Журнал записів (вильоти / пуски) | table | air, rocket | air: p-ops; rocket: p-ops | event-date, munition-type?, munition-count?, strike-result?, target-id? | Останні записи періоду з переходом до паспорта запису. |
| `legacy:repeat-targets` | Повторні цілі | table | air, rocket | air: p-repeat; rocket: p-repeat | target-id, target-type?, strike-result, event-date | Номери цілей, що трапляються у 2+ записах; перші 8 за кількістю записів. |
| `legacy:hour-of-day` | Час доби | stacked-columns | air, rocket | air: p-hours; rocket: p-hours | event-time, strike-result | Кількість записів за годиною доби (24 стовпці) з розбивкою за результатом ураження; пік і записи без часу. |
| `legacy:data-quality` | Потребує перевірки в таблиці | list | air, rocket | air: p-quality; rocket: p-quality | record-issues | Записи з порожніми чи нерозпізнаними полями, по 10 на сторінку. |
| `legacy:firing-units` | Вогневі бригади | table | rocket | rocket: p-fire | firing-unit, strike-result | Показники записів за вогневою бригадою. |
| `legacy:rv-kpi-launches` | Пуски | kpi | rocket | rocket: p-kpis | event-date | Кількість записів; середнє й максимум за добу. Відповідник: `catalog-v1:tile.ps-sorties`. |
| `legacy:rv-kpi-munitions` | Використано БП (РВ) | kpi | rocket | rocket: p-kpis | munition-count, event-date | Сума кількості БП; БП на пуск, максимум за добу. Відповідник: `catalog-v1:tile.ps-munitions`. |
| `legacy:rv-kpi-destroyed` | Знищено | kpi | rocket | rocket: p-kpis | strike-result (Знищено), event-date | Кількість записів із результатом «Знищено»; частка від пусків. |
| `legacy:rv-kpi-damaged` | Пошкоджено / подавлено | kpi | rocket | rocket: p-kpis | strike-result (Пошкоджено, Подавлено), event-date | Сума записів «Пошкоджено» і «Подавлено»; частка від пусків. |
| `legacy:rv-kpi-miss` | Не уражено (РВ) | kpi | rocket | rocket: p-kpis | strike-result (Не уражено), event-date | Кількість записів «Не уражено»; частка; мінімум за місяць. |
| `legacy:rv-kpi-unknown` | Не відомо (РВ) | kpi | rocket | rocket: p-kpis | strike-result (Не відомо), event-date | Кількість записів без розпізнаного результату; показується, лише коли їх більше нуля. |
| `legacy:pvk-kpi-au` | АУ · разом | kpi | pvk | pvk: АУ · разом | event-date, report-metric (АА\|АУ, ПС\|АУ) | Сума «АУ» аркушів АА і ПС за період; динаміка за днями. |
| `legacy:pvk-kpi-munitions` | Усього БП | kpi | pvk | pvk: Усього БП | event-date, report-metric (АА\|Боєприпаси, ПС\|Боєприпаси) | Сума групи «Боєприпаси» аркушів АА і ПС. |
| `legacy:pvk-kpi-affected` | Уражено (ПВК) | kpi | pvk | pvk: Уражено | event-date, report-metric (АА\|Уражено, ПС\|Уражено) | Сума «Уражено» аркушів АА і ПС; поруч «НЕ уражено». |
| `legacy:pvk-kpi-recon` | Дорозвідується | kpi | pvk | pvk: Дорозвідується | event-date, report-metric (ПС\|Дорозвідується) | Сума «Дорозвідується» аркуша ПС. |
| `legacy:pvk-kpi-affected-percent` | % уражених | kpi | pvk | pvk: % уражених | event-date, report-metric (АА\|Уражено, ПС\|Уражено, АА\|НЕ уражено, ПС\|НЕ уражено) | Уражено / (Уражено + НЕ уражено), без «Дорозвідується». |
| `legacy:pvk-kpi-objects` | Уражені об’єкти | kpi | pvk | pvk: Уражені об’єкти | event-date, report-metric (Об'єкти\|*) | Сума показників аркуша «Об'єкти» без «Витрата». |
| `legacy:pvk-kpi-expenditure` | Витрата (ПВК) | kpi | pvk | pvk: Витрата | event-date, report-metric (Об'єкти\|Витрата) | Сума показника «Витрата» окремо від об'єктів. |
| `legacy:pvk-kpi-journal` | Таблиця 1 (записів у журналі) | kpi | pvk | pvk: Таблиця 1 | event-date | Кількість записів журналу ударів за період; немає журналу — картки немає. |
| `legacy:pvk-activity-calendar` | Календар активності (ПВК) | calendar | pvk | pvk: Календар активності | event-date, report-metric (АА\|АУ, ПС\|АУ) | Сума АУ за днями періоду. |
| `legacy:pvk-dynamics` | Загальна динаміка | line | pvk | pvk: Загальна динаміка | event-date, report-metric (АУ, Боєприпаси, Уражено, Об'єкти, Витрата) | Лінії основних показників за днями періоду. |
| `legacy:pvk-sheet-groups` | Аркуш книги: групи показників | cards | pvk | pvk: groupOverview(group, sheet) | event-date, report-metric (<аркуш>\|<група>\|*) | Для кожної групи аркуша — підсумки показників за період і зміна до попереднього. |
| `legacy:pvk-journal-records-kpi` | Записів (журнал) | kpi | pvk | pvk: Записів | event-date | Кількість ударів за період. |
| `legacy:pvk-journal-days` | Днів з ударами | kpi | pvk | pvk: Днів з ударами | event-date | Кількість різних дат із записами. |
| `legacy:pvk-journal-targets` | Унікальних цілей | kpi | pvk | pvk: Унікальних цілей | target-id | Кількість різних «Номер цілі»; немає стовпця — картки немає. |
| `legacy:pvk-journal-coordinates` | Із координатами | kpi | pvk | pvk: Із координатами | coordinates | Кількість записів із координатами й без них. |
| `legacy:pvk-journal-confirmed` | Підтверджено відео | kpi | pvk | pvk: Підтверджено відео | journal-column (Фактичні приходи), journal-column (Витрата АЗУ) | Фактичні приходи / витрата АЗУ, відсотком. |
| `legacy:pvk-journal-by-day` | Удари за днями | columns | pvk | pvk: Удари за днями | event-date | Кількість записів журналу за днями. |
| `legacy:pvk-journal-hours` | Час удару | columns | pvk | pvk: Час удару | event-time | Розподіл записів за годинами доби; лише коли є стовпець часу. |
| `legacy:pvk-journal-columns` | Усі стовпці журналу | cards | pvk | pvk: Усі стовпці журналу | journal-column | Для кожного стовпця — картка за його видом (число, дата, текст, координати). |
| `legacy:pvk-journal-list` | Записи журналу ударів | table | pvk | pvk: Записи | journal-column | Пошук і вивантаження CSV записів журналу. |
| `legacy:pvk-pivot` | Зведена таблиця за період (ПВК) | table | pvk | pvk: Зведена таблиця за період | event-date, report-metric | Суми показників аркушів за період, CSV. |
| `legacy:pvk-quality` | Перевірка даних (ПВК) | list | pvk | pvk: Перевірка даних | report-metric | Помилки, попередження й інформаційні зауваження книги, згруповані. |
| `legacy:udshv-kpi-kia` | 200 | kpi | dshv | dshv: kpi:kia | event-date, unit, report-metric (Втрати о/с\|200) | Сума «200». |
| `legacy:udshv-kpi-wia` | 300 | kpi | dshv | dshv: kpi:wia | event-date, unit, report-metric (Втрати о/с\|300) | Сума «300». |
| `legacy:udshv-kpi-personnel` | Втрати о/с разом | kpi | dshv | dshv: kpi:personnel | event-date, unit, report-metric (Втрати о/с\|*) | Сума групи «Втрати о/с». |
| `legacy:udshv-kpi-destroyed` | ОВТ знищено | kpi | dshv | dshv: kpi:destroyed | event-date, unit, report-metric (ЗНИЩЕНО\|*) | Сума групи «ЗНИЩЕНО». |
| `legacy:udshv-kpi-damaged` | ОВТ пошкоджено | kpi | dshv | dshv: kpi:damaged | event-date, unit, report-metric (ПОШКОДЖЕНО\|*) | Сума групи «ПОШКОДЖЕНО». |
| `legacy:udshv-kpi-suppressed` | ОВТ подавлено | kpi | dshv | dshv: kpi:suppressed | event-date, unit, report-metric (ПОДАВЛЕНО\|*) | Сума групи «ПОДАВЛЕНО». |
| `legacy:udshv-kpi-ammo` | Витрата БК | kpi | dshv | dshv: kpi:ammo | event-date, unit, report-metric (Витрата боєприпасів\|ВСЬОГО) | Підсумок «ВСЬОГО» витрати БК. |
| `legacy:udshv-kpi-vgz` | ВгЗ | kpi | dshv | dshv: kpi:vgz | event-date, unit, report-metric (Вогневі засоби\|ВгЗ) | Сума вогневих завдань. |
| `legacy:udshv-kpi-kbb` | КББ | kpi | dshv | dshv: kpi:kbb | event-date, unit, report-metric (Вогневі засоби\|КББ) | Сума контрбатарейної боротьби. |
| `legacy:udshv-personnel-series` | Втрати о/с противника | stacked-columns | dshv | dshv: Втрати о/с противника | event-date, unit, report-metric (Втрати о/с\|*) | 200 і 300 за днями, тижнями чи місяцями; клік відкриває період. |
| `legacy:udshv-ovt-series` | ОВТ: знищено / пошкоджено / подавлено | stacked-columns | dshv | dshv: ОВТ: знищено / пошкоджено / подавлено | event-date, unit, report-metric (ЗНИЩЕНО\|*, ПОШКОДЖЕНО\|*, ПОДАВЛЕНО\|*) | Три групи ОВТ за днями, тижнями чи місяцями. |
| `legacy:udshv-units-personnel` | Підрозділи за втратами о/с | bars | dshv | dshv: Підрозділи за втратами о/с | unit, report-metric (Втрати о/с\|*) | Сума втрат о/с за підрозділом, перші 13. |
| `legacy:udshv-destroyed-top` | Знищено ОВТ — топ | bars | dshv | dshv: Знищено ОВТ — топ | report-metric (ЗНИЩЕНО\|*) | Перші 10 типів ОВТ за кількістю знищених. |
| `legacy:udshv-categories` | Втрати за категоріями | bars | dshv | dshv: Втрати за категоріями | report-metric (Втрати противника за категоріями\|*) | Перші 10 (на сторінці БК — 20) категорій втрат противника. |
| `legacy:udshv-units-table` | Підрозділи (УДШВ) | table | dshv | dshv: Підрозділи | unit, event-date, report-metric | Таблиця підрозділів: о/с, 200, 300, ОВТ, БК, ВгЗ, КББ, дні; сортування й фільтр. |
| `legacy:udshv-personnel-dynamics` | Динаміка 200 / 300 | stacked-columns | dshv | dshv: Динаміка 200 / 300 | event-date, report-metric (Втрати о/с\|200, Втрати о/с\|300) | 200 і 300 за періодами; середнє на добу з даними. |
| `legacy:udshv-units-200-300` | Підрозділи: 200 і 300 | bars | dshv | dshv: Підрозділи: 200 і 300 | unit, report-metric (Втрати о/с\|200, Втрати о/с\|300) | Смуги 200 і 300 за підрозділом. |
| `legacy:udshv-weekday` | За днями тижня | columns | dshv | dshv: За днями тижня | event-date, report-metric (Втрати о/с\|*) | Втрати о/с разом за днем тижня. |
| `legacy:udshv-ovt-types` | Група ОВТ: типи | bars | dshv | dshv: : типи ОВТ | report-metric (ЗНИЩЕНО\|*, ПОШКОДЖЕНО\|*, ПОДАВЛЕНО\|*) | Типи ОВТ обраної групи за період і за весь час. |
| `legacy:udshv-ovt-dynamics` | Динаміка групи ОВТ | stacked-columns | dshv | dshv: Динаміка | event-date, report-metric (ЗНИЩЕНО\|*, ПОШКОДЖЕНО\|*, ПОДАВЛЕНО\|*) | Обрана група ОВТ за періодами. |
| `legacy:udshv-ovt-heatmap` | Група ОВТ: підрозділ × тип | heatmap | dshv | dshv: : підрозділ × тип | unit, report-metric (ЗНИЩЕНО\|*, ПОШКОДЖЕНО\|*, ПОДАВЛЕНО\|*) | Матриця підрозділ × тип ОВТ для обраної групи. |
| `legacy:udshv-ammo-types` | Витрата за типами боєприпасів | bars | dshv | dshv: Витрата за типами боєприпасів | report-metric (Витрата боєприпасів\|*) | Перші 20 типів БК за витратою, без «ВСЬОГО». |
| `legacy:udshv-ammo-heatmap` | Витрата БК: підрозділ × тип | heatmap | dshv | dshv: Витрата БК: підрозділ × тип | unit, report-metric (Витрата боєприпасів\|*) | Матриця підрозділ × тип БК. |
| `legacy:udshv-pivot` | Зведена таблиця за період (УДШВ) | table | dshv | dshv: Зведена таблиця за період | event-date, unit, report-metric | Суми показників за групами за період і підрозділами, CSV. |
| `legacy:udshv-freshness` | Актуальність підрозділів | table | dshv | dshv: Актуальність підрозділів | unit, event-date | Остання дата даних підрозділу; без свіжих даних довше 7 діб; дні з даними за 30. |
| `legacy:udshv-sheets` | Аркуші книги | table | dshv | dshv: Аркуші | event-date, report-metric | Аркуші: днів, рядків, показників, період. |
| `legacy:udshv-quality` | Перевірка даних (УДШВ) | list | dshv | dshv: Перевірка даних | report-metric | Зауваження книги, згруповані за текстом. |
| `legacy:own-kpi-200` | 200 (наші) | kpi | pvk, dshv | own-losses: kpi:k200 | event-date, unit, report-metric (Втрати о/с\|200) | Сума «200». |
| `legacy:own-kpi-300` | 300 (наші) | kpi | pvk, dshv | own-losses: kpi:k300 | event-date, unit, report-metric (Втрати о/с\|300) | Сума «300». |
| `legacy:own-kpi-500` | 500 (наші) | kpi | pvk, dshv | own-losses: kpi:k500 | event-date, unit, report-metric (Втрати о/с\|500) | Сума «500». |
| `legacy:own-kpi-personnel` | Втрати о/с разом (наші) | kpi | pvk, dshv | own-losses: kpi:personnel | event-date, unit, report-metric (Втрати о/с\|*) | Сума всіх показників групи «Втрати о/с». |
| `legacy:own-kpi-destroyed` | Арт. системи знищено | kpi | pvk, dshv | own-losses: kpi:destroyed | event-date, unit, report-metric (destroyed\|*) | Сума знищених арт. систем. |
| `legacy:own-kpi-damaged` | Арт. системи пошкоджено | kpi | pvk, dshv | own-losses: kpi:damaged | event-date, unit, report-metric (damaged\|*) | Сума пошкоджених арт. систем. |
| `legacy:own-kpi-out-of-order` | Вийшли з ладу | kpi | pvk, dshv | own-losses: kpi:outOfOrder | event-date, unit, report-metric (outOfOrder\|*) | Сума систем, що вийшли з ладу за технічним станом. |
| `legacy:own-personnel-series` | Втрати о/с (наші) | stacked-columns | pvk, dshv | own-losses: Втрати о/с | event-date, report-metric (Втрати о/с\|*) | 200, 300, 500 за днями, тижнями чи місяцями. |
| `legacy:own-units` | Підрозділи (наші втрати) | table | pvk, dshv | own-losses: Підрозділи | unit, report-metric | Втрати за підрозділом; клік фільтрує. |
| `legacy:own-causes` | Дія противника (втрати о/с) | bars | pvk, dshv | own-losses: Дія противника (втрати о/с) | report-metric (cause\|*) | Перші 10 дій противника за кількістю випадків. |
| `legacy:own-destroyed-types` | Арт. системи: знищені | bars | pvk, dshv | own-losses: Арт. системи: знищені | report-metric (destroyed\|*) | Перші 10 типів знищених арт. систем. |
| `legacy:own-damaged-types` | Арт. системи: пошкоджені | bars | pvk, dshv | own-losses: Арт. системи: пошкоджені | report-metric (damaged\|*) | Перші 10 типів пошкоджених арт. систем. |
| `legacy:own-events` | Журнал подій | table | pvk, dshv | own-losses: Журнал подій | event-date, unit, report-metric | Події за період. |
| `legacy:own-quality` | Перевірка даних (наші втрати) | list | pvk, dshv | own-losses: Перевірка даних | report-metric | Рядки з підозрілою чи непрочитаною датою й інші зауваження. |

### Граф залежностей: роль → визначення

| Роль | Що це | Визначень | Визначення |
|---|---|---|---|
| `event-date` | Дата події | 61 | `catalog-v1:tile.ps-sorties`, `catalog-v1:tile.ps-munitions`, `catalog-v1:tile.ps-hit`, `catalog-v1:tile.ps-partial`, `catalog-v1:tile.ps-miss`, `catalog-v1:tile.ps-unknown`, `catalog-v1:block.ps-ops`, `legacy:strike-map`, `legacy:result-dynamics`, `legacy:strike-depth`, `legacy:activity-by-day`, `legacy:records-journal`, `legacy:repeat-targets`, `legacy:rv-kpi-launches`, `legacy:rv-kpi-munitions`, `legacy:rv-kpi-destroyed`, `legacy:rv-kpi-damaged`, `legacy:rv-kpi-miss`, `legacy:rv-kpi-unknown`, `legacy:pvk-kpi-au`, `legacy:pvk-kpi-munitions`, `legacy:pvk-kpi-affected`, `legacy:pvk-kpi-recon`, `legacy:pvk-kpi-affected-percent`, `legacy:pvk-kpi-objects`, `legacy:pvk-kpi-expenditure`, `legacy:pvk-kpi-journal`, `legacy:pvk-activity-calendar`, `legacy:pvk-dynamics`, `legacy:pvk-sheet-groups`, `legacy:pvk-journal-records-kpi`, `legacy:pvk-journal-days`, `legacy:pvk-journal-by-day`, `legacy:pvk-pivot`, `legacy:udshv-kpi-kia`, `legacy:udshv-kpi-wia`, `legacy:udshv-kpi-personnel`, `legacy:udshv-kpi-destroyed`, `legacy:udshv-kpi-damaged`, `legacy:udshv-kpi-suppressed`, `legacy:udshv-kpi-ammo`, `legacy:udshv-kpi-vgz`, `legacy:udshv-kpi-kbb`, `legacy:udshv-personnel-series`, `legacy:udshv-ovt-series`, `legacy:udshv-units-table`, `legacy:udshv-personnel-dynamics`, `legacy:udshv-weekday`, `legacy:udshv-ovt-dynamics`, `legacy:udshv-pivot`, `legacy:udshv-freshness`, `legacy:udshv-sheets`, `legacy:own-kpi-200`, `legacy:own-kpi-300`, `legacy:own-kpi-500`, `legacy:own-kpi-personnel`, `legacy:own-kpi-destroyed`, `legacy:own-kpi-damaged`, `legacy:own-kpi-out-of-order`, `legacy:own-personnel-series`, `legacy:own-events` |
| `event-time` | Час події | 2 | `legacy:hour-of-day`, `legacy:pvk-journal-hours` |
| `unit` | Підрозділ | 28 | `legacy:top-units`, `legacy:udshv-kpi-kia`, `legacy:udshv-kpi-wia`, `legacy:udshv-kpi-personnel`, `legacy:udshv-kpi-destroyed`, `legacy:udshv-kpi-damaged`, `legacy:udshv-kpi-suppressed`, `legacy:udshv-kpi-ammo`, `legacy:udshv-kpi-vgz`, `legacy:udshv-kpi-kbb`, `legacy:udshv-personnel-series`, `legacy:udshv-ovt-series`, `legacy:udshv-units-personnel`, `legacy:udshv-units-table`, `legacy:udshv-units-200-300`, `legacy:udshv-ovt-heatmap`, `legacy:udshv-ammo-heatmap`, `legacy:udshv-pivot`, `legacy:udshv-freshness`, `legacy:own-kpi-200`, `legacy:own-kpi-300`, `legacy:own-kpi-500`, `legacy:own-kpi-personnel`, `legacy:own-kpi-destroyed`, `legacy:own-kpi-damaged`, `legacy:own-kpi-out-of-order`, `legacy:own-units`, `legacy:own-events` |
| `firing-unit` | Вогнева бригада | 1 | `legacy:firing-units` |
| `platform-type` | Тип носія (ЛА, РСЗВ) | 1 | `legacy:platform-types` |
| `munition-type` | Тип боєприпасу | 6 | `catalog-v1:tile.ps-munitions`, `catalog-v1:block.ps-ops`, `catalog-v1:block.ps-mun`, `legacy:strike-depth`, `legacy:munition-use`, `legacy:records-journal` |
| `munition-count` | Кількість боєприпасів | 8 | `catalog-v1:tile.ps-sorties`, `catalog-v1:tile.ps-munitions`, `catalog-v1:block.ps-ops`, `catalog-v1:block.ps-mun`, `legacy:munition-use`, `legacy:activity-by-day`, `legacy:records-journal`, `legacy:rv-kpi-munitions` |
| `strike-result` | Результат ураження | 18 | `catalog-v1:tile.ps-hit`, `catalog-v1:tile.ps-partial`, `catalog-v1:tile.ps-miss`, `catalog-v1:tile.ps-unknown`, `catalog-v1:block.ps-ops`, `legacy:strike-map`, `legacy:result-dynamics`, `legacy:strike-depth`, `legacy:result-distribution`, `legacy:top-units`, `legacy:records-journal`, `legacy:repeat-targets`, `legacy:hour-of-day`, `legacy:firing-units`, `legacy:rv-kpi-destroyed`, `legacy:rv-kpi-damaged`, `legacy:rv-kpi-miss`, `legacy:rv-kpi-unknown` |
| `abort-flag` | Відбій | 4 | `catalog-v1:tile.ps-sorties`, `catalog-v1:block.ps-ops`, `legacy:strike-depth`, `legacy:top-units` |
| `target-id` | Номер цілі | 3 | `legacy:records-journal`, `legacy:repeat-targets`, `legacy:pvk-journal-targets` |
| `target-type` | Тип цілі | 2 | `legacy:target-types`, `legacy:repeat-targets` |
| `coordinates` | Координати | 3 | `legacy:strike-map`, `legacy:strike-depth`, `legacy:pvk-journal-coordinates` |
| `contact-line` | Контур ЛБЗ | 1 | `legacy:strike-depth` |
| `record-issues` | Зауваження розбору рядка | 1 | `legacy:data-quality` |
| `report-metric` | Показник книги (аркуш | група | назва) | 52 | `legacy:pvk-kpi-au`, `legacy:pvk-kpi-munitions`, `legacy:pvk-kpi-affected`, `legacy:pvk-kpi-recon`, `legacy:pvk-kpi-affected-percent`, `legacy:pvk-kpi-objects`, `legacy:pvk-kpi-expenditure`, `legacy:pvk-activity-calendar`, `legacy:pvk-dynamics`, `legacy:pvk-sheet-groups`, `legacy:pvk-pivot`, `legacy:pvk-quality`, `legacy:udshv-kpi-kia`, `legacy:udshv-kpi-wia`, `legacy:udshv-kpi-personnel`, `legacy:udshv-kpi-destroyed`, `legacy:udshv-kpi-damaged`, `legacy:udshv-kpi-suppressed`, `legacy:udshv-kpi-ammo`, `legacy:udshv-kpi-vgz`, `legacy:udshv-kpi-kbb`, `legacy:udshv-personnel-series`, `legacy:udshv-ovt-series`, `legacy:udshv-units-personnel`, `legacy:udshv-destroyed-top`, `legacy:udshv-categories`, `legacy:udshv-units-table`, `legacy:udshv-personnel-dynamics`, `legacy:udshv-units-200-300`, `legacy:udshv-weekday`, `legacy:udshv-ovt-types`, `legacy:udshv-ovt-dynamics`, `legacy:udshv-ovt-heatmap`, `legacy:udshv-ammo-types`, `legacy:udshv-ammo-heatmap`, `legacy:udshv-pivot`, `legacy:udshv-sheets`, `legacy:udshv-quality`, `legacy:own-kpi-200`, `legacy:own-kpi-300`, `legacy:own-kpi-500`, `legacy:own-kpi-personnel`, `legacy:own-kpi-destroyed`, `legacy:own-kpi-damaged`, `legacy:own-kpi-out-of-order`, `legacy:own-personnel-series`, `legacy:own-units`, `legacy:own-causes`, `legacy:own-destroyed-types`, `legacy:own-damaged-types`, `legacy:own-events`, `legacy:own-quality` |
| `journal-column` | Довільний стовпець журналу | 3 | `legacy:pvk-journal-confirmed`, `legacy:pvk-journal-columns`, `legacy:pvk-journal-list` |
| `category` | Категорія (вимір) | 19 | `rust-template:flight-hours`, `rust-template:line`, `rust-template:area`, `rust-template:columns`, `rust-template:horizontal-bars`, `rust-template:grouped-columns`, `rust-template:donut`, `rust-template:radar`, `rust-template:calendar`, `rust-template:funnel`, `rust-template:weather`, `rust-template:cohort`, `rust-template:activity`, `rust-template:waveform`, `rust-template:combo`, `rust-template:stacked-columns`, `rust-template:diverging-bars`, `rust-template:leaderboard`, `rust-template:ridgeline` |
| `measure` | Числовий показник | 26 | `rust-template:flight-hours`, `rust-template:kpi`, `rust-template:line`, `rust-template:area`, `rust-template:columns`, `rust-template:horizontal-bars`, `rust-template:grouped-columns`, `rust-template:donut`, `rust-template:radial-progress`, `rust-template:multi-ring`, `rust-template:radar`, `rust-template:gauge`, `rust-template:progress-bars`, `rust-template:calendar`, `rust-template:table`, `rust-template:funnel`, `rust-template:map`, `rust-template:weather`, `rust-template:cohort`, `rust-template:activity`, `rust-template:waveform`, `rust-template:combo`, `rust-template:stacked-columns`, `rust-template:diverging-bars`, `rust-template:leaderboard`, `rust-template:ridgeline` |
| `label` | Підпис | 10 | `rust-template:kpi`, `rust-template:radial-progress`, `rust-template:multi-ring`, `rust-template:gauge`, `rust-template:progress-bars`, `rust-template:table`, `rust-template:map`, `rust-template:weather`, `rust-template:activity`, `rust-template:leaderboard` |
| `series` | Ряд | 8 | `rust-template:line`, `rust-template:area`, `rust-template:columns`, `rust-template:horizontal-bars`, `rust-template:radar`, `rust-template:waveform`, `rust-template:stacked-columns`, `rust-template:ridgeline` |
| `status` | Стан | 5 | `rust-template:flight-hours`, `rust-template:table`, `rust-template:map`, `rust-template:weather`, `rust-template:activity` |
| `latitude` | Широта | 2 | `rust-template:map`, `rust-template:weather` |
| `longitude` | Довгота | 2 | `rust-template:map`, `rust-template:weather` |
| `order` | Порядок | 3 | `rust-template:flight-hours`, `rust-template:multi-ring`, `rust-template:funnel` |
| `note` | Примітка | 4 | `rust-template:flight-hours`, `rust-template:kpi`, `rust-template:table`, `rust-template:diverging-bars` |
<!-- registry:end -->
