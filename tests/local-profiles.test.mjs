import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
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

test('profile details, password and database helpers use dedicated commands', async () => {
  const calls = [];
  const invoke = async (command, payload, options) => {
    calls.push([command, payload, options]);
    return command === 'read_profile_database' ? new Uint8Array([80, 75]).buffer : null;
  };
  const id = 'profile-000000000000000000000000';
  const {
    signInLocalProfile, updateLocalProfileDetails, setLocalProfilePassword,
    chooseProfileDatabase, clearProfileDatabase, readProfileDatabase, writeProfileDatabase,
  } = await import('../src/local-profiles-core.js');

  await signInLocalProfile(id, 'секрет', invoke);
  await updateLocalProfileDetails(id, 'Начальник штабу', '', invoke);
  await setLocalProfilePassword(id, '', 'новий-пароль', invoke);
  await chooseProfileDatabase(id, invoke);
  await clearProfileDatabase(id, invoke);
  assert.deepEqual(await readProfileDatabase(id, invoke), new Uint8Array([80, 75]));
  await writeProfileDatabase(id, new Uint8Array([1]), invoke);

  assert.deepEqual(calls, [
    ['activate_local_profile', { profileId: id, password: 'секрет' }, undefined],
    ['update_local_profile_details', { profileId: id, position: 'Начальник штабу', avatarDataUrl: null }, undefined],
    ['set_local_profile_password', { profileId: id, currentPassword: null, newPassword: 'новий-пароль' }, undefined],
    ['choose_profile_database', { profileId: id }, undefined],
    ['clear_profile_database', { profileId: id }, undefined],
    ['read_profile_database', { profileId: id }, undefined],
    ['write_profile_database', new Uint8Array([1]), { headers: { 'x-easywar-profile': id } }],
  ]);
});

test('profile database handle reads and writes through the bound file', async () => {
  const { profileDatabaseHandle } = await import('../src/local-profiles-core.js');
  const written = [];
  const invoke = async (command, payload) => {
    if (command === 'read_profile_database') return new Uint8Array([80, 75, 3]).buffer;
    written.push(payload);
    return null;
  };
  const handle = profileDatabaseHandle('profile-000000000000000000000000', 'AVIA_BASE.xlsx', invoke);
  const file = await handle.getFile();
  assert.equal(file.name, 'AVIA_BASE.xlsx');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([80, 75, 3]));
  const writable = await handle.createWritable();
  await writable.write(new Uint8Array([80, 75, 9]));
  await writable.close();
  assert.deepEqual(written, [new Uint8Array([80, 75, 9])]);
  assert.equal(await handle.requestPermission({ mode: 'readwrite' }), 'granted');
});

test('only password-protected profiles outside the session are locked', async () => {
  const { isProfileLocked, databaseFileName } = await import('../src/local-profiles-core.js');
  const id = 'profile-000000000000000000000000';
  assert.equal(isProfileLocked({ id, hasPassword: false }, null), false);
  assert.equal(isProfileLocked({ id, hasPassword: true }, null), true);
  assert.equal(isProfileLocked({ id, hasPassword: true }, id), false);
  assert.equal(databaseFileName('/Users/x/AVIA_BASE.xlsx'), 'AVIA_BASE.xlsx');
  assert.equal(databaseFileName('C:\\bases\\ROCKET.xlsx'), 'ROCKET.xlsx');
});

test('profile database bytes are copied into this realm', async () => {
  const { readProfileDatabase } = await import('../src/local-profiles-core.js');
  // An ArrayBuffer from another realm, as the launcher window hands it to a module frame.
  const foreign = vm.runInNewContext('new Uint8Array([80, 75, 3, 4]).buffer');
  assert.equal(foreign instanceof ArrayBuffer, false);

  const bytes = await readProfileDatabase('synthetic', async () => foreign);

  assert.equal(bytes.buffer instanceof ArrayBuffer, true);
  assert.deepEqual([...bytes], [80, 75, 3, 4]);
});
