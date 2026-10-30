// Оновлення знімка об'єднаної таблиці (E3б, B5): таблиця, створена з підтвердженого зв'язку («Створити таблицю в
// профілі»), — це знімок на момент створення. Тут чиста логіка без DOM, сховищ і мережі: що змінилося б, якщо
// побудувати об'єднання знову з поточних вихідних таблиць, і запит на заміну рядків. Нічого не записує: запис —
// `replace_dashboard_module_rows` у викликача після підтвердження людини. Вихідні таблиці лише читаються.

import { moduleSourceId } from './profile-schema-modules-core.js';
import { relationsOf, snapshotOf } from './profile-schema-core.js';
import { mergeModuleView } from './table-link-view-core.js';

const rowsWord = n => (n % 10 === 1 && n % 100 !== 11 ? 'рядок' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'рядки' : 'рядків');
const count = n => `${n} ${rowsWord(n)}`;

const cellMark = value => (value === undefined || value === null || value === '' ? null : value);

/** Підпис рядка за значеннями полів у порядку стовпців: однакові рядки мають однаковий підпис, службові ключі не рахуються. */
function signature(keys, row) {
  return JSON.stringify(keys.map(key => cellMark(row?.[key])));
}

/** Скільки рядків додано, зникло й лишилось незмінними (рядки порівнюються як набір: однакові — парами). */
export function countChanges(keys, oldRows, newRows) {
  const left = new Map();
  for (const row of oldRows) {
    const mark = signature(keys, row);
    left.set(mark, (left.get(mark) || 0) + 1);
  }
  let same = 0;
  for (const row of newRows) {
    const mark = signature(keys, row);
    const rest = left.get(mark) || 0;
    if (rest > 0) { left.set(mark, rest - 1); same += 1; }
  }
  return { added: newRows.length - same, removed: oldRows.length - same, same };
}

/** Зв'язок, з якого утворено таблицю, і його назви для людини. `null`, якщо таблиця не є знімком. */
export function snapshotInfo(schema, module, titles = new Map()) {
  const entry = snapshotOf(schema, moduleSourceId(module?.id));
  if (!entry) return null;
  const relation = relationsOf(schema).find(item => item.id === entry.relationId && item.status === 'confirmed') || null;
  const name = side => titles.get(side?.sourceId) || side?.sourceId || '';
  return {
    entry,
    relation,
    builtAt: entry.builtAt,
    rowCount: entry.rowCount,
    sourceIds: relation ? [relation.left.sourceId, relation.right.sourceId] : [],
    text: relation ? `${name(relation.left)} ↔ ${name(relation.right)}` : 'зв’язок знято або замінено',
  };
}

/**
 * Що дасть оновлення таблиці-знімка з поточних вихідних. `modules`/`data` — стан дашборда з СВІЖО прочитаними вихідними
 * таблицями; `payload` — поточні рядки й виправлення самого знімка. Відмовляє, якщо вихідні змінилися так, що стовпці
 * знімка вже не збігаються (інакше нові значення лягли б не в ті стовпці), і не змішує неповно прочитане.
 * `{ ok: true, request: { moduleId, rows }, rowCount, before, added, removed, same, manual }` або `{ ok: false, message }`.
 */
export function refreshView(schema, module, modules, data, payload) {
  const sourceId = moduleSourceId(module?.id);
  const entry = snapshotOf(schema, sourceId);
  if (!entry) return { ok: false, message: 'Ця таблиця не створена з об’єднання.' };
  const relation = relationsOf(schema).find(item => item.id === entry.relationId && item.status === 'confirmed');
  if (!relation) return { ok: false, message: 'Зв’язок, з якого створено таблицю, знято або замінено. Оновлення неможливе: створіть таблицю знову з нового зв’язку.' };
  if (relation.left.sourceId === sourceId || relation.right.sourceId === sourceId) return { ok: false, message: 'Таблиця сама є стороною свого зв’язку: оновлення неможливе.' };
  const made = mergeModuleView(schema, relation.id, modules, data);
  if (!made.ok) return made;
  const fields = Array.isArray(module.fields) ? module.fields : [];
  const wanted = made.request.customFields;
  const same = fields.length === wanted.length
    && fields.every((field, index) => field.label === wanted[index].label && field.dataType === wanted[index].dataType);
  if (!same) {
    return { ok: false, code: 'columns_changed', message: 'Склад або тип стовпців у вихідних таблицях змінився з часу створення. Оновити цю таблицю не можна: створіть її знову з зв’язку, а стару за потреби видаліть.' };
  }
  const keys = fields.map(field => field.key);
  const oldRows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (payload?.failed === true || payload?.truncated === true) return { ok: false, message: 'Таблицю-знімок прочитано не повністю: оновлення неможливе.' };
  if (!keys.every((key, index) => key === `c${index + 1}`)) return { ok: false, message: 'Ключі стовпців таблиці не збігаються з побудованими: оновлення неможливе.' };
  // Рядки без `rowId`: це повна заміна набору; порожні клітинки не передаються (як у `rowForStorage`).
  const rows = made.request.rows.map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value != null)));
  const changes = countChanges(keys, oldRows, rows);
  const manual = Array.isArray(payload?.corrections) ? payload.corrections.length : 0;
  return { ok: true, request: { moduleId: module.id, rows }, rowCount: rows.length, before: oldRows.length, ...changes, manual };
}

/** Підсумок для людини: було/стане, скільки додано, зникне й лишиться, плюс попередження про ручні правки. */
export function refreshSummary(view) {
  if (!view.ok) return { lines: [view.message], changed: false };
  const lines = [`Було ${count(view.before)}, стане ${count(view.rowCount)}: додано ${view.added}, зникне ${view.removed}, без змін ${view.same}.`];
  const changed = view.added > 0 || view.removed > 0;
  if (!changed) lines.push('Вихідні таблиці не змінилися відносно цього знімка: оновлювати нічого.');
  if (view.removed > 0) lines.push('Зникнуть рядки, яких уже немає у вихідних таблицях, і рядки, які ви додали чи змінили в цій таблиці вручну.');
  if (changed && view.manual > 0) lines.push(`У таблиці є виправлені вручну значення (${view.manual}): оновлення замінить усі рядки, і ці правки не збережуться.`);
  return { lines, changed };
}
