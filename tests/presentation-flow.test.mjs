import assert from 'node:assert/strict';
import test from 'node:test';
import { composeDeck, parseSlot, reviewFor, presentationFileName } from '../src/presentation-flow.js';

const wb = { kind: 'udshv', sourceName: 's.xlsx', sheetName: 'ЖОВТЕНЬ-26', sheets: [], metrics: [], units: ['А', 'Б'], issues: [],
  records: ['2026-09-20', '2026-09-21', '2026-09-22'].flatMap((date, i) => ['А', 'Б'].map(unit => ({ sheet: 'ЖОВТЕНЬ-26', rowNumber: 5 + i * 2 + (unit === 'Б' ? 1 : 0), date, unit, values: { 'personnel|200': 2 } }))) };
const sheet = (name, header, rows) => ({ name, rows: [{ r: 1, cells: Object.fromEntries(header.map((h, i) => [String.fromCharCode(65 + i), { v: h }])) }, ...rows.map((cells, i) => ({ r: i + 2, cells: Object.fromEntries(cells.map((v, j) => [String.fromCharCode(65 + j), { v }])) }))] });
const strikeSheets = weapon => [sheet('Зведена', ['Дата', 'Результат ураження', weapon], [['2026-09-20', 'Уражено', 'X']])];

test('без файлів: лише слайди УДШВ, жодних зарезервованих слайдів', () => {
  const { deck } = composeDeck(wb, {}, { owner: 'Т', generatedOn: '01.10.2026' });
  assert.ok(deck.slides.every(s => s.status !== 'no_source'));
  assert.ok(!deck.slides.some(s => s.id === 'own-losses'));
});

test('виключений підрозділ не потрапляє на титул, вхідна книга не змінюється', () => {
  const { deck } = composeDeck(wb, {}, { excludeUnits: ['Б'] });
  assert.deepEqual(deck.slides[0].units, ['А']);
  assert.equal(wb.units.length, 2);
  assert.equal(wb.records.length, 6);
});

test('слот ПС відхиляє таблицю з «Тип ПУ» і приймає «Тип ЛА»', () => {
  assert.match(parseSlot('ps', strikeSheets('Тип ПУ'), 'f.xlsx').error, /Тип ПУ/);
  assert.ok(parseSlot('ps', strikeSheets('Тип ЛА'), 'f.xlsx').workbook);
  assert.ok(parseSlot('rvia', strikeSheets('Тип ПУ'), 'f.xlsx').workbook);
});

test('не таблиця → зрозуміла помилка; чужий файл у «НАШІ ВТРАТИ»', () => {
  assert.ok(parseSlot('own', [sheet('X', ['а'], [])], 'f.xlsx').error);
});

test('ПС-таблиця дає слайд групи; меню перевірки доступне', () => {
  const ps = parseSlot('ps', strikeSheets('Тип ЛА'), 'ps.xlsx').workbook;
  const { deck } = composeDeck(wb, { ps }, {});
  assert.ok(deck.slides.some(s => String(s.id).includes('ps')));
  assert.equal(typeof reviewFor(wb, { ps }).counts.total, 'number');
});

test('ім’я файлу без заборонених символів', () => {
  assert.equal(presentationFileName('ОВП: УДШВ/1', '01.10.2026'), 'Аналітика ОВП УДШВ 1 01.10.2026.pptx');
});
