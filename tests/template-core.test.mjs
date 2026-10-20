// Шаблони «Офісу» (src/workspace/template-core.js): поля й блоки в DOCX, PPTX і XLSX.
// Файли шаблонів будуються тут же з синтетичного XML через JSZip; результат розпаковується
// знову й перевіряється точним текстом XML. Лише синтетичні дані.
import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import {
  FIELD_PATTERN, blockErrors, escapeXml, fillTemplate, formatNumber, listTemplateFields, parseNumberText,
  parseTemplateText, readZipText, substituteRuns, valueText,
} from '../src/workspace/template-core.js';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const S_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

async function zipOf(files) {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(files)) zip.file(path, text);
  return zip.generateAsync({ type: 'uint8array' });
}

async function partOf(bytes, path) {
  const file = (await JSZip.loadAsync(bytes)).file(path);
  return file ? file.async('string') : null;
}

const run = text => `<w:r><w:t>${text}</w:t></w:r>`;
const para = (...runs) => `<w:p>${runs.join('')}</w:p>`;
const cell = (...paras) => `<w:tc>${paras.join('')}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;

function docx(body, extra = {}) {
  return zipOf({
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    'word/document.xml': `${XML_HEAD}<w:document ${W_NS}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ...extra,
  });
}

async function docxBody(bytes) {
  const xml = await partOf(bytes, 'word/document.xml');
  return /<w:body>([\s\S]*)<w:sectPr\/><\/w:body>/.exec(xml)[1];
}

const fill = (bytes, ext, context) => fillTemplate(bytes, ext, context, { JSZip });

test('розбір тексту шаблону: поля, блоки, пробіли в дужках і українські назви', () => {
  const { tokens, errors } = parseTemplateText('Звіт {{ профіль.назва }}: {{#записи}}{{номер}}{{/записи}}');
  assert.deepEqual(errors, []);
  assert.deepEqual(tokens, [
    { type: 'text', raw: 'Звіт ' },
    { type: 'field', name: 'профіль.назва', raw: '{{ профіль.назва }}' },
    { type: 'text', raw: ': ' },
    { type: 'open', name: 'записи', raw: '{{#записи}}' },
    { type: 'field', name: 'номер', raw: '{{номер}}' },
    { type: 'close', name: 'записи', raw: '{{/записи}}' },
  ]);
  assert.deepEqual([...'{{a}} і {{ b_2.c }}'.matchAll(FIELD_PATTERN)].map(match => match[2]), ['a', 'b_2.c']);
  // Зайва дужка — текст, а не частина поля.
  assert.deepEqual(parseTemplateText('{{{поле}}}').tokens.map(token => token.type), ['text', 'field', 'text']);
  assert.deepEqual(parseTemplateText('{{{поле}}}').errors, []);
});

test('помилки шаблону: незакритий, переплутаний і зайвий кінець блоку, незрозумілий маркер', () => {
  assert.deepEqual(parseTemplateText('{{#записи}}{{номер}}').errors, ['Блок «записи» не закрито: бракує {{/записи}}']);
  assert.deepEqual(parseTemplateText('{{/записи}}').errors, ['Маркер {{/записи}} без початку блоку {{#записи}}']);
  assert.deepEqual(parseTemplateText('{{#а}}{{#б}}{{/а}}').errors, ['Блок «б» закрито маркером {{/а}}; очікувався {{/б}}']);
  assert.deepEqual(parseTemplateText('{{поле з пробілом}} {{поле-1}}').errors, [
    'Незрозумілий маркер {{поле з пробілом}}: назва поля може містити лише літери, цифри, «_» і «.»',
    'Незрозумілий маркер {{поле-1}}: назва поля може містити лише літери, цифри, «_» і «.»',
  ]);
  assert.deepEqual(blockErrors([{ type: 'open', name: 'а' }, { type: 'close', name: 'а' }]), []);
});

test('поле, розірване між трьома фрагментами, замінюється у фрагменті, де починається', () => {
  const values = { 'профіль.назва': 'Іваненко', кількість: 1234.5 };
  const resolve = name => (Object.hasOwn(values, name) ? values[name] : undefined);
  const result = substituteRuns(['Звіт {{', 'профіль.', 'назва}} — {{ кількість }}; {{невідоме}}{{#блок}}'], resolve);
  assert.deepEqual(result.texts, ['Звіт Іваненко', '', ' — 1234,5; {{#блок}}']);
  assert.deepEqual(result.missing, ['невідоме']);
  assert.deepEqual(substituteRuns(['без полів', ''], resolve), { texts: ['без полів', ''], missing: [] });
});

test('числа українською й розпізнавання числового тексту', () => {
  assert.equal(formatNumber(1234.5), '1234,5');
  assert.equal(formatNumber(12345.678), '12 345,68');
  assert.equal(formatNumber(2024), '2024');
  assert.equal(formatNumber(-0.004), '0');
  assert.equal(formatNumber(-3.25), '-3,25');
  assert.equal(formatNumber(72.56, 1), '72,6');
  assert.equal(formatNumber(Number.NaN), '');
  assert.equal(parseNumberText('12 345,5'), 12345.5);
  assert.equal(parseNumberText('7,5'), 7.5);
  assert.equal(parseNumberText('12.5'), 12.5);
  assert.equal(parseNumberText('-3'), -3);
  assert.equal(parseNumberText('007'), null);
  assert.equal(parseNumberText('72,5 %'), null);
  assert.equal(parseNumberText('01.02.2026'), null);
  assert.equal(parseNumberText('1234567890123456'), null);
  assert.equal(valueText(true), 'так');
  assert.equal(valueText(null), '');
  assert.equal(valueText('a\u0000b\u0007c'), 'abc');
  assert.equal(escapeXml(`<&>"'`), '&lt;&amp;&gt;&quot;&apos;');
});

test('DOCX: поля в розірваних фрагментах, екранування XML, колонтитули й незаповнені поля', async () => {
  const body = [
    `<w:p><w:r><w:t>Звіт {{</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>профіль.</w:t></w:r><w:r><w:t>назва}} за {{ дата }}</w:t></w:r></w:p>`,
    para(run('{{невідоме}}, {{інше}} і {{невідоме}}')),
    para(run('Без полів')),
  ].join('');
  const template = await docx(body, {
    'word/header1.xml': `${XML_HEAD}<w:hdr ${W_NS}>${para(run('{{профіль.посада}}'))}</w:hdr>`,
    'word/footer2.xml': `${XML_HEAD}<w:ftr ${W_NS}>${para(run('Сторінка без полів'))}</w:ftr>`,
  });
  const result = await fill(template, 'docx', {
    fields: { 'профіль.назва': `Іваненко <&>"'`, дата: '20.10.2026', 'профіль.посада': 'Аналітик', зайве: 'x' },
  });
  assert.ok(result.bytes instanceof Uint8Array);
  assert.equal(await docxBody(result.bytes), [
    `<w:p><w:r><w:t>Звіт Іваненко &lt;&amp;&gt;&quot;&apos;</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t></w:t></w:r><w:r><w:t xml:space="preserve"> за 20.10.2026</w:t></w:r></w:p>`,
    para(run(',  і ')).replace('<w:t>', '<w:t xml:space="preserve">'),
    para(run('Без полів')),
  ].join(''));
  assert.equal(await partOf(result.bytes, 'word/header1.xml'), `${XML_HEAD}<w:hdr ${W_NS}>${para(run('Аналітик'))}</w:hdr>`);
  assert.equal(await partOf(result.bytes, 'word/footer2.xml'), `${XML_HEAD}<w:ftr ${W_NS}>${para(run('Сторінка без полів'))}</w:ftr>`);
  assert.deepEqual(result.missing, ['інше', 'невідоме']);
  assert.deepEqual(result.used, ['дата', 'профіль.назва', 'профіль.посада']);
  assert.deepEqual(result.warnings, []);
});

test('DOCX: блок повторює рядок таблиці, поля елемента затіняють зовнішні', async () => {
  const header = row(cell(para(run('№'))), cell(para(run('Дата'))));
  const template = await docx(`<w:tbl><w:tblPr/>${header}${row(
    cell(para(run('{{#записи}}{{номер}}'))),
    cell(para(run('{{дата}}{{/записи}}'))),
  )}${row(cell(para(run('Разом'))), cell(para(run('{{зведення.усього}} на {{дата}}'))))}</w:tbl>`);
  const result = await fill(template, 'docx', {
    fields: { дата: '20.10.2026', 'зведення.усього': 2 },
    blocks: { записи: [{ fields: { номер: '1', дата: '01.10.2026' } }, { fields: { номер: '2', дата: '02.10.2026' } }] },
  });
  assert.equal(await docxBody(result.bytes), `<w:tbl><w:tblPr/>${header}${[
    row(cell(para(run('1'))), cell(para(run('01.10.2026')))),
    row(cell(para(run('2'))), cell(para(run('02.10.2026')))),
    row(cell(para(run('Разом'))), cell(para(run('2 на 20.10.2026')))),
  ].join('')}</w:tbl>`);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.used, ['дата', 'записи', 'зведення.усього', 'номер']);
});

test('DOCX: блок абзаців прибирає абзаци з самими маркерами; порожній список прибирає блок', async () => {
  const body = [
    para(run('{{#за_ла}}')),
    para(run('{{номер}}. {{значення}}: '), run('{{записів}}')),
    para(run(' {{/за_ла}} ')),
    para(run('{{#рядки}}• {{A}}{{/рядки}}')),
    para(run('Кінець')),
  ].join('');
  const template = await docx(body);
  const full = await fill(template, 'docx', {
    blocks: {
      за_ла: [{ fields: { номер: '1', значення: 'Тип-1', записів: '3' } }, { fields: { номер: '2', значення: 'Тип-2', записів: '1' } }],
      рядки: [{ fields: { A: 'перший' } }, { fields: { A: 'другий' } }],
    },
  });
  const line = (text, tail) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r>${run(tail)}</w:p>`;
  assert.equal(await docxBody(full.bytes), [
    line('1. Тип-1: ', '3'),
    line('2. Тип-2: ', '1'),
    para(run('• перший')),
    para(run('• другий')),
    para(run('Кінець')),
  ].join(''));
  const empty = await fill(template, 'docx', { blocks: { за_ла: [], рядки: [] } });
  assert.equal(await docxBody(empty.bytes), para(run('Кінець')));
  const unknown = await fill(template, 'docx', {});
  assert.equal(await docxBody(unknown.bytes), para(run('Кінець')));
  assert.deepEqual(unknown.missing, ['за_ла', 'рядки']);
});

test('DOCX: вкладені блоки з власними блоками елемента; порожня клітинка й таблиця лишаються коректними', async () => {
  const nested = await docx([
    para(run('{{#групи}}')),
    para(run('Група {{назва}}')),
    para(run('{{#члени}}')),
    para(run('— {{імя}} ({{назва}})')),
    para(run('{{/члени}}')),
    para(run('{{/групи}}')),
  ].join(''));
  const result = await fill(nested, 'docx', {
    blocks: {
      групи: [
        { fields: { назва: 'А' }, blocks: { члени: [{ fields: { імя: 'Перший' } }, { fields: { імя: 'Другий' } }] } },
        { fields: { назва: 'Б' }, blocks: { члени: [] } },
      ],
    },
  });
  assert.equal(await docxBody(result.bytes), [
    para(run('Група А')), para(run('— Перший (А)')), para(run('— Другий (А)')), para(run('Група Б')),
  ].join(''));

  const inCell = await docx(`<w:tbl>${row(`<w:tc><w:tcPr/>${para(run('{{#порожньо}}'))}${para(run('{{x}}'))}${para(run('{{/порожньо}}'))}</w:tc>`)}</w:tbl>`);
  assert.equal(await docxBody((await fill(inCell, 'docx', { blocks: { порожньо: [] } })).bytes), `<w:tbl>${row('<w:tc><w:tcPr/><w:p/></w:tc>')}</w:tbl>`);

  const wholeTable = await docx(`<w:tbl>${row(cell(para(run('{{#рядки}}{{A}}'))), cell(para(run('{{B}}{{/рядки}}'))))}</w:tbl>`);
  assert.equal(await docxBody((await fill(wholeTable, 'docx', { blocks: { рядки: [] } })).bytes), '<w:p/>');
});

test('DOCX: помилки розташування блоків — виняток і перелік у listTemplateFields', async () => {
  const unclosed = await docx(para(run('{{#записи}}{{номер}}')));
  await assert.rejects(fill(unclosed, 'docx', {}), /Шаблон містить помилки: Документ\. Блок «записи» не закрито: бракує \{\{\/записи\}\}/);
  assert.deepEqual(await listTemplateFields(unclosed, 'docx', { JSZip }), {
    fields: ['номер'], blocks: ['записи'], errors: ['Документ. Блок «записи» не закрито: бракує {{/записи}}'],
  });

  const crossed = await docx(para(run('{{#а}}{{#б}}{{/а}}{{/б}}')));
  const crossedList = await listTemplateFields(crossed, 'docx', { JSZip });
  assert.deepEqual(crossedList.errors, ['Документ. Блок «б» закрито маркером {{/а}}; очікувався {{/б}}', 'Документ. Маркер {{/б}} без початку блоку {{#б}}']);

  const overlap = await docx([para(run('{{#а}}')), para(run('{{/а}}{{#б}}')), para(run('{{/б}}'))].join(''));
  assert.deepEqual((await listTemplateFields(overlap, 'docx', { JSZip })).errors, [
    'Документ. Блоки «а» і «б» перетинаються: розмістіть їхні маркери в окремих абзацах або рядках',
  ]);
  await assert.rejects(fill(overlap, 'docx', {}), /перетинаються/);

  const invalid = await docx(para(run('{{поле-1}} {{добре}}')));
  const listed = await listTemplateFields(invalid, 'docx', { JSZip });
  assert.deepEqual(listed.fields, ['добре']);
  assert.deepEqual(listed.errors, ['Документ. Незрозумілий маркер {{поле-1}}: назва поля може містити лише літери, цифри, «_» і «.»']);
  const filled = await fill(invalid, 'docx', { fields: { добре: 'так' } });
  assert.equal(await docxBody(filled.bytes), para(run('{{поле-1}} так')));
  assert.match(filled.warnings[0], /маркер залишено як є/);
});

function pptx(slides) {
  const files = {
    'ppt/presentation.xml': `${XML_HEAD}<p:presentation ${P_NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `${XML_HEAD}<Relationships ${REL_NS}>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL}/slide" Target="slides/slide${slides.length - i}.xml"/>`).join('')}</Relationships>`,
  };
  // Порядок слайдів у презентації зворотний до номерів файлів.
  slides.forEach((tree, i) => {
    files[`ppt/slides/slide${slides.length - i}.xml`] = `${XML_HEAD}<p:sld ${P_NS}><p:cSld><p:spTree>${tree}</p:spTree></p:cSld></p:sld>`;
  });
  return zipOf(files);
}

const shape = (...paras) => `<p:sp><p:txBody><a:bodyPr/>${paras.join('')}</p:txBody></p:sp>`;
const ap = (...runs) => `<a:p>${runs.map(text => `<a:r><a:rPr lang="uk-UA"/><a:t>${text}</a:t></a:r>`).join('')}</a:p>`;
const atc = text => `<a:tc><a:txBody><a:bodyPr/>${ap(text)}</a:txBody></a:tc>`;
const table = rows => `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tblGrid/>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

test('PPTX: поля на слайдах і блок у рядку таблиці a:tr', async () => {
  const template = await pptx([
    shape(ap('{{модуль.', 'назва}} ({{модуль.рядків}})')),
    table(`<a:tr h="370840">${atc('Мітка')}${atc('Значення')}</a:tr><a:tr h="370840">${atc('{{#рядки}}{{label}}')}${atc('{{value}}{{/рядки}}')}</a:tr>`),
  ]);
  const result = await fill(template, 'pptx', {
    fields: { 'модуль.назва': 'KPI & звіт', 'модуль.рядків': '2' },
    blocks: { рядки: [{ fields: { label: 'Альфа', value: '12,5' } }, { fields: { label: 'Бета', value: '—' } }] },
  });
  const slide = async file => /<p:spTree>([\s\S]*)<\/p:spTree>/.exec(await partOf(result.bytes, file))[1];
  // Перший у презентації — slide2.xml.
  assert.equal(await slide('ppt/slides/slide2.xml'), shape(ap('KPI &amp; звіт', ' (2)')));
  assert.equal(await slide('ppt/slides/slide1.xml'), table([
    `<a:tr h="370840">${atc('Мітка')}${atc('Значення')}</a:tr>`,
    `<a:tr h="370840">${atc('Альфа')}${atc('12,5')}</a:tr>`,
    `<a:tr h="370840">${atc('Бета')}${atc('—')}</a:tr>`,
  ].join('')));
  // Українське впорядкування: кирилиця перед латиницею.
  assert.deepEqual(result.used, ['модуль.назва', 'модуль.рядків', 'рядки', 'label', 'value']);
  assert.deepEqual(await listTemplateFields(template, 'pptx', { JSZip }), {
    fields: ['модуль.назва', 'модуль.рядків', 'label', 'value'], blocks: ['рядки'], errors: [],
  });

  const across = await pptx([shape(ap('{{#рядки}}')) + shape(ap('{{/рядки}}'))]);
  assert.deepEqual((await listTemplateFields(across, 'pptx', { JSZip })).errors, [
    'Слайд 1. Блок «рядки» має починатися й закінчуватися в одному текстовому полі або в рядках однієї таблиці',
  ]);
});

const SST = (...items) => `${XML_HEAD}<sst ${S_NS.split(' ')[0]} count="${items.length}" uniqueCount="${items.length}">${items.join('')}</sst>`;

function xlsx(sheet, sharedStrings, { calcChain = true, extra = {} } = {}) {
  return zipOf({
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${calcChain ? '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>' : ''}</Types>`,
    'xl/workbook.xml': `${XML_HEAD}<workbook ${S_NS}><sheets><sheet name="Звіт" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML_HEAD}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>${calcChain ? `<Relationship Id="rId3" Type="${REL}/calcChain" Target="calcChain.xml"/>` : ''}</Relationships>`,
    'xl/worksheets/sheet1.xml': `${XML_HEAD}<worksheet ${S_NS}>${sheet}</worksheet>`,
    'xl/sharedStrings.xml': sharedStrings,
    ...(calcChain ? { 'xl/calcChain.xml': `${XML_HEAD}<calcChain ${S_NS.split(' ')[0]}><c r="C3" i="1"/></calcChain>` } : {}),
    ...extra,
  });
}

const XLSX_STRINGS = SST(
  '<si><t>Звіт: {{таблиця.назва}}</t></si>',
  '<si><r><t>{{#рядки}}{{</t></r><r><rPr><b/></rPr><t>A}}</t></r></si>',
  '<si><t>{{B}}{{/рядки}}</t></si>',
  '<si><t>Разом</t></si>',
  '<si><t>{{таблиця.рядків}}</t></si>',
);

const XLSX_SHEET = [
  '<dimension ref="A1:C4"/>',
  '<sheetData>',
  '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
  '<row r="2" spans="1:3"><c r="A2" s="1" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" s="2"/></row>',
  '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="s"><v>4</v></c><c r="C3"><f>SUM(B2:B2)</f><v>0</v></c></row>',
  '<row r="4"><c r="A4" t="inlineStr"><is><t>{{дата}}</t></is></c></row>',
  '</sheetData>',
  '<mergeCells count="3"><mergeCell ref="A1:C1"/><mergeCell ref="B2:C2"/><mergeCell ref="A4:C4"/></mergeCells>',
].join('');

const XLSX_CONTEXT = {
  fields: { 'таблиця.назва': 'Таблиця <1>', 'таблиця.рядків': '2', дата: '20.10.2026' },
  blocks: { рядки: [{ fields: { A: 'Альфа', B: '12' } }, { fields: { A: 'Бета', B: '7,5' } }] },
};

test('XLSX: спільні рядки, числова клітинка, рядок-блок зсуває нижчі рядки й об\'єднання', async () => {
  const template = await xlsx(XLSX_SHEET, XLSX_STRINGS);
  const result = await fill(template, 'xlsx', XLSX_CONTEXT);
  const sheet = await partOf(result.bytes, 'xl/worksheets/sheet1.xml');
  assert.equal(sheet, `${XML_HEAD}<worksheet ${S_NS}>${[
    '<dimension ref="A1:C5"/>',
    '<sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Звіт: Таблиця &lt;1&gt;</t></is></c></row>',
    '<row r="2" spans="1:3"><c r="A2" s="1" t="inlineStr"><is><r><t>Альфа</t></r><r><rPr><b/></rPr><t></t></r></is></c><c r="B2"><v>12</v></c><c r="C2" s="2"/></row>',
    '<row r="3" spans="1:3"><c r="A3" s="1" t="inlineStr"><is><r><t>Бета</t></r><r><rPr><b/></rPr><t></t></r></is></c><c r="B3"><v>7.5</v></c><c r="C3" s="2"/></row>',
    // Кешоване значення формули застаріло й прибране: Excel перерахує її під час відкриття.
    '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4"><v>2</v></c><c r="C4"><f>SUM(B2:B2)</f></c></row>',
    '<row r="5"><c r="A5" t="inlineStr"><is><t>20.10.2026</t></is></c></row>',
    '</sheetData>',
    '<mergeCells count="4"><mergeCell ref="A1:C1"/><mergeCell ref="B2:C2"/><mergeCell ref="B3:C3"/><mergeCell ref="A5:C5"/></mergeCells>',
  ].join('')}</worksheet>`);
  // Спільні рядки не змінюються: клітинки з полями стали вбудованими рядками чи числами.
  assert.equal(await partOf(result.bytes, 'xl/sharedStrings.xml'), XLSX_STRINGS);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.used, ['дата', 'рядки', 'таблиця.назва', 'таблиця.рядків', 'A', 'B']);
  assert.deepEqual(result.warnings, ['Формули нижче блоку «рядки» не перераховано: Аркуш «Звіт», посилання на зсунуті рядки перевірте вручну']);
  // Ланцюжок обчислень прибрано, Excel перерахує формули під час відкриття.
  assert.equal(await partOf(result.bytes, 'xl/calcChain.xml'), null);
  assert.doesNotMatch(await partOf(result.bytes, '[Content_Types].xml'), /calcChain/);
  assert.doesNotMatch(await partOf(result.bytes, 'xl/_rels/workbook.xml.rels'), /calcChain/);
  assert.match(await partOf(result.bytes, 'xl/workbook.xml'), /<calcPr calcId="191029" fullCalcOnLoad="1"\/>/);
});

test('XLSX: порожній блок прибирає рядок, нижчі рядки й об\'єднання піднімаються', async () => {
  const template = await xlsx(XLSX_SHEET, XLSX_STRINGS, { calcChain: false });
  const result = await fill(template, 'xlsx', { ...XLSX_CONTEXT, blocks: { рядки: [] } });
  const sheet = await partOf(result.bytes, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<dimension ref="A1:C3"\/>/);
  assert.match(sheet, /<row r="2"><c r="A2" t="s"><v>3<\/v><\/c><c r="B2"><v>2<\/v><\/c><c r="C2"><f>SUM\(B2:B2\)<\/f><\/c><\/row><row r="3"><c r="A3" t="inlineStr">/);
  assert.match(sheet, /<mergeCells count="2"><mergeCell ref="A1:C1"\/><mergeCell ref="A3:C3"\/><\/mergeCells>/);
  assert.doesNotMatch(sheet, /рядки|\{\{/);
});

test('XLSX: один елемент блоку не зсуває рядків, невідоме поле лишає клітинку порожньою', async () => {
  const strings = SST('<si><t>{{#рядки}}{{A}}</t></si>', '<si><t>{{невідоме}}{{/рядки}}</t></si>');
  const template = await xlsx('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="4" t="s"><v>1</v></c></row><row r="2"><c r="A2"><f>A1</f></c></row></sheetData>', strings, { calcChain: false });
  const result = await fill(template, 'xlsx', { blocks: { рядки: [{ fields: { A: '0012' } }] } });
  assert.equal(await partOf(result.bytes, 'xl/worksheets/sheet1.xml'), `${XML_HEAD}<worksheet ${S_NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>0012</t></is></c><c r="B1" s="4"></c></row><row r="2"><c r="A2"><f>A1</f></c></row></sheetData></worksheet>`);
  assert.deepEqual(result.missing, ['невідоме']);
  assert.deepEqual(result.warnings, []);
});

test('XLSX: разом із рядками зсуваються умовне форматування, перевірка даних, гіперпосилання, спільні формули й таблиця', async () => {
  const inline = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const sheet = [
    '<dimension ref="A1:B3"/>',
    `<sheetData><row r="1">${inline('A1', 'Назва')}${inline('B1', 'К-сть')}</row>`,
    `<row r="2">${inline('A2', '{{#рядки}}{{A}}')}${inline('B2', '{{B}}{{/рядки}}')}</row>`,
    '<row r="3"><c r="A3"><f t="shared" ref="A3:B3" si="0">ROW()</f><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>3</v></c></row></sheetData>',
    '<conditionalFormatting sqref="B2 A3:B3"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting>',
    '<dataValidations count="1"><dataValidation type="whole" sqref="B2"/></dataValidations>',
    '<hyperlinks><hyperlink ref="A3" location="Звіт!A1"/></hyperlinks>',
    '<tableParts count="1"><tablePart r:id="rId1"/></tableParts>',
  ].join('');
  const tablePart = ref => `${XML_HEAD}<table ${S_NS.split(' ')[0]} id="1" name="Дані" displayName="Дані" ref="${ref}"><autoFilter ref="${ref}"/><tableColumns count="2"><tableColumn id="1" name="Назва"/><tableColumn id="2" name="К-сть"/></tableColumns></table>`;
  const template = await xlsx(sheet, SST(), {
    calcChain: false,
    extra: {
      'xl/worksheets/_rels/sheet1.xml.rels': `${XML_HEAD}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table1.xml"/></Relationships>`,
      'xl/tables/table1.xml': tablePart('A1:B2'),
    },
  });
  const items = ['1', '2', '3'].map(n => ({ fields: { A: `Назва ${n}`, B: n } }));
  const three = await fill(template, 'xlsx', { blocks: { рядки: items } });
  const out = await partOf(three.bytes, 'xl/worksheets/sheet1.xml');
  assert.match(out, /<dimension ref="A1:B5"\/>/);
  assert.match(out, /<row r="4">.*<c r="B4"><v>3<\/v><\/c><\/row><row r="5"><c r="A5"><f t="shared" ref="A5:B5" si="0">ROW\(\)<\/f><\/c><c r="B5"><f t="shared" si="0"\/><\/c>/);
  assert.match(out, /<conditionalFormatting sqref="B2:B4 A5:B5">/);
  assert.match(out, /<dataValidations count="1"><dataValidation type="whole" sqref="B2:B4"\/><\/dataValidations>/);
  assert.match(out, /<hyperlink ref="A5" location="Звіт!A1"\/>/);
  assert.equal(await partOf(three.bytes, 'xl/tables/table1.xml'), tablePart('A1:B4'));
  assert.match(three.warnings[0], /^Формули нижче блоку «рядки» не перераховано/);

  const none = await fill(template, 'xlsx', { blocks: { рядки: [] } });
  const empty = await partOf(none.bytes, 'xl/worksheets/sheet1.xml');
  assert.match(empty, /<dimension ref="A1:B2"\/>/);
  assert.match(empty, /<conditionalFormatting sqref="A2:B2">/);
  // Перевірка даних була лише на рядку блоку — разом з обгорткою зникає.
  assert.doesNotMatch(empty, /dataValidation/);
  assert.match(empty, /<hyperlink ref="A2" location="Звіт!A1"\/>/);
  assert.equal(await partOf(none.bytes, 'xl/tables/table1.xml'), tablePart('A1:B1'));
  assert.deepEqual(none.warnings, [
    'Формули нижче блоку «рядки» не перераховано: Аркуш «Звіт», посилання на зсунуті рядки перевірте вручну',
    'Таблиця Excel «Дані» залишилася без рядків даних: Аркуш «Звіт»; Excel може запропонувати її відновити',
  ]);
});

test('XLSX: блок через кілька рядків і вкладені блоки — помилки', async () => {
  const multi = await xlsx('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>{{#рядки}}</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>{{/рядки}}</t></is></c></row></sheetData>', SST(), { calcChain: false });
  assert.deepEqual((await listTemplateFields(multi, 'xlsx', { JSZip })).errors, [
    'Аркуш «Звіт». Блок «рядки» має починатися й закінчуватися в одному рядку аркуша (зараз рядки 1–2)',
  ]);
  await assert.rejects(fill(multi, 'xlsx', {}), /в одному рядку аркуша/);
  const nested = await xlsx('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>{{#а}}{{#б}}{{/б}}{{/а}}</t></is></c></row></sheetData>', SST(), { calcChain: false });
  assert.deepEqual((await listTemplateFields(nested, 'xlsx', { JSZip })).errors, [
    'Аркуш «Звіт». Вкладені блоки на аркуші не підтримуються: «б» усередині «а»',
  ]);
});

test('файл не ZIP, невідомий формат, немає основної частини; шаблон без полів повертається без змін', async () => {
  await assert.rejects(fill(new TextEncoder().encode('це не архів'), 'docx', {}), /не документ Office: очікувався ZIP-архів/);
  await assert.rejects(fill(new Uint8Array(), 'docx', {}), /Файл шаблону порожній/);
  await assert.rejects(fill(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'docx', {}), /очікувався ZIP-архів/);
  const anyZip = await zipOf({ 'readme.txt': 'синтетичний архів' });
  await assert.rejects(fill(anyZip, 'odt', {}), /DOCX, PPTX або XLSX \(отримано «odt»\)/);
  await assert.rejects(fill(anyZip, 'docx', {}), /немає основної частини «word\/document\.xml»: це не DOCX/);
  await assert.rejects(fill(anyZip, 'pptx', {}), /«ppt\/presentation\.xml»: це не PPTX/);
  await assert.rejects(listTemplateFields(anyZip, 'xlsx', { JSZip }), /«xl\/workbook\.xml»: це не XLSX/);
  await assert.rejects(fillTemplate(anyZip, 'docx', {}, {}), /потрібна бібліотека JSZip/);
  const broken = await docx(para(run('{{поле}}')).replace('</w:p>', ''));
  await assert.rejects(fill(broken, 'docx', {}), /Пошкоджений XML у частині шаблону «word\/document\.xml»/);

  const plain = await docx(para(run('Без полів')));
  const result = await fill(plain, '.DOCX', { fields: { a: 1 } });
  assert.deepEqual(result.bytes, plain);
  assert.notEqual(result.bytes, plain);
  assert.deepEqual([result.missing, result.used, result.warnings], [[], [], []]);
  assert.deepEqual(await listTemplateFields(Array.from(plain), 'docx', { JSZip }), { fields: [], blocks: [], errors: [] });
});

test('XLSX: числом стає лише текст у форматі словника; «12.30», «20.10», «10.00» лишаються текстом', async () => {
  const strings = SST('<si><t>{{#рядки}}{{A}}</t></si>', '<si><t>{{B}}</t></si>', '<si><t>{{C}}</t></si>', '<si><t>{{D}}</t></si>',
    '<si><t>{{E}}</t></si>', '<si><t>{{F}}</t></si>', '<si><t>{{G}}</t></si>', '<si><t>{{H}}{{/рядки}}</t></si>');
  const cells = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter, i) => `<c r="${letter}1" t="s"><v>${i}</v></c>`).join('');
  const template = await xlsx(`<sheetData><row r="1">${cells}</row></sheetData>`, strings, { calcChain: false });
  const values = { A: '12.30', B: '20.10', C: '1.10', D: '10.00', E: '12345', F: '1 234,5', G: '2.5', H: 3 };
  const result = await fill(template, 'xlsx', { blocks: { рядки: [{ fields: values }] } });
  const sheet = await partOf(result.bytes, 'xl/worksheets/sheet1.xml');
  const text = letter => new RegExp(`<c r="${letter}1" t="inlineStr"><is><t>${values[letter]}</t></is></c>`);
  for (const letter of ['A', 'B', 'C', 'D', 'G']) assert.match(sheet, text(letter), `${letter}: текст як у джерелі`);
  assert.match(sheet, /<c r="E1"><v>12345<\/v><\/c><c r="F1"><v>1234.5<\/v><\/c>/);
  assert.match(sheet, /<c r="H1"><v>3<\/v><\/c>/);
});

test('XLSX: кешовані значення формул прибрано на всіх аркушах, Excel перерахує їх під час відкриття', async () => {
  const template = await zipOf({
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    'xl/workbook.xml': `${XML_HEAD}<workbook ${S_NS}><sheets><sheet name="Дані" sheetId="1" r:id="rId1"/><sheet name="Підсумок" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML_HEAD}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `${XML_HEAD}<worksheet ${S_NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>{{зведення.усього}}</t></is></c><c r="B1"><f>A1*2</f><v>0</v></c><c r="C1" t="str"><f>"x"&amp;A1</f><v>x0</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `${XML_HEAD}<worksheet ${S_NS}><sheetData><row r="1"><c r="A1"><f>Дані!A1+1</f><v>1</v></c><c r="B1"><v>5</v></c></row></sheetData></worksheet>`,
  });
  const result = await fill(template, 'xlsx', { fields: { 'зведення.усього': '7' } });
  const first = await partOf(result.bytes, 'xl/worksheets/sheet1.xml');
  assert.match(first, /<c r="A1"><v>7<\/v><\/c><c r="B1"><f>A1\*2<\/f><\/c><c r="C1"><f>"x"&amp;A1<\/f><\/c>/);
  const second = await partOf(result.bytes, 'xl/worksheets/sheet2.xml');
  assert.match(second, /<c r="A1"><f>Дані!A1\+1<\/f><\/c><c r="B1"><v>5<\/v><\/c>/, 'звичайне значення лишається');
  assert.match(await partOf(result.bytes, 'xl/workbook.xml'), /<calcPr fullCalcOnLoad="1"\/>/);
});

test('DOCX: копії блоку отримують нові id малюнків, закладок і елементів керування вмісту', async () => {
  const drawing = '<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Значок"/></wp:inline></w:drawing></w:r>';
  const bookmark = '<w:bookmarkStart w:id="0" w:name="позначка"/><w:bookmarkEnd w:id="0"/>';
  const sdt = '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:r><w:t>поле</w:t></w:r></w:sdtContent></w:sdt>';
  const body = `<w:tbl>${row(cell(para(run('{{#рядки}}{{A}}'))), cell(`<w:p>${drawing}${bookmark}${sdt}${run('{{B}}{{/рядки}}')}</w:p>`))}</w:tbl>`;
  const header = `${XML_HEAD}<w:hdr ${W_NS}><w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="Герб"/></wp:inline></w:drawing></w:r></w:p></w:hdr>`;
  const template = await docx(body, { 'word/header1.xml': header });
  const items = [1, 2, 3].map(n => ({ fields: { A: `А${n}`, B: `Б${n}` } }));
  const result = await fill(template, 'docx', { blocks: { рядки: items } });
  const out = await docxBody(result.bytes);
  assert.equal((out.match(/<w:tr>/g) ?? []).length, 3);
  const ids = pattern => [...out.matchAll(pattern)].map(match => match[1]);
  assert.deepEqual(ids(/<wp:docPr id="(\d+)"/g), ['1', '3', '4'], 'перша копія — як у шаблоні, далі без «2» з колонтитула');
  assert.deepEqual(ids(/<w:bookmarkStart w:id="(\d+)"/g), ['0', '1', '2']);
  assert.deepEqual(ids(/<w:bookmarkEnd w:id="(\d+)"/g), ['0', '1', '2'], 'пари закладок узгоджені');
  assert.deepEqual(ids(/<w:id w:val="(\d+)"/g), ['7', '1', '2']);
  assert.deepEqual(result.warnings, []);
  // Посилання на виноску в блоці не дублюється мовчки.
  const note = await docx(`${para(run('{{#рядки}}'))}<w:p>${run('{{A}}')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>${para(run('{{/рядки}}'))}`);
  const noted = await fill(note, 'docx', { blocks: { рядки: items } });
  assert.deepEqual(noted.warnings, ['Документ. У блоці «рядки» є посилання на виноску чи примітку: кожна копія посилається на ту саму виноску']);
});

test('частина архіву з підробленим розміром у заголовку не розпаковується понад межу', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', 'а'.repeat(2_000_000));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  // Заголовки кажуть «100 байтів» замість справжніх 4 МБ (UTF-8 кирилиця — по 2 байти).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) view.setUint32(i + 22, 100, true);
    if (signature === 0x02014b50) view.setUint32(i + 24, 100, true);
  }
  const loaded = await JSZip.loadAsync(bytes);
  const file = loaded.file('word/document.xml');
  assert.equal(file._data.uncompressedSize, 100, 'JSZip вірить заголовку');
  await assert.rejects(readZipText(file, { maxBytes: 1_000_000 }), error => error.tooLarge === true);
  // Звичайна частина читається повністю, кирилиця — як є.
  const plain = await JSZip.loadAsync(await zipOf({ 'a.xml': '<a>Звіт</a>' }));
  assert.equal(await readZipText(plain.file('a.xml')), '<a>Звіт</a>');
});
