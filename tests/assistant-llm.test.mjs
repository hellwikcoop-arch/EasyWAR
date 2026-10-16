import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { LLM_COMMANDS, createLocalModelClient } from '../src/assistant/assistant-llm.js';

class FakeChannel { onmessage = null; }
const READY = { configured: true, enabled: true, ready: true, name: 'Тестова модель', sizeMb: 900, loaded: false, busy: false, message: null };

function fake(handlers) {
  const calls = [];
  const invokeCommand = async (command, args) => {
    calls.push([command, args]);
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected ${command}`);
    return handler(args);
  };
  return { calls, client: createLocalModelClient({ invokeCommand, ChannelClass: FakeChannel }) };
}

test('status is normalised and a failing status means "no model", not an error', async () => {
  const ok = fake({ [LLM_COMMANDS.status]: () => ({ ...READY, extra: 'ignored', name: 'x'.repeat(500) }) });
  const status = await ok.client.refresh();
  assert.equal(status.ready, true);
  assert.equal(status.name.length, 120);
  assert.equal('extra' in status, false);
  const broken = fake({ [LLM_COMMANDS.status]: () => { throw new Error('no tauri'); } });
  assert.deepEqual(await broken.client.refresh(), { configured: false, enabled: false, ready: false, name: null, sizeMb: null, loaded: false, busy: false, message: null });
});

test('choose, enable and forget go through their own commands and report failures as text', async () => {
  const { client, calls } = fake({
    [LLM_COMMANDS.choose]: () => null,
    [LLM_COMMANDS.enable]: ({ enabled }) => { if (enabled) throw 'Спершу оберіть пакет моделі'; return { ...READY, enabled: false, ready: false }; },
    [LLM_COMMANDS.forget]: () => ({ ...READY, configured: false, enabled: false, ready: false }),
  });
  assert.deepEqual(await client.choose().then(({ ok, cancelled }) => ({ ok, cancelled })), { ok: true, cancelled: true });
  const denied = await client.setEnabled(true);
  assert.equal(denied.ok, false);
  assert.equal(denied.message, 'Спершу оберіть пакет моделі');
  assert.equal((await client.setEnabled(false)).ok, true);
  assert.equal((await client.forget()).status.configured, false);
  assert.deepEqual(calls.map(([command]) => command), [LLM_COMMANDS.choose, LLM_COMMANDS.enable, LLM_COMMANDS.enable, LLM_COMMANDS.forget]);
});

test('generation streams tokens through a channel and returns the full text', async () => {
  const seen = [];
  const { client, calls } = fake({
    [LLM_COMMANDS.generate]: ({ onEvent }) => {
      onEvent.onmessage({ type: 'started' });
      onEvent.onmessage({ type: 'token', text: 'Так' });
      onEvent.onmessage({ type: 'token', text: ', ось.' });
      onEvent.onmessage({ type: 'finished' });
      return 'Так, ось.';
    },
  });
  const request = { system: 'S', messages: [{ role: 'user', content: 'Q' }], maxTokens: 100 };
  assert.equal(await client.generate(request, { onToken: text => seen.push(text) }), 'Так, ось.');
  assert.deepEqual(seen, ['Так', 'Так, ось.']);
  assert.deepEqual(calls[0][1].request, request);
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ['onEvent', 'request']);
});

test('an engine error rejects so the dialogue falls back; a cancelled answer is dropped', async () => {
  const failing = fake({ [LLM_COMMANDS.generate]: () => { throw 'Локальну модель не ввімкнено в налаштуваннях'; } });
  await assert.rejects(failing.client.generate({}), /не ввімкнено/u);
  let release;
  const slow = fake({
    [LLM_COMMANDS.generate]: () => new Promise(resolve => { release = resolve; }),
    [LLM_COMMANDS.cancel]: () => undefined,
  });
  const pending = slow.client.generate({});
  const rejection = assert.rejects(pending, /скасовано/u);
  await slow.client.cancel();
  release('пізня відповідь');
  await rejection;
  assert.ok(slow.calls.some(([command]) => command === LLM_COMMANDS.cancel));
});

const INFO = { id: 'qwen3-4b-q4km', title: 'Qwen3-4B (Q4_K_M)', license: 'Apache-2.0', host: 'huggingface.co', sizeBytes: 2497280256, partialBytes: 0, installed: false, runnerPresent: false, busy: false, folder: 'C:\\\\Models' };

test('install info is normalised and a failing command means "nothing to install"', async () => {
  const ok = fake({ [LLM_COMMANDS.installInfo]: () => ({ ...INFO, extra: 'ignored', title: 'x'.repeat(500), partialBytes: -5 }) });
  const info = await ok.client.installInfo();
  assert.equal(info.title.length, 80);
  assert.equal(info.partialBytes, 0);
  assert.equal(info.sizeBytes, 2497280256);
  assert.equal('extra' in info, false);
  assert.equal(await fake({ [LLM_COMMANDS.installInfo]: () => { throw new Error('no tauri'); } }).client.installInfo(), null);
  assert.equal(await fake({ [LLM_COMMANDS.installInfo]: () => ({ ...INFO, sizeBytes: 0 }) }).client.installInfo(), null);
});

test('install streams only well-formed progress and reports the three outcomes', async () => {
  const seen = [];
  const { client } = fake({
    [LLM_COMMANDS.install]: ({ onEvent }) => {
      onEvent.onmessage({ type: 'progress', phase: 'download', done: 10, total: 100 });
      onEvent.onmessage({ type: 'progress', phase: 'download', done: 500, total: 100 });
      onEvent.onmessage({ type: 'progress', phase: 'other', done: 1, total: 100 });
      onEvent.onmessage({ type: 'progress', phase: 'verify', done: 5, total: 0 });
      onEvent.onmessage(null);
      onEvent.onmessage({ type: 'progress', phase: 'verify', done: 100, total: 100 });
      return { outcome: 'modelOnly', status: { ...READY, enabled: false, ready: false }, message: 'Потрібен рушій' };
    },
  });
  const result = await client.install({ onProgress: progress => seen.push(progress) });
  assert.deepEqual(seen, [{ phase: 'download', done: 10, total: 100 }, { phase: 'download', done: 100, total: 100 }, { phase: 'verify', done: 100, total: 100 }]);
  assert.deepEqual({ ok: result.ok, outcome: result.outcome, message: result.message }, { ok: true, outcome: 'modelOnly', message: 'Потрібен рушій' });
  assert.equal(client.status().configured, true);
  const cancelled = fake({ [LLM_COMMANDS.install]: () => ({ outcome: 'cancelled', status: READY, message: 'Скасовано' }) });
  assert.equal((await cancelled.client.install()).outcome, 'cancelled');
  const odd = fake({ [LLM_COMMANDS.install]: () => ({ outcome: 'surprise', status: READY }) });
  assert.equal((await odd.client.install()).outcome, 'modelOnly');
});

test('an installation failure comes back as text, and cancel and removal use their own commands', async () => {
  const { client, calls } = fake({
    [LLM_COMMANDS.install]: () => { throw 'Недостатньо місця на диску: потрібно ще 2400 МБ, вільно 100 МБ'; },
    [LLM_COMMANDS.cancelInstall]: () => undefined,
    [LLM_COMMANDS.removeFiles]: () => ({ ...READY, configured: false, enabled: false, ready: false }),
  });
  const failed = await client.install();
  assert.equal(failed.ok, false);
  assert.match(failed.message, /Недостатньо місця/u);
  await client.cancelInstall();
  assert.equal((await client.removeFiles()).ok, true);
  assert.equal(client.status().configured, false);
  assert.deepEqual(calls.map(([command]) => command), [LLM_COMMANDS.install, LLM_COMMANDS.cancelInstall, LLM_COMMANDS.removeFiles]);
});

test('the client talks only to the eleven model commands and never to files or the DOM', async () => {
  const source = await readFile(new URL('../src/assistant/assistant-llm.js', import.meta.url), 'utf8');
  assert.deepEqual([...new Set(source.match(/'[a-z_]+_(?:local_)?(?:model|answer|package)[a-z_]*'/gu))].sort(),
    ["'cancel_local_answer'", "'cancel_local_model_install'", "'choose_local_model_package'", "'forget_local_model_package'", "'generate_local_answer'", "'get_local_model_install_info'", "'get_local_model_status'", "'install_local_model'", "'remove_local_model_files'", "'set_local_model_enabled'", "'stop_local_model'"]);
  assert.doesNotMatch(source, /\b(fetch|document|window|localStorage|sessionStorage|eval)\b|new Function/u);
  assert.equal(Object.keys(LLM_COMMANDS).length, 11);
});
