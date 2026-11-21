// Опційний онлайн-шар високодетальних супутникових тайлів (HD) для 3D-мапи України.
// За правилом local-first за замовчуванням ВИМКНЕНИЙ: жоден мережевий запит не виконується,
// доки користувач явно не ввімкне режим «Онлайн HD» у панелі карти.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const HD_SOURCES = {
  esri: {
    id: 'esri',
    name: 'Esri World Imagery (HD)',
    note: 'Без API-ключа · до z18 (~0,6 м/px)',
    attr: 'Esri World Imagery (онлайн HD)',
    minZoom: 11,
    maxZoom: 18,
    needsKey: false,
    tileUrl(z, x, y) {
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    },
  },
  esri_clarity: {
    id: 'esri_clarity',
    name: 'Esri Clarity (чіткі знімки)',
    note: 'Без API-ключа · архівна висока різкість до z17',
    attr: 'Esri World Imagery Clarity (онлайн HD)',
    minZoom: 11,
    maxZoom: 17,
    needsKey: false,
    tileUrl(z, x, y) {
      return `https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    },
  },
  google: {
    id: 'google',
    name: 'Google Maps Satellite (Map Tiles API)',
    note: 'Потрібен власний Google Cloud API-ключ · до z19',
    attr: '© Google (Map Tiles API)',
    minZoom: 11,
    maxZoom: 19,
    needsKey: true,
    sessionUrl(apiKey) {
      return `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(String(apiKey || '').trim())}`;
    },
    sessionBody() {
      return {
        mapType: 'satellite',
        language: 'uk-UA',
        region: 'UA',
        scale: 'scaleFactor2x',
        highDpi: true,
      };
    },
    tileUrl(z, x, y, ctx) {
      if (!ctx || !ctx.session || !ctx.apiKey) return '';
      return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(ctx.session)}&key=${encodeURIComponent(ctx.apiKey)}`;
    },
  },
};

export function lonLatToTile(lon, lat, z) {
  const n = Math.pow(2, z);
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = clampedLat * D2R;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

export function tileToBbox(x, y, z) {
  const n = Math.pow(2, z);
  const lon0 = (x / n) * 360 - 180;
  const lon1 = ((x + 1) / n) * 360 - 180;
  const lat1 = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * R2D;
  const lat0 = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * R2D;
  return [lon0, lon1, lat0, lat1];
}

// Підбір рівня зуму Web Mercator за висотою камери (в одиницях сцени EasyWAR: 1 од. ≈ 68,9 км).
// Повертає 0, коли камера ще високо й офлайн-база вже достатньо чітка.
export function pickHdZoom(camY, maxZoom = 18, minZoom = 11) {
  if (!Number.isFinite(camY) || camY > 4.2) return 0;
  let z = 11;
  if (camY <= 0.014) z = 19;
  else if (camY <= 0.028) z = 18;
  else if (camY <= 0.056) z = 17;
  else if (camY <= 0.115) z = 16;
  else if (camY <= 0.24) z = 15;
  else if (camY <= 0.50) z = 14;
  else if (camY <= 1.05) z = 13;
  else if (camY <= 2.15) z = 12;
  else z = 11;
  return Math.max(minZoom, Math.min(maxZoom, z));
}

// Кільце тайлів (2*radius+1)^2 навколо точки фокусу, впорядковане від центру назовні й обрізане межами України.
export function visibleTileSpecs(lon, lat, z, radius = 2, bounds = null) {
  if (!z || z < 1) return [];
  const n = Math.pow(2, z);
  const c = lonLatToTile(lon, lat, z);
  const list = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const tx = c.x + dx;
      const ty = c.y + dy;
      if (tx < 0 || tx >= n || ty < 0 || ty >= n) continue;
      const bbox = tileToBbox(tx, ty, z);
      if (bounds) {
        if (bbox[1] < bounds.lon0 || bbox[0] > bounds.lon1 || bbox[3] < bounds.lat0 || bbox[2] > bounds.lat1) continue;
      }
      list.push({ key: `${z}/${tx}/${ty}`, z, x: tx, y: ty, bbox, dist2: dx * dx + dy * dy });
    }
  }
  list.sort((a, b) => a.dist2 - b.dist2);
  return list;
}
