// Обертові частини моделей «Інтерактивної моделі» довідника: несні й хвостові гвинти вертольотів, повітряні гвинти й колеса
// літаків. Моделі зі збірок злиті в кілька великих мешів, тож лопаті, маточини й колеса тут вирізають за місцем (ref-mesh.js)
// і чіпляють до власних осей — так само, як кран і сошники в ref-crane.js. Побудова (buildSpinRig) іде один раз на модель: після
// неї модель у спокої виглядає як у файлі до вершини, а SpinRig крутить вирізане. Гвинт крутиться за обертами двигуна (rpm 0…1),
// лопаті несного гвинта піднімаються з провису до конусності, коли гвинт набирає оберти, а колесо крутиться за шляхом по землі.
// Області вирізання задано в системі сцени файлу (метри файлу, вертикаль — y), див. SPINS у ref-rig-data.js.
import { Box3, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { D2R, canvasTexture, ease, smooth } from './ref-fx.js';
import { SPIN_PLANE, attach, bakeToRoot, carve, componentVertices, componentsIn, componentsInCylinder, labelsOfComponents, triangleComponents } from './ref-mesh.js';

const AXIS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const UP = new Vector3(0, 1, 0);
const FORWARD = { '+x': new Vector3(1, 0, 0), '-x': new Vector3(-1, 0, 0), '+z': new Vector3(0, 0, 1), '-z': new Vector3(0, 0, -1) };
const PAD = .012;
const TAU = Math.PI * 2;
const dec = o => { o.userData.decal = true; return o; };

// Швидкість обертання за замовчуванням (рад/с при повних обертах).
export const SPIN_RATE = { rotor: 21, tail: 42, prop: 46 };
// Стробоскопічний ефект: коли за кадр лопать проходить більше, ніж пів кроку між сусідніми лопатями, гвинт здається таким, що
// стоїть чи крутиться назад. Тому за кадр гвинт повертається не більше ніж на SAFE_STEP кроку між лопатями (при 60 кадрах/с
// це не заважає, при 20–30 гвинт крутиться повільніше, але вперед), а колесо — не більше ніж на WHEEL_FRAME радіан.
const SAFE_STEP = .4;
const WHEEL_FRAME = .5;
// Найшвидше колесо (рад/с): умовні швидкості сцени завищені, і справжня кутова швидкість дала б мигтіння.
export const WHEEL_MAX = 30;

// Прозорий диск розмитих лопатей: світліший обід, майже прозорий центр. Однаковий у всі боки, тож диску байдуже, як він повернутий.
export function blurTexture() {
  return canvasTexture(256, 256, (x) => {
    const c = 128, g = x.createRadialGradient(c, c, 6, c, c, c);
    g.addColorStop(0, 'rgba(34,34,34,0)'); g.addColorStop(.18, 'rgba(34,34,34,.1)'); g.addColorStop(.86, 'rgba(46,46,46,.2)');
    g.addColorStop(.96, 'rgba(205,205,205,.34)'); g.addColorStop(1, 'rgba(205,205,205,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  });
}

// Статистика лопаті з її вершин verts = [x, y, z, …]: hub — центр гвинта [u, v] у площині, перпендикулярній до осі axis.
// Повертає найближчу й найдальшу відстань від осі, осьові висоти кореня й кінця, напрям лопаті d (одиничний, у площині) і
// кут підйому rest кінця над коренем (рад; від'ємний — лопать провисла).
export function bladeStats(verts, hub, axis) {
  const [u, v, a] = SPIN_PLANE[axis], n = verts.length / 3;
  let lo = Infinity, hi = -Infinity;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dist[i] = Math.hypot(verts[i * 3 + u] - hub[0], verts[i * 3 + v] - hub[1]);
    if (dist[i] < lo) lo = dist[i];
    if (dist[i] > hi) hi = dist[i];
  }
  const span = hi - lo, rootCut = lo + span * .12, tipCut = hi - span * .1;
  let rn = 0, tn = 0, ra = 0, ta = 0, tu = 0, tv = 0;
  for (let i = 0; i < n; i++) {
    if (dist[i] <= rootCut) { rn++; ra += verts[i * 3 + a]; }
    if (dist[i] >= tipCut) { tn++; ta += verts[i * 3 + a]; tu += verts[i * 3 + u]; tv += verts[i * 3 + v]; }
  }
  ra /= rn; ta /= tn; tu = tu / tn - hub[0]; tv = tv / tn - hub[1];
  const len = Math.hypot(tu, tv) || 1;
  return { rootR: lo, tipR: hi, rootAxial: ra, tipAxial: ta, d: [tu / len, tv / len], rest: Math.atan2(ta - ra, Math.max(span, 1e-6)) };
}

// Точка (u, v, a) плоскої системи гвинта → [x, y, z] у системі сцени.
export function fromPlane(axis, u, v, a) {
  const p = [0, 0, 0], k = SPIN_PLANE[axis];
  p[k[0]] = u; p[k[1]] = v; p[k[2]] = a;
  return p;
}

// Об’єм, у якому лежить усе, що вирізає заявка: циліндр гвинта чи коробка коліс.
function boundsOf(part) {
  const lo = [0, 0, 0], hi = [0, 0, 0];
  if (part.kind === 'wheels') { for (let k = 0; k < 3; k++) { lo[k] = part.box[k]; hi[k] = part.box[3 + k]; } }
  else {
    const [u, v, a] = SPIN_PLANE[part.axis];
    lo[u] = part.c[0] - part.r; hi[u] = part.c[0] + part.r;
    lo[v] = part.c[1] - part.r; hi[v] = part.c[1] + part.r;
    lo[a] = part.band[0]; hi[a] = part.band[1];
  }
  return new Box3(new Vector3(...lo).addScalar(-PAD), new Vector3(...hi).addScalar(PAD));
}

// Колеса: тіла в коробці box, що мають кругле коло в площині, перпендикулярній до осі, і тонкі вздовж неї.
function wheelIds(info, part) {
  const [u, v, a] = SPIN_PLANE[part.axis], [tmin, tmax] = part.tris || [0, Infinity], round = part.round ?? .3, thin = part.thin ?? 1.3;
  const out = [], b = info.comp.box;
  for (const i of componentsIn(info.comp, part.box, PAD)) {
    const o = i * 6, t = info.comp.tris[i], du = b[o + 3 + u] - b[o + u], dv = b[o + 3 + v] - b[o + v], da = b[o + 3 + a] - b[o + a];
    if (t < tmin || t > tmax) continue;
    if (Math.abs(du - dv) > round * Math.max(du, dv)) continue;
    if (da > thin * Math.max(du, dv)) continue;
    out.push(i);
  }
  return out;
}

// Вирізає з мешів моделі все, що крутиться, і складає групи вузлів; null, якщо чогось у моделі не знайдено (why — необов’язковий
// масив: у нього потрапляють назви заявок, що нічого не знайшли). Після побудови всі групи в нулі, лопаті лежать як у файлі.
export function buildSpinRig(scene, spec, why = []) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse(o => { if (o.isMesh && !o.userData.decal && o.geometry && o.geometry.attributes.position && o.geometry.groups.length < 2) meshes.push(o); });
  const toScene = scene.matrixWorld.clone().invert();
  const infos = new Map();
  // Меш береться в роботу, лише якщо його об’єм зачіпає область заявки; тоді його геометрія переходить у систему сцени.
  const infoOf = (mesh, bounds) => {
    if (infos.has(mesh)) return infos.get(mesh);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(toScene.clone().multiply(mesh.matrixWorld));
    if (!box.intersectsBox(bounds)) return null;
    bakeToRoot(mesh, scene);
    const info = { mesh, comp: triangleComponents(mesh.geometry), claimed: new Set() };
    infos.set(mesh, info);
    return info;
  };

  const forward = FORWARD[spec.nose || '+x'] || FORWARD['+x'];
  const jobs = [];
  let missing = false;
  for (const part of spec.parts) {
    const bounds = boundsOf(part), found = [];
    for (const mesh of meshes) {
      const info = infoOf(mesh, bounds);
      if (!info) continue;
      const ids = (part.kind === 'wheels' ? wheelIds(info, part) : componentsInCylinder(info.comp, part, PAD)).filter(i => !info.claimed.has(i));
      if (ids.length) found.push({ info, ids });
    }
    if (!found.length) { why.push(part.id + ':область'); missing = true; continue; }
    for (const f of found) for (const i of f.ids) f.info.claimed.add(i);
    jobs.push({ part, found });
  }
  if (missing) return null;

  // Заявки → частини: лопаті несного гвинта окремо (вони хитаються), маточина разом, колесо — кожне своє.
  const pieces = [];
  for (const { part, found } of jobs) {
    if (part.kind === 'wheels') {
      for (const f of found) for (const i of f.ids) pieces.push({ part, kind: 'wheel', info: f.info, ids: [i] });
      continue;
    }
    const [u, v] = SPIN_PLANE[part.axis], flap = part.flap ?? part.kind === 'rotor';
    const extOf = (f, i) => { const b = f.info.comp.box, o = i * 6; return Math.hypot(b[o + 3 + u] - b[o + u], b[o + 3 + v] - b[o + v]); };
    let maxExt = 0;
    for (const f of found) for (const i of f.ids) maxExt = Math.max(maxExt, extOf(f, i));
    for (const f of found) {
      const hub = [], blades = [];
      for (const i of f.ids) (extOf(f, i) >= maxExt * .6 && extOf(f, i) >= part.r * .4 ? blades : hub).push(i);
      if (hub.length) pieces.push({ part, kind: 'hub', info: f.info, ids: hub });
      if (!blades.length) continue;
      if (flap) for (const i of blades) pieces.push({ part, kind: 'blade', info: f.info, ids: [i] });
      else pieces.push({ part, kind: 'blades', info: f.info, ids: blades });
    }
  }
  // Статистика лопатей — до розрізання, поки вершини в незміненій геометрії.
  for (const p of pieces) {
    if (p.kind !== 'blade' && p.kind !== 'blades') continue;
    const verts = componentVertices(p.info.mesh.geometry, p.info.comp, p.ids);
    p.stats = p.ids.map(i => bladeStats(verts.get(i), p.part.c, p.part.axis));
  }
  // Один виклик carve на меш: решта трикутників лишається в корпусі.
  for (const info of infos.values()) {
    const mine = pieces.filter(p => p.info === info);
    if (!mine.length) continue;
    const geos = carve(info.mesh, labelsOfComponents(info.comp, mine.map(p => p.ids)), mine.length);
    mine.forEach((p, k) => { p.geo = geos[k]; });
    if (mine.some(p => !p.geo)) return null;
  }

  // Групи вузлів. Вісь гвинта лежить у середині лопатей уздовж осі; без лопатей — у середині діапазону.
  const rig = new SpinRig();
  const spins = new Map();
  const spinOf = part => {
    if (spins.has(part)) return spins.get(part);
    const st = pieces.filter(p => p.part === part && p.stats).flatMap(p => p.stats);
    const axial = st.length ? st.reduce((s, b) => s + (b.rootAxial + b.tipAxial) / 2, 0) / st.length : (part.band[0] + part.band[1]) / 2;
    const pivot = fromPlane(part.axis, part.c[0], part.c[1], axial);
    const group = new Group(); group.name = 'spin-' + part.id; group.position.set(...pivot);
    scene.add(group);
    // n — скільки лопатей у гвинті (за ним рахується крок між лопатями); менше трьох — це злиті лопаті, беремо найчастіший випадок.
    const n = pieces.filter(p => p.part === part && (p.kind === 'blade' || p.kind === 'blades')).reduce((s, p) => s + p.ids.length, 0);
    const sp = {
      id: part.id, kind: part.kind, axis: part.axis, dir: part.dir || 1, rate: part.rate || SPIN_RATE[part.kind] || SPIN_RATE.rotor, group, pivot, angle: 0, n: Math.max(n, 3),
      blades: [], tip: st.length ? Math.max(...st.map(b => b.tipR)) : part.r, blur: part.blur ?? (part.kind === 'prop' ? .3 : .2), cone: (part.cone ?? 1.5) * D2R, disc: null,
    };
    rig.parts.push(sp);
    spins.set(part, sp);
    return sp;
  };
  for (const p of pieces) {
    const part = p.part, [u, v, a] = SPIN_PLANE[part.axis];
    if (p.kind === 'wheel') {
      const b = p.info.comp.box, o = p.ids[0] * 6, c = [0, 1, 2].map(k => (b[o + k] + b[o + 3 + k]) / 2);
      const g = new Group(); g.name = 'wheel-' + part.id; g.position.set(...c);
      scene.add(g);
      attach(g, p.info.mesh, p.geo, c);
      const dir = part.dir || Math.sign(forward.dot(AXIS[part.axis].clone().cross(UP))) || 1;
      rig.parts.push({ id: part.id, kind: 'wheel', axis: part.axis, dir, group: g, pivot: c, angle: 0, w: 0, r: Math.max(b[o + 3 + u] - b[o + u], b[o + 3 + v] - b[o + v]) / 2 });
      continue;
    }
    const sp = spinOf(part);
    if (p.kind !== 'blade') { attach(sp.group, p.info.mesh, p.geo, sp.pivot); continue; }
    // Лопать сидить у власній групі в корені й хитається навколо дотичної до кола гвинта.
    const st = p.stats[0], rootUV = [part.c[0] + st.d[0] * st.rootR, part.c[1] + st.d[1] * st.rootR];
    const root = fromPlane(part.axis, rootUV[0], rootUV[1], st.rootAxial);
    const holder = new Group(); holder.name = 'blade';
    holder.position.set(root[0] - sp.pivot[0], root[1] - sp.pivot[1], root[2] - sp.pivot[2]);
    sp.group.add(holder);
    attach(holder, p.info.mesh, p.geo, root);
    const d = new Vector3(); d.setComponent(u, st.d[0]); d.setComponent(v, st.d[1]);
    sp.blades.push({ holder, tangent: AXIS[part.axis].clone().cross(d).normalize(), rest: st.rest, i: sp.blades.length, a });
  }
  return rig;
}

export class SpinRig {
  constructor() { this.parts = []; this.t = 0; }

  get rotors() { return this.parts.filter(p => p.kind !== 'wheel'); }
  get wheels() { return this.parts.filter(p => p.kind === 'wheel'); }

  // Диски розмитих лопатей: по одному на гвинт, у площині, перпендикулярній до осі. tex — blurTexture().
  addBlur(tex) {
    this.removeBlur();
    for (const p of this.rotors) {
      if (!p.blur) continue;
      const disc = dec(new Mesh(new CircleGeometry(p.tip, 64), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide, opacity: 0 })));
      if (p.axis === 'y') disc.rotation.x = -Math.PI / 2; else if (p.axis === 'x') disc.rotation.y = Math.PI / 2;
      disc.name = 'spin-blur';
      p.group.add(disc);
      p.disc = disc;
    }
  }

  removeBlur() {
    for (const p of this.rotors) {
      if (!p.disc) continue;
      p.group.remove(p.disc); p.disc.geometry.dispose(); p.disc.material.dispose(); p.disc = null;
    }
  }

  // rpm — оберти гвинтів 0…1; ground — швидкість по землі (одиниць сцени за секунду), air — колеса не торкаються землі,
  // scale — масштаб сцени відносно файлу (радіус колеса в сцені = r·scale).
  step(dt, { rpm = 0, ground = 0, air = false, scale = 1 } = {}) {
    this.t += dt;
    for (const p of this.parts) {
      if (p.kind === 'wheel') {
        // Колесо крутиться за шляхом по землі; у повітрі воно гальмує само. Швидкість обмежено (WHEEL_MAX), кадр теж.
        p.w = ease(p.w, air ? 0 : Math.min(ground / Math.max(p.r * scale, 1e-6), WHEEL_MAX), air ? .35 : 9, dt);
        p.angle = (p.angle + p.dir * Math.min(p.w * dt, WHEEL_FRAME)) % TAU;
        p.group.rotation[p.axis] = p.angle;
        continue;
      }
      p.angle = (p.angle + p.dir * Math.min(p.rate * rpm * dt, TAU / p.n * SAFE_STEP)) % TAU;
      p.group.rotation[p.axis] = p.angle;
      if (p.disc) p.disc.material.opacity = p.blur * rpm * rpm;
      if (p.blades.length) {
        const k = smooth(rpm / .5);
        for (const b of p.blades) b.holder.quaternion.setFromAxisAngle(b.tangent, -((p.cone - b.rest) * k + .012 * k * Math.sin(this.t * 7 + b.i * 1.3)));
      }
    }
  }

  // Усе в нуль: модель знову виглядає як у файлі.
  reset() {
    for (const p of this.parts) {
      p.angle = 0; p.w = 0;
      p.group.rotation.set(0, 0, 0);
      for (const b of p.blades || []) b.holder.quaternion.identity();
      if (p.disc) p.disc.material.opacity = 0;
    }
  }

  dispose() { this.removeBlur(); this.reset(); }
}
