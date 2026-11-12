import test from 'node:test';
import assert from 'node:assert/strict';
import { membershipState } from '../src/collective-core.js';
import { PAIR_STATES, PAIR_EVENTS, INVITATION_MODES, createInvitation, pairTransition } from '../src/collective-pair-core.js';

const config = Object.freeze({ maxAttempts: 2, maxActiveRequests: 25, profileHasPassword: true });
const owner = 'owner-synthetic';
const collectiveId = 'collective-synthetic';
const created = { event_id: 'e0', collective_id: collectiveId, type: 'collective_created', actor_member_id: owner, owner_member_id: owner, signature: 'synthetic', now: 0 };
const admission = (candidateId, n) => ({ event_id: `e${n}`, collective_id: collectiveId, type: 'member_admitted', actor_member_id: owner, approver_member_id: owner, member_id: candidateId, request_id: `r${n}`, candidate_consent: true, signature: 'synthetic', now: n });
const membership = (...candidates) => membershipState([created, ...candidates.map((candidate, i) => admission(candidate, i + 1))], { verify: () => true, heldEpochs: () => [0] });
const ctx = (members = membership(owner)) => ({ config, membership: members, heldEpochs: () => [0] });
const invitation = (mode = 'personal', maxJoins = 1) => createInvitation({ invitationId: 'invitation-synthetic', collectiveId, inviterId: owner, mode, maxJoins, expiresAt: 100, now: 0 }, config).state;
const step = (state, type, extra = {}, context = ctx()) => pairTransition(state, { type, ...extra }, context);
const must = outcome => { assert.equal(outcome.ok, true, outcome.code); return outcome.state; };
const start = (mode = 'personal', maxJoins = 1) => must(step(invitation(mode, maxJoins), 'activate'));
const requested = (state, requestId, candidateId, now = 1) => must(step(state, 'join_requested', { requestId, candidateId, now }));
const verified = (state, requestId) => must(step(state, 'sas_result', { requestId, match: true }));
const approved = (state, requestId, context = ctx()) => {
  state = must(step(state, 'candidate_confirmed', { requestId }, context));
  return must(step(state, 'approver_confirmed', { requestId, approverId: owner }, context));
};

test('експорти Pair заморожені, конфігурація й пароль обов’язкові', () => {
  assert.ok(Object.isFrozen(PAIR_STATES) && Object.isFrozen(PAIR_EVENTS) && Object.isFrozen(INVITATION_MODES));
  assert.equal(createInvitation({}, undefined).code, 'config-required');
  assert.equal(createInvitation({}, { ...config, profileHasPassword: false }).code, 'profile-without-password');
  assert.equal(createInvitation({ invitationId: 'i', collectiveId, inviterId: owner, mode: 'personal', maxJoins: 2, expiresAt: 10, now: 0 }, config).code, 'invalid-invitation');
  assert.equal(step(invitation(), 'activate', {}, { config: { ...config, profileHasPassword: false } }).code, 'profile-without-password');
});

test('P01: особистий повний шлях; наступна заявка заблокована, запрошення ACTIVE', () => {
  const requestId = 'request-synthetic';
  const candidateId = 'candidate-synthetic';
  let state = approved(verified(requested(start(), requestId, candidateId), requestId), requestId);
  assert.equal(state.requests[requestId].status, 'APPROVED_BOTH');
  assert.equal(step(state, 'complete', { requestId }).code, 'invalid-transition');
  assert.equal(step(state, 'membership_recorded', { requestId }).code, 'membership-not-recorded');
  state = must(step(state, 'membership_recorded', { requestId }, ctx(membership(candidateId))));
  assert.equal(state.joinsUsed, 1);
  state = must(step(state, 'keys_distributed', { requestId, complete: true }));
  state = must(step(state, 'history_verified', { requestId, byTable: [{ tableId: 'table-synthetic', keysComplete: true, historyComplete: true }] }));
  state = must(step(state, 'complete', { requestId }));
  assert.equal(state.requests[requestId].status, 'COMPLETE');
  assert.equal(state.status, 'ACTIVE');
  assert.equal(step(state, 'join_requested', { requestId: 'second', candidateId: 'second', now: 2 }).code, 'invitation-exhausted');
});

test('P02: 20 групових вступів; 21-й не записується з 25 паралельних заявок', () => {
  let state = start('group', 20);
  const candidates = Array.from({ length: 25 }, (_, i) => `candidate-synthetic-${i}`);
  for (let i = 0; i < 25; i++) state = approved(verified(requested(state, `request-${i}`, candidates[i]), `request-${i}`), `request-${i}`);
  assert.equal(step(state, 'join_requested', { requestId: 'request-25', candidateId: 'candidate-25', now: 2 }).code, 'too-many-active-requests');
  const accepted = ctx(membership(...candidates));
  for (let i = 0; i < 20; i++) state = must(step(state, 'membership_recorded', { requestId: `request-${i}` }, accepted));
  for (let i = 20; i < 25; i++) {
    assert.equal(step(state, 'membership_recorded', { requestId: `request-${i}` }, accepted).code, 'invitation-exhausted');
    assert.equal(state.requests[`request-${i}`].status, 'APPROVED_BOTH');
  }
  assert.equal(state.joinsUsed, 20);
  assert.equal(state.status, 'ACTIVE');
  assert.equal(step(state, 'join_requested', { requestId: 'request-26', candidateId: 'candidate-26', now: 2 }).code, 'invitation-exhausted');
});

test('P03/P06: прострочення та невдалий SAS рахують спроби', () => {
  let state = requested(start(), 'r1', 'c1');
  state = must(step(state, 'sas_result', { requestId: 'r1', match: false }));
  assert.equal(state.requests.r1.status, 'REJECTED');
  state = requested(state, 'r2', 'c2');
  state = must(step(state, 'sas_result', { requestId: 'r2', match: false }));
  assert.equal(state.status, 'RATE_LIMITED');
  assert.equal(step(state, 'join_requested', { requestId: 'r3', candidateId: 'c3', now: 2 }).code, 'invalid-transition');
  const active = start();
  assert.equal(step(active, 'join_requested', { requestId: 'late', candidateId: 'c', now: 100 }).code, 'invitation-expired');
  assert.equal(step(active, 'expire', { now: 99 }).code, 'invalid-transition');
  assert.equal(must(step(active, 'expire', { now: 100 })).status, 'EXPIRED');
});

test('P04/P07: requestId ідемпотентний лише для тих самих даних, зокрема __proto__', () => {
  const state = requested(start(), '__proto__', 'candidate', 3);
  assert.equal(step(state, 'join_requested', { requestId: '__proto__', candidateId: 'candidate', now: 3 }).state, state);
  assert.equal(step(state, 'join_requested', { requestId: '__proto__', candidateId: 'other', now: 3 }).code, 'request-id-conflict');
  assert.equal(Object.getPrototypeOf(state.requests), null);
  assert.ok(Object.isFrozen(state.requests));
});

test('P05: недоступний підтверджувач залишає заявку без ключів', () => {
  let state = verified(requested(start(), 'r1', 'c1'), 'r1');
  state = must(step(state, 'approver_unavailable', { requestId: 'r1' }));
  assert.equal(state.requests.r1.status, 'WAITING_FOR_APPROVAL');
  assert.equal(state.requests.r1.keysComplete, false);
  state = must(step(state, 'candidate_confirmed', { requestId: 'r1' }));
  assert.equal(step(state, 'approver_confirmed', { requestId: 'r1', approverId: owner }, { ...ctx(), heldEpochs: () => [] }).code, 'approver-missing-epochs');
  state = must(step(state, 'approver_confirmed', { requestId: 'r1', approverId: owner }));
  assert.equal(state.requests.r1.status, 'APPROVED_BOTH');
});

test('P08: неповні ключі й історія залишають PENDING_HISTORY', () => {
  let state = approved(verified(requested(start(), 'r1', 'c1'), 'r1'), 'r1');
  state = must(step(state, 'membership_recorded', { requestId: 'r1' }, ctx(membership('c1'))));
  state = must(step(state, 'keys_distributed', { requestId: 'r1', complete: false }));
  assert.equal(state.requests.r1.status, 'PENDING_HISTORY');
  assert.equal(step(state, 'complete', { requestId: 'r1' }).code, 'invalid-transition');
  state = must(step(state, 'keys_distributed', { requestId: 'r1', complete: true }));
  state = must(step(state, 'history_verified', { requestId: 'r1', byTable: [{ tableId: 'table', keysComplete: true, historyComplete: false }] }));
  assert.equal(state.requests.r1.status, 'PENDING_HISTORY');
  assert.equal(step(state, 'complete', { requestId: 'r1' }).code, 'invalid-transition');
  state = must(step(state, 'history_verified', { requestId: 'r1', byTable: [{ tableId: 'table', keysComplete: true, historyComplete: true }] }));
  assert.equal(state.requests.r1.status, 'HISTORY_VERIFIED');
});

test('відкликання й прострочення не скасовують уже записане членство', () => {
  let state = approved(verified(requested(start('group', 2), 'r1', 'c1'), 'r1'), 'r1');
  state = must(step(state, 'membership_recorded', { requestId: 'r1' }, ctx(membership('c1'))));
  state = requested(state, 'r2', 'c2');
  state = must(step(state, 'revoke'));
  assert.equal(state.status, 'REVOKED');
  assert.equal(state.requests.r1.status, 'MEMBERSHIP_RECORDED');
  assert.equal(state.requests.r2.status, 'REVOKED');
  assert.equal(step(state, 'join_requested', { requestId: 'r3', candidateId: 'c3', now: 2 }).code, 'invalid-transition');
});

test('помилка з повтором відновлює попередній стан; недозволені переходи не мутують', () => {
  const state = verified(requested(start(), 'r1', 'c1'), 'r1');
  const bad = step(state, 'complete', { requestId: 'r1' });
  assert.equal(bad.code, 'invalid-transition');
  assert.equal(bad.state, state);
  let next = must(step(state, 'retryable_error', { requestId: 'r1' }));
  assert.equal(next.requests.r1.status, 'ERROR_RETRYABLE');
  next = must(step(next, 'retry', { requestId: 'r1' }));
  assert.equal(next.requests.r1.status, 'SAS_VERIFIED');
  assert.equal(state.requests.r1.status, 'SAS_VERIFIED');
});
