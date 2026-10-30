import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { listDefinitions } from '../src/module-definition-core.js';
import { confirmBinding, emptySchema } from '../src/profile-schema-core.js';
import { moduleSourceId, syncModuleSources } from '../src/profile-schema-modules-core.js';
import { RV_KPI_DEFINITIONS, agg, resKind } from '../src/module-adapters/rv-kpi-core.js';
import { blockCardModel, hasBlockCard, rvRow } from '../src/module-block-card-core.js';

// Лише синтетичні дані: вигадані записи, жодних реальних таблиць.

const definitions = listDefinitions();
const byId = id => definitions.find(item => item.definitionId === id);
const field = (key, label, dataType = 'text', position = 0) => ({ key, label, dataType, position });
const main = { id: 'main', branch: 'rocket', templateId: 'user-table', title: 'Основна таблиця', fields: [field('c1', 'Дата події', 'date'), field('c2', 'Результат ураження', 'text', 1), field('c3', 'Кількість боєприпасів', 'integer', 2)] };
const SOURCE = moduleSourceId('main');

function boundSchema(roles = { c1: 'event-date', c2: 'strike-result', c3: 'munition-count' }) {
  let schema = syncModuleSources(emptySchema('profile-card'), [main]).schema;
  for (const [columnKey, role] of Object.entries(roles)) schema = confirmBinding(schema, { sourceId: SOURCE, columnKey, role }).schema;
  return schema;
}

const rows = [
  { c1: '2026-09-01', c2: 'Знищено', c3: 2 },
  { c1: '2026-09-01', c2: 'Пошкоджено', c3: 1 },
  { c1: '2026-09-02', c2: 'Не уражено', c3: 3 },
  { c1: '2026-09-02', c2: 'Подавлено', c3: '4 шт' },
  { c1: '2026-09-03', c2: 'знищено повністю', c3: 1 },
  { c1: '2026-09-03', c2: '', c3: null },
];

test('шість карток РВ уміють рахуватися з основної таблиці, інші блоки — ще ні', () => {
  for (const id of RV_KPI_DEFINITIONS) assert.equal(hasBlockCard(id), true, id);
  assert.equal(hasBlockCard('legacy:result-dynamics'), false);
  assert.equal(hasBlockCard(undefined), false);
});

test('числа карток збігаються з ядром РВ на тих самих записах', () => {
  const schema = boundSchema();
  const value = id => blockCardModel({ definition: byId(id), schema, sourceId: SOURCE, rows }).model;
  assert.equal(value('legacy:rv-kpi-launches').value, 6);
  assert.equal(value('legacy:rv-kpi-munitions').value, 11);
  assert.equal(value('legacy:rv-kpi-destroyed').value, 2);
  assert.equal(value('legacy:rv-kpi-destroyed').unit, '33% від пусків');
  assert.equal(value('legacy:rv-kpi-damaged').value, 2);
  assert.equal(value('legacy:rv-kpi-miss').value, 1);
  assert.equal(value('legacy:rv-kpi-unknown').value, 1);
  // Той самий результат, що й agg над рядками моделі РВ.
  const A = agg(rows.map(row => rvRow({ 'event-date': row.c1, 'strike-result': row.c2, 'munition-count': row.c3 })));
  assert.equal(A.destroyed, 2);
  assert.equal(A.mun, 11);
  const munitions = value('legacy:rv-kpi-munitions');
  assert.equal(munitions.kind, 'kpi');
  assert.equal(munitions.unit, '1,8 БП на пуск');
  assert.deepEqual(munitions.history, [3, 7, 1], 'міні-графік — за днями');
});

test('без зіставлених ролей картка пояснює, чого бракує, і нічого не вигадує', () => {
  const schema = boundSchema({ c1: 'event-date' });
  const result = blockCardModel({ definition: byId('legacy:rv-kpi-destroyed'), schema, sourceId: SOURCE, rows });
  assert.equal(result.ok, false);
  assert.match(result.message, /Результат ураження/);
  assert.equal(blockCardModel({ definition: byId('legacy:rv-kpi-destroyed'), schema: null, sourceId: SOURCE, rows }).ok, false);
  assert.equal(blockCardModel({ definition: byId('legacy:result-dynamics'), schema, sourceId: SOURCE, rows }).ok, false);
});

test('порожня таблиця: нуль без примітки', () => {
  const result = blockCardModel({ definition: byId('legacy:rv-kpi-destroyed'), schema: boundSchema(), sourceId: SOURCE, rows: [] });
  assert.equal(result.ok, true);
  assert.equal(result.model.valueText, '0');
  assert.equal(result.model.empty, true);
  assert.equal(result.model.unit, '');
});

test('рядок моделі РВ: дата, відбій, кількість, тип цілі', () => {
  const row = rvRow({ 'event-date': '2026-09-01T10:00', 'strike-result': 'Відбій', 'munition-count': '3', 'target-type': 'склад, техніка', 'abort-flag': '' });
  assert.equal(row.date, '2026-09-01');
  assert.equal(row.abort, true);
  assert.equal(row.count, 3);
  assert.deepEqual(row.types, ['склад', 'техніка']);
  assert.equal(rvRow({ 'abort-flag': 'так' }).abort, true);
  assert.equal(rvRow({ 'abort-flag': 'ні' }).abort, false);
  assert.equal(rvRow({ 'event-date': '01.09.2026' }).date, '');
});

test('resKind ядра — дослівно та сама функція, що в rocket.html', async () => {
  const html = await readFile(new URL('../src/rocket.html', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/module-adapters/rv-kpi-core.js', import.meta.url), 'utf8');
  const body = source => /function resKind\(s\) \{[\s\S]*?\n\}/.exec(source)?.[0];
  assert.ok(body(html));
  assert.equal(body(core), body(html));
  assert.deepEqual(['Знищено', 'частково', 'Не уражено', 'Подавлено', '', 'інше'].map(resKind), ['hit', 'part', 'miss', 'part', 'unk', 'unk']);
});

test('каталог малює картку блока з основної таблиці й ставить її після додавання', async () => {
  const catalog = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(catalog, /block \? blockVisual\(block\) : visual\(module, rows\)/);
  assert.match(catalog, /addInstance\(layout, \{ definitionId: definition\.definitionId, sourceId/);
  assert.match(catalog, /placeable: hasBlockCard\(definition\.definitionId\)/);
});
