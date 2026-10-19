/* EasyDoc (прототип): місток між вбудованим редактором документів (WordCraft, WASM) і EasyWAR.
   Сторінка відкривається в накладці лаунчера (iframe того самого походження), тож команди Tauri
   беремо з батьківського вікна. Відкриття й збереження йдуть лише через системні вікна EasyWAR
   (команди open_office_document і save_office_document); мережі тут немає. Без Tauri (браузерний
   перегляд) місток не встановлюється, і редактор працює з власним вибором і завантаженням файлів. */
(function (root) {
  'use strict';

  function createEasydocHost(invoke) {
    return {
      async openDocument() {
        const picked = await invoke('open_office_document');
        if (!picked) return null;
        return { name: String(picked.name || 'Документ.docx'), bytes: Uint8Array.from(picked.bytes || []) };
      },
      saveDocument(name, bytes) {
        return invoke('save_office_document', { fileName: String(name || 'Документ.docx'), bytes: Array.from(bytes || []) });
      },
    };
  }

  function findInvoke(win) {
    try {
      const own = win.__TAURI_INTERNALS__ && win.__TAURI_INTERNALS__.invoke;
      if (typeof own === 'function') return own;
      const parentInvoke = win.parent && win.parent !== win && win.parent.__TAURI_INTERNALS__ && win.parent.__TAURI_INTERNALS__.invoke;
      return typeof parentInvoke === 'function' ? parentInvoke : null;
    } catch {
      return null;
    }
  }

  if (typeof module === 'object' && module.exports) module.exports = { createEasydocHost, findInvoke };
  if (root && typeof root === 'object' && root.document) {
    const invoke = findInvoke(root);
    if (invoke) root.__easydocHost = createEasydocHost(invoke);
  }
})(typeof window !== 'undefined' ? window : undefined);
