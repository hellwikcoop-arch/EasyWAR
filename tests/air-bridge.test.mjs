import assert from 'node:assert/strict';
import test from 'node:test';

const { airDashboard, airWindow, whenAirDashboard } = await import('../src/air-bridge.js');

function launcher({ loaded = false } = {}) {
  const frameWindow = {};
  const listeners = new Set();
  const opened = [];
  globalThis.document = { getElementById: id => (id === 'frame-air' ? { contentWindow: frameWindow } : null) };
  globalThis.window = {
    EW_LAUNCHER: { openBranch: branch => opened.push(branch), isLoaded: () => loaded },
    addEventListener: (type, listener) => type === 'ew:branch-open' && listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  };
  const open = branch => listeners.forEach(listener => listener({ detail: { branch } }));
  return { frameWindow, opened, open, listeners };
}

test('inside the Air Force module the bridge uses the module window', async () => {
  const dashboard = { connect() {} };
  globalThis.window = { __AV: dashboard };
  assert.equal(airWindow(), globalThis.window);
  assert.equal(await whenAirDashboard(), dashboard);
});

test('from the launcher it waits until the Air Force module is opened', async () => {
  const { frameWindow, opened, open, listeners } = launcher();
  assert.equal(airWindow(), frameWindow);
  assert.equal(airDashboard(), null);

  const pending = whenAirDashboard();
  assert.deepEqual(opened, [], 'loading a profile table does not switch branches by itself');
  open('rocket');
  frameWindow.__AV = { connect() {} };
  open('air');
  assert.equal(await pending, frameWindow.__AV);
  assert.equal(listeners.size, 0);
});

test('an explicit request opens the Air Force module', async () => {
  const { frameWindow, opened } = launcher({ loaded: true });
  setTimeout(() => { frameWindow.__AV = { connect() {} }; }, 20);
  assert.equal(await whenAirDashboard({ open: true }), frameWindow.__AV);
  assert.deepEqual(opened, ['air']);
});
