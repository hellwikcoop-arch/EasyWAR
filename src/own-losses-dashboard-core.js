/* Модель вкладки «Наші втрати» дашбордів УДШВ і ПВК за таблицею «НАШІ ВТРАТИ» (журнал подій).
   Чисте ядро без DOM. Показники й підписи беруться з таблиці дослівно; період вкладки не залежить
   від періоду основної таблиці дашборда, бо це окремий файл з власними датами. */

import { groupTotals, inRange, lastOwnDate, sumGroup, sumMetric, validateOwnLosses } from './own-losses-core.js';
import { buckets, dayNumber, daysIn, isoFromDay, rollingRange } from './presentation-format.js';

export const OWN_PRESETS = [['week', '7 діб'], ['month', '30 діб'], ['all', 'Весь період'], ['custom', 'Довільний']];

const PERSONNEL_METRICS = [{ key: 'k200', id: 'personnel|200', label: '200' }, { key: 'k300', id: 'personnel|300', label: '300' }, { key: 'k500', id: 'personnel|500', label: '500' }];
export const OWN_SERIES_KEYS = PERSONNEL_METRICS.map(({ key, label }) => ({ key, label }));

/** Записи, що беруться до уваги: без рядків із підозрілою датою (їх місце невідоме до виправлення таблиці). */
export const usableRecords = own => (own?.records || []).filter(record => !record.suspect);

export function ownDataRange(own) {
  const dates = usableRecords(own).map(record => record.date).sort();
  return { from: dates[0] || '', to: dates[dates.length - 1] || '' };
}

/** Період вкладки: 7 і 30 діб — ковзні до останньої дати таблиці, «весь період» — від першої до останньої. */
export function ownPeriodRange(own, preset = 'month', custom = {}) {
  const all = ownDataRange(own);
  const anchor = all.to || lastOwnDate(own);
  if (preset === 'week') return rollingRange(anchor, 7);
  if (preset === 'month') return rollingRange(anchor, 30);
  if (preset === 'custom' && custom.from && custom.to) return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  return all;
}

const unitFilter = units => {
  const list = [...new Set((units || []).filter(Boolean))];
  return list.length ? record => list.includes(record.unit) : () => true;
};

const personnelOf = records => sumGroup(records, 'personnel');
const DEFS = [
  { key: 'k200', label: '200', hint: 'Втрати о/с', tone: 'red', value: rs => sumMetric(rs, 'personnel|200') },
  { key: 'k300', label: '300', hint: 'Втрати о/с', tone: 'amber', value: rs => sumMetric(rs, 'personnel|300') },
  { key: 'k500', label: '500', hint: 'Втрати о/с', tone: 'violet', value: rs => sumMetric(rs, 'personnel|500') },
  { key: 'personnel', label: 'Втрати о/с разом', hint: 'усі показники групи «Втрати о/с»', tone: 'red', value: personnelOf },
  { key: 'destroyed', label: 'Арт. системи знищено', hint: 'Втрати арт. систем (знищені)', tone: 'amber', value: rs => sumGroup(rs, 'destroyed') },
  { key: 'damaged', label: 'Арт. системи пошкоджено', hint: 'Втрати арт. систем (пошкоджені)', tone: 'blue', value: rs => sumGroup(rs, 'damaged') },
  { key: 'outOfOrder', label: 'Вийшли з ладу', hint: 'за технічним станом', tone: 'green', value: rs => sumGroup(rs, 'outOfOrder') },
];

const causeText = record => Object.entries(record.values)
  .filter(([id]) => id.startsWith('personnelCause|'))
  .map(([id, value]) => (value === 1 ? id.slice('personnelCause|'.length) : `${id.slice('personnelCause|'.length)} ×${value}`))
  .join(', ');

/**
 * Модель вкладки. options: { preset, custom: { from, to }, units: [] } — ті самі підрозділи, що в таблиці.
 * Порівняння — з попереднім відрізком тієї самої довжини, лише якщо він повністю в межах даних таблиці.
 */
export function createOwnLossesModel(own, options = {}) {
  const preset = options.preset || 'month';
  const range = ownPeriodRange(own, preset, options.custom || {});
  const all = ownDataRange(own);
  const length = daysIn(range).length;
  const previousRange = length && preset !== 'all'
    ? { from: isoFromDay(dayNumber(range.from) - length), to: isoFromDay(dayNumber(range.from) - 1) }
    : { from: '', to: '' };
  const hasPrevious = Boolean(previousRange.from) && Boolean(all.from) && previousRange.from >= all.from;
  const pass = unitFilter(options.units);
  const records = usableRecords(own).filter(pass);
  const current = records.filter(record => inRange(record, range));
  const previous = hasPrevious ? records.filter(record => inRange(record, previousRange)) : [];
  const { bucket, list } = length ? buckets(range) : { bucket: 'day', list: [] };

  const kpis = DEFS.map(def => {
    const total = def.value(current);
    const before = hasPrevious ? def.value(previous) : null;
    return {
      key: def.key, label: def.label, hint: def.hint, tone: def.tone, total,
      previous: before,
      delta: before == null ? null : total - before,
      deltaPercent: before ? (total - before) / before * 100 : null,
      series: list.map(item => ({ from: item.from, to: item.to, value: def.value(current.filter(record => record.date >= item.from && record.date <= item.to)) })),
    };
  });

  const series = list.map(item => {
    const inside = current.filter(record => record.date >= item.from && record.date <= item.to);
    return { from: item.from, to: item.to, value: Object.fromEntries(PERSONNEL_METRICS.map(metric => [metric.key, sumMetric(inside, metric.id)])) };
  });

  const byUnit = new Map();
  for (const record of current) {
    const row = byUnit.get(record.unit) || { unit: record.unit, k200: 0, k300: 0, k500: 0, personnel: 0, destroyed: 0, damaged: 0, outOfOrder: 0, events: 0 };
    row.k200 += record.values['personnel|200'] || 0;
    row.k300 += record.values['personnel|300'] || 0;
    row.k500 += record.values['personnel|500'] || 0;
    row.personnel += personnelOf([record]);
    row.destroyed += sumGroup([record], 'destroyed');
    row.damaged += sumGroup([record], 'damaged');
    row.outOfOrder += sumGroup([record], 'outOfOrder');
    row.events += 1;
    byUnit.set(record.unit, row);
  }
  const units = [...byUnit.values()].sort((a, b) => b.personnel - a.personnel || b.destroyed + b.damaged - a.destroyed - a.damaged || a.unit.localeCompare(b.unit, 'uk'));

  const events = [...current].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.rowNumber - a.rowNumber)).map(record => ({
    date: record.date, unit: record.unit, unitRaw: record.unitRaw, sheet: record.sheet, rowNumber: record.rowNumber,
    k200: record.values['personnel|200'] || 0, k300: record.values['personnel|300'] || 0, k500: record.values['personnel|500'] || 0,
    destroyed: sumGroup([record], 'destroyed'), damaged: sumGroup([record], 'damaged'), outOfOrder: sumGroup([record], 'outOfOrder'),
    cause: causeText(record),
  }));

  return {
    preset, range, previousRange, hasPrevious, bucket, length,
    dataRange: all,
    days: length,
    activeDays: new Set(current.map(record => record.date)).size,
    eventCount: current.length,
    kpis,
    series,
    units,
    causes: groupTotals(current, 'personnelCause'),
    destroyedTypes: groupTotals(current, 'destroyed'),
    damagedTypes: groupTotals(current, 'damaged'),
    destroyedCauses: groupTotals(current, 'destroyedCause'),
    damagedCauses: groupTotals(current, 'damagedCause'),
    events,
    suspect: (own?.records || []).filter(record => record.suspect).length,
    undated: (own?.undated || []).length,
    issues: validateOwnLosses(own),
    allUnits: own?.units || [],
  };
}
