// Зведення — міні-дашборд частини: готовність (кільце), чотири лічильники, смуга часток строків,
// «Потребують уваги», найближчі 30 днів, відпустки, остання зміна, розрахунок штурмана й плитки
// розділів. Схема маршруту (route-board) — нижче, у згорнутому блоці. Модель — dashboardView.
import { formatDate } from '../fly-core.js';
import { dashboardView, effectiveSettings, navItemsFor, pluralEvents } from '../fly-state.js';
import { el, emptyState, button, notice, select, statusChip, dateText } from '../ui.js';
import { icon } from '../icons.js';
import { openPilotForm } from './card.js';
import { openEntry } from './entry.js';
import { openLeaveForm } from './leaves-form.js';
import { routeBoard } from './route-board.js';

const PROBLEM_LIMIT = 5;
let showAll = false;
const filter = { link: '', role: '' };

function kpi(label, value, tone, hint, onClick) {
  return el('button', { type: 'button', class: `ef-kpi ef-tone-${tone}`, onClick, 'aria-label': `${label}: ${value}${hint ? `, ${hint}` : ''}` },
    el('span', { class: 'ef-kpi-label', text: label }),
    el('strong', { class: 'ef-counter-value ef-kpi-value', text: String(value) }),
    hint ? el('span', { class: 'ef-kpi-hint', text: hint }) : null);
}

function stateText(item) {
  const left = item.daysLeft;
  if (left === null) return '';
  return item.status === 'overdue' ? `Прострочено · ${-left} дн.` : `${item.status === 'soon' ? 'Скоро' : 'Дійсно'} · ${left} дн.`;
}

function ring(percent, tone) {
  const node = el('div', { class: `ef-ring ef-ring-${tone}`, role: 'img', 'aria-label': `Готовність ${percent}%` },
    el('div', { class: 'ef-ring-hole' }, el('strong', { text: `${percent}%` }), el('span', { text: 'готові' })));
  node.style.setProperty('--ef-ring', `${percent}%`);
  return node;
}

function shareBar(view) {
  const part = (key, label, count) => {
    const seg = el('span', { class: `ef-share-seg ef-share-${key}`, title: `${label}: ${count}` });
    seg.style.flexGrow = String(Math.max(view.share[key], count ? 2 : 0));
    return seg;
  };
  const { overdue, soon, valid, total } = view.counters;
  return el('div', { class: 'ef-share', role: 'img', 'aria-label': `Строки: прострочено ${overdue}, скоро ${soon}, дійсно ${valid}` },
    total ? [part('overdue', 'Прострочено', overdue), part('soon', 'Скоро', soon), part('valid', 'Дійсно', valid)] : el('span', { class: 'ef-share-seg ef-share-none' }));
}

function block(title, action, ...body) {
  return el('section', { class: 'ef-card ef-dash-card' },
    el('div', { class: 'ef-card-head' }, el('h2', { class: 'ef-card-title', text: title }), action || null),
    body);
}

const more = (label, onClick) => el('button', { type: 'button', class: 'ef-dash-more', onClick }, label, icon('chevron', 14));

function leavesBlock(ctx, view) {
  const line = (row, lead) => el('li', {},
    el('button', { type: 'button', class: 'ef-link', onClick: () => ctx.go('pilot', { id: row.personId, tab: 'leaves' }), text: row.callsign }),
    el('span', { class: 'ef-muted', text: ` ${row.kind?.short || ''} · ${lead} ${formatDate(row.leave.from).slice(0, 5)}–${formatDate(row.leave.to)}` }),
    row.warnings.length ? el('span', { class: 'ef-text-overdue', text: ' · є застереження' }) : null);
  const now = view.leavesNow;
  const next = view.leavesNext;
  return block('Відпустки', more('Графік', () => ctx.go('leaves')),
    el('p', { class: 'ef-dash-big' }, el('strong', { text: String(now.length) }), el('span', { text: now.length === 1 ? ' пілот у відпустці зараз' : ' у відпустці зараз' })),
    now.length || next.length
      ? el('ul', { class: 'ef-dash-list' }, now.map(r => line(r, 'зараз,')), next.map(r => line(r, 'з')))
      : el('p', { class: 'ef-muted ef-dash-clip', text: 'Запланованих відпусток немає.' }),
    el('div', { class: 'ef-actions' }, button('Додати відпустку', { variant: 'ghost', small: true, iconName: 'vnesty', onClick: () => openLeaveForm(ctx) })));
}

function shiftBlock(ctx, view) {
  const s = view.shift;
  return block('Остання зміна', more('Хронометраж', () => ctx.go('chrono')),
    s
      ? [el('p', { class: 'ef-dash-big' }, el('strong', { text: String(s.flights) }), el('span', { text: ` польотів · ${formatDate(s.date)}` })),
        el('ul', { class: 'ef-dash-list' },
          el('li', {}, el('span', { class: 'ef-muted', text: 'Екіпажів: ' }), el('strong', { text: String(s.crews) })),
          el('li', {}, el('span', { class: 'ef-muted', text: 'Наліт: ' }), el('strong', { text: s.airtime || '—' })))]
      : el('p', { class: 'ef-dash-big' }, el('strong', { text: '—' }), el('span', { text: ' змін ще не внесено' })),
    el('div', { class: 'ef-actions' }, button('Додати політ', { variant: 'ghost', small: true, iconName: 'vnesty', onClick: () => openEntry(ctx, { mode: 'flight' }) })));
}

function navBlock(ctx, view) {
  return block('Штурман', more('Розрахунки', () => ctx.go('navigator')),
    el('p', { class: 'ef-dash-big' }, el('strong', { text: String(view.nav.count) }), el('span', { text: ' збережених розрахунків' })),
    el('p', { class: 'ef-muted ef-dash-clip', text: view.nav.title ? `Останній: ${view.nav.title}` : 'ІШР, бортжурнал і ШПП формуються на екрані «Штурман».' }),
    el('div', { class: 'ef-actions' }, button('Сонце і Місяць', { variant: 'ghost', small: true, iconName: 'sontse-misiats', onClick: () => ctx.go('sunmoon') })));
}

function tiles(ctx, view) {
  return el('nav', { class: 'ef-tiles', 'aria-label': 'Розділи EasyFLY' }, view.tiles.map(t =>
    el('button', { type: 'button', class: `ef-tile${t.tone ? ` ef-tone-${t.tone}` : ''}`, onClick: () => ctx.go(t.target.name, t.target.params) },
      el('span', { class: 'ef-tile-icon', 'aria-hidden': 'true' }, icon(t.icon, 20)),
      el('span', { class: 'ef-tile-label', text: t.label }),
      t.value !== null ? el('strong', { class: 'ef-stat-value ef-tile-value', text: t.value }) : null,
      el('span', { class: 'ef-tile-hint', text: t.hint }))));
}

/** До пілотів; якщо пілот один — одразу в його профіль («Комісація»). */
function goPilots(ctx) {
  const target = navItemsFor(ctx.data).find(i => i.route === 'pilots').target;
  ctx.go(target.name, target.params);
}

export function render(ctx) {
  const { data, today } = ctx;
  const settings = effectiveSettings(data);
  const root = el('div', { class: 'ef-view ef-dash' });

  if (!data.persons.length) {
    root.append(
      el('header', { class: 'ef-dash-hero' }, el('div', { class: 'ef-dash-hero-text' },
        el('span', { class: 'ef-eyebrow', text: `EasyFLY · стан на ${formatDate(today)}` }),
        el('h1', { class: 'ef-title', text: data.unit?.name || 'Зведення частини' }))),
      emptyState('Немає даних', 'Додайте пілотів, щоб бачити готовність і строки перевірок, або відкрийте демо-дані.',
        button('Додати пілота', { variant: 'primary', iconName: 'vnesty', onClick: () => openPilotForm(ctx) })));
    return root;
  }

  const view = dashboardView(data, today, filter);
  const { counters } = view;
  const tone = view.blockedCount ? (view.readyPercent < 50 ? 'red' : 'amber') : 'green';

  root.append(el('header', { class: 'ef-dash-hero' },
    ring(view.readyPercent, tone),
    el('div', { class: 'ef-dash-hero-text' },
      el('span', { class: 'ef-eyebrow', text: `EasyFLY · стан на ${formatDate(today)}` }),
      el('h1', { class: 'ef-title', text: data.unit?.name || 'Зведення частини' }),
      el('p', { class: 'ef-subtitle', text: `${data.persons.length === 1 ? `${data.persons[0].callsign} · ${view.blockedCount ? 'є блокування польотів' : 'польоти не заблоковано'}` : `${view.ready} з ${view.pilots} пілотів без блокувань`}${data.unit?.airfield ? ` · аеродром ${data.unit.airfield}` : ''}` }))));

  if (view.blocked.length) {
    root.append(notice(`Польоти заборонені: ${view.blocked.map(b => b.callsign).join(', ')}`,
      'Прострочені строки блокують допуск до польотів. Деталі — у профілі пілота.', { tone: 'red', role: 'status' }));
  }

  root.append(el('div', { class: 'ef-kpis' },
    kpi('Готові', `${view.ready}/${view.pilots}`, tone, 'пілоти без блокувань', () => goPilots(ctx)),
    kpi('Прострочено', counters.overdue, counters.overdue ? 'red' : 'green', 'строків', () => ctx.go('reminders')),
    kpi('Скоро', counters.soon, counters.soon ? 'amber' : 'green', `≤ ${settings.soonDays} днів`, () => ctx.go('reminders')),
    kpi('Дійсно', counters.valid, 'green', `із ${counters.total} строків`, () => goPilots(ctx))));
  root.append(el('div', { class: 'ef-share-wrap' }, shareBar(view),
    el('div', { class: 'ef-share-legend' },
      el('span', { class: 'ef-text-overdue', text: `Прострочено ${view.share.overdue}%` }),
      el('span', { class: 'ef-text-soon', text: `Скоро ${view.share.soon}%` }),
      el('span', { class: 'ef-text-valid', text: `Дійсно ${view.share.valid}%` }))));

  const problems = view.problems;
  const limit = ctx.host?.phone ? 3 : PROBLEM_LIMIT;
  const visible = showAll ? problems : problems.slice(0, limit);
  const attention = block('Потребують уваги', problems.length ? el('span', { class: `ef-pill${counters.overdue ? '' : ' ef-pill-amber'}`, text: String(problems.length) }) : null,
    problems.length
      ? el('ul', { class: 'ef-dash-items' }, visible.map(i => el('li', {},
        el('button', { type: 'button', class: 'ef-dash-item', onClick: () => ctx.go('pilot', { id: i.personId }) },
          el('span', { class: 'ef-dash-item-main' }, el('strong', { text: i.callsign }), el('span', { class: 'ef-muted', text: i.label })),
          statusChip(i.status, stateText(i))))))
      : el('p', { class: 'ef-muted', text: 'Прострочених і близьких строків немає.' }),
    problems.length > limit
      ? button(showAll ? 'Показати менше' : `Показати всі (${problems.length})`, { variant: 'ghost', small: true, onClick: () => { showAll = !showAll; ctx.rerender(); } })
      : null);

  const upcoming = block('Найближчі 30 днів', more('Нагадування', () => ctx.go('reminders')),
    el('div', { class: 'ef-buckets' }, view.buckets.map(bucket => {
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

  root.append(el('div', { class: 'ef-split ef-dash-split' }, attention, upcoming));
  root.append(el('div', { class: 'ef-dash-row' }, leavesBlock(ctx, view), shiftBlock(ctx, view), navBlock(ctx, view)));
  root.append(el('h2', { class: 'ef-eyebrow ef-dash-section ef-dash-section-tiles', text: 'Розділи' }), tiles(ctx, view));

  root.append(el('details', { class: 'ef-card ef-dash-route' },
    el('summary', {}, el('span', { class: 'ef-card-title', text: 'Схема маршруту останнього розрахунку' }), el('span', { class: 'ef-muted', text: 'розгорнути' })),
    routeBoard(ctx)));

  const linkSel = select([{ value: '', label: 'Усі ланки' }, ...view.links.map(l => ({ value: l, label: l }))], filter.link, { onChange: () => { filter.link = linkSel.value; ctx.rerender(); } });
  const roleSel = select([{ value: '', label: 'Усі ролі' }, ...['КЕ', 'ЛШ', 'Борттехнік'].map(r => ({ value: r, label: r }))], filter.role, { onChange: () => { filter.role = roleSel.value; ctx.rerender(); } });
  linkSel.setAttribute('aria-label', 'Фільтр за ланкою');
  roleSel.setAttribute('aria-label', 'Фільтр за роллю');
  root.append(el('div', { class: 'ef-filterbar' },
    el('span', { class: 'ef-muted', text: 'Фільтр:' }), linkSel, roleSel,
    el('span', { class: 'ef-muted', text: `локальний стан на ${formatDate(today)}` })));
  return root;
}
