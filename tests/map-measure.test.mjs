import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bearingDeg,
  buildElevationProfile,
  compassDirUk,
  haversineKm,
  polygonAreaKm2,
  searchPlaces,
} from '../src/map-measure-core.js';

test('haversineKm: відстань Київ — Харків і Львів — Одеса відповідає геодезичній', () => {
  const kyivKharkiv = haversineKm(30.5234, 50.4501, 36.2304, 49.9935);
  assert.ok(kyivKharkiv > 405 && kyivKharkiv < 415, `Київ—Харків: ${kyivKharkiv.toFixed(1)} км`);
  const lvivOdesa = haversineKm(24.0297, 49.8397, 30.7233, 46.4825);
  assert.ok(lvivOdesa > 620 && lvivOdesa < 635, `Львів—Одеса: ${lvivOdesa.toFixed(1)} км`);
  assert.equal(haversineKm(30.5, 50.4, 30.5, 50.4), 0);
});

test('bearingDeg та compassDirUk: точні азимути та сторони світу українською', () => {
  assert.ok(Math.abs(bearingDeg(30, 48, 30, 50) - 0) < 0.01);
  assert.equal(compassDirUk(bearingDeg(30, 48, 30, 50)), 'Пн');
  assert.equal(compassDirUk(bearingDeg(30, 48, 30, 46)), 'Пд');
  assert.equal(compassDirUk(bearingDeg(30, 48, 32, 48)), 'Сх');
  assert.equal(compassDirUk(bearingDeg(30, 48, 28, 48)), 'Зх');
  assert.equal(compassDirUk(bearingDeg(30, 48, 31, 49)), 'ПнСх');
});

test('polygonAreaKm2: площа 1°×1° поблизу 48° пн. ш. ≈ 8250 км²', () => {
  const sq = [
    { lon: 30, lat: 48 },
    { lon: 31, lat: 48 },
    { lon: 31, lat: 49 },
    { lon: 30, lat: 49 },
  ];
  const area = polygonAreaKm2(sq);
  assert.ok(area > 8000 && area < 8500, `площа 1°×1°: ${area.toFixed(1)} км²`);
  assert.equal(polygonAreaKm2(sq.slice(0, 2)), 0);
});

test('buildElevationProfile: обчислює перепад висот, набір і скидання уздовж маршруту', () => {
  const pts = [
    { lon: 24.0, lat: 48.0 },
    { lon: 24.5, lat: 48.16 },
    { lon: 25.0, lat: 48.0 },
  ];
  const sampleH = (lon) => (1 - Math.abs(lon - 24.5) * 2) * 2000;
  const prof = buildElevationProfile(pts, sampleH, 40);
  assert.ok(prof.samples.length >= 20);
  assert.ok(prof.totalKm > 70 && prof.totalKm < 90);
  assert.ok(prof.maxH > 1900 && prof.minH < 100);
  assert.ok(prof.gain > 1800 && prof.loss > 1800);
});

test('searchPlaces: знаходить 3D-міста, населені пункти за назвою й областю та ранжує точні збіги першими', () => {
  const cities3d = [
    { name: 'Харків', count: 95000, centre0: [36.23, 49.99] },
    { name: 'Дніпро', count: 80000, centre0: [35.04, 48.46] },
    { name: 'Села', kind: 'villages', count: 5000, centre0: [36.0, 49.0] },
  ];
  const cityData = {
    'Харківська': [
      ['Харків', 36.23, 49.99, 1420000],
      ['Чугуїв', 36.68, 49.84, 31000],
    ],
    'Львівська': [
      ['Львів', 24.03, 49.84, 717000],
    ],
  };
  const empty = searchPlaces('', cities3d, cityData);
  assert.deepEqual(empty.map((x) => x.name), ['Харків', 'Дніпро']);

  const hit = searchPlaces('харк', cities3d, cityData);
  assert.equal(hit[0].name, 'Харків');
  assert.ok(hit[0].city3d);
  assert.ok(hit.some((x) => x.name === 'Чугуїв'), 'пошук за областю знаходить міста області');

  const hitLviv = searchPlaces('львів', cities3d, cityData);
  assert.equal(hitLviv[0].name, 'Львів');
  assert.equal(hitLviv[0].city3d, null);
});
