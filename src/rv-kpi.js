// Перехідник між src/rocket.html (класичний inline-скрипт, що не імпортує модулі) і спільним ядром
// чисел карток РВ src/module-adapters/rv-kpi-core.js. Сторінка бере ядро як `window.RVKpiCore`;
// коли модуль завантажився після відкриття таблиці, він подає подію `rvkpi:ready`, і сторінка домальовує дашборд.

import * as core from './module-adapters/rv-kpi-core.js';

if (typeof window !== 'undefined') {
  window.RVKpiCore = Object.freeze({ ...core });
  document.dispatchEvent(new Event('rvkpi:ready'));
}
