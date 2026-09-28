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
    createProfileBaseTable,
  } = await import('../src/local-profiles-core.js');

  await signInLocalProfile(id, 'секрет', invoke);
  await updateLocalProfileDetails(id, 'Начальник штабу', '', invoke);
  await setLocalProfilePassword(id, '', 'новий-пароль', invoke);
  await chooseProfileDatabase(id, 'air', invoke);
  await clearProfileDatabase(id, 'rocket', invoke);
  assert.deepEqual(await readProfileDatabase(id, 'rocket', invoke), new Uint8Array([80, 75]));
  await writeProfileDatabase(id, 'rocket', new Uint8Array([1]), invoke);
  await createProfileBaseTable(id, 'rvia', invoke);

  assert.deepEqual(calls, [
    ['activate_local_profile', { profileId: id, password: 'секрет' }, undefined],
    ['update_local_profile_details', { profileId: id, position: 'Начальник штабу', avatarDataUrl: null }, undefined],
    ['set_local_profile_password', { profileId: id, currentPassword: null, newPassword: 'новий-пароль' }, undefined],
    ['choose_profile_database', { profileId: id, branch: 'air' }, undefined],
    ['clear_profile_database', { profileId: id, branch: 'rocket' }, undefined],
    ['read_profile_database', { profileId: id, branch: 'rocket' }, undefined],
    ['write_profile_database', new Uint8Array([1]), { headers: { 'x-easywar-profile': id, 'x-easywar-branch': 'rocket' } }],
    ['create_profile_base_table', { profileId: id, table: 'rvia' }, undefined],
  ]);
});

test('each branch has its own table slot and base tables open in their module', async () => {
  const { BASE_TABLES, PROFILE_BRANCHES, profileTablePath } = await import('../src/local-profiles-core.js');
  const profile = { tables: { air: '/synthetic/air.xlsx', rocket: null } };
  assert.equal(profileTablePath(profile, 'air'), '/synthetic/air.xlsx');
  assert.equal(profileTablePath(profile, 'rocket'), null);
  assert.equal(profileTablePath({}, 'air'), null);
  assert.deepEqual(PROFILE_BRANCHES.map(item => item.branch), ['air', 'rocket']);
  assert.deepEqual(
    Object.fromEntries(BASE_TABLES.map(table => [table.key, table.branch])),
    { air: 'air', pvk: 'air', rvia: 'rocket' },
  );
});

test('profile database handle reads and writes through the bound file', async () => {
  const { profileDatabaseHandle } = await import('../src/local-profiles-core.js');
  const written = [];
  const invoke = async (command, payload, options) => {
    if (command === 'read_profile_database') {
      assert.equal(payload.branch, 'rocket');
      return new Uint8Array([80, 75, 3]).buffer;
    }
    assert.equal(options.headers['x-easywar-branch'], 'rocket');
    written.push(payload);
    return null;
  };
  const handle = profileDatabaseHandle('profile-000000000000000000000000', 'rocket', 'AVIA_BASE.xlsx', invoke);
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

  const bytes = await readProfileDatabase('synthetic', 'air', async () => foreign);

  assert.equal(bytes.buffer instanceof ArrayBuffer, true);
  assert.deepEqual([...bytes], [80, 75, 3, 4]);

  // From the launcher the bytes go to the module frame: they must belong to that window.
  const frame = vm.runInNewContext('({ Uint8Array, ArrayBuffer })');
  const framed = await readProfileDatabase('synthetic', 'rocket', async () => new Uint8Array([80, 75]).buffer, frame);
  assert.equal(framed.buffer instanceof frame.ArrayBuffer, true);
  assert.equal(framed.buffer instanceof ArrayBuffer, false);
  assert.deepEqual([...framed], [80, 75]);
});
