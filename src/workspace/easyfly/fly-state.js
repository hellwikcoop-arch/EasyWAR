// Чиста частина інтерфейсу EasyFLY (без DOM): маршрути всередині контейнера, редуктори змін
// даних (пілот, перевірка, допуск, політ, налаштування, імпорт), розбір CSV/TSV для імпорту,
// моделі екранів (таблиця пілотів, картки профілю, хронометраж) і логіка «є незбережені зміни».
// Редуктори не змінюють вхідні дані: повертають { ok:true, data, … } або { ok:false, errors }.
// Видалення вимагає { confirmed: true } — підтвердження показує інтерфейс.
// «Сьогодні» завжди параметр. Затвердження немає: допуск має лише стани 'valid' | 'lost'.

import {
  AIRCRAFT_KINDS, ARTICLE_205_IDS, CLASS_QUALS, IMPORT_COLUMNS, ROLES, STATUS,
  addDays, admissionKindById, admissionKindsForRole, airtimeTotals, article205State, checkStates,
  checkTypeById, checkTypesForPerson, commanderSummary, createAdmission, daysLeft, diffDays,
  evaluateAdmissions, filterLogbook, flightsOfPerson, flightsOfShift, formatDate, formatDuration,
  importRecordToFlight, jumpsState, lastFlightDate, logbookSummary, longBreakState, medicalState,
  normalizeDate, normalizeFlight, ovpState, parseImportRows, personItems, renewAdmission,
  renewalHint, resolveSettings, shiftSummary, toIso, MEDICAL_KINDS, flightBlockers,
} from './fly-core.js';
import { MAX_CALLSIGN_LEN, MAX_NOTE_LEN, nextId, removeById, removePerson, upsertById } from './fly-store.js';

// ───────────────────────────── Маршрути ─────────────────────────────

/** Пункти бічної навігації в порядку з макетів. */
export const NAV_ITEMS = Object.freeze([
  { route: 'summary', label: 'Зведення', icon: 'zvedennia' },
  { route: 'pilots', label: 'Мої пілоти', icon: 'moi-piloty' },
  { route: 'chrono', label: 'Хронометраж', icon: 'khronometrazh' },
  { route: 'navigator', label: 'Штурман', icon: 'shturman' },
  { route: 'sunmoon', label: 'Сонце і Місяць', icon: 'sontse-misiats' },
  { route: 'import', label: 'Імпорт з Excel', icon: 'import-excel' },
  { route: 'reminders', label: 'Нагадування', icon: 'nahaduvannia' },
  { route: 'settings', label: 'Налаштування', icon: 'nalashtuvannia' },
]);

/** Нижня навігація телефона (зауваження до екрана 17); решта — у меню «Ще». */
export const PHONE_NAV = Object.freeze(['summary', 'pilots', 'navigator', 'sunmoon']);

/** Вкладки профілю пілота. */
export const PILOT_TABS = Object.freeze([
  { id: 'checks', label: 'Перевірки' },
  { id: 'admissions', label: 'Допуски' },
  { id: 'logbook', label: 'Льотна книжка' },
  { id: 'navdocs', label: 'Штурманські документи' },
]);

const ROUTE_NAMES = NAV_ITEMS.map(item => item.route);
const TAB_IDS = PILOT_TABS.map(tab => tab.id);

/**
 * Розбирає hash усередині контейнера: `#/pilot/p01/admissions` → { name:'pilot', params:{ id, tab } }.
 * `#/navigator/p01` — штурман для пілота p01 (params.pilot). Невідоме — зведення.
 */
export function parseRoute(hash) {
  const text = String(hash ?? '').replace(/^#/, '');
  const parts = text.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const name = parts[0];
  if (name === 'pilot') {
    if (!parts[1]) return { name: 'pilots', params: {} };
    return { name: 'pilot', params: { id: parts[1], tab: TAB_IDS.includes(parts[2]) ? parts[2] : 'checks' } };
  }
  if (name === 'navigator') return { name, params: parts[1] ? { pilot: parts[1] } : {} };
  if (ROUTE_NAMES.includes(name)) return { name, params: {} };
  return { name: 'summary', params: {} };
}

/** Складає hash за назвою маршруту й параметрами (обернено до parseRoute). */
export function buildRoute(name, params = {}) {
  const enc = encodeURIComponent;
  if (name === 'pilot') {
    if (!params.id) return '#/pilots';
    const tab = TAB_IDS.includes(params.tab) ? params.tab : 'checks';
    return `#/pilot/${enc(params.id)}/${tab}`;
  }
  if (name === 'navigator') return params.pilot ? `#/navigator/${enc(params.pilot)}` : '#/navigator';
  return ROUTE_NAMES.includes(name) ? `#/${name}` : '#/summary';
}

/** Який пункт сайдбару підсвічувати для маршруту (профіль → «Мої пілоти»). */
export function navFor(route) {
  return route?.name === 'pilot' ? 'pilots' : (route?.name || 'summary');
}

// ───────────────────────────── Дата, «незбережені зміни» ─────────────────────────────

/** Сьогоднішня дата за годинником пристрою (локальні рік/місяць/день) у форматі ISO. */
export function todayIso(now = new Date()) {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Відбиток даних для порівняння зі збереженим станом. */
export function fingerprint(data) {
  return JSON.stringify(data);
}

/** Чи відрізняються дані від збережених (відбиток збереженого стану — savedFp). */
export function isDirty(data, savedFp) {
  return fingerprint(data) !== savedFp;
}

/**
 * Застосовує зміну. `fn(data)` може повернути: редуктор-результат { ok, data, … } (при ok:false
 * дані не змінюються), новий об'єкт даних (з масивом persons) або нічого (тоді fn змінила
 * копію). fn отримує структурну копію, тож помилка всередині не псує поточний стан.
 */
export function applyMutation(data, fn) {
  const draft = structuredClone(data);
  const out = fn(draft);
  if (out && typeof out === 'object' && 'ok' in out) {
    return out.ok === false ? { ok: false, data, result: out } : { ok: true, data: out.data ?? draft, result: out };
  }
  if (out && typeof out === 'object' && Array.isArray(out.persons)) return { ok: true, data: out, result: out };
  return { ok: true, data: draft, result: out };
}

// ───────────────────────────── Допоміжне ─────────────────────────────

const fail = errors => ({ ok: false, errors: Array.isArray(errors) ? errors : [errors] });
const text = value => (value === undefined || value === null ? '' : String(value).trim());
const orNull = value => (text(value) === '' ? null : text(value));

/** Контекст для функцій fly-core: перевірки й налаштування з даних. */
export function coreCtx(data) {
  return { checks: data.checks, settings: data.unit?.settings };
}

/** Налаштування з усіма типовими значеннями плюс поля частини, потрібні екранам. */
export function effectiveSettings(data) {
  const raw = data.unit?.settings || {};
  return {
    ...resolveSettings(raw),
    onbCriterionPercent: Number.isInteger(raw.onbCriterionPercent) ? raw.onbCriterionPercent : 50,
    timezone: raw.timezone || 'Europe/Kyiv',
    airfieldLat: Number.isFinite(raw.airfieldLat) ? raw.airfieldLat : null,
    airfieldLon: Number.isFinite(raw.airfieldLon) ? raw.airfieldLon : null,
    airfield: data.unit?.airfield || '',
    unitName: data.unit?.name || '',
  };
}

function personById(data, id) {
  return (data.persons || []).find(p => p.id === id) || null;
}

const dateError = 'Вкажіть дату у форматі дд.мм.рррр.';

// ───────────────────────────── Пілоти ─────────────────────────────

function validatePersonFields(data, input, selfId = null) {
  const errors = [];
  const callsign = text(input.callsign);
  if (!callsign) errors.push('Вкажіть позивний.');
  else if (callsign.length > MAX_CALLSIGN_LEN) errors.push(`Позивний задовгий (понад ${MAX_CALLSIGN_LEN} символів): вкажіть позивний, а не повне ім'я.`);
  else if (data.persons.some(p => p.id !== selfId && p.callsign.toLowerCase() === callsign.toLowerCase())) errors.push(`Позивний «${callsign}» уже є в списку.`);
  if (!ROLES.includes(input.role)) errors.push(`Роль має бути однією з: ${ROLES.join(', ')}.`);
  if (input.classQual !== undefined && input.classQual !== null && !CLASS_QUALS.includes(input.classQual)) errors.push('Невідомий клас.');
  if (input.aircraftKind !== undefined && input.aircraftKind !== null && !AIRCRAFT_KINDS.includes(input.aircraftKind)) errors.push('Невідомий вид ПС.');
  if (text(input.note).length > MAX_NOTE_LEN) errors.push(`Примітка задовга (понад ${MAX_NOTE_LEN} символів).`);
  return errors;
}

/** Додає пілота. Поля: callsign, role, classQual, aircraftKind, aircraftType, link, instructor, note. */
export function addPerson(data, input = {}) {
  const errors = validatePersonFields(data, input);
  if (errors.length) return fail(errors);
  const id = nextId('p', data.persons);
  const person = {
    id,
    callsign: text(input.callsign),
    role: input.role,
    classQual: input.classQual ?? 'none',
    link: orNull(input.link),
    aircraftKind: input.aircraftKind ?? 'helicopter',
    aircraftType: orNull(input.aircraftType),
    instructor: input.instructor === true,
    note: orNull(input.note),
    medical: [],
    article205: {},
    ovp: null,
    jumps: [],
    jumpExemptUntil: null,
  };
  return { ok: true, id, data: { ...data, persons: [...data.persons, person] } };
}

/** Змінює поля пілота; при перейменуванні позивного оновлює екіпажі в польотах. */
export function updatePerson(data, id, patch = {}) {
  const person = personById(data, id);
  if (!person) return fail('Пілота не знайдено.');
  const next = { ...person };
  for (const key of ['callsign', 'role', 'classQual', 'aircraftKind', 'instructor']) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  for (const key of ['link', 'aircraftType', 'note']) {
    if (patch[key] !== undefined) next[key] = orNull(patch[key]);
  }
  if (patch.jumpExemptUntil !== undefined) {
    const date = orNull(patch.jumpExemptUntil) === null ? null : normalizeDate(patch.jumpExemptUntil);
    if (patch.jumpExemptUntil && !date) return fail(dateError);
    next.jumpExemptUntil = date;
  }
  next.callsign = text(next.callsign);
  const errors = validatePersonFields(data, next, id);
  if (errors.length) return fail(errors);
  let flights = data.flights;
  if (next.callsign !== person.callsign) {
    flights = data.flights.map(f => (Array.isArray(f.crew) && f.crew.includes(person.callsign)
      ? { ...f, crew: f.crew.map(name => (name === person.callsign ? next.callsign : name)) } : f));
  }
  return { ok: true, data: { ...data, flights, persons: upsertById(data.persons, next) } };
}

/** Видаляє пілота з його перевірками й допусками (польоти лишаються без посилання). */
export function deletePerson(data, id, { confirmed = false } = {}) {
  if (!confirmed) return fail('Видалення потрібно підтвердити.');
  if (!personById(data, id)) return fail('Пілота не знайдено.');
  return { ok: true, data: removePerson(data, id) };
}

// ───────────────────────────── Перевірки ─────────────────────────────

/** Види записів, що вносяться через «Внести перевірку». */
export function entryKinds(person) {
  const kinds = [
    { id: 'medical:ВЛК', label: 'ВЛК' },
    { id: 'medical:ПМО', label: 'ПМО' },
    { id: 'article205', label: 'Стаття 205' },
    { id: 'ovp', label: 'ОВП' },
    { id: 'jump', label: 'Стрибок з парашутом' },
  ];
  for (const type of checkTypesForPerson(person)) kinds.push({ id: `check:${type.id}`, label: type.label });
  return kinds;
}

/**
 * Вносить перевірку пілота. entry: { kind, date, direction?, acceptedBy?, note? };
 * kind: 'medical:ВЛК' | 'medical:ПМО' | 'article205' (з direction) | 'ovp' | 'jump' | 'check:<вид>'.
 */
export function recordCheck(data, personId, entry = {}) {
  const person = personById(data, personId);
  if (!person) return fail('Оберіть пілота.');
  const date = normalizeDate(entry.date);
  if (!date) return fail(dateError);
  if (text(entry.note).length > MAX_NOTE_LEN) return fail(`Примітка задовга (понад ${MAX_NOTE_LEN} символів).`);
  const kind = String(entry.kind || '');
  let nextPerson = { ...person };
  let checks = data.checks;
  if (kind.startsWith('medical:')) {
    const medKind = kind.slice('medical:'.length);
    if (!MEDICAL_KINDS.includes(medKind)) return fail('Невідомий вид медичного огляду.');
    const old = Array.isArray(person.medical) ? person.medical : [];
    nextPerson.medical = old.some(e => e.kind === medKind && e.date === date) ? old : [...old, { kind: medKind, date }];
  } else if (kind === 'article205') {
    if (!ARTICLE_205_IDS.includes(entry.direction)) return fail('Оберіть напрям Статті 205.');
    const old = person.article205 && typeof person.article205 === 'object' ? person.article205 : {};
    nextPerson.article205 = {
      ...old,
      [entry.direction]: { date, acceptedBy: orNull(entry.acceptedBy) ?? old[entry.direction]?.acceptedBy ?? null },
    };
  } else if (kind === 'ovp') {
    nextPerson.ovp = { date };
  } else if (kind === 'jump') {
    const old = Array.isArray(person.jumps) ? person.jumps : [];
    nextPerson.jumps = old.some(j => j.date === date) ? old : [...old, { date }];
  } else if (kind.startsWith('check:')) {
    const type = checkTypeById(kind.slice('check:'.length));
    if (!type) return fail('Невідомий вид перевірки.');
    if (!checkTypesForPerson(person).some(t => t.id === type.id)) return fail(`Перевірка «${type.label}» не передбачена для ролі ${person.role}.`);
    checks = [...data.checks, { id: nextId('c', data.checks), personId, kind: type.id, date, note: orNull(entry.note) }];
  } else {
    return fail('Оберіть вид перевірки.');
  }
  return { ok: true, data: { ...data, checks, persons: upsertById(data.persons, nextPerson) } };
}

/** Видаляє запис із колекції перевірок (потрібне підтвердження). */
export function deleteCheck(data, id, { confirmed = false } = {}) {
  if (!confirmed) return fail('Видалення потрібно підтвердити.');
  if (!data.checks.some(c => c.id === id)) return fail('Запис не знайдено.');
  return { ok: true, data: { ...data, checks: removeById(data.checks, id) } };
}

// ───────────────────────────── Допуски ─────────────────────────────

/**
 * Відмічає допуск пілота (самовідмітка без затвердження). Якщо такий вид у цей час доби вже є,
 * оновлює його дату (повторна відмітка).
 */
export function addAdmission(data, input = {}) {
  const person = personById(data, input.personId);
  if (!person) return fail('Оберіть пілота.');
  const kind = admissionKindById(input.kind);
  if (!kind) return fail('Оберіть вид допуску.');
  if (!kind.roles.includes(person.role)) return fail(`Допуск «${kind.label}» не передбачено для ролі ${person.role}.`);
  const dayNight = input.dayNight === 'night' ? 'night' : 'day';
  const existing = data.admissions.find(a => a.personId === person.id && a.kind === kind.id && (a.dayNight === 'night' ? 'night' : 'day') === dayNight);
  if (existing) {
    const renewed = renewAdmission(existing, { date: input.grantedAt, exercise: orNull(input.exercise), orderRef: orNull(input.orderRef) });
    if (!renewed) return fail(dateError);
    return { ok: true, id: existing.id, data: { ...data, admissions: upsertById(data.admissions, renewed) } };
  }
  const made = createAdmission({
    id: nextId('a', data.admissions),
    personId: person.id,
    kind: kind.id,
    dayNight,
    exercise: orNull(input.exercise),
    grantedAt: input.grantedAt,
    orderRef: orNull(input.orderRef),
  });
  if (!made.ok) return fail(made.errors);
  return { ok: true, id: made.value.id, data: { ...data, admissions: [...data.admissions, made.value] } };
}

/** Повторна відмітка допуску після контрольного польоту: нова дата, статус «дійсний». */
export function renewAdmissionRecord(data, id, { date, exercise = null, orderRef = null } = {}) {
  const admission = data.admissions.find(a => a.id === id);
  if (!admission) return fail('Допуск не знайдено.');
  const renewed = renewAdmission(admission, { date, exercise: orNull(exercise), orderRef: orNull(orderRef) });
  if (!renewed) return fail(dateError);
  return { ok: true, data: { ...data, admissions: upsertById(data.admissions, renewed) } };
}

/** Пілот сам позначає допуск втраченим. */
export function markAdmissionLost(data, id) {
  const admission = data.admissions.find(a => a.id === id);
  if (!admission) return fail('Допуск не знайдено.');
  return { ok: true, data: { ...data, admissions: upsertById(data.admissions, { ...admission, status: 'lost' }) } };
}

export function deleteAdmission(data, id, { confirmed = false } = {}) {
  if (!confirmed) return fail('Видалення потрібно підтвердити.');
  if (!data.admissions.some(a => a.id === id)) return fail('Допуск не знайдено.');
  return { ok: true, data: { ...data, admissions: removeById(data.admissions, id) } };
}

/** Повна кількість повних місяців між останнім використанням допуску й сьогодні (≥ 0). */
export function breakMonths(evaluation, today) {
  if (!evaluation?.lastUseDate) return null;
  const days = diffDays(evaluation.lastUseDate, today);
  return Number.isNaN(days) ? null : Math.max(0, Math.floor(days / 30.4375));
}

/** «7 місяців» за числом. */
export function pluralMonths(n) {
  const abs = Math.abs(n);
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return 'місяців';
  if (last === 1) return 'місяць';
  if (last >= 2 && last <= 4) return 'місяці';
  return 'місяців';
}

/**
 * Рядки таблиці допусків пілота: кожен вид за роллю; для виду з записами — рядок на запис
 * (день/ніч), без записів — один рядок зі статусом null («Немає даних»).
 */
export function admissionRows(person, data, today) {
  const evaluated = evaluateAdmissions(person, data.admissions, data.flights, today);
  const rows = [];
  for (const kind of admissionKindsForRole(person.role)) {
    const records = evaluated.filter(item => item.admission.kind === kind.id);
    const dayList = kind.exercises.day.join(' / ');
    const nightList = kind.exercises.night.join(' / ');
    const exercisesText = [dayList, nightList].filter(Boolean).join(' · ') || '—';
    if (!records.length) {
      rows.push({ kind, admission: null, evaluation: null, status: null, exercisesText, hint: null });
      continue;
    }
    for (const { admission, evaluation } of records) {
      rows.push({ kind, admission, evaluation, status: evaluation.status, exercisesText, hint: evaluation.hint || null });
    }
  }
  return rows;
}

/** Втрачені допуски пілота з підказкою вправи й тривалістю перерви. */
export function lostAdmissions(person, data, today) {
  return admissionRows(person, data, today)
    .filter(row => row.status === 'lost')
    .map(row => ({
      row,
      label: row.kind.label,
      dayNight: row.admission.dayNight === 'night' ? 'night' : 'day',
      months: breakMonths(row.evaluation, today),
      hint: row.hint || renewalHint(row.kind.id, row.admission.dayNight),
    }));
}

// ───────────────────────────── Польоти, зміни ─────────────────────────────

function ensureShift(data, date) {
  const found = data.shifts.find(s => s.date === date);
  if (found) return { data, shift: found };
  const shift = { id: nextId('s', data.shifts), date, name: `Льотна зміна ${formatDate(date)}`, note: null };
  return { data: { ...data, shifts: [...data.shifts, shift] }, shift };
}

/**
 * Додає політ (запис льотної книжки або хронометражу). input: personId, date, exercise, count,
 * airtime 'Г:ХХ', dayNight, meteo, aircraftType, tailNumber, crew[], note, source.
 * Зміну за датою створює, якщо її немає.
 */
export function addFlight(data, input = {}) {
  const person = input.personId ? personById(data, input.personId) : null;
  if (input.personId && !person) return fail('Пілота не знайдено.');
  if (!person && !(Array.isArray(input.crew) && input.crew.length)) return fail('Оберіть пілота.');
  const crew = Array.isArray(input.crew) && input.crew.length ? input.crew.map(text).filter(Boolean) : [person.callsign];
  if (person && !crew.includes(person.callsign)) crew.unshift(person.callsign);
  const date = normalizeDate(input.date);
  const prepared = {
    ...input,
    date,
    crew,
    count: input.count === '' || input.count === undefined ? 1 : Number(input.count),
    source: input.source || 'logbook',
    personId: person ? person.id : null,
    aircraftType: orNull(input.aircraftType) ?? person?.aircraftType ?? null,
    tailNumber: orNull(input.tailNumber),
    note: orNull(input.note),
    meteo: orNull(input.meteo),
  };
  if (!prepared.airtime && prepared.airtimeMin === undefined) delete prepared.airtime;
  const normalized = normalizeFlight(prepared);
  if (!normalized.ok) return fail(normalized.errors);
  if (text(input.note).length > MAX_NOTE_LEN) return fail(`Примітка задовга (понад ${MAX_NOTE_LEN} символів).`);
  const withShift = ensureShift(data, normalized.value.date);
  const id = nextId('f', withShift.data.flights);
  const flight = { ...normalized.value, id, shiftId: withShift.shift.id };
  return { ok: true, id, data: { ...withShift.data, flights: [...withShift.data.flights, flight] } };
}

export function deleteFlight(data, id, { confirmed = false } = {}) {
  if (!confirmed) return fail('Видалення потрібно підтвердити.');
  if (!data.flights.some(f => f.id === id)) return fail('Запис польоту не знайдено.');
  return { ok: true, data: { ...data, flights: removeById(data.flights, id) } };
}

/** Дати змін для вибору в хронометражі: усі зміни й сьогодні, за спаданням. */
export function shiftDates(data, today) {
  return [...new Set([...data.shifts.map(s => s.date), ...(today ? [today] : [])])].sort().reverse();
}

/** Звіт зміни за датою: записи, підсумок (shiftSummary) і повідомлення про ліміти. */
export function shiftReport(data, date, today) {
  const shift = data.shifts.find(s => s.date === date) || { id: null, date };
  const flights = flightsOfShift(data.flights, shift).sort((a, b) => String(a.id).localeCompare(String(b.id), 'uk', { numeric: true }));
  const settings = effectiveSettings(data);
  const summary = shiftSummary(flights, { settings: data.unit.settings, persons: data.persons, today, ctx: coreCtx(data) });
  const byPerson = new Map(summary.perPilot.map(p => [p.personId, p]));
  const rows = flights.map(flight => {
    const pilot = byPerson.get(flight.personId ?? null);
    const aero = flight.aerobatics === true || ['20', '120'].includes(String(flight.exercise));
    let state = 'entered';
    if (aero && pilot?.aerobaticsOver) state = 'over';
    else if (aero && pilot?.aerobaticsLimitReached) state = 'limit';
    else if (!Number.isInteger(flight.airtimeMin)) state = 'nodata';
    return { flight, state, limit: settings.aerobaticsLimit };
  });
  const notices = [];
  for (const pilot of summary.perPilot) {
    if (pilot.aerobaticsLimitReached && !pilot.aerobaticsOver) {
      notices.push({
        level: 'soon',
        personId: pilot.personId,
        title: `${pilot.callsign || 'Пілот'} · пілотаж: ${pilot.aerobaticsFlights} ${pilot.aerobaticsFlights === 1 ? 'політ' : pilot.aerobaticsFlights < 5 ? 'польоти' : 'польотів'}`,
        text: `Досягнуто максимум ${pilot.aerobaticsLimit} польоти за льотну зміну. Подальше збільшення — поза встановленим лімітом.`,
      });
    }
  }
  for (const warning of summary.warnings) {
    notices.push({ level: 'overdue', personId: warning.personId, title: warning.message, text: '' });
  }
  return { shift, rows, summary, notices };
}

// ───────────────────────────── Огляд пілотів і картки профілю ─────────────────────────────

const RANK = Object.freeze({ overdue: 3, soon: 2, valid: 1 });

/** Найгірший зі статусів (прострочено › скоро › дійсно); немає даних у жодному — null. */
export function worstStatus(statuses) {
  let best = null;
  for (const status of statuses) {
    if (RANK[status] && (best === null || RANK[status] > RANK[best])) best = status;
  }
  return best;
}

export const CHECK_GROUPS = Object.freeze([
  { key: 'technique', title: 'Техніка пілотування', icon: 'tekhnika-pilotuvannia', ids: ['aerobatics', 'lsh_technique', 'flight_engineer', 'engine_failure', 'restricted_site', 'instructor_seat'] },
  { key: 'instruments', title: 'Прилади', icon: 'prylady', ids: ['instr_backup', 'instr_landing'] },
  { key: 'gmv', title: 'БЗ і навігація на ГМВ', icon: 'bz-hmv', ids: ['combat_nav'] },
]);

function groupState(person, data, today, group) {
  const states = checkStates(person, data.checks, today, data.unit.settings || {}).filter(s => group.ids.includes(s.id));
  return { states, status: worstStatus(states.map(s => s.status)) };
}

/** Рядок таблиці «Мої пілоти»: клітинки-статуси за колонками макета й нальоти. */
export function pilotOverview(person, data, today) {
  const settings = effectiveSettings(data);
  const med = medicalState(person, today, settings.soonDays);
  const art = article205State(person, today, settings);
  const ovp = ovpState(person, today, settings);
  const jumps = jumpsState(person, today, settings);
  const group = key => groupState(person, data, today, CHECK_GROUPS.find(g => g.key === key)).status;
  const cells = {
    medical: med?.status ?? null,
    article205: art?.status ?? null,
    ovp: ovp?.status ?? null,
    technique: group('technique'),
    instruments: group('instruments'),
    gmv: group('gmv'),
    jumps: jumps?.status ?? null,
  };
  const items = personItems(person, today, coreCtx(data));
  const totals = airtimeTotals(person, data.flights, today);
  return {
    person,
    cells,
    lastFlight: lastFlightDate(person, data.flights, today),
    yearAirtime: formatDuration(totals.yearMin),
    hasOverdue: items.some(i => i.status === STATUS.OVERDUE),
    blocked: flightBlockers(person, today, coreCtx(data)).length > 0,
  };
}

/** Фільтр таблиці пілотів: { link, role, query } (пошук за позивним без урахування регістру). */
export function filterPilots(rows, { link = '', role = '', query = '' } = {}) {
  const q = text(query).toLowerCase();
  return rows.filter(row =>
    (!link || row.person.link === link)
    && (!role || row.person.role === role)
    && (!q || row.person.callsign.toLowerCase().includes(q)));
}

function latestMedical(person, kind) {
  const dates = (Array.isArray(person.medical) ? person.medical : [])
    .filter(e => e.kind === kind).map(e => normalizeDate(e.date)).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function leftPhrase(status, left) {
  if (left === null || left === undefined) return '';
  return status === STATUS.OVERDUE ? `${-left} дн.` : `${left} дн.`;
}

/**
 * Картки вкладки «Перевірки»: ВЛК, ПМО, Стаття 205, ОВП, групи перевірок за роллю, Стрибки.
 * Кожна: { key, title, icon, status|null, blocks, lines[], rows[], footer, footerStatus, entryKind }.
 * Немає даних → status null: інтерфейс показує «Немає даних», «Дата не внесена».
 */
export function profileCards(person, data, today) {
  const settings = effectiveSettings(data);
  const cards = [];
  const med = medicalState(person, today, settings.soonDays);

  for (const kind of MEDICAL_KINDS) {
    const last = latestMedical(person, kind);
    const pending = med && med.nextKind === kind;
    const card = { key: `medical:${kind}`, title: kind, icon: kind === 'ВЛК' ? 'vlk' : 'pmo', status: null, blocks: false, lines: [], rows: [], footer: null, footerStatus: null, entryKind: `medical:${kind}` };
    if (!last && !pending) {
      cards.push(card);
      continue;
    }
    card.lines.push(last ? `Остання дата: ${formatDate(last)} · термін ${6} міс.` : 'Дата не внесена');
    if (pending) {
      card.status = med.status;
      card.blocks = med.blocks;
      card.footerStatus = med.status;
      card.footer = med.status === STATUS.OVERDUE
        ? `Прострочено з ${formatDate(med.dueDate)} · ${leftPhrase(med.status, med.daysLeft)}`
        : `Наступна ${kind} до ${formatDate(med.dueDate)} · ${leftPhrase(med.status, med.daysLeft)}`;
    } else {
      card.status = STATUS.VALID;
      card.footerStatus = STATUS.VALID;
      card.footer = `Наступною — ${med.nextKind} до ${formatDate(med.dueDate)}`;
    }
    cards.push(card);
  }

  const art = article205State(person, today, settings);
  const artCard = { key: 'article205', title: 'Стаття 205', icon: 'stattya-205', status: art?.status ?? null, blocks: Boolean(art?.blocks), lines: [], rows: [], footer: null, footerStatus: null, entryKind: 'article205' };
  if (art) {
    artCard.rows = art.directions.map(d => ({
      label: d.label,
      value: d.date ? `${formatDate(d.date)} · до ${formatDate(d.dueDate)}` : 'Немає даних',
      status: d.missing ? null : d.status,
    }));
    artCard.footerStatus = art.status;
    artCard.footer = art.missing.length
      ? `Не здано: ${art.missing.join(', ')}`
      : `Найраніший строк: ${art.earliest.label} до ${formatDate(art.dueDate)} · ${leftPhrase(art.status, art.daysLeft)}`;
  } else {
    artCard.rows = article205DirectionsPlaceholder(person);
  }
  cards.push(artCard);

  const ovp = ovpState(person, today, settings);
  const ovpCard = { key: 'ovp', title: 'ОВП', icon: 'ovp', status: ovp?.status ?? null, blocks: Boolean(ovp?.blocks), lines: [], rows: [], footer: null, footerStatus: null, entryKind: 'ovp' };
  if (ovp) {
    ovpCard.lines.push(`Остання дата: ${formatDate(ovp.date)} · термін ${ovp.months} міс.`);
    ovpCard.footerStatus = ovp.status;
    ovpCard.footer = ovp.status === STATUS.OVERDUE
      ? `Прострочено з ${formatDate(ovp.dueDate)} · ${leftPhrase(ovp.status, ovp.daysLeft)}`
      : `Строк до ${formatDate(ovp.dueDate)} · ${leftPhrase(ovp.status, ovp.daysLeft)}`;
  }
  cards.push(ovpCard);

  for (const group of CHECK_GROUPS) {
    const { states, status } = groupState(person, data, today, group);
    if (!states.length) continue;
    const card = { key: `group:${group.key}`, title: group.title, icon: group.icon, status, blocks: states.some(s => s.status === STATUS.OVERDUE), lines: [], rows: [], footer: null, footerStatus: null, entryKind: `check:${states[0].id}` };
    card.rows = states.map(s => ({
      label: s.label,
      value: s.lastDate ? `${formatDate(s.lastDate)} · до ${formatDate(s.dueDate)}` : 'Дата не внесена',
      status: s.status,
      detail: s.status ? leftPhrase(s.status, s.daysLeft) : '',
      checkId: s.id,
    }));
    const known = states.filter(s => s.dueDate).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (known.length) {
      const first = known[0];
      card.footerStatus = first.status;
      card.footer = first.status === STATUS.OVERDUE
        ? `Прострочено з ${formatDate(first.dueDate)} · ${leftPhrase(first.status, first.daysLeft)}`
        : `Найближчий строк: ${formatDate(first.dueDate)} · ${leftPhrase(first.status, first.daysLeft)}`;
      card.entryKind = `check:${first.id}`;
    }
    cards.push(card);
  }

  const jumps = jumpsState(person, today, settings);
  const jumpCard = { key: 'jumps', title: 'Стрибки з парашутом', icon: 'parashut', status: jumps?.status ?? null, blocks: Boolean(jumps?.blocks), lines: [], rows: [], footer: null, footerStatus: null, entryKind: 'jump' };
  if (jumps?.status === 'exempt') {
    jumpCard.lines.push(`Звільнено за медичними рекомендаціями до ${formatDate(jumps.exemptUntil)}`);
  } else if (jumps) {
    jumpCard.lines.push(`Останній стрибок: ${formatDate(jumps.lastDate)}`);
    jumpCard.lines.push(`У ${today.slice(0, 4)} році: ${jumps.yearCount} з ${jumps.yearNorm}`);
    jumpCard.footerStatus = jumps.status;
    jumpCard.footer = jumps.status === STATUS.OVERDUE
      ? `Прострочено з ${formatDate(jumps.dueDate)} · ${leftPhrase(jumps.status, jumps.daysLeft)}`
      : `Наступний не пізніше ${formatDate(jumps.dueDate)} · ${leftPhrase(jumps.status, jumps.daysLeft)}`;
  }
  cards.push(jumpCard);
  return cards;
}

function article205DirectionsPlaceholder(person) {
  const vd = person.aircraftKind === 'airplane' ? 'СД' : 'ВД';
  return ['АО', 'РЕО', vd, 'АОз'].map(label => ({ label, value: 'Немає даних', status: null }));
}

/** Причини заборони польотів для червоної плашки профілю. */
export function blockerBanner(person, data, today) {
  const blockers = flightBlockers(person, today, coreCtx(data));
  if (!blockers.length) return null;
  const days = blockers.map(b => b.daysOverdue).filter(d => d !== null);
  return {
    text: blockers.map(b => b.label.charAt(0).toLowerCase() + b.label.slice(1)).join('; '),
    days: days.length ? Math.max(...days) : null,
  };
}

// ───────────────────────────── Льотна книжка ─────────────────────────────

const MONTH_NOMINATIVE = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const MONTH_GENITIVE = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

/** `2026-10` → «Жовтень 2026». */
export function monthLabel(ym) {
  const [year, month] = String(ym).split('-').map(Number);
  return month >= 1 && month <= 12 ? `${MONTH_NOMINATIVE[month - 1]} ${year}` : String(ym);
}

/** Межі місяця `рррр-мм` → { from, to } (ISO). */
export function monthRange(ym) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(ym));
  if (!match) return { from: null, to: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const first = toIso(year, month, 1);
  const next = month === 12 ? toIso(year + 1, 1, 1) : toIso(year, month + 1, 1);
  return { from: first, to: addDays(next, -1) };
}

/**
 * Записи льотної книжки пілота з підсумками. filter: { month: 'рррр-мм'|'', dayNight, exercise }.
 * Річний і загальний наліт — лише за початком обліку в профілі (інакше null → тире).
 */
export function logbookView(person, data, today, filter = {}) {
  const own = flightsOfPerson(data.flights, person).filter(f => f.date <= today);
  const months = [...new Set(own.map(f => f.date.slice(0, 7)))].sort().reverse();
  const range = filter.month ? monthRange(filter.month) : { from: null, to: null };
  const entries = filterLogbook(own, { from: range.from, to: range.to, dayNight: filter.dayNight || undefined, exercise: filter.exercise || undefined });
  const currentMonth = today.slice(0, 7);
  const monthEntries = filterLogbook(own, { ...monthRange(currentMonth) });
  const monthSummary = logbookSummary(monthEntries);
  const totals = airtimeTotals(person, data.flights, today);
  const byDay = { day: 0, night: 0, dayKnown: false, nightKnown: false };
  for (const entry of entries) {
    if (entry.dayNight !== 'day' && entry.dayNight !== 'night') continue;
    if (Number.isInteger(entry.airtimeMin)) {
      byDay[entry.dayNight] += entry.airtimeMin;
      byDay[`${entry.dayNight}Known`] = true;
    }
  }
  return {
    entries,
    months,
    summary: logbookSummary(entries),
    monthLabel: monthLabel(currentMonth),
    monthAirtime: monthSummary.entries ? monthSummary.airtime : null,
    monthIncomplete: monthSummary.unknownAirtimeEntries > 0,
    yearAirtime: formatDuration(totals.yearMin),
    totalAirtime: formatDuration(totals.totalMin),
    dayAirtime: byDay.dayKnown ? formatDuration(byDay.day) : null,
    nightAirtime: byDay.nightKnown ? formatDuration(byDay.night) : null,
    longBreak: longBreakState(person, data.flights, today),
  };
}

// ───────────────────────────── Зведення: календар ─────────────────────────────

/** Кількість подій словами: 1 подія, 2 події, 5 подій. */
export function pluralEvents(n) {
  const abs = Math.abs(n);
  const last2 = abs % 100;
  const last = abs % 10;
  const word = last2 >= 11 && last2 <= 14 ? 'подій' : last === 1 ? 'подія' : last >= 2 && last <= 4 ? 'події' : 'подій';
  return `${n} ${word}`;
}

/** `20–26 жовтня` або `27 жовтня – 2 листопада`. */
export function rangeLabel(fromIso, toIso_) {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso_.split('-').map(Number);
  if (fy === ty && fm === tm) return fd === td ? `${fd} ${MONTH_GENITIVE[fm - 1]}` : `${fd}–${td} ${MONTH_GENITIVE[fm - 1]}`;
  return `${fd} ${MONTH_GENITIVE[fm - 1]} – ${td} ${MONTH_GENITIVE[tm - 1]}`;
}

/** Тижневі відрізки найближчих `horizon` днів (від сьогодні) зі строками, що в них потрапили. */
export function deadlineBuckets(items, today, horizon = 30) {
  const buckets = [];
  for (let start = 0; start <= horizon; start += 7) {
    const end = Math.min(start + 6, horizon);
    buckets.push({ from: addDays(today, start), to: addDays(today, end), items: [] });
  }
  for (const item of items) {
    const left = item.dueDate ? daysLeft(item.dueDate, today) : null;
    if (left === null || left < 0 || left > horizon) continue;
    buckets[Math.min(Math.floor(left / 7), buckets.length - 1)].items.push(item);
  }
  return buckets.map(bucket => ({ ...bucket, label: rangeLabel(bucket.from, bucket.to) }));
}

/** Зведення командира з фільтрами та підсумком по ланках. */
export function summaryView(data, today, filter = {}) {
  const summary = commanderSummary(data.persons, coreCtx(data), today, filter);
  const links = [...new Set(data.persons.map(p => p.link).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
  return { ...summary, links, buckets: deadlineBuckets(summary.calendar, today, 30) };
}

// ───────────────────────────── Налаштування частини ─────────────────────────────

function intInRange(value, min, max, label, errors) {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${label}: ціле число від ${min} до ${max}.`);
    return undefined;
  }
  return n;
}

/**
 * Змінює відомості про частину. patch: { name, airfield, signers:{first,second},
 * signersFull:{first:{rank,name,surname},second}, settings:{ aerobaticsLimit, onbCriterionPercent,
 * soonDays, ovpMonths, ovpBlocks, article205Months, reminderDays, airfieldLat, airfieldLon, timezone } }.
 * signers.first/second (прізвище, як на друкованій формі) синхронізуються з signersFull.
 */
export function updateUnit(data, patch = {}) {
  const errors = [];
  const unit = { ...data.unit, signers: { ...data.unit.signers }, settings: { ...data.unit.settings } };
  if (patch.name !== undefined) unit.name = text(patch.name);
  if (patch.airfield !== undefined) unit.airfield = text(patch.airfield);
  if (patch.signersFull) {
    unit.signersFull = { ...(data.unit.signersFull || {}) };
    for (const slot of ['first', 'second']) {
      if (!patch.signersFull[slot]) continue;
      const src = patch.signersFull[slot];
      unit.signersFull[slot] = { rank: text(src.rank), name: text(src.name), surname: text(src.surname) };
      unit.signers[slot] = text(src.surname);
    }
  }
  if (patch.signers) {
    for (const slot of ['first', 'second']) if (patch.signers[slot] !== undefined) unit.signers[slot] = text(patch.signers[slot]);
  }
  const s = patch.settings;
  if (s) {
    if (s.aerobaticsLimit !== undefined) { const v = intInRange(s.aerobaticsLimit, 1, 20, 'Норма пілотажу', errors); if (v !== undefined) unit.settings.aerobaticsLimit = v; }
    if (s.onbCriterionPercent !== undefined) { const v = intInRange(s.onbCriterionPercent, 0, 100, 'Поріг освітленості Місяця (%)', errors); if (v !== undefined) unit.settings.onbCriterionPercent = v; }
    if (s.soonDays !== undefined) { const v = intInRange(s.soonDays, 1, 90, 'Поріг «скоро» (днів)', errors); if (v !== undefined) unit.settings.soonDays = v; }
    if (s.ovpMonths !== undefined) { const v = intInRange(s.ovpMonths, 1, 60, 'Строк ОВП (міс.)', errors); if (v !== undefined) unit.settings.ovpMonths = v; }
    if (s.article205Months !== undefined) { const v = intInRange(s.article205Months, 1, 60, 'Строк Статті 205 (міс.)', errors); if (v !== undefined) unit.settings.article205Months = v; }
    if (s.ovpBlocks !== undefined) unit.settings.ovpBlocks = Boolean(s.ovpBlocks);
    if (s.timezone !== undefined) unit.settings.timezone = text(s.timezone) || 'Europe/Kyiv';
    for (const [key, label, lo, hi] of [['airfieldLat', 'Широта', -90, 90], ['airfieldLon', 'Довгота', -180, 180]]) {
      if (s[key] === undefined) continue;
      if (s[key] === null || text(s[key]) === '') { delete unit.settings[key]; continue; }
      const n = Number(String(s[key]).trim().replace(',', '.'));
      if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`${label}: число від ${lo} до ${hi} (десяткові градуси).`);
      else unit.settings[key] = n;
    }
    if (s.reminderDays !== undefined) {
      const days = [...new Set((Array.isArray(s.reminderDays) ? s.reminderDays : []).map(Number).filter(d => Number.isInteger(d) && d > 0))].sort((a, b) => b - a);
      if (!days.length) errors.push('Залиште хоча б один поріг нагадувань.');
      else unit.settings.reminderDays = days;
    }
  }
  for (const key of ['first', 'second']) {
    if (unit.signers[key] && unit.signers[key].length > 80) errors.push('Підписант задовгий (понад 80 символів).');
  }
  if (errors.length) return fail(errors);
  return { ok: true, data: { ...data, unit } };
}

/** Вмикає або вимикає поріг нагадувань (30/14/7). Останній поріг вимкнути не можна. */
export function toggleReminderDay(data, day, on) {
  const current = effectiveSettings(data).reminderDays;
  const next = on ? [...new Set([...current, day])] : current.filter(d => d !== day);
  return updateUnit(data, { settings: { reminderDays: next } });
}

// ───────────────────────────── Імпорт: CSV/TSV ─────────────────────────────

/** Розділювач за першим непорожнім рядком: табуляція, «;» або «,» (більше входжень поза лапками). */
export function detectDelimiter(source) {
  const first = String(source).split(/\r?\n/).find(line => line.trim() !== '') || '';
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : '\t';
}

/**
 * Розбирає CSV/TSV/вставлений з Excel текст у масив рядків (масивів рядків-клітинок): лапки з
 * подвоєнням, переноси рядків у клітинках, CRLF, BOM. Порожні кінцеві рядки відкидаються.
 */
export function parseDelimited(source, delimiter = null) {
  const input = String(source ?? '').replace(/^﻿/, '');
  const sep = delimiter || detectDelimiter(input);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  return rows;
}

/** Байти файлу → текст: UTF-8, а якщо байти не UTF-8 — Windows-1251 (типовий CSV з Excel). */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

const DUPLICATE_RE = /дублює рядок|вже є в льотній книжці/;

/**
 * Розбір імпорту й підсумок для екрана: кількість рядків, польотів, помилок (за рядками),
 * попереджень, дублікатів і позивних поза особовим складом.
 */
export function analyzeImport(rows, data, { defaultDate = null, header = 'auto' } = {}) {
  const result = parseImportRows(rows, {
    defaultDate: defaultDate || undefined,
    header,
    persons: data.persons,
    existingFlights: data.flights,
  });
  const errorRows = new Map();
  for (const error of result.errors) {
    if (!errorRows.has(error.row)) errorRows.set(error.row, []);
    errorRows.get(error.row).push(error);
  }
  const duplicateRows = new Set(result.warnings.filter(w => DUPLICATE_RE.test(w.message) && w.row).map(w => w.row));
  const known = new Set(data.persons.map(p => p.callsign.toLowerCase()));
  const unknownCallsigns = [...new Set(result.records.map(r => r.commander).filter(name => name && !known.has(name.toLowerCase())))];
  return {
    ...result,
    errorRows: [...errorRows.entries()].map(([row, list]) => ({ row, errors: list })),
    duplicateRows,
    unknownCallsigns,
    summary: {
      rows: result.stats.rows,
      records: result.records.length,
      invalidRows: errorRows.size,
      errorCount: result.errors.length,
      warnings: result.warnings.length,
      duplicates: duplicateRows.size,
      fileError: result.stats.rows === 0 && result.errors.length > 0,
    },
  };
}

/**
 * Застосовує розібраний імпорт: додає польоти (джерело «import»). Рядки з помилками в records
 * не потрапляють; дублікати пропускаються, якщо skipDuplicates.
 */
export function applyImport(data, records, { skipDuplicates = true, duplicateRows = new Set() } = {}) {
  let next = data;
  let added = 0;
  let skipped = 0;
  for (const record of records) {
    if (skipDuplicates && duplicateRows.has(record.row)) { skipped += 1; continue; }
    const withShift = ensureShift(next, record.date);
    const id = nextId('f', withShift.data.flights);
    const flight = { ...importRecordToFlight(record, data.persons, id), shiftId: withShift.shift.id };
    const checked = normalizeFlight(flight);
    if (!checked.ok) return fail(`Рядок ${record.row}: ${checked.errors.join(' ')}`);
    next = { ...withShift.data, flights: [...withShift.data.flights, { ...checked.value, id, shiftId: withShift.shift.id, source: 'import' }] };
    added += 1;
  }
  return { ok: true, data: next, added, skipped };
}

/** Колонки шаблону з прикладом значення з першого рядка даних (для таблиці зіставлення). */
export function mappingRows(rows, hasHeader) {
  const sample = rows[hasHeader ? 1 : 0] || [];
  return IMPORT_COLUMNS.map(column => ({
    number: column.index + 1,
    title: column.title,
    group: column.group,
    key: column.key,
    sample: sample[column.index] === undefined || String(sample[column.index]).trim() === '' ? null : String(sample[column.index]).trim(),
  }));
}

/** Ім'я файлу за замовчуванням для «Зберегти як…». */
export function suggestedFileName(data) {
  const base = text(data?.unit?.name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base ? base.slice(0, 40) : 'EasyFLY'}.easyfly`;
}
