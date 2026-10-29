import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('панель оновлення користується лише наявними командами й пише через перевірку версії таблиці', async () => {
  const source = await read('dashboard-module-update.js');
  const commands = [...source.matchAll(/invoke\('([a-z_]+)'/gu)].map(match => match[1]);
  assert.deepEqual([...new Set(commands)].sort(), [
    'inspect_linked_module_source', 'pick_module_source', 'read_module_source_sheet', 'replace_dashboard_module_rows',
  ]);
  assert.match(source, /replaceRowsRequest\(module, /u);
  assert.match(source, /rowForStorage\(fields, row\)/u);
  // Без підтвердження користувача нічого не пишеться: єдиний виклик запису стоїть в apply().
  assert.equal((source.match(/invoke\('replace_dashboard_module_rows'/gu) || []).length, 1);
});

test('сторінка модуля монтує панель лише для таблиці, яку можна змінювати, і забуває огляд файла', async () => {
  const catalog = await read('dashboard-module-catalog.js');
  assert.match(catalog, /import \{ updatePanel \} from '\.\/dashboard-module-update\.js';/u);
  assert.match(catalog, /readOnly \? null : updatePanel\(\{/u);
  const panel = await read('dashboard-module-update.js');
  assert.match(panel, /release: true/u);
  assert.match(panel, /panel\.addEventListener\('toggle'/u);
});

test('панель не вигадує порожніх вузлів: replaceChildren отримує відфільтрований список', async () => {
  const panel = await read('dashboard-module-update.js');
  assert.match(panel, /\]\.filter\(Boolean\)\);/u);
});
