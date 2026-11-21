import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  HD_SOURCES,
  lonLatToTile,
  pickHdZoom,
  tileToBbox,
  visibleTileSpecs,
} from '../src/map-hd-tiles-core.js';

test('lonLatToTile та tileToBbox: Київ потрапляє всередину свого тайлу Web Mercator на z12…z18', () => {
  const lon = 30.5234, lat = 50.4501;
  for (const z of [12, 14, 16, 18]) {
    const { x, y } = lonLatToTile(lon, lat, z);
    const [lon0, lon1, lat0, lat1] = tileToBbox(x, y, z);
    assert.ok(lon >= lon0 && lon <= lon1, `z${z}: lon у межах [${lon0}, ${lon1}]`);
    assert.ok(lat >= lat0 && lat <= lat1, `z${z}: lat у межах [${lat0}, ${lat1}]`);
  }
});

test('pickHdZoom: повертає 0 на висоті огляду й плавно піднімає зум при наближенні', () => {
  assert.equal(pickHdZoom(12), 0);
  assert.equal(pickHdZoom(5), 0);
  assert.equal(pickHdZoom(1.5), 12);
  assert.equal(pickHdZoom(0.35), 14);
  assert.equal(pickHdZoom(0.08), 16);
  assert.equal(pickHdZoom(0.02, 18), 18);
  assert.equal(pickHdZoom(0.01, 17), 17);
  assert.equal(pickHdZoom(0.01, 19), 19);
});

test('visibleTileSpecs: формує кільце тайлів від центру назовні й відсікає поза межами України', () => {
  const bounds = { lon0: 21.9, lon1: 40.5, lat0: 44.05, lat1: 52.5 };
  const kyiv = visibleTileSpecs(30.52, 50.45, 15, 1, bounds);
  assert.equal(kyiv.length, 9);
  assert.equal(kyiv[0].dist2, 0);
  assert.ok(kyiv[kyiv.length - 1].dist2 >= kyiv[1].dist2);

  const outside = visibleTileSpecs(0, 0, 15, 1, bounds);
  assert.equal(outside.length, 0);
});

test('HD_SOURCES: Esri працює без ключа, Google Maps Map Tiles API вимагає ключ і сесію', () => {
  assert.equal(HD_SOURCES.esri.needsKey, false);
  assert.match(HD_SOURCES.esri.tileUrl(15, 19160, 10984), /^https:\/\/server\.arcgisonline\.com\/.*\/15\/10984\/19160$/);
  assert.equal(HD_SOURCES.esri_clarity.needsKey, false);
  assert.match(HD_SOURCES.esri_clarity.tileUrl(15, 19160, 10984), /^https:\/\/clarity\.maptiles\.arcgis\.com\/.*\/15\/10984\/19160$/);

  assert.equal(HD_SOURCES.google.needsKey, true);
  assert.equal(HD_SOURCES.google.tileUrl(15, 19160, 10984, {}), '');
  assert.match(
    HD_SOURCES.google.sessionUrl('TEST_KEY'),
    /^https:\/\/tile\.googleapis\.com\/v1\/createSession\?key=TEST_KEY$/,
  );
  assert.deepEqual(HD_SOURCES.google.sessionBody(), {
    mapType: 'satellite',
    language: 'uk-UA',
    region: 'UA',
    scale: 'scaleFactor2x',
    highDpi: true,
  });
  assert.match(
    HD_SOURCES.google.tileUrl(16, 38320, 21968, { session: 'S123', apiKey: 'TEST_KEY' }),
    /^https:\/\/tile\.googleapis\.com\/v1\/2dtiles\/16\/38320\/21968\?session=S123&key=TEST_KEY$/,
  );
});

test('local-first: онлайн HD-знімки вимкнені за замовчуванням у map.html та map-app.js', () => {
  const html = readFileSync(new URL('../src/map.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../src/map-app.js', import.meta.url), 'utf8');
  assert.match(html, /<button class="tog" id="t-hd" aria-pressed="false"/);
  assert.match(html, /<input id="hd-on" type="checkbox">/);
  assert.doesNotMatch(html, /<input id="hd-on"[^>]*checked/);
  assert.match(js, /const HdTiles = \(\(\) => \{[\s\S]*?let enabled = false;/);
});
