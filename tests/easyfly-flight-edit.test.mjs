// Синтетичні регресії редагування наявного запису польоту в EasyFLY.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addFlight, addPerson, shiftReport, updateFlight } from '../src/workspace/easyfly/fly-state.js';
import { createEmpty, parse, serialize, validate } from '../src/workspace/easyfly/fly-store.js';

function withFlight({ source = 'timekeeper' } = {}) {
  const pilot = addPerson(createEmpty(), { callsign: 'Тест-01', role: 'КЕ' });
  assert.equal(pilot.ok, true);
  const flight = addFlight(pilot.data, {
    personId: pilot.id, date: '2026-11-12', exercise: '14',
    count: 2, airtime: '1:25', dayNight: 'day', source, note: 'Початковий запис',
  });
  assert.equal(flight.ok, true);
  return { data: flight.data, id: flight.id, personId: pilot.id };
}

test('редагування польоту: ID і джерело не змінюються, підсумки обох змін перераховуються', () => {
  const { data, id, personId } = withFlight();
  const before = structuredClone(data);
  const originalShift = data.flights[0].shiftId;
  const edited = updateFlight(data, id, {
    date: '2026-11-13', exercise: '20', count: 3, airtime: '0:35',
    crew: ['Тест-02'], personId, note: 'Виправлений', source: 'import', id: 'f999',
  });
  assert.equal(edited.ok, true);
  assert.deepEqual(data, before, 'редуктор не змінює вхідний документ');
  assert.equal(edited.data.flights.length, 1, 'новий запис не додається');
  const flight = edited.data.flights[0];
  assert.equal(flight.id, id);
  assert.equal(flight.source, 'timekeeper', 'джерело не змінюється патчем');
  assert.equal(flight.date, '2026-11-13');
  assert.equal(flight.airtimeMin, 35, 'нова тривалість замінює старий airtimeMin');
  assert.equal(flight.count, 3);
  assert.deepEqual(flight.crew, ['Тест-01', 'Тест-02']);
  assert.equal(flight.note, 'Виправлений');
  assert.notEqual(flight.shiftId, originalShift);
  assert.equal(shiftReport(edited.data, '2026-11-12', '2026-11-15').rows.length, 0);
  assert.equal(shiftReport(edited.data, '2026-11-13', '2026-11-15').rows.length, 1);
  assert.equal(shiftReport(edited.data, '2026-11-13', '2026-11-15').summary.takeoffs, 3);
  assert.equal(validate(edited.data).ok, true);
});

test('редагування: порожній наліт залишається невідомим, повторне збереження не створює дубль', () => {
  const { data, id } = withFlight();
  const first = updateFlight(data, id, { airtime: '', exercise: '', dayNight: null });
  assert.equal(first.ok, true);
  assert.equal(first.data.flights[0].airtimeMin, null);
  assert.equal(first.data.flights[0].exercise, null);
  const second = updateFlight(first.data, id, { airtime: '2:05', count: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.data.flights.length, 1);
  assert.equal(second.data.flights[0].airtimeMin, 125);
  assert.equal(second.data.flights[0].id, id);
});

test('корекція імпортованого польоту зберігає provenance і сторонні метадані без переписування джерела', () => {
  const { data, id } = withFlight({ source: 'import' });
  const original = {
    ...data,
    flights: data.flights.map(flight => ({ ...flight, provenance: { file: 'synthetic.csv', row: 2 } })),
  };
  const edited = updateFlight(original, id, { date: '2026-11-14', note: 'Звірено з джерелом' });
  assert.equal(edited.ok, true);
  assert.equal(edited.data.flights[0].source, 'import');
  assert.deepEqual(edited.data.flights[0].provenance, { file: 'synthetic.csv', row: 2 });
  assert.equal(original.flights[0].date, '2026-11-12');
  assert.equal(edited.data.flights[0].id, id);
  const reopened = parse(serialize(edited.data));
  assert.equal(reopened.ok, true);
  assert.equal(reopened.data.flights[0].date, '2026-11-14');
  assert.deepEqual(reopened.data.flights[0].provenance, original.flights[0].provenance);
});

test('перепризначення пілота й непов’язаний екіпаж не змінюють ID', () => {
  const { data, id } = withFlight();
  const secondPilot = addPerson(data, { callsign: 'Тест-03', role: 'ЛШ' });
  assert.equal(secondPilot.ok, true);
  const reassigned = updateFlight(secondPilot.data, id, { personId: secondPilot.id, crew: ['Тест-02'] });
  assert.equal(reassigned.ok, true);
  assert.equal(reassigned.data.flights[0].personId, secondPilot.id);
  assert.deepEqual(reassigned.data.flights[0].crew, ['Тест-03', 'Тест-02']);
  const unlinked = updateFlight(reassigned.data, id, { personId: null, crew: ['Екіпаж-04'] });
  assert.equal(unlinked.ok, true);
  assert.equal(unlinked.data.flights[0].personId, null);
  assert.deepEqual(unlinked.data.flights[0].crew, ['Екіпаж-04']);
  assert.equal(unlinked.data.flights[0].id, id);
  assert.equal(validate(unlinked.data).ok, true);
});

test('невалідні правки й невідомий ID відхиляються без мутації та без створення зміни', () => {
  const { data, id } = withFlight();
  const snapshot = structuredClone(data);
  const badPatches = [
    { date: '31.02.2026' },
    { airtime: '1:77' },
    { count: 0 },
    { count: '1.5' },
    { exercise: 'погано' },
    { personId: 'p999' },
    { personId: null, crew: [] },
    { crew: ['К'.repeat(41)] },
    { note: 'Примітка'.repeat(90) },
  ];
  for (const patch of badPatches) {
    const rejected = updateFlight(data, id, patch);
    assert.equal(rejected.ok, false, JSON.stringify(patch));
    assert.deepEqual(data, snapshot, 'невдала правка не змінює дані');
  }
  assert.equal(updateFlight(data, 'f999', { count: 1 }).ok, false);
  assert.equal(data.shifts.length, snapshot.shifts.length);
});

test('UI: редагування доступне і в льотній книжці, і в хронометражі', async () => {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8');
  const [entry, pilot, chrono] = await Promise.all([
    read('../src/workspace/easyfly/views/entry.js'),
    read('../src/workspace/easyfly/views/pilot.js'),
    read('../src/workspace/easyfly/views/chrono.js'),
  ]);
  assert.match(entry, /editing \? updateFlight\(data, editing\.id, values\)/);
  assert.match(entry, /title: editing \? 'Змінити політ'/);
  assert.match(entry, /editing\.source === 'import'/);
  assert.match(pilot, /button\('Змінити',[\s\S]*?openEntry\(ctx, \{ flightId: e\.id/);
  assert.match(chrono, /button\('Змінити',[\s\S]*?openEntry\(ctx, \{ flightId: r\.flight\.id/);
});
