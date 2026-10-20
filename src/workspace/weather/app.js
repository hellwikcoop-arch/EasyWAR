// «Погода» у «Робочому середовищі» → «Обстановка» (контракт docs/WORKSPACE.md): нижній і верхній край
// хмар, видимість, хмарність, вітер біля землі й на висотах і тиск у вибраному населеному пункті. Дані — вручну або, якщо користувач увімкнув
// онлайн-оновлення, з Open-Meteo через Rust-команди weather_online_fetch / weather_online_search.
// Мережу вимкнено за замовчуванням; перед кожним запитом видно, що саме піде назовні.
// Пункти й останні спостереження зберігаються лише в цьому браузері (localStorage).
import { findInvoke } from '../workspace-host.js';
import {
  REFRESH_MINUTES,
  STORAGE_KEY,
  addPlace,
  disclosureText,
  emptyState,
  manualObservation,
  needsRefresh,
  observationFromOnline,
  observationView,
  parsePlace,
  parseState,
  placeLabel,
  removePlace,
  searchDisclosure,
  serializeState,
} from './weather-core.js';
import { CARD_ICON, WEATHER_ICONS } from './weather-icons.js';
import './weather.css';

// Фото явищ — фрагменти аркуша власника (20.10.2026); префікс workspace- тримає їх поза офлайн-кешем телефона.
const PHOTOS = Object.fromEntries(
  Object.entries(import.meta.glob('./photos/*.webp', { eager: true, query: '?url', import: 'default' }))
    .map(([path, url]) => [path.replace(/^.*workspace-weather-|\.webp$/gu, ''), url]),
);

export const contract = 1;

const CHECK_MS = 60 * 1000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Значок з WEATHER_ICONS (очищені SVG із пакета референсів). */
function icon(name, className = 'wx-icon') {
  const node = el('span', className);
  node.innerHTML = WEATHER_ICONS[name] || '';
  return node;
}

function field(label, input, hint) {
  const wrap = el('label', 'wx-field');
  wrap.append(el('span', 'wx-label', label), input);
  if (hint) wrap.append(el('span', 'wx-hint', hint));
  return wrap;
}

function input(name, placeholder, mode = 'text') {
  const node = el('input');
  node.name = name;
  node.placeholder = placeholder;
  node.inputMode = mode;
  node.autocomplete = 'off';
  return node;
}

function button(text, className = '') {
  const node = el('button', `wx-btn ${className}`.trim(), text);
  node.type = 'button';
  return node;
}

function readState() {
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

function writeState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch {
    /* сховище недоступне: стан живе до закриття */
  }
}

export async function mount(container, host) {
  const invoke = findInvoke(window);
  let state = readState();
  let busy = false;
  let timer = 0;

  container.classList.add('wx-root');
  host.setTitle?.('');

  // Шапка сторінки.
  const head = el('header', 'wx-head');
  const brand = el('span', 'wx-brand');
  brand.innerHTML = CARD_ICON;
  const titles = el('div', 'wx-titles');
  titles.append(
    el('p', 'wx-kicker', 'Робоче середовище / Обстановка'),
    el('h1', '', 'Погода'),
    el('p', 'wx-lead', 'Поточні умови в одному вибраному населеному пункті'),
  );
  const mode = el('p', 'wx-mode');
  head.append(brand, titles, mode);

  // Панель керування: пункт і мережа.
  const controls = el('section', 'wx-controls');
  const placeBox = el('div', 'wx-place');
  const select = el('select', 'wx-select');
  select.setAttribute('aria-label', 'Населений пункт');
  const remove = button('Прибрати пункт', 'wx-quiet');
  const placeRow = el('div', 'wx-row');
  placeRow.append(select, remove);
  placeBox.append(el('span', 'wx-label', 'Населений пункт'), placeRow);

  const net = el('div', 'wx-net');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.setAttribute('role', 'switch');
  const toggleLabel = el('label', 'wx-toggle');
  toggleLabel.append(icon('internet-off'), toggle, el('span', 'wx-toggle-text', 'Онлайн-оновлення з інтернету'));
  const toggleState = el('span', 'wx-toggle-state');
  const refresh = button('Оновити зараз', 'wx-primary');
  const netRow = el('div', 'wx-row wx-net-row');
  netRow.append(toggleLabel, toggleState, refresh);
  const disclosure = el('p', 'wx-disclosure');
  net.append(netRow, disclosure);
  controls.append(placeBox, net);

  // Спостереження.
  const card = el('section', 'wx-card');
  card.setAttribute('aria-live', 'polite');

  // Додавання пункту.
  const add = el('details', 'wx-panel');
  const addSummary = el('summary', '', 'Додати населений пункт');
  const searchRow = el('div', 'wx-row');
  const searchInput = input('search', 'Назва, наприклад Вигадане');
  const searchButton = button('Знайти');
  searchRow.append(field('Пошук за назвою', searchInput), searchButton);
  const searchNote = el('p', 'wx-disclosure');
  const results = el('ul', 'wx-results');
  const manualPlace = el('div', 'wx-row');
  const placeName = input('name', 'Назва');
  const placeLat = input('lat', '48,46', 'decimal');
  const placeLon = input('lon', '35,04', 'decimal');
  const placeAdd = button('Додати');
  manualPlace.append(field('Назва', placeName), field('Широта', placeLat), field('Довгота', placeLon), placeAdd);
  add.append(addSummary, searchRow, searchNote, results, el('p', 'wx-sub', 'Або вкажіть координати самі (без інтернету):'), manualPlace);

  // Ручне введення.
  const manual = el('details', 'wx-panel');
  const manualSummary = el('summary', '', 'Ввести спостереження вручну');
  const manualRow = el('div', 'wx-row');
  const lower = input('lower', '450', 'numeric');
  const upper = input('upper', '1800', 'numeric');
  const visibility = input('visibility', '6', 'decimal');
  const cover = input('cover', '7', 'numeric');
  const windSpeed = input('wind', '5', 'decimal');
  const windDirection = input('windDirection', '70', 'numeric');
  const pressure = input('pressure', '1013 або 760', 'decimal');
  const phenomenon = input('phenomenon', 'дощ, туман…');
  const manualSave = button('Зберегти', 'wx-primary');
  const manualFields = [
    field('Нижній край хмар, м', lower),
    field('Верхній край хмар, м', upper),
    field('Видимість, км', visibility),
    field('Хмарність, бали з 10', cover),
    field('Вітер біля землі, м/с', windSpeed),
    field('Напрям вітру, ° (куди дме)', windDirection),
    field('Тиск, гПа або мм рт. ст.', pressure),
    field('Явище', phenomenon),
  ];
  manualRow.append(...manualFields, manualSave);
  manual.append(manualSummary, manualRow);

  const status = el('p', 'wx-status');
  status.setAttribute('role', 'status');

  container.replaceChildren(head, controls, card, status, add, manual);

  const current = () => state.places.find(place => place.id === state.selected) || null;

  function say(text, tone = '') {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function save(next) {
    state = next;
    writeState(state);
    render();
  }

  function renderPlaces() {
    select.replaceChildren();
    if (!state.places.length) {
      const empty = el('option', '', 'Немає пунктів — додайте нижче');
      empty.value = '';
      select.append(empty);
    }
    for (const place of state.places) {
      const option = el('option', '', placeLabel(place));
      option.value = place.id;
      option.selected = place.id === state.selected;
      select.append(option);
    }
    select.disabled = !state.places.length;
    remove.disabled = !state.places.length;
  }

  function renderNet() {
    toggle.checked = state.online && Boolean(invoke);
    toggle.disabled = !invoke;
    refresh.hidden = !toggle.checked;
    toggleLabel.querySelector('.wx-icon').innerHTML = WEATHER_ICONS[toggle.checked ? 'internet-on' : 'internet-off'];
    toggleState.textContent = !invoke ? 'Недоступно' : (toggle.checked ? 'Увімкнено користувачем' : 'Вимкнено');
    toggleState.dataset.on = toggle.checked ? '1' : '';
    mode.textContent = toggle.checked ? 'Онлайн увімкнено' : 'Офлайн за замовчуванням';
    refresh.disabled = busy || !current();
    searchButton.disabled = busy || !toggle.checked;
    searchInput.disabled = !toggle.checked;
    if (!invoke) disclosure.textContent = 'Онлайн-оновлення працює лише в настільному застосунку EasyWAR. Тут — тільки ручне введення.';
    else if (!toggle.checked) disclosure.textContent = 'Вимкнено: застосунок нічого не надсилає в мережу.';
    else disclosure.textContent = current() ? `${disclosureText(current())}. Оновлення — раз на ${REFRESH_MINUTES} хв, поки застосунок відкритий.` : 'Додайте населений пункт, щоб отримувати погоду.';
    searchNote.textContent = toggle.checked ? searchDisclosure(searchInput.value) : 'Пошук за назвою доступний, коли ввімкнено онлайн-оновлення.';
  }

  function metric(label, value, note, iconName) {
    const box = el('div', 'wx-metric');
    const caption = el('span', 'wx-metric-label');
    if (iconName) caption.append(icon(iconName));
    caption.append(label);
    box.append(caption, el('strong', 'wx-metric-value', value));
    if (note) box.append(el('span', 'wx-metric-note', note));
    return box;
  }

  function aloftTable(rows) {
    const wrap = el('div', 'wx-aloft');
    const table = el('table', 'wx-table');
    table.setAttribute('aria-label', 'Вітер на висотах (над землею)');
    const head = el('tr');
    for (const name of ['Висота', 'Напрям (куди дме)', 'Швидкість']) head.append(el('th', '', name));
    table.append(el('thead'), el('tbody'));
    table.tHead.append(head);
    for (const row of rows) {
      const line = el('tr');
      const height = el('td', '', row.height);
      if (row.level) height.append(el('span', 'wx-metric-note', ` ${row.level}`));
      const direction = el('td');
      const cell = el('span', 'wx-dir');
      if (Number.isFinite(row.toward)) {
        const arrow = icon('wind-direction', 'wx-icon wx-arrow');
        arrow.style.transform = `rotate(${row.toward}deg)`;
        cell.append(arrow);
      }
      cell.append(row.direction);
      direction.append(cell);
      line.append(height, direction, el('td', '', row.speed));
      table.tBodies[0].append(line);
    }
    wrap.append(el('p', 'wx-aloft-title', 'Вітер на висотах (над землею)'), table);
    return wrap;
  }

  function renderCard() {
    const place = current();
    if (!place) {
      card.classList.remove('wx-card-photo');
      card.style.removeProperty('--wx-photo');
      card.replaceChildren(el('p', 'wx-empty', 'Додайте населений пункт, щоб бачити нижній край хмар, видимість і хмарність.'));
      card.dataset.tone = '';
      return;
    }
    const view = observationView(state.observations[place.id]);
    const heading = el('div', 'wx-card-head');
    const name = el('div', 'wx-card-title');
    // Фон картки — фото поточного явища; без даних фону немає, біля назви лишається значок.
    const photoUrl = view?.photo ? PHOTOS[view.photo] : '';
    card.classList.toggle('wx-card-photo', Boolean(photoUrl));
    if (photoUrl) card.style.setProperty('--wx-photo', `url("${photoUrl}")`);
    else card.style.removeProperty('--wx-photo');
    name.append(icon(view?.icon || 'unknown', 'wx-icon wx-icon-big'));
    const titleText = el('div', 'wx-card-name');
    titleText.append(el('h2', '', placeLabel(place)));
    const summary = [view?.temperature, view?.phenomenon].filter(Boolean).join(' · ');
    if (summary) titleText.append(el('span', 'wx-card-phenomenon', summary));
    name.append(titleText);
    heading.append(name);
    if (!view) {
      card.dataset.tone = '';
      card.replaceChildren(heading, el('p', 'wx-empty', toggle.checked ? 'Ще немає даних. Натисніть «Оновити зараз».' : 'Ще немає даних. Введіть спостереження вручну або ввімкніть онлайн-оновлення.'));
      return;
    }
    card.dataset.tone = view.tone;
    heading.append(el('span', `wx-source${view.stale ? ' wx-stale' : ''}`, `${view.source}${view.age ? ` · отримано ${view.age}` : ''}${view.stale ? ' · застаріло' : ''}`));
    const metrics = el('div', 'wx-metrics');
    metrics.append(metric('Нижній край хмар', view.lower, view.lowerNote, 'cloud-base'));
    if (view.hasUpper) metrics.append(metric('Верхній край хмар', view.upper, view.upperNote, 'cloud-top'));
    metrics.append(metric('Видимість', view.visibility, 'горизонтальна', 'visibility'));
    const coverTile = metric('Хмарність', view.cover, view.coverNote, 'cloud-cover');
    if (view.coverIcon) coverTile.append(icon(view.coverIcon, 'wx-icon wx-cover-dial'));
    metrics.append(coverTile);
    const ground = el('div', 'wx-metrics wx-metrics-wide');
    const windTile = metric('Вітер біля землі', view.windGround, view.windNote, 'wind');
    if (view.windsock) {
      const sock = icon(view.windsock, 'wx-icon wx-windsock');
      sock.title = `Сила вітру: ${view.windsockLabel}`;
      sock.setAttribute('role', 'img');
      sock.setAttribute('aria-label', sock.title);
      windTile.append(sock);
    }
    ground.append(
      windTile,
      metric('Атмосферний тиск', view.pressure, view.pressureNote, 'pressure'),
    );
    const hazard = el('p', 'wx-hazard', view.tone ? `${view.toneLabel} · ${view.hazardText}` : view.hazardText);
    const parts = [heading, hazard, metrics, ground];
    if (view.windsAloft.length) parts.push(aloftTable(view.windsAloft));
    card.replaceChildren(...parts);
  }

  function render() {
    renderPlaces();
    renderNet();
    renderCard();
  }

  async function refreshNow({ quiet = false } = {}) {
    const place = current();
    if (!invoke || !state.online || !place || busy) return;
    busy = true;
    renderNet();
    if (!quiet) say('Отримую погоду…');
    try {
      const raw = await invoke('weather_online_fetch', { latitude: place.latitude, longitude: place.longitude });
      const observation = observationFromOnline(raw, new Date());
      save({ ...state, observations: { ...state.observations, [place.id]: observation } });
      say('Погоду оновлено.');
    } catch (error) {
      say(`Не вдалося оновити: ${String(error?.message || error)}. Показано останні збережені дані.`, 'bad');
    } finally {
      busy = false;
      renderNet();
    }
  }

  function tick() {
    const place = current();
    if (state.online && place && needsRefresh(state.observations[place.id])) refreshNow({ quiet: true });
  }

  async function search() {
    const query = searchInput.value.trim();
    if (!invoke || !state.online || busy) return;
    if (query.length < 2) {
      say('Вкажіть щонайменше дві літери назви.', 'warn');
      return;
    }
    busy = true;
    renderNet();
    results.replaceChildren();
    say('Шукаю населений пункт…');
    try {
      const places = await invoke('weather_online_search', { name: query });
      if (!places.length) say('Нічого не знайдено. Спробуйте іншу назву або вкажіть координати самі.', 'warn');
      else say(`Знайдено: ${places.length}. Оберіть потрібний.`);
      for (const found of places) {
        const item = el('li');
        const pick = button(placeLabel(found), 'wx-result');
        pick.addEventListener('click', () => {
          const parsed = parsePlace(found);
          if (parsed.error) return say(parsed.error, 'bad');
          const added = addPlace(state, parsed.place);
          if (added.error) return say(added.error, 'bad');
          results.replaceChildren();
          searchInput.value = '';
          add.open = false;
          save(added.state);
          say(`Додано: ${parsed.place.name}.`);
          refreshNow({ quiet: true });
        });
        item.append(pick);
        results.append(item);
      }
    } catch (error) {
      say(`Пошук не вдався: ${String(error?.message || error)}.`, 'bad');
    } finally {
      busy = false;
      renderNet();
    }
  }

  select.addEventListener('change', () => {
    save({ ...state, selected: select.value });
    tick();
  });
  remove.addEventListener('click', () => {
    const place = current();
    if (!place) return;
    save(removePlace(state, place.id));
    say(`Прибрано: ${place.name}.`);
  });
  toggle.addEventListener('change', () => {
    save({ ...state, online: toggle.checked });
    say(toggle.checked ? 'Онлайн-оновлення ввімкнено.' : 'Онлайн-оновлення вимкнено: нічого не надсилається.');
    if (toggle.checked) tick();
  });
  refresh.addEventListener('click', () => refreshNow());
  searchButton.addEventListener('click', search);
  searchInput.addEventListener('input', renderNet);
  searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') search(); });
  placeAdd.addEventListener('click', () => {
    const parsed = parsePlace({ name: placeName.value, latitude: placeLat.value, longitude: placeLon.value });
    if (parsed.error) return say(parsed.error, 'bad');
    const added = addPlace(state, parsed.place);
    if (added.error) return say(added.error, 'bad');
    placeName.value = placeLat.value = placeLon.value = '';
    add.open = false;
    save(added.state);
    say(`Додано: ${parsed.place.name}.`);
    tick();
  });
  manualSave.addEventListener('click', () => {
    const place = current();
    if (!place) return say('Спершу додайте населений пункт.', 'warn');
    const parsed = manualObservation({
      lower: lower.value,
      upper: upper.value,
      visibility: visibility.value,
      cover: cover.value,
      wind: windSpeed.value,
      windDirection: windDirection.value,
      pressure: pressure.value,
      phenomenon: phenomenon.value,
    });
    if (parsed.error) return say(parsed.error, 'bad');
    for (const node of [lower, upper, visibility, cover, windSpeed, windDirection, pressure, phenomenon]) node.value = '';
    manual.open = false;
    save({ ...state, observations: { ...state.observations, [place.id]: parsed.observation } });
    say('Спостереження збережено.');
  });

  render();
  tick();
  timer = window.setInterval(() => { tick(); renderCard(); }, CHECK_MS);

  return {
    unmount() {
      window.clearInterval(timer);
    },
  };
}
