import http from 'node:http';
import { readFile, rename, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { KOMBAT_PAYLOAD_LIMITS, KOMBAT_PERSONA_PROMPT } from '../../src/assistant/assistant-persona-prompt-core.js';

const MODEL = 'claude-sonnet-5-5';
const MAX_OUTPUT_TOKENS = 512;
const INPUT_USD_PER_MILLION = 2;
const OUTPUT_USD_PER_MILLION = 10;
const MAX_BODY_BYTES = KOMBAT_PAYLOAD_LIMITS.bodyBytes;
const MAX_INPUT_BYTES = KOMBAT_PAYLOAD_LIMITS.inputBytes;
const MAX_HISTORY = KOMBAT_PAYLOAD_LIMITS.historyMessages;
const MAX_MESSAGE_CHARS = KOMBAT_PAYLOAD_LIMITS.messageChars;

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

function bearer(header) {
  return typeof header === 'string' && /^Bearer [a-f0-9]{64}$/u.test(header) ? header.slice(7) : null;
}

function validateMessages(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).join(',') !== 'messages' || !Array.isArray(value.messages)) return null;
  const messages = value.messages;
  if (!messages.length || messages.length > MAX_HISTORY + 1 || messages.at(-1)?.role !== 'user') return null;
  if (!messages.every((m, i) => m && typeof m === 'object' && Object.keys(m).sort().join(',') === 'content,role'
    && m.role === (i % 2 === 0 ? 'user' : 'assistant') && typeof m.content === 'string'
    && m.content.trim() && m.content.length <= MAX_MESSAGE_CHARS && !/[\u0000-\u001f]/u.test(m.content))) return null;
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
        this.state = { version: 1, enabled: false, committedCents: 0, actualCents: 0, requests: 0, tokens: [] };
        await this.save();
      }
      if (this.state.version !== 1 || typeof this.state.enabled !== 'boolean'
        || !Number.isSafeInteger(this.state.committedCents) || this.state.committedCents < 0
        || !Number.isSafeInteger(this.state.actualCents) || this.state.actualCents < 0
        || !Number.isSafeInteger(this.state.requests) || this.state.requests < 0
        || (this.state.tokens !== undefined && (!Array.isArray(this.state.tokens)
          || this.state.tokens.some(item => !item || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/u.test(item.hash)
            || typeof item.label !== 'string' || (item.revokedAt !== null && typeof item.revokedAt !== 'string')
            || !Number.isSafeInteger(item.requests) || !Number.isSafeInteger(item.reservedCents)
            || !Number.isSafeInteger(item.actualCents))))) throw new Error('invalid-ledger');
      if (!this.state.tokens) { this.state.tokens = []; await this.save(); }
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
  reserve(cents, tokenId) {
    return this.serialized(async () => {
      if (!this.state.enabled) return 'disabled';
      const token = this.state.tokens.find(item => item.id === tokenId && item.revokedAt === null);
      if (!token) return 'unauthorized';
      if (this.state.committedCents + cents > this.capCents) return 'budget-exhausted';
      this.state.committedCents += cents;
      this.state.requests += 1;
      token.requests += 1;
      token.reservedCents += cents;
      await this.save();
      return null;
    });
  }
  recordUsage(inputTokens, outputTokens, tokenId) {
    return this.serialized(async () => {
      if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) return;
      const cents = Math.ceil(100 * ((inputTokens * INPUT_USD_PER_MILLION
        + outputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000));
      this.state.actualCents += cents;
      const token = this.state.tokens.find(item => item.id === tokenId);
      if (token) token.actualCents += cents;
      await this.save();
    });
  }
  disable() { return this.serialized(async () => { this.state.enabled = false; await this.save(); }); }
  enable() { return this.serialized(async () => { this.state.enabled = true; await this.save(); }); }
  issueToken(label) {
    return this.serialized(async () => {
      if (typeof label !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(label)) throw new Error('invalid-label');
      const token = randomBytes(32).toString('hex');
      const id = randomUUID();
      this.state.tokens.push({ id, label, hash: createHash('sha256').update(token).digest('hex'), revokedAt: null,
        requests: 0, reservedCents: 0, actualCents: 0 });
      await this.save();
      return { id, label, token };
    });
  }
  tokenId(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/u.test(token)) return null;
    const digest = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex');
    for (const item of this.state.tokens) {
      if (item.revokedAt === null && timingSafeEqual(digest, Buffer.from(item.hash, 'hex'))) return item.id;
    }
    return null;
  }
  revokeToken(id) {
    return this.serialized(async () => {
      const item = this.state.tokens.find(value => value.id === id && value.revokedAt === null);
      if (!item) return false;
      item.revokedAt = new Date().toISOString();
      await this.save();
      return true;
    });
  }
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

export function createKombatProxy({ ledger, apiKey, adminToken, allowedOrigins = [], allowEnable = false, fetchImpl = fetch, maxConcurrent = 2 }) {
  if (!ledger?.state || (allowEnable && !apiKey) || !/^[a-f0-9]{64}$/u.test(adminToken || '')) throw new Error('proxy-not-configured');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(value => typeof value !== 'string' || value === '*' || value === 'null')) throw new Error('invalid-origins');
  const active = new Map();
  let occupied = 0;
  const handler = async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin) {
        if (!allowedOrigins.includes(origin)) return fail(response, 403, 'origin-denied');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS' && request.url === '/v1/chat' && origin) {
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Max-Age': '600' });
        return response.end();
      }
      const admin = request.url?.startsWith('/admin/');
      const tokenId = admin ? null : ledger.tokenId(bearer(request.headers.authorization));
      if (admin ? !authenticate(request.headers.authorization, adminToken) : !tokenId) return fail(response, 401, 'unauthorized');
      if (request.url === '/admin/status' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        const { enabled, committedCents, actualCents, requests, tokens } = ledger.state;
        return response.end(JSON.stringify({ enabled, committedCents, actualCents, requests,
          tokens: tokens.map(({ id, label, revokedAt, requests: count, reservedCents, actualCents: cost }) =>
            ({ id, label, revokedAt, requests: count, reservedCents, actualCents: cost })),
          capCents: ledger.capCents, active: active.size }));
      }
      if (request.url === '/admin/disable' && request.method === 'POST') {
        await ledger.disable();
        for (const controller of active.keys()) controller.abort();
        response.writeHead(204); return response.end();
      }
      if (request.url === '/admin/enable' && request.method === 'POST') {
        if (!allowEnable) return fail(response, 403, 'approval-required');
        await ledger.enable();
        response.writeHead(204); return response.end();
      }
      if (request.url === '/admin/tokens' && request.method === 'POST') {
        let body;
        try { body = await readBody(request); } catch { return fail(response, 400, 'invalid-request'); }
        if (!body || Object.keys(body).join(',') !== 'label') return fail(response, 400, 'invalid-request');
        let issued;
        try { issued = await ledger.issueToken(body.label); } catch { return fail(response, 400, 'invalid-request'); }
        response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(JSON.stringify(issued));
      }
      const revoke = request.url?.match(/^\/admin\/tokens\/([a-f0-9-]{36})\/revoke$/u);
      if (revoke && request.method === 'POST') {
        if (!(await ledger.revokeToken(revoke[1]))) return fail(response, 404, 'not-found');
        for (const [controller, id] of active) if (id === revoke[1]) controller.abort();
        response.writeHead(204); return response.end();
      }
      if (request.url !== '/v1/chat' || request.method !== 'POST') return fail(response, 404, 'not-found');
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') return fail(response, 415, 'json-required');
      if (!allowEnable) return fail(response, 503, 'disabled');
      if (occupied >= maxConcurrent) return fail(response, 429, 'busy');
      occupied++;
      try {
        let parsed;
        try { parsed = validateMessages(await readBody(request)); } catch { return fail(response, 400, 'invalid-request'); }
        if (!parsed) return fail(response, 400, 'invalid-request');
        if (ledger.tokenId(bearer(request.headers.authorization)) !== tokenId) return fail(response, 401, 'unauthorized');
        const reserveError = await ledger.reserve(reservationCents(parsed.inputBytes), tokenId);
        if (reserveError) return fail(response, reserveError === 'unauthorized' ? 401 : 503, reserveError);
        const controller = new AbortController(); active.set(controller, tokenId);
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
          await ledger.recordUsage(inputTokens, outputTokens, tokenId);
          if (!completed) return fail(response, 502, 'incomplete-stream');
          response.write('event: done\ndata: {}\n\n'); response.end();
        } catch { fail(response, 502, 'upstream-unavailable'); }
        finally { active.delete(controller); }
      } finally { occupied--; }
    } catch { fail(response, 500, 'proxy-error'); }
  };
  return http.createServer((req, res) => { void handler(req, res); });
}
