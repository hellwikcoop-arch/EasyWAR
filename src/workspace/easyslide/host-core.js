// EasySlide (прототип): міст між редактором презентацій (веб-збірка DeckCraft у
// public/vendor/easyslide/) і EasyWAR. Редактор шукає window.easyslideHost і через нього
// відкриває та зберігає файли системними вікнами EasyWAR (команди open_easyslide_file і
// save_easyslide_file). Без Tauri (браузер, vite preview) міст не ставиться, і редактор
// працює зі звичайним вибором файлу й завантаженням. Нічого не надсилається з пристрою.

/** Tauri invoke з цього вікна або з батьківського (сторінка відкрита в кадрі лаунчера). */
export function findInvoke(win) {
  const own = win?.__TAURI_INTERNALS__?.invoke;
  if (typeof own === 'function') return own;
  try {
    const parent = win?.parent && win.parent !== win ? win.parent.__TAURI_INTERNALS__?.invoke : null;
    return typeof parent === 'function' ? parent : null;
  } catch {
    return null; // чужий батьківський кадр
  }
}

/** Відповідь open_easyslide_file → { name, bytes: Uint8Array } або null. */
export function toOpenedFile(result) {
  if (!result || !(Array.isArray(result.bytes) || result.bytes instanceof Uint8Array)) return null;
  return { name: String(result.name || 'презентація'), bytes: Uint8Array.from(result.bytes) };
}

/**
 * Створює об'єкт easyslideHost. notify(text) показує людині підсумок (збережено, помилка).
 * Повертає null, якщо Tauri недоступний.
 */
export function createEasySlideHost(invoke, notify = () => {}) {
  if (typeof invoke !== 'function') return null;
  return {
    async open(purpose) {
      try {
        return toOpenedFile(await invoke('open_easyslide_file', { purpose: String(purpose || 'presentation') }));
      } catch (error) {
        notify(`Не вдалося відкрити файл: ${error}`);
        return null;
      }
    },
    async save(name, bytes) {
      try {
        const path = await invoke('save_easyslide_file', { fileName: String(name), bytes: Array.from(bytes) });
        if (path) notify(`Збережено: ${path}`);
        return path || null;
      } catch (error) {
        notify(`Не вдалося зберегти: ${error}`);
        return null;
      }
    },
  };
}
