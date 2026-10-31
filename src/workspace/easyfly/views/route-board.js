// Командна панель зведення: схема маршруту з розрахунку штурмана (курс і відстань),
// профіль висоти й лічильники допусків. Не карта, не радар і не жива телеметрія борта.
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
    marginY: 78,
    rotationStep: 5,
    reserve: [
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

function donut(counters) {
  const parts = [
    { value: counters.valid, color: '#36DDB5', label: 'Дійсно' },
    { value: counters.soon, color: '#F4A64D', label: 'Скоро' },
    { value: counters.overdue, color: '#EF6256', label: 'Прострочено' },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const r = 38;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const rings = parts.filter(part => part.value > 0).map(part => {
    const len = total ? (part.value / total) * c : 0;
    const ring = svg('circle', {
      cx: 54, cy: 54, r, fill: 'none', stroke: part.color, 'stroke-width': 10,
      'stroke-dasharray': `${len} ${c - len}`, 'stroke-dashoffset': String(-offset),
      transform: 'rotate(-90 54 54)',
    });
    offset += len;
    return ring;
  });
  const picture = svg('svg', { viewBox: '0 0 108 108', class: 'ef-cmd-donut', role: 'img' }, ...rings);
  const pct = total ? Math.round((counters.valid / total) * 100) : 0;
  const caption = svg('text', { x: 54, y: 58, 'text-anchor': 'middle', fill: '#EAF3F5', 'font-size': '18', 'font-weight': '700' });
  caption.textContent = `${pct}%`;
  picture.append(caption);
  picture.setAttribute('aria-label', `Дійсні ${counters.valid}, скоро ${counters.soon}, прострочено ${counters.overdue}`);
  return el('div', { class: 'ef-cmd-donut-wrap' },
    picture,
    el('ul', { class: 'ef-cmd-legend' }, parts.map(part => el('li', {},
      el('i', { style: `background:${part.color}` }),
      el('span', { text: part.label }),
      el('strong', { text: fmtInt(part.value) })))));
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

export function routeBoard(ctx, summary) {
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
  const map = el('div', { class: 'ef-cmd-map' },
    model ? el('div', { class: 'ef-cmd-telem', 'aria-label': 'Показники розрахунку, не телеметрія борта' },
      metric('V першої', fmtInt(first.v), 'км/год'),
      metric('H першої', fmtInt(first.h), 'м'),
      metric('МК першої', courseText(first.mk), null),
      metric('S маршруту', fmtInt(model.shpp.totals.S), 'км'),
      metric('t маршруту', fmtDuration(model.shpp.totals.T), null)) : null,
    model ? mapSvg(model) : emptyMap(ctx),
    el('p', { class: 'ef-cmd-note', text: model
      ? 'Схема за курсом і відстанню розрахунку. Не аеронавігаційна карта і не положення борта.'
      : 'Без ділянок із курсом, швидкістю й відстанню схема не будується.' }));
  const side = el('div', { class: 'ef-cmd-side' });
  if (flight) {
    const type = aircraftType(flight.typeId);
    side.append(el('section', { class: 'ef-card ef-cmd-card' },
      el('h2', { class: 'ef-card-title', text: picked.title }),
      el('p', { class: 'ef-cmd-call', text: [flight.callsign, flight.board ? `борт ${flight.board}` : '', type?.label || ''].filter(Boolean).join(' · ') || 'Розрахунок без позивного' }),
      el('p', { class: 'ef-muted', text: flight.departure?.name ? `Виліт: ${flight.departure.name}` : 'Точку вильоту не вказано' }),
      flight.qnh !== null && flight.qnh !== undefined ? el('p', { class: 'ef-muted', text: `QNH з розрахунку: ${fmtInt(flight.qnh)} гПа` }) : null,
      flight.wind ? el('p', { class: 'ef-muted', text: `Вітер з розрахунку: ${courseText(flight.wind.from)} ${fmtInt(flight.wind.speedMs)} м/с` }) : null,
      el('button', { type: 'button', class: 'ef-btn ef-btn-secondary ef-btn-sm', onClick: () => ctx.go('navigator'), text: 'До розрахунку' })));
  }
  if (summary?.counters) {
    side.append(el('section', { class: 'ef-card ef-cmd-card' },
      el('h2', { class: 'ef-card-title', text: 'Допуски' }),
      donut(summary.counters)));
  }
  if (model) {
    side.append(el('section', { class: 'ef-card ef-cmd-card' },
      el('h2', { class: 'ef-card-title', text: 'Точки маршруту' }),
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
