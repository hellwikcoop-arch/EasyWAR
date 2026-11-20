// Живий хронометраж польоту. Після підтвердження дня — підсумок нальоту і палива.
import { EXERCISE_NAMES, formatDate, formatDuration } from '../fly-core.js';
import { confirmTiming, logTimingEvent, openTiming, patchTimingEvent, setTimingMeta } from '../fly-state.js';
import { FUEL_AIR_L_PER_MIN, FUEL_GROUND_L_PER_MIN, clockText, timingDaySummary, timingFlights } from '../timing-core.js';
import { button, dateInput, el, field, numberInput, readDate, select, textInput, toast } from '../ui.js';

const KIND_LABEL = {
  start: 'Запуск', takeoff: 'Зліт', landing: 'Посадка', shutdown: 'Вимкнення', note: 'Примітка',
};

let chosenDate = '';
let personId = '';
let timer = 0;

function flightCaption(timing) {
  const flights = timingFlights(timing);
  const open = flights.find(flight => flight.takeoff && !flight.landing);
  if (open) return `Політ ${open.number}`;
  const last = flights.at(-1);
  return last ? `Наступний політ ${last.number + 1}` : 'Політ 1';
}

function liters(value) {
  return `${value.toFixed(1)} л`;
}

function summaryCard(timing) {
  const summary = timingDaySummary(timing);
  const line = (label, value) => el('div', { class: 'ef-ke-row' },
    el('span', { class: 'ef-ban-who' }, el('strong', { text: label })),
    el('span', { text: value }));
  return el('section', { class: 'ef-glow-card', 'data-ef': 'day-summary' },
    el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Підсумок дня' })),
    line('Польотів', String(summary.flights)),
    line('Наліт повітря', formatDuration(summary.airMin) || '0:00'),
    line('Земля, запуск–зліт', formatDuration(summary.groundBefore) || '0:00'),
    line('Земля, після посадки', formatDuration(summary.groundAfter) || '0:00'),
    line('Наліт загальний', formatDuration(summary.totalMin) || '0:00'),
    line('Паливо в повітрі', `${liters(summary.fuelAir)} · ${FUEL_AIR_L_PER_MIN} л/хв`),
    line('Паливо на землі', `${liters(summary.fuelGround)} · ${FUEL_GROUND_L_PER_MIN} л/хв`),
    line('Паливо разом', liters(summary.fuel)),
    summary.passengers === null ? null : line('Пасажири', String(summary.passengers)),
    summary.remark ? line('Примітка', summary.remark) : null);
}

export function render(ctx) {
  window.clearInterval(timer);
  if (!chosenDate) chosenDate = ctx.today;
  const persons = ctx.data.persons || [];
  if (!personId || !persons.some(person => person.id === personId)) personId = persons[0]?.id || '';
  const date = readDate({ value: chosenDate }) || chosenDate;
  const day = (ctx.data.timings || []).filter(item => item.date === date);
  const timing = day.find(item => item.status === 'open') || day.at(-1) || null;
  const confirmed = timing?.status === 'confirmed';
  const exercise = textInput(timing?.exercise || '', { maxLength: 8 });
  exercise.setAttribute('list', 'ef-timing-exercises');
  const passengers = numberInput(timing?.passengers ?? '', { min: 0, max: 99 });
  const remark = textInput(timing?.remark || '', { maxLength: 200 });
  const dayNight = select([{ value: 'day', label: 'День' }, { value: 'night', label: 'Ніч' }], timing?.dayNight === 'night' ? 'night' : 'day');
  const note = textInput('', { maxLength: 120 });
  const dateField = dateInput(date);
  dateField.addEventListener('change', () => {
    chosenDate = readDate(dateField) || ctx.today;
    ctx.rerender();
  });

  const meta = () => ({
    exercise: exercise.value,
    passengers: passengers.value,
    remark: remark.value,
    dayNight: dayNight.value,
  });
  const saveMeta = () => {
    if (confirmed) return;
    const opened = ctx.mutate(data => openTiming(data, date));
    if (!opened.ok) { toast(opened.result.errors.join(' '), 'error'); return; }
    const result = ctx.mutate(data => setTimingMeta(data, opened.result.id, meta()));
    if (!result.ok) toast(result.result.errors.join(' '), 'error');
  };
  for (const input of [exercise, passengers, remark, dayNight]) input.addEventListener('change', saveMeta);

  const stamp = kind => {
    const result = ctx.mutate(data => logTimingEvent(data, date, {
      kind, at: clockText(), text: note.value, exercise: exercise.value,
    }));
    if (!result.ok) toast(result.result.errors.join(' '), 'error');
    else ctx.mutate(data => setTimingMeta(data, result.result.id, meta()));
  };

  const clock = el('p', { class: 'ef-clock', 'aria-live': 'polite', text: clockText() });
  timer = window.setInterval(() => {
    if (!clock.isConnected) { window.clearInterval(timer); return; }
    clock.textContent = clockText();
  }, 1000);

  let personField = null;
  if (persons.length > 1) {
    const pilotSelect = select(persons.map(person => ({ value: person.id, label: person.callsign })), personId);
    pilotSelect.addEventListener('change', () => { personId = pilotSelect.value; });
    personField = field('Пілот для книжки', pilotSelect).root;
  }

  const events = (timing?.events || []).map(event => {
    const time = textInput(event.at, { inputMode: 'numeric', maxLength: 8 });
    time.setAttribute('aria-label', `Час: ${KIND_LABEL[event.kind]}`);
    time.disabled = confirmed;
    time.addEventListener('change', () => {
      if (!timing) return;
      ctx.mutate(data => patchTimingEvent(data, timing.id, event.id, { at: time.value }));
    });
    return el('div', { class: 'ef-ke-row' },
      el('span', { class: 'ef-ban-who' },
        el('strong', { text: `${KIND_LABEL[event.kind] || event.kind} · політ ${event.flight || 1}` }),
        event.text ? el('span', { text: event.text }) : null),
      time);
  });

  return el('div', { class: 'ef-view ef-timing' },
    el('header', { class: 'ef-today-head' },
      el('h1', { text: 'Хронометраж' }),
      el('span', { class: 'ef-today-date', text: formatDate(date) || '' })),
    el('section', { class: 'ef-glow-card' },
      field('Дата', dateField).root,
      personField,
      field('Номер вправи', exercise).root,
      el('datalist', { id: 'ef-timing-exercises' },
        Object.entries(EXERCISE_NAMES).map(([code, name]) => el('option', { value: code, label: name }))),
      field('Пасажири', passengers).root,
      field('Примітка', remark).root,
      field('День / ніч', dayNight).root,
      clock,
      el('p', { class: 'ef-glow-quiet', text: timing ? flightCaption(timing) : 'Політ 1' }),
      confirmed
        ? el('p', { class: 'ef-glow-quiet', text: 'День підтверджено: виконання польотних завдань' })
        : el('div', { class: 'ef-timing-actions' },
          button('Запуск', { onClick: () => stamp('start') }),
          button('Зліт', { variant: 'primary', onClick: () => stamp('takeoff') }),
          button('Посадка', { onClick: () => stamp('landing') }),
          button('Вимкнення', { onClick: () => stamp('shutdown') }),
          field('Мітка примітки', note).root,
          button('Примітка', { onClick: () => stamp('note') })),
      timing && !confirmed
        ? button('Підтвердити день', {
          variant: 'primary',
          onClick: () => {
            const opened = timing || ctx.mutate(data => openTiming(data, date)).result;
            const id = timing?.id || opened?.id;
            const result = ctx.mutate(data => confirmTiming(data, id, personId || null, meta()));
            if (!result.ok) toast(result.result.errors.join(' '), 'error');
          },
        })
        : null),
    confirmed && timing ? summaryCard(timing) : null,
    events.length
      ? el('section', { class: 'ef-glow-card' },
        el('div', { class: 'ef-glow-card-head' }, el('h2', { text: confirmed ? 'Підтверджено' : 'Перевірка перед підтвердженням' })),
        ...events)
      : el('p', { class: 'ef-glow-quiet', text: 'Міток ще немає. Запуск, зліт, посадка і вимкнення пишуть поточний час.' }));
}
