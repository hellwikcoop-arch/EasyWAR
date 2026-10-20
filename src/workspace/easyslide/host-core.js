// EasySlide: міст між редактором презентацій (веб-збірка DeckCraft у public/workspace/easyslide/)
// і оболонкою «Робоче середовище». Редактор шукає window.easyslideHost і через нього відкриває та
// зберігає файли (host.openFile / host.saveFile / host.saveFileAs оболонки: у Tauri — системні вікна
// й команди office_*, у браузері — вибір файлу й завантаження) і повідомляє про незбережені зміни й
// назву. Шляхів редактор не бачить; нічого не надсилається з пристрою.

export const PRESENTATION_EXTENSIONS = Object.freeze(['pptx', 'ppsx', 'potx', 'deckcraft']);
export const PICTURE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff']);

/** Формати, які редактор зберігає або експортує: розширення → підпис фільтра вікна. */
export const SAVE_FORMATS = Object.freeze({
  pptx: 'Презентація PowerPoint',
  deckcraft: 'Файл EasySlide',
  pdf: 'Документ PDF',
  png: 'Зображення PNG',
  jpg: 'Зображення JPEG',
  gif: 'Анімація GIF',
  txt: 'Текст структури',
});

/** Розширення з назви файлу (нижній регістр, без крапки) або ''. */
export function extensionOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

/** Параметри вікна відкриття для призначення, яке передає редактор. */
export function openOptions(purpose) {
  return purpose === 'picture'
    ? { extensions: [...PICTURE_EXTENSIONS], filterName: 'Зображення', title: 'Вставити зображення' }
    : { extensions: [...PRESENTATION_EXTENSIONS], filterName: 'Презентація', title: 'Відкрити презентацію' };
}

/** Параметри «Зберегти як…» для назви, яку пропонує редактор; null — формат не зберігається. */
export function saveOptions(name) {
  const extension = extensionOf(name) === 'jpeg' ? 'jpg' : extensionOf(name);
  if (!SAVE_FORMATS[extension]) return null;
  return { suggestedName: String(name), extensions: [extension], filterName: SAVE_FORMATS[extension], title: 'Зберегти з EasySlide' };
}

// Та сама назва без різниці регістру (редактор може змінити регістр розширення).
const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * Створює window.easyslideHost над host оболонки. notify(text) показує людині підсумок.
 * Збереження .pptx під назвою відкритого файлу записує в той самий файл (host.saveFile: для
 * документа з бібліотеки — нова версія в бібліотеці, для файлу з диска — перезапис); інша назва
 * чи інший формат відкриває системне вікно «Зберегти як…».
 * save повертає true лише для збереженої презентації: тоді редактор знімає позначку змін.
 */
export function createEasySlideHost(host, notify = () => {}) {
  let handle = null;
  let openName = '';
  let dirty = false;
  const closePrevious = (next, nextName = '') => {
    if (handle && handle !== next) Promise.resolve(host.closeFile?.(handle)).catch(() => {});
    handle = next;
    openName = next ? String(nextName ?? '') : '';
  };
  return {
    isDirty: () => dirty,
    async open(purpose) {
      try {
        const opened = await host.openFile(openOptions(purpose));
        if (!opened) return null;
        if (purpose !== 'picture') closePrevious(opened.handle, opened.name);
        return { name: String(opened.name || 'презентація'), bytes: opened.bytes };
      } catch (error) {
        notify(`Не вдалося відкрити файл: ${error?.message || error}`);
        return null;
      }
    },
    async save(name, bytes) {
      const options = saveOptions(name);
      if (!options) {
        notify(`EasySlide не зберігає файли такого типу: ${name}`);
        return false;
      }
      const extension = options.extensions[0];
      const sameFile = Boolean(handle) && extension === 'pptx' && sameName(name, openName) && typeof host.saveFile === 'function';
      try {
        const saved = sameFile ? await host.saveFile({ handle, bytes }) : await host.saveFileAs({ bytes, ...options });
        if (!saved) return false;
        notify(`Збережено: ${saved.name || name}`);
        const presentation = extension === 'pptx' || extension === 'deckcraft';
        if (sameFile) closePrevious(saved.handle || handle, openName);
        else if (presentation) closePrevious(saved.handle, saved.name);
        else Promise.resolve(host.closeFile?.(saved.handle)).catch(() => {});
        return presentation;
      } catch (error) {
        notify(`Не вдалося зберегти: ${error?.message || error}`);
        return false;
      }
    },
    setState(isDirty, title) {
      dirty = Boolean(isDirty);
      host.setDirty?.(dirty);
      if (title) host.setTitle?.(String(title));
    },
    close() {
      closePrevious(null);
    },
  };
}
