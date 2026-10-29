// Панель «Ролі стовпців» (E3): чиста модель для екрана підтвердження зіставлення, без DOM і Tauri.
// Екран лише показує те, що тут пораховано, і викликає функції ядра схеми (`profile-schema-core.js`);
// нічого не вгадується тихо: пропозиція за заголовком лишається пропозицією, доки людина не підтвердить.

import { BINDABLE_ROLES, NUMERIC_ROLES, ROLE_DEFAULT_UNIT, clearBinding, confirmBinding, rejectBinding, suggestBindings } from './profile-schema-core.js';
import { ROLES } from './module-definition-core.js';

export const roleLabel = role => ROLES[role]?.label || role;

/** Варіанти вибору ролі в списку: усі, що їх можна зіставити зі стовпцем. */
export const ROLE_OPTIONS = Object.freeze(BINDABLE_ROLES.map(role => Object.freeze({ role, label: roleLabel(role), numeric: NUMERIC_ROLES.includes(role) })));

const STATE_TEXT = {
  confirmed: 'Підтверджено',
  suggested: 'Пропозиція за заголовком',
  ambiguous: 'Кілька можливих ролей — оберіть',
  unknown: 'Роль не визначено',
};

/**
 * Модель панелі для одного джерела. Рядок стовпця: `state` (`confirmed` | `suggested` | `ambiguous` |
 * `unknown`), `role` — підтверджена або запропонована роль, `unit` — одиниця, `takenBy` — які ролі вже
 * зайняті іншими стовпцями (назва стовпця), щоб показати, що підтвердження перенесе роль.
 */
export function rolesPanelModel(schema, sourceId) {
  const source = schema.sources.find(item => item.id === sourceId);
  if (!source) return { ok: false, code: 'unknown_source', message: `Джерела «${sourceId}» немає.` };
  const suggestions = new Map(suggestBindings(schema, sourceId).columns.map(item => [item.key, item]));
  const confirmed = schema.bindings.filter(binding => binding.sourceId === sourceId && binding.status === 'confirmed');
  const byRole = new Map(confirmed.map(binding => [binding.role, binding]));
  const headerOf = key => source.columns.find(column => column.key === key)?.header || key;
  const rows = source.columns.map(column => {
    const own = confirmed.find(binding => binding.columnKey === column.key);
    const suggestion = suggestions.get(column.key);
    let state = 'unknown';
    let role = '';
    if (own) { state = 'confirmed'; role = own.role; } else if (suggestion?.decision === 'single') { state = 'suggested'; role = suggestion.candidates[0].role; } else if (suggestion?.decision === 'ambiguous') { state = 'ambiguous'; role = suggestion.candidates[0]?.role || ''; }
    const taken = {};
    for (const [takenRole, binding] of byRole) if (binding.columnKey !== column.key) taken[takenRole] = headerOf(binding.columnKey);
    return {
      key: column.key,
      header: column.header,
      type: column.type,
      orphan: column.orphan === true,
      state,
      stateText: STATE_TEXT[state],
      role,
      unit: own?.unit || (NUMERIC_ROLES.includes(role) ? ROLE_DEFAULT_UNIT[role] || '' : ''),
      candidates: (suggestion?.candidates || []).map(item => item.role),
      takenBy: taken,
    };
  });
  return {
    ok: true,
    rows,
    confirmedCount: confirmed.length,
    total: source.columns.length,
    summary: confirmed.length ? `Підтверджено ролей: ${confirmed.length}` : 'Ролей ще не підтверджено',
  };
}

/**
 * Рішення людини про стовпець: роль `role` (порожня — зняти підтверджене), одиниця `unit` для числової
 * ролі. Роль, яку виконує інший стовпець, переноситься (екран про це попередив).
 */
export function applyRoleChoice(schema, { sourceId, columnKey, role, unit = '', at = '' }) {
  const current = schema.bindings.find(binding => binding.sourceId === sourceId && binding.columnKey === columnKey && binding.status === 'confirmed');
  if (!role) {
    if (!current) return { ok: true, schema };
    return clearBinding(schema, { sourceId, columnKey, role: current.role });
  }
  let next = schema;
  if (current && current.role !== role) {
    const cleared = clearBinding(next, { sourceId, columnKey, role: current.role });
    if (!cleared.ok) return cleared;
    next = cleared.schema;
  }
  return confirmBinding(next, { sourceId, columnKey, role, unit, replace: true, at });
}

/** «Ні, це не ця роль»: пропозиція за заголовком більше не повертається. */
export function rejectRoleSuggestion(schema, { sourceId, columnKey, role, at = '' }) {
  return rejectBinding(schema, { sourceId, columnKey, role, at });
}
