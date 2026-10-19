// EasyGreen — чиста логіка обміну з вбудованою таблицею (веб-збірка GridCraft у src/public/workspace/easygreen/app/).
// Таблиця працює в iframe того самого походження; файли передаються лише повідомленнями postMessage
// (протокол `?host=parent` GridCraft): gridcraft:ready / gridcraft:open / gridcraft:save /
// gridcraft:dirty / gridcraft:failed. Без DOM і сховищ — тестується окремо (tests/easygreen-core.test.mjs).

export const EASYGREEN_TITLE = 'EasyGreen';
// Параметри сторінки таблиці: режим iframe з батьківською сторінкою й український інтерфейс.
export const EASYGREEN_APP_QUERY = '?host=parent&lang=uk';
export const MAX_OPEN_BYTES = 256 * 1024 * 1024;
export const OPEN_EXTENSIONS = ['xlsx', 'xlsm', 'xls', 'xlsb', 'ods', 'csv', 'tsv', 'txt'];
export const OPEN_ACCEPT = OPEN_EXTENSIONS.map(ext => `.${ext}`).join(',');

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

/** Текст стану після збереження: шлях (збережено), null (скасовано) або помилка. */
export function saveStatus(result, error) {
  if (error) return `Не збережено: ${String(error?.message ?? error)}`;
  if (result == null) return 'Збереження скасовано.';
  return `Збережено: ${result}`;
}

/** Чи треба питати перед закриттям: є незбережені зміни. */
export function closeNeedsConfirm(dirty) {
  return dirty === true;
}
