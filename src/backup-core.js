import { invoke } from '@tauri-apps/api/core';

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
