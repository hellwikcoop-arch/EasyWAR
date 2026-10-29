import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, parseLayout, serializeLayout } from '../src/module-instance-core.js';
import { ensureModuleInstances, forgetModuleInstances } from '../src/module-instance-modules-core.js';
import {
  clearRelations, confirmRelation, groupsOf, parseSchema, relationsOf, rejectRelation, serializeSchema, setGroups,
  emptySchema, relatedSources,
} from '../src/profile-schema-core.js';
import { forgetModuleSource, syncModuleSources } from '../src/profile-schema-modules-core.js';
import { linkIssues, suggestRelations } from '../src/table-link-core.js';
import {
  confirmArgs, decisionOf, deleteLinksNote, linkInputs, relatedLine, suggestedGroups,
} from '../src/table-link-view-core.js';

// Контрольна точка E3б (docs/MODULES_ROADMAP.md): три таблиці → пошук ключів → підтвердження зв'язків → групи →
// видалення модуля → розкладка «Мого дашборда» (E4) і решта зв'язків цілі. Лише синтетичні дані; без DOM, бази й Tauri.

const field = (key, label, dataType = 'text', position = 0) => ({ key, label, dataType, position });
const date = field('date', 'Дата', 'date', 0);
const unit = field('unit', 'Підрозділ', 'text', 1);
const MODULES = [
  { id: 'plan', title: 'План', templateId: 'custom', fields: [date, unit, field('goal', 'Ціль', 'text', 2)] },
  { id: 'flights', title: 'Вильоти', templateId: 'custom', fields: [date, unit, field('tail', 'Борт', 'text', 2)] },
  { id: 'stock', title: 'Склад', templateId: 'custom', fields: [date, unit, field('item', 'Позиція', 'text', 2)] },
  { id: 'lonely', title: 'Окрема', templateId: 'custom', fields: [field('a', 'Перша', 'text', 0), field('b', 'Друга', 'text', 1)] },
];
const UNITS = ['Альфа', 'Браво', 'Чарлі', 'Дельта'];
const day = n => `2026-09-${String(1 + n).padStart(2, '0')}`;

function data() {
  const plan = [];
  const flights = [];
  const stock = [];
  for (let d = 0; d < 6; d += 1) for (const name of UNITS) {
    plan.push({ date: day(d), unit: name, goal: `ціль-${d}-${name}` });
    stock.push({ date: day(d), unit: name, item: `позиція-${d}-${name}` });
    for (let k = 0; k < 2; k += 1) flights.push({ date: day(d), unit: name, tail: `борт-${flights.length}` });
  }
  const lonely = Array.from({ length: 5 }, (_, i) => ({ a: `x${i}`, b: `y${i * 7}` }));
  return new Map([['plan', { rows: plan }], ['flights', { rows: flights }], ['stock', { rows: stock }], ['lonely', { rows: lonely }]]);
}

const must = result => { assert.ok(result.ok, JSON.stringify(result)); return result; };
const keySides = (l, r) => ({ left: { sourceId: l, columns: ['date', 'unit'] }, right: { sourceId: r, columns: ['date', 'unit'] } });

test('контрольна точка E3б: від трьох таблиць до груп і видалення модуля, розкладка E4 і чужі зв’язки цілі', async () => {
  let schema = must(syncModuleSources(emptySchema('profile-e3b'), MODULES)).schema;
  let layout = must(ensureModuleInstances(emptyLayout('profile-e3b'), MODULES)).layout;
  assert.equal(layout.instances.length, 4);

  // Пошук ключів: пари план↔вильоти, план↔склад, вильоти↔склад мають кандидата «Дата + Підрозділ».
  const inputs = linkInputs(schema, MODULES, data());
  assert.equal(inputs.tables.length, 4);
  const found = must(await suggestRelations(inputs.tables));
  const byId = new Map(inputs.tables.map(table => [table.sourceId, table]));
  const candidateOf = (a, b) => {
    const pair = found.pairs.find(item => [item.leftId, item.rightId].sort().join() === [a, b].sort().join());
    assert.ok(pair?.candidates.length, `${a} ↔ ${b}: кандидата немає`);
    const candidate = pair.candidates.find(item => item.left.columns.length === 2);
    assert.ok(candidate, `${a} ↔ ${b}: немає ключа «Дата + Підрозділ»`);
    assert.ok(Array.isArray(linkIssues(byId.get(pair.leftId), byId.get(pair.rightId), candidate)));
    return candidate;
  };

  // Людина підтверджує дві пари й відхиляє третю.
  const planFlights = candidateOf('module:plan', 'module:flights');
  schema = must(confirmRelation(schema, confirmArgs(planFlights, { at: '2026-10-29T12:00:00Z' }))).schema;
  schema = must(confirmRelation(schema, confirmArgs(candidateOf('module:plan', 'module:stock')))).schema;
  schema = must(rejectRelation(schema, keySides('module:flights', 'module:stock'))).schema;
  assert.equal(decisionOf(schema, planFlights).state, 'confirmed');
  assert.equal(relationsOf(schema).filter(item => item.status === 'confirmed').length, 2);
  assert.match(relatedLine(schema, 'module:plan'), /Вильоти.*Склад|Склад.*Вильоти/u);
  assert.equal(relatedSources(schema, 'module:lonely').length, 0);

  // «Розділити по ключах»: одна група з трьох, окрема таблиця поза групами.
  const groups = suggestedGroups(schema);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sourceIds, ['module:flights', 'module:plan', 'module:stock']);
  schema = must(setGroups(schema, groups)).schema;

  // Збереження й читання: схема ціла, значень клітинок у ній немає.
  const text = serializeSchema(schema);
  const back = must(parseSchema(text)).schema;
  assert.equal(serializeSchema(back), text);
  for (const name of UNITS) assert.ok(!text.includes(name), `значення «${name}» у схемі`);
  assert.ok(!/ціль-|борт-|позиція-/u.test(text));

  // Попередження перед видаленням називає зв'язки; видалення «Плану» прибирає обидва зв'язки, групу з трьох розпускає.
  assert.match(deleteLinksNote(schema, 'module:plan'), /«Вильоти».*«Склад»|«Склад».*«Вильоти»/u);
  const removed = forgetModuleSource(schema, 'plan');
  must(removed);
  assert.equal(removed.removedRelations.length, 2);
  assert.deepEqual(removed.dissolvedGroups, groups.map(group => group.id));
  // Відхилення пари вильоти↔склад (не торкається «Плану») лишається.
  assert.deepEqual(relationsOf(removed.schema).map(item => item.status), ['rejected']);
  assert.deepEqual(groupsOf(removed.schema), []);

  // Розкладка E4: картки інших модулів на місці й читаються; «План» зникає разом зі своїми картками.
  const trimmed = must(forgetModuleInstances(layout, 'plan')).layout;
  assert.deepEqual(trimmed.instances.map(item => item.sourceId).sort(), ['module:flights', 'module:lonely', 'module:stock']);
  assert.ok(parseLayout(serializeLayout(trimmed)).ok);

  // «Скинути зв'язки» лишає таблиці й ролі.
  const reset = must(clearRelations(schema)).schema;
  assert.deepEqual([relationsOf(reset), groupsOf(reset), reset.sources.length], [[], [], 4]);
});

test('контрольна точка E3б: схема без зв’язків (старий формат) читається, зберігається без змін і приймає перший зв’язок', async () => {
  const schema = must(syncModuleSources(emptySchema('profile-old'), MODULES)).schema;
  assert.equal('relations' in schema, false);
  const text = serializeSchema(schema);
  assert.equal(serializeSchema(must(parseSchema(text)).schema), text);
  const next = must(confirmRelation(schema, { ...keySides('module:plan', 'module:flights'), cardinality: 'one-many', basis: 'values' })).schema;
  assert.ok(parseSchema(serializeSchema(next)).ok);
  assert.equal(relationsOf(schema).length, 0);
});
