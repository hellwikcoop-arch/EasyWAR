// Перегляд і фіксація «Доповісти» — етап E8 / C1d.
//
// Чисте ядро без DOM, мережі, сховищ, годинника й криптографії; застосунок його поки не
// імпортує. Правила (docs/COLLECTIVES_PLAN.md, 5.3; рішення власника Q10г, К1, К5):
// - перегляд показує «було → стане» для кожного рядка, що піде; змінені клітинки — лише для
//   підсвічування, у пакет іде весь рядок, і перегляд прямо про це каже;
// - видалення виділено окремо й вимагає підтвердження;
// - дублікати й конфлікти показуються, а не вирішуються мовчки; з нерозв'язаним конфліктом
//   відправка не фіксується;
// - фіксація повертає рівно ті операції, що були в перегляді, і лише якщо локальна ревізія не
//   змінилася з моменту перегляду.

import { canonicalOperation, diffRows, validateOperation } from './shared-table-core.js';

export const FULL_ROW_NOTE = 'У пакет іде весь рядок, навіть якщо змінено лише виділені клітинки';

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const opts = v => (isPlainObject(v) ? v : {});
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) Object.defineProperty(out, key, { value: frozenCopy(value[key]), enumerable: true });
    return Object.freeze(out);
  }
  return value;
}

/**
 * Перегляд перед «Доповісти».
 * input: { pendingOps: Op[], currentRows: { [rowKey]: values|null }, schema, revision }
 * @returns заморожений перегляд: items, deletions, duplicates, conflicts, invalid, note, revision
 */
export function previewReport(input) {
  const { pendingOps, currentRows, schema, revision } = opts(input);
  const ops = Array.isArray(pendingOps) ? pendingOps : [];
  const rows = opts(currentRows);
  const columns = Array.isArray(opts(schema).columns) ? schema.columns : [];
  const items = [];
  const deletions = [];
  const duplicates = [];
  const conflicts = [];
  const invalid = [];
  const seenIds = new Map();
  const byRow = new Map();
  for (const op of ops) {
    const check = validateOperation(op, schema);
    if (!check.ok) { invalid.push(Object.freeze({ opId: op && op.op_id, errors: Object.freeze(check.errors) })); continue; }
    // Перегляд показує лише те, що застосовне до цієї таблиці (зауваження C3 F-17): чужа таблиця
    // чи інша версія схеми — хибна операція, а не рядок «що піде».
    const s = opts(schema);
    if (op.collective_id !== s.collectiveId || op.table_id !== s.tableId) {
      invalid.push(Object.freeze({ opId: op.op_id, errors: Object.freeze(['wrong-table']) })); continue;
    }
    if (op.schema_version !== s.schemaVersion) {
      invalid.push(Object.freeze({ opId: op.op_id, errors: Object.freeze(['unknown-schema-version']) })); continue;
    }
    if (seenIds.has(op.op_id)) {
      duplicates.push(Object.freeze({ opId: op.op_id, sameBytes: seenIds.get(op.op_id) === canonicalOperation(op) }));
      continue;
    }
    seenIds.set(op.op_id, canonicalOperation(op));
    // Контракт черги: одна операція на рядок за одне «Доповісти» (черга стискається до
    // останнього стану рядка до перегляду). Дві операції над одним рядком — показ і блокування,
    // а не мовчазне злиття (зауваження C3 F-20).
    if (byRow.has(op.row_key)) {
      conflicts.push(Object.freeze({ rowKey: op.row_key, opIds: Object.freeze([byRow.get(op.row_key), op.op_id]), reason: 'two-pending-ops-same-row' }));
      continue;
    }
    byRow.set(op.row_key, op.op_id);
    // Знімки «було» й «стане» — глибокі заморожені копії: показане людині не зміниться через
    // об'єкти викликача й збігається з пакетом (зауваження C3 F-16, AC05).
    const before = own(rows, op.row_key) ? frozenCopy(rows[op.row_key]) : null;
    const after = op.kind === 'delete' ? null : frozenCopy(op.values);
    const item = Object.freeze({ rowKey: op.row_key, kind: op.kind, opId: op.op_id, diff: diffRows(before, after, columns), fullRow: true, op: frozenCopy(op) });
    (op.kind === 'delete' ? deletions : items).push(item);
  }
  return Object.freeze({
    revision: Number.isSafeInteger(revision) ? revision : null,
    items: Object.freeze(items),
    deletions: Object.freeze(deletions),
    duplicates: Object.freeze(duplicates),
    conflicts: Object.freeze(conflicts),
    invalid: Object.freeze(invalid),
    note: FULL_ROW_NOTE,
  });
}

/**
 * Фіксація «Доповісти» після перегляду.
 * options: { currentRevision, confirmedDeletions: rowKey[] }
 * @returns {{ ok, code, reason, ops? }} ops — рівно операції з перегляду, глибокі заморожені копії
 */
export function commitReport(preview, options) {
  const p = opts(preview);
  const { currentRevision, confirmedDeletions } = opts(options);
  const fail = (code, reason) => Object.freeze({ ok: false, code, reason });
  const lists = ['items', 'deletions', 'duplicates', 'conflicts', 'invalid'];
  if (lists.some(k => !Array.isArray(p[k])) || !Object.isFrozen(p)) return fail('invalid-preview', 'Немає перегляду — відправку не зафіксовано');
  if ([...p.items, ...p.deletions].some(i => !isPlainObject(i) || !isPlainObject(i.op) || typeof i.op.op_id !== 'string')) {
    return fail('invalid-preview', 'Перегляд пошкоджено — відправку не зафіксовано');
  }
  if (!Number.isSafeInteger(p.revision) || p.revision !== currentRevision) {
    return fail('stale-revision', 'Таблиця змінилася після перегляду: перегляньте зміни ще раз');
  }
  if (p.invalid.length) return fail('invalid-operations', 'У переліку є хибні операції — відправку не зафіксовано');
  if (p.duplicates.length) return fail('duplicates', 'У переліку є дублікати — перегляньте їх');
  if (p.conflicts.length) return fail('unresolved-conflicts', 'Є нерозв\'язані конфлікти — розв\'яжіть їх перед відправкою');
  const confirmed = new Set(Array.isArray(confirmedDeletions) ? confirmedDeletions : []);
  if (p.deletions.some(d => !confirmed.has(d.rowKey))) {
    return fail('deletions-not-confirmed', 'Підтвердіть кожне видалення окремо');
  }
  const ops = [...p.items, ...p.deletions].map(i => frozenCopy(i.op));
  if (ops.length === 0) return fail('nothing-to-report', 'Змін для відправки немає');
  return Object.freeze({ ok: true, code: 'committed', reason: 'Зміни поставлено в чергу відправлення', ops: Object.freeze(ops) });
}
