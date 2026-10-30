// «Зібрати за шаблоном» (E5): чиста логіка без DOM і Tauri. Шаблон — перелік блоків реєстру в порядку дашборда
// РВ чи ПС; одним підтвердженням основна таблиця дістає всі бракуючі стовпці цих блоків, а «Мій дашборд» — їхні
// картки (показники зверху, під ними діаграми, перелік записів — нижче). Нічого не записує: запис — у викликача.

import { planAddColumns } from './module-add-columns-core.js';
import { hasBlockCard, placeBlockCard } from './module-block-card-core.js';

const KPI = ['launches', 'munitions', 'destroyed', 'damaged', 'miss', 'unknown'].map(id => `legacy:rv-kpi-${id}`);
const CHARTS = ['result-dynamics', 'result-distribution', 'activity-by-day', 'platform-types', 'munition-use', 'firing-units',
  'top-units', 'target-types', 'repeat-targets', 'hour-of-day'].map(id => `legacy:${id}`);

// Прості об'єкти без `Object.freeze`: виклик на верхньому рівні не вилучається зі збірки ПВК-lite.
/**
 * Шаблони. `titles` — підписи карток, що відрізняються від шаблону РВ (у ПС пуск — це виліт). Карта, глибина,
 * журнал і «Потребує перевірки» поки не рахуються з основної таблиці, тож у шаблон не входять.
 */
export const PRESETS = {
  rv: { id: 'rv', label: 'Шаблон РВ', title: 'РВ', blocks: [...KPI, ...CHARTS], titles: {} },
  ps: { id: 'ps', label: 'Шаблон ПС', title: 'ПС', blocks: [...KPI, ...CHARTS.filter(id => id !== 'legacy:firing-units')], titles: { 'legacy:rv-kpi-launches': 'Вильоти' } },
};

/** Шаблони для роду військ: «свій» — першим (ПС для авіації, РВ для решти). */
export const presetsFor = branch => (branch === 'air' ? [PRESETS.ps, PRESETS.rv] : [PRESETS.rv, PRESETS.ps]);

/** Блоки шаблону, знайдені в реєстрі й здатні бути карткою з основної таблиці, у порядку шаблону. */
export function presetDefinitions(preset, definitions) {
  const byId = new Map((Array.isArray(definitions) ? definitions : []).map(item => [item.definitionId, item]));
  return (preset?.blocks || []).map(id => byId.get(id)).filter(item => item && hasBlockCard(item.definitionId));
}

/**
 * Що зробить шаблон: один план стовпців на всі блоки (обов'язкові ролі без повторів, порядок — за першим блоком,
 * що їх вимагає) і скільки карток ще не стоїть на цій таблиці. `layout` — розкладка «Мого дашборда» або `null`.
 * Повертає `{ ok: true, plan, definitions, missing, summary }` або `{ ok: false, message }`.
 */
export function planPreset({ preset, definitions, schema = null, module = null, layout = null, sourceId = '' }) {
  const blocks = presetDefinitions(preset, definitions);
  if (!blocks.length) return { ok: false, message: 'У реєстрі немає блоків цього шаблону.' };
  const requirements = [];
  const roles = new Set();
  for (const block of blocks) {
    for (const requirement of block.requirements) {
      if (!requirement.required || roles.has(requirement.role)) continue;
      roles.add(requirement.role);
      requirements.push({ role: requirement.role, required: true });
    }
  }
  const plan = planAddColumns({ definition: { definitionId: `preset:${preset.id}`, requirements }, schema, module });
  if (!plan.ok) return plan;
  const placed = new Set((module && layout?.instances || []).filter(item => item.sourceId === sourceId).map(item => item.definitionId));
  const missing = blocks.filter(block => !placed.has(block.definitionId));
  const parts = [];
  if (missing.length) parts.push(`поставить карток: ${missing.length}`);
  if (!plan.nothingToAdd) parts.push(plan.summary);
  return { ok: true, plan, definitions: blocks, missing, summary: parts.join('; '), done: !missing.length && plan.nothingToAdd };
}

/**
 * Ставить картки шаблону, яких ще немає на таблиці `sourceId`, у порядку шаблону. Кожна стає перед карткою таблиці,
 * тож порядок зберігається, а таблиця лишається під ними. Перша відмова ядра розкладки зупиняє решту.
 * Повертає `{ ok, layout, placed }`.
 */
export function placePreset(layout, { preset, definitions, sourceId, freshTable = false }) {
  let current = { ok: true, layout };
  let placed = 0;
  for (const definition of definitions) {
    if (current.layout.instances.some(item => item.sourceId === sourceId && item.definitionId === definition.definitionId)) continue;
    const title = preset?.titles?.[definition.definitionId];
    const next = placeBlockCard(current.layout, { definition: title ? { ...definition, title } : definition, sourceId, freshTable: freshTable && placed === 0 });
    if (!next.ok) return placed ? { ...current, placed } : { ...next, placed };
    current = next;
    placed += 1;
  }
  return { ...current, placed };
}
