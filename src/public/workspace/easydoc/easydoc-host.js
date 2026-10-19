/* EasyDoc: сторінка редактора (WordCraft, WASM) бере місток із батьківської сторінки застосунку
   «Робочого середовища» (src/workspace/easydoc/app.js). Через місток іде відкриття й збереження
   документів вікнами EasyWAR і позначка незбережених змін. Відкрита окремо (без оболонки), сторінка
   працює з браузерним вибором і завантаженням файлів. Мережі тут немає. */
(function (root) {
  'use strict';

  function findBridge(win) {
    try {
      const parentWin = win.parent;
      if (!parentWin || parentWin === win) return null;
      const bridge = parentWin.__easydocHost;
      return bridge && typeof bridge.openDocument === 'function' && typeof bridge.saveDocument === 'function' ? bridge : null;
    } catch {
      return null;
    }
  }

  if (typeof module === 'object' && module.exports) module.exports = { findBridge };
  if (root && typeof root === 'object' && root.document) {
    const bridge = findBridge(root);
    if (bridge) root.__easydocHost = bridge;
  }
})(typeof window !== 'undefined' ? window : undefined);
