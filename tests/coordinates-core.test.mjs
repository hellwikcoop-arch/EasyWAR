import assert from 'node:assert/strict';
import test from 'node:test';

import { mgrsToLatLon, parseCoordinates } from '../src/coordinates-core.js';

// Лише синтетичні координати: вигадані точки, жодних записів із реальних таблиць.

const close = (point, lat, lon, eps = 0.002) => {
  assert.ok(Math.abs(point.lat - lat) < eps && Math.abs(point.lon - lon) < eps, `${point.lat}, ${point.lon} ≠ ${lat}, ${lon}`);
};

// Незалежне пряме перетворення WGS84 → UTM (формули Снайдера) для звірки зворотного.
function toUtm(lat, lon) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const zone = Math.floor((lon + 180) / 6) + 1;
  const phi = lat * Math.PI / 180;
  const lam = (lon - ((zone - 1) * 6 - 180 + 3)) * Math.PI / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = ep2 * Math.cos(phi) ** 2;
  const aa = Math.cos(phi) * lam;
  const m = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const easting = 500000 + k0 * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * ep2) * aa ** 5 / 120);
  const northing = k0 * (m + n * Math.tan(phi) * (aa * aa / 2 + (5 - t + 9 * c + 4 * c * c) * aa ** 4 / 24 + (61 - 58 * t + t * t + 600 * c - 330 * ep2) * aa ** 6 / 720));
  return { zone, easting, northing: lat < 0 ? northing + 10000000 : northing };
}

test('MGRS: квадрат і цифри збігаються з незалежним прямим перетворенням', () => {
  // Київ (36U), Харків (37U): сотні кілометрів східної частини й літери квадрата обираються за зоною.
  for (const [lat, lon] of [[50.45, 30.52], [49.99, 36.23], [47.1, 37.5]]) {
    const utm = toUtm(lat, lon);
    const e100 = Math.floor(utm.easting / 100000);
    const n100 = Math.floor(utm.northing / 100000);
    const square = `${['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'][(utm.zone - 1) % 3][e100 - 1]}${'ABCDEFGHJKLMNPQRSTUV'[(n100 + (utm.zone % 2 === 0 ? 5 : 0)) % 20]}`;
    const east = String(Math.round(utm.easting % 100000)).padStart(5, '0');
    const north = String(Math.round(utm.northing % 100000)).padStart(5, '0');
    const band = 'CDEFGHJKLMNPQRSTUVWX'[Math.floor((lat + 80) / 8)];
    close(mgrsToLatLon(utm.zone, band, square, east, north), lat, lon, 0.0005);
    close(parseCoordinates(`${utm.zone}${band} ${square} ${east} ${north}`)[0], lat, lon, 0.0005);
  }
});

test('MGRS: кириличні двійники літер, пробіли й скорочена точність', () => {
  const latin = parseCoordinates('37T CP 12345 67890')[0];
  const cyrillic = parseCoordinates('37Т СР 12345 67890')[0];
  assert.ok(latin && cyrillic);
  close(cyrillic, latin.lat, latin.lon, 1e-9);
  const compact = parseCoordinates('37TCP1234567890')[0];
  close(compact, latin.lat, latin.lon, 1e-9);
  const coarse = parseCoordinates('37T CP 1234 6789')[0];
  close(coarse, latin.lat, latin.lon, 0.01);
  assert.equal(parseCoordinates('99T CP 12345 67890').length, 0, 'зона поза 1–60');
  assert.equal(parseCoordinates('37T CP 123 678').length, 0, 'надто мало цифр');
});

test('десяткові координати: кома чи крапка, градус, межі; кілька MGRS у комірці', () => {
  assert.deepEqual(parseCoordinates('48.12, 36.3'), [{ lat: 48.12, lon: 36.3 }]);
  assert.deepEqual(parseCoordinates('48,12; 36,3'), [{ lat: 48.12, lon: 36.3 }]);
  assert.deepEqual(parseCoordinates('48.12° 36.3°'), [{ lat: 48.12, lon: 36.3 }]);
  assert.deepEqual(parseCoordinates('95, 36'), []);
  assert.deepEqual(parseCoordinates(''), []);
  assert.deepEqual(parseCoordinates(null), []);
  assert.deepEqual(parseCoordinates('десь біля мосту'), []);
  assert.equal(parseCoordinates('37T CP 12345 67890 / 37T CP 12445 67990').length, 2);
});
