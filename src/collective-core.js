// E8 / C1c: детермінована модель членства. Усі залежності надходять від викликача.
export const ROLE_KINDS = Object.freeze(['owner', 'admin', 'member']);
export const EVENT_TYPES = Object.freeze([
  'collective_created', 'member_admitted', 'member_revoked', 'member_left',
  'admin_granted', 'admin_revoked', 'role_label_set',
]);

const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const id = value => typeof value === 'string' && value.length > 0;
const logicalTime = value => Number.isSafeInteger(value) && value >= 0;
const dict = () => Object.create(null);
const put = (obj, key, value) => Object.defineProperty(obj, key, {
  value, enumerable: true, configurable: true, writable: true,
});

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (plain(value)) {
    const out = dict();
    for (const key of Object.keys(value)) put(out, key, frozenCopy(value[key]));
    return Object.freeze(out);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}

const allowed = Object.freeze({
  collective_created: ['owner_member_id'],
  member_admitted: ['member_id', 'request_id', 'candidate_consent', 'approver_member_id'],
  member_revoked: ['member_id'],
  member_left: [],
  admin_granted: ['member_id'],
  admin_revoked: ['member_id'],
  role_label_set: ['label'],
});
const common = ['event_id', 'collective_id', 'type', 'actor_member_id', 'signature', 'now'];

function eventShape(event) {
  if (!plain(event) || !EVENT_TYPES.includes(event.type)) return false;
  if (![event.event_id, event.collective_id, event.actor_member_id, event.signature].every(id)
    || !logicalTime(event.now)) return false;
  return Object.keys(event).every(key => common.includes(key) || allowed[event.type].includes(key));
}

function allEpochs(state, memberId, heldEpochs) {
  if (typeof heldEpochs !== 'function') return false;
  let held;
  try { held = heldEpochs(memberId); } catch { return false; }
  return Array.isArray(held) && state.epochs.every(epoch => held.includes(epoch));
}

function active(state, memberId) {
  return id(memberId) && own(state.members, memberId) && state.members[memberId].active === true;
}

function role(state, memberId) {
  return active(state, memberId) ? state.members[memberId].role : null;
}

function validateAndApply(state, event, heldEpochs) {
  const actor = event.actor_member_id;
  const target = event.member_id;
  if (event.type === 'collective_created') {
    if (state.collectiveId !== null) return 'already-created';
    if (!id(event.owner_member_id) || actor !== event.owner_member_id) return 'invalid-event';
    state.collectiveId = event.collective_id;
    state.ownerMemberId = actor;
    state.epochs.push(0);
    put(state.members, actor, { role: 'owner', active: true, label: '', joinedEpoch: 0 });
    return null;
  }
  if (state.collectiveId === null || event.collective_id !== state.collectiveId) return 'wrong-collective';
  if (!active(state, actor)) return 'not-a-member';
  if (event.type === 'member_admitted') {
    if (![target, event.request_id, event.approver_member_id].every(id)) return 'invalid-event';
    if (event.candidate_consent !== true) return 'no-candidate-consent';
    if (actor !== event.approver_member_id || !active(state, actor)) return 'not-allowed';
    if (!allEpochs(state, actor, heldEpochs)) return 'approver-missing-epochs';
    if (own(state.members, target)) return 'member-exists';
    put(state.members, target, {
      role: 'member', active: true, label: '', joinedEpoch: state.epochs.at(-1), requestId: event.request_id,
    });
    return null;
  }
  if (event.type === 'member_revoked') {
    if (!id(target)) return 'invalid-event';
    if (target === state.ownerMemberId) return 'owner-protected';
    if (!active(state, target)) return 'not-a-member';
    if (role(state, actor) !== 'owner'
      && !(role(state, actor) === 'admin' && role(state, target) === 'member')) return 'not-allowed';
    state.members[target] = { ...state.members[target], active: false };
    state.epochs.push(state.epochs.at(-1) + 1);
    return null;
  }
  if (event.type === 'member_left') {
    if (actor === state.ownerMemberId) return 'owner-cannot-leave';
    state.members[actor] = { ...state.members[actor], active: false };
    state.epochs.push(state.epochs.at(-1) + 1);
    return null;
  }
  if (event.type === 'admin_granted' || event.type === 'admin_revoked') {
    if (!id(target)) return 'invalid-event';
    if (role(state, actor) !== 'owner') return 'not-allowed';
    if (!active(state, target)) return 'not-a-member';
    const expected = event.type === 'admin_granted' ? 'member' : 'admin';
    if (role(state, target) !== expected) return 'not-allowed';
    state.members[target] = { ...state.members[target], role: expected === 'member' ? 'admin' : 'member' };
    return null;
  }
  if (event.type === 'role_label_set') {
    if (typeof event.label !== 'string' || [...event.label].length < 1 || [...event.label].length > 60
      || /[\u0000-\u001f\u007f]/u.test(event.label)) return 'invalid-label';
    state.members[actor] = { ...state.members[actor], label: event.label };
    return null;
  }
  return 'not-allowed';
}

/** Згортання підписаних подій у порядку вхідного масиву; помилки лишаються в rejected. */
export function membershipState(events, { verify, heldEpochs } = {}) {
  const state = { collectiveId: null, ownerMemberId: null, members: dict(), epochs: [], seen: dict(), rejected: [] };
  if (!Array.isArray(events)) return frozenCopy(state);
  for (const event of events) {
    const reject = code => state.rejected.push({ eventId: plain(event) ? event.event_id ?? null : null, code });
    if (!eventShape(event)) { reject('invalid-event'); continue; }
    if (typeof verify !== 'function') { reject('bad-signature'); continue; }
    let valid = false;
    try { valid = verify(frozenCopy(event)) === true; } catch { valid = false; }
    if (!valid) { reject('bad-signature'); continue; }
    const bytes = canonical(event);
    if (own(state.seen, event.event_id)) {
      if (state.seen[event.event_id] !== bytes) reject('integrity_violation');
      continue;
    }
    const error = validateAndApply(state, event, heldEpochs);
    if (error) { reject(error); continue; }
    put(state.seen, event.event_id, bytes);
  }
  return frozenCopy(state);
}

export const isMember = (state, memberId) => active(state, memberId);
export const roleOf = (state, memberId) => role(state, memberId);
export function canApprove(state, memberId, { heldEpochs } = {}) {
  return active(state, memberId) && allEpochs(state, memberId, heldEpochs);
}
export function memberCapabilities(state, memberId, { heldEpochs } = {}) {
  let provided = [];
  try { if (typeof heldEpochs === 'function') provided = heldEpochs(memberId); } catch { /* відмова */ }
  const held = Array.isArray(provided) ? state.epochs.filter(epoch => provided.includes(epoch)) : [];
  const missing = state.epochs.filter(epoch => !held.includes(epoch));
  return Object.freeze({
    isMember: active(state, memberId), heldEpochs: Object.freeze(held), missingEpochs: Object.freeze(missing),
    canApproveJoin: active(state, memberId) && missing.length === 0,
    canUseCurrentEpoch: active(state, memberId) && held.includes(state.epochs.at(-1)),
  });
}
export function canRevoke(state, actorId, targetId) {
  if (!active(state, actorId) || !active(state, targetId) || targetId === state.ownerMemberId) return false;
  return role(state, actorId) === 'owner'
    || (role(state, actorId) === 'admin' && role(state, targetId) === 'member');
}
export function epochRecipients(state, epoch) {
  if (!state.epochs.includes(epoch)) return Object.freeze([]);
  return Object.freeze(Object.keys(state.members).filter(memberId => active(state, memberId)).sort());
}
export function adminWarnings(state) {
  const count = Object.keys(state.members).filter(memberId => ['owner', 'admin'].includes(role(state, memberId))).length;
  return Object.freeze(count < 2 ? ['single-admin'] : []);
}
export function historyStatusByTable(tables) {
  const byTable = dict();
  let invalid = !Array.isArray(tables) || tables.length === 0;
  if (Array.isArray(tables)) for (const table of tables) {
    if (!plain(table) || !id(table.tableId) || own(byTable, table.tableId)) {
      invalid = true;
      continue;
    }
    put(byTable, table.tableId, table.keysComplete === true && table.historyComplete === true ? 'complete' : 'pending');
  }
  const pending = invalid || Object.values(byTable).includes('pending');
  return Object.freeze({ byTable: Object.freeze(byTable), pending });
}
