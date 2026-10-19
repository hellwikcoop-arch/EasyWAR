// Чиста логіка сцени стартового екрана «рука тягнеться до курсора»: зоряне поле з детермінованим
// генератором, поза двох рук за положенням курсора, згладжування руху, «дихання» в спокої і правило
// запуску. Без DOM і three.js, щоб перевіряти в node --test. Сцена й геометрія — у start-hand.js.
//
// Одиниці «вікна перегляду»: по вертикалі видно y ∈ [-1, 1], по горизонталі x ∈ [-aspect, aspect].
// Курсор приходить нормалізованим: x, y ∈ [-1, 1], y вгору.

export const HAND_SCENE = Object.freeze({
  seed: 20261019,
  starCount: 320,
  // Зорі лежать позаду рук, тому поле ширше за вікно (див. starField).
  starWidth: 8.4,
  starHeight: 4.0,
  starDepth: Object.freeze({ near: -1.4, far: -2.6 }),
  // «Плечі» рук за межами вікна: x у частках aspect, y — у одиницях вікна.
  anchors: Object.freeze({
    left: Object.freeze({ x: -1.18, y: 1.12 }),
    right: Object.freeze({ x: 1.18, y: -1.12 }),
  }),
  // Куди тягнуться руки, поки курсор невідомий або вийшов за вікно.
  restTarget: Object.freeze({ x: 0, y: 0.04 }),
  // Проміжок між кінчиком пальця і курсором: менший біля центру, більший у кутах.
  gapNear: 0.05,
  gapFar: 0.22,
  // Наскільки далі за центр вікна рука дотягується при повному витягуванні.
  overreach: 0.35,
  // Рука не ховається в плече: мінімальне витягування — частка максимального.
  minReachFraction: 0.5,
  // Кінчик пальця не виходить за край вікна ближче, ніж на цей відступ.
  edgeMargin: 0.06,
  // Згладжування руху за курсором: стала часу експоненційного фільтра, с.
  followTau: 0.24,
  // «Дихання» в спокої: період, с, і амплітуда зміщення кінчика (одиниці вікна) та згинання пальців.
  breathPeriod: 4.6,
  breathShift: 0.014,
  breathCurl: 0.035,
});

// Пропорції руки в її власних одиницях (одиниці вікна): зап'ястя в початку координат, пальці вздовж +X,
// тильна сторона долоні дивиться на камеру (+Z). Довжини фаланг — від основи до наступного суглоба.
export const HAND_SHAPE = Object.freeze({
  forearmLength: 2.4,
  forearmRadius: Object.freeze({ wrist: 0.085, elbow: 0.115 }),
  palmLength: 0.38,
  palmWidth: 0.4,
  palmThickness: 0.095,
  // Пальці від вказівного до мізинця; y — зміщення кісточки в частках ширини долоні від осі
  // (бік великого пальця додатний), spread — кут віяла пальців (рад) у той самий бік.
  fingers: Object.freeze({
    index: Object.freeze({ y: 0.39, spread: 0.13, phalanges: Object.freeze([0.18, 0.135, 0.105]), radius: Object.freeze([0.046, 0.041, 0.036]) }),
    middle: Object.freeze({ y: 0.13, spread: 0.03, phalanges: Object.freeze([0.195, 0.145, 0.11]), radius: Object.freeze([0.047, 0.042, 0.037]) }),
    ring: Object.freeze({ y: -0.13, spread: -0.06, phalanges: Object.freeze([0.18, 0.135, 0.105]), radius: Object.freeze([0.044, 0.039, 0.034]) }),
    pinky: Object.freeze({ y: -0.39, spread: -0.17, phalanges: Object.freeze([0.135, 0.105, 0.09]), radius: Object.freeze([0.038, 0.033, 0.029]) }),
  }),
  thumb: Object.freeze({
    base: Object.freeze({ x: 0.05, y: 0.42, z: -0.02 }),
    phalanges: Object.freeze([0.17, 0.14, 0.115]),
    radius: Object.freeze([0.06, 0.05, 0.043]),
    abduction: 0.8,
  }),
  // Максимальні кути згинання суглобів (рад) при curl = 1: кісточка, середній, дистальний.
  curlAngles: Object.freeze([1.15, 1.5, 0.95]),
  thumbCurlAngles: Object.freeze([0.35, 0.75, 0.7]),
});

// Поза «Створення Адама»: вказівний витягнутий, решта розслаблені й зігнуті тим більше, чим далі від
// вказівного. Права (суцільна) рука трохи млявіша. Значення curl — 0 (рівний) … 1 (у кулак).
export const HAND_POSES = Object.freeze({
  left: Object.freeze({ thumb: 0.3, index: 0.06, middle: 0.4, ring: 0.56, pinky: 0.68, pitch: 0.1, roll: -0.26 }),
  right: Object.freeze({ thumb: 0.34, index: 0.16, middle: 0.48, ring: 0.62, pinky: 0.72, pitch: 0.08, roll: 0.3 }),
});

// Довжина руки від зап'ястя до кінчика рівного вказівного пальця.
export function handLength(shape = HAND_SHAPE) {
  return shape.palmLength + shape.fingers.index.phalanges.reduce((sum, len) => sum + len, 0);
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Детермінований генератор (LCG як у ref-fx.js): одна й та сама картина зір при кожному запуску.
export function createRng(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Зоряне поле: позиції (x, y, z) у одиницях вікна, розмір, фаза й швидкість мерехтіння кожної зорі.
// Поле ширше за вікно, бо лежить позаду площини рук і при перспективі видно більшу область.
export function starField({
  count = HAND_SCENE.starCount,
  seed = HAND_SCENE.seed,
  width = HAND_SCENE.starWidth,
  height = HAND_SCENE.starHeight,
  depth = HAND_SCENE.starDepth,
} = {}) {
  const rng = createRng(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const tints = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (rng() - 0.5) * width;
    positions[i * 3 + 1] = (rng() - 0.5) * height;
    positions[i * 3 + 2] = lerp(depth.near, depth.far, rng());
    // Більшість зір дрібні, кілька помітніших.
    const r = rng();
    sizes[i] = r > 0.92 ? 2.6 : r > 0.7 ? 1.9 : 1.3;
    phases[i] = rng() * Math.PI * 2;
    speeds[i] = lerp(0.25, 0.8, rng());
    // Відтінок 0 — холодний білий, 1 — тепліший.
    tints[i] = rng();
  }
  return { count, positions, sizes, phases, speeds, tints };
}

// Яскравість зорі 0.45…1: повільна синусоїда зі своєю фазою й швидкістю.
export function starBrightness(phase, speed, timeSec) {
  return 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(phase + speed * timeSec));
}

// Експоненційне згладжування: за час tau проходиться ≈63 % шляху до цілі. Стійке до великих dt.
export function smoothTowards(current, target, dtSec, tau = HAND_SCENE.followTau) {
  if (!(dtSec > 0)) return current;
  const k = 1 - Math.exp(-dtSec / tau);
  return current + (target - current) * k;
}

// Положення вказівника у вікні → нормалізований курсор [-1, 1]², y вгору.
export function pointerToCursor({ clientX, clientY, width, height }) {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  return {
    x: clamp((clientX / width) * 2 - 1, -1, 1),
    y: clamp(1 - (clientY / height) * 2, -1, 1),
  };
}

// Близькість курсора до центру вікна: 1 у центрі, 0 у кутах.
export function cursorProximity(cursor) {
  return 1 - clamp(Math.hypot(cursor.x, cursor.y) / Math.SQRT2, 0, 1);
}

// Зміщення «дихання»: повільна синусоїда зі своєю фазою для кожної руки.
export function breath(timeSec, phase = 0, plan = HAND_SCENE) {
  const w = Math.sin((timeSec / plan.breathPeriod) * Math.PI * 2 + phase);
  return { shift: w * plan.breathShift, curl: w * plan.breathCurl };
}

// Поза однієї руки за курсором. side: 'left' (каркасна, з верхнього лівого кута) або 'right'
// (суцільна, з нижнього правого). Повертає кінчик вказівного пальця й зап'ястя в одиницях вікна,
// напрямок руки (рад), ступінь витягування 0…1 і згинання кожного пальця 0…1.
export function handPose({ cursor, aspect = 16 / 9, side = 'left', timeSec = 0, plan = HAND_SCENE, shape = HAND_SHAPE, poses = HAND_POSES }) {
  const a = Math.max(0.2, aspect);
  const anchorPlan = plan.anchors[side] || plan.anchors.left;
  const anchor = { x: anchorPlan.x * a, y: anchorPlan.y };
  const c = cursor || plan.restTarget;
  const target = { x: clamp(c.x, -1, 1) * a, y: clamp(c.y, -1, 1) };
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const dir = { x: dx / dist, y: dy / dist };
  const angle = Math.atan2(dir.y, dir.x);

  const proximity = cursorProximity({ x: clamp(c.x, -1, 1), y: clamp(c.y, -1, 1) });
  const gap = lerp(plan.gapFar, plan.gapNear, proximity);
  const maxReach = Math.hypot(anchor.x, anchor.y) + plan.overreach;
  const minReach = maxReach * plan.minReachFraction;
  const extension = clamp(dist - gap, minReach, maxReach);
  const reach = (extension - minReach) / (maxReach - minReach);

  const phase = side === 'left' ? 0 : 1.9;
  const b = breath(timeSec, phase, plan);
  // Дихання: легке зміщення поперек напрямку руки і трохи вздовж нього.
  const m = plan.edgeMargin;
  const tip = {
    x: clamp(anchor.x + dir.x * extension - dir.y * b.shift + dir.x * b.shift * 0.5, -a + m, a - m),
    y: clamp(anchor.y + dir.y * extension + dir.x * b.shift + dir.y * b.shift * 0.5, -1 + m, 1 - m),
  };
  const length = handLength(shape);
  const wrist = { x: tip.x - dir.x * length, y: tip.y - dir.y * length };

  const pose = poses[side] || poses.left;
  // Чим менше рука витягнута, тим більше розслаблені пальці (крім вказівного, який веде рух).
  const relax = (1 - reach) * 0.14;
  const curl = (base, extra) => clamp(base + extra + b.curl, 0, 1);
  const curls = {
    thumb: curl(pose.thumb, relax * 0.5),
    index: curl(pose.index, (1 - reach) * 0.05),
    middle: curl(pose.middle, relax),
    ring: curl(pose.ring, relax),
    pinky: curl(pose.pinky, relax),
  };
  return { side, anchor, target, dir, angle, dist, gap, extension, reach, tip, wrist, curls, pitch: pose.pitch, roll: pose.roll };
}

// Режим сцени: без WebGL її немає зовсім; при «менше руху» — один нерухомий кадр; інакше — жива.
export function handSceneMode({ reducedMotion = false, webgl = true } = {}) {
  if (!webgl) return 'none';
  return reducedMotion ? 'static' : 'live';
}

export function shouldRunHandScene(options = {}) {
  return handSceneMode(options) !== 'none';
}
