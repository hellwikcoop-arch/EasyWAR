// Кнопка «Робоче середовище» на головному екрані: відкриває модуль (workspace/index.html) з
// розділом «Офіс» у накладці поверх лаунчера. Акцент — останнього відкритого роду військ. Верхню смугу з «← На стартову» малює сам модуль.
// Усе працює без мережі. Перед закриттям накладка питає модуль (EW_WORKSPACE.requestClose), чи
// немає незбережених змін; закриття вивантажує сторінку разом із застосунком.
import './workspace-launcher.css';

const WORKSPACE_URL = 'workspace/index.html';
// Те саме значення, що CLOSE_MESSAGE у src/workspace/workspace-core.js.
const CLOSE_MESSAGE = 'easywar-workspace-close';
// Ті самі ключі, що BRANCHES у workspace-core.js: модуль бере акцент цього роду військ.
const BRANCHES = ['air', 'rocket', 'artillery', 'pvk', 'dshv'];

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
  const frame = document.createElement('iframe');
  frame.className = 'ew-workspace-frame';
  frame.title = 'Робоче середовище';
  overlay.append(frame);
  document.body.append(overlay);

  // Останній відкритий рід військ (лаунчер ставить body[data-active-branch]); до першого — ПС.
  let lastBranch = 'air';
  const rememberBranch = () => {
    const branch = document.body.dataset.activeBranch;
    if (BRANCHES.includes(branch)) lastBranch = branch;
  };
  rememberBranch();
  new MutationObserver(rememberBranch).observe(document.body, { attributes: true, attributeFilter: ['data-active-branch'] });

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
    frame.src = `${WORKSPACE_URL}?branch=${lastBranch}`;
    overlay.hidden = false;
    frame.focus();
  });
  // «← На стартову» і Esc на головній модуля: модуль просить закрити накладку.
  window.addEventListener('message', (event) => {
    if (overlay.hidden || event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === CLOSE_MESSAGE) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });
}

initializeWorkspaceLauncher();
