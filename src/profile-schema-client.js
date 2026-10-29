// Клієнт схеми профілю (E3): читання й запис через команди Tauri. Логіка схеми — у
// profile-schema-core.js; тут лише обмін із Rust. `invoke` передає викликач (у тестах — підміна).

import { emptySchema, parseSchema, serializeSchema } from './profile-schema-core.js';

/** Фрагмент повідомлення Rust про застарілу ревізію (`ProfileSchemaError::Stale`). */
export const STALE_MARK = 'змінено в іншому місці';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const errorText = error => (typeof error === 'string' ? error : error?.message || String(error));

/**
 * Читає схему активного профілю. Без збереженої — порожню (ревізія 0 у `storedRevision`).
 * Новішу чи пошкоджену схему не підміняє порожньою: повертає помилку, щоб рішення не втратилися.
 */
export async function loadProfileSchema(invoke) {
  let profileId;
  let record;
  try {
    profileId = await invoke('get_profile_session');
    if (!profileId) return failure('profile_required', 'Спершу увійдіть у локальний профіль.');
    record = await invoke('get_profile_schema');
  } catch (error) {
    return failure('storage', errorText(error));
  }
  if (!record?.schema) return { ok: true, schema: emptySchema(profileId), storedRevision: 0 };
  const parsed = parseSchema(record.schema);
  if (!parsed.ok) return failure(parsed.errors[0].code, parsed.errors[0].message, { errors: parsed.errors });
  if (parsed.schema.profileId !== profileId) return failure('foreign_profile', 'Схема належить іншому профілю.');
  return { ok: true, schema: parsed.schema, storedRevision: record.revision };
}

/** Зберігає схему; `expectedRevision` — `storedRevision`, отриманий при читанні. */
export async function saveProfileSchema(invoke, schema, expectedRevision) {
  try {
    const record = await invoke('save_profile_schema', { schema: JSON.parse(serializeSchema(schema)), expectedRevision });
    return { ok: true, schema, storedRevision: record.revision };
  } catch (error) {
    const message = errorText(error);
    return failure(message.includes(STALE_MARK) ? 'stale' : 'storage', message);
  }
}

/** Стирає рішення про стовпці активного профілю (дані модулів не чіпає). */
export async function resetProfileSchema(invoke, expectedRevision) {
  try {
    await invoke('reset_profile_schema', { expectedRevision });
    return { ok: true };
  } catch (error) {
    const message = errorText(error);
    return failure(message.includes(STALE_MARK) ? 'stale' : 'storage', message);
  }
}

/**
 * «Прочитай → зміни → збережи»: `change(schema)` повертає результат функції ядра ({ ok, schema }).
 * Якщо схему тим часом змінили деінде, один раз перечитує й повторює зміну на свіжій.
 */
export async function updateProfileSchema(invoke, change) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const loaded = await loadProfileSchema(invoke);
    if (!loaded.ok) return loaded;
    const changed = change(loaded.schema);
    if (!changed.ok) return changed;
    if (changed.schema === loaded.schema || changed.schema.revision === loaded.schema.revision) {
      return { ...changed, storedRevision: loaded.storedRevision };
    }
    const saved = await saveProfileSchema(invoke, changed.schema, loaded.storedRevision);
    if (saved.ok) return { ...changed, storedRevision: saved.storedRevision };
    if (saved.code !== 'stale') return saved;
  }
  return failure('stale', 'Схему профілю змінено в іншому місці; повторіть дію.');
}
