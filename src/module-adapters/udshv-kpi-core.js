/* E2, блок УДШВ: картки показників (9 штук) у спільному ядрі модулів. Чисте ядро без DOM.
   Формули перенесено з udshv-dashboard-core.js без змін; стара вкладка УДШВ викликає ці функції.
   Ряд за днями/тижнями будує `seriesFor` ядра УДШВ: його передає викликач (календар і межі тижня
   лишаються в старому ядрі, циклічного імпорту немає). */

/** Визначення реєстру модулів (docs/MODULE_DEFINITIONS.md), які рахує цей блок. */
export const UDSHV_KPI_DEFINITIONS = Object.freeze([
  'legacy:udshv-kpi-kia',
  'legacy:udshv-kpi-wia',
  'legacy:udshv-kpi-personnel',
  'legacy:udshv-kpi-destroyed',
  'legacy:udshv-kpi-damaged',
  'legacy:udshv-kpi-suppressed',
  'legacy:udshv-kpi-ammo',
  'legacy:udshv-kpi-vgz',
  'legacy:udshv-kpi-kbb',
]);

export const sumBy = (records, predicate) => {
  let total = 0;
  for (const r of records) for (const [id, v] of Object.entries(r.values)) if (predicate(id)) total += v;
  return total;
};

export const inGroup = (group, withTotal = false) => id => id.startsWith(`${group}|`) && (withTotal || id !== 'ammo|ВСЬОГО');

export const ammoTotal = records => {
  // ВСЬОГО у таблиці — формула; якщо її немає, рахуємо самі.
  let total = 0;
  for (const r of records) {
    const own = r.values['ammo|ВСЬОГО'];
    total += own != null ? own : Object.entries(r.values).filter(([id]) => inGroup('ammo')(id)).reduce((s, [, v]) => s + v, 0);
  }
  return total;
};

export const KPI = [
  { key: 'kia', label: '200', hint: 'Знищено о/с', tone: 'red', value: rs => sumBy(rs, id => id === 'personnel|200') },
  { key: 'wia', label: '300', hint: 'Поранено о/с', tone: 'amber', value: rs => sumBy(rs, id => id === 'personnel|300') },
  { key: 'personnel', label: 'Втрати о/с разом', hint: '200 + 300', tone: 'violet', value: rs => sumBy(rs, inGroup('personnel')) },
  { key: 'destroyed', label: 'ОВТ знищено', hint: 'одиниць', tone: 'red', value: rs => sumBy(rs, inGroup('destroyed')) },
  { key: 'damaged', label: 'ОВТ пошкоджено', hint: 'одиниць', tone: 'amber', value: rs => sumBy(rs, inGroup('damaged')) },
  { key: 'suppressed', label: 'ОВТ подавлено', hint: 'одиниць', tone: 'blue', value: rs => sumBy(rs, inGroup('suppressed')) },
  { key: 'ammo', label: 'Витрата БК', hint: 'ВСЬОГО', tone: 'green', value: ammoTotal },
  { key: 'vgz', label: 'ВгЗ', hint: 'вогневі завдання', tone: 'blue', value: rs => sumBy(rs, id => id === 'fire|ВгЗ') },
  { key: 'kbb', label: 'КББ', hint: 'контрбатарейна боротьба', tone: 'violet', value: rs => sumBy(rs, id => id === 'fire|КББ') },
];

/**
 * Картки за період: підсумок, попередній період, різниця й ряд.
 * `previous` — записи попереднього періоду (порожній масив, якщо його немає).
 */
export function computeUdshvKpis({ current, previous = [], range, bucket }, seriesFor) {
  const hasPrevious = previous.length > 0;
  return KPI.map(k => {
    const total = k.value(current);
    const before = hasPrevious ? k.value(previous) : null;
    return {
      key: k.key, label: k.label, hint: k.hint, tone: k.tone, total, previous: before,
      delta: before == null ? null : total - before,
      deltaPercent: before ? (total - before) / before * 100 : null,
      series: seriesFor(current, range, k.value, bucket),
    };
  });
}
