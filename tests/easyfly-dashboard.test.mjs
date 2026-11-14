// Міні-дашборд «Зведення» EasyFLY: модель dashboardView (готовність, частки строків, відпустки,
// остання зміна, штурман, плитки розділів) і текстові контракти екрана. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAV_ITEMS, SOLO_PILOTS_LABEL, addLeave, addPerson, dashboardView, navItemsFor, profileCards, recordCheck, shares } from '../src/workspace/easyfly/fly-state.js';
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
  assert.deepEqual(view.tiles.map(t => t.route).sort(), NAV_ITEMS.map(i => i.route).filter(r => r !== 'summary' && r !== 'more').sort());
  const tile = route => view.tiles.find(t => t.route === route);
  assert.deepEqual([tile('pilots').label, tile('pilots').value, tile('pilots').hint, tile('pilots').tone], ['Пілоти', '12', '8 без блокувань', 'red']);
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

test('екран «Сьогодні»: дуга, зміна, заборони, стан за пілотами; схема маршруту згорнута', () => {
  const view = readFileSync(new URL('../src/workspace/easyfly/views/summary.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/workspace/easyfly/easyfly.css', import.meta.url), 'utf8');
  for (const text of ['todayHome', 'Сьогодні', 'Льотна зміна', 'Польоти заборонені', 'Стан за пілотами', 'ef-arc']) {
    assert.ok(view.includes(text), text);
  }
  assert.match(view, /el\('details', \{ class: 'ef-card ef-dash-route' \}/);
  assert.doesNotMatch(view, /root\.append\(routeBoard\(ctx\)\)/, 'схема маршруту не стоїть першою');
  for (const cls of ['.ef-today', '.ef-arc', '.ef-shift-pill', '.ef-glow-card', '.ef-dot-bad']) assert.ok(css.includes(cls), cls);
  assert.doesNotMatch(css, /https?:\/\//, 'тема без зовнішніх адрес');
});

test('без підлеглих пункт зветься «Профіль» і відкриває комісацію', () => {
  assert.equal(SOLO_PILOTS_LABEL, 'Комісація');
  const empty = createEmpty();
  assert.equal(navItemsFor(empty).find(i => i.route === 'pilots').label, 'Профіль');
  const one = addPerson(empty, { callsign: 'Тест-01', role: 'КЕ' }).data;
  const item = navItemsFor(one).find(i => i.route === 'pilots');
  assert.deepEqual([item.label, item.target.name, item.target.params.id, item.target.params.tab], ['Профіль', 'pilot', one.persons[0].id, 'komis']);
  assert.deepEqual(navItemsFor(one).map(i => i.route), NAV_ITEMS.map(i => i.route));
  assert.deepEqual(navItemsFor(one).find(i => i.route === 'leaves').target, { name: 'leaves', params: {} });
  const tile = dashboardView(one, '2026-10-20').tiles.find(t => t.route === 'pilots');
  assert.deepEqual([tile.label, tile.value, tile.target.name, tile.target.params.tab], ['Профіль', null, 'pilot', 'komis']);
  const two = addPerson(one, { callsign: 'Тест-02', role: 'ЛШ' }).data;
  assert.equal(navItemsFor(two).find(i => i.route === 'pilots').label, 'Профіль');
  assert.equal(navItemsFor(createDemo()).find(i => i.route === 'pilots').label, 'Пілоти');
  assert.equal(navItemsFor(createDemo()).find(i => i.route === 'pilots').target.name, 'pilots');
});

test('картки профілю: ВЛК раз на 12 міс, ПМО раз на 6 міс', () => {
  let data = addPerson(createEmpty(), { callsign: 'Тест-01', role: 'КЕ' }).data;
  const id = data.persons[0].id;
  data = recordCheck(data, id, { kind: 'medical:ВЛК', date: '2026-08-01' }).data;
  let cards = profileCards(data.persons[0], data, '2026-10-20');
  const vlk = cards.find(c => c.key === 'medical:ВЛК');
  const pmo = cards.find(c => c.key === 'medical:ПМО');
  assert.match(vlk.lines[0], /01\.08\.2026/);
  assert.match(vlk.footer, /Наступна ВЛК до 01\.08\.2027/);
  assert.match(pmo.lines[0], /14\.06\.2026|01\.08\.2026|Дата/);
  assert.match(pmo.footer, /Наступна ПМО до 01\.02\.2027/);
  data = recordCheck(data, id, { kind: 'medical:ПМО', date: '2027-02-01' }).data;
  cards = profileCards(data.persons[0], data, '2027-02-02');
  assert.match(cards.find(c => c.key === 'medical:ВЛК').footer, /Наступна ВЛК до 01\.08\.2027/);
  assert.match(cards.find(c => c.key === 'medical:ПМО').footer, /Наступною — ВЛК до 01\.08\.2027/);
});
