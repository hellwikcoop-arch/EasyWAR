// «Мій дашборд» — особисте середовище користувача: його власні модулі (dashboard-module-catalog.js)
// на окремій вкладці лівого меню кожного дашборда. Дашборд лише малює вкладку й порожню сторінку з
// позначкою MINE_SLOT; модулі переносить туди сам каталог, тож дашборди не залежать від нього.

export const MINE_VIEW = 'my-dashboard';
export const MINE_LABEL = 'Мій дашборд';
export const MINE_SLOT = 'data-ewmc-slot';

/** Модулі зберігаються в локальній базі застосунку: без Tauri (браузер, лайт-версія) вкладки немає. */
export function hasPersonalDashboard(scope = globalThis) {
  const invoke = scope?.__TAURI_INTERNALS__?.invoke || scope?.parent?.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === 'function';
}

/** Пункт меню для дашборда, у якого вкладки — пари [ключ, назва]. */
export function personalNavItem(scope = globalThis) {
  return hasPersonalDashboard(scope) ? [MINE_VIEW, MINE_LABEL] : null;
}
