import { moduleWindow } from '../air-bridge.js';
import { ASSISTANT_BRANCHES, reviewContext } from './assistant-context-core.js';

// Called only by the explicit review button. Never opens a branch or a file.
export async function readVisibleAssistantContext() {
  const branch = document.body.dataset.activeBranch;
  if (!ASSISTANT_BRANCHES.includes(branch)) return reviewContext();
  const frame = moduleWindow(branch);
  if (!frame || frame.document.documentElement.classList.contains('ew-locked')) return reviewContext();
  const sqliteVisible = () => frame.document.querySelector('#dashboardSourceToggle')?.getAttribute('aria-pressed') === 'true';
  const ownRoot = frame.document.querySelector('.ol-root');
  const ownLossesVisible = Boolean(ownRoot && ownRoot.getClientRects().length);
  if (!ownLossesVisible && sqliteVisible()) return { input: null, label: '', message: 'Відкрито дашборд зі схвалених записів SQLite. Перевірка цього джерела не входить до етапу 1; відкрийте потрібну XLSX-таблицю.' };
  const state = frame.__AV?.S;
  const workbook = state?.wb;
  const originalBytes = state?.bytes;
  const ownLosses = ownLossesVisible ? frame.EWOwnLosses?.snapshot?.(branch) : null;
  const isCurrent = () => document.body.dataset.activeBranch === branch && moduleWindow(branch) === frame
    && frame.__AV?.S?.wb === workbook && frame.__AV?.S?.bytes === originalBytes && (ownLossesVisible || !sqliteVisible())
    && Boolean(frame.document.querySelector('.ol-root')?.getClientRects().length) === ownLossesVisible
    && (!ownLossesVisible || frame.EWOwnLosses?.snapshot?.(branch) === ownLosses);
  if (ownLossesVisible) {
    return { ...reviewContext({ branch, ownLosses, ownLossesVisible }), isCurrent };
  }
  if (!workbook || ['udshv', 'pvk'].includes(workbook.kind)) return { ...reviewContext({ branch, workbook }), isCurrent };
  const reader = frame.AVCORE?.readAllSheets;
  if (!state.bytes || typeof reader !== 'function') return reviewContext({ branch, workbook });
  const bytes = new Uint8Array(state.bytes);
  const sheets = await reader(bytes);
  // Navigation or data replacement while parsing invalidates this context.
  if (!isCurrent()) {
    return { input: null, label: '', message: 'Відкритий контекст змінився. Запустіть перевірку ще раз.' };
  }
  return { ...reviewContext({ branch, workbook, sheets }), isCurrent };
}

/** Чи відкрито довідник у активному модулі: читає лише видимість вкладки, без даних таблиць. */
export function referenceOpen(branch) {
  try {
    const view = moduleWindow(branch)?.document?.querySelector('#view-ref');
    return Boolean(view && !view.hidden && view.getClientRects().length);
  } catch { return false; }
}
