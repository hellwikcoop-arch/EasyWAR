// Модель даних EasyFLY і файл «.easyfly»: створення порожнього набору, розбір і запис JSON,
// перевірка полів, міграції версій. Без DOM і Tauri: читання/запис файлу робить хост застосунку.
//
// Файл — JSON у UTF-8, до 5 МБ:
//   { version, unit:{ name, airfield, signers, settings }, persons, checks, admissions, flights, shifts }
//
// Принцип мінімізації даних: особа ідентифікується ПОЗИВНИМ (callsign), а не прізвищем і
// ім'ям; номерів документів, координат і маршрутів у моделі немає, аеродроми — умовні коди.
// Перевірка не намагається «вгадати» ПІБ у вільному тексті (це ненадійно й дало б хибні
// відмови); натомість поля обмежені за довжиною (позивний ≤ 40, примітка ≤ 500 символів), а
// інтерфейс підписує поле як «Позивний». Невідомі додаткові поля при розборі зберігаються.

import {
  AIRCRAFT_KINDS, ARTICLE_205_IDS, CLASS_QUALS, FLIGHT_SOURCES, MEDICAL_KINDS, ROLES,
  admissionKindById, checkTypeById, normalizeDate, normalizeExercise,
} from './fly-core.js';

/** Поточна версія схеми файлу. */
export const SCHEMA_VERSION = 1;
export const FILE_EXTENSION = 'easyfly';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CALLSIGN_LEN = 40;
export const MAX_NOTE_LEN = 500;

/** Колекції верхнього рівня, що є масивами записів з полем `id`. */
export const COLLECTIONS = Object.freeze(['persons', 'checks', 'admissions', 'flights', 'shifts']);

/** Порожній набір (нова частина). */
export function createEmpty() {
  return {
    version: SCHEMA_VERSION,
    unit: {
      name: '',
      airfield: '',
      signers: { first: '', second: '' },
      settings: {},
    },
    persons: [],
    checks: [],
    admissions: [],
    flights: [],
    shifts: [],
  };
}

/** Серіалізація в JSON (відступ 2 пробіли, UTF-8 без BOM). Кидає Error, якщо дані не пройшли перевірку. */
export function serialize(data) {
  const result = validate(data);
  if (!result.ok) {
    throw new Error(`Не вдалося зберегти: ${result.errors.map(e => e.message).slice(0, 5).join(' ')}`);
  }
  const text = `${JSON.stringify({ ...data, version: SCHEMA_VERSION }, null, 2)}\n`;
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
    throw new Error('Файл перевищує 5 МБ: зменште кількість записів.');
  }
  return text;
}

// ───────────────────────────── Міграції ─────────────────────────────

/**
 * Міграції зі старих версій: `MIGRATIONS[n]` перетворює дані версії n на версію n+1.
 * Поки є лише версія 1, тож таблиця порожня; новий крок додається разом із підвищенням
 * SCHEMA_VERSION і тестом.
 */
export const MIGRATIONS = Object.freeze({});

/** Піднімає дані до поточної версії. Повертає { data, from } або { error }. */
export function migrate(data) {
  const from = data?.version;
  if (!Number.isInteger(from) || from < 1) {
    return { error: 'У файлі немає коректного номера версії схеми (очікується ціле число від 1).' };
  }
  if (from > SCHEMA_VERSION) {
    return {
      error: `Файл створено новішою версією EasyFLY (версія схеми ${from}, ця програма підтримує до ${SCHEMA_VERSION}). Оновіть EasyWAR, щоб відкрити його.`,
    };
  }
  let current = data;
  for (let version = from; version < SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version];
    if (typeof step !== 'function') {
      return { error: `Немає міграції зі схеми ${version} на ${version + 1}.` };
    }
    current = { ...step(current), version: version + 1 };
  }
  return { data: current, from };
}

// ───────────────────────────── Розбір файлу ─────────────────────────────

function decode(input) {
  if (typeof input === 'string') return { text: input.charCodeAt(0) === 0xfeff ? input.slice(1) : input };
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
  if (!bytes) return { error: 'Очікується текст або байти файлу .easyfly.' };
  if (bytes.length > MAX_FILE_BYTES) return { error: 'Файл більший за 5 МБ: це не схоже на файл EasyFLY.' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
  } catch {
    return { error: 'Файл не в кодуванні UTF-8.' };
  }
}

/**
 * Розбирає вміст файлу .easyfly (рядок або байти).
 * @returns {{ok:true, data, warnings:string[], migratedFrom:number|null}|{ok:false, errors:string[]}}
 */
export function parse(input) {
  const decoded = decode(input);
  if (decoded.error) return { ok: false, errors: [decoded.error] };
  const { text } = decoded;
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) {
    return { ok: false, errors: ['Файл більший за 5 МБ: це не схоже на файл EasyFLY.'] };
  }
  if (!text.trim()) return { ok: false, errors: ['Файл порожній.'] };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Файл пошкоджено або це не файл EasyFLY: вміст не є коректним JSON.'] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Це не файл EasyFLY: очікується об\'єкт із полями version, unit, persons тощо.'] };
  }
  const migrated = migrate(raw);
  if (migrated.error) return { ok: false, errors: [migrated.error] };
  const data = fillDefaults(migrated.data);
  const result = validate(data);
  if (!result.ok) return { ok: false, errors: result.errors.map(e => (e.path ? `${e.path}: ${e.message}` : e.message)) };
  return {
    ok: true,
    data,
    warnings: result.warnings,
    migratedFrom: migrated.from === SCHEMA_VERSION ? null : migrated.from,
  };
}

/** Доповнює відсутні необов'язкові розділи порожніми значеннями. */
function fillDefaults(data) {
  const base = createEmpty();
  const out = { ...data };
  out.unit = {
    ...base.unit,
    ...(data.unit && typeof data.unit === 'object' && !Array.isArray(data.unit) ? data.unit : {}),
  };
  out.unit.signers = { ...base.unit.signers, ...(out.unit.signers && typeof out.unit.signers === 'object' ? out.unit.signers : {}) };
  out.unit.settings = out.unit.settings && typeof out.unit.settings === 'object' && !Array.isArray(out.unit.settings) ? out.unit.settings : {};
  for (const name of COLLECTIONS) if (out[name] === undefined) out[name] = [];
  return out;
}

// ───────────────────────────── Перевірка ─────────────────────────────

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim() !== '';

/**
 * Перевіряє структуру й значення. Помилки — українською, з шляхом до поля.
 * @returns {{ok:boolean, errors:{path,message}[], warnings:string[]}}
 */
export function validate(data) {
  const errors = [];
  const warnings = [];
  const fail = (path, message) => errors.push({ path, message });

  if (!isObject(data)) {
    fail('', 'Дані мають бути об\'єктом.');
    return { ok: false, errors, warnings };
  }
  if (data.version !== SCHEMA_VERSION) fail('version', `Очікується версія схеми ${SCHEMA_VERSION}.`);

  if (!isObject(data.unit)) fail('unit', 'Відсутні відомості про частину (unit).');
  else {
    for (const key of ['name', 'airfield']) {
      if (data.unit[key] !== undefined && typeof data.unit[key] !== 'string') fail(`unit.${key}`, 'Має бути текстом.');
    }
    if (data.unit.signers !== undefined && !isObject(data.unit.signers)) fail('unit.signers', 'Має бути об\'єктом.');
    if (data.unit.settings !== undefined && !isObject(data.unit.settings)) fail('unit.settings', 'Має бути об\'єктом.');
  }

  for (const name of COLLECTIONS) {
    if (!Array.isArray(data[name])) fail(name, 'Має бути масивом.');
  }
  if (errors.length) return { ok: false, errors, warnings };

  // ідентифікатори унікальні в межах колекції
  for (const name of COLLECTIONS) {
    const seen = new Set();
    data[name].forEach((item, i) => {
      if (!isObject(item)) { fail(`${name}[${i}]`, 'Запис має бути об\'єктом.'); return; }
      if (!isText(item.id)) fail(`${name}[${i}].id`, 'Відсутній ідентифікатор.');
      else if (seen.has(item.id)) fail(`${name}[${i}].id`, `Ідентифікатор «${item.id}» повторюється.`);
      else seen.add(item.id);
    });
  }
  if (errors.length) return { ok: false, errors, warnings };

  const personIds = new Set(data.persons.map(p => p.id));
  const callsigns = new Set();
  const dateField = (path, value, { required = false } = {}) => {
    if (value === undefined || value === null || value === '') {
      if (required) fail(path, 'Не вказано дату.');
      return;
    }
    if (typeof value !== 'string' || !normalizeDate(value) || normalizeDate(value) !== value) {
      fail(path, 'Дата має бути у форматі рррр-мм-дд.');
    }
  };
  const noteField = (path, value) => {
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > MAX_NOTE_LEN)) {
      fail(path, `Примітка має бути текстом до ${MAX_NOTE_LEN} символів.`);
    }
  };

  data.persons.forEach((p, i) => {
    const at = `persons[${i}]`;
    if (!isText(p.callsign)) fail(`${at}.callsign`, 'Вкажіть позивний.');
    else if (p.callsign.length > MAX_CALLSIGN_LEN) fail(`${at}.callsign`, `Позивний задовгий (понад ${MAX_CALLSIGN_LEN} символів): вказуйте позивний, а не повне ім'я.`);
    else if (callsigns.has(p.callsign.toLowerCase())) fail(`${at}.callsign`, `Позивний «${p.callsign}» повторюється.`);
    else callsigns.add(p.callsign.toLowerCase());
    if (!ROLES.includes(p.role)) fail(`${at}.role`, `Роль має бути однією з: ${ROLES.join(', ')}.`);
    if (p.classQual !== undefined && p.classQual !== null && !CLASS_QUALS.includes(p.classQual)) fail(`${at}.classQual`, 'Невідомий клас.');
    if (p.aircraftKind !== undefined && p.aircraftKind !== null && !AIRCRAFT_KINDS.includes(p.aircraftKind)) fail(`${at}.aircraftKind`, 'Тип ПС має бути helicopter або airplane.');
    if (p.link !== undefined && p.link !== null && typeof p.link !== 'string') fail(`${at}.link`, 'Ланка має бути текстом.');
    if (p.medical !== undefined) {
      if (!Array.isArray(p.medical)) fail(`${at}.medical`, 'Має бути масивом.');
      else p.medical.forEach((m, j) => {
        if (!MEDICAL_KINDS.includes(m?.kind)) fail(`${at}.medical[${j}].kind`, 'Вид має бути ВЛК або ПМО.');
        dateField(`${at}.medical[${j}].date`, m?.date, { required: true });
      });
    }
    if (p.article205 !== undefined && p.article205 !== null) {
      if (!isObject(p.article205)) fail(`${at}.article205`, 'Має бути об\'єктом.');
      else for (const id of Object.keys(p.article205)) {
        if (!ARTICLE_205_IDS.includes(id)) fail(`${at}.article205.${id}`, `Невідомий напрям (очікується: ${ARTICLE_205_IDS.join(', ')}).`);
        else dateField(`${at}.article205.${id}.date`, p.article205[id]?.date);
      }
    }
    if (p.ovp !== undefined && p.ovp !== null) dateField(`${at}.ovp.date`, p.ovp?.date);
    if (p.jumps !== undefined) {
      if (!Array.isArray(p.jumps)) fail(`${at}.jumps`, 'Має бути масивом.');
      else p.jumps.forEach((j, k) => dateField(`${at}.jumps[${k}].date`, j?.date, { required: true }));
    }
    dateField(`${at}.jumpExemptUntil`, p.jumpExemptUntil);
    noteField(`${at}.note`, p.note);
  });

  const personRef = (path, id, { required = true } = {}) => {
    if (id === undefined || id === null) {
      if (required) fail(path, 'Не вказано пілота.');
    } else if (!personIds.has(id)) fail(path, `Невідомий пілот «${id}».`);
  };

  data.checks.forEach((c, i) => {
    const at = `checks[${i}]`;
    personRef(`${at}.personId`, c.personId);
    if (!checkTypeById(c.kind)) fail(`${at}.kind`, `Невідомий вид перевірки «${c.kind}».`);
    dateField(`${at}.date`, c.date, { required: true });
    noteField(`${at}.note`, c.note);
  });

  data.admissions.forEach((a, i) => {
    const at = `admissions[${i}]`;
    personRef(`${at}.personId`, a.personId);
    if (!admissionKindById(a.kind)) fail(`${at}.kind`, `Невідомий вид допуску «${a.kind}».`);
    if (a.status !== 'valid' && a.status !== 'lost') fail(`${at}.status`, 'Статус допуску: valid або lost (затвердження немає).');
    dateField(`${at}.grantedAt`, a.grantedAt, { required: true });
    if (a.dayNight !== undefined && a.dayNight !== null && a.dayNight !== 'day' && a.dayNight !== 'night') fail(`${at}.dayNight`, 'Має бути day або night.');
    if (a.exercise !== undefined && a.exercise !== null && normalizeExercise(a.exercise) === null) fail(`${at}.exercise`, 'Некоректний номер вправи.');
    noteField(`${at}.note`, a.note);
  });

  const shiftIds = new Set(data.shifts.map(s => s.id));
  data.shifts.forEach((s, i) => {
    dateField(`shifts[${i}].date`, s.date, { required: true });
    noteField(`shifts[${i}].note`, s.note);
  });

  data.flights.forEach((f, i) => {
    const at = `flights[${i}]`;
    dateField(`${at}.date`, f.date, { required: true });
    personRef(`${at}.personId`, f.personId, { required: false });
    if (f.shiftId !== undefined && f.shiftId !== null && !shiftIds.has(f.shiftId)) fail(`${at}.shiftId`, `Невідома зміна «${f.shiftId}».`);
    if (!Number.isInteger(f.count) || f.count < 1) fail(`${at}.count`, 'Кількість польотів має бути цілим числом від 1.');
    if (f.airtimeMin !== undefined && f.airtimeMin !== null && (!Number.isInteger(f.airtimeMin) || f.airtimeMin < 0)) fail(`${at}.airtimeMin`, 'Наліт — невід\'ємне ціле число хвилин або null.');
    if (f.exercise !== undefined && f.exercise !== null && normalizeExercise(f.exercise) === null) fail(`${at}.exercise`, 'Некоректний номер вправи.');
    if (f.crew !== undefined && (!Array.isArray(f.crew) || f.crew.some(n => typeof n !== 'string' || n.length > MAX_CALLSIGN_LEN))) {
      fail(`${at}.crew`, `Екіпаж — масив позивних (кожен до ${MAX_CALLSIGN_LEN} символів).`);
    }
    if (f.source !== undefined && f.source !== null && !FLIGHT_SOURCES.includes(f.source)) fail(`${at}.source`, 'Невідоме джерело запису.');
    noteField(`${at}.note`, f.note);
  });

  return { ok: errors.length === 0, errors, warnings };
}

// ───────────────────────────── Допоміжне для редагування ─────────────────────────────

/** Наступний вільний ідентифікатор виду `<prefix><n>` у колекції. */
export function nextId(prefix, items) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const item of items || []) {
    const match = re.exec(String(item?.id ?? ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

/** Нова колекція з доданим або заміненим (за id) записом; вихідний масив не змінюється. */
export function upsertById(items, record) {
  const list = Array.isArray(items) ? items : [];
  return list.some(item => item.id === record.id)
    ? list.map(item => (item.id === record.id ? record : item))
    : [...list, record];
}

/** Нова колекція без запису з вказаним id. */
export function removeById(items, id) {
  return (Array.isArray(items) ? items : []).filter(item => item.id !== id);
}

/**
 * Видаляє пілота разом із пов'язаними перевірками й допусками; у польотах посилання на нього
 * замінюється на null (запис польоту лишається).
 */
export function removePerson(data, personId) {
  return {
    ...data,
    persons: removeById(data.persons, personId),
    checks: data.checks.filter(c => c.personId !== personId),
    admissions: data.admissions.filter(a => a.personId !== personId),
    flights: data.flights.map(f => (f.personId === personId ? { ...f, personId: null } : f)),
  };
}
