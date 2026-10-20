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
  photoKey,
  STALE_MINUTES,
  addPlace,
  ageText,
  cloudBaseEstimate,
  cloudLayers,
  compassPoint,
  directionText,
  iconKey,
  phenomenonLabel,
  towardDegrees,
  mmHgFromHpa,
  pressureFromInput,
  pressureText,
  windsAloft,
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
import { CARD_ICON, WEATHER_ICONS, WMO_LABELS } from '../src/workspace/weather/weather-icons.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const NOW = new Date('2031-03-05T09:00:00Z');
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60000);
/** Пробіли-розділювачі тисяч uk-UA → звичайний пробіл. */
const plain = value => String(value).replace(/\s/gu, ' ');
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

test('румби, тиск у мм рт. ст. і тиск з поля введення', () => {
  assert.equal(compassPoint(0), 'Пн');
  assert.equal(compassPoint(250), 'Зх');
  assert.equal(compassPoint(359), 'Пн');
  assert.equal(compassPoint(-90), 'Зх');
  assert.equal(compassPoint(null), '');
  assert.equal(directionText(135.4), '315° ПнЗх', 'показується, куди дме');
  assert.equal(towardDegrees(200), 20);
  assert.equal(towardDegrees(180), 0);
  assert.equal(towardDegrees(null), null);
  assert.equal(directionText(null), '');
  assert.equal(mmHgFromHpa(1013.25), 760);
  assert.equal(pressureText(1002.4), '1002,4 гПа · 752 мм рт. ст.');
  assert.equal(pressureText(null), '—');
  assert.equal(pressureFromInput('1013,2'), 1013.2);
  assert.equal(pressureFromInput('760'), 1013.2);
  assert.equal(pressureFromInput(''), null);
  assert.ok(Number.isNaN(pressureFromInput('1500')));
  assert.ok(Number.isNaN(pressureFromInput('високий')));
});

const UPPER_AIR = {
  elevation: 150,
  levels: [
    { pressure: 1000, height: 110, cloudCover: 0 },
    { pressure: 975, height: 330, cloudCover: 20, windSpeed: 7, windDirection: 240 },
    { pressure: 925, height: 760, cloudCover: 80, windSpeed: 10, windDirection: 250 },
    { pressure: 850, height: 1490, cloudCover: 95, windSpeed: 14, windDirection: 260 },
    { pressure: 700, height: 3050, cloudCover: 30, windSpeed: 18, windDirection: 270 },
    { pressure: 500, height: 5620, cloudCover: 70, windSpeed: 25, windDirection: 280 },
    { pressure: 300, height: 9300, cloudCover: 10, windSpeed: 38.5, windDirection: 275 },
  ],
  nearWinds: [{ height: 80, windSpeed: 6, windDirection: 235 }, { height: 120, windSpeed: 6.8 }],
};

test('шари хмар за рівнями тиску відраховуються від землі', () => {
  assert.deepEqual(cloudLayers(UPPER_AIR.levels, UPPER_AIR.elevation), [
    { base: 610, top: 1340 },
    { base: 5470, top: 5470 },
  ]);
  assert.deepEqual(cloudLayers([], 0), []);
  assert.deepEqual(cloudLayers([{ height: 100, cloudCover: 90 }], 300), [], 'рівень під землею не враховується');
});

test('вітер на висотах: приземний шар і рівні вище 250 м', () => {
  const rows = windsAloft(UPPER_AIR);
  assert.deepEqual(rows.map(row => [row.height, row.level]), [[80, null], [120, null], [610, 925], [1340, 850], [2900, 700], [5470, 500], [9150, 300]]);
  assert.equal(rows[1].direction, null);
  assert.deepEqual(windsAloft({}), []);
});

test('онлайн-спостереження: верхня межа, тиск, пориви й вітер на висотах', () => {
  const raw = {
    time: '2031-03-05T11:00', temperature: 6, dewPoint: 2.4, cloudCover: 90, visibility: 8000,
    windSpeed: 5.5, windDirection: 245, windGusts: 12, surfacePressure: 996.2, pressureMsl: 1014.6,
    ...UPPER_AIR,
  };
  const observation = observationFromOnline(raw, NOW);
  assert.equal(observation.lower, 450);
  assert.equal(observation.upper, 1340);
  assert.equal(observation.upperEstimated, true);
  assert.equal(observation.pressure, 996.2);
  assert.equal(observation.gusts, 12);
  assert.equal(observation.windsAloft.length, 7);

  const view = observationView(observation, NOW);
  assert.equal(view.hasUpper, true);
  assert.equal(plain(view.upper), '≈ 1 340 м');
  assert.match(plain(view.upperNote), /оцінка за рівнями тиску · вище ще шар до 5 470 м/);
  assert.equal(view.windGround, '65° ПнСх · 5,5 м/с');
  assert.equal(view.windNote, 'пориви 12 м/с · на 10 м');
  assert.equal(view.pressure, '996,2 гПа · 747 мм рт. ст.');
  assert.match(view.pressureNote, /до рівня моря 1014,6 гПа/);
  assert.deepEqual({ ...view.windsAloft[3], height: plain(view.windsAloft[3].height) }, { height: '1 340 м', level: '850 гПа', direction: '80° Сх', toward: 80, speed: '14 м/с' });

  const low = observationFromOnline({ ...raw, temperature: 20, dewPoint: 6 }, NOW);
  assert.equal(low.lower, 1750);
  assert.equal(low.upper, 5470, 'перший шар нижчий за нижній край — береться наступний');

  const noLevels = observationView(observationFromOnline({ cloudCover: 70, temperature: 5, dewPoint: 3 }, NOW), NOW);
  assert.equal(noLevels.hasUpper, false, 'невідома верхня межа не показується');
  assert.deepEqual(noLevels.windsAloft, []);
});

test('ручне введення: верхній край, вітер і тиск', () => {
  const { observation } = manualObservation({ lower: '400', upper: '1900', wind: '7,5', windDirection: '360', pressure: '745' }, NOW);
  assert.equal(observation.upper, 1900);
  assert.equal(observation.wind, 7.5);
  assert.equal(observation.windDirection, 180, 'зберігається «звідки»');
  assert.equal(observation.pressure, 993.3);
  const view = observationView(observation, NOW);
  assert.equal(plain(view.upper), '1 900 м');
  assert.equal(view.upperNote, 'введено вручну');
  assert.equal(view.windGround, '0° Пн · 7,5 м/с');
  assert.equal(view.pressure, '993,3 гПа · 745 мм рт. ст.');
  assert.equal(view.pressureNote, 'біля землі');
  assert.match(manualObservation({ lower: '900', upper: '500' }).error, /не може бути нижчим/);
  assert.match(manualObservation({ upper: '25000' }).error, /Верхній край/);
  assert.match(manualObservation({ wind: '80' }).error, /Вітер/);
  assert.match(manualObservation({ windDirection: '400' }).error, /Напрям/);
  assert.match(manualObservation({ pressure: '300' }).error, /Тиск/);
  assert.ok(manualObservation({ pressure: '1013' }).observation, 'одного тиску досить');
});

test('значки: очищені SVG без скриптів і посилань, на кожен код WMO є значок', () => {
  const all = [...Object.values(WEATHER_ICONS), CARD_ICON];
  for (const svg of all) {
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
    assert.doesNotMatch(svg, /<script|<style|<foreignObject|href|\son[a-z]+=|url\(/i);
  }
  for (const code of Object.keys(WMO_LABELS)) assert.ok(WEATHER_ICONS[`wmo-${code}`], `значок для коду ${code}`);
  for (let cover = 0; cover <= 10; cover += 1) assert.ok(WEATHER_ICONS[`cover-${cover}`]);
  for (const name of ['cloud-base', 'cloud-top', 'visibility', 'cloud-cover', 'wind', 'pressure', 'wind-direction', 'internet-on', 'internet-off', 'unknown']) {
    assert.ok(WEATHER_ICONS[name], name);
  }
});

test('значок і назва явища: код WMO, слова, хмарність, немає даних', () => {
  assert.equal(iconKey(observationFromOnline({ weatherCode: 63, cloudCover: 90 }, NOW)), 'wmo-63');
  assert.equal(phenomenonLabel({ weatherCode: 63 }), 'Дощ');
  assert.equal(iconKey(manualObservation({ cover: 5, phenomenon: 'Туман' }, NOW).observation), 'wmo-45');
  assert.equal(phenomenonLabel({ phenomenon: 'туман' }), 'туман');
  assert.equal(iconKey({ cover: 0 }), 'wmo-0');
  assert.equal(iconKey({ cover: 3 }), 'wmo-1');
  assert.equal(iconKey({ cover: 6 }), 'wmo-2');
  assert.equal(iconKey({ cover: 9 }), 'wmo-3');
  assert.equal(iconKey({ weatherCode: 1234 }), 'unknown');
  assert.equal(iconKey(null), 'unknown');

  const view = observationView(manualObservation({ lower: 150, visibility: 0.8, cover: 9 }, NOW).observation, NOW);
  assert.equal(view.toneLabel, 'Небезпечно');
  assert.equal(view.coverIcon, 'cover-9');
  assert.equal(observationView(manualObservation({ visibility: 10 }, NOW).observation, NOW).toneLabel, 'Без обмежень');
  assert.equal(observationView(manualObservation({ visibility: 10 }, NOW).observation, NOW).coverIcon, '');
});

test('фото явища: код WMO, слова поза кодами, без даних — без фото; кожне фото є у папці', async () => {
  assert.equal(photoKey(observationFromOnline({ weatherCode: 45, cloudCover: 100 }, NOW)), 'fog');
  assert.equal(photoKey(observationFromOnline({ weatherCode: 99 }, NOW)), 'storm-heavy');
  assert.equal(photoKey(manualObservation({ cover: 8, phenomenon: 'мокрий сніг' }, NOW).observation), 'sleet');
  assert.equal(photoKey(manualObservation({ cover: 2, phenomenon: 'Імла' }, NOW).observation), 'haze');
  assert.equal(photoKey(manualObservation({ cover: 9 }, NOW).observation), 'overcast');
  assert.equal(photoKey(manualObservation({ lower: 300 }, NOW).observation), '');
  assert.equal(photoKey(null), '');
  const keys = new Set();
  for (const code of Object.keys(WMO_LABELS)) keys.add(photoKey({ weatherCode: Number(code) }));
  for (const word of ['мокрий сніг', 'град', 'імла']) keys.add(photoKey({ phenomenon: word }));
  keys.delete('');
  for (const key of keys) {
    const file = await readFile(new URL(`src/workspace/weather/photos/workspace-weather-${key}.webp`, root));
    assert.ok(file.length > 500 && file.length < 16 * 1024, key);
  }
  assert.equal(keys.size, 15);
});
