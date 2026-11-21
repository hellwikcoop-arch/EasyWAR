// Екран «Ще»: решта розділів, яких немає в нижній панелі. Числа — з даних файлу.
import { buildReminders, personItems, resolveSettings } from '../fly-core.js';
import { moonDay } from '../moon-core.js';
import { sunTimes } from '../sun-core.js';
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

function skyPoint(data) {
  const settings = data?.unit?.settings || {};
  if (Number.isFinite(Number(settings.airfieldLat)) && Number.isFinite(Number(settings.airfieldLon)) && settings.airfieldLat !== '' && settings.airfieldLon !== '') {
    return { lat: Number(settings.airfieldLat), lon: Number(settings.airfieldLon) };
  }
  const departure = data?.navFlights?.[0]?.flight?.departure;
  if (Number.isFinite(departure?.lat) && Number.isFinite(departure?.lon)) return { lat: departure.lat, lon: departure.lon };
  return null;
}

function skyTiles(ctx) {
  const point = skyPoint(ctx.data);
  let sun = null;
  let moon = null;
  if (point) {
    try { sun = sunTimes(ctx.today, point.lat, point.lon); } catch { sun = null; }
    try { moon = moonDay(ctx.today, point.lat, point.lon); } catch { moon = null; }
  }
  const tile = (label, value, route) => el('button', {
    type: 'button', class: 'ef-sky-tile', onClick: () => ctx.go(route),
  }, el('span', { text: label }), el('strong', { text: value }));
  return el('div', { class: 'ef-sky', 'data-ef': 'sky' },
    tile('Схід', sun?.sunrise || '—', 'sunmoon'),
    tile('Захід', sun?.sunset || '—', 'sunmoon'),
    tile('Місяць', moon ? `${moon.illumination} %` : '—', 'sunmoon'));
}

export function render(ctx) {
  const items = NAV_ITEMS.filter(item => item.route !== 'more' && !PHONE_NAV.includes(item.route));
  const place = ctx.data?.unit?.name || '';
  return el('div', { class: 'ef-view ef-more' },
    el('header', { class: 'ef-today-head' },
      el('h1', { text: 'Ще' }),
      place ? el('span', { class: 'ef-today-date', text: place }) : null),
    skyTiles(ctx),
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
