import { UNKNOWN_ANSWER, isInstructionText } from './assistant-knowledge-core.js';

const BRANCH_LABELS = Object.freeze({ air: 'ПС', rocket: 'РВ', pvk: 'ПВК', dshv: 'УДШВ', pvk_losses: 'ПВК · Наші втрати', dshv_losses: 'УДШВ · Наші втрати' });
export function stateQuestion(query) {
  if (typeof query !== 'string' || isInstructionText(query)) return null;
  const text = query.toLocaleLowerCase('uk-UA');
  const procedure = /(?:^|\s)(?:як|де)(?:\s|$)/u.test(text);
  if (/оновлен/u.test(text) && /(?:чи\s+є|чи\s+доступн|доступн|статус|стан|нов[аієї]\s+версі)/u.test(text)
    && !procedure && !/перевірит|встановит|завантаж/u.test(text)) return 'updates';
  if (/версі/u.test(text) && /поточн|встановлен|яка|яку|версія застосунку/u.test(text) && !procedure && !/оновит|перевірит|завантаж/u.test(text)) return 'version';
  if (/таблиц|таблиці/u.test(text) && /прив.?язан|підключен/u.test(text) && !procedure) return 'tables';
  return null;
}

// Only public, typed metadata is formatted. Paths and arbitrary labels never escape.
export function answerApplicationState(kind, state = {}) {
  if (!state || typeof state !== 'object') state = {};
  let text = UNKNOWN_ANSWER;
  if (kind === 'version' && typeof state.appVersion === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(state.appVersion)) text = `Встановлена версія easyWAR: ${state.appVersion}.`;
  if (kind === 'tables' && Array.isArray(state.boundBranches) && state.boundBranches.every(branch => typeof branch === 'string' && Object.prototype.hasOwnProperty.call(BRANCH_LABELS, branch))) {
    const labels = [...new Set(state.boundBranches)].map(branch => BRANCH_LABELS[branch]);
    text = labels.length ? `До поточного профілю прив’язані таблиці: ${labels.join(', ')}.` : 'До поточного профілю таблиці ще не прив’язані.';
  }
  if (kind === 'updates') {
    const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(value);
    const current = version(state.currentVersion) ? state.currentVersion : null;
    if (state.status === 'unchecked') text = 'У цьому запуску оновлення ще не перевіряли. Відкрийте панель «Оновлення», щоб запустити перевірку вручну.';
    if (state.status === 'checking') text = 'Штатний оновлювач зараз перевіряє нову версію.';
    if (state.status === 'available' && version(state.availableVersion)) text = `Штатний оновлювач знайшов easyWAR ${state.availableVersion}. Відкрийте панель «Оновлення», щоб переглянути й вирішити, чи встановлювати.`;
    if (state.status === 'current' && current) text = `За останньою перевіркою в цьому запуску версія easyWAR ${current} актуальна.`;
    if (state.status === 'unconfigured') text = 'Автоматичну перевірку не налаштовано. Відкрийте панель «Оновлення», щоб перевірити вручну.';
    if (state.status === 'error') text = 'Не вдалося перевірити оновлення. Деталі є у штатній панелі «Оновлення».';
    if (state.status === 'installing') text = 'Штатний оновлювач зараз встановлює оновлення.';
  }
  return { status: text === UNKNOWN_ANSWER ? 'unknown' : 'found', text, origin: 'application-state', sources: [], warnings: [] };
}
