import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  coverage,
  createDashboardModel,
  groupIssues,
  percentageAffected,
  searchJournal,
  validateWorkbook,
} from '../src/pvk-dashboard-core.js';

const baseTable = async () => new Uint8Array(
  await readFile(new URL('../src-tauri/resources/base-tables/pvk-base.xlsx', import.meta.url)),
);

async function airCore() {
  const html = await readFile(new URL('../src/air.html', import.meta.url), 'utf8');
  const marker = html.indexOf('CORE — робота з .xlsx');
  assert.notEqual(marker, -1, 'air.html: CORE script must exist');
  const start = html.lastIndexOf('<script>', marker);
  const end = html.indexOf('</script>', marker);
  const module = { exports: {} };
  vm.runInNewContext(html.slice(start + '<script>'.length, end), {
    module, TextEncoder, TextDecoder, DecompressionStream, CompressionStream,
    Blob, Response, Uint8Array, ArrayBuffer,
  }, { filename: 'air-core.js', timeout: 5000 });
  return module.exports;
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function column(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

function rowXml(number, values) {
  const cells = values.map((value, index) => {
    if (value == null) return '';
    const reference = `${column(index)}${number}`;
    return typeof value === 'number'
      ? `<c r="${reference}" t="n"><v>${value}</v></c>`
      : `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }).join('');
  return `<row r="${number}">${cells}</row>`;
}

function sheetXml(headers, values) {
  return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + rowXml(1, headers)
    + rowXml(2, values)
    + '<row r="3"/>'
    + rowXml(4, ['Підсумок', ...headers.slice(1).map(() => 999)])
    + '</sheetData></worksheet>';
}

// CORE runs in its own context; compare its arrays and objects as plain data.
const plain = value => JSON.parse(JSON.stringify(value));

const JOURNAL_HEADERS = ['№ з/п', 'Дата', 'Час удару', 'Номер цілі', 'Характер цілі', 'Координати цілі',
  'Населений пункт', 'Фактичні приходи', 'Сили та засоби', 'Тип АЗУ', 'Витрата АЗУ', 'Результат'];

// «Таблиця 1» as a user fills it: a month row, Excel date serials and time fractions, a text date.
function journalXml() {
  return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + rowXml(1, JOURNAL_HEADERS)
    + rowXml(2, ['ЖОВТЕНЬ'])
    + rowXml(3, [1, 46296, 0.4270833333, 'SYN-1', 'ПУ БпЛА', '37U CQ 00000 00000', 'Тестове', 2, 'Су-25', 'GBU-39', 2, 'Уражено'])
    + rowXml(4, [2, 46296, 0.5, 'SYN-2', 'Склад БК', null, 'Тестове', 8, 'Mi-24', 'С-8 ком', 10, 'НЕ уражено'])
    + rowXml(5, [3, '02.10.2026', '06:30', 'SYN-1', 'ПУ БпЛА', null, null, 6, 'Mi-8', 'C-13', 6, 'Уражено'])
    + rowXml(6, [4, null, null, 'SYN-3', 'СП', null, null, 1, 'F-16', 'AGM-88', 1, 'Дорозвідується'])
    + rowXml(7, [5])
    + '</sheetData></worksheet>';
}

async function syntheticWorkbook(core, sheets) {
  const encoder = new TextEncoder();
  const escapeName = name => name.replaceAll("'", '&apos;');
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((sheet, index) => `<sheet name="${escapeName(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')
      + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
      + '</Relationships>',
  };
  sheets.forEach((sheet, index) => { entries[`xl/worksheets/sheet${index + 1}.xml`] = sheet.xml; });
  return core.writeZip(Object.entries(entries).map(([name, content]) => ({
    name,
    nameBytes: encoder.encode(name),
    flags: 0x0800,
    time: 0,
    date: 0,
    newData: encoder.encode(content),
  })));
}

function syntheticPvkWorkbook(core, { journal = false } = {}) {
  return syntheticWorkbook(core, [
    ...(journal ? [{ name: 'Таблиця 1', xml: journalXml() }] : []),
    { name: 'АА', xml: sheetXml(['Дата', 'АУ ', 'Mi-8', 'Уражено', 'НЕ уражено'], ['01.01.2026', 1, 1, 1, 0]) },
    { name: 'ПС', xml: sheetXml(['Дата', 'АУ ', 'F-16', 'Уражено', 'НЕ уражено', 'Дорозвідується'], ['01.01.2026', 2, 2, 1, 1, 0]) },
    { name: "Об'єкти", xml: sheetXml(['Дата', 'ЖС ВЗ', 'Витрата'], ['01.01.2026', 3, 7]) },
  ]);
}

test('reads a synthetic three-sheet ПВК workbook and ignores empty and total rows', async () => {
  const core = await airCore();
  const workbook = await core.openPvkWorkbook(await syntheticPvkWorkbook(core));

  assert.equal(workbook.kind, 'pvk');
  assert.equal(workbook.readOnly, true);
  assert.deepEqual(Array.from(workbook.sheets, sheet => sheet.name), ['АА', 'ПС', "Об'єкти"]);
  assert.equal(workbook.sheets.every(sheet => sheet.rows.length === 1), true);
  assert.equal(workbook.sheets[0].headers[1], 'АУ');
  assert.equal(workbook.sheets[0].rows[0].date, '2026-01-01');
  assert.equal(workbook.sheets[0].rows[0].values['НЕ уражено'], 0);

  const model = createDashboardModel(workbook);
  assert.equal(model.summary.totalAu, 3);
  assert.equal(model.summary.objects, 3);
  assert.equal(model.summary.expenditure, 7);
  // Ряди по днях для міні-графіків карток зведення: сума АА і ПС, «Дорозвідується» лише з ПС.
  assert.deepEqual(model.summary.dynamics.affected, [{ date: '2026-01-01', value: 2 }]);
  assert.deepEqual(model.summary.dynamics.reconnaissance, [{ date: '2026-01-01', value: 0 }]);
  assert.deepEqual(model.summary.dynamics.au, [{ date: '2026-01-01', value: 3 }]);
  assert.equal(model.sheets.find(sheet => sheet.name === 'АА').affectedSeries[0].value, 100);
  assert.equal(model.sheets.find(sheet => sheet.name === 'ПС').affectedSeries[0].value, 50);
});

test('completeness: every base-table metric has exactly one dashboard widget', async () => {
  const core = await airCore();
  const workbook = await core.openPvkWorkbook(await baseTable());
  const expected = new Set(workbook.sheets.flatMap(sheet =>
    sheet.headers.filter(header => header !== 'Дата').map(header => `${sheet.name}:${header}`)
  ));
  const model = createDashboardModel(workbook);
  const actual = coverage(model);

  assert.equal(expected.size, 57);
  assert.equal(actual.size, 57);
  assert.deepEqual([...actual].sort(), [...expected].sort());
  assert.equal(model.widgets.every(widget => widget.known), true);
});

test('a new column appears in the visible «Інші показники» group', () => {
  const workbook = {
    kind: 'pvk',
    sheets: [{
      name: 'АА',
      headers: ['Дата', 'АУ', 'Тестовий новий показник'],
      rows: [{
        rowNumber: 2,
        date: '2026-01-01',
        values: { АУ: 0, 'Тестовий новий показник': 0 },
        raw: { АУ: '0', 'Тестовий новий показник': '0' },
        issues: [],
      }],
    }],
  };
  const model = createDashboardModel(workbook);
  const widget = model.widgets.find(item => item.metric === 'Тестовий новий показник');

  assert.equal(widget.group, 'Інші показники');
  assert.equal(widget.known, false);
  assert.equal(widget.total, 0);
  assert.match(widget.marker, /новий стовпець/);
});

test('data validation catches synthetic content, sign, date, duplicate and gap errors', () => {
  const workbook = {
    sheets: [{
      name: 'АА',
      headers: ['Дата', 'АУ', 'Mi-8'],
      rows: [
        { rowNumber: 2, date: '2026-01-01', values: { АУ: 1, 'Mi-8': 0 }, issues: [{ type: 'negative', metric: 'Mi-8', raw: '-1' }] },
        { rowNumber: 3, date: '2026-01-01', values: { АУ: 1, 'Mi-8': 1 }, issues: [{ type: 'text-in-numeric', metric: 'АУ', raw: 'текст' }] },
        { rowNumber: 4, date: '2026-01-03', values: { АУ: 0, 'Mi-8': null }, issues: [{ type: 'missing-value', metric: 'Mi-8', raw: '' }] },
        { rowNumber: 5, date: '', values: { АУ: 1, 'Mi-8': 1 }, issues: [{ type: 'invalid-date', raw: '32.01.2026' }, { type: 'number-without-date' }] },
      ],
    }],
  };
  const types = new Set(validateWorkbook(workbook, { from: '2026-01-01', to: '2026-01-03' }).map(item => item.type));

  for (const type of ['negative', 'text-in-numeric', 'missing-value', 'invalid-date', 'number-without-date', 'duplicate-date', 'missing-date', 'au-assets-mismatch']) {
    assert.equal(types.has(type), true, `expected validation issue ${type}`);
  }
});

test('% уражених uses the documented formula and handles a zero denominator', () => {
  assert.equal(percentageAffected(3, 1), 75);
  assert.equal(percentageAffected(0, 0), null);
});

test('data check groups identical messages instead of listing every empty cell', async () => {
  // 40 days from 01.01.2026 without 11–13 January.
  const rows = Array.from({ length: 40 }, (_, index) => index)
    .filter(index => index < 10 || index > 12)
    .map((index, position) => ({
      rowNumber: position + 2,
      date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      values: { АУ: 1, 'Mi-8': null },
      issues: [{ type: 'missing-value', metric: 'Mi-8', raw: '' }],
    }));
  rows[3].issues.push({ type: 'text-in-numeric', metric: 'АУ', raw: 'два' });
  const issues = validateWorkbook({ sheets: [{ name: 'АА', headers: ['Дата', 'АУ', 'Mi-8'], rows }] }, { from: '2026-01-01', to: '2026-02-09' });
  const groups = groupIssues(issues);

  assert.equal(groups[0].level, 'error', 'errors come first');
  assert.equal(groups[0].title, 'Текст у числовому стовпці «АУ»');
  assert.deepEqual(groups[0].details, ['рядок 5: «два»']);
  const missing = groups.find(group => group.type === 'missing-value');
  assert.equal(missing.count, 37);
  assert.equal(missing.details.length, 12);
  assert.equal(missing.more, 25);
  assert.match(missing.hint, /впишіть 0/);
  const gaps = groups.find(group => group.type === 'missing-date');
  assert.deepEqual(gaps.details, ['11.01.2026–13.01.2026'], 'consecutive missing days collapse into a range');
  assert.ok(groups.length < 10);
});

/* A tiny DOM, strict like the browser where it matters: SVG className is read-only and
   append() takes nodes, not arrays. */
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
        if (node == null || typeof node !== "object" || !node.nodeType) throw new TypeError(`append() got ${Array.isArray(node) ? "an array" : String(node)}`);
        this.children.push(node);
      }
    }
    set textContent(value) { this.children = value === '' ? [] : [{ nodeType: 3, text: String(value) }]; }
    get textContent() { return this.children.map(node => node.nodeType === 3 ? node.text : node.textContent).join(''); }
    querySelector(selector) {
      const id = /#([\w-]+)$/.exec(selector)?.[1];
      return this.children.find(node => node.attributes?.id === id) || null;
    }
    all() { return [this, ...this.children.flatMap(node => node.all ? node.all() : [])]; }
  }
  return {
    Node,
    createElement: tag => new Node(tag, false),
    createElementNS: (ns, tag) => new Node(tag, true),
    createTextNode: text => ({ nodeType: 3, text }),
  };
}

test('the dashboard renders every page of a table with data', async () => {
  const core = await airCore();
  const workbook = await core.openPvkWorkbook(await syntheticPvkWorkbook(core, { journal: true }));
  const document = fakeDocument();
  Object.assign(globalThis, { window: globalThis, document });
  const dashboard = await import('../src/pvk-dashboard.js');
  const host = document.createElement('section');
  dashboard.render(host, workbook, { downloadCSV: () => {} });
  const root = host.children[0];
  assert.match(root.textContent, /Дашборд ПВК/);
  assert.ok(root.all().some(node => node.tagName === 'svg'), 'charts are drawn for a table with data');
  const days = root.all().filter(node => /\bpvk-day\b/.test(node.attributes?.class || ''));
  assert.ok(days.length, 'the activity calendar has days');
  assert.ok(days.every(node => node.style['--level'] !== undefined && node.style['grid-column']), 'each day carries its colour level and column');
  assert.ok(days.some(node => node.style['--level'] === '1'), 'the busiest day is fully coloured');

  const buttons = () => root.all().filter(node => node.tagName === 'button');
  for (const view of ['Таблиця 1', 'АА', 'ПС', 'Об’єкти', 'Зведена таблиця', 'Перевірка даних', 'Зведення ПВК']) {
    buttons().find(node => node.textContent === view).listeners.click();
    assert.ok(root.textContent.length > 100, view);
  }
  const base = document.createElement('section');
  dashboard.renderBase(base, workbook);
  assert.equal(base.all().filter(node => node.tagName === 'table').length, 4, 'the journal and three sheets');

  // «Мій дашборд» — лише в застосунку (є Tauri): порожня сторінка-гніздо, куди каталог переносить особисті модулі.
  assert.equal(buttons().some(node => node.textContent === 'Мій дашборд'), false, 'no personal tab without the desktop app');
  globalThis.__TAURI_INTERNALS__ = { invoke: async () => null };
  try {
    dashboard.render(host, workbook, { downloadCSV: () => {} });
    buttons().find(node => node.textContent === 'Мій дашборд').listeners.click();
    const slot = root.all().find(node => node.attributes && 'data-ewmc-slot' in node.attributes);
    assert.ok(slot, 'the personal tab renders the slot for the module catalog');
    assert.equal(root.all().some(node => /\bpvk-period\b/.test(node.attributes?.class || '')), false, 'the period bar belongs to the table, not to the personal tab');
  } finally {
    delete globalThis.__TAURI_INTERNALS__;
  }
});

test('«Таблиця 1» is read from the ПВК table: month rows skipped, Excel dates and times understood', async () => {
  const core = await airCore();
  const workbook = await core.openPvkWorkbook(await syntheticPvkWorkbook(core, { journal: true }));
  const journal = workbook.journal;

  assert.equal(journal.name, 'Таблиця 1');
  assert.deepEqual(plain(journal.headers), JOURNAL_HEADERS);
  assert.deepEqual(plain(journal.rows.map(row => [row.rowNumber, row.date, row.time])), [
    [3, '2026-10-01', '10:15'], [4, '2026-10-01', '12:00'], [5, '2026-10-02', '06:30'], [6, '', ''],
  ], 'the month row and a row with only a number are not records');
  assert.deepEqual(plain(journal.rows[3].issues), [{ type: 'no-date' }]);
  assert.deepEqual([journal.rows[0].values['Дата'], journal.rows[0].values['Час удару']], ['01.10.2026', '10:15'],
    'records, search and CSV show the date and time as in the report, not as Excel numbers');
  assert.equal(journal.rows[0].dateRaw, '46296', 'the raw cell stays for data-check messages');
  assert.equal(workbook.sheets.length, 3);
  assert.match(workbook.sheetName, /^Таблиця 1 \/ АА/);
});

test('a file holding only «Таблиця 1» opens as a ПВК table', async () => {
  const core = await airCore();
  const workbook = await core.openPvkWorkbook(await syntheticWorkbook(core, [{ name: 'Аркуш1', xml: journalXml() }]));
  assert.equal(workbook.kind, 'pvk');
  assert.equal(workbook.sheets.length, 0);
  assert.equal(workbook.journal.rows.length, 4);
  await assert.rejects(core.openPvkWorkbook(await syntheticWorkbook(core, [{ name: 'Аркуш1', xml: sheetXml(['Дата', 'Щось'], ['01.01.2026', 1]) }])), /не таблиця ПВК/);
});

test('every column of «Таблиця 1» gets its own block on the dashboard', async () => {
  const core = await airCore();
  const workbook = await core.openPvkWorkbook(await syntheticPvkWorkbook(core, { journal: true }));
  const model = createDashboardModel(workbook, { from: '2026-10-01', to: '2026-10-02' });
  const journal = model.journal;

  assert.deepEqual(plain(journal.widgets), JOURNAL_HEADERS.map(header => `Таблиця 1:${header}`));
  assert.deepEqual(plain(Object.fromEntries(journal.columns.map(column => [column.header, column.kind]))), {
    '№ з/п': 'index', Дата: 'date', 'Час удару': 'time', 'Номер цілі': 'target', 'Характер цілі': 'category',
    'Координати цілі': 'coords', 'Населений пункт': 'category', 'Фактичні приходи': 'numeric',
    'Сили та засоби': 'category', 'Тип АЗУ': 'category', 'Витрата АЗУ': 'numeric', Результат: 'category',
  });
  assert.equal(journal.total, 3, 'the undated row stays out of the period');
  assert.equal(journal.days, 2);
  assert.equal(journal.targets, 2);
  assert.deepEqual(plain(journal.columns.find(column => column.kind === 'target').repeated), [{ value: 'SYN-1', count: 2 }]);
  assert.equal(journal.hours[10] + journal.hours[12] + journal.hours[6], 3);
  assert.deepEqual(plain(journal.confirmed), { reported: 18, counted: 16, percent: 16 / 18 * 100 });
  assert.deepEqual(plain(searchJournal(journal, 'склад').map(row => row.rowNumber)), [4]);
  assert.equal(searchJournal(journal, '')[0].rowNumber, 5, 'newest first');
  const groups = groupIssues(model.issues);
  assert.ok(groups.some(group => group.sheet === 'Таблиця 1' && group.type === 'no-date'));
});

test('the ПВК base table fills ТАБЛ 2-3 from «Таблиця 1» with formulas', async () => {
  const core = await airCore();
  const entries = core.readZip(await baseTable());
  const xml = async name => new TextDecoder().decode(await core.entryBytes(entries.find(entry => entry.name === name)));
  const sheetFiles = [...(await xml('xl/workbook.xml')).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(match => match[1].replaceAll('&apos;', "'"));
  assert.deepEqual(sheetFiles, ['Таблиця 1', 'АА', 'ПС', "Об'єкти"]);
  const formula = (sheetXml, ref) => {
    const cell = new RegExp(`<c r="${ref}"[^>]*>\\s*<f>([^<]*)</f>`).exec(sheetXml);
    return cell ? cell[1].replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&') : '';
  };
  const aa = await xml('xl/worksheets/sheet2.xml');
  assert.match(formula(aa, 'A2'), /MIN\('Таблиця 1'!\$B:\$B\)/, 'days start at the first journal date');
  assert.match(formula(aa, 'A3'), /A2\+1>MAX\('Таблиця 1'!\$B:\$B\)/);
  assert.match(formula(aa, 'C2'), /COUNTIFS\('Таблиця 1'!\$B:\$B,\$A2,'Таблиця 1'!\$I:\$I,"Mi-8"\)/, 'Mi-8 counts its strikes');
  assert.match(formula(aa, 'E2'), /SUMIFS\('Таблиця 1'!\$K:\$K,.*"Mi-8",'Таблиця 1'!\$J:\$J,"ARS-8"\)\+SUMIFS\(.*"Mi-24"/, 'munitions of the helicopters only');
  const objects = await xml('xl/worksheets/sheet4.xml');
  assert.match(formula(objects, 'B2'), /'Таблиця 1'!\$E:\$E,"ЖС ВЗ",'Таблиця 1'!\$L:\$L,"Уражено"/);
  const journal = await xml('xl/worksheets/sheet1.xml');
  for (const list of ['Mi-8,Mi-24,Mirage', 'Уражено,НЕ уражено,Дорозвідується', 'GBU-39']) assert.ok(journal.includes(list), list);
});

test('the data check flags journal rows the ТАБЛ 2-3 formulas cannot count', async () => {
  const core = await airCore();
  const base = await core.openPvkWorkbook(await baseTable());
  const row = (rowNumber, values) => ({ rowNumber, date: '2026-10-01', time: '', values, issues: [] });
  const strike = { 'Сили та засоби': 'Су-25', 'Тип АЗУ': 'GBU-39', 'Характер цілі': 'ПУ БпЛА', Результат: 'Уражено' };
  const journal = {
    name: 'Таблиця 1',
    headers: JOURNAL_HEADERS,
    rows: [
      row(2, strike),
      row(3, { ...strike, 'Сили та засоби': 'Mirage', 'Тип АЗУ': 'ARS-8' }),
      row(4, { ...strike, 'Сили та засоби': 'Ка-52' }),
      row(5, { ...strike, 'Характер цілі': 'Щось інше', Результат: 'знищено' }),
    ],
  };
  const issues = validateWorkbook({ sheets: base.sheets, journal }, { from: '2026-10-01', to: '2026-10-01' })
    .filter(item => item.sheet === 'Таблиця 1');
  assert.deepEqual(plain(issues.map(item => [item.row, item.type])), [
    [3, 'munition-not-on-sheet'], [4, 'unknown-carrier'], [5, 'unknown-category'], [5, 'unknown-result'],
  ]);
  const groups = groupIssues(issues);
  assert.equal(groups.find(group => group.type === 'munition-not-on-sheet').details[0], 'рядок 3: «ARS-8 · Mirage»');
});
