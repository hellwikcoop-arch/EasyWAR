import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_IMPORT_ROWS,
  convertCell,
  describePlan,
  enoughMatches,
  findHeaderRow,
  buildImport,
  correctionId,
  correctionOutcome,
  correctionRecords,
  headerCandidates,
  importRows,
  matchHeaders,
  normalizeHeader,
  planImport,
  rankSheets,
  reviewState,
  sheetOptionLabel,
  sourceProfile,
} from '../src/dashboard-module-source-core.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

// Лише синтетичні дані: вигадані прізвища, позивні й числа. Назви колонок — з документації
// («Таблиця власника» в docs/J3_DASHBOARD_MODULE_CONTEXT.md), значень власника тут немає.
const catalog = await rustCatalog();
const flightFields = catalog.find(item => item.id === 'flight-hours').fields;
const fieldOf = key => flightFields.find(item => item.key === key);

const OWNER_HEADERS = [
  'Номер з/п', 'Льотна зміна', 'Тип ПС', 'Номер ПС', 'Запуск проба', 'День/Ніч', 'ПМУ/СМУ', 'кількість польотів',
  'Вправа', 'Вправа', 'Вправа', 'Зліт', 'Посадка', 'Наліт', 'Наліт загальний', 'Наліт у хмарах', 'Наліт під шторкою',
  'Висота', 'Витрата палива', 'Програма по якій виділяють паливо', 'Командир екіпажу', 'Льотчик штурман', 'Бортовий технік',
  'Інший екіпаж', 'Інший екіпаж', 'Інший екіпаж', 'Інший екіпаж', 'Інший екіпаж', 'Інший екіпаж',
  'Пасажири', 'Вантаж', 'Оцінка за Бойове застосування', 'Оцінка за політ',
  'Метеоумови (хмарність нижня межа верхня межа видимість)', 'Заходів РСП', 'Посадок РСП',
];
/** Індекс колонки за заголовком; `nth` — яка за рахунком серед однакових (з 1). */
const col = (header, nth = 1) => {
  let seen = 0;
  for (let index = 0; index < OWNER_HEADERS.length; index += 1) {
    if (OWNER_HEADERS[index] === header && ++seen === nth) return index;
  }
  throw new Error(`немає колонки ${header} №${nth}`);
};
/** Рядок таблиці власника: `values` — клітинки за індексом колонки. */
const ownerCells = values => {
  const cells = Array(OWNER_HEADERS.length).fill(null);
  for (const [index, value] of Object.entries(values)) cells[Number(index)] = value;
  return cells;
};
const baseValues = () => ({
  [col('Тип ПС')]: 'Мі-8', [col('Наліт')]: '0:32', [col('Наліт загальний')]: '0:42',
});
const sheetOf = (rows, extra = {}) => ({
  name: 'Журнал',
  truncated: false,
  rows: rows.map((cells, index) => ({ number: index + 1, cells })),
  ...extra,
});
const journal = (...dataRows) => sheetOf([OWNER_HEADERS, ...dataRows]);

test('header text is compared without case, punctuation, line breaks and Latin look-alikes', () => {
  assert.equal(normalizeHeader('День/Ніч'), 'день ніч');
  assert.equal(normalizeHeader('  Номер\nз/п '), 'номер з п');
  assert.equal(normalizeHeader('№ з/п'), 'номер з п');
  assert.equal(normalizeHeader('Тип ПC'), 'тип пс', 'Latin C inside a Cyrillic word');
  assert.equal(normalizeHeader('LAT'), 'lat', 'a purely Latin word stays Latin');
  assert.equal(normalizeHeader("П'ятниця"), 'пятниця');
  assert.equal(normalizeHeader(5), '');
  assert.equal(normalizeHeader(null), '');
});

test('header candidates go from the exact text to the simplified one', () => {
  assert.deepEqual(headerCandidates('Наліт (загальний), год:хв'), ['наліт загальний год хв', 'наліт загальний', 'наліт год хв', 'наліт']);
  assert.deepEqual(headerCandidates('Хмарність, 0–10'), ['хмарність 0 10', 'хмарність']);
  assert.deepEqual(headerCandidates('Тип ПС'), ['тип пс']);
  assert.deepEqual(headerCandidates('   '), []);
  assert.deepEqual(headerCandidates(12), []);
});

test('every catalog template is read from Rust and its column labels never collide', () => {
  assert.equal(catalog.length, 26);
  assert.equal(flightFields.length, 35);
  assert.deepEqual(flightFields.filter(item => item.required).map(item => item.key), ['aircraft_type', 'airborne_hours', 'total_hours']);
  for (const template of catalog) {
    const profile = sourceProfile(template.fields);
    assert.deepEqual(profile.collisions, [], `${template.id}: two fields share a column name`);
  }
});

test('a table exported with the module column labels maps back onto every field of every template', () => {
  for (const template of catalog) {
    const profile = sourceProfile(template.fields);
    const matched = matchHeaders(profile, template.fields.map(item => item.label));
    assert.deepEqual([...matched.matchedKeys].sort(), template.fields.map(item => item.key).sort(), template.id);
    assert.deepEqual(matched.extras, [], template.id);
  }
});

test('the owner column names map onto the flight journal fields, the repeated ones in order', () => {
  const matched = matchHeaders(sourceProfile(flightFields), OWNER_HEADERS);
  const at = key => matched.mapped.get(key);
  assert.equal(at('list_number')[0], col('Номер з/п'));
  assert.equal(at('flight_shift_number')[0], col('Льотна зміна'));
  assert.equal(at('aircraft_type')[0], col('Тип ПС'));
  assert.equal(at('aircraft_number')[0], col('Номер ПС'));
  assert.equal(at('engine_test_time')[0], col('Запуск проба'));
  assert.equal(at('day_night')[0], col('День/Ніч'));
  assert.equal(at('instrument_meteorological_conditions')[0], col('ПМУ/СМУ'));
  assert.equal(at('flight_count')[0], col('кількість польотів'));
  assert.deepEqual(
    ['combat_training_exercise_number', 'complex_exercise_number_1', 'complex_exercise_number_2'].map(key => at(key)[0]),
    [col('Вправа', 1), col('Вправа', 2), col('Вправа', 3)],
    'Вправа ×3 → КБП, №1, №2',
  );
  assert.equal(at('takeoff_time')[0], col('Зліт'));
  assert.equal(at('landing_time')[0], col('Посадка'));
  assert.equal(at('airborne_hours')[0], col('Наліт'));
  assert.equal(at('total_hours')[0], col('Наліт загальний'));
  assert.equal(at('time_in_clouds')[0], col('Наліт у хмарах'));
  assert.equal(at('hood_time')[0], col('Наліт під шторкою'));
  assert.equal(at('flight_altitude')[0], col('Висота'));
  assert.equal(at('fuel_consumption')[0], col('Витрата палива'));
  assert.equal(at('training_program_fuel')[0], col('Програма по якій виділяють паливо'));
  assert.equal(at('crew_ke')[0], col('Командир екіпажу'));
  assert.equal(at('crew_lsh')[0], col('Льотчик штурман'));
  assert.equal(at('crew_bt')[0], col('Бортовий технік'));
  assert.deepEqual(at('crew_other'), [1, 2, 3, 4, 5, 6].map(nth => col('Інший екіпаж', nth)), 'Інший екіпаж ×6 → одне поле');
  assert.equal(at('passengers')[0], col('Пасажири'));
  assert.equal(at('cargo_kg')[0], col('Вантаж'));
  assert.equal(at('combat_application_grade')[0], col('Оцінка за Бойове застосування'));
  assert.equal(at('flight_grade')[0], col('Оцінка за політ'));
  assert.equal(at('rsp_approaches')[0], col('Заходів РСП'));
  assert.equal(at('rsp_landings')[0], col('Посадок РСП'));
  // Метеоумови — одна клітинка на чотири поля.
  assert.equal(matched.weather.index, col('Метеоумови (хмарність нижня межа верхня межа видимість)'));
  assert.deepEqual(matched.weather.keys, ['cloud_cover', 'cloud_base_lower', 'cloud_base_upper', 'visibility']);
  assert.equal(matched.matchedKeys.size, 34);
  assert.equal(matched.matchedKeys.has('crew_ke_callsign'), false, 'позивного в таблиці власника немає');
  assert.deepEqual(matched.extras, []);
});

test('extra, duplicate and surplus columns are reported and never mapped twice', () => {
  const matched = matchHeaders(sourceProfile(flightFields), [
    'Тип ПС', 'Наліт', 'Наліт', 'Вправа', 'Вправа', 'Вправа', 'Вправа', 'Примітки', 'Метеоумови', 'Погода', 42, null,
  ]);
  assert.deepEqual(matched.mapped.get('airborne_hours'), [1], 'only the first «Наліт» is used');
  assert.deepEqual(matched.extras.map(item => [item.header, item.reason]), [
    ['Наліт', 'дубль'], ['Вправа', 'зайвий'], ['Примітки', ''], ['Погода', 'дубль'],
  ]);
});

test('separate weather columns win over the combined cell and the combined column is then unused', () => {
  const separate = matchHeaders(sourceProfile(flightFields), ['Тип ПС', 'Хмарність', 'НМХ', 'ВМХ', 'Видимість', 'Метеоумови']);
  assert.equal(separate.weather, null);
  assert.deepEqual(separate.extras.map(item => item.reason), ['поля вже є окремими колонками']);
  const partial = matchHeaders(sourceProfile(flightFields), ['Тип ПС', 'Видимість', 'Метеоумови']);
  assert.deepEqual(partial.weather.keys, ['cloud_cover', 'cloud_base_lower', 'cloud_base_upper']);
  assert.deepEqual([...partial.mapped.keys()].sort(), ['aircraft_type', 'visibility']);
});

test('the header row is the best match among the first rows and title rows are ignored', () => {
  const profile = sourceProfile(flightFields);
  const rows = [
    { number: 3, cells: ['Журнал польотів, умовний підрозділ'] },
    { number: 4, cells: ['Тип ПС', 'Наліт'] },
    { number: 5, cells: OWNER_HEADERS },
    { number: 6, cells: Array.from({ length: 36 }, (_, index) => index + 1) },
  ];
  const found = findHeaderRow(profile, rows);
  assert.equal(found.row.number, 5);
  assert.equal(found.index, 2);
  assert.equal(findHeaderRow(profile, [{ number: 1, cells: ['Тип ПС'] }, { number: 2, cells: [1, 2, 3] }]), null, 'one match is not a header');
  assert.equal(findHeaderRow(profile, []), null);
});

test('sheets are ranked by matches; only a sheet with all required columns is confident', () => {
  const sample = cells => [{ number: 1, cells }];
  const workbook = {
    sheets: [
      { name: 'Довідник', rowCount: 3, sample: sample(['Код', 'Назва']) },
      { name: 'Короткий', rowCount: 4, sample: sample(['Тип ПС', 'Наліт', 'Наліт загальний', 'Пасажири']) },
      { name: 'Журнал', rowCount: 130, sample: sample(OWNER_HEADERS) },
      { name: 'Без обов\'язкових', rowCount: 9, sample: sample(['Тип ПС', 'Номер ПС', 'День/Ніч', 'Зліт', 'Посадка', 'Пасажири']) },
    ],
  };
  const ranked = rankSheets(flightFields, workbook);
  assert.deepEqual(ranked.map(item => item.name), ['Журнал', 'Без обов\'язкових', 'Короткий', 'Довідник']);
  assert.equal(ranked[0].matched, 34);
  assert.equal(ranked[0].confident, true);
  assert.equal(ranked[0].dataRows, 129);
  assert.equal(ranked[0].headerNumber, 1);
  assert.equal(ranked[1].confident, false);
  assert.deepEqual(ranked[1].missingRequired, ['Наліт (повітря), год:хв', 'Наліт (загальний), год:хв']);
  assert.equal(ranked[2].confident, false, '4 matches are fewer than the 5 needed');
  assert.equal(ranked[3].matched, 0);
  assert.equal(ranked[3].headerNumber, null);
  assert.equal(enoughMatches(35, 5), true);
  assert.equal(enoughMatches(35, 4), false);
  assert.equal(enoughMatches(2, 2), true);
  assert.equal(enoughMatches(2, 1), false);
  assert.equal(enoughMatches(4, 3), true);
  assert.equal(enoughMatches(4, 2), false);
  assert.equal(rankSheets(flightFields, null).length, 0);
});

test('sheet option label shows the match and the number of records', () => {
  assert.equal(
    sheetOptionLabel({ name: 'Журнал', matched: 34, total: 35, dataRows: 129 }),
    'Журнал · знайдено стовпців: 34 з 35 · 129 рядків',
  );
  assert.equal(sheetOptionLabel({ name: 'Малий', matched: 2, total: 4, dataRows: 1 }), 'Малий · знайдено стовпців: 2 з 4 · 1 рядок');
});

// ---------------------------------------------------------------------------------------------
// Значення клітинок

const valueOf = (key, cell) => convertCell(fieldOf(key), cell);

test('durations are read only as hours:minutes and a bare number is never guessed', () => {
  assert.deepEqual(valueOf('airborne_hours', '0:32'), { value: 32 / 60 });
  assert.deepEqual(valueOf('airborne_hours', '00:32'), { value: 32 / 60 }, 'a time-of-day formatted cell');
  assert.deepEqual(valueOf('total_hours', '36:00'), { value: 36 });
  assert.deepEqual(valueOf('hood_time', '0:00'), { value: 0 });
  for (const cell of [0.5, 1.3, '0.32', '1,30', '1:5', '0:61', 'пів години']) {
    assert.match(valueOf('airborne_hours', cell).problem, /год:хв/u, String(cell));
  }
  assert.deepEqual(valueOf('airborne_hours', null), { empty: true });
  assert.deepEqual(valueOf('airborne_hours', '   '), { empty: true });
});

test('heights take metres, kilometres with a unit and the parenthesised metres', () => {
  const altitude = cell => valueOf('flight_altitude', cell).value;
  assert.equal(altitude(300), 300);
  assert.equal(altitude('300'), 300);
  assert.equal(altitude('300м'), 300);
  assert.equal(altitude('300 м'), 300);
  assert.equal(altitude('0,3 км'), 300);
  assert.equal(altitude('1.5km'), 1500);
  assert.equal(altitude('0,3км (300м)'), 300);
  assert.equal(altitude('0.3м(300м)'), 300, 'the slip «0.3 м» is dropped in favour of the real metres');
  assert.equal(altitude('1200 м (1,2 км)'), 1200);
  for (const cell of ['0,3', 0.3, 'низько', '-5', -5]) {
    assert.ok(valueOf('flight_altitude', cell).problem, String(cell));
  }
  assert.equal(valueOf('cloud_base_upper', '1,2 км').value, 1200);
});

test('fuel is litres: a number, a unit, litres with kilograms in brackets or two numbers with the density ratio', () => {
  const fuel = cell => valueOf('fuel_consumption', cell);
  assert.equal(fuel(310).value, 310);
  assert.equal(fuel('310').value, 310);
  assert.equal(fuel('310,5').value, 310.5);
  assert.equal(fuel('310 л').value, 310);
  assert.equal(fuel('310л (248кг)').value, 310);
  assert.equal(fuel('248 кг / 310 л').value, 310);
  assert.equal(fuel('310 літрів').value, 310);
  assert.equal(fuel('310 (248)').value, 310, 'the larger of two numbers with the density ratio');
  assert.equal(fuel('248/310').value, 310);
  assert.equal(fuel('310 (248 кг)').value, 310);
  assert.match(fuel('248 кг').problem, /лише кілограми/u);
  assert.match(fuel('310 / 100').problem, /літри/u, 'ratio 0.32 is not a density');
  assert.match(fuel('310 л / 300 л').problem, /кілька/u);
  assert.match(fuel('багато').problem, /літри/u);
  assert.ok(fuel(-1).problem);
});

test('visibility is kilometres, metres are converted', () => {
  assert.equal(valueOf('visibility', 10).value, 10);
  assert.equal(valueOf('visibility', '10').value, 10);
  assert.equal(valueOf('visibility', '10 км').value, 10);
  assert.equal(valueOf('visibility', '0,5').value, 0.5);
  assert.equal(valueOf('visibility', '5000 м').value, 5);
  assert.equal(valueOf('visibility', '800м').value, 0.8);
  assert.ok(valueOf('visibility', '10 км 20').problem);
  assert.ok(valueOf('visibility', -1).problem);
});

test('take-off and landing are stored as HH:MM text the time input can show', () => {
  const time = cell => convertCell(fieldOf('takeoff_time'), cell);
  assert.deepEqual(time('10:15'), { value: '10:15' });
  assert.deepEqual(time('9:05'), { value: '09:05' });
  assert.deepEqual(time('10:15:40'), { value: '10:15' });
  assert.deepEqual(time('1015'), { value: '10:15' });
  assert.deepEqual(time('925'), { value: '09:25' });
  assert.deepEqual(time(1015), { value: '10:15' });
  assert.deepEqual(time('10.15'), { value: '10:15' });
  assert.deepEqual(time('2026-01-31 14:25'), { value: '14:25' });
  for (const cell of ['25:00', '10:75', '2599', 5, 0.43, 'ранок', true]) {
    assert.match(time(cell).problem, /час доби/u, String(cell));
  }
  assert.deepEqual(convertCell(fieldOf('landing_time'), '23:59'), { value: '23:59' });
});

test('СМУ is a yes, ПМУ is a no and a dash leaves the field empty', () => {
  const flag = cell => convertCell(fieldOf('instrument_meteorological_conditions'), cell);
  for (const cell of ['Так', 'так', 'СМУ', 'смУ', '+', 'Yes', 1, true]) assert.deepEqual(flag(cell), { value: true }, String(cell));
  for (const cell of ['Ні', 'ПМУ', 'no', '0', 0, false]) assert.deepEqual(flag(cell), { value: false }, String(cell));
  for (const cell of ['-', '—', null, '']) assert.deepEqual(flag(cell), { empty: true }, String(cell));
  for (const cell of ['можливо', 2, 0.5]) assert.match(flag(cell).problem, /Так.*Ні/u, String(cell));
});

test('integers keep the form limits: cloud cover is 0–10 and counts are not negative', () => {
  assert.deepEqual(valueOf('cloud_cover', 5), { value: 5 });
  assert.deepEqual(valueOf('cloud_cover', '10'), { value: 10 });
  assert.match(valueOf('cloud_cover', 11).problem, /від 0 до 10/u);
  assert.match(valueOf('passengers', -2).problem, /від'ємним/u);
  assert.deepEqual(valueOf('flight_shift_number', '2,0'), { value: 2 });
  assert.match(valueOf('flight_shift_number', 2.5).problem, /не ціле/u);
  assert.match(valueOf('flight_shift_number', 'друга').problem, /ціле число/u);
  assert.match(valueOf('flight_shift_number', true).problem, /ціле число/u);
  assert.deepEqual(valueOf('list_number', 7), { value: 7 });
});

test('cargo is kilograms and text fields keep numbers as text, booleans as «Так»/«Ні»', () => {
  assert.equal(valueOf('cargo_kg', '150 кг').value, 150);
  assert.equal(valueOf('cargo_kg', 150).value, 150);
  assert.ok(valueOf('cargo_kg', '2 тонни').problem);
  assert.deepEqual(valueOf('aircraft_number', 24), { value: '24' });
  assert.deepEqual(valueOf('crew_ke_callsign', 12345), { value: '12345' });
  assert.deepEqual(valueOf('crew_ke_callsign', '00123'), { value: '00123' });
  assert.deepEqual(valueOf('day_night', '  Ніч '), { value: 'Ніч' });
  assert.deepEqual(valueOf('combat_application_grade', 5), { value: '5' });
  assert.deepEqual(valueOf('flight_grade', true), { value: 'Так' });
  assert.match(valueOf('flight_grade', 'я'.repeat(4097)).problem, /4096/u);
});

test('dates are ISO, datetimes are the value a datetime-local input shows', () => {
  const calendar = catalog.find(item => item.id === 'calendar').fields.find(item => item.key === 'date');
  const activity = catalog.find(item => item.id === 'activity').fields.find(item => item.key === 'occurred_at');
  assert.deepEqual(convertCell(calendar, '2026-01-31'), { value: '2026-01-31' });
  assert.deepEqual(convertCell(calendar, '2026-01-31 14:25'), { value: '2026-01-31' });
  assert.deepEqual(convertCell(calendar, '31.01.2026'), { value: '2026-01-31' });
  assert.deepEqual(convertCell(calendar, '1/2/2026'), { value: '2026-02-01' });
  for (const cell of ['2026-02-30', '31.13.2026', 'вчора', 46000]) assert.match(convertCell(calendar, cell).problem, /дата/u, String(cell));
  assert.deepEqual(convertCell(activity, '2026-01-31 14:25'), { value: '2026-01-31T14:25' });
  assert.deepEqual(convertCell(activity, '2026-01-31'), { value: '2026-01-31T00:00' });
  assert.deepEqual(convertCell(activity, '31.01.2026 9:05'), { value: '2026-01-31T09:05' });
  assert.match(convertCell(activity, 'сьогодні').problem, /дату й час|дата й час/u);
});

// ---------------------------------------------------------------------------------------------
// План підтягування

test('a journal row from the owner table becomes one module record', () => {
  const plan = planImport(flightFields, journal(ownerCells({
    [col('Номер з/п')]: 1, [col('Льотна зміна')]: 2, [col('Тип ПС')]: 'Мі-8', [col('Номер ПС')]: 24,
    [col('Запуск проба')]: '0:10', [col('День/Ніч')]: 'День', [col('ПМУ/СМУ')]: 'Ні', [col('кількість польотів')]: 1,
    [col('Вправа', 1)]: '5', [col('Вправа', 2)]: '12', [col('Вправа', 3)]: '3',
    [col('Зліт')]: '10:15', [col('Посадка')]: '10:52', [col('Наліт')]: '0:32', [col('Наліт загальний')]: '0:42',
    [col('Наліт у хмарах')]: '0:05', [col('Наліт під шторкою')]: '0:00', [col('Висота')]: '300м',
    [col('Витрата палива')]: '310л (248кг)', [col('Програма по якій виділяють паливо')]: 'Програма-1',
    [col('Командир екіпажу')]: 'Тестенко', [col('Льотчик штурман')]: 'Зразкович', [col('Бортовий технік')]: null,
    [col('Інший екіпаж', 1)]: 'Прикладний', [col('Інший екіпаж', 2)]: 'інструктор Вигаданий',
    [col('Пасажири')]: 2, [col('Вантаж')]: 150, [col('Оцінка за Бойове застосування')]: 5, [col('Оцінка за політ')]: 4,
    [col('Метеоумови (хмарність нижня межа верхня межа видимість)')]: '5/300/1000/10',
    [col('Заходів РСП')]: 1, [col('Посадок РСП')]: 1,
  })));
  assert.equal(plan.blocked, '');
  assert.equal(plan.headerNumber, 1);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rowNumbers, [2]);
  assert.deepEqual(plan.rows[0], {
    list_number: 1, aircraft_type: 'Мі-8', aircraft_number: '24', day_night: 'День', flight_shift_number: 2,
    training_program_fuel: 'Програма-1', combat_training_exercise_number: '5', complex_exercise_number_1: '12',
    complex_exercise_number_2: '3', flight_count: 1, engine_test_time: 10 / 60, takeoff_time: '10:15', landing_time: '10:52',
    airborne_hours: 32 / 60, total_hours: 42 / 60, flight_altitude: 300, combat_application_grade: '5', flight_grade: '4',
    cloud_base_upper: 1000, cloud_base_lower: 300, cloud_cover: 5, visibility: 10, instrument_meteorological_conditions: false,
    time_in_clouds: 5 / 60, hood_time: 0, fuel_consumption: 310, crew_ke: 'Тестенко', crew_lsh: 'Зразкович',
    crew_other: 'Прикладний, інструктор Вигаданий', passengers: 2, cargo_kg: 150, rsp_approaches: 1, rsp_landings: 1,
  });
  assert.equal('crew_bt' in plan.rows[0], false, 'an empty cell is not written');
  assert.equal('crew_ke_callsign' in plan.rows[0], false);
  assert.deepEqual(plan.missing.map(item => item.label), ['Позивний командира екіпажу']);
  assert.equal(plan.matched, 34);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.rules.count, 0);
  assert.equal(plan.firstRecord.find(item => item.label === 'Витрата палива, л').text, '310 л (248 кг)');
  assert.equal(plan.firstRecord.find(item => item.label === 'Наліт (повітря), год:хв').text, '0:32');
  assert.equal(plan.firstRecord.find(item => item.label === 'Політ у СМУ').text, 'Ні');
});

test('rows come in the source order with their sheet row numbers', () => {
  const plan = planImport(flightFields, sheetOf([
    ['Журнал'],
    OWNER_HEADERS,
    ownerCells({ ...baseValues(), [col('Номер ПС')]: 1 }),
    ownerCells({ ...baseValues(), [col('Номер ПС')]: 2 }),
    ownerCells({ ...baseValues(), [col('Номер ПС')]: 3 }),
  ]));
  assert.equal(plan.headerNumber, 2);
  assert.deepEqual(plan.rows.map(row => row.aircraft_number), ['1', '2', '3']);
  assert.deepEqual(plan.rowNumbers, [3, 4, 5]);
});

test('totals rows, rows without a required value and rows without any known data are skipped with a reason', () => {
  const plan = planImport(flightFields, journal(
    ownerCells(baseValues()),
    ownerCells({ [col('Тип ПС')]: 'Разом', [col('Наліт')]: '9:00', [col('Наліт загальний')]: '10:00' }),
    ownerCells({ ...baseValues(), [col('Наліт загальний')]: null }),
    ownerCells({ ...baseValues(), [col('Тип ПС')]: null }),
    ownerCells({ ...baseValues(), [col('Наліт')]: 0.53 }),
    ownerCells({}),
    ownerCells({ [col('Пасажири')]: 2 }),
  ));
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.skippedCount, 6);
  const reasons = Object.fromEntries(plan.skipped.map(item => [item.reason, [item.count, item.firstNumber]]));
  assert.deepEqual(reasons, {
    'підсумковий рядок': [1, 3],
    'немає значення в «Наліт (загальний), год:хв»': [1, 4],
    'немає значення в «Тип ПС»': [2, 5],
    '«Наліт (повітря), год:хв»: не вдалося розібрати': [1, 6],
    'немає даних у знайдених стовпцях': [1, 7],
  });
  assert.equal(plan.skipped[0].reason, 'немає значення в «Тип ПС»', 'the most frequent reason comes first');
});

test('an unreadable optional cell is reported once per field and leaves the field empty', () => {
  const plan = planImport(flightFields, journal(
    ownerCells({ ...baseValues(), [col('Висота')]: '0,3' }),
    ownerCells({ ...baseValues(), [col('Висота')]: 'низько', [col('Зліт')]: '25:00' }),
    ownerCells({ ...baseValues(), [col('Висота')]: '300', [col('Витрата палива')]: '248 кг' }),
  ));
  assert.equal(plan.rows.length, 3);
  assert.equal('flight_altitude' in plan.rows[0], false);
  assert.equal('flight_altitude' in plan.rows[1], false);
  assert.equal(plan.rows[2].flight_altitude, 300);
  const byKey = Object.fromEntries(plan.warnings.map(item => [item.key, item]));
  assert.equal(byKey.flight_altitude.count, 2);
  assert.equal(byKey.flight_altitude.firstNumber, 2);
  assert.equal(byKey.flight_altitude.sample, '0,3');
  assert.equal(byKey.takeoff_time.count, 1);
  assert.equal(byKey.fuel_consumption.count, 1);
  assert.deepEqual(plan.warnings.map(item => item.key), ['takeoff_time', 'flight_altitude', 'fuel_consumption'], 'in the order of the module columns');
});

test('the weather cell needs exactly four numbers and a separate column wins over it', () => {
  const weather = col('Метеоумови (хмарність нижня межа верхня межа видимість)');
  const plan = planImport(flightFields, journal(
    ownerCells({ ...baseValues(), [weather]: '5 300 1000 10' }),
    ownerCells({ ...baseValues(), [weather]: '7/0,3 км/1,5 км/5000 м' }),
    ownerCells({ ...baseValues(), [weather]: '5/300/1000' }),
    ownerCells({ ...baseValues(), [weather]: '11/300/1000/10' }),
    ownerCells({ ...baseValues(), [weather]: '5/1000/300/10' }),
    ownerCells({ ...baseValues(), [weather]: null }),
  ));
  assert.equal(plan.rows.length, 6);
  const weatherOf = row => [row.cloud_cover, row.cloud_base_lower, row.cloud_base_upper, row.visibility];
  assert.deepEqual(weatherOf(plan.rows[0]), [5, 300, 1000, 10]);
  assert.deepEqual(weatherOf(plan.rows[1]), [7, 300, 1500, 5]);
  assert.deepEqual(weatherOf(plan.rows[2]), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(weatherOf(plan.rows[3]), [undefined, 300, 1000, 10], 'only the cloud cover is out of range');
  assert.deepEqual(weatherOf(plan.rows[5]), [undefined, undefined, undefined, undefined]);
  const byKey = Object.fromEntries(plan.warnings.map(item => [item.key, item]));
  assert.match(byKey.weather.reason, /чотири числа/u);
  assert.equal(byKey.weather.label, 'Метеоумови');
  assert.equal(byKey.weather.count, 1);
  assert.match(byKey.cloud_cover.reason, /від 0 до 10/u);
  assert.equal(plan.rules.count, 1, 'the lower cloud base above the upper one is flagged');
  assert.equal(plan.rules.firstNumber, 6);
  assert.match(plan.rules.message, /НМХ/u);

  const split = planImport(flightFields, sheetOf([
    ['Тип ПС', 'Наліт', 'Наліт загальний', 'Видимість', 'Метеоумови'],
    ['Мі-8', '0:30', '0:40', 8, '5/300/1000/10'],
  ]));
  assert.deepEqual(
    [split.rows[0].visibility, split.rows[0].cloud_cover, split.rows[0].cloud_base_lower, split.rows[0].cloud_base_upper],
    [8, 5, 300, 1000],
    'the visibility column is kept, the other three come from the combined cell',
  );
});

test('more than eight crew members are kept and flagged, surnames of the six columns are joined', () => {
  const names = ['Тестенко', 'Зразкович', 'Прикладний', 'Вигаданий', 'Макетенко', 'Шаблонний', 'Умовний', 'Фіктивний', 'Пробенко'];
  const plan = planImport(flightFields, journal(ownerCells({
    ...baseValues(),
    [col('Командир екіпажу')]: names[0], [col('Льотчик штурман')]: names[1], [col('Бортовий технік')]: names[2],
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(nth => [col('Інший екіпаж', nth), names[2 + nth]])),
  })));
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].crew_other, 'Вигаданий, Макетенко, Шаблонний, Умовний, Фіктивний, Пробенко');
  assert.equal(plan.rules.count, 1);
  assert.match(plan.rules.message, /9 осіб/u);
});

test('remarks about the form rules are grouped by kind and use the genitive after «до»', () => {
  const crowded = ownerCells({
    ...baseValues(),
    [col('Командир екіпажу')]: 'Тестенко', [col('Льотчик штурман')]: 'Зразкович', [col('Бортовий технік')]: 'Прикладний',
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(nth => [col('Інший екіпаж', nth), `Вигаданий ${nth}`])),
  });
  const inverted = ownerCells({ ...baseValues(), [col('Метеоумови (хмарність нижня межа верхня межа видимість)')]: '5/1000/300/10' });
  const plan = planImport(flightFields, journal(crowded, inverted, crowded, ownerCells(baseValues())));
  assert.equal(plan.rows.length, 4, 'the rows are kept, they only get a remark');
  assert.equal(plan.rules.count, 3);
  assert.deepEqual(plan.rules.items.map(item => [item.count, item.firstNumber]), [[2, 2], [1, 3]]);
  assert.deepEqual(describePlan(plan).warnings, [
    'Зауваження до 2 рядків (перший — рядок 2): В екіпажі 9 осіб, а може бути не більше 8.',
    'Зауваження до 1 рядка (рядок 3): Нижня межа хмар (НМХ) не може бути вищою за верхню (ВМХ).',
  ]);
  const many = planImport(flightFields, journal(...Array.from({ length: 21 }, () => crowded)));
  assert.match(describePlan(many).warnings[0], /^Зауваження до 21 рядка \(перший — рядок 2\): /u);
  const five = planImport(flightFields, journal(...Array.from({ length: 5 }, () => crowded)));
  assert.match(describePlan(five).warnings[0], /^Зауваження до 5 рядків \(перший — рядок 2\): /u);
  const clean = planImport(flightFields, journal(ownerCells(baseValues())));
  assert.deepEqual(clean.rules.items, []);
  assert.deepEqual(describePlan(clean).warnings, []);
});

test('a table without a required column imports nothing and says which one is missing', () => {
  const plan = planImport(flightFields, sheetOf([
    ['Тип ПС', 'Наліт', 'Пасажири'],
    ['Мі-8', '0:30', 2],
  ]));
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.blocked, "У таблиці немає обов'язкових стовпців: Наліт (загальний), год:хв.");
  assert.equal(plan.matched, 3);
  assert.deepEqual(plan.found.map(item => item.key), ['aircraft_type', 'airborne_hours', 'passengers']);
  const notes = describePlan(plan);
  assert.equal(notes.summary, 'Записів для підтягування немає.');
  assert.equal(notes.blocked, plan.blocked);
});

test('a sheet without a recognisable header row is blocked', () => {
  const plan = planImport(flightFields, sheetOf([['Список'], ['Іванов', 'Петров']]));
  assert.equal(plan.rows.length, 0);
  assert.match(plan.blocked, /не знайдено рядка заголовків/u);
  assert.equal(plan.headerNumber, null);
  assert.equal(plan.matched, 0);
  assert.equal(planImport(flightFields, null).rows.length, 0);
  assert.equal(planImport([], sheetOf([OWNER_HEADERS])).rows.length, 0);
});

test('at most 10 000 records are taken and the cut is reported', () => {
  const many = Array.from({ length: MAX_IMPORT_ROWS + 5 }, () => ownerCells(baseValues()));
  const cut = planImport(flightFields, journal(...many));
  assert.equal(cut.rows.length, MAX_IMPORT_ROWS);
  assert.equal(cut.truncated, true);
  assert.match(describePlan(cut).truncated, /10000/u);
  const exact = planImport(flightFields, journal(...many.slice(0, MAX_IMPORT_ROWS)));
  assert.equal(exact.rows.length, MAX_IMPORT_ROWS);
  assert.equal(exact.truncated, false);
  const sourceCut = planImport(flightFields, { ...journal(ownerCells(baseValues())), truncated: true });
  assert.equal(sourceCut.truncated, true, 'the reader stopped before the end of the sheet');
});

test('other templates import by their own column labels', () => {
  const donut = catalog.find(item => item.id === 'donut').fields;
  const plan = planImport(donut, sheetOf([
    ['Звіт'],
    ['Категорія', 'Значення', 'Примітки'],
    ['Тестова', 12.5, 'x'],
    ['Зразкова', '7,5', null],
    [null, 3, null],
    ['Підсумок', 23, null],
  ]));
  assert.deepEqual(plan.rows, [{ category: 'Тестова', value: 12.5 }, { category: 'Зразкова', value: 7.5 }]);
  assert.deepEqual(plan.extra, ['Примітки']);
  assert.equal(plan.skippedCount, 2);
  assert.deepEqual(plan.skipped.map(item => item.reason).sort(), ['немає значення в «Категорія»', 'підсумковий рядок']);

  const calendar = catalog.find(item => item.id === 'calendar').fields;
  const days = planImport(calendar, sheetOf([['Дата', 'Значення'], ['2026-03-01', 4], ['02.03.2026', 5], ['не дата', 6]]));
  assert.deepEqual(days.rows, [{ date: '2026-03-01', value: 4 }, { date: '2026-03-02', value: 5 }]);
  assert.equal(days.skippedCount, 1);

  const progress = catalog.find(item => item.id === 'progress-bars').fields;
  const goals = planImport(progress, sheetOf([['Показник', 'Факт', 'План'], ['Тест', 3, 10]]));
  assert.deepEqual(goals.rows, [{ label: 'Тест', current_value: 3, target_value: 10 }]);
});

test('every record the plan produces is a value the Rust store accepts', () => {
  // Правила dashboard_modules.rs::validate_value: рядки, цілі, скінченні числа, так/ні; обов'язкові поля є.
  const accepted = (field, value) => {
    if (value == null) return !field.required;
    switch (field.dataType) {
      case 'text': case 'date': case 'datetime': return typeof value === 'string' && value.length <= 4096 && (!field.required || value.trim() !== '');
      case 'integer': return Number.isSafeInteger(value);
      case 'real': return Number.isFinite(value);
      case 'boolean': return typeof value === 'boolean';
      default: return false;
    }
  };
  const messy = [
    ownerCells({ ...baseValues(), [col('Номер ПС')]: 24, [col('Висота')]: '0.3м(300м)', [col('Витрата палива')]: '310 (248)' }),
    ownerCells({ ...baseValues(), [col('Зліт')]: 1015, [col('Пасажири')]: '3', [col('Вантаж')]: '150 кг', [col('ПМУ/СМУ')]: 'СМУ' }),
    ownerCells({ ...baseValues(), [col('Льотна зміна')]: '1', [col('кількість польотів')]: 2.5, [col('Оцінка за політ')]: 4 }),
    ownerCells({ ...baseValues(), [col('Льотна зміна')]: 1, [col('Метеоумови (хмарність нижня межа верхня межа видимість)')]: '3 200 800 6' }),
    ownerCells({ ...baseValues(), [col('Льотна зміна')]: 1 }),
  ];
  const plan = planImport(flightFields, journal(...messy));
  assert.equal(plan.rows.length, 5);
  assert.equal(plan.carry.possible, 1, 'the last record takes the weather of the one before it');
  for (const row of [...plan.rows, ...importRows(plan)]) {
    for (const key of Object.keys(row)) assert.ok(fieldOf(key), `unknown field ${key}`);
    for (const field of flightFields) assert.ok(accepted(field, row[field.key]), `${field.key}=${JSON.stringify(row[field.key])}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Метеоумови, протягнуті на записи тієї ж льотної зміни

const WEATHER = col('Метеоумови (хмарність нижня межа верхня межа видимість)');
const SHIFT = col('Льотна зміна');
/** Політ льотної зміни `shift` з метеоумовами однією клітинкою (або без них). */
const flightOf = (shift, weather, extra = {}) => ownerCells({ ...baseValues(), [SHIFT]: shift, [WEATHER]: weather, ...extra });
const weatherOf = row => [row.cloud_cover, row.cloud_base_lower, row.cloud_base_upper, row.visibility];
const NO_WEATHER = [undefined, undefined, undefined, undefined];
const SHIFT_JOURNAL = () => journal(
  flightOf(1, '5/300/1000/10'), // рядок 2: погода вказана
  flightOf(1, null), // рядок 3: та сама зміна — бере погоду з рядка 2
  flightOf(1, '7/200/800/4'), // рядок 4: нове значення перекриває старе
  flightOf(1, null), // рядок 5: бере погоду з рядка 4
  flightOf(2, null), // рядок 6: нова зміна без погоди — протягувати нема звідки
  flightOf(2, '3 150 600 6'), // рядок 7
  flightOf(2, null), // рядок 8
);

test('weather goes on to the next records of the same flight shift until the table gives a new value', () => {
  const plan = planImport(flightFields, SHIFT_JOURNAL());
  assert.equal(plan.rows.length, 7);
  assert.deepEqual([...plan.carry.keys].sort(), ['cloud_base_lower', 'cloud_base_upper', 'cloud_cover', 'visibility']);
  assert.deepEqual(
    [plan.carry.possible, plan.carry.firstNumber, plan.carry.unresolved, plan.carry.unresolvedFirst],
    [3, 3, 1, 6],
  );
  assert.equal(plan.carry.sets.length, plan.rows.length, 'one slot per imported record');

  const records = importRows(plan);
  assert.deepEqual(records.map(weatherOf), [
    [5, 300, 1000, 10], [5, 300, 1000, 10], [7, 200, 800, 4], [7, 200, 800, 4], NO_WEATHER, [3, 150, 600, 6], [3, 150, 600, 6],
  ]);
  assert.equal(records[1].aircraft_type, 'Мі-8', 'the other fields are those of the record itself');
  assert.equal(records[1].flight_shift_number, 1);
  assert.equal(records[0], plan.rows[0], 'a record with its own weather is not copied');

  assert.deepEqual([1, 3, 4, 6].map(index => weatherOf(plan.rows[index])), Array(4).fill(NO_WEATHER), 'the plan itself still holds the table as it is');
  assert.equal(importRows(plan, { carryWeather: false }), plan.rows, 'with the carry off the records are the table as it is');
});

test('carried weather is the whole set of one record: a partial set is not completed from an older one', () => {
  const plan = planImport(flightFields, sheetOf([
    ['Тип ПС', 'Наліт', 'Наліт загальний', 'Льотна зміна', 'Хмарність', 'Видимість'],
    ['Мі-8', '0:30', '0:40', 1, 4, 10],
    ['Мі-8', '0:30', '0:40', 1, null, 6],
    ['Мі-8', '0:30', '0:40', 1, null, null],
  ]));
  assert.equal(plan.matched, 6);
  assert.equal(plan.carry.possible, 1);
  const records = importRows(plan);
  assert.deepEqual(weatherOf(records[0]), [4, undefined, undefined, 10]);
  assert.deepEqual(weatherOf(records[1]), [undefined, undefined, undefined, 6], 'its own visibility and no cloud cover from the record before');
  assert.deepEqual(weatherOf(records[2]), [undefined, undefined, undefined, 6], 'the set of the newest record only');
});

test('weather is not carried without a shift number, over a shift change, past an unreadable cell or a wrong weather', () => {
  const noColumn = planImport(flightFields, sheetOf([
    ['Тип ПС', 'Наліт', 'Наліт загальний', 'Метеоумови'],
    ['Мі-8', '0:30', '0:40', '5/300/1000/10'],
    ['Мі-8', '0:30', '0:40', null],
  ]));
  assert.deepEqual([noColumn.carry.possible, noColumn.carry.unresolved, noColumn.carry.unresolvedFirst], [0, 1, 3], 'shift boundaries are unknown');
  assert.equal(importRows(noColumn), noColumn.rows);

  const blankShift = planImport(flightFields, journal(flightOf(1, '5/300/1000/10'), flightOf(null, null), flightOf(1, null)));
  assert.deepEqual([blankShift.carry.possible, blankShift.carry.unresolved, blankShift.carry.unresolvedFirst], [1, 1, 3]);
  assert.deepEqual(importRows(blankShift).map(weatherOf), [[5, 300, 1000, 10], NO_WEATHER, [5, 300, 1000, 10]]);

  const unreadable = planImport(flightFields, journal(flightOf(1, '5/300/1000/10'), flightOf(1, 'ясно'), flightOf(1, null)));
  assert.deepEqual([unreadable.carry.possible, unreadable.carry.unresolved], [0, 0], 'after a cell that cannot be read the weather is unknown');
  assert.ok(unreadable.warnings.some(item => item.key === 'weather'));

  const inverted = planImport(flightFields, journal(flightOf(1, '5/1000/300/10'), flightOf(1, null)));
  assert.equal(inverted.rules.count, 1, 'the wrong weather is still reported once, on its own record');
  assert.deepEqual([inverted.carry.possible, inverted.carry.unresolved], [0, 0], 'and is not multiplied');
});

test('a skipped record still moves the weather: the next ones do not take an older value', () => {
  const plan = planImport(flightFields, journal(
    flightOf(1, '5/300/1000/10'),
    flightOf(1, '7/200/800/4', { [col('Тип ПС')]: null }),
    flightOf(1, null),
  ));
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.skippedCount, 1);
  assert.equal(plan.carry.sets.length, 2);
  assert.deepEqual(importRows(plan).map(weatherOf), [[5, 300, 1000, 10], [7, 200, 800, 4]]);
});

test('a template without weather fields has nothing to carry', () => {
  const calendar = catalog.find(item => item.id === 'calendar').fields;
  const plan = planImport(calendar, sheetOf([['Дата', 'Значення'], ['2026-03-01', 4], ['2026-03-02', 5]]));
  assert.deepEqual(plan.carry.keys, []);
  assert.equal(plan.carry.possible + plan.carry.unresolved, 0);
  assert.equal(importRows(plan), plan.rows);
  assert.equal(describePlan(plan).carryLabel, '');
});

test('carry notes give the count, the first row and the reason some records stay without weather', () => {
  const notes = describePlan(planImport(flightFields, SHIFT_JOURNAL()));
  assert.equal(notes.carryLabel, 'Протягнути метеоумови на 3 записи тієї ж льотної зміни, де їх не вказано');
  assert.equal(
    notes.carry,
    "Береться значення з попереднього запису тієї ж льотної зміни, поки в таблиці не з'явиться нове (перший — рядок 3).",
  );
  assert.equal(
    notes.carryUnresolved,
    'Не вдалося протягнути метеоумови на 1 запис (рядок 6): почалася нова льотна зміна без метеоумов або в таблиці не вказано номер зміни. Метеополя там лишаться порожніми.',
  );

  const single = describePlan(planImport(flightFields, journal(flightOf(1, '5/300/1000/10'), flightOf(1, null), flightOf(2, null), flightOf(2, null))));
  assert.equal(single.carryLabel, 'Протягнути метеоумови на 1 запис тієї ж льотної зміни, де їх не вказано');
  assert.match(single.carry, /\(рядок 3\)\.$/u);
  assert.match(single.carryUnresolved, /^Не вдалося протягнути метеоумови на 2 записи \(перший — рядок 4\): /u);

  const plain = describePlan(planImport(flightFields, journal(flightOf(1, '5/300/1000/10'), flightOf(1, '5/300/1000/10'))));
  assert.deepEqual([plain.carryLabel, plain.carry, plain.carryUnresolved], ['', '', ''], 'nothing to say when every record has its own weather');
});

// ---------------------------------------------------------------------------------------------
// Перевірка: виправлення значень до підтягування (сире значення таблиці лишається як є)

const REVIEW_JOURNAL = () => journal(
  flightOf(1, '5/300/1000/10', { [col('Зліт')]: '25:00' }), // рядок 2: час зльоту не розібрано
  flightOf(1, null, { [col('Висота')]: '0,3' }), // рядок 3: висота неоднозначна; погода протягується
  flightOf(1, null, { [col('Тип ПС')]: null }), // рядок 4: без типу ПС — пропущено
  flightOf(1, 'ясно'), // рядок 5: клітинку метеоумов не розібрано
  flightOf(1, null), // рядок 6: після нерозібраної погоди — без погоди
  flightOf(2, '5/1000/300/10'), // рядок 7: НМХ вища за ВМХ
);

test('the review lists what can be corrected: unreadable cells, skipped records and broken form rules', () => {
  const plan = planImport(flightFields, REVIEW_JOURNAL());
  assert.equal(plan.rows.length, 5);
  assert.deepEqual(plan.issues.map(issue => [issue.id, issue.kind]), [
    ['2:takeoff_time', 'unreadable'],
    ['3:flight_altitude', 'unreadable'],
    ['4:aircraft_type', 'skipped'],
    ['5:weather', 'unreadable'],
    ['7:cloud_base_lower', 'rule'],
  ]);
  const byId = Object.fromEntries(plan.issues.map(issue => [issue.id, issue]));
  assert.deepEqual(
    [byId['2:takeoff_time'].raw, byId['2:takeoff_time'].column, byId['2:takeoff_time'].label],
    ['25:00', 'Зліт', 'Час зльоту'],
  );
  assert.equal(byId['3:flight_altitude'].raw, '0,3');
  assert.equal(byId['4:aircraft_type'].raw, '');
  assert.match(byId['4:aircraft_type'].reason, /без нього запис не підтягується/u);
  assert.equal(byId['5:weather'].column, 'Метеоумови (хмарність нижня межа верхня межа видимість)');
  assert.equal(byId['7:cloud_base_lower'].raw, '5/1000/300/10', 'the raw text is the weather cell the value came from');
  assert.deepEqual(plan.issues.map(issue => issue.prefill), [true, true, false, true, false],
    'the raw text is a starting point only when it is the cell of that very field');
  assert.match(byId['7:cloud_base_lower'].reason, /НМХ/u);
});

test('a corrected text is read by the same rules as a table cell and nothing is guessed', () => {
  const plan = planImport(flightFields, REVIEW_JOURNAL());
  assert.deepEqual(correctionOutcome(flightFields, plan, 'takeoff_time', ' 14:25 '), { values: { takeoff_time: '14:25' } });
  assert.match(correctionOutcome(flightFields, plan, 'takeoff_time', '25:00').problem, /час доби/u);
  assert.deepEqual(correctionOutcome(flightFields, plan, 'flight_altitude', '0,3 км'), { values: { flight_altitude: 300 } });
  assert.match(correctionOutcome(flightFields, plan, 'flight_altitude', '0,3').problem, /0,3 км/u);
  assert.deepEqual(correctionOutcome(flightFields, plan, 'weather', '3/200/800/6'), {
    values: { cloud_cover: 3, cloud_base_lower: 200, cloud_base_upper: 800, visibility: 6 },
  });
  assert.match(correctionOutcome(flightFields, plan, 'weather', '3/200').problem, /чотири числа/u);
  assert.deepEqual(correctionOutcome(flightFields, plan, 'aircraft_type', 'Мі-8'), { values: { aircraft_type: 'Мі-8' } });
  assert.equal(correctionOutcome(flightFields, plan, 'aircraft_type', '   ').problem, 'введіть значення');
  assert.equal(correctionOutcome(flightFields, plan, 'secret', '1').problem, 'невідоме поле');
});

test('corrections go into copies of the records: the plan keeps the table as it is', () => {
  const plan = planImport(flightFields, REVIEW_JOURNAL());
  const before = JSON.stringify(plan.rows);
  const corrections = new Map([
    [correctionId(2, 'takeoff_time'), '14:25'],
    [correctionId(3, 'flight_altitude'), '0,3 км'],
    [correctionId(4, 'aircraft_type'), 'Мі-24'],
    [correctionId(5, 'weather'), '3/200/800/6'],
    [correctionId(7, 'cloud_base_lower'), '200'],
  ]);
  const built = buildImport(flightFields, plan, corrections);
  assert.equal(JSON.stringify(plan.rows), before, 'the plan rows are untouched');
  assert.deepEqual(built.rowNumbers, [2, 3, 4, 5, 6, 7], 'the skipped record comes back in its place');
  assert.equal(built.rows[0].takeoff_time, '14:25');
  assert.equal(built.rows[1].flight_altitude, 300);
  assert.equal(built.rows[2].aircraft_type, 'Мі-24');
  assert.deepEqual(weatherOf(built.rows[3]), [3, 200, 800, 6]);
  assert.deepEqual(built.rules, [], 'the corrected НМХ no longer breaks the rule');
  assert.equal(built.applied.length, 5);
  assert.deepEqual(built.problems, []);
  // Виправлена погода — нове значення: запис після неї бере саме її.
  const records = importRows(plan, { build: built });
  assert.deepEqual(weatherOf(records[4]), [3, 200, 800, 6]);
  assert.deepEqual(weatherOf(records[1]), [5, 300, 1000, 10], 'the record after the first one still takes the first weather');
  assert.deepEqual(weatherOf(importRows(plan).at(-2)), NO_WEATHER, 'without the correction the weather after an unreadable cell is unknown');

  const wrong = buildImport(flightFields, plan, new Map([[correctionId(2, 'takeoff_time'), '24:61']]));
  assert.equal(wrong.problems.length, 1);
  assert.equal(wrong.problems[0].id, '2:takeoff_time');
  assert.equal('takeoff_time' in wrong.rows[0], false, 'a bad correction leaves the field empty, as without it');
});

test('saved corrections point to the created records and keep the raw cell, the typed text and where it was', () => {
  const plan = planImport(flightFields, REVIEW_JOURNAL());
  const built = buildImport(flightFields, plan, new Map([
    [correctionId(2, 'takeoff_time'), ' 14:25 '],
    [correctionId(4, 'aircraft_type'), 'Мі-24'],
    [correctionId(5, 'weather'), '3/200/800/6'],
  ]));
  const records = correctionRecords(plan, built, 'Журнал_синтетичний.xlsx');
  assert.deepEqual(records[0], {
    rowIndex: 0, fieldKey: 'takeoff_time', sourceFile: 'Журнал_синтетичний.xlsx', sourceSheet: 'Журнал', sourceRow: 2,
    sourceColumn: 'Зліт', rawText: '25:00', correctedText: '14:25', reason: 'очікується час доби, наприклад 14:25',
  });
  assert.deepEqual(records.map(record => [record.rowIndex, record.fieldKey]), [
    [0, 'takeoff_time'], [2, 'aircraft_type'],
    [3, 'cloud_cover'], [3, 'cloud_base_lower'], [3, 'cloud_base_upper'], [3, 'visibility'],
  ]);
  assert.ok(records.every(record => record.rawText !== record.correctedText));
  // Кожне виправлене поле в записі має значення — так перевіряє і Rust.
  const rows = importRows(plan, { build: built });
  for (const record of records) assert.notEqual(rows[record.rowIndex][record.fieldKey], undefined, record.fieldKey);
  // Запис, який так і не підтягується, своїх виправлень не зберігає.
  const lost = buildImport(flightFields, plan, new Map([[correctionId(4, 'flight_altitude'), '300']]));
  assert.deepEqual(correctionRecords(plan, lost, 'x.xlsx'), []);
});

test('the review state tells what is fixed, still open or wrong, and the notes count the corrections', () => {
  const plan = planImport(flightFields, REVIEW_JOURNAL());
  const untouched = reviewState(plan, buildImport(flightFields, plan));
  assert.deepEqual([untouched.total, untouched.fixed, untouched.open], [5, 0, 5]);
  const built = buildImport(flightFields, plan, new Map([
    [correctionId(2, 'takeoff_time'), '14:25'],
    [correctionId(3, 'flight_altitude'), '0,3'],
    [correctionId(7, 'cloud_base_lower'), '900'],
  ]));
  const state = reviewState(plan, built);
  const status = Object.fromEntries(state.items.map(item => [item.id, item.status]));
  assert.deepEqual(status, {
    '2:takeoff_time': 'fixed',
    '3:flight_altitude': 'invalid',
    '4:aircraft_type': 'open',
    '5:weather': 'open',
    '7:cloud_base_lower': 'still',
  });
  assert.match(state.items.find(item => item.id === '3:flight_altitude').problem, /0,3 км/u);
  assert.equal(state.items.find(item => item.id === '4:aircraft_type').imported, false);
  assert.deepEqual([state.fixed, state.open, state.applied], [1, 4, 2]);

  const notes = describePlan(plan, built);
  assert.equal(notes.summary, 'Буде підтягнуто 5 записів.');
  assert.equal(notes.corrected, 'Виправлено вручну: 2 значення. Сирі значення таблиці збережуться окремо й будуть видні в модулі.');
  const recovered = buildImport(flightFields, plan, new Map([[correctionId(4, 'aircraft_type'), 'Мі-8']]));
  assert.equal(describePlan(plan, recovered).summary, 'Буде підтягнуто 6 записів.');
  assert.equal(describePlan(plan).corrected, '');
});

// ---------------------------------------------------------------------------------------------
// Підписи

test('plan notes name what was found, what becomes a new module column and what was left out', () => {
  const plan = planImport(flightFields, sheetOf([
    [...OWNER_HEADERS, 'Примітки'],
    ...[1, 2, 3].map(() => [...ownerCells(baseValues()), 'x']),
    [...ownerCells({ ...baseValues(), [col('Висота')]: '0,3' }), null],
    [...ownerCells({ [col('Пасажири')]: 1 }), null],
    [...ownerCells({ ...baseValues(), [col('Тип ПС')]: 'Разом' }), null],
  ]));
  const notes = describePlan(plan);
  assert.equal(notes.summary, 'Буде підтягнуто 4 записи.');
  assert.equal(notes.columns, 'Знайдено стовпців: 34 з 35.');
  assert.equal(notes.missing, 'Нові стовпці модуля — у вашій таблиці їх немає: Позивний командира екіпажу. Дані в них вноситимуться вручну.');
  assert.equal(notes.extra, 'Не використано стовпців таблиці: Примітки.');
  assert.equal(notes.skipped, 'Пропущено 2 рядки: немає значення в «Тип ПС» — 1; підсумковий рядок — 1.');
  assert.equal(notes.warnings.length, 1);
  assert.equal(
    notes.warnings[0],
    '«Висота польоту, м»: не розібрано 1 клітинку (рядок 5: «0,3» — очікується висота: 300, 300 м або 0,3 км).',
  );
  assert.equal(notes.truncated, '');
  assert.equal(notes.blocked, '');
});

test('long lists in the notes are cut and counts take the right Ukrainian form', () => {
  const plan = planImport(flightFields, sheetOf([['Тип ПС', 'Наліт', 'Наліт загальний'], ['Мі-8', '0:30', '0:40']]));
  const notes = describePlan(plan);
  assert.match(notes.missing, /^Нові стовпці модуля — у вашій таблиці їх немає: .+ та ще \d+\. Дані в них вноситимуться вручну\.$/u);
  assert.equal(notes.summary, 'Буде підтягнуто 1 запис.');
  const five = planImport(flightFields, sheetOf([['Тип ПС', 'Наліт', 'Наліт загальний'], ...Array.from({ length: 5 }, () => ['Мі-8', '0:30', '0:40'])]));
  assert.equal(describePlan(five).summary, 'Буде підтягнуто 5 записів.');
  const warned = planImport(flightFields, sheetOf([
    ['Тип ПС', 'Наліт', 'Наліт загальний', 'Висота'],
    ...Array.from({ length: 2 }, () => ['Мі-8', '0:30', '0:40', 'низько']),
  ]));
  assert.match(describePlan(warned).warnings[0], /не розібрано 2 клітинки/u);
  const skipped = planImport(flightFields, sheetOf([
    ['Тип ПС', 'Наліт', 'Наліт загальний'],
    ...Array.from({ length: 5 }, () => [null, '0:30', '0:40']),
  ]));
  assert.match(describePlan(skipped).skipped, /^Пропущено 5 рядків: /u);
});

test('the plan lists where each module column comes from, repeated columns included', () => {
  const plan = planImport(flightFields, journal(ownerCells(baseValues())));
  const from = key => plan.found.find(item => item.key === key).from;
  assert.equal(from('combat_training_exercise_number'), 'Вправа (1-й стовпець)');
  assert.equal(from('complex_exercise_number_2'), 'Вправа (3-й стовпець)');
  assert.equal(from('crew_other'), 'Інший екіпаж ×6');
  assert.equal(from('airborne_hours'), 'Наліт');
  assert.equal(from('cloud_cover'), 'Метеоумови (хмарність нижня межа верхня межа видимість)');
});
