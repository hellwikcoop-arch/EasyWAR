// EasySlide у «Робочому середовищі» → «Офіс» (контракт docs/WORKSPACE.md): редактор презентацій на
// веб-збірці DeckCraft. WASM лежить у збірці (public/workspace/easyslide/), мережа не потрібна.
import { createEasySlideHost } from './host-core.js';
import './easyslide.css';

export const contract = 1;

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

export async function mount(container, host) {
  container.classList.add('es-root');
  // Ідентифікатори задає веб-збірка DeckCraft (apps/deckcraft-web/src/web.rs).
  const canvas = el('canvas', { id: 'deckcraft_canvas' });
  const loading = el('div', { id: 'deckcraft_loading', className: 'es-loading', textContent: 'Завантаження EasySlide…' });
  const status = el('div', { className: 'es-status', hidden: true });
  status.setAttribute('role', 'status');
  container.replaceChildren(canvas, loading, status);

  let hideTimer = 0;
  const notify = (text) => {
    status.textContent = text;
    status.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { status.hidden = true; }, 6000);
  };

  const bridge = createEasySlideHost(host, notify);
  window.easyslideHost = bridge;
  host.setTitle?.('Нова презентація');

  try {
    const editor = await import(/* @vite-ignore */ host.resolve('workspace/easyslide/deckcraft-web.js'));
    await editor.default({ module_or_path: host.resolve('workspace/easyslide/deckcraft-web_bg.wasm') });
  } catch (error) {
    loading.textContent = `EasySlide не запустився: ${error?.message || error}. Потрібна підтримка WebGPU або WebGL2.`;
  }

  return {
    unmount() {
      clearTimeout(hideTimer);
      bridge.close();
      if (window.easyslideHost === bridge) delete window.easyslideHost;
      container.replaceChildren();
    },
    isDirty: () => bridge.isDirty(),
  };
}
