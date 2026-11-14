// «Польоти»: список льотних змін і запис вправи в книжку. Чернетка живе лише на екрані;
// у файл .easyfly потрапляє після підтвердження через addFlight (зміна за датою створюється сама).
// Окремої колекції «план / виконано» у схемі немає — це й є межа моделі.
import { formatDate, formatDuration } from '../fly-core.js';
import { pluralFlights } from '../glow-core.js';
import { addFlight, deleteFlight, shiftReport } from '../fly-state.js';
import { button, confirmDialog, el, field, select, toast } from '../ui.js';

let mode = 'list';
let day = null;
let draft = null;
let appliedDate = undefined;

function blankDraft(today) {
  return { date: today || '', personId: '', dayNight: 'day', crew: '', exercise: '', count: '1', airtime: '' };
}

function shiftRows(data) {
  return [...(data.shifts || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function render(ctx) {
  const { today } = ctx;
  const asked = ctx.route?.params?.date || null;
  if (asked !== appliedDate) {
    appliedDate = asked;
    if (asked) { day = asked; mode = 'day'; }
    else if (mode === 'day') mode = 'list';
  }
  if (!draft) draft = blankDraft(today);
  const root = el('div', { class: 'ef-view ef-flights' });
  if (mode === 'form') root.append(formScreen(ctx));
  else if (mode === 'day') root.append(dayScreen(ctx, day || today));
  else root.append(listScreen(ctx));
  return root;
}

function openDay(ctx, date) {
  day = date;
  mode = 'day';
  appliedDate = date;
  ctx.go('flights', { date });
}

function listScreen(ctx) {
  const rows = shiftRows(ctx.data);
  const latest = rows[0];
  const report = latest ? shiftReport(ctx.data, latest.date, ctx.today) : null;
  const air = report && !report.summary.unknownAirtime ? report.summary.airtime : null;
  return el('div', { class: 'ef-stack' },
    el('header', { class: 'ef-today-head' },
      el('h1', { text: 'Польоти' }),
      button('Льотна зміна', { variant: 'primary', onClick: () => { draft = blankDraft(ctx.today); mode = 'form'; ctx.rerender(); } })),
    report
      ? el('section', { class: 'ef-glow-card' },
        el('div', { class: 'ef-glow-card-head' },
          el('h2', { text: latest.date === ctx.today ? 'Сьогодні' : formatDate(latest.date) }),
          el('span', { class: 'ef-glow-pill', text: formatDate(latest.date) })),
        el('div', { class: 'ef-state-counts' },
          el('span', {}, el('strong', { text: String(report.summary.crews) }), 'екіпажів'),
          el('span', {}, el('strong', { text: String(report.summary.takeoffs) }), pluralFlights(report.summary.takeoffs)),
          el('span', {}, el('strong', { text: air || '—' }), 'наліт зміни')),
        el('button', { type: 'button', class: 'ef-ban-row', onClick: () => openDay(ctx, latest.date) },
          el('span', { class: 'ef-ban-who' }, el('strong', { text: 'Переглянути зміну' })),
          el('span', { class: 'ef-shift-go', 'aria-hidden': 'true', text: '›' })))
      : el('p', { class: 'ef-today-empty', text: 'Змін ще немає. «Льотна зміна» запише вправу й створить зміну на обрану дату.' }),
    rows.length > 1
      ? el('div', { class: 'ef-glow-card' },
        el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Льотні зміни' })),
        rows.slice(1).map(shift => {
          const item = shiftReport(ctx.data, shift.date, ctx.today);
          const count = item.summary.takeoffs;
          const itemAir = item.summary.unknownAirtime ? null : item.summary.airtime;
          return el('button', {
            type: 'button', class: 'ef-ban-row',
            onClick: () => openDay(ctx, shift.date),
          },
          el('span', { class: 'ef-ban-who' },
            el('strong', { text: shift.name || `Льотна зміна ${formatDate(shift.date)}` }),
            el('span', { text: `${count} ${pluralFlights(count)}${itemAir ? ` · ${itemAir}` : ''}` })),
          el('span', { class: 'ef-shift-go', 'aria-hidden': 'true', text: '›' }));
        }))
      : null);
}

function dayScreen(ctx, date) {
  const report = shiftReport(ctx.data, date, ctx.today);
  const byCrew = new Map();
  for (const row of report.rows) {
    const crew = (row.flight.crew || []).join(', ') || 'без екіпажу';
    const list = byCrew.get(crew) || [];
    list.push(row);
    byCrew.set(crew, list);
  }
  return el('div', { class: 'ef-stack' },
    el('header', { class: 'ef-today-head' },
      button('Назад', { variant: 'ghost', onClick: () => { mode = 'list'; ctx.rerender(); } }),
      el('h1', { text: formatDate(date) || 'Зміна' })),
    el('p', { class: 'ef-glow-quiet', text: `${report.summary.takeoffs} ${pluralFlights(report.summary.takeoffs)} · екіпажів ${report.summary.crews}${report.summary.airtime ? ` · наліт ${report.summary.airtime}` : ''}` }),
    [...byCrew.entries()].map(([crew, rows]) => el('section', { class: 'ef-glow-card' },
      el('div', { class: 'ef-glow-card-head' }, el('h2', { text: crew })),
      rows.map(row => el('div', { class: 'ef-ban-row ef-flight-row' },
        el('span', { class: 'ef-ban-who' },
          el('strong', { text: row.flight.exercise ? `Вправа ${row.flight.exercise}` : 'Без номера вправи' }),
          el('span', { text: `${row.flight.count} ${pluralFlights(row.flight.count)}${Number.isInteger(row.flight.airtimeMin) ? ` · ${formatDuration(row.flight.airtimeMin)}` : ' · наліт не внесено'}` })),
        button('Прибрати', { variant: 'ghost', small: true, onClick: () => removeFlight(ctx, row.flight) }))))),
    button('Додати вправу', { variant: 'primary', onClick: () => { draft = { ...blankDraft(date), date }; mode = 'form'; ctx.rerender(); } }));
}

async function removeFlight(ctx, flight) {
  const ok = await confirmDialog({
    title: 'Прибрати з льотної книжки?',
    message: `Запис${flight.exercise ? ` вправи ${flight.exercise}` : ''} за ${formatDate(flight.date) || 'цю дату'} буде видалено з даних.`,
    confirmLabel: 'Прибрати',
    danger: true,
  });
  if (!ok) return;
  const result = ctx.mutate(data => deleteFlight(data, flight.id, { confirmed: true }));
  if (!result.ok) toast(result.result?.errors?.[0] || 'Не вдалося прибрати запис.', 'error');
}

function formScreen(ctx) {
  const persons = ctx.data.persons || [];
  const pilot = select(persons.map(p => ({ value: p.id, label: p.callsign })), draft.personId, { onChange: () => { draft.personId = pilot.value; } });
  const dn = select([{ value: 'day', label: 'День' }, { value: 'night', label: 'Ніч' }], draft.dayNight, { onChange: () => { draft.dayNight = dn.value; } });
  const date = el('input', { class: 'ef-input', type: 'date', value: draft.date, 'aria-label': 'Дата зміни', onChange: () => { draft.date = date.value; } });
  const crew = el('input', { class: 'ef-input', value: draft.crew, placeholder: 'позивні через кому', 'aria-label': 'Екіпаж', onInput: () => { draft.crew = crew.value; } });
  const exercise = el('input', { class: 'ef-input', value: draft.exercise, placeholder: '14', 'aria-label': 'Номер вправи', onInput: () => { draft.exercise = exercise.value; } });
  const count = el('input', { class: 'ef-input', inputmode: 'numeric', value: draft.count, 'aria-label': 'Кількість польотів', onInput: () => { draft.count = count.value; } });
  const airtime = el('input', { class: 'ef-input', value: draft.airtime, placeholder: '1:25', 'aria-label': 'Наліт год:хв', onInput: () => { draft.airtime = airtime.value; } });
  const error = el('p', { class: 'ef-form-error', role: 'alert' });
  return el('div', { class: 'ef-stack' },
    el('header', { class: 'ef-today-head' },
      button('Назад', { variant: 'ghost', onClick: () => { mode = day ? 'day' : 'list'; ctx.rerender(); } }),
      el('h1', { text: 'Льотна зміна' })),
    el('p', { class: 'ef-glow-quiet', text: 'Вправу, екіпаж і наліт буде записано в льотну книжку після підтвердження. Поки не підтвердите — у файлі нічого не змінюється.' }),
    el('div', { class: 'ef-glow-card ef-flight-form' },
      field('Дата', date),
      field('Пілот', pilot),
      field('День чи ніч', dn),
      field('Екіпаж', crew, { hint: 'Позивні інших членів. Позивний пілота додасться сам.' }),
      field('Вправа', exercise),
      field('Польотів', count),
      field('Наліт', airtime, { hint: 'Год:хв. Порожнє — наліт невідомий, сума його не вигадує.' }),
      error,
      button('Записати в книжку', { variant: 'primary', onClick: () => save(ctx, error) })));
}

async function save(ctx, error) {
  error.textContent = '';
  const person = (ctx.data.persons || []).find(p => p.id === draft.personId);
  if (!person) { error.textContent = 'Оберіть пілота.'; return; }
  const crew = draft.crew.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  const exercise = draft.exercise.trim();
  const ok = await confirmDialog({
    title: 'Записати в льотну книжку?',
    message: `${person.callsign}: ${exercise ? `вправа ${exercise}` : 'без номера вправи'}, ${draft.count || 1} за ${draft.date || 'дату'}. Після підтвердження запис стає даними файлу.`,
    confirmLabel: 'Записати',
  });
  if (!ok) return;
  const result = ctx.mutate(data => addFlight(data, {
    personId: person.id,
    date: draft.date,
    dayNight: draft.dayNight,
    crew,
    exercise: exercise || null,
    count: draft.count,
    airtime: draft.airtime.trim() || undefined,
    source: 'logbook',
  }));
  if (!result.ok) {
    error.textContent = (result.result?.errors || ['Не вдалося записати.']).join(' ');
    return;
  }
  day = draft.date;
  draft = blankDraft(ctx.today);
  mode = 'day';
  toast('Записано в льотну книжку');
  ctx.rerender();
}
