// Чиста логіка індикатора «Відкриваємо таблицю…» (work-loader.js): затримка показу,
// мінімальний час на екрані, підпис і лічильник часу. Без DOM і сховищ.

export const WORK_LOADER = Object.freeze({
  // Швидке відкриття не блимає індикатором.
  delayMs: 300,
  // Якщо вже показано — не зникає раніше, ніж за цей час.
  minVisibleMs: 450,
  // Сегменти смуги; рухається «хвиля», а не вигаданий відсоток.
  segments: 24,
  tickMs: 100,
});

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Заголовок і рядок деталей. Назва файла лишається текстом, шлях не показується. */
export function loaderText({ table = '', fileName = '' } = {}) {
  const name = clean(fileName).split(/[\\/]/).pop();
  const detail = [clean(table), name].filter(Boolean).join(' · ');
  return { title: 'Відкриваємо таблицю', detail: detail || 'Читаємо файл на цьому пристрої' };
}

/** «0,4 с» до 10 с, далі цілі секунди; від'ємне чи нечислове значення — нуль. */
export function formatElapsed(ms) {
  const value = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (value < 10_000) return `${(Math.floor(value / 100) / 10).toFixed(1).replace('.', ',')} с`;
  return `${Math.floor(value / 1000)} с`;
}

/** Скільки ще тримати індикатор після завершення роботи (0 — сховати одразу). */
export function hideDelay(shownAt, now, minVisibleMs = WORK_LOADER.minVisibleMs) {
  if (shownAt == null) return 0;
  return Math.max(0, minVisibleMs - (now - shownAt));
}
