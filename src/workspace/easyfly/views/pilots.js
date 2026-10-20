// Мої пілоти: таблиця з фільтрами ланка / роль / пошук за позивним і статусами строків.
import { CLASS_LABELS, ROLES, formatDate } from '../fly-core.js';
import { filterPilots, pilotOverview } from '../fly-state.js';
import {
  button, dash, dateText, el, emptyState, pageHeader, select, stat, statusDot, textInput,
} from '../ui.js';
import { openPilotForm } from './card.js';

const filter = { link: '', role: '', query: '' };

const COLUMNS = [
  ['medical', 'ВЛК/ПМО'], ['article205', '205'], ['ovp', 'ОВП'], ['technique', 'ТП'],
  ['instruments', 'Прил.'], ['gmv', 'ГМВ'], ['jumps', 'Параш.'],
];

const FULL_NAMES = {
  medical: 'ВЛК/ПМО', article205: 'Стаття 205', ovp: 'ОВП', technique: 'Техніка пілотування',
  instruments: 'Прилади', gmv: 'БЗ і навігація на ГМВ', jumps: 'Стрибки з парашутом',
};

function classText(person) {
  return person.classQual && person.classQual !== 'none' ? CLASS_LABELS[person.classQual].replace('-й клас', '') : '—';
}

export function render(ctx) {
  const { data, today } = ctx;
  const root = el('div', { class: 'ef-view' });
  root.append(pageHeader({
    crumbs: [{ label: 'EasyFLY' }, { label: 'Мої пілоти' }],
    title: 'Мої пілоти',
    subtitle: 'Особовий склад частини · самооблік строків і допусків',
    actions: [button('Додати пілота', { variant: 'primary', iconName: 'vnesty', onClick: () => openPilotForm(ctx) })],
  }));

  if (!data.persons.length) {
    root.append(emptyState('Немає даних', 'У файлі ще немає пілотів. Додайте пілота вручну або імпортуйте польоти.',
      button('Додати пілота', { variant: 'primary', iconName: 'vnesty', onClick: () => openPilotForm(ctx) })));
    return root;
  }

  const allRows = data.persons.map(p => pilotOverview(p, data, today));
  const links = [...new Set(data.persons.map(p => p.link).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));

  const linkSel = select([{ value: '', label: 'Усі ланки' }, ...links.map(l => ({ value: l, label: l }))], filter.link, { onChange: () => { filter.link = linkSel.value; ctx.rerender(); } });
  const roleSel = select([{ value: '', label: 'Усі ролі' }, ...ROLES.map(r => ({ value: r, label: r }))], filter.role, { onChange: () => { filter.role = roleSel.value; ctx.rerender(); } });
  const search = textInput(filter.query, { placeholder: 'Пошук за позивним', maxLength: 40 });
  search.type = 'search';
  search.addEventListener('input', () => { filter.query = search.value; fill(); });
  linkSel.setAttribute('aria-label', 'Фільтр за ланкою');
  roleSel.setAttribute('aria-label', 'Фільтр за роллю');
  search.setAttribute('aria-label', 'Пошук за позивним');

  root.append(el('div', { class: 'ef-card ef-filters' },
    el('span', { class: 'ef-eyebrow', text: 'Перелік пілотів' }),
    el('div', { class: 'ef-filter-row' }, linkSel, roleSel, search)));

  const attention = allRows.filter(r => r.hasOverdue).length;
  root.append(el('div', { class: 'ef-stats' },
    stat('Пілотів', allRows.length),
    stat('Потребують уваги', attention, { tone: attention ? 'red' : 'green' }),
    stat('Ланок', links.length || '—'),
    stat('Дані', formatDate(today), { tone: 'blue' })));

  const tableHost = el('div');
  const fill = () => {
    const rows = filterPilots(allRows, filter);
    const head = el('thead', {}, el('tr', {},
      el('th', { scope: 'col', text: 'Позивний' }), el('th', { scope: 'col', text: 'Роль' }), el('th', { scope: 'col', text: 'Клас' }),
      el('th', { scope: 'col', text: 'Тип ПС' }),
      COLUMNS.map(([key, label]) => el('th', { scope: 'col', class: 'ef-col-status', title: FULL_NAMES[key], text: label })),
      el('th', { scope: 'col', text: 'Останній політ' }), el('th', { scope: 'col', text: 'Рік' }), el('th', { scope: 'col' }, el('span', { class: 'ef-sr', text: 'Відкрити профіль' }))));
    const body = el('tbody', {}, rows.map(row => {
      const p = row.person;
      const open = () => ctx.go('pilot', { id: p.id });
      const tr = el('tr', { class: 'ef-row-click' },
        el('th', { scope: 'row', class: 'ef-callsign' },
          el('button', { type: 'button', class: 'ef-link', onClick: open, 'aria-label': `Відкрити профіль ${p.callsign}` }, p.callsign),
          row.blocked ? el('span', { class: 'ef-flag', title: 'Польоти заборонені' }, 'Заборона') : null),
        el('td', { class: 'ef-muted', text: p.role }),
        el('td', { text: classText(p) }),
        el('td', { text: dash(p.aircraftType) }),
        COLUMNS.map(([key]) => el('td', { class: 'ef-col-status' }, statusDot(row.cells[key], FULL_NAMES[key]))),
        el('td', { class: 'ef-muted', text: dateText(row.lastFlight) }),
        el('td', { class: 'ef-muted', text: dash(row.yearAirtime) }),
        el('td', { class: 'ef-col-go' }, el('span', { 'aria-hidden': 'true', text: '›' })));
      tr.addEventListener('click', event => { if (!event.target.closest('button')) open(); });
      return tr;
    }));
    const built = [el('div', { class: 'ef-table-wrap ef-pilots-table' },
      el('table', { class: 'ef-table' }, el('caption', { class: 'ef-sr', text: 'Перелік пілотів і стан строків' }), head, body))];
    if (!rows.length) built.push(el('p', { class: 'ef-muted ef-pad', text: 'За вибраними фільтрами пілотів немає.' }));
    tableHost.replaceChildren(...built);
  };
  fill();
  root.append(tableHost);
  root.append(el('ul', { class: 'ef-legend', 'aria-label': 'Умовні позначення' },
    el('li', {}, statusDot('valid', 'Дійсно'), 'Дійсно'),
    el('li', {}, statusDot('soon', 'Скоро'), `Скоро (≤ ${ctx.settings.soonDays} днів)`),
    el('li', {}, statusDot('overdue', 'Прострочено'), 'Прострочено'),
    el('li', {}, statusDot(null, 'Немає даних'), 'Немає даних')));
  root.append(el('div', { class: 'ef-alert ef-alert-blue' }, 'Виберіть рядок пілота, щоб відкрити профіль і переглянути перевірки, допуски та льотну книжку.'));
  return root;
}
