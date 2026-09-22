import { invoke } from '@tauri-apps/api/core';

export async function runXlsxInspection(button, status, invokeCommand = invoke) {
  if (button.disabled) return;
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
  }
}

function initializeXlsxInspection() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;
  const panel = document.querySelector('#xlsxInspectPanel');
  const button = document.querySelector('#xlsxInspectBtn');
  const status = document.querySelector('#xlsxInspectStatus');
  if (!panel || !button || !status) return;
  panel.hidden = false;
  button.addEventListener('click', () => { void runXlsxInspection(button, status); });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeXlsxInspection, { once: true });
  } else {
    initializeXlsxInspection();
  }
}
