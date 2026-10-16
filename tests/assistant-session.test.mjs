import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantSession } from '../src/assistant/assistant-session-core.js';

test('assistant is off without a profile and starts on for a verified profile', () => {
  const session = createAssistantSession();
  assert.equal(session.state().enabled, false);
  session.setEnabled(true);
  assert.equal(session.state().enabled, false, 'no profile, no assistant');
  session.setProfile('synthetic-a');
  assert.equal(session.state().enabled, true, 'a verified profile starts with the assistant on');
  assert.equal(session.accepts(session.token()), true);
  session.setEnabled(false);
  assert.equal(session.state().enabled, false, 'the user can switch it off');
  assert.equal(session.accepts(session.token()), false);
});

test('locking or changing profiles invalidates pending work and starts a new session', () => {
  const session = createAssistantSession();
  session.setProfile('synthetic-a');
  const first = session.token();
  session.setProfile(null);
  assert.equal(session.state().enabled, false);
  assert.equal(session.accepts(first), false);
  session.setProfile('synthetic-a');
  assert.equal(session.state().enabled, true);
  assert.equal(session.accepts(first), false, 'same ID after another login does not revive old work');
  const second = session.token();
  session.setProfile('synthetic-b');
  assert.equal(session.accepts(second), false);
  assert.equal(session.state().enabled, true);
});

test('refreshing the same profile keeps the choice but disabling never revives old tokens', () => {
  const session = createAssistantSession();
  session.setProfile('synthetic-a');
  const token = session.token();
  session.setProfile('synthetic-a');
  assert.equal(session.accepts(token), true);
  session.setEnabled(false);
  session.setProfile('synthetic-a');
  assert.equal(session.state().enabled, false, 'a manual switch-off survives a refresh of the same profile');
  session.setEnabled(true);
  assert.equal(session.accepts(token), false);
  const next = session.token(); session.invalidate();
  assert.equal(session.accepts(next), false);
  assert.equal(session.state().enabled, true);
  session.reset();
  assert.deepEqual(session.state(), { profileId: null, enabled: false, revision: next.revision + 2 });
});
