import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateCatalog } from '../src/catalog-core.js';
import {
  computeTile,
  computeTiles,
  dayNumber,
  formatInt,
  formatRatio,
  periodDays,
  pluralForm,
} from '../src/tiles-core.js';

const DOC = await readFile(new URL('../docs/CATALOG.md', import.meta.url), 'utf8');
const EXAMPLE_TEXT = DOC.match(/<!-- catalog-example -->\s*```json\n([\s\S]*?)\n```/)?.[1];
assert.ok(EXAMPLE_TEXT, 'у docs/CATALOG.md має бути блок прикладу після <!-- catalog-example -->');

const checked = (catalog) => {
  const result = validateCatalog(catalog);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.catalog;
};
const CATALOG = checked(JSON.parse(EXAMPLE_TEXT));

const PERIOD = { from: '2026-08-01', to: '2026-08-10' };
const flight = (date, extra = {}) => ({ 'col.date': date, ...extra });

/** Малий набір записів журналу польотів: 6 польотів, 2 нічних, 2 борти. */
const FLIGHTS = [
  flight('2026-08-01', { 'col.aircraft': 'Мі-8', 'col.hours': 1.5, 'col.night': false, 'col.tail': 'A1', 'col.mission': 'Бойовий' }),
  flight('2026-08-01', { 'col.aircraft': 'Мі-8', 'col.hours': 2, 'col.night': true, 'col.tail': 'A1', 'col.mission': 'Бойовий' }),
  flight('2026-08-01', { 'col.aircraft': 'Ка-52', 'col.hours': 1, 'col.night': false, 'col.tail': 'B2', 'col.mission': 'Тренувальний' }),
  flight('2026-08-04', { 'col.aircraft': 'Мі-8', 'col.hours': 0.5, 'col.night': true, 'col.tail': 'A1', 'col.mission': 'Тренувальний' }),
  flight('2026-08-07', { 'col.aircraft': 'Ка-52', 'col.hours': 3, 'col.night': false, 'col.tail': 'B2', 'col.mission': 'Бойовий' }),
  flight('2026-08-09', { 'col.aircraft': 'Мі-24', 'col.hours': 1, 'col.night': false, 'col.tail': 'C3', 'col.mission': 'Перегін' }),
];

const tile = (id, rows = FLIGHTS, extra = {}) => computeTile(CATALOG, id, { rows, period: PERIOD, ...extra });

/* ------------------------------------------------------------------ */
/*  Допоміжні функції                                                  */
/* ------------------------------------------------------------------ */

test('dayNumber і periodDays: дати рррр-мм-дд, період включно, мінімум одна доба', () => {
  assert.equal(dayNumber('1970-01-02'), 1);
  assert.equal(dayNumber('2026-08-10') - dayNumber('2026-08-01'), 9);
  for (const bad of ['', '2026-8-1', '01.08.2026', null, undefined, 20260801]) assert.ok(Number.isNaN(dayNumber(bad)), String(bad));
  assert.equal(periodDays('2026-08-01', '2026-08-10'), 10);
  assert.equal(periodDays('2026-08-01', '2026-08-01'), 1);
  assert.equal(periodDays('2026-08-10', '2026-08-01'), 1, 'перевернутий період дає одну добу, а не нуль чи мінус');
  assert.equal(periodDays('', ''), 1);
  assert.equal(periodDays(undefined, '2026-08-01'), 1);
});

test('pluralForm: українські форми для 1, 2–4, 5+ і виняток 11–19', () => {
  const forms = ['виліт', 'вильоти', 'вильотів'];
  const expected = { 0: 2, 1: 0, 2: 1, 4: 1, 5: 2, 11: 2, 12: 2, 14: 2, 19: 2, 21: 0, 22: 1, 25: 2, 101: 0, 111: 2, 112: 2 };
  for (const [n, index] of Object.entries(expected)) assert.equal(pluralForm(Number(n), forms), forms[index], n);
});

test('formatInt і formatRatio: українська локаль, одна цифра після коми', () => {
  assert.equal(formatInt(1234.5), (1235).toLocaleString('uk-UA'));
  assert.equal(formatInt(0), '0');
  assert.equal(formatRatio(1.25), (1.3).toLocaleString('uk-UA'), '1,25 округлюється до однієї цифри');
  assert.equal(formatRatio(2), '2');
  assert.equal(formatRatio(0.04), '0');
});

/* ------------------------------------------------------------------ */
/*  Значення, ряди, підписи                                            */
/* ------------------------------------------------------------------ */

test('кількість і сума: значення, текст, візуальна форма, тон', () => {
  const flights = tile('tile.flights');
  assert.equal(flights.value.number, 6);
  assert.equal(flights.value.text, '6');
  assert.equal(flights.visual, 'bars');
  assert.equal(flights.tone, 'blue');
  assert.equal(flights.icon, 'plane');
  assert.equal(flights.sub, 'Усього записів');
  assert.equal(flights.hidden, false);

  const hours = tile('tile.hours');
  assert.equal(hours.value.number, 9);
  assert.equal(hours.value.text, '9');
  assert.equal(hours.opens, 'block.dynamics');
});

test('порожні записи: нулі, а середнє й частка не вигадуються', () => {
  const flights = tile('tile.flights', []);
  assert.equal(flights.value.text, '0');
  assert.deepEqual(flights.bars, []);
  assert.equal(flights.extras[0].text, '0 польотів/день');

  const night = tile('tile.night', []);
  assert.equal(night.value.text, '0%');
  assert.equal(night.ring.percent, 0);

  const perAircraft = tile('tile.hours-per-aircraft', []);
  assert.equal(perAircraft.value.number, null);
  assert.equal(perAircraft.value.text, '—', 'ділення на нуль — прочерк');
});

test('стовпчики: підсумок за місяцями, останні шість, записи без дати пропускаються', () => {
  const rows = [];
  for (let month = 1; month <= 8; month += 1) {
    for (let k = 0; k < month; k += 1) rows.push(flight(`2026-${String(month).padStart(2, '0')}-0${k + 1}`));
  }
  rows.push(flight(''), flight('не дата'), { 'col.aircraft': 'Мі-8' });
  const model = tile('tile.flights', rows, { period: { from: '2026-01-01', to: '2026-08-31' } });
  assert.equal(model.value.number, 36 + 3, 'у загальне значення потрапляють і записи без дати');
  assert.deepEqual(model.bars, [3, 4, 5, 6, 7, 8].map((month) => ({ key: `2026-0${month}`, value: month })));
});

test('середній темп: ділення на доби періоду, відмінок за значенням', () => {
  const one = (count, period) => tile('tile.flights', Array.from({ length: count }, () => flight('2026-08-01')), { period });
  const ten = { from: '2026-08-01', to: '2026-08-10' };
  assert.equal(one(10, ten).extras[0].text, '1 політ/день');
  assert.equal(one(20, ten).extras[0].text, '2 польоти/день');
  assert.equal(one(50, ten).extras[0].text, '5 польотів/день');
  assert.equal(one(15, ten).extras[0].text, '1,5 польоту/день');
  assert.equal(one(110, ten).extras[0].text, '11 польотів/день');
  assert.equal(one(3, { from: '2026-08-01', to: '2026-08-01' }).extras[0].text, '3 польоти/день');
  assert.equal(one(1, { from: '2026-08-01', to: '2026-08-03' }).extras[0].text, '0,3 польоту/день');
  assert.equal(one(2, ten).extras[0].icon, 'avg');
  assert.equal(one(2, ten).extras[0].label, 'Середній темп');
});

test('підказка: речення й факти через крапку, порожній top не потрапляє', () => {
  const info = tile('tile.flights').info;
  assert.equal(info, 'Один запис — один політ. Нічних: 2. Макс. за добу: 3. Ка-52 4 · Мі-8 4', 'за рівності ваг — за назвою: «Ка-52» перед «Мі-8»');

  const noAircraft = tile('tile.flights', FLIGHTS.map(({ 'col.aircraft': _, ...row }) => row)).info;
  assert.equal(noAircraft, 'Один запис — один політ. Нічних: 2. Макс. за добу: 3', 'без значень top підказка не ламається');

  assert.equal(tile('tile.hours').info, null, 'без `info` у плитці його немає в моделі');
});

test('top: вага за стовпцем, порядок за значенням і потім за назвою, синоніми зводяться до списку', () => {
  const rows = [
    flight('2026-08-01', { 'col.aircraft': 'Mi-8', 'col.hours': 2 }),
    flight('2026-08-02', { 'col.aircraft': 'Мі-8', 'col.hours': 1 }),
    flight('2026-08-03', { 'col.aircraft': 'ка-52', 'col.hours': 3 }),
    flight('2026-08-04', { 'col.aircraft': 'Мі-24', 'col.hours': 0 }),
  ];
  const info = tile('tile.flights', rows).info;
  assert.match(info, /Ка-52 3 · Мі-8 3$/, 'Mi-8 і Мі-8 — один борт, «ка-52» — Ка-52; Мі-24 з нульовою вагою не показується');
});

test('кільце: частка й кількість з відбором, підписи', () => {
  const share = tile('tile.night');
  assert.ok(Math.abs(share.value.number - 100 / 3) < 1e-9);
  assert.equal(share.value.text, '33%');
  assert.equal(share.ring.percent, 33);
  assert.equal(share.ring.label, 'Частка нічних польотів');
  assert.equal(share.ring.caption, 'Нічним вважається політ із позначкою');

  const count = tile('tile.night-count');
  assert.equal(count.value.number, 2);
  assert.equal(count.value.text, '2');
  assert.equal(count.ring.percent, 33);
  assert.equal(count.ring.label, 'Частка нічних від усіх польотів');
  assert.equal(count.ring.caption, undefined);
  assert.equal(count.info, 'Мін. за місяць: 2');
});

test('пара: ряд за останні дванадцять місяців і два додаткові показники', () => {
  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    rows.push(flight(`2025-${String(month).padStart(2, '0')}-10`, { 'col.mission': 'Бойовий', 'col.aircraft': 'Мі-8' }));
  }
  rows.push(flight('2026-01-10', { 'col.mission': 'Бойовий', 'col.aircraft': 'Ка-52' }));
  rows.push(flight('2026-01-11', { 'col.mission': 'Тренувальний', 'col.aircraft': 'Ка-52' }));
  const model = tile('tile.combat', rows, { period: { from: '2025-01-01', to: '2026-01-31' } });
  assert.equal(model.series.length, 12);
  assert.equal(model.series[0].key, '2025-02', 'тринадцятий місяць відсікається з початку');
  assert.equal(model.series[11].key, '2026-01');
  assert.equal(model.series[11].value, 1);
  assert.deepEqual(model.extras.map((extra) => extra.label), ['Тренувальні', 'Найчастіший борт']);
  assert.deepEqual(model.extras.map((extra) => extra.text), ['1', 'Мі-8 12']);
});

test('показник на одиницю: наліт на борт ділиться на кількість різних бортів', () => {
  const model = tile('tile.hours-per-aircraft');
  assert.equal(model.value.number, 3);
  assert.equal(model.value.text, '3');
  const fractional = tile('tile.hours-per-aircraft', FLIGHTS.slice(0, 4));
  assert.equal(fractional.value.text, formatRatio(5 / 2));
});

test('підсумок за добу, тиждень і місяць: найбільший і найменший серед періодів із записами', () => {
  const catalog = checked({
    format: 'easywar.catalog', version: 1, id: 'cat.peaks', title: 'Піки', layer: 'builtin',
    columns: [
      { id: 'col.d', type: 'date', labels: ['Дата'] },
      { id: 'col.n', type: 'number', labels: ['Кількість'] },
      { id: 'col.f', type: 'flag', labels: ['Позначка'] },
    ],
    tiles: [
      { id: 'tile.peak-day', label: 'Пік доби', measure: { agg: 'peak', by: 'col.d', grain: 'day' }, visual: 'bars', by: 'col.d', tone: 'blue' },
      { id: 'tile.peak-week', label: 'Пік тижня', measure: { agg: 'peak', column: 'col.n', by: 'col.d', grain: 'week' }, visual: 'bars', by: 'col.d', tone: 'blue' },
      { id: 'tile.low-month', label: 'Мінімум місяця', measure: { agg: 'low', by: 'col.d', grain: 'month' }, visual: 'bars', by: 'col.d', tone: 'blue' },
      { id: 'tile.low-flagged', label: 'Мінімум із позначкою', measure: { agg: 'low', by: 'col.d', grain: 'month', filter: [{ column: 'col.f', op: 'eq', value: true }] }, visual: 'bars', by: 'col.d', tone: 'blue' },
    ],
  });
  const rows = [
    { 'col.d': '2026-08-03', 'col.n': 1, 'col.f': true }, // понеділок
    { 'col.d': '2026-08-09', 'col.n': 2, 'col.f': false }, // неділя тієї ж ISO-тижня
    { 'col.d': '2026-08-10', 'col.n': 4, 'col.f': true }, // наступний понеділок
    { 'col.d': '2026-08-10', 'col.n': 8, 'col.f': true },
    { 'col.d': '2026-09-02', 'col.n': 1, 'col.f': false },
    { 'col.d': 'не дата', 'col.n': 100, 'col.f': true },
  ];
  const run = (id) => computeTile(catalog, id, { rows, period: PERIOD }).value.number;
  assert.equal(run('tile.peak-day'), 2, 'найбільше записів за добу');
  assert.equal(run('tile.peak-week'), 12, 'тиждень із понеділка: 10-го — 4+8');
  assert.equal(run('tile.low-month'), 1, 'вересень — один запис');
  assert.equal(run('tile.low-flagged'), 0, 'у вересні записи є, а з позначкою — жодного, тож мінімум нуль');
  assert.equal(computeTile(catalog, 'tile.peak-day', { rows: [], period: PERIOD }).value.number, 0);
  assert.equal(computeTile(catalog, 'tile.low-month', { rows: [], period: PERIOD }).value.number, 0);
});

test('діб у місяці для стовпчиків: перший і останній місяць обрізаються періодом', () => {
  const catalog = checked({
    format: 'easywar.catalog', version: 1, id: 'cat.rate', title: 'Темп', layer: 'builtin',
    columns: [{ id: 'col.d', type: 'date', labels: ['Дата'] }],
    tiles: [{ id: 'tile.rate', label: 'Записів на добу', measure: { agg: 'count' }, per: { agg: 'days' }, visual: 'bars', by: 'col.d', tone: 'blue' }],
  });
  const rows = [
    ...Array.from({ length: 4 }, () => ({ 'col.d': '2026-02-20' })),
    ...Array.from({ length: 28 }, () => ({ 'col.d': '2026-03-05' })),
    ...Array.from({ length: 6 }, () => ({ 'col.d': '2026-04-02' })),
  ];
  const model = computeTile(catalog, 'tile.rate', { rows, period: { from: '2026-02-15', to: '2026-04-03' } });
  assert.deepEqual(model.bars, [
    { key: '2026-02', value: 4 / 14 }, // 15–28 лютого
    { key: '2026-03', value: 28 / 31 },
    { key: '2026-04', value: 6 / 3 }, // 1–3 квітня
  ]);
  assert.equal(model.value.number, 38 / 48, '14 діб лютого, 31 березня й 3 квітня');
});

/* ------------------------------------------------------------------ */
/*  Відбори                                                            */
/* ------------------------------------------------------------------ */

test('відбір вибору не залежить від регістру й синонімів списку', () => {
  const rows = [
    flight('2026-08-01', { 'col.mission': 'бойовий' }),
    flight('2026-08-02', { 'col.mission': ' БОЙОВИЙ ' }),
    flight('2026-08-03', { 'col.mission': 'Бойовий' }),
    flight('2026-08-04', { 'col.mission': 'Тренувальний' }),
    flight('2026-08-05', {}),
  ];
  assert.equal(tile('tile.combat', rows).value.number, 3);
  assert.equal(tile('tile.combat', rows).extras[0].text, '1');
});

test('порожні й чужого типу значення не проходять порівняння, а `ne` їх пропускає', () => {
  const catalog = checked({
    format: 'easywar.catalog', version: 1, id: 'cat.filters', title: 'Відбори', layer: 'builtin',
    lists: [{ id: 'list.kind', title: 'Види', values: [{ value: 'А' }, { value: 'Б' }] }],
    columns: [
      { id: 'col.d', type: 'date', labels: ['Дата'] },
      { id: 'col.n', type: 'number', labels: ['Число'] },
      { id: 'col.k', type: 'choice', list: 'list.kind', labels: ['Вид'] },
      { id: 'col.m', type: 'multichoice', list: 'list.kind', labels: ['Види'] },
      { id: 'col.t', type: 'text', labels: ['Текст'] },
    ],
    tiles: Object.entries({
      gt: { column: 'col.n', op: 'gt', value: 1 },
      gte: { column: 'col.n', op: 'gte', value: 2 },
      lt: { column: 'col.n', op: 'lt', value: 3 },
      lte: { column: 'col.n', op: 'lte', value: 2 },
      ne: { column: 'col.k', op: 'ne', value: 'А' },
      in: { column: 'col.k', op: 'in', value: ['А', 'Б'] },
      notin: { column: 'col.k', op: 'notin', value: ['А'] },
      empty: { column: 'col.t', op: 'empty' },
      notempty: { column: 'col.t', op: 'notempty' },
      multi: { column: 'col.m', op: 'eq', value: 'Б' },
      multiNe: { column: 'col.m', op: 'ne', value: 'Б' },
      text: { column: 'col.t', op: 'eq', value: 'Привіт' },
      date: { column: 'col.d', op: 'gte', value: '2026-08-05' },
    }).map(([name, term]) => ({
      id: `tile.${name.toLowerCase()}`, label: name, measure: { agg: 'count', filter: [term] }, visual: 'bars', by: 'col.d', tone: 'blue',
    })),
  });
  const rows = [
    { 'col.d': '2026-08-01', 'col.n': 1, 'col.k': 'А', 'col.m': ['А', 'Б'], 'col.t': 'привіт' },
    { 'col.d': '2026-08-05', 'col.n': 2, 'col.k': 'Б', 'col.m': ['А'], 'col.t': '' },
    { 'col.d': '2026-08-09', 'col.n': 3, 'col.k': 'б', 'col.m': 'Б', 'col.t': null },
    { 'col.d': 'не дата', 'col.n': '2', 'col.k': '', 'col.m': [], 'col.t': 'Інше' },
    {},
  ];
  const count = (name) => computeTile(catalog, `tile.${name.toLowerCase()}`, { rows, period: PERIOD }).value.number;
  assert.deepEqual(
    ['gt', 'gte', 'lt', 'lte', 'ne', 'in', 'notin', 'empty', 'notempty', 'multi', 'multiNe', 'text', 'date'].map(count),
    [2, 2, 2, 2, 4, 3, 4, 3, 2, 2, 3, 1, 2],
  );
});

/* ------------------------------------------------------------------ */
/*  Зміна до попереднього періоду                                      */
/* ------------------------------------------------------------------ */

test('зміна: до попереднього періоду, друга половина до першої, без бази', () => {
  const current = Array.from({ length: 6 }, () => flight('2026-08-05'));
  const previous = Array.from({ length: 4 }, () => flight('2026-07-25'));

  const withPrevious = tile('tile.flights', current, { compare: { kind: 'previous', rows: previous } });
  assert.deepEqual(withPrevious.delta, { pct: 50, mode: 'up' });
  assert.equal(withPrevious.compare, 'previous');

  const halves = tile('tile.flights', current, { compare: { kind: 'halves', first: previous.slice(0, 2), second: current } });
  assert.deepEqual(halves.delta, { pct: 200, mode: 'up' });
  assert.equal(halves.compare, 'halves');

  const none = tile('tile.flights', current);
  assert.deepEqual(none.delta, { pct: null, mode: 'up' });
  assert.equal(none.compare, null);

  const zeroBase = tile('tile.flights', current, { compare: { kind: 'previous', rows: [] } });
  assert.equal(zeroBase.delta.pct, null, 'попередній період без записів не дає відсотка');

  const decrease = tile('tile.flights', previous, { compare: { kind: 'previous', rows: current } });
  assert.equal(decrease.delta.pct, -33);
  assert.equal(tile('tile.night', current, { compare: { kind: 'previous', rows: previous } }).delta, null, 'без `delta` у плитці зміни немає');
});

/* ------------------------------------------------------------------ */
/*  Приховування, помилки, незмінність                                 */
/* ------------------------------------------------------------------ */

test('hideWhenZero ховає плитку, поки значення нуль', () => {
  const catalog = checked({
    format: 'easywar.catalog', version: 1, id: 'cat.hide', title: 'Приховування', layer: 'builtin',
    columns: [{ id: 'col.d', type: 'date', labels: ['Дата'] }, { id: 'col.f', type: 'flag', labels: ['Позначка'] }],
    tiles: [{
      id: 'tile.flagged', label: 'З позначкою', measure: { agg: 'count', filter: [{ column: 'col.f', op: 'eq', value: true }] },
      visual: 'ring', by: 'col.d', tone: 'grey', hideWhenZero: true,
    }, {
      id: 'tile.always', label: 'Завжди', measure: { agg: 'count', filter: [{ column: 'col.f', op: 'eq', value: true }] },
      visual: 'ring', by: 'col.d', tone: 'grey',
    }],
  });
  const none = computeTiles(catalog, ['tile.flagged', 'tile.always'], { rows: [{ 'col.f': false }], period: PERIOD });
  assert.deepEqual(none.map((model) => model.hidden), [true, false]);
  const some = computeTiles(catalog, ['tile.flagged', 'tile.always'], { rows: [{ 'col.f': true }], period: PERIOD });
  assert.deepEqual(some.map((model) => model.hidden), [false, false]);
});

test('помилки: невідома плитка, неперевірений каталог, відсутні дані', () => {
  assert.throws(() => tile('tile.nope'), RangeError);
  assert.throws(() => computeTile(JSON.parse(EXAMPLE_TEXT), 'tile.flights', { rows: [], period: PERIOD }), TypeError, 'каталог мусить бути результатом validateCatalog');
  assert.equal(computeTile(CATALOG, 'tile.flights', undefined).value.text, '0');
  assert.equal(computeTile(CATALOG, 'tile.flights', {}).value.text, '0');
  assert.equal(computeTile(CATALOG, 'tile.flights', { rows: 'не масив' }).value.text, '0');
});

test('модель заморожена, вхідні записи не змінюються, повторний підрахунок дає те саме', () => {
  const rows = FLIGHTS.map((row) => Object.freeze({ ...row }));
  Object.freeze(rows);
  const first = tile('tile.flights', rows);
  const second = tile('tile.flights', rows);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.value) && Object.isFrozen(first.bars) && Object.isFrozen(first.extras[0]));
  assert.throws(() => { first.value.number = 1; }, TypeError);
  assert.deepEqual(rows.map((row) => ({ ...row })), FLIGHTS, 'записи не змінено');
});

test('computeTiles повертає плитки в порядку запиту', () => {
  const models = computeTiles(CATALOG, ['tile.night', 'tile.flights', 'tile.hours'], { rows: FLIGHTS, period: PERIOD });
  assert.deepEqual(models.map((model) => model.id), ['tile.night', 'tile.flights', 'tile.hours']);
});

test('ядро не читає DOM, мережу, сховища, годинник і не виконує динамічний код', async () => {
  const source = await readFile(new URL('../src/tiles-core.js', import.meta.url), 'utf8');
  for (const forbidden of [/\bdocument\b/, /\bwindow\b/, /\bfetch\s*\(/, /localStorage|sessionStorage|indexedDB/, /Date\.now|new Date\(\)/, /\beval\s*\(/, /new Function/, /Math\.random/, /\bimport\s*\(/]) {
    assert.doesNotMatch(source, forbidden, String(forbidden));
  }
});
