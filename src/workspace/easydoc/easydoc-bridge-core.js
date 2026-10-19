// EasyDoc: місток між редактором WordCraft (WASM у вкладеному iframe) і об'єктом host оболонки
// «Робочого середовища». Редактор бачить лише openDocument / saveDocument / setDirty; номери
// файлів (handle) і шляхи лишаються в оболонці та Rust. Чиста логіка без DOM.

/** Формати, які EasyDoc відкриває (оболонка приймає до 8 розширень). */
export const OPEN_EXTENSIONS = Object.freeze(['docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'html', 'dotx']);
/** Формати, після збереження в які документ лишається відкритим у цьому файлі; решта — експорт. */
export const DOCUMENT_EXTENSIONS = Object.freeze(['docx', 'docm', 'dotx', 'dotm', 'doc', 'odt', 'rtf']);

/** Розширення імені файлу малими літерами або ''. */
export function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(String(name ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

/** Створює місток над host оболонки. */
export function createEasydocBridge(host) {
  const state = { handle: null, name: '', dirty: false };

  async function forget(handle) {
    if (!handle) return;
    try { await host.closeFile(handle); } catch { /* номер уже недійсний — не критично */ }
  }

  async function adopt(handle, name) {
    if (state.handle && state.handle !== handle) await forget(state.handle);
    state.handle = handle;
    state.name = name;
    host.setTitle(name);
  }

  return {
    async openDocument() {
      const opened = await host.openFile({ extensions: [...OPEN_EXTENSIONS] });
      if (!opened) return null;
      await adopt(opened.handle, opened.name);
      return { name: opened.name, bytes: opened.bytes };
    },

    /** Зберігає байти з іменем, яке запропонував редактор. Повертає назву файлу або null (скасовано). */
    async saveDocument(name, bytes) {
      const extension = extensionOf(name) || 'docx';
      const sameFile = state.handle && name === state.name;
      const saved = sameFile
        ? await host.saveFile({ handle: state.handle, bytes })
        : await host.saveFileAs({ bytes, suggestedName: name, extensions: [extension] });
      if (!saved) return null;
      if (DOCUMENT_EXTENSIONS.includes(extension)) await adopt(saved.handle, saved.name);
      else if (saved.handle !== state.handle) await forget(saved.handle);
      return saved.name;
    },

    setDirty(dirty) {
      state.dirty = Boolean(dirty);
      host.setDirty(state.dirty);
    },

    isDirty: () => state.dirty,

    async dispose() {
      await forget(state.handle);
      state.handle = null;
    },
  };
}
