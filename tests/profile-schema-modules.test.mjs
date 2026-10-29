import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { forgetModuleSource, moduleSource, moduleSourceId, syncModuleSources } from '../src/profile-schema-modules-core.js';
import { forgetProfileSchemaModule, loadProfileSchema, syncProfileSchemaModules, updateProfileSchema, STALE_MARK } from '../src/profile-schema-client.js';
import { confirmBinding, emptySchema, removeSource, renameColumn, renameSource, reorderColumns, resolveRoles, suggestBindings } from '../src/profile-schema-core.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

const PROFILE = 'profile-111111111111111111111111';
const must = result => { assert.ok(result.ok, JSON.stringify(result)); return result.schema; };

// Синтетичний модуль у вигляді, який повертає list_dashboard_modules.
const moduleOf = (id, title, fields) => ({
  id, title, branch: 'air', templateId: 't', visualKind: 'table', storageTable: `dashboard_data_${'a'.repeat(24)}`,
  fields: fields.map(([key, label, dataType], position) => ({ key, label, dataType, position })),
});
const FLIGHTS = ['module-flights-0001', 'Журнал вильотів', [['day', 'Дата', 'date'], ['count', 'К-сть БП', 'integer'], ['note', 'Примітка', 'text']]];

test('модуль стає джерелом module-table зі стовпцями в порядку position', () => {
  const module = moduleOf(...FLIGHTS);
  module.fields.reverse();
  const source = moduleSource(module);
  assert.equal(source.id, moduleSourceId(module.id));
  assert.equal(source.type, 'module-table');
  assert.equal(source.ref, module.id);
  assert.deepEqual(source.columns, [
    { key: 'day', header: 'Дата', type: 'date' },
    { key: 'count', header: 'К-сть БП', type: 'number' },
    { key: 'note', header: 'Примітка', type: 'text' },
  ]);
});

test('синхронізація додає джерела, а повторна без змін повертає ту саму схему', () => {
  const modules = [moduleOf(...FLIGHTS), moduleOf('module-weather-0002', 'Погода', [['day', 'Дата', 'date'], ['wind', 'Вітер', 'real']])];
  const first = must(syncModuleSources(emptySchema(PROFILE), modules));
  assert.deepEqual(first.sources.map(source => source.id), modules.map(module => moduleSourceId(module.id)));
  const second = syncModuleSources(first, modules);
  assert.ok(second.ok);
  assert.equal(second.schema, first);
});

test('джерела модулів, яких немає у списку гілки, синхронізація не чіпає', () => {
  const all = [moduleOf(...FLIGHTS), moduleOf('module-weather-0002', 'Погода', [['day', 'Дата', 'date']])];
  const schema = must(syncModuleSources(emptySchema(PROFILE), all));
  const branchOnly = must(syncModuleSources(schema, [all[0]]));
  assert.equal(branchOnly.sources.length, 2);
});

test('ПЕРЕД-E3 на реальному шляху: вибір користувача переживає оновлення шаблону модуля', () => {
  let schema = must(syncModuleSources(emptySchema(PROFILE), [moduleOf(...FLIGHTS)]));
  const id = moduleSourceId(FLIGHTS[0]);
  schema = must(confirmBinding(schema, { sourceId: id, columnKey: 'day', role: 'event-date' }));
  schema = must(confirmBinding(schema, { sourceId: id, columnKey: 'count', role: 'munition-count' }));
  schema = must(renameColumn(schema, id, 'count', 'Мої БП'));
  schema = must(reorderColumns(schema, id, ['count', 'note', 'day']));
  // шаблон Rust додав поле й змінив підпис; синхронізація ходить після кожного читання модулів
  const updated = moduleOf(FLIGHTS[0], 'Журнал вильотів (нова назва)', [['day', 'Дата', 'date'], ['count', 'К-сть БП', 'integer'], ['note', 'Примітка', 'text'], ['crew', 'Екіпаж', 'integer']]);
  const next = must(syncModuleSources(schema, [updated]));
  const source = next.sources[0];
  assert.deepEqual(source.columns.map(column => column.key), ['count', 'note', 'day', 'crew']);
  assert.equal(source.columns[0].header, 'Мої БП');
  assert.equal(source.title, 'Журнал вильотів (нова назва)');
  assert.deepEqual(next.bindings, schema.bindings);
  assert.deepEqual(Object.keys(resolveRoles(next, id)).sort(), ['event-date', 'munition-count']);
});

test('справжні шаблони Rust (26) стають джерелами, а заголовки дають підказки ролей', async () => {
  const templates = await rustCatalog();
  const modules = templates.map((template, index) => moduleOf(`module-${String(index).padStart(4, '0')}-aaaa`, template.title,
    template.fields.map(field => [field.key, field.label, field.dataType])));
  const schema = must(syncModuleSources(emptySchema(PROFILE), modules));
  assert.equal(schema.sources.length, templates.length);
  assert.ok(templates.length >= 26);
  const flights = schema.sources.find(source => source.columns.some(column => column.header === 'Дата'));
  assert.ok(flights, 'є шаблон зі стовпцем «Дата»');
  const suggested = suggestBindings(schema, flights.id).columns.find(column => column.header === 'Дата');
  assert.ok(['single', 'ambiguous'].includes(suggested.decision));
  assert.equal(suggested.candidates[0].role, 'event-date');
});

test('перейменування та видалення джерела', () => {
  const id = moduleSourceId(FLIGHTS[0]);
  let schema = must(syncModuleSources(emptySchema(PROFILE), [moduleOf(...FLIGHTS)]));
  schema = must(confirmBinding(schema, { sourceId: id, columnKey: 'day', role: 'event-date' }));
  assert.equal(renameSource(schema, id, ' ').code, 'bad_title');
  assert.equal(renameSource(schema, 'x', 'Я').code, 'unknown_source');
  assert.equal(renameSource(schema, id, schema.sources[0].title).schema.revision, schema.revision);
  const gone = must(forgetModuleSource(schema, FLIGHTS[0]));
  assert.deepEqual([gone.sources.length, gone.bindings.length], [0, 0]);
  assert.equal(removeSource(gone, id).schema.revision, gone.revision);
});

// --- Над підміною Rust: як це робить застосунок після list_dashboard_modules ---

function backend() {
  const state = { stored: null, revision: 0, saves: 0 };
  const invoke = async (command, args = {}) => {
    if (command === 'get_profile_session') return PROFILE;
    if (command === 'get_profile_schema') return { schema: state.stored, revision: state.revision, updatedAt: null };
    if (command === 'save_profile_schema') {
      if (args.expectedRevision !== state.revision || args.schema.revision <= state.revision) throw `схему ${STALE_MARK}`;
      state.stored = structuredClone(args.schema);
      state.revision = args.schema.revision;
      state.saves += 1;
      return { revision: state.revision };
    }
    throw new Error(command);
  };
  return { state, invoke };
}

test('клієнт: перше читання модулів записує схему, повторне — нічого не пише', async () => {
  const { invoke, state } = backend();
  const modules = [moduleOf(...FLIGHTS)];
  assert.ok((await syncProfileSchemaModules(invoke, modules)).ok);
  assert.equal(state.saves, 1);
  assert.ok((await syncProfileSchemaModules(invoke, modules)).ok);
  assert.equal(state.saves, 1);
});

test('клієнт: рішення користувача зберігаються між «запусками» й оновленням шаблону', async () => {
  const { invoke, state } = backend();
  const id = moduleSourceId(FLIGHTS[0]);
  await syncProfileSchemaModules(invoke, [moduleOf(...FLIGHTS)]);
  const confirmed = await updateProfileSchema(invoke, schema => confirmBinding(schema, { sourceId: id, columnKey: 'day', role: 'event-date' }));
  assert.ok(confirmed.ok);
  const updated = moduleOf(...FLIGHTS);
  updated.fields.push({ key: 'crew', label: 'Екіпаж', dataType: 'integer', position: 3 });
  await syncProfileSchemaModules(invoke, [updated]);
  const loaded = await loadProfileSchema(invoke);
  assert.equal(loaded.schema.sources[0].columns.at(-1).key, 'crew');
  assert.equal(resolveRoles(loaded.schema, id)['event-date'].columnKey, 'day');
  assert.equal(state.revision, loaded.schema.revision);
});

test('клієнт: видалення модуля прибирає джерело, інші лишаються', async () => {
  const { invoke } = backend();
  const other = moduleOf('module-weather-0002', 'Погода', [['day', 'Дата', 'date']]);
  await syncProfileSchemaModules(invoke, [moduleOf(...FLIGHTS), other]);
  assert.ok((await forgetProfileSchemaModule(invoke, FLIGHTS[0])).ok);
  const loaded = await loadProfileSchema(invoke);
  assert.deepEqual(loaded.schema.sources.map(source => source.id), [moduleSourceId(other.id)]);
});

test('сторінка модулів синхронізує схему після читання модулів і чистить її при видаленні, не блокуючи роботу', async () => {
  const source = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ forgetProfileSchemaModule, loadProfileSchema, syncProfileSchemaModules \} from '\.\/profile-schema-client\.js';/u);
  assert.match(source, /keepProfileSchema\(syncProfileSchemaModules\(invoke, state\.modules\)\)/u);
  assert.match(source, /keepProfileSchema\(forgetProfileSchemaModule\(invoke, module\.id\)\)/u);
  assert.doesNotMatch(source, /await (syncProfileSchemaModules|forgetProfileSchemaModule)/u);
});
