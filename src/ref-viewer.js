// Тривимірний переглядач довідника по озброєнню (three.js). Показує або процедурну модель боєприпасу
// (munition-3d.js), або .glb-модель літака з каталогу src/models. Завантажується лише коли вперше відкривають статтю
// з моделлю. Сцена (світло, підлога) спільна з карткою вильоту — stage-3d.js.
import { AnimationMixer, Box3, CanvasTexture, DoubleSide, FrontSide, Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, SRGBColorSpace, Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { addStageEnvironment, createRenderer, FLOOR_Y } from './stage-3d.js';
import { buildModel, spreadLabels } from './munition-3d.js';
import { SHELL_KINDS, buildShell } from './artillery-3d.js';
import { Sim } from './ref-sim.js';

// Файли моделей літаків. Шлях у new URL(...) має бути дослівним, щоб Vite покласти файл у збірку.
export const MODEL_FILES = {
  'ka-52': new URL('./models/ka-52.glb', import.meta.url).href,
  'mi-8tv': new URL('./models/mi-8tv.glb', import.meta.url).href,
  'ka-50': new URL('./models/ka-50.glb', import.meta.url).href,
  'ka-27': new URL('./models/ka-27.glb', import.meta.url).href,
  'mi-26': new URL('./models/mi-26.glb', import.meta.url).href,
  'mi-35': new URL('./models/mi-35.glb', import.meta.url).href,
  'mi-2': new URL('./models/mi-2.glb', import.meta.url).href,
  'an-26': new URL('./models/an-26.glb', import.meta.url).href,
  'an-225': new URL('./models/an-225.glb', import.meta.url).href,
  'fp-5-flamingo': new URL('./models/fp-5-flamingo.glb', import.meta.url).href,
  'fp-7': new URL('./models/fp-7.glb', import.meta.url).href,
  'aim-120': new URL('./models/aim-120.glb', import.meta.url).href,
  'aim-9x': new URL('./models/aim-9x.glb', import.meta.url).href,
  'agm-65': new URL('./models/agm-65.glb', import.meta.url).href,
  'r-27': new URL('./models/r-27.glb', import.meta.url).href,
  'r-77': new URL('./models/r-77.glb', import.meta.url).href,
  'kh-29': new URL('./models/kh-29.glb', import.meta.url).href,
  'kab-500l': new URL('./models/kab-500l.glb', import.meta.url).href,
  'storm-shadow': new URL('./models/storm-shadow.glb', import.meta.url).href,
  'gmlrs-m31': new URL('./models/gmlrs-m31.glb', import.meta.url).href,
  'mgm-140-atacms': new URL('./models/mgm-140-atacms.glb', import.meta.url).href,
  'm142-himars': new URL('./models/m142-himars.glb', import.meta.url).href,
  'm270-mlrs': new URL('./models/m270-mlrs.glb', import.meta.url).href,
  'vilkha': new URL('./models/vilkha.glb', import.meta.url).href,
  'sapsan': new URL('./models/sapsan.glb', import.meta.url).href,
  'm1084a1p2': new URL('./models/m1084a1p2.glb', import.meta.url).href,
  'm984a2': new URL('./models/m984a2.glb', import.meta.url).href,
  'bergepanzer2': new URL('./models/bergepanzer2.glb', import.meta.url).href,
  'hemtt-pod-carrier': new URL('./models/hemtt-pod-carrier.glb', import.meta.url).href,
};

// Куди в файлі дивиться ніс літака: модель повертається так, щоб ніс дивився в +X, як у боєприпасів.
export const NOSE_TURN = { '+x': 0, '-x': Math.PI, '+z': Math.PI / 2, '-z': -Math.PI / 2 };
const AIRCRAFT_LENGTH = 4.6;

export const VIEWS = {
  'three-quarter': { yaw: -0.6, pitch: 0.42 },
  side: { yaw: 0, pitch: 0.06 },
  front: { yaw: -Math.PI / 2, pitch: 0.1 },
  top: { yaw: 0, pitch: 1.5 },
  rear: { yaw: Math.PI / 2, pitch: 0.12 },
};

// Відстань для літака: горизонтальний круг радіуса r (слід моделі) видно як еліпс, тож по висоті кадру він займає
// r·sin(нахил) + піввисота·cos(нахил), а по ширині — r. Поворот моделі навколо вертикалі відстань не міняє.
export function aircraftDistance({ r, hh }, pitch, fovDeg, aspect, margin = 1.18) {
  const tv = Math.tan((fovDeg * Math.PI) / 360), th = tv * aspect;
  return margin * Math.max(r / th, (r * Math.sin(pitch) + hh * Math.cos(pitch)) / tv);
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

let loader = null;
function gltfLoader() {
  if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

// Модель літака береться або з каталогу src/models ({ file }), або з файлу поруч зі сторінкою переглядача
// ({ src: 'aircraft-3d/x.glb' }), або з обгортки aircraft-3d/x.js, де .glb лежить рядком base64 у глобальній змінній
// ({ wrapper: 'aircraft-3d/x.js', global: 'X_GLB' }). Так позначки «слабких місць» працюють на тих самих файлах,
// що й інтерактивний переглядач, без другої копії моделі.
export const modelKey = model => model.file || model.src || model.wrapper || '';

const wrapperLoads = new Map();
function loadWrapper(model) {
  if (typeof window[model.global] === 'string') return Promise.resolve(window[model.global]);
  if (!wrapperLoads.has(model.wrapper)) {
    wrapperLoads.set(model.wrapper, new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = new URL(model.wrapper, document.baseURI).href;
      sc.onload = () => (typeof window[model.global] === 'string' ? resolve(window[model.global]) : reject(new Error('Немає даних моделі: ' + model.global)));
      sc.onerror = () => { wrapperLoads.delete(model.wrapper); reject(new Error('Не завантажилась модель: ' + model.wrapper)); };
      document.head.append(sc);
    }));
  }
  return wrapperLoads.get(model.wrapper);
}

export async function loadGltf(model, onProgress) {
  if (model.wrapper) {
    const bin = atob(await loadWrapper(model)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return gltfLoader().parseAsync(bytes.buffer, '');
  }
  const url = model.file ? MODEL_FILES[model.file] : new URL(model.src, document.baseURI).href;
  if (!url) throw new Error('Невідомий файл моделі: ' + model.file);
  return gltfLoader().loadAsync(url, e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); });
}

// Кліп анімації з .glb (наприклад, заряджання M270), який прокручують повзунком. Заодно для кожної частки кліпу
// рахує, скільки місця займає модель: камера відходить, коли частини виїжджають далеко від корпусу.
const ACTION_SAMPLES = 48;
function prepareAction(gltf, entry) {
  const clip = gltf.animations && gltf.animations[0];
  if (!clip || !clip.duration) return null;
  const mixer = new AnimationMixer(gltf.scene);
  const act = mixer.clipAction(clip);
  act.play(); act.paused = true;
  const seek = v => { act.time = clamp(v, 0, 1) * clip.duration; mixer.update(0); };
  const root = entry.group, box = new Box3(), base = { r: Math.hypot(entry.size.x, entry.size.z) / 2, hh: entry.size.y / 2 };
  const reach = [];
  for (let i = 0; i <= ACTION_SAMPLES; i++) {
    seek(i / ACTION_SAMPLES);
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    const x = Math.max(-box.min.x, box.max.x), z = Math.max(-box.min.z, box.max.z), y = Math.max(-box.min.y, box.max.y);
    reach.push({ r: Math.max(base.r, Math.hypot(x, z)), hh: Math.max(base.hh, y) });
  }
  seek(0);
  root.updateMatrixWorld(true);
  return { seek, reach };
}

// Ставить модель з .glb у стандартну позу: ніс у +X, центр у нулі, задана довжина (літак — AIRCRAFT_LENGTH, боєприпас — 4).
export function normalizeAircraft(scene, nose = '+x', length = AIRCRAFT_LENGTH) {
  const inner = new Group();
  inner.add(scene);
  inner.rotation.y = NOSE_TURN[nose] ?? 0;
  inner.updateMatrixWorld(true);
  const box = new Box3().setFromObject(inner), size = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
  const k = length / size.x;
  const root = new Group();
  root.add(inner);
  inner.position.set(-c.x, -c.y, -c.z);
  root.scale.setScalar(k);
  root.updateMatrixWorld(true);
  const fit = new Box3().setFromObject(root);
  return { group: root, size: fit.getSize(new Vector3()), min: fit.min.clone() };
}

// Моделі зі збірок мають прозорі матеріали, які без правки дають артефакти сортування: «скло» (назва матеріалу
// збігається з regexp glass) лишається напівпрозорим, решта прозорих матеріалів стає непрозорою з відсічкою за альфою.
// opaque — без відсічки (усі пікселі видно). Усі матеріали двосторонні, щоб тонкі деталі не зникали з тильного боку.
export function fixMaterials(scene, { glass, opaque = false }) {
  const isGlass = new RegExp(glass, 'i');
  scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (m.transparent && !isGlass.test(m.name || '')) { m.transparent = false; m.alphaTest = opaque ? 0 : .5; m.depthWrite = true; }
      if (m.name && isGlass.test(m.name)) { m.transparent = true; m.depthWrite = false; m.opacity = Math.min(m.opacity, .55); }
      m.side = DoubleSide;
      m.needsUpdate = true;
    }
  });
}

// Опорні точки позначок «уразливих місць» у координатах моделі, поставленої в стандартну позу (ніс у +X, поворот 0).
// p = [fx, fy] — частки довжини (хвіст → ніс) і висоти (низ → верх): промінь іде збоку (з +Z) і бере першу точку обшивки;
// p = [fx, 0, fz] — частки довжини й розмаху: промінь іде зверху, для крил та інших тонких горизонтальних частин.
export function spotAnchors(aircraft, points, rc = new Raycaster()) {
  const g = aircraft.group, prev = g.rotation.y;
  g.rotation.y = 0;
  g.updateMatrixWorld(true);
  if (!aircraft.meshes) { aircraft.meshes = []; g.traverse(o => { if (o.isMesh && !o.userData.decal) aircraft.meshes.push(o); }); }
  const lo = aircraft.min, hi = lo.clone().add(aircraft.size);
  const out = points.map(p => {
    const x = lo.x + (hi.x - lo.x) * p[0];
    if (p.length === 3) {
      const z = lo.z + (hi.z - lo.z) * p[2];
      rc.set(new Vector3(x, hi.y + 1, z), new Vector3(0, -1, 0));
      rc.far = hi.y - lo.y + 2;
      const hit = rc.intersectObjects(aircraft.meshes, false)[0];
      return hit ? hit.point.clone() : new Vector3(x, lo.y + (hi.y - lo.y) * .6, z);
    }
    const y = lo.y + (hi.y - lo.y) * p[1];
    rc.set(new Vector3(x, y, hi.z + 1), new Vector3(0, 0, -1));
    rc.far = hi.z - lo.z + 2;
    const hit = rc.intersectObjects(aircraft.meshes, false)[0];
    return hit ? hit.point.clone() : new Vector3(x, y, 0);
  });
  g.rotation.y = prev;
  g.updateMatrixWorld(true);
  return out;
}

const Y_AXIS = new Vector3(0, 1, 0);

// Знаки на моделі (зірка, прапор, напис) без правки її текстур: пласкі наклейки лягають на обшивку за променем збоку.
// decal = { kind: 'star' | 'flag' | 'text', text, color, p: [fx, fy], w, side }: p — частки довжини (хвіст → ніс) і висоти
// (низ → верх), як у позначок уразливих місць; w — ширина в частках довжини; side — 'both' (за замовчуванням), 'port' чи 'starboard'.
export const DECAL_KINDS = ['star', 'flag', 'text'];

function drawStar(ctx, size) {
  const c = size / 2, pts = (ro, ri) => Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / 5; return [c + r * Math.cos(a), c + r * Math.sin(a)]; });
  const path = list => { ctx.beginPath(); list.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  path(pts(c * .98, c * .43)); ctx.fillStyle = '#ececE8'; ctx.fill();
  path(pts(c * .86, c * .36)); ctx.fillStyle = '#c41c24'; ctx.fill();
}

// Малює наклейку на полотні й повертає { texture, aspect } (висота / ширина). Полотно потрібне лише в браузері.
export function decalArt(decal) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  let aspect = 1;
  if (decal.kind === 'star') { canvas.width = canvas.height = 256; drawStar(ctx, 256); }
  else if (decal.kind === 'flag') {
    canvas.width = 384; canvas.height = 256; aspect = 2 / 3;
    ctx.fillStyle = '#0057b7'; ctx.fillRect(0, 0, 384, 128); ctx.fillStyle = '#ffd700'; ctx.fillRect(0, 128, 384, 128);
  } else {
    const text = decal.text || '', font = 'bold 120px "Segoe UI", Arial, sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.width = w; canvas.height = 160; aspect = 160 / w;
    ctx.font = font; ctx.textBaseline = 'middle'; ctx.fillStyle = decal.color || '#1d1d1d';
    ctx.fillText(text, 12, 84);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return { texture, aspect };
}

// Кладе наклейки на обшивку літака в стандартній позі (ніс у +X). art(decal) — малює вміст (у тестах підміняється).
export function applyDecals(aircraft, decals, art = decalArt, rc = new Raycaster()) {
  const g = aircraft.group, prev = g.rotation.y;
  g.rotation.y = 0;
  g.updateMatrixWorld(true);
  if (!aircraft.meshes) { aircraft.meshes = []; g.traverse(o => { if (o.isMesh && !o.userData.decal) aircraft.meshes.push(o); }); }
  const lo = aircraft.min, hi = lo.clone().add(aircraft.size), length = aircraft.size.x, placed = [];
  for (const d of decals) {
    const x = lo.x + length * d.p[0], y = lo.y + (hi.y - lo.y) * d.p[1];
    const sides = d.side === 'port' ? [-1] : d.side === 'starboard' ? [1] : [1, -1];
    let drawn = null;
    for (const side of sides) {
      rc.set(new Vector3(x, y, side > 0 ? hi.z + 1 : lo.z - 1), new Vector3(0, 0, -side));
      rc.far = hi.z - lo.z + 2;
      const hit = rc.intersectObjects(aircraft.meshes, false)[0];
      if (!hit || !hit.face) continue;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (n.z * side < 0) n.negate();
      drawn = drawn || art(d);
      const width = length * d.w, mesh = new Mesh(new PlaneGeometry(width, width * drawn.aspect),
        new MeshStandardMaterial({ map: drawn.texture, transparent: true, roughness: .85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, side: FrontSide }));
      mesh.quaternion.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), n.clone().negate(), Y_AXIS));
      // Корінь моделі масштабований: позицію й розмір переводимо в його локальні координати.
      mesh.position.copy(g.worldToLocal(hit.point.clone().addScaledVector(n, .004 * (length / 4.6))));
      mesh.scale.setScalar(1 / g.scale.x);
      mesh.userData.decal = true;
      mesh.name = 'decal-' + d.kind;
      g.add(mesh); placed.push(mesh);
    }
  }
  g.rotation.y = prev;
  g.updateMatrixWorld(true);
  return placed;
}


export class RefViewer {
  constructor(el, { motion = true } = {}) {
    this.el = el;
    this.motion = motion;
    this.renderer = createRenderer({ powerPreference: 'default' });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'rw-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(26, 2, .1, 80);
    this.stage = addStageEnvironment(this.renderer, this.scene, { shadowSize: 3.6 });
    this.holder = new Group();
    this.scene.add(this.holder);
    el.prepend(this.canvas);
    this.group = null; this.wings = []; this.update = null; this.explode = null; this.action = null; this.step = 0;
    this.parts = []; this.spot = new Vector3();
    this.spots = []; this.activeSpot = -1; this.onSpot = null; this.entry = null; this.rc = new Raycaster(); this.tmp = new Vector3(); this.dir = new Vector3(); this.occTimer = 0; this.turnRaf = 0;
    this.cache = new Map();
    this.sim = null;
    Object.assign(this, VIEWS['three-quarter']);
    this.open = 1; this.apart = 0; this.zoom = 1; this.auto = false; this.token = 0;
    this.target = new Vector3(0, -.3, 0); this.footprint = { r: 2.8, hh: .6 }; this.aircraft = false;
    this.dirty = true; this.last = 0; this.dragging = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.bind();
    this.resize();
    this.frame = requestAnimationFrame(this.tick);
  }

  get modular() { return !!this.explode; }
  get animated() { return !!this.action; }
  get winged() { return this.wings.length > 0; }

  // Показує модель: { kind } — процедурний боєприпас, { file, nose } — літак з .glb. Повертає можливості моделі.
  async show(model, { onProgress } = {}) {
    const token = ++this.token;
    let built;
    const key = modelKey(model);
    if (key) {
      let entry = this.cache.get(key);
      if (!entry) {
        const gltf = await loadGltf(model, onProgress);
        if (model.glass !== undefined) fixMaterials(gltf.scene, model);
        entry = normalizeAircraft(gltf.scene, model.nose, model.length);
        entry.action = prepareAction(gltf, entry);
        if (model.decals && model.decals.length) applyDecals(entry, model.decals);
        const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        entry.group.traverse(o => {
          if (!o.isMesh || o.userData.decal) return;
          o.castShadow = true;
          for (const m of [].concat(o.material)) for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[key]) m[key].anisotropy = aniso;
        });
        this.cache.set(key, entry);
      }
      this.cache.delete(key); this.cache.set(key, entry); // найсвіжіша — в кінці
      this.trim(key);
      if (token !== this.token) return null;
      built = { group: entry.group, wings: [], aircraft: entry };
    } else {
      built = SHELL_KINDS.includes(model.kind) ? buildShell(model.kind) : buildModel(model.kind);
    }
    this.clear();
    const { group, wings = [], update, explode, labels = [], aircraft } = built;
    this.group = group; this.wings = wings; this.update = update || null; this.explode = explode || null;
    this.aircraft = !!aircraft;
    // Позначки потребують розмірів моделі в стандартній позі; процедурному боєприпасу їх дає межовий об’єм групи.
    if (aircraft) this.entry = aircraft;
    else {
      group.updateMatrixWorld(true);
      const box = new Box3().setFromObject(group);
      this.entry = { group, size: box.getSize(new Vector3()), min: box.min.clone() };
    }
    this.action = (aircraft && aircraft.action) || null; this.step = 0;
    if (this.action) this.action.seek(0);
    this.parts = labels.map(label => {
      const span = document.createElement('span');
      span.className = 'rw-part rw-part-' + label.side; span.textContent = label.text; span.setAttribute('aria-hidden', 'true');
      this.el.append(span);
      return { label, el: span };
    });
    this.holder.add(group);
    if (aircraft) {
      // Літак: підлога під шасі, тінь по розмірах моделі, камера дивиться на центр.
      const { size, min } = aircraft;
      this.target.set(0, 0, 0);
      this.stage.floor.position.y = min.y - .28;
      this.stage.contact.scale.set(size.x * .56, size.z * .5, 1);
      // Круг, що описує слід літака на землі (не залежить від повороту), і піввисота.
      this.footprint = { r: Math.hypot(size.x, size.z) / 2, hh: size.y / 2 };
    } else {
      this.target.set(0, -.3, 0);
      this.stage.floor.position.y = FLOOR_Y;
      this.stage.contact.scale.set(2.6, 1, 1);
    }
    this.apart = 0; this.open = 1;
    this.setView('three-quarter');
    return { winged: this.winged, modular: this.modular, aircraft: this.aircraft, action: this.animated };
  }

  // Текстури наземних моделей важкі (атласи 2048²), тому в кеші лишаємо кілька останніх, а решту звільняємо з відеопамʼяті.
  trim(keep) {
    while (this.cache.size > 3) {
      const [file, entry] = this.cache.entries().next().value;
      if (file === keep) break;
      this.cache.delete(file);
      entry.group.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) {
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[key]) m[key].dispose();
          m.dispose();
        }
      });
    }
  }

  clear() {
    this.stopSim();
    this.clearSpots();
    if (this.group) {
      this.holder.remove(this.group);
      // Геометрію літака лишаємо в кеші, процедурні боєприпаси звільняємо.
      if (!this.aircraft) this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    for (const { el } of this.parts) el.remove();
    this.parts = []; this.group = null;
  }

  // ---------- позначки уразливих місць ----------
  // list — [{ title, p }] (див. spotAnchors), onPick(i, fromMarker) — виклик після вибору позначки (i = -1, коли вибір знято).
  setSpots(list = [], onPick = null) {
    this.clearSpots();
    this.onSpot = onPick;
    if (!this.entry || !list.length) return;
    const anchors = spotAnchors(this.entry, list.map(s => s.p), this.rc);
    this.spots = list.map((s, i) => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'rw-spot'; el.textContent = String(i + 1);
      el.title = s.title; el.setAttribute('aria-label', 'Позначка ' + (i + 1) + ': ' + s.title);
      el.addEventListener('pointerdown', e => { e.stopPropagation(); cancelAnimationFrame(this.turnRaf); });
      el.addEventListener('click', () => this.pickSpot(i, true));
      this.el.append(el);
      return { el, anchor: anchors[i], world: new Vector3() };
    });
    this.pose();
  }

  clearSpots() {
    cancelAnimationFrame(this.turnRaf);
    clearTimeout(this.occTimer); this.occTimer = 0;
    for (const { el } of this.spots) el.remove();
    this.spots = []; this.activeSpot = -1; this.onSpot = null;
  }

  setSpotsVisible(on) { for (const { el } of this.spots) el.hidden = !on; }

  // Вибір позначки (повторний клік знімає вибір): модель повертається зоною до глядача.
  pickSpot(i, fromMarker = false) {
    const s = this.spots[i];
    if (!s) return;
    this.activeSpot = this.activeSpot === i ? -1 : i;
    this.spots.forEach((x, j) => x.el.classList.toggle('on', j === this.activeSpot));
    if (this.activeSpot >= 0) this.faceSpot(s);
    if (this.onSpot) this.onSpot(this.activeSpot, fromMarker);
  }

  faceSpot(s) {
    const a = s.anchor;
    if (Math.hypot(a.x, a.z) < .15) return; // зона над віссю моделі: повертати нікуди
    const from = this.yaw, to = Math.atan2(-a.x, a.z);
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    cancelAnimationFrame(this.turnRaf);
    this.auto = false;
    if (!this.motion) { this.yaw = from + delta; this.pose(); return; }
    const t0 = performance.now(), span = 500;
    const step = now => {
      const k = Math.min((now - t0) / span, 1), e = k * k * (3 - 2 * k);
      this.yaw = from + delta * e; this.pose();
      if (k < 1) this.turnRaf = requestAnimationFrame(step);
    };
    this.turnRaf = requestAnimationFrame(step);
  }

  // Позначки — елементи HTML, що їздять за точками на моделі. Ті, що опинилися за корпусом, блякнуть;
  // перевірка променем дорога, тож її роблять не частіше, ніж раз на ~140 мс, і вже після того, як модель зупинилась.
  placeSpots() {
    const g = this.group;
    if (!g || !this.spots.length || this.sim) return;
    this.camera.updateMatrixWorld();
    const w = this.el.clientWidth, h = this.el.clientHeight, yaw = g.rotation.y;
    for (const s of this.spots) {
      s.world.copy(s.anchor).applyAxisAngle(Y_AXIS, yaw);
      this.tmp.copy(s.world).project(this.camera);
      s.el.style.left = ((this.tmp.x + 1) / 2 * w).toFixed(1) + 'px';
      s.el.style.top = ((1 - this.tmp.y) / 2 * h).toFixed(1) + 'px';
    }
    if (!this.occTimer) this.occTimer = setTimeout(() => { this.occTimer = 0; this.checkSpots(); }, 140);
  }

  checkSpots() {
    if (!this.group || !this.entry || !this.entry.meshes || !this.spots.length) return;
    this.group.updateMatrixWorld(true);
    const eye = this.camera.position;
    for (const s of this.spots) {
      this.dir.copy(s.world).sub(eye);
      const d = this.dir.length();
      this.rc.set(eye, this.dir.normalize());
      this.rc.far = d - .05;
      s.el.classList.toggle('is-hid', this.rc.intersectObjects(this.entry.meshes, false).length > 0);
    }
  }

  // ---------- сценарій «Інтерактивної моделі» (ref-sim.js) ----------
  // cfg — simOf(entry). Повертає список фаз; перша вмикається одразу.
  startSim(cfg) {
    this.stopSim();
    if (!this.group || !this.entry || !cfg) return [];
    this.setSpotsVisible(false);
    this.auto = false;
    this.sim = new Sim(this, cfg);
    this.pose();
    return this.sim.phases;
  }

  setSimPhase(id) { if (this.sim) this.sim.set(id); }

  stopSim() {
    if (!this.sim) return;
    this.sim.dispose();
    this.sim = null;
    this.pose();
  }

  setOpen(v) { this.open = v; this.pose(); }
  setApart(v) { this.apart = v; this.pose(); }
  setAction(v) {
    if (!this.action) return;
    this.step = clamp(v, 0, 1); this.action.seek(this.step); this.pose();
  }
  setView(name) { Object.assign(this, VIEWS[name] || VIEWS['three-quarter']); this.zoom = 1; this.pose(); }
  spin(dYaw, dPitch = 0) { this.yaw += dYaw; this.pitch = clamp(this.pitch + dPitch, .02, 1.52); this.pose(); }
  zoomBy(f) { this.zoom = clamp(this.zoom * f, .45, 1.6); this.pose(); }

  bind() {
    const el = this.el;
    let drag = null;
    el.style.touchAction = 'pan-y';
    el.addEventListener('pointerdown', e => { cancelAnimationFrame(this.turnRaf); drag = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' }; this.dragging = true; el.setPointerCapture?.(e.pointerId); el.classList.add('is-grab'); });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      this.spin((e.clientX - drag.x) * .012, drag.mouse ? (e.clientY - drag.y) * .008 : 0);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const up = () => { drag = null; this.dragging = false; el.classList.remove('is-grab'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    el.addEventListener('keydown', e => {
      const step = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, .1], ArrowDown: [0, -.1] }[e.key];
      if (step) { e.preventDefault(); this.spin(step[0], step[1]); }
      else if (e.key === '+' || e.key === '=') this.zoomBy(1 / 1.12);
      else if (e.key === '-') this.zoomBy(1.12);
    });
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pose();
  }

  baseDistance() {
    const aspect = this.camera.aspect;
    // Боєприпаси: та сама відстань, що в картці вильоту, з запасом для розкладеної бомби; літак — за описаною кулею.
    if (this.aircraft) return aircraftDistance(this.action ? this.reach() : this.footprint, this.pitch, this.camera.fov, aspect);
    return Math.max(6, (6 * 2.1) / aspect) * (this.explode ? 1.14 : 1);
  }

  // Розмір моделі в поточній частці анімації (лінійно між сусідніми зразками).
  reach() {
    const list = this.action.reach, f = this.step * (list.length - 1), i = Math.min(Math.floor(f), list.length - 2), k = f - i;
    return { r: list[i].r + (list[i + 1].r - list[i].r) * k, hh: list[i].hh + (list[i + 1].hh - list[i].hh) * k };
  }

  // Модель обертається навколо вертикалі (тінь від ключового світла рухається разом із нею), камера — по висоті.
  pose() {
    const g = this.group;
    if (!g) return;
    for (const [mesh, angle] of this.wings) mesh.rotation.y = angle * this.open;
    if (this.explode) this.explode(this.apart);
    if (this.update) this.update();
    const d = this.baseDistance() * this.zoom * (this.sim ? this.sim.distance : 1);
    if (this.sim) {
      // У сценарії модель тримає курс уздовж смуги, а навколо неї обертається камера.
      this.target.set(0, this.sim.pose(), 0);
      g.updateMatrixWorld(true);
      const c = Math.cos(this.pitch) * d;
      this.camera.position.set(-Math.sin(this.yaw) * c, this.target.y + Math.sin(this.pitch) * d, Math.cos(this.yaw) * c);
    } else {
      g.rotation.y = this.yaw;
      g.updateMatrixWorld(true);
      this.camera.position.set(this.target.x, this.target.y + Math.sin(this.pitch) * d, this.target.z + Math.cos(this.pitch) * d);
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.placeParts();
    this.placeSpots();
    this.dirty = true;
  }

  // Підписи модулів — елементи HTML, що їздять за модулями розкладеної бомби. Вздовж осі модулі накладаються,
  // тож підписи гаснуть, коли бомба повернута носом чи хвостом до глядача.
  placeParts() {
    const g = this.group;
    if (!g || !this.parts.length) return;
    this.camera.updateMatrixWorld();
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const ramp = (v, from, span) => clamp((v - from) / span, 0, 1);
    const shown = ramp(Math.abs(Math.cos(g.rotation.y)), .4, .3) * ramp(this.apart, .4, .5);
    const boxes = this.parts.map(({ label, el }) => {
      label.anchor.getWorldPosition(this.spot).project(this.camera);
      const half = el.offsetWidth / 2, px = (this.spot.x + 1) / 2 * w;
      return { el, side: label.side, half, px, x: clamp(px, half + 4, Math.max(w - half - 4, half + 4)), y: (1 - this.spot.y) / 2 * h, extra: 0 };
    });
    spreadLabels(boxes, this.parts[0]?.el.offsetHeight);
    for (const b of boxes) {
      b.el.style.left = b.x.toFixed(1) + 'px'; b.el.style.top = b.y.toFixed(1) + 'px';
      b.el.style.setProperty('--lead', (b.px - b.x).toFixed(1) + 'px');
      b.el.style.setProperty('--drop', b.extra + 'px');
      b.el.style.opacity = shown.toFixed(2);
    }
  }

  tick = now => {
    const dt = this.last ? Math.min((now - this.last) / 1000, .1) : 0;
    this.last = now;
    // Приховану вкладку не малюємо.
    if (this.group && this.el.offsetParent !== null) {
      if (this.sim && this.motion) { this.sim.step(dt); this.pose(); }
      if (this.auto && this.motion && !this.dragging) { this.yaw += dt * .3; this.pose(); }
      if (this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; }
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
