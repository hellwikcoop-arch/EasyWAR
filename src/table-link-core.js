// Зв'язування таблиць — етап E3б дорожньої карти (docs/MODULES_ROADMAP.md, розділ 4, «Зв'язування таблиць»),
// блок B1: чисте ядро пошуку кандидатів ключа між двома таблицями профілю. Без DOM, Tauri, сховищ, годинника
// і мережі; нічого не записує й не змінює вхідні дані. Збереження зв'язків (схема профілю) і майстер — окремі блоки.
//
// Правила (рішення власника, розділ 2 і 4 дорожньої карти):
//   - це лише ПРОПОЗИЦІЯ: ядро нічого не підтверджує за користувача, зв'язок ніколи не вмикається мовчки;
//   - кандидат — ключ із 1–3 стовпців з кожного боку; пара стовпців порівнюється за значеннями після
//     нормалізації (регістр, пробіли, лапки, дати, числа); ключ мусить бути унікальним хоча б з одного боку
//     (1:1, 1:N або N:1), зв'язок N:M ядро саме не пропонує;
//   - читання усічене (`truncated`) → кандидат позначений неповним, його унікальність не підтверджена;
//   - послідовні номери 1..N («Номер за списком») не вважаються ключем за збігом значень;
//   - значення рядків повертаються лише як тимчасовий результат виклику (`keyConflicts`), у схему профілю
//     їх не кладемо; рішення про них — не в цьому блоці.
//
// Таблиця на вході (`tableFromSchema` складає її зі схеми профілю й прочитаних рядків):
//   { sourceId, title, columns: [{ key, header, type, decision, role }], roles: { роль: { columnKey, unit } },
//     rows: [{ ключ_стовпця: значення }], truncated }

import { NUMERIC_ROLES, resolveRoles, suggestBindings, unitsCompatible } from './profile-schema-core.js';
import { normalizeHeader } from './dashboard-module-source-core.js';
import { UPDATE_LIMITS, normalizeValue } from './table-update-core.js';

export const LINK_LIMITS = Object.freeze({
  maxTables: 8,
  maxRows: 10_000,
  maxKeyColumns: 3,
  maxCandidates: 5,
  maxColumns: 40,
  maxPairs: 12,
  minMatch: UPDATE_LIMITS.minMatch,
  maxConflicts: 20,
});

const SEP = '\u001f';
const QUOTES = /[’ʼ`´]/gu;
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// ─── Значення ──────────────────────────────────────────────────────────────────────────────────────────

const DATE_PATTERNS = Object.freeze([
  { format: 'iso', pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u, order: [0, 1, 2] },
  { format: 'dmy-dot', pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/u, order: [2, 1, 0] },
  { format: 'dmy-slash', pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/u, order: [2, 1, 0] },
  { format: 'dmy-dash', pattern: /^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/u, order: [2, 1, 0] },
  { format: 'ymd-dot', pattern: /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/u, order: [0, 1, 2] },
  { format: 'ymd-slash', pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/u, order: [0, 1, 2] },
]);

/**
 * Дата в одному з розпізнаних форматів → `{ iso: 'YYYY-MM-DD', format, ambiguous, dayFirstProof }`; інакше `null`.
 * Слеш- і дефіс-дати читаються «день/місяць/рік» (як в українських таблицях), але `ambiguous: true`, якщо їх
 * можна прочитати й як «місяць/день/рік»; час відкидається; неіснуюча дата (31.02) не розпізнається.
 */
export function canonicalDate(value) {
  const text = cell(value);
  if (!text) return null;
  for (const { format, pattern, order } of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const [year, month, day] = order.map(index => Number(match[index + 1]));
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    // Слеш і дефіс у рядку «д/м/р» можуть бути й «м/д/р»: якщо обидві частини ≤ 12 і різні, порядок лише припущено;
    // частина > 12 на першому місці доводить «день першим».
    const first = Number(match[1]);
    const second = Number(match[2]);
    const loose = (format === 'dmy-slash' || format === 'dmy-dash');
    return {
      iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      format,
      ambiguous: loose && first <= 12 && second <= 12 && first !== second,
      dayFirstProof: loose && first > 12,
    };
  }
  return null;
}

// Рядок із символів, для яких NFC нічого не змінює (латиниця, кирилиця без комбінівних знаків, без пробілів),
// проходить без `normalize`: на великих таблицях це найдорожча частина профілю.
const PLAIN = /^[\u0021-\u02ff\u0400-\u0482\u048a-\u052f]*$/u;
const cell = value => (typeof value === 'string' && PLAIN.test(value) ? value : normalizeValue(value));
const textKey = value => cell(value).toLowerCase().replace(QUOTES, "'");

function numberKey(value) {
  const text = cell(value);
  if (/^-?\d+(?:[.,]\d+)?$/u.test(text)) {
    const number = Number(text.replace(',', '.'));
    if (Number.isFinite(number)) return String(number);
  }
  return textKey(value);
}

// ─── Профіль стовпця ───────────────────────────────────────────────────────────────────────────────────

const PARSE_SHARE = 0.8;

function profileColumn(column, rows, role, linker) {
  const raw = rows.map(row => (isRecord(row) ? row[column.key] : undefined));
  const texts = raw.map(cell);
  const nonBlank = texts.filter(text => text !== '');
  let kind = column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text';
  // Текстовий стовпець, що складається з дат, читається як дата; спершу дешева перевірка початку стовпця.
  if (kind === 'text' && nonBlank.length && nonBlank.slice(0, 40).filter(text => canonicalDate(text)).length / Math.min(40, nonBlank.length) >= 0.5
    && nonBlank.filter(text => canonicalDate(text)).length / nonBlank.length >= PARSE_SHARE) kind = 'date';
  const formats = new Map();
  let unparsed = 0;
  let ambiguousDates = 0;
  let dayFirstProof = 0;
  const values = raw.map((value, i) => {
    if (texts[i] === '') return '';
    if (kind === 'date') {
      const date = canonicalDate(value);
      if (date) {
        formats.set(date.format, (formats.get(date.format) || 0) + 1);
        if (date.ambiguous) ambiguousDates += 1;
        if (date.dayFirstProof) dayFirstProof += 1;
        return date.iso;
      }
      unparsed += 1;
      return textKey(value);
    }
    return kind === 'number' ? numberKey(value) : textKey(value);
  });
  // Числові ідентифікатори значень (спільні для всіх таблиць одного виклику): 0 — порожньо.
  const ids = new Int32Array(values.length);
  const distinct = new Set();
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === '') continue;
    ids[i] = linker.intern(values[i]);
    distinct.add(ids[i]);
  }
  return {
    key: column.key, header: column.header || column.key, type: column.type, decision: column.decision || '', role,
    kind, values, ids, distinct, blanks: values.length - nonBlankCount(ids), formats, unparsed, rows: values.length,
    // Порядок «день/місяць» припущено, якщо в стовпці є неоднозначні дати й жодної, що доводить «день першим».
    orderAssumed: ambiguousDates > 0 && dayFirstProof === 0,
    sequential: isSequential(values, distinct),
  };
}

function nonBlankCount(ids) {
  let count = 0;
  for (let i = 0; i < ids.length; i += 1) if (ids[i] !== 0) count += 1;
  return count;
}

// Номери 1..N (або 0..N−1) без пропусків і повторів: порядкові номери, а не ключ між таблицями.
function isSequential(values, distinct) {
  // Порядкові номери: кожне значення зустрічається один раз (рядків стільки, скільки різних значень).
  if (distinct.size < 3 || distinct.size !== values.length) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!/^\d+$/u.test(value)) return false;
    const number = Number(value);
    if (number < min) min = number;
    if (number > max) max = number;
  }
  return (min === 0 || min === 1) && max - min + 1 === distinct.size;
}

// Спільний для виклику словник значень і кеш профілів: таблиця на вході не змінюється між викликами.
function createLinker() {
  const dictionary = new Map();
  return {
    profiles: new WeakMap(),
    intern(text) {
      let id = dictionary.get(text);
      if (id === undefined) { id = dictionary.size + 1; dictionary.set(text, id); }
      return id;
    },
    get size() { return dictionary.size; },
    // Режим ключів фіксується при першому використанні: усі таблиці виклику профілюються до оцінки ключів.
    wide: null,
  };
}

function profileTable(table, linker) {
  if (isRecord(table) && linker.profiles.has(table)) return linker.profiles.get(table);
  const profile = buildProfile(table, linker);
  if (isRecord(table)) linker.profiles.set(table, profile);
  return profile;
}

function buildProfile(table, linker) {
  const rows = (Array.isArray(table?.rows) ? table.rows : []).slice(0, LINK_LIMITS.maxRows);
  const truncated = table?.truncated === true || (Array.isArray(table?.rows) && table.rows.length > LINK_LIMITS.maxRows);
  const roleOf = new Map();
  for (const [role, { columnKey }] of Object.entries(table?.roles || {})) roleOf.set(columnKey, role);
  const dropped = (Array.isArray(table?.columns) ? table.columns : [])
    .filter(column => column && typeof column.key === 'string' && column.type === 'flag')
    .map(column => column.key);
  const columns = (Array.isArray(table?.columns) ? table.columns : [])
    .filter(column => column && typeof column.key === 'string' && column.type !== 'flag')
    .map(column => profileColumn(column, rows, roleOf.get(column.key) || '', linker));
  return { sourceId: table?.sourceId, title: table?.title || table?.sourceId, rows: rows.length, truncated, columns, roles: table?.roles || {}, byKey: new Map(columns.map(column => [column.key, column])), dropped };
}

/** Таблиця для ядра зі схеми профілю й прочитаних рядків. Підсумок зіставлення стовпця береться з `suggestBindings`. */
export function tableFromSchema(schema, sourceId, rows, { truncated = false } = {}) {
  const source = (schema?.sources || []).find(item => item.id === sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const suggested = suggestBindings(schema, sourceId);
  const decisionOf = new Map((suggested.ok ? suggested.columns : []).map(column => [column.key, column.decision]));
  return {
    ok: true,
    table: {
      sourceId, title: source.title,
      columns: source.columns.map(column => ({ key: column.key, header: column.header, type: column.type, decision: decisionOf.get(column.key) || '' })),
      roles: resolveRoles(schema, sourceId),
      rows: Array.isArray(rows) ? rows : [],
      truncated: truncated === true,
    },
  };
}

// ─── Оцінка ключа ──────────────────────────────────────────────────────────────────────────────────────

// Ключ рядка числом (одна або дві колонки) чи рядком (три або дуже великий словник): так Map працює швидко.
const WIDE = 2 ** 21;
function keyReader(columns, linker) {
  const [a, b, c] = columns.map(column => column.ids);
  if (linker.wide === null) linker.wide = linker.size >= WIDE;
  if (columns.length === 1) return i => (a[i] === 0 ? 0 : a[i]);
  if (columns.length === 2 && !linker.wide) return i => (a[i] === 0 || b[i] === 0 ? 0 : a[i] * WIDE + b[i]);
  if (columns.length === 2) return i => (a[i] === 0 || b[i] === 0 ? '' : `${a[i]},${b[i]}`);
  return i => (a[i] === 0 || b[i] === 0 || c[i] === 0 ? '' : `${a[i]},${b[i]},${c[i]}`);
}

function keyStats(profile, columns, linker) {
  if (columns.length === 1) {
    // Один стовпець: множина різних значень вже є в профілі, карта повторів не потрібна (`counts` лише для has/keys).
    const column = columns[0];
    const keyed = profile.rows - column.blanks;
    return { counts: column.distinct, blanks: column.blanks, distinct: column.distinct.size, duplicated: keyed === column.distinct.size ? 0 : 1, keyed };
  }
  const read = keyReader(columns, linker);
  const counts = new Map();
  let blanks = 0;
  for (let i = 0; i < profile.rows; i += 1) {
    const key = read(i);
    if (key === 0 || key === '') { blanks += 1; continue; }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let duplicated = 0;
  for (const count of counts.values()) if (count > 1) duplicated += 1;
  return { counts, blanks, distinct: counts.size, duplicated, keyed: profile.rows - blanks };
}

// Швидка відсікальна перевірка складених ключів без побудови карти ключів: вибірка рядків одного боку шукається
// в іншому за найрізноманітнішим стовпцем ключа. Набір відсікається, лише якщо в обох напрямках знайдено менш як
// 40 % вибірки. Це евристика: збіг за кількістю різних ключів (поріг 80 %) вона не замінює, а лише не дає
// витрачати час на набори, де перетину майже немає (випадкові стовпці різних таблиць).
const SAMPLE_ROWS = 200;
const SAMPLE_MIN_HIT = 0.4;

function columnIndex(column) {
  if (!column.index) {
    const index = new Map();
    for (let i = 0; i < column.ids.length; i += 1) {
      const id = column.ids[i];
      if (id === 0) continue;
      const rows = index.get(id);
      if (rows) rows.push(i); else index.set(id, [i]);
    }
    column.index = index;
  }
  return column.index;
}

function sampleHitRate(from, fromCols, to, toCols) {
  const step = Math.max(1, Math.floor(from.rows / SAMPLE_ROWS));
  let pivot = 0;
  toCols.forEach((column, i) => { if (column.distinct.size > toCols[pivot].distinct.size) pivot = i; });
  const index = columnIndex(toCols[pivot]);
  let seen = 0;
  let hits = 0;
  for (let i = 0; i < from.rows; i += step) {
    if (fromCols.some(column => column.ids[i] === 0)) continue;
    seen += 1;
    const candidates = index.get(fromCols[pivot].ids[i]);
    if (!candidates) continue;
    if (candidates.some(j => fromCols.every((column, k) => column.ids[i] === toCols[k].ids[j]))) hits += 1;
  }
  return seen ? hits / seen : 0;
}

const cardinalityOf = (uniqueLeft, uniqueRight) => (uniqueLeft && uniqueRight ? 'one-one' : uniqueLeft ? 'one-many' : uniqueRight ? 'many-one' : 'many-many');

export const CARDINALITY_LABELS = Object.freeze({
  'one-one': '1 : 1',
  'one-many': '1 : N',
  'many-one': 'N : 1',
  'many-many': 'N : M',
});

function evaluate(left, right, leftCols, rightCols, { requireUnique }, linker) {
  const l = keyStats(left, leftCols, linker);
  const r = keyStats(right, rightCols, linker);
  if (l.distinct < 2 || r.distinct < 2) return null;
  if (l.keyed / left.rows < LINK_LIMITS.minMatch || r.keyed / right.rows < LINK_LIMITS.minMatch) return null;
  const [small, big] = l.distinct <= r.distinct ? [l.counts, r.counts] : [r.counts, l.counts];
  let common = 0;
  for (const key of small.keys()) if (big.has(key)) common += 1;
  const containment = common / Math.min(l.distinct, r.distinct);
  if (containment < LINK_LIMITS.minMatch) return null;
  const uniqueLeft = l.duplicated === 0;
  const uniqueRight = r.duplicated === 0;
  if (requireUnique && !uniqueLeft && !uniqueRight) return null;
  return {
    cardinality: cardinalityOf(uniqueLeft, uniqueRight),
    uniqueLeft, uniqueRight,
    matchLeft: common / l.distinct, matchRight: common / r.distinct,
    containment, commonKeys: common,
    distinctLeft: l.distinct, distinctRight: r.distinct,
    blanksLeft: l.blanks, blanksRight: r.blanks,
    rowsLeft: left.rows, rowsRight: right.rows,
    complete: !left.truncated && !right.truncated,
  };
}

const pairKind = (a, b) => (a.kind === b.kind ? a.kind : [a.kind, b.kind].sort().join('+') === 'number+text' ? 'loose' : '');

// Частка меншого набору значень, що є у більшому; −1, якщо збігу за порогом бути не може (рання зупинка).
function containment(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const allowed = Math.floor(small.size * (1 - LINK_LIMITS.minMatch));
  let misses = 0;
  let hits = 0;
  for (const value of small) {
    if (big.has(value)) hits += 1;
    else if ((misses += 1) > allowed) return -1;
  }
  return hits / small.size;
}

function eligible(column, tooBlank) {
  return column.distinct.size >= 2 && column.blanks / Math.max(1, column.rows) <= tooBlank;
}

function limitColumns(profile, notes, side) {
  const bound = profile.columns.filter(column => column.role);
  const rest = profile.columns.filter(column => !column.role).sort((a, b) => b.distinct.size - a.distinct.size);
  const list = [...bound, ...rest];
  if (list.length > LINK_LIMITS.maxColumns) notes.push({ code: 'columns-limited', side, limit: LINK_LIMITS.maxColumns });
  return list.slice(0, LINK_LIMITS.maxColumns);
}

/** Оцінює вказану користувачем пару ключів (будь-яка кардинальність). Повертає статистику або `null`, якщо збіг нижчий за поріг. */
export function evaluateKey(leftTable, rightTable, leftColumns, rightColumns) {
  const linker = createLinker();
  const left = profileTable(leftTable, linker);
  const right = profileTable(rightTable, linker);
  const lc = (leftColumns || []).map(key => left.byKey.get(key));
  const rc = (rightColumns || []).map(key => right.byKey.get(key));
  if (!lc.length || lc.length !== rc.length || lc.length > LINK_LIMITS.maxKeyColumns || lc.includes(undefined) || rc.includes(undefined)) {
    return fail('bad_key', 'Ключ — від одного до трьох стовпців з кожного боку, однакова кількість.');
  }
  const stats = evaluate(left, right, lc, rc, { requireUnique: false }, linker);
  return stats ? { ok: true, ...stats } : { ok: true, none: true };
}

// ─── Пошук кандидатів ──────────────────────────────────────────────────────────────────────────────────

/**
 * Кандидати ключа між двома таблицями. `{ ok, candidates, notes }`. Кандидат:
 * `{ left: { sourceId, columns, headers }, right: { … }, basis: 'roles' | 'values', cardinality, uniqueLeft, uniqueRight,
 *    matchLeft, matchRight, containment, commonKeys, distinctLeft, distinctRight, blanksLeft, blanksRight,
 *    rowsLeft, rowsRight, complete }`.
 * Спершу пари стовпців з однаковою підтвердженою роллю, потім пари за збігом значень; з пар складаються
 * ключі до трьох стовпців, надмножини вже знайдених пропускаються. Найкращі — ролі, коротший ключ, більший збіг.
 * `notes`: `columns-limited` (стовпців забагато, розглянуто частину), `pairs-limited` (пар забагато), `role-skipped`.
 *
 * Повнота пошуку. `exhaustive: true` лише тоді, коли ніщо не відсіяно евристикою й жодне обмеження не спрацювало;
 * інакше `reasons` називає, чому результат може бути неповним (не вичерпним): `columns-limited`, `pairs-limited`,
 * `candidates-limited` (знайдено більше за показані), `truncated` (читання усічене), `component-prefilter` (пари
 * стовпців за значеннями, що не досягли порогу збігу, не брались до складених ключів), `sample-prefilter` (складені
 * ключі відсіяно за вибіркою рядків). Ключі за підтвердженими ролями перебираються повністю. `exclusions` — стовпці,
 * які за правилами ключем не бувають (послідовні номери, міри, мало різних значень, багато порожніх, прапорці).
 * `caution` кандидата: `date-order-assumed` (порядок «день/місяць» дат у ключі лише припущено), `incomplete-read`.
 */
export function candidateKeys(leftTable, rightTable) {
  const linker = createLinker();
  return candidatesFor(profileTable(leftTable, linker), profileTable(rightTable, linker), linker);
}

function exclusionReason(column, tooBlank) {
  if (NUMERIC_ROLES.includes(column.role)) return 'measure';
  if (column.sequential) return 'sequential';
  if (column.distinct.size < 2) return 'few-values';
  if (column.blanks / Math.max(1, column.rows) > tooBlank) return 'blank';
  return '';
}

function candidatesFor(left, right, linker) {
  const notes = [];
  const reasons = new Set();
  const tooBlank = 1 - LINK_LIMITS.minMatch;
  const exclusions = [];
  for (const [side, profile] of [['left', left], ['right', right]]) {
    for (const column of profile.columns) {
      const reason = exclusionReason(column, tooBlank);
      if (reason) exclusions.push({ side, sourceId: profile.sourceId, column: column.key, reason });
    }
    for (const key of profile.dropped) exclusions.push({ side, sourceId: profile.sourceId, column: key, reason: 'flag' });
  }
  if (left.truncated || right.truncated) reasons.add('truncated');
  const used = new Set();
  const pool = [];

  for (const [role, binding] of Object.entries(left.roles)) {
    const other = right.roles[role];
    if (!other) continue;
    const l = left.byKey.get(binding.columnKey);
    const r = right.byKey.get(other.columnKey);
    if (!l || !r || !eligible(l, tooBlank) || !eligible(r, tooBlank)) { notes.push({ code: 'role-skipped', role, reason: 'unusable' }); continue; }
    // Кількість — міра, а не ключ: ключем не пропонується (різні одиниці — окреме питання, не помилка).
    if (NUMERIC_ROLES.includes(role)) { if (!unitsCompatible(binding.unit, other.unit)) notes.push({ code: 'role-skipped', role, reason: 'units' }); continue; }
    if (!pairKind(l, r)) { notes.push({ code: 'role-skipped', role, reason: 'type' }); continue; }
    pool.push({ l, r, role, basis: 'roles', fit: 1 });
    used.add(l.key + SEP + r.key);
  }

  const lcols = limitColumns(left, notes, 'left').filter(column => eligible(column, tooBlank) && !column.sequential && !NUMERIC_ROLES.includes(column.role));
  const rcols = limitColumns(right, notes, 'right').filter(column => eligible(column, tooBlank) && !column.sequential && !NUMERIC_ROLES.includes(column.role));
  const found = [];
  let rejectedPairs = 0;
  for (const l of lcols) {
    for (const r of rcols) {
      if (used.has(l.key + SEP + r.key) || !pairKind(l, r)) continue;
      const fit = containment(l.distinct, r.distinct);
      if (fit < 0) { rejectedPairs += 1; continue; }
      found.push({ l, r, role: '', basis: 'values', fit, same: normalizeHeader(l.header) === normalizeHeader(r.header) ? 1 : 0 });
    }
  }
  found.sort((a, b) => b.same - a.same || b.fit - a.fit || a.l.key.localeCompare(b.l.key) || a.r.key.localeCompare(b.r.key));
  const room = Math.max(0, LINK_LIMITS.maxPairs - pool.length);
  if (found.length > room) { notes.push({ code: 'pairs-limited', limit: LINK_LIMITS.maxPairs, found: found.length + pool.length }); reasons.add('pairs-limited'); }
  if (rejectedPairs) { notes.push({ code: 'component-prefilter', rejected: rejectedPairs }); reasons.add('component-prefilter'); }
  if (notes.some(note => note.code === 'columns-limited')) reasons.add('columns-limited');
  pool.push(...found.slice(0, room));
  // Ролі в пулі понад ліміт не відкидаємо: підтверджене користувачем важливіше за здогад.
  const candidates = [];
  const accepted = [];
  let sampled = 0;
  const capacity = columns => columns.reduce((product, column) => product * column.distinct.size, 1);
  const grow = (size, start, chosen) => {
    if (chosen.length === size) {
      const ids = chosen.map(pair => pair.l.key + SEP + pair.r.key);
      if (accepted.some(known => known.every(id => ids.includes(id)))) return;
      const lc = chosen.map(pair => pair.l);
      const rc = chosen.map(pair => pair.r);
      // Унікальний ключ не може мати менше різних значень, ніж рядків (хоча б з одного боку).
      if (capacity(lc) < left.rows * LINK_LIMITS.minMatch && capacity(rc) < right.rows * LINK_LIMITS.minMatch) return;
      // Підтверджені ролі перебираються повністю; відсів за вибіркою стосується лише наборів зі здогадних пар.
      if (size > 1 && chosen.some(pair => pair.basis !== 'roles')
        && sampleHitRate(left, lc, right, rc) < SAMPLE_MIN_HIT && sampleHitRate(right, rc, left, lc) < SAMPLE_MIN_HIT) { sampled += 1; return; }
      const stats = evaluate(left, right, lc, rc, { requireUnique: true }, linker);
      if (!stats) return;
      accepted.push(ids);
      candidates.push({
        left: { sourceId: left.sourceId, columns: lc.map(c => c.key), headers: lc.map(c => c.header) },
        right: { sourceId: right.sourceId, columns: rc.map(c => c.key), headers: rc.map(c => c.header) },
        basis: chosen.every(pair => pair.basis === 'roles') ? 'roles' : 'values',
        // Скільки стовпців ключа мають однакові заголовки в обох таблицях: за інших рівних умов це вагоміший збіг.
        sameHeaders: chosen.filter(pair => normalizeHeader(pair.l.header) === normalizeHeader(pair.r.header)).length,
        caution: [
          ...(chosen.some(pair => pair.l.orderAssumed || pair.r.orderAssumed) ? ['date-order-assumed'] : []),
          ...(stats.complete ? [] : ['incomplete-read']),
        ],
        ...stats,
      });
      return;
    }
    for (let i = start; i < pool.length; i += 1) {
      const pair = pool[i];
      if (chosen.some(item => item.l === pair.l || item.r === pair.r)) continue;
      grow(size, i + 1, [...chosen, pair]);
    }
  };
  // Обмеження стосується пулу пар, а не знайдених кандидатів: перебір не обривається на першому ж успіху.
  for (let size = 1; size <= LINK_LIMITS.maxKeyColumns; size += 1) grow(size, 0, []);

  candidates.sort((a, b) => (b.basis === 'roles') - (a.basis === 'roles')
    || a.left.columns.length - b.left.columns.length
    || b.sameHeaders - a.sameHeaders
    || Number(b.complete) - Number(a.complete)
    || b.containment - a.containment
    || a.left.columns.join(SEP).localeCompare(b.left.columns.join(SEP))
    || a.right.columns.join(SEP).localeCompare(b.right.columns.join(SEP)));
  if (sampled) { notes.push({ code: 'sample-prefilter', pruned: sampled }); reasons.add('sample-prefilter'); }
  if (candidates.length > LINK_LIMITS.maxCandidates) { notes.push({ code: 'candidates-limited', limit: LINK_LIMITS.maxCandidates, found: candidates.length }); reasons.add('candidates-limited'); }
  return {
    ok: true,
    candidates: candidates.slice(0, LINK_LIMITS.maxCandidates),
    notes,
    exhaustive: reasons.size === 0,
    reasons: [...reasons].sort(),
    exclusions,
  };
}

/**
 * Кандидати для набору таблиць: кожна пара окремо. Асинхронно, щоб інтерфейс міг передати `tick` (віддати
 * керування між парами) і `cancelled` (перервати). Понад `maxTables` таблиць — відмова.
 */
export async function suggestRelations(tables, { tick = null, cancelled = () => false } = {}) {
  const list = Array.isArray(tables) ? tables : [];
  if (list.length < 2) return fail('too_few_tables', 'Для зв’язування потрібні щонайменше дві таблиці.');
  if (list.length > LINK_LIMITS.maxTables) return fail('too_many_tables', `За раз зв’язується не більш як ${LINK_LIMITS.maxTables} таблиць.`);
  const ids = new Set(list.map(table => table?.sourceId));
  if (ids.size !== list.length) return fail('duplicate_table', 'Таблиці мають бути різними.');
  const linker = createLinker();
  const profiles = [];
  for (const table of list) {
    if (cancelled()) return fail('cancelled', 'Пошук перервано.', { pairs: [] });
    profiles.push(profileTable(table, linker));
    if (tick) await tick();
  }
  const pairs = [];
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      if (cancelled()) return fail('cancelled', 'Пошук перервано.', { pairs });
      pairs.push({ leftId: list[a].sourceId, rightId: list[b].sourceId, ...candidatesFor(profiles[a], profiles[b], linker) });
      if (tick) await tick();
    }
  }
  return { ok: true, pairs };
}

// ─── Питання до користувача ────────────────────────────────────────────────────────────────────────────

function dateFormats(column) {
  return [...column.formats].map(([format, count]) => ({ format, count })).sort((x, y) => y.count - x.count || x.format.localeCompare(y.format));
}

/**
 * Питання, які треба закрити, перш ніж зв'язок підтверджувати: невпізнаний заголовок і неоднозначний стовпець
 * ключа, різні формати дат (у стовпці чи між таблицями), усічене читання, ключі без пари. Нічого не виправляє.
 */
export function linkIssues(leftTable, rightTable, candidate) {
  const linker = createLinker();
  const left = profileTable(leftTable, linker);
  const right = profileTable(rightTable, linker);
  const issues = [];
  const sides = [['left', left, candidate.left.columns], ['right', right, candidate.right.columns]];
  for (const [side, profile, keys] of sides) {
    for (const key of keys) {
      const column = profile.byKey.get(key);
      if (!column) continue;
      if (column.decision === 'unknown') issues.push({ kind: 'unknown-header', side, sourceId: profile.sourceId, column: key, header: column.header });
      else if (column.decision === 'ambiguous') issues.push({ kind: 'ambiguous-column', side, sourceId: profile.sourceId, column: key, header: column.header });
      if (column.kind === 'date') {
        const formats = dateFormats(column);
        if (column.orderAssumed) issues.push({ kind: 'date-order-assumed', side, sourceId: profile.sourceId, column: key, header: column.header });
        if (formats.length > 1 || column.unparsed > 0) issues.push({ kind: 'date-format', side, sourceId: profile.sourceId, column: key, header: column.header, formats, unparsed: column.unparsed });
      }
    }
    if (profile.truncated) issues.push({ kind: 'truncated', side, sourceId: profile.sourceId, rows: profile.rows });
  }
  // Різні формати дат між таблицями: у кожній вони однорідні, але не збігаються.
  candidate.left.columns.forEach((key, index) => {
    const a = left.byKey.get(key);
    const b = right.byKey.get(candidate.right.columns[index]);
    if (!a || !b || a.kind !== 'date' || b.kind !== 'date') return;
    const fa = dateFormats(a).map(item => item.format);
    const fb = dateFormats(b).map(item => item.format);
    if (fa.length === 1 && fb.length === 1 && fa[0] !== fb[0]) {
      issues.push({ kind: 'date-format-mismatch', leftColumn: a.key, rightColumn: b.key, leftFormat: fa[0], rightFormat: fb[0] });
    }
  });
  const lc = candidate.left.columns.map(key => left.byKey.get(key));
  const rc = candidate.right.columns.map(key => right.byKey.get(key));
  if (!lc.includes(undefined) && !rc.includes(undefined)) {
    const l = keyStats(left, lc, linker);
    const r = keyStats(right, rc, linker);
    let onlyLeft = 0;
    for (const key of l.counts.keys()) if (!r.counts.has(key)) onlyLeft += 1;
    let onlyRight = 0;
    for (const key of r.counts.keys()) if (!l.counts.has(key)) onlyRight += 1;
    if (onlyLeft || onlyRight) issues.push({ kind: 'unmatched-keys', onlyLeft, onlyRight });
  }
  return issues;
}

/**
 * Різні значення для одного ключа. `columnPairs` — пари `[ліве, праве]` стовпців для порівняння; за
 * замовчуванням — стовпці з однаковою підтвердженою роллю поза ключем. Порівнюється рядок «унікального» боку з
 * кожним рядком іншого. Порожнє значення не конфлікт. Значення в результаті — тимчасові, лише для показу в сесії.
 */
export function keyConflicts(leftTable, rightTable, candidate, { columnPairs = null, limit = LINK_LIMITS.maxConflicts } = {}) {
  if (!candidate?.uniqueLeft && !candidate?.uniqueRight) return fail('no_unique_side', 'Порівняння рядків можливе, лише якщо ключ унікальний хоча б з одного боку.');
  const linker = createLinker();
  const left = profileTable(leftTable, linker);
  const right = profileTable(rightTable, linker);
  const keyColumns = new Set([...candidate.left.columns.map(key => `l:${key}`), ...candidate.right.columns.map(key => `r:${key}`)]);
  let pairs = columnPairs;
  if (!pairs) {
    pairs = [];
    for (const [role, binding] of Object.entries(left.roles)) {
      const other = right.roles[role];
      if (!other || NUMERIC_ROLES.includes(role) && !unitsCompatible(binding.unit, other.unit)) continue;
      if (keyColumns.has(`l:${binding.columnKey}`) || keyColumns.has(`r:${other.columnKey}`)) continue;
      pairs.push([binding.columnKey, other.columnKey]);
    }
  }
  const lc = candidate.left.columns.map(key => left.byKey.get(key));
  const rc = candidate.right.columns.map(key => right.byKey.get(key));
  if (lc.includes(undefined) || rc.includes(undefined)) return fail('bad_key', 'Стовпців ключа немає в таблицях.');
  const useLeftAsOne = candidate.uniqueLeft;
  const [one, many, oneCols, manyCols] = useLeftAsOne ? [left, right, lc, rc] : [right, left, rc, lc];
  const index = new Map();
  for (let i = 0; i < one.rows; i += 1) {
    const key = oneCols.map(column => column.values[i]);
    if (key.includes('')) continue;
    index.set(key.join(SEP), i);
  }
  const totals = pairs.map(([leftKey, rightKey]) => ({ leftColumn: leftKey, rightColumn: rightKey, compared: 0, conflicts: 0 }));
  const prepared = pairs.map(([leftKey, rightKey]) => [left.byKey.get(leftKey), right.byKey.get(rightKey)]);
  if (prepared.some(([a, b]) => !a || !b)) return fail('bad_pair', 'Стовпця для порівняння немає в таблиці.');
  const examples = [];
  for (let j = 0; j < many.rows; j += 1) {
    const key = manyCols.map(column => column.values[j]);
    if (key.includes('')) continue;
    const i = index.get(key.join(SEP));
    if (i === undefined) continue;
    prepared.forEach(([a, b], p) => {
      const [leftIndex, rightIndex] = useLeftAsOne ? [i, j] : [j, i];
      const leftValue = a.values[leftIndex];
      const rightValue = b.values[rightIndex];
      if (leftValue === '' || rightValue === '') return;
      totals[p].compared += 1;
      if (leftValue === rightValue) return;
      totals[p].conflicts += 1;
      if (examples.length < limit) examples.push({ key: key.join(' · '), leftColumn: a.key, rightColumn: b.key, leftValue, rightValue });
    });
  }
  return { ok: true, totals, examples, total: totals.reduce((sum, item) => sum + item.conflicts, 0) };
}

// ─── Показ ─────────────────────────────────────────────────────────────────────────────────────────────

/** Короткий підпис кандидата для списку: «Дата + Підрозділ ↔ Дата події + Підрозділ · 1 : N · збіг 96 %». */
export function describeCandidate(candidate) {
  const side = headers => headers.join(' + ');
  const percent = Math.floor(candidate.containment * 100);
  const parts = [`${side(candidate.left.headers)} ↔ ${side(candidate.right.headers)}`, CARDINALITY_LABELS[candidate.cardinality], `збіг ${percent} %`];
  if (!candidate.complete) parts.push('перевірено не на всіх рядках');
  if (candidate.caution?.includes('date-order-assumed')) parts.push('порядок «день/місяць» дат лише припущено');
  return parts.join(' · ');
}

/** Групи таблиць: компоненти зв'язності за списком пар `{ leftId, rightId }`. Таблиця без зв'язків — окрема група. */
export function connectedGroups(sourceIds, links) {
  const ids = [...new Set(Array.isArray(sourceIds) ? sourceIds : [])];
  const parent = new Map(ids.map(id => [id, id]));
  const find = id => { let root = id; while (parent.get(root) !== root) root = parent.get(root); parent.set(id, root); return root; };
  for (const link of Array.isArray(links) ? links : []) {
    if (!parent.has(link?.leftId) || !parent.has(link?.rightId)) continue;
    parent.set(find(link.leftId), find(link.rightId));
  }
  const groups = new Map();
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || String(a[0]).localeCompare(String(b[0])));
}
