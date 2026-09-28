// Тривимірні умовні моделі боєприпасів для картки вильоту модуля «Повітряні Сили».
// GBU-62/64 (JDAM-ER) і GBU-39 зібрано детально за кресленнями: розгортку корпусу малюємо на канві
// (фарба, метал, шви, заклепки, трафарети, потертості), обтічник крила складено з перерізів.
// Решта боєприпасів складена з простих тіл обертання й пластин.
// Сцена одна на весь модуль: канва переноситься в нову картку, щоб не плодити контексти WebGL.
import {
  ACESFilmicToneMapping, BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry,
  DirectionalLight, ExtrudeGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PMREMGenerator, PolarGridHelper, RepeatWrapping, Scene, ShadowMaterial,
  Shape, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const LENGTH = 4; // довжина кожної моделі в умовних одиницях сцени
const HAS_DOM = typeof document !== 'undefined'; // модульні тести будують моделі в Node без канви
const COLORS = {
  olive: '#56592b', grey: '#a9afb6', white: '#c3c8ce', yellow: '#d9b310', steel: '#8d9299', fuze: '#e4e6e8',
  glass: '#1b2733', radome: '#e6dfca', dark: '#2a2f35',
};

// Детермінований генератор: потертості й заклепки щоразу ті самі.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function texture(source, { srgb = false, repeat = false } = {}) {
  const t = new CanvasTexture(source);
  t.flipY = false;
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
const paint = (() => {
  const cache = new Map();
  return (color, roughness, metalness, extra = {}) => {
    const key = [color, roughness, metalness, JSON.stringify(extra)].join('|');
    if (!cache.has(key)) cache.set(key, new MeshStandardMaterial({ color, roughness, metalness, map: grime(), ...extra }));
    return cache.get(key);
  };
})();

function material(name, extra = {}) {
  const metal = name === 'steel' || name === 'fuze' || name === 'grey';
  return paint(COLORS[name], metal ? .35 : .55, metal ? .6 : .2, extra);
}

// ------------------------------------------------------------------ розгортка корпусу
// Канва загортається навколо тіла обертання: x канви — уздовж осі (у координатах моделі),
// рядок — частка кола v: 0 низ, .25 дальній бік (−z), .5 верх, .75 ближній бік (+z), 1 знову низ.
const FAR = .25, NEAR = .75;

class Skin {
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
  panel(x0, x1, v0, v1) {
    const r = this.size(.018), w = this.size(.005);
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
  text(lines, x, v, size, color, flip = false) {
    const c = this.color, fs = this.size(size);
    c.save();
    c.translate(this.px(x), v * this.h); c.scale(1, this.aspect); if (flip) c.rotate(Math.PI);
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
  streaks(x0, x1, count) {
    for (let i = 0; i < count; i++) {
      const v = this.rnd(), len = .1 + this.rnd() * .6, x = x0 + this.rnd() * (x1 - x0 - len);
      const light = this.rnd() < .5, a = .04 + this.rnd() * .06;
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
function skin(key, build, fallback) {
  if (!HAS_DOM) return fallback;
  if (!skins.has(key)) skins.set(key, build());
  return skins.get(key);
}

// ------------------------------------------------------------------ геометрія
// Тіло обертання вздовж осі X: точки [радіус, x] від хвоста до носа. Шов розгортки — знизу.
// span — межі осі, на які натягнуто розгортку (u уздовж осі, v по колу).
function lathe(points, mat, { segments = 48, span } = {}) {
  const geometry = new LatheGeometry(points.map(([r, x]) => new Vector2(Math.max(r, 0), x)), segments, Math.PI / 2);
  geometry.rotateZ(-Math.PI / 2);
  if (span) {
    const pos = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - span[0]) / (span[1] - span[0]), uv.getX(i));
  }
  return new Mesh(geometry, mat);
}

// Точки профілю r(x) з рівним кроком на відрізку [x0, x1].
function sample(r, x0, x1, step = .02) {
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
function plate(points, thickness, mat) {
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

// Стабілізатори за точним контуром [x, радіус]; count штук навколо осі, починаючи з кута offset.
function finSet(points, thickness, mat, { count = 4, offset = Math.PI / 4 } = {}) {
  const group = new Group(), proto = plate(points, thickness, mat);
  for (let i = 0; i < count; i++) {
    const fin = new Mesh(proto.geometry, mat);
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

// Бандаж, що щільно облягає корпус із профілем r(x) між a і b.
function band(r, a, b, mat, lift = .007) {
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

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

function castShadows(group) {
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
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

// ------------------------------------------------------------------ GBU-62/64: JDAM-ER
// Мірки зняті з ортогонального креслення GBU-62 (корпус Mk 82, радіус .23 при довжині 4).
// Для GBU-64 (корпус Mk 84) усе поперечне масштабується коефіцієнтом k.
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
  // Сідло підвіски: рамка згори, що з боків сходиться в одну стрічку донизу, до обтічника.
  for (const m of [v => v, v => 1 - v]) {
    s.poly([[.357, m(.5)], [.692, m(.5)], [.692, m(.655)], [.625, m(.72)], [.625, m(.845)], [.513, m(.845)], [.513, m(.72)], [.357, m(.655)]], STRAP);
    s.poly([[.413, m(.5)], [.636, m(.5)], [.636, m(.6)], [.569, m(.69)], [.413, m(.6)]], OLIVE);
  }
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
  const sectionAt = (a, bottom, x) => {
    const zb = Math.max(Math.sqrt(Math.max(rb(x) ** 2 - top * top, 0)) - .004, 0), b = bottom + top, pts = [[zb, top]];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      pts.push([a * Math.sign(c) * Math.pow(Math.abs(c), .4), top - b * Math.pow(s, .4)]);
    }
    pts.push([-zb, top]);
    return pts;
  };
  const xs = sample(() => 0, .6, 1.47, .03).map(p => p[1]);
  g.add(loft(xs, x => {
    const s = nose(x), a = Math.min(half, rb(x) - .003) * Math.sqrt(Math.max(1 - Math.pow(s, 1.8), 0));
    return sectionAt(a, deep - (deep - .15 * k) * Math.pow(s, 2.2), x);
  }, kit));
  for (const side of [1, -1]) {
    const railMesh = plate([[-.41, -.235 * k], [.64, -.235 * k], [.64, top], [-.35, top], [-.41, -.16 * k]], .1 * k, kit);
    railMesh.position.z = side * .177 * k;
    g.add(railMesh);
  }
  for (const z of [.09, -.09]) g.add(at(new Mesh(new CylinderGeometry(.024 * k, .024 * k, .012, 20), dark), .786, -deep - .002, z * k));
  // Крила складено «ножицями» під рейками; вісь повороту в носку обтічника, розкриваються на ~19°.
  const L = 2.076, cl = .12 * k, root = .34 * k, tipC = .19 * k;
  const planform = side => [[.05, cl], [-L + .12, cl], [-L, cl - tipC], [-.03, cl - root], [.05, cl - root + .06]].map(([x, z]) => [x, z * side]);
  const wingSkinMat = skin('jdam-wing', () => wingSkin('#c6cacd'), kit);
  const wings = [1, -1].map((side, i) => {
    const mesh = wingPlate(planform(side), .02, wingSkinMat);
    mesh.position.set(.786, -.235 * k - .013 - i * .024, side * .09 * k);
    g.add(mesh);
    return [mesh, side * .33];
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

// ------------------------------------------------------------------ GBU-39 SDB
const SDB_SPAN = [-2, 2];
function sdbRadius(x) {
  const R = .215;
  if (x < -1.15) return R - .105 * Math.pow(1 - Math.min(Math.max((x + 1.97) / .82, 0), 1), 1.6);
  if (x < 1) return R;
  const rho = (R * R + 1) / (2 * R), d = Math.min(x - 1, 1);
  return Math.max(Math.sqrt(rho * rho - d * d) - (rho - R), 0);
}

function sdbSkin() {
  const s = new Skin(SDB_SPAN, .215, 39), GREY = { color: '#7a8187', mat: [.5, .42], height: .5 };
  s.rect(-2.1, 2.1, 0, 1, GREY);
  s.streaks(-2, 1.87, 120);
  s.weather(-2, 1.87, { dark: '52,56,60', light: '190,196,202', count: 230, alpha: .12, mat: GREY.mat });
  s.rect(1.44, 1.58, 0, 1, YELLOW);
  s.rect(1.87, 2.1, 0, 1, { color: '#a87a40', mat: [.3, .92], height: .5 });
  for (const x of [-1.15, -.32, .38, 1]) s.seam(x);
  s.rivets(-1.165, 0, 1, 30); s.rivets(-1.135, 0, 1, 30); s.rivets(1.012, 0, 1, 30);
  s.seamAlong(-1.15, 1, .5 + .16); s.seamAlong(-1.15, 1, .5 - .16);
  for (const v of [NEAR, FAR]) { s.panel(-.95, -.5, v - .06, v + .06); s.panel(.55, .85, v - .05, v + .05); }
  const lines = ['BOMB, GUIDED', 'GBU-39/B  SDB', '250 LB CLASS', 'LOT  ____ - ____'];
  s.text(lines, -.1, .79, .022, '#2a2f34');
  s.text(lines, -.1, .21, .022, '#2a2f34', true);
  s.text(['GBU-39/B'], 1.18, .7, .05, '#e2d59a');
  s.text(['GBU-39/B'], 1.18, .3, .05, '#e2d59a', true);
  return s.material({ bumpScale: 1.3 });
}

function gbu39() {
  const g = new Group(), R = .215, rb = sdbRadius;
  const skinMat = skin('sdb', sdbSkin, paint('#7a8187', .5, .42));
  const grey = paint('#7e858b', .5, .42), housing = paint('#6f767c', .5, .42), steel = paint('#aeb3b8', .38, .85);
  g.add(lathe([[0, -2], [.07, -2], [.095, -1.995], [.105, -1.985], ...sample(rb, -1.97, -1.16, .03), [R + .002, -1.155], [R + .002, -1.145], [R, -1.14], [R, 1], ...sample(rb, 1.02, 2, .02)], skinMat, { span: SDB_SPAN, segments: 64 }));
  g.add(finSet([[-1.99, .06], [-1.99, .4], [-1.78, .4], [-1.44, .15], [-1.44, .06]], .016, grey));
  const strakes = finSet([[-.77, R - .01], [1.11, R - .01], [1.02, R + .032], [-.7, R + .032]], .01, grey, { count: 2, offset: Math.PI / 2 });
  g.add(strakes);
  // Корпус механізму Diamond Back зверху; на ньому складені крила й вушка підвіски.
  const hs = plate([[-1.11, .15], [1.17, .15], [1.17, .175], [1, .252], [-.98, .252], [-1.11, .196]], .2, housing);
  g.add(hs);
  g.add(lug(.42, .252, steel, .07), lug(-.2, .252, steel, .07));
  const L = 1.95, c = .075;
  const planform = side => [[.05, c], [-L + .12, c], [-L, -c], [.05, -c]].map(([x, z]) => [x, z * side]);
  const wingMat = skin('sdb-wing', () => wingSkin('#858c92'), grey);
  const wings = [1, -1].map((side, i) => {
    const mesh = wingPlate(planform(side), .014, wingMat);
    mesh.position.set(1.02, .261 + i * .016, 0);
    g.add(mesh);
    return [mesh, side * .95];
  });
  return { group: castShadows(g), wings };
}

// Кожна модель повертає групу і список крил [меш, кут розкриття].
const MODELS = {
  '62': () => jdamEr(1, 'GBU-62/B', 'MK 82  500 LB'),
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
  aasm: () => {
    const g = new Group(), r = .24;
    g.add(slenderBody({ r, noseLen: .7, color: 'grey', tailTaper: .25 }));
    g.add(ring(-.2, r + .004, .02, material('steel')), ring(.5, r + .004, .02, material('steel')));
    g.add(fins({ at: 1.05, root: .18, tip: .1, span: .12, base: r * .95, mat: material('grey') }));
    g.add(fins({ at: -1.95, root: .4, tip: .18, span: .32, base: r * .7, mat: material('grey') }));
    return { group: castShadows(g), wings: [] };
  },
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

function contactTexture() {
  const c = canvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

const FLOOR_Y = -1.05;

function createStage() {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = .88;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  const scene = new Scene();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .65;
  const key = new DirectionalLight('#fff6ea', 2);
  key.position.set(1.8, 7, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 1, far: 16 });
  key.shadow.bias = -.0004; key.shadow.normalBias = .015; key.shadow.radius = 5;
  scene.add(key);
  const rim = new DirectionalLight('#8fc2c2', 1.1); rim.position.set(-5, 2.5, -4); scene.add(rim);
  const fill = new DirectionalLight('#dfe8f2', .35); fill.position.set(-3, -1, 5); scene.add(fill);
  const grid = new PolarGridHelper(6.5, 16, 7, 96, new Color('#5c8a8a'), new Color('#5c8a8a'));
  grid.material.transparent = true; grid.material.opacity = .22; grid.position.y = FLOOR_Y; scene.add(grid);
  const floor = new Mesh(new CircleGeometry(6.5, 64), new MeshBasicMaterial({ color: '#07090b', transparent: true, opacity: .55 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y - .01; scene.add(floor);
  const catcher = new Mesh(new CircleGeometry(6.5, 64), new ShadowMaterial({ color: '#000000', opacity: .5 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = FLOOR_Y + .002; catcher.receiveShadow = true; scene.add(catcher);
  const contact = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = FLOOR_Y + .004; contact.scale.set(2.6, 1, 1); scene.add(contact);
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
  const { group, wings } = buildModel(kind);
  s.holder.add(group);
  el.prepend(canvasEl);
  const marks = ['nose', 'tail'].map(n => {
    const m = document.createElement('span'); m.className = 'mw-lock mw-lock-' + n; m.setAttribute('aria-hidden', 'true'); el.append(m); return m;
  });
  const alive = () => run === s.run && el.isConnected && !!el.closest('dialog[open]');
  const size = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    s.renderer.setSize(w, h, false);
    s.camera.aspect = w / h;
    // Уся модель з розкритими крилами має влазити навіть у вузьку картку.
    const d = Math.max(5.6, 5.6 * 2.3 / s.camera.aspect);
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
  const tip = new Vector3(), tail = new Vector3();
  const place = () => {
    const w = el.clientWidth, h = el.clientHeight;
    [[LENGTH / 2 - .05, tip, marks[0]], [-LENGTH / 2 + .05, tail, marks[1]]].forEach(([x, v, m]) => {
      v.set(x, 0, 0); group.localToWorld(v); v.project(s.camera);
      m.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px'; m.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
    });
  };
  let spin = 0;
  const pose = (t) => {
    group.rotation.y = (motion ? -.55 + t * .3 : -.6) + spin;
    group.position.y = motion ? Math.sin(t * 1.3) * .04 : 0;
    const k = motion ? Math.min(Math.max((t - 1.2) / 1.4, 0), 1) : 1;
    const open = k === 0 ? 0 : backOut(k);
    for (const [mesh, angle] of wings) mesh.rotation.y = angle * open;
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
