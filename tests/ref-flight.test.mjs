// Політ ракет (ref-flight.js): розгін двигуном, поворот під тяжінням, влучання в рельєф, вихід за межі сцени, процедурні ракети.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Vector3 } from 'three';

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { Flight, ROCKETS, proceduralRocket } = await import('../src/ref-flight.js');
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
