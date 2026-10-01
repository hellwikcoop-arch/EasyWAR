/* Оркестрація створення презентації без DOM: файли → перевірка даних → рішення → модель колоди.
   Таблиці ПС, РВіА і «НАШІ ВТРАТИ» необов'язкові: немає файлу — немає відповідного слайда, заміни з УДШВ немає. */
import { buildDeck } from './presentation-core.js';
import { parseOwnLosses } from './own-losses-core.js';
import { parseStrikes } from './strikes-core.js';
import { applyReview, defaultDecisions, reviewData } from './data-review-core.js';

export const FOCUS_CHOICES = [['all', 'Усе'], ['result', 'Результат'], ['efficiency', 'Ефективність']];
export const GROUP_SLOTS = [
  { key: 'ps', title: 'ПС', weapon: 'Тип ЛА', heading: 'Місячна аналітика тактичної авіації' },
  { key: 'rvia', title: 'РВіА', weapon: 'Тип ПУ', heading: 'Місячна аналітика ракетних військ' },
];

/** Розбір файлу в слот: own | ps | rvia. Повертає { workbook } або { error } українською. */
export function parseSlot(slot, sheets, fileName) {
  try {
    if (slot === 'own') return { workbook: parseOwnLosses(sheets, fileName) };
    const workbook = parseStrikes(sheets, fileName);
    const expected = GROUP_SLOTS.find(g => g.key === slot);
    if (expected && workbook.weaponLabel !== expected.weapon) {
      return { error: `У таблиці стовпець «${workbook.weaponLabel}», а для ${expected.title} очікується «${expected.weapon}». Можливо, це файл не того роду військ.` };
    }
    return { workbook };
  } catch (e) {
    if (e && (e.code === 'NOT_OWN_LOSSES' || e.code === 'NOT_STRIKES' || e.code === 'AMBIGUOUS_HEADER')) return { error: e.message };
    throw e;
  }
}

const groupsOf = files => GROUP_SLOTS.filter(g => files[g.key]).map(g => ({ id: g.key, title: g.title, heading: g.heading, strikes: files[g.key] }));

/** Меню перевірки: пункти за всіма підключеними таблицями. */
export function reviewFor(workbook, files = {}) {
  return reviewData({ udshv: workbook, ownLosses: files.own || null, groups: groupsOf(files) });
}

/** Застосовує рішення до копій і будує модель колоди. Вхідні дані не змінюються. */
export function composeDeck(workbook, files = {}, settings = {}) {
  const review = reviewFor(workbook, files);
  const decisions = settings.decisions || defaultDecisions(review.items);
  const applied = applyReview({ udshv: workbook, ownLosses: files.own || null, groups: groupsOf(files) }, review, decisions);
  const custom = settings.custom && settings.custom.from && settings.custom.to ? settings.custom : null;
  const deck = buildDeck(applied.udshv, {
    owner: settings.owner || '',
    titleText: settings.titleText || '',
    generatedOn: settings.generatedOn || '',
    focus: settings.focus || 'all',
    custom,
    excludeUnits: settings.excludeUnits || [],
    groups: applied.groups,
    ownLosses: applied.ownLosses,
  });
  return { deck, review, corrections: applied.corrections, rejected: applied.rejected };
}

export const presentationFileName = (owner, date) => `Аналітика ${String(owner || 'УДШВ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()} ${date || ''}`.trim() + '.pptx';
