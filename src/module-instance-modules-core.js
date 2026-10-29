// Модулі дашборда як картки розкладки (E4): чиста логіка без DOM і Tauri.
// Кожен модуль користувача — джерело `module:<id>` (E3), і кожен має хоча б одну картку в розкладці.
// Синхронізація лише додає й прибирає картки модулів гілки, налаштувань користувача не чіпає;
// картки інших гілок, яких немає в переданому списку, лишаються як є.

import { addInstance, removeInstance } from './module-instance-core.js';
import { moduleSourceId } from './profile-schema-modules-core.js';
import { resolveRoles } from './profile-schema-core.js';

/** Ідентифікатор визначення з реєстру E1 для шаблону Rust (module-definition-core: `fromRustTemplates`). */
export const moduleDefinitionId = templateId => `rust-template:${templateId}`;

/**
 * Дає кожному модулю зі списку принаймні одну картку (за замовчуванням з періодом спільної панелі).
 * Без змін повертає ту саму розкладку. Перша помилка ядра зупиняє синхронізацію й повертається як є.
 */
export function ensureModuleInstances(layout, modules) {
  let current = layout;
  for (const module of Array.isArray(modules) ? modules : []) {
    const sourceId = moduleSourceId(module?.id);
    if (current.instances.some(instance => instance.sourceId === sourceId)) continue;
    const step = addInstance(current, {
      definitionId: moduleDefinitionId(module.templateId || 'custom'),
      sourceId,
      title: module.title,
      size: { w: module.defaultSpan === 2 ? 8 : 4, h: 4 },
    });
    if (!step.ok) return step;
    current = step.layout;
  }
  return { ok: true, layout: current };
}

/** Розкладка без карток видаленого модуля (і без їхніх розміщень). */
export function forgetModuleInstances(layout, moduleId) {
  const sourceId = moduleSourceId(moduleId);
  let current = layout;
  for (const instance of layout.instances.filter(item => item.sourceId === sourceId)) {
    const step = removeInstance(current, instance.id);
    if (!step.ok) return step;
    current = step.layout;
  }
  return { ok: true, layout: current };
}

/** Ключ стовпця, за яким діє період картки: підтверджена роль «Дата події» джерела. */
export function periodColumn(schema, sourceId) {
  return resolveRoles(schema, sourceId)['event-date']?.columnKey ?? null;
}

/**
 * Рядки модуля в межах періоду `{ from, to }` (включно; `null` — без обмеження). Дата — перші десять
 * символів значення (`YYYY-MM-DD`). Без підтвердженого стовпця дати період не діє (`applied: false`),
 * і рядки повертаються всі: приховувати дані за здогадом не можна. Рядки без дати за обмеженого
 * періоду не потрапляють у вибірку, їхню кількість повертаємо в `undated`.
 */
export function rowsInPeriod(rows, dateKey, period) {
  const list = Array.isArray(rows) ? rows : [];
  const bounded = period && (period.from || period.to);
  if (!bounded) return { rows: list, applied: true, undated: 0 };
  if (!dateKey) return { rows: list, applied: false, undated: 0 };
  let undated = 0;
  const kept = list.filter(row => {
    const value = row?.[dateKey];
    const day = typeof value === 'string' ? value.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) { undated += 1; return false; }
    return (!period.from || day >= period.from) && (!period.to || day <= period.to);
  });
  return { rows: kept, applied: true, undated };
}
