// Чиста логіка модуля «Робоче середовище»: реєстр застосунків розділів «Офіс», «Обстановка» і «Особисте», контракт
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
    hint: 'Таблиці для роботи з локальними файлами.',
    extensions: ['xlsx', 'csv'],
    filterName: 'Таблиці',
  }),
  app({
    id: 'easydoc',
    title: 'EasyDoc',
    kind: 'Документи',
    hint: 'Тексти й документи в одному робочому просторі.',
    extensions: ['docx', 'txt'],
    filterName: 'Документи',
  }),
  app({
    id: 'easyslide',
    title: 'EasySlide',
    kind: 'Презентації',
    hint: 'Слайди для нарад і робочих матеріалів.',
    extensions: ['pptx'],
    filterName: 'Презентації',
  }),
]);

/**
 * Застосунки розділу «Обстановка»: працюють без файлів (порожні `extensions`) і в головному вікні,
 * не у вікні редактора. «Погода» бере дані з інтернету лише після явного ввімкнення
 * користувачем (src/workspace/weather).
 */
export const SITUATION_APPS = Object.freeze([
  app({
    id: 'weather',
    title: 'Погода',
    kind: 'Метеоумови',
    hint: 'Нижній край хмар, видимість і хмарність у вибраному населеному пункті',
    extensions: [],
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

/** Застосунки розділу «Авіація»: контроль льотних перевірок і штурманські документи. */
export const AVIATION_APPS = Object.freeze([
  app({
    id: 'easyfly',
    title: 'EasyFLY',
    kind: 'Авіація',
    hint: 'Контроль льотних перевірок і допусків, штурманські документи: ІШР, ШПП, бортжурнал, Сонце і Місяць',
    extensions: ['easyfly'],
    filterName: 'Дані EasyFLY',
  }),
]);

/**
 * Застосунки розділу «Колективи»: локальний план колективу (main) і демонстрація S1 «Колектив (демо)» —
 * спільна таблиця двох учасників у пам'яті вікна, без мережі, команд Tauri, профілів і збереження
 * (src/workspace/collective-demo).
 */
export const COLLECTIVE_APPS = Object.freeze([
  app({
    id: 'collectives',
    title: 'Колективи',
    kind: 'Локальний план',
    hint: 'Створення локального колективу, позначення учасників і ролей із збереженням у файл.',
    extensions: ['ewcoll'],
    filterName: 'Локальні колективи',
  }),
  app({
    id: 'collective-demo',
    title: 'Колектив (демо)',
    kind: 'Спільна таблиця',
    hint: 'Демонстрація «Доповісти» → «Звірити» між двома учасниками — без мережі та збереження',
    extensions: [],
  }),
]);

/** Усі застосунки модуля в порядку розділів. */
export const WORKSPACE_APPS = Object.freeze([...OFFICE_APPS, ...SITUATION_APPS, ...COLLECTIVE_APPS, ...PERSONAL_APPS, ...AVIATION_APPS]);


/** Розділи модуля: «Офіс», «Обстановка», «Колективи», «Особисте» і «Авіація». */
export const WORKSPACE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'office', title: 'Офіс', eyebrow: 'ЛОКАЛЬНІ ЗАСТОСУНКИ', subtitle: 'Оберіть застосунок для роботи з файлами на цьому комп’ютері.', apps: Object.freeze(OFFICE_APPS.map(entry => entry.id)) }),
  Object.freeze({ id: 'situation', title: 'Обстановка', eyebrow: 'ПОТОЧНА ОБСТАНОВКА', subtitle: 'Погода у вибраному населеному пункті: вручну або з інтернету, якщо ви його ввімкнете.', apps: Object.freeze(SITUATION_APPS.map(entry => entry.id)) }),
  Object.freeze({ id: 'collectives', title: 'Колективи', eyebrow: 'ЛОКАЛЬНІ КОЛЕКТИВИ', subtitle: 'Підготуйте склад і ролі, збережіть у файл. Захищений вступ і Sync — окремий етап.', apps: Object.freeze(COLLECTIVE_APPS.map(entry => entry.id)) }),
  Object.freeze({ id: 'personal', title: 'Особисте', eyebrow: 'ПЕРСОНАЛЬНІ ІНСТРУМЕНТИ', subtitle: 'Розрахунки й журнали лише для вас, у локальному файлі на цьому комп’ютері.', apps: Object.freeze(PERSONAL_APPS.map(entry => entry.id)) }),
  Object.freeze({ id: 'aviation', title: 'Авіація', eyebrow: 'ЛЬОТНА РОБОТА', subtitle: 'Льотні перевірки, допуски й штурманські документи у вашому локальному файлі.', apps: Object.freeze(AVIATION_APPS.map(entry => entry.id)) }),
]);

export function appById(id) {
  return WORKSPACE_APPS.find(entry => entry.id === id) || null;
}

/** Розділ, у якому лежить застосунок, або null. */
export function sectionOfApp(id) {
  return WORKSPACE_SECTIONS.find(section => section.apps.includes(id)) || null;
}

/**
 * Чи відкривати застосунок в окремому вікні редактора (лише office_*). Застосунки «Обстановки» —
 * наш код без файлів і чужого WASM, їм потрібні власні команди головного вікна (погода). «Колектив (демо)»
 * теж без файлів і без команд Tauri — лишається в iframe головного вікна, як погода.
 */
// Застосунки без файлів і без чужого WASM лишаються в iframe головного вікна: «Погода» («Обстановка»)
// і «Колектив (демо)» (команд Tauri не викликає). Решта, зокрема «Колективи» з файлами .ewcoll, — у вікні редактора.
const MAIN_WINDOW_APPS = new Set([...SITUATION_APPS, ...COLLECTIVE_APPS.filter(entry => entry.extensions.length === 0)].map(entry => entry.id));

export function opensInEditorWindow(id) {
  return Boolean(appById(id)) && !MAIN_WINDOW_APPS.has(id);
}

/**
 * Рід військ, чий акцент бере «Офіс» (рішення власника 20.10.2026: темно-синя схема
 * лаунчера з акцентом роду військ). Ключі — ті самі, що data-branch у лаунчері; кольори
 * задає workspace.css через html[data-branch]. Без роду — Повітряні Сили, перша картка.
 */
export const BRANCHES = Object.freeze(['air', 'rocket', 'artillery', 'pvk', 'dshv']);
export const DEFAULT_BRANCH = 'air';

export function normalizeBranch(value) {
  return BRANCHES.includes(value) ? value : DEFAULT_BRANCH;
}

/** Рід військ з рядка адреси `?branch=<id>`; невідомий або відсутній — типовий. */
export function branchFromSearch(search) {
  return normalizeBranch(new URLSearchParams(String(search || '')).get('branch'));
}

/** Адреса сторінки застосунку відносно `workspace/index.html`. */
export function appPageUrl(id, branch = DEFAULT_BRANCH) {
  if (!appById(id)) throw new Error(`Невідомий застосунок: ${id}`);
  return `app.html?app=${encodeURIComponent(id)}&branch=${normalizeBranch(branch)}`;
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

// Найдовша назва очікуваного файлу, яку показує оболонка (назва документа бібліотеки — до 120
// символів, з розширенням трохи більше).
const MAX_PENDING_NAME_CHARS = 200;
// Керівні символи й символи зміни напрямку тексту (ними можна підмінити видиму назву).
const PENDING_NAME_FORBIDDEN = /[\p{Cc}‪-‮⁦-⁩]/gu;

/**
 * Очікуваний файл з бібліотеки EasyWAR: значення `window.__EW_PENDING_FILE`, яке Rust ставить у
 * вікні редактора після «Відкрити» в бібліотеці (назва документа рядком або null) → `{ name }`
 * або null. Приймає й назву, ще раз закодовану як рядок JSON, і об'єкт `{ name }`.
 */
export function parsePendingFile(value) {
  let name = value && typeof value === 'object' && !Array.isArray(value) ? value.name : value;
  if (typeof name !== 'string') return null;
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    try {
      const decoded = JSON.parse(name);
      if (typeof decoded === 'string') name = decoded;
    } catch {
      // не JSON — це сама назва
    }
  }
  const cleaned = Array.from(name.replace(PENDING_NAME_FORBIDDEN, '')).slice(0, MAX_PENDING_NAME_CHARS).join('').trim();
  return cleaned ? Object.freeze({ name: cleaned }) : null;
}

// Редактори, які беруть очікуваний файл лише після «Відкрити…» в їхньому меню (WASM не змінювали);
// EasyGreen відкриває його сам, щойно таблиця готова.
const PENDING_BY_MENU = new Set(['easydoc', 'easyslide']);

/** Підказка в смузі вікна редактора про файл з бібліотеки, або null (підказка не потрібна). */
export function pendingFileNotice(appId, pending) {
  if (!pending?.name || !PENDING_BY_MENU.has(appId)) return null;
  return `«${pending.name}» з бібліотеки: натисніть «Відкрити…» у редакторі — файл відкриється без вибору.`;
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
 * закритті, `isDirty()` — чи є незбережені зміни (на додачу до host.setDirty), і `focus()` —
 * повернути фокус у застосунок (після «Залишитися»); повертає true, якщо застосунок його взяв.
 */
export function normalizeMounted(result) {
  const value = result && typeof result === 'object' ? result : {};
  const unmount = [value.unmount, value.destroy].find(fn => typeof fn === 'function');
  const isDirty = typeof value.isDirty === 'function' ? value.isDirty : null;
  const focus = typeof value.focus === 'function' ? value.focus : null;
  return {
    unmount: unmount ? () => unmount.call(value) : () => {},
    isDirty: () => {
      try { return Boolean(isDirty?.call(value)); } catch { return false; }
    },
    focus: () => {
      if (!focus) return false;
      try { focus.call(value); return true; } catch { return false; }
    },
  };
}

/**
 * Редактори «Офісу» (GridCraft, WordCraft, DeckCraft — wgpu у WASM) малюють через WebGL2 або WebGPU.
 * `support` — { webgl2, webgpu } з перевірки сторінки; повертає пояснення українською, якщо
 * жодного немає, інакше '' (без перевірки редактор падає з технічним текстом англійською).
 */
export function graphicsProblem(support) {
  if (support?.webgl2 || support?.webgpu) return '';
  return 'У цьому вікні немає підтримки графіки WebGL2 або WebGPU, потрібної редакторам «Офісу». Оновіть драйвер відеокарти чи системний переглядач вебсторінок або відкрийте EasyWAR на іншому пристрої.';
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

/**
 * Uint8Array з Uint8Array, ArrayBuffer, типізованого масиву або масиву чисел. ArrayBuffer може
 * прийти з іншого кадру: invoke головного вікна повертає байти (library_read_version) у своєму
 * realm, і `instanceof ArrayBuffer` у вкладеному кадрі для них хибне.
 */
export function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer || Object.prototype.toString.call(bytes) === '[object ArrayBuffer]') return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  throw new Error('Очікуються байти файлу (Uint8Array або ArrayBuffer).');
}

/** Формати на картці: «XLSX · CSV». */
export function formatsLabel(appEntry) {
  return appEntry.extensions.map(extension => extension.toUpperCase()).join(' · ');
}

/**
 * Власні монохромні іконки застосунків (контури, колір — currentColor), viewBox 0 0 24 24.
 * Кожна фігура — [тег, атрибути]; оболонка будує SVG через createElementNS.
 */
export const APP_ICONS = Object.freeze({
  easygreen: [['rect', { x: '3', y: '3.5', width: '18', height: '17', rx: '2' }], ['path', { d: 'M3 9.5h18M9 3.5v17M15 9.5v11' }]],
  easydoc: [['path', { d: 'M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Z' }], ['path', { d: 'M14 2.5v4h4M8 11h7M8 14.5h7M8 18h5' }]],
  easyslide: [['rect', { x: '2.5', y: '4', width: '19', height: '14', rx: '2' }], ['path', { d: 'm6.5 14 3-3 2.5 2 4-4M12 18v3m-4 0h8' }]],
  collectives: [['circle', { cx: '8', cy: '8', r: '3' }], ['circle', { cx: '17', cy: '9', r: '2.5' }], ['path', { d: 'M2.5 20v-2a5.5 5.5 0 0 1 11 0v2M13.5 16a4.5 4.5 0 0 1 7.5 3v1' }]],
  weather: [['path', { d: 'M7 17.5h10a3.75 3.75 0 0 0 .55-7.46A5.25 5.25 0 0 0 7.4 9.1 4.2 4.2 0 0 0 7 17.5Z' }], ['path', { d: 'M8.5 21h7' }]],
  'collective-demo': [['circle', { cx: '8', cy: '8', r: '3' }], ['circle', { cx: '16', cy: '8', r: '3' }], ['path', { d: 'M3 20c0-3 2.2-5 5-5s5 2 5 5M11 20c0-3 2.2-5 5-5s5 2 5 5' }]],
  easypay: [['rect', { x: '3', y: '6', width: '18', height: '12', rx: '2' }], ['circle', { cx: '12', cy: '12', r: '2.5' }], ['path', { d: 'M6.5 9.5v.01M17.5 14.5v.01' }]],
});

/** Етапи запуску застосунку на екрані завантаження. */
export const LOADING_STEPS = Object.freeze(['Завантаження…', 'Підготовка…', 'Готово']);

/** Частини назви у верхній смузі: застосунок, файл (без тире) і позначка незбережених змін. */
export function titleParts(appEntry, title, dirty) {
  return { name: appEntry.title, file: String(title ?? '').trim().slice(0, 120), dirty: Boolean(dirty) };
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

/** Прохання оболонки до лаунчера закрити «Робоче середовище» (кнопка «← На стартову»). */
export const CLOSE_MESSAGE = 'easywar-workspace-close';

export function isCloseMessage(data) {
  return Boolean(data) && data.type === CLOSE_MESSAGE;
}
