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

const withoutRecent = raw => {
  try {
    const state = JSON.parse(raw);
    if (state && typeof state === 'object' && Array.isArray(state.recent) && state.recent.length) return JSON.stringify({ ...state, recent: [] });
  } catch { /* не наш формат — лишаємо як є */ }
  return raw;
};

/**
 * Перехоплює запис стану WordCraft у вікні iframe: імена файлів не потрапляють у сховище ні на
 * мить (інакше старі значення лишалися б у журналі SQLite сховища браузера). Редактор не
 * змінюється: підміняється лише `setItem` у вікні сторінки редактора. true — перехоплення стоїть.
 */
export function guardRecentFiles(frameWindow) {
  try {
    const proto = frameWindow?.Storage?.prototype;
    if (!proto || proto.__ewRecentGuard) return false;
    const original = proto.setItem;
    proto.setItem = function setItem(key, value) {
      return original.call(this, key, key === 'wordcraft.ui' ? withoutRecent(String(value)) : value);
    };
    Object.defineProperty(proto, '__ewRecentGuard', { value: true });
    return true;
  } catch {
    return false;
  }
}
