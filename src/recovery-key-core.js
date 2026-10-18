// Чиста логіка ключа відновлення пароля: розбір введеного ключа, перевірка форми
// відновлення, тексти. Без DOM і без мережі, щоб її можна було перевірити в node --test.
// Ключ створює Rust-ядро (local_profiles.rs); тут лише дзеркало правил його розбору, щоб
// помилку введення було видно до звернення до ядра. Ядро перевіряє ключ ще раз.

/** Алфавіт ключа: цифри й латинські літери без I, L, O та U (ті самі 32 символи, що в ядрі). */
export const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_KEY_SYMBOLS = 25;
export const RECOVERY_KEY_GROUP = 5;
export const RECOVERY_KEY_PLACEHOLDER = 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX';

// Кириличні літери, схожі на латинські (набрані в українській розкладці), як у ядрі.
// Записано кодами символів (А В С Е Н К М О Р Т Х І), щоб їх не сплутати з латинськими.
const LOOKALIKES = new Map([
  ['\u0410', 'A'], ['\u0412', 'B'], ['\u0421', 'C'], ['\u0415', 'E'],
  ['\u041D', 'H'], ['\u041A', 'K'], ['\u041C', 'M'], ['\u041E', '0'],
  ['\u0420', 'P'], ['\u0422', 'T'], ['\u0425', 'X'], ['\u0406', '1'],
]);
const SEPARATORS = /^[\s\u0085\-_\u2010-\u2015\u2212]$/u;

/**
 * Канонічний вигляд введеного ключа (25 символів алфавіту без тире) або null. Пробіли,
 * тире й регістр не важливі; I і L читаються як 1, O — як 0, схожі кириличні літери — як
 * латинські. Збігається з `normalize_recovery_key` у ядрі.
 */
export function normalizeRecoveryKey(input) {
  let symbols = '';
  for (const raw of String(input ?? '')) {
    if (SEPARATORS.test(raw)) continue;
    for (const upper of raw.toUpperCase()) {
      let mapped = LOOKALIKES.get(upper) ?? upper;
      if (mapped === 'I' || mapped === 'L') mapped = '1';
      else if (mapped === 'O') mapped = '0';
      if (mapped.length !== 1 || !RECOVERY_ALPHABET.includes(mapped)) return null;
      symbols += mapped;
      if (symbols.length > RECOVERY_KEY_SYMBOLS) return null;
    }
  }
  return symbols.length === RECOVERY_KEY_SYMBOLS ? symbols : null;
}

/** Ключ у групах по п'ять символів: `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`. Не канонічний вхід повертається як є. */
export function formatRecoveryKey(key) {
  const canonical = normalizeRecoveryKey(key);
  if (!canonical) return String(key ?? '');
  const groups = [];
  for (let index = 0; index < canonical.length; index += RECOVERY_KEY_GROUP) {
    groups.push(canonical.slice(index, index + RECOVERY_KEY_GROUP));
  }
  return groups.join('-');
}

export function recoveryKeyError(input) {
  if (!String(input ?? '').trim()) return 'Введіть ключ відновлення.';
  if (!normalizeRecoveryKey(input)) {
    return `Ключ має 25 символів: латинські літери та цифри, напр. ${RECOVERY_KEY_PLACEHOLDER}.`;
  }
  return null;
}

/**
 * Перевірка форми скидання пароля: ключ, новий пароль, повтор. `passwordError` — та сама
 * перевірка пароля, що на екрані реєстрації (profile-gate-core.js).
 */
export function validateRecoveryForm({ recoveryKey, password, confirm }, passwordError) {
  const errors = {};
  const badKey = recoveryKeyError(recoveryKey);
  if (badKey) errors.recoveryKey = badKey;
  const badPassword = passwordError(password);
  if (badPassword) errors.password = badPassword;
  else if (password !== confirm) errors.confirm = 'Паролі не збігаються.';
  return errors;
}

/** Підпис стану ключа в налаштуваннях профілю. */
export function recoveryStatusText(profile) {
  return profile?.hasRecoveryKey
    ? 'Створено'
    : 'Не створено: забутий пароль відновити не вдасться';
}

/** Що сказати на екрані входу, якщо в профілю немає ключа відновлення. */
export function noRecoveryKeyAdvice(profile) {
  const name = profile?.displayName ? `«${profile.displayName}»` : 'цього профілю';
  return {
    lead: `Для ${name} ключ відновлення не створювали, тому відновити пароль неможливо.`,
    next: 'Можна додати нового користувача з іншим іменем кнопкою «+ Додати користувача». '
      + 'Файли таблиць цього профілю лишаться на диску, їх можна прив’язати до нового профілю.',
  };
}

/** Тексти екрана «Ключ відновлення» (реєстрація, скидання пароля, новий ключ). */
export const KEY_SCREEN_TEXT = Object.freeze({
  title: 'Ключ відновлення',
  lead: 'Якщо ви забудете пароль, відновити доступ можна лише за цим ключем. Його показано один раз і ніде не збережено в застосунку: запишіть ключ на папері й сховайте окремо від комп’ютера.',
  warning: 'Ключ дає право скинути пароль цього профілю, тож зберігайте його так само ретельно, як пароль, і не кладіть поруч із таблицями.',
  confirm: 'Я записав(ла) ключ і зберіг(ла) його в надійному місці',
  copy: 'Копіювати ключ',
  copied: 'Ключ скопійовано. Не залишайте його в буфері обміну довше, ніж потрібно.',
  copyFailed: 'Не вдалося скопіювати: перепишіть ключ вручну.',
});

/** Перекладає відповідь ядра на коротке повідомлення для форми скидання пароля. */
export function recoveryFailureMessage(failure) {
  const text = String(failure?.message || failure);
  if (/неправильний ключ/iu.test(text)) return 'Неправильний ключ відновлення.';
  if (/ключ відновлення не створювали/iu.test(text)) return 'Для цього профілю ключ відновлення не створювали.';
  return `Не вдалося відновити доступ: ${text}`;
}

/** Копіює ключ у буфер обміну. Повертає true, якщо вдалося; ніколи не кидає помилку. */
export async function copyRecoveryKey(key, clipboard = globalThis.navigator?.clipboard) {
  try {
    if (!clipboard?.writeText) return false;
    await clipboard.writeText(String(key));
    return true;
  } catch {
    return false;
  }
}
