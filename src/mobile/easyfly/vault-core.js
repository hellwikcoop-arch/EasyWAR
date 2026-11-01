// Сховище EasyFLY на телефоні: усі дані профілю лежать в одному зашифрованому записі.
// Без DOM: приймає `storage` (асинхронний: getItem/setItem/removeItem) і `crypto` (WebCrypto).
//
// Чому так: у настільному EasyWAR дані профілю шифрує Rust (profile_data.rs). На телефоні
// Rust-ядра поки немає, тож шифрує браузер: PBKDF2-SHA-256 із парольної фрази → ключ
// AES-256-GCM; увесь набір записів (ключ → текст) — один JSON, зашифрований цілком, із новим
// nonce на кожен запис. Фраза в сховище не потрапляє; невірна фраза не проходить перевірку
// автентичності GCM і дає помилку «Невірна парольна фраза».
//
// Формат запису у сховищі (JSON, ключ VAULT_KEY):
//   { v: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, cipher: 'AES-GCM',
//     iv, data, modified }
// salt, iv, data — base64. Нічого іншого в сховище не пишеться.

export const VAULT_KEY = 'easyfly.vault.v1';
export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 310_000;
export const MIN_PASSPHRASE_LEN = 8;
/** Межа одного значення (як MAX_FILE_BYTES у fly-store.js) і всього набору. */
export const MAX_VALUE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export class VaultError extends Error {
  constructor(message, code = 'vault') {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new VaultError('Сховище пошкоджено: невірне кодування.', 'corrupt');
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Перевірка парольної фрази при створенні: → null або текст помилки. */
export function passphraseProblem(phrase) {
  if (typeof phrase !== 'string' || !phrase) return 'Введіть парольну фразу.';
  if (phrase.length < MIN_PASSPHRASE_LEN) return `Парольна фраза має містити щонайменше ${MIN_PASSPHRASE_LEN} символів.`;
  if (phrase.trim() !== phrase) return 'Парольна фраза не може починатися чи закінчуватися пробілом.';
  return null;
}

export function isValidKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return false;
  const dot = key.indexOf('.');
  return dot > 0 && /[a-z0-9]/.test(key[dot + 1] ?? '');
}

function assertKey(key) {
  if (!isValidKey(key)) throw new VaultError(`Некоректний ключ даних профілю: «${key}»`, 'key');
}

async function deriveKey(subtle, phrase, salt, iterations) {
  const material = await subtle.importKey('raw', encoder.encode(phrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function parseEnvelope(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new VaultError('Сховище пошкоджено: вміст не є JSON.', 'corrupt');
  }
  if (!raw || typeof raw !== 'object' || raw.v !== VAULT_VERSION) throw new VaultError('Сховище створено іншою версією EasyFLY.', 'version');
  const { kdf, cipher, iv, data } = raw;
  if (cipher !== 'AES-GCM' || kdf?.name !== 'PBKDF2' || kdf?.hash !== 'SHA-256') throw new VaultError('Сховище пошкоджено: невідомий алгоритм.', 'corrupt');
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < 100_000 || kdf.iterations > 10_000_000) throw new VaultError('Сховище пошкоджено: невірні параметри ключа.', 'corrupt');
  return { salt: fromBase64(kdf.salt), iterations: kdf.iterations, iv: fromBase64(iv), data: fromBase64(data), modified: String(raw.modified || '') };
}

function totalBytes(entries) {
  let total = 0;
  for (const entry of Object.values(entries)) total += encoder.encode(entry.value).length;
  return total;
}

/**
 * Створює сховище. `storage` — { getItem(name), setItem(name, text), removeItem(name) } (можуть бути
 * async); `crypto` — об'єкт із `subtle` і `getRandomValues`; `now` — час запису (ISO).
 *
 * Стани: `exists()` — чи є зашифрований запис; `unlocked` — чи відкрито. Поки сховище закрите,
 * read/write/remove/list кидають VaultError('locked').
 */
export function createVault({ storage, crypto, now = () => new Date().toISOString(), iterations = PBKDF2_ITERATIONS }) {
  if (!storage || !crypto?.subtle) throw new VaultError('Шифрування недоступне в цьому браузері.', 'unsupported');
  const { subtle } = crypto;
  let key = null; // CryptoKey після відкриття
  let salt = null;
  let kdfIterations = iterations;
  let entries = null; // { [key]: { value, modified } }

  async function readEnvelopeText() {
    const text = await storage.getItem(VAULT_KEY);
    return typeof text === 'string' && text ? text : null;
  }

  async function persist() {
    const plain = encoder.encode(JSON.stringify({ entries }));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    const envelope = {
      v: VAULT_VERSION,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdfIterations, salt: toBase64(salt) },
      cipher: 'AES-GCM',
      iv: toBase64(iv),
      data: toBase64(data),
      modified: now(),
    };
    try {
      await storage.setItem(VAULT_KEY, JSON.stringify(envelope));
    } catch (error) {
      throw new VaultError(`Не вдалося записати сховище: ${error?.message || 'сховище браузера недоступне або переповнене'}`, 'storage');
    }
    return envelope.modified;
  }

  function assertUnlocked() {
    if (!key || !entries) throw new VaultError('Сховище закрите: введіть парольну фразу.', 'locked');
  }

  return {
    get unlocked() { return Boolean(key && entries); },

    /** Чи є вже зашифрований запис на цьому пристрої. */
    async exists() {
      return (await readEnvelopeText()) !== null;
    },

    /** Створює порожнє сховище з новою фразою. Якщо запис уже є — помилка (спершу `destroy`). */
    async create(phrase) {
      const problem = passphraseProblem(phrase);
      if (problem) throw new VaultError(problem, 'passphrase');
      if (await readEnvelopeText()) throw new VaultError('Сховище на цьому пристрої вже є: відкрийте його фразою.', 'exists');
      salt = crypto.getRandomValues(new Uint8Array(16));
      kdfIterations = iterations;
      key = await deriveKey(subtle, phrase, salt, kdfIterations);
      entries = {};
      await persist();
    },

    /** Відкриває сховище фразою. Невірна фраза → VaultError('passphrase'). */
    async unlock(phrase) {
      if (typeof phrase !== 'string' || !phrase) throw new VaultError('Введіть парольну фразу.', 'passphrase');
      const text = await readEnvelopeText();
      if (!text) throw new VaultError('Сховища на цьому пристрої ще немає: створіть його.', 'missing');
      const envelope = parseEnvelope(text);
      const candidate = await deriveKey(subtle, phrase, envelope.salt, envelope.iterations);
      let plain;
      try {
        plain = await subtle.decrypt({ name: 'AES-GCM', iv: envelope.iv }, candidate, envelope.data);
      } catch {
        throw new VaultError('Невірна парольна фраза.', 'passphrase');
      }
      let parsed;
      try {
        parsed = JSON.parse(decoder.decode(plain));
      } catch {
        throw new VaultError('Сховище пошкоджено: розшифрований вміст нечитабельний.', 'corrupt');
      }
      if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') throw new VaultError('Сховище пошкоджено.', 'corrupt');
      key = candidate;
      salt = envelope.salt;
      kdfIterations = envelope.iterations;
      entries = parsed.entries;
    },

    /** Забуває ключ і дані в пам'яті; зашифрований запис лишається. */
    lock() {
      key = null;
      entries = null;
    },

    /** Стирає запис із пристрою назавжди. */
    async destroy() {
      this.lock();
      await storage.removeItem(VAULT_KEY);
    },

    // ─── інтерфейс даних профілю (як profile-store.js) ───

    get available() { return true; },
    mode: 'phone-vault',

    async read(k) {
      assertKey(k);
      assertUnlocked();
      const entry = entries[k];
      return entry ? { key: k, value: entry.value, modified: entry.modified } : null;
    },

    async write(k, value) {
      assertKey(k);
      assertUnlocked();
      if (typeof value !== 'string' || !value) throw new VaultError('Порожнє значення не записується.', 'value');
      if (encoder.encode(value).length > MAX_VALUE_BYTES) throw new VaultError('Запис перевищує 5 МБ.', 'size');
      const previous = entries[k];
      const modified = now();
      entries[k] = { value, modified };
      if (totalBytes(entries) > MAX_TOTAL_BYTES) {
        if (previous) entries[k] = previous; else delete entries[k];
        throw new VaultError('Сховище переповнене: зменште кількість записів.', 'size');
      }
      try {
        await persist();
      } catch (error) {
        if (previous) entries[k] = previous; else delete entries[k];
        throw error;
      }
      return modified;
    },

    async remove(k) {
      assertKey(k);
      assertUnlocked();
      if (!(k in entries)) return false;
      const previous = entries[k];
      delete entries[k];
      try {
        await persist();
      } catch (error) {
        entries[k] = previous;
        throw error;
      }
      return true;
    },

    async list(prefix = '') {
      assertUnlocked();
      return Object.entries(entries)
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, entry]) => ({ key: k, modified: entry.modified, size: encoder.encode(entry.value).length }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
  };
}

/**
 * Сховище на IndexedDB (одна таблиця «kv»). localStorage на iOS обмежений ~5 МБ і може бути
 * очищений системою, тож зашифрований запис тримаємо в IndexedDB.
 */
export function createIndexedDbStorage(indexedDB, name = 'easyfly-phone') {
  if (!indexedDB) throw new VaultError('IndexedDB недоступна в цьому браузері.', 'unsupported');
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => { request.result.createObjectStore('kv'); };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB не відкрилася'));
        request.onblocked = () => reject(new Error('IndexedDB заблокована іншою вкладкою'));
      });
    }
    return dbPromise;
  };
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const request = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error || new Error('Помилка IndexedDB'));
      tx.onabort = () => reject(tx.error || new Error('Запис в IndexedDB перервано'));
    });
  };
  return {
    getItem: k => run('readonly', store => store.get(k)).then(v => (typeof v === 'string' ? v : null)),
    setItem: (k, v) => run('readwrite', store => store.put(v, k)).then(() => undefined),
    removeItem: k => run('readwrite', store => store.delete(k)).then(() => undefined),
  };
}
