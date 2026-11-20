// Хронометраж польотів і чернетка польотного листа. Без DOM і мережі.
// Події — мітки часу ГГ:ХХ:СС. Номер польоту зростає на кожен цикл «зліт → посадка».
// Підтверджений день отримує примітку «виконання польотних завдань».

export const TIMING_NOTE = 'виконання польотних завдань';
/** Витрата пального в хронометражі: літри за хвилину. Це розрахункові коефіцієнти екрана, не норма з документа. */
export const FUEL_AIR_L_PER_MIN = 11.2;
export const FUEL_GROUND_L_PER_MIN = 6;
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

/**
 * Тривалості завершених польотів.
 * Земля до зльоту — від запуску до зльоту.
 * Земля після посадки — до вимкнення, а якщо його немає — до наступного зльоту.
 * Запуск–зліт, який уже входить у «посадка → наступний зліт», другий раз не додається.
 */
export function flightDurations(timing) {
  const complete = timingFlights(timing).filter(flight => flight.takeoff && flight.landing);
  return complete.map((flight, index) => {
    const prev = complete[index - 1];
    const next = complete[index + 1];
    const airMin = minutesBetween(flight.takeoff, flight.landing) ?? 0;
    const insidePrevGap = Boolean(prev && !prev.shutdown);
    const groundBefore = flight.start && !insidePrevGap ? (minutesBetween(flight.start, flight.takeoff) ?? 0) : 0;
    let groundAfter = 0;
    if (flight.shutdown) groundAfter = minutesBetween(flight.landing, flight.shutdown) ?? 0;
    else if (next?.takeoff) groundAfter = minutesBetween(flight.landing, next.takeoff) ?? 0;
    return { ...flight, airMin, groundBefore, groundAfter, totalMin: airMin + groundBefore + groundAfter };
  });
}

/** Підсумок дня: кількість, наліт повітря, земля, загальний наліт і паливо з розкладом. */
export function timingDaySummary(timing) {
  const rows = flightDurations(timing);
  const airMin = rows.reduce((sum, row) => sum + row.airMin, 0);
  const groundBefore = rows.reduce((sum, row) => sum + row.groundBefore, 0);
  const groundAfter = rows.reduce((sum, row) => sum + row.groundAfter, 0);
  const groundMin = groundBefore + groundAfter;
  const fuelAir = Math.round(airMin * FUEL_AIR_L_PER_MIN * 10) / 10;
  const fuelGround = Math.round(groundMin * FUEL_GROUND_L_PER_MIN * 10) / 10;
  return {
    flights: rows.length,
    airMin,
    groundBefore,
    groundAfter,
    groundMin,
    totalMin: airMin + groundMin,
    fuelAir,
    fuelGround,
    fuel: Math.round((fuelAir + fuelGround) * 10) / 10,
    passengers: Number.isInteger(timing?.passengers) ? timing.passengers : null,
    remark: timing?.remark || '',
    dayNight: timing?.dayNight === 'night' ? 'night' : 'day',
  };
}

/** Мінімум погоди на бланку потрібен, лише якщо завдання чи вправа про хмари або мінімум. */
export function needsMinima(text) {
  return /хмар|мінім|сму|імц|прилад|заход/i.test(String(text || ''));
}

/** Звання, прізвище та, для командира екіпажу, позивний. */
export function personBits(person, withCall = false) {
  if (!person || typeof person !== 'object') return '';
  const who = [person.rank, person.name].map(part => String(part || '').trim()).filter(Boolean).join(' ');
  const call = withCall && String(person.callsign || '').trim() ? `позивний ${String(person.callsign).trim()}` : '';
  return [who, call].filter(Boolean).join(', ');
}

/** Рядок екіпажу для бланка. Позивний лише в командира екіпажу. */
export function crewText(crew) {
  if (!crew || typeof crew === 'string') return String(crew || '');
  const line = (label, person, withCall = false) => {
    const body = personBits(person, withCall);
    return body ? `${label}: ${body}` : '';
  };
  return [
    line('КЕ', crew.ke, true),
    line('ЛШ', crew.lsh),
    line('БТ', crew.bt),
    line('ЛІ', crew.instructor),
    String(crew.extra || '').trim() ? `додатково: ${String(crew.extra).trim()}` : '',
  ].filter(Boolean).join('; ');
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
    for (const flight of flightDurations(timing)) {
      rows.push({
        date: timing.date,
        airfieldFrom: '',
        airfieldTo: '',
        weather: '',
        aircraftType: extras.aircraftType || '',
        tailNumber: extras.tailNumber || '',
        dayNight: timing.dayNight === 'night' ? 'night' : 'day',
        exercise: flight.exercise || timing.exercise || '',
        takeoff: flight.takeoff || '',
        landing: flight.landing || '',
        count: 1,
        airtimeMin: flight.airMin,
        totalMin: flight.totalMin,
        cabinMin: null,
        smuMin: null,
        cloudMin: null,
        altitude: '',
        minimaApproaches: null,
        minimaLandings: null,
        landingSystem: '',
        grade: '',
        start: flight.start || '',
        shutdown: flight.shutdown || '',
      });
    }
  }
  const starts = rows.map(row => row.start).filter(Boolean).sort();
  const ends = rows.map(row => row.shutdown).filter(Boolean).sort();
  return {
    dates: [...new Set(list.map(item => item.date))],
    header: {
      aircraftType: extras.aircraftType || '',
      tailNumber: extras.tailNumber || '',
      crew: extras.crew && typeof extras.crew === 'object' ? extras.crew : {},
      task: extras.task || '',
      engineStart: starts[0] || '',
      engineEnd: ends.at(-1) || '',
      minima: extras.minima || emptyMinima(),
      showMinima: extras.showMinima === true,
    },
    rows,
    report: extras.report || '',
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
    totalMin: sumKey(list, 'totalMin', dayNight),
  });
  return { all: pack(null), day: pack('day'), night: pack('night') };
}
