// Політики комбінованої синхронізації спільної таблиці — етап E8 / C1d.
//
// Чисте ядро без DOM, мережі, сховищ, годинника й криптографії. Застосунок цей файл поки не
// імпортує; авторитетну перевірку перед відправкою робить Rust (C3b). Тут — та сама логіка для
// пояснень людині й спільні сценарії тестів.
//
// Правила (docs/adr/collective-sync-policies.md; docs/COLLECTIVES_PLAN.md, 5.3, 5.6, К1, К2, К6;
// AGENTS.md, External integrations):
// - цільова архітектура — дві незалежні політики на таблицю: відправки й застосування;
// - активні лише значення, що відповідають чинній поведінці: «Доповісти» з показом перед
//   відправкою (REVIEW_EACH_REPORT) і застосування перевіреного (AUTO_APPLY_VERIFIED);
// - решта значень (автовідправка, ручне приймання, вимкнення) не активні до окремих рішень
//   власника (JE-03, JE-04, JE-06) і повертають відмову OwnerDecisionRequired;
// - порядок перевірки відправки за ADR (п. 3): маршрут (routeFor) → політика → право запису
//   автора → підтвердження людиною в «Доповісти»; перевірка повторюється перед відправкою;
// - політику таблиці змінюють лише власник таблиці й адміністратори (К6); політика не дає
//   права запису.

import { routeFor } from './sensitivity-core.js';

export const OUTBOUND_POLICIES = Object.freeze(['AUTO_AFTER_LOCAL_APPROVAL', 'REVIEW_EACH_REPORT', 'DISABLED']);
export const INBOUND_POLICIES = Object.freeze(['AUTO_APPLY_VERIFIED', 'REVIEW_BEFORE_APPLY', 'DISABLED']);

/**
 * Активні значення. Розширення — лише окремим рішенням власника разом зі зміною тесту, який
 * вимагає точного переліку; автовідправка ще й вимагає правки AGENTS.md.
 */
export const ACTIVE_POLICIES = Object.freeze({
  outbound: Object.freeze(['REVIEW_EACH_REPORT']),
  inbound: Object.freeze(['AUTO_APPLY_VERIFIED']),
});

/** Чинна поведінка за замовчуванням. */
export const DEFAULT_TABLE_POLICY = Object.freeze({
  outbound: 'REVIEW_EACH_REPORT', inbound: 'AUTO_APPLY_VERIFIED', version: 0,
});

/** Статуси для людини (ADR collective-sync-policies.md). «Синхронізовано з усіма» — немає. */
export const STATUS_LABELS = Object.freeze({
  saved_locally: 'Локально збережено',
  awaiting_report: 'Очікує «Доповісти»',
  queued: 'У черзі',
  forwarded: 'Передано вузлу',
  stored: 'Збережено у сховищі',
  received_verified: 'Отримано й перевірено',
  pending_review: 'Очікує приймання',
  conflict: 'Конфлікт',
  quarantined: 'Карантин',
  applied_here: 'Застосовано на цьому пристрої',
  last_reconcile: 'Остання успішна звірка',
});

const OWNER_DECISION = 'OwnerDecisionRequired';
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const opts = v => (isPlainObject(v) ? v : {});
const decision = (allowed, code, reason, extra = {}) => Object.freeze({ allowed, code, reason, ...extra });

const ownerDecision = (direction, policy) => decision(false, OWNER_DECISION,
  direction === 'outbound'
    ? `Режим відправки «${policy}» не активний: потрібне окреме рішення власника`
    : `Режим приймання «${policy}» не активний: потрібне окреме рішення власника`,
  { direction, policy });

/** Перевірка значення політики: невідоме — помилка, відоме неактивне — OwnerDecisionRequired. */
export function checkPolicyValue(direction, policy) {
  const known = direction === 'outbound' ? OUTBOUND_POLICIES : direction === 'inbound' ? INBOUND_POLICIES : null;
  if (!known) return decision(false, 'unknown-direction', 'Невідомий напрям обміну');
  if (!known.includes(policy)) return decision(false, 'unknown-policy', 'Невідомий режим обміну — відмова');
  if (!ACTIVE_POLICIES[direction].includes(policy)) return ownerDecision(direction, policy);
  return decision(true, 'active', 'Режим активний');
}

/**
 * Чи можна відправити зміни цієї таблиці зараз.
 * ctx: { policy, tableClass, transport, endToEnd, authorId, writers, reviewedByHuman }
 * reviewedByHuman — людина переглянула «було → стане» й натиснула «Доповісти» (Q10г).
 */
export function evaluateOutbound(ctx) {
  const c = opts(ctx);
  const route = routeFor(c.tableClass, c.transport, { endToEnd: c.endToEnd === true });
  if (!route.allowed) return decision(false, route.code, route.reason);
  const p = checkPolicyValue('outbound', c.policy);
  if (!p.allowed) return p;
  if (!Array.isArray(c.writers) || !c.writers.includes(c.authorId)) {
    return decision(false, 'no-write-right', 'Немає права вносити дані в цю таблицю');
  }
  if (c.reviewedByHuman !== true) {
    return decision(false, 'needs-report-review', 'Перед відправкою перегляньте зміни й натисніть «Доповісти»');
  }
  return decision(true, 'allowed', 'Можна відправити');
}

/**
 * Що робити з отриманою операцією за політикою застосування.
 * ctx: { policy, applyStatus } — applyStatus з applyOperation (shared-table-core.js).
 * @returns {{ allowed, code, reason, action?: 'apply'|'conflict'|'quarantine'|'reject'|'skip', notify?: boolean }}
 */
export function evaluateInbound(ctx) {
  const c = opts(ctx);
  const p = checkPolicyValue('inbound', c.policy);
  if (!p.allowed) return p;
  switch (c.applyStatus) {
    case 'applied':
      return decision(true, 'apply', 'Застосовано на цьому пристрої', { action: 'apply', notify: c.kind === 'delete' });
    case 'duplicate':
      return decision(true, 'skip', 'Повтор уже застосованої операції', { action: 'skip' });
    case 'conflict':
      return decision(false, 'conflict', 'Конфлікт: потрібне рішення учасника з правом запису', { action: 'conflict' });
    case 'quarantined':
      return decision(false, 'quarantine', 'Карантин: невідома версія схеми', { action: 'quarantine' });
    case 'integrity_violation':
    case 'rejected':
      return decision(false, 'reject', 'Операцію відхилено перевіркою', { action: 'reject' });
    default:
      return decision(false, 'unknown-apply-status', 'Невідомий результат перевірки — не застосовано', { action: 'reject' });
  }
}

/**
 * Зміна політики таблиці. Змінюють лише власник таблиці й адміністратори (К6); неактивні значення
 * відхиляються; кожна зміна — нова версія.
 * change: { outbound?, inbound? }; actor: { memberId, role: 'owner'|'admin'|'member', isTableOwner }
 */
export function changeTablePolicy(current, change, actor) {
  const cur = isPlainObject(current) ? current : DEFAULT_TABLE_POLICY;
  const ch = opts(change);
  const a = opts(actor);
  if (!(a.isTableOwner === true || a.role === 'admin' || a.role === 'owner')) {
    return Object.freeze({ ok: false, code: 'not-allowed', reason: 'Змінювати політику таблиці можуть лише власник таблиці й адміністратори', policy: cur });
  }
  const keys = Object.keys(ch);
  if (keys.length === 0 || keys.some(k => k !== 'outbound' && k !== 'inbound')) {
    return Object.freeze({ ok: false, code: 'invalid-change', reason: 'Невідома зміна політики', policy: cur });
  }
  for (const k of keys) {
    const p = checkPolicyValue(k, ch[k]);
    if (!p.allowed) return Object.freeze({ ok: false, code: p.code, reason: p.reason, policy: cur });
  }
  const version = Number.isSafeInteger(cur.version) && cur.version >= 0 ? cur.version + 1 : 1;
  return Object.freeze({ ok: true, code: 'changed', policy: Object.freeze({ ...cur, ...ch, version, changedBy: a.memberId ?? null }) });
}
