// Пакет пропозиції для розробника: чистий текст без даних таблиць. Нічого не надсилається автоматично:
// користувач сам зберігає файл і передає його розробнику в Signal.
// Відомості про елемент дашборда в пакет потрапляють лише за явним вибором користувача і лише у двох видах:
// 1) статичні ідентифікатори з коду (модуль, ідентифікатор і назва пояснення з каталогу);
// 2) окремо — підпис елемента з екрана, який може містити текст таблиці; його додають лише свідомо.
import { explainRefTitle } from './assistant-explain-refs-core.js';

export const PROPOSAL_KINDS = Object.freeze([
  { id: 'fix', label: 'Правка або помилка' },
  { id: 'feature', label: 'Нова функція' },
  { id: 'explain', label: 'Неправильне або відсутнє пояснення' },
]);

export const PROPOSAL_TEXT_LIMIT = 2000;
export const PROPOSAL_IMAGE_LIMIT = 10 * 1024 * 1024;
export const PROPOSAL_IMAGE_TYPES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });

const BRANCHES = { air: 'ПС', rocket: 'РВ', pvk: 'ПВК', dshv: 'УДШВ' };
const clean = (value, limit) => String(value ?? '').normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim().slice(0, limit);

export function validateProposalText(value) {
  const text = clean(value, PROPOSAL_TEXT_LIMIT + 1);
  if (text.length < 5) return { ok: false, message: 'Опишіть пропозицію хоча б кількома словами.' };
  if (text.length > PROPOSAL_TEXT_LIMIT) return { ok: false, message: `Опис задовгий: не більше ${PROPOSAL_TEXT_LIMIT} символів.` };
  return { ok: true, message: '' };
}

export function validateProposalImage(file) {
  if (!file) return { ok: true, message: '' };
  if (!Object.prototype.hasOwnProperty.call(PROPOSAL_IMAGE_TYPES, file.type)) return { ok: false, message: 'Скриншот має бути зображенням PNG, JPEG або WebP.' };
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > PROPOSAL_IMAGE_LIMIT) return { ok: false, message: 'Скриншот має бути не більшим за 10 МБ.' };
  return { ok: true, message: '' };
}

const stamp = date => {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export function proposalFileNames(date, image) {
  const base = `easywar-propozytsiia-${stamp(date)}`;
  const ext = image ? PROPOSAL_IMAGE_TYPES[image.type] : null;
  return { text: `${base}.md`, image: ext ? `${base}-skryn.${ext}` : null };
}

export const PROPOSAL_FOOTER = 'Пакет сформовано локально. Таблиці й записи в нього не входять.';
export const PROPOSAL_FOOTER_WITH_LABEL = 'Пакет сформовано локально. Підпис елемента з екрана додано за вибором користувача: він може містити текст із таблиці. Самі таблиці й записи в пакет не входять.';

/**
 * input: { kind, text, context: { branch, explainId, screenLabel } | null, appVersion, createdAt: Date, imageName }
 * Контекст за замовчуванням порожній. Якщо його передано, до пакета входять лише статичні відомості з коду:
 * модуль, ідентифікатор пояснення та його назва з каталогу (assistant-explain-refs-core.js). Інші поля
 * контексту (зокрема `title`) ігноруються, тож підпис з екрана не потрапить у пакет випадково.
 * Підпис з екрана додається лише через `context.screenLabel`, який інтерфейс заповнює після окремого вибору користувача.
 */
export function buildProposal(input) {
  const kind = PROPOSAL_KINDS.find(item => item.id === input?.kind) || PROPOSAL_KINDS[0];
  const text = clean(input?.text, PROPOSAL_TEXT_LIMIT);
  const lines = ['# Пропозиція до EasyWAR', '', `Тип: ${kind.label}`];
  const version = typeof input?.appVersion === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(input.appVersion) ? input.appVersion : '';
  if (version) lines.push(`Версія: ${version}`);
  const created = input?.createdAt;
  if (created instanceof Date && !Number.isNaN(created.getTime())) lines.push(`Дата: ${created.toISOString().slice(0, 10)}`);
  const context = input?.context;
  let screenLabel = '';
  if (context && typeof context === 'object') {
    const module = Object.prototype.hasOwnProperty.call(BRANCHES, context.branch) ? BRANCHES[context.branch] : '';
    const title = explainRefTitle(context.explainId);
    if (module) lines.push(`Модуль: ${module}`);
    if (title) lines.push(`Елемент: ${title}`, `Ідентифікатор пояснення: ${context.explainId}`);
    screenLabel = title ? clean(context.screenLabel, 200).replace(/\s+/gu, ' ') : '';
    if (screenLabel) lines.push(`Підпис на екрані (додано користувачем, може бути з таблиці): ${screenLabel}`);
  }
  lines.push('', '## Опис', '', text);
  const imageName = clean(input?.imageName, 120);
  if (imageName) lines.push('', `Скриншот додається окремим файлом: ${imageName}`);
  lines.push('', '---', screenLabel ? PROPOSAL_FOOTER_WITH_LABEL : PROPOSAL_FOOTER);
  return lines.join('\n') + '\n';
}
