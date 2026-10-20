// EasyGreen — чиста логіка обміну з вбудованою таблицею (веб-збірка GridCraft у src/public/workspace/easygreen/app/).
// Таблиця працює в iframe того самого походження; файли передаються лише повідомленнями postMessage
// (протокол `?host=parent` GridCraft): gridcraft:ready / gridcraft:open / gridcraft:save /
// gridcraft:dirty / gridcraft:failed. Файли відкриває й зберігає оболонка «Робочого середовища» (host.openFile,
// host.saveFile, host.saveFileAs — docs/WORKSPACE.md). Документ з бібліотеки EasyWAR (host.pendingFile) відкривається
// сам, щойно таблиця готова. Без DOM і сховищ — тестується окремо (tests/easygreen-core.test.mjs).

export const EASYGREEN_TITLE = 'EasyGreen';
// Параметри сторінки таблиці: режим iframe з батьківською сторінкою й український інтерфейс.
export const EASYGREEN_APP_QUERY = '?host=parent&lang=uk';
export const MAX_OPEN_BYTES = 256 * 1024 * 1024;
export const OPEN_EXTENSIONS = ['xlsx', 'xlsm', 'xls', 'xlsb', 'ods', 'csv', 'tsv', 'txt'];
export const OPEN_TITLE = 'EasyGreen — відкрити таблицю';
// Що таблиця передає на збереження: книга (Зберегти, Зберегти як) і експорт.
export const SAVE_EXTENSIONS = ['xlsx', 'pdf', 'csv', 'html'];
// Лише книгу .xlsx можна записати назад у відкритий файл; експорт завжди йде через «Зберегти як…».
const WORKBOOK_EXTENSION = 'xlsx';

const MAX_NAME_CHARS = 180;

export function fileExtension(name) {
  const match = /\.([^./\\]+)$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

/** Чи може EasyGreen відкрити файл з такою назвою і розміром; повертає текст помилки або ''. */
export function openProblem(name, size) {
  if (!OPEN_EXTENSIONS.includes(fileExtension(name))) {
    return 'EasyGreen відкриває таблиці .xlsx, .xlsm, .xls, .xlsb, .ods, .csv, .tsv і .txt.';
  }
  if (!Number.isFinite(size) || size <= 0) return 'Файл порожній.';
  if (size > MAX_OPEN_BYTES) return 'Файл завеликий: EasyGreen відкриває таблиці до 256 МБ.';
  return '';
}

/** Назва файлу без теки й керівних символів. */
export function cleanFileName(name, fallback = 'Книга.xlsx') {
  const base = String(name ?? '').split(/[\\/]/).pop();
  const cleaned = Array.from(base).filter(ch => ch >= ' ' && ch !== '\u007f').slice(0, MAX_NAME_CHARS).join('').trim();
  return cleaned || fallback;
}

/**
 * Повідомлення від таблиці → { type, … } або null, якщо воно не з протоколу.
 * `bytes` у gridcraft:save має бути ArrayBuffer (GridCraft передає його через transfer).
 */
export function parseFrameMessage(data) {
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return null;
  switch (data.type) {
    case 'gridcraft:ready':
      return { type: 'ready', version: typeof data.version === 'string' ? data.version : '' };
    case 'gridcraft:save': {
      if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength === 0) return null;
      return { type: 'save', name: cleanFileName(data.name), bytes: data.bytes };
    }
    case 'gridcraft:dirty':
      return { type: 'dirty', dirty: data.dirty === true };
    case 'gridcraft:failed':
      return { type: 'failed', error: typeof data.error === 'string' ? data.error.slice(0, 500) : '' };
    default:
      return null;
  }
}

/** Повідомлення, яке відкриває файл у таблиці. */
export function openMessage(name, bytes) {
  return { type: 'gridcraft:open', name: cleanFileName(name), bytes };
}

/** Чи відкрити файл одразу після gridcraft:ready: у вікні редактора чекає документ з бібліотеки. */
export function shouldAutoOpen(host) {
  return Boolean(host?.pendingFile?.name);
}

/**
 * Відкриває таблицю через host (вікно вибору або документ з бібліотеки, який office_open_file
 * віддає першим) і передає її в таблицю: `post(message, transfer)` повертає false, якщо таблицю
 * вже закрито. Результат: { status: 'opened', handle, name } | { status: 'cancelled' } |
 * { status: 'problem', text } (файл не для EasyGreen; номер файлу закрито).
 */
export async function openIntoFrame(host, post) {
  const opened = await host.openFile({ extensions: OPEN_EXTENSIONS, title: OPEN_TITLE });
  if (!opened) return { status: 'cancelled' };
  const problem = openProblem(opened.name, opened.bytes.byteLength);
  if (problem) {
    host.closeFile(opened.handle).catch(() => {});
    return { status: 'problem', text: problem };
  }
  const bytes = opened.bytes.slice().buffer;
  if (post(openMessage(opened.name, bytes), [bytes]) === false) {
    host.closeFile(opened.handle).catch(() => {});
    return { status: 'cancelled' };
  }
  return { status: 'opened', handle: opened.handle, name: opened.name };
}

/**
 * Куди зберегти файл, який передала таблиця. `current` — { handle, name } файлу, відкритого чи
 * збереженого через EasyWAR, або null. Повертає { kind: 'save', handle } — записати в той самий файл
 * (лише книга .xlsx з тією самою назвою), { kind: 'saveAs', extensions, suggestedName } — вікно
 * «Зберегти як…», або null — такий тип EasyGreen не зберігає.
 */
export function saveAction(name, current) {
  const extension = fileExtension(name) === 'htm' ? 'html' : fileExtension(name);
  if (!SAVE_EXTENSIONS.includes(extension)) return null;
  if (extension === WORKBOOK_EXTENSION && current?.handle && cleanFileName(current.name) === cleanFileName(name)) {
    return { kind: 'save', handle: current.handle };
  }
  return { kind: 'saveAs', extensions: [extension], suggestedName: cleanFileName(name) };
}

/** Чи стає збережений файл поточним (наступне «Зберегти» піде в нього): лише книга .xlsx. */
export function keepsWorkbook(name) {
  return fileExtension(name) === WORKBOOK_EXTENSION;
}

/** Текст стану після збереження: назва файлу (збережено), null (скасовано) або помилка. */
export function saveStatus(name, error) {
  if (error) return `Не збережено: ${String(error?.message ?? error)}`;
  if (name == null) return 'Збереження скасовано.';
  return `Збережено: ${name}`;
}
