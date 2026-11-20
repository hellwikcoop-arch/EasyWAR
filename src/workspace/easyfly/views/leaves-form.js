// Форма відпустки (додати / змінити) і видалення з підтвердженням. Спільна для екрана «Відпустки»
// і вкладки профілю. Вводяться лише дати, вид і стан; імен немає — пілот обирається за позивним.
import { LEAVE_KINDS, LEAVE_PART_DAYS, LEAVE_STATUSES, LEAVE_STATUS_LABELS, addDays, formatDate, leaveDays, leaveWarnings, pluralDays } from '../fly-core.js';
import { addLeave, deleteLeave, updateLeave } from '../fly-state.js';
import {
  confirmDialog, dateInput, el, errorBox, field, notice, openModal, readDate, select, textInput, toast,
} from '../ui.js';

/**
 * Відкриває форму. leave — наявний запис (зміна); personId — пілот за умовчанням;
 * lockPilot — не давати змінити пілота (вкладка профілю).
 */
export function openLeaveForm(ctx, { leave = null, personId = null, lockPilot = false } = {}) {
  const persons = [...ctx.data.persons].sort((a, b) => a.callsign.localeCompare(b.callsign, 'uk'));
  if (!persons.length) { toast('Спершу додайте пілота.', 'error'); return; }
  const errors = errorBox();
  const pilot = select(persons.map(p => ({ value: p.id, label: p.callsign })), leave?.personId || personId || persons[0].id);
  if (leave || lockPilot) pilot.disabled = true;
  const kind = select(LEAVE_KINDS.map(k => ({ value: k.id, label: k.label })), leave?.kind || 'basic');
  const from = dateInput(leave?.from || '');
  let endTouched = Boolean(leave?.to);
  const to = dateInput(leave?.to || '');
  const status = select(LEAVE_STATUSES.map(s => ({ value: s, label: LEAVE_STATUS_LABELS[s] })), leave?.status || 'planned');
  const note = textInput(leave?.note || '', { placeholder: 'Наприклад, після відпустки — ВЛК', maxLength: 500 });
  const hint = el('p', { class: 'ef-hint ef-hint-block', 'aria-live': 'polite' });
  const fillDefaultEnd = () => {
    const start = readDate(from);
    if (!start || endTouched) return;
    const end = addDays(start, LEAVE_PART_DAYS - 1);
    to.value = formatDate(end) || '';
  };
  const refresh = () => {
    fillDefaultEnd();
    const a = readDate(from);
    const b = readDate(to);
    const days = leaveDays(a, b);
    if (days === null) { hint.textContent = a && b ? 'Дата закінчення раніше за дату початку.' : (a ? '' : ''); hint.className = 'ef-hint ef-hint-block'; return; }
    const own = (ctx.data.leaves || []).filter(l => l.personId === pilot.value);
    const warnings = leaveWarnings({ id: leave?.id || null, kind: kind.value, from: a, to: b }, own);
    const back = endTouched ? '' : ' Типові 15 діб; дату повернення можна змінити.';
    hint.textContent = [`Повернення ${formatDate(b)} · ${days} ${pluralDays(days)} (${formatDate(a)}–${formatDate(b)}).${back}`, ...warnings].join(' ');
    hint.className = `ef-hint ef-hint-block${warnings.length ? ' ef-text-soon' : ''}`;
  };
  to.addEventListener('input', () => { endTouched = to.value.trim() !== ''; });
  for (const node of [pilot, kind, from, to]) { node.addEventListener('input', refresh); node.addEventListener('change', refresh); }
  refresh();
  const save = () => {
    const input = { personId: pilot.value, kind: kind.value, from: from.value, to: to.value, status: status.value, note: note.value };
    const result = ctx.mutate(data => (leave ? updateLeave(data, leave.id, input) : addLeave(data, input)));
    if (!result.ok) { errors.show(result.result.errors); return false; }
    toast(leave ? 'Відпустку змінено.' : 'Відпустку додано.');
    return true;
  };
  openModal({
    title: leave ? 'Змінити відпустку' : 'Додати відпустку',
    content: el('form', { class: 'ef-form', novalidate: true, onSubmit: e => e.preventDefault() },
      errors,
      el('div', { class: 'ef-form-grid' },
        field('Пілот', pilot).root, field('Вид', kind).root,
        field('З *', from, { hint: 'дд.мм.рррр' }).root,
        field('Дата повернення', to, { hint: 'Необов’язково: інакше 15 діб від початку, включно' }).root,
        field('Стан', status).root, field('Примітка', note).root),
      hint,
      notice(null, 'Частини основної відпустки — по 15 діб, між відпустками 3–4 місяці; ВЛК і ПМО командир ставить одразу після відпустки. Застереження показуються автоматично, запис не є наказом.')),
    actions: [{ label: 'Скасувати' }, { label: leave ? 'Зберегти зміни' : 'Додати відпустку', variant: 'primary', onClick: save }],
  });
}

/** Видалення відпустки з підтвердженням. */
export async function removeLeave(ctx, row) {
  const yes = await confirmDialog({
    title: 'Видалити відпустку?',
    message: `Буде видалено відпустку ${row.callsign} ${formatDate(row.leave.from)}–${formatDate(row.leave.to)}. Якщо файл ще не збережено, дію можна скасувати закриттям файла без збереження.`,
    confirmLabel: 'Видалити', danger: true,
  });
  if (!yes) return false;
  const result = ctx.mutate(data => deleteLeave(data, row.id, { confirmed: true }));
  if (result.ok) toast('Відпустку видалено.');
  return result.ok;
}

/** Текст про ВЛК/ПМО біля відпустки для таблиць. */
export function medicalText(medical) {
  if (!medical) return null;
  const date = formatDate(medical.dueDate);
  switch (medical.position) {
    case 'before': return `${medical.kind} до ${date} — перед відпусткою`;
    case 'during': return `${medical.kind} до ${date} — припадає на відпустку`;
    case 'after': return `${medical.kind} до ${date} — одразу після відпустки`;
    default: return `${medical.kind} до ${date}`;
  }
}
