// Захищені колективи: чиста логіка для екрана (без DOM і IPC). Стан приходить від Rust
// (collective_status) і містить лише відбитки, назви й лічильники — секретів тут немає.
export const MIN_PASSWORD_BYTES = 8;
export const MAX_COLLECTIVES = 20;
const encoder = new TextEncoder();

/** Текст стану сховища ключів для користувача. */
export function keyStoreText(status) {
  switch (status?.keyStore) {
    case 'absent': return 'Ключа учасника ще немає. Створіть його паролем профілю.';
    case 'locked': return 'Ключ учасника створено; секрети зберігаються під паролем профілю.';
    case 'damaged': return 'Сховище ключів пошкоджене або належить іншому профілю. Створити новий ключ неможливо, поки файл не прибрано.';
    default: return 'Стан ключа невідомий.';
  }
}

/** Чи можна створити ключ або колектив за цим станом. */
export function canCreateIdentity(status) {
  return status?.keyStore === 'absent' && !status?.identity;
}
export function canCreateCollective(status) {
  return Boolean(status?.identity) && status?.keyStore === 'locked'
    && (status?.collectives?.length ?? 0) < MAX_COLLECTIVES;
}

/** Перевірка пароля до виклику Rust (та сама межа, що й у Rust: 8–1024 байтів UTF-8). */
export function checkPassword(password) {
  const bytes = encoder.encode(String(password ?? '')).length;
  if (bytes < MIN_PASSWORD_BYTES || bytes > 1024) throw new Error('Пароль профілю: від 8 до 1024 байтів.');
}

/** Рядок про колектив у списку. */
export function collectiveLine(summary) {
  const parts = [`учасників: ${summary.members}`, `записів журналу: ${summary.latestSeq}`];
  if (summary.rejectedRecords > 0) parts.push(`відхилених записів: ${summary.rejectedRecords}`);
  return parts.join(', ');
}

// --- Обмін у колективі (C3b, другий зріз) ---------------------------------------------------
// Rust — авторитетне джерело: клас, право запису й допуск рахує він; тут лише підписи для
// людини й перевірки форми до виклику.

export const CLASS_OPTIONS = Object.freeze([
  Object.freeze({ value: 'A', label: 'A — найменш чутливий' }),
  Object.freeze({ value: 'B', label: 'B' }),
  Object.freeze({ value: 'C', label: 'C — облік після факту, можна через інтернет після прийняття' }),
  Object.freeze({ value: 'D', label: 'D — лише локальна мережа' }),
]);
export const PURPOSE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'after-fact', label: 'Облік після факту' }),
  Object.freeze({ value: 'planned', label: 'Планові або попередні дані (завжди D)' }),
]);
export const TRANSPORT_OPTIONS = Object.freeze([
  Object.freeze({ value: 'lan', label: 'Локальна мережа (LAN)' }),
  Object.freeze({ value: 'peer_wan', label: 'Інтернет через інший EasyWAR' }),
  Object.freeze({ value: 'base44', label: 'Base44 власника' }),
]);
export const MAX_OPERATION_BYTES = 64 * 1024;
const TEXT_KINDS = Object.freeze({ 'EWINV1.': 'invitation', 'EWJOIN1.': 'request', 'EWKEYS1.': 'keys' });
const KIND_NAMES = Object.freeze({ invitation: 'запрошення', request: 'відповідь на запрошення', keys: 'пакет ключів' });

const purposeLabel = value => PURPOSE_OPTIONS.find(option => option.value === value)?.label ?? 'Невідоме призначення';

/** Рядок про таблицю колективу. Різниця між вказаним і чинним класом пояснюється. */
export function tableLine(table) {
  const parts = [`клас ${table.class}`];
  if (table.declaredClass !== table.class) parts[0] += ` (вказано ${table.declaredClass}; діє D, бо дані не підтверджені як облік після факту)`;
  const purpose = purposeLabel(table.purpose);
  parts.push(purpose.charAt(0).toLowerCase() + purpose.slice(1));
  parts.push(table.canWrite ? 'запис дозволено' : 'без права запису');
  if (table.mine) parts.push('ваша таблиця');
  return parts.join(', ');
}

/** Рядок про стан колективу. */
export function detailLine(detail) {
  return `епоха ${detail.epoch}, записів журналу: ${detail.latestSeq}, у локальній черзі відправки: ${detail.outbox}`;
}

/** Попередження до «Доповісти» за обраним транспортом. Остаточне рішення — у Rust. */
export function transportNote(detail, transport) {
  if (transport === 'peer_wan' && !detail?.wanAccepted) {
    return 'Інтернет-обмін ще не прийнятий власником: «Підготувати» поверне відмову. Клас таблиці обміну між учасниками не блокує.';
  }
  if (transport === 'base44' && !detail?.base44Accepted) {
    return 'Base44 ще не відкритий власником: «Підготувати» поверне відмову. Клас D у хмару не йде ніколи.';
  }
  return 'Конверт ляже в локальну чергу відправки; мережі на цьому етапі немає.';
}

/**
 * Підсумок кроку «Підготувати»: що саме буде відправлено, якщо підтвердити паролем.
 * Це прив'язка підтвердження до операції в Rust, а не доказ натискання людиною.
 */
export function preparedText(prepared) {
  if (!prepared?.allowed) return reportText(prepared);
  return `Таблиця «${prepared.table}», клас ${prepared.class}, транспорт ${prepared.transport}, `
    + `адресати: ${prepared.recipients}, ${prepared.bytes} байт. Підтвердьте паролем протягом ${prepared.expiresIn} с.`;
}

/** Відповідь «Доповісти» для людини. */
export function reportText(outcome) {
  if (outcome?.allowed) return `${outcome.message}. У черзі: ${outcome.outbox}.`;
  return `Відмова (${outcome?.code ?? 'невідомо'}): ${outcome?.message ?? 'невідома причина'}.`;
}

/** Операція «Доповісти»: не порожня й не більша за 64 КіБ (та сама межа в Rust). */
export function checkOperation(text) {
  const bytes = encoder.encode(String(text ?? '')).length;
  if (bytes === 0 || bytes > MAX_OPERATION_BYTES) throw new Error('Операція: від 1 байта до 64 КіБ.');
}

/** Строк запрошення в годинах: ціле від 1 до 168. */
export function checkHours(value) {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('Строк запрошення: від 1 до 168 годин.');
  return hours;
}

/** Який текст вставлено: запрошення, відповідь чи пакет ключів (за префіксом). */
export function textKind(text) {
  const compact = String(text ?? '').replace(/\s+/g, '');
  for (const [prefix, kind] of Object.entries(TEXT_KINDS)) if (compact.startsWith(prefix)) return kind;
  return null;
}

/** Перевірка, що вставлено саме той текст, який очікує форма. */
export function expectText(text, kind) {
  const actual = textKind(text);
  if (actual === kind) return;
  throw new Error(actual
    ? `Вставлено ${KIND_NAMES[actual]}, а тут потрібно вставити: ${KIND_NAMES[kind]}.`
    : `Вставте повністю: ${KIND_NAMES[kind]} (текст починається з ${Object.keys(TEXT_KINDS).find(p => TEXT_KINDS[p] === kind)}).`);
}
