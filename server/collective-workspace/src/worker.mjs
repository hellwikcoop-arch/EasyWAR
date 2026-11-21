// Cloudflare Worker: один Durable Object на колектив і один довідник кодів.
// Секретів у коді немає. Адресу після `wrangler deploy` користувач вписує в EasyWAR сам.
import { applyDirectory, emptyDirectory } from '../directory.mjs';
import { applyRoom, normalizeCode } from '../room.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const COLLECTIVE_ID = /^c[0-9a-f]{32}$/u;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function clientKeyOf(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+([A-Fa-f0-9]+)$/u.exec(header);
  return match ? match[1] : '';
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 512 * 1024) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function enrich(action) {
  return {
    ...action,
    now: Number.isFinite(action.now) ? action.now : Date.now(),
    randomBytes: size => crypto.getRandomValues(new Uint8Array(size)),
  };
}

export class CodeDirectory {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const action = await request.json();
    const current = (await this.ctx.storage.get('directory')) || emptyDirectory();
    const result = applyDirectory(current, action);
    if (JSON.stringify(result.directory) !== JSON.stringify(current)) {
      await this.ctx.storage.put('directory', result.directory);
    }
    return json(result.body, result.status);
  }
}

export class CollectiveRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const action = enrich(await request.json());
    const current = (await this.ctx.storage.get('room')) ?? null;
    const result = await applyRoom(current, action);
    if (result.changed && result.room) await this.ctx.storage.put('room', result.room);
    return json(result.body, result.status);
  }
}

function directoryStub(env) {
  return env.DIRECTORY.get(env.DIRECTORY.idFromName('codes'));
}

function roomStub(env, collectiveId) {
  return env.ROOMS.get(env.ROOMS.idFromName(collectiveId));
}

async function postStub(stub, action) {
  const response = await stub.fetch('https://collective.internal/', {
    method: 'POST',
    body: JSON.stringify(action),
  });
  return { status: response.status, body: await response.json() };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return json({ ok: false, error: 'Очікувався POST.' }, 405);
    const url = new URL(request.url);
    const now = Date.now();

    if (url.pathname === '/v1/collectives') {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: 'Некоректний запит.' }, 400);
      const collectiveId = `c${hex(crypto.getRandomValues(new Uint8Array(16)))}`;
      const created = await postStub(roomStub(env, collectiveId), {
        op: 'create', name: body.name, memberName: body.memberName, collectiveId, now,
      });
      return json(created.body, created.status);
    }

    if (url.pathname === '/v1/join') {
      const body = await readJson(request);
      if (!body) return json({ ok: false, error: 'Некоректний запит.' }, 400);
      const code = normalizeCode(body.code);
      if (!code) return json({ ok: false, error: 'Невірний або прострочений код запрошення.' }, 400);
      const directory = directoryStub(env);
      const clientKey = clientKeyOf(request);
      const looked = await postStub(directory, { op: 'lookup', code, clientKey, now });
      if (!looked.body.ok) return json(looked.body, looked.status);
      const joined = await postStub(roomStub(env, looked.body.collectiveId), {
        op: 'join', code, memberName: body.memberName, now,
      });
      if (joined.body.ok) await postStub(directory, { op: 'forget', code });
      else await postStub(directory, { op: 'fail', clientKey, now, forgetCode: code });
      return json(joined.body, joined.status);
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v1' || parts[1] !== 'collectives' || !COLLECTIVE_ID.test(parts[2] || '')) {
      return json({ ok: false, error: 'Немає такого шляху.' }, 404);
    }
    const collectiveId = parts[2];
    const actionName = parts[3] || '';
    const body = await readJson(request);
    if (body == null) return json({ ok: false, error: 'Некоректний запит.' }, 400);
    const token = bearer(request);
    const stub = roomStub(env, collectiveId);

    if (actionName === 'invites') {
      const directory = directoryStub(env);
      const listed = await postStub(directory, { op: 'list' });
      const issued = await postStub(stub, {
        op: 'invite',
        token,
        assignedRole: body.assignedRole,
        now,
        reserved: listed.body?.codes || [],
      });
      if (issued.body.ok && issued.body.invite) {
        await postStub(directoryStub(env), {
          op: 'register',
          code: issued.body.invite.code,
          collectiveId,
          expiresAt: issued.body.invite.expiresAt,
        });
      }
      return json(issued.body, issued.status);
    }

    const op = actionName === 'roles' ? 'role'
      : actionName === 'remove' ? 'remove'
        : actionName === 'files' ? 'file'
          : actionName === 'sync' ? 'sync' : '';
    if (!op) return json({ ok: false, error: 'Немає такого шляху.' }, 404);
    const result = await postStub(stub, { ...body, op, token, now });
    return json(result.body, result.status);
  },
};
