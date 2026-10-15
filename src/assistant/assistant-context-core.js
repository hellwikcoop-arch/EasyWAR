import { parseStrikes } from '../strikes-core.js';

export const ASSISTANT_BRANCHES = Object.freeze(['air', 'rocket', 'pvk', 'dshv']);

// Only already-opened values are accepted. No source/file/database readers here.
export function reviewContext({ branch, workbook, sheets, ownLosses, ownLossesVisible = false } = {}) {
  if (!ASSISTANT_BRANCHES.includes(branch)) return { input: null, label: '', message: 'Відкрийте модуль ПС, РВ, ПВК або УДШВ та потрібну таблицю.' };
  if (ownLossesVisible) {
    if (!ownLosses) return { input: null, label: 'Наші втрати', message: 'На відкритій вкладці ще немає таблиці для перевірки.' };
    return { input: { ownLosses }, label: 'Наші втрати', message: '' };
  }
  if (!workbook) return { input: null, label: '', message: 'Спочатку відкрийте таблицю в поточному модулі.' };
  if (workbook.kind === 'udshv') return { input: { udshv: workbook }, label: 'УДШВ', message: '' };
  if (workbook.kind === 'pvk') return { input: null, label: 'ПВК', message: 'Перевірка основної таблиці ПВК поки не підтримується. Можна перевірити відкриту вкладку «Наші втрати».' };
  if (!Array.isArray(sheets)) return { input: null, label: '', message: 'Відкрита таблиця поки недоступна для перевірки.' };
  try {
    const strikes = parseStrikes(sheets, '');
    const label = ['rocket', 'dshv'].includes(branch) ? 'РВ' : 'ПС';
    return { input: { groups: [{ id: branch, title: label, strikes }] }, label, message: '' };
  } catch {
    return { input: null, label: '', message: 'Перевірка цього формату таблиці поки не підтримується.' };
  }
}
