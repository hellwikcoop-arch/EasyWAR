// Операції над рядками спільної таблиці колективу — етап E8 / C1b.
//
// Чисте ядро без DOM, мережі, сховищ, годинника й криптографії. Застосунок цей файл поки не
// імпортує (його підключить C3b/C5). Перевірку підпису й права запису передає викликач:
// ядро лише вимагає, щоб вони були, і відмовляє, якщо їх немає.
//
// Правила (docs/COLLECTIVES_PLAN.md, розділи 5.1–5.5; рішення власника К1, К5, К6, Q10д):
// - одиниця обміну — операція upsert | delete | restore; upsert і restore несуть повний рядок (К1);
// - поточний стан — результат застосування операцій; версія рядка зростає на 1 з кожною
//   застосованою операцією;
// - операція від версії, що вже не поточна, — конфлікт; обидві версії зберігаються, рядок
//   лишається останнім безконфліктним; переможця не обирають за часом пристрою, порядком
//   доставки чи ID (без last-write-wins);
// - той самий op_id з тими самими байтами — дубль; з іншими — порушення цілісності;
// - видалення — надгробок з останнім значенням і автором; відновлення без обмеження за часом
//   (К5); відновлення на зайнятий ключ — конфлікт;
// - вносить лише той, кому власник таблиці дав право запису на всю таблицю (К6); конфлікт
//   розв'язує будь-хто з таким правом новою операцією.
// Стан не змінюється на місці: кожна функція повертає новий стан.

export const OPERATION_KINDS = Object.freeze(['upsert', 'delete', 'restore']);

/** Результати застосування операції. */
export const APPLY_STATUSES = Object.freeze([
  'applied', 'duplicate', 'integrity_violation', 'conflict', 'rejected', 'quarantined',
]);

/** Поля операції за COLLECTIVES_PLAN.md, розділ 5.2. Інших полів не буває. */
export const OPERATION_FIELDS = Object.freeze([
  'op_id', 'collective_id', 'table_id', 'schema_version', 'row_key', 'kind', 'values',
  'base_version', 'author_member_id', 'device_id', 'signature', 'client_time', 'key_epoch',
]);

const REQUIRED_STRINGS = Object.freeze([
  'op_id', 'collective_id', 'table_id', 'row_key', 'author_member_id', 'device_id', 'signature',
]);

const own = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const isNonNegInt = v => Number.isSafeInteger(v) && v >= 0;
const isCell = v => v === null || typeof v === 'string' || typeof v === 'boolean'
  || (typeof v === 'number' && Number.isFinite(v));
const opts = v => (isPlainObject(v) ? v : {});

/**
 * Детермінований рядок операції: ключі відсортовано на всіх рівнях. На ньому порівнюються
 * байти для дублів і будується digest (сам digest обчислює викликач).
 */
export function canonicalOperation(op) {
  const walk = value => {
    if (Array.isArray(value)) return `[${value.map(walk).join(',')}]`;
    if (value !== null && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${walk(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
  };
  return walk(op);
}

/**
 * Перевірка форми операції проти схеми таблиці. Нічого не виправляє.
 * schema: { collectiveId, tableId, schemaVersion, columns: string[] }
 * @returns {{ ok: boolean, errors: string[] }} errors — машинні коди
 */
export function validateOperation(op, schema) {
  const errors = [];
  const s = opts(schema);
  if (!isPlainObject(op)) return { ok: false, errors: ['op-not-object'] };
  for (const key of Object.keys(op)) if (!OPERATION_FIELDS.includes(key)) errors.push(`unknown-field:${key}`);
  for (const key of REQUIRED_STRINGS) {
    if (typeof op[key] !== 'string' || op[key] === '') errors.push(`missing:${key}`);
  }
  if (!OPERATION_KINDS.includes(op.kind)) errors.push('bad-kind');
  if (!isNonNegInt(op.schema_version)) errors.push('bad-schema-version');
  if (!isNonNegInt(op.base_version)) errors.push('bad-base-version');
  if (!isNonNegInt(op.key_epoch)) errors.push('bad-key-epoch');
  if (own(op, 'client_time') && op.client_time !== null && typeof op.client_time !== 'string') {
    errors.push('bad-client-time');
  }
  const columns = Array.isArray(s.columns) ? s.columns : null;
  if (!columns || columns.length === 0) errors.push('bad-schema');
  if (op.kind === 'upsert' || op.kind === 'restore') {
    if (!isPlainObject(op.values)) {
      errors.push('values-not-full-row');
    } else if (columns) {
      for (const column of columns) if (!own(op.values, column)) errors.push(`values-missing:${column}`);
      for (const key of Object.keys(op.values)) {
        if (!columns.includes(key)) errors.push(`values-unknown:${key}`);
        else if (!isCell(op.values[key])) errors.push(`values-bad-cell:${key}`);
      }
    }
  } else if (op.kind === 'delete' && own(op, 'values') && op.values !== null) {
    errors.push('delete-has-values');
  }
  return { ok: errors.length === 0, errors };
}

/** Порожній стан таблиці. */
export function emptyTableState({ collectiveId, tableId, schemaVersion } = {}) {
  return Object.freeze({
    collectiveId, tableId, schemaVersion,
    rows: Object.freeze({}),
    seen: Object.freeze({}),
    conflicts: Object.freeze([]),
  });
}

const freezeRow = row => Object.freeze({ ...row, values: row.values ? Object.freeze({ ...row.values }) : null });

function withChanges(state, { row, rowKey, op, conflict }) {
  const rows = row ? { ...state.rows, [rowKey]: freezeRow(row) } : state.rows;
  const seen = op ? { ...state.seen, [op.op_id]: canonicalOperation(op) } : state.seen;
  const conflicts = conflict ? [...state.conflicts, Object.freeze(conflict)] : state.conflicts;
  return Object.freeze({ ...state, rows: Object.freeze(rows), seen: Object.freeze(seen), conflicts: Object.freeze(conflicts) });
}

const result = (status, state, reason, extra = {}) => Object.freeze({ status, state, reason, ...extra });

/**
 * Застосування однієї операції.
 * options: {
 *   schema,                        // див. validateOperation
 *   writers: string[],             // учасники з правом запису на всю таблицю (К6)
 *   verify: op => boolean,         // перевірка підпису й пристрою; без неї — відмова
 * }
 * @returns {{ status, state, reason, conflict? }}
 */
export function applyOperation(state, op, options) {
  const { schema, writers, verify } = opts(options);
  const s = opts(schema);
  const check = validateOperation(op, s);
  if (!check.ok) return result('rejected', state, 'invalid-operation', { errors: check.errors });

  const canonical = canonicalOperation(op);
  if (own(state.seen, op.op_id)) {
    return state.seen[op.op_id] === canonical
      ? result('duplicate', state, 'same-op-id-same-bytes')
      : result('integrity_violation', state, 'same-op-id-different-bytes');
  }
  if (op.collective_id !== state.collectiveId || op.table_id !== state.tableId) {
    return result('rejected', state, 'wrong-table');
  }
  if (op.collective_id !== s.collectiveId || op.table_id !== s.tableId || op.schema_version !== s.schemaVersion
    || op.schema_version !== state.schemaVersion) {
    return result('quarantined', state, 'unknown-schema-version');
  }
  if (typeof verify !== 'function') return result('rejected', state, 'no-verifier');
  if (verify(op) !== true) return result('rejected', state, 'bad-signature');
  if (!Array.isArray(writers) || !writers.includes(op.author_member_id)) {
    return result('rejected', state, 'no-write-right');
  }

  const rowKey = op.row_key;
  const current = own(state.rows, rowKey) ? state.rows[rowKey] : null;
  const version = current ? current.version : 0;
  const conflictOf = reason => ({
    conflictId: op.op_id, rowKey, kind: op.kind, reason,
    baseVersion: op.base_version, currentVersion: version,
    op, resolvedBy: null,
  });
  const conflict = reason => {
    const c = conflictOf(reason);
    return result('conflict', withChanges(state, { op, conflict: c }), reason, { conflict: c });
  };
  if (op.base_version !== version) return conflict('stale-base-version');

  const author = { lastOpId: op.op_id, lastAuthor: op.author_member_id, lastDevice: op.device_id, lastClientTime: op.client_time ?? null };
  if (op.kind === 'upsert') {
    if (current && current.deleted) return conflict('row-deleted');
    const row = { version: version + 1, deleted: false, values: op.values, tombstone: null, ...author };
    return result('applied', withChanges(state, { row, rowKey, op }), 'upsert');
  }
  if (op.kind === 'delete') {
    if (!current || current.deleted) return conflict('nothing-to-delete');
    const tombstone = Object.freeze({ lastValues: current.values, deletedBy: op.author_member_id, deletedOpId: op.op_id });
    const row = { version: version + 1, deleted: true, values: null, tombstone, ...author };
    return result('applied', withChanges(state, { row, rowKey, op }), 'delete');
  }
  // restore
  if (!current || !current.deleted) return conflict('key-occupied');
  const row = { version: version + 1, deleted: false, values: op.values, tombstone: null, restoredFrom: current.tombstone, ...author };
  return result('applied', withChanges(state, { row, rowKey, op }), 'restore');
}

/**
 * Застосування кількох операцій у заданому порядку (порядок задає квитанція сховища).
 * @returns {{ state, results: object[] }}
 */
export function applyOperations(state, ops, options) {
  let current = state;
  const results = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    const r = applyOperation(current, op, options);
    results.push(r);
    current = r.state;
  }
  return { state: current, results };
}

/** Нерозв'язані конфлікти, за рядком або всі. */
export function openConflicts(state, rowKey) {
  return state.conflicts.filter(c => c.resolvedBy === null && (rowKey === undefined || c.rowKey === rowKey));
}

/**
 * Розв'язання конфлікту — нова операція від учасника з правом запису (К6) від поточної версії
 * рядка. Попередні версії лишаються в журналі. Конфлікт позначається розв'язаним лише разом
 * із застосуванням операції.
 */
export function resolveConflict(state, conflictId, op, options) {
  const target = state.conflicts.find(c => c.conflictId === conflictId);
  if (!target) return result('rejected', state, 'unknown-conflict');
  if (target.resolvedBy !== null) return result('rejected', state, 'conflict-already-resolved');
  if (!isPlainObject(op) || op.row_key !== target.rowKey) return result('rejected', state, 'resolution-other-row');
  const applied = applyOperation(state, op, options);
  if (applied.status !== 'applied') return applied;
  const conflicts = applied.state.conflicts.map(c => (c.rowKey === target.rowKey && c.resolvedBy === null
    ? Object.freeze({ ...c, resolvedBy: op.op_id }) : c));
  return result('applied', Object.freeze({ ...applied.state, conflicts: Object.freeze(conflicts) }), 'conflict-resolved');
}

/**
 * Різниця «було → стане» для перегляду. У пакет завжди йде весь рядок (К1), тому fullRow: true;
 * changed — лише для підсвічування.
 */
export function diffRows(before, after, columns) {
  const keys = Array.isArray(columns) && columns.length
    ? columns
    : [...new Set([...Object.keys(opts(before)), ...Object.keys(opts(after))])];
  const b = before === null || before === undefined ? null : opts(before);
  const a = after === null || after === undefined ? null : opts(after);
  const changed = keys.filter(k => (b ? b[k] : undefined) !== (a ? a[k] : undefined));
  return Object.freeze({
    change: !b ? 'added' : !a ? 'deleted' : changed.length ? 'changed' : 'unchanged',
    changed: Object.freeze(changed),
    fullRow: true,
    before: b,
    after: a,
  });
}
