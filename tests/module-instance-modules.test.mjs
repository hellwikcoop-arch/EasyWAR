import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, addInstance, duplicateInstance, MAX_COPIES } from '../src/module-instance-core.js';
import { ensureModuleInstances, forgetModuleInstances, periodColumn, rowsInPeriod, moduleDefinitionId } from '../src/module-instance-modules-core.js';
import { emptySchema, addSource, confirmBinding } from '../src/profile-schema-core.js';
import { moduleSource } from '../src/profile-schema-modules-core.js';

// Лише синтетичні модулі й рядки.
const FIELDS = [
  { key: 'event_date', label: 'Дата', dataType: 'date', position: 1 },
  { key: 'qty', label: 'К-сть БП', dataType: 'integer', position: 2 },
];
const module = (id, templateId = 'launch-journal', extra = {}) => ({ id, templateId, title: `Журнал ${id}`, defaultSpan: 1, fields: FIELDS, ...extra });

test('кожен модуль отримує картку один раз; повторна синхронізація нічого не змінює', () => {
  const first = ensureModuleInstances(emptyLayout('p'), [module('m1'), module('m2')]);
  assert.ok(first.ok);
  assert.deepEqual(first.layout.instances.map(i => [i.definitionId, i.sourceId, i.title]), [
    [moduleDefinitionId('launch-journal'), 'module:m1', 'Журнал m1'],
    [moduleDefinitionId('launch-journal'), 'module:m2', 'Журнал m2'],
  ]);
  const again = ensureModuleInstances(first.layout, [module('m1'), module('m2')]);
  assert.equal(again.layout, first.layout);
});

test('п’ять модулів одного шаблону — п’ять карток: ліміт копій лічить кожне джерело окремо', () => {
  const modules = ['a', 'b', 'c', 'd', 'e'].map(id => module(id));
  const result = ensureModuleInstances(emptyLayout('p'), modules);
  assert.ok(result.ok);
  assert.equal(result.layout.instances.length, 5);
  let layout = result.layout;
  for (let n = 1; n < MAX_COPIES; n += 1) layout = duplicateInstance(layout, 'rust-template:launch-journal#1').layout;
  assert.equal(layout.instances.filter(i => i.sourceId === 'module:a').length, MAX_COPIES);
  assert.equal(duplicateInstance(layout, 'rust-template:launch-journal#1').code, 'too_many_copies');
  // а другий модуль того самого шаблону копіюється незалежно
  assert.ok(duplicateInstance(layout, layout.instances.find(i => i.sourceId === 'module:b').id).ok);
});

test('видалення модуля прибирає всі його картки, чужі лишає', () => {
  let layout = ensureModuleInstances(emptyLayout('p'), [module('m1'), module('m2')]).layout;
  layout = duplicateInstance(layout, layout.instances[0].id).layout;
  assert.equal(layout.instances.filter(i => i.sourceId === 'module:m1').length, 2);
  const cleaned = forgetModuleInstances(layout, 'm1');
  assert.deepEqual(cleaned.layout.instances.map(i => i.sourceId), ['module:m2']);
  assert.deepEqual(cleaned.layout.placements.map(p => p.instanceId), cleaned.layout.instances.map(i => i.id));
  assert.equal(forgetModuleInstances(layout, 'нема').layout.instances.length, layout.instances.length);
});

test('картки інших гілок не зникають, коли список модулів містить лише поточну', () => {
  const layout = addInstance(emptyLayout('p'), { definitionId: 'rust-template:x', sourceId: 'module:other-branch' }).layout;
  const synced = ensureModuleInstances(layout, [module('m1')]).layout;
  assert.deepEqual(synced.instances.map(i => i.sourceId), ['module:other-branch', 'module:m1']);
});

test('період діє за підтвердженим стовпцем дати; без нього — не вгадуємо', () => {
  let schema = addSource(emptySchema('p'), moduleSource(module('m1'))).schema;
  assert.equal(periodColumn(schema, 'module:m1'), null);
  schema = confirmBinding(schema, { sourceId: 'module:m1', columnKey: 'event_date', role: 'event-date' }).schema;
  assert.equal(periodColumn(schema, 'module:m1'), 'event_date');

  const rows = [
    { event_date: '2026-05-01', qty: 1 },
    { event_date: '2026-05-15T10:30:00', qty: 2 },
    { event_date: '2026-06-02', qty: 4 },
    { event_date: '', qty: 8 },
    { qty: 16 },
  ];
  const may = rowsInPeriod(rows, 'event_date', { from: '2026-05-01', to: '2026-05-31' });
  assert.deepEqual(may.rows.map(r => r.qty), [1, 2]);
  assert.equal(may.undated, 2);
  assert.ok(may.applied);
  assert.deepEqual(rowsInPeriod(rows, 'event_date', { from: '2026-06-01', to: null }).rows.map(r => r.qty), [4]);
  assert.deepEqual(rowsInPeriod(rows, 'event_date', { from: null, to: null }), { rows, applied: true, undated: 0 });
  const unknown = rowsInPeriod(rows, null, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(unknown.applied, false);
  assert.equal(unknown.rows.length, 5);
});
