import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBlockLabel, parseUdshvWorkbook, sheetMonth } from '../src/udshv-dashboard-core.js';
import { reconcileCsvRows, reconcileWorkbook } from '../src/udshv-reconcile-core.js';

/* Синтетична книга УДШВ: три місяці поспіль із денними рядками й усіма підсумковими блоками аркуша
   (декади, місяць, початок місяця, «ВСЬОГО», «ЗАГАЛЬНА»). Підрозділи й числа вигадані. */
const HEAD = {
  A: '№ з/п', B: 'День тижня', C: 'Дата', D: 'Підрозділ', E: 'ВгЗ', F: 'КББ',
  G: 'Витрата боєприпасів', J: 'Втрати о/с', L: 'Втрати противника за категоріями', N: 'ЗНИЩЕНО', P: 'ПОШКОДЖЕНО', R: 'ПОДАВЛЕНО',
};
const SUB = { G: '155мм', H: '122мм', I: 'ВСЬОГО', J: '200', K: '300', L: 'артилерія', M: 'ІФС', N: 'танк', O: 'мотоцикл', P: 'танк', Q: 'КП, ПУ, КСП', R: 'танк', S: 'РЕБ' };
const COLS = ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'];
const UNITS = ['Підрозділ А', 'Підрозділ Б', 'Підрозділ В'];
const serial = iso => String(Date.parse(`${iso}T00:00:00Z`) / 864e5 + 25569);

const MONTHS = [
  { name: 'ЛИПЕНЬ-26', mm: '07', title: 'ЛИПЕНЬ', chainLabel: 'ЗА СІЧЕНЬ - ЧЕРВЕНЬ 2026' },
  { name: 'СЕРПЕНЬ-26', mm: '08', title: 'СЕРПЕНЬ', chainLabel: 'ЗА СІЧЕНЬ - ЛИПЕНЬ 2026' },
  { name: 'ВЕРЕСЕНЬ-26', mm: '09', title: 'ВЕРЕСЕНЬ', chainLabel: 'ЗА СІЧЕНЬ - СЕРПЕНЬ 2026' },
];
const DAYS = [1, 2, 11];

const emptyGrid = () => Object.fromEntries(UNITS.map(unit => [unit, Object.fromEntries(COLS.map(c => [c, 0]))]));
const addGrids = (...grids) => {
  const out = emptyGrid();
  for (const grid of grids) for (const unit of UNITS) for (const c of COLS) out[unit][c] += grid[unit][c];
  return out;
};
const gridTotal = grid => Object.fromEntries(COLS.map(c => [c, UNITS.reduce((s, unit) => s + grid[unit][c], 0)]));

// Дані дня: різні числа для кожного місяця, дня, підрозділу й показника; «ВСЬОГО» боєприпасів = 155мм + 122мм.
function dayGrid(monthIndex, day) {
  const grid = emptyGrid();
  UNITS.forEach((unit, u) => {
    COLS.forEach((c, k) => { grid[unit][c] = (monthIndex * 3 + day + u * 2 + k) % 5; });
    grid[unit].I = grid[unit].G + grid[unit].H;
  });
  return grid;
}

// Початкові залишки до першого аркуша (вписані числами): «ЗА СІЧЕНЬ - ЧЕРВЕНЬ».
const HISTORY = (() => {
  const grid = emptyGrid();
  UNITS.forEach((unit, u) => { COLS.forEach((c, k) => { grid[unit][c] = 10 + u + k; }); grid[unit].I = grid[unit].G + grid[unit].H; });
  return grid;
})();

const cellsOf = (unit, values) => ({ D: unit, ...Object.fromEntries(COLS.map(c => [c, String(values[c])])) });

/** Будує аркуш; chain — сітка початку місяця, label — її підпис. Повертає аркуш і підсумок «ВСЬОГО» для наступного. */
function buildSheet(index, chain, chainLabel) {
  const spec = MONTHS[index];
  const rows = [{ r: 1, cells: { A: 'Втрати о/с та ОВТ противника за угруповання ДШВ' } }, { r: 2, cells: HEAD }, { r: 3, cells: SUB }];
  let r = 5;
  const days = DAYS.map(day => ({ day, grid: dayGrid(index, day) }));
  for (const { day, grid } of days) {
    UNITS.forEach((unit, i) => {
      const cells = { A: String(i + 1), ...cellsOf(unit, grid[unit]) };
      if (i === 0) { cells.B = 'СУБОТА'; cells.C = serial(`2026-${spec.mm}-${String(day).padStart(2, '0')}`); }
      rows.push({ r: r++, cells });
    });
    r += 1;
  }
  const block = (label, grid, totalLabel) => {
    UNITS.forEach((unit, i) => {
      const cells = { A: String(i + 1), ...cellsOf(unit, grid[unit]) };
      if (i === 0) cells.B = label;
      rows.push({ r: r++, cells });
    });
    if (totalLabel) { const t = gridTotal(grid); rows.push({ r: r++, cells: { B: totalLabel, ...Object.fromEntries(COLS.map(c => [c, String(t[c])])) } }); }
    r += 1;
  };
  const upTo = max => addGrids(emptyGrid(), ...days.filter(d => d.day <= max).map(d => d.grid));
  const month = addGrids(emptyGrid(), ...days.map(d => d.grid));
  block(`01-10.${spec.mm}.26`, upTo(10));
  block(`11-20.${spec.mm}.26`, addGrids(upTo(20), ...[upTo(10)].map(g => negate(g))));
  block(`21-31.${spec.mm}.26`, emptyGrid());
  block(`ЗА ${spec.title} 2026`, month);
  block(chainLabel, chain, 'ВСЬОГО');
  const cumulative = addGrids(chain, month);
  block('ВСЬОГО', cumulative, 'ЗАГАЛЬНА');
  return { sheet: { name: spec.name, rows }, month, cumulative };
}

function negate(grid) {
  const out = emptyGrid();
  for (const unit of UNITS) for (const c of COLS) out[unit][c] = -grid[unit][c];
  return out;
}

/** Книга з трьох місяців. staleLast — останній аркуш скопійовано з попереднього, початок місяця не оновлено. */
function build({ staleLast = false } = {}) {
  const built = [];
  let chain = HISTORY;
  MONTHS.forEach((spec, i) => {
    const last = i === MONTHS.length - 1;
    const useChain = staleLast && last ? built[i - 1].chain : chain;
    const label = staleLast && last ? MONTHS[i - 1].chainLabel : spec.chainLabel;
    const result = buildSheet(i, useChain, label);
    built.push({ ...result, chain: useChain });
    chain = result.cumulative;
  });
  return { sheets: built.map(b => b.sheet), months: built.map(b => b.month), cumulative: built.map(b => b.cumulative) };
}

const parse = sheets => parseUdshvWorkbook(sheets, 'synthetic.xlsx');
const sheetOf = (sheets, name) => sheets.find(s => s.name === name);
/** Перший рядок блоку за підписом у стовпці «День тижня»; наступні рядки блоку йдуть підряд. */
const blockRows = (sheet, label) => { const i = sheet.rows.findIndex(row => row.cells.B === label); return sheet.rows.slice(i, i + UNITS.length); };

test('розбір аркуша збирає підсумкові блоки, а денні записи лишаються тими самими', () => {
  const { sheets } = build();
  const wb = parse(sheets);
  assert.equal(wb.records.length, MONTHS.length * DAYS.length * UNITS.length);
  const july = wb.blocks.filter(b => b.sheet === 'ЛИПЕНЬ-26');
  assert.deepEqual(july.map(b => b.kind), ['decade', 'decade', 'decade', 'month', 'range', 'cumulative']);
  assert.deepEqual(july.map(b => b.label), ['01-10.07.26', '11-20.07.26', '21-31.07.26', 'ЗА ЛИПЕНЬ 2026', 'ЗА СІЧЕНЬ - ЧЕРВЕНЬ 2026', 'ВСЬОГО']);
  assert.deepEqual(july[0].period, { from: '2026-07-01', to: '2026-07-10' });
  assert.deepEqual(july[4].period, { from: '2026-01-01', to: '2026-06-30' });
  assert.equal(july[4].total.label, 'ВСЬОГО', 'підписаний рядок без підрозділу — підсумок попереднього блоку');
  assert.equal(july[5].total.label, 'ЗАГАЛЬНА');
  assert.equal(july[3].total, null);
  assert.deepEqual(july[3].rows.map(row => row.unit), UNITS);
  assert.equal(wb.sheets[0].letters['personnel|200'], 'J');

  // Без підсумкових блоків записи ті самі, а блоків немає.
  const bare = sheets.map(s => ({ ...s, rows: s.rows.slice(0, s.rows.findIndex(row => /^01-10\./.test(row.cells.B || ''))) }));
  const without = parse(bare);
  assert.equal(without.blocks.length, 0);
  assert.deepEqual(without.records, wb.records);
});

test('підписи підсумкових блоків: декада, місяць, діапазон місяців, «ВСЬОГО»', () => {
  assert.deepEqual(classifyBlockLabel('01-10.05.26'), { kind: 'decade', period: { from: '2026-05-01', to: '2026-05-10' } });
  assert.deepEqual(classifyBlockLabel('21-31.09.26').period, { from: '2026-09-21', to: '2026-09-30' }, 'кінець декади обрізається за довжиною місяця');
  assert.deepEqual(classifyBlockLabel('ЗА ТРАВЕНЬ 2026'), { kind: 'month', period: { from: '2026-05-01', to: '2026-05-31' } });
  assert.deepEqual(classifyBlockLabel('ЗА ТРАВЕНЬ - СЕРПЕНЬ 2026'), { kind: 'range', period: { from: '2026-05-01', to: '2026-08-31' } });
  assert.deepEqual(classifyBlockLabel('за  травень–серпень 2026').kind, 'range');
  assert.equal(classifyBlockLabel('ВСЬОГО').kind, 'cumulative');
  assert.equal(classifyBlockLabel('УСЬОГО').kind, 'cumulative');
  assert.equal(classifyBlockLabel('Примітка').kind, 'other');
  assert.equal(classifyBlockLabel('ЗА СЕРПЕНЬ - ТРАВЕНЬ 2026').kind, 'other', 'кінець раніше початку — не діапазон');
  assert.equal(sheetMonth('ТРАВЕНЬ-26 '), '2026-05');
});

test('узгоджена книга: усі порівняння збігаються', () => {
  const wb = parse(build().sheets);
  const result = reconcileWorkbook(wb);
  assert.equal(result.mismatched, 0);
  assert.equal(result.differences, 0);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.skipped, []);
  const count = kind => result.checks.filter(c => c.kind === kind).length;
  assert.equal(count('period'), 4 * MONTHS.length, 'три декади й місяць на кожному аркуші');
  assert.equal(count('opening'), 2, 'початок місяця звіряється з попереднім аркушем, перший аркуш — початковий залишок');
  assert.equal(count('label'), 2);
  assert.equal(count('closing'), 3);
  assert.equal(count('total'), 2 * MONTHS.length, 'підсумкові рядки початку місяця і «ВСЬОГО» на кожному аркуші');
  assert.ok(result.compared > 100);
  assert.ok(result.checks.every(c => c.status === 'ok' && c.rule));
  assert.equal(reconcileWorkbook(wb), result, 'результат кешується для тієї самої книги');
  assert.deepEqual(reconcileCsvRows(result), [['Аркуш', 'Порівняння', 'Клітинка', 'Підрозділ', 'Показник', 'У таблиці', 'Має бути', 'Різниця', 'Звідки має бути']]);
});

test('початок місяця скопійовано з попереднього аркуша і не оновлено: видно, чого бракує', () => {
  const { sheets, months } = build({ staleLast: true });
  const result = reconcileWorkbook(parse(sheets));
  const opening = result.checks.find(c => c.sheet === 'ВЕРЕСЕНЬ-26' && c.kind === 'opening');
  assert.equal(opening.status, 'diff');
  // Бракує рівно підсумку серпня: різниця в кожній клітинці дорівнює мінус серпневому місяцю.
  const august = months[1];
  const expectedCount = UNITS.reduce((n, unit) => n + COLS.filter(c => august[unit][c] !== 0).length, 0);
  assert.equal(opening.diffs.length, expectedCount);
  for (const d of opening.diffs) {
    const column = d.cell.match(/^([A-Z]+)(\d+)$/);
    assert.ok(column, `адреса клітинки: ${d.cell}`);
    assert.equal(d.delta, -august[d.unit][column[1]]);
  }
  assert.match(opening.diffs[0].source, /^'СЕРПЕНЬ-26'![A-Z]+\d+$/, 'де має бути значення');
  assert.match(opening.hint, /не оновлено/);
  assert.match(opening.hint, /«СЕРПЕНЬ-26»/);
  // Підпис теж застарів: закінчується липнем, а попередній аркуш — серпень.
  const label = result.checks.find(c => c.sheet === 'ВЕРЕСЕНЬ-26' && c.kind === 'label');
  assert.equal(label.status, 'diff');
  assert.match(label.hint, /липень 2026/);
  assert.match(label.hint, /серпень 2026/);
  // «ВСЬОГО» = початок + місяць (формула), тож сам аркуш всередині узгоджений.
  assert.ok(result.checks.filter(c => c.sheet === 'ВЕРЕСЕНЬ-26' && ['closing', 'total', 'period'].includes(c.kind)).every(c => c.status === 'ok'));
  // Найважливіше — першим: порівняння з підказкою.
  assert.deepEqual(result.problems.map(c => c.kind), ['opening', 'label']);
  assert.equal(result.mismatched, 2);
  // CSV містить кожну розбіжність і адресу, звідки має бути значення.
  const csv = reconcileCsvRows(result);
  assert.equal(csv.length, 1 + opening.diffs.length + 1);
  assert.match(csv[1][8], /^'СЕРПЕНЬ-26'!/);
});

test('число вписано вручну в місячний підсумок, у «ВСЬОГО» чи в підсумковий рядок', () => {
  // Місячний блок: підсумок відрізняється від суми днів; «ВСЬОГО» (початок + місяць) теж не сходиться.
  const monthly = build();
  const monthlyCell = blockRows(sheetOf(monthly.sheets, 'СЕРПЕНЬ-26'), 'ЗА СЕРПЕНЬ 2026')[1];
  monthlyCell.cells.J = String(Number(monthlyCell.cells.J) + 7);
  let result = reconcileWorkbook(parse(monthly.sheets));
  const period = result.checks.find(c => c.sheet === 'СЕРПЕНЬ-26' && c.kind === 'period' && /ЗА СЕРПЕНЬ/.test(c.block));
  assert.deepEqual(period.diffs.map(d => [d.cell, d.unit, d.metric, d.delta]), [[`J${monthlyCell.r}`, 'Підрозділ Б', '200', 7]]);
  assert.equal(result.checks.find(c => c.sheet === 'СЕРПЕНЬ-26' && c.kind === 'closing').diffs[0].delta, -7);

  // «ВСЬОГО» вписано поверх формули: не сходиться з початком + місяць, а наступний аркуш бере інше число.
  const cumulative = build();
  const cumulativeCell = blockRows(sheetOf(cumulative.sheets, 'СЕРПЕНЬ-26'), 'ВСЬОГО')[2];
  cumulativeCell.cells.K = String(Number(cumulativeCell.cells.K) + 3);
  result = reconcileWorkbook(parse(cumulative.sheets));
  assert.deepEqual(result.checks.find(c => c.sheet === 'СЕРПЕНЬ-26' && c.kind === 'closing').diffs.map(d => d.delta), [3]);
  assert.deepEqual(result.checks.find(c => c.sheet === 'ВЕРЕСЕНЬ-26' && c.kind === 'opening').diffs.map(d => d.delta), [-3]);

  // Підсумковий рядок «ЗАГАЛЬНА» не дорівнює сумі підрозділів.
  const totals = build();
  const totalRow = sheetOf(totals.sheets, 'ВЕРЕСЕНЬ-26').rows.find(row => row.cells.B === 'ЗАГАЛЬНА');
  totalRow.cells.E = String(Number(totalRow.cells.E) - 4);
  result = reconcileWorkbook(parse(totals.sheets));
  const total = result.problems.find(c => c.kind === 'total');
  assert.equal(total.sheet, 'ВЕРЕСЕНЬ-26');
  assert.deepEqual(total.diffs.map(d => [d.cell, d.unit, d.delta]), [[`E${totalRow.r}`, 'Разом', -4]]);
});

test('підрозділ записано в блоці двома рядками: значення додаються, а не затирають одне одного', () => {
  const { sheets } = build();
  const sheet = sheetOf(sheets, 'СЕРПЕНЬ-26');
  const [first] = blockRows(sheet, 'ЗА СЕРПЕНЬ 2026');
  const column = COLS.find(c => Number(first.cells[c]) >= 1);
  first.cells[column] = String(Number(first.cells[column]) - 1);
  // Той самий підрозділ іще раз у рядку одразу під блоком: «ВСЬОГО» й місяць в Excel додають обидва рядки.
  sheet.rows.splice(sheet.rows.indexOf(first) + UNITS.length, 0, { r: first.r + UNITS.length, cells: { D: first.cells.D, [column]: '1' } });
  const wb = parse(sheets);
  assert.equal(wb.blocks.find(b => b.sheet === 'СЕРПЕНЬ-26' && b.label === 'ЗА СЕРПЕНЬ 2026').rows.length, UNITS.length + 1);
  const result = reconcileWorkbook(wb);
  assert.deepEqual(result.problems, []);
  assert.equal(result.mismatched, 0);
});

test('блоки без збережених значень пропускаються, а не вважаються нульовими', () => {
  const { sheets } = build();
  const month = blockRows(sheetOf(sheets, 'СЕРПЕНЬ-26'), 'ЗА СЕРПЕНЬ 2026');
  for (const row of month) for (const c of COLS) delete row.cells[c];
  const result = reconcileWorkbook(parse(sheets));
  assert.deepEqual(result.skipped, [{ sheet: 'СЕРПЕНЬ-26', block: 'ЗА СЕРПЕНЬ 2026', reason: 'у блоці немає збережених значень' }]);
  assert.ok(!result.checks.some(c => c.sheet === 'СЕРПЕНЬ-26' && /ЗА СЕРПЕНЬ/.test(c.block) && c.kind === 'period'));
  assert.ok(!result.checks.some(c => c.sheet === 'СЕРПЕНЬ-26' && c.kind === 'closing'), '«ВСЬОГО» без місяця звірити нічим');
});

test('книга без підсумкових блоків не дає ні порівнянь, ні помилок', () => {
  const { sheets } = build();
  const bare = sheets.map(s => ({ ...s, rows: s.rows.slice(0, s.rows.findIndex(row => /^01-10\./.test(row.cells.B || ''))) }));
  for (const wb of [parse(bare), { kind: 'udshv', sheets: [], records: [], units: [], issues: [] }, null, undefined]) {
    const result = reconcileWorkbook(wb);
    assert.deepEqual([result.checks.length, result.mismatched, result.differences], [0, 0, 0]);
  }
});

/* ------------------------------ сторінка дашборда ------------------------------ */

function fakeDocument() {
  class Node {
    constructor(tag, svg) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
      this.style = { setProperty(name, value) { this[name] = String(value); } };
      this.classList = { add: name => { this.attributes.class = `${this.attributes.class || ''} ${name}`.trim(); }, remove: () => {} };
      if (svg) Object.defineProperty(this, 'className', { get: () => ({ baseVal: this.attributes.class || '' }) });
    }
    get nodeType() { return 1; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    append(...nodes) {
      for (const node of nodes) {
        if (node == null || typeof node !== 'object' || !node.nodeType) throw new TypeError('append() got a non-node');
        this.children.push(node);
      }
    }
    set textContent(value) { this.children = value === '' ? [] : [{ nodeType: 3, text: String(value) }]; }
    get textContent() { return this.children.map(node => (node.nodeType === 3 ? node.text : node.textContent)).join(''); }
    querySelector(selector) { const id = /#([\w-]+)$/.exec(selector)?.[1]; return this.children.find(node => node.attributes?.id === id) || null; }
    all() { return [this, ...this.children.flatMap(node => (node.all ? node.all() : []))]; }
  }
  return { Node, createElement: tag => new Node(tag, false), createElementNS: (ns, tag) => new Node(tag, true), createTextNode: text => ({ nodeType: 3, text }), dispatchEvent() {}, addEventListener() {} };
}

test('дашборд: пункт «Звірка з підсумками» зі значком, підказка в шапці й сторінка з розбіжностями', async () => {
  const document = fakeDocument();
  Object.assign(globalThis, { window: globalThis, document, Event: class { constructor(type) { this.type = type; } } });
  const dashboard = await import('../src/udshv-dashboard.js');
  const open = workbook => {
    const host = document.createElement('section');
    dashboard.render(host, workbook, {});
    const root = host.children[0];
    return { host, root, buttons: () => root.all().filter(node => node.tagName === 'button') };
  };

  // Книга з розбіжностями.
  const broken = parse(build({ staleLast: true }).sheets);
  const bad = open(broken);
  const nav = bad.buttons().find(node => node.attributes['data-nav'] === 'reconcile');
  assert.match(nav.textContent, /^Звірка з підсумками2$/, 'у пункті меню — кількість порівнянь з розбіжностями');
  const hint = bad.buttons().find(node => /Підсумки таблиці розходяться: 2 з \d+ порівнянь/.test(node.textContent));
  assert.ok(hint, 'підказка в шапці');
  hint.listeners.click();
  const text = bad.root.textContent;
  assert.match(text, /Звірка з підсумковими блоками таблиці/);
  assert.match(text, /порівнянь \d+ · з розбіжностями 2/);
  assert.match(text, /ВЕРЕСЕНЬ-26 · Початок місяця/);
  assert.match(text, /ВЕРЕСЕНЬ-26 · Підпис початку/);
  assert.match(text, /Схоже, блок не оновлено/);
  assert.match(text, /'СЕРПЕНЬ-26'!/);
  assert.ok(bad.buttons().some(node => node.textContent === 'Вивантажити розбіжності (CSV)'));
  assert.ok(bad.root.all().some(node => node.tagName === 'details' && 'open' in node.attributes), 'перше порівняння розгорнуте');

  // Узгоджена книга: ні значка, ні підказки; на сторінці — що все збігається.
  const good = open(parse(build().sheets));
  assert.equal(good.buttons().find(node => node.attributes['data-nav'] === 'reconcile').textContent, 'Звірка з підсумками');
  assert.ok(!good.buttons().some(node => /Підсумки таблиці розходяться/.test(node.textContent)));
  good.buttons().find(node => node.attributes['data-nav'] === 'reconcile').listeners.click();
  assert.match(good.root.textContent, /усе збігається/);
  assert.match(good.root.textContent, /Підсумки в таблиці збігаються з денними рядками й між собою/);
  assert.ok(!good.buttons().some(node => node.textContent === 'Вивантажити розбіжності (CSV)'));
});
