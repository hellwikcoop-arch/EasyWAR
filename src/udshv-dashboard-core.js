/* Дашборд УДШВ: «Втрати о/с та ОВТ противника за угруповання ДШВ».
   Чисте ядро без DOM: розбір аркушів-місяців, періоди, агрегати, перевірка. */

import { KPI, computeUdshvKpis, inGroup, sumBy } from './module-adapters/udshv-kpi-core.js';

const norm = value => String(value == null ? '' : value)
  .replace(/[’ʼ]/g, "'")
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase('uk-UA');

const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

export const GROUPS = [
  { key: 'fire', name: 'Вогневі засоби', short: 'ВгЗ / КББ' },
  { key: 'ammo', name: 'Витрата боєприпасів', short: 'Витрата БК' },
  { key: 'personnel', name: 'Втрати о/с', short: 'Втрати о/с' },
  { key: 'categories', name: 'Втрати противника за категоріями', short: 'Категорії' },
  { key: 'destroyed', name: 'ЗНИЩЕНО', short: 'Знищено' },
  { key: 'damaged', name: 'ПОШКОДЖЕНО', short: 'Пошкоджено' },
  { key: 'suppressed', name: 'ПОДАВЛЕНО', short: 'Подавлено' },
];
export const OVT_GROUPS = ['destroyed', 'damaged', 'suppressed'];

function groupKey(header) {
  const h = norm(header);
  if (/^витрата/.test(h)) return 'ammo';
  if (/^втрати о\/с/.test(h)) return 'personnel';
  if (/^втрати противника|^найменування/.test(h)) return 'categories';
  if (/^знищено/.test(h)) return 'destroyed';
  if (/^пошкоджено/.test(h)) return 'damaged';
  if (/^подавлено/.test(h)) return 'suppressed';
  return null;
}

// Одні й ті самі засоби по-різному підписані в різних місяцях.
const METRIC_ALIASES = [
  [/^мотоц[им]к?л$|^мотоцмкл$/, 'мотоцикл'],
  [/^(?:кп|пу|ксп)(?:, ?(?:кп|пу|ксп)){2}$/, 'КП, ПУ, КСП'],
  [/^пу бпла$/, 'ПУ БпЛА'],
  [/^(?:152 мм )?(?:сау )?2с19$/, '152 мм 2С19'],
  [/^(?:122 мм )?(?:сау )?2с1$/, '122 мм 2С1'],
  [/^(?:170 мм )?сау коксан$/, '170 мм САУ Коксан'],
  [/^переправа$/, 'Переправа'],
  [/^артилерія$/, 'Артилерія'],
  [/^міномети$/, 'Міномети'],
  [/^склади? бк, пмм$/, 'Склади БК, ПММ'],
  [/^227 ?мм ракети$/, '227мм ракети'],
  [/^(\d+) мм міномет$/, '$1 мм міномет'],
];
export function metricName(header) {
  const text = clean(header).replace(/,$/, '').trim();
  const key = norm(text).replace(/,$/, '');
  for (const [re, name] of METRIC_ALIASES) if (re.test(key)) return key.replace(re, name);
  return text;
}

const UNIT_ALIASES = [[/^рук ?148 ?оабр$/, 'РУК 148 оабр']];
export function unitName(raw) {
  const text = clean(raw).replace(/(\d)([А-ЯІЇЄҐа-яіїєґ])/g, '$1 $2');
  const key = norm(text);
  for (const [re, name] of UNIT_ALIASES) if (re.test(key)) return name;
  return text;
}

const excelEpoch = Date.UTC(1899, 11, 30);
export function cellDate(raw) {
  const v = clean(raw);
  if (!v) return '';
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(v))) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (/^\d{5}(?:\.\d+)?$/.test(v)) return new Date(excelEpoch + Math.floor(+v) * 864e5).toISOString().slice(0, 10);
  return '';
}

export const dayNumber = value => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
};
export const isoFromDay = value => new Date(value * 864e5).toISOString().slice(0, 10);

const colNum = letters => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
const cellText = cell => cell == null ? '' : (typeof cell === 'object' ? cell.v : cell);

/**
 * Аркуш у вигляді прямокутної сітки для показу «як імпортовано»: непорожні рядки, стовпці за літерами Excel.
 * `head` — скільки перших рядків сітки є шапкою (рядок із «Підрозділ/ВгЗ/КББ/Дата» і підшапка під ним).
 * Дати-числа Excel у стовпці «Дата» показуємо як ДД.ММ.РРРР, решта значень — текстом без змін.
 */
export function rawSheetGrid(sheet) {
  const all = (sheet && sheet.rows) || [];
  const rows = all.filter(row => Object.values(row.cells || {}).some(cell => clean(cellText(cell)) !== ''));
  const letters = new Set();
  for (const row of rows) for (const [letter, cell] of Object.entries(row.cells || {})) if (clean(cellText(cell)) !== '') letters.add(letter);
  const columns = [...letters].sort((a, b) => colNum(a) - colNum(b));
  const header = headerRowOf(all);
  const dateCols = new Set(header ? columns.filter(letter => norm(cellText(header.cells[letter])) === 'дата') : []);
  const show = (row, letter) => {
    const value = clean(cellText((row.cells || {})[letter]));
    if (header && row.r > header.r && dateCols.has(letter)) {
      const iso = cellDate(value);
      if (iso) return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    }
    return value;
  };
  const headEnd = header ? rows.findIndex(row => row.r > header.r + 1) : 0;
  return {
    columns,
    head: header ? (headEnd < 0 ? rows.length : headEnd) : 0,
    rows: rows.map(row => ({ r: row.r, cells: columns.map(letter => show(row, letter)) })),
  };
}

/** Аркуш схожий на таблицю УДШВ: у шапці є «Підрозділ», «ВгЗ», «КББ» і «Дата». */
function headerRowOf(rows) {
  return rows.slice(0, 8).find(row => {
    const values = new Set(Object.values(row.cells).map(cell => norm(cellText(cell))));
    return values.has('підрозділ') && values.has('вгз') && values.has('кбб') && values.has('дата');
  }) || null;
}
const WEEKDAYS = /^(?:понеділок|вівторок|віторок|середа|четвер|п'ятниця|субота|неділя|пн|вт|ср|чт|пт|сб|нд)$/;
const TEMPLATE_SHEET = /чист|шаблон|зразок|template/i;

/**
 * Розбирає аркуші книги у модель УДШВ.
 * `sheets` — [{ name, rows: [{ r, cells: { A: { v } | 'значення' } }] }] (так читає rocket.html).
 * Кидає помилку з code = 'NOT_UDSHV', якщо жоден аркуш не схожий на таблицю УДШВ.
 */
export function parseUdshvWorkbook(sheets, sourceName = '') {
  const out = [];
  let recognised = 0;
  for (const sheet of sheets || []) {
    const rows = sheet.rows || [];
    const header = headerRowOf(rows);
    if (!header) continue;
    recognised++;
    if (TEMPLATE_SHEET.test(sheet.name)) continue;
    const parsed = parseSheet(sheet.name, rows, header);
    if (parsed) out.push(parsed);
  }
  if (!recognised) {
    const error = new Error('Це не таблиця УДШВ: потрібна шапка «Дата», «Підрозділ», «ВгЗ», «КББ».');
    error.code = 'NOT_UDSHV';
    throw error;
  }
  const workbook = buildWorkbook(out, sourceName);
  // Аркуші файлу як є — для вкладки «База даних» (показ без підрахунків і правок).
  // Не перелічується: помічник і копіювання моделі обходять лише розібрані дані, а не вдруге весь сирий вміст.
  Object.defineProperty(workbook, 'raw', { enumerable: false, configurable: true, writable: true, value: (sheets || []).map(sheet => ({ name: sheet.name, template: TEMPLATE_SHEET.test(sheet.name) && !!headerRowOf(sheet.rows || []), rows: sheet.rows || [] })) });
  return workbook;
}

function parseSheet(name, rows, header) {
  const sub = rows.find(row => row.r === header.r + 1) || { cells: {} };
  const columns = Object.keys(Object.assign({}, header.cells, sub.cells)).sort((a, b) => colNum(a) - colNum(b));
  const find = label => columns.find(letter => norm(cellText(header.cells[letter])) === label);
  const dateCol = find('дата');
  const unitCol = find('підрозділ');
  const weekdayCol = find('день тижня');
  const metrics = [];
  let carried = null;
  for (const letter of columns) {
    if (colNum(letter) <= colNum(unitCol)) continue;
    const top = clean(cellText(header.cells[letter]));
    const low = clean(cellText(sub.cells[letter]));
    if (top) carried = groupKey(top);
    if (top && !low) {
      carried = null;
      const g = groupKey(top);
      if (!g) metrics.push({ letter, group: 'fire', name: metricName(top) });
      continue;
    }
    if (!low || !carried) continue;
    const metric = metricName(low);
    if (carried === 'ammo' && norm(metric) === 'всього') { metrics.push({ letter, group: 'ammo', name: 'ВСЬОГО', total: true }); continue; }
    metrics.push({ letter, group: carried, name: metric });
  }
  const first = Math.max(header.r, sub.r || 0) + 1;
  const titleRow = rows.find(row => row.r < header.r && Object.values(row.cells).some(cell => clean(cellText(cell))));
  const title = titleRow ? clean(Object.values(titleRow.cells).map(cellText).find(v => clean(v))) : '';
  let date = '';
  let summary = false;
  const records = [];
  const issues = [];
  for (const row of rows) {
    if (row.r < first) continue;
    const rawDate = clean(cellText(row.cells[dateCol]));
    const label = weekdayCol ? clean(cellText(row.cells[weekdayCol])) : '';
    if (!rawDate && label && !WEEKDAYS.test(norm(label))) {
      // Підсумкові блоки («01-10.05.26», «ЗА ТРАВЕНЬ 2026», «ВСЬОГО») — не денні дані.
      date = '';
      summary = true;
      continue;
    }
    if (rawDate) {
      summary = false;
      const d = cellDate(rawDate);
      if (d) date = d;
      else issues.push({ sheet: name, rowNumber: row.r, type: 'invalid-date', raw: rawDate });
    }
    const unitRaw = clean(cellText(row.cells[unitCol]));
    if (!unitRaw) continue;
    const values = {};
    let total = 0;
    for (const m of metrics) {
      const raw = clean(cellText(row.cells[m.letter]));
      if (!raw) continue;
      const n = Number(raw.replace(',', '.'));
      if (Number.isFinite(n)) {
        if (n !== 0) { const id = `${m.group}|${m.name}`; values[id] = (values[id] || 0) + n; total += Math.abs(n); }
        if (n < 0) issues.push({ sheet: name, rowNumber: row.r, type: 'negative', metric: m.name, raw });
      } else issues.push({ sheet: name, rowNumber: row.r, type: 'text-in-numeric', metric: m.name, raw });
    }
    if (summary) continue;
    if (!date) { if (total) issues.push({ sheet: name, rowNumber: row.r, type: 'number-without-date' }); continue; }
    records.push({ sheet: name, rowNumber: row.r, date, unit: unitName(unitRaw), values });
  }
  return { name: clean(name), title, metrics, records, issues };
}

function buildWorkbook(sheets, sourceName) {
  const catalog = new Map();
  for (const sheet of sheets) for (const m of sheet.metrics) {
    const id = `${m.group}|${m.name}`;
    if (!catalog.has(id)) catalog.set(id, { id, group: m.group, name: m.name, total: !!m.total, sheets: [] });
    catalog.get(id).sheets.push(sheet.name);
  }
  const records = sheets.flatMap(sheet => sheet.records).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const units = [];
  for (const r of records) if (!units.includes(r.unit)) units.push(r.unit);
  return {
    kind: 'udshv',
    readOnly: true,
    sourceName,
    sheetName: sheets.map(sheet => sheet.name).join(' / '),
    sheets: sheets.map(({ name, title, metrics, records: rs, issues }) => ({ name, title, metricCount: metrics.length, rowCount: rs.length, issues, dates: [...new Set(rs.map(r => r.date))] })),
    metrics: [...catalog.values()],
    units,
    records,
    issues: sheets.flatMap(sheet => sheet.issues),
  };
}

/* ------------------------------ періоди ------------------------------ */

const hasData = record => Object.keys(record.values).length > 0;

export function allDateRange(workbook) {
  const dates = (workbook?.records || []).map(r => r.date).filter(Boolean).sort();
  return { from: dates[0] || '', to: dates[dates.length - 1] || '' };
}

/** Остання дата, за яку хтось щось доповів (кінець місяця часто заповнений нулями наперед). */
export function lastActiveDate(workbook) {
  const dates = (workbook?.records || []).filter(hasData).map(r => r.date).sort();
  return dates[dates.length - 1] || allDateRange(workbook).to;
}

export function weekRange(anchor) {
  const day = dayNumber(anchor);
  if (!Number.isFinite(day)) return { from: '', to: '' };
  const weekday = (new Date(day * 864e5).getUTCDay() + 6) % 7; // понеділок = 0
  return { from: isoFromDay(day - weekday), to: isoFromDay(day - weekday + 6) };
}

export function monthRange(anchor) {
  const m = /^(\d{4})-(\d{2})/.exec(anchor || '');
  if (!m) return { from: '', to: '' };
  const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}

/** Діапазон для пресету: 'week' | 'month' | 'all' | 'custom'. */
export function periodRange(workbook, preset, anchor, custom = {}) {
  if (preset === 'week') return weekRange(anchor || lastActiveDate(workbook));
  if (preset === 'month') return monthRange(anchor || lastActiveDate(workbook));
  if (preset === 'custom' && custom.from && custom.to) return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  return allDateRange(workbook);
}

/** Зсуває опорну дату на ±1 тиждень або місяць. */
export function shiftAnchor(preset, anchor, step) {
  const day = dayNumber(anchor);
  if (!Number.isFinite(day)) return anchor;
  if (preset === 'week') return isoFromDay(day + 7 * step);
  if (preset === 'month') {
    const d = new Date(day * 864e5);
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1));
    return target.toISOString().slice(0, 10);
  }
  return anchor;
}

export function previousRange(range) {
  const from = dayNumber(range.from), to = dayNumber(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { from: '', to: '' };
  const length = to - from + 1;
  return { from: isoFromDay(from - length), to: isoFromDay(from - 1) };
}

/** Попередній період: минулий тиждень, минулий календарний місяць або відрізок тієї ж довжини. */
export function previousPeriod(preset, range) {
  if (preset === 'month' && range.from) return monthRange(shiftAnchor('month', range.from, -1));
  return previousRange(range);
}

export const inRange = (record, range) => (!range.from || record.date >= range.from) && (!range.to || record.date <= range.to);

export function daysOf(range) {
  const from = dayNumber(range.from), to = dayNumber(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  const out = [];
  for (let d = from; d <= to; d++) out.push(isoFromDay(d));
  return out;
}

/* ------------------------------ агрегати ------------------------------ */

export { KPI };

export function metricTotals(records, group) {
  const totals = new Map();
  for (const r of records) for (const [id, v] of Object.entries(r.values)) {
    if (!id.startsWith(`${group}|`)) continue;
    totals.set(id, (totals.get(id) || 0) + v);
  }
  return [...totals.entries()].map(([id, total]) => ({ id, name: id.slice(group.length + 1), total }))
    .filter(item => item.total !== 0).sort((a, b) => b.total - a.total);
}

/** Ряд по днях (або по тижнях, якщо період довгий). */
export function seriesFor(records, range, value, bucket = 'day') {
  const days = daysOf(range);
  const byDay = new Map(days.map(d => [d, []]));
  for (const r of records) if (byDay.has(r.date)) byDay.get(r.date).push(r);
  if (bucket === 'day') return days.map(d => ({ key: d, from: d, to: d, value: value(byDay.get(d)) }));
  const buckets = [];
  for (const d of days) {
    const start = bucket === 'week' ? weekRange(d).from : monthRange(d).from;
    let b = buckets[buckets.length - 1];
    if (!b || b.key !== start) { b = { key: start, from: d, to: d, rows: [] }; buckets.push(b); }
    b.to = d; b.rows.push(...byDay.get(d));
  }
  return buckets.map(b => ({ key: b.key, from: b.from, to: b.to, value: value(b.rows) }));
}

export function bucketFor(range) {
  const length = daysOf(range).length;
  return length > 200 ? 'month' : length > 45 ? 'week' : 'day';
}

export function unitSummary(records, units) {
  const byUnit = new Map(units.map(u => [u, []]));
  for (const r of records) { if (!byUnit.has(r.unit)) byUnit.set(r.unit, []); byUnit.get(r.unit).push(r); }
  return [...byUnit.entries()].map(([unit, rs]) => {
    const row = { unit, days: new Set(rs.filter(hasData).map(r => r.date)).size };
    for (const k of KPI) row[k.key] = k.value(rs);
    return row;
  });
}

/** Матриця підрозділ × показник групи. */
export function unitMatrix(records, units, group) {
  const metrics = metricTotals(records, group);
  const rows = units.map(unit => {
    const cells = {};
    for (const r of records) if (r.unit === unit) for (const [id, v] of Object.entries(r.values)) if (id.startsWith(`${group}|`)) cells[id] = (cells[id] || 0) + v;
    return { unit, cells, total: Object.entries(cells).filter(([id]) => id !== 'ammo|ВСЬОГО').reduce((s, [, v]) => s + v, 0) };
  }).filter(row => row.total !== 0 || Object.keys(row.cells).length);
  return { metrics, rows };
}

export function weekdayProfile(records, value) {
  const names = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const buckets = names.map(() => []);
  for (const r of records) { const d = dayNumber(r.date); if (Number.isFinite(d)) buckets[(new Date(d * 864e5).getUTCDay() + 6) % 7].push(r); }
  return names.map((name, i) => ({ name, value: value(buckets[i]) }));
}

// Фільтр за підрозділами: порожньо — усі; рядок — один підрозділ; масив — кілька. Повертає масив без дублікатів.
export function normalizeUnits(unit) {
  const list = Array.isArray(unit) ? unit : unit ? [unit] : [];
  return [...new Set(list.filter(Boolean))];
}

export function createDashboardModel(workbook, options = {}) {
  const range = options.range || allDateRange(workbook);
  const selected = normalizeUnits(options.unit);
  const unit = selected.length === 1 ? selected[0] : '';
  const scoped = (workbook?.records || []).filter(r => !selected.length || selected.includes(r.unit));
  const current = scoped.filter(r => inRange(r, range));
  const prevRange = previousPeriod(options.preset, range);
  const previous = prevRange.from ? scoped.filter(r => inRange(r, prevRange)) : [];
  const hasPrevious = previous.length > 0;
  const bucket = bucketFor(range);
  // Картки показників рахує спільне ядро модулів (E2), формули ті самі.
  const kpis = computeUdshvKpis({ current, previous, range, bucket }, seriesFor);
  const units = selected.length ? workbook.units.filter(u => selected.includes(u)) : workbook.units;
  return {
    range, previousRange: prevRange, hasPrevious, bucket, unit, selectedUnits: selected,
    days: daysOf(range).length,
    activeDays: new Set(current.filter(hasData).map(r => r.date)).size,
    records: current,
    kpis,
    // Усього за весь час таблиці (з урахуванням фільтра підрозділів, без фільтра періоду).
    ovtOverall: Object.fromEntries(OVT_GROUPS.map(g => [g, sumBy(scoped, inGroup(g))])),
    personnelSeries: seriesFor(current, range, rs => ({ kia: sumBy(rs, id => id === 'personnel|200'), wia: sumBy(rs, id => id === 'personnel|300') }), bucket),
    ovtSeries: seriesFor(current, range, rs => ({ destroyed: sumBy(rs, inGroup('destroyed')), damaged: sumBy(rs, inGroup('damaged')), suppressed: sumBy(rs, inGroup('suppressed')) }), bucket),
    units: unitSummary(current, units),
    groups: Object.fromEntries(GROUPS.map(g => [g.key, metricTotals(current, g.key)])),
    matrix: Object.fromEntries(GROUPS.map(g => [g.key, unitMatrix(current, units, g.key)])),
    weekday: weekdayProfile(current, rs => sumBy(rs, inGroup('personnel'))),
  };
}

/* ------------------------------ актуальність підрозділів ------------------------------ */

export const STALE_DAYS = 7; // підрозділ без даних довше цього вважається без свіжих

/**
 * Актуальність: для кожного підрозділу остання дата з ненульовими даними, відставання від останньої активної
 * дати таблиці й кількість діб із даними за останні 30. Рядки з датою не з місяця аркуша не враховуються.
 * Підрозділи без свіжих даних (або без даних зовсім) стоять першими.
 */
export function unitFreshness(workbook, options = {}) {
  const anchor = options.anchor || lastActiveDate(workbook);
  const staleDays = options.staleDays == null ? STALE_DAYS : options.staleDays;
  const selected = normalizeUnits(options.units);
  const names = selected.length ? workbook.units.filter(u => selected.includes(u)) : workbook.units;
  const stray = new Set(validateWorkbook(workbook).filter(i => i.type === 'date-outside-month').map(i => `${i.sheet}|${i.rowNumber}`));
  const anchorDay = dayNumber(anchor);
  const recentFrom = Number.isFinite(anchorDay) ? isoFromDay(anchorDay - 29) : '';
  const rows = names.map((unit, order) => {
    const dates = workbook.records.filter(r => r.unit === unit && hasData(r) && r.date <= anchor && !stray.has(`${r.sheet}|${r.rowNumber}`)).map(r => r.date).sort();
    const last = dates[dates.length - 1] || '';
    const lag = last ? anchorDay - dayNumber(last) : null;
    return { unit, order, lastDate: last, lag, daysWithData30: new Set(dates.filter(d => d >= recentFrom)).size, stale: lag == null || lag > staleDays };
  });
  rows.sort((a, b) => (b.stale - a.stale) || ((b.lag ?? Infinity) - (a.lag ?? Infinity)) || a.order - b.order);
  const stale = rows.filter(r => r.stale).length;
  return { anchor, staleDays, total: rows.length, fresh: rows.length - stale, stale, rows: rows.map(({ order, ...row }) => row) };
}

/* ------------------------------ таблиця й CSV ------------------------------ */

export function pivotRows(workbook, range, unit = '') {
  const selected = normalizeUnits(unit);
  const records = workbook.records.filter(r => inRange(r, range) && (!selected.length || selected.includes(r.unit)));
  const units = selected.length ? workbook.units.filter(u => selected.includes(u)) : workbook.units;
  const metrics = workbook.metrics.filter(m => records.some(r => r.values[m.id]));
  const rows = units.map(u => {
    const cells = {};
    for (const r of records) if (r.unit === u) for (const [id, v] of Object.entries(r.values)) cells[id] = (cells[id] || 0) + v;
    return { unit: u, cells };
  });
  const totals = {};
  for (const row of rows) for (const [id, v] of Object.entries(row.cells)) totals[id] = (totals[id] || 0) + v;
  return { metrics, rows, totals };
}

export function csvRows(workbook, range, unit = '') {
  const pivot = pivotRows(workbook, range, unit);
  const groupName = key => (GROUPS.find(g => g.key === key) || {}).name || key;
  return [
    ['Підрозділ', ...pivot.metrics.map(m => `${groupName(m.group)}: ${m.name}`)],
    ...pivot.rows.map(row => [row.unit, ...pivot.metrics.map(m => row.cells[m.id] || 0)]),
    ['Разом', ...pivot.metrics.map(m => pivot.totals[m.id] || 0)],
  ];
}

export function toCsv(rows) {
  return '﻿' + rows.map(row => row.map(value => {
    const text = String(value == null ? '' : value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(';')).join('\r\n');
}

/* ------------------------------ перевірка ------------------------------ */

const ISSUE_TEXT = {
  'invalid-date': 'Не вдалося прочитати дату',
  'negative': 'Від’ємне значення',
  'text-in-numeric': 'Текст у числовій клітинці',
  'number-without-date': 'Числа без дати',
  'date-outside-month': 'Дата не з місяця аркуша',
  'missing-date': 'Немає даних за день',
  'ammo-total': 'ВСЬОГО не дорівнює сумі боєприпасів',
  'duplicate': 'Підрозділ двічі за день',
};

const MONTHS = ['січ', 'лют', 'берез', 'квіт', 'трав', 'черв', 'лип', 'серп', 'верес', 'жовт', 'листоп', 'груд'];
function sheetMonth(name) {
  const key = norm(name);
  const index = MONTHS.findIndex(m => key.startsWith(m));
  const year = /(\d{2,4})\s*$/.exec(key);
  if (index < 0 || !year) return '';
  return `${year[1].length === 2 ? '20' + year[1] : year[1]}-${String(index + 1).padStart(2, '0')}`;
}

export function validateWorkbook(workbook) {
  const issues = [...(workbook.issues || [])];
  const seen = new Map();
  for (const r of workbook.records) {
    const month = sheetMonth(r.sheet);
    if (month && r.date.slice(0, 7) !== month) issues.push({ sheet: r.sheet, rowNumber: r.rowNumber, type: 'date-outside-month', raw: r.date, unit: r.unit });
    const key = `${r.date}|${r.unit}`;
    if (seen.has(key)) issues.push({ sheet: r.sheet, rowNumber: r.rowNumber, type: 'duplicate', raw: r.date, unit: r.unit });
    seen.set(key, r);
    const own = r.values['ammo|ВСЬОГО'];
    if (own != null) {
      const sum = Object.entries(r.values).filter(([id]) => inGroup('ammo')(id)).reduce((s, [, v]) => s + v, 0);
      if (Math.abs(sum - own) > 1e-9) issues.push({ sheet: r.sheet, rowNumber: r.rowNumber, type: 'ammo-total', raw: `${own} ≠ ${sum}`, unit: r.unit });
    }
  }
  const range = allDateRange(workbook);
  const dates = new Set(workbook.records.map(r => r.date));
  for (const d of daysOf(range)) if (!dates.has(d)) issues.push({ type: 'missing-date', raw: d });
  return issues.map(item => Object.assign({ text: ISSUE_TEXT[item.type] || item.type }, item));
}

export function groupIssues(issues) {
  const groups = new Map();
  for (const item of issues) {
    if (!groups.has(item.type)) groups.set(item.type, { type: item.type, text: item.text, items: [] });
    groups.get(item.type).items.push(item);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}
