import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDashboardModel } from '../src/pvk-dashboard-core.js';
import { listDefinitions } from '../src/module-definition-core.js';
import {
  PVK_SUMMARY_DEFINITIONS,
  computePvkSummary,
  percentageAffected,
  pvkSummaryInputs,
} from '../src/module-adapters/pvk-summary-core.js';

// Еталон «до»: формули підсумку з createDashboardModel до E2, скопійовані дослівно.
function sumGroup(sheetModel, groupName) {
  const group = sheetModel?.groups?.find(item => item.name === groupName);
  return group ? group.widgets.reduce((sum, widget) => sum + widget.total, 0) : 0;
}

function legacySummary(aa, air, objects) {
  const affected = (aa?.totals['Уражено'] || 0) + (air?.totals['Уражено'] || 0);
  const notAffected = (aa?.totals['НЕ уражено'] || 0) + (air?.totals['НЕ уражено'] || 0);
  const reconnaissance = air?.totals['Дорозвідується'] || 0;
  const aaMunitions = sumGroup(aa, 'Боєприпаси');
  const airMunitions = sumGroup(air, 'Боєприпаси');
  return {
    aaAu: aa?.totals['АУ'] || 0,
    airAu: air?.totals['АУ'] || 0,
    totalAu: (aa?.totals['АУ'] || 0) + (air?.totals['АУ'] || 0),
    aaMunitions,
    airMunitions,
    munitions: aaMunitions + airMunitions,
    affected,
    notAffected,
    reconnaissance,
    affectedPercent: percentageAffected(affected, notAffected),
    objects: sumGroup(objects, 'Уражені об’єкти'),
    expenditure: objects?.totals['Витрата'] || 0,
  };
}

const SCALAR_KEYS = Object.keys(legacySummary());

function sheet(name, headers, rows) {
  return {
    name,
    headers: ['Дата', ...headers],
    rows: rows.map(([date, values]) => ({ date, values })),
  };
}

// Синтетичні книги: вигадані числа, лише назви стовпців з бази ПВК.
const FULL = {
  sheets: [
    sheet('АА', ['АУ', 'Mi-8', 'ARS-8', 'С-8 ком', 'Уражено', 'НЕ уражено'], [
      ['2026-03-01', { 'АУ': 2, 'Mi-8': 2, 'ARS-8': 10, 'С-8 ком': 4, 'Уражено': 1, 'НЕ уражено': 1 }],
      ['2026-03-02', { 'АУ': 3, 'Mi-8': 3, 'ARS-8': 6, 'С-8 ком': 0, 'Уражено': 3, 'НЕ уражено': 0 }],
      ['2026-03-31', { 'АУ': 1, 'Mi-8': 1, 'ARS-8': 2, 'С-8 ком': 1, 'Уражено': 0, 'НЕ уражено': 1 }],
    ]),
    sheet('ПС', ['АУ', 'Су-25', 'GBU-39', 'Уражено', 'НЕ уражено', 'Дорозвідується'], [
      ['2026-03-01', { 'АУ': 4, 'Су-25': 4, 'GBU-39': 8, 'Уражено': 2, 'НЕ уражено': 1, 'Дорозвідується': 1 }],
      ['2026-03-15', { 'АУ': 1, 'Су-25': 1, 'GBU-39': 2, 'Уражено': 0, 'НЕ уражено': 0, 'Дорозвідується': 1 }],
    ]),
    sheet("Об'єкти", ['ОВТ', 'ППО', 'Склад БК', 'Витрата'], [
      ['2026-03-01', { 'ОВТ': 2, 'ППО': 1, 'Склад БК': 0, 'Витрата': 12 }],
      ['2026-03-31', { 'ОВТ': 1, 'ППО': 0, 'Склад БК': 1, 'Витрата': 3 }],
    ]),
  ],
};

const CASES = [
  ['повна книга, увесь період', FULL, {}],
  ['межа періоду: один перший день', FULL, { from: '2026-03-01', to: '2026-03-01' }],
  ['межа періоду: один останній день', FULL, { from: '2026-03-31', to: '2026-03-31' }],
  ['період без жодного запису', FULL, { from: '2026-05-01', to: '2026-05-31' }],
  ['порожня книга', { sheets: [] }, {}],
  ['без книги', undefined, {}],
  ['лише аркуш АА (немає ПС і «Об’єкти»)', { sheets: [FULL.sheets[0]] }, {}],
  ['немає необовʼязкового стовпця «Дорозвідується» і «Витрата»', {
    sheets: [
      FULL.sheets[0],
      sheet('ПС', ['АУ', 'Уражено', 'НЕ уражено'], [['2026-03-02', { 'АУ': 2, 'Уражено': 1, 'НЕ уражено': 1 }]]),
      sheet("Об'єкти", ['ОВТ'], [['2026-03-02', { 'ОВТ': 3 }]]),
    ],
  }, {}],
  ['нулі всюди', {
    sheets: [
      sheet('АА', ['АУ', 'ARS-8', 'Уражено', 'НЕ уражено'], [['2026-03-01', { 'АУ': 0, 'ARS-8': 0, 'Уражено': 0, 'НЕ уражено': 0 }]]),
      sheet('ПС', ['АУ', 'Уражено', 'НЕ уражено', 'Дорозвідується'], [['2026-03-01', { 'АУ': 0, 'Уражено': 0, 'НЕ уражено': 0, 'Дорозвідується': 0 }]]),
    ],
  }, {}],
  ['невідомі й порожні значення, рядок без дати', {
    sheets: [
      sheet('АА', ['АУ', 'ARS-8', 'Уражено', 'НЕ уражено', 'Невідомий показник'], [
        ['2026-03-01', { 'АУ': 'н/д', 'ARS-8': '', 'Уражено': null, 'НЕ уражено': '2', 'Невідомий показник': 7 }],
        ['', { 'АУ': 5, 'Уражено': 5 }],
        ['2026-03-02', { 'АУ': '3', 'ARS-8': 4 }],
      ]),
    ],
  }, {}],
];

test('E2 ПВК: підсумок через спільне ядро дорівнює еталону «до» для кожного випадку', () => {
  for (const [name, workbook, range] of CASES) {
    const model = createDashboardModel(workbook, range);
    const find = title => model.sheets.find(item => item.name === title);
    const [aa, air, objects] = [find('АА'), find('ПС'), find("Об'єкти")];
    const before = legacySummary(aa, air, objects);
    const after = computePvkSummary(pvkSummaryInputs({ aa, air, objects }, sumGroup));
    assert.deepEqual(after, before, name);
    const fromModel = Object.fromEntries(SCALAR_KEYS.map(key => [key, model.summary[key]]));
    assert.deepEqual(fromModel, before, `${name}: summary дашборда`);
  }
});

test('E2 ПВК: значення повної книги збігаються з ручним підрахунком', () => {
  const { summary } = createDashboardModel(FULL);
  assert.equal(summary.totalAu, 11);
  assert.equal(summary.aaAu, 6);
  assert.equal(summary.airAu, 5);
  assert.equal(summary.aaMunitions, 23);
  assert.equal(summary.airMunitions, 10);
  assert.equal(summary.munitions, 33);
  assert.equal(summary.affected, 6);
  assert.equal(summary.notAffected, 3);
  assert.equal(summary.reconnaissance, 2);
  assert.equal(summary.affectedPercent, 6 / 9 * 100);
  assert.equal(summary.objects, 5);
  assert.equal(summary.expenditure, 15);
});

test('E2 ПВК: порожній вхід дає нулі, а частка уражених — null, не 0', () => {
  const empty = computePvkSummary();
  for (const key of SCALAR_KEYS.filter(key => key !== 'affectedPercent')) assert.equal(empty[key], 0, key);
  assert.equal(empty.affectedPercent, null);
  assert.deepEqual(computePvkSummary(pvkSummaryInputs({}, sumGroup)), empty);
  assert.equal(percentageAffected(0, 3), 0);
  assert.equal(percentageAffected('2', '2'), 50);
});

test('E2 ПВК: блок охоплює картки реєстру, а стара вкладка не рахує підсумок сама', async () => {
  assert.equal(PVK_SUMMARY_DEFINITIONS.length, 7);
  const registry = new Map(listDefinitions().map(item => [item.definitionId, item]));
  for (const id of PVK_SUMMARY_DEFINITIONS) {
    assert.match(id, /^legacy:pvk-kpi-/);
    assert.ok(registry.get(id)?.usedIn.some(use => use.surface === 'pvk'), `${id} немає в реєстрі модулів`);
  }
  const core = await readFile(new URL('../src/pvk-dashboard-core.js', import.meta.url), 'utf8');
  assert.match(core, /computePvkSummary\(pvkSummaryInputs\(\{ aa, air, objects \}, sumGroup\)\)/);
  assert.doesNotMatch(core, /totalAu:/, 'формула підсумку лишилась у старому ядрі');
  const adapter = await readFile(new URL('../src/module-adapters/pvk-summary-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(adapter, /document|window|innerHTML/, 'ядро блока не працює з DOM');
});
