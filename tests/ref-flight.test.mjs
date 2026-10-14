// Політ ракет (ref-flight.js): розгін двигуном, поворот під тяжінням, влучання в рельєф, вихід за межі сцени, процедурні ракети.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { Debris, Flight, ROCKETS, proceduralRocket } = await import('../src/ref-flight.js');
const { Fx } = await import('../src/ref-fx.js');

function setup(ground = () => 0) {
  const parent = new Group(), fx = new Fx(parent), scars = [], hits = [];
  const f = new Flight({ parent, fx, ground, scar: (x, y, z, r) => scars.push({ x, y, z, r }) });
  f.onImpact = (rec, dist) => hits.push({ rec, dist });
  return { parent, fx, f, scars, hits };
}
const dir = deg => new Vector3(-Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180), 0);

test('a rocket accelerates while the motor burns, then keeps its speed and bends down under gravity', () => {
  const { f, parent } = setup();
  const rec = f.launch(new Group(), ROCKETS.gmlrs, new Vector3(0, 3, 0), dir(45));
  assert.equal(parent.children.includes(rec.m), true);
  assert.equal(f.busy, true);
  for (let i = 0; i < 60 * 2.2; i++) f.step(1 / 60);
  assert.ok(Math.abs(rec.v - 22 * 2.2) < 1, `motor speed ${rec.v.toFixed(1)} m/s`);
  const angle = () => Math.asin(rec.d.y) * 180 / Math.PI;
  assert.ok(Math.abs(angle() - 45) < 1, 'the course is held while the motor burns');
  assert.equal(rec.flame.visible, true);
  for (let i = 0; i < 60; i++) f.step(1 / 60);
  assert.equal(rec.flame.visible, false, 'the flame goes out after the burn');
  assert.ok(angle() < 38, `the course bends down (${angle().toFixed(1)}°)`);
  assert.ok(Math.abs(rec.v - 22 * 2.2) < 1, 'the speed stays');
  assert.ok(rec.m.quaternion.length() > .99);
});

test('a rocket that reaches the ground leaves a scar and reports the distance; one that flies far away is simply removed', () => {
  // стіна рельєфу позаду на 80 м
  const wall = setup((x) => (x < -80 ? 200 : 0));
  wall.f.launch(new Group(), ROCKETS.atacms, new Vector3(0, 3, 0), dir(20));
  for (let i = 0; i < 60 * 14 && wall.f.busy; i++) wall.f.step(1 / 60);
  assert.equal(wall.f.busy, false);
  assert.equal(wall.hits.length, 1);
  assert.ok(wall.hits[0].dist >= 80 && wall.hits[0].dist < 190, `hit at ${wall.hits[0].dist} m`);
  assert.equal(wall.scars.length, 1);
  assert.ok(wall.scars[0].r > 1, 'a scar sized by the blast');
  assert.ok(wall.fx.list.length > 10, 'flash and dust');
  assert.equal(wall.parent.children.filter(o => o.isGroup).length, 0, 'the rocket model is removed');
  const open = setup();
  open.f.launch(new Group(), ROCKETS.gmlrs, new Vector3(0, 3, 0), dir(45));
  for (let i = 0; i < 60 * 14 && open.f.busy; i++) open.f.step(1 / 60);
  assert.equal(open.hits.length, 1);
  assert.equal(open.hits[0].dist, null, 'out of the scene');
  assert.equal(open.scars.length, 0);
});

test('several rockets fly at once and clear() removes them', () => {
  const { f, parent } = setup();
  for (let i = 0; i < 4; i++) f.launch(new Group(), ROCKETS.gmlrs, new Vector3(0, 3, i), dir(40));
  assert.equal(f.list.length, 4);
  f.step(.1);
  f.clear();
  assert.equal(f.busy, false);
  assert.equal(parent.children.filter(o => o.isGroup).length, 0);
  f.dispose();
});

test('procedural rockets are centred, point along +X and have the requested length', () => {
  for (const kind of ['gmlrs', 'olkha', 'otrk']) {
    const spec = ROCKETS[kind].procedural || { length: 4, radius: .12 };
    const g = proceduralRocket(spec);
    const box = new Box3().setFromObject(g), size = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
    assert.ok(Math.abs(size.x - spec.length) < spec.length * .02, `${kind}: length ${size.x.toFixed(2)}`);
    assert.ok(Math.abs(c.x) < .05 && Math.abs(c.y) < .05, `${kind}: centred`);
    assert.ok(size.y > spec.radius * 1.5, `${kind}: fins`);
  }
  assert.ok(ROCKETS.otrk.boost > ROCKETS.gmlrs.boost && ROCKETS.otrk.flash > ROCKETS.gmlrs.flash, 'the big rocket is bigger');
});

test('the rocket starts hidden in the tube: it sits `back` metres behind the muzzle, and the exhaust cloud reaches the ground behind it', () => {
  const { f, fx } = setup();
  const p = new Vector3(0, 10, 0), d = new Vector3(0, 1, 0);
  const rec = f.launch(new Group(), ROCKETS.otrk, p, d, { back: 3.62 });
  assert.ok(Math.abs(rec.m.position.y - (10 - 3.62)) < 1e-9, 'the centre is 3.62 m behind the muzzle');
  // вертикальний пуск: вісь позаду дула впирається в землю за 10 м, там і здіймається пил (op .7 — клуби пилу, не дим і не спалах)
  const dust = fx.list.filter(q => q.op === .7);
  assert.equal(dust.length, ROCKETS.otrk.dust);
  assert.ok(dust.every(q => q.s.position.y < 1.1), 'the dust rises from the ground, not at the muzzle');
  assert.ok(dust.every(q => Math.abs(q.s.position.x) <= ROCKETS.otrk.spread / 2 + 1e-9 && Math.abs(q.s.position.z) <= ROCKETS.otrk.spread / 2 + 1e-9), 'inside the spread');
  assert.ok(dust.every(q => q.size >= ROCKETS.otrk.dustSize), 'the size comes from the profile');
  assert.equal(fx.list.filter(q => q.add).length, 1, 'one flash at the muzzle');
  assert.equal(fx.list.length - dust.length - 1, ROCKETS.otrk.smoke, 'the smoke puffs at the muzzle');
  // без параметра — 1,7 м, як було; горизонтальний пуск — пил за 5 м позаду
  const other = setup();
  const def = other.f.launch(new Group(), ROCKETS.gmlrs, p, new Vector3(1, 0, 0));
  assert.ok(Math.abs(def.m.position.x + 1.7) < 1e-9, 'without the option the default 1.7 m applies');
  const flat = other.fx.list.filter(q => q.op === .7);
  assert.ok(flat.every(q => Math.abs(q.s.position.x + 5) <= 2.01 && q.s.position.y < 1.1), 'a horizontal launch kicks the dust up 5 m behind');
});

test('a rocket with a soft start and a vertical launch accelerates gently, then leans toward its range direction', () => {
  const { f } = setup();
  const soft = f.launch(new Group(), ROCKETS.otrk, new Vector3(0, 10, 0), new Vector3(.17, .985, 0).normalize());
  const hard = f.launch(new Group(), ROCKETS.gmlrs, new Vector3(0, 10, 3), new Vector3(.17, .985, 0).normalize());
  for (let i = 0; i < 15; i++) f.step(1 / 60);
  assert.ok(Math.abs(soft.v - ROCKETS.otrk.acc * ROCKETS.otrk.soft * .25) < .6, `soft start ${soft.v.toFixed(2)} m/s`);
  assert.ok(Math.abs(hard.v - ROCKETS.gmlrs.acc * .25) < .6, 'a rocket without the option accelerates fully');
  const lean = () => Math.acos(soft.d.y) * 180 / Math.PI;
  const lean0 = lean();
  for (let i = 0; i < 60 * 1.3; i++) f.step(1 / 60); // до 1,6 с курс тримається
  assert.ok(Math.abs(lean() - lean0) < 1, 'the course is held for the first 1.6 s');
  for (let i = 0; i < 60 * 2.4; i++) f.step(1 / 60);
  assert.ok(lean() > lean0 + 15 && soft.d.x > .4 && Math.abs(soft.d.z) < .1, `leans toward +X (${lean().toFixed(0)}°)`);
  assert.ok(Math.abs(soft.d.length() - 1) < 1e-9, 'the direction stays a unit vector');
});

test('the range limit is a property of the rocket: the long one flies 330 m, the others leave the scene at 190 m', () => {
  for (const [kind, limit] of [['gmlrs', 190], ['otrk', 330]]) {
    const { f, hits } = setup(() => -1e5); // землі немає: ракета може лише вилетіти
    const rec = f.launch(new Group(), ROCKETS[kind], new Vector3(0, 3, 0), new Vector3(1, 0, 0));
    for (let i = 0; i < 60 * 14 && f.busy; i++) f.step(1 / 60);
    assert.equal(f.busy, false, `${kind}: removed`);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].dist, null, `${kind}: out of the scene`);
    const flown = rec.m.position.distanceTo(rec.from);
    assert.ok(flown >= limit && flown < limit + 4, `${kind}: removed at ${flown.toFixed(1)} m`);
  }
});

test('debris falls under gravity, spins, and is gone after 2.5 s or on the ground', () => {
  const parent = new Group(), geometry = new BoxGeometry(.2, .2, .05), material = new MeshBasicMaterial();
  const d = new Debris({ parent, ground: x => (x > 10 ? 6 : 0) });
  assert.equal(d.busy, false);
  const m = d.add(geometry, material, new Vector3(0, 10, 0), new Quaternion(), new Vector3(2, 3, 0), new Vector3(0, 4, 0));
  assert.equal(m.geometry, geometry, 'the geometry is shared with the model, not copied');
  assert.equal(m.material, material);
  assert.ok(parent.children.includes(m) && d.busy);
  for (let i = 0; i < 60; i++) d.step(1 / 60);
  // y(t) = 10 + 3t − g t²/2; x = 2t
  assert.ok(Math.abs(m.position.y - (10 + 3 - 9.8 / 2)) < .2, `ballistic height ${m.position.y.toFixed(2)}`);
  assert.ok(Math.abs(m.position.x - 2) < .05);
  assert.ok(Math.abs(m.rotation.y - 4) < .1, 'spins at the given rate');
  for (let i = 0; i < 60 * 2; i++) d.step(1 / 60);
  assert.equal(d.busy, false, 'removed after 2.5 s');
  assert.equal(parent.children.length, 0);
  // удар об землю: поверхня на 6 м вище
  const hit = d.add(geometry, material, new Vector3(20, 8, 0), new Quaternion(), new Vector3(0, 0, 0), new Vector3());
  for (let i = 0; i < 60 && d.busy; i++) d.step(1 / 60);
  assert.equal(d.busy, false, 'removed when it reaches the ground');
  assert.ok(hit.position.y < 8);
  d.add(geometry, material, new Vector3(0, 50, 0), new Quaternion(), new Vector3(), new Vector3());
  d.clear();
  assert.equal(parent.children.length, 0);
  d.dispose();
});
