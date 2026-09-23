import { invoke } from '@tauri-apps/api/core';

let xlsxOperationPending = false;

export async function runXlsxInspection(button, status, invokeCommand = invoke) {
  if (button.disabled || xlsxOperationPending) return;
  xlsxOperationPending = true;
  button.disabled = true;
  status.textContent = 'Оберіть таблицю .xlsx для локальної перевірки…';

  try {
    const inspection = await invokeCommand('inspect_local_xlsx');
    if (inspection === null) {
      status.textContent = 'Перевірку скасовано. Дані не змінено.';
    } else {
      if (typeof inspection?.sheet_name !== 'string' ||
          !Number.isSafeInteger(inspection.row_count) || inspection.row_count < 0) {
        throw new Error('Некоректна відповідь локальної перевірки.');
      }
      status.textContent = `Аркуш «${inspection.sheet_name}» прочитано. Рядків даних: ${inspection.row_count}. Файл і локальну базу не змінено.`;
    }
  } catch (error) {
    status.textContent = `Перевірка XLSX не пройшла: ${String(error)}`;
  } finally {
    button.disabled = false;
    xlsxOperationPending = false;
  }
}

export async function runXlsxStage(button, status, invokeCommand = invoke) {
  if (button.disabled || xlsxOperationPending) return;
  xlsxOperationPending = true;
  button.disabled = true;
  status.textContent = 'Оберіть таблицю .xlsx для імпорту в локальну базу…';

  try {
    const result = await invokeCommand('stage_local_xlsx');
    if (result === null) {
      status.textContent = 'Імпорт скасовано. Файл і локальну базу не змінено.';
    } else {
      if (!Number.isSafeInteger(result?.staged_rows) || result.staged_rows < 0 ||
          !Number.isSafeInteger(result?.already_present_rows) || result.already_present_rows < 0 ||
          !Number.isSafeInteger(result?.duplicate_rows) || result.duplicate_rows < 0) {
        throw new Error('Некоректна відповідь локального імпорту.');
      }
      status.textContent = `Імпорт завершено. Додано рядків: ${result.staged_rows}; вже були в базі: ${result.already_present_rows}; точних дублікатів: ${result.duplicate_rows}. Дублікати збережено з окремим посиланням на збіг. Вихідний XLSX не змінено. Записи мають стан «Розібрано» й не схвалені.`;
    }
  } catch (error) {
    status.textContent = `Імпорт XLSX не виконано: ${String(error)}`;
  } finally {
    button.disabled = false;
    xlsxOperationPending = false;
  }
}

function initializeXlsxInspection() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;
  const panel = document.querySelector('#xlsxInspectPanel');
  const button = document.querySelector('#xlsxInspectBtn');
  const stageButton = document.querySelector('#xlsxStageBtn');
  const status = document.querySelector('#xlsxInspectStatus');
  if (!panel || !button || !stageButton || !status) return;
  panel.hidden = false;
  button.addEventListener('click', () => { void runXlsxInspection(button, status); });
  stageButton.addEventListener('click', () => { void runXlsxStage(stageButton, status); });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeXlsxInspection, { once: true });
  } else {
    initializeXlsxInspection();
  }
}
