import { invoke } from '@tauri-apps/api/core';
import './backup.css';
import {
  applyStagedRestoreAndRestart,
  cancelStagedRestore,
  databaseStatusMessage,
  finalizeLocalRestore,
  getDatabaseStatus,
  getRestoreStartupReport,
  restoreStartupMessage,
  stageLocalRestore,
} from './backup-core.js';

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
    <section class="ew-update-section" aria-labelledby="ew-update-title">
      <h3 id="ew-update-title">Оновлення та міграції</h3>
      <p id="ew-update-status">Перевіряємо локальну схему…</p>
      <p class="ew-backup-warning">Перед встановленням нової версії EasyWAR створіть і перевірте локальну резервну копію.</p>
      <div class="ew-backup-actions">
        <button type="button" class="btn quiet" id="ew-update-refresh">Оновити стан</button>
      </div>
    </section>
    <section class="ew-restore-section" aria-labelledby="ew-restore-title">
      <h3 id="ew-restore-title">Відновлення з копії</h3>
      <p>Копія двічі перевіряється й готується окремо. Поточна база замінюється лише після явного підтвердження та контрольованого перезапуску.</p>
      <div class="ew-backup-actions">
        <button type="button" class="btn" id="ew-restore-select">Обрати й перевірити копію</button>
        <button type="button" class="btn quiet" id="ew-restore-cancel-stage" hidden>Скасувати підготовку</button>
        <button type="button" class="btn primary" id="ew-restore-apply" hidden>Відновити й перезапустити</button>
        <button type="button" class="btn quiet" id="ew-restore-finalize" hidden>Видалити попередню базу</button>
      </div>
    </section>
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
  const restoreSelectButton = dialog.querySelector('#ew-restore-select');
  const restoreCancelButton = dialog.querySelector('#ew-restore-cancel-stage');
  const restoreApplyButton = dialog.querySelector('#ew-restore-apply');
  const restoreFinalizeButton = dialog.querySelector('#ew-restore-finalize');
  const updateStatus = dialog.querySelector('#ew-update-status');
  const updateRefreshButton = dialog.querySelector('#ew-update-refresh');
  let restoreReport = {
    outcome: 'none',
    pendingRestoreAvailable: false,
    previousBackupRetained: false,
  };

  function setBusy(value) {
    createButton.disabled = value;
    inspectButton.disabled = value;
    restoreSelectButton.disabled = value;
    restoreCancelButton.disabled = value;
    restoreApplyButton.disabled = value;
    restoreFinalizeButton.disabled = value;
    updateRefreshButton.disabled = value;
  }

  function renderRestoreState() {
    restoreCancelButton.hidden = !restoreReport.pendingRestoreAvailable;
    restoreApplyButton.hidden = !restoreReport.pendingRestoreAvailable;
    restoreFinalizeButton.hidden = !restoreReport.previousBackupRetained;
  }

  void getRestoreStartupReport().then(report => {
    restoreReport = report;
    renderRestoreState();
  }).catch(() => {});

  async function refreshDatabaseStatus() {
    updateRefreshButton.disabled = true;
    updateStatus.textContent = 'Перевіряємо локальну схему…';
    try {
      updateStatus.textContent = databaseStatusMessage(await getDatabaseStatus());
    } catch (error) {
      updateStatus.textContent = `Не вдалося підтвердити стан міграцій: ${String(error)}`;
    } finally {
      updateRefreshButton.disabled = false;
    }
  }

  void refreshDatabaseStatus();
  updateRefreshButton.addEventListener('click', () => { void refreshDatabaseStatus(); });

  function close() {
    dialog.close();
    openButton.focus();
  }

  openButton.addEventListener('click', () => {
    status.textContent = '';
    location.textContent = '';
    location.hidden = true;
    setBusy(false);
    renderRestoreState();
    const startupMessage = restoreStartupMessage(restoreReport);
    if (startupMessage) status.textContent = startupMessage;
    dialog.showModal();
  });
  dialog.querySelector('#ew-backup-close').addEventListener('click', close);
  dialog.querySelector('#ew-backup-cancel').addEventListener('click', close);
  inspectButton.addEventListener('click', async () => {
    setBusy(true);
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
      setBusy(false);
    }
  });
  createButton.addEventListener('click', async () => {
    setBusy(true);
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
      setBusy(false);
    }
  });

  restoreSelectButton.addEventListener('click', async () => {
    setBusy(true);
    status.textContent = 'Оберіть резервну копію для перевірки й підготовки…';
    location.hidden = true;
    try {
      const inspection = await stageLocalRestore();
      if (inspection === null) {
        status.textContent = 'Підготовку відновлення скасовано.';
      } else {
        restoreReport = {
          outcome: 'none',
          pendingRestoreAvailable: true,
          previousBackupRetained: false,
        };
        status.textContent = `Копію підготовлено. Версія схеми: ${inspection.schema_version}. Поточна база ще не змінена.`;
      }
    } catch (error) {
      status.textContent = `Не вдалося підготувати відновлення: ${String(error)}`;
    } finally {
      renderRestoreState();
      setBusy(false);
    }
  });

  restoreCancelButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      await cancelStagedRestore();
      restoreReport.pendingRestoreAvailable = false;
      status.textContent = 'Підготовлену копію видалено. Поточна база не змінена.';
    } catch (error) {
      status.textContent = `Не вдалося скасувати підготовку: ${String(error)}`;
    } finally {
      renderRestoreState();
      setBusy(false);
    }
  });

  restoreApplyButton.addEventListener('click', async () => {
    if (!window.confirm('Замінити поточну локальну базу підготовленою копією та перезапустити EasyWAR? Попередню базу буде тимчасово збережено для ручного відновлення.')) return;
    setBusy(true);
    status.textContent = 'Підтвердження збережено. EasyWAR перезапускається для безпечної заміни бази…';
    try {
      await applyStagedRestoreAndRestart();
    } catch (error) {
      status.textContent = `Не вдалося запустити відновлення: ${String(error)}`;
      setBusy(false);
    }
  });

  restoreFinalizeButton.addEventListener('click', async () => {
    if (!window.confirm('Видалити попередню базу після успішного відновлення? Цю резервну можливість відкату буде втрачено.')) return;
    setBusy(true);
    try {
      await finalizeLocalRestore();
      restoreReport.previousBackupRetained = false;
      status.textContent = 'Відновлення завершено. Попередню базу видалено.';
    } catch (error) {
      status.textContent = `Не вдалося завершити відновлення: ${String(error)}`;
    } finally {
      renderRestoreState();
      setBusy(false);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeBackup, { once: true });
} else {
  initializeBackup();
}
