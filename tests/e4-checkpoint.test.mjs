import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, addInstance, duplicateInstance, updateInstance, instanceState, sourceConsistency, serializeLayout, parseLayout } from '../src/module-instance-core.js';
import { cardModel } from '../src/dashboard-layout-view-core.js';
import { emptySchema, addSource, confirmBinding } from '../src/profile-schema-core.js';
import { applyDiff, correctedCellsFor, diffRows, previewDiff, rowKey, suggestKeyColumns } from '../src/table-update-core.js';

// Контрольна точка E4 (docs/MODULES_ROADMAP.md, розділ 5, п. 4): одна таблиця → два модулі → дві копії одного модуля
// з різними періодами → повторний імпорт із переглядом змін → усі картки показують той самий підтверджений стан.
// Лише синтетичні дані; без DOM, бази й Tauri: перевіряється спільна основа ядер.

const SOURCE = 'module:flights';
const TODAY = '2026-06-10';
const COLUMNS = [
  { key: 'c_date', header: 'Дата', type: 'date' },
  { key: 'c_tail', header: 'Борт', type: 'text' },
  { key: 'c_count', header: 'К-сть БП', type: 'number' },
];
const FIELDS = COLUMNS.map(column => ({ key: column.key, label: column.header, dataType: column.type === 'number' ? 'integer' : column.type }));
const DEFINITIONS = [
  { definitionId: 'by-day', requirements: [{ role: 'event-date', required: true }, { role: 'munition-count', required: false }] },
  { definitionId: 'by-count', requirements: [{ role: 'munition-count', required: true }] },
];
const row = (rowId, c_date, c_tail, c_count) => ({ rowId, c_date, c_tail, c_count });

const OLD_ROWS = [
  row(1, '2026-05-02', 'A1', 1),
  row(2, '2026-05-20', 'A2', 2),
  row(3, '2026-06-05', 'A3', 4),
  row(4, '2026-06-09', 'A4', 8),
];

function confirmedSchema() {
  let schema = addSource(emptySchema('profile-a'), { id: SOURCE, type: 'module-table', ref: SOURCE, title: 'Журнал', columns: COLUMNS }).schema;
  schema = confirmBinding(schema, { sourceId: SOURCE, columnKey: 'c_date', role: 'event-date' }).schema;
  schema = confirmBinding(schema, { sourceId: SOURCE, columnKey: 'c_count', role: 'munition-count', unit: 'пуски' }).schema;
  return schema;
}

function checkpointLayout() {
  let layout = emptyLayout('profile-a');
  for (const spec of [
    { definitionId: 'by-day', sourceId: SOURCE, id: 'day-all' },
    { definitionId: 'by-count', sourceId: SOURCE, id: 'count-all' },
  ]) layout = addInstance(layout, spec).layout;
  // Дві копії першого модуля з різними власними періодами.
  const copy = duplicateInstance(layout, 'day-all');
  assert.ok(copy.ok);
  layout = updateInstance(copy.layout, 'day-all', { period: { mode: 'last-days', days: 7 } }).layout;
  layout = updateInstance(layout, copy.instanceId, { period: { mode: 'range', from: '2026-05-01', to: '2026-05-31' } }).layout;
  return { layout, copyId: copy.instanceId };
}

const visibleRows = (layout, schema, rows) => Object.fromEntries(layout.instances.map(instance => {
  const model = cardModel({ layout, schema, instance, rows, today: TODAY });
  assert.ok(model.ok);
  return [instance.id, model.rows.map(item => item.rowId)];
}));

test('контрольна точка E4: повторний імпорт оновлює рядки, а всі картки лишаються на одному підтвердженому стані', () => {
  const schema = confirmedSchema();
  const { layout, copyId } = checkpointLayout();
  assert.equal(layout.instances.length, 3);
  assert.equal(new Set(layout.instances.map(instance => instance.sourceId)).size, 1, 'одна таблиця');
  assert.equal(new Set(layout.instances.map(instance => instance.definitionId)).size, 2, 'два модулі');

  // До імпорту: кожна картка бачить рядки у своєму періоді, стан джерела один.
  const before = visibleRows(layout, schema, OLD_ROWS);
  assert.deepEqual(before, { 'day-all': [3, 4], 'count-all': [1, 2, 3, 4], [copyId]: [1, 2] });
  const stateBefore = layout.instances.map(instance => instanceState(layout, schema, instance.id, DEFINITIONS));
  assert.ok(stateBefore.every(state => state.status === 'available'));
  assert.deepEqual(sourceConsistency(layout, schema, DEFINITIONS).map(item => [item.consistent, item.instances.length]), [[true, 3]]);

  // Новий файл: змінено кількість у A2 і A3 (A3 виправлено вручну), додано A5, зник A1.
  const newRows = [
    row(0, '2026-05-20', 'A2', 3),
    row(0, '2026-06-05', 'A3', 40),
    row(0, '2026-06-09', 'A4', 8),
    row(0, '2026-06-10', 'A5', 16),
  ];
  const stripped = newRows.map(({ rowId, ...rest }) => rest);
  const suggestion = suggestKeyColumns(FIELDS, OLD_ROWS, stripped);
  assert.ok(suggestion.length >= 1, 'ключ знайдено');
  const keyColumns = ['c_tail'];
  assert.equal(new Set(OLD_ROWS.map(item => rowKey(item, keyColumns))).size, OLD_ROWS.length);
  const corrections = [{ rowId: 3, fieldKey: 'c_count', status: 'current' }];
  const diff = diffRows({ fields: FIELDS, oldRows: OLD_ROWS, newRows: stripped, keyColumns, correctedCells: correctedCellsFor(OLD_ROWS, corrections, keyColumns) });
  assert.ok(diff.ok);

  // Перегляд змін до застосування: нічого ще не записано.
  assert.deepEqual([diff.counts.added, diff.counts.changed, diff.counts.removed, diff.counts.unchanged], [1, 2, 1, 1]);
  const a3 = diff.changed.find(item => item.newRow.c_tail === 'A3');
  assert.deepEqual(a3.changes.map(change => [change.field, change.corrected]), [['c_count', true]], 'зміну в виправленій клітинці позначено');
  assert.equal(previewDiff(diff).added[0].row.c_tail, 'A5');
  assert.equal(diff.keptCorrections, 1, 'ручне виправлення A3 лишається');
  assert.deepEqual(OLD_ROWS.map(item => item.c_count), [1, 2, 4, 8], 'вхідні рядки не змінено');

  // Застосування за замовчуванням: зниклі лишаються.
  const applied = applyDiff(OLD_ROWS, diff);
  assert.ok(applied.ok);
  const nextRows = applied.rows.map((item, index) => ({ ...item, rowId: item.rowId ?? 100 + index }));
  assert.deepEqual(nextRows.map(item => item.c_tail), ['A1', 'A2', 'A3', 'A4', 'A5']);
  assert.equal(nextRows.find(item => item.c_tail === 'A2').c_count, 3, 'змінене значення оновлено');
  assert.equal(nextRows.find(item => item.c_tail === 'A3').c_count, 4, 'виправлене вручну не перезаписано');

  // Після імпорту: кожна картка рахує з тих самих нових рядків, але у своєму періоді.
  const a5 = nextRows.find(item => item.c_tail === 'A5').rowId;
  const after = visibleRows(layout, schema, nextRows);
  assert.deepEqual(after['day-all'].filter(id => id !== a5), [3, 4], 'останні 7 днів: A3 і A4 та новий рядок');
  assert.ok(after['day-all'].includes(a5), 'картка «останні 7 днів» бачить новий рядок');
  assert.ok(after['count-all'].includes(a5), 'картка «увесь час» бачить новий рядок');
  assert.ok(!after[copyId].includes(a5), 'картка з травневим діапазоном його не бачить');
  assert.deepEqual(after[copyId], [1, 2], 'травневий діапазон: рядки A1 і A2');

  // Імпорт не чіпає схему профілю: версія й ролі джерела ті самі, картки узгоджені, розкладка не змінилась.
  const stateAfter = layout.instances.map(instance => instanceState(layout, schema, instance.id, DEFINITIONS));
  assert.deepEqual(stateAfter.map(state => [state.sourceVersion, state.roles]), stateBefore.map(state => [state.sourceVersion, state.roles]));
  assert.deepEqual(sourceConsistency(layout, schema, DEFINITIONS).map(item => item.consistent), [true]);
  assert.ok(parseLayout(serializeLayout(layout)).ok);
});

test('контрольна точка E4: якщо роль не підтверджено, усі картки джерела прямо про це кажуть, а період не діє', () => {
  const unconfirmed = addSource(emptySchema('profile-a'), { id: SOURCE, type: 'module-table', ref: SOURCE, title: 'Журнал', columns: COLUMNS }).schema;
  const { layout } = checkpointLayout();
  const states = layout.instances.map(instance => instanceState(layout, unconfirmed, instance.id, DEFINITIONS));
  assert.ok(states.every(state => state.status === 'missing'));
  const own = layout.instances.find(instance => instance.period.mode === 'last-days');
  const model = cardModel({ layout, schema: unconfirmed, instance: own, rows: OLD_ROWS, today: TODAY });
  assert.equal(model.rows.length, OLD_ROWS.length, 'без підтвердженої дати рядки не ховаємо за здогадом');
  assert.match(model.periodLabel, /не діє/u);
});
