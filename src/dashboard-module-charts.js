// Малювання карток дашборда з моделей `dashboard-module-charts-core.js`: SVG для графіків і
// DOM для списків, без розмітки текстом і без мережі. Кольори рядів — слоти палітри `--ewmc-s1…s8`
// із CSS (темна й світла теми окремо, перевірені на розрізнюваність); текст завжди в кольорах
// тексту, а не ряду. Розмір береться з контейнера: `mountChart` перемальовує картку, коли
// змінюється її ширина.

import { UKRAINE_BOUNDS, UKRAINE_OUTLINE } from './dashboard-module-geo.js';
import { chartSummary } from './dashboard-module-charts-core.js';
import { pluralForm } from './dashboard-module-catalog-core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT = 11;
const BAR_MAX = 24;
const GAP = 2;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'title') node.append(svgTitle(value));
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child);
  return node;
}

const svgTitle = text => { const node = document.createElementNS(SVG_NS, 'title'); node.textContent = text; return node; };
const slotColor = slot => `var(--ewmc-s${Math.max(1, Math.min(8, slot || 1))})`;
const toneColor = tone => (tone === 'good' ? 'var(--ewmc-good)' : tone === 'bad' ? 'var(--ewmc-bad)' : tone === 'warn' ? 'var(--ewmc-warn)' : null);
/** Приблизна ширина тексту: шрифт картки вужчий за 0,6 em на символ. */
const textWidth = (text, size = FONT) => String(text ?? '').length * size * 0.56;
const fixed = value => Number(value.toFixed(2));

function truncate(text, maxWidth, size = FONT) {
  const value = String(text ?? '');
  if (textWidth(value, size) <= maxWidth) return value;
  const keep = Math.max(1, Math.floor(maxWidth / (size * 0.56)) - 1);
  return `${value.slice(0, keep)}…`;
}

/** Які підписи осі X показувати, щоб вони не наклались: кожен k-й від першого. */
function thinLabels(labels, slotWidth, size = FONT) {
  const widest = Math.max(1, ...labels.map(label => textWidth(label, size)));
  const every = Math.max(1, Math.ceil((widest + 10) / Math.max(1, slotWidth)));
  return labels.map((label, index) => (index % every === 0 ? label : ''));
}

// ---------------------------------------------------------------------------------------------
// Спільні частини

function legend(series, colorOf = item => slotColor(item.slot)) {
  return el('ul', { class: 'ewmc-legend' }, series.map(item => el('li', {},
    el('i', { style: { background: colorOf(item) } }),
    el('span', { text: item.name }))));
}

function figure(kind, model, content, { legendItems = null, footer = null, compact = false } = {}) {
  return el('figure', { class: `ewmc-chart ewmc-chart-${kind}${compact ? ' compact' : ''}`, role: 'img', 'aria-label': chartSummary(model) },
    content,
    legendItems && legendItems.length > 1 ? legend(legendItems) : null,
    footer);
}

function cartesian(width, height, scale, { left = null, bottom = 24, top = 10, right = 12 } = {}) {
  const tickTexts = scale.ticks.map(tick => tick);
  const padLeft = left ?? Math.min(72, Math.max(28, ...tickTexts.map(text => textWidth(text) + 10)));
  const plot = { x: padLeft, y: top, w: Math.max(10, width - padLeft - right), h: Math.max(10, height - top - bottom) };
  const y = value => plot.y + plot.h - (value - scale.min) / (scale.max - scale.min || 1) * plot.h;
  return { plot, y };
}

function gridLines(frame, scale, formatTick) {
  const nodes = scale.ticks.map(tick => [
    svg('line', { x1: frame.plot.x, x2: frame.plot.x + frame.plot.w, y1: fixed(frame.y(tick)), y2: fixed(frame.y(tick)), class: tick === 0 ? 'ewmc-axis' : 'ewmc-grid' }),
    svg('text', { x: frame.plot.x - 6, y: fixed(frame.y(tick) + 3.5), class: 'ewmc-tick', 'text-anchor': 'end', text: formatTick(tick) }),
  ]);
  return svg('g', {}, nodes);
}

function xLabels(frame, labels, slotWidth, { centered = true } = {}) {
  const shown = thinLabels(labels, slotWidth);
  return svg('g', {}, shown.map((label, index) => (label ? svg('text', {
    x: fixed(frame.plot.x + index * slotWidth + (centered ? slotWidth / 2 : 0)),
    y: frame.plot.y + frame.plot.h + 16,
    class: 'ewmc-tick',
    'text-anchor': centered || index > 0 && index < labels.length - 1 ? 'middle' : index === 0 ? 'start' : 'end',
    text: label,
  }) : null)));
}

/** Стовпчик із заокругленим кінцем даних і прямою основою; від'ємний — вниз від нуля. */
function columnPath(x, yZero, yValue, width, radius = 4) {
  const r = Math.min(radius, width / 2, Math.abs(yZero - yValue));
  if (yValue <= yZero) {
    return `M${fixed(x)} ${fixed(yZero)} V${fixed(yValue + r)} Q${fixed(x)} ${fixed(yValue)} ${fixed(x + r)} ${fixed(yValue)} H${fixed(x + width - r)} Q${fixed(x + width)} ${fixed(yValue)} ${fixed(x + width)} ${fixed(yValue + r)} V${fixed(yZero)} Z`;
  }
  return `M${fixed(x)} ${fixed(yZero)} V${fixed(yValue - r)} Q${fixed(x)} ${fixed(yValue)} ${fixed(x + r)} ${fixed(yValue)} H${fixed(x + width - r)} Q${fixed(x + width)} ${fixed(yValue)} ${fixed(x + width)} ${fixed(yValue - r)} V${fixed(yZero)} Z`;
}

/** Горизонтальна смуга від нуля з заокругленим кінцем даних. */
function barPath(xZero, xValue, y, height, radius = 4) {
  const r = Math.min(radius, height / 2, Math.abs(xValue - xZero));
  if (xValue >= xZero) {
    return `M${fixed(xZero)} ${fixed(y)} H${fixed(xValue - r)} Q${fixed(xValue)} ${fixed(y)} ${fixed(xValue)} ${fixed(y + r)} V${fixed(y + height - r)} Q${fixed(xValue)} ${fixed(y + height)} ${fixed(xValue - r)} ${fixed(y + height)} H${fixed(xZero)} Z`;
  }
  return `M${fixed(xZero)} ${fixed(y)} H${fixed(xValue + r)} Q${fixed(xValue)} ${fixed(y)} ${fixed(xValue)} ${fixed(y + r)} V${fixed(y + height - r)} Q${fixed(xValue)} ${fixed(y + height)} ${fixed(xValue + r)} ${fixed(y + height)} H${fixed(xZero)} Z`;
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M${fixed(start.x)} ${fixed(start.y)} A${r} ${r} 0 ${large} 1 ${fixed(end.x)} ${fixed(end.y)}`;
}

const polar = (cx, cy, r, angle) => ({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });

function marker(x, y, color, title) {
  return svg('circle', { cx: fixed(x), cy: fixed(y), r: 4, fill: color, class: 'ewmc-marker', title });
}

// ---------------------------------------------------------------------------------------------
// Види

function seriesLines(model, width, height, { compact }) {
  const frame = cartesian(width, height, model.scale);
  const count = model.categories.length;
  const step = count > 1 ? frame.plot.w / (count - 1) : 0;
  const x = index => frame.plot.x + (count > 1 ? index * step : frame.plot.w / 2);
  const area = model.kind === 'area';
  const showMarkers = count <= 24;
  const body = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'ewmc-svg' },
    gridLines(frame, model.scale, tick => model.valueText(tick)),
    xLabels(frame, model.categories, step, { centered: false }),
    model.series.map(series => {
      const color = slotColor(series.slot);
      const runs = [];
      let current = [];
      series.values.forEach((value, index) => {
        if (value == null) { if (current.length) runs.push(current); current = []; return; }
        current.push({ x: x(index), y: frame.y(value), value, label: model.categories[index] });
      });
      if (current.length) runs.push(current);
      return svg('g', {},
        area ? runs.map(run => svg('path', {
          d: `M${fixed(run[0].x)} ${fixed(frame.y(Math.max(0, model.scale.min)))} ${run.map(point => `L${fixed(point.x)} ${fixed(point.y)}`).join(' ')} L${fixed(run.at(-1).x)} ${fixed(frame.y(Math.max(0, model.scale.min)))} Z`,
          fill: color, class: 'ewmc-area',
        })) : null,
        runs.map(run => svg('polyline', { points: run.map(point => `${fixed(point.x)},${fixed(point.y)}`).join(' '), stroke: color, class: 'ewmc-line' })),
        showMarkers ? runs.flatMap(run => run.map(point => marker(point.x, point.y, color, `${point.label} · ${series.name}: ${model.valueText(point.value)}`))) : null,
        !compact && model.series.length <= 4 && runs.length ? (() => {
          const last = runs.at(-1).at(-1);
          return svg('text', { x: fixed(last.x + 6), y: fixed(last.y + 4), class: 'ewmc-value', text: model.valueText(last.value) });
        })() : null);
    }));
  return figure(model.kind, model, body, { legendItems: model.series, compact });
}

function columns(model, width, height, { compact }) {
  const stacked = model.kind === 'stacked-columns';
  const scale = stacked ? stackedScale(model) : model.scale;
  const frame = cartesian(width, height, scale);
  const count = Math.max(1, model.categories.length);
  const slot = frame.plot.w / count;
  const lineSeries = model.series.filter(series => series.mark === 'line');
  const barSeries = model.series.filter(series => series.mark !== 'line');
  const groups = stacked ? 1 : Math.max(1, barSeries.length);
  const barWidth = Math.min(BAR_MAX, Math.max(3, (slot * 0.72 - GAP * (groups - 1)) / groups));
  const groupWidth = barWidth * groups + GAP * (groups - 1);
  const yZero = frame.y(0);
  const bars = [];
  const labels = [];
  model.categories.forEach((category, index) => {
    const left = frame.plot.x + index * slot + (slot - groupWidth) / 2;
    if (stacked) {
      let positive = 0;
      let negative = 0;
      barSeries.forEach(series => {
        const value = series.values[index];
        if (value == null || value === 0) return;
        const from = value > 0 ? positive : negative;
        const to = from + value;
        if (value > 0) positive = to; else negative = to;
        const yFrom = frame.y(from);
        const yTo = frame.y(to);
        const inset = from === 0 ? 0 : GAP;
        bars.push(svg('path', {
          d: value > 0 ? columnPath(left, yFrom - inset, yTo, barWidth) : columnPath(left, yFrom + inset, yTo, barWidth),
          fill: slotColor(series.slot), class: 'ewmc-bar', title: `${category} · ${series.name}: ${model.valueText(value)}`,
        }));
      });
      if (!compact && count <= 10 && positive > 0) labels.push(svg('text', { x: fixed(left + barWidth / 2), y: fixed(frame.y(positive) - 4), class: 'ewmc-value', 'text-anchor': 'middle', text: model.valueText(positive) }));
      return;
    }
    barSeries.forEach((series, order) => {
      const value = series.values[index];
      if (value == null) return;
      const x = left + order * (barWidth + GAP);
      bars.push(svg('path', { d: columnPath(x, yZero, frame.y(value), barWidth), fill: slotColor(series.slot), class: 'ewmc-bar', title: `${category} · ${series.name}: ${model.valueText(value)}` }));
      if (!compact && barSeries.length === 1 && count <= 10) {
        labels.push(svg('text', { x: fixed(x + barWidth / 2), y: fixed(value >= 0 ? frame.y(value) - 4 : frame.y(value) + 12), class: 'ewmc-value', 'text-anchor': 'middle', text: model.valueText(value) }));
      }
    });
  });
  const lines = lineSeries.map(series => {
    const color = slotColor(series.slot);
    const points = series.values.map((value, index) => (value == null ? null : { x: frame.plot.x + index * slot + slot / 2, y: frame.y(value), value, label: model.categories[index] }));
    const runs = [];
    let current = [];
    for (const point of points) { if (!point) { if (current.length) runs.push(current); current = []; } else current.push(point); }
    if (current.length) runs.push(current);
    return svg('g', {},
      runs.map(run => svg('polyline', { points: run.map(point => `${fixed(point.x)},${fixed(point.y)}`).join(' '), stroke: color, class: 'ewmc-line' })),
      count <= 24 ? runs.flatMap(run => run.map(point => marker(point.x, point.y, color, `${point.label} · ${series.name}: ${model.valueText(point.value)}`))) : null);
  });
  const body = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'ewmc-svg' },
    gridLines(frame, scale, tick => model.valueText(tick)), xLabels(frame, model.categories, slot), bars, lines, labels);
  return figure(model.kind, model, body, { legendItems: model.series, compact });
}

function stackedScale(model) {
  let high = 0;
  let low = 0;
  model.categories.forEach((_, index) => {
    const values = model.series.map(series => series.values[index]).filter(value => value != null);
    high = Math.max(high, values.filter(value => value > 0).reduce((sum, value) => sum + value, 0));
    low = Math.min(low, values.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  });
  return niceScale(low, high);
}

function niceScale(min, max) {
  // Та сама логіка, що в ядрі, але без імпорту: стек рахується тут.
  const low = Math.min(0, min);
  let high = Math.max(low, max);
  if (high === low) high = low + 1;
  const span = high - low;
  const rough = span / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(unit => unit * power).find(unit => span / unit <= 4.5) ?? 10 * power;
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const ticks = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return { min: start, max: end === start ? start + step : end, step, ticks };
}

function horizontalBars(model, width, height, { compact }) {
  const rows = Math.max(1, model.categories.length);
  const labelWidth = Math.min(width * 0.32, Math.max(48, ...model.categories.map(label => textWidth(label) + 10)));
  const frame = cartesian(width, Math.max(height, rows * 26 + 20), model.scale, { left: labelWidth, bottom: 6, top: 6, right: 48 });
  const rowHeight = frame.plot.h / rows;
  const groups = Math.max(1, model.series.length);
  const barHeight = Math.min(compact ? 10 : 14, Math.max(3, (rowHeight * 0.7 - GAP * (groups - 1)) / groups));
  const groupHeight = barHeight * groups + GAP * (groups - 1);
  const xOf = value => frame.plot.x + (value - model.scale.min) / (model.scale.max - model.scale.min || 1) * frame.plot.w;
  const xZero = xOf(0);
  const body = svg('svg', { viewBox: `0 0 ${width} ${frame.plot.y + frame.plot.h + 6}`, width, height: frame.plot.y + frame.plot.h + 6, class: 'ewmc-svg' },
    model.scale.ticks.map(tick => svg('line', { x1: fixed(xOf(tick)), x2: fixed(xOf(tick)), y1: frame.plot.y, y2: frame.plot.y + frame.plot.h, class: tick === 0 ? 'ewmc-axis' : 'ewmc-grid' })),
    model.categories.map((category, index) => {
      const top = frame.plot.y + index * rowHeight + (rowHeight - groupHeight) / 2;
      return svg('g', {},
        svg('text', { x: frame.plot.x - 8, y: fixed(top + groupHeight / 2 + 3.5), class: 'ewmc-tick', 'text-anchor': 'end', text: truncate(category, labelWidth - 10), title: category }),
        model.series.map((series, order) => {
          const value = series.values[index];
          if (value == null) return null;
          const y = top + order * (barHeight + GAP);
          const end = xOf(value);
          return svg('g', {},
            svg('path', { d: barPath(xZero, end, y, barHeight), fill: slotColor(series.slot), class: 'ewmc-bar', title: `${category} · ${series.name}: ${model.valueText(value)}` }),
            !compact ? svg('text', { x: fixed(Math.max(xZero, end) + 5), y: fixed(y + barHeight / 2 + 3.5), class: 'ewmc-value', text: model.valueText(value) }) : null);
        }));
    }));
  return figure(model.kind, model, body, { legendItems: model.series, compact });
}

function divergingBars(model, width, height, { compact }) {
  const rows = Math.max(1, model.items.length);
  const labelWidth = Math.min(width * 0.3, Math.max(48, ...model.items.map(item => textWidth(item.label) + 10)));
  const frame = cartesian(width, Math.max(height, rows * 24 + 16), model.scale, { left: labelWidth, bottom: 6, top: 6, right: 40 });
  const rowHeight = frame.plot.h / rows;
  const barHeight = Math.min(14, rowHeight * 0.66);
  const xOf = value => frame.plot.x + (value - model.scale.min) / (model.scale.max - model.scale.min || 1) * frame.plot.w;
  const xZero = xOf(0);
  const total = frame.plot.y + frame.plot.h + 6;
  const body = svg('svg', { viewBox: `0 0 ${width} ${total}`, width, height: total, class: 'ewmc-svg' },
    svg('line', { x1: fixed(xZero), x2: fixed(xZero), y1: frame.plot.y, y2: frame.plot.y + frame.plot.h, class: 'ewmc-axis' }),
    model.items.map((item, index) => {
      const y = frame.plot.y + index * rowHeight + (rowHeight - barHeight) / 2;
      const value = item.value ?? 0;
      const end = xOf(value);
      const color = value >= 0 ? 'var(--ewmc-pos)' : 'var(--ewmc-neg)';
      return svg('g', {},
        svg('text', { x: frame.plot.x - 8, y: fixed(y + barHeight / 2 + 3.5), class: 'ewmc-tick', 'text-anchor': 'end', text: truncate(item.label, labelWidth - 10), title: item.label }),
        svg('path', { d: barPath(xZero, end, y, barHeight), fill: color, class: 'ewmc-bar', title: `${item.label}: ${model.valueText(value)}` }),
        !compact ? svg('text', {
          x: fixed(value >= 0 ? end + 5 : end - 5), y: fixed(y + barHeight / 2 + 3.5), class: 'ewmc-value', 'text-anchor': value >= 0 ? 'start' : 'end', text: model.valueText(value),
        }) : null);
    }));
  const footer = el('p', { class: 'ewmc-chart-foot' },
    el('span', {}, el('i', { style: { background: 'var(--ewmc-pos)' } }), `Приріст ${model.valueText(model.positive)}`),
    el('span', {}, el('i', { style: { background: 'var(--ewmc-neg)' } }), `Втрати ${model.valueText(model.negative)}`));
  return figure(model.kind, model, body, { footer: compact ? null : footer, compact });
}

function donut(model, width, height, { compact }) {
  const size = Math.min(height, compact ? 110 : 150);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const stroke = compact ? 14 : 18;
  let angle = -Math.PI / 2;
  const arcs = model.slices.map(slice => {
    const sweep = slice.percent / 100 * Math.PI * 2;
    const start = angle;
    angle += sweep;
    if (sweep <= 0) return null;
    const end = sweep >= Math.PI * 2 ? start + Math.PI * 2 - 0.0001 : angle;
    return svg('path', { d: arcPath(cx, cy, r - stroke / 2, start, end), stroke: slotColor(slice.slot), 'stroke-width': stroke, fill: 'none', class: 'ewmc-arc', title: `${slice.label}: ${slice.text} (${Math.round(slice.percent)} %)` });
  });
  const ring = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ewmc-svg' },
    svg('circle', { cx, cy, r: r - stroke / 2, fill: 'none', stroke: 'var(--ewmc-track)', 'stroke-width': stroke }),
    arcs,
    svg('text', { x: cx, y: cy + (compact ? 4 : 0), class: 'ewmc-hero-small', 'text-anchor': 'middle', text: model.totalText }),
    !compact ? svg('text', { x: cx, y: cy + 15, class: 'ewmc-tick', 'text-anchor': 'middle', text: 'разом' }) : null);
  const list = el('ul', { class: 'ewmc-slices' }, model.slices.map(slice => el('li', {},
    el('i', { style: { background: slotColor(slice.slot) } }),
    el('span', { class: 'ewmc-slice-label', text: slice.label }),
    el('b', { text: `${Math.round(slice.percent)} %` }),
    compact ? null : el('small', { text: slice.text }))));
  return figure('donut', model, el('div', { class: 'ewmc-donut' }, ring, list), { compact });
}

function ringGauge(item, size, stroke) {
  const cx = size / 2;
  const r = size / 2 - stroke / 2 - 2;
  const sweep = item.percent / 100 * Math.PI * 2;
  return svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ewmc-svg' },
    svg('circle', { cx, cy: cx, r, fill: 'none', stroke: 'var(--ewmc-track)', 'stroke-width': stroke }),
    sweep > 0 ? svg('path', { d: arcPath(cx, cx, r, -Math.PI / 2, -Math.PI / 2 + Math.min(sweep, Math.PI * 2 - 0.0001)), stroke: slotColor(item.slot), 'stroke-width': stroke, fill: 'none', 'stroke-linecap': 'round', class: 'ewmc-arc', title: `${item.label}: ${item.currentText}${item.targetText ? ` з ${item.targetText}` : ''}` }) : null,
    svg('text', { x: cx, y: cx + 5, class: 'ewmc-hero-small', 'text-anchor': 'middle', text: `${Math.round(item.percent)} %` }));
}

function radialProgress(model, width, height, { compact }) {
  const items = model.items.length ? model.items : [{ label: '—', percent: 0, currentText: '—', targetText: '', slot: 1 }];
  const size = compact ? 72 : Math.min(112, Math.max(72, (width - 24) / items.length - 12));
  return figure('radial-progress', model, el('div', { class: 'ewmc-rings' }, items.map(item => el('div', { class: 'ewmc-ring-item' },
    ringGauge(item, size, compact ? 8 : 10),
    el('b', { text: item.label }),
    compact ? null : el('small', { text: item.targetText ? `${item.currentText} з ${item.targetText}` : item.currentText })))), { compact });
}

function multiRing(model, width, height, { compact }) {
  const items = model.items.length ? model.items : [{ label: '—', percent: 0, currentText: '—', targetText: '', slot: 1 }];
  const size = compact ? 104 : 150;
  const stroke = compact ? 8 : 10;
  const cx = size / 2;
  const rings = items.map((item, index) => {
    const r = size / 2 - stroke / 2 - 2 - index * (stroke + 3);
    if (r <= stroke) return null;
    const sweep = item.percent / 100 * Math.PI * 2;
    return svg('g', {},
      svg('circle', { cx, cy: cx, r, fill: 'none', stroke: 'var(--ewmc-track)', 'stroke-width': stroke }),
      sweep > 0 ? svg('path', { d: arcPath(cx, cx, r, -Math.PI / 2, -Math.PI / 2 + Math.min(sweep, Math.PI * 2 - 0.0001)), stroke: slotColor(item.slot), 'stroke-width': stroke, fill: 'none', 'stroke-linecap': 'round', class: 'ewmc-arc', title: `${item.label}: ${Math.round(item.percent)} %` }) : null);
  });
  const picture = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ewmc-svg' }, rings);
  const list = el('ul', { class: 'ewmc-slices' }, items.map(item => el('li', {},
    el('i', { style: { background: slotColor(item.slot) } }),
    el('span', { class: 'ewmc-slice-label', text: item.label }),
    el('b', { text: `${Math.round(item.percent)} %` }),
    compact ? null : el('small', { text: item.targetText ? `${item.currentText} з ${item.targetText}` : item.currentText }))));
  return figure('multi-ring', model, el('div', { class: 'ewmc-donut' }, picture, list), { compact });
}

function gauge(model, width, height, { compact }) {
  const size = compact ? 150 : Math.min(220, width - 16);
  const stroke = compact ? 10 : 14;
  const cx = size / 2;
  const r = size / 2 - stroke / 2 - 4;
  const cy = r + stroke / 2 + 4;
  const start = Math.PI;
  const end = Math.PI * 2;
  const sweep = model.ratio * Math.PI;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    const outer = polar(cx, cy, r + stroke / 2 + 3, start + ratio * Math.PI);
    const inner = polar(cx, cy, r + stroke / 2 + 8, start + ratio * Math.PI);
    return svg('line', { x1: fixed(outer.x), y1: fixed(outer.y), x2: fixed(inner.x), y2: fixed(inner.y), class: 'ewmc-grid' });
  });
  const needleEnd = polar(cx, cy, r - stroke, start + sweep);
  const picture = svg('svg', { viewBox: `0 0 ${size} ${cy + 24}`, width: size, height: cy + 24, class: 'ewmc-svg' },
    svg('path', { d: arcPath(cx, cy, r, start, end - 0.0001), stroke: 'var(--ewmc-track)', 'stroke-width': stroke, fill: 'none', 'stroke-linecap': 'round' }),
    sweep > 0 ? svg('path', { d: arcPath(cx, cy, r, start, start + sweep), stroke: slotColor(1), 'stroke-width': stroke, fill: 'none', 'stroke-linecap': 'round', class: 'ewmc-arc', title: `${model.label}: ${model.valueText} з ${model.maxText}` }) : null,
    ticks,
    svg('line', { x1: cx, y1: cy, x2: fixed(needleEnd.x), y2: fixed(needleEnd.y), class: 'ewmc-needle' }),
    svg('circle', { cx, cy, r: 4, class: 'ewmc-needle-cap' }),
    svg('text', { x: cx, y: cy - (compact ? 14 : 22), class: compact ? 'ewmc-hero-small' : 'ewmc-hero', 'text-anchor': 'middle', text: model.valueText }),
    svg('text', { x: cx - r, y: cy + 16, class: 'ewmc-tick', 'text-anchor': 'middle', text: model.minText }),
    svg('text', { x: cx + r, y: cy + 16, class: 'ewmc-tick', 'text-anchor': 'middle', text: model.maxText }));
  return figure('gauge', model, el('div', { class: 'ewmc-gauge' }, picture, el('b', { text: model.label })), { compact });
}

function progressBars(model, width, height, { compact }) {
  const items = model.items.length ? model.items : [];
  return figure('progress-bars', model, el('ul', { class: 'ewmc-progress' }, items.map(item => el('li', {},
    el('span', { class: 'ewmc-progress-label', text: item.label, title: item.label }),
    el('span', { class: 'ewmc-meter', style: { '--ewmc-c': slotColor(item.slot) }, title: `${item.label}: ${item.currentText}${item.targetText ? ` з ${item.targetText}` : ''}` },
      el('i', { style: { width: `${item.percent}%` } })),
    compact ? null : el('b', { text: item.targetText ? `${item.currentText} / ${item.targetText}` : item.currentText }),
    el('small', { text: `${Math.round(item.percent)} %` })))), { compact });
}

function radar(model, width, height, { compact }) {
  const axes = model.axes.length >= 3 ? model.axes : [...model.axes, ...Array.from({ length: 3 - model.axes.length }, () => '')];
  const size = Math.min(height, compact ? 120 : 190);
  // Підписи осей лежать по боках: малюнок бере всю ширину картки, щоб їм було місце.
  const total = compact ? size : Math.max(size + 80, width);
  const labelRoom = Math.max(0, (total - size) / 2 - 6);
  const cx = total / 2;
  const cy = size / 2 + (compact ? 0 : 10);
  const r = size / 2 - 6;
  const viewHeight = size + (compact ? 0 : 20);
  const count = axes.length;
  const angle = index => -Math.PI / 2 + index * Math.PI * 2 / count;
  const ringPath = ratio => `M${axes.map((_, index) => { const point = polar(cx, cy, r * ratio, angle(index)); return `${fixed(point.x)} ${fixed(point.y)}`; }).join(' L')} Z`;
  const picture = svg('svg', { viewBox: `0 0 ${total} ${viewHeight}`, width: total, height: viewHeight, class: 'ewmc-svg' },
    [0.25, 0.5, 0.75, 1].map(ratio => svg('path', { d: ringPath(ratio), class: 'ewmc-grid', fill: 'none' })),
    axes.map((_, index) => { const point = polar(cx, cy, r, angle(index)); return svg('line', { x1: cx, y1: cy, x2: fixed(point.x), y2: fixed(point.y), class: 'ewmc-grid' }); }),
    model.series.map(series => {
      const color = slotColor(series.slot);
      const points = axes.map((_, index) => polar(cx, cy, r * (series.ratios[index] ?? 0), angle(index)));
      return svg('g', {},
        svg('path', { d: `M${points.map(point => `${fixed(point.x)} ${fixed(point.y)}`).join(' L')} Z`, fill: color, stroke: color, class: 'ewmc-radar-shape' }),
        points.map((point, index) => (series.values[index] == null ? null : marker(point.x, point.y, color, `${axes[index]} · ${series.name}: ${model.valueText(series.values[index])}`))));
    }),
    compact ? null : axes.map((axis, index) => {
      const point = polar(cx, cy, r + 14, angle(index));
      const anchor = Math.abs(Math.cos(angle(index))) < 0.2 ? 'middle' : Math.cos(angle(index)) > 0 ? 'start' : 'end';
      return svg('text', { x: fixed(point.x), y: fixed(point.y + 3.5), class: 'ewmc-tick', 'text-anchor': anchor, text: truncate(axis, anchor === 'middle' ? size * 0.9 : labelRoom + 4) });
    }));
  return figure('radar', model, el('div', { class: 'ewmc-center' }, picture), { legendItems: model.series, compact });
}

function calendar(model, width, height, { compact }) {
  const head = el('div', { class: 'ewmc-cal-head' }, el('b', { text: model.title || 'Календар' }), model.note ? el('small', { text: model.note }) : null);
  const grid = el('div', { class: 'ewmc-cal' },
    model.days.map(day => el('span', { class: 'ewmc-cal-day', text: day })),
    model.weeks.flatMap(week => week.map(cell => {
      if (!cell) return el('span', { class: 'ewmc-cal-blank' });
      const ratio = cell.value == null || !model.max ? 0 : Math.max(0.18, cell.value / model.max);
      return el('span', {
        class: `ewmc-cal-cell${cell.value == null ? '' : ' has-value'}`,
        style: cell.value == null ? null : { '--ewmc-a': ratio.toFixed(2) },
        title: cell.value == null ? `${cell.day}: без записів` : `${cell.day}: ${cell.text}`,
        text: String(cell.day),
      });
    })));
  return figure('calendar', model, el('div', { class: 'ewmc-cal-wrap' }, compact ? null : head, grid), { compact });
}

function cohort(model, width, height, { compact }) {
  const span = model.max - model.min || 1;
  const table = el('div', { class: 'ewmc-cohort', style: { gridTemplateColumns: `minmax(56px,auto) repeat(${Math.max(1, model.periods.length)}, minmax(0,1fr))` } },
    el('span', { class: 'ewmc-cohort-head' }),
    model.periods.map(period => el('span', { class: 'ewmc-cohort-head', text: period, title: period })),
    model.cohorts.flatMap((cohortName, rowIndex) => [
      el('span', { class: 'ewmc-cohort-label', text: cohortName, title: cohortName }),
      ...model.periods.map((period, colIndex) => {
        const value = model.grid[rowIndex][colIndex];
        if (value == null) return el('span', { class: 'ewmc-cohort-cell empty' });
        const ratio = 0.15 + (value - model.min) / span * 0.75;
        return el('span', { class: 'ewmc-cohort-cell', style: { '--ewmc-a': ratio.toFixed(2) }, title: `${cohortName} · ${period}: ${model.text(value)}`, text: compact ? '' : model.text(value) });
      }),
    ]));
  return figure('cohort', model, table, { compact, footer: model.truncated && !compact ? el('p', { class: 'ewmc-chart-foot', text: 'Показано перші 8 когорт і періодів.' }) : null });
}

function statusChip(status, tone) {
  if (!status) return null;
  return el('span', { class: `ewmc-status${tone ? ` ${tone}` : ''}` }, el('i'), status);
}

function table(model, width, height, { compact }) {
  const rows = model.items.map(item => el('li', {},
    el('span', { class: 'ewmc-row-label', text: item.label, title: item.label }),
    model.hasProgress ? el('span', { class: 'ewmc-meter small', style: { '--ewmc-c': slotColor(1) }, title: item.progress == null ? '' : `${Math.round(item.progress)} %` }, el('i', { style: { width: `${item.progress ?? 0}%` } })) : null,
    el('b', { text: item.valueText }),
    statusChip(item.status, item.tone),
    !compact && item.note ? el('small', { text: item.note, title: item.note }) : null));
  const footer = model.more && !compact ? el('p', { class: 'ewmc-chart-foot', text: `…і ще ${model.more}` }) : null;
  return figure('table', model, el('ul', { class: `ewmc-rows${model.hasProgress ? ' with-progress' : ''}` }, rows), { compact, footer });
}

function funnel(model, width, height, { compact }) {
  const stages = model.stages;
  return figure('funnel', model, el('ul', { class: 'ewmc-funnel' }, stages.map((stage, index) => el('li', {},
    el('span', { class: 'ewmc-funnel-bar', style: { width: `${Math.max(8, stage.ratio * 100)}%`, '--ewmc-a': (1 - index * 0.11).toFixed(2) }, title: `${stage.label}: ${stage.text} (${Math.round(stage.percent)} %)` }),
    el('span', { class: 'ewmc-funnel-text' }, el('b', { text: stage.label }), compact ? null : el('small', { text: `${stage.text} · ${Math.round(stage.percent)} %` }))))), { compact });
}

function mapChart(model, width, height, { compact }) {
  const bounds = { ...UKRAINE_BOUNDS };
  for (const point of model.points) {
    bounds.west = Math.min(bounds.west, point.longitude - 0.5);
    bounds.east = Math.max(bounds.east, point.longitude + 0.5);
    bounds.south = Math.min(bounds.south, point.latitude - 0.3);
    bounds.north = Math.max(bounds.north, point.latitude + 0.3);
  }
  const midLat = (bounds.north + bounds.south) / 2 * Math.PI / 180;
  const spanX = (bounds.east - bounds.west) * Math.cos(midLat);
  const spanY = bounds.north - bounds.south;
  const pad = 8;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const drawW = spanX * scale;
  const drawH = spanY * scale;
  const offsetX = (width - drawW) / 2;
  const offsetY = (height - drawH) / 2;
  const project = (lon, lat) => ({ x: offsetX + (lon - bounds.west) * Math.cos(midLat) * scale, y: offsetY + (bounds.north - lat) * scale });
  const outline = UKRAINE_OUTLINE.map(ring => svg('path', {
    d: `M${ring.map(([lon, lat]) => { const point = project(lon, lat); return `${fixed(point.x)} ${fixed(point.y)}`; }).join(' L')} Z`,
    class: 'ewmc-land',
  }));
  const labelled = model.points.length <= 8;
  const points = model.points.map(point => {
    const position = project(point.longitude, point.latitude);
    const radius = 4 + point.weight * (compact ? 5 : 8);
    return svg('g', {},
      svg('circle', { cx: fixed(position.x), cy: fixed(position.y), r: fixed(radius + 2), class: 'ewmc-dot-ring' }),
      svg('circle', { cx: fixed(position.x), cy: fixed(position.y), r: fixed(radius), fill: toneColor(point.tone) ?? slotColor(1), class: 'ewmc-dot', title: `${point.label || 'Точка'}${point.valueText !== '—' ? `: ${point.valueText}` : ''}${point.status ? ` · ${point.status}` : ''}` }),
      labelled && !compact && point.label ? svg('text', { x: fixed(position.x + radius + 4), y: fixed(position.y + 3.5), class: 'ewmc-value', text: truncate(point.label, 90) }) : null);
  });
  const body = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'ewmc-svg' }, outline, points);
  const footer = model.skipped && !compact ? el('p', { class: 'ewmc-chart-foot', text: `Без координат: ${model.skipped}` }) : null;
  return figure('map', model, body, { compact, footer });
}

function activity(model, width, height, { compact }) {
  return figure('activity', model, el('ul', { class: 'ewmc-feed' }, model.items.map(item => el('li', {},
    el('time', { text: item.time }),
    el('i', { class: `ewmc-dot-tone${item.tone ? ` ${item.tone}` : ''}` }),
    el('span', { class: 'ewmc-row-label', text: item.label, title: item.label }),
    statusChip(compact ? '' : item.status, item.tone),
    item.valueText ? el('b', { text: item.valueText }) : null))), { compact, footer: model.more && !compact ? el('p', { class: 'ewmc-chart-foot', text: `…і ще ${model.more}` }) : null });
}

function waveform(model, width, height, { compact }) {
  const frame = { plot: { x: 40, y: 8, w: width - 52, h: height - 30 } };
  const mid = frame.plot.y + frame.plot.h / 2;
  const half = frame.plot.h / 2 - 2;
  const count = Math.max(1, model.points.length);
  const slot = frame.plot.w / count;
  const barWidth = Math.min(BAR_MAX, Math.max(2, slot - GAP));
  const scaleY = value => value / (model.max || 1) * half;
  const body = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'ewmc-svg' },
    svg('line', { x1: frame.plot.x, x2: frame.plot.x + frame.plot.w, y1: fixed(mid), y2: fixed(mid), class: 'ewmc-axis' }),
    svg('text', { x: frame.plot.x - 6, y: fixed(frame.plot.y + 8), class: 'ewmc-tick', 'text-anchor': 'end', text: model.valueText(model.max) }),
    svg('text', { x: frame.plot.x - 6, y: fixed(frame.plot.y + frame.plot.h - 2), class: 'ewmc-tick', 'text-anchor': 'end', text: model.valueText(model.max) }),
    model.points.map((point, index) => {
      const x = frame.plot.x + index * slot + (slot - barWidth) / 2;
      return svg('g', {},
        point.up > 0 ? svg('path', { d: columnPath(x, mid - GAP / 2, mid - GAP / 2 - scaleY(point.up), barWidth, 3), fill: slotColor(1), class: 'ewmc-bar', title: `${point.label} · ${model.upLabel}: ${model.valueText(point.up)}` }) : null,
        point.down > 0 ? svg('path', { d: columnPath(x, mid + GAP / 2, mid + GAP / 2 + scaleY(point.down), barWidth, 3), fill: slotColor(2), class: 'ewmc-bar', title: `${point.label} · ${model.downLabel}: ${model.valueText(point.down)}` }) : null);
    }),
    xLabels({ plot: frame.plot, y: () => mid }, model.points.map(point => point.label), slot));
  return figure('waveform', model, body, { legendItems: [{ name: model.upLabel, slot: 1 }, { name: model.downLabel, slot: 2 }], compact });
}

function kpi(model, width, height, { compact }) {
  const spark = model.history.length > 1 ? (() => {
    const w = compact ? 120 : Math.min(240, width - 24);
    const h = compact ? 28 : 40;
    const min = Math.min(model.historyMin, ...model.history);
    const span = (model.historyMax - min) || 1;
    const points = model.history.map((value, index) => ({ x: 4 + index * ((w - 8) / (model.history.length - 1)), y: h - 4 - (value - min) / span * (h - 8) }));
    const last = points.at(-1);
    return svg('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'ewmc-svg ewmc-spark' },
      svg('polyline', { points: points.map(point => `${fixed(point.x)},${fixed(point.y)}`).join(' '), class: 'ewmc-line ewmc-spark-line' }),
      svg('circle', { cx: fixed(last.x), cy: fixed(last.y), r: 4, class: 'ewmc-marker ewmc-spark-dot' }));
  })() : null;
  const tone = model.delta == null ? '' : model.delta > 0 ? 'good' : model.delta < 0 ? 'bad' : 'neutral';
  return figure('kpi', model, el('div', { class: 'ewmc-kpi-tile' },
    el('span', { class: 'ewmc-kpi-label', text: model.label }),
    el('div', { class: 'ewmc-kpi-row' },
      el('strong', { class: compact ? 'ewmc-kpi-value small' : 'ewmc-kpi-value', text: model.valueText }),
      model.unit ? el('span', { class: 'ewmc-kpi-unit', text: model.unit }) : null,
      model.deltaText ? el('span', { class: `ewmc-delta ${tone}`, text: model.deltaText }) : null),
    spark), { compact });
}

function leaderboard(model, width, height, { compact }) {
  return figure('leaderboard', model, el('ol', { class: 'ewmc-board' }, model.items.map(item => el('li', {},
    el('span', { class: 'ewmc-rank', text: String(item.rank) }),
    el('span', { class: 'ewmc-avatar', style: { background: slotColor(item.rank) }, text: item.initials, 'aria-hidden': 'true' }),
    el('span', { class: 'ewmc-board-name' }, el('b', { text: item.label, title: item.label }), item.group ? el('small', { text: item.group }) : null),
    el('span', { class: 'ewmc-meter small', style: { '--ewmc-c': slotColor(1) } }, el('i', { style: { width: `${item.ratio * 100}%` } })),
    el('b', { class: 'ewmc-board-value', text: item.valueText }),
    item.deltaText && !compact ? el('span', { class: `ewmc-delta ${item.delta > 0 ? 'good' : item.delta < 0 ? 'bad' : 'neutral'}`, text: item.deltaText }) : null))), { compact });
}

// «Метеоумови»: темна карта з ізолініями хмарності, виноски на пунктах, шкала часу з
// небезпечними моментами й рядок показників (стиль погодних дашбордів). Кадр перемикається
// кнопками шкали без повторного читання бази: усі кадри вже є в моделі.
const ISOLINE_CLASS = { 3: 'low', 6: 'mid', 8: 'high' };
let weatherClipSeed = 0;

function weatherMap(frame, width, height, { compact }) {
  const bounds = { ...frame.grid.bounds };
  for (const station of frame.stations) {
    bounds.west = Math.min(bounds.west, station.longitude - 0.4);
    bounds.east = Math.max(bounds.east, station.longitude + 0.4);
    bounds.south = Math.min(bounds.south, station.latitude - 0.3);
    bounds.north = Math.max(bounds.north, station.latitude + 0.3);
  }
  const midLat = (bounds.north + bounds.south) / 2 * Math.PI / 180;
  const spanX = (bounds.east - bounds.west) * Math.cos(midLat);
  const spanY = bounds.north - bounds.south;
  const pad = 6;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = (lon, lat) => ({ x: offsetX + (lon - bounds.west) * Math.cos(midLat) * scale, y: offsetY + (bounds.north - lat) * scale });
  const { grid } = frame;
  const gridPoint = (col, row) => project(
    grid.bounds.west + col / (grid.cols - 1) * (grid.bounds.east - grid.bounds.west),
    grid.bounds.north - row / (grid.rows - 1) * (grid.bounds.north - grid.bounds.south));
  const outlinePath = UKRAINE_OUTLINE.map(ring => `M${ring.map(([lon, lat]) => { const point = project(lon, lat); return `${fixed(point.x)} ${fixed(point.y)}`; }).join(' L')} Z`).join('');
  const outline = svg('path', { d: outlinePath, class: 'ewmc-wx-land' });
  // Ізолінії обрізаються контуром: за кордоном пунктів немає, і хмарність там не вгадується.
  const clipId = `ewmc-wx-clip-${++weatherClipSeed}`;
  const clip = svg('defs', {}, svg('clipPath', { id: clipId }, svg('path', { d: outlinePath })));
  const isolines = frame.isolines.filter(line => line.segments.length).map(line => {
    const d = line.segments.map(([x1, y1, x2, y2]) => {
      const a = gridPoint(x1, y1); const b = gridPoint(x2, y2);
      return `M${fixed(a.x)} ${fixed(a.y)}L${fixed(b.x)} ${fixed(b.y)}`;
    }).join('');
    const kind = ISOLINE_CLASS[line.level] || 'mid';
    return svg('g', { class: `ewmc-wx-iso ${kind}` },
      svg('path', { d, class: 'ewmc-wx-iso-glow' }),
      svg('path', { d, class: 'ewmc-wx-iso-line' }, svgTitle(`Хмарність ${line.level}/10`)));
  });
  const placed = [];
  const overlaps = box => placed.some(other => box.x < other.x + other.w + 3 && other.x < box.x + box.w + 3 && box.y < other.y + other.h + 3 && other.y < box.y + box.h + 3);
  const labelled = compact ? [] : frame.stations
    .map((station, index) => ({ station, index, rank: station.tone === 'bad' ? 0 : station.tone === 'warn' ? 1 : 2 }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, 6)
    .map(item => item.station);
  const callouts = [];
  const dots = frame.stations.map(station => {
    const position = project(station.longitude, station.latitude);
    const tone = station.tone || 'calm';
    const title = `${station.label}: ${station.callout}${station.reasons.length ? ` · ${station.reasons.join(', ')}` : ''}`;
    if (labelled.includes(station)) {
      const name = truncate(station.label, 96, 10);
      const detail = truncate(station.callout, 132, 10);
      const boxW = Math.max(textWidth(name, 10), textWidth(detail, 10)) + 14;
      const boxH = 30;
      // Перше вільне місце: праворуч чи ліворуч від пункту, вище чи нижче, далі — зсув по вертикалі.
      const candidates = [];
      for (const shift of [0, 1, -1, 2, -2, 3, -3]) {
        for (const side of [1, -1]) {
          const x = side > 0 ? position.x + 10 : position.x - 10 - boxW;
          const y = position.y - boxH - 6 + shift * (boxH + 4);
          candidates.push({ x, y, w: boxW, h: boxH, right: side > 0 });
        }
      }
      const inside = box => box.x >= 2 && box.x + box.w <= width - 2 && box.y >= 2 && box.y + box.h <= height - 2;
      const spot = candidates.find(box => inside(box) && !overlaps(box)) || null;
      if (!spot) return svg('g', { class: `ewmc-wx-station ${tone}` },
        station.tone ? svg('circle', { cx: fixed(position.x), cy: fixed(position.y), r: 10, class: 'ewmc-wx-halo' }) : null,
        svg('circle', { cx: fixed(position.x), cy: fixed(position.y), r: 4, class: 'ewmc-wx-dot' }, svgTitle(title)));
      placed.push(spot);
      const { x, y, right } = spot;
      callouts.push(svg('g', { class: `ewmc-wx-callout ${tone}` },
        svg('line', { x1: fixed(position.x), y1: fixed(position.y), x2: fixed(right ? x : x + boxW), y2: fixed(y + boxH / 2), class: 'ewmc-wx-leader' }),
        svg('rect', { x: fixed(x), y: fixed(y), width: fixed(boxW), height: boxH, rx: 3, class: 'ewmc-wx-plaque' }),
        svg('text', { x: fixed(x + 7), y: fixed(y + 12), class: 'ewmc-wx-plaque-name', text: name }),
        svg('text', { x: fixed(x + 7), y: fixed(y + 24), class: 'ewmc-wx-plaque-text', text: detail })));
    }
    return svg('g', { class: `ewmc-wx-station ${tone}` },
      station.tone ? svg('circle', { cx: fixed(position.x), cy: fixed(position.y), r: compact ? 7 : 10, class: 'ewmc-wx-halo' }) : null,
      svg('circle', { cx: fixed(position.x), cy: fixed(position.y), r: compact ? 3 : 4, class: 'ewmc-wx-dot' }, svgTitle(title)));
  });
  return svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'ewmc-svg ewmc-wx-map', role: 'img', 'aria-label': `Карта хмарності на ${frame.label}` },
    clip, outline, svg('g', { 'clip-path': `url(#${clipId})` }, isolines), dots, callouts);
}

function weatherChart(model, width, height, { compact }) {
  const root = el('figure', { class: `ewmc-chart ewmc-chart-weather${compact ? ' compact' : ''}`, 'aria-label': chartSummary(model) });
  if (!model.frames.length) {
    root.append(el('p', { class: 'ewmc-chart-foot', text: model.empty ? 'Спостережень ще немає.' : 'Немає спостережень із часом і координатами.' }));
    return root;
  }
  const paint = () => {
    const frame = model.frames[model.current] ?? model.frames.at(-1);
    const stripH = compact ? 34 : 40;
    const timeH = compact || model.frames.length < 2 ? 0 : 34;
    const mapH = Math.max(80, height - stripH - timeH - (compact ? 6 : 14));
    const head = compact ? null : el('div', { class: 'ewmc-wx-head' },
      el('b', { text: frame.label }),
      el('span', { text: `${frame.stations.length} ${pluralForm(frame.stations.length, 'пункт', 'пункти', 'пунктів')}` }),
      frame.hazardText ? el('span', { class: `ewmc-wx-alert ${frame.tone}`, text: frame.hazardText, title: frame.hazardText }) : el('span', { class: 'ewmc-wx-alert calm', text: 'Небезпечних явищ немає' }));
    const legendNode = compact ? null : el('ul', { class: 'ewmc-wx-legend', 'aria-label': 'Ізолінії хмарності' },
      [3, 6, 8].map(level => el('li', {}, el('i', { class: `ewmc-wx-key ${ISOLINE_CLASS[level]}` }), el('span', { text: `${level}/10` }))));
    const timeline = timeH ? el('div', { class: 'ewmc-wx-time', role: 'group', 'aria-label': 'Шкала часу спостережень' },
      model.frames.map((item, index) => el('button', {
        type: 'button',
        class: `ewmc-wx-tick${item.tone ? ` ${item.tone}` : ''}${index === model.current ? ' active' : ''}`,
        'aria-pressed': index === model.current ? 'true' : 'false',
        'aria-label': `${item.label}${item.hazardText ? `, ${item.hazardText}` : ''}`,
        title: `${item.label}${item.hazardText ? ` · ${item.hazardText}` : ''}`,
        onclick: () => { model.current = index; paint(); root.querySelector('.ewmc-wx-tick.active')?.focus(); },
      }, el('i'), el('small', { text: item.short })))) : null;
    const strip = el('dl', { class: 'ewmc-wx-strip' }, frame.summary.map(cell => el('div', { class: `ewmc-wx-cell${cell.tone ? ` ${cell.tone}` : ''}`, title: `${cell.label} (${cell.note})` },
      el('dt', { text: cell.label }),
      el('dd', { text: cell.valueText }))));
    const foot = !compact && model.skipped ? el('p', { class: 'ewmc-chart-foot', text: `Без часу чи координат: ${model.skipped}` }) : null;
    root.replaceChildren(...[head, el('div', { class: 'ewmc-wx-stage' }, weatherMap(frame, width, mapH, { compact }), legendNode), timeline, strip, foot].filter(Boolean));
  };
  paint();
  return root;
}

const RENDERERS = {
  kpi,
  line: seriesLines,
  area: seriesLines,
  columns,
  'stacked-columns': columns,
  'grouped-columns': columns,
  combo: columns,
  'horizontal-bar': horizontalBars,
  'diverging-bars': divergingBars,
  donut,
  'radial-progress': radialProgress,
  'multi-ring': multiRing,
  gauge,
  'progress-bars': progressBars,
  radar,
  calendar,
  cohort,
  table,
  funnel,
  map: mapChart,
  activity,
  waveform,
  leaderboard,
  weather: weatherChart,
};

/** Малює модель у задану ширину й висоту (пікселі). Невідомий вид — таблиця. */
export function renderChart(model, { width = 320, height = 168, compact = false } = {}) {
  const render = RENDERERS[model?.kind] ?? table;
  const safeWidth = Math.max(160, Math.round(width));
  const safeHeight = Math.max(90, Math.round(height));
  try {
    return render(model, safeWidth, safeHeight, { compact });
  } catch (error) {
    // Малювання не має валити дашборд: показуємо таблицю з того, що є.
    const fallback = { kind: 'table', empty: !model || model.empty, items: [], more: 0, hasProgress: false, hasStatus: false, rowCount: model?.rowCount ?? 0 };
    const node = table(fallback, safeWidth, safeHeight, { compact });
    node.dataset.renderError = String(error?.message ?? error);
    return node;
  }
}

// Один спостерігач на всі картки: перемальовує діаграму, коли змінюється ширина контейнера.
const mounted = new WeakMap();
let observer = null;

/** Ширина вмісту контейнера без внутрішніх відступів; 0, поки картка не в документі. */
function innerWidth(container) {
  if (!container.isConnected || !container.clientWidth) return 0;
  const style = getComputedStyle(container);
  return Math.max(0, container.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0'));
}

function draw(container) {
  const entry = mounted.get(container);
  if (!entry) return;
  const width = innerWidth(container) || entry.options.width || 320;
  if (entry.width === width) return;
  entry.width = width;
  container.replaceChildren(renderChart(entry.model, { ...entry.options, width }));
}

/**
 * Вставляє діаграму в контейнер і стежить за його шириною. Повторний виклик для того самого
 * контейнера замінює модель. Від'єднані контейнери спостерігач забуває сам.
 */
export function mountChart(container, model, options = {}) {
  mounted.set(container, { model, options, width: 0 });
  if (typeof ResizeObserver === 'function') {
    observer ??= new ResizeObserver(entries => {
      for (const { target } of entries) {
        if (!target.isConnected) { observer.unobserve(target); mounted.delete(target); continue; }
        draw(target);
      }
    });
    observer.observe(container);
  }
  draw(container);
  return container;
}

export const dashboardModuleCharts = { renderChart, mountChart };
