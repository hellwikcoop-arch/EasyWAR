import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  appUpdateMessage,
  applyStagedRestoreAndRestart,
  cancelStagedRestore,
  autoCheckForAppUpdate,
  checkForAppUpdate,
  databaseStatusMessage,
  finalizeLocalRestore,
  getDatabaseStatus,
  getRestoreStartupReport,
  getAppUpdateSettings,
  installAppUpdate,
  LIBRARY_BACKUP_NOTE,
  LIBRARY_RESTORE_NOTE,
  PROFILE_DATA_BACKUP_NOTE,
  createProfileDataBackup,
  profileDataBackupMessage,
  profileDataRestoreMessage,
  restoreProfileDataBackup,
  setAppUpdateAutoCheck,
  restoreStartupMessage,
  stageLocalRestore,
} from '../src/backup-core.js';

test('restore helpers call only the dedicated desktop commands', async () => {
  const calls = [];
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    return null;
  };

  await stageLocalRestore(invoke);
  await getDatabaseStatus(invoke);
  await cancelStagedRestore(invoke);
  await applyStagedRestoreAndRestart(invoke);
  await getRestoreStartupReport(invoke);
  await finalizeLocalRestore(invoke);

  assert.deepEqual(calls, [
    ['stage_local_restore', undefined],
    ['get_database_status', undefined],
    ['cancel_staged_restore', undefined],
    ['apply_staged_restore_and_restart', undefined],
    ['get_restore_startup_report', undefined],
    ['finalize_local_restore', undefined],
  ]);
});

test('database status message exposes verified app and migration versions', () => {
  assert.equal(databaseStatusMessage({
    appVersion: '0.5.0',
    schemaVersion: 4,
    supportedSchemaVersion: 4,
    migrationCount: 4,
    migrationState: 'current',
  }), 'EasyWAR 0.5.0. Схема SQLite 4 із 4; перевірено міграцій: 4. Стан актуальний.');
  assert.throws(() => databaseStatusMessage({
    appVersion: '0.5.0',
    schemaVersion: 3,
    supportedSchemaVersion: 4,
    migrationCount: 3,
    migrationState: 'current',
  }), TypeError);
  assert.throws(() => databaseStatusMessage({ migrationState: 'unknown' }), TypeError);
});

test('restore startup messages keep applied, rollback, pending and failure distinct', () => {
  assert.equal(restoreStartupMessage({ outcome: 'none', pendingRestoreAvailable: false }), '');
  assert.match(
    restoreStartupMessage({ outcome: 'none', pendingRestoreAvailable: true }),
    /підготовлена копія/,
  );
  assert.match(restoreStartupMessage({ outcome: 'applied' }), /Попередню базу збережено/);
  assert.match(restoreStartupMessage({ outcome: 'rolled_back' }), /безпечно відкотили/);
  assert.match(
    restoreStartupMessage({ outcome: 'failed', detail: 'synthetic failure' }),
    /synthetic failure/,
  );
  assert.throws(() => restoreStartupMessage({ outcome: 'unexpected' }), TypeError);
});

test('app update helpers call only the dedicated desktop commands', async () => {
  const calls = [];
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    return null;
  };

  await checkForAppUpdate(invoke);
  await installAppUpdate(invoke);
  await getAppUpdateSettings(invoke);
  await setAppUpdateAutoCheck(1, invoke);
  await autoCheckForAppUpdate(invoke);

  assert.deepEqual(calls, [
    ['check_for_app_update', undefined],
    ['install_app_update', undefined],
    ['get_app_update_settings', undefined],
    ['set_app_update_auto_check', { enabled: true }],
    ['auto_check_for_app_update', undefined],
  ]);
});

test('app update message separates unconfigured, current and available builds', () => {
  assert.match(
    appUpdateMessage({ configured: false, currentVersion: '0.5.0', available: null }),
    /не налаштовано/,
  );
  assert.equal(
    appUpdateMessage({ configured: true, currentVersion: '0.5.0', available: null }),
    'Встановлено актуальну версію EasyWAR 0.5.0.',
  );
  assert.equal(
    appUpdateMessage({
      configured: true,
      currentVersion: '0.5.0',
      available: { version: '0.6.0', notes: 'Синтетичний опис змін.' },
    }),
    'Доступна версія 0.6.0 (зараз 0.5.0). Що нового: Синтетичний опис змін.',
  );
  assert.throws(() => appUpdateMessage(null), TypeError);
});

test('the automatic update check runs only after the user turns it on', async () => {
  const source = await readFile(new URL('../src/backup.js', import.meta.url), 'utf8');
  assert.match(source, /<input type="checkbox" id="ew-app-update-auto">/, 'unchecked by default');
  assert.equal(source.match(/autoCheckForAppUpdate\(\)/g).length, 1, 'one call site, inside autoCheck');
  const starts = source.match(/void autoCheck\(\)|await autoCheck\(\)/g);
  assert.equal(starts.length, 2);
  assert.match(source, /if \(settings\?\.enabled\) void autoCheck\(\);/, 'at start-up only when turned on');
  assert.match(source, /if \(settings\?\.enabled\) await autoCheck\(\);/, 'right after the user turns it on');
});

test('backup and restore warn that the encrypted office library travels with the database copy', async () => {
  assert.match(LIBRARY_BACKUP_NOTE, /бібліотеку «Робочого середовища»/);
  assert.match(LIBRARY_BACKUP_NOTE, /зашифрован/);
  assert.match(LIBRARY_BACKUP_NOTE, /пароль профілю, чинний на час створення копії/);
  assert.match(LIBRARY_RESTORE_NOTE, /до стану на час копії/);
  assert.match(LIBRARY_RESTORE_NOTE, /до видалення профілю разом з бібліотекою/);
  const source = await readFile(new URL('../src/backup.js', import.meta.url), 'utf8');
  assert.match(source, /<p class="ew-backup-warning">\$\{LIBRARY_BACKUP_NOTE\}<\/p>/);
  assert.match(source, /<p class="ew-backup-warning">\$\{LIBRARY_RESTORE_NOTE\}<\/p>/);
});

test('profile data backup calls only its dedicated commands and never passes the password to create', async () => {
  const calls = [];
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    return null;
  };
  await createProfileDataBackup(invoke);
  await restoreProfileDataBackup('синтетичний-пароль', invoke);
  assert.deepEqual(calls, [
    ['profile_data_backup_create', undefined],
    ['profile_data_backup_restore', { password: 'синтетичний-пароль' }],
  ]);
  assert.match(PROFILE_DATA_BACKUP_NOTE, /\.ewpdb/);
});

test('profile data backup messages describe the outcome in Ukrainian', () => {
  assert.match(profileDataBackupMessage(null), /скасовано/);
  assert.match(profileDataBackupMessage({ path: '/x/a.ewpdb', records: 3 }), /записів: 3/);
  assert.match(profileDataRestoreMessage(null), /скасовано/);
  const text = profileDataRestoreMessage({ total: 5, restored: 3, keptNewer: 1, skipped: 1 });
  assert.match(text, /відновлено: 3/);
  assert.match(text, /новіші в профілі: 1/);
  assert.match(text, /пропущено.*: 1/);
  assert.doesNotMatch(profileDataRestoreMessage({ total: 2, restored: 2, keptNewer: 0, skipped: 0 }), /новіші|пропущено/);
});

test('backup dialog exposes the profile data section and disables it while busy', async () => {
  const source = await readFile(new URL('../src/backup.js', import.meta.url), 'utf8');
  assert.match(source, /ew-profile-data-create/);
  assert.match(source, /ew-profile-data-restore/);
  assert.match(source, /profileDataCreateButton\.disabled = value/);
  assert.match(source, /profileDataRestoreButton\.disabled = value/);
  assert.match(source, /type="password" id="ew-profile-data-password"/);
});
