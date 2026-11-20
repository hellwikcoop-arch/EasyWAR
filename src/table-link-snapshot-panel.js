// Панель «Оновити з вихідних таблиць» на сторінці таблиці-знімка (E3б, B5). Таблиця, створена з підтвердженого
// зв'язку, не оновлюється сама: людина натискає «Перевірити зміни», бачить, скільки рядків додано й зникне, і лише
// після підтвердження рядки замінюються. Тут лише показ і виклики: логіка — table-link-snapshot-core.js, читання
// вихідних таблиць і запис — функції викликача. Вихідні таблиці не змінюються.

import { refreshSummary, refreshView, snapshotInfo } from './table-link-snapshot-core.js';

const dateOf = value => {
  const stamp = Date.parse(value);
  return Number.isNaN(stamp) ? '' : new Date(stamp).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
};

/**
 * `schema()` — поточна схема профілю; `titles()` — Map sourceId → назва; `readSources()` читає вихідні таблиці наново
 * і повертає `{ modules, data }`; `payload()` — поточні рядки знімка; `apply(view)` записує рядки й знімок і повертає
 * `{ ok, message? }`. Без знімка повертає `null`. Повертає `<details>`.
 */
export function snapshotPanel({ el, schema, module, titles, readSources, payload, apply }) {
  const info = snapshotInfo(schema(), module, titles());
  if (!info) return null;
  const status = el('p', { class: 'ewmc-update-status', role: 'status' });
  const body = el('div', { class: 'ewmc-update-body' });
  const when = dateOf(info.builtAt);
  const panel = el('details', { class: 'ewmc-update ewmc-snapshot', 'data-module': module.id },
    el('summary', {}, el('span', { text: 'Оновити з вихідних таблиць' })),
    el('p', { class: 'ewmc-update-hint', text: `Ця таблиця — знімок об’єднання «${info.text}»${when ? `, оновлений ${when}` : ''}. Сама вона не оновлюється: натисніть «Перевірити зміни», щоб побачити, що змінилося у вихідних таблицях. Нічого не застосовується без вашого підтвердження; вихідні таблиці не змінюються.` }),
    status, body);
  let busy = false;
  let view = null;

  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  function paint() {
    const summary = view ? refreshSummary(view) : null;
    const check = el('button', { type: 'button', class: 'btn quiet', text: 'Перевірити зміни', 'data-action': 'check-snapshot', disabled: busy, onclick: checkChanges });
    const nodes = [el('div', { class: 'ewmc-update-pick' }, check)];
    if (summary) nodes.push(...summary.lines.map(line => el('p', { class: view.ok ? 'ewmc-update-hint' : 'ewmc-update-warn', text: line })));
    if (view?.ok && summary.changed) nodes.push(confirmBox());
    body.replaceChildren(...nodes);
  }

  function confirmBox() {
    const ask = el('button', { type: 'button', class: 'btn quiet', text: 'Застосувати', 'data-action': 'apply-snapshot', disabled: busy });
    const keep = el('button', { type: 'button', class: 'btn quiet', text: 'Залишити як є' });
    const sure = el('button', { type: 'button', class: 'btn solid', text: 'Так, замінити рядки', 'data-action': 'confirm-snapshot', disabled: busy });
    const box = el('div', { class: 'ewmc-confirm', role: 'group', 'aria-label': 'Замінити рядки таблиці', hidden: true },
      el('p', { text: `Усі рядки цієї таблиці (${view.before}) буде замінено новими (${view.rowCount}). Вихідні таблиці не зміняться.` }),
      el('div', { class: 'ewmc-confirm-actions' }, keep, sure));
    const toggle = open => { box.hidden = !open; ask.hidden = open; };
    ask.addEventListener('click', () => toggle(true));
    keep.addEventListener('click', () => toggle(false));
    sure.addEventListener('click', () => replace());
    return el('div', { class: 'ewmc-update-pick' }, ask, box);
  }

  async function checkChanges() {
    if (busy) return;
    busy = true;
    say('Читаю вихідні таблиці…');
    paint();
    try {
      const fresh = await readSources();
      if (!fresh?.ok) { view = { ok: false, message: fresh?.message || 'Вихідні таблиці не прочитано.' }; say(''); return; }
      view = refreshView(schema(), module, fresh.modules, fresh.data, payload());
      say('');
    } catch (error) {
      view = { ok: false, message: String(error?.message || error || 'Не вдалося прочитати вихідні таблиці.') };
      say('');
    } finally {
      busy = false;
      if (panel.isConnected) paint();
    }
  }

  async function replace() {
    if (busy || !view?.ok) return;
    busy = true;
    say('Збереження в локальній SQLite…');
    paint();
    try {
      const result = await apply(view);
      if (!result?.ok) { busy = false; say(result?.message || 'Не вдалося оновити таблицю.', true); if (panel.isConnected) paint(); }
    } catch (error) {
      busy = false;
      say(String(error?.message || error || 'Не вдалося оновити таблицю.'), true);
      if (panel.isConnected) paint();
    }
  }

  paint();
  return panel;
}
