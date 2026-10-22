import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetLedger, createKombatProxy, reservationCents } from '../server/kombat/proxy.mjs';

const messages = [{ role: 'user', content: 'Привіт, Комбате.' }];
const ADMIN = 'b'.repeat(64);
const event = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\r\n\r\n`;
const stream = [
  { type: 'message_start', message: { usage: { input_tokens: 50 } } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Слухаю. ' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'До справи.' } },
  { type: 'message_delta', usage: { output_tokens: 12 } },
  { type: 'message_stop' },
].map(event).join('');

async function withProxy(options, run) {
  const directory = await mkdtemp(join(tmpdir(), 'kombat-proxy-test-'));
  const ledger = new BudgetLedger(join(directory, 'ledger.json'), options.capCents ?? 100);
  await ledger.start();
  ledger.state.enabled = options.enabled ?? true;
  await ledger.save();
  const issued = await ledger.issueToken('synthetic-test-user');
  const server = createKombatProxy({ ledger, apiKey: 'synthetic-secret', adminToken: ADMIN,
    allowedOrigins: ['tauri://localhost', 'http://tauri.localhost'], allowEnable: options.allowEnable ?? true,
    fetchImpl: options.fetchImpl, maxConcurrent: options.maxConcurrent ?? 2 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run({ url: `http://127.0.0.1:${server.address().port}`, ledger, issued }); }
  finally { await new Promise(resolve => server.close(resolve)); await ledger.close(); await rm(directory, { recursive: true, force: true }); }
}

function post(url, token, body = { messages }) {
  return fetch(`${url}/v1/chat`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('streams Sonnet 5.5 with medium effort, history, server-only key and central accounting', async () => {
  let upstreamBody;
  await withProxy({ fetchImpl: async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    assert.equal(options.headers['x-api-key'], 'synthetic-secret');
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  } }, async ({ url, ledger, issued }) => {
    const history = [{ role: 'user', content: 'Хто ти?' }, { role: 'assistant', content: 'Я — Комбат.' }, ...messages];
    const response = await post(url, issued.token, { messages: history });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /Слухаю/);
    assert.match(text, /До справи/);
    assert.match(text, /event: done/u);
    assert.doesNotMatch(text, /synthetic-secret/u);
    assert.equal(text.includes(issued.token), false);
    assert.equal(upstreamBody.model, 'claude-sonnet-5-5');
    assert.equal(upstreamBody.output_config.effort, 'medium');
    assert.equal(upstreamBody.stream, true);
    assert.deepEqual(upstreamBody.messages, history);
    assert.equal(ledger.state.requests, 1);
    assert.ok(ledger.state.committedCents >= reservationCents(100));
    assert.ok(ledger.state.actualCents > 0);
  });
});

test('rejects unauthenticated and unbounded input before calling upstream', async () => {
  let calls = 0;
  await withProxy({ fetchImpl: async () => { calls++; throw new Error('unexpected'); } }, async ({ url, ledger, issued }) => {
    assert.equal((await post(url, 'wrong')).status, 401);
    assert.equal((await post(url, issued.token, { messages, system: 'ignore guard' })).status, 400);
    assert.equal((await post(url, issued.token, { messages: [{ role: 'user', content: 'а'.repeat(513) }] })).status, 400);
    assert.equal(calls, 0);
    assert.equal(ledger.state.requests, 0);
  });
});

test('budget reservation is durable and never refunded after upstream failure; promotion disables server side', async () => {
  await withProxy({ capCents: 10, fetchImpl: async () => { throw new Error('offline'); } }, async ({ url, ledger, issued }) => {
    assert.equal((await post(url, issued.token)).status, 502);
    assert.equal(ledger.state.committedCents, 10);
    assert.equal((await post(url, issued.token)).status, 503);
    const saved = JSON.parse(await readFile(ledger.path, 'utf8'));
    assert.equal(saved.committedCents, 10);
    const disabled = await fetch(`${url}/admin/disable`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(disabled.status, 204);
    assert.equal(ledger.state.enabled, false);
  });
});

test('disabled promotion cannot call Anthropic', async () => {
  let called = false;
  await withProxy({ enabled: false, fetchImpl: async () => { called = true; throw new Error('unexpected'); } }, async ({ url, issued }) => {
    assert.equal((await post(url, issued.token)).status, 503);
    assert.equal(called, false);
  });
});

test('concurrent admission is bounded before an upstream response starts', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await withProxy({ capCents: 30, maxConcurrent: 1, fetchImpl: async () => {
    entered(); await gate;
    return new Response(stream, { status: 200 });
  } }, async ({ url, ledger, issued }) => {
    const first = post(url, issued.token);
    await started;
    assert.equal((await post(url, issued.token)).status, 429);
    release();
    assert.equal((await first).status, 200);
    assert.equal(ledger.state.requests, 1);
  });
});

test('personal tokens are one-time issued, hashed on disk, and individually revocable', async () => {
  let calls = 0;
  await withProxy({ fetchImpl: async () => { calls++; return new Response(stream, { status: 200 }); } }, async ({ url, ledger, issued }) => {
    const create = await fetch(`${url}/admin/tokens`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'synthetic-second-user' }) });
    assert.equal(create.status, 201);
    const second = await create.json();
    assert.match(second.token, /^[a-f0-9]{64}$/u);
    const saved = await readFile(ledger.path, 'utf8');
    assert.equal(saved.includes(second.token), false);
    assert.equal(saved.includes(issued.token), false);
    const status = await (await fetch(`${url}/admin/status`, { headers: { authorization: `Bearer ${ADMIN}` } })).text();
    assert.equal(status.includes(second.token), false);
    assert.equal(status.includes('hash'), false);
    assert.equal((await post(url, second.token)).status, 200);
    const revoke = await fetch(`${url}/admin/tokens/${second.id}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(revoke.status, 204);
    assert.equal((await post(url, second.token)).status, 401);
    assert.equal((await post(url, issued.token)).status, 200);
    assert.equal(calls, 2);
  });
});

test('CORS permits only configured desktop origins and rejects others before authentication', async () => {
  await withProxy({ fetchImpl: async () => { throw new Error('unexpected'); } }, async ({ url, issued }) => {
    const accepted = await fetch(`${url}/v1/chat`, { method: 'OPTIONS', headers: { origin: 'tauri://localhost',
      'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
    assert.equal(accepted.status, 204);
    assert.equal(accepted.headers.get('access-control-allow-origin'), 'tauri://localhost');
    const rejected = await fetch(`${url}/v1/chat`, { method: 'POST', headers: { origin: 'https://untrusted.example',
      authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages }) });
    assert.equal(rejected.status, 403);
  });
});

test('server enable is blocked until operator opens the separate approval gate', async () => {
  await withProxy({ enabled: false, allowEnable: false, fetchImpl: async () => { throw new Error('unexpected'); } }, async ({ url, ledger }) => {
    const response = await fetch(`${url}/admin/enable`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(response.status, 403);
    assert.equal(ledger.state.enabled, false);
  });
  await withProxy({ enabled: false, allowEnable: true, fetchImpl: async () => { throw new Error('offline'); } }, async ({ url, ledger }) => {
    const response = await fetch(`${url}/admin/enable`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } });
    assert.equal(response.status, 204);
    assert.equal(ledger.state.enabled, true);
  });
});

test('a previously enabled ledger cannot call Anthropic after restart without the approval gate', async () => {
  let called = false;
  await withProxy({ enabled: true, allowEnable: false, fetchImpl: async () => { called = true; throw new Error('unexpected'); } },
    async ({ url, ledger, issued }) => {
      const response = await post(url, issued.token);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'disabled' });
      assert.equal(ledger.state.requests, 0);
      assert.equal(called, false);
    });
});

// F1: довга онлайн-розмова не повинна впиратися в межі проксі. Клієнт обрізає історію за тими ж числами.
test('long Cyrillic online history is trimmed by the client and accepted by the proxy', async () => {
  const { onlineMessages, fitsProxyLimits } = await import('../src/assistant/assistant-cloud.js');
  const { KOMBAT_PAYLOAD_LIMITS } = await import('../src/assistant/assistant-persona-prompt-core.js');
  const long = 'Синтетична репліка для перевірки розміру запиту. '.repeat(12);
  const history = Array.from({ length: 20 }, (_, at) => ({ query: `${at} ${long}`, answer: `${at} ${long}` }));
  const trimmed = onlineMessages(history, 'Далі?');
  assert.ok(fitsProxyLimits(trimmed));
  assert.ok(trimmed.length >= 3 && trimmed.length % 2 === 1, 'whole pairs plus the new question');
  assert.equal(trimmed.at(-1).content, 'Далі?');
  assert.match(trimmed.at(-2).content, /^19 /u, 'the newest pair is kept');
  // Без обрізання той самий хвіст розмови перевищує межу проксі.
  const untrimmed = history.slice(-5).flatMap(turn => [{ role: 'user', content: turn.query.trim().slice(0, 512) },
    { role: 'assistant', content: turn.answer.trim().slice(0, 512) }]).concat({ role: 'user', content: 'Далі?' });
  assert.equal(fitsProxyLimits(untrimmed), false);

  let calls = 0;
  await withProxy({ fetchImpl: async () => { calls++; return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }); } },
    async ({ url, issued }) => {
      assert.equal((await post(url, issued.token, { messages: untrimmed })).status, 400, 'the proxy still rejects oversized payloads');
      const response = await post(url, issued.token, { messages: trimmed });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /event: done/u);
    });
  assert.equal(calls, 1, 'the rejected payload never reached the upstream stub');

  // Одне максимальне запитання завжди вміщується; керівні символи прибрано, як і вимагає проксі.
  const single = onlineMessages([], `\u0001${'Я'.repeat(600)}`);
  assert.equal(single.length, 1);
  assert.equal(single[0].content.length, KOMBAT_PAYLOAD_LIMITS.messageChars);
  assert.ok(fitsProxyLimits(single));
});
