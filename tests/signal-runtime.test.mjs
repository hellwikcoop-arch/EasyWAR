import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSignalRuntime } from '../src/signal-runtime.js';

test('Signal is described as disconnected with no saved configuration', () => {
  const state = describeSignalRuntime(null);
  assert.equal(state.connected, false);
  assert.equal(state.receiving, false);
  assert.match(state.message, /не підключений/);
});

test('a saved enabled flag never claims that EasyWAR is connected', () => {
  const state = describeSignalRuntime({ intake_enabled: true });
  assert.equal(state.connected, false);
  assert.equal(state.receiving, false);
  assert.match(state.message, /позначка приймання/);
});
