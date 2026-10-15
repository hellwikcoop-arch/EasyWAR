// Пакет пропозиції для розробника: чистий текст без даних таблиць. Нічого не надсилається автоматично:
// користувач сам зберігає файл і передає його розробнику в Signal.

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

/**
 * input: { kind, text, context: { branch, title } | null, appVersion, createdAt: Date, imageName }
 * Контекст містить лише назву елемента, а не його значення чи рядки таблиці.
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
  if (context && typeof context === 'object') {
    const module = BRANCHES[context.branch];
    const title = clean(context.title, 200);
    if (module) lines.push(`Модуль: ${module}`);
    if (title) lines.push(`Елемент: ${title}`);
  }
  lines.push('', '## Опис', '', text);
  const imageName = clean(input?.imageName, 120);
  if (imageName) lines.push('', `Скриншот додається окремим файлом: ${imageName}`);
  lines.push('', '---', 'Пакет сформовано локально. Таблиці й записи в нього не входять.');
  return lines.join('\n') + '\n';
}
