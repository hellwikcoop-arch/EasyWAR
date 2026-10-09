/* Таблиці ПС і РВ (аркуш «Зведена», контракт із 15 полів EasyWAR): чисте ядро без DOM.
   Правила результату, відбою, кількості та двох формул ефективності повторюють
   Rust-модель дашборда (src-tauri/src/analytics.rs), а не вигадані тут.
   Зчитуються лише поля, потрібні для аналітики. Координати, райони, номери цілей і текст
   уточнення не читаються й не потрапляють у модель. */

const norm = value => String(value == null ? '' : value).replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const cellText = cell => (cell == null ? '' : typeof cell === 'object' ? cell.v : cell);
const excelEpoch = Date.UTC(1899, 11, 30);

/** ISO, дд.мм.рррр, дд/мм/рррр або серійний номер Excel → YYYY-MM-DD; інакше ''. */
export function strikeDate(raw) {
  const v = clean(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const iso = v.slice(0, 10);
    return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? '' : iso;
  }
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(v);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return d.getUTCFullYear() === +m[3] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[1] ? d.toISOString().slice(0, 10) : '';
  }
  if (/^\d{5}(?:\.\d+)?$/.test(v)) return new Date(excelEpoch + Math.floor(+v) * 864e5).toISOString().slice(0, 10);
  return '';
}

/** Категорії результату: hit, partial, miss, unknown (як у Rust-моделі). */
export function classifyResult(raw) {
  const v = norm(raw);
  if (!v) return 'unknown';
  if (/^(частков|пошкоджен|подавлен)/.test(v)) return 'partial';
  if (/^не\s*(уражен|влуч|підтверджен)/.test(v)) return 'miss';
  if (/^(уражен|знищен)/.test(v)) return 'hit';
  return 'unknown';
}

const NONE_MARKERS = new Set(['', '—', '-', '–']);
export const canonicalUnit = raw => {
  const v = clean(raw);
  return v.toLocaleLowerCase('uk-UA') === '79 обрмп' ? '79 ОДШБр' : v;
};

const REQUIRED = { date: 'дата', result: 'результат ураження' };
const OPTIONAL = { unit: 'в інтересах', type: 'тип цілі', munition: 'тип боєприпасу', count: 'к-сть боєприпасів', reason: 'причина' };

function headerOf(rows) {
  return rows.slice(0, 5).find(row => {
    const values = new Set(Object.values(row.cells).map(cell => norm(cellText(cell))));
    return values.has(REQUIRED.date) && values.has(REQUIRED.result);
  }) || null;
}

function findColumn(header, label) {
  const hits = Object.entries(header.cells).filter(([, cell]) => norm(cellText(cell)) === label).map(([letter]) => letter);
  if (hits.length > 1) {
    const error = new Error(`У заголовку стовпець «${label}» повторюється: не можна вибрати один.`);
    error.code = 'AMBIGUOUS_HEADER';
    throw error;
  }
  return hits[0] || null;
}

/**
 * Розбирає таблицю ПС або РВ. Кидає NOT_STRIKES, якщо немає аркуша з шапкою «Дата» і «Результат ураження».
 * Засіб (ЛА для ПС, ПУ для РВ) визначається за заголовком «Тип ЛА» або «Тип ПУ».
 */
export function parseStrikes(sheets, sourceName = '') {
  const sheet = (sheets || []).find(s => norm(s.name) === 'зведена' && headerOf(s.rows || [])) || (sheets || []).find(s => headerOf(s.rows || []));
  if (!sheet) {
    const error = new Error('Це не таблиця ударів: потрібен аркуш із шапкою «Дата» і «Результат ураження».');
    error.code = 'NOT_STRIKES';
    throw error;
  }
  const rows = sheet.rows;
  const header = headerOf(rows);
  const col = { date: findColumn(header, REQUIRED.date), result: findColumn(header, REQUIRED.result) };
  for (const [key, label] of Object.entries(OPTIONAL)) col[key] = findColumn(header, label);
  const weaponLabel = ['тип ла', 'тип пу'].find(label => findColumn(header, label));
  col.weapon = weaponLabel ? findColumn(header, weaponLabel) : null;
  const records = [];
  const undated = [];
  const issues = [];
  for (const row of rows) {
    if (row.r <= header.r) continue;
    const dateRaw = clean(cellText(row.cells[col.date]));
    const resultRaw = clean(cellText(row.cells[col.result]));
    if (!dateRaw && !resultRaw) continue;
    const date = strikeDate(dateRaw);
    if (!date) issues.push({ rowNumber: row.r, type: 'invalid-date', raw: dateRaw });
    const countRaw = clean(cellText(row.cells[col.count]));
    let count = 0;
    if (!NONE_MARKERS.has(countRaw)) {
      const m = /^(\d+)/.exec(countRaw);
      if (m) count = Number(m[1]); else issues.push({ rowNumber: row.r, type: 'invalid-count', raw: countRaw });
    }
    const reasonRaw = clean(cellText(row.cells[col.reason]));
    const result = classifyResult(resultRaw);
    if (result === 'unknown') issues.push({ rowNumber: row.r, type: 'unknown-result', raw: resultRaw });
    const munition = clean(cellText(row.cells[col.munition]));
    (date ? records : undated).push({
      rowNumber: row.r,
      date,
      dateRaw,
      unit: canonicalUnit(cellText(row.cells[col.unit])),
      types: clean(cellText(row.cells[col.type])).split(',').map(clean).filter(Boolean),
      weapon: clean(cellText(row.cells[col.weapon])),
      munition: NONE_MARKERS.has(munition) ? '' : munition,
      count,
      result,
      aborted: /відбій/i.test(resultRaw) || /відбій/i.test(reasonRaw),
      reasons: reasonRaw.split(';').map(clean).filter(Boolean),
    });
  }
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rowNumber - b.rowNumber));
  // Рядки без читабельної дати не потрапляють в аналіз, але лишаються для виправлення в меню перевірки даних.
  return { kind: 'strikes', readOnly: true, sourceName, weaponLabel: weaponLabel === 'тип пу' ? 'Тип ПУ' : 'Тип ЛА', records, undated, issues };
}

const ISSUE_TEXT = {
  'invalid-date': 'Не вдалося прочитати дату',
  'invalid-count': 'Кількість боєприпасів не число',
  'unknown-result': 'Результат не розпізнано',
};
export const strikeIssues = workbook => (workbook.issues || []).map(item => Object.assign({ text: ISSUE_TEXT[item.type] || item.type }, item));

export const lastStrikeDate = workbook => (workbook.records.length ? workbook.records[workbook.records.length - 1].date : '');
export const firstStrikeDate = workbook => (workbook.records.length ? workbook.records[0].date : '');

const round2 = value => Math.round(value * 100) / 100;

/** Підсумки й дві формули ефективності Rust-моделі: (hit+partial)/evaluated і (hit+0,75·partial)/evaluated. */
export function strikeStats(records) {
  const out = { total: records.length, aborted: 0, hit: 0, partial: 0, miss: 0, unknown: 0, munitions: 0 };
  for (const r of records) {
    out.munitions += r.count;
    if (r.aborted) { out.aborted++; continue; }
    out[r.result]++;
  }
  out.evaluated = out.total - out.aborted;
  out.overall = out.evaluated ? round2((out.hit + out.partial) / out.evaluated * 100) : null;
  out.dpi = out.evaluated ? round2((out.hit + 0.75 * out.partial) / out.evaluated * 100) : null;
  return out;
}

/** Розподіл за полем-списком або полем-рядком: [{ name, total }] за спаданням; weight — внесок одного запису. */
export function tally(records, pick, weight = () => 1) {
  const totals = new Map();
  for (const r of records) for (const name of [].concat(pick(r)).filter(Boolean)) totals.set(name, (totals.get(name) || 0) + weight(r));
  return [...totals.entries()].map(([name, total]) => ({ name, total })).filter(i => i.total !== 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'uk'));
}
