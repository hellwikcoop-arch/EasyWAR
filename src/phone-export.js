// Кнопка «Файл для телефона» на плитках ПВК і УДШВ: зберігає один автономний HTML,
// який відкривається на телефоні або планшеті без інтернету й сервера. За замовчуванням
// даних користувача у файлі немає: таблицю .xlsx на телефоні обирають окремо. Лише з
// увімкненою позначкою «Вбудувати таблицю у файл» застосунок кладе у файл копію таблиці,
// прив'язаної до плитки (див. export_phone_file у src-tauri/src/lib.rs).
import { invoke } from '@tauri-apps/api/core';
import {
  EMBED_TABLE_WARNING,
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

async function exportPhoneFile(command, withTable) {
  if (!inDesktopApp()) {
    await downloadFromPage(command);
    return phoneExportDownloadedMessage(command);
  }
  const saved = await invoke('export_phone_file', { dashboard: command, withTable });
  return saved ? phoneExportSavedMessage(command, saved.path, saved.table) : null;
}

function showNote(tile, message) {
  const note = tile.querySelector('[data-role="note"]');
  if (!note) return;
  note.hidden = !message;
  note.textContent = message ? message.text : '';
  note.dataset.kind = message ? message.kind : '';
}

function initializePhoneExport() {
  for (const embed of document.querySelectorAll('.command-tile [data-role="embed"]')) {
    embed.addEventListener('change', () => {
      showNote(embed.closest('.command-tile'), embed.checked ? { kind: 'info', text: EMBED_TABLE_WARNING } : null);
    });
  }
  for (const button of document.querySelectorAll('.command-tile [data-act="phone"]')) {
    button.addEventListener('click', async () => {
      const tile = button.closest('.command-tile');
      button.disabled = true;
      showNote(tile, null);
      const embed = tile.querySelector('[data-role="embed"]');
      const withTable = Boolean(embed && embed.checked && !embed.disabled);
      try {
        showNote(tile, await exportPhoneFile(tile.dataset.command, withTable));
      } catch (error) {
        showNote(tile, phoneExportErrorMessage(error));
      } finally {
        button.disabled = false;
      }
    });
  }
}

initializePhoneExport();
