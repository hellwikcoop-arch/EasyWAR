// Ландшафт під наземною машиною «Інтерактивної моделі»: фотограмметрична плитка aircraft-3d/landscape.js (та сама, що під літаком
// у aircraft-viewer.html), повторена вздовж курсу з дзеркальним чергуванням, щоб стики були безшовні. З плитки знімається
// сітка висот: машина їде за рельєфом, ракети влучають у землю. Математика висот — чисті функції без three.js
// (їх перевіряють модульні тести), сцену будує клас Terrain.
import { BufferAttribute, FrontSide, Group, Mesh, SRGBColorSpace } from 'three';
import { clamp } from './ref-fx.js';

// Масштаб плитки відносно файлу (588×441 м у файлі), вертикальний множник і розмір сітки висот.
// tiles — скільки плиток лежить уздовж курсу, rows — скільки рядів упоперек (бічні ряди — дзеркальні, щоб край поля лишався далеко за туманом).
export const LAND = { model: { wrapper: 'aircraft-3d/landscape.js', global: 'LAND_GLB' }, scale: .2, vScale: .45, gw: 96, gh: 72, tiles: 5, rows: 3 };

// Сітка висот зі списку вершин [x, y, z, …]: у комірці — середня висота, порожні комірки заповнюються сусідніми.
export function heightGrid(points, box, gw = LAND.gw, gh = LAND.gh) {
  const sum = new Float32Array(gw * gh), cnt = new Uint16Array(gw * gh);
  const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
  for (let i = 0; i < points.length; i += 3) {
    const gx = clamp(Math.floor((points[i] - box.min.x) / sx * gw), 0, gw - 1), gz = clamp(Math.floor((points[i + 2] - box.min.z) / sz * gh), 0, gh - 1);
    sum[gz * gw + gx] += points[i + 1]; cnt[gz * gw + gx]++;
  }
  const H = new Float32Array(gw * gh);
  for (let i = 0; i < H.length; i++) H[i] = cnt[i] ? sum[i] / cnt[i] : NaN;
  for (let pass = 0; pass < 12; pass++) {
    let holes = 0;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      if (!Number.isNaN(H[k])) continue;
      let a = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = i + di, y = j + dj;
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        const h = H[y * gw + x];
        if (!Number.isNaN(h)) { a += h; n++; }
      }
      if (n) H[k] = a / n; else holes++;
    }
    if (!holes) break;
  }
  for (let i = 0; i < H.length; i++) if (Number.isNaN(H[i])) H[i] = 0;
  return H;
}

// Висота рельєфу в точці світу (x уздовж курсу, z упоперек): білінійно по сітці. Плитки йдуть уздовж X і рядами вздовж Z, кожна
// друга в кожному напрямку дзеркальна, тож на стиках висота не стрибає.
// grid = { H, gw, gh, box: { min, max } } у метрах плитки.
export function heightAt(grid, x, z) {
  const { H, gw, gh, box } = grid, L = box.max.x - box.min.x, W = box.max.z - box.min.z;
  const n = Math.floor((x - box.min.x) / L), nz = Math.floor((z - box.min.z) / W);
  let lx = x - n * L, lz = z - nz * W;
  if (Math.abs(n) % 2) lx = box.min.x + box.max.x - lx;
  if (Math.abs(nz) % 2) lz = box.min.z + box.max.z - lz;
  const fx = clamp((lx - box.min.x) / L * (gw - 1), 0, gw - 1.001), fz = clamp((lz - box.min.z) / W * (gh - 1), 0, gh - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, b = fz - j;
  return H[j * gw + i] * (1 - a) * (1 - b) + H[j * gw + i + 1] * a * (1 - b) + H[(j + 1) * gw + i] * (1 - a) * b + H[(j + 1) * gw + i + 1] * a * b;
}

// Поза корпуса на рельєфі за висотами під передньою й задньою осями: h(x, z) — висота, front/rear — положення осей уздовж
// машини, half — піввідстань між колесами (або гусеницями). pitch > 0 — ніс угору, roll > 0 — бік +z нижче.
export function groundPose(h, { front, rear, half }) {
  const hfl = h(front, half), hfr = h(front, -half), hrl = h(rear, half), hrr = h(rear, -half);
  const hf = (hfl + hfr) / 2, hr = (hrl + hrr) / 2;
  return {
    y: (hf + hr) / 2 * .65 + Math.max(hfl, hfr, hrl, hrr) * .35 + .01,
    pitch: Math.atan2(hf - hr, front - rear),
    roll: Math.atan(((hfr + hrr) - (hfl + hrl)) / 2 / (2 * half)),
  };
}

// Положення й дзеркальність плиток навколо точки x: n-та плитка займає [box.min.x + n·L, box.min.x + (n+1)·L].
export function tileLayout(box, x, count = LAND.tiles) {
  const L = box.max.x - box.min.x, first = Math.floor((x - box.min.x) / L) - Math.floor(count / 2);
  return Array.from({ length: count }, (_, k) => {
    const n = first + k, odd = Math.abs(n) % 2 === 1;
    return { n, flip: odd, x: n * L + (odd ? box.min.x + box.max.x : 0) };
  });
}

// Ряди плиток упоперек курсу: нульовий лежить під машиною, решта дзеркально ліворуч і праворуч (z — зсув плитки у світі).
export function rowLayout(box, count = LAND.rows) {
  const W = box.max.z - box.min.z, first = -Math.floor(count / 2);
  return Array.from({ length: count }, (_, k) => {
    const n = first + k, odd = Math.abs(n) % 2 === 1;
    return { n, flip: odd, z: n * W + (odd ? box.min.z + box.max.z : 0) };
  });
}

let assetLoad = null;

// Забуває завантажену плитку (для тестів і повторного завантаження після помилки).
export function forgetTerrain() { assetLoad = null; }

// Плитка завантажується один раз на сторінку; кожна сцена будує власні меші на спільній геометрії.
function loadAsset(loadGltf) {
  if (!assetLoad) {
    assetLoad = (async () => {
      const gltf = await loadGltf(LAND.model);
      gltf.scene.updateMatrixWorld(true);
      let src = null;
      gltf.scene.traverse(o => { if (o.isMesh) src = o; });
      if (!src) throw new Error('У файлі ландшафту немає мешу');
      const geometry = src.geometry.clone();
      // Квантовані атрибути розгортаємо в float32, щоб їх можна було масштабувати.
      for (const name of ['position', 'uv']) {
        const at = geometry.attributes[name];
        if (!at) continue;
        const size = at.itemSize, f = new Float32Array(at.count * size);
        for (let i = 0; i < at.count; i++) { f[i * size] = at.getX(i); f[i * size + 1] = at.getY(i); if (size > 2) f[i * size + 2] = at.getZ(i); }
        geometry.setAttribute(name, new BufferAttribute(f, size));
      }
      if (geometry.attributes.normal) geometry.deleteAttribute('normal');
      geometry.applyMatrix4(src.matrixWorld);
      geometry.scale(LAND.scale, LAND.scale * LAND.vScale, LAND.scale);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox.clone();
      const H = heightGrid(geometry.attributes.position.array, box);
      const material = src.material;
      material.side = FrontSide;
      if (material.map) material.map.colorSpace = SRGBColorSpace;
      return { geometry, material, grid: { H, gw: LAND.gw, gh: LAND.gh, box }, y0: -heightAt({ H, gw: LAND.gw, gh: LAND.gh, box }, 0, 0) };
    })();
    assetLoad.catch(() => { assetLoad = null; });
  }
  return assetLoad;
}

export class Terrain {
  // parent — група світу сцени (метри). loadGltf — завантажувач моделей переглядача (щоб не залежати від ref-viewer.js).
  constructor(parent, loadGltf, { anisotropy = 4, dim = .68 } = {}) {
    this.group = new Group();
    this.group.name = 'terrain';
    this.group.visible = false;
    parent.add(this.group);
    this.ready = false; this.failed = false; this.tiles = []; this.asset = null; this.dim = dim; this.anisotropy = anisotropy;
    this.loading = loadAsset(loadGltf).then(asset => {
      if (this.disposed) return;
      this.asset = asset; this.ready = true;
      // Матеріал без освітлення (знімок уже з тінями): трохи притемнюємо, щоб поле не світилося на тлі освітленої техніки.
      asset.material.color.setScalar(this.dim);
      if (asset.material.map) asset.material.map.anisotropy = this.anisotropy;
      for (let i = 0; i < LAND.tiles * LAND.rows; i++) { const t = new Mesh(asset.geometry, asset.material); this.tiles.push(t); this.group.add(t); }
      this.group.visible = true;
      this.place(this.x || 0);
      if (this.onReady) this.onReady();
    }).catch(e => { this.failed = true; console.warn('Довідник: ландшафт недоступний', e); });
  }

  // Висота рельєфу під точкою світу; поки ландшафт не завантажено — рівна земля.
  heightAt(x, z) { return this.ready ? heightAt(this.asset.grid, x, z) + this.asset.y0 : 0; }

  // Кладе плитки навколо машини, що стоїть у точці x світу.
  place(x) {
    this.x = x;
    if (!this.ready) return;
    const { box } = this.asset.grid, y0 = this.asset.y0, rows = rowLayout(box), cols = tileLayout(box, x);
    rows.forEach((row, j) => cols.forEach((col, i) => {
      const t = this.tiles[j * cols.length + i];
      t.scale.set(col.flip ? -1 : 1, 1, row.flip ? -1 : 1);
      t.position.set(col.x, y0, row.z);
    }));
  }

  dispose() {
    this.disposed = true;
    this.group.parent && this.group.parent.remove(this.group);
    this.tiles = [];
  }
}
