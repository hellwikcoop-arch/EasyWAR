// Рушій наземної техніки «Інтерактивної моделі» довідника (пускові, колісні й гусеничні машини). Модель стоїть у центрі сцени,
// а під нею їде фотограмметричний ландшафт (ref-terrain.js): корпус лягає на рельєф за висотами під осями, колеса крутяться й
// повертають, гусениці йдуть по колу (ref-gear.js), пускова установка наводиться й заряджається (ref-launchers.js), ракети летять
// і влучають у землю (ref-flight.js). Усе, що рухається, лічиться в метрах: група world масштабована до одиниць сцени й катається
// під моделлю, а початок файлу моделі (земля, вісь машини) лежить у групі ride, яка нахиляється за рельєфом.
// Інтерфейс збігається з Sim (ref-sim.js): phases, distance, set(id), step(dt), pose(), dispose() — переглядач вибирає рушій за
// cfg.machine. Числа швидкостей і часу — з артефактів автора моделей; це демонстрація роботи вузлів, а не ТТХ зразка.
import { CircleGeometry, Color, Fog, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RepeatWrapping, Box3, Vector3 } from 'three';
import { D2R, Fx, clamp, ease, groundTexture, softTexture } from './ref-fx.js';
import { Terrain, groundPose } from './ref-terrain.js';
import { Tracks, buildWheels } from './ref-gear.js';
import { CRANES, LAUNCHERS, TELS, TRACKED, WHEELED, axleGroups } from './ref-rig-data.js';
import { Debris, Flight, ROCKETS, proceduralRocket } from './ref-flight.js';
import { PodLauncher, buildPodRig } from './ref-launchers.js';
import { TelLauncher, buildTelRig } from './ref-tel.js';
import { CraneMachine, buildCraneRig } from './ref-crane.js';
import { STATUS_TEXT } from './ref-sim-data.js';

// Колір туману збігається з фоном сцени: поле тоне в ньому, і край ландшафту не видно. Туман густішає до FOG_FAR метрів: бічні ряди
// плиток закінчуються на 130 м від машини, тож їхній край уже в суцільному тумані. Початок тумана йде за відстанню до камери.
const FOG = '#12171a', FOG_FAR = 118;
const TILE = 24, TILES = 15;

// Моделі ракет залпу: файл у каталозі, ніс у +X, метри. Поки файл не завантажено (чи без анімації), летить проста процедурна ракета.
const ROCKET_FILES = { gmlrs: 'gmlrs-m31', atacms: 'mgm-140-atacms' };
const ROCKET_STUBS = { gmlrs: { length: 3.95, radius: .114 }, atacms: { length: 3.97, radius: .305 } };
const rocketLoads = new Map();

// Камера стежить за ракетою в польоті: перемикач працює на рівні машини, тож однаково для всіх пускових.
const FOLLOW = { id: 'follow', label: 'Стежити за ракетою', key: 'C', code: 'KeyC', row: 'weapon' };

// Ракета з моделі: ніс у +X, центр у нулі, метри файлу.
export function rocketTemplate(scene) {
  const inner = new Group(), g = new Group();
  inner.add(scene);
  inner.updateMatrixWorld(true);
  const c = new Box3().setFromObject(inner).getCenter(new Vector3());
  inner.position.set(-c.x, -c.y, -c.z);
  g.add(inner);
  return g;
}

// Рушії вузлів: що саме рухається на машині. Кожен повертає об’єкт зі стандартним інтерфейсом (controls, enter, press, setHold, step,
// status, ui, settle, dispose) або null, якщо потрібних вузлів у моделі немає — тоді машина лише їздить.
export const RIGS = {
  pods(m, cfg) {
    const spec = LAUNCHERS[cfg.spec];
    if (!spec) return null;
    const rig = m.part('pods:' + cfg.spec, () => buildPodRig(m.scene, spec, m.clip));
    return rig ? new PodLauncher(rig, m.ctx) : null;
  },
  // Колісна пускова з піднімним пакетом без власного кліпу (Вільха, Сапсан): опори, гідроциліндри, кришки труб.
  tel(m, cfg) {
    const spec = TELS[cfg.spec];
    if (!spec) return null;
    const rig = m.part('tel:' + cfg.spec, () => buildTelRig(m.scene, spec));
    return rig ? new TelLauncher(rig, m.ctx) : null;
  },
  // Машини забезпечення з краном, сошниками чи відвалом (M984A2, M1084A1P2, Bergepanzer 2, пакетовоз HEMTT).
  crane(m, cfg) {
    const spec = CRANES[cfg.spec];
    if (!spec) return null;
    const rig = m.part('crane:' + cfg.spec, () => buildCraneRig(m.scene, spec));
    return rig ? new CraneMachine(rig, m.ctx) : null;
  },
};

export class Machine {
  // viewer — RefViewer з уже показаною моделлю; cfg — simOf(entry): { kind, phases, rig, spec, wheels | tracked, speed, … }.
  constructor(viewer, cfg) {
    this.v = viewer; this.cfg = cfg; this.kind = cfg.kind; this.phase = '';
    this.rig = null; this.wheels = null; this.tracks = null; this.onState = null;
    try { this.build(); } catch (e) { this.dispose(); throw e; }
  }

  get phases() { return this.cfg.phases; }
  // Піднята й висунута стріла крана відсуває камеру, щоб вона лишалася в кадрі.
  get distance() { return ({ launcher: 1.45, vehicle: 1.35 }[this.kind] || 1.4) * (this.rig && this.rig.zoom ? this.rig.zoom() : 1); }
  // Підказка про клавіші вузлів: [id кнопки, текст]; null — інтерфейс бере стандартний перелік (наведення, пуск, залп, заряджання).
  get hints() { return this.rig && this.rig.hints ? this.rig.hints : null; }
  // Кнопки вузлів плюс перемикач камери, якщо машина стріляє й ракети літають (без анімації їм летіти нікуди).
  get controls() {
    if (!this.rig) return [];
    return this.v.motion && this.rig.canFire ? [...this.rig.controls, FOLLOW] : this.rig.controls;
  }

  build() {
    const v = this.v, e = v.entry, cfg = this.cfg;
    if (!e || !e.scene || !e.k) throw new Error('Для рушія техніки потрібна модель, поставлена у стандартну позу');
    this.e = e; this.k = e.k; this.scene = e.scene; this.clip = (e.clips && e.clips[0]) || null;
    // Деталі, вирізані з мешів моделі (колеса, ланки гусениць, вузли пускової), будуються один раз на модель і лишаються в ній.
    this.parts = e.parts || (e.parts = {});
    const k = this.k;
    this.ride = new Group(); this.ride.name = 'machine-ride';
    v.holder.add(this.ride);
    this.ride.add(v.group);
    this.world = new Group(); this.world.name = 'machine-world';
    this.world.scale.setScalar(k);
    v.scene.add(this.world);
    const sc = v.scene, cam = v.camera;
    this.saved = { fog: sc.fog, background: sc.background, fov: cam.fov, far: cam.far, floor: v.stage.floor.visible, target: v.target.clone() };
    sc.fog = new Fog(FOG, 20, 60);
    sc.background = new Color(FOG);
    cam.fov = 34; cam.far = 260; cam.updateProjectionMatrix();
    v.stage.floor.visible = false;
    const aniso = Math.min(8, v.renderer.capabilities.getMaxAnisotropy());
    // Запасна земля, поки ландшафт не завантажився чи якщо його немає.
    const tex = groundTexture('field');
    tex.wrapS = tex.wrapT = RepeatWrapping; tex.repeat.set(TILES, TILES); tex.anisotropy = aniso;
    this.ground = new Mesh(new PlaneGeometry(TILE * TILES, TILE * TILES), new MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true;
    this.world.add(this.ground);
    this.terrain = new Terrain(this.world, m => v.load(m), { anisotropy: aniso });
    this.terrain.onReady = () => { this.ground.visible = false; if (!v.motion) { this.snap(); v.pose(); } };
    this.fx = new Fx(this.world);
    this.scars = new Group(); this.world.add(this.scars);
    this.scarMat = new MeshBasicMaterial({ map: this.fx.tex, color: '#000000', transparent: true, opacity: .75, depthWrite: false });
    this.flight = new Flight({ parent: this.world, fx: this.fx, ground: (x, z) => this.height(x, z), scar: (x, y, z, r) => this.scar(x, y, z, r) });
    this.flight.onImpact = (rec, dist) => this.toast(dist == null ? 'Ракета вийшла за межі сцени' : 'Розрив на дистанції ' + dist + ' м (масштаб сцени)', 2.5);
    this.debris = new Debris({ parent: this.world, ground: (x, z) => this.height(x, z) });
    this.rockets = {}; this.procs = {}; this.stub = new Group();
    // Тінь-пляма під машиною: справжня тінь від ключового світла падає лише на запасну землю.
    const { size } = e;
    this.blob = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: softTexture(), color: '#000000', transparent: true, opacity: .5, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.scale.set(size.x * 1.08, size.z * 1.25, 1);
    this.blob.position.set(e.center.x * k, .02, e.center.z * k);
    this.blob.userData.decal = true;
    this.ride.add(this.blob);
    // Ходова: колеса колісної машини чи гусениця й катки гусеничної.
    const wheelSpec = cfg.wheels && WHEELED[cfg.wheels], trackSpec = cfg.tracked && TRACKED[cfg.tracked];
    if (trackSpec) this.tracks = this.part('tracks:' + cfg.tracked, () => new Tracks(this.scene, trackSpec));
    else if (wheelSpec) this.wheels = this.part('wheels:' + cfg.wheels, () => buildWheels(this.scene, wheelSpec));
    const L = size.x / k, W = size.z / k;
    this.gait = trackSpec ? { front: trackSpec.front, rear: trackSpec.rear, half: trackSpec.half }
      : wheelSpec ? { ...axleGroups(wheelSpec.axles), half: wheelSpec.z } : { front: L * .3, rear: -L * .3, half: W * .35 };
    this.S = { t: 0, speed: 0, tSpeed: 0, steer: 0, dist: 0, bounce: 0, y: 0, pitch: 0, roll: 0, dust: 0 };
    this.toastText = ''; this.toastT = 0; this.sig = '';
    this.follow = false; this.look = new Vector3(); this.want = new Vector3();
    this.ctx = {
      phase: id => this.set(id), toast: (t, s) => this.toast(t, s), rocket: kind => this.rocketFor(kind),
      launch: (kind, tpl, p, d, opts) => this.launch(kind, tpl, p, d, opts), flying: () => this.flight.busy, muzzleToWorld: (p, d) => this.toWorld(p, d),
      speed: () => this.S.speed, gap: p => this.gapAt(p), shed: (node, v, w) => this.shed(node, v, w),
    };
    const make = cfg.rig && RIGS[cfg.rig];
    if (make) this.rig = this.guard('рушій вузлів', () => make(this, cfg));
    if (this.rig && v.motion) this.loadRockets();
    this.snap();
    this.set(cfg.phases[0][0]);
  }

  // Будує й запам’ятовує в моделі деталь, вирізану з її мешів. Помилка однієї деталі не зупиняє сценарій: машина просто без неї.
  part(key, make) {
    if (!(key in this.parts)) {
      this.parts[key] = this.guard(key, make);
      this.e.meshes = null; // нові меші колес чи ланок мають потрапити до перевірки видимості позначок
    }
    return this.parts[key];
  }

  guard(what, make) {
    try { return make(); } catch (err) { console.warn('Довідник: ' + what + ' недоступні', err); return null; }
  }

  // ---------- ракети ----------
  loadRockets() {
    for (const kind of Object.keys(ROCKET_FILES)) {
      if (!rocketLoads.has(kind)) {
        rocketLoads.set(kind, this.v.load({ file: ROCKET_FILES[kind], nose: '+x' }).then(gltf => rocketTemplate(gltf.scene)).catch(err => { rocketLoads.delete(kind); console.warn('Довідник: модель ракети недоступна', err); return null; }));
      }
      rocketLoads.get(kind).then(tpl => { if (tpl && !this.disposed) this.rockets[kind] = tpl; });
    }
  }

  rocketFor(kind) {
    if (!this.v.motion) return this.stub;
    if (this.rockets[kind]) return this.rockets[kind];
    const pr = ROCKETS[kind];
    if (!pr) return null;
    // Проста модель будується один раз: кожен політ клонує її, не копіюючи геометрію.
    return this.procs[kind] || (this.procs[kind] = proceduralRocket(pr.procedural || ROCKET_STUBS[kind] || { length: 4, radius: .15 }));
  }

  launch(kind, template, p, d, opts) {
    if (!this.v.motion) return;
    this.flight.launch(template, ROCKETS[kind], p, d, opts);
  }

  // Кришка труби злітає: її меші стають уламками світу (метри) з тією самою геометрією й матеріалом, що в моделі.
  shed(node, v, w) {
    if (!this.v.motion || !this.debris) return;
    this.world.updateMatrixWorld(true);
    node.updateWorldMatrix(true, true);
    const inv = new Matrix4().copy(this.world.matrixWorld).invert(), m4 = new Matrix4(), p = new Vector3(), q = new Quaternion(), s = new Vector3();
    node.traverse(o => {
      if (!o.isMesh) return;
      m4.multiplyMatrices(inv, o.matrixWorld).decompose(p, q, s);
      this.debris.add(o.geometry, o.material, p, q, v, w).scale.copy(s);
    });
  }

  // Висота (м) точки файлу моделі над землею під нею: корпус нахилено за рельєфом, тож точку повертає той самий кут (Rx · Rz), що й корпус.
  gapAt(p) {
    const S = this.S, cp = Math.cos(S.pitch), sp = Math.sin(S.pitch), cr = Math.cos(S.roll), sr = Math.sin(S.roll);
    const x = p.x * cp - p.y * sp, y = p.x * sp + p.y * cp;
    return y * cr - p.z * sr + S.y - this.height(S.dist + x, y * sr + p.z * cr);
  }

  // Точка й напрямок із системи сцени в метри світу.
  toWorld(p, d) {
    this.world.updateMatrixWorld(true);
    return { p: this.world.worldToLocal(p.clone()), d: d.clone().normalize() };
  }

  scar(x, y, z, r) {
    const m = new Mesh(new CircleGeometry(Math.max(.8, r), 24), this.scarMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + .08, z);
    this.scars.add(m);
    while (this.scars.children.length > 12) { const old = this.scars.children[0]; this.scars.remove(old); old.geometry.dispose(); }
  }

  // ---------- стан ----------
  toast(text, s = 2) { this.toastText = text; this.toastT = s; }

  height(x, z) { return this.terrain && this.terrain.ready ? this.terrain.heightAt(x, z) : 0; }

  marchSpeed() { return this.rig && this.rig.speedTarget !== undefined ? this.rig.speedTarget : (this.cfg.speed || 12); }

  set(id) {
    if (this.rig && this.rig.busy && id !== 'position') { this.toast('Дочекайтеся кінця заряджання', 1.8); this.report(true); return; }
    this.phase = id;
    this.S.t = 0;
    this.toastT = 0; // підказка попередньої дії (без анімації вона б висіла вічно) не переходить у нову фазу
    if (this.rig) this.rig.enter(id);
    this.S.tSpeed = id === 'march' ? this.marchSpeed() : 0;
    if (!this.v.motion) this.settle();
    this.v.pose();
    this.report(true);
  }

  // Корпус лягає на рельєф: висота й нахил за висотами під осями; ease — плавність (snap — одразу, без неї).
  ride3(dt, snap) {
    const S = this.S, v = S.speed;
    const gp = groundPose((dx, dz) => this.height(S.dist + dx, dz), this.gait);
    S.bounce = v > 1 ? Math.sin(S.dist * 1.7) * .018 + Math.sin(S.dist * 4.3) * .008 : S.bounce * .9;
    const wobble = v > 1 ? Math.sin(S.dist * 1.1) * .007 : 0;
    if (snap) { S.y = gp.y; S.pitch = gp.pitch * .9; S.roll = gp.roll * .9; return; }
    S.y = ease(S.y, gp.y + S.bounce, 6, dt);
    S.pitch = ease(S.pitch, gp.pitch * .9, 6, dt);
    S.roll = ease(S.roll, gp.roll * .9 + wobble, 4, dt);
  }

  snap() {
    this.terrain.place(this.S.dist);
    this.ride3(0, true);
    this.wheelsAt();
  }

  wheelsAt() {
    const S = this.S;
    if (this.wheels) this.wheels.update(S.dist, S.steer * D2R);
    if (this.tracks) this.tracks.update(S.dist);
  }

  step(dt) {
    dt = Math.min(dt, .05);
    const S = this.S;
    S.t += dt; this.toastT -= dt;
    S.tSpeed = this.phase === 'march' ? this.marchSpeed() : 0;
    S.speed = ease(S.speed, S.tSpeed, S.tSpeed > S.speed ? .6 : 1.2, dt);
    if (!S.tSpeed && S.speed < .02) S.speed = 0;
    const v = S.speed;
    S.dist += v * dt;
    S.steer = ease(S.steer, v > 2 && this.wheels ? Math.sin(S.dist * .08) * 6 : 0, 2, dt);
    this.terrain.place(S.dist);
    this.ride3(dt, false);
    this.dust(dt, v);
    if (this.rig) this.rig.step(dt);
    this.flight.step(dt);
    this.debris.step(dt);
    this.fx.step(dt);
    this.followStep(dt);
    this.report(false);
  }

  // Пил з-під задніх коліс і гусениць: тим густіший, чим швидша машина.
  dust(dt, v) {
    if (v < .8) return;
    const S = this.S, g = this.gait;
    S.dust += v * dt;
    while (S.dust > 1.1) {
      S.dust -= 1.1;
      for (const side of [-1, 1]) {
        const x = S.dist + g.rear - .3, z = side * g.half;
        this.fx.puff(x, this.height(x, z) + .2, z, { color: '#8a7c60', size: .9, grow: 2.6, life: 1.8, op: .35, vy: .35, vz: side * .4 });
      }
    }
  }

  // Без анімації: усе, що рухається, доходить до кінця за один виклик.
  settle() {
    const S = this.S;
    this.fx.quiet = true;
    if (this.phase !== 'march') S.speed = 0; // без анімації машина зупиняється одразу, тож вузли не чекають гальмування
    if (this.rig) this.rig.settle();
    S.tSpeed = this.phase === 'march' ? this.marchSpeed() : 0;
    if (this.phase === 'march') { S.dist += 40; S.speed = S.tSpeed; } else S.speed = 0;
    S.steer = 0;
    this.fx.quiet = false; this.fx.clear();
    this.snap();
  }

  // ---------- керування ----------
  press(id) {
    if (!this.rig) return;
    if (id === 'follow') { this.follow = !this.follow; this.report(true); return; }
    this.rig.press(id);
    if (!this.v.motion) { this.rig.settle(); this.v.pose(); }
    this.report(true);
  }

  // Кнопки наведення діють, поки їх тримають; без анімації кожне натискання — один крок.
  hold(id, on) {
    if (!this.rig) return;
    if (!this.v.motion) { if (on && this.rig.nudge) { this.rig.nudge(id); this.v.pose(); this.report(true); } return; }
    this.rig.setHold(id, on);
  }

  releaseAll() { if (this.rig) this.rig.releaseAll(); }

  // Клавіші сцени: цифри — фази, решта — керування вузлами. Повертає true, якщо клавішу прийнято.
  keyDown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const ph = this.phases[+digit[1] - 1];
      if (!ph) return false;
      this.set(ph[0]);
      return true;
    }
    const c = this.controls.find(x => x.code === e.code);
    if (!c) return false;
    if (c.hold) { if (!this.rig.aimOk()) return false; this.hold(c.id, true); } else if (!e.repeat) this.press(c.id);
    return true;
  }

  keyUp(e) {
    const c = this.controls.find(x => x.code === e.code && x.hold);
    if (!c) return false;
    this.hold(c.id, false);
    return true;
  }

  // Рядок стану сцени: підказка дії або стан вузла.
  status() {
    const rig = this.rig;
    if (this.toastT > 0 && !(rig && rig.busy)) return this.toastText;
    const text = (STATUS_TEXT[this.phase] || '').replace('{v}', Math.round(this.S.speed * 3.6));
    return rig ? rig.status(text) : text;
  }

  ui() {
    const base = this.rig ? this.rig.ui() : { locks: {}, on: {}, labels: {}, ammo: null };
    if (this.controls.includes(FOLLOW)) base.on = { ...base.on, follow: this.follow };
    return { ...base, status: this.status(), phase: this.phase, toast: this.toastT > 0 ? this.toastText : null };
  }

  // Повідомляє інтерфейс, коли змінилося щось видиме на кнопках чи в рядку стану.
  report(force) {
    if (!this.onState) return;
    const u = this.ui(), sig = [u.status, u.phase, u.toast, Object.values(u.locks).map(Number).join(''), Object.values(u.on).map(Number).join(''), Object.values(u.labels).join('|'), u.ammo ? u.ammo.n + '/' + u.ammo.max + (u.ammo.big ? 'b' : '') : ''].join('~');
    if (force || sig !== this.sig) { this.sig = sig; this.onState(u); }
  }

  // ---------- поза й камера ----------
  // Висота (одиниці сцени), на яку дивиться камера без стеження: корпус плюс те, що піднімає пускова.
  focusY() { return this.k * (this.S.y + (this.rig && this.rig.focus ? this.rig.focus() : 0)); }

  // Стеження: ціль камери їде до найстарішої ракети в польоті (look — зсув від звичайної цілі); ракет немає — повертається до машини.
  followStep(dt) {
    const r = this.follow ? this.flight.list[0] : null, want = this.want;
    if (r) {
      this.world.updateMatrixWorld(true);
      want.copy(r.m.position).applyMatrix4(this.world.matrixWorld);
      want.y -= this.focusY();
    } else want.set(0, 0, 0);
    this.look.addScaledVector(want.sub(this.look), 1 - Math.exp(-(r ? 4 : 2) * dt));
  }

  pose() {
    const S = this.S, k = this.k, c = this.e.center, g = this.v.group;
    g.rotation.set(0, 0, 0);
    g.position.set(k * c.x, k * c.y, k * c.z);
    this.ride.position.set(-k * c.x, -k * c.y + k * S.y, -k * c.z);
    this.ride.rotation.set(S.roll, 0, S.pitch);
    this.world.position.set(-k * c.x - k * S.dist, -k * c.y, -k * c.z);
    this.wheelsAt();
    this.fogAt(this.v.baseDistance() * this.v.zoom * this.distance);
    // Піднятий пакет тягне погляд камери вгору до середини своєї осі.
    return this.focusY();
  }

  // Туман починається за машиною (d — відстань камери до неї), а густішає до FOG_FAR метрів: далі видно лише колір фону.
  fogAt(d) {
    const fog = this.v.scene.fog;
    if (!fog) return;
    fog.far = FOG_FAR * this.k;
    fog.near = Math.min(fog.far * .6, Math.max(d * 1.9, 3.2 * Math.max(this.e.size.x, this.e.size.z)));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const v = this.v, g = v.group;
    if (this.rig) this.rig.dispose();
    if (this.wheels) this.wheels.reset();
    if (this.tracks) this.tracks.reset();
    if (this.flight) this.flight.dispose();
    if (this.debris) this.debris.dispose();
    for (const g of Object.values(this.procs || {})) g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    if (this.fx) this.fx.dispose();
    if (this.scars) for (const m of [...this.scars.children]) m.geometry.dispose();
    if (this.scarMat) this.scarMat.dispose();
    if (this.terrain) this.terrain.dispose();
    if (this.ground) { this.ground.geometry.dispose(); this.ground.material.map.dispose(); this.ground.material.dispose(); }
    if (this.blob) { this.blob.geometry.dispose(); this.blob.material.map.dispose(); this.blob.material.dispose(); }
    if (this.world) v.scene.remove(this.world);
    if (this.saved) {
      v.scene.fog = this.saved.fog; v.scene.background = this.saved.background;
      v.camera.fov = this.saved.fov; v.camera.far = this.saved.far; v.camera.updateProjectionMatrix();
      v.stage.floor.visible = this.saved.floor;
      v.target.copy(this.saved.target);
    }
    if (this.ride) {
      v.holder.add(g);
      v.holder.remove(this.ride);
    }
    g.visible = true;
    g.rotation.order = 'XYZ'; g.rotation.set(0, v.yaw, 0); g.position.set(0, 0, 0);
    v.open = 1;
  }
}
