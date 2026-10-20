import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationOf, artilleryPies, enemyArtillery, targetTypeChart } from '../src/presentation-udshv-extra.js';
import { DEFAULT_CONFIG, buildDeck } from '../src/presentation-core.js';

// Лише синтетичні дані.
const record = (date, values) => ({ sheet: 'Х', rowNumber: 5, date, unit: 'А', values });

test('target type chart lists the columns of the «Втрати противника за категоріями» group, largest first', () => {
  const records = [
    record('2026-10-01', { 'categories|Артилерія': 2, 'categories|ПУ БпЛА': 5, 'categories|ІФС': 1, 'destroyed|танк': 9, 'ammo|ВСЬОГО': 40 }),
    record('2026-10-02', { 'categories|Артилерія': 3, 'categories|Танки, ББМ': 1, 'categories|Склади БК, ПММ': 0 }),
  ];
  const chart = targetTypeChart(records);
  assert.deepEqual(chart.categories, ['Артилерія', 'ПУ БпЛА', 'ІФС', 'Танки, ББМ']);
  assert.deepEqual(chart.series, [{ name: 'Уражено', values: [5, 5, 1, 1] }]);
});

test('artillery pies compare enemy artillery with our artillery losses for the last two weeks', () => {
  const workbook = { records: [record('2026-10-05', { 'categories|Артилерія': 4 }), record('2026-10-12', { 'categories|Артилерія': 3, 'categories|міномети': 7, 'destroyed|танк': 9 })] };
  const own = { records: [{ date: '2026-10-06', values: { 'destroyed|Д-30': 1, 'damaged|М777': 2 } }, { date: '2026-10-17', values: { 'destroyed|2С1': 1 } }, { date: '2026-10-17', suspect: true, values: { 'destroyed|2С1': 50 } }] };
  const pies = artilleryPies({ workbook, own, anchor: '2026-10-18', config: DEFAULT_CONFIG });
  assert.equal(pies.length, 2);
  assert.match(pies[0].title, /05\.10\.2026.11\.10\.2026/);
  assert.match(pies[1].title, /12\.10\.2026.18\.10\.2026/);
  assert.deepEqual(pies[0].values, [4, 3]);
  assert.deepEqual(pies[1].values, [3, 1]);
  assert.equal(enemyArtillery(workbook.records, { artilleryCategories: ['Артилерія', 'міномети'] }), 14);
});

test('annotation keeps the old panel text with titles', () => {
  const text = annotationOf({ changes: [{ text: 'А' }], attention: [], thirdTitle: 'Висновок', hypotheses: [{ text: 'Б' }] });
  assert.equal(text, ['Що змінилось', '• А', 'На що звернути увагу', '• Відхилень не виявлено.', 'Висновок', '• Б'].join('\n'));
});

test('УДШВ deck period slides carry the chart and the annotation; module group slides do not', () => {
  const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 1) + i * 864e5).toISOString().slice(0, 10));
  const wb = { kind: 'udshv', sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], issues: [], units: ['А'], records: dates.map((date, i) => record(date, { 'destroyed|танк': 1 + (i % 3), 'categories|Артилерія': 1, 'personnel|200': 2, 'ammo|ВСЬОГО': 10 })) };
  const deck = buildDeck(wb, { groups: [{ id: 'g', title: 'Група', units: ['А'] }] });
  for (const id of ['week', 'month', 'all']) {
    const slide = deck.slides.find(s => s.id === id);
    assert.equal(slide.targetChart.id, 'target-types');
    assert.match(slide.annotation, /^Що змінилось\n/);
  }
  const group = deck.slides.find(s => s.id === 'group:g');
  assert.equal(group.targetChart, undefined);
  assert.ok(group.tiles.length <= 6, 'слайд групи не має більше шести плиток');
});

test('tile arrows: growth of enemy losses is green, a fall is red; ammo per target stays «less is better»', () => {
  const dates = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 8, 1) + i * 864e5).toISOString().slice(0, 10));
  const wb = { kind: 'udshv', sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], issues: [], units: ['А'], records: dates.map((date, i) => record(date, { 'personnel|200': i < 13 ? 1 : 3, 'personnel|300': i < 13 ? 3 : 1, 'destroyed|танк': 1, 'ammo|ВСЬОГО': 10 })) };
  const week = buildDeck(wb, {}).slides.find(s => s.id === 'week');
  const tile = key => week.tiles.find(t => t.key === key);
  assert.equal(tile('kia').better, 'up');
  assert.equal(tile('wia').better, 'up');
  assert.equal(tile('ammoPerTarget').better, 'down');
  assert.ok(tile('kia').delta > 0 && tile('wia').delta < 0);
});
