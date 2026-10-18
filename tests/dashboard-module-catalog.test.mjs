import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FUEL_DENSITY_KG_PER_L,
  MAX_CREW,
  branchFromLocation,
  crewCount,
  crewSummary,
  fieldHint,
  fieldInputText,
  fieldInputType,
  fieldKind,
  fieldLimits,
  fieldPlaceholder,
  fieldSections,
  formatDuration,
  formatFieldValue,
  formatFuel,
  fuelKilograms,
  inheritedValues,
  isConflictError,
  matchesCatalogItem,
  normalizeCatalog,
  normalizeModules,
  outsideLimits,
  parseDuration,
  parseFieldInput,
  parseHeight,
  previewModel,
  replaceRowsRequest,
  rowForStorage,
  rowForWrite,
  rowsAfterDelete,
  rowsAfterSave,
  schemaSummary,
  tableEditState,
} from '../src/dashboard-module-catalog-core.js';

const field = (key, label, dataType = 'text', role = 'note', aggregation = 'none', required = false) => (
  { key, label, dataType, role, aggregation, required }
);
const flightFields = [
  field('list_number', 'Номер за списком', 'integer', 'order'),
  field('aircraft_type', 'Тип ПС', 'text', 'dimension', 'none', true),
  field('aircraft_number', 'Номер ПС', 'text', 'dimension'),
  field('day_night', 'День / ніч', 'text', 'dimension'),
  field('flight_shift_number', 'Номер льотної зміни', 'integer', 'dimension'),
  field('training_program_fuel', 'Програма підготовки (паливо)'),
  field('combat_training_exercise_number', 'Номер вправи за курсом бойової підготовки'),
  field('complex_exercise_number_1', 'Номер вправи у комплексі №1'),
  field('complex_exercise_number_2', 'Номер вправи у комплексі №2'),
  field('flight_count', 'Кількість польотів', 'integer', 'metric', 'sum'),
  field('engine_test_time', 'Запуск, проба, год:хв', 'real', 'metric', 'sum'),
  field('takeoff_time', 'Час зльоту', 'text', 'dimension'),
  field('landing_time', 'Час посадки', 'text', 'dimension'),
  field('airborne_hours', 'Наліт (повітря), год:хв', 'real', 'metric', 'sum', true),
  field('total_hours', 'Наліт (загальний), год:хв', 'real', 'metric', 'sum', true),
  field('flight_altitude', 'Висота польоту, м', 'real', 'metric', 'average'),
  field('combat_application_grade', 'Оцінка бойового застосування', 'text', 'status'),
  field('flight_grade', 'Оцінка за політ', 'text', 'status'),
  field('cloud_base_upper', 'Верхня межа хмар (ВМХ), м', 'real', 'metric', 'average'),
  field('cloud_base_lower', 'Нижня межа хмар (НМХ), м', 'real', 'metric', 'average'),
  field('cloud_cover', 'Хмарність, 0–10', 'integer', 'metric', 'average'),
  field('visibility', 'Видимість, км', 'real', 'metric', 'average'),
  field('instrument_meteorological_conditions', 'Політ у СМУ', 'boolean', 'status'),
  field('time_in_clouds', 'Час у хмарах, год:хв', 'real', 'metric', 'sum'),
  field('hood_time', 'Час під шторкою, год:хв', 'real', 'metric', 'sum'),
  field('fuel_consumption', 'Витрата палива, л', 'real', 'metric', 'sum'),
  field('crew_ke', 'Екіпаж: КЕ', 'text', 'dimension'),
  field('crew_lsh', 'Екіпаж: ЛШ', 'text', 'dimension'),
  field('crew_bt', 'Екіпаж: БТ', 'text', 'dimension'),
  field('crew_other', 'Екіпаж: інші (до 5)', 'text', 'dimension'),
  field('passengers', 'Пасажири', 'integer', 'metric', 'sum'),
  field('cargo_kg', 'Вантаж, кг', 'real', 'metric', 'sum'),
  field('rsp_approaches', 'Заходів РСП', 'integer', 'metric', 'sum'),
  field('rsp_landings', 'Посадок РСП', 'integer', 'metric', 'sum'),
];
const flightField = key => flightFields.find(item => item.key === key);
const flightFieldKeys = flightFields.map(item => item.key);

test('branch follows command dashboards and module pages', () => {
  assert.equal(branchFromLocation('/air.html', ''), 'air');
  assert.equal(branchFromLocation('/air.html', '?command=pvk'), 'pvk');
  assert.equal(branchFromLocation('/rocket.html', ''), 'rocket');
  assert.equal(branchFromLocation('/rocket.html', '?command=dshv'), 'dshv');
});

test('catalog normalization preserves the exact flight-hours schema', () => {
  const catalog = normalizeCatalog([{
    id: 'flight-hours', title: 'Загальний наліт за типом ПС', category: 'Авіація',
    description: 'Наліт за типом', visualKind: 'horizontal-bar', defaultSpan: 2, fields: flightFields,
  }]);
  assert.equal(catalog.length, 1);
  assert.deepEqual(catalog[0].fields.map(item => item.key), flightFieldKeys);
  assert.equal(catalog[0].fields[7].label, 'Номер вправи у комплексі №1');
  assert.equal(catalog[0].fields[8].label, 'Номер вправи у комплексі №2');
  assert.match(schemaSummary(catalog[0].fields), /Тип ПС · text/);
  assert.equal(matchesCatalogItem(catalog[0], 'повітря'), true);
  assert.equal(matchesCatalogItem(catalog[0], 'воронка'), false);
});

test('malformed catalog and module records are dropped', () => {
  assert.deepEqual(normalizeCatalog([{ id: 'bad', title: 'X', category: 'Y', visualKind: 'script', fields: flightFields }]), []);
  assert.deepEqual(normalizeModules([{ id: 'x', branch: 'air', visualKind: 'line', title: 'X', storageTable: 'unsafe', fields: flightFields }]), []);
});

test('module normalization accepts only local generated storage tables', () => {
  const [module] = normalizeModules([{
    id: 'dashboard-123', branch: 'air', templateId: 'flight-hours', visualKind: 'horizontal-bar',
    title: 'Наліт', storageTable: 'dashboard_data_1234567890abcdef12345678', rowCount: 2, fields: flightFields,
  }]);
  assert.equal(module.storageTable, 'dashboard_data_1234567890abcdef12345678');
  assert.equal(module.rowCount, 2);
});

test('preview model aggregates numeric series without inventing missing values', () => {
  const model = previewModel({ visualKind: 'horizontal-bar', fields: flightFields }, [
    { aircraft_type: 'F-16', airborne_hours: 12.5, total_hours: 20, flight_count: 2, fuel_consumption: 300 },
    { aircraft_type: 'F-16', airborne_hours: 7.5, total_hours: 10, flight_count: 1, fuel_consumption: 180 },
    { aircraft_type: 'МіГ-29', airborne_hours: 8, total_hours: 15, flight_count: 1, fuel_consumption: 250 },
  ]);
  assert.equal(model.empty, false);
  assert.equal(model.max, 30);
  assert.equal(model.total, 73);
  assert.deepEqual(model.points[0], { label: 'F-16', values: [20, 30], status: '—' });
  assert.equal(previewModel({ visualKind: 'line', fields: flightFields }, []).empty, true);
});

test('preview model aggregates the complete backend row limit', () => {
  const rows = Array.from({ length: 10_000 }, () => ({
    aircraft_type: 'F-16',
    airborne_hours: 1,
    total_hours: 2,
  }));

  const model = previewModel({ visualKind: 'horizontal-bar', fields: flightFields }, rows);

  assert.deepEqual(model.points[0], {
    label: 'F-16',
    values: [10_000, 20_000],
    status: '—',
  });
});

test('flight log editor converts all supported input types', () => {
  const row = rowForWrite(flightFields, {
    list_number: '7',
    aircraft_type: 'F-16',
    day_night: 'Ніч',
    flight_count: '2',
    takeoff_time: '21:10',
    landing_time: '22:35',
    airborne_hours: '1:25',
    total_hours: '1:45',
    flight_altitude: '0,3 км',
    visibility: '10',
    fuel_consumption: '255',
    instrument_meteorological_conditions: 'false',
  });
  assert.equal(row.list_number, 7);
  assert.equal(row.airborne_hours, 85 / 60);
  assert.equal(row.total_hours, 1.75);
  assert.equal(row.flight_altitude, 300);
  assert.equal(row.visibility, 10);
  assert.equal(row.fuel_consumption, 255);
  assert.equal(row.instrument_meteorological_conditions, false);
  assert.equal('hood_time' in row, false);
  assert.equal(fieldInputType(flightFields.find(item => item.key === 'takeoff_time')), 'time');
  assert.equal(fieldInputType(flightFields.find(item => item.key === 'instrument_meteorological_conditions')), 'select');
  assert.throws(() => parseFieldInput(flightField('aircraft_type'), ''), /обов'язковим/);
  assert.throws(() => parseFieldInput(flightField('cloud_cover'), '5.5'), /ціле число/);
});

test('durations are typed and shown as год:хв and stored as decimal hours', () => {
  assert.equal(parseDuration('0:32'), 32 / 60);
  assert.equal(parseDuration(' 1:05 '), 65 / 60);
  assert.equal(parseDuration('0:00'), 0);
  assert.equal(parseDuration('100:59'), (100 * 60 + 59) / 60);
  for (const bad of ['', '0:5', '0:60', '1,5', '1.30', '-0:30', '1:2:3', '0 :32', ':30', 'abc', '12345:00', null, undefined, 1.5]) {
    assert.equal(parseDuration(bad), null, String(bad));
  }
  assert.equal(formatDuration(32 / 60), '0:32');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(1.5), '1:30');
  assert.equal(formatDuration(1.42), '1:25');
  assert.equal(formatDuration(59.9 / 60), '1:00', 'a rounded-up minute carries into the hour');
  assert.equal(formatDuration(null), '—');
  // Кожна хвилина до 100 годин читається назад у те саме число годин.
  for (let minutes = 0; minutes <= 6000; minutes += 1) {
    assert.equal(parseDuration(formatDuration(minutes / 60)), minutes / 60, `${minutes} хв`);
  }
});

test('the owner examples: 0:32 total, 0:22 airborne, 255 litres, 300 metres, 10 km', () => {
  const row = rowForWrite(flightFields, {
    aircraft_type: 'Мі-8',
    airborne_hours: '0:22',
    total_hours: '0:32',
    flight_altitude: '0,3 км',
    visibility: '10',
    fuel_consumption: '255',
  });
  assert.equal(formatFieldValue(flightField('total_hours'), row.total_hours), '0:32');
  assert.equal(formatFieldValue(flightField('airborne_hours'), row.airborne_hours), '0:22');
  assert.equal(formatFieldValue(flightField('flight_altitude'), row.flight_altitude), '300');
  assert.equal(formatFieldValue(flightField('visibility'), row.visibility), '10');
  assert.equal(formatFieldValue(flightField('fuel_consumption'), row.fuel_consumption), '255 л (204 кг)');
});

test('heights are read as metres, and kilometres only with an explicit unit', () => {
  assert.equal(parseHeight('300'), 300);
  assert.equal(parseHeight('300 м'), 300);
  assert.equal(parseHeight('300м'), 300);
  assert.equal(parseHeight('0,3 км'), 300);
  assert.equal(parseHeight('0.3км'), 300);
  assert.equal(parseHeight('1,5 КМ'), 1500);
  assert.equal(parseHeight('1.1 km'), 1100);
  assert.equal(parseHeight('0,5 м'), 0.5);
  assert.equal(parseHeight('0'), 0);
  assert.equal(parseHeight('1500.5'), 1500.5);
  // «0,3» без одиниці — метри чи кілометри? Мовчки вгадувати не можна.
  for (const bad of ['', '0,3', '0.75', 'висота', '300 фут', '-5', '1 000', '3км2', null, undefined, 300]) {
    assert.equal(parseHeight(bad), null, String(bad));
  }
  const altitude = flightField('flight_altitude');
  assert.throws(() => parseFieldInput(altitude, '0,3'), /метри \(300\) або кілометри з позначкою \(0,3 км\)/);
  assert.equal(parseFieldInput(altitude, '0,3 км'), 300);
});

test('fuel is stored in litres and shown with kilograms at density 0.8', () => {
  const fuel = flightField('fuel_consumption');
  assert.equal(FUEL_DENSITY_KG_PER_L, 0.8);
  assert.ok(Math.abs(fuelKilograms(255) - 204) < 1e-9);
  assert.equal(formatFuel(255), '255 л (204 кг)');
  assert.equal(formatFuel(333), '333 л (266,4 кг)');
  assert.equal(formatFuel(0), '0 л (0 кг)');
  assert.equal(formatFieldValue(fuel, 255), '255 л (204 кг)');
  assert.equal(formatFieldValue(fuel, null), '—');
  assert.equal(parseFieldInput(fuel, '255'), 255);
  assert.equal(parseFieldInput(fuel, '255,5'), 255.5);
  assert.throws(() => parseFieldInput(fuel, '-1'), /від'ємним/);
  assert.throws(() => parseFieldInput(fuel, 'багато'), /число/);
});

test('other numbers keep their plain format and the old behaviour', () => {
  const visibility = flightField('visibility');
  assert.equal(formatFieldValue(visibility, 10), '10');
  assert.equal(formatFieldValue(visibility, 7.5), '7,5');
  assert.equal(formatFieldValue(flightField('cloud_cover'), 5), '5');
  assert.equal(formatFieldValue(flightField('aircraft_type'), 'Мі-8'), 'Мі-8');
  assert.equal(formatFieldValue(flightField('instrument_meteorological_conditions'), true), 'Так');
  assert.equal(parseFieldInput(visibility, '7,5'), 7.5);
  assert.equal(parseFieldInput(visibility, '10'), 10);
});

test('only known real fields get a special format', () => {
  assert.equal(fieldKind(flightField('airborne_hours')), 'duration');
  assert.equal(fieldKind(flightField('time_in_clouds')), 'duration');
  assert.equal(fieldKind(flightField('hood_time')), 'duration');
  assert.equal(fieldKind(flightField('flight_altitude')), 'height');
  assert.equal(fieldKind(flightField('cloud_base_upper')), 'height');
  assert.equal(fieldKind(flightField('cloud_base_lower')), 'height');
  assert.equal(fieldKind(flightField('fuel_consumption')), 'fuel');
  assert.equal(fieldKind(flightField('visibility')), null);
  assert.equal(fieldKind({ key: 'airborne_hours', dataType: 'text' }), null);
  assert.equal(fieldKind({ key: 'constructor', dataType: 'real' }), null);
  assert.equal(fieldKind({ key: '__proto__', dataType: 'real' }), null);
  assert.equal(fieldKind(null), null);
});

test('duration fields reject decimal hours and impossible minutes', () => {
  const hours = flightField('airborne_hours');
  assert.equal(parseFieldInput(hours, '0:32'), 32 / 60);
  assert.equal(parseFieldInput(hours, 1.5), 1.5, 'a number from code is already hours');
  for (const bad of ['1,42', '1.30', '0:60', '90', '-0:10']) {
    assert.throws(() => parseFieldInput(hours, bad), /форматі год:хв/, bad);
  }
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => parseFieldInput(hours, bad), /год:хв/, String(bad));
  }
  assert.throws(() => parseFieldInput(hours, ''), /обов'язковим/);
});

test('inputs, placeholders and hints match the special formats', () => {
  const fuel = flightField('fuel_consumption');
  const altitude = flightField('flight_altitude');
  assert.equal(fieldInputType(flightField('airborne_hours')), 'text');
  assert.equal(fieldInputType(flightField('hood_time')), 'text');
  assert.equal(fieldInputType(altitude), 'text');
  assert.equal(fieldInputType(fuel), 'number');
  assert.equal(fieldInputType(flightField('visibility')), 'number');
  assert.equal(fieldPlaceholder(flightField('total_hours')), '0:32');
  assert.equal(fieldPlaceholder(altitude), '300 або 0,3 км');
  assert.equal(fieldPlaceholder(flightField('visibility')), '');
  assert.equal(fieldHint(fuel, '255'), '≈ 204 кг (густина 0,8 кг/л)');
  assert.equal(fieldHint(fuel, '255,5'), '≈ 204,4 кг (густина 0,8 кг/л)');
  for (const text of ['', ' ', 'abc', '-5', undefined]) assert.equal(fieldHint(fuel, text), '', String(text));
  assert.equal(fieldHint(altitude, '0,3 км'), '= 300 м');
  assert.equal(fieldHint(altitude, '300'), '');
  assert.equal(fieldHint(altitude, 'abc км'), '');
  assert.equal(fieldHint(flightField('visibility'), '10'), '');
  assert.equal(fieldHint(flightField('airborne_hours'), '0:32'), '');
});

test('a row opened for editing is not rewritten where the text was not changed', () => {
  const hours = flightField('airborne_hours');
  const original = { rowId: 3, aircraft_type: 'Мі-8', airborne_hours: 1.42, total_hours: 1.75, fuel_consumption: 255 };
  assert.equal(fieldInputText(hours, 1.42), '1:25');
  const form = { aircraft_type: 'Мі-8МТ', airborne_hours: '1:25', total_hours: '1:45', fuel_consumption: '255' };

  const untouched = rowForWrite(flightFields, form, original);
  assert.equal(untouched.airborne_hours, 1.42, 'the shown 1:25 is not written back over 1.42');
  assert.equal(untouched.total_hours, 1.75);
  assert.equal(untouched.aircraft_type, 'Мі-8МТ');

  assert.equal(rowForWrite(flightFields, { ...form, airborne_hours: '1:26' }, original).airborne_hours, 86 / 60);
  assert.equal('fuel_consumption' in rowForWrite(flightFields, { ...form, fuel_consumption: '' }, original), false);
  assert.equal(rowForWrite(flightFields, form).airborne_hours, 85 / 60, 'without the original the text is converted');
});

test('the text a field is opened with always reads back to the same value', () => {
  const cases = [
    ['airborne_hours', 0], ['airborne_hours', 85 / 60], ['total_hours', 1.75],
    ['flight_altitude', 300], ['flight_altitude', 0.5], ['flight_altitude', 1500.5],
    ['cloud_base_upper', 1200], ['cloud_base_lower', 300], ['cloud_base_lower', 0.5],
    ['fuel_consumption', 255], ['fuel_consumption', 255.5], ['visibility', 10], ['cloud_cover', 3], ['cloud_cover', 0],
    ['aircraft_type', 'Мі-8'], ['instrument_meteorological_conditions', false],
  ];
  for (const [key, value] of cases) {
    const item = flightField(key);
    assert.deepEqual(parseFieldInput(item, fieldInputText(item, value)), value, `${key}=${value}`);
  }
  assert.equal(fieldInputText(flightField('flight_altitude'), 0.5), '0.5 м');
  assert.equal(fieldInputText(flightField('airborne_hours'), null), '');
});

test('the unit labels in the JS fixtures are the ones the Rust catalog ships', async () => {
  const store = await readFile(new URL('../src-tauri/src/dashboard_modules.rs', import.meta.url), 'utf8');
  const keys = [
    'airborne_hours', 'total_hours', 'flight_altitude', 'cloud_base_upper', 'cloud_base_lower', 'cloud_cover',
    'visibility', 'time_in_clouds', 'hood_time', 'fuel_consumption',
    'crew_ke', 'crew_lsh', 'crew_bt', 'crew_other',
    'aircraft_number', 'engine_test_time', 'passengers', 'cargo_kg', 'rsp_approaches', 'rsp_landings',
  ];
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const key of keys) {
    const label = flightField(key).label;
    // Ключ і підпис стоять поруч у шаблоні Rust (в одному рядку або на сусідніх).
    assert.match(store, new RegExp(`"${key}",\\s*"${escape(label)}"`), `${key}: «${label}»`);
  }
});

test('cloud bases take metres or kilometres with a unit, like the flight altitude', () => {
  const upper = flightField('cloud_base_upper');
  const lower = flightField('cloud_base_lower');
  assert.equal(parseFieldInput(lower, '300'), 300);
  assert.equal(parseFieldInput(lower, '0,3 км'), 300);
  assert.equal(parseFieldInput(upper, '1200 м'), 1200);
  assert.equal(parseFieldInput(upper, '1,5 км'), 1500);
  assert.equal(parseFieldInput(upper, ''), null);
  assert.throws(() => parseFieldInput(lower, '0,3'), /метри \(300\) або кілометри з позначкою \(0,3 км\)/);
  assert.throws(() => parseFieldInput(upper, 'низько'), /метри/);
  assert.equal(fieldInputType(lower), 'text');
  assert.equal(fieldPlaceholder(upper), '300 або 0,3 км');
  assert.equal(fieldHint(lower, '0,3 км'), '= 300 м');
  assert.equal(formatFieldValue(lower, 300), '300');
});

test('cloud cover is a whole number from 0 to 10', () => {
  const cover = flightField('cloud_cover');
  assert.deepEqual(fieldLimits(cover), { min: 0, max: 10 });
  for (const ok of ['0', '5', '10', ' 7 ']) assert.equal(parseFieldInput(cover, ok), Number(ok), ok);
  for (const bad of ['-1', '11', '100', '75']) {
    assert.throws(() => parseFieldInput(cover, bad), /має бути від 0 до 10/, bad);
  }
  for (const bad of ['5.5', '10,5', 'ясно']) assert.throws(() => parseFieldInput(cover, bad), /ціле число/, bad);
  assert.equal(parseFieldInput(cover, ''), null);
  assert.equal(parseFieldInput(cover, 4), 4);
  assert.throws(() => parseFieldInput(cover, 12), /від 0 до 10/);
});

test('visibility and fuel cannot be negative, and other fields get no limits', () => {
  assert.deepEqual(fieldLimits(flightField('visibility')), { min: 0 });
  assert.deepEqual(fieldLimits(flightField('fuel_consumption')), { min: 0 });
  assert.equal(fieldLimits(flightField('flight_count')), null);
  assert.equal(fieldLimits(flightField('aircraft_type')), null);
  assert.equal(fieldLimits({ key: 'cloud_cover', dataType: 'text' }), null);
  assert.equal(fieldLimits({ key: 'constructor', dataType: 'real' }), null);
  assert.equal(fieldLimits(null), null);
  const visibility = flightField('visibility');
  assert.equal(parseFieldInput(visibility, '0'), 0);
  assert.equal(parseFieldInput(visibility, '0,5'), 0.5);
  assert.throws(() => parseFieldInput(visibility, '-1'), /від'ємним/);
});

test('the columns taken from the owner table: start/test is a duration, counts and cargo are not negative', () => {
  const start = flightField('engine_test_time');
  assert.equal(fieldKind(start), 'duration');
  assert.equal(fieldInputType(start), 'text');
  assert.equal(fieldPlaceholder(start), '0:32');
  assert.equal(parseFieldInput(start, '0:10'), 10 / 60);
  assert.equal(formatFieldValue(start, 10 / 60), '0:10');
  assert.equal(parseFieldInput(start, ''), null, 'the field is optional');
  assert.throws(() => parseFieldInput(start, '10'), /форматі год:хв/);
  assert.throws(() => parseFieldInput(start, '0,17'), /форматі год:хв/);

  for (const key of ['passengers', 'rsp_approaches', 'rsp_landings']) {
    const item = flightField(key);
    assert.equal(fieldKind(item), null, key);
    assert.deepEqual(fieldLimits(item), { min: 0 }, key);
    assert.equal(parseFieldInput(item, '3'), 3, key);
    assert.equal(parseFieldInput(item, '0'), 0, key);
    assert.equal(parseFieldInput(item, ''), null, key);
    assert.throws(() => parseFieldInput(item, '-1'), /від'ємним/, key);
    assert.throws(() => parseFieldInput(item, '1,5'), /ціле число/, key);
  }

  const cargo = flightField('cargo_kg');
  assert.deepEqual(fieldLimits(cargo), { min: 0 });
  assert.equal(parseFieldInput(cargo, '500'), 500);
  assert.equal(parseFieldInput(cargo, '12,5'), 12.5);
  assert.throws(() => parseFieldInput(cargo, '-5'), /від'ємним/);

  const board = flightField('aircraft_number');
  assert.equal(fieldInputType(board), 'text');
  assert.equal(parseFieldInput(board, ' 41 '), '41');
  assert.equal(parseFieldInput(board, 'Б-12'), 'Б-12', 'a board number may contain letters');
});

test('a record with every column of the owner table is accepted field by field', () => {
  // Синтетичний запис: значення вигадані, лише порядок і формати — як у таблиці власника.
  const row = rowForWrite(flightFields, {
    list_number: '1',
    flight_shift_number: '1',
    aircraft_type: 'Мі-8',
    aircraft_number: '71',
    engine_test_time: '0:10',
    day_night: 'Д',
    instrument_meteorological_conditions: 'false',
    flight_count: '1',
    combat_training_exercise_number: '2',
    complex_exercise_number_1: '3',
    complex_exercise_number_2: '6',
    takeoff_time: '10:05',
    landing_time: '10:27',
    airborne_hours: '0:22',
    total_hours: '0:32',
    time_in_clouds: '',
    hood_time: '',
    flight_altitude: '300м',
    fuel_consumption: '255',
    training_program_fuel: '12',
    crew_ke: 'Тестенко',
    crew_lsh: 'Зразкович',
    crew_bt: 'Прикладний',
    crew_other: '',
    passengers: '0',
    cargo_kg: '500',
    combat_application_grade: '5',
    flight_grade: '5',
    cloud_cover: '6',
    cloud_base_lower: '600',
    cloud_base_upper: '1500',
    visibility: '8',
    rsp_approaches: '',
    rsp_landings: '',
  });
  assert.equal(row.aircraft_number, '71');
  assert.equal(row.engine_test_time, 10 / 60);
  assert.ok(Math.abs(row.total_hours - row.airborne_hours - row.engine_test_time) < 1e-9, 'start/test is the difference of the two flight times');
  assert.equal(row.flight_altitude, 300);
  assert.equal(row.instrument_meteorological_conditions, false);
  assert.equal(row.passengers, 0);
  assert.equal(row.cargo_kg, 500);
  assert.equal('rsp_approaches' in row, false, 'empty fields are not written');
  assert.equal(crewCount(row), 3);
  assert.deepEqual(
    Object.keys(row).filter(key => !flightFieldKeys.includes(key)),
    [],
    'every written key is a catalog field',
  );
});

test('a stored value outside the limits is detected but never blocks an unchanged field', () => {
  const cover = flightField('cloud_cover');
  assert.equal(outsideLimits(cover, 75), true);
  assert.equal(outsideLimits(cover, -1), true);
  assert.equal(outsideLimits(cover, 10), false);
  assert.equal(outsideLimits(cover, null), false);
  assert.equal(outsideLimits(flightField('aircraft_type'), 75), false);
  // Старий запис із хмарністю 75: правка іншого поля його не чіпає, нове значення вже перевіряється.
  const original = { rowId: 4, aircraft_type: 'Мі-8', airborne_hours: 1, total_hours: 1, cloud_cover: 75 };
  const form = { aircraft_type: 'Мі-8МТ', airborne_hours: '1:00', total_hours: '1:00', cloud_cover: '75' };
  assert.equal(rowForWrite(flightFields, form, original).cloud_cover, 75);
  assert.throws(() => rowForWrite(flightFields, { ...form, cloud_cover: '76' }, original), /від 0 до 10/);
  assert.throws(() => rowForWrite(flightFields, form), /від 0 до 10/, 'a new row is always checked');
});

test('the lower cloud base cannot be above the upper one', () => {
  const base = { aircraft_type: 'Мі-8', airborne_hours: '0:22', total_hours: '0:32' };
  assert.throws(
    () => rowForWrite(flightFields, { ...base, cloud_base_upper: '300', cloud_base_lower: '1200' }),
    /Нижня межа хмар \(НМХ\) не може бути вищою за верхню \(ВМХ\)/,
  );
  assert.equal(rowForWrite(flightFields, { ...base, cloud_base_upper: '800', cloud_base_lower: '800' }).cloud_base_lower, 800);
  const row = rowForWrite(flightFields, { ...base, cloud_base_upper: '1,2 км', cloud_base_lower: '300' });
  assert.deepEqual([row.cloud_base_upper, row.cloud_base_lower], [1200, 300]);
  // З однією межею порівнювати нема з чим.
  assert.equal(rowForWrite(flightFields, { ...base, cloud_base_lower: '300' }).cloud_base_lower, 300);
  assert.equal(rowForWrite(flightFields, { ...base, cloud_base_upper: '300' }).cloud_base_upper, 300);
});

test('the form groups the meteo and crew fields and keeps the rest in catalog order', () => {
  const sections = fieldSections(flightFields);
  assert.deepEqual(sections.map(section => section.id), ['main', 'meteo', 'crew']);
  assert.deepEqual(sections.map(section => section.title), ['', 'Метеоумови', 'Екіпаж']);
  const keys = id => sections.find(section => section.id === id).fields.map(item => item.key);
  assert.deepEqual(keys('meteo'), ['cloud_base_upper', 'cloud_base_lower', 'cloud_cover', 'visibility']);
  assert.deepEqual(keys('crew'), ['crew_ke', 'crew_lsh', 'crew_bt', 'crew_other']);
  assert.ok(keys('main').includes('instrument_meteorological_conditions'), 'the СМУ flag describes the flight, not the weather');
  assert.equal(keys('main')[0], 'list_number');
  assert.deepEqual(keys('main').slice(1, 3), ['aircraft_type', 'aircraft_number'], 'the board number follows the type');
  assert.ok(keys('main').indexOf('engine_test_time') < keys('main').indexOf('takeoff_time'), 'start/test comes before take-off');
  assert.deepEqual(keys('main').slice(-4), ['passengers', 'cargo_kg', 'rsp_approaches', 'rsp_landings']);
  assert.deepEqual(
    sections.flatMap(section => section.fields.map(item => item.key)).sort(),
    [...flightFieldKeys].sort(),
    'every catalog field appears in the form exactly once',
  );
  assert.equal(sections[1].inherit, true);
  assert.equal(sections[2].inherit, false);
  assert.match(sections[2].note, /до 8 осіб/);
  assert.match(sections[2].note, /інструктор/, 'an instructor is possible for any crew member, not only on an aircraft');
  assert.doesNotMatch(sections[2].note, /^Літак/u, 'the limit of 8 is not tied to one aircraft type');
});

test('a module without grouped fields keeps one plain section, and empty groups vanish', () => {
  const plain = [field('label', 'Показник', 'text', 'label', 'none', true), field('value', 'Значення', 'real', 'metric', 'sum')];
  const sections = fieldSections(plain);
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0], { id: 'main', title: '', note: '', inherit: false, fields: plain });
  assert.deepEqual(fieldSections([]), []);
  assert.deepEqual(fieldSections(null), []);
  assert.deepEqual(fieldSections([flightField('visibility')]).map(section => section.id), ['meteo']);
});

test('a new record takes the weather from the latest record that has any', () => {
  const rows = [
    { rowId: 1, aircraft_type: 'Мі-8', cloud_base_upper: 1500, cloud_base_lower: 400, cloud_cover: 6, visibility: 8 },
    { rowId: 2, aircraft_type: 'Мі-8', cloud_base_upper: 900, cloud_cover: 3 },
    { rowId: 3, aircraft_type: 'Мі-8', airborne_hours: 1 },
  ];
  const result = inheritedValues(flightFields, rows);
  assert.equal(result.rowIndex, 1, 'row 3 has no weather, row 2 is the latest with some');
  assert.deepEqual(result.values, { cloud_base_upper: 900, cloud_cover: 3 }, 'the set of one record, not a mix with older ones');
  assert.deepEqual(inheritedValues(flightFields, [{ aircraft_type: 'A', cloud_cover: 0 }]).values, { cloud_cover: 0 }, 'zero is a value: clear sky');
  assert.equal(inheritedValues(flightFields, []), null);
  assert.equal(inheritedValues(flightFields, [{ aircraft_type: 'A' }]), null);
  assert.equal(inheritedValues(flightFields, undefined), null);
  assert.equal(inheritedValues([field('value', 'Значення', 'real')], [{ value: 1 }]), null, 'no weather fields, nothing to inherit');
  // Переноситься лише погода: час, наліт, екіпаж і ознака СМУ — дані самого польоту.
  const mixed = inheritedValues(flightFields, [{
    cloud_cover: 5, airborne_hours: 1, crew_ke: 'Тестенко', instrument_meteorological_conditions: true,
  }]);
  assert.deepEqual(Object.keys(mixed.values), ['cloud_cover']);
});

test('the crew is counted by surnames and capped at eight', () => {
  assert.equal(MAX_CREW, 8);
  assert.equal(crewCount({}), 0);
  assert.equal(crewCount(null), 0);
  assert.equal(crewCount({ crew_ke: 'Тестенко' }), 1);
  assert.equal(crewCount({ crew_ke: 'Тестенко', crew_lsh: 'Зразкович', crew_bt: 'Умовний' }), 3);
  assert.equal(crewCount({ crew_other: 'Пробенко, Прикладний,Вигаданий ; Макетенко' }), 4);
  assert.equal(crewCount({ crew_other: ' , ,, ' }), 0, 'separators alone are not people');
  assert.equal(crewCount({ crew_ke: 'Тестенко, Зразкович' }), 2, 'two surnames in one field count twice');
  assert.equal(crewCount({ crew_ke: 5, crew_other: null }), 0);

  const base = { aircraft_type: 'Ан-26', airborne_hours: '0:22', total_hours: '0:32' };
  const eight = {
    crew_ke: 'Тестенко',
    crew_lsh: 'Зразкович',
    crew_bt: 'Умовний',
    crew_other: 'Пробенко, Прикладний, Вигаданий, Макетенко, Фіктивний',
  };
  const saved = rowForWrite(flightFields, { ...base, ...eight });
  assert.equal(crewCount(saved), 8);
  assert.equal(saved.crew_other, eight.crew_other, 'the surnames are stored as typed');
  assert.throws(
    () => rowForWrite(flightFields, { ...base, ...eight, crew_other: `${eight.crew_other}, Шаблонний` }),
    /В екіпажі 9 осіб, а може бути не більше 8/,
  );
});

test('the crew counter says how many of eight are written', () => {
  assert.equal(crewSummary({}), '');
  assert.equal(crewSummary({ crew_ke: '' }), '');
  assert.equal(crewSummary({ crew_ke: 'Тестенко', crew_lsh: 'Зразкович' }), 'Екіпаж: 2 з 8 осіб');
  assert.equal(crewSummary({ crew_other: 'А, Б, В, Г, Д, Е, Ж, З, И' }), 'Екіпаж: 9 з 8 осіб — забагато');
});

test('crew fields are plain text with their own placeholders', () => {
  assert.equal(fieldPlaceholder(flightField('crew_ke')), 'прізвище');
  assert.equal(fieldPlaceholder(flightField('crew_other')), 'прізвища через кому');
  assert.equal(fieldPlaceholder(flightField('aircraft_type')), '');
  assert.equal(fieldPlaceholder({ key: 'crew_ke', dataType: 'integer' }), '', 'only text fields get them');
  assert.equal(fieldKind(flightField('crew_ke')), null);
  assert.equal(fieldInputType(flightField('crew_ke')), 'text');
  assert.equal(parseFieldInput(flightField('crew_ke'), '  Тестенко '), 'Тестенко');
  assert.equal(parseFieldInput(flightField('crew_ke'), ''), null);
});

test('both operational dashboards load the shared module catalog', async () => {
  for (const page of ['air.html', 'rocket.html']) {
    const html = await readFile(new URL(`../src/${page}`, import.meta.url), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="\.\/dashboard-module-catalog\.css">/);
    assert.match(html, /<script type="module" src="\.\/dashboard-module-catalog\.js"><\/script>/);
  }
});

test('the table editor writes only through the dedicated local dashboard command', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(source, /replace_dashboard_module_rows/);
  assert.match(source, /Відкрити таблицю/);
  assert.match(source, /Зберегти зміни/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
});

const savedRows = () => [
  { rowId: 3, createdAt: '2026-10-01T08:00:00Z', aircraft_type: 'Мі-8', airborne_hours: 1.5, total_hours: 1.75, flight_count: null },
  { rowId: 7, createdAt: '2026-10-02T08:00:00Z', aircraft_type: 'Мі-24', airborne_hours: 2, total_hours: 2.25 },
  { rowId: 9, createdAt: '2026-10-03T08:00:00Z', aircraft_type: 'Мі-2', airborne_hours: 0.5, total_hours: 0.5 },
];

test('rows sent to storage keep their rowId but never the service columns', () => {
  assert.deepEqual(
    rowForStorage(flightFields, savedRows()[0]),
    { rowId: 3, aircraft_type: 'Мі-8', airborne_hours: 1.5, total_hours: 1.75 },
  );
  assert.deepEqual(
    rowForStorage(flightFields, { rowId: 4, unknown_field: 1, aircraft_type: 'Мі-8' }),
    { rowId: 4, aircraft_type: 'Мі-8' },
  );
  for (const bad of [0, -1, 1.5, '3', Number.NaN, null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal('rowId' in rowForStorage(flightFields, { rowId: bad, aircraft_type: 'Мі-8' }), false, String(bad));
  }
});

test('saving an edited row keeps every identity and a new row carries none', () => {
  const rows = savedRows();
  const edited = { aircraft_type: 'Мі-8МТ', airborne_hours: 3, total_hours: 3.5 };
  const afterEdit = rowsAfterSave(flightFields, rows, 1, edited);
  assert.deepEqual(afterEdit.map(row => row.rowId), [3, 7, 9]);
  assert.equal(afterEdit[1].aircraft_type, 'Мі-8МТ');
  assert.equal(afterEdit[0].aircraft_type, 'Мі-8');
  assert.equal(afterEdit.some(row => 'createdAt' in row), false);

  const afterAdd = rowsAfterSave(flightFields, rows, null, edited);
  assert.equal(afterAdd.length, 4);
  assert.equal('rowId' in afterAdd[3], false);
  assert.equal(rowsAfterSave(flightFields, rows, 99, edited).length, 4, 'an unknown index adds a row');

  const legacy = rowsAfterSave(flightFields, [{ aircraft_type: 'A', airborne_hours: 1, total_hours: 1 }], 0, edited);
  assert.deepEqual(legacy, [edited]);
  assert.deepEqual(rows, savedRows(), 'the rows the form was opened with are not mutated');
});

test('deleting a row sends everything else with its identity', () => {
  const rows = savedRows();
  const rest = rowsAfterDelete(flightFields, rows, 1);
  assert.deepEqual(rest.map(row => row.rowId), [3, 9]);
  assert.equal(rest.some(row => 'createdAt' in row), false);
  assert.equal(rowsAfterDelete(flightFields, rows, 5).length, 3, 'an index past the end removes nothing');
  assert.equal(rowsAfterDelete(flightFields, rows, -1).length, 3);
  assert.deepEqual(rowsAfterDelete(flightFields, [rows[0]], 0), []);
  assert.deepEqual(rows, savedRows());
});

test('the save request carries the version the table was opened with', () => {
  const version = '2026-10-18T15:24:11.123456789Z';
  assert.deepEqual(
    replaceRowsRequest({ id: 'm1', updatedAt: version }, [{ aircraft_type: 'Мі-8' }]),
    { moduleId: 'm1', rows: [{ aircraft_type: 'Мі-8' }], expectedUpdatedAt: version },
  );
  assert.throws(() => replaceRowsRequest({ id: 'm1' }, []), /версії/);
  assert.throws(() => replaceRowsRequest({ id: 'm1', updatedAt: '' }, []), /версії/);
  assert.throws(() => replaceRowsRequest({ id: 'm1', updatedAt: 5 }, []), /версії/);
  assert.throws(() => replaceRowsRequest({ updatedAt: version }, []), /ідентифікатора/);
});

test('the module record keeps the version string the backend sent', () => {
  const [module] = normalizeModules([{
    id: 'm1',
    branch: 'air',
    visualKind: 'table',
    title: 'Журнал',
    storageTable: 'dashboard_data_0123456789abcdef01234567',
    fields: [field('aircraft_type', 'Тип ПС', 'text', 'dimension')],
    updatedAt: '2026-10-18T15:24:11.123456789Z',
  }]);
  assert.equal(module.updatedAt, '2026-10-18T15:24:11.123456789Z');
});

test('only the backend conflict message is treated as a stale-window conflict', () => {
  assert.equal(isConflictError('таблицю змінено в іншому вікні; відкрийте її знову'), true);
  assert.equal(isConflictError(new Error('Таблицю змінено в іншому вікні; відкрийте її знову')), true);
  assert.equal(isConflictError({ message: 'таблицю змінено в іншому вікні' }), true);
  assert.equal(isConflictError('некоректний або повторений ідентифікатор запису'), false);
  assert.equal(isConflictError(null), false);
  assert.equal(isConflictError(undefined), false);
});

test('a table that failed to load, was truncated or is unknown is never editable', () => {
  assert.deepEqual(tableEditState({ rows: [] }), { editable: true, reason: '' });
  assert.equal(tableEditState({ rows: [], failed: true }).editable, false);
  assert.match(tableEditState({ rows: [], failed: true }).reason, /Не вдалося прочитати/);
  assert.equal(tableEditState({ rows: [], truncated: true }).editable, false);
  assert.match(tableEditState({ rows: [], truncated: true }).reason, /10 000/);
  assert.equal(tableEditState(undefined).editable, false);
  assert.equal(tableEditState(null).editable, false);
});

test('the conflict wording and the version argument match the Rust side', async () => {
  const store = await readFile(new URL('../src-tauri/src/dashboard_modules.rs', import.meta.url), 'utf8');
  assert.match(store, /#\[error\("[^"]*змінено в іншому вікні[^"]*"\)\]\s*Conflict/);
  assert.match(store, /expected_updated_at: Option<&str>/);
  const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /expected_updated_at: Option<String>/);
});

test('the row form shows sections and carries the weather into new records only', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(source, /fieldSections\(module\.fields\)/);
  assert.match(source, /const inherited = isEdit \? null : inheritedValues\(module\.fields, rows\)/);
  for (const text of ['Підставлено з останнього запису, де вказано погоду', 'Очистити', 'ewmc-crew-total']) {
    assert.ok(source.includes(text), text);
  }
});

test('row deletion is confirmed inside the dialog and never uses browser dialogs', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  for (const text of ['Видалити запис', 'Так, видалити', 'Ні, залишити', 'Запис видалено.', 'Прочитати знову']) {
    assert.ok(source.includes(text), text);
  }
  assert.doesNotMatch(source, /\b(?:confirm|alert|prompt)\s*\(/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
});
