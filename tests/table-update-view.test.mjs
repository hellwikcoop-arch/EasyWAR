import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { diffRows } from '../src/table-update-core.js';
import { changeText, hasChanges, keyOptions, readiness, rowLabel, summaryLines } from '../src/table-update-view-core.js';

const FIELDS = [{ key: 'day', label: 'Дата' }, { key: 'tail', label: 'Борт' }, { key: 'qty', label: 'К-сть БП' }];
const row = (day, tail, qty) => ({ day, tail, qty });
const diffOf = (oldRows, newRows) => diffRows({ fields: FIELDS, oldRows, newRows, keyColumns: ['day', 'tail'] });

test('підсумок показує лише ненульові категорії з правильною відмінюваністю', () => {
  const diff = diffOf([row('d1', 'A', 1), row('d2', 'B', 2), row('d3', 'C', 3)], [row('d1', 'A', 9), row('d4', 'D', 1), row('d5', 'E', 1)]);
  assert.deepEqual(summaryLines(diff).map(item => item.text), ['2 нові рядки', '1 змінений рядок', '2 зниклі рядки']);
  assert.deepEqual(summaryLines({ ok: false }), []);
  const same = diffOf([row('d1', 'A', 1)], [row('d1', 'A', 1)]);
  assert.deepEqual(summaryLines(same), []);
  assert.equal(hasChanges(same), false);
});

test('зниклі рядки є зміною лише за вибором «видалити»', () => {
  const diff = diffOf([row('d1', 'A', 1), row('d2', 'B', 2)], [row('d1', 'A', 1)]);
  assert.equal(hasChanges(diff, 'keep'), false);
  assert.equal(hasChanges(diff, 'remove'), true);
});

test('підпис зміни і підпис рядка', () => {
  const labelOf = new Map(FIELDS.map(field => [field.key, field.label]));
  assert.equal(changeText({ field: 'qty', from: 4, to: 5, corrected: false }, labelOf), 'К-сть БП: 4 → 5');
  assert.equal(changeText({ field: 'qty', from: null, to: 5, corrected: true }, labelOf), 'К-сть БП: — → 5 (ваше виправлення лишиться)');
  assert.equal(rowLabel(row('2026-05-01', 'A1', 1), ['day', 'tail']), '2026-05-01 · A1');
});

test('порівнювати можна лише повно прочитаний аркуш', () => {
  assert.equal(readiness(null).ok, false);
  assert.equal(readiness({ rows: [] }).ok, false);
  const partial = readiness({ rows: [{}], truncated: true, issues: [], skipped: [], warnings: [], rules: { count: 0 } });
  assert.equal(partial.ok, false);
  assert.match(partial.message, /не повністю/u);
  assert.equal(readiness({ rows: [{}], issues: [], skipped: [], warnings: [], rules: { count: 0 } }).ok, true);
});

test('вибір ключа не пропонує службове поле id', () => {
  assert.deepEqual(keyOptions([{ key: 'id', label: 'x' }, ...FIELDS]).map(item => item.key), ['day', 'tail', 'qty']);
  assert.deepEqual(keyOptions(null), []);
});

test('модель не звертається до DOM, Tauri і мережі', async () => {
  const source = await readFile(new URL('../src/table-update-view-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /document\.|window\.|invoke\(|fetch\(|localStorage/u);
});
