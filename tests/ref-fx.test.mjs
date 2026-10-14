// Спільні допоміжні функції сцен довідника (ref-fx.js): обмеження, плавне наближення й плавний хід вузла.
import assert from 'node:assert/strict';
import test from 'node:test';

const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const { clamp, ease, smooth } = await import('../src/ref-fx.js');

test('smooth is a clamped S-curve: zero and one at the ends, half at the middle, flat at the ends and never going back', () => {
  assert.equal(smooth(-3), 0);
  assert.equal(smooth(0), 0);
  assert.equal(smooth(.5), .5);
  assert.equal(smooth(1), 1);
  assert.equal(smooth(7), 1);
  let prev = -1;
  for (let i = 0; i <= 100; i++) { const v = smooth(i / 100); assert.ok(v >= prev, `monotonic at ${i}`); prev = v; }
  assert.ok(smooth(.02) < .02 * .1, 'it starts slowly');
  assert.ok(1 - smooth(.98) < .02 * .1, 'it arrives slowly');
  // симетрія: вхід і вихід однакові
  for (const x of [.1, .25, .4]) assert.ok(Math.abs(smooth(x) + smooth(1 - x) - 1) < 1e-12);
});

test('ease approaches the target at the same speed regardless of the frame rate', () => {
  const step = (dt, seconds) => { let v = 0; for (let t = 0; t < seconds - 1e-9; t += dt) v = ease(v, 1, 3, dt); return v; };
  assert.ok(Math.abs(step(1 / 30, 1) - step(1 / 144, 1)) < 1e-9, 'one second is one second at any rate');
  assert.ok(Math.abs(step(.01, 1) - (1 - Math.exp(-3))) < 1e-9);
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(.3, 0, 1), .3);
});
