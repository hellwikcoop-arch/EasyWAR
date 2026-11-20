import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  LIMITS, clearRelation, confirmRelation, emptySchema, parseSchema, relationsOf, removeSource, serializeSchema, setSnapshot, snapshotOf, snapshotsOf,
} from '../src/profile-schema-core.js';
import { moduleSourceId, syncModuleSources } from '../src/profile-schema-modules-core.js';
import { suggestRelations } from '../src/table-link-core.js';
import { confirmArgs, linkInputs, mergeModuleView } from '../src/table-link-view-core.js';
import { countChanges, refreshSummary, refreshView, snapshotInfo } from '../src/table-link-snapshot-core.js';

// Лише синтетичні дані: вигадані підрозділи, жодних реальних таблиць.

const field = (key, label, dataType = 'text', position = 0) => ({ key, label, dataType, position });
const modulePlan = { id: 'plan', branch: 'air', title: 'План', fields: [field('date', 'Дата', 'date', 0), field('unit', 'Підрозділ', 'text', 1), field('goal', 'Ціль', 'text', 2)] };
const moduleFlights = { id: 'flights', branch: 'air', title: 'Вильоти', fields: [field('date', 'Дата', 'date', 0), field('unit', 'Підрозділ', 'text', 1), field('tail', 'Борт', 'text', 2)] };
const UNITS = ['Альфа', 'Браво', 'Чарлі'];
const day = n => `2026-09-${String(1 + n).padStart(2, '0')}`;

// Схема з двома вихідними таблицями, підтвердженим зв'язком і знімком-модулем `merged`, створеним із цього зв'язку.
async function setup() {
  const synced = syncModuleSources(emptySchema('profile-snap'), [modulePlan, moduleFlights]);
  const plan = [];
  const flights = [];
  for (let d = 0; d < 4; d += 1) for (const unit of UNITS) {
    plan.push({ date: day(d), unit, goal: `ціль-${d}-${unit}` });
    for (let k = 0; k < 2; k += 1) flights.push({ date: day(d), unit, tail: `${100 + flights.length}` });
  }
  const data = new Map([['plan', { rows: plan, truncated: false }], ['flights', { rows: flights, truncated: false }]]);
  const found = await suggestRelations(linkInputs(synced.schema, [modulePlan, moduleFlights], data).tables, {});
  const candidate = found.pairs[0].candidates.find(item => item.left.columns.length === 2);
  const confirmed = confirmRelation(synced.schema, confirmArgs(candidate)).schema;
  const relationId = relationsOf(confirmed)[0].id;
  const made = mergeModuleView(confirmed, relationId, [modulePlan, moduleFlights], data);
  assert.ok(made.ok, made.message);
  const merged = {
    id: 'merged', branch: 'air', title: made.request.title,
    fields: made.request.customFields.map((item, index) => ({ key: `c${index + 1}`, label: item.label, dataType: item.dataType, position: index })),
  };
  const modules = [modulePlan, moduleFlights, merged];
  const withMerged = syncModuleSources(confirmed, modules).schema;
  const schema = setSnapshot(withMerged, { sourceId: moduleSourceId('merged'), relationId, builtAt: '2026-10-30T10:00:00.000Z', rowCount: made.rowCount }).schema;
  const mergedRows = made.request.rows.map((row, index) => ({ ...row, rowId: index + 1 }));
  data.set('merged', { module: merged, rows: mergedRows, truncated: false, corrections: [] });
  return { schema, modules, merged, data, relationId, made };
}

test('схема: знімок пишеться в профіль без значень, замінює попередній і перечитується', async () => {
  const { schema, relationId, made } = await setup();
  const entry = snapshotOf(schema, moduleSourceId('merged'));
  assert.deepEqual(entry, { sourceId: 'module:merged', relationId, builtAt: '2026-10-30T10:00:00.000Z', rowCount: made.rowCount });
  assert.equal(snapshotsOf(schema).length, 1);
  const again = setSnapshot(schema, { sourceId: 'module:merged', relationId, builtAt: '2026-10-31T10:00:00.000Z', rowCount: 7 });
  assert.ok(again.ok);
  assert.equal(snapshotsOf(again.schema).length, 1, 'знімок на таблицю один');
  assert.equal(snapshotOf(again.schema, 'module:merged').rowCount, 7);
  assert.equal(again.schema.revision, schema.revision + 1);
  const same = setSnapshot(again.schema, { sourceId: 'module:merged', relationId, builtAt: '2026-10-31T10:00:00.000Z', rowCount: 7 });
  assert.equal(same.schema.revision, again.schema.revision, 'без змін — та сама ревізія');
  const parsed = parseSchema(serializeSchema(again.schema));
  assert.ok(parsed.ok, JSON.stringify(parsed.errors));
  assert.deepEqual(snapshotsOf(parsed.schema), snapshotsOf(again.schema));
  assert.doesNotMatch(serializeSchema(again.schema), /ціль-0-Альфа|Альфа/u, 'значень клітинок у схемі немає');
});

test('схема: знімок відхиляє невідоме джерело й некоректні поля; схема без знімків читається як раніше', async () => {
  const { schema, relationId } = await setup();
  assert.equal(setSnapshot(schema, { sourceId: 'module:нема', relationId, rowCount: 1 }).code, 'unknown_source');
  assert.equal(setSnapshot(schema, { sourceId: 'module:merged', relationId: '', rowCount: 1 }).code, 'bad_snapshot');
  assert.equal(setSnapshot(schema, { sourceId: 'module:merged', relationId, rowCount: -1 }).code, 'bad_snapshot');
  assert.equal(setSnapshot(schema, { sourceId: 'module:merged', relationId, rowCount: 1.5 }).code, 'bad_snapshot');
  const broken = JSON.parse(serializeSchema(schema));
  broken.snapshots = [{ sourceId: 'module:нема', relationId, rowCount: 1 }];
  assert.ok(parseSchema(broken).errors.some(item => item.code === 'unknown_source'));
  broken.snapshots = [schema.snapshots[0], schema.snapshots[0]];
  assert.ok(parseSchema(broken).errors.some(item => item.code === 'duplicate_snapshot'));
  broken.snapshots = {};
  assert.ok(parseSchema(broken).errors.some(item => item.code === 'bad_shape'));
  broken.snapshots = Array.from({ length: LIMITS.maxSnapshots + 1 }, () => schema.snapshots[0]);
  assert.ok(parseSchema(broken).errors.some(item => item.code === 'too_many_snapshots'));
  const old = JSON.parse(serializeSchema(schema));
  delete old.snapshots;
  assert.ok(parseSchema(old).ok, 'поле необов’язкове');
});

test('схема: видалення таблиці-знімка прибирає знімок, зняття зв’язку його лишає', async () => {
  const { schema, relationId } = await setup();
  const removed = removeSource(schema, 'module:merged');
  assert.deepEqual(snapshotsOf(removed.schema), []);
  const cleared = clearRelation(schema, relationId);
  assert.equal(snapshotsOf(cleared.schema).length, 1, 'знімок лишається: просто оновлення недоступне');
  const info = snapshotInfo(cleared.schema, { id: 'merged' });
  assert.equal(info.relation, null);
  assert.match(info.text, /знято/u);
});

test('snapshotInfo називає зв’язок і дату; для звичайної таблиці — null', async () => {
  const { schema, merged, modules } = await setup();
  const titles = new Map(modules.map(item => [moduleSourceId(item.id), item.title]));
  const info = snapshotInfo(schema, merged, titles);
  assert.match(info.text, /План ↔ Вильоти|Вильоти ↔ План/u);
  assert.equal(info.builtAt, '2026-10-30T10:00:00.000Z');
  assert.deepEqual([...info.sourceIds].sort(), ['module:flights', 'module:plan']);
  assert.equal(snapshotInfo(schema, modulePlan, titles), null);
});

test('countChanges: додані, зниклі й незмінні рядки; однакові рядки рахуються парами', () => {
  const keys = ['c1', 'c2'];
  const a = { c1: 'x', c2: 1 };
  const b = { c1: 'y', c2: null };
  assert.deepEqual(countChanges(keys, [a, b], [a, b]), { added: 0, removed: 0, same: 2 });
  assert.deepEqual(countChanges(keys, [a, b], [a, { c1: 'z', c2: 2 }]), { added: 1, removed: 1, same: 1 });
  assert.deepEqual(countChanges(keys, [a, a], [a]), { added: 0, removed: 1, same: 1 });
  assert.deepEqual(countChanges(keys, [{ c1: 'y' }], [b]), { added: 0, removed: 0, same: 1 }, 'порожнє й null однакові');
  assert.deepEqual(countChanges(keys, [{ ...a, rowId: 5 }], [a]), { added: 0, removed: 0, same: 1 }, 'службовий rowId не рахується');
});

test('refreshView: без змін у вихідних — оновлювати нічого, схема не змінюється', async () => {
  const { schema, modules, merged, data, made } = await setup();
  const before = serializeSchema(schema);
  const view = refreshView(schema, merged, modules, data, data.get('merged'));
  assert.ok(view.ok, view.message);
  assert.equal(view.before, made.rowCount);
  assert.equal(view.rowCount, made.rowCount);
  assert.deepEqual([view.added, view.removed, view.same], [0, 0, made.rowCount]);
  assert.equal(view.request.moduleId, 'merged');
  assert.ok(view.request.rows.every(row => !('rowId' in row)), 'повна заміна: старі rowId не передаються');
  const summary = refreshSummary(view);
  assert.equal(summary.changed, false);
  assert.match(summary.lines.join(' '), /оновлювати нічого/u);
  assert.equal(serializeSchema(schema), before);
});

test('refreshView: нові рядки у вихідних дають додані, видалені — зниклі; ручні правки попереджають', async () => {
  const { schema, modules, merged, data, made } = await setup();
  const grown = new Map(data);
  grown.set('plan', { rows: [...data.get('plan').rows, { date: day(5), unit: 'Альфа', goal: 'нова ціль' }], truncated: false });
  grown.set('flights', { rows: [...data.get('flights').rows, { date: day(5), unit: 'Альфа', tail: '900' }], truncated: false });
  const view = refreshView(schema, merged, modules, grown, { ...data.get('merged'), corrections: [{ rowId: 1, fieldKey: 'c3' }] });
  assert.ok(view.ok, view.message);
  assert.equal(view.added, 1);
  assert.equal(view.removed, 0);
  assert.equal(view.rowCount, made.rowCount + 1);
  assert.equal(view.manual, 1);
  const summary = refreshSummary(view);
  assert.equal(summary.changed, true);
  assert.match(summary.lines[0], new RegExp(`Було ${made.rowCount} .*стане ${made.rowCount + 1} .*додано 1, зникне 0`, 'u'));
  assert.match(summary.lines.join(' '), /виправлені вручну/u);
  const shrunk = new Map(data);
  shrunk.set('flights', { rows: data.get('flights').rows.slice(2), truncated: false });
  const lost = refreshView(schema, merged, modules, shrunk, data.get('merged'));
  assert.ok(lost.ok, lost.message);
  assert.ok(lost.removed > 0 || lost.added > 0);
  assert.equal(lost.added + lost.same, lost.rowCount);
  assert.equal(lost.removed + lost.same, lost.before);
  assert.match(refreshSummary(lost).lines.join(' '), /додали чи змінили в цій таблиці вручну/u);
  const edited = { ...data.get('merged'), rows: data.get('merged').rows.map((row, index) => (index === 0 ? { ...row, c3: 'змінено вручну' } : row)) };
  const manual = refreshView(schema, merged, modules, data, edited);
  assert.deepEqual([manual.added, manual.removed], [1, 1], 'ручна правка рядка видно як «зникне» і «додано»');
});

test('refreshView відмовляє: стовпці змінилися, зв’язок знято, неповне читання, не знімок; нічого не вигадує', async () => {
  const { schema, modules, merged, data, relationId } = await setup();
  const typed = new Map(data);
  typed.set('flights', { rows: data.get('flights').rows.map((row, index) => ({ ...row, tail: index === 0 ? 'А-1' : row.tail })), truncated: false });
  const changed = refreshView(schema, merged, modules, typed, data.get('merged'));
  assert.equal(changed.ok, false);
  assert.equal(changed.code, 'columns_changed');
  assert.match(changed.message, /створіть її знову/u);
  assert.match(refreshView(clearRelation(schema, relationId).schema, merged, modules, data, data.get('merged')).message, /знято або замінено/u);
  const cut = new Map(data);
  cut.set('plan', { rows: data.get('plan').rows, truncated: true });
  assert.match(refreshView(schema, merged, modules, cut, data.get('merged')).message, /не повністю/u);
  assert.match(refreshView(schema, merged, modules, data, { ...data.get('merged'), truncated: true }).message, /не повністю/u);
  assert.match(refreshView(schema, merged, modules, data, { failed: true }).message, /не повністю/u);
  assert.match(refreshView(schema, modulePlan, modules, data, data.get('plan')).message, /не створена з об’єднання/u);
  assert.match(refreshView(schema, merged, modules, new Map(), data.get('merged')).message, /не прочитано/u);
  const relabeled = { ...merged, fields: merged.fields.map((item, index) => (index === 0 ? { ...item, label: 'Інше' } : item)) };
  assert.equal(refreshView(schema, relabeled, [modulePlan, moduleFlights, relabeled], data, data.get('merged')).code, 'columns_changed');
});

test('панель і екран: знімок запам’ятовується при створенні, оновлення читає вихідні наново й питає підтвердження', async () => {
  const page = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(page, /async function createMergedModule\(request, origin = null\)/u);
  assert.match(page, /setSnapshot\(schema, \{ sourceId: moduleSourceId\(created\.id\), relationId: origin\.relationId/u);
  assert.match(page, /readModulePayload\(invoke, source\)/u);
  assert.match(page, /replaceSnapshotRows\(invoke, module, view\.request\.rows\)/u);
  assert.match(page, /snapshotPanel\(\{/u);
  const panel = await readFile(new URL('../src/table-link-snapshot-panel.js', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/table-link-snapshot-core.js', import.meta.url), 'utf8');
  for (const source of [panel, core]) {
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/u);
    assert.doesNotMatch(source, /\binvoke\b|fetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/u);
  }
  assert.match(panel, /'data-action': 'check-snapshot'/u);
  assert.match(panel, /'data-action': 'confirm-snapshot'/u);
  assert.match(panel, /Усі рядки цієї таблиці/u);
  const client = await readFile(new URL('../src/table-link-snapshot-client.js', import.meta.url), 'utf8');
  assert.match(client, /replace_dashboard_module_rows/u);
  assert.doesNotMatch(client, /fetch\(|WebSocket/u);
});
