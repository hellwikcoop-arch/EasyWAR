// «Колектив (демо)» — S1 Sync MVP: сценарій двох ізольованих клієнтів у пам'яті (синтетика).
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  CLIENTS,
  COLUMNS,
  DEMO_NOTICE,
  canWrite,
  confirmReport,
  conflictsOf,
  createDemo,
  dashboardSeries,
  editRow,
  openReport,
  redeliver,
  resolve,
  setWriteRight,
  synchronize,
  visibleRows,
} from '../src/workspace/collective-demo/collective-demo-core.js';

const row = (demo, client, key) => visibleRows(demo, client).find(item => item.rowKey === key);
const report = (demo, client) => {
  const opened = openReport(demo, client);
  assert.equal(opened.ok, true, opened.reason);
  return { preview: opened.preview, result: confirmReport(demo, client) };
};

test('обидва клієнти стартують з однаковою синтетичною таблицею', () => {
  const demo = createDemo();
  assert.deepEqual(visibleRows(demo, 'A'), visibleRows(demo, 'B'));
  assert.equal(visibleRows(demo, 'A').length, 4);
  assert.deepEqual(Object.keys(row(demo, 'A', 'r1').values).sort(), [...COLUMNS].sort());
  assert.match(DEMO_NOTICE, /без мережі та збереження/u);
});

test('А змінює рядок → «Доповісти» показує «було → стане» → Б «Звірити» → таблиця й дашборд Б оновлені', () => {
  const demo = createDemo();
  const before = dashboardSeries(demo, 'B').find(item => item.label === 'Підрозділ-2').value;
  assert.equal(editRow(demo, 'A', 'r2', { amount: '9' }).ok, true);
  const { preview, result } = report(demo, 'A');
  assert.equal(preview.items.length, 1);
  assert.deepEqual(preview.items[0].diff.changed, ['amount']);
  assert.equal(preview.items[0].diff.before.amount, 7);
  assert.equal(preview.items[0].diff.after.amount, 9);
  assert.equal(result.ok, true);
  assert.equal(row(demo, 'B', 'r2').values.amount, 7, 'до «Звірити» Б нічого не отримав');
  const summary = synchronize(demo, 'B');
  assert.deepEqual({ applied: summary.applied, conflicts: summary.conflicts, rejected: summary.rejected }, { applied: 1, conflicts: 0, rejected: 0 });
  assert.equal(row(demo, 'B', 'r2').values.amount, 9);
  assert.equal(row(demo, 'B', 'r2').author, CLIENTS.A.memberId);
  assert.equal(dashboardSeries(demo, 'B').find(item => item.label === 'Підрозділ-2').value, before + 2);
  assert.deepEqual(visibleRows(demo, 'A'), visibleRows(demo, 'B'));
  assert.equal(demo.clients.B.log[0].status, 'applied');
});

test('повторна доставка того самого пакета не застосовується вдруге', () => {
  const demo = createDemo();
  editRow(demo, 'A', 'r3', { amount: 21 });
  report(demo, 'A');
  synchronize(demo, 'B');
  const version = row(demo, 'B', 'r3').version;
  const again = redeliver(demo, 'B');
  assert.deepEqual({ applied: again.applied, skipped: again.skipped }, { applied: 0, skipped: 1 });
  assert.equal(row(demo, 'B', 'r3').version, version);
  assert.equal(synchronize(demo, 'B').received, 0, 'нових змін немає');
});

test('дві правки одного рядка → конфлікт без мовчазного перезапису; рішення йде через «Доповісти»', () => {
  const demo = createDemo();
  editRow(demo, 'A', 'r1', { amount: 30 });
  editRow(demo, 'B', 'r1', { amount: 40 });
  report(demo, 'A');
  report(demo, 'B');
  const atB = synchronize(demo, 'B');
  assert.equal(atB.conflicts, 1);
  assert.equal(row(demo, 'B', 'r1').values.amount, 40, 'своє значення Б не затерто');
  const [conflict] = conflictsOf(demo, 'B');
  assert.equal(conflict.theirs.amount, 30);
  assert.equal(conflict.mine.amount, 40);
  const decided = resolve(demo, 'B', conflict.conflictId, 'take-theirs');
  assert.equal(decided.ok, true, decided.reason);
  assert.equal(conflictsOf(demo, 'B').length, 1, 'конфлікт закривається лише разом із застосуванням рішення');
  const { result } = report(demo, 'B');
  assert.equal(result.ok, true, result.reason);
  assert.equal(conflictsOf(demo, 'B').length, 0);
  assert.equal(row(demo, 'B', 'r1').values.amount, 30);
  const atA = synchronize(demo, 'A');
  assert.equal(atA.conflicts, 1, 'перша правка Б для А — теж конфлікт, не перезапис');
  assert.equal(row(demo, 'A', 'r1').values.amount, 30);
});

test('без права запису «Доповісти» відмовляє з поясненням', () => {
  const demo = createDemo();
  setWriteRight(demo, 'B', false);
  assert.equal(canWrite(demo, 'B'), false);
  editRow(demo, 'B', 'r4', { amount: 6 });
  const opened = openReport(demo, 'B');
  assert.equal(opened.ok, false);
  assert.equal(opened.code, 'no-write-right');
  assert.match(opened.reason, /права/u);
  assert.equal(setWriteRight(demo, 'A', false).ok, false, 'власника не позбавити права');
});

test('після відкликання права отримувач відхиляє операцію відкликаного автора', () => {
  const demo = createDemo();
  editRow(demo, 'B', 'r4', { amount: 6 });
  report(demo, 'B');
  setWriteRight(demo, 'B', false);
  const atA = synchronize(demo, 'A');
  assert.deepEqual({ applied: atA.applied, rejected: atA.rejected }, { applied: 0, rejected: 1 });
  assert.equal(row(demo, 'A', 'r4').values.amount, 5);
  assert.match(demo.clients.A.log[0].text, /немає права запису/u);
});

test('ізоляція S1: без мережі, Tauri, профілів, бази й сховищ браузера; ядра C1 не дублюються', async () => {
  const dir = new URL('../src/workspace/collective-demo/', import.meta.url);
  const files = (await readdir(dir)).filter(name => name.endsWith('.js'));
  assert.ok(files.includes('app.js') && files.includes('collective-demo-core.js'));
  for (const name of files) {
    const text = await readFile(new URL(name, dir), 'utf8');
    for (const forbidden of [/localStorage/u, /sessionStorage/u, /indexedDB/u, /__TAURI/u, /\binvoke\(/u, /\bfetch\(/u, /WebSocket/u, /XMLHttpRequest/u, /workspace-host/u]) {
      assert.doesNotMatch(text, forbidden, `${name}: ${forbidden}`);
    }
  }
  const core = await readFile(new URL('collective-demo-core.js', dir), 'utf8');
  assert.match(core, /from '\.\.\/\.\.\/shared-table-core\.js'/u);
  assert.match(core, /from '\.\.\/\.\.\/report-submission-core\.js'/u);
  assert.match(core, /from '\.\.\/\.\.\/sync-policy-core\.js'/u);
  assert.doesNotMatch(core, /function (applyOperation|previewReport|commitReport|diffRows)\b/u);
  const app = await readFile(new URL('app.js', dir), 'utf8');
  assert.match(app, /DEMO_NOTICE/u);
});
