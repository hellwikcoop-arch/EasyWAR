// Калькулятори штурмана EasyFLY: вітер, шляхова швидкість, МПР, коробочка, велика коробочка,
// захід на майданчик, зниження, атмосфера. Логіку перенесено з макета «тепле світіння».
// Кути магнітні, у градусах. Вітер — «звідки дме»; на вході м/с, у трикутнику швидкостей км/год.
// КЗ зі знаком: МК = МШК − КЗ. Без DOM, мережі, Date.now і Math.random. Нічого не округлює.
// Довідковий розрахунок: не допуск до польотів і не заміна керівних документів.

const G = 9.80665;
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;
const mod = (a, n) => ((a % n) + n) % n;
/** Різниця b − a у (−180; 180]. */
function signedAngle(a, b) {
  const d = mod(b - a + 180, 360) - 180;
  return d === -180 ? 180 : d;
}

/** Трикутник швидкостей (пряма задача), без округлення. ok=false, якщо шлях витримати неможливо. */
function triangle(track, v, windFrom, uKmh) {
  const kv = rad(mod(windFrom + 180, 360) - track);
  const ratio = (uKmh * Math.sin(kv)) / v;
  if (!Number.isFinite(ratio) || Math.abs(ratio) > 1) return { ok: false, kz: NaN, mk: NaN, w: NaN };
  const kz = deg(Math.asin(ratio));
  const w = v * Math.cos(rad(kz)) + uKmh * Math.cos(kv);
  if (!(w > 0)) return { ok: false, kz: NaN, mk: NaN, w: NaN };
  return { ok: true, kz, mk: mod(track - kz, 360), w };
}

/**
 * 1. Вітер за знесенням (обернена задача): відомі МК і V (повітряний вектор) та фактичний МШК і W (шляховий вектор).
 * Вітер = шляховий вектор − повітряний вектор.
 */
function windFromDrift({ mk, v, track, w }) {
  if (![mk, v, track, w].every(Number.isFinite) || v <= 0 || w < 0) return { ok: false };
  const wx = w * Math.sin(rad(track)) - v * Math.sin(rad(mk));
  const wy = w * Math.cos(rad(track)) - v * Math.cos(rad(mk));
  const uKmh = Math.hypot(wx, wy);
  const to = uKmh < 1e-9 ? 0 : mod(deg(Math.atan2(wx, wy)), 360);
  return { ok: true, uKmh, uMs: uKmh / 3.6, to, from: mod(to + 180, 360), kz: signedAngle(mk, track) };
}

/** 2. Шляхова швидкість: за вітром (пряма задача) і за відстанню та часом. */
function groundSpeed({ track, v, windFrom, windMs }) {
  if (![track, v, windFrom, windMs].every(Number.isFinite) || v <= 0 || windMs < 0) return { ok: false, kz: NaN, mk: NaN, w: NaN };
  return triangle(track, v, windFrom, windMs * 3.6);
}
function speedByDistance(sKm, tMin) {
  return sKm > 0 && tMin > 0 ? sKm / (tMin / 60) : NaN;
}
function timeByDistance(sKm, wKmh) {
  return sKm >= 0 && wKmh > 0 ? (sKm / wKmh) * 60 : NaN;
}

/** 3. МПР: магнітний пеленг радіостанції = МК + КУР; МПС — зворотний; ІПР — із магнітним схиленням. */
function mpr({ mk, kur, declination = null }) {
  if (!Number.isFinite(mk) || !Number.isFinite(kur)) return { ok: false };
  const value = mod(mk + kur, 360);
  return { ok: true, mpr: value, mps: mod(value + 180, 360), ipr: Number.isFinite(declination) ? mod(value + declination, 360) : null };
}

/** Радіус розвороту, км, і час розвороту на кут, с: R = V² / (g·tg β). */
function turnRadiusKm(vKmh, bankDeg) {
  const v = vKmh / 3.6;
  return (v * v) / (G * Math.tan(rad(bankDeg))) / 1000;
}
function turnTimeSec(vKmh, bankDeg, angleDeg) {
  return (rad(Math.abs(angleDeg)) * turnRadiusKm(vKmh, bankDeg) * 1000) / (vKmh / 3.6);
}

/**
 * Спільна основа схем: система координат із початком у точці посадки, вісь x — посадковий курс (вперед),
 * вісь y — праворуч. Кут θ — за годинниковою стрілкою від посадкового курсу; магнітний = МКпос + θ.
 * Прямі ділянки тримають лінію шляху з поправкою на знесення; розвороти — з постійним креном, тому над землею
 * їх зносить на (вектор вітру × час розвороту).
 */
function frame({ landingMk, side, v, bank, windFrom, windMs }, issues) {
  const s = side === 'right' ? 1 : -1; // знак y сторони кола; для лівого кола розвороти ліві
  const uKmh = windMs * 3.6;
  const R = turnRadiusKm(v, bank);
  const tw = rad(mod(windFrom + 180, 360) - landingMk);
  const wind = { x: uKmh * Math.cos(tw), y: uKmh * Math.sin(tw) };
  const leg = (name, th) => {
    const t = triangle(mod(landingMk + th, 360), v, windFrom, uKmh);
    if (!t.ok) issues.push(`Ділянка «${name}»: вітер не дозволяє витримати шлях.`);
    return { track: mod(landingMk + th, 360), mk: t.mk, kz: t.kz, w: t.w, th: mod(th, 360), hth: mod(th - t.kz, 360) };
  };
  // розворот у повітрі з курсу a на курс b (локальні кути курсу, не шляху) у бік кола
  const turn = (a, b) => {
    const d = s === 1 ? mod(b - a, 360) : mod(a - b, 360);
    const ar = rad(a), br = rad(a + s * d);
    const air = s === 1
      ? { x: R * (Math.sin(br) - Math.sin(ar)), y: R * (Math.cos(ar) - Math.cos(br)) }
      : { x: R * (Math.sin(ar) - Math.sin(br)), y: R * (Math.cos(br) - Math.cos(ar)) };
    const tHours = (rad(d) * R) / v;
    return { angle: d, from: a, sec: tHours * 3600, dx: air.x + wind.x * tHours, dy: air.y + wind.y * tHours };
  };
  const kurTo = (pt, headingTh) => mod(deg(Math.atan2(-pt.y, -pt.x)) - headingTh, 360);
  return { s, R, wind, leg, turn, kurTo };
}
const validCommon = p => ['landingMk', 'v', 'bank', 'windFrom', 'windMs'].every(k => Number.isFinite(p[k])) && p.v > 0 && p.bank > 0 && p.bank < 80 && p.windMs >= 0;

/**
 * 4. Політ по коробочці з вітром (чотири розвороти на 90°). Точки початку розворотів зсунуто так, щоб вихід
 * із 4-го розвороту був на посадковій прямій на відстані d4 від точки посадки.
 *
 * @param {object} p  landingMk — посадковий МК; side — 'left' | 'right' (напрям розворотів);
 *   v — швидкість на колі, км/год; bank — крен на розворотах, °; width — ширина коробочки, км;
 *   d4 — відстань виходу з 4-го розвороту до точки посадки, км; d1 — відстань від точки посадки до початку
 *   1-го розвороту, км; windFrom, windMs — вітер.
 */
function circuit(p) {
  const q = { side: 'left', windFrom: 0, windMs: 0, ...p };
  const { v, width, d4, d1 } = q;
  if (!validCommon(q) || ![width, d4, d1].every(Number.isFinite) || width <= 0 || d4 < 0 || d1 < 0) return { ok: false, issues: ['Заповніть усі параметри.'] };
  const issues = [];
  const f = frame(q, issues);
  const { s, R, turn } = f;
  if (!(width >= 2 * R)) issues.push('Ширина коробочки менша за два радіуси розвороту.');
  const leg = { upwind: f.leg('зліт', 0), cross: f.leg('друга', s * 90), down: f.leg('третя', 180), base: f.leg('четверта', 180 + s * 90), final: f.leg('посадкова пряма', 0) };
  if (issues.some(t => t.includes('вітер'))) return { ok: false, issues, radiusKm: R };
  const t1 = turn(leg.upwind.hth, leg.cross.hth);
  const t2 = turn(leg.cross.hth, leg.down.hth);
  const t3 = turn(leg.down.hth, leg.base.hth);
  const t4 = turn(leg.base.hth, leg.final.hth);
  const yDown = s * width;
  // назад від посадки
  const E4 = { x: -d4, y: 0 };
  const S4 = { x: E4.x - t4.dx, y: E4.y - t4.dy };
  const E3 = { x: S4.x, y: yDown + t3.dy };
  const S3 = { x: E3.x - t3.dx, y: yDown };
  // вперед від зльоту
  const S1 = { x: d1, y: 0 };
  const E1 = { x: S1.x + t1.dx, y: S1.y + t1.dy };
  const S2 = { x: E1.x, y: yDown - t2.dy };
  const E2 = { x: S2.x + t2.dx, y: yDown };
  const len = { upwind: d1, cross: s * (S2.y - E1.y), down: E2.x - S3.x, base: -s * (S4.y - E3.y), final: d4 };
  const NAME = { cross: 'друга', down: 'третя', base: 'четверта' };
  for (const k of ['cross', 'down', 'base']) if (!(len[k] >= 0)) issues.push(`Ділянка «${NAME[k]}»: не лишається прямої (${len[k].toFixed(2)} км).`);
  const seconds = Object.fromEntries(Object.keys(len).map(k => [k, (len[k] / leg[k].w) * 3600]));
  const abeamToThird = -S3.x; // від траверзу точки посадки до початку 3-го розвороту вздовж третьої ділянки, км
  return {
    ok: issues.length === 0,
    issues,
    kind: 'circuit',
    side: s,
    radiusKm: R,
    wind: f.wind,
    legs: leg,
    order: ['upwind', 't1', 'cross', 't2', 'down', 't3', 'base', 't4', 'final'],
    lengthsKm: len,
    seconds,
    turns: { t1, t2, t3, t4 },
    points: { S1, E1, S2, E2, S3, E3, S4, E4 },
    abeamToThirdKm: abeamToThird,
    abeamToThirdSec: (abeamToThird / leg.down.w) * 3600,
    kurThird: f.kurTo(S3, leg.down.hth),
    kurFourth: f.kurTo(S4, leg.base.hth),
    totalSec: Object.values(seconds).reduce((a, b) => a + b, 0) + t1.sec + t2.sec + t3.sec + t4.sec,
  };
}

/**
 * Наземний слід схеми для малювання: точки в км у системі (x — посадковий курс, y — праворуч), починаючи з
 * точки посадки. Розвороти розбито на кроки ≤ stepDeg; кожна точка має seg — назву ділянки або розвороту.
 */
function groundTrack(res, v, stepDeg = 6) {
  if (!res || !res.points) return [];
  const pts = [{ x: 0, y: 0, seg: 'upwind' }];
  let pos = { ...res.points.S1 };
  pts.push({ ...pos, seg: 'upwind' });
  const R = res.radiusKm, s = res.side;
  for (const key of res.order.slice(1)) {
    if (key in res.turns) {
      const t = res.turns[key];
      const n = Math.max(1, Math.ceil(t.angle / stepDeg));
      const dA = t.angle / n, dT = (rad(dA) * R) / v;
      for (let i = 0; i < n; i++) {
        const h = rad(t.from + s * dA * (i + 0.5));
        const chord = 2 * R * Math.sin(rad(dA) / 2);
        pos = { x: pos.x + chord * Math.cos(h) + res.wind.x * dT, y: pos.y + chord * Math.sin(h) + res.wind.y * dT };
        pts.push({ ...pos, seg: key });
      }
    } else {
      const th = rad(res.legs[key].th), len = res.lengthsKm[key];
      pos = { x: pos.x + len * Math.cos(th), y: pos.y + len * Math.sin(th) };
      pts.push({ ...pos, seg: key });
    }
  }
  return pts;
}

// ====================================================================================================================
// Схеми з довідкових сторінок власника (фото від 11.11.2026): велика коробочка за МПР (рис. 8 «Схема захода на посадку
// по большой коробочке», аркуш «СМУ (МПР)»), три схеми заходу на майданчик, два профілі зниження, перевідні таблиці.
// Числа «за схемою» — константи з цих сторінок. Із вітром рахуємо поправки; у штиль результат має збігатися зі схемою.
// ====================================================================================================================

/**
 * 5. Велика коробочка за МПР. Радіостанція (ПРС) — на осі посадкового курсу за 1300 м до старту; коло будують довкола неї.
 * legs — у порядку польоту: s — довжина, м; v — швидкість (середня на ділянці), км/год; docSec — час за схемою, с.
 * points — контрольні точки: зсув МПР від посадкового МК і КУР для ЛІВОГО кола; для правого беремо 360° − значення.
 */
const BIG_BOX = {
  bank: 10, // біля 4-го розвороту на сторінці є ще позначка «200 м», але її початок обрізано на копії — у розрахунку не використовуємо
  legs: [
    { id: 'takeoff', s: 3500, v: 120, docSec: 105 }, // від старту до початку 1-го розвороту
    { id: 'second', s: 2350, v: 150, docSec: 56 }, // між 1-м і 2-м розворотами
    { id: 'thirdA', s: 4650, v: 150, docSec: 111 }, // від 2-го розвороту до траверзу ПРС
    { id: 'thirdB', s: 2600, v: 150, docSec: 62 }, // від траверзу до початку 3-го розвороту
    { id: 'fourth', s: 2350, v: 140, docSec: 60 }, // між 3-м і 4-м розворотами
    { id: 'finalA', s: 2750, v: 120, docSec: 82 }, // від виходу з 4-го розвороту до ПРС
    { id: 'finalB', s: 1300, v: 100, docSec: 46 }, // від ПРС до старту
  ],
  turns: [
    { id: 't1', v: 120, docSec: 30 },
    { id: 't2', v: 150, docSec: 38 },
    { id: 't3', v: 150, docSec: 38 },
    { id: 't4', v: 140, docSec: 35 },
  ],
  points: [
    { id: 'turn2', leg: 'second', mprLeft: 150, kurLeft: 240 },
    { id: 'abeam', leg: 'thirdA', mprLeft: 90, kurLeft: 270 },
    { id: 'turn3', leg: 'thirdB', mprLeft: 60, kurLeft: 240 },
    { id: 'turn4', leg: 'fourth', mprLeft: 15, kurLeft: 285 },
  ],
  beaconToFirstTurn: { id: 'entry', s: 4800, v: 140, docSec: 123 }, // розмір на сторінці: від ПРС до початку 1-го розвороту (без підпису)
  minW: 30, // км/год: за меншої шляхової швидкості ділянку не рахуємо
};

/** Контрольні МПР великої коробочки для обох кіл: рядки «ЛІВ» і «ПРАВ» таблиці під схемою. */
function bigBoxBearings(landingMk) {
  if (!Number.isFinite(landingMk)) return { ok: false };
  const row = side => BIG_BOX.points.map(pt => {
    const offset = side === 'left' ? pt.mprLeft : 360 - pt.mprLeft;
    return { id: pt.id, offset, mpr: mod(landingMk + offset, 360) };
  });
  return { ok: true, left: row('left'), right: row('right') };
}

/**
 * Велика коробочка з вітром: геометрія лишається за схемою (точки розворотів визначає МПР), рахуємо для кожної
 * ділянки кут зносу, курс, шляхову швидкість і час (час зі сторінки × V / W: у штиль — рівно як на сторінці),
 * а для контрольних точок — КУР = КУР за схемою + УС.
 */
function bigBox(p) {
  const q = { side: 'left', windFrom: 0, windMs: 0, ...p };
  if (!Number.isFinite(q.landingMk)) return { ok: false, issues: ['Вкажіть посадковий МК.'] };
  if (![q.windFrom, q.windMs].every(Number.isFinite) || q.windMs < 0) return { ok: false, issues: ['Вкажіть вітер: звідки дме і швидкість.'] };
  const s = q.side === 'right' ? 1 : -1;
  const uKmh = q.windMs * 3.6;
  const TH = { takeoff: 0, second: s * 90, thirdA: 180, thirdB: 180, fourth: 180 + s * 90, finalA: 0, finalB: 0 };
  const issues = [];
  const one = (l, th) => {
    const track = mod(q.landingMk + th, 360);
    const t = triangle(track, l.v, q.windFrom, uKmh);
    if (!(t.ok && t.w >= BIG_BOX.minW) && !issues.length) issues.push('Вітер надто сильний для цієї схеми: на одній із ділянок шлях не витримати або шляхова швидкість менша за ' + BIG_BOX.minW + ' км/год.');
    // час за схемою беремо зі сторінки (там він обрізаний до секунд) і перераховуємо на шляхову швидкість: t = tсх · V / W
    return { id: l.id, s: l.s, v: l.v, docSec: l.docSec, track, kz: t.kz, mk: t.mk, w: t.w, sec: t.ok ? (l.docSec * l.v) / t.w : NaN };
  };
  const legs = BIG_BOX.legs.map(l => one(l, TH[l.id]));
  const entry = one(BIG_BOX.beaconToFirstTurn, 0); // до часу кола не входить
  const byId = Object.fromEntries(legs.map(l => [l.id, l]));
  const points = BIG_BOX.points.map(pt => {
    const offset = s === -1 ? pt.mprLeft : 360 - pt.mprLeft;
    const kurNominal = s === -1 ? pt.kurLeft : 360 - pt.kurLeft;
    const leg = byId[pt.leg];
    return { id: pt.id, offset, mpr: mod(q.landingMk + offset, 360), kurNominal, us: leg.kz, kur: mod(kurNominal + leg.kz, 360), mk: leg.mk };
  });
  const turnsSec = BIG_BOX.turns.reduce((a, t) => a + t.docSec, 0);
  return {
    ok: issues.length === 0,
    issues,
    kind: 'bigbox',
    side: s,
    legs,
    entry,
    points,
    turns: BIG_BOX.turns,
    docTotalSec: BIG_BOX.legs.reduce((a, l) => a + l.docSec, 0) + turnsSec,
    totalSec: legs.reduce((a, l) => a + l.sec, 0) + turnsSec,
  };
}

/**
 * Номінальна (у штиль) схема великої коробочки для малювання, км: початок — ПРС, вісь x — посадковий курс, y — праворуч.
 * Будуємо від виходу з 4-го розвороту назад за довжинами зі схеми; радіус 1-го розвороту підібрано так, щоб схема
 * замкнулася на осі (за числами сторінки це ≈ 0,87 км, як для 140 км/год, а не для підписаних 120 км/год).
 */
function bigBoxTrack(side = 'left', stepDeg = 15) {
  const s = side === 'right' ? 1 : -1;
  const L = Object.fromEntries(BIG_BOX.legs.map(l => [l.id, l.s / 1000]));
  const r2 = turnRadiusKm(150, BIG_BOX.bank), r3 = r2, r4 = turnRadiusKm(140, BIG_BOX.bank);
  const E4 = { x: -L.finalA, y: 0 };
  const S4 = { x: E4.x - r4, y: s * r4 };
  const E3 = { x: S4.x, y: S4.y + s * L.fourth };
  const S3 = { x: E3.x + r3, y: E3.y + s * r3 };
  const abeam = { x: 0, y: S3.y };
  const E2 = { x: L.thirdA, y: S3.y };
  const S2 = { x: E2.x + r2, y: E2.y - s * r2 };
  const E1 = { x: S2.x, y: S2.y - s * L.second };
  const r1 = Math.abs(E1.y);
  const S1 = { x: E1.x - r1, y: 0 };
  const beacon = { x: 0, y: 0 }, runway = { x: L.finalB, y: 0 };
  const pts = [{ ...runway, seg: 'takeoff' }, { ...S1, seg: 'takeoff' }];
  const arc = (from, heading, r, seg) => { // розворот на 90° у бік кола з курсу heading
    let pos = { ...from };
    const n = Math.ceil(90 / stepDeg), dA = 90 / n, chord = 2 * r * Math.sin(rad(dA) / 2);
    for (let i = 0; i < n; i++) {
      const h = rad(heading + s * dA * (i + 0.5));
      pos = { x: pos.x + chord * Math.cos(h), y: pos.y + chord * Math.sin(h) };
      pts.push({ ...pos, seg });
    }
  };
  arc(S1, 0, r1, 't1'); pts.push({ ...S2, seg: 'second' });
  arc(S2, s * 90, r2, 't2'); pts.push({ ...abeam, seg: 'thirdA' }, { ...S3, seg: 'thirdB' });
  arc(S3, 180, r3, 't3'); pts.push({ ...S4, seg: 'fourth' });
  arc(S4, 180 + s * 90, r4, 't4'); pts.push({ ...beacon, seg: 'finalA' }, { ...runway, seg: 'finalB' });
  return { side: s, pts, marks: { beacon, runway, S1, E1, S2, E2, abeam, S3, E3, S4, E4 }, widthKm: Math.abs(S3.y), firstTurnRadiusKm: r1 };
}

/**
 * 6. Схеми заходу на майданчик: «Отворотом на РУ», «2-мя отворотами на 180°», «По малой коробочке».
 * За сторінкою: V = 120 км/год, крен 10° (R = 640 м), вихід на посадкову пряму за 1500 м; РУ = 45° і t = 45 с;
 * t = 45 с між розворотами на 180°; t = 20 с і t = 25 с на малій коробочці.
 */
const PAD_DOC = {
  v: 120, bank: 10, radiusM: 640, finalM: 1500,
  teardrop: { ru: 45, timeSec: 45 },
  racetrack: { timeSec: 45 },
  smallbox: { t1Sec: 20, t2Sec: 25 },
  // межі правдоподібності результату (не зі сторінки): нижче або вище — показуємо попередження
  minFinalM: 700, maxTurnDeg: 250, maxLeadDeg: 30, minT1Sec: 3,
};

/** Розв'язок двох рівнянь із двома невідомими методом Ньютона з числовою похідною. */
function newton2(resid, x0, h) {
  let x = x0.slice();
  for (let i = 0; i < 80; i++) {
    const f0 = resid(x);
    if (!f0) return null;
    if (Math.hypot(f0[0], f0[1]) < 1e-10) return x;
    const fa = resid([x[0] + h[0], x[1]]), fb = resid([x[0], x[1] + h[1]]);
    if (!fa || !fb) return null;
    const a = (fa[0] - f0[0]) / h[0], b = (fb[0] - f0[0]) / h[1], c = (fa[1] - f0[1]) / h[0], d = (fb[1] - f0[1]) / h[1];
    const det = a * d - b * c;
    if (!(Math.abs(det) > 1e-16)) return null;
    const d0 = (-f0[0] * d + f0[1] * b) / det, d1 = (-a * f0[1] + c * f0[0]) / det;
    const damp = Math.max(Math.abs(d0) / 15, Math.abs(d1) / 30, 1); // не більше 15° або 30 с за крок
    x = [x[0] + d0 / damp, x[1] + d1 / damp];
  }
  const f1 = resid(x);
  return f1 && Math.hypot(f1[0], f1[1]) < 1e-7 ? x : null;
}

/** Корінь однієї функції на відрізку: шукаємо зміну знака на сітці, далі ділимо навпіл. null, якщо кореня немає. */
function root1(fn, lo, hi, n = 180) {
  let a = lo, fa = fn(a);
  for (let i = 1; i <= n; i++) {
    const b = lo + ((hi - lo) * i) / n, fb = fn(b);
    if (fa !== null && fb !== null && (fa === 0 || fa * fb <= 0)) {
      let x0 = a, x1 = b, f0 = fa;
      for (let k = 0; k < 60; k++) {
        const m = (x0 + x1) / 2, fm = fn(m);
        if (fm === null) return null;
        if (f0 * fm <= 0) x1 = m; else { x0 = m; f0 = fm; }
      }
      return (x0 + x1) / 2;
    }
    a = b; fa = fb;
  }
  return null;
}

/**
 * Захід на майданчик за однією з трьох схем. Система координат: початок — майданчик, x — посадковий курс, y — праворуч.
 * Прямі тримають лінію шляху з поправкою на знесення, розвороти — з постійним креном і зносом вітром.
 *  - teardrop  (відворотом на РУ): прохід над майданчиком курсом, зворотним посадковому → відворот на РУ → пряма t →
 *    розворот на (180° + РУ) на посадковий курс.
 *  - racetrack (двома розворотами на 180°): прохід над майданчиком посадковим курсом → розворот на 180° → третя ділянка,
 *    від траверзу майданчика t → розворот на 180°.
 *  - smallbox  (мала коробочка): прохід над майданчиком курсом, перпендикулярним посадковому → пряма t1 → розворот на 90° →
 *    пряма t2 → розворот на 180°.
 * side — напрям розворотів ('left' | 'right').
 *
 * mode 'time' (типовий): часи беремо за схемою (timeSec; для малої коробочки t2Sec) і шукаємо ОДНУ величину, за якої вихід
 * із останнього розвороту лягає на вісь посадкового курсу: РУ; поправку в лінію шляху третьої ділянки («упередження»);
 * час t1. Відстань виходу на посадкову пряму (finalKm) — результат.
 * mode 'final': задано finalKm, шукаємо дві величини (РУ і t; упередження і t; t1 і t2), щоб вийти на вісь саме там.
 */
function padApproach(p) {
  const D = PAD_DOC;
  const q = { scheme: 'teardrop', side: 'left', mode: 'time', windFrom: 0, windMs: 0, v: D.v, bank: D.bank, finalKm: D.finalM / 1000, ...p };
  if (!validCommon(q) || !['teardrop', 'racetrack', 'smallbox'].includes(q.scheme) || !['time', 'final'].includes(q.mode)) return { ok: false, issues: ['Заповніть усі параметри.'] };
  const timeSec = Number.isFinite(q.timeSec) ? q.timeSec : q.scheme === 'smallbox' ? NaN : D[q.scheme].timeSec;
  const t2Given = Number.isFinite(q.t2Sec) ? q.t2Sec : D.smallbox.t2Sec;
  if (q.mode === 'final' ? !(q.finalKm > 0) : q.scheme === 'smallbox' ? !(t2Given >= 0) : !(timeSec > 0)) return { ok: false, issues: ['Заповніть усі параметри.'] };
  const issues = [];
  const f = frame(q, issues);
  const { s, R } = f;
  const uKmh = q.windMs * 3.6, v = q.v;
  const leg = (id, th) => {
    const t = triangle(mod(q.landingMk + th, 360), v, q.windFrom, uKmh);
    return t.ok ? { type: 'leg', id, th: mod(th, 360), track: mod(q.landingMk + th, 360), mk: t.mk, kz: t.kz, w: t.w, hth: mod(th - t.kz, 360) } : null;
  };
  const along = (l, sec) => { const km = (l.w * sec) / 3600, a = rad(l.th); return { km, dx: km * Math.cos(a), dy: km * Math.sin(a) }; };
  const turn = (id, a, b) => ({ type: 'turn', id, ...f.turn(a, b) });
  const fin = leg('final', 0);
  if (!fin) return { ok: false, issues: ['Вітер не дозволяє витримати посадковий курс.'], radiusKm: R };
  const dCalm = q.mode === 'final' ? q.finalKm : null;
  let build, calm;
  if (q.scheme === 'teardrop') {
    // у штиль: РУ = 2·arctg(R / L), L = V·t; вихід на посадкову пряму рівно за L від майданчика
    calm = dCalm ? { ru: deg(2 * Math.atan(R / dCalm)), timeSec: (dCalm / v) * 3600 } : { ru: deg(2 * Math.atan(R / ((v * timeSec) / 3600))), timeSec };
    build = (ru, sec) => {
      const out = leg('outbound', 180 - s * ru);
      if (!out || !(sec > 0) || !(ru > 0.5 && ru < 89.5)) return null;
      const a = along(out, sec), tn = turn('t1', out.hth, fin.hth);
      // як на сторінці, відворот на РУ вважаємо миттєвим над майданчиком (t — від прольоту майданчика); turnAwaySec — скільки він триває насправді
      return { end: { x: a.dx + tn.dx, y: a.dy + tn.dy }, segs: [{ ...out, sec, km: a.km }, tn], extra: { ru, timeSec: sec, turnAwaySec: ((rad(ru) * R) / v) * 3600 } };
    };
  } else if (q.scheme === 'racetrack') {
    calm = dCalm ? { delta: 0, timeSec: (dCalm / v) * 3600 } : { delta: 0, timeSec };
    build = (delta, fromAbeam) => {
      const up = leg('arrival', 0), down = leg('down', 180 + delta);
      if (!up || !down || !(fromAbeam > 0) || !(Math.abs(delta) <= 60)) return null;
      const t1 = turn('t1', up.hth, down.hth);
      // траверз майданчика — перетин лінії x = 0 (перпендикуляр до посадкового курсу через майданчик); секундомір — від нього
      let toAbeamSec = 0, sinceAbeamSec = 0;
      if (t1.dx > 0) toAbeamSec = (t1.dx / Math.abs(Math.cos(rad(down.th))) / down.w) * 3600; // після розвороту ще не дійшли до траверзу
      else { // вітер зніс назад: траверз пройдено ще в розвороті — шукаємо останній перетин x = 0 на дузі
        const a0 = rad(up.hth), full = rad(t1.angle);
        const xAt = phi => s * R * (Math.sin(a0 + s * phi) - Math.sin(a0)) + (f.wind.x * phi * R) / v;
        let hi = full, lo = 0;
        for (let i = 1; i <= 90; i++) { const c = full * (1 - i / 90); if (xAt(c) > 0) { lo = c; break; } hi = c; }
        for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; if (xAt(m) > 0) lo = m; else hi = m; }
        sinceAbeamSec = (((full - hi) * R) / v) * 3600;
      }
      const sec = fromAbeam + toAbeamSec - sinceAbeamSec; // час прямої після виходу з 1-го розвороту
      if (!(sec > 0)) return null;
      const a = along(down, sec), t2 = turn('t2', down.hth, fin.hth);
      return { end: { x: t1.dx + a.dx + t2.dx, y: t1.dy + a.dy + t2.dy }, segs: [t1, { ...down, sec, km: a.km }, t2], extra: { delta, timeSec: fromAbeam, downSec: sec, toAbeamSec, sinceAbeamSec } };
    };
  } else {
    calm = dCalm ? { t1Sec: (R / v) * 3600, t2Sec: ((dCalm - R) / v) * 3600 } : { t1Sec: (R / v) * 3600, t2Sec: t2Given };
    build = (sec1, sec2) => {
      const inn = leg('cross', s * 90), down = leg('down', 180);
      if (!inn || !down || !(sec1 >= 0) || !(sec2 >= 0)) return null;
      const a1 = along(inn, sec1), ta = turn('t1', inn.hth, down.hth), a2 = along(down, sec2), tb = turn('t2', down.hth, fin.hth);
      return { end: { x: a1.dx + ta.dx + a2.dx + tb.dx, y: a1.dy + ta.dy + a2.dy + tb.dy }, segs: [{ ...inn, sec: sec1, km: a1.km }, ta, { ...down, sec: sec2, km: a2.km }, tb], extra: { t1Sec: sec1, t2Sec: sec2 } };
    };
  }
  let b = null;
  if (q.mode === 'final') {
    const x0 = q.scheme === 'teardrop' ? [calm.ru, calm.timeSec] : q.scheme === 'racetrack' ? [0, calm.timeSec] : [calm.t1Sec, calm.t2Sec];
    const x = newton2(u => { const r = build(u[0], u[1]); return r ? [r.end.y, r.end.x + q.finalKm] : null; }, x0, [0.01, 0.01]);
    if (x) b = build(x[0], x[1]);
  } else {
    const second = q.scheme === 'smallbox' ? t2Given : timeSec;
    const range = q.scheme === 'teardrop' ? [1, 89] : q.scheme === 'racetrack' ? [-60, 60] : [0, 240];
    const u = root1(x => { const r = build(x, second); return r ? r.end.y : null; }, range[0], range[1]);
    if (u !== null) b = build(u, second);
  }
  const windy = q.windMs > 0.05;
  if (!b) {
    return { ok: false, radiusKm: R, calm, issues: [windy
      ? 'За такого вітру схема не замикається на осі посадкового курсу: спробуйте розвороти в інший бік або інший час прямої.'
      : 'Із такими швидкістю, креном і часом схема не замикається на осі посадкового курсу: збільште час прямої або крен.'] };
  }
  const finalKm = -b.end.x;
  if (!(finalKm > 0)) return { ok: false, issues: [(windy ? 'За такого вітру' : 'Із такими параметрами') + ' вихід із розвороту опиняється за майданчиком: схема не підходить.'], radiusKm: R, calm };
  // правдоподібність: часи задано схемою, тож довжина посадкової прямої і форма схеми — результат; крайні випадки позначаємо
  const warnings = [];
  const maxTurn = Math.max(...b.segs.filter(g => g.type === 'turn').map(g => g.angle));
  if (finalKm < PAD_DOC.minFinalM / 1000) warnings.push('Посадкова пряма лише ' + Math.round(finalKm * 1000) + ' м (за схемою ' + D.finalM + ' м) — замало: збільште час прямої' + (windy ? ' або змініть бік розворотів.' : '.'));
  if (maxTurn > PAD_DOC.maxTurnDeg || (q.scheme === 'racetrack' && Math.abs(b.extra.delta) > PAD_DOC.maxLeadDeg))
    warnings.push('Схему сильно деформовано' + (windy ? ' вітром' : '') + ' (розворот на ' + Math.round(maxTurn) + '°): ' + (windy ? 'спробуйте розвороти в інший бік.' : 'змініть час прямої або крен.'));
  if (q.scheme === 'smallbox' && b.extra.t1Sec < PAD_DOC.minT1Sec) warnings.push('Перша пряма майже нульова (за схемою ' + D.smallbox.t1Sec + ' с): ' + (windy ? 'вітер зносить до посадкової осі — спробуйте розвороти в інший бік.' : 'перевірте швидкість і крен.'));
  const finalSec = (finalKm / fin.w) * 3600;
  const segments = [...b.segs, { ...fin, sec: finalSec, km: finalKm }];
  return {
    ok: true,
    issues,
    warnings,
    kind: 'pad',
    scheme: q.scheme,
    mode: q.mode,
    side: s,
    v,
    radiusKm: R,
    wind: f.wind,
    segments,
    arrivalTh: q.scheme === 'teardrop' ? 180 : q.scheme === 'racetrack' ? 0 : mod(s * 90, 360),
    ...b.extra,
    calm,
    finalKm,
    finalSec,
    totalSec: segments.reduce((a, g) => a + g.sec, 0),
  };
}

/** Наземний слід схеми заходу на майданчик для малювання (км; початок — майданчик). */
function padTrack(res, stepDeg = 15) {
  if (!res || !res.segments) return [];
  let pos = { x: 0, y: 0 };
  const pts = [{ ...pos, seg: 'pad' }];
  const R = res.radiusKm, s = res.side, v = res.v;
  for (const g of res.segments) {
    if (g.type === 'turn') {
      const n = Math.max(1, Math.ceil(g.angle / stepDeg)), dA = g.angle / n, dT = (rad(dA) * R) / v, chord = 2 * R * Math.sin(rad(dA) / 2);
      for (let i = 0; i < n; i++) {
        const h = rad(g.from + s * dA * (i + 0.5));
        pos = { x: pos.x + chord * Math.cos(h) + res.wind.x * dT, y: pos.y + chord * Math.sin(h) + res.wind.y * dT };
        pts.push({ ...pos, seg: g.id });
      }
    } else {
      const a = rad(g.th);
      pos = { x: pos.x + g.km * Math.cos(a), y: pos.y + g.km * Math.sin(a) };
      pts.push({ ...pos, seg: g.id });
    }
  }
  return pts;
}

/**
 * 7. Профілі зниження на майданчик. s — довжина ділянки за сторінкою у штиль, м; sec — час, с; vAvg — середня швидкість, км/год.
 * h200: «ТНС» — зниження з 200 м; h50: «Точка начала гашения скорости» — гасіння швидкості на 50 м і зниження.
 */
const DESCENT_MIN_LAST_W = 10; // км/год: за меншої середньої шляхової швидкості на останній ділянці показуємо попередження
const DESCENT = {
  h200: {
    levelV: 150, levelH: 200,
    segments: [
      { id: 'a', h0: 200, h1: 150, vy: 2, sec: 25, vAvg: 150, s: 1050, v0: 150, mark: 'ТНС' },
      { id: 'b', h0: 150, h1: 100, vy: 2, sec: 25, vAvg: 125, s: 880, v0: 150 },
      { id: 'c', h0: 100, h1: 50, vy: 2, sec: 25, vAvg: 75, s: 520, v0: 100 },
      { id: 'd', h0: 50, h1: 10, vy: 1, sec: 40, vAvg: 25, s: 280, v0: 50, toHover: true },
    ],
  },
  h50: {
    levelV: 150, levelH: 50,
    segments: [
      { id: 'a', h0: 50, h1: 50, vy: 0, sec: 50, vAvg: 100, s: 1400, v0: 150, decel: true, mark: 'гасіння' },
      { id: 'b', h0: 50, h1: 15, vy: 1, sec: 35, vAvg: 25, s: 243, v0: 50, toHover: true },
    ],
  },
};

/** Зустрічна складова вітру на посадковому курсі, м/с («+» — зустрічний, «−» — попутний). */
function headwindMs(landingMk, windFrom, windMs) {
  return [landingMk, windFrom, windMs].every(Number.isFinite) ? windMs * Math.cos(rad(windFrom - landingMk)) : NaN;
}

/** Бокова складова вітру відносно посадкового курсу, м/с (модуль). */
function crosswindMs(landingMk, windFrom, windMs) {
  return [landingMk, windFrom, windMs].every(Number.isFinite) ? Math.abs(windMs * Math.sin(rad(windFrom - landingMk))) : NaN;
}

/**
 * Зниження з вітром: час кожної ділянки лишається за схемою, шлях над землею зменшується на (зустрічна складова × час).
 * Остання ділянка (toHover) закінчується зависанням над майданчиком, тобто шляховою швидкістю 0: приладна швидкість
 * спадає з 50 км/год до швидкості вітру, тож вітер скорочує її шлях лише на (складова × час / 2).
 * Ураховано тільки складову вітру вздовж посадкового курсу.
 * ioKm — відстань від вихідного орієнтира (ИО) до майданчика; тоді рахуємо час горизонтального польоту tгп = Sгп / Wгп.
 */
function descent({ profile = 'h200', headMs = 0, ioKm = null }) {
  const P = DESCENT[profile];
  if (!P || !Number.isFinite(headMs)) return { ok: false, issues: ['Вкажіть профіль і вітер.'] };
  const issues = [], warnings = [];
  const segs = P.segments.map(g => {
    const s = g.s - headMs * g.sec * (g.toHover ? 0.5 : 1);
    if (!(s > 0) && !issues.length) issues.push('Зустрічний вітер надто сильний: на одній із ділянок шляхова швидкість не більша за нуль — профіль за схемою не рахується.');
    return { ...g, sWind: s, wAvg: (s / g.sec) * 3.6 };
  });
  const noPath = issues.length > 0;
  const last = segs[segs.length - 1];
  if (!noPath && last.wAvg < DESCENT_MIN_LAST_W) warnings.push('Сильний зустрічний вітер: остання ділянка майже прямовисна (' + Math.round(last.sWind) + ' м за ' + last.sec + ' с) — профіль лише орієнтовний.');
  let rest = 0;
  for (let i = segs.length - 1; i >= 0; i--) { rest += segs[i].sWind; segs[i].toPad = rest; }
  let docRest = 0;
  for (let i = segs.length - 1; i >= 0; i--) { docRest += segs[i].s; segs[i].docToPad = docRest; }
  const wLevel = P.levelV / 3.6 - headMs; // м/с
  const startM = segs[0].toPad;
  const levelM = Number.isFinite(ioKm) ? ioKm * 1000 - startM : NaN;
  if (Number.isFinite(ioKm) && !(levelM >= 0) && !issues.length) issues.push(profile === 'h50' ? 'Вихідний орієнтир ближче до майданчика, ніж точка початку гасіння швидкості.' : 'Вихідний орієнтир ближче до майданчика, ніж точка початку зниження.');
  return {
    ok: issues.length === 0,
    noPath, // true — шлях хоча б однієї ділянки не додатний: відстаней не існує
    issues,
    warnings,
    kind: 'descent',
    profile,
    levelV: P.levelV,
    levelH: P.levelH,
    segments: segs,
    startM,
    docStartM: segs[0].docToPad,
    totalSec: segs.reduce((a, g) => a + g.sec, 0),
    levelW: wLevel * 3.6,
    levelM,
    levelSec: levelM >= 0 && wLevel > 0 ? levelM / wLevel : NaN,
  };
}

/** 8. Перевідні коефіцієнти зі сторінок «Переводные таблицы». */
const UNITS = { ftPerM: 3.2808, lbPerKg: 2.2046, hpaPerMmHg: 1.3332, ktPerMs: 1.9438 };

/** Таблиця атмосфери зі сторінки: висота, м · тиск, мм рт. ст. · температура, °C · вагова щільність повітря, кг/м³. */
const ATMOSPHERE = [
  [0, 760.0, 15.0, 1.2255], [100, 751.0, 14.4, 1.2137], [500, 716.0, 11.8, 1.1677], [1000, 674.0, 8.5, 1.1120],
  [2000, 596.1, 2.0, 1.0067], [3000, 525.7, -4.5, 0.9093], [4000, 462.2, -11.0, 0.8192], [5000, 404.8, -17.5, 0.7361],
  [6000, 353.7, -24.0, 0.6596], [7000, 307.8, -30.5, 0.5894], [8000, 266.8, -37.0, 0.5250], [9000, 230.4, -43.5, 0.4662],
  [10000, 198.1, -50.0, 0.4125], [15000, 90.2, -56.0, 0.1935], [20000, 40.9, -56.5, 0.0880], // 15 000 м: на сторінці надруковано −56,0 (у МСА −56,5)
];

/**
 * Атмосфера на висоті: рядок таблиці або інтерполяція між сусідніми рядками (interpolated = true): температура — лінійно,
 * тиск і щільність — за показниковим законом (лінійно за логарифмом). rough — вище 10 000 м рядки йдуть через 5000 м,
 * а між ними є злам температури (тропопауза), тому значення наближені.
 */
function atmosphereAt(hM) {
  if (!Number.isFinite(hM) || hM < ATMOSPHERE[0][0] || hM > ATMOSPHERE[ATMOSPHERE.length - 1][0]) return { ok: false };
  for (let i = 0; i < ATMOSPHERE.length; i++) {
    const r = ATMOSPHERE[i];
    if (r[0] === hM) return { ok: true, interpolated: false, rough: false, mmHg: r[1], tempC: r[2], density: r[3] };
    if (r[0] > hM) {
      const a = ATMOSPHERE[i - 1], k = (hM - a[0]) / (r[0] - a[0]);
      const geo = (x, y) => x * Math.pow(y / x, k);
      return { ok: true, interpolated: true, rough: a[0] >= 10000, from: a[0], to: r[0], mmHg: geo(a[1], r[1]), tempC: a[2] + (r[2] - a[2]) * k, density: geo(a[3], r[3]) };
    }
  }
  return { ok: false };
}

export { mod, signedAngle, triangle, windFromDrift, groundSpeed, speedByDistance, timeByDistance, mpr, turnRadiusKm, turnTimeSec, circuit, groundTrack, BIG_BOX, bigBoxBearings, bigBox, bigBoxTrack, PAD_DOC, padApproach, padTrack, DESCENT_MIN_LAST_W, DESCENT, headwindMs, crosswindMs, descent, UNITS, ATMOSPHERE, atmosphereAt };
