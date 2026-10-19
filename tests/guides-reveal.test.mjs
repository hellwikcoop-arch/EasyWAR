// Презентація в довіднику авіації (src/guides/aviation/reveal-core.js): карта висот корпусу, тканина-чохол,
// міра зняття чохла, профіль зльоту й розпізнавальний знак. Усе без DOM і three; сцену (reveal.js) перевіряють у браузері.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  makeHull, rasterTriangle, finishHull, hullAt, hullGrad, footprint,
  makeCloth, stepCloth, overFootprint, revealProgress, clothMeanY, handleIndex,
  liftPose, LIFT, drawRoundel, MARK_SPOTS, MARK, PULL_DONE, TIMING, PHASES,
} from '../src/guides/aviation/reveal-core.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Коробка 2×2 заввишки 1 посередині сітки 4×4: два трикутники даху.
function boxHull() {
  const hull = makeHull(0, 4, 0, 4, 81, 81, 0);
  rasterTriangle(hull, 1, 1, 1, 3, 1, 1, 3, 1, 3);
  rasterTriangle(hull, 1, 1, 1, 3, 1, 3, 1, 1, 3);
  return finishHull(hull, { dilate: 1, blur: 0 });
}

test('карта висот: дах коробки має висоту 1, навколо — підлога, слід збігається з коробкою', () => {
  const hull = boxHull();
  assert.equal(hull.max, 1);
  assert.equal(hullAt(hull, 2, 2), 1);
  assert.equal(hullAt(hull, 0.2, 0.2), 0);
  assert.equal(hullAt(hull, 9, 9), 0, 'поза сіткою — підлога');
  const fp = footprint(hull, 0.5);
  assert.ok(Math.abs(fp.minX - 1) <= 0.06 && Math.abs(fp.maxX - 3) <= 0.06 && Math.abs(fp.minZ - 1) <= 0.06 && Math.abs(fp.maxZ - 3) <= 0.06, JSON.stringify(fp));
  const [gx] = hullGrad(hull, fp.minX, 2);
  assert.ok(gx > 2, `край коробки крутий: ${gx}`);
  const [gx2, gz2] = hullGrad(hull, 2, 2);
  assert.equal(gx2, 0); assert.equal(gz2, 0);
});

test('дрібний трикутник, менший за клітинку, не губиться: вершини ставлять свою висоту', () => {
  const hull = makeHull(0, 4, 0, 4, 9, 9, 0);
  rasterTriangle(hull, 2.01, 0.7, 2.01, 2.02, 0.7, 2.01, 2.01, 0.7, 2.02);
  finishHull(hull, { dilate: 0, blur: 0 });
  assert.ok(Math.abs(hullAt(hull, 2, 2) - 0.7) < 1e-6);
});

test('чохол осідає на коробку: над дахом лежить на ньому, за краями падає на підлогу, вниз крізь корпус не провалюється', () => {
  const hull = boxHull();
  const cloth = makeCloth({ cols: 25, rows: 17, x0: 0.5, x1: 3.5, z0: 0.2, z1: 3.8, y: 1.4 });
  const y0 = clothMeanY(cloth);
  for (let i = 0; i < 360; i += 1) stepCloth(cloth, { dt: 1 / 120, hull, floorY: 0 });
  assert.ok(clothMeanY(cloth) < y0, 'тканина опустилася');
  let below = 0;
  for (let i = 0; i < cloth.n; i += 1) {
    const x = cloth.pos[i * 3], y = cloth.pos[i * 3 + 1], z = cloth.pos[i * 3 + 2];
    if (y < hullAt(hull, x, z) - 0.02) below += 1;
    assert.ok(y >= 0.017 - 1e-6, 'не нижче підлоги');
  }
  assert.equal(below, 0, 'жодна частинка не під поверхнею корпусу');
  const centre = handleIndex(cloth) - (cloth.cols - 1) + Math.floor(cloth.cols / 2); // середина середнього ряду
  assert.ok(Math.abs(cloth.pos[centre * 3 + 1] - 1.035) < 0.05, `над дахом: ${cloth.pos[centre * 3 + 1]}`);
  // середина переднього краю звисає з борту майже до підлоги; кут складається «вушком» і висить вище
  const edge = Math.floor(cloth.cols / 2);
  assert.ok(cloth.pos[edge * 3 + 1] < 0.4, `край звисає: ${cloth.pos[edge * 3 + 1]}`);
  assert.ok(cloth.pos[1] < 0.8, `кут опустився: ${cloth.pos[1]}`);
});

test('ручку тягнуть убік — чохол сходить із корпусу, міра зняття росте до порога, а після дотягування — майже до 1', () => {
  const hull = boxHull();
  const cloth = makeCloth({ cols: 25, rows: 17, x0: 0.5, x1: 3.5, z0: 0.2, z1: 3.8, y: 1.4 });
  for (let i = 0; i < 300; i += 1) stepCloth(cloth, { dt: 1 / 120, hull, floorY: 0 });
  const fp = footprint(hull, 0.5);
  cloth.over0 = overFootprint(cloth, fp);
  assert.ok(cloth.over0 > 100);
  assert.equal(revealProgress(cloth, fp), 0);
  const h = handleIndex(cloth);
  cloth.pinned = h;
  cloth.pin = [cloth.pos[h * 3], Math.max(0.25, cloth.pos[h * 3 + 1]), cloth.pos[h * 3 + 2]];
  let reached = false;
  for (let i = 0; i < 900 && !reached; i += 1) {
    cloth.pin[0] += 0.012; // ≈1,4 од./с уздовж +x
    stepCloth(cloth, { dt: 1 / 120, hull, floorY: 0 });
    if (revealProgress(cloth, fp) >= PULL_DONE) reached = true;
  }
  assert.ok(reached, 'досягли порога дотягування');
  cloth.pinned = -1;
  for (let i = 0; i < 480; i += 1) stepCloth(cloth, { dt: 1 / 120, hull, floorY: 0, pull: { dir: [1, 0], strength: 9, c0: cloth.cols - 12, c1: cloth.cols - 1 } });
  assert.ok(revealProgress(cloth, fp) > 0.9, `дотягнуто: ${revealProgress(cloth, fp)}`);
  assert.ok(clothMeanY(cloth) < 0.3, 'чохол лежить на підлозі');
});

test('зліт: спершу підйом на місці, потім розгін уперед із набором висоти; закінчується за межею або за часом', () => {
  const p0 = liftPose(0);
  assert.deepEqual([p0.x, p0.y, p0.done], [0, 0, false]);
  let prev = liftPose(0.01);
  for (let t = 0.05; t < LIFT.endT + 2; t += 0.05) {
    const p = liftPose(t);
    assert.ok(p.y >= prev.y - 1e-9, `висота не падає (t=${t.toFixed(2)})`);
    assert.ok(p.x >= prev.x - 1e-9, `рух лише вперед (t=${t.toFixed(2)})`);
    assert.ok(p.pitch > -8.5 * Math.PI / 180 && p.pitch < 3 * Math.PI / 180, 'тангаж у межах');
    assert.ok(Math.abs(p.bank) < 3.5 * Math.PI / 180, 'крен малий');
    if (t < LIFT.hoverT) assert.equal(p.x, 0, 'до розгону стоїть на місці');
    prev = p;
  }
  assert.equal(liftPose(LIFT.hoverT * 0.999).x, 0);
  assert.ok(liftPose(LIFT.endT + 1).done);
  assert.ok(prev.v <= LIFT.vmax + 1e-9);
});

test('розпізнавальний знак: коло, кільце й тризуб жовтим на синьому; місця знаків лежать у межах текстури 2048', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); } });
  // властивості-присвоєння (fillStyle тощо) проксі теж приймає
  const proxy = new Proxy({}, {
    get: (_, name) => (...args) => { calls.push([String(name), ...args]); },
    set: (_, name, value) => { calls.push(['set', String(name), value]); return true; },
  });
  drawRoundel(proxy, 100, 200, 50);
  const names = calls.map((c) => c[0]);
  assert.equal(names.filter((n) => n === 'save').length, names.filter((n) => n === 'restore').length);
  assert.ok(names.filter((n) => n === 'arc').length >= 2, 'поле й кільце');
  assert.ok(names.filter((n) => n === 'fill').length >= 4, 'поле, зубці й основа');
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === MARK.blue));
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === MARK.yellow));
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === MARK.yellow));
  const arc = calls.find((c) => c[0] === 'arc');
  assert.deepEqual(arc.slice(1, 4), [100, 200, 50]);
  for (const [cx, cy, r] of MARK_SPOTS) assert.ok(cx - r >= 0 && cy - r >= 0 && cx + r <= 2048 && cy + r <= 2048);
  assert.ok(ctx);
});

test('стаття «Мі-8 (ЗСУ)» показує файл Мі-8ТВ, має знак і презентацію; кнопка є на сторінці; модуль не ходить у мережу', async () => {
  const main = await read('src/guides/aviation/main.js');
  assert.match(main, /\{id:'mi8ua',model:'mi8tv',mark:'ua',reveal:true,cat:'other'/);
  assert.match(main, /MODEL_URLS\[t\.model\|\|t\.id\]/, 'файл береться за псевдонімом');
  assert.doesNotMatch(main, /FLYD\[t\.id\]|RIG\[t\.id\]/, 'дані польоту й частин — теж за псевдонімом');
  assert.match(main, /creditHtml\('aviation\/'\+\(t\.model\|\|t\.id\)\)/, 'підпис авторства — від файлу');
  assert.match(main, /if\(t\.mark==='ua'\)markUA\(inner\);/);
  assert.match(main, /if\(reveal\.on\)reveal\.step\(dt\);/);
  const html = await read('src/guides/aviation/index.html');
  assert.match(html, /<button class="vb" id="t-reveal" aria-pressed="false"[^>]*hidden>Презентація<\/button>/);
  const reveal = await read('src/guides/aviation/reveal.js');
  for (const bad of [/fetch\(/, /XMLHttpRequest/, /WebSocket/, /https?:\/\//, /innerHTML/, /localStorage/]) assert.doesNotMatch(reveal, bad, String(bad));
  assert.match(reveal, /from 'three\/addons\/objects\/Reflector\.js'/);
  assert.deepEqual(PHASES.slice(0, 2), ['cover', 'pull']);
  assert.ok(TIMING.settleS > 0 && TIMING.fadeS > 0);
});
