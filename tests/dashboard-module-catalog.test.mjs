import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FUEL_DENSITY_KG_PER_L,
  branchFromLocation,
  fieldHint,
  fieldInputText,
  fieldInputType,
  fieldKind,
  fieldPlaceholder,
  formatDuration,
  formatFieldValue,
  formatFuel,
  fuelKilograms,
  isConflictError,
  matchesCatalogItem,
  normalizeCatalog,
  normalizeModules,
  parseAltitude,
  parseDuration,
  parseFieldInput,
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
  field('day_night', 'День / ніч', 'text', 'dimension'),
  field('flight_shift_number', 'Номер льотної зміни', 'integer', 'dimension'),
  field('training_program_fuel', 'Програма підготовки (паливо)'),
  field('combat_training_exercise_number', 'Номер вправи за курсом бойової підготовки'),
  field('complex_exercise_number_1', 'Номер вправи у комплексі №1'),
  field('complex_exercise_number_2', 'Номер вправи у комплексі №2'),
  field('flight_count', 'Кількість польотів', 'integer', 'metric', 'sum'),
  field('takeoff_time', 'Час зльоту', 'text', 'dimension'),
  field('landing_time', 'Час посадки', 'text', 'dimension'),
  field('airborne_hours', 'Наліт (повітря), год:хв', 'real', 'metric', 'sum', true),
  field('total_hours', 'Наліт (загальний), год:хв', 'real', 'metric', 'sum', true),
  field('flight_altitude', 'Висота польоту, м', 'real', 'metric', 'average'),
  field('combat_application_grade', 'Оцінка бойового застосування', 'text', 'status'),
  field('flight_grade', 'Оцінка за політ', 'text', 'status'),
  field('cloud_base_upper', 'Верхня межа хмар', 'real', 'metric', 'average'),
  field('cloud_base_lower', 'Нижня межа хмар', 'real', 'metric', 'average'),
  field('cloud_cover', 'Хмарність', 'integer', 'metric', 'average'),
  field('visibility', 'Видимість, км', 'real', 'metric', 'average'),
  field('instrument_meteorological_conditions', 'Політ у СМУ', 'boolean', 'status'),
  field('time_in_clouds', 'Час у хмарах, год:хв', 'real', 'metric', 'sum'),
  field('hood_time', 'Час під шторкою, год:хв', 'real', 'metric', 'sum'),
  field('fuel_consumption', 'Витрата палива, л', 'real', 'metric', 'sum'),
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
  assert.equal(catalog[0].fields[6].label, 'Номер вправи у комплексі №1');
  assert.equal(catalog[0].fields[7].label, 'Номер вправи у комплексі №2');
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
  assert.throws(() => parseFieldInput(flightFields[1], ''), /обов'язковим/);
  assert.throws(() => parseFieldInput(flightFields[18], '5.5'), /ціле число/);
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

test('altitude is read as metres, and kilometres only with an explicit unit', () => {
  assert.equal(parseAltitude('300'), 300);
  assert.equal(parseAltitude('300 м'), 300);
  assert.equal(parseAltitude('300м'), 300);
  assert.equal(parseAltitude('0,3 км'), 300);
  assert.equal(parseAltitude('0.3км'), 300);
  assert.equal(parseAltitude('1,5 КМ'), 1500);
  assert.equal(parseAltitude('1.1 km'), 1100);
  assert.equal(parseAltitude('0,5 м'), 0.5);
  assert.equal(parseAltitude('0'), 0);
  assert.equal(parseAltitude('1500.5'), 1500.5);
  // «0,3» без одиниці — метри чи кілометри? Мовчки вгадувати не можна.
  for (const bad of ['', '0,3', '0.75', 'висота', '300 фут', '-5', '1 000', '3км2', null, undefined, 300]) {
    assert.equal(parseAltitude(bad), null, String(bad));
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
  assert.equal(fieldKind(flightField('flight_altitude')), 'altitude');
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
    ['fuel_consumption', 255], ['fuel_consumption', 255.5], ['visibility', 10], ['cloud_cover', 3],
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
  for (const key of ['airborne_hours', 'total_hours', 'flight_altitude', 'visibility', 'time_in_clouds', 'hood_time', 'fuel_consumption']) {
    const label = flightField(key).label;
    assert.ok(store.includes(`"${label}"`), `${key}: «${label}»`);
  }
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

test('row deletion is confirmed inside the dialog and never uses browser dialogs', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  for (const text of ['Видалити запис', 'Так, видалити', 'Ні, залишити', 'Запис видалено.', 'Прочитати знову']) {
    assert.ok(source.includes(text), text);
  }
  assert.doesNotMatch(source, /\b(?:confirm|alert|prompt)\s*\(/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
});
