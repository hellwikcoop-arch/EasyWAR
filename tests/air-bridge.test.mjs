import assert from 'node:assert/strict';
import test from 'node:test';

const {
  airDashboard, airWindow, airWorkSettled, moduleWindow, moduleWorkSettled, trackAirWork,
  trackModuleWork, whenAirDashboard, whenModuleDashboard,
} = await import('../src/air-bridge.js');

function launcher({ loaded = false } = {}) {
  const frameWindow = {};
  const rocketWindow = {};
  const listeners = new Set();
  const opened = [];
  const pvkWindow = {};
  const dshvWindow = {};
  const frames = { 'frame-air': frameWindow, 'frame-rocket': rocketWindow, 'frame-pvk': pvkWindow, 'frame-dshv': dshvWindow };
  globalThis.document = { getElementById: id => (frames[id] ? { contentWindow: frames[id] } : null) };
  globalThis.window = {
    EW_LAUNCHER: { openBranch: branch => opened.push(branch), isLoaded: () => loaded },
    addEventListener: (type, listener) => type === 'ew:branch-open' && listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  };
  const open = branch => listeners.forEach(listener => listener({ detail: { branch } }));
  return { frameWindow, rocketWindow, pvkWindow, dshvWindow, opened, open, listeners };
}

test('each branch module is reached through its own frame', async () => {
  const { frameWindow, rocketWindow, opened, open } = launcher();
  assert.equal(moduleWindow('air'), frameWindow);
  assert.equal(moduleWindow('rocket'), rocketWindow);
  assert.equal(moduleWindow('army'), null);

  const pending = whenModuleDashboard('rocket');
  rocketWindow.__AV = { connect() {} };
  open('air');
  open('rocket');
  assert.equal(await pending, rocketWindow.__AV);
  assert.deepEqual(opened, []);
});

test('the command dashboards have their own frames and wait for their own opening', async () => {
  const { frameWindow, pvkWindow, dshvWindow, open } = launcher();
  assert.equal(moduleWindow('pvk'), pvkWindow);
  assert.equal(moduleWindow('dshv'), dshvWindow);
  assert.notEqual(moduleWindow('pvk'), frameWindow);

  const pending = whenModuleDashboard('pvk');
  pvkWindow.__AV = { connect() {} };
  open('air');
  open('dshv');
  open('pvk');
  assert.equal(await pending, pvkWindow.__AV);
  assert.equal(moduleWindow('army'), null);
});

test('work on one branch does not hold up the other', async () => {
  let finish;
  trackModuleWork('rocket', new Promise(resolve => { finish = resolve; }));
  const events = [];
  const air = moduleWorkSettled('air').then(() => events.push('air'));
  const rocket = moduleWorkSettled('rocket').then(() => events.push('rocket'));
  await air;
  assert.deepEqual(events, ['air']);
  finish();
  await rocket;
  assert.deepEqual(events, ['air', 'rocket']);
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

test('an explicit request shows a module that is already ready', async () => {
  const { frameWindow, opened } = launcher({ loaded: true });
  frameWindow.__AV = { connect() {} };
  assert.equal(await whenAirDashboard({ open: true }), frameWindow.__AV);
  assert.deepEqual(opened, ['air'], 'the hidden module is brought to the front');
});

test('actions in the module wait for tracked preparation', async () => {
  const events = [];
  let finish;
  trackAirWork(new Promise(resolve => { finish = resolve; }).then(() => events.push('profile table loaded')));
  trackAirWork(Promise.reject(new Error('synthetic failure')));
  const waiting = airWorkSettled().then(() => events.push('signal review'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events, []);
  finish();
  await waiting;
  assert.deepEqual(events, ['profile table loaded', 'signal review']);
});

test('profile table writes keep the IPC body in the calling realm', async () => {
  const vm = await import('node:vm');
  const { profileDatabaseHandle } = await import('../src/local-profiles-core.js');
  const calls = [];
  const handle = profileDatabaseHandle('synthetic', 'air', 'synthetic.xlsx', async (...args) => { calls.push(args); });
  const writable = await handle.createWritable();
  const frameBytes = vm.runInNewContext('new Uint8Array([9, 8, 7, 6]).subarray(1, 3)');
  await writable.write(frameBytes);
  await writable.close();
  const [, body] = calls[0];
  assert.equal(body instanceof Uint8Array, true);
  assert.deepEqual([...body], [8, 7]);
});
