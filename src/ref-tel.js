// Колісні пускові установки з піднімним пакетом (Вільха, Сапсан) для «Інтерактивної моделі» довідника. Логіку перенесено з артефакту
// автора моделей: опори опускаються до землі, гідроциліндри піднімають пакет навколо заднього шарніра, пакет повертається вбік
// (Вільха), з труб злітають червоні кришки чи відкриваються круглі люки (Сапсан), ракети йдуть по одній чи залпом, а заряджання
// опускає пакет, ставить кришки на місце й піднімає його знову. Моделі цих машин не мають власного кліпу: усе, що рухається,
// будується тут з їхніх мешів (buildTelRig — один раз на модель) і лічиться кодом (TelLauncher — на кожен запуск сценарію).
// Інтерфейс збігається з PodLauncher (ref-launchers.js), тож рушій Machine (ref-machine.js) працює з обома однаково.
import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, Vector3 } from 'three';
import { D2R, clamp, ease, smooth } from './ref-fx.js';
import { ROCKETS } from './ref-flight.js';
import { AIM_CONTROLS } from './ref-launchers.js';
import { attach, bakeFloat, carve, componentsIn, labelsOfComponents, meshesOf, pieceOf, triangleComponents } from './ref-mesh.js';
import { liftEnds, ordFor } from './ref-rig-data.js';

const Y_AXIS = new Vector3(0, 1, 0);
const dec = o => { o.userData.decal = true; return o; };

// Коробка [мін x, y, z, макс x, y, z] навколо центра (cx, cy, cz) з піврозмірами h.
const around = (cx, cy, cz, hx, hy, hz) => [cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz];

// Відокремлює від мешів пакета кришки труб і колиску, що лишається на шасі; повертає { caps: [{ group, center }], keep: [mesh] }.
function carvePack(scene, spec, frame) {
  const out = { packs: [], caps: [], keep: [] };
  for (const mesh of meshesOf(scene.getObjectByName(spec.pack))) {
    bakeFloat(mesh);
    const comp = triangleComponents(mesh.geometry), groups = [], roles = [];
    if (spec.caps) {
      for (let i = 0; i < comp.count; i++) {
        const lo = comp.box[i * 6], hi = comp.box[i * 6 + 3];
        if (lo > spec.caps.minX && hi - lo < spec.caps.maxW) { groups.push([i]); roles.push({ cap: i }); }
      }
    }
    if (spec.keep) {
      const list = [];
      for (let i = 0; i < comp.count; i++) if (comp.box[i * 6 + 4] <= spec.keep.maxY) list.push(i);
      if (list.length) { groups.push(list); roles.push({ keep: true }); }
    }
    const home = mesh.parent;
    if (groups.length) {
      const parts = carve(mesh, labelsOfComponents(comp, groups), groups.length);
      parts.forEach((geometry, j) => {
        if (!geometry) return;
        const role = roles[j];
        if (role.keep) {
          const piece = pieceOf(mesh, geometry, mesh.name + '_cradle');
          home.add(piece);
          out.keep.push(piece);
          return;
        }
        const c = [comp.center[role.cap * 3], comp.center[role.cap * 3 + 1], comp.center[role.cap * 3 + 2]];
        const group = new Group();
        group.name = 'tel-cap';
        group.position.set(c[0], c[1], c[2]);
        attach(group, mesh, geometry, c);
        home.add(group);
        out.caps.push({ group, center: new Vector3(c[0], c[1], c[2]) });
      });
    }
    out.packs.push(mesh);
  }
  return out;
}

// Опорні штоки, що вже стоять на шасі моделі (підняті): шток і п’ята вирізаються з меша шасі й крутяться як окремі тіла, корпус опори
// лишається. Повертає [{ rod, foot, rodLen, y0, bottom }] для обох боків або [], якщо в моделі їх не знайдено.
function carveLegs(scene, spec) {
  const J = spec.jacks, node = J && scene.getObjectByName(J.node), chassis = node && meshesOf(node)[0];
  if (!chassis) return [];
  bakeFloat(chassis);
  const comp = triangleComponents(chassis.geometry), pad = .04, found = [];
  for (const s of [-1, 1]) {
    const z = s * J.z, th = J.foot.thick / 2;
    const rod = componentsIn(comp, around(J.x, (J.rod.top + J.rod.bottom) / 2, z, J.rod.r + pad, (J.rod.top - J.rod.bottom) / 2 + pad, J.rod.r + pad));
    const foot = componentsIn(comp, around(J.x, J.foot.y, z, J.foot.half + pad, th + pad, J.foot.half + pad));
    if (rod.length !== 1 || foot.length !== 1) return [];
    found.push({ s, z, rod, foot });
  }
  const parts = carve(chassis, labelsOfComponents(comp, found.flatMap(f => [f.rod, f.foot])), found.length * 2);
  const home = chassis.parent;
  return found.map((f, i) => {
    const mk = (geometry, y) => {
      const g = new Group();
      g.name = 'tel-jack';
      g.position.set(J.x, y, f.z);
      attach(g, chassis, geometry, [J.x, y, f.z]);
      home.add(g);
      return g;
    };
    return {
      rod: mk(parts[i * 2], J.rod.top), foot: mk(parts[i * 2 + 1], J.foot.y),
      rodLen: J.rod.top - J.rod.bottom, y0: J.foot.y, bottom: new Vector3(J.x, J.foot.y - J.foot.thick / 2, f.z),
    };
  });
}

// Вузли установки з файлу моделі; null, якщо потрібних частин немає. Після побудови модель стоїть у похідному положенні й виглядає як до неї.
export function buildTelRig(scene, spec) {
  scene.updateMatrixWorld(true);
  const node = scene.getObjectByName(spec.pack);
  if (!node || !meshesOf(node).length) return null;
  const [px, py] = spec.pivot;
  // Поворот навколо вертикалі через шарнір (yaw), потім підйом навколо шарніра (pitch), потім знову система моделі (frame):
  // у спокої весь ланцюг — одиничне перетворення, тому пакет лежить там, де лежав.
  const yaw = new Group(), pitch = new Group(), frame = new Group();
  yaw.name = 'tel-yaw'; pitch.name = 'tel-pitch'; frame.name = 'tel-frame';
  yaw.position.set(px, 0, 0); pitch.position.set(0, py, 0); frame.position.set(-px, -py, 0);
  yaw.add(pitch); pitch.add(frame);
  scene.add(yaw);
  scene.updateMatrixWorld(true);
  const { packs, caps, keep } = carvePack(scene, spec, frame);
  for (const m of packs) frame.attach(m);
  for (const c of caps) frame.attach(c.group);
  // Кришки відповідають трубам за близькістю: кожна труба має рівно одну.
  const tubes = spec.tubes, capOf = new Array(tubes.length).fill(null);
  if (spec.caps) {
    for (const c of caps) {
      let best = -1, bd = Infinity;
      tubes.forEach(([, y, z], k) => { const d = Math.hypot(y - c.center.y, z - c.center.z); if (d < bd) { bd = d; best = k; } });
      if (best < 0 || bd > .15 || capOf[best]) return null;
      capOf[best] = c;
    }
    if (capOf.some(c => !c)) return null;
  }
  const rig = { spec, scene, yaw, pitch, frame, packs, keep, caps: capOf, holes: [], lids: [], legs: carveLegs(scene, spec), lifts: [] };
  // Темні отвори відкритих труб: перед зрізом труби, видимі, коли кришку знято (у Сапсана люк закриває отвір, поки кришка не відкрилася).
  const dark = new MeshBasicMaterial({ color: 0x07080a });
  const hole = spec.hole;
  tubes.forEach(([x, y, z], k) => {
    const m = dec(new Mesh(new CircleGeometry(hole.r, 40), dark));
    m.rotation.y = Math.PI / 2; m.position.set(hole.x, y, z);
    m.visible = !spec.caps;
    m.name = 'tel-hole';
    frame.add(m);
    rig.holes.push(m);
  });
  // Люки з кришками (Сапсан): диск із кільцем на петлі по верхньому краю отвору.
  if (spec.lid) {
    const r = spec.lid.r, lidMat = new MeshStandardMaterial({ color: 0x56603f, metalness: .2, roughness: .75 });
    const steel = new MeshStandardMaterial({ color: 0x3b3f45, metalness: .5, roughness: .45 });
    for (const [x, y, z] of tubes) {
      const hinge = new Group();
      hinge.name = 'tel-lid'; hinge.position.set(x + .012, y + r, z);
      const lid = dec(new Mesh(new CylinderGeometry(r + .04, r + .04, .07, 40), lidMat));
      lid.rotation.z = Math.PI / 2; lid.position.set(.035, -r, 0);
      const ring = dec(new Mesh(new TorusGeometry(r + .02, .03, 8, 40), steel));
      ring.rotation.y = Math.PI / 2; ring.position.set(.07, -r, 0);
      hinge.add(lid, ring);
      frame.add(hinge);
      rig.lids.push(hinge);
    }
  }
  // Гідроциліндри підйому: корпус і шток, що висувається; видно, лише коли пакет піднято. Геометрія йде від нуля вгору по Y, тож
  // довжину задає масштаб, а початок лежить у точці кріплення на шасі.
  const body = new MeshStandardMaterial({ color: 0x3b3f45, metalness: .5, roughness: .45 });
  const chrome = new MeshStandardMaterial({ color: 0xa9adb3, metalness: .8, roughness: .25 });
  const bodyGeo = new CylinderGeometry(.13, .13, 1, 16).translate(0, .5, 0), rodGeo = new CylinderGeometry(.085, .085, 1, 14).translate(0, .5, 0);
  rig.lifts = [-1, 1].map(() => {
    const g = new Group(), b = dec(new Mesh(bodyGeo, body)), r = dec(new Mesh(rodGeo, chrome));
    g.name = 'tel-lift'; g.visible = false;
    g.add(b, r);
    scene.add(g);
    return { g, body: b, rod: r };
  });
  return rig;
}

export class TelLauncher {
  // rig — buildTelRig(); ctx — { phase(id), toast(text, s), rocket(kind) → модель | null, launch(kind, модель, p, d, { back }), flying(),
  // muzzleToWorld(p, d) → { p, d } у системі світу, speed() → швидкість машини (м/с), gap(точка у системі моделі) → висота над землею,
  // shed(вузол, v, w) — кришка злітає з труби }
  constructor(rig, ctx) {
    this.r = rig; this.sp = rig.spec; this.ctx = ctx;
    const init = this.sp.elev.init;
    this.max = this.sp.ammo;
    this.ord = ordFor(this.max);
    this.gap = Math.max(.12, Math.min(.55, 6 / Math.max(1, this.max)));
    this.S = { phase: 'park', jack: 0, lift: 0, elev: init, tElev: init, trav: 0, tTrav: 0, ammo: this.max, queue: 0, fireT: 0, lid: 0, lidT: 0, wait: 0, reload: 0, reloadT: 0, recoil: 0 };
    this.hold = { up: 0, down: 0, left: 0, right: 0 }; this.heldT = { up: 0, down: 0, left: 0, right: 0 }; this.release = { up: 0, down: 0, left: 0, right: 0 };
    this.controls = [
      ...AIM_CONTROLS,
      { id: 'fire', label: 'Пуск', key: 'X', code: 'KeyX', row: 'weapon' },
      { id: 'salvo', label: 'Усе, що є', key: 'Z', code: 'KeyZ', row: 'weapon' },
      { id: 'reload', label: 'Перезарядити', key: 'H', code: 'KeyH', row: 'weapon' },
    ];
    this.v = new Vector3();
    this.applyAmmo();
  }

  get rocket() { return this.sp.rocket; }
  get busy() { return this.S.reload !== 0; }
  get deployed() { return Math.max(this.S.jack, this.S.lift); }
  stowed() { return this.S.jack < .02 && this.S.lift < .02 && !this.S.reload; }
  get speedTarget() { return this.stowed() ? this.sp.march : 0; }

  aimOk() { const S = this.S; return S.phase === 'position' && !S.reload && S.lift > .5; }
  canFire() { const S = this.S; return S.phase === 'position' && !S.reload && S.lift > .97 && S.ammo > 0 && !S.wait && !!this.ctx.rocket(this.sp.rocket); }

  // Кришки на трубах і темні отвори за залишком ракет: випущені труби відкриті. У Сапсана люки відкриває кнопка пуску, отвори завжди на місці.
  applyAmmo() {
    const S = this.S, r = this.r;
    if (S.reload || !this.sp.caps) return;
    const fired = this.max - S.ammo;
    for (let i = 0; i < this.max; i++) {
      const k = this.ord[i], open = i < fired;
      r.caps[k].group.visible = !open;
      r.holes[k].visible = open;
    }
  }

  enter(phase) {
    if (this.S.reload) return;
    this.S.phase = phase; this.S.queue = 0;
    if (phase !== 'position') this.S.wait = 0;
    else { this.S.tElev = this.sp.elev.init; this.S.tTrav = 0; }
  }

  press(id) {
    const S = this.S;
    if (id === 'fire') { if (this.canFire()) this.fireOne(); }
    else if (id === 'salvo') { if (this.canFire() && this.max > 1) { S.queue = S.ammo; S.fireT = 0; } }
    else if (id === 'reload') this.startReload();
  }

  setHold(id, on) {
    if (!(id in this.hold)) return;
    if ((id === 'left' || id === 'right') && !this.sp.trav.max) return;
    if (on) {
      if (!this.aimOk()) return;
      if (!this.hold[id]) { this.hold[id] = 1; this.heldT[id] = 0; }
      this.release[id] = 0;
    } else if (this.hold[id] && !this.release[id]) this.release[id] = Math.max(0, .26 - this.heldT[id]) || 1e-3; // короткий дотик усе одно зрушує пакет
  }

  // Без анімації кожне натискання кнопки наведення — один крок.
  nudge(id) {
    if (!this.aimOk()) return;
    const S = this.S, sp = this.sp;
    if (id === 'up' || id === 'down') S.elev = S.tElev = clamp(S.elev + (id === 'up' ? 8 : -8), sp.elev.min, sp.elev.max);
    else if ((id === 'left' || id === 'right') && sp.trav.max) S.trav = S.tTrav = clamp(S.trav + (id === 'left' ? 15 : -15), -sp.trav.max, sp.trav.max);
    this.pose();
  }

  releaseAll() { for (const id of Object.keys(this.hold)) { this.hold[id] = 0; this.release[id] = 0; } }

  startReload() {
    const S = this.S;
    if (S.reload || S.wait || S.ammo >= this.max) return;
    if (S.phase !== 'position') this.ctx.phase('position');
    S.queue = 0; S.reload = 1; S.reloadT = 0;
  }

  // Дуло труби k у системі сцени: точка й напрямок за поточним положенням пакета.
  muzzle(k) {
    const [x, y, z] = this.sp.tubes[k], f = this.r.frame;
    f.updateWorldMatrix(true, false);
    return { p: new Vector3(x, y, z).applyMatrix4(f.matrixWorld), d: new Vector3(1, 0, 0).transformDirection(f.matrixWorld).normalize() };
  }

  // Один пуск: у Сапсана перший пуск лише відкриває люки й чекає, поки вони відкриються.
  fireOne() {
    const S = this.S;
    if (!this.canFire()) return false;
    if (this.r.lids.length && S.lid < .99) {
      S.lidT = 1; S.wait = 1;
      this.ctx.toast('Люки контейнерів відкриваються', 1.2);
      return true;
    }
    return this.launch();
  }

  launch() {
    const S = this.S, sp = this.sp, kind = sp.rocket, template = this.ctx.rocket(kind);
    if (S.ammo <= 0 || !template) return false;
    const k = this.ord[this.max - S.ammo];
    S.ammo--;
    const { p, d } = this.muzzle(k);
    const w = this.ctx.muzzleToWorld(p, d);
    const length = (ROCKETS[kind].procedural || { length: 4 }).length;
    this.ctx.launch(kind, template, w.p, w.d, { back: length / 2 + .12 });
    this.shed(k, w.d);
    this.applyAmmo();
    S.recoil = 1;
    this.ctx.toast('Пуск ' + ROCKETS[kind].name + (this.max > 1 ? ' · ' + (sp.caps ? 'труба ' : 'контейнер ') + (k + 1) + ' з ' + this.max : ''), 1.6);
    return true;
  }

  // Кришка труби k злітає разом із ракетою: летить уперед і вгору, крутячись.
  shed(k, d) {
    const cap = this.r.caps[k];
    if (!cap || !cap.group.visible) return;
    cap.group.visible = false;
    this.r.holes[k].visible = true;
    const v = d.clone().multiplyScalar(14 + Math.random() * 6).add(new Vector3((Math.random() - .5) * 4, 2 + Math.random() * 3, (Math.random() - .5) * 4));
    this.ctx.shed(cap.group, v, new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8));
  }

  // Опори опускаються, потім піднімається пакет; згортання — у зворотному порядку. Хід можливий, лише коли машина стоїть, а попередній
  // вузол майже на місці. Під час заряджання пакет опускається й піднімається знову, опори лишаються внизу.
  stages(dt) {
    const S = this.S, sp = this.sp, order = ['jack', 'lift'], speed = this.ctx.speed();
    const want = S.phase === 'position' || S.reload ? 1 : 0, target = { jack: want, lift: want };
    if (S.reload === 1 || S.reload === 2) target.lift = 0; else if (S.reload === 3) target.lift = 1;
    order.forEach((key, i) => {
      const t = target[key], cur = S[key];
      if (t === cur) return;
      let ok = true;
      if (t > cur) { if (speed > .5) ok = false; for (let j = 0; j < i; j++) if (S[order[j]] < .97) ok = false; }
      else for (let j = i + 1; j < order.length; j++) if (S[order[j]] > .02) ok = false;
      if (!ok) return;
      const dk = dt / sp.stages[key];
      S[key] = Math.abs(t - cur) <= dk ? t : cur + Math.sign(t - cur) * dk;
    });
  }

  step(dt) {
    const S = this.S, sp = this.sp;
    this.stages(dt);
    if (!this.aimOk()) this.releaseAll();
    for (const id of Object.keys(this.hold)) {
      if (!this.hold[id]) continue;
      this.heldT[id] += dt;
      if (this.release[id]) { this.release[id] -= dt; if (this.release[id] <= 0) { this.hold[id] = 0; this.release[id] = 0; } }
    }
    const dE = this.hold.up - this.hold.down, dT = sp.trav.max ? this.hold.left - this.hold.right : 0;
    if (dE) { S.elev = clamp(S.elev + dE * dt * sp.elev.rate, sp.elev.min, sp.elev.max); S.tElev = S.elev; } else S.elev = ease(S.elev, S.tElev, 2.2, dt);
    if (dT) { S.trav = clamp(S.trav + dT * dt * sp.trav.rate, -sp.trav.max, sp.trav.max); S.tTrav = S.trav; } else S.trav = ease(S.trav, S.tTrav, 1.6, dt);
    S.recoil = Math.max(0, S.recoil - dt * 3);
    // Люки відкриті лише на вогневій позиції: при згортанні й під час заряджання вони закриваються.
    if (S.phase !== 'position' || S.reload) S.lidT = 0;
    S.lid = ease(S.lid, S.lidT, 5, dt);
    if (Math.abs(S.lid - S.lidT) < .01) S.lid = S.lidT;
    // Заряджання: пакет опущено → кришки ставляться одна за одною → боєкомплект повний → пакет піднімається.
    if (S.reload === 1 && S.lift < .02) { S.reload = 2; S.reloadT = 0; S.lidT = 0; }
    else if (S.reload === 2) {
      S.reloadT += dt;
      if (sp.caps) {
        const n = Math.floor(S.reloadT / sp.reload * this.max * 1.15);
        for (let i = 0; i < Math.min(this.max, n); i++) { this.r.caps[this.ord[i]].group.visible = true; this.r.holes[this.ord[i]].visible = false; }
      }
      if (S.reloadT > sp.reload) {
        S.ammo = this.max; S.reload = 3;
        this.applyAmmo();
        this.ctx.toast('Боєкомплект поповнено · ' + S.ammo, 2.5);
      }
    } else if (S.reload === 3 && S.lift > .97) S.reload = 0;
    if (S.wait && S.lid >= .99) { S.wait = 0; this.launch(); }
    this.pose();
    if (S.queue > 0 && !S.wait) {
      S.fireT -= dt;
      if (S.fireT <= 0) {
        if (this.fireOne()) S.fireT = this.gap;
        S.queue--;
        if (S.ammo <= 0) S.queue = 0;
      }
    }
  }

  // Положення вузлів: опори, підйом і поворот пакета, гідроциліндри, люки.
  pose() {
    const S = this.S, r = this.r, sj = smooth(S.jack), sl = smooth(S.lift);
    this.legsAt(sj);
    r.pitch.rotation.z = S.elev * sl * D2R - S.recoil * Math.sin(S.recoil * 22) * .006;
    r.yaw.rotation.y = S.trav * sl * D2R;
    this.liftsAt(sl);
    for (const hinge of r.lids) hinge.rotation.z = S.lid * 1.75;
  }

  // Опорний шток тягнеться вниз до землі під п’ятою: скільки метрів до неї, дає рушій (на рівній землі — висота п’яти).
  legsAt(sj) {
    for (const leg of this.r.legs) {
      const drop = sj > 0 ? clamp(this.ctx.gap(leg.bottom), 0, 1.4) * sj : 0;
      leg.rod.scale.y = 1 + drop / leg.rodLen;
      leg.foot.position.y = leg.y0 - drop;
    }
  }

  // Гідроциліндри йдуть за пакетом: корпус до 1,4 м, шток висувається назустріч точці кріплення на пакеті.
  liftsAt(sl) {
    const r = this.r, show = sl > .004, ends = show ? liftEnds(this.sp, r.pitch.rotation.z, r.yaw.rotation.y) : null;
    r.lifts.forEach((l, i) => {
      l.g.visible = show;
      if (!show) return;
      const { a, b } = ends[i], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      l.g.position.set(a[0], a[1], a[2]);
      l.g.quaternion.setFromUnitVectors(Y_AXIS, this.v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).divideScalar(len));
      const bl = Math.min(len, 1.4), rl = Math.max(.01, len - bl * .85);
      l.body.scale.y = bl;
      l.rod.scale.y = rl; l.rod.position.y = bl * .85;
    });
  }

  // Висота (м) точки, на яку дивиться камера, над землею: піднятий пакет тягне погляд угору до середини своєї осі.
  focus() {
    return smooth(this.S.lift) * .5 * this.sp.len * Math.sin(this.S.elev * D2R);
  }

  // Підпис дії для рядка стану.
  status(label) {
    const S = this.S, sp = this.sp, n = S.ammo, word = n === 1 ? 'ракета' : n > 1 && n < 5 ? 'ракети' : 'ракет';
    if (S.reload === 1) return 'Перезарядження · пускова опускається';
    if (S.reload === 2) return 'Перезарядження · ' + (sp.caps ? 'встановлюються кришки труб' : 'боєприпас замінюється');
    if (S.reload === 3) return 'Перезарядження · пускова піднімається';
    if (S.phase === 'march' && !this.stowed()) return 'Марш · пускова згортається';
    if (S.phase === 'position') {
      if (S.jack < .97) return 'Вогнева позиція · опори опускаються';
      if (S.lift < .97) return 'Вогнева позиція · пускова піднімається';
      if (S.wait) return 'Вогнева позиція · люки відкриваються';
      const a = Math.round(S.elev), tr = sp.trav.max ? ' · поворот ' + Math.round(S.trav) + '°' : '';
      return `Вогнева позиція · кут ${a}°${tr} · ${n} ${word}`;
    }
    if (S.phase === 'stow') {
      if (S.lift > .02) return 'Згортання · пускова опускається';
      if (S.jack > .02) return 'Згортання · опори піднімаються';
      return 'Згортання · готово до маршу';
    }
    return label;
  }

  // Стан кнопок: що заблоковано, що ввімкнено, підписи, боєзапас.
  ui() {
    const S = this.S, aim = this.aimOk(), fire = this.canFire(), trav = aim && this.sp.trav.max > 0;
    return {
      locks: { up: !aim, down: !aim, left: !trav, right: !trav, fire: !fire, salvo: !fire || this.max < 2, reload: S.ammo >= this.max || !!S.reload || !!S.wait },
      on: { reload: !!S.reload },
      labels: {},
      ammo: { n: S.ammo, max: this.max, big: this.max <= 2 },
    };
  }

  // Без анімації: усе, що рухається, доходить до кінця за один виклик (чергу пусків скасовано: ракети без польоту не потрібні).
  settle() {
    const S = this.S, deployed = () => (S.phase === 'position' || S.reload ? 1 : 0);
    S.queue = 0;
    for (let i = 0; i < 1200; i++) {
      this.step(.05);
      const lift = S.reload ? (S.reload === 3 ? 1 : 0) : deployed();
      if (!S.reload && !S.wait && S.jack === deployed() && S.lift === lift && S.lid === S.lidT && Math.abs(S.elev - S.tElev) < .05 && Math.abs(S.trav - S.tTrav) < .05) break;
    }
  }

  // Повертає все до похідного положення: пакет опущено, опори підняті, кришки на місці, люки закриті.
  dispose() {
    const S = this.S, r = this.r, init = this.sp.elev.init;
    this.releaseAll();
    Object.assign(S, { phase: 'park', jack: 0, lift: 0, elev: init, tElev: init, trav: 0, tTrav: 0, ammo: this.max, queue: 0, wait: 0, lid: 0, lidT: 0, reload: 0, recoil: 0 });
    this.pose();
    for (const c of r.caps) if (c) c.group.visible = true;
    r.holes.forEach(h => { h.visible = !this.sp.caps; });
  }
}
