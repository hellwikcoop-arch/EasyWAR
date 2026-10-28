// E8 / C1d: політики комбінованої синхронізації. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_POLICIES, DEFAULT_TABLE_POLICY, INBOUND_POLICIES, OUTBOUND_POLICIES, STATUS_LABELS,
  changeTablePolicy, checkPolicyValue, evaluateInbound, evaluateOutbound,
} from '../src/sync-policy-core.js';

const W = 'member-synthetic-writer';
const ok = { policy: 'REVIEW_EACH_REPORT', tableClass: 'C', transport: 'base44', endToEnd: true, authorId: W, writers: [W], reviewedByHuman: true };

test('межі C1 покривають ядра C1d (C3 F-15) — без імпорту тест-файла (F-23)', async () => {
  const { readFile } = await import('node:fs/promises');
  const boundaries = await readFile(new URL('./collective-core-boundaries.test.mjs', import.meta.url), 'utf8');
  for (const f of ['src/sync-policy-core.js', 'src/report-submission-core.js']) assert.ok(boundaries.includes(`'${f}'`), f);
});

test('цільова архітектура повна, активні лише чинні режими', () => {
  assert.deepEqual(OUTBOUND_POLICIES, ['AUTO_AFTER_LOCAL_APPROVAL', 'REVIEW_EACH_REPORT', 'DISABLED']);
  assert.deepEqual(INBOUND_POLICIES, ['AUTO_APPLY_VERIFIED', 'REVIEW_BEFORE_APPLY', 'DISABLED']);
  assert.deepEqual(ACTIVE_POLICIES, { outbound: ['REVIEW_EACH_REPORT'], inbound: ['AUTO_APPLY_VERIFIED'] });
  assert.ok(Object.isFrozen(ACTIVE_POLICIES.outbound) && Object.isFrozen(ACTIVE_POLICIES.inbound));
  assert.equal(DEFAULT_TABLE_POLICY.outbound, 'REVIEW_EACH_REPORT');
  assert.equal(DEFAULT_TABLE_POLICY.inbound, 'AUTO_APPLY_VERIFIED');
});

test('S01 (негативний): автовідправка, ручне приймання й вимкнення — OwnerDecisionRequired', () => {
  for (const policy of ['AUTO_AFTER_LOCAL_APPROVAL', 'DISABLED']) {
    const r = evaluateOutbound({ ...ok, policy });
    assert.equal(r.allowed, false, policy);
    assert.equal(r.code, 'OwnerDecisionRequired', policy);
    assert.match(r.reason, /рішення власника/u);
  }
  for (const policy of ['REVIEW_BEFORE_APPLY', 'DISABLED']) {
    assert.equal(evaluateInbound({ policy, applyStatus: 'applied' }).code, 'OwnerDecisionRequired', policy);
  }
  assert.equal(checkPolicyValue('outbound', 'щось').code, 'unknown-policy');
  assert.equal(checkPolicyValue('sideways', 'DISABLED').code, 'unknown-direction');
});

test('S02 / Q10г: без перегляду й «Доповісти» відправки немає', () => {
  assert.equal(evaluateOutbound(ok).allowed, true);
  assert.equal(evaluateOutbound({ ...ok, reviewedByHuman: false }).code, 'needs-report-review');
  assert.equal(evaluateOutbound({ ...ok, reviewedByHuman: 'true' }).code, 'needs-report-review');
});

test('порядок перевірки: маршрут і право запису діють і за активної політики', () => {
  assert.equal(evaluateOutbound({ ...ok, tableClass: 'D' }).code, 'class-d-cloud');
  assert.equal(evaluateOutbound({ ...ok, tableClass: 'D', transport: 'lan' }).allowed, true);
  assert.equal(evaluateOutbound({ ...ok, endToEnd: false }).code, 'no-e2e');
  assert.equal(evaluateOutbound({ ...ok, transport: 'peer_wan' }).code, 'peer-wan-forbidden');
  assert.equal(evaluateOutbound({ ...ok, authorId: 'member-synthetic-reader' }).code, 'no-write-right');
  assert.equal(evaluateOutbound(null).allowed, false);
});

test('S10: перевірка перед відправкою бере чинну політику, а не ту, що була при постановці в чергу', () => {
  const queuedWith = DEFAULT_TABLE_POLICY;
  assert.equal(evaluateOutbound({ ...ok, policy: queuedWith.outbound }).allowed, true, 'у черзі');
  const current = { ...queuedWith, outbound: 'DISABLED', version: queuedWith.version + 1 };
  assert.equal(evaluateOutbound({ ...ok, policy: current.outbound }).code, 'OwnerDecisionRequired', 'перед відправкою');
});

test('F-18: пріоритет відмов за ADR — маршрут → політика → право запису → перегляд', () => {
  assert.equal(evaluateOutbound({ ...ok, tableClass: 'D', policy: 'AUTO_AFTER_LOCAL_APPROVAL' }).code, 'class-d-cloud');
  assert.equal(evaluateOutbound({ ...ok, policy: 'DISABLED', authorId: 'x' }).code, 'OwnerDecisionRequired');
  assert.equal(evaluateOutbound({ ...ok, authorId: 'x', reviewedByHuman: false }).code, 'no-write-right');
});

test('F-19: неактивні значення не проходять через зміну політики в жодному напрямі; зміна атомарна', () => {
  const admin = { memberId: 'member-synthetic-adm', role: 'admin' };
  for (const change of [{ inbound: 'REVIEW_BEFORE_APPLY' }, { inbound: 'DISABLED' }, { outbound: 'DISABLED' }]) {
    const r = changeTablePolicy(DEFAULT_TABLE_POLICY, change, admin);
    assert.equal(r.code, 'OwnerDecisionRequired', JSON.stringify(change));
    assert.equal(r.policy, DEFAULT_TABLE_POLICY);
  }
  const mixed = changeTablePolicy(DEFAULT_TABLE_POLICY, { outbound: 'REVIEW_EACH_REPORT', inbound: 'DISABLED' }, admin);
  assert.equal(mixed.ok, false);
  assert.equal(mixed.policy, DEFAULT_TABLE_POLICY, 'жодної часткової зміни');
  assert.equal(changeTablePolicy(DEFAULT_TABLE_POLICY, { outbound: 'REVIEW_EACH_REPORT' }, { role: 'owner' }).ok, true, 'власник колективу');
  assert.equal(changeTablePolicy(DEFAULT_TABLE_POLICY, { outbound: 'REVIEW_EACH_REPORT' }, {}).code, 'not-allowed');
});

test('застосування вхідних: перевірене — так, конфлікт і карантин — людині, решта — відмова', () => {
  const p = 'AUTO_APPLY_VERIFIED';
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'applied' }).action, 'apply');
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'applied', kind: 'delete' }).notify, true, 'видалення — зі сповіщенням');
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'duplicate' }).action, 'skip');
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'conflict' }).action, 'conflict');
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'conflict' }).allowed, false);
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'quarantined' }).action, 'quarantine');
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'quarantined' }).allowed, false);
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'integrity_violation' }).action, 'reject');
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'rejected' }).action, 'reject');
  assert.equal(evaluateInbound({ policy: p, applyStatus: 'щось' }).allowed, false);
});

test('S09 / К6: політику змінюють лише власник таблиці й адміністратори; неактивне — відмова', () => {
  const member = { memberId: 'member-synthetic-m', role: 'member', isTableOwner: false };
  const admin = { memberId: 'member-synthetic-adm', role: 'admin' };
  const tableOwner = { memberId: 'member-synthetic-to', role: 'member', isTableOwner: true };
  assert.equal(changeTablePolicy(DEFAULT_TABLE_POLICY, { outbound: 'REVIEW_EACH_REPORT' }, member).code, 'not-allowed');
  const r = changeTablePolicy(DEFAULT_TABLE_POLICY, { outbound: 'REVIEW_EACH_REPORT' }, tableOwner);
  assert.equal(r.ok, true);
  assert.equal(r.policy.version, 1);
  assert.equal(r.policy.changedBy, 'member-synthetic-to');
  assert.equal(changeTablePolicy(r.policy, { inbound: 'AUTO_APPLY_VERIFIED' }, admin).policy.version, 2);
  assert.equal(changeTablePolicy(DEFAULT_TABLE_POLICY, { outbound: 'AUTO_AFTER_LOCAL_APPROVAL' }, admin).code, 'OwnerDecisionRequired');
  assert.equal(changeTablePolicy(DEFAULT_TABLE_POLICY, { writers: [] }, admin).code, 'invalid-change', 'політика не дає права запису');
  assert.equal(changeTablePolicy(DEFAULT_TABLE_POLICY, {}, admin).code, 'invalid-change');
});

test('AC14: статуси для людини розрізняють «збережено» й «застосовано», «з усіма» немає', () => {
  assert.notEqual(STATUS_LABELS.stored, STATUS_LABELS.applied_here);
  assert.equal(STATUS_LABELS.applied_here, 'Застосовано на цьому пристрої');
  assert.equal(Object.values(STATUS_LABELS).some(l => /з усіма/iu.test(l)), false);
  assert.ok(Object.isFrozen(STATUS_LABELS));
});
