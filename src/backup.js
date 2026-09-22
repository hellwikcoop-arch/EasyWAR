import { invoke } from '@tauri-apps/api/core';
import './backup.css';

function initializeBackup() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;

  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet';
  openButton.textContent = 'Резервна копія';
  toolbar.prepend(openButton);

  const dialog = document.createElement('dialog');
  dialog.className = 'ew-backup-dialog';
  dialog.setAttribute('aria-labelledby', 'ew-backup-title');
  dialog.innerHTML = `
    <div class="ew-backup-head">
      <h2 id="ew-backup-title">Резервна копія EasyWAR</h2>
      <button type="button" class="btn quiet" id="ew-backup-close" aria-label="Закрити">Закрити</button>
    </div>
    <p>Створіть окремий знімок локальної бази даних. Поточна база залишиться без змін.</p>
    <p class="ew-backup-warning">Копія може містити чутливі дані. Оберіть захищене місце зберігання; хмарні папки використовуйте лише свідомо. Наявний файл не буде перезаписано.</p>
    <p id="ew-backup-status" class="ew-backup-status" role="status" aria-live="polite"></p>
    <p id="ew-backup-location" class="ew-backup-location" hidden></p>
    <div class="ew-backup-actions">
      <button type="button" class="btn" id="ew-backup-cancel">Скасувати</button>
      <button type="button" class="btn" id="ew-backup-inspect">Перевірити копію</button>
      <button type="button" class="btn primary" id="ew-backup-create">Обрати місце й створити</button>
    </div>`;
  document.body.append(dialog);

  const status = dialog.querySelector('#ew-backup-status');
  const location = dialog.querySelector('#ew-backup-location');
  const createButton = dialog.querySelector('#ew-backup-create');
  const inspectButton = dialog.querySelector('#ew-backup-inspect');

  function close() {
    dialog.close();
    openButton.focus();
  }

  openButton.addEventListener('click', () => {
    status.textContent = '';
    location.textContent = '';
    location.hidden = true;
    createButton.disabled = false;
    inspectButton.disabled = false;
    dialog.showModal();
  });
  dialog.querySelector('#ew-backup-close').addEventListener('click', close);
  dialog.querySelector('#ew-backup-cancel').addEventListener('click', close);
  inspectButton.addEventListener('click', async () => {
    createButton.disabled = true;
    inspectButton.disabled = true;
    status.textContent = 'Оберіть копію для перевірки…';
    location.hidden = true;
    location.textContent = '';
    try {
      const inspection = await invoke('inspect_local_backup');
      status.textContent = inspection === null
        ? 'Перевірку скасовано.'
        : `Копія EasyWAR сумісна. Версія схеми: ${inspection.schema_version}. Відновлення даних не виконувалося.`;
    } catch (error) {
      status.textContent = `Копія не пройшла перевірку: ${String(error)}`;
    } finally {
      createButton.disabled = false;
      inspectButton.disabled = false;
    }
  });
  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    inspectButton.disabled = true;
    status.textContent = 'Оберіть місце для резервної копії…';
    try {
      const path = await invoke('create_local_backup');
      if (path === null) {
        status.textContent = 'Створення копії скасовано.';
      } else {
        status.textContent = 'Резервну копію створено й перевірено.';
        location.textContent = path;
        location.hidden = false;
      }
    } catch (error) {
      status.textContent = `Не вдалося створити копію: ${String(error)}`;
    } finally {
      createButton.disabled = false;
      inspectButton.disabled = false;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeBackup, { once: true });
} else {
  initializeBackup();
}
