/* Кнопка «Презентація» модулів ПС (air.html) і РВіА (rocket.html): читає відкриту таблицю модуля,
   розбирає її ядром strikes-core.js і відкриває вікно створення презентації (presentation-ui.js).
   Сторінка модуля викликає window.EWGroupPresentation.open({ group, bytes, name, readSheets, toast }).
   Код презентації (pptxgenjs, pdf-lib, шрифти, емблеми) підвантажується лише після натискання кнопки. */
import { parseStrikes } from './strikes-core.js';

// Автономний файл ПВК для телефона (script/build_standalone.mjs) не має кнопки презентації, тож код
// презентації в нього не вбудовується: збірка підставляє true, і гілка з import() відкидається.
const withoutDialog = typeof __EW_NO_MODULE_PRESENTATION__ !== 'undefined' && __EW_NO_MODULE_PRESENTATION__;
const loadDialog = withoutDialog ? null : () => import('./presentation-ui.js');

const REJECTED = new Set(['NOT_STRIKES', 'AMBIGUOUS_HEADER']);

/** group: 'ps' | 'rvia'. Помилки показуються через toast модуля, а не кидаються на сторінку. */
export async function openModulePresentation({ group, bytes, name = '', readSheets, toast }) {
  const say = message => (typeof toast === 'function' ? toast(message, '') : globalThis.alert?.(message));
  if (!bytes || typeof readSheets !== 'function') return say('Спочатку відкрийте таблицю.');
  if (!loadDialog) return say('У цьому файлі презентація недоступна.');
  try {
    const strikes = parseStrikes(await readSheets(bytes), name);
    if (!strikes.records.length) return say('У таблиці немає жодного запису з розпізнаною датою: презентація була б порожньою.');
    const ui = await loadDialog();
    ui.openModulePresentationDialog(strikes, group, { toast });
  } catch (error) {
    say(error && REJECTED.has(error.code) ? error.message : `Не вдалося підготувати презентацію: ${error && error.message ? error.message : error}`);
  }
  return undefined;
}

if (typeof window !== 'undefined') window.EWGroupPresentation = { open: openModulePresentation };
