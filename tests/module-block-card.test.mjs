import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { listDefinitions } from '../src/module-definition-core.js';
import { confirmBinding, emptySchema } from '../src/profile-schema-core.js';
import { moduleSourceId, syncModuleSources } from '../src/profile-schema-modules-core.js';
import { RV_KPI_DEFINITIONS, agg, resKind } from '../src/module-adapters/rv-kpi-core.js';
import { CARD_PALETTES, blockCardModel, chartViews, hasBlockCard, placeBlockCard, rvRow } from '../src/module-block-card-core.js';
import { deltaTone } from '../src/module-block-card-view.js';
import { addInstance, emptyLayout, orderedIds } from '../src/module-instance-core.js';
import { ensureModuleInstances } from '../src/module-instance-modules-core.js';

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

test('шість карток РВ уміють рахуватися з основної таблиці, карта — ще ні', () => {
  for (const id of RV_KPI_DEFINITIONS) assert.equal(hasBlockCard(id), true, id);
  assert.equal(hasBlockCard('legacy:strike-map'), false);
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

test('картка показника має тон, кільце частки й плитки, як на вкладці РВ', () => {
  const schema = boundSchema();
  const card = id => blockCardModel({ definition: byId(id), schema, sourceId: SOURCE, rows }).model;
  const destroyed = card('legacy:rv-kpi-destroyed');
  assert.equal(destroyed.tone, 'green');
  assert.equal(destroyed.share, 33);
  assert.deepEqual(destroyed.tiles, [['Від пусків', '33%'], ['Макс. за добу', '1']]);
  const launches = card('legacy:rv-kpi-launches');
  assert.equal(launches.tone, 'blue');
  assert.equal(launches.share, null, 'у пусків немає кільця частки');
  assert.deepEqual(launches.tiles, [['Сер. за добу', '2,0'], ['Макс. за добу', '2']]);
  assert.equal(card('legacy:rv-kpi-miss').tone, 'red');
  assert.equal(card('legacy:rv-kpi-unknown').tone, 'grey');
  // Зміна «на краще»: для «Не уражено» краще, коли менше; «Не відомо» — нейтрально.
  assert.equal(deltaTone({ tone: 'green', delta: 20 }), 'good');
  assert.equal(deltaTone({ tone: 'red', delta: 20 }), 'bad');
  assert.equal(deltaTone({ tone: 'red', delta: -20 }), 'good');
  assert.equal(deltaTone({ tone: 'grey', delta: 20 }), 'neutral');
  assert.equal(deltaTone({ tone: 'blue', delta: null }), 'neutral');
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
  assert.match(catalog, /return dropTarget\(blockCardView\(\{/);
  assert.match(catalog, /placeBlockCard\(layout, \{ definition, sourceId, freshTable: !module \}\)/);
  // Налаштування звичайної картки на «Моєму дашборді» — за «⋯» разом із видаленням і структурою таблиці.
  assert.match(catalog, /el\('div', \{ class: 'ewmc-card-menu' \}, cardTools\(module, placed\), removeButton, confirmBox, schemaBox\)/);
  assert.match(catalog, /tools \? null : removeButton/);
  // Мала картка показника («Мала», 2 колонки з 12): лише підпис і число.
  const view = await readFile(new URL('../src/module-block-card-view.js', import.meta.url), 'utf8');
  assert.match(view, /const compact = kpi && placed\.width <= 3;/);
  assert.match(view, /kpiNode\(el, block\.model, palette, \{ compact, tools: toolsMenu\(el, tools\), period \}\)/);
  assert.match(catalog, /placeable: hasBlockCard\(definition\.definitionId\)/);
});

test('картка блока стає перед своєю основною таблицею; нова таблиця — на всю ширину', () => {
  const table = { id: 'main', templateId: 'user-table', title: 'Основна таблиця', defaultSpan: 1 };
  const other = { id: 'plan', templateId: 'custom', title: 'План', defaultSpan: 1 };
  const sourceId = moduleSourceId('main');
  let layout = ensureModuleInstances(emptyLayout('p1'), [other, table]).layout;
  const kpi = { definitionId: 'legacy:rv-kpi-launches', title: 'Пуски', visual: 'kpi' };
  const chart = { definitionId: 'legacy:result-distribution', title: 'Розподіл результатів', visual: 'donut' };
  let step = placeBlockCard(layout, { definition: kpi, sourceId, freshTable: true });
  assert.equal(step.ok, true);
  layout = step.layout;
  const tableId = layout.instances.find(item => item.sourceId === sourceId && item.definitionId !== kpi.definitionId).id;
  const width = id => layout.placements.find(item => item.instanceId === id).w;
  assert.deepEqual(orderedIds(layout).slice(-2), ['legacy:rv-kpi-launches#1', tableId]);
  assert.equal(width(tableId), 12);
  assert.equal(width('legacy:rv-kpi-launches#1'), 4);
  step = placeBlockCard(layout, { definition: chart, sourceId });
  layout = step.layout;
  assert.deepEqual(orderedIds(layout).slice(-3), ['legacy:rv-kpi-launches#1', 'legacy:result-distribution#1', tableId]);
  assert.equal(width('legacy:result-distribution#1'), 6);
  // Без картки таблиці в розкладці блок просто додається в кінець.
  const bare = placeBlockCard(emptyLayout('p1'), { definition: kpi, sourceId });
  assert.deepEqual(orderedIds(bare.layout), orderedIds(addInstance(emptyLayout('p1'), { definitionId: kpi.definitionId, sourceId, title: kpi.title }).layout));
});

// ---- блоки-діаграми спільних вкладок ПС і РВ ----

const wide = {
  id: 'main', branch: 'rocket', templateId: 'user-table', title: 'Основна таблиця',
  fields: ['Дата події', 'Результат ураження', 'Кількість боєприпасів', 'Тип боєприпасу', 'Підрозділ', 'Час події', 'Номер цілі', 'Тип носія']
    .map((label, index) => field(`c${index + 1}`, label, index === 0 ? 'date' : index === 2 ? 'integer' : 'text', index)),
};
const WIDE_ROLES = { c1: 'event-date', c2: 'strike-result', c3: 'munition-count', c4: 'munition-type', c5: 'unit', c6: 'event-time', c7: 'target-id', c8: 'platform-type' };
function wideSchema() {
  let schema = syncModuleSources(emptySchema('profile-card'), [wide]).schema;
  for (const [columnKey, role] of Object.entries(WIDE_ROLES)) schema = confirmBinding(schema, { sourceId: SOURCE, columnKey, role }).schema;
  return schema;
}
const UNITS = ['Альфа', 'Браво'];
const RESULTS = ['Знищено', 'Пошкоджено', 'Не уражено', 'Знищено', ''];
const wideRows = Array.from({ length: 12 }, (_, i) => ({
  c1: `2026-09-0${1 + (i % 3)}`, c2: RESULTS[i % RESULTS.length], c3: 1 + (i % 2), c4: i % 3 ? 'тип-а' : 'тип-б',
  c5: UNITS[i % 2], c6: `${String(6 + (i % 4)).padStart(2, '0')}:15`, c7: `Ц-${i % 4}`, c8: i % 2 ? 'носій-1' : 'носій-2',
}));
const chart = id => blockCardModel({ definition: byId(id), schema: wideSchema(), sourceId: SOURCE, rows: wideRows });

test('спільні блоки ПС і РВ малюються тими самими діаграмами, що й шаблони', () => {
  for (const id of ['legacy:result-distribution', 'legacy:result-dynamics', 'legacy:platform-types', 'legacy:munition-use', 'legacy:top-units', 'legacy:activity-by-day', 'legacy:hour-of-day', 'legacy:repeat-targets', 'legacy:target-types', 'legacy:firing-units']) {
    assert.equal(hasBlockCard(id), true, id);
  }
  for (const id of ['legacy:strike-map', 'legacy:strike-depth', 'legacy:data-quality', 'legacy:records-journal']) assert.equal(hasBlockCard(id), false, id);
  const donut = chart('legacy:result-distribution');
  assert.equal(donut.kind, 'donut');
  assert.equal(donut.model.total, 12);
  assert.deepEqual(Object.fromEntries(donut.model.slices.map(slice => [slice.label, slice.value])), { Знищено: 5, Пошкоджено: 3, 'Не уражено': 2, 'Не відомо': 2 });
  const dynamics = chart('legacy:result-dynamics').model;
  assert.equal(dynamics.kind, 'stacked-columns');
  assert.equal(dynamics.categories.length, 3, 'три дні');
  const munitions = chart('legacy:munition-use').model;
  assert.deepEqual(Object.fromEntries(munitions.categories.map((label, i) => [label, munitions.series[0].values[i]])), { 'ТИП-А': 12, 'ТИП-Б': 6 });
  const hours = chart('legacy:hour-of-day').model;
  assert.deepEqual(hours.categories, ['06:00', '07:00', '08:00', '09:00']);
  const repeat = chart('legacy:repeat-targets').model;
  assert.equal(repeat.categories.length, 4);
  assert.equal(chart('legacy:activity-by-day').model.kind, 'combo');
});

test('вид діаграми й колір картки вибираються; результати мають свої кольори', () => {
  assert.deepEqual(chartViews('legacy:result-distribution').map(item => item.id), ['donut', 'horizontal-bar', 'columns']);
  assert.deepEqual(chartViews('legacy:munition-use').map(item => item.id), ['horizontal-bar', 'donut', 'columns']);
  assert.deepEqual(chartViews('legacy:result-dynamics').map(item => item.label), ['Стовпчики', 'Лінії', 'Області']);
  assert.deepEqual(chartViews('legacy:activity-by-day').map(item => item.id), ['combo', 'columns', 'line']);
  assert.deepEqual(chartViews('legacy:rv-kpi-destroyed'), [], 'у показника вибору виду немає');
  assert.deepEqual(CARD_PALETTES.map(item => item.id), ['', 'branch', 'blue', 'green', 'amber', 'red']);
  const schema = boundSchema();
  const build = view => blockCardModel({ definition: byId('legacy:result-distribution'), schema, sourceId: SOURCE, rows, view });
  assert.equal(build('').kind, 'donut');
  assert.equal(build('columns').kind, 'columns');
  assert.equal(build('columns').model.kind, 'columns');
  assert.equal(build('radar').kind, 'donut', 'невідомий вид — типовий');
  // Знищено — зелений (3), не уражено — червоний (8), пошкоджено — бурштиновий (2), подавлено — жовтий (5).
  const slots = Object.fromEntries(build('').model.slices.map(slice => [slice.label, slice.slot]));
  assert.deepEqual(slots, { Знищено: 3, Пошкоджено: 2, 'Не уражено': 8, Подавлено: 5, 'Не відомо': 4 });
});

test('топ підрозділів: ефективність як на вкладках, лише підрозділи з 5+ записами', () => {
  const units = chart('legacy:top-units').model;
  // Альфа: індекси 0,2,4,6,8,10 → результати Знищено, Не уражено, '', Пошкоджено, Знищено, Знищено → (3 + 1) / 6.
  const value = name => units.series[0].values[units.categories.indexOf(name)];
  assert.equal(value('Альфа'), Math.round(4 / 6 * 100));
  const few = blockCardModel({ definition: byId('legacy:top-units'), schema: wideSchema(), sourceId: SOURCE, rows: wideRows.slice(0, 4) });
  assert.equal(few.model.empty, true);
});

test('блок-діаграма без потрібної ролі пояснює, чого бракує', () => {
  const result = blockCardModel({ definition: byId('legacy:firing-units'), schema: wideSchema(), sourceId: SOURCE, rows: wideRows });
  assert.equal(result.ok, false);
  assert.match(result.message, /Вогнева бригада/);
});
