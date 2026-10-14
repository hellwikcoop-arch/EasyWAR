// Сценарії «Інтерактивної моделі» довідника (ref-sim-data.js, ref-sim.js): кожна стаття з моделлю без окремого
// переглядача має дії за своїм типом, і кожна дія доходить до кінця — літак злітає й сідає, гелікоптер зависає й
// глушить гвинт, ракета й бомба вражають ціль, пускова дає повний залп. Сцена без браузера: полотно — заглушка.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ENTRIES, viewerOf } from '../src/ref-data.js';
import { ENTRIES as ART_ENTRIES } from '../src/artillery-ref-data.js';
import { SIM_PHASES, simOf, terrainOf } from '../src/ref-sim-data.js';

const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const { Sim, rotorPlan } = await import('../src/ref-sim.js');

// Заглушка RefViewer: модель — брусок завдовжки як нормалізований літак, із «щоглою» гвинта зверху.
function fakeViewer() {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(4.6, 1, 1), new MeshBasicMaterial()));
  const mast = new Mesh(new BoxGeometry(.1, .3, .1), new MeshBasicMaterial());
  mast.position.set(.4, .6, 0); group.add(mast);
  const blade = new Mesh(new BoxGeometry(3.6, .02, .1), new MeshBasicMaterial());
  blade.position.set(.4, .7, 0); group.add(blade);
  group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(group);
  return {
    group, entry: { group, size: box.getSize(new Vector3()), min: box.min.clone() },
    scene: new Scene(), camera: new PerspectiveCamera(26, 2, .1, 80), renderer: { capabilities: { getMaxAnisotropy: () => 1 } },
    stage: { floor: { visible: true } }, target: new Vector3(), motion: true, winged: true, open: 1, yaw: 0, pose() {},
  };
}

function run(sim, seconds, until = () => false) {
  for (let t = 0; t < seconds; t += .05) { sim.step(.05); if (until(sim.S)) return true; }
  return false;
}

const all = [...ENTRIES.map(e => [e, simOf(e, viewerOf)]), ...ART_ENTRIES.map(e => [e, simOf(e)])];

test('every reference model without its own viewer has an interactive scenario', () => {
  for (const e of ENTRIES) {
    if (!e.model) continue;
    const sim = simOf(e, viewerOf);
    if (viewerOf(e)) { assert.equal(sim, null, `${e.id}: has its own viewer`); continue; }
    assert.ok(sim && SIM_PHASES[sim.kind], `${e.id}: scenario`);
  }
  for (const e of ART_ENTRIES) {
    const sim = simOf(e);
    if (e.group === 'charge' || e.group === 'fuze') assert.equal(sim, null, `${e.id}: a propellant charge or a fuze does nothing on its own`);
    else if (e.model) assert.ok(sim, `${e.id}: scenario`);
  }
  for (const [kind, phases] of Object.entries(SIM_PHASES)) {
    assert.ok(phases.length >= 3, kind);
    assert.ok(['airfield', 'road', 'field'].includes(terrainOf(kind)), kind);
    for (const [id, label, text] of phases) assert.ok(id && label && text.endsWith('.'), `${kind}.${id}`);
  }
  assert.ok(simOf(ENTRIES.find(e => e.id === 'mi35')).phases.some(p => p[0] === 'attack'), 'armed helicopter fires rockets');
  assert.ok(!simOf(ENTRIES.find(e => e.id === 'mi26')).phases.some(p => p[0] === 'attack'), 'transport helicopter does not');
  assert.match(simOf(ENTRIES.find(e => e.id === 'vilkha')).phases.find(p => p[0] === 'fire')[2], /умовно/);
});

test('every scenario plays to the end: take-off and landing, hover, strike, salvo', () => {
  for (const [e, cfg] of all) {
    if (!cfg) continue;
    const v = fakeViewer(), sim = new Sim(v, cfg), S = sim.S, ids = cfg.phases.map(p => p[0]);
    const go = id => { assert.ok(ids.includes(id), `${e.id}: phase ${id}`); sim.set(id); };
    switch (cfg.kind) {
      case 'plane':
        go('takeoff');
        assert.ok(run(sim, 60, s => s.air && s.alt > 6), `${e.id}: takes off`);
        go('land');
        assert.ok(run(sim, 120, s => !s.air && s.speed === 0), `${e.id}: lands and stops`);
        break;
      case 'heli':
        go('start');
        assert.ok(run(sim, 20, s => s.rpm > .9) && !S.air, `${e.id}: spins up on the ground`);
        go('hover');
        assert.ok(run(sim, 20, s => s.air && s.alt > 1.4), `${e.id}: hovers`);
        go('cruise');
        assert.ok(run(sim, 30, s => s.speed > 15 && s.pitch < 0), `${e.id}: flies nose down`);
        if (cfg.fire) { go('attack'); assert.ok(run(sim, 20, () => sim.marks.children.length > 0), `${e.id}: rockets hit the ground`); }
        go('land');
        assert.ok(run(sim, 60, s => !s.air && s.rpm < .05), `${e.id}: lands and stops the rotor`);
        assert.ok(sim.rotors.length === (cfg.rotor && cfg.rotor.coax ? 2 : 1), `${e.id}: rotor discs`);
        break;
      case 'launcher':
        go('march');
        assert.ok(run(sim, 15, s => s.travel > 10), `${e.id}: drives`);
        go('fire');
        assert.ok(run(sim, 20, s => s.fired === cfg.salvo), `${e.id}: fires the whole salvo`);
        assert.ok(S.speed < .2, `${e.id}: stops before firing`);
        break;
      case 'vehicle':
        go('march');
        assert.ok(run(sim, 15, s => s.travel > 10), `${e.id}: drives`);
        go('park');
        assert.ok(run(sim, 15, s => s.speed < .05), `${e.id}: stops`);
        break;
      default: {
        // Боєприпас: пуск (скидання, постріл) і ураження. Некерована ракета й снаряд падають самі.
        go(ids[1]);
        assert.ok(S.flying && S.alive, `${e.id}: leaves the launcher`);
        if (!['rocket', 'shell'].includes(cfg.kind)) { run(sim, 4); go('strike'); }
        assert.ok(run(sim, 90, s => !s.alive), `${e.id}: hits the target`);
        assert.equal(v.group.visible, false, `${e.id}: the munition is gone after the hit`);
        go(ids[0]);
        assert.ok(S.alive && v.group.visible && !S.flying, `${e.id}: back to the start`);
      }
    }
    sim.dispose();
    assert.equal(v.scene.children.length, 0, `${e.id}: the scene is cleaned up`);
    assert.equal(v.stage.floor.visible, true, `${e.id}: studio floor restored`);
  }
});

test('without animation a phase shows its settled pose and a strike stops just before the hit', () => {
  const plane = ENTRIES.find(e => e.id === 'an26'), bomb = ENTRIES.find(e => e.id === '62');
  const v1 = fakeViewer(); v1.motion = false;
  const s1 = new Sim(v1, simOf(plane, viewerOf));
  s1.set('takeoff');
  assert.ok(s1.S.air && s1.S.alt > 6, 'take-off settles in the climb');
  assert.equal(s1.fx.list.length, 0, 'no particles without animation');
  const v2 = fakeViewer(); v2.motion = false;
  const s2 = new Sim(v2, simOf(bomb, viewerOf));
  s2.set('strike');
  assert.ok(s2.S.alive && v2.group.visible && s2.S.alt < 9, 'the bomb is shown diving, not exploded');
});

test('rotor disc sits on the hub and spans the blades', () => {
  const pts = [0, 0, 0, 2, 0, 0, .4, 1, 0, 2.2, .98, 0, -1.4, .98, 0, .4, .98, 1.8];
  const [d] = rotorPlan(pts, new Vector3(4.6, 1, 1));
  assert.deepEqual([d.x, d.z], [.4, 0]);
  assert.ok(Math.abs(d.r - 1.8) < 1e-9);
  assert.equal(rotorPlan(pts, new Vector3(4.6, 1, 1), { coax: .2 }).length, 2);
});
