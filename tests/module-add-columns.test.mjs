import assert from 'node:assert/strict';
import test from 'node:test';

import { fromRustTemplates, listDefinitions } from '../src/module-definition-core.js';
import { confirmBinding, emptySchema } from '../src/profile-schema-core.js';
import { moduleSourceId, syncModuleSources } from '../src/profile-schema-modules-core.js';
import {
  MAX_TABLE_COLUMNS, USER_TABLE_TEMPLATE_ID, addFieldsRequest, bindingsAfterAdd, columnForRole, createUserTableRequest,
  isUserTable, planAddColumns, supportsColumns, unsupportedReason, userTables,
} from '../src/module-add-columns-core.js';

// Лише синтетичні дані: вигадані стовпці, жодних реальних таблиць.

const definitions = listDefinitions();
const byId = id => definitions.find(item => item.definitionId.endsWith(id));
const field = (key, label, dataType = 'text', position = 0) => ({ key, label, dataType, position });
const table = (fields, extra = {}) => ({ id: 'main', branch: 'rocket', templateId: USER_TABLE_TEMPLATE_ID, title: 'Основна таблиця', updatedAt: '2026-10-30T08:00:00Z', fields, ...extra });
const schemaOf = module => syncModuleSources(emptySchema('profile-cols'), [module]).schema;

test('картки РВ потребують дати події, результату ураження й кількості БП', () => {
  const destroyed = byId('rv-kpi-destroyed');
  assert.equal(supportsColumns(destroyed), true);
  const plan = planAddColumns({ definition: destroyed });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.fields.map(item => item.label), ['Результат ураження', 'Дата події']);
  assert.equal(plan.summary, 'додасть: «Результат ураження», «Дата події»');
  assert.deepEqual(plan.items.map(item => item.columnKey), ['c1', 'c2']);
});

test('типи стовпців відповідають ролям: дата, ціле з підсумовуванням, решта — текст', () => {
  assert.deepEqual(columnForRole('event-date'), { label: 'Дата події', dataType: 'date', role: 'dimension', aggregation: 'none' });
  assert.deepEqual(columnForRole('munition-count'), { label: 'Кількість боєприпасів', dataType: 'integer', role: 'metric', aggregation: 'sum' });
  assert.deepEqual(columnForRole('unit'), { label: 'Підрозділ', dataType: 'text', role: 'dimension', aggregation: 'none' });
});

test('наступний ключ продовжує нумерацію таблиці, наявні ролі не додаються вдруге', () => {
  const module = table([field('c1', 'Підрозділ'), field('c2', 'Дата події', 'date', 1), field('c4', 'Нотатки', 'text', 2)]);
  const schema = confirmBinding(schemaOf(module), { sourceId: moduleSourceId('main'), columnKey: 'c2', role: 'event-date' }).schema;
  const plan = planAddColumns({ definition: byId('rv-kpi-munitions'), schema, module });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.items.map(item => [item.role, item.mode, item.columnKey]), [['munition-count', 'add', 'c5'], ['event-date', 'have', 'c2']]);
  assert.deepEqual(plan.fields.map(item => item.label), ['Кількість боєприпасів']);
  assert.equal(plan.totalColumns, 4);
});

test('наявний стовпець із підписом ролі без зіставлення пропонується зіставити, а не дублювати', () => {
  const module = table([field('c1', 'дата  ПОДІЇ', 'date')]);
  const plan = planAddColumns({ definition: byId('rv-kpi-launches'), schema: schemaOf(module), module });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.fields, []);
  assert.deepEqual(plan.bindings, [{ role: 'event-date', columnKey: 'c1', unit: '' }]);
  assert.match(plan.summary, /зіставить наявні: «дата {2}ПОДІЇ»/);
  assert.equal(plan.nothingToAdd, false);
});

test('підпис, зайнятий стовпцем з іншою роллю, дістає суфікс', () => {
  const module = table([field('c1', 'Дата події', 'date')]);
  const schema = confirmBinding(schemaOf(module), { sourceId: moduleSourceId('main'), columnKey: 'c1', role: 'event-time' }).schema;
  const plan = planAddColumns({ definition: byId('rv-kpi-launches'), schema, module });
  assert.deepEqual(plan.fields.map(item => item.label), ['Дата події (2)']);
});

test('коли всі ролі вже є, додавати нічого', () => {
  const module = table([field('c1', 'Дата події', 'date')]);
  const schema = confirmBinding(schemaOf(module), { sourceId: moduleSourceId('main'), columnKey: 'c1', role: 'event-date' }).schema;
  const plan = planAddColumns({ definition: byId('rv-kpi-launches'), schema, module });
  assert.equal(plan.nothingToAdd, true);
  assert.equal(plan.summary, 'усі потрібні стовпці вже є');
});

test('необов’язкові ролі додаються лише за запитом', () => {
  const definition = byId('repeat-targets');
  const base = planAddColumns({ definition });
  const full = planAddColumns({ definition, withOptional: true });
  assert.equal(base.fields.length + 1, full.fields.length);
  assert.ok(full.fields.some(item => item.label === 'Тип цілі'));
  assert.ok(!base.fields.some(item => item.label === 'Тип цілі'));
});

test('блоки, що читають не стовпці, відхиляються з причиною', () => {
  const book = definitions.find(item => item.requirements.some(requirement => requirement.role === 'report-metric'));
  assert.ok(book);
  assert.equal(supportsColumns(book), false);
  assert.match(unsupportedReason(book), /книги звітів/);
  const depth = byId('strike-depth');
  assert.match(unsupportedReason(depth), /бойового зіткнення/);
  const [template] = fromRustTemplates([{
    id: 'sample', title: 'Зразок', visualKind: 'bars',
    fields: [{ key: 'category', label: 'Категорія', dataType: 'text', role: 'dimension', required: true }],
  }]);
  assert.match(unsupportedReason(template), /шаблону/);
  const plan = planAddColumns({ definition: depth });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'unsupported');
  assert.equal(unsupportedReason({ requirements: [] }), 'У блока немає вимог до стовпців.');
});

test('понад 64 стовпці не плануються', () => {
  const fields = Array.from({ length: MAX_TABLE_COLUMNS }, (_, index) => field(`c${index + 1}`, `Колонка ${index + 1}`));
  const module = table(fields);
  const plan = planAddColumns({ definition: byId('rv-kpi-launches'), schema: schemaOf(module), module });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'too_many_columns');
});

test('після додавання ключі беруться з відповіді команди за підписом', () => {
  const module = table([field('c1', 'Нотатки')]);
  const plan = planAddColumns({ definition: byId('rv-kpi-munitions'), schema: schemaOf(module), module });
  // Сервер міг дати інші ключі, ніж передбачено: береться те, що повернула команда.
  const after = table([field('c1', 'Нотатки'), field('c7', 'Кількість боєприпасів', 'integer', 1), field('c8', 'Дата події', 'date', 2)]);
  const result = bindingsAfterAdd(plan, after);
  assert.equal(result.ok, true);
  assert.deepEqual(result.bindings, [
    { role: 'munition-count', columnKey: 'c7', unit: '' },
    { role: 'event-date', columnKey: 'c8', unit: '' },
  ]);
  assert.equal(bindingsAfterAdd(plan, table([field('c1', 'Нотатки')])).ok, false);
});

test('запити команд: додавання стовпців і створення основної таблиці', () => {
  const module = table([field('c1', 'Нотатки')]);
  const plan = planAddColumns({ definition: byId('rv-kpi-launches'), schema: schemaOf(module), module });
  assert.deepEqual(addFieldsRequest(module, plan), {
    moduleId: 'main',
    fields: [{ label: 'Дата події', dataType: 'date', role: 'dimension', aggregation: 'none' }],
    expectedUpdatedAt: '2026-10-30T08:00:00Z',
  });
  const first = planAddColumns({ definition: byId('rv-kpi-launches') });
  assert.deepEqual(createUserTableRequest('rocket', first), {
    branch: 'rocket', templateId: 'user-table', title: 'Основна таблиця', customFields: first.fields, rows: [],
  });
});

test('основну таблицю відрізняє службовий шаблон', () => {
  const main = table([]);
  const other = { id: 'other', templateId: 'merged-table' };
  assert.equal(isUserTable(main), true);
  assert.equal(isUserTable(other), false);
  assert.deepEqual(userTables([other, main, null]).map(item => item.id), ['main']);
});

// ---- клієнт і текстові контракти ----

import { readFile } from 'node:fs/promises';
import { bindBlockColumns, saveBlockColumns } from '../src/module-add-columns-client.js';
import { confirmPlanBindings } from '../src/module-add-columns-core.js';
import { resolveRoles } from '../src/profile-schema-core.js';

function fakeInvoke() {
  const calls = [];
  const store = { record: null, revision: 0 };
  const invoke = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'get_profile_session') return 'profile-cols';
    if (cmd === 'get_profile_schema') return store.record;
    if (cmd === 'save_profile_schema') { store.revision += 1; store.record = { schema: args.schema, revision: store.revision }; return { revision: store.revision }; }
    return { id: 'main', echo: args };
  };
  return { invoke, calls, store };
}

test('клієнт: без таблиці створює основну, з таблицею — додає стовпці', async () => {
  const plan = planAddColumns({ definition: byId('rv-kpi-launches') });
  const created = fakeInvoke();
  await saveBlockColumns(created.invoke, { branch: 'rocket', module: null, plan });
  assert.equal(created.calls[0][0], 'create_dashboard_module');
  assert.equal(created.calls[0][1].templateId, 'user-table');
  const module = table([field('c1', 'Нотатки')]);
  const added = fakeInvoke();
  await saveBlockColumns(added.invoke, { branch: 'rocket', module, plan: planAddColumns({ definition: byId('rv-kpi-launches'), schema: schemaOf(module), module }) });
  assert.equal(added.calls[0][0], 'add_dashboard_module_fields');
  assert.equal(added.calls[0][1].expectedUpdatedAt, module.updatedAt);
});

test('клієнт: ролі зіставляються зі стовпцями з відповіді, а не з передбачення; одиниця кількості — «шт»', async () => {
  const before = table([field('c1', 'Нотатки')]);
  const plan = planAddColumns({ definition: byId('rv-kpi-munitions'), schema: schemaOf(before), module: before });
  const after = table([field('c1', 'Нотатки'), field('c9', 'Кількість боєприпасів', 'integer', 1), field('c10', 'Дата події', 'date', 2)]);
  const { invoke, store } = fakeInvoke();
  const result = await bindBlockColumns(invoke, { module: after, plan, at: '2026-10-30T09:00:00Z' });
  assert.equal(result.ok, true, result.message);
  const roles = resolveRoles(result.schema, moduleSourceId('main'));
  assert.deepEqual(roles['munition-count'], { columnKey: 'c9', unit: 'шт' });
  assert.equal(roles['event-date'].columnKey, 'c10');
  assert.equal(store.revision, 1);
});

test('зіставлення: перша відмова ядра зупиняє все й схема лишається попередньою', () => {
  const module = table([field('c1', 'Дата події', 'date')]);
  const schema = schemaOf(module);
  const bad = confirmPlanBindings(schema, 'main', [{ role: 'event-date', columnKey: 'c1' }, { role: 'event-time', columnKey: 'c404' }]);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'unknown_column');
  assert.equal(Object.keys(resolveRoles(schema, moduleSourceId('main'))).length, 0);
});

test('реєстр: кнопка стовпців підключена, а команда запису викликається лише в клієнті', async () => {
  const [catalog, registry, client, panel, build, caps, core] = await Promise.all([
    'src/dashboard-module-catalog.js', 'src/module-registry-panel.js', 'src/module-add-columns-client.js', 'src/module-add-columns-panel.js',
    'src-tauri/build.rs', 'src-tauri/capabilities/default.json', 'src/module-add-columns-core.js',
  ].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  assert.match(catalog, /columnsBox: original =>/);
  assert.match(registry, /columnsBox\(definition\)/);
  assert.equal((client.match(/invoke\('add_dashboard_module_fields'/g) || []).length, 1);
  assert.ok(!catalog.includes("'add_dashboard_module_fields'"), 'команду викликає лише клієнт');
  assert.match(build, /"add_dashboard_module_fields"/);
  assert.match(caps, /allow-add-dashboard-module-fields/);
  // Панель не пише в сховище сама і не вставляє розмітку рядками.
  assert.ok(!/invoke\(|innerHTML/.test(panel));
  // Верхній рівень ядра без Object.freeze: інакше виклик лишається у збірці ПВК-lite (ліміт 5 МБ).
  assert.ok(!/^(?:export )?const \w+ = Object\.freeze/m.test(core));
});

test('клієнт: без нових стовпців (лише зіставлення) команда запису не викликається', async () => {
  const module = table([field('c1', 'Дата події', 'date')]);
  const plan = planAddColumns({ definition: byId('rv-kpi-launches'), schema: schemaOf(module), module });
  assert.deepEqual(plan.fields, []);
  const { invoke, calls } = fakeInvoke();
  assert.equal(await saveBlockColumns(invoke, { branch: 'rocket', module, plan }), module);
  assert.equal(calls.length, 0);
});
