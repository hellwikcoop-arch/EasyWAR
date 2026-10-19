// Кнопка «Робоче середовище» на головному екрані: відкриває модуль (workspace/index.html) з
// розділом «Офіс» у накладці поверх лаунчера. Усе працює без мережі. Перед закриттям накладка
// питає модуль (EW_WORKSPACE.requestClose), чи немає незбережених змін; закриття вивантажує
// сторінку разом із застосунком.
import './workspace-launcher.css';

const WORKSPACE_URL = 'workspace/index.html';

function initializeWorkspaceLauncher() {
  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet';
  openButton.textContent = 'Робоче середовище';
  openButton.title = 'Офіс: таблиці EasyGreen, документи EasyDoc, презентації EasySlide';
  toolbar.prepend(openButton);

  const overlay = document.createElement('div');
  overlay.className = 'ew-workspace-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Робоче середовище');
  const bar = document.createElement('div');
  bar.className = 'ew-workspace-bar';
  const title = document.createElement('span');
  title.className = 'ew-workspace-title';
  title.textContent = 'Робоче середовище';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ew-workspace-close';
  closeButton.textContent = 'Закрити';
  closeButton.setAttribute('aria-label', 'Закрити робоче середовище');
  bar.append(title, closeButton);
  const frame = document.createElement('iframe');
  frame.className = 'ew-workspace-frame';
  frame.title = 'Робоче середовище';
  overlay.append(bar, frame);
  document.body.append(overlay);

  const close = async () => {
    let allowed = true;
    try {
      const request = frame.contentWindow?.EW_WORKSPACE?.requestClose;
      if (typeof request === 'function') allowed = await request();
    } catch (error) {
      console.error(error);
    }
    if (!allowed) return;
    overlay.hidden = true;
    frame.src = 'about:blank';
    openButton.focus();
  };
  openButton.addEventListener('click', () => {
    frame.src = WORKSPACE_URL;
    overlay.hidden = false;
    closeButton.focus();
  });
  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });
}

initializeWorkspaceLauncher();
