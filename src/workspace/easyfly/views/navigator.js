// EasyFLY, екран «Штурман»: новий розрахунок (форма + живий підсумок) і перегляд трьох документів
// (ІШР, Бортжурнал, ШПП) з друком, PDF і Excel (CSV). DOM будується через createElement/textContent;
// документи — у iframe без скриптів (sandbox="allow-same-origin allow-modals"). Логіка — у navigator-core.js.
import './navigator.css';
import { confirmDialog, el, openModal, toast as globalToast } from '../ui.js';
import { addNavFlight, removeNavFlight, updateNavFlight } from '../fly-state.js';
import { icon } from '../icons.js';
import { EQUIPMENT_WEIGHTS, normalizeLegs, kgToLiters } from '../nav-core.js';
import { renderBortjournalHtml, renderIshrHtml, renderShppHtml } from '../nav-docs.js';
import {
  AIRCRAFT_TYPES,
  DOC_KINDS,
  DOC_ORDER,
  EQUIPMENT_KEYS,
  EQUIPMENT_LABELS,
  POINT_KINDS,
  SURCHARGE_TOGGLES,
  csvBytes,
  csvFileName,
  dateUk,
  defaultDraft,
  defaultNavTitle,
  demoDraft,
  docRows,
  draftToSavedFlight,
  flightToDraft,
  fmtDuration,
  fmtInt,
  fuelForPreset,
  fuelPresetsFor,
  navSession,
  newLeg,
  parseNum,
  signersNote,
  summarize,
} from './navigator-core.js';

const RENDERERS = { ishr: renderIshrHtml, bortjournal: renderBortjournalHtml, shpp: renderShppHtml };
/** Розмір аркуша A4 альбомного в CSS-пікселях (297 × 210 мм при 96 dpi). */
const SHEET_W = 1123;
const SHEET_H = 794;
const SCREEN_PADDING = '<style>@media screen{html{padding:6mm 8mm;box-sizing:border-box}}</style>';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** Кнопка екрана: variant 'primary' | 'secondary' | 'ghost'. */
function btn(label, { variant = 'secondary', iconName = null, onClick = null, title = null, disabled = false, small = false, ariaLabel = null } = {}) {
  return el('button', {
    type: 'button',
    class: `nv-btn${variant === 'primary' ? ' nv-btn-primary' : ''}${variant === 'ghost' ? ' nv-btn-ghost' : ''}${small ? ' nv-btn-sm' : ''}`,
    title,
    disabled,
    'aria-label': ariaLabel,
    onClick,
  }, iconName ? icon(iconName, 16) : null, label ? el('span', { text: label }) : null);
}

/** Підпис + елемент керування в одному <label>. */
function field(label, control, { hint = null, cls = '' } = {}) {
  return el('label', { class: `nv-field ${cls}`.trim() },
    el('span', { class: 'nv-label', text: label }), control, hint ? el('small', { class: 'nv-hint', text: hint }) : null);
}

function card(title, note, ...children) {
  return el('section', { class: 'nv-card' },
    el('div', { class: 'nv-card-head' }, el('h2', { text: title }), note ? el('span', { class: 'nv-card-note', text: note }) : null),
    children);
}

export function render(ctx) {
  const unit = ctx.data?.unit || {};
  if (!navSession.draft) navSession.draft = defaultDraft({ today: ctx.today, unit });
  const requested = ctx.params?.tab || ctx.route?.params?.tab;
  if (requested === 'calc' || DOC_KINDS[requested]) navSession.tab = requested;
  const root = el('div', { class: 'nv-root' });
  const toastBox = el('div', { class: 'nv-toast', role: 'status', 'aria-live': 'polite', hidden: true });
  let toastTimer = 0;
  const toast = (message, tone = 'ok') => {
    toastBox.className = `nv-toast${tone === 'error' ? ' nv-toast-error' : ''}`;
    toastBox.textContent = message;
    toastBox.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastBox.hidden = true; }, tone === 'error' ? 9000 : 5000);
  };
  const paint = () => {
    root.replaceChildren();
    const tab = navSession.tab;
    const body = tab === 'calc' ? calcScreen() : docScreen(tab);
    root.append(body, toastBox);
  };
  const switchTab = tab => { navSession.tab = tab; paint(); };

  function tabsBar(active) {
    const items = [{ id: 'calc', label: 'Розрахунок' }, ...DOC_ORDER.map(id => ({ id, label: DOC_KINDS[id].tab }))];
    return el('div', { class: 'nv-tabs', role: 'tablist', 'aria-label': 'Розділи штурмана' },
      items.map(item => el('button', {
        type: 'button', class: 'nv-tab', role: 'tab', 'aria-selected': String(item.id === active),
        onClick: () => switchTab(item.id),
      }, item.label)));
  }

  function header({ crumb, title, subtitle, actions }) {
    return el('header', { class: 'nv-head' },
      el('div', { class: 'nv-titles' },
        el('nav', { class: 'nv-crumbs', 'aria-label': 'Розташування' },
          el('span', { text: 'EasyFLY' }), el('span', { text: 'Штурман' }), el('span', { text: crumb, 'aria-current': 'page' })),
        el('h1', { class: 'nv-title', text: title }),
        el('p', { class: 'nv-sub', text: subtitle })),
      el('div', { class: 'nv-actions' }, actions));
  }

  // ───────────────────────────── Розрахунок ─────────────────────────────

  function calcScreen() {
    const d = navSession.draft;
    const updaters = [];
    const changed = () => updaters.forEach(fn => fn());

    /** Текстове/числове поле, прив'язане до чернетки. */
    const bound = (get, set, { type = 'text', inputMode = null, placeholder = '', maxLength = null, list = null, label = '' } = {}) => {
      const input = el('input', {
        class: 'nv-input', type, value: get() ?? '', placeholder, inputmode: inputMode, maxlength: maxLength,
        list, autocomplete: 'off', spellcheck: 'false', 'aria-label': label || null,
      });
      input.addEventListener('input', () => { set(input.value); changed(); });
      return input;
    };
    const num = (get, set, extra = {}) => bound(get, set, { inputMode: 'decimal', ...extra });

    // — Політ —
    const typeSelect = el('select', { class: 'nv-input' },
      AIRCRAFT_TYPES.map(type => el('option', { value: type.id, selected: type.id === d.typeId, text: type.label })));
    typeSelect.value = d.typeId;
    const flightCard = card('Політ', null,
      el('div', { class: 'nv-grid' },
        field('Дата', bound(() => dateUk(d.date) || d.date, v => { d.date = v; }, { placeholder: 'дд.мм.рррр', inputMode: 'numeric', maxLength: 10 })),
        field('Вправа', bound(() => d.exercise, v => { d.exercise = v; }, { placeholder: '№ 14', maxLength: 20 })),
        field('Позивний', bound(() => d.callsign, v => { d.callsign = v; }, { maxLength: 40 })),
        field('Тип ПС', typeSelect),
        field('Борт №', bound(() => d.board, v => { d.board = v; }, { placeholder: 'вручну', maxLength: 20 }), { hint: 'Номер борта вписується вручну.' }),
        field('Точка вильоту', bound(() => d.departure.name, v => { d.departure.name = v; paintCoordsLabel(); }, { placeholder: 'аер. Зоря', maxLength: 60 }), { cls: 'nv-span-2' })),
      el('details', { class: 'nv-details' },
        el('summary', { text: 'Екіпаж і підписи для бортжурналу та ШПП (необов’язково)' }),
        el('div', { class: 'nv-grid nv-grid-2' },
          field('Командир ПС', bound(() => d.commander, v => { d.commander = v; }, { placeholder: 'капітан Андрій МЕЛЬНИК', maxLength: 80 })),
          field('Штурман', bound(() => d.navigator, v => { d.navigator = v; }, { maxLength: 80 })),
          field('Готовність перевірив', bound(() => d.checker, v => { d.checker = v; }, { maxLength: 80 })),
          field('Командир (ШПП, «ПРІЗВИЩЕ І.П.»)', bound(() => d.captain, v => { d.captain = v; }, { maxLength: 60 })))));

    // — Маса й обладнання —
    const fuelInput = num(() => d.fuelKg, v => { d.fuelKg = v; d.fuelPreset = 'manual'; presetSelect.value = 'manual'; }, { placeholder: 'кг' });
    const fuelLiters = el('small', { class: 'nv-hint' });
    const presetSelect = el('select', { class: 'nv-input', 'aria-label': 'Заправка' });
    const fillPresets = () => {
      const presets = fuelPresetsFor(d.typeId);
      presetSelect.replaceChildren(...presets.map(p => el('option', {
        value: p.id, text: p.kg === null ? p.label : `${p.label}: ${fmtInt(p.kg)} кг · ${fmtInt(p.l)} л`,
      })));
      if (!presets.some(p => p.id === d.fuelPreset)) d.fuelPreset = 'manual';
      presetSelect.value = d.fuelPreset;
    };
    fillPresets();
    presetSelect.addEventListener('change', () => {
      d.fuelPreset = presetSelect.value;
      const kg = fuelForPreset(d.typeId, d.fuelPreset);
      if (kg !== null) { d.fuelKg = String(kg); fuelInput.value = d.fuelKg; }
      changed();
    });
    typeSelect.addEventListener('change', () => {
      d.typeId = typeSelect.value;
      fillPresets();
      const kg = fuelForPreset(d.typeId, d.fuelPreset);
      if (kg !== null) { d.fuelKg = String(kg); fuelInput.value = d.fuelKg; }
      changed();
    });
    updaters.push(() => {
      const kg = parseNum(d.fuelKg);
      fuelLiters.textContent = kg === null ? 'Літри: —' : `Літри: ${fmtInt(kgToLiters(kg))} л (щільність 0,8 кг/л)`;
    });

    const chips = el('div', { class: 'nv-chips', role: 'group', 'aria-label': 'Нарахування до витрати палива й бронь' });
    const chipFor = (label, pressed, onToggle) => {
      const chip = el('button', { type: 'button', class: 'nv-chip', 'aria-pressed': String(pressed) });
      chip.textContent = label;
      chip.addEventListener('click', () => {
        const now = chip.getAttribute('aria-pressed') !== 'true';
        chip.setAttribute('aria-pressed', String(now));
        onToggle(now);
        changed();
      });
      return chip;
    };
    for (const item of SURCHARGE_TOGGLES) chips.append(chipFor(item.label, d.toggles[item.id], on => { d.toggles[item.id] = on; }));
    chips.append(chipFor('Бронь', Boolean(d.equipment.armor), on => { d.equipment.armor = on; }));
    const autoChip = el('span', { class: 'nv-chip nv-chip-auto', hidden: true });
    chips.append(autoChip);

    const equipBox = el('div', { class: 'nv-equip' });
    const addSelect = el('select', { class: 'nv-input' });
    const paintEquipment = () => {
      equipBox.replaceChildren();
      for (const key of EQUIPMENT_KEYS) {
        if (key === 'armor' || !hasOwn(d.equipment, key)) continue;
        const weightCell = el('span', { class: 'nv-equip-w' });
        const sync = () => {
          const count = parseNum(d.equipment[key]) ?? 0;
          weightCell.textContent = `${fmtInt(count * EQUIPMENT_WEIGHTS[key])} кг`;
        };
        const input = num(() => d.equipment[key], v => { d.equipment[key] = v; sync(); }, { placeholder: 'шт.', label: `${EQUIPMENT_LABELS[key]}, кількість` });
        sync();
        equipBox.append(el('div', { class: 'nv-equip-row' },
          el('span', { class: 'nv-equip-name', text: `${EQUIPMENT_LABELS[key]} · ${String(EQUIPMENT_WEIGHTS[key]).replace('.', ',')} кг/шт.` }),
          input, weightCell,
          btn('', { iconName: 'zakryty', small: true, ariaLabel: `Прибрати: ${EQUIPMENT_LABELS[key]}`, title: 'Прибрати', onClick: () => { delete d.equipment[key]; paintEquipment(); changed(); } })));
      }
      const free = EQUIPMENT_KEYS.filter(key => key !== 'armor' && !hasOwn(d.equipment, key));
      addSelect.replaceChildren(el('option', { value: '', text: free.length ? 'Додати обладнання…' : 'Усе обладнання додано' }),
        ...free.map(key => el('option', { value: key, text: `${EQUIPMENT_LABELS[key]} · ${String(EQUIPMENT_WEIGHTS[key]).replace('.', ',')} кг/шт.` })));
      addSelect.disabled = free.length === 0;
    };
    addSelect.addEventListener('change', () => {
      const key = addSelect.value;
      if (!key) return;
      d.equipment[key] = '';
      paintEquipment();
      changed();
      const rows = equipBox.querySelectorAll('.nv-equip-row input');
      const last = [...rows].find(input => input.value === '');
      if (last) last.focus();
    });
    paintEquipment();
    updaters.push(() => {
      const trusses = (parseNum(d.equipment.trusses) ?? 0) > 0;
      const blocks = (parseNum(d.equipment.blocksB8V20) ?? 0) > 0 || (parseNum(d.equipment.blocksB8V8) ?? 0) > 0;
      autoChip.hidden = !trusses;
      autoChip.textContent = blocks ? '+ ферми і блок (авто)' : '+ ферми (авто)';
    });

    const massCard = card('Маса й обладнання', 'кг',
      el('div', { class: 'nv-grid nv-grid-3' },
        field('Порожнє ПС, кг', num(() => d.empty, v => { d.empty = v; }, { placeholder: 'вручну' }), { hint: 'Вага порожнього ПС вводиться вручну.' }),
        field('Екіпаж, кг', num(() => d.crew, v => { d.crew = v; }, { placeholder: '270' })),
        field('Інший вантаж, кг', num(() => d.cargoOther, v => { d.cargoOther = v; }, { placeholder: '0' }))),
      el('div', { class: 'nv-grid nv-grid-2', style: 'margin-top:12px' },
        field('Заправка', presetSelect),
        field('Паливо, кг', fuelInput, { hint: null })),
      fuelLiters, chips, equipBox,
      el('div', { class: 'nv-add-row' }, field('Обладнання зі списку', addSelect)));

    // — Маршрут —
    const totalKm = el('span', { class: 'nv-total' });
    const returnList = el('datalist', { id: 'nv-return-list' });
    const tbody = el('tbody');
    const routeTable = el('table', { class: 'nv-route' },
      el('thead', {}, el('tr', {}, ['№', 'Пункт', 'МШК, °', 'Висота, м', 'V, км/год', 'S, км', 'Посадка на майданчик', 't заданий, хв', ''].map((label, i) =>
        el('th', { scope: 'col', text: label, class: i === 8 ? 'nv-sr' : null })))),
      tbody);
    const paintRoute = () => {
      tbody.replaceChildren();
      d.legs.forEach((leg, i) => {
        const kind = el('select', { class: 'nv-input', 'aria-label': `Ділянка ${i + 1}: вид пункту` },
          POINT_KINDS.map(k => el('option', { value: k.value, text: k.label, selected: k.value === leg.kind })));
        kind.value = leg.kind;
        kind.addEventListener('change', () => { leg.kind = kind.value; changed(); });
        const land = el('input', { type: 'checkbox', checked: leg.landing === true, 'aria-label': `Ділянка ${i + 1}: посадка на майданчик` });
        land.addEventListener('change', () => { leg.landing = land.checked; changed(); });
        const cell = (label, cls, ...nodes) => el('td', { 'data-label': label, class: cls }, nodes);
        tbody.append(el('tr', {},
          cell('Ділянка', 'nv-n', String(i + 1)),
          cell('Пункт', 'nv-point', el('div', { class: 'nv-point-cell' }, kind,
            bound(() => leg.name, v => { leg.name = v; }, { placeholder: 'назва пункту', maxLength: 60, label: `Ділянка ${i + 1}: назва пункту` }))),
          cell('МШК, °', 'nv-num', num(() => leg.mshk, v => { leg.mshk = v; }, { label: `Ділянка ${i + 1}: МШК` })),
          cell('Висота, м', 'nv-num', num(() => leg.h, v => { leg.h = v; }, { label: `Ділянка ${i + 1}: висота` })),
          cell('V, км/год', 'nv-num', num(() => leg.v, v => { leg.v = v; }, { label: `Ділянка ${i + 1}: швидкість` })),
          cell('S, км', 'nv-num', num(() => leg.s, v => { leg.s = v; }, { label: `Ділянка ${i + 1}: відстань` })),
          cell('Посадка на майданчик', 'nv-land', land),
          cell('t заданий, хв', 'nv-num', num(() => leg.tTarget, v => { leg.tTarget = v; }, { placeholder: 'авто', label: `Ділянка ${i + 1}: заданий час` })),
          el('td', { class: 'nv-del' }, btn('Прибрати', {
            small: true, iconName: 'zakryty', disabled: d.legs.length <= 1, ariaLabel: `Прибрати ділянку ${i + 1}`,
            onClick: () => { d.legs.splice(i, 1); paintRoute(); changed(); },
          }))));
      });
    };
    paintRoute();
    updaters.push(() => {
      const s = summarize(d, unit);
      totalKm.textContent = `Разом: ${fmtInt(s.totalKm)} км`;
      returnList.replaceChildren(...normalizeLegs(s.flight).map(leg => el('option', { value: leg.label })));
    });
    const coordsBox = el('div', { class: 'nv-coords' });
    const coordInput = (get, set, label) => bound(get, set, { inputMode: 'decimal', placeholder: label, label });
    const paintCoords = () => {
      coordsBox.replaceChildren(
        el('div', { class: 'nv-coord-row' }, el('span', { class: 'nv-coord-name', text: `ВПМ · ${d.departure.name || 'аеродром вильоту'}` }),
          coordInput(() => d.departure.lat, v => { d.departure.lat = v; }, 'широта'), coordInput(() => d.departure.lon, v => { d.departure.lon = v; }, 'довгота')),
        ...d.legs.map((leg, i) => el('div', { class: 'nv-coord-row' },
          el('span', { class: 'nv-coord-name', text: `${i + 1} · ${(POINT_KINDS.find(k => k.value === leg.kind) || {}).label || ''} ${leg.name}`.trim() }),
          coordInput(() => leg.lat, v => { leg.lat = v; }, 'широта'), coordInput(() => leg.lon, v => { leg.lon = v; }, 'довгота'))));
    };
    paintCoords();
    const coordsDetails = el('details', { class: 'nv-details' },
      el('summary', { text: 'Координати пунктів (необов’язково): для таблиці Сонця в бортжурналі та екрана «Сонце і Місяць»' }), coordsBox);
    coordsDetails.addEventListener('toggle', () => { if (coordsDetails.open) paintCoords(); });

    const addLeg = () => {
      const last = d.legs[d.legs.length - 1];
      const fresh = newLeg('ppm');
      if (last && last.kind === 'kpm') d.legs.splice(d.legs.length - 1, 0, fresh);
      else d.legs.push(fresh);
      paintRoute();
      changed();
      const index = d.legs.indexOf(fresh);
      const row = tbody.children[index];
      const nameInput = row && row.querySelector('.nv-point-cell input');
      if (nameInput) nameInput.focus();
    };
    const routeCard = el('section', { class: 'nv-card' },
      el('div', { class: 'nv-card-head' }, el('h2', { text: 'Маршрут' }), totalKm),
      el('p', { class: 'nv-hint', style: 'margin:-6px 0 10px', text: 'Виліт — з поля «Точка вильоту» (ВПМ); нижче — ділянки маршруту.' }),
      el('div', { class: 'nv-route-wrap' }, routeTable),
      el('div', { class: 'nv-route-foot' },
        btn('Додати пункт', { iconName: 'vnesty', small: true, onClick: addLeg }),
        el('span', { class: 'nv-hint', text: 'Остання ділянка — КПМ (аеродром посадки). «Посадка на майданчик» додає коло 5 км / 5 хв.' })),
      coordsDetails);
    function paintCoordsLabel() { if (coordsDetails.open) paintCoords(); }

    // — Умови —
    const condCard = card('Умови', null,
      el('div', { class: 'nv-grid' },
        field('Вітер розрахунковий: звідки, °', num(() => d.wind.from, v => { d.wind.from = v; }, { placeholder: '270' })),
        field('Вітер розрахунковий: швидкість, м/с', num(() => d.wind.speedMs, v => { d.wind.speedMs = v; }, { placeholder: '8' })),
        field('Вітер виправлений: звідки, °', num(() => d.windActual.from, v => { d.windActual.from = v; }, { placeholder: '250' })),
        field('Вітер виправлений: швидкість, м/с', num(() => d.windActual.speedMs, v => { d.windActual.speedMs = v; }, { placeholder: '10' })),
        field('Тиск на аеродромі QFE, мм рт. ст.', num(() => d.qfe, v => { d.qfe = v; }, { placeholder: '748' })),
        field('Тиск на рівні моря QNH, гПа', num(() => d.qnh, v => { d.qnh = v; }, { placeholder: '1012' })),
        field('Температура t₀, °C', num(() => d.t0, v => { d.t0 = v; }, { placeholder: '+12' })),
        field('Час зльоту, ГГ:ХВ', bound(() => d.takeoff, v => { d.takeoff = v; }, { placeholder: '09:00', maxLength: 5, inputMode: 'numeric' })),
        field('Нмін., м', num(() => d.hMin, v => { d.hMin = v; }, { placeholder: '100' })),
        field('Рубіж повернення', bound(() => d.returnLine, v => { d.returnLine = v; }, { list: 'nv-return-list', maxLength: 60 })),
        field('Робота на землі, хв', num(() => d.groundMin, v => { d.groundMin = v; }, { placeholder: '10' })),
        field('Навігаційний запас, хв', num(() => d.reserveMin, v => { d.reserveMin = v; }, { placeholder: '30' }))),
      returnList);

    // — Підсумок —
    const summaryBox = el('aside', { class: 'nv-card nv-summary', 'aria-label': 'Живий підсумок' });
    const paintSummary = () => {
      const s = summarize(d, unit);
      const row = (label, value) => el('div', { class: 'nv-sum-row' }, el('span', { text: label }), el('strong', { text: value }));
      const kg = value => (value === null || value === undefined ? '—' : `${fmtInt(value)} кг`);
      const statusClass = s.massOk === false ? 'nv-status-bad' : s.massOk === true ? 'nv-status-ok' : 'nv-status-none';
      const statusMark = s.massOk === false ? '✕ ' : s.massOk === true ? '✓ ' : '';
      const docsRow = el('div', { class: 'nv-docs-row' }, DOC_ORDER.map(id => btn(DOC_KINDS[id].tab, {
        variant: id === 'ishr' ? 'primary' : 'secondary', disabled: s.blocking,
        title: s.blocking ? 'Спершу заповніть дані розрахунку' : `Переглянути: ${DOC_KINDS[id].tab}`,
        onClick: () => switchTab(id),
      })));
      summaryBox.replaceChildren(...[
        el('h2', { text: 'Живий підсумок' }),
        el('div', { class: 'nv-sum-rows' },
          row('Порожнє ПС', kg(s.empty)), row('Екіпаж', kg(s.crew)), row('Пальне', kg(s.fuelKg)), row('Обладнання і вантаж', kg(s.cargo))),
        el('div', { class: 'nv-mass' },
          el('div', { class: 'nv-mass-label', text: 'Злітна маса' }),
          el('div', { class: 'nv-mass-value' }, s.total === null ? '—' : fmtInt(s.total), s.total === null ? null : el('small', { text: 'кг' }))),
        el('div', { class: `nv-status ${statusClass}`, role: 'status', text: `${statusMark}${s.massLine}` }),
        el('div', { class: 'nv-sum-rows' },
          row('Витрата в повітрі', s.qAir === null ? '—' : `${fmtInt(s.qAir)} кг/год`),
          row('Витрата на землі', s.qGround === null ? '—' : `${fmtInt(s.qGround)} кг/год`),
          row('Час з вітром', s.airTimeMin === null ? '—' : fmtDuration(s.airTimeMin)),
          row('Пальне на маршрут', s.routeFuelKg === null ? '—' : `${fmtInt(s.routeFuelKg)} кг`),
          row(`Навігаційний запас · ${fmtInt(s.reserveMin)} хв`, s.reserveKg === null ? '—' : `${fmtInt(s.reserveKg)} кг`),
          row('Залишок після НЗ', s.remainKg === null ? '—' : `${fmtInt(s.remainKg)} кг`)),
        s.issues.length ? el('ul', { class: 'nv-list nv-list-bad', 'aria-label': 'Що потрібно виправити' }, s.issues.map(message => el('li', { text: message }))) : null,
        s.warnings.length ? el('ul', { class: 'nv-list nv-list-warn', 'aria-label': 'Попередження' }, s.warnings.map(message => el('li', { text: message }))) : null,
        el('p', { class: `nv-state nv-state-${s.state}` }, 'Попередній перегляд; граничні значення маси й палива — довідкові. Стан розрахунку: ', el('strong', { text: s.stateText })),
        el('div', { class: 'nv-docs' }, el('span', { class: 'nv-docs-title', text: 'Переглянути аркуш' }), docsRow),
        el('p', { class: 'nv-note', text: signersNote(unit) })].filter(Boolean));
    };
    updaters.push(paintSummary);
    changed();

    // — Збережені розрахунки (колекція navFlights файлу .easyfly) —
    const saved = Array.isArray(ctx.data?.navFlights) ? ctx.data.navFlights : [];
    const errorText = result => (result?.result?.errors || result?.errors || ['Не вдалося виконати дію.']).join(' ');
    const askTitle = (heading, initial, confirmLabel, onSubmit) => {
      const input = el('input', { class: 'nv-input', type: 'text', value: initial, maxlength: 120, autocomplete: 'off', 'aria-label': 'Назва розрахунку' });
      openModal({
        title: heading,
        content: el('div', { class: 'nv-field' }, el('span', { class: 'nv-label', text: 'Назва' }), input,
          el('small', { class: 'nv-hint', text: 'Позивні й умовні назви; прізвища не вносьте.' })),
        actions: [{ label: 'Скасувати' }, { label: confirmLabel, variant: 'primary', onClick: () => onSubmit(input.value) }],
      });
    };
    const saveCurrent = () => {
      const s = summarize(navSession.draft, unit);
      if (s.blocking) { toast(`Спершу виправте дані: ${s.issues[0] || 'розрахунок неповний'}`, 'error'); return; }
      askTitle('Зберегти розрахунок', defaultNavTitle(navSession.draft), 'Зберегти', value => {
        const result = ctx.mutate(d => addNavFlight(d, { title: value, flight: draftToSavedFlight(navSession.draft), savedAt: new Date().toISOString() }));
        if (!result.ok) { toast(errorText(result), 'error'); return false; }
        globalToast('Розрахунок додано до даних. Щоб записати його у файл, натисніть «Зберегти» у верхній смузі.');
        return true;
      });
    };
    const savedCard = card('Збережені розрахунки', 'у файлі .easyfly',
      saved.length
        ? el('ul', { class: 'nv-saved', 'aria-label': 'Збережені розрахунки' }, saved.map(item => el('li', { class: 'nv-saved-item', 'data-id': item.id },
          el('div', { class: 'nv-saved-title' }, el('strong', { text: item.title }),
            item.savedAt ? el('small', { class: 'nv-hint', text: `збережено ${dateUk(String(item.savedAt).slice(0, 10))}` }) : null),
          el('div', { class: 'nv-saved-actions' },
            btn('Відкрити', { small: true, title: 'Завантажити в форму (поточна чернетка буде замінена)', onClick: () => {
              navSession.draft = flightToDraft(item.flight, { today: ctx.today, unit });
              paint();
              toast(`Відкрито: ${item.title}`);
            } }),
            btn('Перейменувати', { small: true, variant: 'ghost', onClick: () => askTitle('Перейменувати розрахунок', item.title, 'Перейменувати', value => {
              const result = ctx.mutate(d => updateNavFlight(d, item.id, { title: value }));
              if (!result.ok) { toast(errorText(result), 'error'); return false; }
              return true;
            }) }),
            btn('Оновити', { small: true, variant: 'ghost', title: 'Замінити збережені дані поточною формою', onClick: () => {
              const s = summarize(navSession.draft, unit);
              if (s.blocking) { toast(`Спершу виправте дані: ${s.issues[0] || 'розрахунок неповний'}`, 'error'); return; }
              const result = ctx.mutate(d => updateNavFlight(d, item.id, { flight: draftToSavedFlight(navSession.draft), savedAt: new Date().toISOString() }));
              (result.ok ? globalToast : toast)(result.ok ? `Оновлено: ${item.title}` : errorText(result), result.ok ? 'ok' : 'error');
            } }),
            btn('Видалити', { small: true, variant: 'ghost', onClick: async () => {
              const yes = await confirmDialog({ title: 'Видалити розрахунок?', message: `«${item.title}» буде видалено з даних файлу.`, confirmLabel: 'Видалити', danger: true });
              if (!yes) return;
              const result = ctx.mutate(d => removeNavFlight(d, item.id, { confirmed: true }));
              if (!result.ok) toast(errorText(result), 'error');
            } })))))
        : el('p', { class: 'nv-note', text: 'Збережених розрахунків ще немає. Заповніть форму й натисніть «Зберегти розрахунок».' }));

    const actions = [
      btn('Зберегти розрахунок', { variant: 'primary', iconName: 'zberehty', title: 'Додати розрахунок до даних файлу .easyfly', onClick: saveCurrent }),
      btn('Приклад', { title: 'Заповнити синтетичним прикладом (Мі-8МТВ-1, борт № 123)', onClick: () => { navSession.draft = demoDraft({ today: ctx.today, unit }); paint(); } }),
      btn('Очистити', { onClick: () => { navSession.draft = defaultDraft({ today: ctx.today, unit }); paint(); toast('Розрахунок очищено.'); } }),
    ];
    return el('div', {},
      header({ crumb: 'Новий розрахунок', title: 'Новий розрахунок', subtitle: 'Дані польоту й попередній підсумок', actions }),
      tabsBar('calc'),
      el('div', { class: 'nv-layout' }, el('div', { class: 'nv-col' }, savedCard, flightCard, massCard, routeCard, condCard), summaryBox));
  }

  // ───────────────────────────── Документи ─────────────────────────────

  function docScreen(kind) {
    const info = DOC_KINDS[kind];
    const s = summarize(navSession.draft, unit);
    const back = btn('Назад', { iconName: 'nazad', onClick: () => switchTab('calc') });
    if (s.blocking) {
      return el('div', {},
        header({ crumb: info.crumb, title: info.title, subtitle: 'Спершу заповніть дані розрахунку', actions: [back] }),
        tabsBar(kind),
        el('div', { class: 'nv-alert', role: 'alert' }, el('strong', { text: 'Документ ще неможливо сформувати' }),
          el('ul', { class: 'nv-list' }, s.issues.map(message => el('li', { text: message })))));
    }
    let html;
    try {
      html = RENDERERS[kind](s.flight);
    } catch (error) {
      return el('div', {},
        header({ crumb: info.crumb, title: info.title, subtitle: 'Помилка формування документа', actions: [back] }),
        tabsBar(kind),
        el('div', { class: 'nv-alert', role: 'alert' }, el('strong', { text: 'Не вдалося сформувати документ' }), el('div', { text: error?.message || String(error) })));
    }
    html = html.replace('</head>', `${SCREEN_PADDING}</head>`);

    const frame = el('iframe', {
      class: 'nv-frame', title: info.title, sandbox: 'allow-same-origin allow-modals', srcdoc: html,
      width: SHEET_W, height: SHEET_H, referrerpolicy: 'no-referrer',
    });
    const sheet = el('div', { class: 'nv-sheet' }, frame);
    const stage = el('div', { class: 'nv-stage' }, sheet);
    const percent = el('output', { 'aria-live': 'polite' });
    let sheetH = SHEET_H;
    const applyScale = () => {
      const avail = Math.max(240, stage.clientWidth - (stage.clientWidth < 700 ? 24 : 48));
      const fit = Math.min(avail / SHEET_W, 1.6);
      const k = fit * navSession.zoom;
      sheet.style.width = `${Math.round(SHEET_W * k)}px`;
      sheet.style.height = `${Math.round(sheetH * k)}px`;
      frame.style.width = `${SHEET_W}px`;
      frame.style.height = `${sheetH}px`;
      frame.style.transform = `scale(${k})`;
      percent.textContent = `${Math.round(k * 100)} %`;
    };
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        if (doc) sheetH = Math.max(SHEET_H, doc.documentElement.scrollHeight);
      } catch { /* документ недоступний — лишаємо розмір A4 */ }
      applyScale();
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(applyScale).observe(stage);
    else window.addEventListener('resize', applyScale);
    queueMicrotask(applyScale);

    const zoom = factor => { navSession.zoom = Math.min(4, Math.max(0.5, Math.round(navSession.zoom * factor * 100) / 100)); applyScale(); };
    const doPrint = hint => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        if (hint) toast(hint);
      } catch (error) {
        toast(`Не вдалося відкрити вікно друку: ${error?.message || error}`, 'error');
      }
    };
    const doExcel = async () => {
      try {
        const bytes = csvBytes(docRows(kind, s.flight));
        const name = csvFileName(kind, s.flight);
        if (ctx.host && typeof ctx.host.saveFileAs === 'function') {
          const saved = await ctx.host.saveFileAs({ bytes, suggestedName: name, extensions: ['csv'], title: 'Зберегти таблицю документа', filterName: 'Таблиця CSV' });
          if (saved) toast(`Таблицю збережено: ${saved.name || name}. Її відкриває Excel.`);
        } else {
          const url = URL.createObjectURL(new Blob([bytes], { type: 'text/csv;charset=utf-8' }));
          const link = el('a', { href: url, download: name });
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          toast(`Таблицю завантажено: ${name}.`);
        }
      } catch (error) {
        toast(`Не вдалося зберегти таблицю: ${error?.message || error}`, 'error');
      }
    };

    const actions = [
      back,
      btn('Друк', { iconName: 'druk', onClick: () => doPrint(null) }),
      btn('PDF', { variant: 'primary', title: 'Відкриває вікно друку: оберіть «Зберегти як PDF»', onClick: () => doPrint('У вікні друку оберіть «Зберегти як PDF».') }),
      btn('Excel', { iconName: 'excel', title: 'Таблиця документа у файлі CSV (UTF-8, роздільник «;»)', onClick: doExcel }),
    ];
    return el('div', {},
      header({ crumb: info.crumb, title: info.title, subtitle: info.subtitle, actions }),
      tabsBar(kind),
      el('p', { class: 'nv-hintbar', text: 'Друк і PDF відкривають одне вікно друку (аркуш A4 альбомний): для PDF оберіть «Зберегти як PDF». Excel — таблиця документа у файлі CSV.' }),
      el('section', { class: 'nv-card nv-stage-card' },
        el('div', { class: 'nv-toolbar' },
          el('span', { class: 'nv-card-note', text: 'Аркуш A4, альбомна орієнтація · масштаб за шириною' }),
          el('div', { class: 'nv-zoom' },
            btn('−', { small: true, ariaLabel: 'Зменшити', onClick: () => zoom(1 / 1.25) }), percent,
            btn('+', { small: true, ariaLabel: 'Збільшити', onClick: () => zoom(1.25) }),
            btn('Вписати', { small: true, variant: 'ghost', onClick: () => { navSession.zoom = 1; applyScale(); } }))),
        stage),
      el('div', { class: 'nv-foot' },
        el('span', { text: `${s.type ? s.type.label : ''} · борт № ${s.flight.board || '—'} · ${fmtInt(s.totalKm)} км` }),
        el('span', { text: 'Офлайн-перегляд' })),
      el('p', { class: 'nv-note', text: signersNote(unit) }));
  }

  paint();
  return root;
}
