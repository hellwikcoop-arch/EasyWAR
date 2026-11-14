// Спільні форми EasyFLY у модальних вікнах: пілот (додати/змінити/видалити), допуск (внести,
// поновити, видалити). Допуск пілот відмічає сам; жодного «затверджено» чи підпису немає.
import {
  AIRCRAFT_KINDS, CLASS_LABELS, CLASS_QUALS, ROLES, admissionKindsForRole, renewalHint,
} from '../fly-core.js';
import {
  addAdmission, addPerson, deleteAdmission, deletePerson, markAdmissionLost, setTraining, updatePerson,
} from '../fly-state.js';
import {
  confirmDialog, dateInput, el, errorBox, field, notice, openModal, readDate, select, textInput, toast,
} from '../ui.js';

const KIND_LABELS = { helicopter: 'Вертоліт', airplane: 'Літак' };

/** Форма пілота: без personId — «Додати пілота», з ним — «Змінити». */
export function openPilotForm(ctx, personId = null) {
  const person = personId ? ctx.data.persons.find(p => p.id === personId) : null;
  const errors = errorBox();
  const callsign = textInput(person?.callsign || '', { maxLength: 40, required: true });
  const role = select(ROLES, person?.role || 'КЕ');
  const classQual = select(CLASS_QUALS.map(c => ({ value: c, label: CLASS_LABELS[c] })), person?.classQual || 'none');
  const kind = select(AIRCRAFT_KINDS.map(k => ({ value: k, label: KIND_LABELS[k] })), person?.aircraftKind || 'helicopter');
  const aircraft = textInput(person?.aircraftType || '', { placeholder: 'Наприклад, Мі-8МТВ-1', maxLength: 30 });
  const link = textInput(person?.link || '', { placeholder: 'Наприклад, Ланка-1', maxLength: 30 });
  const form = el('form', { class: 'ef-form', novalidate: true },
    errors,
    el('div', { class: 'ef-form-grid' },
      field('Позивний *', callsign, { hint: 'Лише позивний, не прізвище й не повне ім’я.' }).root,
      field('Роль', role).root, field('Клас', classQual).root, field('Вид ПС', kind).root,
      field('Тип ПС', aircraft).root, field('Ланка', link).root));
  const save = () => {
    const input = {
      callsign: callsign.value, role: role.value, classQual: classQual.value, aircraftKind: kind.value,
      aircraftType: aircraft.value, link: link.value,
    };
    const result = ctx.mutate(data => (person ? updatePerson(data, person.id, input) : addPerson(data, input)));
    if (!result.ok) { errors.show(result.result.errors); return false; }
    toast(person ? 'Зміни пілота внесено.' : `Пілота «${input.callsign.trim()}» додано.`);
    if (!person && result.result.id) {
      ctx.go('pilot', { id: result.result.id, tab: 'komis' });
      openTrainingForm(ctx, result.result.id);
    }
    return true;
  };
  form.addEventListener('submit', event => { event.preventDefault(); });
  openModal({
    title: person ? `Змінити пілота ${person.callsign}` : 'Додати пілота',
    content: form,
    actions: [{ label: 'Скасувати' }, { label: person ? 'Зберегти зміни' : 'Додати пілота', variant: 'primary', onClick: save }],
  });
}

/** Підтверджене видалення пілота; після нього — на список. */
export async function confirmDeletePerson(ctx, person) {
  const yes = await confirmDialog({
    title: `Видалити пілота ${person.callsign}?`,
    message: 'Буде видалено пілота разом із його перевірками й допусками. Записи польотів лишаться без посилання на нього. Якщо файл ще не збережено, дію можна скасувати закриттям файла без збереження.',
    confirmLabel: 'Видалити', danger: true,
  });
  if (!yes) return false;
  const result = ctx.mutate(data => deletePerson(data, person.id, { confirmed: true }));
  if (result.ok) { toast(`Пілота «${person.callsign}» видалено.`); ctx.go('pilots'); }
  return result.ok;
}

/**
 * Рівень підготовки: позначки допусків у порядку зростання і свій пункт в кінці.
 * Довідково, строки від цього не змінюються.
 */
export function openTrainingForm(ctx, personId) {
  const person = ctx.data.persons.find(p => p.id === personId);
  if (!person) return;
  const kinds = admissionKindsForRole(person.role);
  const selected = new Set(person.training?.ids || []);
  const custom = [...(person.training?.custom || [])];
  const errors = errorBox();
  const list = el('div', { class: 'ef-level-list' });
  const instructorBox = el('input', { type: 'checkbox', checked: person.training?.instructor === true, id: 'ef-level-instructor' });
  const boxes = kinds.map(kind => {
    const box = el('input', { type: 'checkbox', checked: selected.has(kind.id), id: `ef-level-${kind.id}` });
    return { kind, box };
  });
  const customHost = el('div', { class: 'ef-level-custom' });
  const customInput = textInput('', { placeholder: 'Свій пункт, якого немає в переліку', maxLength: 80 });
  const paintCustom = () => {
    customHost.replaceChildren(...custom.map((label, index) => el('div', { class: 'ef-level-custom-row' },
      el('span', { text: label }),
      el('button', { type: 'button', class: 'ef-btn ef-btn-ghost', text: 'Прибрати', onClick: () => { custom.splice(index, 1); paintCustom(); } }))));
  };
  paintCustom();
  list.append(
    ...boxes.map(({ kind, box }) => el('label', { class: 'ef-level-item', for: box.id }, box, el('span', { text: kind.label }))),
    el('label', { class: 'ef-level-item', for: instructorBox.id }, instructorBox, el('span', { text: 'Інструкторський рівень підготовки' })));
  const save = () => {
    const ids = boxes.filter(item => item.box.checked).map(item => item.kind.id);
    const result = ctx.mutate(data => setTraining(data, personId, { ids, custom, instructor: instructorBox.checked }));
    if (!result.ok) { errors.show(result.result.errors); return false; }
    toast('Рівень підготовки збережено. Це довідкова позначка, не допуск до польотів.');
    return true;
  };
  openModal({
    title: 'Рівень підготовки',
    content: el('form', { class: 'ef-form', novalidate: true, onSubmit: e => e.preventDefault() },
      errors,
      list,
      el('p', { class: 'ef-hint', text: 'Свій пункт' }),
      customHost,
      el('div', { class: 'ef-form-grid' },
        field('Додати пункт, якого немає в переліку', customInput).root,
        el('button', { type: 'button', class: 'ef-btn', text: 'Додати свій пункт', onClick: () => {
          const label = customInput.value.trim();
          if (!label) return;
          custom.push(label);
          customInput.value = '';
          paintCustom();
        } }))),
    actions: [{ label: 'Пізніше' }, { label: 'Зберегти рівень', variant: 'primary', onClick: save }],
  });
}

/** Форма допуску: kindId — вид, що підставляється; admission — наявний запис (повторна відмітка). */
export function openAdmissionForm(ctx, person, { kindId = null, admission = null, dayNight = null } = {}) {
  const kinds = admissionKindsForRole(person.role);
  const errors = errorBox();
  const kindSel = select(kinds.map(k => ({ value: k.id, label: k.label })), admission?.kind || kindId || kinds[0]?.id || '');
  const dn = select([{ value: 'day', label: 'День' }, { value: 'night', label: 'Ніч' }], admission?.dayNight || dayNight || 'day');
  const exercise = textInput(admission?.exercise || '', { placeholder: 'Наприклад, 14', maxLength: 8 });
  const date = dateInput('');
  const hintBox = el('p', { class: 'ef-hint ef-hint-block' });
  const refresh = () => {
    const hint = renewalHint(kindSel.value, dn.value);
    hintBox.textContent = hint ? hint.text : '';
    if (hint?.exercise && !exercise.dataset.touched) exercise.value = String(hint.exercise);
  };
  exercise.addEventListener('input', () => { exercise.dataset.touched = '1'; });
  kindSel.addEventListener('change', refresh);
  dn.addEventListener('change', refresh);
  if (admission) { kindSel.disabled = true; dn.disabled = true; exercise.dataset.touched = admission.exercise ? '1' : ''; }
  refresh();
  const save = () => {
    const iso = readDate(date);
    if (!iso) { errors.show('Вкажіть дату у форматі дд.мм.рррр.'); return false; }
    const result = ctx.mutate(data => addAdmission(data, {
      personId: person.id, kind: kindSel.value, dayNight: dn.value, exercise: exercise.value, grantedAt: iso,
    }));
    if (!result.ok) { errors.show(result.result.errors); return false; }
    toast('Допуск відмічено. Це особиста відмітка пілота без затвердження.');
    return true;
  };
  openModal({
    title: admission ? 'Поновити допуск' : 'Внести допуск',
    content: el('form', { class: 'ef-form', novalidate: true, onSubmit: e => e.preventDefault() },
      errors,
      el('div', { class: 'ef-form-grid' },
        field('Вид допуску', kindSel).root, field('Частина доби', dn).root,
        field('Вправа', exercise).root, field('Дата внесення *', date, { hint: 'дд.мм.рррр' }).root),
      hintBox,
      notice(null, 'Допуск пілот відмічає сам. У застосунку немає затвердження чи підпису: запис не замінює паперовий документ.')),
    actions: [{ label: 'Скасувати' }, { label: admission ? 'Поновити' : 'Внести допуск', variant: 'primary', onClick: save }],
  });
}

/** Видалення відмітки допуску з підтвердженням. */
export async function removeAdmission(ctx, admission, label) {
  const yes = await confirmDialog({
    title: 'Видалити відмітку допуску?',
    message: `Буде видалено запис допуску «${label}». Якщо файл ще не збережено, дію можна скасувати закриттям файла без збереження.`,
    confirmLabel: 'Видалити', danger: true,
  });
  if (!yes) return false;
  const result = ctx.mutate(data => deleteAdmission(data, admission.id, { confirmed: true }));
  if (result.ok) toast('Відмітку допуску видалено.');
  return result.ok;
}

/** Пілот сам позначає допуск втраченим. */
export function setAdmissionLost(ctx, admission) {
  const result = ctx.mutate(data => markAdmissionLost(data, admission.id));
  if (result.ok) toast('Допуск позначено втраченим.');
  return result.ok;
}
