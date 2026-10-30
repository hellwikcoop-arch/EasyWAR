import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { listDefinitions } from '../src/module-definition-core.js';
import { confirmBinding, emptySchema } from '../src/profile-schema-core.js';
import { moduleSourceId, syncModuleSources } from '../src/profile-schema-modules-core.js';
import { blockCardModel, hasBlockCard } from '../src/module-block-card-core.js';
import { PRESETS, placePreset, planPreset, presetDefinitions, presetsFor } from '../src/module-preset-core.js';
import { emptyLayout, orderedIds } from '../src/module-instance-core.js';
import { ensureModuleInstances } from '../src/module-instance-modules-core.js';

// Лише синтетичні дані: вигадані стовпці й записи, жодних реальних таблиць.

const definitions = listDefinitions();
const SOURCE = moduleSourceId('main');
const tableModule = (fields = []) => ({ id: 'main', branch: 'rocket', templateId: 'user-table', title: 'Основна таблиця', fields });

test('шаблони містять лише блоки, що рахуються з основної таблиці, у порядку дашборда', () => {
  for (const preset of Object.values(PRESETS)) {
    for (const id of preset.blocks) assert.equal(hasBlockCard(id), true, id);
    assert.equal(presetDefinitions(preset, definitions).length, preset.blocks.length, `${preset.id}: усі блоки є в реєстрі`);
  }
  assert.equal(PRESETS.rv.blocks.length, 19);
  assert.equal(PRESETS.ps.blocks.length, 18, 'у ПС немає вогневих бригад');
  assert.deepEqual(PRESETS.rv.blocks.slice(-2), ['legacy:records-journal', 'legacy:data-quality'], 'журнал і перевірка — останніми');
  assert.equal(PRESETS.ps.blocks.includes('legacy:firing-units'), false);
  assert.deepEqual(PRESETS.rv.blocks.slice(0, 6).map(id => id.replace('legacy:rv-kpi-', '')), ['launches', 'munitions', 'destroyed', 'damaged', 'miss', 'unknown']);
  assert.deepEqual(presetsFor('air').map(item => item.id), ['ps', 'rv']);
  assert.deepEqual(presetsFor('rocket').map(item => item.id), ['rv', 'ps']);
  assert.deepEqual(presetDefinitions(PRESETS.rv, []), []);
});

test('без основної таблиці шаблон РВ створює її з усіма обов’язковими стовпцями без повторів', () => {
  const result = planPreset({ preset: PRESETS.rv, definitions });
  assert.equal(result.ok, true);
  assert.equal(result.missing.length, 19);
  assert.equal(result.done, false);
  const roles = result.plan.items.map(item => item.role);
  assert.equal(new Set(roles).size, roles.length, 'кожна роль — один стовпець');
  for (const role of ['event-date', 'munition-count', 'strike-result', 'platform-type', 'munition-type', 'firing-unit', 'unit', 'target-type', 'target-id', 'event-time']) {
    assert.ok(roles.includes(role), role);
  }
  assert.equal(roles[0], 'event-date', 'порядок — за першим блоком, що вимагає роль');
  assert.equal(result.plan.fields.length, roles.length);
  assert.deepEqual(result.plan.items.map(item => item.columnKey), roles.map((_, index) => `c${index + 1}`));
  assert.match(result.summary, /^поставить карток: 19; додасть: «/);
  assert.equal(roles.includes('record-issues'), false, 'перевірці окремий стовпець зауважень не потрібен');
  const ps = planPreset({ preset: PRESETS.ps, definitions });
  assert.equal(ps.plan.items.some(item => item.role === 'firing-unit'), false, 'ПС не просить стовпця вогневої бригади');
});

test('наявні стовпці зіставляються, а вже поставлені картки не дублюються', () => {
  const first = planPreset({ preset: PRESETS.rv, definitions });
  const fields = first.plan.fields.map((field, index) => ({ ...field, key: `c${index + 1}`, position: index }));
  const module = tableModule(fields);
  let schema = syncModuleSources(emptySchema('profile-card'), [module]).schema;
  for (const item of first.plan.items) schema = confirmBinding(schema, { sourceId: SOURCE, columnKey: item.columnKey, role: item.role }).schema;
  const table = { id: 'main', templateId: 'user-table', title: 'Основна таблиця', defaultSpan: 1 };
  let layout = ensureModuleInstances(emptyLayout('p1'), [table]).layout;
  const ready = planPreset({ preset: PRESETS.rv, definitions, schema, module, layout, sourceId: SOURCE });
  assert.equal(ready.plan.nothingToAdd, true);
  assert.equal(ready.summary, 'поставить карток: 19');
  const placed = placePreset(layout, { preset: PRESETS.rv, definitions: ready.definitions, sourceId: SOURCE, freshTable: true });
  assert.equal(placed.ok, true);
  assert.equal(placed.placed, 19);
  layout = placed.layout;
  const order = orderedIds(layout);
  assert.deepEqual(order.slice(0, 19).map(id => id.replace(/#\d+$/u, '')), PRESETS.rv.blocks, 'картки в порядку шаблону, таблиця — під ними');
  assert.equal(order.length, 20);
  const width = id => layout.placements.find(item => item.instanceId === id).w;
  assert.equal(width(order[0]), 4);
  assert.equal(width(order[6]), 6, 'карта — половина ширини');
  assert.equal(width(order[19]), 12, 'нова таблиця — на всю ширину');
  const again = planPreset({ preset: PRESETS.rv, definitions, schema, module, layout, sourceId: SOURCE });
  assert.equal(again.done, true);
  assert.equal(placePreset(layout, { preset: PRESETS.rv, definitions: again.definitions, sourceId: SOURCE }).placed, 0);
  // ПС поверх РВ на тій самій таблиці: усе вже стоїть, нових стовпців не треба.
  assert.equal(planPreset({ preset: PRESETS.ps, definitions, schema, module, layout, sourceId: SOURCE }).done, true);
});

test('у шаблоні ПС картка пусків підписана «Вильоти»', () => {
  const ps = planPreset({ preset: PRESETS.ps, definitions });
  const placed = placePreset(emptyLayout('p1'), { preset: PRESETS.ps, definitions: ps.definitions, sourceId: SOURCE });
  const launches = placed.layout.instances.find(item => item.definitionId === 'legacy:rv-kpi-launches');
  assert.equal(launches.title, 'Вильоти');
  const fields = ps.plan.fields.map((field, index) => ({ ...field, key: `c${index + 1}`, position: index }));
  const module = tableModule(fields);
  let schema = syncModuleSources(emptySchema('profile-card'), [module]).schema;
  for (const item of ps.plan.items) schema = confirmBinding(schema, { sourceId: SOURCE, columnKey: item.columnKey, role: item.role }).schema;
  const definition = definitions.find(item => item.definitionId === 'legacy:rv-kpi-launches');
  const date = ps.plan.items.find(item => item.role === 'event-date').columnKey;
  const rows = [{ [date]: '2026-09-01' }, { [date]: '2026-09-02' }];
  assert.equal(blockCardModel({ definition, schema, sourceId: SOURCE, rows, title: 'Вильоти' }).model.label, 'Вильоти');
  assert.equal(blockCardModel({ definition, schema, sourceId: SOURCE, rows, title: definition.title }).model.label, 'Пуски');
  assert.equal(blockCardModel({ definition, schema, sourceId: SOURCE, rows }).model.label, 'Пуски');
});

test('каталог показує розділ шаблонів і збирає одним записом стовпців і розкладки', async () => {
  const catalog = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(catalog, /presetPanel\(\{\n\s+el, presets: presetsFor\(state\.branch\)/);
  assert.match(catalog, /placePreset\(layout, \{ preset, definitions, sourceId, freshTable: !module \}\)/);
  assert.match(catalog, /title: placed\.instance\.title \}\)/);
  const panel = await readFile(new URL('../src/module-preset-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /'Так, зібрати'/);
  assert.doesNotMatch(panel, /innerHTML/);
});
