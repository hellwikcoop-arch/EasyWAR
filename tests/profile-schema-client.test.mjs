import test from 'node:test';
import assert from 'node:assert/strict';

import { loadProfileSchema, saveProfileSchema, resetProfileSchema, updateProfileSchema, STALE_MARK } from '../src/profile-schema-client.js';
import { addSource, confirmBinding, emptySchema, parseSchema } from '../src/profile-schema-core.js';

const PROFILE = 'profile-111111111111111111111111';
const COLUMNS = [{ key: 'c_date', header: 'Дата', type: 'date' }, { key: 'c_count', header: 'К-сть БП', type: 'number' }];

/** Підміна Rust: той самий конверт, що в profile_schema.rs (ревізія, застарілий запис). */
function fakeBackend({ profile = PROFILE, stored = null, revision = 0 } = {}) {
  const state = { stored, revision, calls: [] };
  const invoke = async (command, args = {}) => {
    state.calls.push(command);
    if (command === 'get_profile_session') return profile;
    if (command === 'get_profile_schema') return { schema: state.stored, revision: state.revision, updatedAt: null };
    if (command === 'save_profile_schema') {
      if (args.expectedRevision !== state.revision || args.schema.revision <= state.revision) throw `схему профілю ${STALE_MARK}; перечитайте її й повторіть`;
      state.stored = structuredClone(args.schema);
      state.revision = args.schema.revision;
      return { schema: state.stored, revision: state.revision, updatedAt: 't' };
    }
    if (command === 'reset_profile_schema') {
      if (state.stored && args.expectedRevision !== state.revision) throw `схему профілю ${STALE_MARK}`;
      state.stored = null;
      state.revision = 0;
      return null;
    }
    throw new Error(`невідома команда ${command}`);
  };
  return { state, invoke };
}

const withSource = schema => addSource(schema, { id: 's', type: 'module-table', columns: COLUMNS });
const confirmDate = schema => confirmBinding(schema, { sourceId: 's', columnKey: 'c_date', role: 'event-date' });

test('без збереженої схеми читання дає порожню схему профілю з ревізією 0', async () => {
  const { invoke } = fakeBackend();
  const loaded = await loadProfileSchema(invoke);
  assert.ok(loaded.ok);
  assert.equal(loaded.schema.profileId, PROFILE);
  assert.equal(loaded.storedRevision, 0);
});

test('без профілю в сеансі — помилка profile_required і жодного читання схеми', async () => {
  const { invoke, state } = fakeBackend({ profile: null });
  assert.equal((await loadProfileSchema(invoke)).code, 'profile_required');
  assert.ok(!state.calls.includes('get_profile_schema'));
});

test('запис і читання назад: рішення переживають «перезапуск»', async () => {
  const { invoke, state } = fakeBackend();
  const result = await updateProfileSchema(invoke, withSource);
  assert.ok(result.ok);
  assert.equal(result.storedRevision, 1);
  const second = await updateProfileSchema(invoke, confirmDate);
  assert.ok(second.ok);
  assert.equal(second.storedRevision, 2);
  // «перезапуск»: новий клієнт над тим самим сховищем
  const again = await loadProfileSchema(fakeInvokeOver(state));
  assert.ok(again.ok);
  assert.equal(again.schema.bindings[0].role, 'event-date');
  assert.equal(again.storedRevision, 2);
});

function fakeInvokeOver(state) {
  const { invoke } = fakeBackend({ stored: state.stored, revision: state.revision });
  return invoke;
}

test('застарілий запис: зміну повторено на свіжій схемі, рішення іншого вікна не втрачено', async () => {
  const { invoke, state } = fakeBackend();
  await updateProfileSchema(invoke, withSource);
  let raced = false;
  const racing = async (command, args) => {
    if (command === 'save_profile_schema' && !raced) {
      raced = true;
      // інше вікно встигло зберегти зміну першим
      const other = parseSchema(state.stored).schema;
      const bumped = confirmBinding(other, { sourceId: 's', columnKey: 'c_count', role: 'munition-count' }).schema;
      state.stored = structuredClone(bumped);
      state.revision = bumped.revision;
    }
    return invoke(command, args);
  };
  const result = await updateProfileSchema(racing, confirmDate);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.schema.bindings.map(binding => binding.role).sort(), ['event-date', 'munition-count']);
  assert.equal(state.revision, result.schema.revision);
});

test('постійний конфлікт дає stale, а не мовчазну втрату', async () => {
  const { invoke, state } = fakeBackend();
  await updateProfileSchema(invoke, withSource);
  const stubborn = async (command, args) => {
    if (command === 'save_profile_schema') { state.revision += 1; state.stored.revision = state.revision; }
    return invoke(command, args);
  };
  const result = await updateProfileSchema(stubborn, confirmDate);
  assert.equal(result.code, 'stale');
});

test('помилка ядра не зберігається; нічого не змінилося — не пишеться', async () => {
  const { invoke, state } = fakeBackend();
  await updateProfileSchema(invoke, withSource);
  const before = state.calls.filter(call => call === 'save_profile_schema').length;
  const bad = await updateProfileSchema(invoke, schema => confirmBinding(schema, { sourceId: 'zzz', columnKey: 'c_date', role: 'event-date' }));
  assert.equal(bad.code, 'unknown_source');
  const noop = await updateProfileSchema(invoke, schema => ({ ok: true, schema }));
  assert.ok(noop.ok);
  assert.equal(state.calls.filter(call => call === 'save_profile_schema').length, before);
});

test('чужа або пошкоджена збережена схема не підміняється порожньою', async () => {
  const foreign = emptySchema('profile-222222222222222222222222');
  assert.equal((await loadProfileSchema(fakeBackend({ stored: foreign, revision: 1 }).invoke)).code, 'foreign_profile');
  const newer = { ...emptySchema(PROFILE), version: 2 };
  assert.equal((await loadProfileSchema(fakeBackend({ stored: newer, revision: 1 }).invoke)).code, 'unsupported_version');
  assert.equal((await loadProfileSchema(fakeBackend({ stored: { nonsense: true }, revision: 1 }).invoke)).ok, false);
});

test('збій команди повертається як storage', async () => {
  const broken = async () => { throw new Error('база недоступна'); };
  assert.equal((await loadProfileSchema(broken)).code, 'storage');
  assert.equal((await saveProfileSchema(broken, emptySchema(PROFILE), 0)).code, 'storage');
  assert.equal((await resetProfileSchema(broken, 0)).code, 'storage');
});

test('скидання стирає схему; застаріла ревізія відхиляється', async () => {
  const { invoke, state } = fakeBackend();
  await updateProfileSchema(invoke, withSource);
  assert.equal((await resetProfileSchema(invoke, 99)).code, 'stale');
  assert.ok(state.stored);
  assert.ok((await resetProfileSchema(invoke, state.revision)).ok);
  assert.equal(state.stored, null);
});
