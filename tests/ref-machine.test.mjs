// Рушій наземної техніки (ref-machine.js) на справжніх моделях довідника: кадри моделі й світу, марш по рельєфу, колеса й гусениці,
// фази пускової, польоти ракет, керування з клавіатури, режим без анімації і прибирання сцени.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Fog, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { ENTRIES, viewerOf } from '../src/ref-data.js';
import { MACHINE_PHASES, legacySim, simOf } from '../src/ref-sim-data.js';
import { forgetTerrain } from '../src/ref-terrain.js';
import { loadGlbScene } from './helpers/glb-scene.mjs';

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { Machine } = await import('../src/ref-machine.js');
const { normalizeAircraft } = await import('../src/ref-viewer.js');

// Ландшафт-заглушка: схил 0,2 вздовж курсу (плитка масштабується до .2 · .45, тож ухил на сцені ≈ 0,09).
const slopeScene = () => {
  const geo = new PlaneGeometry(400, 300, 40, 30).rotateX(-Math.PI / 2), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getX(i) * .2);
  const scene = new Group(); scene.add(new Mesh(geo, new MeshBasicMaterial()));
  return scene;
};

async function viewerFor(id, { motion = true, terrain = 'slope' } = {}) {
  const entry0 = ENTRIES.find(e => e.id === id), file = entry0.model.file;
  const { scene, animations } = await loadGlbScene(file, { fresh: true });
  const entry = normalizeAircraft(scene, entry0.model.nose, entry0.model.length);
  entry.clips = animations;
  const v = {
    group: entry.group, entry, holder: new Group(), scene: new Scene(), camera: new PerspectiveCamera(26, 2, .1, 80),
    renderer: { capabilities: { getMaxAnisotropy: () => 1 } }, stage: { floor: { visible: true } }, target: new Vector3(), motion, yaw: .4, open: 1, sim: null, posed: 0, zoom: 1,
    pose() { this.posed++; },
    baseDistance() { return 13; },
    async load(model) {
      if (model.wrapper) { if (terrain === 'fail') throw new Error('немає файлу'); return { scene: slopeScene() }; }
      const g = new Group(); g.add(new Mesh(new BoxGeometry(4, .25, .25), new MeshBasicMaterial())); return { scene: g };
    },
  };
  v.holder.add(entry.group); v.scene.add(v.holder);
  v.scene.fog = new Fog('#000000', 1, 2);
  return v;
}

const cfgOf = id => simOf(ENTRIES.find(e => e.id === id), viewerOf);
const run = (m, seconds, until = () => false) => { for (let t = 0; t < seconds; t += 1 / 30) { m.step(1 / 30); if (until(m)) return true; } return false; };

test('machine articles get the machine phases, the others keep the simple scenarios', () => {
  assert.deepEqual(cfgOf('himars').phases.map(p => p[0]), ['park', 'march', 'position', 'stow']);
  assert.deepEqual(cfgOf('m270').phases, MACHINE_PHASES.launcher);
  assert.equal(cfgOf('himars').machine, true);
  assert.equal(cfgOf('mi35').machine, undefined);
  const legacy = legacySim(cfgOf('himars'));
  assert.equal(legacy.machine, false);
  assert.deepEqual(legacy.phases.map(p => p[0]), ['park', 'march', 'fire'], 'the fallback is the simple launcher scenario');
});

test('HIMARS: model and world frames agree, wheels roll on the march and the launcher works from the firing position', async () => {
  forgetTerrain();
  const v = await viewerFor('himars'), cfg = cfgOf('himars');
  const m = new Machine(v, cfg);
  v.sim = m;
  await m.terrain.loading;
  assert.ok(m.terrain.ready && !m.ground.visible, 'the terrain replaces the fallback ground');
  assert.equal(m.wheels.wheels.length, 6);
  assert.ok(m.rig && m.controls.length === 8);
  assert.equal(v.group.parent, m.ride);
  m.snap();
  const focus = m.pose();
  // фон і туман одного кольору: поле тоне в ньому, а туман густішає за межею плиток і не починається перед машиною
  assert.ok(v.scene.background && v.scene.fog.color.equals(v.scene.background), 'fog and background share one colour');
  assert.ok(Math.abs(v.scene.fog.far - 118 * m.k) < 1e-9);
  assert.ok(v.scene.fog.near > 13 * 1.35 * 1.45 && v.scene.fog.near < v.scene.fog.far, 'the fog starts behind the machine');
  v.scene.updateMatrixWorld(true);
  // центр моделі в сцені лежить на вертикалі камери, а висота камери — це висота корпуса
  const box = new Box3().setFromObject(v.group), c = box.getCenter(new Vector3());
  assert.ok(Math.abs(c.x) < .35 && Math.abs(c.z) < .15, `the model is centred on the camera axis (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
  assert.ok(Math.abs(c.y - focus) < .35, 'the camera looks at the body');
  // марш: колеса крутяться, шлях росте, корпус лягає на схил носом угору
  m.set('march');
  assert.equal(m.S.tSpeed, 16);
  assert.ok(run(m, 8, x => x.S.dist > 20), 'the machine travels');
  // корпус лежить на схилі: нахил і висота відповідають рельєфу під осями (плитки дзеркальні, тож знак схилу змінюється з відстанню)
  const slope = (m.height(m.S.dist + m.gait.front, 0) - m.height(m.S.dist + m.gait.rear, 0)) / (m.gait.front - m.gait.rear);
  assert.ok(slope > .05, `uphill under the axles (${slope.toFixed(3)})`);
  assert.ok(Math.abs(m.S.pitch - Math.atan(slope) * .9) < .02, `nose up on the slope (${m.S.pitch.toFixed(3)})`);
  assert.ok(m.S.y > 1, 'the body climbs with the terrain');
  assert.ok(run(m, 8, x => x.S.speed > 14), 'reaches the march speed');
  const d0 = m.S.dist;
  run(m, 2);
  assert.ok(m.S.dist - d0 > 25, 'the machine travels fast');
  m.pose();
  const w = m.wheels.wheels[0];
  assert.ok(Math.abs(w.spin.rotation.z + m.S.dist / w.rr) < 1e-9, 'wheels roll with the distance');
  assert.ok(m.fx.list.length > 0, 'dust from the wheels');
  assert.match(m.status(), /^Марш · \d+ км\/год$/);
  // вогнева позиція: машина стає, пускова піднімається
  m.set('position');
  assert.ok(run(m, 10, x => x.S.speed === 0 && x.rig.S.deploy === 1), 'stops and raises the launcher');
  assert.ok(m.rig.canFire());
  let state = null;
  m.onState = u => { state = u; };
  m.report(true);
  assert.equal(state.locks.fire, false);
  assert.equal(state.ammo.n, 6);
  m.press('fire');
  assert.equal(m.flight.list.length, 1, 'one rocket in the air');
  assert.equal(state.ammo.n, 5, 'the interface was told');
  assert.ok(run(m, 20, x => !x.flight.busy), 'the rocket is gone');
  assert.match(m.toastText, /^(Розрив на дистанції \d+ м|Ракета вийшла за межі сцени)/, 'the flight is reported');
  assert.ok(m.fx.list.length > 0);
  m.set('stow');
  assert.ok(run(m, 10, x => x.rig.S.deploy === 0), 'folds the launcher');
  assert.equal(m.rig.canFire(), false);
  m.dispose();
  assert.equal(v.scene.children.filter(o => o.name === 'machine-world').length, 0);
  assert.equal(v.group.parent, v.holder);
  assert.equal(v.stage.floor.visible, true);
  assert.equal(v.scene.fog.near, 1, 'the fog is restored');
  assert.equal(v.scene.background, null, 'the background is restored');
  assert.equal(v.camera.fov, 26);
  assert.equal(m.wheels.wheels[0].spin.rotation.z, 0, 'wheels return to the rest pose');
});

test('M270: tracks follow the distance and the launcher keeps its own speed limit while raised', async () => {
  forgetTerrain();
  const v = await viewerFor('m270'), m = new Machine(v, cfgOf('m270'));
  v.sim = m;
  await m.terrain.loading;
  assert.equal(m.wheels, null);
  assert.ok(m.tracks && m.tracks.meshes.length === 5);
  m.set('position');
  assert.ok(run(m, 10, x => x.rig.S.deploy === 1));
  m.set('march');
  assert.equal(m.rig.speedTarget, 0, 'cannot drive with the launcher raised');
  assert.ok(run(m, 12, x => x.rig.S.deploy === 0), 'folds first');
  assert.ok(run(m, 10, x => x.S.speed > 10), 'then drives at the M270 speed');
  assert.equal(m.S.tSpeed, 12);
  m.pose();
  assert.ok(Math.abs(m.tracks.uniforms.uDist.value - m.S.dist) < 1e-9, 'the tracks move with the machine');
  m.dispose();
  assert.equal(m.tracks.uniforms.uDist.value, 0);
});

test('keys switch phases, aim and fire; arrows pass through when the launcher cannot aim', async () => {
  forgetTerrain();
  const v = await viewerFor('himars', { terrain: 'fail' }), m = new Machine(v, cfgOf('himars'));
  v.sim = m;
  await m.terrain.loading;
  assert.ok(m.terrain.failed && m.ground.visible, 'the fallback ground stays');
  const key = (code, extra = {}) => ({ code, ...extra });
  assert.equal(m.keyDown(key('ArrowUp')), false, 'arrows aim only on the firing position');
  assert.equal(m.keyDown(key('KeyX')), true);
  assert.equal(m.rig.S.ammo, 6, 'nothing is fired from the march position');
  assert.equal(m.keyDown(key('Digit3')), true);
  assert.equal(m.phase, 'position');
  assert.equal(m.keyDown(key('Digit9')), false);
  assert.ok(run(m, 10, x => x.rig.S.deploy === 1));
  const e0 = m.rig.S.elev;
  assert.equal(m.keyDown(key('ArrowUp')), true);
  run(m, 1);
  assert.equal(m.keyUp(key('ArrowUp')), true);
  run(m, 1);
  assert.ok(m.rig.S.elev > e0 + 10, 'the launcher rose');
  assert.equal(m.keyDown(key('KeyX', { repeat: true })), true);
  assert.equal(m.rig.S.ammo, 6, 'holding the key does not repeat the shot');
  assert.equal(m.keyDown(key('KeyX')), true);
  assert.equal(m.rig.S.ammo, 5);
  assert.ok(run(m, 20, x => !x.flight.busy), 'the rocket flies out of the scene');
  assert.match(m.toastText, /^Ракета вийшла за межі сцени$/);
  assert.equal(m.keyDown(key('KeyX', { ctrlKey: true })), false, 'browser shortcuts are not taken');
  m.releaseAll();
  m.dispose();
});

test('without animation a phase shows the settled pose and a shot only uses up a tube', async () => {
  forgetTerrain();
  const v = await viewerFor('himars', { motion: false, terrain: 'fail' }), m = new Machine(v, cfgOf('himars'));
  v.sim = m;
  await m.terrain.loading;
  m.set('position');
  assert.equal(m.rig.S.deploy, 1);
  assert.ok(m.rig.canFire(), 'firing works without flights');
  m.press('fire');
  assert.equal(m.rig.S.ammo, 5);
  assert.equal(m.flight.list.length, 0, 'no rocket is drawn without animation');
  const e0 = m.rig.S.elev;
  m.hold('up', true); m.hold('up', false);
  assert.ok(m.rig.S.elev > e0, 'a press nudges the aim');
  m.set('march');
  assert.ok(m.S.dist >= 40 && m.S.speed === 16, 'the march is shown after a stretch of the road');
  assert.equal(m.fx.list.length, 0, 'no particles without animation');
  m.dispose();
});

test('a model that cannot build the launcher or the wheels still drives', async () => {
  forgetTerrain();
  const v = await viewerFor('vilkha', { terrain: 'fail' });
  const m = new Machine(v, { ...cfgOf('vilkha'), machine: true, phases: MACHINE_PHASES.launcher, rig: 'pods', spec: 'himars', wheels: 'himars' });
  v.sim = m;
  assert.equal(m.rig, null, 'no launcher nodes in this model');
  m.set('march');
  assert.ok(run(m, 5, x => x.S.speed > 5));
  assert.equal(m.status().startsWith('Марш'), true);
  m.dispose();
});
