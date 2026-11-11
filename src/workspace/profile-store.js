// Клієнт даних профілю (контракт docs/WORKSPACE.md, «Дані профілю»): усі дані застосунків
// «Робочого середовища» прив'язані до профілю й лежать зашифрованими в прихованій теці
// застосунку (Rust: src-tauri/src/profile_data.rs). Увійшов у профіль — і дані доступні, без
// відкриття файлів. Файли (.easyfly тощо) лишаються лише імпортом і експортом.
//
// Ключ — «простір.назва» (латиниця в нижньому регістрі, цифри, . _ -; простір імен — частина
// до першої крапки, зазвичай id застосунку). Значення — текст (зазвичай JSON). Вікно редактора
// бачить лише простір імен свого застосунку (це перевіряє Rust).
//
// Режими:
//  - 'profile' — настільний застосунок (є Tauri invoke): команди profile_data_*;
//  - 'browser' — без Tauri (vite preview, розробка): переданий storage (localStorage). У продукті
//    цього режиму немає: там завжди є invoke, і дані в localStorage не потрапляють;
//  - 'none' — ні того, ні того: читання дає null, запис — помилку.

export const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const BROWSER_PREFIX = 'easywar.profile.v1:';

export class ProfileStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileStoreError';
  }
}

/** Чи ключ має вигляд «простір.назва». */
export function isValidKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return false;
  const dot = key.indexOf('.');
  // Як у Rust (validate_key): після крапки простору імен має стояти літера або цифра.
  return dot > 0 && /[a-z0-9]/.test(key[dot + 1] ?? '');
}

/** Простір імен ключа (частина до першої крапки). */
export function namespaceOf(key) {
  return String(key).split('.')[0];
}

function assertKey(key) {
  if (!isValidKey(key)) throw new ProfileStoreError(`Некоректний ключ даних профілю: «${key}»`);
}

function messageOf(error) {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return 'не вдалося звернутися до даних профілю';
}

function browserEntries(storage, prefix) {
  const items = [];
  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (name && name.startsWith(BROWSER_PREFIX)) {
      const key = name.slice(BROWSER_PREFIX.length);
      if (key.startsWith(prefix)) items.push([key, name]);
    }
  }
  return items;
}

/**
 * Створює клієнт. `invoke` — Tauri invoke або null; `storage` — localStorage-подібний об'єкт
 * для режиму без Tauri або null.
 */
export function createProfileStore({ invoke = null, storage = null, now = () => new Date().toISOString() } = {}) {
  const mode = invoke ? 'profile' : (storage ? 'browser' : 'none');

  async function call(command, args) {
    try {
      return await invoke(command, args);
    } catch (error) {
      throw new ProfileStoreError(messageOf(error));
    }
  }

  function browserGet(key) {
    let text;
    try {
      text = storage.getItem(BROWSER_PREFIX + key);
    } catch {
      return null;
    }
    if (typeof text !== 'string') return null;
    try {
      const parsed = JSON.parse(text);
      return typeof parsed?.value === 'string' ? { key, value: parsed.value, modified: String(parsed.modified || '') } : null;
    } catch {
      return null;
    }
  }

  return {
    mode,
    /** Чи є куди зберігати. */
    get available() { return mode !== 'none'; },

    /** → { key, value, modified } або null. Кидає ProfileStoreError, якщо дані недоступні. */
    async read(key) {
      assertKey(key);
      if (mode === 'profile') return (await call('profile_data_get', { key })) || null;
      if (mode === 'browser') return browserGet(key);
      return null;
    },

    /** Записує текст. → час запису. */
    async write(key, value) {
      assertKey(key);
      if (typeof value !== 'string' || !value) throw new ProfileStoreError('Порожнє значення не записується.');
      if (mode === 'profile') return call('profile_data_set', { key, value });
      if (mode === 'browser') {
        const modified = now();
        try {
          storage.setItem(BROWSER_PREFIX + key, JSON.stringify({ value, modified }));
        } catch {
          throw new ProfileStoreError('Сховище браузера недоступне або переповнене.');
        }
        return modified;
      }
      throw new ProfileStoreError('Сховище профілю недоступне.');
    },

    /** → true, якщо запис був. */
    async remove(key) {
      assertKey(key);
      if (mode === 'profile') return Boolean(await call('profile_data_remove', { key }));
      if (mode === 'browser') {
        const had = browserGet(key) !== null;
        try { storage.removeItem(BROWSER_PREFIX + key); } catch { /* недоступне — запису й не було */ }
        return had;
      }
      return false;
    },

    /** Перелік без значень: [{ key, modified, size }] за ключем. `prefix` — «простір.» або порожній. */
    async list(prefix = '') {
      if (mode === 'profile') return (await call('profile_data_list', { prefix })) || [];
      if (mode === 'browser') {
        return browserEntries(storage, prefix)
          .map(([key]) => browserGet(key))
          .filter(Boolean)
          .map(item => ({ key: item.key, modified: item.modified, size: item.value.length }))
          .sort((a, b) => (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)));
      }
      return [];
    },

    /** Читає JSON; пошкоджений текст — null (дані не відкидаються: їх лишає перший запис). */
    async readJson(key) {
      const record = await this.read(key);
      if (!record) return null;
      try {
        return JSON.parse(record.value);
      } catch {
        return null;
      }
    },

    async writeJson(key, value) {
      return this.write(key, JSON.stringify(value));
    },
  };
}

/**
 * Одноразове перенесення значення зі старого місця (localStorage сторінки) у сховище профілю.
 * Старе значення видаляється лише після того, як нове записане й читається назад. Якщо запис
 * у профілі вже є, старий залишок просто прибирається (дані першого профілю, що його забрав).
 * → 'migrated' | 'present' | 'none' | 'failed'.
 */
export async function migrateLegacy(store, { key, legacyStorage, legacyKey, accept = () => true }) {
  if (!store.available || !legacyStorage) return 'none';
  let legacy;
  try {
    legacy = legacyStorage.getItem(legacyKey);
  } catch {
    return 'none';
  }
  if (typeof legacy !== 'string' || !legacy) return 'none';
  const drop = () => { try { legacyStorage.removeItem(legacyKey); } catch { /* лишається — не страшно */ } };
  try {
    const existing = await store.read(key);
    if (existing) {
      // У браузерному режимі «старе» і «нове» — один і той самий storage, але інші назви.
      drop();
      return 'present';
    }
    if (!accept(legacy)) return 'none';
    await store.write(key, legacy);
    const back = await store.read(key);
    if (!back || back.value !== legacy) return 'failed';
    drop();
    return 'migrated';
  } catch {
    return 'failed';
  }
}

/** localStorage, якщо він доступний (інакше null): сторінка може його не мати. */
export function safeLocalStorage(win = globalThis.window) {
  try {
    const storage = win?.localStorage;
    if (!storage) return null;
    const probe = `${BROWSER_PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Читає текст запису профілю з перенесенням старого значення з localStorage сторінки (якщо воно
 * там лишилось від попередніх версій). → { text, error }: `text` — null, якщо запису немає;
 * `error` — причина, якщо дані профілю недоступні (тоді застосунок працює без збереження і каже про це).
 */
export async function loadText(store, { key, legacyStorage = null, legacyKey = null }) {
  if (!store?.available) return { text: null, error: null };
  if (legacyStorage && legacyKey) await migrateLegacy(store, { key, legacyStorage, legacyKey });
  try {
    const record = await store.read(key);
    return { text: record ? record.value : null, error: null };
  } catch (error) {
    return { text: null, error: error?.message || 'дані профілю недоступні' };
  }
}
