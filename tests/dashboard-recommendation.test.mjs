import assert from 'node:assert/strict';
import test from 'node:test';
import { profileSource, proposeBindings, recommend } from '../src/dashboard-recommendation-core.js';
import { listDefinitions, psCatalogUsage } from '../src/module-definition-core.js';
import { CATALOG, KPI_TILES, VIEW_BY_BLOCK } from '../src/ps-kpi.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

const rustTemplates = await rustCatalog();
const definitions = listDefinitions({ rustTemplates, catalogs: [CATALOG],
  catalogUsage: psCatalogUsage(KPI_TILES, VIEW_BY_BLOCK) });
const row = (number, ...cells) => ({ number, cells });
const source = sheets => ({ sheets });
const sheet = (name, rows, extra = {}) => ({ name, rows, rowCount: rows.length, ...extra });
const book = source([sheet('Вигаданий журнал', [
  row(1, 'Назва', 'Категорія', 'Значення, шт', 'Дата', 'Інше значення, шт'),
  row(2, 'Запис А', 'Група А', 3, '2026-01-01', 5),
  row(3, 'Запис Б', 'Група Б', 4, '2026-01-02', 6),
])]);
const profile = profileSource(book, { sourceId: 'synthetic', sourceVersion: 'v1' });
const tableId = profile.tables[0].tableId;
const confirmations = [
  { tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
  { tableId, columnId: 'c2', role: 'category', fieldKey: 'category' },
  { tableId, columnId: 'c3', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  { tableId, columnId: 'c3', role: 'measure', fieldKey: 'primary_value', unit: 'шт', aggregation: 'sum' },
  { tableId, columnId: 'c4', role: 'event-date', fieldKey: 'period' },
  { tableId, columnId: 'c4', role: 'event-date', fieldKey: 'date' },
  { tableId, columnId: 'c5', role: 'measure', fieldKey: 'secondary_value', unit: 'шт', aggregation: 'sum' },
];
const options = { rustTemplates, catalogs: [CATALOG], confirmations };

test('з підтвердженої синтетичної таблиці виходять прості, комбіновані й складні варіанти', () => {
  const suggestions = recommend(profile, definitions, options);
  const ready = suggestions.filter(item => item.readiness === 'ready');
  assert.ok(ready.length >= 3);
  for (const id of ['kpi', 'line', 'columns', 'grouped-columns']) {
    const item = ready.find(entry => entry.definitionId === `rust-template:${id}`);
    assert.ok(item, id);
    assert.ok(item.requiredFields.every(field => !field.required || field.status === 'confirmed'));
    assert.ok(item.explanation.length > 1);
    assert.ok(item.id.includes('synthetic'));
  }
  assert.equal(ready.find(item => item.definitionId === 'rust-template:kpi').level, 'simple');
  assert.equal(ready.find(item => item.definitionId === 'rust-template:line').level, 'combined');
  assert.equal(ready.find(item => item.definitionId === 'rust-template:grouped-columns').level, 'complex');
  assert.equal(new Set(suggestions.map(item => item.id)).size, suggestions.length);
  assert.ok(suggestions.some(item => item.definitionId.startsWith('catalog-v1:')));
  assert.ok(suggestions.some(item => item.definitionId.startsWith('legacy:')));
});

test('гіпотези на основі назви й типу не стають підтвердженнями', () => {
  const proposed = proposeBindings(profile, { rustTemplates, catalogs: [CATALOG] });
  assert.ok(proposed.some(item => item.fieldKey === 'value' && item.bindingStatus === 'proposed'));
  assert.ok(proposed.some(item => item.role === 'event-date' && item.bindingStatus === 'proposed'));
  const suggestions = recommend(profile, definitions, { rustTemplates, catalogs: [CATALOG] });
  assert.ok(!suggestions.some(item => item.readiness === 'ready'));
  assert.equal(suggestions.find(item => item.definitionId === 'rust-template:kpi').readiness, 'needs_confirmation');
});

test('два підтверджені числові поля дають два різні KPI без дублікатів', () => {
  const suggestions = recommend(profile, definitions, { ...options, confirmations: [
    ...confirmations,
    { tableId, columnId: 'c5', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ] });
  const kpis = suggestions.filter(item => item.definitionId === 'rust-template:kpi' && item.readiness === 'ready');
  assert.equal(kpis.length, 2);
  assert.deepEqual(kpis.map(item => item.requiredFields.find(field => field.fieldKey === 'value').columnId).sort(), ['c3', 'c5']);
  assert.equal(new Set(kpis.map(item => item.id)).size, 2);
});

test('незнайомі назви можна зіставити вручну без автоматичного висновку', () => {
  const unknown = profileSource(source([sheet('Довільна', [
    row(1, 'Параметр X', 'Показник Y'), row(2, 'А', 12),
  ])]));
  const first = recommend(unknown, definitions, { rustTemplates });
  assert.equal(first.find(item => item.definitionId === 'rust-template:kpi').readiness, 'needs_confirmation');
  const id = unknown.tables[0].tableId;
  const confirmed = recommend(unknown, definitions, { rustTemplates, confirmations: [
    { tableId: id, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { tableId: id, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ] });
  assert.equal(confirmed.find(item => item.definitionId === 'rust-template:kpi').readiness, 'ready');
});

test('повторний аналіз має ті самі ID, порядок і вміст та не змінює джерело', () => {
  const before = JSON.stringify(book);
  const one = recommend(profileSource(book, { sourceId: 'synthetic', sourceVersion: 'v1' }), definitions, options);
  const two = recommend(profileSource(book, { sourceId: 'synthetic', sourceVersion: 'v1' }), definitions, options);
  assert.deepEqual(one, two);
  assert.equal(JSON.stringify(book), before);
});

test('дублікат заголовка і несумісні одиниці не стають ready', () => {
  const duplicate = profileSource(source([sheet('Дублікати', [
    row(1, 'Назва', 'Значення', 'Значення'), row(2, 'А', 2, 3),
  ])]));
  assert.equal(duplicate.tables[0].columns[1].bindingStatus, 'ambiguous');
  assert.ok(duplicate.tables[0].warnings.some(item => item.includes('Повторюється')));
  const conflicting = profileSource(source([sheet('Одиниці', [
    row(1, 'Назва', 'Відстань, м'), row(2, 'А', '3 км'), row(3, 'Б', '4 м'),
  ])]));
  assert.equal(conflicting.tables[0].columns[1].unitStatus, 'ambiguous');
  assert.ok(!recommend(conflicting, definitions, { rustTemplates }).some(item => item.readiness === 'ready'));
  const wrongUnit = recommend(profile, definitions, { ...options, confirmations: confirmations.map(item =>
    item.fieldKey === 'value' ? { ...item, unit: 'км' } : item) });
  const kpi = wrongUnit.find(item => item.definitionId === 'rust-template:kpi');
  assert.equal(kpi.readiness, 'needs_confirmation');
  assert.ok(kpi.warnings.some(item => item.includes('не збігається')));
});

test('числовий serial Excel без формату дати лишається числом, а формула без кешу порожньою', () => {
  const uncertain = profileSource(source([sheet('Дати', [
    row(1, 'Можлива дата', 'Формула'), row(2, 46000, null),
  ])]));
  assert.equal(uncertain.tables[0].columns[0].type, 'number');
  assert.equal(uncertain.tables[0].columns[1].type, 'unknown');
  assert.ok(!recommend(uncertain, definitions, { rustTemplates }).some(item => item.readiness === 'ready'));
});

test('порожні, приховані та частково прочитані аркуші мають чесний стан', () => {
  const empty = profileSource(source([sheet('Порожній', [])]));
  assert.equal(empty.tables[0].empty, true);
  assert.ok(recommend(empty, definitions, { rustTemplates }).every(item => item.readiness !== 'ready'));
  const sampled = profileSource(source([
    { name: 'Прихований', state: 'hidden', sample: [row(1, 'Таємний')], rowCount: 1 },
    { name: 'Видимий', sample: [row(1, 'Назва', 'Значення'), row(2, 'А', 2)], rowCount: 10 },
  ]));
  assert.equal(sampled.tables.length, 1);
  assert.equal(sampled.tables[0].truncated, true);
  assert.equal(sampled.tables[0].rowCountKnown, null);
  assert.ok(recommend(sampled, definitions, { rustTemplates }).every(item => item.readiness !== 'ready'));
});

test('без явної цілі gauge та інші індикатори плану не доступні', () => {
  const suggestions = recommend(profile, definitions, options);
  for (const id of ['gauge', 'radial-progress', 'multi-ring', 'progress-bars']) {
    assert.notEqual(suggestions.find(item => item.definitionId === `rust-template:${id}`).readiness, 'ready');
  }
});

test('два відокремлені діапазони в одному аркуші та різні аркуші не змішуються', () => {
  const result = profileSource(source([
    sheet('Один', [row(1, 'Назва', 'Значення'), row(2, 'А', 1), row(5, 'Категорія', 'Кількість'), row(6, 'Б', 2)]),
    sheet('Два', [row(1, 'Назва', 'Значення'), row(2, 'В', 3)]),
  ]));
  assert.equal(result.tables.length, 3);
  assert.equal(new Set(result.tables.map(item => item.tableId)).size, 3);
  assert.deepEqual(result.tables.map(item => item.rowCountKnown), [1, 1, 1]);
});
