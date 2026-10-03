import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOwnLosses } from '../src/own-losses-core.js';
import { createOwnLossesModel, ownDataRange, ownPeriodRange } from '../src/own-losses-dashboard-core.js';

// Лише синтетичні дані тієї самої структури, що й таблиця «НАШІ ВТРАТИ».
const HEAD = { A: '№ з/п', B: 'Дата', C: 'Підрозділ', D: 'Втрати О/С', G: 'Дія противника', M: 'Втрати арт систем  (ЗНИЩЕНІ)', X: 'Дії противника', AC: 'Втрати арт систем (ПОШКОДЖЕНІ)', AS: 'Дії противника', AY: 'Артилерійські системи які \nвйшли з ладу' };
const SUB = { D: '200', E: '300', F: '500', G: 'РУ', H: 'АУ', J: 'удар FPV, ББп', K: 'скид з БпЛА', M: 'Д-30', N: '2С1', X: 'РУ', AA: 'удар FPV, ББп', AC: 'Д-30', AD: 'М777', AS: 'РУ', AY: 'Кількість за технічним станом', AZ: 'Найменування' };
const serial = iso => String(Date.parse(`${iso}T00:00:00Z`) / 864e5 + 25569);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function sheet(events) {
  const rows = [{ r: 2, cells: { A: 'ВТРАТИ' } }, { r: 5, cells: HEAD }, { r: 6, cells: SUB }];
  events.forEach((event, i) => rows.push({ r: 7 + i, cells: { A: String(i + 1), B: serial(event.date), C: event.unit, ...event.cells } }));
  return { name: 'НАШІ ВТРАТИ', rows };
}

// 60 діб 2026-08-01 … 2026-09-29: щодня 79 одшбр (300: 1, потім 3), кожну десяту добу ще й 148 оабр (200, арт. системи).
function events() {
  const list = [];
  for (let n = 0; n < 60; n++) {
    const date = addDays('2026-08-01', n);
    list.push({ date, unit: 'садн 79 одшбр', cells: { E: n >= 30 ? '3' : '1', J: '1' } });
    if (n % 10 === 0) list.push({ date, unit: '2 сабатр садн 148 оабр', cells: { D: '1', J: '1', M: '1', AA: '2', AC: '1' } });
  }
  return list;
}
const ownWorkbook = () => parseOwnLosses([sheet(events())]);
const kpi = (model, key) => model.kpis.find(item => item.key === key);

test('default period is the last 30 days of the table, compared with the 30 before', () => {
  const model = createOwnLossesModel(ownWorkbook());
  assert.deepEqual(model.range, { from: '2026-08-31', to: '2026-09-29' });
  assert.deepEqual(model.previousRange, { from: '2026-08-01', to: '2026-08-30' });
  assert.equal(model.hasPrevious, true);
  assert.equal(kpi(model, 'k300').total, 90);
  assert.equal(kpi(model, 'k300').previous, 30);
  assert.equal(kpi(model, 'k300').delta, 60);
  assert.equal(kpi(model, 'k300').deltaPercent, 200);
  assert.equal(kpi(model, 'k200').total, 3);
  assert.equal(kpi(model, 'k200').previous, 3);
  assert.equal(kpi(model, 'k500').total, 0);
  assert.equal(kpi(model, 'personnel').total, 93, '200 + 300 + 500; «Дія противника» — це розподіл причин, а не додаткові втрати');
  assert.equal(kpi(model, 'destroyed').total, 3, 'лише група «знищені»; її причини в суму не входять');
  assert.equal(kpi(model, 'damaged').total, 3);
  assert.equal(model.days, 30);
  assert.equal(model.activeDays, 30);
});

test('presets: 7 days, whole table and a custom range given back to front', () => {
  const own = ownWorkbook();
  assert.deepEqual(ownPeriodRange(own, 'week'), { from: '2026-09-23', to: '2026-09-29' });
  assert.deepEqual(ownPeriodRange(own, 'all'), { from: '2026-08-01', to: '2026-09-29' });
  assert.deepEqual(ownPeriodRange(own, 'custom', { from: '2026-09-10', to: '2026-09-01' }), { from: '2026-09-01', to: '2026-09-10' });
  assert.deepEqual(ownDataRange(own), { from: '2026-08-01', to: '2026-09-29' });
  const all = createOwnLossesModel(own, { preset: 'all' });
  assert.equal(all.hasPrevious, false, 'для всього періоду попереднього відрізка немає');
  assert.equal(all.previousRange.from, '');
  assert.equal(kpi(all, 'k300').deltaPercent, null);
  assert.equal(kpi(all, 'k300').total, 120);
  const week = createOwnLossesModel(own, { preset: 'week' });
  assert.equal(kpi(week, 'k300').total, 21);
  assert.equal(week.bucket, 'day');
  assert.equal(week.series.length, 7);
});

test('a window that starts before the first record is not compared', () => {
  const model = createOwnLossesModel(ownWorkbook(), { preset: 'custom', custom: { from: '2026-08-01', to: '2026-08-10' } });
  assert.equal(model.hasPrevious, false);
  assert.equal(kpi(model, 'k300').previous, null);
  assert.equal(kpi(model, 'k300').delta, null);
  assert.equal(kpi(model, 'k300').deltaPercent, null);
});

test('unit filter limits every block and keeps the unit list of the whole table', () => {
  const model = createOwnLossesModel(ownWorkbook(), { preset: 'all', units: ['148 оабр'] });
  assert.deepEqual(model.units.map(row => row.unit), ['148 оабр']);
  assert.equal(kpi(model, 'k200').total, 6);
  assert.equal(kpi(model, 'k300').total, 0);
  assert.equal(model.eventCount, 6);
  assert.deepEqual(model.allUnits, ['79 одшбр', '148 оабр']);
});

test('units are ranked by personnel losses, with their arts losses and event counts', () => {
  const model = createOwnLossesModel(ownWorkbook());
  assert.equal(model.units.length, 2);
  const [first, second] = model.units;
  assert.equal(first.unit, '79 одшбр');
  assert.equal(first.k300, 90);
  assert.equal(first.destroyed, 0);
  assert.equal(first.events, 30);
  assert.equal(second.unit, '148 оабр');
  assert.equal(second.k200, 3);
  assert.equal(second.destroyed, 3);
  assert.equal(second.damaged, 3);
  assert.equal(second.events, 3);
});

test('causes and arts types are the table facts, largest first', () => {
  const model = createOwnLossesModel(ownWorkbook());
  assert.deepEqual(model.causes, [{ name: 'удар FPV, ББп', total: 33 }]);
  assert.deepEqual(model.destroyedTypes, [{ name: 'Д-30', total: 3 }]);
  assert.deepEqual(model.damagedTypes, [{ name: 'Д-30', total: 3 }]);
  assert.deepEqual(model.destroyedCauses, [{ name: 'удар FPV, ББп', total: 6 }]);
});

test('the event log is newest first and names the cause of each event', () => {
  const model = createOwnLossesModel(ownWorkbook());
  assert.equal(model.events[0].date, '2026-09-29');
  assert.ok(model.events.every((event, i, list) => !i || list[i - 1].date >= event.date));
  const heavy = model.events.find(event => event.unit === '148 оабр');
  assert.equal(heavy.date, '2026-09-20');
  assert.equal(heavy.k200, 1);
  assert.equal(heavy.destroyed, 1);
  assert.equal(heavy.damaged, 1);
  assert.equal(heavy.cause, 'удар FPV, ББп');
  assert.equal(heavy.unitRaw, '2 сабатр садн 148 оабр');
});

test('a row with a suspect date is left out and counted separately', () => {
  const list = events();
  list.splice(10, 0, { date: '2026-09-20', unit: 'садн 79 одшбр', cells: { E: '50' } }); // описка в місяці серед серпневих рядків
  const own = parseOwnLosses([sheet(list)]);
  const model = createOwnLossesModel(own, { preset: 'all' });
  assert.equal(model.suspect, 1);
  assert.equal(kpi(model, 'k300').total, 120, '50 із викиду не враховано');
  assert.ok(model.issues.some(item => item.type === 'date-outlier'));
});

test('long periods are bucketed by week or month', () => {
  const list = [];
  for (let n = 0; n < 300; n++) list.push({ date: addDays('2026-01-01', n), unit: 'садн 79 одшбр', cells: { E: '1' } });
  const model = createOwnLossesModel(parseOwnLosses([sheet(list)]), { preset: 'all' });
  assert.equal(model.bucket, 'month');
  assert.equal(model.series.reduce((sum, item) => sum + item.value.k300, 0), 300);
  const medium = createOwnLossesModel(ownWorkbook(), { preset: 'all' });
  assert.equal(medium.bucket, 'week');
  assert.equal(medium.series.reduce((sum, item) => sum + item.value.k300, 0), 120);
});
