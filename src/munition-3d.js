// Тривимірні умовні моделі боєприпасів для картки вильоту модуля «Повітряні Сили».
// GBU-62/64 (JDAM-ER) і GBU-39 зібрано детально за кресленнями: розгортку корпусу малюємо на канві
// (фарба, метал, шви, заклепки, трафарети, потертості), обтічник крила складено з перерізів.
// Решта боєприпасів складена з простих тіл обертання й пластин.
// Сцена одна на весь модуль: канва переноситься в нову картку, щоб не плодити контексти WebGL.
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, CylinderGeometry,
  DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, LatheGeometry, Line, LineDashedMaterial, Mesh,
  MeshStandardMaterial, Object3D, Path, PerspectiveCamera, PlaneGeometry, RepeatWrapping, Scene,
  Shape, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3,
} from 'three';
import { addStageEnvironment, createRenderer } from './stage-3d.js';

const LENGTH = 4; // довжина кожної моделі в умовних одиницях сцени
const HAS_DOM = typeof document !== 'undefined'; // модульні тести будують моделі в Node без канви
const COLORS = {
  olive: '#56592b', grey: '#a9afb6', white: '#c3c8ce', yellow: '#d9b310', steel: '#8d9299', fuze: '#e4e6e8',
  glass: '#1b2733', radome: '#e6dfca', dark: '#2a2f35',
};

// Детермінований генератор: потертості й заклепки щоразу ті самі.
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function texture(source, { srgb = false, repeat = false, flipY = false } = {}) {
  const t = new CanvasTexture(source);
  t.flipY = flipY;
  if (srgb) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Безшовна текстура дрібних плям і подряпин: множиться на колір фарби простих деталей.
let grimeTexture = null;
function grime() {
  if (!HAS_DOM) return null;
  if (grimeTexture) return grimeTexture;
  const size = 256, c = canvas(size, size), x = c.getContext('2d'), rnd = random(7);
  x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, size, size);
  const wrapped = draw => { for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(dx, dy); };
  for (let i = 0; i < 160; i++) {
    const px = rnd() * size, py = rnd() * size, rad = 3 + rnd() * 24, dark = rnd() < .75, a = .02 + rnd() * .045;
    const rgb = dark ? '58,56,50' : '255,255,255';
    wrapped((dx, dy) => {
      const g = x.createRadialGradient(px + dx, py + dy, 0, px + dx, py + dy, rad);
      g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = g; x.fillRect(px + dx - rad, py + dy - rad, rad * 2, rad * 2);
    });
  }
  x.lineWidth = .7;
  for (let i = 0; i < 70; i++) {
    const px = rnd() * size, py = rnd() * size, len = 4 + rnd() * 16, ang = rnd() * Math.PI;
    x.strokeStyle = `rgba(255,255,255,${.05 + rnd() * .08})`;
    wrapped((dx, dy) => { x.beginPath(); x.moveTo(px + dx, py + dy); x.lineTo(px + dx + Math.cos(ang) * len, py + dy + Math.sin(ang) * len); x.stroke(); });
  }
  grimeTexture = texture(c, { srgb: true, repeat: true });
  return grimeTexture;
}

// Фарбована або металева поверхня простих деталей; кеш, щоб моделі ділили матеріали.
export const paint = (() => {
  const cache = new Map();
  return (color, roughness, metalness, extra = {}) => {
    const key = [color, roughness, metalness, JSON.stringify(extra)].join('|');
    if (!cache.has(key)) cache.set(key, new MeshStandardMaterial({ color, roughness, metalness, map: grime(), ...extra }));
    return cache.get(key);
  };
})();

export function material(name, extra = {}) {
  const metal = name === 'steel' || name === 'fuze' || name === 'grey';
  return paint(COLORS[name], metal ? .35 : .55, metal ? .6 : .2, extra);
}

// ------------------------------------------------------------------ розгортка корпусу
// Канва загортається навколо тіла обертання: x канви — уздовж осі (у координатах моделі),
// рядок — частка кола v: 0 низ, .25 дальній бік (−z), .5 верх, .75 ближній бік (+z), 1 знову низ.
const FAR = .25, NEAR = .75;

export class Skin {
  constructor(span, radius, seed) {
    [this.x0, this.x1] = span;
    this.w = 2048; this.h = 512;
    // У скільки разів рядок канви коротший за стовпчик на поверхні: текст і кружечки стискаємо на цей множник.
    this.aspect = (this.h / (2 * Math.PI * radius)) / (this.w / (this.x1 - this.x0));
    this.rnd = random(seed);
    [this.color, this.orm, this.bump] = [0, 1, 2].map(() => canvas(this.w, this.h).getContext('2d'));
    this.bump.fillStyle = '#808080'; this.bump.fillRect(0, 0, this.w, this.h);
  }

  px(x) { return (x - this.x0) / (this.x1 - this.x0) * this.w; }
  size(units) { return units / (this.x1 - this.x0) * this.w; }

  // Одна фігура на тих шарах, для яких задано властивості: color, mat [шорсткість, металевість], height (0…1).
  draw(p, path) {
    const fill = (c, style) => { c.fillStyle = style; path(c); c.fill(); };
    if (p.color) fill(this.color, p.color);
    if (p.mat) fill(this.orm, `rgb(255,${Math.round(p.mat[0] * 255)},${Math.round(p.mat[1] * 255)})`);
    if (p.height !== undefined) { const g = Math.round(p.height * 255); fill(this.bump, `rgb(${g},${g},${g})`); }
  }

  rect(x0, x1, v0, v1, p) {
    this.draw(p, c => { c.beginPath(); c.rect(this.px(x0), v0 * this.h, this.px(x1) - this.px(x0), (v1 - v0) * this.h); });
  }

  poly(points, p) {
    this.draw(p, c => { c.beginPath(); points.forEach(([x, v], i) => c[i ? 'lineTo' : 'moveTo'](this.px(x), v * this.h)); c.closePath(); });
  }

  dot(x, v, radius, p) {
    const r = this.size(radius);
    this.draw(p, c => { c.beginPath(); c.ellipse(this.px(x), v * this.h, r, r * this.aspect, 0, 0, Math.PI * 2); });
  }

  // Шов по колу або його частині: темна риска й заглиблення.
  seam(x, v0 = 0, v1 = 1, width = .006) {
    this.rect(x - width / 2, x + width / 2, v0, v1, { color: 'rgba(18,20,22,.55)', height: .22 });
  }

  // Поздовжній шов уздовж осі на частці кола v.
  seamAlong(x0, x1, v, width = .004) {
    const dv = width / (this.x1 - this.x0) * this.w * this.aspect / this.h;
    this.rect(x0, x1, v - dv / 2, v + dv / 2, { color: 'rgba(18,20,22,.5)', height: .22 });
  }

  rivets(x, v0, v1, count, radius = .0055) {
    for (let i = 0; i < count; i++) {
      const v = v0 + (v1 - v0) * (i + .5) / count;
      this.dot(x, v, radius * 1.5, { color: 'rgba(20,22,24,.35)', height: .38 });
      this.dot(x, v, radius, { color: 'rgba(235,238,240,.55)', height: .8 });
    }
  }

  // Прямокутна панель зі скругленими кутами: контур-шов і заклепки по кутах.
  panel(x0, x1, v0, v1, corner = .018) {
    const r = this.size(corner), w = this.size(.005);
    const outline = (c, style, lw) => {
      c.strokeStyle = style; c.lineWidth = lw; c.beginPath();
      c.roundRect(this.px(x0), v0 * this.h, this.px(x1) - this.px(x0), (v1 - v0) * this.h, [r, r * this.aspect, r, r * this.aspect]);
      c.stroke();
    };
    outline(this.color, 'rgba(18,20,22,.55)', w);
    outline(this.bump, 'rgb(56,56,56)', w);
    const dx = .02, dv = .02 * this.w / (this.x1 - this.x0) * this.aspect / this.h;
    for (const x of [x0 + dx, x1 - dx]) for (const v of [v0 + dv, v1 - dv]) this.dot(x, v, .005, { color: 'rgba(235,238,240,.55)', height: .8 });
  }

  // Трафаретні написи. Для дальнього боку розвертаємо на 180°, щоб читалися ззовні.
  // rot — додатковий поворот у площині поверхні: -π/2 дає рядки впоперек корпусу, що читаються знизу вгору.
  text(lines, x, v, size, color, flip = false, rot = 0) {
    const c = this.color, fs = this.size(size);
    c.save();
    c.translate(this.px(x), v * this.h); c.scale(1, this.aspect); c.rotate(rot + (flip ? Math.PI : 0));
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 ${fs.toFixed(1)}px "Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", "DejaVu Sans Condensed", Arial, sans-serif`;
    lines.forEach((line, i) => c.fillText(line, 0, (i - (lines.length - 1) / 2) * fs * 1.28, fs * 16));
    c.restore();
  }

  // Потертості: плями фарби й шорсткості в межах [x0, x1]; mat — [шорсткість, металевість] ділянки.
  weather(x0, x1, { dark, light, count, alpha = .12, mat }) {
    const layers = [this.color, this.orm];
    for (const c of layers) { c.save(); c.beginPath(); c.rect(this.px(x0), 0, this.px(x1) - this.px(x0), this.h); c.clip(); }
    for (let i = 0; i < count; i++) {
      const cx = this.px(x0 + this.rnd() * (x1 - x0)), cy = this.rnd() * this.h, rad = this.size(.01 + this.rnd() * .09);
      const a = alpha * (.3 + this.rnd() * .7), rgb = this.rnd() < .7 ? dark : light;
      const rough = Math.round(Math.min(Math.max(mat[0] + (this.rnd() - .5) * .3, 0), 1) * 255);
      for (const [c, col] of [[this.color, rgb], [this.orm, `255,${rough},${Math.round(mat[1] * 255)}`]]) {
        c.save();
        c.translate(cx, cy); c.scale(1, this.aspect);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, rad);
        g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g; c.fillRect(-rad, -rad, rad * 2, rad * 2);
        c.restore();
      }
    }
    for (const c of layers) c.restore();
  }

  // Шліфований алюміній: тонкі смуги вздовж осі.
  streaks(x0, x1, count, strength = 1) {
    for (let i = 0; i < count; i++) {
      const v = this.rnd(), len = .1 + this.rnd() * .6, x = x0 + this.rnd() * (x1 - x0 - len);
      const light = this.rnd() < .5, a = (.04 + this.rnd() * .06) * strength;
      this.rect(x, x + len, v, v + (1 + this.rnd() * 2) / this.h, { color: light ? `rgba(255,255,255,${a})` : `rgba(60,64,70,${a})` });
    }
  }

  material({ bumpScale = 1 } = {}) {
    const orm = texture(this.orm.canvas);
    return new MeshStandardMaterial({
      color: '#ffffff', roughness: 1, metalness: 1, bumpScale,
      map: texture(this.color.canvas, { srgb: true }), roughnessMap: orm, metalnessMap: orm, bumpMap: texture(this.bump.canvas),
    });
  }
}

// Розгортки дорогі, тож малюємо кожну один раз. Без DOM — проста фарба того ж кольору.
const skins = new Map();
export function skin(key, build, fallback) {
  if (!HAS_DOM) return fallback;
  if (!skins.has(key)) skins.set(key, build());
  return skins.get(key);
}

// ------------------------------------------------------------------ геометрія
// Тіло обертання вздовж осі X: точки [радіус, x] від хвоста до носа. Шов розгортки — знизу.
// span — межі осі, на які натягнуто розгортку (u уздовж осі, v по колу).
export function lathe(points, mat, { segments = 48, span } = {}) {
  const geometry = new LatheGeometry(points.map(([r, x]) => new Vector2(Math.max(r, 0), x)), segments, Math.PI / 2);
  geometry.rotateZ(-Math.PI / 2);
  if (span) {
    const pos = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - span[0]) / (span[1] - span[0]), uv.getX(i));
  }
  return new Mesh(geometry, mat);
}

// Точки профілю r(x) з рівним кроком на відрізку [x0, x1].
export function sample(r, x0, x1, step = .02) {
  const n = Math.max(1, Math.ceil((x1 - x0) / step)), out = [];
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; out.push([r(x), x]); }
  return out;
}

// Тіло з перерізів уздовж осі X. section(x) повертає точки [z, y]; кількість однакова для всіх x.
// Відкритий верх перерізу ховається всередині корпусу; задній торець закривається віялом.
function loft(xs, section, mat, { capStart = true } = {}) {
  const rows = xs.map(x => section(x)), n = rows[0].length, m = xs.length, pos = [], uv = [], index = [];
  rows.forEach((pts, i) => pts.forEach(([z, y], j) => { pos.push(xs[i], y, z); uv.push(i / (m - 1), j / (n - 1)); }));
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = a + n;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  if (capStart) {
    const c = pos.length / 3, pts = rows[0];
    const [cz, cy] = pts.reduce(([sz, sy], [z, y]) => [sz + z / n, sy + y / n], [0, 0]);
    pos.push(xs[0], cy, cz); uv.push(0, .5);
    pts.forEach(([z, y]) => { pos.push(xs[0], y, z); uv.push(0, .5); });
    for (let j = 0; j < n - 1; j++) index.push(c, c + 2 + j, c + 1 + j);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return new Mesh(geometry, mat);
}

// Пластина за контуром [x, y] завтовшки thickness (уздовж z), зі скругленими кромками.
// UV нормуються на габарит контуру, щоб на пластину лягала власна розгортка.
export function plate(points, thickness, mat) {
  const bevel = Math.min(thickness * .3, .006), depth = Math.max(thickness - bevel * 2, .001);
  const geometry = new ExtrudeGeometry(new Shape(points.map(([x, y]) => new Vector2(x, y))),
    { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * .8, bevelSegments: 2, curveSegments: 4 });
  geometry.translate(0, 0, -depth / 2);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const [ax, bx, ay, by] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pos = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - ax) / (bx - ax), (pos.getY(i) - ay) / (by - ay));
  return new Mesh(geometry, mat);
}

// Хрестоподібні стабілізатори: трапеції в площині осі, розставлені навколо корпусу.
export function fins({ at, root, tip, span, sweep = .5, base, count = 4, offset = Math.PI / 4, thickness = .03, mat }) {
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

// Стабілізатори за точним контуром [x, радіус]; count штук навколо осі, починаючи з кута offset.
export function finSet(points, thickness, mat, { count = 4, offset = Math.PI / 4 } = {}) {
  const group = new Group(), proto = plate(points, thickness, mat);
  for (let i = 0; i < count; i++) {
    const fin = new Mesh(proto.geometry, mat);
    fin.rotation.x = offset + i * (2 * Math.PI / count);
    group.add(fin);
  }
  return group;
}

export function ring(x, radius, tube, mat) {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 8, 48), mat);
  mesh.rotation.y = Math.PI / 2;
  mesh.position.x = x;
  return mesh;
}

// Бандаж, що щільно облягає корпус із профілем r(x) між a і b.
export function band(r, a, b, mat, lift = .007) {
  const pts = [[r(a) - .002, a], [r(a) + lift, a + .005], ...sample(x => r(x) + lift, a + .008, b - .008, .01), [r(b) + lift, b - .005], [r(b) - .002, b]];
  return lathe(pts, mat, { segments: 64 });
}

// Пластина, дотична до корпусу радіуса radius у точці x під кутом psi від ближнього боку вниз.
function patch(x, radius, psi, [w, h, t], mat) {
  const mesh = new Mesh(new BoxGeometry(w, h, t), mat);
  const d = radius + t / 2 - .002;
  mesh.position.set(x, -d * Math.sin(psi), d * Math.cos(psi));
  mesh.rotation.x = psi;
  return mesh;
}

// Вушко підвіски: основа, стійка й петля вздовж осі.
function lug(x, y, mat, post = .026) {
  const g = new Group();
  const base = new Mesh(new BoxGeometry(.075, .012, .045), mat);
  const stem = new Mesh(new CylinderGeometry(.009, .012, post, 12), mat);
  const loop = new Mesh(new TorusGeometry(.017, .0055, 8, 20, Math.PI), mat);
  base.position.y = .004; stem.position.y = post / 2 + .008; loop.position.y = post + .006;
  g.add(base, stem, loop);
  g.position.set(x, y, 0);
  return g;
}

export function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

export function castShadows(group) {
  group.traverse(o => { if (o.isMesh && !o.userData.decal) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

// Стрижень між двома точками.
export function rod(a, b, radius, mat) {
  const p0 = new Vector3(...a), dir = new Vector3(...b).sub(p0), len = dir.length();
  const mesh = new Mesh(new CylinderGeometry(radius, radius, len, 10), mat);
  mesh.position.copy(p0).addScaledVector(dir, .5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

// Табличка з написом: площина з прозорим тлом, лицем до +z. Без DOM — порожня група.
function decal(lines, w, h, { color = '#e6e8ea', bg = null, size = .72 } = {}) {
  if (!HAS_DOM) return new Group();
  const c = canvas(512, Math.max(16, Math.round(512 * h / w))), x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
  const fs = c.height * size / lines.length;
  x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 ${fs.toFixed(1)}px "Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", Arial, sans-serif`;
  lines.forEach((line, i) => x.fillText(line, c.width / 2, c.height * (i + .5) / lines.length, c.width * .94));
  const mat = new MeshStandardMaterial({ map: texture(c, { srgb: true, flipY: true }), transparent: true, roughness: .6, metalness: 0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new Mesh(new PlaneGeometry(w, h), mat);
  mesh.userData.decal = true;
  return mesh;
}

// D-подібне вушко підвіски: петля з отвором, стоїть уздовж осі.
function dRing(mat, w = .075, h = .075, bar = .013, t = .014) {
  const r = w / 2, ri = r - bar, outer = new Shape(), hole = new Path();
  outer.moveTo(-r, 0); outer.lineTo(r, 0); outer.lineTo(r, h - r); outer.absarc(0, h - r, r, 0, Math.PI, false); outer.lineTo(-r, 0);
  hole.moveTo(-ri, bar); hole.lineTo(ri, bar); hole.lineTo(ri, h - r); hole.absarc(0, h - r, ri, 0, Math.PI, false); hole.lineTo(-ri, bar);
  outer.holes.push(hole);
  const geometry = new ExtrudeGeometry(outer, { depth: t, bevelEnabled: true, bevelThickness: .002, bevelSize: .002, bevelSegments: 1, curveSegments: 10 });
  geometry.translate(0, 0, -t / 2);
  return new Mesh(geometry, mat);
}

// Переріз обтічника під корпусом: від точки всередині корпусу назовні до півширини a, далі заокруглене «U»
// до глибини bottom. round < .5 дає майже прямокутний переріз, ближче до 1 — овальний.
function podSection(rb, top, a, bottom, x, round = .4, steps = 20) {
  const zb = Math.max(Math.sqrt(Math.max(rb(x) ** 2 - top * top, 0)) - .004, 0), b = bottom + top, pts = [[zb, top]];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps * Math.PI, c = Math.cos(t), s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.pow(Math.abs(c), round), top - b * Math.pow(s, round)]);
  }
  pts.push([-zb, top]);
  return pts;
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

// Крило за контуром (x уздовж, z убік; вісь повороту в початку координат), лежить горизонтально.
function wingPlate(points, thickness, mat) {
  const mesh = plate(points, thickness, mat);
  mesh.geometry.rotateX(Math.PI / 2);
  return mesh;
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

// ------------------------------------------------------------------ GBU-64: JDAM-ER з білим підривником
// Мірки зняті з ортогонального креслення (радіус .23 при довжині 4); для GBU-64 (корпус Mk 84)
// усе поперечне масштабується коефіцієнтом k.
const ALU = { color: '#b7bbbf', mat: [.46, .78], height: .5 };
const OLIVE = { color: '#3d4320', mat: [.64, .05], height: .5 };
const STRAP = { color: '#a9aeb3', mat: [.38, .85], height: .72 };
const YELLOW = { color: '#d8b21a', mat: [.48, .04], height: .5 };
const JDAM_SPAN = [-2.03, 2.04];

function jdamRadius(k) {
  const R = .23 * k;
  return x => {
    if (x < -1.785) return .072 * k;
    if (x < -.67) return (.078 + .152 * (x + 1.785) / 1.115) * k;
    if (x < .75) return R;
    if (x < 1.797) return R * (1 - .6 * Math.pow((x - .75) / 1.047, 1.45));
    return R * (.4 - .074 * Math.min((x - 1.797) / .123, 1));
  };
}

// Сідло підвіски: рамка з вікном згори, з обох боків звужується в одну стрічку донизу, до обтічника.
// v: [де боки починають сходитися, де починається стрічка, кінець стрічки, низ вікна, вістря вирізу].
function paintSaddle(s, { x: [x0, x1], win: [w0, w1], strap: [s0, s1], v: [frame, neck, end, winEnd, notch] }) {
  const mid = (s0 + s1) / 2;
  for (const m of [v => v, v => 1 - v]) {
    s.poly([[x0, m(.5)], [x1, m(.5)], [x1, m(frame)], [s1, m(neck)], [s1, m(end)], [s0, m(end)], [s0, m(neck)], [x0, m(frame)]], STRAP);
    s.poly([[w0, m(.5)], [w1, m(.5)], [w1, m(winEnd)], [mid, m(notch)], [w0, m(winEnd)]], OLIVE);
  }
}

function jdamSkin(k, label, filler) {
  const R = .23 * k, s = new Skin(JDAM_SPAN, R, 62);
  s.rect(-2.1, -.67, 0, 1, ALU);
  s.rect(-.67, 1.797, 0, 1, OLIVE);
  s.rect(1.797, 1.921, 0, 1, YELLOW);
  s.rect(1.921, 2.1, 0, 1, { color: '#e2e4e5', mat: [.4, .04], height: .5 });
  s.rect(1.921, 1.94, 0, 1, { color: '#9aa0a5', mat: [.34, .8], height: .64 });
  s.streaks(-2.03, -.67, 220);
  s.weather(-2.03, -.67, { dark: '92,96,100', light: '250,250,250', count: 70, alpha: .1, mat: ALU.mat });
  s.weather(-.67, 1.797, { dark: '26,28,14', light: '86,90,54', count: 260, alpha: .12, mat: OLIVE.mat });
  // Хвостовий відсік: стики, ряди заклепок, лючок з дальнього боку.
  for (const x of [-1.786, -1.45, -1.14, -.714, -.67]) s.seam(x);
  s.rivets(-1.463, 0, 1, 22); s.rivets(-1.437, 0, 1, 22); s.rivets(-1.14, 0, 1, 28); s.rivets(-.727, 0, 1, 34); s.rivets(-.7, 0, 1, 34);
  s.panel(-1.05, -.73, FAR - .07, FAR + .07);
  paintSaddle(s, { x: [.357, .692], win: [.413, .636], strap: [.513, .625], v: [.655, .72, .845, .6, .69] });
  for (const x of [.1, .385, .664]) s.dot(x, .5, .009, { color: '#8e9398', mat: [.3, .9], height: .8 });
  // Трафарети: блок написів між першим бандажем і сідлом та позначення біля носа з обох боків.
  const block = ['BOMB, GUIDED', label, filler, 'EXPLOSIVE: H-6', 'KIT: JDAM-ER', 'LOT  ____ - ____', 'CAUTION: HIGH EXPLOSIVE'];
  s.text(block, .15, .69, .021, '#d9b830');
  s.text(block, .15, .31, .021, '#d9b830', true);
  s.text([label], 1.3, .71, .05, '#dccb86');
  s.text([label], 1.3, .29, .05, '#dccb86', true);
  return s.material({ bumpScale: 1.4 });
}

function jdamEr(k, label, filler) {
  const g = new Group(), R = .23 * k, rb = jdamRadius(k);
  const skinMat = skin(`jdam-${k}`, () => jdamSkin(k, label, filler), paint(OLIVE.color, .64, .05));
  const alu = paint('#b9bdc1', .44, .8), kit = paint('#c3c7ca', .55, .25), dark = paint('#3a3f44', .5, .6);
  // Корпус окремими ділянками, щоб на стиках лишалися чіткі грані.
  g.add(lathe([[0, -2.03], [.028 * k, -2.03], [.044 * k, -2.024], [.05 * k, -2.012], [.05 * k, -1.968], [.066 * k, -1.964], [.072 * k, -1.958], [.072 * k, -1.79], [.078 * k, -1.786]], skinMat, { span: JDAM_SPAN }));
  g.add(lathe([[.078 * k, -1.786], ...sample(rb, -1.78, -.705, .03), [R * 1.012, -.7], [R * 1.012, -.672], [R, -.668]], skinMat, { span: JDAM_SPAN, segments: 64 }));
  g.add(lathe([[R, -.668], [R, .75], ...sample(rb, .77, 1.92, .025)], skinMat, { span: JDAM_SPAN, segments: 64 }));
  const f = .065 * k, fx = 1.965;
  g.add(lathe([[.075 * k, 1.921], [.07 * k, 1.923], [.07 * k, 1.938], [f, 1.945], ...Array.from({ length: 9 }, (_, i) => {
    const a = (i + 1) / 9 * Math.PI / 2;
    return [f * Math.cos(a), fx + f * Math.sin(a)];
  })], skinMat, { span: JDAM_SPAN, segments: 40 }));
  // Стабілізатори «іксом»: пряма задня кромка, похила передня.
  g.add(finSet([[-1.924, .058 * k], [-1.924, .31 * k], [-1.664, .31 * k], [-1.5, .085 * k], [-1.5, .058 * k]], .018, alu));
  // Рейка на хвостовому відсіку.
  const railTop = x => rb(x) + .012 * k;
  const rail = plate([...sample(railTop, -.88, -.24, .04).map(([y, x]) => [x, y]), [-.22, railTop(-.24) - .004], [-.22, R - .03], [-.88, rb(-.88) - .02]], .058 * k, alu);
  g.add(rail, at(new Mesh(new CylinderGeometry(.022 * k, .022 * k, .012, 16), alu), -.26, railTop(-.26) + .004, 0));
  // Бандажі й вушка підвіски.
  const strap = paint(STRAP.color, .38, .85);
  g.add(band(rb, -.194, -.123, strap), band(rb, .815, .904, strap));
  g.add(lug(-.045, R, strap), lug(.763, rb(.763), strap));
  for (const x of [-.158, .569, .86]) {
    for (const psi of [.38, Math.PI - .38]) g.add(patch(x, rb(x), psi, [.075, .08 * k, .012], strap));
  }
  // Обтічник механізму крил: дві бічні рейки ззаду й глибший носок спереду.
  const top = -.094 * k, deep = .34 * k, half = .227 * k;
  const nose = x => Math.min(Math.max((x - .95) / .52, 0), 1);
  const xs = sample(() => 0, .6, 1.47, .03).map(p => p[1]);
  g.add(loft(xs, x => {
    const s = nose(x), a = Math.min(half, rb(x) - .003) * Math.sqrt(Math.max(1 - Math.pow(s, 1.8), 0));
    return podSection(rb, top, a, deep - (deep - .15 * k) * Math.pow(s, 2.2), x);
  }, kit));
  for (const side of [1, -1]) {
    const railMesh = plate([[-.41, -.235 * k], [.64, -.235 * k], [.64, top], [-.35, top], [-.41, -.16 * k]], .1 * k, kit);
    railMesh.position.z = side * .177 * k;
    g.add(railMesh);
  }
  for (const z of [.09, -.09]) g.add(at(new Mesh(new CylinderGeometry(.024 * k, .024 * k, .012, 20), dark), .786, -deep - .002, z * k));
  // Крила складено «ножицями» під рейками; вісь повороту в носку обтічника, розкриваються на ~52° від осі
  // (розмах ≈ 0,86 довжини, як на рендері з білим підривником).
  const L = 2.076, cl = .12 * k, root = .34 * k, tipC = .19 * k;
  const planform = side => [[.05, cl], [-L + .12, cl], [-L, cl - tipC], [-.03, cl - root], [.05, cl - root + .06]].map(([x, z]) => [x, z * side]);
  const wingSkinMat = skin('jdam-wing', () => wingSkin('#c6cacd'), kit);
  const wings = [1, -1].map((side, i) => {
    const mesh = wingPlate(planform(side), .02, wingSkinMat);
    mesh.position.set(.786, -.235 * k - .013 - i * .024, side * .09 * k);
    g.add(mesh);
    return [mesh, side * .9];
  });
  return { group: castShadows(g), wings };
}

// Розгортка крила: шви панелей, заклепки, болти кріплення біля осі повороту, потертості.
function wingSkin(base) {
  const w = 1024, h = 256, c = canvas(w, h), x = c.getContext('2d'), rnd = random(11);
  const b = canvas(w, h).getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  b.fillStyle = '#808080'; b.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    const px = rnd() * w, py = rnd() * h, rad = 6 + rnd() * 40, a = .03 + rnd() * .07, dark = rnd() < .7;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, dark ? `rgba(70,72,74,${a})` : `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  const line = (pts, closed) => {
    for (const [ctx, style] of [[x, 'rgba(30,32,34,.45)'], [b, 'rgb(60,60,60)']]) {
      ctx.strokeStyle = style; ctx.lineWidth = 1.6; ctx.beginPath();
      pts.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](px * w, py * h));
      if (closed) ctx.closePath();
      ctx.stroke();
    }
  };
  line([[.36, .18], [.8, .18], [.8, .34], [.36, .34]], true);
  line([[.2, .1], [.3, .1], [.3, .52], [.2, .52]], true);
  const bolt = (px, py, r) => {
    x.fillStyle = 'rgba(40,42,44,.6)'; x.beginPath(); x.arc(px * w, py * h, r * 1.4, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(210,214,218,.9)'; x.beginPath(); x.arc(px * w, py * h, r, 0, Math.PI * 2); x.fill();
    b.fillStyle = '#d0d0d0'; b.beginPath(); b.arc(px * w, py * h, r, 0, Math.PI * 2); b.fill();
  };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) bolt(.905 + j * .03, .45 + i * .15, 5);
  for (const px of [.4, .5, .6, .7]) bolt(px, .26, 2.2);
  for (const py of [.2, .3, .42]) bolt(.25, py, 2.2);
  return new MeshStandardMaterial({ color: '#ffffff', roughness: .52, metalness: .3, map: texture(c, { srgb: true }), bumpMap: texture(b.canvas), bumpScale: 1 });
}

// ------------------------------------------------------------------ GBU-62: JDAM-ER з чорним ковпаком
// За кресленнями GBU-62: корпус Mk 82 (радіус .205), світлий хвостовий відсік з овальними лючками й роз'ємом,
// сідло з вікном, жовтий пояс і тонкий бандаж на носі, чорний ковпак. Знизу обтічник-«лінза» з широкою
// плитою повороту; короткі широкі крила розходяться від плити назад приблизно на 27°.
const G62_R = .205, G62_SPAN = [-2.02, 2.03];
const PAINTED_ALU = { color: '#c3c7cb', mat: [.5, .55], height: .5 };

function g62Radius(x) {
  const R = G62_R;
  if (x < -1.45) return .1;
  if (x < -.45) return .1 + (R - .1) * (1 - Math.pow(-.45 - x, 1.25));
  if (x < .84) return R;
  return R * (1 - .454 * Math.pow(Math.min((x - .84) / .93, 1), 1.2));
}

function g62Skin() {
  const s = new Skin(G62_SPAN, G62_R, 162);
  s.rect(-2.1, -.45, 0, 1, PAINTED_ALU);
  s.rect(-.45, 2.1, 0, 1, OLIVE);
  s.rect(1.38, 1.45, 0, 1, YELLOW);
  s.streaks(-2.02, -.45, 160);
  s.weather(-2.02, -.45, { dark: '96,100,104', light: '250,250,250', count: 80, alpha: .1, mat: PAINTED_ALU.mat });
  s.weather(-.45, 1.77, { dark: '26,28,14', light: '86,90,54', count: 240, alpha: .12, mat: OLIVE.mat });
  // Хвостовий відсік: стики з заклепками й по два овальні лючки з кожного боку.
  for (const x of [-1.84, -1.45, -.45]) s.seam(x);
  s.rivets(-1.465, 0, 1, 20); s.rivets(-1.435, 0, 1, 20); s.rivets(-.51, 0, 1, 32);
  for (const v of [NEAR, FAR]) { s.panel(-1.1, -.96, v - .1, v + .1, .06); s.panel(-.66, -.53, v - .09, v + .09, .06); }
  paintSaddle(s, { x: [.02, .54], win: [.12, .45], strap: [.2, .32], v: [.64, .8, .86, .62, .73] });
  for (const x of [-.1, .62]) {
    s.dot(x, .5, .02, { color: '#9aa0a5', mat: [.32, .85], height: .7 });
    s.rect(x - .013, x + .013, .497, .503, { color: 'rgba(30,32,34,.7)', height: .4 });
  }
  const block = ['BOMB, GUIDED  GBU-62/B', 'MK 82  500 LB', 'EXPLOSIVE: H-6', 'KIT: JDAM-ER', 'LOT  ____ - ____', 'CAUTION: HIGH EXPLOSIVE'];
  s.text(block, .9, .69, .022, '#d9b830');
  s.text(block, .9, .31, .022, '#d9b830', true);
  return s.material({ bumpScale: 1.4 });
}

function gbu62() {
  const g = new Group(), R = G62_R, rb = g62Radius;
  const skinMat = skin('g62', g62Skin, paint(OLIVE.color, .64, .05));
  const alu = paint('#c4c8cc', .5, .55), kit = paint('#cdd0d3', .55, .25), strap = paint(STRAP.color, .38, .85);
  const black = paint('#17191b', .3, .15), dark = paint('#2c2f33', .5, .5);
  // Чорне кільце на хвості, штанга стабілізаторів, конус хвостового відсіку, корпус.
  g.add(lathe([[0, -2.02], [.08, -2.02], [.093, -2.012], [.093, -1.97], [.097, -1.965]], black, { segments: 40 }));
  g.add(lathe([[.093, -1.965], [.1, -1.96], [.1, -1.45], ...sample(rb, -1.44, -.46, .03), [R * 1.01, -.455], [R * 1.01, -.448], [R, -.445], [R, .84], ...sample(rb, .86, 1.77, .025)], skinMat, { span: G62_SPAN, segments: 64 }));
  // Ніс: сріблясте кільце й чорний ковпак.
  const rn = rb(1.77), d = .1;
  g.add(lathe([[rn - .002, 1.77], [rn + .006, 1.775], [rn + .006, 1.822], [rn - .004, 1.83]], strap, { segments: 48 }));
  g.add(lathe([[rn - .004, 1.83], [d, 1.835], [d, 1.93], ...Array.from({ length: 10 }, (_, i) => {
    const a = (i + 1) / 10 * Math.PI / 2;
    return [d * Math.cos(a), 1.93 + d * Math.sin(a)];
  })], black, { segments: 48 }));
  // Стабілізатори «іксом» з темними накладками приводу.
  const finGroup = finSet([[-1.86, .07], [-1.86, .31], [-1.72, .31], [-1.45, .105], [-1.45, .07]], .018, alu);
  for (const fin of finGroup.children) fin.add(at(new Mesh(new BoxGeometry(.06, .05, .026), dark), -1.64, .15, 0));
  g.add(finGroup);
  // Роз'єм зверху на стику, штир знизу.
  g.add(at(new Mesh(new BoxGeometry(.2, .03, .08), alu), -.56, rb(-.56) + .01, 0));
  g.add(at(new Mesh(new CylinderGeometry(.022, .024, .03, 16), paint('#6b2a22', .45, .2)), -.48, rb(-.48) + .035, 0));
  g.add(at(new Mesh(new CylinderGeometry(.011, .011, .07, 10), alu), -1.2, -rb(-1.2) - .03, 0));
  // Бандажі, пряжки, вушка.
  g.add(band(rb, .54, .6, strap), band(rb, 1.2, 1.245, strap, .005));
  g.add(lug(.21, R, strap), lug(.75, R, strap));
  for (const psi of [.55, Math.PI - .55]) for (const x of [.26, .57]) g.add(patch(x, R, psi, [.07, .075, .012], strap));
  g.add(patch(1.222, rb(1.222), -.35, [.04, .035, .016], strap));
  // Обтічник-«лінза»: найглибший посередині, на кінцях ховається в корпус.
  const top = -.3 * R, x0 = -.75, x1 = 1.12;
  const lens = x => Math.sin(Math.PI * Math.min(Math.max((x - x0) / (x1 - x0), 0), 1));
  g.add(loft(sample(() => 0, x0, x1, .03).map(p => p[1]), x => {
    const k = lens(x);
    return podSection(rb, top, Math.min(.94 * R, rb(x) - .004) * Math.pow(k, .35), R * (.5 + .72 * Math.pow(k, .5)), x, .7);
  }, kit, { capStart: false }));
  g.add(rod([.92, -rb(.92) - .02, 0], [1.72, -rb(1.72) - .018, 0], .018, kit));
  // Плита повороту крил ширша за корпус, на ній два болти-осі.
  const plateY = -1.17 * R - .015;
  g.add(at(new Mesh(new BoxGeometry(.35, .03, .5), kit), .335, plateY, 0));
  for (const z of [.14, -.14]) g.add(at(new Mesh(new CylinderGeometry(.03, .03, .01, 20), dark), .37, plateY - .017, z));
  const L = 1.2, cl = .08, c = .27;
  const planform = side => [[.07, cl], [-L + .03, cl], [-L, cl - .05], [-L + .02, cl - c], [-.02, cl - c], [.07, cl - c + .08]].map(([x, z]) => [x, z * side]);
  const wingMat = skin('g62-wing', () => wingSkin('#cdd0d3'), kit);
  const wings = [1, -1].map((side, i) => {
    const mesh = wingPlate(planform(side), .022, wingMat);
    mesh.position.set(.37, plateY - .027 - i * .025, side * .14);
    g.add(mesh);
    return [mesh, side * 1.1];
  });
  return { group: castShadows(g), wings };
}

// ------------------------------------------------------------------ GBU-39 SDB
// За рендерами GBU-39: темний корпус, чорний короб механізму знизу з табличками «NO LIFT ON WINGS»,
// крила Diamond Back з розкосами під корпусом, світлий гранований хвостовий відсік із вузькими
// стабілізаторами й тягами, D-подібні вушки згори, жовтий пояс і бронзовий наконечник.
const SDB_R = .205, SDB_BODY = [-.95, 2], SDB_TAIL = [-2.03, -.95];
const CHARCOAL = { color: '#3d4145', mat: [.56, .3], height: .5 };
const TAIL_GREY = { color: '#8f959a', mat: [.46, .68], height: .5 };

function sdbRadius(x) {
  const R = SDB_R;
  if (x < 1) return R;
  const rho = (R * R + 1) / (2 * R), d = Math.min(x - 1, 1);
  return Math.max(Math.sqrt(rho * rho - d * d) - (rho - R), 0);
}

// Гранований конус хвоста від стику (-1.25) до маточини (-1.9).
function sdbTailRadius(x) {
  return SDB_R * (.5 + .5 * Math.pow(1 - Math.min(Math.max((-1.25 - x) / .65, 0), 1), .8));
}

function sdbSkin() {
  const s = new Skin(SDB_BODY, SDB_R, 39);
  s.rect(-1, 2.1, 0, 1, CHARCOAL);
  s.streaks(-.95, 1.9, 140, .35);
  s.weather(-.95, 1.9, { dark: '22,24,26', light: '96,102,108', count: 200, alpha: .07, mat: CHARCOAL.mat });
  s.rect(1.1, 1.24, 0, 1, YELLOW);
  s.rect(1.9, 2.1, 0, 1, { color: '#b08a4e', mat: [.3, .92], height: .5 });
  s.seam(-.95);
  // Наліпка, «DO NOT ADJUST» біля переднього вушка, «NO LIFT» на носі.
  s.rect(-.62, -.4, .6, .7, { color: '#484d52', mat: [.6, .15], height: .52 });
  s.panel(-.62, -.4, .6, .7, .01);
  s.text(['DO NOT ADJUST'], .45, .62, .02, '#d4d7da');
  s.text(['DO NOT ADJUST'], .45, .38, .02, '#d4d7da', true);
  s.rect(1.46, 1.66, .71, .79, { color: '#8e9499', mat: [.5, .2], height: .52 });
  s.text(['NO LIFT'], 1.56, .75, .024, '#1d2023');
  return s.material({ bumpScale: 1.2 });
}

function sdbTailSkin() {
  const s = new Skin(SDB_TAIL, SDB_R, 391);
  s.rect(-2.1, -.9, 0, 1, TAIL_GREY);
  s.streaks(-2.03, -.95, 90);
  s.weather(-2.03, -.95, { dark: '70,74,78', light: '220,224,228', count: 70, alpha: .1, mat: TAIL_GREY.mat });
  for (const x of [-1.25, -1.9]) s.seam(x);
  for (let i = 0; i < 8; i++) s.dot(-1.0, (i + .5) / 8, .008, { color: '#5d6166', mat: [.4, .8], height: .75 });
  // Напис на верхній ближній грані конуса (центр грані — v = 5.5/8) і дзеркально з дальнього боку.
  s.text(['NO LIFT', 'ON FINS'], -1.55, .6875, .028, '#2a2d30');
  s.text(['NO LIFT', 'ON FINS'], -1.55, .3125, .028, '#2a2d30', true);
  return s.material({ bumpScale: 1 });
}

function gbu39() {
  const g = new Group(), R = SDB_R, rb = sdbRadius;
  const skinMat = skin('sdb', sdbSkin, paint(CHARCOAL.color, .56, .3));
  const tailMat = skin('sdb-tail', sdbTailSkin, paint(TAIL_GREY.color, .46, .68));
  const facetMat = skin('sdb-tail-facets', () => { const m = tailMat.clone(); m.flatShading = true; return m; }, tailMat);
  const housingMat = paint('#1f2225', .55, .35), fin = paint('#9aa0a5', .45, .6), black = paint('#18191b', .35, .5);
  const dark = paint('#2b2e31', .5, .5), wingGrey = paint('#6e7479', .5, .35);
  // Корпус, світлий циліндричний пояс хвоста, гранований конус, маточина.
  g.add(lathe([[R * 1.01, -.95], [R, -.945], [R, 1], ...sample(rb, 1.02, 2, .02)], skinMat, { span: SDB_BODY, segments: 64 }));
  g.add(lathe([[R * .99, -1.25], [R, -1.24], [R, -.965], [R * 1.012, -.96], [R * 1.012, -.95]], tailMat, { span: SDB_TAIL, segments: 64 }));
  g.add(lathe(sample(sdbTailRadius, -1.9, -1.25, .05), facetMat, { span: SDB_TAIL, segments: 8 }));
  g.add(lathe([[0, -2], [.26 * R, -2], [.3 * R, -1.985], [.3 * R, -1.965], [.46 * R, -1.96], [.46 * R, -1.905], [.5 * R, -1.9]], dark, { segments: 32 }));
  // Приливи на стику й тяги стабілізаторів уздовж ребер конуса.
  for (let i = 0; i < 4; i++) {
    const turn = new Group();
    turn.rotation.x = Math.PI / 4 + i * Math.PI / 2;
    turn.add(at(new Mesh(new BoxGeometry(.1, .04, .07), fin), -1.215, R + .012, 0));
    turn.add(at(new Mesh(new CylinderGeometry(.011, .011, .012, 10), dark), -1.215, R + .036, 0));
    turn.add(rod([-1.24, R * .96 + .012, 0], [-1.88, R * .5 + .012, 0], .011, dark));
    g.add(turn);
  }
  g.add(at(new Mesh(new BoxGeometry(.2, .014, .15), paint('#8a5326', .45, .3)), -1.1, -R - .004, 0));
  g.add(finSet([[-1.975, .06], [-1.835, .06], [-1.885, .42], [-2.03, .42]], .012, fin));
  // Вушка підвіски.
  for (const x of [-.08, .72]) g.add(at(dRing(black), x, R - .006, 0), at(new Mesh(new BoxGeometry(.1, .01, .04), black), x, R, 0));
  // Короб механізму крил знизу: плоскі боки, спереду загинається під ніс.
  const top = -.15 * R, frontX = .85, endX = 1.42, deep = 1.3 * R;
  const front = x => Math.min(Math.max((x - frontX) / (endX - frontX), 0), 1);
  const depth = x => deep - (deep - .5 * R) * Math.pow(front(x), 1.4);
  g.add(loft(sample(() => 0, -.95, endX, .03).map(p => p[1]), x => {
    const a = Math.min(.98 * R, rb(x) - .004) * Math.sqrt(Math.max(1 - Math.pow(front(x), 3), 0));
    return podSection(rb, top, a, depth(x), x, .25);
  }, housingMat));
  for (const z of [.55 * R, -.55 * R]) g.add(at(new Mesh(new BoxGeometry(1.7, .008, .03), dark), -.08, -deep - .004, z));
  const blister = at(new Mesh(new SphereGeometry(1, 24, 12), black), 1.2, -depth(1.2), 0);
  blister.scale.set(.12, .05, .07);
  g.add(blister);
  for (const side of [1, -1]) {
    const sign = decal(['NO LIFT ON WINGS'], .36, .05);
    sign.position.set(.18, -.7 * R, side * (.98 * R + .002));
    if (side < 0) sign.rotation.y = Math.PI;
    g.add(sign);
  }
  // Крила з віссю в передній частині короба. Розкіс іде від повзуна в рейці короба до крила біля кінця:
  // довжина розкосу стала, тож повзун їде назад, поки крило розкривається.
  const PX = .75, PZ = .03, L = 1.95, c = .15, aL = .82 * L, Ls = 1.36, wingY = -deep - .013;
  const planform = side => [[.07, c / 2], [-L + .06, c / 2], [-L + .01, c / 2 - .03], [-L, 0], [-L, -c / 2], [.07, -c / 2]].map(([x, z]) => [x, z * side]);
  const wingMat = skin('sdb-wing', () => wingSkin('#6e7479'), wingGrey);
  const strutGeo = new BoxGeometry(Ls, .014, .08).translate(Ls / 2, 0, 0);
  const links = [];
  const wings = [1, -1].map((side, i) => {
    const mesh = wingPlate(planform(side), .02, wingMat);
    mesh.position.set(PX, wingY - i * .024, side * PZ);
    const mount = at(new Mesh(new BoxGeometry(.1, .04, .09), fin), -aL, -.03, 0);
    mount.name = 'strut-mount';
    mesh.add(mount);
    const strut = new Mesh(strutGeo, wingGrey);
    strut.name = 'strut';
    strut.position.y = wingY - .045 - i * .017;
    strut.userData.wing = mesh;
    strut.add(new Mesh(new BoxGeometry(.07, .02, .05), dark));
    g.add(mesh, strut);
    links.push({ wing: mesh, strut, side });
    return [mesh, side * .9];
  });
  const update = () => {
    for (const { wing, strut, side } of links) {
      const th = wing.rotation.y * side, wx = PX - aL * Math.cos(th), wz = side * (PZ + aL * Math.sin(th)), sz = side * PZ;
      const sx = wx + Math.sqrt(Math.max(Ls * Ls - (wz - sz) ** 2, 0));
      strut.position.set(sx, strut.position.y, sz);
      strut.rotation.y = Math.atan2(-(wz - sz), wx - sx);
    }
  };
  update();
  return { group: castShadows(g), wings, update };
}

// ------------------------------------------------------------------ AASM 250 HAMMER
// Розміри зняті з ортогонального листа (вигляд збоку, зверху, лопаті розкриті) і з розібраних рендерів: довжина
// 4,02 = 1150 пікселів листа, HM_X переводить частку довжини від носа в координату x моделі. Бомба струнка: діаметр
// корпусу ≈ 0,087 довжини. Складається з чотирьох модулів: носовий модуль наведення з розрізними стабілізаторами «Х»,
// чорне перехідне кільце, корпус Mk 82 з мідними вушками, стальними бандажами й чорною стрічкою кабелю та хвостовий
// модуль: циліндр із двома широкими плоскими пластинами й чотирма чорними лопатями, що лежать уздовж нього й
// розкриваються назовні хрестом. explode(k) розсуває модулі вздовж осі, як на розібраному рендері.
const HM_X = f => 2 - 4.02 * f;
const HM_RN = .14, HM_R = .1745, HM_RT = .1556, HM_RP = .336, HM_RF = .297;
const HM_NOSE = [HM_X(.235), 2], HM_COLLAR = [HM_X(.308), HM_X(.235)], HM_BODY = [HM_X(.735), HM_X(.308)], HM_TAIL = [-2.02, HM_X(.735)];
const HM_PIVOT = -1.09, HM_BLADE = .667, HM_BLADE_W = .147, HM_OPEN = 1.056;
const HM_LUGS = [HM_X(.45), HM_X(.565)], HM_DISC = HM_X(.483), HM_BANDS = [HM_X(.322), HM_X(.51), HM_X(.653)];
const HM_APART = { nose: .62, collar: .24, body: 0, tail: -.56 }, HM_LIFT = { loose: .4, small: .22 };
const HM_GREEN = { color: '#4b5f4b', mat: [.52, .12], height: .5 };
const HM_COPPER = { color: '#b8733a', mat: [.34, .85], height: .5 };
const HM_STENCIL = '#e8ebe6';

// Профіль корпусу Mk 82 [x, радіус]: шийка під кільцем, розширення до максимуму, спад до хвостового модуля.
const HM_PROFILE = [[.762, .1416], [.6935, .1416], [.633, .1486], [.553, .159], [.472, .1626], [.392, .1705], [.352, .1745],
  [-.452, .1745], [-.492, .1705], [-.573, .1626], [-.653, .159], [-.734, .152], [-.814, .1486], [-.955, .1486]];
function hmRadius(x) {
  const p = HM_PROFILE;
  if (x >= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (x >= p[i][0]) {
    const t = (p[i - 1][0] - x) / (p[i - 1][0] - p[i][0]);
    return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
  }
  return p[p.length - 1][1];
}
// Поверхня під стрічкою й бандажами: корпус, а перед ним чорне кільце.
const hmSurface = x => x > HM_BODY[1] ? HM_RN : hmRadius(x);

function hmBodySkin() {
  const s = new Skin(HM_BODY, HM_R, 252);
  s.rect(HM_BODY[0] - .05, HM_BODY[1] + .05, 0, 1, HM_GREEN);
  s.weather(HM_BODY[0], HM_BODY[1], { dark: '30,42,28', light: '132,98,62', count: 260, alpha: .07, mat: HM_GREEN.mat });
  s.seam(HM_BODY[1] - .008); s.seam(HM_BODY[0] + .008);
  // Трафарет: рядки впоперек корпусу між вушками підвіски, читаються знизу вгору з кожного боку.
  const block = ['S SAMP 19', '250 KG', 'MK 82', 'EXPL'];
  s.text(block, HM_X(.505), NEAR, .042, HM_STENCIL, false, -Math.PI / 2);
  s.text(block, HM_X(.505), FAR, .042, HM_STENCIL, true, -Math.PI / 2);
  // Гнізда під вушка й заглушку: видно, коли їх зняти.
  const hole = { color: '#101214', mat: [.7, .2], height: .12 };
  for (const [x, r] of [[HM_LUGS[0], .02], [HM_DISC, .028], [HM_LUGS[1], .02], [HM_X(.4), .009], [HM_X(.6), .009]]) s.dot(x, .5, r, hole);
  return s.material({ bumpScale: 1.1 });
}

function hmNoseSkin() {
  const s = new Skin(HM_NOSE, HM_RN, 251);
  s.rect(HM_NOSE[0] - .05, 2.05, 0, 1, HM_GREEN);
  s.weather(HM_NOSE[0], 2, { dark: '30,42,30', light: '160,176,156', count: 90, alpha: .06, mat: HM_GREEN.mat });
  s.seam(HM_X(.226)); s.seam(HM_X(.118));
  s.rivets(HM_X(.229), 0, 1, 22, .004);
  // Ряд отворів по боках нижче осі й кругла сталева заглушка.
  for (const v of [.184, .816]) for (let i = 0; i < 7; i++) s.dot(HM_X(.105 + i * .0195), v, .008, { color: '#101214', height: .1 });
  for (const v of [.735, .265]) s.dot(HM_X(.056), v, .022, { color: '#c8ccd0', mat: [.3, .85], height: .8 });
  return s.material({ bumpScale: 1.2 });
}

function hmTailSkin() {
  const s = new Skin(HM_TAIL, HM_RT, 250);
  s.rect(HM_TAIL[0] - .05, HM_TAIL[1] + .05, 0, 1, HM_GREEN);
  s.rect(-1.98, -1.92, 0, 1, HM_COPPER);
  s.weather(HM_TAIL[0], HM_TAIL[1], { dark: '34,46,32', light: '150,110,70', count: 80, alpha: .07, mat: HM_GREEN.mat });
  for (const x of [-1.2, -1.56, -1.8]) s.seam(x);
  s.rivets(-1.195, 0, 1, 22, .004); s.rivets(-1.795, 0, 1, 22, .004);
  for (const v of [NEAR, FAR]) s.panel(-1.5, -1.25, v - .06, v + .06, .03);
  return s.material({ bumpScale: 1.2 });
}

// Розгортка плоскої пластини: край накладки, лючок, болти по контуру.
function hmFinSkin(base, seed) {
  const w = 512, c = canvas(w, w), x = c.getContext('2d'), rnd = random(seed), b = canvas(w, w).getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, w, w);
  b.fillStyle = '#808080'; b.fillRect(0, 0, w, w);
  for (let i = 0; i < 80; i++) {
    const px = rnd() * w, py = rnd() * w, rad = 8 + rnd() * 40, a = .03 + rnd() * .06, dark = rnd() < .7;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, dark ? `rgba(40,52,38,${a})` : `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  const line = pts => {
    for (const [ctx, style] of [[x, 'rgba(24,30,24,.5)'], [b, 'rgb(60,60,60)']]) {
      ctx.strokeStyle = style; ctx.lineWidth = 1.6; ctx.beginPath();
      pts.forEach(([px, py], i) => ctx[i ? 'lineTo' : 'moveTo'](px * w, py * w));
      ctx.closePath(); ctx.stroke();
    }
  };
  line([[.06, .06], [.94, .06], [.94, .94], [.06, .94]]);
  line([[.16, .12], [.84, .12], [.84, .5], [.16, .5]]);
  const bolt = (px, py, r) => {
    x.fillStyle = 'rgba(30,34,30,.6)'; x.beginPath(); x.arc(px * w, py * w, r * 1.4, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(214,218,222,.9)'; x.beginPath(); x.arc(px * w, py * w, r, 0, Math.PI * 2); x.fill();
    b.fillStyle = '#d0d0d0'; b.beginPath(); b.arc(px * w, py * w, r, 0, Math.PI * 2); b.fill();
  };
  for (let i = 0; i < 9; i++) { const t = .1 + i * .1; bolt(t, .09, 2.4); bolt(t, .91, 2.4); }
  for (let i = 0; i < 7; i++) { const t = .18 + i * .1; bolt(.09, t, 2.4); bolt(.91, t, 2.4); }
  bolt(.5, .75, 7);
  return new MeshStandardMaterial({ color: '#ffffff', roughness: .52, metalness: .15, map: texture(c, { srgb: true }), bumpMap: texture(b.canvas), bumpScale: 1 });
}

// Торцева площина стику двох модулів: диск, обідок, ступиця, болти по колу й радіальні пази. dir = 1 дивиться
// вперед (+x), -1 — назад. Поки модулі зібрані, площини сховані всередині, а в розкладеному вигляді видно їх усі.
function hmMate(x, radius, dir, { face, rim, hub, bolt, bolts = 0, slots = 0, connector = null }) {
  const m = new Group(), shaft = mesh => { mesh.rotation.z = Math.PI / 2; return mesh; };
  m.position.x = x;
  const disc = new Mesh(new CircleGeometry(radius, 48), face);
  disc.rotation.y = dir * Math.PI / 2;
  m.add(disc, ring(dir * .002, radius - .007, .008, rim));
  m.add(at(shaft(new Mesh(new CylinderGeometry(radius * .3, radius * .3, .02, 32), hub)), dir * .01, 0, 0));
  if (connector) m.add(at(shaft(new Mesh(new CylinderGeometry(.016, .016, .018, 20), connector)), dir * .022, 0, 0));
  for (let i = 0; i < bolts; i++) {
    const a = i * 2 * Math.PI / bolts;
    m.add(at(shaft(new Mesh(new CylinderGeometry(.0065, .0065, .012, 12), bolt)), dir * .006, radius * .74 * Math.cos(a), radius * .74 * Math.sin(a)));
  }
  for (let i = 0; i < slots; i++) {
    const a = i * 2 * Math.PI / slots, rib = new Mesh(new BoxGeometry(.01, radius * .34, .016), rim);
    rib.rotation.x = a;
    m.add(at(rib, dir * .005, radius * .6 * Math.cos(a), radius * .6 * Math.sin(a)));
  }
  return m;
}

function aasm250() {
  const g = new Group(), nose = new Group(), collar = new Group(), body = new Group(), tail = new Group();
  // Що піднімається при розкладанні: бандажі зі стрічкою й роз'ємом; вушка із заглушкою.
  const loose = new Group(), small = new Group();
  g.add(nose, collar, body, tail);
  body.add(loose, small);
  const bodyMat = skin('hm-body', hmBodySkin, paint(HM_GREEN.color, .52, .12));
  const noseMat = skin('hm-nose', hmNoseSkin, paint(HM_GREEN.color, .5, .15));
  const tailMat = skin('hm-tail', hmTailSkin, paint(HM_GREEN.color, .52, .12));
  const noseFinMat = skin('hm-nose-fin', () => hmFinSkin('#6f826c', 5), paint('#6f826c', .5, .18));
  const plateMat = skin('hm-plate', () => hmFinSkin('#697c66', 6), paint('#697c66', .52, .15));
  const black = paint('#1b1e20', .3, .5), steel = paint('#c4c9cc', .32, .9), copper = paint(HM_COPPER.color, .34, .85);
  const yellow = paint('#e0b820', .45, .15), dark = paint('#25292c', .6, .3, { side: DoubleSide }), bladeMat = paint('#232628', .42, .4);
  const red = paint('#b3262a', .4, .1), face = paint('#15181a', .5, .35), mirror = paint('#c9ced2', .22, .95);

  // Корпус Mk 82: спереду гніздо підривника в жовтому кільці, ззаду мідне кільце стику з хвостовим модулем.
  body.add(lathe(sample(hmRadius, HM_BODY[0], HM_BODY[1], .02), bodyMat, { span: HM_BODY, segments: 64 }));
  body.add(hmMate(HM_BODY[1], .1416, 1, { face, rim: yellow, hub: copper, bolt: steel }));
  body.add(hmMate(HM_BODY[0], .1486, -1, { face, rim: copper, hub: copper, bolt: copper, bolts: 8 }));
  // Чорне перехідне кільце: порожній стакан, спереду з радіальними пазами, мідною ступицею й червоним роз'ємом.
  collar.add(lathe([[HM_RN, HM_COLLAR[0]], [HM_RN, HM_COLLAR[1]]], black, { segments: 64 }));
  collar.add(hmMate(HM_COLLAR[1], HM_RN, 1, { face, rim: paint('#3b4144', .4, .6), hub: copper, bolt: steel, slots: 12, connector: red }));
  collar.add(hmMate(HM_COLLAR[0], HM_RN, -1, { face, rim: steel, hub: black, bolt: steel }));
  // Носовий модуль: обтічник-еліпсоїд із круглим оптичним вікном, задній фланець стику.
  const ogive = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.min(i / 24, 1) * Math.acos(.06 / HM_RN);   // до радіуса вікна
    ogive.push([HM_RN * Math.cos(a), 1.538 + .5073 * Math.sin(a)]);
  }
  nose.add(lathe([[HM_RN, HM_NOSE[0]], [HM_RN + .007, HM_NOSE[0] + .002], [HM_RN + .007, HM_NOSE[0] + .045], [HM_RN, HM_NOSE[0] + .05],
    ...ogive.map(([r, x]) => [r, Math.min(x, 2)])], noseMat, { span: HM_NOSE, segments: 64 }));
  nose.add(hmMate(HM_NOSE[0], HM_RN, -1, { face, rim: steel, hub: steel, bolt: steel, bolts: 10 }));
  nose.add(ring(2, .058, .008, steel));
  const glass = new Mesh(new SphereGeometry(.052, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: '#1a1418', roughness: .06, metalness: .3 }));
  glass.scale.set(1, .4, 1); glass.rotation.z = -Math.PI / 2; glass.position.x = 1.998;
  nose.add(glass);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    nose.add(at(new Mesh(new SphereGeometry(.0055, 8, 6), steel), 2.006, .058 * Math.cos(a), .058 * Math.sin(a)));
  }
  // Носові стабілізатори «Х»: два розрізні ряди, задній із вертикальною кромкою біля фланця.
  const rf = HM_RN - .008;
  nose.add(finSet([[HM_X(.072), rf], [HM_X(.1246), HM_RF], [HM_X(.1768), HM_RF], [HM_X(.157), rf]], .016, noseFinMat));
  nose.add(finSet([[HM_X(.158), rf], [HM_X(.188), HM_RF], [HM_X(.223), HM_RF], [HM_X(.223), rf]], .016, noseFinMat));

  // Мідні вушка й жовта заглушка на верху корпусу; три сталеві бандажі й чорна стрічка кабелю з роз'ємом.
  for (const x of HM_LUGS) {
    small.add(at(new Mesh(new BoxGeometry(.09, .01, .05), copper), x, hmRadius(x) + .002, 0));
    small.add(at(dRing(copper, .07, .062, .016, .018), x, hmRadius(x) - .004, 0));
  }
  small.add(at(new Mesh(new CylinderGeometry(.036, .036, .01, 24), yellow), HM_DISC, hmRadius(HM_DISC) + .001, 0));
  for (const x of HM_BANDS) {
    loose.add(band(hmSurface, x - .011, x + .011, steel, .005));
    loose.add(at(new Mesh(new BoxGeometry(.04, .012, .02), black), x, hmSurface(x) + .009, 0));
  }
  const strip = xs => loft(xs, x => [-.02, 0, .02].map(z => [z, Math.sqrt(Math.max(hmSurface(x) ** 2 - z * z, 0)) + .007]),
    paint('#141618', .55, .1, { side: DoubleSide }), { capStart: false });
  loose.add(strip(Array.from({ length: 91 }, (_, i) => -.9 + i * .02)));
  loose.add(at(new Mesh(new CylinderGeometry(.014, .014, .012, 20), red), -.9, hmRadius(-.9) + .008, 0));
  // Плата роз'єму на початку хвостового модуля: чорна, на чотирьох болтах.
  loose.add(at(new Mesh(new BoxGeometry(.19, .012, .06), black), -1.12, HM_RT + .004, 0));
  for (const dx of [-.07, .07]) for (const dz of [-.02, .02])
    loose.add(at(new Mesh(new CylinderGeometry(.005, .005, .006, 12), steel), -1.12 + dx, HM_RT + .012, dz));

  // Хвостовий модуль: оболонка, дзеркальний торець стику, сопло, дві широкі пластини й чотири лопаті.
  tail.add(lathe([[.13, HM_TAIL[0]], [.138, -1.98], [.1486, -1.94], [HM_RT, -1.8], [HM_RT, -1], [.1486, HM_TAIL[1]]], tailMat, { span: HM_TAIL, segments: 64 }));
  tail.add(hmMate(HM_TAIL[1], .1486, 1, { face: mirror, rim: black, hub: steel, bolt: steel, bolts: 8 }));
  tail.add(lathe([[0, -1.99], [.11, -1.99], [.13, HM_TAIL[0]]], dark, { segments: 64 }));
  const nozzle = new Mesh(new CylinderGeometry(.045, .045, .06, 32, 1, true), dark);
  nozzle.rotation.z = Math.PI / 2; nozzle.position.x = -1.99;
  tail.add(nozzle, ring(-2.02, .045, .006, steel));
  // Пластини лежать у площині 45°/225°: із боку й зверху вони виглядають однаково, як на ортогональному листі.
  const plate = [[HM_X(.735), .12], [HM_X(.735), .19], [HM_X(.745), HM_RP], [HM_X(.925), HM_RP], [HM_X(.95), .22], [HM_X(.95), .12]];
  tail.add(finSet(plate, .016, plateMat, { count: 2, offset: Math.PI / 4 }));

  // Чотири чорні лопаті «Х»: шарнір на початку хвостового модуля, у складеному вигляді стоять ребрами вздовж нього.
  // На діагоналях 135°/315° лопаті лежать у ребристих кожухах із чорним пазом.
  const wings = [];
  const planform = [[0, 0], [-HM_BLADE, 0], [-HM_BLADE, HM_BLADE_W * .55], [-HM_BLADE + .1, HM_BLADE_W], [-.03, HM_BLADE_W], [.03, HM_BLADE_W * .6]];
  for (let k = 0; k < 4; k++) {
    const holder = new Group();
    holder.position.set(HM_PIVOT, 0, 0);
    holder.rotation.x = (k * 2 + 1) * Math.PI / 4 - Math.PI / 2;
    holder.add(at(new Mesh(new BoxGeometry(.13, .05, .022), black), 0, 0, HM_RT + .004));
    if (k % 2) {
      holder.add(at(new Mesh(new BoxGeometry(.62, .05, .02), paint('#4a5c47', .5, .2)), -.31, 0, HM_RT + .006));
      holder.add(at(new Mesh(new BoxGeometry(.5, .012, .006), black), -.29, 0, HM_RT + .017));
    }
    const blade = wingPlate(planform, .016, bladeMat);
    blade.position.set(0, 0, HM_RT - .004);
    holder.add(blade);
    tail.add(holder);
    wings.push([blade, HM_OPEN]);
  }

  // Осьова пунктирна лінія, яку видно, коли модулі розсунуто, і підписи модулів для картки.
  const axis = new Line(new BufferGeometry().setFromPoints([new Vector3(-1, 0, 0), new Vector3(1, 0, 0)]),
    new LineDashedMaterial({ color: '#8fc2c2', dashSize: .035, gapSize: .03, transparent: true, opacity: 0, depthWrite: false }));
  axis.computeLineDistances();
  g.add(axis);
  const tag = (module, text, x, y, side) => {
    const anchor = new Object3D();
    anchor.position.set(x, y, 0);
    module.add(anchor);
    return { text, anchor, side };
  };
  const labels = [
    tag(nose, 'Носовий модуль наведення', 1.5, .3, 'up'),
    tag(collar, 'Перехідне кільце', .9, -HM_RN, 'down'),
    tag(body, 'Бойова частина Mk 82', -.1, -HM_R, 'down'),
    tag(tail, 'Хвостовий модуль', -1.4, -.24, 'down'),
    tag(loose, 'Кабель і бандажі', -.3, hmSurface(-.3) + .03, 'up'),
  ];
  // k = 0 — бомба зібрана, k = 1 — модулі розсунуто. Лопаті розкриваються окремо й не залежать від k.
  const parts = { nose, collar, body, tail };
  const explode = k => {
    for (const name of Object.keys(parts)) parts[name].position.x = HM_APART[name] * k;
    loose.position.y = HM_LIFT.loose * k;
    small.position.y = HM_LIFT.small * k;
    axis.material.opacity = .55 * k;
    axis.scale.x = 2 + (HM_APART.nose - HM_APART.tail) * .5 * k;
    g.userData.tips = [1.95 + HM_APART.nose * k, -1.97 + HM_APART.tail * k];
  };
  explode(0);
  return { group: castShadows(g), wings, explode, labels };
}

// Кожна модель повертає групу, список крил [меш, кут розкриття] і, якщо треба, update() для розкосів.
const MODELS = {
  '62': gbu62,
  '64': () => jdamEr(1.17, 'GBU-64/B', 'MK 84  2000 LB'),
  '39': gbu39,
  '53': () => {
    const g = new Group(), r = .27;
    g.add(slenderBody({ r, noseLen: .3, color: 'grey', nose: 'dome' }));
    g.add(fins({ at: -1.98, root: .3, tip: .14, span: .22, base: r * .85, mat: material('grey'), offset: 0 }));
    const pair = wingPair({ pivotX: .35, length: 1.3, chord: .18, y: r + .03, deploy: 1.25, mat: material('white') });
    g.add(pair.group);
    return { group: castShadows(g), wings: pair.wings };
  },
  agm88: () => {
    const g = new Group(), r = .13;
    g.add(slenderBody({ r, noseLen: .75, color: 'white', noseColor: 'radome' }));
    g.add(ring(.9, r + .002, .012, material('dark')));
    g.add(fins({ at: -.1, root: .7, tip: .18, span: .32, sweep: .9, base: r * .95, mat: material('white') }));
    g.add(fins({ at: -1.98, root: .32, tip: .2, span: .22, base: r * .95, mat: material('white') }));
    return { group: castShadows(g), wings: [] };
  },
  aasm: aasm250,
  blu140: () => {
    const g = new Group();
    g.add(bombBody({ r: .24, tailR: .16, noseLen: 1.3, tailLen: .5, band: true }));
    g.add(fins({ at: -1.98, root: .42, tip: .2, span: .3, base: .16, mat: material('olive') }));
    return { group: castShadows(g), wings: [] };
  },
  c13: () => {
    const g = new Group(), r = .15;
    g.add(slenderBody({ r, noseLen: .45, color: 'olive', tailTaper: .02 }));
    g.add(ring(-1.99, r * .85, .025, material('steel')));
    g.add(fins({ at: -1.98, root: .32, tip: .22, span: .2, sweep: .8, base: r * .95, mat: material('steel'), thickness: .02 }));
    return { group: castShadows(g), wings: [] };
  },
  bomb: () => {
    const g = new Group();
    g.add(bombBody({ r: .32, tailR: .15, noseLen: 1.1, tailLen: .7, band: true, tailKit: 'olive' }));
    g.add(fins({ at: -1.98, root: .5, tip: .42, span: .3, sweep: .6, base: .15, mat: material('olive'), offset: 0 }));
    g.add(ring(-1.78, .45, .02, material('olive')));
    return { group: castShadows(g), wings: [] };
  },
};

export const KINDS = Object.keys(MODELS);
export function buildModel(kind) {
  return (MODELS[kind] || MODELS.bomb)();
}

// ------------------------------------------------------------------ сцена
let stage = null; // { renderer, scene, camera, holder, frame, run }
const backOut = t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// Модульна бомба розкладається циклічно: зібрана → 1,6 с розсувається → тримається розкладеною → 1,6 с збирається.
// Із 12 секунд циклу розкладеною вона проводить вісім, тож модулі видно й без очікування.
const EXPLODE = { start: 2.4, period: 12, open: 1.6, hold: 6.4, close: 8 };
const easeInOut = t => t * t * (3 - 2 * t);
export function explodeCycle(t) {
  if (t < EXPLODE.start) return 0;
  const c = (t - EXPLODE.start) % EXPLODE.period;
  if (c < EXPLODE.open) return easeInOut(c / EXPLODE.open);
  if (c < EXPLODE.hold) return 1;
  if (c < EXPLODE.close) return 1 - easeInOut((c - EXPLODE.hold) / (EXPLODE.close - EXPLODE.hold));
  return 0;
}

// Підписи модулів розкладеної бомби: якщо два підписи накладаються, той, що правіше, відсувається далі від деталі
// (вниз або вгору залежно від боку). Кожен елемент: { x, y, half, side }; додає йому extra — зайвий відступ у пікселях.
export function spreadLabels(boxes, height = 20, gap = 6) {
  const top = b => b.side === 'down' ? b.y + 12 + b.extra : b.y - 12 - b.extra - height;
  const placed = [];
  for (const b of [...boxes].sort((p, q) => p.x - q.x)) {
    b.extra = 0;
    for (let n = 0; n < 8 && placed.some(o => Math.abs(o.x - b.x) < o.half + b.half + gap && Math.abs(top(o) - top(b)) < height + gap); n++) b.extra += height + gap;
    placed.push(b);
  }
  return boxes;
}

function createStage() {
  const renderer = createRenderer();
  const scene = new Scene();
  addStageEnvironment(renderer, scene);
  const camera = new PerspectiveCamera(26, 2, .1, 60);
  const holder = new Group(); scene.add(holder);
  renderer.domElement.className = 'mw-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  return { renderer, scene, camera, holder, frame: 0, run: 0 };
}

function disposeGroup(group) {
  group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

// Показати модель у контейнері. Повертає false, якщо WebGL недоступний.
// Модель можна крутити, потягнувши вбік мишею чи пальцем.
export function mount(el, kind, { motion = true } = {}) {
  try { if (!stage) stage = createStage(); } catch { stage = null; return false; }
  const s = stage, run = ++s.run, canvasEl = s.renderer.domElement;
  cancelAnimationFrame(s.frame);
  for (const old of [...s.holder.children]) { s.holder.remove(old); disposeGroup(old); }
  const { group, wings, update, explode, labels = [] } = buildModel(kind);
  s.holder.add(group);
  el.prepend(canvasEl);
  const marks = ['nose', 'tail'].map(n => {
    const m = document.createElement('span'); m.className = 'mw-lock mw-lock-' + n; m.setAttribute('aria-hidden', 'true'); el.append(m); return m;
  });
  // Підписи модулів: мітки HTML, що їздять за модулями; видно лише коли модулі розсунуто й бомба повернута боком.
  const tags = labels.map(({ text, side }) => {
    const m = document.createElement('span');
    m.className = 'mw-part mw-part-' + side; m.textContent = text; m.setAttribute('aria-hidden', 'true'); el.append(m); return m;
  });
  let apart = 0;
  const alive = () => run === s.run && el.isConnected && !!el.closest('dialog[open]');
  const size = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    s.renderer.setSize(w, h, false);
    s.camera.aspect = w / h;
    // Уся модель з розкритими крилами має влазити навіть у вузьку картку.
    // Модульна бомба в розкладеному вигляді на чверть довша, тож камера відходить далі.
    const d = Math.max(5.6, 5.6 * 2.3 / s.camera.aspect) * (explode ? 1.16 : 1);
    s.camera.position.set(0, d * .44, d);
    s.camera.lookAt(0, -.25, 0);
    s.camera.updateProjectionMatrix();
  };
  const render = () => { place(); s.renderer.render(s.scene, s.camera); };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!alive()) { ro.disconnect(); return; }
    size();
    if (!motion) { pose(0); render(); }
  }) : null;
  if (ro) ro.observe(el);
  size();
  const tip = new Vector3(), tail = new Vector3(), spot = new Vector3();
  const put = (m, v, w, h) => {
    v.project(s.camera);
    m.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px'; m.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
  };
  const place = () => {
    const w = el.clientWidth, h = el.clientHeight;
    // Кінці розсунутої бомби зсуваються разом із модулями, тому моделі можуть віддати власні межі.
    const [noseX, tailX] = group.userData.tips || [LENGTH / 2 - .05, -LENGTH / 2 + .05];
    [[noseX, tip, marks[0]], [tailX, tail, marks[1]]].forEach(([x, v, m]) => { v.set(x, 0, 0); group.localToWorld(v); put(m, v, w, h); });
    // Вздовж осі модулі накладаються, тож підписи гаснуть, коли бомба повернута до глядача носом чи хвостом.
    const ramp = (v, from, span) => Math.min(Math.max((v - from) / span, 0), 1);
    const shown = ramp(Math.abs(Math.cos(group.rotation.y)), .4, .3) * ramp(apart, .4, .5);
    // Підпис не виходить за краї сцени, виносна лінія лишається на деталі, а сусідні підписи розводяться по вертикалі.
    const boxes = labels.map(({ anchor, side }, i) => {
      anchor.getWorldPosition(spot); spot.project(s.camera);
      const tag = tags[i], half = tag.offsetWidth / 2, px = (spot.x + 1) / 2 * w;
      return { tag, side, half, px, x: Math.min(Math.max(px, half + 4), Math.max(w - half - 4, half + 4)), y: (1 - spot.y) / 2 * h };
    });
    spreadLabels(boxes, tags[0]?.offsetHeight);
    for (const b of boxes) {
      b.tag.style.left = b.x.toFixed(1) + 'px'; b.tag.style.top = b.y.toFixed(1) + 'px';
      b.tag.style.setProperty('--lead', (b.px - b.x).toFixed(1) + 'px');
      b.tag.style.setProperty('--drop', b.extra + 'px');
      b.tag.style.opacity = shown.toFixed(2);
    }
  };
  let spin = 0;
  const pose = (t) => {
    group.rotation.y = (motion ? -.55 + t * .3 : -.6) + spin;
    group.position.y = motion ? Math.sin(t * 1.3) * .04 : 0;
    const k = motion ? Math.min(Math.max((t - 1.2) / 1.4, 0), 1) : 1;
    const open = k === 0 ? 0 : backOut(k);
    if (explode) { apart = motion ? explodeCycle(t) : 1; explode(apart); }
    for (const [mesh, angle] of wings) mesh.rotation.y = angle * open;
    if (update) update();
    group.updateMatrixWorld(true);
  };
  // Перетягування: горизонтальний рух повертає модель; вертикальний лишаємо прокрутці сторінки.
  let drag = null;
  el.style.touchAction = 'pan-y';
  el.onpointerdown = e => { if (run !== s.run) return; drag = { x: e.clientX, spin }; el.setPointerCapture?.(e.pointerId); el.classList.add('is-grab'); };
  el.onpointermove = e => {
    if (!drag || run !== s.run) return;
    spin = drag.spin + (e.clientX - drag.x) * .012;
    if (!motion) { pose(0); render(); }
  };
  el.onpointerup = el.onpointercancel = () => { drag = null; el.classList.remove('is-grab'); };
  const t0 = performance.now();
  const tick = now => {
    if (!alive()) { if (ro) ro.disconnect(); return; }
    pose((now - t0) / 1000); render();
    s.frame = requestAnimationFrame(tick);
  };
  if (motion) s.frame = requestAnimationFrame(tick);
  else { pose(0); render(); }
  return true;
}
