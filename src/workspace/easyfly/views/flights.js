// «Польоти»: огляд нальоту (місяць, рік, усього) і кількість польотів. Запис польоту — короткою кнопкою.
import { formatDuration } from '../fly-core.js';
import { flightOverview } from '../timing-core.js';
import { button, el } from '../ui.js';
import { openEntry } from './entry.js';

function cell(label, value) {
  return el('div', { class: 'ef-overview-cell' },
    el('span', { text: label }),
    el('strong', { text: value }));
}

export function render(ctx) {
  const view = flightOverview(ctx.data, ctx.today);
  const time = bucket => formatDuration(bucket.minutes) || '0:00';
  return el('div', { class: 'ef-view ef-flights' },
    el('header', { class: 'ef-today-head' },
      el('h1', { text: 'Польоти' }),
      button('Записати політ', { variant: 'primary', onClick: () => openEntry(ctx, { mode: 'flight' }) })),
    el('section', { class: 'ef-glow-card' },
      el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Наліт' })),
      el('div', { class: 'ef-overview' },
        cell('Цей місяць', time(view.month)),
        cell('Цей рік', time(view.year)),
        cell('Усього', time(view.total)))),
    el('section', { class: 'ef-glow-card' },
      el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Кількість польотів' })),
      el('div', { class: 'ef-overview' },
        cell('Цей місяць', String(view.month.flights)),
        cell('Цей рік', String(view.year.flights)),
        cell('Усього', String(view.total.flights)))));
}