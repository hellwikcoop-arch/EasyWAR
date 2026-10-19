// EasyDoc (прототип, розділ «Офіс» модуля «Робоче середовище»): вбудований редактор документів
// (workspace/easydoc/index.html, збірка WordCraft на WASM). Редактор лежить у збірці й працює
// без мережі; документи відкриваються й зберігаються лише через системні вікна EasyWAR.
//
// Оболонка «Робочого середовища» підключає редактор через mountEasydoc(контейнер). Поки оболонки
// немає, тимчасова кнопка «EasyDoc» на головному екрані відкриває його в накладці; її
// прибираємо, коли редактор переїде в оболонку.
import './easydoc-launcher.css';

export const EASYDOC_URL = 'workspace/easydoc/index.html';
export const EASYDOC_TITLE = 'EasyDoc';

/** Вставляє редактор у контейнер. Повертає { destroy }, як mountEasyGreen: destroy вивантажує
 *  сторінку редактора. Ознаки незбережених змін оболонці поки не передаємо. */
export function mountEasydoc(container, { url = EASYDOC_URL } = {}) {
  const frame = document.createElement('iframe');
  frame.className = 'ew-easydoc-frame';
  frame.title = EASYDOC_TITLE;
  frame.src = url;
  container.append(frame);
  return {
    destroy() {
      frame.src = 'about:blank';
      frame.remove();
    },
  };
}

function initializeTemporaryButton() {
  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet';
  openButton.textContent = EASYDOC_TITLE;
  openButton.title = 'Редактор документів (прототип): відкриття й збереження .docx, експорт у PDF';
  toolbar.prepend(openButton);

  const overlay = document.createElement('div');
  overlay.className = 'ew-easydoc-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', EASYDOC_TITLE);
  overlay.innerHTML = `
    <div class="ew-easydoc-bar">
      <span class="ew-easydoc-title">EasyDoc · прототип</span>
      <button type="button" class="ew-easydoc-close" aria-label="Закрити EasyDoc">Закрити</button>
    </div>`;
  document.body.append(overlay);
  const closeButton = overlay.querySelector('.ew-easydoc-close');
  let mounted = null;

  const close = () => {
    if (!window.confirm('Закрити EasyDoc? Незбережені зміни в документі буде втрачено.')) return;
    overlay.hidden = true;
    mounted?.destroy();
    mounted = null;
    openButton.focus();
  };
  openButton.addEventListener('click', () => {
    mounted ??= mountEasydoc(overlay);
    overlay.hidden = false;
    closeButton.focus();
  });
  closeButton.addEventListener('click', close);
}

initializeTemporaryButton();
