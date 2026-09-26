import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

function xmlRow(number, values, numericDate = false) {
  const cells = values.map((value, index) => {
    const reference = `${column(index)}${number}`;
    return index === 1 && numericDate
      ? `<c r="${reference}" t="n"><v>${value}</v></c>`
      : `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  }).join('');
  return `<row r="${number}">${cells}</row>`;
}

async function legacyCore() {
  const html = await readFile(new URL('../src/air.html', import.meta.url), 'utf8');
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

async function writeZipEntries(core, entries) {
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

async function syntheticWorkbook(core, dateCases = [{ raw: SYNTHETIC_ROW.date, numeric: false }]) {
  const fields = Object.keys(LEGACY_FIELDS);
  const rows = dateCases.map(({ raw, numeric }, index) =>
    xmlRow(index + 2, fields.map(key => key === 'date' ? raw : SYNTHETIC_ROW[key]), numeric)
  ).join('');
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRow(1, fields.map(key => LEGACY_FIELDS[key]))}${rows}</sheetData></worksheet>`;
  const entries = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Зведена" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  return writeZipEntries(core, entries);
}

async function workbookWithHeaders(core, sheetName, headers, values) {
  const rows = Array.isArray(values[0]) ? values : [values];
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRow(1, headers)}${rows.map((row, index) => xmlRow(index + 2, row)).join('')}</sheetData></worksheet>`;
  return writeZipEntries(core, {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  });
}

async function variedWorkbook(core) {
  const columns = [
    'extraBefore', 'note', 'date', 'num', 'unit', 'time', 'targets', 'district', 'dpi',
    'type', 'month', 'aircraft', 'munition', 'count', 'result', 'cause', 'extraAfter',
  ];
  const headers = columns.map(key => {
    if (key === 'extraBefore') return 'Додаткове поле до';
    if (key === 'extraAfter') return 'Додаткове поле після';
    if (key === 'note') return '  УТОЧНЕННЯ   РЕЗУЛЬТАТУ  ';
    if (key === 'date') return 'дАТА';
    return LEGACY_FIELDS[key];
  });
  const sharedValues = [...headers, 'Синтетичний підрозділ', 'Тестовий район'];
  const sharedIndex = value => sharedValues.indexOf(value);
  const headerCells = headers.map((value, index) =>
    `<c r="${column(index)}1" t="s"><v>${sharedIndex(value)}</v></c>`
  ).join('');
  const rowTwo = {
    extraBefore: 'службове значення',
    note: 'Перевірено & локально <так>',
    date: '46023.75',
    num: '7',
    unit: 'Синтетичний підрозділ',
    time: '09:05',
    targets: 'SYN-<&>-101',
    district: 'Тестовий район',
    dpi: '',
    type: 'Навчальна ціль',
    month: 'Січень',
    aircraft: 'Навчальний ЛА',
    munition: 'Навчальний БП',
    count: '2',
    result: 'НЕВІДОМО',
    cause: '',
    extraAfter: 'не імпортується',
  };
  const rowFive = {
    extraBefore: '',
    note: 'Другий синтетичний рядок\nз переносом',
    date: '2026-01-02T00:00:00',
    num: '8',
    unit: 'Інший синтетичний підрозділ',
    time: '11:30',
    targets: 'SYN-102',
    district: 'Інший тестовий район',
    dpi: 'SYNTHETIC MGRS',
    type: 'Макет',
    month: 'Січень',
    aircraft: 'Навчальний ЛА 2',
    munition: 'Навчальний БП 2',
    count: '1',
    result: 'ЧАСТКОВО',
    cause: 'Синтетична причина',
    extraAfter: '',
  };
  const rowCells = (rowNumber, values) => columns.map((key, index) => {
    const reference = `${column(index)}${rowNumber}`;
    const value = values[key];
    if (!value) return `<c r="${reference}" s="0"/>`;
    if (key === 'num' || key === 'count' || (key === 'date' && rowNumber === 2)) {
      const style = key === 'date' ? ' s="1"' : '';
      return `<c r="${reference}"${style} t="n"><v>${xmlEscape(value)}</v></c>`;
    }
    if (rowNumber === 2 && key === 'unit') {
      return `<c r="${reference}" t="s"><v>${sharedIndex(value)}</v></c>`;
    }
    if (rowNumber === 2 && key === 'district') {
      return `<c r="${reference}" t="s"><v>${sharedIndex(value)}</v></c>`;
    }
    if (rowNumber === 2 && key === 'time') {
      return `<c r="${reference}" t="str"><f>TEXT(C2,&quot;hh:mm&quot;)</f><v>${value}</v></c>`;
    }
    if (rowNumber === 2 && key === 'note') {
      return `<c r="${reference}" t="inlineStr"><is><r><t>Перевірено &amp; </t></r><r><t>локально &lt;так&gt;</t></r></is></c>`;
    }
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:Q5"/><sheetData><row r="1">${headerCells}</row><row r="2">${rowCells(2, rowTwo)}</row><row r="5">${rowCells(5, rowFive)}</row></sheetData></worksheet>`;
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedValues.length}" uniqueCount="${sharedValues.length}">${sharedValues.map(value => `<si><t xml:space="preserve">${xmlEscape(value)}</t></si>`).join('')}</sst>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
  return writeZipEntries(core, {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/lookup.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/main.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Довідник" sheetId="1" r:id="rId1"/><sheet name="зВеДеНа" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/lookup.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/main.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/worksheets/lookup.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>UNRELATED</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/main.xml': sheet,
    'xl/sharedStrings.xml': sharedStrings,
    'xl/styles.xml': styles,
  });
}

function runRustContract(cases) {
  const manifest = fileURLToPath(new URL('../src-tauri/Cargo.toml', import.meta.url));
  const repository = fileURLToPath(new URL('..', import.meta.url));
  const request = {
    cases: cases.map(({ name, bytes }) => ({ name, bytes: Array.from(bytes) })),
  };
  const result = spawnSync('cargo', [
    'run', '--quiet', '--manifest-path', manifest, '--example', 'xlsx_contract_runner',
  ], {
    cwd: repository,
    env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    input: JSON.stringify(request),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `Rust XLSX contract runner failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function comparableLegacyRows(records) {
  return records.map(record => {
    const parsed = JSON.parse(JSON.stringify(record));
    const rowNumber = parsed._row;
    delete parsed._row;
    return { row_number: rowNumber, parsed };
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalJson(value[key])])
    );
  }
  return value;
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

test('legacy CORE keeps numeric and ambiguous synthetic date semantics', async () => {
  const cases = JSON.parse(await readFile(new URL('./fixtures/xlsx-date-cases.json', import.meta.url), 'utf8'));
  const core = await legacyCore();
  const result = await core.openWorkbook(await syntheticWorkbook(core, cases));
  assert.equal(result.records.length, cases.length);
  for (const [index, item] of cases.entries()) {
    assert.equal(result.records[index].date, item.expected, `raw date: ${item.raw}`);
  }
});

test('legacy CORE and Rust importer match on identical synthetic XLSX variants', async () => {
  const core = await legacyCore();
  const dateCases = JSON.parse(await readFile(new URL('./fixtures/xlsx-date-cases.json', import.meta.url), 'utf8'));
  const fieldKeys = Object.keys(LEGACY_FIELDS);
  const baseHeaders = Object.values(LEGACY_FIELDS);
  const baseValues = fieldKeys.map(key => SYNTHETIC_ROW[key]);
  const positiveCases = [
    { name: 'inline-all-fields', bytes: await syntheticWorkbook(core) },
    { name: 'date-matrix', bytes: await syntheticWorkbook(core, dateCases) },
    { name: 'shared-permuted-formula-sparse', bytes: await variedWorkbook(core) },
    {
      name: 'exact-duplicate-rows-retained',
      bytes: await workbookWithHeaders(core, 'Зведена', baseHeaders, [baseValues, baseValues]),
    },
  ];
  const negativeCases = [
    {
      name: 'missing-zvedena',
      bytes: await workbookWithHeaders(core, 'Інший аркуш', baseHeaders, baseValues),
    },
    {
      name: 'missing-required-header',
      bytes: await workbookWithHeaders(core, 'Зведена', baseHeaders.slice(0, -1), baseValues.slice(0, -1)),
    },
    {
      name: 'duplicate-required-header',
      bytes: await workbookWithHeaders(core, 'Зведена', [...baseHeaders, 'дата'], [...baseValues, '2026-01-03']),
    },
  ];
  const rustOutcomes = new Map(
    runRustContract([...positiveCases, ...negativeCases]).map(outcome => [outcome.name, outcome])
  );

  for (const contractCase of positiveCases) {
    const legacy = await core.openWorkbook(contractCase.bytes);
    const rust = rustOutcomes.get(contractCase.name);
    assert.equal(rust.error, null, `${contractCase.name}: Rust rejected the workbook`);
    const rustRows = rust.batch.rows.map(row => ({ row_number: row.row_number, parsed: row.parsed }));
    const legacyRows = comparableLegacyRows(legacy.records);
    assert.equal(
      JSON.stringify(canonicalJson(rustRows)),
      JSON.stringify(canonicalJson(legacyRows)),
      `${contractCase.name}: parser outputs differ`
    );
  }

  for (const [name, expectedError] of [
    ['missing-zvedena', /немає аркуша/],
    ['missing-required-header', /не знайдено стовпців/],
  ]) {
    const contractCase = negativeCases.find(item => item.name === name);
    await assert.rejects(() => core.openWorkbook(contractCase.bytes), expectedError);
    const rust = rustOutcomes.get(name);
    assert.equal(rust.batch, null);
    assert.match(rust.error, expectedError);
  }

  const duplicate = negativeCases.find(item => item.name === 'duplicate-required-header');
  const legacyDuplicate = await core.openWorkbook(duplicate.bytes);
  assert.equal(legacyDuplicate.records.length, 1, 'legacy CORE keeps the first duplicate header');
  const rustDuplicate = rustOutcomes.get(duplicate.name);
  assert.equal(rustDuplicate.batch, null);
  assert.match(rustDuplicate.error, /неоднозначні повторні заголовки/);
});
