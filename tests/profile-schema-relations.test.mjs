import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS, emptySchema, addSource, updateSourceColumns, removeSource, confirmBinding, columnDependents,
  serializeSchema, parseSchema, relationId, relationsOf, groupsOf, confirmRelation, rejectRelation, clearRelation,
  clearRelations, setGroups, relatedSources, staleRelations,
} from '../src/profile-schema-core.js';
import { listDefinitions } from '../src/module-definition-core.js';

// Лише синтетичні імена стовпців.
const COLS = [
  { key: 'k', header: 'Код', type: 'text' },
  { key: 'k2', header: 'Код 2', type: 'text' },
  { key: 'n', header: 'Кількість', type: 'number' },
];
const must = result => { assert.ok(result.ok, JSON.stringify(result)); return result.schema; };
const side = (sourceId, ...columns) => ({ sourceId, columns });

function three() {
  let schema = emptySchema('profile-a');
  for (const id of ['a', 'b', 'c']) {
    schema = must(addSource(schema, { id, type: 'module-table', ref: `m-${id}`, title: `Таблиця ${id}`, columns: COLS }));
  }
  return schema;
}
const link = (schema, l, r, extra = {}) => confirmRelation(schema, { left: side(l, 'k'), right: side(r, 'k'), cardinality: 'one-many', basis: 'values', ...extra });

test('стара схема без зв’язків читається й не переписується', () => {
  const schema = three();
  assert.equal('relations' in schema, false);
  assert.equal('groups' in schema, false);
  const text = serializeSchema(schema);
  const back = parseSchema(text);
  assert.ok(back.ok);
  assert.equal(serializeSchema(back.schema), text);
  assert.deepEqual(relationsOf(back.schema), []);
  assert.deepEqual(groupsOf(back.schema), []);
});

test('підтвердження зв’язку: запис, ревізія, незмінність входу, обіг через збереження', () => {
  const schema = three();
  const next = must(link(schema, 'a', 'b', { at: '2026-10-29T10:00:00Z' }));
  assert.equal(schema.revision + 1, next.revision);
  assert.equal(relationsOf(schema).length, 0);
  const [relation] = relationsOf(next);
  assert.equal(relation.status, 'confirmed');
  assert.equal(relation.cardinality, 'one-many');
  assert.deepEqual(relation.types, { left: ['text'], right: ['text'] });
  assert.deepEqual(relation.versions, { left: 1, right: 1 });
  assert.equal(relation.decidedAtRevision, next.revision);
  const round = parseSchema(serializeSchema(next));
  assert.ok(round.ok, JSON.stringify(round.errors));
  assert.deepEqual(round.schema, next);
  assert.ok(Object.isFrozen(round.schema.relations[0]));
});

test('id зв’язку не залежить від порядку таблиць', () => {
  assert.equal(relationId(side('a', 'k'), side('b', 'k')), relationId(side('b', 'k'), side('a', 'k')));
  assert.notEqual(relationId(side('a', 'k'), side('b', 'k')), relationId(side('a', 'k2'), side('b', 'k')));
  const schema = three();
  const one = must(link(schema, 'a', 'b'));
  const again = must(link(one, 'b', 'a'));
  assert.equal(relationsOf(again).length, 1);
});

test('одна пара таблиць — один підтверджений ключ; replace заміщує', () => {
  const first = must(link(three(), 'a', 'b'));
  const other = confirmRelation(first, { left: side('a', 'k2'), right: side('b', 'k2'), cardinality: 'one-one', basis: 'roles' });
  assert.equal(other.ok, false);
  assert.equal(other.code, 'pair_taken');
  const replaced = must(confirmRelation(first, { left: side('a', 'k2'), right: side('b', 'k2'), cardinality: 'one-one', basis: 'roles', replace: true }));
  assert.equal(relationsOf(replaced).length, 1);
  assert.deepEqual(relationsOf(replaced)[0].left.columns, ['k2']);
});

test('«багато до багатьох» лише вручну й із застереженням', () => {
  const schema = three();
  const many = extra => confirmRelation(schema, { left: side('a', 'k'), right: side('b', 'k'), cardinality: 'many-many', basis: 'manual', ...extra });
  assert.equal(many({}).code, 'many_many_unconfirmed');
  assert.equal(many({ basis: 'values', acceptManyToMany: true }).code, 'many_many_unconfirmed');
  assert.equal(many({ acceptManyToMany: 'так' }).code, 'many_many_unconfirmed');
  const ok = must(many({ acceptManyToMany: true }));
  assert.equal(relationsOf(ok)[0].cardinality, 'many-many');
});

test('погані вхідні дані зв’язку відхиляються з кодом', () => {
  const schema = three();
  const code = args => confirmRelation(schema, { cardinality: 'one-many', basis: 'values', ...args }).code;
  assert.equal(code({ left: side('a', 'k'), right: side('a', 'k2') }), 'same_source');
  assert.equal(code({ left: side('a', 'k'), right: side('zzz', 'k') }), 'unknown_source');
  assert.equal(code({ left: side('a', 'k'), right: side('b', 'nope') }), 'unknown_column');
  assert.equal(code({ left: side('a', 'k', 'k2'), right: side('b', 'k') }), 'bad_relation_columns');
  assert.equal(code({ left: side('a'), right: side('b') }), 'bad_relation_columns');
  assert.equal(code({ left: side('a', 'k', 'k'), right: side('b', 'k', 'k2') }), 'bad_relation_columns');
  assert.equal(code({ left: side('a', 'k', 'k2', 'n', 'k'), right: side('b', 'k', 'k2', 'n', 'k') }), 'bad_relation_columns');
  assert.equal(code({ left: side('a', 'k'), right: side('b', 'k'), cardinality: 'wrong' }), 'bad_cardinality');
  assert.equal(code({ left: side('a', 'k'), right: side('b', 'k'), basis: 'guess' }), 'bad_basis');
  // складений ключ з трьох стовпців допустимий
  const triple = confirmRelation(schema, { left: side('a', 'k', 'k2', 'n'), right: side('b', 'k', 'k2', 'n'), cardinality: 'one-one', basis: 'values' });
  assert.ok(triple.ok);
});

test('відхилення зв’язку: пара не пропонується; підтверджений зв’язок цієї пари ключів знімається', () => {
  const linked = must(link(three(), 'a', 'b'));
  const rejected = must(rejectRelation(linked, { left: side('b', 'k'), right: side('a', 'k') }));
  const [only] = relationsOf(rejected);
  assert.equal(relationsOf(rejected).length, 1);
  assert.equal(only.status, 'rejected');
  assert.equal(staleRelations(rejected).length, 0);
  assert.deepEqual(relatedSources(rejected, 'a'), []);
  // відхилення не займає пару: інший ключ можна підтвердити
  const other = must(confirmRelation(rejected, { left: side('a', 'k2'), right: side('b', 'k2'), cardinality: 'one-one', basis: 'values' }));
  assert.equal(relationsOf(other).filter(item => item.status === 'confirmed').length, 1);
});

test('зняття рішення й «Скинути зв’язки»; без змін — та сама ревізія', () => {
  const a = must(link(three(), 'a', 'b'));
  const b = must(link(a, 'b', 'c'));
  const id = relationsOf(b)[0].id;
  const cleared = must(clearRelation(b, id));
  assert.equal(relationsOf(cleared).length, 1);
  assert.equal(must(clearRelation(cleared, 'rel:nope')).revision, cleared.revision);
  const reset = must(clearRelations(b));
  assert.deepEqual(reset.relations, []);
  assert.deepEqual(reset.groups, []);
  assert.equal(reset.sources.length, 3);
  assert.equal(must(clearRelations(three())).revision, three().revision);
});

test('групи: лише зв’язані таблиці, одна таблиця — одна група, розпуск після зняття зв’язку', () => {
  const chain = must(link(must(link(three(), 'a', 'b')), 'b', 'c'));
  const all = must(setGroups(chain, [{ id: 'g1', title: 'Усі', sourceIds: ['a', 'b', 'c'] }]));
  assert.equal(groupsOf(all).length, 1);
  // група має бути зв'язною сама по собі: a і c пов'язані лише через b, якого в групі немає
  assert.equal(setGroups(chain, [{ id: 'g1', title: 'x', sourceIds: ['a', 'c'] }]).code, 'group_not_connected');
  const lonely = must(link(three(), 'a', 'b'));
  assert.equal(setGroups(lonely, [{ id: 'g1', title: 'Ні', sourceIds: ['a', 'c'] }]).code, 'group_not_connected');
  assert.equal(setGroups(chain, [{ id: 'g1', title: 'x', sourceIds: ['a', 'b'] }, { id: 'g2', title: 'y', sourceIds: ['b', 'c'] }]).code, 'source_in_two_groups');
  assert.equal(setGroups(chain, [{ id: 'g1', title: 'x', sourceIds: ['zzz'] }]).code, 'unknown_source');
  assert.equal(setGroups(chain, [{ id: '', title: 'x', sourceIds: ['a'] }]).code, 'bad_group');
  assert.equal(setGroups(chain, [{ id: 'g1', title: 'x', sourceIds: ['a', 'a'] }]).code, 'bad_group');
  assert.equal(setGroups(all, [{ id: 'g1', title: 'Усі', sourceIds: ['a', 'b', 'c'] }]).schema.revision, all.revision, 'без змін — та сама ревізія');
  // зняття ключового зв'язку розпускає групу
  const cut = must(clearRelation(all, relationsOf(all)[0].id));
  assert.deepEqual(groupsOf(cut), []);
  // відхилення теж
  const rejected = must(rejectRelation(all, { left: side('a', 'k'), right: side('b', 'k') }));
  assert.deepEqual(groupsOf(rejected), []);
  assert.deepEqual(groupsOf(must(setGroups(all, []))), []);
});

test('видалення джерела прибирає його зв’язки й розпускає групи, що розпались', () => {
  const chain = must(link(must(link(three(), 'a', 'b')), 'b', 'c'));
  const grouped = must(setGroups(chain, [{ id: 'g1', title: 'Усі', sourceIds: ['a', 'b', 'c'] }]));
  const noA = removeSource(grouped, 'a');
  assert.deepEqual(noA.removedRelations.length, 1);
  assert.deepEqual(noA.dissolvedGroups, []);
  assert.deepEqual(groupsOf(noA.schema)[0].sourceIds, ['b', 'c']);
  const noB = removeSource(grouped, 'b');
  assert.equal(noB.removedRelations.length, 2);
  assert.deepEqual(noB.dissolvedGroups, ['g1']);
  assert.deepEqual(relationsOf(noB.schema), []);
  assert.ok(parseSchema(serializeSchema(noB.schema)).ok);
  // невідоме джерело — не помилка, ревізія та сама
  const unknown = removeSource(grouped, 'zzz');
  assert.equal(unknown.ok, true);
  assert.equal(unknown.schema.revision, grouped.revision);
});

test('стовпець ключа не зникає мовчки: лишається як orphan; відхилений теж; зв’язок «перевірте»', () => {
  const linked = must(link(three(), 'a', 'b'));
  const dropped = updateSourceColumns(linked, 'a', COLS.filter(column => column.key !== 'k'));
  const schema = must(dropped);
  assert.equal(schema.sources[0].columns.find(column => column.key === 'k').orphan, true);
  assert.deepEqual(staleRelations(schema), [relationsOf(schema)[0].id]);
  assert.equal(relatedSources(schema, 'a')[0].stale, true);
  assert.ok(parseSchema(serializeSchema(schema)).ok);
  const rejected = must(rejectRelation(three(), { left: side('a', 'k2'), right: side('b', 'k2') }));
  const keep = must(updateSourceColumns(rejected, 'a', [COLS[0], COLS[2]]));
  assert.ok(keep.sources[0].columns.some(column => column.key === 'k2'));
  assert.ok(parseSchema(serializeSchema(keep)).ok);
});

test('зміна типу стовпця ключа позначає зв’язок «перевірте»; звичайний — ні', () => {
  const linked = must(link(three(), 'a', 'b'));
  assert.deepEqual(staleRelations(linked), []);
  const typed = must(updateSourceColumns(linked, 'a', COLS.map(column => (column.key === 'k' ? { ...column, type: 'number' } : column))));
  assert.equal(staleRelations(typed).length, 1);
  const untouched = must(updateSourceColumns(linked, 'a', COLS.map(column => (column.key === 'n' ? { ...column, type: 'text' } : column))));
  assert.deepEqual(staleRelations(untouched), []);
});

test('зв’язки читання: з ким пов’язана таблиця, ключі, кардинальність', () => {
  const chain = must(link(must(link(three(), 'a', 'b')), 'b', 'c'));
  const near = relatedSources(chain, 'b');
  assert.deepEqual(near.map(item => item.sourceId).sort(), ['a', 'c']);
  assert.deepEqual(relatedSources(chain, 'a').map(item => item.sourceId), ['b']);
  assert.deepEqual(relatedSources(three(), 'a'), []);
});

test('columnDependents називає зв’язки, що користуються стовпцем', () => {
  const linked = must(link(three(), 'a', 'b'));
  const definitions = listDefinitions();
  const result = columnDependents(definitions, linked, 'a', 'k', []);
  assert.deepEqual(result.relations, [relationsOf(linked)[0].id]);
  assert.deepEqual(columnDependents(definitions, linked, 'a', 'n', []).relations, []);
  const rejected = must(rejectRelation(three(), { left: side('a', 'k'), right: side('b', 'k') }));
  assert.deepEqual(columnDependents(definitions, rejected, 'a', 'k', []).relations, []);
  // ролі й зв'язки існують незалежно
  const withRole = must(confirmBinding(linked, { sourceId: 'a', columnKey: 'k', role: 'unit' }));
  assert.ok(Array.isArray(columnDependents(definitions, withRole, 'a', 'k', []).relations));
});

test('ліміти зв’язків і груп', () => {
  let schema = emptySchema('p');
  const count = 24; // 24 таблиці дають 276 різних пар, більше за ліміт
  for (let i = 0; i < count; i += 1) schema = must(addSource(schema, { id: `s${i}`, type: 'module-table', ref: `m${i}`, columns: COLS }));
  const pairs = [];
  for (let i = 0; i < count; i += 1) for (let j = i + 1; j < count; j += 1) pairs.push([`s${i}`, `s${j}`]);
  for (const [l, r] of pairs.slice(0, LIMITS.maxRelations)) schema = must(link(schema, l, r));
  assert.equal(relationsOf(schema).length, LIMITS.maxRelations);
  const [l, r] = pairs[LIMITS.maxRelations];
  assert.equal(link(schema, l, r).code, 'too_many_relations');
  assert.equal(rejectRelation(schema, { left: side(l, 'k'), right: side(r, 'k') }).code, 'too_many_relations');
  // повторне рішення про наявну пару ліміт не збільшує
  assert.ok(link(schema, pairs[0][0], pairs[0][1]).ok);
  const manyGroups = Array.from({ length: LIMITS.maxGroups + 1 }, (_, i) => ({ id: `g${i}`, title: `G${i}`, sourceIds: [`s${i}`] }));
  assert.equal(setGroups(schema, manyGroups).code, 'too_many_groups');
  const parsed = parseSchema(serializeSchema({ ...schema, relations: [...schema.relations, { ...schema.relations[0], id: 'rel:extra' }] }));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(item => item.code === 'too_many_relations'));
});

test('читання відхиляє пошкоджені зв’язки й групи', () => {
  const linked = must(link(three(), 'a', 'b'));
  const raw = () => JSON.parse(serializeSchema(linked));
  const codes = value => parseSchema(value).errors.map(item => item.code);
  const withMutation = mutate => { const value = raw(); mutate(value); return value; };
  assert.ok(codes(withMutation(v => { v.relations = 'x'; })).includes('bad_shape'));
  assert.ok(codes(withMutation(v => { v.relations[0].left.sourceId = 'zzz'; })).includes('unknown_source'));
  assert.ok(codes(withMutation(v => { v.relations[0].left.columns = ['nope']; })).includes('unknown_column'));
  assert.ok(codes(withMutation(v => { v.relations[0].left.columns = ['k', 'k2']; })).includes('bad_relation_columns'));
  assert.ok(codes(withMutation(v => { v.relations[0].right.sourceId = 'a'; })).includes('same_source'));
  assert.ok(codes(withMutation(v => { v.relations[0].status = 'maybe'; })).includes('bad_status'));
  assert.ok(codes(withMutation(v => { v.relations[0].cardinality = 'x'; })).includes('bad_cardinality'));
  assert.ok(codes(withMutation(v => { v.relations[0].basis = 'x'; })).includes('bad_basis'));
  assert.ok(codes(withMutation(v => { v.relations[0].cardinality = 'many-many'; v.relations[0].basis = 'values'; })).includes('many_many_unconfirmed'));
  assert.ok(codes(withMutation(v => { v.relations.push({ ...v.relations[0] }); })).includes('duplicate_relation'));
  assert.ok(codes(withMutation(v => { v.relations.push({ ...v.relations[0], id: 'rel:other', left: side('a', 'k2'), right: side('b', 'k2') }); })).includes('pair_taken'));
  assert.ok(codes(withMutation(v => { v.groups = [{ id: 'g', title: 'x', sourceIds: ['a', 'c'] }]; })).includes('group_not_connected'));
  assert.ok(codes(withMutation(v => { v.groups = [{ id: 'g', title: 'x', sourceIds: ['a', 'zzz'] }]; })).includes('unknown_source'));
  assert.ok(codes(withMutation(v => { v.groups = [{ id: 'g', title: 'x', sourceIds: ['a', 'b'] }, { id: 'h', title: 'y', sourceIds: ['b'] }]; })).includes('source_in_two_groups'));
  assert.ok(parseSchema(raw()).ok);
});

test('схема зв’язків не містить значень клітинок', () => {
  const linked = must(link(three(), 'a', 'b', { at: '2026-10-29T10:00:00Z' }));
  const keys = new Set();
  JSON.stringify(relationsOf(linked), (key, value) => { keys.add(key); return value; });
  assert.deepEqual([...keys].filter(key => key && !/^\d+$/.test(key)).sort(),
    ['at', 'basis', 'cardinality', 'columns', 'decidedAtRevision', 'id', 'left', 'right', 'sourceId', 'status', 'types', 'versions'].sort());
});
