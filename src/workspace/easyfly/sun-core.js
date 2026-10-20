// EasyFLY: Сонце офлайн. Схід, захід, цивільні й навігаційні сутінки за датою та координатами
// (алгоритм NOAA, точність ±1–2 хв) і київський час із літнім часом.
// Чиста логіка без DOM, мережі, Date.now і Math.random: перевіряється в node --test.
// Порт прототипу sun_core.py — результати збігаються з ним до хвилини.

/** Зенітні кути подій Сонця, градуси. Для авіації межа «день/ніч» — цивільні сутінки. */
export const SUN_ZENITH = Object.freeze({
  sunrise: 90.833,
  civil: 96,
  nautical: 102,
});

/** Ключі подій Сонця в порядку доби. */
export const SUN_EVENT_KEYS = Object.freeze(['nauticalDawn', 'dawn', 'sunrise', 'sunset', 'dusk', 'nauticalDusk']);

/** Підписи подій українською (без градусів: межі названі словами). */
export const SUN_EVENT_LABELS = Object.freeze({
  nauticalDawn: 'Навігаційний світанок',
  dawn: 'Світанок',
  sunrise: 'Схід',
  sunset: 'Захід',
  dusk: 'Настання темряви',
  nauticalDusk: 'Навігаційна темрява',
  dayLength: 'Тривалість дня',
});

const rad = degrees => (degrees * Math.PI) / 180;
const deg = radians => (radians * 180) / Math.PI;

/** Додатний залишок (як `%` у Python). */
export function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/** Округлення до цілого «до парного» (як `round` у Python): 2,5 → 2; 3,5 → 4; 77,5 → 78. */
export function roundHalfEven(value) {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

const pad2 = n => String(n).padStart(2, '0');

/**
 * Розбирає дату: рядок «РРРР-ММ-ДД» або «ДД.ММ.РРРР», або об'єкт {year, month, day}.
 * Повертає { year, month, day } або null, якщо дата неіснуюча.
 */
export function parseDate(input) {
  let year;
  let month;
  let day;
  if (typeof input === 'string') {
    const text = input.trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) {
      [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else {
      match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
      if (!match) return null;
      [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    }
  } else if (input && typeof input === 'object') {
    year = Number(input.year);
    month = Number(input.month);
    day = Number(input.day);
  } else {
    return null;
  }
  if (![year, month, day].every(Number.isInteger)) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function requireDate(input) {
  const date = parseDate(input);
  if (!date) throw new RangeError(`Некоректна дата: ${JSON.stringify(input)}`);
  return date;
}

/** «ДД.ММ.РРРР» (формат друкованих бланків) або порожній рядок, якщо дата не розпізнана. */
export function formatDateUk(input) {
  const date = parseDate(input);
  return date ? `${pad2(date.day)}.${pad2(date.month)}.${date.year}` : '';
}

/** «РРРР-ММ-ДД» або порожній рядок. */
export function formatDateIso(input) {
  const date = parseDate(input);
  return date ? `${date.year}-${pad2(date.month)}-${pad2(date.day)}` : '';
}

/** Дата наступної доби (для відображення «(21.10)» біля подій після півночі). */
export function addDays(input, days) {
  const date = requireDate(input);
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/** Юліанська дата на 0:00 UTC заданої доби (прототип `_jd`). */
export function julianDay0h(input) {
  const { year, month, day } = requireDate(input);
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045 -
    0.5
  );
}

// ---------- Київський час і літній час (правило ЄС) ----------

/** День місяця останньої неділі заданого місяця (1–12) року. */
export function lastSundayOfMonth(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay(); // 0 = неділя
  return lastDay - weekday;
}

/** Початок літнього часу: остання неділя березня, 01:00 UTC (мс від епохи). */
export function dstStartUtc(year) {
  return Date.UTC(year, 2, lastSundayOfMonth(year, 3), 1, 0, 0);
}

/** Кінець літнього часу: остання неділя жовтня, 01:00 UTC (мс від епохи). */
export function dstEndUtc(year) {
  return Date.UTC(year, 9, lastSundayOfMonth(year, 10), 1, 0, 0);
}

/**
 * Зсув київського часу відносно UTC, годин, для моменту `utcMs` (мс від епохи UTC):
 * 3 від 01:00 UTC останньої неділі березня до 01:00 UTC останньої неділі жовтня, інакше 2.
 * Ранок переходу (а не лише дата) визначає саме момент.
 */
export function kyivOffsetAtUtc(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  return utcMs >= dstStartUtc(year) && utcMs < dstEndUtc(year) ? 3 : 2;
}

/**
 * Зсув київського часу для доби (як прототип): у день переходу діє зсув після переходу.
 * Дорівнює зсуву в полудень UTC цієї дати.
 */
export function kyivOffsetForDate(input) {
  const { year, month, day } = requireDate(input);
  return kyivOffsetAtUtc(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** Київський час для моменту UTC: { date, hour, minute, offset, text:'ДД.ММ.РРРР ГГ:ХХ' }. */
export function toKyivTime(utcMs) {
  const offset = kyivOffsetAtUtc(utcMs);
  const local = new Date(utcMs + offset * 3600000);
  const date = { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  return { date, hour, minute, offset, text: `${formatDateUk(date)} ${pad2(hour)}:${pad2(minute)}` };
}

// ---------- Сонце (NOAA) ----------

function solarParameters(jc) {
  const L0 = mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360);
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const Mr = rad(M);
  const C =
    Math.sin(Mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const L0r = rad(L0);
  const eot =
    4 *
    deg(
      y * Math.sin(2 * L0r) -
        2 * e * Math.sin(Mr) +
        4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
        0.5 * y * y * Math.sin(4 * L0r) -
        1.25 * e * e * Math.sin(2 * Mr),
    );
  return { decl, eot };
}

/**
 * Хвилини UTC (від 0:00 UTC доби) події Сонця; null, якщо Сонце не досягає зеніту (полярні умови).
 * @param {object|string} date доба
 * @param {number} lat широта, градуси (пн. +)
 * @param {number} lon довгота, градуси (сх. +)
 * @param {number} zenith зенітний кут події
 * @param {boolean} rising true — ранкова подія
 */
export function sunEventUtcMinutes(date, lat, lon, zenith, rising) {
  const jd = julianDay0h(date);
  let jc = (jd - 2451545) / 36525;
  let minutes = null;
  for (let i = 0; i < 2; i += 1) {
    const { decl, eot } = solarParameters(jc);
    const cosH =
      Math.cos(rad(zenith)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
    if (cosH < -1 || cosH > 1) return null;
    let H = deg(Math.acos(cosH));
    H = rising ? H : -H;
    minutes = 720 - 4 * (lon + H) - eot;
    jc = (jd + minutes / 1440 - 2451545) / 36525;
  }
  return minutes;
}

/** «ГГ:ХВ» за хвилинами від півночі (дробова частина відкидається, доба по колу). */
export function formatClock(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) return null;
  const whole = mod(Math.floor(totalMinutes + 1e-9), 1440);
  return `${pad2(Math.floor(whole / 60))}:${pad2(whole % 60)}`;
}

/** «Г:ХВ» без ведучого нуля (тривалість). */
export function formatDuration(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(totalMinutes)) return null;
  const m = roundHalfEven(totalMinutes);
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

const SUN_EVENT_DEFS = Object.freeze({
  nauticalDawn: [SUN_ZENITH.nautical, true],
  dawn: [SUN_ZENITH.civil, true],
  sunrise: [SUN_ZENITH.sunrise, true],
  sunset: [SUN_ZENITH.sunrise, false],
  dusk: [SUN_ZENITH.civil, false],
  nauticalDusk: [SUN_ZENITH.nautical, false],
});

/**
 * Події Сонця в місцевому часі як хвилини від місцевої півночі доби (дробові; можуть вийти
 * за 0…1440 біля полярних широт). Відсутня подія — null.
 */
export function sunMinutes(date, lat, lon, tzHours = kyivOffsetForDate(date)) {
  const out = {};
  for (const key of SUN_EVENT_KEYS) {
    const [zenith, rising] = SUN_EVENT_DEFS[key];
    const utc = sunEventUtcMinutes(date, lat, lon, zenith, rising);
    out[key] = utc === null ? null : utc + tzHours * 60;
  }
  return out;
}

/**
 * Схід, захід і сутінки доби за місцевим часом.
 * @param {object|string} date доба («РРРР-ММ-ДД», «ДД.ММ.РРРР» або {year,month,day})
 * @param {number} lat широта
 * @param {number} lon довгота
 * @param {number} [tzHours] зсув від UTC; без нього — київський час з літнім часом
 * @returns {{nauticalDawn,dawn,sunrise,sunset,dusk,nauticalDusk:(string|null),dayLength:(string|null),tzHours:number,minutes:object}}
 *   `dawn`/`dusk` — межі цивільних сутінків («світанок» і «настання темряви»).
 */
export function sunTimes(date, lat, lon, tzHours) {
  const tz = tzHours === undefined || tzHours === null ? kyivOffsetForDate(date) : tzHours;
  const minutes = sunMinutes(date, lat, lon, tz);
  const out = { tzHours: tz, minutes };
  for (const key of SUN_EVENT_KEYS) out[key] = formatClock(minutes[key]);
  out.dayLength =
    minutes.sunrise !== null && minutes.sunset !== null ? formatDuration(minutes.sunset - minutes.sunrise) : null;
  return out;
}
