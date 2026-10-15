import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppUpdateState } from '../src/app-update-state-core.js';

test('update status is read-only metadata until the existing updater publishes a result', () => {
  const state = createAppUpdateState();
  assert.deepEqual(state.getSnapshot(), { status: 'unchecked' });
  const seen = [];
  const unsubscribe = state.subscribe(snapshot => seen.push(snapshot.status));
  state.publish({ status: 'checking' });
  state.publish({ status: 'available', currentVersion: '2.0.1', availableVersion: '2.0.2' });
  assert.deepEqual(state.getSnapshot(), { status: 'available', currentVersion: '2.0.1', availableVersion: '2.0.2' });
  assert.equal(Object.isFrozen(state.getSnapshot()), true);
  unsubscribe();
  state.publish({ status: 'current', currentVersion: '2.0.2' });
  assert.deepEqual(seen, ['checking', 'available']);
});

test('updater metadata rejects arbitrary text, paths and missing release versions', () => {
  const state = createAppUpdateState();
  state.publish({ status: 'available', currentVersion: '/private/current', availableVersion: 'file:///secret', path: '/private/database', notes: 'secret' });
  assert.deepEqual(state.getSnapshot(), { status: 'error' });
  state.publish({ status: 'unconfigured', currentVersion: '2.0.1', path: '/private/database' });
  assert.deepEqual(state.getSnapshot(), { status: 'unconfigured', currentVersion: '2.0.1' });
  state.publish({ status: '<script>' });
  assert.deepEqual(state.getSnapshot(), { status: 'unchecked' });
});
