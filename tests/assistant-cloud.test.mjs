import assert from 'node:assert/strict';
import test from 'node:test';
import { KOMBAT_PERSONA_PROMPT } from '../src/assistant/assistant-persona-prompt-core.js';
import { chatEndpoint, onlineMessages, onlineErrorText, OnlineError, streamOnlineAnswer } from '../src/assistant/assistant-cloud.js';

const token = 'a'.repeat(64);
const endpoint = 'https://kombat.example.test/v1/chat';
const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

test('accepts only explicit HTTPS chat endpoints', () => {
  assert.equal(chatEndpoint('https://kombat.example.test'), endpoint);
  assert.equal(chatEndpoint(endpoint), endpoint);
  for (const address of ['http://kombat.example.test', 'https://user:pass@kombat.example.test',
    'https://kombat.example.test/other', 'https://kombat.example.test?token=bad', 'file:///v1/chat']) assert.equal(chatEndpoint(address), null);
});

test('local loopback exception is exact and opt-in for the native macOS client', () => {
  assert.equal(chatEndpoint('http://127.0.0.1:8765'), null);
  assert.equal(chatEndpoint('http://127.0.0.1:8765', { allowLocalLoopback: true }), 'http://127.0.0.1:8765/v1/chat');
  for (const address of ['http://localhost:8765', 'http://127.0.0.1:8766', 'http://127.0.0.2:8765',
    'http://127.0.0.1:8765/other', 'http://127.0.0.1:8765?token=bad']) {
    assert.equal(chatEndpoint(address, { allowLocalLoopback: true }), null);
  }
});

test('native client sends an explicit request to the fixed local proxy address', async () => {
  let requested;
  await streamOnlineAnswer({ endpoint: 'http://127.0.0.1:8765', token, allowLocalLoopback: true,
    messages: [{ role: 'user', content: 'Синтетичний запит' }], fetchImpl: async url => {
      requested = url;
      return new Response(event('token', { text: 'Тест.' }) + event('done', {}),
        { headers: { 'content-type': 'text/event-stream' } });
    } });
  assert.equal(requested, 'http://127.0.0.1:8765/v1/chat');
});

test('only typed online turns form bounded history; no application records or files', () => {
  const history = [{ query: 'Перший запит', answer: 'Перша відповідь', hidden: { localTable: 'secret' } }];
  const messages = onlineMessages(history, 'Наступний запит');
  assert.deepEqual(messages, [{ role: 'user', content: 'Перший запит' }, { role: 'assistant', content: 'Перша відповідь' },
    { role: 'user', content: 'Наступний запит' }]);
  assert.doesNotMatch(JSON.stringify(messages), /localTable|secret/u);
  assert.ok(onlineMessages(Array.from({ length: 20 }, (_, index) => ({ query: `q${index}`, answer: `a${index}` })), 'останній').length <= 11);
});

test('client streams bounded text and sends no secret other than the personal bearer token', async () => {
  let sent;
  const chunks = [event('token', { text: 'Слухаю. ' }), event('token', { text: 'До справи.' }), event('done', {})];
  const response = new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const partial = [];
  const answer = await streamOnlineAnswer({ endpoint, token, messages: [{ role: 'user', content: 'Запит' }], onToken: value => partial.push(value),
    fetchImpl: async (_url, options) => { sent = options; return response; } });
  assert.equal(answer, 'Слухаю. До справи.');
  assert.deepEqual(partial, ['Слухаю. ', 'Слухаю. До справи.']);
  assert.equal(sent.headers.authorization, `Bearer ${token}`);
  assert.equal(sent.credentials, 'omit');
  assert.equal(sent.redirect, 'error');
  assert.deepEqual(JSON.parse(sent.body), { messages: [{ role: 'user', content: 'Запит' }] });
  assert.doesNotMatch(sent.body, /ANTHROPIC_API_KEY|system|\.xlsx|localStorage/u);
});

test('network, cancellation, campaign exhaustion and broken SSE have specific outcomes', async () => {
  const expectCode = async (options, code) => assert.rejects(streamOnlineAnswer({ endpoint, token,
    messages: [{ role: 'user', content: 'Запит' }], ...options }), error => error instanceof OnlineError && error.code === code);
  await expectCode({ fetchImpl: async () => { throw new Error('offline'); } }, 'network');
  const cancelled = new AbortController(); cancelled.abort();
  await expectCode({ signal: cancelled.signal, fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); } }, 'cancelled');
  await expectCode({ signal: cancelled.signal, fetchImpl: async () => new Response(event('token', { text: 'Уривок' }),
    { headers: { 'content-type': 'text/event-stream' } }) }, 'cancelled');
  await expectCode({ fetchImpl: async () => new Response(JSON.stringify({ error: 'budget-exhausted' }),
    { status: 503, headers: { 'content-type': 'application/json' } }) }, 'budget-exhausted');
  await expectCode({ fetchImpl: async () => new Response(event('token', { text: 'Уривок' }),
    { headers: { 'content-type': 'text/event-stream' } }) }, 'incomplete-stream');
  await expectCode({ fetchImpl: async () => new Response(event('error', { code: 'disabled' }),
    { headers: { 'content-type': 'text/event-stream' } }) }, 'disabled');
  await expectCode({ fetchImpl: async () => new Response('event: token\ndata: {bad}\n\n',
    { headers: { 'content-type': 'text/event-stream' } }) }, 'invalid-stream');
  assert.match(onlineErrorText('budget-exhausted'), /Ліміт акції вичерпано/u);
  assert.match(onlineErrorText('network'), /Локальна довідка/u);
});

test('malformed SSE cancels the underlying reader before returning an error', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: token\ndata: {bad}\n\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(streamOnlineAnswer({ endpoint, token, messages: [{ role: 'user', content: 'Тест' }],
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) }),
  error => error instanceof OnlineError && error.code === 'invalid-stream');
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('long history is trimmed from the oldest turn so the proxy never rejects it', () => {
  const sizeOf = messages => Buffer.byteLength(KOMBAT_PERSONA_PROMPT) + Buffer.byteLength(JSON.stringify(messages));
  const question = 'А як тепер створити модуль?';
  const cases = {
    'Ukrainian': 'Це довга українська відповідь помічника про техніку й облік. '.repeat(20),
    'quotes and backslashes': 'Фраза з "лапками" і \\ слешем та «ялинками». '.repeat(20),
    'emoji and CJK': '😀 模块 '.repeat(120),
  };
  for (const [name, answer] of Object.entries(cases)) {
    const history = Array.from({ length: 5 }, (_, index) => ({ query: `Питання номер ${index + 1} про налаштування модуля`, answer }));
    const messages = onlineMessages(history, question);
    assert.ok(sizeOf(messages) <= 6000, `${name}: request is ${sizeOf(messages)} bytes, above the proxy limit`);
    assert.ok(Buffer.byteLength(JSON.stringify({ messages })) <= 8192, `${name}: body above the proxy limit`);
    assert.equal(messages.at(-1).content, question);
    assert.equal(messages.length % 2, 1, `${name}: turns are dropped in whole pairs`);
    assert.ok(messages.length >= 3, `${name}: recent context is kept`);
    assert.equal(messages[0].role, 'user');
    messages.forEach((m, i) => assert.equal(m.role, i % 2 === 0 ? 'user' : 'assistant'));
  }
  const short = onlineMessages([{ query: 'Привіт', answer: 'Вітаю' }], 'Далі');
  assert.equal(short.length, 3, 'short history is untouched');
});

test('the current question is never cut below the existing 512-character limit, even with no room for history', () => {
  const full = 'ж'.repeat(512);
  const history = Array.from({ length: 5 }, () => ({ query: 'я'.repeat(512), answer: 'ї'.repeat(512) }));
  const messages = onlineMessages(history, full + ' зайве');
  assert.equal(messages.at(-1).content, full);
  assert.ok(Buffer.byteLength(KOMBAT_PERSONA_PROMPT) + Buffer.byteLength(JSON.stringify(messages)) <= 6000);
  const alone = onlineMessages([], '😀'.repeat(256));
  assert.equal(alone.length, 1);
  assert.equal(alone[0].content, '😀'.repeat(256));
});
