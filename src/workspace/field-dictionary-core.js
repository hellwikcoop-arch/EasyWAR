// Словник полів шаблонів «Офісу»: з даних джерела (команда library_source_data) будує контекст
// для template-core.js — { fields, blocks } з українськими назвами полів
// (plans/ofis-realizatsiia.md, розд. 6). Значення вже готові для документа: числа українською
// (кома в дробовій частині), відсотки «72,5 %», дати ДД.ММ.РРРР, відсутнє значення — «—».
// Чисті функції без DOM, Tauri і годинника: поточну дату передає виклик (`now`).
// Перевірка — tests/field-dictionary.test.mjs.
import { formatNumber } from './template-core.js';

/** Чим позначається відсутнє значення (null у даних джерела). */
export const EMPTY_VALUE = '—';

/** Джерела даних шаблону в порядку вибору в інтерфейсі. */
export const SOURCE_KINDS = Object.freeze([
  Object.freeze({ id: 'approved_revisions', label: 'Схвалені записи' }),
  Object.freeze({ id: 'dashboard_module', label: 'Модуль дашборда' }),
  Object.freeze({ id: 'library_table', label: 'Таблиця з бібліотеки' }),
]);

export function sourceKindLabel(id) {
  return SOURCE_KINDS.find(kind => kind.id === id)?.label ?? '';
}

export const RESULT_LABELS = Object.freeze({ hit: 'Уражено', partial: 'Частково', miss: 'Не уражено', unknown: 'Невідомо' });

// Назва, яку можна записати в шаблоні як {{назва}} (те саме правило, що в template-core.js).
const FIELD_NAME = /^[\p{L}\p{M}\p{N}_.]+$/u;
// Без даних таблиці довідка показує стільки колонок-прикладів.
const SAMPLE_TABLE_COLUMNS = 3;

const COMMON_FIELDS = Object.freeze([
  ['дата', 'Дата створення документа'],
  ['профіль.назва', 'Назва профілю'],
  ['профіль.посада', 'Посада'],
  ['профіль.роль', 'Роль у робочому середовищі'],
]);

const APPROVED_FIELDS = Object.freeze([
  ['період.з', 'Початок періоду'],
  ['період.по', 'Кінець періоду'],
  ['зведення.усього', 'Усього записів'],
  ['зведення.скасовано', 'Скасовано (відбій)'],
  ['зведення.оцінено', 'Оцінено'],
  ['зведення.уражено', 'Уражено'],
  ['зведення.частково', 'Частково уражено'],
  ['зведення.не_уражено', 'Не уражено'],
  ['зведення.невідомо', 'Результат невідомий'],
  ['зведення.ефективність', 'Ефективність, %'],
  ['зведення.ефективність_dpi', 'Ефективність за DPI, %'],
]);

const RECORD_FIELDS = Object.freeze([
  ['номер', 'Порядковий номер (1, 2, …)'],
  ['дата', 'Дата'],
  ['час', 'Час ураження'],
  ['цілі', '№ цілі'],
  ['підрозділ', 'В інтересах'],
  ['район', 'Район / н.п.'],
  ['координати', 'DPI / координати MGRS'],
  ['типи_цілей', 'Тип цілі'],
  ['тип_ла', 'Тип ЛА'],
  ['боєприпас', 'Тип боєприпасу'],
  ['кількість', 'Кількість боєприпасів'],
  ['результат', 'Результат ураження'],
  ['скасовано', 'Скасовано (так/ні)'],
  ['причина', 'Причина'],
  ['примітка', 'Уточнення результату'],
]);

const BREAKDOWN_FIELDS = Object.freeze([
  ['номер', 'Порядковий номер (1, 2, …)'],
  ['значення', 'Значення групи'],
  ['записів', 'Записів'],
  ['боєприпасів', 'Боєприпасів'],
  ['ефективність', 'Ефективність, %'],
]);

// Блок → вимір розбивки з analytics.rs (exportViews.breakdowns[].dimension).
const BREAKDOWN_BLOCKS = Object.freeze([
  ['за_ла', 'aircraft', 'За типом ЛА'],
  ['за_боєприпасами', 'munition', 'За боєприпасами'],
  ['за_підрозділами', 'unit', 'За підрозділами'],
]);

const BLOCK_LABELS = Object.freeze({
  approved_revisions: Object.freeze([['записи', 'Записи'], ...BREAKDOWN_BLOCKS.map(([name, , label]) => [name, label])]),
  dashboard_module: Object.freeze([['рядки', 'Рядки модуля']]),
  library_table: Object.freeze([['рядки', 'Рядки таблиці']]),
});

// ---------------------------------------------------------------------------------------------
// Форматування значень

const pad = number => String(number).padStart(2, '0');

const textValue = value => (value === null || value === undefined ? EMPTY_VALUE : String(value));

const countValue = value =>
  typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : textValue(value);

/** Відсоток: 72.5 → «72,5 %» (до одного знака після коми); null → «—». */
export function formatPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value, 1)} %` : EMPTY_VALUE;
}

/** Дата РРРР-ММ-ДД → ДД.ММ.РРРР; інший текст лишається як є; null → «—». */
export function formatDate(value) {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : text;
}

// Дата й час ISO → ДД.ММ.РРРР ГГ:ХХ так, як записано в рядку (без перерахунку поясу).
function dateTimeValue(value) {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  return match ? `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}` : formatDate(text);
}

const yesNo = value => (value === null || value === undefined ? EMPTY_VALUE : value ? 'так' : 'ні');

function listValue(value) {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (!Array.isArray(value)) return String(value);
  return value.filter(part => part !== null && part !== undefined && String(part).trim() !== '').map(String).join(', ');
}

function resultLabel(code) {
  if (code === null || code === undefined) return EMPTY_VALUE;
  return Object.hasOwn(RESULT_LABELS, code) ? RESULT_LABELS[code] : String(code);
}

// Сьогоднішня дата: Date — за місцевим часом пристрою; рядок РРРР-ММ-ДД… — як записано.
function todayText(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) {
    return `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  }
  if (typeof now === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(now);
    if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  }
  return EMPTY_VALUE;
}

/** Назва колонки таблиці за номером з нуля: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index) {
  let number = Math.trunc(Number(index)) + 1;
  if (!Number.isFinite(number) || number < 1) return '';
  let name = '';
  while (number > 0) {
    const rest = (number - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

// Елементи блоку з порядковим номером 1..n (номер — текст, як інші поля).
const numbered = list => list.map((fields, i) => ({ fields: { 'номер': String(i + 1), ...fields } }));

// ---------------------------------------------------------------------------------------------
// Джерела

function recordFields(record) {
  const r = record && typeof record === 'object' ? record : {};
  const issues = Array.isArray(r.qualityIssues) ? r.qualityIssues : [];
  // Якщо кількість не прочитано, у записі 0 — показуємо те, що було в таблиці.
  const countBroken = issues.includes('missing_munition_count') || issues.includes('invalid_munition_count');
  return {
    'дата': r.date ? formatDate(r.date) : String(r.dateRaw ?? '').trim() || EMPTY_VALUE,
    'час': textValue(r.time),
    'цілі': listValue(r.targetIds),
    'підрозділ': textValue(r.unit),
    'район': textValue(r.district),
    'координати': textValue(r.coordinates),
    'типи_цілей': listValue(r.targetTypes),
    'тип_ла': textValue(r.aircraft),
    'боєприпас': textValue(r.munition),
    'кількість': countBroken ? String(r.munitionCountRaw ?? '').trim() || EMPTY_VALUE : countValue(r.munitionCount),
    'результат': resultLabel(r.result),
    'скасовано': yesNo(r.aborted),
    'причина': textValue(r.cause),
    'примітка': textValue(r.note),
  };
}

function breakdownFields(group) {
  const g = group && typeof group === 'object' ? group : {};
  return {
    'значення': textValue(g.value),
    'записів': countValue(g.recordCount),
    'боєприпасів': countValue(g.munitionCount),
    'ефективність': formatPercent(g.overallEffectPercent),
  };
}

function approvedContext(data, fields, blocks) {
  const period = data.period && typeof data.period === 'object' ? data.period : {};
  const overview = data.overview && typeof data.overview === 'object' ? data.overview : {};
  fields['період.з'] = formatDate(period.from);
  fields['період.по'] = formatDate(period.to);
  fields['зведення.усього'] = countValue(overview.totalRecords);
  fields['зведення.скасовано'] = countValue(overview.abortedRecords);
  fields['зведення.оцінено'] = countValue(overview.evaluatedRecords);
  fields['зведення.уражено'] = countValue(overview.hitRecords);
  fields['зведення.частково'] = countValue(overview.partialRecords);
  fields['зведення.не_уражено'] = countValue(overview.missRecords);
  fields['зведення.невідомо'] = countValue(overview.unknownRecords);
  fields['зведення.ефективність'] = formatPercent(overview.overallEffectPercent);
  fields['зведення.ефективність_dpi'] = formatPercent(overview.dpiEffectPercent);
  blocks['записи'] = numbered((Array.isArray(data.records) ? data.records : []).map(recordFields));
  const breakdowns = Array.isArray(data.breakdowns) ? data.breakdowns : [];
  for (const [name, dimension] of BREAKDOWN_BLOCKS) {
    blocks[name] = numbered(breakdowns.filter(group => group?.dimension === dimension).map(breakdownFields));
  }
}

const moduleFieldsOf = module =>
  (Array.isArray(module?.fields) ? module.fields : []).filter(
    field => field && typeof field.key === 'string' && FIELD_NAME.test(field.key) && field.key !== 'номер',
  );

function moduleValue(value, dataType) {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === 'boolean') return yesNo(value);
  if (dataType === 'boolean' && typeof value === 'number') return yesNo(value !== 0);
  if (typeof value === 'number') return formatNumber(value);
  if (dataType === 'date') return formatDate(value);
  if (dataType === 'datetime') return dateTimeValue(value);
  return String(value);
}

function moduleContext(data, fields, blocks) {
  const module = data.module && typeof data.module === 'object' ? data.module : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const moduleFields = moduleFieldsOf(module);
  fields['модуль.назва'] = textValue(module.title);
  fields['модуль.рядків'] = countValue(rows.length);
  blocks['рядки'] = numbered(rows.map(row => {
    const item = {};
    for (const field of moduleFields) {
      const value = row && typeof row === 'object' && Object.hasOwn(row, field.key) ? row[field.key] : null;
      item[field.key] = moduleValue(value, field.dataType);
    }
    return item;
  }));
}

function tableColumns(data) {
  const headers = Array.isArray(data?.headers) ? data.headers : [];
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const count = headers.length || rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  return { headers, rows, count };
}

function tableContext(data, fields, blocks) {
  const table = data.table && typeof data.table === 'object' ? data.table : {};
  const { rows, count } = tableColumns(data);
  fields['таблиця.назва'] = textValue(table.name);
  fields['таблиця.рядків'] = countValue(rows.length);
  // Клітинки — текст як у таблиці; бракує клітинки в короткому рядку → порожньо.
  blocks['рядки'] = numbered(rows.map(row => {
    const item = {};
    for (let column = 0; column < count; column += 1) {
      const cell = Array.isArray(row) ? row[column] : undefined;
      item[columnName(column)] = cell === undefined ? '' : cell === null ? EMPTY_VALUE : String(cell);
    }
    return item;
  }));
}

const CONTEXT_BUILDERS = Object.freeze({
  approved_revisions: approvedContext,
  dashboard_module: moduleContext,
  library_table: tableContext,
});

function builderFor(sourceKind) {
  if (typeof sourceKind !== 'string' || !Object.hasOwn(CONTEXT_BUILDERS, sourceKind)) {
    throw new Error(`Невідоме джерело даних шаблону «${String(sourceKind ?? '')}».`);
  }
  return CONTEXT_BUILDERS[sourceKind];
}

/**
 * Контекст шаблону з відповіді library_source_data: { fields, blocks }, де blocks — масиви
 * { fields } з полем «номер» 1..n. `profile` — { displayName, position, role } з тієї самої
 * відповіді, `now` — Date (дата за місцевим часом) або рядок РРРР-ММ-ДД.
 */
export function buildContext({ sourceKind, data, profile, now } = {}) {
  const build = builderFor(sourceKind);
  const fields = {
    'дата': todayText(now),
    'профіль.назва': textValue(profile?.displayName),
    'профіль.посада': textValue(profile?.position),
    'профіль.роль': textValue(profile?.role),
  };
  const blocks = {};
  build(data && typeof data === 'object' ? data : {}, fields, blocks);
  return { fields, blocks };
}

const entry = (name, label, block = null) => Object.freeze({ name, label, block });

/**
 * Поля джерела для довідки в інтерфейсі: [{ name, label, block }], де block — назва блоку,
 * усередині якого діє поле (null — поле документа). Для модуля дашборда й таблиці поля рядків
 * залежать від даних: передайте `data` з library_source_data (або без нього — лише приклади).
 */
export function listFields(sourceKind, data = null) {
  builderFor(sourceKind);
  const out = COMMON_FIELDS.map(([name, label]) => entry(name, label));
  if (sourceKind === 'approved_revisions') {
    out.push(...APPROVED_FIELDS.map(([name, label]) => entry(name, label)));
    out.push(...RECORD_FIELDS.map(([name, label]) => entry(name, label, 'записи')));
    for (const [block] of BREAKDOWN_BLOCKS) out.push(...BREAKDOWN_FIELDS.map(([name, label]) => entry(name, label, block)));
    return out;
  }
  if (sourceKind === 'dashboard_module') {
    out.push(entry('модуль.назва', 'Назва модуля'), entry('модуль.рядків', 'Кількість рядків'));
    out.push(entry('номер', 'Порядковий номер рядка (1, 2, …)', 'рядки'));
    for (const field of moduleFieldsOf(data?.module)) {
      out.push(entry(field.key, typeof field.label === 'string' && field.label.trim() ? field.label.trim() : field.key, 'рядки'));
    }
    return out;
  }
  out.push(entry('таблиця.назва', 'Назва таблиці'), entry('таблиця.рядків', 'Кількість рядків'));
  out.push(entry('номер', 'Порядковий номер рядка (1, 2, …)', 'рядки'));
  const { headers, count } = tableColumns(data);
  for (let column = 0; column < (count || SAMPLE_TABLE_COLUMNS); column += 1) {
    const letter = columnName(column);
    const header = typeof headers[column] === 'string' ? headers[column].trim() : '';
    out.push(entry(letter, header ? `Колонка ${letter}: ${header}` : `Колонка ${letter}`, 'рядки'));
  }
  return out;
}

/** Блоки джерела: [{ name, label }]. */
export function listBlocks(sourceKind) {
  builderFor(sourceKind);
  return BLOCK_LABELS[sourceKind].map(([name, label]) => Object.freeze({ name, label }));
}
