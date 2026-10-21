import assert from 'node:assert/strict';
import test from 'node:test';
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
