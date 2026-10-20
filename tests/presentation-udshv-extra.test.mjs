import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationOf, artilleryPies, enemyArtillery, targetTypeChart, targetTypeOf } from '../src/presentation-udshv-extra.js';
import { DEFAULT_CONFIG, buildDeck, classifyTarget } from '../src/presentation-core.js';

// Лише синтетичні дані.
const record = (date, values) => ({ sheet: 'Х', rowNumber: 5, date, unit: 'А', values });

test('type of target: first match wins, equipment falls back to ОВТ, unknown objects are dropped', () => {
  const type = name => targetTypeOf(name, classifyTarget, DEFAULT_CONFIG);
  assert.equal(type('ПУ БпЛА'), 'ПУ БпЛА');
  assert.equal(type('КП, ПУ, КСП'), 'КСП');
  assert.equal(type('152 мм 2С19'), 'Артсистеми');
  assert.equal(type('Д-30'), 'Артсистеми');
  assert.equal(type('танк'), 'ОВТ');
  assert.equal(type('Склади БК, ПММ'), '');
});

test('target type chart sums destroyed and damaged by category', () => {
  const records = [
    record('2026-10-01', { 'destroyed|танк': 2, 'damaged|танк': 1, 'destroyed|КП, ПУ, КСП': 3, 'destroyed|152 мм 2С19': 1, 'damaged|ПУ БпЛА': 4, 'destroyed|Склади БК, ПММ': 9 }),
    record('2026-10-02', { 'destroyed|танк': 1, 'ammo|ВСЬОГО': 50 }),
  ];
  const chart = targetTypeChart(records, classifyTarget, DEFAULT_CONFIG);
  assert.deepEqual(chart.categories, ['ОВТ', 'ПУ БпЛА', 'КСП', 'Артсистеми', 'ІФС']);
  assert.deepEqual(chart.series.map(s => s.name), ['знищено', 'пошкоджено']);
  assert.deepEqual(chart.series[0].values, [3, 0, 3, 1, 0]);
  assert.deepEqual(chart.series[1].values, [1, 4, 0, 0, 0]);
});

test('artillery pies compare enemy artillery with our artillery losses for the last two weeks', () => {
  const workbook = { records: [record('2026-10-05', { 'destroyed|Д-30': 4 }), record('2026-10-12', { 'destroyed|152 мм 2С19': 2, 'damaged|М777': 1, 'destroyed|танк': 9 })] };
  const own = { records: [{ date: '2026-10-06', values: { 'destroyed|Д-30': 1, 'damaged|М777': 2 } }, { date: '2026-10-17', values: { 'destroyed|2С1': 1 } }, { date: '2026-10-17', suspect: true, values: { 'destroyed|2С1': 50 } }] };
  const pies = artilleryPies({ workbook, own, anchor: '2026-10-18', classify: classifyTarget, config: DEFAULT_CONFIG });
  assert.equal(pies.length, 2);
  assert.match(pies[0].title, /05\.10\.2026.11\.10\.2026/);
  assert.match(pies[1].title, /12\.10\.2026.18\.10\.2026/);
  assert.deepEqual(pies[0].values, [4, 3]);
  assert.deepEqual(pies[1].values, [3, 1]);
  assert.equal(enemyArtillery(workbook.records, classifyTarget, DEFAULT_CONFIG), 7);
});

test('annotation keeps the old panel text with titles', () => {
  const text = annotationOf({ changes: [{ text: 'А' }], attention: [], thirdTitle: 'Висновок', hypotheses: [{ text: 'Б' }] });
  assert.equal(text, ['Що змінилось', '• А', 'На що звернути увагу', '• Відхилень не виявлено.', 'Висновок', '• Б'].join('\n'));
});

test('УДШВ deck period slides carry the chart and the annotation; module group slides do not', () => {
  const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 1) + i * 864e5).toISOString().slice(0, 10));
  const wb = { kind: 'udshv', sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], issues: [], units: ['А'], records: dates.map((date, i) => record(date, { 'destroyed|танк': 1 + (i % 3), 'destroyed|КП, ПУ, КСП': 1, 'personnel|200': 2, 'ammo|ВСЬОГО': 10 })) };
  const deck = buildDeck(wb, { groups: [{ id: 'g', title: 'Група', units: ['А'] }] });
  for (const id of ['week', 'month', 'all']) {
    const slide = deck.slides.find(s => s.id === id);
    assert.equal(slide.targetChart.id, 'target-types');
    assert.match(slide.annotation, /^Що змінилось\n/);
  }
  const group = deck.slides.find(s => s.id === 'group:g');
  assert.equal(group.targetChart, undefined);
  assert.equal(group.tiles.length, 6);
});
