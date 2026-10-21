/* E2, перший блок: підсумкові картки дашборда ПВК у спільному ядрі модулів.
   Чисте ядро без DOM. Формули перенесено з createDashboardModel без змін;
   стара вкладка ПВК викликає саме ці функції (docs/MODULES_ROADMAP.md, етап E2). */

/** Визначення реєстру модулів (docs/MODULE_DEFINITIONS.md), які рахує цей блок. */
export const PVK_SUMMARY_DEFINITIONS = Object.freeze([
  'legacy:pvk-kpi-au',
  'legacy:pvk-kpi-munitions',
  'legacy:pvk-kpi-affected',
  'legacy:pvk-kpi-recon',
  'legacy:pvk-kpi-affected-percent',
  'legacy:pvk-kpi-objects',
  'legacy:pvk-kpi-expenditure',
]);

const count = value => Number(value) || 0;

/** Частка уражених: Уражено / (Уражено + НЕ уражено), без «Дорозвідується»; немає даних — null. */
export function percentageAffected(affected, notAffected) {
  const numerator = Number(affected) || 0;
  const denominator = numerator + (Number(notAffected) || 0);
  return denominator > 0 ? numerator / denominator * 100 : null;
}

/**
 * Вхід блока за смисловими ролями з моделей аркушів ПВК (summarizeSheet).
 * Відсутній аркуш або показник дає 0. `sumGroup(sheet, name)` — сума віджетів групи аркуша.
 */
export function pvkSummaryInputs({ aa, air, objects } = {}, sumGroup) {
  return {
    aa: {
      au: count(aa?.totals?.['АУ']),
      munitions: count(sumGroup(aa, 'Боєприпаси')),
      affected: count(aa?.totals?.['Уражено']),
      notAffected: count(aa?.totals?.['НЕ уражено']),
    },
    air: {
      au: count(air?.totals?.['АУ']),
      munitions: count(sumGroup(air, 'Боєприпаси')),
      affected: count(air?.totals?.['Уражено']),
      notAffected: count(air?.totals?.['НЕ уражено']),
      reconnaissance: count(air?.totals?.['Дорозвідується']),
    },
    objects: {
      affectedObjects: count(sumGroup(objects, 'Уражені об’єкти')),
      expenditure: count(objects?.totals?.['Витрата']),
    },
  };
}

/** Значення підсумкових карток за період (ключі й порядок — як у summary дашборда ПВК). */
export function computePvkSummary(inputs = {}) {
  const aa = inputs.aa || {};
  const air = inputs.air || {};
  const objects = inputs.objects || {};
  const affected = count(aa.affected) + count(air.affected);
  const notAffected = count(aa.notAffected) + count(air.notAffected);
  const aaMunitions = count(aa.munitions);
  const airMunitions = count(air.munitions);
  return {
    aaAu: count(aa.au),
    airAu: count(air.au),
    totalAu: count(aa.au) + count(air.au),
    aaMunitions,
    airMunitions,
    munitions: aaMunitions + airMunitions,
    affected,
    notAffected,
    reconnaissance: count(air.reconnaissance),
    affectedPercent: percentageAffected(affected, notAffected),
    objects: count(objects.affectedObjects),
    expenditure: count(objects.expenditure),
  };
}
