/* Таблиця власних втрат («НАШІ ВТРАТИ»): чисте ядро без DOM.
   Це журнал подій: один рядок = одна подія (дата, підрозділ, втрати о/с 200/300/500,
   дія противника, втрати артилерійських систем знищені/пошкоджені).
   Підписи показників зберігаються дослівно; скорочення (РУ, АУ, АО, 200/300/500) не розшифровуються. */

const norm = value => String(value == null ? '' : value).replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const cellText = cell => (cell == null ? '' : typeof cell === 'object' ? cell.v : cell);
const colNum = letters => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
const OUTLIER_DAYS = 7;
const excelEpoch = Date.UTC(1899, 11, 30);

export const OWN_GROUPS = [
  { key: 'personnel', name: 'Втрати о/с' },
  { key: 'personnelCause', name: 'Дія противника (втрати о/с)' },
  { key: 'destroyed', name: 'Втрати арт. систем (знищені)' },
  { key: 'destroyedCause', name: 'Дії противника (знищені)' },
  { key: 'damaged', name: 'Втрати арт. систем (пошкоджені)' },
  { key: 'damagedCause', name: 'Дії противника (пошкоджені)' },
  { key: 'outOfOrder', name: 'Вийшли з ладу' },
];

/** dd.mm.yy(yy) або серійний номер Excel → YYYY-MM-DD; інакше ''. */
export function ownDate(raw) {
  const v = clean(raw);
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(v);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (/^\d{5}(?:\.\d+)?$/.test(v)) return new Date(excelEpoch + Math.floor(+v) * 864e5).toISOString().slice(0, 10);
  return '';
}

/** Вільний текст підрозділу → бригада за номером. Невідомий текст лишається як є. */
export function ownUnit(raw, brigades = DEFAULT_BRIGADES) {
  const text = clean(raw);
  const found = text.match(/\d+/g) || [];
  for (const n of found) if (brigades[n]) return brigades[n];
  const regiment = /(\d+)\s*ошп/i.exec(text);
  return regiment ? `${regiment[1]} ошп` : text;
}
export const DEFAULT_BRIGADES = { 78: '78 одшбр', 79: '79 одшбр', 80: '80 одшбр', 82: '82 одшбр', 95: '95 одшбр', 148: '148 оабр' };

function headerRowOf(rows) {
  return rows.slice(0, 12).find(row => {
    const values = new Set(Object.values(row.cells).map(cell => norm(cellText(cell))));
    return values.has('дата') && values.has('підрозділ');
  }) || null;
}

function groupOf(top, previousKey) {
  const t = norm(top);
  if (/^втрати о\/с/.test(t)) return 'personnel';
  if (/^ді[яї] противника/.test(t)) return { personnel: 'personnelCause', destroyed: 'destroyedCause', damaged: 'damagedCause' }[previousKey] || null;
  if (/втрати арт.*знищ/.test(t)) return 'destroyed';
  if (/втрати арт.*пошкодж/.test(t)) return 'damaged';
  if (/вийшли з ладу|вйшли з ладу/.test(t)) return 'outOfOrder';
  return null;
}

function parseSheet(sheet) {
  const rows = sheet.rows || [];
  const header = headerRowOf(rows);
  if (!header) return null;
  const sub = rows.find(row => row.r === header.r + 1) || { cells: {} };
  const columns = Object.keys(Object.assign({}, header.cells, sub.cells)).sort((a, b) => colNum(a) - colNum(b));
  const find = label => columns.find(letter => norm(cellText(header.cells[letter])) === label);
  const dateCol = find('дата');
  const unitCol = find('підрозділ');
  if (!dateCol || !unitCol) return null;
  const metrics = [];
  let group = null;
  let carriedKey = null;
  for (const letter of columns) {
    if (colNum(letter) <= colNum(unitCol)) continue;
    const top = clean(cellText(header.cells[letter]));
    if (top) { group = groupOf(top, carriedKey); if (group) carriedKey = group; }
    const low = clean(cellText(sub.cells[letter]));
    if (!group || !low) continue;
    // Текстова колонка «Найменування» поруч із кількістю за технічним станом — не показник.
    if (group === 'outOfOrder' && !/кількість/.test(norm(low))) continue;
    metrics.push({ letter, group, name: group === 'outOfOrder' ? 'За технічним станом' : low.replace(/\s+/g, ' ') });
  }
  const first = Math.max(header.r, sub.r || 0) + 1;
  const records = [];
  const undated = [];
  const issues = [];
  let totalsRow = null;
  for (const row of rows) {
    if (row.r < first) continue;
    const unitRaw = clean(cellText(row.cells[unitCol]));
    if (/^всього/.test(norm(unitRaw))) {
      totalsRow = {};
      for (const m of metrics) { const n = Number(clean(cellText(row.cells[m.letter])).replace(',', '.')); if (Number.isFinite(n)) totalsRow[`${m.group}|${m.name}`] = n; }
      break;
    }
    const number = clean(cellText(row.cells.A));
    if (!/^\d+$/.test(number) || !unitRaw) continue;
    const dateRaw = clean(cellText(row.cells[dateCol]));
    const date = ownDate(dateRaw);
    if (!date) issues.push({ sheet: sheet.name, rowNumber: row.r, type: 'invalid-date', raw: dateRaw });
    const values = {};
    for (const m of metrics) {
      const raw = clean(cellText(row.cells[m.letter]));
      if (!raw) continue;
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n)) { issues.push({ sheet: sheet.name, rowNumber: row.r, type: 'text-in-numeric', metric: m.name, raw }); continue; }
      if (n < 0) issues.push({ sheet: sheet.name, rowNumber: row.r, type: 'negative', metric: m.name, raw });
      if (n !== 0) { const id = `${m.group}|${m.name}`; values[id] = (values[id] || 0) + n; }
    }
    (date ? records : undated).push({ sheet: sheet.name, rowNumber: row.r, date, dateRaw, unitRaw, unit: ownUnit(unitRaw), values });
  }
  // Дата-викид: рядок, що різко відрізняється від обох сусідніх, які між собою близькі (типова описка в місяці).
  const gap = (a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5;
  records.forEach((r, i) => {
    const prev = records[i - 1], next = records[i + 1];
    if (prev && next && gap(r.date, prev.date) > OUTLIER_DAYS && gap(r.date, next.date) > OUTLIER_DAYS && gap(prev.date, next.date) <= OUTLIER_DAYS) {
      r.suspect = true;
      issues.push({ sheet: sheet.name, rowNumber: r.rowNumber, type: 'date-outlier', raw: r.date });
    }
  });
  return { name: clean(sheet.name), metrics, records, undated, issues, totalsRow };
}

/** Кидає помилку з code = 'NOT_OWN_LOSSES', якщо жоден аркуш не схожий на таблицю власних втрат. */
export function parseOwnLosses(sheets, sourceName = '') {
  const parsed = (sheets || []).map(parseSheet).filter(sheet => sheet && sheet.metrics.some(m => m.group === 'personnel'));
  if (!parsed.length) {
    const error = new Error('Це не таблиця власних втрат: потрібна шапка «Дата», «Підрозділ» і «Втрати О/С».');
    error.code = 'NOT_OWN_LOSSES';
    throw error;
  }
  const records = parsed.flatMap(sheet => sheet.records).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rowNumber - b.rowNumber));
  const units = [...new Set(records.map(r => r.unit))];
  return {
    kind: 'own_losses',
    readOnly: true,
    sourceName,
    sheets: parsed.map(({ name, records: rs }) => ({ name, rowCount: rs.length })),
    metrics: parsed.flatMap(sheet => sheet.metrics.map(({ group, name }) => ({ id: `${group}|${name}`, group, name }))).filter((m, i, list) => list.findIndex(o => o.id === m.id) === i),
    units,
    records,
    undated: parsed.flatMap(sheet => sheet.undated),
    totalsRows: parsed.map(sheet => ({ sheet: sheet.name, values: sheet.totalsRow })).filter(item => item.values),
    issues: parsed.flatMap(sheet => sheet.issues),
  };
}

const ISSUE_TEXT = {
  'invalid-date': 'Не вдалося прочитати дату',
  'date-outlier': 'Дата різко відрізняється від сусідніх рядків',
  'negative': 'Від’ємне значення',
  'text-in-numeric': 'Текст у числовій клітинці',
  'total-mismatch': 'Підсумок таблиці не збігається із сумою рядків',
};

/** Перевірка: суми рядків проти рядка «ВСЬОГО» самої таблиці. */
export function validateOwnLosses(workbook) {
  const issues = [...(workbook.issues || [])];
  for (const { sheet, values } of workbook.totalsRows || []) {
    for (const [id, total] of Object.entries(values)) {
      if (!id.startsWith('personnel|')) continue;
      const sum = workbook.records.filter(r => r.sheet === sheet).reduce((s, r) => s + (r.values[id] || 0), 0);
      if (sum !== total) issues.push({ sheet, type: 'total-mismatch', metric: id.split('|')[1], raw: `${sum} ≠ ${total}` });
    }
  }
  return issues.map(item => Object.assign({ text: ISSUE_TEXT[item.type] || item.type }, item));
}

export const inRange = (record, range) => (!range.from || record.date >= range.from) && (!range.to || record.date <= range.to);

export function lastOwnDate(workbook) {
  const dates = (workbook?.records || []).map(r => r.date).sort();
  return dates[dates.length - 1] || '';
}

export const sumGroup = (records, group, names) => records.reduce((sum, r) => sum + Object.entries(r.values).reduce((s, [id, v]) => (id.startsWith(`${group}|`) && (!names || names.includes(id.slice(group.length + 1))) ? s + v : s), 0), 0);
export const sumMetric = (records, id) => records.reduce((sum, r) => sum + (r.values[id] || 0), 0);

/** Підсумки групи за перелічені записи: [{ name, total }] за спаданням, без нулів. */
export function groupTotals(records, group) {
  const totals = new Map();
  for (const r of records) for (const [id, v] of Object.entries(r.values)) if (id.startsWith(`${group}|`)) totals.set(id, (totals.get(id) || 0) + v);
  return [...totals.entries()].map(([id, total]) => ({ name: id.slice(group.length + 1), total })).filter(i => i.total !== 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'uk'));
}
