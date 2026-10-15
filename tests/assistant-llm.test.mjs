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

test('the client talks only to the seven model commands and never to files or the DOM', async () => {
  const source = await readFile(new URL('../src/assistant/assistant-llm.js', import.meta.url), 'utf8');
  assert.deepEqual([...new Set(source.match(/'[a-z_]+_(?:local_)?(?:model|answer|package)[a-z_]*'/gu))].sort(),
    ["'cancel_local_answer'", "'choose_local_model_package'", "'forget_local_model_package'", "'generate_local_answer'", "'get_local_model_status'", "'set_local_model_enabled'", "'stop_local_model'"]);
  assert.doesNotMatch(source, /\b(fetch|document|window|localStorage|sessionStorage|eval)\b|new Function/u);
  assert.equal(Object.keys(LLM_COMMANDS).length, 7);
});
