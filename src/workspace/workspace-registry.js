// Де лежить код застосунків: src/workspace/<id>/app.js. Vite збирає їх через
// import.meta.glob, тож новий застосунок підключається додаванням папки, без змін в оболонці.
// Код кожного застосунку — окремий чанк, який вантажиться лише при відкритті.
import { findEntry } from './workspace-core.js';

const APP_MODULES = import.meta.glob('./*/app.js');

/** Завантажувач модуля застосунку або null, якщо застосунок ще не підключено. */
export function entryLoader(id) {
  return findEntry(APP_MODULES, id);
}

/** Чи підключено застосунок (є <id>/app.js). */
export function isConnected(id) {
  return Boolean(entryLoader(id));
}
