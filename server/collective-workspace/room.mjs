// Авторитетний стан одного колективного файлового середовища.
// Чисті функції: без мережі, без Durable Object. Сервер (worker) лише зберігає
// повернутий стан. Коди запрошень і хеші жетонів не потрапляють у publicView.

export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_FILES = 100;
export const MAX_CONTENT_CHARS = 64 * 1024;
export const MAX_JOURNAL = 1000;
export const ROLES = Object.freeze(['leader', 'junior_leader', 'user']);

const ROLE_LABEL = Object.freeze({
  leader: 'Керівник',
  junior_leader: 'Молодший керівник',
  user: 'Користувач',
});

const ACTION_LABEL = Object.freeze({
  collective_created: 'Створення колективу',
  invite_created: 'Згенеровано одноразове запрошення',
  member_joined: 'Вступ до колективу',
  role_assigned: 'Призначення ролі',
  member_removed: 'Вилучено учасника',
  file_created: 'Створено файл',
  file_updated: 'Оновлено файл',
  file_renamed: 'Перейменовано файл',
  file_deleted: 'Видалено файл',
});

export function roleLabel(role) {
  return ROLE_LABEL[role] || 'Користувач';
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanLine(value, label, max) {
  if (typeof value !== 'string') fail(400, `${label}: введіть текст.`);
  const text = value.trim().replace(/\s+/gu, ' ');
  if (!text || [...text].length > max || /[\p{Cc}\p{Cf}]/u.test(text)) {
    fail(400, `${label}: від 1 до ${max} символів без керівних знаків.`);
  }
  return text;
}

function cleanContent(value) {
  const text = String(value ?? '');
  if ([...text].length > MAX_CONTENT_CHARS || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(text)) {
    fail(400, `Вміст файлу: до ${MAX_CONTENT_CHARS} символів без керівних знаків.`);
  }
  return text;
}

export function normalizeCode(text) {
  const raw = String(text ?? '').trim();
  if (!raw || /[^0-9\s\u00a0-]/u.test(raw)) return null;
  const digits = raw.replace(/[\s\u00a0-]+/gu, '');
  return /^\d{6}$/u.test(digits) ? digits : null;
}

export function formatCode(digits) {
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token ?? '')));
  return hex(new Uint8Array(digest));
}

function randomHex(randomBytes, n) {
  const bytes = randomBytes(n);
  if (!(bytes instanceof Uint8Array) || bytes.length < n) fail(500, 'Недостатньо випадкових байтів.');
  return hex(bytes.slice(0, n));
}

export function generateInviteCode(randomBytes, used) {
  const limit = 0x100000000 - (0x100000000 % 1000000);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bytes = randomBytes(4);
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) fail(500, 'Недостатньо випадкових байтів.');
    const value = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    if (value >= limit) continue;
    const code = String(value % 1000000).padStart(6, '0');
    if (!used.has(code)) return code;
  }
  fail(500, 'Не вдалося згенерувати унікальний 6-значний код.');
  return '';
}

function leaders(room) {
  return room.members.filter(member => member.role === 'leader');
}

function journal(room, entry) {
  const next = [...room.journal, entry];
  return next.length > MAX_JOURNAL ? next.slice(next.length - MAX_JOURNAL) : next;
}

function entry(room, action, actor, fields, now) {
  return {
    seq: room.nextSeq,
    id: `log-${room.nextSeq}`,
    action,
    actionLabel: ACTION_LABEL[action],
    actorId: actor?.id || '',
    actorName: actor?.name || '',
    actorRole: actor?.role || '',
    actorRoleLabel: actor ? roleLabel(actor.role) : '',
    target: fields.target || '',
    details: fields.details || '',
    timestamp: now,
  };
}

export function publicView(room, memberId = '') {
  if (!room) return null;
  const you = room.members.find(member => member.id === memberId);
  return {
    format: 'easywar-collective-workspace-v1',
    mode: 'server',
    collectiveId: room.collectiveId,
    name: room.name,
    revision: room.journal.length ? room.journal[room.journal.length - 1].seq : 0,
    members: room.members.map(member => ({
      id: member.id,
      name: member.name,
      role: member.role,
      founder: member.founder,
      joinedAt: member.joinedAt,
    })),
    files: room.files.map(file => ({
      id: file.id,
      name: file.name,
      kind: file.kind,
      kindLabel: file.kindLabel,
      content: file.content,
      size: file.size,
      version: file.version,
      updatedAt: file.updatedAt,
      updatedByName: file.updatedByName,
      updatedByRole: file.updatedByRole,
      history: file.history,
    })),
    auditLog: room.journal.map(item => ({ ...item })),
    invites: [],
    yourId: you?.id || '',
    yourRole: you?.role || '',
  };
}

function ok(room, body, memberId) {
  return {
    status: 200,
    changed: true,
    room,
    body: { ok: true, view: publicView(room, memberId), ...body },
  };
}

async function actorOf(room, token) {
  if (!token) fail(401, 'Сеанс недійсний. Вступіть у колектив знову.');
  const hash = await tokenHash(token);
  const actor = room.members.find(member => member.tokenHash === hash);
  if (!actor) fail(401, 'Сеанс недійсний. Вступіть у колектив знову.');
  return actor;
}

function requireRole(actor, roles, message) {
  if (!roles.includes(actor.role)) fail(403, message);
}

export async function applyRoom(room, action) {
  try {
    return await dispatch(room, action);
  } catch (error) {
    return {
      status: error.status || 400,
      changed: false,
      room,
      body: {
        ok: false,
        error: error.message || 'Відхилено.',
        conflict: error.status === 409,
        view: room ? publicView(room) : null,
      },
    };
  }
}

async function dispatch(room, action) {
  switch (action?.op) {
    case 'create':
      return createCollective(action);
    case 'join':
      return join(room, action);
    case 'invite':
      return invite(room, action);
    case 'role':
      return assignRole(room, action);
    case 'remove':
      return removeMember(room, action);
    case 'file':
      return fileOp(room, action);
    case 'sync':
      return sync(room, action);
    default:
      fail(400, 'Невідома дія.');
  }
  return null;
}

async function createCollective(action) {
  const name = cleanLine(action.name, 'Назва колективу', 80);
  const memberName = cleanLine(action.memberName, 'Ім’я', 80);
  const now = Number(action.now) || 0;
  const collectiveId = /^c[0-9a-f]{32}$/u.test(action.collectiveId || '')
    ? action.collectiveId
    : `c${randomHex(action.randomBytes, 16)}`;
  const memberId = `m${randomHex(action.randomBytes, 8)}`;
  const token = randomHex(action.randomBytes, 32);
  const actor = {
    id: memberId,
    name: memberName,
    role: 'leader',
    founder: true,
    tokenHash: await tokenHash(token),
    joinedAt: now,
  };
  let next = {
    collectiveId,
    name,
    createdAt: now,
    nextSeq: 1,
    members: [actor],
    invites: [],
    files: [],
    journal: [],
  };
  const log = entry(next, 'collective_created', actor, {
    target: name,
    details: 'Призначено роль «Керівник» творцю колективу',
  }, now);
  next = { ...next, nextSeq: 2, journal: [log] };
  return {
    status: 201,
    changed: true,
    room: next,
    body: {
      ok: true,
      token,
      memberId,
      collectiveId,
      view: publicView(next, memberId),
    },
  };
}

async function join(room, action) {
  if (!room) fail(404, 'Колектив не знайдено.');
  const code = normalizeCode(action.code);
  if (!code) fail(400, 'Невірний або прострочений код запрошення.');
  const memberName = cleanLine(action.memberName, 'Ім’я', 80);
  const now = Number(action.now) || 0;
  const invite = room.invites.find(item => item.code === code && !item.used);
  if (!invite || invite.expiresAt <= now) fail(400, 'Невірний або прострочений код запрошення.');
  if (room.members.some(member => member.name.toLocaleLowerCase('uk-UA') === memberName.toLocaleLowerCase('uk-UA'))) {
    fail(400, 'Учасник із таким ім’ям уже є в колективі.');
  }
  const memberId = `m${randomHex(action.randomBytes, 8)}`;
  const token = randomHex(action.randomBytes, 32);
  const member = {
    id: memberId,
    name: memberName,
    role: invite.assignedRole,
    founder: false,
    tokenHash: await tokenHash(token),
    joinedAt: now,
  };
  const log = entry(room, 'member_joined', member, {
    target: room.name,
    details: `Роль «${roleLabel(member.role)}»`,
  }, now);
  const next = {
    ...room,
    nextSeq: room.nextSeq + 1,
    members: [...room.members, member],
    invites: room.invites.map(item => (item.code === code ? { ...item, used: true } : item)),
    journal: journal(room, log),
  };
  return {
    status: 200,
    changed: true,
    room: next,
    body: {
      ok: true,
      token,
      memberId,
      collectiveId: room.collectiveId,
      view: publicView(next, memberId),
    },
  };
}

async function invite(room, action) {
  if (!room) fail(404, 'Колектив не знайдено.');
  const actor = await actorOf(room, action.token);
  requireRole(actor, ['leader', 'junior_leader'], 'Запрошувати можуть лише Керівник та Молодший керівник.');
  const requested = action.assignedRole || 'user';
  if (!ROLES.includes(requested)) fail(400, 'Невідома роль.');
  if (actor.role === 'junior_leader' && requested !== 'user') {
    fail(403, 'Молодший керівник може запрошувати лише на роль «Користувач».');
  }
  const now = Number(action.now) || 0;
  const used = new Set([
    ...(action.reserved || []),
    ...room.invites.filter(item => !item.used && item.expiresAt > now).map(item => item.code),
  ]);
  const code = generateInviteCode(action.randomBytes, used);
  const expiresAt = now + INVITE_TTL_MS;
  const log = entry(room, 'invite_created', actor, {
    target: roleLabel(requested),
    details: 'Одноразовий код на 24 години. Сам код у журнал не записується.',
  }, now);
  const next = {
    ...room,
    nextSeq: room.nextSeq + 1,
    invites: [...room.invites, {
      code, assignedRole: requested, expiresAt, issuerId: actor.id, used: false,
    }],
    journal: journal(room, log),
  };
  return ok(next, {
    invite: {
      code,
      displayCode: formatCode(code),
      expiresAt,
      assignedRole: requested,
    },
  }, actor.id);
}

async function assignRole(room, action) {
  if (!room) fail(404, 'Колектив не знайдено.');
  const actor = await actorOf(room, action.token);
  requireRole(actor, ['leader'], 'Призначати ролі може лише Керівник.');
  if (!ROLES.includes(action.role)) fail(400, 'Невідома роль.');
  const target = room.members.find(member => member.id === action.targetId);
  if (!target) fail(404, 'Учасника немає в цьому колективі.');
  if (target.role === 'leader' && action.role !== 'leader' && leaders(room).length < 2) {
    fail(403, 'У колективі має лишатися хоча б один Керівник.');
  }
  if (target.id === actor.id) fail(403, 'Не можна змінювати власну роль.');
  if (target.role === action.role) {
    return { status: 200, changed: false, room, body: { ok: true, view: publicView(room, actor.id) } };
  }
  const now = Number(action.now) || 0;
  const log = entry(room, 'role_assigned', actor, {
    target: target.name,
    details: `«${roleLabel(target.role)}» → «${roleLabel(action.role)}»`,
  }, now);
  const next = {
    ...room,
    nextSeq: room.nextSeq + 1,
    members: room.members.map(member => (member.id === target.id ? { ...member, role: action.role } : member)),
    journal: journal(room, log),
  };
  return ok(next, {}, actor.id);
}

async function removeMember(room, action) {
  if (!room) fail(404, 'Колектив не знайдено.');
  const actor = await actorOf(room, action.token);
  requireRole(actor, ['leader'], 'Вилучати учасників може лише Керівник.');
  const target = room.members.find(member => member.id === action.targetId);
  if (!target) fail(404, 'Учасника немає в цьому колективі.');
  if (target.role === 'leader' && leaders(room).length < 2) {
    fail(403, 'У колективі має лишатися хоча б один Керівник.');
  }
  if (target.id === actor.id) fail(403, 'Не можна вилучити себе. Нехай це зробить інший Керівник.');
  const now = Number(action.now) || 0;
  const log = entry(room, 'member_removed', actor, {
    target: target.name,
    details: `Був «${roleLabel(target.role)}»`,
  }, now);
  const next = {
    ...room,
    nextSeq: room.nextSeq + 1,
    members: room.members.filter(member => member.id !== target.id),
    journal: journal(room, log),
  };
  return ok(next, {}, actor.id);
}

function kindOf(kind, name) {
  if (kind === 'table' || kind === 'document' || kind === 'note') return kind;
  const ext = String(name).split('.').pop()?.toLowerCase() ?? '';
  if (['csv', 'xlsx', 'tsv'].includes(ext)) return 'table';
  return 'document';
}

const KIND_LABEL = Object.freeze({
  document: 'Документ',
  table: 'Таблиця',
  note: 'Робочий файл',
});

async function fileOp(room, action) {
  if (!room) fail(404, 'Колектив не знайдено.');
  const actor = await actorOf(room, action.token);
  const now = Number(action.now) || 0;
  if (action.fileOp === 'create') return createFile(room, actor, action, now);
  if (action.fileOp === 'save') return saveFile(room, actor, action, now);
  if (action.fileOp === 'delete') return deleteFile(room, actor, action, now);
  fail(400, 'Невідома файлова дія.');
  return null;
}

function createFile(room, actor, action, now) {
  if (room.files.length >= MAX_FILES) fail(400, `У колективі не більше ${MAX_FILES} файлів.`);
  const name = cleanLine(action.name, 'Назва файлу', 120);
  const content = cleanContent(action.content);
  const kind = kindOf(action.kind, name);
  const summary = action.summary ? cleanLine(action.summary, 'Опис зміни', 160) : '';
  const id = `f${randomHex(action.randomBytes, 8)}`;
  const file = {
    id,
    name,
    kind,
    kindLabel: KIND_LABEL[kind],
    content,
    size: [...content].length,
    version: 1,
    updatedAt: now,
    updatedByName: actor.name,
    updatedByRole: actor.role,
    history: [{ version: 1, authorName: actor.name, authorRole: actor.role, timestamp: now, summary: summary || 'Створено файл', size: [...content].length }],
  };
  const log = entry(room, 'file_created', actor, {
    target: name,
    details: summary || `Версія 1, ${file.size} симв.`,
  }, now);
  const next = {
    ...room,
    nextSeq: room.nextSeq + 1,
    files: [...room.files, file],
    journal: journal(room, log),
  };
  return ok(next, { fileId: id }, actor.id);
}

function saveFile(room, actor, action, now) {
  const existing = room.files.find(file => file.id === action.fileId);
  if (!existing) fail(404, 'Файл не знайдено.');
  if (Number(action.baseVersion) !== existing.version) {
    const error = new Error('Файл уже змінено іншим учасником. Показано актуальну версію.');
    error.status = 409;
    error.conflict = true;
    throw error;
  }
  const name = cleanLine(action.name ?? existing.name, 'Назва файлу', 120);
  const content = cleanContent(action.content);
  const summary = action.summary ? cleanLine(action.summary, 'Опис зміни', 160) : '';
  const renamed = name !== existing.name;
  const changed = content !== existing.content;
  if (!renamed && !changed) return ok(room, { fileId: existing.id }, actor.id);
  const version = existing.version + 1;
  const kind = kindOf(action.kind || existing.kind, name);
  const file = {
    ...existing,
    name,
    kind,
    kindLabel: KIND_LABEL[kind],
    content,
    size: [...content].length,
    version,
    updatedAt: now,
    updatedByName: actor.name,
    updatedByRole: actor.role,
    history: [
      { version, authorName: actor.name, authorRole: actor.role, timestamp: now, summary: summary || (renamed && !changed ? 'Перейменовано' : 'Оновлено вміст'), size: [...content].length },
      ...existing.history,
    ].slice(0, 20),
  };
  let next = { ...room, files: room.files.map(item => (item.id === file.id ? file : item)) };
  const logs = [];
  if (renamed) {
    logs.push(entry(next, renamed && changed ? 'file_renamed' : 'file_renamed', actor, {
      target: name,
      details: `«${existing.name}» → «${name}»`,
    }, now));
    next = { ...next, nextSeq: next.nextSeq + 1, journal: journal(next, logs[0]) };
  }
  if (changed) {
    const log = entry(next, 'file_updated', actor, {
      target: name,
      details: summary || `Версія ${existing.version} → ${version}`,
    }, now);
    next = { ...next, nextSeq: next.nextSeq + 1, journal: journal(next, log) };
  }
  return ok(next, { fileId: file.id }, actor.id);
}

function deleteFile(room, actor, action, now) {
  const existing = room.files.find(file => file.id === action.fileId);
  if (!existing) fail(404, 'Файл не знайдено.');
  if (Number(action.baseVersion) !== existing.version) {
    fail(409, 'Файл уже змінено іншим учасником. Показано актуальну версію.');
  }
  const log = entry(room, 'file_deleted', actor, {
    target: existing.name,
    details: `Була версія ${existing.version}`,
  }, now);
  const next = {
    ...room,
    nextSeq: room.nextSeq + 1,
    files: room.files.filter(file => file.id !== existing.id),
    journal: journal(room, log),
  };
  return ok(next, {}, actor.id);
}

async function sync(room, action) {
  if (!room) fail(404, 'Колектив не знайдено.');
  const actor = await actorOf(room, action.token);
  return {
    status: 200,
    changed: false,
    room,
    body: { ok: true, view: publicView(room, actor.id) },
  };
}
