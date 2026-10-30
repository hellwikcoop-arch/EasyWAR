// «Сонце і Місяць» у «Робочому середовищі» → «Обстановка» (контракт docs/WORKSPACE.md): схід, захід,
// цивільні й навігаційні сутінки, тривалість дня та Місяць для вибраного пункту на вибрану дату.
// Усе обчислюється офлайн (модулі EasyFLY), мережі немає. Пункти — з «Погоди» (лише читання) і власні;
// власні пункти й вибір — дані профілю (host.profile, profile-store.js): зберігаються самі,
// зашифровані, у прихованій теці застосунку.
import {
  SUN_PROFILE_KEY,
  SUN_STORAGE_KEY,
  addOwnPlace,
  allPlaces,
  emptySunState,
  parseSunState,
  pickPlace,
  removeOwnPlace,
  serializeSunState,
  shiftDate,
  skyView,
  todayIso,
  weatherPlaces,
} from './sun-view-core.js';
import { loadText, safeLocalStorage } from '../profile-store.js';
import { PROFILE_KEY as WEATHER_PROFILE_KEY, STORAGE_KEY as WEATHER_STORAGE_KEY, placeLabel } from '../weather/weather-core.js';
import './sun.css';

export const contract = 1;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className = '') {
  const node = el('button', `sn-btn ${className}`.trim(), text);
  node.type = 'button';
  return node;
}

function input(name, placeholder, mode = 'text') {
  const node = el('input');
  node.name = name;
  node.placeholder = placeholder;
  node.inputMode = mode;
  node.autocomplete = 'off';
  return node;
}

function field(label, control) {
  const wrap = el('label', 'sn-field');
  wrap.append(el('span', 'sn-label', label), control);
  return wrap;
}

/** Плитка «підпис — значення — пояснення». */
function tile(label, value, note, className = '') {
  const box = el('div', `sn-tile ${className}`.trim());
  box.append(el('span', 'sn-label', label), el('strong', 'sn-value', value));
  if (note) box.append(el('span', 'sn-note', note));
  return box;
}

export async function mount(container, host) {
  const ownData = await loadText(host.profile, { key: SUN_PROFILE_KEY, legacyStorage: safeLocalStorage(window), legacyKey: SUN_STORAGE_KEY });
  // Пункти «Погоди» лише читаються; зміни в «Погоді» підхоплюються, коли повертаєшся на цю вкладку.
  let weatherText = (await loadText(host.profile, { key: WEATHER_PROFILE_KEY, legacyStorage: safeLocalStorage(window), legacyKey: WEATHER_STORAGE_KEY })).text;
  let state = parseSunState(ownData.text);
  let date = todayIso();

  container.classList.add('sn-root');
  host.setTitle?.('');

  const head = el('header', 'sn-head');
  const titles = el('div', 'sn-titles');
  titles.append(
    el('p', 'sn-kicker', 'Робоче середовище / Обстановка'),
    el('h1', '', 'Сонце і Місяць'),
    el('p', 'sn-lead', 'Схід, захід, сутінки й Місяць у вибраному населеному пункті'),
  );
  head.append(titles, el('p', 'sn-mode', 'Офлайн · мережа не потрібна'));

  // Керування: пункт і дата.
  const controls = el('section', 'sn-controls');
  const select = el('select', 'sn-select');
  select.setAttribute('aria-label', 'Населений пункт');
  const remove = button('Прибрати пункт', 'sn-quiet');
  const placeRow = el('div', 'sn-row');
  placeRow.append(select, remove);
  const placeBox = el('div', 'sn-place');
  placeBox.append(el('span', 'sn-label', 'Населений пункт'), placeRow);

  const dateInput = el('input');
  dateInput.type = 'date';
  dateInput.setAttribute('aria-label', 'Дата');
  const prev = button('‹', 'sn-step');
  prev.setAttribute('aria-label', 'Попередня доба');
  const next = button('›', 'sn-step');
  next.setAttribute('aria-label', 'Наступна доба');
  const today = button('Сьогодні', 'sn-quiet');
  const dateRow = el('div', 'sn-row');
  dateRow.append(prev, dateInput, next, today);
  const dateBox = el('div', 'sn-date');
  dateBox.append(el('span', 'sn-label', 'Дата'), dateRow);
  controls.append(placeBox, dateBox);

  const board = el('section', 'sn-board');
  board.setAttribute('aria-live', 'polite');

  const add = el('details', 'sn-panel');
  const placeName = input('name', 'Назва');
  const placeLat = input('lat', '48,46', 'decimal');
  const placeLon = input('lon', '35,04', 'decimal');
  const placeAdd = button('Додати', 'sn-primary');
  const addRow = el('div', 'sn-row');
  addRow.append(field('Назва', placeName), field('Широта', placeLat), field('Довгота', placeLon), placeAdd);
  add.append(
    el('summary', '', 'Додати населений пункт'),
    el('p', 'sn-hint', 'Пункти з «Погоди» тут уже є. Свій пункт задайте координатами; нічого не надсилається в інтернет.'),
    addRow,
  );

  const status = el('p', 'sn-status');
  status.setAttribute('role', 'status');

  container.replaceChildren(head, controls, board, status, add);

  const weather = () => weatherPlaces(weatherText);
  const places = () => allPlaces(weather(), state.places);
  const current = () => pickPlace(places(), state.selected);

  function say(text, tone = '') {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function save(nextState) {
    state = nextState;
    host.profile.write(SUN_PROFILE_KEY, serializeSunState(state)).catch(error => {
      say(`Зміни не збережено в профілі: ${error?.message || error}`, 'bad');
    });
    render();
  }

  function renderControls() {
    const list = places();
    const place = current();
    select.replaceChildren();
    if (!list.length) {
      select.append(new Option('Немає пунктів — додайте нижче', ''));
      select.disabled = true;
    } else {
      select.disabled = false;
      for (const item of list) select.append(new Option(`${placeLabel(item)}${item.own ? '' : ' · з «Погоди»'}`, item.id));
      select.value = place.id;
    }
    remove.disabled = !place || !place.own;
    remove.title = place && !place.own ? 'Цей пункт додано в «Погоді» — прибирайте його там' : '';
    dateInput.value = date;
  }

  function renderBoard() {
    const place = current();
    if (!place) {
      board.replaceChildren(el('p', 'sn-empty', 'Додайте населений пункт (або оберіть його в «Погоді»), щоб побачити схід, захід і сутінки.'));
      return;
    }
    const view = skyView(place, date);
    if (!view) {
      board.replaceChildren(el('p', 'sn-empty', 'Вкажіть коректну дату.'));
      return;
    }
    const title = el('div', 'sn-board-head');
    title.append(el('h2', '', placeLabel(place)), el('span', 'sn-source', `${view.dateLabel} · київський час · ${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`));

    const sunTitle = el('p', 'sn-section', 'Сонце');
    const sunGrid = el('div', 'sn-grid');
    for (const row of view.sun) {
      const major = row.key === 'sunrise' || row.key === 'sunset' || row.key === 'dusk';
      sunGrid.append(tile(row.label, row.value, row.note, major ? 'sn-major' : ''));
    }
    sunGrid.append(tile('Тривалість дня', view.dayLength, 'від сходу до заходу'));
    const parts = [title, sunTitle, sunGrid];
    if (view.polar) parts.push(el('p', 'sn-warn', 'На цій широті в цю добу частини подій немає (полярний день або ніч).'));

    const moonTitle = el('p', 'sn-section', 'Місяць');
    const moonGrid = el('div', 'sn-grid');
    moonGrid.append(
      tile('Схід Місяця', view.moon.rise, '(+1) — після півночі наступної доби'),
      tile('Захід Місяця', view.moon.set),
      tile('Фаза', view.moon.phase, view.moon.note),
      tile('Освітленість', view.moon.illumination),
    );
    parts.push(moonTitle, moonGrid);
    board.replaceChildren(...parts);
  }

  function render() {
    renderControls();
    renderBoard();
  }

  select.addEventListener('change', () => save({ ...state, selected: select.value }));
  remove.addEventListener('click', () => {
    const place = current();
    if (!place || !place.own) return;
    save(removeOwnPlace(state, place.id));
    say(`Прибрано: ${place.name}.`);
  });
  dateInput.addEventListener('change', () => {
    if (dateInput.value) date = dateInput.value;
    render();
  });
  prev.addEventListener('click', () => { date = shiftDate(date, -1) || date; render(); });
  next.addEventListener('click', () => { date = shiftDate(date, 1) || date; render(); });
  today.addEventListener('click', () => { date = todayIso(); render(); });
  placeAdd.addEventListener('click', () => {
    const added = addOwnPlace(state, { name: placeName.value, latitude: placeLat.value, longitude: placeLon.value }, weather());
    if (added.error) return say(added.error, 'bad');
    placeName.value = placeLat.value = placeLon.value = '';
    add.open = false;
    save(added.state);
    say(`Додано: ${added.place.name}.`);
  });

  render();
  if (ownData.error) say(`Дані профілю недоступні, пункти не збережуться: ${ownData.error}`, 'bad');

  async function refreshWeather() {
    const fresh = (await loadText(host.profile, { key: WEATHER_PROFILE_KEY })).text;
    if (fresh !== weatherText) {
      weatherText = fresh;
      render();
    }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') refreshWeather(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', refreshWeather);

  return {
    unmount() {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refreshWeather);
    },
  };
}
