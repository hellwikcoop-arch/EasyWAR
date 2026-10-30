// Клієнт додавання блока реєстру в основну таблицю (E5): запис стовпців у SQLite (`add_dashboard_module_fields` або,
// якщо таблиці ще немає, `create_dashboard_module` для `user-table`) і зіставлення ролей у схемі профілю. `invoke` передає викликач.

import { updateProfileSchema } from './profile-schema-client.js';
import { syncModuleSources } from './profile-schema-modules-core.js';
import { addFieldsRequest, bindingsAfterAdd, confirmPlanBindings, createUserTableRequest } from './module-add-columns-core.js';

/** Додає стовпці плану в таблицю `module` або створює основну таблицю гілки. Повертає модуль із відповіді команди. */
export const saveBlockColumns = (invoke, { branch, module, plan }) => (module
  ? invoke('add_dashboard_module_fields', addFieldsRequest(module, plan))
  : invoke('create_dashboard_module', createUserTableRequest(branch, plan)));

/**
 * Зіставляє ролі блока зі стовпцями таблиці після запису: ключі нових стовпців беруться з відповіді команди. Схема
 * спершу синхронізується з цим модулем, щоб нові стовпці вже в ній були. `{ ok: true }` або помилка схеми.
 */
export async function bindBlockColumns(invoke, { module, plan, at = '' }) {
  const bound = bindingsAfterAdd(plan, module);
  if (!bound.ok) return bound;
  return updateProfileSchema(invoke, schema => {
    const synced = syncModuleSources(schema, [module]);
    return synced.ok ? confirmPlanBindings(synced.schema, module.id, bound.bindings, at) : synced;
  });
}
