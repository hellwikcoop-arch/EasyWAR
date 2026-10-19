// EasyGreen — електронні таблиці модуля «Робоче середовище» (розділ «Офіс»), прототип.
// Таблиця — веб-збірка GridCraft у src/public/workspace/easygreen/app/, працює без мережі в iframe того
// самого походження. Файли з диска таблиця сама не читає: користувач обирає файл кнопкою «Відкрити файл…»
// (або «Файл → Відкрити» в самій таблиці), а все, що таблиця зберігає, іде в команду save_easygreen_file:
// вона питає місце збереження й не перезаписує таблиці профілів (сире джерело не змінюється).
//
// Підключення в оболонку: mountEasyGreen(container, { appUrl }) → { destroy(), isDirty() }.
// appUrl — шлях до src/public/workspace/easygreen/app/index.html відносно сторінки, що монтує панель.
import './easygreen.css';
import {
  EASYGREEN_APP_QUERY, EASYGREEN_TITLE, OPEN_ACCEPT, closeNeedsConfirm, openMessage, openProblem, parseFrameMessage, saveStatus,
} from './easygreen-core.js';

export const DEFAULT_APP_URL = 'workspace/easygreen/app/index.html';

function tauriInvoke() {
  for (const scope of [window, window.parent, window.top]) {
    try {
      const invoke = scope?.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke === 'function') return invoke;
    } catch { /* інше походження — пропускаємо */ }
  }
  return null;
}

function downloadInBrowser(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/**
 * Монтує EasyGreen у `container`. Повертає { destroy, isDirty }: destroy() вивантажує таблицю
 * (WebGL-контекст не лишається в пам'яті); isDirty() — чи є незбережені зміни.
 * options.onClose — якщо задано, показує кнопку «Закрити» і викликає її після підтвердження.
 */
export function mountEasyGreen(container, options = {}) {
  const appUrl = `${options.appUrl || DEFAULT_APP_URL}${EASYGREEN_APP_QUERY}`;
  const root = document.createElement('section');
  root.className = 'ew-easygreen';
  root.setAttribute('aria-label', EASYGREEN_TITLE);
  root.innerHTML = `
    <div class="ew-easygreen-bar">
      <span class="ew-easygreen-title">${EASYGREEN_TITLE}</span>
      <span class="ew-easygreen-badge">прототип</span>
      <button type="button" class="ew-easygreen-btn" data-act="open" disabled>Відкрити файл…</button>
      <span class="ew-easygreen-status" role="status" aria-live="polite">Завантаження таблиці…</span>
      <button type="button" class="ew-easygreen-btn" data-act="close" hidden>Закрити</button>
    </div>
    <iframe class="ew-easygreen-frame" title="${EASYGREEN_TITLE}"></iframe>
    <input type="file" class="ew-easygreen-file" accept="${OPEN_ACCEPT}" hidden>`;
  container.append(root);

  const frame = root.querySelector('iframe');
  const fileInput = root.querySelector('.ew-easygreen-file');
  const openFileButton = root.querySelector('[data-act="open"]');
  const closeButton = root.querySelector('[data-act="close"]');
  const status = root.querySelector('.ew-easygreen-status');
  const setStatus = (text) => { status.textContent = text; };

  let ready = false;
  let dirty = false;
  let destroyed = false;

  const onMessage = async (event) => {
    if (destroyed || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
    const message = parseFrameMessage(event.data);
    if (!message) return;
    if (message.type === 'ready') {
      ready = true;
      openFileButton.disabled = false;
      setStatus('Готово. Відкрийте файл або створіть нову книгу.');
    } else if (message.type === 'dirty') {
      dirty = message.dirty;
    } else if (message.type === 'failed') {
      setStatus(`Таблиця не запустилася: ${message.error || 'потрібна підтримка WebGPU або WebGL2'}`);
    } else if (message.type === 'save') {
      const bytes = new Uint8Array(message.bytes);
      const invoke = tauriInvoke();
      try {
        const result = invoke
          ? await invoke('save_easygreen_file', { fileName: message.name, bytes: Array.from(bytes) })
          : downloadInBrowser(message.name, bytes);
        setStatus(saveStatus(result, null));
      } catch (error) {
        setStatus(saveStatus(null, error));
      }
    }
  };
  window.addEventListener('message', onMessage);

  openFileButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || !ready) return;
    const problem = openProblem(file.name, file.size);
    if (problem) { setStatus(problem); return; }
    try {
      const bytes = await file.arrayBuffer();
      frame.contentWindow?.postMessage(openMessage(file.name, bytes), window.location.origin, [bytes]);
      setStatus(`Відкрито: ${file.name}`);
    } catch (error) {
      setStatus(`Не вдалося прочитати файл: ${error?.message ?? error}`);
    }
  });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('message', onMessage);
    frame.src = 'about:blank';
    root.remove();
  };

  if (typeof options.onClose === 'function') {
    closeButton.hidden = false;
    closeButton.addEventListener('click', () => {
      if (closeNeedsConfirm(dirty) && !window.confirm('У таблиці є незбережені зміни. Закрити EasyGreen без збереження?')) return;
      destroy();
      options.onClose();
    });
  }

  frame.src = appUrl;
  return { destroy, isDirty: () => dirty };
}
