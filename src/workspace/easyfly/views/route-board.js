// Командна панель зведення: офлайн-карта України з маршрутом розрахунку,
// показники зверху, погода лише з введених даних, порожні UKBB і зони, профіль висоти.
// Не радар, не METAR і не положення борта.
import { calcShpp, planScheme } from '../nav-core.js';
import { el } from '../ui.js';
import {
  aircraftType, flightToDraft, fmtDuration, fmtInt, navSession, parseNum, summarize,
} from './navigator-core.js';

const SVG = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 620;

function svg(name, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function draftPlottable(draft) {
  return (draft?.legs || []).some(leg => {
    const s = parseNum(leg.s);
    const course = parseNum(leg.mshk);
    const speed = parseNum(leg.v);
    return s !== null && s > 0 && course !== null && speed !== null && speed > 0;
  });
}

/** Чернетка екрана «Штурман», інакше останній збережений розрахунок, який можна накреслити. */
function chosenDraft(ctx) {
  if (navSession.draft && draftPlottable(navSession.draft)) {
    return { draft: navSession.draft, title: 'Чернетка розрахунку' };
  }
  const saved = Array.isArray(ctx.data?.navFlights) ? ctx.data.navFlights : [];
  for (let i = saved.length - 1; i >= 0; i -= 1) {
    const draft = flightToDraft(saved[i].flight, { today: ctx.today, unit: ctx.data?.unit });
    if (draftPlottable(draft)) return { draft, title: text(saved[i].title) || 'Збережений розрахунок' };
  }
  return null;
}

function courseText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${String(Math.round(n)).padStart(3, '0')}°`;
}

function schemeOf(flight) {
  const shpp = calcShpp(flight);
  if (!shpp.legs.length) return null;
  const geometry = planScheme(shpp, {
    width: W,
    height: H,
    marginX: 92,
    marginY: 108,
    rotationStep: 5,
    reserve: [
      { x0: 0, y0: 0, x1: 820, y1: 118 },
      { x0: W - 120, y0: 4, x1: W - 4, y1: 120 },
      { x0: 4, y0: H - 58, x1: 250, y1: H - 4 },
    ],
  });
  return { shpp, geometry };
}

function pointSymbol(point, last) {
  const { x, y, kind } = point;
  if (kind === 'ko') {
    return svg('polygon', {
      points: `${x},${y - 10} ${x + 9},${y + 7} ${x - 9},${y + 7}`,
      fill: '#0B141B', stroke: '#52B6C8', 'stroke-width': '2',
    });
  }
  if (point.landing) {
    return svg('rect', {
      x: x - 8, y: y - 8, width: 16, height: 16,
      fill: '#0B141B', stroke: '#F4A64D', 'stroke-width': '2',
    });
  }
  const kpm = last || kind === 'kpm';
  const ring = svg('circle', {
    cx: x, cy: y, r: 10,
    fill: '#0B141B',
    stroke: kpm ? '#EF6256' : '#36DDB5',
    'stroke-width': '2',
  });
  if (kind === 'vpm') {
    return [ring, svg('circle', { cx: x, cy: y, r: 3.5, fill: '#36DDB5' })];
  }
  if (kpm) {
    return [ring, svg('circle', { cx: x, cy: y, r: 5.5, fill: 'none', stroke: '#EF6256', 'stroke-width': '1.6' })];
  }
  return ring;
}

function mapSvg(model) {
  const { shpp, geometry } = model;
  const labels = geometry.labels;
  const root = svg('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'ef-cmd-svg',
    role: 'img',
    'aria-label': `Схема: ${shpp.routeText}`,
  });
  const title = svg('title');
  title.textContent = 'Схема маршруту за курсом і відстанню';
  root.append(title);
  const defs = svg('defs');
  defs.append(svg('pattern', {
    id: 'ef-cmd-grid', width: '40', height: '40', patternUnits: 'userSpaceOnUse',
  }, svg('path', { d: 'M40 0H0V40', fill: 'none', stroke: 'rgba(82,182,200,.16)', 'stroke-width': '1' })));
  defs.append(svg('marker', {
    id: 'ef-cmd-arr', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto',
  }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#36DDB5' })));
  defs.append(svg('marker', {
    id: 'ef-cmd-north', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto',
  }, svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#52B6C8' })));
  root.append(defs);
  root.append(svg('rect', { width: W, height: H, fill: 'url(#ef-cmd-grid)' }));

  shpp.legs.forEach((leg, i) => {
    const seg = geometry.segments[i];
    const r = 12;
    root.append(svg('line', {
      x1: (seg.x1 + seg.ux * r).toFixed(1),
      y1: (seg.y1 + seg.uy * r).toFixed(1),
      x2: (seg.x2 - seg.ux * (r + 2)).toFixed(1),
      y2: (seg.y2 - seg.uy * (r + 2)).toFixed(1),
      stroke: '#36DDB5',
      'stroke-width': '2.4',
      'stroke-linecap': 'round',
      'stroke-dasharray': leg.landing || leg.afterLanding ? '8 6' : null,
      'marker-end': 'url(#ef-cmd-arr)',
    }));
  });

  for (const box of labels.heightBoxes) {
    root.append(svg('rect', {
      x: (box.cx - box.w / 2).toFixed(1),
      y: (box.cy - box.h / 2).toFixed(1),
      width: box.w,
      height: box.h,
      rx: '4',
      fill: '#14232D',
      stroke: '#36DDB5',
      'stroke-width': '1.2',
    }));
    const label = svg('text', {
      x: box.cx, y: (box.cy + 4.5).toFixed(1), fill: '#EAF3F5', 'font-size': '13', 'text-anchor': 'middle',
    });
    label.textContent = `${shpp.legs[box.index].h} м`;
    root.append(label);
  }

  for (const label of labels.legLabels) {
    const off = label.off || 0;
    const y1 = label.side === 1 ? -21 - off : 17 + off;
    const y2 = label.side === 1 ? -7 - off : 31 + off;
    const group = svg('g', {
      transform: `translate(${label.x} ${label.y}) rotate(${label.angle})`,
      'font-size': '13',
      'text-anchor': 'middle',
    });
    const a = svg('text', { y: y1, fill: '#EAF3F5', 'font-weight': '700' });
    a.textContent = label.lines[0];
    const b = svg('text', { y: y2, fill: '#93A9B4' });
    b.textContent = label.lines[1];
    group.append(a, b);
    root.append(group);
  }

  geometry.points.forEach((point, index) => {
    const symbol = pointSymbol(point, index === geometry.points.length - 1);
    root.append(...(Array.isArray(symbol) ? symbol : [symbol]));
    const place = labels.pointLabels[index];
    const line = svg('text', {
      x: place.x, y: place.y, fill: '#93A9B4', 'font-size': '14', 'text-anchor': place.anchor,
    });
    const code = svg('tspan', { fill: '#EAF3F5', 'font-weight': '700' });
    code.textContent = point.code || '';
    line.append(code);
    if (point.name) {
      const name = svg('tspan');
      name.textContent = ` ${point.name}`;
      line.append(name);
    }
    if (point.landing) {
      const extra = svg('tspan');
      extra.textContent = ' (посадка)';
      line.append(extra);
    }
    root.append(line);
  });

  for (const turn of labels.turnLabels) {
    const label = svg('text', {
      x: turn.x, y: turn.y, fill: '#52B6C8', 'font-size': '12', 'font-style': 'italic', 'text-anchor': turn.anchor,
    });
    label.textContent = turn.text;
    root.append(label);
  }

  const nx = W - 64;
  const ny = 64;
  const north = geometry.north;
  root.append(svg('line', {
    x1: (nx - north.x * 22).toFixed(1),
    y1: (ny - north.y * 22).toFixed(1),
    x2: (nx + north.x * 28).toFixed(1),
    y2: (ny + north.y * 28).toFixed(1),
    stroke: '#52B6C8',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'marker-end': 'url(#ef-cmd-north)',
  }));
  const northLabel = svg('text', {
    x: (nx + north.x * 42).toFixed(1),
    y: (ny + north.y * 42 + 5).toFixed(1),
    fill: '#52B6C8',
    'font-size': '14',
    'font-weight': '700',
    'text-anchor': 'middle',
  });
  northLabel.textContent = 'Пн';
  root.append(northLabel);

  const km = [5, 10, 20, 25, 50, 100, 200, 250].filter(step => step * geometry.scale <= 180).pop() || 10;
  const len = km * geometry.scale;
  root.append(
    svg('line', { x1: 28, y1: H - 28, x2: (28 + len).toFixed(1), y2: H - 28, stroke: '#EAF3F5', 'stroke-width': '2' }),
    svg('line', { x1: 28, y1: H - 34, x2: 28, y2: H - 22, stroke: '#EAF3F5', 'stroke-width': '2' }),
    svg('line', { x1: (28 + len).toFixed(1), y1: H - 34, x2: (28 + len).toFixed(1), y2: H - 22, stroke: '#EAF3F5', 'stroke-width': '2' }),
  );
  const scale = svg('text', {
    x: (28 + len / 2).toFixed(1), y: H - 40, fill: '#93A9B4', 'font-size': '13', 'text-anchor': 'middle',
  });
  scale.textContent = `${km} км`;
  root.append(scale);
  return root;
}

function profileSvg(shpp) {
  const legs = shpp.legs;
  const nodes = [{ s: 0, h: legs[0]?.h || 0, name: legs[0]?.from?.code || 'ВПМ' }];
  for (const leg of legs) nodes.push({ s: leg.S, h: leg.h || 0, name: leg.to?.code || '' });
  const maxS = Math.max(nodes[nodes.length - 1].s, 1);
  const maxH = Math.max(100, ...nodes.map(node => node.h));
  const width = 640;
  const height = 210;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const x = s => pad.l + (s / maxS) * (width - pad.l - pad.r);
  const y = h => pad.t + (1 - h / (maxH * 1.15)) * (height - pad.t - pad.b);
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'ef-cmd-profile-svg',
    role: 'img',
    'aria-label': 'Профіль висоти за ділянками розрахунку',
  });
  const title = svg('title');
  title.textContent = 'Профіль висоти за ділянками розрахунку';
  root.append(title);
  const d = nodes.map((node, i) => `${i ? 'L' : 'M'}${x(node.s).toFixed(1)} ${y(node.h).toFixed(1)}`).join(' ');
  const area = `${d} L${x(maxS).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  root.append(svg('path', { d: area, fill: 'rgba(54,221,181,.16)' }));
  root.append(svg('path', { d, fill: 'none', stroke: '#36DDB5', 'stroke-width': '2.5', 'stroke-linejoin': 'round' }));
  for (const node of nodes) {
    root.append(svg('circle', { cx: x(node.s), cy: y(node.h), r: 4, fill: '#0B141B', stroke: '#36DDB5', 'stroke-width': '2' }));
    const label = svg('text', { x: x(node.s), y: y(node.h) - 8, fill: '#93A9B4', 'font-size': '11', 'text-anchor': 'middle' });
    label.textContent = node.name;
    root.append(label);
  }
  const axis = svg('text', { x: 8, y: 14, fill: '#93A9B4', 'font-size': '11' });
  axis.textContent = `${fmtInt(maxH)} м`;
  root.append(axis);
  return root;
}

function metric(label, value, unit) {
  return el('div', { class: 'ef-cmd-metric' },
    el('span', { text: label }),
    el('strong', { text: value }),
    unit ? el('small', { text: unit }) : null);
}

function panel(title, body) {
  return el('section', { class: 'ef-card ef-cmd-card' },
    el('h2', { class: 'ef-card-title', text: title }),
    body);
}

function missing(copy) {
  return el('p', { class: 'ef-cmd-missing', text: copy });
}

function hasNum(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function weatherCard(flight) {
  const rows = [];
  if (flight?.wind) rows.push(`Вітер з розрахунку: ${courseText(flight.wind.from)} ${fmtInt(flight.wind.speedMs)} м/с`);
  if (hasNum(flight?.qnh)) rows.push(`QNH з розрахунку: ${fmtInt(flight.qnh)} гПа`);
  if (hasNum(flight?.qfe)) rows.push(`QFE з розрахунку: ${fmtInt(flight.qfe)} гПа`);
  if (hasNum(flight?.t0)) rows.push(`Температура з розрахунку: ${fmtInt(flight.t0)} °C`);
  const body = rows.length
    ? el('ul', { class: 'ef-cmd-facts' }, rows.map(line => el('li', { text: line })))
    : missing('У розрахунку немає вітру, QNH, QFE і температури. METAR сюди не підставляється.');
  return panel('Погода', body);
}

function pointRows(shpp) {
  const rows = [{ code: 'ВПМ', name: shpp.legs[0]?.from?.name || '', s: '0', t: '0:00', course: '—' }];
  for (const leg of shpp.legs) {
    rows.push({
      code: leg.to?.code || '',
      name: leg.to?.name || '',
      s: fmtInt(leg.S),
      t: fmtDuration(leg.T),
      course: courseText(leg.mk),
    });
  }
  return rows;
}

function emptyMap(ctx) {
  return el('div', { class: 'ef-cmd-empty' },
    el('strong', { text: 'Схеми ще немає' }),
    el('p', { text: 'Накреслюється лише маршрут із розрахунку: курс, швидкість і відстань кожної ділянки. Карти, радара й зон тут немає.' }),
    el('button', { type: 'button', class: 'ef-btn ef-btn-primary', onClick: () => ctx.go('navigator'), text: 'Відкрити розрахунок' }));
}

// Межі sat.jpg — ті самі, що META у map-app.js. Файл уже лежить у застосунку, мережа не потрібна.
const UKRAINE = { lon0: 21.9, lon1: 40.5, lat0: 44.05, lat1: 52.5 };
const ASSET = './map-assets/';
const KM_LAT = 111.32;
const imageCache = new Map();
let regionsPromise = null;

function loadImage(src) {
  const hit = imageCache.get(src);
  if (hit) return hit;
  const pending = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      imageCache.delete(src);
      reject(new Error(src));
    };
    img.src = src;
  });
  imageCache.set(src, pending);
  return pending;
}

function loadRegions() {
  if (!regionsPromise) {
    regionsPromise = fetch(`${ASSET}regions.json`)
      .then(response => (response.ok ? response.json() : []))
      .catch(() => []);
  }
  return regionsPromise;
}

function moveKm(lat, lon, courseDeg, km) {
  const rad = courseDeg * Math.PI / 180;
  const north = km * Math.cos(rad);
  const east = km * Math.sin(rad);
  return {
    lat: lat + north / KM_LAT,
    lon: lon + east / (KM_LAT * Math.cos(lat * Math.PI / 180)),
  };
}

/** Точки маршруту на місцевості: виліт за координатами, далі курс і відстань кожної ділянки. */
function trackPoints(flight, shpp) {
  const lat0 = Number(flight?.departure?.lat);
  const lon0 = Number(flight?.departure?.lon);
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || !shpp?.legs?.length) return null;
  const points = [{
    lat: lat0,
    lon: lon0,
    code: shpp.legs[0].from?.code || 'ВПМ',
    name: shpp.legs[0].from?.name || '',
    kind: 'vpm',
  }];
  let lat = lat0;
  let lon = lon0;
  for (const leg of shpp.legs) {
    if (!Number.isFinite(leg.mk) || !Number.isFinite(leg.s)) return null;
    const step = moveKm(lat, lon, leg.mk, leg.s);
    lat = step.lat;
    lon = step.lon;
    points.push({
      lat,
      lon,
      code: leg.to?.code || '',
      name: leg.to?.name || '',
      kind: leg.to?.kind || '',
      landing: Boolean(leg.landing),
    });
  }
  return points;
}

function fitBounds(points, width, height) {
  let lon0 = Math.min(...points.map(point => point.lon));
  let lon1 = Math.max(...points.map(point => point.lon));
  let lat0 = Math.min(...points.map(point => point.lat));
  let lat1 = Math.max(...points.map(point => point.lat));
  const mid = (lat0 + lat1) / 2;
  lon0 -= Math.max((lon1 - lon0) * 0.38, 0.12);
  lon1 += Math.max((lon1 - lon0) * 0.22, 0.12);
  lat0 -= Math.max((lat1 - lat0) * 0.28, 0.08);
  lat1 += Math.max((lat1 - lat0) * 0.28, 0.1);
  const cos = Math.cos(mid * Math.PI / 180) || 1;
  const geoAspect = ((lon1 - lon0) * cos) / (lat1 - lat0);
  const viewAspect = width / height;
  if (geoAspect > viewAspect) {
    const need = ((lon1 - lon0) * cos) / viewAspect;
    const extra = (need - (lat1 - lat0)) / 2;
    lat0 -= extra;
    lat1 += extra;
  } else {
    const need = ((lat1 - lat0) * viewAspect) / cos;
    const extra = (need - (lon1 - lon0)) / 2;
    lon0 -= extra;
    lon1 += extra;
  }
  return { lon0, lon1, lat0, lat1 };
}

function intersects(bbox, bounds) {
  if (!Array.isArray(bbox) || bbox.length < 4) return false;
  const [lon0, lon1, lat0, lat1] = bbox;
  return lon1 > bounds.lon0 && lon0 < bounds.lon1 && lat1 > bounds.lat0 && lat0 < bounds.lat1;
}

function drawGeoref(ctx, img, frame, view, width, height) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return false;
  const sx0 = (view.lon0 - frame.lon0) / (frame.lon1 - frame.lon0) * iw;
  const sx1 = (view.lon1 - frame.lon0) / (frame.lon1 - frame.lon0) * iw;
  const sy0 = (frame.lat1 - view.lat1) / (frame.lat1 - frame.lat0) * ih;
  const sy1 = (frame.lat1 - view.lat0) / (frame.lat1 - frame.lat0) * ih;
  const csx0 = Math.max(0, Math.min(iw, sx0));
  const csx1 = Math.max(0, Math.min(iw, sx1));
  const csy0 = Math.max(0, Math.min(ih, sy0));
  const csy1 = Math.max(0, Math.min(ih, sy1));
  if (csx1 - csx0 < 1 || csy1 - csy0 < 1 || sx1 === sx0 || sy1 === sy0) return false;
  const dx = ((csx0 - sx0) / (sx1 - sx0)) * width;
  const dy = ((csy0 - sy0) / (sy1 - sy0)) * height;
  const dw = ((csx1 - csx0) / (sx1 - sx0)) * width;
  const dh = ((csy1 - csy0) / (sy1 - sy0)) * height;
  ctx.drawImage(img, csx0, csy0, csx1 - csx0, csy1 - csy0, dx, dy, dw, dh);
  return true;
}

function screenOf(point, bounds, width, height) {
  return {
    x: ((point.lon - bounds.lon0) / (bounds.lon1 - bounds.lon0)) * width,
    y: ((bounds.lat1 - point.lat) / (bounds.lat1 - bounds.lat0)) * height,
  };
}

function drawGrid(ctx, bounds, width, height) {
  const mid = (bounds.lat0 + bounds.lat1) / 2;
  const kmLat = (bounds.lat1 - bounds.lat0) * KM_LAT;
  const kmLon = (bounds.lon1 - bounds.lon0) * KM_LAT * Math.cos(mid * Math.PI / 180);
  const stepKm = Math.max(kmLat, kmLon) > 160 ? 20 : 10;
  const latStep = stepKm / KM_LAT;
  const lonStep = stepKm / (KM_LAT * Math.cos(mid * Math.PI / 180) || 1);
  ctx.save();
  ctx.strokeStyle = 'rgba(82, 182, 200, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lat = Math.ceil(bounds.lat0 / latStep) * latStep; lat < bounds.lat1; lat += latStep) {
    const y = ((bounds.lat1 - lat) / (bounds.lat1 - bounds.lat0)) * height;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  for (let lon = Math.ceil(bounds.lon0 / lonStep) * lonStep; lon < bounds.lon1; lon += lonStep) {
    const x = ((lon - bounds.lon0) / (bounds.lon1 - bounds.lon0)) * width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRoute(ctx, points, legs, bounds, width, height) {
  const screen = points.map(point => screenOf(point, bounds, width, height));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(6, 32, 24, 0.85)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  screen.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
  ctx.stroke();
  ctx.strokeStyle = '#36DDB5';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  screen.forEach((point, index) => {
    if (!screen[index + 1]) return;
    const next = screen[index + 1];
    const angle = Math.atan2(next.y - point.y, next.x - point.x);
    const x = next.x - Math.cos(angle) * 16;
    const y = next.y - Math.sin(angle) * 16;
    ctx.fillStyle = '#36DDB5';
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8);
    ctx.lineTo(x + Math.cos(angle + 2.4) * 7, y + Math.sin(angle + 2.4) * 7);
    ctx.lineTo(x + Math.cos(angle - 2.4) * 7, y + Math.sin(angle - 2.4) * 7);
    ctx.fill();
  });
  const cx = screen.reduce((sum, point) => sum + point.x, 0) / screen.length;
  const cy = screen.reduce((sum, point) => sum + point.y, 0) / screen.length;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  screen.forEach((point, index) => {
    const source = points[index];
    const last = index === screen.length - 1;
    const kpm = last || source.kind === 'kpm';
    ctx.beginPath();
    ctx.fillStyle = '#0B141B';
    ctx.strokeStyle = kpm ? '#EF6256' : '#36DDB5';
    ctx.lineWidth = 2.5;
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (source.kind === 'vpm') {
      ctx.beginPath();
      ctx.fillStyle = '#36DDB5';
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    let dx = point.x - cx;
    let dy = point.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const lx = point.x + dx * 18;
    const ly = point.y + dy * 16;
    ctx.textAlign = dx > 0.3 ? 'left' : dx < -0.3 ? 'right' : 'center';
    const line = source.name ? `${source.code}  ${source.name}` : source.code;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(11, 20, 27, 0.9)';
    ctx.strokeText(line, lx, ly);
    ctx.fillStyle = '#EAF3F5';
    ctx.fillText(line, lx, ly);
  });
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  legs.forEach((leg, index) => {
    const a = screen[index];
    const b = screen[index + 1];
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const label = `${fmtInt(leg.s)} км`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(11, 20, 27, 0.9)';
    ctx.strokeText(label, mx, my - 12);
    ctx.fillStyle = '#EAF3F5';
    ctx.fillText(label, mx, my - 12);
  });
  ctx.restore();
}

function drawNorth(ctx, width) {
  const x = width - 46;
  const y = 78;
  ctx.save();
  ctx.strokeStyle = '#52B6C8';
  ctx.fillStyle = '#52B6C8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 22);
  ctx.lineTo(x, y - 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x - 6, y - 10);
  ctx.lineTo(x + 6, y - 10);
  ctx.fill();
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Пн', x, y - 34);
  ctx.restore();
}

function drawScale(ctx, bounds, width, height) {
  const mid = (bounds.lat0 + bounds.lat1) / 2;
  const kmPerPx = ((bounds.lon1 - bounds.lon0) * KM_LAT * Math.cos(mid * Math.PI / 180)) / width;
  const km = [5, 10, 20, 25, 50].find(step => step / kmPerPx >= 70 && step / kmPerPx <= 180) || 10;
  const len = km / kmPerPx;
  const y = height - 28;
  ctx.save();
  ctx.strokeStyle = '#EAF3F5';
  ctx.fillStyle = '#EAF3F5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, y);
  ctx.lineTo(28 + len, y);
  ctx.moveTo(28, y - 6);
  ctx.lineTo(28, y + 6);
  ctx.moveTo(28 + len, y - 6);
  ctx.lineTo(28 + len, y + 6);
  ctx.stroke();
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#EAF3F5';
  ctx.fillText(`${km} км`, 28 + len / 2, y - 12);
  ctx.restore();
}

function drawMap(ctx, sat, tiles, bounds, points, legs, width, height) {
  ctx.fillStyle = '#0B141B';
  ctx.fillRect(0, 0, width, height);
  drawGeoref(ctx, sat, UKRAINE, bounds, width, height);
  for (const tile of tiles) {
    drawGeoref(ctx, tile.img, { lon0: tile.bbox[0], lon1: tile.bbox[1], lat0: tile.bbox[2], lat1: tile.bbox[3] }, bounds, width, height);
  }
  ctx.fillStyle = 'rgba(11, 20, 27, 0.42)';
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, bounds, width, height);
  drawRoute(ctx, points, legs, bounds, width, height);
  drawNorth(ctx, width);
  drawScale(ctx, bounds, width, height);
}

function geoMap(model, flight, note) {
  const points = trackPoints(flight, model.shpp);
  if (!points) return null;
  note.textContent = 'Офлайн-знімок України. Маршрут відкладено від координат вильоту за курсом і відстанню розрахунку. Не положення борта.';
  const canvas = el('canvas', { class: 'ef-cmd-canvas', role: 'img' });
  canvas.setAttribute('aria-label', `Карта маршруту: ${model.shpp.routeText}`);
  const host = el('div', { class: 'ef-cmd-canvas-host' }, canvas);
  const width = 1000;
  const height = 620;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0B141B';
  ctx.fillRect(0, 0, width, height);
  const bounds = fitBounds(points, width, height);
  Promise.all([loadImage(`${ASSET}sat.jpg`), loadRegions()]).then(async ([sat, regions]) => {
    if (!canvas.isConnected) return;
    const hits = (Array.isArray(regions) ? regions : []).filter(item => intersects(item?.bbox, bounds) && item.sat);
    const tiles = (await Promise.all(hits.map(async item => {
      try {
        return { img: await loadImage(`${ASSET}${item.sat}`), bbox: item.bbox };
      } catch {
        return null;
      }
    }))).filter(Boolean);
    if (!canvas.isConnected) return;
    drawMap(ctx, sat, tiles, bounds, points, model.shpp.legs, width, height);
  }).catch(() => {
    if (!canvas.isConnected) return;
    host.replaceChildren(mapSvg(model));
    note.textContent = 'Схема за курсом і відстанню розрахунку. Знімок карти не відкрився. Не положення борта.';
  });
  return host;
}

export function routeBoard(ctx) {
  const picked = chosenDraft(ctx);
  let model = null;
  let stats = null;
  if (picked) {
    try {
      stats = summarize(picked.draft, ctx.data?.unit);
      model = schemeOf(stats.flight);
    } catch {
      model = null;
    }
  }
  const flight = stats?.flight;
  const first = model?.shpp.legs[0];
  const board = el('section', { class: 'ef-cmd', 'aria-label': 'Схема маршруту і зведення' });
  const note = el('p', { class: 'ef-cmd-note' });
  let picture = emptyMap(ctx);
  if (model) {
    picture = geoMap(model, flight, note) || mapSvg(model);
    if (!note.textContent) note.textContent = 'Схема за курсом і відстанню розрахунку. Не аеронавігаційна карта і не положення борта.';
  } else {
    note.textContent = 'Без ділянок із курсом, швидкістю й відстанню схема не будується.';
  }
  const map = el('div', { class: 'ef-cmd-map' },
    model ? el('div', { class: 'ef-cmd-telem', 'aria-label': 'Показники розрахунку, не телеметрія борта' },
      metric('V першої', fmtInt(first.v), 'км/год'),
      metric('H першої', fmtInt(first.h), 'м'),
      metric('МК першої', courseText(first.mk), null),
      metric('S маршруту', fmtInt(model.shpp.totals.S), 'км'),
      metric('t маршруту', fmtDuration(model.shpp.totals.T), null)) : null,
    picture,
    note);
  const side = el('div', { class: 'ef-cmd-side' });
  if (flight) {
    const type = aircraftType(flight.typeId);
    const who = [flight.callsign, flight.board ? `борт ${flight.board}` : '', type?.label || ''].filter(Boolean).join(' · ');
    side.append(el('section', { class: 'ef-card ef-cmd-card' },
      el('h2', { class: 'ef-card-title', text: who || 'Розрахунок' }),
      el('p', { class: 'ef-cmd-route', text: picked.title }),
      el('p', { class: 'ef-muted', text: flight.departure?.name ? `Виліт: ${flight.departure.name}` : 'Точку вильоту не вказано' }),
      el('button', { type: 'button', class: 'ef-btn ef-btn-secondary ef-btn-sm', onClick: () => ctx.go('navigator'), text: 'До розрахунку' })));
  }
  side.append(weatherCard(flight));
  side.append(panel('UKBB', missing('Даних немає. Модуль не зберігає зведення аеродрому і NOTAM.')));
  side.append(panel('Зони', missing('Даних немає. Полігонів повітряного простору в розрахунку немає.')));
  if (model) {
    side.append(panel('Точки',
      el('ul', { class: 'ef-cmd-points' }, pointRows(model.shpp).map(row => el('li', {},
        el('span', { class: 'ef-cmd-code', text: row.code }),
        el('span', { class: 'ef-cmd-pname', text: row.name }),
        el('span', { text: `${row.s} км` }),
        el('span', { text: row.course }))))));
  }
  const bottom = model ? el('div', { class: 'ef-cmd-bottom' },
    el('section', { class: 'ef-card ef-cmd-card' },
      el('h2', { class: 'ef-card-title', text: 'Профіль висоти' }),
      profileSvg(model.shpp))) : null;
  board.append(map, side, bottom);
  return board;
}
