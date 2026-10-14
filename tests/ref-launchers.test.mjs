// Пускові установки з контейнерами (ref-launchers.js) на справжніх моделях HIMARS і M270: вузли знайдено, гідроциліндри йдуть
// за установкою так само, як за кліпом моделі, пуски витрачають труби, заряджання доводить кліп до кінця.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationMixer, Group, Vector3 } from 'three';
import { ROCKETS } from '../src/ref-flight.js';
import { LAUNCHERS } from '../src/ref-rig-data.js';
import { PodLauncher, buildPodRig } from '../src/ref-launchers.js';
import { loadGlbScene } from './helpers/glb-scene.mjs';

const MODELS = { himars: 'm142-himars', m270: 'm270-mlrs' };

async function rigOf(id) {
  const { scene, animations } = await loadGlbScene(MODELS[id], { fresh: true });
  scene.updateMatrixWorld(true);
  return { scene, clip: animations[0], spec: LAUNCHERS[id] };
}

function fakeCtx() {
  const ctx = { log: [], l: null, flight: { busy: false, launched: [] } };
  ctx.launch = (kind, tpl, p, d) => ctx.flight.launched.push({ profile: ROCKETS[kind], p: p.clone(), d: d.clone() });
  ctx.flying = () => ctx.flight.busy;
  ctx.phase = id => ctx.l.enter(id);
  ctx.toast = (text, s) => ctx.log.push(text);
  ctx.rocket = () => new Group();
  ctx.muzzleToWorld = (p, d) => ({ p, d });
  return ctx;
}

function launcherOf(rig) {
  const ctx = fakeCtx();
  ctx.l = new PodLauncher(rig, ctx);
  return ctx;
}

const snapshot = rig => rig.rest.map(({ node }) => [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.visible]);

for (const id of ['himars', 'm270']) {
  test(`${id}: the rig finds every node, holes and anchors, and leaves the model as it was`, async () => {
    const { scene, clip, spec } = await rigOf(id);
    const rig = buildPodRig(scene, spec, clip);
    assert.ok(rig, 'rig is built');
    assert.equal(rig.struts.length, spec.struts?.length ?? spec.nodes.struts.length);
    assert.equal(rig.anchor.length, rig.struts.length);
    assert.ok(rig.anchor.every(a => a instanceof Vector3 && Number.isFinite(a.x + a.y + a.z)));
    for (const pod of rig.pods) {
      assert.equal(pod.holes.length, spec.tubes.length, 'one hole per tube');
      assert.ok(pod.holes.every(h => !h.visible) && !pod.bigHole.visible && !pod.plate.visible, 'holes start hidden');
      assert.equal(pod.holes[0].parent, pod.full);
    }
    // вузли після побудови стоять там, де стояли
    const before = snapshot(rig);
    const again = buildPodRig(scene, spec, clip);
    assert.deepEqual(snapshot(again), before);
    assert.equal(buildPodRig(scene, { ...spec, nodes: { ...spec.nodes, arm: 'немає_такого' } }, clip), null, 'a node is missing');
    assert.equal(buildPodRig(scene, spec, null), null, 'no clip');
  });
}

for (const [id, from, to] of [['himars', 0, 28], ['m270', 0, 24]]) {
  test(`${id}: hydraulic struts follow the launcher the way the model clip moves them`, async () => {
    const { scene, clip, spec } = await rigOf(id);
    const rig = buildPodRig(scene, spec, clip);
    const mixer = new AnimationMixer(scene);
    mixer.clipAction(clip).play();
    const a = new Vector3();
    let worstAngle = 0, worstLen = 0;
    for (let t = from; t <= to + 1e-3; t += .2) {
      mixer.setTime(t);
      rig.arm.updateMatrix();
      rig.struts.forEach((s, i) => {
        s.updateMatrix();
        a.copy(rig.anchor[i]).applyMatrix4(rig.arm.matrix);
        const dx = a.x - s.position.x, dy = a.y - s.position.y;
        worstAngle = Math.max(worstAngle, Math.abs(Math.atan2(-dx, dy) - s.rotation.z));
        worstLen = Math.max(worstLen, Math.abs(Math.hypot(dx, dy) - spec.rodLen[i] - rig.rods[i].position.y));
      });
    }
    mixer.stopAllAction(); mixer.uncacheRoot(scene);
    // сам кліп автора наближений (до 2,5° і 4 см від точного положення), формула не гірша
    assert.ok(worstAngle < .05, `angle error ${worstAngle.toFixed(4)} rad`);
    assert.ok(worstLen < .05, `rod length error ${worstLen.toFixed(4)} m`);
  });
}

test('HIMARS: deploys, aims, fires tube after tube, shows dark holes and reloads with the model clip', async () => {
  const { scene, clip, spec } = await rigOf('himars');
  const rig = buildPodRig(scene, spec, clip);
  const ctx = launcherOf(rig), l = ctx.l, S = l.S;
  l.step(.016);
  assert.equal(S.phase, 'park');
  assert.equal(l.canFire(), false, 'cannot fire in the march position');
  assert.equal(l.ui().locks.up, true, 'aiming is locked while parked');
  l.enter('position');
  for (let i = 0; i < 400 && S.deploy < 1; i++) l.step(.016);
  assert.equal(S.deploy, 1);
  assert.ok(l.canFire());
  assert.equal(l.ui().locks.up, false);
  // наведення: тримаємо «підняти» пів секунди — 22°/с, не вище межі
  const e0 = S.elev;
  l.setHold('up', true);
  for (let i = 0; i < 30; i++) l.step(1 / 60);
  assert.ok(Math.abs(S.elev - (e0 + spec.elev.rate / 2)) < 1, `elevation ${S.elev.toFixed(1)}°`);
  for (let i = 0; i < 300; i++) l.step(1 / 60);
  assert.equal(S.elev, spec.elev.max, 'the upper limit holds');
  l.setHold('up', false);
  for (let i = 0; i < 40; i++) l.step(1 / 60);
  l.setHold('left', true);
  for (let i = 0; i < 400; i++) l.step(1 / 60);
  assert.equal(S.trav, spec.trav.max, 'traverse stops at the limit');
  l.setHold('left', false);
  // стан наведення не накопичується від кадру до кадру
  for (let i = 0; i < 40; i++) l.step(1 / 60);
  const q = rig.arm.quaternion.clone(), qt = rig.turret.quaternion.clone();
  for (let i = 0; i < 30; i++) l.step(1 / 60);
  assert.ok(Math.abs(rig.arm.quaternion.angleTo(q)) < 1e-6 && Math.abs(rig.turret.quaternion.angleTo(qt)) < 1e-6, 'static aim does not drift');
  // пуски: шість труб GMLRS по одній
  for (let i = 0; i < 6; i++) {
    assert.equal(S.ammo, 6 - i);
    l.press('fire');
    assert.equal(rig.pods[0].holes.filter(h => h.visible).length, i + 1, `${i + 1} dark holes`);
  }
  assert.equal(ctx.flight.launched.length, 6);
  assert.ok(ctx.flight.launched.every(x => x.profile.name === 'GMLRS' && Math.abs(x.d.length() - 1) < 1e-9));
  const spread = new Set(ctx.flight.launched.map(x => x.p.toArray().map(v => v.toFixed(3)).join()));
  assert.equal(spread.size, 6, 'six different tubes');
  l.step(.016);
  assert.equal(S.ammo, 0);
  assert.ok(rig.pods[0].empty.visible && !rig.pods[0].full.visible, 'the empty pod is shown');
  assert.equal(l.canFire(), false);
  assert.equal(l.ui().locks.reload, false, 'reload opens when the pod is empty');
  l.press('fire');
  assert.equal(ctx.flight.launched.length, 6, 'nothing to fire');
  // заряджання: кліп доходить до кінця, контейнер замінено
  l.press('reload');
  assert.equal(S.reload, 1);
  let steps = 0;
  while (S.reload && steps++ < 3000) l.step(1 / 30);
  assert.equal(S.reload, 0, 'reload finished');
  assert.equal(S.ammo, 6);
  assert.ok(rig.pods[0].full.visible && !rig.pods[0].empty.visible);
  assert.ok(rig.pods[0].holes.every(h => !h.visible), 'new pod has no holes');
  assert.ok(ctx.log.some(t => /Контейнер замінено/.test(t)), 'the change is announced');
  // тип ракети: ATACMS — одна на контейнер
  l.press('type');
  assert.equal(S.type, 'atacms');
  assert.equal(S.ammo, 1);
  assert.ok(rig.pods[0].plate.visible, 'the plate of the single-missile pod');
  l.press('fire');
  assert.equal(ctx.flight.launched.at(-1).profile.name, 'ATACMS');
  assert.ok(rig.pods[0].bigHole.visible && rig.pods[0].full.visible, 'one big hole, the pod stays');
  // повернення до вихідного стану моделі
  const rest = snapshot(rig);
  l.dispose();
  const after = rig.rest.map(({ node }) => [node.position.toArray(), node.quaternion.toArray(), node.scale.toArray(), node.visible]);
  assert.deepEqual(after, rest.map((r, i) => [rig.rest[i].p.toArray(), rig.rest[i].q.toArray(), rig.rest[i].s.toArray(), rig.rest[i].v]));
  assert.ok(rig.pods[0].holes.every(h => !h.visible) && !rig.pods[0].plate.visible);
});

test('M270: two pods fire in turn, alternate rows of holes and swap packs one by one', async () => {
  const { scene, clip, spec } = await rigOf('m270');
  const rig = buildPodRig(scene, spec, clip);
  const ctx = launcherOf(rig), l = ctx.l, S = l.S;
  l.enter('position');
  for (let i = 0; i < 400 && S.deploy < 1; i++) l.step(.016);
  assert.ok(l.canFire());
  // перша ракета з правого пакета (контейнер 0), друга з лівого, далі по черзі
  l.press('fire'); l.press('fire'); l.press('fire');
  assert.equal(rig.pods[0].holes.filter(h => h.visible).length, 2);
  assert.equal(rig.pods[1].holes.filter(h => h.visible).length, 1);
  assert.equal(S.ammo, 9);
  // залп «усе, що є»: залишок вилітає з паузою між пусками
  l.press('salvo');
  let steps = 0;
  while ((S.queue || S.ammo) && steps++ < 4000) l.step(1 / 30);
  assert.equal(S.ammo, 0);
  assert.equal(ctx.flight.launched.length, 12);
  l.step(.016);
  assert.ok(rig.pods.every(p => p.empty.visible && !p.full.visible), 'both packs are empty');
  l.press('reload');
  steps = 0;
  while (S.reload && steps++ < 4000) l.step(1 / 30);
  assert.equal(S.ammo, 12);
  assert.ok(rig.pods.every(p => p.full.visible && !p.empty.visible && p.holes.every(h => !h.visible)));
  // ATACMS: по одній у кожному пакеті
  l.press('type');
  assert.equal(S.ammo, 2);
  l.press('fire'); l.press('fire');
  assert.ok(rig.pods.every(p => p.bigHole.visible));
  assert.equal(l.status('шлях'), 'Вогнева позиція · кут ' + Math.round(S.elev) + '° · поворот ' + Math.round(S.trav) + '° · 0 ракет');
  l.dispose();
});

test('the launcher refuses to fire while the rocket model is missing, and settle() finishes every movement', async () => {
  const { scene, clip, spec } = await rigOf('himars');
  const rig = buildPodRig(scene, spec, clip);
  const ctx = launcherOf(rig), l = ctx.l, S = l.S;
  ctx.rocket = () => null;
  l.enter('position');
  l.settle();
  assert.equal(S.deploy, 1);
  assert.equal(l.canFire(), false, 'no rocket model yet');
  assert.equal(l.ui().locks.fire, true);
  ctx.rocket = () => new Group();
  l.press('salvo');
  l.settle();
  assert.equal(S.queue, 0, 'settle() does not fire the salvo without flight');
  S.ammo = 0; l.applyAmmo();
  l.press('reload');
  l.settle();
  assert.equal(S.reload, 0);
  assert.equal(S.ammo, 6);
  l.enter('park');
  l.settle();
  assert.equal(S.deploy, 0);
  l.dispose();
});
