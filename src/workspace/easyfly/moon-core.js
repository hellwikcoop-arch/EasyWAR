// EasyFLY: Місяць офлайн. Фаза, освітленість, вік, схід, захід, кульмінація й максимальна висота
// за датою та координатами; довідковий індикатор «сприятлива ніч для ОНБ».
// Спрощена теорія Меєса (гл. 47, головні члени): положення ≈0,3°, час сходу/заходу ≈±3 хв.
// Чиста логіка без DOM, мережі, Date.now і Math.random. Порт прототипу moon_core.py.
//
// Кульмінація — максимум висоти на сітці з кроком 10 хв (точність ±5 хв), округлена до хвилини.
//
// Доба для сходу/заходу: від місцевого ПОЛУДНЯ заданої дати до місцевого полудня наступної
// (так само, як у прототипі), тому захід після півночі належить «ночі» заданої дати
// (20.10 → захід 01:31 уже 21.10: `setNextDay`). Освітленість і фаза — на кінець доби
// (місцева північ між датами), тобто для самої ночі.

import {
  SUN_EVENT_KEYS,
  addDays,
  formatClock,
  julianDay0h,
  kyivOffsetForDate,
  mod,
  roundHalfEven,
  sunMinutes,
} from './sun-core.js';

const R = degrees => (degrees * Math.PI) / 180;

/** Поріг освітленості (%) за замовчуванням для індикатора «сприятлива ніч для ОНБ». */
export const ONB_DEFAULT_THRESHOLD = 50;

/** Назви фаз (вісім секторів по 45° елонгації) — як у прототипі. */
export const MOON_PHASE_NAMES = Object.freeze([
  'молодик',
  'молодий місяць',
  'перша чверть',
  'зростаючий',
  'повня',
  'спадаючий',
  'остання чверть',
  'старий місяць',
]);

const TERMS_L = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116],
  [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758],
  [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720], [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036], [2, 0, 2, 0, 3994],
  [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665], [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390],
  [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236],
];
const TERMS_R = [
  [0, 0, 1, 0, -20905355], [2, 0, -1, 0, -3699111], [2, 0, 0, 0, -2955968], [0, 0, 2, 0, -569925], [0, 1, 0, 0, 48888],
  [0, 0, 0, 2, -3149], [2, 0, -2, 0, 246158], [2, -1, -1, 0, -152138], [2, 0, 1, 0, -170733], [2, -1, 0, 0, -204586],
  [0, 1, -1, 0, -129620], [1, 0, 0, 0, 108743], [0, 1, 1, 0, 104755], [2, 0, 0, -2, 10321], [0, 0, 1, -2, 79661],
  [4, 0, -1, 0, -34782], [0, 0, 3, 0, -23210], [4, 0, -2, 0, -21636],
];
const TERMS_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324], [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
];

/** Положення Місяця на юліанську дату: довгота, широта, відстань (км), пряме сходження, схилення (градуси). */
function moonPosition(jd) {
  const T = (jd - 2451545) / 36525;
  const Lp = mod(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T, 360);
  const D = mod(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T, 360);
  const M = mod(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T, 360);
  const Mp = mod(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T, 360);
  const F = mod(93.272095 + 483202.0175233 * T - 0.0036539 * T * T, 360);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const sum = (terms, fn) => {
    let total = 0;
    for (const [d, m, mp, f, c] of terms) {
      const e = E ** Math.abs(m);
      total += c * e * fn(R(d * D + m * M + mp * Mp + f * F));
    }
    return total;
  };
  const lon =
    Lp +
    sum(TERMS_L, Math.sin) / 1e6 +
    (3958 / 1e6) * Math.sin(R(119.75 + 131.849 * T)) +
    (1962 / 1e6) * Math.sin(R(Lp - F));
  const lat = sum(TERMS_B, Math.sin) / 1e6;
  const dist = 385000.56 + sum(TERMS_R, Math.cos) / 1000;
  const eps = 23.439291 - 0.0130042 * T;
  const lo = R(lon);
  const la = R(lat);
  const ep = R(eps);
  const ra =
    mod((Math.atan2(Math.sin(lo) * Math.cos(ep) - Math.tan(la) * Math.sin(ep), Math.cos(lo)) * 180) / Math.PI, 360);
  const dec = (Math.asin(Math.sin(la) * Math.cos(ep) + Math.cos(la) * Math.sin(ep) * Math.sin(lo)) * 180) / Math.PI;
  return { lon, lat, dist, ra, dec };
}

function sunLongitude(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + 36000.76983 * T, 360);
  const M = R(mod(357.52911 + 35999.05029 * T, 360));
  return mod(L0 + 1.914602 * Math.sin(M) + 0.019993 * Math.sin(2 * M), 360);
}

function gmst(jd) {
  const T = (jd - 2451545) / 36525;
  return mod(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T, 360);
}

const parallaxOf = dist => (Math.asin(6378.14 / dist) * 180) / Math.PI;

/** Висота центра Місяця мінус горизонтальний паралакс (геоцентрична → топоцентрична), без рефракції. */
function altitude(jd, lat, lon) {
  const { dist, ra, dec } = moonPosition(jd);
  const H = R(mod(gmst(jd) + lon - ra, 360));
  const h =
    (Math.asin(Math.sin(R(lat)) * Math.sin(R(dec)) + Math.cos(R(lat)) * Math.cos(R(dec)) * Math.cos(H)) * 180) / Math.PI;
  return h - parallaxOf(dist);
}

/** Поріг для `altitude`: видимий верхній край із рефракцією. */
function horizonThreshold(jd) {
  const par = parallaxOf(moonPosition(jd).dist);
  return 0.7275 * par - 0.5667 - par;
}

/**
 * Місяць у добу `date` для точки (lat, lon).
 * @param {object|string} date доба
 * @param {number} lat широта, градуси
 * @param {number} lon довгота, градуси
 * @param {number} [tzHours] зсув від UTC; без нього — київський час з літнім часом
 * @returns {{rise,set,transit:(string|null),riseMin,setMin,transitMin:(number|null),riseNextDay,setNextDay:boolean,
 *   upAtNoon:boolean,maxAltitude:(number|null),illumination:number,ageDays:number,phase:string,waxing:boolean,tzHours:number}}
 *   Хвилини `*Min` — від місцевої півночі заданої дати (після півночі наступної доби ≥ 1440).
 */
export function moonDay(date, lat, lon, tzHours) {
  const tz = tzHours === undefined || tzHours === null ? kyivOffsetForDate(date) : tzHours;
  const jd0 = julianDay0h(date) + 0.5 - tz / 24; // місцеве полудень заданої дати
  const toMinutes = jd => 720 + (jd - jd0) * 1440; // хвилини від місцевої півночі заданої дати
  const f = jd => altitude(jd, lat, lon) - horizonThreshold(jd);
  let riseJd = null;
  let setJd = null;
  let best = [-99, null];
  let prevH = f(jd0);
  const upAtNoon = prevH >= 0;
  let prevJd = jd0;
  const step = 1 / 144; // 10 хв
  for (let i = 1; i <= 144; i += 1) {
    const jd = jd0 + i * step;
    const h = f(jd);
    if (h > best[0]) best = [h, jd];
    if ((prevH < 0 && h >= 0) || (prevH >= 0 && h < 0)) {
      let a = prevJd;
      let b = jd;
      for (let k = 0; k < 20; k += 1) {
        const m = (a + b) / 2;
        if (f(a) < 0 === f(m) < 0) a = m;
        else b = m;
      }
      if (prevH < 0 && riseJd === null) riseJd = (a + b) / 2;
      else if (prevH >= 0 && setJd === null) setJd = (a + b) / 2;
    }
    prevH = h;
    prevJd = jd;
  }
  const riseMin = riseJd === null ? null : toMinutes(riseJd);
  const setMin = setJd === null ? null : toMinutes(setJd);
  let transitMin = null;
  let maxAltitude = null;
  if (best[1] !== null) {
    transitMin = toMinutes(best[1]);
    const par = parallaxOf(moonPosition(best[1]).dist);
    maxAltitude = Math.round((best[0] + horizonThreshold(best[1]) + par) * 10) / 10;
  }
  const jdn = jd0 + 0.5; // кінець доби (місцева північ між датами): освітленість для самої ночі
  const elong = mod(moonPosition(jdn).lon - sunLongitude(jdn), 360);
  const illumination = roundHalfEven(((1 - Math.cos(R(elong))) / 2) * 100);
  const ageDays = Math.round(((elong / 360) * 29.530589) * 10) / 10;
  const phase = MOON_PHASE_NAMES[Math.floor(mod(elong + 22.5, 360) / 45)];
  return {
    tzHours: tz,
    rise: formatClock(riseMin),
    set: formatClock(setMin),
    transit: formatClock(transitMin === null ? null : Math.round(transitMin)),
    riseMin,
    setMin,
    transitMin,
    riseNextDay: riseMin !== null && riseMin >= 1440,
    setNextDay: setMin !== null && setMin >= 1440,
    upAtNoon,
    maxAltitude,
    illumination,
    ageDays,
    phase,
    waxing: elong < 180,
  };
}

/** Проміжки, коли Місяць над горизонтом у добі [полудень; наступне полудень], хвилини від півночі дати. */
export function moonUpIntervals(day) {
  const windowStart = 720;
  const windowEnd = 2160;
  const events = [];
  if (day.riseMin !== null) events.push({ type: 'rise', at: day.riseMin });
  if (day.setMin !== null) events.push({ type: 'set', at: day.setMin });
  events.sort((a, b) => a.at - b.at);
  const out = [];
  let from = day.upAtNoon ? windowStart : null;
  for (const event of events) {
    if (event.type === 'rise') {
      if (from === null) from = event.at;
    } else if (from !== null) {
      out.push([from, event.at]);
      from = null;
    }
  }
  if (from !== null) out.push([from, windowEnd]);
  return out;
}

function clockWithDay(minutes) {
  const text = formatClock(minutes);
  return minutes >= 1440 ? `${text} (+1)` : text;
}

/**
 * Довідковий індикатор «сприятлива ніч для ОНБ» (окуляри нічного бачення): освітленість диска
 * на ніч заданої дати ≥ порогу (за замовчуванням 50 %). Додатково — проміжок, коли Місяць над
 * горизонтом між настанням темряви (кінець цивільних сутінків) і світанком наступної доби.
 * Це підказка, а не допуск: на рішення про політ не впливає.
 * @returns {{favourable:boolean,illumination:number,threshold:number,darkFromMin:(number|null),darkToMin:(number|null),
 *   moonInDark:Array<{fromMin:number,toMin:number,from:string,to:string}>,moonInDarkText:(string|null)}}
 */
export function onbNight(date, lat, lon, { threshold = ONB_DEFAULT_THRESHOLD, tzHours } = {}) {
  const tz = tzHours === undefined || tzHours === null ? kyivOffsetForDate(date) : tzHours;
  const day = moonDay(date, lat, lon, tz);
  const sunToday = sunMinutes(date, lat, lon, tz);
  const sunNext = sunMinutes(addDays(date, 1), lat, lon, tz);
  const darkFromMin = sunToday.dusk;
  const darkToMin = sunNext.dawn === null ? null : sunNext.dawn + 1440;
  const moonInDark = [];
  if (darkFromMin !== null && darkToMin !== null) {
    for (const [from, to] of moonUpIntervals(day)) {
      const a = Math.max(from, darkFromMin);
      const b = Math.min(to, darkToMin);
      if (b > a) moonInDark.push({ fromMin: a, toMin: b, from: clockWithDay(a), to: clockWithDay(b) });
    }
  }
  const moonInDarkText = moonInDark.length
    ? moonInDark.map(item => `${item.from}–${item.to}`).join(', ')
    : null;
  return {
    favourable: day.illumination >= threshold,
    illumination: day.illumination,
    threshold,
    darkFromMin,
    darkToMin,
    moonInDark,
    moonInDarkText,
  };
}

/**
 * Сонце й Місяць для кількох точок маршруту (екран «Сонце і Місяць», блок «Пункти» бортжурналу).
 * @param {object|string} date доба
 * @param {Array<{name:string,lat:number,lon:number}>} points точки з координатами
 * @param {{tzHours?:number}} [options]
 * @returns {Array<{name,lat,lon,sunrise,sunset,dawn,dusk,moonRise,moonSet,moonSetNextDay,illumination,phase,waxing}>}
 */
export function skyForPoints(date, points, { tzHours } = {}) {
  const tz = tzHours === undefined || tzHours === null ? kyivOffsetForDate(date) : tzHours;
  return (points || []).map(point => {
    const sun = sunMinutes(date, point.lat, point.lon, tz);
    const moon = moonDay(date, point.lat, point.lon, tz);
    const out = { name: point.name, lat: point.lat, lon: point.lon };
    for (const key of SUN_EVENT_KEYS) out[key] = formatClock(sun[key]);
    out.moonRise = moon.rise;
    out.moonSet = moon.set;
    out.moonSetNextDay = moon.setNextDay;
    out.illumination = moon.illumination;
    out.phase = moon.phase;
    out.waxing = moon.waxing;
    return out;
  });
}
