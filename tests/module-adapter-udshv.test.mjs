import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { KPI as CORE_KPI, createDashboardModel, seriesFor } from '../src/udshv-dashboard-core.js';
import { listDefinitions } from '../src/module-definition-core.js';
import { UDSHV_KPI_DEFINITIONS, KPI, computeUdshvKpis } from '../src/module-adapters/udshv-kpi-core.js';

// Еталон «до»: код карток з udshv-dashboard-core.js до E2, скопійований дослівно.
const sumBy = (records, predicate) => {
  let total = 0;
  for (const r of records) for (const [id, v] of Object.entries(r.values)) if (predicate(id)) total += v;
  return total;
};
const inGroup = (group, withTotal = false) => id => id.startsWith(`${group}|`) && (withTotal || id !== 'ammo|ВСЬОГО');
const ammoTotal = records => {
  let total = 0;
  for (const r of records) {
    const own = r.values['ammo|ВСЬОГО'];
    total += own != null ? own : Object.entries(r.values).filter(([id]) => inGroup('ammo')(id)).reduce((s, [, v]) => s + v, 0);
  }
  return total;
};
const LEGACY_KPI = [
  { key: 'kia', label: '200', hint: 'Знищено о/с', tone: 'red', value: rs => sumBy(rs, id => id === 'personnel|200') },
  { key: 'wia', label: '300', hint: 'Поранено о/с', tone: 'amber', value: rs => sumBy(rs, id => id === 'personnel|300') },
  { key: 'personnel', label: 'Втрати о/с разом', hint: '200 + 300', tone: 'violet', value: rs => sumBy(rs, inGroup('personnel')) },
  { key: 'destroyed', label: 'ОВТ знищено', hint: 'одиниць', tone: 'red', value: rs => sumBy(rs, inGroup('destroyed')) },
  { key: 'damaged', label: 'ОВТ пошкоджено', hint: 'одиниць', tone: 'amber', value: rs => sumBy(rs, inGroup('damaged')) },
  { key: 'suppressed', label: 'ОВТ подавлено', hint: 'одиниць', tone: 'blue', value: rs => sumBy(rs, inGroup('suppressed')) },
  { key: 'ammo', label: 'Витрата БК', hint: 'ВСЬОГО', tone: 'green', value: ammoTotal },
  { key: 'vgz', label: 'ВгЗ', hint: 'вогневі завдання', tone: 'blue', value: rs => sumBy(rs, id => id === 'fire|ВгЗ') },
  { key: 'kbb', label: 'КББ', hint: 'контрбатарейна боротьба', tone: 'violet', value: rs => sumBy(rs, id => id === 'fire|КББ') },
];

function legacyKpis({ current, previous, range, bucket }) {
  const hasPrevious = previous.length > 0;
  return LEGACY_KPI.map(k => {
    const total = k.value(current);
    const before = hasPrevious ? k.value(previous) : null;
    return {
      key: k.key, label: k.label, hint: k.hint, tone: k.tone, total, previous: before,
      delta: before == null ? null : total - before,
      deltaPercent: before ? (total - before) / before * 100 : null,
      series: seriesFor(current, range, k.value, bucket),
    };
  });
}

const rec = (date, unit, values) => ({ date, unit, values });
const wb = records => ({ kind: 'udshv', units: [...new Set(records.map(r => r.unit))], records, metrics: [], sheets: [], issues: [] });

// Синтетичні записи: вигадані підрозділи й числа.
const FULL = wb([
  rec('2026-02-27', 'Підрозділ А', { 'personnel|200': 1, 'personnel|300': 2, 'ammo|ВСЬОГО': 10, 'fire|ВгЗ': 3 }),
  rec('2026-03-01', 'Підрозділ А', { 'personnel|200': 2, 'personnel|300': 3, 'destroyed|Танк': 1, 'damaged|БМП': 2, 'suppressed|Міномет': 4, 'ammo|ВСЬОГО': 20, 'fire|ВгЗ': 5, 'fire|КББ': 1 }),
  rec('2026-03-01', 'Підрозділ Б', { 'personnel|200': 0, 'personnel|300': 1, 'ammo|122': 7, 'ammo|152': 3, 'fire|КББ': 2 }),
  rec('2026-03-02', 'Підрозділ Б', { 'personnel|200': 4, 'destroyed|Танк': 2, 'destroyed|БМП': 1, 'ammo|ВСЬОГО': 0 }),
  rec('2026-03-15', 'Підрозділ А', { 'personnel|300': 5, 'suppressed|Міномет': 1 }),
  rec('2026-03-31', 'Підрозділ А', {}),
]);

const CASES = [
  ['повна книга, увесь період', FULL, {}],
  ['місяць із попереднім місяцем', FULL, { range: { from: '2026-03-01', to: '2026-03-31' }, preset: 'month' }],
  ['тиждень без попереднього періоду', FULL, { range: { from: '2026-03-01', to: '2026-03-07' }, preset: 'week' }],
  ['один день', FULL, { range: { from: '2026-03-02', to: '2026-03-02' }, preset: 'custom' }],
  ['період без записів', FULL, { range: { from: '2026-05-01', to: '2026-05-31' }, preset: 'month' }],
  ['фільтр одного підрозділу', FULL, { range: { from: '2026-03-01', to: '2026-03-31' }, preset: 'month', unit: 'Підрозділ Б' }],
  ['довгий період — тижневі ряди', wb(Array.from({ length: 120 }, (_, i) => rec(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), i % 2 ? 'А' : 'Б', { 'personnel|200': i % 5, 'ammo|ВСЬОГО': i, 'fire|ВгЗ': 1 }))), {}],
  ['порожня книга', wb([]), {}],
  ['нулі й нульове попереднє значення', wb([
    rec('2026-03-01', 'А', { 'personnel|200': 0, 'ammo|ВСЬОГО': 0 }),
    rec('2026-03-02', 'А', { 'personnel|200': 3 }),
  ]), { range: { from: '2026-03-02', to: '2026-03-02' }, preset: 'custom' }],
];

test('E2 УДШВ: картки через спільне ядро дорівнюють еталону «до» для кожного випадку', () => {
  for (const [name, workbook, options] of CASES) {
    const model = createDashboardModel(workbook, options);
    const scoped = (workbook?.records || []).filter(r => !options.unit || r.unit === options.unit);
    const inRange = r => (!model.range.from || r.date >= model.range.from) && (!model.range.to || r.date <= model.range.to);
    const prev = model.previousRange;
    const previous = prev.from ? scoped.filter(r => (!prev.from || r.date >= prev.from) && (!prev.to || r.date <= prev.to)) : [];
    const input = { current: scoped.filter(inRange), previous, range: model.range, bucket: model.bucket };
    const before = legacyKpis(input);
    assert.deepEqual(model.kpis, before, name);
    assert.deepEqual(computeUdshvKpis(input, seriesFor), before, `${name}: ядро карток`);
  }
});

test('E2 УДШВ: значення повної книги збігаються з ручним підрахунком', () => {
  const { kpis } = createDashboardModel(FULL, { range: { from: '2026-03-01', to: '2026-03-31' }, preset: 'month' });
  const byKey = Object.fromEntries(kpis.map(k => [k.key, k]));
  assert.equal(byKey.kia.total, 6);
  assert.equal(byKey.wia.total, 9);
  assert.equal(byKey.personnel.total, 15);
  assert.equal(byKey.destroyed.total, 4);
  assert.equal(byKey.damaged.total, 2);
  assert.equal(byKey.suppressed.total, 5);
  // «ВСЬОГО» береться з таблиці (20), а де його немає — сума типів (7 + 3); явний нуль «ВСЬОГО» лишається нулем.
  assert.equal(byKey.ammo.total, 30);
  assert.equal(byKey.vgz.total, 5);
  assert.equal(byKey.kbb.total, 3);
  // Попередній місяць (лютий): лише запис 27.02.
  assert.equal(byKey.kia.previous, 1);
  assert.equal(byKey.kia.delta, 5);
  assert.equal(byKey.kia.deltaPercent, 500);
});

test('E2 УДШВ: порожній вхід дає нулі без попереднього періоду, а ділення на нуль — null', () => {
  const { kpis } = createDashboardModel(wb([]), {});
  assert.equal(kpis.length, 9);
  for (const k of kpis) {
    assert.equal(k.total, 0, k.key);
    assert.equal(k.previous, null, k.key);
    assert.equal(k.delta, null, k.key);
    assert.equal(k.deltaPercent, null, k.key);
  }
  const zero = createDashboardModel(CASES[8][1], CASES[8][2]).kpis.find(k => k.key === 'kia');
  assert.equal(zero.total, 3);
  assert.equal(zero.previous, 0);
  assert.equal(zero.deltaPercent, null);
});

test('E2 УДШВ: блок охоплює дев’ять карток реєстру, а старе ядро не має власних формул карток', async () => {
  assert.equal(UDSHV_KPI_DEFINITIONS.length, 9);
  assert.equal(CORE_KPI, KPI, 'KPI ядра УДШВ — масив спільного ядра');
  assert.deepEqual(KPI.map(k => `legacy:udshv-kpi-${k.key}`), [...UDSHV_KPI_DEFINITIONS]);
  const registry = new Map(listDefinitions().map(item => [item.definitionId, item]));
  for (const id of UDSHV_KPI_DEFINITIONS) assert.ok(registry.get(id)?.usedIn.some(use => use.surface === 'dshv'), `${id} немає в реєстрі модулів`);
  const core = await readFile(new URL('../src/udshv-dashboard-core.js', import.meta.url), 'utf8');
  assert.match(core, /computeUdshvKpis\(\{ current, previous, range, bucket \}, seriesFor\)/);
  assert.doesNotMatch(core, /key: 'kia'|const ammoTotal/, 'формули карток лишились у старому ядрі');
  const adapter = await readFile(new URL('../src/module-adapters/udshv-kpi-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(adapter, /document|window|innerHTML|^import /m, 'ядро блока не працює з DOM і нічого не імпортує (без циклічного імпорту зі старим ядром)');
});
