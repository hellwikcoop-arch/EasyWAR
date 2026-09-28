// Тривимірні умовні моделі боєприпасів для картки вильоту модуля «Повітряні Сили».
// Моделі складено з простих тіл обертання й пластин: GBU-62/64 з крилами JDAM-ER під
// корпусом, GBU-39/53 з крилами зверху, AGM-88, AASM, BLU-140, ракети й звичайна бомба.
// Сцена одна на весь модуль: канва переноситься в нову картку, щоб не плодити контексти WebGL.
import {
  ACESFilmicToneMapping, BoxGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight,
  ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera,
  PMREMGenerator, PolarGridHelper, Scene, Shape, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const LENGTH = 4; // довжина кожної моделі в умовних одиницях сцени
const COLORS = {
  olive: '#56592b', grey: '#a9afb6', white: '#c3c8ce', yellow: '#d9b310', steel: '#8d9299', fuze: '#e4e6e8',
  glass: '#1b2733', radome: '#e6dfca', dark: '#2a2f35',
};
const material = (() => {
  const cache = new Map();
  return (name, extra = {}) => {
    const key = name + JSON.stringify(extra);
    if (!cache.has(key)) {
      const metal = name === 'steel' || name === 'fuze' || name === 'grey';
      cache.set(key, new MeshStandardMaterial({ color: COLORS[name], metalness: metal ? .6 : .2, roughness: metal ? .35 : .55, ...extra }));
    }
    return cache.get(key);
  };
})();

// Тіло обертання вздовж осі X: точки [радіус, x] від хвоста до носа.
function lathe(points, mat) {
  const geometry = new LatheGeometry(points.map(([r, x]) => new Vector2(Math.max(r, 0), x)), 40);
  geometry.rotateZ(-Math.PI / 2);
  return new Mesh(geometry, mat);
}

// Хрестоподібні стабілізатори: трапеції в площині осі, розставлені навколо корпусу.
function fins({ at, root, tip, span, sweep = .5, base, count = 4, offset = Math.PI / 4, thickness = .03, mat }) {
  const shape = new Shape();
  shape.moveTo(at, 0);
  shape.lineTo(at + root, 0);
  shape.lineTo(at + root - (root - tip) * (1 - sweep), span);
  shape.lineTo(at + root - (root - tip) * (1 - sweep) - tip, span);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, base, -thickness / 2);
  const group = new Group();
  for (let i = 0; i < count; i++) {
    const fin = new Mesh(geometry, mat);
    fin.rotation.x = offset + i * (2 * Math.PI / count);
    group.add(fin);
  }
  return group;
}

function ring(x, radius, tube, mat) {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 8, 48), mat);
  mesh.rotation.y = Math.PI / 2;
  mesh.position.x = x;
  return mesh;
}

// Крило, що розкривається: пластина від осі повороту назад по корпусу.
function wing(length, chord, y, z, mat) {
  const geometry = new BoxGeometry(length, .018, chord);
  geometry.translate(-length / 2, 0, 0);
  const mesh = new Mesh(geometry, mat);
  mesh.position.set(0, y, z);
  return mesh;
}

// Пара крил із точкою повороту pivotX; deploy — кут повного розкриття від осі корпусу.
function wingPair({ pivotX, length, chord, y, gap = .022, deploy, mat, mount }) {
  const group = new Group();
  group.position.x = pivotX;
  if (mount) group.add(mount);
  const left = wing(length, chord, y, 0, mat), right = wing(length, chord, y + (y > 0 ? gap : -gap), 0, mat);
  group.add(left, right);
  return { group, wings: [[left, deploy], [right, -deploy]] };
}

function bombBody({ r, tailR, noseLen, tailLen, band, colorBody = 'olive', tailKit = 'grey', fuze = true }) {
  const g = new Group(), h = LENGTH / 2, t0 = -h + tailLen;
  g.add(lathe([[0, -h - .02], [tailR * .7, -h], [tailR, -h + .08], [r * .75, -h + tailLen * .6], [r, t0], [r, t0 + .02]], material(tailKit)));
  const n0 = h - noseLen;
  g.add(lathe([[r, t0 + .02], [r, n0], [r * .92, n0 + noseLen * .3], [r * .72, n0 + noseLen * .55]], material(colorBody)));
  if (band) {
    g.add(lathe([[r * .72, n0 + noseLen * .55], [r * .6, n0 + noseLen * .66]], material('yellow')));
    g.add(lathe([[r * .6, n0 + noseLen * .66], [r * .38, n0 + noseLen * .84]], material(colorBody)));
  } else {
    g.add(lathe([[r * .72, n0 + noseLen * .55], [r * .38, n0 + noseLen * .84]], material(colorBody)));
  }
  g.add(lathe(fuze ? [[r * .38, n0 + noseLen * .84], [r * .24, n0 + noseLen * .95], [0, h]] : [[r * .38, n0 + noseLen * .84], [0, h]], material(fuze ? 'fuze' : colorBody)));
  return g;
}

function slenderBody({ r, noseLen, tailTaper = .1, color = 'grey', nose = 'ogive', noseColor }) {
  const g = new Group(), h = LENGTH / 2, n0 = h - noseLen;
  g.add(lathe([[0, -h], [r * .8, -h], [r, -h + tailTaper], [r, n0]], material(color)));
  if (nose === 'dome') {
    const dome = new Mesh(new SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), material(noseColor || 'glass', { metalness: .5, roughness: .12 }));
    dome.rotation.z = -Math.PI / 2;
    dome.position.x = n0;
    g.add(dome);
  } else {
    g.add(lathe([[r, n0], [r * .9, n0 + noseLen * .35], [r * .6, n0 + noseLen * .7], [r * .15, n0 + noseLen * .96], [0, h]], material(noseColor || color)));
  }
  return g;
}

// Кожна модель повертає групу і список крил [меш, кут розкриття].
const MODELS = {
  '62': () => jdamEr({ r: .34, band: true }),
  '64': () => jdamEr({ r: .38, band: true }),
  '39': () => {
    const g = new Group(), r = .2;
    g.add(slenderBody({ r, noseLen: .9, color: 'grey' }));
    g.add(fins({ at: -1.98, root: .34, tip: .16, span: .22, base: r * .9, mat: material('grey'), offset: 0 }));
    const rail = new Mesh(new BoxGeometry(1.3, .05, .08), material('steel'));
    rail.position.set(-.25, r + .02, 0);
    const pair = wingPair({ pivotX: .45, length: 1.55, chord: .16, y: r + .06, deploy: 1.1, mat: material('white'), mount: rail });
    rail.position.x -= .45;
    g.add(pair.group);
    return { group: g, wings: pair.wings };
  },
  '53': () => {
    const g = new Group(), r = .27;
    g.add(slenderBody({ r, noseLen: .3, color: 'grey', nose: 'dome' }));
    g.add(fins({ at: -1.98, root: .3, tip: .14, span: .22, base: r * .85, mat: material('grey'), offset: 0 }));
    const pair = wingPair({ pivotX: .35, length: 1.3, chord: .18, y: r + .03, deploy: 1.25, mat: material('white') });
    g.add(pair.group);
    return { group: g, wings: pair.wings };
  },
  agm88: () => {
    const g = new Group(), r = .13;
    g.add(slenderBody({ r, noseLen: .75, color: 'white', noseColor: 'radome' }));
    g.add(ring(.9, r + .002, .012, material('dark')));
    g.add(fins({ at: -.1, root: .7, tip: .18, span: .32, sweep: .9, base: r * .95, mat: material('white') }));
    g.add(fins({ at: -1.98, root: .32, tip: .2, span: .22, base: r * .95, mat: material('white') }));
    return { group: g, wings: [] };
  },
  aasm: () => {
    const g = new Group(), r = .24;
    g.add(slenderBody({ r, noseLen: .7, color: 'grey', tailTaper: .25 }));
    g.add(ring(-.2, r + .004, .02, material('steel')), ring(.5, r + .004, .02, material('steel')));
    g.add(fins({ at: 1.05, root: .18, tip: .1, span: .12, base: r * .95, mat: material('grey') }));
    g.add(fins({ at: -1.95, root: .4, tip: .18, span: .32, base: r * .7, mat: material('grey') }));
    return { group: g, wings: [] };
  },
  blu140: () => {
    const g = new Group();
    g.add(bombBody({ r: .24, tailR: .16, noseLen: 1.3, tailLen: .5, band: true }));
    g.add(fins({ at: -1.98, root: .42, tip: .2, span: .3, base: .16, mat: material('olive') }));
    return { group: g, wings: [] };
  },
  c13: () => {
    const g = new Group(), r = .15;
    g.add(slenderBody({ r, noseLen: .45, color: 'olive', tailTaper: .02 }));
    g.add(ring(-1.99, r * .85, .025, material('steel')));
    g.add(fins({ at: -1.98, root: .32, tip: .22, span: .2, sweep: .8, base: r * .95, mat: material('steel'), thickness: .02 }));
    return { group: g, wings: [] };
  },
  bomb: () => {
    const g = new Group();
    g.add(bombBody({ r: .32, tailR: .15, noseLen: 1.1, tailLen: .7, band: true, tailKit: 'olive' }));
    g.add(fins({ at: -1.98, root: .5, tip: .42, span: .3, sweep: .6, base: .15, mat: material('olive'), offset: 0 }));
    g.add(ring(-1.78, .45, .02, material('olive')));
    return { group: g, wings: [] };
  },
};

function jdamEr({ r, band }) {
  const g = new Group();
  g.add(bombBody({ r, tailR: .1, noseLen: 1.05, tailLen: 1.35, band }));
  g.add(fins({ at: -1.98, root: .5, tip: .28, span: .42, base: .1, mat: material('grey') }));
  for (const x of [-.45, .15, .75]) g.add(ring(x, r + .004, .022, material('steel')));
  const kit = new Mesh(new BoxGeometry(1.25, .1, .26), material('white'));
  kit.position.set(-.55, -r - .05, 0);
  const pair = wingPair({ pivotX: .55, length: 2.0, chord: .2, y: -r - .12, deploy: 1.22, mat: material('white'), mount: kit });
  kit.position.x -= .55;
  g.add(pair.group);
  return { group: g, wings: pair.wings };
}

export const KINDS = Object.keys(MODELS);
export function buildModel(kind) {
  return (MODELS[kind] || MODELS.bomb)();
}

// ------------------------------------------------------------------ сцена
let stage = null; // { renderer, scene, camera, holder, frame, run }
const backOut = t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

function shadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

function createStage() {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  const key = new DirectionalLight('#ffffff', 1.6); key.position.set(3, 6, 4); scene.add(key);
  const rim = new DirectionalLight('#8fc2c2', .9); rim.position.set(-5, 2, -4); scene.add(rim);
  const grid = new PolarGridHelper(6.5, 16, 7, 96, new Color('#5c8a8a'), new Color('#5c8a8a'));
  grid.material.transparent = true; grid.material.opacity = .22; grid.position.y = -1.05; scene.add(grid);
  const floor = new Mesh(new CircleGeometry(6.5, 64), new MeshBasicMaterial({ color: '#07090b', transparent: true, opacity: .55 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.06; scene.add(floor);
  const shadow = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.04; shadow.scale.set(2.6, 1.1, 1); scene.add(shadow);
  const camera = new PerspectiveCamera(26, 2, .1, 60);
  const holder = new Group(); scene.add(holder);
  renderer.domElement.className = 'mw-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  return { renderer, scene, camera, holder, frame: 0, run: 0, shadow };
}

function disposeGroup(group) {
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

// Показати модель у контейнері. Повертає false, якщо WebGL недоступний.
export function mount(el, kind, { motion = true } = {}) {
  try { if (!stage) stage = createStage(); } catch { stage = null; return false; }
  const s = stage, run = ++s.run, canvas = s.renderer.domElement;
  cancelAnimationFrame(s.frame);
  for (const old of [...s.holder.children]) { s.holder.remove(old); disposeGroup(old); }
  const { group, wings } = buildModel(kind);
  s.holder.add(group);
  el.prepend(canvas);
  const marks = ['nose', 'tail'].map(n => {
    const m = document.createElement('span'); m.className = 'mw-lock mw-lock-' + n; m.setAttribute('aria-hidden', 'true'); el.append(m); return m;
  });
  const alive = () => run === s.run && el.isConnected && !!el.closest('dialog[open]');
  const size = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    s.renderer.setSize(w, h, false);
    s.camera.aspect = w / h;
    // Уся модель має влазити в ширину навіть у вузькій картці.
    const d = Math.max(6, 6 * 2.5 / s.camera.aspect);
    s.camera.position.set(0, d * .41, d);
    s.camera.lookAt(0, -.2, 0);
    s.camera.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!alive()) { ro.disconnect(); return; }
    size();
    if (!motion) { place(); s.renderer.render(s.scene, s.camera); }
  }) : null;
  if (ro) ro.observe(el);
  size();
  const tip = new Vector3(), tail = new Vector3();
  const place = () => {
    const w = el.clientWidth, h = el.clientHeight;
    [[LENGTH / 2 - .05, tip, marks[0]], [-LENGTH / 2 + .05, tail, marks[1]]].forEach(([x, v, m]) => {
      v.set(x, 0, 0); group.localToWorld(v); v.project(s.camera);
      m.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px'; m.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
    });
  };
  const pose = (t) => {
    group.rotation.y = motion ? -.55 + t * .45 : -.75;
    group.position.y = motion ? Math.sin(t * 1.3) * .04 : 0;
    const k = motion ? Math.min(Math.max((t - 1.2) / 1.4, 0), 1) : 1;
    const open = k === 0 ? 0 : backOut(k);
    for (const [mesh, angle] of wings) mesh.rotation.y = angle * open;
  };
  const t0 = performance.now();
  const tick = now => {
    if (!alive()) { if (ro) ro.disconnect(); return; }
    pose((now - t0) / 1000); place();
    s.renderer.render(s.scene, s.camera);
    s.frame = requestAnimationFrame(tick);
  };
  if (motion) s.frame = requestAnimationFrame(tick);
  else { pose(0); place(); s.renderer.render(s.scene, s.camera); }
  return true;
}
