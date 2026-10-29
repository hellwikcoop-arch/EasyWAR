// Об'єкт `host`, який оболонка передає застосунку в mount(container, host): мова інтерфейсу,
// відкриття й збереження файлів через EasyWAR, заголовок і позначка незбережених змін.
// У настільному застосунку файли йдуть через Tauri-команди office_* (шляхи лишаються в Rust);
// у браузері без Tauri (vite preview) — через <input type="file"> і завантаження файлу.
// `pendingFile` — документ з бібліотеки, який чекає у вікні редактора (його першим віддає
// office_open_file, без вікна вибору); віддавши його, host ставить позначку в history.state кадру,
// тож після перезавантаження вікна документ уже не вважається очікуваним. Нічого не надсилається
// в мережу й не пишеться в сховища браузера.
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

// Вікно (цей кадр або батьківський), де є Tauri: там і invoke, і реєстр зворотних викликів подій.
function tauriFrame(win) {
  for (let current = win, depth = 0; current && depth < 4; depth += 1) {
    try {
      if (current.__TAURI__?.event?.listen || typeof current.__TAURI_INTERNALS__?.invoke === 'function') return current;
    } catch {
      return null;
    }
    if (current.parent === current) break;
    current = current.parent;
  }
  return null;
}

/**
 * Підписка на подію, яку Rust надсилає вікну (`library-state`, `office-editor-closed`): через
 * `__TAURI__.event.listen`, якщо глобальний API є, інакше напряму командою plugin:event|listen
 * з `transformCallback` того самого кадру, що й findInvoke (подія приходить у верхній кадр).
 * `handler(payload)`. → проміс функції відписки; без Tauri — null.
 */
export async function listenTauriEvent(event, handler, win = globalThis.window) {
  const frame = tauriFrame(win);
  if (!frame) return null;
  const deliver = message => handler(message?.payload);
  const global = frame.__TAURI__?.event?.listen;
  if (typeof global === 'function') return global(event, deliver);
  const internals = frame.__TAURI_INTERNALS__;
  if (typeof internals?.transformCallback !== 'function') return null;
  const eventId = await internals.invoke('plugin:event|listen', {
    event,
    target: { kind: 'Any' },
    handler: internals.transformCallback(deliver),
  });
  return async () => {
    try {
      frame.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener?.(event, eventId);
    } catch { /* кадр уже закривається */ }
    await internals.invoke('plugin:event|unlisten', { event, eventId });
  };
}

// Кадр (цей або батьківський), де Rust поставив `__EW_PENDING_FILE`; чужого походження не читається.
function pendingFrame(win) {
  for (let current = win, depth = 0; current && depth < 4; depth += 1) {
    try {
      if (current.__EW_PENDING_FILE !== undefined) return current;
    } catch {
      return null;
    }
    if (current.parent === current) break;
    current = current.parent;
  }
  return null;
}

// Ключ позначки в history.state: назва вже відданого очікуваного файлу. `__EW_PENDING_FILE`
// лишається тим самим після перезавантаження вікна, а Rust віддає документ лише раз; запис історії
// переживає перезавантаження, тож підказка й автовідкриття EasyGreen після нього вже не з'являються.
const PENDING_TAKEN_KEY = 'ewPendingTaken';

/**
 * Очікуваний файл з бібліотеки (`window.__EW_PENDING_FILE`, його ставить Rust лише у верхньому
 * кадрі вікна редактора) на цій сторінці або в батьківських — як findInvoke; чужого походження
 * кадр не читається. Уже відданий файл (позначка markPendingTaken) не повертається. → { name } або null.
 */
export function findPendingFile(win = globalThis.window) {
  const frame = pendingFrame(win);
  const pending = frame ? parsePendingFile(frame.__EW_PENDING_FILE) : null;
  if (!pending) return null;
  try {
    if (frame.history?.state?.[PENDING_TAKEN_KEY] === pending.name) return null;
  } catch { /* історія недоступна — файл вважається очікуваним */ }
  return pending;
}

/** Позначає очікуваний файл `name` відданим (history.state кадру з `__EW_PENDING_FILE`). → true, якщо вдалося. */
export function markPendingTaken(name, win = globalThis.window) {
  const frame = pendingFrame(win);
  if (!frame || typeof name !== 'string' || !name) return false;
  try {
    const state = frame.history.state;
    const base = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
    frame.history.replaceState({ ...base, [PENDING_TAKEN_KEY]: name }, '');
    return true;
  } catch {
    return false;
  }
}

/**
 * Створює host для застосунку. `invoke` — Tauri invoke або null; `browser` — запасні
 * функції без Tauri ({ pickFile(accept) → File|null, download(name, bytes) }); `onState` —
 * виклик при зміні заголовка чи позначки змін ({ title, dirty }); `rootUrl` — адреса кореня
 * збірки (там лежать і статичні файли з src/public), від неї рахує `host.resolve(path)`;
 * `pendingFile` — файл з бібліотеки, який віддасть перший openFile (типово шукається від
 * поточного вікна, як invoke; лише в настільному застосунку, без Tauri його немає);
 * `onPendingTaken(name)` — виклик, коли office_open_file віддав саме його (типово markPendingTaken).
 */
export function createHost({
  appEntry, invoke = null, browser = null, onState = () => {}, rootUrl = '', pendingFile = findPendingFile(), onPendingTaken = markPendingTaken,
}) {
  const state = { title: '', dirty: false };
  const pending = invoke ? parsePendingFile(pendingFile) : null;
  let pendingTaken = false;
  const browserFiles = new Map();
  let nextBrowserHandle = 0;
  const publish = () => onState({ ...state });

  async function openFile(options = {}) {
    const dialog = dialogOptions(appEntry, options);
    if (invoke) {
      const opened = await invoke('office_open_file', { options: dialog });
      if (!opened) return null;
      if (pending && !pendingTaken && parsePendingFile(opened.name)?.name === pending.name) {
        pendingTaken = true;
        try { onPendingTaken(pending.name); } catch { /* позначка необов'язкова */ }
      }
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

  // Захищені колективи (E8, C3b): лише для застосунку «Колективи» й лише в настільному
  // застосунку — команди collective_* дозволені вікну редактора. Пароль профілю йде в Rust
  // і ніде в JS не зберігається; назад приходять відбитки, назви й лічильники.
  const collectives = invoke && appEntry.id === 'collectives'
    ? Object.freeze({
      status: () => invoke('collective_status'),
      createIdentity: password => invoke('collective_create_identity', { password: String(password ?? '') }),
      create: (password, name) => invoke('collective_create', { password: String(password ?? ''), name: String(name ?? '') }),
    })
    : null;

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
    collectives,
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
