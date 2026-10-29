// Модулі дашборда як джерела схеми профілю (E3): чиста логіка без DOM і Tauri.
// Кожен модуль користувача — одне джерело типу `module-table` (`module:<id модуля>`), а його поля
// з шаблону — стовпці джерела. Синхронізація лише додає й оновлює: порядок, підписи та підтверджені
// зіставлення користувача зберігає `updateSourceColumns`; нове поле шаблону стає в кінець.

import { addSource, removeSource, renameSource, updateSourceColumns } from './profile-schema-core.js';

export const MODULE_SOURCE_PREFIX = 'module:';

export const moduleSourceId = moduleId => `${MODULE_SOURCE_PREFIX}${moduleId}`;

/** Тип значення поля шаблону Rust → тип стовпця схеми (узгоджений з ROLE_TYPES ядра). */
const COLUMN_TYPES = { integer: 'number', real: 'number', date: 'date', datetime: 'date', boolean: 'flag', text: 'text' };

/** Модуль → вхід `addSource`; поля в порядку `position`. */
export function moduleSource(module) {
  const fields = [...(Array.isArray(module?.fields) ? module.fields : [])]
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  return {
    id: moduleSourceId(module?.id),
    type: 'module-table',
    ref: String(module?.id ?? ''),
    title: module?.title || String(module?.id ?? ''),
    columns: fields.map(field => ({ key: field.key, header: field.label, type: COLUMN_TYPES[field.dataType] || 'text' })),
  };
}

/**
 * Приводить схему до списку модулів: нове джерело додається, наявне оновлює стовпці й назву. Джерела
 * модулів, яких у списку немає, не чіпаються (список — лише одна гілка дашборда). Без змін повертає
 * ту саму схему. Перша помилка ядра зупиняє синхронізацію і повертається як є.
 */
export function syncModuleSources(schema, modules) {
  let current = schema;
  for (const module of Array.isArray(modules) ? modules : []) {
    const wanted = moduleSource(module);
    const known = current.sources.find(source => source.id === wanted.id);
    let step;
    if (!known) {
      step = addSource(current, wanted);
    } else {
      step = updateSourceColumns(current, wanted.id, wanted.columns);
      if (step.ok) step = renameSource(step.schema, wanted.id, wanted.title);
    }
    if (!step.ok) return step;
    current = step.schema.revision === current.revision ? current : step.schema;
  }
  return { ok: true, schema: current };
}

/** Схема без джерела видаленого модуля (і без його зіставлень). */
export function forgetModuleSource(schema, moduleId) {
  return removeSource(schema, moduleSourceId(moduleId));
}
