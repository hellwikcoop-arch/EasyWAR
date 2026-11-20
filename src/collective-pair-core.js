// E8 / C1c: чиста машина станів запрошення та окремих заявок Pair.
import { canApprove, historyStatusByTable, isMember } from './collective-core.js';

export const PAIR_STATES = Object.freeze([
  'DRAFT', 'ACTIVE', 'JOIN_REQUESTED', 'SAS_VERIFIED', 'APPROVED_BOTH',
  'MEMBERSHIP_RECORDED', 'KEYS_DISTRIBUTED', 'HISTORY_VERIFIED', 'COMPLETE',
  'EXPIRED', 'REVOKED', 'REJECTED', 'RATE_LIMITED', 'WAITING_FOR_APPROVAL',
  'PENDING_HISTORY', 'ERROR_RETRYABLE',
]);
export const PAIR_EVENTS = Object.freeze([
  'activate', 'join_requested', 'sas_result', 'candidate_confirmed',
  'approver_confirmed', 'approver_unavailable', 'membership_recorded',
  'keys_distributed', 'history_verified', 'complete', 'retryable_error',
  'retry', 'expire', 'revoke',
]);
export const INVITATION_MODES = Object.freeze(['personal', 'group']);

const own = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const id = value => typeof value === 'string' && value.length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const dict = () => Object.create(null);
const put = (obj, key, value) => Object.defineProperty(obj, key, {
  value, enumerable: true, configurable: true, writable: true,
});
function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (plain(value)) {
    const out = dict();
    for (const key of Object.keys(value)) put(out, key, copy(value[key]));
    return out;
  }
  return value;
}
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (plain(value)) {
    const out = dict();
    for (const key of Object.keys(value)) put(out, key, freeze(value[key]));
    return Object.freeze(out);
  }
  return value;
}
const result = (ok, state, code = null) => Object.freeze({ ok, state, code });
const fail = (state, code) => result(false, state, code);
const positive = value => Number.isSafeInteger(value) && value > 0;
function configured(config) {
  if (!plain(config)) return 'config-required';
  if (config.profileHasPassword !== true) return 'profile-without-password';
  return positive(config.maxAttempts) && positive(config.maxActiveRequests) ? null : 'config-required';
}

/** Параметри часу та лімітів завжди задає викликач. */
export function createInvitation({ invitationId, collectiveId, inviterId, mode, maxJoins, expiresAt, now } = {}, config) {
  const error = configured(config);
  if (error) return fail(null, error);
  if (![invitationId, collectiveId, inviterId].every(id) || !INVITATION_MODES.includes(mode)
    || !positive(maxJoins) || (mode === 'personal' && maxJoins !== 1)
    || !integer(now) || !integer(expiresAt) || expiresAt <= now) return fail(null, 'invalid-invitation');
  return result(true, freeze({
    invitationId, collectiveId, inviterId, mode, maxJoins, expiresAt,
    status: 'DRAFT', joinsUsed: 0, attempts: 0, requests: dict(),
  }));
}

const terminalRequest = status => ['COMPLETE', 'EXPIRED', 'REVOKED', 'REJECTED'].includes(status);
const acceptedRequest = status => [
  'MEMBERSHIP_RECORDED', 'KEYS_DISTRIBUTED', 'HISTORY_VERIFIED', 'COMPLETE', 'PENDING_HISTORY',
].includes(status);
const activeCount = requests => Object.values(requests).filter(req => !terminalRequest(req.status)).length;
const changeRequest = (next, requestId, patch) => {
  put(next.requests, requestId, { ...next.requests[requestId], ...patch });
};

/** Недозволений перехід повертає той самий стан без мутації. */
export function pairTransition(state, event, ctx = {}) {
  if (!plain(state) || !plain(event) || !PAIR_EVENTS.includes(event.type)) return fail(state, 'invalid-transition');
  const error = configured(ctx.config);
  if (error) return fail(state, error);
  const next = copy(state);
  if (event.type === 'activate') {
    if (state.status !== 'DRAFT') return fail(state, 'invalid-transition');
    // The local invitation itself does not prove collective membership of its inviter.
    if (!ctx.membership || ctx.membership.collectiveId !== state.collectiveId
      || !isMember(ctx.membership, state.inviterId)) return fail(state, 'inviter-not-authorized');
    next.status = 'ACTIVE';
    return result(true, freeze(next));
  }
  if (event.type === 'expire' || event.type === 'revoke') {
    if (['EXPIRED', 'REVOKED'].includes(state.status)) return fail(state, 'invalid-transition');
    if (event.type === 'expire' && (!integer(event.now) || event.now < state.expiresAt)) return fail(state, 'invalid-transition');
    next.status = event.type === 'expire' ? 'EXPIRED' : 'REVOKED';
    for (const requestId of Object.keys(next.requests)) {
      const request = next.requests[requestId];
      if (!acceptedRequest(request.status) && !terminalRequest(request.status)) {
        changeRequest(next, requestId, { status: next.status });
      }
    }
    return result(true, freeze(next));
  }
  if (event.type === 'join_requested') {
    if (!id(event.requestId) || !id(event.candidateId) || !integer(event.now)) return fail(state, 'invalid-transition');
    const old = state.requests[event.requestId];
    if (own(state.requests, event.requestId)) {
      return old.candidateId === event.candidateId && old.now === event.now
        ? result(true, state) : fail(state, 'request-id-conflict');
    }
    if (state.status !== 'ACTIVE') return fail(state, 'invalid-transition');
    if (event.now >= state.expiresAt) return fail(state, 'invitation-expired');
    if (state.joinsUsed >= state.maxJoins) return fail(state, 'invitation-exhausted');
    if (activeCount(state.requests) >= ctx.config.maxActiveRequests) return fail(state, 'too-many-active-requests');
    put(next.requests, event.requestId, {
      status: 'JOIN_REQUESTED', requestId: event.requestId, candidateId: event.candidateId,
      now: event.now, candidateConfirmed: false, approverConfirmed: false,
      membershipRecorded: false, keysComplete: false, historyComplete: false, byTable: dict(),
    });
    return result(true, freeze(next));
  }
  if (!id(event.requestId) || !own(state.requests, event.requestId)) return fail(state, 'invalid-transition');
  const request = state.requests[event.requestId];
  const status = request.status;
  if (event.type === 'sas_result') {
    if (status !== 'JOIN_REQUESTED' || typeof event.match !== 'boolean') return fail(state, 'invalid-transition');
    if (event.match === false) {
      next.attempts += 1;
      changeRequest(next, event.requestId, { status: 'REJECTED' });
      if (next.attempts >= ctx.config.maxAttempts) next.status = 'RATE_LIMITED';
    } else changeRequest(next, event.requestId, { status: 'SAS_VERIFIED' });
  } else if (event.type === 'candidate_confirmed') {
    if (!['SAS_VERIFIED', 'WAITING_FOR_APPROVAL'].includes(status) || request.candidateConfirmed) return fail(state, 'invalid-transition');
    changeRequest(next, event.requestId, {
      candidateConfirmed: true, status: request.approverConfirmed ? 'APPROVED_BOTH' : status,
    });
  } else if (event.type === 'approver_confirmed') {
    if (!['SAS_VERIFIED', 'WAITING_FOR_APPROVAL'].includes(status) || request.approverConfirmed
      || !id(event.approverId)) return fail(state, 'invalid-transition');
    // A valid member of a different collective must never approve this invitation.
    if (!ctx.membership || ctx.membership.collectiveId !== state.collectiveId) {
      return fail(state, 'wrong-collective');
    }
    if (!canApprove(ctx.membership, event.approverId, { heldEpochs: ctx.heldEpochs })) {
      return fail(state, 'approver-missing-epochs');
    }
    changeRequest(next, event.requestId, {
      approverConfirmed: true, approverId: event.approverId,
      status: request.candidateConfirmed ? 'APPROVED_BOTH' : 'SAS_VERIFIED',
    });
  } else if (event.type === 'approver_unavailable') {
    if (!['SAS_VERIFIED', 'WAITING_FOR_APPROVAL'].includes(status) || request.approverConfirmed) return fail(state, 'invalid-transition');
    changeRequest(next, event.requestId, { status: 'WAITING_FOR_APPROVAL' });
  } else if (event.type === 'membership_recorded') {
    if (status !== 'APPROVED_BOTH') return fail(state, 'invalid-transition');
    if (state.joinsUsed >= state.maxJoins) return fail(state, 'invitation-exhausted');
    if (!ctx.membership || ctx.membership.collectiveId !== state.collectiveId) {
      return fail(state, 'wrong-collective');
    }
    if (!isMember(ctx.membership, request.candidateId)) return fail(state, 'membership-not-recorded');
    next.joinsUsed += 1;
    changeRequest(next, event.requestId, { status: 'MEMBERSHIP_RECORDED', membershipRecorded: true });
  } else if (event.type === 'keys_distributed') {
    if (!['MEMBERSHIP_RECORDED', 'PENDING_HISTORY'].includes(status) || request.membershipRecorded !== true
      || typeof event.complete !== 'boolean') return fail(state, 'invalid-transition');
    changeRequest(next, event.requestId, {
      keysComplete: event.complete,
      status: event.complete ? 'KEYS_DISTRIBUTED' : 'PENDING_HISTORY',
    });
  } else if (event.type === 'history_verified') {
    if (!['KEYS_DISTRIBUTED', 'PENDING_HISTORY'].includes(status) || request.keysComplete !== true
      || !Array.isArray(event.byTable) || event.byTable.length === 0) return fail(state, 'invalid-transition');
    const history = historyStatusByTable(event.byTable);
    changeRequest(next, event.requestId, {
      byTable: history.byTable, historyComplete: !history.pending,
      status: history.pending ? 'PENDING_HISTORY' : 'HISTORY_VERIFIED',
    });
  } else if (event.type === 'complete') {
    if (status !== 'HISTORY_VERIFIED' || !request.membershipRecorded
      || !request.keysComplete || !request.historyComplete) return fail(state, 'invalid-transition');
    changeRequest(next, event.requestId, { status: 'COMPLETE' });
  } else if (event.type === 'retryable_error') {
    if (terminalRequest(status) || status === 'ERROR_RETRYABLE') return fail(state, 'invalid-transition');
    changeRequest(next, event.requestId, { status: 'ERROR_RETRYABLE', previousStatus: status });
  } else if (event.type === 'retry') {
    if (status !== 'ERROR_RETRYABLE' || !PAIR_STATES.includes(request.previousStatus)) return fail(state, 'invalid-transition');
    changeRequest(next, event.requestId, { status: request.previousStatus, previousStatus: null });
  } else return fail(state, 'invalid-transition');
  return result(true, freeze(next));
}
