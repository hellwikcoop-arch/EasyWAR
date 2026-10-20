// EasyFLY: ядро штурманського модуля. Інженерно-штурманський розрахунок польоту (ІШР, Додаток 4),
// бортовий журнал штурмана (Додаток 1), штурманський план польоту (ШПП), вітровий трикутник, паливо.
// Чиста логіка без DOM, мережі, Date.now і Math.random: перевіряється в node --test.
// Порт прототипів ishr_core.py і bj_core.py — числа збігаються з ними. Друк — у nav-docs.js.
//
// Один опис польоту (`flight`) годує всі три документи:
//   {
//     date: '2026-10-20' | '20.10.2026',
//     typeId: 'mi8mtv1',            // тип ПС зі списку AIRCRAFT_TYPES (норми Q за наказом ПС ЗСУ № 38)
//     typeLabel?: 'Мі-8МТВ-1',      // підпис у шапці (за замовчуванням — з типу)
//     qAir?, qGround?, mtow?,       // перевизначення норм типу
//     board: '123',                 // бортовий номер вписується вручну
//     callsign?, exercise?,
//     empty, crew, fuelKg,          // вага порожнього, екіпажу, палива (кг) — вручну
//     groundMin?: 10, reserveMin?: 30,
//     equipment?: { trusses, blocksB8V20, b8v20Shells, blocksB8V8, s8, s8ko, s8dm, s8bm, s13, s13of, s13t,
//                   beamHolders, armor }, cargoOther?,
//     surcharges?: ['evu', 'posNvRv', 'posDvPzu', 'trusses', 'trussesBlock'],
//     departure: 'аер. Зоря' | { name, lat?, lon? },
//     legs: [{ to?, name?, kind?: 'ppm'|'ko'|'kpm', mshk, h, v, s, landing?, tTarget?, lat?, lon? }],
//     wind?: { from, speedMs },     // розрахунковий вітер (звідки дме, магн. градуси; м/с)
//     windActual?: { from, speedMs },   // виправлений (фактичний) вітер для Wи у ШПП
//     takeoff?: '09:00', toIpmMin?: 3, landingMin?: 4,
//     qfe?, qnh?, t0?, hMin?, returnLine?,
//     commander?, navigator?, checker?, iasChief?: { rank, name | firstName+surname }, seniorNav?,
//     captain?: 'ПЕТРЕНКО І.П.' | { surname, initials }, captainRankGen?: 'капітана',
//     sun?: [{ name, rise, set }]
//   }

import { kyivOffsetForDate, mod, roundHalfEven, sunTimes } from './sun-core.js';

export { roundHalfEven };

// ---------- Довідники ----------

/** Щільність палива, кг/л: л = кг / 0,8. */
export const FUEL_DENSITY = 0.8;

/** Захід на аеродром при посадці на майданчик: км і хв по колу до посадки та після зльоту. */
export const LANDING_CIRCUIT_KM = 5;
export const LANDING_CIRCUIT_MIN = 5;

/** Джерело норм витрати палива. */
export const FUEL_NORMS_SOURCE = 'наказ Командувача ПС ЗСУ № 38 від 23.02.2021';

const MI8_MASS = { mtow: 13000, normalMass: 11100 };
const MI8_FUEL = Object.freeze({
  main: Object.freeze({ kg: 2092, l: 2615 }),
  dpb1: Object.freeze({ kg: 2824, l: 3530 }),
  dpb2: Object.freeze({ kg: 2870, l: 3700 }),
});

const aircraft = fields => Object.freeze({ ...fields });

/**
 * Типи ПС і норми годинної витрати Q (кг/год, у повітрі / на землі) за наказом № 38.
 * Маса: максимальна злітна 13 000 кгс і нормальна 11 100 кгс (РЛЕ Мі-8МТВ-5-1); для Мі-2
 * масу в плані не задано (null — перевірку маси пропускаємо).
 */
export const AIRCRAFT_TYPES = Object.freeze([
  aircraft({ id: 'mi8mtv1', label: 'Мі-8МТВ-1', family: 'mi8mt', qAir: 610, qGround: 370, ...MI8_MASS, fuel: MI8_FUEL }),
  aircraft({ id: 'mi8mtv5', label: 'Мі-8МТВ-5-1', family: 'mi8mt', qAir: 610, qGround: 370, ...MI8_MASS, fuel: MI8_FUEL }),
  aircraft({ id: 'mi8mt', label: 'Мі-8МТ', family: 'mi8mt', qAir: 610, qGround: 370, ...MI8_MASS, fuel: MI8_FUEL }),
  aircraft({
    id: 'mi8msbv',
    label: 'Мі-8 МСБ-В',
    family: 'mi8msb',
    qAir: 610,
    qGround: 390,
    ...MI8_MASS,
    fuel: Object.freeze({ main: Object.freeze({ kg: 2016, l: 2520 }), dpb1: Object.freeze({ kg: 2748, l: 3435 }) }),
  }),
  aircraft({ id: 'mi8mtpb', label: 'Мі-8 МТПБ, МТПИ', family: 'mi8mtpb', qAir: 770, qGround: 360, ...MI8_MASS, fuel: null }),
  aircraft({
    id: 'mi8mtpb-smv',
    label: 'Мі-8 МТПБ (СМВ, ВЗПУ, НВ), Мі-9',
    family: 'mi8mtpb',
    qAir: 770,
    qGround: 360,
    ...MI8_MASS,
    fuel: null,
  }),
  aircraft({
    id: 'mi2msb',
    label: 'Мі-2 МСБ',
    family: 'mi2',
    qAir: 285,
    qGround: 150,
    mtow: null,
    normalMass: null,
    fuel: Object.freeze({
      main: Object.freeze({ kg: 480, l: 600 }),
      dpb1: Object.freeze({ kg: 680, l: 850 }),
      dpb2: Object.freeze({ kg: 920, l: 1150 }),
    }),
  }),
]);

/** Мі-8 МТ/МТВ-1: варіант заправки з фермами і бронею (кг / л). */
export const FUEL_VARIANTS_WITH_TRUSSES_ARMOR = Object.freeze({
  main: Object.freeze({ kg: 1450, l: 1870 }),
  dpb1: Object.freeze({ kg: 2160, l: 2785 }),
  dpb2: Object.freeze({ kg: 2870, l: 3700 }),
});

export function aircraftType(id) {
  return AIRCRAFT_TYPES.find(item => item.id === id) || null;
}

/** Нарахування до Q (частки): кожен пункт форми додає свій відсоток до витрати в повітрі. */
export const SURCHARGES = Object.freeze({
  evu: Object.freeze({ id: 'evu', label: 'ЄВУ', rate: 0.06 }),
  posNvRv: Object.freeze({ id: 'posNvRv', label: 'ПОС НВ і РВ', rate: 0.02 }),
  posDvPzu: Object.freeze({ id: 'posDvPzu', label: 'ПОС двигунів і ПЗУ', rate: 0.03 }),
  trusses: Object.freeze({ id: 'trusses', label: 'ферми', rate: 0.05 }),
  // «ферми і блок»: Мі-8 МТ/МТВ +7 %, Мі-8 МСБ-В +10 %; для інших типів норма в плані не задана — беремо +7 %.
  trussesBlock: Object.freeze({ id: 'trussesBlock', label: 'ферми і блок', rate: 0.07, rateByFamily: { mi8msb: 0.1 } }),
});

const SURCHARGE_ALIASES = Object.freeze({
  'ЄВУ': 'evu',
  'ПОС НВ і РВ': 'posNvRv',
  'ПОС двигунів і ПЗУ': 'posDvPzu',
  'ферми': 'trusses',
  'ферми і блок': 'trussesBlock',
});

/** Ставка нарахування за ідентифікатором (або українською назвою) для родини типу. */
export function surchargeRate(id, family = null) {
  const key = SURCHARGES[id] ? id : SURCHARGE_ALIASES[id];
  const item = key ? SURCHARGES[key] : null;
  if (!item) throw new RangeError(`Невідоме нарахування до витрати палива: ${id}`);
  return (item.rateByFamily && item.rateByFamily[family]) ?? item.rate;
}

/**
 * Нарахування за станом форми: ЄВУ, ПОС, ферми (+ блоки → «ферми і блок»).
 * @param {{evu?:boolean,posNvRv?:boolean,posDvPzu?:boolean}} toggles перемикачі
 * @param {{trusses?:number,blocksB8V20?:number,blocksB8V8?:number}} equipment обладнання
 * @returns {string[]} ідентифікатори для `flight.surcharges`
 */
export function surchargesFor(toggles = {}, equipment = {}) {
  const ids = [];
  if (toggles.evu) ids.push('evu');
  if (toggles.posNvRv) ids.push('posNvRv');
  if (toggles.posDvPzu) ids.push('posDvPzu');
  const trusses = Number(equipment.trusses) > 0;
  const blocks = Number(equipment.blocksB8V20) > 0 || Number(equipment.blocksB8V8) > 0;
  if (trusses && blocks) ids.push('trussesBlock');
  else if (trusses) ids.push('trusses');
  return ids;
}

/** Ваги спорядження, кг (за одиницю). Б8В20: 100 кг + 1 кг на снаряд (`b8v20Shells`). */
export const EQUIPMENT_WEIGHTS = Object.freeze({
  trusses: 100,
  blocksB8V20: 100,
  b8v20Shells: 1,
  blocksB8V8: 56,
  s8: 11.55,
  s8ko: 11.3,
  s8dm: 11.6,
  s8bm: 15.2,
  s13: 57,
  s13of: 69,
  s13t: 75,
  beamHolders: 35,
  armor: 235,
});

/** Вага вантажу й спорядження, кг (без округлення). `armor` — логічне, решта — кількості. */
export function equipmentWeight(equipment = {}, cargoOther = 0) {
  let total = Number(cargoOther) || 0;
  for (const [key, unit] of Object.entries(EQUIPMENT_WEIGHTS)) {
    const value = equipment[key];
    if (key === 'armor') total += value ? unit : 0;
    else total += (Number(value) || 0) * unit;
  }
  return total;
}

// ---------- Форматування ----------

const pad2 = n => String(n).padStart(2, '0');

/** Паливо, кг за витратою Q (кг/год) за t хвилин: Q × t / 60. */
export function fuelBurnKg(q, minutes) {
  return roundHalfEven((q * minutes) / 60);
}

/** Літри з кілограмів: кг / 0,8. */
export function kgToLiters(kg) {
  return roundHalfEven(kg / FUEL_DENSITY);
}

/** «Г:ХВ» для хвилин (0:14, 1:08). */
export function formatHm(minutes) {
  const m = roundHalfEven(minutes);
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

/** «ХВ:СК» або «Г:ХВ:СК» (від 1 год) для хвилин із дробовою частиною. */
export function formatMmss(minutes) {
  const s = roundHalfEven(minutes * 60);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** «ГГ:ХВ» → хвилини від півночі; null, якщо формат хибний. */
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h > 23 || m > 59 ? null : h * 60 + m;
}

/** Час доби після додавання хвилин (по колу доби); порожній рядок, якщо базу не задано. */
export function addMinutesToClock(base, minutes) {
  const start = parseClock(base);
  if (start === null) return '';
  const total = mod(start + roundHalfEven(minutes), 1440);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

const norm0 = value => (value === 0 ? 0 : value);

// ---------- Вітровий трикутник ----------

const radians = degrees => (degrees * Math.PI) / 180;
const degreesOf = rad => (rad * 180) / Math.PI;

/** Знак кута у діапазоні (−180; 180]: різниця b − a. */
export function signedAngle(a, b) {
  const d = mod(b - a + 180, 360) - 180;
  return d === -180 ? 180 : norm0(d);
}

/**
 * Навігаційний трикутник швидкостей на ділянці.
 * @param {number} mshk магнітний шляховий кут (МШК = МК без вітру), градуси
 * @param {number} v швидкість за приладом (істинна), км/год
 * @param {number} windFrom звідки дме вітер (магнітний), градуси
 * @param {number} uKmh швидкість вітру, км/год
 * @returns {{kz:number,mk:number,w:number,ok:boolean}} кут зносу КЗ, МК випр., шляхова W (цілі, як у прототипі).
 *   ok=false (з NaN у kz/mk/w), якщо вітер сильніший за швидкість ПС і витримати шлях неможливо.
 */
export function windTriangle(mshk, v, windFrom, uKmh) {
  const windTo = mod(windFrom + 180, 360);
  const kvb = radians(windTo - mshk);
  const ratio = (uKmh * Math.sin(kvb)) / v;
  if (!Number.isFinite(ratio) || Math.abs(ratio) > 1) return { kz: NaN, mk: NaN, w: NaN, ok: false };
  const kz = degreesOf(Math.asin(ratio));
  const w = v * Math.cos(radians(kz)) + uKmh * Math.cos(kvb);
  const mk = mod(mshk - kz, 360);
  return { kz: norm0(roundHalfEven(kz)), mk: norm0(roundHalfEven(mk)), w: norm0(roundHalfEven(w)), ok: true };
}

/**
 * Складова вітру вздовж шляху U, км/год: попутний «+», зустрічний «−» (для W = V + U у ШПП).
 * @param {number} track шляховий кут, градуси
 * @param {number} windFrom звідки дме вітер
 * @param {number} uKmh швидкість вітру, км/год
 */
export function windAlongTrack(track, windFrom, uKmh) {
  const windTo = mod(windFrom + 180, 360);
  return norm0(uKmh * Math.cos(radians(windTo - track)));
}

/** Бічна складова вітру, км/год (праворуч від шляху «+»). */
export function windCrossTrack(track, windFrom, uKmh) {
  const windTo = mod(windFrom + 180, 360);
  return norm0(uKmh * Math.sin(radians(windTo - track)));
}

/** Кут повороту з курсу `a` на `b`: (−180; 180], додатний — вправо. */
export function turnAngle(a, b) {
  return signedAngle(a, b);
}

/** Вітер польоту → швидкість у км/год; null, якщо вітру немає. */
function windOf(wind) {
  if (!wind || !Number.isFinite(Number(wind.speedMs))) return null;
  return { from: Number(wind.from) || 0, uKmh: Number(wind.speedMs) * 3.6 };
}

// ---------- Опис маршруту ----------

/** Назва пункту вильоту. */
export function departureName(flight) {
  const d = flight?.departure;
  if (typeof d === 'string') return d;
  return d && typeof d.name === 'string' ? d.name : '';
}

const PREFIXES = [
  { re: /^\s*ППМ\s*\d*\s*/i, kind: 'ppm' },
  { re: /^\s*КПМ\s*/i, kind: 'kpm' },
  { re: /^\s*КО(?=\s|$)\s*/i, kind: 'ko' },
  { re: /^\s*[ВІ]ПМ\s*/i, kind: 'vpm' },
];

function detectKind(text) {
  const source = String(text ?? '');
  const hit = PREFIXES.find(item => item.re.test(source));
  return hit ? hit.kind : null;
}

function stripPrefix(text) {
  let source = String(text ?? '');
  for (const item of PREFIXES) source = source.replace(item.re, '');
  return source.trim();
}

/** Позначення пунктів: ВПМ (вихідний), ППМ n (поворотні), КО (контрольний орієнтир), КПМ (кінцевий). */
export const POINT_CODES = Object.freeze({ vpm: 'ВПМ', ko: 'КО', kpm: 'КПМ' });

/**
 * Нормалізує ділянки маршруту: позначення, підписи, посадка на майданчик (+5 км / +5 хв по колу
 * до посадки і так само після зльоту).
 * @returns {Array<{index,kind,code,name,label,mshk,h,v,s,extraKm,extraMin,sEff,landing,afterLanding,tTarget,lat,lon}>}
 */
export function normalizeLegs(flight) {
  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  let ppmNumber = 0;
  return legs.map((leg, index) => {
    const last = index === legs.length - 1;
    const kind = leg.kind || detectKind(leg.to) || (last ? 'kpm' : 'ppm');
    let code;
    if (kind === 'ppm') {
      ppmNumber += 1;
      code = `ППМ ${ppmNumber}`;
    } else {
      code = POINT_CODES[kind] || 'ППМ';
    }
    const name = typeof leg.name === 'string' ? leg.name.trim() : stripPrefix(leg.to);
    const label = typeof leg.to === 'string' && leg.to.trim() ? leg.to.trim() : `${code} ${name}`.trim();
    const landing = leg.landing === true;
    const afterLanding = index > 0 && legs[index - 1].landing === true;
    const extraKm = (landing ? LANDING_CIRCUIT_KM : 0) + (afterLanding ? LANDING_CIRCUIT_KM : 0);
    const extraMin = (landing ? LANDING_CIRCUIT_MIN : 0) + (afterLanding ? LANDING_CIRCUIT_MIN : 0);
    const s = Number(leg.s);
    return {
      index,
      kind,
      code,
      name,
      label,
      mshk: Number(leg.mshk),
      h: Number(leg.h) || 0,
      v: Number(leg.v),
      s,
      extraKm,
      extraMin,
      sEff: s + extraKm,
      landing,
      afterLanding,
      tTarget: leg.tTarget === undefined || leg.tTarget === null ? null : Number(leg.tTarget),
      lat: Number.isFinite(Number(leg.lat)) && leg.lat !== null && leg.lat !== '' ? Number(leg.lat) : null,
      lon: Number.isFinite(Number(leg.lon)) && leg.lon !== null && leg.lon !== '' ? Number(leg.lon) : null,
    };
  });
}

/** Підпис пункту в ІШР/БЖ: «… (посадка)» для посадки на майданчик. */
function columnLabel(leg) {
  return leg.landing ? `${leg.label} (посадка)` : leg.label;
}

/** Рядок маршруту: «аер. Зоря – ППМ1 Дубки – …». */
export function routeText(flight, separator = ' – ') {
  const dep = departureName(flight);
  const parts = normalizeLegs(flight).map(columnLabel);
  return [dep, ...parts].filter(Boolean).join(separator);
}

/** Перевірка опису польоту: список повідомлень українською (порожній — усе гаразд). */
export function validateFlight(flight) {
  const issues = [];
  const f = flight || {};
  const type = aircraftType(f.typeId);
  if (!type && !(Number.isFinite(f.qAir) && Number.isFinite(f.qGround))) issues.push('Не вибрано тип ПС (немає норм витрати палива).');
  if (!Number.isFinite(Number(f.empty)) || Number(f.empty) <= 0) issues.push('Не вказано вагу порожнього ПС.');
  if (!Number.isFinite(Number(f.fuelKg)) || Number(f.fuelKg) <= 0) issues.push('Не вказано вагу палива.');
  const legs = normalizeLegs(f);
  if (!legs.length) issues.push('У маршруті немає жодної ділянки.');
  legs.forEach((leg, i) => {
    const where = `Ділянка ${i + 1} (${leg.label || 'без назви'})`;
    if (!Number.isFinite(leg.v) || leg.v <= 0) issues.push(`${where}: швидкість за приладом має бути більшою за 0.`);
    if (!Number.isFinite(leg.s) || leg.s < 0) issues.push(`${where}: відстань має бути невід'ємною.`);
    if (!Number.isFinite(leg.mshk)) issues.push(`${where}: не вказано шляховий кут.`);
  });
  if (f.wind && !(Number(f.wind.speedMs) >= 0)) issues.push('Швидкість вітру має бути невід\'ємною.');
  return issues;
}

// ---------- ІШР (Додаток 4) ----------

/** Час ділянки в ІШР, хв: round(S / V × 60) + кола посадки. */
function legMinutes(leg) {
  return roundHalfEven((leg.s / leg.v) * 60) + leg.extraMin;
}

/**
 * Інженерно-штурманський розрахунок польоту.
 * @param {object} flight опис польоту (див. шапку файлу)
 * @returns {{
 *   q:number,qGround:number,k:number,cargo:number,fuelKg:number,fuelL:number,empty:number,crew:number,total:number,
 *   mtow:(number|null),normalMass:(number|null),massOk:boolean,fuelOk:boolean,ok:boolean,reserveKg:number,
 *   typeLabel:string,route:string,hasLanding:boolean,
 *   cols:Array<{kind:string,name:string,s:(number|null),t:(number|null),v:(number|null),q:number,legKg:number,
 *     S:number,T:number,used:number,rem:number,w:number,landing:boolean}>
 * }} Колонки: «Зліт», ділянки по ППМ, «НЗ» (аеронавігаційний запас).
 */
export function calcIshr(flight) {
  const f = flight || {};
  const type = aircraftType(f.typeId);
  const qAir = Number.isFinite(f.qAir) ? f.qAir : type?.qAir;
  const qGround = Number.isFinite(f.qGround) ? f.qGround : type?.qGround;
  if (!Number.isFinite(qAir) || !Number.isFinite(qGround)) {
    throw new RangeError('Невідомий тип ПС: немає норм витрати палива (typeId або qAir/qGround).');
  }
  const family = type?.family ?? null;
  const k = 1 + (f.surcharges || []).reduce((sum, id) => sum + surchargeRate(id, family), 0);
  const q = roundHalfEven(qAir * k);
  const cargo = equipmentWeight(f.equipment, f.cargoOther);
  const fuelKg = Number(f.fuelKg);
  const empty = Number(f.empty);
  const crew = Number(f.crew) || 0;
  const total = empty + crew + fuelKg + cargo;
  const mtow = Number.isFinite(f.mtow) ? f.mtow : type?.mtow ?? null;
  const groundMin = Number.isFinite(f.groundMin) ? f.groundMin : 10;
  const reserveMin = Number.isFinite(f.reserveMin) ? f.reserveMin : 30;

  const cols = [];
  const takeoffKg = fuelBurnKg(qGround, groundMin);
  let S = 0;
  let T = 0;
  let used = takeoffKg;
  let rem = fuelKg - takeoffKg;
  let w = roundHalfEven(total - takeoffKg);
  cols.push({
    kind: 'takeoff', name: 'Зліт', s: null, t: null, v: null, q: qGround, legKg: takeoffKg,
    S: 0, T: 0, used, rem, w, landing: false,
  });
  for (const leg of normalizeLegs(f)) {
    const t = legMinutes(leg);
    const kg = fuelBurnKg(q, t);
    S += leg.sEff;
    T += t;
    used += kg;
    rem -= kg;
    w -= kg;
    cols.push({
      kind: 'leg', name: columnLabel(leg), s: leg.sEff, t, v: leg.v, q, legKg: kg,
      S, T, used, rem, w: roundHalfEven(w), landing: leg.landing,
    });
  }
  const nzKg = fuelBurnKg(q, reserveMin);
  cols.push({
    kind: 'reserve', name: 'НЗ', s: null, t: reserveMin, v: null, q, legKg: nzKg,
    S, T: T + reserveMin, used: used + nzKg, rem: rem - nzKg, w: roundHalfEven(w - nzKg), landing: false,
  });
  const fuelOk = rem - nzKg >= 0;
  const massOk = mtow === null || total <= mtow;
  return {
    q,
    qGround,
    k,
    cargo: roundHalfEven(cargo),
    fuelKg,
    fuelL: kgToLiters(fuelKg),
    empty,
    crew,
    total: roundHalfEven(total),
    mtow,
    normalMass: type?.normalMass ?? null,
    massOk,
    fuelOk,
    ok: fuelOk && massOk,
    reserveKg: rem - nzKg,
    typeLabel: typeof f.typeLabel === 'string' && f.typeLabel ? f.typeLabel : type?.label ?? '',
    route: routeText(f),
    hasLanding: cols.some(col => col.landing),
    cols,
  };
}

// ---------- Бортовий журнал штурмана (Додаток 1) ----------

/** Рядки «Пункти: схід/захід» бортжурналу: з `flight.sun` або за координатами пунктів. */
export function sunRowsForFlight(flight) {
  const given = flight?.sun;
  if (Array.isArray(given) && given.length) {
    return given.map(item =>
      Array.isArray(item)
        ? { name: item[0], rise: item[1], set: item[2] }
        : { name: item.name, rise: item.rise, set: item.set },
    );
  }
  const date = flight?.date;
  if (!date) return [];
  const points = routePointsWithCoords(flight);
  const out = [];
  for (const point of points) {
    let times;
    try {
      times = sunTimes(date, point.lat, point.lon, kyivOffsetForDate(date));
    } catch {
      return [];
    }
    out.push({ name: point.name, rise: times.sunrise ?? '–', set: times.sunset ?? '–' });
  }
  return out;
}

/** Пункти маршруту з координатами (виліт + ділянки), без дублікатів за назвою. */
export function routePointsWithCoords(flight) {
  const out = [];
  const seen = new Set();
  const add = (name, lat, lon) => {
    if (!name || lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon) || seen.has(name)) return;
    seen.add(name);
    out.push({ name, lat, lon });
  };
  const dep = flight?.departure;
  if (dep && typeof dep === 'object') {
    add(dep.name, Number.isFinite(Number(dep.lat)) ? Number(dep.lat) : null, Number.isFinite(Number(dep.lon)) ? Number(dep.lon) : null);
  }
  for (const leg of normalizeLegs(flight)) add(leg.name || leg.label, leg.lat, leg.lon);
  return out;
}

/**
 * Розрахунок бортжурналу: МК (без вітру) → кут зносу КЗ, МК випр., W, T з урахуванням вітру;
 * залишки палива беруться з ІШР по рубежах.
 * @returns {{rows:Array,totals:object,header:object,ishr:object,issues:string[]}}
 *   rows[i]: { label, mshk, h, v, s, extraKm, tCalcMin, kz, mk, w, tWindMin, T, rem, clockPlan, ok }.
 */
export function calcBortjournal(flight) {
  const f = flight || {};
  const ishr = calcIshr(f);
  const legs = normalizeLegs(f);
  const wind = windOf(f.wind);
  const toIpmMin = Number.isFinite(f.toIpmMin) ? f.toIpmMin : 3;
  const landingMin = Number.isFinite(f.landingMin) ? f.landingMin : 4;
  const issues = [];
  let T = 0;
  let windBroken = false;
  const rows = legs.map((leg, i) => {
    const tri = wind ? windTriangle(leg.mshk, leg.v, wind.from, wind.uKmh) : windTriangle(leg.mshk, leg.v, 0, 0);
    const tCalcMin = (leg.s / leg.v) * 60 + leg.extraMin;
    let tWindMin = null;
    if (tri.ok && !windBroken && tri.w > 0) {
      tWindMin = (leg.s / tri.w) * 60 + leg.extraMin;
      T += tWindMin;
    } else {
      windBroken = true;
      issues.push(`Ділянка ${i + 1} (${leg.label}): вітер не дозволяє витримати шлях.`);
    }
    return {
      label: columnLabel(leg),
      code: leg.code,
      mshk: leg.mshk,
      h: leg.h,
      v: leg.v,
      s: leg.sEff,
      extraKm: leg.extraKm,
      tCalcMin,
      kz: tri.kz,
      mk: tri.mk,
      w: tri.w,
      tWindMin,
      T: windBroken ? null : T,
      rem: ishr.cols[i + 1].rem,
      clockPlan: windBroken ? '' : addMinutesToClock(f.takeoff, toIpmMin + T),
      ok: tri.ok && !windBroken,
      landing: leg.landing,
    };
  });
  const S = rows.reduce((sum, row) => sum + row.s, 0);
  const Tc = rows.reduce((sum, row) => sum + row.tCalcMin, 0);
  const Tw = windBroken ? null : T;
  const flightMin = Tw === null ? null : Tw + toIpmMin + landingMin;
  const totals = {
    S,
    tCalcMin: Tc,
    tWindMin: Tw,
    rem: ishr.cols[ishr.cols.length - 1].rem,
    flightMin,
    landingClock: Tw === null ? '' : addMinutesToClock(f.takeoff, toIpmMin + Tw + landingMin),
    ipmClock: addMinutesToClock(f.takeoff, toIpmMin),
  };
  const header = {
    date: dateText(f.date),
    typeLabel: ishr.typeLabel,
    board: f.board ?? '',
    callsign: f.callsign ?? '',
    exercise: f.exercise ?? '',
    commander: f.commander ?? '',
    navigator: f.navigator ?? '',
    checker: f.checker ?? '',
    route: routeText(f),
    hMin: f.hMin ?? null,
    returnLine: f.returnLine ?? '',
    reserveKg: ishr.reserveKg,
    takeoff: f.takeoff ?? '',
    qfe: f.qfe ?? null,
    qnh: f.qnh ?? null,
    t0: f.t0 ?? null,
    wind: wind ? { from: wind.from, speedMs: Number(f.wind.speedMs) } : null,
  };
  return { rows, totals, header, ishr, sun: sunRowsForFlight(f), issues };
}

function dateText(date) {
  if (!date) return '';
  const text = String(date).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : text;
}

// ---------- ШПП (штурманський план польоту) ----------

const ARROW_UP = '↑';
const ARROW_DOWN = '↓';

function arrowFor(current, previous, tolerance = 0) {
  if (previous === null || previous === undefined) return '';
  const diff = current - previous;
  if (diff > tolerance) return ARROW_UP;
  if (diff < -tolerance) return ARROW_DOWN;
  return '';
}

/** «ПРІЗВИЩЕ І.П.» для шапки ШПП. */
export function captainText(captain) {
  if (typeof captain === 'string') return captain.trim();
  if (captain && typeof captain === 'object') {
    return `${String(captain.surname ?? '').toUpperCase()} ${captain.initials ?? ''}`.trim();
  }
  return '';
}

/**
 * Штурманський план польоту: ділянки зі шляховими швидкостями Wр / Wи, кути повороту, поправки
 * на вітер, стрілки зміни швидкості й висоти відносно попередньої ділянки.
 *
 * W = V + U: V — швидкість за приладом, U — складова вітру вздовж шляху (попутний «+», зустрічний «−»).
 * Wр — за розрахунковим вітром (`flight.wind`), Wи — за виправленим (`flight.windActual`; без нього = Wр).
 * Потрібна W = S / t_заданий (t_заданий — з ІШР або `leg.tTarget`); V потр. = W потр. − U.
 * @returns {{title:string,routeText:string,captainLine:string,captain:string,legs:Array,totals:object,hasLanding:boolean}}
 */
export function calcShpp(flight) {
  const f = flight || {};
  const legs = normalizeLegs(f);
  const windR = windOf(f.wind);
  const windI = windOf(f.windActual) || windR;
  const depName = departureName(f);
  const rows = [];
  let cumS = 0;
  let cumT = 0;
  let prevHold = null;
  let prevH = 0;
  legs.forEach((leg, i) => {
    const uR = windR ? windAlongTrack(leg.mshk, windR.from, windR.uKmh) : 0;
    const uI = windI ? windAlongTrack(leg.mshk, windI.from, windI.uKmh) : 0;
    const wR = leg.v + uR;
    const wI = leg.v + uI;
    const tPlan = legMinutes(leg); // той самий час, що в ІШР
    const tTarget = leg.tTarget ?? tPlan;
    const wNeed = tTarget > 0 ? leg.sEff / (tTarget / 60) : NaN;
    const vNeedR = wNeed - uR;
    const vNeedI = wNeed - uI;
    const hold = roundHalfEven(vNeedI);
    const corr = wind => {
      if (!wind) return 0;
      const tri = windTriangle(leg.mshk, leg.v, wind.from, wind.uKmh);
      return tri.ok ? signedAngle(leg.mshk, tri.mk) : NaN;
    };
    cumS += leg.sEff;
    cumT += tTarget;
    const prev = i > 0 ? legs[i - 1] : null;
    const turnBefore = prev ? turnAngle(prev.mshk, leg.mshk) : null;
    const note = [];
    if (leg.landing) note.push(`посадка (коло ${LANDING_CIRCUIT_KM} км / ${LANDING_CIRCUIT_MIN} хв)`);
    if (leg.afterLanding) note.push(`після зльоту ${LANDING_CIRCUIT_KM} км / ${LANDING_CIRCUIT_MIN} хв`);
    if (!leg.landing && i === legs.length - 1) note.push('посадка');
    rows.push({
      index: i,
      from: i === 0 ? { code: 'ВПМ', name: depName } : { code: legs[i - 1].code, name: legs[i - 1].name },
      to: { code: leg.code, name: leg.name, kind: leg.kind },
      label: leg.label,
      mk: leg.mshk,
      s: leg.sEff,
      t: tTarget,
      h: leg.h,
      v: leg.v,
      uR: norm0(Math.round(uR * 10) / 10),
      uI: norm0(Math.round(uI * 10) / 10),
      wR: roundHalfEven(wR),
      wI: roundHalfEven(wI),
      wNeed: roundHalfEven(wNeed),
      vNeedR: roundHalfEven(vNeedR),
      vNeedI: hold,
      windCorrR: corr(windR),
      windCorrI: corr(windI),
      turnBefore,
      speedArrow: i === 0 ? '' : arrowFor(hold, prevHold, 0),
      heightArrow: arrowFor(leg.h, prevH, 0),
      landingArrow: leg.landing || i === legs.length - 1 ? ARROW_DOWN : '',
      landing: leg.landing,
      afterLanding: leg.afterLanding,
      S: cumS,
      T: cumT,
      note: note.join('; '),
    });
    prevHold = hold;
    prevH = leg.h;
  });
  for (const row of rows) {
    row.sRemaining = cumS - row.S;
    row.tRemaining = cumT - row.T;
  }
  const names = [depName, ...legs.map(leg => leg.name || leg.label)].filter(Boolean);
  const rank = typeof f.captainRankGen === 'string' && f.captainRankGen ? f.captainRankGen : 'капітана';
  return {
    title: 'ШТУРМАНСЬКИЙ ПЛАН ПОЛЬОТУ',
    routeText: names.join('-'),
    captainLine: `${rank} ${captainText(f.captain)}`.trim(),
    captain: captainText(f.captain),
    legs: rows,
    totals: { S: cumS, T: cumT },
    hasLanding: legs.some(leg => leg.landing),
  };
}

// ---------- Схема маршруту (геометрія для SVG) ----------

/**
 * Геометрія схеми маршруту ШПП: масштаб за відстанню; схема повернута (кроком `rotationStep`)
 * так, щоб маршрут якнайкраще вписався в поле `width × height` (віддається перевага меншому повороту).
 * Напрям МК відкладається від півночі за годинниковою стрілкою; `rotation` — на скільки схему
 * повернуто за годинниковою стрілкою відносно півночі вгору (стрілка «Пн» повернута на цей кут).
 * @param {{legs:Array}} shpp результат calcShpp
 * @param {{width?:number,height?:number,marginX?:number,marginY?:number,rotationStep?:number,reserve?:Array<{x0:number,y0:number,x1:number,y1:number}>}} [options]
 * `reserve` — зарезервовані прямокутники (стрілка «Пн», масштабна лінія), які підписи не займають.
 * Підписи (рамки висот, підписи пунктів, ділянок і кутів) розкладаються без накладань у `labels`.
 * @returns {{width,height,rotation:number,scale:number,north:{x:number,y:number},labels:object,
 *   points:Array<{index:number,x:number,y:number,code:string,name:string,kind:string,landing:boolean}>,
 *   segments:Array<{index:number,x1:number,y1:number,x2:number,y2:number,mx:number,my:number,angle:number,
 *     ux:number,uy:number,nx:number,ny:number}>,turns:Array<{pointIndex:number,angle:number}>}}
 */
export function planScheme(shpp, options = {}) {
  const width = options.width ?? 1000;
  const height = options.height ?? 400;
  const marginX = options.marginX ?? 90;
  const marginY = options.marginY ?? 70;
  const step = options.rotationStep ?? 5;
  const legs = shpp?.legs || [];
  const firstName = legs[0]?.from?.name ?? '';
  const meta = [{ code: 'ВПМ', name: firstName, kind: 'vpm', landing: false }];
  legs.forEach(leg => meta.push({ code: leg.to.code, name: leg.to.name, kind: leg.to.kind, landing: leg.landing }));

  const place = rotation => {
    const pts = [{ x: 0, y: 0 }];
    let x = 0;
    let y = 0;
    for (const leg of legs) {
      const b = radians(leg.mk + rotation);
      x += Math.sin(b) * (leg.s - extraKmOf(leg));
      y -= Math.cos(b) * (leg.s - extraKmOf(leg));
      pts.push({ x, y });
    }
    return pts;
  };
  const fit = pts => {
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const availX = width - 2 * marginX;
    const availY = height - 2 * marginY;
    const sx = bw > 1e-9 ? availX / bw : Infinity;
    const sy = bh > 1e-9 ? availY / bh : Infinity;
    const scale = Math.min(sx, sy);
    return { scale: Number.isFinite(scale) ? scale : 1, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };

  const candidates = [0];
  for (let a = step; a < 180; a += step) candidates.push(a, 360 - a);
  if (360 % step === 0) candidates.push(180);
  let best = null;
  for (const rotation of candidates) {
    const fitted = fit(place(rotation));
    if (!best || fitted.scale > best.fit.scale * 1.04) best = { rotation, fit: fitted };
  }
  const rotation = best.rotation;
  const { scale, minX, maxX, minY, maxY } = best.fit;
  const offX = width / 2 - ((minX + maxX) / 2) * scale;
  const offY = height / 2 - ((minY + maxY) / 2) * scale;
  const raw = place(rotation);
  const points = raw.map((p, i) => ({
    index: i,
    x: round2(offX + p.x * scale),
    y: round2(offY + p.y * scale),
    ...meta[i],
  }));
  const segments = legs.map((leg, i) => {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    return {
      index: i,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      mx: round2((a.x + b.x) / 2),
      my: round2((a.y + b.y) / 2),
      angle: round2(degreesOf(Math.atan2(dy, dx))),
      ux: round4(ux),
      uy: round4(uy),
      // нормаль ліворуч від напрямку руху (на екрані y вниз)
      nx: round4(uy),
      ny: round4(-ux),
      length: round2(len),
    };
  });
  const turns = [];
  legs.forEach((leg, i) => {
    if (i > 0 && leg.turnBefore !== null) turns.push({ pointIndex: i, angle: leg.turnBefore });
  });
  const northAngle = radians(rotation);
  const geometry = { points, segments, turns };
  return {
    width,
    height,
    rotation,
    labels: layoutLabels(shpp, geometry, width, height, options.reserve),
    scale: round4(scale),
    north: { x: round4(Math.sin(northAngle)), y: round4(-Math.cos(northAngle)) },
    points,
    segments,
    turns,
  };
}

// ---------- Розкладка підписів схеми ----------

/** З підписом: «+4» / «−6» / «0»; порожньо для нечислових. */
export function formatSigned(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}

/** Кут повороту словами: «75° вправо» / «80° вліво»; порожньо для першої ділянки. */
export function formatTurn(angle) {
  if (angle === null || angle === undefined || !Number.isFinite(angle)) return '';
  if (angle === 0) return '0°';
  return `${Math.abs(angle)}° ${angle > 0 ? 'вправо' : 'вліво'}`;
}

/** Два рядки підпису ділянки на схемі: «МК 45° (+4°)» і «48 км · 14 хв». */
export function legLabelLines(leg) {
  const corr = Number.isFinite(leg.windCorrI) && leg.windCorrI !== 0 ? ` (${formatSigned(leg.windCorrI)}°)` : '';
  return [`МК ${leg.mk}°${corr}`, `${leg.s} км · ${leg.t} хв`];
}

const CHAR_W = 7;
const rectOf = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const overlaps = (a, b, pad = 2) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
const inside = (x, y, r, pad = 2) => x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;

function hitsSegment(rect, segment) {
  const len = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
  const steps = Math.max(2, Math.ceil(len / 3));
  let hits = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (inside(segment.x1 + (segment.x2 - segment.x1) * t, segment.y1 + (segment.y2 - segment.y1) * t, rect, 1)) hits += 1;
  }
  return hits;
}

/** Обмежувальний прямокутник повернутого прямокутника (локальні x0..x1, y0..y1 → світ). */
function rotatedBounds(cx, cy, angleDeg, x0, y0, x1, y1) {
  const a = radians(angleDeg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const xs = [];
  const ys = [];
  for (const [lx, ly] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
    xs.push(cx + lx * cos - ly * sin);
    ys.push(cy + lx * sin + ly * cos);
  }
  return rectOf(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/**
 * Жадібна розкладка підписів схеми без накладань: символи пунктів → рамки висот → підписи
 * пунктів → підписи ділянок → кути повороту. Кожен елемент бере першого кандидата без
 * накладання (інакше з найменшим штрафом). Повністю детермінована.
 */
function layoutLabels(shpp, geometry, width, height, reserve = []) {
  const { points, segments } = geometry;
  const legs = shpp.legs;
  const placed = [];
  const bounds = rectOf(4, 4, width - 4, height - 4);
  const penalty = (rect, ownSegment) => {
    let score = 0;
    if (rect.x0 < bounds.x0 || rect.y0 < bounds.y0 || rect.x1 > bounds.x1 || rect.y1 > bounds.y1) score += 60;
    for (const other of placed) if (overlaps(rect, other)) score += 20;
    segments.forEach((seg, i) => {
      if (i !== ownSegment) score += hitsSegment(rect, seg) * 3;
    });
    return score;
  };
  const choose = (candidates, ownSegment) => {
    let best = null;
    for (const cand of candidates) {
      const score = penalty(cand.rect, ownSegment);
      if (best === null || score < best.score) best = { cand, score };
      if (score === 0) break;
    }
    placed.push(best.cand.rect);
    return best.cand;
  };
  for (const r of reserve || []) placed.push(rectOf(r.x0, r.y0, r.x1, r.y1));
  points.forEach(p => placed.push(rectOf(p.x - 13, p.y - 13, p.x + 13, p.y + 13)));

  const heightBoxes = segments.map((seg, i) => {
    const leg = legs[i];
    const text = `${leg.h}${leg.heightArrow}`;
    const w = 12 + text.length * 8;
    const candidates = [0.3, 0.2, 0.4, 0.15, 0.5, 0.7, 0.8, 0.6, 0.1, 0.9, 0.35, 0.45, 0.25, 0.55].map(t => {
      const cx = seg.x1 + (seg.x2 - seg.x1) * t;
      const cy = seg.y1 + (seg.y2 - seg.y1) * t;
      return { cx: round2(cx), cy: round2(cy), w, h: 18, text, rect: rectOf(cx - w / 2, cy - 9, cx + w / 2, cy + 9) };
    });
    const pick = choose(candidates, i);
    return { index: i, cx: pick.cx, cy: pick.cy, w: pick.w, h: pick.h, text: pick.text, rect: pick.rect };
  });

  const pointLabels = points.map((p, i) => {
    const prev = segments[i - 1];
    const next = segments[i];
    let vx;
    let vy;
    if (prev && next) {
      vx = -(next.ux - prev.ux);
      vy = -(next.uy - prev.uy);
      if (Math.hypot(vx, vy) < 0.15) {
        vx = -prev.nx;
        vy = -prev.ny;
      }
    } else if (next) {
      vx = -next.ux;
      vy = -next.uy;
    } else {
      vx = prev.ux;
      vy = prev.uy;
    }
    const n = Math.hypot(vx, vy) || 1;
    const base = Math.atan2(vy / n, vx / n);
    const textLen = p.code.length + (p.name ? p.name.length + 1 : 0) + (p.landing ? 10 : 0);
    const w = textLen * CHAR_W + 4;
    const spots = [];
    for (const dist of [1, 1.6]) for (const offset of [0, 45, -45, 90, -90, 135, -135, 180]) spots.push([offset, dist]);
    const candidates = spots.map(([offset, dist]) => {
      const ang = base + radians(offset);
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const x = p.x + dx * 24 * dist;
      const y = p.y + dy * 20 * dist;
      const anchor = dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle';
      const shift = dy > 0.35 ? 12 : dy < -0.35 ? -8 : 4;
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      return { x: round2(x), y: round2(y + shift), anchor, rect: rectOf(x0, y + shift - 12, x0 + w, y + shift + 4) };
    });
    const pick = choose(candidates, -1);
    return { index: i, x: pick.x, y: pick.y, anchor: pick.anchor, rect: pick.rect };
  });

  const legLabels = segments.map((seg, i) => {
    const leg = legs[i];
    const lines = legLabelLines(leg);
    const w = Math.max(...lines.map(line => line.length)) * CHAR_W - 4;
    let angle = seg.angle;
    if (angle > 90 || angle < -90) angle += angle > 0 ? -180 : 180;
    const candidates = [];
    for (const off of [0, 12, 28]) {
      for (const t of [0.62, 0.5, 0.74, 0.38, 0.85, 0.25, 0.55, 0.68, 0.45]) {
        for (const side of [1, -1]) {
          const cx = seg.x1 + (seg.x2 - seg.x1) * t;
          const cy = seg.y1 + (seg.y2 - seg.y1) * t;
          const rect = side === 1 ? rotatedBounds(cx, cy, angle, -w / 2, -32 - off, w / 2, -3 - off) : rotatedBounds(cx, cy, angle, -w / 2, 6 + off, w / 2, 35 + off);
          candidates.push({ x: round2(cx), y: round2(cy), angle: round2(angle), side, off, rect });
        }
      }
    }
    const pick = choose(candidates, i);
    return { index: i, x: pick.x, y: pick.y, angle: pick.angle, side: pick.side, off: pick.off, lines, rect: pick.rect };
  });

  const turnLabels = geometry.turns.map(turn => {
    const p = points[turn.pointIndex];
    const prev = segments[turn.pointIndex - 1];
    const next = segments[turn.pointIndex];
    let vx = next.ux - prev.ux;
    let vy = next.uy - prev.uy;
    const n = Math.hypot(vx, vy);
    if (n < 0.15) return null;
    vx /= n;
    vy /= n;
    const text = `∠ ${formatTurn(turn.angle)}`;
    const w = text.length * 6.2;
    const base = Math.atan2(vy, vx);
    const candidates = [];
    for (const dist of [22, 34, 46, 58]) {
      for (const offset of [0, 40, -40, 80, -80, 120, -120, 160, -160, 180]) {
        const ang = base + radians(offset);
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        const x = p.x + dx * dist;
        const y = p.y + dy * dist + 4;
        const anchor = dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle';
        const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
        candidates.push({ x: round2(x), y: round2(y), anchor, text, rect: rectOf(x0, y - 11, x0 + w, y + 3) });
      }
    }
    const pick = choose(candidates, -1);
    return { pointIndex: turn.pointIndex, x: pick.x, y: pick.y, anchor: pick.anchor, text: pick.text, rect: pick.rect };
  }).filter(Boolean);

  return { heightBoxes, pointLabels, legLabels, turnLabels };
}

function extraKmOf(leg) {
  // у геометрії відкладається власна відстань ділянки без кіл посадки (вони в «S» лише для часу/палива)
  let extra = 0;
  if (leg.landing) extra += LANDING_CIRCUIT_KM;
  if (leg.afterLanding) extra += LANDING_CIRCUIT_KM;
  return extra;
}

const round2 = v => Math.round(v * 100) / 100;
const round4 = v => Math.round(v * 10000) / 10000;
