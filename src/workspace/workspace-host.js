// Об'єкт `host`, який оболонка передає застосунку в mount(container, host): мова інтерфейсу,
// відкриття й збереження файлів через EasyWAR, заголовок і позначка незбережених змін.
// У настільному застосунку файли йдуть через Tauri-команди office_* (шляхи лишаються в Rust);
// у браузері без Tauri (vite preview) — через <input type="file"> і завантаження файлу.
// `pendingFile` — документ з бібліотеки, який чекає у вікні редактора (його першим віддає
// office_open_file, без вікна вибору). Нічого не надсилається в мережу й не пишеться в сховища браузера.
import {
  CONTRACT_VERSION,
  UI_LANGUAGE,
  UI_LOCALE,
  acceptAttribute,
  bytesForInvoke,
  dialogOptions,
  nameWithExtension,
  parsePendingFile,
  toBytes,
} from './workspace-core.js';

/** Tauri invoke цієї сторінки або батьківських (сторінка застосунку лежить у двох iframe). */
export function findInvoke(win = globalThis.window) {
  for (let current = win, depth = 0; current && depth < 4; depth += 1) {
    try {
      const invoke = current.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke === 'function') return invoke.bind(current.__TAURI_INTERNALS__);
    } catch {
      return null;
    }
    if (current.parent === current) break;
    current = current.parent;
  }
  return null;
}

/**
 * Очікуваний файл з бібліотеки (`window.__EW_PENDING_FILE`, його ставить Rust лише у верхньому
 * кадрі вікна редактора) на цій сторінці або в батьківських — як findInvoke; чужого походження
 * кадр не читається. → { name } або null.
 */
export function findPendingFile(win = globalThis.window) {
  for (let current = win, depth = 0; current && depth < 4; depth += 1) {
    try {
      if (current.__EW_PENDING_FILE !== undefined) return parsePendingFile(current.__EW_PENDING_FILE);
    } catch {
      return null;
    }
    if (current.parent === current) break;
    current = current.parent;
  }
  return null;
}

/**
 * Створює host для застосунку. `invoke` — Tauri invoke або null; `browser` — запасні
 * функції без Tauri ({ pickFile(accept) → File|null, download(name, bytes) }); `onState` —
 * виклик при зміні заголовка чи позначки змін ({ title, dirty }); `rootUrl` — адреса кореня
 * збірки (там лежать і статичні файли з src/public), від неї рахує `host.resolve(path)`;
 * `pendingFile` — файл з бібліотеки, який віддасть перший openFile (типово шукається від
 * поточного вікна, як invoke; лише в настільному застосунку, без Tauri його немає).
 */
export function createHost({ appEntry, invoke = null, browser = null, onState = () => {}, rootUrl = '', pendingFile = findPendingFile() }) {
  const state = { title: '', dirty: false };
  const pending = invoke ? parsePendingFile(pendingFile) : null;
  const browserFiles = new Map();
  let nextBrowserHandle = 0;
  const publish = () => onState({ ...state });

  async function openFile(options = {}) {
    const dialog = dialogOptions(appEntry, options);
    if (invoke) {
      const opened = await invoke('office_open_file', { options: dialog });
      if (!opened) return null;
      return { handle: opened.handle, name: opened.name, bytes: Uint8Array.from(opened.bytes) };
    }
    const file = await browser?.pickFile(acceptAttribute(dialog.extensions));
    if (!file) return null;
    const handle = `b${++nextBrowserHandle}`;
    browserFiles.set(handle, { name: file.name, extensions: dialog.extensions });
    return { handle, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  }

  async function saveFile({ handle, bytes } = {}) {
    if (!handle) throw new Error('Немає відкритого файлу: скористайтеся saveFileAs.');
    if (invoke) return invoke('office_save_file', { handle, bytes: bytesForInvoke(bytes) });
    const known = browserFiles.get(handle);
    if (!known) throw new Error('Файл більше не відкритий; збережіть його через «Зберегти як…».');
    bytesForInvoke(bytes);
    browser?.download(known.name, toBytes(bytes));
    return { handle, name: known.name };
  }

  async function saveFileAs({ bytes, ...options } = {}) {
    const dialog = dialogOptions(appEntry, options);
    if (invoke) return invoke('office_save_file_as', { bytes: bytesForInvoke(bytes), options: dialog });
    bytesForInvoke(bytes);
    const name = nameWithExtension(dialog.suggestedName || appEntry.title, dialog.extensions);
    browser?.download(name, toBytes(bytes));
    const handle = `b${++nextBrowserHandle}`;
    browserFiles.set(handle, { name, extensions: dialog.extensions });
    return { handle, name };
  }

  async function closeFile(handle) {
    if (!handle) return;
    if (invoke) await invoke('office_close_file', { handle });
    browserFiles.delete(handle);
  }

  return Object.freeze({
    contract: CONTRACT_VERSION,
    appId: appEntry.id,
    language: UI_LANGUAGE,
    locale: UI_LOCALE,
    desktop: Boolean(invoke),
    rootUrl,
    pendingFile: pending,
    resolve: path => new URL(String(path).replace(/^\/+/, ''), rootUrl).href,
    openFile,
    saveFile,
    saveFileAs,
    closeFile,
    setTitle(title) {
      state.title = String(title ?? '');
      publish();
    },
    setDirty(dirty) {
      state.dirty = Boolean(dirty);
      publish();
    },
  });
}

/** Запасні функції браузера без Tauri для документа `doc`. */
export function browserFallback(doc) {
  return {
    pickFile(accept) {
      return new Promise(resolve => {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.hidden = true;
        input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
        input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
        doc.body.append(input);
        input.click();
      });
    },
    download(name, bytes) {
      const url = URL.createObjectURL(new Blob([bytes]));
      const link = doc.createElement('a');
      link.href = url;
      link.download = name;
      link.hidden = true;
      doc.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
