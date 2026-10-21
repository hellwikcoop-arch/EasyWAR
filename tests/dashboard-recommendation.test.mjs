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
const withHeader = (workbook, { sourceId = 'preview', sourceVersion = 'unversioned',
  sheetIndex = 0, headerRow = 1, boundaryConfirmations = [] } = {}) => {
  const first = profileSource(workbook, { sourceId, sourceVersion });
  return profileSource(workbook, { sourceId, sourceVersion,
    headerConfirmations: [{ sourceKey: first.sourceKey, sheetIndex, headerRow }],
    boundaryConfirmations });
};
const book = source([sheet('Вигаданий журнал', [
  row(1, 'Назва', 'Категорія', 'Значення, шт', 'Дата', 'Інше значення, шт'),
  row(2, 'Запис А', 'Група А', 3, '2026-01-01', 5),
  row(3, 'Запис Б', 'Група Б', 4, '2026-01-02', 6),
])]);
const profile = withHeader(book, { sourceId: 'synthetic', sourceVersion: 'v1' });
const tableId = profile.tables[0].tableId;
const confirmations = [
  { tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
  { tableId, columnId: 'c2', role: 'category', fieldKey: 'category' },
  { tableId, columnId: 'c3', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  { tableId, columnId: 'c3', role: 'measure', fieldKey: 'primary_value', unit: 'шт', aggregation: 'sum' },
  { tableId, columnId: 'c4', role: 'event-date', fieldKey: 'period' },
  { tableId, columnId: 'c4', role: 'event-date', fieldKey: 'date' },
  { tableId, columnId: 'c5', role: 'measure', fieldKey: 'secondary_value', unit: 'шт', aggregation: 'sum' },
].map(item => ({ sourceKey: profile.sourceKey, ...item }));
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
    { sourceKey: profile.sourceKey, tableId, columnId: 'c5', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ] });
  const kpis = suggestions.filter(item => item.definitionId === 'rust-template:kpi' && item.readiness === 'ready');
  assert.equal(kpis.length, 2);
  assert.deepEqual(kpis.map(item => item.requiredFields.find(field => field.fieldKey === 'value').columnId).sort(), ['c3', 'c5']);
  assert.equal(new Set(kpis.map(item => item.id)).size, 2);
});

test('незнайомі назви можна зіставити вручну без автоматичного висновку', () => {
  const unknown = withHeader(source([sheet('Довільна', [
    row(1, 'Параметр X', 'Показник Y'), row(2, 'А', 12),
  ])]));
  const first = recommend(unknown, definitions, { rustTemplates });
  assert.equal(first.find(item => item.definitionId === 'rust-template:kpi').readiness, 'needs_confirmation');
  const id = unknown.tables[0].tableId;
  const confirmed = recommend(unknown, definitions, { rustTemplates, confirmations: [
    { sourceKey: unknown.sourceKey, tableId: id, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { sourceKey: unknown.sourceKey, tableId: id, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ] });
  assert.equal(confirmed.find(item => item.definitionId === 'rust-template:kpi').readiness, 'ready');
});

test('повторний аналіз має ті самі ID, порядок і вміст та не змінює джерело', () => {
  const before = JSON.stringify(book);
  const one = recommend(withHeader(book, { sourceId: 'synthetic', sourceVersion: 'v1' }), definitions, options);
  const two = recommend(withHeader(book, { sourceId: 'synthetic', sourceVersion: 'v1' }), definitions, options);
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

test('catalogAliasCollision: усі смислові альтернативи та їхнє походження збережено', () => {
  const workbook = source([sheet('Синтетика', [row(1, 'Спільна назва'), row(2, 'Умовне значення')])]);
  const local = withHeader(workbook);
  const catalog = { id: 'collision', columns: [
    { id: 'col.munition', labels: ['Спільна назва'] },
    { id: 'col.result', labels: ['Спільна назва'] },
  ] };
  const bindings = proposeBindings(local, { catalogs: [catalog] });
  const alternatives = bindings.filter(item => ['col.munition', 'col.result'].includes(item.fieldKey));
  assert.deepEqual(alternatives.map(item => item.role).sort(), ['munition-type', 'strike-result']);
  assert.ok(alternatives.every(item => item.bindingStatus === 'ambiguous'));
  assert.ok(alternatives.every(item => item.origins.some(origin => origin.kind === 'catalog-v1'
    && origin.catalogId === 'collision')));
  const reversed = proposeBindings(local, { catalogs: [{ ...catalog, columns: [...catalog.columns].reverse() }] });
  assert.deepEqual(reversed.filter(item => ['col.munition', 'col.result'].includes(item.fieldKey)), alternatives);
});

test('rustAliasCollision: обидва поля доступні для окремого підтвердження', () => {
  const template = { id: 'collision-probe', title: 'Синтетичне порівняння', visualKind: 'grouped-columns', fields: [
    { key: 'first', label: 'Те саме', role: 'metric', dataType: 'real', required: true, aggregation: 'sum' },
    { key: 'second', label: 'Те саме', role: 'metric', dataType: 'real', required: true, aggregation: 'sum' },
  ] };
  const local = withHeader(source([sheet('Два показники', [
    row(1, 'Те саме', 'Те саме'), row(2, 4, 5),
  ])]));
  const guesses = proposeBindings(local, { rustTemplates: [template] })
    .filter(item => item.definitionId === 'rust-template:collision-probe');
  assert.deepEqual([...new Set(guesses.map(item => item.fieldKey))].sort(), ['first', 'second']);
  assert.equal(guesses.length, 4);
  assert.ok(guesses.every(item => item.bindingStatus === 'ambiguous'
    && item.origins.some(origin => origin.kind === 'rust-alias-collision')));
  const customDefinitions = listDefinitions({ rustTemplates: [template], legacy: [] });
  const confirmed = [
    { sourceKey: local.sourceKey, tableId: local.tables[0].tableId, columnId: 'c1',
      role: 'measure', fieldKey: 'first', unit: 'шт', aggregation: 'sum' },
    { sourceKey: local.sourceKey, tableId: local.tables[0].tableId, columnId: 'c2',
      role: 'measure', fieldKey: 'second', unit: 'шт', aggregation: 'sum' },
  ];
  const result = recommend(local, customDefinitions, { rustTemplates: [template], confirmations: confirmed });
  assert.equal(result[0].readiness, 'ready');
  assert.deepEqual(result[0].requiredFields.map(item => item.columnId), ['c1', 'c2']);
});

test('один порожній рядок усередині таблиці не відкидає наступний запис', () => {
  const workbook = source([sheet('Пропуск', [
    row(1, 'Назва', 'Значення'), row(2, 'А', 1), row(4, 'Б', 2),
  ])]);
  const local = withHeader(workbook);
  assert.equal(local.tables.length, 1);
  assert.deepEqual(local.tables[0].rowCoverage.sourceRowNumbers, [1, 2, 4]);
  assert.deepEqual(local.tables[0].rowCoverage.dataRowNumbers, [2, 4]);
  assert.equal(local.tables[0].rowCountKnown, 2);
  assert.ok(local.tables[0].warnings.some(item => item.includes('Порожній рядок')));
  const tableId = local.tables[0].tableId;
  const result = recommend(local, definitions, { rustTemplates, confirmations: [
    { sourceKey: local.sourceKey, tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { sourceKey: local.sourceKey, tableId, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ] });
  assert.equal(result.find(item => item.definitionId === 'rust-template:kpi').readiness, 'ready');
});

test('один пропуск між текстовими записами сам по собі не розділяє таблицю', () => {
  const workbook = source([sheet('Текстові записи', [
    row(1, 'Назва', 'Категорія'), row(2, 'А', 'Перша'),
    row(4, 'Б', 'Друга'), row(5, 'В', 'Третя'),
  ])]);
  const local = profileSource(workbook);
  assert.equal(local.tables.length, 1);
  assert.deepEqual(local.tables[0].rowCoverage.dataRowNumbers, [2, 4, 5]);
  assert.equal(local.boundaryProposals[0].appliedAction, 'join');
  assert.equal(local.boundaryProposals[0].status, 'needs_confirmation');
});

test('явно порожній рядок залишається в охопленні профілю', () => {
  const local = profileSource(source([sheet('Порожній рядок', [
    row(1, 'Назва', 'Значення'), row(2, 'А', 1), row(3, null, ''), row(4, 'Б', 2),
  ])]));
  assert.deepEqual(local.tables[0].rowCoverage.sourceRowNumbers, [1, 2, 3, 4]);
  assert.deepEqual(local.tables[0].rowCoverage.blankRowNumbers, [3]);
  assert.deepEqual(local.tables[0].rowCoverage.dataRowNumbers, [2, 4]);
});

test('дві таблиці мають пояснену межу і потребують окремого її підтвердження', () => {
  const workbook = source([sheet('Два блоки', [
    row(1, 'Назва', 'Значення'), row(2, 'А', 1),
    row(5, 'Назва', 'Значення'), row(6, 'Б', 2),
  ])]);
  const first = profileSource(workbook);
  const headers = [1, 5].map(headerRow => ({ sourceKey: first.sourceKey, sheetIndex: 0, headerRow }));
  const unconfirmed = profileSource(workbook, { headerConfirmations: headers });
  assert.equal(unconfirmed.tables.length, 2);
  assert.equal(unconfirmed.boundaryProposals.length, 1);
  assert.equal(unconfirmed.boundaryProposals[0].status, 'needs_confirmation');
  assert.equal(unconfirmed.boundaryProposals[0].proposedAction, 'split');
  assert.ok(unconfirmed.boundaryProposals[0].explanation.includes('рядок 5'));
  assert.ok(unconfirmed.tables.every(item => item.boundaryStatus === 'needs_confirmation'));
  assert.deepEqual(unconfirmed.tables.flatMap(item => item.rowCoverage.sourceRowNumbers), [1, 2, 5, 6]);
  const confirmations = unconfirmed.tables.flatMap(table => [
    { sourceKey: first.sourceKey, tableId: table.tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { sourceKey: first.sourceKey, tableId: table.tableId, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ]);
  assert.ok(recommend(unconfirmed, definitions, { rustTemplates, confirmations })
    .filter(item => item.definitionId === 'rust-template:kpi').every(item => item.readiness !== 'ready'));
  const confirmed = profileSource(workbook, { headerConfirmations: headers,
    boundaryConfirmations: [{ sourceKey: first.sourceKey, sheetIndex: 0, beforeRow: 5, action: 'split' }] });
  assert.ok(confirmed.tables.every(item => item.boundaryStatus === 'confirmed'));
  assert.equal(recommend(confirmed, definitions, { rustTemplates, confirmations })
    .filter(item => item.definitionId === 'rust-template:kpi' && item.readiness === 'ready').length, 2);
});

test('багаторядкова шапка зберігає попередні рядки; підтвердження колонок не підтверджує шапку', () => {
  const workbook = source([sheet('Шапка', [
    row(1, 'Синтетичний звіт'), row(2, 'Опис', 'Показники'),
    row(3, 'Назва', 'Значення, шт'), row(4, 'А', 3),
  ])]);
  const guessed = profileSource(workbook);
  assert.equal(guessed.tables[0].headerRow, 3);
  assert.deepEqual(guessed.tables[0].rowCoverage.preambleRowNumbers, [1, 2]);
  assert.deepEqual(guessed.tables[0].rowCoverage.sourceRowNumbers, [1, 2, 3, 4]);
  const tableId = guessed.tables[0].tableId;
  const confirmations = [
    { sourceKey: guessed.sourceKey, tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { sourceKey: guessed.sourceKey, tableId, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ];
  assert.equal(recommend(guessed, definitions, { rustTemplates, confirmations })
    .find(item => item.definitionId === 'rust-template:kpi').readiness, 'needs_confirmation');
  const confirmed = profileSource(workbook, { headerConfirmations: [
    { sourceKey: guessed.sourceKey, sheetIndex: 0, headerRow: 3 },
  ] });
  assert.equal(confirmed.tables[0].headerStatus, 'confirmed');
  assert.equal(recommend(confirmed, definitions, { rustTemplates, confirmations })
    .find(item => item.definitionId === 'rust-template:kpi').readiness, 'ready');
});

test('повторний заголовок розрізняється лише явною позиційною прив’язкою', () => {
  const local = withHeader(source([sheet('Дублікат', [
    row(1, 'Назва', 'Значення', 'Значення'), row(2, 'А', 2, 3),
  ])]));
  assert.equal(local.tables[0].columns[1].bindingStatus, 'ambiguous');
  const tableId = local.tables[0].tableId;
  const result = recommend(local, definitions, { rustTemplates, confirmations: [
    { sourceKey: local.sourceKey, tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { sourceKey: local.sourceKey, tableId, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ] });
  const kpi = result.find(item => item.definitionId === 'rust-template:kpi');
  assert.equal(kpi.readiness, 'ready');
  assert.equal(kpi.requiredFields.find(item => item.fieldKey === 'value').columnId, 'c2');
});

test('часткова вибірка не стає ready навіть після підтверджень і показує охоплені рядки', () => {
  const workbook = source([{ name: 'Частина', sample: [
    row(1, 'Назва', 'Значення'), row(2, 'А', 2),
  ], rowCount: 10 }]);
  const local = withHeader(workbook);
  assert.equal(local.tables[0].truncated, true);
  assert.deepEqual(local.tables[0].rowCoverage.sourceRowNumbers, [1, 2]);
  assert.equal(local.tables[0].rowCountKnown, null);
  const tableId = local.tables[0].tableId;
  const kpi = recommend(local, definitions, { rustTemplates, confirmations: [
    { sourceKey: local.sourceKey, tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { sourceKey: local.sourceKey, tableId, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ] }).find(item => item.definitionId === 'rust-template:kpi');
  assert.equal(kpi.readiness, 'needs_confirmation');
  assert.equal(kpi.dataStatus, 'partial');
});

test('ідентичність preview відділена від джерела з версією, а підтвердження прив’язане до джерела й поля', () => {
  const a = source([sheet('Синтетика', [row(1, 'Назва', 'Значення'), row(2, 'А', 2)])]);
  const b = source([sheet('Синтетика', [row(1, 'Назва', 'Значення'), row(2, 'Б', 3)])]);
  const previewA = withHeader(a);
  const previewB = withHeader(b);
  assert.equal(previewA.previewOnly, true);
  assert.notEqual(previewA.sourceKey, previewB.sourceKey);
  assert.notEqual(profileSource(a, { sourceId: 'first' }).sourceKey,
    profileSource(a, { sourceId: 'second' }).sourceKey);
  assert.notEqual(profileSource(a, { previewId: 'inspection-1' }).sourceKey,
    profileSource(a, { previewId: 'inspection-2' }).sourceKey);
  const kpiDefinition = definitions.find(item => item.definitionId === 'rust-template:kpi');
  const previewId = recommend(previewA, [kpiDefinition], { rustTemplates })[0];
  assert.equal(previewId.previewOnly, true);
  assert.equal(previewId.identityScope, 'preview');
  assert.ok(previewId.id.startsWith('preview-recommendation:'));
  const stableA = withHeader(a, { sourceId: 'source-a', sourceVersion: 'v1' });
  const stableAgain = withHeader(a, { sourceId: 'source-a', sourceVersion: 'v1' });
  const stableB = withHeader(a, { sourceId: 'source-b', sourceVersion: 'v1' });
  const stableV2 = withHeader(a, { sourceId: 'source-a', sourceVersion: 'v2' });
  const idOf = local => recommend(local, [kpiDefinition], { rustTemplates })[0].id;
  assert.equal(idOf(stableA), idOf(stableAgain));
  assert.notEqual(idOf(stableA), idOf(stableB));
  assert.notEqual(idOf(stableA), idOf(stableV2));
  const tableId = stableA.tables[0].tableId;
  const fromA = [
    { sourceKey: stableA.sourceKey, tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { sourceKey: stableA.sourceKey, tableId, columnId: 'c2', role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' },
  ];
  assert.equal(recommend(stableB, [kpiDefinition], { rustTemplates, confirmations: fromA })[0].readiness, 'needs_confirmation');
  assert.equal(recommend(stableA, [kpiDefinition], { rustTemplates, confirmations: [
    { ...fromA[0], fieldKey: 'other' }, fromA[1],
  ] })[0].readiness, 'needs_confirmation');
  assert.equal(recommend(stableA, [kpiDefinition], { rustTemplates, confirmations: fromA })[0].readiness, 'ready');
});

test('суперечливі підтвердження одиниці не зникають через порядок записів', () => {
  const kpiDefinition = definitions.find(item => item.definitionId === 'rust-template:kpi');
  const tableId = profile.tables[0].tableId;
  const metric = { sourceKey: profile.sourceKey, tableId, columnId: 'c3',
    role: 'measure', fieldKey: 'value', aggregation: 'sum' };
  const conflicting = [
    { sourceKey: profile.sourceKey, tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    { ...metric, unit: 'шт' }, { ...metric, unit: 'кг' }, { ...metric, unit: 'кг' },
  ];
  const binding = proposeBindings(profile, { confirmations: conflicting })
    .find(item => item.fieldKey === 'value' && item.columnId === 'c3');
  assert.equal(binding.bindingStatus, 'ambiguous');
  assert.equal(recommend(profile, [kpiDefinition], { rustTemplates, confirmations: conflicting })[0].readiness,
    'needs_confirmation');
});

test('нежадібне зіставлення не приховує друге обов’язкове поле', () => {
  const local = withHeader(source([sheet('Перетин', [
    row(1, 'Тип боєприпасу', 'Інше'), row(2, 'Умовний тип', 'Група'),
  ])]));
  const definition = { definitionId: 'catalog-v1:matching-probe', sourceCatalog: 'catalog-v1',
    sourceId: 'matching-probe', title: 'Синтетичний блок', visual: 'table', computation: 'Рядки таблиці.',
    requirements: [
      { role: 'category', column: 'category', type: 'text', required: true },
      { role: 'munition-type', column: 'col.munition', type: 'text', required: true },
    ] };
  const result = recommend(local, [definition], { catalogs: [{ id: 'probe', columns: [
    { id: 'col.munition', labels: ['Тип боєприпасу'] },
  ] }] })[0];
  assert.equal(result.readiness, 'unsupported');
  assert.deepEqual(result.requiredFields.map(item => item.columnId), ['c2', 'c1']);
  assert.equal(result.variantsIncomplete, true);
  assert.ok(result.warnings.some(item => item.includes('обмежений набір')));
});

test('непідтверджена необов’язкова метрика не входить в активну конфігурацію', () => {
  const kpi = recommend(profile, definitions, options)
    .find(item => item.definitionId === 'rust-template:kpi' && item.readiness === 'ready');
  const delta = kpi.requiredFields.find(item => item.fieldKey === 'delta');
  assert.equal(delta.required, false);
  assert.equal(delta.active, false);
  assert.notEqual(delta.status, 'confirmed');
  assert.ok(!kpi.id.includes('delta%3D'));
  assert.ok(!kpi.explanation.some(item => item.includes('Інше значення')));
});

test('всі визначення E1 збережені; обмеження варіантів показано явно', () => {
  const all = recommend(profile, definitions, options);
  assert.deepEqual(new Set(all.map(item => item.definitionId)), new Set(definitions.map(item => item.definitionId)));
  const numericHeaders = Array.from({ length: 20 }, (_, index) => `Показник ${index + 1}`);
  const workbook = source([sheet('Багато показників', [
    row(1, 'Назва', ...numericHeaders), row(2, 'А', ...numericHeaders.map((_, index) => index + 1)),
  ])]);
  const local = withHeader(workbook, { sourceId: 'many', sourceVersion: 'v1' });
  const tableId = local.tables[0].tableId;
  const many = [
    { sourceKey: local.sourceKey, tableId, columnId: 'c1', role: 'label', fieldKey: 'label' },
    ...numericHeaders.map((_, index) => ({ sourceKey: local.sourceKey, tableId,
      columnId: `c${index + 2}`, role: 'measure', fieldKey: 'value', unit: 'шт', aggregation: 'sum' })),
  ];
  const kpiDefinition = definitions.find(item => item.definitionId === 'rust-template:kpi');
  const kpis = recommend(local, [kpiDefinition], { rustTemplates, confirmations: many });
  assert.equal(kpis.length, 16);
  assert.ok(kpis.every(item => item.variantsIncomplete && item.warnings.some(text => text.includes('обмежений набір'))));
  assert.equal(new Set(kpis.map(item => item.id)).size, 16);
});
