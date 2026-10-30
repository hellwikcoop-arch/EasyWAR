// Координати запису → широта/довгота (чиста логіка без DOM і Tauri). Читає MGRS («37U DQ 12345 67890», літери
// можуть бути кириличні двійники) і десяткову пару «48.1200, 36.3000». Перетворення MGRS → UTM → WGS84 те саме,
// що в `air.html`/`rocket.html` (там воно вбудоване в сторінку); тут — окремо, щоб рахувати блоки «Мого дашборда».

const LOOK = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', І: 'I', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', і: 'i', к: 'k', м: 'm', о: 'o', р: 'p', т: 't', х: 'x', у: 'y',
};
const toLatin = text => text.replace(/[АВСЕНІКМОРТХУавсенікмортху]/gu, ch => LOOK[ch]);
const BAND_MIN_N = { C: 1100, D: 2000, E: 2800, F: 3700, G: 4600, H: 5500, J: 6400, K: 7300, L: 8200, M: 9100, N: 0, P: 800, Q: 1700, R: 2600, S: 3500, T: 4400, U: 5300, V: 6200, W: 7000, X: 7900 };
const E_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const N_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

function utmToLatLon(easting, northing, zone, north) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = easting - 500000;
  const y = north ? northing : northing - 10000000;
  const mu = (y / k0) / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  const se = Math.sqrt(1 - e2);
  const e1 = (1 - se) / (1 + se);
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1);
  const c = Math.cos(phi1);
  const t = Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - e2 * s * s);
  const t1 = t * t;
  const c1 = ep2 * c * c;
  const r1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5;
  const d = x / (n1 * k0);
  const lat = phi1 - (n1 * t / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6 / 720);
  const dl = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5 / 120) / c;
  return { lat: lat * 180 / Math.PI, lon: (zone - 1) * 6 - 180 + 3 + dl * 180 / Math.PI };
}

/** Одна точка MGRS за частинами: зона, смуга, квадрат (2 літери), східна й північна частини цифр. */
export function mgrsToLatLon(zoneText, bandText, squareText, eastText, northText) {
  const zone = Number(zoneText);
  const band = String(bandText).toUpperCase();
  const square = String(squareText).toUpperCase();
  if (!(zone >= 1 && zone <= 60) || !(band in BAND_MIN_N) || eastText.length !== northText.length) return null;
  const ei = E_SETS[(zone - 1) % 3].indexOf(square[0]);
  const ni = N_LETTERS.indexOf(square[1]);
  if (ei < 0 || ni < 0) return null;
  const scale = 10 ** (5 - eastText.length);
  const easting = (ei + 1) * 100000 + Number(eastText) * scale;
  let northing = ((((ni - (zone % 2 === 0 ? 5 : 0)) % 20) + 20) % 20) * 100000 + Number(northText) * scale;
  const minNorthing = BAND_MIN_N[band] * 1000;
  while (northing < minNorthing) northing += 2000000;
  return utmToLatLon(easting, northing, zone, band >= 'N');
}

const RE_MGRS = /(?<![\p{L}\p{N}])(\d{1,2})[ \t]?([A-Za-zА-Яа-яІі])[ \t]?([A-Za-zА-Яа-яІі]{2})[ \t]?(\d{4,5})[ \t]?(\d{4,5})(?![\p{L}\p{N}])/gu;
const RE_DECIMAL = /(-?\d{1,3}(?:[.,]\d+)?)\s*°?\s*[;, ]\s*(-?\d{1,3}(?:[.,]\d+)?)/u;
const finite = point => point && Number.isFinite(point.lat) && Number.isFinite(point.lon);

/**
 * Усі точки в тексті комірки: спершу MGRS (їх у комірці може бути кілька), інакше одна десяткова пара «широта,
 * довгота». Порожній масив, якщо координат не розпізнано.
 */
export function parseCoordinates(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const points = [];
  for (const match of text.matchAll(new RegExp(RE_MGRS.source, 'gu'))) {
    const point = mgrsToLatLon(match[1], toLatin(match[2]), toLatin(match[3]), match[4], match[5]);
    if (finite(point)) points.push(point);
  }
  if (points.length) return points;
  const decimal = RE_DECIMAL.exec(text);
  if (!decimal) return [];
  const lat = Number(decimal[1].replace(',', '.'));
  const lon = Number(decimal[2].replace(',', '.'));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [{ lat, lon }] : [];
}
