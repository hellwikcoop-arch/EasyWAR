import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapDashboardRecord,
  mapDashboardRecords,
  qualityIssueMessage,
} from '../src/sqlite-dashboard-source-core.js';

function dashboardRecord(overrides = {}) {
  return {
    number: '007',
    date: '2026-09-23',
    dateRaw: '23.09.2026',
    time: '7:05',
    targetIds: ['TS-1', 'KS-2'],
    unit: '79 ОДШБр',
    district: 'Краматорськ',
    targetTypes: ['Пункт управління', 'Склад'],
    aircraft: 'БпЛА',
    munition: 'БП-1',
    munitionCount: 2,
    munitionCountRaw: '2',
    result: 'partial',
    resultRaw: 'ЧАСТКОВО УРАЖЕНО',
    aborted: false,
    coordinates: '37U DB 12345 67890',
    cause: 'Погодні умови',
    note: 'Контроль виконано',
    qualityIssues: [],
    ...overrides,
  };
}

test('maps every field from the mapping table one-for-one', () => {
  const points = [{ lat: 48.1, lon: 37.2 }];
  const parseCalls = [];
  const mapped = mapDashboardRecord(dashboardRecord(), coordinates => {
    parseCalls.push(coordinates);
    return points;
  });

  assert.deepEqual(mapped, {
    num: 7,
    date: '2026-09-23',
    time: '7:05',
    sort: '2026-09-23 07:05',
    targets: ['TS-1', 'KS-2'],
    unit: '79 ОДШБр',
    unitRaw: '79 ОДШБр',
    district: 'Краматорськ',
    types: ['Пункт управління', 'Склад'],
    aircraft: 'БпЛА',
    munition: 'БП-1',
    count: 2,
    kind: 'part',
    resRaw: 'ЧАСТКОВО УРАЖЕНО',
    abort: false,
    dpi: '37U DB 12345 67890',
    pts: points,
    cause: 'Погодні умови',
    note: 'Контроль виконано',
    issues: [],
  });
  assert.deepEqual(parseCalls, ['37U DB 12345 67890']);
  assert.equal(mapped.unitRaw, mapped.unit);
});

test('maps an empty records array to an empty dashboard', () => {
  assert.deepEqual(mapDashboardRecords([], () => []), []);
});

test('keeps a null date and does not normalize it again', () => {
  const mapped = mapDashboardRecord(dashboardRecord({
    date: null,
    dateRaw: 'не дата',
    time: '',
    qualityIssues: ['invalid_date'],
  }), () => []);

  assert.equal(mapped.date, null);
  assert.equal(mapped.sort, ' 00:00');
  assert.deepEqual(mapped.issues, ['Дату не розпізнано: «не дата»']);
});

test('maps only the four Rust result values to legacy kind names', () => {
  const cases = [
    ['hit', 'hit'],
    ['partial', 'part'],
    ['miss', 'miss'],
    ['unknown', 'unk'],
  ];
  for (const [result, kind] of cases) {
    assert.equal(mapDashboardRecord(dashboardRecord({ result }), () => []).kind, kind);
  }
});

test('copies multiple quality issues with the exact legacy Ukrainian text', () => {
  const resultRaw = 'Невідомий результат із навмисно довгим текстом, який перевищує шістдесят символів';
  const mapped = mapDashboardRecord(dashboardRecord({
    dateRaw: '31.02.2026',
    munitionCountRaw: 'два',
    result: 'unknown',
    resultRaw,
    qualityIssues: [
      'invalid_date',
      'invalid_munition_count',
      'missing_munition_count',
      'missing_result',
      'unknown_result',
      'missing_unit',
      'missing_district',
      'missing_targets',
      'missing_target_types',
      'missing_aircraft',
      'missing_munition',
    ],
  }), () => []);

  assert.deepEqual(mapped.issues, [
    'Дату не розпізнано: «31.02.2026»',
    'Кількість БП не число: «два»',
    'Не вказано кількість БП',
    'Не вказано результат ураження',
    `Результат не розпізнано: «${resultRaw.slice(0, 57)}…»`,
    'Не вказано, в інтересах кого',
    'Не вказано район / н.п.',
    'Немає номера цілі (TS/KS)',
    'Не вказано тип цілі',
    'Не вказано тип ЛА',
    'Не вказано тип БП',
  ]);
});

test('maps missing coordinates to the exact legacy quality message', () => {
  const record = dashboardRecord({
    coordinates: '',
    qualityIssues: ['missing_coordinates'],
  });

  assert.equal(
    qualityIssueMessage('missing_coordinates', record),
    'Немає координат, які вдається розпізнати',
  );
  assert.deepEqual(
    mapDashboardRecord(record, () => []).issues,
    ['Немає координат, які вдається розпізнати'],
  );
});
