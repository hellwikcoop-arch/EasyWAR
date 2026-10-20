import { moduleWindow } from '../air-bridge.js';
import { ASSISTANT_BRANCHES } from './assistant-context-core.js';

// Режим «Пояснити»: поки він увімкнений, кліки в модулі не виконують дій, а передаються КОМБАТУ.
// Усе відбувається з боку помічника: файли модулів не змінюються, дані й сховище не читаються.

const text = node => (node?.textContent || '').replace(/\s+/gu, ' ').trim();
const own = (root, selector) => root?.querySelector(selector) || null;

function headingOf(node) {
  for (let item = node; item && item.nodeType === 1; item = item.parentElement) {
    const heading = item.querySelector(':scope > h2, :scope > .ph h2, :scope > header h2, :scope > header h3, :scope > .kh-l h2');
    if (heading && text(heading)) return text(heading);
    if (item.tagName === 'BODY') break;
  }
  return '';
}


const columnOf = cell => {
  const table = cell?.closest('table');
  const head = table?.tHead?.rows?.[table.tHead.rows.length - 1]?.cells?.[cell.cellIndex];
  return text(head);
};
const titleOf = node => {
  for (let item = node; item && item.nodeType === 1; item = item.parentElement) {
    const own = item.querySelector(':scope > title');
    if (own) return text(own);
    const attr = item.getAttribute('title');
    if (attr) return attr;
    if (item.tagName === 'BODY') break;
  }
  return '';
};

// Дашборд УДШВ і вкладка «Наші втрати» мають власну розмітку (ud-*, ol-*), тому описуються окремо.
function describeUdshv(target, base) {
  const c = selector => target.closest(selector);
  const scope = c('.ol-root') ? 'own' : '';
  const out = (part, extra = {}) => ({ ...base, branch: 'dshv', part, scope, ...extra });
  const kpiOf = card => ({ label: text(own(card, '.ud-kpi-label, .ol-kpi-label')), value: text(own(card, 'strong')), hint: text(own(card, 'small')) });

  if (c('.ud-delta, .ol-delta')) return out('delta', { kind: 'delta', ...kpiOf(c('.ud-kpi, .ol-kpi')) });
  const card = c('.ud-kpi, .ol-kpi');
  if (card) return out(target.closest('svg') ? 'spark' : 'kpi', { kind: 'kpi', ...kpiOf(card) });

  const nav = c('.ud-nav button');
  if (nav) return out('nav', { kind: 'tab', label: text(nav) });
  const ovtTab = c('.ud-tabs button');
  if (ovtTab) return out('ovt-tab', { kind: 'control', label: text(ovtTab) });
  const seg = c('.ud-seg button, .ol-seg button');
  if (seg) return out('period', { kind: 'control', label: text(seg) });
  const step = c('button[title="Попередній"], button[title="Наступний"]');
  if (step) return out('period', { kind: 'control', label: step.getAttribute('title') });
  const month = c('select[aria-label="Місяць"]');
  if (month) return out('period-field', { kind: 'control', label: 'Місяць' });
  const date = c('input[type="date"], input.ew-date-t');
  if (date) return out('period-field', { kind: 'control', label: /^з/u.test(text(date.closest('label'))) ? 'Початок періоду' : 'Кінець періоду' });
  const unitSelect = c('.ol-unit, .ud-unit, .ud-multi, .ud-multi-pop');
  if (unitSelect) {
    const button = c('button.ud-link, button.ol-link');
    return out('unit-filter', { kind: 'control', label: button ? text(button) : 'Підрозділ' });
  }
  if (c('.ud-fresh-hint')) return out('fresh-hint', { kind: 'control', value: text(c('.ud-fresh-hint')) });
  const clear = c('button.ud-link, button.ol-link');
  if (clear && /підрозділ/iu.test(text(clear)) && !c('table')) return out('unit-filter', { kind: 'control', label: text(clear) });
  const context = c('.ud-context, .ol-context');
  if (context) return out('context', { kind: 'other', label: text(target.closest('span') || context) });
  const button = c('button.ud-btn, button.ol-btn, label.ol-btn');
  if (button) return out('button', { kind: 'control', label: text(button) });
  const filePicker = c('label:has(input[type="file"])');
  if (filePicker) return out('button', { kind: 'control', label: text(filePicker) });

  const summary = c('details > summary');
  const details = c('details');
  if (details && !c('.ud-multi')) return out('issue', { kind: 'other', label: text(own(details, 'summary strong')) || text(summary) });

  const rank = c('.ud-rank-row');
  if (rank) return out('rank-row', { kind: 'row', label: text(own(rank, '.ud-rank-name')), value: text(own(rank, 'strong')), hint: rank.getAttribute('title') || '' });
  const week = c('.ud-week > div');
  if (week) return out('weekday', { kind: 'row', label: text(week.querySelector('span')), value: text(own(week, 'strong')), hint: week.getAttribute('title') || '' });

  const cell = c('td, th');
  const heading = base.panelTitle;
  if (cell && c('.ud-heat')) return out('heat', { kind: 'cell', label: cell.getAttribute('title') || text(cell), hint: cell.getAttribute('title') || '' });
  if (cell && c('.ud-pivot')) return out('pivot', { kind: 'cell', label: text(c('th.ud-group')) || text(cell) });
  if (cell && heading === 'Актуальність підрозділів') return out('fresh-cell', { kind: 'cell', label: columnOf(cell), value: text(cell) });
  if (cell && heading === 'Аркуші') return out('sheets-cell', { kind: 'cell', label: columnOf(cell), value: text(cell) });
  if (cell && c('table')) {
    const sortButton = c('thead button');
    if (sortButton) return out('sort', { kind: 'control', label: text(sortButton) });
    const unitButton = c('tbody th button, tbody th .ud-link, tbody th .ol-link');
    if (unitButton) return out('unit-filter', { kind: 'control', label: 'Підрозділ' });
    if (c('tfoot')) return out('total', { kind: 'cell', label: columnOf(cell), value: text(cell) });
    const column = columnOf(cell);
    if (column && column !== 'Підрозділ') return out('cell', { kind: 'cell', label: column, value: text(cell), hint: cell.getAttribute('title') || '' });
  }
  if (c('h1')) return out('title', { kind: 'other', label: text(c('h1')) });
  const heading3 = c('h3');
  if (!heading3 && !c('.ud-card, .ol-card') && c('#udshv-dashboard-root, .ol-root')) {
    const layout = c('.ud-period') ? 'period-bar' : c('.ud-hero-actions') ? 'hero-actions' : c('.ud-hero') ? 'hero'
      : c('.ud-nav') ? 'nav-bar' : c('.ud-kpis, .ol-kpis') ? 'kpis' : c('.ud-grid-2, .ud-grid-3, .ol-grid') ? 'grid' : c('.ud-page, .ol-root') ? 'page' : 'page';
    if (layout) return out('layout', { kind: 'other', label: layout, hint: text(own(target.closest('.ud-hero') || target, '.ud-eyebrow')) });
  }
  if (heading3) return out('', { kind: 'panel', label: text(heading3), hint: '' });
  return out('', { kind: 'other', hint: titleOf(target) });
}

// Перетворює елемент, по якому клікнули, на простий дескриптор для ядра пояснень.
export function describeTarget(target, branch) {
  if (!target || target.nodeType !== 1) return null;
  const base = { branch, kind: 'other', label: '', group: '', panelTitle: headingOf(target), value: '', hint: '' };
  if (branch === 'dshv') return describeUdshv(target, base);
  const closest = selector => target.closest(selector);

  const delta = closest('.kc-d, .kc-dl, .kc-dt, .delta');
  if (delta) return { ...base, kind: 'delta', hint: delta.getAttribute('title') || '' };

  const tile = closest('.kc-t');
  if (tile) return { ...base, kind: 'tile', label: text(own(tile, '.kc-tl')), value: text(own(tile, '.kc-tv')) };
  const wide = closest('.kc-wide');
  if (wide) return { ...base, kind: 'tile', label: text(wide.querySelector('span')?.firstChild), value: text(own(wide, 'b')) };
  const ring = closest('.kc-ringrow, .kc-cap');
  if (ring) {
    const card = ring.closest('.kc');
    return { ...base, kind: 'tile', label: text(own(ring, '.kc-rl')) || text(own(card, '.k-l')), value: text(own(card, '.k-v')), hint: card?.getAttribute('title') || '' };
  }
  const card = closest('.kc, .kpi');
  if (card) {
    const head = own(card, '.kc-h');
    return {
      ...base,
      kind: 'kpi',
      label: text(own(card, '.k-l')),
      value: text(own(card, '.k-v')),
      hint: head?.getAttribute('title') || card.getAttribute('title') || '',
    };
  }
  const eff = closest('.kh-eff');
  if (eff) return { ...base, kind: 'kpi', label: 'Ефективність', value: text(own(eff, '.kh-eff-v')), hint: eff.getAttribute('title') || '' };

  const nav = closest('button[data-t], button.tab');
  if (nav) {
    const copy = nav.cloneNode(true);
    copy.querySelectorAll('.nb').forEach(item => item.remove());
    return { ...base, kind: 'tab', label: text(copy), value: text(own(nav, '.nb')), hint: nav.getAttribute('title') || '' };
  }
  const seg = closest('.seg, .dp-mode');
  const button = closest('button');
  if (seg && button) {
    return { ...base, kind: 'control', label: text(button), group: seg.getAttribute('aria-label') || '', hint: button.getAttribute('title') || '' };
  }
  const chart = closest('svg[aria-label], [role="img"][aria-label]');
  if (chart) return { ...base, kind: 'chart', label: '', hint: chart.getAttribute('aria-label') || '' };

  const head = closest('h2');
  if (head) return { ...base, kind: 'panel', label: text(head) };
  const titled = closest('[title], [aria-label]');
  return { ...base, label: '', hint: titled?.getAttribute('title') || titled?.getAttribute('aria-label') || '' };
}

const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick'];
const CURSOR_STYLE = 'html.ew-explain-on, html.ew-explain-on * { cursor: help !important; } ' +
  '.ew-explain-frame { position: fixed; z-index: 2147483000; pointer-events: none; border: 2px solid #d9a441; border-radius: 8px; ' +
  'box-shadow: 0 0 0 4px rgba(217, 164, 65, .28); transition: left .22s cubic-bezier(.2,.8,.2,1), top .22s cubic-bezier(.2,.8,.2,1), width .22s cubic-bezier(.2,.8,.2,1), height .22s cubic-bezier(.2,.8,.2,1), opacity .15s; } ' +
  '@media (prefers-reduced-motion: reduce) { .ew-explain-frame { transition: none; } }';

export function activeAssistantFrame() {
  const branch = document.body.dataset.activeBranch;
  if (!ASSISTANT_BRANCHES.includes(branch)) return null;
  const win = moduleWindow(branch);
  if (!win?.document || win.document.documentElement.classList.contains('ew-locked')) return null;
  return { branch, win };
}

// Керує перехопленням. onExplain(descriptor) викликається на кожен клік; onStop(reason) — коли режим вимкнено ззовні.
export function createExplainController({ getFrame = activeAssistantFrame, onExplain, onStop } = {}) {
  let attached = null;

  function place(box, target) {
    const rect = target.getBoundingClientRect();
    const pad = 3;
    Object.assign(box.style, { left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`, opacity: '1' });
  }
  function highlight(target) {
    if (!attached || !target?.isConnected) return;
    const { box } = attached;
    attached.target = target;
    place(box, target);
  }
  function detach(reason) {
    if (!attached) return;
    const { win, handlers, box, style } = attached;
    attached = null;
    try {
      for (const [type, handler, options] of handlers) win.document.removeEventListener(type, handler, options);
      win.removeEventListener('scroll', handlers.onScroll, true);
      win.removeEventListener('resize', handlers.onScroll);
      win.removeEventListener('pagehide', handlers.onHide);
      win.document.documentElement.classList.remove('ew-explain-on');
      box.remove(); style.remove();
    } catch { /* документ модуля вже закрито */ }
    if (reason) onStop?.(reason);
  }
  function attach() {
    if (attached) return true;
    const frame = getFrame();
    if (!frame) return false;
    const { win, branch } = frame;
    const doc = win.document;
    const style = doc.createElement('style'); style.textContent = CURSOR_STYLE;
    const box = doc.createElement('div'); box.className = 'ew-explain-frame'; box.setAttribute('aria-hidden', 'true'); box.style.opacity = '0';
    doc.head.append(style); doc.body.append(box);
    doc.documentElement.classList.add('ew-explain-on');
    const stop = event => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };
    const explain = (event, element) => {
      stop(event);
      if (!(element instanceof win.Element)) return;
      highlight(element);
      onExplain?.(describeTarget(element, branch));
    };
    const handlers = [];
    const add = (type, handler) => { doc.addEventListener(type, handler, true); handlers.push([type, handler, true]); };
    for (const type of BLOCKED) add(type, stop);
    add('click', event => explain(event, event.target));
    // Клавіатура: Enter/Space на сфокусованому елементі пояснює його, а не виконує; Escape виходить з режиму.
    add('keydown', event => {
      if (event.key === 'Escape') { stop(event); detach('escape'); return; }
      const active = doc.activeElement;
      const typing = active && /^(INPUT|TEXTAREA|SELECT)$/u.test(active.tagName);
      if ((event.key === 'Enter' || event.key === ' ') && active && active !== doc.body && !(typing && event.key === ' ')) explain(event, active);
    });
    handlers.onScroll = () => { if (attached?.target?.isConnected) place(box, attached.target); };
    handlers.onHide = () => detach('closed');
    win.addEventListener('scroll', handlers.onScroll, true);
    win.addEventListener('resize', handlers.onScroll);
    win.addEventListener('pagehide', handlers.onHide);
    attached = { win, branch, handlers, box, style, target: null };
    // Клавіатура працює в модулі: Esc виходить з режиму, Enter/Пробіл пояснюють сфокусований елемент.
    try { win.focus(); } catch { /* фокус не обов'язковий */ }
    return true;
  }
  return {
    start: attach,
    stop: reason => detach(reason),
    isActive: () => Boolean(attached),
    branch: () => attached?.branch || null,
  };
}
