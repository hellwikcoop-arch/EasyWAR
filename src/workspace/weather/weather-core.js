// Чиста логіка застосунку «Погода» (Робоче середовище → Обстановка): збережені населені пункти,
// перетворення відповіді служби погоди (через Rust-команду weather_online_fetch) і ручного введення
// в одне спостереження — нижній край хмар, видимість, хмарність у балах з 10 — та оцінка небезпеки
// за тими самими порогами, що й картка «Метеоумови». Без DOM і Tauri: перевіряється в node --test.
//
// Мережа вимкнена за замовчуванням (`online: false`). Коли її ввімкнути, назовні йдуть лише
// координати пункту, округлені до 0,01°, або назва, яку шукають, — це й показує disclosureText.

import { weatherHazard, weatherText } from '../../dashboard-module-weather-core.js';

export const STORAGE_KEY = 'easywar.workspace.weather.v1';
/** Як часто оновлювати вибраний пункт, поки застосунок відкритий і мережу ввімкнено. */
export const REFRESH_MINUTES = 30;
/** Старше за це спостереження позначається як застаріле. */
export const STALE_MINUTES = 90;
export const MAX_PLACES = 20;
export const FORECAST_HOST = 'api.open-meteo.com';
export const GEOCODE_HOST = 'geocoding-api.open-meteo.com';
/** Нижче цієї хмарності (бали з 10) нижній край хмар не оцінюється: хмар майже немає. */
export const CLEAR_SKY_COVER = 2;
/** Метрів на градус різниці температури й точки роси (оцінка висоти основи хмар). */
const METRES_PER_DEGREE_SPREAD = 125;
const MAX_NAME = 80;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => (value == null ? '' : String(value).trim());
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Координата, округлена до 0,01° (≈1 км), — саме стільки й іде назовні. */
export function roundCoordinate(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** Число з поля введення: приймає кому як десятковий знак; порожнє — null; сміття — NaN. */
export function parseNumber(input) {
  const raw = text(input).replace(/\s+/gu, '').replace(',', '.');
  if (!raw) return null;
  return /^[-+]?\d+(?:\.\d+)?$/u.test(raw) ? Number(raw) : Number.NaN;
}

/** Ідентифікатор пункту: назва й округлені координати. */
export function placeId(place) {
  return `${text(place.name).toLocaleLowerCase('uk')}@${roundCoordinate(place.latitude).toFixed(2)},${roundCoordinate(place.longitude).toFixed(2)}`;
}

/**
 * Перевіряє населений пункт: назва 1–80 символів, широта −90…90, довгота −180…180.
 * Повертає `{ place }` або `{ error }` українською.
 */
export function parsePlace(input = {}) {
  const name = text(input.name).replace(/\s+/gu, ' ');
  if (!name) return { error: 'Вкажіть назву населеного пункту.' };
  if (name.length > MAX_NAME) return { error: `Назва задовга (до ${MAX_NAME} символів).` };
  const latitude = typeof input.latitude === 'number' ? input.latitude : parseNumber(input.latitude);
  const longitude = typeof input.longitude === 'number' ? input.longitude : parseNumber(input.longitude);
  if (!finite(latitude) || latitude < -90 || latitude > 90) return { error: 'Широта — число від −90 до 90, наприклад 48,46.' };
  if (!finite(longitude) || longitude < -180 || longitude > 180) return { error: 'Довгота — число від −180 до 180, наприклад 35,04.' };
  const place = { name, latitude, longitude };
  const region = text(input.region);
  if (region) place.region = region.slice(0, MAX_NAME);
  place.id = placeId(place);
  return { place };
}

/** Підпис знайденого пункту: «Назва, район, область». */
export function placeLabel(place) {
  return [place.name, place.district, place.region].map(text).filter(Boolean).join(', ');
}

/** Що саме піде назовні при оновленні пункту. */
export function disclosureText(place) {
  if (!place) return '';
  return `Назовні піде лише: координати ${roundCoordinate(place.latitude).toFixed(2)}, ${roundCoordinate(place.longitude).toFixed(2)} (≈1 км) → ${FORECAST_HOST}`;
}

/** Що піде назовні при пошуку пункту за назвою. */
export function searchDisclosure(name) {
  const query = text(name);
  return query ? `Назовні піде лише назва «${query}» → ${GEOCODE_HOST}` : `Пошук надсилає лише назву → ${GEOCODE_HOST}`;
}

/** Хмарність у балах з 10 із відсотків. */
export function coverFromPercent(percent) {
  return finite(percent) ? Math.round(clamp(percent, 0, 100) / 10) : null;
}

/**
 * Оцінка висоти нижнього краю хмар за різницею температури й точки роси (≈125 м на 1 °C),
 * округлена до 10 м. Без однієї з величин — null. Це оцінка, не вимір.
 */
export function cloudBaseEstimate(temperature, dewPoint) {
  if (!finite(temperature) || !finite(dewPoint)) return null;
  const spread = Math.max(0, temperature - dewPoint);
  return Math.round((spread * METRES_PER_DEGREE_SPREAD) / 10) * 10;
}

/** Явище за кодом погоди WMO, словами, які розуміє оцінка небезпеки. */
export function phenomenonFromCode(code) {
  if (!Number.isInteger(code)) return '';
  if (code === 45 || code === 48) return 'туман';
  if (code >= 51 && code <= 55) return 'мряка';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'ожеледь';
  if (code >= 61 && code <= 65) return 'дощ';
  if (code >= 71 && code <= 77) return 'сніг';
  if (code >= 80 && code <= 82) return 'злива';
  if (code === 85 || code === 86) return 'снігопад';
  if (code >= 95) return 'гроза';
  return '';
}

/** Спостереження з відповіді Rust-команди weather_online_fetch. */
export function observationFromOnline(raw = {}, receivedAt = new Date()) {
  const cover = coverFromPercent(raw.cloudCover);
  const lowCover = coverFromPercent(raw.cloudCoverLow);
  const estimate = cloudBaseEstimate(raw.temperature, raw.dewPoint);
  const cloudy = finite(cover) && cover >= CLEAR_SKY_COVER;
  return {
    source: 'online',
    time: text(raw.time),
    timezone: text(raw.timezone),
    receivedAt: new Date(receivedAt).toISOString(),
    lower: cloudy ? estimate : null,
    lowerEstimated: true,
    clearSky: finite(cover) && !cloudy,
    visibility: finite(raw.visibility) ? Math.round(raw.visibility / 100) / 10 : null,
    cover,
    lowCover,
    temperature: finite(raw.temperature) ? raw.temperature : null,
    wind: finite(raw.windSpeed) ? raw.windSpeed : null,
    windDirection: finite(raw.windDirection) ? raw.windDirection : null,
    phenomenon: phenomenonFromCode(raw.weatherCode),
  };
}

/**
 * Спостереження з ручного введення: нижній край хмар, м (0–20 000), видимість, км (0–100),
 * хмарність, бали 0–10. Порожнє поле — немає значення, але хоч одне має бути.
 * Повертає `{ observation }` або `{ error }`.
 */
export function manualObservation(form = {}, enteredAt = new Date()) {
  const lower = parseNumber(form.lower);
  const visibility = parseNumber(form.visibility);
  const cover = parseNumber(form.cover);
  if (Number.isNaN(lower) || (finite(lower) && (lower < 0 || lower > 20000))) return { error: 'Нижній край хмар — метри від 0 до 20 000.' };
  if (Number.isNaN(visibility) || (finite(visibility) && (visibility < 0 || visibility > 100))) return { error: 'Видимість — кілометри від 0 до 100.' };
  if (Number.isNaN(cover) || (finite(cover) && (cover < 0 || cover > 10))) return { error: 'Хмарність — бали від 0 до 10.' };
  if (![lower, visibility, cover].some(finite)) return { error: 'Заповніть хоча б одне значення.' };
  const at = new Date(enteredAt);
  return {
    observation: {
      source: 'manual',
      time: localKey(at),
      timezone: '',
      receivedAt: at.toISOString(),
      lower: finite(lower) ? lower : null,
      lowerEstimated: false,
      clearSky: false,
      visibility: finite(visibility) ? visibility : null,
      cover: finite(cover) ? cover : null,
      lowCover: null,
      temperature: null,
      wind: null,
      windDirection: null,
      phenomenon: text(form.phenomenon).slice(0, 60),
    },
  };
}

function localKey(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Скільки хвилин минуло від отримання спостереження (null — невідомо). */
export function ageMinutes(observation, now = new Date()) {
  const received = Date.parse(observation?.receivedAt || '');
  if (!Number.isFinite(received)) return null;
  return Math.max(0, Math.round((new Date(now).getTime() - received) / 60000));
}

export function ageText(minutes) {
  if (!finite(minutes)) return '';
  if (minutes < 1) return 'щойно';
  if (minutes < 60) return `${minutes} хв тому`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} год тому`;
  return `${Math.floor(hours / 24)} дн тому`;
}

/** Чи пора оновити вибраний пункт з мережі. */
export function needsRefresh(observation, now = new Date()) {
  if (!observation || observation.source !== 'online') return true;
  const age = ageMinutes(observation, now);
  return age == null || age >= REFRESH_MINUTES;
}

/** Підписи для екрана й оцінка небезпеки. */
export function observationView(observation, now = new Date()) {
  if (!observation) return null;
  const hazard = weatherHazard(observation);
  const age = ageMinutes(observation, now);
  let lowerText = weatherText.height(observation.lower);
  if (observation.clearSky) lowerText = 'хмар немає';
  else if (observation.lowerEstimated && finite(observation.lower)) lowerText = `≈ ${lowerText}`;
  return {
    lower: lowerText,
    lowerNote: observation.lowerEstimated ? 'оцінка за точкою роси' : 'введено вручну',
    visibility: weatherText.visibility(observation.visibility),
    cover: weatherText.cover(observation.cover),
    coverNote: finite(observation.lowCover) ? `нижня ${weatherText.cover(observation.lowCover)}` : '',
    temperature: finite(observation.temperature) ? `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(observation.temperature)} °C` : '',
    wind: finite(observation.wind) ? weatherText.wind(observation.wind) : '',
    phenomenon: observation.phenomenon || '',
    source: observation.source === 'online' ? `Open-Meteo, ${timeLabel(observation.time)}` : `вручну, ${timeLabel(observation.time)}`,
    age: ageText(age),
    stale: age != null && age >= STALE_MINUTES,
    tone: hazard.tone,
    hazardText: hazard.reasons.length ? hazard.reasons.join(' · ') : 'Обмежень не виявлено',
  };
}

function timeLabel(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/u.exec(text(key));
  return match ? `${match[3]}.${match[2]} ${match[4]}:${match[5]}` : '—';
}

/** Порожній стан: мережа вимкнена, пунктів немає. */
export function emptyState() {
  return { online: false, places: [], selected: '', observations: {} };
}

/** Стан зі сховища браузера; зламане чи чуже — порожній стан. */
export function parseState(raw) {
  const state = emptyState();
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return state;
  }
  if (!data || typeof data !== 'object') return state;
  state.online = data.online === true;
  const seen = new Set();
  for (const item of Array.isArray(data.places) ? data.places : []) {
    const { place } = parsePlace(item || {});
    if (!place || seen.has(place.id) || state.places.length >= MAX_PLACES) continue;
    seen.add(place.id);
    state.places.push(place);
  }
  state.selected = seen.has(data.selected) ? data.selected : (state.places[0]?.id || '');
  const observations = data.observations && typeof data.observations === 'object' ? data.observations : {};
  for (const id of seen) {
    const observation = observations[id];
    if (observation && typeof observation === 'object' && (observation.source === 'online' || observation.source === 'manual')) {
      state.observations[id] = observation;
    }
  }
  return state;
}

export function serializeState(state) {
  return JSON.stringify({
    online: Boolean(state.online),
    places: state.places,
    selected: state.selected,
    observations: state.observations,
  });
}

/** Додає пункт (або вибирає наявний з тим самим id). Повертає новий стан і id. */
export function addPlace(state, place) {
  const next = { ...state, places: [...state.places], observations: { ...state.observations } };
  if (!next.places.some(item => item.id === place.id)) {
    if (next.places.length >= MAX_PLACES) return { state, error: `Не більше ${MAX_PLACES} населених пунктів.` };
    next.places.push(place);
  }
  next.selected = place.id;
  return { state: next, id: place.id };
}

export function removePlace(state, id) {
  const places = state.places.filter(item => item.id !== id);
  const observations = { ...state.observations };
  delete observations[id];
  const selected = state.selected === id ? (places[0]?.id || '') : state.selected;
  return { ...state, places, observations, selected };
}
