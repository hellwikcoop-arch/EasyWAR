// EasyGreen — електронні таблиці модуля «Робоче середовище» (розділ «Офіс»), прототип.
// Таблиця — веб-збірка GridCraft у src/public/workspace/easygreen/app/, працює без мережі в iframe того
// самого походження. Файли відкриває й зберігає оболонка (host.openFile / saveFile / saveFileAs, docs/WORKSPACE.md):
// шляхи лишаються в Rust, а таблиці профілів і їхні копії *.easywar-prev.xlsx не перезаписуються (сире джерело
// не змінюється). Закриття й питання про незбережені зміни — теж на оболонці.
//
// Документ з бібліотеки EasyWAR (host.pendingFile) відкривається сам після gridcraft:ready; «Зберегти» книги
// пише його нову версію в бібліотеку (office_save_file знає такі номери файлів).
//
// Підключення: src/workspace/easygreen/app.js → mountEasyGreen(container, { host, appUrl }) → { destroy(), isDirty() }.
import './easygreen.css';
import {
  EASYGREEN_APP_QUERY, EASYGREEN_TITLE, keepsWorkbook, openIntoFrame, parseFrameMessage, saveAction, saveStatus, shouldAutoOpen,
} from './easygreen-core.js';

export const DEFAULT_APP_URL = 'workspace/easygreen/app/index.html';

/**
 * Монтує EasyGreen у `container`. options.host — об'єкт host оболонки; options.appUrl — адреса сторінки
 * таблиці. Повертає { destroy, isDirty }: destroy() вивантажує таблицю (WebGL-контекст не лишається
 * в пам'яті); isDirty() — чи є незбережені зміни.
 */
export function mountEasyGreen(container, options = {}) {
  const { host } = options;
  if (!host) throw new Error('EasyGreen відкривається лише з «Робочого середовища».');
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
    </div>
    <iframe class="ew-easygreen-frame" title="${EASYGREEN_TITLE}"></iframe>`;
  container.append(root);

  const frame = root.querySelector('iframe');
  const openFileButton = root.querySelector('[data-act="open"]');
  const status = root.querySelector('.ew-easygreen-status');
  const setStatus = (text) => { status.textContent = text; };

  let ready = false;
  let dirty = false;
  let destroyed = false;
  // Файл, відкритий або збережений через EasyWAR: { handle, name }; «Зберегти» книги йде в нього.
  let current = null;

  const setCurrent = (next) => {
    const previous = current;
    current = next;
    if (previous?.handle && previous.handle !== next?.handle) host.closeFile(previous.handle).catch(() => {});
    host.setTitle(next?.name || '');
  };

  const saveAs = async (action, bytes) => {
    const saved = await host.saveFileAs({ bytes, suggestedName: action.suggestedName, extensions: action.extensions });
    if (saved && keepsWorkbook(saved.name)) setCurrent(saved);
    return saved;
  };

  const save = async (message) => {
    const action = saveAction(message.name, current);
    if (!action) {
      setStatus('Не збережено: EasyGreen зберігає лише .xlsx, .pdf, .csv і .html.');
      return;
    }
    const bytes = new Uint8Array(message.bytes);
    try {
      let saved;
      if (action.kind === 'save') {
        try {
          saved = await host.saveFile({ handle: action.handle, bytes });
        } catch (error) {
          // Наприклад, це таблиця профілю: її не перезаписуємо, пропонуємо зберегти під іншою назвою.
          setStatus(saveStatus(null, error));
          saved = await saveAs({ extensions: ['xlsx'], suggestedName: message.name }, bytes);
        }
      } else {
        saved = await saveAs(action, bytes);
      }
      setStatus(saveStatus(saved?.name ?? null, null));
    } catch (error) {
      setStatus(saveStatus(null, error));
    }
  };

  const onMessage = (event) => {
    if (destroyed || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
    const message = parseFrameMessage(event.data);
    if (!message) return;
    if (message.type === 'ready') {
      const first = !ready;
      ready = true;
      openFileButton.disabled = false;
      setStatus('Готово. Відкрийте файл або створіть нову книгу.');
      // Документ з бібліотеки EasyWAR відкривається сам (office_open_file віддає його без вікна вибору).
      if (first && shouldAutoOpen(host)) openFile(true);
    } else if (message.type === 'dirty') {
      dirty = message.dirty;
      host.setDirty(dirty);
    } else if (message.type === 'failed') {
      setStatus(`Таблиця не запустилася: ${message.error || 'потрібна підтримка WebGPU або WebGL2'}`);
    } else if (message.type === 'save') {
      save(message);
    }
  };
  window.addEventListener('message', onMessage);

  // Відкриття через host.openFile (див. openIntoFrame); fromLibrary — документ з бібліотеки після ready.
  const post = (message, transfer) => {
    if (destroyed || !frame.contentWindow) return false;
    frame.contentWindow.postMessage(message, window.location.origin, transfer);
    return true;
  };
  let opening = false;
  const openFile = async (fromLibrary) => {
    if (!ready || opening) return;
    opening = true;
    try {
      const result = await openIntoFrame(host, post);
      if (destroyed) {
        if (result.status === 'opened') host.closeFile(result.handle).catch(() => {});
        return;
      }
      if (result.status === 'problem') {
        setStatus(result.text);
      } else if (result.status === 'opened') {
        setCurrent({ handle: result.handle, name: result.name });
        setStatus(`${fromLibrary ? 'Відкрито з бібліотеки' : 'Відкрито'}: ${result.name}`);
      }
    } catch (error) {
      setStatus(`Не вдалося відкрити файл: ${error?.message ?? error}`);
    } finally {
      opening = false;
    }
  };
  openFileButton.addEventListener('click', () => openFile(false));

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('message', onMessage);
    if (current?.handle) host.closeFile(current.handle).catch(() => {});
    frame.src = 'about:blank';
    root.remove();
  };

  frame.src = appUrl;
  return { destroy, isDirty: () => dirty };
}
