// Піднімні пускові Вільха й Сапсан (ref-tel.js, ref-rig-data.js: TELS) на справжніх моделях: вузли знайдено й вирізано, модель у похідному
// положенні виглядає як до побудови, опори й гідроциліндри йдуть за пакетом, пуски витрачають труби, заряджання повертає боєкомплект.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Vector3 } from 'three';
import { ROCKETS } from '../src/ref-flight.js';
import { TELS, liftEnds, ordFor, tubeGrid } from '../src/ref-rig-data.js';
import { TelLauncher, buildTelRig } from '../src/ref-tel.js';
import { loadGlbScene } from './helpers/glb-scene.mjs';

const FILES = { vilkha: 'vilkha', sapsan: 'sapsan' };
const D2R = Math.PI / 180;

async function rigOf(id, spec = TELS[id]) {
  const { scene } = await loadGlbScene(FILES[id], { fresh: true });
  scene.updateMatrixWorld(true);
  const before = measure(scene);
  return { scene, spec, before, rig: buildTelRig(scene, spec) };
}

// Видимі меші моделі без допоміжних накладок: габарит і кількість трикутників. Побудова рига не має їх змінити.
function measure(scene) {
  scene.updateMatrixWorld(true);
  const box = new Box3();
  let tris = 0;
  scene.traverseVisible(o => {
    if (!o.isMesh || o.userData.decal) return;
    box.expandByObject(o, true);
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return { box, tris };
}

// Пускова із заглушкою рушія: швидкість машини, висота землі під точкою (над рівнем землі y = 0) і журнал пусків та кришок.
function launcherOf(rig, { speed = 0, ground = 0 } = {}) {
  const ctx = { v: speed, ground, launched: [], sheds: [], toasts: [], l: null };
  ctx.speed = () => ctx.v;
  ctx.gap = p => p.y - ctx.ground;
  ctx.phase = id => ctx.l.enter(id);
  ctx.toast = t => ctx.toasts.push(t);
  ctx.rocket = () => new Group();
  ctx.launch = (kind, tpl, p, d, opts) => ctx.launched.push({ kind, p: p.clone(), d: d.clone(), opts });
  ctx.flying = () => false;
  ctx.muzzleToWorld = (p, d) => ({ p, d });
  ctx.shed = (node, v, w) => ctx.sheds.push({ node, v: v.clone(), w: w.clone() });
  ctx.l = new TelLauncher(rig, ctx);
  return ctx;
}

const run = (l, seconds, until = () => false) => { for (let t = 0; t < seconds; t += 1 / 30) { l.step(1 / 30); if (until(l)) return true; } return false; };
// До вогневої позиції; пакет можна пускати з 97 % підйому, але кути міряють, коли він піднятий цілком.
const deploy = (l, full = true) => {
  l.enter('position');
  assert.ok(run(l, 15, x => x.canFire()), 'the launcher reaches the firing position');
  if (full) assert.ok(run(l, 3, x => x.S.lift === 1));
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('tube grid, firing order and the lift cylinder ends are pure functions of the table', () => {
  assert.deepEqual(tubeGrid(1, [3, 2], [.5, -.5, 0]), [[1, 3, .5], [1, 3, -.5], [1, 3, 0], [1, 2, .5], [1, 2, -.5], [1, 2, 0]]);
  for (const n of [0, 1, 2, 3, 6, 7, 12, 16]) {
    const ord = ordFor(n);
    assert.equal(ord.length, n);
    assert.deepEqual([...ord].sort((a, b) => a - b), [...Array(n).keys()], `n = ${n}: every tube exactly once`);
  }
  assert.deepEqual(ordFor(12), [0, 3, 1, 2, 4, 7, 5, 6, 8, 11, 9, 10], 'the table of the author for the 12-tube pack');
  assert.deepEqual(ordFor(2), [0, 1]);
  for (const [id, spec] of Object.entries(TELS)) {
    assert.equal(spec.tubes.length, spec.ammo, `${id}: a tube for every rocket`);
    assert.ok(ROCKETS[spec.rocket] && ROCKETS[spec.rocket].procedural, `${id}: the rocket has a procedural model`);
    assert.ok(spec.elev.min < spec.elev.init && spec.elev.init < spec.elev.max, `${id}: elevation range`);
    // без підйому й повороту циліндр лежить так, як задано в таблиці
    const [e0, e1] = liftEnds(spec, 0, 0), [px, py] = spec.pivot;
    assert.deepEqual(e0.a, [spec.lifts.anchor[0], spec.lifts.anchor[1], -spec.lifts.z]);
    assert.ok(near(e1.b[0], px + spec.lifts.att[0]) && near(e1.b[1], py + spec.lifts.att[1]) && near(e1.b[2], spec.lifts.z));
  }
});

for (const id of Object.keys(TELS)) {
  test(`${id}: the rig is built from the model's own meshes and the stowed model looks as it did`, async () => {
    const { scene, spec, before, rig } = await rigOf(id);
    assert.ok(rig, 'rig is built');
    const after = measure(scene);
    assert.equal(after.tris, before.tris, 'no triangle is lost or doubled by carving');
    for (const k of ['min', 'max']) assert.ok(after.box[k].distanceTo(before.box[k]) < 1e-4, `the box ${k} is unchanged`);
    // ланцюг шарнірів у спокої — одиничне перетворення
    rig.frame.updateWorldMatrix(true, false);
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    rig.frame.matrixWorld.elements.forEach((e, i) => assert.ok(near(e, I[i], 1e-9), `identity [${i}]`));
    // опори: два боки, шток тонкий і короткий, п’ята плоска; обидва тіла стоять на місці опори в моделі
    assert.equal(rig.legs.length, 2);
    for (const leg of rig.legs) {
      const rod = new Box3().setFromObject(leg.rod).getSize(new Vector3()), foot = new Box3().setFromObject(leg.foot).getSize(new Vector3());
      assert.ok(rod.x < .2 && rod.z < .2 && Math.abs(rod.y - spec.jacks.rod.top + spec.jacks.rod.bottom) < .03, `rod ${rod.toArray().map(v => v.toFixed(2))}`);
      assert.ok(foot.y < .1 && foot.x > .25 && foot.x < .5, `foot ${foot.toArray().map(v => v.toFixed(2))}`);
      assert.ok(near(leg.rod.position.x, spec.jacks.x, 1e-9) && Math.abs(Math.abs(leg.rod.position.z) - spec.jacks.z) < 1e-9);
    }
    assert.equal(rig.lifts.length, 2);
    assert.ok(rig.lifts.every(l => !l.g.visible), 'the cylinders are hidden while the launcher is down');
    assert.equal(rig.holes.length, spec.tubes.length);
    assert.equal(rig.packs.length, 1);
    assert.equal(rig.packs[0].parent, rig.frame);
  });
}

test('vilkha: every tube has its own red cap carved from the pack, and the open tubes are dark holes in front of the muzzle', async () => {
  const { rig, spec } = await rigOf('vilkha');
  assert.equal(rig.caps.length, 12);
  assert.equal(new Set(rig.caps.map(c => c.group)).size, 12, 'one distinct cap per tube');
  rig.caps.forEach((c, k) => {
    const [, y, z] = spec.tubes[k];
    assert.ok(Math.hypot(c.center.y - y, c.center.z - z) < .01, `cap ${k} sits on its tube`);
    assert.ok(c.center.x > spec.caps.minX && c.group.parent === rig.frame && c.group.visible);
    const size = new Box3().setFromObject(c.group).getSize(new Vector3());
    assert.ok(size.x < spec.caps.maxW && size.y > .25 && size.y < .35, `cap ${k} is a disc ${size.toArray().map(v => v.toFixed(2))}`);
  });
  assert.ok(rig.holes.every(h => !h.visible && h.userData.decal && near(h.position.x, spec.hole.x, 1e-9)), 'holes are decals and start hidden');
  assert.equal(rig.lids.length, 0);
  assert.equal(rig.keep.length, 0);
});

test('sapsan: no caps, a round lid on a hinge over each container, the cradle stays on the chassis', async () => {
  const { rig, spec } = await rigOf('sapsan');
  assert.ok(rig.caps.every(c => c === null));
  assert.equal(rig.lids.length, 2);
  rig.lids.forEach((hinge, k) => {
    assert.ok(near(hinge.position.y, spec.tubes[k][1] + spec.lid.r, 1e-9) && near(hinge.position.z, spec.tubes[k][2], 1e-9), 'the hinge is at the upper edge of the hole');
    assert.equal(hinge.parent, rig.frame);
    assert.ok(hinge.children.every(c => c.userData.decal));
  });
  assert.ok(rig.holes.every(h => h.visible), 'the holes sit behind the closed lids');
  assert.equal(rig.keep.length, 1);
  assert.notEqual(rig.keep[0].parent, rig.frame, 'the cradle does not rise with the container');
  const cradle = new Box3().setFromObject(rig.keep[0]), pack = new Box3().setFromObject(rig.packs[0]);
  assert.ok(cradle.max.y <= TELS.sapsan.keep.maxY + 1e-6 && pack.min.y >= cradle.max.y - 1e-6, 'the cradle lies under the container');
});

test('the rig refuses a model it does not fit and survives missing jacks', async () => {
  const gone = await rigOf('vilkha', { ...TELS.vilkha, pack: 'немає_такого_вузла' });
  assert.equal(gone.rig, null);
  const off = await rigOf('vilkha', { ...TELS.vilkha, caps: { minX: 3.45, maxW: .01 } });
  assert.equal(off.rig, null, 'no cap fits the tubes: the table is wrong');
  const shifted = await rigOf('vilkha', { ...TELS.vilkha, tubes: TELS.vilkha.tubes.map(([x, y, z]) => [x, y + 1, z]) });
  assert.equal(shifted.rig, null, 'caps farther than 15 cm from every tube');
  const noJacks = await rigOf('vilkha', { ...TELS.vilkha, jacks: { ...TELS.vilkha.jacks, x: 0 } });
  assert.ok(noJacks.rig && noJacks.rig.legs.length === 0, 'without jack parts the launcher still works');
  const l = launcherOf(noJacks.rig).l;
  deploy(l);
  assert.ok(l.canFire());
});

test('vilkha: jacks go down first and only on a stopped machine, then the pack rises on its cylinders', async () => {
  const { rig, spec } = await rigOf('vilkha');
  const ctx = launcherOf(rig, { speed: 8 }), l = ctx.l, S = l.S;
  assert.equal(l.stowed(), true);
  assert.equal(l.speedTarget, spec.march);
  assert.equal(l.canFire(), false);
  assert.equal(l.ui().locks.fire, true);
  assert.deepEqual(l.ui().ammo, { n: 12, max: 12, big: false });
  l.enter('position');
  run(l, 3);
  assert.equal(S.jack, 0, 'the machine is still moving: nothing is lowered');
  ctx.v = 0;
  run(l, spec.stages.jack / 2);
  assert.ok(S.jack > .4 && S.jack < .6 && S.lift === 0, `jacks lower first (${S.jack.toFixed(2)})`);
  assert.ok(run(l, 3, x => x.S.jack === 1));
  assert.ok(S.lift < .5, 'the pack has hardly started rising');
  assert.equal(l.speedTarget, 0, 'with the jacks down the machine cannot march');
  assert.equal(l.status(''), 'Вогнева позиція · пускова піднімається');
  assert.equal(l.canFire(), false);
  assert.ok(run(l, 8, x => x.canFire()));
  assert.ok(Math.abs(S.elev - spec.elev.init) < .01);
  assert.match(l.status(''), /^Вогнева позиція · кут 45° · поворот 0° · 12 ракет$/);
  assert.equal(l.ui().locks.fire, false);
  assert.equal(l.ui().locks.up, false);
  // кут піднятого пакета — кут нахилу труб
  assert.ok(near(rig.pitch.rotation.z, spec.elev.init * D2R * ((x => x * x * (3 - 2 * x))(S.lift)), 1e-6));
  run(l, 1);
  assert.ok(near(rig.pitch.rotation.z, spec.elev.init * D2R, 1e-6));
  assert.ok(rig.lifts.every(c => c.g.visible), 'the cylinders are shown');
  // згортання у зворотному порядку: пакет, потім опори; рухатись можна лише в похідному положенні
  l.enter('stow');
  assert.ok(run(l, spec.stages.lift + 1, x => x.S.lift === 0));
  assert.ok(S.jack > .9, 'the jacks are still down while the pack is');
  assert.equal(l.speedTarget, 0);
  assert.equal(l.status(''), 'Згортання · опори піднімаються');
  assert.ok(run(l, spec.stages.jack + 1, x => x.stowed()));
  assert.equal(l.speedTarget, spec.march);
  assert.ok(near(rig.pitch.rotation.z, 0, 1e-9) && near(rig.yaw.rotation.y, 0, 1e-9));
  assert.ok(rig.lifts.every(c => !c.g.visible));
  assert.equal(l.status(''), 'Згортання · готово до маршу');
  l.enter('park');
  assert.equal(l.status('Стоянка · двигун вимкнено'), 'Стоянка · двигун вимкнено', 'in other phases the machine states its own line');
});

test('the muzzle follows the pack: direction by the elevation and the traverse, point by the hinge', async () => {
  const { rig, spec } = await rigOf('vilkha');
  const l = launcherOf(rig).l;
  deploy(l);
  const [px, py] = spec.pivot;
  for (const [elev, trav] of [[45, 0], [20, 0], [65, 30], [30, -30]]) {
    l.S.elev = l.S.tElev = elev; l.S.trav = l.S.tTrav = trav; l.pose();
    const e = elev * D2R, t = trav * D2R;
    for (const k of [0, 5, 11]) {
      const m = l.muzzle(k), [x, y, z] = spec.tubes[k];
      const bx = (x - px) * Math.cos(e) - (y - py) * Math.sin(e), by = (x - px) * Math.sin(e) + (y - py) * Math.cos(e);
      // поворот навколо вертикалі через шарнір: z вісі пакета змішується з x
      const want = new Vector3(px + bx * Math.cos(t) + z * Math.sin(t), py + by, -bx * Math.sin(t) + z * Math.cos(t));
      assert.ok(m.p.distanceTo(want) < 1e-9, `elev ${elev} trav ${trav} tube ${k}`);
      assert.ok(m.d.distanceTo(new Vector3(Math.cos(e) * Math.cos(t), Math.sin(e), -Math.cos(e) * Math.sin(t))) < 1e-9);
    }
  }
});

test('the aiming limits and the keys: elevation for both, traverse only where the pack can turn', async () => {
  const v = await rigOf('vilkha'), s = await rigOf('sapsan');
  const lv = launcherOf(v.rig).l, ls = launcherOf(s.rig).l;
  lv.setHold('up', true);
  assert.equal(lv.hold.up, 0, 'nothing to aim while the launcher is down');
  deploy(lv); deploy(ls);
  lv.setHold('up', true);
  run(lv, 4);
  assert.equal(lv.S.elev, TELS.vilkha.elev.max);
  lv.setHold('up', false); lv.setHold('down', true);
  run(lv, 5);
  assert.equal(lv.S.elev, TELS.vilkha.elev.min);
  lv.setHold('down', false);
  lv.setHold('left', true);
  run(lv, 3);
  assert.equal(lv.S.trav, TELS.vilkha.trav.max);
  lv.setHold('left', false); lv.setHold('right', true);
  run(lv, 5);
  assert.equal(lv.S.trav, -TELS.vilkha.trav.max);
  lv.releaseAll();
  assert.equal(lv.ui().locks.left, false);
  ls.setHold('left', true);
  assert.equal(ls.hold.left, 0, 'the container does not turn');
  assert.deepEqual([ls.ui().locks.left, ls.ui().locks.right, ls.ui().locks.up], [true, true, false]);
  ls.setHold('down', true);
  run(ls, 5);
  assert.equal(ls.S.elev, TELS.sapsan.elev.min);
  // без анімації кожне натискання — один крок, у межах діапазону
  const before = lv.S.elev;
  lv.nudge('up');
  assert.equal(lv.S.elev, Math.min(TELS.vilkha.elev.max, before + 8));
  // короткий дотик усе одно зрушує пакет
  lv.S.elev = lv.S.tElev = 40;
  lv.setHold('up', true); lv.setHold('up', false);
  run(lv, 1);
  assert.ok(lv.S.elev > 40 + 2, `a tap moves the pack (${lv.S.elev.toFixed(1)}°)`);
  assert.deepEqual(lv.controls.map(c => c.id), ['up', 'down', 'left', 'right', 'fire', 'salvo', 'reload']);
  assert.equal(new Set(lv.controls.map(c => c.code)).size, lv.controls.length, 'keys do not clash');
});

test('vilkha: a launch takes the next tube in the author order, sheds its cap forward and up, and opens the tube', async () => {
  const { rig, spec } = await rigOf('vilkha');
  const ctx = launcherOf(rig), l = ctx.l;
  l.press('fire');
  assert.equal(ctx.launched.length, 0, 'cannot fire from the stowed position');
  deploy(l);
  l.press('fire');
  assert.equal(ctx.launched.length, 1);
  const shot = ctx.launched[0];
  assert.equal(shot.kind, 'olkha');
  assert.ok(near(shot.opts.back, ROCKETS.olkha.procedural.length / 2 + .12, 1e-9), 'the rocket starts inside the tube');
  assert.ok(shot.d.distanceTo(new Vector3(Math.cos(45 * D2R), Math.sin(45 * D2R), 0)) < 1e-6, 'along the tubes');
  assert.ok(shot.p.distanceTo(l.muzzle(0).p) < 1e-9);
  assert.equal(l.S.ammo, 11);
  assert.match(ctx.toasts.at(-1), /^Пуск Вільха · труба 1 з 12$/);
  assert.equal(ctx.sheds.length, 1);
  assert.equal(ctx.sheds[0].node, rig.caps[0].group);
  assert.ok(ctx.sheds[0].v.dot(shot.d) > 10 && ctx.sheds[0].v.y > 5, 'the cap flies forward and up');
  assert.equal(rig.caps[0].group.visible, false);
  assert.equal(rig.holes[0].visible, true);
  assert.equal(rig.caps[1].group.visible, true);
  // залп: решта труб у порядку з таблиці, паузами
  l.press('salvo');
  assert.equal(l.S.queue, 11);
  assert.ok(run(l, 12, x => x.S.ammo === 0));
  assert.equal(ctx.launched.length, 12);
  const order = ctx.sheds.map(s => rig.caps.findIndex(c => c.group === s.node));
  assert.deepEqual(order, ordFor(12));
  assert.equal(l.canFire(), false);
  assert.equal(l.ui().locks.fire, true);
  assert.equal(l.ui().locks.salvo, true);
  assert.ok(rig.caps.every(c => !c.group.visible) && rig.holes.every(h => h.visible), 'every tube is open');
  assert.match(l.status(''), /0 ракет$/);
  // двічі в одну трубу не стріляють: пуск без ракет нічого не робить
  l.press('fire');
  assert.equal(ctx.launched.length, 12);
  assert.equal(spec.ammo, 12);
});

test('the reload lowers the pack, puts the caps back one by one, and raises it again; stowing is refused meanwhile', async () => {
  const { rig, spec } = await rigOf('vilkha');
  const ctx = launcherOf(rig), l = ctx.l, S = l.S;
  l.press('reload');
  assert.equal(S.reload, 0, 'nothing to reload');
  deploy(l);
  l.press('salvo');
  assert.ok(run(l, 12, x => x.S.ammo === 0));
  l.press('reload');
  assert.equal(S.reload, 1);
  assert.equal(l.busy, true);
  assert.equal(l.ui().on.reload, true);
  assert.equal(l.ui().locks.reload, true);
  assert.equal(l.status(''), 'Перезарядження · пускова опускається');
  assert.ok(run(l, 6, x => x.S.reload === 2));
  assert.ok(S.lift < .03 && S.jack === 1, 'the pack is down, the jacks stay');
  assert.equal(l.speedTarget, 0, 'the machine does not move while it reloads');
  run(l, spec.reload / 2);
  const back = rig.caps.filter(c => c.group.visible).length;
  assert.ok(back > 3 && back < 12, `caps return one by one (${back})`);
  assert.equal(rig.holes.filter(h => h.visible).length, 12 - back, 'a hole is covered by its cap');
  assert.equal(l.status(''), 'Перезарядження · встановлюються кришки труб');
  ctx.toasts.length = 0;
  assert.ok(run(l, spec.reload, x => x.S.reload === 3));
  assert.equal(S.ammo, 12);
  assert.ok(ctx.toasts.includes('Боєкомплект поповнено · 12'));
  assert.ok(rig.caps.every(c => c.group.visible) && rig.holes.every(h => !h.visible));
  assert.ok(run(l, 8, x => !x.busy));
  assert.ok(S.lift > .97 && l.canFire(), 'the pack is up again and ready');
  assert.equal(l.ui().locks.reload, true, 'a full load is not reloaded');
});

test('sapsan: the first press opens the lids and waits, the rocket goes when they are open; a salvo is two launches', async () => {
  const { rig, spec } = await rigOf('sapsan');
  const ctx = launcherOf(rig), l = ctx.l, S = l.S;
  deploy(l);
  assert.equal(l.ui().ammo.big, true);
  assert.equal(l.ui().locks.salvo, false);
  l.press('fire');
  assert.equal(S.wait, 1);
  assert.equal(ctx.launched.length, 0, 'the rocket waits for the lids');
  assert.match(ctx.toasts.at(-1), /^Люки контейнерів відкриваються/);
  assert.equal(l.status(''), 'Вогнева позиція · люки відкриваються');
  assert.equal(l.canFire(), false);
  assert.equal(l.ui().locks.reload, true);
  run(l, .15);
  assert.ok(rig.lids[0].rotation.z > 0 && rig.lids[0].rotation.z < 1.75, 'the lids swing open');
  assert.ok(run(l, 3, x => x.S.ammo === 1));
  assert.equal(ctx.launched.length, 1);
  assert.equal(S.wait, 0);
  assert.equal(ctx.launched[0].kind, 'otrk');
  assert.match(ctx.toasts.at(-1), /^Пуск Сапсан · контейнер 1 з 2$/);
  assert.ok(near(ctx.launched[0].opts.back, ROCKETS.otrk.procedural.length / 2 + .12, 1e-9));
  assert.ok(ctx.launched[0].d.y > .9, 'a nearly vertical start');
  assert.equal(ctx.sheds.length, 0, 'no caps on this one');
  assert.ok(near(rig.lids[0].rotation.z, 1.75, 1e-6) && S.lid === 1);
  l.press('fire');
  assert.equal(ctx.launched.length, 2, 'the lids are open: the second goes at once');
  assert.match(ctx.toasts.at(-1), /контейнер 2 з 2$/);
  assert.equal(l.canFire(), false);
  // перезаряджання закриває люки, заміна боєприпасу триває так само
  l.press('reload');
  assert.ok(run(l, spec.stages.lift + 2, x => x.S.reload === 2));
  assert.equal(S.lidT, 0);
  run(l, 2);
  assert.ok(S.lid < .05, 'the lids are closed while the pack is down');
  assert.equal(l.status(''), 'Перезарядження · боєприпас замінюється');
  assert.ok(run(l, spec.reload + spec.stages.lift + 2, x => !x.busy));
  assert.equal(S.ammo, 2);
  // залп із закритими люками: перший пуск відкриває їх, другий іде за паузою
  ctx.launched.length = 0;
  l.press('salvo');
  assert.ok(run(l, 6, x => x.S.ammo === 0));
  assert.equal(ctx.launched.length, 2);
});

test('the jacks reach the ground under them, whatever its height, and no farther than 1.4 m', async () => {
  const { rig, spec } = await rigOf('vilkha');
  const ctx = launcherOf(rig, { ground: -.2 }), l = ctx.l;
  assert.ok(rig.legs.every(leg => leg.rod.scale.y === 1 && leg.foot.position.y === leg.y0), 'raised jacks are the model as it was');
  l.enter('position');
  assert.ok(run(l, spec.stages.jack + .5, x => x.S.jack === 1));
  for (const leg of rig.legs) {
    const gap = leg.bottom.y + .2;
    assert.ok(near(leg.foot.position.y, leg.y0 - gap, 1e-9), `the foot comes down by ${gap.toFixed(2)} m`);
    assert.ok(near(leg.rod.scale.y, 1 + gap / leg.rodLen, 1e-9), 'the rod is stretched to the foot');
  }
  ctx.ground = -5;
  l.pose();
  assert.ok(rig.legs.every(leg => near(leg.foot.position.y, leg.y0 - 1.4, 1e-9)), 'a deep pit does not make the jack longer than 1.4 m');
  ctx.ground = 3;
  l.pose();
  assert.ok(rig.legs.every(leg => near(leg.foot.position.y, leg.y0, 1e-9)), 'the ground above the foot cannot lift it');
});

test('hydraulic cylinders hold both the chassis anchor and the point on the pack through the whole range of elevation and turn', async () => {
  for (const id of Object.keys(TELS)) {
    const { scene, rig, spec } = await rigOf(id);
    const l = launcherOf(rig).l, S = l.S;
    deploy(l);
    const [px, py] = spec.pivot, att = [px + spec.lifts.att[0], py + spec.lifts.att[1]];
    for (const elev of [spec.elev.min, spec.elev.init, spec.elev.max]) for (const trav of spec.trav.max ? [-spec.trav.max, 0, spec.trav.max] : [0]) {
      S.elev = S.tElev = elev; S.trav = S.tTrav = trav; l.pose();
      scene.updateMatrixWorld(true);
      [-1, 1].forEach((side, i) => {
        // точка на пакеті в системі моделі: те, що пакет, поворачивши, робить із точкою кріплення
        const b = new Vector3(att[0], att[1], side * spec.lifts.z).applyMatrix4(rig.frame.matrixWorld);
        const lift = rig.lifts[i], a = new Vector3(spec.lifts.anchor[0], spec.lifts.anchor[1], side * spec.lifts.z);
        assert.ok(lift.g.visible);
        const up = new Vector3(0, 1, 0).applyQuaternion(lift.g.quaternion), len = a.distanceTo(b);
        assert.ok(lift.g.position.distanceTo(a) < 1e-9, `${id}: the cylinder starts at the chassis anchor`);
        assert.ok(up.distanceTo(b.clone().sub(a).normalize()) < 1e-9, `${id}: elev ${elev} trav ${trav}: the cylinder points at the pack`);
        assert.ok(near(lift.rod.position.y + lift.rod.scale.y, len, 1e-9), 'body and rod together are exactly as long as the distance');
        assert.ok(lift.body.scale.y <= 1.4 + 1e-9);
      });
    }
  }
});

test('settle: without animation every transition runs to its end at once; dispose returns the model to the stowed look', async () => {
  const { rig, spec, before, scene } = await rigOf('vilkha');
  const ctx = launcherOf(rig), l = ctx.l, S = l.S;
  l.enter('position');
  l.settle();
  assert.ok(S.jack === 1 && S.lift === 1 && l.canFire());
  assert.ok(near(rig.pitch.rotation.z, spec.elev.init * D2R, 1e-9));
  l.press('salvo');
  assert.equal(S.queue, 12);
  l.settle();
  assert.equal(S.queue, 0, 'a salvo without flight is cancelled: no rockets without a flight');
  l.press('fire');
  l.settle();
  l.enter('stow');
  l.settle();
  assert.ok(l.stowed());
  assert.equal(S.phase, 'stow');
  l.enter('position');
  l.settle();
  l.press('reload');
  l.settle();
  assert.ok(S.reload === 0 || S.ammo === 12);
  // dispose
  S.elev = S.tElev = 30; S.trav = S.tTrav = 12;
  l.press('salvo');
  assert.ok(run(l, 12, x => x.S.ammo === 0));
  l.dispose();
  assert.ok(l.stowed() && S.ammo === 12 && S.phase === 'park' && S.elev === spec.elev.init && S.trav === 0);
  assert.ok(rig.caps.every(c => c.group.visible) && rig.holes.every(h => !h.visible));
  assert.ok(rig.lifts.every(c => !c.g.visible));
  const after = measure(scene);
  for (const k of ['min', 'max']) assert.ok(after.box[k].distanceTo(before.box[k]) < 1e-4, `the box ${k} is back`);
  assert.ok(Math.abs(l.focus()) < 1e-9, 'the camera looks at the body again');
});

test('the camera is pulled up toward the middle of the raised pack', async () => {
  const { rig, spec } = await rigOf('sapsan');
  const l = launcherOf(rig).l;
  assert.equal(l.focus(), 0);
  deploy(l);
  run(l, 3);
  const f = l.focus();
  assert.ok(near(f, .5 * spec.len * Math.sin(spec.elev.init * D2R), 1e-6) && f > 3, `focus ${f.toFixed(2)} m`);
  l.S.elev = l.S.tElev = spec.elev.max;
  assert.ok(l.focus() > f);
});
