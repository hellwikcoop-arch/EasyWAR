// Клієнт розкладки дашборда (E4): читання й запис через команди Tauri. Логіка розкладки — у
// module-instance-core.js; тут лише обмін із Rust. `invoke` передає викликач (у тестах — підміна).

import { emptyLayout, parseLayout, serializeLayout } from './module-instance-core.js';
import { STALE_MARK } from './profile-schema-client.js';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const errorText = error => (typeof error === 'string' ? error : error?.message || String(error));

/**
 * Читає розкладку дашборда активного профілю. Без збереженої — порожню (ревізія 0 у `storedRevision`).
 * Новішу чи пошкоджену розкладку не підміняє порожньою: повертає помилку, щоб налаштування не втратилися.
 */
export async function loadDashboardLayout(invoke, dashboardId = 'my') {
  let profileId;
  let record;
  try {
    profileId = await invoke('get_profile_session');
    if (!profileId) return failure('profile_required', 'Спершу увійдіть у локальний профіль.');
    record = await invoke('get_dashboard_layout', { dashboardId });
  } catch (error) {
    return failure('storage', errorText(error));
  }
  if (!record?.layout) return { ok: true, layout: emptyLayout(profileId, dashboardId), storedRevision: 0 };
  const parsed = parseLayout(record.layout);
  if (!parsed.ok) return failure(parsed.errors[0].code, parsed.errors[0].message, { errors: parsed.errors });
  if (parsed.layout.profileId !== profileId) return failure('foreign_profile', 'Розкладка належить іншому профілю.');
  return { ok: true, layout: parsed.layout, storedRevision: record.revision };
}

/** Зберігає розкладку; `expectedRevision` — `storedRevision`, отриманий при читанні. */
export async function saveDashboardLayout(invoke, layout, expectedRevision) {
  try {
    const record = await invoke('save_dashboard_layout', { layout: JSON.parse(serializeLayout(layout)), expectedRevision });
    return { ok: true, layout, storedRevision: record.revision };
  } catch (error) {
    const message = errorText(error);
    return failure(message.includes(STALE_MARK) ? 'stale' : 'storage', message);
  }
}

/** Стирає розкладку дашборда активного профілю (дані модулів і схему профілю не чіпає). */
export async function resetDashboardLayout(invoke, expectedRevision, dashboardId = 'my') {
  try {
    await invoke('reset_dashboard_layout', { dashboardId, expectedRevision });
    return { ok: true };
  } catch (error) {
    const message = errorText(error);
    return failure(message.includes(STALE_MARK) ? 'stale' : 'storage', message);
  }
}

/**
 * «Прочитай → зміни → збережи»: `change(layout)` повертає результат функції ядра ({ ok, layout }).
 * Якщо розкладку тим часом змінили деінде, один раз перечитує й повторює зміну на свіжій.
 */
export async function updateDashboardLayout(invoke, change, dashboardId = 'my') {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await loadDashboardLayout(invoke, dashboardId);
    if (!loaded.ok) return loaded;
    const changed = change(loaded.layout);
    if (!changed.ok) return changed;
    if (changed.layout === loaded.layout || changed.layout.revision === loaded.layout.revision) {
      return { ...changed, storedRevision: loaded.storedRevision };
    }
    const saved = await saveDashboardLayout(invoke, changed.layout, loaded.storedRevision);
    if (saved.ok) return { ...changed, storedRevision: saved.storedRevision };
    if (saved.code !== 'stale') return saved;
  }
  return failure('stale', 'Розкладку дашборда змінено в іншому місці; повторіть дію.');
}
