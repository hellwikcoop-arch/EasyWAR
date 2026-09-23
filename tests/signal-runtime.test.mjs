import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describePersistedSignalInbox,
  describeSignalRuntime,
} from '../src/signal-runtime.js';

test('Signal is described as disconnected with no saved configuration', () => {
  const state = describeSignalRuntime(null);
  assert.equal(state.connected, false);
  assert.equal(state.receiving, false);
  assert.match(state.message, /не отримує повідомлень/);
});

test('a saved enabled flag never claims that EasyWAR is connected', () => {
  const state = describeSignalRuntime({ intake_enabled: true });
  assert.equal(state.connected, false);
  assert.equal(state.receiving, false);
  assert.match(state.message, /позначка приймання/);
  assert.match(state.message, /не отримує повідомлень/);
});

test('an explicit active session is described as bounded receiving', () => {
  const state = describeSignalRuntime(
    { intake_enabled: false },
    { active: true, account: 'synthetic-account' },
  );
  assert.equal(state.connected, true);
  assert.equal(state.receiving, true);
  assert.match(state.message, /явний сеанс/);
  assert.match(state.message, /64 повідомлень/);
  assert.match(state.message, /5 хвилин/);
});

test('persisted Signal Inbox describes an empty local queue', () => {
  const state = describePersistedSignalInbox(null);
  assert.deepEqual(state.rows, []);
  assert.equal(state.message, 'Локальна черга Signal порожня.');
});

test('persisted Signal Inbox exposes only normalized list fields', () => {
  const state = describePersistedSignalInbox([{
    report_id: 'synthetic-report-1',
    source_item_key: 'synthetic-source-item-1',
    captured_at: '2026-01-02T03:04:00Z',
    current_status: 'NEEDS_REVIEW',
    raw_text: 'SECRET-SYNTHETIC-MESSAGE',
    raw_payload_json: { message: 'SECRET-SYNTHETIC-PAYLOAD' },
  }]);

  assert.equal(state.message, 'Записів у локальній черзі Signal: 1.');
  assert.deepEqual(Object.keys(state.rows[0]), [
    'reportId', 'sourceItemKey', 'capturedAt', 'statusLabel',
  ]);
  assert.equal(state.rows[0].reportId, 'synthetic-report-1');
  assert.equal(state.rows[0].statusLabel, 'Потребує перевірки');
  assert.match(state.rows[0].capturedAt, /02\.01\.2026/);
  assert.doesNotMatch(JSON.stringify(state.rows), /SECRET-SYNTHETIC/);
});
