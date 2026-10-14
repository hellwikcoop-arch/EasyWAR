// Машини з краном (ref-crane.js, ref-rig-data.js: CRANES) на справжніх моделях: кожну деталь знайдено й вирізано, модель у похідному положенні
// виглядає як до побудови, кран, гак, циліндри, сошники й відвал рухаються так, як задано, а складання повертає все на місце.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Vector3 } from 'three';
import { ENTRIES } from '../src/ref-data.js';
import { CraneMachine, armDrop, buildCraneRig, mapPoint, slewPoint, slewSign } from '../src/ref-crane.js';
import { CRANES, TRACKED, WHEELED } from '../src/ref-rig-data.js';
import { MACHINE_PHASES, simOf } from '../src/ref-sim-data.js';
import { loadGlbScene } from './helpers/glb-scene.mjs';

const FILES = { m984: 'm984a2', m1084: 'm1084a1p2', bpz2: 'bergepanzer2', 'hemtt-pods': 'hemtt-pod-carrier' };
const D2R = Math.PI / 180;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

async function rigOf(id, spec = CRANES[id]) {
  const { scene } = await loadGlbScene(FILES[id], { fresh: true });
  scene.updateMatrixWorld(true);
  const before = vertices(scene), why = [];
  return { scene, spec, before, why, rig: buildCraneRig(scene, spec, why) };
}

// Світові координати вершин усього, що видно в моделі (без накладок-децалей): плоский масив x, y, z.
function vertices(scene) {
  scene.updateMatrixWorld(true);
  const out = [], v = new Vector3();
  scene.traverseVisible(o => {
    if (!o.isMesh || o.userData.decal) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); }
  });
  return out;
}

// Скільки вершин a не мають поруч (у межах eps) вершини b: просторова сітка, тож швидко навіть для ста тисяч вершин.
function unmatched(a, b, eps = 1e-3) {
  const cell = .02, grid = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
  for (let n = 0; n < b.length; n += 3) {
    const k = key(Math.floor(b[n] / cell), Math.floor(b[n + 1] / cell), Math.floor(b[n + 2] / cell));
    (grid.get(k) || grid.set(k, []).get(k)).push(n);
  }
  let miss = 0;
  for (let n = 0; n < a.length; n += 3) {
    const i = Math.floor(a[n] / cell), j = Math.floor(a[n + 1] / cell), k = Math.floor(a[n + 2] / cell);
    let hit = false;
    for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) for (let dk = -1; dk <= 1 && !hit; dk++) {
      for (const m of grid.get(key(i + di, j + dj, k + dk)) || []) {
        if (Math.abs(b[m] - a[n]) < eps && Math.abs(b[m + 1] - a[n + 1]) < eps && Math.abs(b[m + 2] - a[n + 2]) < eps) { hit = true; break; }
      }
    }
    if (!hit) miss++;
  }
  return miss;
}

// Кран із заглушкою рушія: швидкість машини, рельєф під точкою (висота землі в метрах: число чи функція x, z) і журнал підказок.
function craneOf(rig, { speed = 0, ground = 0 } = {}) {
  const ctx = { v: speed, ground, toasts: [], c: null };
  ctx.speed = () => ctx.v;
  ctx.gap = p => p.y - (typeof ctx.ground === 'function' ? ctx.ground(p.x, p.z) : ctx.ground);
  ctx.toast = t => ctx.toasts.push(t);
  ctx.c = new CraneMachine(rig, ctx);
  return ctx;
}

const run = (c, seconds, until = () => false) => { for (let t = 0; t < seconds; t += 1 / 30) { c.step(1 / 30); if (until(c)) return true; } return false; };
const toWork = c => { c.enter('work'); assert.ok(run(c, 20, x => x.aimOk()), 'the crane reaches the working pose'); };

test('kinematics: boom hinge, telescope slide, jib knuckle, slew sign and blade arm are pure functions of the table', () => {
  for (const [id, sp] of Object.entries(CRANES)) {
    const stowed = { elev: sp.boom.e0, reach: 0, jib: 0 }, [bx, by] = sp.boom.pivot, [dx, dy] = sp.boom.dir;
    const frames = ['turret', 'boom', 'tele', ...(sp.reach && sp.reach.kind === 'jib' ? ['jib'] : [])];
    for (const f of frames) {
      const pt = [bx + .7, by + .4, .2], got = mapPoint(sp, stowed, f, pt);
      assert.ok(near(got[0], pt[0]) && near(got[1], pt[1]) && near(got[2], pt[2]), `${id}.${f}: in the stowed pose nothing moves`);
    }
    // стріла повертається навколо шарніра: відстань до нього та z не змінюються, кінець іде вгору
    const [ax, az] = sp.axis, tip = [bx + dx * 3, by + dy * 3, az], up = mapPoint(sp, { ...stowed, elev: sp.boom.e0 + 20 }, 'boom', tip);
    assert.ok(near(Math.hypot(up[0] - bx, up[1] - by), Math.hypot(tip[0] - bx, tip[1] - by), 1e-9) && near(up[2], az, 1e-12), `${id}: the distance to the hinge is kept`);
    assert.ok(up[1] > tip[1] + .5, `${id}: raising the boom lifts its tip (${up[1].toFixed(2)} > ${tip[1].toFixed(2)})`);
    // телескоп виїжджає вздовж стріли: втягнення на 1 м зсуває точку на метр проти напрямку стріли
    if (sp.reach && sp.reach.kind === 'tele') {
      const t = mapPoint(sp, { ...stowed, reach: 1 }, 'tele', tip);
      assert.ok(near(t[0], tip[0] - dx, 1e-9) && near(t[1], tip[1] - dy, 1e-9), `${id}: the telescope slides along the boom`);
    }
    // жираф складається навколо свого шарніра й не змінює відстань до нього
    if (sp.reach && sp.reach.kind === 'jib') {
      const [jx, jy] = sp.reach.pivot, pt = [jx + 1.2, jy + .1, .3], j = mapPoint(sp, { ...stowed, jib: 90 }, 'jib', pt);
      assert.ok(near(Math.hypot(j[0] - jx, j[1] - jy), Math.hypot(pt[0] - jx, pt[1] - jy), 1e-9));
      assert.ok(Math.abs(j[0] - jx) < 1.2 - .5, `${id}: the knuckle really turns`);
    }
    // поворот на 0° нічого не рухає, на 90° кінець стріли лягає вбік, на правий (+z) бік машини при додатному куті
    const s0 = slewPoint(sp, 0, tip);
    assert.ok(near(s0[0], tip[0]) && near(s0[1], tip[1]) && near(s0[2], tip[2]), `${id}: slew 0 is the identity`);
    const s90 = slewPoint(sp, 90, tip);
    assert.ok(near(s90[0], ax, 1e-9) && near(s90[1], tip[1]) && s90[2] > az, `${id}: +90° swings the boom to the +z side (${s90.map(v => v.toFixed(2))})`);
    assert.ok(near(Math.hypot(s90[0] - ax, s90[2] - az), Math.hypot(tip[0] - ax, tip[2] - az), 1e-9), `${id}: the slew keeps the distance to the axis`);
    assert.equal(slewSign(sp), dx < 0 ? 1 : -1);
    // межі й порядок значень у таблиці
    assert.ok(sp.boom.min <= sp.boom.e0 && sp.boom.e0 < sp.boom.max, `${id}: boom range`);
    assert.ok(sp.hook.max > sp.hook.length && sp.hook.bottom > sp.hook.length, `${id}: hook figures`);
    assert.ok(sp.work.elev > sp.boom.min && sp.work.elev <= sp.boom.max && sp.work.drop < sp.hook.max, `${id}: working pose is inside the range`);
  }
  // важіль відвала: кінець опускається рівно на запитане, довжина важеля не змінюється
  const arms = CRANES.bpz2.props[1].arms, [px, py] = arms.pivot, R = Math.hypot(arms.end[0] - px, arms.end[1] - py);
  assert.ok(near(armDrop(arms, 0).turn, 0, 1e-12) && near(armDrop(arms, 0).dx, 0, 1e-12));
  for (const dy of [-.1, -.4, -.6]) {
    const { turn, dx } = armDrop(arms, dy), th0 = Math.atan2(arms.end[1] - py, arms.end[0] - px);
    const x = px + R * Math.cos(th0 + turn), y = py + R * Math.sin(th0 + turn);
    assert.ok(near(y - arms.end[1], dy, 1e-9) && near(x - arms.end[0], dx, 1e-9), `dy = ${dy}`);
    assert.ok(turn < 0, 'the end swings down');
  }
  assert.ok(armDrop(arms, -.6).dx < -.1, 'a deep drop also draws the knife back toward the pivot');
  assert.ok(Math.abs(armDrop(arms, -9).turn) < Math.PI, 'a drop longer than the arm stays finite');
});

for (const id of Object.keys(CRANES)) {
  test(`${id}: every part is found in the model, nothing is lost, and the stowed model looks as it did`, async () => {
    const { scene, spec, before, why, rig } = await rigOf(id, { ...CRANES[id], props: CRANES[id].props.map(p => ({ ...p, up: 0 })) });
    assert.deepEqual(why, [], 'every region of the table finds a body');
    assert.ok(rig, 'rig is built');
    const c = craneOf(rig).c;
    c.pose();
    const after = vertices(scene);
    assert.equal(after.length, before.length, 'no triangle is lost or doubled by carving');
    assert.equal(unmatched(after, before), 0, 'every vertex of the stowed model lies where it did in the file');
    assert.equal(unmatched(before, after), 0, 'and the file has no vertex that went missing');
    // ланцюг вузлів: нахил і поворот у спокої нульові
    assert.ok(near(rig.slew.rotation.y, 0) && near(rig.boom.rotation.z, 0) && rig.tele.position.length() < 1e-9);
    assert.equal(rig.struts.length, spec.struts.length);
    assert.equal(rig.props.length, spec.props.length);
    assert.ok(rig.hook.cable.children.length > 0 && rig.hook.block.children.length > 0, 'the cable and the block are separate bodies');
    assert.ok(rig.boom.children.some(o => o.isMesh) && rig.slew.children.some(o => o.isMesh), 'the boom and the turret are bodies of their own');
    if (spec.teleParts.length) assert.ok(rig.tele.children.some(o => o.isMesh), 'the telescope section');
    if (spec.reach && spec.reach.kind === 'jib') assert.ok(rig.jib && rig.jib.children.some(o => o.isMesh), 'the jib section');
    // циліндри: корпус із моделі й шток-накладка, довжина збігається з таблицею
    for (const st of rig.struts) {
      const L = new Vector3(...st.b).distanceTo(new Vector3(...st.a));
      assert.ok(near(st.s.L0, L, 1e-9) && st.s.rod.userData.decal && !st.s.rod.visible, `${id}: the cylinder is as long as in the table`);
    }
    for (const p of rig.props) {
      assert.ok(p.g.children.some(o => o.isMesh), `${p.spec.id}: the prop has bodies`);
      if (p.spec.arms) assert.ok(p.arm && p.arm.children.some(o => o.isMesh), 'the blade arms');
      assert.equal(p.struts.length, (p.spec.struts || []).length);
    }
    // органи керування: кнопки, клавіші й підказка не повторюються
    const ids = c.controls.map(x => x.id), codes = c.controls.map(x => x.code);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(codes).size, codes.length, 'no key is used twice');
    assert.ok(!codes.includes('KeyC') && c.controls.every(x => x.key && x.code && x.row && x.label), 'C is the follow camera of the engine');
    assert.ok(c.hints.every(([hid, text]) => ids.includes(hid) && text), 'every hint names a button of this machine');
    assert.equal(typeof c.canFire, 'undefined', 'no rocket: the engine adds no «Стежити за ракетою»');
  });
}

test('the rig refuses a model it does not fit and says which region found nothing', async () => {
  const noNode = await rigOf('m984', { ...CRANES.m984, node: 'немає_такого_вузла' });
  assert.equal(noNode.rig, null);
  assert.match(noNode.why[0], /вузол немає_такого_вузла/);
  const far = await rigOf('m984', { ...CRANES.m984, hook: { ...CRANES.m984.hook, block: [[40, 40, 40, 41, 41, 41]] } });
  assert.equal(far.rig, null);
  assert.match(far.why[0], /^block:область 40,40,40,41,41,41$/);
  const twice = await rigOf('m1084', { ...CRANES.m1084, struts: [CRANES.m1084.struts[0], CRANES.m1084.struts[0]] });
  assert.equal(twice.rig, null, 'a body already taken by one part cannot be taken by another');
  assert.match(twice.why[0], /^strut#1:/);
  const noProp = await rigOf('bpz2', { ...CRANES.bpz2, props: [{ ...CRANES.bpz2.props[0], parts: [[40, 40, 40, 41, 41, 41]] }] });
  assert.equal(noProp.rig, null);
  assert.match(noProp.why[0], /^prop:/);
  // уся міш work у BPz2 розрізана на частини: нічого не лишилося в корпусі, а сам меш сховано
  const { rig, scene } = await rigOf('bpz2');
  assert.ok(rig);
  assert.equal(scene.getObjectByName('work').visible, false, 'the carved mesh is hidden: every triangle lives in a moving part');
});

test('m984: the spades are lowered in the file, so the stowed machine carries them 45 cm higher', async () => {
  const { rig, scene, spec } = await rigOf('m984');
  const file = new Box3(), raised = new Box3();
  rig.props[0].g.updateWorldMatrix(true, true);
  const c = craneOf(rig).c;
  c.pose();
  raised.setFromObject(rig.props[0].g);
  scene.updateMatrixWorld(true);
  // той самий вузол у положенні файлу: група в нулі
  rig.props[0].g.position.set(0, 0, 0);
  rig.props[0].g.updateWorldMatrix(true, true);
  file.setFromObject(rig.props[0].g);
  assert.ok(near(raised.min.y - file.min.y, spec.props[0].up, 1e-4) && near(raised.max.y - file.max.y, spec.props[0].up, 1e-4), 'raised by exactly the table value');
  assert.ok(near(raised.min.x, file.min.x, 1e-6) && near(raised.max.z, file.max.z, 1e-6), 'and not shifted sideways');
  assert.ok(file.min.y > 0 && file.min.y < .1, `in the file the spade plates stand on the ground (${file.min.y.toFixed(3)})`);
});

for (const id of Object.keys(CRANES)) {
  test(`${id}: the crane works only on a stopped machine with the props down, and folding returns everything to the stowed pose`, async () => {
    const { rig, spec, scene, before } = await rigOf(id);
    const ctx = craneOf(rig, { speed: 8 }), c = ctx.c, S = c.S, stab = spec.props.filter(p => p.stab);
    const rc = spec.reach;
    assert.equal(c.craneStowed() && c.propsUp() && c.stowed(), true);
    assert.equal(c.speedTarget, spec.speed, 'a stowed machine may march');
    assert.equal(c.aimOk(), false);
    assert.ok(c.ui().locks.up && c.ui().locks.hookDown && c.ui().locks.fold, 'all crane buttons are locked while the machine is parked');
    assert.equal(c.ui().labels.fold, 'Розгорнути кран');
    // «Робота» на ходу: нічого не опускається й кран не розгортається, поки машина не зупиниться
    c.enter('work');
    run(c, 3);
    assert.ok(Object.values(S.pt).every(v => v === 0) && !S.armed && S.elev === spec.boom.e0, 'the machine still moves: nothing happens');
    assert.equal(c.status(''), 'Робота · машина зупиняється');
    ctx.v = 0;
    if (stab.length) {
      run(c, 1);
      assert.ok(S.pt[stab[0].id] > 0 && S.pt[stab[0].id] < .6, 'the props lower first');
      assert.equal(c.status(''), 'Робота · опори опускаються');
      assert.equal(c.speedTarget, 0, 'with the props down the machine cannot march');
      assert.equal(c.aimOk(), false);
      assert.ok(S.elev === spec.boom.e0, 'the crane waits for the props');
    }
    assert.ok(run(c, 25, x => x.aimOk()), 'the crane reaches the working pose by itself');
    for (const p of stab) assert.equal(S.pt[p.id], 1);
    assert.ok(near(S.elev, spec.work.elev, 1e-6) && near(S.drop, spec.work.drop, 1e-6), 'the boom and the hook go to the table pose');
    if (rc && rc.kind === 'tele') assert.ok(near(S.reach, spec.work.reach, 1e-6));
    if (rc && rc.kind === 'jib') assert.ok(near(S.jib, spec.work.jib, 1e-6));
    assert.match(c.status(''), /^Робота · стріла \d+° · поворот -?\d+°/);
    assert.equal(c.ui().labels.fold, 'Скласти кран');
    assert.equal(c.ui().locks.up, false);
    assert.equal(c.speedTarget, 0);

    // стріла: кнопка тримається — кут росте до межі; короткий дотик усе одно зрушує
    c.setHold('up', true);
    assert.ok(run(c, 20, x => x.S.elev >= spec.boom.max - 1e-9), 'the boom stops at its upper limit');
    c.setHold('up', false);
    run(c, 1);
    assert.ok(near(S.elev, spec.boom.max, 1e-6));
    assert.equal(c.ui().locks.up, true);
    c.setHold('down', true); run(c, .05); c.setHold('down', false); run(c, 1);
    assert.ok(S.elev < spec.boom.max - .5, 'a short touch moves the boom');

    // поворот: стріла вище мінімального кута; нижче — кран стоїть і каже чому
    const e1 = S.elev;
    c.setHold('right', true);
    assert.ok(run(c, 25, x => x.S.slew >= spec.slew.max - 1e-9), 'the crane turns to its limit');
    c.setHold('right', false);
    assert.ok(near(S.slew, spec.slew.max, 1e-6));
    assert.equal(c.ui().locks.right, true);
    c.setHold('left', true);
    assert.ok(run(c, 40, x => x.S.slew <= -spec.slew.max + 1e-9));
    c.setHold('left', false);
    assert.ok(near(S.slew, -spec.slew.max, 1e-6));
    assert.equal(S.elev, e1, 'turning does not touch the boom');
    S.slew = 20;
    S.elev = spec.slew.minElev - 1;
    ctx.toasts.length = 0;
    assert.equal(c.canSlew(), false);
    c.setHold('left', true); run(c, 1); c.setHold('left', false);
    assert.equal(S.slew, 20, 'the boom is too low to turn');
    assert.deepEqual(ctx.toasts, ['Підніміть стрілу, щоб повернути кран']);
    S.elev = spec.work.elev;
    assert.equal(c.canSlew(), true);
    S.slew = 0;

    // гак: опускається, поки блок не торкнеться землі, а не нижче; підйом піднімає
    c.setHold('hookDown', true);
    run(c, 15);
    c.setHold('hookDown', false);
    const a = mapPoint(spec, S, spec.hook.on, spec.hook.anchor), room = a[1] - spec.hook.bottom - .03;
    assert.ok(near(S.drop, Math.min(spec.hook.max, room), 1e-6), `the block stops above the ground (${S.drop.toFixed(3)} of ${room.toFixed(3)})`);
    assert.ok(near(rig.hook.cable.scale.y, (spec.hook.length + S.drop) / spec.hook.length, 1e-9) && near(rig.hook.block.position.y, -S.drop, 1e-9), 'the cable and the block follow the drop');
    ctx.ground = 1;
    c.step(1 / 30);
    assert.ok(near(S.drop, Math.max(0, Math.min(spec.hook.max, room - 1)), 1e-6), 'a higher ground shortens the cable at once');
    ctx.ground = 0;
    c.setHold('hookUp', true); run(c, 30); c.setHold('hookUp', false);
    assert.equal(S.drop, 0);
    assert.equal(c.ui().locks.hookUp, true);

    // циліндри йдуть за стрілою: кінці в системі повороту, довжина — відстань між опорами, шток виходить, коли вона більша
    S.elev = spec.boom.max; S.slew = 33; if (rc) { if (rc.kind === 'tele') S.reach = rc.max * .7; else S.jib = rc.max * .5; }
    c.pose();
    const [ax, az] = spec.axis;
    for (const st of rig.struts) {
      const A = mapPoint(spec, S, st.from, st.a), B = mapPoint(spec, S, st.to, st.b), len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      assert.ok(near(st.s.g.position.x, A[0] - ax, 1e-9) && near(st.s.g.position.y, A[1], 1e-9) && near(st.s.g.position.z, A[2] - az, 1e-9), 'the cylinder starts at its anchor');
      const dir = new Vector3(0, 1, 0).applyQuaternion(st.s.g.quaternion);
      assert.ok(near(dir.x, (B[0] - A[0]) / len, 1e-9) && near(dir.y, (B[1] - A[1]) / len, 1e-9) && near(dir.z, (B[2] - A[2]) / len, 1e-9), 'and points at the other anchor');
      const drawn = st.s.rod.visible ? st.s.rod.position.y + st.s.rod.scale.y : st.s.barrel.scale.y * st.s.L0;
      assert.ok(near(drawn, len, 1e-9), `the cylinder spans the anchors (${drawn.toFixed(3)} / ${len.toFixed(3)})`);
      assert.equal(st.s.rod.visible, len > st.s.L0 + 1e-4);
    }
    // кран, повернутий вбік, везе гак за собою: точка підвісу йде за стрілою
    assert.ok(near(rig.slew.rotation.y, slewSign(spec) * 33 * D2R, 1e-9) && near(rig.boom.rotation.z, Math.sign(spec.boom.dir[0]) * (spec.boom.max - spec.boom.e0) * D2R, 1e-9));
    S.slew = 0;

    // складання: гак, жираф чи телескоп, поворот, і лише тоді стріла на упор
    S.drop = 1;
    c.press('fold');
    assert.equal(S.auto, 'stow');
    assert.equal(c.aimOk(), false, 'the buttons are locked while the crane moves');
    assert.equal(c.status(''), 'Робота · кран складається');
    run(c, .2);
    assert.ok(S.drop < 1 && S.drop > 0 && near(S.elev, spec.boom.max, 1e-6), 'the hook goes up before the boom moves');
    assert.ok(run(c, 40, x => !x.S.auto), 'the crane folds');
    assert.ok(c.craneStowed() && S.slew === 0 && S.elev === spec.boom.e0 && S.reach === 0 && S.jib === 0 && S.drop === 0);
    assert.equal(c.ui().labels.fold, 'Розгорнути кран');
    c.press('fold');
    assert.equal(S.auto, 'work');
    assert.ok(run(c, 25, x => !x.S.auto) && near(S.elev, spec.work.elev, 1e-6), 'the same button unfolds it again');
    // опори не піднімаються, поки кран не складено
    if (stab.length) {
      ctx.toasts.length = 0;
      c.press(stab[0].id);
      assert.deepEqual(ctx.toasts, ['Спершу складіть кран']);
      assert.equal(S.pw[stab[0].id], 1);
    }

    // вихід з роботи: кран складається сам, потім піднімаються опори; рушати можна лише у похідному положенні
    S.slew = 40; S.drop = .7;
    c.enter('march');
    ctx.v = 0;
    assert.equal(c.speedTarget, 0);
    run(c, 1);
    assert.match(c.status('Марш'), /^Марш · кран складається$/);
    assert.ok(run(c, 60, x => x.stowed()), 'the machine is ready to march');
    assert.equal(c.speedTarget, spec.speed);
    assert.ok(c.propsUp() && c.craneStowed());
    assert.equal(c.aimOk(), false);

    // без анімації: усе доходить до кінця за один виклик, а кнопки діють по кроку
    c.enter('work');
    c.settle();
    assert.ok(c.aimOk() && c.calm() && near(S.elev, spec.work.elev, 1e-6));
    const e2 = S.elev;
    c.nudge('up');
    assert.equal(S.elev, Math.min(spec.boom.max, e2 + 8));
    c.nudge('down'); c.nudge('down');
    assert.equal(S.elev, Math.max(spec.boom.min, e2 - 8));
    c.nudge('right');
    assert.equal(S.slew, 15);
    c.nudge('hookDown');
    assert.equal(S.drop, spec.work.drop + 1);
    c.press('fold');
    c.settle();
    assert.ok(c.craneStowed() && c.calm());
    c.enter('park');
    c.settle();
    assert.ok(c.stowed());

    // кінець роботи переглядача: модель повертається в положення файлу, як до побудови рига
    c.enter('work'); c.settle();
    c.dispose();
    assert.ok(near(rig.slew.rotation.y, 0) && near(rig.boom.rotation.z, 0) && rig.tele.position.length() < 1e-9 && (!rig.jib || rig.jib.rotation.z === 0));
    assert.ok(rig.props.every(p => p.g.position.length() < 1e-9 && (!p.arm || near(p.arm.rotation.z, 0))));
    const after = vertices(scene);
    assert.equal(unmatched(after, before), 0, 'the model is as it was in the file');
    assert.equal(unmatched(before, after), 0);
  });
}

test('m984: the spades land on the ground under them and stop at their stroke', async () => {
  const { rig, spec } = await rigOf('m984');
  const ctx = craneOf(rig), c = ctx.c, up = spec.props[0].up, by = spec.props[0].bottoms[0][1], g = rig.props[0].g;
  assert.ok(near(g.position.y, up, 1e-9), 'stowed, the spade is carried at the table height');
  c.enter('work');
  assert.ok(run(c, 8, x => x.S.pt.spade === 1));
  assert.ok(near(g.position.y, -by, 1e-9), `on a flat ground the plate lands at the file height (${g.position.y.toFixed(3)})`);
  // опорою стає та з нижніх точок, що першою торкається землі: вищий бік землі зупиняє сошник раніше
  ctx.ground = (x, z) => (z > 0 ? .2 : 0);
  c.step(1 / 30);
  assert.ok(near(g.position.y, .2 - by, 1e-9), 'the higher side of the ground stops the plate 20 cm sooner');
  ctx.ground = -5;
  c.step(1 / 30);
  assert.ok(near(g.position.y, -spec.props[0].max, 1e-9), 'a pit deeper than the stroke cannot lower the spade further');
  ctx.ground = 3;
  c.step(1 / 30);
  assert.ok(near(g.position.y, .3, 1e-9), 'a mound lifts the plate up, but not more than 30 cm over the file');
  // у похідному положенні висота опори — знову `up`
  ctx.ground = 0;
  c.enter('stow');
  assert.ok(run(c, 25, x => x.S.pt.spade === 0));
  assert.ok(near(g.position.y, up, 1e-9));
});

test('bpz2: the blade hangs on two arms and two cylinders that follow it down, the spade has its own stubs', async () => {
  const { rig, spec } = await rigOf('bpz2');
  const ctx = craneOf(rig), c = ctx.c, S = c.S;
  const [spade, blade] = rig.props;
  assert.equal(spade.struts.length, 4);
  assert.equal(blade.struts.length, 2);
  assert.ok(blade.arm && !spade.arm);
  c.enter('work');
  assert.ok(run(c, 25, x => x.aimOk()));
  assert.ok(blade.g.position.y < -.2 && blade.g.position.x < 0 && blade.arm.rotation.z < 0, 'the knife went down and drew back on its arms');
  const { turn, dx } = armDrop(spec.props[1].arms, blade.g.position.y);
  assert.ok(near(blade.arm.rotation.z, turn, 1e-12) && near(blade.g.position.x, dx, 1e-12), 'arms and knife agree');
  // циліндри відвала: кінець a нерухомий, кінець b іде з ножем
  for (const st of blade.struts) {
    const B = new Vector3(st.b[0] + dx, st.b[1] + blade.g.position.y, st.b[2]), A = new Vector3(...st.a);
    assert.ok(st.s.g.position.distanceTo(A) < 1e-9, 'the fixed end stays');
    const len = B.distanceTo(A), dir = new Vector3(0, 1, 0).applyQuaternion(st.s.g.quaternion);
    assert.ok(dir.distanceTo(B.clone().sub(A).normalize()) < 1e-9 && near(st.s.rod.visible ? st.s.rod.position.y + st.s.rod.scale.y : st.s.barrel.scale.y * st.s.L0, len, 1e-9));
  }
  // відвал можна підняти й опустити окремо, але лише складеним краном; сошник лишається внизу
  c.press('blade');
  assert.deepEqual(ctx.toasts, ['Спершу складіть кран']);
  c.press('fold'); run(c, 40, x => !x.S.auto);
  c.press('blade');
  run(c, .5);
  assert.equal(c.status(''), 'Робота · опори піднімаються');
  assert.ok(run(c, 5, x => x.S.pt.blade === 0));
  assert.ok(near(blade.g.position.y, 0, 1e-9) && near(blade.arm.rotation.z, 0, 1e-9) && near(blade.g.position.x, 0, 1e-9), 'the knife is back in the file position');
  assert.equal(S.pt.spade, 1);
  assert.equal(c.status(''), 'Робота · опори підняті, кран заблоковано');
  assert.equal(c.aimOk(), false, 'with the knife up the crane is locked');
  assert.equal(c.ui().on.blade, false);
  assert.equal(c.ui().on.spade, true);
  c.press('blade');
  assert.ok(run(c, 5, x => x.aimOk()));
  assert.equal(c.ui().on.blade, true);
});

test('every support machine of the reference is wired to a crane spec, a running gear and the support phases', () => {
  const support = ENTRIES.filter(e => e.group === 'support');
  assert.deepEqual(support.map(e => e.id).sort(), Object.keys(CRANES).sort(), 'a crane table for every support machine');
  for (const e of support) {
    const sim = simOf(e);
    assert.ok(sim && sim.machine && sim.rig === 'crane' && CRANES[sim.spec], `${e.id}: the engine runs it`);
    assert.equal(sim.spec, e.id);
    assert.equal(sim.phases, MACHINE_PHASES.support);
    assert.ok(sim.tracked ? TRACKED[sim.tracked] : WHEELED[sim.wheels], `${e.id}: the running gear is in the table`);
    assert.equal(sim.speed, CRANES[e.id].speed, 'one speed in both tables');
    assert.ok(FILES[e.id] === e.model.file, `${e.id}: the test uses the model of the article`);
  }
});
