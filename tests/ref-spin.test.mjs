// Обертові частини моделей «Інтерактивної моделі» (ref-spin.js, таблиця SPINS у ref-rig-data.js): несні й хвостові гвинти вертольотів,
// повітряні гвинти й колеса літаків вирізано з мешів справжніх моделей і чіпляють до власних осей. Модель у спокої має виглядати як у файлі
// до вершини; гвинти крутяться за обертами двигуна, лопаті несного гвинта піднімаються з провису, колесо крутиться за шляхом по землі,
// а сцена (ref-sim.js) веде все це по фазах. Спершу — синтетична іграшка (швидко, видно кожну деталь), далі — усі вісім справжніх моделей.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENTRIES, viewerOf } from '../src/ref-data.js';
import { SPINS } from '../src/ref-rig-data.js';
import { simOf } from '../src/ref-sim-data.js';
import { loadGlbScene } from './helpers/glb-scene.mjs';
import { unmatched, vertices } from './helpers/mesh-compare.mjs';

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { SPIN_RATE, WHEEL_MAX, blurTexture, bladeStats, buildSpinRig, fromPlane } = await import('../src/ref-spin.js');
const { Sim } = await import('../src/ref-sim.js');
const { normalizeAircraft } = await import('../src/ref-viewer.js');

const D2R = Math.PI / 180, TAU = Math.PI * 2;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const box = (w, h, d, x, y, z) => new BoxGeometry(w, h, d).translate(x, y, z);
const tyre = (r, w, x, y, z) => new CylinderGeometry(r, r, w, 24).rotateX(Math.PI / 2).translate(x, y, z); // вісь вздовж z

// ---------- синтетична іграшка ----------
// Корпус, мачта, маточина, чотири лопаті (одна провисла на 8°), хвостовий гвинт збоку, два колеса й стійка між ними — одним мешем, як і в справжніх моделях.
function toy() {
  const droop = box(3, .04, .25, 1.5, 0, 0).rotateZ(-8 * D2R).translate(.6, 1.2, 0);
  const geo = mergeGeometries([
    box(4, 1, 1, 0, 0, 0), box(.3, .5, .3, 0, .75, 0), box(.5, .2, .5, 0, 1.2, 0),
    droop, box(.25, .04, 3, 0, 1.2, 2.1), box(3, .04, .25, -2.1, 1.2, 0), box(.25, .04, 3, 0, 1.2, -2.1),
    box(.2, .2, .2, -2.2, .6, .62), box(.1, .7, .03, -2.2, 1.15, .62), box(.1, .7, .03, -2.2, .05, .62),
    tyre(.25, .15, .6, -.6, .55), tyre(.25, .15, .6, -.6, -.55), box(.05, .5, .05, .6, -.3, .55),
  ]);
  const scene = new Group(), mesh = new Mesh(geo, new MeshBasicMaterial());
  scene.add(mesh);
  return scene;
}
const TOY = {
  nose: '+x',
  parts: [
    { id: 'main', kind: 'rotor', axis: 'y', c: [0, 0], band: [.7, 1.3], r: 3.7, dir: -1, rate: 21 }, // смуга низька: провисла лопать опускається під маточину
    { id: 'tail', kind: 'rotor', axis: 'z', c: [-2.2, .6], band: [.55, .7], r: 1, dir: 1, rate: 42, flap: false, blur: .17 },
    { id: 'gear', kind: 'wheels', axis: 'z', box: [.2, -1, -.8, 1, -.2, .8], tris: [20, 200] },
  ],
};
const part = (rig, id) => rig.parts.find(p => p.id === id);
const SPIN_AXES = { x: [1, 2], y: [0, 2], z: [0, 1] }; // які координати точки лежать у площині гвинта (u, v)
// Куди зсунулась верхня точка колеса (вздовж напрямку вперед nose): додатне число — колесо котиться вперед.
const topMoves = (w, nose) => {
  const c = new Vector3(...w.pivot), top = new Vector3(0, w.r, 0);
  return top.clone().applyEuler(w.group.rotation).sub(top).dot(nose);
};
// Висота тіла за його вершинами (точна межа: коробка нахиленого тіла вдвічі більша за нього самого).
const yExtent = group => { const b = new Box3().setFromObject(group, true); return b.max.y - b.min.y; };
// Різниця кутів по колу, від −π до π: кут гвинта обгортається за 2π, тож порівнювати голі значення не можна.
const turn = (to, from) => ((to - from + Math.PI * 3) % TAU) - Math.PI;

test('geometry helpers: a point of the rotor plane goes back to the scene frame, and a blade tells its root, tip and droop', () => {
  assert.deepEqual(fromPlane('y', 1, 2, 3), [1, 3, 2]);
  assert.deepEqual(fromPlane('x', 1, 2, 3), [3, 1, 2]);
  assert.deepEqual(fromPlane('z', 1, 2, 3), [1, 2, 3]);
  // Лопать від радіуса 1 до 4 уздовж +x, кінець нижче кореня на 0,3 (провис): axis y — вертикаль, hub — центр гвинта.
  const verts = [];
  for (let r = 1; r <= 4; r += .25) verts.push(r, 5 - .3 * (r - 1) / 3, 0);
  const s = bladeStats(verts, [0, 0], 'y');
  assert.ok(near(s.rootR, 1) && near(s.tipR, 4));
  assert.ok(s.rootAxial > s.tipAxial && Math.abs(s.d[0] - 1) < 1e-6 && Math.abs(s.d[1]) < 1e-6);
  assert.ok(s.rest < 0 && Math.abs(s.rest - Math.atan2(-.3, 3)) < .02, 'a drooped blade has a negative elevation angle');
  // Те саме для гвинта з віссю вздовж z: площина (x, y), осьова координата — z.
  const side = [];
  for (let r = 1; r <= 4; r += .25) side.push(0, r, 5 + .3 * (r - 1) / 3);
  const t = bladeStats(side, [0, 0], 'z');
  assert.ok(t.rest > 0 && Math.abs(t.d[1] - 1) < 1e-6);
  assert.ok(SPIN_RATE.rotor < SPIN_RATE.tail && WHEEL_MAX > 10);
});

test('the toy helicopter: the blades, the hubs and the wheels are carved out and the model stands as in the file', () => {
  const scene = toy();
  scene.updateMatrixWorld(true);
  const before = vertices(scene), why = [];
  const rig = buildSpinRig(scene, TOY, why);
  assert.deepEqual(why, []);
  assert.ok(rig);
  const main = part(rig, 'main'), tail = part(rig, 'tail');
  assert.equal(main.blades.length, 4, 'four separate blades that flap');
  assert.equal(main.n, 4);
  assert.equal(tail.blades.length, 0, 'the tail rotor turns as one piece');
  assert.equal(tail.n, 3, 'two blades are fewer than three: the usual spacing is taken');
  assert.deepEqual(rig.wheels.map(w => w.id), ['gear', 'gear'], 'two tyres, the strut between them is not a wheel');
  assert.ok(rig.wheels.every(w => near(w.r, .25, 1e-3)));
  // Вісь гвинта лежить на осі маточини, на середині лопатей.
  assert.ok(near(main.pivot[0], 0, 1e-3) && near(main.pivot[2], 0, 1e-3) && near(main.pivot[1], 1.2, .08)); // висота — середня по лопатях, а одна з них провисла
  assert.ok(near(tail.pivot[0], -2.2, 1e-3) && near(tail.pivot[1], .6, 1e-3));
  const after = vertices(scene);
  assert.equal(unmatched(after, before), 0, 'every vertex is where it was');
  assert.equal(unmatched(before, after), 0, 'and none is missing');
  assert.equal(after.length, before.length);
  assert.ok(main.blades.some(b => b.rest < -7 * D2R && b.rest > -9 * D2R), 'the drooped blade is measured at about −8°');
  assert.ok(main.blades.filter(b => Math.abs(b.rest) < .5 * D2R).length === 3, 'the other three are flat');
  // Нічого з тулуба, мачти й хвоста не потрапило у гвинт: у групі гвинта лише його тіла.
  let tris = 0; main.group.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  assert.equal(tris, 12 * 5, 'the hub and four blades are boxes of 12 triangles each');
});

test('the rotor turns at the rate of its engine, in its own direction, and stops when the engine stops', () => {
  const rig = buildSpinRig(toy(), TOY);
  const main = part(rig, 'main'), tail = part(rig, 'tail');
  rig.step(.001, { rpm: 0 });
  assert.equal(main.angle, 0, 'no engine, no turning');
  rig.step(.002, { rpm: 1 });
  assert.ok(near(main.angle, -SPIN_RATE.rotor * .002, 1e-9), 'the main rotor turns clockwise seen from above (negative about y)');
  assert.ok(near(tail.angle, 42 * .002, 1e-9), 'the tail rotor has its own rate and direction');
  assert.ok(near(main.group.rotation.y, main.angle) && near(tail.group.rotation.z, tail.angle), 'the group turns about its own axis');
  const a = main.angle;
  rig.step(.002, { rpm: .5 });
  assert.ok(near(main.angle - a, -SPIN_RATE.rotor * .5 * .002, 1e-9), 'half the revolutions, half the rate');
  const frozen = main.angle;
  rig.step(1, { rpm: 0 });
  assert.equal(main.angle, frozen);
});

test('a slow frame does not make the rotor look as if it stands or turns back', () => {
  const rig = buildSpinRig(toy(), TOY);
  const main = part(rig, 'main'), tail = part(rig, 'tail');
  const limit = n => TAU / n * .4;
  for (const dt of [1 / 60, 1 / 30, .05, .1]) {
    const a = main.angle, b = tail.angle;
    rig.step(dt, { rpm: 1 });
    const da = turn(main.angle, a), db = turn(tail.angle, b);
    assert.ok(Math.abs(da) <= limit(main.n) + 1e-9 && Math.abs(da) <= SPIN_RATE.rotor * dt + 1e-9, `main, dt ${dt}: ${da}`);
    assert.ok(Math.abs(db) <= limit(tail.n) + 1e-9 && Math.abs(db) <= 42 * dt + 1e-9, `tail, dt ${dt}: ${db}`);
    assert.ok(da < 0 && db > 0, 'always the same direction');
  }
  const a = main.angle;
  rig.step(.05, { rpm: 1 });
  assert.ok(near(-turn(main.angle, a), limit(4)), 'at 20 frames a second the step between blades is capped');
  rig.step(.001, { rpm: 1 });
  assert.ok(near(-turn(main.angle, a) - limit(4), SPIN_RATE.rotor * .001, 1e-9), 'and a fast frame rate is not touched by the cap');
});

test('blades lift from their droop to the coning when the rotor spins up, and fall back as it stops', () => {
  const rig = buildSpinRig(toy(), TOY);
  const main = part(rig, 'main');
  const drooped = main.blades.find(b => b.rest < -7 * D2R), flat = main.blades.find(b => Math.abs(b.rest) < D2R);
  const rest = yExtent(drooped.holder), restFlat = yExtent(flat.holder);
  assert.ok(rest > .4 && restFlat < .1, `at rest the droop is ${rest.toFixed(2)} high against ${restFlat.toFixed(2)}`);
  for (let i = 0; i < 120; i++) rig.step(1 / 60, { rpm: 1 });
  const flight = yExtent(drooped.holder);
  assert.ok(flight < .25, 'at full revolutions the blade is nearly flat, coned by a degree or two');
  assert.ok(flight < rest && yExtent(flat.holder) < .25);
  // Лопать, що ще розкручується, лежить десь між провисом і польотом; без обертів вона знову як у файлі.
  rig.reset();
  rig.step(.001, { rpm: .2 });
  const mid = yExtent(drooped.holder);
  assert.ok(mid < rest && mid > flight, `${flight.toFixed(2)} < ${mid.toFixed(2)} < ${rest.toFixed(2)}`);
  rig.reset();
  assert.ok(near(yExtent(drooped.holder), rest, 1e-9));
  for (const b of main.blades) assert.ok(near(b.holder.quaternion.w, 1) && near(b.holder.quaternion.x, 0));
});

test('wheels turn with the way over the ground, at most as fast as the limit, and slow down in the air', () => {
  const rig = buildSpinRig(toy(), TOY);
  const w = rig.wheels[0];
  rig.step(.02, { ground: 1 });
  assert.ok(topMoves(w, new Vector3(1, 0, 0)) > 0, 'the nose is +x, the axle is z: the top of the tyre goes toward the nose');
  rig.reset();
  // Швидкість по землі v дає v / (r · scale) рад/с, зі згладжуванням.
  const speed = 2, scale = 1;
  for (let i = 0; i < 120; i++) rig.step(1 / 60, { ground: speed, scale });
  assert.ok(near(w.w, speed / (w.r * scale), .05), `w = ${w.w}, the wheel rolls at the speed of the ground`);
  for (let i = 0; i < 120; i++) rig.step(1 / 60, { ground: 400, scale });
  assert.ok(near(w.w, WHEEL_MAX, 1e-3), 'a wheel does not turn faster than the limit');
  const a = w.angle;
  rig.step(.05, { ground: 400, scale });
  assert.ok(near(Math.abs(turn(w.angle, a)), .5, 1e-9), 'and not more than half a radian a frame');
  for (let i = 0; i < 1200; i++) rig.step(1 / 60, { ground: 400, air: true });
  assert.ok(w.w < .1, 'with no ground under it the wheel slows down in a few seconds');
  const wheels = rig.wheels;
  assert.ok(wheels.every(x => near(x.angle, wheels[0].angle, 1e-9)), 'all the wheels roll together');
  // Масштаб сцени: колесо вдвічі менше — крутиться вдвічі швидше за ту саму швидкість.
  rig.reset();
  for (let i = 0; i < 300; i++) rig.step(1 / 60, { ground: .5, scale: 1 });
  const slow = w.w;
  rig.reset();
  for (let i = 0; i < 300; i++) rig.step(1 / 60, { ground: .5, scale: .5 });
  assert.ok(near(w.w, slow * 2, .05));
});

test('blur discs: one per rotor in its plane, fading in with the revolutions, gone with dispose', () => {
  const rig = buildSpinRig(toy(), TOY);
  const tex = blurTexture();
  rig.addBlur(tex);
  const main = part(rig, 'main'), tail = part(rig, 'tail');
  assert.ok(main.disc && tail.disc);
  assert.ok(main.disc.userData.decal && tail.disc.userData.decal, 'the discs are marked: they are not model');
  assert.equal(main.disc.material.opacity, 0);
  rig.step(.01, { rpm: 1 });
  assert.ok(near(main.disc.material.opacity, .2) && near(tail.disc.material.opacity, .17));
  rig.step(.01, { rpm: .5 });
  assert.ok(near(main.disc.material.opacity, .05), 'opacity grows as the square of the revolutions');
  const count = group => { let n = 0; group.traverse(o => { if (o.isMesh && o.userData.decal) n++; }); return n; };
  assert.equal(count(main.group), 1);
  rig.addBlur(tex);
  assert.equal(count(main.group), 1, 'adding the discs again does not double them');
  rig.dispose();
  assert.equal(count(main.group), 0);
  assert.ok(main.angle === 0 && main.group.rotation.y === 0, 'the rotor is back in the pose of the file');
  tex.dispose();
});

test('a spec that finds nothing in the model builds nothing instead of half a rig', () => {
  const scene = toy();
  const why = [];
  assert.equal(buildSpinRig(scene, { nose: '+x', parts: [TOY.parts[0], { id: 'ghost', kind: 'rotor', axis: 'y', c: [50, 50], band: [1, 2], r: 1 }] }, why), null);
  assert.deepEqual(why, ['ghost:область']);
});

// ---------- справжні моделі ----------
const FILES = Object.keys(SPINS);
const built = new Map();
// Модель читається й розрізається один раз: тести нижче лише крутять її й повертають у позу файлу.
async function rigOf(file) {
  if (!built.has(file)) {
    const { scene } = await loadGlbScene(file, { fresh: true });
    scene.updateMatrixWorld(true);
    const before = vertices(scene), box0 = new Box3().setFromObject(scene), why = [];
    built.set(file, { scene, before, box0, why, rig: buildSpinRig(scene, SPINS[file], why) });
  }
  const r = built.get(file);
  if (r.rig) r.rig.reset();
  return r;
}

test('the table covers every plane and helicopter that the scenario drives, and its zones are well-formed', () => {
  const driven = ENTRIES.filter(e => e.model && e.model.file && !viewerOf(e)).map(e => [e, simOf(e, viewerOf)]).filter(([, s]) => s && (s.kind === 'heli' || s.kind === 'plane'));
  assert.deepEqual(driven.map(([e]) => e.model.file).sort(), [...FILES].sort(), 'every driven aircraft has its table and no table is left over');
  for (const [e, s] of driven) {
    assert.equal(s.file, e.model.file, `${e.id}: the scenario knows which file it moves`);
    assert.equal(SPINS[s.file].nose, e.model.nose, `${e.id}: the nose of the table is the nose of the article`);
  }
  for (const [file, spec] of Object.entries(SPINS)) {
    assert.ok(['+x', '-x', '+z', '-z'].includes(spec.nose), file);
    assert.equal(new Set(spec.parts.map(p => p.id + p.kind)).size, spec.parts.length, `${file}: names do not repeat`);
    for (const p of spec.parts) {
      assert.ok(['rotor', 'prop', 'wheels'].includes(p.kind) && ['x', 'y', 'z'].includes(p.axis), `${file}/${p.id}`);
      if (p.kind === 'wheels') assert.ok(p.box.length === 6 && p.box[0] < p.box[3] && p.box[1] < p.box[4] && p.box[2] < p.box[5], `${file}/${p.id}: box`);
      else {
        assert.ok(p.c.length === 2 && p.band[0] < p.band[1] && p.r > 0, `${file}/${p.id}: cylinder`);
        assert.ok(Math.abs(p.dir) === 1 && p.rate > 0, `${file}/${p.id}: direction and rate`);
      }
    }
  }
});

test('every model builds with all its parts found, and stands in the pose of the file', async () => {
  for (const file of FILES) {
    const { scene, before, box0, why, rig } = await rigOf(file);
    assert.deepEqual(why, [], `${file}: every zone found something`);
    assert.ok(rig, `${file}: the rig is built`);
    const box = new Box3().setFromObject(scene);
    assert.ok(box.min.distanceTo(box0.min) < 1e-4 && box.max.distanceTo(box0.max) < 1e-4, `${file}: the bounds did not change`);
    const after = vertices(scene);
    assert.equal(unmatched(after, before), 0, `${file}: every vertex lies where it did in the file`);
    assert.equal(unmatched(before, after), 0, `${file}: and none went missing`);
    for (const p of rig.parts) {
      assert.ok(near(p.group.rotation.x, 0) && near(p.group.rotation.y, 0) && near(p.group.rotation.z, 0), `${file}/${p.id}: at rest`);
      for (const b of p.blades || []) assert.ok(b.holder.quaternion.w === 1, `${file}/${p.id}: the blades lie as in the file`);
    }
  }
});

test('rotors have as many blades as the real helicopters, props as many as the aeroplane, wheels as many as the gear', async () => {
  const blades = {
    'mi-8tv': { main: 5 }, 'mi-35': { main: 5 }, 'mi-26': { main: 8 }, 'mi-2': { main: 3 },
    'ka-50': { upper: 3, lower: 3 }, 'ka-27': { upper: 3, lower: 3 },
  };
  const tails = { 'mi-8tv': 3, 'mi-35': 4, 'mi-2': 3 }; // Мі-26: п’ять лопатей і ще одне тіло розміру лопаті від маточини (див. нижче)
  for (const [file, want] of Object.entries(blades)) {
    const { rig } = await rigOf(file);
    for (const [id, n] of Object.entries(want)) assert.equal(part(rig, id).blades.length, n, `${file}/${id}: blades`);
    assert.equal(rig.wheels.length, 0, `${file}: no wheels in the table`);
  }
  for (const [file, n] of Object.entries(tails)) assert.equal(part((await rigOf(file)).rig, 'tail').n, n, `${file}: tail blades`);
  const mi26 = part((await rigOf('mi-26')).rig, 'tail');
  assert.ok(mi26.n >= 5 && mi26.n <= 6, `mi-26 tail: ${mi26.n}`);
  const an26 = (await rigOf('an-26')).rig;
  assert.deepEqual(['prop-left', 'prop-right'].map(id => part(an26, id).n), [4, 4]);
  const count = (rig, id) => rig.wheels.filter(w => w.id === id).length;
  assert.deepEqual([count(an26, 'main'), count(an26, 'nose')], [4, 2]);
  const an225 = (await rigOf('an-225')).rig;
  assert.deepEqual([count(an225, 'main'), count(an225, 'nose')], [28, 4]);
  assert.equal(an225.rotors.length, 0, 'the jet has no propellers');
  for (const file of FILES) {
    const { rig } = await rigOf(file);
    for (const p of rig.rotors) {
      const spec = SPINS[file].parts.find(s => s.id === p.id);
      assert.ok(p.tip <= spec.r + .05 && p.tip >= spec.r * .6, `${file}/${p.id}: the blades reach ${p.tip.toFixed(2)} of the zone radius ${spec.r}`);
      assert.ok(near(p.pivot[SPIN_AXES[p.axis][0]], spec.c[0], 1e-3) && near(p.pivot[SPIN_AXES[p.axis][1]], spec.c[1], 1e-3), `${file}/${p.id}: the axle is on the centre of the zone`);
    }
  }
});
test('coaxial rotors turn against each other, and the single rotors of one helicopter all turn the same way', async () => {
  for (const file of ['ka-50', 'ka-27']) {
    const { rig } = await rigOf(file), up = part(rig, 'upper'), low = part(rig, 'lower');
    assert.equal(up.dir, -low.dir, `${file}: opposite directions`);
    rig.step(.01, { rpm: 1 });
    assert.ok(Math.sign(up.group.rotation.y) === -Math.sign(low.group.rotation.y) && up.group.rotation.y !== 0, `${file}: the groups turn against each other`);
    assert.ok(up.pivot[1] > low.pivot[1] && near(up.pivot[0], low.pivot[0], .05 * up.tip), `${file}: the upper rotor is right above the lower one`);
  }
  for (const file of ['mi-8tv', 'mi-35', 'mi-26', 'mi-2']) assert.equal(part((await rigOf(file)).rig, 'main').dir, -1, file);
});

// На скільки кінець лопаті (найдальша від осі вершина) вищий за корінь лопаті; від’ємне число — лопать висить.
function tipRise(blade, axis) {
  const v = new Vector3();
  let far = null, dist = -1;
  blade.holder.updateWorldMatrix(true, true);
  blade.holder.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const d = Math.hypot(v.x - axis[0], v.z - axis[2]);
      if (d > dist) { dist = d; far = v.clone(); }
    }
  });
  return far.y - new Vector3().setFromMatrixPosition(blade.holder.matrixWorld).y;
}

test('the drooped blades of the Mi-26 lift as the rotor spins up and hang again when it stops', async () => {
  const { rig } = await rigOf('mi-26'), main = part(rig, 'main');
  assert.ok(main.blades.every(b => b.rest < -2 * D2R), 'the model has all eight blades hanging');
  const rest = main.blades.map(b => tipRise(b, main.pivot));
  assert.ok(rest.every(d => d < -.2), `at rest every tip is below its root: ${rest.map(d => d.toFixed(2))}`);
  for (let i = 0; i < 180; i++) rig.step(1 / 60, { rpm: 1 });
  main.group.rotation.y = 0; // тільки щоб порахувати кінець лопаті відносно осі, не обертаючи її
  const flight = main.blades.map(b => tipRise(b, main.pivot));
  flight.forEach((d, i) => assert.ok(d > 0 && d > rest[i] + .3, `blade ${i}: ${rest[i].toFixed(2)} → ${d.toFixed(2)}`));
  rig.step(40, { rpm: 0 });
  rig.reset();
  main.blades.forEach((b, i) => assert.ok(near(tipRise(b, main.pivot), rest[i], 1e-4), `blade ${i} is back`));
});

test('real wheels roll the right way: the top of the tyre goes toward the nose', async () => {
  for (const file of ['an-26', 'an-225']) {
    const { rig } = await rigOf(file);
    const nose = { '+z': new Vector3(0, 0, 1), '-z': new Vector3(0, 0, -1) }[SPINS[file].nose];
    rig.step(.02, { ground: 3, scale: .2 });
    for (const w of rig.wheels) assert.ok(topMoves(w, nose) > 0, `${file}/${w.id}: forward`);
    assert.equal(new Set(rig.wheels.map(w => w.axis)).size, 1, `${file}: all axles lie across the aircraft`);
  }
});

// ---------- сцена ----------
async function viewerFor(id) {
  const e0 = ENTRIES.find(e => e.id === id);
  const { scene, animations } = await loadGlbScene(e0.model.file, { fresh: true });
  const entry = normalizeAircraft(scene, e0.model.nose, e0.model.length);
  entry.clips = animations;
  const v = {
    group: entry.group, entry, holder: new Group(), scene: new Scene(), camera: new PerspectiveCamera(26, 2, .1, 80),
    renderer: { capabilities: { getMaxAnisotropy: () => 1 } }, stage: { floor: { visible: true } }, target: new Vector3(), motion: true, winged: false, open: 1, yaw: 0, pose() {},
  };
  v.holder.add(entry.group); v.scene.add(v.holder);
  return v;
}
const cfgOf = id => simOf(ENTRIES.find(e => e.id === id), viewerOf);
const run = (sim, seconds) => { for (let t = 0; t < seconds; t += 1 / 30) sim.step(1 / 30); };
const angles = sim => sim.spin.rotors.map(p => p.angle);

test('a helicopter in the scenario: the rotors spin up after the start, hold in flight and stop after the landing', async () => {
  const v = await viewerFor('mi8tv'), cfg = cfgOf('mi8tv');
  const before = vertices(v.entry.scene);
  const sim = new Sim(v, cfg);
  assert.ok(sim.spin && sim.spin.rotors.length === 2, 'the carved rotors, not the flat discs');
  assert.equal(sim.rotors.length, 0, 'and no stand-in discs next to them');
  assert.equal(v.entry.meshes, null, 'the marker check will look at the new meshes');
  run(sim, 2);
  assert.deepEqual(angles(sim), [0, 0], 'a helicopter in the park does not turn the rotors');
  sim.set('start');
  run(sim, 1);
  const early = angles(sim);
  assert.ok(early[0] < 0 && early[1] > 0, 'the rotors begin to turn, each its own way');
  const [main] = sim.spin.rotors;
  assert.ok(main.disc.material.opacity < .1, 'while the rotor is slow there is almost no blur');
  run(sim, 12);
  assert.ok(sim.S.rpm > .95 && main.disc.material.opacity > .15, 'at full revolutions the blur is there');
  sim.set('hover');
  run(sim, 6);
  assert.ok(sim.S.air && angles(sim)[0] !== early[0], 'the rotor turns in the air');
  sim.set('land');
  run(sim, 60);
  assert.ok(!sim.S.air && sim.S.rpm < .05, 'the helicopter has landed and shut the engines');
  run(sim, 30);
  const stopped = angles(sim);
  run(sim, 2);
  assert.ok(near(angles(sim)[0], stopped[0], 1e-3), 'the rotor has stopped');
  assert.ok(main.disc.material.opacity < .02, 'no blur on a stopped rotor');
  const rig = sim.spin;
  sim.dispose();
  assert.ok(rig.rotors.every(p => !p.disc && p.group.rotation.y === 0 && p.angle === 0), 'the scenario puts the rotors back as they were in the file');
  assert.equal(unmatched(vertices(v.entry.scene), before), 0, 'the model is as it was in the file');
  assert.equal(unmatched(before, vertices(v.entry.scene)), 0);
  // Другий сценарій тієї самої моделі не розрізає її вдруге.
  const again = new Sim(v, cfg);
  assert.equal(again.spin, rig, 'the rig is built once for the model');
  assert.ok(rig.rotors.every(p => p.disc), 'with fresh blur discs');
  again.dispose();
});

test('an aeroplane in the scenario: the propellers follow the engines, the wheels roll on the ground and slow down in the air', async () => {
  const v = await viewerFor('an26'), cfg = cfgOf('an26');
  const sim = new Sim(v, cfg), S = sim.S;
  assert.equal(sim.spin.rotors.length, 2);
  assert.equal(sim.spin.wheels.length, 6);
  run(sim, 2);
  assert.deepEqual(angles(sim), [0, 0], 'engines off in the park');
  assert.ok(sim.spin.wheels.every(w => w.w === 0));
  sim.set('taxi');
  run(sim, 4);
  assert.ok(S.rpm > .25 && S.rpm < .5, 'engines idle while taxiing');
  assert.ok(sim.spin.wheels.every(w => w.w > 5), 'the wheels roll with the plane');
  const idle = angles(sim)[0];
  sim.set('takeoff');
  let rolled = false;
  for (let t = 0; t < 40 && !S.air; t += 1 / 30) { sim.step(1 / 30); rolled ||= sim.spin.wheels[0].w > 5; }
  assert.ok(S.air && rolled && S.rpm > .6, 'the plane takes off on full revolutions');
  assert.notEqual(angles(sim)[0], idle);
  run(sim, 15);
  assert.ok(S.rpm > .95 && sim.spin.wheels.every(w => w.w < 1), 'in the air the wheels have almost stopped');
  sim.set('cruise');
  run(sim, 8);
  assert.ok(S.rpm > .8 && S.rpm < .9, 'cruise revolutions');
  sim.set('land');
  for (let t = 0; t < 120 && !(S.td > 1 && !S.air); t += 1 / 30) sim.step(1 / 30);
  assert.ok(!S.air, 'touched down');
  run(sim, 1);
  assert.ok(sim.spin.wheels.every(w => w.w > 3), 'the wheels roll on the landing run');
  for (let t = 0; t < 120 && !(S.speed === 0 && S.rpm < .05); t += 1 / 30) sim.step(1 / 30);
  assert.ok(S.speed === 0 && S.rpm < .05, 'the plane stops and shuts the engines');
  assert.ok(sim.spin.wheels.every(w => w.w < .5), 'the wheels stand');
  sim.dispose();
  assert.ok(sim.spin.wheels.every(w => w.angle === 0 && w.group.rotation.x === 0), 'back as in the file');
});

test('the Mriya has wheels and no propellers, and every other helicopter turns its carved rotors in the scenario', async () => {
  const sim = new Sim(await viewerFor('an225'), cfgOf('an225'));
  assert.equal(sim.spin.rotors.length, 0);
  assert.equal(sim.spin.wheels.length, 32);
  sim.set('takeoff');
  run(sim, 5);
  assert.ok(sim.spin.wheels.every(w => w.w > 2), 'all 32 wheels roll on the take-off run');
  sim.dispose();
  for (const id of ['ka50', 'ka27', 'mi26', 'mi35', 'mi2']) {
    const v = await viewerFor(id), s = new Sim(v, cfgOf(id));
    assert.ok(s.spin && s.spin.rotors.length === 2 && s.rotors.length === 0, id);
    s.set('hover');
    run(s, 15);
    assert.ok(s.S.air && s.spin.rotors.every(p => p.angle !== 0), `${id}: hovers on turning rotors`);
    s.dispose();
  }
});

test('without a table or without the model scene the helicopter keeps the flat stand-in discs and a plane just has no moving parts', async () => {
  const v = await viewerFor('mi8tv');
  const noTable = new Sim(v, { ...cfgOf('mi8tv'), file: 'no-such-file' });
  assert.equal(noTable.spin, null);
  assert.ok(noTable.rotors.length === 1, 'the old disc is there');
  noTable.dispose();
  const bare = await viewerFor('mi8tv');
  delete bare.entry.scene;
  const sim = new Sim(bare, cfgOf('mi8tv'));
  assert.equal(sim.spin, null);
  assert.equal(sim.rotors.length, 1);
  sim.set('hover');
  run(sim, 10);
  assert.ok(sim.rotors[0].children[0].material.opacity > .5, 'the disc fades in with the revolutions');
  sim.dispose();
  const plane = await viewerFor('an26');
  const none = new Sim(plane, { ...cfgOf('an26'), file: undefined });
  assert.equal(none.spin, null);
  none.set('takeoff');
  run(none, 20);
  assert.ok(none.S.air, 'the take-off works without the parts');
  none.dispose();
});

test('a failing build leaves the model alone and the scenario goes on without the parts', async () => {
  const v = await viewerFor('mi8tv');
  const keep = SPINS['mi-8tv'];
  SPINS['mi-8tv'] = { nose: '+z', parts: [{ id: 'nowhere', kind: 'rotor', axis: 'y', c: [500, 500], band: [1, 2], r: 1 }] };
  try {
    const sim = new Sim(v, cfgOf('mi8tv'));
    assert.equal(sim.spin, null);
    assert.equal(sim.rotors.length, 1);
    assert.equal(v.entry.parts['spin:mi-8tv'], null, 'the failure is remembered: the model is not cut again and again');
    sim.dispose();
  } finally { SPINS['mi-8tv'] = keep; }
});
