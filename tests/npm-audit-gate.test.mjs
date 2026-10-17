import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPTED_ADVISORIES, collectAdvisories, evaluateAudit } from '../script/npm_audit_gate.mjs';

// Синтетичні звіти у форматі `npm audit --json` (npm 7+).
const advisory = (name, ghsa, severity = 'high') => ({
  source: Math.floor(Math.random() * 1e6),
  name,
  dependency: name,
  title: `synthetic ${ghsa}`,
  url: `https://github.com/advisories/${ghsa}`,
  severity,
});

const report = (vulnerabilities) => ({ vulnerabilities, metadata: {} });

test('advisories are collected once and string via-links are ignored', () => {
  const shared = advisory('image-size', 'GHSA-5p2g-fcmc-qvqq');
  const result = collectAdvisories(report({
    'image-size': { severity: 'high', via: [shared, advisory('image-size', 'GHSA-w3rx-r6r6-pgpr')] },
    pptxgenjs: { severity: 'high', via: ['image-size', shared] },
  }));
  assert.deepEqual(result.map((item) => item.id).sort(), ['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr']);
});

test('the two documented image-size advisories pass and are reported as tolerated', () => {
  const result = evaluateAudit(report({
    'image-size': {
      via: [advisory('image-size', 'GHSA-5p2g-fcmc-qvqq'), advisory('image-size', 'GHSA-w3rx-r6r6-pgpr')],
    },
    pptxgenjs: { via: ['image-size'] },
  }));
  assert.equal(result.blocking.length, 0);
  assert.equal(result.tolerated.length, 2);
  assert.equal(result.stale.length, 0);
});

test('any advisory outside the accepted list blocks', () => {
  const result = evaluateAudit(report({
    'image-size': { via: [advisory('image-size', 'GHSA-5p2g-fcmc-qvqq')] },
    synthetic: { via: [advisory('synthetic', 'GHSA-aaaa-bbbb-cccc', 'critical')] },
  }));
  assert.deepEqual(result.blocking.map((item) => item.id), ['GHSA-aaaa-bbbb-cccc']);
  assert.equal(result.blocking[0].severity, 'critical');
});

test('an advisory without a GHSA url is still tracked by its npm source id', () => {
  const result = evaluateAudit(report({
    synthetic: { via: [{ source: 424242, name: 'synthetic', title: 'no url', severity: 'moderate' }] },
  }));
  assert.deepEqual(result.blocking.map((item) => item.id), ['npm:424242']);
});

test('fixed advisories are reported as stale accepted entries', () => {
  const result = evaluateAudit(report({}));
  assert.equal(result.blocking.length, 0);
  assert.deepEqual(result.stale.map((item) => item.id), ACCEPTED_ADVISORIES.map((item) => item.id));
});

test('a broken or error report fails closed instead of looking clean', () => {
  assert.throws(() => evaluateAudit(null), /npm audit не повернув звіт/);
  assert.throws(() => evaluateAudit({ error: { code: 'ENOTFOUND' } }), /npm audit не повернув звіт/);
  assert.throws(() => evaluateAudit({ metadata: {} }), /vulnerabilities/);
});

test('every accepted advisory states a reason and a review date', () => {
  for (const item of ACCEPTED_ADVISORIES) {
    assert.match(item.id, /^GHSA-/);
    assert.ok(item.reason.length > 20, item.id);
    assert.match(item.reviewed, /^\d{4}-\d{2}-\d{2}$/);
  }
});
