// Повторний імпорт відомої таблиці з переглядом змін — етап E3в (docs/MODULES_ROADMAP.md, розділ 4,
// «Відома таблиця й оновлення»). Чисте ядро без DOM, Tauri, годинника й мережі.
//
// Правила (рішення власника, Q9):
//   - файл упізнається за заголовками стовпців, не за вмістом; відбиток не містить значень рядків;
//   - рядок упізнається за правилом ідентичності (ключові стовпці), які вибирає користувач;
//     `row_id` таблиці модуля не ключ, а відповідність за порядком рядків ніколи не обирається;
//   - перед застосуванням показано: додані, змінені, зниклі й неоднозначні рядки; немає ключа або є
//     конфлікт — рішення за користувачем;
//   - ручні виправлення значень лишаються, навіть якщо нова версія файла має інше значення;
//   - вихідний файл не переписується: ядро лише порівнює й збирає нові рядки модуля.

import { normalizeHeader } from './dashboard-module-source-core.js';

export const UPDATE_LIMITS = Object.freeze({
  maxRows: 50000,
  maxKeyColumns: 3,
  maxPreview: 200,
  minMatch: 0.8,
});

const SEP = '\u001f';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => ({ ok: false, code, message });

/** Значення для порівняння: порожнє однаково для null, undefined і пробілів; число — як число. */
export function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Ключ рядка за ключовими стовпцями; `null`, якщо хоча б одна частина порожня. */
export function rowKey(row, keyColumns) {
  if (!isRecord(row) || !Array.isArray(keyColumns) || !keyColumns.length) return null;
  const parts = keyColumns.map(key => normalizeValue(row[key]).toLowerCase());
  return parts.some(part => part === '') ? null : parts.join(SEP);
}

// FNV-1a 32 біти двічі з різним зсувом: достатньо для відбитка заголовків, без криптографії.
function hash(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

const headerList = headers => (Array.isArray(headers) ? headers : [])
  .map(header => normalizeHeader(header))
  .filter(Boolean);

/** Відбиток структури файла: порядок стовпців не важливий, значень рядків у ньому немає. */
export function fileFingerprint(headers) {
  const list = [...new Set(headerList(headers))].sort();
  return list.length ? `fp1:${hash(list.join(SEP))}` : '';
}

/**
 * Упізнавання відомої таблиці за заголовками файла. `sources` — джерела схеми профілю (`columns[].header`).
 * Повертає кандидатів від найкращого: `exact` (однаковий набір заголовків) або `partial` (збіг не менший
 * за `UPDATE_LIMITS.minMatch` від більшого з наборів). Нічого не обирає за користувача.
 */
export function recognizeSource(sources, headers) {
  const file = new Set(headerList(headers));
  if (!file.size) return [];
  const fingerprint = fileFingerprint(headers);
  const out = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const known = new Set(headerList((source?.columns || []).map(column => column?.header)));
    if (!known.size) continue;
    let shared = 0;
    for (const header of file) if (known.has(header)) shared += 1;
    const score = shared / Math.max(file.size, known.size);
    if (score < UPDATE_LIMITS.minMatch) continue;
    out.push({
      sourceId: source.id,
      score,
      kind: fingerprint && fingerprint === fileFingerprint((source.columns || []).map(column => column.header)) ? 'exact' : 'partial',
    });
  }
  return out.sort((x, y) => y.score - x.score || String(x.sourceId).localeCompare(String(y.sourceId)));
}

function keyStats(rows, keyColumns) {
  const seen = new Map();
  let unkeyed = 0;
  for (const row of rows) {
    const key = rowKey(row, keyColumns);
    if (key === null) unkeyed += 1;
    else seen.set(key, (seen.get(key) || 0) + 1);
  }
  let duplicated = 0;
  for (const count of seen.values()) if (count > 1) duplicated += 1;
  return { unkeyed, duplicated, distinct: seen.size };
}

/**
 * Підказка ключа: найменший набір із 1–3 стовпців, у якому всі рядки обох версій мають значення і
 * жоден ключ не повторюється. Лише пропозиція: рішення за користувачем. Порожній список — ключа немає.
 */
export function suggestKeyColumns(fields, oldRows, newRows) {
  const keys = (Array.isArray(fields) ? fields : [])
    .map(field => field?.key)
    .filter(key => typeof key === 'string' && key !== 'id');
  const rows = [...(Array.isArray(oldRows) ? oldRows : []), ...(Array.isArray(newRows) ? newRows : [])];
  if (!rows.length || rows.length > UPDATE_LIMITS.maxRows * 2) return [];
  const candidates = [];
  const tryColumns = columns => {
    // Повторювані ключі шукаємо в кожній версії окремо: один і той самий ключ у двох версіях — норма.
    const stats = [oldRows, newRows].map(list => keyStats(Array.isArray(list) ? list : [], columns));
    if (stats.every(s => s.unkeyed === 0 && s.duplicated === 0)) candidates.push({ columns, unique: true });
  };
  for (const key of keys) tryColumns([key]);
  if (!candidates.length && UPDATE_LIMITS.maxKeyColumns >= 2) {
    for (let i = 0; i < keys.length && candidates.length < 5; i += 1) {
      for (let j = i + 1; j < keys.length && candidates.length < 5; j += 1) tryColumns([keys[i], keys[j]]);
    }
  }
  return candidates;
}

const sameValue = (a, b) => normalizeValue(a) === normalizeValue(b);

/** Ідентифікатор клітинки для множини ручних виправлень: ключ рядка + ключ поля. */
export const correctionCell = (key, fieldKey) => `${key}${SEP}${fieldKey}`;

/**
 * Порівняння двох версій таблиці модуля.
 * `fields` — поля модуля; `oldRows` — рядки модуля зараз; `newRows` — рядки з нового файла (вже у ключах
 * полів модуля); `keyColumns` — правило ідентичності; `correctedCells` — множина `correctionCell(...)`
 * для клітинок, виправлених вручну.
 * Порівнюються лише поля, які є в новому файлі (відсутній стовпець не робить значення «зниклим»).
 */
export function diffRows({ fields, oldRows, newRows, keyColumns, correctedCells = new Set() }) {
  if (!Array.isArray(oldRows) || !Array.isArray(newRows)) return fail('bad_input', 'Очікуються списки рядків.');
  if (oldRows.length > UPDATE_LIMITS.maxRows || newRows.length > UPDATE_LIMITS.maxRows) {
    return fail('too_many_rows', 'Забагато рядків для порівняння.');
  }
  const fieldKeys = (Array.isArray(fields) ? fields : []).map(field => field?.key).filter(key => typeof key === 'string' && key !== 'id');
  if (!Array.isArray(keyColumns) || !keyColumns.length) return fail('no_key', 'Не вибрано стовпці, за якими рядок упізнається.');
  if (keyColumns.length > UPDATE_LIMITS.maxKeyColumns || keyColumns.some(key => !fieldKeys.includes(key))) {
    return fail('bad_key', 'Ключові стовпці мають бути полями модуля (до трьох).');
  }
  const compared = fieldKeys.filter(key => newRows.some(row => isRecord(row) && Object.hasOwn(row, key)));
  if (!keyColumns.every(key => compared.includes(key))) return fail('key_missing', 'У новому файлі немає ключового стовпця.');

  const index = rows => {
    const map = new Map();
    const unkeyed = [];
    for (const row of rows) {
      const key = rowKey(row, keyColumns);
      if (key === null) unkeyed.push(row);
      else if (map.has(key)) map.get(key).push(row);
      else map.set(key, [row]);
    }
    return { map, unkeyed };
  };
  const before = index(oldRows);
  const after = index(newRows);

  const added = [];
  const changed = [];
  const removed = [];
  const ambiguous = [];
  let unchanged = 0;

  for (const [key, list] of after.map) {
    const was = before.map.get(key);
    if (list.length > 1 || (was && was.length > 1)) {
      ambiguous.push({ key, side: list.length > 1 && was && was.length > 1 ? 'both' : list.length > 1 ? 'new' : 'old', oldRows: was || [], newRows: list });
      continue;
    }
    if (!was) { added.push({ key, row: list[0] }); continue; }
    const changes = [];
    for (const field of compared) {
      if (!sameValue(was[0][field], list[0][field])) {
        changes.push({ field, from: was[0][field] ?? null, to: list[0][field] ?? null, corrected: correctedCells.has(correctionCell(key, field)) });
      }
    }
    if (changes.length) changed.push({ key, oldRow: was[0], newRow: list[0], changes });
    else unchanged += 1;
  }
  for (const [key, list] of before.map) {
    if (after.map.has(key)) continue;
    if (list.length > 1) ambiguous.push({ key, side: 'old', oldRows: list, newRows: [] });
    else removed.push({ key, row: list[0] });
  }

  return {
    ok: true,
    keyColumns: [...keyColumns],
    compared,
    counts: {
      added: added.length,
      changed: changed.length,
      removed: removed.length,
      ambiguous: ambiguous.length,
      unchanged,
      unkeyedOld: before.unkeyed.length,
      unkeyedNew: after.unkeyed.length,
    },
    added,
    changed,
    removed,
    ambiguous,
    unkeyedOld: before.unkeyed,
    unkeyedNew: after.unkeyed,
    // Зміни, що торкаються ручно виправлених клітинок: у результаті лишається виправлене значення.
    keptCorrections: changed.reduce((sum, item) => sum + item.changes.filter(change => change.corrected).length, 0),
  };
}

/** Короткий зріз для екрана: списки обрізані до `maxPreview`, лічильники — повні. */
export function previewDiff(diff, limit = UPDATE_LIMITS.maxPreview) {
  if (!diff?.ok) return diff;
  const cut = list => list.slice(0, limit);
  return {
    ok: true,
    keyColumns: diff.keyColumns,
    counts: diff.counts,
    keptCorrections: diff.keptCorrections,
    added: cut(diff.added),
    changed: cut(diff.changed),
    removed: cut(diff.removed),
    ambiguous: cut(diff.ambiguous),
    truncated: ['added', 'changed', 'removed', 'ambiguous'].some(name => diff[name].length > limit),
  };
}

/**
 * Нові рядки модуля після підтвердження. Порядок: рядки, що були, у своєму порядку (змінені — з
 * новими значеннями, крім виправлених вручну), далі додані. `removed`: 'keep' (за замовчуванням,
 * нічого не видаляє) або 'remove'. Неоднозначні й рядки без ключа лишаються як були; їх немає в
 * новій версії, доки користувач не розв'яже конфлікт окремо.
 */
export function applyDiff(oldRows, diff, { removed = 'keep' } = {}) {
  if (!diff?.ok) return fail('bad_diff', 'Порівняння не виконано.');
  if (removed !== 'keep' && removed !== 'remove') return fail('bad_policy', 'Невідоме правило для зниклих рядків.');
  const changedByKey = new Map(diff.changed.map(item => [item.key, item]));
  const removedKeys = removed === 'remove' ? new Set(diff.removed.map(item => item.key)) : new Set();
  const out = [];
  for (const row of oldRows) {
    const key = rowKey(row, diff.keyColumns);
    if (key !== null && removedKeys.has(key)) continue;
    const change = key === null ? null : changedByKey.get(key);
    if (!change) { out.push(row); continue; }
    const next = { ...row };
    for (const item of change.changes) if (!item.corrected) next[item.field] = item.to;
    out.push(next);
  }
  for (const item of diff.added) out.push(item.row);
  return { ok: true, rows: out };
}
