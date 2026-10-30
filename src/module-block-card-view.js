// Вигляд картки блока з основної таблиці (E5): компактна картка в дусі вкладок ПС і РВ. Показник — число з тоном
// за змістом (як на вкладці РВ), кільце частки від пусків, міні-графік за днями й дві плитки; діаграма — той самий
// малюнок, що й у шаблонах. Налаштування картки (період, розмір, стиль, порядок, копія) сховано за «⋯». Числа рахує
// module-block-card-core.js; тут лише DOM через `textContent`. Стилі — public/module-styles.css (лише в застосунку).

import { CARD_PALETTES } from './module-block-card-core.js';

const SVG = 'http://www.w3.org/2000/svg';
const PALETTE_TONES = new Set(['branch', 'blue', 'green', 'amber', 'red']);

function spark(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const w = 220;
  const h = 34;
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

function ring(el, share) {
  const node = el('span', { class: 'ewmc-bk-ring' }, el('b', { text: `${share}%` }));
  node.style.setProperty('--p', String(Math.max(0, Math.min(100, share))));
  return node;
}

/** Показник: число, кільце частки, міні-графік і плитки. */
export function kpiNode(el, model, palette = '') {
  return el('div', { class: 'ewmc-bk', 'data-tone': PALETTE_TONES.has(palette) ? palette : model.tone || 'blue', role: 'img', 'aria-label': `${model.label}: ${model.valueText}${model.share != null ? `, ${model.share}% від пусків` : ''}` },
    el('div', { class: 'ewmc-bk-top' },
      el('span', { class: 'ewmc-bk-label', text: model.label }),
      model.deltaText ? el('span', { class: `ewmc-bk-delta ${deltaTone(model)}`, text: model.deltaText, title: model.deltaNote }) : null),
    el('div', { class: 'ewmc-bk-row' },
      el('strong', { class: 'ewmc-bk-value', text: model.valueText }),
      model.share != null ? ring(el, model.share) : null),
    spark(model.history),
    el('dl', { class: 'ewmc-bk-tiles' }, (model.tiles || []).map(([label, value]) => el('div', {}, el('dt', { text: label }), el('dd', { text: value })))));
}

function compactCard({ el, module, placed, model, tools, style, palette }) {
  return el('article', {
    class: 'ewmc-module ewmc-block is-compact',
    style: { gridColumn: `span ${placed.width}` },
    'data-kind': 'kpi',
    'data-style': style,
    'data-branch': module.branch,
    'data-instance-id': placed.instance.id,
    title: `${model.label}: ${model.valueText}${model.unit ? ` · ${model.unit}` : ''} · ${placed.model.ok ? placed.model.periodLabel : 'Увесь час'}`,
  },
    el('div', { class: 'ewmc-bk', 'data-tone': PALETTE_TONES.has(palette) ? palette : model.tone || 'blue', role: 'img', 'aria-label': `${model.label}: ${model.valueText}` },
      el('div', { class: 'ewmc-bk-top' },
        el('span', { class: 'ewmc-bk-label', text: model.label }),
        el('details', { class: 'ewmc-block-tools' },
          el('summary', { text: '⋯', title: 'Налаштувати картку', 'aria-label': 'Налаштувати картку' }),
          tools)),
      el('strong', { class: 'ewmc-bk-value', text: model.valueText })));
}

/**
 * Картка блока. `tools` — смужка налаштувань картки (`instanceBar`); `visual(block)` — діаграма для блоків-діаграм;
 * `failed` / `retry` — стан читання таблиці. Повертає `<article>` з тими ж атрибутами, що й картки модулів.
 */
export function blockCardView({ el, module, placed, block, tools, visual, failed = false, retry = null, style, palette = '' }) {
  // Мала картка показника (ширина до 3 колонок): лише підпис і число, як «Знищено 4»; решта — за «⋯».
  if (!failed && block.ok && block.kind === 'kpi' && placed.width <= 3) return compactCard({ el, module, placed, model: block.model, tools, style, palette });
  const body = failed
    ? el('div', { class: 'ewmc-visual ewmc-read-failed', role: 'alert' },
      el('p', { text: 'Основну таблицю не прочитано. Показник не можна вважати нульовим: записи збережені.' }),
      retry ? el('button', { type: 'button', class: 'btn quiet', text: 'Прочитати знову', 'data-action': 'retry-read', 'data-module-id': module.id, onclick: retry }) : null)
    : !block.ok ? el('p', { class: 'ewmc-bk-missing', text: block.message })
      : block.kind === 'kpi' ? kpiNode(el, block.model, palette) : visual(block);
  return el('article', {
    class: 'ewmc-module ewmc-block',
    style: { gridColumn: `span ${placed.width}` },
    'data-kind': block.kind || 'kpi',
    'data-style': style,
    'data-branch': module.branch,
    'data-palette': palette || null,
    'data-instance-id': placed.instance.id,
  },
    el('header', { class: 'ewmc-module-head' },
      el('div', {},
        el('h3', { text: placed.instance.title || block.model?.label || module.title }),
        el('p', { text: `${placed.model.ok ? placed.model.periodLabel : 'Увесь час'} · ${module.title}` })),
      el('details', { class: 'ewmc-block-tools' },
        el('summary', { text: '⋯', title: 'Налаштувати картку', 'aria-label': 'Налаштувати картку' }),
        tools)),
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
