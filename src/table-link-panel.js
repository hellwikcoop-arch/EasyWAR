// Панель «Зв'язки між таблицями» у «Моєму дашборді» (E3б, B1): показує підказки ключів між таблицями модулів.
// Тут лише показ і виклики: логіка — table-link-view-core.js та table-link-core.js. Нічого не зберігається,
// не змінює таблиці й не відправляє з пристрою; пошук іде порціями (між парами віддає керування) і
// переривається, якщо панель зникла зі сторінки чи людина натиснула «Скасувати».

import { linkIssues, suggestRelations } from './table-link-core.js';
import { linkInputs, pairView, summaryLine } from './table-link-view-core.js';

const yieldToPage = () => new Promise(resolve => setTimeout(resolve, 0));

/** `schema`, `modules`, `data` — функції, що повертають поточний стан дашборда. Повертає `<details>`. */
export function linkPanel({ el, schema, modules, data }) {
  const status = el('p', { class: 'ewmc-links-status', role: 'status' });
  const output = el('div', { class: 'ewmc-links-out' });
  const run = el('button', { type: 'button', class: 'btn quiet', text: 'Знайти зв’язки', 'data-action': 'find-links' });
  const stop = el('button', { type: 'button', class: 'btn quiet', text: 'Скасувати', 'data-action': 'cancel-links', hidden: true });
  const panel = el('details', { class: 'ewmc-links' },
    el('summary', {}, el('span', { text: 'Зв’язки між таблицями' })),
    el('p', { class: 'ewmc-links-hint', text: 'Це лише підказки, які ключі можуть з’єднувати ваші таблиці. Нічого не зберігається і не змінюється в таблицях; пошук може бути неповним, і про це написано під кожною парою. Підтверджувати зв’язки поки що не можна.' }),
    el('div', { class: 'ewmc-links-actions' }, run, stop), status, output);
  let cancel = false;
  let busy = false;

  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  stop.addEventListener('click', () => { cancel = true; });
  run.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    cancel = false;
    run.disabled = true;
    stop.hidden = false;
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
    output.replaceChildren(...views.map(view => pairNode(el, view)));
  }

  return panel;
}

function pairNode(el, view) {
  const list = view.candidates.length
    ? el('ul', { class: 'ewmc-links-cands' }, view.candidates.map(candidate => el('li', {},
      el('span', { class: 'ewmc-links-cand', text: candidate.text }),
      el('span', { class: 'ewmc-links-basis', text: ` · ${candidate.basis}` }),
      candidate.issues.length ? el('ul', { class: 'ewmc-links-issues' }, candidate.issues.map(text => el('li', { text }))) : null)))
    : el('p', { class: 'ewmc-links-none', text: 'Варіантів ключа не знайдено.' });
  return el('section', { class: 'ewmc-links-pair', 'data-exhaustive': view.exhaustive ? 'true' : 'false' },
    el('h4', { text: `${view.leftTitle} ↔ ${view.rightTitle}` }),
    list,
    el('p', { class: view.exhaustive ? 'ewmc-links-full' : 'ewmc-links-partial', text: view.completeness }),
    view.reasons.length ? el('ul', { class: 'ewmc-links-reasons' }, view.reasons.map(text => el('li', { text }))) : null,
    view.exclusions.length ? el('details', { class: 'ewmc-links-excl' }, el('summary', { text: `Не брались за ключ: ${view.exclusions.length}` }), el('ul', {}, view.exclusions.map(text => el('li', { text })))) : null);
}
