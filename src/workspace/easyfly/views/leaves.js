// Екран «Відпустки»: графік відпусток частини за рік (сітка пілот × місяць), перелік із
// застереженнями (частина довша за 15 діб, перетин, менше 3 місяців після попередньої) і
// підказкою, коли ставити ВЛК/ПМО. Дані вносить користувач; без затвердження й наказів.
import { LEAVE_STATUS_LABELS, formatDate } from '../fly-core.js';
import { leaveSchedule, leaveYears } from '../fly-state.js';
import { button, dateText, el, emptyState, notice, pageHeader, select, stat, statusChip, table } from '../ui.js';
import { icon } from '../icons.js';
import { medicalText, openLeaveForm, removeLeave } from './leaves-form.js';

const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
let selectedYear = null;

/** Рік за умовчанням: поточний; якщо за нього відпусток немає, а за наступний є — наступний. */
export function defaultYear(data, today) {
  const year = today.slice(0, 4);
  const next = String(Number(year) + 1);
  const has = y => (data.leaves || []).some(l => String(l.from || '').startsWith(y));
  return !has(year) && has(next) ? next : year;
}

/** Колонки переліку відпусток; withPilot — показувати позивний (екран частини). */
export function leaveColumns(ctx, { withPilot = true } = {}) {
  const columns = [];
  if (withPilot) {
    columns.push({ label: 'Пілот', render: r => el('button', { type: 'button', class: 'ef-link', onClick: () => ctx.go('pilot', { id: r.personId, tab: 'leaves' }), text: r.callsign }) });
  }
  columns.push(
    { label: 'Вид', render: r => el('strong', { text: r.kind?.label || r.leave.kind }) },
    { label: 'З', render: r => dateText(r.leave.from) },
    { label: 'По', render: r => dateText(r.leave.to) },
    { label: 'Діб', render: r => (r.days === null ? '—' : String(r.days)) },
    { label: 'Стан', render: r => el('span', { class: `ef-pill${r.status === 'taken' ? ' ef-pill-green' : r.status === 'approved' ? ' ef-pill-amber' : ''}`, text: LEAVE_STATUS_LABELS[r.status] || r.status }) },
    { label: 'ВЛК / ПМО', render: r => {
      const text = medicalText(r.medical);
      if (!text) return el('span', { class: 'ef-muted', text: 'медичних дат немає' });
      return el('span', { class: r.medical.near ? 'ef-text-soon' : 'ef-muted', text });
    } },
    { label: 'Застереження', render: r => (r.warnings.length
      ? el('ul', { class: 'ef-warn-list' }, r.warnings.map(w => el('li', { class: 'ef-text-overdue', text: w })))
      : el('span', { class: 'ef-muted', text: r.gapMonths !== null ? `через ${r.gapMonths} міс. після попередньої` : (r.leave.note || '—') })) },
    { label: 'Дія', class: 'ef-col-actions', render: r => el('span', { class: 'ef-row-actions' },
      button('Змінити', { variant: 'link', onClick: () => openLeaveForm(ctx, { leave: r.leave }), ariaLabel: `Змінити відпустку ${r.callsign} ${formatDate(r.leave.from)}` }),
      button('', { variant: 'icon', iconName: 'zakryty', title: 'Видалити', ariaLabel: `Видалити відпустку ${r.callsign} ${formatDate(r.leave.from)}`, onClick: () => removeLeave(ctx, r) })) },
  );
  return columns;
}

function monthGrid(ctx, schedule) {
  const head = el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Пілот' }), MONTHS.map(m => el('th', { scope: 'col', class: 'ef-month-col', text: m })), el('th', { scope: 'col', text: 'Разом' })));
  const body = el('tbody', {}, schedule.grid.map(row => el('tr', {},
    el('th', { scope: 'row' }, el('button', { type: 'button', class: 'ef-link', onClick: () => ctx.go('pilot', { id: row.personId, tab: 'leaves' }), text: row.callsign })),
    row.months.map(items => el('td', { class: `ef-month-col${items.length ? ' ef-month-busy' : ''}` },
      items.map(r => el('span', {
        class: `ef-leave-mark ef-leave-${r.leave.kind}${r.warnings.length ? ' ef-leave-warn' : ''}`,
        title: `${r.kind.label}: ${formatDate(r.leave.from)}–${formatDate(r.leave.to)}${r.warnings.length ? ` · ${r.warnings.join(' ')}` : ''}`,
        text: `${r.kind.short} ${r.leave.from.slice(8)}–${r.leave.to.slice(8)}`,
      })))),
    el('td', { text: `${row.totals.basicDays + row.totals.ubdDays + row.totals.otherDays} діб` }))));
  return el('div', { class: 'ef-table-wrap ef-leave-grid' }, el('table', { class: 'ef-table' }, el('caption', { class: 'ef-sr', text: `Графік відпусток за ${schedule.year} рік` }), head, body));
}

export function render(ctx) {
  const { data, today } = ctx;
  const years = leaveYears(data, today);
  if (!selectedYear || !years.includes(selectedYear)) selectedYear = defaultYear(data, today);
  const schedule = leaveSchedule(data, selectedYear, today);
  const root = el('div', { class: 'ef-view' });
  const yearSel = select(years, selectedYear, { onChange: () => { selectedYear = yearSel.value; ctx.rerender(); } });
  yearSel.setAttribute('aria-label', 'Рік графіка');
  root.append(pageHeader({
    crumbs: [{ label: 'EasyFLY' }, { label: 'Відпустки' }],
    title: `Графік відпусток · ${schedule.year}`,
    actions: [yearSel, button('Додати відпустку', { variant: 'primary', iconName: 'vnesty', onClick: () => openLeaveForm(ctx) })],
  }));
  if (!data.persons.length) {
    root.append(emptyState('Немає пілотів', 'Додайте пілотів у «Мої пілоти», потім плануйте відпустки.', button('До пілотів', { variant: 'primary', onClick: () => ctx.go('pilots') })));
    return root;
  }
  root.append(el('div', { class: 'ef-stats' },
    stat('У відпустках', `${schedule.pilots} ${schedule.pilots === 1 ? 'пілот' : schedule.pilots >= 2 && schedule.pilots <= 4 ? 'пілоти' : 'пілотів'}`, { tone: schedule.pilots ? 'blue' : '' }),
    stat('Записів', String(schedule.rows.length)),
    stat('Діб разом', String(schedule.totalDays)),
    stat('Застережень', String(schedule.warningsCount), { tone: schedule.warningsCount ? 'red' : 'green' })));
  if (!schedule.rows.length) {
    root.append(emptyState('Відпусток за цей рік ще немає', 'Натисніть «Додати відпустку»: пілот, вид (основна, УБД, інша), дати з–по, стан.'));
  } else {
    root.append(el('section', { class: 'ef-card' },
      el('div', { class: 'ef-card-head' },
        el('h2', { class: 'ef-card-title', text: 'За місяцями' }),
        el('span', { class: 'ef-muted', text: 'Осн. — основна · УБД · Інша · червона рамка — є застереження' })),
      monthGrid(ctx, schedule)));
    root.append(el('section', { class: 'ef-card' },
      el('h2', { class: 'ef-card-title', text: 'Перелік' }),
      table(leaveColumns(ctx), schedule.rows, { caption: `Відпустки за ${schedule.year} рік`, rowClass: r => (r.warnings.length ? 'ef-row-lost' : null) })));
  }
  root.append(notice(null, `ВЛК — раз на рік, ПМО — раз на 6 місяців: у стовпці «ВЛК / ПМО» показано найближчий строк біля відпустки (${schedule.medicalCount} ${schedule.medicalCount === 1 ? 'запис потребує' : 'записів потребують'} уваги). Дані внесено вручну: графік не замінює наказ і рапорти.`));
  root.append(el('div', { class: 'ef-alert ef-alert-outline' }, icon('kalendar', 16), ' Про відпустку кожного пілота окремо — вкладка «Відпустки» в його профілі.'));
  return root;
}
