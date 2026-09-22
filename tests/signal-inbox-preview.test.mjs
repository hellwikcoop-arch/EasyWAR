import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyntheticInbox, transitionSyntheticItem, SYNTHETIC_REVIEWER } from '../src/signal-inbox-preview.js';

test('preview starts from synthetic, unapproved items and does not mutate the template', () => {
  const first = createSyntheticInbox();
  const second = createSyntheticInbox();
  assert.deepEqual(first.map(item => item.status), ['NEW', 'PARSED']);
  first[0].status = 'APPROVED';
  assert.equal(second[0].status, 'NEW');
  assert.equal(second.every(item => item.reviewer === null), true);
});

test('manual review is required before a synthetic approval', () => {
  const item = createSyntheticInbox()[0];
  assert.throws(() => transitionSyntheticItem(item, 'APPROVE', SYNTHETIC_REVIEWER));
  const parsed = transitionSyntheticItem(item, 'MARK_PARSED');
  const pending = transitionSyntheticItem(parsed, 'REQUEST_REVIEW');
  assert.equal(pending.status, 'NEEDS_REVIEW');
  assert.equal(pending.reviewer, null);
  const approved = transitionSyntheticItem(pending, 'APPROVE', SYNTHETIC_REVIEWER);
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.reviewer, SYNTHETIC_REVIEWER);
  assert.throws(() => transitionSyntheticItem(approved, 'REQUEST_REVIEW'));
});

test('rejection requires a reviewer and final states cannot reopen', () => {
  const pending = transitionSyntheticItem(createSyntheticInbox()[1], 'REQUEST_REVIEW');
  assert.throws(() => transitionSyntheticItem(pending, 'REJECT', ''));
  assert.throws(() => transitionSyntheticItem(pending, 'REJECT', 'bad\nreviewer'));
  const rejected = transitionSyntheticItem(pending, 'REJECT', SYNTHETIC_REVIEWER);
  assert.equal(rejected.status, 'REJECTED');
  assert.throws(() => transitionSyntheticItem(rejected, 'MARK_PARSED'));
});
