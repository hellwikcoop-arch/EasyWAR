import { invoke } from '@tauri-apps/api/core';
import { appUpdateState } from './app-update-state-core.js';
import './backup.css';
import {
  appUpdateMessage,
  applyStagedRestoreAndRestart,
  autoCheckForAppUpdate,
  cancelStagedRestore,
  checkForAppUpdate,
  databaseStatusMessage,
  finalizeLocalRestore,
  getAppUpdateSettings,
  getDatabaseStatus,
  getRestoreStartupReport,
  installAppUpdate,
  restoreStartupMessage,
  setAppUpdateAutoCheck,
  stageLocalRestore,
} from './backup-core.js';

function initializeBackup() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;

  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet ew-backup-open';
  openButton.textContent = 'Резервна копія';
  toolbar.prepend(openButton);

  const headerUpdate = document.createElement('button');
  headerUpdate.type = 'button';
  headerUpdate.className = 'btn quiet ew-header-update';
  headerUpdate.title = 'Оновлення та міграції EasyWAR';
  headerUpdate.textContent = 'Оновлення';
  openButton.after(headerUpdate);

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
      <p id="ew-app-update-status" role="status" aria-live="polite"></p>
      <p class="ew-backup-warning">Під час оновлення кнопкою нижче копія бази створюється автоматично поруч із базою, у папці «backups». Якщо встановлюєте нову версію вручну, спершу створіть і перевірте резервну копію.</p>
      <div class="ew-backup-actions">
        <button type="button" class="btn quiet" id="ew-update-refresh">Оновити стан</button>
        <button type="button" class="btn" id="ew-app-update-check">Перевірити оновлення</button>
        <button type="button" class="btn primary" id="ew-app-update-install" hidden>Встановити й перезапустити</button>
      </div>
      <label class="ew-auto-update">
        <input type="checkbox" id="ew-app-update-auto">
        <span>Перевіряти оновлення автоматично
          <small>Раз на добу під час запуску EasyWAR звертається лише до сторінки випусків EasyWAR на GitHub. Встановлення — тільки після вашого підтвердження.</small>
        </span>
      </label>
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

  // Блок оновлень живе на головній сторінці: випадна панель під кнопкою статусу в шапці.
  const updatePanel = document.createElement('div');
  updatePanel.className = 'ew-update-panel';
  updatePanel.hidden = true;
  updatePanel.append(dialog.querySelector('.ew-update-section'));
  document.body.append(updatePanel);

  function placeUpdatePanel() {
    const r = headerUpdate.getBoundingClientRect();
    updatePanel.style.top = `${Math.round(r.bottom + 6)}px`;
    updatePanel.style.right = `${Math.max(12, Math.round(window.innerWidth - r.right))}px`;
  }
  function toggleUpdatePanel(show = updatePanel.hidden) {
    updatePanel.hidden = !show;
    headerUpdate.setAttribute('aria-expanded', String(show));
    if (show) placeUpdatePanel();
  }
  headerUpdate.setAttribute('aria-haspopup', 'true');
  headerUpdate.setAttribute('aria-expanded', 'false');
  headerUpdate.addEventListener('click', () => { toggleUpdatePanel(); });
  document.addEventListener('click', event => {
    if (!updatePanel.hidden && !updatePanel.contains(event.target) && !headerUpdate.contains(event.target)) toggleUpdatePanel(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !updatePanel.hidden) { toggleUpdatePanel(false); headerUpdate.focus(); }
  });
  window.addEventListener('resize', () => { if (!updatePanel.hidden) placeUpdatePanel(); });

  const status = dialog.querySelector('#ew-backup-status');
  const location = dialog.querySelector('#ew-backup-location');
  const createButton = dialog.querySelector('#ew-backup-create');
  const inspectButton = dialog.querySelector('#ew-backup-inspect');
  const restoreSelectButton = dialog.querySelector('#ew-restore-select');
  const restoreCancelButton = dialog.querySelector('#ew-restore-cancel-stage');
  const restoreApplyButton = dialog.querySelector('#ew-restore-apply');
  const restoreFinalizeButton = dialog.querySelector('#ew-restore-finalize');
  const updateStatus = updatePanel.querySelector('#ew-update-status');
  const updateRefreshButton = updatePanel.querySelector('#ew-update-refresh');
  const appUpdateStatus = updatePanel.querySelector('#ew-app-update-status');
  const appUpdateCheckButton = updatePanel.querySelector('#ew-app-update-check');
  const appUpdateInstallButton = updatePanel.querySelector('#ew-app-update-install');
  const appUpdateAutoToggle = updatePanel.querySelector('#ew-app-update-auto');
  let availableUpdate = null;

  function setHeaderUpdate(text, state, detail) {
    headerUpdate.textContent = text;
    headerUpdate.dataset.state = state;
    headerUpdate.title = detail || text;
  }
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
    appUpdateCheckButton.disabled = value;
    appUpdateInstallButton.disabled = value;
    appUpdateAutoToggle.disabled = value;
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

  function showUpdateResult(result) {
    const message = appUpdateMessage(result);
    availableUpdate = result.available || null;
    appUpdateState.publish({
      status: availableUpdate ? 'available' : result.configured === false ? 'unconfigured' : 'current',
      currentVersion: result.currentVersion,
      availableVersion: availableUpdate?.version,
    });
    appUpdateStatus.textContent = message;
    if (availableUpdate) setHeaderUpdate(`Оновлення: v${String(availableUpdate.version)}`, 'available', message);
    else if (result.configured === false) setHeaderUpdate('Оновлення: вручну', 'off', message);
    else setHeaderUpdate(`v${String(result.currentVersion)} актуальна`, 'ok', message);
    appUpdateInstallButton.hidden = !availableUpdate;
  }

  appUpdateCheckButton.addEventListener('click', async () => {
    appUpdateState.publish({ status: 'checking' });
    setBusy(true);
    appUpdateInstallButton.hidden = true;
    availableUpdate = null;
    appUpdateStatus.textContent = 'Перевіряємо наявність нової версії…';
    setHeaderUpdate('Оновлення: перевірка…', 'busy');
    try {
      showUpdateResult(await checkForAppUpdate());
    } catch (error) {
      appUpdateState.publish({ status: 'error' });
      appUpdateStatus.textContent = `Не вдалося перевірити оновлення: ${String(error)}`;
      setHeaderUpdate('Оновлення: помилка', 'error', appUpdateStatus.textContent);
    } finally {
      appUpdateInstallButton.hidden = !availableUpdate;
      setBusy(false);
    }
  });

  // Автоматична перевірка, лише якщо користувач її ввімкнув: застосунок сам
  // пропускає її, якщо від попередньої не минула доба. Помилка не заважає роботі.
  async function autoCheck() {
    try {
      const result = await autoCheckForAppUpdate();
      if (result && !availableUpdate) showUpdateResult(result);
    } catch (error) {
      appUpdateState.publish({ status: 'error' });
      appUpdateStatus.textContent = `Автоматична перевірка оновлень не вдалася: ${String(error)}. Можна перевірити вручну.`;
    }
  }

  void getAppUpdateSettings().then(settings => {
    appUpdateAutoToggle.checked = Boolean(settings?.enabled);
    if (settings?.enabled) void autoCheck();
  }).catch(() => {});

  appUpdateAutoToggle.addEventListener('change', async () => {
    const enabled = appUpdateAutoToggle.checked;
    appUpdateAutoToggle.disabled = true;
    try {
      const settings = await setAppUpdateAutoCheck(enabled);
      appUpdateAutoToggle.checked = Boolean(settings?.enabled);
      appUpdateStatus.textContent = settings?.enabled
        ? 'Автоматична перевірка ввімкнена: раз на добу під час запуску.'
        : 'Автоматична перевірка вимкнена. Оновлення перевіряються лише кнопкою.';
      if (settings?.enabled) await autoCheck();
    } catch (error) {
      appUpdateAutoToggle.checked = !enabled;
      appUpdateStatus.textContent = `Не вдалося змінити налаштування: ${String(error)}`;
    } finally {
      appUpdateAutoToggle.disabled = false;
    }
  });

  appUpdateInstallButton.addEventListener('click', async () => {
    if (!availableUpdate) return;
    if (!window.confirm(`Встановити EasyWAR ${String(availableUpdate.version)}? Спершу буде створено копію бази, потім завантажено й перевірено підписаний пакет, після чого EasyWAR перезапуститься.`)) return;
    appUpdateState.publish({ status: 'installing', availableVersion: availableUpdate.version });
    setBusy(true);
    appUpdateStatus.textContent = 'Створюємо копію бази й завантажуємо оновлення…';
    setHeaderUpdate('Оновлення: встановлення…', 'busy');
    try {
      const snapshot = await installAppUpdate();
      appUpdateStatus.textContent = `Оновлення встановлено. Копія бази: ${String(snapshot)}. EasyWAR перезапускається…`;
    } catch (error) {
      appUpdateState.publish({ status: 'error' });
      appUpdateStatus.textContent = `Оновлення не встановлено: ${String(error)}. Поточна версія працює далі; перевірте оновлення ще раз.`;
      setHeaderUpdate('Оновлення: помилка', 'error', appUpdateStatus.textContent);
      availableUpdate = null;
      appUpdateInstallButton.hidden = true;
      setBusy(false);
    }
  });

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
