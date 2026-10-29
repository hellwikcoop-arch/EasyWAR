import test from 'node:test';
import assert from 'node:assert/strict';

import { loadDashboardLayout, saveDashboardLayout, resetDashboardLayout, updateDashboardLayout } from '../src/dashboard-layout-client.js';
import { STALE_MARK } from '../src/profile-schema-client.js';
import { addInstance, duplicateInstance, updateInstance, emptyLayout } from '../src/module-instance-core.js';

const PROFILE = 'profile-111111111111111111111111';

/** Підміна Rust: той самий конверт, що в dashboard_layout.rs (ревізія, застарілий запис). */
function fakeBackend({ profile = PROFILE, stored = null, revision = 0 } = {}) {
  const state = { stored, revision, calls: [] };
  const invoke = async (command, args = {}) => {
    state.calls.push(command);
    if (command === 'get_profile_session') return profile;
    if (command === 'get_dashboard_layout') return { layout: state.stored, revision: state.revision, updatedAt: null };
    if (command === 'save_dashboard_layout') {
      if (args.expectedRevision !== state.revision || args.layout.revision <= state.revision) throw `розкладку дашборда ${STALE_MARK}; перечитайте її й повторіть`;
      state.stored = structuredClone(args.layout);
      state.revision = args.layout.revision;
      return { layout: state.stored, revision: state.revision, updatedAt: 't' };
    }
    if (command === 'reset_dashboard_layout') {
      if (state.stored && args.expectedRevision !== state.revision) throw `розкладку дашборда ${STALE_MARK}`;
      state.stored = null;
      state.revision = 0;
      return null;
    }
    throw new Error(`невідома команда ${command}`);
  };
  return { state, invoke };
}

const addDay = layout => addInstance(layout, { definitionId: 'by-day', sourceId: 'module:m1' });

test('без збереженої розкладки читання дає порожню з ревізією 0', async () => {
  const { invoke } = fakeBackend();
  const loaded = await loadDashboardLayout(invoke);
  assert.ok(loaded.ok);
  assert.equal(loaded.storedRevision, 0);
  assert.equal(loaded.layout.profileId, PROFILE);
  assert.equal(loaded.layout.dashboardId, 'my');
});

test('без профілю розкладку не читаємо і Rust не кличемо', async () => {
  const { invoke, state } = fakeBackend({ profile: null });
  assert.equal((await loadDashboardLayout(invoke)).code, 'profile_required');
  assert.ok(!state.calls.includes('get_dashboard_layout'));
});

test('змінили → збережено → прочитано: картки, періоди й копії цілі', async () => {
  const { invoke } = fakeBackend();
  const first = await updateDashboardLayout(invoke, addDay);
  assert.ok(first.ok);
  assert.equal(first.storedRevision, 1);
  const second = await updateDashboardLayout(invoke, layout => duplicateInstance(layout, 'by-day#1'));
  assert.equal(second.storedRevision, 2);
  const third = await updateDashboardLayout(invoke, layout => updateInstance(layout, 'by-day#2', { period: { mode: 'last-days', days: 7 } }));
  assert.equal(third.storedRevision, 3);
  const again = await loadDashboardLayout(fakeBackendOver(invoke));
  assert.deepEqual(again.layout.instances.map(i => [i.id, i.period.mode]), [['by-day#1', 'shared'], ['by-day#2', 'last-days']]);
});

// Той самий `invoke`, окремий виклик: «перезапуск» застосунку над тим самим сховищем.
const fakeBackendOver = invoke => invoke;

test('застарілий запис: одне перечитування й повтор зміни на свіжій розкладці', async () => {
  const { invoke, state } = fakeBackend();
  await updateDashboardLayout(invoke, addDay);
  let raced = false;
  const racing = async (command, args) => {
    if (command === 'save_dashboard_layout' && !raced) {
      raced = true;
      // інше вікно встигло записати свою зміну
      const other = structuredClone(state.stored);
      other.revision += 1;
      other.instances[0].title = 'інше вікно';
      state.stored = other;
      state.revision = other.revision;
    }
    return invoke(command, args);
  };
  const result = await updateDashboardLayout(racing, layout => duplicateInstance(layout, 'by-day#1'));
  assert.ok(result.ok);
  assert.equal(state.stored.instances.length, 2);
  assert.equal(state.stored.instances[0].title, 'інше вікно');
});

test('друге застаріле підряд — чесна помилка, не мовчазна втрата', async () => {
  const { invoke, state } = fakeBackend();
  await updateDashboardLayout(invoke, addDay);
  const stubborn = async (command, args) => {
    if (command === 'save_dashboard_layout') { state.revision += 1; state.stored.revision = state.revision; }
    return invoke(command, args);
  };
  const result = await updateDashboardLayout(stubborn, layout => duplicateInstance(layout, 'by-day#1'));
  assert.equal(result.code, 'stale');
});

test('зміна без наслідку нічого не пише, помилка ядра доходить без запису', async () => {
  const { invoke, state } = fakeBackend();
  await updateDashboardLayout(invoke, addDay);
  const writes = () => state.calls.filter(call => call === 'save_dashboard_layout').length;
  const before = writes();
  assert.equal((await updateDashboardLayout(invoke, layout => updateInstance(layout, 'нема', { title: 'x' }))).code, 'unknown_instance');
  assert.ok((await updateDashboardLayout(invoke, layout => ({ ok: true, layout }))).ok);
  assert.equal(writes(), before);
});

test('чужу, новішу чи пошкоджену розкладку не підміняємо порожньою', async () => {
  const foreign = JSON.parse(JSON.stringify(emptyLayout('profile-999999999999999999999999')));
  foreign.revision = 1;
  assert.equal((await loadDashboardLayout(fakeBackend({ stored: foreign, revision: 1 }).invoke)).code, 'foreign_profile');
  const newer = { ...JSON.parse(JSON.stringify(emptyLayout(PROFILE))), version: 2, revision: 1 };
  assert.equal((await loadDashboardLayout(fakeBackend({ stored: newer, revision: 1 }).invoke)).code, 'unsupported_version');
  assert.equal((await loadDashboardLayout(fakeBackend({ stored: { nonsense: true }, revision: 1 }).invoke)).ok, false);
});

test('скидання повертає порожню розкладку, застаріле скидання відхиляється', async () => {
  const { invoke, state } = fakeBackend();
  await updateDashboardLayout(invoke, addDay);
  assert.equal((await resetDashboardLayout(invoke, 7)).code, 'stale');
  assert.ok(state.stored);
  assert.ok((await resetDashboardLayout(invoke, 1)).ok);
  assert.equal((await loadDashboardLayout(invoke)).layout.instances.length, 0);
});

test('збій сховища — код storage, а не виняток', async () => {
  const broken = async () => { throw new Error('диск'); };
  assert.equal((await loadDashboardLayout(broken)).code, 'storage');
  assert.equal((await saveDashboardLayout(broken, emptyLayout(PROFILE), 0)).code, 'storage');
});
