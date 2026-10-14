// Пускові установки з контейнерами (HIMARS, M270) для «Інтерактивної моделі» довідника. Порт логіки з артефактів автора моделей:
// установка виходить у бойове положення, наводиться по куту й напрямку, пускає ракети з труб (порожні труби стають темними
// отворами на торці контейнера) і заряджається власним кліпом моделі. Рух вузлів, що їх веде кліп, рахує three.js лише тоді,
// коли значення змінилося, тому наведення додається зверху від позиції кліпу (див. rebase/keep/drop нижче).
// Побудова вузлів (buildPodRig) робиться один раз на модель, стан сеансу (PodLauncher) — на кожен запуск сценарію.
import { AnimationMixer, CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PropertyBinding, Quaternion, Vector3 } from 'three';
import { D2R, clamp, ease } from './ref-fx.js';
import { ROCKETS } from './ref-flight.js';

const QNAN = () => new Quaternion(NaN, NaN, NaN, NaN);

// Перша кінцева точка гідроциліндра у кадрі рухомої частини, щоб потім цілитися в неї з будь-якого кута.
function strutAnchors(rig) {
  rig.mixer.setTime(0);
  rig.scene.updateMatrixWorld(true);
  rig.arm.updateMatrix();
  const inv = rig.arm.matrix.clone().invert();
  return rig.struts.map((s, i) => { s.updateMatrix(); return new Vector3(0, rig.rods[i].position.y + rig.spec.rodLen[i], 0).applyMatrix4(s.matrix).applyMatrix4(inv); });
}

// Темні кола на торці контейнера: по одному на кожну випущену трубу й накладка з великою заглушкою для одиночної ракети.
function buildHoles(rig) {
  const sp = rig.spec, dark = new MeshBasicMaterial({ color: 0x07080a }), ring = new MeshBasicMaterial({ color: 0x2c2b26 });
  const disc = (parent, r, z, y, x) => {
    const g = new Group(), a = new Mesh(new CircleGeometry(r * 1.12, 28), ring), b = new Mesh(new CircleGeometry(r, 28), dark);
    b.position.z = .004; g.add(a, b);
    g.rotation.y = Math.PI / 2; g.position.set(x, y, z); g.visible = false; g.userData.decal = true;
    parent.add(g);
    return g;
  };
  for (const pod of rig.pods) {
    pod.holes = sp.tubes.map(([z, y]) => disc(pod.full, .145, z, y, sp.podX + .006));
    const plate = new Group();
    plate.rotation.y = Math.PI / 2; plate.position.set(sp.podX + .012, sp.bigY, 0); plate.userData.decal = true;
    plate.add(new Mesh(new PlaneGeometry(sp.plate[0], sp.plate[1]), new MeshStandardMaterial({ color: 0x4d5446, roughness: .8, metalness: .2 })));
    const cap = new Mesh(new CircleGeometry(sp.bigR, 36), new MeshStandardMaterial({ color: 0x6b7260, roughness: .8 }));
    cap.position.z = .004; plate.add(cap);
    plate.visible = false; pod.full.add(plate); pod.plate = plate;
    pod.bigHole = disc(pod.full, sp.bigR, 0, sp.bigY, sp.podX + .02);
  }
}

// Вузли пускової з файлу моделі; null, якщо в моделі немає потрібних вузлів або кліпу.
export function buildPodRig(scene, spec, clip) {
  const by = n => scene.getObjectByName(n), nd = spec.nodes;
  const rig = {
    spec, scene, clip, turret: by(nd.turret), arm: by(nd.arm), struts: nd.struts.map(by), rods: nd.rods.map(by),
    pods: nd.pods.map(p => ({ empty: by(p.empty), full: by(p.full) })),
  };
  const all = [rig.turret, rig.arm, ...rig.struts, ...rig.rods, ...rig.pods.flatMap(p => [p.empty, p.full])];
  if (!clip || !all.every(Boolean)) return null;
  // Стан вузлів кліпу на початку: після сценарію модель повертається саме до нього.
  const names = new Set(clip.tracks.map(t => PropertyBinding.parseTrackName(t.name).nodeName));
  rig.rest = [...names].map(n => by(n)).filter(Boolean).map(node => ({ node, p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone(), v: node.visible }));
  rig.mixer = new AnimationMixer(scene);
  rig.mixer.clipAction(clip).play();
  rig.anchor = strutAnchors(rig);
  buildHoles(rig);
  rig.mixer.stopAllAction();
  rig.mixer.uncacheRoot(scene);
  rig.mixer = null;
  for (const { node, p, q, s, v } of rig.rest) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); node.visible = v; }
  return rig;
}

export const AIM_CONTROLS = [
  { id: 'up', label: 'Підняти', key: '↑', code: 'ArrowUp', hold: true, row: 'aim' },
  { id: 'down', label: 'Опустити', key: '↓', code: 'ArrowDown', hold: true, row: 'aim' },
  { id: 'left', label: 'Вліво', key: '←', code: 'ArrowLeft', hold: true, row: 'aim' },
  { id: 'right', label: 'Вправо', key: '→', code: 'ArrowRight', hold: true, row: 'aim' },
];

export class PodLauncher {
  // rig — buildPodRig(); ctx — { phase(id), toast(text, s), rocket(kind) → модель | null, launch(kind, модель, p, d), flying() → чи є ракети в польоті,
  // muzzleToWorld(p, d) → { p, d } у системі світу }
  constructor(rig, ctx) {
    this.r = rig; this.sp = rig.spec; this.ctx = ctx;
    this.mixer = new AnimationMixer(rig.scene);
    this.mixer.clipAction(rig.clip).play();
    const init = this.sp.elev.init;
    this.S = { deploy: 0, elev: init, tElev: init, trav: 0, tTrav: 0, type: 'gmlrs', ammo: this.sp.ammo.gmlrs, queue: 0, fireT: 0, reload: 0, reloadT: 0, recoil: 0, phase: 'park' };
    this.hold = { up: 0, down: 0, left: 0, right: 0 }; this.heldT = { up: 0, down: 0, left: 0, right: 0 }; this.release = { up: 0, down: 0, left: 0, right: 0 };
    this.qa = { t: { base: new Quaternion(), out: QNAN() }, m: { base: new Quaternion(), out: QNAN() } };
    this.a = new Vector3(); this.b = new Vector3();
    this.controls = [
      ...AIM_CONTROLS,
      { id: 'fire', label: 'Пуск', key: 'X', code: 'KeyX', row: 'weapon' },
      { id: 'salvo', label: 'Усе, що є', key: 'Z', code: 'KeyZ', row: 'weapon' },
      { id: 'reload', label: 'Перезарядити', key: 'H', code: 'KeyH', row: 'weapon' },
      { id: 'type', label: 'Тип', key: 'T', code: 'KeyT', row: 'weapon' },
    ];
    this.applyAmmo();
  }

  get max() { return this.sp.ammo[this.S.type]; }
  get busy() { return this.S.reload !== 0; }
  get deployed() { return this.S.deploy; }
  get speedTarget() { return this.S.deploy > .02 ? 0 : this.sp.march; }

  aimOk() { return this.S.phase === 'position' && !this.S.reload; }
  canFire() { const S = this.S; return this.S.phase === 'position' && !S.reload && S.deploy > .97 && S.elev > this.sp.elev.min && S.ammo > 0 && !!this.ctx.rocket(S.type); }

  // Скільки труб контейнера p уже випущено за залишком ракет.
  firedIn(p) {
    const f = this.max - this.S.ammo;
    if (this.sp.order === 'single') return f;
    return this.S.type === 'gmlrs' ? Math.floor((f + (p === 0 ? 1 : 0)) / 2) : (f > p ? 1 : 0);
  }

  // Скільки ракет лишилося в контейнері p.
  left(p) {
    if (this.sp.order === 'single') return this.S.ammo;
    return (this.S.type === 'gmlrs' ? this.max / 2 : 1) - this.firedIn(p);
  }

  // Темні отвори на випущених трубах і накладка для одиночної ракети.
  applyAmmo() {
    if (this.S.reload) return;
    const gm = this.S.type === 'gmlrs';
    this.r.pods.forEach((pod, i) => {
      const f = this.firedIn(i);
      pod.holes.forEach((h, t) => { h.visible = gm && t < f; });
      pod.bigHole.visible = !gm && f > 0;
      pod.plate.visible = !gm;
    });
  }

  enter(phase) {
    if (this.S.reload) return;
    this.S.phase = phase; this.S.queue = 0;
    if (phase === 'position') { this.S.tElev = this.sp.elev.init; this.S.tTrav = 0; }
  }

  press(id) {
    const S = this.S;
    if (id === 'fire') { if (this.canFire()) this.fireOne(); }
    else if (id === 'salvo') { if (this.canFire()) { S.queue = S.ammo; S.fireT = 0; } }
    else if (id === 'reload') this.startReload();
    else if (id === 'type') this.switchType();
  }

  setHold(id, on) {
    if (!(id in this.hold)) return;
    if (on) {
      if (!this.aimOk()) return;
      if (!this.hold[id]) { this.hold[id] = 1; this.heldT[id] = 0; }
      this.release[id] = 0;
    } else if (this.hold[id] && !this.release[id]) this.release[id] = Math.max(0, .26 - this.heldT[id]) || 1e-3; // короткий дотик усе одно зрушує установку
  }

  // Без анімації кожне натискання кнопки наведення — один крок.
  nudge(id) {
    if (!this.aimOk()) return;
    const S = this.S, sp = this.sp;
    if (id === 'up' || id === 'down') S.elev = S.tElev = clamp(S.elev + (id === 'up' ? 8 : -8), sp.elev.min, sp.elev.max);
    else if (id === 'left' || id === 'right') S.trav = S.tTrav = clamp(S.trav + (id === 'left' ? 15 : -15), -sp.trav.max, sp.trav.max);
    this.pose();
  }

  releaseAll() { for (const id of Object.keys(this.hold)) { this.hold[id] = 0; this.release[id] = 0; } }

  switchType() {
    const S = this.S;
    if (S.queue || S.reload || this.ctx.flying()) return;
    S.type = S.type === 'gmlrs' ? 'atacms' : 'gmlrs';
    S.ammo = this.max;
    this.applyAmmo();
  }

  startReload() {
    const S = this.S;
    if (S.reload || S.ammo > 0) return;
    if (S.phase !== 'position') this.ctx.phase('position');
    S.queue = 0; S.tElev = this.sp.elev.init; S.tTrav = 0; S.reload = 1; S.reloadT = 0;
  }

  muzzle(k) {
    const sp = this.sp, S = this.S;
    const podIndex = sp.order === 'alternate' ? k % 2 : 0, tube = sp.order === 'alternate' ? Math.floor(k / 2) : k;
    const pod = this.r.pods[podIndex].full;
    pod.updateWorldMatrix(true, false);
    const [z, y] = S.type === 'gmlrs' ? sp.tubes[tube] : [0, sp.bigY];
    const p = new Vector3(sp.podX, y, z).applyMatrix4(pod.matrixWorld);
    const d = new Vector3(1, 0, 0).transformDirection(pod.matrixWorld).normalize();
    return { p, d, podIndex, tube };
  }

  fireOne() {
    const S = this.S, kind = S.type, template = this.ctx.rocket(kind);
    if (S.ammo <= 0 || !template) return false;
    const k = this.max - S.ammo;
    S.ammo--;
    this.applyAmmo();
    const { p, d, podIndex, tube } = this.muzzle(k);
    const w = this.ctx.muzzleToWorld(p, d);
    this.ctx.launch(kind, template, w.p, w.d);
    S.recoil = 1;
    const side = this.sp.order === 'alternate' ? (podIndex ? 'лівий' : 'правий') + ' пакет, ' : '';
    this.ctx.toast('Пуск ' + ROCKETS[kind].name + ' · ' + side + (kind === 'gmlrs' ? 'труба ' + (tube + 1) : 'одиночна'), 1.4);
    return true;
  }

  step(dt) {
    const S = this.S, sp = this.sp;
    const dep = S.phase === 'position' || S.reload ? 1 : 0;
    const dd = dep - S.deploy, dk = dt / sp.deploy;
    S.deploy = Math.abs(dd) <= dk ? dep : S.deploy + Math.sign(dd) * dk;
    if (!this.aimOk()) this.releaseAll();
    for (const id of Object.keys(this.hold)) {
      if (!this.hold[id]) continue;
      this.heldT[id] += dt;
      if (this.release[id]) { this.release[id] -= dt; if (this.release[id] <= 0) { this.hold[id] = 0; this.release[id] = 0; } }
    }
    const dE = this.hold.up - this.hold.down, dT = this.hold.left - this.hold.right;
    if (dE) { S.elev = clamp(S.elev + dE * dt * sp.elev.rate, sp.elev.min, sp.elev.max); S.tElev = S.elev; } else S.elev = ease(S.elev, S.tElev, 2.2, dt);
    if (dT) { S.trav = clamp(S.trav + dT * dt * sp.trav.rate, -sp.trav.max, sp.trav.max); S.tTrav = S.trav; } else S.trav = ease(S.trav, S.tTrav, 1.6, dt);
    S.recoil = Math.max(0, S.recoil - dt * 3);
    const init = sp.elev.init;
    if (S.reload === 1 && S.deploy > .999 && Math.abs(S.elev - init) < 1 && Math.abs(S.trav) < 1.5) { S.reload = 2; S.reloadT = 0; }
    else if (S.reload === 2) {
      S.reloadT += dt;
      if (S.reloadT * sp.clip.speed >= sp.clip.end) {
        S.reload = 0; S.ammo = this.max; S.elev = S.tElev = init; S.trav = S.tTrav = 0;
        this.applyAmmo();
        this.ctx.toast(sp.changed + ' · ' + S.ammo + (S.ammo === 1 ? ' ракета' : S.ammo < 5 ? ' ракети' : ' ракет'), 2.5);
      }
    }
    this.pose();
    if (S.queue > 0) {
      S.fireT -= dt;
      if (S.fireT <= 0) {
        if (this.fireOne()) S.fireT = sp.gap[S.type];
        S.queue--;
        if (S.ammo <= 0) S.queue = 0;
      }
    }
  }

  // Положення вузлів: кліп моделі (підйом установки, заряджання) плюс ручне наведення. Для HIMARS кліп веде і підйом (час від
  // clip.stow до 0), для M270 — лише заряджання, а підйом і поворот задає код.
  pose() {
    const S = this.S, sp = this.sp, r = this.r, reloading = S.reload === 2;
    const hand = sp.mode === 'hand';
    const clipT = reloading ? Math.min(S.reloadT * sp.clip.speed, sp.clip.end) : hand ? 0 : sp.clip.stow * (1 - S.deploy);
    this.mixer.setTime(clipT);
    if (!hand) { this.rebase(r.turret, this.qa.t); this.rebase(r.arm, this.qa.m); }
    r.pods.forEach((pod, i) => {
      if (reloading) { pod.empty.visible = pod.full.visible = true; return; }
      pod.empty.scale.setScalar(1); pod.full.scale.setScalar(1);
      const one = S.type !== 'gmlrs', left = this.left(i);
      pod.empty.visible = left <= 0 && !one; pod.full.visible = left > 0 || one;
    });
    if (reloading) {
      for (const pod of r.pods) { pod.holes.forEach(h => { h.visible = false; }); pod.bigHole.visible = false; pod.plate.visible = false; }
      if (!hand) { this.drop(this.qa.t); this.drop(this.qa.m); }
      return;
    }
    const recoil = S.recoil * Math.sin(S.recoil * 22) * .012;
    if (hand) {
      r.turret.rotation.y = -S.trav * D2R * S.deploy;
      r.arm.rotation.set(0, 0, S.elev * S.deploy * D2R - recoil);
    } else {
      const dEl = (S.elev - sp.elev.init) * D2R * S.deploy - recoil;
      r.turret.rotateY(S.trav * D2R * S.deploy); r.arm.rotateZ(-dEl);
      this.keep(r.turret, this.qa.t); this.keep(r.arm, this.qa.m);
    }
    this.struts();
  }

  // Гідроциліндри йдуть за установкою: шток націлено в закріплену точку, вилка виїжджає назустріч.
  struts() {
    const r = this.r, a = this.a, b = this.b;
    r.turret.updateMatrix(); r.arm.updateMatrix();
    r.struts.forEach((s, i) => {
      a.copy(r.anchor[i]).applyMatrix4(r.arm.matrix); b.copy(s.position);
      const dx = a.x - b.x, dy = a.y - b.y;
      s.rotation.set(0, 0, Math.atan2(-dx, dy));
      r.rods[i].position.y = Math.hypot(dx, dy) - this.sp.rodLen[i];
    });
  }

  // Мікшер пише вузол лише тоді, коли змінилося значення кліпу, тож власне наведення не повинно накопичуватися кадр за кадром.
  rebase(node, qa) { if (qa.out.equals(node.quaternion)) node.quaternion.copy(qa.base); else qa.base.copy(node.quaternion); }
  keep(node, qa) { qa.out.copy(node.quaternion); }
  drop(qa) { qa.out.set(NaN, NaN, NaN, NaN); }

  // Підпис дії для рядка стану.
  status(label) {
    const S = this.S, sp = this.sp;
    if (S.reload === 1) return 'Перезарядження · пускова в бойове положення';
    if (S.reload === 2) { const t = S.reloadT * sp.clip.speed, row = sp.reload.filter(x => t >= x[0]).pop(); return 'Перезарядження · ' + (row ? row[1] : sp.reload[0][1]); }
    if (S.phase === 'position') {
      if (S.deploy < .97) return 'Вогнева позиція · підйом пускової';
      const n = S.ammo;
      return `Вогнева позиція · кут ${Math.round(S.elev)}° · поворот ${Math.round(S.trav)}° · ${n} ${n === 1 ? 'ракета' : n > 1 && n < 5 ? 'ракети' : 'ракет'}`;
    }
    return label;
  }

  // Стан кнопок: що заблоковано, що ввімкнено, підписи, боєзапас.
  ui() {
    const S = this.S, aim = this.aimOk(), fire = this.canFire(), type = S.type === 'gmlrs' ? 'GMLRS' : 'ATACMS';
    const locks = { up: !aim, down: !aim, left: !aim, right: !aim, fire: !fire, salvo: !fire, reload: S.ammo > 0 || !!S.reload, type: !!(S.queue || S.reload || this.ctx.flying()) };
    return {
      locks, on: { reload: !!S.reload },
      labels: { type: 'Тип: ' + type + ' ×' + this.max },
      ammo: { n: S.ammo, max: this.max, big: S.type !== 'gmlrs' },
    };
  }

  // Без анімації: усе, що рухається, доходить до кінця за один виклик (чергу пусків скасовано: ракети без польоту не потрібні).
  settle() {
    const S = this.S;
    S.queue = 0;
    for (let i = 0; i < 900; i++) {
      this.step(.05);
      if (S.reload === 0 && S.deploy === (S.phase === 'position' ? 1 : 0) && Math.abs(S.elev - S.tElev) < .05 && Math.abs(S.trav - S.tTrav) < .05) break;
    }
  }

  // Повертає вузли моделі до стану кліпу на початку (їх чекає інший мікшер переглядача).
  dispose() {
    this.releaseAll();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.r.scene);
    for (const { node, p, q, s, v } of this.r.rest) { node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); node.visible = v; }
    for (const pod of this.r.pods) { pod.holes.forEach(h => { h.visible = false; }); pod.bigHole.visible = false; pod.plate.visible = false; }
  }
}
