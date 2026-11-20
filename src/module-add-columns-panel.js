// Блок «Додати стовпці в основну таблицю» на картці реєстру (E5): показує, що саме додасть блок, просить підтвердження
// і викликає `apply`. Нічого не записує сам: логіка — module-add-columns-core.js, запис — функція викликача. Вихідні
// файли не змінюються; значення стовпців заповнює користувач. Лише `textContent`; класи — наявні (розмір ПВК-lite).

import { planAddColumns } from './module-add-columns-core.js';

/**
 * `tables()` — основні таблиці цього роду військ (модулі `user-table`); `schema()` — схема профілю; `apply({ definition, plan, module })`
 * повертає Promise `{ ok, message? }` і сама перечитує список модулів. `placeable` — блок стає карткою «Мого дашборда»,
 * що рахується з основної таблиці (інакше він поки читає свої звичайні джерела). Повертає `<details>`.
 */
export function addColumnsPanel({ el, definition, tables, schema, apply, placeable = false }) {
  const status = el('p', { class: 'ewmc-update-status', role: 'status' });
  const body = el('div', { class: 'ewmc-update-body' });
  const hasOptional = definition.requirements.some(item => !item.required);
  const panel = el('details', { class: 'ewmc-update ewmc-addcols', 'data-definition-id': definition.definitionId },
    el('summary', {}, el('span', { text: 'Додати стовпці в основну таблицю' })),
    el('p', { class: 'ewmc-update-hint', text: 'Блок рахується зі стовпців вашої таблиці. Тут видно, яких стовпців йому бракує; після підтвердження вони додаються в основну таблицю, а значення в них вносите ви. Вихідні файли не змінюються.' }),
    el('p', { class: 'ewmc-update-hint', text: placeable
      ? 'Після додавання на «Моєму дашборді» з’явиться картка цього блока, що рахується з основної таблиці.'
      : 'Цей блок поки рахується лише на своїй вкладці, зі звичайної таблиці дашборда; з основної таблиці він читатиме пізніше.' }),
    status, body);
  let busy = false;
  let withOptional = false;
  let chosenId = '';

  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  function chosen() {
    const list = tables();
    return list.find(item => item.id === chosenId) || list[0] || null;
  }

  function paint() {
    const module = chosen();
    const plan = planAddColumns({ definition, schema: schema(), module, withOptional });
    const nodes = [];
    const list = tables();
    if (list.length > 1) {
      const pick = el('select', { class: 'ewmc-reg-select', 'aria-label': 'Таблиця для стовпців', disabled: busy },
        list.map(item => el('option', { value: item.id, selected: item.id === module.id, text: item.title })));
      pick.addEventListener('change', () => { chosenId = pick.value; paint(); });
      nodes.push(el('div', { class: 'ewmc-update-pick' }, pick));
    }
    if (hasOptional) {
      const box = el('input', { type: 'checkbox', checked: withOptional, disabled: busy, 'data-action': 'with-optional' });
      box.addEventListener('change', () => { withOptional = box.checked; paint(); });
      nodes.push(el('label', { class: 'ewmc-update-hint' }, box, el('span', { text: ' Додати й стовпці «за бажанням»' })));
    }
    if (!plan.ok) {
      nodes.push(el('p', { class: 'ewmc-update-warn', text: plan.message }));
    } else {
      nodes.push(el('p', { class: 'ewmc-update-hint', text: plan.nothingToAdd
        ? `Усі потрібні блоку стовпці вже є у таблиці «${module.title}».`
        : `Блок ${plan.summary}${module ? ` у таблиці «${module.title}»` : ''}.` }));
      if (!module) nodes.push(el('p', { class: 'ewmc-update-hint', text: 'Основної таблиці ще немає: її буде створено з цими стовпцями, без рядків.' }));
      if (!plan.nothingToAdd) nodes.push(confirmBox(plan, module));
      else if (placeable) {
        nodes.push(el('div', { class: 'ewmc-update-pick' }, el('button', {
          type: 'button', class: 'btn quiet', text: 'Поставити картку на «Мій дашборд»', 'data-action': 'place-card', disabled: busy, onclick: () => commit(plan, module),
        })));
      }
    }
    body.replaceChildren(...nodes);
  }

  function confirmBox(plan, module) {
    const ask = el('button', { type: 'button', class: 'btn quiet', text: 'Додати стовпці', 'data-action': 'add-columns', disabled: busy });
    const keep = el('button', { type: 'button', class: 'btn quiet', text: 'Не додавати' });
    const sure = el('button', { type: 'button', class: 'btn solid', text: 'Так, додати', 'data-action': 'confirm-add-columns', disabled: busy });
    const count = plan.fields.length;
    const box = el('div', { class: 'ewmc-confirm', role: 'group', 'aria-label': 'Додати стовпці в таблицю', hidden: true },
      el('p', { text: count
        ? `${module ? `У таблицю «${module.title}»` : 'У нову основну таблицю'} буде додано стовпців: ${count}. Їх можна буде перейменувати чи прибрати пізніше.`
        : 'Нові стовпці не додаються: наявні лише буде зіставлено з ролями блока.' }),
      el('div', { class: 'ewmc-confirm-actions' }, keep, sure));
    const toggle = open => { box.hidden = !open; ask.hidden = open; };
    ask.addEventListener('click', () => toggle(true));
    keep.addEventListener('click', () => toggle(false));
    sure.addEventListener('click', () => commit(plan, module));
    return el('div', { class: 'ewmc-update-pick' }, ask, box);
  }

  async function commit(plan, module) {
    if (busy) return;
    busy = true;
    say('Збереження в локальній SQLite…');
    paint();
    try {
      const result = await apply({ definition, plan, module });
      say(result?.message || (result?.ok ? 'Готово.' : 'Не вдалося додати стовпці.'), !result?.ok);
    } catch (error) {
      say(String(error?.message || error || 'Не вдалося додати стовпці.'), true);
    } finally {
      busy = false;
      if (panel.isConnected) paint();
    }
  }

  // Таблиці могли змінитися з часу побудови картки (інший блок уже додав стовпці): відкриття перемальовує розрахунок.
  panel.addEventListener('toggle', () => { if (panel.open && !busy) paint(); });
  paint();
  return panel;
}
