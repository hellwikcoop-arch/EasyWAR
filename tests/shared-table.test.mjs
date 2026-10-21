// E8 / C1b: операції над рядками спільної таблиці. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPLY_STATUSES, OPERATION_FIELDS, OPERATION_KINDS, applyOperation, applyOperations,
  canonicalOperation, diffRows, emptyTableState, openConflicts, resolveConflict, validateOperation,
} from '../src/shared-table-core.js';

const COLLECTIVE = 'collective-synthetic-1';
const TABLE = 'table-synthetic-1';
const schema = { collectiveId: COLLECTIVE, tableId: TABLE, schemaVersion: 1, columns: ['date', 'unit', 'count'] };
const WRITER_A = 'member-synthetic-a';
const WRITER_B = 'member-synthetic-b';
const READER = 'member-synthetic-reader';
const options = { schema, writers: [WRITER_A, WRITER_B], verify: op => op.signature === `sig:${op.op_id}` };
const start = () => emptyTableState({ collectiveId: COLLECTIVE, tableId: TABLE, schemaVersion: 1 });

let n = 0;
function op(fields) {
  const id = fields.op_id ?? `op-synthetic-${++n}`;
  const base = {
    op_id: id, collective_id: COLLECTIVE, table_id: TABLE, schema_version: 1, row_key: 'row-1',
    kind: 'upsert', values: { date: '2026-09-01', unit: 'Підрозділ-1', count: 1 }, base_version: 0,
    author_member_id: WRITER_A, device_id: 'device-synthetic-a', client_time: '2026-09-01T10:00',
    key_epoch: 0,
  };
  const out = { ...base, ...fields, op_id: id };
  if (!('signature' in fields)) out.signature = `sig:${id}`;
  for (const [k, v] of Object.entries(fields)) if (v === undefined) delete out[k];
  return out;
}

test('контракт операції зафіксовано (розділ 5.2)', () => {
  assert.deepEqual(OPERATION_KINDS, ['upsert', 'delete', 'restore']);
  assert.deepEqual(APPLY_STATUSES, ['applied', 'duplicate', 'integrity_violation', 'conflict', 'rejected', 'quarantined']);
  assert.equal(OPERATION_FIELDS.length, 13);
});

test('К1: upsert і restore несуть повний рядок; зайві й відсутні стовпці — помилка', () => {
  assert.equal(validateOperation(op({}), schema).ok, true);
  assert.deepEqual(validateOperation(op({ values: { date: '2026-09-01', unit: 'П-1' } }), schema).errors, ['values-missing:count']);
  assert.deepEqual(validateOperation(op({ values: { date: 'x', unit: 'y', count: 1, extra: 1 } }), schema).errors, ['values-unknown:extra']);
  assert.deepEqual(validateOperation(op({ values: { date: 'x', unit: 'y', count: { a: 1 } } }), schema).errors, ['values-bad-cell:count']);
  assert.deepEqual(validateOperation(op({ kind: 'restore', values: null }), schema).errors, ['values-not-full-row']);
  assert.deepEqual(validateOperation(op({ kind: 'delete', values: { date: 'x' } }), schema).errors, ['delete-has-values']);
  assert.deepEqual(validateOperation(op({ hidden: true }), schema).errors, ['unknown-field:hidden']);
  assert.ok(validateOperation(op({ kind: 'schema_change' }), schema).errors.includes('bad-kind'));
  assert.ok(validateOperation(op({ base_version: -1 }), schema).errors.includes('bad-base-version'));
  assert.ok(validateOperation(op({ signature: '' }), schema).errors.includes('missing:signature'));
  assert.deepEqual(validateOperation(null, schema).errors, ['op-not-object']);
  assert.ok(validateOperation(op({}), null).errors.includes('bad-schema'));
});

test('застосування: новий рядок, зміна, версія зростає; вхідний стан не змінюється', () => {
  const s0 = start();
  const r1 = applyOperation(s0, op({ op_id: 'op-a1' }), options);
  assert.equal(r1.status, 'applied');
  assert.equal(r1.state.rows['row-1'].version, 1);
  assert.equal(r1.state.rows['row-1'].lastAuthor, WRITER_A);
  assert.deepEqual(s0.rows, {});
  const r2 = applyOperation(r1.state, op({ op_id: 'op-a2', base_version: 1, values: { date: '2026-09-01', unit: 'П-1', count: 2 } }), options);
  assert.equal(r2.status, 'applied');
  assert.equal(r2.state.rows['row-1'].version, 2);
  assert.equal(r2.state.rows['row-1'].values.count, 2);
  assert.equal(r1.state.rows['row-1'].values.count, 1);
});

test('S05 / AC06: той самий op_id і байти — дубль; інші байти — порушення цілісності', () => {
  const first = op({ op_id: 'op-dup' });
  const s1 = applyOperation(start(), first, options).state;
  const again = applyOperation(s1, { ...first }, options);
  assert.equal(again.status, 'duplicate');
  assert.equal(again.state, s1);
  const reordered = Object.fromEntries(Object.entries(first).reverse());
  assert.equal(applyOperation(s1, reordered, options).status, 'duplicate', 'порядок ключів не важить');
  const tampered = applyOperation(s1, { ...first, values: { ...first.values, count: 9 } }, options);
  assert.equal(tampered.status, 'integrity_violation');
  assert.equal(tampered.state, s1);
  assert.equal(canonicalOperation({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

test('S03 / AC07: дві правки від однієї версії — конфлікт, без last-write-wins', () => {
  const s1 = applyOperation(start(), op({ op_id: 'op-base' }), options).state;
  const a = op({ op_id: 'op-a', base_version: 1, values: { date: '2026-09-01', unit: 'П-1', count: 5 }, client_time: '2026-09-01T10:00' });
  const b = op({ op_id: 'op-b', base_version: 1, author_member_id: WRITER_B, device_id: 'device-synthetic-b',
    values: { date: '2026-09-01', unit: 'П-1', count: 7 }, client_time: '2030-01-01T00:00' });
  const ra = applyOperation(s1, a, options);
  const rb = applyOperation(ra.state, b, options);
  assert.equal(ra.status, 'applied');
  assert.equal(rb.status, 'conflict');
  assert.equal(rb.reason, 'stale-base-version');
  assert.equal(rb.state.rows['row-1'].values.count, 5, 'свіжіший client_time не перемагає');
  assert.equal(openConflicts(rb.state, 'row-1').length, 1);
  assert.equal(rb.state.conflicts[0].op.values.count, 7, 'друга версія збережена');
  assert.equal(applyOperation(rb.state, b, options).status, 'duplicate', 'повтор конфліктної операції не дає нового конфлікту');
});

test('К6: конфлікт розв\'язує будь-хто з правом запису новою операцією; без права — ні', () => {
  const s1 = applyOperation(start(), op({ op_id: 'op-base2' }), options).state;
  const s2 = applyOperation(s1, op({ op_id: 'op-x', base_version: 1, values: { date: 'd', unit: 'u', count: 2 } }), options).state;
  const c = applyOperation(s2, op({ op_id: 'op-y', base_version: 1, author_member_id: WRITER_B, values: { date: 'd', unit: 'u', count: 3 } }), options);
  const conflictId = c.conflict.conflictId;
  const byReader = resolveConflict(c.state, conflictId,
    op({ op_id: 'op-res-r', base_version: 2, author_member_id: READER, values: { date: 'd', unit: 'u', count: 3 } }), options);
  assert.equal(byReader.status, 'rejected');
  assert.equal(byReader.reason, 'no-write-right');
  const resolved = resolveConflict(c.state, conflictId,
    op({ op_id: 'op-res', base_version: 2, author_member_id: WRITER_B, values: { date: 'd', unit: 'u', count: 3 } }), options);
  assert.equal(resolved.status, 'applied');
  assert.equal(resolved.state.rows['row-1'].values.count, 3);
  assert.equal(resolved.state.rows['row-1'].lastAuthor, WRITER_B);
  assert.equal(openConflicts(resolved.state).length, 0);
  assert.equal(resolved.state.conflicts[0].resolvedBy, 'op-res');
  assert.equal(resolveConflict(resolved.state, conflictId, op({ op_id: 'op-res2', base_version: 3 }), options).reason, 'conflict-already-resolved');
  assert.equal(resolveConflict(c.state, 'немає', op({}), options).reason, 'unknown-conflict');
  assert.equal(resolveConflict(c.state, conflictId, op({ row_key: 'row-2' }), options).reason, 'resolution-other-row');
});

test('AC03: вносить лише призначений; підпис і перевірка обов\'язкові', () => {
  assert.equal(applyOperation(start(), op({ author_member_id: READER }), options).reason, 'no-write-right');
  assert.equal(applyOperation(start(), op({ signature: 'підроблено' }), options).reason, 'bad-signature');
  assert.equal(applyOperation(start(), op({}), { ...options, verify: undefined }).reason, 'no-verifier');
  assert.equal(applyOperation(start(), op({}), { ...options, verify: () => 'true' }).reason, 'bad-signature');
  assert.equal(applyOperation(start(), op({}), { ...options, writers: undefined }).reason, 'no-write-right');
  assert.equal(applyOperation(start(), op({}), null).status, 'rejected');
});

test('чужа таблиця — відмова; невідома версія схеми — карантин', () => {
  assert.equal(applyOperation(start(), op({ table_id: 'table-other' }), options).reason, 'wrong-table');
  assert.equal(applyOperation(start(), op({ collective_id: 'collective-other' }), options).reason, 'wrong-table');
  const q = applyOperation(start(), op({ schema_version: 2 }), options);
  assert.equal(q.status, 'quarantined');
  assert.deepEqual(q.state.rows, {});
});

test('S04 / AC08 / AC21 / К5: видалення — надгробок; відновлення через довгий час; зайнятий ключ — конфлікт', () => {
  let s = applyOperation(start(), op({ op_id: 'op-r1' }), options).state;
  const del = applyOperation(s, op({ op_id: 'op-del', kind: 'delete', values: undefined, base_version: 1, author_member_id: WRITER_B }), options);
  assert.equal(del.status, 'applied');
  s = del.state;
  assert.equal(s.rows['row-1'].deleted, true);
  assert.deepEqual(s.rows['row-1'].tombstone.lastValues, { date: '2026-09-01', unit: 'Підрозділ-1', count: 1 });
  assert.equal(s.rows['row-1'].tombstone.deletedBy, WRITER_B);
  assert.equal(applyOperation(s, op({ op_id: 'op-up-dead', base_version: 2 }), options).reason, 'row-deleted');
  assert.equal(applyOperation(s, op({ op_id: 'op-del2', kind: 'delete', values: undefined, base_version: 2 }), options).reason, 'nothing-to-delete');
  const restored = applyOperation(s, op({ op_id: 'op-restore', kind: 'restore', base_version: 2, client_time: '2036-09-01T10:00',
    values: s.rows['row-1'].tombstone.lastValues }), options);
  assert.equal(restored.status, 'applied', 'обмеження за часом немає');
  assert.equal(restored.state.rows['row-1'].deleted, false);
  assert.equal(restored.state.rows['row-1'].version, 3);
  assert.equal(restored.state.rows['row-1'].restoredFrom.deletedOpId, 'op-del');
  const occupied = applyOperation(restored.state, op({ op_id: 'op-restore2', kind: 'restore', base_version: 3 }), options);
  assert.equal(occupied.status, 'conflict');
  assert.equal(occupied.reason, 'key-occupied');
  assert.equal(applyOperation(start(), op({ op_id: 'op-del-none', kind: 'delete', values: undefined }), options).reason, 'nothing-to-delete');
});

test('повтори в будь-якому порядку дають той самий стан', () => {
  const a = op({ op_id: 'op-o1', row_key: 'r-a' });
  const b = op({ op_id: 'op-o2', row_key: 'r-b' });
  const one = applyOperations(start(), [a, b, a, b, a], options);
  const two = applyOperations(start(), [b, a, b], options);
  assert.deepEqual(one.state.rows, two.state.rows);
  assert.deepEqual(one.results.map(r => r.status), ['applied', 'applied', 'duplicate', 'duplicate', 'duplicate']);
});

test('різниця «було → стане»: змінені клітинки для підсвічування, у пакет — весь рядок', () => {
  const cols = schema.columns;
  const d = diffRows({ date: 'd', unit: 'u', count: 1 }, { date: 'd', unit: 'u', count: 2 }, cols);
  assert.equal(d.change, 'changed');
  assert.deepEqual(d.changed, ['count']);
  assert.equal(d.fullRow, true);
  assert.equal(diffRows(null, { date: 'd', unit: 'u', count: 1 }, cols).change, 'added');
  assert.deepEqual(diffRows(null, { date: 'd', unit: 'u', count: 1 }, cols).changed, cols);
  assert.equal(diffRows({ date: 'd', unit: 'u', count: 1 }, null, cols).change, 'deleted');
  assert.equal(diffRows({ date: 'd' }, { date: 'd' }).change, 'unchanged');
});
