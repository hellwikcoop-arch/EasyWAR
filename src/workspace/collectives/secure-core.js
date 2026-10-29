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
