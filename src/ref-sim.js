// «Інтерактивна модель» довідника для статей без окремого переглядача: модель із ref-viewer.js отримує місцевість
// і сценарій за типом (ref-sim-data.js) — зліт і посадка, висіння й пуск НАР, пуск і політ ракети, скидання бомби,
// марш і залп пускової, постріл снаряда. Модель лишається в центрі сцени, а земля під нею їде: так камера
// завжди бачить модель, а точність координат не падає на довгому шляху. Числа (висоти, швидкості) — умовні одиниці
// сцени, а не ТТХ: сценарій показує, що модель робить, а не моделює фізику конкретного зразка.
import {
  AdditiveBlending, CircleGeometry, DoubleSide, Fog, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, RepeatWrapping, RingGeometry, Sprite, SpriteMaterial, Vector3,
} from 'three';
import { terrainOf } from './ref-sim-data.js';
import { D2R, Fx, canvasTexture, clamp, ease, groundTexture } from './ref-fx.js';
import { SPINS } from './ref-rig-data.js';
import { blurTexture, buildSpinRig } from './ref-spin.js';

const TILE = 48, TILES = 7;
const FOG = '#141c21';

// Диск несного гвинта в русі: прозорий центр, слід лопатей і світліший обід.
function rotorTexture() {
  return canvasTexture(256, 256, (x) => {
    const c = 128;
    const g = x.createRadialGradient(c, c, 8, c, c, c);
    g.addColorStop(0, 'rgba(30,30,30,0)'); g.addColorStop(.25, 'rgba(30,30,30,.12)'); g.addColorStop(.9, 'rgba(40,40,40,.22)'); g.addColorStop(.97, 'rgba(200,200,200,.35)'); g.addColorStop(1, 'rgba(200,200,200,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      x.beginPath(); x.moveTo(c, c); x.arc(c, c, c, a, a + .32); x.closePath();
      x.fillStyle = 'rgba(15,15,15,.22)'; x.fill();
    }
  });
}

// Диски несних гвинтів. Маточина — найвища точка моделі поза хвостовою третиною (там кіль і хвостовий гвинт),
// радіус — найдальша від неї точка лопатей перед маточиною (нижче лопатей спереду лише кабіна).
// Гвинти моделей не відокремлені від корпусу, тож обертання показує напівпрозорий диск над нерухомими лопатями.
export function rotorPlan(points, size, { coax = 0, min = null } = {}) {
  let lo = Infinity;
  for (let i = 0; i < points.length; i += 3) lo = Math.min(lo, points[i]);
  const rear = (min ? min.x : lo) + size.x * .3;
  let top = -Infinity, hub = [0, 0];
  for (let i = 0; i < points.length; i += 3) if (points[i] > rear && points[i + 1] > top) { top = points[i + 1]; hub = [points[i], points[i + 2]]; }
  const band = top - size.y * .22;
  let r = 0;
  for (let i = 0; i < points.length; i += 3) if (points[i + 1] > band && points[i] >= hub[0]) r = Math.max(r, Math.hypot(points[i] - hub[0], points[i + 2] - hub[1]));
  r = clamp(r, size.x * .2, size.x * .6);
  const discs = [{ x: hub[0], z: hub[1], y: top - size.y * .02, r }];
  if (coax) discs.push({ x: hub[0], z: hub[1], y: top - size.y * coax, r });
  return discs;
}

function modelPoints(group) {
  const out = [], v = new Vector3();
  group.traverse(o => {
    if (!o.isMesh || o.userData.decal) return;
    const pos = o.geometry.attributes.position;
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); }
  });
  return out;
}

export class Sim {
  // viewer — RefViewer з уже показаною моделлю; cfg — simOf(entry).
  constructor(viewer, cfg) {
    this.v = viewer; this.cfg = cfg; this.kind = cfg.kind;
    const e = viewer.entry, g = viewer.group;
    this.e = e; this.L = e.size.x; this.groundY = e.min.y;
    this.world = new Group();
    this.world.name = 'sim-world';
    viewer.scene.add(this.world);
    const tex = groundTexture(terrainOf(this.kind));
    tex.wrapS = tex.wrapT = RepeatWrapping; tex.repeat.set(TILES, TILES);
    tex.anisotropy = Math.min(8, viewer.renderer.capabilities.getMaxAnisotropy());
    this.ground = new Mesh(new PlaneGeometry(TILE * TILES, TILE * TILES), new MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = this.groundY; this.ground.receiveShadow = true;
    this.world.add(this.ground);
    this.marks = new Group(); this.world.add(this.marks);
    this.fx = new Fx(this.world);
    this.shots = [];
    this.shotMat = new SpriteMaterial({ map: this.fx.tex, color: '#ffd68a', transparent: true, depthWrite: false, blending: AdditiveBlending });
    const sc = viewer.scene, cam = viewer.camera;
    this.saved = { fog: sc.fog, fov: cam.fov, floor: viewer.stage.floor.visible, target: viewer.target.clone() };
    sc.fog = new Fog(FOG, 26, 150);
    cam.fov = 34; cam.far = 260; cam.updateProjectionMatrix();
    viewer.stage.floor.visible = false;
    this.focusY = viewer.target.y;
    // Гвинти й колеса, вирізані з мешів моделі, крутяться по-справжньому (ref-spin.js). Лише коли їх немає, вертоліт отримує запасні
    // прозорі диски: їх будуємо в координатах моделі в стандартній позі.
    this.rotors = [];
    this.spin = this.kind === 'heli' || this.kind === 'plane' ? this.buildSpin() : null;
    if (this.kind === 'heli' && !this.spin) {
      g.rotation.set(0, 0, 0); g.position.set(0, 0, 0); g.updateMatrixWorld(true);
      const plan = rotorPlan(modelPoints(g), e.size, { ...(cfg.rotor || {}), min: e.min });
      this.rotorTex = rotorTexture();
      const k = g.scale.x;
      plan.forEach((d, i) => {
        const disc = new Mesh(new CircleGeometry(d.r / k, 72), new MeshBasicMaterial({ map: this.rotorTex, transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 }));
        disc.rotation.x = -Math.PI / 2;
        const pivot = new Group();
        pivot.position.set(d.x / k, d.y / k, d.z / k);
        pivot.add(disc);
        pivot.userData.decal = true; disc.userData.decal = true; pivot.userData.dir = i ? -1 : 1;
        g.add(pivot);
        this.rotors.push(pivot);
      });
    }
    this.S = { travel: 0, alt: 0, speed: 0, vs: 0, vx: 0, vy: 0, pitch: 0, gamma: 0, roll: 0, rpm: 0, air: false, alive: true, flying: false, t: 0, spin: 0, fired: 0, fireT: 0, td: 0 };
    this.phase = '';
    this.set(cfg.phases[0][0]);
  }

  get phases() { return this.cfg.phases; }

  // Вузли, що крутяться, будуються один раз на модель і лишаються в її записі (так само, як колеса й кран у рушії техніки).
  // Немає заявки в SPINS чи вирізання не вдалося — повертає null, і модель просто без них.
  buildSpin() {
    const e = this.e, spec = this.cfg.file && SPINS[this.cfg.file];
    if (!spec || !e.scene) return null;
    const parts = e.parts || (e.parts = {}), key = 'spin:' + this.cfg.file;
    if (!(key in parts)) {
      try { parts[key] = buildSpinRig(e.scene, spec); } catch (err) { console.warn('Довідник: гвинти й колеса недоступні', err); parts[key] = null; }
      e.meshes = null; // нові меші потрапляють до перевірки видимості позначок
    }
    const rig = parts[key];
    if (rig) { this.blurTex = blurTexture(); rig.addBlur(this.blurTex); }
    return rig;
  }

  // У сценарії камера стоїть далі, ніж в огляді: видно слід, землю й ціль, а не лише модель.
  get distance() { return { plane: 1.7, heli: 1.6, launcher: 1.45, vehicle: 1.35 }[this.kind] || 2.1; }

  // ---------- фази ----------
  set(id) {
    this.phase = id;
    const S = this.S;
    S.t = 0; S.fired = 0; S.fireT = 0; S.td = 0;
    this.clearMarks();
    const enter = this['enter_' + this.kind];
    if (enter) enter.call(this, id, S);
    this.v.group.visible = S.alive;
    if (!this.v.motion) this.settle();
    this.v.pose();
  }

  clearMarks() {
    for (const m of [...this.marks.children]) { this.marks.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.target = null;
  }

  onGround() { const S = this.S; S.air = false; S.alt = 0; S.vs = 0; S.pitch = 0; S.roll = 0; }
  revive() { this.S.alive = true; this.v.group.visible = true; }

  enter_plane(id, S) {
    if (id === 'park' || id === 'taxi' || id === 'takeoff') { if (S.air) { this.onGround(); S.speed = 0; } if (id !== 'taxi' && id !== 'takeoff') S.speed = 0; }
    if ((id === 'cruise' || id === 'land') && !S.air) { S.air = true; S.alt = 8; S.speed = Math.max(S.speed, 30); S.pitch = 2 * D2R; S.rpm = Math.max(S.rpm, .7); }
  }

  enter_heli(id, S) {
    if ((id === 'park' || id === 'start') && S.air) { this.onGround(); S.speed = 0; }
    if ((id === 'hover' || id === 'cruise' || id === 'attack') && S.rpm < .6) S.rpm = .6;
    if (id === 'land' && !S.air) S.td = 9;
  }

  // Ракети, бомби, снаряди. ready — повернення до вихідного стану; інші фази, вибрані «з місця», починаються в повітрі.
  enter_projectile(id, S, start) {
    if (id === 'ready' || !S.alive || id === this.cfg.phases[1][0]) {
      this.revive();
      Object.assign(S, { alt: start.alt, speed: 0, gamma: start.gamma, pitch: start.gamma, vx: 0, vy: 0, flying: false, roll: 0 });
      this.v.open = start.open ?? 1;
    }
  }

  flyFrom(S, alt, speed, gamma) {
    if (S.flying) return;
    this.revive();
    Object.assign(S, { alt, speed, gamma, pitch: gamma, flying: true, vx: speed * Math.cos(gamma), vy: speed * Math.sin(gamma) });
  }

  enter_cruise(id, S) {
    const air = !!this.cfg.air;
    this.enter_projectile(id, S, { alt: air ? 8 : .6, gamma: air ? 0 : 14 * D2R });
    if (id === 'launch') { S.flying = true; S.speed = air ? 24 : 4; }
    if (id === 'cruise') this.flyFrom(S, 2.4, 24, 0);
    if (id === 'strike') this.flyFrom(S, 2.4, 24, 0);
  }

  enter_ballistic(id, S) {
    this.enter_projectile(id, S, { alt: .8, gamma: 60 * D2R });
    if (id === 'launch') { S.flying = true; S.speed = 3; }
    if (id === 'cruise') this.flyFrom(S, 20, 40, 15 * D2R);
    if (id === 'strike') this.flyFrom(S, 24, 42, -15 * D2R);
  }

  enter_aam(id, S) {
    this.enter_projectile(id, S, { alt: 8, gamma: 0 });
    if (id === 'launch') { S.flying = true; S.speed = 26; }
    if (id === 'cruise' || id === 'strike') this.flyFrom(S, 8, 55, 0);
    if (id === 'strike') this.target = { x: S.travel + 55 * 2.2, y: S.alt + 1.5, air: true, mesh: this.mark('air', S.travel + 55 * 2.2, S.alt + 1.5) };
  }

  enter_asm(id, S) {
    this.enter_projectile(id, S, { alt: 8, gamma: 0 });
    if (id === 'launch') { S.flying = true; S.speed = 26; }
    if (id === 'cruise' || id === 'strike') this.flyFrom(S, 7, 42, -2 * D2R);
    if (id === 'strike') { const tx = S.travel + S.alt / Math.tan(32 * D2R) + 6; this.target = { x: tx, y: 0, mesh: this.mark('ground', tx) }; }
  }

  enter_bomb(id, S) {
    const winged = this.v.winged;
    this.enter_projectile(id, S, { alt: 10, gamma: 0, open: winged ? 0 : 1 });
    if (id === 'drop') { S.flying = true; S.speed = 24; S.gamma = 0; }
    if (id === 'glide' || id === 'strike') { this.flyFrom(S, 9, 23, -7 * D2R); this.v.open = 1; }
    if (id === 'strike') { const tx = S.travel + S.alt / Math.tan(40 * D2R); this.target = { x: tx, y: 0, mesh: this.mark('ground', tx) }; }
  }

  enter_rocket(id, S) {
    this.enter_projectile(id, S, { alt: 5, gamma: -6 * D2R });
    if (id === 'launch') { S.flying = true; S.speed = 12; this.flash(S.travel + this.e.min.x, S.alt, 0); }
    if (id === 'strike') this.flyFrom(S, 3, 50, -12 * D2R);
  }

  enter_shell(id, S) {
    const angle = (this.cfg.angle || 45) * D2R;
    this.enter_projectile(id, S, { alt: .5, gamma: angle });
    if (id === 'fire') {
      const v0 = this.cfg.angle >= 65 ? 20 : 30;
      Object.assign(S, { flying: true, vx: v0 * Math.cos(angle), vy: v0 * Math.sin(angle) });
      this.flash(S.travel + Math.cos(angle) * this.e.min.x, S.alt + Math.sin(angle) * this.e.min.x, 0, 1.2);
    }
    if (id === 'strike' && !S.flying) { this.revive(); Object.assign(S, { flying: true, alt: 9, vx: 16, vy: -12, gamma: -37 * D2R, pitch: -37 * D2R }); }
  }

  enter_launcher(id, S) { if (id === 'fire') S.fireT = 0; }
  enter_vehicle() {}

  // Мітка цілі: червоне коло на землі або маркер повітряної цілі.
  mark(type, x, y = 0) {
    let m;
    if (type === 'ground') {
      m = new Mesh(new RingGeometry(.9, 1.15, 48), new MeshBasicMaterial({ color: '#e0473b', transparent: true, opacity: .85, depthWrite: false, side: DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, this.groundY + .03, 0);
    } else {
      m = new Mesh(new RingGeometry(.35, .45, 32), new MeshBasicMaterial({ color: '#e0473b', transparent: true, opacity: .9, depthWrite: false, side: DoubleSide }));
      m.position.set(x, y, 0);
    }
    this.marks.add(m);
    return m;
  }

  // ---------- кадр ----------
  step(dt) {
    dt = Math.min(dt, .05);
    const S = this.S;
    S.t += dt;
    this['step_' + this.kind](dt, S);
    if (this.spin) this.spin.step(dt, { rpm: S.rpm, ground: S.speed, air: S.air, scale: this.e.k });
    for (const r of this.rotors) {
      r.rotation.y += S.rpm * dt * 28 * r.userData.dir;
      r.children[0].material.opacity = clamp(S.rpm * 1.1, 0, .9);
    }
    this.stepShots(dt);
    this.fx.step(dt);
  }

  // Без анімації (prefers-reduced-motion): фазу прокручуємо наперед і показуємо підсумкову позу. Якщо модель за цей час
  // вибухнула б, лишаємо останню позу перед ціллю.
  settle() {
    this.fx.quiet = true;
    let last = null;
    for (let i = 0; i < 240; i++) {
      last = { ...this.S };
      this.step(.05);
      if (!this.S.alive) { Object.assign(this.S, last); this.revive(); break; }
    }
    for (const s of this.shots) this.world.remove(s.sprite);
    this.shots = [];
    this.fx.quiet = false; this.fx.clear();
  }

  // Висота хвоста й носа: звідси йде слід двигуна.
  tail(S, k = 1) {
    const dx = this.e.min.x * k;
    return [S.travel + Math.cos(S.pitch) * dx, S.alt + Math.sin(S.pitch) * dx];
  }

  trail(S, dt, { smoke = '#d8d8d4', size = .35, flame = true, life = 2.4, rate = .02 } = {}) {
    S.spin = (S.spin || 0) + dt;
    while (S.spin > rate) {
      S.spin -= rate;
      const [x, y] = this.tail(S, 1.02), j = () => (Math.random() - .5) * .08;
      this.fx.puff(x + j(), y + j(), j(), { color: smoke, size, grow: 2.4, life, op: .5 });
      if (flame) this.fx.puff(x, y, 0, { color: '#ffc46b', size: size * .9, grow: -.4, life: .12, op: .95, add: true });
    }
  }

  flash(x, y, z, k = 1) {
    this.fx.puff(x, y, z, { color: '#ffb54a', size: .9 * k, grow: 1.6, life: .3, op: 1, add: true });
    for (let i = 0; i < 5; i++) this.fx.puff(x, y, z, { color: '#9a9a96', size: .5 * k, grow: 2, life: 1.6, op: .5, vx: (Math.random() - .5) * 1.2, vy: Math.random() * .8 });
  }

  boom(x, y, z = 0, k = 1) {
    const f = this.fx;
    f.puff(x, y + .3 * k, z, { color: '#ffd28a', size: 1.2 * k, grow: 1.8, life: .25, op: 1, add: true });
    f.puff(x, y + .5 * k, z, { color: '#ff8a2a', size: 1.6 * k, grow: 1.4, life: .55, op: .95, add: true });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random();
      f.puff(x + Math.cos(a) * .3 * k, y + .2 * k, z + Math.sin(a) * .3 * k,
        { color: i % 3 ? '#3d3833' : '#7d6f57', size: (.7 + s * .6) * k, grow: 2.2, life: 2.6 + s * 1.6, op: .75, vx: Math.cos(a) * 1.6 * k * s, vz: Math.sin(a) * 1.6 * k * s, vy: (.4 + Math.random() * 1.6) * k });
    }
    if (y <= this.groundY + .5) {
      const m = new Mesh(new CircleGeometry(1.3 * k, 32), new MeshBasicMaterial({ map: this.fx.tex, color: '#000000', transparent: true, opacity: .8, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, this.groundY + .02, z);
      this.marks.add(m);
    }
  }

  // Удар об землю або ціль: модель зникає, лишається вибух.
  hit(S, k = 1.4) {
    S.alive = false; S.flying = false; S.speed = 0;
    this.v.group.visible = false;
    const y = this.target && this.target.air ? this.target.y : this.groundY;
    this.boom(S.travel, y, 0, k);
    if (this.target && this.target.mesh) this.target.mesh.visible = false;
  }

  // Політ за кутом траєкторії gamma: модель дивиться вздовж швидкості.
  fly(S, dt) {
    S.travel += S.speed * Math.cos(S.gamma) * dt;
    S.alt += S.speed * Math.sin(S.gamma) * dt;
    S.pitch = S.gamma;
    if (S.alt <= 0 && S.alive) { S.alt = 0; this.hit(S, this.kind === 'ballistic' ? 2 : 1.4); }
  }

  steerTo(S, dt, maxDown = -80 * D2R) {
    if (!this.target) return;
    const tx = this.target.x, ty = this.target.air ? this.target.y : -.2;
    const want = clamp(Math.atan2(ty - S.alt, Math.max(tx - S.travel, .5)), maxDown, 40 * D2R);
    S.gamma = ease(S.gamma, want, 2.4, dt);
    if (this.target.air && Math.hypot(tx - S.travel, ty - S.alt) < 1.4 && S.alive) this.hit(S, 1.1);
  }

  step_plane(dt, S) {
    const p = this.phase, heavy = this.cfg.size === 'heavy';
    // Оберти двигунів (крутять повітряні гвинти): на стоянці вимкнено, на рулінні малий газ, на зльоті повний, на посадці
    // знижуються, а коли літак зупинився, двигуни глушать.
    let rpmT = .35;
    if (p === 'park') rpmT = 0;
    if (p === 'takeoff') rpmT = 1;
    if (p === 'cruise') rpmT = .85;
    if (p === 'land') rpmT = S.air ? .6 : S.td > 3 && S.speed < .5 ? 0 : .35;
    S.rpm = ease(S.rpm, rpmT, rpmT > S.rpm ? .8 : .45, dt);
    if (p === 'park') S.speed = ease(S.speed, 0, 1.5, dt);
    if (p === 'taxi') S.speed = ease(S.speed, 3, .6, dt);
    if (p === 'takeoff') {
      if (!S.air) {
        S.speed += (heavy ? 4.5 : 6.5) * dt;
        if (S.speed > 21) S.pitch = ease(S.pitch, 9 * D2R, 1.2, dt);
        if (S.speed > 25) S.air = true;
      } else {
        S.speed = ease(S.speed, 32, .3, dt);
        S.vs = ease(S.vs, S.alt < 8 ? 3.2 : 0, .9, dt);
        S.alt += S.vs * dt;
        S.pitch = ease(S.pitch, S.alt < 7 ? 10 * D2R : 2 * D2R, .8, dt);
      }
    }
    if (p === 'cruise') {
      S.speed = ease(S.speed, 32, .4, dt);
      S.vs = clamp((8 - S.alt) * .6, -3, 3); S.alt += S.vs * dt;
      S.pitch = ease(S.pitch, Math.atan2(S.vs, S.speed) + 2 * D2R, 1, dt);
      S.roll = Math.sin(S.t * .35) * 6 * D2R;
    }
    if (p === 'land') {
      S.roll = ease(S.roll, 0, 1.5, dt);
      if (S.air) {
        S.speed = ease(S.speed, 22, .35, dt);
        if (S.alt > 1.1) { S.vs = ease(S.vs, -clamp(S.alt * .22, .9, 3), 1, dt); S.pitch = ease(S.pitch, 2 * D2R, 1, dt); }
        else { S.vs = ease(S.vs, -.35, 2, dt); S.pitch = ease(S.pitch, 7 * D2R, 1.5, dt); }
        S.alt += S.vs * dt;
        if (S.alt <= 0) {
          S.air = false; S.alt = 0; S.vs = 0; S.td = 0;
          for (const z of [-.18, .18]) this.fx.puff(S.travel - this.L * .05, this.groundY + .05, z * this.e.size.z, { color: '#bdbdb8', size: .5, grow: 3, life: 1.6, op: .6 });
        }
      } else {
        S.td += dt;
        if (S.td > .5) S.pitch = ease(S.pitch, 0, 2, dt);
        S.speed = Math.max(0, S.speed - (S.speed > 8 ? 5 : 3) * dt);
      }
    }
    if (p !== 'cruise' && p !== 'land') S.roll = ease(S.roll, 0, 1.5, dt);
    S.travel += S.speed * Math.cos(S.pitch) * dt;
  }

  step_heli(dt, S) {
    const p = this.phase;
    let rpmT = 1, altT = 0, speedT = 0, pitchT = 0;
    if (p === 'park') rpmT = 0;
    if (p === 'hover') altT = 1.6;
    if (p === 'cruise') { altT = 4.5; speedT = 20; pitchT = -9 * D2R; }
    if (p === 'attack') { altT = 3.2; speedT = 9; pitchT = -6 * D2R; }
    if (p === 'land') { altT = 0; pitchT = S.speed > 4 ? 7 * D2R : 0; if (!S.air) { S.td += dt; if (S.td > 2.5) rpmT = 0; } }
    S.rpm = ease(S.rpm, rpmT, rpmT > S.rpm ? .45 : .35, dt);
    const lift = S.rpm > .85 && p !== 'park' && p !== 'start';
    if (lift || S.air) {
      S.vs = clamp((altT - S.alt) * .8, -1.6, 1.6);
      if (!lift) S.vs = -1;
      S.alt = Math.max(0, S.alt + S.vs * dt);
      if (S.alt > .02) S.air = true;
      else if (S.air) { S.air = false; S.alt = 0; S.td = 0; }
    }
    S.speed = ease(S.speed, S.air ? speedT : 0, .5, dt);
    S.pitch = ease(S.pitch, S.air ? pitchT : 0, 1.2, dt);
    S.roll = S.air ? Math.sin(S.t * .8) * 1.2 * D2R : ease(S.roll, 0, 2, dt);
    S.travel += S.speed * dt;
    // Пил від потоку гвинта біля землі.
    if (S.rpm > .5 && S.alt < 3.2) {
      S.spin = (S.spin || 0) + dt * S.rpm * (1 - S.alt / 3.2);
      while (S.spin > .05) {
        S.spin -= .05;
        const a = Math.random() * Math.PI * 2, r = this.L * .35;
        this.fx.puff(S.travel + Math.cos(a) * r, this.groundY + .15, Math.sin(a) * r, { color: '#8d8065', size: .7, grow: 2, life: 1.4, op: .35, vx: Math.cos(a) * 3, vz: Math.sin(a) * 3, vy: .2 });
      }
    }
    if (p === 'attack' && S.air && S.alt > 2) {
      S.fireT -= dt;
      if (S.fireT <= 0) {
        S.fireT = 1.8;
        const e = this.e, x0 = e.min.x + e.size.x * .55, y0 = e.min.y + e.size.y * .32;
        for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
          const dir = S.pitch - 3 * D2R;
          this.shoot(S.travel + x0 * Math.cos(S.pitch), S.alt + y0 + x0 * Math.sin(S.pitch), side * e.size.z * .28, Math.cos(dir) * 42 + S.speed, Math.sin(dir) * 42, 0, { delay: i * .12, g: 4, impact: true });
        }
      }
    }
  }

  step_cruise(dt, S) {
    if (!S.flying) return;
    const p = this.phase, air = !!this.cfg.air;
    if (p === 'launch') {
      if (air) {
        if (S.t < 1) S.gamma = ease(S.gamma, -14 * D2R, 2, dt);
        else { S.speed = ease(S.speed, 26, .8, dt); S.gamma = ease(S.gamma, clamp((3 - S.alt) * .06, -.25, .2), 1.2, dt); this.trail(S, dt, { size: .22, life: 1.4 }); }
      } else {
        if (S.t < 2.6) { S.speed = Math.min(24, S.speed + 12 * dt); this.trail(S, dt, { size: .5, smoke: '#e2e0d8', life: 3 }); }
        else { S.gamma = ease(S.gamma, clamp((3 - S.alt) * .06, -.25, .2), 1, dt); S.speed = ease(S.speed, 24, .8, dt); this.trail(S, dt, { size: .2, life: 1.2 }); }
      }
    }
    if (p === 'cruise') { S.gamma = ease(S.gamma, clamp((2.2 - S.alt) * .08, -.2, .2), 1, dt); S.speed = ease(S.speed, 24, .8, dt); this.trail(S, dt, { size: .2, life: 1.2 }); }
    if (p === 'strike') {
      if (S.t < 1.8) S.gamma = ease(S.gamma, 24 * D2R, 2, dt);
      else S.gamma = ease(S.gamma, -42 * D2R, 2.2, dt);
      S.speed = ease(S.speed, 28, .8, dt);
      this.trail(S, dt, { size: .2, life: 1.2 });
    }
    this.fly(S, dt);
  }

  step_ballistic(dt, S) {
    if (!S.flying) return;
    const p = this.phase;
    if (p === 'launch') {
      S.speed = Math.min(42, S.speed + 16 * dt);
      if (S.t > 1.2) S.gamma = ease(S.gamma, 38 * D2R, .4, dt);
      this.trail(S, dt, { size: .5, smoke: '#e6e3da', life: 3.2, rate: .016 });
    }
    if (p === 'cruise') { S.gamma = Math.max(-12 * D2R, S.gamma - 6 * D2R * dt); S.speed = ease(S.speed, 40, .5, dt); }
    if (p === 'strike') { S.gamma = ease(S.gamma, -72 * D2R, 1.1, dt); S.speed = ease(S.speed, 46, .5, dt); }
    this.fly(S, dt);
  }

  step_aam(dt, S) {
    if (!S.flying) return;
    const p = this.phase;
    if (p === 'launch') {
      if (S.t < .4) S.gamma = ease(S.gamma, -7 * D2R, 3, dt);
      else { S.speed = Math.min(56, S.speed + 40 * dt); S.gamma = ease(S.gamma, 2 * D2R, 1.2, dt); this.trail(S, dt, { size: .3, life: 2 }); }
    }
    if (p === 'cruise') { S.gamma = Math.sin(S.t * 1.3) * .08; S.speed = ease(S.speed, 55, .5, dt); this.trail(S, dt, { size: .22, life: 1.6, flame: S.t < 4 }); }
    if (p === 'strike') {
      S.speed = ease(S.speed, 58, .5, dt);
      if (this.target && this.target.mesh) this.target.mesh.lookAt(this.v.camera.position);
      this.steerTo(S, dt);
      this.trail(S, dt, { size: .22, life: 1.6 });
    }
    if (S.alive) this.fly(S, dt);
  }

  step_asm(dt, S) {
    if (!S.flying) return;
    const p = this.phase, loft = this.cfg.loft;
    if (p === 'launch') {
      if (S.t < .4) S.gamma = ease(S.gamma, -6 * D2R, 3, dt);
      else { S.speed = Math.min(44, S.speed + 22 * dt); S.gamma = ease(S.gamma, (loft ? 14 : -2) * D2R, 1, dt); this.trail(S, dt, { size: .32, life: 2.2 }); }
    }
    if (p === 'cruise') { S.gamma = ease(S.gamma, clamp((6 - S.alt) * .05, -.15, .15), 1, dt); S.speed = ease(S.speed, 42, .5, dt); this.trail(S, dt, { size: .22, life: 1.6, flame: false }); }
    if (p === 'strike') { S.speed = ease(S.speed, 44, .5, dt); this.steerTo(S, dt); this.trail(S, dt, { size: .22, life: 1.6, flame: false }); }
    this.fly(S, dt);
  }

  step_bomb(dt, S) {
    if (!S.flying) return;
    const p = this.phase, motor = this.cfg.motor;
    if (p === 'drop') {
      S.gamma = ease(S.gamma, -12 * D2R, .9, dt);
      if (S.t > .9 && this.v.winged) this.v.open = Math.min(1, this.v.open + dt / 1.2);
      if (motor && S.t > 1.6) { S.speed = ease(S.speed, 30, .6, dt); this.trail(S, dt, { size: .25, life: 1.6 }); }
    }
    if (p === 'glide') {
      S.gamma = ease(S.gamma, clamp((1.5 - S.alt) * .02, -9 * D2R, -3 * D2R), 1, dt);
      S.speed = ease(S.speed, motor ? 28 : 22, .5, dt);
      if (motor) this.trail(S, dt, { size: .22, life: 1.4 });
    }
    if (p === 'strike') { S.speed = ease(S.speed, 26, .5, dt); this.steerTo(S, dt); }
    this.fly(S, dt);
  }

  step_rocket(dt, S) {
    if (!S.flying) return;
    if (this.phase === 'launch' || this.phase === 'strike') {
      S.speed = Math.min(55, S.speed + 90 * dt);
      S.gamma = ease(S.gamma, -9 * D2R, .4, dt);
      if (S.t < 1.1 || this.phase === 'strike') this.trail(S, dt, { size: .3, life: 1.8 });
    }
    this.fly(S, dt);
  }

  step_shell(dt, S) {
    if (!S.flying) return;
    const motor = this.cfg.motor && S.t < 1.6 && this.phase === 'fire';
    if (motor) { S.vx += Math.cos(S.gamma) * 22 * dt; S.vy += Math.sin(S.gamma) * 22 * dt; this.trail(S, dt, { size: .35, life: 2 }); }
    const g = this.cfg.glide && S.vy < 0 ? 3 : 9;
    S.vy -= g * dt;
    S.travel += S.vx * dt; S.alt += S.vy * dt;
    S.gamma = Math.atan2(S.vy, S.vx); S.pitch = S.gamma; S.speed = Math.hypot(S.vx, S.vy);
    if (S.alt <= 0 && S.alive) { S.alt = 0; this.hit(S, 1.2); }
  }

  drive(dt, S, speedT, rough) {
    const tracks = this.cfg.tracks;
    S.speed = ease(S.speed, speedT, speedT ? .6 : 1.6, dt);
    const m = S.speed / 4.5, amp = (rough ? 3 : 1) * (tracks ? .5 : 1);
    S.alt = Math.abs(Math.sin(S.t * (rough ? 4 : 9))) * .012 * this.L * m * amp;
    S.pitch = Math.sin(S.t * (rough ? 1.7 : 5.3)) * .006 * m * amp * (rough ? 3 : 1);
    S.roll = Math.sin(S.t * (rough ? 1.3 : 4.1)) * .008 * m * amp * (rough ? 3 : 1);
    S.travel += S.speed * dt;
    if (S.speed > .6) {
      S.spin = (S.spin || 0) + dt * m;
      while (S.spin > .06) {
        S.spin -= .06;
        for (const side of [-1, 1]) this.fx.puff(S.travel + this.e.min.x, this.groundY + .15, side * this.e.size.z * .35, { color: '#8a7c60', size: .45, grow: 2.6, life: 1.8, op: .35, vy: .3, vz: side * .4 });
      }
    }
  }

  step_vehicle(dt, S) { this.drive(dt, S, this.phase === 'march' ? 4.5 : this.phase === 'rough' ? 2 : 0, this.phase === 'rough'); }

  step_launcher(dt, S) {
    const p = this.phase;
    this.drive(dt, S, p === 'march' ? 4.5 : 0, false);
    if (p !== 'fire' || S.speed > .2) return;
    const salvo = this.cfg.salvo || 6;
    S.fireT -= dt;
    if (S.fired < salvo && S.fireT <= 0) {
      S.fireT = salvo === 1 ? 0 : .45;
      const e = this.e, [mx, my] = this.cfg.muzzle || [.2, .8], el = (this.cfg.elev || 50) * D2R;
      const x = S.travel + e.min.x + e.size.x * mx, y = e.min.y + e.size.y * my, z = (S.fired % 2 ? -1 : 1) * e.size.z * (salvo > 1 ? .14 : 0);
      const big = salvo === 1 ? 1.8 : 1;
      const back = this.cfg.back ? -1 : 1;
      this.shoot(x, y, z, back * Math.cos(el) * 24, Math.sin(el) * 24, 0, { g: 0, life: 6, size: big * 1.4, trail: big * 1.5 });
      // Хмара пуску: дим біля пакета й пил, що його струмінь здіймає з землі.
      for (let i = 0; i < 6; i++) this.fx.puff(x, y, z, { color: '#e4e1d8', size: 1.1 * big, grow: 2.6, life: 3.2, op: .6, vx: -back * Math.cos(el) * (2 + Math.random() * 2), vy: -Math.sin(el) * (1 + Math.random()), vz: (Math.random() - .5) * 2 });
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        this.fx.puff(x - back * 1.2, this.groundY + .3, z, { color: '#bfb7a5', size: 1.3 * big, grow: 2.4, life: 3.6, op: .55, vx: Math.cos(a) * 2.4 - back * 1.5, vz: Math.sin(a) * 2.4, vy: .5 });
      }
      this.fx.puff(x, y, z, { color: '#ffb54a', size: 1.2 * big, grow: 1, life: .3, op: 1, add: true });
      S.fired++;
    }
  }

  // Ракети залпу пускової й НАР гелікоптера: світна точка зі слідом.
  shoot(x, y, z, vx, vy, vz, { delay = 0, g = 0, life = 4, impact = false, size = 1, trail = 1 } = {}) {
    if (this.fx.quiet) return;
    const sprite = new Sprite(this.shotMat);
    sprite.scale.setScalar(.35 * size);
    sprite.visible = false;
    this.world.add(sprite);
    this.shots.push({ sprite, pos: new Vector3(x, y, z), vel: new Vector3(vx, vy, vz), t: -delay, life, g, impact, trail, acc: 0 });
  }

  stepShots(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      if (s.t < 0) continue;
      s.sprite.visible = true;
      s.vel.y -= s.g * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.sprite.position.copy(s.pos);
      s.acc += dt;
      while (s.acc > .02) { s.acc -= .02; this.fx.puff(s.pos.x, s.pos.y, s.pos.z, { color: '#e2e0d8', size: .3 * s.trail, grow: 2.6, life: 2.2 * s.trail, op: .55 }); }
      const down = s.impact && s.pos.y <= this.groundY;
      if (down) this.boom(s.pos.x, this.groundY, s.pos.z, .7);
      if (down || s.t > s.life) { this.world.remove(s.sprite); this.shots.splice(i, 1); }
    }
  }

  // ---------- поза й камера ----------
  pose() {
    const g = this.v.group, S = this.S;
    g.rotation.order = 'YZX';
    g.rotation.set(S.roll, 0, S.pitch);
    const lift = !S.air && (this.kind === 'plane' || this.kind === 'heli') ? Math.sin(Math.abs(S.pitch)) * this.L * .28 : 0;
    g.position.set(0, S.alt + lift, 0);
    this.world.position.x = -S.travel;
    this.ground.position.x = Math.round(S.travel / TILE) * TILE;
    return this.focusY + S.alt;
  }

  dispose() {
    const v = this.v, g = v.group;
    for (const r of this.rotors) { g.remove(r); r.children[0].geometry.dispose(); r.children[0].material.dispose(); }
    if (this.rotorTex) this.rotorTex.dispose();
    if (this.spin) this.spin.dispose(); // гвинти й колеса лишаються в моделі, але стають у позу файлу
    if (this.blurTex) this.blurTex.dispose();
    this.clearMarks();
    for (const s of this.shots) this.world.remove(s.sprite);
    this.shots = [];
    this.fx.dispose(); this.shotMat.dispose();
    this.ground.geometry.dispose(); this.ground.material.map.dispose(); this.ground.material.dispose();
    v.scene.remove(this.world);
    v.scene.fog = this.saved.fog;
    v.camera.fov = this.saved.fov; v.camera.far = 80; v.camera.updateProjectionMatrix();
    v.stage.floor.visible = this.saved.floor;
    v.target.copy(this.saved.target);
    g.visible = true;
    g.rotation.order = 'XYZ'; g.rotation.set(0, v.yaw, 0); g.position.set(0, 0, 0);
    v.open = 1;
  }
}
