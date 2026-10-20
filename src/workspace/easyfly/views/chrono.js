// Хронометраж льотної зміни: екіпажі, польоти, наліт, ліміт пілотажу. Невідомі тривалості
// не розподіляються автоматично й показуються тире.
import { exerciseName, formatDate, formatDuration } from '../fly-core.js';
import { deleteFlight, effectiveSettings, shiftDates, shiftReport } from '../fly-state.js';
import {
  button, confirmDialog, dash, el, emptyState, notice, pageHeader, select, stat, table, toast,
} from '../ui.js';
import { openEntry } from './entry.js';

let selectedDate = null;

const STATE_TEXT = {
  entered: ['valid', 'Внесено'],
  limit: ['soon', 'Межа'],
  over: ['overdue', 'Понад ліміт'],
  nodata: [null, 'Немає даних'],
};

function chip(state, limit) {
  const [tone, label] = STATE_TEXT[state];
  const text = state === 'limit' ? `Межа ${limit}` : label;
  return el('span', { class: `ef-chip ef-st-${tone ?? 'none'}`, text });
}

export function render(ctx) {
  const { data, today } = ctx;
  const dates = shiftDates(data, today);
  if (!selectedDate || !dates.includes(selectedDate)) selectedDate = dates.find(d => data.shifts.some(s => s.date === d)) ?? today;
  const date = selectedDate;
  const report = shiftReport(data, date, today);
  const settings = effectiveSettings(data);
  const root = el('div', { class: 'ef-view' });

  root.append(pageHeader({
    crumbs: [{ label: 'EasyFLY' }, { label: 'Хронометраж' }],
    title: 'Хронометраж льотної зміни',
    subtitle: 'Облік нальоту екіпажів і контроль лімітів за видами польотів',
  }));

  const dateSel = select(dates.map(d => ({ value: d, label: formatDate(d) })), date, { onChange: () => { selectedDate = dateSel.value; ctx.rerender(); } });
  dateSel.setAttribute('aria-label', 'Дата льотної зміни');
  root.append(el('div', { class: 'ef-card ef-filters' },
    el('span', { class: 'ef-eyebrow', text: 'Льотна зміна' }),
    el('div', { class: 'ef-filter-row' }, dateSel,
      el('span', { class: 'ef-muted', text: data.unit.name || '' }),
      button('Додати запис', { variant: 'primary', iconName: 'vnesty', onClick: () => openEntry(ctx, { mode: 'flight', date, source: 'timekeeper' }) }))));

  if (!report.rows.length) {
    root.append(emptyState('Немає даних', `За ${formatDate(date)} записів польотів немає. Додайте запис або імпортуйте польоти з таблиці.`));
    return root;
  }

  const { summary } = report;
  root.append(el('div', { class: 'ef-stats ef-stats-3' },
    stat('Екіпажів', summary.crews),
    stat('Польотів', summary.takeoffs, { tone: 'blue' }),
    stat('Загальний наліт', summary.airtime ? summary.airtime.replace(':', ' год ') + ' хв' : '—')));

  for (const n of report.notices) {
    root.append(notice(n.title, n.text || null, { tone: n.level === 'overdue' ? 'red' : 'amber', role: 'status' }));
  }

  const columns = [
    { label: 'Екіпаж', render: r => el('strong', { text: r.flight.crew.length ? r.flight.crew[0] : dash(null) }) },
    { label: 'Інші члени екіпажу', class: 'ef-col-crew', render: r => (r.flight.crew.length > 1 ? r.flight.crew.slice(1).join(', ') : '—') },
    { label: 'Вправа', render: r => (r.flight.exercise ? `№ ${r.flight.exercise}${exerciseName(r.flight.exercise) ? ` · ${exerciseName(r.flight.exercise)}` : ''}` : '—') },
    { label: 'Кількість', render: r => el('strong', { text: String(r.flight.count) }) },
    { label: 'Час', render: r => dash(formatDuration(r.flight.airtimeMin)) },
    { label: 'Стан', render: r => chip(r.state, r.limit) },
    { label: 'Дія', class: 'ef-col-actions', render: r => button('', { variant: 'icon', iconName: 'zakryty', title: 'Видалити запис', ariaLabel: `Видалити запис екіпажу ${r.flight.crew[0] || ''}`, onClick: () => remove(ctx, r.flight) }) },
  ];
  root.append(table(columns, report.rows, {
    caption: `Записи зміни ${formatDate(date)}`,
    rowClass: r => (r.state === 'limit' || r.state === 'over' ? 'ef-row-limit' : null),
  }));
  const unknown = summary.unknownAirtime;
  root.append(notice(`Підсумок зміни: ${summary.takeoffs} польотів / ${summary.airtime || '—'}`,
    `${unknown ? `У ${unknown} записах наліт невідомий: його не розподілено й не вгадано. ` : ''}Ліміт пілотажу — не більше ${settings.aerobaticsLimit}.`));
  return root;
}

async function remove(ctx, flight) {
  const yes = await confirmDialog({
    title: 'Видалити запис польоту?',
    message: `Буде видалено запис екіпажу ${flight.crew[0] || ''} за ${formatDate(flight.date)}.`,
    confirmLabel: 'Видалити', danger: true,
  });
  if (!yes) return;
  const result = ctx.mutate(data => deleteFlight(data, flight.id, { confirmed: true }));
  if (result.ok) toast('Запис видалено.');
}
