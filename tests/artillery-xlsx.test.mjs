import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ensureMetaSheet, makeRef, openWorkbook, patchCell, readMeta, readSheet, saveWorkbook, setCells, writeMeta } from '../src/artillery-xlsx.js';

const fixture = () => readFile(new URL('./fixtures/artillery-sample.xlsx', import.meta.url));
const SN = 'витр.залиш.-СН';

test('reads sheets, hidden flags, labels, numbers and formulas', async () => {
  const wb = await openWorkbook(await fixture());
  assert.deepEqual(wb.sheets.filter(s => s.hidden).map(s => s.name).sort(), ['Заявка', 'потреба', 'Сц'].sort());
  const sh = await readSheet(wb, SN);
  assert.equal(sh.value(1, 2), 'Сили (засоби)');
  assert.equal(sh.value(2, 2), '11 одшбр');
  assert.equal(sh.value(2, 4), 'витрата б/п');
  assert.equal(sh.value(1, 13), '60 мм міна ОФ');
  assert.equal(sh.value(2, 13), 3);
  assert.equal(sh.value(3, 13), 120);
  assert.equal(sh.isFormula(12, 13), true, 'підсумок — формула');
  assert.ok(sh.merges.some(m => m.r1 === 2 && m.c1 === 2 && m.c2 === 3), 'шапку підрозділу злито на дві колонки');
});

test('writes numbers into input cells and keeps formulas, merges and hidden sheets', async () => {
  const wb = await openWorkbook(await fixture());
  await setCells(wb, SN, [{ ref: 'B13', value: 99 }, { ref: 'C13', value: 7 }, { ref: 'D14', value: 5 }, { ref: 'H14', value: 1 }]);
  const out = await saveWorkbook(wb);
  const re = await openWorkbook(out);
  const sh = await readSheet(re, SN);
  assert.equal(sh.value(2, 13), 99);
  assert.equal(sh.value(3, 13), 7);
  assert.equal(sh.value(4, 14), 5);
  assert.equal(sh.value(8, 14), 1);
  assert.equal(sh.isFormula(12, 13), true);
  assert.equal(sh.value(1, 13), '60 мм міна ОФ');
  assert.equal(sh.merges.length, (await readSheet(await openWorkbook(await fixture()), SN)).merges.length);
  assert.deepEqual(re.sheets.filter(s => s.hidden).map(s => s.name).sort(), ['Заявка', 'потреба', 'Сц'].sort());
  const calc = await re.zip.file('xl/workbook.xml').async('string');
  assert.match(calc, /<calcPr[^>]*fullCalcOnLoad="1"/);
});

test('refuses to overwrite a formula cell', () => {
  const xml = '<worksheet><sheetData><row r="1"><c r="A1"><f>B1+1</f><v>2</v></c></row></sheetData></worksheet>';
  assert.throws(() => patchCell(xml, 'A1', 5), /формулу/);
});

test('inserts cells and rows in the right order', () => {
  let xml = '<worksheet><sheetData><row r="2" spans="1:3"><c r="A2" s="1"><v>1</v></c><c r="C2"><v>3</v></c></row><row r="5"><c r="A5"><v>9</v></c></row></sheetData></worksheet>';
  xml = patchCell(xml, 'B2', 2);
  xml = patchCell(xml, 'E2', 5);
  xml = patchCell(xml, 'A3', 'текст & <тег>');
  xml = patchCell(xml, 'A1', 0);
  const order = [...xml.matchAll(/<c r="([A-Z]+\d+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['A1', 'A2', 'B2', 'C2', 'E2', 'A3', 'A5']);
  assert.ok(xml.indexOf('<row r="1">') < xml.indexOf('<row r="2"'), 'новий рядок 1 стоїть перед рядком 2');
  assert.match(xml, /текст &amp; &lt;тег&gt;/);
  assert.doesNotMatch(xml, /spans=/, 'застарілий spans прибрано');
});

test('keeps the existing cell style when a value changes and clears a cell with null', () => {
  let xml = '<worksheet><sheetData><row r="1"><c r="A1" s="7"/><c r="B1" s="8"><v>3</v></c></row></sheetData></worksheet>';
  xml = patchCell(xml, 'A1', 4);
  xml = patchCell(xml, 'B1', null);
  assert.match(xml, /<c r="A1" s="7"><v>4<\/v><\/c>/);
  assert.match(xml, /<c r="B1" s="8"\/>/);
});

test('writes into an empty sheetData', () => {
  assert.match(patchCell('<worksheet><sheetData/></worksheet>', 'C4', 1), /<row r="4"><c r="C4"><v>1<\/v><\/c><\/row>/);
});

test('removes cached formula values after a save so other programs recalculate', async () => {
  const wb = await openWorkbook(await fixture());
  await setCells(wb, SN, [{ ref: 'B13', value: 1 }]);
  // додаємо кешоване значення до формули, як у файлі з Excel
  wb.xml.set(SN, wb.xml.get(SN).replace(/(<c r="AB13"[^>]*>)(<f>[^<]*<\/f>)/, '$1$2<v>123</v>'));
  const out = await saveWorkbook(wb);
  const raw = await (await openWorkbook(out)).zip.file(wb.sheets.find(s => s.name === SN).path).async('string');
  assert.doesNotMatch(raw, /<v>123<\/v>/);
});

test('adds a hidden journal sheet with date, period and an entry log', async () => {
  const wb = await openWorkbook(await fixture());
  await writeMeta(wb, { date: '2026-10-08', period: '17:00', unit: '11 одшбр', changed: 12, at: '2026-10-08T17:02:00' });
  await writeMeta(wb, { date: '2026-10-08', period: '00:00', unit: '12 одшбр', changed: 3, at: '2026-10-09T00:05:00' });
  const re = await openWorkbook(await saveWorkbook(wb));
  const meta = await readMeta(re);
  assert.equal(meta.date, '2026-10-08');
  assert.equal(meta.period, '00:00');
  assert.equal(meta.journal.length, 2);
  assert.equal(meta.journal[0].unit, '11 одшбр');
  assert.equal(meta.journal[1].changed, 3);
  assert.ok(re.sheets.find(s => s.name.startsWith('EasyWAR_')).hidden);
  await ensureMetaSheet(re);
  assert.equal(re.sheets.filter(s => s.name.startsWith('EasyWAR_')).length, 1, 'повторно аркуш не створюється');
  assert.equal(makeRef(28, 3), 'AB3');
});
