/* Презентація аналітики УДШВ: чисте ядро без DOM.
   Будує «модель колоди» (JSON) з таблиці УДШВ: титул, 7 діб, 30 діб, весь період
   або власний період. Висновки — детермінований рушій правил: кожне речення
   містить числа з даних, мовної моделі немає. Рендерер PPTX лише малює цю модель. */

import {
  allDateRange,
  createDashboardModel,
  daysOf,
  inRange,
  lastActiveDate,
  seriesFor,
  previousRange,
  validateWorkbook,
} from './udshv-dashboard-core.js';

import { buildStrikesSlide } from './presentation-strikes.js';
import { annotationOf, artilleryPies, targetTypeChart } from './presentation-udshv-extra.js';
import { buildOwnLossesSlide, ownLossesInRange } from './presentation-own-losses.js';
import { periodVerdict, weekTrend, wholePeriodSummary } from './presentation-summary.js';
import { NBSP, daysAcc, dayNumber, peakOf, tileFor as buildTile, daysWord, formatNumber, formatPercent, isoFromDay, longDate, periodText, rollingRange, chartDay, shortDate, signed } from './presentation-format.js';

export { daysWord, formatNumber, formatPercent, rollingRange };

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
  trendPercent: 10, // |Δ| від, % для напрямку «вгору/вниз» у підсумкових блоках
  focus: 'all', // 'result' | 'efficiency' | 'all'
  // Назви стовпців груп ЗНИЩЕНО/ПОШКОДЖЕНО/ПОДАВЛЕНО, які є об'єктами, а не технікою (ОВТ).
  // Усе, що не збігається, вважається технікою. Шаблони — регулярні вирази без урахування регістру.
  objectPatterns: ['склад', 'переправ', 'рембаз', 'будівл', '(^|[ ,])(кп|ксп|пу)([ ,]|$)'],
};

/** Показники плиток (до 6). Повний набір KPI береться для пошуку змін. */
export const FOCUS_LABELS = { result: 'Результат', efficiency: 'Ефективність', all: 'Результат і ефективність' };
const TILE_SETS = {
  result: ['kia', 'wia', 'ovtDestroyed', 'ovtDamaged', 'objDestroyed', 'objDamaged'],
  efficiency: ['ammoPerTarget', 'ammo', 'affected', 'vgz', 'kbb'],
  all: ['ammoPerTarget', 'kia', 'wia', 'ovtDestroyed', 'ovtDamaged', 'objDestroyed', 'objDamaged', 'ammo'],
};
// Слайди груп усередині колоди УДШВ лишаються на шести плитках.
const GROUP_TILE_SETS = { ...TILE_SETS, all: ['ammoPerTarget', 'kia', 'wia', 'ovtDestroyed', 'objDestroyed', 'ammo'] };
const TILE_POOL = ['affected', 'objDestroyed', 'objDamaged', 'ovtDestroyed', 'ovtDamaged', 'objSuppressed', 'ovtSuppressed', 'kia', 'wia', 'ammo', 'vgz', 'kbb'];
const FOCUS_DOMAINS = { result: ['personnel', 'ovt', 'objects'], efficiency: ['efficiency', 'ammo', 'fire'], all: [] };
const CHANGE_KEYS = ['kia', 'wia', 'ovtDestroyed', 'ovtDamaged', 'ovtSuppressed', 'objDestroyed', 'objDamaged', 'objSuppressed', 'affected', 'ammo', 'vgz', 'kbb'];
const KPI_NAMES = {
  kia: 'Противник: знищено о/с (200)',
  wia: 'Противник: поранено о/с (300)',
  personnel: 'Противник: втрати о/с разом',
  ovtDestroyed: 'Противник: ОВТ знищено',
  ovtDamaged: 'Противник: ОВТ пошкоджено',
  ovtSuppressed: 'Противник: ОВТ подавлено',
  objDestroyed: 'Противник: об’єкти знищено',
  objDamaged: 'Противник: об’єкти пошкоджено',
  objSuppressed: 'Противник: об’єкти подавлено',
  ammo: 'Витрата БК',
  affected: 'Противник: уражено (ОВТ + об’єкти)',
  ammoPerTarget: 'БК на одиницю ураженого',
  vgz: 'ВгЗ',
  kbb: 'КББ',
};
const KPI_DOMAIN = { kia: 'personnel', wia: 'personnel', personnel: 'personnel', ovtDestroyed: 'ovt', ovtDamaged: 'ovt', ovtSuppressed: 'ovt', objDestroyed: 'objects', objDamaged: 'objects', objSuppressed: 'objects', ammo: 'ammo', affected: 'result', ammoPerTarget: 'efficiency', vgz: 'fire', kbb: 'fire' };
const CLASSIFIED = [
  { key: 'ovtDestroyed', group: 'destroyed', cls: 'equipment' },
  { key: 'ovtDamaged', group: 'damaged', cls: 'equipment' },
  { key: 'ovtSuppressed', group: 'suppressed', cls: 'equipment' },
  { key: 'objDestroyed', group: 'destroyed', cls: 'object' },
  { key: 'objDamaged', group: 'damaged', cls: 'object' },
  { key: 'objSuppressed', group: 'suppressed', cls: 'object' },
];

/**
 * Каталог «сигнал → можливі причини». Це стартова редакція для правки
 * користувачем. Причини подаються коротко, без застережень у тексті слайда.
 * signal: change | peak | gap | concentration | structure | coverage.
 */
export const HYPOTHESES = [
  { signal: 'change', direction: 'up', domain: 'ammo', text: 'більше доступних боєприпасів або потрібних типів; сприятливіші умови для розвідки' },
  { signal: 'change', direction: 'down', domain: 'ammo', text: 'погода не дозволяє розвідку й дорозвідку, обмежена кількість боєприпасів або бракує потрібних типів' },
  { signal: 'change', direction: 'up', domain: 'fire', text: 'сприятливіші умови для розвідки, більше доступних боєприпасів' },
  { signal: 'change', direction: 'down', domain: 'fire', text: 'погода не дозволяє розвідку й дорозвідку, обмежені боєприпаси' },
  { signal: 'change', direction: 'up', domain: 'ovt', text: 'краща розвідка й дорозвідка, більше боєприпасів потрібних типів' },
  { signal: 'change', direction: 'down', domain: 'ovt', text: 'погода обмежила розвідку й дорозвідку, не вистачало боєприпасів або потрібних типів' },
  { signal: 'change', direction: 'up', domain: 'efficiency', text: 'тип боєприпасів не відповідав цілям або розвідка й дорозвідка були слабшими через погоду' },
  { signal: 'change', direction: 'down', domain: 'efficiency', text: 'точніша розвідка й дорозвідка, відповідні типи боєприпасів' },
  { signal: 'change', direction: 'up', domain: 'result', text: 'сприятливіша погода для розвідки, більше боєприпасів або потрібних типів' },
  { signal: 'change', direction: 'down', domain: 'result', text: 'погода обмежила розвідку й дорозвідку, бракувало боєприпасів або потрібних типів' },
  { signal: 'change', direction: 'up', domain: 'objects', text: 'більше виявлених об’єктів завдяки розвідці й дорозвідці, більше боєприпасів' },
  { signal: 'change', direction: 'down', domain: 'objects', text: 'погода обмежила розвідку й дорозвідку, не вистачало боєприпасів або потрібних типів' },
  { signal: 'change', direction: 'up', domain: 'personnel', text: 'вища інтенсивність бойових дій або більше уражень у зоні' },
  { signal: 'change', direction: 'down', domain: 'personnel', text: 'нижча інтенсивність або менше можливостей для ураження (погода, боєприпаси)' },
  { signal: 'peak', direction: '*', domain: '*', text: 'сприятливе вікно для розвідки й ураження (погода, наявні боєприпаси) або разова операція' },
  { signal: 'gap', direction: '*', domain: '*', text: 'погодні умови, відсутність розвідки або нестача боєприпасів' },
  { signal: 'concentration', direction: '*', domain: '*', text: 'навантаження зосереджене на одному підрозділі або засобі; перевірити розподіл завдань' },
  { signal: 'structure', direction: 'up', domain: 'ovt', text: 'більше прямих влучань або змінився тип цілей' },
  { signal: 'structure', direction: 'down', domain: 'ovt', text: 'менше прямих влучань або змінився тип цілей' },
  { signal: 'coverage', direction: '*', domain: '*', text: 'попередній відрізок неповно представлений у таблиці' },
];

/* ------------------------------ дати ------------------------------ */


/**
 * Діапазон даних: від першої дати з ненульовим показником до останньої активної дати.
 * Таблиця містить наперед заповнені нулі до кінця місяця й інколи випадкові дати,
 * тому діапазон усіх дат у файлі для аналізу не годиться.
 */
export function activeRange(workbook, issues = validateWorkbook(workbook)) {
  const stray = new Set(issues.filter(i => i.type === 'date-outside-month').map(i => `${i.sheet}|${i.rowNumber}`));
  const dates = (workbook?.records || []).filter(r => Object.keys(r.values).length && !stray.has(`${r.sheet}|${r.rowNumber}`)).map(r => r.date).sort();
  if (!dates.length) return allDateRange(workbook);
  return { from: dates[0], to: lastActiveDate(workbook) };
}


/* ------------------------------ форматування ------------------------------ */


/* ------------------------------ періоди колоди ------------------------------ */

/**
 * Визначає слайди-періоди. Якір — остання активна дата в даних, а не сьогодні.
 * Стандартна колода: 7 діб, 30 діб, весь період. Власний період: один слайд
 * за обраний діапазон із порівнянням із попереднім відрізком тієї самої довжини.
 */
export function deckPeriods(workbook, options = {}) {
  const all = options.dataRange || activeRange(workbook);
  const anchor = options.anchor || lastActiveDate(workbook);
  const custom = options.custom;
  if (custom && custom.from && custom.to) {
    const range = custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
    return [{ id: 'custom', title: 'Обраний період', heading: 'Аналітика за обраний період', kind: 'window', range }];
  }
  return [
    { id: 'week', title: 'Останні 7 діб', heading: 'Аналітика за тиждень', kind: 'window', range: rollingRange(anchor, 7) },
    { id: 'month', title: 'Останні 30 діб', heading: 'Аналітика за місяць', kind: 'window', range: rollingRange(anchor, 30) },
    { id: 'all', title: 'Весь період', heading: 'Аналітика за всю операцію', kind: 'all', range: all },
  ];
}

/* ------------------------------ статистика ------------------------------ */


const total = (records, predicate) => records.reduce((sum, r) => sum + Object.entries(r.values).filter(([id]) => predicate(id)).reduce((s, [, v]) => s + v, 0), 0);

/* ------------------------------ вікно періоду ------------------------------ */

function coverageOf(range, dataRange) {
  const days = daysOf(range);
  const present = days.filter(d => d >= dataRange.from && d <= dataRange.to).length;
  return { days: days.length, covered: present, complete: days.length > 0 && present === days.length };
}


const normName = value => String(value == null ? '' : value).replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');

/** 'object' для складів, переправ, пунктів управління тощо; інакше 'equipment' (ОВТ). */
export function classifyTarget(name, config = DEFAULT_CONFIG) {
  const text = normName(name);
  return (config.objectPatterns || []).some(pattern => new RegExp(pattern, 'iu').test(text)) ? 'object' : 'equipment';
}

const classSum = (records, group, cls, config) => records.reduce((sum, r) => sum + Object.entries(r.values).reduce((s, [id, v]) => (id.startsWith(`${group}|`) && classifyTarget(id.slice(group.length + 1), config) === cls ? s + v : s), 0), 0);

/** Пік за добовим рядом (обгортка з типовою конфігурацією). */
export function findPeak(points, config = DEFAULT_CONFIG) { return peakOf(points, config); }

// Підписи плиток (у тексті блоків лишаються повні назви KPI_NAMES).
const TILE_NAMES = {
  ovtDestroyed: 'Військова техніка знищено, од.',
  ovtDamaged: 'Військова техніка пошкоджено, од.',
  ovtSuppressed: 'Військова техніка подавлено, од.',
  objDestroyed: 'Знищено об’єктів противника',
  objDamaged: 'Пошкоджено об’єктів противника',
  objSuppressed: 'Подавлено об’єктів противника',
};
const tileFor = (kpi, prevComplete, config) => buildTile(kpi, prevComplete, config, TILE_NAMES[kpi.key] || KPI_NAMES[kpi.key] || kpi.label);

/** Показники з розділенням техніки й об'єктів у тій самій формі, що й KPI дашборда. */
function classifiedKpis(model, workbook, units, config) {
  const prevRecords = model.hasPrevious ? workbook.records.filter(r => (!units.length || units.includes(r.unit)) && inRange(r, model.previousRange)) : null;
  return CLASSIFIED.map(({ key, group, cls }) => {
    const value = rs => classSum(rs, group, cls, config);
    const totalNow = value(model.records);
    const before = prevRecords ? value(prevRecords) : null;
    return {
      key, label: KPI_NAMES[key], total: totalNow, previous: before,
      delta: before == null ? null : totalNow - before,
      deltaPercent: before ? (totalNow - before) / before * 100 : null,
      series: seriesFor(model.records, model.range, value, model.bucket),
    };
  });
}

/** Які назви стовпців віднесено до техніки, а які до об'єктів (для прозорості). */
export function classificationOf(workbook, config = DEFAULT_CONFIG) {
  const names = new Set();
  for (const m of workbook.metrics || []) if (['destroyed', 'damaged', 'suppressed'].includes(m.group)) names.add(m.name);
  for (const r of workbook.records || []) for (const id of Object.keys(r.values)) { const m = /^(destroyed|damaged|suppressed)\|(.+)$/.exec(id); if (m) names.add(m[2]); }
  const list = [...names].sort((a, b) => a.localeCompare(b, 'uk'));
  return { equipment: list.filter(n => classifyTarget(n, config) === 'equipment'), objects: list.filter(n => classifyTarget(n, config) === 'object') };
}

function unitTotals(records, valueFor) {
  const byUnit = new Map();
  for (const r of records) { const t = byUnit.get(r.unit) || { unit: r.unit, total: 0, days: new Set() }; t.total += valueFor(r); if (Object.keys(r.values).length) t.days.add(r.date); byUnit.set(r.unit, t); }
  return [...byUnit.values()];
}

function chartFor(model, kpis) {
  const pick = (...keys) => model.personnelSeries.map((_, i) => keys.reduce((s, key) => s + kpis.find(k => k.key === key).series[i].value, 0));
  const categories = model.personnelSeries.map(p => (model.bucket === 'day' ? chartDay(p.from) : `${shortDate(p.from)}–${shortDate(p.to)}`));
  // Окремі діаграми: масштаби втрат о/с і техніки з об'єктами різні, на одній осі вони перекривали б одне одного.
  return [
    {
      id: 'personnel', title: 'Втрати о/с противника', bucket: model.bucket, categories,
      series: [{ name: 'Знищено (200)', values: model.personnelSeries.map(p => p.value.kia) }, { name: 'Поранено (300)', values: model.personnelSeries.map(p => p.value.wia) }],
    },
    {
      id: 'targets', title: 'Техніка та об’єкти противника', bucket: model.bucket, categories,
      series: [{ name: 'ОВТ знищено + пошкоджено', values: pick('ovtDestroyed', 'ovtDamaged') }, { name: 'Об’єкти знищено + пошкоджено', values: pick('objDestroyed', 'objDamaged') }],
    },
  ];
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
      const eff = kpi('ammoPerTarget');
      if (eff && eff.total != null && eff.previous != null && eff.base >= config.minBase && eff.previousBase >= config.minBase && Math.abs(eff.deltaPercent) >= config.changePercent) {
        changes.push({
          severity: Math.abs(eff.deltaPercent), key: 'ammoPerTarget',
          text: `${KPI_NAMES.ammoPerTarget}: ${formatNumber(eff.total)} проти ${formatNumber(eff.previous)} (${formatPercent(eff.deltaPercent)}, ${eff.deltaPercent > 0 ? 'гірше' : 'краще'}; уражено ${formatNumber(eff.base)} проти ${formatNumber(eff.previousBase)}).`,
        });
        signals.push({ signal: 'change', direction: eff.deltaPercent > 0 ? 'up' : 'down', domain: 'efficiency', severity: Math.abs(eff.deltaPercent), label: KPI_NAMES.ammoPerTarget });
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
  const dNow = kpi('ovtDestroyed'), gNow = kpi('ovtDamaged');
  if (context.kind === 'window' && dNow && gNow && dNow.previous != null && gNow.previous != null && prevComplete) {
    const nowBase = dNow.total + gNow.total, prevBase = dNow.previous + gNow.previous;
    if (nowBase >= config.minBase && prevBase >= config.minBase) {
      const now = dNow.total / nowBase * 100, before = dNow.previous / prevBase * 100;
      if (Math.abs(now - before) >= config.structureShiftPp) {
        changes.push({ severity: Math.abs(now - before), text: `Частка знищеної техніки серед знищеної та пошкодженої: ${formatNumber(now)}${NBSP}% проти ${formatNumber(before)}${NBSP}% (${formatNumber(dNow.total)} з ${formatNumber(nowBase)} проти ${formatNumber(dNow.previous)} з ${formatNumber(prevBase)}).` });
        signals.push({ signal: 'structure', direction: now > before ? 'up' : 'down', domain: 'ovt', severity: Math.abs(now - before), label: 'Структура уражень' });
      }
    }
  }

  // Концентрація за підрозділами.
  const activeUnits = model.units.filter(u => u.days > 0);
  if (activeUnits.length >= 2) {
    for (const [key, label] of [['ammo', KPI_NAMES.ammo], ['ovtDestroyed', KPI_NAMES.ovtDestroyed], ['kia', KPI_NAMES.kia]]) {
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
    for (const key of ['ammo', 'kia', 'ovtDestroyed']) {
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
    attention.push({ severity: 60 + silent, text: `${silent} із ${model.days} діб без жодного ненульового показника.` });
    signals.push({ signal: 'gap', direction: '*', domain: '*', severity: 60, label: `${silent} ${daysWord(silent)} без даних` });
  }

  const focusDomains = FOCUS_DOMAINS[config.focus] || [];
  const boost = domain => (focusDomains.includes(domain) ? (domain === 'efficiency' ? 1001 : 1000) : 0);
  for (const item of changes) item.severity += boost(KPI_DOMAIN[item.key]);
  for (const sig of signals) sig.severity += boost(sig.domain);
  const top = list => list.sort((a, b) => b.severity - a.severity).slice(0, config.maxItems).map(({ text }) => ({ text }));

  const hypotheses = [];
  const seen = new Set();
  for (const s of [...signals].sort((a, b) => b.severity - a.severity)) {
    for (const h of pick(s.domain, s.signal, s.direction).slice(0, 1)) {
      const text = `${s.label}: ${h.text}`;
      if (!seen.has(text)) { seen.add(text); hypotheses.push({ text }); }
    }
    if (hypotheses.length >= config.maxItems) break;
  }

  return { changes: top(changes), attention: top(attention), hypotheses: hypotheses.slice(0, config.maxItems) };
}

/* ------------------------------ колода ------------------------------ */

/** Похідні показники: уражено всього та витрата БК на одиницю ураженого (менше — краще). */
function withDerived(kpis) {
  const find = key => kpis.find(k => k.key === key);
  const parts = ['ovtDestroyed', 'ovtDamaged', 'ovtSuppressed', 'objDestroyed', 'objDamaged', 'objSuppressed'].map(find);
  const sum = pick => parts.reduce((s, k) => s + (pick(k) || 0), 0);
  const hasPrev = parts.every(k => k.previous != null);
  const affected = sum(k => k.total);
  const affectedBefore = hasPrev ? sum(k => k.previous) : null;
  const ammo = find('ammo');
  const affectedKpi = {
    key: 'affected', label: KPI_NAMES.affected, total: affected, previous: affectedBefore,
    delta: hasPrev ? affected - affectedBefore : null,
    deltaPercent: hasPrev && affectedBefore ? (affected - affectedBefore) / affectedBefore * 100 : null,
    series: parts[0].series.map((_, i) => ({ ...parts[0].series[i], value: parts.reduce((s, k) => s + k.series[i].value, 0) })),
  };
  const ratio = affected > 0 ? ammo.total / affected : null;
  const ratioBefore = hasPrev && affectedBefore > 0 && ammo.previous != null ? ammo.previous / affectedBefore : null;
  const ratioKpi = {
    key: 'ammoPerTarget', label: KPI_NAMES.ammoPerTarget, total: ratio, previous: ratioBefore,
    base: affected, previousBase: affectedBefore, better: 'down',
    delta: ratio != null && ratioBefore != null ? ratio - ratioBefore : null,
    deltaPercent: ratio != null && ratioBefore ? (ratio - ratioBefore) / ratioBefore * 100 : null,
    series: [],
  };
  return [...kpis, affectedKpi, ratioKpi];
}

/** Модель дашборда, у якій знищено/пошкоджено/подавлено розділено на техніку (ОВТ) й об'єкти. */
function augment(model, workbook, units, config) {
  const skip = new Set(['destroyed', 'damaged', 'suppressed']);
  return {
    ...model,
    kpis: withDerived([...model.kpis.filter(k => !skip.has(k.key)), ...classifiedKpis(model, workbook, units, config)]),
    units: model.units.map(u => ({ ...u, ovtDestroyed: classSum(model.records.filter(r => r.unit === u.unit), 'destroyed', 'equipment', config) })),
  };
}

function paceRows(workbook, units, anchor, range, config) {
  const days = daysOf(range).length;
  if (days < config.paceMinDays) return null;
  const recentRange = rollingRange(anchor, 30);
  const whole = augment(createDashboardModel(workbook, { range, unit: units, preset: 'custom' }), workbook, units, config);
  const recent = augment(createDashboardModel(workbook, { range: recentRange, unit: units, preset: 'custom' }), workbook, units, config);
  const rows = [];
  for (const key of CHANGE_KEYS) {
    const all = whole.kpis.find(k => k.key === key), now = recent.kpis.find(k => k.key === key);
    const overall = all.total / days, recentPace = now.total / 30;
    if (all.total < config.minBase || overall <= 0) continue;
    rows.push({ key, overall, recent: recentPace, percent: (recentPace - overall) / overall * 100 });
  }
  return rows;
}

/** Набір плиток за фокусом. Для груп порожні (нулі в обох періодах) плитки замінюються показниками з даними. */
function tileKeys(model, config, prune) {
  if (!prune) return TILE_SETS[config.focus] || TILE_SETS.all;
  const base = GROUP_TILE_SETS[config.focus] || GROUP_TILE_SETS.all;
  const live = key => { const k = model.kpis.find(item => item.key === key); return k && ((k.total || 0) !== 0 || (k.previous || 0) !== 0); };
  const kept = base.filter(live);
  for (const key of TILE_POOL) { if (kept.length >= base.length) break; if (!kept.includes(key) && live(key)) kept.push(key); }
  return kept;
}

/** Виноска «Наші втрати за N діб — M»: сума 200 + 300 + 500 із таблиці власних втрат за період слайда (слайди періодів). */
function ownCalloutFor(own, range, days) {
  const loss = ownLossesInRange(own, range);
  return { days, total: loss.total, parts: loss.parts, text: `Наші втрати за ${days} ${daysAcc(days)} — ${formatNumber(loss.total)}`, detail: `200 — ${formatNumber(loss.parts['200'])} · 300 — ${formatNumber(loss.parts['300'])} · 500 — ${formatNumber(loss.parts['500'])}` };
}

function windowSlide(workbook, period, units, anchor, config, all, prune = false, own = null) {
  const range = period.range;
  const model = augment(createDashboardModel(workbook, { range, unit: units, preset: 'custom' }), workbook, units, config);
  const prevRange = period.kind === 'window' ? previousRange(range) : { from: '', to: '' };
  const previousCoverage = period.kind === 'window' ? coverageOf(prevRange, all) : null;
  const prevComplete = previousCoverage ? previousCoverage.complete : false;
  const pace = period.kind === 'all' ? paceRows(workbook, units, anchor, range, config) : null;
  const insights = analyzeWindow(model, { kind: period.kind, previousCoverage, pace }, config);
  const rangeCoverage = coverageOf(range, all);
  const notes = [];
  if (!rangeCoverage.complete) notes.push(`Дані охоплюють ${rangeCoverage.covered} із ${rangeCoverage.days} діб обраного періоду.`);
  const slide = {
    id: period.id,
    title: period.title,
    heading: period.heading || period.title,
    theme: 'dshv',
    period: { from: range.from, to: range.to, days: model.days, activeDays: model.activeDays, text: periodText(range) },
    previous: period.kind === 'window' ? { from: prevRange.from, to: prevRange.to, text: periodText(prevRange), covered: previousCoverage.covered, days: previousCoverage.days, complete: prevComplete } : null,
    tiles: tileKeys(model, config, prune).map(key => {
      const kpi = model.kpis.find(k => k.key === key);
      return tileFor(period.kind === 'window' ? kpi : { ...kpi, previous: null, delta: null, deltaPercent: null }, prevComplete, config);
    }),
    charts: chartFor(model, model.kpis),
    ownCallout: own ? ownCalloutFor(own, range, model.days) : null,
    changes: insights.changes,
    attention: insights.attention,
    reasons: insights.hypotheses, // каталог причин: у слайд періодів не виводиться
    ...(prune ? { hypotheses: insights.hypotheses } : closingBlock(period, model, { workbook, units, anchor, config, pace })),
    notes,
  };
  // Слайди періодів УДШВ: праворуч діаграма «Типи уражених цілей», текст висновків іде в анотації слайда.
  if (!prune) { slide.targetChart = targetTypeChart(model.records); slide.annotation = annotationOf(slide); }
  return slide;
}

/** Заключний блок слайда періоду замість «Можливих причин»: тенденція / висновок / узагальнення. */
function closingBlock(period, model, { workbook, units, anchor, config, pace }) {
  const names = KPI_NAMES;
  let block;
  if (period.id === 'week') {
    const month = augment(createDashboardModel(workbook, { range: rollingRange(anchor, 30), unit: units, preset: 'custom' }), workbook, units, config);
    block = weekTrend({ week: model, month, keys: ['affected', ...CHANGE_KEYS.filter(k => k !== 'affected'), 'ammoPerTarget'], names, config });
  } else if (period.kind === 'all') block = wholePeriodSummary({ model, pace, names, config });
  else block = periodVerdict({ model, names, config, title: period.id === 'month' ? 'Висновок за місяць' : 'Висновок за період' });
  return { thirdTitle: block.title, hypotheses: block.items };
}

/** Модель колоди: title + слайди періодів. Однакові вхідні дані дають однаковий результат. */
export function buildDeck(sourceWorkbook, options = {}) {
  // Виключені підрозділи прибираються з аналізу повністю: слайди, порівняння, пік, якір і діапазон дат.
  const excluded = new Set(options.excludeUnits || []);
  const workbook = excluded.size
    ? { ...sourceWorkbook, units: sourceWorkbook.units.filter(u => !excluded.has(u)), records: sourceWorkbook.records.filter(r => !excluded.has(r.unit)) }
    : sourceWorkbook;
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}), focus: options.focus || (options.config && options.config.focus) || DEFAULT_CONFIG.focus };
  const units = options.units || [];
  const anchor = options.anchor || lastActiveDate(workbook);
  const all = activeRange(workbook);
  const periods = deckPeriods(workbook, { anchor, custom: options.custom, dataRange: all });
  const slides = periods.map(period => windowSlide(workbook, period, units, anchor, config, all, false, options.ownLosses || null));
  // Зарезервоване місце під слайд власних втрат: у таблиці УДШВ їх немає (вона про втрати противника).
  if (options.ownLosses) {
    const ownSlide = buildOwnLossesSlide(options.ownLosses, { anchor, custom: options.custom, config });
    // Праворуч дві кругові діаграми «Втрати артилерії противника в порівнянні з нашими»; текст висновків іде в анотації.
    slides.push({ ...ownSlide, artilleryPies: artilleryPies({ workbook, own: options.ownLosses, anchor, config }), annotation: annotationOf(ownSlide) });
  } else if (options.reserveOwnLosses) {
    slides.push({
      id: 'own-losses', title: 'Власні втрати', status: 'no_source',
      message: 'Місце зарезервовано. Джерело даних про власні втрати ще не підключено.',
    });
  }
  // Окремі слайди груп (ПС, РВ тощо): останні 30 діб, підрозділи задає виклик, не код.
  const warnings = [];
  if (!options.custom) {
    for (const group of options.groups || []) {
      // Група зі своєю таблицею ударів (ПС, РВ): слайд будується з неї, а не з підрозділів УДШВ.
      if (group.strikes) { slides.push(buildStrikesSlide(group, { config })); continue; }
      const present = (group.units || []).filter(u => workbook.units.includes(u));
      if (!present.length) { warnings.push(`Група «${group.title}»: підрозділів немає в таблиці, слайд пропущено.`); continue; }
      const slide = windowSlide(workbook, { id: `group:${group.id}`, title: `${group.title} · останні 30 діб`, kind: 'window', range: rollingRange(anchor, 30) }, present, anchor, config, all, true); // виноски власних втрат на слайдах груп немає
      slides.push({ ...slide, scope: { label: group.title, units: present } });
    }
  }
  const titleModel = createDashboardModel(workbook, { range: all, unit: units, preset: 'custom' });
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    kind: 'udshv_deck',
    config,
    classification: classificationOf(workbook, config),
    focus: config.focus,
    focusLabel: FOCUS_LABELS[config.focus] || FOCUS_LABELS.all,
    warnings,
    slides: [{
      id: 'title',
      title: 'Аналітика',
      owner: options.owner || '',
      titleText: options.titleText || 'Аналітика',
      marking: options.marking || '',
      source: workbook.sourceName || '',
      units: units.length ? units : workbook.units,
      excludedUnits: [...excluded],
      dataRange: { from: all.from, to: all.to, text: periodText(all), days: titleModel.days, activeDays: titleModel.activeDays },
      anchor,
      generatedOn: options.generatedOn || '',
    }, ...slides],
  };
}

