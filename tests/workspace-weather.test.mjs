// «Погода» в «Робочому середовищі» → «Обстановка» (src/workspace/weather): чиста логіка,
// розкриття того, що йде назовні, стан за замовчуванням без мережі й Rust-команди.
// Лише вигадані пункти й значення.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CLEAR_SKY_COVER,
  FORECAST_HOST,
  GEOCODE_HOST,
  MAX_PLACES,
  REFRESH_MINUTES,
  STALE_MINUTES,
  addPlace,
  ageText,
  cloudBaseEstimate,
  coverFromPercent,
  disclosureText,
  emptyState,
  manualObservation,
  needsRefresh,
  observationFromOnline,
  observationView,
  parseNumber,
  parsePlace,
  parseState,
  phenomenonFromCode,
  placeLabel,
  removePlace,
  roundCoordinate,
  searchDisclosure,
  serializeState,
} from '../src/workspace/weather/weather-core.js';
import { appById, sectionOfApp } from '../src/workspace/workspace-core.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const NOW = new Date('2031-03-05T09:00:00Z');
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60000);
const village = () => parsePlace({ name: 'Вигадане', latitude: '48,4567', longitude: '35,0412' }).place;

test('«Погода» зареєстрована в розділі «Обстановка»', () => {
  const entry = appById('weather');
  assert.equal(entry.title, 'Погода');
  assert.equal(sectionOfApp('weather').title, 'Обстановка');
  assert.equal(sectionOfApp('easydoc').title, 'Офіс');
  assert.match(entry.hint, /нижній край хмар/i);
});

test('мережа вимкнена за замовчуванням і після зламаного сховища', () => {
  assert.deepEqual(emptyState(), { online: false, places: [], selected: '', observations: {} });
  assert.equal(parseState(null).online, false);
  assert.equal(parseState('{не json').online, false);
  assert.equal(parseState(JSON.stringify({ online: 'так' })).online, false);
  assert.equal(parseState(JSON.stringify({ online: true })).online, true);
});

test('назовні йдуть лише округлені координати або назва — і це видно', () => {
  const place = village();
  assert.equal(roundCoordinate(48.4567), 48.46);
  assert.equal(disclosureText(place), `Назовні піде лише: координати 48.46, 35.04 (≈1 км) → ${FORECAST_HOST}`);
  assert.equal(disclosureText(null), '');
  assert.equal(searchDisclosure(' Вигадане '), `Назовні піде лише назва «Вигадане» → ${GEOCODE_HOST}`);
  assert.match(searchDisclosure(''), new RegExp(GEOCODE_HOST.replaceAll('.', '\\.')));
});

test('числа з поля введення приймають кому', () => {
  assert.equal(parseNumber('48,46'), 48.46);
  assert.equal(parseNumber(' 1 200 '), 1200);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('багато')));
});

test('населений пункт перевіряється', () => {
  const place = village();
  assert.equal(place.name, 'Вигадане');
  assert.equal(place.id, 'вигадане@48.46,35.04');
  assert.match(parsePlace({ name: '', latitude: 1, longitude: 1 }).error, /назву/);
  assert.match(parsePlace({ name: 'Х', latitude: 91, longitude: 1 }).error, /Широта/);
  assert.match(parsePlace({ name: 'Х', latitude: 10, longitude: 'схід' }).error, /Довгота/);
  assert.match(parsePlace({ name: 'Х'.repeat(81), latitude: 1, longitude: 1 }).error, /задовга/);
  assert.equal(placeLabel({ name: 'Вигадане', district: 'Умовний р-н', region: 'Тестова обл.' }), 'Вигадане, Умовний р-н, Тестова обл.');
});

test('додавання й вилучення пунктів', () => {
  const place = village();
  let { state } = addPlace(emptyState(), place);
  assert.equal(state.selected, place.id);
  assert.equal(addPlace(state, place).state.places.length, 1, 'дубль не додається');
  const other = parsePlace({ name: 'Умовне', latitude: 50.1, longitude: 30.2 }).place;
  state = addPlace(state, other).state;
  state.observations[place.id] = manualObservation({ cover: 3 }, NOW).observation;
  state = removePlace(state, other.id);
  assert.equal(state.selected, place.id);
  state = removePlace(state, place.id);
  assert.deepEqual(state.places, []);
  assert.deepEqual(state.observations, {});
  assert.equal(state.selected, '');

  let full = emptyState();
  for (let index = 0; index < MAX_PLACES; index += 1) {
    full = addPlace(full, parsePlace({ name: `Пункт ${index}`, latitude: 45 + index / 10, longitude: 30 }).place).state;
  }
  assert.match(addPlace(full, place).error, /Не більше/);
});

test('стан переживає збереження й відкидає чуже', () => {
  const place = village();
  const { state } = addPlace({ ...emptyState(), online: true }, place);
  state.observations[place.id] = manualObservation({ lower: 300 }, NOW).observation;
  const restored = parseState(serializeState(state));
  assert.deepEqual(restored, state);

  const dirty = parseState(JSON.stringify({
    places: [place, place, { name: 'Зламаний', latitude: 'ні', longitude: 0 }],
    selected: 'чужий',
    observations: { [place.id]: { source: 'хтось' }, інший: { source: 'manual' } },
  }));
  assert.equal(dirty.places.length, 1);
  assert.equal(dirty.selected, place.id);
  assert.deepEqual(dirty.observations, {});
});

test('хмарність у балах, оцінка нижнього краю й явища за кодом', () => {
  assert.equal(coverFromPercent(73), 7);
  assert.equal(coverFromPercent(140), 10);
  assert.equal(coverFromPercent(null), null);
  assert.equal(cloudBaseEstimate(10, 6), 500);
  assert.equal(cloudBaseEstimate(4.2, 3.1), 140);
  assert.equal(cloudBaseEstimate(2, 3), 0, 'точка роси вища — хмари біля землі');
  assert.equal(cloudBaseEstimate(5, null), null);
  assert.equal(phenomenonFromCode(45), 'туман');
  assert.equal(phenomenonFromCode(63), 'дощ');
  assert.equal(phenomenonFromCode(96), 'гроза');
  assert.equal(phenomenonFromCode(2), '');
});

test('відповідь служби погоди перетворюється на спостереження', () => {
  const raw = {
    time: '2031-03-05T11:00', timezone: 'Europe/Kyiv', temperature: 6.5, dewPoint: 5.1,
    cloudCover: 88, cloudCoverLow: 64, visibility: 3400, windSpeed: 7.2, windDirection: 240, weatherCode: 61,
  };
  const observation = observationFromOnline(raw, NOW);
  assert.equal(observation.source, 'online');
  assert.equal(observation.cover, 9);
  assert.equal(observation.lowCover, 6);
  assert.equal(observation.lower, 180);
  assert.equal(observation.lowerEstimated, true);
  assert.equal(observation.visibility, 3.4);
  assert.equal(observation.phenomenon, 'дощ');
  assert.equal(observation.receivedAt, NOW.toISOString());

  const clear = observationFromOnline({ ...raw, cloudCover: 10, weatherCode: 0 }, NOW);
  assert.ok(CLEAR_SKY_COVER > 1);
  assert.equal(clear.clearSky, true);
  assert.equal(clear.lower, null);
});

test('ручне введення перевіряється', () => {
  const { observation } = manualObservation({ lower: '450', visibility: '6,5', cover: '7', phenomenon: ' мряка ' }, NOW);
  assert.equal(observation.source, 'manual');
  assert.equal(observation.lower, 450);
  assert.equal(observation.visibility, 6.5);
  assert.equal(observation.cover, 7);
  assert.equal(observation.lowerEstimated, false);
  assert.equal(observation.phenomenon, 'мряка');
  assert.match(manualObservation({}).error, /хоча б одне/);
  assert.match(manualObservation({ lower: '-5' }).error, /Нижній край/);
  assert.match(manualObservation({ visibility: '101' }).error, /Видимість/);
  assert.match(manualObservation({ cover: '11' }).error, /Хмарність/);
  assert.match(manualObservation({ cover: 'хмарно' }).error, /Хмарність/);
});

test('картка: підписи, небезпека й застарілість', () => {
  const online = observationFromOnline({ time: '2031-03-05T11:00', temperature: 6.5, dewPoint: 5.1, cloudCover: 88, visibility: 1500, windSpeed: 4 }, minutesAgo(100));
  const view = observationView(online, NOW);
  assert.match(view.lower, /^≈ /);
  assert.equal(view.lowerNote, 'оцінка за точкою роси');
  assert.equal(view.cover, '9/10');
  assert.equal(view.tone, 'bad');
  assert.match(view.hazardText, /НМХ/);
  assert.match(view.hazardText, /видимість/);
  assert.equal(view.stale, true);
  assert.equal(view.age, '1 год тому');
  assert.match(view.source, /^Open-Meteo, 05\.03 11:00$/);

  const calm = observationView(manualObservation({ lower: 1200, visibility: 10, cover: 3 }, NOW).observation, NOW);
  assert.equal(calm.tone, '');
  assert.equal(calm.hazardText, 'Обмежень не виявлено');
  assert.equal(calm.lowerNote, 'введено вручну');
  assert.equal(calm.stale, false);

  const clear = observationView(observationFromOnline({ cloudCover: 5, temperature: 10, dewPoint: 0 }, NOW), NOW);
  assert.equal(clear.lower, 'хмар немає');
  assert.equal(observationView(null), null);
});

test('оновлення з мережі — раз на півгодини', () => {
  assert.equal(needsRefresh(undefined, NOW), true);
  assert.equal(needsRefresh(manualObservation({ cover: 2 }, NOW).observation, NOW), true);
  assert.equal(needsRefresh(observationFromOnline({}, minutesAgo(REFRESH_MINUTES - 1)), NOW), false);
  assert.equal(needsRefresh(observationFromOnline({}, minutesAgo(REFRESH_MINUTES)), NOW), true);
  assert.ok(STALE_MINUTES > REFRESH_MINUTES);
  assert.equal(ageText(0), 'щойно');
  assert.equal(ageText(12), '12 хв тому');
  assert.equal(ageText(60 * 50), '2 дн тому');
});

test('застосунок кличе лише weather_online_* і не ходить у мережу сам', async () => {
  const source = await read('src/workspace/weather/app.js');
  const commands = [...source.matchAll(/invoke\('([a-z_]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(commands)].sort(), ['weather_online_fetch', 'weather_online_search']);
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|WebSocket|https?:\/\//);
  assert.match(source, /state\.online/);
});

test('Rust: фіксовані адреси Open-Meteo, лише HTTPS і команди зареєстровано', async () => {
  const rust = await read('src-tauri/src/weather_online.rs');
  assert.match(rust, /https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  assert.match(rust, /https:\/\/geocoding-api\.open-meteo\.com\/v1\/search/);
  const lib = await read('src-tauri/src/lib.rs');
  assert.match(lib, /weather_online_fetch,/);
  assert.match(lib, /weather_online_search,/);
});
