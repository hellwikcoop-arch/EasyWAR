import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FUEL_DENSITY_KG_PER_L,
  FieldValueError,
  MAX_CREW,
  branchFromLocation,
  columnCountLabel,
  crewCount,
  crewSummary,
  deleteModulePrompt,
  fieldColumnWidth,
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
  moduleTitle,
  normalizeCatalog,
  normalizeModules,
  outsideLimits,
  parseDuration,
  parseFieldInput,
  parseHeight,
  pluralForm,
  previewModel,
  replaceRowsRequest,
  rowCountLabel,
  rowForStorage,
  rowForWrite,
  rowRuleProblem,
  rowsAfterDelete,
  rowsAfterSave,
  normalizeDensity,
  rowMatchesQuery,
  schemaSummary,
  tableColumnGroups,
  tableEditState,
  visibleColumnKeys,
} from '../src/dashboard-module-catalog-core.js';

const field = (key, label, dataType = 'text', role = 'note', aggregation = 'none', required = false) => (
  { key, label, dataType, role, aggregation, required }
);
const flightFields = [
  field('list_number', 'Номер за списком', 'integer', 'order'),
  field('aircraft_type', 'Тип ПС', 'text', 'dimension', 'none', true),
  field('aircraft_number', 'Номер ПС', 'text', 'dimension'),
  field('crew_ke_callsign', 'Позивний командира екіпажу', 'text', 'dimension'),
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
  const label = key => catalog[0].fields.find(item => item.key === key).label;
  assert.equal(label('complex_exercise_number_1'), 'Номер вправи у комплексі №1');
  assert.equal(label('complex_exercise_number_2'), 'Номер вправи у комплексі №2');
  assert.equal(label('crew_ke_callsign'), 'Позивний командира екіпажу');
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
    'crew_ke', 'crew_ke_callsign', 'crew_lsh', 'crew_bt', 'crew_other',
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

test('the meteo and crew fields form groups and the rest keeps catalog order', () => {
  const sections = fieldSections(flightFields);
  assert.deepEqual(sections.map(section => section.id), ['main', 'meteo', 'crew']);
  assert.deepEqual(sections.map(section => section.title), ['', 'Метеоумови', 'Екіпаж']);
  const keys = id => sections.find(section => section.id === id).fields.map(item => item.key);
  assert.deepEqual(keys('meteo'), ['cloud_base_upper', 'cloud_base_lower', 'cloud_cover', 'visibility']);
  assert.deepEqual(keys('crew'), ['crew_ke', 'crew_lsh', 'crew_bt', 'crew_other']);
  assert.ok(keys('main').includes('instrument_meteorological_conditions'), 'the СМУ flag describes the flight, not the weather');
  assert.equal(keys('main')[0], 'list_number');
  assert.deepEqual(
    keys('main').slice(1, 4),
    ['aircraft_type', 'aircraft_number', 'crew_ke_callsign'],
    'the board number follows the type, and the commander call sign follows the board number',
  );
  assert.equal(keys('crew').includes('crew_ke_callsign'), false, 'the call sign is not a crew member');
  assert.ok(keys('main').indexOf('engine_test_time') < keys('main').indexOf('takeoff_time'), 'start/test comes before take-off');
  assert.deepEqual(keys('main').slice(-4), ['passengers', 'cargo_kg', 'rsp_approaches', 'rsp_landings']);
  assert.deepEqual(
    sections.flatMap(section => section.fields.map(item => item.key)).sort(),
    [...flightFieldKeys].sort(),
    'every catalog field appears in the sections exactly once',
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

test('the commander call sign is a plain text field after the board number, not a crew member', () => {
  const callsign = flightField('crew_ke_callsign');
  assert.equal(callsign.label, 'Позивний командира екіпажу');
  assert.equal(callsign.dataType, 'text');
  assert.equal(callsign.required, false);
  assert.equal(fieldKind(callsign), null);
  assert.equal(fieldInputType(callsign), 'text', 'a number input would drop the leading zeros');
  assert.equal(fieldPlaceholder(callsign), '');
  assert.equal(parseFieldInput(callsign, ' 12345 '), '12345');
  assert.equal(parseFieldInput(callsign, '00123'), '00123', 'it is text, so the leading zeros stay');
  assert.equal(parseFieldInput(callsign, 'Беркут-1'), 'Беркут-1');
  assert.equal(parseFieldInput(callsign, ''), null);
  assert.equal(formatFieldValue(callsign, '00123'), '00123');
  assert.equal(parseFieldInput(callsign, fieldInputText(callsign, '00123')), '00123', 'an opened value reads back unchanged');
  // Це не особа: у склад екіпажу не входить і лічильник сам не запускає.
  assert.equal(crewCount({ crew_ke_callsign: '12345' }), 0);
  assert.equal(crewSummary({ crew_ke_callsign: '12345' }), '');
  const base = { aircraft_type: 'Ан-26', airborne_hours: '0:22', total_hours: '0:32' };
  const eight = {
    crew_ke: 'Тестенко',
    crew_lsh: 'Зразкович',
    crew_bt: 'Умовний',
    crew_other: 'Пробенко, Прикладний, Вигаданий, Макетенко, Фіктивний',
  };
  const saved = rowForWrite(flightFields, { ...base, ...eight, crew_ke_callsign: '12345' });
  assert.equal(crewCount(saved), 8, 'eight people and a call sign are still within the limit');
  assert.equal(saved.crew_ke_callsign, '12345');
  assert.equal('crew_ke_callsign' in rowForWrite(flightFields, base), false, 'an empty call sign is not written');
  // Це не погода: новий запис її не підставляє з попереднього.
  const inherited = inheritedValues(flightFields, [{ aircraft_type: 'Мі-8', crew_ke_callsign: '12345', cloud_cover: 4 }]);
  assert.deepEqual(Object.keys(inherited.values), ['cloud_cover']);
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
  assert.match(source, /Відкрити сторінку/);
  assert.match(source, /Зберегти зміни/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
});

test('a module made under the old default title shows the journal name', () => {
  const base = {
    id: 'dashboard-1', branch: 'air', templateId: 'flight-hours', visualKind: 'horizontal-bar',
    storageTable: 'dashboard_data_1234567890abcdef12345678', fields: flightFields,
  };
  const titleOf = (title, templateId = 'flight-hours') => normalizeModules([{ ...base, templateId, title }])[0].title;
  assert.equal(titleOf('Загальний наліт за типом ПС'), 'Журнал хронометражу польотів');
  assert.equal(titleOf('Журнал хронометражу польотів'), 'Журнал хронометражу польотів');
  assert.equal(titleOf('Журнал 2-ї ескадрильї'), 'Журнал 2-ї ескадрильї', 'a name the user chose is kept');
  assert.equal(titleOf('Загальний наліт за типом ПС', 'other'), 'Загальний наліт за типом ПС', 'only the flight template was renamed');
  assert.equal(moduleTitle(undefined, 'Назва'), 'Назва');
});

test('the Rust catalog names the flight template as the flight journal', async () => {
  const store = await readFile(new URL('../src-tauri/src/dashboard_modules.rs', import.meta.url), 'utf8');
  assert.match(store, /"flight-hours",\s*"Журнал хронометражу польотів",/);
  assert.doesNotMatch(store, /"Загальний наліт за типом ПС"/);
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

test('a record is one table row edited in place, with its form above the table', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  // Окремої багатосекційної форми немає: рядок таблиці стає полями, а форма над таблицею з'єднана з ними атрибутом `form`.
  assert.doesNotMatch(source, /showRowForm|ewmc-row-form-grid|ewmc-group'|ewmc-identity/);
  assert.match(source, /function startEdit\(rowIndex\)/);
  assert.match(source, /control\.setAttribute\('form', ROW_FORM_ID\)/);
  assert.match(source, /form: ROW_FORM_ID/, 'the save button sits in the row but submits the form above the table');
  assert.match(source, /el\('colgroup'/);
  // Ширини колонок — з `fieldColumnWidth`; colgroup перебудовується, коли змінюється група колонок.
  assert.match(source, /el\('col', \{ style: \{ width: `\$\{fieldColumnWidth\(field\)\}px` \} \}\)/);
  assert.match(source, /const inherited = isEdit \? null : inheritedValues\(module\.fields, rows\)/);
  assert.match(source, /controls\.get\(error\?\.fieldKey\)/, 'the cursor goes to the cell with the error');
  assert.match(source, /tr\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  for (const text of [
    'Підставлено з останнього запису, де вказано погоду', 'Очистити', 'ewmc-crew-total', 'Новий запис',
    'Усі поля запису — в одному рядку таблиці', 'Редагування рядка', 'Записів ще немає. Натисніть «+ Додати рядок».',
    'Перейти до:',
  ]) {
    assert.ok(source.includes(text), text);
  }
});

test('a module table opens as a full page, not as a window', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/dashboard-module-catalog.css', import.meta.url), 'utf8');
  assert.match(source, /function showModulePage\(module, focusTarget = null, view = null\)/);
  assert.doesNotMatch(source, /showDataTable/, 'no leftover of the dialog entry point');
  for (const text of ['Відкрити сторінку', '← До дашборда', 'ewmc-page-head', 'ewmc-page-body']) assert.ok(source.includes(text), text);
  assert.match(source, /dialog\.dataset\.view = 'table'/);
  assert.match(source, /onclick: \(\) => showModulePage\(module, 'add'\)/, 'the page opens with the cursor on «+ Додати рядок»');
  // Escape спершу скасовує рядок, що редагується; закриває сторінку лише за відсутності правки.
  assert.match(source, /dialog\.addEventListener\('cancel'/);
  assert.match(source, /state\.cancelEdit = cancel/);
  // Сповіщення живе всередині відкритої сторінки: шар поверх закриває решту документа.
  assert.match(source, /\(dialog\.open \? dialog : document\.body\)\.append\(toast\)/);
  // Після додавання таблиця гортається до нового рядка, після правки лишається на місці.
  assert.match(source, /\{ top: 'end', left: 0 \}/);
  assert.match(source, /scroll\.scrollTop = view\.top === 'end' \? scroll\.scrollHeight : view\.top/);
  assert.match(css, /\.ewmc-dialog\[data-view=table\]\{inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:0/);
  assert.match(css, /\.ewmc-dialog\[data-view=table\]\[open\]\{display:flex;flex-direction:column\}/);
  assert.match(css, /\.ewmc-page-body\{[^}]*flex:1;[^}]*overflow:auto/);
  assert.doesNotMatch(css, /\.ewmc-data-scroll(?:\.is-editing)?\{[^}]*max-height/, 'the table takes the height of the page');
  assert.doesNotMatch(css, /ewmc-data-toolbar/);
});

test('the record row stays on one line and the edge columns are pinned', async () => {
  const css = await readFile(new URL('../src/dashboard-module-catalog.css', import.meta.url), 'utf8');
  assert.match(css, /\.ewmc-data-table\{[^}]*table-layout:fixed/);
  assert.match(css, /td:first-child\{position:sticky;left:0/, 'the row number stays while the row is scrolled');
  assert.match(css, /td:last-child\{position:sticky;right:0/, 'the save and cancel buttons stay in view');
  assert.match(css, /tr\.ewmc-editing>td\{[^}]*overflow:visible/);
  assert.match(css, /\.ewmc-cell-edit input,\.ewmc-cell-edit select\{[^}]*width:100%/);
  assert.match(css, /\.ewmc-cell-edit \[data-inherited=true\]/, 'carried-over weather is marked until it is changed');
  assert.match(css, /\.ewmc-cell-edit \[aria-invalid=true\]/);
  assert.doesNotMatch(css, /ewmc-row-form|ewmc-group\{|ewmc-identity/);
});

test('a value error names the field to fix, so the editor can put the cursor there', () => {
  const caught = fn => { try { fn(); } catch (error) { return error; } return null; };
  const key = (fieldName, text) => caught(() => parseFieldInput(flightField(fieldName), text))?.fieldKey;
  const cover = caught(() => parseFieldInput(flightField('cloud_cover'), '11'));
  assert.ok(cover instanceof FieldValueError);
  assert.ok(cover instanceof Error, 'code that knows nothing about the key still sees an ordinary error');
  assert.equal(cover.fieldKey, 'cloud_cover');
  assert.match(cover.message, /від 0 до 10/);
  assert.equal(key('aircraft_type', ''), 'aircraft_type', 'a missing required value');
  assert.equal(key('airborne_hours', 'abc'), 'airborne_hours');
  assert.equal(key('flight_altitude', '0,3'), 'flight_altitude');
  assert.equal(key('visibility', 'ясно'), 'visibility');
  assert.equal(key('passengers', '1,5'), 'passengers');
  assert.equal(key('fuel_consumption', '-1'), 'fuel_consumption');
  assert.equal(key('instrument_meteorological_conditions', 'можливо'), 'instrument_meteorological_conditions');
  assert.equal(key('aircraft_number', 'x'.repeat(4097)), 'aircraft_number');
  assert.equal(new FieldValueError('x').fieldKey, '');
  assert.equal(new FieldValueError('x', 5).fieldKey, '');

  // Правила між полями вказують на клітинку, де виправлення найпростіше.
  const base = { aircraft_type: 'Ан-26', airborne_hours: '0:22', total_hours: '0:32' };
  const lower = caught(() => rowForWrite(flightFields, { ...base, cloud_base_upper: '300', cloud_base_lower: '1200' }));
  assert.equal(lower.fieldKey, 'cloud_base_lower');
  const names = 'Тестенко, Зразкович, Умовний, Пробенко, Прикладний, Вигаданий, Макетенко, Фіктивний, Шаблонний';
  const tooMany = caught(() => rowForWrite(flightFields, { ...base, crew_ke: 'Тестенко', crew_other: names }));
  assert.equal(tooMany.fieldKey, 'crew_other', 'the last filled crew field');
  const inKe = caught(() => rowForWrite(flightFields, { ...base, crew_ke: names }));
  assert.equal(inKe.fieldKey, 'crew_ke');
  // Помилка першого неправильного поля вказує саме на нього, а не на останнє.
  const first = caught(() => rowForWrite(flightFields, { ...base, cloud_cover: '11', visibility: '-2' }));
  assert.equal(first.fieldKey, 'cloud_cover');
});

test('every column of the record row has a width that suits its content', () => {
  const width = fieldName => fieldColumnWidth(flightField(fieldName));
  for (const item of flightFields) {
    assert.ok(Number.isInteger(fieldColumnWidth(item)) && fieldColumnWidth(item) >= 84, item.key);
  }
  assert.ok(width('crew_other') > width('crew_ke'), 'the list of other surnames is the widest');
  assert.equal(width('crew_ke'), width('crew_bt'));
  assert.ok(width('crew_ke') > width('cloud_cover'), 'a surname needs more room than a digit');
  assert.ok(width('cloud_cover') > width('flight_count'), 'the header «Хмарність, 0–10» keeps its range on one line');
  assert.equal(width('airborne_hours'), width('total_hours'), 'durations are equal');
  assert.ok(width('airborne_hours') <= 100, 'a duration like 12:34 is narrow');
  assert.equal(width('flight_altitude'), width('cloud_base_upper'));
  assert.ok(width('flight_altitude') > width('airborne_hours'), 'a height takes the hint «300 або 0,3 км»');
  assert.ok(width('fuel_consumption') > width('visibility'), 'litres show the kilograms under the field');
  assert.equal(width('day_night'), width('instrument_meteorological_conditions'), 'both are short dropdowns');
  assert.ok(width('aircraft_number') < width('aircraft_type'));
  assert.equal(fieldColumnWidth({ key: 'taken', dataType: 'date' }), 156);
  assert.equal(fieldColumnWidth({ key: 'taken', dataType: 'datetime' }), 216);
  assert.equal(fieldColumnWidth({ key: 'note', dataType: 'text' }), 148);
  assert.equal(fieldColumnWidth(null), 148);
  assert.equal(fieldColumnWidth({ key: 'constructor', dataType: 'text' }), 148, 'a key is never looked up on the prototype');
  // Увесь рядок журналу — приблизно чотири екрани, а не більше.
  const total = flightFields.reduce((sum, item) => sum + fieldColumnWidth(item), 0);
  assert.ok(total > 3000 && total < 4200, String(total));
});

test('row and column counts are declined in Ukrainian', () => {
  const rows = [[0, 'записів'], [1, 'запис'], [2, 'записи'], [4, 'записи'], [5, 'записів'], [11, 'записів'], [12, 'записів'], [14, 'записів'],
    [21, 'запис'], [22, 'записи'], [25, 'записів'], [101, 'запис'], [111, 'записів'], [112, 'записів'], [1002, 'записи']];
  for (const [count, word] of rows) assert.equal(rowCountLabel(count), `${count} ${word}`, String(count));
  const columns = [[1, 'колонка'], [2, 'колонки'], [5, 'колонок'], [12, 'колонок'], [21, 'колонка'], [34, 'колонки'], [35, 'колонок']];
  for (const [count, word] of columns) assert.equal(columnCountLabel(count), `${count} ${word}`, String(count));
  assert.equal(pluralForm(3, 'а', 'б', 'в'), 'б');
  // Не число й від'ємне не дають «NaN записів» чи «-1 запис».
  for (const bad of [undefined, null, 'abc', NaN, -1]) assert.equal(rowCountLabel(bad), '0 записів', String(bad));
});

test('the module card and the table dialog use the declined counts', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(source, /rowCountLabel\(module\.rowCount\)/);
  assert.match(source, /rowCountLabel\(rows\.length\)/);
  assert.match(source, /columnCountLabel\(module\.fields\.length\)/);
  assert.doesNotMatch(source, /\}\s*записів|\}\s*колонок/);
});

test('row deletion is confirmed inside the dialog and never uses browser dialogs', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  for (const text of ['Видалити запис', 'Так, видалити', 'Ні, залишити', 'Запис видалено.', 'Прочитати знову']) {
    assert.ok(source.includes(text), text);
  }
  assert.doesNotMatch(source, /\b(?:confirm|alert|prompt)\s*\(/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
});

test('the row rules can be asked without throwing, for rows that come from a table', () => {
  assert.equal(rowRuleProblem({ aircraft_type: 'Мі-8', cloud_base_lower: 300, cloud_base_upper: 800 }), null);
  assert.equal(rowRuleProblem({ cloud_base_lower: 300 }), null, 'with one cloud base there is nothing to compare');
  const inverted = rowRuleProblem({ cloud_base_lower: 1200, cloud_base_upper: 300 });
  assert.ok(inverted instanceof FieldValueError);
  assert.equal(inverted.fieldKey, 'cloud_base_lower');
  assert.match(inverted.message, /Нижня межа хмар \(НМХ\) не може бути вищою за верхню \(ВМХ\)/);
  const crowded = rowRuleProblem({ crew_ke: 'Тестенко', crew_lsh: 'Зразкович', crew_bt: 'Умовний', crew_other: 'А, Б, В, Г, Д, Е' });
  assert.match(crowded.message, /В екіпажі 9 осіб, а може бути не більше 8/);
  assert.equal(crowded.fieldKey, 'crew_other', 'the cursor goes to the last filled crew field');
  // Форма, як і раніше, відхиляє такий запис, а не лише попереджає.
  const base = { aircraft_type: 'Мі-8', airborne_hours: '0:22', total_hours: '0:32' };
  assert.throws(() => rowForWrite(flightFields, { ...base, cloud_base_upper: '300', cloud_base_lower: '1200' }), FieldValueError);
});

test('creating a module can bring rows from the table of the profile, and only reads that table', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const reader = await readFile(new URL('../src-tauri/src/module_source.rs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/dashboard-module-source-core\.js'/);
  for (const command of ['inspect_linked_module_source', 'pick_module_source', 'read_module_source_sheet']) {
    assert.ok(source.includes(`invoke('${command}'`), `the form calls ${command}`);
    assert.match(lib, new RegExp(`async fn ${command}\\(`), `${command} exists in Rust`);
    assert.match(lib, new RegExp(`\\n\\s+${command},`), `${command} is registered as a command`);
  }
  // Записи йдуть у створення лише коли користувач залишив галочку: без неї виклик такий самий, як був.
  assert.match(source, /\.\.\.\(rows \? \{ rows \} : \{\}\)/);
  assert.match(source, /if \(state\.busy \|\| source\.pending\(\)\) return;/, 'a table that is still being read is never raced');
  assert.match(lib, /rows: Option<Vec<serde_json::Map<String, Value>>>/);
  for (const text of [
    'Дані з вашої таблиці', 'Файл таблиці лише читається й не змінюється.', 'Обрати файл XLSX…', 'Обрати інший файл…',
    'Які стовпці таблиці куди потраплять', 'Перший запис таким, яким його буде збережено', 'Шукаю таблицю профілю…',
    'До профілю не підключено таблицю.', 'У таблиці немає аркуша зі стовпцями, схожими на колонки цього модуля.',
  ]) {
    assert.ok(source.includes(text), text);
  }
  assert.doesNotMatch(source, /\b(?:confirm|alert|prompt)\s*\(/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  // Читач таблиці нічого не пише: ні файлів, ні в таблицю власника.
  // (Тести в кінці файла збирають вигадану книгу в пам'яті, тому перевіряється лише робочий код.)
  const production = reader.slice(0, reader.indexOf('#[cfg(test)]'));
  assert.ok(production.length > 1000, 'the production part of the reader was found');
  assert.doesNotMatch(production, /fs::write|File::create|OpenOptions|write_all|remove_file|rename\(|rust_xlsxwriter|xlsxwriter|umya/);
  assert.match(production, /Xlsx::new|open_workbook_from_rs|calamine/);
  // Шлях файла, який обрав користувач, береться лише з вікна вибору, а не від інтерфейсу.
  const commands = lib.slice(lib.indexOf('struct ModuleSourceSelection'), lib.indexOf('async fn get_dashboard_module_data'));
  assert.doesNotMatch(commands, /\bpath:\s*(?:String|PathBuf)/);
  assert.match(commands, /blocking_pick_file\(\)/);
});

test('the data-from-table block sits in the left column of the create form, above the long column list', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/dashboard-module-catalog.css', import.meta.url), 'utf8');
  const form = source.slice(source.indexOf('function showCreate(item)'), source.indexOf('function sourceBlock(item, onChange)'));
  assert.ok(form.indexOf("class: 'ewmc-create-main'") < form.indexOf('source.node'), 'the block is inside the left column');
  assert.ok(form.indexOf('source.node') < form.indexOf("class: 'ewmc-table-plan'"), 'and comes before the column list');
  assert.match(css, /\.ewmc-create-main\{[^}]*grid-column:1;grid-row:4/);
  assert.match(css, /\.ewmc-table-plan\{grid-column:2;grid-row:4;/);
  assert.match(css, /@media\(max-width:900px\)\{[\s\S]*?\.ewmc-create-main,\.ewmc-table-plan\{grid-column:1;grid-row:auto\}/);
  assert.match(css, /\.ewmc-source\{display:grid;/);
});

test('the weather carry is a visible switch, on by default, and the created rows follow it', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/dashboard-module-catalog.css', import.meta.url), 'utf8');
  assert.match(source, /use: false, carry: true,/, 'on by default, as the owner asked');
  assert.match(source, /importRows\(model\.plan, \{ carryWeather: model\.carry, build: model\.build \}\)/, 'the records sent to Rust are those of the switch (and of the review)');
  assert.match(source, /\(model\.build \?\? plan\)\.carry\.possible \? el\('input', \{ type: 'checkbox'/, 'the switch exists only when there is something to carry');
  assert.ok(source.includes('text: notes.carryLabel') && source.includes('text: notes.carry '), 'the switch says what it does and where to look');
  assert.ok(source.includes('add(notes.carryUnresolved, true)'), 'records left without weather are reported, not hidden');
  assert.match(css, /\.ewmc-source-carry\{display:grid;/);
});

test('the journal columns fall into display groups and every field is in exactly one of them', () => {
  const groups = tableColumnGroups(flightFields);
  assert.deepEqual(groups.map(group => group.title), ['Усі', 'Основне', 'Політ і наліт', 'Метеоумови', 'Екіпаж', 'Паливо й вантаж', 'Оцінки']);
  const named = groups.slice(1).flatMap(group => group.keys);
  assert.equal(named.length, flightFields.length, 'no field is lost or counted twice');
  assert.deepEqual(new Set(named), new Set(flightFields.map(item => item.key)));
  const keysOf = id => groups.find(group => group.id === id).keys;
  assert.deepEqual(keysOf('meteo'), ['cloud_base_upper', 'cloud_base_lower', 'cloud_cover', 'visibility']);
  assert.ok(keysOf('flight').includes('instrument_meteorological_conditions'), 'СМУ is a property of the flight, not of the weather');
  assert.ok(keysOf('crew').includes('crew_ke_callsign'));
  // Модуль без журнальних полів: одна група — фільтр не потрібен.
  assert.deepEqual(tableColumnGroups([field('label', 'Підпис'), field('value', 'Значення', 'real', 'metric', 'sum')]), []);
  assert.deepEqual(tableColumnGroups([]), []);
});

test('a column group keeps the aircraft type and number in view; «all» and unknown groups show everything', () => {
  const meteo = visibleColumnKeys(flightFields, 'meteo');
  assert.deepEqual([...meteo], ['aircraft_type', 'aircraft_number', 'cloud_base_upper', 'cloud_base_lower', 'cloud_cover', 'visibility']);
  assert.equal(visibleColumnKeys(flightFields, 'all').size, flightFields.length);
  assert.equal(visibleColumnKeys(flightFields, 'no-such-group').size, flightFields.length);
  const plain = [field('label', 'Підпис'), field('value', 'Значення', 'real', 'metric', 'sum')];
  assert.equal(visibleColumnKeys(plain, 'meteo').size, 2);
});

test('search finds records by any shown value, all words must match and case does not matter', () => {
  const fieldOf = key => flightFields.find(item => item.key === key);
  const fields = ['aircraft_type', 'aircraft_number', 'crew_ke', 'cargo_kg', 'airborne_hours', 'instrument_meteorological_conditions'].map(fieldOf);
  const row = { aircraft_type: 'Мі-8', aircraft_number: '21', crew_ke: 'Тестенко', cargo_kg: 1500, airborne_hours: 32 / 60, instrument_meteorological_conditions: true };
  assert.equal(rowMatchesQuery(fields, row, ''), true);
  assert.equal(rowMatchesQuery(fields, row, '   '), true);
  assert.equal(rowMatchesQuery(fields, row, 'мі-8'), true);
  assert.equal(rowMatchesQuery(fields, row, 'тестенко 21'), true);
  assert.equal(rowMatchesQuery(fields, row, 'тестенко 22'), false, 'every word has to be found');
  assert.equal(rowMatchesQuery(fields, row, '0:32'), true, 'durations are found as they are shown');
  assert.equal(rowMatchesQuery(fields, row, '1500'), true, 'numbers are found without the thousands space');
  assert.equal(rowMatchesQuery(fields, row, 'так'), true);
  assert.equal(rowMatchesQuery(fields, { aircraft_type: 'Мі-24' }, '—'), false, 'empty cells are not searched');
});

test('table density is comfortable unless compact was chosen', () => {
  assert.equal(normalizeDensity('compact'), 'compact');
  for (const value of ['comfortable', null, undefined, '', 'tiny']) assert.equal(normalizeDensity(value), 'comfortable');
});

test('the module page has search, column groups and density, and editing still shows the whole record in one row', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/dashboard-module-catalog.css', import.meta.url), 'utf8');
  const page = source.slice(source.indexOf('function showModulePage('), source.indexOf('function createFieldControl('));
  for (const text of ['Пошук у записах', 'Групи колонок', 'Щільність таблиці', 'Звичайно', 'Компактно', 'Нічого не знайдено за запитом']) {
    assert.ok(page.includes(text), text);
  }
  assert.match(page, /if \(tableView\.group !== 'all'\) \{\s*tableView\.group = 'all';\s*applyView\(\);/, 'editing shows every column');
  assert.match(page, /search\.disabled = active;/, 'search and groups are locked while a row is edited');
  assert.doesNotMatch(page, /drawer|ewmc-side-panel/, 'no side panel: the record stays one table row');
  assert.match(source, /const DENSITY_KEY = 'easywar\.moduleTable\.density';/);
  assert.match(source, /try \{ return localStorage\.getItem\(DENSITY_KEY\); \} catch/);
  assert.match(css, /\.ewmc-data-scroll\.is-compact /);
  assert.match(css, /\.ewmc-table-toolbar\{display:flex;/);
});

test('the review screen corrects values before the import and never rewrites the raw table', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/dashboard-module-catalog.css', import.meta.url), 'utf8');
  const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const review = source.slice(source.indexOf('function showReview('), source.indexOf('async function reopenFresh('));
  for (const text of ['Перевірка значень з таблиці', '← До створення', 'Застосувати', 'Скасувати виправлення', 'Готово — до створення модуля', 'лише читається']) {
    assert.ok(review.includes(text), text);
  }
  // Виправлення йдуть у Rust окремим параметром, а не як змінені записи чи нові колонки.
  assert.match(source, /\.\.\.\(corrections\.length \? \{ corrections \} : \{\}\)/);
  assert.match(lib, /corrections: Option<Vec<NewImportCorrection>>/);
  assert.match(source, /if \(dialog\.dataset\.view === 'review'\) \{\s*event\.preventDefault\(\);\s*state\.leaveReview\?\.\(\);/, 'Escape returns to the create form');
  // Сторінка модуля показує виправлені клітинки й перелік виправлень із сирим значенням.
  assert.match(source, /class: 'ewmc-corrected'/);
  assert.ok(source.includes('Виправлено під час підтягування з таблиці'));
  assert.doesNotMatch(review, /innerHTML|confirm\(|alert\(/);
  assert.match(css, /\.ewmc-issue\{display:grid;/);
  assert.match(css, /\.ewmc-data-table td\.ewmc-corrected\{/);
});

test('deleting a module asks first and names what disappears with it', () => {
  const ask = rowCount => deleteModulePrompt({ title: 'Лінійний графік', rowCount });
  assert.equal(ask(0), 'Видалити модуль «Лінійний графік» і його порожню таблицю? Дію не можна скасувати.');
  assert.match(ask(1), /таблицю з 1 записом\?/);
  assert.match(ask(3), /таблицю з 3 записами\?/);
  assert.match(ask(11), /таблицю з 11 записами\?/);
  assert.match(ask(21), /таблицю з 21 записом\?/);
  assert.match(deleteModulePrompt({ title: '  ' }), /модуль «без назви» і його порожню таблицю/);
});

test('a module card can be deleted through the local command after an inline confirmation', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  for (const text of ['Видалити модуль', 'Так, видалити', 'Залишити', "invoke('delete_dashboard_module', { moduleId: module.id })", 'deleteModulePrompt(module)']) {
    assert.ok(source.includes(text), text);
  }
  assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/);
  const css = await readFile(new URL('../src/dashboard-module-catalog.css', import.meta.url), 'utf8');
  assert.match(css, /\.ewmc-host \[hidden\]\{display:none!important\}/, 'the hidden confirmation must not show through .ewmc-confirm{display:flex}');
});

test('«Мій дашборд» stays below the dashboard that renders into the same container later', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(source, /dashboard\.lastElementChild !== host\) dashboard\.append\(host\)/);
  assert.match(source, /observer\.observe\(dashboard, \{ childList: true \}\)/);
});
