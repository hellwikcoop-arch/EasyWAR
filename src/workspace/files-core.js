// Сховище файлів «Робочого середовища» (вкладка «Файли»): чиста логіка без DOM і Tauri —
// виклики команд workspace_files_* з точними назвами й ключами контракту, підписи видів
// за розширенням, сортування й пошук за назвою, підсумок «Додати файли…», текст помилки.
// Файли лежать у теці на диску (workspace_files.rs), не в базі й не в бібліотеці.
// Перевірка — tests/workspace-files.test.mjs.
import { formatDateTime, formatSize } from './library-core.js';

export { formatDateTime, formatSize };

/** Виклики команд сховища: назви й ключі — контракт з `src-tauri/src/lib.rs`. */
export function filesApi(invoke) {
  return Object.freeze({
    list: () => invoke('workspace_files_list'),
    add: () => invoke('workspace_files_add'),
    remove: name => invoke('workspace_files_delete', { name }),
    exportCopy: name => invoke('workspace_files_export', { name }),
    open: name => invoke('workspace_files_open', { name }),
  });
}

/** Застосунок за розширенням — як `workspace_files::app_for_ext` у Rust. */
const APP_BY_EXT = new Map([
  ['xlsx', 'easygreen'], ['csv', 'easygreen'], ['docx', 'easydoc'], ['txt', 'easydoc'], ['pptx', 'easyslide'],
  ['easypay', 'easypay'], ['easyfly', 'easyfly'], ['ewcoll', 'collectives'],
]);

const APP_NAMES = new Map([
  ['easygreen', 'EasyGreen'], ['easydoc', 'EasyDoc'], ['easyslide', 'EasySlide'],
  ['easypay', 'easyPay'], ['easyfly', 'EasyFLY'], ['collectives', 'Колективи'],
]);

const KIND_BY_EXT = new Map([
  ['xlsx', 'Таблиця'], ['csv', 'Таблиця'], ['docx', 'Документ'], ['txt', 'Текст'], ['pptx', 'Презентація'],
  ['pdf', 'PDF'], ['png', 'Зображення'], ['jpg', 'Зображення'], ['jpeg', 'Зображення'], ['gif', 'Зображення'],
  ['webp', 'Зображення'], ['svg', 'Зображення'], ['zip', 'Архів'], ['7z', 'Архів'], ['rar', 'Архів'], ['gz', 'Архів'],
  ['kml', 'Карта'], ['kmz', 'Карта'], ['json', 'Дані'], ['xml', 'Дані'], ['md', 'Текст'],
  ['easypay', 'Журнал easyPay'], ['easyfly', 'Файл EasyFLY'], ['ewcoll', 'Колектив'],
]);

const normalizeExt = ext => String(ext ?? '').trim().toLowerCase().replace(/^\.+/, '');

/** Розширення з назви файлу (нижній регістр, без крапки; порожнє, якщо його немає). */
export function extensionOf(name) {
  const text = String(name ?? '');
  const dot = text.lastIndexOf('.');
  if (dot <= 0 || dot === text.length - 1) return '';
  return text.slice(dot + 1).toLowerCase();
}

/** Застосунок «Робочого середовища» для розширення або null. */
export function appForExt(ext) {
  return APP_BY_EXT.get(normalizeExt(ext)) ?? null;
}

/** Назва застосунку для кнопки «Відкрити в …». */
export function appName(app) {
  return APP_NAMES.get(app) ?? null;
}

/** Підпис виду файлу: «Таблиця», «PDF», «Зображення», … або «Файл .ext» / «Файл». */
export function kindLabel(ext) {
  const normalized = normalizeExt(ext);
  const known = KIND_BY_EXT.get(normalized);
  if (known) return known;
  return normalized ? `Файл .${normalized}` : 'Файл';
}

/** Рядок під назвою: вид · розмір · змінено. */
export function metaLine(file, { offsetMinutes } = {}) {
  const parts = [kindLabel(file?.ext), formatSize(file?.size)];
  const changed = formatDateTime(file?.modifiedAt, { offsetMinutes });
  if (changed !== '—') parts.push(`змінено ${changed}`);
  return parts.join(' · ');
}

const collator = new Intl.Collator('uk', { sensitivity: 'base', numeric: true });

/** Файли за назвою без урахування регістру (копія масиву). */
export function sortFiles(files) {
  return [...(Array.isArray(files) ? files : [])].sort((a, b) => collator.compare(a?.name ?? '', b?.name ?? ''));
}

/** Файли, назва яких містить кожне слово запиту (без урахування регістру й апострофів). */
export function filterFiles(files, query) {
  const fold = text => String(text ?? '').toLowerCase().replace(/[’ʼ`]/g, "'");
  const words = fold(query).split(/\s+/).filter(Boolean);
  const list = Array.isArray(files) ? files : [];
  if (!words.length) return [...list];
  return list.filter(file => {
    const name = fold(file?.name);
    return words.every(word => name.includes(word));
  });
}

/** Підсумок «Додати файли…»: `null` — вікно закрили. */
export function addSummary(result) {
  if (!result) return { text: '', tone: '' };
  const added = Array.isArray(result.added) ? result.added : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const parts = [];
  if (added.length === 1) parts.push(`Додано «${added[0].name}».`);
  else if (added.length) parts.push(`Додано файлів: ${added.length}.`);
  if (skipped.length) {
    parts.push(`Пропущено: ${skipped.map(item => `«${item.name}» (${item.reason})`).join('; ')}.`);
  }
  if (!parts.length) return { text: 'Нічого не додано.', tone: '' };
  return { text: parts.join(' '), tone: skipped.length ? 'error' : 'ok' };
}

/** Текст помилки Tauri (рядок або об'єкт) для повідомлення. */
export function errorText(error) {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return String(error ?? 'невідома помилка');
}
