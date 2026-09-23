import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateLocalProfile,
  activeProfileLabel,
  createLocalProfile,
  deleteLocalProfile,
  getLocalProfiles,
  renameLocalProfile,
} from '../src/local-profiles-core.js';

test('local profile helpers call only dedicated desktop commands', async () => {
  const calls = [];
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    return { activeProfileId: null, profiles: [] };
  };

  await getLocalProfiles(invoke);
  await createLocalProfile('Навчальний', invoke);
  await renameLocalProfile('profile-000000000000000000000000', 'Оновлений', invoke);
  await activateLocalProfile('profile-000000000000000000000000', invoke);
  await deleteLocalProfile('profile-000000000000000000000000', invoke);

  assert.deepEqual(calls, [
    ['get_local_profiles', undefined],
    ['create_local_profile', { displayName: 'Навчальний' }],
    ['rename_local_profile', {
      profileId: 'profile-000000000000000000000000',
      displayName: 'Оновлений',
    }],
    ['activate_local_profile', { profileId: 'profile-000000000000000000000000' }],
    ['delete_local_profile', { profileId: 'profile-000000000000000000000000' }],
  ]);
});

test('active profile label is explicit and contains no role claim', () => {
  assert.equal(activeProfileLabel({ activeProfileId: null, profiles: [] }), 'Профілі');
  assert.equal(activeProfileLabel({
    activeProfileId: 'profile-000000000000000000000000',
    profiles: [{
      id: 'profile-000000000000000000000000',
      displayName: 'Навчальний оператор',
    }],
  }), 'Профіль: Навчальний оператор');
  assert.doesNotMatch(activeProfileLabel({
    activeProfileId: 'profile-000000000000000000000000',
    profiles: [{
      id: 'profile-000000000000000000000000',
      displayName: 'Навчальний оператор',
    }],
  }), /роль|авториз/i);
});
