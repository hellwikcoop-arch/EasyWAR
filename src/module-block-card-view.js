// Вигляд картки блока з основної таблиці (E5): одна тонка рамка, як на сучасних аналітичних панелях. Показник —
// число з тоном за змістом (як на вкладці РВ), зміна, плитки й кільце частки від пусків; діаграма — той самий
// малюнок, що й у шаблонах, без внутрішньої коробки. Налаштування картки сховано за «⋯». Числа рахує
// module-block-card-core.js; тут лише DOM через `textContent`. Стилі — public/module-styles.css (лише в застосунку).

import { CARD_PALETTES } from './module-block-card-core.js';

const SVG = 'http://www.w3.org/2000/svg';
const PALETTE_TONES = new Set(['branch', 'blue', 'green', 'amber', 'red']);

function spark(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const w = 96;
  const h = 44;
  const min = Math.min(0, ...history);
  const span = Math.max(...history) - min || 1;
  const points = history.map((value, index) => `${(4 + index * (w - 8) / (history.length - 1)).toFixed(1)},${(h - 4 - (value - min) / span * (h - 8)).toFixed(1)}`);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'ewmc-bk-spark');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', points.join(' '));
  svg.append(line);
  return svg;
}

/** Зміна «на краще» для тону: менше «Не уражено» — краще, «Не відомо» — нейтрально. */
export function deltaTone(model) {
  if (model.delta == null || model.delta === 0 || model.tone === 'grey') return 'neutral';
  return (model.tone === 'red' ? model.delta < 0 : model.delta > 0) ? 'good' : 'bad';
}

// Дуга кільця від верху за годинниковою стрілкою (без пунктиру: дуга — окремий шлях).
function arc(cx, cy, r, share) {
  const sweep = Math.max(0, Math.min(99.99, share)) / 100 * Math.PI * 2;
  const x = cx + r * Math.sin(sweep);
  const y = cy - r * Math.cos(sweep);
  return `M${cx} ${cy - r} A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

function ring(el, share) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 72 72');
  svg.setAttribute('aria-hidden', 'true');
  const track = document.createElementNS(SVG, 'circle');
  for (const [key, value] of Object.entries({ cx: 36, cy: 36, r: 29, class: 'ewmc-bk-track' })) track.setAttribute(key, value);
  svg.append(track);
  if (share > 0) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', arc(36, 36, 29, share));
    path.setAttribute('class', 'ewmc-bk-arc');
    svg.append(path);
  }
  return el('span', { class: 'ewmc-bk-ring' }, svg, el('b', { text: `${share}%` }));
}

/**
 * Показник у дусі сучасних аналітичних панелей: підпис, велике число, зміна в кольорі, рядок плиток і праворуч
 * кільце частки від пусків (або міні-графік за днями, якщо частки немає). `compact` — лише підпис і число.
 * `tools` — меню «⋯» у рядку підпису.
 */
export function kpiNode(el, model, palette = '', { compact = false, tools = null, period = '' } = {}) {
  const tiles = (model.tiles || []).filter(([label]) => !(model.share != null && label === 'Від пусків'));
  const side = compact ? null : model.share != null ? ring(el, model.share) : spark(model.history);
  return el('div', { class: 'ewmc-bk', 'data-tone': PALETTE_TONES.has(palette) ? palette : model.tone || 'blue', role: 'group', 'aria-label': `${model.label}: ${model.valueText}${model.share != null ? `, ${model.share}% від пусків` : ''}` },
    el('div', { class: 'ewmc-bk-main' },
      el('div', { class: 'ewmc-bk-top' },
        el('span', { class: 'ewmc-bk-label', text: model.label }),
        tools),
      el('strong', { class: 'ewmc-bk-value', text: model.valueText }),
      compact ? null : el('p', { class: 'ewmc-bk-sub' },
        model.deltaText ? el('span', { class: `ewmc-bk-delta ${deltaTone(model)}`, text: model.deltaText, title: model.deltaNote }) : null,
        el('span', { text: period })),
      compact || !tiles.length ? null : el('p', { class: 'ewmc-bk-meta', text: tiles.map(([label, value]) => `${label}: ${value}`).join(' · ') })),
    side ? el('div', { class: 'ewmc-bk-side' }, side) : null);
}

function toolsMenu(el, tools) {
  return el('details', { class: 'ewmc-block-tools' },
    el('summary', { text: '⋯', title: 'Налаштувати картку', 'aria-label': 'Налаштувати картку' }),
    tools);
}

/**
 * Картка блока. `tools` — смужка налаштувань картки (`instanceBar`); `visual(block)` — діаграма для блоків-діаграм;
 * `failed` / `retry` — стан читання таблиці. Повертає `<article>` з тими ж атрибутами, що й картки модулів.
 * Показник займає всю картку (без окремого заголовка); мала картка (до 3 колонок) — лише підпис і число.
 */
export function blockCardView({ el, module, placed, block, tools, visual, failed = false, retry = null, style, palette = '' }) {
  const period = placed.model.ok ? placed.model.periodLabel : 'Увесь час';
  const kpi = !failed && block.ok && block.kind === 'kpi';
  const compact = kpi && placed.width <= 3;
  const card = (...children) => el('article', {
    class: `ewmc-module ewmc-block${kpi ? ' is-kpi' : ''}${compact ? ' is-compact' : ''}`,
    style: { gridColumn: `span ${placed.width}` },
    'data-kind': block.kind || 'kpi',
    'data-style': style,
    'data-branch': module.branch,
    'data-palette': palette || null,
    'data-instance-id': placed.instance.id,
    title: kpi ? `${block.model.label}: ${block.model.valueText}${block.model.unit ? ` · ${block.model.unit}` : ''} · ${period} · ${module.title}` : null,
  }, ...children);
  if (kpi) {
    return card(
      kpiNode(el, block.model, palette, { compact, tools: toolsMenu(el, tools), period }),
      placed.model.ok && placed.model.note && !compact ? el('p', { class: 'ewmc-bk-note', text: placed.model.note }) : null);
  }
  const body = failed
    ? el('div', { class: 'ewmc-visual ewmc-read-failed', role: 'alert' },
      el('p', { text: 'Основну таблицю не прочитано. Показник не можна вважати нульовим: записи збережені.' }),
      retry ? el('button', { type: 'button', class: 'btn quiet', text: 'Прочитати знову', 'data-action': 'retry-read', 'data-module-id': module.id, onclick: retry }) : null)
    : !block.ok ? el('p', { class: 'ewmc-bk-missing', text: block.message }) : visual(block);
  return card(
    el('header', { class: 'ewmc-module-head' },
      el('div', {},
        el('h3', { text: placed.instance.title || block.model?.label || module.title }),
        el('p', { text: `${period} · ${module.title}` })),
      toolsMenu(el, tools)),
    body,
    placed.model.ok && placed.model.note ? el('p', { class: 'ewmc-bk-note', text: placed.model.note }) : null);
}

/** Вибір у «⋯» картки блока: вид діаграми (якщо є з чого вибрати) і кольори. */
export function blockChoices({ el, views = [], view = '', palette = '', onView, onPalette }) {
  const select = (label, action, items, current, onChange) => el('label', { class: 'ewmc-block-choice' },
    el('span', { text: label }),
    el('select', { 'data-action': action, onchange: event => onChange(event.currentTarget.value) },
      items.map(item => el('option', { value: item.id, text: item.label, selected: item.id === current }))));
  return el('div', { class: 'ewmc-block-choices' },
    views.length > 1 ? select('Вид діаграми', 'card-view', views, views.some(item => item.id === view) ? view : views[0].id, onView) : null,
    select('Колір', 'card-palette', CARD_PALETTES, palette, onPalette));
}
