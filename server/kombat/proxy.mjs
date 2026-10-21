import http from 'node:http';
import { readFile, rename, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { KOMBAT_PERSONA_PROMPT } from '../../src/assistant/assistant-persona-prompt-core.js';

const MODEL = 'claude-sonnet-5-5';
const MAX_OUTPUT_TOKENS = 512;
const INPUT_USD_PER_MILLION = 2;
const OUTPUT_USD_PER_MILLION = 10;
const MAX_BODY_BYTES = 8192;
const MAX_INPUT_BYTES = 6000;
const MAX_HISTORY = 10;

function fail(response, status, code) {
  if (response.headersSent) return response.end(`event: error\ndata: ${JSON.stringify({ code })}\n\n`);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ error: code }));
}

function authenticate(header, secret) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validateMessages(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).join(',') !== 'messages' || !Array.isArray(value.messages)) return null;
  const messages = value.messages;
  if (!messages.length || messages.length > MAX_HISTORY + 1 || messages.at(-1)?.role !== 'user') return null;
  if (!messages.every((m, i) => m && typeof m === 'object' && Object.keys(m).sort().join(',') === 'content,role'
    && m.role === (i % 2 === 0 ? 'user' : 'assistant') && typeof m.content === 'string'
    && m.content.trim() && m.content.length <= 512 && !/[\u0000-\u001f]/u.test(m.content))) return null;
  const inputBytes = Buffer.byteLength(KOMBAT_PERSONA_PROMPT) + Buffer.byteLength(JSON.stringify(messages));
  return inputBytes <= MAX_INPUT_BYTES ? { messages, inputBytes } : null;
}

// Tokenization cannot be estimated exactly without the provider. Reserve a deliberately high
// amount before each call and never refund it, including on a disconnect or crash.
export function reservationCents(inputBytes) {
  const inputCeiling = inputBytes + 1024;
  return Math.max(10, Math.ceil(4 * 100 * ((inputCeiling * INPUT_USD_PER_MILLION
    + MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION) / 1_000_000)));
}

export class BudgetLedger {
  constructor(path, capCents) {
    if (!Number.isSafeInteger(capCents) || capCents < 1 || capCents > 10000) throw new Error('invalid-cap');
    this.path = path;
    this.capCents = capCents;
    this.lock = null;
    this.state = null;
    this.pending = Promise.resolve();
  }
  async start() {
    this.lock = await open(`${this.path}.lock`, 'wx', 0o600);
    try {
      try { this.state = JSON.parse(await readFile(this.path, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        this.state = { version: 1, enabled: false, committedCents: 0, actualCents: 0, requests: 0 };
        await this.save();
      }
      if (this.state.version !== 1 || typeof this.state.enabled !== 'boolean'
        || !Number.isSafeInteger(this.state.committedCents) || this.state.committedCents < 0
        || !Number.isSafeInteger(this.state.actualCents) || this.state.actualCents < 0
        || !Number.isSafeInteger(this.state.requests) || this.state.requests < 0) throw new Error('invalid-ledger');
    } catch (error) { await this.close(); throw error; }
  }
  async save() {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(this.state)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, this.path);
    const directory = await open(dirname(this.path));
    try { await directory.sync(); } finally { await directory.close(); }
  }
  serialized(task) {
    const result = this.pending.then(task);
    this.pending = result.catch(() => {});
    return result;
  }
  reserve(cents) {
    return this.serialized(async () => {
      if (!this.state.enabled) return 'disabled';
      if (this.state.committedCents + cents > this.capCents) return 'budget-exhausted';
      this.state.committedCents += cents;
      this.state.requests += 1;
      await this.save();
      return null;
    });
  }
  recordUsage(inputTokens, outputTokens) {
    return this.serialized(async () => {
      if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) return;
      const cents = Math.ceil(100 * ((inputTokens * INPUT_USD_PER_MILLION
        + outputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000));
      this.state.actualCents += cents;
      await this.save();
    });
  }
  disable() { return this.serialized(async () => { this.state.enabled = false; await this.save(); }); }
  async close() {
    if (!this.lock) return;
    await this.lock.close(); this.lock = null;
    await unlink(`${this.path}.lock`);
  }
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function* sseEvents(body) {
  const decoder = new TextDecoder(); let buffer = '';
  for await (const chunk of body) {
    buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/gu, '\n');
    if (buffer.length > 65536) throw new Error('upstream-event-too-large');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}

export function createKombatProxy({ ledger, apiKey, accessToken, adminToken, fetchImpl = fetch, maxConcurrent = 2 }) {
  if (!ledger?.state || !apiKey || !accessToken || !adminToken || accessToken === adminToken) throw new Error('proxy-not-configured');
  const active = new Set();
  let occupied = 0;
  const handler = async (request, response) => {
    try {
      const admin = request.url === '/admin/disable' || request.url === '/admin/status';
      if (!authenticate(request.headers.authorization, admin ? adminToken : accessToken)) return fail(response, 401, 'unauthorized');
      if (request.url === '/admin/status' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return response.end(JSON.stringify({ ...ledger.state, capCents: ledger.capCents, active: active.size }));
      }
      if (request.url === '/admin/disable' && request.method === 'POST') {
        await ledger.disable();
        for (const controller of active) controller.abort();
        response.writeHead(204); return response.end();
      }
      if (request.url !== '/v1/chat' || request.method !== 'POST') return fail(response, 404, 'not-found');
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return fail(response, 415, 'json-required');
      if (occupied >= maxConcurrent) return fail(response, 429, 'busy');
      occupied++;
      try {
        let parsed;
        try { parsed = validateMessages(await readBody(request)); } catch { return fail(response, 400, 'invalid-request'); }
        if (!parsed) return fail(response, 400, 'invalid-request');
        const reserveError = await ledger.reserve(reservationCents(parsed.inputBytes));
        if (reserveError) return fail(response, 503, reserveError);
        const controller = new AbortController(); active.add(controller);
        response.on('close', () => controller.abort());
        try {
          const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
            method: 'POST', signal: controller.signal,
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify({ model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, output_config: { effort: 'medium' },
              system: KOMBAT_PERSONA_PROMPT, messages: parsed.messages, stream: true }),
          });
          if (!upstream.ok || !upstream.body) return fail(response, 502, 'upstream-unavailable');
          response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          let inputTokens = 0; let outputTokens = 0; let completed = false;
          for await (const event of sseEvents(upstream.body)) {
            if (event.type === 'message_start') inputTokens = event.message?.usage?.input_tokens ?? 0;
            if (event.type === 'message_delta') outputTokens = event.usage?.output_tokens ?? outputTokens;
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
              response.write(`event: token\ndata: ${JSON.stringify({ text: event.delta.text })}\n\n`);
            }
            if (event.type === 'message_stop') completed = true;
            if (event.type === 'error') throw new Error('upstream-error');
          }
          await ledger.recordUsage(inputTokens, outputTokens);
          if (!completed) return fail(response, 502, 'incomplete-stream');
          response.write('event: done\ndata: {}\n\n'); response.end();
        } catch { fail(response, 502, 'upstream-unavailable'); }
        finally { active.delete(controller); }
      } finally { occupied--; }
    } catch { fail(response, 500, 'proxy-error'); }
  };
  return http.createServer((req, res) => { void handler(req, res); });
}
