// Зведення: лічильники строків (прострочено / скоро / дійсно), перелік проблем, найближчі 30 днів.
import { formatDate } from '../fly-core.js';
import { effectiveSettings, pluralEvents, summaryView } from '../fly-state.js';
import { el, emptyState, button, notice, select, statusChip, table, dateText } from '../ui.js';
import { openPilotForm } from './card.js';
import { routeBoard } from './route-board.js';

const PROBLEM_LIMIT = 8;
let showAll = false;
const filter = { link: '', role: '' };

function counter(label, value, tone, hint) {
  return el('div', { class: `ef-counter ef-tone-${tone}` },
    el('span', { class: 'ef-counter-label', text: label }),
    el('strong', { class: 'ef-counter-value', text: String(value) }),
    hint ? el('span', { class: 'ef-counter-hint', text: hint }) : null);
}

function stateText(item) {
  const left = item.daysLeft;
  if (left === null) return '';
  return item.status === 'overdue' ? `Прострочено · ${-left} дн.` : `${item.status === 'soon' ? 'Скоро' : 'Дійсно'} · ${left} дн.`;
}

export function render(ctx) {
  const { data, today } = ctx;
  const settings = effectiveSettings(data);
  const root = el('div', { class: 'ef-view' });
  const summary = data.persons.length ? summaryView(data, today, filter) : null;
  root.append(routeBoard(ctx, summary));

  if (!data.persons.length) {
    root.append(emptyState('Немає даних', 'Додайте пілотів, щоб бачити строки перевірок, або відкрийте демо-дані.',
      button('Додати пілота', { variant: 'primary', iconName: 'vnesty', onClick: () => openPilotForm(ctx) })));
    return root;
  }

  const { counters } = summary;

  if (summary.blocked.length) {
    root.append(notice(`Польоти заборонені: ${summary.blocked.map(b => b.callsign).join(', ')}`,
      'Прострочені строки блокують допуск до польотів. Деталі — у профілі пілота.', { tone: 'red', role: 'status' }));
  }

  root.append(el('div', { class: 'ef-counters' },
    counter('Прострочено', counters.overdue, 'red', null),
    counter(`Скоро · ≤ ${settings.soonDays} днів`, counters.soon, 'amber', null),
    counter('Дійсно', counters.valid, 'green', null)));

  const problems = summary.problems;
  const visible = showAll ? problems : problems.slice(0, PROBLEM_LIMIT);
  const attention = el('section', { class: 'ef-card ef-attention', 'aria-labelledby': 'ef-att-title' },
    el('h2', { id: 'ef-att-title', class: 'ef-card-title', text: 'Потребують уваги' }),
    problems.length
      ? table([
        { label: 'Пілот', render: i => el('button', { type: 'button', class: 'ef-link', onClick: () => ctx.go('pilot', { id: i.personId }), text: i.callsign }) },
        { label: 'Перевірка', render: i => i.label },
        { label: 'Стан', render: i => statusChip(i.status, stateText(i)) },
      ], visible, { caption: 'Строки, що потребують уваги', onRow: i => ctx.go('pilot', { id: i.personId }) })
      : el('p', { class: 'ef-muted', text: 'Прострочених і близьких строків немає.' }),
    problems.length > PROBLEM_LIMIT
      ? button(showAll ? 'Показати менше' : `Показати всі (${problems.length})`, { variant: 'ghost', onClick: () => { showAll = !showAll; ctx.rerender(); } })
      : null);

  const upcoming = el('section', { class: 'ef-card ef-upcoming', 'aria-labelledby': 'ef-up-title' },
    el('h2', { id: 'ef-up-title', class: 'ef-card-title', text: 'Найближчі 30 днів' }),
    el('div', { class: 'ef-buckets' }, summary.buckets.map(bucket => {
      const body = el('details', { class: 'ef-bucket' },
        el('summary', {},
          el('span', { class: 'ef-bucket-range', text: bucket.label }),
          el('span', { class: `ef-bucket-count${bucket.items.length ? ' ef-tone-amber' : ''}`, text: bucket.items.length ? pluralEvents(bucket.items.length) : 'подій немає' })),
        bucket.items.length
          ? el('ul', { class: 'ef-bucket-list' }, bucket.items.map(i => el('li', {},
            el('button', { type: 'button', class: 'ef-link', onClick: () => ctx.go('pilot', { id: i.personId }), text: `${i.callsign} · ${i.label}` }),
            el('span', { class: 'ef-muted', text: ` ${dateText(i.dueDate)}` }))))
          : null);
      if (!bucket.items.length) body.classList.add('ef-bucket-empty');
      return body;
    })));

  root.append(el('div', { class: 'ef-split' }, attention, upcoming));

  const linkSel = select([{ value: '', label: 'Усі ланки' }, ...summary.links.map(l => ({ value: l, label: l }))], filter.link, { onChange: () => { filter.link = linkSel.value; ctx.rerender(); } });
  const roleSel = select([{ value: '', label: 'Усі ролі' }, ...['КЕ', 'ЛШ', 'Борттехнік'].map(r => ({ value: r, label: r }))], filter.role, { onChange: () => { filter.role = roleSel.value; ctx.rerender(); } });
  linkSel.setAttribute('aria-label', 'Фільтр за ланкою');
  roleSel.setAttribute('aria-label', 'Фільтр за роллю');
  root.append(el('div', { class: 'ef-filterbar' },
    el('span', { class: 'ef-muted', text: 'Фільтр:' }), linkSel, roleSel,
    el('span', { class: 'ef-muted', text: `локальний стан на ${formatDate(today)}` })));
  return root;
}
