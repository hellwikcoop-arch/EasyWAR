// Модальне вікно «Внести перевірку / політ»: перемикач «Політ» / «Перевірка». Запис пілота є
// самообліком: затвердження, підпису й погодження в застосунку немає.
import { EXERCISE_NAMES, formatDate, normalizeDate } from '../fly-core.js';
import { addFlight, entryKinds, recordCheck, updateFlight } from '../fly-state.js';
import {
  dateInput, el, errorBox, field, notice, numberInput, openModal, readDate, select, textInput, toast,
} from '../ui.js';

const ARTICLE_DIRECTIONS = [['ao', 'АО'], ['reo', 'РЕО'], ['vd_sd', 'ВД (СД)'], ['aoz', 'АОз']];

function pilotSelect(ctx, personId, { allowUnlinked = false } = {}) {
  const choices = ctx.data.persons.map(p => ({ value: p.id, label: p.callsign }));
  if (allowUnlinked) choices.unshift({ value: '', label: 'Без прив’язки до пілота' });
  return select(choices, personId ?? (allowUnlinked ? '' : ctx.data.persons[0]?.id || ''));
}

/**
 * Відкриває форму. opts: { mode: 'flight' | 'check', personId, date, kind (для перевірки),
 * lockPilot, source ('logbook' | 'timekeeper'), flightId (редагування наявного польоту) }.
 */
export function openEntry(ctx, opts = {}) {
  const editing = opts.flightId ? ctx.data.flights.find(f => f.id === opts.flightId) : null;
  if (opts.flightId && !editing) {
    toast('Запис польоту не знайдено.', 'error');
    return null;
  }
  if (!ctx.data.persons.length && !editing) {
    toast('Спочатку додайте пілота.', 'error');
    return null;
  }
  let mode = editing ? 'flight' : opts.mode === 'check' ? 'check' : 'flight';
  const errors = errorBox();
  const pilot = pilotSelect(ctx, editing ? editing.personId : opts.personId, { allowUnlinked: Boolean(editing) });
  if (opts.lockPilot) pilot.disabled = true;
  const body = el('div', { class: 'ef-entry' });
  const tabs = el('div', { class: 'ef-switch', role: 'tablist', 'aria-label': 'Вид запису' });
  const flightTab = el('button', { type: 'button', role: 'tab', class: 'ef-switch-btn', text: 'Політ' });
  const checkTab = el('button', { type: 'button', role: 'tab', class: 'ef-switch-btn', text: 'Перевірка' });
  tabs.append(flightTab, checkTab);

  // ── поля польоту
  const date = dateInput(editing?.date || opts.date || ctx.today);
  const exercise = textInput(editing?.exercise || '', { placeholder: 'Наприклад, 14', maxLength: 8 });
  exercise.setAttribute('list', 'ef-exercises');
  const exerciseList = el('datalist', { id: 'ef-exercises' },
    Object.entries(EXERCISE_NAMES).map(([n, name]) => el('option', { value: n, label: `№ ${n} · ${name}` })));
  const aircraft = textInput(editing?.aircraftType || '', { placeholder: 'Наприклад, Мі-8МТВ-1', maxLength: 30 });
  const tail = textInput(editing?.tailNumber || '', { placeholder: 'Бортовий номер', maxLength: 12 });
  const count = numberInput(editing?.count ?? 1, { min: 1, max: 99 });
  const existingAirtime = Number.isInteger(editing?.airtimeMin)
    ? `${Math.floor(editing.airtimeMin / 60)}:${String(editing.airtimeMin % 60).padStart(2, '0')}` : '';
  const airtime = textInput(existingAirtime, { placeholder: 'Г:ХХ, наприклад 1:25', inputMode: 'numeric', maxLength: 8 });
  const dayNight = select([{ value: '', label: 'Оберіть…' }, { value: 'day', label: 'День' }, { value: 'night', label: 'Ніч' }], editing?.dayNight || '');
  const preserveMeteo = editing?.meteo != null && !['ПМУ', 'СМУ'].includes(editing.meteo);
  const meteo = select([
    { value: '', label: 'Оберіть…' },
    { value: 'ПМУ', label: 'ПМУ' },
    { value: 'СМУ', label: 'СМУ' },
    ...(preserveMeteo ? [{ value: '__original__', label: 'Збережене значення (без змін)' }] : []),
  ], preserveMeteo ? '__original__' : editing?.meteo || '');
  const note = textInput(editing?.note || '', { placeholder: 'Необов’язково', maxLength: 200 });
  const crewField = textInput(Array.isArray(editing?.crew) ? editing.crew.join(', ') : '', { placeholder: 'Позивни через кому (необов’язково)', maxLength: 200 });

  // ── поля перевірки
  const kinds = () => {
    const selected = ctx.data.persons.find(p => p.id === pilot.value) || ctx.data.persons[0];
    return selected ? entryKinds(selected) : [];
  };
  const kindSel = select(kinds().map(k => ({ value: k.id, label: k.label })), opts.kind || 'medical:ВЛК');
  const direction = select(ARTICLE_DIRECTIONS.map(([value, label]) => ({ value, label })), 'ao');
  const checkDate = dateInput(opts.date || ctx.today);
  const by = textInput('', { placeholder: 'Хто проводив (необов’язково)', maxLength: 60 });
  const checkNote = textInput('', { placeholder: 'Необов’язково', maxLength: 200 });
  const directionField = field('Напрям Статті 205', direction);

  const refreshKinds = () => {
    const current = kindSel.value;
    kindSel.replaceChildren(...kinds().map(k => el('option', { value: k.id, text: k.label })));
    kindSel.value = [...kindSel.options].some(o => o.value === current) ? current : 'medical:ВЛК';
    syncCheck();
  };
  function syncCheck() {
    directionField.root.hidden = kindSel.value !== 'article205';
    by.closest('.ef-field').hidden = kindSel.value !== 'article205';
  }
  pilot.addEventListener('change', () => { refreshKinds(); });
  kindSel.addEventListener('change', syncCheck);

  const flightPane = el('div', { class: 'ef-form-grid ef-form-grid-3' },
    field('Дата *', date, { hint: 'дд.мм.рррр' }).root, field('Вправа', exercise).root, field('Кількість польотів *', count).root,
    field('Тип ПС', aircraft).root, field('Борт №', tail).root, field('Тривалість', airtime, { hint: 'Якщо невідомо, залиште порожнім' }).root,
    field('Частина доби', dayNight).root, field('Метеоумови', meteo).root, field('Характер польоту', note).root,
    field('Екіпаж', crewField, { wide: true }).root, exerciseList);
  const checkPane = el('div', { class: 'ef-form-grid ef-form-grid-3' },
    field('Вид перевірки *', kindSel).root, directionField.root, field('Дата *', checkDate, { hint: 'дд.мм.рррр' }).root,
    field('Хто проводив', by).root, field('Примітка', checkNote).root);
  const pilotRow = el('div', { class: 'ef-form-grid' }, field('Пілот', pilot).root);

  const info = notice('Запис пілота не замінює паперовий документ.', 'У застосунку немає затвердження чи підпису: дані вносить пілот сам, а паперова льотна книжка лишається юридичним оригіналом.');

  const showMode = next => {
    mode = next;
    flightPane.hidden = mode !== 'flight';
    checkPane.hidden = mode !== 'check';
    flightTab.setAttribute('aria-selected', String(mode === 'flight'));
    checkTab.setAttribute('aria-selected', String(mode === 'check'));
    flightTab.tabIndex = mode === 'flight' ? 0 : -1;
    checkTab.tabIndex = mode === 'check' ? 0 : -1;
    errors.clear();
    syncCheck();
  };
  flightTab.addEventListener('click', () => showMode('flight'));
  checkTab.addEventListener('click', () => showMode('check'));
  tabs.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const next = mode === 'flight' ? 'check' : 'flight';
      showMode(next);
      (next === 'flight' ? flightTab : checkTab).focus();
    }
  });
  body.append(tabs, errors, pilotRow, flightPane, checkPane, info);
  if (editing) {
    tabs.hidden = true;
    if (editing.source === 'import') {
      body.append(notice('Корекція імпортованого запису', 'Змінюється запис у профілі; вихідний CSV/TSV-файл не переписується.'));
    }
  }
  showMode(mode);

  const save = () => {
    errors.clear();
    const personId = pilot.value;
    if (mode === 'flight') {
      const iso = readDate(date);
      if (!iso) { errors.show('Вкажіть дату польоту у форматі дд.мм.рррр.'); return false; }
      const values = {
        personId,
        date: iso,
        exercise: exercise.value,
        count: count.value,
        airtime: airtime.value,
        dayNight: dayNight.value || null,
        ...(meteo.value === '__original__' ? {} : { meteo: meteo.value || null }),
        aircraftType: aircraft.value,
        tailNumber: tail.value,
        note: note.value,
        crew: crewField.value.split(',').map(s => s.trim()).filter(Boolean),
      };
      const result = ctx.mutate(data => editing
        ? updateFlight(data, editing.id, values)
        : addFlight(data, { ...values, source: opts.source || 'logbook' }));
      if (!result.ok) { errors.show(result.result.errors); return false; }
      toast(editing ? `Політ ${formatDate(iso)} змінено.` : `Політ ${formatDate(iso)} внесено.`);
      return true;
    }
    const iso = normalizeDate(checkDate.value);
    if (!iso) { errors.show('Вкажіть дату перевірки у форматі дд.мм.рррр.'); return false; }
    const result = ctx.mutate(data => recordCheck(data, personId, {
      kind: kindSel.value, date: iso, direction: direction.value, acceptedBy: by.value, note: checkNote.value,
    }));
    if (!result.ok) { errors.show(result.result.errors); return false; }
    toast(`Перевірку внесено (${formatDate(iso)}). Це самооблік без затвердження.`);
    return true;
  };

  return openModal({
    title: editing ? 'Змінити політ' : 'Внести перевірку / політ',
    content: body,
    wide: true,
    actions: [{ label: 'Скасувати' }, { label: editing ? 'Зберегти зміни' : 'Зберегти запис', variant: 'primary', onClick: save }],
  });
}
