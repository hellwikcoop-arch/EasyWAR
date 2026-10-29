import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYOUT_FORMAT, MAX_COPIES, emptyLayout, addInstance, duplicateInstance, removeInstance, updateInstance, rebindInstance,
  placeInstance, setSharedPeriod, effectivePeriod, normalizePeriod, instanceState, sourceConsistency, copiesOf,
  serializeLayout, parseLayout, SIZE_CHOICES, orderedIds, moveInstance, resizeInstance,
} from '../src/module-instance-core.js';
import { emptySchema, addSource, confirmBinding } from '../src/profile-schema-core.js';

// Лише синтетичні заголовки, ідентифікатори й дати.
const COLUMNS = [
  { key: 'c_date', header: 'Дата', type: 'date' },
  { key: 'c_count', header: 'К-сть БП', type: 'number' },
];
const DEFINITIONS = [
  { definitionId: 'by-day', requirements: [{ role: 'event-date', required: true }, { role: 'munition-count', required: false }] },
  { definitionId: 'by-count', requirements: [{ role: 'munition-count', required: true }] },
];

function schemaWithSources(ids = ['src-1']) {
  let schema = emptySchema('profile-a');
  for (const id of ids) {
    const added = addSource(schema, { id, type: 'module-table', ref: id, title: id, columns: COLUMNS });
    assert.ok(added.ok);
    schema = added.schema;
  }
  return schema;
}

function layoutWith(...specs) {
  let layout = emptyLayout('profile-a');
  for (const spec of specs) {
    const added = addInstance(layout, spec);
    assert.ok(added.ok, added.message);
    layout = added.layout;
  }
  return layout;
}

test('порожня розкладка: формат, профіль, нульова ревізія, заморожена', () => {
  const layout = emptyLayout('profile-a');
  assert.equal(layout.format, LAYOUT_FORMAT);
  assert.equal(layout.revision, 0);
  assert.ok(Object.isFrozen(layout) && Object.isFrozen(layout.instances));
  assert.throws(() => emptyLayout(''), TypeError);
});

test('додавання картки: екземпляр і розміщення під наявними, вхідна розкладка не змінюється', () => {
  const empty = emptyLayout('profile-a');
  const one = addInstance(empty, { definitionId: 'by-day', sourceId: 'src-1', size: { w: 6, h: 3 } });
  assert.ok(one.ok);
  assert.equal(one.instanceId, 'by-day#1');
  assert.equal(empty.instances.length, 0);
  const two = addInstance(one.layout, { definitionId: 'by-count', sourceId: 'src-1' });
  assert.deepEqual(two.layout.placements.map(p => [p.instanceId, p.y]), [['by-day#1', 0], ['by-count#1', 3]]);
  assert.equal(two.layout.revision, 2);
});

test('до чотирьох копій одного модуля, п’ята відхиляється', () => {
  let layout = layoutWith(...Array.from({ length: MAX_COPIES }, () => ({ definitionId: 'by-day', sourceId: 'src-1' })));
  assert.equal(copiesOf(layout, 'by-day'), MAX_COPIES);
  const fifth = addInstance(layout, { definitionId: 'by-day', sourceId: 'src-1' });
  assert.equal(fifth.code, 'too_many_copies');
  layout = removeInstance(layout, 'by-day#2').layout;
  assert.equal(addInstance(layout, { definitionId: 'by-day', sourceId: 'src-1' }).instanceId, 'by-day#2');
});

test('копії одного модуля мають незалежні період, стиль і позицію', () => {
  let layout = layoutWith({ definitionId: 'by-day', sourceId: 'src-1', title: 'Пуски' });
  layout = duplicateInstance(layout, 'by-day#1').layout;
  layout = updateInstance(layout, 'by-day#1', { period: { mode: 'last-days', days: 7 }, style: { accent: 'gold' } }).layout;
  layout = updateInstance(layout, 'by-day#2', { period: { mode: 'range', from: '2026-01-01', to: '2026-01-31' }, title: 'Січень' }).layout;
  layout = placeInstance(layout, 'by-day#2', { x: 6, y: 0, w: 6, h: 4 }).layout;
  const [a, b] = layout.instances;
  assert.deepEqual(a.period, { mode: 'last-days', days: 7 });
  assert.equal(a.style.accent, 'gold');
  assert.equal(b.style.accent, '');
  assert.equal(b.title, 'Січень');
  assert.deepEqual(layout.placements.find(p => p.instanceId === 'by-day#2'), { instanceId: 'by-day#2', x: 6, y: 0, w: 6, h: 4 });
  assert.equal(a.sourceId, b.sourceId);
});

test('періоди: некоректні межі й режими відхиляються', () => {
  assert.equal(normalizePeriod({ mode: 'range', from: '2026-02-30', to: '2026-03-01' }), null);
  assert.equal(normalizePeriod({ mode: 'range', from: '2026-03-02', to: '2026-03-01' }), null);
  assert.equal(normalizePeriod({ mode: 'last-days', days: 0 }), null);
  assert.equal(normalizePeriod({ mode: 'last-days', days: 1.5 }), null);
  assert.equal(normalizePeriod({ mode: 'вічно' }), null);
  assert.deepEqual(normalizePeriod(undefined), { mode: 'shared' });
  const layout = layoutWith({ definitionId: 'by-day', sourceId: 'src-1' });
  assert.equal(updateInstance(layout, 'by-day#1', { period: { mode: 'last-days', days: -3 } }).code, 'bad_period');
  assert.equal(addInstance(layout, { definitionId: 'by-count', sourceId: 'src-1', period: { mode: 'range', from: 'x', to: 'y' } }).code, 'bad_period');
});

test('діючий період: спільна панель діє на shared, власний період — ні', () => {
  let layout = layoutWith({ definitionId: 'by-day', sourceId: 'src-1' }, { definitionId: 'by-count', sourceId: 'src-1', period: { mode: 'last-days', days: 3 } });
  layout = setSharedPeriod(layout, { mode: 'range', from: '2026-05-01', to: '2026-05-31' }).layout;
  assert.deepEqual(effectivePeriod(layout, 'by-day#1', '2026-06-10'), { ok: true, from: '2026-05-01', to: '2026-05-31', own: false });
  assert.deepEqual(effectivePeriod(layout, 'by-count#1', '2026-06-10'), { ok: true, from: '2026-06-08', to: '2026-06-10', own: true });
  // межа через кінець місяця й високосний рік
  assert.equal(effectivePeriod(updateInstance(layout, 'by-count#1', { period: { mode: 'last-days', days: 3 } }).layout, 'by-count#1', '2028-03-01').from, '2028-02-28');
  assert.equal(effectivePeriod(layout, 'by-count#1', 'вчора').code, 'bad_today');
  assert.equal(setSharedPeriod(layout, { mode: 'shared' }).code, 'bad_period');
  assert.deepEqual(effectivePeriod(setSharedPeriod(layout, { mode: 'all' }).layout, 'by-day#1', '2026-06-10'), { ok: true, from: null, to: null, own: false });
});

test('розміщення: за межами сітки й дробові значення відхиляються', () => {
  const layout = layoutWith({ definitionId: 'by-day', sourceId: 'src-1' });
  assert.equal(placeInstance(layout, 'by-day#1', { x: 10, y: 0, w: 4, h: 2 }).code, 'bad_placement');
  assert.equal(placeInstance(layout, 'by-day#1', { x: 0, y: 0, w: 0, h: 2 }).code, 'bad_placement');
  assert.equal(placeInstance(layout, 'by-day#1', { x: 0.5, y: 0, w: 2, h: 2 }).code, 'bad_placement');
  assert.equal(placeInstance(layout, 'нема', { x: 0, y: 0, w: 2, h: 2 }).code, 'unknown_instance');
  assert.equal(addInstance(emptyLayout('profile-a'), { definitionId: 'by-day', sourceId: 'src-1', size: { w: 13, h: 1 } }).code, 'bad_size');
});

test('вилучення картки прибирає і її розміщення; інші не зачіпає', () => {
  let layout = layoutWith({ definitionId: 'by-day', sourceId: 'src-1' }, { definitionId: 'by-count', sourceId: 'src-1' });
  layout = removeInstance(layout, 'by-day#1').layout;
  assert.deepEqual(layout.instances.map(i => i.id), ['by-count#1']);
  assert.deepEqual(layout.placements.map(p => p.instanceId), ['by-count#1']);
  assert.equal(removeInstance(layout, 'by-day#1').code, 'unknown_instance');
});

test('усі картки одного джерела бачать одну підтверджену версію та ролі', () => {
  let schema = schemaWithSources(['src-1', 'src-2']);
  let layout = layoutWith(
    { definitionId: 'by-day', sourceId: 'src-1' },
    { definitionId: 'by-day', sourceId: 'src-1', period: { mode: 'last-days', days: 7 } },
    { definitionId: 'by-count', sourceId: 'src-1' },
    { definitionId: 'by-count', sourceId: 'src-2' },
  );
  let states = layout.instances.map(i => instanceState(layout, schema, i.id, DEFINITIONS));
  assert.deepEqual(states.map(s => s.status), ['missing', 'missing', 'missing', 'missing']);
  assert.deepEqual(states[0].missing, ['Дата події']);

  schema = confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }).schema;
  schema = confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_count', role: 'munition-count', unit: 'пуски' }).schema;
  states = layout.instances.map(i => instanceState(layout, schema, i.id, DEFINITIONS));
  assert.deepEqual(states.map(s => s.status), ['available', 'available', 'available', 'missing']);
  assert.equal(states[0].sourceVersion, states[1].sourceVersion);
  assert.equal(states[0].sourceVersion, states[2].sourceVersion);
  assert.deepEqual(states[0].roles, states[2].roles);
  assert.equal(states[3].sourceVersion, 1);

  const report = sourceConsistency(layout, schema, DEFINITIONS);
  assert.deepEqual(report.map(r => [r.sourceId, r.consistent, r.instances.length]), [['src-1', true, 3], ['src-2', true, 1]]);
});

test('стан картки: джерела немає або визначення невідоме — прямо кажемо, не вгадуємо', () => {
  const schema = schemaWithSources();
  let layout = layoutWith({ definitionId: 'by-day', sourceId: 'src-1' }, { definitionId: 'other', sourceId: 'src-1' });
  layout = rebindInstance(layout, 'by-day#1', 'зниклий').layout;
  assert.equal(instanceState(layout, schema, 'by-day#1', DEFINITIONS).status, 'source-missing');
  assert.equal(instanceState(layout, schema, 'other#1', DEFINITIONS).status, 'unknown-definition');
  assert.equal(instanceState(layout, schema, 'нема', DEFINITIONS).code, 'unknown_instance');
  assert.equal(rebindInstance(layout, 'by-day#1', '  ').code, 'bad_source');
});

test('серіалізація й читання: повний круг, чужі й новіші формати відхиляються', () => {
  let layout = layoutWith({ definitionId: 'by-day', sourceId: 'src-1', title: 'Пуски' });
  layout = duplicateInstance(layout, 'by-day#1').layout;
  const read = parseLayout(serializeLayout(layout));
  assert.ok(read.ok);
  assert.deepEqual(read.layout, layout);

  const mutate = change => { const copy = structuredClone(layout); change(copy); return parseLayout(copy); };
  assert.equal(parseLayout('{').errors[0].code, 'bad_json');
  assert.equal(mutate(l => { l.format = 'x'; }).errors[0].code, 'bad_format');
  assert.equal(mutate(l => { l.version = 2; }).errors[0].code, 'unsupported_version');
  assert.equal(mutate(l => { l.placements.pop(); }).errors[0].code, 'missing_placement');
  assert.equal(mutate(l => { l.placements.push({ instanceId: 'ghost', x: 0, y: 0, w: 1, h: 1 }); }).errors[0].code, 'unknown_instance');
  assert.equal(mutate(l => { l.instances[0].period = { mode: 'range', from: '2026-02-01', to: '2026-01-01' }; }).errors[0].code, 'bad_period');
  assert.equal(mutate(l => { l.sharedPeriod = { mode: 'shared' }; }).errors[0].code, 'bad_period');
  assert.equal(mutate(l => { l.placements[0].w = 99; }).errors[0].code, 'bad_placement');
  const crowded = mutate(l => { for (let n = 0; n < 4; n += 1) { l.instances.push({ ...l.instances[0], id: `x${n}` }); l.placements.push({ instanceId: `x${n}`, x: 0, y: 0, w: 1, h: 1 }); } });
  assert.equal(crowded.errors[0].code, 'too_many_copies');
});

const four = () => layoutWith(...['a', 'b', 'c', 'd'].map(id => ({ definitionId: 'by-day', sourceId: `src-${id}`, id, size: { w: 6, h: 3 } })));

test('картки лягають рядками: дві половини в ряд, наступна — нижче', () => {
  const layout = four();
  const packedLayout = resizeInstance(layout, 'a', 6).layout;
  assert.deepEqual(orderedIds(packedLayout), ['a', 'b', 'c', 'd']);
  assert.deepEqual(SIZE_CHOICES.map(item => item.w), [4, 6, 8, 12]);
});

test('переставлення: вперед — після цілі, назад — перед нею, решта зсувається й кладеться рядками', () => {
  const layout = four();
  const forward = moveInstance(layout, 'a', 'c');
  assert.ok(forward.ok);
  assert.deepEqual(orderedIds(forward.layout), ['b', 'c', 'a', 'd']);
  const back = moveInstance(forward.layout, 'd', 'b');
  assert.deepEqual(orderedIds(back.layout), ['d', 'b', 'c', 'a']);
  const place = Object.fromEntries(back.layout.placements.map(p => [p.instanceId, [p.x, p.y]]));
  assert.deepEqual(place, { d: [0, 0], b: [6, 0], c: [0, 3], a: [6, 3] });
  assert.equal(back.layout.revision, layout.revision + 2);
});

test('переставлення на себе нічого не змінює, чужі й відсутні картки відхиляються', () => {
  const layout = four();
  const same = moveInstance(layout, 'a', 'a');
  assert.ok(same.ok);
  assert.equal(same.layout.revision, layout.revision);
  assert.equal(moveInstance(layout, 'x', 'a').code, 'unknown_instance');
  assert.equal(moveInstance(layout, 'a', 'x').code, 'unknown_instance');
});

test('розмір: ширина змінюється, порядок зберігається, ряд перекладається', () => {
  const layout = four();
  const wide = resizeInstance(layout, 'a', 12);
  assert.ok(wide.ok);
  assert.deepEqual(orderedIds(wide.layout), ['a', 'b', 'c', 'd']);
  const place = Object.fromEntries(wide.layout.placements.map(p => [p.instanceId, [p.x, p.y, p.w]]));
  assert.deepEqual(place, { a: [0, 0, 12], b: [0, 3, 6], c: [6, 3, 6], d: [0, 6, 6] });
  const same = resizeInstance(layout, 'a', 6);
  assert.equal(same.layout.revision, layout.revision);
  for (const bad of [0, 13, 2.5, '6', null]) assert.equal(resizeInstance(layout, 'a', bad).code, 'bad_size');
  assert.equal(resizeInstance(layout, 'нема', 6).code, 'unknown_instance');
});

test('перекладена розкладка проходить перевірку читання', () => {
  let layout = moveInstance(four(), 'a', 'd').layout;
  layout = resizeInstance(layout, 'b', 8).layout;
  assert.ok(parseLayout(serializeLayout(layout)).ok);
});
