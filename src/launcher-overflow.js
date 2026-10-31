// Меню «⋯» на стартовому екрані: збирає Профілі / Резервна копія / Оновлення / Signal,
// щоб права смуга не росла довгим рядком кнопок. Робоче середовище й easyWIKI лишаються
// окремими кнопками (вони працюють і без Tauri). Самі кнопки створюють свої модулі й
// монтуються в `.ew-tools-overflow-mount` через `window.__EW_TOOLS_MOUNT__`.
import './launcher-tools.css';

function initializeLauncherOverflow() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;
  const toolbar = document.querySelector('.appbar-right.ew-start-tools, .ew-start-tools, .appbar-right');
  if (!toolbar || toolbar.querySelector('.ew-tools-overflow')) return;

  const wrap = document.createElement('div');
  wrap.className = 'ew-tools-overflow';

  const details = document.createElement('details');
  details.className = 'ew-tools-overflow-menu';

  const summary = document.createElement('summary');
  summary.className = 'btn quiet ew-tools-overflow-btn';
  summary.setAttribute('aria-label', 'Профілі, резервна копія, оновлення й Signal');
  summary.title = 'Профілі, резервна копія, оновлення й Signal';
  summary.textContent = '⋯';

  const panel = document.createElement('div');
  panel.className = 'ew-tools-overflow-panel';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', 'Налаштування EasyWAR');

  const mount = document.createElement('div');
  mount.className = 'ew-tools-overflow-mount';
  panel.append(mount);
  details.append(summary, panel);
  wrap.append(details);
  toolbar.prepend(wrap);

  window.__EW_TOOLS_MOUNT__ = mount;

  // Закрити меню після кліку по пункту (кнопки лишаються в DOM).
  mount.addEventListener('click', event => {
    if (event.target.closest('button, a, [role="menuitem"]')) details.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && details.open) details.open = false;
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLauncherOverflow, { once: true });
  } else {
    initializeLauncherOverflow();
  }
}
