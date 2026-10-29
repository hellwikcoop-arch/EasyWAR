// Модель конструктора «Мій дашборд» (E4): чиста логіка без DOM і Tauri. Показ — dashboard-layout-panel.js.

import { MAX_COPIES, SIZE_CHOICES, copiesOf, effectivePeriod } from './module-instance-core.js';
import { moduleSourceId } from './profile-schema-modules-core.js';
import { periodColumn, rowsInPeriod } from './module-instance-modules-core.js';

export const PERIOD_CHOICES = Object.freeze([
  { id: 'shared', label: 'Як у спільній панелі' },
  { id: 'all', label: 'Увесь час' },
  { id: 'last-7', label: 'Останні 7 днів' },
  { id: 'last-30', label: 'Останні 30 днів' },
  { id: 'range', label: 'Свій діапазон' },
]);

/** Вибір у списку для періоду картки; нестандартне «останні N днів» теж показуємо як свій варіант. */
export function choiceOf(period) {
  if (period?.mode === 'last-days') return period.days === 7 ? 'last-7' : period.days === 30 ? 'last-30' : 'last-custom';
  return period?.mode === 'all' || period?.mode === 'range' ? period.mode : 'shared';
}

/** Період за вибором у списку; `null`, якщо діапазон ще не заповнено або некоректний. */
export function periodFromChoice(choice, range = {}) {
  if (choice === 'shared' || choice === 'all') return { mode: choice };
  if (choice === 'last-7') return { mode: 'last-days', days: 7 };
  if (choice === 'last-30') return { mode: 'last-days', days: 30 };
  if (choice === 'range' && range.from && range.to && range.from <= range.to) return { mode: 'range', from: range.from, to: range.to };
  return null;
}

const dayText = value => (value ? value.split('-').reverse().join('.') : '');

/** Підпис діючого періоду для картки. */
export function periodLabel(effective) {
  if (!effective.from && !effective.to) return 'Увесь час';
  return `${dayText(effective.from)} – ${dayText(effective.to)}`;
}

/** Картки поточних модулів у порядку розміщення (рядок, потім колонка); картки без модуля в списку пропускаємо. */
export function orderedCards(layout, modules) {
  const byId = new Map((Array.isArray(modules) ? modules : []).map(module => [moduleSourceId(module.id), module]));
  const place = new Map(layout.placements.map(item => [item.instanceId, item]));
  return layout.instances
    .filter(instance => byId.has(instance.sourceId))
    .map(instance => ({ instance, module: byId.get(instance.sourceId), at: place.get(instance.id) || { x: 0, y: 0 } }))
    .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)
    .map(({ instance, module, at }) => ({ instance, module, at }));
}

/**
 * Усе, що потрібно намалювати для картки: рядки в межах періоду, підпис, примітка й чи можна
 * дублювати/прибирати. Без підтвердженої дати період не діє й нічого не ховає.
 */
export function cardModel({ layout, schema, instance, rows, today }) {
  const effective = effectivePeriod(layout, instance.id, today);
  if (!effective.ok) return { ok: false, message: effective.message };
  const dateKey = schema ? periodColumn(schema, instance.sourceId) : null;
  const picked = rowsInPeriod(rows, dateKey, effective);
  const bounded = Boolean(effective.from || effective.to);
  let note = '';
  if (bounded && !picked.applied) note = 'Період не діє: підтвердьте стовпець «Дата події» в розділі «Ролі стовпців» на сторінці модуля.';
  else if (picked.undated) note = `Рядків без дати не враховано: ${picked.undated}.`;
  const copies = copiesOf(layout, instance.definitionId, instance.sourceId);
  return {
    ok: true,
    rows: picked.rows,
    periodLabel: bounded && !picked.applied ? `${periodLabel(effective)} (не діє)` : periodLabel(effective),
    own: effective.own,
    note,
    canDuplicate: copies < MAX_COPIES,
    removable: layout.instances.filter(item => item.sourceId === instance.sourceId).length > 1,
  };
}

/** Вибір розміру в списку: готові ширини; нестандартну (з розкладки) показуємо як окремий варіант. */
export function sizeChoices(width) {
  const known = SIZE_CHOICES.map(item => ({ w: item.w, label: item.label }));
  return known.some(item => item.w === width) ? known : [...known, { w: width, label: `${width} з 12` }].sort((a, b) => a.w - b.w);
}
