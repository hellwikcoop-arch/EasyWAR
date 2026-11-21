// Чисте ядро геодезичних вимірювань для 3D-мапи України: відстань, азимут, площа й профіль висот (WGS84 / сфера).
const R_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function haversineKm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dL = (lon2 - lon1) * D2R;
  const y = Math.sin(dL) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dL);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

const COMPASS_UK = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];
export function compassDirUk(deg) {
  if (!Number.isFinite(deg)) return '—';
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS_UK[idx];
}

// Сферична площа полігона на сфері Землі (алгоритм Chamberlain–Duquette, км²).
export function polygonAreaKm2(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const lon1 = p1.lon * D2R, lat1 = p1.lat * D2R;
    const lon2 = p2.lon * D2R, lat2 = p2.lat * D2R;
    sum += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(sum * R_KM * R_KM / 2);
}

// Профіль висот уздовж ламаної: повертає масив { km, h, lon, lat } і зведені показники.
export function buildElevationProfile(points, sampleHeight, maxSamples = 96) {
  if (!Array.isArray(points) || points.length < 2 || typeof sampleHeight !== 'function') {
    return { samples: [], totalKm: 0, minH: 0, maxH: 0, gain: 0, loss: 0 };
  }
  const segs = [];
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const d = haversineKm(a.lon, a.lat, b.lon, b.lat);
    segs.push({ a, b, d });
    totalKm += d;
  }
  if (totalKm <= 1e-6) {
    const h0 = Math.max(0, Number(sampleHeight(points[0].lon, points[0].lat)) || 0);
    return { samples: [{ km: 0, h: h0, lon: points[0].lon, lat: points[0].lat }], totalKm: 0, minH: h0, maxH: h0, gain: 0, loss: 0 };
  }
  const samples = [];
  let accKm = 0;
  for (let s = 0; s < segs.length; s++) {
    const { a, b, d } = segs[s];
    const steps = Math.max(2, Math.round((d / totalKm) * maxSamples));
    const startI = s === 0 ? 0 : 1;
    for (let i = startI; i <= steps; i++) {
      const t = i / steps;
      const lon = a.lon + (b.lon - a.lon) * t;
      const lat = a.lat + (b.lat - a.lat) * t;
      const h = Math.max(0, Number(sampleHeight(lon, lat)) || 0);
      samples.push({ km: accKm + d * t, h, lon, lat });
    }
    accKm += d;
  }
  let minH = Infinity, maxH = -Infinity, gain = 0, loss = 0;
  for (let i = 0; i < samples.length; i++) {
    const h = samples[i].h;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
    if (i > 0) {
      const dh = h - samples[i - 1].h;
      if (dh > 0) gain += dh;
      else loss -= dh;
    }
  }
  return { samples, totalKm, minH, maxH, gain, loss };
}

// Пошук міст і селищ України за назвою або областю: спочатку 3D-міста та точні префіксні збіги, далі за населенням.
export function searchPlaces(query, cities3d, cityData, limit = 24) {
  const q = String(query || '').trim().toLocaleLowerCase('uk');
  const set3d = new Map();
  for (const c of (cities3d || [])) {
    if (c && c.kind !== 'villages' && c.name) set3d.set(c.name.toLocaleLowerCase('uk'), c);
  }
  const out = [];
  const seen = new Set();
  if (!q) {
    for (const c of (cities3d || [])) {
      if (!c || c.kind === 'villages') continue;
      out.push({ name: c.name, oblast: '', lon: c.centre0[0], lat: c.centre0[1], pop: 0, count3d: c.count, city3d: c });
      if (out.length >= limit) break;
    }
    return out;
  }
  const rank = [];
  if (cityData && typeof cityData === 'object') {
    for (const oblast of Object.keys(cityData)) {
      const oblLower = oblast.toLocaleLowerCase('uk');
      for (const row of cityData[oblast]) {
        const [name, lon, lat, pop = 0] = row;
        const nLower = name.toLocaleLowerCase('uk');
        const hitName = nLower.includes(q);
        const hitObl = oblLower.includes(q);
        if (!hitName && !hitObl) continue;
        const key = `${nLower}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const c3d = set3d.get(nLower) || null;
        const score = (nLower === q ? 1000 : nLower.startsWith(q) ? 500 : hitName ? 200 : 50) + (c3d ? 120 : 0) + Math.min(100, Math.log10(Math.max(10, pop)) * 14);
        rank.push({ score, item: { name, oblast, lon, lat, pop, count3d: c3d ? c3d.count : 0, city3d: c3d } });
      }
    }
  }
  // Якщо cityData ще не завантажилось, шукаємо хоча б серед 3D-міст
  for (const c of (cities3d || [])) {
    if (!c || c.kind === 'villages') continue;
    const nLower = c.name.toLocaleLowerCase('uk');
    if (!nLower.includes(q)) continue;
    if (rank.some((r) => r.item.city3d === c)) continue;
    const score = (nLower === q ? 1000 : nLower.startsWith(q) ? 500 : 200) + 120;
    rank.push({ score, item: { name: c.name, oblast: '', lon: c.centre0[0], lat: c.centre0[1], pop: 0, count3d: c.count, city3d: c } });
  }
  rank.sort((a, b) => b.score - a.score || b.item.pop - a.item.pop || a.item.name.localeCompare(b.item.name, 'uk'));
  return rank.slice(0, limit).map((r) => r.item);
}
