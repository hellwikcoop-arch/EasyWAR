// Кнопка «Lite-версія» на головному екрані: зберігає один автономний HTML-файл, який відкривається
// в будь-якому браузері на комп'ютері, планшеті чи телефоні без інтернету й сервера. У файлі ті самі
// модулі, але без довідників із моделями (див. script/build_lite.mjs). Даних користувача в ньому
// немає: у застосунку Rust-команда export_lite_file лише віддає зібраний файл у місце, яке обрав
// користувач; у браузері файл лежить поруч зі сторінкою як звичайний ресурс.
import { invoke } from '@tauri-apps/api/core';
import {
  LITE_ASSET_URL,
  LITE_BUTTON_LABEL,
  LITE_BUTTON_TITLE,
  LITE_FILE_NAME,
  LITE_UNAVAILABLE,
  isLiteHtml,
  liteExportDownloadedMessage,
  liteExportErrorMessage,
  liteExportSavedMessage,
} from './lite-export-core.js';

const inDesktopApp = () => typeof window.__TAURI_INTERNALS__?.invoke === 'function';
const NOTE_HIDE_MS = 25000;

async function downloadFromPage() {
  const response = await fetch(LITE_ASSET_URL);
  if (!response.ok) throw new Error(LITE_UNAVAILABLE);
  const blob = await response.blob();
  if (!isLiteHtml(await blob.slice(0, 512).text())) throw new Error(LITE_UNAVAILABLE);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = LITE_FILE_NAME;
  document.body.append(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
}

// Повертає повідомлення для користувача або null, якщо він закрив вікно збереження.
async function exportLite() {
  if (!inDesktopApp()) {
    await downloadFromPage();
    return liteExportDownloadedMessage();
  }
  const path = await invoke('export_lite_file');
  return path ? liteExportSavedMessage(path) : null;
}

function initializeLiteExport() {
  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn quiet ew-lite-open';
  button.textContent = LITE_BUTTON_LABEL;
  button.title = LITE_BUTTON_TITLE;

  const note = document.createElement('p');
  note.className = 'ew-lite-note';
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  note.hidden = true;

  toolbar.append(button, note);

  let hideTimer = 0;
  const show = (message) => {
    clearTimeout(hideTimer);
    note.hidden = !message;
    note.textContent = message ? message.text : '';
    note.dataset.kind = message ? message.kind : '';
    if (message && message.kind === 'ok') hideTimer = setTimeout(() => { note.hidden = true; }, NOTE_HIDE_MS);
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    show(null);
    try {
      show(await exportLite());
    } catch (error) {
      show(liteExportErrorMessage(error));
    } finally {
      button.disabled = false;
    }
  });
}

initializeLiteExport();
