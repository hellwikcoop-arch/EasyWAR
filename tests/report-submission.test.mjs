// E8 / C1d: перегляд і фіксація «Доповісти». Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';

import { FULL_ROW_NOTE, commitReport, previewReport } from '../src/report-submission-core.js';

const schema = { collectiveId: 'collective-synthetic-1', tableId: 'table-synthetic-1', schemaVersion: 1, columns: ['date', 'unit', 'count'] };
const op = f => ({
  op_id: 'op-synthetic', collective_id: 'collective-synthetic-1', table_id: 'table-synthetic-1', schema_version: 1,
  row_key: 'row-1', kind: 'upsert', values: { date: '2026-09-01', unit: 'Підрозділ-1', count: 2 }, base_version: 1,
  author_member_id: 'member-synthetic-a', device_id: 'device-synthetic-a', signature: 'sig', client_time: null, key_epoch: 0, ...f,
});
const rows = { 'row-1': { date: '2026-09-01', unit: 'Підрозділ-1', count: 1 }, 'row-2': { date: '2026-09-02', unit: 'Підрозділ-2', count: 5 } };

test('AC05: перегляд показує «було → стане» і чесно каже, що йде весь рядок', () => {
  const p = previewReport({ pendingOps: [op({ op_id: 'op-1' })], currentRows: rows, schema, revision: 7 });
  assert.equal(p.items.length, 1);
  assert.deepEqual(p.items[0].diff.changed, ['count']);
  assert.equal(p.items[0].diff.change, 'changed');
  assert.equal(p.items[0].fullRow, true);
  assert.equal(p.note, FULL_ROW_NOTE);
  assert.match(p.note, /весь рядок/u);
  const added = previewReport({ pendingOps: [op({ op_id: 'op-n', row_key: 'row-new', base_version: 0 })], currentRows: rows, schema, revision: 7 });
  assert.equal(added.items[0].diff.change, 'added');
});

test('AC05: фіксація повертає рівно ті операції, що були в перегляді', () => {
  const pending = [op({ op_id: 'op-1' }), op({ op_id: 'op-2', row_key: 'row-2', values: { date: '2026-09-02', unit: 'Підрозділ-2', count: 6 } })];
  const p = previewReport({ pendingOps: pending, currentRows: rows, schema, revision: 3 });
  pending[0].values.count = 999;
  const c = commitReport(p, { currentRevision: 3 });
  assert.equal(c.ok, true);
  assert.deepEqual(c.ops.map(o => o.op_id), ['op-1', 'op-2']);
  assert.equal(c.ops[0].values.count, 2, 'зміна об\'єкта після перегляду не потрапляє в пакет');
  assert.ok(Object.isFrozen(c.ops[0].values));
});

test('видалення — окремим списком і з підтвердженням кожного', () => {
  const pending = [op({ op_id: 'op-d', row_key: 'row-2', kind: 'delete', values: undefined, base_version: 4 })];
  delete pending[0].values;
  const p = previewReport({ pendingOps: pending, currentRows: rows, schema, revision: 1 });
  assert.equal(p.items.length, 0);
  assert.equal(p.deletions.length, 1);
  assert.equal(p.deletions[0].diff.change, 'deleted');
  assert.equal(commitReport(p, { currentRevision: 1 }).code, 'deletions-not-confirmed');
  assert.equal(commitReport(p, { currentRevision: 1, confirmedDeletions: ['row-1'] }).code, 'deletions-not-confirmed');
  assert.equal(commitReport(p, { currentRevision: 1, confirmedDeletions: ['row-2'] }).ok, true);
});

test('дублікати й конфлікти показуються й блокують фіксацію, а не вирішуються мовчки', () => {
  const same = op({ op_id: 'op-x' });
  const dup = previewReport({ pendingOps: [same, { ...same }], currentRows: rows, schema, revision: 1 });
  assert.deepEqual(dup.duplicates, [{ opId: 'op-x', sameBytes: true }]);
  const tampered = previewReport({ pendingOps: [same, { ...same, values: { ...same.values, count: 7 } }], currentRows: rows, schema, revision: 1 });
  assert.deepEqual(tampered.duplicates, [{ opId: 'op-x', sameBytes: false }], 'той самий op_id з іншими байтами');
  assert.equal(commitReport(dup, { currentRevision: 1 }).code, 'duplicates');
  const two = previewReport({ pendingOps: [op({ op_id: 'op-a' }), op({ op_id: 'op-b', values: { date: 'd', unit: 'u', count: 9 } })], currentRows: rows, schema, revision: 1 });
  assert.equal(two.conflicts.length, 1);
  assert.equal(two.conflicts[0].rowKey, 'row-1');
  assert.equal(commitReport(two, { currentRevision: 1 }).code, 'unresolved-conflicts');
});

test('F-16: показане «було → стане» не змінюється через об\'єкти викликача й збігається з пакетом', () => {
  const pending = [op({ op_id: 'op-f16' })];
  const current = { 'row-1': { date: '2026-09-01', unit: 'Підрозділ-1', count: 1 } };
  const p = previewReport({ pendingOps: pending, currentRows: current, schema, revision: 2 });
  pending[0].values.count = 999;
  current['row-1'].count = -5;
  assert.equal(p.items[0].diff.after.count, 2);
  assert.equal(p.items[0].diff.before.count, 1);
  assert.ok(Object.isFrozen(p.items[0].diff.after) && Object.isFrozen(p.items[0].diff.before));
  assert.deepEqual(p.items[0].diff.after, commitReport(p, { currentRevision: 2 }).ops[0].values);
});

test('F-17: чужа таблиця, чужий колектив і інша версія схеми — хибні операції', () => {
  const p = previewReport({ pendingOps: [
    op({ op_id: 'op-t', table_id: 'table-other' }),
    op({ op_id: 'op-c', row_key: 'row-2', collective_id: 'collective-other' }),
    op({ op_id: 'op-s', row_key: 'row-3', schema_version: 9 }),
  ], currentRows: rows, schema, revision: 1 });
  assert.equal(p.items.length, 0);
  assert.deepEqual(p.invalid.map(i => i.errors[0]), ['wrong-table', 'wrong-table', 'unknown-schema-version']);
  assert.equal(commitReport(p, { currentRevision: 1 }).code, 'invalid-operations');
});

test('F-21: підроблений перегляд і ревізія null не фіксуються', () => {
  assert.equal(commitReport({ revision: 1, items: [{ op: { bogus: 1 } }], deletions: [] }, { currentRevision: 1 }).code, 'invalid-preview');
  const p = previewReport({ pendingOps: [op({ op_id: 'op-n' })], currentRows: rows, schema });
  assert.equal(commitReport(p, { currentRevision: null }).code, 'stale-revision');
});

test('змінена ревізія, хибна операція, порожній перегляд — відмова', () => {
  const p = previewReport({ pendingOps: [op({ op_id: 'op-1' })], currentRows: rows, schema, revision: 5 });
  assert.equal(commitReport(p, { currentRevision: 6 }).code, 'stale-revision');
  assert.equal(commitReport(p, {}).code, 'stale-revision');
  const bad = previewReport({ pendingOps: [op({ op_id: 'op-bad', values: { date: 'd' } })], currentRows: rows, schema, revision: 5 });
  assert.equal(bad.invalid.length, 1);
  assert.equal(commitReport(bad, { currentRevision: 5 }).code, 'invalid-operations');
  assert.equal(commitReport(previewReport({ pendingOps: [], schema, revision: 5 }), { currentRevision: 5 }).code, 'nothing-to-report');
  assert.equal(commitReport(null, { currentRevision: 5 }).code, 'invalid-preview');
  for (const r of [commitReport(p, { currentRevision: 6 }), commitReport(null, {})]) assert.match(r.reason, /[А-ЯІЇЄҐ]/u);
});
