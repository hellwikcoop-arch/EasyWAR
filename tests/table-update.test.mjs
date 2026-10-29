import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  UPDATE_LIMITS, applyDiff, correctionCell, diffRows, fileFingerprint, normalizeValue,
  previewDiff, recognizeSource, rowKey, suggestKeyColumns,
} from '../src/table-update-core.js';

// Лише синтетичні поля й рядки.
const FIELDS = [
  { key: 'day', label: 'Дата', dataType: 'date' },
  { key: 'tail', label: 'Борт', dataType: 'text' },
  { key: 'qty', label: 'К-сть БП', dataType: 'integer' },
  { key: 'note', label: 'Примітка', dataType: 'text' },
];
const row = (day, tail, qty, note = '') => ({ day, tail, qty, note });
const OLD = [row('2026-05-01', 'A1', 2, 'x'), row('2026-05-02', 'A2', 4), row('2026-05-03', 'A3', 6)];
const KEY = ['day', 'tail'];

test('значення порівнюються без урахування пробілів, порожніх і форми числа', () => {
  assert.equal(normalizeValue(null), '');
  assert.equal(normalizeValue('  а   б '), 'а б');
  assert.equal(normalizeValue(5), '5');
  assert.equal(rowKey(row('2026-05-01', ' a1 ', 1), KEY), rowKey(row('2026-05-01', 'A1', 9), KEY));
  assert.equal(rowKey(row('2026-05-01', '', 1), KEY), null);
});

test('відбиток структури не залежить від порядку стовпців і регістру та не містить значень', () => {
  const a = fileFingerprint(['Дата', 'Борт', 'К-сть БП']);
  assert.match(a, /^fp1:[0-9a-f]{16}$/u);
  assert.equal(a, fileFingerprint(['к-сть бп', 'ДАТА', 'борт']));
  assert.notEqual(a, fileFingerprint(['Дата', 'Борт']));
  assert.equal(fileFingerprint([]), '');
});

test('упізнавання відомої таблиці: точний і частковий збіг, чуже джерело не пропонується', () => {
  const sources = [
    { id: 'module:m1', columns: [{ header: 'Дата' }, { header: 'Борт' }, { header: 'К-сть БП' }] },
    { id: 'module:m2', columns: [{ header: 'Погода' }, { header: 'Вітер' }] },
    { id: 'module:m3', columns: [{ header: 'Дата' }, { header: 'Борт' }, { header: 'К-сть БП' }, { header: 'Екіпаж' }, { header: 'Примітка' }] },
  ];
  const exact = recognizeSource(sources, ['К-сть БП', 'Дата', 'Борт']);
  assert.deepEqual(exact.map(item => [item.sourceId, item.kind]), [['module:m1', 'exact']]);
  const partial = recognizeSource(sources, ['Дата', 'Борт', 'К-сть БП', 'Екіпаж']);
  assert.equal(partial[0].sourceId, 'module:m3');
  assert.equal(partial[0].kind, 'partial');
  assert.deepEqual(recognizeSource(sources, ['Щось', 'Інше']), []);
  assert.deepEqual(recognizeSource(sources, []), []);
});

test('підказка ключа: однозначний стовпець або пара; повторення чи порожнечі ключа не пропонує', () => {
  const next = [...OLD, row('2026-05-04', 'A4', 8)];
  const found = suggestKeyColumns(FIELDS, OLD, next);
  assert.deepEqual(found[0].columns, ['day']);
  const flat = [row('2026-05-01', 'A1', 1), row('2026-05-01', 'A2', 1), row('2026-05-02', 'A1', 1)];
  assert.deepEqual(suggestKeyColumns(FIELDS, flat, flat)[0].columns, ['day', 'tail']);
  const same = [row('2026-05-01', 'A1', 1), row('2026-05-01', 'A1', 1)];
  assert.deepEqual(suggestKeyColumns(FIELDS, same, same), []);
  assert.deepEqual(suggestKeyColumns(FIELDS, [], []), []);
});

test('підказка ключа знаходить трійку стовпців, коли немає ні одного, ні пари', () => {
  const fields = ['a', 'b', 'c'].map(key => ({ key, label: key, dataType: 'text' }));
  const rows = [];
  for (const a of ['0', '1']) for (const b of ['0', '1']) for (const c of ['0', '1']) rows.push({ a, b, c });
  assert.equal(new Set(rows.map(r => rowKey(r, ['a', 'b', 'c']))).size, 8);
  assert.deepEqual(suggestKeyColumns(fields, rows, rows).map(item => item.columns), [['a', 'b', 'c']]);
});

test('підказка ключа: ліміт кандидатів не обриває пошук перед першою трійкою, порожні стовпці пропускаються', () => {
  // Перші стовпці мають порожнечі або самі по собі нічого не розрізняють; трійка — лише в кінці.
  const keys = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'a', 'b', 'c'];
  const fields = keys.map(key => ({ key, label: key, dataType: 'text' }));
  const rows = [];
  for (const a of ['0', '1']) for (const b of ['0', '1']) for (const c of ['0', '1']) {
    rows.push({ n1: '', n2: 'x', n3: 'x', n4: a, n5: b, n6: 'y', a, b, c });
  }
  const found = suggestKeyColumns(fields, rows, rows);
  assert.ok(found.length >= 1);
  assert.deepEqual(found[0].columns.length, 3);
  assert.ok(found.every(item => !item.columns.includes('n1')), 'стовпець із порожнечами не береться');
  assert.ok(found.length <= 5);
  // Дубль рядка: ключа немає за жодної довжини.
  assert.deepEqual(suggestKeyColumns(fields, [...rows, rows[0]], [...rows, rows[0]]), []);
});

test('порівняння: додані, змінені, зниклі й незмінені рядки', () => {
  const next = [row('2026-05-01', 'A1', 2, 'x'), row('2026-05-02', 'A2', 5), row('2026-05-09', 'B9', 1)];
  const diff = diffRows({ fields: FIELDS, oldRows: OLD, newRows: next, keyColumns: KEY });
  assert.ok(diff.ok);
  assert.deepEqual(diff.counts, { added: 1, changed: 1, removed: 1, ambiguous: 0, unchanged: 1, unkeyedOld: 0, unkeyedNew: 0 });
  assert.deepEqual(diff.changed[0].changes, [{ field: 'qty', from: 4, to: 5, corrected: false }]);
  assert.equal(diff.added[0].row.tail, 'B9');
  assert.equal(diff.removed[0].row.tail, 'A3');
});

test('перестановка рядків у файлі нічого не змінює: відповідність не за порядком', () => {
  const diff = diffRows({ fields: FIELDS, oldRows: OLD, newRows: [...OLD].reverse(), keyColumns: KEY });
  assert.ok(diff.ok);
  assert.deepEqual([diff.counts.added, diff.counts.changed, diff.counts.removed, diff.counts.unchanged], [0, 0, 0, 3]);
});

test('без ключа, з чужим ключем чи з ключем, якого немає у файлі, порівняння не виконується', () => {
  const base = { fields: FIELDS, oldRows: OLD, newRows: OLD };
  assert.equal(diffRows({ ...base, keyColumns: [] }).code, 'no_key');
  assert.equal(diffRows({ ...base, keyColumns: ['id'] }).code, 'bad_key');
  assert.equal(diffRows({ ...base, keyColumns: ['x'] }).code, 'bad_key');
  assert.equal(diffRows({ ...base, keyColumns: ['day', 'tail', 'qty', 'note'] }).code, 'bad_key');
  const noTail = OLD.map(({ day, qty, note }) => ({ day, qty, note }));
  assert.equal(diffRows({ ...base, newRows: noTail, keyColumns: KEY }).code, 'key_missing');
  assert.equal(diffRows({ ...base, oldRows: null, keyColumns: KEY }).code, 'bad_input');
});

test('повторювані ключі — неоднозначні рядки, їх не зіставляють і не змінюють', () => {
  const twins = [row('2026-05-01', 'A1', 1), row('2026-05-01', 'A1', 2)];
  const diff = diffRows({ fields: FIELDS, oldRows: OLD, newRows: [...OLD.slice(1), ...twins], keyColumns: KEY });
  assert.ok(diff.ok);
  assert.equal(diff.counts.ambiguous, 1);
  assert.equal(diff.ambiguous[0].side, 'new');
  assert.equal(diff.counts.removed, 0);
  const applied = applyDiff(OLD, diff);
  assert.deepEqual(applied.rows.slice(0, 3), OLD);
});

test('рядки без ключа рахуються окремо й лишаються як були', () => {
  const blank = row('2026-05-07', '', 3);
  const diff = diffRows({ fields: FIELDS, oldRows: [...OLD, blank], newRows: [...OLD, row('', 'Z', 1)], keyColumns: KEY });
  assert.equal(diff.counts.unkeyedOld, 1);
  assert.equal(diff.counts.unkeyedNew, 1);
  assert.ok(applyDiff([...OLD, blank], diff).rows.includes(blank));
});

test('відсутній у файлі стовпець не робить значення зниклим', () => {
  const noNote = OLD.map(({ day, tail, qty }) => ({ day, tail, qty }));
  const diff = diffRows({ fields: FIELDS, oldRows: OLD, newRows: noNote, keyColumns: KEY });
  assert.ok(diff.ok);
  assert.equal(diff.counts.changed, 0);
  assert.ok(!diff.compared.includes('note'));
});

test('ручне виправлення переживає оновлення: у змінах воно позначено, значення лишається', () => {
  const fixed = new Set([correctionCell(rowKey(OLD[1], KEY), 'qty')]);
  const next = [OLD[0], { ...OLD[1], qty: 40, note: 'нове' }, OLD[2]];
  const diff = diffRows({ fields: FIELDS, oldRows: OLD, newRows: next, keyColumns: KEY, correctedCells: fixed });
  assert.equal(diff.keptCorrections, 1);
  const applied = applyDiff(OLD, diff);
  assert.equal(applied.rows[1].qty, 4);
  assert.equal(applied.rows[1].note, 'нове');
});

test('застосування: за замовчуванням зниклі лишаються, за вибором користувача видаляються; порядок зберігається', () => {
  const next = [row('2026-05-01', 'A1', 3, 'x'), row('2026-05-02', 'A2', 4), row('2026-05-09', 'B9', 1)];
  const diff = diffRows({ fields: FIELDS, oldRows: OLD, newRows: next, keyColumns: KEY });
  const keep = applyDiff(OLD, diff);
  assert.deepEqual(keep.rows.map(r => r.tail), ['A1', 'A2', 'A3', 'B9']);
  assert.equal(keep.rows[0].qty, 3);
  const drop = applyDiff(OLD, diff, { removed: 'remove' });
  assert.deepEqual(drop.rows.map(r => r.tail), ['A1', 'A2', 'B9']);
  assert.equal(applyDiff(OLD, diff, { removed: 'x' }).code, 'bad_policy');
  assert.equal(applyDiff(OLD, { ok: false }).code, 'bad_diff');
  assert.equal(OLD[0].qty, 2, 'вхідні рядки не змінюються');
});

test('показ обрізається до ліміту, а лічильники лишаються повними', () => {
  const many = Array.from({ length: 5 }, (_, i) => row(`2026-06-0${i + 1}`, `N${i}`, i));
  const diff = diffRows({ fields: FIELDS, oldRows: [], newRows: many, keyColumns: KEY });
  const cut = previewDiff(diff, 2);
  assert.equal(cut.added.length, 2);
  assert.equal(cut.counts.added, 5);
  assert.equal(cut.truncated, true);
  assert.equal(previewDiff({ ok: false, code: 'x' }).code, 'x');
});

test('ліміт рядків захищає від надто великих порівнянь', () => {
  const big = new Array(UPDATE_LIMITS.maxRows + 1).fill(OLD[0]);
  assert.equal(diffRows({ fields: FIELDS, oldRows: big, newRows: [], keyColumns: KEY }).code, 'too_many_rows');
});

test('ядро не звертається до DOM, Tauri, мережі, часу та випадковості', async () => {
  const source = await readFile(new URL('../src/table-update-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /document\.|window\.|invoke\(|fetch\(|Date\.now|new Date|Math\.random|localStorage/u);
});
