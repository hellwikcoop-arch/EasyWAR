// Екран «Оновити з нового файла» (E3в): підписи й моделі без DOM. Порівняння — table-update-core.js.

import { pluralForm } from './dashboard-module-catalog-core.js';
import { importGaps } from './dashboard-module-source-core.js';

const COUNT_WORDS = Object.freeze({
  added: ['новий рядок', 'нові рядки', 'нових рядків'],
  changed: ['змінений рядок', 'змінені рядки', 'змінених рядків'],
  removed: ['зниклий рядок', 'зниклі рядки', 'зниклих рядків'],
  ambiguous: ['неоднозначний рядок', 'неоднозначні рядки', 'неоднозначних рядків'],
});

const word = (count, forms) => `${count} ${pluralForm(count, ...forms)}`;

/** Рядки підсумку без нулів; порожній список — у файлі нічого не змінилося. */
export function summaryLines(diff) {
  if (!diff?.ok) return [];
  return Object.keys(COUNT_WORDS)
    .filter(id => diff.counts[id] > 0)
    .map(id => ({ id, text: word(diff.counts[id], COUNT_WORDS[id]) }));
}

/** Чи є що застосовувати: додані, змінені або (за вибором) видалені рядки. */
export function hasChanges(diff, removedPolicy = 'keep') {
  if (!diff?.ok) return false;
  return diff.counts.added > 0 || diff.counts.changed > 0 || (removedPolicy === 'remove' && diff.counts.removed > 0);
}

const show = value => (value === null || value === undefined || value === '' ? '—' : String(value));

/** Підпис однієї зміни: «К-сть БП: 4 → 5»; для вручну виправленої клітинки — що виправлення лишиться. */
export function changeText(change, labelOf) {
  const label = labelOf.get(change.field) || change.field;
  const base = `${label}: ${show(change.from)} → ${show(change.to)}`;
  return change.corrected ? `${base} (ваше виправлення лишиться)` : base;
}

/** Підпис рядка для списків: значення ключових стовпців через « · ». */
export function rowLabel(row, keyColumns) {
  return keyColumns.map(key => show(row?.[key])).join(' · ');
}

/**
 * Стан нового файла перед порівнянням. `plan` — результат `planImport`. Порівнювати можна лише повно й
 * чисто прочитаний аркуш: частковий імпорт зробив би «зниклими» рядки, яких просто не прочитали.
 */
export function readiness(plan) {
  if (!plan || !Array.isArray(plan.rows) || !plan.rows.length) {
    return { ok: false, message: 'У файлі не знайдено рядків, що відповідають стовпцям модуля.' };
  }
  const gaps = importGaps(plan);
  if (!gaps.complete) {
    return { ok: false, message: 'Файл прочитано не повністю або з зауваженнями. Підтягніть його через створення модуля, перевірте й повторіть.' };
  }
  return { ok: true, message: '' };
}

/** Підписи ключа для вибору: назви полів модуля. */
export function keyOptions(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter(field => typeof field?.key === 'string' && field.key !== 'id')
    .map(field => ({ key: field.key, label: field.label || field.key }));
}
