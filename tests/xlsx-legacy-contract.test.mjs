import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const LEGACY_FIELDS = {
  num: '№',
  date: 'Дата',
  time: 'Час ураження',
  targets: '№ цілі (TS/KS)',
  unit: 'В інтересах',
  district: 'Район / н.п.',
  dpi: 'DPI / Координати MGRS',
  type: 'Тип цілі',
  month: 'Місяць',
  aircraft: 'Тип ЛА',
  munition: 'Тип боєприпасу',
  count: 'К-сть боєприпасів',
  result: 'Результат ураження',
  cause: 'Причина',
  note: 'Уточнення результату',
};

const SYNTHETIC_ROW = {
  num: '1',
  date: '01.01.2026',
  time: '10:15',
  targets: 'SYN-001',
  unit: 'Синтетичний підрозділ',
  district: 'Тестовий район',
  dpi: '',
  type: 'Навчальна ціль',
  month: 'Січень',
  aircraft: 'Навчальний ЛА',
  munition: 'Навчальний БП',
  count: '1',
  result: 'НЕВІДОМО',
  cause: '',
  note: 'Синтетичний запис',
};

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function column(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

function xmlRow(number, values) {
  const cells = values.map((value, index) =>
    `<c r="${column(index)}${number}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
  ).join('');
  return `<row r="${number}">${cells}</row>`;
}

async function legacyCore() {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const marker = html.indexOf('CORE — робота з .xlsx');
  assert.notEqual(marker, -1, 'legacy CORE script must exist');
  const start = html.lastIndexOf('<script>', marker);
  const end = html.indexOf('</script>', marker);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const module = { exports: {} };
  vm.runInNewContext(html.slice(start + '<script>'.length, end), {
    module, TextEncoder, TextDecoder,
  }, { filename: 'legacy-easywar-core.js', timeout: 5000 });
  return module.exports;
}

async function syntheticWorkbook(core) {
  const fields = Object.keys(LEGACY_FIELDS);
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRow(1, fields.map(key => LEGACY_FIELDS[key]))}${xmlRow(2, fields.map(key => SYNTHETIC_ROW[key]))}</sheetData></worksheet>`;
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Зведена" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  const encoder = new TextEncoder();
  return core.writeZip(Object.entries(entries).map(([name, content]) => ({
    name,
    nameBytes: encoder.encode(name),
    flags: 0x0800,
    time: 0,
    date: 0,
    newData: encoder.encode(content),
  })));
}

test('legacy CORE reads all 15 fields from an in-memory synthetic Зведена workbook', async () => {
  const core = await legacyCore();
  assert.deepEqual(Array.from(core.FIELD_ORDER), Object.keys(LEGACY_FIELDS));
  assert.deepEqual(JSON.parse(JSON.stringify(core.FIELD_HEADERS)), LEGACY_FIELDS);

  const workbook = await syntheticWorkbook(core);
  const result = await core.openWorkbook(workbook);
  assert.equal(result.records.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.records[0])), {
    _row: 2,
    ...SYNTHETIC_ROW,
    date: '2026-01-01',
  });
});
