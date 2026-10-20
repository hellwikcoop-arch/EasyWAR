// Чиста логіка застосунку «Погода» (Робоче середовище → Обстановка): збережені населені пункти,
// перетворення відповіді служби погоди (через Rust-команду weather_online_fetch) і ручного введення
// в одне спостереження — нижній край хмар, видимість, хмарність у балах з 10 — та оцінка небезпеки
// за тими самими порогами, що й картка «Метеоумови». Без DOM і Tauri: перевіряється в node --test.
//
// Мережа вимкнена за замовчуванням (`online: false`). Коли її ввімкнути, назовні йдуть лише
// координати пункту, округлені до 0,01°, або назва, яку шукають, — це й показує disclosureText.

import { weatherHazard, weatherText } from '../../dashboard-module-weather-core.js';
import { WMO_LABELS } from './weather-icons.js';

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
/** Від цієї хмарності на рівні тиску, %, рівень вважається в хмарі (оцінка верхньої межі). */
export const CLOUDY_LEVEL_PERCENT = 50;
/** Рівні тиску, гПа, які показуються в таблиці вітру на висотах. */
export const WIND_ALOFT_LEVELS = [925, 850, 700, 500, 300];
/** Нижче цієї висоти над землею, м, вітер рівня тиску не показується: там є вітер 80–180 м. */
const MIN_LEVEL_WIND_HEIGHT = 250;
const MM_HG_PER_HPA = 0.750062;
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

/** Тиск у мм рт. ст. з гПа, до цілих. */
export function mmHgFromHpa(hpa) {
  return finite(hpa) ? Math.round(hpa * MM_HG_PER_HPA) : null;
}

const COMPASS = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];

/** Румб з градусів: 8 напрямків. */
export function compassPoint(degrees) {
  if (!finite(degrees)) return '';
  const normalized = ((degrees % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 45) % 8];
}

/** Висота рівня над землею, м: геопотенціальна висота мінус висота пункту, до 10 м. */
function aboveGround(height, elevation) {
  if (!finite(height)) return null;
  return Math.round((height - (finite(elevation) ? elevation : 0)) / 10) * 10;
}

/**
 * Шари хмар за рівнями тиску: суміжні рівні з хмарністю від CLOUDY_LEVEL_PERCENT, від землі вгору.
 * Повертає `[{ base, top }]` у метрах над землею (межі — висоти крайніх хмарних рівнів, тож точність
 * обмежена відстанню між рівнями: сотні метрів унизу, кілометр і більше вгорі).
 */
export function cloudLayers(levels = [], elevation = null) {
  const points = (Array.isArray(levels) ? levels : [])
    .map(level => ({ height: aboveGround(level?.height, elevation), cloudy: finite(level?.cloudCover) && level.cloudCover >= CLOUDY_LEVEL_PERCENT }))
    .filter(point => finite(point.height) && point.height >= 0)
    .sort((a, b) => a.height - b.height);
  const layers = [];
  let current = null;
  for (const point of points) {
    if (point.cloudy) {
      if (current) current.top = point.height;
      else current = { base: point.height, top: point.height };
    } else if (current) {
      layers.push(current);
      current = null;
    }
  }
  if (current) layers.push(current);
  return layers;
}

/** Вітер на висотах: 80–180 м над землею і рівні WIND_ALOFT_LEVELS вище 250 м, знизу вгору. */
export function windsAloft(raw = {}) {
  const rows = [];
  for (const wind of Array.isArray(raw.nearWinds) ? raw.nearWinds : []) {
    if (!finite(wind?.height) || !(finite(wind.windSpeed) || finite(wind.windDirection))) continue;
    rows.push({ height: wind.height, level: null, speed: finite(wind.windSpeed) ? wind.windSpeed : null, direction: finite(wind.windDirection) ? wind.windDirection : null });
  }
  for (const level of Array.isArray(raw.levels) ? raw.levels : []) {
    if (!WIND_ALOFT_LEVELS.includes(level?.pressure)) continue;
    const height = aboveGround(level.height, raw.elevation);
    if (!finite(height) || height < MIN_LEVEL_WIND_HEIGHT) continue;
    if (!(finite(level.windSpeed) || finite(level.windDirection))) continue;
    rows.push({ height, level: level.pressure, speed: finite(level.windSpeed) ? level.windSpeed : null, direction: finite(level.windDirection) ? level.windDirection : null });
  }
  return rows.sort((a, b) => a.height - b.height);
}

/** Спостереження з відповіді Rust-команди weather_online_fetch. */
export function observationFromOnline(raw = {}, receivedAt = new Date()) {
  const cover = coverFromPercent(raw.cloudCover);
  const lowCover = coverFromPercent(raw.cloudCoverLow);
  const estimate = cloudBaseEstimate(raw.temperature, raw.dewPoint);
  const cloudy = finite(cover) && cover >= CLEAR_SKY_COVER;
  const lower = cloudy ? estimate : null;
  const layers = cloudy ? cloudLayers(raw.levels, raw.elevation) : [];
  // Верхня межа — верх першого шару, що закінчується вище нижнього краю.
  const firstLayer = layers.find(layer => layer.top > (finite(lower) ? lower : 0));
  return {
    source: 'online',
    time: text(raw.time),
    timezone: text(raw.timezone),
    receivedAt: new Date(receivedAt).toISOString(),
    lower,
    lowerEstimated: true,
    upper: firstLayer ? firstLayer.top : null,
    upperEstimated: true,
    layers,
    clearSky: finite(cover) && !cloudy,
    visibility: finite(raw.visibility) ? Math.round(raw.visibility / 100) / 10 : null,
    cover,
    lowCover,
    temperature: finite(raw.temperature) ? raw.temperature : null,
    wind: finite(raw.windSpeed) ? raw.windSpeed : null,
    windDirection: finite(raw.windDirection) ? raw.windDirection : null,
    gusts: finite(raw.windGusts) ? raw.windGusts : null,
    pressure: finite(raw.surfacePressure) ? raw.surfacePressure : null,
    pressureMsl: finite(raw.pressureMsl) ? raw.pressureMsl : null,
    windsAloft: windsAloft(raw),
    weatherCode: Number.isInteger(raw.weatherCode) ? raw.weatherCode : null,
    phenomenon: phenomenonFromCode(raw.weatherCode),
  };
}

/**
 * Тиск з поля введення в гПа: 850–1100 — уже гПа, 500–850 — мм рт. ст. (переводиться).
 * Порожнє — null; інше — NaN.
 */
export function pressureFromInput(input) {
  const value = parseNumber(input);
  if (value == null || Number.isNaN(value)) return value;
  if (value >= 850 && value <= 1100) return value;
  if (value >= 500 && value < 850) return Math.round((value / MM_HG_PER_HPA) * 10) / 10;
  return Number.NaN;
}

/**
 * Спостереження з ручного введення: нижній і верхній край хмар, м (0–20 000), видимість, км (0–100),
 * хмарність, бали 0–10, вітер біля землі, м/с (0–60) і напрям, куди дме, ° (0–360), тиск (гПа або мм рт. ст.).
 * Порожнє поле — немає значення, але хоч одне має бути. Повертає `{ observation }` або `{ error }`.
 */
export function manualObservation(form = {}, enteredAt = new Date()) {
  const lower = parseNumber(form.lower);
  const upper = parseNumber(form.upper);
  const visibility = parseNumber(form.visibility);
  const cover = parseNumber(form.cover);
  const wind = parseNumber(form.wind);
  const windDirection = parseNumber(form.windDirection);
  const pressure = pressureFromInput(form.pressure);
  const outside = (value, min, max) => Number.isNaN(value) || (finite(value) && (value < min || value > max));
  if (outside(lower, 0, 20000)) return { error: 'Нижній край хмар — метри від 0 до 20 000.' };
  if (outside(upper, 0, 20000)) return { error: 'Верхній край хмар — метри від 0 до 20 000.' };
  if (finite(lower) && finite(upper) && upper < lower) return { error: 'Верхній край хмар не може бути нижчим за нижній.' };
  if (outside(visibility, 0, 100)) return { error: 'Видимість — кілометри від 0 до 100.' };
  if (outside(cover, 0, 10)) return { error: 'Хмарність — бали від 0 до 10.' };
  if (outside(wind, 0, 60)) return { error: 'Вітер — метри за секунду від 0 до 60.' };
  if (outside(windDirection, 0, 360)) return { error: 'Напрям вітру — градуси від 0 до 360 (куди дме).' };
  if (Number.isNaN(pressure)) return { error: 'Тиск — гПа (850–1100) або мм рт. ст. (500–850).' };
  if (![lower, upper, visibility, cover, wind, windDirection, pressure].some(finite)) return { error: 'Заповніть хоча б одне значення.' };
  const at = new Date(enteredAt);
  return {
    observation: {
      source: 'manual',
      time: localKey(at),
      timezone: '',
      receivedAt: at.toISOString(),
      lower: finite(lower) ? lower : null,
      lowerEstimated: false,
      upper: finite(upper) ? upper : null,
      upperEstimated: false,
      layers: [],
      clearSky: false,
      visibility: finite(visibility) ? visibility : null,
      cover: finite(cover) ? cover : null,
      lowCover: null,
      temperature: null,
      wind: finite(wind) ? wind : null,
      // Вводять «куди дме», зберігаємо метеорологічний «звідки», як у даних служби.
      windDirection: finite(windDirection) ? (windDirection + 180) % 360 : null,
      gusts: null,
      pressure: finite(pressure) ? pressure : null,
      pressureMsl: null,
      windsAloft: [],
      weatherCode: null,
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

const decimal = (value, digits = 0) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: digits, useGrouping: false }).format(value);

export function towardDegrees(fromDegrees) {
  if (!finite(fromDegrees)) return null;
  return Math.round((((fromDegrees + 180) % 360) + 360) % 360) % 360;
}

/**
 * Напрям вітру для екрана — КУДИ дме (так попросив власник), у градусах і румбах: «65° ПнСх».
 * Зберігається метеорологічний напрям «звідки», як його дає служба; тут лише показ.
 */
export function directionText(fromDegrees) {
  const toward = towardDegrees(fromDegrees);
  return toward == null ? '' : `${toward}° ${compassPoint(toward)}`;
}

/** «1002 гПа · 752 мм рт. ст.» */
export function pressureText(hpa) {
  return finite(hpa) ? `${decimal(hpa, 1)} гПа · ${mmHgFromHpa(hpa)} мм рт. ст.` : '—';
}

const TONE_LABELS = { '': 'Без обмежень', warn: 'Обережно', bad: 'Небезпечно' };
/** Явище, введене словами, → код WMO для значка. */
const PHENOMENON_CODES = [
  [/гроз/u, 95], [/град/u, 96], [/туман/u, 45], [/мряк/u, 53], [/ожелед|крижан/u, 66],
  [/снігопад|заряд/u, 85], [/сніг/u, 73], [/злив/u, 81], [/дощ/u, 63],
];

/**
 * Ключ значка в WEATHER_ICONS: за кодом WMO, інакше за явищем словами, інакше за хмарністю
 * (0–1 — ясно, 2–3 — переважно ясно, 4–7 — мінлива, 8–10 — похмуро). Без даних — «unknown».
 */
export function iconKey(observation) {
  if (!observation) return 'unknown';
  if (Number.isInteger(observation.weatherCode) && WMO_LABELS[observation.weatherCode]) return `wmo-${observation.weatherCode}`;
  const event = text(observation.phenomenon).toLocaleLowerCase('uk');
  const found = event && PHENOMENON_CODES.find(([pattern]) => pattern.test(event));
  if (found) return `wmo-${found[1]}`;
  const cover = observation.cover;
  if (!finite(cover)) return 'unknown';
  if (cover < CLEAR_SKY_COVER) return 'wmo-0';
  if (cover <= 3) return 'wmo-1';
  if (cover <= 7) return 'wmo-2';
  return 'wmo-3';
}

const PHOTO_BY_CODE = {
  0: 'clear', 1: 'partly', 2: 'cloudy', 3: 'overcast', 45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle', 56: 'freezing', 57: 'freezing', 66: 'freezing', 67: 'freezing',
  61: 'rain', 63: 'rain', 65: 'shower', 80: 'shower', 81: 'shower', 82: 'shower',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow', 85: 'snow', 86: 'snow',
  95: 'storm', 96: 'storm-heavy', 99: 'storm-heavy',
};
const PHOTO_BY_WORD = [[/мокр\S* сніг/u, 'sleet'], [/град/u, 'hail'], [/імл|серпан/u, 'haze']];

/**
 * Ключ фото явища (photos/workspace-weather-<ключ>.webp, аркуш власника): спершу слова, яких немає
 * серед кодів WMO (мокрий сніг, град, імла), далі код значка. Без даних — '' і фото не показується.
 */
export function photoKey(observation) {
  const event = text(observation?.phenomenon).toLocaleLowerCase('uk');
  const byWord = event && !Number.isInteger(observation?.weatherCode) && PHOTO_BY_WORD.find(([pattern]) => pattern.test(event));
  if (byWord) return byWord[1];
  const match = /^wmo-(\d+)$/u.exec(iconKey(observation));
  return match ? PHOTO_BY_CODE[Number(match[1])] ?? '' : '';
}

/** Назва явища для екрана: за кодом WMO (таблиця пакета референсів) або як введено. */
export function phenomenonLabel(observation) {
  if (Number.isInteger(observation?.weatherCode) && WMO_LABELS[observation.weatherCode]) return WMO_LABELS[observation.weatherCode];
  return text(observation?.phenomenon);
}

/** Підписи для екрана й оцінка небезпеки. */
export function observationView(observation, now = new Date()) {
  if (!observation) return null;
  const hazard = weatherHazard(observation);
  const age = ageMinutes(observation, now);
  let lowerText = weatherText.height(observation.lower);
  if (observation.clearSky) lowerText = 'хмар немає';
  else if (observation.lowerEstimated && finite(observation.lower)) lowerText = `≈ ${lowerText}`;
  // Верхню межу показуємо лише тоді, коли вона відома (так попросив власник).
  const hasUpper = finite(observation.upper);
  let upperText = weatherText.height(observation.upper);
  if (hasUpper && observation.upperEstimated) upperText = `≈ ${upperText}`;
  const layers = Array.isArray(observation.layers) ? observation.layers : [];
  const higher = layers.filter(layer => layer.top > (finite(observation.upper) ? observation.upper : Infinity));
  let upperNote = observation.upperEstimated ? 'оцінка за рівнями тиску' : 'введено вручну';
  if (higher.length) upperNote += ` · вище ще шар до ${weatherText.height(higher[higher.length - 1].top)}`;
  const windParts = [directionText(observation.windDirection), finite(observation.wind) ? weatherText.wind(observation.wind) : ''].filter(Boolean);
  return {
    lower: lowerText,
    lowerNote: observation.lowerEstimated ? 'оцінка за точкою роси' : 'введено вручну',
    hasUpper,
    upper: upperText,
    upperNote,
    windGround: windParts.length ? windParts.join(' · ') : '—',
    windNote: finite(observation.gusts) ? `пориви ${weatherText.wind(observation.gusts)} · на 10 м` : (observation.source === 'online' ? 'на 10 м' : ''),
    pressure: pressureText(observation.pressure),
    pressureNote: finite(observation.pressureMsl) ? `біля землі · до рівня моря ${decimal(observation.pressureMsl, 1)} гПа` : (finite(observation.pressure) ? 'біля землі' : ''),
    windsAloft: (Array.isArray(observation.windsAloft) ? observation.windsAloft : []).map(row => ({
      height: weatherText.height(row.height),
      level: finite(row.level) ? `${row.level} гПа` : '',
      direction: directionText(row.direction) || '—',
      toward: towardDegrees(row.direction),
      speed: weatherText.wind(row.speed),
    })),
    visibility: weatherText.visibility(observation.visibility),
    cover: weatherText.cover(observation.cover),
    coverNote: finite(observation.lowCover) ? `нижня ${weatherText.cover(observation.lowCover)}` : '',
    temperature: finite(observation.temperature) ? `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(observation.temperature)} °C` : '',
    wind: finite(observation.wind) ? weatherText.wind(observation.wind) : '',
    phenomenon: phenomenonLabel(observation),
    icon: iconKey(observation),
    photo: photoKey(observation),
    coverIcon: finite(observation.cover) ? `cover-${Math.round(clamp(observation.cover, 0, 10))}` : '',
    toneLabel: TONE_LABELS[hazard.tone] ?? TONE_LABELS[''],
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
