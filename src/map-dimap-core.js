// Опційна інтеграція карти повітряних тривог DIMAP.LIVE для 3D-карти України.
// За правилом local-first за замовчуванням ВИМКНЕНА: жоден запит до dimap.live не виконується,
// доки користувач явно не надасть згоду. Спільний ключ стану з air.html / rocket.html: 'aviahub.dimap'.

export const DIMAP_STORAGE_KEY = 'aviahub.dimap';

export const DIMAP_MODES = [
  ['/', 'Карта тривог'],
  ['/shahed', 'Карта шахедів'],
  ['/now', 'Тривога зараз'],
];

// Канонічні регіони dimap.live із прив'язкою до координат [lon, lat] і назви області на 3D-карті.
export const DIMAP_REGIONS = [
  { slug: '', label: 'Уся Україна', oblast: null, lon: 31.2, lat: 48.5, dist: 18 },
  { slug: 'dnipro', label: 'Дніпропетровська', oblast: 'Дніпропетровська', lon: 35.04, lat: 48.47, dist: 5.5 },
  { slug: 'zaporizka', label: 'Запорізька', oblast: 'Запорізька', lon: 35.35, lat: 47.55, dist: 5.5 },
  { slug: 'donetska', label: 'Донецька', oblast: 'Донецька', lon: 37.65, lat: 48.10, dist: 5.5 },
  { slug: 'kharkivska', label: 'Харківська', oblast: 'Харківська', lon: 36.25, lat: 49.95, dist: 5.5 },
  { slug: 'khersonska', label: 'Херсонська', oblast: 'Херсонська', lon: 33.45, lat: 46.75, dist: 5.5 },
  { slug: 'mykolaivska', label: 'Миколаївська', oblast: 'Миколаївська', lon: 31.99, lat: 47.45, dist: 5.5 },
  { slug: 'luhanska', label: 'Луганська', oblast: 'Луганська', lon: 39.05, lat: 48.85, dist: 5.5 },
  { slug: 'sumska', label: 'Сумська', oblast: 'Сумська', lon: 34.45, lat: 51.15, dist: 5.5 },
  { slug: 'poltavska', label: 'Полтавська', oblast: 'Полтавська', lon: 34.15, lat: 49.60, dist: 5.5 },
  { slug: 'kyiv', label: 'Київ', oblast: 'Київська', lon: 30.52, lat: 50.45, dist: 2.2 },
  { slug: 'kyivska', label: 'Київська', oblast: 'Київська', lon: 30.55, lat: 50.25, dist: 5.5 },
  { slug: 'odeska', label: 'Одеська', oblast: 'Одеська', lon: 30.35, lat: 46.60, dist: 6.0 },
  { slug: 'lvivska', label: 'Львівська', oblast: 'Львівська', lon: 24.03, lat: 49.84, dist: 5.5 },
];

export function findDimapRegion(slug) {
  return DIMAP_REGIONS.find((r) => r.slug === slug) || DIMAP_REGIONS[0];
}

export function buildDimapUrl(mode = '/', region = '') {
  const safeMode = DIMAP_MODES.some((m) => m[0] === mode) ? mode : '/';
  const validRegion = safeMode === '/' && region && DIMAP_REGIONS.some((r) => r.slug === region);
  return 'https://dimap.live' + safeMode + (validRegion ? '?r=' + encodeURIComponent(region) : '');
}

// Визначає найближчий регіон DIMAP за координатами центра 3D-камери (коли камера наближена до області).
export function nearestDimapRegion(lon, lat, maxDeg = 1.6) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return '';
  let best = '';
  let bestD2 = maxDeg * maxDeg;
  for (const r of DIMAP_REGIONS) {
    if (!r.slug) continue;
    const dx = (r.lon - lon) * 0.67;
    const dy = r.lat - lat;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = r.slug;
    }
  }
  return best;
}

export function parseDimapState(raw) {
  const base = { ok: false, r: '', m: '/' };
  if (!raw) return base;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return base;
    return {
      ok: o.ok === true,
      r: DIMAP_REGIONS.some((x) => x.slug === o.r) ? o.r : '',
      m: DIMAP_MODES.some((x) => x[0] === o.m) ? o.m : '/',
    };
  } catch (e) {
    return base;
  }
}
