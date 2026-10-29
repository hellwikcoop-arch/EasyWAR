import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ROLE_OPTIONS, applyRoleChoice, rejectRoleSuggestion, rolesPanelModel, roleLabel } from '../src/profile-schema-view-core.js';
import { addSource, emptySchema, resolveRoles } from '../src/profile-schema-core.js';

const must = result => { assert.ok(result.ok, JSON.stringify(result)); return result.schema; };
const COLUMNS = [
  { key: 'day', header: 'Дата', type: 'date' },
  { key: 'bp', header: 'К-сть БП', type: 'number' },
  { key: 'misc', header: 'Різне', type: 'text' },
  { key: 'when', header: 'Дата події', type: 'date' },
];
const base = () => must(addSource(emptySchema('profile-111111111111111111111111'), { id: 's', type: 'module-table', columns: COLUMNS }));
const row = (model, key) => model.rows.find(item => item.key === key);

test('порожня схема: пропозиції за заголовками, нічого не підтверджено', () => {
  const model = rolesPanelModel(base(), 's');
  assert.equal(model.confirmedCount, 0);
  assert.equal(model.summary, 'Ролей ще не підтверджено');
  assert.equal(row(model, 'day').state, 'suggested');
  assert.equal(row(model, 'day').role, 'event-date');
  assert.equal(row(model, 'bp').role, 'munition-count');
  assert.equal(row(model, 'bp').unit, 'шт');
  assert.equal(row(model, 'misc').state, 'unknown');
  assert.equal(row(model, 'misc').role, '');
});

test('підтвердження: стан confirmed, пропозиція зникає, зайнята роль показується іншим стовпцям', () => {
  const schema = must(applyRoleChoice(base(), { sourceId: 's', columnKey: 'day', role: 'event-date', at: 't' }));
  const model = rolesPanelModel(schema, 's');
  assert.equal(row(model, 'day').state, 'confirmed');
  assert.equal(model.confirmedCount, 1);
  assert.equal(row(model, 'when').takenBy['event-date'], 'Дата');
  assert.equal(row(model, 'when').state, 'unknown'); // роль зайнята — повторно не пропонується
});

test('перенос ролі на інший стовпець і її зняття', () => {
  let schema = must(applyRoleChoice(base(), { sourceId: 's', columnKey: 'day', role: 'event-date' }));
  schema = must(applyRoleChoice(schema, { sourceId: 's', columnKey: 'when', role: 'event-date' }));
  assert.equal(resolveRoles(schema, 's')['event-date'].columnKey, 'when');
  schema = must(applyRoleChoice(schema, { sourceId: 's', columnKey: 'when', role: '' }));
  assert.deepEqual(resolveRoles(schema, 's'), {});
  assert.equal(applyRoleChoice(schema, { sourceId: 's', columnKey: 'when', role: '' }).schema, schema);
});

test('зміна ролі стовпця знімає стару: один стовпець — одна роль', () => {
  let schema = must(applyRoleChoice(base(), { sourceId: 's', columnKey: 'misc', role: 'event-date' }));
  schema = must(applyRoleChoice(schema, { sourceId: 's', columnKey: 'misc', role: 'target-type' }));
  assert.deepEqual(Object.keys(resolveRoles(schema, 's')), ['target-type']);
});

test('числова роль зберігає одиницю людини; без одиниці — типова', () => {
  let schema = must(applyRoleChoice(base(), { sourceId: 's', columnKey: 'bp', role: 'munition-count', unit: 'пуски' }));
  assert.equal(rolesPanelModel(schema, 's').rows[1].unit, 'пуски');
  schema = must(applyRoleChoice(base(), { sourceId: 's', columnKey: 'bp', role: 'munition-count' }));
  assert.equal(rolesPanelModel(schema, 's').rows[1].unit, 'шт');
});

test('«це не вона»: пропозиція більше не повертається', () => {
  const schema = must(rejectRoleSuggestion(base(), { sourceId: 's', columnKey: 'day', role: 'event-date' }));
  assert.equal(row(rolesPanelModel(schema, 's'), 'day').state, 'unknown');
});

test('невідоме джерело і довідник ролей', () => {
  assert.equal(rolesPanelModel(base(), 'zzz').code, 'unknown_source');
  assert.ok(ROLE_OPTIONS.some(option => option.role === 'munition-count' && option.numeric));
  assert.ok(ROLE_OPTIONS.every(option => option.label));
  assert.equal(roleLabel('event-date'), 'Дата події');
});

test('сторінка модуля показує панель ролей і не чіпає дані без підтвердження', async () => {
  const page = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(page, /import \{ rolesPanel \} from '\.\/profile-schema-panel\.js';/u);
  assert.match(page, /rolesPanel\(\{ el, invoke, module, modules: \(\) => state\.modules \}\)/u);
  const panel = await readFile(new URL('../src/profile-schema-panel.js', import.meta.url), 'utf8');
  // зміни тільки з кнопок «Підтвердити», «Це не вона», «Зняти»; відкриття панелі лише читає
  assert.equal((panel.match(/updateProfileSchema\(/gu) || []).length, 1);
  assert.match(panel, /panel\.addEventListener\('toggle', \(\) => \{ if \(panel\.open && !schema\) refresh\(\); \}\);/u);
  assert.doesNotMatch(panel, /stroke-dasharray/u);
});
