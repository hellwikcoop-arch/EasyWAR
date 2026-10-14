// Розрізання цілих мешів на рухомі частини для «Інтерактивної моделі» довідника. Моделі з каталогу src/models злиті в великі
// меші (усі шини одним тілом, усі ланки гусениці — іншим), а колесо має крутитися окремо від корпусу. Тут геометрію не
// змінюють у файлі: на льоту знаходять зв’язні тіла або відбирають трикутники за місцем і ділять меш на частини, які потім
// чіпляють до власних осей. Функції не потребують браузера, тож їх перевіряють модульні тести.
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, Vector3 } from 'three';

// Для кожної вершини — номер першої вершини з тим самим положенням (шви текстур не розрізають тіло).
export function weldMap(geometry, tol = 1e-4) {
  const pos = geometry.attributes.position, n = pos.count, rep = new Int32Array(n), seen = new Map(), inv = 1 / tol;
  for (let i = 0; i < n; i++) {
    const key = Math.round(pos.getX(i) * inv) + ',' + Math.round(pos.getY(i) * inv) + ',' + Math.round(pos.getZ(i) * inv);
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, i); rep[i] = i; } else rep[i] = first;
  }
  return rep;
}

export function triangleCount(geometry) {
  return Math.floor((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3);
}

const vertexOf = (geometry, t, k) => (geometry.index ? geometry.index.getX(t * 3 + k) : t * 3 + k);

// Центри трикутників: [x, y, z, x, y, z, …].
export function triangleCentroids(geometry) {
  const pos = geometry.attributes.position, n = triangleCount(geometry), out = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { const v = vertexOf(geometry, t, k); x += pos.getX(v); y += pos.getY(v); z += pos.getZ(v); }
    out[t * 3] = x / 3; out[t * 3 + 1] = y / 3; out[t * 3 + 2] = z / 3;
  }
  return out;
}

// Зв’язні тіла меша. label[t] — номер тіла трикутника t; box[i*6..] — [мін x, y, z, макс x, y, z] тіла i;
// tris[i] — кількість трикутників; center[i*3..] — центр обмежувального об’єму.
export function triangleComponents(geometry, tol = 1e-4) {
  const pos = geometry.attributes.position, n = pos.count, nt = triangleCount(geometry), rep = weldMap(geometry, tol);
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let t = 0; t < nt; t++) {
    const a = rep[vertexOf(geometry, t, 0)];
    join(a, rep[vertexOf(geometry, t, 1)]); join(a, rep[vertexOf(geometry, t, 2)]);
  }
  const ids = new Map(), label = new Int32Array(nt);
  for (let t = 0; t < nt; t++) {
    const root = find(rep[vertexOf(geometry, t, 0)]);
    let id = ids.get(root);
    if (id === undefined) { id = ids.size; ids.set(root, id); }
    label[t] = id;
  }
  const count = ids.size, box = new Float32Array(count * 6), tris = new Int32Array(count), center = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], i * 6); }
  for (let t = 0; t < nt; t++) {
    const i = label[t];
    tris[i]++;
    for (let k = 0; k < 3; k++) {
      const v = vertexOf(geometry, t, k), p = [pos.getX(v), pos.getY(v), pos.getZ(v)];
      for (let c = 0; c < 3; c++) { if (p[c] < box[i * 6 + c]) box[i * 6 + c] = p[c]; if (p[c] > box[i * 6 + 3 + c]) box[i * 6 + 3 + c] = p[c]; }
    }
  }
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) center[i * 3 + c] = (box[i * 6 + c] + box[i * 6 + 3 + c]) / 2;
  return { label, count, box, tris, center };
}

// Номери тіл (з triangleComponents), чиї обмежувальні об’єми лежать у коробці region = [мін x, y, z, макс x, y, z], розширеній на tol.
export function componentsIn(comp, region, tol = 0) {
  const out = [];
  for (let i = 0; i < comp.count; i++) {
    const b = comp.box;
    let inside = true;
    for (let c = 0; c < 3 && inside; c++) inside = b[i * 6 + c] >= region[c] - tol && b[i * 6 + 3 + c] <= region[3 + c] + tol;
    if (inside) out.push(i);
  }
  return out;
}

// Осі обертання: indices координат площини, перпендикулярної до осі (u, v), і координата вздовж осі.
export const SPIN_PLANE = { x: [1, 2, 0], y: [0, 2, 1], z: [0, 1, 2] };

// Номери тіл, що лежать у циліндрі навколо осі axis ('x' | 'y' | 'z') із центром c = [u, v] у площині, перпендикулярній до осі, між
// координатами band = [від, до] вздовж осі й радіусом r: найдальший кут обмежувального об’єму тіла не далі за r від осі. Так беруть
// маточину й лопаті гвинта, не зачіпаючи нічого, що лежить за колом лопатей. tol розширює всі межі.
export function componentsInCylinder(comp, { axis, c, band, r }, tol = 0) {
  const [u, v, a] = SPIN_PLANE[axis], b = comp.box, out = [];
  for (let i = 0; i < comp.count; i++) {
    const o = i * 6;
    if (b[o + a] < band[0] - tol || b[o + 3 + a] > band[1] + tol) continue;
    const du = Math.max(Math.abs(b[o + u] - c[0]), Math.abs(b[o + 3 + u] - c[0])), dv = Math.max(Math.abs(b[o + v] - c[1]), Math.abs(b[o + 3 + v] - c[1]));
    if (Math.hypot(du, dv) <= r + tol) out.push(i);
  }
  return out;
}

// Вершини кожного тіла: Map<номер тіла, [x, y, z, x, y, z, …]> лише для потрібних номерів ids.
export function componentVertices(geometry, comp, ids) {
  const want = new Set(ids), pos = geometry.attributes.position, nt = comp.label.length, seen = new Set(), out = new Map();
  for (const i of want) out.set(i, []);
  for (let t = 0; t < nt; t++) {
    const lab = comp.label[t];
    if (!want.has(lab)) continue;
    for (let k = 0; k < 3; k++) {
      const vtx = vertexOf(geometry, t, k);
      if (seen.has(vtx)) continue;
      seen.add(vtx);
      out.get(lab).push(pos.getX(vtx), pos.getY(vtx), pos.getZ(vtx));
    }
  }
  return out;
}

// Мітки трикутників за групами тіл: groups[j] — список номерів тіл, що утворюють частину j; решта трикутників — -1.
export function labelsOfComponents(comp, groups) {
  const part = new Int32Array(comp.count).fill(-1);
  groups.forEach((list, j) => list.forEach(i => { part[i] = j; }));
  return Int32Array.from(comp.label, c => part[c]);
}

// Мітки трикутників за правилом: fn(x, y, z, t) → номер частини або -1 (лишається в корпусі).
export function labelTriangles(geometry, fn) {
  const c = triangleCentroids(geometry), n = c.length / 3, labels = new Int32Array(n);
  for (let t = 0; t < n; t++) labels[t] = fn(c[t * 3], c[t * 3 + 1], c[t * 3 + 2], t);
  return labels;
}

// Трикутники, чий центр лежить у коробці box = [мін x, y, z, макс x, y, z], дістають мітку box-а за порядком; решта — -1.
export function labelsByBoxes(geometry, boxes) {
  return labelTriangles(geometry, (x, y, z) => {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x >= b[0] && y >= b[1] && z >= b[2] && x <= b[3] && y <= b[4] && z <= b[5]) return i;
    }
    return -1;
  });
}

// Колесо: центр осі (x, y), бік z, радіус r, піввисота протектора hw. Трикутник належить найближчому колесу того ж боку, якщо
// лежить у колі r·reach (так запасне колесо на борту чи вантаж над колесом лишаються у корпусі).
export function labelsByWheels(geometry, wheels, reach = 1.12) {
  return labelTriangles(geometry, (x, y, z) => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      if (Math.abs(z - w.z) > (w.hw ?? .3)) continue;
      const d = Math.hypot(x - w.x, y - w.y);
      if (d < bd && d <= w.r * reach) { bd = d; best = i; }
    }
    return best;
  });
}

const FLOAT_ATTRIBUTES = ['position', 'normal', 'uv', 'uv1', 'color'];

// Ділить геометрію за мітками трикутників (мітка < 0 — залишок). Повертає { parts: [геометрія | null] × count, rest }.
// Усі атрибути, що є в геометрії, копіюються в float32 (нормалізовані й квантовані значення розгортаються).
export function splitByLabels(geometry, labels, count) {
  const nt = labels.length, n = geometry.attributes.position.count;
  const bucket = new Int32Array(count + 2); // [0] — залишок, далі частини
  for (let t = 0; t < nt; t++) bucket[(labels[t] < 0 || labels[t] >= count ? 0 : labels[t] + 1) + 1]++;
  for (let i = 1; i < bucket.length; i++) bucket[i] += bucket[i - 1];
  const order = new Int32Array(nt), fill = bucket.slice();
  for (let t = 0; t < nt; t++) order[fill[labels[t] < 0 || labels[t] >= count ? 0 : labels[t] + 1]++] = t;
  const map = new Int32Array(n).fill(-1);
  const names = FLOAT_ATTRIBUTES.filter(k => geometry.attributes[k]);
  const build = (from, to) => {
    if (from === to) return null;
    const verts = [], index = [];
    for (let s = from; s < to; s++) {
      const t = order[s];
      for (let k = 0; k < 3; k++) {
        const v = vertexOf(geometry, t, k);
        if (map[v] < 0) { map[v] = verts.length; verts.push(v); }
        index.push(map[v]);
      }
    }
    const g = new BufferGeometry();
    for (const name of names) {
      const a = geometry.attributes[name], size = a.itemSize, out = new Float32Array(verts.length * size);
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        out[i * size] = a.getX(v);
        if (size > 1) out[i * size + 1] = a.getY(v);
        if (size > 2) out[i * size + 2] = a.getZ(v);
        if (size > 3) out[i * size + 3] = a.getW(v);
      }
      g.setAttribute(name, new BufferAttribute(out, size));
    }
    g.setIndex(new BufferAttribute(verts.length > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
    for (const v of verts) map[v] = -1;
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  };
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(build(bucket[i + 1], bucket[i + 2]));
  return { parts, rest: build(bucket[0], bucket[1]) };
}

// Зсуває вершини геометрії (центр обертання частини переходить у нуль).
export function shiftGeometry(geometry, x, y, z) {
  geometry.translate(x, y, z);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

// Новий меш на тому самому матеріалі, що й джерело (тіні й видимість успадковуються).
export function pieceOf(source, geometry, name = source.name) {
  const m = new Mesh(geometry, source.material);
  m.name = name; m.castShadow = source.castShadow; m.receiveShadow = source.receiveShadow;
  m.frustumCulled = source.frustumCulled;
  return m;
}

// Усі меші під вузлом (сам вузол теж, якщо він меш): glTF з кількома матеріалами дає групу мешів під одним іменем.
export function meshesOf(node) {
  const out = [];
  if (!node) return out;
  node.traverse(o => { if (o.isMesh && !o.userData.decal) out.push(o); });
  return out;
}

// Відділяє від меша частини за мітками: у мешу лишається залишок, а геометрії частин (у координатах меша) повертаються —
// їх чіпляють до осей через attach().
export function carve(mesh, labels, count) {
  const { parts, rest } = splitByLabels(mesh.geometry, labels, count);
  const old = mesh.geometry;
  if (rest) mesh.geometry = rest; else mesh.visible = false;
  old.dispose();
  return parts;
}

// Кладе частину geometry (джерело source) у групу group, чиє положення — центр обертання pivot у координатах меша-джерела:
// вершини зсуваються на -pivot, тож обертання групи крутить частину навколо її осі.
export function attach(group, source, geometry, pivot) {
  shiftGeometry(geometry, -pivot[0], -pivot[1], -pivot[2]);
  const m = pieceOf(source, geometry);
  group.add(m);
  return m;
}

// Запікає перетворення вузла в геометрію (позиції й нормалі стають float32 у системі предка), а сам вузол ставить у нуль.
// Для нерухомих мешів, чиї вершини треба читати як прості метри: файл може зберігати їх квантованими.
export function bakeFloat(mesh) {
  mesh.updateMatrix();
  const m = mesh.matrix, nm = new Matrix3().getNormalMatrix(m), g = mesh.geometry, v = new Vector3();
  const pos = g.attributes.position, nor = g.attributes.normal;
  const P = new Float32Array(pos.count * 3), N = nor ? new Float32Array(pos.count * 3) : null;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    if (nor) { v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; }
  }
  g.setAttribute('position', new BufferAttribute(P, 3));
  if (nor) g.setAttribute('normal', new BufferAttribute(N, 3));
  mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1); mesh.updateMatrix();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return mesh;
}

// Те саме, але перетворення береться від меша до root (усі предки між ними): геометрія стає float32 у системі root, а сам меш
// переходить під root з нульовим перетворенням. Деталі з різних груп файлу опиняються в одній системі координат — у ній
// пишуть області вирізання гвинтів і коліс (ref-spin.js).
export function bakeToRoot(mesh, root) {
  root.updateWorldMatrix(true, false);
  mesh.updateWorldMatrix(true, false);
  const m = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const nm = new Matrix3().getNormalMatrix(m), g = mesh.geometry, v = new Vector3();
  const pos = g.attributes.position, nor = g.attributes.normal;
  const P = new Float32Array(pos.count * 3), N = nor ? new Float32Array(pos.count * 3) : null;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    if (nor) { v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; }
  }
  g.setAttribute('position', new BufferAttribute(P, 3));
  if (nor) g.setAttribute('normal', new BufferAttribute(N, 3));
  mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1); mesh.updateMatrix();
  if (mesh.parent !== root) root.add(mesh);
  mesh.updateMatrixWorld(true);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return mesh;
}

// Мітка тіла для кожної вершини за мітками трикутників (вершини зварених тіл належать лише своєму тілу).
export function vertexLabels(geometry, triLabels) {
  const out = new Int32Array(geometry.attributes.position.count).fill(-1);
  for (let t = 0; t < triLabels.length; t++) for (let k = 0; k < 3; k++) out[vertexOf(geometry, t, k)] = triLabels[t];
  return out;
}

export const identityMatrix = () => new Matrix4();
