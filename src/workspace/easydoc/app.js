// EasyDoc (Word) у розділі «Офіс» «Робочого середовища»: контракт підключення — docs/WORKSPACE.md.
// Редактор — веб-збірка WordCraft (src/public/workspace/easydoc/), вкладена iframe-ом; працює
// без мережі. Відкриття й збереження документів іде лише через host оболонки (вікна EasyWAR).
import { createEasydocBridge } from './easydoc-bridge-core.js';

export const contract = 1;

export async function mount(container, host) {
  const bridge = createEasydocBridge(host);
  // Сторінка редактора (того самого походження) бере місток із батьківського вікна.
  window.__easydocHost = bridge;
  host.setTitle('');

  const frame = document.createElement('iframe');
  frame.title = 'EasyDoc';
  frame.src = host.resolve('workspace/easydoc/index.html');
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  container.append(frame);

  return {
    unmount() {
      frame.src = 'about:blank';
      frame.remove();
      bridge.dispose();
      delete window.__easydocHost;
    },
    isDirty: () => bridge.isDirty(),
  };
}
