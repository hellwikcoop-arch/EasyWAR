import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createDashboardModel,
  csvRows,
  lastActiveDate,
  metricName,
  monthRange,
  normalizeUnits,
  parseUdshvWorkbook,
  periodRange,
  shiftAnchor,
  unitName,
  validateWorkbook,
  weekRange,
} from '../src/udshv-dashboard-core.js';

// Синтетична таблиця УДШВ: шапка у два рядки, денні блоки, підсумкові блоки.
const HEAD = {
  A: '№ з/п', B: 'День тижня', C: 'Дата', D: 'Підрозділ', E: 'ВгЗ', F: 'КББ',
  G: 'Витрата боєприпасів', J: 'Втрати о/с', L: 'Втрати противника за категоріями', N: 'ЗНИЩЕНО', P: 'ПОШКОДЖЕНО', R: 'ПОДАВЛЕНО',
};
const SUB = { G: '155мм', H: '122мм', I: 'ВСЬОГО', J: '200', K: '300', L: 'артилерія ', M: 'ІФС', N: 'танк', O: 'мотоцмкл', P: 'танк', Q: 'КП, ПУ, КСП,', R: 'танк', S: 'РЕБ' };
const serial = iso => String(Date.parse(`${iso}T00:00:00Z`) / 864e5 + 25569);

function sheet(name, days) {
  const rows = [{ r: 1, cells: { A: 'Втрати о/с та ОВТ противника за угруповання ДШВ' } }, { r: 2, cells: HEAD }, { r: 3, cells: SUB }];
  let r = 5;
  for (const day of days) {
    day.units.forEach((unit, i) => {
      const cells = { A: String(i + 1), D: unit.name };
      if (i === 0) { cells.B = 'СУБОТА'; cells.C = day.textDate ? day.date.split('-').reverse().map((p, k) => k === 2 ? p.slice(2) : p).join('.') : serial(day.date); }
      Object.assign(cells, unit.cells);
      rows.push({ r: r++, cells });
    });
    r += 2;
  }
  // Підсумок декади — має бути пропущений.
  rows.push({ r: r++, cells: { A: '1', B: '01-10.08.26', D: 'АГ 148 оабр', E: '999', J: '999' } });
  return { name, rows };
}

const WORKBOOK = [
  sheet('СЕРПЕНЬ-26', [
    { date: '2026-08-01', units: [{ name: 'АГ 148 оабр', cells: { E: '10', F: '2', G: '30', H: '20', I: '50', J: '3', K: '1', L: '2', N: '1', O: '2' } }, { name: 'РУК 148оабр', cells: { E: '1', J: '1' } }] },
    { date: '2026-08-02', textDate: true, units: [{ name: 'АГ 148 оабр', cells: { E: '5', G: '4', I: '5', K: '2', P: '3', Q: '1' } }, { name: 'РУК 148 оабр', cells: { R: '1', S: '1' } }] },
  ]),
  sheet('ВЕРЕСЕНЬ-26', [
    { date: '2026-09-01', units: [{ name: 'АГ 148 оабр', cells: { J: '7', N: '1' } }] },
    { date: '2026-09-02', units: [{ name: 'АГ 148 оабр', cells: {} }] },
  ]),
  { name: 'ЧИСТИЙ', rows: sheet('x', [{ date: '2025-09-01', units: [{ name: 'АГ', cells: { J: '5' } }] }]).rows },
];

test('recognises the UDSHV table by its header and rejects other workbooks', () => {
  const wb = parseUdshvWorkbook(WORKBOOK, 'udshv.xlsx');
  assert.equal(wb.kind, 'udshv');
  assert.equal(wb.readOnly, true);
  assert.deepEqual(wb.sheets.map(s => s.name), ['СЕРПЕНЬ-26', 'ВЕРЕСЕНЬ-26']);
  assert.throws(() => parseUdshvWorkbook([{ name: 'Аркуш1', rows: [{ r: 1, cells: { A: 'Дата', B: 'Час' } }] }]), error => error.code === 'NOT_UDSHV');
});

test('carries block dates down, reads serial and text dates, skips summary blocks and the template sheet', () => {
  const wb = parseUdshvWorkbook(WORKBOOK);
  assert.deepEqual([...new Set(wb.records.map(r => r.date))], ['2026-08-01', '2026-08-02', '2026-09-01', '2026-09-02']);
  assert.deepEqual(wb.units, ['АГ 148 оабр', 'РУК 148 оабр']);
  assert.ok(!wb.records.some(r => r.values['fire|ВгЗ'] === 999));
  assert.ok(!wb.records.some(r => r.date.startsWith('2025')));
});

test('normalises metric and unit spellings across months', () => {
  assert.equal(metricName('мотоцмкл'), 'мотоцикл');
  assert.equal(metricName('КП, ПУ, КСП,'), 'КП, ПУ, КСП');
  assert.equal(metricName('ПУ, КП, КСП'), 'КП, ПУ, КСП');
  assert.equal(metricName('152 мм 2С19 '), '152 мм 2С19');
  assert.equal(unitName('РУК 148оабр'), 'РУК 148 оабр');
});

test('builds week, month and whole-period analytics with comparison to the previous period', () => {
  const wb = parseUdshvWorkbook(WORKBOOK);
  assert.equal(lastActiveDate(wb), '2026-09-01');
  assert.deepEqual(weekRange('2026-09-02'), { from: '2026-08-31', to: '2026-09-06' });
  assert.deepEqual(monthRange('2026-08-15'), { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(shiftAnchor('month', '2026-09-01', -1), '2026-08-01');

  const month = createDashboardModel(wb, { range: periodRange(wb, 'month', '2026-08-10') });
  const kpi = key => month.kpis.find(k => k.key === key).total;
  assert.equal(kpi('kia'), 4);
  assert.equal(kpi('wia'), 3);
  assert.equal(kpi('personnel'), 7);
  assert.equal(kpi('vgz'), 16);
  assert.equal(kpi('ammo'), 55);
  assert.equal(kpi('destroyed'), 3);
  assert.equal(kpi('damaged'), 4);
  assert.equal(kpi('suppressed'), 2);
  assert.equal(month.groups.destroyed.find(i => i.name === 'мотоцикл').total, 2);

  const september = createDashboardModel(wb, { range: periodRange(wb, 'month', '2026-09-01'), preset: 'month' });
  const kia = september.kpis.find(k => k.key === 'kia');
  assert.equal(kia.total, 7);
  assert.equal(kia.previous, 4);
  assert.equal(kia.delta, 3);

  const all = createDashboardModel(wb, { range: periodRange(wb, 'all') });
  assert.equal(all.kpis.find(k => k.key === 'kia').total, 11);
  assert.equal(all.bucket, 'day'); // 33 дні — ще по днях

  const oneUnit = createDashboardModel(wb, { range: periodRange(wb, 'all'), unit: 'РУК 148 оабр' });
  assert.equal(oneUnit.kpis.find(k => k.key === 'kia').total, 1);
});

test('filters by several units at once', () => {
  const wb = parseUdshvWorkbook(WORKBOOK);
  const range = periodRange(wb, 'all');
  const kia = model => model.kpis.find(k => k.key === 'kia').total;
  const one = createDashboardModel(wb, { range, unit: ['РУК 148 оабр'] });
  assert.equal(kia(one), 1);
  assert.equal(one.unit, 'РУК 148 оабр');
  assert.deepEqual(one.selectedUnits, ['РУК 148 оабр']);

  const both = createDashboardModel(wb, { range, unit: ['АГ 148 оабр', 'РУК 148 оабр', 'АГ 148 оабр'] });
  assert.equal(kia(both), 11);
  assert.deepEqual(both.selectedUnits, ['АГ 148 оабр', 'РУК 148 оабр']);
  assert.equal(both.unit, '');

  assert.equal(kia(createDashboardModel(wb, { range, unit: [] })), 11);
  assert.deepEqual(normalizeUnits(['', 'A', 'A', null, 'B']), ['A', 'B']);
  assert.deepEqual(normalizeUnits('A'), ['A']);
  assert.deepEqual(normalizeUnits(''), []);

  const rows = csvRows(wb, range, ['РУК 148 оабр']);
  assert.deepEqual(rows.slice(1, -1).map(r => r[0]), ['РУК 148 оабр']);
});

test('exports a pivot CSV and reports data problems', () => {
  const wb = parseUdshvWorkbook(WORKBOOK);
  const rows = csvRows(wb, periodRange(wb, 'all'));
  assert.equal(rows[0][0], 'Підрозділ');
  assert.deepEqual(rows.at(-1).slice(0, 1), ['Разом']);
  const kiaColumn = rows[0].indexOf('Втрати о/с: 200');
  assert.equal(rows.at(-1)[kiaColumn], 11);

  const broken = structuredClone(WORKBOOK);
  broken[0].rows.find(r => r.cells.D === 'АГ 148 оабр' && r.cells.I === '50').cells.I = '49';
  const types = validateWorkbook(parseUdshvWorkbook(broken)).map(i => i.type);
  assert.ok(types.includes('ammo-total'));
  assert.ok(types.includes('missing-date'));
});

test('the РВ module opens UDSHV tables read-only in its own dashboard', async () => {
  const html = await readFile(new URL('../src/rocket.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="\.\/udshv-dashboard\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/udshv-dashboard\.css">/);
  assert.match(html, /<main id="view-udshv"/);
  assert.match(html, /async function readAllSheets\(u8\)/);
  assert.match(html, /const ud = await openUdshv\(u8, name\);\s*if \(!ud\) throw standardError;/);
});

test('фон дашборда УДШВ: темна підкладка background.webp, світла тема без картинки', async () => {
  const css = await readFile(new URL('../src/udshv-dashboard.css', import.meta.url), 'utf8');
  const dark = css.match(/html:has\(body\.udshv-open\) \{([^}]*)\}/);
  assert.ok(dark, 'правило фону для html:has(body.udshv-open)');
  assert.match(dark[1], /url\('\.\/udshv-art\/background\.webp'\) center \/ cover no-repeat fixed/);
  assert.match(dark[1], /linear-gradient\(115deg, #0a1730/, 'запасний градієнт під картинкою');
  // Правило світлої теми має відповідати самому <html>: «:root[…] html» не збігається ніколи.
  assert.match(css, /:root\[data-theme="light"\]:has\(body\.udshv-open\) \{\s*background: linear-gradient\(115deg, #e9eef8/);
  assert.doesNotMatch(css, /:root\[data-theme="light"\] html:has\(body\.udshv-open\)/);
  const image = await readFile(new URL('../src/udshv-art/background.webp', import.meta.url));
  assert.equal(image.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(image.subarray(8, 12).toString('latin1'), 'WEBP');
  assert.ok(image.length < 200 * 1024, 'фон лишається легким (він потрапляє й у файл для телефона)');
});
