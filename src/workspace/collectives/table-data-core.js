// Дані таблиці колективу: стан із пакетів змін, «було → стане» і операція доповіді.
//
// Чисте ядро без DOM, IPC і годинника. Пакети змін перевіряє й віддає Rust
// (`collective_table_read`); тут вони лише застосовуються по черзі. Формат операції —
// той самий, що перевіряє Rust (`parse_change`): `{"v":1,"rows":[{"key","kind","values"}]}`,
// `upsert` несе весь рядок і замінює його, `delete` прибирає рядок.

export const MAX_TABLE_COLUMNS = 32;
export const MAX_COLUMN_CHARS = 40;
export const MAX_ROWS_PER_CHANGE = 500;
export const MAX_CELL_CHARS = 1000;
export const MAX_OPERATION_BYTES = 64 * 1024;

const encoder = new TextEncoder();
// Керівні знаки, крім переносу рядка й табуляції (у клітинках їх дозволено).
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const COLUMN_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/** Стовпці з тексту «через кому або з нового рядка»: обрізані, без порожніх. */
export function parseColumns(text) {
  const columns = String(text ?? '').split(/[,\n;]/u).map(part => part.trim()).filter(Boolean);
  checkColumns(columns);
  return columns;
}

/** Та сама перевірка стовпців, що й у Rust. */
export function checkColumns(columns) {
  if (!Array.isArray(columns) || columns.length > MAX_TABLE_COLUMNS) {
    throw new Error(`Стовпців — не більше ${MAX_TABLE_COLUMNS}.`);
  }
  const seen = new Set();
  for (const column of columns) {
    const name = String(column);
    if (!name.trim() || [...name].length > MAX_COLUMN_CHARS || COLUMN_CONTROL.test(name)) {
      throw new Error(`Назва стовпця: від 1 до ${MAX_COLUMN_CHARS} символів без керівних знаків.`);
    }
    if (seen.has(name)) throw new Error(`Стовпець «${name}» повторюється.`);
    seen.add(name);
  }
}

/**
 * Стан таблиці після всіх пакетів (у порядку, у якому їх віддав Rust). Для кожного рядка
 * пам'ятається, хто й коли змінив його останнім.
 */
export function buildTable(data) {
  const columns = Array.isArray(data?.columns) ? data.columns.map(String) : [];
  const rows = new Map();
  for (const change of Array.isArray(data?.changes) ? data.changes : []) {
    const by = { author: change.author, authorName: change.authorName ?? null, mine: Boolean(change.mine), clientTime: change.clientTime };
    for (const row of Array.isArray(change.rows) ? change.rows : []) {
      const key = String(row.key);
      if (row.kind === 'delete') { rows.delete(key); continue; }
      const values = {};
      for (const column of columns) values[column] = String(row.values?.[column] ?? '');
      rows.set(key, { key, values, by });
    }
  }
  return { columns, rows: [...rows.values()], packages: Array.isArray(data?.changes) ? data.changes.length : 0 };
}

/** Порожні значення для всіх стовпців. */
export function emptyValues(columns) {
  return Object.fromEntries(columns.map(column => [column, '']));
}

/** Ключ нового рядка: `r-` і 16 шістнадцяткових знаків із переданих випадкових байтів. */
export function newRowKey(randomBytes, taken = new Set()) {
  const bytes = randomBytes(8);
  const key = `r-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
  if (taken.has(key)) throw new Error('Не вдалося створити ключ рядка: спробуйте ще раз.');
  return key;
}

const same = (a, b, columns) => columns.every(column => String(a?.[column] ?? '') === String(b?.[column] ?? ''));
const blank = (values, columns) => columns.every(column => !String(values?.[column] ?? '').trim());

/**
 * «Було → стане»: що відрізняє відредаговані рядки від стану таблиці. Нові порожні рядки
 * пропускаються; у пакет іде весь рядок, змінені клітинки — лише для підсвічування.
 */
export function diffTable(base, edited, columns) {
  const before = new Map((base ?? []).map(row => [row.key, row.values]));
  const after = new Map((edited ?? []).map(row => [row.key, row.values]));
  const preview = [];
  for (const [key, values] of after) {
    const was = before.get(key);
    if (!was) {
      if (blank(values, columns)) continue;
      preview.push({ key, kind: 'new', before: null, after: { ...values }, changed: columns.filter(c => String(values[c] ?? '').trim()) });
    } else if (!same(was, values, columns)) {
      preview.push({ key, kind: 'changed', before: { ...was }, after: { ...values }, changed: columns.filter(c => String(was[c] ?? '') !== String(values[c] ?? '')) });
    }
  }
  for (const [key, values] of before) {
    if (!after.has(key)) preview.push({ key, kind: 'deleted', before: { ...values }, after: null, changed: [] });
  }
  return preview;
}

/** Операція доповіді з перегляду; ті самі межі, що й у Rust. */
export function changeOperation(preview, columns) {
  if (!preview.length) throw new Error('Змін немає: змініть клітинки, додайте або видаліть рядок.');
  if (preview.length > MAX_ROWS_PER_CHANGE) throw new Error(`В одній доповіді — не більше ${MAX_ROWS_PER_CHANGE} рядків.`);
  const rows = preview.map(item => {
    if (item.kind === 'deleted') return { key: item.key, kind: 'delete' };
    const values = {};
    for (const column of columns) {
      const value = String(item.after[column] ?? '');
      if ([...value].length > MAX_CELL_CHARS || CONTROL.test(value)) {
        throw new Error(`Клітинка «${column}»: до ${MAX_CELL_CHARS} символів без керівних знаків.`);
      }
      if (value !== '') values[column] = value;
    }
    return { key: item.key, kind: 'upsert', values };
  });
  const text = JSON.stringify({ v: 1, rows });
  if (encoder.encode(text).length > MAX_OPERATION_BYTES) throw new Error('Доповідь більша за 64 КіБ: розбийте зміни на кілька доповідей.');
  return text;
}

/** Короткий підсумок перегляду для людини. */
export function previewSummary(preview) {
  const count = kind => preview.filter(item => item.kind === kind).length;
  const parts = [];
  if (count('new')) parts.push(`нових рядків: ${count('new')}`);
  if (count('changed')) parts.push(`змінених: ${count('changed')}`);
  if (count('deleted')) parts.push(`видалених: ${count('deleted')}`);
  return parts.length ? parts.join(', ') : 'змін немає';
}

/** Хто змінив: ім'я (як учасник назвався сам) і відбиток; «ви» — для своїх змін. */
export function authorLine(by) {
  if (!by) return '';
  if (by.mine) return 'ви';
  return by.authorName ? `${by.authorName} (${by.author})` : `учасник ${by.author}`;
}

/** Час автора пакета (за його годинником) як «ДД.ММ.РРРР ГГ:ХХ» UTC. */
export function changeTime(clientTime) {
  const date = new Date(Number(clientTime) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/**
 * Відповідь «Оновити таблицю»: скільки пакетів підвантажено, скільки нових з минулого
 * оновлення і скільки відхилено перевіркою.
 */
export function refreshText(data, seenBefore) {
  const total = Array.isArray(data?.changes) ? data.changes.length : 0;
  const fresh = seenBefore == null ? total : Math.max(0, total - seenBefore);
  const parts = [`Пакетів змін: ${total}`];
  parts.push(seenBefore == null ? 'таблицю завантажено' : (fresh ? `нових з минулого оновлення: ${fresh}` : 'нових немає'));
  if (data?.rejected) parts.push(`не пройшли перевірку й не застосовані: ${data.rejected}`);
  return `${parts.join(', ')}.`;
}
