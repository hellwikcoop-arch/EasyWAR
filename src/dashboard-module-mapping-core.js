// Ручне зіставлення стовпців таблиці користувача з колонками модуля: чиста логіка без DOM і Tauri.
// Автоматичне впізнавання заголовків (`dashboard-module-source-core.js`) працює лише для таблиць, чиї
// заголовки схожі на колонки шаблону. Тут користувач сам вказує, який стовпець таблиці куди піде, а
// програма:
//  - читає таблицю: де заголовки й що в кожному стовпці (число, дата, категорія, текст);
//  - підставляє початкове зіставлення за ролями колонок шаблону;
//  - для обраних стовпців називає всі шаблони каталогу, у які вони вкладаються.
// Зіставлення — `{ [ключ колонки модуля]: індекс стовпця таблиці | 'count' }`. `'count'` — «кількість
// записів»: кожен рядок таблиці дає в колонку одиницю, а картка сама рахує підсумки й відсотки.
// Нічого не вгадується тихо: те, що не вдалося розібрати, лишається поза записами й названо в плані.

/** Скільки перших рядків аркуша переглядається в пошуках рядка заголовків. */
export const HEADER_SCAN_ROWS = 25;
/** Стільки найчастіших значень стовпця показується підказкою. */
export const TOP_VALUES = 4;
/** Не більше стільки різних значень стовпця запам'ятовується (далі лише рахується, що їх багато). */
const DISTINCT_CAP = 500;
const MAX_COLUMNS = 200;
const CATEGORY_MAX = 24;
/** Значення «кількість записів» у зіставленні. */
export const COUNT = 'count';
/** Закріплене порожнє місце у зіставленні: колонку свідомо не заповнюють. */
export const NONE = 'none';

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/u;
const DATE_DOTTED = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?$/u;
const NUMBER_TEXT = /^[+-]?\d+(?:[.,]\d+)?$/u;
const LATITUDE_WORDS = /широт|\blat/iu;
const LONGITUDE_WORDS = /довгот|\blon|\blng/iu;

const isBlank = cell => cell == null || (typeof cell === 'string' && cell.trim() === '');
const textOf = cell => (cell == null ? '' : String(cell).trim());
const pad2 = number => String(number).padStart(2, '0');

/** Дата з тексту клітинки: `{ iso, hasTime }` або `null`; календарна коректність перевіряється. */
function dateOf(text) {
  let year; let month; let day; let time;
  let match = DATE_TEXT.exec(text);
  if (match) [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = DATE_DOTTED.exec(text))) [year, month, day] = [Number(match[3]), Number(match[2]), Number(match[1])];
  else return null;
  time = match[4] != null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  if (time && (Number(match[4]) > 23 || Number(match[5]) > 59)) return null;
  return { iso: `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`, hasTime: time };
}

/** Вид клітинки: `blank`, `number`, `flag`, `date` чи `text`. Число в тексті («12,5») теж число. */
export function cellKind(cell) {
  if (isBlank(cell)) return 'blank';
  if (typeof cell === 'number') return Number.isFinite(cell) ? 'number' : 'blank';
  if (typeof cell === 'boolean') return 'flag';
  const text = textOf(cell);
  if (dateOf(text)) return 'date';
  if (NUMBER_TEXT.test(text)) return 'number';
  return 'text';
}

/** «A», «B», … «Z», «AA»: назва стовпця так, як її показує таблиця. */
export function columnLetters(index) {
  let value = Math.max(0, Math.floor(index)) + 1;
  let letters = '';
  while (value > 0) {
    const rest = (value - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

/**
 * Індекс рядка заголовків серед перших рядків аркуша: найбільше текстових клітинок за відрахуванням
 * чисел і дат (у заголовку їх немає); рівні — раніший. Потрібні щонайменше дві текстові клітинки й
 * рядок даних після заголовка. Немає такого — `-1`, і користувач вкаже рядок сам.
 */
export function detectHeaderIndex(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let best = -1;
  let bestScore = -Infinity;
  list.slice(0, HEADER_SCAN_ROWS).forEach((row, index) => {
    if (index >= list.length - 1) return;
    const kinds = (Array.isArray(row?.cells) ? row.cells : []).map(cellKind);
    const texts = kinds.filter(kind => kind === 'text').length;
    const other = kinds.filter(kind => kind === 'number' || kind === 'date' || kind === 'flag').length;
    if (texts < 2) return;
    if (texts - other > bestScore) { best = index; bestScore = texts - other; }
  });
  return best;
}

/**
 * Профіль кожного стовпця під рядком заголовків: скільки клітинок заповнено, скільки різних значень,
 * вид (`number`, `date`, `flag`, `category`, `text`, `empty`) і найчастіші значення. `counter` — стовпець
 * «№»: цілі числа, що лише зростають і не повторюються; як показник він нічого не дає.
 */
export function profileColumns(rows, headerIndex) {
  const list = Array.isArray(rows) ? rows : [];
  const header = Array.isArray(list[headerIndex]?.cells) ? list[headerIndex].cells : [];
  const body = headerIndex >= 0 ? list.slice(headerIndex + 1) : list;
  const width = Math.min(MAX_COLUMNS, Math.max(header.length, ...body.map(row => (Array.isArray(row?.cells) ? row.cells.length : 0))));
  const columns = [];
  for (let index = 0; index < width; index += 1) {
    const title = textOf(header[index]);
    const kinds = { number: 0, date: 0, flag: 0, text: 0 };
    const counts = new Map();
    let filled = 0;
    let withTime = 0;
    let min = Infinity;
    let max = -Infinity;
    let minDate = null;
    let maxDate = null;
    let integers = true;
    let rising = true;
    let previous = -Infinity;
    for (const row of body) {
      const cell = Array.isArray(row?.cells) ? row.cells[index] : null;
      const kind = cellKind(cell);
      if (kind === 'blank') continue;
      filled += 1;
      kinds[kind] += 1;
      const key = textOf(cell);
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
      else if (counts.size < DISTINCT_CAP) counts.set(key, 1);
      if (kind === 'number') {
        const number = typeof cell === 'number' ? cell : Number(key.replace(',', '.'));
        min = Math.min(min, number);
        max = Math.max(max, number);
        if (!Number.isInteger(number)) integers = false;
        if (number <= previous) rising = false;
        previous = number;
      } else if (kind === 'date') {
        const parsed = dateOf(key);
        if (parsed.hasTime) withTime += 1;
        if (minDate == null || parsed.iso < minDate) minDate = parsed.iso;
        if (maxDate == null || parsed.iso > maxDate) maxDate = parsed.iso;
      }
    }
    if (!title && !filled) continue;
    const distinct = counts.size;
    const share = kind => (filled ? kinds[kind] / filled : 0);
    let kind;
    if (!filled) kind = 'empty';
    else if (share('date') >= 0.8) kind = 'date';
    else if (share('number') >= 0.9) kind = 'number';
    else if (share('flag') >= 0.9) kind = 'flag';
    else if (distinct <= CATEGORY_MAX && distinct <= Math.max(3, Math.ceil(filled * 0.6))) kind = 'category';
    else kind = 'text';
    const top = [...counts.entries()].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1)).slice(0, TOP_VALUES)
      .map(([value, count]) => ({ value, count }));
    columns.push({
      index,
      header: title,
      label: title || `Стовпець ${columnLetters(index)}`,
      filled,
      total: body.length,
      distinct,
      distinctCapped: counts.size >= DISTINCT_CAP,
      kind,
      // Номери записів: цілі, що ростуть без повторів майже підряд (1, 2, 3…, можливі пропуски від видалених).
      counter: kind === 'number' && integers && rising && distinct === filled && filled > 1 && max - min + 1 <= filled * 1.25,
      withTime,
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null,
      minDate,
      maxDate,
      top,
    });
  }
  return columns;
}

const formatNumber = value => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value);
const dottedDate = iso => (iso ? iso.split('-').reverse().join('.') : '');

/** Один рядок про стовпець для підказки й списку вибору: що в ньому лежить. */
export function columnSummary(column) {
  if (!column || column.kind === 'empty') return 'порожній';
  switch (column.kind) {
    case 'number':
      return column.counter ? 'номери за порядком' : `число, ${formatNumber(column.min)}–${formatNumber(column.max)}`;
    case 'date':
      return column.minDate === column.maxDate ? `дата, ${dottedDate(column.minDate)}` : `дата, ${dottedDate(column.minDate)} – ${dottedDate(column.maxDate)}`;
    case 'flag':
      return 'так / ні';
    case 'category': {
      const shown = column.top.map(item => item.value).join(', ');
      return `${column.distinct} різних: ${shown}${column.distinct > column.top.length ? '…' : ''}`;
    }
    default:
      return `текст, ${column.distinct}${column.distinctCapped ? '+' : ''} різних`;
  }
}

// ---------------------------------------------------------------------------------------------
// Що потрібно колонці модуля і чи підходить стовпець

/** Що колонка модуля очікує від стовпця: `date`, `number`, `flag` чи `text` (текст бере будь-що). */
export function fieldNeed(field) {
  switch (field?.dataType) {
    case 'date':
    case 'datetime': return 'date';
    case 'real':
    case 'integer': return 'number';
    case 'boolean': return 'flag';
    default: return 'text';
  }
}

/** Колонка-показник, яку можна замінити кількістю записів: сума по категоріях, не середнє чи межа. */
export function canCount(field) {
  return field?.role === 'metric' && field.aggregation === 'sum' && ['real', 'integer'].includes(field.dataType);
}

/**
 * Наскільки стовпець підходить колонці: 0 — не підходить, 1 — можна, але нерадимо, 2 — годиться, 3 — те що треба.
 * Числову колонку не заповнить текст, дату й час — стовпець без часу, а категорію — стовпець із десятками
 * унікальних значень (це вже текст, а не категорія). Лічильник «№» — не показник і не категорія, лише порядок.
 */
export function compatibility(field, column) {
  if (!column || column.kind === 'empty') return 0;
  const role = field?.role;
  switch (fieldNeed(field)) {
    case 'date':
      if (column.kind !== 'date') return 0;
      return field.dataType === 'datetime' && column.withTime < column.filled * 0.8 ? 0 : 3;
    case 'number': {
      if (column.kind !== 'number') return 0;
      if (role === 'order') return column.counter ? 3 : 2;
      if (column.counter) return 0;
      const range = role === 'latitude' ? 90 : role === 'longitude' ? 180 : null;
      if (range == null) return 3;
      if (column.min < -range || column.max > range) return 0;
      return (role === 'latitude' ? LATITUDE_WORDS : LONGITUDE_WORDS).test(column.header) ? 3 : 2;
    }
    case 'flag':
      return column.kind === 'flag' ? 3 : column.kind === 'category' && column.distinct <= 2 ? 2 : 0;
    default:
      break;
  }
  const grouping = role === 'series' || role === 'status';
  switch (column.kind) {
    case 'category':
      if (role === 'note') return 2;
      if (role === 'series') return column.distinct >= 2 && column.distinct <= 8 ? 3 : 2;
      return column.distinct >= 2 ? 3 : 2;
    case 'text': return role === 'note' ? 3 : grouping ? 1 : 2;
    case 'date': return grouping || role === 'note' ? 0 : 1;
    case 'flag': return 1;
    case 'number': return column.counter ? 0 : 1;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Зіставлення

/** Види діаграм, що самі підсумовують однакові категорії: тільки для них записи можна рахувати як «кількість». */
export const COUNTABLE_KINDS = new Set([
  'line', 'area', 'columns', 'stacked-columns', 'grouped-columns', 'horizontal-bar', 'donut', 'radar', 'calendar', 'leaderboard', 'combo',
]);

/**
 * Зіставлення колонок шаблону зі стовпцями таблиці. `prefer` — стовпці, які користувач вибрав мишею (за порядком
 * вибору; `COUNT` — «кількість записів»): кожен іде у найбільш підходящу вільну колонку, спершу обов'язкову.
 * `pinned` — колонки, які користувач закріпив сам (список вибору): вони не рухаються. Решту не вгадується:
 * лише обов'язкова колонка-сума без числового стовпця рахує записи, якщо `allowCount`. Повертає:
 * `picks` — зіставлення; `used` — задіяні стовпці таблиці; `missing` — обов'язкові колонки без пари;
 * `unused` — обрані стовпці, яким не знайшлося місця; `fit` — усі обов'язкові колонки заповнені.
 */
export function suggestBinding(fields, columns, { prefer = [], pinned = {}, allowCount = true } = {}) {
  const list = Array.isArray(fields) ? fields : [];
  const byIndex = new Map((Array.isArray(columns) ? columns : []).map(column => [column.index, column]));
  const picks = {};
  const taken = new Set();
  // Колонки, які користувач свідомо залишив порожніми (`NONE` у `pinned`): їх не заповнює ні вибір мишею, ні лічильник.
  const blocked = new Set();
  let counted = false;
  const place = (key, pick) => {
    picks[key] = pick;
    if (pick === COUNT) counted = true; else taken.add(pick);
  };
  for (const [key, pick] of Object.entries(pinned)) {
    const field = list.find(item => item.key === key);
    if (!field) continue;
    if (pick === NONE) blocked.add(key);
    else if (pick === COUNT) { if (allowCount && canCount(field) && !counted) place(key, COUNT); } else if (byIndex.has(pick) && !taken.has(pick)) place(key, pick);
  }
  const free = field => picks[field.key] === undefined && !blocked.has(field.key);
  const unused = [];
  // «Кількість записів» розподіляється останньою: справжній числовий стовпець має перевагу над рахунком.
  const order = [...prefer.filter(choice => choice !== COUNT), ...prefer.filter(choice => choice === COUNT)];
  for (const choice of order) {
    if (choice === COUNT ? counted : taken.has(choice)) continue;
    const column = choice === COUNT ? null : byIndex.get(choice);
    if (choice !== COUNT && !column) continue;
    const candidates = list.filter(free)
      .map((field, order) => ({
        field,
        order,
        score: choice === COUNT ? (allowCount && canCount(field) ? 3 : 0) : compatibility(field, column),
      }))
      .filter(item => item.score > 0)
      // Спершу обов'язкові колонки, далі — найкращий збіг, далі — раніша в шаблоні.
      .sort((left, right) => (right.field.required === true) - (left.field.required === true) || right.score - left.score || left.order - right.order);
    const target = candidates[0]?.field;
    if (target) place(target.key, choice);
    else unused.push(choice);
  }
  if (allowCount && !counted) {
    const target = list.find(field => field.required === true && free(field) && canCount(field));
    if (target) place(target.key, COUNT);
  }
  const missing = list.filter(field => field.required === true && picks[field.key] === undefined).map(field => field.key);
  return { picks, used: [...taken], missing, unused, fit: missing.length === 0 };
}

/** Колонки шаблону й звідки вони беруться: `[{ key, label, from }]`; `from` — підпис стовпця або «кількість записів». */
export function describeBinding(fields, picks, columns) {
  const byIndex = new Map((Array.isArray(columns) ? columns : []).map(column => [column.index, column]));
  return (Array.isArray(fields) ? fields : []).filter(field => picks?.[field.key] !== undefined).map(field => ({
    key: field.key,
    label: field.label,
    from: picks[field.key] === COUNT ? 'кількість записів' : byIndex.get(picks[field.key])?.label ?? `стовпець ${columnLetters(picks[field.key])}`,
  }));
}

/** Короткий вигляд зіставлення одним рядком: «Категорія ← Літак; Значення ← кількість записів». */
export function bindingLine(fields, picks, columns) {
  return describeBinding(fields, picks, columns).map(item => `${item.label} ← ${item.from}`).join('; ');
}

/** Шаблони, які не пропонуються за стовпцями: їм потрібна саме така таблиця, як журнал польотів. */
const NOT_SUGGESTED = new Set(['flight-hours']);

/** Чи може шаблон рахувати записи таблиці як «кількість». */
export const countAllowed = template => COUNTABLE_KINDS.has(template?.visualKind);

/** Зіставлення для шаблону каталогу з урахуванням того, чи можна в ньому рахувати записи. */
export function bindTemplate(template, columns, options = {}) {
  return suggestBinding(template?.fields, columns, { allowCount: countAllowed(template), ...options });
}

/**
 * Шаблони каталогу, у які вкладаються обрані стовпці: усі обов'язкові колонки шаблону заповнені, а обрані
 * стовпці знайшли собі колонку. Якщо жоден шаблон не бере всього обраного, лишаються ті, що не беруть найменше
 * (`unused` каже які). Спершу ті, де більше колонок отримало стовпці й менше довелося порахувати за замовчуванням.
 * `exclude` — шаблон, у якому користувач уже працює. Кожен елемент: `{ template, picks, unused, line, score }`.
 */
export function rankTemplates(templates, columns, selected, { exclude = '' } = {}) {
  const prefer = Array.isArray(selected) ? selected : [];
  if (!prefer.length) return [];
  const list = Array.isArray(templates) ? templates : [];
  const order = new Map(list.map((template, index) => [template.id, index]));
  const fitting = list
    .filter(template => template.id !== exclude && !NOT_SUGGESTED.has(template.id))
    .map(template => ({ template, ...bindTemplate(template, columns, { prefer }) }))
    .filter(item => item.fit && Object.keys(item.picks).length > 0);
  const fewest = Math.min(...fitting.map(item => item.unused.length));
  return fitting
    .filter(item => item.unused.length === fewest)
    .map(item => ({
      template: item.template,
      picks: item.picks,
      unused: item.unused,
      line: bindingLine(item.template.fields, item.picks, columns),
      score: Object.values(item.picks).filter(pick => pick !== COUNT).length * 10 + Object.keys(item.picks).length,
    }))
    .sort((left, right) => right.score - left.score || order.get(left.template.id) - order.get(right.template.id));
}

/** Скільки клітинок показується в перегляді таблиці й скільки символів у клітинці. */
export const PREVIEW_ROWS = 6;
const PREVIEW_CHARS = 28;

/** Текст клітинки в перегляді таблиці: так, як її побачить користувач, обрізаний. */
export function previewText(cell) {
  if (isBlank(cell)) return '';
  const text = typeof cell === 'number' ? formatNumber(cell) : typeof cell === 'boolean' ? (cell ? 'так' : 'ні') : textOf(cell);
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
}

export const dashboardModuleMappingCore = {
  COUNT,
  NONE,
  cellKind,
  columnLetters,
  detectHeaderIndex,
  profileColumns,
  columnSummary,
  fieldNeed,
  canCount,
  compatibility,
  suggestBinding,
  bindTemplate,
  countAllowed,
  COUNTABLE_KINDS,
  describeBinding,
  bindingLine,
  rankTemplates,
  previewText,
};
