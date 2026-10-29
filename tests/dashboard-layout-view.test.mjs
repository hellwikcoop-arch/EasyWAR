import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { PERIOD_CHOICES, choiceOf, periodFromChoice, periodLabel, orderedCards, cardModel, sizeChoices } from '../src/dashboard-layout-view-core.js';
import { emptyLayout, duplicateInstance, updateInstance, placeInstance, setSharedPeriod, MAX_COPIES } from '../src/module-instance-core.js';
import { ensureModuleInstances } from '../src/module-instance-modules-core.js';
import { emptySchema, addSource, confirmBinding } from '../src/profile-schema-core.js';
import { moduleSource } from '../src/profile-schema-modules-core.js';

// Лише синтетичні модулі й рядки.
const FIELDS = [{ key: 'event_date', label: 'Дата', dataType: 'date', position: 1 }, { key: 'qty', label: 'К-сть БП', dataType: 'integer', position: 2 }];
const module = (id, extra = {}) => ({ id, templateId: 'launch-journal', title: `Журнал ${id}`, defaultSpan: 1, fields: FIELDS, ...extra });
const ROWS = [
  { event_date: '2026-05-02', qty: 1 }, { event_date: '2026-05-20', qty: 2 }, { event_date: '2026-06-03', qty: 4 }, { qty: 8 },
];

function withDate(confirmed = true) {
  let schema = addSource(emptySchema('p'), moduleSource(module('m1'))).schema;
  if (confirmed) schema = confirmBinding(schema, { sourceId: 'module:m1', columnKey: 'event_date', role: 'event-date' }).schema;
  return schema;
}

test('вибір періоду ↔ період: круг для всіх варіантів, неповний діапазон не приймається', () => {
  for (const choice of ['shared', 'all', 'last-7', 'last-30']) assert.equal(choiceOf(periodFromChoice(choice)), choice);
  const range = periodFromChoice('range', { from: '2026-05-01', to: '2026-05-31' });
  assert.deepEqual(range, { mode: 'range', from: '2026-05-01', to: '2026-05-31' });
  assert.equal(choiceOf(range), 'range');
  assert.equal(periodFromChoice('range', { from: '2026-05-01' }), null);
  assert.equal(periodFromChoice('range', { from: '2026-06-01', to: '2026-05-01' }), null);
  assert.equal(choiceOf({ mode: 'last-days', days: 14 }), 'last-custom');
  assert.deepEqual(PERIOD_CHOICES.map(item => item.id), ['shared', 'all', 'last-7', 'last-30', 'range']);
  assert.equal(periodLabel({ from: '2026-05-01', to: '2026-05-31' }), '01.05.2026 – 31.05.2026');
  assert.equal(periodLabel({ from: null, to: null }), 'Увесь час');
});

test('картки в порядку розміщення; картки модулів, яких немає в списку, пропускаються', () => {
  let layout = ensureModuleInstances(emptyLayout('p'), [module('m1'), module('m2')]).layout;
  layout = duplicateInstance(layout, layout.instances[0].id).layout;
  const copyId = layout.instances[2].id;
  layout = placeInstance(layout, copyId, { x: 0, y: 0, w: 4, h: 4 }).layout;
  layout = placeInstance(layout, layout.instances[0].id, { x: 6, y: 0, w: 4, h: 4 }).layout;
  assert.deepEqual(orderedCards(layout, [module('m1'), module('m2')]).map(item => item.instance.id), [copyId, layout.instances[0].id, layout.instances[1].id]);
  assert.deepEqual(orderedCards(layout, [module('m2')]).map(item => item.instance.sourceId), ['module:m2']);
});

test('копії одного модуля показують різні вибірки одного набору рядків', () => {
  let layout = ensureModuleInstances(emptyLayout('p'), [module('m1')]).layout;
  layout = duplicateInstance(layout, 'rust-template:launch-journal#1').layout;
  layout = updateInstance(layout, 'rust-template:launch-journal#1', { period: { mode: 'range', from: '2026-05-01', to: '2026-05-31' } }).layout;
  layout = updateInstance(layout, 'rust-template:launch-journal#2', { period: { mode: 'range', from: '2026-06-01', to: '2026-06-30' } }).layout;
  const schema = withDate();
  const [may, june] = layout.instances.map(instance => cardModel({ layout, schema, instance, rows: ROWS, today: '2026-07-01' }));
  assert.deepEqual(may.rows.map(r => r.qty), [1, 2]);
  assert.deepEqual(june.rows.map(r => r.qty), [4]);
  assert.equal(may.note, 'Рядків без дати не враховано: 1.');
  assert.equal(may.periodLabel, '01.05.2026 – 31.05.2026');
  assert.ok(may.own && june.own);
});

test('спільна панель діє на картки «як у панелі», власний період — ні', () => {
  let layout = ensureModuleInstances(emptyLayout('p'), [module('m1')]).layout;
  layout = duplicateInstance(layout, 'rust-template:launch-journal#1').layout;
  layout = updateInstance(layout, 'rust-template:launch-journal#2', { period: { mode: 'all' } }).layout;
  layout = setSharedPeriod(layout, { mode: 'last-days', days: 30 }).layout;
  const schema = withDate();
  const [shared, own] = layout.instances.map(instance => cardModel({ layout, schema, instance, rows: ROWS, today: '2026-06-10' }));
  assert.deepEqual(shared.rows.map(r => r.qty), [2, 4]);
  assert.equal(shared.own, false);
  assert.equal(own.rows.length, ROWS.length);
  assert.equal(own.note, '');
});

test('без підтвердженої дати період не ховає рядків і чесно про це каже', () => {
  let layout = ensureModuleInstances(emptyLayout('p'), [module('m1')]).layout;
  layout = updateInstance(layout, 'rust-template:launch-journal#1', { period: { mode: 'last-days', days: 7 } }).layout;
  const model = cardModel({ layout, schema: withDate(false), instance: layout.instances[0], rows: ROWS, today: '2026-06-10' });
  assert.equal(model.rows.length, ROWS.length);
  assert.match(model.note, /Дата події/u);
  assert.match(model.periodLabel, /не діє/u);
  // без схеми взагалі — те саме
  assert.equal(cardModel({ layout, schema: null, instance: layout.instances[0], rows: ROWS, today: '2026-06-10' }).rows.length, ROWS.length);
});

test('дублювати можна до ліміту, останню картку модуля прибрати не можна', () => {
  let layout = ensureModuleInstances(emptyLayout('p'), [module('m1')]).layout;
  const first = () => cardModel({ layout, schema: withDate(), instance: layout.instances[0], rows: [], today: '2026-06-10' });
  assert.equal(first().removable, false);
  while (first().canDuplicate) layout = duplicateInstance(layout, layout.instances[0].id).layout;
  assert.equal(layout.instances.length, MAX_COPIES);
  assert.equal(first().removable, true);
});

test('«останні N днів» без дати у виклику — помилка моделі, а не мовчазний «увесь час»', () => {
  let layout = ensureModuleInstances(emptyLayout('p'), [module('m1')]).layout;
  layout = updateInstance(layout, 'rust-template:launch-journal#1', { period: { mode: 'last-days', days: 7 } }).layout;
  assert.equal(cardModel({ layout, schema: null, instance: layout.instances[0], rows: [], today: '' }).ok, false);
});

test('екран: каталог модулів кличе розкладку лише через клієнт, а збій розкладки не стирає модулі', async () => {
  const catalog = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/dashboard-layout-panel.js', import.meta.url), 'utf8');
  assert.match(catalog, /from '\.\/dashboard-layout-client\.js'/u);
  assert.match(catalog, /await syncLayout\(\)\.catch\(error => \{ state\.layout = null;/u);
  assert.match(catalog, /function renderModule\(module, payload, placed = null\)/u);
  // записів розкладки з каталогу рівно три: фонова синхронізація, changeLayout (елементи керування), прибирання при видаленні модуля
  assert.equal((catalog.match(/updateDashboardLayout\(/gu) || []).length, 3);
  assert.match(panel, /data-action': 'duplicate-card'/u);
  assert.match(panel, /data-action': 'remove-card'/u);
  assert.doesNotMatch(panel, /stroke-dasharray/u);
});

test('вибір розміру: готові ширини, нестандартна з розкладки не губиться; картки несуть своє розміщення', () => {
  assert.deepEqual(sizeChoices(6).map(item => item.w), [4, 6, 8, 12]);
  assert.deepEqual(sizeChoices(5).map(item => item.w), [4, 5, 6, 8, 12]);
  const base = ensureModuleInstances(emptyLayout('p'), [module('m1')]).layout;
  const id = base.instances[0].id;
  assert.equal(orderedCards(base, [module('m1')])[0].at.w, 6, 'типово — половина ширини');
  const layout = placeInstance(base, id, { x: 0, y: 0, w: 8, h: 3 }).layout;
  assert.equal(orderedCards(layout, [module('m1')])[0].at.w, 8);
  assert.equal(ensureModuleInstances(emptyLayout('p'), [module('m2', { defaultSpan: 2 })]).layout.placements[0].w, 12);
});
