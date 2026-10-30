// «Власний модуль» (custom.html): сторінка без роду військ. Увесь вміст — «Мій дашборд» і каталог
// модулів, які сюди переносить dashboard-module-catalog.js (гілка `custom`); тут лише тема вікна
// та підказка, коли сторінку відкрито поза застосунком (без Tauri модулів немає).
import { hasPersonalDashboard } from './personal-dashboard.js';

const THEME_KEY = 'aviahub.theme';

function applyTheme() {
  try {
    document.documentElement.dataset.theme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
}

// Лончер перемикає тему, записуючи її в localStorage сторінки й у dataset самого документа.
window.addEventListener('storage', event => { if (event.key === THEME_KEY) applyTheme(); });

const note = document.getElementById('cm-note');
if (note) note.hidden = hasPersonalDashboard();
