import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  coverage,
  createDashboardModel,
  percentageAffected,
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

async function syntheticPvkWorkbook(core) {
  const encoder = new TextEncoder();
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="АА" sheetId="1" r:id="rId1"/><sheet name="ПС" sheetId="2" r:id="rId2"/><sheet name="Об&apos;єкти" sheetId="3" r:id="rId3"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml(['Дата', 'АУ ', 'Mi-8', 'Уражено', 'НЕ уражено'], ['01.01.2026', 1, 1, 1, 0]),
    'xl/worksheets/sheet2.xml': sheetXml(['Дата', 'АУ ', 'F-16', 'Уражено', 'НЕ уражено', 'Дорозвідується'], ['01.01.2026', 2, 2, 1, 1, 0]),
    'xl/worksheets/sheet3.xml': sheetXml(['Дата', 'ЖС ВЗ', 'Витрата'], ['01.01.2026', 3, 7]),
  };
  return core.writeZip(Object.entries(entries).map(([name, content]) => ({
    name,
    nameBytes: encoder.encode(name),
    flags: 0x0800,
    time: 0,
    date: 0,
    newData: encoder.encode(content),
  })));
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
