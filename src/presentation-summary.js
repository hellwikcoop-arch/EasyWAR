/* Підсумкові блоки слайдів періодів замість «Можливих причин»:
   тиждень → тенденція «тиждень до місяця» (вгору/вниз), місяць → висновок за місяць, весь період → узагальнення.
   Лише факти з таблиці й порівняння темпів; пояснень причин тут немає. */
import { NBSP, formatNumber, formatPercent } from './presentation-format.js';

const ARROW = { up: '▲ вгору', down: '▼ вниз', flat: '● без суттєвих змін' };
const dirOf = (percent, threshold) => (percent >= threshold ? 'up' : percent <= -threshold ? 'down' : 'flat');
const perDay = (kpi, days) => (kpi.key === 'ammoPerTarget' ? kpi.total : kpi.total / days);
const unit = kpi => (kpi.key === 'ammoPerTarget' ? '' : `${NBSP}/${NBSP}добу`);

function leadUnit(model, config, names) {
  const active = (model.units || []).filter(u => u.days > 0);
  const sum = active.reduce((s, u) => s + (u.ammo || 0), 0);
  if (active.length < 2 || sum < config.minBase) return null;
  const top = active.reduce((a, u) => ((u.ammo || 0) > (a.ammo || 0) ? u : a));
  return { text: `${names.ammo}: найбільше в ${top.unit} — ${formatNumber((top.ammo / sum) * 100)}${NBSP}% (${formatNumber(top.ammo)} з ${formatNumber(sum)}).` };
}

/** Тенденція: темп за 7 діб проти темпу за 30 діб (на добу), напрямок вгору/вниз. */
export function weekTrend({ week, month, keys, names, config }) {
  const threshold = config.trendPercent;
  const rows = [];
  for (const key of keys) {
    const w = week.kpis.find(k => k.key === key), m = month.kpis.find(k => k.key === key);
    if (!w || !m || w.total == null || m.total == null) continue;
    const ratio = key === 'ammoPerTarget';
    if (ratio ? !(w.base >= config.minBase && m.base >= config.minBase) : m.total < config.minBase) continue;
    const rw = perDay(w, week.days), rm = perDay(m, month.days);
    if (!(rm > 0)) continue;
    const percent = ((rw - rm) / rm) * 100;
    rows.push({ key, percent, direction: dirOf(percent, threshold), text: `${names[key] || m.label}: ${formatNumber(rw)}${unit(w)} за тиждень проти ${formatNumber(rm)}${unit(w)} за місяць (${formatPercent(percent)})` });
  }
  const head = rows.find(r => r.key === 'affected');
  const items = [];
  if (head) items.push({ text: `Загалом ${ARROW[head.direction]}. ${head.text}.` });
  const moves = rows.filter(r => r.key !== 'affected' && r.direction !== 'flat').sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent)).slice(0, config.maxItems);
  for (const r of moves) {
    const better = r.key === 'ammoPerTarget' ? (r.direction === 'down' ? ', краще' : ', гірше') : '';
    items.push({ text: `${ARROW[r.direction].slice(0, 1)} ${r.text}${better}.` });
  }
  if (!moves.length) items.push({ text: `Суттєвих відхилень темпу за тиждень від місяця немає (поріг ±${config.trendPercent}${NBSP}%).` });
  return { title: 'Тенденція: тиждень до місяця', items };
}

/** Висновок за місяць (або обраний період): результат, ефективність, найбільший підрозділ за БК. */
export function periodVerdict({ model, names, config, title }) {
  const find = key => model.kpis.find(k => k.key === key);
  const affected = find('affected'), kia = find('kia'), eff = find('ammoPerTarget'), ammo = find('ammo');
  const threshold = config.trendPercent;
  const items = [];
  const resultDir = affected && affected.deltaPercent != null && affected.previous >= config.minBase ? dirOf(affected.deltaPercent, threshold) : null;
  const effDir = eff && eff.deltaPercent != null && eff.base >= config.minBase && eff.previousBase >= config.minBase ? dirOf(-eff.deltaPercent, threshold) : null;
  if (resultDir || effDir) {
    const result = resultDir ? `результат ${{ up: 'зріс', down: 'знизився', flat: 'без суттєвих змін' }[resultDir]} (${formatPercent(affected.deltaPercent)})` : null;
    const effect = effDir ? `ефективність ${{ up: 'покращилась', down: 'погіршилась', flat: 'без суттєвих змін' }[effDir]} (${formatPercent(eff.deltaPercent)} БК на одиницю)` : null;
    items.push({ text: `Висновок: ${[result, effect].filter(Boolean).join(', ')}.` });
  }
  if (kia && affected) {
    const part = (k, label) => (k.previous != null ? `${label} — ${formatNumber(k.total)} проти ${formatNumber(k.previous)}` : `${label} — ${formatNumber(k.total)}`);
    items.push({ text: `${part(kia, names.kia)}; ${part(affected, 'уражено цілей (ОВТ + об’єкти)')}.` });
  }
  if (eff && eff.total != null && ammo) {
    items.push({ text: `${names.ammoPerTarget}: ${formatNumber(eff.total)}${eff.previous != null ? ` проти ${formatNumber(eff.previous)}` : ''}; витрата БК — ${formatNumber(ammo.total)}${ammo.previous != null ? ` проти ${formatNumber(ammo.previous)}` : ''}.` });
  }
  const lead = leadUnit(model, config, names);
  if (lead) items.push(lead);
  return { title: title || 'Висновок за місяць', items: items.slice(0, config.maxItems + 1) };
}

/** Узагальнення за весь період: підсумки, ефективність, темп останніх 30 діб до середнього. */
export function wholePeriodSummary({ model, pace, names, config }) {
  const find = key => model.kpis.find(k => k.key === key);
  const kia = find('kia'), wia = find('wia'), affected = find('affected'), eff = find('ammoPerTarget'), ammo = find('ammo');
  const items = [];
  if (kia && affected && ammo) items.push({ text: `За ${model.days} діб: о/с (200) — ${formatNumber(kia.total)}${wia ? `, (300) — ${formatNumber(wia.total)}` : ''}; уражено цілей — ${formatNumber(affected.total)}; витрата БК — ${formatNumber(ammo.total)}.` });
  if (eff && eff.total != null) items.push({ text: `Ефективність за період: ${formatNumber(eff.total)} БК на одиницю ураженого.` });
  const row = pace && pace.find(r => r.key === 'affected');
  if (row) {
    const dir = dirOf(row.percent, config.trendPercent);
    items.push({ text: `Тенденція: останні 30 діб — ${ARROW[dir]}. Уражено цілей ${formatNumber(row.recent)}${NBSP}/${NBSP}добу проти ${formatNumber(row.overall)}${NBSP}/${NBSP}добу в середньому за період (${formatPercent(row.percent)}).` });
  }
  const lead = leadUnit(model, config, names);
  if (lead) items.push(lead);
  return { title: 'Узагальнення за весь період', items: items.slice(0, config.maxItems + 1) };
}
