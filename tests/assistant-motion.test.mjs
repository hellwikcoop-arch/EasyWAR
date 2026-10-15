import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssistantMotion } from '../src/assistant/assistant-motion.js';

const staticURL = '/synthetic/colonel.png';
const clips = {
  greet: { url: '/synthetic/greet.webp', durationMs: 1400 },
  explain: { url: '/synthetic/explain.gif', durationMs: 1800 },
};

function fixture({ reduced = false, legacy = false, customClips = clips } = {}) {
  const attributes = new Map();
  const writes = [];
  const image = {
    _src: staticURL,
    get src() { return this._src; },
    set src(value) { this._src = value; writes.push(value); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
  };
  const active = new Map();
  const callbacks = new Map();
  const cleared = [];
  let nextTimer = 0;
  const listeners = new Set();
  const removed = [];
  const mediaQuery = { matches: reduced };
  if (legacy) {
    mediaQuery.addListener = listener => listeners.add(listener);
    mediaQuery.removeListener = listener => { removed.push(listener); listeners.delete(listener); };
  } else {
    mediaQuery.addEventListener = (type, listener) => { assert.equal(type, 'change'); listeners.add(listener); };
    mediaQuery.removeEventListener = (type, listener) => {
      assert.equal(type, 'change'); removed.push(listener); listeners.delete(listener);
    };
  }
  const controller = createAssistantMotion({
    image, staticURL, clips: customClips, mediaQuery,
    setTimer(callback, delay) {
      const id = nextTimer++;
      callbacks.set(id, callback); active.set(id, { callback, delay }); return id;
    },
    clearTimer(id) { cleared.push(id); active.delete(id); },
  });
  return {
    controller, image, attributes, writes, active, callbacks, cleared, listeners, removed,
    preference(value) {
      mediaQuery.matches = value;
      for (const listener of listeners) listener({ matches: value });
    },
    fire(id) { active.delete(id); callbacks.get(id)(); },
  };
}

test('motion is idle until requested and returns to the static portrait after one clip', () => {
  const f = fixture();
  assert.deepEqual(f.writes, []);
  assert.equal(f.active.size, 0);
  assert.equal(f.controller.play('greet'), true);
  assert.match(f.image.src, /^\/synthetic\/greet\.webp#ew-motion-\d+$/);
  assert.equal(f.attributes.get('data-gesture'), 'greet');
  assert.equal(f.active.get(0).delay, 1400);
  f.fire(0);
  assert.equal(f.image.src, staticURL);
  assert.equal(f.attributes.has('data-gesture'), false);
  assert.equal(f.active.size, 0);
});

test('replaying cancels even timer zero and an old callback cannot stop the new gesture', () => {
  const f = fixture();
  f.controller.play('greet');
  const firstURL = f.image.src;
  f.controller.play('greet');
  assert.notEqual(f.image.src, firstURL, 'cached clips receive a fresh fragment');
  assert.ok(f.cleared.includes(0), 'a timer ID of zero is also cancelled');
  assert.deepEqual(f.writes.slice(-2), [staticURL, f.image.src]);
  const secondURL = f.image.src;
  f.callbacks.get(0)();
  assert.equal(f.image.src, secondURL);
  assert.equal(f.active.size, 1);
  f.fire(1);
  assert.equal(f.image.src, staticURL);
});

test('stop and an unknown gesture clear playback without allowing stale callbacks to revive it', () => {
  const f = fixture();
  f.controller.play('greet'); f.controller.stop();
  f.callbacks.get(0)();
  assert.equal(f.image.src, staticURL);
  assert.equal(f.active.size, 0);
  assert.equal(f.attributes.has('data-gesture'), false);
  f.controller.play('explain');
  assert.equal(f.controller.play('missing'), false);
  f.callbacks.get(1)();
  assert.equal(f.image.src, staticURL);
  assert.equal(f.active.size, 0);
});

test('reduced motion blocks playback and preference changes stop it without restarting automatically', () => {
  const f = fixture({ reduced: true });
  assert.equal(f.controller.play('greet'), false);
  assert.equal(f.image.src, staticURL);
  assert.equal(f.active.size, 0);
  f.preference(false);
  assert.equal(f.active.size, 0);
  assert.equal(f.controller.play('greet'), true);
  f.preference(true);
  assert.equal(f.image.src, staticURL);
  assert.equal(f.active.size, 0);
  f.preference(false);
  f.callbacks.get(0)();
  assert.equal(f.image.src, staticURL);
  assert.equal(f.controller.play('explain'), true);
});

test('dispose removes listeners, cancels playback and prevents future clips', () => {
  const f = fixture();
  assert.equal(f.listeners.size, 1);
  f.controller.play('explain'); f.controller.dispose();
  const writesAfterDispose = f.writes.length;
  f.callbacks.get(0)();
  assert.equal(f.controller.play('greet'), false);
  f.controller.dispose();
  assert.equal(f.image.src, staticURL);
  assert.equal(f.writes.length, writesAfterDispose);
  assert.equal(f.active.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.removed.length, 1);
});

test('legacy media-query listeners also stop clips and are removed at disposal', () => {
  const f = fixture({ legacy: true });
  f.controller.play('greet'); f.preference(true);
  assert.equal(f.image.src, staticURL);
  assert.equal(f.active.size, 0);
  f.controller.dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.removed.length, 1);
});

test('invalid and inherited clips cannot load an image or start a timer', () => {
  const customClips = Object.assign(Object.create({ inherited: clips.greet }), {
    empty: { url: '', durationMs: 1000 },
    infinite: { url: '/synthetic/infinite.gif', durationMs: Infinity },
    negative: { url: '/synthetic/negative.gif', durationMs: -1 },
    overflow: { url: '/synthetic/overflow.gif', durationMs: 2147483648 },
  });
  const f = fixture({ customClips });
  for (const id of ['empty', 'infinite', 'negative', 'overflow', 'inherited', null]) {
    assert.equal(f.controller.play(id), false);
  }
  assert.equal(f.image.src, staticURL);
  assert.equal(f.active.size, 0);
  assert.ok(f.writes.every(url => url === staticURL));
});

test('configure змінює портрет і набір жестів: у чужому одязі старі жести не грають', () => {
  const f = fixture();
  assert.equal(f.controller.play('greet'), true);
  f.controller.configure({ staticURL: '/synthetic/pilot.webp', clips: {} });
  assert.equal(f.image.src, '/synthetic/pilot.webp');
  assert.equal(f.attributes.has('data-gesture'), false);
  assert.equal(f.controller.play('greet'), false);
  f.controller.configure({ staticURL: staticURL, clips });
  assert.equal(f.controller.play('greet'), true);
  f.controller.stop();
  assert.equal(f.image.src, staticURL);
});
