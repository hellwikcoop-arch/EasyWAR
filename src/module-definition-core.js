// Реєстр визначень модулів — етап E1 дорожньої карти (docs/MODULES_ROADMAP.md, розділ 5).
//
// Реєстр нічого не малює й не переносить: він зводить в один перелік три наявні описи —
// Rust-каталог шаблонів «Мого дашборда» (`catalog()` у src-tauri/src/dashboard_modules.rs),
// каталог v1 (src/catalog-core.js, src/catalogs/ps-builtin.js) і блоки старих вкладок, які
// зашиті в код сторінок і досі ніде не описані. Перші два джерела реєстр читає як є й не копіює;
// для старих блоків тут лежить опис (LEGACY_DEFINITIONS), а тест tests/module-definition.test.mjs
// звіряє його з кодом сторінок, тож розбіжність провалює тест, а не накопичується мовчки.
//
// «Модуль» — окремий блок на екрані, який можна поставити куди завгодно (рішення власника
// 2026-10-20): шість карток основних показників ПС — шість визначень, а не один блок p-kpis.
// Застосунки «Робочого середовища» (Офіс, EasyFLY, easyPay) — не віджети й у реєстр не входять.
//
// Вимоги модулів записано смисловими ролями (ROLES), а не назвами заголовків: «Тип ЛА» у ПС
// і «Тип РСЗВ» у РВ — одна роль `platform-type`. Ролі шаблонів Rust поки технічні (категорія,
// показник…): смислові ролі для них — робота E3, тут їх не вигадуємо.

import { blockColumns, tileColumns } from './catalog-core.js';

export const REGISTRY_VERSION = 1;
export const SOURCE_CATALOGS = Object.freeze(['rust-template', 'catalog-v1', 'legacy']);
/** Роди військ так, як їх зберігає Rust (`valid_branch`): ПС, РВ, ПВК, УДШВ. */
export const BRANCHES = Object.freeze(['air', 'rocket', 'pvk', 'dshv']);

/** Де стоїть модуль. file — файл, у якому живе його код (по ньому тест шукає якорі). */
export const SURFACES = Object.freeze({
  air: { label: 'Дашборд ПС', file: 'src/air.html', branches: ['air'] },
  rocket: { label: 'Дашборд РВ', file: 'src/rocket.html', branches: ['rocket'] },
  pvk: { label: 'Дашборд ПВК', file: 'src/pvk-dashboard.js', branches: ['pvk'] },
  dshv: { label: 'Дашборд УДШВ', file: 'src/udshv-dashboard.js', branches: ['dshv'] },
  'own-losses': { label: '«Наші втрати» (ПВК, УДШВ)', file: 'src/own-losses-dashboard.js', branches: ['pvk', 'dshv'] },
  'my-dashboard': { label: '«Мій дашборд»', file: 'src/dashboard-module-catalog.js', branches: BRANCHES },
});

/**
 * Ролі, на які посилаються вимоги. from: column — стовпець таблиці; layer — дані поза таблицею
 * (контур ЛБЗ); workbook — показник книги з фіксованою структурою аркушів (ПВК, УДШВ, «Наші втрати»).
 */
export const ROLES = Object.freeze({
  'event-date': { label: 'Дата події', kind: 'semantic', from: 'column' },
  'event-time': { label: 'Час події', kind: 'semantic', from: 'column' },
  unit: { label: 'Підрозділ', kind: 'semantic', from: 'column' },
  'firing-unit': { label: 'Вогнева бригада', kind: 'semantic', from: 'column' },
  'platform-type': { label: 'Тип носія (ЛА, РСЗВ)', kind: 'semantic', from: 'column' },
  'munition-type': { label: 'Тип боєприпасу', kind: 'semantic', from: 'column' },
  'munition-count': { label: 'Кількість боєприпасів', kind: 'semantic', from: 'column' },
  'strike-result': { label: 'Результат ураження', kind: 'semantic', from: 'column' },
  'abort-flag': { label: 'Відбій', kind: 'semantic', from: 'column' },
  'target-id': { label: 'Номер цілі', kind: 'semantic', from: 'column' },
  'target-type': { label: 'Тип цілі', kind: 'semantic', from: 'column' },
  coordinates: { label: 'Координати', kind: 'semantic', from: 'column' },
  'contact-line': { label: 'Контур ЛБЗ', kind: 'semantic', from: 'layer' },
  'record-issues': { label: 'Зауваження розбору рядка', kind: 'semantic', from: 'column' },
  'report-metric': { label: 'Показник книги (аркуш | група | назва)', kind: 'semantic', from: 'workbook' },
  'journal-column': { label: 'Довільний стовпець журналу', kind: 'semantic', from: 'column' },
  // Технічні ролі полів шаблонів Rust (src/dashboard-module-charts-core.js, міграція 0010).
  category: { label: 'Категорія (вимір)', kind: 'technical', from: 'column' },
  measure: { label: 'Числовий показник', kind: 'technical', from: 'column' },
  label: { label: 'Підпис', kind: 'technical', from: 'column' },
  series: { label: 'Ряд', kind: 'technical', from: 'column' },
  status: { label: 'Стан', kind: 'technical', from: 'column' },
  latitude: { label: 'Широта', kind: 'technical', from: 'column' },
  longitude: { label: 'Довгота', kind: 'technical', from: 'column' },
  order: { label: 'Порядок', kind: 'technical', from: 'column' },
  note: { label: 'Примітка', kind: 'technical', from: 'column' },
});

/** Технічна роль поля Rust → роль реєстру. */
export const TECHNICAL_ROLE_MAP = Object.freeze({
  dimension: 'category', metric: 'measure', label: 'label', series: 'series', status: 'status',
  latitude: 'latitude', longitude: 'longitude', order: 'order', note: 'note',
});

/** Стовпці каталогу v1 → смислові ролі. Новий стовпець без ролі провалює validateRegistry. */
export const CATALOG_V1_COLUMN_ROLES = Object.freeze({
  'col.date': 'event-date',
  'col.munition': 'munition-type',
  'col.munition-count': 'munition-count',
  'col.result': 'strike-result',
  'col.abort': 'abort-flag',
});

/** Не віджети каталогу: окремі застосунки «Робочого середовища» (src/workspace/). */
export const WORKSPACE_APPS = Object.freeze(['EasyGreen', 'EasyDoc', 'EasySlide', 'EasyFLY', 'easyPay']);

/** Розділи сторінок, які є станом або обгорткою, а не модулем (тест повноти їх пропускає). */
export const NON_MODULE_SECTIONS = Object.freeze({
  'own-losses': ['Наші втрати'], // порожня сторінка до відкриття таблиці
  pvk: ['Помилки', 'Попередження', 'Інформаційно'], // незмінні лічильники блока «Перевірка даних»
});

// --- старі вкладки -------------------------------------------------------------------------

const AIR_ROCKET = [{ surface: 'air' }, { surface: 'rocket' }];
const at = (places, block) => places.map(place => ({ ...place, block }));

/** Вимога зі скороченого запису: 'role', 'role?' (необов'язкова), 'role:деталь'. */
function req(spec) {
  const [head, detail] = spec.split(/:(.*)/su);
  const optional = head.endsWith('?');
  const role = optional ? head.slice(0, -1) : head;
  return detail ? { role, required: !optional, detail } : { role, required: !optional };
}

function legacy(id, title, visual, usedIn, requirements, computation, extra = {}) {
  return { id, title, visual, usedIn, requirements: requirements.map(req), computation, ...extra };
}

const RESULT_SPLIT = 'з розбивкою за результатом ураження';

/**
 * Блоки старих вкладок. block — ідентифікатор у LAY_IDS (ПС, РВ) або точний заголовок
 * розділу/картки в коді сторінки (ПВК, УДШВ, «Наші втрати»). counterpart — визначення з тим
 * самим обчисленням в іншому джерелі; лише там, де код рахує те саме.
 */
export const LEGACY_DEFINITIONS = Object.freeze([
  // ПС і РВ: код блоків продубльовано в air.html і rocket.html (CLAUDE.md, «Пастки»).
  legacy('strike-map', 'Карта операцій', 'map', at(AIR_ROCKET, 'p-map'),
    ['coordinates', 'strike-result', 'event-date'], 'Точки координат записів за період, колір — результат; фільтр за результатом.'),
  legacy('result-dynamics', 'Результати у динаміці', 'stacked-columns', at(AIR_ROCKET, 'p-dyn'),
    ['event-date', 'strike-result'], `Кількість записів за днями або тижнями ${RESULT_SPLIT}.`),
  legacy('strike-depth', 'Глибина ураження', 'histogram', at(AIR_ROCKET, 'p-depth'),
    ['coordinates', 'contact-line', 'event-date', 'strike-result', 'munition-type?', 'abort-flag?'],
    'Медіана відстані точок запису до знімка ЛБЗ на дату запису; розподіл кроком 5 км; медіана за типом БП (від 3 записів).'),
  legacy('result-distribution', 'Розподіл результатів', 'donut', at(AIR_ROCKET, 'p-dist'),
    ['strike-result'], 'Частки результатів ураження серед записів періоду.'),
  legacy('platform-types', 'Тип носія (ЛА / РСЗВ)', 'list', at(AIR_ROCKET, 'p-plat'),
    ['platform-type'], 'Кількість записів за типом носія, перші 5, частка від усіх.'),
  legacy('munition-use', 'Використання боєприпасів', 'bars', at(AIR_ROCKET, 'p-mun'),
    ['munition-type', 'munition-count'], 'Сума кількості БП за типом: два найбільші й «Інші», частка від усіх використаних.'),
  legacy('top-units', 'Топ-5 підрозділів (за ефектом)', 'table', at(AIR_ROCKET, 'p-units'),
    ['unit', 'strike-result', 'abort-flag?'],
    'Ефективність підрозділу = (уражено + k·пошкоджено) / (записи − відбої), k = 1 або 0,75; лише підрозділи з 5+ записами.'),
  legacy('activity-by-day', 'Активність за днями', 'combo', at(AIR_ROCKET, 'p-act'),
    ['event-date', 'munition-count'], 'Кількість записів і сума БП за днями, тижнями чи місяцями; зміна до попереднього періоду.'),
  legacy('target-types', 'Тип цілі', 'list', at(AIR_ROCKET, 'p-types'),
    ['target-type'], 'Кількість записів за типом цілі, перші 12.'),
  legacy('records-journal', 'Журнал записів (вильоти / пуски)', 'table', at(AIR_ROCKET, 'p-ops'),
    ['event-date', 'munition-type?', 'munition-count?', 'strike-result?', 'target-id?'], 'Останні записи періоду з переходом до паспорта запису.'),
  legacy('repeat-targets', 'Повторні цілі', 'table', at(AIR_ROCKET, 'p-repeat'),
    ['target-id', 'target-type?', 'strike-result', 'event-date'], 'Номери цілей, що трапляються у 2+ записах; перші 8 за кількістю записів.'),
  legacy('hour-of-day', 'Час доби', 'stacked-columns', at(AIR_ROCKET, 'p-hours'),
    ['event-time', 'strike-result'], `Кількість записів за годиною доби (24 стовпці) ${RESULT_SPLIT}; пік і записи без часу.`),
  legacy('data-quality', 'Потребує перевірки в таблиці', 'list', at(AIR_ROCKET, 'p-quality'),
    ['record-issues'], 'Записи з порожніми чи нерозпізнаними полями, по 10 на сторінку.'),
  legacy('firing-units', 'Вогневі бригади', 'table', [{ surface: 'rocket', block: 'p-fire' }],
    ['firing-unit', 'strike-result'], 'Показники записів за вогневою бригадою.'),
  // Картки основних показників РВ малює власний код rocket.html (ПС бере їх із каталогу v1).
  legacy('rv-kpi-launches', 'Пуски', 'kpi', [{ surface: 'rocket', block: 'p-kpis' }],
    ['event-date'], 'Кількість записів; середнє й максимум за добу.', { counterpart: 'catalog-v1:tile.ps-sorties' }),
  legacy('rv-kpi-munitions', 'Використано БП (РВ)', 'kpi', [{ surface: 'rocket', block: 'p-kpis' }],
    ['munition-count', 'event-date'], 'Сума кількості БП; БП на пуск, максимум за добу.', { counterpart: 'catalog-v1:tile.ps-munitions' }),
  legacy('rv-kpi-destroyed', 'Знищено', 'kpi', [{ surface: 'rocket', block: 'p-kpis' }],
    ['strike-result:Знищено', 'event-date'], 'Кількість записів із результатом «Знищено»; частка від пусків.'),
  legacy('rv-kpi-damaged', 'Пошкоджено / подавлено', 'kpi', [{ surface: 'rocket', block: 'p-kpis' }],
    ['strike-result:Пошкоджено, Подавлено', 'event-date'], 'Сума записів «Пошкоджено» і «Подавлено»; частка від пусків.'),
  legacy('rv-kpi-miss', 'Не уражено (РВ)', 'kpi', [{ surface: 'rocket', block: 'p-kpis' }],
    ['strike-result:Не уражено', 'event-date'], 'Кількість записів «Не уражено»; частка; мінімум за місяць.'),
  legacy('rv-kpi-unknown', 'Не відомо (РВ)', 'kpi', [{ surface: 'rocket', block: 'p-kpis' }],
    ['strike-result:Не відомо', 'event-date'], 'Кількість записів без розпізнаного результату; показується, лише коли їх більше нуля.'),

  // ПВК: зведення книги (аркуші АА, ПС, Об'єкти) і журнал ударів «Таблиця 1».
  legacy('pvk-kpi-au', 'АУ · разом', 'kpi', [{ surface: 'pvk', block: 'АУ · разом' }],
    ['event-date', 'report-metric:АА|АУ, ПС|АУ'], 'Сума «АУ» аркушів АА і ПС за період; динаміка за днями.'),
  legacy('pvk-kpi-munitions', 'Усього БП', 'kpi', [{ surface: 'pvk', block: 'Усього БП' }],
    ['event-date', 'report-metric:АА|Боєприпаси, ПС|Боєприпаси'], 'Сума групи «Боєприпаси» аркушів АА і ПС.'),
  legacy('pvk-kpi-affected', 'Уражено (ПВК)', 'kpi', [{ surface: 'pvk', block: 'Уражено' }],
    ['event-date', 'report-metric:АА|Уражено, ПС|Уражено'], 'Сума «Уражено» аркушів АА і ПС; поруч «НЕ уражено».'),
  legacy('pvk-kpi-recon', 'Дорозвідується', 'kpi', [{ surface: 'pvk', block: 'Дорозвідується' }],
    ['event-date', 'report-metric:ПС|Дорозвідується'], 'Сума «Дорозвідується» аркуша ПС.'),
  legacy('pvk-kpi-affected-percent', '% уражених', 'kpi', [{ surface: 'pvk', block: '% уражених' }],
    ['event-date', 'report-metric:АА|Уражено, ПС|Уражено, АА|НЕ уражено, ПС|НЕ уражено'], 'Уражено / (Уражено + НЕ уражено), без «Дорозвідується».'),
  legacy('pvk-kpi-objects', 'Уражені об’єкти', 'kpi', [{ surface: 'pvk', block: 'Уражені об’єкти' }],
    ['event-date', 'report-metric:Об\'єкти|*'], 'Сума показників аркуша «Об\'єкти» без «Витрата».'),
  legacy('pvk-kpi-expenditure', 'Витрата (ПВК)', 'kpi', [{ surface: 'pvk', block: 'Витрата' }],
    ['event-date', 'report-metric:Об\'єкти|Витрата'], 'Сума показника «Витрата» окремо від об\'єктів.'),
  legacy('pvk-kpi-journal', 'Таблиця 1 (записів у журналі)', 'kpi', [{ surface: 'pvk', block: 'Таблиця 1' }],
    ['event-date'], 'Кількість записів журналу ударів за період; немає журналу — картки немає.'),
  legacy('pvk-activity-calendar', 'Календар активності (ПВК)', 'calendar', [{ surface: 'pvk', block: 'Календар активності' }],
    ['event-date', 'report-metric:АА|АУ, ПС|АУ'], 'Сума АУ за днями періоду.'),
  legacy('pvk-dynamics', 'Загальна динаміка', 'line', [{ surface: 'pvk', block: 'Загальна динаміка' }],
    ['event-date', 'report-metric:АУ, Боєприпаси, Уражено, Об\'єкти, Витрата'], 'Лінії основних показників за днями періоду.'),
  legacy('pvk-sheet-groups', 'Аркуш книги: групи показників', 'cards', [{ surface: 'pvk', block: 'groupOverview(group, sheet)' }],
    ['event-date', 'report-metric:<аркуш>|<група>|*'], 'Для кожної групи аркуша — підсумки показників за період і зміна до попереднього.'),
  legacy('pvk-journal-records-kpi', 'Записів (журнал)', 'kpi', [{ surface: 'pvk', block: 'Записів' }],
    ['event-date'], 'Кількість ударів за період.'),
  legacy('pvk-journal-days', 'Днів з ударами', 'kpi', [{ surface: 'pvk', block: 'Днів з ударами' }],
    ['event-date'], 'Кількість різних дат із записами.'),
  legacy('pvk-journal-targets', 'Унікальних цілей', 'kpi', [{ surface: 'pvk', block: 'Унікальних цілей' }],
    ['target-id'], 'Кількість різних «Номер цілі»; немає стовпця — картки немає.'),
  legacy('pvk-journal-coordinates', 'Із координатами', 'kpi', [{ surface: 'pvk', block: 'Із координатами' }],
    ['coordinates'], 'Кількість записів із координатами й без них.'),
  legacy('pvk-journal-confirmed', 'Підтверджено відео', 'kpi', [{ surface: 'pvk', block: 'Підтверджено відео' }],
    ['journal-column:Фактичні приходи', 'journal-column:Витрата АЗУ'], 'Фактичні приходи / витрата АЗУ, відсотком.'),
  legacy('pvk-journal-by-day', 'Удари за днями', 'columns', [{ surface: 'pvk', block: 'Удари за днями' }],
    ['event-date'], 'Кількість записів журналу за днями.'),
  legacy('pvk-journal-hours', 'Час удару', 'columns', [{ surface: 'pvk', block: 'Час удару' }],
    ['event-time'], 'Розподіл записів за годинами доби; лише коли є стовпець часу.'),
  legacy('pvk-journal-columns', 'Усі стовпці журналу', 'cards', [{ surface: 'pvk', block: 'Усі стовпці журналу' }],
    ['journal-column'], 'Для кожного стовпця — картка за його видом (число, дата, текст, координати).'),
  legacy('pvk-journal-list', 'Записи журналу ударів', 'table', [{ surface: 'pvk', block: 'Записи' }],
    ['journal-column'], 'Пошук і вивантаження CSV записів журналу.'),
  legacy('pvk-pivot', 'Зведена таблиця за період (ПВК)', 'table', [{ surface: 'pvk', block: 'Зведена таблиця за період' }],
    ['event-date', 'report-metric'], 'Суми показників аркушів за період, CSV.'),
  legacy('pvk-quality', 'Перевірка даних (ПВК)', 'list', [{ surface: 'pvk', block: 'Перевірка даних' }],
    ['report-metric'], 'Помилки, попередження й інформаційні зауваження книги, згруповані.'),

  // УДШВ: книга «підрозділ × день» (src/udshv-dashboard-core.js). KPI — масив KPI ядра.
  legacy('udshv-kpi-kia', '200', 'kpi', [{ surface: 'dshv', block: 'kpi:kia' }], ['event-date', 'unit', 'report-metric:Втрати о/с|200'], 'Сума «200».'),
  legacy('udshv-kpi-wia', '300', 'kpi', [{ surface: 'dshv', block: 'kpi:wia' }], ['event-date', 'unit', 'report-metric:Втрати о/с|300'], 'Сума «300».'),
  legacy('udshv-kpi-personnel', 'Втрати о/с разом', 'kpi', [{ surface: 'dshv', block: 'kpi:personnel' }], ['event-date', 'unit', 'report-metric:Втрати о/с|*'], 'Сума групи «Втрати о/с».'),
  legacy('udshv-kpi-destroyed', 'ОВТ знищено', 'kpi', [{ surface: 'dshv', block: 'kpi:destroyed' }], ['event-date', 'unit', 'report-metric:ЗНИЩЕНО|*'], 'Сума групи «ЗНИЩЕНО».'),
  legacy('udshv-kpi-damaged', 'ОВТ пошкоджено', 'kpi', [{ surface: 'dshv', block: 'kpi:damaged' }], ['event-date', 'unit', 'report-metric:ПОШКОДЖЕНО|*'], 'Сума групи «ПОШКОДЖЕНО».'),
  legacy('udshv-kpi-suppressed', 'ОВТ подавлено', 'kpi', [{ surface: 'dshv', block: 'kpi:suppressed' }], ['event-date', 'unit', 'report-metric:ПОДАВЛЕНО|*'], 'Сума групи «ПОДАВЛЕНО».'),
  legacy('udshv-kpi-ammo', 'Витрата БК', 'kpi', [{ surface: 'dshv', block: 'kpi:ammo' }], ['event-date', 'unit', 'report-metric:Витрата боєприпасів|ВСЬОГО'], 'Підсумок «ВСЬОГО» витрати БК.'),
  legacy('udshv-kpi-vgz', 'ВгЗ', 'kpi', [{ surface: 'dshv', block: 'kpi:vgz' }], ['event-date', 'unit', 'report-metric:Вогневі засоби|ВгЗ'], 'Сума вогневих завдань.'),
  legacy('udshv-kpi-kbb', 'КББ', 'kpi', [{ surface: 'dshv', block: 'kpi:kbb' }], ['event-date', 'unit', 'report-metric:Вогневі засоби|КББ'], 'Сума контрбатарейної боротьби.'),
  legacy('udshv-personnel-series', 'Втрати о/с противника', 'stacked-columns', [{ surface: 'dshv', block: 'Втрати о/с противника' }],
    ['event-date', 'unit', 'report-metric:Втрати о/с|*'], '200 і 300 за днями, тижнями чи місяцями; клік відкриває період.'),
  legacy('udshv-ovt-series', 'ОВТ: знищено / пошкоджено / подавлено', 'stacked-columns', [{ surface: 'dshv', block: 'ОВТ: знищено / пошкоджено / подавлено' }],
    ['event-date', 'unit', 'report-metric:ЗНИЩЕНО|*, ПОШКОДЖЕНО|*, ПОДАВЛЕНО|*'], 'Три групи ОВТ за днями, тижнями чи місяцями.'),
  legacy('udshv-units-personnel', 'Підрозділи за втратами о/с', 'bars', [{ surface: 'dshv', block: 'Підрозділи за втратами о/с' }],
    ['unit', 'report-metric:Втрати о/с|*'], 'Сума втрат о/с за підрозділом, перші 13.'),
  legacy('udshv-destroyed-top', 'Знищено ОВТ — топ', 'bars', [{ surface: 'dshv', block: 'Знищено ОВТ — топ' }],
    ['report-metric:ЗНИЩЕНО|*'], 'Перші 10 типів ОВТ за кількістю знищених.'),
  legacy('udshv-categories', 'Втрати за категоріями', 'bars', [{ surface: 'dshv', block: 'Втрати за категоріями' }],
    ['report-metric:Втрати противника за категоріями|*'], 'Перші 10 (на сторінці БК — 20) категорій втрат противника.'),
  legacy('udshv-units-table', 'Підрозділи (УДШВ)', 'table', [{ surface: 'dshv', block: 'Підрозділи' }],
    ['unit', 'event-date', 'report-metric'], 'Таблиця підрозділів: о/с, 200, 300, ОВТ, БК, ВгЗ, КББ, дні; сортування й фільтр.'),
  legacy('udshv-personnel-dynamics', 'Динаміка 200 / 300', 'stacked-columns', [{ surface: 'dshv', block: 'Динаміка 200 / 300' }],
    ['event-date', 'report-metric:Втрати о/с|200, Втрати о/с|300'], '200 і 300 за періодами; середнє на добу з даними.'),
  legacy('udshv-units-200-300', 'Підрозділи: 200 і 300', 'bars', [{ surface: 'dshv', block: 'Підрозділи: 200 і 300' }],
    ['unit', 'report-metric:Втрати о/с|200, Втрати о/с|300'], 'Смуги 200 і 300 за підрозділом.'),
  legacy('udshv-weekday', 'За днями тижня', 'columns', [{ surface: 'dshv', block: 'За днями тижня' }],
    ['event-date', 'report-metric:Втрати о/с|*'], 'Втрати о/с разом за днем тижня.'),
  legacy('udshv-ovt-types', 'Група ОВТ: типи', 'bars', [{ surface: 'dshv', block: ': типи ОВТ' }],
    ['report-metric:ЗНИЩЕНО|*, ПОШКОДЖЕНО|*, ПОДАВЛЕНО|*'], 'Типи ОВТ обраної групи за період і за весь час.'),
  legacy('udshv-ovt-dynamics', 'Динаміка групи ОВТ', 'stacked-columns', [{ surface: 'dshv', block: 'Динаміка' }],
    ['event-date', 'report-metric:ЗНИЩЕНО|*, ПОШКОДЖЕНО|*, ПОДАВЛЕНО|*'], 'Обрана група ОВТ за періодами.'),
  legacy('udshv-ovt-heatmap', 'Група ОВТ: підрозділ × тип', 'heatmap', [{ surface: 'dshv', block: ': підрозділ × тип' }],
    ['unit', 'report-metric:ЗНИЩЕНО|*, ПОШКОДЖЕНО|*, ПОДАВЛЕНО|*'], 'Матриця підрозділ × тип ОВТ для обраної групи.'),
  legacy('udshv-ammo-types', 'Витрата за типами боєприпасів', 'bars', [{ surface: 'dshv', block: 'Витрата за типами боєприпасів' }],
    ['report-metric:Витрата боєприпасів|*'], 'Перші 20 типів БК за витратою, без «ВСЬОГО».'),
  legacy('udshv-ammo-heatmap', 'Витрата БК: підрозділ × тип', 'heatmap', [{ surface: 'dshv', block: 'Витрата БК: підрозділ × тип' }],
    ['unit', 'report-metric:Витрата боєприпасів|*'], 'Матриця підрозділ × тип БК.'),
  legacy('udshv-pivot', 'Зведена таблиця за період (УДШВ)', 'table', [{ surface: 'dshv', block: 'Зведена таблиця за період' }],
    ['event-date', 'unit', 'report-metric'], 'Суми показників за групами за період і підрозділами, CSV.'),
  legacy('udshv-freshness', 'Актуальність підрозділів', 'table', [{ surface: 'dshv', block: 'Актуальність підрозділів' }],
    ['unit', 'event-date'], 'Остання дата даних підрозділу; без свіжих даних довше 7 діб; дні з даними за 30.'),
  legacy('udshv-sheets', 'Аркуші книги', 'table', [{ surface: 'dshv', block: 'Аркуші' }],
    ['event-date', 'report-metric'], 'Аркуші: днів, рядків, показників, період.'),
  legacy('udshv-quality', 'Перевірка даних (УДШВ)', 'list', [{ surface: 'dshv', block: 'Перевірка даних' }],
    ['report-metric'], 'Зауваження книги, згруповані за текстом.'),

  // «Наші втрати»: окрема таблиця, однаковий код у ПВК і УДШВ. KPI — масив ядра.
  legacy('own-kpi-200', '200 (наші)', 'kpi', [{ surface: 'own-losses', block: 'kpi:k200' }], ['event-date', 'unit', 'report-metric:Втрати о/с|200'], 'Сума «200».'),
  legacy('own-kpi-300', '300 (наші)', 'kpi', [{ surface: 'own-losses', block: 'kpi:k300' }], ['event-date', 'unit', 'report-metric:Втрати о/с|300'], 'Сума «300».'),
  legacy('own-kpi-500', '500 (наші)', 'kpi', [{ surface: 'own-losses', block: 'kpi:k500' }], ['event-date', 'unit', 'report-metric:Втрати о/с|500'], 'Сума «500».'),
  legacy('own-kpi-personnel', 'Втрати о/с разом (наші)', 'kpi', [{ surface: 'own-losses', block: 'kpi:personnel' }], ['event-date', 'unit', 'report-metric:Втрати о/с|*'], 'Сума всіх показників групи «Втрати о/с».'),
  legacy('own-kpi-destroyed', 'Арт. системи знищено', 'kpi', [{ surface: 'own-losses', block: 'kpi:destroyed' }], ['event-date', 'unit', 'report-metric:destroyed|*'], 'Сума знищених арт. систем.'),
  legacy('own-kpi-damaged', 'Арт. системи пошкоджено', 'kpi', [{ surface: 'own-losses', block: 'kpi:damaged' }], ['event-date', 'unit', 'report-metric:damaged|*'], 'Сума пошкоджених арт. систем.'),
  legacy('own-kpi-out-of-order', 'Вийшли з ладу', 'kpi', [{ surface: 'own-losses', block: 'kpi:outOfOrder' }], ['event-date', 'unit', 'report-metric:outOfOrder|*'], 'Сума систем, що вийшли з ладу за технічним станом.'),
  legacy('own-personnel-series', 'Втрати о/с (наші)', 'stacked-columns', [{ surface: 'own-losses', block: 'Втрати о/с' }],
    ['event-date', 'report-metric:Втрати о/с|*'], '200, 300, 500 за днями, тижнями чи місяцями.'),
  legacy('own-units', 'Підрозділи (наші втрати)', 'table', [{ surface: 'own-losses', block: 'Підрозділи' }],
    ['unit', 'report-metric'], 'Втрати за підрозділом; клік фільтрує.'),
  legacy('own-causes', 'Дія противника (втрати о/с)', 'bars', [{ surface: 'own-losses', block: 'Дія противника (втрати о/с)' }],
    ['report-metric:cause|*'], 'Перші 10 дій противника за кількістю випадків.'),
  legacy('own-destroyed-types', 'Арт. системи: знищені', 'bars', [{ surface: 'own-losses', block: 'Арт. системи: знищені' }],
    ['report-metric:destroyed|*'], 'Перші 10 типів знищених арт. систем.'),
  legacy('own-damaged-types', 'Арт. системи: пошкоджені', 'bars', [{ surface: 'own-losses', block: 'Арт. системи: пошкоджені' }],
    ['report-metric:damaged|*'], 'Перші 10 типів пошкоджених арт. систем.'),
  legacy('own-events', 'Журнал подій', 'table', [{ surface: 'own-losses', block: 'Журнал подій' }],
    ['event-date', 'unit', 'report-metric'], 'Події за період.'),
  legacy('own-quality', 'Перевірка даних (наші втрати)', 'list', [{ surface: 'own-losses', block: 'Перевірка даних' }],
    ['report-metric'], 'Рядки з підозрілою чи непрочитаною датою й інші зауваження.'),
]);

// --- зведення джерел ------------------------------------------------------------------------

function branchesOf(usedIn) {
  const set = new Set();
  for (const place of usedIn) for (const branch of SURFACES[place.surface]?.branches || []) set.add(branch);
  return BRANCHES.filter(branch => set.has(branch));
}

const AGG_TEXT = { sum: 'сума', avg: 'середнє', count: 'кількість', max: 'максимум', min: 'мінімум', none: '' };

/** Визначення з шаблонів Rust (вхід — rustCatalog() у тестах або get_dashboard_module_catalog у застосунку). */
export function fromRustTemplates(templates) {
  return (Array.isArray(templates) ? templates : []).map(template => {
    const fields = Array.isArray(template.fields) ? template.fields : [];
    const metrics = fields.filter(field => field.role === 'metric')
      .map(field => `«${field.label}» — ${AGG_TEXT[field.aggregation] ?? field.aggregation}`);
    const dims = fields.filter(field => field.role === 'dimension' && field.required).map(field => `«${field.label}»`);
    return {
      definitionId: `rust-template:${template.id}`,
      version: REGISTRY_VERSION,
      sourceCatalog: 'rust-template',
      sourceId: template.id,
      title: template.title,
      visual: template.visualKind ?? template.visual_kind,
      branchTags: [...BRANCHES],
      usedIn: [{ surface: 'my-dashboard', block: template.id }],
      requirements: fields.map(field => ({
        role: TECHNICAL_ROLE_MAP[field.role] || field.role, required: field.required === true, column: field.key, type: field.dataType,
      })),
      computation: [dims.length ? `за ${dims.join(', ')}` : '', metrics.join('; ')].filter(Boolean).join(': ') || 'Рядки таблиці модуля без агрегації.',
    };
  });
}

const OP_TEXT = { eq: '=', ne: '≠', in: 'одне з', notin: 'жодне з', gt: '>', gte: '≥', lt: '<', lte: '≤', empty: 'порожнє', notempty: 'не порожнє' };

function measureText(measure, columns) {
  if (!measure) return '';
  const name = id => `«${columns.get(id)?.labels?.[0] || id}»`;
  const what = measure.agg === 'count' ? 'кількість записів' : `${AGG_TEXT[measure.agg] || measure.agg} ${measure.column ? name(measure.column) : ''}`.trim();
  const filter = (measure.filter || []).map(item => [name(item.column), OP_TEXT[item.op] || item.op, item.value === undefined ? '' : `«${item.value}»`].filter(Boolean).join(' ')).join(' і ');
  return filter ? `${what}, де ${filter}` : what;
}

/**
 * Визначення з каталогів v1: кожна плитка — окреме визначення (картки ПС), блоки, крім
 * контейнера плиток, — теж. Блок «tiles» — розкладка, а не модуль.
 */
export function fromCatalogV1(catalogs, { tileUsage = {}, blockUsage = {} } = {}) {
  const out = [];
  for (const catalog of Array.isArray(catalogs) ? catalogs : []) {
    const columns = new Map((catalog.columns || []).map(column => [column.id, column]));
    const tiles = new Map((catalog.tiles || []).map(tile => [tile.id, tile]));
    const asReq = ids => ids.map(id => ({ role: CATALOG_V1_COLUMN_ROLES[id] || `?${id}`, required: true, column: id, type: columns.get(id)?.type }));
    for (const tile of catalog.tiles || []) {
      out.push({
        definitionId: `catalog-v1:${tile.id}`, version: REGISTRY_VERSION, sourceCatalog: 'catalog-v1', sourceId: tile.id,
        catalogId: catalog.id, title: tile.label, visual: 'kpi', usedIn: tileUsage[tile.id] || [],
        requirements: asReq(tileColumns(tile)), computation: `${measureText(tile.measure, columns)}.`,
      });
    }
    for (const block of catalog.blocks || []) {
      if (block.kind === 'tiles') continue;
      out.push({
        definitionId: `catalog-v1:${block.id}`, version: REGISTRY_VERSION, sourceCatalog: 'catalog-v1', sourceId: block.id,
        catalogId: catalog.id, title: block.title, visual: block.kind, usedIn: blockUsage[block.id] || [],
        requirements: asReq(blockColumns(block, id => tiles.get(id))),
        computation: block.kind === 'table' ? 'Рядки зі стовпцями блока.' : `${measureText(block.measure, columns)} за «${columns.get(block.by)?.labels?.[0] || block.by}».`,
      });
    }
  }
  for (const item of out) item.branchTags = branchesOf(item.usedIn);
  return out;
}

export function fromLegacy(descriptors = LEGACY_DEFINITIONS) {
  return descriptors.map(item => ({
    definitionId: `legacy:${item.id}`, version: REGISTRY_VERSION, sourceCatalog: 'legacy', sourceId: item.id,
    title: item.title, visual: item.visual, usedIn: item.usedIn, branchTags: branchesOf(item.usedIn),
    requirements: item.requirements, computation: item.computation, ...(item.counterpart ? { counterpart: item.counterpart } : {}),
  }));
}

/** Де в air.html малюються визначення каталогу v1 (src/ps-kpi.js: KPI_TILES, VIEW_BY_BLOCK). */
export function psCatalogUsage(kpiTiles = [], viewByBlock = {}) {
  return {
    tileUsage: Object.fromEntries(kpiTiles.map(id => [id, [{ surface: 'air', block: 'p-kpis' }]])),
    blockUsage: Object.fromEntries(Object.entries(viewByBlock).map(([id, view]) => [id, [{ surface: 'air', block: `view:${view}` }]])),
  };
}

/** Повний перелік: Rust-шаблони, каталог v1 і старі вкладки, у стабільному порядку. */
export function listDefinitions({ rustTemplates = [], catalogs = [], catalogUsage = {}, legacy = LEGACY_DEFINITIONS } = {}) {
  return [...fromRustTemplates(rustTemplates), ...fromCatalogV1(catalogs, catalogUsage), ...fromLegacy(legacy)];
}

/** Перелік проблем реєстру; порожній масив — реєстр узгоджений. */
export function validateRegistry(definitions) {
  const problems = [];
  const ids = new Set();
  for (const item of definitions) {
    if (ids.has(item.definitionId)) problems.push(`повторний ідентифікатор ${item.definitionId}`);
    ids.add(item.definitionId);
    if (!SOURCE_CATALOGS.includes(item.sourceCatalog)) problems.push(`${item.definitionId}: невідоме джерело ${item.sourceCatalog}`);
    if (!item.title) problems.push(`${item.definitionId}: немає назви`);
    if (!item.computation) problems.push(`${item.definitionId}: не описано обчислення`);
    if (!item.requirements.length) problems.push(`${item.definitionId}: немає вимог до даних`);
    for (const requirement of item.requirements) {
      if (!ROLES[requirement.role]) problems.push(`${item.definitionId}: невідома роль ${requirement.role}`);
    }
    for (const place of item.usedIn) {
      if (!SURFACES[place.surface]) problems.push(`${item.definitionId}: невідоме місце ${place.surface}`);
    }
    if (WORKSPACE_APPS.some(app => item.title.toLowerCase().includes(app.toLowerCase()))) {
      problems.push(`${item.definitionId}: застосунок «Робочого середовища» не є модулем`);
    }
  }
  for (const item of definitions) {
    if (item.counterpart && !ids.has(item.counterpart)) problems.push(`${item.definitionId}: немає відповідника ${item.counterpart}`);
  }
  return problems;
}

export function requirementsFor(definitions, definitionId) {
  const item = definitions.find(entry => entry.definitionId === definitionId);
  if (!item) throw new Error(`немає визначення ${definitionId}`);
  return item.requirements.map(requirement => ({ ...requirement }));
}

/** Визначення, яким потрібна роль (обов'язково або за бажанням). */
export function dependentsOf(definitions, role, { requiredOnly = false } = {}) {
  return definitions
    .filter(item => item.requirements.some(requirement => requirement.role === role && (!requiredOnly || requirement.required)))
    .map(item => item.definitionId);
}

/** Граф залежностей: роль → визначення й визначення → ролі. */
export function dependencyGraph(definitions) {
  const byRole = Object.fromEntries(Object.keys(ROLES).map(role => [role, dependentsOf(definitions, role)]));
  const byDefinition = Object.fromEntries(definitions.map(item => [item.definitionId, [...new Set(item.requirements.map(r => r.role))]]));
  return { byRole, byDefinition };
}

const escapeCell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Таблиці для docs/MODULE_DEFINITIONS.md (той самий текст перевіряє тест). */
export function registryMarkdown(definitions) {
  const lines = [];
  const reqText = item => item.requirements
    .map(r => `${r.role}${r.required ? '' : '?'}${r.detail ? ` (${r.detail})` : ''}`).join(', ');
  const where = item => item.usedIn.map(place => `${place.surface}: ${place.block}`).join('; ') || 'не малюється';
  for (const source of SOURCE_CATALOGS) {
    const items = definitions.filter(item => item.sourceCatalog === source);
    lines.push(`### ${source} (${items.length})`, '', '| Визначення | Назва | Вигляд | Роди | Де | Вимоги | Обчислення |', '|---|---|---|---|---|---|---|');
    for (const item of items) {
      lines.push(`| \`${item.definitionId}\` | ${escapeCell(item.title)} | ${item.visual} | ${item.branchTags.join(', ')} | ${escapeCell(where(item))} | ${escapeCell(reqText(item))} | ${escapeCell(item.computation)}${item.counterpart ? ` Відповідник: \`${item.counterpart}\`.` : ''} |`);
    }
    lines.push('');
  }
  const graph = dependencyGraph(definitions);
  lines.push('### Граф залежностей: роль → визначення', '', '| Роль | Що це | Визначень | Визначення |', '|---|---|---|---|');
  for (const [role, info] of Object.entries(ROLES)) {
    const list = graph.byRole[role];
    lines.push(`| \`${role}\` | ${info.label} | ${list.length} | ${list.map(id => `\`${id}\``).join(', ') || '—'} |`);
  }
  return lines.join('\n') + '\n';
}
