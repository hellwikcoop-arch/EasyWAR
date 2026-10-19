import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATEGORY_LIMIT,
  CHART_KINDS,
  OTHER_LABEL,
  SERIES_LIMIT,
  assignSlots,
  chartModel,
  chartSummary,
  compactNumber,
  initialsOf,
  momentLabel,
  niceTicks,
  parseMoment,
  RIDGE_LIMIT,
  hourOf,
  takeoffHoursModel,
  tickerItems,
} from '../src/dashboard-module-charts-core.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

// Лише синтетичні дані: вигадані підрозділи, прізвища й числа.
const catalog = await rustCatalog();
const templateOf = id => {
  const item = catalog.find(entry => entry.id === id);
  if (!item) throw new Error(`немає шаблону ${id}`);
  return { ...item, templateId: item.id };
};
const modelOf = (id, rows) => chartModel(templateOf(id), rows);
// Intl ставить нерозривні пробіли між тисячами; у тестах порівнюємо зі звичайними.
const plain = value => String(value).replace(/[\u00a0\u202f]/gu, ' ');

test('numbers are compact and Ukrainian: thousands, millions, fractions, minus', () => {
  assert.equal(compactNumber(0), '0');
  assert.equal(compactNumber(42.456), '42,46');
  assert.equal(plain(compactNumber(1250)), '1 250');
  assert.equal(compactNumber(12500), '12,5 тис.');
  assert.equal(compactNumber(2_400_000), '2,4 млн');
  assert.equal(compactNumber(3_100_000_000), '3,1 млрд');
  assert.equal(compactNumber(-3.456), '−3,46');
  assert.equal(compactNumber(null), '—');
});

test('axis ticks are nice steps that always include zero and cover the data', () => {
  assert.deepEqual(niceTicks(0, 87).ticks, [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 0.7).ticks, [0, 0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual(niceTicks(12, 48).ticks, [0, 20, 40, 60], 'a positive minimum still starts at zero');
  assert.deepEqual(niceTicks(-30, 12, 4).ticks, [-30, -20, -10, 0, 10, 20]);
  assert.deepEqual(niceTicks(0, 0).ticks, [0, 0.25, 0.5, 0.75, 1], 'an all-zero series gets a unit scale');
  const big = niceTicks(0, 123456);
  assert.equal(big.max >= 123456, true);
  assert.ok(big.ticks.length <= 7);
});

test('moments are parsed from ISO dates and date-times and labelled briefly', () => {
  const date = parseMoment('2026-10-18');
  assert.deepEqual([date.year, date.month, date.day, date.hasTime], [2026, 10, 18, false]);
  const stamp = parseMoment('2026-10-18T07:05');
  assert.deepEqual([stamp.hour, stamp.minute, stamp.hasTime], [7, 5, true]);
  assert.equal(parseMoment('18.10.2026'), null);
  assert.equal(parseMoment('2026-13-01'), null);
  assert.equal(momentLabel(date), '18.10');
  assert.equal(momentLabel(date, { withYear: true }), '18.10.26');
  assert.equal(momentLabel(stamp, { withTime: true }), '18.10 07:05');
  assert.equal(momentLabel(date, { withTime: true }), '18.10', 'a bare date never shows 00:00');
});

test('series take palette slots in order of first appearance and never a ninth colour', () => {
  const slots = assignSlots(['Б', 'А', 'Б', 'В']);
  assert.deepEqual([...slots], [['Б', 1], ['А', 2], ['В', 3]]);
  const many = assignSlots(Array.from({ length: 11 }, (_, index) => `Р${index + 1}`));
  assert.equal(many.get('Р7'), 7);
  assert.equal(many.get('Р8'), SERIES_LIMIT, 'the eighth and later series share the last slot');
  assert.equal(many.get('Р11'), SERIES_LIMIT);
  assert.equal(many.get(OTHER_LABEL), SERIES_LIMIT);
});

test('every template builds an empty model of its own kind without rows', () => {
  for (const item of catalog) {
    const model = modelOf(item.id, []);
    const expected = item.id === 'flight-hours' ? 'horizontal-bar' : item.visualKind;
    assert.equal(model.kind, expected, item.id);
    assert.equal(model.empty, true, item.id);
    assert.equal(model.fallback, undefined, `${item.id}: ${model.fallback}`);
    assert.match(chartSummary(model), /даних ще немає$/u);
  }
  assert.deepEqual(new Set(CHART_KINDS), new Set(catalog.filter(item => item.id !== 'flight-hours').map(item => item.visualKind)));
});

test('a line chart sorts periods, groups series and leaves gaps where a series has no value', () => {
  const model = modelOf('line', [
    { period: '2026-10-03', value: 9, series: 'Б' },
    { period: '2026-10-01', value: 5, series: 'А' },
    { period: '2026-10-02', value: 7, series: 'А' },
    { period: '2026-10-02', value: 3, series: 'Б' },
    { period: '2026-10-02', value: 1, series: 'А' },
    { period: 'не дата', value: 100, series: 'А' },
  ]);
  assert.equal(model.kind, 'line');
  assert.deepEqual(model.categories, ['01.10', '02.10', '03.10']);
  assert.deepEqual(model.series.map(series => [series.name, series.slot, series.values]), [
    ['Б', 1, [null, 3, 9]],
    ['А', 2, [5, 8, null]],
  ]);
  assert.equal(model.legend, true);
  assert.deepEqual(model.scale.ticks, [0, 2, 4, 6, 8, 10]);
  assert.equal(model.valueText(8), '8');
  const single = modelOf('area', [{ period: '2026-10-01', value: 2 }, { period: '2027-01-05', value: 4 }]);
  assert.deepEqual(single.categories, ['01.10.26', '05.01.27'], 'two years → labels carry the year');
  assert.equal(single.series[0].name, 'Значення');
  assert.equal(single.legend, false, 'one series needs no legend');
});

test('columns keep category order and fold the tail into «Інші»; horizontal bars rank by value', () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({ category: `К${index + 1}`, value: index + 1 }));
  const columns = modelOf('columns', rows);
  assert.equal(columns.categories.length, CATEGORY_LIMIT);
  assert.equal(columns.categories.at(-1), OTHER_LABEL);
  assert.equal(columns.series[0].values.at(-1), 12 + 13 + 14 + 15, 'the folded categories are summed');
  const bars = modelOf('horizontal-bars', rows);
  assert.equal(bars.kind, 'horizontal-bar');
  assert.deepEqual(bars.categories.slice(0, 3), ['К15', 'К14', 'К13'], 'a rating is sorted descending');
  assert.equal(bars.categories.length, 10);
  assert.equal(bars.categories.at(-1), OTHER_LABEL);
  const stacked = modelOf('stacked-columns', [
    { category: 'А', value: 2, series: 'X' }, { category: 'А', value: 3, series: 'Y' }, { category: 'Б', value: 4, series: 'Y' },
  ]);
  assert.equal(stacked.kind, 'stacked-columns');
  assert.deepEqual(stacked.series.map(series => series.values), [[2, null], [3, 4]]);
});

test('grouped columns and the combo chart put two metrics on one scale', () => {
  const grouped = modelOf('grouped-columns', [{ category: 'А', primary_value: 10, secondary_value: 4 }, { category: 'Б', primary_value: 6 }]);
  assert.deepEqual(grouped.series.map(series => [series.name, series.values]), [['Основне значення', [10, 6]], ['Порівняльне значення', [4, null]]]);
  assert.equal(grouped.scale.max, 10);
  const combo = modelOf('combo', [
    { period: '2026-10-02', value: 7, reference_value: 6 },
    { period: '2026-10-01', value: 5, reference_value: 6 },
  ]);
  assert.equal(combo.kind, 'combo');
  assert.deepEqual(combo.categories, ['01.10', '02.10']);
  assert.deepEqual(combo.series.map(series => [series.mark, series.values]), [['column', [5, 7]], ['line', [6, 6]]]);
  assert.equal(combo.legend, true);
});

test('diverging bars share one symmetric scale and sum the gains and the losses', () => {
  const model = modelOf('diverging-bars', [
    { category: 'Поповнення', value: 12 }, { category: 'Ремонт', value: -4 }, { category: 'Втрати', value: -9 }, { category: 'Передано', value: 3 },
  ]);
  assert.deepEqual(model.items.map(item => item.label), ['Поповнення', 'Передано', 'Ремонт', 'Втрати']);
  assert.equal(model.scale.min, -model.scale.max);
  assert.ok(model.scale.max >= 12);
  assert.deepEqual([model.positive, model.negative], [15, -13]);
  assert.equal(model.valueText(-9), '−9');
});

test('a donut keeps the six largest slices, folds the rest and gives percents', () => {
  const rows = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Є', 'Ж'].map((category, index) => ({ category, value: 80 - index * 10 }));
  const model = modelOf('donut', rows);
  assert.equal(model.slices.length, 6);
  assert.equal(model.slices.at(-1).label, OTHER_LABEL);
  assert.equal(model.slices.at(-1).value, 30 + 20 + 10, 'five slices plus «Інші»');
  assert.equal(model.total, 80 + 70 + 60 + 50 + 40 + 30 + 20 + 10);
  assert.equal(Math.round(model.slices.reduce((sum, slice) => sum + slice.percent, 0)), 100);
  assert.deepEqual(model.slices.map(slice => slice.slot), [1, 2, 3, 4, 5, 6]);
  const zero = modelOf('donut', [{ category: 'А', value: 0 }, { category: 'Б', value: -3 }]);
  assert.deepEqual(zero.slices, [], 'zero and negative values make no slice');
});

test('progress rings and bars compute the percent of the target and keep their order', () => {
  const radial = modelOf('radial-progress', [{ label: 'План', current_value: 75, target_value: 100 }, { label: 'Понад', current_value: 130, target_value: 100 }]);
  assert.deepEqual(radial.items.map(item => [item.label, item.percent, item.currentText, item.targetText]), [['План', 75, '75', '100'], ['Понад', 100, '130', '100']]);
  const rings = modelOf('multi-ring', [
    { label: 'Третє', current_value: 1, target_value: 4, ring_order: 3 },
    { label: 'Перше', current_value: 2, target_value: 4, ring_order: 1 },
    { label: 'Без порядку', current_value: 3, target_value: 4 },
  ]);
  assert.deepEqual(rings.items.map(item => item.label), ['Перше', 'Третє', 'Без порядку']);
  const bars = modelOf('progress-bars', Array.from({ length: 10 }, (_, index) => ({ label: `П${index}`, current_value: index, target_value: 0 })));
  assert.equal(bars.items.length, 8);
  assert.equal(bars.items[3].percent, 0, 'a zero target never divides');
});

test('a gauge reads the latest row within its minimum and maximum', () => {
  const model = modelOf('gauge', [{ label: 'Старе', value: 10, maximum: 100 }, { label: 'Готовність', value: 43, minimum: 20, maximum: 120 }]);
  assert.equal(model.label, 'Готовність');
  assert.equal(Math.round(model.ratio * 100), 23);
  assert.deepEqual([model.minText, model.maxText, model.valueText], ['20', '120', '43']);
  const over = modelOf('gauge', [{ label: 'X', value: 500, maximum: 100 }]);
  assert.equal(over.ratio, 1);
});

test('a radar normalises every series to the common maximum over up to eight axes', () => {
  const rows = ['Швидкість', 'Захист', 'Вогонь', 'Зв’язок'].flatMap(axis => [{ axis, value: 4, series: 'А' }, { axis, value: 8, series: 'Б' }]);
  const model = modelOf('radar', rows);
  assert.deepEqual(model.axes, ['Швидкість', 'Захист', 'Вогонь', 'Зв’язок']);
  assert.deepEqual(model.series.map(series => series.ratios), [[0.5, 0.5, 0.5, 0.5], [1, 1, 1, 1]]);
  assert.equal(model.legend, true);
});

test('a calendar shows the latest month as a Monday-first grid with the day values', () => {
  const model = modelOf('calendar', [
    { date: '2026-10-01', value: 2 }, { date: '2026-10-01', value: 3 }, { date: '2026-10-31', value: 9 }, { date: '2026-09-15', value: 1 },
  ]);
  assert.equal(model.title, 'жовтень 2026');
  assert.equal(model.note, 'Показано останній місяць із 2');
  assert.deepEqual(model.days, ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд']);
  assert.equal(model.weeks.length, 5);
  assert.deepEqual(model.weeks[0].slice(0, 4).map(cell => cell && cell.day), [null, null, null, 1], '1 October 2026 is a Thursday');
  assert.equal(model.weeks[0][3].value, 5, 'two records on one day are summed');
  assert.equal(model.weeks[4][5].day, 31);
  assert.equal(model.weeks[4][5].value, 9);
  assert.equal(model.weeks[4][6], null, 'cells after the month end stay blank');
  assert.equal(model.max, 9);
  assert.equal(model.filled, 2);
});

test('a cohort matrix orders numeric periods numerically and scales to its extremes', () => {
  const model = modelOf('cohort', [
    { cohort: 'Січень', period: '10', value: 60 }, { cohort: 'Січень', period: '2', value: 90 }, { cohort: 'Січень', period: '1', value: 100 },
    { cohort: 'Лютий', period: '1', value: 100 }, { cohort: 'Лютий', period: '2', value: 85 },
  ]);
  assert.deepEqual(model.cohorts, ['Січень', 'Лютий']);
  assert.deepEqual(model.periods, ['1', '2', '10']);
  assert.deepEqual(model.grid, [[100, 90, 60], [100, 85, null]]);
  assert.deepEqual([model.min, model.max], [60, 100]);
});

test('the table shows the first rows with progress, status tone and note', () => {
  const model = modelOf('table', [
    { label: 'Платформа', value: 12, progress: 80, status: 'Готово', note: 'x' },
    { label: 'Ремонт', value: 3, progress: 140, status: 'Затримка' },
    { label: 'Без стану', value: 1 },
  ]);
  assert.equal(model.hasProgress, true);
  assert.deepEqual(model.items.map(item => [item.label, item.progress, item.tone]), [['Платформа', 80, 'good'], ['Ремонт', 100, 'warn'], ['Без стану', null, '']]);
  assert.equal(model.items[0].note, 'x');
  assert.equal(modelOf('table', Array.from({ length: 9 }, (_, index) => ({ label: `Р${index}`, value: index }))).more, 3);
});

test('a funnel follows the stage order and measures every stage against the first', () => {
  const model = modelOf('funnel', [
    { stage: 'Виконано', value: 25, stage_order: 3 }, { stage: 'Заплановано', value: 100, stage_order: 1 }, { stage: 'Розпочато', value: 50, stage_order: 2 },
  ]);
  assert.deepEqual(model.stages.map(stage => [stage.label, stage.ratio, stage.percent]), [['Заплановано', 1, 100], ['Розпочато', 0.5, 50], ['Виконано', 0.25, 25]]);
});

test('the map keeps only valid coordinates and weights points by value', () => {
  const model = modelOf('map', [
    { label: 'А', latitude: 50.45, longitude: 30.52, value: 100, status: 'Готово' },
    { label: 'Б', latitude: 49.99, longitude: 36.23, value: 25 },
    { label: 'Поза', latitude: 95, longitude: 30, value: 1 },
    { label: 'Без координат', value: 1 },
  ]);
  assert.equal(model.points.length, 2);
  assert.equal(model.skipped, 2);
  assert.deepEqual(model.points.map(point => [point.label, point.weight, point.tone]), [['А', 1, 'good'], ['Б', 0.5, '']]);
});

test('the activity feed shows the newest events first with time, status and value', () => {
  const model = modelOf('activity', [
    { occurred_at: '2026-10-18T08:00', label: 'Старе', status: 'Готово', value: 1 },
    { occurred_at: '2026-10-18T09:30', label: 'Нове', status: 'Збій', value: 2 },
    { occurred_at: 'колись', label: 'Без часу' },
  ]);
  assert.deepEqual(model.items.map(item => [item.time, item.label, item.tone, item.valueText]), [['18.10 09:30', 'Нове', 'bad', '2'], ['18.10 08:00', 'Старе', 'good', '1']]);
  assert.equal(model.more, 1);
});

test('the waveform mirrors the upper and lower values per moment', () => {
  const model = modelOf('waveform', [
    { occurred_at: '2026-10-01T10:00', positive_value: 4, negative_value: 2 },
    { occurred_at: '2026-10-01T10:00', positive_value: 1, negative_value: -1 },
    { occurred_at: '2026-10-01T09:00', positive_value: 2, negative_value: 3 },
  ]);
  assert.deepEqual(model.points.map(point => [point.label, point.up, point.down]), [['01.10 09:00', 2, 3], ['01.10 10:00', 5, 1]]);
  assert.equal(model.max, 5);
  assert.deepEqual([model.upLabel, model.downLabel], ['Верхнє значення', 'Нижнє значення']);
});

test('a KPI shows the latest value with its unit, delta and a short history', () => {
  const model = modelOf('kpi', [
    { label: 'Готовність', value: 80, unit: '%', delta: 2.5 },
    { label: 'Готовність', value: 84.5, unit: '%', delta: -1.25 },
  ]);
  assert.deepEqual([model.label, model.valueText, model.unit, model.deltaText], ['Готовність', '84,5', '%', '−1,3 %']);
  assert.deepEqual(model.history, [80, 84.5]);
  const single = modelOf('kpi', [{ label: 'Наліт', value: 1234.5 }]);
  assert.deepEqual([plain(single.valueText), single.deltaText, single.history], ['1 234,5', '', []]);
  assert.match(plain(chartSummary(single)), /^Ключовий показник: 1 запис, Наліт: 1 234,5$/u);
});

test('a leaderboard ranks by value with initials, group and delta', () => {
  const model = modelOf('leaderboard', [
    { label: 'Тестенко І. П.', group: '1 АЕ', value: 42, delta: 8 },
    { label: 'Зразкович О.', group: '2 АЕ', value: 61, delta: -2 },
    { label: '3 ескадрилья', value: 30 },
  ]);
  assert.deepEqual(model.items.map(item => [item.rank, item.label, item.initials, item.group, item.ratio, item.deltaText]), [
    [1, 'Зразкович О.', 'ЗО', '2 АЕ', 1, '−2 %'],
    [2, 'Тестенко І. П.', 'ТІ', '1 АЕ', 42 / 61, '+8 %'],
    [3, '3 ескадрилья', '3Е', '', 30 / 61, ''],
  ]);
  assert.equal(initialsOf(''), '—');
});

test('the flight journal is always drawn as airborne and total hours per aircraft type', () => {
  const model = modelOf('flight-hours', [
    { aircraft_type: 'Мі-8', airborne_hours: 0.5, total_hours: 0.75 },
    { aircraft_type: 'Мі-8', airborne_hours: 1, total_hours: 1.25 },
    { aircraft_type: 'Мі-24', airborne_hours: 2, total_hours: 2.5 },
  ]);
  assert.equal(model.kind, 'horizontal-bar');
  assert.deepEqual(model.categories, ['Мі-24', 'Мі-8']);
  assert.deepEqual(model.series.map(series => [series.name, series.values]), [['Наліт у повітрі', [2, 1.5]], ['Загальний наліт', [2.5, 2]]]);
  assert.equal(model.valueText(1.5), '1:30', 'hours are shown as год:хв');
  assert.match(chartSummary(model), /^Горизонтальні смуги: 3 записи, 2 ряди$/u);
});

test('a broken module never breaks the dashboard: the model falls back to a table', () => {
  const model = chartModel({ visualKind: 'line', fields: [{ key: 'period', label: 'Період', dataType: 'date', role: 'dimension', aggregation: 'none', required: true }] }, [{ period: '2026-10-01' }]);
  assert.equal(model.kind, 'line');
  const broken = chartModel({ visualKind: 'radar', fields: null }, [{ a: 1 }]);
  assert.equal(broken.kind, 'radar');
  assert.equal(broken.empty, false);
  assert.equal(chartModel(null, null).kind, 'table');
});

// ---------------------------------------------------------------------------------------------
// Контракти малювання й палітри (файли читаються як текст: DOM у node немає)

import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the renderer draws every kind, stays local and never writes markup as text', async () => {
  const source = await read('../src/dashboard-module-charts.js');
  const renderers = source.slice(source.indexOf('const RENDERERS = {'), source.indexOf('};', source.indexOf('const RENDERERS = {')));
  for (const kind of CHART_KINDS) assert.ok(new RegExp(`(^|\\n)\\s+'?${kind}'?[,:]`, 'u').test(renderers), `немає малювання для ${kind}`);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/u);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|import\(/u, 'нічого не вантажиться під час роботи');
  assert.match(source, /from '\.\/dashboard-module-geo\.js'/u, 'контур карти вбудований, а не читається з файла');
  assert.match(source, /ResizeObserver/u, 'діаграма перемальовується під ширину картки');
  assert.match(source, /role: 'img', 'aria-label': chartSummary\(model\)/u, 'кожна діаграма має словесний підпис');
  assert.match(source, /svgTitle/u, 'значення доступні в підказках позначок');
  // Марки за специфікацією: тонкі стовпчики (до 24 px), лінії 2 px, маркери r=4 з кільцем кольору поверхні.
  assert.match(source, /const BAR_MAX = 24;/u);
  assert.match(source, /r: 4, fill: color, class: 'ewmc-marker'/u);
  const geo = await read('../src/dashboard-module-geo.js');
  assert.match(geo, /ODbL/u, 'джерело контуру вказано');
  assert.match(geo, /export const UKRAINE_OUTLINE = \[\[\[/u);
});

test('the catalog page mounts real charts from table rows instead of sketches', async () => {
  const source = await read('../src/dashboard-module-catalog.js');
  const css = await read('../src/dashboard-module-catalog.css');
  assert.match(source, /import \{ chartModel, takeoffHoursModel, tickerItems \} from '\.\/dashboard-module-charts-core\.js';/u);
  assert.match(source, /import \{ mountChart \} from '\.\/dashboard-module-charts\.js';/u);
  assert.match(source, /mountChart\(host, chartModel\(template, rows\), \{ height: compact \? 120 : 168, compact \}\)/u);
  assert.match(source, /visual\(module, rows\)/u, 'картка модуля малюється з його рядків');
  assert.match(source, /visual\(item, sampleRows\(item\), true\)/u, 'картка каталогу — із синтетичних рядків');
  assert.doesNotMatch(source, /ewmc-columns|ewmc-ring |ewmc-cells|ewmc-mini-table/u, 'старих ескізів немає');
  for (const kind of CHART_KINDS) assert.ok(source.includes(`'${kind}'`), `немає синтетичних рядків для ${kind}`);
  assert.doesNotMatch(source, /Тестенко|Зразкович|Прикладний/u, 'у прев\'ю каталогу немає прізвищ');
  // Палітра: вісім слотів для обох тем, перевірених dataviz/validate_palette.js (темна: поверхня #142238, світла: #f3f8fd).
  const dark = ['#049fd6', '#d57703', '#05ac7d', '#a278e4', '#b08e05', '#d863a0', '#5a8ff3', '#e3645e'];
  const light = ['#017fab', '#b05a02', '#038a5a', '#8557c8', '#936e03', '#b94082', '#396ed6', '#c43f3e'];
  dark.forEach((hex, index) => assert.ok(css.includes(`--ewmc-s${index + 1}:${hex}`), `темний слот ${index + 1}`));
  light.forEach((hex, index) => assert.ok(css.includes(`--ewmc-s${index + 1}:${hex}`), `світлий слот ${index + 1}`));
  assert.match(css, /--ewmc-pos:var\(--ewmc-s1\);--ewmc-neg:var\(--ewmc-s8\)/u, 'розбіжна пара синій ↔ червоний');
  assert.match(css, /\.ewmc-line\{fill:none;stroke-width:2;/u);
  assert.match(css, /\.ewmc-marker\{stroke:var\(--ewmc-surface\);stroke-width:2\}/u);
  assert.match(css, /\.ewmc-grid\{stroke:var\(--ewmc-grid\);stroke-width:1\}/u, 'сітка — тонка суцільна');
  assert.doesNotMatch(css, /stroke-dasharray/u, 'без пунктирних сіток');
});

test('ridgeline: hour of day from HH:MM text or ISO date-time, invalid times skipped', () => {
  assert.equal(hourOf('08:10'), 8);
  assert.equal(hourOf('8.05'), 8);
  assert.equal(hourOf('23:59'), 23);
  assert.equal(hourOf('25:00'), null);
  assert.equal(hourOf('12:75'), null);
  assert.equal(hourOf('2026-10-18T14:30'), 14);
  assert.equal(hourOf('2026-10-18'), null);
  assert.equal(hourOf(''), null);
  assert.equal(hourOf(null), null);
});

test('ridgeline template: ridges by series, sorted by total, peak hour and count', () => {
  const rows = [
    { occurred_at: '2026-10-01T09:10', series: 'Тест-А' },
    { occurred_at: '2026-10-02T09:40', series: 'Тест-А' },
    { occurred_at: '2026-10-03T15:00', series: 'Тест-А' },
    { occurred_at: '2026-10-01T21:00', series: 'Тест-Б' },
    { occurred_at: '2026-10-01', series: 'Тест-Б' },
  ];
  const model = modelOf('ridgeline', rows);
  assert.equal(model.kind, 'ridgeline');
  assert.equal(model.skipped, 1);
  assert.deepEqual(model.series.map(item => item.name), ['Тест-А', 'Тест-Б']);
  const [first, second] = model.series;
  assert.equal(first.values.length, 24);
  assert.equal(first.total, 3);
  assert.equal(first.peakHour, 9);
  assert.equal(first.peakText, '09:00 · 2 под.');
  assert.equal(second.peakHour, 21);
  assert.deepEqual([first.slot, second.slot], [1, 2]);
  // Згладжування по колу доби: 23:00 отримує частку від 21:00, а 00:00 — від 23:00.
  assert.ok(second.smooth[23] > 0 && second.smooth[0] === 0 && second.smooth[22] > second.smooth[23]);
  assert.ok(model.max >= Math.max(...first.smooth));
  assert.equal(model.hours[0], '00:00');
  assert.match(chartSummary(model), /^Гребені за годинами доби: 5 записів, 2 ряди, пік Тест-А о 09:00/u);
});

test('ridgeline: weight from value field, more than six series fold into «Інші»', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ occurred_at: `2026-10-01T${String(10 + index).padStart(2, '0')}:00`, series: `Ряд ${index + 1}`, value: 10 - index }));
  const model = modelOf('ridgeline', rows);
  assert.equal(model.series.length, RIDGE_LIMIT);
  assert.equal(model.series.at(-1).name, OTHER_LABEL);
  assert.equal(model.series.at(-1).total, 5 + 4 + 3);
  assert.equal(model.series[0].total, 10);
  assert.equal(model.unit, '');
});

test('flight journal: takeoffs by hour per aircraft type, rows without valid takeoff time skipped', () => {
  const rows = [
    { aircraft_type: 'Тестовий-1', takeoff_time: '08:10', airborne_hours: 1, total_hours: 1.5 },
    { aircraft_type: 'Тестовий-1', takeoff_time: '08:50', airborne_hours: 1, total_hours: 1.5 },
    { aircraft_type: 'Тестовий-2', takeoff_time: '14:25', airborne_hours: 1, total_hours: 1.5 },
    { aircraft_type: 'Тестовий-2', takeoff_time: '25:00', airborne_hours: 1, total_hours: 1.5 },
    { aircraft_type: 'Тестовий-2', airborne_hours: 1, total_hours: 1.5 },
  ];
  const module = templateOf('flight-hours');
  const model = takeoffHoursModel(module, rows);
  assert.equal(model.kind, 'ridgeline');
  assert.equal(model.title, 'Зльоти за годинами доби');
  assert.equal(model.rowCount, 5);
  assert.equal(model.skipped, 2);
  assert.deepEqual(model.series.map(item => [item.name, item.total, item.peakHour]), [['Тестовий-1', 2, 8], ['Тестовий-2', 1, 14]]);
  assert.equal(model.series[0].peakText, '08:00 · 2 зл.');
  // Сама картка журналу лишається смугами нальоту.
  assert.equal(chartModel(module, rows).kind, 'horizontal-bar');
  assert.equal(takeoffHoursModel(module, []).empty, true);
});

test('ticker: one item per module from the same rows as its card, unread data marked', () => {
  const ridge = { ...templateOf('ridgeline'), id: 'm-1', title: 'Тестові події' };
  const kpiModule = { ...templateOf('kpi'), id: 'm-2', title: 'Тестовий показник' };
  const data = new Map([
    ['m-1', { rows: [{ occurred_at: '2026-10-01T09:10', series: 'Тест-А' }], failed: false }],
    ['m-2', { rows: [], failed: true }],
  ]);
  const items = tickerItems([ridge, kpiModule], data);
  assert.deepEqual(items.map(item => [item.id, item.title, item.failed]), [['m-1', 'Тестові події', false], ['m-2', 'Тестовий показник', true]]);
  assert.match(items[0].text, /^1 запис, пік Тест-А о 09:00/u);
  assert.equal(items[1].text, 'дані не прочитано');
  assert.deepEqual(tickerItems(null, null), []);
});

test('dashboard: ticker under the grid and HUD corners only in the dark theme, motion can be reduced', async () => {
  const source = await read('../src/dashboard-module-catalog.js');
  const css = await read('../src/dashboard-module-catalog.css');
  assert.match(source, /host\.append\(grid, ticker\(tickerItems\(state\.modules, state\.data\)\)\)/u);
  assert.match(source, /el\('ul', \{ 'aria-hidden': 'true' \}/u, 'друга копія рядка прихована від читачів екрана');
  assert.match(css, /@keyframes ewmc-ticker/u);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.ewmc-ticker\{[^}]*\}\.ewmc-ticker-track\{animation:none\}/u);
  assert.match(css, /animation-play-state:paused/u);
  assert.match(css, /html:not\(\[data-theme=light\]\) \.ewmc-module\{--ewmc-hud:/u);
  assert.doesNotMatch(css, /html\[data-theme=light\] \.ewmc-module\{[^}]*--ewmc-hud/u);
});

test('progress bars: segmented «pills», filled share rounds to the nearest segment and never overflows', () => {
  const rows = [
    { label: 'Тест-1', current_value: 62, target_value: 100, ring_order: 1 },
    { label: 'Тест-2', current_value: 0, target_value: 100, ring_order: 2 },
    { label: 'Тест-3', current_value: 140, target_value: 100, ring_order: 3 },
    { label: 'Тест-4', current_value: 5, ring_order: 4 },
  ];
  const model = modelOf('progress-bars', rows);
  assert.equal(model.segments, 8);
  assert.deepEqual(model.items.map(item => item.filled), [5, 0, 8, 0]);
});

test('progress bars render pills and glow only in the dark theme', async () => {
  const renderers = await read('../src/dashboard-module-charts.js');
  const css = await read('../src/dashboard-module-catalog.css');
  assert.match(renderers, /class: 'ewmc-pills'/u);
  assert.match(css, /\.ewmc-pills\{/u);
  assert.match(css, /html:not\(\[data-theme=light\]\) \.ewmc-pills i\.on\{[^}]*drop-shadow/u);
});

test('every Rust catalog template survives the frontend whitelist, so a new chart kind is never dropped silently', async () => {
  const { normalizeCatalog } = await import('../src/dashboard-module-catalog-core.js');
  const kept = normalizeCatalog(catalog).map(item => item.id);
  assert.deepEqual(kept, catalog.map(item => item.id), 'вид шаблону з Rust має бути у VISUAL_KINDS (dashboard-module-catalog-core.js)');
});

test('polar «threat sector»: azimuth wraps to 0–360, invalid rows skipped, threat statuses are red', () => {
  const rows = [
    { label: 'Ціль-1', azimuth: 370, range_km: 12, status: 'Загроза' },
    { label: 'Ціль-2', azimuth: -90, range_km: 4.5, status: 'Атака' },
    { label: 'Ціль-3', azimuth: 180, range_km: 30, status: 'Супровід' },
    { label: 'Ціль-4', azimuth: 45, range_km: -1 },
    { label: 'Ціль-5', range_km: 3 },
  ];
  const model = modelOf('threat-sector', rows);
  assert.equal(model.kind, 'polar');
  assert.equal(model.skipped, 2);
  assert.deepEqual(model.points.map(point => [point.label, point.azimuth, point.tone]), [['Ціль-1', 10, 'bad'], ['Ціль-2', 270, 'bad'], ['Ціль-3', 180, 'neutral']]);
  assert.equal(model.rings.at(-1), model.maxRange);
  assert.ok(model.maxRange >= 30);
  assert.equal(model.points[0].rangeText, '12 км');
  assert.equal(model.nearest.label, 'Ціль-2');
  assert.match(chartSummary(model), /^Сектор загроз: 5 записів, найближча Ціль-2 — 4,5 км/u);
});
