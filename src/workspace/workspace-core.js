// Чиста логіка модуля «Робоче середовище»: реєстр застосунків розділів «Офіс» і «Особисте», контракт
// підключення застосунку (версія, перевірка того, що повертає mount), параметри вікон
// відкриття/збереження. Без DOM і Tauri, щоб її можна було перевірити в node --test.
// Оболонка — workspace.js, сторінка одного застосунку — app-frame.js, файли — workspace-host.js.

/** Версія контракту підключення. Застосунок може експортувати `contract` з цим числом. */
export const CONTRACT_VERSION = 1;

/** Мова інтерфейсу, яку оболонка передає застосункам: EasyWAR — лише українською. */
export const UI_LANGUAGE = 'uk';
export const UI_LOCALE = 'uk-UA';

/** Межі збігаються з Rust-ядром (office_files.rs); ядро перевіряє їх ще раз. */
export const MAX_EXTENSIONS = 8;
const MAX_EXTENSION_LEN = 10;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;

const app = fields => Object.freeze({ ...fields, extensions: Object.freeze([...fields.extensions]) });

/**
 * Застосунки розділу «Офіс» у порядку карток. `extensions` і `filterName` — типовий фільтр
 * вікна відкриття/збереження (застосунок може передати свій у кожному виклику).
 * Код застосунку лежить у `src/workspace/<id>/app.js`; поки файлу немає, картка
 * відкриває сторінку «у розробці».
 */
export const OFFICE_APPS = Object.freeze([
  app({
    id: 'easygreen',
    title: 'EasyGreen',
    kind: 'Таблиці',
    hint: 'Електронні таблиці: формули, аркуші, файли XLSX',
    extensions: ['xlsx', 'csv'],
    filterName: 'Таблиці',
  }),
  app({
    id: 'easydoc',
    title: 'EasyDoc',
    kind: 'Документи',
    hint: 'Текстові документи: накази, довідки, звіти',
    extensions: ['docx', 'txt'],
    filterName: 'Документи',
  }),
  app({
    id: 'easyslide',
    title: 'EasySlide',
    kind: 'Презентації',
    hint: 'Презентації: слайди для доповідей і нарад',
    extensions: ['pptx'],
    filterName: 'Презентації',
  }),
]);

/**
 * Застосунки розділу «Особисте»: дані однієї людини для неї самої, лише у її власних файлах.
 */
export const PERSONAL_APPS = Object.freeze([
  app({
    id: 'easypay',
    title: 'easyPay',
    kind: 'Грошове забезпечення',
    hint: 'Калькулятор виплат і журнал того, що вам мають виплатити, з нагадуваннями',
    extensions: ['easypay'],
    filterName: 'Журнал easyPay',
  }),
]);

/** Усі застосунки модуля в порядку розділів. */
export const WORKSPACE_APPS = Object.freeze([...OFFICE_APPS, ...PERSONAL_APPS]);

/** Розділи модуля: «Офіс» і «Особисте». */
export const WORKSPACE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'office', title: 'Офіс', apps: Object.freeze(OFFICE_APPS.map(entry => entry.id)) }),
  Object.freeze({ id: 'personal', title: 'Особисте', apps: Object.freeze(PERSONAL_APPS.map(entry => entry.id)) }),
]);

export function appById(id) {
  return WORKSPACE_APPS.find(entry => entry.id === id) || null;
}

/** Адреса сторінки застосунку відносно `workspace/index.html`. */
export function appPageUrl(id) {
  if (!appById(id)) throw new Error(`Невідомий застосунок: ${id}`);
  return `app.html?app=${encodeURIComponent(id)}`;
}

/**
 * Де працює оболонка. `editorApp` — window.__EW_EDITOR_APP (його ставить Rust лише у вікні
 * редактора), `hasInvoke` — чи є Tauri. 'editor': окреме вікно редактора, застосунок
 * відкривається одразу, закриття закриває вікно; 'desktop': головне вікно, картка відкриває
 * вікно редактора (F-01: код редактора не працює в головному вікні); 'browser': без Tauri
 * (vite preview), застосунок відкривається в iframe, як раніше.
 */
export function shellMode(editorApp, hasInvoke) {
  if (editorApp !== undefined) {
    return { mode: 'editor', app: typeof editorApp === 'string' ? appById(editorApp) : null };
  }
  return { mode: hasInvoke ? 'desktop' : 'browser', app: null };
}

/** Застосунок з рядка адреси `?app=<id>` або null. */
export function appFromSearch(search) {
  const id = new URLSearchParams(String(search || '')).get('app');
  return id ? appById(id) : null;
}

/** Ключ `import.meta.glob('./*\/app.js')` для застосунку. */
export function entryKey(id) {
  return `./${id}/app.js`;
}

/** Завантажувач коду застосунку з результату glob або null (застосунок ще не підключено). */
export function findEntry(modules, id) {
  const loader = modules && modules[entryKey(id)];
  return typeof loader === 'function' ? loader : null;
}

/**
 * Перевіряє модуль застосунку: має бути функція `mount`, а `contract` (якщо є) — не новіший
 * за оболонку. Повертає текст помилки українською або null.
 */
export function entryError(entry) {
  if (!entry || typeof entry.mount !== 'function') return 'Застосунок не експортує функцію mount(container, host).';
  if (entry.contract !== undefined) {
    if (!Number.isInteger(entry.contract) || entry.contract < 1) return 'Застосунок має недійсну версію контракту.';
    if (entry.contract > CONTRACT_VERSION) {
      return `Застосунок потребує новішої версії EasyWAR (контракт ${entry.contract}, підтримується ${CONTRACT_VERSION}).`;
    }
  }
  return null;
}

/**
 * Що повернув mount: необов'язковий об'єкт з `unmount()` (або `destroy()`) — викликається при
 * закритті, і `isDirty()` — чи є незбережені зміни (на додачу до host.setDirty).
 */
export function normalizeMounted(result) {
  const value = result && typeof result === 'object' ? result : {};
  const unmount = [value.unmount, value.destroy].find(fn => typeof fn === 'function');
  const isDirty = typeof value.isDirty === 'function' ? value.isDirty : null;
  return {
    unmount: unmount ? () => unmount.call(value) : () => {},
    isDirty: () => {
      try { return Boolean(isDirty?.call(value)); } catch { return false; }
    },
  };
}

/** Розширення без крапки, малими літерами, лише латиниця й цифри (як у Rust). */
export function normalizeExtensions(extensions) {
  const list = Array.isArray(extensions) ? extensions : [];
  if (!list.length) throw new Error('Потрібне щонайменше одне розширення файлу.');
  if (list.length > MAX_EXTENSIONS) throw new Error(`Забагато розширень файлу (не більше ${MAX_EXTENSIONS}).`);
  const result = [];
  for (const raw of list) {
    const value = String(raw ?? '').trim().replace(/^\.+/, '').toLowerCase();
    if (!value || value.length > MAX_EXTENSION_LEN || !/^[a-z0-9]+$/.test(value)) {
      throw new Error(`Недопустиме розширення файлу «${raw}».`);
    }
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

/**
 * Параметри вікна для Tauri-команд `office_open_file` / `office_save_file_as`: типові
 * значення беруться з реєстру застосунку, передані — мають перевагу.
 */
export function dialogOptions(appEntry, options = {}) {
  return {
    extensions: normalizeExtensions(options.extensions ?? appEntry.extensions),
    title: options.title ? String(options.title) : null,
    filterName: options.filterName ? String(options.filterName) : appEntry.filterName,
    suggestedName: options.suggestedName ? baseName(options.suggestedName) : null,
  };
}

/** Значення `accept` для `<input type="file">` у браузері без Tauri. */
export function acceptAttribute(extensions) {
  return normalizeExtensions(extensions).map(extension => `.${extension}`).join(',');
}

/** Остання частина шляху без каталогів. */
export function baseName(name) {
  return String(name ?? '').split(/[\\/]/).pop().trim();
}

/** Ім'я для збереження: дописує перше розширення, якщо його немає серед дозволених. */
export function nameWithExtension(name, extensions) {
  const allowed = normalizeExtensions(extensions);
  const base = baseName(name) || 'Документ';
  const dot = base.lastIndexOf('.');
  const current = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return allowed.includes(current) ? base : `${base}.${allowed[0]}`;
}

/** Байти для Tauri (Vec<u8> приймає масив чисел). */
export function bytesForInvoke(bytes) {
  const view = toBytes(bytes);
  if (!view.length) throw new Error('Файл порожній.');
  if (view.length > MAX_FILE_BYTES) throw new Error('Файл більший за 256 МБ.');
  return Array.from(view);
}

/** Uint8Array з Uint8Array, ArrayBuffer, типізованого масиву або масиву чисел. */
export function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  throw new Error('Очікуються байти файлу (Uint8Array або ArrayBuffer).');
}

/** Заголовок сторінки застосунку: «EasyGreen — звіт.xlsx •» (крапка — незбережені зміни). */
export function frameTitle(appEntry, title, dirty) {
  const text = String(title ?? '').trim().slice(0, 120);
  return `${appEntry.title}${text ? ` — ${text}` : ''}${dirty ? ' •' : ''}`;
}

/** Повідомлення від сторінки застосунку до оболонки (postMessage у межах одного походження). */
export const FRAME_MESSAGE = 'easywar-workspace-app';

export function frameMessage(appId, state) {
  return { type: FRAME_MESSAGE, appId, title: String(state.title ?? ''), dirty: Boolean(state.dirty) };
}

/** Розбір повідомлення від сторінки застосунку; чуже чи зламане — null. */
export function parseFrameMessage(data, expectedAppId) {
  if (!data || data.type !== FRAME_MESSAGE || data.appId !== expectedAppId) return null;
  return { title: String(data.title ?? '').slice(0, 120), dirty: Boolean(data.dirty) };
}
