// Панель «Зв'язки між таблицями» у «Моєму дашборді» (E3б, B1 + B3): підказки ключів між таблицями модулів і
// рішення людини («Підтвердити ключ» / «Це не ключ» / «Зняти»). Тут лише показ і виклики: логіка — table-link-view-core.js,
// table-link-core.js та ядро схеми профілю. Панель сама нічого не зберігає: рішення передаються функції `apply(change)`
// викликача, яка записує схему профілю. Таблиці модулів не змінюються і з пристрою нічого не відправляється; пошук
// іде порціями (між парами віддає керування) і переривається, якщо панель зникла зі сторінки чи людина натиснула «Скасувати».

import { clearRelation, confirmRelation, rejectRelation } from './profile-schema-core.js';
import { linkIssues, suggestRelations } from './table-link-core.js';
import {
  confirmArgs, confirmBlock, decisionOf, linkInputs, pairView, rejectArgs, rejectedRelationViews, savedRelationViews, summaryLine,
} from './table-link-view-core.js';

const yieldToPage = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * `schema`, `modules`, `data` — функції, що повертають поточний стан дашборда. `apply(change)` записує зміну схеми
 * профілю (`change(schema)` → результат ядра) і повертає `{ ok, schema?, message? }`; `onChange()` кличеться після
 * успішного запису. Без `apply` панель лише показує підказки. Повертає `<details>`.
 */
export function linkPanel({ el, schema, modules, data, apply = null, onChange = () => {}, now = () => new Date().toISOString() }) {
  const status = el('p', { class: 'ewmc-links-status', role: 'status' });
  const output = el('div', { class: 'ewmc-links-out' });
  const saved = el('div', { class: 'ewmc-links-saved' });
  const run = el('button', { type: 'button', class: 'btn quiet', text: 'Знайти зв’язки', 'data-action': 'find-links' });
  const stop = el('button', { type: 'button', class: 'btn quiet', text: 'Скасувати', 'data-action': 'cancel-links', hidden: true });
  const panel = el('details', { class: 'ewmc-links' },
    el('summary', {}, el('span', { text: 'Зв’язки між таблицями' })),
    el('p', { class: 'ewmc-links-hint', text: 'Знайдені ключі — лише підказки: зв’язок з’являється, коли ви його підтвердите. Підтверджене рішення зберігається в профілі (імена стовпців і вид зв’язку, без значень клітинок); таблиці модулів не змінюються. Пошук може бути неповним, і про це написано під кожною парою.' }),
    saved,
    el('div', { class: 'ewmc-links-actions' }, run, stop), status, output);
  let cancel = false;
  let busy = false;
  let shown = [];

  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  // Рішення людини: зміна схеми ядром → запис → перемальовка збережених зв'язків і списку кандидатів.
  async function decide(change, done) {
    if (!apply) return;
    const result = await apply(change);
    if (!result.ok) { say(`Не збережено: ${result.message || 'помилка запису'}`, true); return; }
    say(done);
    renderSaved();
    renderOutput();
    onChange();
  }

  function renderSaved() {
    const current = schema();
    const confirmed = current ? savedRelationViews(current) : [];
    const rejected = current ? rejectedRelationViews(current) : [];
    const nodes = [];
    if (confirmed.length) {
      nodes.push(el('h4', { class: 'ewmc-links-h', text: `Підтверджені зв’язки: ${confirmed.length}` }),
        el('ul', { class: 'ewmc-links-list' }, confirmed.map(view => el('li', { 'data-relation-id': view.id },
          el('span', { text: view.text }),
          el('span', { class: 'ewmc-links-basis', text: ` · ${view.basis}` }),
          view.stale ? el('span', { class: 'ewmc-links-stale', text: ' · перевірте: стовпець ключа змінився' }) : null,
          apply ? el('button', { type: 'button', class: 'btn quiet', text: 'Зняти', 'data-action': 'clear-relation', onclick: () => decide(value => clearRelation(value, view.id), 'Зв’язок знято: пару знову пропонуватимуть.') }) : null))));
    }
    if (rejected.length) {
      nodes.push(el('details', { class: 'ewmc-links-rejected' },
        el('summary', { text: `Відхилені пари: ${rejected.length}` }),
        el('ul', { class: 'ewmc-links-list' }, rejected.map(view => el('li', {},
          el('span', { text: view.text }),
          apply ? el('button', { type: 'button', class: 'btn quiet', text: 'Знову пропонувати', 'data-action': 'restore-relation', onclick: () => decide(value => clearRelation(value, view.id), 'Пару знову пропонуватимуть.') }) : null)))));
    }
    saved.replaceChildren(...nodes);
  }
  renderSaved();

  function renderOutput() {
    output.replaceChildren(...shown.map(view => pairNode(el, view, schema(), { apply: Boolean(apply), decide, now })));
  }

  stop.addEventListener('click', () => { cancel = true; });
  run.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    cancel = false;
    run.disabled = true;
    stop.hidden = false;
    shown = [];
    output.replaceChildren();
    try { await search(); } finally { busy = false; run.disabled = false; stop.hidden = true; }
  });

  async function search() {
    const current = schema();
    if (!current) { say('Схему профілю не прочитано: увійдіть у локальний профіль.', true); return; }
    const inputs = linkInputs(current, modules(), data());
    const notes = inputs.skipped.map(item => `«${item.title}» пропущено: ${item.reason}.`);
    if (inputs.limited) notes.push(`За раз зв’язується не більш як 8 таблиць; ще ${inputs.limited} не розглянуто.`);
    if (inputs.tables.length < 2) { say(['Для пошуку потрібні щонайменше дві таблиці з даними.', ...notes].join(' '), true); return; }
    const titles = new Map(inputs.tables.map(table => [table.sourceId, table.title]));
    const byId = new Map(inputs.tables.map(table => [table.sourceId, table]));
    const lost = () => cancel || !panel.isConnected;
    let step = 0;
    const total = inputs.tables.length + (inputs.tables.length * (inputs.tables.length - 1)) / 2;
    say(`Шукаю… 0 з ${total}`);
    const found = await suggestRelations(inputs.tables, {
      cancelled: lost,
      tick: async () => { step += 1; say(`Шукаю… ${step} з ${total}`); await yieldToPage(); },
    });
    if (!found.ok) { say(found.code === 'cancelled' ? 'Пошук скасовано.' : found.message, found.code !== 'cancelled'); return; }
    const views = [];
    for (const pair of found.pairs) {
      if (lost()) { say('Пошук скасовано.'); return; }
      const left = byId.get(pair.leftId);
      const right = byId.get(pair.rightId);
      views.push(pairView(pair, titles, candidate => linkIssues(left, right, candidate)));
      await yieldToPage();
    }
    say([summaryLine(views), ...notes].join(' · '));
    shown = views;
    renderOutput();
  }

  return panel;
}

function candidateNode(el, entry, current, { apply, decide, now }) {
  const decision = current ? decisionOf(current, entry.candidate) : { state: 'open' };
  const block = confirmBlock(entry.candidate);
  const buttons = [];
  if (apply && decision.state === 'confirmed') {
    buttons.push(el('span', { class: 'ewmc-links-done', text: '✓ Підтверджено' }));
  } else if (apply && (decision.state === 'open' || decision.state === 'taken')) {
    const replace = decision.state === 'taken';
    buttons.push(el('button', {
      type: 'button',
      class: 'btn quiet',
      text: replace ? 'Замінити ключ пари' : 'Підтвердити ключ',
      title: block || (replace ? 'Для цієї пари вже підтверджено інший ключ: його буде замінено' : 'Запам’ятати цей зв’язок у профілі'),
      'data-action': replace ? 'replace-relation' : 'confirm-relation',
      disabled: Boolean(block),
      onclick: () => decide(value => confirmRelation(value, confirmArgs(entry.candidate, { at: now(), replace })), 'Зв’язок збережено в профілі.'),
    }));
    buttons.push(el('button', {
      type: 'button',
      class: 'btn quiet',
      text: 'Це не ключ',
      title: 'Більше не пропонувати цю пару стовпців',
      'data-action': 'reject-relation',
      onclick: () => decide(value => rejectRelation(value, rejectArgs(entry.candidate, { at: now() })), 'Пару відхилено: її більше не пропонуватимуть.'),
    }));
  }
  return el('li', { 'data-decision': decision.state },
    el('span', { class: 'ewmc-links-cand', text: entry.text }),
    el('span', { class: 'ewmc-links-basis', text: ` · ${entry.basis}` }),
    block ? el('p', { class: 'ewmc-links-block', text: block }) : null,
    entry.issues.length ? el('ul', { class: 'ewmc-links-issues' }, entry.issues.map(text => el('li', { text }))) : null,
    buttons.length ? el('div', { class: 'ewmc-links-decide' }, buttons) : null);
}

function pairNode(el, view, current, tools) {
  const open = view.candidates.filter(entry => !current || decisionOf(current, entry.candidate).state !== 'rejected');
  const hidden = view.candidates.length - open.length;
  const list = open.length
    ? el('ul', { class: 'ewmc-links-cands' }, open.map(entry => candidateNode(el, entry, current, tools)))
    : el('p', { class: 'ewmc-links-none', text: hidden ? 'Усі варіанти ключа відхилено.' : 'Варіантів ключа не знайдено.' });
  return el('section', { class: 'ewmc-links-pair', 'data-exhaustive': view.exhaustive ? 'true' : 'false' },
    el('h4', { text: `${view.leftTitle} ↔ ${view.rightTitle}` }),
    list,
    hidden && open.length ? el('p', { class: 'ewmc-links-none', text: `Відхилено варіантів: ${hidden}.` }) : null,
    el('p', { class: view.exhaustive ? 'ewmc-links-full' : 'ewmc-links-partial', text: view.completeness }),
    view.reasons.length ? el('ul', { class: 'ewmc-links-reasons' }, view.reasons.map(text => el('li', { text }))) : null,
    view.exclusions.length ? el('details', { class: 'ewmc-links-excl' }, el('summary', { text: `Не брались за ключ: ${view.exclusions.length}` }), el('ul', {}, view.exclusions.map(text => el('li', { text })))) : null);
}
