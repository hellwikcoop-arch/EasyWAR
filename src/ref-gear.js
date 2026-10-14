// Ходова частина наземної техніки для «Інтерактивної моделі» довідника: колеса, що обертаються і повертають, та гусениці,
// що йдуть по колу. У файлах моделей усі шини одним тілом, а всі ланки гусениці — іншим, тож колеса вирізаються з мешів на льоту
// (ref-mesh.js), а гусениця рухається вершинним шейдером: кожна ланка їде вздовж контуру, кожен каток крутиться навколо осі.
// Шейдер і побудова контуру перенесені з артефакту «M270» автора моделей; чисті функції (контур, позиція на контурі) не потребують
// браузера й перевіряються модульними тестами.
import { BufferAttribute, DataTexture, FloatType, Group, Matrix4, NearestFilter, RGBAFormat } from 'three';
import { attach, bakeFloat, carve, labelsByWheels, meshesOf, triangleComponents, vertexLabels } from './ref-mesh.js';
import { TRACK_NODES, WHEEL_NODES, wheelsOf } from './ref-rig-data.js';
import { clamp } from './ref-fx.js';

export const TRACK_SAMPLES = 256;

const IDENTITY = new Matrix4();
const isPlain = m => m.matrix.equals(IDENTITY);

// Меш, чиї вузли-предки до кореня сцени не мають перетворень: тоді координати вершин (після запікання власного перетворення
// меша) збігаються з координатами файлу, в яких заведені таблиці осей.
function plainChain(mesh, root) {
  for (let n = mesh.parent; n && n !== root; n = n.parent) if (!isPlain(n)) return false;
  return true;
}

// ---------- колеса ----------

// Вирізає колеса з мешів шин, дисків і болтів і садить кожне на власну вісь: root → steer (поворот) → spin (обертання).
// spec — запис з ref-rig-data.js (WHEELED). Повертає null, якщо в моделі немає потрібних мешів.
export function buildWheels(scene, spec, nodes = WHEEL_NODES) {
  const list = wheelsOf(spec).map(w => {
    const pivot = new Group(), spin = new Group();
    pivot.name = 'wheel-' + w.axle + (w.side > 0 ? 'l' : 'r');
    pivot.position.set(w.x, w.y, w.z);
    pivot.add(spin);
    scene.add(pivot);
    return { ...w, pivot, spin, rr: w.r };
  });
  let cut = 0;
  for (const name of nodes) {
    for (const mesh of meshesOf(scene.getObjectByName(name))) {
      if (!plainChain(mesh, scene) || !mesh.geometry.attributes.position) continue;
      if (!isPlain(mesh)) bakeFloat(mesh);
      const labels = labelsByWheels(mesh.geometry, list);
      const parts = carve(mesh, labels, list.length);
      parts.forEach((geometry, i) => {
        if (!geometry) return;
        const w = list[i];
        attach(w.spin, mesh, geometry, [w.x, w.y, w.z]);
        cut++;
        // Радіус кочення — половина висоти шини разом із протектором.
        if (name === 'tyres') w.rr = Math.max(.2, (geometry.boundingBox.max.y - geometry.boundingBox.min.y) / 2);
      });
    }
  }
  const dispose = () => { for (const w of list) w.pivot.parent && w.pivot.parent.remove(w.pivot); };
  if (!cut) { dispose(); return null; }
  return {
    wheels: list,
    // dist — шлях машини (м), steer — кут повороту передніх коліс (радіани).
    update(dist, steer = 0) {
      for (const w of list) { w.spin.rotation.z = -dist / w.rr; w.pivot.rotation.y = w.steer ? steer : 0; }
    },
    reset() { for (const w of list) { w.spin.rotation.z = 0; w.pivot.rotation.y = 0; } },
    dispose,
  };
}

// ---------- гусениці: контур і позиція ланки ----------

// Рівномірний замкнений контур з ns точок через впорядковані точки pts, тричі згладжений п’ятиточковим усередненням.
function resample(pts, ns) {
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const length = cum[pts.length], xy = [];
  let j = 0;
  for (let s = 0; s < ns; s++) {
    const d = s * length / ns;
    while (cum[j + 1] < d) j++;
    const a = pts[j], b = pts[(j + 1) % pts.length], f = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    xy.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  for (let pass = 0; pass < 3; pass++) {
    const copy = xy.map(q => q.slice());
    for (let s = 0; s < ns; s++) {
      let sx = 0, sy = 0;
      for (let k = -2; k <= 2; k++) { const q = copy[(s + k + ns) % ns]; sx += q[0]; sy += q[1]; }
      xy[s] = [sx / 5, sy / 5];
    }
  }
  return { xy, length };
}

// Контур кожного боку з центрів ланок: ланки впорядковуються за годинниковою стрілкою (дивлячись з +z), контур перерозбивається
// на рівні кроки й згладжується, у кожній точці зберігається напрям. centers — [{ x, y, side }], side 0 (z < 0) чи 1 (z > 0).
// Ланки сусідніх рядів лежать на трохи різній висоті, тому порядок за кутом перемішує сусідів: після першого проходу кожну ланку
// проєктують на згладжений контур і впорядковують за проєкцією — так довжина контуру й кроки між ланками рівні.
// path — Float32Array(ns × 2 × 4): рядок side, у кожній точці [x, y, tx, ty]. ds — довжина кроку контуру (м).
export function buildLoops(centers, ns = TRACK_SAMPLES) {
  const path = new Float32Array(ns * 2 * 4), loops = [];
  for (const side of [0, 1]) {
    const pts = centers.filter(c => c.side === side).map(c => [c.x, c.y]);
    if (pts.length < 3) throw new Error('Гусениця без ланок: бік ' + side);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    pts.sort((a, b) => Math.atan2(b[1] - cy, b[0] - cx) - Math.atan2(a[1] - cy, a[0] - cx));
    const rough = resample(pts, ns);
    const ordered = pts.map(p => ({ p, s: loopPosition(rough.xy, p[0], p[1]) })).sort((a, b) => a.s - b.s).map(k => k.p);
    const { xy, length } = resample(ordered, ns);
    for (let s = 0; s < ns; s++) {
      const a = xy[(s + ns - 3) % ns], b = xy[(s + 3) % ns], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, o = (side * ns + s) * 4;
      path[o] = xy[s][0]; path[o + 1] = xy[s][1]; path[o + 2] = dx / l; path[o + 3] = dy / l;
    }
    loops.push({ xy, length });
  }
  return { path, loops, ds: (loops[0].length + loops[1].length) / 2 / ns };
}

// Дробова позиція точки (x, y) на контурі xy (проєкція на найближчий відрізок), у кроках контуру.
export function loopPosition(xy, x, y) {
  const ns = xy.length;
  let b = 0, bd = Infinity;
  for (let s = 0; s < ns; s++) { const dd = (xy[s][0] - x) ** 2 + (xy[s][1] - y) ** 2; if (dd < bd) { bd = dd; b = s; } }
  let best = b, bestD = bd;
  for (const [s0, off] of [[(b + ns - 1) % ns, b - 1], [b, b]]) {
    const a = xy[s0], q = xy[(s0 + 1) % ns], ex = q[0] - a[0], ey = q[1] - a[1];
    const f = clamp(((x - a[0]) * ex + (y - a[1]) * ey) / Math.max(1e-9, ex * ex + ey * ey), 0, 1);
    const dd = (a[0] + ex * f - x) ** 2 + (a[1] + ey * f - y) ** 2;
    if (dd < bestD - 1e-12) { bestD = dd; best = off + f; }
  }
  return (best + ns) % ns;
}

// Те саме, що робить вершинний шейдер: точка контуру на дробовій позиції s боку side → [x, y, tx, ty].
export function pathAt(path, ns, s, side) {
  const f = ((s % ns) + ns) % ns, i0 = Math.floor(f), i1 = (i0 + 1) % ns, t = f - i0, a = (side * ns + i0) * 4, b = (side * ns + i1) * 4;
  return [0, 1, 2, 3].map(k => path[a + k] + (path[b + k] - path[a + k]) * t);
}

// Найближчий каток таблиці [x, y, r] до точки (x, y).
export function nearestWheel(wheels, x, y) {
  let best = wheels[0], bd = Infinity;
  for (const w of wheels) { const dd = (w[0] - x) ** 2 + (w[1] - y) ** 2; if (dd < bd) { bd = dd; best = w; } }
  return best;
}

// ---------- гусениці: шейдер ----------

const PATH_FN = `attribute vec4 aMove;uniform sampler2D tPath;uniform float uN,uShift,uDist;
vec4 pathAt(float s,float side){float f=mod(s,uN);int i0=int(floor(f));int i1=int(mod(float(i0)+1.,uN));float t=f-float(i0);
 return mix(texelFetch(tPath,ivec2(i0,int(side)),0),texelFetch(tPath,ivec2(i1,int(side)),0),t);}
`;
const NORMAL_PATCH = `vec2 mP0=vec2(0.),mP1=vec2(0.);float mC=1.,mS=0.;
if(aMove.x>.5&&aMove.x<1.5){vec4 pa=pathAt(aMove.y,aMove.z),pb=pathAt(aMove.y+uShift,aMove.z);mP0=pa.xy;mP1=pb.xy;vec2 t0=normalize(pa.zw),t1=normalize(pb.zw);mC=t1.x*t0.x+t1.y*t0.y;mS=t1.y*t0.x-t1.x*t0.y;}
else if(aMove.x>1.5){mP0=aMove.yz;mP1=mP0;float ph=-uDist/aMove.w;mC=cos(ph);mS=sin(ph);}
#include <beginnormal_vertex>
objectNormal.xy=vec2(mC*objectNormal.x-mS*objectNormal.y,mS*objectNormal.x+mC*objectNormal.y);`;
const VERTEX_PATCH = `#include <begin_vertex>
{vec2 mr=transformed.xy-mP0;transformed.xy=mP1+vec2(mC*mr.x-mS*mr.y,mS*mr.x+mC*mr.y);}`;

// Підключає до матеріалу вершинний шейдер руху: ланки зсуваються вздовж контуру, катки крутяться навколо осей.
export function patchMaterial(material, uniforms, key = 'ew-tracks-1') {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = PATH_FN + shader.vertexShader
      .replace('#include <beginnormal_vertex>', NORMAL_PATCH)
      .replace('#include <begin_vertex>', VERTEX_PATCH);
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
}

// ---------- гусениці: побудова ----------

// scene — коренева група моделі (метри файлу). spec — запис TRACKED з ref-rig-data.js: { wheels: [[x, y, r], …], … }.
export class Tracks {
  constructor(scene, spec, ns = TRACK_SAMPLES) {
    const { links, gear } = TRACK_NODES, meshes = {};
    for (const name of [...links, ...gear]) {
      const node = scene.getObjectByName(name);
      if (!node) continue;
      meshes[name] = meshesOf(node).filter(m => plainChain(m, scene) && m.geometry.attributes.position);
    }
    const bodies = [];
    for (const [name, list] of Object.entries(meshes)) for (const mesh of list) {
      if (!isPlain(mesh)) bakeFloat(mesh);
      const comp = triangleComponents(mesh.geometry);
      bodies.push({ name, mesh, comp, labels: vertexLabels(mesh.geometry, comp.label) });
    }
    const pads = bodies.filter(b => b.name === links[0]);
    if (!pads.length) throw new Error('У моделі немає ланок гусениці: ' + links[0]);
    const centers = [];
    for (const b of pads) for (let i = 0; i < b.comp.count; i++) {
      const z = b.comp.center[i * 3 + 2];
      if (z) centers.push({ x: b.comp.center[i * 3], y: b.comp.center[i * 3 + 1], side: z > 0 ? 1 : 0 });
    }
    const { path, loops, ds } = buildLoops(centers, ns);
    this.ds = ds; this.ns = ns; this.loops = loops;
    const texture = new DataTexture(path, ns, 2, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true;
    this.texture = texture;
    this.uniforms = { tPath: { value: texture }, uN: { value: ns }, uShift: { value: 0 }, uDist: { value: 0 } };
    this.meshes = [];
    for (const b of bodies) {
      const { mesh, comp, labels } = b, n = mesh.geometry.attributes.position.count, A = new Float32Array(n * 4), cache = new Map();
      const isLink = links.includes(b.name);
      for (let v = 0; v < n; v++) {
        const id = labels[v];
        if (id < 0) continue;
        let d = cache.get(id);
        if (!d) {
          const cx = comp.center[id * 3], cy = comp.center[id * 3 + 1], cz = comp.center[id * 3 + 2];
          if (isLink) { const side = cz > 0 ? 1 : 0; d = [1, loopPosition(loops[side].xy, cx, cy), side, 0]; }
          else { const w = nearestWheel(spec.wheels, cx, cy); d = [2, w[0], w[1], w[2]]; }
          cache.set(id, d);
        }
        A[v * 4] = d[0]; A[v * 4 + 1] = d[1]; A[v * 4 + 2] = d[2]; A[v * 4 + 3] = d[3];
      }
      mesh.geometry.setAttribute('aMove', new BufferAttribute(A, 4));
      mesh.material = [].concat(mesh.material).map(m => { const c = m.clone(); patchMaterial(c, this.uniforms); return c; });
      if (mesh.material.length === 1) mesh.material = mesh.material[0];
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
    }
  }

  // dist — шлях машини (м): ланки пройшли dist вздовж контуру, катки повернулися на dist / r.
  update(dist) {
    this.uniforms.uDist.value = dist;
    this.uniforms.uShift.value = (dist / this.ds) % this.ns;
  }

  reset() { this.update(0); }

  dispose() {
    this.texture.dispose();
    for (const m of this.meshes) for (const mat of [].concat(m.material)) mat.dispose();
  }
}
