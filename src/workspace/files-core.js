// Сховище файлів «Робочого середовища» (вкладка «Файли»): чиста логіка без DOM і Tauri —
// виклики команд workspace_files_* з точними назвами й ключами контракту, екран за станом
// бібліотеки (сховище зашифроване її ключем), підписи видів за розширенням, сортування й
// пошук за назвою, підсумок «Додати файли…», текст помилки. Файли лежать зашифрованими
// блобами в теці на диску (workspace_files.rs), не в базі. Перевірка — tests/workspace-files.test.mjs.
import { formatDateTime, formatSize, isLockedError } from './library-core.js';

export { formatDateTime, formatSize, isLockedError };

/**
 * Екран вкладки за статусом бібліотеки (library_status): сховище відкривається лише з
 * розблокованою бібліотекою. → { screen, text } ; screen 'unlocked' — показувати список.
 */
export function storeScreen(status) {
  switch (status?.state) {
    case 'unlocked':
      return { screen: 'unlocked', text: '' };
    case 'locked':
      return { screen: 'locked', text: 'Сховище зашифроване ключем бібліотеки профілю. Розблокуйте бібліотеку паролем профілю на вкладці «Бібліотека» — і файли з’являться тут.' };
    case 'none':
      return { screen: 'none', text: 'Сховище зашифроване ключем бібліотеки профілю, а бібліотеку для цього профілю ще не створено. Створіть її на вкладці «Бібліотека» (потрібен пароль профілю).' };
    case 'no_password':
      return { screen: 'no_password', text: 'Сховище доступне лише профілю з паролем: ним шифруються файли. Задайте пароль профілю у вікні «Профілі».' };
    case 'no_profile':
      return { screen: 'no_profile', text: 'Увійдіть у профіль: сховище файлів належить профілю.' };
    default:
      return { screen: 'unknown', text: 'Не вдалося прочитати стан бібліотеки. Закрийте «Робоче середовище» й відкрийте його знову.' };
  }
}

/** Виклики команд сховища: назви й ключі — контракт з `src-tauri/src/lib.rs`. */
export function filesApi(invoke) {
  return Object.freeze({
    status: () => invoke('library_status'),
    list: () => invoke('workspace_files_list'),
    add: () => invoke('workspace_files_add'),
    remove: id => invoke('workspace_files_delete', { id }),
    exportCopy: id => invoke('workspace_files_export', { id }),
    open: id => invoke('workspace_files_open', { id }),
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

/** Рядок під назвою: вид · розмір · змінено (для пошкодженого блоба — «Пошкоджено»). */
export function metaLine(file, { offsetMinutes } = {}) {
  const parts = [file?.damaged ? 'Пошкоджено: не розшифровується цим ключем' : kindLabel(file?.ext), formatSize(file?.size)];
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
