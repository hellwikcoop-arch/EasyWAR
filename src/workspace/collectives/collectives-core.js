// Колективи: локальний файл підготовки складу, без мережі, ключів чи автентифікації.
// Позначення людей у цьому файлі не підтверджують членство або право доступу.
export const FORMAT = 'easywar-collective-local-v1';
export const MAX_PARTICIPANTS = 100;
const MAX_FILE_BYTES = 64 * 1024;
const encoder = new TextEncoder();

function label(value, kind = 'Назва') {
  if (typeof value !== 'string') throw new Error(kind + ': введіть текст.');
  const text = value.trim().replace(/\s+/gu, ' ');
  if (!text || text.length > 80 || /[\p{Cc}\p{Cf}]/u.test(text)) {
    throw new Error(kind + ': від 1 до 80 символів без керівних знаків.');
  }
  return text;
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
    if (!['owner', 'admin', 'member'].includes(entry.role)) throw new Error('Невідома роль.');
    if ((index === 0) !== (entry.id === 1 && entry.role === 'owner')
        || (index > 0 && entry.role === 'owner')) throw new Error('Власник колективу має бути один.');
    used.add(entry.id);
    names.add(key);
    return { id: entry.id, label: person, role: entry.role };
  });
  return { format: FORMAT, name, participants, nextId: draft.nextId };
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
  if (!['admin', 'member'].includes(role)) throw new Error('Неприпустима роль.');
  return check({ ...current, nextId: current.nextId + 1,
    participants: [...current.participants, { id: current.nextId, label: name, role }] });
}

export function changeParticipantRole(draft, id, role) {
  const current = check(draft);
  if (id === 1 || !['admin', 'member'].includes(role)) throw new Error('Роль власника змінювати не можна.');
  if (!current.participants.some(item => item.id === id)) throw new Error('Учасника не знайдено.');
  return check({ ...current, participants: current.participants.map(item => item.id === id ? { ...item, role } : item) });
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
