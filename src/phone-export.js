// Кнопка «Файл для телефона» на плитках ПВК і УДШВ: зберігає один автономний HTML,
// який відкривається на телефоні або планшеті без інтернету й сервера. Файл не містить
// даних користувача: таблицю .xlsx на телефоні обирають окремо.
import { invoke } from '@tauri-apps/api/core';
import {
  isStandaloneHtml,
  phoneAssetUrl,
  phoneExportDownloadedMessage,
  phoneExportErrorMessage,
  phoneExportSavedMessage,
  phoneFile,
} from './phone-export-core.js';

const inDesktopApp = () => typeof window.__TAURI_INTERNALS__?.invoke === 'function';

// Поза застосунком (браузер, PWA) файл лежить поруч зі сторінкою як звичайний ресурс.
async function downloadFromPage(command) {
  const response = await fetch(phoneAssetUrl(command));
  if (!response.ok) throw new Error('Файл для телефона недоступний у цій збірці.');
  const blob = await response.blob();
  if (!isStandaloneHtml(await blob.slice(0, 512).text())) {
    throw new Error('Файл для телефона недоступний у цій збірці.');
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = phoneFile(command).fileName;
  document.body.append(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
}

async function exportPhoneFile(command) {
  if (!inDesktopApp()) {
    await downloadFromPage(command);
    return phoneExportDownloadedMessage(command);
  }
  const path = await invoke('export_phone_file', { dashboard: command });
  return path ? phoneExportSavedMessage(command, path) : null;
}

function showNote(tile, message) {
  const note = tile.querySelector('[data-role="note"]');
  if (!note) return;
  note.hidden = !message;
  note.textContent = message ? message.text : '';
  note.dataset.kind = message ? message.kind : '';
}

function initializePhoneExport() {
  for (const button of document.querySelectorAll('.command-tile [data-act="phone"]')) {
    button.addEventListener('click', async () => {
      const tile = button.closest('.command-tile');
      button.disabled = true;
      showNote(tile, null);
      try {
        showNote(tile, await exportPhoneFile(tile.dataset.command));
      } catch (error) {
        showNote(tile, phoneExportErrorMessage(error));
      } finally {
        button.disabled = false;
      }
    });
  }
}

initializePhoneExport();
