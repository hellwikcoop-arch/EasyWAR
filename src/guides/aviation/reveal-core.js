// Показ «Презентація» в довіднику авіації: чиста математика без DOM і three, щоб її можна було перевірити в node --test.
// Тут: карта висот корпусу (растеризація трикутників зверху вниз), тканина-чохол за Верле з опорою на цю карту й підлогу,
// міра «наскільки чохол знято», профіль зльоту гелікоптера й розпізнавальний знак, який малюється поверх текстури.
// Сцена, світло, камера й події миші — у reveal.js.

/* ---------- карта висот корпусу ---------- */
// Сітка nx×nz над прямокутником [minX..maxX]×[minZ..maxZ]; у кожній клітинці — найвища точка корпусу над нею.
export function makeHull(minX, maxX, minZ, maxZ, nx, nz, floor = 0) {
  const h = new Float32Array(nx * nz).fill(-Infinity);
  return { minX, minZ, maxX, maxZ, nx, nz, dx: (maxX - minX) / (nx - 1), dz: (maxZ - minZ) / (nz - 1), h, floor, max: floor };
}

// Один трикутник (світові координати): для кожної клітинки, чий центр лежить у його проєкції на площину XZ,
// запам'ятовуємо висоту поверхні. Вершини теж ставимо у свої клітинки, щоб дрібні трикутники не губилися.
export function rasterTriangle(hull, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const { minX, minZ, dx, dz, nx, nz, h } = hull;
  const ua = (ax - minX) / dx, va = (az - minZ) / dz;
  const ub = (bx - minX) / dx, vb = (bz - minZ) / dz;
  const uc = (cx - minX) / dx, vc = (cz - minZ) / dz;
  const stamp = (u, v, y) => {
    const i = Math.round(u), j = Math.round(v);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = j * nx + i;
    if (y > h[k]) h[k] = y;
  };
  stamp(ua, va, ay); stamp(ub, vb, by); stamp(uc, vc, cy);
  const det = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
  if (Math.abs(det) < 1e-9) return;
  const i0 = Math.max(0, Math.ceil(Math.min(ua, ub, uc))), i1 = Math.min(nx - 1, Math.floor(Math.max(ua, ub, uc)));
  const j0 = Math.max(0, Math.ceil(Math.min(va, vb, vc))), j1 = Math.min(nz - 1, Math.floor(Math.max(va, vb, vc)));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const l1 = ((ub - ua) * (j - va) - (i - ua) * (vb - va)) / det; // вага вершини c
      const l2 = ((i - ua) * (vc - va) - (uc - ua) * (j - va)) / det; // вага вершини b
      const l0 = 1 - l1 - l2;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      const y = l0 * ay + l2 * by + l1 * cy;
      const k = j * nx + i;
      if (y > h[k]) h[k] = y;
    }
  }
}

// Після растеризації: розширити заповнені клітинки на сусідні (щоб тканина не провалювалась у щілини між трикутниками),
// порожнє заповнити підлогою, трохи згладити. Повертає ту саму карту.
export function finishHull(hull, { dilate = 1, blur = 1 } = {}) {
  const { nx, nz, floor } = hull;
  let h = hull.h;
  for (let pass = 0; pass < dilate; pass += 1) {
    const out = new Float32Array(h);
    for (let j = 0; j < nz; j += 1) for (let i = 0; i < nx; i += 1) {
      let m = h[j * nx + i];
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const v = h[jj * nx + ii];
        if (v > m) m = v;
      }
      out[j * nx + i] = m;
    }
    h = out;
  }
  for (let k = 0; k < h.length; k += 1) if (h[k] === -Infinity) h[k] = floor;
  for (let pass = 0; pass < blur; pass += 1) {
    const out = new Float32Array(h.length);
    for (let j = 0; j < nz; j += 1) for (let i = 0; i < nx; i += 1) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        s += h[jj * nx + ii]; n += 1;
      }
      out[j * nx + i] = s / n;
    }
    h = out;
  }
  hull.h = h;
  let max = floor;
  for (let k = 0; k < h.length; k += 1) if (h[k] > max) max = h[k];
  hull.max = max;
  return hull;
}

// Висота корпусу в точці (білінійна інтерполяція); поза сіткою — підлога.
export function hullAt(hull, x, z) {
  const { minX, minZ, dx, dz, nx, nz, h, floor } = hull;
  const u = (x - minX) / dx, v = (z - minZ) / dz;
  if (!(u >= 0 && v >= 0 && u <= nx - 1 && v <= nz - 1)) return floor;
  const i = Math.min(nx - 2, Math.floor(u)), j = Math.min(nz - 2, Math.floor(v));
  const fu = u - i, fv = v - j;
  const k = j * nx + i;
  return (h[k] * (1 - fu) + h[k + 1] * fu) * (1 - fv) + (h[k + nx] * (1 - fu) + h[k + nx + 1] * fu) * fv;
}

export function hullGrad(hull, x, z) {
  const ex = hull.dx, ez = hull.dz;
  return [(hullAt(hull, x + ex, z) - hullAt(hull, x - ex, z)) / (2 * ex), (hullAt(hull, x, z + ez) - hullAt(hull, x, z - ez)) / (2 * ez)];
}

// Прямокутник клітинок, де корпус вищий за minH (у світових координатах), або null.
export function footprint(hull, minH) {
  const { nx, nz, h, minX, minZ, dx, dz } = hull;
  let i0 = nx, i1 = -1, j0 = nz, j1 = -1;
  for (let j = 0; j < nz; j += 1) for (let i = 0; i < nx; i += 1) {
    if (h[j * nx + i] <= minH) continue;
    if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
  }
  if (i1 < 0) return null;
  return { minX: minX + i0 * dx, maxX: minX + i1 * dx, minZ: minZ + j0 * dz, maxZ: minZ + j1 * dz };
}

/* ---------- тканина-чохол ---------- */
// Сітка cols×rows частинок над прямокутником [x0..x1]×[z0..z1] на висоті y. Зв'язки: сусіди (структура),
// діагоналі (зсув) і через одну (згин). Інтеграція за Верле: pos і prev.
export function makeCloth({ cols, rows, x0, x1, z0, z1, y }) {
  const n = cols * rows, pos = new Float32Array(n * 3), prev = new Float32Array(n * 3);
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const i = (r * cols + c) * 3;
    pos[i] = x0 + ((x1 - x0) * c) / (cols - 1);
    pos[i + 1] = y;
    pos[i + 2] = z0 + ((z1 - z0) * r) / (rows - 1);
  }
  prev.set(pos);
  const ia = [], ib = [], rest = [], kind = [];
  const link = (a, b, k) => {
    const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
    ia.push(a); ib.push(b); rest.push(Math.sqrt(dx * dx + dy * dy + dz * dz)); kind.push(k);
  };
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const i = r * cols + c;
    if (c + 1 < cols) link(i, i + 1, 0);
    if (r + 1 < rows) link(i, i + cols, 0);
    if (c + 1 < cols && r + 1 < rows) { link(i, i + cols + 1, 1); link(i + 1, i + cols, 1); }
    if (c + 2 < cols) link(i, i + 2, 2);
    if (r + 2 < rows) link(i, i + 2 * cols, 2);
  }
  return {
    cols, rows, n, pos, prev,
    ia: Int32Array.from(ia), ib: Int32Array.from(ib), rest: Float32Array.from(rest), kind: Uint8Array.from(kind),
    pinned: -1, pin: [0, 0, 0], over0: 0,
  };
}

const STIFF = [1, 0.9, 0.45]; // структура, зсув, згин

// Один крок часу dt. g — прискорення вільного падіння в одиницях сцени (від'ємне, бо вниз),
// hull — карта висот (може бути null), floorY — підлога, pull — {dir:[x,z], strength, c0, c1}: тягне стовпчики c0..c1.
export function stepCloth(cloth, { dt, g = -3.7, hull = null, floorY = 0, friction = 0.4, damping = 0.985, iters = 3, pull = null, eps = 0.035 }) {
  const { n, pos, prev, ia, ib, rest, kind, cols, pinned } = cloth;
  const dt2 = dt * dt;
  for (let i = 0; i < n; i += 1) {
    const k = i * 3;
    const x = pos[k], y = pos[k + 1], z = pos[k + 2];
    let vx = (x - prev[k]) * damping, vy = (y - prev[k + 1]) * damping, vz = (z - prev[k + 2]) * damping;
    if (pull) { const c = i % cols; if (c >= pull.c0 && c <= pull.c1) { vx += pull.dir[0] * pull.strength * dt2; vz += pull.dir[1] * pull.strength * dt2; } }
    prev[k] = x; prev[k + 1] = y; prev[k + 2] = z;
    pos[k] = x + vx; pos[k + 1] = y + vy + g * dt2; pos[k + 2] = z + vz;
  }
  for (let it = 0; it < iters; it += 1) {
    for (let c = 0; c < ia.length; c += 1) {
      const a = ia[c] * 3, b = ib[c] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const f = ((d - rest[c]) / d) * STIFF[kind[c]];
      const pa = ia[c] === pinned, pb = ib[c] === pinned;
      const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
      pos[a] += dx * f * wa; pos[a + 1] += dy * f * wa; pos[a + 2] += dz * f * wa;
      pos[b] -= dx * f * wb; pos[b + 1] -= dy * f * wb; pos[b + 2] -= dz * f * wb;
    }
    if (pinned >= 0) { const k = pinned * 3; pos[k] = cloth.pin[0]; pos[k + 1] = cloth.pin[1]; pos[k + 2] = cloth.pin[2]; }
  }
  for (let i = 0; i < n; i += 1) {
    const k = i * 3;
    let x = pos[k], y = pos[k + 1], z = pos[k + 2], hit = false;
    if (y < floorY + eps * 0.5) { y = floorY + eps * 0.5; hit = true; }
    if (hull) {
      const h = hullAt(hull, x, z);
      if (y < h + eps) {
        hit = true;
        const [gx, gz] = hullGrad(hull, x, z);
        const g2 = gx * gx + gz * gz;
        if (g2 > 2.25) {
          // крутий бік корпусу: частинку виштовхує назовні, а не вгору, тож чохол обгортає борт
          const gl = Math.sqrt(g2), m = Math.min((h + eps - y) / gl, 0.2);
          x -= (gx / gl) * m; z -= (gz / gl) * m;
          const h2 = hullAt(hull, x, z);
          if (y < h2 + eps) y = h2 + eps;
        } else y = h + eps;
      }
    }
    if (hit) {
      // тертя: гасимо дотичну швидкість
      prev[k] += (x - prev[k]) * friction; prev[k + 2] += (z - prev[k + 2]) * friction;
    }
    pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
  }
  if (pinned >= 0) { const k = pinned * 3; pos[k] = prev[k] = cloth.pin[0]; pos[k + 1] = prev[k + 1] = cloth.pin[1]; pos[k + 2] = prev[k + 2] = cloth.pin[2]; }
  return cloth;
}

// Скільки частинок висить над прямокутником fp (із запасом pad).
export function overFootprint(cloth, fp, pad = 0.1) {
  let m = 0;
  for (let i = 0; i < cloth.n; i += 1) {
    const x = cloth.pos[i * 3], z = cloth.pos[i * 3 + 2];
    if (x >= fp.minX - pad && x <= fp.maxX + pad && z >= fp.minZ - pad && z <= fp.maxZ + pad) m += 1;
  }
  return m;
}

// 0 — чохол на місці, 1 — над корпусом не лишилося жодної частинки. over0 запам'ятовують після осідання.
export function revealProgress(cloth, fp) {
  if (!cloth.over0) return 0;
  return Math.max(0, Math.min(1, 1 - overFootprint(cloth, fp) / cloth.over0));
}

export function clothMeanY(cloth) {
  let s = 0;
  for (let i = 0; i < cloth.n; i += 1) s += cloth.pos[i * 3 + 1];
  return s / cloth.n;
}

// Ручка чохла: частинка посередині краю з боку носа (останній стовпчик, більший x).
export function handleIndex(cloth) {
  return Math.floor(cloth.rows / 2) * cloth.cols + (cloth.cols - 1);
}

/* ---------- зліт ---------- */
export const LIFT = Object.freeze({ hoverT: 2.4, hoverY: 0.8, accel: 1.3, vmax: 7.5, climb: 0.5, pitchMax: -7, endX: 48, endT: 14 });
const D2R = Math.PI / 180;
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// Положення гелікоптера через t секунд після початку зльоту: підйом на місці, потім розгін уперед із набором висоти.
export function liftPose(t, L = LIFT) {
  if (t <= 0) return { x: 0, y: 0, pitch: 0, bank: 0, v: 0, done: false };
  if (t < L.hoverT) {
    const s = smooth(t / L.hoverT);
    return { x: 0, y: L.hoverY * s, pitch: -1.5 * D2R * s, bank: 0, v: 0, done: false };
  }
  const u = t - L.hoverT;
  const tv = L.vmax / L.accel;
  const v = Math.min(L.vmax, L.accel * u);
  const x = u < tv ? 0.5 * L.accel * u * u : 0.5 * L.accel * tv * tv + L.vmax * (u - tv);
  const y = L.hoverY + L.climb * u + 0.03 * u * u;
  const pitch = L.pitchMax * D2R * smooth(u / 1.8) + 2.5 * D2R * smooth((u - 4) / 3);
  const bank = 3 * D2R * Math.sin(u * 0.9) * smooth(u / 2);
  return { x, y, pitch, bank, v, done: x > L.endX || t > L.endT };
}

/* ---------- розпізнавальний знак ---------- */
// Де на текстурі фюзеляжу Мі-8ТВ (2048×2048) стоять ромби НДР: центр і радіус кола, яке їх накриває.
export const MARK_SPOTS = Object.freeze([[952, 1039, 56], [952, 1479, 56]]);
export const MARK = Object.freeze({ blue: '#1f5fb9', yellow: '#f4c631' });

// Коло ПС ЗСУ: синє поле, жовте кільце й спрощений тризуб. ctx — CanvasRenderingContext2D або його заглушка в тестах.
export function drawRoundel(ctx, cx, cy, r, colors = MARK) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = colors.blue; ctx.fill();
  ctx.lineWidth = r * 0.09; ctx.strokeStyle = colors.yellow;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2); ctx.stroke();
  const s = r * 0.6;
  ctx.translate(cx, cy); ctx.scale(s, s);
  ctx.fillStyle = colors.yellow;
  // центральний зубець із вістрям угорі
  ctx.beginPath(); ctx.moveTo(-0.1, 0.42); ctx.lineTo(-0.1, -0.55); ctx.lineTo(0, -0.82); ctx.lineTo(0.1, -0.55); ctx.lineTo(0.1, 0.42); ctx.closePath(); ctx.fill();
  // бічні зубці: вигнуті назовні дуги
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sg * 0.14, 0.42);
    ctx.quadraticCurveTo(sg * 0.62, 0.15, sg * 0.46, -0.62);
    ctx.lineTo(sg * 0.3, -0.6);
    ctx.quadraticCurveTo(sg * 0.4, 0.05, sg * 0.14, 0.12);
    ctx.closePath(); ctx.fill();
  }
  // основа клином донизу
  ctx.beginPath(); ctx.moveTo(-0.46, 0.3); ctx.lineTo(0.46, 0.3); ctx.lineTo(0.2, 0.62); ctx.lineTo(0, 0.86); ctx.lineTo(-0.2, 0.62); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ---------- фази показу ---------- */
export const PHASES = Object.freeze(['cover', 'pull', 'drop', 'spool', 'lift', 'out']);
export const TIMING = Object.freeze({ settleS: 2.5, dropS: 3.2, fadeS: 1.2, spoolS: 4.2, holdS: 1.0, outS: 0.7 });
// Поріг, після якого чохол дотягується сам.
export const PULL_DONE = 0.55;
