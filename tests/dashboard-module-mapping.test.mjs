import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COUNT,
  NONE,
  bindTemplate,
  bindingLine,
  canCount,
  cellKind,
  columnLetters,
  columnSummary,
  compatibility,
  countAllowed,
  describeBinding,
  detectHeaderIndex,
  previewText,
  profileColumns,
  rankTemplates,
  suggestBinding,
} from '../src/dashboard-module-mapping-core.js';
import { bindingMatch, COUNT_LABEL, describePlan, importGaps, importRows, planImport } from '../src/dashboard-module-source-core.js';
import { chartModel } from '../src/dashboard-module-charts-core.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

// Лише синтетичні дані: вигадані підрозділи, райони й числа. Заголовки схожі на таблицю з фото
// («№, Дата/час, Підрозділ, Район/н.п., Ціль, Літак, Боєприпаси, Результат, Причина/уточнення»),
// але самі значення вигадані і ні до чого реального не прив'язані.
const catalog = await rustCatalog();
const templateOf = id => catalog.find(item => item.id === id);

const HEADERS = ['№', 'Дата/час', 'Підрозділ', 'Район/н.п.', 'Ціль', 'Літак', 'Боєприпаси', 'Результат', 'Причина/уточнення'];
const COL = Object.fromEntries(HEADERS.map((name, index) => [name, index]));
const AIRCRAFT = ['Су-25', 'Су-25', 'Су-24', 'МіГ-29', 'Су-25', 'Су-24'];
const RESULTS = ['уражено', 'уражено', 'не уражено', 'знищено', 'уражено', 'пошкоджено'];
const TARGETS = ['склад', 'колона', 'склад', 'міст', 'колона', 'склад'];

/** 36 синтетичних записів: літак/результат/ціль циклічно, дати — підряд, причина лише в кожному третьому. */
const DATA = Array.from({ length: 36 }, (_, index) => [
  index + 1,
  `2026-09-${String(1 + (index % 9)).padStart(2, '0')} ${String(8 + (index % 10)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
  `Підрозділ ${1 + (index % 3)}`,
  `район ${1 + (index % 5)}`,
  TARGETS[index % TARGETS.length],
  AIRCRAFT[index % AIRCRAFT.length],
  index % 4 === 0 ? 'ФАБ-500' : 'С-8',
  RESULTS[index % RESULTS.length],
  index % 3 === 0 ? `причина ${index} через розрив у зв'язку з погодою` : null,
]);

/** Аркуш: два рядки заголовка книги над рядком заголовків, як у справжніх таблицях. */
const sheet = () => ({
  name: 'Зведена',
  truncated: false,
  rows: [['Облік уражень', null], [null, null], HEADERS, ...DATA].map((cells, index) => ({ number: index + 1, cells })),
});
const HEADER_INDEX = 2;
const columns = () => profileColumns(sheet().rows, detectHeaderIndex(sheet().rows));
const byName = name => columns()[COL[name]];

test('cell kinds: numbers in text, ISO dates with and without time, flags and blanks', () => {
  assert.equal(cellKind(null), 'blank');
  assert.equal(cellKind('  '), 'blank');
  assert.equal(cellKind(12), 'number');
  assert.equal(cellKind('12,5'), 'number');
  assert.equal(cellKind('2026-09-02'), 'date');
  assert.equal(cellKind('2026-09-02 14:30'), 'date');
  assert.equal(cellKind('02.09.2026'), 'date');
  assert.equal(cellKind('2026-13-40'), 'text');
  assert.equal(cellKind(true), 'flag');
  assert.equal(cellKind('Су-25'), 'text');
  assert.equal(columnLetters(0), 'A');
  assert.equal(columnLetters(26), 'AA');
});

test('header row is found under the title rows; an all-number sheet has none', () => {
  assert.equal(detectHeaderIndex(sheet().rows), HEADER_INDEX);
  assert.equal(detectHeaderIndex([{ cells: [1, 2, 3] }, { cells: [4, 5, 6] }]), -1);
  assert.equal(detectHeaderIndex([]), -1);
  assert.equal(detectHeaderIndex(null), -1);
});

test('column profile tells counters, dates, categories and free text apart', () => {
  const all = columns();
  assert.equal(all.length, HEADERS.length);
  assert.equal(byName('№').kind, 'number');
  assert.equal(byName('№').counter, true);
  assert.equal(byName('Дата/час').kind, 'date');
  assert.ok(byName('Дата/час').withTime > 0);
  assert.equal(byName('Літак').kind, 'category');
  assert.equal(byName('Літак').distinct, 3);
  assert.deepEqual(byName('Літак').top[0], { value: 'Су-25', count: 18 });
  assert.equal(byName('Результат').distinct, 4);
  assert.equal(byName('Причина/уточнення').filled, 12);
  assert.equal(byName('Причина/уточнення').kind, 'text');
  assert.match(columnSummary(byName('Літак')), /^3 різних: Су-25, /u);
  assert.equal(columnSummary(byName('№')), 'номери за порядком');
  assert.match(columnSummary(byName('Дата/час')), /^дата, 01\.09\.2026 – 09\.09\.2026$/u);
});

test('a header-less sheet gets lettered column names', () => {
  const rows = [{ cells: ['a', 1] }, { cells: ['b', 2] }, { cells: ['a', 3] }];
  const [first, second] = profileColumns(rows, -1);
  assert.equal(first.label, 'Стовпець A');
  assert.equal(second.label, 'Стовпець B');
  assert.equal(second.total, 3);
});

test('a column is offered only to fields it can fill', () => {
  const columnsTemplate = templateOf('columns');
  const [category, value] = columnsTemplate.fields;
  assert.equal(compatibility(category, byName('Літак')), 3);
  assert.equal(compatibility(value, byName('Літак')), 0, 'text cannot fill a number');
  assert.equal(compatibility(value, byName('№')), 0, 'a counter is not a measure');
  assert.equal(compatibility(category, byName('№')), 0);
  const period = templateOf('line').fields[0];
  assert.equal(compatibility(period, byName('Дата/час')), 3);
  assert.equal(compatibility(period, byName('Літак')), 0);
  const observedAt = templateOf('weather').fields[0];
  assert.equal(observedAt.dataType, 'datetime');
  assert.equal(compatibility(observedAt, byName('Дата/час')), 3);
  assert.equal(compatibility(observedAt, { kind: 'date', filled: 10, withTime: 0 }), 0, 'a date without time is not a moment');
  assert.equal(compatibility(value, { kind: 'empty' }), 0);
});

test('latitude and longitude take only numbers inside their range', () => {
  const [, latitude, longitude] = templateOf('map').fields;
  assert.equal(latitude.role, 'latitude');
  const lat = { kind: 'number', min: 47.1, max: 49.9, header: 'Широта', filled: 5, counter: false };
  const lon = { kind: 'number', min: 30.1, max: 36.2, header: 'Довгота', filled: 5, counter: false };
  assert.equal(compatibility(latitude, lat), 3);
  assert.equal(compatibility(longitude, lon), 3);
  assert.equal(compatibility(latitude, lon), 3 - 1, 'a plausible latitude without the word "широта" is only a fair match');
  assert.equal(compatibility(latitude, { ...lat, max: 120 }), 0);
});

test('one category column makes a module that counts the records itself', () => {
  const columnsTemplate = templateOf('columns');
  assert.equal(countAllowed(columnsTemplate), true);
  const result = bindTemplate(columnsTemplate, columns(), { prefer: [COL['Літак']] });
  assert.deepEqual(result.picks, { category: COL['Літак'], value: COUNT });
  assert.equal(result.fit, true);
  assert.deepEqual(result.unused, []);
  assert.equal(bindingLine(columnsTemplate.fields, result.picks, columns()), 'Категорія ← Літак; Значення ← кількість записів');
  assert.deepEqual(describeBinding(columnsTemplate.fields, result.picks, columns()).map(item => item.from), ['Літак', 'кількість записів']);
});

test('a second category column becomes the series, a number goes to the value', () => {
  const stacked = bindTemplate(templateOf('stacked-columns'), columns(), { prefer: [COL['Літак'], COL['Результат']] });
  assert.equal(stacked.picks.category, COL['Літак']);
  assert.equal(stacked.picks.series, COL['Результат']);
  assert.equal(stacked.picks.value, COUNT);
  assert.equal(stacked.fit, true);
  const withNumber = [{ index: 0, label: 'Сектор', kind: 'category', distinct: 4, filled: 30, withTime: 0, top: [] },
    { index: 1, label: 'Витрата', kind: 'number', distinct: 20, filled: 30, counter: false, min: 1, max: 40, withTime: 0, top: [] }];
  const sum = bindTemplate(templateOf('horizontal-bars'), withNumber, { prefer: [0, 1] });
  assert.deepEqual(sum.picks, { category: 0, value: 1 });
});

test('the order of clicks does not matter for which field a column fills', () => {
  const forward = bindTemplate(templateOf('stacked-columns'), columns(), { prefer: [COL['Літак'], COL['Результат']] });
  const backward = bindTemplate(templateOf('stacked-columns'), columns(), { prefer: [COL['Результат'], COL['Літак']] });
  assert.equal(forward.picks.category, COL['Літак']);
  assert.equal(backward.picks.category, COL['Результат'], 'the first click takes the first free required slot');
});

test('records are never counted where the module shows single measurements', () => {
  const kpi = templateOf('kpi');
  assert.equal(countAllowed(kpi), false);
  const result = bindTemplate(kpi, columns(), { prefer: [COL['Літак']] });
  assert.equal(result.fit, false);
  assert.deepEqual(result.missing, ['value']);
  assert.equal(canCount(kpi.fields.find(field => field.key === 'value')), true);
  assert.equal(canCount(kpi.fields.find(field => field.key === 'delta')), false, 'an average is not a count');
});

test('pinned slots stay put and a taken column is not given twice', () => {
  const template = templateOf('stacked-columns');
  const pinned = { series: COL['Літак'] };
  const result = bindTemplate(template, columns(), { prefer: [COL['Літак'], COL['Результат']], pinned });
  assert.equal(result.picks.series, COL['Літак']);
  assert.equal(result.picks.category, COL['Результат']);
  const twice = bindTemplate(template, columns(), { pinned: { category: COL['Літак'], series: COL['Літак'] } });
  assert.equal(twice.picks.category, COL['Літак']);
  assert.equal(twice.picks.series, undefined, 'one table column fills one module column');
});

test('suggestions: one category fits the ranking, ring and bar modules but not a single-number card', () => {
  const ids = rankTemplates(catalog, columns(), [COL['Літак']]).map(item => item.template.id);
  for (const id of ['columns', 'horizontal-bars', 'donut', 'leaderboard', 'radar']) assert.ok(ids.includes(id), `${id} fits`);
  for (const id of ['kpi', 'table', 'gauge', 'flight-hours', 'funnel']) assert.ok(!ids.includes(id), `${id} does not fit`);
});

test('suggestions: a date column suggests the time modules, a date and a category add the series', () => {
  const dateOnly = rankTemplates(catalog, columns(), [COL['Дата/час']]);
  const dateIds = dateOnly.map(item => item.template.id);
  for (const id of ['line', 'area', 'calendar']) assert.ok(dateIds.includes(id), `${id} fits a date`);
  const line = dateOnly.find(item => item.template.id === 'line');
  assert.deepEqual(line.picks, { period: COL['Дата/час'], value: COUNT });
  const both = rankTemplates(catalog, columns(), [COL['Дата/час'], COL['Результат']]).find(item => item.template.id === 'line');
  assert.equal(both.picks.series, COL['Результат']);
  assert.deepEqual(both.unused, []);
});

test('suggestions: two categories drop the ring module that has no second slot', () => {
  const ids = rankTemplates(catalog, columns(), [COL['Літак'], COL['Результат']]).map(item => item.template.id);
  assert.ok(ids.includes('stacked-columns'));
  assert.ok(ids.includes('columns'), 'the columns module takes the second one as series');
  assert.ok(!ids.includes('donut'));
});

test('suggestions: when nothing takes all chosen columns the closest modules say what they leave out', () => {
  const chosen = [COL['Літак'], COL['Результат'], COL['Ціль']];
  const items = rankTemplates(catalog, columns(), chosen);
  assert.ok(items.length > 0);
  assert.ok(items.every(item => item.unused.length === 1), 'every suggestion leaves exactly one column');
  assert.ok(items.every(item => chosen.includes(item.unused[0])));
});

test('suggestions: nothing chosen, nothing suggested; the template in use is left out', () => {
  assert.deepEqual(rankTemplates(catalog, columns(), []), []);
  const ids = rankTemplates(catalog, columns(), [COL['Літак']], { exclude: 'columns' }).map(item => item.template.id);
  assert.ok(!ids.includes('columns'));
});

test('a numeric table suggests the sum, and the counter column alone is not a measure', () => {
  const rows = [['Сектор', 'Витрата', '№'], ...Array.from({ length: 12 }, (_, i) => [`с${i % 3}`, 5 + i * 2, i + 1])]
    .map((cells, index) => ({ number: index + 1, cells }));
  const profile = profileColumns(rows, 0);
  const sum = rankTemplates(catalog, profile, [0, 1]).find(item => item.template.id === 'columns');
  assert.deepEqual(sum.picks, { category: 0, value: 1 });
  const onlyCounter = bindTemplate(templateOf('columns'), profile, { prefer: [2] });
  assert.deepEqual(onlyCounter.unused, [2], 'the counter column fits neither the category nor the value');
  assert.deepEqual(onlyCounter.picks, { value: COUNT }, 'records are counted instead');
  assert.equal(onlyCounter.fit, false);
  assert.deepEqual(onlyCounter.missing, ['category']);
});

test('binding match keeps the picks, drops duplicates and out-of-range ones', () => {
  const fields = templateOf('stacked-columns').fields;
  const matched = bindingMatch(fields, HEADERS, { category: 5, series: 5, value: 'count' });
  assert.deepEqual([...matched.mapped], [['category', [5]]]);
  assert.deepEqual([...matched.constants], [['value', 1]]);
  assert.deepEqual([...matched.matchedKeys].sort(), ['category', 'value']);
  assert.equal(matched.columns[0].header, 'Літак');
  assert.deepEqual(matched.extras, []);
  const loose = bindingMatch(fields, HEADERS, { category: -1, value: 1.5, series: 99 });
  assert.equal(loose.matchedKeys.size, 1, 'the unknown column still maps, only the bad ones go');
});

test('import with the chosen columns reads every record once and counts them as ones', () => {
  const fields = templateOf('columns').fields;
  const plan = planImport(fields, sheet(), { binding: { headerIndex: HEADER_INDEX, picks: { category: COL['Літак'], value: COUNT } } });
  assert.equal(plan.blocked, '');
  assert.equal(plan.headerNumber, 3);
  assert.equal(plan.rows.length, DATA.length);
  assert.ok(plan.rows.every(row => row.value === 1 && typeof row.category === 'string'));
  assert.equal(plan.rows.filter(row => row.category === 'Су-25').length, DATA.filter(row => row[COL['Літак']] === 'Су-25').length);
  assert.equal(plan.found.find(item => item.key === 'value').from, COUNT_LABEL);
  assert.equal(plan.found.find(item => item.key === 'category').from, 'Літак');
  assert.equal(plan.extra.length, 0);
  assert.equal(plan.skippedCount, 0);
  assert.equal(importGaps(plan).complete, true);
  assert.equal(importRows(plan).length, DATA.length);
  assert.match(describePlan(plan).summary, /Буде підтягнуто 36 записів/u);
  assert.equal(plan.firstRecord.find(item => item.label === 'Значення').text, '1');
});

test('the module counts and shares itself from the imported records', () => {
  const template = templateOf('donut');
  const plan = planImport(template.fields, sheet(), { binding: { headerIndex: HEADER_INDEX, picks: { category: COL['Результат'], value: COUNT } } });
  const model = chartModel(template, importRows(plan));
  assert.equal(model.kind, 'donut');
  assert.equal(model.total, DATA.length);
  const expected = new Map();
  for (const row of DATA) expected.set(row[COL['Результат']], (expected.get(row[COL['Результат']]) ?? 0) + 1);
  for (const slice of model.slices) assert.equal(slice.value, expected.get(slice.label), slice.label);
  const percent = model.slices.reduce((sum, slice) => sum + slice.percent, 0);
  assert.ok(Math.abs(percent - 100) < 1e-9);
  const top = model.slices[0];
  assert.equal(top.label, 'уражено');
  assert.ok(Math.abs(top.percent - expected.get('уражено') / DATA.length * 100) < 1e-9);
});

test('a chosen sum column is summed per category, not counted', () => {
  const rows = [['Сектор', 'Витрата'], ['а', 5], ['б', 7], ['а', 3]].map((cells, index) => ({ number: index + 1, cells }));
  const template = templateOf('columns');
  const plan = planImport(template.fields, { name: 'Т', rows }, { binding: { headerIndex: 0, picks: { category: 0, value: 1 } } });
  const model = chartModel(template, importRows(plan));
  assert.deepEqual(model.categories, ['а', 'б']);
  assert.deepEqual(model.series[0].values, [8, 7]);
});

test('empty category cells and blank rows are skipped and named, never invented', () => {
  const rows = [HEADERS, ...DATA.slice(0, 4), HEADERS.map(() => null), DATA[4].map((cell, index) => (index === COL['Літак'] ? null : cell))]
    .map((cells, index) => ({ number: index + 1, cells }));
  const fields = templateOf('columns').fields;
  const plan = planImport(fields, { name: 'Т', rows }, { binding: { headerIndex: 0, picks: { category: COL['Літак'], value: COUNT } } });
  assert.equal(plan.rows.length, 4);
  assert.equal(plan.skippedCount, 2);
  assert.deepEqual(plan.skipped.map(item => [item.reason, item.count]), [['немає даних у знайдених стовпцях', 2]]);
  assert.equal(importGaps(plan).complete, false, 'the import is partial and the user has to confirm it');
});

test('a record with the series but no category is named as lacking the category', () => {
  const rows = [HEADERS, DATA[0], DATA[1].map((cell, index) => (index === COL['Літак'] ? null : cell))]
    .map((cells, index) => ({ number: index + 1, cells }));
  const fields = templateOf('columns').fields;
  const picks = { category: COL['Літак'], series: COL['Результат'], value: COUNT };
  const plan = planImport(fields, { name: 'Т', rows }, { binding: { headerIndex: 0, picks } });
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.skipped.map(item => item.reason), ['немає значення в «Категорія»']);
});

test('without a pick for a required column the plan is blocked with a plain message', () => {
  const fields = templateOf('stacked-columns').fields;
  const plan = planImport(fields, sheet(), { binding: { headerIndex: HEADER_INDEX, picks: { category: COL['Літак'], value: COUNT } } });
  assert.match(plan.blocked, /^Вкажіть стовпці таблиці для обов'язкових колонок: Ряд\.$/u);
  assert.equal(plan.rows.length, 0);
});

test('a sheet without a header row can still be read when the user says so', () => {
  const rows = DATA.map((cells, index) => ({ number: index + 1, cells }));
  const fields = templateOf('columns').fields;
  const plan = planImport(fields, { name: 'Т', rows }, { binding: { headerIndex: -1, picks: { category: COL['Літак'], value: COUNT } } });
  assert.equal(plan.rows.length, DATA.length);
  assert.equal(plan.headerNumber, null);
  assert.equal(plan.found.find(item => item.key === 'category').from, `Стовпець ${COL['Літак'] + 1}`);
});

test('an unusable binding falls back to the automatic header search', () => {
  const fields = templateOf('columns').fields;
  const plan = planImport(fields, sheet(), { binding: { headerIndex: 999, picks: {} } });
  assert.match(plan.blocked, /рядка заголовків|обов'язкових стовпців/u);
});

test('preview text is trimmed and formatted for display', () => {
  assert.equal(previewText(null), '');
  assert.equal(previewText(1234.5), '1\u00a0234,5');
  assert.equal(previewText(true), 'так');
  assert.equal(previewText('x'.repeat(60)).length, 28);
  assert.ok(previewText('x'.repeat(60)).endsWith('…'));
});

test('mapping a column twice through suggestBinding never reuses it', () => {
  const result = suggestBinding(templateOf('columns').fields, columns(), { prefer: [COL['Літак'], COL['Літак'], COL['Результат']] });
  assert.equal(result.picks.category, COL['Літак']);
  assert.equal(result.picks.series, COL['Результат']);
});

test('a column the user left empty stays empty and is not refilled', () => {
  const template = templateOf('columns');
  const chosen = { prefer: [COL['Літак'], COL['Результат']] };
  assert.equal(bindTemplate(template, columns(), chosen).picks.series, COL['Результат']);
  const blocked = bindTemplate(template, columns(), { ...chosen, pinned: { series: NONE } });
  assert.equal(blocked.picks.series, undefined);
  assert.deepEqual(blocked.unused, [COL['Результат']], 'the column that lost its place is reported');
  const noCount = bindTemplate(template, columns(), { prefer: [COL['Літак']], pinned: { value: NONE } });
  assert.equal(noCount.picks.value, undefined, 'no automatic count over an empty slot');
  assert.equal(noCount.fit, false);
  assert.deepEqual(noCount.missing, ['value']);
});

test('the count can be chosen explicitly and shares the module with a real number', () => {
  const rows = [['Сектор', 'Витрата'], ...Array.from({ length: 6 }, (_, i) => [`с${i % 2}`, 4 + i * 3])].map((cells, index) => ({ number: index + 1, cells }));
  const profile = profileColumns(rows, 0);
  const both = bindTemplate(templateOf('grouped-columns'), profile, { prefer: [0, 1, COUNT] });
  assert.deepEqual(both.picks, { category: 0, primary_value: 1, secondary_value: COUNT });
  assert.equal(both.fit, true);
});

test('a real number wins over the count when the module has room for only one', () => {
  const rows = [['Сектор', 'Витрата'], ...Array.from({ length: 6 }, (_, i) => [`с${i % 2}`, 4 + i * 3])].map((cells, index) => ({ number: index + 1, cells }));
  const profile = profileColumns(rows, 0);
  const result = bindTemplate(templateOf('columns'), profile, { prefer: [0, COUNT, 1] });
  assert.deepEqual(result.picks, { category: 0, value: 1 });
  assert.deepEqual(result.unused, [COUNT]);
});
