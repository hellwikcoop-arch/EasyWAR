// Чиста логіка модуля EasyFLY (облік допусків, перевірок і нальоту льотного складу): дати й
// строки, медицина ВЛК↔ПМО, Стаття 205, ОВП, стрибки, перевірки за ролями (КБПВ-2018 п. 1.1.10),
// допуски й перерви (Таблиця 1 КБПВ, Додаток 5 ПвПДАУ), блокування польотів, зведення командира,
// нагадування, хронометраж зміни, льотна книжка, розбір рядків імпорту з Excel.
// Без DOM, Tauri і читання файлів. «Сьогодні» завжди параметр: поточний час усередині не береться.
// Дати — рядки ISO `рррр-мм-дд`; на екрані — `дд.мм.рррр` (formatDate). Невідоме значення — null:
// інтерфейс показує тире (orDash), нічого не вигадується.
// Дані — самооблік пілота: документом лишається паперова льотна книжка, затвердження в застосунку
// немає (допуск має лише стани 'valid' | 'lost').

// ───────────────────────────── Дати ─────────────────────────────

const MS_DAY = 86400000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/** Кількість діб до кінцевої дати, коли строк уже «скоро». */
export const SOON_DAYS = 30;

/** Стани строку. null (немає даних) у цей перелік не входить. */
export const STATUS = Object.freeze({ VALID: 'valid', SOON: 'soon', OVERDUE: 'overdue' });

/** Підписи станів для інтерфейсу. */
export const STATUS_LABELS = Object.freeze({
  valid: 'дійсно',
  soon: 'скоро',
  overdue: 'прострочено',
  exempt: 'звільнено',
  lost: 'втрачено',
});

export const DASH = '—';

/** Значення або тире, якщо воно невідоме (null/undefined/порожнє). */
export function orDash(value) {
  return value === null || value === undefined || value === '' ? DASH : value;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validYmd(year, month, day) {
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    && year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month);
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** Складає ISO-дату або null, якщо такої дати немає (30.02 тощо). */
export function toIso(year, month, day) {
  return validYmd(year, month, day) ? `${pad(year, 4)}-${pad(month)}-${pad(day)}` : null;
}

/**
 * Розбирає дату з `рррр-мм-дд` або `дд.мм.рррр` (також `д.м.рррр`). Повертає
 * { year, month, day } або null.
 */
export function parseDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return validYmd(year, month, day) ? { year, month, day } : null;
  }
  match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (match) {
    const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return validYmd(year, month, day) ? { year, month, day } : null;
  }
  return null;
}

/** Нормалізує дату до ISO або повертає null. */
export function normalizeDate(value) {
  const parts = parseDate(value);
  return parts ? toIso(parts.year, parts.month, parts.day) : null;
}

/** `дд.мм.рррр` для екрана; null для невідомої/некоректної дати (UI покаже тире). */
export function formatDate(iso) {
  const parts = parseDate(iso);
  return parts ? `${pad(parts.day)}.${pad(parts.month)}.${parts.year}` : null;
}

function dayNumber(iso) {
  const parts = parseDate(iso);
  if (!parts) return NaN;
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_DAY);
}

function fromDayNumber(n) {
  const date = new Date(n * MS_DAY);
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Різниця в добах `to − from` (додатна, якщо `to` пізніше). NaN для некоректної дати. */
export function diffDays(from, to) {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(iso, days) {
  const n = dayNumber(iso);
  return Number.isNaN(n) || !Number.isInteger(days) ? null : fromDayNumber(n + days);
}

/**
 * Додає цілу кількість місяців (від'ємна — віднімає). Кінець місяця зберігається:
 * 31.08 + 6 міс = 28.02 (або 29.02 у високосному), 31.01 + 1 міс = 28/29.02.
 */
export function addMonths(iso, months) {
  const parts = parseDate(iso);
  if (!parts || !Number.isInteger(months)) return null;
  const total = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12 + 1;
  return toIso(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

/** Місяці з дробом (2,5): ціла частина — місяцями, дріб — по 30 діб на місяць. */
export function addMonthsFrac(iso, months) {
  if (!Number.isFinite(months)) return null;
  const whole = Math.floor(months);
  const base = addMonths(iso, whole);
  return base ? addDays(base, Math.round((months - whole) * 30)) : null;
}

/** Лишилось діб до кінцевої дати (від'ємне — прострочено), або null. */
export function daysLeft(deadline, today) {
  const n = diffDays(today, deadline);
  return Number.isNaN(n) ? null : n;
}

/**
 * Статус строку за кінцевою датою: 'overdue' — після кінцевої дати (сама кінцева дата ще
 * дійсна), 'soon' — лишилось 0…soonDays діб (30 діб рівно — ще «скоро»), інакше 'valid'.
 * Немає дати — null.
 */
export function deadlineStatus(deadline, today, soonDays = SOON_DAYS) {
  const left = daysLeft(deadline, today);
  if (left === null) return null;
  if (left < 0) return STATUS.OVERDUE;
  return left <= soonDays ? STATUS.SOON : STATUS.VALID;
}

/** «1 день», «2 дні», «5 днів», «11 днів», «21 день». */
export function pluralDays(n) {
  const abs = Math.abs(n);
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return 'днів';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дні';
  return 'днів';
}

/** Рік дати (число) або null. */
function yearOf(iso) {
  return parseDate(iso)?.year ?? null;
}

function maxDate(dates) {
  let best = null;
  for (const date of dates) {
    const iso = normalizeDate(date);
    if (iso && (best === null || iso > best)) best = iso;
  }
  return best;
}

// ───────────────────────────── Налаштування частини ─────────────────────────────

/**
 * Типові налаштування частини. ОВП: періодичність 12 міс і блокування допуску — припущення
 * (власник не підтвердив), тому винесені в налаштування.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  soonDays: SOON_DAYS,
  ovpMonths: 12,
  ovpBlocks: true,
  article205Months: 6,
  jumpsPerYear: 2,
  jumpsMaxGapMonths: 15,
  aerobaticsLimit: 4,
  onbMaxShiftMin: 180,
  onbMaxFlightMin: 120,
  reminderDays: Object.freeze([30, 14, 7]),
});

/** Накладає часткові налаштування на типові; некоректні значення ігноруються. */
export function resolveSettings(partial) {
  const input = partial && typeof partial === 'object' ? partial : {};
  const out = { ...DEFAULT_SETTINGS, reminderDays: [...DEFAULT_SETTINGS.reminderDays] };
  const intKeys = ['soonDays', 'ovpMonths', 'article205Months', 'jumpsPerYear', 'jumpsMaxGapMonths',
    'aerobaticsLimit', 'onbMaxShiftMin', 'onbMaxFlightMin'];
  for (const key of intKeys) {
    if (Number.isInteger(input[key]) && input[key] > 0) out[key] = input[key];
  }
  if (typeof input.ovpBlocks === 'boolean') out.ovpBlocks = input.ovpBlocks;
  if (Array.isArray(input.reminderDays)) {
    const days = input.reminderDays.filter(d => Number.isInteger(d) && d > 0);
    if (days.length) out.reminderDays = [...new Set(days)].sort((a, b) => b - a);
  }
  return out;
}

// ───────────────────────────── Ролі, класи, типи ПС ─────────────────────────────

/** Ролі EasyFLY: командир екіпажу, льотчик-штурман, борттехнік. */
export const ROLES = Object.freeze(['КЕ', 'ЛШ', 'Борттехнік']);

/** Класна кваліфікація: sniper — снайпер, 'none' — без класу. */
export const CLASS_QUALS = Object.freeze(['sniper', '1', '2', '3', 'none']);
export const CLASS_LABELS = Object.freeze({
  sniper: 'снайпер', 1: '1-й клас', 2: '2-й клас', 3: '3-й клас', none: 'без класу',
});

export const AIRCRAFT_KINDS = Object.freeze(['helicopter', 'airplane']);

/** Колонка таблиць перерв: снайпер/1-й клас, 2-й клас, 3-й клас і без класу. */
export function classColumn(classQual) {
  if (classQual === 'sniper' || classQual === '1') return 'high';
  if (classQual === '2') return 'second';
  return 'low';
}

/** Група п. 1.1.10: снайпер, 1-й, 2-й клас проти 3-го класу й без класу. */
export function classGroup(classQual) {
  return classColumn(classQual) === 'low' ? 'low' : 'high';
}

// ───────────────────────────── Медицина: ВЛК ↔ ПМО ─────────────────────────────

export const MEDICAL_KINDS = Object.freeze(['ВЛК', 'ПМО']);
/** ВЛК і ПМО чергуються з кроком 6 місяців. */
export const MEDICAL_STEP_MONTHS = 6;

export function oppositeMedicalKind(kind) {
  return kind === 'ВЛК' ? 'ПМО' : 'ВЛК';
}

/**
 * Стан медицини за останньою подією {kind, date}: наступна подія — протилежного виду через
 * 6 міс. Прострочена (ВЛК чи ПМО) блокує допуск. Немає подій — null.
 * @returns {{status, lastKind, lastDate, nextKind, dueDate, daysLeft, blocks}|null}
 */
export function medicalState(person, today, soonDays = SOON_DAYS) {
  const events = (Array.isArray(person?.medical) ? person.medical : [])
    .map(event => ({ kind: event?.kind, date: normalizeDate(event?.date) }))
    .filter(event => MEDICAL_KINDS.includes(event.kind) && event.date);
  if (!events.length) return null;
  const last = events.reduce((best, event) => (event.date > best.date ? event : best));
  const dueDate = addMonths(last.date, MEDICAL_STEP_MONTHS);
  const status = deadlineStatus(dueDate, today, soonDays);
  return {
    status,
    lastKind: last.kind,
    lastDate: last.date,
    nextKind: oppositeMedicalKind(last.kind),
    dueDate,
    daysLeft: daysLeft(dueDate, today),
    blocks: status === STATUS.OVERDUE,
  };
}

// ───────────────────────────── Стаття 205 ПРІАЗДАУ ─────────────────────────────

/** Напрями приймання: АО, РЕО, ВД/СД (залежить від типу ПС), АОз. */
export const ARTICLE_205_IDS = Object.freeze(['ao', 'reo', 'vd_sd', 'aoz']);

/** Назва напряму для типу ПС: вертоліт → «ВД», літак → «СД». */
export function article205Label(id, aircraftKind) {
  if (id === 'ao') return 'АО';
  if (id === 'reo') return 'РЕО';
  if (id === 'aoz') return 'АОз';
  if (id === 'vd_sd') return aircraftKind === 'airplane' ? 'СД' : 'ВД';
  return String(id);
}

export function article205Directions(aircraftKind) {
  return ARTICLE_205_IDS.map(id => ({ id, label: article205Label(id, aircraftKind) }));
}

/**
 * Стан Статті 205 (період `article205Months`, типово 6 міс). «Дійсно» лише коли здані всі
 * чотири напрями; «скоро»/«прострочено» — за найранішим строком. Напрям без дати — не здано
 * (прострочено, missing). Якщо про Статтю 205 взагалі нічого не внесено — null (невідомо).
 */
export function article205State(person, today, settings = DEFAULT_SETTINGS) {
  const data = person?.article205;
  if (!data || typeof data !== 'object') return null;
  const hasAny = ARTICLE_205_IDS.some(id => normalizeDate(data[id]?.date));
  if (!hasAny) return null;
  const months = settings.article205Months ?? DEFAULT_SETTINGS.article205Months;
  const soonDays = settings.soonDays ?? SOON_DAYS;
  const directions = ARTICLE_205_IDS.map(id => {
    const date = normalizeDate(data[id]?.date);
    const dueDate = date ? addMonths(date, months) : null;
    return {
      id,
      label: article205Label(id, person.aircraftKind),
      date,
      acceptedBy: data[id]?.acceptedBy ?? null,
      dueDate,
      daysLeft: dueDate ? daysLeft(dueDate, today) : null,
      status: date ? deadlineStatus(dueDate, today, soonDays) : STATUS.OVERDUE,
      missing: !date,
    };
  });
  const missing = directions.filter(d => d.missing);
  const known = directions.filter(d => d.dueDate);
  const earliest = known.reduce((best, d) => (!best || d.dueDate < best.dueDate ? d : best), null);
  let status;
  if (missing.length) status = STATUS.OVERDUE;
  else status = earliest.status;
  return {
    status,
    directions,
    missing: missing.map(d => d.label),
    earliest: earliest ? { id: earliest.id, label: earliest.label } : null,
    dueDate: missing.length ? null : earliest.dueDate,
    daysLeft: missing.length ? null : earliest.daysLeft,
    blocks: status === STATUS.OVERDUE,
  };
}

// ───────────────────────────── ОВП ─────────────────────────────

/**
 * ОВП (особливі випадки польоту, перевірка знань). Період і блокування — з налаштувань
 * (припущення: 12 міс, блокує). person.ovp = { date }.
 */
export function ovpState(person, today, settings = DEFAULT_SETTINGS) {
  const date = normalizeDate(person?.ovp?.date);
  if (!date) return null;
  const months = settings.ovpMonths ?? DEFAULT_SETTINGS.ovpMonths;
  const dueDate = addMonths(date, months);
  const status = deadlineStatus(dueDate, today, settings.soonDays ?? SOON_DAYS);
  return {
    status,
    date,
    dueDate,
    daysLeft: daysLeft(dueDate, today),
    months,
    blocks: Boolean(settings.ovpBlocks ?? DEFAULT_SETTINGS.ovpBlocks) && status === STATUS.OVERDUE,
  };
}

// ───────────────────────────── Стрибки з парашутом ─────────────────────────────

/**
 * Стрибки (наказ № 736, п. 7–9): 2 на календарний рік, перерва між стрибками ≤ 15 міс.
 * person.jumps = [{date}], person.jumpExemptUntil — звільнення за медичними рекомендаціями
 * (поки діє — стан 'exempt', не рахується й не блокує). Немає записів — null.
 */
export function jumpsState(person, today, settings = DEFAULT_SETTINGS) {
  const exemptUntil = normalizeDate(person?.jumpExemptUntil);
  if (exemptUntil && exemptUntil >= today) {
    return { status: 'exempt', exemptUntil, blocks: false };
  }
  const dates = (Array.isArray(person?.jumps) ? person.jumps : [])
    .map(jump => normalizeDate(jump?.date)).filter(Boolean);
  if (!dates.length) return null;
  const lastDate = maxDate(dates);
  const gap = settings.jumpsMaxGapMonths ?? DEFAULT_SETTINGS.jumpsMaxGapMonths;
  const norm = settings.jumpsPerYear ?? DEFAULT_SETTINGS.jumpsPerYear;
  const dueDate = addMonths(lastDate, gap);
  const status = deadlineStatus(dueDate, today, settings.soonDays ?? SOON_DAYS);
  const year = yearOf(today);
  const yearCount = dates.filter(d => yearOf(d) === year).length;
  return {
    status,
    lastDate,
    dueDate,
    daysLeft: daysLeft(dueDate, today),
    yearCount,
    yearNorm: norm,
    yearDeficit: Math.max(0, norm - yearCount),
    blocks: status === STATUS.OVERDUE,
  };
}

// ───────────────────────────── Перевірки за ролями (КБПВ п. 1.1.10) ─────────────────────────────

/**
 * Види перевірок техніки/пілотування. `months`: число або { high, low } (снайпер/1/2 клас проти
 * 3 клас/без класу). Джерело — КБПВ-2018 п. 1.1.10 (КЕ), п. 4.5.1 (ЛШ), п. 4.5.3 (борттехнік).
 * Контрольний політ на допуск чи відновлення зараховується як перевірка.
 */
export const CHECK_TYPES = Object.freeze([
  Object.freeze({ id: 'aerobatics', label: 'Простий або складний пілотаж', roles: ['КЕ'], months: 12 }),
  Object.freeze({ id: 'combat_nav', label: 'Бойове застосування і навігація на ГМВ без РТЗ', roles: ['КЕ', 'ЛШ'], months: 12 }),
  Object.freeze({ id: 'instr_backup', label: 'Пілотування за дублюючими приладами, захід за дублюючими РТЗ', roles: ['КЕ'], months: { high: 12, low: 6 } }),
  Object.freeze({ id: 'instr_landing', label: 'Пілотування за приладами, захід за посадковими системами', roles: ['КЕ'], months: { high: 12, low: 6 } }),
  Object.freeze({ id: 'engine_failure', label: 'Імітація відмови або вимкнення двигуна', roles: ['КЕ'], months: 12 }),
  Object.freeze({ id: 'restricted_site', label: 'Посадка на майданчик обмежених розмірів', roles: ['КЕ'], months: 12 }),
  Object.freeze({ id: 'instructor_seat', label: 'Інструктор: з інструкторського сидіння', roles: ['КЕ', 'Борттехнік'], months: 12, instructorOnly: true }),
  Object.freeze({ id: 'lsh_technique', label: 'Техніка пілотування зі свого робочого місця', roles: ['ЛШ'], months: { high: 6, low: 3 } }),
  Object.freeze({ id: 'flight_engineer', label: 'Планова перевірка борттехніка', roles: ['Борттехнік'], months: 12 }),
]);

export function checkTypeById(id) {
  return CHECK_TYPES.find(type => type.id === id) || null;
}

function resolveMonths(months, classQual) {
  if (typeof months === 'number') return months;
  return months[classGroup(classQual)];
}

/** Перевірки, що діють для людини: за роллю, класом, ознакою інструктора. */
export function checkTypesForPerson(person) {
  return CHECK_TYPES
    .filter(type => type.roles.includes(person?.role) && (!type.instructorOnly || person?.instructor === true))
    .map(type => ({
      id: type.id,
      label: type.label,
      months: resolveMonths(type.months, person?.classQual),
      blocks: true,
    }));
}

/**
 * Стан кожної обов'язкової перевірки людини за останнім записом. Немає запису — status null
 * (дані не внесено; у лічильники й блокування не входить, нічого не вигадуємо).
 * checks: [{personId, kind, date}].
 */
export function checkStates(person, checks, today, settings = DEFAULT_SETTINGS) {
  const own = (Array.isArray(checks) ? checks : []).filter(check => check?.personId === person?.id);
  return checkTypesForPerson(person).map(type => {
    const lastDate = maxDate(own.filter(check => check.kind === type.id).map(check => check.date));
    const dueDate = lastDate ? addMonths(lastDate, type.months) : null;
    return {
      ...type,
      lastDate,
      dueDate,
      daysLeft: dueDate ? daysLeft(dueDate, today) : null,
      status: dueDate ? deadlineStatus(dueDate, today, settings.soonDays ?? SOON_DAYS) : null,
    };
  });
}

/** Записи польотів людини: власник запису або позивний в екіпажі. */
export function flightsOfPerson(flights, person) {
  return (Array.isArray(flights) ? flights : []).filter(flight =>
    flight && (flight.personId === person?.id
      || (Array.isArray(flight.crew) && person?.callsign && flight.crew.includes(person.callsign))));
}

export function lastFlightDate(person, flights, today) {
  return maxDate(flightsOfPerson(flights, person).map(f => f.date).filter(date => !today || normalizeDate(date) <= today));
}

/**
 * Довга перерва в польотах від останнього польоту. Усі ролі: понад 4 міс — потрібна перевірка
 * знань КЛЕ та АРЗ (ПвПДАУ гл. 3 п. 16; для борттехніка — позачергова перевірка). ЛШ: понад
 * 5 міс (3-й клас і без класу) або 6 міс (2-й клас і вище) — план введення в стрій.
 * Немає жодного польоту в даних — null (невідомо).
 */
export function longBreakState(person, flights, today) {
  const last = lastFlightDate(person, flights, today);
  if (!last) return null;
  const knowledgeLimit = addMonths(last, 4);
  const out = {
    lastFlightDate: last,
    needsKnowledgeCheck: today > knowledgeLimit,
    needsIntroPlan: false,
  };
  if (person?.role === 'ЛШ') {
    out.needsIntroPlan = today > addMonths(last, classGroup(person.classQual) === 'low' ? 5 : 6);
  }
  return out;
}

// ───────────────────────────── Перерви й допуски ─────────────────────────────

/**
 * Таблиця 1 КБПВ-2018 п. 1.1: максимальні перерви (міс) за видами польоту й класом, [день, ніч].
 * Колонки: high — снайпер/1 кл., second — 2 кл., low — 3 кл./без класу.
 */
export const TABLE1_BREAKS = Object.freeze({
  site: Object.freeze({ label: 'Посадка на майданчик обмежених розмірів', high: [8, 6], second: [6, 4], low: [4, 3] }),
  external_load: Object.freeze({ label: 'Вантаж на зовнішній підвісці, евакуація з висіння', high: [8, 6], second: [6, 4], low: [4, 3] }),
  external_load_water: Object.freeze({ label: 'Над водою поза видимістю берега (з ГАС)', high: [6, 4], second: [5, 3], low: [4, 2] }),
  group: Object.freeze({ label: 'Груповий політ (веденим)', high: [8, 6], second: [6, 4], low: [4, 3] }),
  weapons: Object.freeze({ label: 'Застосування засобів ураження (за кожним видом окремо)', high: [12, 10], second: [10, 8], low: [8, 6] }),
});

/**
 * Додаток 5 ПвПДАУ, пілотування з подвійним управлінням (вертольоти Мі-8/Мі-24): максимальні
 * перерви (міс) за метеоумовами й добою. ПРИПУЩЕННЯ: таблицю складено для літаків, рішення для
 * вертольотів за власником/методичною радою; фактичні перерви встановлює командир підрозділу.
 */
export const APP5_DUAL_BREAKS = Object.freeze({
  'ПМУ': Object.freeze({ day: { high: 4, second: 3, low: 2.5 }, night: { high: 4, second: 3, low: 2.5 } }),
  'СМУ': Object.freeze({ day: { high: 4, second: 3, low: 2.5 }, night: { high: 4, second: 3, low: 2.5 } }),
  'мінімум': Object.freeze({ day: { high: 3, second: 2.5, low: 1.5 }, night: { high: 3, second: 2.5, low: 1.5 } }),
});

/** Перерва борттехніка: понад 4 міс. ЛШ: 5 (3 кл./без класу) або 6 (2 кл. і вище) міс. */
export function roleBreakMonths(person) {
  if (person?.role === 'Борттехнік') return 4;
  if (person?.role === 'ЛШ') return classGroup(person.classQual) === 'low' ? 5 : 6;
  return null;
}

const dn = (day, night) => Object.freeze({ day: Object.freeze(day), night: Object.freeze(night) });

/**
 * Довідник допусків за ролями (КБПВ Таблиця 3 для КЕ, Таблиця 1 програми п'ятої для ЛШ,
 * п. 4.5.3 для борттехніка). `exercises` — вправи (день/ніч), якими допуск надається і
 * підтримується; перша з них — підказка для поновлення. `rule` — як рахується перерва:
 * { type:'table1', row } | { type:'app5', meteo } | { type:'roleBreak' } | { type:'fixed', months } | null.
 */
export const ADMISSION_KINDS = Object.freeze([
  // КЕ
  { id: 'circle', label: 'По колу', roles: ['КЕ', 'ЛШ'], exercises: dn([3], [103]), rule: null },
  { id: 'zone', label: 'У зону', roles: ['КЕ', 'ЛШ'], exercises: dn([7], [107]), rule: null },
  { id: 'site', label: 'На майданчик обмежених розмірів', roles: ['КЕ'], exercises: dn([9], [109]), rule: { type: 'table1', row: 'site' } },
  { id: 'route', label: 'Маршрут', roles: ['КЕ', 'ЛШ'], exercises: dn([14], [114]), rule: null },
  { id: 'group', label: 'Групові польоти', roles: ['КЕ'], exercises: dn([16], [116]), rule: { type: 'table1', row: 'group' } },
  { id: 'aerobatics', label: 'Пілотаж', roles: ['КЕ'], exercises: dn([20], [120]), rule: null },
  { id: 'clouds', label: 'У хмарах', roles: ['КЕ', 'ЛШ'], exercises: dn([26, 24], [126, 124]), rule: null },
  { id: 'route_smu', label: 'Маршрут у СМУ', roles: ['КЕ', 'ЛШ'], exercises: dn([28], [128]), rule: { type: 'app5', meteo: 'СМУ' } },
  { id: 'weapons', label: 'Види озброєння', roles: ['КЕ'], exercises: dn([35, 36, 37, 38], [135, 136, 137, 138]), rule: { type: 'table1', row: 'weapons' } },
  { id: 'ground_targets', label: 'Бойові дії по наземних цілях', roles: ['КЕ'], exercises: dn([44], [144]), rule: { type: 'table1', row: 'weapons' } },
  { id: 'landing', label: 'Десантування', roles: ['КЕ'], exercises: dn([49], [149]), rule: null },
  { id: 'external_load', label: 'Зовнішня підвіска', roles: ['КЕ'], exercises: dn([51], [151]), rule: { type: 'table1', row: 'external_load' } },
  { id: 'transport', label: 'Десантно-транспортні завдання', roles: ['КЕ'], exercises: dn([53], [153]), rule: null },
  { id: 'mining', label: 'Мінування', roles: ['КЕ'], exercises: dn([54], [154]), rule: null },
  { id: 'onb', label: 'ОНБ', roles: ['КЕ', 'ЛШ'], exercises: dn([], []), rule: null },
  { id: 'instructor_work', label: 'Інструкторська робота', roles: ['КЕ', 'Борттехнік'], exercises: dn([], []), rule: { type: 'fixed', months: 12 } },
  // ЛШ (Таблиця 1 програми п'ятої)
  { id: 'lsh_combat', label: 'БЗ льотчика-штурмана (76м, 78м)', roles: ['ЛШ'], exercises: dn(['76м', '78м'], ['176м', '178м']), rule: { type: 'roleBreak' } },
  // Борттехнік (п. 4.5.3, Таблиця 6)
  { id: 'bt_solo', label: 'Самостійні польоти', roles: ['Борттехнік'], exercises: dn([260], [270]), rule: { type: 'roleBreak' } },
  { id: 'bt_weapons', label: 'БЗ: озброєння', roles: ['Борттехнік'], exercises: dn([263], [273]), rule: { type: 'roleBreak' } },
  { id: 'bt_winch', label: 'БЗ: лебідка', roles: ['Борттехнік'], exercises: dn([263], [273]), rule: { type: 'roleBreak' } },
  { id: 'bt_external_load', label: 'БЗ: зовнішня підвіска', roles: ['Борттехнік'], exercises: dn([263], [273]), rule: { type: 'roleBreak' } },
  { id: 'bt_landing', label: 'БЗ: десантування', roles: ['Борттехнік'], exercises: dn([263], [273]), rule: { type: 'roleBreak' } },
  { id: 'bt_transport', label: 'БЗ: перевезення', roles: ['Борттехнік'], exercises: dn([263], [273]), rule: { type: 'roleBreak' } },
  { id: 'bt_adapter', label: 'БЗ: «Адаптер»', roles: ['Борттехнік'], exercises: dn([263], [273]), rule: { type: 'roleBreak' } },
  { id: 'bt_water', label: 'БЗ: водозливний пристрій', roles: ['Борттехнік'], exercises: dn([263], [273]), rule: { type: 'roleBreak' } },
  { id: 'bt_one_engine', label: 'Один працюючий двигун', roles: ['Борттехнік'], exercises: dn([260], [270]), rule: { type: 'roleBreak' } },
].map(kind => Object.freeze({ ...kind, roles: Object.freeze(kind.roles) })));

export const ADMISSION_STATUSES = Object.freeze(['valid', 'lost']);

export function admissionKindById(id) {
  return ADMISSION_KINDS.find(kind => kind.id === id) || null;
}

export function admissionKindsForRole(role) {
  return ADMISSION_KINDS.filter(kind => kind.roles.includes(role));
}

/** Короткі назви вправ для підказок (за каталогом КБПВ; нічні номери = денні + 100). */
export const EXERCISE_NAMES = Object.freeze({
  3: 'по колу',
  7: 'у зону',
  9: 'на майданчик обмежених розмірів поза аеродромом',
  14: 'по маршруту з посадкою на майданчику поза аеродромом',
  16: 'групова злітаність',
  20: 'у зону на пілотаж',
  24: 'у зону у хмарах',
  26: 'у хмарах із заходом за посадковими системами',
  28: 'по маршруту у складних метеоумовах',
  35: 'пуск керованих ракет по наземних цілях',
  36: 'стрільба некерованими ракетами',
  37: 'стрільба зі стрілецько-гарматного озброєння',
  38: 'бомбометання',
  44: 'заліковий політ на застосування засобів ураження',
  49: 'десантування військ парашутним способом',
  51: 'з вантажем на зовнішній підвісці',
  53: 'заліковий політ на десантно-транспортні завдання',
  54: 'мінування з повітря',
});

/** Назва вправи або null (невідомо; нічого не вигадуємо). */
export function exerciseName(exercise) {
  const number = parseInt(exercise, 10);
  if (!Number.isFinite(number)) return null;
  return EXERCISE_NAMES[number] || EXERCISE_NAMES[number % 100] || null;
}

/**
 * Підказка, якою вправою поновити допуск (контрольний політ за вправою допуску).
 * @returns {{exercise, name, text}|null}
 */
export function renewalHint(kindId, dayNight = 'day') {
  const kind = admissionKindById(kindId);
  if (!kind) return null;
  const list = kind.exercises[dayNight === 'night' ? 'night' : 'day'];
  if (!list.length) {
    return { exercise: null, name: null, text: `Поновити: контрольний політ з інструктором («${kind.label}»).` };
  }
  const exercise = list[0];
  const name = exerciseName(exercise);
  return {
    exercise,
    name,
    text: `Поновити: контрольний політ за вправою ${exercise}${name ? ` (${name})` : ''}.`,
  };
}

/** Ліміт перерви (міс) для допуску людини в умовах dayNight ('day'|'night') або null (не нормовано). */
export function admissionBreakLimit(kind, person, dayNight = 'day') {
  const rule = kind?.rule;
  if (!rule) return null;
  const idx = dayNight === 'night' ? 1 : 0;
  if (rule.type === 'table1') return TABLE1_BREAKS[rule.row]?.[classColumn(person?.classQual)]?.[idx] ?? null;
  if (rule.type === 'app5') return APP5_DUAL_BREAKS[rule.meteo]?.[dayNight === 'night' ? 'night' : 'day']?.[classColumn(person?.classQual)] ?? null;
  if (rule.type === 'roleBreak') return roleBreakMonths(person);
  if (rule.type === 'fixed') return rule.months;
  return null;
}

function exerciseKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Поточний стан допуску. Пілот відмічає допуск сам; затвердження немає. Допуск автоматично
 * стає 'lost', якщо від останнього використання (дата допуску або останній політ за
 * вправами допуску; для ЛШ/борттехніка — останній політ узагалі) минуло більше за ліміт
 * перерви. Вручну позначений 'lost' лишається таким, доки пілот не відмітить допуск знову.
 * @returns {{status, auto, lastUseDate, limitMonths, limitDate, hint}}
 */
export function evaluateAdmission(admission, person, flights, today) {
  const kind = admissionKindById(admission?.kind);
  const dayNight = admission?.dayNight === 'night' ? 'night' : 'day';
  const grantedAt = normalizeDate(admission?.grantedAt);
  const base = { status: admission?.status === 'lost' ? 'lost' : 'valid', auto: false, lastUseDate: grantedAt, limitMonths: null, limitDate: null, hint: null };
  if (!kind) return base;
  const limitMonths = admissionBreakLimit(kind, person, dayNight);
  const own = flightsOfPerson(flights, person).filter(f => normalizeDate(f.date) && normalizeDate(f.date) <= today);
  let uses;
  if (kind.rule?.type === 'roleBreak') {
    uses = own.map(f => f.date);
  } else {
    const wanted = new Set(kind.exercises[dayNight].map(exerciseKey));
    uses = own.filter(f => wanted.has(exerciseKey(f.exercise))).map(f => f.date);
  }
  const lastUseDate = maxDate([grantedAt, ...uses]);
  const limitDate = limitMonths !== null && lastUseDate ? addMonthsFrac(lastUseDate, limitMonths) : null;
  const exceeded = Boolean(limitDate) && today > limitDate;
  const status = base.status === 'lost' || exceeded ? 'lost' : 'valid';
  return {
    status,
    auto: exceeded && base.status !== 'lost',
    lastUseDate,
    limitMonths,
    limitDate,
    hint: status === 'lost' ? renewalHint(kind.id, dayNight) : null,
  };
}

/** Допуски людини з обчисленим станом: [{ admission, evaluation }]. */
export function evaluateAdmissions(person, admissions, flights, today) {
  return (Array.isArray(admissions) ? admissions : [])
    .filter(admission => admission?.personId === person?.id)
    .map(admission => ({ admission, evaluation: evaluateAdmission(admission, person, flights, today) }));
}

/**
 * Новий запис допуску (самовідмітка). Повертає { ok, value } або { ok:false, errors }.
 * Поля: id, personId, kind, dayNight, exercise, grantedAt, orderRef (запис у ЛКнизі, необов'язково).
 */
export function createAdmission(raw) {
  const errors = [];
  if (!raw?.id) errors.push('Не вказано ідентифікатор допуску.');
  if (!raw?.personId) errors.push('Не вказано пілота.');
  if (!admissionKindById(raw?.kind)) errors.push('Невідомий вид допуску.');
  const grantedAt = normalizeDate(raw?.grantedAt);
  if (!grantedAt) errors.push('Дата допуску має бути у форматі дд.мм.рррр.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: String(raw.id),
      personId: String(raw.personId),
      kind: raw.kind,
      dayNight: raw.dayNight === 'night' ? 'night' : 'day',
      exercise: raw.exercise == null || raw.exercise === '' ? null : String(raw.exercise),
      grantedAt,
      orderRef: raw.orderRef ? String(raw.orderRef) : null,
      status: 'valid',
    },
  };
}

/** Повторна відмітка допуску після контрольного польоту: нова дата, статус 'valid'. */
export function renewAdmission(admission, { date, exercise = null, orderRef = null } = {}) {
  const grantedAt = normalizeDate(date);
  if (!grantedAt) return null;
  return {
    ...admission,
    grantedAt,
    exercise: exercise == null ? admission.exercise ?? null : String(exercise),
    orderRef: orderRef ?? admission.orderRef ?? null,
    status: 'valid',
  };
}

// ───────────────────────────── Елементи контролю, блокування ─────────────────────────────

/**
 * Усі відстежувані строки людини: [{ personId, callsign, role, link, key, label, dueDate,
 * daysLeft, status, blocks, detail }]. У список потрапляють лише ті, де є дані (status
 * 'valid' | 'soon' | 'overdue'); невідомі й звільнені (exempt) не рахуються.
 * ctx: { checks, settings }.
 */
export function personItems(person, today, ctx = {}) {
  const settings = resolveSettings(ctx.settings);
  const head = { personId: person.id, callsign: person.callsign, role: person.role, link: person.link ?? null };
  const items = [];
  const push = (key, label, state, detail = null) => {
    if (state && [STATUS.VALID, STATUS.SOON, STATUS.OVERDUE].includes(state.status)) {
      items.push({
        ...head,
        key,
        label,
        dueDate: state.dueDate ?? null,
        daysLeft: state.daysLeft ?? null,
        status: state.status,
        blocks: Boolean(state.blocks),
        detail,
      });
    }
  };
  const medical = medicalState(person, today, settings.soonDays);
  push('medical', medical ? medical.nextKind : 'ВЛК/ПМО', medical, medical ? `Попередня ${medical.lastKind}: ${formatDate(medical.lastDate)}` : null);
  const art = article205State(person, today, settings);
  push('article205', 'Стаття 205', art, art
    ? (art.missing.length ? `Не здано: ${art.missing.join(', ')}` : `Найраніше: ${art.earliest.label}`)
    : null);
  push('ovp', 'ОВП', ovpState(person, today, settings));
  push('jumps', 'Стрибки', jumpsState(person, today, settings));
  for (const state of checkStates(person, ctx.checks, today, settings)) {
    push(`check:${state.id}`, state.label, state);
  }
  return items;
}

/** Підпис причини блокування за ключем елемента. */
const BLOCK_LABELS = Object.freeze({
  medical: kind => `Прострочена ${kind}`,
  article205: () => 'Прострочена Стаття 205',
  ovp: () => 'Прострочено ОВП',
  jumps: () => 'Перерва між стрибками перевищена',
});

/**
 * Причини, через які людину не можна допускати до польотів (прострочені ВЛК/ПМО, Стаття 205,
 * ОВП — якщо так налаштовано, стрибки, обов'язкові перевірки за роллю). Порожній масив — перешкод
 * немає. Допуски (admissions) польоти не блокують — це особиста відмітка про види завдань.
 * @returns {{code, label, dueDate, daysOverdue}[]}
 */
export function flightBlockers(person, today, ctx = {}) {
  return personItems(person, today, ctx)
    .filter(item => item.status === STATUS.OVERDUE && item.blocks)
    .map(item => {
      const make = BLOCK_LABELS[item.key];
      const label = make ? make(item.label) : `Прострочено: ${item.label}`;
      return {
        code: item.key,
        label,
        dueDate: item.dueDate,
        daysOverdue: item.daysLeft === null ? null : -item.daysLeft,
      };
    });
}

// ───────────────────────────── Зведення командира ─────────────────────────────

function filterItems(items, filter = {}) {
  return items.filter(item =>
    (!filter.link || item.link === filter.link)
    && (!filter.role || item.role === filter.role)
    && (!filter.status || item.status === filter.status));
}

/** Календар строків: за зростанням дати; прострочені першими; без дати — в кінці. */
export function sortCalendar(items) {
  return [...items].sort((a, b) => {
    if (a.dueDate === b.dueDate) return String(a.callsign).localeCompare(String(b.callsign), 'uk');
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
}

/** Значення фільтрів зведення: ланки й ролі, що є в особовому складі. */
export function filterOptions(persons) {
  const list = Array.isArray(persons) ? persons : [];
  return {
    links: [...new Set(list.map(p => p.link).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk')),
    roles: ROLES.filter(role => list.some(p => p.role === role)),
  };
}

/**
 * Зведення командира: лічильники строків (прострочено / скоро / дійсні), перелік проблем,
 * найближчі строки, заблоковані. Фільтри: { link, role, status }. Лічильник рахує окремі
 * строки (ВЛК/ПМО, Стаття 205, ОВП, стрибки, перевірки за роллю), а не людей.
 * ctx: { checks, settings }.
 */
export function commanderSummary(persons, ctx, today, filter = {}) {
  const list = (Array.isArray(persons) ? persons : [])
    .filter(p => (!filter.link || p.link === filter.link) && (!filter.role || p.role === filter.role));
  const all = list.flatMap(person => personItems(person, today, ctx));
  const items = filterItems(all, { status: filter.status });
  const counters = { overdue: 0, soon: 0, valid: 0, total: 0 };
  for (const item of all) {
    counters[item.status] += 1;
    counters.total += 1;
  }
  const blocked = list
    .map(person => ({ personId: person.id, callsign: person.callsign, blockers: flightBlockers(person, today, ctx) }))
    .filter(entry => entry.blockers.length);
  return {
    counters,
    items,
    problems: sortCalendar(all.filter(item => item.status !== STATUS.VALID)),
    calendar: sortCalendar(items),
    blocked,
  };
}

/**
 * Найближчі строки: від сьогодні на `horizonDays` вперед (прострочені включаються, якщо
 * includeOverdue), за зростанням дати, не більше `limit`.
 */
export function upcomingDeadlines(items, today, { horizonDays = 90, includeOverdue = true, limit = Infinity } = {}) {
  return sortCalendar(items.filter(item => {
    if (item.dueDate === null) return false;
    if (item.daysLeft < 0) return includeOverdue;
    return item.daysLeft <= horizonDays;
  })).slice(0, limit);
}

// ───────────────────────────── Нагадування ─────────────────────────────

/** Рівень нагадування: 'overdue', найменший поріг ≥ залишку діб (30/14/7) або null. */
export function reminderLevel(left, thresholds = DEFAULT_SETTINGS.reminderDays) {
  if (left === null || left === undefined) return null;
  if (left < 0) return 'overdue';
  const sorted = [...thresholds].sort((a, b) => a - b);
  return sorted.find(t => left <= t) ?? null;
}

/**
 * Локальні нагадування за 30/14/7 днів (без сповіщень ОС): чиста функція над items.
 * @returns {{personId, callsign, key, label, dueDate, daysLeft, level, message}[]}
 */
export function buildReminders(items, today, thresholds = DEFAULT_SETTINGS.reminderDays) {
  const out = [];
  for (const item of items) {
    const level = reminderLevel(item.daysLeft, thresholds);
    if (level === null) continue;
    let when;
    if (level === 'overdue') when = `прострочено на ${-item.daysLeft} ${pluralDays(item.daysLeft)}`;
    else if (item.daysLeft === 0) when = 'строк сьогодні';
    else when = `через ${item.daysLeft} ${pluralDays(item.daysLeft)}`;
    out.push({
      personId: item.personId,
      callsign: item.callsign,
      key: item.key,
      label: item.label,
      dueDate: item.dueDate,
      daysLeft: item.daysLeft,
      level,
      message: `${item.label} ${item.callsign}: ${when}`,
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.callsign.localeCompare(b.callsign, 'uk'));
}

// ───────────────────────────── Тривалість HH:MM ─────────────────────────────

/** `1:25` → 85 хв; `0:00` → 0; порожнє/некоректне → null. Допустимі години до 99, хвилини 00–59. */
export function parseDuration(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : null;
  const match = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(value).trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]) + (match[3] && Number(match[3]) >= 30 ? 1 : 0);
}

/** 85 → `1:25`; null → null (UI покаже тире). */
export function formatDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) return null;
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

// ───────────────────────────── Хронометраж зміни ─────────────────────────────

function exerciseNumber(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** Польоти на пілотаж: вправа 20 / 120 або явна ознака `aerobatics`. */
export function isAerobaticsFlight(flight) {
  if (flight?.aerobatics === true) return true;
  const n = exerciseNumber(flight?.exercise);
  return n === 20 || n === 120;
}

/**
 * Польоти ОНБ (окремий норматив): явна ознака `onb` або позначка «онб» у номері вправи
 * (`102онб`). Самі номери 102–118 не використовуємо: 103, 107, 114 — також звичайні нічні вправи.
 */
export function isOnbFlight(flight) {
  return flight?.onb === true || /онб/i.test(String(flight?.exercise ?? ''));
}

/** Записи однієї зміни: за shiftId або (без нього) за датою. */
export function flightsOfShift(flights, shift) {
  return (Array.isArray(flights) ? flights : []).filter(flight =>
    flight && (flight.shiftId ? flight.shiftId === shift?.id : flight.date === shift?.date));
}

const crewKey = flight => {
  const names = Array.isArray(flight.crew) && flight.crew.length ? flight.crew : [flight.personId ?? '?'];
  return [...names].sort().join('+');
};

/**
 * Підсумок льотної зміни: кількість екіпажів, зльотів, наліт; на кожного пілота — польоти на
 * пілотаж проти ліміту (типово 4) і норма ОНБ (≤ 3 год за зміну, ≤ 2 год за політ).
 * Невідомий наліт не додається й не вгадується: рахується в `unknownAirtime`.
 * opts: { settings, persons, today } — з persons/today додається попередження про польоти
 * заблокованих пілотів.
 */
export function shiftSummary(shiftFlights, opts = {}) {
  const settings = resolveSettings(opts.settings);
  const list = (Array.isArray(shiftFlights) ? shiftFlights : []).filter(Boolean);
  const personsById = new Map((opts.persons || []).map(p => [p.id, p]));
  const crews = new Map();
  const pilots = new Map();
  let takeoffs = 0;
  let airtimeMin = 0;
  let unknownAirtime = 0;
  const warnings = [];
  for (const flight of list) {
    const count = Number.isInteger(flight.count) && flight.count > 0 ? flight.count : 0;
    takeoffs += count;
    const known = Number.isInteger(flight.airtimeMin);
    if (known) airtimeMin += flight.airtimeMin; else unknownAirtime += 1;
    const key = crewKey(flight);
    const crew = crews.get(key) || { key, callsigns: Array.isArray(flight.crew) ? [...flight.crew] : [], flights: 0, airtimeMin: 0, unknownAirtime: 0 };
    crew.flights += count;
    if (known) crew.airtimeMin += flight.airtimeMin; else crew.unknownAirtime += 1;
    crews.set(key, crew);

    const id = flight.personId ?? null;
    const pilot = pilots.get(id) || { personId: id, callsign: personsById.get(id)?.callsign ?? null, flights: 0, airtimeMin: 0, aerobaticsFlights: 0, onbMin: 0 };
    pilot.flights += count;
    if (known) pilot.airtimeMin += flight.airtimeMin;
    if (isAerobaticsFlight(flight)) pilot.aerobaticsFlights += count;
    if (isOnbFlight(flight) && known) pilot.onbMin += flight.airtimeMin;
    pilots.set(id, pilot);

    if (isOnbFlight(flight) && known && count > 0 && flight.airtimeMin / count > settings.onbMaxFlightMin) {
      warnings.push({ code: 'onb-flight', personId: id, message: `ОНБ: політ понад ${settings.onbMaxFlightMin / 60} год (${formatDuration(Math.round(flight.airtimeMin / count))} у середньому).` });
    }
  }
  const perPilot = [...pilots.values()].map(pilot => {
    const out = {
      ...pilot,
      aerobaticsLimit: settings.aerobaticsLimit,
      aerobaticsLimitReached: pilot.aerobaticsFlights >= settings.aerobaticsLimit,
      aerobaticsOver: pilot.aerobaticsFlights > settings.aerobaticsLimit,
      onbOver: pilot.onbMin > settings.onbMaxShiftMin,
    };
    if (out.aerobaticsOver) warnings.push({ code: 'aerobatics-over', personId: pilot.personId, message: `Пілотаж: понад ліміт ${settings.aerobaticsLimit} польоти за зміну.` });
    if (out.onbOver) warnings.push({ code: 'onb-shift', personId: pilot.personId, message: `ОНБ: понад ${settings.onbMaxShiftMin / 60} год за зміну.` });
    const person = personsById.get(pilot.personId);
    if (person && opts.today && flightBlockers(person, opts.today, opts.ctx || {}).length) {
      warnings.push({ code: 'blocked', personId: pilot.personId, message: `${person.callsign}: є підстави, що блокують допуск до польотів.` });
    }
    return out;
  });
  return {
    crews: crews.size,
    crewList: [...crews.values()],
    takeoffs,
    airtimeMin,
    airtime: formatDuration(airtimeMin),
    unknownAirtime,
    perPilot,
    warnings,
  };
}

// ───────────────────────────── Льотна книжка ─────────────────────────────

export const FLIGHT_SOURCES = Object.freeze(['timekeeper', 'trip', 'import', 'logbook']);

const EXERCISE_RE = /^\d{1,3}[a-zа-яіїє]{0,3}$/i;

/** Номер вправи як рядок (`14`, `76м`) або null. */
export function normalizeExercise(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && EXERCISE_RE.test(text) ? text : null;
}

/**
 * Перевіряє й нормалізує запис польоту. Невідомий наліт/вправа — null (нічого не вигадуємо).
 * Вхід: { id, date, shiftId, personId, crew[], exercise, count, airtime 'HH:MM' | airtimeMin,
 * dayNight, meteo, aircraftType, tailNumber, source, note }.
 * @returns {{ok:true, value}|{ok:false, errors:string[]}}
 */
export function normalizeFlight(raw) {
  const errors = [];
  const date = normalizeDate(raw?.date);
  if (!date) errors.push('Вкажіть дату польоту (дд.мм.рррр).');
  const count = Number(raw?.count);
  if (!Number.isInteger(count) || count < 1) errors.push('Кількість польотів має бути цілим числом від 1.');
  let airtimeMin = null;
  const hasAirtime = raw?.airtimeMin !== undefined && raw?.airtimeMin !== null && raw?.airtimeMin !== ''
    || (raw?.airtime !== undefined && raw?.airtime !== null && String(raw.airtime).trim() !== '');
  if (hasAirtime) {
    airtimeMin = parseDuration(raw.airtimeMin ?? raw.airtime);
    if (airtimeMin === null) errors.push('Наліт має бути у форматі год:хв (наприклад, 1:25).');
  }
  let exercise = null;
  if (raw?.exercise !== undefined && raw?.exercise !== null && String(raw.exercise).trim() !== '') {
    exercise = normalizeExercise(raw.exercise);
    if (exercise === null) errors.push('Номер вправи має бути числом (наприклад, 14 або 76м).');
  }
  if (raw?.source !== undefined && raw?.source !== null && !FLIGHT_SOURCES.includes(raw.source)) {
    errors.push('Невідоме джерело запису польоту.');
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: raw.id == null ? null : String(raw.id),
      date,
      shiftId: raw.shiftId ?? null,
      personId: raw.personId ?? null,
      crew: Array.isArray(raw.crew) ? raw.crew.map(String) : [],
      exercise,
      count,
      airtimeMin,
      dayNight: raw.dayNight === 'night' ? 'night' : raw.dayNight === 'day' ? 'day' : null,
      meteo: raw.meteo ?? null,
      aircraftType: raw.aircraftType ?? null,
      tailNumber: raw.tailNumber ?? null,
      aerobatics: raw.aerobatics === true ? true : undefined,
      onb: raw.onb === true ? true : undefined,
      source: raw.source ?? 'logbook',
      note: raw.note ?? null,
    },
  };
}

/**
 * Фільтри льотної книжки: { from, to, exercise, dayNight, source, personId }. Результат —
 * за спаданням дати.
 */
export function filterLogbook(entries, filter = {}) {
  const from = normalizeDate(filter.from);
  const to = normalizeDate(filter.to);
  const exercise = filter.exercise ? exerciseKey(filter.exercise) : null;
  return (Array.isArray(entries) ? entries : [])
    .filter(e => e
      && (!from || e.date >= from)
      && (!to || e.date <= to)
      && (!exercise || exerciseKey(e.exercise) === exercise)
      && (!filter.dayNight || e.dayNight === filter.dayNight)
      && (!filter.source || e.source === filter.source)
      && (!filter.personId || e.personId === filter.personId))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/**
 * Підсумки переліку записів: кількість записів, польотів, сума нальоту (лише відомого),
 * скільки записів без нальоту. `complete` — чи відомий весь наліт без пропусків (інакше UI
 * показує тире для «річного/загального» нальоту, а не вигадану суму).
 */
export function logbookSummary(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let flightsCount = 0;
  let airtimeMin = 0;
  let unknown = 0;
  for (const entry of list) {
    flightsCount += Number.isInteger(entry.count) ? entry.count : 0;
    if (Number.isInteger(entry.airtimeMin)) airtimeMin += entry.airtimeMin; else unknown += 1;
  }
  return {
    entries: list.length,
    flights: flightsCount,
    airtimeMin: list.length ? airtimeMin : null,
    airtime: list.length ? formatDuration(airtimeMin) : null,
    unknownAirtimeEntries: unknown,
    complete: list.length > 0 && unknown === 0,
  };
}

/**
 * Річний і загальний наліт. Відомі лише якщо в профілі є початок обліку:
 * person.baseline = { totalMin, asOf, yearMin } (нальот до дати asOf). Без нього — null (тире).
 * Записи пізніші за asOf додаються; записи без нальоту роблять суму невідомою (null).
 */
export function airtimeTotals(person, flights, today) {
  const baseline = person?.baseline;
  const asOf = normalizeDate(baseline?.asOf);
  const own = flightsOfPerson(flights, person).filter(f => f.personId === person.id);
  const after = asOf ? own.filter(f => f.date > asOf) : [];
  const gaps = after.some(f => !Number.isInteger(f.airtimeMin));
  const sum = after.reduce((s, f) => s + (Number.isInteger(f.airtimeMin) ? f.airtimeMin : 0), 0);
  const year = yearOf(today);
  const sameYear = asOf && yearOf(asOf) === year;
  return {
    totalMin: asOf && Number.isInteger(baseline.totalMin) && !gaps ? baseline.totalMin + sum : null,
    yearMin: sameYear && Number.isInteger(baseline.yearMin) && !gaps
      ? baseline.yearMin + after.filter(f => yearOf(f.date) === year).reduce((s, f) => s + (f.airtimeMin || 0), 0)
      : null,
  };
}

// ───────────────────────────── Імпорт з Excel (шаблон 38 колонок) ─────────────────────────────

const col = (key, title, group) => Object.freeze({ key, title, group });

/**
 * Шаблон імпорту: 38 колонок, розбір за ПОЗИЦІЄЮ (назви «Вправа» ×3 та «Інший екіпаж» ×6
 * повторюються). Порядок: групи зі зразка власника; після «Льотна зміна» додано
 * «Аеродром зльоту» й «Аеродром посадки» (2026-10-19). ПРИПУЩЕННЯ: порядок усередині груп —
 * як у переліку плану; перевірити на справжньому файлі.
 */
export const IMPORT_COLUMNS = Object.freeze([
  col('seq', 'Номер з/п', 'Ідентифікація'),
  col('shift', 'Льотна зміна', 'Ідентифікація'),
  col('airfieldFrom', 'Аеродром зльоту', 'Ідентифікація'),
  col('airfieldTo', 'Аеродром посадки', 'Ідентифікація'),
  col('aircraftType', 'Тип ПС', 'Ідентифікація'),
  col('tailNumber', 'Номер ПС', 'Ідентифікація'),
  col('launch', 'Запуск/проба', 'Умови'),
  col('dayNight', 'День/ніч', 'Умови'),
  col('meteoCond', 'ПМУ/СМУ', 'Умови'),
  col('count', 'Кількість польотів', 'Умови'),
  col('exercise1', 'Вправа', 'Умови'),
  col('exercise2', 'Вправа', 'Умови'),
  col('exercise3', 'Вправа', 'Умови'),
  col('takeoff', 'Зліт', 'Час'),
  col('landing', 'Посадка', 'Час'),
  col('airtime', 'Наліт', 'Час'),
  col('airtimeTotal', 'Наліт загальний', 'Час'),
  col('airtimeClouds', 'Наліт у хмарах', 'Час'),
  col('airtimeHood', 'Наліт під шторкою', 'Час'),
  col('altitude', 'Висота', 'Параметри'),
  col('fuel', 'Витрата палива', 'Параметри'),
  col('fuelProgram', 'Програма виділення палива', 'Параметри'),
  col('commander', 'Командир екіпажу', 'Екіпаж'),
  col('navigator', 'Льотчик-штурман', 'Екіпаж'),
  col('flightEngineer', 'Бортовий технік', 'Екіпаж'),
  ...[1, 2, 3, 4, 5, 6].map(n => col(`crew${n}`, 'Інший екіпаж', 'Екіпаж')),
  col('passengers', 'Пасажири', 'Навантаження'),
  col('cargo', 'Вантаж', 'Навантаження'),
  col('gradeCombat', 'Оцінка за бойове застосування', 'Оцінки й обставини'),
  col('gradeFlight', 'Оцінка за політ', 'Оцінки й обставини'),
  col('meteo', 'Метеоумови', 'Оцінки й обставини'),
  col('rspEvents', 'Заходи РСП', 'Оцінки й обставини'),
  col('rspLandings', 'Посадки РСП', 'Оцінки й обставини'),
].map((c, index) => Object.freeze({ ...c, index })));

export const IMPORT_COLUMN_COUNT = IMPORT_COLUMNS.length;

const isBlank = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const cellText = value => (isBlank(value) ? '' : String(value).trim());

/** Excel-серійне число дати (діб від 30.12.1899) → ISO або null. */
export function excelSerialToIso(serial) {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return null;
  return fromDayNumber(Math.floor(serial) + Math.round(Date.UTC(1899, 11, 30) / MS_DAY));
}

/** Час доби: `ГГ:ХХ`, `ГГ:ХХ:СС` або частка доби Excel (0…<1) → хвилини від півночі, інакше null. */
export function parseTimeOfDay(value) {
  if (isBlank(value)) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
    return Math.round(value * 1440) % 1440;
  }
  const match = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(value).trim());
  if (!match || Number(match[1]) > 23) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Тривалість із клітинки: `Г:ХХ`, `ГГ:ХХ:СС` або частка доби Excel (0…<1; 0 → 0 хв). */
export function parseDurationCell(value) {
  if (isBlank(value)) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
    return Math.round(value * 1440);
  }
  return parseDuration(String(value));
}

function parseNumber(value) {
  if (isBlank(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value).trim().replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

/**
 * Витрата палива `255/208` → { first: 255, second: 208 }. Зміст чисел шаблон не пояснює, тому
 * назви нейтральні. Некоректний формат — null.
 */
export function parseFuel(value) {
  const parts = cellText(value).split('/').map(p => parseNumber(p));
  if (parts.length !== 2 || parts.some(n => n === null || Number.isNaN(n))) return null;
  return { first: parts[0], second: parts[1] };
}

/**
 * Метеоумови `4/800/1200/10` → { cloudScore: 4, cloudBase: 800, cloudTop: 1200, visibilityKm: 10 }.
 * ПРИПУЩЕННЯ щодо змісту чотирьох чисел (бали хмарності / нижній / верхній край, м / видимість, км).
 */
export function parseMeteo(value) {
  const parts = cellText(value).split('/').map(p => parseNumber(p));
  if (parts.length !== 4 || parts.some(n => n === null || Number.isNaN(n))) return null;
  return { cloudScore: parts[0], cloudBase: parts[1], cloudTop: parts[2], visibilityKm: parts[3] };
}

const AIRFIELD_RE = /^[A-Za-zА-Яа-яІіЇїЄєҐґ0-9-]{1,12}$/;

function normalizeDayNight(text) {
  const t = text.toLowerCase();
  if (t === 'день' || t === 'д') return 'day';
  if (t === 'ніч' || t === 'н') return 'night';
  return null;
}

function normalizeMeteoCond(text) {
  const t = text.toUpperCase();
  return t === 'ПМУ' || t === 'СМУ' ? t : null;
}

const isNumericCell = value => typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()));

/**
 * Розбирає рядки таблиці (масив масивів клітинок) за шаблоном із 38 колонок.
 * @param {Array<Array>} rows клітинки як є (рядки/числа/null)
 * @param {object} [opts]
 * @param {string} [opts.defaultDate] дата зміни, якщо в «Льотній зміні» вона не вказана
 * @param {boolean|'auto'} [opts.header='auto'] чи є перший рядок заголовком
 * @param {Array} [opts.persons] особовий склад — для зіставлення позивних
 * @param {Array} [opts.existingFlights] уже наявні польоти — для попередження про дублікати
 * @param {Array<string>} [opts.airfieldCodes] словник кодів аеродромів
 * @returns {{records, errors, warnings, stats}} рядки з помилками не потрапляють у records;
 *   `row` — номер рядка в таблиці (з 1).
 */
export function parseImportRows(rows, opts = {}) {
  const errors = [];
  const warnings = [];
  const records = [];
  const list = Array.isArray(rows) ? rows : [];
  const defaultDate = normalizeDate(opts.defaultDate);
  const codes = Array.isArray(opts.airfieldCodes) && opts.airfieldCodes.length
    ? new Set(opts.airfieldCodes.map(c => String(c).toLowerCase())) : null;
  const personsByCallsign = new Map((opts.persons || []).map(p => [String(p.callsign).toLowerCase(), p]));
  const stats = { rows: 0, ok: 0, invalid: 0, duplicates: 0, header: false };

  let start = 0;
  const first = list[0];
  const wantHeader = opts.header === undefined || opts.header === 'auto'
    ? Array.isArray(first) && first.some(c => !isBlank(c)) && !isNumericCell(first[0])
    : Boolean(opts.header);
  if (wantHeader && Array.isArray(first)) {
    stats.header = true;
    start = 1;
    let width = first.length;
    while (width > 0 && isBlank(first[width - 1])) width -= 1;
    if (width !== IMPORT_COLUMN_COUNT) {
      errors.push({
        row: 1,
        column: null,
        message: `Шаблон має ${IMPORT_COLUMN_COUNT} стовпців, у заголовку знайдено ${width}. Імпорт читає стовпці за позицією, тому такий файл не можна завантажити.`,
      });
      return { records, errors, warnings, stats };
    }
  }

  const seen = new Map();
  for (let i = start; i < list.length; i += 1) {
    const row = i + 1;
    const cells = Array.isArray(list[i]) ? list[i] : [];
    if (cells.every(isBlank)) continue;
    stats.rows += 1;
    const rowErrors = [];
    const err = (c, message) => rowErrors.push({ row, column: c.index + 1, columnTitle: c.title, message });
    const warn = (c, message) => warnings.push({ row, column: c ? c.index + 1 : null, message });
    if (cells.length > IMPORT_COLUMN_COUNT && cells.slice(IMPORT_COLUMN_COUNT).some(c => !isBlank(c))) {
      warn(null, `У рядку ${row} є клітинки правіше ${IMPORT_COLUMN_COUNT}-го стовпця: їх проігноровано.`);
    }
    const get = key => cells[IMPORT_COLUMNS.find(c => c.key === key).index];
    const C = key => IMPORT_COLUMNS.find(c => c.key === key);

    // дата й зміна
    const shiftRaw = get('shift');
    let date = null;
    let shiftLabel = null;
    if (typeof shiftRaw === 'number' && shiftRaw > 20000) date = excelSerialToIso(shiftRaw);
    else if (!isBlank(shiftRaw)) {
      date = normalizeDate(String(shiftRaw));
      if (!date) shiftLabel = cellText(shiftRaw);
    }
    if (!date) date = defaultDate;
    if (!date) err(C('shift'), 'Не вказано дату зміни: у стовпці «Льотна зміна» немає дати, а дату зміни для імпорту не задано.');

    // аеродроми: лише умовний код
    const airfields = {};
    for (const key of ['airfieldFrom', 'airfieldTo']) {
      const text = cellText(get(key));
      if (!text) { airfields[key] = null; continue; }
      if (!AIRFIELD_RE.test(text)) err(C(key), 'Аеродром має бути умовним кодом зі словника (без координат і вільного тексту).');
      else if (codes && !codes.has(text.toLowerCase())) err(C(key), `Код аеродрому «${text}» відсутній у словнику.`);
      airfields[key] = text;
    }

    const launch = cellText(get('launch')) || null;
    if (launch && !['запуск', 'проба'].includes(launch.toLowerCase())) warn(C('launch'), `Рядок ${row}: невідоме значення «${launch}» у «Запуск/проба».`);

    const dayNightText = cellText(get('dayNight'));
    const dayNight = dayNightText ? normalizeDayNight(dayNightText) : null;
    if (dayNightText && !dayNight) err(C('dayNight'), `Очікується «день» або «ніч», знайдено «${dayNightText}».`);
    const meteoText = cellText(get('meteoCond'));
    const meteoCond = meteoText ? normalizeMeteoCond(meteoText) : null;
    if (meteoText && !meteoCond) err(C('meteoCond'), `Очікується «ПМУ» або «СМУ», знайдено «${meteoText}».`);

    const countRaw = parseNumber(get('count'));
    if (countRaw === null) err(C('count'), 'Не вказано кількість польотів.');
    else if (!Number.isInteger(countRaw) || countRaw < 1) err(C('count'), 'Кількість польотів має бути цілим числом від 1.');

    const exercises = [];
    for (const key of ['exercise1', 'exercise2', 'exercise3']) {
      const raw = get(key);
      if (isBlank(raw)) continue;
      const ex = normalizeExercise(typeof raw === 'number' ? String(raw) : raw);
      if (ex === null) err(C(key), `Некоректний номер вправи «${cellText(raw)}».`);
      else exercises.push(ex);
    }
    if (!exercises.length && !rowErrors.some(e => e.columnTitle === 'Вправа')) warn(C('exercise1'), `Рядок ${row}: не вказано жодної вправи.`);

    const times = {};
    for (const key of ['takeoff', 'landing']) {
      const raw = get(key);
      if (isBlank(raw)) { times[key] = null; continue; }
      const minutes = parseTimeOfDay(raw);
      if (minutes === null) err(C(key), `Час має бути у форматі ГГ:ХВ, знайдено «${cellText(raw)}».`);
      times[key] = minutes;
    }
    const durations = {};
    for (const key of ['airtime', 'airtimeTotal', 'airtimeClouds', 'airtimeHood']) {
      const raw = get(key);
      if (isBlank(raw)) { durations[key] = null; continue; }
      const minutes = parseDurationCell(raw);
      if (minutes === null) err(C(key), `Наліт має бути у форматі Г:ХВ, знайдено «${cellText(raw)}».`);
      durations[key] = minutes;
    }
    if (durations.airtime === null && !rowErrors.some(e => e.columnTitle === 'Наліт')) warn(C('airtime'), `Рядок ${row}: не вказано наліт.`);
    if (countRaw === 1 && times.takeoff !== null && times.landing !== null && durations.airtime !== null) {
      const span = (times.landing - times.takeoff + 1440) % 1440;
      if (Math.abs(span - durations.airtime) > 10) warn(C('airtime'), `Рядок ${row}: наліт ${formatDuration(durations.airtime)} не збігається з різницею зльоту й посадки (${formatDuration(span)}).`);
    }

    let altitude = null;
    if (!isBlank(get('altitude'))) {
      altitude = parseNumber(get('altitude'));
      if (Number.isNaN(altitude) || altitude < 0) { err(C('altitude'), 'Висота має бути невід\'ємним числом.'); altitude = null; }
    }
    let fuel = null;
    if (!isBlank(get('fuel'))) {
      fuel = parseFuel(get('fuel'));
      if (!fuel) err(C('fuel'), `Витрата палива має бути у форматі «255/208», знайдено «${cellText(get('fuel'))}».`);
    }
    let meteo = null;
    if (!isBlank(get('meteo'))) {
      meteo = parseMeteo(get('meteo'));
      if (!meteo) err(C('meteo'), `Метеоумови мають бути у форматі «4/800/1200/10», знайдено «${cellText(get('meteo'))}».`);
    }

    const intCell = (key, label) => {
      if (isBlank(get(key))) return null;
      const n = parseNumber(get(key));
      if (!Number.isInteger(n) || n < 0) { err(C(key), `${label}: очікується невід'ємне ціле число.`); return null; }
      return n;
    };
    const passengers = intCell('passengers', 'Пасажири');
    const rspEvents = intCell('rspEvents', 'Заходи РСП');
    const rspLandings = intCell('rspLandings', 'Посадки РСП');
    let cargoKg = null;
    if (!isBlank(get('cargo'))) {
      cargoKg = parseNumber(get('cargo'));
      if (Number.isNaN(cargoKg) || cargoKg < 0) { err(C('cargo'), 'Вантаж має бути невід\'ємним числом.'); cargoKg = null; }
    }
    const grades = {};
    for (const key of ['gradeCombat', 'gradeFlight']) {
      if (isBlank(get(key))) { grades[key] = null; continue; }
      const n = parseNumber(get(key));
      if (Number.isInteger(n) && n >= 1 && n <= 5) grades[key] = n;
      else { grades[key] = cellText(get(key)); warn(C(key), `Рядок ${row}: оцінка «${cellText(get(key))}» не є числом 1–5, збережено як текст.`); }
    }

    // екіпаж: позивні (не ПІБ)
    const commander = cellText(get('commander'));
    if (!commander) err(C('commander'), 'Не вказано командира екіпажу.');
    const crew = [commander, cellText(get('navigator')), cellText(get('flightEngineer')),
      ...[1, 2, 3, 4, 5, 6].map(n => cellText(get(`crew${n}`)))].filter(Boolean);
    if (crew.some(name => name.length > 40)) err(C('commander'), 'Позивний в екіпажі задовгий (понад 40 символів): вказуйте позивний, а не повне ім\'я.');
    const known = personsByCallsign.get(commander.toLowerCase());
    if (commander && personsByCallsign.size && !known) warn(C('commander'), `Рядок ${row}: позивного «${commander}» немає в особовому складі.`);

    if (rowErrors.length) {
      errors.push(...rowErrors);
      stats.invalid += 1;
      continue;
    }

    const record = {
      row,
      date,
      shiftLabel,
      airfieldFrom: airfields.airfieldFrom,
      airfieldTo: airfields.airfieldTo,
      aircraftType: cellText(get('aircraftType')) || null,
      tailNumber: cellText(get('tailNumber')) || null,
      launch,
      dayNight,
      meteoCond,
      count: countRaw,
      exercises,
      takeoffMin: times.takeoff,
      landingMin: times.landing,
      airtimeMin: durations.airtime,
      airtimeTotalMin: durations.airtimeTotal,
      airtimeCloudsMin: durations.airtimeClouds,
      airtimeHoodMin: durations.airtimeHood,
      altitudeM: altitude,
      fuel,
      fuelProgram: cellText(get('fuelProgram')) || null,
      commander,
      crew,
      passengers,
      cargoKg,
      gradeCombat: grades.gradeCombat,
      gradeFlight: grades.gradeFlight,
      meteo,
      rspEvents,
      rspLandings,
    };

    // дублікати в самому файлі й серед наявних польотів
    const key = [record.date, record.shiftLabel, record.tailNumber, record.takeoffMin, record.landingMin, record.commander, record.count, record.airtimeMin]
      .map(v => String(v ?? '').toLowerCase()).join('|');
    if (seen.has(key)) {
      stats.duplicates += 1;
      warnings.push({ row, column: null, message: `Рядок ${row} дублює рядок ${seen.get(key)}.` });
    } else {
      seen.set(key, row);
    }
    const existing = (opts.existingFlights || []).find(f =>
      f.date === record.date && f.count === record.count
      && (f.airtimeMin ?? null) === record.airtimeMin
      && (f.exercise ?? null) === (record.exercises[0] ?? null)
      && (known ? f.personId === known.id : (Array.isArray(f.crew) && f.crew[0] === commander)));
    if (existing) {
      stats.duplicates += 1;
      warnings.push({ row, column: null, message: `Рядок ${row}: схожий запис польоту вже є в льотній книжці (${formatDate(record.date)}).` });
    }
    records.push(record);
    stats.ok += 1;
  }
  return { records, errors, warnings, stats };
}

/**
 * Перетворює розібраний рядок імпорту на запис польоту (джерело 'import'). Командира
 * зіставляє з особовим складом за позивним; не знайдено — personId null.
 */
export function importRecordToFlight(record, persons = [], id = null) {
  const match = persons.find(p => String(p.callsign).toLowerCase() === String(record.commander).toLowerCase());
  return {
    id,
    date: record.date,
    shiftId: null,
    personId: match ? match.id : null,
    crew: [...record.crew],
    exercise: record.exercises[0] ?? null,
    count: record.count,
    airtimeMin: record.airtimeMin,
    dayNight: record.dayNight,
    meteo: record.meteoCond,
    aircraftType: record.aircraftType,
    tailNumber: record.tailNumber,
    source: 'import',
    note: null,
  };
}
