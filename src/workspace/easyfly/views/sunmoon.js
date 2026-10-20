// EasyFLY, екран «Сонце і Місяць»: схід/захід Сонця, сутінки, фаза Місяця, довідковий індикатор
// «Сприятлива ніч для ОНБ» (освітленість диска ≥ порогу з налаштувань, 50 % за замовчуванням;
// це підказка, а не допуск) і таблиця п'яти (чи більше) точок маршруту. Розрахунки — sun-core.js / moon-core.js,
// модель екрана — navigator-core.js. DOM будується через createElement/textContent.
import './navigator.css';
import './sunmoon.css';
import { el } from '../ui.js';
import { icon } from '../icons.js';
import { SUN_EVENT_LABELS, formatDateIso } from '../sun-core.js';
import {
  buildPoints,
  dateUk,
  draftToFlight,
  navSession,
  onbThreshold,
  parseCoord,
  shiftDate,
  sunMoonModel,
} from './navigator-core.js';

const MAX_EXTRA_POINTS = 12;

export function render(ctx) {
  const unit = ctx.data?.unit || {};
  if (!navSession.sunDate) navSession.sunDate = ctx.today;
  const root = el('div', { class: 'nv-root' });
  let pointsAnchor = null;

  const currentPoints = () => buildPoints({
    flight: navSession.draft ? draftToFlight(navSession.draft, unit) : null,
    unit,
    airfield: navSession.airfield,
    extra: navSession.extraPoints,
  });

  const pair = (label, value) => el('div', { class: 'sm-pair' }, el('span', { text: label }), el('strong', { text: value }));

  function paint() {
    const points = currentPoints();
    navSession.sunIndex = Math.min(Math.max(navSession.sunIndex, 0), points.length - 1);
    const threshold = onbThreshold(unit);
    const model = sunMoonModel({ date: navSession.sunDate, points, index: navSession.sunIndex, threshold });
    root.replaceChildren();

    // ── заголовок ──
    root.append(el('header', { class: 'nv-head' },
      el('div', { class: 'nv-titles' },
        el('nav', { class: 'nv-crumbs', 'aria-label': 'Розташування' }, el('span', { text: 'EasyFLY' }), el('span', { text: 'Сонце і Місяць', 'aria-current': 'page' })),
        el('h1', { class: 'nv-title', text: 'Сонце і Місяць' }),
        el('p', { class: 'nv-sub', text: model ? `Місцевий час · ${model.coordsText}` : 'Вкажіть дату й координати' })),
      el('div', { class: 'nv-actions' },
        el('button', { type: 'button', class: 'nv-btn', onClick: () => { if (pointsAnchor) { pointsAnchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); pointsAnchor.focus({ preventScroll: true }); } } },
          el('span', { text: 'Точки маршруту' })))));

    // ── керування: дата, точка, координати ──
    const dateInput = el('input', { type: 'text', inputmode: 'numeric', maxlength: 10, placeholder: 'дд.мм.рррр', value: dateUk(navSession.sunDate), 'aria-label': 'Дата', autocomplete: 'off' });
    dateInput.addEventListener('change', () => {
      const iso = formatDateIso(dateInput.value);
      if (iso) { navSession.sunDate = iso; paint(); } else dateInput.setAttribute('aria-invalid', 'true');
    });
    const step = days => () => { navSession.sunDate = shiftDate(navSession.sunDate, days); paint(); };
    const pointSelect = el('select', { class: 'nv-input', 'aria-label': 'Точка' },
      points.map((p, i) => el('option', { value: String(i), selected: i === navSession.sunIndex, text: p.name })));
    pointSelect.value = String(navSession.sunIndex);
    pointSelect.addEventListener('change', () => { navSession.sunIndex = Number(pointSelect.value); paint(); });
    const selected = points[navSession.sunIndex];
    const editable = navSession.sunIndex === 0;
    const coordField = (label, kind, value) => {
      const input = el('input', {
        class: 'nv-input', type: 'text', inputmode: 'decimal', value: String(value).replace('.', ','), readonly: !editable,
        'aria-label': label, autocomplete: 'off',
      });
      if (editable) {
        input.addEventListener('change', () => {
          const lat = parseCoord(kind === 'lat' ? input.value : selected.lat, 'lat');
          const lon = parseCoord(kind === 'lon' ? input.value : selected.lon, 'lon');
          if (lat === null || lon === null) { input.setAttribute('aria-invalid', 'true'); return; }
          navSession.airfield = { lat, lon };
          paint();
        });
      }
      return el('label', { class: 'nv-field' }, el('span', { class: 'nv-label', text: label }), input);
    };
    root.append(el('div', { class: 'sm-controls' },
      el('div', { class: 'sm-date', role: 'group', 'aria-label': 'Дата' },
        el('button', { type: 'button', class: 'nv-btn', 'aria-label': 'Попередня доба', onClick: step(-1) }, el('span', { text: '←' })),
        dateInput,
        el('button', { type: 'button', class: 'nv-btn', 'aria-label': 'Наступна доба', onClick: step(1) }, el('span', { text: '→' }))),
      el('label', { class: 'nv-field sm-point' }, el('span', { class: 'nv-label', text: 'Точка' }), pointSelect),
      selected ? el('div', { class: 'sm-coords' },
        coordField('Широта, °', 'lat', selected.lat), coordField('Довгота, °', 'lon', selected.lon)) : null));
    if (selected && editable) {
      const sourceText = {
        conditional: 'Умовні координати (в Налаштуваннях частини не задано): уведіть свої.',
        settings: 'Координати аеродрому з Налаштувань частини; можна змінити тут.',
        flight: 'Координати аеродрому з розрахунку штурмана; можна змінити тут.',
        manual: 'Координати введені вручну.',
      }[selected.source];
      if (sourceText) root.append(el('p', { class: 'nv-hint', style: 'margin:-6px 0 14px', text: sourceText }));
    }
    if (!model) {
      root.append(el('div', { class: 'nv-alert', role: 'alert' }, el('strong', { text: 'Не вдалося розрахувати' }), el('div', { text: 'Перевірте дату й координати точки.' })));
      return;
    }

    // ── Сонце / Місяць ──
    const sunCard = el('section', { class: 'nv-card sm-card-sun' },
      el('div', { class: 'sm-card-head' },
        el('span', { class: 'sm-card-icon' }, icon('sontse-misiats', 22)),
        el('div', {}, el('h2', { text: 'Сонце' }), el('small', { text: 'Часові межі світлої доби' }))),
      el('div', { class: 'sm-big', text: model.sun.dayLengthText }),
      el('div', { class: 'sm-big-label', text: SUN_EVENT_LABELS.dayLength }),
      el('div', { class: 'sm-pairs' }, model.sun.rows.map(item => pair(SUN_EVENT_LABELS[item.key], item.value))));
    const m = model.moon;
    const moonCard = el('section', { class: 'nv-card' },
      el('div', { class: 'sm-card-head' },
        el('span', { class: 'sm-card-icon' }, icon('sontse-misiats', 22)),
        el('div', {}, el('h2', { text: 'Місяць' }), el('small', { text: `${m.phaseText} · ${m.ageText}` }))),
      el('div', { class: 'sm-big', text: `${m.illumination} %` }),
      el('div', { class: 'sm-big-label', text: 'Освітленість диска' }),
      el('div', { class: 'sm-pairs' }, pair('Схід', m.rise), pair('Захід', m.set), pair('Кульмінація', m.transit), pair('Макс. висота', m.maxAltitudeText)),
      el('div', { class: `sm-onb ${model.onb.favourable ? 'sm-onb-good' : 'sm-onb-no'}`, role: 'status' },
        el('span', { text: model.onb.favourable ? 'Сприятлива ніч для ОНБ' : 'Несприятлива ніч для ОНБ' })),
      el('p', { class: 'sm-onb-note', text: `Довідково: освітленість ${model.onb.illumination} % ${model.onb.favourable ? '≥' : '<'} порогу ${model.onb.threshold} % (поріг задається в Налаштуваннях частини). Це підказка, а не допуск.${model.onb.moonInDarkText ? ` Місяць над горизонтом у темряві: ${model.onb.moonInDarkText}.` : ''}` }));
    root.append(el('div', { class: 'sm-cards' }, sunCard, moonCard));

    // ── смужка доби ──
    const labels = { night: 'ніч', nautical: 'навігаційні сутінки', civil: 'цивільні сутінки', day: 'день' };
    const summary = model.strip.segments.map(seg => `${labels[seg.kind]} ${String(Math.floor(seg.from / 60)).padStart(2, '0')}:${String(Math.round(seg.from % 60)).padStart(2, '0')}`).join(', ');
    root.append(el('section', { class: 'nv-card', style: 'margin-bottom:16px' },
      el('div', { class: 'nv-card-head' }, el('h2', { text: `Смуга доби · ${model.dateLabel.slice(0, 5)} → ${model.nextLabel}` }), el('span', { class: 'nv-card-note', text: 'схематично' })),
      el('div', { class: 'sm-strip', role: 'img', 'aria-label': `Смуга доби: ${summary}` },
        model.strip.segments.map(seg => el('div', { class: `sm-seg-${seg.kind}`, style: `width:${seg.pct.toFixed(3)}%`, title: labels[seg.kind] }))),
      el('div', { class: 'sm-ticks', 'aria-hidden': 'true' }, model.strip.ticks.map(t => el('span', { text: t }))),
      el('div', { class: 'sm-legend', text: 'Темна смуга — ніч · світла — день · проміжні — сутінки. Схема без точного масштабу хвилин.' })));

    // ── точки маршруту ──
    pointsAnchor = el('section', { class: 'nv-card', tabindex: '-1', 'aria-labelledby': 'sm-points-title' });
    pointsAnchor.append(
      el('div', { class: 'nv-card-head' }, el('h2', { id: 'sm-points-title', text: 'Пункти маршруту' }),
        el('span', { class: 'nv-card-note', text: model.point.source === 'conditional' ? 'Умовні координати · демонстраційні дані' : 'Координати з розрахунку й введені вручну' })),
      el('div', { class: 'sm-table-wrap' }, el('table', { class: 'sm-table' },
        el('thead', {}, el('tr', {}, ['Точка', 'Координати', 'Схід Сонця', 'Захід Сонця', 'Місяць', ''].map((label, i) => el('th', { scope: 'col', text: label, class: i === 5 ? 'nv-sr' : null })))),
        el('tbody', {}, model.rows.map((row, i) => {
          const isExtra = points[i].source === 'extra';
          return el('tr', { 'aria-current': i === navSession.sunIndex ? 'true' : null },
            el('td', { 'data-label': 'Точка', text: row.name }),
            el('td', { 'data-label': 'Координати', text: row.coordsText }),
            el('td', { 'data-label': 'Схід Сонця', text: row.sunrise || '—' }),
            el('td', { 'data-label': 'Захід Сонця', text: row.sunset || '—' }),
            el('td', { 'data-label': 'Місяць', class: 'sm-wide', text: row.moonText }),
            el('td', { class: 'sm-wide' }, isExtra ? el('button', {
              type: 'button', class: 'nv-btn nv-btn-sm', 'aria-label': `Прибрати точку ${row.name}`,
              onClick: () => {
                navSession.extraPoints = navSession.extraPoints.filter(item => item.name !== row.name);
                navSession.sunIndex = 0;
                paint();
              },
            }, el('span', { text: 'Прибрати' })) : null));
        })))));
    const nameIn = el('input', { class: 'nv-input', type: 'text', maxlength: 40, autocomplete: 'off', 'aria-label': 'Назва точки' });
    const latIn = el('input', { class: 'nv-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Широта нової точки' });
    const lonIn = el('input', { class: 'nv-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Довгота нової точки' });
    const error = el('div', { class: 'sm-error', role: 'alert', hidden: true });
    const addPoint = () => {
      const name = nameIn.value.trim();
      const lat = parseCoord(latIn.value, 'lat');
      const lon = parseCoord(lonIn.value, 'lon');
      let message = '';
      if (!name) message = 'Вкажіть назву точки.';
      else if (lat === null || lon === null) message = 'Широта має бути від −90 до 90, довгота від −180 до 180 (градуси, кома чи крапка).';
      else if (points.some(p => p.name === name)) message = 'Точка з такою назвою вже є.';
      else if (navSession.extraPoints.length >= MAX_EXTRA_POINTS) message = `Можна додати не більше ${MAX_EXTRA_POINTS} точок.`;
      if (message) { error.textContent = message; error.hidden = false; return; }
      navSession.extraPoints = [...navSession.extraPoints, { name, lat, lon }];
      paint();
    };
    pointsAnchor.append(
      el('div', { class: 'sm-add' },
        el('label', { class: 'nv-field' }, el('span', { class: 'nv-label', text: 'Додати точку: назва' }), nameIn),
        el('label', { class: 'nv-field' }, el('span', { class: 'nv-label', text: 'Широта, °' }), latIn),
        el('label', { class: 'nv-field' }, el('span', { class: 'nv-label', text: 'Довгота, °' }), lonIn),
        el('button', { type: 'button', class: 'nv-btn', onClick: addPoint }, el('span', { text: 'Додати' }))),
      error,
      el('p', { class: 'nv-note', text: 'Точки з координатами беруться з розрахунку штурмана (вкладка «Штурман» → «Координати пунктів»). Час — місцевий (Київ, з літнім часом), точність ±1–2 хв; дані довідкові.' }));
    root.append(pointsAnchor);
  }

  paint();
  return root;
}
