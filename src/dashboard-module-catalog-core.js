const BRANCHES = new Set(['air', 'rocket', 'pvk', 'dshv']);
const VISUAL_KINDS = new Set([
  'kpi', 'line', 'area', 'columns', 'horizontal-bar', 'grouped-columns', 'donut',
  'radial-progress', 'multi-ring', 'radar', 'gauge', 'progress-bars', 'calendar',
  'table', 'funnel', 'map', 'cohort', 'activity', 'waveform',
]);
const FIELD_TYPES = new Set(['text', 'integer', 'real', 'date', 'datetime', 'boolean']);
const FIELD_ROLES = new Set(['dimension', 'metric', 'label', 'series', 'status', 'latitude', 'longitude', 'order', 'note']);

const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const safeKey = value => /^[a-z][a-z0-9_]{0,63}$/.test(value || '') ? value : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function branchFromLocation(pathname = '', search = '') {
  const command = new URLSearchParams(search).get('command');
  if (command === 'pvk' || command === 'dshv') return command;
  return /rocket\.html$/i.test(pathname) ? 'rocket' : 'air';
}

export function normalizeField(source) {
  const key = safeKey(source?.key);
  const label = text(source?.label, 80);
  const dataType = FIELD_TYPES.has(source?.dataType) ? source.dataType : '';
  const role = FIELD_ROLES.has(source?.role) ? source.role : '';
  const aggregation = text(source?.aggregation, 16);
  if (!key || !label || !dataType || !role || !aggregation) return null;
  return { key, label, dataType, role, aggregation, required: source?.required === true, position: Number.isInteger(source?.position) ? source.position : null };
}

export function normalizeCatalog(source) {
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  return source.slice(0, 64).flatMap(item => {
    const rawId = typeof item?.id === 'string' ? item.id : '';
    const id = safeKey(rawId.replaceAll('-', '_')) ? text(rawId, 64) : '';
    const title = text(item?.title, 80);
    const category = text(item?.category, 40);
    const description = text(item?.description, 240);
    const visualKind = VISUAL_KINDS.has(item?.visualKind) ? item.visualKind : '';
    const fields = Array.isArray(item?.fields) ? item.fields.map(normalizeField).filter(Boolean) : [];
    if (!id || seen.has(id) || !title || !category || !visualKind || !fields.length) return [];
    seen.add(id);
    return [{ id, title, category, description, visualKind, defaultSpan: item?.defaultSpan === 2 ? 2 : 1, fields }];
  });
}

export function normalizeModules(source) {
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  return source.slice(0, 64).flatMap(item => {
    const id = text(item?.id, 64);
    const branch = BRANCHES.has(item?.branch) ? item.branch : '';
    const visualKind = VISUAL_KINDS.has(item?.visualKind) ? item.visualKind : '';
    const title = text(item?.title, 80);
    const table = /^dashboard_data_[0-9a-f]{24}$/.test(item?.storageTable || '') ? item.storageTable : '';
    const fields = Array.isArray(item?.fields) ? item.fields.map(normalizeField).filter(Boolean) : [];
    if (!id || seen.has(id) || !branch || !visualKind || !title || !table || !fields.length) return [];
    seen.add(id);
    return [{ ...item, id, branch, visualKind, title, storageTable: table, fields, rowCount: Math.max(0, Number(item.rowCount) || 0) }];
  });
}

export function schemaSummary(fields) {
  return (Array.isArray(fields) ? fields : []).map(field => `${field.label} · ${field.dataType}`).join('  |  ');
}

export function matchesCatalogItem(item, query) {
  const needle = text(query, 80).toLocaleLowerCase('uk');
  if (!needle) return true;
  return [item?.title, item?.category, item?.description, ...(item?.fields || []).map(field => field.label)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('uk')
    .includes(needle);
}

export function formatValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Так' : 'Ні';
  if (finite(value)) return new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

export function fieldInputType(field) {
  if (field?.dataType === 'boolean') return 'select';
  if (field?.dataType === 'integer' || field?.dataType === 'real') return 'number';
  if (field?.dataType === 'date') return 'date';
  if (field?.dataType === 'datetime') return 'datetime-local';
  if (['takeoff_time', 'landing_time'].includes(field?.key)) return 'time';
  return 'text';
}

export function parseFieldInput(field, rawValue) {
  const label = text(field?.label, 80) || 'Поле';
  const raw = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (raw === '' || raw == null) {
    if (field?.required) throw new Error(`Поле «${label}» є обов'язковим.`);
    return null;
  }
  if (field?.dataType === 'boolean') {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    throw new Error(`Поле «${label}» має містити «Так» або «Ні».`);
  }
  if (field?.dataType === 'integer') {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(`Поле «${label}» має містити ціле число.`);
    return value;
  }
  if (field?.dataType === 'real') {
    const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(value)) throw new Error(`Поле «${label}» має містити число.`);
    return value;
  }
  const value = String(raw);
  if (value.length > 4096) throw new Error(`Поле «${label}» перевищує 4096 символів.`);
  return value;
}

export function rowForWrite(fields, rawValues) {
  const row = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    const value = parseFieldInput(field, rawValues?.[field.key]);
    if (value !== null) row[field.key] = value;
  }
  return row;
}

/**
 * Рядок у вигляді, який приймає `replace_dashboard_module_rows`: лише поля
 * каталогу та `rowId` — ідентифікатор запису, за яким Rust зберігає його
 * `created_at`. Службові `createdAt` і порожні значення не передаються.
 */
export function rowForStorage(fields, row) {
  const stored = {};
  if (Number.isSafeInteger(row?.rowId) && row.rowId >= 1) stored.rowId = row.rowId;
  for (const field of Array.isArray(fields) ? fields : []) {
    const value = row?.[field.key];
    if (value != null) stored[field.key] = value;
  }
  return stored;
}

/** Повний набір рядків після додавання (`rowIndex` не число) або правки запису. */
export function rowsAfterSave(fields, rows, rowIndex, edited) {
  const next = (Array.isArray(rows) ? rows : []).map(row => rowForStorage(fields, row));
  if (Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < next.length) {
    const rowId = next[rowIndex].rowId;
    next[rowIndex] = rowId == null ? edited : { ...edited, rowId };
  } else {
    next.push(edited);
  }
  return next;
}

/** Повний набір рядків без запису `rowIndex`; решта зберігає свої `rowId`. */
export function rowsAfterDelete(fields, rows, rowIndex) {
  return (Array.isArray(rows) ? rows : []).flatMap((row, index) => (
    index === rowIndex ? [] : [rowForStorage(fields, row)]
  ));
}

/**
 * Аргументи команди збереження. `expectedUpdatedAt` — позначка змін, з якою
 * таблицю відкрито: якщо її вже змінили деінде, Rust відхилить запис. Без
 * позначки запис мовчки став би «останній перемагає», тому її відсутність —
 * помилка, а не безумовне збереження.
 */
export function replaceRowsRequest(module, rows) {
  if (typeof module?.id !== 'string' || !module.id) throw new Error('Немає ідентифікатора модуля.');
  if (typeof module.updatedAt !== 'string' || !module.updatedAt) {
    throw new Error('Немає позначки версії таблиці. Закрийте вікно й відкрийте таблицю знову.');
  }
  return { moduleId: module.id, rows, expectedUpdatedAt: module.updatedAt };
}

/** Відповідь Rust «таблицю змінено в іншому вікні» (див. `DashboardModuleError::Conflict`). */
export function isConflictError(error) {
  return /змінено в іншому вікні/i.test(String(error?.message ?? error ?? ''));
}

/**
 * Чи можна змінювати таблицю. Збереження замінює весь набір рядків, тому після
 * збою читання або за межею перегляду (10 000 рядків) змінювати таблицю не
 * можна: запис стер би рядки, яких користувач не бачить.
 */
export function tableEditState(payload) {
  if (!payload || typeof payload !== 'object' || payload.failed === true) {
    return { editable: false, reason: 'Не вдалося прочитати таблицю, тому її відкрито лише для перегляду.' };
  }
  if (payload?.truncated === true) {
    return { editable: false, reason: 'Таблиця перевищує межу 10 000 рядків і відкрита лише для читання.' };
  }
  return { editable: true, reason: '' };
}

export function previewModel(module, rows) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, 10_000) : [];
  const fields = Array.isArray(module?.fields) ? module.fields : [];
  const dimensions = fields.filter(field => ['dimension', 'label', 'series', 'status'].includes(field.role));
  const isFlightHours = module?.templateId === 'flight-hours'
    || fields.some(field => field.key === 'aircraft_type')
      && fields.some(field => field.key === 'airborne_hours')
      && fields.some(field => field.key === 'total_hours');
  const metrics = isFlightHours
    ? fields.filter(field => ['airborne_hours', 'total_hours'].includes(field.key))
    : fields.filter(field => field.role === 'metric');
  const dimension = isFlightHours
    ? fields.find(field => field.key === 'aircraft_type')
    : dimensions.find(field => field.role === 'dimension' || field.role === 'label') || dimensions[0];
  const statusField = fields.find(field => field.role === 'status');
  const grouped = new Map();
  safeRows.forEach((row, index) => {
    const rawLabel = row?.[dimension?.key] ?? index + 1;
    const key = `${typeof rawLabel}:${String(rawLabel)}`;
    const group = grouped.get(key) || { label: formatValue(rawLabel), rows: [] };
    group.rows.push(row || {});
    grouped.set(key, group);
  });
  const points = [...grouped.values()].map(group => ({
    label: group.label,
    values: metrics.map(field => aggregateMetric(group.rows, field)),
    status: formatValue(group.rows.find(row => row?.[statusField?.key] != null)?.[statusField?.key]),
  }));
  const values = points.flatMap(point => point.values).filter(finite);
  const max = Math.max(0, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const first = safeRows[0] || {};
  const currentField = fields.find(field => field.key === 'current_value') || metrics[0];
  const targetField = fields.find(field => field.key === 'target_value') || fields.find(field => field.key === 'maximum') || metrics[1];
  const current = finite(first?.[currentField?.key]) ? first[currentField.key] : 0;
  const target = finite(first?.[targetField?.key]) && first[targetField.key] !== 0 ? first[targetField.key] : 0;
  return {
    kind: VISUAL_KINDS.has(module?.visualKind) ? module.visualKind : 'table',
    points,
    max,
    total,
    percent: target ? Math.max(0, Math.min(100, current / target * 100)) : 0,
    empty: safeRows.length === 0,
  };
}

function aggregateMetric(rows, field) {
  const values = rows.map(row => row?.[field.key]).filter(finite);
  switch (field.aggregation) {
    case 'count': return values.length;
    case 'average': return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    case 'minimum': return values.length ? Math.min(...values) : 0;
    case 'maximum': return values.length ? Math.max(...values) : 0;
    case 'none': return values[0] ?? 0;
    default: return values.reduce((sum, value) => sum + value, 0);
  }
}

export const dashboardModuleCore = {
  branchFromLocation,
  normalizeCatalog,
  normalizeModules,
  schemaSummary,
  matchesCatalogItem,
  formatValue,
  fieldInputType,
  parseFieldInput,
  rowForWrite,
  rowForStorage,
  rowsAfterSave,
  rowsAfterDelete,
  replaceRowsRequest,
  isConflictError,
  tableEditState,
  previewModel,
};
