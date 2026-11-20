// Хронометраж польоту і чернетка польотного листа. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTimingEvent, blankSheetRow, confirmTimingRecord, flightOverview, sheetFromTimings, sheetTotals, timingFlights } from '../src/workspace/easyfly/timing-core.js';
import { confirmTiming, logTimingEvent } from '../src/workspace/easyfly/fly-state.js';
import { createEmpty, parse, serialize } from '../src/workspace/easyfly/fly-store.js';
import { renderSheetHtml } from '../src/workspace/easyfly/sheet-html.js';
import { TIMING_NOTE } from '../src/workspace/easyfly/timing-core.js';

function day() {
  let timing = { id: 't1', date: '2026-10-20', status: 'open', exercise: 'СБП', events: [] };
  for (const event of [
    { kind: 'start', at: '08:00:00' },
    { kind: 'takeoff', at: '08:10:00' },
    { kind: 'landing', at: '08:40:00' },
    { kind: 'takeoff', at: '09:00:00' },
    { kind: 'landing', at: '09:25:00' },
    { kind: 'shutdown', at: '09:30:00' },
  ]) {
    const applied = applyTimingEvent(timing, event);
    assert.equal(applied.ok, true, applied.error);
    timing = applied.timing;
  }
  return timing;
}

test('цикл зліт-посадка збільшує номер польоту, примітка дня фіксована', () => {
  const timing = day();
  const flights = timingFlights(timing);
  assert.deepEqual(flights.map(flight => flight.number), [1, 2]);
  assert.equal(flights[0].minutes, 30);
  assert.equal(flights[1].minutes, 25);
  assert.equal(flights[0].exercise, 'СБП');
  const confirmed = confirmTimingRecord(timing);
  assert.equal(confirmed.note, 'виконання польотних завдань');
  assert.equal(confirmed.status, 'confirmed');
});

test('підтвердження пише польоти в книжку і переживає збереження файлу', () => {
  const data = createEmpty();
  data.persons.push({ id: 'p1', callsign: 'Сокіл-21', role: 'КЕ', classQual: '1' });
  let next = data;
  for (const event of [
    { kind: 'start', at: '08:00:00' },
    { kind: 'takeoff', at: '08:05:00' },
    { kind: 'note', at: '08:06:00', text: 'вітер' },
    { kind: 'landing', at: '08:35:00' },
    { kind: 'shutdown', at: '08:40:00' },
  ]) {
    const logged = logTimingEvent(next, '2026-10-20', { ...event, exercise: 'БП' });
    assert.equal(logged.ok, true, logged.errors);
    next = logged.data;
  }
  const confirmed = confirmTiming(next, next.timings[0].id, 'p1');
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.timings[0].note, TIMING_NOTE);
  assert.equal(confirmed.data.flights.length, 1);
  assert.equal(confirmed.data.flights[0].exercise, 'БП');
  assert.equal(confirmed.data.flights[0].source, 'timekeeper');
  assert.equal(confirmed.data.flights[0].note, TIMING_NOTE);
  const again = confirmTiming(confirmed.data, confirmed.id);
  assert.equal(again.data.flights.length, 1);
  const parsed = parse(serialize(confirmed.data));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.timings[0].events.length, 5);
  assert.equal(parsed.data.timings[0].note, TIMING_NOTE);
});

test('огляд нальоту і лист з двох дат, підсумки день/ніч', () => {
  const data = createEmpty();
  data.flights.push({ id: 'f1', date: '2026-10-20', count: 2, airtimeMin: 40 });
  data.timings = [{ ...confirmTimingRecord(day()), logged: false }];
  const view = flightOverview(data, '2026-10-20');
  assert.equal(view.month.flights, 4);
  assert.equal(view.month.minutes, 95);
  const second = confirmTimingRecord({ ...day(), id: 't2', date: '2026-11-02', exercise: '14' });
  second.events = second.events.map(event => ({ ...event, exercise: '14' }));
  const sheet = sheetFromTimings([data.timings[0], second], { aircraftType: 'Мі-8', tailNumber: '123', crew: 'Сокіл-21' });
  assert.deepEqual(sheet.dates, ['2026-10-20', '2026-11-02']);
  assert.equal(sheet.rows.length, 4);
  sheet.rows[0].dayNight = 'night';
  const totals = sheetTotals(sheet.rows);
  assert.equal(totals.all.count, 4);
  assert.ok(totals.day.count >= 1);
  assert.equal(totals.night.count, 1);
  const html = renderSheetHtml(sheet);
  assert.match(html, /ПОЛЬОТНИЙ ЛИСТ/);
  assert.match(html, /Зворотний бік/);
  assert.match(html, /чернетка, не документ/);
  assert.equal(html.includes('Краматорськ'), false);
  assert.equal(blankSheetRow('2026-12-01').date, '2026-12-01');
  assert.equal(blankSheetRow('2026-12-01').fuelLiters, null);
});
