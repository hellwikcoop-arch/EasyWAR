/* Слайд «Власні втрати» за таблицею «НАШІ ВТРАТИ» (журнал подій).
   Чисте ядро без DOM. Усі тексти складаються з чисел таблиці. Причини подаються як
   фактичний розподіл «Дія противника» з таблиці, а не як припущення. */

import { groupTotals, inRange, lastOwnDate, sumGroup, sumMetric } from './own-losses-core.js';
import { NBSP, buckets, daysIn, dayNumber, formatNumber, formatPercent, isoFromDay, longDate, peakOf, periodText, rollingRange, chartDay, shortDate, signed, tileFor } from './presentation-format.js';

const DEFS = [
  { key: 'k200', name: 'Наші 200', value: rs => sumMetric(rs, 'personnel|200'), chart: '200' },
  { key: 'k300', name: 'Наші 300', value: rs => sumMetric(rs, 'personnel|300'), chart: '300' },
  { key: 'k500', name: 'Наші 500', value: rs => sumMetric(rs, 'personnel|500'), chart: '500' },
  { key: 'artDestroyed', name: 'Арт. системи знищено', value: rs => sumGroup(rs, 'destroyed') },
  { key: 'artDamaged', name: 'Арт. системи пошкоджено', value: rs => sumGroup(rs, 'damaged') },
  { key: 'outOfOrder', name: 'Вийшли з ладу (за техн. станом)', value: rs => sumGroup(rs, 'outOfOrder') },
];
const PERSONNEL_TOTAL = rs => sumGroup(rs, 'personnel');
const MIN_SHARE_TOTAL = 5; // менші суми не дають осмисленої частки

const shareText = (part, whole) => `${formatNumber(part / whole * 100)}${NBSP}%`;
const listText = (items, limit = 3) => items.slice(0, limit).map(i => `${i.name} — ${formatNumber(i.total)}`).join(', ');

/** Втрати о/с (200, 300, 500) за період: рядки з підозрілою датою не враховуються. */
export function ownLossesInRange(own, range) {
  const rs = own.records.filter(r => !r.suspect && inRange(r, range));
  const parts = { 200: sumMetric(rs, 'personnel|200'), 300: sumMetric(rs, 'personnel|300'), 500: sumMetric(rs, 'personnel|500') };
  return { total: parts[200] + parts[300] + parts[500], parts };
}

export function buildOwnLossesSlide(own, options = {}) {
  const config = options.config;
  // Рядки з підозрілою датою (див. date-outlier) не потрапляють у періоди: їх місце невідоме до виправлення таблиці.
  const records = own.records.filter(r => !r.suspect);
  const dataFrom = records.length ? records[0].date : '';
  const anchor = options.anchor || lastOwnDate(own);
  const custom = options.custom && options.custom.from && options.custom.to ? options.custom : null;
  const range = custom ? (custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from }) : rollingRange(anchor, 30);
  const length = daysIn(range).length;
  const prevRange = { from: isoFromDay(dayNumber(range.from) - length), to: isoFromDay(dayNumber(range.from) - 1) };
  const prevComplete = Boolean(dataFrom) && prevRange.from >= dataFrom;

  const current = records.filter(r => inRange(r, range));
  const previous = records.filter(r => inRange(r, prevRange));
  const { bucket, list } = buckets(range);
  const inBucket = b => current.filter(r => r.date >= b.from && r.date <= b.to);

  const kpis = DEFS.map(def => {
    const total = def.value(current);
    const before = def.value(previous);
    return { key: def.key, label: def.name, total, previous: before, delta: total - before, deltaPercent: before ? (total - before) / before * 100 : null, better: 'down' };
  });

  const changes = [];
  const attention = [];
  if (!prevComplete) {
    attention.push({ severity: 80, text: `Попередній відрізок (${periodText(prevRange)}) починається раніше за перший запис таблиці: відсотки змін не рахуємо.` });
  } else {
    for (const k of kpis) {
      if (k.previous >= config.minBase) {
        if (Math.abs(k.deltaPercent) >= config.changePercent) changes.push({ severity: Math.abs(k.deltaPercent), text: `${k.label}: ${formatNumber(k.total)} проти ${formatNumber(k.previous)} (${formatPercent(k.deltaPercent)}).` });
      } else if (k.delta !== 0) {
        changes.push({ severity: 20 + Math.abs(k.delta), text: `${k.label}: ${formatNumber(k.total)} проти ${formatNumber(k.previous)} (${signed(k.delta)}, база менша за ${config.minBase}).` });
      }
    }
  }

  // Концентрація втрат о/с за підрозділами (бригадами).
  const byUnit = new Map();
  for (const r of current) byUnit.set(r.unit, (byUnit.get(r.unit) || 0) + PERSONNEL_TOTAL([r]));
  const personnelSum = [...byUnit.values()].reduce((a, b) => a + b, 0);
  if (byUnit.size >= 2 && personnelSum >= MIN_SHARE_TOTAL) {
    const [unit, top] = [...byUnit.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk'))[0];
    if (top / personnelSum >= config.concentrationShare) attention.push({ severity: top / personnelSum * 40, text: `Втрати о/с: ${unit} — ${shareText(top, personnelSum)} (${formatNumber(top)} з ${formatNumber(personnelSum)}).` });
  }

  // Пік за добою.
  if (bucket === 'day') {
    const points = list.map(b => ({ from: b.from, value: PERSONNEL_TOTAL(inBucket(b)) }));
    const peak = peakOf(points, { ...config, minBase: Math.min(config.minBase, MIN_SHARE_TOTAL) });
    if (peak) attention.push({ severity: 65, text: `Втрати о/с: пік ${longDate(peak.date)} — ${formatNumber(peak.value)} при типовому не більше ${formatNumber(peak.fence)}.` });
  }

  if (!current.length) attention.push({ severity: 70, text: 'За період у таблиці власних втрат немає жодної події.' });

  // Фактичний розподіл «Дія противника» замість припущень.
  const causeTotals = groupTotals(current, 'personnelCause');
  const causeSum = causeTotals.reduce((s, i) => s + i.total, 0);
  const causeLines = [];
  causeLines.push(causeSum
    ? `Дія противника (випадків ${formatNumber(causeSum)}): ${causeTotals.slice(0, 3).map(i => `${i.name} — ${formatNumber(i.total)} (${shareText(i.total, causeSum)})`).join(', ')}.`
    : 'Дію противника за втратами о/с у таблиці за період не вказано.');
  const destroyed = groupTotals(current, 'destroyed');
  const damaged = groupTotals(current, 'damaged');
  causeLines.push(destroyed.length ? `Арт. системи знищено: ${listText(destroyed)}.` : 'Знищених арт. систем за період немає.');
  causeLines.push(damaged.length ? `Арт. системи пошкоджено: ${listText(damaged)}.` : 'Пошкоджених арт. систем за період немає.');

  const top = list => list.sort((a, b) => b.severity - a.severity).slice(0, config.maxItems).map(({ text }) => ({ text }));

  const categories = list.map(b => (bucket === 'day' ? chartDay(b.from) : `${shortDate(b.from)}–${shortDate(b.to)}`));
  const charts = [{
    id: 'own-personnel', title: 'Втрати о/с', bucket, categories,
    series: DEFS.filter(d => d.chart).map(d => ({ name: d.chart, values: list.map(b => d.value(inBucket(b))) })),
  }];
  if (causeTotals.length) {
    const shown = causeTotals.slice(0, 6);
    charts.push({ id: 'own-causes', title: 'Дія противника (випадків)', horizontal: true, categories: shown.map(i => i.name), series: [{ name: 'Випадків', values: shown.map(i => i.total) }] });
  }

  const sums = rs => `200 — ${formatNumber(sumMetric(rs, 'personnel|200'))} · 300 — ${formatNumber(sumMetric(rs, 'personnel|300'))} · 500 — ${formatNumber(sumMetric(rs, 'personnel|500'))}`;
  const week = rollingRange(anchor, 7);
  const strip = `Останні 7 діб: ${sums(records.filter(r => inRange(r, week)))}   |   Весь період: ${sums(records)}`;

  return {
    id: 'own-losses',
    status: 'ready',
    title: custom ? 'Власні втрати · обраний період' : 'Власні втрати · останні 30 діб',
    thirdTitle: 'Головні причини за даними таблиці',
    strip,
    period: { from: range.from, to: range.to, days: length, activeDays: new Set(current.map(r => r.date)).size, text: periodText(range) },
    previous: { from: prevRange.from, to: prevRange.to, text: periodText(prevRange), covered: prevComplete ? length : 0, days: length, complete: prevComplete },
    tiles: kpis.map(k => tileFor(k, prevComplete, config)),
    charts,
    changes: top(changes),
    attention: top(attention),
    hypotheses: causeLines.map(text => ({ text })),
    notes: [],
  };
}
