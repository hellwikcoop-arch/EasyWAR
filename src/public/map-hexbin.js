/* EasyWAR — шестикутна теплокарта для 2D-карти ПС і РВ: чиста логіка без DOM.
   Точки (км у локальній проєкції карти) групуються в шестикутники з вершиною вгору, кожен
   отримує рівень насиченості 0–4 за рангом кількості. Підключається класичним скриптом в
   air.html і rocket.html та в node-тестах; результат — globalThis.EWHexbin. Нічого не надсилає. */
(function (root) {
  'use strict';

  const SQRT3 = Math.sqrt(3);
  const LEVELS = 5;

  /* Осьові координати шестикутника для точки (округлення в кубічних координатах). */
  function cellOf(x, y, r) {
    const fq = (SQRT3 / 3 * x - y / 3) / r;
    const fr = (2 / 3 * y) / r;
    const fs = -fq - fr;
    let q = Math.round(fq), rr = Math.round(fr);
    const s = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(rr - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -rr - s; else if (dr > ds) rr = -q - s;
    return { q, r: rr };
  }

  /* Центр шестикутника в тих самих одиницях, що й точки. */
  function centerOf(q, rr, r) {
    return { x: r * SQRT3 * (q + rr / 2), y: r * 1.5 * rr };
  }

  /* Рівні 0–4 за рангом різних кількостей: одна кількість на всіх — середній рівень. */
  function levels(counts) {
    const unique = [...new Set(counts)].sort((a, b) => a - b);
    if (unique.length <= 1) return counts.map(() => Math.floor(LEVELS / 2));
    const rank = new Map(unique.map((count, index) => [count, Math.round(index / (unique.length - 1) * (LEVELS - 1))]));
    return counts.map(count => rank.get(count));
  }

  /* Шестикутники з точок `{ x, y }`; r — відстань від центру до вершини. Неправильні точки пропускаються. */
  function bin(points, r) {
    if (!(r > 0) || !Array.isArray(points)) return [];
    const cells = new Map();
    for (const point of points) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const { q, r: rr } = cellOf(point.x, point.y, r);
      const key = q + ',' + rr;
      const cell = cells.get(key);
      if (cell) cell.count++; else cells.set(key, { q, r: rr, count: 1 });
    }
    const list = [...cells.values()];
    const lv = levels(list.map(cell => cell.count));
    return list.map((cell, index) => Object.assign(cell, centerOf(cell.q, cell.r, r), { level: lv[index] }));
  }

  /* Контур шестикутника з вершиною вгору для SVG у пікселях. */
  function path(cx, cy, radius) {
    let d = '';
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i - 90);
      d += (i ? 'L' : 'M') + (cx + radius * Math.cos(angle)).toFixed(1) + ' ' + (cy + radius * Math.sin(angle)).toFixed(1);
    }
    return d + 'Z';
  }

  /* Від холодного до гарячого, як у референсі: синій — поодинокі, жовтий — найщільніші. */
  const COLORS = ['#3b5bdb', '#7048e8', '#c2255c', '#f03e3e', '#fab005'];

  root.EWHexbin = { bin, path, levels, cellOf, centerOf, COLORS, LEVELS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
