import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appUpdateMessage,
  applyStagedRestoreAndRestart,
  cancelStagedRestore,
  checkForAppUpdate,
  databaseStatusMessage,
  finalizeLocalRestore,
  getDatabaseStatus,
  getRestoreStartupReport,
  installAppUpdate,
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

  assert.deepEqual(calls, [
    ['check_for_app_update', undefined],
    ['install_app_update', undefined],
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
