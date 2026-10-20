// Спільні DOM-помічники оболонки й сторінки застосунку: іконки застосунків (SVG з APP_ICONS
// через createElementNS) і стрілка дії картки.
import { APP_ICONS } from './workspace-core.js';

const SVG = 'http://www.w3.org/2000/svg';

function svg(doc, size) {
  const node = doc.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  })) node.setAttribute(name, value);
  return node;
}

function shapes(doc, node, list) {
  for (const [tag, attrs] of list) {
    const shape = doc.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
    node.append(shape);
  }
  return node;
}

/** Іконка застосунку `id` розміром `size` px (24 або 48). */
export function appIcon(doc, id, size) {
  return shapes(doc, svg(doc, size), APP_ICONS[id] || []);
}

/** Стрілка «↗» дії картки. */
export function arrowIcon(doc) {
  const node = svg(doc, 18);
  node.setAttribute('stroke-width', '1.7');
  return shapes(doc, node, [['path', { d: 'M5 19 19 5M8 5h11v11' }]]);
}

export function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
