import { moduleWindow } from '../air-bridge.js';
import { DRAFT_TARGETS } from './assistant-draft-core.js';

// Єдине місце, де КОМБАТ торкається вкладки «Внесення доповідей». Викликається лише з кнопки підтвердження.
// Він читає стан поля «Повідомлення» і, якщо чернетка дозволена, ставить у нього текст користувача та повідомляє поле
// про введення, щоб модуль сам показав розбір. Кнопок модуля («Додати» тощо) не натискає, таблиці й файли не чіпає.

const frameDocument = branch => {
  if (!Object.prototype.hasOwnProperty.call(DRAFT_TARGETS, branch)) return null;
  try { return moduleWindow(branch)?.document ?? null; } catch { return null; }
};

/** Стан поля для planDraft: лише прапорці й довжина тексту, без читання таблиць. */
export function readDraftField(branch) {
  const doc = frameDocument(branch);
  const field = doc?.querySelector('#paste');
  if (!doc || !field) return { found: false, disabled: true, value: '', autoAdd: false };
  return { found: true, disabled: Boolean(field.disabled), value: String(field.value ?? ''), autoAdd: Boolean(doc.querySelector('#autoToggle')?.checked) };
}

/** Відкриває модуль, його вкладку «Внесення доповідей» і підставляє текст. Повертає true, лише якщо текст опинився в полі. */
export function placeDraft(branch, text) {
  const doc = frameDocument(branch);
  const frame = moduleWindow(branch);
  const field = doc?.querySelector('#paste');
  if (!doc || !frame || !field || field.disabled || field.value.trim()) return false;
  try { window.EW_LAUNCHER?.openBranch(branch); } catch { return false; }
  const view = doc.querySelector('#view-entry');
  if (view?.hidden) doc.querySelector('#tab-entry')?.click();
  field.value = text;
  field.dispatchEvent(new frame.Event('input', { bubbles: true }));
  field.focus();
  return field.value === text;
}
