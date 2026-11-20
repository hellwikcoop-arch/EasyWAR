import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ROWS_PER_CHANGE, authorLine, buildTable, changeOperation, changeTime, checkColumns,
  diffTable, emptyValues, newRowKey, parseColumns, previewSummary, refreshText,
} from '../src/workspace/collectives/table-data-core.js';

const COLUMNS = ['Підрозділ', 'Стан'];
const data = {
  fingerprint: 'T4BHQ9ZP2K',
  title: 'Облік (синтетичний)',
  columns: COLUMNS,
  rejected: 0,
  changes: [
    { author: 'R7CCJ4JMWH', authorName: 'Синтетик Петро', mine: true, clientTime: 1_761_780_600,
      rows: [{ key: 'r1', kind: 'upsert', values: { 'Підрозділ': '1 рота', 'Стан': 'готова' } },
        { key: 'r2', kind: 'upsert', values: { 'Підрозділ': '2 рота' } }] },
    { author: 'M3XQ7PL2ZD', authorName: 'Синтетик Іван', mine: false, clientTime: 1_761_784_200,
      rows: [{ key: 'r1', kind: 'upsert', values: { 'Підрозділ': '1 рота', 'Стан': 'на марші' } },
        { key: 'r2', kind: 'delete' }] },
  ],
};

test('стовпці: через кому чи з нового рядка, без повторів і задовгих назв', () => {
  assert.deepEqual(parseColumns(' Підрозділ, Стан\nПримітка;  '), ['Підрозділ', 'Стан', 'Примітка']);
  assert.deepEqual(parseColumns(''), []);
  assert.throws(() => parseColumns('Стан, Стан'), /повторюється/);
  assert.throws(() => parseColumns('я'.repeat(41)), /від 1 до 40/);
  assert.throws(() => parseColumns(Array.from({ length: 33 }, (_, i) => `с${i}`).join(',')), /не більше 32/);
  assert.throws(() => checkColumns(['а\u0007']), /керівних/);
});

test('стан таблиці: пакети застосовуються по черзі, upsert замінює рядок, delete прибирає', () => {
  const built = buildTable(data);
  assert.equal(built.packages, 2);
  assert.deepEqual(built.rows.map(row => [row.key, row.values]), [['r1', { 'Підрозділ': '1 рота', 'Стан': 'на марші' }]]);
  assert.equal(built.rows[0].by.authorName, 'Синтетик Іван');
  assert.equal(authorLine(built.rows[0].by), 'Синтетик Іван (M3XQ7PL2ZD)');
  assert.equal(authorLine({ mine: true }), 'ви');
  assert.equal(authorLine({ author: 'B9WTK4RRCE', authorName: null }), 'учасник B9WTK4RRCE');
  assert.equal(changeTime(1_761_784_200), '30.10.2025 00:30 UTC');
  assert.deepEqual(buildTable(null), { columns: [], rows: [], packages: 0 });
});

test('«було → стане»: нові, змінені й видалені рядки; порожній новий рядок пропускається', () => {
  const base = [
    { key: 'r1', values: { 'Підрозділ': '1 рота', 'Стан': 'готова' } },
    { key: 'r2', values: { 'Підрозділ': '2 рота', 'Стан': '' } },
  ];
  const edited = [
    { key: 'r1', values: { 'Підрозділ': '1 рота', 'Стан': 'на марші' } },
    { key: 'r3', values: { 'Підрозділ': '3 рота', 'Стан': '' } },
    { key: 'r4', values: emptyValues(COLUMNS) },
  ];
  const preview = diffTable(base, edited, COLUMNS);
  assert.deepEqual(preview.map(item => [item.key, item.kind, item.changed]), [
    ['r1', 'changed', ['Стан']],
    ['r3', 'new', ['Підрозділ']],
    ['r2', 'deleted', []],
  ]);
  assert.equal(previewSummary(preview), 'нових рядків: 1, змінених: 1, видалених: 1');
  assert.equal(previewSummary([]), 'змін немає');
  assert.deepEqual(diffTable(base, base, COLUMNS), []);

  // У пакет іде весь рядок; порожні клітинки не передаються.
  const op = JSON.parse(changeOperation(preview, COLUMNS));
  assert.deepEqual(op, { v: 1, rows: [
    { key: 'r1', kind: 'upsert', values: { 'Підрозділ': '1 рота', 'Стан': 'на марші' } },
    { key: 'r3', kind: 'upsert', values: { 'Підрозділ': '3 рота' } },
    { key: 'r2', kind: 'delete' },
  ] });
});

test('операція доповіді: ті самі межі, що й у Rust', () => {
  assert.throws(() => changeOperation([], COLUMNS), /Змін немає/);
  const many = Array.from({ length: MAX_ROWS_PER_CHANGE + 1 }, (_, i) => ({ key: `r${i}`, kind: 'deleted' }));
  assert.throws(() => changeOperation(many, COLUMNS), /не більше 500/);
  const bad = [{ key: 'r1', kind: 'new', after: { 'Стан': 'а\u0000б' } }];
  assert.throws(() => changeOperation(bad, COLUMNS), /керівних/);
  const tabbed = [{ key: 'r1', kind: 'new', after: { 'Стан': 'рядок 1\nрядок 2\tкінець' } }];
  assert.doesNotThrow(() => changeOperation(tabbed, COLUMNS));
  const long = [{ key: 'r1', kind: 'new', after: { 'Стан': 'я'.repeat(1001) } }];
  assert.throws(() => changeOperation(long, COLUMNS), /до 1000/);
  const big = Array.from({ length: 70 }, (_, i) => ({ key: `r${i}`, kind: 'new', after: { 'Стан': 'я'.repeat(1000) } }));
  assert.throws(() => changeOperation(big, COLUMNS), /64 КіБ/);
});

test('ключ нового рядка — з випадкових байтів; повтор не приймається', () => {
  const bytes = n => Uint8Array.from({ length: n }, (_, i) => i + 1);
  assert.equal(newRowKey(bytes), 'r-0102030405060708');
  assert.throws(() => newRowKey(bytes, new Set(['r-0102030405060708'])), /ключ рядка/);
});

test('«Оновити таблицю»: скільки пакетів, скільки нових і скільки відхилено', () => {
  assert.equal(refreshText(data, null), 'Пакетів змін: 2, таблицю завантажено.');
  assert.equal(refreshText(data, 1), 'Пакетів змін: 2, нових з минулого оновлення: 1.');
  assert.equal(refreshText(data, 2), 'Пакетів змін: 2, нових немає.');
  assert.equal(refreshText({ ...data, rejected: 1 }, 2), 'Пакетів змін: 2, нових немає, не пройшли перевірку й не застосовані: 1.');
});
