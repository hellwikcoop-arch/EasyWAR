const RESULT_KIND = Object.freeze({
  hit: 'hit',
  partial: 'part',
  miss: 'miss',
  unknown: 'unk',
});

function unknownResultMessage(resultRaw) {
  const value = String(resultRaw ?? '');
  const visible = value.length > 60 ? `${value.slice(0, 57)}…` : value;
  return `Результат не розпізнано: «${visible}»`;
}

export function qualityIssueMessage(issue, record) {
  switch (issue) {
    case 'invalid_date':
      return `Дату не розпізнано: «${String(record.dateRaw ?? '')}»`;
    case 'invalid_munition_count':
      return `Кількість БП не число: «${String(record.munitionCountRaw ?? '')}»`;
    case 'missing_munition_count':
      return 'Не вказано кількість БП';
    case 'missing_result':
      return 'Не вказано результат ураження';
    case 'unknown_result':
      return unknownResultMessage(record.resultRaw);
    case 'missing_unit':
      return 'Не вказано, в інтересах кого';
    case 'missing_district':
      return 'Не вказано район / н.п.';
    case 'missing_targets':
      return 'Немає номера цілі (TS/KS)';
    case 'missing_target_types':
      return 'Не вказано тип цілі';
    case 'missing_aircraft':
      return 'Не вказано тип ЛА';
    case 'missing_munition':
      return 'Не вказано тип БП';
    case 'missing_coordinates':
      return 'Немає координат, які вдається розпізнати';
    default:
      throw new TypeError(`Невідомий код якості дашборда: ${String(issue)}`);
  }
}

export function mapDashboardRecord(record, parsePoints) {
  const kind = RESULT_KIND[record.result];
  if (!kind) {
    throw new TypeError(`Невідоме значення результату дашборда: ${String(record.result)}`);
  }

  const date = record.date;
  const time = record.time;
  return {
    num: parseInt(record.number, 10) || 0,
    date,
    time,
    sort: `${date || ''} ${((/\d{1,2}:\d{2}/.exec(time || '') || ['00:00'])[0]).padStart(5, '0')}`,
    targets: record.targetIds,
    unit: record.unit,
    unitRaw: record.unit,
    district: record.district,
    types: record.targetTypes,
    aircraft: record.aircraft,
    munition: record.munition,
    count: record.munitionCount,
    kind,
    resRaw: record.resultRaw,
    abort: record.aborted,
    dpi: record.coordinates,
    pts: parsePoints(record.coordinates),
    cause: record.cause,
    note: record.note,
    issues: record.qualityIssues.map(issue => qualityIssueMessage(issue, record)),
  };
}

export function mapDashboardRecords(records, parsePoints) {
  return records.map(record => mapDashboardRecord(record, parsePoints));
}
