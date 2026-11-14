// Екран «Ще»: решта розділів, яких немає в нижній панелі. Числа — з даних файлу.
import { buildReminders, personItems, resolveSettings } from '../fly-core.js';
import { NAV_ITEMS, PHONE_NAV } from '../fly-state.js';
import { icon } from '../icons.js';
import { el } from '../ui.js';

function rowValue(route, data, today) {
  if (route === 'reminders') {
    const settings = resolveSettings(data?.unit?.settings);
    const items = (data?.persons || []).flatMap(person => personItems(person, today, { checks: data.checks, settings }));
    return String(buildReminders(items, today, settings.reminderDays).length);
  }
  if (route === 'leaves') return String((data?.leaves || []).length);
  return '';
}

export function render(ctx) {
  const items = NAV_ITEMS.filter(item => item.route !== 'more' && !PHONE_NAV.includes(item.route));
  const place = ctx.data?.unit?.name || '';
  return el('div', { class: 'ef-view ef-more' },
    el('header', { class: 'ef-today-head' },
      el('h1', { text: 'Ще' }),
      place ? el('span', { class: 'ef-today-date', text: place }) : null),
    el('div', { class: 'ef-glow-card' }, items.map(item => {
      const value = rowValue(item.route, ctx.data, ctx.today);
      return el('button', {
        type: 'button', class: 'ef-ban-row',
        onClick: () => ctx.go(item.route),
      },
      icon(item.icon, 18),
      el('span', { class: 'ef-ban-who' }, el('strong', { text: item.label })),
      value ? el('span', { class: 'ef-glow-quiet', text: value }) : null,
      el('span', { class: 'ef-shift-go', 'aria-hidden': 'true', text: '›' }));
    })));
}
