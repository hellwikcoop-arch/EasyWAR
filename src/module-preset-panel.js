// Розділ «Зібрати як РВ / ПС» у каталозі модулів (E5): вибір зразка, що саме буде додано, підтвердження і виклик
// `apply`. Нічого не записує сам: логіка — module-preset-core.js, запис — функція викликача. Вихідні файли не
// змінюються; значення стовпців заповнює користувач. Лише `textContent`; класи — наявні (розмір ПВК-lite).

import { planPreset } from './module-preset-core.js';
import { moduleSourceId } from './profile-schema-modules-core.js';

/**
 * `presets` — зразки в порядку показу; `definitions()` — реєстр; `tables()` — основні таблиці роду військ (перша —
 * та, у яку збирається); `schema()`, `layout()` — схема профілю й розкладка «Мого дашборда». `apply({ preset, plan,
 * definitions, module })` повертає Promise `{ ok, message? }`. Повертає `<details>`.
 */
export function presetPanel({ el, presets, definitions, tables, schema, layout, apply }) {
  const status = el('p', { class: 'ewmc-update-status', role: 'status' });
  const body = el('div', { class: 'ewmc-update-body' });
  const panel = el('details', { class: 'ewmc-update ewmc-preset', 'data-action': 'assemble-preset' },
    el('summary', {}, el('span', { text: `Зібрати як ${presets.map(item => item.title).join(' / ')}` })),
    el('p', { class: 'ewmc-update-hint', text: 'Одним натисканням «Мій дашборд» дістає всі блоки зразка: показники зверху, під ними діаграми. Бракуючі стовпці додаються в основну таблицю, значення в них вносите ви. Вихідні файли не змінюються.' }),
    status, body);
  let busy = false;
  let chosen = presets[0];

  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  function paint() {
    const module = tables()[0] || null;
    const sourceId = module ? moduleSourceId(module.id) : '';
    const result = planPreset({ preset: chosen, definitions: definitions(), schema: schema(), module, layout: layout(), sourceId });
    const pick = el('div', { class: 'ewmc-update-pick', role: 'group', 'aria-label': 'Зразок дашборда' },
      presets.map(item => el('button', {
        type: 'button', class: item === chosen ? 'btn solid' : 'btn quiet', text: item.label, 'data-preset': item.id,
        'aria-pressed': String(item === chosen), disabled: busy, onclick: () => { chosen = item; say(''); paint(); },
      })));
    const nodes = [pick];
    if (!result.ok) nodes.push(el('p', { class: 'ewmc-update-warn', text: result.message }));
    else if (result.done) nodes.push(el('p', { class: 'ewmc-update-hint', text: `Усі блоки зразка ${chosen.title} вже стоять на «Моєму дашборді» з таблиці «${module.title}».` }));
    else {
      nodes.push(el('p', { class: 'ewmc-update-hint', text: `Зразок ${chosen.title} ${result.summary}${module ? ` у таблиці «${module.title}»` : ''}.` }));
      if (!module) nodes.push(el('p', { class: 'ewmc-update-hint', text: 'Основної таблиці ще немає: її буде створено з цими стовпцями, без рядків.' }));
      nodes.push(confirmBox(result, module));
    }
    body.replaceChildren(...nodes);
  }

  function confirmBox(result, module) {
    const ask = el('button', { type: 'button', class: 'btn quiet', text: `Зібрати як ${chosen.title}`, 'data-action': 'assemble', disabled: busy });
    const keep = el('button', { type: 'button', class: 'btn quiet', text: 'Не збирати' });
    const sure = el('button', { type: 'button', class: 'btn solid', text: 'Так, зібрати', 'data-action': 'confirm-assemble', disabled: busy });
    const count = result.plan.fields.length;
    const box = el('div', { class: 'ewmc-confirm', role: 'group', 'aria-label': 'Зібрати дашборд за зразком', hidden: true },
      el('p', { text: `На «Мій дашборд» буде поставлено карток: ${result.missing.length}. ${count
        ? `${module ? `У таблицю «${module.title}»` : 'У нову основну таблицю'} буде додано стовпців: ${count}; їх можна буде перейменувати чи прибрати пізніше.`
        : 'Нові стовпці не потрібні.'}` }),
      el('div', { class: 'ewmc-confirm-actions' }, keep, sure));
    const toggle = open => { box.hidden = !open; ask.hidden = open; };
    ask.addEventListener('click', () => toggle(true));
    keep.addEventListener('click', () => toggle(false));
    sure.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      say('Збираю…');
      paint();
      try {
        const done = await apply({ preset: chosen, plan: result.plan, definitions: result.definitions, module });
        say(done.ok ? done.message || 'Готово.' : done.message || 'Не вдалося зібрати.', !done.ok);
      } catch (error) {
        say(String(error || 'Не вдалося зібрати.'), true);
      } finally {
        busy = false;
        paint();
      }
    });
    return el('div', { class: 'ewmc-update-pick' }, ask, box);
  }

  panel.addEventListener('toggle', () => { if (panel.open) paint(); });
  return panel;
}
