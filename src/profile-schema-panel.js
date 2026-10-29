// Панель «Ролі стовпців» на сторінці модуля (E3): людина підтверджує, який стовпець що означає.
// Тут лише показ і виклики: логіка — profile-schema-view-core.js та profile-schema-core.js, обмін із
// Rust — profile-schema-client.js. Нічого не змінюється, доки людина не натисне «Підтвердити».

import { loadProfileSchema, syncProfileSchemaModules, updateProfileSchema } from './profile-schema-client.js';
import { moduleSourceId } from './profile-schema-modules-core.js';
import { ROLE_OPTIONS, applyRoleChoice, rejectRoleSuggestion, rolesPanelModel } from './profile-schema-view-core.js';

/**
 * `el` — конструктор вузлів сторінки; `invoke` — виклик Tauri; `modules` — модулі гілки (для синхронізації
 * джерела, якщо фонова ще не встигла). Повертає `<details>`; дані читаються при першому розгортанні.
 */
export function rolesPanel({ el, invoke, module, modules }) {
  const sourceId = moduleSourceId(module.id);
  const count = el('span', { class: 'ewmc-roles-count', text: '' });
  const status = el('p', { class: 'ewmc-roles-status', role: 'status' });
  const list = el('div', { class: 'ewmc-roles-list' });
  const panel = el('details', { class: 'ewmc-roles', 'data-source': sourceId },
    el('summary', {}, el('span', { text: 'Ролі стовпців' }), count),
    el('p', { class: 'ewmc-roles-hint', text: 'Заголовок лише підказує роль. Нічого не застосовується, доки ви не натиснете «Підтвердити»; підтверджене зберігається у вашому профілі й не зникає після оновлення шаблону.' }),
    status, list);
  let schema = null;
  let busy = false;

  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  async function refresh() {
    say('Читаю…');
    await syncProfileSchemaModules(invoke, modules()).catch(() => null);
    const loaded = await loadProfileSchema(invoke);
    if (!loaded.ok) {
      schema = null;
      list.replaceChildren();
      say(loaded.code === 'profile_required' ? 'Увійдіть у локальний профіль, щоб підтверджувати ролі.' : `Схему профілю не прочитано: ${loaded.message}`, true);
      return;
    }
    schema = loaded.schema;
    say('');
    paint();
  }

  async function change(apply, done) {
    if (busy) return;
    busy = true;
    for (const button of list.querySelectorAll('button')) button.disabled = true;
    const result = await updateProfileSchema(invoke, current => apply(current));
    busy = false;
    if (!result.ok) {
      say(result.code === 'stale' ? 'Схему змінено в іншому місці. Спробуйте ще раз.' : `Не збережено: ${result.message}`, true);
      await refresh();
      return;
    }
    schema = result.schema;
    say(done);
    paint();
  }

  function paint() {
    const model = rolesPanelModel(schema, sourceId);
    if (!model.ok) { list.replaceChildren(); say(model.message, true); return; }
    count.textContent = ` · ${model.summary}`;
    list.replaceChildren(...model.rows.map(row => rowNode(row)));
  }

  function rowNode(row) {
    const select = el('select', { class: 'ewmc-role-select', 'aria-label': `Роль стовпця «${row.header}»` },
      el('option', { value: '', text: '— не визначено —' }),
      ROLE_OPTIONS.map(option => el('option', { value: option.role, selected: option.role === row.role, text: option.label })));
    const unit = el('input', { type: 'text', class: 'ewmc-role-unit', maxlength: '40', value: row.unit, placeholder: 'одиниця', 'aria-label': `Одиниця стовпця «${row.header}»` });
    const note = el('span', { class: 'ewmc-role-note' });
    const confirm = el('button', { type: 'button', class: 'btn quiet', text: 'Підтвердити', 'data-action': 'confirm-role' });
    const reject = el('button', { type: 'button', class: 'btn quiet', text: 'Це не вона', 'data-action': 'reject-role' });
    const clear = el('button', { type: 'button', class: 'btn quiet', text: 'Зняти', 'data-action': 'clear-role' });
    const numeric = role => ROLE_OPTIONS.some(option => option.role === role && option.numeric);
    const sync = () => {
      const role = select.value;
      unit.hidden = !numeric(role);
      const taken = role && row.takenBy[role];
      note.textContent = taken ? `Роль зараз виконує «${taken}»; підтвердження перенесе її сюди.` : '';
      const same = row.state === 'confirmed' && role === row.role && (!numeric(role) || unit.value.trim() === row.unit);
      confirm.hidden = !role || same;
      reject.hidden = row.state === 'confirmed' || !role || !row.candidates.includes(role);
      clear.hidden = row.state !== 'confirmed';
    };
    select.addEventListener('change', () => { if (numeric(select.value) && !unit.value.trim()) unit.value = 'шт'; sync(); });
    unit.addEventListener('input', sync);
    confirm.addEventListener('click', () => change(
      current => applyRoleChoice(current, { sourceId, columnKey: row.key, role: select.value, unit: unit.value, at: new Date().toISOString() }),
      `Роль стовпця «${row.header}» підтверджено.`));
    reject.addEventListener('click', () => change(
      current => rejectRoleSuggestion(current, { sourceId, columnKey: row.key, role: select.value, at: new Date().toISOString() }),
      `Пропозицію для «${row.header}» відхилено.`));
    clear.addEventListener('click', () => change(
      current => applyRoleChoice(current, { sourceId, columnKey: row.key, role: '' }),
      `Роль стовпця «${row.header}» знято.`));
    sync();
    return el('div', { class: 'ewmc-role-row', 'data-column': row.key, 'data-state': row.state },
      el('div', { class: 'ewmc-role-name' }, el('strong', { text: row.header }), el('span', { text: row.stateText + (row.orphan ? ' · стовпця вже немає в шаблоні' : '') })),
      select, unit, el('div', { class: 'ewmc-role-actions' }, confirm, reject, clear), note);
  }

  panel.addEventListener('toggle', () => { if (panel.open && !schema) refresh(); });
  return panel;
}
