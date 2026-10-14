/* Звірка підсумкових блоків таблиці УДШВ. Чисте ядро без DOM.

   Дашборд рахує суми лише з денних рядків. У самій таблиці підсумки ведуть формули й руки: декади та місяць підсумовують
   денні рядки, «початок місяця» («ЗА ТРАВЕНЬ - СЕРПЕНЬ 2026») має посилатися на «ВСЬОГО» попереднього аркуша,
   а «ВСЬОГО» = початок місяця + місяць. Якщо після копіювання аркуша посилання не оновили або число вписали вручну,
   підсумки в Excel розходяться з сумою днів — і цифри Excel та дашборда різняться. Тут це видно по клітинках.

   Вхід — книга з parseUdshvWorkbook(): workbook.blocks (підсумкові блоки), workbook.sheets[].letters (стовпці), records. */

import { sheetMonth } from './udshv-dashboard-core.js';

const EPS = 1e-6;
const same = (a, b) => Math.abs(a - b) <= EPS;
const MONTH_NAMES = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];

/** Правило кожного порівняння — для пояснення в інтерфейсі. */
export const RULES = {
  period: 'Підсумок декади чи місяця має дорівнювати сумі денних рядків за ці дні.',
  opening: 'Початок місяця має дорівнювати підсумку «ВСЬОГО» попереднього аркуша.',
  label: 'Підпис початку місяця має закінчуватися місяцем попереднього аркуша.',
  closing: '«ВСЬОГО» має дорівнювати початку місяця плюс місяць.',
  total: 'Підсумковий рядок («ВСЬОГО», «ЗАГАЛЬНА») має дорівнювати сумі рядків підрозділів блоку.',
};

const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const previousMonth = key => {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthTitle = key => (key && MONTH_NAMES[+key.slice(5, 7) - 1] ? `${MONTH_NAMES[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}` : '');
const hasValues = block => !!block && block.rows.some(r => r.count > 0 || Object.keys(r.values || {}).length > 0);
const metricParts = id => { const i = id.indexOf('|'); return { group: id.slice(0, i), metric: id.slice(i + 1) }; };

/* ------------------------------ сітки «підрозділ × показник» ------------------------------ */

/** Рядки блоку по підрозділах; якщо підрозділ записано двома рядками, значення додаються (як у «ВСЬОГО» в Excel). */
function gridOfBlock(block) {
  const grid = new Map();
  for (const r of block.rows) {
    const row = grid.get(r.unit) || { values: {}, rowNumber: r.rowNumber };
    for (const [id, v] of Object.entries(r.values)) row.values[id] = (row.values[id] || 0) + v;
    grid.set(r.unit, row);
  }
  return grid;
}

function gridOfRecords(records) {
  const grid = new Map();
  for (const r of records) {
    const row = grid.get(r.unit) || { values: {} };
    for (const [id, v] of Object.entries(r.values)) row.values[id] = (row.values[id] || 0) + v;
    grid.set(r.unit, row);
  }
  return grid;
}

function sumGrids(...grids) {
  const out = new Map();
  for (const grid of grids) for (const [unit, row] of grid) {
    const target = out.get(unit) || { values: {} };
    for (const [id, v] of Object.entries(row.values)) target.values[id] = (target.values[id] || 0) + v;
    out.set(unit, target);
  }
  return out;
}

function oneRow(unit, values, rowNumber) {
  return new Map([[unit, { values, rowNumber }]]);
}

/** Порівнює клітинки двох сіток; ids обмежує показники, source додає адресу очікуваної клітинки в іншому аркуші. */
function diffGrids(actual, expected, { ids = null, letters = {}, source = null } = {}) {
  const diffs = [];
  let compared = 0;
  for (const unit of new Set([...actual.keys(), ...expected.keys()])) {
    const a = actual.get(unit), e = expected.get(unit);
    const av = a?.values || {}, ev = e?.values || {};
    for (const id of new Set([...Object.keys(av), ...Object.keys(ev)])) {
      if (ids && !ids.has(id)) continue;
      compared++;
      const x = av[id] || 0, y = ev[id] || 0;
      if (same(x, y)) continue;
      const diff = { unit, id, ...metricParts(id), cell: a?.rowNumber && letters[id] ? `${letters[id]}${a.rowNumber}` : '', actual: x, expected: y, delta: x - y };
      if (source && e?.rowNumber && source.letters[id]) diff.source = `'${source.sheet}'!${source.letters[id]}${e.rowNumber}`;
      diffs.push(diff);
    }
  }
  diffs.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
  return { diffs, compared };
}

/* ------------------------------ модель аркушів ------------------------------ */

function sheetModels(workbook) {
  const bySheet = new Map();
  for (const block of workbook?.blocks || []) {
    if (!bySheet.has(block.sheet)) bySheet.set(block.sheet, []);
    bySheet.get(block.sheet).push(block);
  }
  const records = new Map();
  for (const r of workbook?.records || []) {
    const key = clean(r.sheet); // у назвах аркушів трапляються пробіли в кінці («ТРАВЕНЬ-26 »)
    if (!records.has(key)) records.set(key, []);
    records.get(key).push(r);
  }
  const models = (workbook?.sheets || []).map(sheet => {
    const blocks = bySheet.get(sheet.name) || [];
    const month = sheetMonth(sheet.name);
    const monthly = month ? blocks.find(b => b.kind === 'month' && b.period.from.slice(0, 7) === month) || null : null;
    const cumulative = blocks.find(b => b.kind === 'cumulative') || null;
    // Початок місяця — найближчий перед «ВСЬОГО» блок «ЗА …», що не є самим місяцем аркуша.
    const before = cumulative ? blocks.slice(0, blocks.indexOf(cumulative)) : [];
    const chain = before.reverse().find(b => (b.kind === 'month' || b.kind === 'range') && b !== monthly) || null;
    const letters = sheet.letters || {};
    return {
      name: sheet.name, month, letters, ids: new Set(Object.keys(letters)), records: records.get(sheet.name) || [],
      blocks, decades: blocks.filter(b => b.kind === 'decade'), monthly, chain, cumulative,
    };
  });
  // Хронологічно; аркуші з нерозпізнаною назвою — в кінці у своєму порядку.
  return models.map((m, i) => ({ m, i })).sort((p, q) => (p.m.month && q.m.month ? (p.m.month < q.m.month ? -1 : p.m.month > q.m.month ? 1 : p.i - q.i) : p.m.month ? -1 : q.m.month ? 1 : p.i - q.i)).map(x => x.m);
}

/* ------------------------------ звірка ------------------------------ */

/**
 * Усі порівняння підсумкових блоків: { checks, problems, skipped, mismatched, compared, differences }.
 * check: { id, sheet, kind, what, rule, compared, diffs, hint, status: 'ok' | 'diff' }.
 */
const cache = new WeakMap();
export function reconcileWorkbook(workbook) {
  if (workbook && typeof workbook === 'object' && cache.has(workbook)) return cache.get(workbook);
  const result = compute(workbook);
  if (workbook && typeof workbook === 'object') cache.set(workbook, result);
  return result;
}

function compute(workbook) {
  const sheets = sheetModels(workbook);
  const byMonth = new Map(sheets.filter(s => s.month).map(s => [s.month, s]));
  const checks = [];
  const skipped = [];

  const push = (sheet, kind, block, what, outcome, extra = {}) => {
    const diffs = outcome.diffs || [];
    const status = diffs.length || extra.broken ? 'diff' : 'ok';
    checks.push({ id: `${sheet.name}|${kind}|${block.label}`, sheet: sheet.name, kind, block: block.label, what, rule: RULES[kind], compared: outcome.compared || 0, diffs, hint: extra.hint || '', status });
  };

  for (const sheet of sheets) {
    const { letters } = sheet;
    const options = { ids: sheet.ids.size ? sheet.ids : null, letters };

    // 1. Декади й місяць проти денних рядків.
    for (const block of [...sheet.decades, ...(sheet.monthly ? [sheet.monthly] : [])]) {
      if (!hasValues(block)) { skipped.push({ sheet: sheet.name, block: block.label, reason: 'у блоці немає збережених значень' }); continue; }
      const inside = sheet.records.filter(r => r.date >= block.period.from && r.date <= block.period.to);
      const what = block.kind === 'decade' ? `Декада «${block.label}» і денні рядки` : `«${block.label}» і денні рядки місяця`;
      push(sheet, 'period', block, what, diffGrids(gridOfBlock(block), gridOfRecords(inside), options));
    }

    // 2. Початок місяця проти «ВСЬОГО» попереднього аркуша.
    const previous = sheet.month ? byMonth.get(previousMonth(sheet.month)) : null;
    if (sheet.chain && hasValues(sheet.chain) && previous?.cumulative && hasValues(previous.cumulative)) {
      const shared = new Set([...sheet.ids].filter(id => previous.ids.has(id)));
      const outcome = diffGrids(gridOfBlock(sheet.chain), gridOfBlock(previous.cumulative), { ids: shared, letters, source: { sheet: previous.name, letters: previous.letters } });
      push(sheet, 'opening', sheet.chain, `Початок місяця «${sheet.chain.label}» і «${previous.cumulative.label}» аркуша «${previous.name}»`, outcome, { hint: staleHint(outcome.diffs, previous) });
    }

    // 3. Підпис початку місяця: має закінчуватися попереднім місяцем.
    if (sheet.chain && previous) {
      const expected = previousMonth(sheet.month);
      const last = sheet.chain.period.to.slice(0, 7);
      const broken = last !== expected;
      push(sheet, 'label', sheet.chain, `Підпис «${sheet.chain.label}» і попередній аркуш «${previous.name}»`, { compared: 1, diffs: [] }, {
        broken,
        hint: broken ? `Блок підписано «${sheet.chain.label}» (останній місяць — ${monthTitle(last) || 'не розпізнано'}), а попередній аркуш — ${monthTitle(expected)}.` : '',
      });
    }

    // 4. «ВСЬОГО» = початок місяця + місяць.
    if (sheet.cumulative && sheet.chain && sheet.monthly && [sheet.cumulative, sheet.chain, sheet.monthly].every(hasValues)) {
      const expected = sumGrids(gridOfBlock(sheet.chain), gridOfBlock(sheet.monthly));
      push(sheet, 'closing', sheet.cumulative, `«${sheet.cumulative.label}» і початок місяця + «${sheet.monthly.label}»`, diffGrids(gridOfBlock(sheet.cumulative), expected, options));
    }

    // 5. Підсумкові рядки проти суми підрозділів блоку.
    for (const block of sheet.blocks) {
      if (!block.total || block.kind === 'other' || !hasValues(block)) continue;
      const expected = sumGrids(...block.rows.map(r => new Map([['Разом', { values: r.values }]])));
      const outcome = diffGrids(oneRow('Разом', block.total.values, block.total.rowNumber), expected, options);
      push(sheet, 'total', block, `Рядок «${block.total.label}» і сума підрозділів у блоці «${block.label}»`, outcome);
    }
  }

  // Спершу порівняння з підказкою (скопійований і не оновлений блок, застарілий підпис), далі — з найбільшою кількістю розбіжностей.
  const problems = checks.map((check, i) => ({ check, i })).filter(x => x.check.status === 'diff')
    .sort((p, q) => (!!q.check.hint - !!p.check.hint) || (q.check.diffs.length - p.check.diffs.length) || p.i - q.i)
    .map(x => x.check);
  return {
    checks, problems, skipped,
    mismatched: problems.length,
    compared: checks.reduce((s, c) => s + c.compared, 0),
    differences: checks.reduce((s, c) => s + c.diffs.length, 0),
  };
}

/**
 * Блок «початок місяця» скопійовано з попереднього аркуша й не оновлено: більшість розбіжних клітинок досі дорівнює
 * початку місяця попереднього аркуша, тож його підсумок за місяць у блоці не враховано.
 */
function staleHint(diffs, previous) {
  if (!previous.chain || diffs.length < 3) return '';
  const old = gridOfBlock(previous.chain);
  const stale = diffs.filter(d => same(d.actual, old.get(d.unit)?.values?.[d.id] || 0)).length;
  if (stale < 3 || stale / diffs.length < 0.8) return '';
  return `Схоже, блок не оновлено після копіювання аркуша: ${stale} із ${diffs.length} розбіжних клітинок досі дорівнюють початку місяця на аркуші «${previous.name}», тож підсумок аркуша «${previous.name}» у цьому блоці не враховано. Переведіть посилання блоку на «${previous.cumulative.label}» аркуша «${previous.name}».`;
}

/** Рядки для CSV-вивантаження всіх розбіжностей. */
export function reconcileCsvRows(result) {
  const rows = [['Аркуш', 'Порівняння', 'Клітинка', 'Підрозділ', 'Показник', 'У таблиці', 'Має бути', 'Різниця', 'Звідки має бути']];
  for (const check of result.checks) {
    if (check.status !== 'diff') continue;
    if (!check.diffs.length) rows.push([check.sheet, check.what, '', '', '', '', '', '', check.hint]);
    for (const d of check.diffs) rows.push([check.sheet, check.what, d.cell, d.unit, `${d.group}: ${d.metric}`, d.actual, d.expected, d.delta, d.source || '']);
  }
  return rows;
}
