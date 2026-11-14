// Екран «Сьогодні» і офлайн-калькулятори штурмана. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personalHome, todayHome } from '../src/workspace/easyfly/glow-core.js';
import { addPerson, lapsingAdmissionRows, setTraining } from '../src/workspace/easyfly/fly-state.js';
import { circuit, descent, groundSpeed, mpr, windFromDrift } from '../src/workspace/easyfly/nav-calc-core.js';
import { createDemo, DEMO_TODAY } from '../src/workspace/easyfly/fly-demo.js';
import { createEmpty } from '../src/workspace/easyfly/fly-store.js';

test('сьогодні на демо: 8/12, чотири заборони, зміна 23 польоти і 11:40', () => {
  const view = todayHome(createDemo(), DEMO_TODAY);
  assert.equal(view.airfield, 'Зоря');
  assert.equal(view.dateLabel, '20.10.2026');
  assert.deepEqual([view.ready, view.pilots, view.readyPercent], [8, 12, 67]);
  assert.deepEqual(view.banned.map(b => b.callsign), ['Шуліка-26', 'Беркут-14', 'Гвинт-40', 'Грім-02']);
  assert.equal(view.banned[0].daysOverdue, 10);
  assert.match(view.banned[0].reason, /пілотування|Техніка/i);
  assert.equal(view.states.filter(s => s.blocked).length, 4);
  assert.equal(view.shift.title, 'Льотна зміна сьогодні');
  assert.match(view.shift.subtitle, /23 польоти/);
  assert.match(view.shift.subtitle, /11:40/);
  assert.equal(view.deadlines.overdue, 4);
});

test('особистий екран і рівень підготовки: допуск із перервою йде в комісацію', () => {
  const home = personalHome(createEmpty(), '2026-10-20');
  assert.equal(home.person, null);
  let data = addPerson(createEmpty(), { callsign: 'Тест-01', role: 'КЕ' }).data;
  const id = data.persons[0].id;
  data = setTraining(data, id, { ids: ['circle', 'site', 'no-such'], custom: ['Свій пункт'] }).data;
  assert.deepEqual(data.persons[0].training, { ids: ['circle', 'site'], custom: ['Свій пункт'] });
  const rows = lapsingAdmissionRows(data.persons[0], data, '2026-10-20');
  assert.deepEqual(rows.map(row => row.kind.id), ['site']);
  assert.equal(rows[0].admission, null);
  const self = personalHome(data, '2026-10-20');
  assert.equal(self.person.callsign, 'Тест-01');
  assert.equal(self.ready, true);
});

test('порожня база не вигадує готовність і зміну', () => {
  const view = todayHome(createEmpty(), '2026-10-20');
  assert.deepEqual([view.pilots, view.ready, view.readyPercent, view.shift, view.banned.length], [0, 0, 0, null, 0]);
});

test('калькулятори: штиль, МПР, коробочка і зниження без мережі', () => {
  const gs = groundSpeed({ track: 90, v: 200, windFrom: 0, windMs: 0 });
  assert.equal(gs.ok, true);
  assert.equal(gs.w, 200);
  assert.equal(Math.round(gs.mk), 90);
  const back = windFromDrift({ mk: 90, v: 200, track: 90, w: 200 });
  assert.ok(back.ok && back.uMs < 0.001);
  assert.deepEqual(mpr({ mk: 10, kur: 20, declination: 5 }), { ok: true, mpr: 30, mps: 210, ipr: 35 });
  const box = circuit({ landingMk: 270, side: 'left', v: 180, bank: 15, width: 3, d4: 1, d1: 1, windFrom: 0, windMs: 0 });
  assert.equal(box.ok, true);
  assert.ok(box.radiusKm > 0 && box.totalSec > 0);
  const down = descent({ profile: 'h200', headMs: 0 });
  assert.equal(down.ok, true);
  assert.ok(down.startM > 0);
  const source = readFileSync(new URL('../src/workspace/easyfly/nav-calc-core.js', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../src/workspace/easyfly/views/calculators.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source + screen, /\bfetch\s*\(|XMLHttpRequest|WebSocket|open-meteo|https?:\/\//i);
});

test('екрани «Ще» і «Про застосунок» не кличуть мережу', () => {
  for (const name of ['views/about.js', 'views/more.js', 'views/flights.js', 'fonts/manrope.css']) {
    const text = readFileSync(new URL(`../src/workspace/easyfly/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\bfetch\s*\(|https?:\/\//, name);
  }
  const about = readFileSync(new URL('../src/workspace/easyfly/views/about.js', import.meta.url), 'utf8');
  assert.match(about, /Manrope/);
  assert.match(about, /SIL Open Font License/);
});
