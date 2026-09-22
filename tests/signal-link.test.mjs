import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSignalLinkSession,
  completeSignalLinkSession,
  createSignalLinkSession,
} from '../src/signal-link.js';

test('short-lived synthetic link URI exists only in a waiting session', () => {
  const uri = 'sgnl://linkdevice?uuid=synthetic&pub_key=synthetic';
  const waiting = createSignalLinkSession(uri);
  assert.equal(waiting.phase, 'waiting');
  assert.equal(waiting.deviceLinkUri, uri);

  const cleared = clearSignalLinkSession();
  assert.deepEqual(cleared, { phase: 'idle', deviceLinkUri: null });
  const complete = completeSignalLinkSession({ id: 'synthetic-account' });
  assert.deepEqual(complete, {
    phase: 'complete',
    deviceLinkUri: null,
    accountId: 'synthetic-account',
  });
  assert.doesNotMatch(JSON.stringify(complete), /pub_key/);
});

test('link session rejects non-Signal and malformed URIs', () => {
  for (const uri of [
    'https://example.invalid/link',
    'sgnl://linkdevice?uuid=synthetic\n',
    '',
    null,
  ]) {
    assert.throws(() => createSignalLinkSession(uri), /некоректне/);
  }
});

test('completed link requires a synthetic account identity', () => {
  assert.throws(() => completeSignalLinkSession(null), /ідентичність/);
  assert.throws(() => completeSignalLinkSession({ id: ' ' }), /ідентичність/);
});
