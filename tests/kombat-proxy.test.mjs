import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetLedger, createKombatProxy, reservationCents } from '../server/kombat/proxy.mjs';

const messages = [{ role: 'user', content: 'Привіт, Комбате.' }];
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
  const server = createKombatProxy({ ledger, apiKey: 'synthetic-secret', accessToken: 'synthetic-access', adminToken: 'synthetic-admin',
    fetchImpl: options.fetchImpl, maxConcurrent: options.maxConcurrent ?? 2 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run({ url: `http://127.0.0.1:${server.address().port}`, ledger }); }
  finally { await new Promise(resolve => server.close(resolve)); await ledger.close(); await rm(directory, { recursive: true, force: true }); }
}

function post(url, token = 'synthetic-access', body = { messages }) {
  return fetch(`${url}/v1/chat`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('streams Sonnet 5.5 with medium effort, history, server-only key and central accounting', async () => {
  let upstreamBody;
  await withProxy({ fetchImpl: async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    assert.equal(options.headers['x-api-key'], 'synthetic-secret');
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  } }, async ({ url, ledger }) => {
    const history = [{ role: 'user', content: 'Хто ти?' }, { role: 'assistant', content: 'Я — Комбат.' }, ...messages];
    const response = await post(url, 'synthetic-access', { messages: history });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /Слухаю/);
    assert.match(text, /До справи/);
    assert.match(text, /event: done/u);
    assert.doesNotMatch(text, /synthetic-secret|synthetic-access/u);
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
  await withProxy({ fetchImpl: async () => { calls++; throw new Error('unexpected'); } }, async ({ url, ledger }) => {
    assert.equal((await post(url, 'wrong')).status, 401);
    assert.equal((await post(url, 'synthetic-access', { messages, system: 'ignore guard' })).status, 400);
    assert.equal((await post(url, 'synthetic-access', { messages: [{ role: 'user', content: 'а'.repeat(513) }] })).status, 400);
    assert.equal(calls, 0);
    assert.equal(ledger.state.requests, 0);
  });
});

test('budget reservation is durable and never refunded after upstream failure; promotion disables server side', async () => {
  await withProxy({ capCents: 10, fetchImpl: async () => { throw new Error('offline'); } }, async ({ url, ledger }) => {
    assert.equal((await post(url)).status, 502);
    assert.equal(ledger.state.committedCents, 10);
    assert.equal((await post(url)).status, 503);
    const saved = JSON.parse(await readFile(ledger.path, 'utf8'));
    assert.equal(saved.committedCents, 10);
    const disabled = await fetch(`${url}/admin/disable`, { method: 'POST', headers: { authorization: 'Bearer synthetic-admin' } });
    assert.equal(disabled.status, 204);
    assert.equal(ledger.state.enabled, false);
  });
});

test('disabled promotion cannot call Anthropic', async () => {
  let called = false;
  await withProxy({ enabled: false, fetchImpl: async () => { called = true; throw new Error('unexpected'); } }, async ({ url }) => {
    assert.equal((await post(url)).status, 503);
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
  } }, async ({ url, ledger }) => {
    const first = post(url);
    await started;
    assert.equal((await post(url)).status, 429);
    release();
    assert.equal((await first).status, 200);
    assert.equal(ledger.state.requests, 1);
  });
});
