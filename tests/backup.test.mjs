import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStagedRestoreAndRestart,
  cancelStagedRestore,
  finalizeLocalRestore,
  getRestoreStartupReport,
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
  await cancelStagedRestore(invoke);
  await applyStagedRestoreAndRestart(invoke);
  await getRestoreStartupReport(invoke);
  await finalizeLocalRestore(invoke);

  assert.deepEqual(calls, [
    ['stage_local_restore', undefined],
    ['cancel_staged_restore', undefined],
    ['apply_staged_restore_and_restart', undefined],
    ['get_restore_startup_report', undefined],
    ['finalize_local_restore', undefined],
  ]);
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
