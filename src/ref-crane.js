// Машини з краном, сошниками й відвалом (M984A2, M1084A1P2, Bergepanzer 2, пакетовоз HEMTT) для «Інтерактивної моделі» довідника.
// У моделях кран, гак, циліндри, сошники й відвал лежать у великих мешах (body, work, chassis), тож тут їх вирізають за місцем
// (buildCraneRig — один раз на модель) і чіпляють до осей: поворот крана вбік, підйом стріли, телескоп чи жираф, гак із тросом,
// гідроциліндри, що тягнуться за стрілою, опори, що опускаються до землі. Логіку кранового управління перенесено з артефакту автора
// моделей (кран вантажного броньованого автомобіля): стріла, поворот і гак діють, лише коли машина стоїть; «Скласти кран» повертає
// все у похідне положення. CraneMachine має той самий інтерфейс, що TelLauncher і PodLauncher, тож рушій Machine (ref-machine.js)
// працює з усіма однаково. Кінематику (mapPoint, slewPoint) винесено в чисті функції, їх перевіряють модульні тести.
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { D2R, clamp, smooth } from './ref-fx.js';
import { attach, bakeFloat, carve, componentsIn, labelsOfComponents, meshesOf, pieceOf, triangleComponents } from './ref-mesh.js';

const Y_AXIS = new Vector3(0, 1, 0);
const PAD = .012;
const HOLD = ['up', 'down', 'left', 'right', 'reachIn', 'reachOut', 'hookUp', 'hookDown'];
const HOOK_RATE = 1.1; // м/с
const dec = o => { o.userData.decal = true; return o; };

const rot2 = (x, y, cx, cy, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};

// Точка pt = [x, y, z] деталі frame ('turret' | 'boom' | 'tele' | 'jib') на положенні pose = { elev, reach, jib } у системі моделі до
// повороту крана вбік: стріла нахиляється навколо шарніра, телескоп висувається вздовж стріли, жираф складається навколо свого шарніра.
export function mapPoint(sp, pose, frame, pt) {
  const b = sp.boom;
  let x = pt[0], y = pt[1];
  if (frame === 'turret') return [x, y, pt[2]];
  if (frame === 'tele') { x -= b.dir[0] * pose.reach; y -= b.dir[1] * pose.reach; }
  else if (frame === 'jib') [x, y] = rot2(x, y, sp.reach.pivot[0], sp.reach.pivot[1], pose.jib * D2R);
  [x, y] = rot2(x, y, b.pivot[0], b.pivot[1], Math.sign(b.dir[0]) * (pose.elev - b.e0) * D2R);
  return [x, y, pt[2]];
}

// Знак повороту навколо вертикалі: додатний кут веде стрілу на правий бік машини (+z), якою б стороною вона не дивилася.
export const slewSign = sp => (sp.boom.dir[0] < 0 ? 1 : -1);

// Точка pt (система моделі до повороту) після повороту крана на slew градусів навколо його вертикальної осі.
export function slewPoint(sp, slew, pt) {
  const [ax, az] = sp.axis, a = slewSign(sp) * slew * D2R, c = Math.cos(a), s = Math.sin(a), dx = pt[0] - ax, dz = pt[2] - az;
  return [ax + dx * c + dz * s, pt[1], az - dx * s + dz * c];
}

// Важіль відвала: кінець end важеля з шарніром pivot опускається на dy (від'ємне) — повертає кут повороту й зсув кінця по x.
export function armDrop(arms, dy) {
  const [px, py] = arms.pivot, R = Math.hypot(arms.end[0] - px, arms.end[1] - py), th0 = Math.atan2(arms.end[1] - py, arms.end[0] - px);
  const th = Math.asin(clamp((arms.end[1] - py + dy) / R, -1, 1));
  return { turn: th - th0, dx: R * (Math.cos(th) - Math.cos(th0)) };
}

// Гідроциліндр між двома рухомими точками: корпус — оригінальне тіло з моделі (довжини L0), шток — хромований циліндр, що виходить
// із корпуса, коли відстань більша. У положенні моделі він збігається з оригіналом до вершини.
class Strut {
  constructor(geometry, source, a, b, r, rodMat) {
    const A = new Vector3(...a), d = new Vector3(...b).sub(A);
    this.L0 = d.length();
    geometry.translate(-A.x, -A.y, -A.z);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(d.clone().normalize(), Y_AXIS));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    this.g = new Group(); this.g.name = 'crane-strut';
    this.barrel = pieceOf(source, geometry, 'crane-barrel');
    this.rod = dec(new Mesh(new CylinderGeometry(r * .6, r * .6, 1, 12).translate(0, .5, 0), rodMat));
    this.rod.visible = false; this.rod.name = 'crane-rod';
    this.over = Math.min(.25, this.L0 * .35);
    this.d = new Vector3();
    this.g.add(this.barrel, this.rod);
  }

  // A, B — кінці в системі батьківської групи.
  set(A, B) {
    const d = this.d.copy(B).sub(A), len = d.length();
    this.g.position.copy(A);
    if (len > 1e-6) this.g.quaternion.setFromUnitVectors(Y_AXIS, d.divideScalar(len));
    if (len <= this.L0 + 1e-4) { this.barrel.scale.y = len / this.L0; this.rod.visible = false; return; }
    this.barrel.scale.y = 1;
    this.rod.visible = true; this.rod.position.y = this.L0 - this.over; this.rod.scale.y = len - this.L0 + this.over;
  }
}

// Вирізає з мешів моделі все, що рухається, і складає групи вузлів; null, якщо чогось у моделі не знайдено (why — необов'язковий
// масив: у нього потрапляють назви заявок, що нічого не знайшли). Після побудови модель стоїть у похідному положенні й виглядає
// як до неї: усі групи в нулі, циліндри розтягнуто до довжини моделі.
export function buildCraneRig(scene, spec, why = []) {
  scene.updateMatrixWorld(true);
  const nodes = new Map();
  const nodeOf = name => {
    if (nodes.has(name)) return nodes.get(name);
    const found = meshesOf(scene.getObjectByName(name));
    if (found.length !== 1) return null;
    const mesh = found[0];
    bakeFloat(mesh);
    const info = { name, mesh, comp: triangleComponents(mesh.geometry), claimed: new Set(), jobs: [] };
    nodes.set(name, info);
    return info;
  };
  // Заявка на деталі: кожна область має знайти хоча б одне ще не зайняте тіло; усі знайдені тіла утворюють одну частину.
  const jobs = [];
  const claim = (key, nodeName, regions, extra = {}) => {
    const info = nodeOf(nodeName);
    if (!info) { why.push(key + ':вузол ' + nodeName); return null; }
    const ids = [];
    for (const region of regions) {
      const found = componentsIn(info.comp, region, PAD).filter(i => !info.claimed.has(i));
      if (!found.length) { why.push(key + (extra.i !== undefined ? '#' + extra.i : '') + ':область ' + region.join(',')); return null; }
      for (const i of found) { info.claimed.add(i); ids.push(i); }
    }
    const job = { key, info, ids, ...extra };
    info.jobs.push(job); jobs.push(job);
    return job;
  };
  const sp = spec, h = sp.hook, ok = [];
  ok.push(claim('cable', sp.node, h.cable), claim('block', sp.node, h.block));
  sp.struts.forEach((s, i) => ok.push(claim('strut', sp.node, [s.part], { i, s })));
  if (sp.teleParts.length) ok.push(claim('tele', sp.node, sp.teleParts));
  if (sp.jibParts && sp.jibParts.length) ok.push(claim('jib', sp.node, sp.jibParts));
  ok.push(claim('boom', sp.node, sp.boomParts), claim('turret', sp.node, sp.turret));
  sp.props.forEach((p, pi) => {
    ok.push(claim('prop', p.node, p.parts, { pi }));
    if (p.arms) ok.push(claim('arm', p.node, p.arms.parts, { pi }));
    (p.struts || []).forEach((s, i) => ok.push(claim('pstrut', p.node, [s.part], { pi, i, s })));
  });
  if (ok.some(j => !j)) return null;

  // Один виклик carve на меш: решта трикутників лишається в корпусі.
  for (const info of nodes.values()) {
    if (!info.jobs.length) continue;
    const parts = carve(info.mesh, labelsOfComponents(info.comp, info.jobs.map(j => j.ids)), info.jobs.length);
    info.jobs.forEach((j, k) => { j.geo = parts[k]; });
    if (info.jobs.some(j => !j.geo)) return null;
  }

  const main = nodeOf(sp.node), home = main.mesh.parent;
  const [ax, az] = sp.axis, [px, py, pz] = sp.boom.pivot;
  const grp = (name, x, y, z, parent) => { const g = new Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g; };
  const slew = grp('crane-slew', ax, 0, az, home), boom = grp('crane-boom', px - ax, py, pz - az, slew), tele = grp('crane-tele', 0, 0, 0, boom);
  let jib = null;
  if (sp.reach && sp.reach.kind === 'jib') jib = grp('crane-jib', sp.reach.pivot[0] - px, sp.reach.pivot[1] - py, sp.reach.pivot[2] - pz, boom);
  const hook = grp('crane-hook', h.anchor[0] - ax, h.anchor[1], h.anchor[2] - az, slew);
  const cable = grp('crane-cable', 0, 0, 0, hook), block = grp('crane-block', 0, 0, 0, hook);
  const rodMat = new MeshStandardMaterial({ color: 0xa9adb3, metalness: .8, roughness: .25 });

  const rig = { spec: sp, scene, home, slew, boom, tele, jib, hook: { g: hook, cable, block }, struts: [], props: [], rodMat };
  for (const j of jobs) {
    const mesh = j.info.mesh;
    switch (j.key) {
      case 'cable': attach(cable, mesh, j.geo, h.anchor); break;
      case 'block': attach(block, mesh, j.geo, h.anchor); break;
      case 'tele': attach(tele, mesh, j.geo, sp.boom.pivot); break;
      case 'jib': attach(jib, mesh, j.geo, sp.reach.pivot); break;
      case 'boom': attach(boom, mesh, j.geo, sp.boom.pivot); break;
      case 'turret': attach(slew, mesh, j.geo, [ax, 0, az]); break;
      case 'strut': {
        const st = new Strut(j.geo, mesh, j.s.a, j.s.b, j.s.r, rodMat);
        slew.add(st.g);
        rig.struts[j.i] = { s: st, ...j.s };
        break;
      }
      default: break;
    }
  }
  // Опори й відвал: група стоїть у нулі файлу й зсувається вниз; важелі відвала повертаються навколо свого шарніра.
  sp.props.forEach((p, pi) => {
    const mine = jobs.filter(j => j.pi === pi), mesh = nodeOf(p.node).mesh, ph = mesh.parent;
    const g = grp('crane-prop', 0, 0, 0, ph);
    for (const j of mine.filter(x => x.key === 'prop')) attach(g, mesh, j.geo, [0, 0, 0]);
    let arm = null;
    const armJob = mine.find(x => x.key === 'arm');
    if (armJob) { arm = grp('crane-arm', p.arms.pivot[0], p.arms.pivot[1], p.arms.pivot[2], ph); attach(arm, mesh, armJob.geo, p.arms.pivot); }
    const struts = mine.filter(x => x.key === 'pstrut').map(j => {
      const st = new Strut(j.geo, mesh, j.s.a, j.s.b, j.s.r, rodMat);
      ph.add(st.g);
      return { s: st, ...j.s };
    });
    rig.props.push({ spec: p, g, arm, struts });
  });
  return rig;
}

export class CraneMachine {
  // rig — buildCraneRig(); ctx — { toast(text, s), speed() → швидкість машини (м/с), gap(точка у системі моделі) → висота над землею }
  constructor(rig, ctx) {
    this.r = rig; this.sp = rig.spec; this.ctx = ctx;
    this.sgn = slewSign(this.sp);
    this.S = this.initial();
    this.hold = {}; this.heldT = {}; this.release = {};
    for (const id of HOLD) { this.hold[id] = 0; this.heldT[id] = 0; this.release[id] = 0; }
    this.controls = this.makeControls();
    this.hints = this.makeHints();
    this.v1 = new Vector3(); this.v2 = new Vector3(); this.p = new Vector3();
    this.rise = 0;
    this.pose();
  }

  initial() {
    const pt = {}, pw = {};
    for (const p of this.r.props) { pt[p.spec.id] = 0; pw[p.spec.id] = 0; }
    return { phase: 'park', pt, pw, slew: 0, elev: this.sp.boom.e0, reach: 0, jib: 0, drop: 0, auto: '', armed: false };
  }

  makeControls() {
    const sp = this.sp, c = [
      { id: 'up', label: 'Стріла вгору', key: '↑', code: 'ArrowUp', hold: true, row: 'aim' },
      { id: 'down', label: 'Стріла вниз', key: '↓', code: 'ArrowDown', hold: true, row: 'aim' },
      { id: 'left', label: 'Поворот вліво', key: '←', code: 'ArrowLeft', hold: true, row: 'aim' },
      { id: 'right', label: 'Поворот вправо', key: '→', code: 'ArrowRight', hold: true, row: 'aim' },
    ];
    if (sp.reach) c.push({ id: 'reachIn', label: sp.reach.in, key: 'Q', code: 'KeyQ', hold: true, row: 'crane' }, { id: 'reachOut', label: sp.reach.out, key: 'E', code: 'KeyE', hold: true, row: 'crane' });
    c.push({ id: 'hookUp', label: 'Гак вгору', key: 'W', code: 'KeyW', hold: true, row: 'crane' }, { id: 'hookDown', label: 'Гак вниз', key: 'S', code: 'KeyS', hold: true, row: 'crane' });
    c.push({ id: 'fold', label: 'Скласти кран', key: 'R', code: 'KeyR', row: 'work' });
    for (const p of sp.props) c.push({ id: p.id, label: p.label, key: p.key, code: p.code, row: 'work' });
    return c;
  }

  // Підказка про клавіші: [id кнопки, текст] — показується, якщо така кнопка є.
  makeHints() {
    const sp = this.sp, list = [['up', '←↑↓→ стріла й поворот'], ['hookDown', 'W/S гак']];
    if (sp.reach) list.push(['reachIn', sp.reach.kind === 'jib' ? 'Q/E жираф' : 'Q/E телескоп']);
    list.push(['fold', 'R скласти кран']);
    for (const p of sp.props) list.push([p.id, p.key + ' ' + p.label.toLowerCase()]);
    return list;
  }

  get busy() { return false; }
  craneStowed() {
    const S = this.S, b = this.sp.boom;
    return Math.abs(S.slew) < .3 && Math.abs(S.elev - b.e0) < .06 && S.reach < .006 && S.jib < .3 && S.drop < .02;
  }
  propsDown() { return this.r.props.every(p => !p.spec.stab || this.S.pt[p.spec.id] >= .97); }
  propsUp() { return this.r.props.every(p => this.S.pt[p.spec.id] < .02); }
  stowed() { return this.propsUp() && this.craneStowed(); }
  get speedTarget() { return this.stowed() ? this.sp.speed : 0; }
  aimOk() { const S = this.S; return S.phase === 'work' && !S.auto && S.armed && this.propsDown(); }
  canSlew() { return this.S.elev >= this.sp.slew.minElev - .01; }

  enter(phase) {
    const S = this.S;
    if (phase === 'work') {
      for (const p of this.r.props) S.pw[p.spec.id] = 1;
      S.armed = false; S.auto = '';
    } else {
      for (const p of this.r.props) S.pw[p.spec.id] = 0;
      S.armed = false;
      if (S.phase === 'work' && S.auto === 'work') S.auto = '';
    }
    S.phase = phase;
    this.releaseAll();
  }

  press(id) {
    const S = this.S;
    if (id === 'fold') {
      if (!this.aimOk()) { if (S.phase === 'work') this.ctx.toast(S.auto || !S.armed ? 'Дочекайтеся кінця руху' : 'Спершу опустіть опори', 1.6); return; }
      S.auto = this.craneStowed() ? 'work' : 'stow';
      return;
    }
    const prop = this.r.props.find(p => p.spec.id === id);
    if (!prop || S.phase !== 'work' || S.auto) return;
    if (S.pw[id] && prop.spec.stab && !this.craneStowed()) { this.ctx.toast('Спершу складіть кран', 1.6); return; }
    S.pw[id] = S.pw[id] ? 0 : 1;
  }

  setHold(id, on) {
    if (!(id in this.hold)) return;
    if (on) {
      if (!this.aimOk()) return;
      if ((id === 'left' || id === 'right') && !this.canSlew()) { this.ctx.toast('Підніміть стрілу, щоб повернути кран', 1.6); return; }
      if (!this.hold[id]) { this.hold[id] = 1; this.heldT[id] = 0; }
      this.release[id] = 0;
    } else if (this.hold[id] && !this.release[id]) this.release[id] = Math.max(0, .26 - this.heldT[id]) || 1e-3; // короткий дотик усе одно зрушує вузол
  }

  releaseAll() { for (const id of HOLD) { this.hold[id] = 0; this.release[id] = 0; } }

  // Без анімації кожне натискання кнопки — один крок.
  nudge(id) {
    if (!this.aimOk()) return;
    const S = this.S, sp = this.sp, b = sp.boom, rc = sp.reach;
    if (id === 'up' || id === 'down') S.elev = clamp(S.elev + (id === 'up' ? 8 : -8), b.min, b.max);
    else if ((id === 'left' || id === 'right') && this.canSlew()) S.slew = clamp(S.slew + (id === 'right' ? 15 : -15), -sp.slew.max, sp.slew.max);
    else if (rc && (id === 'reachIn' || id === 'reachOut')) {
      const out = id === 'reachOut' ? 1 : -1;
      if (rc.kind === 'tele') S.reach = clamp(S.reach - out * .5, 0, rc.max); else S.jib = clamp(S.jib + out * 30, 0, rc.max);
    } else if (id === 'hookUp' || id === 'hookDown') S.drop = clamp(S.drop + (id === 'hookDown' ? 1 : -1), 0, sp.hook.max);
    this.pose();
  }

  // Рух до цілі з обмеженою швидкістю; true, коли ціль досягнуто.
  approach(key, target, rate, dt) {
    const S = this.S, d = target - S[key];
    if (Math.abs(d) <= rate * dt) { S[key] = target; return true; }
    S[key] += Math.sign(d) * rate * dt;
    return false;
  }

  // Опори опускаються, коли машина стоїть; піднімаються, лише коли кран складено.
  stages(dt) {
    const S = this.S, work = S.phase === 'work', speed = this.ctx.speed();
    for (const p of this.r.props) {
      const id = p.spec.id, want = work ? S.pw[id] : 0, t = S.pt[id];
      if (want === t) continue;
      if (want > t && speed > .5) continue;
      if (want < t && p.spec.stab && !this.craneStowed()) continue;
      const dk = dt / p.spec.time;
      S.pt[id] = Math.abs(want - t) <= dk ? want : t + Math.sign(want - t) * dk;
    }
  }

  // Автоматичні рухи крана: вихід у робоче положення й складання. Складання йде по порядку: гак угору, жираф чи телескоп у похідне,
  // поворот у нуль (стріла має бути піднятою) і лише тоді стріла опускається на упор.
  autoStep(dt) {
    const S = this.S, sp = this.sp, b = sp.boom, rc = sp.reach, w = sp.work;
    if (S.phase === 'work') {
      // Кран розгортається, коли машина стоїть і опори внизу (машинам без опор досить зупинки).
      if (!S.armed && this.propsDown() && this.ctx.speed() <= .5) { S.armed = true; S.auto = 'work'; }
    } else if (!S.auto && !this.craneStowed()) S.auto = 'stow';
    if (S.auto === 'work') {
      const done = [
        this.approach('elev', clamp(w.elev, b.min, b.max), b.rate * 1.3, dt),
        this.approach('reach', rc && rc.kind === 'tele' ? w.reach : 0, rc ? rc.rate * 1.2 : 1, dt),
        this.approach('jib', rc && rc.kind === 'jib' ? w.jib : 0, rc && rc.kind === 'jib' ? rc.rate : 1, dt),
        this.approach('drop', w.drop, HOOK_RATE, dt),
      ];
      if (done.every(Boolean)) S.auto = '';
    } else if (S.auto === 'stow') {
      if (S.drop > .02) { this.approach('drop', 0, HOOK_RATE * 1.8, dt); return; }
      S.drop = 0;
      let moving = false;
      if (rc && rc.kind === 'jib' && S.jib > .3) { this.approach('jib', 0, rc.rate, dt); moving = true; }
      if (rc && rc.kind === 'tele' && S.reach > .006) { this.approach('reach', 0, rc.rate, dt); moving = true; }
      if (moving) return;
      if (Math.abs(S.slew) > .3) {
        if (S.elev < sp.slew.minElev - .01) this.approach('elev', sp.slew.minElev, b.rate * 1.3, dt);
        else this.approach('slew', 0, sp.slew.rate * 1.2, dt);
        return;
      }
      S.slew = 0;
      if (this.approach('elev', b.e0, b.rate * 1.3, dt)) { S.reach = 0; S.jib = 0; S.auto = ''; }
    }
  }

  // Кнопки, що діють, поки їх тримають: стріла, поворот, телескоп чи жираф, гак.
  manualStep(dt) {
    const S = this.S, sp = this.sp, b = sp.boom, rc = sp.reach, H = this.hold;
    for (const id of HOLD) {
      if (!H[id]) continue;
      this.heldT[id] += dt;
      if (this.release[id]) { this.release[id] -= dt; if (this.release[id] <= 0) { H[id] = 0; this.release[id] = 0; } }
    }
    if (!this.aimOk()) { this.releaseAll(); return; }
    const dE = H.up - H.down, dS = this.canSlew() ? H.right - H.left : 0, dR = H.reachOut - H.reachIn, dH = H.hookDown - H.hookUp;
    if (dE) S.elev = clamp(S.elev + dE * dt * b.rate, b.min, b.max);
    if (dS) S.slew = clamp(S.slew + dS * dt * sp.slew.rate, -sp.slew.max, sp.slew.max);
    if (dR && rc) {
      if (rc.kind === 'tele') S.reach = clamp(S.reach - dR * dt * rc.rate, 0, rc.max); else S.jib = clamp(S.jib + dR * dt * rc.rate, 0, rc.max);
    }
    if (dH) S.drop = clamp(S.drop + dH * dt * HOOK_RATE, 0, sp.hook.max);
  }

  step(dt) {
    this.stages(dt);
    this.autoStep(dt);
    this.manualStep(dt);
    this.pose();
  }

  // Точка моделі після повороту стріли й крана: система файлу моделі (до нахилу корпуса за рельєфом).
  toFile(pt) { return slewPoint(this.sp, this.S.slew, pt); }

  // Положення вузлів: поворот і стріла, телескоп чи жираф, гак із тросом, циліндри, опори й відвал.
  pose() {
    const S = this.S, r = this.r, sp = this.sp, b = sp.boom, h = sp.hook, [ax, az] = sp.axis;
    r.slew.rotation.y = this.sgn * S.slew * D2R;
    r.boom.rotation.z = Math.sign(b.dir[0]) * (S.elev - b.e0) * D2R;
    if (sp.reach && sp.reach.kind === 'tele') r.tele.position.set(-b.dir[0] * S.reach, -b.dir[1] * S.reach, 0);
    if (r.jib) r.jib.rotation.z = S.jib * D2R;
    // Гак висить під точкою підвісу прямо вниз, а трос тягнеться, доки блок не торкнеться землі.
    const a = mapPoint(sp, S, h.on, h.anchor);
    const at = this.toFile([a[0], a[1] - h.bottom, a[2]]);
    const room = Math.max(0, this.ctx.gap(this.p.set(at[0], at[1], at[2])) - .03);
    S.drop = Math.min(S.drop, room, h.max);
    r.hook.g.position.set(a[0] - ax, a[1], a[2] - az);
    r.hook.cable.scale.y = (h.length + S.drop) / h.length;
    r.hook.block.position.y = -S.drop;
    this.rise = Math.max(0, a[1] - h.anchor[1]);
    for (const st of r.struts) {
      const A = mapPoint(sp, S, st.from, st.a), B = mapPoint(sp, S, st.to, st.b);
      st.s.set(this.v1.set(A[0] - ax, A[1], A[2] - az), this.v2.set(B[0] - ax, B[1], B[2] - az));
    }
    for (const p of r.props) this.poseProp(p);
  }

  // Опора чи відвал: у похідному положенні піднята на up метрів, на позиції лежить на землі під найнижчою точкою (опорою стає та
  // з нижніх точок, що першою торкається землі). У положенні файлу (filePose) опора стоїть там, де її намальовано.
  poseProp(p) {
    const S = this.S, sp = p.spec, t = smooth(S.pt[sp.id]), up = this.filePose ? 0 : sp.up;
    let y = up * (1 - t), dx = 0, turn = 0;
    if (t > 0) {
      let g = Infinity;
      for (const b of sp.bottoms) g = Math.min(g, this.ctx.gap(this.p.set(b[0], b[1], b[2])));
      y = up * (1 - t) - clamp(g, -.3, sp.max) * t;
    }
    if (sp.arms) ({ turn, dx } = armDrop(sp.arms, Math.min(0, y)));
    p.g.position.set(dx, y, 0);
    if (p.arm) p.arm.rotation.z = turn;
    for (const st of p.struts) st.s.set(this.v1.set(...st.a), this.v2.set(st.b[0] + dx, st.b[1] + y, st.b[2]));
  }

  // Висота (м), на яку піднімається погляд камери: піднятий гак тягне його вгору, і далека стріла лишається в кадрі.
  focus() { return smooth(clamp(this.rise / 5, 0, 1)) * this.rise * .45; }

  // На скільки віддалити камеру, коли стріла піднята й висунута.
  zoom() { return 1 + clamp(this.rise * .05, 0, .5); }

  status(label) {
    const S = this.S, sp = this.sp, rc = sp.reach;
    if ((S.phase === 'march' || S.phase === 'park') && !this.stowed()) return (S.phase === 'march' ? 'Марш · ' : 'Стоянка · ') + (this.craneStowed() ? 'опори піднімаються' : 'кран складається');
    if (S.phase === 'work') {
      if (!S.armed && this.ctx.speed() > .5) return 'Робота · машина зупиняється';
      if (!this.propsDown()) {
        const stab = sp.props.filter(p => p.stab);
        if (stab.some(p => S.pw[p.id] && S.pt[p.id] < .97)) return 'Робота · опори опускаються';
        return stab.some(p => !S.pw[p.id] && S.pt[p.id] > .02) ? 'Робота · опори піднімаються' : 'Робота · опори підняті, кран заблоковано';
      }
      if (S.auto === 'work') return 'Робота · кран розгортається';
      if (S.auto === 'stow') return 'Робота · кран складається';
      const extra = rc ? (rc.kind === 'tele' ? ' · стріла коротша на ' + S.reach.toFixed(1) + ' м' : ' · жираф ' + Math.round(S.jib) + '°') : '';
      return `Робота · стріла ${Math.round(S.elev)}° · поворот ${Math.round(S.slew)}°${extra} · гак ${S.drop.toFixed(1)} м`;
    }
    if (S.phase === 'stow') {
      if (!this.craneStowed()) return 'Згортання · кран складається';
      if (!this.propsUp()) return 'Згортання · опори піднімаються';
      return 'Згортання · готово до маршу';
    }
    return label;
  }

  ui() {
    const S = this.S, sp = this.sp, b = sp.boom, rc = sp.reach, aim = this.aimOk(), slew = aim && this.canSlew(), locks = {}, on = {};
    Object.assign(locks, {
      up: !aim || S.elev >= b.max - .01, down: !aim || S.elev <= b.min + .01,
      left: !slew || S.slew <= -sp.slew.max + .01, right: !slew || S.slew >= sp.slew.max - .01,
      hookUp: !aim || S.drop < .01, hookDown: !aim || S.drop >= sp.hook.max - .01, fold: !aim,
    });
    if (rc) {
      const pos = rc.kind === 'tele' ? S.reach : S.jib, max = rc.max;
      // Для телескопа «назовні» зменшує втягнення, для жирафа — збільшує кут розкладання.
      const outLimit = rc.kind === 'tele' ? pos <= .005 : pos >= max - .1, inLimit = rc.kind === 'tele' ? pos >= max - .005 : pos <= .1;
      locks.reachIn = !aim || inLimit; locks.reachOut = !aim || outLimit;
    }
    for (const p of sp.props) { locks[p.id] = S.phase !== 'work' || !!S.auto; on[p.id] = S.pw[p.id] > 0; }
    return { locks, on, labels: { fold: this.craneStowed() ? 'Розгорнути кран' : 'Скласти кран' }, ammo: null };
  }

  // Без анімації: усе, що рухається, доходить до кінця за один виклик.
  settle() {
    for (let i = 0; i < 3000; i++) {
      this.step(.05);
      if (this.calm()) break;
    }
  }

  calm() {
    const S = this.S, work = S.phase === 'work';
    if (S.auto || (work && !S.armed)) return false;
    for (const p of this.r.props) if (Math.abs(S.pt[p.spec.id] - (work ? S.pw[p.spec.id] : 0)) > 1e-6) return false;
    return work || this.craneStowed();
  }

  // Повертає модель у положення файлу: кран складено, опори стоять там, де їх намальовано.
  dispose() {
    this.releaseAll();
    this.S = this.initial();
    this.filePose = true;
    this.pose();
    this.filePose = false;
  }
}
