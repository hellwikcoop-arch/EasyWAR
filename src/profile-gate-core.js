// Чиста логіка реєстрації й входу після заставки: перевірка форм, перелік модулів,
// слоти таблиць для обраних модулів, затримка після невдалих спроб. Без DOM, щоб її
// можна було перевірити в node --test. Інтерфейс — у profile-gate.js.
import { PROFILE_SLOTS } from './local-profiles-core.js';

// Межі збігаються з Rust-ядром (local_profiles.rs); ядро перевіряє їх ще раз.
export const NAME_MAX = 80;
export const POSITION_MAX = 120;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

/**
 * Модулі, які користувач обирає при реєстрації. `slots` — слоти таблиць профілю, які
 * можна прив'язати (див. PROFILE_SLOTS). Артилерія працює зі спільною таблицею бригад
 * і власного слота в профілі не має. `card` і `tile` — елементи стартового екрана.
 */
export const GATE_MODULES = Object.freeze([
  Object.freeze({
    id: 'air',
    title: 'Повітряні Сили',
    hint: 'База даних доповідей, карта, довідник, презентації',
    slots: Object.freeze(['air']),
    card: '.branch-card[data-branch="air"]',
  }),
  Object.freeze({
    id: 'rocket',
    title: 'Ракетні Війська',
    hint: 'РСЗВ і ОТРК: доповіді, карта, довідник машин',
    slots: Object.freeze(['rocket']),
    card: '.branch-card[data-branch="rocket"]',
  }),
  Object.freeze({
    id: 'artillery',
    title: 'Артилерія',
    hint: 'Витрата й залишок боєприпасів бригад у спільній таблиці',
    slots: Object.freeze([]),
    card: '.branch-card[data-branch="artillery"]',
  }),
  Object.freeze({
    id: 'pvk',
    title: 'Повітряне командування',
    hint: 'Дашборд ПВК і вкладка «Наші втрати»',
    slots: Object.freeze(['pvk', 'pvk_losses']),
    card: '.branch-card[aria-controls="pvk-tile"]',
    tile: '#pvk-tile',
  }),
  Object.freeze({
    id: 'dshv',
    title: 'Командування ДШВ',
    hint: 'Дашборд УДШВ і вкладка «Наші втрати»',
    slots: Object.freeze(['dshv', 'dshv_losses']),
    card: '.branch-card[aria-controls="dshv-tile"]',
    tile: '#dshv-tile',
  }),
]);

export const MODULE_IDS = Object.freeze(GATE_MODULES.map(module => module.id));

const codePoints = value => [...String(value ?? '')].length;
const squash = value => String(value ?? '').split(/\s+/).filter(Boolean).join(' ');

/** Ключ для порівняння назв: без зайвих пробілів і без урахування регістру (як у ядрі). */
export function nameKey(name) {
  return squash(name).toLowerCase();
}

export function passwordError(password) {
  const length = codePoints(password);
  if (length < PASSWORD_MIN) return `Пароль має містити щонайменше ${PASSWORD_MIN} символів.`;
  if (length > PASSWORD_MAX) return `Пароль має містити не більше ${PASSWORD_MAX} символів.`;
  return null;
}

/**
 * Перший крок реєстрації: ім'я, посада, пароль. Повертає об'єкт помилок за полями;
 * порожній об'єкт означає, що крок можна завершувати. `existingNames` — назви профілів,
 * що вже є на цьому пристрої.
 */
export function validateProfileStep({ displayName, position, password, confirm }, existingNames = []) {
  const errors = {};
  const name = squash(displayName);
  if (!name) errors.displayName = 'Вкажіть ім’я або позивний.';
  else if (codePoints(name) > NAME_MAX) errors.displayName = `Ім’я має містити не більше ${NAME_MAX} символів.`;
  else if (existingNames.some(existing => nameKey(existing) === nameKey(name))) {
    errors.displayName = 'Користувач із таким іменем уже є на цьому пристрої.';
  }
  if (codePoints(squash(position)) > POSITION_MAX) errors.position = `Посада має містити не більше ${POSITION_MAX} символів.`;
  const badPassword = passwordError(password);
  if (badPassword) errors.password = badPassword;
  else if (password !== confirm) errors.confirm = 'Паролі не збігаються.';
  return errors;
}

/**
 * «Забули пароль?» на екрані входу: код відновлення (непорожній; формат і контрольну суму
 * перевіряє ядро) і новий пароль двічі. Повертає об'єкт помилок за полями code/password/confirm.
 */
export function validateRecoveryStep({ code, password, confirm }) {
  const errors = {};
  if (!String(code ?? '').trim()) errors.code = 'Введіть код відновлення.';
  const badPassword = passwordError(password);
  if (badPassword) errors.password = badPassword;
  else if (password !== confirm) errors.confirm = 'Паролі не збігаються.';
  return errors;
}

/** Відмова ядра у відновленні кодом → текст під формою. */
export function recoveryFailure(text) {
  const raw = String(text ?? '').trim();
  if (/у профілю немає захищеної бібліотеки/i.test(raw)) {
    return 'У цього профілю немає бібліотеки «Робочого середовища», тож і коду відновлення немає: пароль не відновити.';
  }
  return `Не вдалося відновити доступ: ${raw}`;
}

/** Другий крок: щонайменше один відомий модуль. */
export function modulesError(modules) {
  const chosen = normalizeModules(modules);
  return chosen.length ? null : 'Оберіть щонайменше один модуль.';
}

/** Відомі модулі без дублікатів у порядку стартового екрана. */
export function normalizeModules(modules) {
  const wanted = new Set(modules || []);
  return MODULE_IDS.filter(id => wanted.has(id));
}

/** Слоти таблиць, які має сенс запропонувати для обраних модулів, у порядку модулів. */
export function slotsForModules(modules, slots = PROFILE_SLOTS) {
  const chosen = new Set(normalizeModules(modules));
  const wanted = GATE_MODULES.filter(module => chosen.has(module.id)).flatMap(module => module.slots);
  return wanted.map(branch => slots.find(slot => slot.branch === branch)).filter(Boolean);
}

/** Чи показувати картку модуля профілю. Профіль без списку (старий стан) бачить усе. */
export function moduleVisible(moduleId, profile) {
  if (!Array.isArray(profile?.modules) || profile.modules.length === 0) return true;
  return profile.modules.includes(moduleId);
}

/**
 * Затримка перед наступною спробою пароля (мс) після `failures` невдалих спроб поспіль.
 * Це зручність інтерфейсу, а не межа безпеки: пароль перевіряє ядро (Argon2id).
 */
export function failureDelayMs(failures) {
  if (!Number.isFinite(failures) || failures < 5) return 0;
  return Math.min(60_000, 5_000 * 2 ** (failures - 5));
}

/**
 * Розбір відмови входу від ядра. Ядро саме рахує невдалі спроби й призупиняє вхід
 * («забагато невдалих спроб входу, спробуйте знову через 30 с»): таку відповідь
 * показуємо як є й не додаємо до лічильника інтерфейсу.
 */
export function loginFailure(text) {
  const raw = String(text ?? '').trim();
  if (/неправильний пароль/i.test(raw)) return { message: 'Неправильний пароль.', throttled: false };
  if (/забагато невдалих спроб входу/i.test(raw)) {
    const message = raw.charAt(0).toUpperCase() + raw.slice(1);
    return { message: /[.!?]$/.test(message) ? message : `${message}.`, throttled: true };
  }
  return { message: `Не вдалося увійти: ${raw}`, throttled: false };
}

/**
 * Стан сторінки входу після відмови ядра: лічильник невдач, час, до якого кнопка
 * заблокована, і текст помилки. Пауза, оголошена ядром, лічильник сторінки не збільшує.
 */
export function registerLoginFailure({ failures, blockedUntil }, text, now) {
  const { message, throttled } = loginFailure(text);
  if (throttled) return { failures, blockedUntil, message };
  const next = failures + 1;
  return { failures: next, blockedUntil: now + failureDelayMs(next), message };
}

/** Який екран показати після заставки: реєстрація, якщо профілів ще немає, інакше вхід. */
export function gateScreen(state) {
  return Array.isArray(state?.profiles) && state.profiles.length > 0 ? 'login' : 'register';
}

/** Підпис профілю на картці входу. */
export function loginCardNote(profile) {
  return profile?.hasPassword ? 'Захищено паролем' : 'Потрібно встановити пароль';
}
