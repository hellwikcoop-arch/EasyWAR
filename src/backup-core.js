import { invoke } from '@tauri-apps/api/core';

/**
 * Бібліотека «Робочого середовища» лежить у тій самій базі (зашифровано), тож копія й
 * відновлення охоплюють і її. Тексти попереджень діалогу «Резервна копія».
 */
export const LIBRARY_BACKUP_NOTE = 'Копія містить і бібліотеку «Робочого середовища» — зашифровану, як і в базі. Після відновлення з копії бібліотеку відкриває пароль профілю, чинний на час створення копії, а не змінений пізніше.';
export const LIBRARY_RESTORE_NOTE = 'Відновлення повертає й бібліотеку «Робочого середовища» до стану на час копії: документи, додані пізніше, зникнуть. Копія, створена до видалення профілю разом з бібліотекою, і далі містить її зашифровані документи.';

export function getDatabaseStatus(invokeCommand = invoke) {
  return invokeCommand('get_database_status');
}

export function stageLocalRestore(invokeCommand = invoke) {
  return invokeCommand('stage_local_restore');
}

export function cancelStagedRestore(invokeCommand = invoke) {
  return invokeCommand('cancel_staged_restore');
}

export function applyStagedRestoreAndRestart(invokeCommand = invoke) {
  return invokeCommand('apply_staged_restore_and_restart');
}

export function getRestoreStartupReport(invokeCommand = invoke) {
  return invokeCommand('get_restore_startup_report');
}

export function finalizeLocalRestore(invokeCommand = invoke) {
  return invokeCommand('finalize_local_restore');
}

export function restoreStartupMessage(report) {
  switch (report?.outcome) {
    case 'none':
      return report.pendingRestoreAvailable
        ? 'Є підготовлена копія. Підтвердьте відновлення з перезапуском або скасуйте підготовку.'
        : '';
    case 'applied':
      return 'Відновлення застосовано. Попередню базу збережено до вашого окремого підтвердження.';
    case 'rolled_back':
      return 'Перервану заміну безпечно відкотили. Підготовлену копію не застосовано.';
    case 'failed':
      return `Відновлення не застосовано: ${String(report.detail || 'невідома помилка')}`;
    default:
      throw new TypeError(`Невідомий стан відновлення: ${String(report?.outcome)}`);
  }
}

export function databaseStatusMessage(status) {
  if (status?.migrationState !== 'current') {
    throw new TypeError(`Невідомий стан міграцій: ${String(status?.migrationState)}`);
  }
  if (!Number.isSafeInteger(status.schemaVersion) || status.schemaVersion < 1 ||
      status.schemaVersion !== status.supportedSchemaVersion ||
      !Number.isSafeInteger(status.migrationCount) || status.migrationCount < 1) {
    throw new TypeError('Некоректний стан міграцій EasyWAR');
  }
  return `EasyWAR ${String(status.appVersion)}. Схема SQLite ${status.schemaVersion} із ${status.supportedSchemaVersion}; перевірено міграцій: ${status.migrationCount}. Стан актуальний.`;
}

export function checkForAppUpdate(invokeCommand = invoke) {
  return invokeCommand('check_for_app_update');
}

export function installAppUpdate(invokeCommand = invoke) {
  return invokeCommand('install_app_update');
}

/** Налаштування автоматичної перевірки: { enabled, lastCheckAt }. За замовчуванням вимкнена. */
export function getAppUpdateSettings(invokeCommand = invoke) {
  return invokeCommand('get_app_update_settings');
}

export function setAppUpdateAutoCheck(enabled, invokeCommand = invoke) {
  return invokeCommand('set_app_update_auto_check', { enabled: Boolean(enabled) });
}

/**
 * Автоматична перевірка: застосунок сам вирішує, чи вона ввімкнена й чи минула доба
 * від попередньої. Повертає null без звернення до мережі, якщо перевіряти не треба.
 */
export function autoCheckForAppUpdate(invokeCommand = invoke) {
  return invokeCommand('auto_check_for_app_update');
}

export function appUpdateMessage(status) {
  if (status?.configured === false) {
    return `EasyWAR ${String(status.currentVersion)}. У цій збірці автоматичні оновлення не налаштовано — нову версію встановлюйте вручну.`;
  }
  if (status?.configured !== true) {
    throw new TypeError('Некоректна відповідь перевірки оновлень EasyWAR');
  }
  if (!status.available) {
    return `Встановлено актуальну версію EasyWAR ${String(status.currentVersion)}.`;
  }
  const notes = status.available.notes ? ` Що нового: ${String(status.available.notes)}` : '';
  return `Доступна версія ${String(status.available.version)} (зараз ${String(status.currentVersion)}).${notes}`;
}
