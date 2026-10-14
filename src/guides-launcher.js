// Кнопка «3D-довідники» на головному екрані: відкриває хаб довідників (guides/index.html) у накладці поверх лаунчера.
// Довідники лежать у збірці й працюють без мережі; нічого нікуди не надсилається. Закриття накладки вивантажує сторінку,
// щоб WebGL-сцена не залишалась у пам'яті.
import './guides-launcher.css';

const HUB_URL = 'guides/index.html';

function initializeGuidesLauncher() {
  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet';
  openButton.textContent = '3D-довідники';
  openButton.title = 'Інтерактивні 3D-довідники техніки: рухомі вузли, ТТХ, уразливі місця';
  toolbar.prepend(openButton);

  const overlay = document.createElement('div');
  overlay.className = 'ew-guides-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '3D-довідники');
  overlay.innerHTML = `
    <div class="ew-guides-bar">
      <span class="ew-guides-title">3D-довідники</span>
      <button type="button" class="ew-guides-close" aria-label="Закрити довідники">Закрити</button>
    </div>
    <iframe class="ew-guides-frame" title="3D-довідники"></iframe>`;
  document.body.append(overlay);
  const frame = overlay.querySelector('iframe');
  const closeButton = overlay.querySelector('.ew-guides-close');

  const close = () => {
    overlay.hidden = true;
    frame.src = 'about:blank';
    openButton.focus();
  };
  openButton.addEventListener('click', () => {
    frame.src = HUB_URL;
    overlay.hidden = false;
    closeButton.focus();
  });
  closeButton.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });
}

initializeGuidesLauncher();
