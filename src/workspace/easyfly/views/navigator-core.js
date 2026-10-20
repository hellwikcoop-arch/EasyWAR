// EasyFLY, екран «Штурман» і «Сонце і Місяць»: чиста логіка форми без DOM, мережі, Date.now і
// Math.random (перевіряється в tests/easyfly-nav-views.test.mjs). Розрахунки не дублюються:
// форма лише збирає «чернетку» (draft: рядки з полів) в опис польоту `flight` для nav-core.js,
// а документи й таблиці беруться з calcIshr / calcBortjournal / calcShpp.
//
// Чернетка (draft):
//   { date:'2026-10-20', exercise, callsign, typeId, board, empty, crew, fuelKg, fuelPreset,
//     toggles:{ evu, posNvRv, posDvPzu }, equipment:{ trusses:'', ..., armor:false }, cargoOther,
//     departure:{ name, lat, lon }, legs:[{ kind:'ppm'|'ko'|'kpm', name, mshk, h, v, s, landing, tTarget, lat, lon }],
//     wind:{ from, speedMs }, windActual:{ from, speedMs }, qfe, qnh, t0, takeoff, hMin, returnLine,
//     groundMin, reserveMin, commander, navigator, checker, captain }
// Порожні поля — '' (число не введено); число розбирає parseNum (кома чи крапка).

import {
  AIRCRAFT_TYPES,
  EQUIPMENT_WEIGHTS,
  aircraftType,
  calcBortjournal,
  calcIshr,
  calcShpp,
  departureName,
  equipmentWeight,
  formatMmss,
  kgToLiters,
  roundHalfEven,
  routePointsWithCoords,
  surchargesFor,
  validateFlight,
  formatSigned,
  formatTurn,
} from '../nav-core.js';
import { addDays, formatDateIso, formatDateUk, parseDate, sunMinutes, sunTimes, kyivOffsetForDate } from '../sun-core.js';
import { ONB_DEFAULT_THRESHOLD, onbNight, moonDay, skyForPoints } from '../moon-core.js';

// ───────────────────────────── Довідники форми ─────────────────────────────

/** Назви обладнання для випадного списку (ваги — з EQUIPMENT_WEIGHTS). */
export const EQUIPMENT_LABELS = Object.freeze({
  trusses: 'Ферми',
  blocksB8V20: 'Блоки Б8В20',
  b8v20Shells: 'Снаряди Б8В20',
  blocksB8V8: 'Блоки Б8В8',
  s8: 'НАР С-8',
  s8ko: 'НАР С-8КО',
  s8dm: 'НАР С-8ДМ',
  s8bm: 'НАР С-8БМ',
  s13: 'НАР С-13',
  s13of: 'НАР С-13ОФ',
  s13t: 'НАР С-13Т',
  beamHolders: 'Балкові тримачі',
  armor: 'Бронь',
});

/** Ключі обладнання за порядком у довіднику ваг. */
export const EQUIPMENT_KEYS = Object.freeze(Object.keys(EQUIPMENT_WEIGHTS));

/** Перемикачі нарахувань до Q, що вмикаються вручну (ферми й блоки визначаються за обладнанням). */
export const SURCHARGE_TOGGLES = Object.freeze([
  Object.freeze({ id: 'evu', label: 'ЄВУ' }),
  Object.freeze({ id: 'posNvRv', label: 'ПОС НВ і РВ' }),
  Object.freeze({ id: 'posDvPzu', label: 'ПОС двигунів і ПЗУ' }),
]);

/** Позначення пунктів маршруту: ВПМ — це аеродром вильоту, тож у списку ділянок його немає. */
export const POINT_KINDS = Object.freeze([
  Object.freeze({ value: 'ppm', label: 'ППМ' }),
  Object.freeze({ value: 'ko', label: 'КО' }),
  Object.freeze({ value: 'kpm', label: 'КПМ' }),
]);

/** Варіанти заправки: ключ у `type.fuel`. */
export const FUEL_PRESETS = Object.freeze([
  Object.freeze({ id: 'main', label: 'Основна' }),
  Object.freeze({ id: 'dpb1', label: 'З ДПБ-1' }),
  Object.freeze({ id: 'dpb2', label: 'З ДПБ-2' }),
  Object.freeze({ id: 'manual', label: 'Власна вага' }),
]);

/** Три документи штурмана. */
export const DOC_KINDS = Object.freeze({
  ishr: Object.freeze({
    id: 'ishr',
    tab: 'ІШР',
    title: 'ІШР · перегляд аркуша',
    subtitle: 'Друкована форма (Додаток 4), колонки й рядки бланка без змін',
    crumb: 'ІШР · перегляд аркуша',
    file: 'ishr',
  }),
  bortjournal: Object.freeze({
    id: 'bortjournal',
    tab: 'Бортжурнал',
    title: 'Бортжурнал · перегляд аркуша',
    subtitle: 'Бортовий журнал штурмана (Додаток 1), колонки й рядки бланка без змін',
    crumb: 'Бортжурнал · перегляд аркуша',
    file: 'bortjournal',
  }),
  shpp: Object.freeze({
    id: 'shpp',
    tab: 'ШПП',
    title: 'ШПП · перегляд аркуша',
    subtitle: 'Штурманський план польоту: схема маршруту й таблиця Wр / Wи',
    crumb: 'ШПП · перегляд аркуша',
    file: 'shpp',
  }),
});

export const DOC_ORDER = Object.freeze(['ishr', 'bortjournal', 'shpp']);

/** Стандартна умовна точка, коли координат аеродрому ніде не задано (синтетична). */
export const CONDITIONAL_POINT = Object.freeze({ lat: 50.0, lon: 30.0 });

// ───────────────────────────── Числа й текст ─────────────────────────────

/** Число з поля: кома чи крапка, пробіли (у тому числі нерозривні) ігноруються; порожнє чи хибне → null. */
export function parseNum(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\s  ]/g, '').replace(',', '.');
  if (!text || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** Ціле число з розділом тисяч нерозривним пробілом: 10759 → «10 759»; null/NaN → «—». */
export function fmtInt(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = roundHalfEven(Number(value));
  const sign = n < 0 ? '−' : '';
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Число з комою (для таблиць і CSV): 11.5 → «11,5». */
export function fmtDecimal(value, digits = null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const text = digits === null ? String(n) : n.toFixed(digits);
  return text.replace('.', ',');
}

/** Хвилини → «Г:ХВ:СК» або «ХВ:СК» (formatMmss); null → «—». */
export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '—';
  return formatMmss(Number(minutes));
}

const isoDate = value => formatDateIso(value) || '';
const text = value => (value === null || value === undefined ? '' : String(value).trim());

/** Дата «ДД.ММ.РРРР» з ISO (або порожній рядок). */
export const dateUk = value => formatDateUk(value);

/** Зсув ISO-дати на n діб; хибна дата → вихідний текст. */
export function shiftDate(value, days) {
  const date = parseDate(value);
  if (!date) return value;
  return formatDateIso(addDays(date, days));
}

// ───────────────────────────── Чернетка польоту ─────────────────────────────

function blankLeg(kind = 'ppm') {
  return { kind, name: '', mshk: '', h: '', v: '', s: '', landing: false, tTarget: '', lat: '', lon: '' };
}

/** Порожній рядок ділянки для кнопки «Додати пункт». */
export function newLeg(kind = 'ppm') {
  return blankLeg(kind);
}

/** Аеродром налаштувань частини: «аер. Зоря» (префікс не дублюється); порожньо, якщо не задано. */
export function airfieldLabel(unit) {
  const name = text(unit?.airfield);
  if (!name) return '';
  return /^аер\./i.test(name) ? name : `аер. ${name}`;
}

function airfieldFromSettings(unit) {
  const settings = unit?.settings || {};
  const lat = parseNum(settings.airfieldLat);
  const lon = parseNum(settings.airfieldLon);
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * Нова порожня чернетка: дата (сьогодні), тип за замовчуванням, аеродром із налаштувань.
 * Вага порожнього ПС, борт і паливо вводяться вручну — їх не підставляємо.
 */
export function defaultDraft({ today = '', unit = null } = {}) {
  const coords = airfieldFromSettings(unit);
  return {
    date: isoDate(today),
    exercise: '',
    callsign: '',
    typeId: AIRCRAFT_TYPES[0].id,
    board: '',
    empty: '',
    crew: '',
    fuelKg: '',
    fuelPreset: 'manual',
    toggles: { evu: false, posNvRv: false, posDvPzu: false },
    equipment: { armor: false },
    cargoOther: '',
    departure: { name: airfieldLabel(unit), lat: coords ? String(coords.lat) : '', lon: coords ? String(coords.lon) : '' },
    legs: [blankLeg('ppm'), blankLeg('kpm')],
    wind: { from: '', speedMs: '' },
    windActual: { from: '', speedMs: '' },
    qfe: '',
    qnh: '',
    t0: '',
    takeoff: '',
    hMin: '',
    returnLine: '',
    groundMin: '10',
    reserveMin: '30',
    commander: '',
    navigator: '',
    checker: '',
    captain: '',
  };
}

/**
 * Синтетичний приклад (Мі-8МТВ-1, маршрут Зоря – Дубки – Калина – Полігон – Явір – Зоря, борт № 123):
 * маса 10 759 кг, ІШР збігається з еталоном прототипу. Для кнопки «Приклад».
 */
export function demoDraft({ today = '2026-10-20', unit = null } = {}) {
  const draft = defaultDraft({ today, unit });
  const point = (kind, name, mshk, h, v, s, extra = {}) => ({ ...blankLeg(kind), name, mshk: String(mshk), h: String(h), v: String(v), s: String(s), ...extra });
  return {
    ...draft,
    exercise: '14',
    callsign: 'Сокіл-21',
    typeId: 'mi8mtv1',
    board: '123',
    empty: '7300',
    crew: '270',
    fuelKg: '2092',
    fuelPreset: 'main',
    toggles: { evu: true, posNvRv: false, posDvPzu: false },
    equipment: { trusses: '2', blocksB8V20: '2', s8: '40', armor: true },
    departure: { name: draft.departure.name || 'аер. Зоря', lat: draft.departure.lat || '50.0', lon: draft.departure.lon || '30.0' },
    legs: [
      point('ppm', 'Дубки', 45, 300, 200, 48, { lat: '50.2', lon: '30.2' }),
      point('ppm', 'Калина', 120, 300, 220, 65, { lat: '50.4', lon: '30.5' }),
      point('ppm', 'Полігон', 200, 200, 180, 52, { lat: '50.1', lon: '30.8' }),
      point('ppm', 'Явір', 290, 300, 220, 70, { lat: '49.8', lon: '30.3' }),
      point('kpm', draft.departure.name || 'аер. Зоря', 10, 300, 200, 55),
    ],
    wind: { from: '270', speedMs: '8' },
    windActual: { from: '250', speedMs: '10' },
    qfe: '748',
    qnh: '1012',
    t0: '12',
    takeoff: '09:00',
    hMin: '100',
    returnLine: 'ППМ 3 Полігон',
  };
}

function legHasData(leg) {
  return Boolean(
    text(leg?.name) || ['mshk', 'h', 'v', 's', 'tTarget'].some(key => text(leg?.[key]) !== ''),
  );
}

const pair = (from, speed) => {
  const speedMs = parseNum(speed);
  if (speedMs === null) return undefined;
  return { from: parseNum(from) ?? 0, speedMs };
};

const clock = value => (/^\d{1,2}:\d{2}$/.test(text(value)) ? text(value) : '');

/**
 * Підписанти з налаштувань частини: `unit.signers.first` — заступник командира з ІАС – начальник ІАС,
 * `second` — старший штурман. Необов'язкові; звання (якщо є) беруться з `unit.settings.iasChief / seniorNav`.
 */
export function signersFromUnit(unit) {
  const signers = unit?.signers || {};
  const settings = unit?.settings || {};
  const build = (name, fromSettings) => {
    if (fromSettings && typeof fromSettings === 'object') return fromSettings;
    const clean = text(name);
    return clean ? { rank: '', name: clean } : undefined;
  };
  return { iasChief: build(signers.first, settings.iasChief), seniorNav: build(signers.second, settings.seniorNav) };
}

/** Рядок про підписантів для підказки на екрані. */
export function signersNote(unit) {
  const names = [text(unit?.signers?.first), text(unit?.signers?.second)].filter(Boolean);
  if (!names.length) {
    return 'Підписанти не задані в Налаштуваннях частини: у документах лишаться порожні рядки. Підписанти необов’язкові.';
  }
  return `Підписанти (${names.join(', ')}) беруться з Налаштувань частини, необов’язкові.`;
}

/**
 * Чернетка → опис польоту для nav-core.js. Відсутні числа ділянок стають NaN (validateFlight їх помітить),
 * порожні рядки ділянок відкидаються. Підписанти додаються з `unit`.
 */
export function draftToFlight(draft, unit = null) {
  const d = draft || {};
  const equipment = {};
  for (const key of EQUIPMENT_KEYS) {
    if (key === 'armor') {
      if (d.equipment?.armor) equipment.armor = true;
    } else {
      const count = parseNum(d.equipment?.[key]);
      if (count !== null && count > 0) equipment[key] = count;
    }
  }
  const legs = (Array.isArray(d.legs) ? d.legs : []).filter(legHasData).map(leg => {
    const out = {
      kind: leg.kind || 'ppm',
      name: text(leg.name),
      mshk: parseNum(leg.mshk) ?? NaN,
      h: parseNum(leg.h) ?? 0,
      v: parseNum(leg.v) ?? NaN,
      s: parseNum(leg.s) ?? NaN,
      landing: leg.landing === true,
    };
    const target = parseNum(leg.tTarget);
    if (target !== null && target > 0) out.tTarget = target;
    const lat = parseNum(leg.lat);
    const lon = parseNum(leg.lon);
    if (lat !== null && lon !== null) {
      out.lat = lat;
      out.lon = lon;
    }
    return out;
  });
  const dep = d.departure || {};
  const depLat = parseNum(dep.lat);
  const depLon = parseNum(dep.lon);
  const departure = { name: text(dep.name) };
  if (depLat !== null && depLon !== null) {
    departure.lat = depLat;
    departure.lon = depLon;
  }
  const flight = {
    date: isoDate(d.date) || text(d.date),
    typeId: d.typeId,
    board: text(d.board),
    callsign: text(d.callsign),
    exercise: text(d.exercise),
    empty: parseNum(d.empty),
    crew: parseNum(d.crew) ?? 0,
    fuelKg: parseNum(d.fuelKg),
    groundMin: parseNum(d.groundMin) ?? 10,
    reserveMin: parseNum(d.reserveMin) ?? 30,
    equipment,
    cargoOther: parseNum(d.cargoOther) ?? 0,
    surcharges: surchargesFor(d.toggles || {}, equipment),
    departure,
    legs,
    takeoff: clock(d.takeoff),
    commander: text(d.commander),
    navigator: text(d.navigator),
    checker: text(d.checker),
    captain: text(d.captain),
    returnLine: text(d.returnLine),
  };
  const wind = pair(d.wind?.from, d.wind?.speedMs);
  if (wind) flight.wind = wind;
  const windActual = pair(d.windActual?.from, d.windActual?.speedMs);
  if (windActual) flight.windActual = windActual;
  for (const key of ['qfe', 'qnh', 't0', 'hMin']) {
    const number = parseNum(d[key]);
    if (number !== null) flight[key] = number;
  }
  const { iasChief, seniorNav } = signersFromUnit(unit);
  if (iasChief) flight.iasChief = iasChief;
  if (seniorNav) flight.seniorNav = seniorNav;
  return flight;
}

/** Паливо з варіанта заправки типу ПС: кг або null (нема даних / «власна вага»). */
export function fuelForPreset(typeId, presetId) {
  const type = aircraftType(typeId);
  const item = type?.fuel?.[presetId];
  return item ? item.kg : null;
}

/** Варіанти заправки, доступні для типу (з кг і л), + «Власна вага». */
export function fuelPresetsFor(typeId) {
  const type = aircraftType(typeId);
  return FUEL_PRESETS.filter(preset => preset.id === 'manual' || type?.fuel?.[preset.id]).map(preset => {
    const item = type?.fuel?.[preset.id];
    return item ? { ...preset, kg: item.kg, l: item.l } : { ...preset, kg: null, l: null };
  });
}

// ───────────────────────────── Живий підсумок ─────────────────────────────

const safe = fn => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/**
 * Підсумок розрахунку для правої панелі. Кількості бере з nav-core (calcIshr, calcBortjournal).
 * `blocking` — є помилки validateFlight (документи ще не відкрити); перевищення маси й нестача палива
 * лише попередження (документ усе одно можна переглянути).
 * @returns {{flight:object,issues:string[],warnings:string[],blocking:boolean,state:'ok'|'over'|'fuel'|'incomplete',
 *   stateText:string,type:(object|null),empty:(number|null),crew:number,fuelKg:(number|null),fuelL:(number|null),cargo:number,
 *   total:(number|null),mtow:(number|null),massOk:(boolean|null),massLine:string,qAir:(number|null),qGround:(number|null),
 *   k:(number|null),totalKm:number,airTimeMin:(number|null),routeFuelKg:(number|null),reserveKg:(number|null),
 *   reserveMin:number,remainKg:(number|null),ishr:(object|null),bj:(object|null)}}
 */
export function summarize(draft, unit = null) {
  const flight = draftToFlight(draft, unit);
  const issues = validateFlight(flight);
  const type = aircraftType(flight.typeId);
  const cargo = roundHalfEven(equipmentWeight(flight.equipment, flight.cargoOther));
  const empty = Number.isFinite(flight.empty) ? flight.empty : null;
  const fuelKg = Number.isFinite(flight.fuelKg) ? flight.fuelKg : null;
  const hasMass = empty !== null || fuelKg !== null || flight.crew > 0 || cargo > 0;
  const total = hasMass ? roundHalfEven((empty ?? 0) + flight.crew + (fuelKg ?? 0) + cargo) : null;
  const mtow = Number.isFinite(flight.mtow) ? flight.mtow : type?.mtow ?? null;
  const massOk = total === null || mtow === null ? null : total <= mtow;
  const ishr = safe(() => calcIshr(flight));
  const complete = issues.length === 0 && ishr !== null;
  const bj = complete ? safe(() => calcBortjournal(flight)) : null;
  const legCols = complete ? ishr.cols.filter(col => col.kind === 'leg') : [];
  const routeFuelKg = complete ? legCols.reduce((sum, col) => sum + col.legKg, 0) : null;
  const reserveCol = complete ? ishr.cols[ishr.cols.length - 1] : null;
  const totalKm = (flight.legs || []).reduce((sum, leg) => sum + (Number.isFinite(leg.s) ? leg.s : 0), 0)
    + (flight.legs || []).reduce((sum, leg, i, all) => sum + (leg.landing ? 5 : 0) + (i > 0 && all[i - 1].landing ? 5 : 0), 0);

  const warnings = [];
  if (massOk === false) {
    warnings.push(`Злітна маса ${fmtInt(total)} кг перевищує ${fmtInt(mtow)} кг на ${fmtInt(total - mtow)} кг.`);
  }
  if (complete && !ishr.fuelOk) {
    warnings.push(`Палива не вистачає: після навігаційного запасу залишок ${fmtInt(ishr.reserveKg)} кг.`);
  }
  if (bj) warnings.push(...bj.issues);

  let state = 'ok';
  let stateText = 'норма';
  if (!complete) {
    state = 'incomplete';
    stateText = 'потрібні дані';
  } else if (massOk === false) {
    state = 'over';
    stateText = 'перевищено злітну масу';
  } else if (!ishr.fuelOk) {
    state = 'fuel';
    stateText = 'не вистачає палива';
  }

  let massLine;
  if (total === null) massLine = 'Введіть вагу порожнього ПС, екіпажу й палива.';
  else if (mtow === null) massLine = `Злітна маса: ${fmtInt(total)} кг (норму маси для типу не задано)`;
  else if (massOk) massLine = `Злітна маса в межах: ${fmtInt(total)} / ${fmtInt(mtow)} кг`;
  else massLine = `Злітна маса перевищена: ${fmtInt(total)} / ${fmtInt(mtow)} кг`;

  return {
    flight,
    issues,
    warnings,
    blocking: issues.length > 0,
    state,
    stateText,
    type,
    empty,
    crew: flight.crew,
    fuelKg,
    fuelL: fuelKg === null ? null : kgToLiters(fuelKg),
    cargo,
    total,
    mtow,
    massOk,
    massLine,
    qAir: ishr ? ishr.q : null,
    qGround: ishr ? ishr.qGround : null,
    k: ishr ? ishr.k : null,
    totalKm,
    airTimeMin: bj ? bj.totals.tWindMin : null,
    routeFuelKg,
    reserveKg: reserveCol ? reserveCol.legKg : null,
    reserveMin: flight.reserveMin,
    remainKg: complete ? ishr.reserveKg : null,
    ishr: complete ? ishr : null,
    bj,
  };
}

// ───────────────────────────── CSV (Excel) ─────────────────────────────

const FORMULA_START = /^[=+@\t\r]|^-(?!\d)/;

/** Одна комірка CSV: число з комою, текст із захистом від формул, лапки за потреби. */
export function csvCell(value, delimiter = ';') {
  if (value === null || value === undefined) return '';
  let out;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    out = String(value).replace('.', ',');
    return out;
  }
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  out = String(value);
  if (FORMULA_START.test(out)) out = `'${out}`;
  if (out.includes(delimiter) || /["\r\n]/.test(out) || /^\s|\s$/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

/**
 * Таблиця → CSV для Excel: UTF-8 з BOM, роздільник `;` (українська локалізація Excel), CRLF,
 * десяткова кома. Рядок, що починається з =, +, @ або «-» не перед цифрою, отримує апостроф
 * (захист від формул). `rows` — масив масивів значень.
 */
export function toCsv(rows, { delimiter = ';', bom = true } = {}) {
  const body = (rows || []).map(row => (Array.isArray(row) ? row : [row]).map(value => csvCell(value, delimiter)).join(delimiter)).join('\r\n');
  return `${bom ? '﻿' : ''}${body}${body ? '\r\n' : ''}`;
}

/** Байти CSV (UTF-8, BOM зберігається) для host.saveFileAs. */
export function csvBytes(rows, options) {
  return new TextEncoder().encode(toCsv(rows, options));
}

/** Назва CSV-файлу лише з латиниці й цифр: ishr_2026-10-20_board-123.csv. */
export function csvFileName(kind, flight) {
  const info = DOC_KINDS[kind] || DOC_KINDS.ishr;
  const date = isoDate(flight?.date) || 'bez-daty';
  const board = text(flight?.board).replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '');
  return `${info.file}_${date}${board ? `_board-${board}` : ''}.csv`;
}

const dashIf = value => (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? '' : value);

/**
 * Таблиця документа для Excel: ті самі числа, що й на аркуші. Повертає масив рядків (масивів).
 * @param {'ishr'|'bortjournal'|'shpp'} kind
 * @param {object} flight опис польоту (draftToFlight)
 */
export function docRows(kind, flight) {
  if (kind === 'ishr') return ishrRows(flight);
  if (kind === 'bortjournal') return bortjournalRows(flight);
  if (kind === 'shpp') return shppRows(flight);
  throw new RangeError(`Невідомий документ: ${kind}`);
}

function personLine(person) {
  if (!person) return '';
  const name = text(person.name) || `${text(person.firstName)} ${text(person.surname).toUpperCase()}`.trim();
  return `${text(person.rank)} ${name}`.trim();
}

function ishrRows(flight) {
  const r = calcIshr(flight);
  const cols = r.cols;
  const rows = [
    ['Інженерно-штурманський розрахунок польоту'],
    [`${dateUk(flight.date)} · ${r.typeLabel} · борт № ${flight.board || ''}`.trim()],
    [],
    ['Розрахунок польотної ваги (кг)'],
    ['Вага порожнього ПС', r.empty],
    ['Вага екіпажу', r.crew],
    ['Вага палива, кг', r.fuelKg],
    ['Вага палива, л', r.fuelL],
    ['Вага вантажу', r.cargo],
    ['РАЗОМ', r.total],
    [],
    ['Маршрут польоту', r.route],
    [],
    ['Контрольні рубежі', ...cols.map(c => c.name)],
  ];
  const line = (label, pick) => rows.push([label, ...cols.map(c => dashIf(pick(c)))]);
  line('S по етапах (км)', c => c.s);
  line('Т по етапах (хв.)', c => c.t);
  line('Швидкість за приладами Vпр (км/год)', c => c.v);
  line('Q, кг/год', c => c.q);
  line('Витрата палива по ділянках (кг)', c => c.legKg);
  line('Витрата палива по ділянках (л)', c => kgToLiters(c.legKg));
  line('S, км (загальна)', c => c.S);
  line('Т (год/хв.) (загальний)', c => `${Math.floor(roundHalfEven(c.T) / 60)}:${String(roundHalfEven(c.T) % 60).padStart(2, '0')}`);
  line('Витрати палива (кг)', c => c.used);
  line('Витрати палива (л)', c => kgToLiters(c.used));
  line('Залишок палива (кг)', c => c.rem);
  line('Залишок палива (л)', c => kgToLiters(c.rem));
  line('Польотна вага вертольоту, кг', c => c.w);
  rows.push([]);
  rows.push(['Заступник командира авіаційної частини з ІАС – начальник ІАС', personLine(flight.iasChief)]);
  rows.push(['Старший штурман (штурман) авіаційної частини', personLine(flight.seniorNav)]);
  return rows;
}

function bortjournalRows(flight) {
  const j = calcBortjournal(flight);
  const h = j.header;
  const t = j.totals;
  const rows = [
    ['Бортовий журнал штурмана'],
    [`Дата: ${h.date}`, `ПС: ${h.typeLabel} № ${h.board}`, `Позивний: ${h.callsign}`, `Вправа № ${h.exercise}`],
    [`Маршрут: ${h.route}`],
    [`Командир: ${h.commander}`, `Штурман: ${h.navigator}`, `Перевірив: ${h.checker}`],
    [],
    ['Маршрут', 'МК', 'Н, м', 'V, км/год', 'S, км', 'T розр., хв:с', 'Залишок палива, кг', 'МК випр.', 'W, км/год', 'T з вітром, хв:с', 'Час розр.', 'КЗ'],
  ];
  for (const r of j.rows) {
    rows.push([
      r.label, r.mshk, r.h, r.v, r.s, r.ok ? formatMmss(r.tCalcMin) : '', r.rem,
      r.ok ? r.mk : '', r.ok ? r.w : '', r.ok && r.tWindMin !== null ? formatMmss(r.tWindMin) : '', r.clockPlan, r.ok ? r.kz : '',
    ]);
  }
  rows.push([
    'Усього за маршрутом', '', '', '', t.S, formatMmss(t.tCalcMin), t.rem, '', '',
    t.tWindMin === null ? '' : formatMmss(t.tWindMin), t.landingClock, '',
  ]);
  rows.push([]);
  rows.push([`Нмін., м: ${h.hMin ?? ''}`, `Рубіж повернення: ${h.returnLine}`, `Запас палива, кг: ${h.reserveKg}`, `Тзаг.: ${t.flightMin === null ? '' : formatMmss(t.flightMin)}`]);
  if (j.sun.length) {
    rows.push([]);
    rows.push(['Пункти', 'Схід', 'Захід']);
    for (const p of j.sun) rows.push([p.name, p.rise, p.set]);
  }
  return rows;
}

function shppRows(flight) {
  const p = calcShpp(flight);
  const name = point => (point.name ? `${point.code} ${point.name}` : point.code);
  const rows = [
    [p.title],
    [`по маршруту: ${p.routeText}`, p.captainLine],
    [],
    ['№', 'Ділянка', 'МК, °', 'S, км', 't, хв', 'Н, м', 'Кут повороту', 'Поправка на вітер (р), °', 'Поправка на вітер (и), °',
      'V за приладом', 'U (р)', 'Wр', 'U (и)', 'Wи', 'W потр. = S / t', 'V потр. = W − U', 'S ост., км', 't ост., хв', 'Примітка'],
  ];
  for (const leg of p.legs) {
    rows.push([
      leg.index + 1, `${name(leg.from)} → ${name(leg.to)}`, leg.mk, leg.s, leg.t, leg.h, formatTurn(leg.turnBefore),
      formatSigned(leg.windCorrR), formatSigned(leg.windCorrI), leg.v, formatSigned(leg.uR), leg.wR, formatSigned(leg.uI), leg.wI,
      leg.wNeed, leg.vNeedI, leg.sRemaining, leg.tRemaining, leg.note,
    ]);
  }
  rows.push(['', 'Разом', '', p.totals.S, p.totals.T]);
  return rows;
}

// ───────────────────────────── Сонце і Місяць ─────────────────────────────

/** Широта/довгота з поля: кома чи крапка; поза межами або не число → null. */
export function parseCoord(value, kind) {
  const n = parseNum(value);
  if (n === null) return null;
  const limit = kind === 'lat' ? 90 : 180;
  return Math.abs(n) <= limit ? n : null;
}

/** «50.0° пн. ш., 30.0° сх. д.» (з комою біля дробів — «50,0°»: так читається в українській мові). */
export function formatCoord(lat, lon) {
  const side = (value, pos, neg) => `${fmtDecimal(Math.abs(value), 1)}° ${value >= 0 ? pos : neg}`;
  return `${side(lat, 'пн. ш.', 'пд. ш.')}, ${side(lon, 'сх. д.', 'зх. д.')}`;
}

/** Тривалість дня «10:30» → «10 год 30 хв». */
export function dayLengthText(value) {
  const match = /^(\d+):(\d{2})$/.exec(value || '');
  return match ? `${Number(match[1])} год ${Number(match[2])} хв` : '—';
}

const SHORT = date => {
  const d = parseDate(date);
  return d ? `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}` : '';
};

/** «зростаючий» → «Зростаючий». */
export const capitalize = value => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');

/**
 * Точки для екрана «Сонце і Місяць»: аеродром (координати введені → з польоту → з налаштувань → умовні),
 * далі пункти маршруту з координатами, далі додані вручну. Імена не повторюються.
 * @returns {Array<{name:string,lat:number,lon:number,source:'manual'|'flight'|'settings'|'conditional'|'extra'}>}
 */
export function buildPoints({ flight = null, unit = null, airfield = null, extra = [] } = {}) {
  const points = [];
  const seen = new Set();
  const add = (name, lat, lon, source) => {
    const clean = text(name);
    if (!clean || seen.has(clean) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    seen.add(clean);
    points.push({ name: clean, lat, lon, source });
  };
  const flightPoints = flight ? routePointsWithCoords(flight) : [];
  const depName = (flight ? departureName(flight) : '') || airfieldLabel(unit) || 'Аеродром';
  const depFromFlight = flightPoints.find(item => item.name === depName);
  const fromSettings = airfieldFromSettings(unit);
  if (airfield && Number.isFinite(airfield.lat) && Number.isFinite(airfield.lon)) add(depName, airfield.lat, airfield.lon, 'manual');
  else if (depFromFlight) add(depName, depFromFlight.lat, depFromFlight.lon, 'flight');
  else if (fromSettings) add(depName, fromSettings.lat, fromSettings.lon, 'settings');
  else add(depName, CONDITIONAL_POINT.lat, CONDITIONAL_POINT.lon, 'conditional');
  for (const item of flightPoints) add(item.name, item.lat, item.lon, 'flight');
  for (const item of extra || []) add(item.name, item.lat, item.lon, 'extra');
  return points;
}

/** Поріг освітленості Місяця для індикатора ОНБ із налаштувань частини (за замовчуванням 50 %). */
export function onbThreshold(unit) {
  const value = Number(unit?.settings?.onbCriterionPercent);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : ONB_DEFAULT_THRESHOLD;
}

/**
 * Смужка доби (схематична): сегменти 00:00–24:00 — ніч, навігаційні сутінки, цивільні сутінки, день.
 * Відсутні події (полярна доба/ніч) дають одну суцільну смугу «день» або «ніч».
 * @param {{nauticalDawn,dawn,sunrise,sunset,dusk,nauticalDusk}} minutes хвилини від півночі (sunMinutes)
 * @returns {Array<{kind:'night'|'nautical'|'civil'|'day',from:number,to:number,pct:number}>}
 */
export function daySegments(minutes) {
  const clampMin = value => Math.min(1440, Math.max(0, value));
  const m = minutes || {};
  const have = ['nauticalDawn', 'dawn', 'sunrise', 'sunset', 'dusk', 'nauticalDusk'].every(key => Number.isFinite(m[key]));
  if (!have) {
    const polarDay = Number.isFinite(m.nauticalDawn) === false && Number.isFinite(m.sunrise) === false && Number.isFinite(m.dawn) === false;
    return [{ kind: polarDay ? 'night' : 'civil', from: 0, to: 1440, pct: 100 }];
  }
  const bounds = [
    [0, m.nauticalDawn, 'night'],
    [m.nauticalDawn, m.dawn, 'nautical'],
    [m.dawn, m.sunrise, 'civil'],
    [m.sunrise, m.sunset, 'day'],
    [m.sunset, m.dusk, 'civil'],
    [m.dusk, m.nauticalDusk, 'nautical'],
    [m.nauticalDusk, 1440, 'night'],
  ];
  return bounds
    .map(([from, to, kind]) => ({ kind, from: clampMin(from), to: clampMin(to) }))
    .filter(seg => seg.to > seg.from)
    .map(seg => ({ ...seg, pct: ((seg.to - seg.from) / 1440) * 100 }));
}

/**
 * Модель екрана «Сонце і Місяць» для вибраної точки та дати.
 * @param {{date:string,points:Array,index?:number,threshold?:number}} input
 * @returns {object|null} null, якщо дата чи точки хибні
 */
export function sunMoonModel({ date, points, index = 0, threshold = ONB_DEFAULT_THRESHOLD }) {
  const iso = isoDate(date);
  if (!iso || !points || !points.length) return null;
  const point = points[Math.min(Math.max(index, 0), points.length - 1)];
  const tz = kyivOffsetForDate(iso);
  const sun = sunTimes(iso, point.lat, point.lon, tz);
  const minutes = sunMinutes(iso, point.lat, point.lon, tz);
  const moon = moonDay(iso, point.lat, point.lon, tz);
  const onb = onbNight(iso, point.lat, point.lon, { threshold, tzHours: tz });
  const nextShort = SHORT(addDays(iso, 1));
  const dash = value => value || '—';
  const sunRows = [
    { key: 'nauticalDawn', value: dash(sun.nauticalDawn) },
    { key: 'dawn', value: dash(sun.dawn) },
    { key: 'sunrise', value: dash(sun.sunrise) },
    { key: 'sunset', value: dash(sun.sunset) },
    { key: 'dusk', value: dash(sun.dusk) },
    { key: 'nauticalDusk', value: dash(sun.nauticalDusk) },
  ];
  const segments = daySegments(minutes);
  const ticks = ['00:00', sun.nauticalDawn, sun.sunrise, sun.sunset, sun.nauticalDusk, '24:00'].filter(Boolean);
  return {
    date: iso,
    dateLabel: dateUk(iso),
    nextLabel: nextShort,
    tzHours: tz,
    point,
    coordsText: formatCoord(point.lat, point.lon),
    sun: { ...sun, rows: sunRows, dayLengthText: dayLengthText(sun.dayLength) },
    moon: {
      illumination: moon.illumination,
      phase: moon.phase,
      phaseText: capitalize(moon.phase),
      ageText: `вік ${fmtDecimal(moon.ageDays, 1)} дня`,
      waxing: moon.waxing,
      rise: dash(moon.rise),
      set: moon.set ? (moon.setNextDay ? `${moon.set} (${nextShort})` : moon.set) : '—',
      transit: dash(moon.transit),
      maxAltitudeText: moon.maxAltitude === null || moon.maxAltitude === undefined ? '—' : `${fmtDecimal(moon.maxAltitude, 1)}°`,
    },
    onb: {
      favourable: onb.favourable,
      illumination: onb.illumination,
      threshold: onb.threshold,
      moonInDarkText: onb.moonInDarkText,
    },
    strip: { segments, ticks, nextLabel: nextShort },
    rows: skyForPoints(iso, points, { tzHours: tz }).map(row => ({
      ...row,
      coordsText: formatCoord(row.lat, row.lon),
      moonText: `${row.illumination} % · ${row.phase}`,
    })),
  };
}

// ───────────────────────────── Стан між екранами ─────────────────────────────

/**
 * Стан розрахунку на час життя сторінки застосунку. У схемі даних EasyFLY (fly-store.js) колекції
 * для розрахунків штурмана немає, тому чернетка живе тут (модульний стан), а не в `data`.
 * Екрани «Штурман» і «Сонце і Місяць» ділять цей об'єкт.
 */
export const navSession = {
  draft: null,
  tab: 'calc',
  zoom: 1,
  sunDate: '',
  sunIndex: 0,
  airfield: null,
  extraPoints: [],
};

/** Скидання стану (для тестів і кнопки «Очистити»). */
export function resetNavSession() {
  navSession.draft = null;
  navSession.tab = 'calc';
  navSession.zoom = 1;
  navSession.sunDate = '';
  navSession.sunIndex = 0;
  navSession.airfield = null;
  navSession.extraPoints = [];
}

export { AIRCRAFT_TYPES, aircraftType };
