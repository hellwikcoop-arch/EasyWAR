/* Слайд групи (ПС або РВіА) за її власною таблицею ударів («Зведена»).
   Чисте ядро без DOM. Усі тексти складаються з чисел таблиці. Причини подаються як
   фактичний розподіл поля «Причина», а не як припущення. Якір — остання дата таблиці групи. */

import { inRange } from './udshv-dashboard-core.js';
import { firstStrikeDate, lastStrikeDate, strikeStats, tally } from './strikes-core.js';
import { NBSP, buckets, dayNumber, daysIn, formatNumber, formatPercent, isoFromDay, longDate, peakOf, periodText, rollingRange, chartDay, shortDate, signed, tileFor } from './presentation-format.js';

const share = (part, whole) => `${formatNumber(part / whole * 100)}${NBSP}%`;
const listText = (items, limit = 3) => items.slice(0, limit).map(i => `${i.name} — ${formatNumber(i.total)}`).join(', ');
const ppText = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value))}${NBSP}п.п.`;

const COUNT_DEFS = [
  { key: 'total', name: 'Завдань (записів)', better: null },
  { key: 'munitions', name: 'Боєприпасів (шт.)', better: null },
  { key: 'hit', name: 'Уражено', better: null },
  { key: 'partial', name: 'Частково уражено', better: null },
  { key: 'miss', name: 'Не уражено', better: null },
];

export function buildStrikesSlide(group, options = {}) {
  const strikes = group.strikes;
  const config = options.config;
  const records = strikes.records;
  const dataFrom = firstStrikeDate(strikes);
  const anchor = lastStrikeDate(strikes);
  const title = `${group.title} · останні 30 діб`;
  if (!records.length) {
    return { id: `group:${group.id}`, status: 'no_source', title, message: `У таблиці ${group.title} немає жодного запису з розпізнаною датою.` };
  }
  const range = rollingRange(anchor, 30);
  const prevRange = { from: isoFromDay(dayNumber(range.from) - 30), to: isoFromDay(dayNumber(range.from) - 1) };
  const prevComplete = prevRange.from >= dataFrom;
  const current = records.filter(r => inRange(r, range));
  const previous = records.filter(r => inRange(r, prevRange));
  const now = strikeStats(current);
  const before = strikeStats(previous);
  const { bucket, list } = buckets(range);
  const inBucket = b => current.filter(r => r.date >= b.from && r.date <= b.to);

  // Плитки: лічильники та ефективність (у п.п.).
  const counts = COUNT_DEFS.map(def => ({ key: def.key, label: def.name, total: now[def.key], previous: before[def.key], delta: now[def.key] - before[def.key], deltaPercent: before[def.key] ? (now[def.key] - before[def.key]) / before[def.key] * 100 : null, better: def.better }));
  const effReliable = prevComplete && now.evaluated >= config.minBase && before.evaluated >= config.minBase && now.overall != null && before.overall != null;
  const effDelta = now.overall != null && before.overall != null ? now.overall - before.overall : null;
  const effTile = {
    key: 'effect', name: 'Ефективність, %', total: now.overall, previous: before.overall, delta: effDelta, deltaPercent: effReliable ? effDelta : null,
    reliable: effReliable, better: 'up', totalText: now.overall == null ? '—' : formatNumber(now.overall),
    deltaText: effDelta == null ? '' : effReliable ? ppText(effDelta) : `${ppText(effDelta)} (мала база)`,
  };
  // Без повного попереднього відрізка порівняння на плитках не показуємо.
  const view = k => (prevComplete ? k : { ...k, previous: null, delta: null, deltaPercent: null });
  if (!prevComplete) Object.assign(effTile, { previous: null, delta: null, deltaPercent: null, deltaText: '' });
  const tiles = [tileFor(view(counts[0]), prevComplete, config, counts[0].label), tileFor(view(counts[1]), prevComplete, config, counts[1].label), effTile, ...counts.slice(2).map(k => tileFor(view(k), prevComplete, config, k.label))];

  const changes = [];
  const attention = [];
  if (!prevComplete) {
    attention.push({ severity: 80, text: `Попередній відрізок (${periodText(prevRange)}) починається раніше за перший запис таблиці ${group.title}: відсотки змін не рахуємо.` });
  } else {
    for (const k of counts) {
      if (k.previous >= config.minBase) {
        if (Math.abs(k.deltaPercent) >= config.changePercent) changes.push({ severity: Math.abs(k.deltaPercent), text: `${k.label}: ${formatNumber(k.total)} проти ${formatNumber(k.previous)} (${formatPercent(k.deltaPercent)}).` });
      } else if (k.delta !== 0) {
        changes.push({ severity: 20 + Math.abs(k.delta), text: `${k.label}: ${formatNumber(k.total)} проти ${formatNumber(k.previous)} (${signed(k.delta)}, база менша за ${config.minBase}).` });
      }
    }
    if (effReliable && Math.abs(effDelta) >= config.structureShiftPp) {
      changes.push({ severity: 1000 + Math.abs(effDelta), text: `Ефективність: ${formatNumber(now.overall)}${NBSP}% проти ${formatNumber(before.overall)}${NBSP}% (${ppText(effDelta)}; оцінено ${formatNumber(now.evaluated)} проти ${formatNumber(before.evaluated)}).` });
    }
  }

  // Концентрація за «В інтересах».
  const byUnit = tally(current, r => r.unit);
  if (byUnit.length >= 2 && current.length >= config.minBase && byUnit[0].total / current.length >= config.concentrationShare) {
    attention.push({ severity: byUnit[0].total / current.length * 40, text: `Завдання в інтересах ${byUnit[0].name} — ${share(byUnit[0].total, current.length)} (${formatNumber(byUnit[0].total)} з ${formatNumber(current.length)}).` });
  }
  // Пік завдань за добу.
  if (bucket === 'day') {
    const peak = peakOf(list.map(b => ({ from: b.from, value: inBucket(b).length })), { ...config, minBase: Math.min(config.minBase, 3) });
    if (peak) attention.push({ severity: 65, text: `Завдань за добу: пік ${longDate(peak.date)} — ${formatNumber(peak.value)} при типовому не більше ${formatNumber(peak.fence)}.` });
  }
  if (now.aborted) attention.push({ severity: 55, text: `Відбій: ${formatNumber(now.aborted)} із ${formatNumber(now.total)} завдань не входять в оцінку ефективності.` });
  if (!current.length) attention.push({ severity: 85, text: `За останні 30 діб у таблиці ${group.title} немає жодного завдання.` });
  if (current.length && current.length < config.minBase) attention.push({ severity: 30, text: `Мала вибірка (${formatNumber(current.length)} завдань): відсотки ненадійні.` });

  // Факти замість припущень: причини, цілі, боєприпаси.
  const reasons = tally(current, r => r.reasons);
  const withReason = current.filter(r => r.reasons.length).length;
  const facts = [];
  facts.push(reasons.length
    ? `Причини невдач (у ${formatNumber(withReason)} із ${formatNumber(current.length)} завдань): ${reasons.slice(0, 3).map(i => `${i.name} — ${formatNumber(i.total)}`).join(', ')}.`
    : 'Причини невдач у записах за період не вказано.');
  const types = tally(current, r => r.types);
  facts.push(types.length ? `Цілі: ${listText(types)}.` : 'Типи цілей за період не вказано.');
  const munitions = tally(current, r => r.munition, r => r.count);
  facts.push(munitions.length ? `Боєприпаси (шт.): ${listText(munitions)}.` : 'Боєприпаси за період не вказано.');

  const top = items => items.sort((a, b) => b.severity - a.severity).slice(0, config.maxItems).map(({ text }) => ({ text }));
  const categories = list.map(b => (bucket === 'day' ? chartDay(b.from) : `${shortDate(b.from)}–${shortDate(b.to)}`));
  const count = (rs, result) => rs.filter(r => !r.aborted && r.result === result).length;
  const charts = [{
    id: 'strike-results', title: 'Завдання за результатом', bucket, categories, grouping: 'stacked',
    series: [['Уражено', 'hit'], ['Частково', 'partial'], ['Не уражено', 'miss'], ['Не розпізнано', 'unknown']]
      .map(([name, result]) => ({ name, values: list.map(b => count(inBucket(b), result)) })).filter(s => s.name !== 'Не розпізнано' || s.values.some(Boolean)),
  }];
  const second = reasons.length ? { id: 'strike-reasons', title: 'Причини невдач (випадків)', items: reasons } : types.length ? { id: 'strike-types', title: 'Типи цілей (згадок)', items: types } : null;
  if (second) charts.push({ id: second.id, title: second.title, horizontal: true, categories: second.items.slice(0, 6).map(i => i.name), series: [{ name: 'Випадків', values: second.items.slice(0, 6).map(i => i.total) }] });

  const strip = `Ефективність DPI: ${now.dpi == null ? '—' : `${formatNumber(now.dpi)}${NBSP}%`}  ·  ${group.strikes.weaponLabel === 'Тип ПУ' ? 'ПУ' : 'ЛА'}: ${listText(tally(current, r => r.weapon))}  ·  Останній запис таблиці: ${longDate(anchor)}`;
  return {
    id: `group:${group.id}`,
    status: 'ready',
    title,
    heading: group.heading || title,
    theme: group.id === 'ps' ? 'ps' : group.id === 'rvia' ? 'rvia' : 'dshv',
    thirdTitle: 'Головні факти за даними таблиці',
    strip,
    period: { from: range.from, to: range.to, days: daysIn(range).length, activeDays: new Set(current.map(r => r.date)).size, text: periodText(range) },
    previous: { from: prevRange.from, to: prevRange.to, text: periodText(prevRange), covered: prevComplete ? 30 : 0, days: 30, complete: prevComplete },
    tiles,
    charts,
    changes: top(changes),
    attention: top(attention),
    hypotheses: facts.map(text => ({ text })),
    ownCallout: null,
    scope: { label: group.title, source: 'strikes_table' },
    notes: [],
  };
}
