// Host EasyFLY для телефона (контракт docs/WORKSPACE.md, як workspace-host.js, але без Tauri і
// без «Робочого середовища»): дані профілю — зашифроване сховище (vault-core.js), файли —
// вибір через <input type="file"> і збереження через системне меню «Поділитися» (iOS: «Зберегти у
// Файли») або звичайне завантаження. Без DOM: усі браузерні дії приходять параметрами.
//
// Параметри createPhoneHost:
//   vault      — сховище з vault-core.js (read/write/remove/list);
//   pickFile   — accept → Promise<File|null>;
//   shareFile  — (name, bytes) → Promise<'shared'|'cancelled'|'unsupported'>;
//   download   — (name, bytes) → void (запасний шлях);
//   onState    — ({ title, dirty }) → void;
//   rootUrl    — адреса кореня збірки для host.resolve.

export const APP_ENTRY = Object.freeze({ id: 'easyfly', title: 'EasyFLY', extensions: ['easyfly'] });
export const UI_LANGUAGE = 'uk';
export const UI_LOCALE = 'uk-UA';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ext = (list, fallback) => {
  const items = Array.isArray(list) ? list.map(e => String(e).replace(/^\./, '').toLowerCase()).filter(Boolean) : [];
  return items.length ? items : fallback;
};

/** Атрибут accept для <input type="file">. */
export function acceptAttribute(extensions) {
  return extensions.map(e => `.${e}`).join(',');
}

/** Додає розширення, якщо його немає; прибирає символи, небезпечні для назв файлів. */
export function nameWithExtension(name, extensions) {
  const base = String(name || APP_ENTRY.title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || APP_ENTRY.title;
  const lower = base.toLowerCase();
  if (extensions.some(e => lower.endsWith(`.${e}`))) return base;
  return `${base}.${extensions[0]}`;
}

export function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (typeof bytes === 'string') return new TextEncoder().encode(bytes);
  throw new TypeError('Очікуються байти файлу (Uint8Array).');
}

export function createPhoneHost({
  vault, pickFile, shareFile = async () => 'unsupported', download = null, onState = () => {}, rootUrl = '',
}) {
  if (!vault) throw new Error('createPhoneHost: потрібне сховище (vault).');
  const state = { title: '', dirty: false };
  const files = new Map();
  let nextHandle = 0;
  const publish = () => onState({ ...state });

  async function openFile(options = {}) {
    const extensions = ext(options.extensions, APP_ENTRY.extensions);
    const file = await pickFile(acceptAttribute(extensions));
    if (!file) return null;
    if (file.size > MAX_FILE_BYTES) throw new Error('Файл більший за 5 МБ.');
    const handle = `p${++nextHandle}`;
    files.set(handle, { name: file.name, extensions });
    return { handle, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  }

  /** → true: файл віддано користувачеві; false: користувач скасував. */
  async function deliver(name, bytes) {
    const shared = await shareFile(name, bytes);
    if (shared === 'shared') return true;
    if (shared === 'cancelled') return false;
    if (download) { download(name, bytes); return true; }
    throw new Error('Цей браузер не вміє ні ділитися файлами, ні завантажувати їх.');
  }

  async function saveFile({ handle, bytes } = {}) {
    if (!handle) throw new Error('Немає відкритого файлу: скористайтеся saveFileAs.');
    const known = files.get(handle);
    if (!known) throw new Error('Файл більше не відкритий; збережіть його через «Копія у файл…».');
    if (!(await deliver(known.name, toBytes(bytes)))) return null;
    return { handle, name: known.name };
  }

  async function saveFileAs({ bytes, ...options } = {}) {
    const extensions = ext(options.extensions, APP_ENTRY.extensions);
    const name = nameWithExtension(options.suggestedName || APP_ENTRY.title, extensions);
    if (!(await deliver(name, toBytes(bytes)))) return null;
    const handle = `p${++nextHandle}`;
    files.set(handle, { name, extensions });
    return { handle, name };
  }

  async function closeFile(handle) {
    if (handle) files.delete(handle);
  }

  return Object.freeze({
    appId: APP_ENTRY.id,
    language: UI_LANGUAGE,
    locale: UI_LOCALE,
    desktop: false,
    phone: true,
    rootUrl,
    pendingFile: null,
    resolve: path => new URL(String(path).replace(/^\/+/, ''), rootUrl || 'app://easyfly/').href,
    openFile,
    saveFile,
    saveFileAs,
    closeFile,
    profile: vault,
    collectives: null,
    setTitle(title) { state.title = String(title ?? ''); publish(); },
    setDirty(dirty) { state.dirty = Boolean(dirty); publish(); },
  });
}

/**
 * Поділитися файлом через Web Share API (iOS Safari: «Зберегти у Файли», AirDrop тощо).
 * → 'shared' — меню показано й дію завершено; 'cancelled' — користувач закрив меню (AbortError);
 * 'unsupported' — API або файли не підтримуються (тоді запасний шлях — завантаження).
 */
export async function shareViaNavigator(nav, name, bytes, { mime = 'application/json', FileCtor = globalThis.File } = {}) {
  if (typeof nav?.share !== 'function' || typeof nav.canShare !== 'function' || !FileCtor) return 'unsupported';
  let file;
  try {
    file = new FileCtor([bytes], name, { type: mime });
  } catch {
    return 'unsupported';
  }
  if (!nav.canShare({ files: [file] })) return 'unsupported';
  try {
    await nav.share({ files: [file], title: name });
    return 'shared';
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    throw error;
  }
}
