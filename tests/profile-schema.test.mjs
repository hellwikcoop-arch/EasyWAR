import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_FORMAT, SCHEMA_VERSION, BINDABLE_ROLES, emptySchema, addSource, updateSourceColumns, reorderColumns,
  renameColumn, suggestBindings, confirmBinding, rejectBinding, clearBinding, resolveRoles, readRow, availability,
  columnDependents, serializeSchema, parseSchema, unitsCompatible,
} from '../src/profile-schema-core.js';
import { listDefinitions } from '../src/module-definition-core.js';

// Лише синтетичні заголовки й рядки.
const COLUMNS = [
  { key: 'c_date', header: 'Дата', type: 'date' },
  { key: 'c_time', header: 'Час', type: 'time' },
  { key: 'c_type', header: 'Тип БП', type: 'text' },
  { key: 'c_count', header: 'К-сть БП', type: 'number' },
  { key: 'c_note', header: 'Примітка', type: 'text' },
  { key: 'c_misc', header: 'Різне', type: 'text' },
];

function base() {
  const added = addSource(emptySchema('profile-a'), { id: 'src-1', type: 'module-table', ref: 'module-1', title: 'Журнал', columns: COLUMNS });
  assert.ok(added.ok);
  return added.schema;
}

const must = result => { assert.ok(result.ok, JSON.stringify(result)); return result.schema; };

test('порожня схема: формат, версія, нуль ревізій; без профілю — помилка', () => {
  const schema = emptySchema('p');
  assert.deepEqual({ ...schema }, { format: SCHEMA_FORMAT, version: SCHEMA_VERSION, profileId: 'p', revision: 0, sources: [], bindings: [] });
  assert.throws(() => emptySchema(''), TypeError);
});

test('схема незмінна: вхід заморожений, оновлення повертають нову схему', () => {
  const schema = base();
  assert.ok(Object.isFrozen(schema) && Object.isFrozen(schema.sources[0].columns[0]));
  const next = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  assert.equal(schema.bindings.length, 0);
  assert.equal(next.bindings.length, 1);
  assert.equal(next.revision, schema.revision + 1);
});

test('addSource: дублі, невідомий тип, повторні ключі стовпців', () => {
  const schema = base();
  assert.equal(addSource(schema, { id: 'src-1', type: 'module-table', columns: [] }).code, 'duplicate_source');
  assert.equal(addSource(schema, { id: 'x', type: 'ftp', columns: [] }).code, 'unknown_source_type');
  assert.equal(addSource(schema, { id: 'x', type: 'module-table', columns: [{ key: 'a' }, { key: 'a' }] }).code, 'bad_columns');
  assert.equal(addSource(schema, { id: '', type: 'module-table', columns: [] }).code, 'bad_source');
});

test('пропозиції: підказка за заголовком, неоднозначне й невідоме лишаються на ручне підтвердження', () => {
  const schema = base();
  const { columns } = suggestBindings(schema, 'src-1');
  const by = key => columns.find(column => column.key === key);
  assert.equal(by('c_date').decision, 'single');
  assert.deepEqual(by('c_date').candidates.map(item => item.role), ['event-date']);
  assert.equal(by('c_count').decision, 'single');
  assert.equal(by('c_note').decision, 'unknown');
  assert.equal(by('c_misc').decision, 'unknown');
  // пропозиція нічого не записує
  assert.equal(schema.bindings.length, 0);
  assert.deepEqual(resolveRoles(schema, 'src-1'), {});
});

test('пропозиції: невідповідність типу значень позначається і робить пропозицію неоднозначною', () => {
  let schema = must(addSource(emptySchema('p'), { id: 's', type: 'module-table', columns: [{ key: 'k', header: 'Дата', type: 'text' }] }));
  const [column] = suggestBindings(schema, 's').columns;
  assert.equal(column.decision, 'ambiguous');
  assert.equal(column.candidates[0].typeMismatch, true);
  schema = must(confirmBinding(schema, { sourceId: 's', columnKey: 'k', role: 'event-date' }));
  assert.equal(suggestBindings(schema, 's').columns[0].decision, 'bound');
});

test('заголовки «Тип цілі» і «Бригада» дають по одній ролі', () => {
  const schema = must(addSource(emptySchema('p'), { id: 's', type: 'module-table', columns: [{ key: 'k', header: 'Тип цілі', type: 'text' }, { key: 'u', header: 'Бригада', type: 'text' }] }));
  const { columns } = suggestBindings(schema, 's');
  assert.equal(columns[0].decision, 'single');
  assert.equal(columns[1].decision, 'single');
});

test('підтвердження: роль → стовпець, одиниця за замовчуванням для числової ролі', () => {
  let schema = base();
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_count', role: 'munition-count', at: '2026-10-29T10:00:00Z' }));
  assert.deepEqual(resolveRoles(schema, 'src-1'), { 'munition-count': { columnKey: 'c_count', unit: 'шт' } });
  assert.equal(schema.bindings[0].at, '2026-10-29T10:00:00Z');
});

test('підтвердження: помилки — невідомі джерело, стовпець, роль', () => {
  const schema = base();
  assert.equal(confirmBinding(schema, { sourceId: 'no', columnKey: 'c_date', role: 'event-date' }).code, 'unknown_source');
  assert.equal(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'no', role: 'event-date' }).code, 'unknown_column');
  assert.equal(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'contact-line' }).code, 'unknown_role');
  assert.equal(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'journal-column' }).code, 'unknown_role');
});

test('одна роль — один стовпець: без replace відмова, з replace — перенесення', () => {
  let schema = must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  const refused = confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_note', role: 'event-date' });
  assert.equal(refused.code, 'role_taken');
  assert.equal(refused.takenBy, 'c_date');
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_note', role: 'event-date', replace: true }));
  assert.equal(resolveRoles(schema, 'src-1')['event-date'].columnKey, 'c_note');
  assert.equal(schema.bindings.filter(binding => binding.role === 'event-date').length, 1);
});

test('одиниці: різні мовчки не зводяться; порожня сумісна з будь-якою', () => {
  assert.equal(unitsCompatible('шт', 'ШТ'), true);
  assert.equal(unitsCompatible('', 'кг'), true);
  assert.equal(unitsCompatible('шт', 'кг'), false);
  const schema = must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_count', role: 'munition-count', unit: 'шт' }));
  const refused = confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_count', role: 'munition-count', unit: 'кг' });
  assert.equal(refused.code, 'unit_conflict');
  assert.equal(resolveRoles(schema, 'src-1')['munition-count'].unit, 'шт');
});

test('відхилена пропозиція не повертається; скидання рішення повертає її', () => {
  let schema = must(rejectBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  assert.equal(suggestBindings(schema, 'src-1').columns.find(column => column.key === 'c_date').decision, 'unknown');
  assert.deepEqual(resolveRoles(schema, 'src-1'), {});
  schema = must(clearBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  assert.equal(suggestBindings(schema, 'src-1').columns.find(column => column.key === 'c_date').decision, 'single');
});

test('підтвердження пари знімає її відхилення і навпаки', () => {
  let schema = must(rejectBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  assert.deepEqual(schema.bindings.map(binding => binding.status), ['confirmed']);
  schema = must(rejectBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  assert.deepEqual(schema.bindings.map(binding => binding.status), ['rejected']);
  assert.deepEqual(resolveRoles(schema, 'src-1'), {});
});

test('роль, зайнята іншим стовпцем, іншому не пропонується', () => {
  const schema = must(addSource(emptySchema('p'), { id: 's', type: 'module-table', columns: [{ key: 'a', header: 'Дата', type: 'date' }, { key: 'b', header: 'Дата події', type: 'date' }] }));
  const confirmed = must(confirmBinding(schema, { sourceId: 's', columnKey: 'a', role: 'event-date' }));
  const { columns } = suggestBindings(confirmed, 's');
  assert.equal(columns.find(column => column.key === 'a').decision, 'bound');
  assert.equal(columns.find(column => column.key === 'b').decision, 'unknown');
});

test('читання рядка за ключем: об\'єкт і масив у порядку стовпців, порядок не впливає', () => {
  let schema = base();
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_count', role: 'munition-count' }));
  const object = { c_misc: 'x', c_count: 7, c_date: '2026-10-01', c_type: 'T', c_note: 'n', c_time: '10:00' };
  const fromObject = readRow(schema, 'src-1', object);
  assert.deepEqual(fromObject.byRole, { 'event-date': '2026-10-01', 'munition-count': 7 });
  assert.equal(fromObject.extras.c_misc, 'x');
  const array = ['2026-10-01', '10:00', 'T', 7, 'n', 'x'];
  assert.deepEqual(readRow(schema, 'src-1', array).byRole, fromObject.byRole);
  // переставлені стовпці — ті самі значення за ролями
  const reordered = must(reorderColumns(schema, 'src-1', ['c_misc', 'c_count', 'c_date', 'c_note', 'c_type', 'c_time']));
  assert.deepEqual(readRow(reordered, 'src-1', object).byRole, fromObject.byRole);
  assert.deepEqual(readRow(reordered, 'src-1', ['x', 7, '2026-10-01', 'n', 'T', '10:00']).byRole, fromObject.byRole);
  assert.equal(readRow(schema, 'no', {}).code, 'unknown_source');
});

test('порядок і підписи: перестановка вимагає кожного ключа рівно раз; підпис не чіпає ключ і зіставлення', () => {
  let schema = must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  assert.equal(reorderColumns(schema, 'src-1', ['c_date']).code, 'bad_order');
  assert.equal(reorderColumns(schema, 'src-1', ['c_date', 'c_date', 'c_time', 'c_type', 'c_count', 'c_note']).code, 'bad_order');
  schema = must(renameColumn(schema, 'src-1', 'c_date', 'Дата вильоту (моя)'));
  assert.equal(schema.sources[0].columns[0].header, 'Дата вильоту (моя)');
  assert.equal(schema.sources[0].columns[0].key, 'c_date');
  assert.equal(resolveRoles(schema, 'src-1')['event-date'].columnKey, 'c_date');
  assert.equal(renameColumn(schema, 'src-1', 'c_date', '  ').code, 'bad_header');
  assert.equal(renameColumn(schema, 'src-1', 'zzz', 'Я').code, 'unknown_column');
});

test('оновлення шаблону: нові стовпці в кінці, підтверджене зіставлення, порядок і підписи цілі', () => {
  let schema = base();
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_count', role: 'munition-count' }));
  schema = must(renameColumn(schema, 'src-1', 'c_count', 'Мої БП'));
  schema = must(reorderColumns(schema, 'src-1', ['c_count', 'c_date', 'c_time', 'c_type', 'c_note', 'c_misc']));
  const version = schema.sources[0].version;
  const updated = updateSourceColumns(schema, 'src-1', [...COLUMNS, { key: 'c_new', header: 'Нове', type: 'text' }]);
  assert.ok(updated.ok);
  assert.deepEqual(updated.added, ['c_new']);
  assert.deepEqual(updated.schema.sources[0].columns.map(column => column.key), ['c_count', 'c_date', 'c_time', 'c_type', 'c_note', 'c_misc', 'c_new']);
  assert.equal(updated.schema.sources[0].columns[0].header, 'Мої БП');
  assert.deepEqual(updated.schema.bindings, schema.bindings);
  assert.equal(updated.schema.sources[0].version, version + 1);
});

test('оновлення без змін не змінює ні версію джерела, ні ревізію', () => {
  const schema = base();
  const same = updateSourceColumns(schema, 'src-1', COLUMNS);
  assert.ok(same.ok);
  assert.equal(same.schema.revision, schema.revision);
  assert.equal(same.schema.sources[0].version, schema.sources[0].version);
});

test('стовпець, якого шаблон вже не має: зі зіставленням лишається як orphan, без нього зникає; повернення знімає orphan', () => {
  let schema = must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  const without = COLUMNS.filter(column => !['c_date', 'c_note'].includes(column.key));
  const shrunk = updateSourceColumns(schema, 'src-1', without);
  assert.deepEqual(shrunk.orphaned, ['c_date']);
  const keys = shrunk.schema.sources[0].columns.map(column => column.key);
  assert.ok(keys.includes('c_date') && !keys.includes('c_note'));
  assert.equal(shrunk.schema.sources[0].columns.find(column => column.key === 'c_date').orphan, true);
  assert.equal(resolveRoles(shrunk.schema, 'src-1')['event-date'].columnKey, 'c_date');
  const back = updateSourceColumns(shrunk.schema, 'src-1', COLUMNS);
  assert.equal(back.schema.sources[0].columns.find(column => column.key === 'c_date').orphan, undefined);
  assert.deepEqual(back.orphaned, []);
});

test('ПЕРЕД-E3 ТЕСТ: зіставив і переставив → перезапуск → оновлення каталогу → вибір цілий', () => {
  // 1. користувач підтверджує ролі, переставляє й підписує стовпці
  let schema = base();
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date', at: 't1' }));
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_type', role: 'munition-type', at: 't2' }));
  schema = must(confirmBinding(schema, { sourceId: 'src-1', columnKey: 'c_count', role: 'munition-count', unit: 'шт', at: 't3' }));
  schema = must(rejectBinding(schema, { sourceId: 'src-1', columnKey: 'c_note', role: 'target-type' }));
  schema = must(renameColumn(schema, 'src-1', 'c_type', 'Мої боєприпаси'));
  schema = must(reorderColumns(schema, 'src-1', ['c_count', 'c_type', 'c_date', 'c_time', 'c_note', 'c_misc']));
  // 2. «перезапуск»: збережений текст читається назад
  const restarted = parseSchema(serializeSchema(schema));
  assert.ok(restarted.ok, JSON.stringify(restarted.errors));
  assert.deepEqual(restarted.schema, schema);
  // 3. оновлення каталогу: шаблон додав стовпець і змінив тип іншого, порядок за шаблоном — інший
  const catalog = [
    { key: 'c_misc', header: 'Різне', type: 'text' }, { key: 'c_note', header: 'Примітка', type: 'text' },
    { key: 'c_new', header: 'Нове', type: 'text' }, { key: 'c_date', header: 'Дата', type: 'text' },
    { key: 'c_time', header: 'Час', type: 'time' }, { key: 'c_type', header: 'Тип БП', type: 'text' },
    { key: 'c_count', header: 'К-сть БП', type: 'number' },
  ];
  const updated = updateSourceColumns(restarted.schema, 'src-1', catalog);
  assert.ok(updated.ok);
  // 4. вибір користувача цілий
  assert.deepEqual(updated.schema.bindings, schema.bindings);
  assert.deepEqual(updated.schema.sources[0].columns.map(column => column.key), ['c_count', 'c_type', 'c_date', 'c_time', 'c_note', 'c_misc', 'c_new']);
  assert.equal(updated.schema.sources[0].columns[1].header, 'Мої боєприпаси');
  assert.deepEqual(resolveRoles(updated.schema, 'src-1'), {
    'event-date': { columnKey: 'c_date', unit: '' },
    'munition-type': { columnKey: 'c_type', unit: '' },
    'munition-count': { columnKey: 'c_count', unit: 'шт' },
  });
  // і відхилена пропозиція після оновлення не повертається
  assert.equal(suggestBindings(updated.schema, 'src-1').columns.find(column => column.key === 'c_note').decision, 'unknown');
});

test('доступність за реєстром E1: оцінюються лише смислові вимоги, решта — not-evaluated', () => {
  const definitions = listDefinitions();
  let schema = base();
  const before = availability(definitions, schema, 'src-1').definitions;
  assert.ok(before.some(item => item.status === 'missing'));
  assert.ok(before.some(item => item.status === 'not-evaluated'));
  assert.ok(!before.some(item => item.status === 'available'));
  const evaluable = before.filter(item => item.status === 'missing');
  // підтверджуємо всі ролі, що потрібні визначенням → вони стають доступні
  const roles = new Set();
  for (const definition of definitions) if (evaluable.some(item => item.definitionId === definition.definitionId)) definition.requirements.forEach(requirement => roles.add(requirement.role));
  const columns = [...roles].map(role => ({ key: `k_${role}`, header: role, type: 'text' }));
  schema = must(addSource(emptySchema('p'), { id: 'all', type: 'module-table', columns }));
  for (const role of roles) schema = must(confirmBinding(schema, { sourceId: 'all', columnKey: `k_${role}`, role, unit: 'шт' }));
  const after = availability(definitions, schema, 'all').definitions;
  assert.ok(after.some(item => item.status === 'available'));
  assert.ok(!after.some(item => item.status === 'missing'));
  assert.equal(availability(definitions, schema, 'no').code, 'unknown_source');
});

test('доступність: «що додасть» називає ролі, яких бракує', () => {
  const definitions = [{ definitionId: 'x', requirements: [{ role: 'event-date', required: true }, { role: 'munition-count', required: false }] }];
  const missing = availability(definitions, base(), 'src-1').definitions[0];
  assert.equal(missing.status, 'missing');
  assert.deepEqual(missing.adds, ['Дата події']);
  const schema = must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  assert.equal(availability(definitions, schema, 'src-1').definitions[0].status, 'available');
});

test('залежності стовпця: обов\'язкова вимога → lose, необов\'язкова → degrade, нерозміщені мовчать', () => {
  const definitions = [
    { definitionId: 'a', requirements: [{ role: 'event-date', required: true }] },
    { definitionId: 'b', requirements: [{ role: 'event-date', required: false }] },
    { definitionId: 'c', requirements: [{ role: 'munition-count', required: true }] },
    { definitionId: 'd', requirements: [{ role: 'event-date', required: true }] },
  ];
  const schema = must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  const result = columnDependents(definitions, schema, 'src-1', 'c_date', ['a', 'b', 'c']);
  assert.deepEqual({ lose: result.lose, degrade: result.degrade, roles: result.roles }, { lose: ['a'], degrade: ['b'], roles: ['event-date'] });
  assert.deepEqual(columnDependents(definitions, schema, 'src-1', 'c_note', ['a']).lose, []);
});

test('серіалізація стабільна й круглозворотна', () => {
  const schema = must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }));
  const text = serializeSchema(schema);
  assert.equal(serializeSchema(parseSchema(text).schema), text);
  assert.deepEqual(parseSchema(JSON.parse(text)).schema, schema);
});

test('parseSchema: пошкоджені й чужі дані відхиляються з кодами', () => {
  const good = JSON.parse(serializeSchema(must(confirmBinding(base(), { sourceId: 'src-1', columnKey: 'c_date', role: 'event-date' }))));
  const codes = value => parseSchema(value).errors.map(error => error.code);
  assert.deepEqual(codes('не json'), ['bad_json']);
  assert.deepEqual(codes([]), ['bad_shape']);
  assert.ok(codes({ ...good, format: 'other' }).includes('bad_format'));
  assert.ok(codes({ ...good, version: SCHEMA_VERSION + 1 }).includes('unsupported_version'));
  assert.ok(codes({ ...good, version: 0 }).includes('bad_version'));
  assert.ok(codes({ ...good, profileId: '' }).includes('bad_profile'));
  assert.ok(codes({ ...good, sources: {} }).includes('bad_shape'));
  assert.ok(codes({ ...good, sources: [good.sources[0], good.sources[0]] }).includes('duplicate_source'));
  assert.ok(codes({ ...good, bindings: [{ ...good.bindings[0], sourceId: 'zzz' }] }).includes('unknown_source'));
  assert.ok(codes({ ...good, bindings: [{ ...good.bindings[0], columnKey: 'zzz' }] }).includes('unknown_column'));
  assert.ok(codes({ ...good, bindings: [{ ...good.bindings[0], role: 'contact-line' }] }).includes('unknown_role'));
  assert.ok(codes({ ...good, bindings: [{ ...good.bindings[0], status: 'maybe' }] }).includes('bad_status'));
  assert.ok(codes({ ...good, bindings: [good.bindings[0], { ...good.bindings[0], columnKey: 'c_note' }] }).includes('role_taken'));
  const noUnit = { ...good, bindings: [{ ...good.bindings[0], role: 'munition-count', columnKey: 'c_count', unit: '' }] };
  assert.ok(codes(noUnit).includes('unit_required'));
  assert.equal(parseSchema(good).ok, true);
});

test('смислові ролі зі стовпців — основа BINDABLE_ROLES; контур, книга й довільний стовпець не входять', () => {
  assert.ok(BINDABLE_ROLES.includes('event-date'));
  for (const role of ['contact-line', 'report-metric', 'journal-column']) assert.ok(!BINDABLE_ROLES.includes(role), role);
});
