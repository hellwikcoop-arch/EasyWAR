// Міні-дашборд «Зведення» EasyFLY: модель dashboardView (готовність, частки строків, відпустки,
// остання зміна, штурман, плитки розділів) і текстові контракти екрана. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAV_ITEMS, addLeave, dashboardView, shares } from '../src/workspace/easyfly/fly-state.js';
import { createEmpty } from '../src/workspace/easyfly/fly-store.js';
import { createDemo, DEMO_TODAY } from '../src/workspace/easyfly/fly-demo.js';

test('shares: цілі відсотки, разом 100, порожньо — нулі', () => {
  assert.deepEqual(shares({ a: 1, b: 1, c: 1 }), { a: 34, b: 33, c: 33 });
  assert.deepEqual(shares({ overdue: 4, soon: 11, valid: 71 }), { overdue: 4, soon: 12, valid: 84 });
  assert.deepEqual(shares({ a: 0, b: 0 }), { a: 0, b: 0 });
  assert.deepEqual(shares({ a: 5, b: 0 }), { a: 100, b: 0 });
});

test('dashboardView на демо-наборі: готовність, лічильники, зміна, штурман, відпустки', () => {
  const view = dashboardView(createDemo(), DEMO_TODAY);
  assert.equal(view.pilots, 12);
  assert.equal(view.blockedCount, 4);
  assert.equal(view.ready, 8);
  assert.equal(view.readyPercent, 67);
  assert.deepEqual(view.counters, { overdue: 4, soon: 11, valid: 71, total: 86 });
  assert.deepEqual(view.share, { overdue: 4, soon: 12, valid: 84 });
  assert.deepEqual(view.shift, { date: '2026-10-20', flights: 23, crews: 4, airtime: '11:40' });
  assert.equal(view.nav.count, 1);
  assert.match(view.nav.title, /Зоря/);
  assert.equal(view.leavesNow.length, 0);
  assert.deepEqual(view.leavesNext.map(r => r.leave.from), ['2027-01-11', '2027-02-01', '2027-03-01']);
  assert.equal(view.reminders, 15);
  assert.ok(view.problems.length >= 15 && view.buckets.length > 0, 'успадковує summaryView');
});

test('плитки: усі розділи, крім самого зведення, з підписами з NAV_ITEMS і числами', () => {
  const view = dashboardView(createDemo(), DEMO_TODAY);
  assert.deepEqual(view.tiles.map(t => t.route).sort(), NAV_ITEMS.map(i => i.route).filter(r => r !== 'summary').sort());
  const tile = route => view.tiles.find(t => t.route === route);
  assert.deepEqual([tile('pilots').label, tile('pilots').value, tile('pilots').hint, tile('pilots').tone], ['Мої пілоти', '12', '8 без блокувань', 'red']);
  assert.equal(tile('chrono').value, '23');
  assert.equal(tile('leaves').hint, 'наступна з 11.01.2027');
  assert.equal(tile('settings').value, null);
  for (const t of view.tiles) assert.ok(t.icon && t.label && t.hint, t.route);
});

test('фільтр за ланкою, відпустка «зараз», порожня база', () => {
  const data = createDemo();
  const link = dashboardView(data, DEMO_TODAY, { link: 'Ланка-1' });
  assert.equal(link.pilots, 4);
  assert.ok(link.counters.total < 86);
  const now = addLeave(data, { personId: 'p05', kind: 'basic', from: '2026-10-15', to: '2026-10-29' }).data;
  const view = dashboardView(now, DEMO_TODAY);
  assert.equal(view.leavesNow.length, 1);
  assert.equal(view.leavesNow[0].callsign, 'Лелека-09');
  assert.equal(view.tiles.find(t => t.route === 'leaves').value, '1');
  const empty = dashboardView(createEmpty(), '2026-10-20');
  assert.deepEqual([empty.pilots, empty.ready, empty.readyPercent, empty.shift, empty.nav.count], [0, 0, 0, null, 0]);
  assert.deepEqual(empty.share, { overdue: 0, soon: 0, valid: 0 });
});

test('екран «Зведення»: дашборд із кільцем, лічильниками, плитками; схема маршруту згорнута', () => {
  const view = readFileSync(new URL('../src/workspace/easyfly/views/summary.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/workspace/easyfly/easyfly.css', import.meta.url), 'utf8');
  for (const text of ['dashboardView', 'Готові', 'Прострочено', 'Скоро', 'Дійсно', 'Потребують уваги', 'Найближчі 30 днів', 'Відпустки', 'Остання зміна', 'Штурман', 'Розділи']) {
    assert.ok(view.includes(text), text);
  }
  assert.match(view, /el\('details', \{ class: 'ef-card ef-dash-route' \}/);
  assert.doesNotMatch(view, /root\.append\(routeBoard\(ctx\)\)/, 'схема маршруту не стоїть першою');
  for (const cls of ['.ef-dash-hero', '.ef-ring', '.ef-kpis', '.ef-share', '.ef-tiles', '.ef-dash-row']) assert.ok(css.includes(cls), cls);
  assert.match(css, /\.ef-tiles \{ order: 1;/, 'на телефоні плитки одразу під лічильниками');
});
