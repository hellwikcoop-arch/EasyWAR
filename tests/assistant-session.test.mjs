import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantSession } from '../src/assistant/assistant-session-core.js';

test('assistant is disabled until a profile is unlocked and explicitly opted in', () => {
  const session = createAssistantSession();
  assert.equal(session.state().enabled, false);
  session.setEnabled(true);
  assert.equal(session.state().enabled, false);
  session.setProfile('synthetic-a');
  assert.equal(session.state().enabled, false);
  session.setEnabled(true);
  assert.equal(session.accepts(session.token()), true);
});

test('locking or changing profiles invalidates pending work and resets opt-in', () => {
  const session = createAssistantSession();
  session.setProfile('synthetic-a'); session.setEnabled(true);
  const first = session.token();
  session.setProfile(null);
  assert.equal(session.accepts(first), false);
  session.setProfile('synthetic-a');
  assert.equal(session.state().enabled, false);
  session.setEnabled(true);
  assert.equal(session.accepts(first), false, 'same ID after another login does not revive old work');
  const second = session.token();
  session.setProfile('synthetic-b');
  assert.equal(session.state().enabled, false);
  assert.equal(session.accepts(second), false);
});

test('refreshing the same profile retains opt-in but disabling never revives old tokens', () => {
  const session = createAssistantSession();
  session.setProfile('synthetic-a'); session.setEnabled(true);
  const token = session.token();
  session.setProfile('synthetic-a');
  assert.equal(session.accepts(token), true);
  session.setEnabled(false); session.setEnabled(true);
  assert.equal(session.accepts(token), false);
  const next = session.token(); session.invalidate();
  assert.equal(session.accepts(next), false);
  assert.equal(session.state().enabled, true);
  session.reset();
  assert.deepEqual(session.state(), { profileId: null, enabled: false, revision: next.revision + 2 });
});
