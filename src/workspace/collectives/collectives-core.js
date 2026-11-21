// Колективи: локальний і спільний файл колективу (.ewcoll) зі складом, 3 ролями
// (Керівник, Молодший керівник, Користувач), 6-значним кодом запрошення, колективним
// файловим середовищем і журналом редагувань та призначення ролей.
export const FORMAT = 'easywar-collective-local-v1';
export const MAX_PARTICIPANTS = 100;
const MAX_FILE_BYTES = 64 * 1024;
const encoder = new TextEncoder();

/** Три ролі колективу: Керівник (творець, owner), Молодший керівник (admin), Користувач (member). */
export const ROLE_TITLES = Object.freeze({
  owner: 'Керівник',
  admin: 'Молодший керівник',
  member: 'Користувач',
  leader: 'Керівник',
  junior_leader: 'Молодший керівник',
  user: 'Користувач',
});

const ROLE_TO_CANONICAL = Object.freeze({
  owner: 'owner',
  leader: 'owner',
  admin: 'admin',
  junior_leader: 'admin',
  member: 'member',
  user: 'member',
});

export function canonicalRole(role) {
  const mapped = ROLE_TO_CANONICAL[String(role ?? '').trim().toLowerCase()];
  if (!mapped) throw new Error('Невідома роль.');
  return mapped;
}

export function roleTitle(role) {
  return ROLE_TITLES[canonicalRole(role)];
}

function label(value, kind = 'Назва', max = 80) {
  if (typeof value !== 'string') throw new Error(kind + ': введіть текст.');
  const text = value.trim().replace(/\s+/gu, ' ');
  if (!text || text.length > max || /[\p{Cc}\p{Cf}]/u.test(text)) {
    throw new Error(kind + `: від 1 до ${max} символів без керівних знаків.`);
  }
  return text;
}

function checkExtra(draft) {
  const extra = {};
  if (draft.inviteCode !== undefined && draft.inviteCode !== null) {
    const code = String(draft.inviteCode).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error('Код запрошення має містити 6 цифр.');
    extra.inviteCode = code;
    if (draft.inviteRole !== undefined) {
      const r = canonicalRole(draft.inviteRole);
      if (r === 'owner') throw new Error('Неприпустима роль для запрошення.');
      extra.inviteRole = r;
    }
  }
  if (draft.files !== undefined) {
    if (!Array.isArray(draft.files) || draft.files.length > 100) throw new Error('Некоректний список файлів колективу.');
    extra.files = draft.files.map(file => {
      if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('Пошкоджений запис файлу колективу.');
      const id = label(String(file.id ?? ''), 'Ідентифікатор файлу', 64);
      const name = label(String(file.name ?? ''), 'Назва файлу', 120);
      const kind = ['document', 'table', 'note'].includes(file.kind) ? file.kind : 'document';
      const content = String(file.content ?? '');
      if (content.length > 32768 || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/u.test(content)) {
        throw new Error('Недопустимий вміст файлу колективу.');
      }
      const version = Number.isSafeInteger(file.version) && file.version >= 1 ? file.version : 1;
      const updatedBy = label(String(file.updatedBy ?? 'Керівник'), 'Автор зміни', 80);
      const updatedAt = typeof file.updatedAt === 'string' ? file.updatedAt : '';
      return { id, name, kind, content, version, updatedBy, updatedAt };
    });
  }
  if (draft.auditLog !== undefined) {
    if (!Array.isArray(draft.auditLog) || draft.auditLog.length > 500) throw new Error('Некоректний журнал редагувань.');
    extra.auditLog = draft.auditLog.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Пошкоджений запис журналу.');
      return {
        id: label(String(entry.id ?? 'log-1'), 'ID запису журналу', 64),
        action: label(String(entry.action ?? 'Дія'), 'Дія журналу', 80),
        actor: label(String(entry.actor ?? 'Учасник'), 'Автор дії', 80),
        role: canonicalRole(entry.role ?? 'member'),
        target: entry.target ? label(String(entry.target), 'Ціль дії', 120) : '',
        details: entry.details ? label(String(entry.details), 'Деталі дії', 200) : '',
        at: typeof entry.at === 'string' ? entry.at : '',
      };
    });
  }
  return extra;
}

function check(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || draft.format !== FORMAT) {
    throw new Error('Невідомий формат локального колективу.');
  }
  const name = label(draft.name);
  if (!Array.isArray(draft.participants) || draft.participants.length < 1
      || draft.participants.length > MAX_PARTICIPANTS || !Number.isSafeInteger(draft.nextId)
      || draft.nextId <= 1 || draft.nextId > 1000000) throw new Error('Пошкоджений список учасників.');
  const used = new Set();
  const names = new Set();
  const participants = draft.participants.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Number.isSafeInteger(entry.id)
        || entry.id < 1 || entry.id >= draft.nextId || used.has(entry.id)) throw new Error('Некоректний ідентифікатор учасника.');
    const person = label(entry.label, 'Позначення учасника');
    const key = person.toLocaleLowerCase('uk-UA');
    if (names.has(key)) throw new Error('Повторне позначення учасника.');
    const role = canonicalRole(entry.role);
    if (!['owner', 'admin', 'member'].includes(role)) throw new Error('Невідома роль.');
    if ((index === 0) !== (entry.id === 1 && role === 'owner')
        || (index > 0 && role === 'owner')) throw new Error('Власник колективу має бути один.');
    used.add(entry.id);
    names.add(key);
    return { id: entry.id, label: person, role };
  });
  return { format: FORMAT, name, participants, nextId: draft.nextId, ...checkExtra(draft) };
}

export function createCollective(name, owner) {
  return check({ format: FORMAT, name, nextId: 2, participants: [{ id: 1, label: owner, role: 'owner' }] });
}

export function renameCollective(draft, name) {
  return check({ ...check(draft), name: label(name) });
}

export function addParticipant(draft, name, role = 'member') {
  const current = check(draft);
  if (current.participants.length >= MAX_PARTICIPANTS) throw new Error('Гранична кількість учасників — 100.');
  const r = canonicalRole(role);
  if (!['admin', 'member'].includes(r)) throw new Error('Неприпустима роль.');
  return check({ ...current, nextId: current.nextId + 1,
    participants: [...current.participants, { id: current.nextId, label: name, role: r }] });
}

export function changeParticipantRole(draft, id, role) {
  const current = check(draft);
  const r = canonicalRole(role);
  if (id === 1 || !['admin', 'member'].includes(r)) throw new Error('Роль власника змінювати не можна.');
  if (!current.participants.some(item => item.id === id)) throw new Error('Учасника не знайдено.');
  return check({ ...current, participants: current.participants.map(item => item.id === id ? { ...item, role: r } : item) });
}

export function removeParticipant(draft, id) {
  const current = check(draft);
  if (id === 1) throw new Error('Власника колективу видаляти не можна.');
  if (!current.participants.some(item => item.id === id)) throw new Error('Учасника не знайдено.');
  return check({ ...current, participants: current.participants.filter(item => item.id !== id) });
}

export function encodeCollective(draft) {
  const bytes = encoder.encode(JSON.stringify(check(draft)) + '\n');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Файл колективу завеликий.');
  return bytes;
}

export function decodeCollective(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_FILE_BYTES) {
    throw new Error('Недопустимий розмір файлу колективу.');
  }
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Не вдалося прочитати файл колективу.'); }
  return check(raw);
}

