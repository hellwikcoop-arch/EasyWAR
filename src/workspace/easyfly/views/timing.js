// Живий хронометраж польоту: годинник, мітки запуску, зльоту, посадки, вимкнення і примітки.
// Підтверджений день отримує примітку «виконання польотних завдань» і пишеться в книжку.
import { EXERCISE_NAMES, formatDate } from '../fly-core.js';
import { confirmTiming, logTimingEvent, patchTimingEvent, setTimingExercise } from '../fly-state.js';
import { clockText, timingFlights } from '../timing-core.js';
import { button, dateInput, el, field, readDate, select, textInput, toast } from '../ui.js';

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

export function render(ctx) {
  window.clearInterval(timer);
  if (!chosenDate) chosenDate = ctx.today;
  const persons = ctx.data.persons || [];
  if (!personId || !persons.some(person => person.id === personId)) personId = persons[0]?.id || '';
  const date = readDate({ value: chosenDate }) || chosenDate;
  const day = (ctx.data.timings || []).filter(item => item.date === date);
  const timing = day.find(item => item.status === 'open') || day.at(-1) || null;
  const confirmed = timing?.status === 'confirmed';
  const exercise = textInput(timing?.exercise || '', { placeholder: '14, БП або СБП', maxLength: 8 });
  exercise.setAttribute('list', 'ef-timing-exercises');
  const note = textInput('', { placeholder: 'Текст примітки', maxLength: 120 });
  const dateField = dateInput(date);
  dateField.addEventListener('change', () => {
    chosenDate = readDate(dateField) || dateField.value;
    ctx.rerender();
  });

  const stamp = kind => {
    const result = ctx.mutate(data => logTimingEvent(data, date, {
      kind, at: clockText(), text: note.value, exercise: exercise.value,
    }));
    if (!result.ok) toast(result.result.errors.join(' '), 'error');
    else if (exercise.value) ctx.mutate(data => setTimingExercise(data, result.result.id, exercise.value));
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
      field('Вправа', exercise).root,
      el('datalist', { id: 'ef-timing-exercises' },
        Object.entries(EXERCISE_NAMES).map(([code, name]) => el('option', { value: code, label: name }))),
      clock,
      el('p', { class: 'ef-glow-quiet', text: timing ? flightCaption(timing) : 'Політ 1' }),
      confirmed
        ? el('p', { class: 'ef-glow-quiet', text: 'День підтверджено: виконання польотних завдань' })
        : el('div', { class: 'ef-timing-actions' },
          button('Запуск', { onClick: () => stamp('start') }),
          button('Зліт', { variant: 'primary', onClick: () => stamp('takeoff') }),
          button('Посадка', { onClick: () => stamp('landing') }),
          button('Вимкнення', { onClick: () => stamp('shutdown') }),
          field('Примітка', note).root,
          button('Примітка', { onClick: () => stamp('note') })),
      timing && !confirmed
        ? button('Підтвердити день', {
          variant: 'primary',
          onClick: () => {
            const result = ctx.mutate(data => confirmTiming(data, timing.id, personId || null));
            if (!result.ok) toast(result.result.errors.join(' '), 'error');
          },
        })
        : null),
    events.length
      ? el('section', { class: 'ef-glow-card' },
        el('div', { class: 'ef-glow-card-head' }, el('h2', { text: confirmed ? 'Підтверджено' : 'Перевірка перед підтвердженням' })),
        ...events)
      : el('p', { class: 'ef-glow-quiet', text: 'Міток ще немає. Запуск, зліт, посадка і вимкнення пишуть поточний час.' }));
}
