// Чернетка доповіді: чиста логіка без DOM, сховища, мережі й Tauri.
// КОМБАТ лише переносить ТЕКСТ КОРИСТУВАЧА, без змін, у поле «Повідомлення» вкладки «Внесення доповідей» (ПС або РВ).
// Він нічого не вигадує, не розбирає й не додає в таблицю: розбір і додавання лишаються за кнопками модуля.
// Підстановка можлива лише після підтвердження, на якому показано, що саме й куди буде підставлено.

export const DRAFT_TEXT_LIMIT = 4000;

// Лише модулі, у яких є поле внесення доповіді. ПВК і УДШВ відкриті для читання.
export const DRAFT_TARGETS = Object.freeze({
  air: Object.freeze({ id: 'air', label: 'ПС', title: 'Повітряні Сили' }),
  rocket: Object.freeze({ id: 'rocket', label: 'РВ', title: 'Ракетні Війська' }),
});

export const DRAFT_BLOCKS = Object.freeze({
  target: 'Чернетку можна підготувати лише для модулів ПС і РВ.',
  empty: 'Введіть текст доповіді.',
  tooLong: `Текст задовгий: не більше ${DRAFT_TEXT_LIMIT} символів.`,
  notReady: 'Модуль ще не готовий. Зачекайте кілька секунд і повторіть.',
  locked: 'Профіль заблоковано. Увійдіть у профіль і повторіть.',
  disabled: 'Поле внесення недоступне: спершу відкрийте таблицю у вкладці «Внесення доповідей» модуля.',
  occupied: count => `У полі вже є текст (${count} симв.). КОМБАТ нічого не замінює й не дописує: очистіть поле самі й повторіть.`,
  autoAdd: 'У модулі ввімкнено «Додавати автоматично»: розпізнаний запис додався б у таблицю без вашого підтвердження. Вимкніть цей перемикач і повторіть.',
});

/** Прибирає керівні символи, зводить переноси до \n; решту тексту не чіпає. */
export function cleanDraftText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/^\n+|\s+$/gu, '');
}

export function validateDraftText(value) {
  const text = cleanDraftText(value);
  if (!text.trim()) return { ok: false, message: DRAFT_BLOCKS.empty };
  if ([...text].length > DRAFT_TEXT_LIMIT) return { ok: false, message: DRAFT_BLOCKS.tooLong };
  return { ok: true, message: '' };
}

/**
 * Чи можна підставити чернетку просто зараз.
 * field: { found, disabled, value, autoAdd } — стан поля у вкладці; locked — профіль заблоковано.
 * Повертає { ok:true, text, target, fieldWas } або { ok:false, message }.
 */
export function planDraft({ branch, text, field, locked = false }) {
  const target = Object.prototype.hasOwnProperty.call(DRAFT_TARGETS, branch) ? DRAFT_TARGETS[branch] : null;
  if (!target) return { ok: false, message: DRAFT_BLOCKS.target };
  const verdict = validateDraftText(text);
  if (!verdict.ok) return { ok: false, message: verdict.message };
  if (locked) return { ok: false, message: DRAFT_BLOCKS.locked };
  if (!field || !field.found) return { ok: false, message: DRAFT_BLOCKS.notReady };
  if (field.disabled) return { ok: false, message: DRAFT_BLOCKS.disabled };
  const current = String(field.value ?? '');
  if (current.trim()) return { ok: false, message: DRAFT_BLOCKS.occupied([...current].length) };
  if (field.autoAdd) return { ok: false, message: DRAFT_BLOCKS.autoAdd };
  return { ok: true, text: cleanDraftText(text), target, fieldWas: 'порожнє' };
}

/** Рядки підтвердження: що саме, куди й що станеться далі. */
export function draftSummary(plan) {
  if (!plan?.ok) return [];
  return [
    `Куди: модуль ${plan.target.label} («${plan.target.title}»), вкладка «Внесення доповідей», поле «Повідомлення».`,
    `Зараз у полі: ${plan.fieldWas}.`,
    `Буде підставлено: ваш текст без змін, ${[...plan.text].length} симв.`,
    'Далі: модуль сам покаже розбір. У таблицю нічого не додається, поки ви не натиснете кнопку додавання в модулі.',
  ];
}
