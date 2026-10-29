// «Сонце і Місяць» у «Робочому середовищі» → «Обстановка» (поряд із «Погодою»): схід, захід, сутінки
// й Місяць для вибраного пункту. Чиста логіка без DOM, мережі й Date.now (дату передає виклик).
// Обчислення офлайн — ті самі модулі, що в EasyFLY (sun-core.js, moon-core.js); час — київський,
// з літнім часом. Пункти беруться з «Погоди» (лише читання) і з власного списку застосунку;
// нічого назовні не надсилається.
import { addDays, formatDateIso, formatDateUk, parseDate, sunTimes } from '../easyfly/sun-core.js';
import { moonDay } from '../easyfly/moon-core.js';
import { MAX_PLACES, parsePlace, parseState as parseWeatherState } from '../weather/weather-core.js';

export const SUN_STORAGE_KEY = 'easywar.workspace.sun.v1';

/** Рядки Сонця в порядку доби: ключ у sunTimes, підпис, пояснення. */
export const SUN_ROWS = Object.freeze([
  { key: 'nauticalDawn', label: 'Навігаційний світанок', note: 'Сонце на 12° під горизонтом' },
  { key: 'dawn', label: 'Світанок', note: 'початок цивільних сутінків' },
  { key: 'sunrise', label: 'Схід', note: 'верхній край Сонця' },
  { key: 'sunset', label: 'Захід', note: 'верхній край Сонця' },
  { key: 'dusk', label: 'Настання темряви', note: 'кінець цивільних сутінків' },
  { key: 'nauticalDusk', label: 'Навігаційна темрява', note: 'Сонце на 12° під горизонтом' },
]);

const EMPTY = '—';

/** Сьогоднішня дата за годинником пристрою як «РРРР-ММ-ДД». */
export function todayIso(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Зсув дати на `days` діб; невірна дата дає порожній рядок. */
export function shiftDate(iso, days) {
  const date = parseDate(iso);
  return date ? formatDateIso(addDays(date, days)) : '';
}

/** Година Місяця з позначкою доби: «02:10 (+1)», якщо подія після півночі наступної доби. */
function moonClock(value, nextDay) {
  if (!value) return EMPTY;
  return nextDay ? `${value} (+1)` : value;
}

/**
 * Дані блоку «Сонце і Місяць» для пункту й дати.
 * @param {{name?:string, latitude:number, longitude:number}|null} place пункт з координатами
 * @param {string} dateInput доба «РРРР-ММ-ДД»
 * @returns {null|{date:string, dateLabel:string, sun:Array, dayLength:string, polar:boolean, moon:object}}
 *   null, якщо немає пункту з координатами або дата нерозпізнана.
 */
export function skyView(place, dateInput) {
  const date = parseDate(dateInput);
  if (!place || !date || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  const sun = sunTimes(date, place.latitude, place.longitude);
  const moon = moonDay(date, place.latitude, place.longitude);
  const rows = SUN_ROWS.map(row => ({ key: row.key, label: row.label, note: row.note, value: sun[row.key] || EMPTY }));
  const polar = rows.some(row => row.value === EMPTY);
  return {
    date: formatDateIso(date),
    dateLabel: formatDateUk(date),
    sun: rows,
    dayLength: sun.dayLength || EMPTY,
    polar,
    moon: {
      rise: moonClock(moon.rise, moon.riseNextDay),
      set: moonClock(moon.set, moon.setNextDay),
      phase: moon.phase,
      illumination: `${moon.illumination}%`,
      note: moon.waxing ? 'зростає' : 'спадає',
    },
  };
}

/** Порожній стан застосунку: власні пункти й вибраний пункт. */
export function emptySunState() {
  return { places: [], selected: '' };
}

/** Стан зі сховища; зламане чи чуже — порожній стан. Пункти проходять ту саму перевірку, що в «Погоді». */
export function parseSunState(raw) {
  const state = emptySunState();
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return state;
  }
  if (!data || typeof data !== 'object') return state;
  const seen = new Set();
  for (const item of Array.isArray(data.places) ? data.places : []) {
    const { place } = parsePlace(item || {});
    if (!place || seen.has(place.id) || state.places.length >= MAX_PLACES) continue;
    seen.add(place.id);
    state.places.push(place);
  }
  state.selected = typeof data.selected === 'string' ? data.selected : '';
  return state;
}

export function serializeSunState(state) {
  return JSON.stringify({ places: state.places, selected: state.selected });
}

/** Пункти «Погоди» зі сховища (лише читання); зламане — порожній список. */
export function weatherPlaces(rawWeatherState) {
  return parseWeatherState(rawWeatherState).places;
}

/**
 * Усі пункти для вибору: спершу з «Погоди», потім власні (без повторів за id).
 * `own: true` — пункт можна прибрати тут; пункти «Погоди» прибирають у «Погоді».
 */
export function allPlaces(weather, own) {
  const seen = new Set();
  const out = [];
  for (const [list, isOwn] of [[weather, false], [own, true]]) {
    for (const place of list) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      out.push({ ...place, own: isOwn });
    }
  }
  return out;
}

/** Вибраний пункт: збережений, якщо ще існує, інакше перший; без пунктів — null. */
export function pickPlace(places, selected) {
  return places.find(place => place.id === selected) || places[0] || null;
}

/** Додає власний пункт (назва, широта, довгота) або повертає { error }. */
export function addOwnPlace(state, input, weather = []) {
  const parsed = parsePlace(input);
  if (parsed.error) return { error: parsed.error };
  const { place } = parsed;
  if (allPlaces(weather, state.places).some(item => item.id === place.id)) return { error: 'Такий пункт уже є в списку.' };
  if (state.places.length >= MAX_PLACES) return { error: `Не більше ${MAX_PLACES} власних пунктів.` };
  return { state: { places: [...state.places, place], selected: place.id }, place };
}

/** Прибирає власний пункт; вибір скидається на перший наявний. */
export function removeOwnPlace(state, id) {
  const places = state.places.filter(place => place.id !== id);
  return { places, selected: state.selected === id ? '' : state.selected };
}
