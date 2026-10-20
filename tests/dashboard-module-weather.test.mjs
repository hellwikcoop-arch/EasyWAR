import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CLOUD_LEVELS,
  FRAME_LIMIT,
  RELIEF_EXAGGERATION,
  RELIEF_META,
  cloudPuffs,
  contourSegments,
  decodeHeights,
  idwGrid,
  reliefProject,
  reliefSize,
  reliefY,
  sampleRelief,
  seededRandom,
  smoothHeights,
  weatherHazard,
  weatherModel,
  weatherText,
} from '../src/dashboard-module-weather-core.js';
import { CHART_KINDS, chartModel, chartSummary } from '../src/dashboard-module-charts-core.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

// Лише синтетичні дані: вигадані пункти, координати й значення погоди.
const catalog = await rustCatalog();
const weather = { ...catalog.find(item => item.id === 'weather'), templateId: 'weather' };
const plain = value => String(value).replace(/[  ]/gu, ' ');
const row = (observed_at, label, latitude, longitude, extra = {}) => ({ observed_at, label, latitude, longitude, cloud_cover: 5, ...extra });

test('the weather template exists in the Rust catalog and reuses the flight-journal weather keys', async () => {
  assert.equal(weather.visualKind, 'weather');
  assert.equal(weather.defaultSpan, 2);
  const keys = weather.fields.map(field => field.key);
  assert.deepEqual(keys, ['observed_at', 'label', 'latitude', 'longitude', 'cloud_cover', 'cloud_base_lower', 'cloud_base_upper', 'visibility', 'wind_speed', 'phenomenon']);
  // Ті самі ключі й типи, що в журналі польотів: «5/300/1000/10» з таблиці розбирається однаково.
  const flight = catalog.find(item => item.id === 'flight-hours');
  for (const key of ['cloud_cover', 'cloud_base_lower', 'cloud_base_upper', 'visibility']) {
    const mine = weather.fields.find(field => field.key === key);
    const theirs = flight.fields.find(field => field.key === key);
    assert.equal(mine.dataType, theirs.dataType, key);
    assert.equal(mine.label, theirs.label, key);
  }
  assert.ok(CHART_KINDS.includes('weather'));
  const core = await readFile(new URL('../src/dashboard-module-catalog-core.js', import.meta.url), 'utf8');
  assert.match(core, /VISUAL_KINDS = new Set\(\[[^\]]*'weather'/u);
});

test('weather texts are Ukrainian with units', () => {
  assert.equal(weatherText.cover(5), '5/10');
  assert.equal(plain(weatherText.height(1200)), '1 200 м');
  assert.equal(weatherText.visibility(2.5), '2,5 км');
  assert.equal(weatherText.wind(7), '7 м/с');
  assert.equal(weatherText.height(null), '—');
});

test('hazard: severe phenomena and low limits are bad, borderline values warn, calm is empty', () => {
  assert.deepEqual(weatherHazard({ cover: 3, lower: 1200, visibility: 10, wind: 4 }), { tone: '', reasons: [] });
  assert.equal(weatherHazard({ phenomenon: 'Гроза' }).tone, 'bad');
  assert.equal(weatherHazard({ phenomenon: 'Туман' }).tone, 'bad');
  assert.equal(weatherHazard({ phenomenon: 'Дощ' }).tone, 'warn');
  assert.equal(weatherHazard({ lower: 150 }).tone, 'bad');
  assert.equal(weatherHazard({ lower: 400 }).tone, 'warn');
  assert.equal(weatherHazard({ visibility: 1.5 }).tone, 'bad');
  assert.equal(weatherHazard({ visibility: 4 }).tone, 'warn');
  assert.equal(weatherHazard({ wind: 16 }).tone, 'bad');
  assert.equal(weatherHazard({ wind: 11 }).tone, 'warn');
  assert.equal(weatherHazard({ cover: 9 }).tone, 'warn');
  // Небезпека не послаблюється наступною «увагою».
  const mixed = weatherHazard({ lower: 150, visibility: 4 });
  assert.equal(mixed.tone, 'bad');
  assert.equal(mixed.reasons.length, 2);
});

test('IDW grid keeps exact station values and leaves far-away nodes empty', () => {
  const bounds = { west: 30, east: 32, south: 48, north: 50 };
  const values = idwGrid([{ latitude: 50, longitude: 30, value: 8 }, { latitude: 48, longitude: 32, value: 2 }], bounds, 3, 3);
  assert.equal(values[0], 8);
  assert.equal(values[8], 2);
  assert.ok(values[4] > 2 && values[4] < 8);
  const far = idwGrid([{ latitude: 50, longitude: 30, value: 5 }], { west: 30, east: 40, south: 44, north: 50 }, 3, 3, 1);
  assert.equal(far[0], 5);
  assert.equal(far[8], null);
  assert.ok(idwGrid([], bounds, 2, 2).every(value => value === null));
});

test('marching squares: a single high node gives a closed diamond, empty nodes are skipped', () => {
  const grid = [0, 0, 0, 0, 10, 0, 0, 0, 0];
  const segments = contourSegments(grid, 3, 3, 5);
  assert.equal(segments.length, 4);
  for (const [x1, y1, x2, y2] of segments) {
    for (const [x, y] of [[x1, y1], [x2, y2]]) assert.ok(Math.abs(Math.abs(x - 1) + Math.abs(y - 1) - 0.5) < 1e-9, `${x},${y}`);
  }
  assert.equal(contourSegments([0, 0, null, 10], 2, 2, 5).length, 0);
  assert.equal(contourSegments([10, 10, 10, 10], 2, 2, 5).length, 0);
});

test('weather model groups rows into time frames, one station per name, latest frame current', () => {
  const rows = [
    row('2026-10-18T09:00', 'Пункт А', 50.4, 30.5, { cloud_cover: 3, cloud_base_lower: 1200 }),
    row('2026-10-18T06:00', 'Пункт А', 50.4, 30.5, { cloud_cover: 2 }),
    row('2026-10-18T09:00', 'Пункт Б', 48.5, 35.0, { cloud_cover: 9, cloud_base_lower: 150, phenomenon: 'Гроза', visibility: 1.5 }),
    row('2026-10-18T09:00', 'Пункт Б', 48.5, 35.0, { cloud_cover: 9, cloud_base_lower: 150, phenomenon: 'Гроза', visibility: 1.5, wind_speed: 16 }),
    row('не дата', 'Пункт В', 47, 31),
    row('2026-10-18T09:00', 'Пункт Г', null, 31),
  ];
  const model = weatherModel(weather, rows);
  assert.equal(model.kind, 'weather');
  assert.equal(model.frames.length, 2);
  assert.equal(model.current, 1);
  assert.equal(model.skipped, 2);
  assert.deepEqual(model.frames.map(frame => frame.label), ['18.10 06:00', '18.10 09:00']);
  const last = model.frames[1];
  assert.equal(last.stations.length, 2);
  assert.equal(last.tone, 'bad');
  assert.match(last.hazardText, /^Пункт Б: Гроза, НМХ 150 м, видимість 1,5 км, вітер 16 м\/с$/u);
  assert.equal(last.stations.find(item => item.label === 'Пункт Б').callout, '9/10 · НМХ 150 м · 1,5 км');
  const strip = Object.fromEntries(last.summary.map(cell => [cell.key, cell]));
  assert.equal(strip.cover.valueText, '6/10');
  assert.equal(strip.lower.valueText, '150 м');
  assert.equal(strip.lower.tone, 'bad');
  assert.equal(strip.wind.valueText, '16 м/с');
  assert.deepEqual(last.isolines.map(line => line.level), CLOUD_LEVELS);
  assert.ok(last.isolines.some(line => line.segments.length > 0));
  assert.equal(model.frames[0].tone, '');
  // Порожнє явище (як його повертає SQLite для незаповненої клітинки) — не небезпека.
  const blank = weatherModel(weather, [row('2026-10-18T06:00', 'Пункт А', 50.4, 30.5, { cloud_cover: 3, phenomenon: '' }), row('2026-10-18T06:00', 'Пункт Б', 49, 31, { cloud_cover: 3, phenomenon: '  ' })]);
  assert.equal(blank.frames[0].tone, '');
  assert.deepEqual(blank.frames[0].stations.map(item => item.phenomenon), ['', '']);
});

test('weather model keeps only the latest frames, swaps inverted cloud limits and clamps cover', () => {
  const rows = Array.from({ length: FRAME_LIMIT + 6 }, (_, index) => row(`2026-10-${String(1 + Math.floor(index / 24)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00`, 'Пункт', 49, 31, { cloud_cover: 14, cloud_base_lower: 2000, cloud_base_upper: 900 }));
  const model = weatherModel(weather, rows);
  assert.equal(model.frames.length, FRAME_LIMIT);
  assert.equal(model.older, 6);
  const station = model.frames.at(-1).stations[0];
  assert.equal(station.cover, 10);
  assert.equal(station.lower, 900);
  assert.equal(station.upper, 2000);
});

test('chart model and summary route the weather kind', () => {
  const model = chartModel(weather, [row('2026-10-18T12:00', 'Пункт А', 50.4, 30.5, { phenomenon: 'Туман' })]);
  assert.equal(model.kind, 'weather');
  assert.equal(model.rowCount, 1);
  assert.match(chartSummary(model), /^Метеоумови: 1 запис, 18\.10 12:00, 1 пункт, небезпека — Пункт А: Туман$/u);
  assert.equal(chartSummary(chartModel(weather, [])), 'Метеоумови: даних ще немає');
});

test('relief projection puts the corners of heights.png on the scene edges', () => {
  const { width, depth } = reliefSize();
  assert.ok(width > 1300 && width < 1450, String(width));
  assert.ok(depth > 900 && depth < 980, String(depth));
  const corner = reliefProject(RELIEF_META.lon0, RELIEF_META.lat1);
  assert.ok(Math.abs(corner.x + width / 2) < 1e-9 && Math.abs(corner.z + depth / 2) < 1e-9);
  const centre = reliefProject((RELIEF_META.lon0 + RELIEF_META.lon1) / 2, (RELIEF_META.lat0 + RELIEF_META.lat1) / 2);
  assert.ok(Math.abs(centre.x) < 1e-9 && Math.abs(centre.z) < 1e-9);
  assert.equal(reliefY(1000), RELIEF_EXAGGERATION);
  assert.equal(reliefY(-50), 0);
});

test('heights.png decoding: R·256 + G − 1000 metres, blue is the land mask, the sea stays negative', () => {
  const width = 4;
  const height = 4;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, metres, land) => {
    const i = (y * width + x) * 4;
    const raw = metres + 1000;
    pixels[i] = Math.floor(raw / 256);
    pixels[i + 1] = raw % 256;
    pixels[i + 2] = land ? 255 : 0;
    pixels[i + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) put(x, y, 100, x < 2);
  put(0, 0, 2000, true);
  put(2, 2, -20, false);
  const relief = decodeHeights(pixels, width, height, 2);
  assert.equal(relief.cols, 2);
  assert.equal(relief.rows, 2);
  assert.equal(relief.heights[0], 2000);
  assert.equal(relief.land[0], 1);
  assert.equal(relief.land[1], 0);
  assert.equal(relief.heights[3], -20);
  assert.equal(sampleRelief(relief, RELIEF_META.lon0, RELIEF_META.lat1), 2000);
  assert.equal(sampleRelief(relief, RELIEF_META.lon1, RELIEF_META.lat0), 0, 'під водою — рівень моря');
  // Згладжування не змішує море із сушею: берег лишається різким.
  const smooth = smoothHeights({ cols: 3, rows: 1, heights: new Float32Array([-10, 90, 210]), land: new Float32Array(3) }, 1);
  assert.deepEqual([...smooth.heights], [-10, 150, 150]);
  assert.equal(sampleRelief(relief, 0, 0), 0);
  assert.equal(sampleRelief(null, 30, 49), 0);
});

test('cloud puffs: none for a clear sky, between the cloud limits, stable for a station name', () => {
  assert.deepEqual(cloudPuffs({ label: 'Пункт', latitude: 49, longitude: 31, cover: 0 }, 200).puffs, []);
  const station = { label: 'Пункт А', latitude: 49, longitude: 31, cover: 6, lower: 500, upper: 1500 };
  const first = cloudPuffs(station, 200);
  assert.equal(first.puffs.length, 60);
  assert.equal(first.assumed, false);
  for (const puff of first.puffs) {
    assert.ok(puff.y >= reliefY(700) - 1e-9 && puff.y <= reliefY(1700) + 1e-9);
    assert.ok(puff.alpha > 0 && puff.alpha < 1);
  }
  assert.deepEqual(cloudPuffs(station, 200), first);
  const assumed = cloudPuffs({ ...station, lower: null, upper: null }, 0);
  assert.equal(assumed.assumed, true);
  assert.equal(assumed.lower, 600);
  assert.equal(assumed.upper, 1400);
  const random = seededRandom('Пункт А');
  const again = seededRandom('Пункт А');
  assert.equal(random(), again());
});

test('the 3D view is loaded on demand, offline, and frees its WebGL resources', async () => {
  const scene = await readFile(new URL('../src/dashboard-module-weather-3d.js', import.meta.url), 'utf8');
  const catalogUi = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(catalogUi, /withoutRelief \? null : \(\) => import\('\.\/dashboard-module-weather-3d\.js'\)/u);
  assert.doesNotMatch(catalogUi, /^import .*weather-3d/mu);
  assert.match(scene, /map-assets\/heights\.png/u);
  assert.doesNotMatch(scene, /https?:\/\//u);
  assert.doesNotMatch(scene, /innerHTML|localStorage/u);
  for (const call of ['renderer?.dispose()', 'controls?.dispose()', 'cancelAnimationFrame(frameId)', 'resizeObserver?.disconnect()']) assert.ok(scene.includes(call), call);
});
