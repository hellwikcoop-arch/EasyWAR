// Рушій наземної техніки (ref-machine.js) на справжніх моделях довідника: кадри моделі й світу, марш по рельєфу, колеса й гусениці,
// фази пускової, польоти ракет, керування з клавіатури, режим без анімації і прибирання сцени.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Euler, Fog, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { ENTRIES, viewerOf } from '../src/ref-data.js';
import { MACHINE_PHASES, legacySim, simOf } from '../src/ref-sim-data.js';
import { ROCKETS } from '../src/ref-flight.js';
import { forgetTerrain } from '../src/ref-terrain.js';
import { TelLauncher } from '../src/ref-tel.js';
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
  assert.ok(m.rig && m.controls.length === 9 && m.controls.at(-1).id === 'follow', 'eight launcher keys and the camera switch');
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

test('Vilkha and Sapsan are led by the machine engine with the lifting-pack rig', async () => {
  for (const [id, wheels] of [['vilkha', 8], ['sapsan', 10]]) {
    const cfg = cfgOf(id);
    assert.equal(cfg.machine, true);
    assert.equal(cfg.rig, 'tel');
    assert.equal(cfg.phases, MACHINE_PHASES.launcher);
    forgetTerrain();
    const v = await viewerFor(id), m = new Machine(v, cfg);
    v.sim = m;
    await m.terrain.loading;
    assert.ok(m.rig instanceof TelLauncher, `${id}: the rig is built`);
    assert.equal(m.wheels.wheels.length, wheels);
    assert.deepEqual(m.controls.map(c => c.id), ['up', 'down', 'left', 'right', 'fire', 'salvo', 'reload', 'follow']);
    assert.equal(new Set(m.controls.map(c => c.code)).size, m.controls.length);
    m.dispose();
  }
});

test('Vilkha: the machine stops, the jacks find the sloping ground, the pack rises, a shot sheds a cap as debris and the rocket flies', async () => {
  forgetTerrain();
  const v = await viewerFor('vilkha'), m = new Machine(v, cfgOf('vilkha'));
  v.sim = m;
  await m.terrain.loading;
  m.set('march');
  assert.ok(run(m, 12, x => x.S.speed > 8));
  m.set('position');
  run(m, 1);
  assert.equal(m.rig.S.jack, 0, 'the jacks wait for the machine to stop');
  assert.ok(run(m, 25, x => x.rig.canFire()), 'then the launcher deploys');
  assert.equal(m.S.speed, 0);
  run(m, 3);
  assert.ok(m.rig.S.lift === 1);
  // п’яти стоять на землі: нижня площина п’яти на висоті рельєфу під нею
  for (const leg of m.rig.r.legs) {
    const under = new Vector3(leg.bottom.x, leg.foot.position.y - .03, leg.bottom.z);
    assert.ok(Math.abs(m.gapAt(under)) < .06, `the foot stands on the ground (${m.gapAt(under).toFixed(3)} m above)`);
  }
  const body = m.pose();
  assert.ok(body > m.k * m.S.y + .5, 'the camera is pulled up toward the raised pack');
  // постріл: ракета, кришка-уламок з тієї ж геометрії, одна на трубу
  const cap = m.rig.r.caps[0].group, capMesh = cap.children[0], at = cap.getWorldPosition(new Vector3());
  v.scene.updateMatrixWorld(true);
  m.press('fire');
  assert.equal(m.flight.list.length, 1);
  assert.equal(m.debris.list.length, 1);
  const piece = m.debris.list[0].m;
  assert.equal(piece.geometry, capMesh.geometry, 'the same geometry as in the model');
  assert.equal(piece.material, capMesh.material);
  assert.ok(piece.scale.distanceTo(new Vector3(1, 1, 1)) < 1e-6, 'a metre in the world is a metre in the model');
  assert.ok(m.world.localToWorld(piece.position.clone()).distanceTo(at) < 1e-6, 'the cap starts where it sat');
  assert.equal(cap.visible, false);
  assert.equal(m.rocketFor('olkha'), m.rocketFor('olkha'), 'the procedural rocket is built once');
  assert.equal(m.flight.list[0].profile, ROCKETS.olkha);
  assert.ok(run(m, 6, x => !x.debris.busy), 'the cap falls or flies out');
  assert.ok(run(m, 20, x => !x.flight.busy), 'the rocket is gone');
  // Закриття сцени: нічого не лишається, геометрію процедурної ракети звільнено
  let freed = 0;
  m.rocketFor('olkha').traverse(o => { if (o.isMesh) o.geometry.addEventListener('dispose', () => freed++); });
  m.dispose();
  assert.ok(freed > 0, 'the procedural rocket is released');
  assert.equal(m.debris.list.length, 0);
  assert.equal(cap.visible, true, 'the cap is back on the tube');
  assert.ok(m.rig.stowed() && m.rig.S.ammo === 12);
});

test('Sapsan: the lids open before the rocket leaves, and the vertical start leans into the range direction', async () => {
  forgetTerrain();
  const v = await viewerFor('sapsan', { terrain: 'fail' }), m = new Machine(v, cfgOf('sapsan'));
  v.sim = m;
  await m.terrain.loading;
  m.set('position');
  assert.ok(run(m, 25, x => x.rig.canFire()));
  m.press('fire');
  assert.equal(m.flight.list.length, 0, 'the lids are still opening');
  assert.equal(m.rig.S.wait, 1);
  assert.match(m.status(), /^Люки контейнерів відкриваються/);
  assert.ok(run(m, 3, x => x.flight.busy));
  const r = m.flight.list[0];
  assert.equal(r.profile, ROCKETS.otrk);
  assert.equal(m.debris.list.length, 0, 'there are no caps on a container');
  assert.ok(r.d.y > .9);
  run(m, 3.5);
  assert.ok(r.d.y < .9 && r.d.x > .2, `the rocket leans (${r.d.toArray().map(x => x.toFixed(2))})`);
  m.dispose();
});

test('the follow camera is a switch on the machine: it moves the look point to the rocket in flight and returns after it', async () => {
  forgetTerrain();
  const v = await viewerFor('sapsan', { terrain: 'fail' }), m = new Machine(v, cfgOf('sapsan'));
  v.sim = m;
  await m.terrain.loading;
  m.set('position');
  assert.ok(run(m, 25, x => x.rig.canFire()));
  let state = null;
  m.onState = u => { state = u; };
  m.report(true);
  assert.equal(state.on.follow, false);
  assert.equal(m.keyDown({ code: 'KeyC' }), true);
  assert.equal(m.follow, true);
  assert.equal(state.on.follow, true, 'the button shows that it is on');
  m.keyDown({ code: 'KeyC' });
  assert.equal(m.follow, false);
  m.press('follow');
  m.press('fire');
  assert.ok(run(m, 4, x => x.flight.busy && x.rig.S.ammo === 1));
  run(m, 2.5);
  const r = m.flight.list[0], want = m.world.localToWorld(r.m.position.clone());
  assert.ok(m.look.length() > 5, `the look point moves up (${m.look.length().toFixed(1)})`);
  assert.ok(m.look.y > 0 && Math.abs(m.look.y + m.focusY() - want.y) < want.y * .5, 'toward the rocket');
  const focus = m.pose();
  assert.ok(Number.isFinite(focus));
  // ракета зникла: ціль повертається до машини
  assert.ok(run(m, 20, x => !x.flight.busy));
  run(m, 6);
  assert.ok(m.look.length() < .05, `the camera comes back (${m.look.length().toFixed(3)})`);
  // стеження вимкнено: друга ракета не рухає ціль
  m.press('follow');
  assert.equal(m.follow, false);
  m.press('fire');
  assert.ok(run(m, 4, x => x.flight.busy), 'the second container fires at once: the lids are open');
  run(m, 2.5);
  assert.ok(m.look.length() < .01, `the look point stays on the machine (${m.look.length().toFixed(4)})`);
  m.dispose();
});

test('without animation Vilkha deploys at once even after a march, a shot only uses up a tube and there is no follow switch', async () => {
  forgetTerrain();
  const v = await viewerFor('vilkha', { motion: false, terrain: 'fail' }), m = new Machine(v, cfgOf('vilkha'));
  v.sim = m;
  await m.terrain.loading;
  assert.deepEqual(m.controls.map(c => c.id), ['up', 'down', 'left', 'right', 'fire', 'salvo', 'reload']);
  m.set('march');
  assert.ok(m.S.speed === 16 && m.S.dist >= 40);
  m.set('position');
  assert.equal(m.S.speed, 0);
  assert.ok(m.rig.S.jack === 1 && m.rig.S.lift === 1, 'the jacks and the pack are at the end of their travel');
  assert.ok(m.rig.canFire());
  m.press('fire');
  assert.equal(m.rig.S.ammo, 11);
  assert.equal(m.flight.list.length + m.debris.list.length, 0, 'nothing is drawn in flight without animation');
  assert.equal(m.rig.r.caps[0].group.visible, false, 'but the tube is open');
  m.press('salvo');
  assert.equal(m.rig.S.ammo, 11, 'a salvo with no flight is not queued');
  m.hold('up', true); m.hold('up', false);
  assert.ok(m.rig.S.elev > 45 && m.rig.S.elev <= 65);
  m.set('stow');
  assert.ok(m.rig.stowed());
  m.dispose();
});

test('the height of a point above the ground follows the tilt of the body on the slope', async () => {
  forgetTerrain();
  const v = await viewerFor('vilkha'), m = new Machine(v, cfgOf('vilkha'));
  v.sim = m;
  await m.terrain.loading;
  const S = m.S;
  Object.assign(S, { dist: 7, y: .3, pitch: .12, roll: -.05 });
  for (const p of [new Vector3(-3.45, .65, 1.26), new Vector3(3, 1, -1), new Vector3(0, 0, 0)]) {
    const q = p.clone().applyEuler(new Euler(S.roll, 0, S.pitch, 'XYZ'));
    const want = q.y + S.y - m.height(S.dist + q.x, q.z);
    assert.ok(Math.abs(m.gapAt(p) - want) < 1e-9, `${p.toArray()}: ${m.gapAt(p).toFixed(4)} vs ${want.toFixed(4)}`);
  }
  assert.ok(Math.abs(m.ctx.speed() - S.speed) < 1e-12);
  m.dispose();
  forgetTerrain();
  const flat = await viewerFor('vilkha', { terrain: 'fail' }), f = new Machine(flat, cfgOf('vilkha'));
  flat.sim = f;
  await f.terrain.loading;
  assert.ok(f.S.y < .05, 'the body lies on level ground');
  assert.ok(Math.abs(f.gapAt(new Vector3(0, .65, 0)) - (.65 + f.S.y)) < 1e-12, 'level ground at y = 0: the height of a point is its height plus the lift of the body');
  f.dispose();
});
