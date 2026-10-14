// Порівняння геометрії моделі до й після розрізання на рухомі частини (кран, гвинти, колеса): чи кожна вершина лишилася там,
// де була у файлі. Ділять тести ref-crane, ref-spin та інші, що різають реальні моделі довідника.
import { Vector3 } from 'three';

// Світові координати вершин усього, що видно в моделі (без накладок-децалей): плоский масив x, y, z.
export function vertices(scene) {
  scene.updateMatrixWorld(true);
  const out = [], v = new Vector3();
  scene.traverseVisible(o => {
    if (!o.isMesh || o.userData.decal) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); }
  });
  return out;
}

// Скільки вершин a не мають поруч (у межах eps) вершини b: просторова сітка, тож швидко навіть для ста тисяч вершин.
export function unmatched(a, b, eps = 1e-3) {
  const cell = .02, grid = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
  for (let n = 0; n < b.length; n += 3) {
    const k = key(Math.floor(b[n] / cell), Math.floor(b[n + 1] / cell), Math.floor(b[n + 2] / cell));
    (grid.get(k) || grid.set(k, []).get(k)).push(n);
  }
  let miss = 0;
  for (let n = 0; n < a.length; n += 3) {
    const i = Math.floor(a[n] / cell), j = Math.floor(a[n + 1] / cell), k = Math.floor(a[n + 2] / cell);
    let hit = false;
    for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) for (let dk = -1; dk <= 1 && !hit; dk++) {
      for (const m of grid.get(key(i + di, j + dj, k + dk)) || []) {
        if (Math.abs(b[m] - a[n]) < eps && Math.abs(b[m + 1] - a[n + 1]) < eps && Math.abs(b[m + 2] - a[n + 2]) < eps) { hit = true; break; }
      }
    }
    if (!hit) miss++;
  }
  return miss;
}
