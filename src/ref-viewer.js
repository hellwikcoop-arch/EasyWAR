// Тривимірний переглядач довідника по озброєнню (three.js). Показує або процедурну модель боєприпасу
// (munition-3d.js), або .glb-модель літака з каталогу src/models. Завантажується лише коли вперше відкривають статтю
// з моделлю. Сцена (світло, підлога) спільна з карткою вильоту — stage-3d.js.
import { AnimationMixer, Box3, Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { addStageEnvironment, createRenderer, FLOOR_Y } from './stage-3d.js';
import { buildModel, spreadLabels } from './munition-3d.js';

// Файли моделей літаків. Шлях у new URL(...) має бути дослівним, щоб Vite покласти файл у збірку.
export const MODEL_FILES = {
  'mig-29': new URL('./models/mig-29.glb', import.meta.url).href,
  'su-27': new URL('./models/su-27.glb', import.meta.url).href,
  'mirage-2000-5f': new URL('./models/mirage-2000-5f.glb', import.meta.url).href,
  'su-24': new URL('./models/su-24.glb', import.meta.url).href,
  'f-16': new URL('./models/f-16.glb', import.meta.url).href,
  'su-25': new URL('./models/su-25.glb', import.meta.url).href,
  'gripen': new URL('./models/gripen.glb', import.meta.url).href,
  'mi-24p': new URL('./models/mi-24p.glb', import.meta.url).href,
  'mi-8': new URL('./models/mi-8.glb', import.meta.url).href,
  'su-27b': new URL('./models/su-27b.glb', import.meta.url).href,
  'mig-29-ghost': new URL('./models/mig-29-ghost.glb', import.meta.url).href,
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
    this.cache = new Map();
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
    if (model.file) {
      const url = MODEL_FILES[model.file];
      if (!url) throw new Error('Невідомий файл моделі: ' + model.file);
      let entry = this.cache.get(model.file);
      if (!entry) {
        const gltf = await gltfLoader().loadAsync(url, e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); });
        entry = normalizeAircraft(gltf.scene, model.nose, model.length);
        entry.action = prepareAction(gltf, entry);
        const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        entry.group.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = true;
          for (const m of [].concat(o.material)) for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[key]) m[key].anisotropy = aniso;
        });
        this.cache.set(model.file, entry);
      }
      this.cache.delete(model.file); this.cache.set(model.file, entry); // найсвіжіша — в кінці
      this.trim(model.file);
      if (token !== this.token) return null;
      built = { group: entry.group, wings: [], aircraft: entry };
    } else {
      built = buildModel(model.kind);
    }
    this.clear();
    const { group, wings = [], update, explode, labels = [], aircraft } = built;
    this.group = group; this.wings = wings; this.update = update || null; this.explode = explode || null;
    this.aircraft = !!aircraft;
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
    if (this.group) {
      this.holder.remove(this.group);
      // Геометрію літака лишаємо в кеші, процедурні боєприпаси звільняємо.
      if (!this.aircraft) this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    for (const { el } of this.parts) el.remove();
    this.parts = []; this.group = null;
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
    el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' }; this.dragging = true; el.setPointerCapture?.(e.pointerId); el.classList.add('is-grab'); });
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
    g.rotation.y = this.yaw;
    g.updateMatrixWorld(true);
    const d = this.baseDistance() * this.zoom;
    this.camera.position.set(this.target.x, this.target.y + Math.sin(this.pitch) * d, this.target.z + Math.cos(this.pitch) * d);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.placeParts();
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
