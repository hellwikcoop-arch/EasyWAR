import { invoke } from '@tauri-apps/api/core';

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
