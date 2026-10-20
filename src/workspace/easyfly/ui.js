// Спільні елементи інтерфейсу EasyFLY: створення DOM без innerHTML зі значеннями користувача
// (усе через createElement/textContent), кнопки, чипи статусів, поля форм, модальні вікна.
import { DASH, STATUS_LABELS, formatDate, normalizeDate } from './fly-core.js';
import { icon } from './icons.js';

/**
 * Створює елемент. attrs: class, text, dataset, on<Подія> (обробники), aria-атрибути, role та інші атрибути
 * (false/null/undefined пропускаються, true — порожній атрибут). children: рядки (текстові вузли),
 * вузли, масиви, null/false пропускаються.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(node, child);
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Значення або тире. */
export const dash = value => (value === null || value === undefined || value === '' ? DASH : value);

/** Дата ISO → дд.мм.рррр або тире. */
export const dateText = iso => formatDate(iso) || DASH;

let overlayRoot = null;
/** Контейнер для модальних вікон і сповіщень (задає оболонка застосунку). */
export function setOverlayRoot(node) {
  overlayRoot = node;
}

let nextId = 0;
export const uid = prefix => `${prefix}-${++nextId}`;

// ───────────────────────────── Кнопки й чипи ─────────────────────────────

/** Кнопка: variant 'primary' | 'secondary' | 'ghost' | 'danger'; iconName — значок ліворуч. */
export function button(label, { variant = 'secondary', iconName = null, onClick = null, type = 'button', title = null, disabled = false, ariaLabel = null, small = false } = {}) {
  return el('button', {
    type, class: `ef-btn ef-btn-${variant}${small ? ' ef-btn-sm' : ''}`, title, disabled, 'aria-label': ariaLabel, onClick,
  }, iconName ? icon(iconName, 16) : null, label ? el('span', { text: label }) : null);
}

const STATUS_ICON = { valid: 'diysno', soon: 'skoro', overdue: 'prostrocheno', lost: 'vtracheno', blocks: 'blokuie', exempt: 'diysno' };

/** Підпис статусу з великої літери. */
export function statusLabel(status) {
  if (status === null || status === undefined) return 'Немає даних';
  const label = STATUS_LABELS[status] || String(status);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Чип статусу: значок + текст (не лише колір). status null → «Немає даних». */
export function statusChip(status, label = null) {
  const key = status ?? 'none';
  return el('span', { class: `ef-chip ef-st-${key}` },
    icon(STATUS_ICON[status] || 'nemaie-danykh', 14), label ?? statusLabel(status));
}

/** Статус-крапка для таблиці: значок і прихований текст для читача екрана. */
export function statusDot(status, name) {
  const key = status ?? 'none';
  return el('span', { class: `ef-dot ef-st-${key}`, title: `${name}: ${statusLabel(status).toLowerCase()}` },
    icon(STATUS_ICON[status] || 'nemaie-danykh', 14),
    el('span', { class: 'ef-sr', text: `${name}: ${statusLabel(status).toLowerCase()}` }));
}

// ───────────────────────────── Поля форм ─────────────────────────────

/** Підпис + елемент керування (+ підказка). Повертає { root, control }. */
export function field(label, control, { hint = null, wide = false } = {}) {
  const id = control.id || uid('ef-f');
  control.id = id;
  const hintId = hint ? `${id}-hint` : null;
  if (hintId) control.setAttribute('aria-describedby', hintId);
  const root = el('div', { class: `ef-field${wide ? ' ef-field-wide' : ''}` },
    el('label', { for: id, text: label }), control, hint ? el('small', { id: hintId, class: 'ef-hint', text: hint }) : null);
  return { root, control };
}

export function textInput(value = '', { placeholder = '', maxLength = null, inputMode = null, name = null, required = false } = {}) {
  return el('input', { type: 'text', class: 'ef-input', value: value ?? '', placeholder, maxlength: maxLength, inputmode: inputMode, name, 'aria-required': required ? 'true' : null, autocomplete: 'off', spellcheck: 'false' });
}

/** Поле дати дд.мм.рррр: у value кладе ISO або текст користувача. */
export function dateInput(iso = '') {
  return textInput(iso ? (formatDate(iso) || iso) : '', { placeholder: 'дд.мм.рррр', inputMode: 'numeric', maxLength: 10 });
}

/** Читає поле дати → ISO або null. */
export const readDate = input => normalizeDate(input.value);

export function numberInput(value = '', { min = null, max = null, step = 1 } = {}) {
  return el('input', { type: 'number', class: 'ef-input', value: value ?? '', min, max, step, inputmode: 'numeric' });
}

/** Випадний список: options — [{ value, label }] або [value]. */
export function select(options, value = '', { onChange = null } = {}) {
  const node = el('select', { class: 'ef-input ef-select', onChange },
    options.map(option => {
      const o = typeof option === 'object' ? option : { value: option, label: option };
      return el('option', { value: o.value, selected: String(o.value) === String(value), text: o.label });
    }));
  node.value = String(value);
  return node;
}

export function textArea(value = '', { rows = 3, maxLength = null } = {}) {
  return el('textarea', { class: 'ef-input ef-textarea', rows, maxlength: maxLength }, value ?? '');
}

/** Повідомлення про помилки форми (role=alert). */
export function errorBox() {
  const box = el('div', { class: 'ef-alert ef-alert-red', role: 'alert', hidden: true });
  box.show = errors => {
    const list = Array.isArray(errors) ? errors : [errors];
    box.replaceChildren(...list.map(message => el('div', { text: message })));
    box.hidden = false;
  };
  box.clear = () => { box.hidden = true; box.replaceChildren(); };
  return box;
}

/** Смуга-пояснення: tone 'blue' | 'red' | 'amber' | 'green'. */
export function notice(title, body = null, { tone = 'blue', role = null } = {}) {
  return el('div', { class: `ef-alert ef-alert-${tone}`, role },
    title ? el('strong', { text: title }) : null, body ? el('div', { class: 'ef-alert-body', text: body }) : null);
}

export function emptyState(title, body = null, ...actions) {
  return el('div', { class: 'ef-empty' }, el('strong', { text: title }), body ? el('p', { text: body }) : null,
    actions.length ? el('div', { class: 'ef-actions' }, actions) : null);
}

/** Заголовок екрана: хлібні крихти, назва, підзаголовок, дії праворуч. */
export function pageHeader({ crumbs = [], title, subtitle = null, actions = [] }) {
  return el('header', { class: 'ef-page-head' },
    el('div', { class: 'ef-page-titles' },
      crumbs.length ? el('nav', { class: 'ef-crumbs', 'aria-label': 'Розташування' }, crumbs.map((c, i) => [i ? el('span', { class: 'ef-crumb-sep', 'aria-hidden': 'true', text: '/' }) : null,
        c.onClick ? el('a', { href: '#', class: 'ef-crumb-link', onClick: e => { e.preventDefault(); c.onClick(); }, text: c.label }) : el('span', { text: c.label, 'aria-current': 'page' })])) : null,
      el('h1', { class: 'ef-title', text: title }),
      subtitle ? el('p', { class: 'ef-subtitle', text: subtitle }) : null),
    actions.length ? el('div', { class: 'ef-page-actions' }, actions) : null);
}

/** Таблиця: columns [{ label, key|render, class }]; rows — масив; опції { caption, onRow, rowClass }. */
export function table(columns, rows, { caption = null, onRow = null, rowClass = null, className = '' } = {}) {
  const head = el('thead', {}, el('tr', {}, columns.map(c => el('th', { scope: 'col', class: c.class || null, text: c.label }))));
  const body = el('tbody', {}, rows.map(row => {
    const tr = el('tr', { class: rowClass ? rowClass(row) : null },
      columns.map(c => {
        const content = c.render ? c.render(row) : row[c.key];
        return el('td', { class: c.class || null, 'data-label': c.label }, content === undefined || content === null || content === '' ? DASH : content);
      }));
    if (onRow) {
      tr.classList.add('ef-row-click');
      tr.addEventListener('click', event => { if (!event.target.closest('button, a, input, select')) onRow(row); });
    }
    return tr;
  }));
  return el('div', { class: `ef-table-wrap ${className}` }, el('table', { class: 'ef-table' }, caption ? el('caption', { class: 'ef-sr', text: caption }) : null, head, body));
}

export function card(title, ...children) {
  return el('section', { class: 'ef-card' }, title ? el('h2', { class: 'ef-card-title', text: title }) : null, children);
}

/** Невеликий лічильник. tone: '' | 'red' | 'amber' | 'green' | 'blue'. */
export function stat(label, value, { tone = '' } = {}) {
  return el('div', { class: `ef-stat${tone ? ` ef-tone-${tone}` : ''}` }, el('span', { class: 'ef-stat-label', text: label }), el('strong', { class: 'ef-stat-value', text: String(value) }));
}

// ───────────────────────────── Модальні вікна ─────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Модальне вікно. content — вузол; actions: [{ label, variant, onClick(close) → false, щоб лишити
 * вікно відкритим }]. Esc закриває; Tab не виходить за межі; фокус повертається на елемент,
 * що відкрив вікно. Повертає { close, root, body }.
 */
export function openModal({ title, content, actions = [], onClose = null, wide = false, closeLabel = 'Закрити' }) {
  const host = overlayRoot || document.body;
  const previous = document.activeElement;
  const titleId = uid('ef-m');
  const closeButton = el('button', { type: 'button', class: 'ef-icon-btn', 'aria-label': closeLabel, title: closeLabel }, icon('zakryty', 18));
  const footer = el('div', { class: 'ef-modal-actions' });
  const body = el('div', { class: 'ef-modal-body' }, content);
  const dialog = el('div', { class: `ef-modal${wide ? ' ef-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    el('div', { class: 'ef-modal-head' }, el('h2', { id: titleId, text: title }), closeButton), body, footer);
  const root = el('div', { class: 'ef-overlay' }, dialog);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    if (onClose) onClose();
  };
  function onKey(event) {
    if (!root.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter(n => !n.hidden && n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    }
  }
  for (const action of actions) {
    footer.append(button(action.label, {
      variant: action.variant || 'secondary',
      onClick: () => { if (action.onClick ? action.onClick(close) !== false : true) { if (!action.keepOpen) close(); } },
    }));
  }
  closeButton.addEventListener('click', close);
  root.addEventListener('mousedown', event => { if (event.target === root) close(); });
  document.addEventListener('keydown', onKey, true);
  host.append(root);
  const firstField = dialog.querySelector('input:not([type=hidden]), select, textarea') || footer.querySelector('button');
  (firstField || closeButton).focus();
  return { close, root, body };
}

/** Підтвердження без системних діалогів: Promise<boolean>. */
export function confirmDialog({ title, message, confirmLabel = 'Підтвердити', cancelLabel = 'Скасувати', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    const answer = value => { answered = true; resolve(value); };
    openModal({
      title,
      content: el('p', { class: 'ef-confirm-text', text: message }),
      actions: [
        { label: cancelLabel, onClick: () => { answer(false); } },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => { answer(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

let toastTimer = 0;
/** Коротке сповіщення внизу (role=status). tone: 'ok' | 'error'. */
export function toast(message, tone = 'ok') {
  const host = overlayRoot || document.body;
  let box = host.querySelector(':scope > .ef-toast');
  if (!box) {
    box = el('div', { class: 'ef-toast', role: 'status', 'aria-live': 'polite' });
    host.append(box);
  }
  box.className = `ef-toast ef-toast-${tone}`;
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, tone === 'error' ? 9000 : 4500);
}

/** Заглушка «У розробці» для екрана, якого ще немає. */
export function underDevelopment(title) {
  return el('div', { class: 'ef-empty ef-stub' }, icon('shturman', 32), el('h1', { class: 'ef-title', text: title }),
    el('p', { text: 'У розробці. Цей екран буде доступний у наступних оновленнях.' }));
}
