// Підрахунок плиток дашборда за описом із каталогу (src/catalog-core.js).
//
// Чисте ядро без DOM, мережі, сховищ, годинника й динамічного коду: приймає перевірений каталог,
// id плитки й записи, повертає готову модель — числа, відсотки й тексти. Малює модель сторінка.
// Записи — прості об’єкти за id стовпців каталогу: { 'col.date': '2026-08-14', 'col.result': 'Уражено' }.
// Розпізнавання сирого тексту (наприклад, результату ураження) лишається в розборі таблиці: каталог
// описує вже розібрані значення, а не вгадує їх.
//
// Семантику відборів і мір описано в docs/CATALOG.md.

import { catalogFinder, foldLabel } from './catalog-core.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTHS_IN_BARS = 6;
const MONTHS_IN_SERIES = 12;
const DAY = 864e5;

/* ------------------------------------------------------------------ */
/*  Числа, дати, відмінки                                              */
/* ------------------------------------------------------------------ */

/** Номер доби від початку епохи (UTC) або NaN, якщо це не дата `рррр-мм-дд`. */
export function dayNumber(iso) {
  const m = typeof iso === 'string' ? ISO_DATE.exec(iso) : null;
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : Number.NaN;
}

/** Кількість діб періоду включно з обома кінцями; не менше одного. */
export function periodDays(from, to) {
  const n = dayNumber(to) - dayNumber(from) + 1;
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/** Ціле з розділювачами груп (українська локаль). */
export const formatInt = (n) => Math.round(n).toLocaleString('uk-UA');
/** Число з однією цифрою після коми, якщо вона потрібна. */
export const formatRatio = (n) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });

/** Форма іменника для цілого n: forms = [«1», «2–4», «5+»]. */
export function pluralForm(n, forms) {
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

/** Ключ періоду для найбільшого/найменшого підсумку: доба, тиждень (з понеділка) чи місяць. */
function bucketKey(value, grain) {
  const n = dayNumber(value);
  if (!Number.isFinite(n)) return undefined;
  if (grain === 'month') return value.slice(0, 7);
  if (grain === 'week') return n - ((new Date(n * DAY).getUTCDay() + 6) % 7);
  return value;
}

/* ------------------------------------------------------------------ */
/*  Значення стовпців і відбір                                         */
/* ------------------------------------------------------------------ */

const isEmpty = (value) => value == null || value === '' || (typeof value === 'number' && Number.isNaN(value))
  || (Array.isArray(value) && value.length === 0);

/** Значення списку за згорнутою назвою й синонімами: «уражено» → «Уражено». */
function listIndex(find, column) {
  const list = column.list ? find('lists', column.list) : undefined;
  const known = new Map();
  for (const entry of list ? list.values : []) {
    known.set(foldLabel(entry.value), entry.value);
    for (const alias of entry.aliases || []) known.set(foldLabel(alias), entry.value);
  }
  return known;
}

/**
 * Ключ порівняння: текст — за `foldLabel`; вибір — ще й за синонімами списку, тож «уражено» і
 * «Уражено» зводяться до одного канонічного значення. Невідоме значення береться як є після `foldLabel`.
 */
function canonicalizer(find, column) {
  if (column.type === 'choice' || column.type === 'multichoice') {
    const known = listIndex(find, column);
    return (value) => {
      const key = foldLabel(String(value));
      return known.has(key) ? known.get(key) : key;
    };
  }
  if (column.type === 'text') return (value) => foldLabel(String(value));
  return (value) => value;
}

/** Зводить значення клітинки до порівнюваного вигляду; `undefined` — значення немає чи воно не того типу. */
function scalarReader(column, canon) {
  return (value) => {
    if (isEmpty(value)) return undefined;
    switch (column.type) {
      case 'number':
      case 'duration':
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      case 'date':
        return typeof value === 'string' && ISO_DATE.test(value) ? value : undefined;
      case 'time':
        return typeof value === 'string' && CLOCK_TIME.test(value) ? value : undefined;
      case 'flag':
        return typeof value === 'boolean' ? value : undefined;
      case 'coordinates':
        return undefined;
      default:
        return canon(value);
    }
  };
}

function termTester(find, term) {
  const column = find('columns', term.column);
  const canon = canonicalizer(find, column);
  const read = scalarReader(column, canon);
  const get = (row) => row[term.column];
  if (term.op === 'empty') return (row) => isEmpty(get(row));
  if (term.op === 'notempty') return (row) => !isEmpty(get(row));

  if (column.type === 'multichoice') {
    const items = (row) => [].concat(isEmpty(get(row)) ? [] : get(row)).filter((item) => !isEmpty(item)).map(canon);
    const wanted = new Set([].concat(term.value).map(canon));
    switch (term.op) {
      case 'eq': return (row) => items(row).some((item) => wanted.has(item));
      case 'ne': return (row) => !items(row).some((item) => wanted.has(item));
      case 'in': return (row) => items(row).some((item) => wanted.has(item));
      default: return (row) => !items(row).some((item) => wanted.has(item));
    }
  }

  const target = Array.isArray(term.value) ? undefined : read(term.value);
  const set = Array.isArray(term.value) ? new Set(term.value.map(read)) : undefined;
  const test = (compare) => (row) => {
    const value = read(get(row));
    return value !== undefined && compare(value);
  };
  switch (term.op) {
    case 'eq': return test((value) => value === target);
    case 'ne': return (row) => { const value = read(get(row)); return value === undefined || value !== target; };
    case 'in': return test((value) => set.has(value));
    case 'notin': return (row) => { const value = read(get(row)); return value === undefined || !set.has(value); };
    case 'gt': return test((value) => value > target);
    case 'gte': return test((value) => value >= target);
    case 'lt': return test((value) => value < target);
    default: return test((value) => value <= target);
  }
}

function compileFilter(find, filter) {
  if (!Array.isArray(filter) || !filter.length) return null;
  const tests = filter.map((term) => termTester(find, term));
  return (row) => tests.every((test) => test(row));
}

/* ------------------------------------------------------------------ */
/*  Підрахунок                                                         */
/* ------------------------------------------------------------------ */

const numberOf = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Значення підрахунку над записами: число, `null` (немає даних) або рядок (`top`). */
function evaluate(find, measure, rows, ctx) {
  const passes = compileFilter(find, measure.filter);
  const selected = passes ? rows.filter(passes) : rows;
  const numbers = () => selected.map((row) => numberOf(row[measure.column])).filter((value) => value !== undefined);

  switch (measure.agg) {
    case 'count':
      return selected.length;
    case 'share':
      return rows.length ? (selected.length / rows.length) * 100 : 0;
    case 'sum':
      return numbers().reduce((total, value) => total + value, 0);
    case 'avg': {
      const values = numbers();
      return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
    }
    case 'max': {
      const values = numbers();
      return values.length ? values.reduce((a, b) => (b > a ? b : a)) : null;
    }
    case 'min': {
      const values = numbers();
      return values.length ? values.reduce((a, b) => (b < a ? b : a)) : null;
    }
    case 'distinct': {
      const column = find('columns', measure.column);
      const read = scalarReader(column, canonicalizer(find, column));
      const seen = new Set();
      for (const row of selected) for (const item of [].concat(row[measure.column])) {
        const value = read(item);
        if (value !== undefined) seen.add(value);
      }
      return seen.size;
    }
    case 'peak':
    case 'low': {
      const totals = new Map();
      for (const row of rows) {
        const key = bucketKey(row[measure.by], measure.grain);
        if (key !== undefined && !totals.has(key)) totals.set(key, 0);
      }
      for (const row of selected) {
        const key = bucketKey(row[measure.by], measure.grain);
        if (key === undefined) continue;
        totals.set(key, totals.get(key) + (measure.column ? numberOf(row[measure.column]) ?? 0 : 1));
      }
      if (!totals.size) return 0;
      const values = [...totals.values()];
      return measure.agg === 'peak' ? values.reduce((a, b) => (b > a ? b : a)) : values.reduce((a, b) => (b < a ? b : a));
    }
    case 'top': {
      const column = find('columns', measure.column);
      const known = column.type === 'text' ? null : listIndex(find, column);
      const nameOf = (item) => (known && known.has(foldLabel(String(item))) ? known.get(foldLabel(String(item))) : String(item));
      const named = new Map();
      for (const row of selected) {
        const weight = measure.weight ? numberOf(row[measure.weight]) ?? 0 : 1;
        for (const item of [].concat(row[measure.column])) {
          if (isEmpty(item)) continue;
          const name = nameOf(item);
          named.set(name, (named.get(name) || 0) + weight);
        }
      }
      return [...named.entries()]
        .filter((entry) => entry[1] > 0)
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'uk'))
        .slice(0, measure.limit || 1)
        .map(([name, value]) => `${name} ${formatInt(value)}`)
        .join(' · ');
    }
    case 'days':
      return ctx.days;
    default:
      return null;
  }
}

/** Показник із необов’язковим знаменником `per`: число або `null`, якщо ділити нема на що. */
function evaluateRatio(find, measure, per, rows, ctx) {
  const value = evaluate(find, measure, rows, ctx);
  if (!per) return value;
  const denominator = evaluate(find, per, rows, ctx);
  if (typeof value !== 'number' || typeof denominator !== 'number' || !(denominator > 0)) return null;
  return value / denominator;
}

function valueText(measure, per, value) {
  if (typeof value === 'string') return value;
  if (value === null) return '—';
  if (per || measure.agg === 'avg') return formatRatio(value);
  if (measure.agg === 'share') return `${Math.round(value)}%`;
  return formatInt(value);
}

function unitText(unit, value) {
  if (!unit) return '';
  if (typeof unit === 'string') return ` ${unit}`;
  if (typeof value !== 'number') return ` ${unit.many}`;
  if (!Number.isInteger(value)) return ` ${unit.fraction ?? unit.many}`;
  return ` ${pluralForm(value, [unit.one, unit.few, unit.many])}`;
}

const percentChange = (current, previous) => (
  typeof current !== 'number' || typeof previous !== 'number' || !(previous > 0)
    ? null
    : Math.round(((current - previous) / previous) * 100)
);

/* ------------------------------------------------------------------ */
/*  Плитка                                                             */
/* ------------------------------------------------------------------ */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** Скільки діб місяця `рррр-мм` потрапляє в період (без періоду — весь місяць); не менше однієї. */
function daysInPeriodMonth(key, period) {
  const first = dayNumber(`${key}-01`);
  const next = new Date(first * DAY);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = next.getTime() / DAY - 1;
  const from = Math.max(first, Number.isFinite(dayNumber(period.from)) ? dayNumber(period.from) : first);
  const to = Math.min(last, Number.isFinite(dayNumber(period.to)) ? dayNumber(period.to) : last);
  return Math.max(1, to - from + 1);
}

/** Ряд за місяцями: ключі `рррр-мм` від найстарішого; записи без дати пропускаються. */
function monthly(find, tile, rows, period, limit) {
  const groups = new Map();
  for (const row of rows) {
    const date = row[tile.by];
    if (!Number.isFinite(dayNumber(date))) continue;
    const key = date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.keys()].sort().slice(-limit).map((key) => {
    const value = evaluateRatio(find, tile.measure, tile.per, groups.get(key), { days: daysInPeriodMonth(key, period) });
    return { key, value: typeof value === 'number' ? value : 0 };
  });
}

/**
 * Рахує плитку за описом.
 *
 * @param catalogs перевірений каталог або масив перевірених шарів (нижній першим)
 * @param tileId   id плитки
 * @param data     { rows, period: { from, to }, compare }
 *                 compare: null | { kind: 'previous', rows } | { kind: 'halves', first, second } —
 *                 з чим порівнювати зміну; обирає сторінка, ядро лише рахує
 * @returns модель плитки: value, delta, bars | series | ring, extras, info
 */
export function computeTile(catalogs, tileId, data) {
  const find = catalogFinder(catalogs, 'computeTile');
  const tile = find('tiles', tileId);
  if (!tile) throw new RangeError(`Плитки «${tileId}» немає в каталогах.`);
  const rows = data && Array.isArray(data.rows) ? data.rows : [];
  const period = data && data.period ? data.period : {};
  const ctx = { days: periodDays(period.from, period.to) };
  const compare = data && data.compare ? data.compare : null;

  const number = evaluateRatio(find, tile.measure, tile.per, rows, ctx);
  const model = {
    id: tile.id,
    label: tile.label,
    tone: tile.tone,
    visual: tile.visual,
    value: { number: typeof number === 'number' ? number : null, text: valueText(tile.measure, tile.per, number) },
    delta: null,
    compare: compare ? compare.kind : null,
    extras: [],
    info: null,
    hidden: tile.hideWhenZero === true && !(number > 0),
  };
  for (const key of ['sub', 'icon', 'opens']) if (tile[key] !== undefined) model[key] = tile[key];

  if (tile.delta) {
    let pct = null;
    if (compare && compare.kind === 'previous') {
      pct = percentChange(number, evaluateRatio(find, tile.measure, tile.per, compare.rows || [], ctx));
    } else if (compare && compare.kind === 'halves') {
      pct = percentChange(
        evaluateRatio(find, tile.measure, tile.per, compare.second || [], ctx),
        evaluateRatio(find, tile.measure, tile.per, compare.first || [], ctx),
      );
    }
    model.delta = { pct, mode: tile.delta };
  }

  if (tile.visual === 'bars') model.bars = monthly(find, tile, rows, period, MONTHS_IN_BARS);
  if (tile.visual === 'pair') model.series = monthly(find, tile, rows, period, MONTHS_IN_SERIES);
  if (tile.visual === 'ring') {
    const selected = tile.measure.filter ? rows.filter(compileFilter(find, tile.measure.filter)) : rows;
    const ring = { percent: rows.length ? Math.round((selected.length / rows.length) * 100) : 0 };
    if (tile.ringLabel !== undefined) ring.label = tile.ringLabel;
    if (tile.caption !== undefined) ring.caption = tile.caption;
    model.ring = ring;
  }

  for (const extra of tile.extras || []) {
    const value = evaluateRatio(find, extra.measure, extra.per, rows, ctx);
    const item = { label: extra.label, text: `${valueText(extra.measure, extra.per, value)}${unitText(extra.unit, value)}${extra.suffix || ''}` };
    if (extra.icon !== undefined) item.icon = extra.icon;
    model.extras.push(item);
  }

  if (tile.info) {
    const parts = [];
    if (tile.info.text) parts.push(tile.info.text.trim().replace(/\.$/, ''));
    for (const fact of tile.info.facts || []) {
      const text = valueText(fact.measure, null, evaluate(find, fact.measure, rows, ctx));
      if (text !== '') parts.push(fact.label ? `${fact.label}: ${text}` : text);
    }
    model.info = parts.length ? parts.join('. ') : null;
  }

  return deepFreeze(model);
}

/** Рахує кілька плиток одним викликом (порядок як у `tileIds`). */
export function computeTiles(catalogs, tileIds, data) {
  return tileIds.map((tileId) => computeTile(catalogs, tileId, data));
}
