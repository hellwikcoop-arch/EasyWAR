/* E2, другий блок: ряди за днями дашборда ПВК («Календар активності», «Загальна динаміка»,
   міні-графіки карток) у спільному ядрі модулів. Чисте ядро без DOM. Формули перенесено
   з createDashboardModel без змін; стара вкладка ПВК викликає саме цю функцію. */

/** Визначення реєстру модулів (docs/MODULE_DEFINITIONS.md), які рахує цей блок. */
export const PVK_DYNAMICS_DEFINITIONS = Object.freeze([
  'legacy:pvk-activity-calendar',
  'legacy:pvk-dynamics',
]);

/** Сума рядів вибраних показників аркушів за датою, у порядку дат. */
export function mergeDaily(models, selector) {
  const values = new Map();
  for (const sheet of models) {
    const metrics = selector(sheet);
    for (const metric of metrics) {
      const widget = sheet.widgets.find(item => item.metric === metric);
      for (const item of widget?.series || []) values.set(item.date, (values.get(item.date) || 0) + item.value);
    }
  }
  return [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

const groupMetrics = (sheet, name) => sheet.groups.find(group => group.name === name)?.metrics || [];

/**
 * Ряди за днями з моделей аркушів ПВК (summarizeSheet) за вибраний період.
 * `activity` — сума АУ аркушів АА і ПС; `dynamics` — лінії «Загальної динаміки» й міні-графіків карток.
 */
export function computePvkDynamics(sheets = []) {
  const activity = mergeDaily(sheets, sheet => sheet.name === 'АА' || sheet.name === 'ПС' ? ['АУ'] : []);
  return {
    activity,
    dynamics: {
      au: activity,
      munitions: mergeDaily(sheets, sheet => groupMetrics(sheet, 'Боєприпаси')),
      objects: mergeDaily(sheets, sheet => sheet.name === "Об'єкти" ? groupMetrics(sheet, 'Уражені об’єкти') : []),
      expenditure: mergeDaily(sheets, sheet => sheet.name === "Об'єкти" ? ['Витрата'] : []),
      // Ряди для міні-графіків карток «Уражено» і «Дорозвідується» (лише з даних вибраного періоду).
      affected: mergeDaily(sheets, sheet => sheet.name === 'АА' || sheet.name === 'ПС' ? ['Уражено'] : []),
      reconnaissance: mergeDaily(sheets, sheet => sheet.name === 'ПС' ? ['Дорозвідується'] : []),
    },
  };
}
