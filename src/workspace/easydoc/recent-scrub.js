// EasyDoc: прибирання списку «recent» зі стану інтерфейсу WordCraft (чиста логіка над вікном iframe).

/**
 * WordCraft пам'ятає імена відкритих файлів («recent») у localStorage свого походження, тобто на
 * диску відкритим текстом. У вікні EasyWAR відкриття іде через оболонку, тож цей список не
 * працює, а імена документів бібліотеки (у ній вони зашифровані) не мають лишатися поза нею.
 * Прибираємо лише поле `recent`; решту стану інтерфейсу редактора не чіпаємо.
 */
export function scrubRecentFiles(frameWindow) {
  try {
    const storage = frameWindow?.localStorage;
    const raw = storage?.getItem('wordcraft.ui');
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || !Array.isArray(state.recent) || !state.recent.length) return false;
    storage.setItem('wordcraft.ui', JSON.stringify({ ...state, recent: [] }));
    return true;
  } catch {
    return false;
  }
}
