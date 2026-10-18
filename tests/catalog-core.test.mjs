import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AGGREGATES,
  BLOCK_KINDS,
  CATALOG_VERSION,
  COLUMN_TYPES,
  DELTA_MODES,
  DURATION_UNITS,
  FILTER_OPS,
  GRAINS,
  LAYERS,
  LIMITS,
  NAV_HOME,
  SHAPES,
  TABLE_FORMAT,
  TILE_VISUALS,
  TONES,
  blockColumns,
  deriveTable,
  foldLabel,
  parseCatalogText,
  tileColumns,
  validateCatalog,
  validateTableSchema,
} from '../src/catalog-core.js';

const DOC = await readFile(new URL('../docs/CATALOG.md', import.meta.url), 'utf8');
const SOURCE = await readFile(new URL('../src/catalog-core.js', import.meta.url), 'utf8');

// Приклад у документі — єдине джерело вихідного каталогу: тести ламають його точково.
const EXAMPLE_TEXT = DOC.match(/<!-- catalog-example -->\s*```json\n([\s\S]*?)\n```/)?.[1];
assert.ok(EXAMPLE_TEXT, 'у docs/CATALOG.md має бути блок прикладу після <!-- catalog-example -->');
const EXAMPLE = JSON.parse(EXAMPLE_TEXT);

const fresh = () => structuredClone(EXAMPLE);
const run = (mutate, options) => {
  const catalog = fresh();
  mutate(catalog);
  return validateCatalog(catalog, options);
};
const codes = (result) => result.errors.map((error) => `${error.path}:${error.code}`);
const byId = (items, id) => items.find((item) => item.id === id);
const chars = (...codePoints) => String.fromCharCode(...codePoints);

// Індекси елементів прикладу (див. порядок у docs/CATALOG.md).
const COL = { date: 0, takeoff: 1, hours: 2, aircraft: 3, tail: 4, mission: 5, night: 6, crew: 7, landings: 8 };
const TILE = { flights: 0, hours: 1, night: 2, perAircraft: 3, combat: 4 };
const BLOCK = { summary: 0, dynamics: 1, byAircraft: 2, byHour: 3, journal: 4, quality: 5 };

function expectRejected(cases) {
  for (const [name, mutate, expected] of cases) {
    const result = run(mutate);
    assert.equal(result.ok, false, `${name}: каталог має бути відхилений`);
    assert.equal(result.catalog, null, `${name}: відхилений каталог не повертається`);
    for (const item of [].concat(expected)) {
      assert.ok(codes(result).includes(item), `${name}: очікувалась помилка ${item}, отримано: ${codes(result).join(', ')}`);
    }
  }
}

function expectAccepted(cases) {
  for (const [name, mutate] of cases) {
    const result = run(mutate);
    assert.equal(result.ok, true, `${name}: каталог має бути прийнятий, помилки: ${codes(result).join(', ')}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Позитивні випадки                                                  */
/* ------------------------------------------------------------------ */

test('the example from the documentation is a valid catalog and comes back frozen', () => {
  const result = validateCatalog(EXAMPLE_TEXT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.truncated, false);
  const { catalog } = result;
  assert.equal(catalog.version, CATALOG_VERSION);
  assert.equal(catalog.lists.length, 2);
  assert.equal(catalog.columns.length, 9);
  assert.equal(catalog.tiles.length, 6);
  assert.equal(catalog.blocks.length, 6);
  assert.equal(catalog.kinds.length, 1);
  assert.ok(Object.isFrozen(catalog) && Object.isFrozen(catalog.kinds[0].layout.rows[0].cols[0].cards));
  assert.throws(() => { 'use strict'; catalog.columns[0].labels.push('Інше'); }, TypeError);
  assert.notEqual(catalog.columns, EXAMPLE.columns, 'повертається новий об’єкт, а не вхідний');
});

test('text is normalised: NFC, trimmed, list values take their canonical spelling', () => {
  const result = run((catalog) => {
    catalog.columns[COL.crew].labels = [`  Екіпа${chars(0x436)}  `, `Бо${chars(0x438, 0x306)}`];
    byId(catalog.tiles, 'tile.combat').measure.filter[0].value = '  бойовий ';
  });
  assert.equal(result.ok, true, codes(result).join(', '));
  assert.deepEqual(result.catalog.columns[COL.crew].labels, [`Екіпа${chars(0x436)}`, `Бо${chars(0x439)}`]);
  assert.equal(byId(result.catalog.tiles, 'tile.combat').measure.filter[0].value, 'Бойовий');
});

test('accepted variants of filters, blocks and columns', () => {
  expectAccepted([
    ['custom value in a list that allows it', (c) => { c.tiles[TILE.combat].measure.filter[0] = { column: 'col.aircraft', op: 'eq', value: 'Su-25' }; }],
    ['in-list with several values', (c) => { c.tiles[TILE.combat].measure.filter[0] = { column: 'col.mission', op: 'in', value: ['Бойовий', 'Перегін'] }; }],
    ['empty / notempty without a value', (c) => { c.tiles[TILE.combat].measure.filter = [{ column: 'col.crew', op: 'notempty' }, { column: 'col.tail', op: 'empty' }]; }],
    ['date and time comparisons', (c) => {
      c.tiles[TILE.combat].measure.filter = [{ column: 'col.date', op: 'gte', value: '2026-02-28' }, { column: 'col.takeoff', op: 'lt', value: '23:59' }];
    }],
    ['number comparison', (c) => { c.tiles[TILE.combat].measure.filter = [{ column: 'col.hours', op: 'gt', value: 1.5 }]; }],
    ['flag breakdown', (c) => { c.blocks[BLOCK.byAircraft].by = 'col.night'; }],
    ['multichoice column', (c) => { c.columns.push({ id: 'col.tasks', type: 'multichoice', list: 'list.mission', labels: ['Завдання (кілька)'] }); }],
    ['coordinates column and map block', (c) => {
      c.columns.push({ id: 'col.place', type: 'coordinates', labels: ['Координати MGRS'] });
      c.blocks.push({ id: 'block.map', title: 'Карта', kind: 'map', coordinates: 'col.place' });
      c.kinds[0].columns.push({ column: 'col.place' });
      c.kinds[0].blocks.push('block.map');
    }],
    ['derived element with based_on', (c) => { c.tiles.push({ ...structuredClone(c.tiles[TILE.flights]), id: 'tile.flights-mine', based_on: 'tile.flights' }); }],
    ['catalog without sections', (c) => { for (const key of ['lists', 'columns', 'tiles', 'blocks', 'kinds']) delete c[key]; }],
  ]);
});

test('the engine is not tied to flights: a strike journal with a results list fits the same format', () => {
  const strikes = {
    format: 'easywar.catalog',
    version: 1,
    id: 'cat.example.strikes',
    title: 'Приклад: журнал ударів',
    layer: 'builtin',
    lists: [{
      id: 'list.result',
      title: 'Результат ураження',
      values: [
        { value: 'УРАЖЕНО', aliases: ['ураж.', 'поражено'] },
        { value: 'ЧАСТКОВО УРАЖЕНО' },
        { value: 'НЕ УРАЖЕНО', aliases: ['не ураж.'] },
      ],
    }],
    columns: [
      { id: 'col.date', type: 'date', labels: ['Дата'] },
      { id: 'col.result', type: 'choice', list: 'list.result', labels: ['Результат ураження'] },
      { id: 'col.count', type: 'number', integer: true, min: 0, labels: ['К-сть боєприпасів'] },
      { id: 'col.target', type: 'text', labels: ['Тип цілі'], maxLength: 120 },
    ],
    tiles: [
      { id: 'tile.hit', label: 'Уражено', measure: { agg: 'count', filter: [{ column: 'col.result', op: 'eq', value: 'УРАЖЕНО' }] }, visual: 'bars', by: 'col.date', tone: 'green', delta: 'up', icon: 'tgtg' },
      { id: 'tile.hit-share', label: 'Частка уражених', measure: { agg: 'share', filter: [{ column: 'col.result', op: 'eq', value: 'УРАЖЕНО' }] }, visual: 'ring', tone: 'green' },
      { id: 'tile.munitions', label: 'Використано БП', measure: { agg: 'sum', column: 'col.count' }, per: { agg: 'count' }, visual: 'bars', by: 'col.date', tone: 'amber', delta: 'up', icon: 'bomb' },
    ],
    blocks: [
      { id: 'block.kpis', title: 'Основні показники', kind: 'tiles', tiles: ['tile.hit', 'tile.hit-share', 'tile.munitions'] },
      { id: 'block.targets', title: 'Типи цілей', kind: 'breakdown', by: 'col.target', measure: { agg: 'count' }, shape: 'ring' },
    ],
    kinds: [{
      id: 'kind.strikes',
      title: 'Журнал ударів',
      sheet: 'Зведена',
      columns: [{ column: 'col.date', core: true }, { column: 'col.result', core: true }, { column: 'col.count' }, { column: 'col.target' }],
      tiles: ['tile.hit', 'tile.hit-share', 'tile.munitions'],
      blocks: ['block.kpis', 'block.targets'],
      layout: { rows: [{ cols: [{ w: 1, cards: ['block.kpis'] }] }, { cols: [{ w: 1, cards: ['block.targets'] }] }] },
    }],
  };
  const result = validateCatalog(strikes);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

/* ------------------------------------------------------------------ */
/*  Відмови                                                            */
/* ------------------------------------------------------------------ */

test('root: unknown keys, identity, version and layer', () => {
  expectRejected([
    ['unknown key', (c) => { c.extra = 1; }, 'extra:unknown_key'],
    ['missing id', (c) => { delete c.id; }, 'id:missing'],
    ['id without the cat. prefix', (c) => { c.id = 'example'; }, 'id:bad_id'],
    ['wrong format', (c) => { c.format = 'other.catalog'; }, 'format:bad_format'],
    ['newer version', (c) => { c.version = 2; }, 'version:unsupported_version'],
    ['fractional version', (c) => { c.version = 1.5; }, 'version:bad_version'],
    ['zero version', (c) => { c.version = 0; }, 'version:bad_version'],
    ['unknown layer', (c) => { c.layer = 'admin'; }, 'layer:bad_value'],
    ['sections must be arrays', (c) => { c.lists = {}; }, 'lists:not_array'],
    ['section too long', (c) => { c.lists = Array.from({ length: LIMITS.maxLists + 1 }, () => ({})); }, 'lists:too_many'],
  ]);
  for (const bad of [null, 5, 'x', []]) {
    assert.equal(validateCatalog(bad).ok, false);
  }
});

test('text fields reject control, invisible and bidi characters and bad lengths', () => {
  expectRejected([
    ['newline in title', (c) => { c.title = 'Рядок 1\nРядок 2'; }, 'title:forbidden_char'],
    ['tab in a label', (c) => { c.columns[0].labels[0] = 'Дата\tполоту'; }, 'columns[0].labels[0]:forbidden_char'],
    ['right-to-left override', (c) => { c.title = `Журнал ${chars(0x202e)}gnirts`; }, 'title:forbidden_char'],
    ['bidi isolate', (c) => { c.title = `Журнал ${chars(0x2066)}x`; }, 'title:forbidden_char'],
    ['zero-width space', (c) => { c.columns[0].labels[0] = `Да${chars(0x200b)}та`; }, 'columns[0].labels[0]:forbidden_char'],
    ['byte order mark inside text', (c) => { c.title = `Ж${chars(0xfeff)}урнал`; }, 'title:forbidden_char'],
    ['C1 control', (c) => { c.title = `Ж${chars(0x85)}урнал`; }, 'title:forbidden_char'],
    ['NUL', (c) => { c.title = `Ж${chars(0)}урнал`; }, 'title:forbidden_char'],
    ['title too long', (c) => { c.title = 'я'.repeat(LIMITS.titleLength + 1); }, 'title:too_long'],
    ['absurdly long title', (c) => { c.title = 'я'.repeat(1_000_000); }, 'title:too_long'],
    ['blank title', (c) => { c.title = '   '; }, 'title:empty'],
    ['non-string title', (c) => { c.title = 123; }, 'title:not_string'],
  ]);
});

test('identifiers: prefix per kind, charset, uniqueness and based_on', () => {
  expectRejected([
    ['tile with a col. prefix', (c) => { c.tiles[0].id = 'col.flights'; }, 'tiles[0].id:bad_id'],
    ['uppercase letters', (c) => { c.columns[0].id = 'col.Date'; }, 'columns[0].id:bad_id'],
    ['cyrillic letters', (c) => { c.columns[0].id = 'col.дата'; }, 'columns[0].id:bad_id'],
    ['65-character id', (c) => { c.columns[0].id = `col.${'a'.repeat(61)}`; }, 'columns[0].id:bad_id'],
    ['duplicate column id', (c) => { c.columns[1].id = c.columns[0].id; }, 'columns[1].id:duplicate_id'],
    ['duplicate list id', (c) => { c.lists[1].id = c.lists[0].id; }, 'lists[1].id:duplicate_id'],
    ['based_on itself', (c) => { c.columns[0].based_on = 'col.date'; }, 'columns[0].based_on:self_reference'],
    ['based_on with a wrong prefix', (c) => { c.columns[0].based_on = 'tile.date'; }, 'columns[0].based_on:bad_id'],
  ]);
  // однаковий хвіст у різних видів — не конфлікт: у кожного свій простір імен
  const samePrefixTail = run((c) => { c.blocks[0].id = 'block.flights'; c.kinds[0].blocks[0] = 'block.flights'; c.kinds[0].layout.rows[0].cols[0].cards[0] = 'block.flights'; });
  assert.equal(samePrefixTail.ok, true, codes(samePrefixTail).join(', '));
});

test('lists: values, aliases and duplicates by folded label', () => {
  const apostrophes = ["Об'єкт", 'Об' + chars(0x2019) + 'єкт'];
  expectRejected([
    ['no values', (c) => { c.lists[0].values = []; }, 'lists[0].values:too_few'],
    ['too many values', (c) => { c.lists[0].values = Array.from({ length: LIMITS.maxValuesPerList + 1 }, (_, i) => ({ value: `v${i}` })); }, 'lists[0].values:too_many'],
    ['apostrophe variants are one value', (c) => { c.lists[0].values = apostrophes.map((value) => ({ value })); }, 'lists[0].values[1].value:duplicate_value'],
    ['case-insensitive duplicate', (c) => { c.lists[0].values = [{ value: 'Борт' }, { value: 'БОРТ' }]; }, 'lists[0].values[1].value:duplicate_value'],
    ['alias equal to another value', (c) => { c.lists[0].values = [{ value: 'А', aliases: ['Б'] }, { value: 'б' }]; }, 'lists[0].values[1].value:duplicate_value'],
    ['alias repeated in the same entry', (c) => { c.lists[0].values = [{ value: 'А', aliases: ['x', 'X'] }]; }, 'lists[0].values[0].aliases[1]:duplicate_value'],
    ['too many aliases', (c) => { c.lists[0].values = [{ value: 'А', aliases: Array.from({ length: LIMITS.maxAliases + 1 }, (_, i) => `a${i}`) }]; }, 'lists[0].values[0].aliases:too_many'],
    ['unknown key in a value', (c) => { c.lists[0].values[0].colour = 'red'; }, 'lists[0].values[0].colour:unknown_key'],
    ['allowCustom must be boolean', (c) => { c.lists[0].allowCustom = 'так'; }, 'lists[0].allowCustom:not_boolean'],
  ]);
});

test('columns: type-specific keys, lists, units, ranges and labels', () => {
  expectRejected([
    ['unknown type', (c) => { c.columns[0].type = 'money'; }, 'columns[0].type:bad_value'],
    ['choice without a list', (c) => { delete c.columns[COL.aircraft].list; }, `columns[${COL.aircraft}].list:missing`],
    ['list on a text column', (c) => { c.columns[COL.tail].list = 'list.aircraft'; }, `columns[${COL.tail}].list:not_allowed_for_type`],
    ['list that does not exist', (c) => { c.columns[COL.aircraft].list = 'list.nothing'; }, `columns[${COL.aircraft}].list:unknown_list`],
    ['unit on a text column', (c) => { c.columns[COL.tail].unit = 'шт'; }, `columns[${COL.tail}].unit:not_allowed_for_type`],
    ['duration without a unit', (c) => { delete c.columns[COL.hours].unit; }, `columns[${COL.hours}].unit:missing`],
    ['duration with a foreign unit', (c) => { c.columns[COL.hours].unit = 'сек'; }, `columns[${COL.hours}].unit:bad_value`],
    ['min above max', (c) => { c.columns[COL.hours].max = -1; }, `columns[${COL.hours}].min:bad_range`],
    ['min on a date', (c) => { c.columns[COL.date].min = 0; }, `columns[${COL.date}].min:not_allowed_for_type`],
    ['non-finite min', (c) => { c.columns[COL.hours].min = '0'; }, `columns[${COL.hours}].min:not_number`],
    ['integer on a text column', (c) => { c.columns[COL.tail].integer = true; }, `columns[${COL.tail}].integer:not_allowed_for_type`],
    ['maxLength on a number', (c) => { c.columns[COL.landings].maxLength = 5; }, `columns[${COL.landings}].maxLength:not_allowed_for_type`],
    ['maxLength zero', (c) => { c.columns[COL.tail].maxLength = 0; }, `columns[${COL.tail}].maxLength:bad_integer`],
    ['maxLength above the limit', (c) => { c.columns[COL.tail].maxLength = LIMITS.maxTextLength + 1; }, `columns[${COL.tail}].maxLength:bad_integer`],
    ['no labels', (c) => { c.columns[0].labels = []; }, 'columns[0].labels:too_few'],
    ['too many labels', (c) => { c.columns[0].labels = Array.from({ length: LIMITS.maxLabels + 1 }, (_, i) => `П${i}`); }, 'columns[0].labels:too_many'],
    ['labels differ only by case', (c) => { c.columns[0].labels = ['Дата', 'ДАТА']; }, 'columns[0].labels[1]:duplicate_label'],
    ['alias equals a label', (c) => { c.columns[0].aliases = ['дата']; }, 'columns[0].aliases[0]:duplicate_label'],
    ['unknown key', (c) => { c.columns[0].width = 12; }, 'columns[0].width:unknown_key'],
    ['missing type', (c) => { delete c.columns[0].type; }, 'columns[0].type:missing'],
  ]);
});

test('measures: every aggregate accepts only what it can compute', () => {
  const tileHours = `tiles[${TILE.hours}].measure`;
  const combat = `tiles[${TILE.combat}].measure.filter[0]`;
  const withFilter = (filter) => (c) => { c.tiles[TILE.combat].measure.filter = [filter]; };
  expectRejected([
    ['unknown aggregate', (c) => { c.tiles[0].measure.agg = 'median'; }, 'tiles[0].measure.agg:bad_value'],
    ['top is only for extras', (c) => { c.tiles[0].measure = { agg: 'top', column: 'col.aircraft' }; }, 'tiles[0].measure.agg:bad_value'],
    ['sum over a text column', (c) => { c.tiles[TILE.hours].measure.column = 'col.tail'; }, `${tileHours}.column:wrong_type`],
    ['sum over a date', (c) => { c.tiles[TILE.hours].measure.column = 'col.date'; }, `${tileHours}.column:wrong_type`],
    ['sum without a column', (c) => { delete c.tiles[TILE.hours].measure.column; }, `${tileHours}.column:missing`],
    ['count with a column', (c) => { c.tiles[0].measure.column = 'col.hours'; }, 'tiles[0].measure.column:not_allowed_for_agg'],
    ['column that does not exist', (c) => { c.tiles[TILE.hours].measure.column = 'col.nothing'; }, `${tileHours}.column:unknown_column`],
    ['share without a filter', (c) => { delete c.tiles[TILE.night].measure.filter; }, `tiles[${TILE.night}].measure.filter:missing`],
    ['distinct over coordinates', (c) => {
      c.columns.push({ id: 'col.place', type: 'coordinates', labels: ['Координати'] });
      c.tiles[TILE.perAircraft].per.column = 'col.place';
    }, `tiles[${TILE.perAircraft}].per.column:wrong_type`],
    ['by on a sum', (c) => { c.tiles[TILE.hours].measure.by = 'col.date'; }, `${tileHours}.by:not_allowed_for_agg`],
    ['grain on a count', (c) => { c.tiles[0].measure.grain = 'day'; }, 'tiles[0].measure.grain:not_allowed_for_agg'],
    ['peak without by and grain', (c) => {
      const measure = c.tiles[TILE.hours].extras[0].measure;
      delete measure.by;
      delete measure.grain;
    }, [`tiles[${TILE.hours}].extras[0].measure.by:missing`, `tiles[${TILE.hours}].extras[0].measure.grain:missing`]],
    ['peak by a non-date', (c) => { c.tiles[TILE.hours].extras[0].measure.by = 'col.tail'; }, `tiles[${TILE.hours}].extras[0].measure.by:wrong_type`],
    ['unknown grain', (c) => { c.tiles[TILE.hours].extras[0].measure.grain = 'year'; }, `tiles[${TILE.hours}].extras[0].measure.grain:bad_value`],
    ['top over a number', (c) => { c.tiles[TILE.combat].extras[1].measure.column = 'col.hours'; }, `tiles[${TILE.combat}].extras[1].measure.column:wrong_type`],
    ['ordering a text column', withFilter({ column: 'col.tail', op: 'gt', value: 'a' }), `tiles[${TILE.combat}].measure.filter[0].op:op_not_for_type`],
    ['ordering a flag', withFilter({ column: 'col.night', op: 'gt', value: true }), `${combat}.op:op_not_for_type`],
    ['unknown operation', withFilter({ column: 'col.tail', op: 'like', value: 'a' }), `${combat}.op:bad_value`],
    ['flag compared with text', withFilter({ column: 'col.night', op: 'eq', value: 'так' }), `${combat}.value:wrong_value_type`],
    ['number compared with text', withFilter({ column: 'col.hours', op: 'gt', value: '2' }), `${combat}.value:wrong_value_type`],
    ['impossible date', withFilter({ column: 'col.date', op: 'eq', value: '2026-02-30' }), `${combat}.value:wrong_value_type`],
    ['date in another format', withFilter({ column: 'col.date', op: 'eq', value: '30.01.2026' }), `${combat}.value:wrong_value_type`],
    ['impossible time', withFilter({ column: 'col.takeoff', op: 'eq', value: '24:00' }), `${combat}.value:wrong_value_type`],
    ['value outside a closed list', withFilter({ column: 'col.mission', op: 'eq', value: 'Невідомий' }), `${combat}.value:value_not_in_list`],
    ['empty with a value', withFilter({ column: 'col.crew', op: 'empty', value: 'x' }), `${combat}.value:value_not_allowed`],
    ['eq without a value', withFilter({ column: 'col.crew', op: 'eq' }), `${combat}.value:missing`],
    ['in with no values', withFilter({ column: 'col.mission', op: 'in', value: [] }), `${combat}.value:too_few`],
    ['in with a scalar', withFilter({ column: 'col.mission', op: 'in', value: 'Бойовий' }), `${combat}.value:not_array`],
    ['coordinates compared by value', (c) => {
      c.columns.push({ id: 'col.place', type: 'coordinates', labels: ['Координати'] });
      c.tiles[TILE.combat].measure.filter = [{ column: 'col.place', op: 'eq', value: '37U' }];
    }, `${combat}.op:op_not_for_type`],
    ['too many filter terms', (c) => {
      c.tiles[TILE.combat].measure.filter = Array.from({ length: LIMITS.maxFilterTerms + 1 }, () => ({ column: 'col.crew', op: 'notempty' }));
    }, `tiles[${TILE.combat}].measure.filter:too_many`],
    ['empty filter list', (c) => { c.tiles[TILE.combat].measure.filter = []; }, `tiles[${TILE.combat}].measure.filter:too_few`],
    ['unknown key in a term', withFilter({ column: 'col.crew', op: 'notempty', not: true }), `${combat}.not:unknown_key`],
  ]);
});

test('tiles: visual forms, deltas, extras and references', () => {
  const night = `tiles[${TILE.night}]`;
  const combat = `tiles[${TILE.combat}]`;
  expectRejected([
    ['ring needs a share', (c) => { c.tiles[TILE.night].measure = { agg: 'count' }; }, `${night}.visual:visual_mismatch`],
    ['a share needs the ring', (c) => {
      c.tiles[0].measure = { agg: 'share', filter: [{ column: 'col.night', op: 'eq', value: true }] };
    }, 'tiles[0].visual:visual_mismatch'],
    ['ring with per', (c) => { c.tiles[TILE.night].per = { agg: 'count' }; }, `${night}.per:visual_mismatch`],
    ['ring with extras', (c) => { c.tiles[TILE.night].extras = [{ label: 'Ще', measure: { agg: 'count' } }]; }, `${night}.extras:visual_mismatch`],
    ['bars without a date column', (c) => { delete c.tiles[0].by; delete c.tiles[0].delta; }, 'tiles[0].by:missing'],
    ['delta without a date column', (c) => { c.tiles[TILE.night].delta = 'up'; }, `${night}.delta:delta_needs_by`],
    ['by must be a date', (c) => { c.tiles[0].by = 'col.tail'; }, 'tiles[0].by:wrong_type'],
    ['bars with two extras', (c) => {
      c.tiles[TILE.hours].extras.push({ label: 'Ще', measure: { agg: 'count' } });
    }, `tiles[${TILE.hours}].extras:visual_mismatch`],
    ['pair with one extra', (c) => { c.tiles[TILE.combat].extras.pop(); }, `${combat}.extras:visual_mismatch`],
    ['three extras', (c) => {
      c.tiles[TILE.combat].extras.push({ label: 'Третій', measure: { agg: 'count' } });
    }, `${combat}.extras:too_many`],
    ['extra without a label', (c) => { delete c.tiles[TILE.combat].extras[0].label; }, `${combat}.extras[0].label:missing`],
    ['a share is not a per', (c) => { c.tiles[TILE.perAircraft].per = { agg: 'share', filter: [{ column: 'col.night', op: 'eq', value: true }] }; }, `tiles[${TILE.perAircraft}].per.agg:bad_value`],
    ['unknown visual', (c) => { c.tiles[0].visual = 'gauge'; }, 'tiles[0].visual:bad_value'],
    ['colour outside the palette', (c) => { c.tiles[0].tone = 'pink'; }, 'tiles[0].tone:bad_value'],
    ['hex colour', (c) => { c.tiles[0].tone = '#ff0000'; }, 'tiles[0].tone:bad_value'],
    ['unknown delta mode', (c) => { c.tiles[0].delta = 'sideways'; }, 'tiles[0].delta:bad_value'],
    ['icon that is not an identifier', (c) => { c.tiles[0].icon = 'Plane!'; }, 'tiles[0].icon:bad_icon'],
    ['icon as a path', (c) => { c.tiles[0].icon = '../x.svg'; }, 'tiles[0].icon:bad_icon'],
    ['opens a block that does not exist', (c) => { c.tiles[TILE.hours].opens = 'block.nothing'; }, `tiles[${TILE.hours}].opens:unknown_block`],
    ['label too long', (c) => { c.tiles[0].label = 'я'.repeat(LIMITS.tileLabelLength + 1); }, 'tiles[0].label:too_long'],
    ['missing tone', (c) => { delete c.tiles[0].tone; }, 'tiles[0].tone:missing'],
  ]);
});

test('measures days, low and weighted top: what they accept', () => {
  const per = (c) => c.tiles[TILE.perAircraft];
  const extra0 = (c) => c.tiles[TILE.hours].extras[0];
  const ring = (c) => c.tiles[TILE.night];
  expectAccepted([
    ['days as a denominator', (c) => { per(c).per = { agg: 'days' }; }],
    ['days in an extra', (c) => { extra0(c).measure = { agg: 'days' }; }],
    ['low by a grain, with a column', (c) => { extra0(c).measure = { agg: 'low', column: 'col.hours', by: 'col.date', grain: 'month' }; }],
    ['low counting filtered records', (c) => { extra0(c).measure = { agg: 'low', by: 'col.date', grain: 'week', filter: [{ column: 'col.night', op: 'eq', value: true }] }; }],
    ['low as the tile measure', (c) => { c.tiles[TILE.hours].measure = { agg: 'low', by: 'col.date', grain: 'day' }; }],
    ['top weighted by a number with a limit', (c) => { c.tiles[TILE.combat].extras[1].measure = { agg: 'top', column: 'col.aircraft', weight: 'col.hours', limit: 2 }; }],
    ['a weighted top as an info fact without a label', (c) => { ring(c).info = { facts: [{ measure: { agg: 'top', column: 'col.aircraft', weight: 'col.hours', limit: LIMITS.maxTopValues } }] }; }],
  ]);
  expectRejected([
    ['days with a filter', (c) => { per(c).per = { agg: 'days', filter: [{ column: 'col.night', op: 'eq', value: true }] }; }, `tiles[${TILE.perAircraft}].per.filter:not_allowed_for_agg`],
    ['days with a column', (c) => { per(c).per = { agg: 'days', column: 'col.hours' }; }, `tiles[${TILE.perAircraft}].per.column:not_allowed_for_agg`],
    ['days with a grain', (c) => { per(c).per = { agg: 'days', by: 'col.date', grain: 'day' }; }, `tiles[${TILE.perAircraft}].per.by:not_allowed_for_agg`],
    ['days as the tile measure', (c) => { c.tiles[TILE.hours].measure = { agg: 'days' }; }, `tiles[${TILE.hours}].measure.agg:bad_value`],
    ['low without by and grain', (c) => { extra0(c).measure = { agg: 'low' }; }, [`tiles[${TILE.hours}].extras[0].measure.by:missing`, `tiles[${TILE.hours}].extras[0].measure.grain:missing`]],
    ['low over text', (c) => { extra0(c).measure = { agg: 'low', column: 'col.tail', by: 'col.date', grain: 'day' }; }, `tiles[${TILE.hours}].extras[0].measure.column:wrong_type`],
    ['top weighted by text', (c) => { c.tiles[TILE.combat].extras[1].measure.weight = 'col.tail'; }, `tiles[${TILE.combat}].extras[1].measure.weight:wrong_type`],
    ['top weighted by an unknown column', (c) => { c.tiles[TILE.combat].extras[1].measure.weight = 'col.nothing'; }, `tiles[${TILE.combat}].extras[1].measure.weight:unknown_column`],
    ['top limit zero', (c) => { c.tiles[TILE.combat].extras[1].measure.limit = 0; }, `tiles[${TILE.combat}].extras[1].measure.limit:bad_integer`],
    ['top limit too large', (c) => { c.tiles[TILE.combat].extras[1].measure.limit = LIMITS.maxTopValues + 1; }, `tiles[${TILE.combat}].extras[1].measure.limit:bad_integer`],
    ['top limit fractional', (c) => { c.tiles[TILE.combat].extras[1].measure.limit = 1.5; }, `tiles[${TILE.combat}].extras[1].measure.limit:bad_integer`],
    ['weight on a sum', (c) => { c.tiles[TILE.hours].measure.weight = 'col.hours'; }, `tiles[${TILE.hours}].measure.weight:not_allowed_for_agg`],
    ['limit on a count', (c) => { c.tiles[0].measure.limit = 2; }, 'tiles[0].measure.limit:not_allowed_for_agg'],
  ]);
});

test('tiles of the strike journal: ring with a count, captions, info facts, ratios and units', () => {
  // межі з docs/CATALOG.md: «до чотирьох фактів», «top: від 1 до 10 значень»
  assert.equal(LIMITS.maxFacts, 4);
  assert.equal(LIMITS.maxTopValues, 10);
  const night = `tiles[${TILE.night}]`;
  const hours = `tiles[${TILE.hours}]`;
  const nightFilter = [{ column: 'col.night', op: 'eq', value: true }];
  expectAccepted([
    ['ring with a filtered count', (c) => { c.tiles[TILE.night].measure = { agg: 'count', filter: nightFilter }; }],
    ['ring with a caption and a label', (c) => { Object.assign(c.tiles[TILE.night], { caption: 'Підпис', ringLabel: 'Частка нічних' }); }],
    ['info with text only', (c) => { c.tiles[TILE.night].info = { text: 'Пояснення.' }; }],
    ['info with facts only', (c) => { c.tiles[TILE.night].info = { facts: [{ label: 'Макс. за добу', measure: { agg: 'peak', by: 'col.date', grain: 'day' } }] }; }],
    ['info with text and four facts', (c) => {
      c.tiles[TILE.night].info = { text: 'Пояснення', facts: Array.from({ length: LIMITS.maxFacts }, (_, i) => ({ label: `Факт ${i}`, measure: { agg: 'count' } })) };
    }],
    ['extra with a ratio, icon and unit forms', (c) => {
      Object.assign(c.tiles[TILE.hours].extras[0], { per: { agg: 'days' }, icon: 'avg', unit: { one: 'виліт', few: 'вильоти', many: 'вильотів', fraction: 'вильоту' }, suffix: '/день' });
    }],
    ['extra with a plain unit', (c) => { c.tiles[TILE.hours].extras[0].unit = 'БП на виліт'; }],
    ['tile hidden while zero', (c) => { c.tiles[TILE.night].hideWhenZero = true; }],
    ['tile that is never hidden', (c) => { c.tiles[TILE.night].hideWhenZero = false; }],
  ]);
  expectRejected([
    ['ring with a count and no filter', (c) => { c.tiles[TILE.night].measure = { agg: 'count' }; }, `${night}.visual:visual_mismatch`],
    ['ring with a sum', (c) => { c.tiles[TILE.night].measure = { agg: 'sum', column: 'col.hours', filter: nightFilter }; }, `${night}.visual:visual_mismatch`],
    ['caption on bars', (c) => { c.tiles[0].caption = 'Підпис'; }, 'tiles[0].caption:visual_mismatch'],
    ['ring label on pair', (c) => { c.tiles[TILE.combat].ringLabel = 'Частка'; }, `tiles[${TILE.combat}].ringLabel:visual_mismatch`],
    ['caption too long', (c) => { c.tiles[TILE.night].caption = 'я'.repeat(LIMITS.captionLength + 1); }, `${night}.caption:too_long`],
    ['caption with a bidi character', (c) => { c.tiles[TILE.night].caption = `Підпис${chars(0x202e)}`; }, `${night}.caption:forbidden_char`],
    ['empty info', (c) => { c.tiles[TILE.night].info = {}; }, `${night}.info:missing`],
    ['info text too long', (c) => { c.tiles[TILE.night].info = { text: 'я'.repeat(LIMITS.infoLength + 1) }; }, `${night}.info.text:too_long`],
    ['info with unknown key', (c) => { c.tiles[TILE.night].info = { text: 'x', html: '<b>' }; }, `${night}.info.html:unknown_key`],
    ['info with no facts listed', (c) => { c.tiles[TILE.night].info = { facts: [] }; }, `${night}.info.facts:too_few`],
    ['info with too many facts', (c) => {
      c.tiles[TILE.night].info = { facts: Array.from({ length: LIMITS.maxFacts + 1 }, (_, i) => ({ label: `Факт ${i}`, measure: { agg: 'count' } })) };
    }, `${night}.info.facts:too_many`],
    ['info fact without a label', (c) => { c.tiles[TILE.night].info = { facts: [{ measure: { agg: 'count' } }] }; }, `${night}.info.facts[0].label:missing`],
    ['info fact without a measure', (c) => { c.tiles[TILE.night].info = { facts: [{ label: 'Факт' }] }; }, `${night}.info.facts[0].measure:missing`],
    ['info fact with a share', (c) => { c.tiles[TILE.night].info = { facts: [{ label: 'Частка', measure: { agg: 'share', filter: nightFilter } }] }; }, `${night}.info.facts[0].measure.agg:bad_value`],
    ['info fact with days', (c) => { c.tiles[TILE.night].info = { facts: [{ label: 'Діб', measure: { agg: 'days' } }] }; }, `${night}.info.facts[0].measure.agg:bad_value`],
    ['info fact reading an unknown column', (c) => { c.tiles[TILE.night].info = { facts: [{ label: 'Факт', measure: { agg: 'sum', column: 'col.nothing' } }] }; }, `${night}.info.facts[0].measure.column:unknown_column`],
    ['extra with an unknown key', (c) => { c.tiles[TILE.hours].extras[0].colour = 'red'; }, `${hours}.extras[0].colour:unknown_key`],
    ['extra per with a share', (c) => { c.tiles[TILE.hours].extras[0].per = { agg: 'share', filter: nightFilter }; }, `${hours}.extras[0].per.agg:bad_value`],
    ['extra icon as a path', (c) => { c.tiles[TILE.hours].extras[0].icon = '../x'; }, `${hours}.extras[0].icon:bad_icon`],
    ['unit forms without one', (c) => { c.tiles[TILE.hours].extras[0].unit = { few: 'a', many: 'b' }; }, `${hours}.extras[0].unit.one:missing`],
    ['unit with an unknown form', (c) => { c.tiles[TILE.hours].extras[0].unit = { one: 'a', few: 'b', many: 'c', other: 'd' }; }, `${hours}.extras[0].unit.other:unknown_key`],
    ['unit too long', (c) => { c.tiles[TILE.hours].extras[0].unit = 'я'.repeat(LIMITS.unitLength + 1); }, `${hours}.extras[0].unit:too_long`],
    ['unit of the wrong type', (c) => { c.tiles[TILE.hours].extras[0].unit = 5; }, `${hours}.extras[0].unit:not_object`],
    ['suffix too long', (c) => { c.tiles[TILE.hours].extras[0].suffix = 'я'.repeat(LIMITS.unitLength + 1); }, `${hours}.extras[0].suffix:too_long`],
    ['hideWhenZero as text', (c) => { c.tiles[TILE.night].hideWhenZero = 'так'; }, `${night}.hideWhenZero:not_boolean`],
    ['hideWhenZero as a number', (c) => { c.tiles[TILE.night].hideWhenZero = 1; }, `${night}.hideWhenZero:not_boolean`],
  ]);
  // нові поля плитки читають стовпці — конструктор має знати про них
  const { catalog } = validateCatalog(EXAMPLE);
  const probe = run((c) => {
    Object.assign(c.tiles[TILE.hours].extras[0], { per: { agg: 'sum', column: 'col.landings' } });
    c.tiles[TILE.hours].info = { text: 'x', facts: [{ measure: { agg: 'top', column: 'col.mission', weight: 'col.crew' } }] };
  });
  assert.equal(probe.ok, false, 'вага з текстового стовпця має бути відхилена');
  const ok = run((c) => {
    c.tiles[TILE.hours].extras[0].per = { agg: 'sum', column: 'col.landings' };
    c.tiles[TILE.hours].info = { text: 'x', facts: [{ measure: { agg: 'top', column: 'col.mission', weight: 'col.hours' } }] };
  });
  assert.equal(ok.ok, true, codes(ok).join(', '));
  const reads = tileColumns(byId(ok.catalog.tiles, 'tile.hours'));
  for (const id of ['col.landings', 'col.hours', 'col.mission']) assert.ok(reads.includes(id), `плитка має читати ${id}: ${reads.join(', ')}`);
  assert.ok(catalog);
});

test('blocks: keys depend on the kind, references must resolve', () => {
  const dynamics = `blocks[${BLOCK.dynamics}]`;
  const breakdown = `blocks[${BLOCK.byAircraft}]`;
  const addMap = (c, extra = {}) => {
    c.columns.push({ id: 'col.place', type: 'coordinates', labels: ['Координати'] });
    c.blocks.push({ id: 'block.map', title: 'Карта', kind: 'map', coordinates: 'col.place', ...extra });
  };
  expectRejected([
    ['unknown kind', (c) => { c.blocks[0].kind = 'chart'; }, 'blocks[0].kind:bad_value'],
    ['tiles block without tiles', (c) => { delete c.blocks[BLOCK.summary].tiles; }, `blocks[${BLOCK.summary}].tiles:missing`],
    ['tiles block with a missing tile', (c) => { c.blocks[BLOCK.summary].tiles[0] = 'tile.nothing'; }, `blocks[${BLOCK.summary}].tiles[0]:unknown_tile`],
    ['tile listed twice', (c) => { c.blocks[BLOCK.summary].tiles[1] = 'tile.flights'; }, `blocks[${BLOCK.summary}].tiles[1]:duplicate_ref`],
    ['too many tiles in a block', (c) => {
      c.blocks[BLOCK.summary].tiles = Array.from({ length: LIMITS.maxBlockTiles + 1 }, () => 'tile.flights');
    }, `blocks[${BLOCK.summary}].tiles:too_many`],
    ['dynamics without a grain', (c) => { delete c.blocks[BLOCK.dynamics].grain; }, `${dynamics}.grain:missing`],
    ['dynamics by a non-date', (c) => { c.blocks[BLOCK.dynamics].by = 'col.tail'; }, `${dynamics}.by:wrong_type`],
    ['dynamics with a limit', (c) => { c.blocks[BLOCK.dynamics].limit = 5; }, `${dynamics}.limit:not_allowed_for_kind`],
    ['peak is not a block measure', (c) => {
      c.blocks[BLOCK.dynamics].measure = { agg: 'peak', by: 'col.date', grain: 'day' };
    }, `${dynamics}.measure.agg:bad_value`],
    ['breakdown by a number', (c) => { c.blocks[BLOCK.byAircraft].by = 'col.landings'; }, `${breakdown}.by:wrong_type`],
    ['breakdown without a shape', (c) => { delete c.blocks[BLOCK.byAircraft].shape; }, `${breakdown}.shape:missing`],
    ['limit zero', (c) => { c.blocks[BLOCK.byAircraft].limit = 0; }, `${breakdown}.limit:bad_integer`],
    ['limit above the maximum', (c) => { c.blocks[BLOCK.byAircraft].limit = LIMITS.maxTopLimit + 1; }, `${breakdown}.limit:bad_integer`],
    ['heat by a date instead of a time', (c) => { c.blocks[BLOCK.byHour].by = 'col.date'; }, `blocks[${BLOCK.byHour}].by:wrong_type`],
    ['heat across a non-date', (c) => { c.blocks[BLOCK.byHour].across = 'col.tail'; }, `blocks[${BLOCK.byHour}].across:wrong_type`],
    ['map over a non-coordinates column', (c) => { addMap(c); c.blocks.at(-1).coordinates = 'col.tail'; }, 'blocks[6].coordinates:wrong_type'],
    ['map with a measure', (c) => { addMap(c, { measure: { agg: 'count' } }); }, 'blocks[6].measure:not_allowed_for_kind'],
    ['table with a missing column', (c) => { c.blocks[BLOCK.journal].columns[0] = 'col.nothing'; }, `blocks[${BLOCK.journal}].columns[0]:unknown_column`],
    ['table with a repeated column', (c) => { c.blocks[BLOCK.journal].columns[1] = 'col.date'; }, `blocks[${BLOCK.journal}].columns[1]:duplicate_ref`],
    ['table wider than the limit', (c) => {
      c.blocks[BLOCK.journal].columns = Array.from({ length: LIMITS.maxTableColumns + 1 }, () => 'col.date');
    }, `blocks[${BLOCK.journal}].columns:too_many`],
    ['quality block with parameters', (c) => { c.blocks[BLOCK.quality].by = 'col.date'; }, `blocks[${BLOCK.quality}].by:not_allowed_for_kind`],
  ]);
});

test('kinds: sheet name, columns, reachability and layout', () => {
  const kind = 'kinds[0]';
  const layout = `${kind}.layout.rows`;
  expectRejected([
    ['sheet with a colon', (c) => { c.kinds[0].sheet = 'Дані:1'; }, `${kind}.sheet:bad_sheet_name`],
    ['sheet with a bracket', (c) => { c.kinds[0].sheet = 'Дані[1]'; }, `${kind}.sheet:bad_sheet_name`],
    ['sheet named History', (c) => { c.kinds[0].sheet = 'history'; }, `${kind}.sheet:bad_sheet_name`],
    ['sheet starting with an apostrophe', (c) => { c.kinds[0].sheet = "'Дані"; }, `${kind}.sheet:bad_sheet_name`],
    ['sheet longer than 31 characters', (c) => { c.kinds[0].sheet = 'я'.repeat(LIMITS.sheetLength + 1); }, `${kind}.sheet:too_long`],
    ['no columns', (c) => { c.kinds[0].columns = []; }, `${kind}.columns:too_few`],
    ['column that does not exist', (c) => { c.kinds[0].columns[0].column = 'col.nothing'; }, `${kind}.columns[0].column:unknown_column`],
    ['column listed twice', (c) => { c.kinds[0].columns[1].column = 'col.date'; }, `${kind}.columns[1].column:duplicate_ref`],
    ['core must be boolean', (c) => { c.kinds[0].columns[0].core = 'yes'; }, `${kind}.columns[0].core:not_boolean`],
    ['tile that does not exist', (c) => { c.kinds[0].tiles[0] = 'tile.nothing'; }, `${kind}.tiles[0]:unknown_tile`],
    ['block that does not exist', (c) => { c.kinds[0].blocks[0] = 'block.nothing'; }, `${kind}.blocks[0]:unknown_block`],
    ['tiles block holds a tile the kind does not offer', (c) => { c.kinds[0].tiles.pop(); }, `${kind}.blocks[${BLOCK.summary}]:tile_not_offered`],
    ['an offered tile needs a column the kind lacks', (c) => {
      c.kinds[0].columns = c.kinds[0].columns.filter((entry) => entry.column !== 'col.night');
    }, `${kind}.tiles[${TILE.night}]:unreachable_requirement`],
    ['an offered block needs a column the kind lacks', (c) => {
      c.kinds[0].columns = c.kinds[0].columns.filter((entry) => entry.column !== 'col.takeoff');
    }, `${kind}.blocks[${BLOCK.byHour}]:unreachable_requirement`],
    ['layout names a block the kind does not offer', (c) => { c.kinds[0].blocks.pop(); }, `${layout}[3].cols[0].cards[0]:block_not_offered`],
    ['block placed twice', (c) => { c.kinds[0].layout.rows[0].cols[0].cards.push('block.summary'); }, `${layout}[0].cols[0].cards[1]:duplicate_ref`],
    ['five columns in a row', (c) => {
      c.kinds[0].layout.rows[0].cols = Array.from({ length: LIMITS.layoutMaxCols + 1 }, () => ({ w: 1, cards: ['block.summary'] }));
    }, `${layout}[0].cols:too_many`],
    ['zero width', (c) => { c.kinds[0].layout.rows[0].cols[0].w = 0; }, `${layout}[0].cols[0].w:bad_width`],
    ['width above the limit', (c) => { c.kinds[0].layout.rows[0].cols[0].w = LIMITS.layoutMaxWidth + 1; }, `${layout}[0].cols[0].w:bad_width`],
    ['empty layout', (c) => { c.kinds[0].layout.rows = []; }, `${layout}:too_few`],
    ['unknown key in layout', (c) => { c.kinds[0].layout.theme = 'dark'; }, `${kind}.layout.theme:unknown_key`],
  ]);
});

test('errors are capped, so a hostile file cannot flood the interface', () => {
  const result = run((c) => {
    c.columns = Array.from({ length: 200 }, () => ({ id: 'BAD', type: 'x', labels: [] }));
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, LIMITS.maxErrors);
  assert.equal(result.truncated, true);
});

test('no single-field corruption of a valid catalog makes the validator throw', () => {
  const junk = [undefined, null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', 'x', true, [], {}, [null], { id: 1 }];
  const paths = [];
  const walk = (node, trail) => {
    if (node === null || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      paths.push([...trail, key]);
      walk(node[key], [...trail, key]);
    }
  };
  walk(EXAMPLE, []);
  assert.ok(paths.length > 300, 'приклад має давати сотні точок для псування');
  let accepted = 0;
  for (const trail of paths) {
    for (const value of junk) {
      const catalog = fresh();
      let holder = catalog;
      for (const key of trail.slice(0, -1)) holder = holder[key];
      const last = trail.at(-1);
      if (value === undefined) {
        if (Array.isArray(holder)) holder.splice(Number(last), 1);
        else delete holder[last];
      } else {
        holder[last] = structuredClone(value);
      }
      let result;
      try {
        result = validateCatalog(catalog);
      } catch (error) {
        assert.fail(`validateCatalog кинув виняток на ${trail.join('.')} = ${String(value)}: ${error.message}`);
      }
      assert.equal(typeof result.ok, 'boolean');
      assert.equal(result.ok, result.errors.length === 0, `${trail.join('.')}: ok має збігатися з порожнім списком помилок`);
      assert.equal(result.catalog === null, !result.ok, `${trail.join('.')}: каталог повертається лише коли він прийнятий`);
      assert.ok(result.errors.length <= LIMITS.maxErrors);
      for (const error of result.errors) {
        assert.equal(typeof error.path, 'string');
        assert.equal(typeof error.code, 'string');
        assert.equal(typeof error.message, 'string');
      }
      if (result.ok) {
        accepted += 1;
        assert.ok(Object.isFrozen(result.catalog));
        for (const kind of result.catalog.kinds) {
          const table = deriveTable(result.catalog, kind.id, { blocks: kind.blocks || [] });
          assert.equal(table.ok, true, `${trail.join('.')}: усі блоки виду мають давати таблицю без проблем`);
          const inKind = new Set(kind.columns.map((entry) => entry.column));
          const lookup = (tileId) => result.catalog.tiles.find((tile) => tile.id === tileId);
          for (const blockId of kind.blocks || []) {
            for (const columnId of blockColumns(result.catalog.blocks.find((block) => block.id === blockId), lookup)) {
              assert.ok(table.columns.includes(columnId), `${trail.join('.')}: блоку ${blockId} бракує стовпця ${columnId}`);
            }
          }
          assert.ok(table.columns.every((columnId) => inKind.has(columnId)));
        }
      }
    }
  }
  assert.ok(accepted > 0, 'частина змін (наприклад, прибрати необов’язкове поле) лишає каталог дійсним');
});

/* ------------------------------------------------------------------ */
/*  Вкладки меню                                                       */
/* ------------------------------------------------------------------ */

test('nav: the first tab is the locked dashboard, the rest are free labels for blocks', () => {
  const ok = validateCatalog(EXAMPLE);
  assert.deepEqual(ok.catalog.kinds[0].nav[0], { target: 'dashboard', label: 'Дашборд' }, 'підпис першої вкладки підставляється');
  assert.deepEqual(ok.catalog.kinds[0].nav[1], { target: 'block.dynamics', label: 'Наліт', icon: 'plane' });
  assert.deepEqual({ ...NAV_HOME }, { target: 'dashboard', label: 'Дашборд' });
  assert.ok(Object.isFrozen(NAV_HOME));

  expectAccepted([
    ['first tab with its own label spelled differently by case', (c) => { c.kinds[0].nav[0].label = '  дашБОРД '; }],
    ['only the dashboard tab', (c) => { c.kinds[0].nav = [{ target: 'dashboard' }]; }],
    ['label with an apostrophe and spaces', (c) => { c.kinds[0].nav[1].label = "Об'єкти та цілі"; }],
    ['label of the maximum length', (c) => { c.kinds[0].nav[1].label = 'я'.repeat(LIMITS.navLabelLength); }],
    ['no nav at all', (c) => { delete c.kinds[0].nav; }],
    ['the same label in another kind of the same catalog', (c) => {
      c.kinds.push({ ...structuredClone(c.kinds[0]), id: 'kind.flights-copy' });
    }],
  ]);
  const renamed = run((c) => { c.kinds[0].nav[0].label = '  дашБОРД '; });
  assert.equal(renamed.catalog.kinds[0].nav[0].label, 'Дашборд');

  const nav = 'kinds[0].nav';
  expectRejected([
    ['first tab leads elsewhere', (c) => { c.kinds[0].nav[0] = { target: 'block.dynamics', label: 'Наліт' }; }, `${nav}[0].target:nav_home_first`],
    ['first tab renamed', (c) => { c.kinds[0].nav[0].label = 'Головна'; }, `${nav}[0].label:nav_home_locked`],
    ['dashboard is not first', (c) => { c.kinds[0].nav[2] = { target: 'dashboard', label: 'Ще один' }; }, `${nav}[2].target:nav_home_first`],
    ['label is required for blocks', (c) => { delete c.kinds[0].nav[1].label; }, `${nav}[1].label:missing`],
    ['label equals the dashboard one', (c) => { c.kinds[0].nav[1].label = 'ДАШБОРД'; }, `${nav}[1].label:duplicate_label`],
    ['labels repeat', (c) => { c.kinds[0].nav[2].label = c.kinds[0].nav[1].label.toUpperCase(); }, `${nav}[2].label:duplicate_label`],
    ['label too long', (c) => { c.kinds[0].nav[1].label = 'я'.repeat(LIMITS.navLabelLength + 1); }, `${nav}[1].label:too_long`],
    ['blank label', (c) => { c.kinds[0].nav[1].label = '  '; }, `${nav}[1].label:empty`],
    ['bidi label', (c) => { c.kinds[0].nav[1].label = `Наліт${chars(0x202e)}`; }, `${nav}[1].label:forbidden_char`],
    ['block that the kind does not offer', (c) => { c.kinds[0].blocks = c.kinds[0].blocks.filter((id) => id !== 'block.journal'); c.kinds[0].layout.rows[2].cols.pop(); }, `${nav}[4].target:block_not_offered`],
    ['block without a tab twice', (c) => { c.kinds[0].nav[2].target = 'block.dynamics'; }, `${nav}[2].target:duplicate_ref`],
    ['target is not a block id', (c) => { c.kinds[0].nav[1].target = 'tile.flights'; }, `${nav}[1].target:bad_id`],
    ['target is a path', (c) => { c.kinds[0].nav[1].target = '../x'; }, `${nav}[1].target:bad_id`],
    ['no tabs', (c) => { c.kinds[0].nav = []; }, `${nav}:too_few`],
    ['too many tabs', (c) => {
      c.kinds[0].nav = [{ target: 'dashboard' }, ...Array.from({ length: LIMITS.maxNav }, (_, i) => ({ target: 'block.dynamics', label: `В${i}` }))];
    }, `${nav}:too_many`],
    ['unknown key', (c) => { c.kinds[0].nav[1].color = 'red'; }, `${nav}[1].color:unknown_key`],
    ['bad icon', (c) => { c.kinds[0].nav[1].icon = 'Plane!'; }, `${nav}[1].icon:bad_icon`],
    ['nav is not an array', (c) => { c.kinds[0].nav = { target: 'dashboard' }; }, `${nav}:not_array`],
    ['missing target', (c) => { delete c.kinds[0].nav[1].target; }, `${nav}[1].target:missing`],
  ]);
});

/* ------------------------------------------------------------------ */
/*  Таблиця з обраних модулів                                          */
/* ------------------------------------------------------------------ */

test('deriveTable: columns come from the chosen modules, in the order of the kind', () => {
  const { catalog } = validateCatalog(EXAMPLE);
  const KIND = 'kind.flights';

  const none = deriveTable(catalog, KIND);
  assert.equal(none.ok, true);
  assert.deepEqual(none.columns, ['col.date', 'col.hours'], 'без модулів лишається лише ядро виду');
  assert.deepEqual(none.reasons.map((r) => [r.column, r.core, r.pinned, r.blocks]), [['col.date', true, false, []], ['col.hours', true, false, []]]);

  const heat = deriveTable(catalog, KIND, { blocks: ['block.by-hour'] });
  assert.deepEqual(heat.columns, ['col.date', 'col.hours', 'col.takeoff'], 'години доби додають час зльоту');
  assert.deepEqual(heat.reasons.find((r) => r.column === 'col.takeoff'), { column: 'col.takeoff', core: false, pinned: false, blocks: ['block.by-hour'], orphan: false });

  const all = deriveTable(catalog, KIND, { blocks: ['block.summary'] });
  assert.deepEqual(all.columns, ['col.date', 'col.hours', 'col.aircraft', 'col.tail', 'col.mission', 'col.night'], 'залежності плиток зведені докупи, порядок — з виду');
  const date = all.reasons.find((r) => r.column === 'col.date');
  assert.equal(date.core, true);
  assert.deepEqual(date.blocks, ['block.summary']);

  const whole = deriveTable(catalog, KIND, { blocks: catalog.kinds[0].blocks });
  assert.deepEqual(whole.columns, ['col.date', 'col.hours', 'col.aircraft', 'col.tail', 'col.takeoff', 'col.mission', 'col.night'], 'усі модулі разом; стовпці без модуля (екіпаж, посадки) не додаються');

  const forward = deriveTable(catalog, KIND, { blocks: ['block.by-hour', 'block.summary'] });
  const backward = deriveTable(catalog, KIND, { blocks: ['block.summary', 'block.by-hour'] });
  assert.deepEqual(forward.columns, backward.columns, 'порядок вибору модулів не міняє порядок стовпців');

  const without = deriveTable(catalog, KIND, { blocks: ['block.by-hour'] });
  assert.ok(!without.columns.includes('col.mission'), 'прибраний модуль забирає свої стовпці');
  const twice = deriveTable(catalog, KIND, { blocks: ['block.by-hour', 'block.by-hour'] });
  assert.deepEqual(twice, heat, 'повтор у виборі нічого не міняє');

  const pinned = deriveTable(catalog, KIND, { blocks: ['block.by-hour'], columns: ['col.crew', 'col.takeoff'] });
  assert.deepEqual(pinned.columns, ['col.date', 'col.hours', 'col.takeoff', 'col.crew']);
  assert.deepEqual(pinned.reasons.find((r) => r.column === 'col.takeoff'), { column: 'col.takeoff', core: false, pinned: true, blocks: ['block.by-hour'], orphan: false });
  assert.deepEqual(pinned.reasons.find((r) => r.column === 'col.crew'), { column: 'col.crew', core: false, pinned: true, blocks: [], orphan: false });

  assert.ok(Object.isFrozen(all) && Object.isFrozen(all.reasons[0]) && Object.isFrozen(all.reasons[0].blocks));
  assert.throws(() => { 'use strict'; all.columns.push('x'); }, TypeError);
});

test('deriveTable: an empty selection on a kind without a core gives an empty table, not an error', () => {
  const result = run((c) => { for (const entry of c.kinds[0].columns) delete entry.core; });
  assert.equal(result.ok, true);
  const table = deriveTable(result.catalog, 'kind.flights');
  assert.equal(table.ok, true);
  assert.deepEqual(table.columns, []);
  assert.deepEqual(table.reasons, []);
});

test('deriveTable: wrong choices come back as problems and never throw', () => {
  const extra = run((c) => {
    c.columns.push({ id: 'col.fuel', type: 'number', labels: ['Пальне'] });
    c.blocks.push({ id: 'block.spare', title: 'Запасний', kind: 'quality' });
  });
  assert.equal(extra.ok, true, codes(extra).join(', '));
  const { catalog } = extra;
  const problems = (selection, kind = 'kind.flights') => deriveTable(catalog, kind, selection).problems.map((p) => `${p.code}:${p.id}`);

  assert.deepEqual(problems({}, 'kind.nothing'), ['unknown_kind:kind.nothing']);
  assert.equal(deriveTable(catalog, 'kind.nothing').ok, false);
  assert.deepEqual(deriveTable(catalog, 'kind.nothing').columns, []);
  assert.deepEqual(problems({ blocks: ['block.nothing'] }), ['unknown_block:block.nothing']);
  assert.deepEqual(problems({ blocks: ['block.spare'] }), ['block_not_offered:block.spare'], 'блок є в каталозі, але вид його не пропонує');
  assert.deepEqual(problems({ columns: ['col.nothing'] }), ['unknown_column:col.nothing']);
  assert.deepEqual(problems({ columns: ['col.fuel'] }), ['column_not_in_kind:col.fuel']);
  assert.deepEqual(problems({ blocks: [7, null, {}], columns: [false] }), ['bad_id:', 'bad_id:', 'bad_id:', 'bad_id:']);
  // хороша частина вибору не пропадає через погану
  const mixed = deriveTable(catalog, 'kind.flights', { blocks: ['block.by-hour', 'block.nothing'] });
  assert.equal(mixed.ok, false);
  assert.ok(mixed.columns.includes('col.takeoff'));

  for (const selection of [undefined, null, {}, { blocks: 'block.summary', columns: 5 }, { blocks: null }]) {
    assert.doesNotThrow(() => deriveTable(catalog, 'kind.flights', selection));
  }
  assert.deepEqual(deriveTable(catalog, 'kind.flights', { blocks: 'block.summary' }).columns, ['col.date', 'col.hours'], 'не масив — те саме, що порожній вибір');
});

test('deriveTable: the order belongs to the user and columns with data are never lost', () => {
  const { catalog } = validateCatalog(EXAMPLE);
  const KIND = 'kind.flights';
  const derive = (selection) => deriveTable(catalog, KIND, selection);

  const fresh1 = derive({ blocks: ['block.by-hour'] });
  assert.deepEqual(fresh1.columns, ['col.date', 'col.hours', 'col.takeoff']);
  assert.deepEqual(fresh1.added, fresh1.columns, 'у новій таблиці все додане');
  assert.deepEqual(fresh1.dropped, []);

  // користувач переставив стовпці — порядок зберігається, нічого не додається й не зникає
  const mine = ['col.takeoff', 'col.date', 'col.hours'];
  const same = derive({ blocks: ['block.by-hour'], current: mine });
  assert.deepEqual(same.columns, mine);
  assert.deepEqual(same.added, []);
  assert.deepEqual(same.dropped, []);

  // новий модуль додає свої стовпці в кінець, у порядку виду
  const more = derive({ blocks: ['block.by-hour', 'block.summary'], current: mine });
  assert.deepEqual(more.columns, [...mine, 'col.aircraft', 'col.tail', 'col.mission', 'col.night']);
  assert.deepEqual(more.added, ['col.aircraft', 'col.tail', 'col.mission', 'col.night']);

  // прибрали модуль: порожній стовпець зникає, ...
  const gone = derive({ blocks: [], current: mine });
  assert.deepEqual(gone.columns, ['col.date', 'col.hours']);
  assert.deepEqual(gone.dropped, ['col.takeoff']);
  // ... а стовпець з даними лишається і чекає на інший модуль
  const kept = derive({ blocks: [], current: mine, withData: ['col.takeoff'] });
  assert.deepEqual(kept.columns, mine);
  assert.deepEqual(kept.dropped, []);
  assert.deepEqual(kept.reasons.find((r) => r.column === 'col.takeoff'), { column: 'col.takeoff', core: false, pinned: false, blocks: [], orphan: true });
  assert.equal(kept.reasons.filter((r) => r.orphan).length, 1);
  // повернули модуль — стовпець знову потрібен, а не «осиротілий»
  const back = derive({ blocks: ['block.by-hour'], current: mine, withData: ['col.takeoff'] });
  assert.deepEqual(back.reasons.find((r) => r.column === 'col.takeoff'), { column: 'col.takeoff', core: false, pinned: false, blocks: ['block.by-hour'], orphan: false });
  // складніший модуль бере осиротілий стовпець з даними без нових
  const other = derive({ blocks: ['block.journal'], current: mine, withData: ['col.takeoff'] });
  assert.ok(other.columns.includes('col.takeoff') && other.columns.includes('col.aircraft'));

  // ядро повертається, якщо його прибрали
  const core = derive({ blocks: [], current: ['col.date'] });
  assert.deepEqual(core.columns, ['col.date', 'col.hours']);
  assert.deepEqual(core.added, ['col.hours']);
  // доданий вручну стовпець без даних лишається, поки його не відкріплять
  assert.deepEqual(derive({ blocks: [], current: ['col.date', 'col.hours', 'col.crew'], columns: ['col.crew'] }).dropped, []);
  assert.deepEqual(derive({ blocks: [], current: ['col.date', 'col.hours', 'col.crew'] }).dropped, ['col.crew']);
  // дані в стовпці, якого немає в таблиці, нічого не додають
  assert.deepEqual(derive({ blocks: [], current: ['col.date', 'col.hours'], withData: ['col.crew'] }).columns, ['col.date', 'col.hours']);

  // повтори й не масив
  assert.deepEqual(derive({ current: ['col.hours', 'col.date', 'col.hours'] }).columns, ['col.hours', 'col.date']);
  assert.deepEqual(derive({ blocks: ['block.by-hour'], current: 'col.date' }), derive({ blocks: ['block.by-hour'] }), 'не масив — те саме, що немає таблиці');
  assert.deepEqual(derive({ current: [] }).columns, ['col.date', 'col.hours'], 'порожня наявна таблиця добирає ядро');
  assert.deepEqual(derive({ current: [] }).added, ['col.date', 'col.hours']);

  // стовпці, невідомі виду, — проблема, і застосовувати результат не можна
  const odd = derive({ current: ['col.date', 'col.hours', 'col.nothing', 5] });
  assert.equal(odd.ok, false);
  assert.deepEqual(odd.problems.map((p) => p.code), ['unknown_column', 'bad_id']);
  assert.deepEqual(odd.columns, ['col.date', 'col.hours']);
  assert.ok(Object.isFrozen(odd) && Object.isFrozen(odd.added) && Object.isFrozen(odd.dropped));
});

test('table schema: user order, headers chosen from the offered ones, core present', () => {
  const { catalog } = validateCatalog(EXAMPLE);
  const schema = {
    format: 'easywar.table', version: 1, kind: 'kind.flights', title: 'Мій журнал',
    columns: [
      { column: 'col.hours', header: 'тривалість  польоту' },
      { column: 'col.date' },
      { column: 'col.takeoff', header: 'Час зльоту' },
    ],
  };
  const result = validateTableSchema(schema, catalog);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(TABLE_FORMAT, 'easywar.table');
  assert.deepEqual(result.schema.columns, [
    { column: 'col.hours', header: 'Тривалість польоту' },
    { column: 'col.date', header: 'Дата' },
    { column: 'col.takeoff', header: 'Час зльоту' },
  ], 'порядок користувача; заголовок береться із запропонованих у їхньому написанні; без header — перший');
  assert.ok(Object.isFrozen(result.schema) && Object.isFrozen(result.schema.columns[0]));
  assert.equal(validateTableSchema(JSON.stringify(schema), catalog).ok, true);
  assert.equal(validateTableSchema(`${chars(0xfeff)}${JSON.stringify(schema)}`, [catalog]).ok, true);

  // схема й вибір модулів сходяться: порядок користувача переходить у deriveTable
  const order = result.schema.columns.map((entry) => entry.column);
  assert.deepEqual(deriveTable(catalog, 'kind.flights', { blocks: ['block.by-hour'], current: order }).columns, order);

  const withBirth = run((c) => {
    c.columns.push({ id: 'col.birth', type: 'date', labels: ['Дата'] }, { id: 'col.fuel', type: 'number', labels: ['Пальне'] });
    c.kinds[0].columns.push({ column: 'col.birth' });
  }).catalog;
  const base = () => structuredClone(schema);
  const check = (mutate, expected, layers = catalog) => {
    const input = base();
    mutate(input);
    const outcome = validateTableSchema(input, layers);
    assert.equal(outcome.ok, false, `очікувалась відмова: ${expected}`);
    assert.equal(outcome.schema, null);
    assert.ok(outcome.errors.map((e) => `${e.path}:${e.code}`).includes(expected), `${expected}; є: ${outcome.errors.map((e) => `${e.path}:${e.code}`).join(', ')}`);
  };
  check((x) => { x.extra = 1; }, 'extra:unknown_key');
  check((x) => { delete x.kind; }, 'kind:missing');
  check((x) => { x.kind = 'tile.flights'; }, 'kind:bad_id');
  check((x) => { x.kind = 'kind.nothing'; }, 'kind:unknown_kind');
  check((x) => { x.format = 'easywar.catalog'; }, 'format:bad_format');
  check((x) => { x.version = 2; }, 'version:unsupported_version');
  check((x) => { x.version = 0; }, 'version:bad_version');
  check((x) => { x.title = 'я'.repeat(LIMITS.titleLength + 1); }, 'title:too_long');
  check((x) => { x.columns = []; }, 'columns:too_few');
  check((x) => { x.columns = {}; }, 'columns:not_array');
  check((x) => { x.columns = Array.from({ length: LIMITS.maxKindColumns + 1 }, () => ({ column: 'col.date' })); }, 'columns:too_many');
  check((x) => { x.columns[1].column = 'col.nothing'; }, 'columns[1].column:unknown_column');
  check((x) => { x.columns[1].column = 'col.fuel'; }, 'columns[1].column:column_not_in_kind', withBirth);
  check((x) => { x.columns[2].column = 'col.date'; }, 'columns[2].column:duplicate_ref');
  check((x) => { x.columns[1].column = 'hours'; }, 'columns[1].column:bad_id');
  check((x) => { x.columns[2].header = 'Моя назва'; }, 'columns[2].header:header_not_offered');
  check((x) => { x.columns[2].header = 12; }, 'columns[2].header:not_string');
  check((x) => { x.columns[2].header = `Зліт${chars(0x202e)}`; }, 'columns[2].header:forbidden_char');
  check((x) => { x.columns[2].extra = true; }, 'columns[2].extra:unknown_key');
  check((x) => { x.columns[0] = 'col.hours'; }, 'columns[0]:not_object');
  check((x) => { delete x.columns[0].column; }, 'columns[0].column:missing');
  check((x) => { x.columns.splice(0, 1); }, 'columns:missing_core');
  check((x) => { x.columns.splice(1, 1); }, 'columns:missing_core');
  check((x) => { x.columns.push({ column: 'col.birth' }); }, 'columns[3].column:duplicate_label', withBirth);
  check((x) => { x.columns.push({ column: 'col.birth', header: 'ДАТА' }); }, 'columns[3].header:duplicate_label', withBirth);

  for (const bad of [null, 5, 'x', [], '{ not json', '[]']) assert.equal(validateTableSchema(bad, catalog).ok, false);
  assert.equal(validateTableSchema(' '.repeat(LIMITS.maxBytes + 1), catalog).errors[0].code, 'too_large');
  assert.throws(() => validateTableSchema(schema, structuredClone(EXAMPLE)), TypeError);
  assert.throws(() => validateTableSchema(schema, []), TypeError);
  assert.throws(() => validateTableSchema(schema, { ...catalog }), TypeError);
  const polluted = validateTableSchema(JSON.parse('{"__proto__": {"polluted": true}, "format": "easywar.table", "version": 1, "kind": "kind.flights", "columns": []}'), catalog);
  assert.equal(polluted.ok, false);
  assert.equal({}.polluted, undefined);
});

test('table schema: no single-field corruption makes the validator throw', () => {
  const { catalog } = validateCatalog(EXAMPLE);
  const schema = {
    format: 'easywar.table', version: 1, kind: 'kind.flights', title: 'Мій журнал',
    columns: [{ column: 'col.hours', header: 'Наліт, год' }, { column: 'col.date' }, { column: 'col.takeoff', header: 'Зліт' }],
  };
  const junk = [undefined, null, 0, -1, Number.NaN, '', 'x', true, [], {}, [null], { column: 1 }];
  const paths = [];
  const walk = (node, trail) => {
    if (node === null || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      paths.push([...trail, key]);
      walk(node[key], [...trail, key]);
    }
  };
  walk(schema, []);
  let accepted = 0;
  for (const trail of paths) {
    for (const value of junk) {
      const copy = structuredClone(schema);
      let holder = copy;
      for (const key of trail.slice(0, -1)) holder = holder[key];
      const last = trail.at(-1);
      if (value === undefined) {
        if (Array.isArray(holder)) holder.splice(Number(last), 1);
        else delete holder[last];
      } else {
        holder[last] = structuredClone(value);
      }
      let outcome;
      assert.doesNotThrow(() => { outcome = validateTableSchema(copy, catalog); }, `${trail.join('.')} = ${String(value)}`);
      assert.equal(outcome.ok, outcome.errors.length === 0);
      assert.equal(outcome.schema === null, !outcome.ok);
      if (outcome.ok) {
        accepted += 1;
        const current = outcome.schema.columns.map((entry) => entry.column);
        assert.equal(deriveTable(catalog, 'kind.flights', { current }).ok, true, 'схема, що пройшла перевірку, завжди сумісна з виводом таблиці');
      }
    }
  }
  assert.ok(accepted > 0);
});

test('deriveTable accepts only validated catalogs and merges layers', () => {
  const builtin = validateCatalog(EXAMPLE).catalog;
  assert.throws(() => deriveTable(structuredClone(EXAMPLE), 'kind.flights'), TypeError);
  assert.throws(() => deriveTable({ ...builtin }, 'kind.flights'), TypeError, 'копія результату вже не є перевіреною');
  assert.throws(() => deriveTable([], 'kind.flights'), TypeError);
  assert.throws(() => deriveTable(null, 'kind.flights'), TypeError);
  assert.throws(() => deriveTable([builtin, {}], 'kind.flights'), TypeError);

  const mine = {
    format: 'easywar.catalog', version: 1, id: 'cat.profile.fuel', title: 'Паливо', layer: 'profile',
    columns: [{ id: 'col.fuel', type: 'number', unit: 'кг', min: 0, labels: ['Пальне, кг'] }],
    tiles: [{ id: 'tile.fuel', label: 'Пальне, кг', measure: { agg: 'sum', column: 'col.fuel' }, visual: 'bars', by: 'col.date', tone: 'orange' }],
    blocks: [{ id: 'block.fuel', title: 'Пальне', kind: 'tiles', tiles: ['tile.fuel'] }],
    kinds: [{
      id: 'kind.flights-fuel', title: 'Польоти з пальним', sheet: 'Польоти', based_on: 'kind.flights',
      columns: [{ column: 'col.date' }, { column: 'col.hours' }, { column: 'col.fuel' }],
      tiles: ['tile.fuel'], blocks: ['block.fuel'],
    }],
  };
  const profile = validateCatalog(mine, { base: [builtin] });
  assert.deepEqual(profile.errors, []);
  const table = deriveTable([builtin, profile.catalog], 'kind.flights-fuel', { blocks: ['block.fuel'] });
  assert.equal(table.ok, true);
  assert.deepEqual(table.columns, ['col.date', 'col.fuel'], 'профільний модуль бере дату з вбудованого шару');
  assert.equal(deriveTable(profile.catalog, 'kind.flights-fuel', { blocks: ['block.fuel'] }).ok, true, 'власний вид знайдений і без нижнього шару');
  assert.equal(deriveTable(builtin, 'kind.flights-fuel').ok, false, 'вид профілю невідомий нижньому шару');
});

/* ------------------------------------------------------------------ */
/*  Шари                                                               */
/* ------------------------------------------------------------------ */

test('a profile catalog builds on the built-in layer and cannot take its ids', () => {
  const builtin = validateCatalog(EXAMPLE).catalog;
  const mine = {
    format: 'easywar.catalog',
    version: 1,
    id: 'cat.profile.mine',
    title: 'Мій каталог',
    layer: 'profile',
    columns: [{ id: 'col.fuel', type: 'number', unit: 'кг', labels: ['Пальне, кг'], min: 0 }],
    tiles: [{
      id: 'tile.fuel', label: 'Пальне, кг', measure: { agg: 'sum', column: 'col.fuel' },
      visual: 'bars', by: 'col.date', tone: 'orange', delta: 'warn', based_on: 'tile.hours',
    }],
    blocks: [{ id: 'block.mine', title: 'Мої показники', kind: 'tiles', tiles: ['tile.hours', 'tile.fuel'] }],
    kinds: [{
      id: 'kind.flights-fuel',
      title: 'Журнал польотів з пальним',
      sheet: 'Польоти',
      based_on: 'kind.flights',
      columns: [{ column: 'col.date', core: true }, { column: 'col.hours', core: true }, { column: 'col.fuel' }],
      tiles: ['tile.hours', 'tile.fuel'],
      blocks: ['block.mine'],
      layout: { rows: [{ cols: [{ w: 1, cards: ['block.mine'] }] }] },
    }],
  };
  const ok = validateCatalog(mine, { base: [builtin] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.ok, true);

  const alone = validateCatalog(mine);
  assert.equal(alone.ok, false, 'без нижнього шару посилання нікуди не ведуть');
  assert.ok(codes(alone).includes('tiles[0].by:unknown_column'));

  const stolen = structuredClone(mine);
  stolen.columns[0].id = 'col.hours';
  assert.ok(codes(validateCatalog(stolen, { base: [builtin] })).includes('columns[0].id:duplicate_id'), 'id вбудованого елемента не перевизначається');
});

test('base accepts only validated catalogs of the same or a lower layer', () => {
  const builtin = validateCatalog(EXAMPLE).catalog;
  assert.throws(() => validateCatalog(EXAMPLE, { base: [structuredClone(EXAMPLE)] }), TypeError);
  assert.throws(() => validateCatalog(EXAMPLE, { base: [{ ...builtin }] }), TypeError, 'копія результату вже не є перевіреною');
  assert.throws(() => validateCatalog(EXAMPLE, { base: 'x' }), TypeError);

  const owner = validateCatalog({ format: 'easywar.catalog', version: 1, id: 'cat.owner', title: 'Власник', layer: 'owner' }).catalog;
  const lower = { ...EXAMPLE, id: 'cat.example.lower', layer: 'builtin', lists: [], columns: [], tiles: [], blocks: [], kinds: [] };
  assert.throws(() => validateCatalog(lower, { base: [owner] }), TypeError, 'вбудований шар не може спиратися на шар власника');
  assert.equal(validateCatalog({ ...lower, layer: 'owner', id: 'cat.owner2' }, { base: [builtin] }).ok, true);
  assert.deepEqual([...LAYERS], ['builtin', 'owner', 'profile']);
});

/* ------------------------------------------------------------------ */
/*  Текст файлу й ворожий вхід                                         */
/* ------------------------------------------------------------------ */

test('catalog text: BOM is allowed, broken or oversized files are refused without details', () => {
  const withBom = `${chars(0xfeff)}${EXAMPLE_TEXT}`;
  assert.equal(validateCatalog(withBom).ok, true);
  assert.deepEqual(parseCatalogText('{ not json'), { value: null, error: { code: 'invalid_json', message: 'Файл не є коректним JSON.' } });
  assert.equal(parseCatalogText(5).error.code, 'not_text');
  const huge = ' '.repeat(LIMITS.maxBytes + 1);
  assert.equal(parseCatalogText(huge).error.code, 'too_large');
  // у UTF-16 це менше за ліміт знаків, але у UTF-8 — більше за ліміт байтів
  const wide = `"${'я'.repeat(LIMITS.maxBytes / 2)}"`;
  assert.equal(parseCatalogText(wide).error.code, 'too_large');
  const broken = validateCatalog('[1, 2');
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.errors.map((error) => error.code), ['invalid_json']);
  assert.equal(broken.errors[0].path, '');
  assert.equal(validateCatalog('[]').ok, false);
});

test('hostile input does not pollute prototypes or get through as a catalog', () => {
  const polluted = JSON.parse(`{"__proto__": {"polluted": true}, "format": "easywar.catalog", "version": 1, "id": "cat.x", "title": "x", "layer": "builtin"}`);
  const result = validateCatalog(polluted);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('__proto__:unknown_key'));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);

  class Fake { constructor() { Object.assign(this, structuredClone(EXAMPLE)); } }
  assert.equal(validateCatalog(new Fake()).ok, false, 'екземпляр класу — не простий об’єкт');
  assert.equal(validateCatalog(Object.create({ format: 'easywar.catalog' })).ok, false);

  const deep = '['.repeat(50_000) + ']'.repeat(50_000);
  assert.equal(validateCatalog(deep).ok, false);

  const echoed = run((c) => { c[`bad${chars(0x202e, 0x0a)}key`] = 1; });
  assert.equal(echoed.ok, false);
  assert.ok(echoed.errors.every((error) => ![...error.message].some((ch) => ch.codePointAt(0) === 0x202e || ch === '\n')), 'у повідомленні немає чужих керівних символів');
});

/* ------------------------------------------------------------------ */
/*  Допоміжні функції                                                  */
/* ------------------------------------------------------------------ */

test('requirement helpers list exactly the columns an element reads', () => {
  const { catalog } = validateCatalog(EXAMPLE);
  const tile = (id) => byId(catalog.tiles, id);
  const sorted = (items) => [...items].sort();
  assert.deepEqual(sorted(tileColumns(tile('tile.flights'))), ['col.aircraft', 'col.date', 'col.hours', 'col.night'], 'факти підказки й вага «top» теж читають стовпці');
  assert.deepEqual(sorted(tileColumns(tile('tile.night-count'))), ['col.date', 'col.night']);
  assert.deepEqual(sorted(tileColumns(tile('tile.hours'))), ['col.date', 'col.hours']);
  assert.deepEqual(sorted(tileColumns(tile('tile.night'))), ['col.night']);
  assert.deepEqual(sorted(tileColumns(tile('tile.hours-per-aircraft'))), ['col.date', 'col.hours', 'col.tail']);
  assert.deepEqual(sorted(tileColumns(tile('tile.combat'))), ['col.aircraft', 'col.date', 'col.mission']);

  const find = (id) => tile(id);
  const block = (id) => byId(catalog.blocks, id);
  assert.deepEqual(sorted(blockColumns(block('block.summary'), find)), ['col.aircraft', 'col.date', 'col.hours', 'col.mission', 'col.night', 'col.tail']);
  assert.deepEqual(sorted(blockColumns(block('block.dynamics'), find)), ['col.date', 'col.hours']);
  assert.deepEqual(sorted(blockColumns(block('block.by-hour'), find)), ['col.date', 'col.takeoff']);
  assert.deepEqual(sorted(blockColumns(block('block.journal'), find)), ['col.aircraft', 'col.date', 'col.hours', 'col.tail', 'col.takeoff']);
  assert.deepEqual(blockColumns(block('block.quality'), find), []);
});

test('foldLabel ignores case, spacing and apostrophe variants', () => {
  assert.equal(foldLabel("  Об'єкт   цілі "), foldLabel(`ОБ${chars(0x2019)}ЄКТ ЦІЛІ`));
  assert.equal(foldLabel(`Об${chars(0x2bc)}єкт`), foldLabel("об'єкт"));
  assert.equal(foldLabel(`Бо${chars(0x438, 0x306)}`), foldLabel(`бо${chars(0x439)}`));
  assert.notEqual(foldLabel('Мі-8'), foldLabel('Ми-8'));
});

/* ------------------------------------------------------------------ */
/*  Гігієна коду й узгодженість документа                              */
/* ------------------------------------------------------------------ */

test('the module is pure: no DOM, network, storage, dynamic code or clock', () => {
  const code = SOURCE.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\b(document|window|navigator|localStorage|sessionStorage|indexedDB)\b/);
  assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\b|\bimport\s*\(/);
  assert.doesNotMatch(code, /\beval\b|new\s+Function|\bFunction\s*\(|setTimeout|setInterval|Date\.now|new Date\(\)|Math\.random|console\./);
  assert.doesNotMatch(code, /^import\s/m, 'ядро не залежить від інших модулів');
});

test('source and documentation contain no invisible or bidi characters', () => {
  const bad = (code) => code < 0x20 && code !== 0x0a || code === 0x7f || (code >= 0x80 && code <= 0x9f)
    || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e)
    || (code >= 0x2060 && code <= 0x206f) || code === 0xfeff;
  for (const [name, text] of [['catalog-core.js', SOURCE], ['CATALOG.md', DOC]]) {
    for (const ch of text) assert.ok(!bad(ch.codePointAt(0)), `${name}: невидимий символ U+${ch.codePointAt(0).toString(16)}`);
  }
});

test('the documentation names every keyword and limit the validator knows', () => {
  const dictionaries = {
    COLUMN_TYPES, AGGREGATES, FILTER_OPS, TILE_VISUALS, TONES, DELTA_MODES, BLOCK_KINDS, GRAINS, SHAPES, DURATION_UNITS, LAYERS,
  };
  for (const [name, words] of Object.entries(dictionaries)) {
    for (const word of words) assert.ok(DOC.includes(`\`${word}\``), `docs/CATALOG.md не згадує ${name}: «${word}»`);
  }
  assert.ok(DOC.includes(`${LIMITS.maxBytes / 1024} КіБ`));
  assert.ok(DOC.includes(`до ${LIMITS.layoutMaxRows} рядів, до ${LIMITS.layoutMaxCols} колонок`));
  assert.ok(DOC.includes(`від 0\n  до ${LIMITS.layoutMaxWidth}`) || DOC.includes(`від 0 до ${LIMITS.layoutMaxWidth}`));
  assert.ok(DOC.includes(`Від 1 до ${LIMITS.maxValuesPerList} значень`));
  assert.ok(DOC.includes(`не більше ${LIMITS.maxErrors} повідомлень`));
  assert.ok(DOC.includes(`${LIMITS.maxLists} списків, ${LIMITS.maxColumns} стовпців, ${LIMITS.maxTiles} плиток, ${LIMITS.maxBlocks} блоків`));
  assert.ok(DOC.includes(`${LIMITS.maxKinds} видів`));
  assert.ok(DOC.includes(`від 1 до ${LIMITS.maxNav} вкладок`));
  assert.ok(DOC.includes(`до ${LIMITS.navLabelLength} символів`));
  for (const word of ['deriveTable', 'NAV_HOME', 'nav_home_first', 'nav_home_locked', NAV_HOME.label, 'validateTableSchema', TABLE_FORMAT, 'header_not_offered', 'missing_core', 'orphan']) {
    assert.ok(DOC.includes(word), `docs/CATALOG.md не згадує ${word}`);
  }
});
