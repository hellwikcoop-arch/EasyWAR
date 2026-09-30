/* Презентація аналітики УДШВ: чисте ядро без DOM.
   Будує «модель колоди» (JSON) з таблиці УДШВ: титул, 7 діб, 30 діб, весь період
   або власний період. Висновки — детермінований рушій правил: кожне речення
   містить числа з даних, мовної моделі немає. Рендерер PPTX лише малює цю модель. */

import {
  allDateRange,
  createDashboardModel,
  daysOf,
  groupIssues,
  lastActiveDate,
  previousRange,
  validateWorkbook,
} from './udshv-dashboard-core.js';

export const DECK_SCHEMA_VERSION = 1;

/** Пороги. Змінюються через options.config, у коді не «зашиті» у правила. */
export const DEFAULT_CONFIG = {
  changePercent: 20, // |Δ| від, %
  minBase: 10, // менша база — відсотки не рахуємо
  structureShiftPp: 5, // зсув частки знищеного, п.п.
  concentrationShare: 0.6, // частка одного підрозділу/засобу
  anomalyMinDays: 7, // мінімум днів історії для пошуку піків
  anomalyIqrFactor: 1.5,
  paceMinDays: 60, // мінімум днів для слайда «весь період»
  maxItems: 3, // на блок слайда
};

/** Показники плиток (до 6). Повний набір KPI береться для пошуку змін. */
const TILE_KEYS = ['kia', 'wia', 'destroyed', 'damaged', 'ammo', 'vgz'];
const CHANGE_KEYS = ['kia', 'wia', 'destroyed', 'damaged', 'suppressed', 'ammo', 'vgz', 'kbb'];
const KPI_NAMES = {
  kia: 'Знищено о/с (200)',
  wia: 'Поранено о/с (300)',
  personnel: 'Втрати о/с разом',
  destroyed: 'ОВТ знищено',
  damaged: 'ОВТ пошкоджено',
  suppressed: 'ОВТ подавлено',
  ammo: 'Витрата БК',
  vgz: 'ВгЗ',
  kbb: 'КББ',
};
const KPI_DOMAIN = { kia: 'personnel', wia: 'personnel', personnel: 'personnel', destroyed: 'ovt', damaged: 'ovt', suppressed: 'ovt', ammo: 'ammo', vgz: 'fire', kbb: 'fire' };

/**
 * Каталог «сигнал → можливі причини». Це стартова редакція для правки
 * користувачем. Кожна причина виводиться з позначкою «гіпотеза».
 * signal: change | peak | gap | concentration | structure | coverage.
 */
export const HYPOTHESES = [
  { signal: 'change', direction: 'up', domain: 'ammo', text: 'вищий темп робіт або більше цілей; перевірити разом із кількістю ВгЗ' },
  { signal: 'change', direction: 'down', domain: 'ammo', text: 'менша кількість завдань або обмеження із забезпеченням; перевірити внесення даних' },
  { signal: 'change', direction: 'up', domain: 'fire', text: 'більше завдань у зоні відповідальності або зміна складу засобів' },
  { signal: 'change', direction: 'down', domain: 'fire', text: 'менше завдань, ротація або перерва у роботі засобів' },
  { signal: 'change', direction: 'up', domain: 'ovt', text: 'краща розвідка цілей, вища результативність або більше завдань' },
  { signal: 'change', direction: 'down', domain: 'ovt', text: 'менше цілей, гірша розвідка, протидія противника або неповний облік' },
  { signal: 'change', direction: 'up', domain: 'personnel', text: 'вища інтенсивність бойових дій або краща підтвердженість втрат' },
  { signal: 'change', direction: 'down', domain: 'personnel', text: 'нижча інтенсивність, гірша підтвердженість втрат або запізніле внесення' },
  { signal: 'peak', direction: '*', domain: '*', text: 'разова операція або накопичена звітність, внесена одним днем' },
  { signal: 'gap', direction: '*', domain: '*', text: 'дані не внесено вчасно або активності не було; перевірити джерело' },
  { signal: 'concentration', direction: '*', domain: '*', text: 'навантаження зосереджене на одному підрозділі або засобі; перевірити розподіл завдань' },
  { signal: 'structure', direction: 'up', domain: 'ovt', text: 'більше прямих влучань або змінився тип цілей' },
  { signal: 'structure', direction: 'down', domain: 'ovt', text: 'менше прямих влучань або змінився тип цілей' },
  { signal: 'coverage', direction: '*', domain: '*', text: 'порівняння з попереднім відрізком неповне, бо даних за нього менше' },
];

/* ------------------------------ дати ------------------------------ */

const dayNumber = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
};
const isoFromDay = n => new Date(n * 864e5).toISOString().slice(0, 10);
const shortDate = iso => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}.${m[1]}` : ''; };
const longDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const periodText = range => `${longDate(range.from)} – ${longDate(range.to)}`;

/** Останні N діб із включенням якірної дати. */
export function rollingRange(anchor, days) {
  const end = dayNumber(anchor);
  if (!Number.isFinite(end) || !(days >= 1)) return { from: '', to: '' };
  return { from: isoFromDay(end - days + 1), to: isoFromDay(end) };
}

/* ------------------------------ форматування ------------------------------ */

const NBSP = ' ';
export function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
export function formatPercent(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value))}${NBSP}%`;
}
export function daysWord(n) {
  const abs = Math.abs(n) % 100, last = abs % 10;
  if (abs > 10 && abs < 20) return 'діб';
  return last === 1 ? 'доба' : last >= 2 && last <= 4 ? 'доби' : 'діб';
}
const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + formatNumber(Math.abs(value));

/* ------------------------------ періоди колоди ------------------------------ */

/**
 * Визначає слайди-періоди. Якір — остання активна дата в даних, а не сьогодні.
 * Стандартна колода: 7 діб, 30 діб, весь період. Власний період: один слайд
 * за обраний діапазон із порівнянням із попереднім відрізком тієї самої довжини.
 */
export function deckPeriods(workbook, options = {}) {
  const all = allDateRange(workbook);
  const anchor = options.anchor || lastActiveDate(workbook);
  const custom = options.custom;
  if (custom && custom.from && custom.to) {
    const range = custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
    return [{ id: 'custom', title: 'Обраний період', kind: 'window', range }];
  }
  return [
    { id: 'week', title: 'Останні 7 діб', kind: 'window', range: rollingRange(anchor, 7) },
    { id: 'month', title: 'Останні 30 діб', kind: 'window', range: rollingRange(anchor, 30) },
    { id: 'all', title: 'Весь період', kind: 'all', range: all },
  ];
}

/* ------------------------------ статистика ------------------------------ */

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos), high = Math.ceil(pos);
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

/** Пік: день, що перевищує верхню межу IQR власної історії періоду. */
export function findPeak(points, config = DEFAULT_CONFIG) {
  const values = points.map(p => p.value);
  if (values.length < config.anomalyMinDays) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  const fence = q3 + config.anomalyIqrFactor * (q3 - q1);
  let best = null;
  for (const p of points) if (p.value > fence && p.value >= config.minBase && (!best || p.value > best.value)) best = p;
  return best ? { date: best.from, value: best.value, fence } : null;
}

const total = (records, predicate) => records.reduce((sum, r) => sum + Object.entries(r.values).filter(([id]) => predicate(id)).reduce((s, [, v]) => s + v, 0), 0);

/* ------------------------------ вікно періоду ------------------------------ */

function coverageOf(range, dataRange) {
  const days = daysOf(range);
  const present = days.filter(d => d >= dataRange.from && d <= dataRange.to).length;
  return { days: days.length, covered: present, complete: days.length > 0 && present === days.length };
}

function tileFor(kpi, prevComplete, config) {
  const hasPrev = kpi.previous != null;
  const reliable = hasPrev && prevComplete && kpi.previous >= config.minBase;
  return {
    key: kpi.key,
    name: KPI_NAMES[kpi.key] || kpi.label,
    total: kpi.total,
    previous: kpi.previous,
    delta: kpi.delta,
    deltaPercent: reliable ? kpi.deltaPercent : null,
    reliable,
    totalText: formatNumber(kpi.total),
    deltaText: hasPrev ? (reliable ? formatPercent(kpi.deltaPercent) : `${signed(kpi.delta)} (мала база)`) : '',
  };
}

function chartFor(model) {
  const categories = model.personnelSeries.map(p => (model.bucket === 'day' ? shortDate(p.from) : `${shortDate(p.from)}–${shortDate(p.to)}`));
  return {
    type: 'bar',
    bucket: model.bucket,
    categories,
    series: [
      { name: 'Втрати о/с (200 + 300)', values: model.personnelSeries.map(p => p.value.kia + p.value.wia) },
      { name: 'ОВТ знищено + пошкоджено', values: model.ovtSeries.map(p => p.value.destroyed + p.value.damaged) },
    ],
  };
}

function pick(domain, signal, direction) {
  return HYPOTHESES.filter(h => h.signal === signal && (h.direction === direction || h.direction === '*') && (h.domain === domain || h.domain === '*'));
}

/* ------------------------------ рушій висновків ------------------------------ */

/**
 * Повертає { changes, attention, hypotheses }. Кожен елемент: { text, severity }.
 * severity впорядковує, але не показується. Блок максимум config.maxItems рядків.
 */
export function analyzeWindow(model, context, config = DEFAULT_CONFIG) {
  const changes = [];
  const attention = [];
  const signals = []; // для гіпотез: { signal, direction, domain, label, severity }
  const kpi = key => model.kpis.find(k => k.key === key);
  const prevComplete = context.previousCoverage ? context.previousCoverage.complete : false;

  if (context.kind === 'window') {
    if (!model.hasPrevious || !prevComplete) {
      const c = context.previousCoverage;
      attention.push({ severity: 80, text: c && c.days ? `Попередній відрізок (${periodText(model.previousRange)}) охоплений даними на ${c.covered} із ${c.days} діб: відсотки змін не рахуємо.` : 'Немає даних за попередній відрізок: порівняння неможливе.' });
      signals.push({ signal: 'coverage', direction: '*', domain: '*', severity: 50, label: 'Порівняння неповне' });
    } else {
      const small = [];
      for (const key of CHANGE_KEYS) {
        const k = kpi(key);
        if (!k || k.previous == null) continue;
        if (k.previous < config.minBase) { if (k.total !== k.previous) small.push(KPI_NAMES[key]); continue; }
        const pct = k.deltaPercent;
        if (pct != null && Math.abs(pct) >= config.changePercent) {
          changes.push({
            severity: Math.abs(pct), key,
            text: `${KPI_NAMES[key]}: ${formatNumber(k.total)} проти ${formatNumber(k.previous)} (${formatPercent(pct)}).`,
          });
          signals.push({ signal: 'change', direction: pct > 0 ? 'up' : 'down', domain: KPI_DOMAIN[key], severity: Math.abs(pct), label: KPI_NAMES[key] });
        }
      }
      if (small.length) attention.push({ severity: 10, text: `Мала база (< ${config.minBase}), відсотків немає: ${small.join(', ')}.` });
    }
  } else if (context.pace) {
    for (const row of context.pace) {
      if (Math.abs(row.percent) < config.changePercent) continue;
      changes.push({ severity: Math.abs(row.percent), key: row.key, text: `${KPI_NAMES[row.key]}: ${formatNumber(row.recent)} на добу за останні 30 діб проти ${formatNumber(row.overall)} за весь період (${formatPercent(row.percent)}).` });
      signals.push({ signal: 'change', direction: row.percent > 0 ? 'up' : 'down', domain: KPI_DOMAIN[row.key], severity: Math.abs(row.percent), label: KPI_NAMES[row.key] });
    }
  }

  // Структура: частка знищеного серед знищеного і пошкодженого.
  const dNow = kpi('destroyed'), gNow = kpi('damaged');
  if (context.kind === 'window' && dNow && gNow && dNow.previous != null && gNow.previous != null && prevComplete) {
    const nowBase = dNow.total + gNow.total, prevBase = dNow.previous + gNow.previous;
    if (nowBase >= config.minBase && prevBase >= config.minBase) {
      const now = dNow.total / nowBase * 100, before = dNow.previous / prevBase * 100;
      if (Math.abs(now - before) >= config.structureShiftPp) {
        changes.push({ severity: Math.abs(now - before), text: `Частка знищеного серед знищеного та пошкодженого ОВТ: ${formatNumber(now)}${NBSP}% проти ${formatNumber(before)}${NBSP}% (${formatNumber(dNow.total)} з ${formatNumber(nowBase)} проти ${formatNumber(dNow.previous)} з ${formatNumber(prevBase)}).` });
        signals.push({ signal: 'structure', direction: now > before ? 'up' : 'down', domain: 'ovt', severity: Math.abs(now - before), label: 'Структура уражень' });
      }
    }
  }

  // Концентрація за підрозділами.
  const activeUnits = model.units.filter(u => u.days > 0);
  if (activeUnits.length >= 2) {
    for (const [key, label] of [['ammo', 'Витрата БК'], ['destroyed', 'ОВТ знищено'], ['kia', 'Знищено о/с (200)']]) {
      const sum = activeUnits.reduce((s, u) => s + (u[key] || 0), 0);
      if (sum < config.minBase) continue;
      const top = activeUnits.reduce((a, u) => ((u[key] || 0) > (a[key] || 0) ? u : a));
      const share = top[key] / sum;
      if (share >= config.concentrationShare) {
        attention.push({ severity: share * 40, text: `${label}: ${top.unit} дає ${formatNumber(share * 100)}${NBSP}% (${formatNumber(top[key])} з ${formatNumber(sum)}).` });
        signals.push({ signal: 'concentration', direction: '*', domain: KPI_DOMAIN[key], severity: share * 40, label: `${label}: ${top.unit}` });
      }
    }
  }

  // Концентрація за засобом у групі боєприпасів.
  const ammoItems = (model.groups.ammo || []).filter(i => i.name !== 'ВСЬОГО');
  const ammoSum = ammoItems.reduce((s, i) => s + i.total, 0);
  if (ammoItems.length >= 2 && ammoSum >= config.minBase && ammoItems[0].total / ammoSum >= config.concentrationShare) {
    const top = ammoItems[0];
    attention.push({ severity: top.total / ammoSum * 30, text: `Боєприпаси: ${top.name} — ${formatNumber(top.total / ammoSum * 100)}${NBSP}% (${formatNumber(top.total)} з ${formatNumber(ammoSum)}).` });
  }

  // Піки за добовими рядами.
  if (model.bucket === 'day') {
    for (const key of ['ammo', 'kia', 'destroyed']) {
      const k = kpi(key);
      const peak = k && findPeak(k.series, config);
      if (peak) {
        attention.push({ severity: 65, text: `${KPI_NAMES[key]}: пік ${longDate(peak.date)} — ${formatNumber(peak.value)} при типовому не більше ${formatNumber(peak.fence)}.` });
        signals.push({ signal: 'peak', direction: '*', domain: KPI_DOMAIN[key], severity: 65, label: `Пік: ${KPI_NAMES[key]}` });
      }
    }
  }

  // Пропуски.
  const silent = model.days - model.activeDays;
  if (silent > 0) {
    attention.push({ severity: 60 + silent, text: `${silent} із ${model.days} діб без жодного ненульового показника: результат може бути занижений.` });
    signals.push({ signal: 'gap', direction: '*', domain: '*', severity: 60, label: `${silent} ${daysWord(silent)} без даних` });
  }
  if (context.missingDays) attention.push({ severity: 70, text: `Без жодного рядка в таблиці: ${context.missingDays} ${daysWord(context.missingDays)} періоду.` });

  const top = list => list.sort((a, b) => b.severity - a.severity).slice(0, config.maxItems).map(({ text }) => ({ text }));

  const hypotheses = [];
  const seen = new Set();
  for (const s of [...signals].sort((a, b) => b.severity - a.severity)) {
    for (const h of pick(s.domain, s.signal, s.direction).slice(0, 1)) {
      const text = `${s.label}: ${h.text}`;
      if (!seen.has(text)) { seen.add(text); hypotheses.push({ text, flag: 'гіпотеза, потребує перевірки' }); }
    }
    if (hypotheses.length >= config.maxItems) break;
  }

  return { changes: top(changes), attention: top(attention), hypotheses: hypotheses.slice(0, config.maxItems) };
}

/* ------------------------------ колода ------------------------------ */

function paceRows(workbook, units, anchor, range, config) {
  const days = daysOf(range).length;
  if (days < config.paceMinDays) return null;
  const recentRange = rollingRange(anchor, 30);
  const whole = createDashboardModel(workbook, { range, unit: units, preset: 'custom' });
  const recent = createDashboardModel(workbook, { range: recentRange, unit: units, preset: 'custom' });
  const rows = [];
  for (const key of CHANGE_KEYS) {
    const all = whole.kpis.find(k => k.key === key), now = recent.kpis.find(k => k.key === key);
    const overall = all.total / days, recentPace = now.total / 30;
    if (all.total < config.minBase || overall <= 0) continue;
    rows.push({ key, overall, recent: recentPace, percent: (recentPace - overall) / overall * 100 });
  }
  return rows;
}

function windowSlide(workbook, period, units, anchor, config, issues) {
  const all = allDateRange(workbook);
  const range = period.range;
  const model = createDashboardModel(workbook, { range, unit: units, preset: 'custom' });
  const prevRange = period.kind === 'window' ? previousRange(range) : { from: '', to: '' };
  const previousCoverage = period.kind === 'window' ? coverageOf(prevRange, all) : null;
  const prevComplete = previousCoverage ? previousCoverage.complete : false;
  const missingDays = issues.filter(i => i.type === 'missing-date' && i.raw >= range.from && i.raw <= range.to).length;
  const pace = period.kind === 'all' ? paceRows(workbook, units, anchor, range, config) : null;
  const insights = analyzeWindow(model, { kind: period.kind, previousCoverage, pace, missingDays }, config);
  const rangeCoverage = coverageOf(range, all);
  const notes = [];
  if (!rangeCoverage.complete) notes.push(`Дані охоплюють ${rangeCoverage.covered} із ${rangeCoverage.days} діб обраного періоду.`);
  return {
    id: period.id,
    title: period.title,
    period: { from: range.from, to: range.to, days: model.days, activeDays: model.activeDays, text: periodText(range) },
    previous: period.kind === 'window' ? { from: prevRange.from, to: prevRange.to, text: periodText(prevRange), covered: previousCoverage.covered, days: previousCoverage.days, complete: prevComplete } : null,
    tiles: TILE_KEYS.map(key => tileFor(model.kpis.find(k => k.key === key), prevComplete, config)),
    chart: chartFor(model),
    changes: insights.changes,
    attention: insights.attention,
    hypotheses: insights.hypotheses,
    notes,
  };
}

/** Модель колоди: title + слайди періодів. Однакові вхідні дані дають однаковий результат. */
export function buildDeck(workbook, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
  const units = options.units || [];
  const anchor = options.anchor || lastActiveDate(workbook);
  const all = allDateRange(workbook);
  const issues = validateWorkbook(workbook);
  const periods = deckPeriods(workbook, { anchor, custom: options.custom });
  const slides = periods.map(period => windowSlide(workbook, period, units, anchor, config, issues));
  const quality = {
    issueCount: issues.length,
    groups: groupIssues(issues).slice(0, 3).map(g => ({ text: g.text, count: g.items.length })),
  };
  const titleModel = createDashboardModel(workbook, { range: all, unit: units, preset: 'custom' });
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    kind: 'udshv_deck',
    config,
    slides: [{
      id: 'title',
      title: 'Аналітика',
      owner: options.owner || '',
      marking: options.marking || '',
      source: workbook.sourceName || '',
      units: units.length ? units : workbook.units,
      dataRange: { from: all.from, to: all.to, text: periodText(all), days: titleModel.days, activeDays: titleModel.activeDays },
      anchor,
      generatedOn: options.generatedOn || '',
      quality,
    }, ...slides],
  };
}

