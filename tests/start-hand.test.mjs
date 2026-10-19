import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  HAND_POSES,
  HAND_SCENE,
  HAND_SHAPE,
  breath,
  createRng,
  cursorProximity,
  handLength,
  handPose,
  handSceneMode,
  pointerToCursor,
  shouldRunHandScene,
  smoothTowards,
  starBrightness,
  starField,
} from '../src/start-hand-core.js';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const ASPECTS = [4 / 3, 16 / 10, 16 / 9, 21 / 9];
const CURSORS = [];
for (let x = -1; x <= 1.001; x += 0.25) for (let y = -1; y <= 1.001; y += 0.25) CURSORS.push({ x, y });

test('зорі детерміновані: той самий seed дає те саме поле, інший — інше', () => {
  const a = starField();
  const b = starField();
  assert.equal(a.count, HAND_SCENE.starCount);
  assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
  assert.deepEqual(Array.from(a.phases), Array.from(b.phases));
  const c = starField({ seed: HAND_SCENE.seed + 1 });
  assert.notDeepEqual(Array.from(a.positions), Array.from(c.positions));
  const rng = createRng(7);
  const first = [rng(), rng(), rng()];
  const rng2 = createRng(7);
  assert.deepEqual(first, [rng2(), rng2(), rng2()]);
  for (const v of first) assert.ok(v >= 0 && v < 1);
});

test('зорі лежать у своєму полі позаду рук, кількох сотень вистачає, мерехтіння повільне й обмежене', () => {
  const s = starField();
  assert.ok(s.count >= 200 && s.count <= 600, 'кілька сотень точок');
  for (let i = 0; i < s.count; i += 1) {
    assert.ok(Math.abs(s.positions[i * 3]) <= HAND_SCENE.starWidth / 2);
    assert.ok(Math.abs(s.positions[i * 3 + 1]) <= HAND_SCENE.starHeight / 2);
    const z = s.positions[i * 3 + 2];
    assert.ok(z <= HAND_SCENE.starDepth.near && z >= HAND_SCENE.starDepth.far, 'зоря позаду площини рук');
    assert.ok(s.speeds[i] > 0 && s.speeds[i] < 1, 'повільне мерехтіння');
    assert.ok(s.sizes[i] > 0 && s.sizes[i] <= 3);
  }
  for (let t = 0; t < 30; t += 0.37) {
    const b = starBrightness(1.2, 0.5, t);
    assert.ok(b >= 0.45 && b <= 1, `яскравість ${b} у межах`);
  }
  assert.ok(Math.abs(starBrightness(0, 0.5, 0) - starBrightness(0, 0.5, 2 * Math.PI / 0.5)) < 1e-9, 'періодичне');
});

test('кінчики пальців обох рук завжди всередині вікна', () => {
  for (const aspect of ASPECTS) {
    for (const cursor of CURSORS) {
      for (const side of ['left', 'right']) {
        for (const timeSec of [0, 1.1, 2.3, 3.45]) {
          const p = handPose({ cursor, aspect, side, timeSec });
          assert.ok(Math.abs(p.tip.x) <= aspect && Math.abs(p.tip.y) <= 1, `${side} tip (${p.tip.x}, ${p.tip.y}) aspect ${aspect} cursor ${JSON.stringify(cursor)}`);
          assert.ok(Number.isFinite(p.angle) && Number.isFinite(p.wrist.x) && Number.isFinite(p.wrist.y));
          assert.ok(Math.abs(Math.hypot(p.tip.x - p.wrist.x, p.tip.y - p.wrist.y) - handLength()) < 1e-9, 'зап\'ястя на довжину руки від кінчика');
          for (const v of Object.values(p.curls)) assert.ok(v >= 0 && v <= 1, 'curl у межах 0…1');
          assert.ok(p.reach >= 0 && p.reach <= 1);
        }
      }
    }
  }
});

test('рука тягнеться далі, коли курсор далі від її плеча, і підходить ближче до курсора біля центру', () => {
  const aspect = 16 / 9;
  // Ліва рука: курсор іде від верхнього лівого кута до нижнього правого.
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const cursor = { x: -1 + 2 * t, y: 1 - 2 * t };
    const p = handPose({ cursor, aspect, side: 'left' });
    assert.ok(p.reach >= prev - 1e-9, `reach не спадає (t=${t.toFixed(2)}: ${p.reach} < ${prev})`);
    prev = p.reach;
  }
  // Права рука: від нижнього правого кута до верхнього лівого.
  prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const cursor = { x: 1 - 2 * t, y: -1 + 2 * t };
    const p = handPose({ cursor, aspect, side: 'right' });
    assert.ok(p.reach >= prev - 1e-9, `reach не спадає (t=${t.toFixed(2)})`);
    prev = p.reach;
  }
  const centre = handPose({ cursor: { x: 0, y: 0 }, aspect, side: 'left' });
  const corner = handPose({ cursor: { x: 1, y: -1 }, aspect, side: 'left' });
  assert.ok(centre.gap < corner.gap, 'біля центру проміжок менший');
  assert.ok(Math.abs(centre.gap - HAND_SCENE.gapNear) < 1e-9);
  assert.ok(Math.abs(corner.gap - HAND_SCENE.gapFar) < 1e-9);
  assert.equal(cursorProximity({ x: 0, y: 0 }), 1);
  assert.equal(cursorProximity({ x: 1, y: 1 }), 0);
  // Біля центру кінчики обох рук стоять по різні боки курсора, не перетинаючись.
  const right = handPose({ cursor: { x: 0, y: 0 }, aspect, side: 'right' });
  assert.ok(centre.tip.x < 0 && right.tip.x > 0, 'ліва рука зліва від курсора, права — справа');
  assert.ok(Math.hypot(centre.tip.x - right.tip.x, centre.tip.y - right.tip.y) < 0.2, 'пальці майже торкаються');
});

test('поза «Створення Адама»: вказівний витягнутий, решта зігнуті сильніше, у спокої пальці розслаблені', () => {
  for (const side of ['left', 'right']) {
    const p = handPose({ cursor: { x: 0, y: 0 }, aspect: 16 / 9, side });
    assert.ok(p.curls.index < 0.25, `${side}: вказівний майже рівний`);
    assert.ok(p.curls.index < p.curls.middle && p.curls.middle < p.curls.ring && p.curls.ring < p.curls.pinky, `${side}: пальці зігнуті по наростанню`);
    const far = handPose({ cursor: side === 'left' ? { x: -1, y: 1 } : { x: 1, y: -1 }, aspect: 16 / 9, side });
    assert.ok(far.curls.middle > p.curls.middle, `${side}: не витягнута рука розслабленіша`);
  }
  assert.ok(HAND_POSES.left.pitch > 0 && HAND_POSES.right.pitch > 0, 'кінчик пальця подається до камери');
  const b0 = breath(0);
  const b1 = breath(HAND_SCENE.breathPeriod / 4);
  assert.ok(Math.abs(b0.shift) < 1e-9 && b1.shift > 0 && b1.shift <= HAND_SCENE.breathShift, 'дихання — обмежена синусоїда');
  assert.equal(handLength(), HAND_SHAPE.palmLength + HAND_SHAPE.fingers.index.phalanges.reduce((s, v) => s + v, 0));
});

test('згладжування наближає до цілі, не перестрибує і не рухається без часу', () => {
  assert.equal(smoothTowards(0, 1, 0), 0);
  assert.equal(smoothTowards(0, 1, -1), 0);
  let v = 0;
  for (let i = 0; i < 60; i += 1) {
    const next = smoothTowards(v, 1, 1 / 60);
    assert.ok(next > v && next <= 1);
    v = next;
  }
  assert.ok(v > 0.9, 'за секунду майже на місці');
  assert.ok(Math.abs(smoothTowards(0, 1, HAND_SCENE.followTau) - (1 - Math.exp(-1))) < 1e-9);
  assert.equal(pointerToCursor({ clientX: 400, clientY: 300, width: 800, height: 600 }).x, 0);
  assert.equal(pointerToCursor({ clientX: 400, clientY: 300, width: 800, height: 600 }).y, 0);
  assert.deepEqual(pointerToCursor({ clientX: 0, clientY: 0, width: 800, height: 600 }), { x: -1, y: 1 });
  assert.deepEqual(pointerToCursor({ clientX: 800, clientY: 600, width: 800, height: 600 }), { x: 1, y: -1 });
  assert.deepEqual(pointerToCursor({ clientX: 10, clientY: 10, width: 0, height: 0 }), { x: 0, y: 0 });
});

test('без WebGL сцени немає, при «менше руху» — один нерухомий кадр', () => {
  assert.equal(handSceneMode({ webgl: false }), 'none');
  assert.equal(handSceneMode({ webgl: false, reducedMotion: true }), 'none');
  assert.equal(handSceneMode({ webgl: true, reducedMotion: true }), 'static');
  assert.equal(handSceneMode({ webgl: true, reducedMotion: false }), 'live');
  assert.equal(handSceneMode(), 'live');
  assert.equal(shouldRunHandScene({ webgl: false }), false);
  assert.equal(shouldRunHandScene({ reducedMotion: true }), true);
});

test('index.html підключає start-hand.js один раз, після launcher-tools.js', async () => {
  const html = await read('index.html');
  const tag = '<script type="module" src="./start-hand.js"></script>';
  assert.equal(html.split(tag).length - 1, 1, 'рівно один тег');
  assert.equal(html.split('start-hand.js').length - 1, 1, 'жодних інших згадок');
  assert.ok(html.indexOf(tag) > html.indexOf('<script type="module" src="./launcher-tools.js">'), 'після launcher-tools.js');
  assert.ok(html.indexOf(tag) < html.indexOf('<script type="module" src="./startup-splash.js">'), 'заставка лишається останньою');
});

test('модуль сцени локальний: без мережі, сховища, innerHTML і eval; поважає «менше руху» й відсутність WebGL', async () => {
  const js = await read('start-hand.js');
  const core = await read('start-hand-core.js');
  const css = await read('start-hand.css');
  for (const [name, source] of [['start-hand.js', js], ['start-hand-core.js', core]]) {
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket)\b/, `${name}: без мережі`);
    assert.doesNotMatch(source, /https?:\/\//, `${name}: без адрес`);
    assert.doesNotMatch(source, /innerHTML|localStorage|sessionStorage|indexedDB/, `${name}: без розмітки з рядків і сховищ`);
    assert.doesNotMatch(source, /\beval\b|new Function/, `${name}: без eval`);
  }
  assert.doesNotMatch(core, /\b(document|window|requestAnimationFrame)\b/, 'ядро без DOM');
  assert.match(js, /import '\.\/start-hand\.css'/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /handSceneMode\(\{ reducedMotion: reduced, webgl: hasWebGL\(\) \}\)/);
  assert.match(js, /canvas\.className = 'ew-hand'/);
  assert.match(js, /start\.prepend\(canvas\)/, 'полотно — перший елемент стартового екрана');
  assert.match(js, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/, 'devicePixelRatio не більше 2');
  assert.match(js, /document\.hidden/, 'спить у схованій вкладці');
  assert.match(js, /start\.style\.display !== 'none'/, 'спить, коли відкрито модуль');
  assert.match(js, /addEventListener\('pointermove'/);
  assert.doesNotMatch(js, /console\./, 'без логів');
  assert.match(css, /#view-start > canvas\.ew-hand\s*\{[^}]*pointer-events: none/);
  assert.match(css, /#view-start > canvas\.ew-hand\s*\{[^}]*z-index: -1/);
});
