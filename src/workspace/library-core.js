// Бібліотека «Офісу»: чиста логіка інтерфейсу — редактор і вид документа за розширенням,
// підписи видів, походження версій і статусів зв'язку, розміри й дати українською, перевірка
// назви, сортування й пошук за назвою, план «Оновити всі» і підсумок масового оновлення.
// Без DOM і Tauri; дані приходять з команд library_* (контракт IPC, plans/ofis-realizatsiia.md,
// розд. 5 і 7). Перевірка — tests/library-core.test.mjs.
import { formatNumber } from './template-core.js';

/** Початок тексту помилки Rust, коли бібліотеку не розблоковано. */
export const LOCKED_ERROR_PREFIX = 'бібліотека заблокована';
/** Найдовша назва документа (у символах), як у Rust. */
export const MAX_ITEM_NAME_CHARS = 120;

export const KIND_LABELS = Object.freeze({
  table: 'Таблиця',
  document: 'Документ',
  slides: 'Презентація',
  template: 'Шаблон',
});

export const ORIGIN_LABELS = Object.freeze({
  imported: 'Імпортовано',
  generated: 'Згенеровано з шаблону',
  edited: 'Ручні правки',
  saved: 'Збережено',
});

export const STATUS_LABELS = Object.freeze({
  current: 'Актуальний',
  source_changed: 'Джерело змінилося',
  edited: 'Ручні правки',
  edited_stale: 'Ручні правки на застарілих даних',
  detached: 'Поточна версія не з джерела',
  source_error: 'Джерело недоступне',
});

const APP_BY_EXT = new Map([['xlsx', 'easygreen'], ['csv', 'easygreen'], ['docx', 'easydoc'], ['txt', 'easydoc'], ['pptx', 'easyslide']]);
const KIND_BY_EXT = new Map([['xlsx', 'table'], ['csv', 'table'], ['docx', 'document'], ['txt', 'document'], ['pptx', 'slides']]);
const TEMPLATE_EXTS = new Set(['docx', 'pptx', 'xlsx']);

const normalizeExt = ext => String(ext ?? '').trim().toLowerCase().replace(/^\.+/, '');

/** Редактор «Офісу» для розширення: xlsx/csv → easygreen, docx/txt → easydoc, pptx → easyslide. */
export function appForExt(ext) {
  return APP_BY_EXT.get(normalizeExt(ext)) ?? null;
}

/** Вид документа бібліотеки; шаблоном може бути лише DOCX, PPTX чи XLSX. */
export function kindForExt(ext, asTemplate = false) {
  const normalized = normalizeExt(ext);
  if (asTemplate && TEMPLATE_EXTS.has(normalized)) return 'template';
  return KIND_BY_EXT.get(normalized) ?? null;
}

const SIZE_UNITS = ['КБ', 'МБ', 'ГБ', 'ТБ'];

/** Розмір файлу українською: «512 Б», «1,5 КБ», «12 МБ». */
export function formatSize(bytes) {
  const size = Number(bytes);
  if (bytes === null || bytes === undefined || bytes === '' || !Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${Math.round(size)} Б`;
  let value = size / 1024;
  let unit = 0;
  for (;;) {
    const digits = value < 10 ? 1 : 0;
    const rounded = Number(value.toFixed(digits));
    if (rounded < 1024 || unit === SIZE_UNITS.length - 1) return `${formatNumber(rounded, digits)} ${SIZE_UNITS[unit]}`;
    value /= 1024;
    unit += 1;
  }
}

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;
const pad = number => String(number).padStart(2, '0');

/**
 * Час з Rust (ISO 8601, зазвичай UTC з «Z») → «ДД.ММ.РРРР ГГ:ХХ». Результат не залежить від
 * поясу пристрою: без `offsetMinutes` показується час так, як записано в рядку (для «Z» —
 * UTC); з `offsetMinutes` (наприклад, `-new Date().getTimezoneOffset()`, обчислене в UI)
 * момент перераховується в цей зсув. Рядок без поясу не перераховується. Лише дата → «ДД.ММ.РРРР».
 */
export function formatDateTime(iso, { offsetMinutes } = {}) {
  if (iso === null || iso === undefined || iso === '') return '—';
  const match = ISO_DATE_TIME.exec(String(iso).trim());
  if (!match) return '—';
  const [, year, month, day, hour, minute, second = '00', zone] = match;
  if (hour === undefined) return `${day}.${month}.${year}`;
  if (zone === undefined || typeof offsetMinutes !== 'number' || !Number.isFinite(offsetMinutes)) {
    return `${day}.${month}.${year} ${hour}:${minute}`;
  }
  let zoneMinutes = 0;
  if (zone.toUpperCase() !== 'Z') {
    const digits = zone.replace(':', '');
    zoneMinutes = (digits[0] === '-' ? -1 : 1) * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
  }
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - zoneMinutes * 60000;
  const local = new Date(utc + Math.trunc(offsetMinutes) * 60000);
  return `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}.${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** Чи це помилка «бібліотека заблокована…» (рядок з invoke або Error з message). */
export function isLockedError(error) {
  const text = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
  return text.trim().toLowerCase().startsWith(LOCKED_ERROR_PREFIX);
}

// Керівні символи й символи зміни напрямку тексту (ними можна підмінити видиму назву).
const FORBIDDEN_NAME_CHARS = /[\p{Cc}‪-‮⁦-⁩]/u;

/**
 * Назва документа: пробіли по краях прибрано, послідовності пробілів і переносів стиснуто
 * до одного пробілу; 1..120 символів, без керівних. → { ok, name, error }.
 */
export function validateItemName(name) {
  const cleaned = String(name ?? '').replace(/\s+/gu, ' ').trim();
  if (FORBIDDEN_NAME_CHARS.test(cleaned)) return { ok: false, name: cleaned, error: 'Назва містить керівні символи.' };
  const length = Array.from(cleaned).length;
  if (length === 0) return { ok: false, name: cleaned, error: 'Вкажіть назву документа.' };
  if (length > MAX_ITEM_NAME_CHARS) {
    return { ok: false, name: cleaned, error: `Назва задовга: не більше ${MAX_ITEM_NAME_CHARS} символів (зараз ${length}).` };
  }
  return { ok: true, name: cleaned, error: null };
}

const collator = new Intl.Collator('uk', { sensitivity: 'base', numeric: true });

/** Документи за назвою (українська абетка, без різниці регістру, «2» перед «10»); копія масиву. */
export function sortItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort(
    (a, b) => collator.compare(String(a?.name ?? ''), String(b?.name ?? '')) || String(a?.id ?? '').localeCompare(String(b?.id ?? '')),
  );
}

const searchText = text =>
  String(text ?? '').normalize('NFC').toLocaleLowerCase('uk').replace(/[’ʼ‘`´]/g, "'").replace(/\s+/g, ' ').trim();

/** Документи, у назві яких є всі слова запиту (без різниці регістру й виду апострофа). */
export function filterItems(items, query) {
  const list = Array.isArray(items) ? items : [];
  const terms = searchText(query).split(' ').filter(Boolean);
  if (!terms.length) return [...list];
  return list.filter(item => {
    const name = searchText(item?.name);
    return terms.every(term => name.includes(term));
  });
}

const SKIPPED_STATUSES = new Set(['edited', 'edited_stale', 'source_error', 'detached']);

/**
 * План «Оновити всі»: статуси library_link_statuses для документів зі списку →
 * { update: [id «Джерело змінилося»], skipped: [{ id, reason }] (ручні правки, джерело
 * недоступне, поточна версія не з джерела; reason — код статусу), upToDate: [id «Актуальний»] }.
 */
export function regenerationPlan(items, statuses) {
  const byId = new Map((Array.isArray(statuses) ? statuses : []).filter(entry => entry && entry.itemId).map(entry => [entry.itemId, entry.status]));
  const plan = { update: [], skipped: [], upToDate: [] };
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !byId.has(item.id)) continue;
    const status = byId.get(item.id);
    if (status === 'source_changed') plan.update.push(item.id);
    else if (status === 'current') plan.upToDate.push(item.id);
    else plan.skipped.push({ id: item.id, reason: SKIPPED_STATUSES.has(status) ? status : String(status) });
  }
  return plan;
}

/**
 * Чи робити нову згенеровану версію поточною без питання: так, коли поточна — теж згенерована
 * (або версії ще немає); ні, коли поточна має ручні правки чи збережена з редактора вручну.
 */
export function shouldMakeCurrent(currentOrigin) {
  return currentOrigin === 'generated' || currentOrigin === null || currentOrigin === undefined;
}

const countOf = value => (Array.isArray(value) ? value.length : Number.isFinite(value) ? value : 0);

/**
 * Підсумок масового оновлення: «Оновлено: N; пропущено: M; помилки: K». `results` — масив
 * { outcome: 'updated'|'skipped'|'error' } або { updated, skipped, errors } (масиви чи числа).
 */
export function summarizeBulk(results) {
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  if (Array.isArray(results)) {
    for (const result of results) {
      if (result?.outcome === 'updated') updated += 1;
      else if (result?.outcome === 'skipped') skipped += 1;
      else if (result?.outcome === 'error') errors += 1;
    }
  } else if (results && typeof results === 'object') {
    updated = countOf(results.updated);
    skipped = countOf(results.skipped);
    errors = countOf(results.errors);
  }
  return `Оновлено: ${updated}; пропущено: ${skipped}; помилки: ${errors}`;
}
