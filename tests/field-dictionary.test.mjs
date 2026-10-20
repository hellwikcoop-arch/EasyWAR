// Словник полів шаблонів (src/workspace/field-dictionary-core.js): контекст з відповіді
// library_source_data для трьох джерел, форматування значень і довідка полів.
// Лише синтетичні дані тієї самої форми, що й у контракті IPC.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_VALUE, RESULT_LABELS, SOURCE_KINDS, buildContext, columnName, formatDate, formatPercent, listBlocks, listFields,
  sourceKindLabel,
} from '../src/workspace/field-dictionary-core.js';

const NOW = new Date(2026, 9, 20, 23, 59);
const PROFILE = { displayName: 'Тестовий профіль', position: 'Аналітик', role: null };

const record = overrides => ({
  number: '99', date: '2026-10-02', dateRaw: '02.10.2026', time: '10:15', targetIds: ['T-1', 'T-2'], unit: 'Підрозділ-1',
  district: 'Район-1', coordinates: '00X AA 00000 00000', targetTypes: ['Тип-А', 'Тип-Б'], aircraft: 'ЛА-1', munition: 'Б-1',
  munitionCount: 12345, munitionCountRaw: '12345', result: 'hit', resultRaw: 'уражено', aborted: false, cause: '', note: 'примітка',
  qualityIssues: [], ...overrides,
});

const APPROVED = {
  period: { from: '2026-10-01', to: null },
  overview: {
    totalRecords: 3, abortedRecords: 1, evaluatedRecords: 2, hitRecords: 1, partialRecords: 1, missRecords: 0, unknownRecords: 0,
    overallEffectPercent: 72.5, dpiEffectPercent: null,
  },
  breakdowns: [
    { dimension: 'aircraft', value: 'ЛА-1', recordCount: 2, munitionCount: 3, overallEffectPercent: 66.67, dpiEffectPercent: 50 },
    { dimension: 'munition', value: 'Б-1', recordCount: 1, munitionCount: 1, overallEffectPercent: 100, dpiEffectPercent: null },
    { dimension: 'unit', value: null, recordCount: 1, munitionCount: 0, overallEffectPercent: null, dpiEffectPercent: null },
    { dimension: 'aircraft', value: 'ЛА-2', recordCount: 1, munitionCount: 1, overallEffectPercent: 0, dpiEffectPercent: 0 },
  ],
  records: [
    record({}),
    record({ date: null, dateRaw: 'вчора', targetIds: [], targetTypes: [], munitionCount: 0, munitionCountRaw: 'дві', result: 'partial', aborted: true, cause: 'погода', qualityIssues: ['invalid_munition_count'] }),
    record({ date: null, dateRaw: '', result: 'miss', munitionCount: 0, munitionCountRaw: '', qualityIssues: ['missing_munition_count'] }),
    record({ result: 'unknown', note: null }),
  ],
};

test('джерела даних і підписи результатів українською', () => {
  assert.deepEqual(SOURCE_KINDS.map(kind => [kind.id, kind.label]), [
    ['approved_revisions', 'Схвалені записи'], ['dashboard_module', 'Модуль дашборда'], ['library_table', 'Таблиця з бібліотеки'],
  ]);
  assert.ok(Object.isFrozen(SOURCE_KINDS) && SOURCE_KINDS.every(Object.isFrozen));
  assert.equal(sourceKindLabel('library_table'), 'Таблиця з бібліотеки');
  assert.equal(sourceKindLabel('інше'), '');
  assert.deepEqual(RESULT_LABELS, { hit: 'Уражено', partial: 'Частково', miss: 'Не уражено', unknown: 'Невідомо' });
});

test('форматування: дати, відсотки, назви колонок', () => {
  assert.equal(formatDate('2026-10-02'), '02.10.2026');
  assert.equal(formatDate('02.10.2026'), '02.10.2026');
  assert.equal(formatDate(null), EMPTY_VALUE);
  assert.equal(formatPercent(72.5), '72,5 %');
  assert.equal(formatPercent(66.67), '66,7 %');
  assert.equal(formatPercent(100), '100 %');
  assert.equal(formatPercent(null), '—');
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('схвалені записи: поля документа, зведення й записи з номером 1..n', () => {
  const { fields, blocks } = buildContext({ sourceKind: 'approved_revisions', data: APPROVED, profile: PROFILE, now: NOW });
  assert.deepEqual(fields, {
    'дата': '20.10.2026',
    'профіль.назва': 'Тестовий профіль',
    'профіль.посада': 'Аналітик',
    'профіль.роль': '—',
    'період.з': '01.10.2026',
    'період.по': '02.10.2026', // фільтр лише «з»: кінець — найпізніша дата записів
    'зведення.усього': '3',
    'зведення.скасовано': '1',
    'зведення.оцінено': '2',
    'зведення.уражено': '1',
    'зведення.частково': '1',
    'зведення.не_уражено': '0',
    'зведення.невідомо': '0',
    'зведення.ефективність': '72,5 %',
    'зведення.ефективність_dpi': '—',
  });
  assert.deepEqual(Object.keys(blocks), ['записи', 'за_ла', 'за_боєприпасами', 'за_підрозділами']);
  assert.deepEqual(blocks['записи'][0], {
    fields: {
      'номер': '1', 'дата': '02.10.2026', 'час': '10:15', 'цілі': 'T-1, T-2', 'підрозділ': 'Підрозділ-1', 'район': 'Район-1',
      'координати': '00X AA 00000 00000', 'типи_цілей': 'Тип-А, Тип-Б', 'тип_ла': 'ЛА-1', 'боєприпас': 'Б-1',
      'кількість': '12 345', 'результат': 'Уражено', 'скасовано': 'ні', 'причина': '', 'примітка': 'примітка',
    },
  });
  const second = blocks['записи'][1].fields;
  assert.deepEqual([second['номер'], second['дата'], second['цілі'], second['типи_цілей'], second['кількість'], second['результат'], second['скасовано'], second['причина']],
    ['2', 'вчора', '', '', 'дві', 'Частково', 'так', 'погода']);
  const third = blocks['записи'][2].fields;
  assert.deepEqual([third['дата'], third['кількість'], third['результат']], ['—', '—', 'Не уражено']);
  assert.deepEqual([blocks['записи'][3].fields['результат'], blocks['записи'][3].fields['примітка']], ['Невідомо', '—']);
  assert.deepEqual(blocks['за_ла'], [
    { fields: { 'номер': '1', 'значення': 'ЛА-1', 'записів': '2', 'боєприпасів': '3', 'ефективність': '66,7 %' } },
    { fields: { 'номер': '2', 'значення': 'ЛА-2', 'записів': '1', 'боєприпасів': '1', 'ефективність': '0 %' } },
  ]);
  assert.deepEqual(blocks['за_боєприпасами'].map(item => item.fields['ефективність']), ['100 %']);
  assert.deepEqual(blocks['за_підрозділами'], [{ fields: { 'номер': '1', 'значення': '—', 'записів': '1', 'боєприпасів': '0', 'ефективність': '—' } }]);
});

test('поля збігаються з довідкою: кожне поле контексту є в listFields свого блоку', () => {
  const { fields, blocks } = buildContext({ sourceKind: 'approved_revisions', data: APPROVED, profile: PROFILE, now: NOW });
  const listed = listFields('approved_revisions');
  assert.deepEqual(listed.filter(entry => entry.block === null).map(entry => entry.name), Object.keys(fields));
  for (const [block, items] of Object.entries(blocks)) {
    assert.deepEqual(listed.filter(entry => entry.block === block).map(entry => entry.name), Object.keys(items[0].fields), block);
  }
  assert.ok(listed.every(entry => Object.isFrozen(entry) && entry.label));
  assert.deepEqual(listBlocks('approved_revisions').map(entry => entry.name), ['записи', 'за_ла', 'за_боєприпасами', 'за_підрозділами']);
  assert.deepEqual(listBlocks('library_table'), [{ name: 'рядки', label: 'Рядки таблиці' }]);
});

test('модуль дашборда: назва, кількість рядків і поля модуля за типом даних', () => {
  const data = {
    module: {
      id: 'module-1', title: 'Модуль-1', templateId: 'table', branch: 'air',
      fields: [
        { key: 'label', label: 'Мітка', dataType: 'text' },
        { key: 'value', label: 'Значення', dataType: 'real' },
        { key: 'day', label: 'День', dataType: 'date' },
        { key: 'at', label: 'Час', dataType: 'datetime' },
        { key: 'ok', label: 'Готово', dataType: 'boolean' },
        { key: 'bad key', label: 'Недопустима назва', dataType: 'text' },
      ],
    },
    rows: [
      { rowId: 1, createdAt: '2026-10-01T00:00:00Z', label: 'Альфа', value: 1234.567, day: '2026-10-03', at: '2026-10-03T14:05:00Z', ok: true },
      { rowId: 2, createdAt: '2026-10-01T00:00:00Z', label: null, value: 12345, day: null, at: 'не дата', ok: 0 },
      { rowId: 3, createdAt: '2026-10-01T00:00:00Z', label: 'Велике', value: 9876543.21, day: null, at: null, ok: 1 },
    ],
    truncated: false,
  };
  const { fields, blocks } = buildContext({ sourceKind: 'dashboard_module', data, profile: { displayName: 'П', position: '', role: 'Аналітик' }, now: '2026-10-20T10:00:00Z' });
  assert.deepEqual(fields, {
    'дата': '20.10.2026', 'профіль.назва': 'П', 'профіль.посада': '', 'профіль.роль': 'Аналітик',
    'модуль.назва': 'Модуль-1', 'модуль.рядків': '3',
  });
  assert.deepEqual(blocks, {
    'рядки': [
      { fields: { 'номер': '1', label: 'Альфа', value: '1234,567', day: '03.10.2026', at: '03.10.2026 14:05', ok: 'так' } },
      { fields: { 'номер': '2', label: '—', value: '12 345', day: '—', at: 'не дата', ok: 'ні' } },
      // 15 значущих цифр: без шуму подвійної точності у великих значеннях з дробом.
      { fields: { 'номер': '3', label: 'Велике', value: '9 876 543,21', day: '—', at: '—', ok: 'так' } },
    ],
  });
  assert.deepEqual(listFields('dashboard_module', data).filter(entry => entry.block === 'рядки').map(entry => [entry.name, entry.label]), [
    ['номер', 'Порядковий номер рядка (1, 2, …)'], ['label', 'Мітка'], ['value', 'Значення'], ['day', 'День'], ['at', 'Час'], ['ok', 'Готово'],
  ]);
  assert.deepEqual(listFields('dashboard_module').filter(entry => entry.block === 'рядки').map(entry => entry.name), ['номер']);
});

test('модуль дашборда: координати й малі величини не округлюються до сотих', () => {
  const data = {
    module: {
      id: 'module-2', title: 'Карта (синтетика)', templateId: 'events', branch: 'air',
      fields: [
        { key: 'latitude', label: 'Широта', dataType: 'real' },
        { key: 'longitude', label: 'Довгота', dataType: 'real' },
        { key: 'value', label: 'Значення', dataType: 'real' },
      ],
    },
    rows: [{ rowId: 1, createdAt: '2026-10-01T00:00:00Z', latitude: 48.123456, longitude: 37.987654, value: 0.004 },
      { rowId: 2, createdAt: '2026-10-01T00:00:00Z', latitude: 0.1 + 0.2, longitude: -12345.678, value: 2 }],
    truncated: false,
  };
  const { blocks } = buildContext({ sourceKind: 'dashboard_module', data, profile: PROFILE, now: NOW });
  assert.deepEqual(blocks['рядки'].map(item => item.fields), [
    { 'номер': '1', latitude: '48,123456', longitude: '37,987654', value: '0,004' },
    { 'номер': '2', latitude: '0,3', longitude: '-12\u00a0345,678', value: '2' },
  ]);
});

test('схвалені записи: однобічний період бере відкриту межу з дат записів', () => {
  const records = [{ date: '2026-10-05' }, { date: null, dateRaw: '20.10' }, { date: '2026-10-12' }, { date: '2026-10-03' }];
  const fromOnly = buildContext({ sourceKind: 'approved_revisions', data: { period: { from: '2026-10-01', to: null }, records }, profile: PROFILE, now: NOW });
  assert.deepEqual([fromOnly.fields['період.з'], fromOnly.fields['період.по']], ['01.10.2026', '12.10.2026']);
  const toOnly = buildContext({ sourceKind: 'approved_revisions', data: { period: { from: null, to: '2026-10-20' }, records }, profile: PROFILE, now: NOW });
  assert.deepEqual([toOnly.fields['період.з'], toOnly.fields['період.по']], ['03.10.2026', '20.10.2026']);
  // Записів з датою немає — межа лишається «—»; обидві межі задано — як у фільтрі.
  const none = buildContext({ sourceKind: 'approved_revisions', data: { period: { from: '2026-10-01', to: null }, records: [] }, profile: PROFILE, now: NOW });
  assert.equal(none.fields['період.по'], '—');
  const both = buildContext({ sourceKind: 'approved_revisions', data: { period: { from: '2026-10-01', to: '2026-10-31' }, records }, profile: PROFILE, now: NOW });
  assert.deepEqual([both.fields['період.з'], both.fields['період.по']], ['01.10.2026', '31.10.2026']);
});

test('таблиця з бібліотеки: колонки A, B, … за кількістю заголовків', () => {
  const headers = Array.from({ length: 28 }, (_, i) => `Колонка ${i + 1}`);
  const data = {
    table: { itemId: 'doc-000000000000000000000001', name: 'Таблиця-1', versionId: 'ver-000000000000000000000001', sheet: 'Аркуш1' },
    headers,
    rows: [Array.from({ length: 28 }, (_, i) => String(i)), ['коротко'], ['з null', null]],
  };
  const { fields, blocks } = buildContext({ sourceKind: 'library_table', data, profile: PROFILE, now: NOW });
  assert.equal(fields['таблиця.назва'], 'Таблиця-1');
  assert.equal(fields['таблиця.рядків'], '3');
  const first = blocks['рядки'][0].fields;
  assert.deepEqual(Object.keys(first).slice(0, 3), ['номер', 'A', 'B']);
  assert.deepEqual([first.Z, first.AA, first.AB, first.AC], ['25', '26', '27', undefined]);
  assert.deepEqual([blocks['рядки'][1].fields.A, blocks['рядки'][1].fields.B, blocks['рядки'][1].fields['номер']], ['коротко', '', '2']);
  assert.deepEqual([blocks['рядки'][2].fields.A, blocks['рядки'][2].fields.B], ['з null', '—']);
  const listed = listFields('library_table', data).filter(entry => entry.block === 'рядки');
  assert.equal(listed.length, 29);
  assert.deepEqual(listed[1], { name: 'A', label: 'Колонка A: Колонка 1', block: 'рядки' });
  assert.deepEqual(listFields('library_table').filter(entry => entry.block === 'рядки').map(entry => entry.name), ['номер', 'A', 'B', 'C']);
  // Без заголовків — за найдовшим рядком.
  const plain = buildContext({ sourceKind: 'library_table', data: { table: { name: 'Т' }, headers: [], rows: [['1', '2', '3']] }, profile: PROFILE, now: NOW });
  assert.deepEqual(plain.blocks['рядки'][0].fields, { 'номер': '1', A: '1', B: '2', C: '3' });
});

test('порожні й неповні дані, невідоме джерело, дата без now', () => {
  const empty = buildContext({ sourceKind: 'approved_revisions', data: null, profile: null });
  assert.equal(empty.fields['дата'], '—');
  assert.equal(empty.fields['профіль.назва'], '—');
  assert.equal(empty.fields['зведення.усього'], '—');
  assert.deepEqual(empty.blocks['записи'], []);
  assert.throws(() => buildContext({ sourceKind: 'інше', data: {} }), /Невідоме джерело даних шаблону «інше»/);
  assert.throws(() => buildContext(), /Невідоме джерело/);
  assert.throws(() => listFields('constructor'), /Невідоме джерело/);
  assert.throws(() => listBlocks('toString'), /Невідоме джерело/);
});
