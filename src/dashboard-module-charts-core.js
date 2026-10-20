// Моделі діаграм для карток дашборда: чиста логіка без DOM і Tauri. Із рядків таблиці модуля
// (як їх віддає Rust) і його полів будується структура, яку малює `dashboard-module-charts.js`:
// ряди, категорії, шкали, частки, клітинки календаря чи когорт. Нічого не вгадується: поле
// для осі, рядів і значень визначає роль поля в шаблоні каталогу. Кольори тут — лише номери
// слотів палітри (1–8): ряд отримує слот у порядку першої появи й не змінює його.

import { fieldKind, formatDuration, formatValue, pluralForm } from './dashboard-module-catalog-core.js';

/** Понад стільки рядів решта складається в «Інші»: дев'ятого кольору в палітрі немає. */
export const SERIES_LIMIT = 8;
/** Скільки категорій показує стовпчикова або смугова діаграма; решта — «Інші». */
export const CATEGORY_LIMIT = 12;
export const OTHER_LABEL = 'Інші';
const ROW_LIMIT = 10_000;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => (value == null ? '' : String(value));

// ---------------------------------------------------------------------------------------------
// Числа, дати, шкали

/**
 * Стисле число для осей і підписів: 1 250 → «1,3 тис.», 2 400 000 → «2,4 млн», дроби до двох
 * знаків. Від'ємні — зі знаком мінус.
 */
export function compactNumber(value) {
  if (!finite(value)) return '—';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const format = (number, digits) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: digits }).format(number);
  if (abs >= 1e9) return `${sign}${format(abs / 1e9, 1)} млрд`;
  if (abs >= 1e6) return `${sign}${format(abs / 1e6, 1)} млн`;
  if (abs >= 1e4) return `${sign}${format(abs / 1e3, 1)} тис.`;
  return `${sign}${format(abs, abs >= 100 ? 0 : 2)}`;
}

/** Підпис значення поля: тривалості — год:хв, решта — стисле число. */
export function valueLabel(field, value) {
  if (!finite(value)) return '—';
  return fieldKind(field) === 'duration' ? formatDuration(value) : compactNumber(value);
}

/** Поділки осі: «гарні» кроки 1, 2, 2,5, 5 × 10ⁿ, від 0 (або від'ємного мінімуму) до максимуму. */
export function niceTicks(min, max, count = 4) {
  const low = Math.min(0, finite(min) ? min : 0);
  let high = Math.max(low, finite(max) ? max : 0);
  if (high === low) high = low + 1;
  const span = high - low;
  const rough = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(unit => unit * power).find(unit => span / unit <= count + 0.5) ?? 10 * power;
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const ticks = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return { min: start, max: end === start ? start + step : end, step, ticks };
}

const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/u;

/** Дата або дата-час з тексту ISO (`2026-10-18`, `2026-10-18T12:30`); інакше null. */
export function parseMoment(value) {
  const match = ISO.exec(text(value).trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = Date.UTC(year, month - 1, day, hour || 0, minute || 0);
  return { year, month, day, hour: hour || 0, minute: minute || 0, hasTime: match[4] != null, time, key: text(value).trim() };
}

const pad2 = number => String(number).padStart(2, '0');

/** Підпис моменту на осі: «18.10», з іншого року — «18.10.25», з часом — «18.10 12:30». */
export function momentLabel(moment, { withYear = false, withTime = false } = {}) {
  if (!moment) return '';
  const date = `${pad2(moment.day)}.${pad2(moment.month)}${withYear ? `.${String(moment.year).slice(-2)}` : ''}`;
  return withTime && moment.hasTime ? `${date} ${pad2(moment.hour)}:${pad2(moment.minute)}` : date;
}

/** Назва місяця з роком: «жовтень 2026». */
export const monthTitle = (year, month) => `${MONTHS[month - 1]} ${year}`;
export const dayNames = () => [...DAY_NAMES];

// ---------------------------------------------------------------------------------------------
// Поля й ряди

function fieldsOf(module) {
  const fields = Array.isArray(module?.fields) ? module.fields : [];
  const byKey = new Map(fields.map(field => [field.key, field]));
  const byRole = role => fields.filter(field => field.role === role);
  const timeField = fields.find(field => ['date', 'datetime'].includes(field.dataType) && ['dimension', 'order'].includes(field.role)) || null;
  return {
    fields,
    byKey,
    timeField,
    categoryField: byKey.get('category') || byKey.get('axis') || byKey.get('stage') || byKey.get('cohort')
      || fields.find(field => field.role === 'dimension' && field !== timeField && field.dataType === 'text') || byRole('label')[0] || null,
    labelField: byRole('label')[0] || null,
    seriesField: byRole('series')[0] || null,
    statusField: byRole('status')[0] || null,
    noteField: byRole('note')[0] || null,
    orderField: byRole('order').find(field => field !== timeField) || null,
    metrics: byRole('metric'),
  };
}

function aggregate(values, aggregation) {
  switch (aggregation) {
    case 'count': return values.length;
    case 'average': return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    case 'minimum': return values.length ? Math.min(...values) : null;
    case 'maximum': return values.length ? Math.max(...values) : null;
    case 'none': return values.length ? values[0] : null;
    default: return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
}

/** Слоти палітри для назв рядів у порядку першої появи; понад ліміт — слот «Інші» (останній). */
export function assignSlots(names, limit = SERIES_LIMIT) {
  const unique = [...new Set(names)];
  if (unique.length <= limit) return new Map(unique.map((name, index) => [name, index + 1]));
  const kept = unique.slice(0, limit - 1);
  const slots = new Map(kept.map((name, index) => [name, index + 1]));
  for (const name of unique.slice(limit - 1)) slots.set(name, limit);
  slots.set(OTHER_LABEL, limit);
  return slots;
}

/** Назва ряду рядка: значення поля ряду або підпис показника, коли поля ряду немає. */
const seriesNameOf = (row, seriesField, fallback) => {
  const value = seriesField ? row?.[seriesField.key] : null;
  return value == null || value === '' ? fallback : formatValue(value);
};

/** Порівняння категорій за спаданням суми (рейтинг). */
const byTotalDesc = (left, right, totals) => (totals.get(right) ?? 0) - (totals.get(left) ?? 0);

/** Складає ряди понад ліміт в «Інші» (сумою), щоб жоден ряд не лишився без кольору. */
function foldSeries(names, limit = SERIES_LIMIT) {
  const unique = [...new Set(names)];
  if (unique.length <= limit) return { kept: unique, folded: new Set() };
  return { kept: [...unique.slice(0, limit - 1), OTHER_LABEL], folded: new Set(unique.slice(limit - 1)) };
}

/**
 * Матриця «категорія × ряд» з рядків: значення агреговані правилом показника. Категорії йдуть у
 * порядку появи (або поля порядку), ряди — у порядку появи; понад ліміти — «Інші».
 */
function matrix(rows, { categoryOf, categoryLabel, seriesOf, metric, categoryLimit = CATEGORY_LIMIT, seriesLimit = SERIES_LIMIT, sortCategories = null }) {
  const cells = new Map();
  const categoryOrder = [];
  const seriesOrder = [];
  for (const row of rows) {
    const categoryKey = categoryOf(row);
    if (categoryKey == null) continue;
    const value = row?.[metric.key];
    if (!finite(value)) continue;
    const series = seriesOf(row);
    if (!cells.has(categoryKey)) { cells.set(categoryKey, new Map()); categoryOrder.push(categoryKey); }
    if (!seriesOrder.includes(series)) seriesOrder.push(series);
    const bucket = cells.get(categoryKey);
    if (!bucket.has(series)) bucket.set(series, []);
    bucket.get(series).push(value);
  }
  const { kept: seriesNames, folded } = foldSeries(seriesOrder, seriesLimit);
  const totals = new Map(categoryOrder.map(key => [key, [...(cells.get(key)?.values() ?? [])].flat().reduce((sum, value) => sum + value, 0)]));
  // `sortCategories(leftKey, rightKey, totals)`: рейтинг — за сумою, вісь часу — за моментом.
  let categories = [...categoryOrder];
  if (sortCategories) categories.sort((left, right) => sortCategories(left, right, totals));
  let foldedCategories = [];
  if (categories.length > categoryLimit) {
    foldedCategories = categories.slice(categoryLimit - 1);
    categories = [...categories.slice(0, categoryLimit - 1), OTHER_LABEL];
  }
  const valueOf = (categoryKey, series) => {
    const sources = categoryKey === OTHER_LABEL ? foldedCategories : [categoryKey];
    const values = sources.flatMap(key => {
      const bucket = cells.get(key);
      if (!bucket) return [];
      if (series === OTHER_LABEL && folded.size) return [...folded].flatMap(name => bucket.get(name) ?? []);
      return bucket.get(series) ?? [];
    });
    return values.length ? aggregate(values, metric.aggregation) : null;
  };
  return {
    categories: categories.map(key => ({ key, label: key === OTHER_LABEL ? OTHER_LABEL : categoryLabel(key) })),
    series: seriesNames.map(name => ({ name, values: categories.map(key => valueOf(key, name)) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Моделі за видами

function timeAxis(rows, timeField) {
  const moments = new Map();
  for (const row of rows) {
    const moment = parseMoment(row?.[timeField.key]);
    if (moment && !moments.has(moment.key)) moments.set(moment.key, moment);
  }
  const sorted = [...moments.values()].sort((left, right) => left.time - right.time || left.key.localeCompare(right.key));
  const years = new Set(sorted.map(moment => moment.year));
  const withTime = sorted.some(moment => moment.hasTime);
  return {
    keys: sorted.map(moment => moment.key),
    labels: sorted.map(moment => momentLabel(moment, { withYear: years.size > 1, withTime })),
    momentOf: row => parseMoment(row?.[timeField.key])?.key ?? null,
  };
}

function seriesChart(kind, module, rows, info, { categoryLimit = null, sortCategories = null } = {}) {
  const metric = info.metrics[0];
  const axis = info.timeField ? timeAxis(rows, info.timeField) : null;
  const categoryOf = axis ? axis.momentOf : row => (row?.[info.categoryField?.key] == null ? null : formatValue(row[info.categoryField.key]));
  const grid = matrix(rows, {
    categoryOf,
    categoryLabel: key => (axis ? axis.labels[axis.keys.indexOf(key)] ?? key : key),
    seriesOf: row => seriesNameOf(row, info.seriesField, metric?.label ?? 'Значення'),
    metric: metric ?? { key: '', aggregation: 'sum', label: '' },
    categoryLimit: categoryLimit ?? (axis ? ROW_LIMIT : CATEGORY_LIMIT),
    sortCategories: axis ? (left, right) => axis.keys.indexOf(left) - axis.keys.indexOf(right) : sortCategories,
  });
  const values = grid.series.flatMap(series => series.values).filter(finite);
  const scale = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  return {
    kind,
    empty: !rows.length,
    categories: grid.categories.map(item => item.label),
    series: grid.series.map(series => ({ ...series, slot: assignSlots(grid.series.map(item => item.name)).get(series.name) })),
    scale,
    valueText: value => valueLabel(metric, value),
    legend: grid.series.length > 1,
  };
}

function twoMetricColumns(module, rows, info) {
  const [primary, secondary] = info.metrics;
  const categoryOf = row => (row?.[info.categoryField?.key] == null ? null : formatValue(row[info.categoryField.key]));
  const gridOf = metric => matrix(rows, { categoryOf, categoryLabel: key => key, seriesOf: () => metric.label, metric });
  const first = gridOf(primary);
  const second = secondary ? gridOf(secondary) : null;
  const series = [
    { name: primary.label, values: first.series[0]?.values ?? [], slot: 1 },
    ...(second ? [{ name: secondary.label, values: first.categories.map(category => {
      const index = second.categories.findIndex(item => item.key === category.key);
      return index >= 0 ? second.series[0]?.values[index] ?? null : null;
    }), slot: 2 }] : []),
  ];
  const values = series.flatMap(item => item.values).filter(finite);
  return {
    kind: 'grouped-columns',
    empty: !rows.length,
    categories: first.categories.map(item => item.label),
    series,
    scale: niceTicks(Math.min(0, ...values), Math.max(0, ...values)),
    valueText: value => valueLabel(primary, value),
    legend: series.length > 1,
  };
}

function flightHours(module, rows, info) {
  const type = info.byKey.get('aircraft_type');
  const airborne = info.byKey.get('airborne_hours');
  const total = info.byKey.get('total_hours');
  const categoryOf = row => (row?.[type.key] == null || row[type.key] === '' ? null : formatValue(row[type.key]));
  const gridOf = metric => matrix(rows, { categoryOf, categoryLabel: key => key, seriesOf: () => metric.label, metric, categoryLimit: 10, sortCategories: byTotalDesc });
  const first = gridOf(total);
  const second = gridOf(airborne);
  const airborneValues = first.categories.map(category => {
    const index = second.categories.findIndex(item => item.key === category.key);
    return index >= 0 ? second.series[0]?.values[index] ?? null : null;
  });
  const series = [
    { name: 'Наліт у повітрі', values: airborneValues, slot: 1 },
    { name: 'Загальний наліт', values: first.series[0]?.values ?? [], slot: 2 },
  ];
  const values = series.flatMap(item => item.values).filter(finite);
  return {
    kind: 'horizontal-bar',
    empty: !rows.length,
    categories: first.categories.map(item => item.label),
    series,
    scale: niceTicks(0, Math.max(0, ...values)),
    valueText: value => valueLabel(total, value),
    legend: true,
  };
}

/** Рейтинг: категорії за спаданням суми, до 10 смуг. */
function horizontalBars(module, rows, info) {
  return seriesChart('horizontal-bar', module, rows, info, { categoryLimit: 10, sortCategories: byTotalDesc });
}

function divergingBars(module, rows, info) {
  const metric = info.metrics[0];
  const categoryOf = row => (row?.[info.categoryField?.key] == null ? null : formatValue(row[info.categoryField.key]));
  const grid = matrix(rows, { categoryOf, categoryLabel: key => key, seriesOf: () => 'Значення', metric, categoryLimit: 12, sortCategories: byTotalDesc });
  const values = grid.series[0]?.values ?? [];
  const extent = Math.max(1e-9, ...values.filter(finite).map(Math.abs));
  const scale = niceTicks(-extent, extent, 4);
  return {
    kind: 'diverging-bars',
    empty: !rows.length,
    items: grid.categories.map((category, index) => ({ label: category.label, value: values[index] ?? null })),
    scale: { ...scale, min: -Math.max(Math.abs(scale.min), scale.max), max: Math.max(Math.abs(scale.min), scale.max) },
    positive: values.filter(value => finite(value) && value > 0).reduce((sum, value) => sum + value, 0),
    negative: values.filter(value => finite(value) && value < 0).reduce((sum, value) => sum + value, 0),
    valueText: value => valueLabel(metric, value),
  };
}

function donut(module, rows, info) {
  const metric = info.metrics[0];
  const categoryOf = row => (row?.[info.categoryField?.key] == null ? null : formatValue(row[info.categoryField.key]));
  const grid = matrix(rows, { categoryOf, categoryLabel: key => key, seriesOf: () => 'Частка', metric, categoryLimit: 6, sortCategories: byTotalDesc });
  const values = grid.series[0]?.values ?? [];
  const slices = grid.categories
    .map((category, index) => ({ label: category.label, value: values[index] ?? 0 }))
    .filter(slice => finite(slice.value) && slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const slots = assignSlots(slices.map(slice => slice.label), 8);
  return {
    kind: 'donut',
    empty: !rows.length,
    total,
    totalText: valueLabel(metric, total),
    slices: slices.map(slice => ({ ...slice, percent: total ? slice.value / total * 100 : 0, slot: slots.get(slice.label), text: valueLabel(metric, slice.value) })),
  };
}

const percentOf = (current, target) => (finite(current) && finite(target) && target > 0 ? Math.max(0, Math.min(100, current / target * 100)) : 0);

function progressItems(module, rows, info, limit) {
  const label = info.labelField;
  const current = info.byKey.get('current_value') || info.metrics[0];
  const target = info.byKey.get('target_value') || info.metrics[1];
  const ordered = info.orderField
    ? [...rows].sort((left, right) => (finite(left?.[info.orderField.key]) ? left[info.orderField.key] : 1e9) - (finite(right?.[info.orderField.key]) ? right[info.orderField.key] : 1e9))
    : rows;
  return ordered
    .filter(row => finite(row?.[current?.key]))
    .slice(0, limit)
    .map((row, index) => ({
      label: label && row[label.key] != null ? formatValue(row[label.key]) : `№ ${index + 1}`,
      current: row[current.key],
      target: finite(row?.[target?.key]) ? row[target.key] : null,
      percent: percentOf(row[current.key], row?.[target?.key]),
      currentText: valueLabel(current, row[current.key]),
      targetText: finite(row?.[target?.key]) ? valueLabel(target, row[target.key]) : '',
      slot: index + 1,
    }));
}

function radialProgress(module, rows, info) {
  return { kind: 'radial-progress', empty: !rows.length, items: progressItems(module, rows, info, 4) };
}

function multiRing(module, rows, info) {
  return { kind: 'multi-ring', empty: !rows.length, items: progressItems(module, rows, info, 5) };
}

/** Скільки сегментів-«пігулок» у смузі виконання: крок 12,5 % ще читається на око. */
const PROGRESS_SEGMENTS = 8;

function progressBars(module, rows, info) {
  const items = progressItems(module, rows, info, 8)
    .map(item => ({ ...item, filled: Math.round(item.percent / 100 * PROGRESS_SEGMENTS) }));
  return { kind: 'progress-bars', empty: !rows.length, segments: PROGRESS_SEGMENTS, items };
}

function gauge(module, rows, info) {
  const row = rows.at(-1) ?? {};
  const valueField = info.byKey.get('value') || info.metrics[0];
  const minField = info.byKey.get('minimum');
  const maxField = info.byKey.get('maximum') || info.metrics[1];
  const value = finite(row[valueField?.key]) ? row[valueField.key] : 0;
  const min = finite(row[minField?.key]) ? row[minField.key] : 0;
  const max = finite(row[maxField?.key]) && row[maxField.key] > min ? row[maxField.key] : Math.max(min + 1, value);
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return {
    kind: 'gauge',
    empty: !rows.length,
    label: info.labelField && row[info.labelField.key] != null ? formatValue(row[info.labelField.key]) : valueField?.label ?? '',
    value,
    min,
    max,
    ratio,
    percent: ratio * 100,
    valueText: valueLabel(valueField, value),
    minText: valueLabel(minField ?? valueField, min),
    maxText: valueLabel(maxField ?? valueField, max),
  };
}

function radar(module, rows, info) {
  const metric = info.metrics[0];
  const axisOf = row => (row?.[info.categoryField?.key] == null ? null : formatValue(row[info.categoryField.key]));
  const grid = matrix(rows, { categoryOf: axisOf, categoryLabel: key => key, seriesOf: row => seriesNameOf(row, info.seriesField, metric?.label ?? 'Значення'), metric, categoryLimit: 8 });
  const values = grid.series.flatMap(series => series.values).filter(finite);
  const max = Math.max(1e-9, ...values);
  const slots = assignSlots(grid.series.map(series => series.name));
  return {
    kind: 'radar',
    empty: !rows.length,
    axes: grid.categories.map(item => item.label),
    max,
    series: grid.series.map(series => ({ name: series.name, slot: slots.get(series.name), values: series.values, ratios: series.values.map(value => (finite(value) ? value / max : 0)) })),
    legend: grid.series.length > 1,
    valueText: value => valueLabel(metric, value),
  };
}

function calendar(module, rows, info) {
  const dateField = info.timeField || info.byKey.get('date');
  const metric = info.metrics[0];
  const byDay = new Map();
  for (const row of rows) {
    const moment = parseMoment(row?.[dateField?.key]);
    if (!moment) continue;
    const key = `${moment.year}-${pad2(moment.month)}-${pad2(moment.day)}`;
    const value = finite(row?.[metric?.key]) ? row[metric.key] : null;
    const entry = byDay.get(key) || { moment, values: [] };
    if (value != null) entry.values.push(value);
    byDay.set(key, entry);
  }
  const moments = [...byDay.values()].map(entry => entry.moment).sort((left, right) => right.time - left.time);
  const latest = moments[0];
  if (!latest) return { kind: 'calendar', empty: true, title: '', weeks: [], max: 0, days: dayNames() };
  const { year, month } = latest;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [];
  for (let blank = 0; blank < firstWeekday; blank += 1) cells.push(null);
  let max = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const entry = byDay.get(`${year}-${pad2(month)}-${pad2(day)}`);
    const value = entry ? (entry.values.length ? aggregate(entry.values, metric?.aggregation ?? 'sum') : entry.values.length) : null;
    const count = entry ? Math.max(1, entry.values.length) : 0;
    const shown = value ?? (entry ? count : null);
    if (finite(shown)) max = Math.max(max, shown);
    cells.push({ day, value: shown, text: shown == null ? '' : valueLabel(metric, shown) });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  const monthsWithData = new Set(moments.map(moment => `${moment.year}-${moment.month}`)).size;
  return {
    kind: 'calendar',
    empty: !rows.length,
    title: monthTitle(year, month),
    note: monthsWithData > 1 ? `Показано останній місяць із ${monthsWithData}` : '',
    days: dayNames(),
    weeks,
    max,
    filled: cells.filter(cell => cell && cell.value != null).length,
  };
}

const numericLike = value => /^\s*-?\d+(?:[.,]\d+)?\s*$/u.test(text(value));

function cohort(module, rows, info) {
  const cohortField = info.byKey.get('cohort') || info.categoryField;
  const periodField = info.byKey.get('period') || info.fields.find(field => field.role === 'dimension' && field !== cohortField);
  const metric = info.metrics[0];
  const cohorts = [];
  const periods = [];
  const cells = new Map();
  for (const row of rows) {
    const cohortKey = row?.[cohortField?.key];
    const periodKey = row?.[periodField?.key];
    if (cohortKey == null || periodKey == null || !finite(row?.[metric?.key])) continue;
    const c = formatValue(cohortKey);
    const p = text(periodKey);
    if (!cohorts.includes(c)) cohorts.push(c);
    if (!periods.includes(p)) periods.push(p);
    const key = `${c}\u0000${p}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(row[metric.key]);
  }
  const orderedPeriods = periods.every(numericLike) ? [...periods].sort((left, right) => Number(left.replace(',', '.')) - Number(right.replace(',', '.'))) : periods;
  const shownCohorts = cohorts.slice(0, 8);
  const shownPeriods = orderedPeriods.slice(0, 8);
  const grid = shownCohorts.map(c => shownPeriods.map(p => {
    const values = cells.get(`${c}\u0000${p}`);
    return values ? aggregate(values, metric?.aggregation ?? 'sum') : null;
  }));
  const values = grid.flat().filter(finite);
  return {
    kind: 'cohort',
    empty: !rows.length,
    cohorts: shownCohorts,
    periods: shownPeriods,
    grid,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    text: value => valueLabel(metric, value),
    truncated: cohorts.length > 8 || orderedPeriods.length > 8,
  };
}

function statusTone(value) {
  const lowered = text(value).toLocaleLowerCase('uk');
  if (!lowered) return '';
  if (/готов|викон|успіш|норм|справн|так|ok|done|активн/u.test(lowered)) return 'good';
  if (/критич|збій|помил|аварі|втрач|ні\b|відмов|прострочен/u.test(lowered)) return 'bad';
  if (/увага|очіку|затрим|частков|ремонт|перевір/u.test(lowered)) return 'warn';
  return 'neutral';
}

function table(module, rows, info) {
  const label = info.labelField || info.categoryField;
  const metric = info.metrics[0];
  const progress = info.byKey.get('progress');
  const items = rows.slice(0, 6).map((row, index) => ({
    label: label && row?.[label.key] != null ? formatValue(row[label.key]) : `№ ${index + 1}`,
    value: finite(row?.[metric?.key]) ? row[metric.key] : null,
    valueText: valueLabel(metric, row?.[metric?.key]),
    progress: finite(row?.[progress?.key]) ? Math.max(0, Math.min(100, row[progress.key])) : null,
    status: info.statusField && row?.[info.statusField.key] != null ? formatValue(row[info.statusField.key]) : '',
    tone: statusTone(info.statusField ? row?.[info.statusField.key] : ''),
    note: info.noteField && row?.[info.noteField.key] != null ? formatValue(row[info.noteField.key]) : '',
  }));
  return { kind: 'table', empty: !rows.length, items, more: Math.max(0, rows.length - items.length), hasProgress: !!progress, hasStatus: !!info.statusField };
}

function funnel(module, rows, info) {
  const stage = info.byKey.get('stage') || info.categoryField;
  const metric = info.metrics[0];
  const order = info.byKey.get('stage_order') || info.orderField;
  const grid = matrix(rows, {
    categoryOf: row => (row?.[stage?.key] == null ? null : formatValue(row[stage.key])),
    categoryLabel: key => key,
    seriesOf: () => 'Етап',
    metric,
    categoryLimit: 7,
  });
  const firstOrder = new Map();
  for (const row of rows) {
    const key = row?.[stage?.key] == null ? null : formatValue(row[stage.key]);
    if (key != null && !firstOrder.has(key) && finite(row?.[order?.key])) firstOrder.set(key, row[order.key]);
  }
  const stages = grid.categories.map((category, index) => ({ label: category.label, value: grid.series[0]?.values[index] ?? null, order: firstOrder.get(category.key) ?? index }));
  if (order) stages.sort((left, right) => left.order - right.order);
  const first = stages.find(item => finite(item.value) && item.value > 0)?.value ?? 0;
  return {
    kind: 'funnel',
    empty: !rows.length,
    stages: stages.map((item, index) => ({
      ...item,
      ratio: first ? Math.max(0, Math.min(1, (item.value ?? 0) / first)) : 0,
      percent: first ? Math.max(0, (item.value ?? 0) / first * 100) : 0,
      text: valueLabel(metric, item.value),
      slot: Math.min(8, index + 1),
    })),
  };
}

function mapModel(module, rows, info) {
  const latitude = info.fields.find(field => field.role === 'latitude');
  const longitude = info.fields.find(field => field.role === 'longitude');
  const metric = info.metrics[0];
  const points = rows
    .filter(row => finite(row?.[latitude?.key]) && finite(row?.[longitude?.key]) && Math.abs(row[latitude.key]) <= 90 && Math.abs(row[longitude.key]) <= 180)
    .slice(0, 500)
    .map(row => ({
      label: info.labelField && row?.[info.labelField.key] != null ? formatValue(row[info.labelField.key]) : '',
      latitude: row[latitude.key],
      longitude: row[longitude.key],
      value: finite(row?.[metric?.key]) ? row[metric.key] : null,
      valueText: valueLabel(metric, row?.[metric?.key]),
      status: info.statusField && row?.[info.statusField.key] != null ? formatValue(row[info.statusField.key]) : '',
      tone: statusTone(info.statusField ? row?.[info.statusField.key] : ''),
    }));
  const max = Math.max(1e-9, ...points.map(point => (finite(point.value) ? Math.abs(point.value) : 0)));
  return {
    kind: 'map',
    empty: !rows.length,
    points: points.map(point => ({ ...point, weight: finite(point.value) ? Math.sqrt(Math.abs(point.value) / max) : 0.4 })),
    skipped: rows.length - points.length,
  };
}

function activity(module, rows, info) {
  const timeField = info.timeField || info.byKey.get('occurred_at');
  const metric = info.metrics[0] || info.byKey.get('value');
  const items = rows
    .map(row => ({ row, moment: parseMoment(row?.[timeField?.key]) }))
    .filter(item => item.moment)
    .sort((left, right) => right.moment.time - left.moment.time)
    .slice(0, 6)
    .map(({ row, moment }) => ({
      time: momentLabel(moment, { withTime: true }),
      label: info.labelField && row?.[info.labelField.key] != null ? formatValue(row[info.labelField.key]) : '—',
      status: info.statusField && row?.[info.statusField.key] != null ? formatValue(row[info.statusField.key]) : '',
      tone: statusTone(info.statusField ? row?.[info.statusField.key] : ''),
      valueText: metric && finite(row?.[metric.key]) ? valueLabel(metric, row[metric.key]) : '',
    }));
  return { kind: 'activity', empty: !rows.length, items, more: Math.max(0, rows.length - items.length) };
}

function waveform(module, rows, info) {
  const axis = timeAxis(rows, info.timeField || info.byKey.get('occurred_at'));
  const positive = info.byKey.get('positive_value') || info.metrics[0];
  const negative = info.byKey.get('negative_value') || info.metrics[1];
  const sums = new Map(axis.keys.map(key => [key, { up: [], down: [] }]));
  for (const row of rows) {
    const key = axis.momentOf(row);
    if (!key || !sums.has(key)) continue;
    if (finite(row?.[positive?.key])) sums.get(key).up.push(row[positive.key]);
    if (finite(row?.[negative?.key])) sums.get(key).down.push(row[negative.key]);
  }
  const points = axis.keys.slice(-80).map((key, index) => {
    const bucket = sums.get(key);
    const up = aggregate(bucket.up, positive?.aggregation ?? 'sum');
    const down = aggregate(bucket.down, negative?.aggregation ?? 'sum');
    return { label: axis.labels[axis.keys.indexOf(key)] ?? key, up: finite(up) ? Math.abs(up) : 0, down: finite(down) ? Math.abs(down) : 0, index };
  });
  const max = Math.max(1e-9, ...points.flatMap(point => [point.up, point.down]));
  return {
    kind: 'waveform',
    empty: !rows.length,
    points,
    max,
    upLabel: positive?.label ?? 'Верхнє значення',
    downLabel: negative?.label ?? 'Нижнє значення',
    valueText: value => valueLabel(positive, value),
    truncated: axis.keys.length > 80,
  };
}

function kpi(module, rows, info) {
  const valueField = info.byKey.get('value') || info.metrics[0];
  const deltaField = info.byKey.get('delta');
  const unitField = info.byKey.get('unit');
  const valued = rows.filter(row => finite(row?.[valueField?.key]));
  const last = valued.at(-1) ?? rows.at(-1) ?? {};
  const value = finite(last?.[valueField?.key]) ? last[valueField.key] : null;
  const delta = finite(last?.[deltaField?.key]) ? last[deltaField.key] : null;
  const history = valued.slice(-12).map(row => row[valueField.key]);
  return {
    kind: 'kpi',
    empty: !rows.length,
    label: info.labelField && last?.[info.labelField.key] != null ? formatValue(last[info.labelField.key]) : valueField?.label ?? 'Показник',
    value,
    valueText: value == null ? '—' : fieldKind(valueField) === 'duration' ? formatDuration(value) : new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value),
    unit: unitField && last?.[unitField.key] != null ? formatValue(last[unitField.key]) : '',
    delta,
    deltaText: delta == null ? '' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(Math.abs(delta))} %`,
    history: history.length > 1 ? history : [],
    historyMax: Math.max(1e-9, ...history),
    historyMin: Math.min(0, ...history),
  };
}

function combo(module, rows, info) {
  const barField = info.byKey.get('value') || info.metrics[0];
  const lineField = info.byKey.get('reference_value') || info.metrics[1];
  const axis = info.timeField ? timeAxis(rows, info.timeField) : null;
  const categoryOf = axis ? axis.momentOf : row => (row?.[info.categoryField?.key] == null ? null : formatValue(row[info.categoryField.key]));
  const categoryLabel = key => (axis ? axis.labels[axis.keys.indexOf(key)] ?? key : key);
  const options = { categoryOf, categoryLabel, categoryLimit: axis ? ROW_LIMIT : CATEGORY_LIMIT, sortCategories: axis ? (left, right) => axis.keys.indexOf(left) - axis.keys.indexOf(right) : null };
  const bars = matrix(rows, { ...options, seriesOf: () => barField.label, metric: barField });
  const lines = lineField ? matrix(rows, { ...options, seriesOf: () => lineField.label, metric: lineField }) : null;
  const lineValues = bars.categories.map(category => {
    const index = lines?.categories.findIndex(item => item.key === category.key) ?? -1;
    return index >= 0 ? lines.series[0]?.values[index] ?? null : null;
  });
  const series = [
    { name: barField.label, values: bars.series[0]?.values ?? [], slot: 1, mark: 'column' },
    ...(lineField ? [{ name: lineField.label, values: lineValues, slot: 2, mark: 'line' }] : []),
  ];
  const values = series.flatMap(item => item.values).filter(finite);
  return {
    kind: 'combo',
    empty: !rows.length,
    categories: bars.categories.map(item => item.label),
    series,
    scale: niceTicks(Math.min(0, ...values), Math.max(0, ...values)),
    valueText: value => valueLabel(barField, value),
    legend: series.length > 1,
  };
}

function leaderboard(module, rows, info) {
  const label = info.labelField || info.categoryField;
  const group = info.byKey.get('group');
  const metric = info.byKey.get('value') || info.metrics[0];
  const deltaField = info.byKey.get('delta');
  const grid = matrix(rows, {
    categoryOf: row => (row?.[label?.key] == null ? null : formatValue(row[label.key])),
    categoryLabel: key => key,
    seriesOf: () => 'Значення',
    metric,
    categoryLimit: 8,
    sortCategories: byTotalDesc,
  });
  const extra = new Map();
  for (const row of rows) {
    const key = row?.[label?.key] == null ? null : formatValue(row[label.key]);
    if (key == null || extra.has(key)) continue;
    extra.set(key, {
      group: group && row?.[group.key] != null ? formatValue(row[group.key]) : '',
      delta: finite(row?.[deltaField?.key]) ? row[deltaField.key] : null,
    });
  }
  const values = grid.series[0]?.values ?? [];
  const max = Math.max(1e-9, ...values.filter(finite));
  return {
    kind: 'leaderboard',
    empty: !rows.length,
    items: grid.categories.map((category, index) => {
      const value = values[index];
      const meta = extra.get(category.key) ?? { group: '', delta: null };
      return {
        rank: index + 1,
        label: category.label,
        initials: initialsOf(category.label),
        group: meta.group,
        value,
        valueText: valueLabel(metric, value),
        ratio: finite(value) ? Math.max(0, value) / max : 0,
        delta: meta.delta,
        deltaText: meta.delta == null ? '' : `${meta.delta > 0 ? '+' : meta.delta < 0 ? '−' : ''}${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(Math.abs(meta.delta))} %`,
      };
    }),
  };
}

// Гребені: розподіл подій за годинами доби, окремий гребінь на ряд (тип ПС, підрозділ).
const HOURS = 24;
/** Понад стільки гребенів решта складається в «Інші»: вищі за шість картка не вміщає. */
export const RIDGE_LIMIT = 6;
const HH_MM = /^(\d{1,2})[:.](\d{2})$/u;

/** Година доби з «08:10» чи «8.10» або з дати-часу ISO; без часу чи поза 0–23 — null. */
export function hourOf(value) {
  const raw = text(value).trim();
  const short = HH_MM.exec(raw);
  if (short) {
    const hour = Number(short[1]);
    return hour < HOURS && Number(short[2]) < 60 ? hour : null;
  }
  const moment = parseMoment(raw);
  return moment?.hasTime && moment.hour < HOURS ? moment.hour : null;
}

/** Згладжування по колу доби (ядро 1-2-3-2-1): 23:00 і 00:00 — сусіди. */
function smoothHours(values) {
  const kernel = [1, 2, 3, 2, 1];
  return values.map((_, hour) => kernel.reduce((sum, weight, index) => sum + weight * values[(hour + index - 2 + HOURS) % HOURS], 0) / 9);
}

/**
 * Модель гребенів. `hourField` — поле часу, `seriesField` — поле гребеня, `metric` — вага події
 * (без числа — подія рахується як одна). Ряди йдуть за спаданням суми, понад ліміт — «Інші».
 */
function ridgeModel(rows, { hourField, seriesField, metric, unit }) {
  const buckets = new Map();
  let skipped = 0;
  for (const row of rows) {
    const hour = hourField ? hourOf(row?.[hourField.key]) : null;
    if (hour == null) { skipped += 1; continue; }
    const raw = seriesField ? row?.[seriesField.key] : null;
    const name = raw == null || raw === '' ? 'Без ряду' : formatValue(raw);
    const weight = metric && finite(row?.[metric.key]) ? row[metric.key] : 1;
    if (!buckets.has(name)) buckets.set(name, new Array(HOURS).fill(0));
    buckets.get(name)[hour] += weight;
  }
  const total = values => values.reduce((sum, value) => sum + value, 0);
  let named = [...buckets.entries()].sort((left, right) => total(right[1]) - total(left[1]));
  if (named.length > RIDGE_LIMIT) {
    const rest = new Array(HOURS).fill(0);
    for (const [, values] of named.slice(RIDGE_LIMIT - 1)) values.forEach((value, hour) => { rest[hour] += value; });
    named = [...named.slice(0, RIDGE_LIMIT - 1), [OTHER_LABEL, rest]];
  }
  const slots = assignSlots(named.map(([name]) => name));
  const valueText = value => (metric ? valueLabel(metric, value) : compactNumber(value));
  const series = named.map(([name, values]) => {
    const peakHour = values.reduce((best, value, hour) => (value > values[best] ? hour : best), 0);
    return {
      name,
      slot: slots.get(name),
      values,
      smooth: smoothHours(values),
      total: total(values),
      peakHour,
      peakValue: values[peakHour],
      peakText: `${pad2(peakHour)}:00 · ${valueText(values[peakHour])}${unit ? ` ${unit}` : ''}`,
    };
  });
  return {
    kind: 'ridgeline',
    empty: !series.length,
    hours: Array.from({ length: HOURS }, (_, hour) => `${pad2(hour)}:00`),
    series,
    max: Math.max(1e-9, ...series.flatMap(item => item.smooth)),
    valueText,
    unit,
    skipped,
    legend: false,
  };
}

function ridgeline(module, rows, info) {
  const hourField = info.byKey.get('takeoff_time') || info.byKey.get('occurred_at') || info.timeField;
  const seriesField = info.seriesField || info.byKey.get('aircraft_type') || info.categoryField;
  // Без жодного числа у вазі подія рахується як одна, і підпис — у подіях.
  const valueField = info.byKey.get('value');
  const metric = valueField && rows.some(row => finite(row?.[valueField.key])) ? valueField : null;
  return ridgeModel(rows, { hourField, seriesField, metric, unit: metric ? '' : 'под.' });
}

/**
 * Зльоти журналу польотів за годинами доби по типах ПС: кожен запис з часом зльоту — один
 * виліт. Окрема модель, бо картка журналу показує її під смугами нальоту.
 */
export function takeoffHoursModel(module, rows) {
  const safeRows = (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === 'object').slice(0, ROW_LIMIT);
  const info = fieldsOf(module);
  const model = ridgeModel(safeRows, { hourField: info.byKey.get('takeoff_time'), seriesField: info.byKey.get('aircraft_type'), metric: null, unit: 'зл.' });
  return { ...model, title: 'Зльоти за годинами доби', rowCount: safeRows.length };
}

/** Ініціали для бейджа рейтингу: «Тестенко І. П.» → «ТІ», «2 АЕ» → «2А». */
export function initialsOf(label) {
  const words = text(label).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return '—';
  return words.slice(0, 2).map(word => word[0].toLocaleUpperCase('uk')).join('');
}

const BUILDERS = {
  kpi,
  line: (module, rows, info) => seriesChart('line', module, rows, info),
  area: (module, rows, info) => seriesChart('area', module, rows, info),
  columns: (module, rows, info) => seriesChart('columns', module, rows, info),
  'stacked-columns': (module, rows, info) => seriesChart('stacked-columns', module, rows, info),
  'horizontal-bar': horizontalBars,
  'grouped-columns': twoMetricColumns,
  'diverging-bars': divergingBars,
  combo,
  donut,
  'radial-progress': radialProgress,
  'multi-ring': multiRing,
  radar,
  gauge,
  'progress-bars': progressBars,
  calendar,
  table,
  funnel,
  map: mapModel,
  cohort,
  activity,
  waveform,
  leaderboard,
  ridgeline,
};

export const CHART_KINDS = Object.freeze(Object.keys(BUILDERS));

/**
 * Модель діаграми для модуля: вид з `visualKind` (невідомий — таблиця), поля за ролями, рядки
 * як є. Журнал польотів малюється як смуги нальоту за типом ПС незалежно від виду.
 */
export function chartModel(module, rows) {
  const safeRows = (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === 'object').slice(0, ROW_LIMIT);
  const info = fieldsOf(module);
  const isFlightHours = module?.templateId === 'flight-hours'
    || (info.byKey.has('aircraft_type') && info.byKey.has('airborne_hours') && info.byKey.has('total_hours'));
  try {
    if (isFlightHours) return { ...flightHours(module, safeRows, info), rowCount: safeRows.length };
    const build = BUILDERS[module?.visualKind] ?? table;
    return { ...build(module, safeRows, info), rowCount: safeRows.length };
  } catch (error) {
    // Зламана схема не має валити дашборд: показуємо таблицю з тим, що є.
    return { ...table(module, safeRows, info), rowCount: safeRows.length, fallback: String(error?.message ?? error) };
  }
}

/** Коротке словесне резюме для доступності картки: «Лінійний графік: 2 ряди, 12 точок». */
export function chartSummary(model) {
  const rows = count => `${count} ${pluralForm(count, 'запис', 'записи', 'записів')}`;
  const names = {
    kpi: 'Ключовий показник', line: 'Лінійний графік', area: 'Графік із площею', columns: 'Стовпчики', 'stacked-columns': 'Накопичені стовпчики',
    'horizontal-bar': 'Горизонтальні смуги', 'grouped-columns': 'Згруповані стовпчики', 'diverging-bars': 'Приріст і втрати', combo: 'Стовпчики з лінією',
    donut: 'Кільцева діаграма', 'radial-progress': 'Радіальний прогрес', 'multi-ring': 'Кілька радіальних шкал', radar: 'Радар', gauge: 'Шкала',
    'progress-bars': 'Смуги виконання', calendar: 'Календар', table: 'Таблиця', funnel: 'Воронка', map: 'Карта', cohort: 'Когорти',
    activity: 'Стрічка подій', waveform: 'Двобічна гістограма', leaderboard: 'Рейтинг', ridgeline: 'Гребені за годинами доби',
  };
  const name = names[model?.kind] ?? 'Діаграма';
  if (!model || model.empty) return `${name}: даних ще немає`;
  const parts = [rows(model.rowCount ?? 0)];
  if (model.series?.length > 1) parts.push(`${model.series.length} ${pluralForm(model.series.length, 'ряд', 'ряди', 'рядів')}`);
  if (model.kind === 'kpi' && model.valueText) parts.push(`${model.label}: ${model.valueText}${model.unit ? ` ${model.unit}` : ''}`);
  if (model.kind === 'gauge') parts.push(`${model.label}: ${model.valueText} з ${model.maxText}`);
  if (model.kind === 'ridgeline') parts.push(...model.series.slice(0, 3).map(item => `пік ${item.name} о ${item.peakText}`));
  return `${name}: ${parts.join(', ')}`;
}

/**
 * Пункти бігучого рядка дашборда: назва модуля й словесне резюме його діаграми з тих самих
 * рядків, що й картка. Модулі без прочитаних даних позначаються, а не пропускаються мовчки.
 */
export function tickerItems(modules, dataById) {
  const list = Array.isArray(modules) ? modules : [];
  return list.map(module => {
    const payload = dataById?.get?.(module?.id);
    if (!payload || payload.failed) return { id: module?.id ?? '', title: text(module?.title), text: 'дані не прочитано', failed: true };
    const summary = chartSummary(chartModel(module, payload.rows));
    // «Назва виду: …» → лише те, що після двокрапки: вид і так видно на картці.
    const detail = summary.includes(': ') ? summary.slice(summary.indexOf(': ') + 2) : summary;
    return { id: module.id, title: text(module.title), text: detail, failed: false };
  });
}

export const dashboardModuleChartsCore = {
  SERIES_LIMIT, CATEGORY_LIMIT, OTHER_LABEL, CHART_KINDS,
  compactNumber, valueLabel, niceTicks, parseMoment, momentLabel, monthTitle, assignSlots, initialsOf, chartModel, chartSummary,
  RIDGE_LIMIT, hourOf, takeoffHoursModel, tickerItems,
};
