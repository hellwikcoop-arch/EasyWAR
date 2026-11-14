// Екран «Сьогодні»: дуга готовності, картка льотної зміни, заборони, стан за пілотами.
// Числа — з todayHome (реальні дані). Схема маршруту лишається згорнутою внизу.
import { formatDate, pluralDays } from '../fly-core.js';
import { hasSubordinates, personalHome, pluralFlights, pluralPilots, todayHome } from '../glow-core.js';
import { el } from '../ui.js';
import { openPilotForm } from './card.js';
import { routeBoard } from './route-board.js';

function arc(percent) {
  const r = 200;
  const x0 = 13.7;
  const x1 = 376.3;
  const y = 207.5;
  const cx = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  const cy = y + Math.sqrt(r * r - half * half);
  const a0 = Math.atan2(y - cy, x0 - cx);
  const a1 = Math.atan2(y - cy, x1 - cx);
  const t = Math.max(0, Math.min(1, percent / 100));
  const a = a0 + (a1 - a0) * t;
  const px = cx + r * Math.cos(a);
  const py = cy + r * Math.sin(a);
  const d = (x, yy) => `${x.toFixed(1)} ${yy.toFixed(1)}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ef-arc');
  svg.setAttribute('viewBox', '-22 -8 434 248');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Готовність ${percent} відсотків`);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.id = 'efArcGlow';
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '1');
  grad.setAttribute('y2', '0');
  for (const [offset, color] of [['0', '#7a3418'], ['.5', '#e66a37'], ['1', '#fec38a']]) {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    grad.append(stop);
  }
  defs.append(grad);
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  track.setAttribute('d', `M${d(x0, y)}A200 200 0 0 1 ${d(x1, y)}`);
  track.setAttribute('class', 'ef-arc-track');
  svg.append(defs, track);
  if (t > 0.01) {
    const prog = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    prog.setAttribute('d', `M${d(x0, y)}A200 200 0 0 1 ${d(px, py)}`);
    prog.setAttribute('class', 'ef-arc-value');
    const knob = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    knob.setAttribute('cx', px.toFixed(1));
    knob.setAttribute('cy', py.toFixed(1));
    knob.setAttribute('r', '11');
    knob.setAttribute('class', 'ef-arc-knob');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', px.toFixed(1));
    dot.setAttribute('cy', py.toFixed(1));
    dot.setAttribute('r', '3');
    dot.setAttribute('class', 'ef-arc-dot');
    svg.append(prog, knob, dot);
  }
  return svg;
}

function banRow(ctx, item) {
  const days = item.daysOverdue === null ? 'строк невідомий' : `прострочено ${item.daysOverdue} дн.`;
  return el('button', {
    type: 'button', class: 'ef-ban-row',
    onClick: () => ctx.go('pilot', { id: item.personId, tab: 'komis' }),
  },
  el('span', { class: 'ef-ban-who' },
    el('strong', { text: item.callsign }),
    el('span', { text: item.reason })),
  el('span', { class: 'ef-ban-days', text: days }));
}

function renderPersonal(ctx) {
  const { data, today } = ctx;
  const view = personalHome(data, today);
  const root = el('div', { class: 'ef-view ef-today ef-today-personal' });
  const person = view.person;
  root.append(el('header', { class: 'ef-today-head' },
    el('h1', { text: person ? person.callsign : 'Сьогодні' }),
    el('span', { class: 'ef-today-date', text: formatDate(today) || '' })));
  if (!person) {
    root.append(
      el('p', { class: 'ef-today-empty', text: 'Це ваш облік: лише ви, без списку підлеглих. Спершу вкажіть позивний і рівень підготовки.' }),
      el('button', { type: 'button', class: 'ef-btn ef-btn-primary', text: 'Почати', onClick: () => openPilotForm(ctx) }));
    return root;
  }
  const nearest = view.nearest;
  const headline = view.blockers.length
    ? 'Польоти заборонені'
    : nearest && nearest.daysLeft < 0
      ? `Прострочено ${-nearest.daysLeft} ${pluralDays(nearest.daysLeft)}`
      : nearest?.daysLeft === 0
        ? 'Строк сьогодні'
        : nearest?.daysLeft > 0
          ? `${nearest.daysLeft} ${pluralDays(nearest.daysLeft)}`
          : 'Без блокувань';
  root.append(el('section', { class: 'ef-glow-card ef-komis-hero' },
    el('div', { class: 'ef-komis-num' }, el('strong', { text: headline })),
    el('p', { class: 'ef-glow-quiet', text: view.blockers.length
      ? view.blockers.map(item => item.daysOverdue === null ? item.label : `${item.label} · ${item.daysOverdue} дн.`).join('; ')
      : (nearest ? `Найближче: ${nearest.label}${nearest.dueDate ? ` до ${formatDate(nearest.dueDate)}` : ''}` : 'Прострочених і близьких строків немає.') }),
    el('button', { type: 'button', class: 'ef-btn ef-btn-primary', text: 'Комісація', onClick: () => ctx.go('pilot', { id: person.id, tab: 'komis' }) })));
  if (view.upcoming.length) {
    root.append(el('section', { class: 'ef-glow-card' },
      el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Ваші строки' })),
      view.upcoming.map(item => el('div', { class: 'ef-ban-row ef-flight-row' },
        el('span', { class: 'ef-ban-who' },
          el('strong', { text: item.label }),
          el('span', { text: item.dueDate ? formatDate(item.dueDate) : 'дату не внесено' })),
        el('span', { class: item.status === 'overdue' ? 'ef-ban-days' : 'ef-glow-quiet', text: item.daysLeft < 0 ? `прострочено ${-item.daysLeft} дн.` : item.daysLeft === 0 ? 'сьогодні' : item.daysLeft > 0 ? `${item.daysLeft} дн.` : '' })))));
  }
  return root;
}

export function render(ctx) {
  if (!hasSubordinates(ctx.data)) return renderPersonal(ctx);
  const { data, today } = ctx;
  const view = todayHome(data, today);
  const root = el('div', { class: 'ef-view ef-today' });
  const place = [view.airfield, view.dateLabel].filter(Boolean).join(' · ');
  root.append(el('header', { class: 'ef-today-head' },
    el('h1', { text: 'Сьогодні' }),
    place ? el('span', { class: 'ef-today-date', text: place }) : null));

  if (!view.pilots) {
    root.append(el('p', { class: 'ef-today-empty', text: 'Пілотів ще немає. Додайте їх у розділі «Пілоти» — готовність і заборони порахуються з їхніх строків.' }));
    return root;
  }

  const hero = el('div', { class: 'ef-today-hero' }, arc(view.readyPercent));
  const shift = view.shift;
  hero.append(el('button', {
    type: 'button', class: 'ef-shift-pill',
    onClick: () => ctx.go('flights', shift ? { date: shift.date } : {}),
  },
  el('span', { class: 'ef-shift-ico', 'aria-hidden': 'true', text: '▦' }),
  el('span', { class: 'ef-shift-text' },
    el('strong', { text: shift ? shift.title : 'Льотних змін не заплановано' }),
    el('span', { text: shift ? shift.subtitle : 'Польоти → «Льотна зміна»' })),
  el('span', { class: 'ef-shift-go', 'aria-hidden': 'true', text: '›' })));
  const banPhrase = view.banned.length ? `${view.banned.length} під забороною` : 'без заборони';
  hero.append(el('div', { class: 'ef-today-score' },
    el('div', { class: 'ef-today-fraction' },
      el('span', { class: 'ef-today-n', text: String(view.ready) }),
      el('span', { class: 'ef-today-m', text: `/${view.pilots}` })),
    el('div', { class: 'ef-today-caption', text: view.pilots === 1 ? (view.ready ? 'пілот готовий до польотів' : 'пілот не готовий до польотів') : 'пілотів готові до польотів' }),
    el('div', { class: 'ef-today-sub', text: `${view.readyPercent} % · ${banPhrase}` })));
  root.append(hero);

  root.append(el('section', { class: 'ef-glow-card' },
    el('div', { class: 'ef-glow-card-head' },
      el('h2', { text: 'Польоти заборонені' }),
      el('span', { class: 'ef-glow-pill', text: view.banned.length ? `${view.banned.length} ${pluralPilots(view.banned.length)}` : 'немає' })),
    view.banned.length
      ? view.banned.map(item => banRow(ctx, item))
      : el('p', { class: 'ef-glow-quiet', text: 'Прострочених строків, що забороняють польоти, немає.' })));

  const overdue = view.deadlines.overdue || 0;
  const soon = view.deadlines.soon || 0;
  const valid = view.deadlines.valid || 0;
  root.append(el('section', { class: 'ef-glow-card' },
    el('div', { class: 'ef-glow-card-head' },
      el('h2', { text: 'Стан за пілотами' }),
      el('span', { class: 'ef-glow-pill', text: String(view.pilots) })),
    el('div', { class: 'ef-state-dots', role: 'img', 'aria-label': `${view.banned.length} під забороною, ${view.ready} готові` },
      view.states.map(person => el('span', {
        class: person.blocked ? 'ef-dot ef-dot-bad' : 'ef-dot ef-dot-ok',
        title: `${person.callsign}: ${person.blocked ? 'заборона' : 'готовий'}`,
      }))),
    el('div', { class: 'ef-state-legend' },
      el('span', {}, el('i', { class: 'ef-dot ef-dot-bad' }), 'заборона'),
      el('span', {}, el('i', { class: 'ef-dot ef-dot-ok' }), 'готовий')),
    el('div', { class: 'ef-state-counts' },
      el('span', {}, el('strong', { text: String(overdue) }), 'строки прострочені'),
      el('span', {}, el('strong', { text: String(soon) }), 'скоро спливуть'),
      el('span', {}, el('strong', { text: String(valid) }), 'чинних'))));

  root.append(el('details', { class: 'ef-card ef-dash-route' },
    el('summary', {}, el('span', { class: 'ef-card-title', text: 'Схема маршруту останнього розрахунку' }), el('span', { class: 'ef-muted', text: 'розгорнути' })),
    routeBoard(ctx)));
  root.append(el('p', { class: 'ef-glow-foot', text: `Дані файлу · стан на ${formatDate(today) || '—'}${view.shift?.flights ? ` · ${view.shift.flights} ${pluralFlights(view.shift.flights)}` : ''}` }));
  return root;
}
