// Хронометраж польотів і чернетка польотного листа. Без DOM і мережі.
// Події — мітки часу ГГ:ХХ:СС. Номер польоту зростає на кожен цикл «зліт → посадка».
// Підтверджений день отримує примітку «виконання польотних завдань».

export const TIMING_NOTE = 'виконання польотних завдань';
export const EVENT_KINDS = Object.freeze(['start', 'takeoff', 'landing', 'shutdown', 'note']);
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

/** «12:35:44» або null. */
export function normalizeClock(value) {
  const match = TIME_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}`;
}

/** Поточний місцевий час пристрою як ГГ:ХХ:СС. `now` — Date, щоб тести не залежали від годинника. */
export function clockText(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function clockToSeconds(value) {
  const clock = normalizeClock(value);
  if (!clock) return null;
  const [h, m, s] = clock.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Різниця посадки і зльоту в хвилинах. Через північ — додає добу. Немає пари — null. */
export function minutesBetween(from, to) {
  const a = clockToSeconds(from);
  const b = clockToSeconds(to);
  if (a === null || b === null) return null;
  const span = b >= a ? b - a : b + 86400 - a;
  return Math.round(span / 60);
}

export function emptyTiming(date) {
  return { id: null, date, status: 'open', note: null, exercise: '', logged: false, events: [] };
}

function flightMap(events) {
  const map = new Map();
  for (const event of events) {
    const number = event.flight || 0;
    const flight = map.get(number) || { number, exercise: '', start: null, takeoff: null, landing: null, shutdown: null, notes: [] };
    if (event.kind === 'note') flight.notes.push({ at: event.at, text: event.text || '' });
    else flight[event.kind] = event.at;
    if (event.exercise) flight.exercise = event.exercise;
    map.set(number, flight);
  }
  return map;
}

/** Політ, який уже почався (запуск або зліт) і ще не має посадки. */
function openFlightNumber(events) {
  const map = flightMap(events);
  const numbers = [...map.keys()].sort((a, b) => b - a);
  for (const number of numbers) {
    const flight = map.get(number);
    if (!flight.landing && (flight.start || flight.takeoff)) return number;
  }
  return null;
}

function lastNumber(events) {
  return events.reduce((max, event) => Math.max(max, event.flight || 0), 0);
}

/**
 * Додає подію. `at` — ГГ:ХХ:СС. Запуск і зліт після вже посадженого польоту відкривають наступний номер.
 * Посадка, вимкнення і примітка лишаються на поточному (або останньому) номері.
 */
export function applyTimingEvent(timing, { kind, at, text = null, exercise = null } = {}) {
  if (!EVENT_KINDS.includes(kind)) return { ok: false, error: 'Невідома подія хронометражу.' };
  const clock = normalizeClock(at);
  if (!clock) return { ok: false, error: 'Час має бути у форматі ГГ:ХХ:СС.' };
  if (kind === 'note' && !String(text || '').trim()) return { ok: false, error: 'Вкажіть текст примітки.' };
  const events = [...(timing.events || [])];
  let flight = openFlightNumber(events);
  const finished = number => events.some(event => event.flight === number && event.kind === 'landing');
  if (kind === 'start' || kind === 'takeoff') {
    if (flight === null || finished(flight)) flight = lastNumber(events) + 1;
  } else if (flight === null) {
    flight = lastNumber(events) || 1;
  }
  events.push({
    id: `e${events.length + 1}`,
    at: clock,
    kind,
    flight,
    text: kind === 'note' ? String(text).trim() : null,
    exercise: exercise || timing.exercise || null,
  });
  return { ok: true, timing: { ...timing, events } };
}

/** Згруповані польоти дня за номером. */
export function timingFlights(timing) {
  return [...flightMap(timing?.events || []).values()]
    .filter(flight => flight.number > 0)
    .sort((a, b) => a.number - b.number)
    .map(flight => ({ ...flight, exercise: flight.exercise || timing?.exercise || '', minutes: minutesBetween(flight.takeoff, flight.landing) }));
}

export function confirmTimingRecord(timing) {
  return { ...timing, status: 'confirmed', note: TIMING_NOTE };
}

/** Змінює час або вправу однієї події. */
export function editTimingEvent(timing, eventId, patch = {}) {
  const events = (timing.events || []).map(event => {
    if (event.id !== eventId) return event;
    const next = { ...event };
    if (patch.at !== undefined) {
      const clock = normalizeClock(patch.at);
      if (!clock) return event;
      next.at = clock;
    }
    if (patch.exercise !== undefined) next.exercise = patch.exercise || null;
    if (patch.text !== undefined && event.kind === 'note') next.text = String(patch.text);
    return next;
  });
  return { ...timing, events };
}

function addBucket(bucket, count, minutes) {
  bucket.flights += count;
  bucket.minutes += minutes;
}

/** Наліт і кількість польотів: місяць, рік, усього. Підтверджений хронометраж, уже записаний у книжку, не рахується двічі. */
export function flightOverview(data, today) {
  const month = { flights: 0, minutes: 0 };
  const year = { flights: 0, minutes: 0 };
  const total = { flights: 0, minutes: 0 };
  const y = String(today || '').slice(0, 4);
  const m = String(today || '').slice(0, 7);
  const add = (date, count, minutes) => {
    addBucket(total, count, minutes);
    if (date && String(date).startsWith(y)) addBucket(year, count, minutes);
    if (date && String(date).startsWith(m)) addBucket(month, count, minutes);
  };
  for (const flight of data?.flights || []) {
    add(flight.date, Number.isInteger(flight.count) ? flight.count : 0, Number.isInteger(flight.airtimeMin) ? flight.airtimeMin : 0);
  }
  for (const timing of data?.timings || []) {
    if (timing.status !== 'confirmed' || timing.logged) continue;
    for (const flight of timingFlights(timing)) {
      if (flight.minutes === null) continue;
      add(timing.date, 1, flight.minutes);
    }
  }
  return { month, year, total };
}

/** Порожній рядок зворотного боку, коли дату вписано вручну. */
export function blankSheetRow(date) {
  return {
    date,
    airfieldFrom: '',
    airfieldTo: '',
    weather: '',
    aircraftType: '',
    tailNumber: '',
    dayNight: 'day',
    exercise: '',
    takeoff: '',
    landing: '',
    count: 0,
    airtimeMin: null,
    airborneMin: null,
    cabinMin: null,
    smuMin: null,
    cloudMin: null,
    altitude: '',
    minimaApproaches: null,
    minimaLandings: null,
    landingSystem: '',
    grade: '',
    fta: '',
    fuelLiters: null,
    cargoKg: null,
    passengers: null,
    paratroopers: null,
    start: '',
    shutdown: '',
  };
}

export function emptyMinima() {
  const cell = () => ({ cloudTakeoff: '', cloudLand: '', visTakeoff: '', visLand: '', windTakeoff: '', windLand: '' });
  return { day: cell(), night: cell() };
}

/**
 * Чернетка польотного листа з підтверджених хронометражів (кілька дат).
 * Порожні поля лишаються порожніми — їх заповнює штурман.
 */
export function sheetFromTimings(timings, extras = {}) {
  const list = (Array.isArray(timings) ? timings : []).filter(item => item && item.status === 'confirmed');
  const rows = [];
  for (const timing of list) {
    for (const flight of timingFlights(timing)) {
      const minutes = flight.minutes;
      rows.push({
        date: timing.date,
        airfieldFrom: '',
        airfieldTo: '',
        weather: '',
        aircraftType: extras.aircraftType || '',
        tailNumber: extras.tailNumber || '',
        dayNight: 'day',
        exercise: flight.exercise || '',
        takeoff: flight.takeoff || '',
        landing: flight.landing || '',
        count: flight.takeoff && flight.landing ? 1 : 0,
        airtimeMin: minutes,
        airborneMin: minutes,
        cabinMin: null,
        smuMin: null,
        cloudMin: null,
        altitude: '',
        minimaApproaches: null,
        minimaLandings: null,
        landingSystem: '',
        grade: '',
        fta: '',
        fuelLiters: null,
        cargoKg: null,
        passengers: null,
        paratroopers: null,
        start: flight.start || '',
        shutdown: flight.shutdown || '',
      });
    }
  }
  return {
    dates: [...new Set(list.map(item => item.date))],
    header: {
      aircraftType: extras.aircraftType || '',
      tailNumber: extras.tailNumber || '',
      crew: extras.crew || '',
      task: extras.task || '',
      startTime: rows.find(row => row.start)?.start || '',
      minima: emptyMinima(),
    },
    rows,
    report: '',
  };
}

function sumKey(rows, key, dayNight = null) {
  return rows.reduce((sum, row) => {
    if (dayNight && row.dayNight !== dayNight) return sum;
    return sum + (Number.isInteger(row[key]) ? row[key] : 0);
  }, 0);
}

/** Підсумки зворотного боку: усього і окремо день / ніч. */
export function sheetTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const pack = dayNight => ({
    count: sumKey(list, 'count', dayNight),
    airtimeMin: sumKey(list, 'airtimeMin', dayNight),
    cabinMin: sumKey(list, 'cabinMin', dayNight),
    smuMin: sumKey(list, 'smuMin', dayNight),
    cloudMin: sumKey(list, 'cloudMin', dayNight),
    minimaApproaches: sumKey(list, 'minimaApproaches', dayNight),
    minimaLandings: sumKey(list, 'minimaLandings', dayNight),
  });
  return { all: pack(null), day: pack('day'), night: pack('night') };
}
