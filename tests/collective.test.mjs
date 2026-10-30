import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_KINDS, EVENT_TYPES, membershipState, isMember, roleOf, canApprove,
  memberCapabilities, canRevoke, epochRecipients, adminWarnings, historyStatusByTable,
} from '../src/collective-core.js';
import { C1_CORES } from './collective-core-boundaries.test.mjs';

const settings = { verify: () => true, heldEpochs: () => [0, 1, 2, 3, 4] };
const event = (number, type, actor, extra = {}) => ({
  event_id: `event-synthetic-${number}`, collective_id: 'collective-synthetic-1',
  type, actor_member_id: actor, signature: `signature-synthetic-${number}`, now: number, ...extra,
});
const created = event(1, 'collective_created', 'owner-synthetic', { owner_member_id: 'owner-synthetic' });
const admitted = (number, memberId, approver = 'owner-synthetic') => event(number, 'member_admitted', approver, {
  member_id: memberId, request_id: `request-synthetic-${number}`, candidate_consent: true,
  approver_member_id: approver,
});
const seed = [created, admitted(2, 'admin-synthetic'), admitted(3, 'member-synthetic'),
  event(4, 'admin_granted', 'owner-synthetic', { member_id: 'admin-synthetic' })];
const state = (events = seed, options = settings) => membershipState(events, options);
const lastCode = value => value.rejected.at(-1)?.code;

test('C1c ядра автоматично входять до C1_CORES; переліки заморожені', () => {
  assert.ok(C1_CORES.includes('src/collective-core.js'));
  assert.ok(C1_CORES.includes('src/collective-pair-core.js'));
  assert.ok(Object.isFrozen(ROLE_KINDS) && Object.isFrozen(EVENT_TYPES));
});

test('AC01: незалежні колективи не ділять ролі та ідентифікатори', () => {
  const a = state();
  const b = membershipState([event(1, 'collective_created', 'other-synthetic', {
    collective_id: 'collective-synthetic-2', owner_member_id: 'other-synthetic',
  })], settings);
  assert.equal(roleOf(a, 'owner-synthetic'), 'owner');
  assert.equal(isMember(b, 'owner-synthetic'), false);
  assert.equal(roleOf(b, 'other-synthetic'), 'owner');
});

test('AC02/AC19: підпис, згода кандидата й усі епохи потрібні для вступу', () => {
  assert.equal(lastCode(state([created, admitted(2, 'candidate-synthetic')], { verify: () => false, heldEpochs: () => [0] })), 'bad-signature');
  assert.equal(lastCode(state([created, { ...admitted(2, 'candidate-synthetic'), candidate_consent: false }])), 'no-candidate-consent');
  assert.equal(lastCode(state([created, admitted(2, 'candidate-synthetic')], { verify: () => true, heldEpochs: () => [] })), 'approver-missing-epochs');
  const good = state([created, admitted(2, 'candidate-synthetic')]);
  assert.equal(isMember(good, 'candidate-synthetic'), true);
  assert.equal(roleOf(good, 'candidate-synthetic'), 'member');
});

test('JE-T6: власник, адміністратор й учасник мають лише призначені права', () => {
  const base = state();
  assert.equal(roleOf(base, 'admin-synthetic'), 'admin');
  assert.equal(canRevoke(base, 'owner-synthetic', 'member-synthetic'), true);
  assert.equal(canRevoke(base, 'admin-synthetic', 'member-synthetic'), true);
  assert.equal(canRevoke(base, 'member-synthetic', 'admin-synthetic'), false);
  assert.equal(canRevoke(base, 'admin-synthetic', 'owner-synthetic'), false);
  assert.equal(lastCode(state([...seed, event(5, 'member_revoked', 'admin-synthetic', { member_id: 'admin-synthetic' })])), 'not-allowed');
  assert.equal(lastCode(state([...seed, event(5, 'admin_granted', 'admin-synthetic', { member_id: 'member-synthetic' })])), 'not-allowed');
  assert.equal(lastCode(state([...seed, event(5, 'member_revoked', 'owner-synthetic', { member_id: 'owner-synthetic' })])), 'owner-protected');
  assert.equal(lastCode(state([...seed, event(5, 'member_left', 'owner-synthetic')])), 'owner-cannot-leave');
  assert.equal(roleOf(state([...seed, event(5, 'admin_revoked', 'owner-synthetic', { member_id: 'admin-synthetic' })]), 'admin-synthetic'), 'member');
  assert.equal(canApprove(base, 'member-synthetic', settings), true);
  assert.equal(isMember(state([...seed, admitted(5, 'new-synthetic', 'member-synthetic')]), 'new-synthetic'), true);
  assert.equal(state([...seed, event(5, 'role_label_set', 'member-synthetic', { label: 'Командир синтетичний' })]).members['member-synthetic'].label, 'Командир синтетичний');
  assert.equal(lastCode(state([...seed, event(5, 'role_label_set', 'member-synthetic', { label: '\n' })])), 'invalid-label');
});

test('AC10: відкликання і вихід створюють нові епохи без колишніх учасників', () => {
  const revoked = state([...seed, event(5, 'member_revoked', 'admin-synthetic', { member_id: 'member-synthetic' })]);
  assert.deepEqual(revoked.epochs, [0, 1]);
  assert.equal(isMember(revoked, 'member-synthetic'), false);
  assert.equal(epochRecipients(revoked, 1).includes('member-synthetic'), false);
  const left = state([...seed, event(5, 'member_left', 'admin-synthetic')]);
  assert.deepEqual(left.epochs, [0, 1]);
  assert.equal(isMember(left, 'admin-synthetic'), false);
});

test('AC19: неповні епохи описуються без видачі ключів', () => {
  const s = state([...seed, event(5, 'member_revoked', 'owner-synthetic', { member_id: 'member-synthetic' })]);
  assert.equal(canApprove(s, 'admin-synthetic', { heldEpochs: () => [0] }), false);
  const cap = memberCapabilities(s, 'admin-synthetic', { heldEpochs: () => [0] });
  assert.deepEqual(cap.missingEpochs, [1]);
  assert.equal(cap.canApproveJoin, false);
  assert.equal(cap.canUseCurrentEpoch, false);
  assert.ok(Object.isFrozen(cap) && Object.isFrozen(cap.missingEpochs));
});

test('AC20: власник без другого адміністратора отримує попередження', () => {
  assert.deepEqual(adminWarnings(state([created])), ['single-admin']);
  assert.deepEqual(adminWarnings(state()), []);
});

test('повтор event_id і прототипні ключі не змінюють прийнятий стан', () => {
  const prototypeId = '__proto__';
  const joined = admitted(2, prototypeId);
  const duplicate = state([created, joined, { ...joined }]);
  assert.equal(isMember(duplicate, prototypeId), true);
  assert.equal(duplicate.rejected.length, 0);
  const conflict = state([created, joined, { ...joined, candidate_consent: false }]);
  assert.equal(lastCode(conflict), 'integrity_violation');
  assert.equal(Object.getPrototypeOf(conflict.members), null);
  assert.ok(Object.isFrozen(conflict.members) && Object.isFrozen(conflict.members[prototypeId]));
  assert.throws(() => { conflict.members[prototypeId].role = 'owner'; }, TypeError);
});

test('стан історії не приймає порожній, неповний чи повторений перелік', () => {
  assert.equal(historyStatusByTable([]).pending, true);
  assert.equal(historyStatusByTable([{ tableId: 'table-synthetic-1', keysComplete: true, historyComplete: false }]).pending, true);
  assert.equal(historyStatusByTable([{ tableId: 'table-synthetic-1', keysComplete: true, historyComplete: true }]).pending, false);
  assert.equal(historyStatusByTable([
    { tableId: 'table-synthetic-1', keysComplete: false, historyComplete: false },
    { tableId: 'table-synthetic-1', keysComplete: true, historyComplete: true },
  ]).pending, true);
});
