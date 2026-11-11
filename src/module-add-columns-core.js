// Додавання блока реєстру в «основну таблицю» (E5, крок 2): чиста логіка без DOM, сховищ і Tauri. Блок реєстру
// (модулі E1) вимагає смислових ролей — дата події, результат ураження, кількість боєприпасів тощо. Тут обчислюється, які
// з цих ролей у таблиці вже є, а яких бракує, і які стовпці треба додати. Нічого не записує: запис — команда
// `add_dashboard_module_fields` у викликача після підтвердження людини; значення стовпців заповнює користувач.

import { BINDABLE_ROLES, LIMITS, confirmBinding, resolveRoles } from './profile-schema-core.js';
import { ROLES } from './module-definition-core.js';
import { moduleSourceId } from './profile-schema-modules-core.js';

/** Службовий шаблон «основної таблиці» (Rust: `USER_TABLE_TEMPLATE_ID`). */
export const USER_TABLE_TEMPLATE_ID = 'user-table';
export const USER_TABLE_TITLE = 'Основна таблиця';
/** Скільки стовпців може мати таблиця (Rust: `MAX_CUSTOM_FIELDS`). */
export const MAX_TABLE_COLUMNS = 64;
const LABEL_LIMIT = 80;

// Прості об'єкти без `Object.freeze`: виклик на верхньому рівні не вилучається зі збірки ПВК-lite (ліміт 5 МБ).
/** Вигляд стовпця для ролі: тип значення, роль у таблиці й агрегація (кількості підсумовуються). */
const COLUMN_FOR_ROLE = {
  'event-date': { dataType: 'date', role: 'dimension', aggregation: 'none' },
  'munition-count': { dataType: 'integer', role: 'metric', aggregation: 'sum' },
};
const DEFAULT_COLUMN = { dataType: 'text', role: 'dimension', aggregation: 'none' };

/** Чому блок не можна підтримати стовпцями таблиці (його вимоги — не стовпці). */
const UNSUPPORTED = {
  workbook: 'Блок читає показники книги звітів, а не стовпці таблиці.',
  layer: 'Блок потребує знімка лінії бойового зіткнення, а не стовпців таблиці.',
  technical: 'Блок належить шаблону зі своїми службовими полями.',
  journal: 'Блок працює з довільними стовпцями журналу, а не з однією роллю.',
};

const normalized = label => String(label ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const fieldNumber = key => {
  const match = /^c(\d+)$/.exec(String(key ?? ''));
  return match ? Number(match[1]) : 0;
};

/** Стовпець, який бракує ролі: підпис — назва ролі з реєстру. */
export function columnForRole(role) {
  const base = COLUMN_FOR_ROLE[role] || DEFAULT_COLUMN;
  return { label: (ROLES[role]?.label || role).slice(0, LABEL_LIMIT), ...base };
}

/** Чому блок не будується зі стовпців, або порожній рядок, якщо будується. */
export function unsupportedReason(definition) {
  const requirements = Array.isArray(definition?.requirements) ? definition.requirements : [];
  if (!requirements.length) return 'У блока немає вимог до стовпців.';
  for (const requirement of requirements) {
    if (BINDABLE_ROLES.includes(requirement.role)) continue;
    const { from, kind } = ROLES[requirement.role] || {};
    if (requirement.role === 'journal-column') return UNSUPPORTED.journal;
    return UNSUPPORTED[from === 'column' ? kind : from] || UNSUPPORTED.technical;
  }
  return '';
}

/** Блок можна додати стовпцями таблиці: усі його вимоги — смислові ролі зі стовпців. */
export const supportsColumns = definition => unsupportedReason(definition) === '';

/**
 * Що додасть блок до таблиці. `module` — основна таблиця (`user-table`) або `null`, якщо її ще немає (тоді
 * стовпці стануть першими). `schema` — схема профілю з її зіставленнями (`null` без таблиці).
 * `withOptional` — додати й необов'язкові ролі блока.
 *
 * Для кожної ролі, якої бракує: якщо в таблиці вже є стовпець із таким підписом без ролі — пропонується
 * зіставити його (`bind`), інакше додати новий (`add`). Підпис, зайнятий стовпцем з іншою роллю, дістає
 * суфікс « (2)». Повертає
 * `{ ok: true, items, fields, bindings, adds, summary, nothingToAdd, totalColumns }` або `{ ok: false, code, message }`.
 */
export function planAddColumns({ definition, schema = null, module = null, withOptional = false } = {}) {
  const reason = unsupportedReason(definition);
  if (reason) return { ok: false, code: 'unsupported', message: reason };
  const sourceId = module ? moduleSourceId(module.id) : '';
  const fields = Array.isArray(module?.fields) ? module.fields : [];
  const bound = module && schema ? resolveRoles(schema, sourceId) : {};
  const boundKeys = new Set(Object.values(bound).map(item => item.columnKey));
  const taken = new Set(fields.map(field => normalized(field.label)));
  const planned = [];
  const seen = new Set();
  for (const requirement of definition.requirements) {
    if (!requirement.required && !withOptional) continue;
    if (seen.has(requirement.role)) continue;
    seen.add(requirement.role);
    if (bound[requirement.role]) {
      planned.push({ role: requirement.role, required: requirement.required === true, mode: 'have', columnKey: bound[requirement.role].columnKey });
      continue;
    }
    const base = columnForRole(requirement.role);
    const sameLabel = fields.find(field => normalized(field.label) === normalized(base.label) && !boundKeys.has(field.key));
    if (sameLabel) {
      planned.push({ role: requirement.role, required: requirement.required === true, mode: 'bind', columnKey: sameLabel.key, label: sameLabel.label });
      continue;
    }
    let label = base.label;
    for (let n = 2; taken.has(normalized(label)); n += 1) label = `${base.label.slice(0, LABEL_LIMIT - 5)} (${n})`;
    taken.add(normalized(label));
    planned.push({ role: requirement.role, required: requirement.required === true, mode: 'add', label, dataType: base.dataType, tableRole: base.role, aggregation: base.aggregation });
  }
  const newFields = planned.filter(item => item.mode === 'add')
    .map(({ label, dataType, tableRole, aggregation }) => ({ label, dataType, role: tableRole, aggregation }));
  const totalColumns = fields.length + newFields.length;
  if (totalColumns > MAX_TABLE_COLUMNS) {
    return { ok: false, code: 'too_many_columns', message: `У таблиці не може бути більш як ${MAX_TABLE_COLUMNS} стовпців: після додавання їх стало б ${totalColumns}.` };
  }
  if (newFields.length + (schema?.bindings?.length || 0) > LIMITS.maxBindings) {
    return { ok: false, code: 'too_many_bindings', message: 'Забагато зіставлень у схемі профілю.' };
  }
  let next = fields.reduce((max, field) => Math.max(max, fieldNumber(field.key)), 0);
  const items = planned.map(item => (item.mode === 'add' ? { ...item, columnKey: `c${(next += 1)}` } : item));
  const adds = items.filter(item => item.mode === 'add').map(item => item.label);
  const binds = items.filter(item => item.mode === 'bind').map(item => item.label);
  const parts = [];
  if (adds.length) parts.push(`додасть: ${adds.map(label => `«${label}»`).join(', ')}`);
  if (binds.length) parts.push(`зіставить наявні: ${binds.map(label => `«${label}»`).join(', ')}`);
  const nothingToAdd = adds.length === 0 && binds.length === 0;
  return {
    ok: true,
    items,
    fields: newFields,
    bindings: items.filter(item => item.mode !== 'have').map(item => ({ role: item.role, columnKey: item.columnKey, unit: '' })),
    adds,
    summary: nothingToAdd ? 'усі потрібні стовпці вже є' : parts.join('; '),
    nothingToAdd,
    totalColumns,
  };
}

/**
 * Зіставлення ролей зі стовпцями ПІСЛЯ додавання: ключі нових стовпців беруться з модуля, який повернула команда
 * (за підписом, у порядку додавання), а не з передбачення, тож розбіжність ключів на сервері нічого не зіпсує.
 * Повертає `{ ok, bindings: [{ role, columnKey, unit }] }` або `{ ok: false, message }`.
 */
export function bindingsAfterAdd(plan, module) {
  const fields = Array.isArray(module?.fields) ? module.fields : [];
  const bindings = [];
  for (const item of plan.items || []) {
    if (item.mode === 'have') continue;
    if (item.mode === 'bind') {
      bindings.push({ role: item.role, columnKey: item.columnKey, unit: '' });
      continue;
    }
    const field = fields.find(candidate => candidate.label === item.label);
    if (!field) return { ok: false, message: `Стовпця «${item.label}» немає у відповіді після додавання.` };
    bindings.push({ role: item.role, columnKey: field.key, unit: '' });
  }
  return { ok: true, bindings };
}

/** Тіло команди `add_dashboard_module_fields`. */
export const addFieldsRequest = (module, plan) => ({
  moduleId: module.id,
  fields: plan.fields,
  expectedUpdatedAt: module.updatedAt,
});

/** Тіло команди `create_dashboard_module` для основної таблиці з першими стовпцями блока. */
export const createUserTableRequest = (branch, plan, title = USER_TABLE_TITLE) => ({
  branch,
  templateId: USER_TABLE_TEMPLATE_ID,
  title,
  customFields: plan.fields,
  rows: [],
});

/** Чи є модуль основною таблицею (службовий шаблон). */
export const isUserTable = module => module?.templateId === USER_TABLE_TEMPLATE_ID;

/** Основні таблиці гілки: у порядку зі списку модулів. */
export const userTables = modules => (Array.isArray(modules) ? modules : []).filter(isUserTable);

/**
 * Підтверджує зіставлення ролей зі стовпцями таблиці одним записом схеми: перша відмова ядра зупиняє все й
 * повертається як є, тож схема лишається попередньою. Для запису в `updateProfileSchema`.
 */
export function confirmPlanBindings(schema, moduleId, bindings, at = '') {
  const sourceId = moduleSourceId(moduleId);
  let current = schema;
  for (const binding of bindings) {
    const step = confirmBinding(current, { sourceId, columnKey: binding.columnKey, role: binding.role, unit: binding.unit || '', at });
    if (!step.ok) return step;
    current = step.schema;
  }
  return { ok: true, schema: current };
}
