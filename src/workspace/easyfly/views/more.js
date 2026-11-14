// Екран «Ще»: решта розділів, яких немає в нижній панелі.
import { NAV_ITEMS, PHONE_NAV } from '../fly-state.js';
import { icon } from '../icons.js';
import { el } from '../ui.js';

export function render(ctx) {
  const items = NAV_ITEMS.filter(item => item.route !== 'more' && !PHONE_NAV.includes(item.route));
  return el('div', { class: 'ef-view ef-more' },
    el('header', { class: 'ef-today-head' }, el('h1', { text: 'Ще' })),
    el('div', { class: 'ef-glow-card' }, items.map(item => el('button', {
      type: 'button', class: 'ef-ban-row',
      onClick: () => ctx.go(item.route),
    },
    icon(item.icon, 18),
    el('span', { class: 'ef-ban-who' }, el('strong', { text: item.label })),
    el('span', { class: 'ef-shift-go', 'aria-hidden': 'true', text: '›' })))));
}
