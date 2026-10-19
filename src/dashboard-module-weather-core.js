// Модель картки «Метеоумови»: чиста логіка без DOM, Tauri і WebGL. Із рядків модуля (спостереження
// на пунктах) будуються кадри часу: на кожен момент — пункти з хмарністю, межами хмар, видимістю,
// вітром і явищем, оцінка небезпеки, підсумковий рядок показників, сітка хмарності (зважена за
// відстанню) та ізолінії. Тут же — допоміжні функції 3D-сцени, які можна перевірити без браузера:
// розбір heights.png, проєкція в кілометри сцени й розкладка хмар над пунктом.

import { formatValue } from './dashboard-module-catalog-core.js';

/** Скільки останніх моментів часу показує шкала; старіші спостереження не малюються. */
export const FRAME_LIMIT = 24;
/** Ізолінії хмарності (бали 0–10): «помірно», «значно», «суцільно». */
export const CLOUD_LEVELS = Object.freeze([3, 6, 8]);
/** Межі сітки хмарності: материкова Україна з невеликим запасом (градуси). */
export const WEATHER_BOUNDS = Object.freeze({ west: 22.1, east: 40.3, south: 44.3, north: 52.4 });
const GRID = { cols: 40, rows: 24 };
/** Далі від найближчого пункту (у градусах широти) значення сітки не вгадується. */
const REACH = 3.2;
const STATION_LIMIT = 200;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => (value == null ? '' : String(value).trim());
const pad2 = number => String(number).padStart(2, '0');
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/u;

function moment(value) {
  const match = ISO.exec(text(value));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || (hour || 0) > 23 || (minute || 0) > 59) return null;
  return {
    time: Date.UTC(year, month - 1, day, hour || 0, minute || 0),
    key: `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour || 0)}:${pad2(minute || 0)}`,
    label: `${pad2(day)}.${pad2(month)} ${pad2(hour || 0)}:${pad2(minute || 0)}`,
    short: `${pad2(hour || 0)}:${pad2(minute || 0)}`,
  };
}

const number = (value, digits = 0) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: digits }).format(value);

/** Підписи значень погоди: «5/10», «300 м», «2,5 км», «7 м/с». */
export const weatherText = {
  cover: value => (finite(value) ? `${number(value, 1)}/10` : '—'),
  height: value => (finite(value) ? `${number(value)} м` : '—'),
  visibility: value => (finite(value) ? `${number(value, 1)} км` : '—'),
  wind: value => (finite(value) ? `${number(value, 1)} м/с` : '—'),
};

const SEVERE = /гроз|град|шквал|туман|ожелед|смерч|хуртовин|завірюх|буря|пилов/u;

/**
 * Небезпека для польотів за спостереженням: `bad` — небезпечне явище, НМХ нижче 200 м, видимість
 * менше 2 км або вітер від 15 м/с; `warn` — інше явище, НМХ нижче 450 м, видимість менше 5 км,
 * вітер від 10 м/с або хмарність від 8 балів. Причини — короткими словами для підказки.
 */
export function weatherHazard({ cover, lower, visibility, wind, phenomenon } = {}) {
  const reasons = [];
  let tone = '';
  const raise = (level, reason) => { reasons.push(reason); if (level === 'bad' || !tone) tone = level; };
  const event = text(phenomenon).toLocaleLowerCase('uk');
  if (event) raise(SEVERE.test(event) ? 'bad' : 'warn', text(phenomenon));
  if (finite(lower)) {
    if (lower < 200) raise('bad', `НМХ ${weatherText.height(lower)}`);
    else if (lower < 450) raise('warn', `НМХ ${weatherText.height(lower)}`);
  }
  if (finite(visibility)) {
    if (visibility < 2) raise('bad', `видимість ${weatherText.visibility(visibility)}`);
    else if (visibility < 5) raise('warn', `видимість ${weatherText.visibility(visibility)}`);
  }
  if (finite(wind)) {
    if (wind >= 15) raise('bad', `вітер ${weatherText.wind(wind)}`);
    else if (wind >= 10) raise('warn', `вітер ${weatherText.wind(wind)}`);
  }
  if (finite(cover) && cover >= 8 && !reasons.length) raise('warn', `хмарність ${weatherText.cover(cover)}`);
  return { tone, reasons };
}

/**
 * Сітка значення за пунктами методом зворотних відстаней (степінь 2) у межах `bounds`.
 * Вузол далі `REACH` градусів від найближчого пункту — `null`: дані там не вгадуються.
 * Повертає масив `rows × cols` (рядки з півночі на південь).
 */
export function idwGrid(points, bounds = WEATHER_BOUNDS, cols = GRID.cols, rows = GRID.rows, reach = REACH) {
  const values = new Array(cols * rows).fill(null);
  const usable = points.filter(point => finite(point.value) && finite(point.latitude) && finite(point.longitude));
  if (!usable.length) return values;
  const midLat = (bounds.north + bounds.south) / 2 * Math.PI / 180;
  const kx = Math.cos(midLat);
  for (let row = 0; row < rows; row += 1) {
    const lat = bounds.north - (row / (rows - 1)) * (bounds.north - bounds.south);
    for (let col = 0; col < cols; col += 1) {
      const lon = bounds.west + (col / (cols - 1)) * (bounds.east - bounds.west);
      let weight = 0;
      let sum = 0;
      let nearest = Infinity;
      let exact = null;
      for (const point of usable) {
        const dx = (point.longitude - lon) * kx;
        const dy = point.latitude - lat;
        const d2 = dx * dx + dy * dy;
        nearest = Math.min(nearest, d2);
        if (d2 < 1e-9) { exact = point.value; break; }
        const w = 1 / d2;
        weight += w;
        sum += w * point.value;
      }
      if (exact != null) values[row * cols + col] = exact;
      else if (Math.sqrt(nearest) <= reach) values[row * cols + col] = sum / weight;
    }
  }
  return values;
}

/**
 * Ізолінія рівня `level` на сітці алгоритмом «марширувальних квадратів». Відрізки — у координатах
 * сітки (стовпчик, рядок, дробові): `[x1, y1, x2, y2]`. Клітинка з порожнім вузлом пропускається.
 */
export function contourSegments(values, cols, rows, level) {
  const segments = [];
  const at = (col, row) => values[row * cols + col];
  const cross = (a, b) => (level - a) / (b - a);
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const tl = at(col, row); const tr = at(col + 1, row);
      const br = at(col + 1, row + 1); const bl = at(col, row + 1);
      if (![tl, tr, br, bl].every(finite)) continue;
      const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = [col + cross(tl, tr), row];
      const right = [col + 1, row + cross(tr, br)];
      const bottom = [col + cross(bl, br), row + 1];
      const left = [col, row + cross(tl, bl)];
      const centre = (tl + tr + br + bl) / 4;
      const pairs = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
        5: centre >= level ? [[left, top], [bottom, right]] : [[left, bottom], [top, right]],
        6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]], 9: [[top, bottom]],
        10: centre >= level ? [[top, right], [left, bottom]] : [[top, left], [bottom, right]],
        11: [[top, right]], 12: [[left, right]], 13: [[bottom, right]], 14: [[left, bottom]],
      }[code];
      for (const [a, b] of pairs) segments.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return segments;
}

function fieldsByKey(module) {
  const fields = Array.isArray(module?.fields) ? module.fields : [];
  const byKey = new Map(fields.map(field => [field.key, field]));
  const pick = (key, role) => byKey.get(key) || (role ? fields.find(field => field.role === role) : null) || null;
  return {
    time: pick('observed_at') || fields.find(field => ['date', 'datetime'].includes(field.dataType)) || null,
    label: pick('label', 'label'),
    latitude: pick('latitude', 'latitude'),
    longitude: pick('longitude', 'longitude'),
    cover: pick('cloud_cover'),
    lower: pick('cloud_base_lower'),
    upper: pick('cloud_base_upper'),
    visibility: pick('visibility'),
    wind: pick('wind_speed'),
    phenomenon: pick('phenomenon', 'status'),
  };
}

const average = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function summaryOf(stations, has) {
  const of = key => stations.map(station => station[key]).filter(finite);
  const cells = [
    has.cover && { key: 'cover', label: 'Хмарність', value: average(of('cover')), text: weatherText.cover },
    has.lower && { key: 'lower', label: 'НМХ', value: of('lower').length ? Math.min(...of('lower')) : null, text: weatherText.height, note: 'найнижча' },
    has.upper && { key: 'upper', label: 'ВМХ', value: of('upper').length ? Math.max(...of('upper')) : null, text: weatherText.height, note: 'найвища' },
    has.visibility && { key: 'visibility', label: 'Видимість', value: of('visibility').length ? Math.min(...of('visibility')) : null, text: weatherText.visibility, note: 'найгірша' },
    has.wind && { key: 'wind', label: 'Вітер', value: of('wind').length ? Math.max(...of('wind')) : null, text: weatherText.wind, note: 'найсильніший' },
  ].filter(Boolean);
  return cells.map(cell => {
    const probe = { [cell.key]: cell.value };
    return { key: cell.key, label: cell.label, note: cell.note || 'середня', valueText: cell.text(cell.value), tone: weatherHazard(probe).tone };
  });
}

/**
 * Модель картки: `frames` — до `FRAME_LIMIT` останніх моментів у порядку часу, `current` — індекс
 * останнього. Пункт у кадрі один на назву (пізніший рядок замінює попередній).
 */
export function weatherModel(module, rows) {
  const f = fieldsByKey(module);
  const has = { cover: !!f.cover, lower: !!f.lower, upper: !!f.upper, visibility: !!f.visibility, wind: !!f.wind };
  const list = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  const read = (row, field) => (field && finite(row?.[field.key]) ? row[field.key] : null);
  const groups = new Map();
  let skipped = 0;
  for (const row of list) {
    const when = moment(row?.[f.time?.key]);
    const latitude = read(row, f.latitude);
    const longitude = read(row, f.longitude);
    if (!when || latitude == null || longitude == null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { skipped += 1; continue; }
    if (!groups.has(when.key)) groups.set(when.key, { when, stations: new Map() });
    const label = text(row?.[f.label?.key]) || `${number(latitude, 2)}, ${number(longitude, 2)}`;
    const station = {
      label,
      latitude,
      longitude,
      cover: read(row, f.cover) == null ? null : Math.max(0, Math.min(10, read(row, f.cover))),
      lower: read(row, f.lower),
      upper: read(row, f.upper),
      visibility: read(row, f.visibility),
      wind: read(row, f.wind),
      // Порожня клітинка — «явища немає», а не прочерк, який виглядав би як явище.
      phenomenon: f.phenomenon && text(row?.[f.phenomenon.key]) ? text(formatValue(row[f.phenomenon.key])) : '',
    };
    if (finite(station.lower) && finite(station.upper) && station.upper < station.lower) [station.lower, station.upper] = [station.upper, station.lower];
    groups.get(when.key).stations.set(label, station);
  }
  const ordered = [...groups.values()].sort((left, right) => left.when.time - right.when.time);
  const older = Math.max(0, ordered.length - FRAME_LIMIT);
  const frames = ordered.slice(older).map(({ when, stations }) => {
    const items = [...stations.values()].slice(0, STATION_LIMIT).map(station => {
      const hazard = weatherHazard(station);
      const parts = [weatherText.cover(station.cover)];
      if (finite(station.lower)) parts.push(`НМХ ${weatherText.height(station.lower)}`);
      if (finite(station.visibility)) parts.push(weatherText.visibility(station.visibility));
      return { ...station, tone: hazard.tone, reasons: hazard.reasons, callout: parts.join(' · ') };
    });
    const grid = idwGrid(items.map(item => ({ latitude: item.latitude, longitude: item.longitude, value: item.cover })));
    const worst = items.find(item => item.tone === 'bad') || items.find(item => item.tone === 'warn') || null;
    return {
      key: when.key,
      label: when.label,
      short: when.short,
      tone: worst?.tone || '',
      hazardText: worst ? `${worst.label}: ${worst.reasons.join(', ')}` : '',
      stations: items,
      summary: summaryOf(items, has),
      grid: { cols: GRID.cols, rows: GRID.rows, bounds: WEATHER_BOUNDS, values: grid },
      isolines: CLOUD_LEVELS.map(level => ({ level, segments: contourSegments(grid, GRID.cols, GRID.rows, level) })),
    };
  });
  return {
    kind: 'weather',
    empty: !list.length,
    frames,
    current: frames.length - 1,
    skipped,
    older,
    has,
  };
}

// ---------------------------------------------------------------------------------------------
// 3D-рельєф: heights.png із src/public/map-assets (R·256 + G − 1000 = метри, B = маска суші).

/** Покриття heights.png у градусах і його розмір (як у map-app.js). */
export const RELIEF_META = Object.freeze({ w: 2048, h: 1398, lon0: 21.9, lon1: 40.5, lat0: 44.05, lat1: 52.5, coslat: 0.66556 });
/** Перебільшення висот у сцені: рівнина України інакше виглядала б пласкою. */
export const RELIEF_EXAGGERATION = 25;

/** Ширина й глибина сцени в кілометрах (рівнопроміжна проєкція з косинусом середньої широти). */
export function reliefSize(meta = RELIEF_META) {
  return {
    width: (meta.lon1 - meta.lon0) * meta.coslat * 111.32,
    depth: (meta.lat1 - meta.lat0) * 111.32,
  };
}

/** Градуси → координати сцени (км): центр карти в нулі, +x на схід, +z на південь. */
export function reliefProject(lon, lat, meta = RELIEF_META) {
  const { width, depth } = reliefSize(meta);
  return {
    x: ((lon - meta.lon0) / (meta.lon1 - meta.lon0) - 0.5) * width,
    z: ((meta.lat1 - lat) / (meta.lat1 - meta.lat0) - 0.5) * depth,
  };
}

/** Висота в метрах → висота в сцені (км з перебільшенням). */
export const reliefY = metres => (Math.max(0, metres) / 1000) * RELIEF_EXAGGERATION;

/**
 * Розбір пікселів heights.png (RGBA, `width × height`) у грубішу сітку з кроком `step` пікселів:
 * висоти (м, середнє в клітинці; море — від'ємне) і маска суші (0…1, частка в клітинці).
 */
export function decodeHeights(pixels, width, height, step = 6) {
  const cols = Math.max(2, Math.floor(width / step));
  const rows = Math.max(2, Math.floor(height / step));
  const heights = new Float32Array(cols * rows);
  const land = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let total = 0;
      let landCount = 0;
      let count = 0;
      const y0 = Math.floor(row * height / rows); const y1 = Math.max(y0 + 1, Math.floor((row + 1) * height / rows));
      const x0 = Math.floor(col * width / cols); const x1 = Math.max(x0 + 1, Math.floor((col + 1) * width / cols));
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          total += pixels[i] * 256 + pixels[i + 1] - 1000;
          if (pixels[i + 2] > 127) landCount += 1;
          count += 1;
        }
      }
      heights[row * cols + col] = count ? total / count : 0;
      land[row * cols + col] = count ? landCount / count : 0;
    }
  }
  return { cols, rows, heights, land };
}

/**
 * Згладжування висот рамкою 3 × 3 (`passes` разів): без нього ізогіпси на рівнині дрібно «рябіють»
 * від шуму SRTM. Море (висота ≤ 0) не змішується із сушею, щоб не розмити берег.
 */
export function smoothHeights(relief, passes = 1) {
  const { cols, rows } = relief;
  let source = relief.heights;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(source.length);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const sea = source[index] <= 0;
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const y = row + dy; const x = col + dx;
            if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
            const value = source[y * cols + x];
            if ((value <= 0) !== sea) continue;
            sum += value;
            count += 1;
          }
        }
        next[index] = sum / count;
      }
    }
    source = next;
  }
  return { ...relief, heights: source };
}

/** Висота рельєфу (м) у точці з розібраної сітки, білінійно; поза сіткою — 0. */
export function sampleRelief(relief, lon, lat, meta = RELIEF_META) {
  if (!relief) return 0;
  const { cols, rows, heights } = relief;
  const x = (lon - meta.lon0) / (meta.lon1 - meta.lon0) * (cols - 1);
  const y = (meta.lat1 - lat) / (meta.lat1 - meta.lat0) * (rows - 1);
  if (x < 0 || y < 0 || x > cols - 1 || y > rows - 1) return 0;
  const xi = Math.min(cols - 2, Math.floor(x)); const yi = Math.min(rows - 2, Math.floor(y));
  const fx = x - xi; const fy = y - yi; const i = yi * cols + xi;
  return Math.max(0, heights[i] * (1 - fx) * (1 - fy) + heights[i + 1] * fx * (1 - fy) + heights[i + cols] * (1 - fx) * fy + heights[i + cols + 1] * fx * fy);
}

/** Детермінований генератор (mulberry32) із зерном від назви пункту: хмари не «стрибають» між кадрами. */
export function seededRandom(seedText) {
  let seed = 2166136261;
  for (const char of text(seedText)) seed = Math.imul(seed ^ char.codePointAt(0), 16777619);
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Типові межі, коли їх не вказано: НМХ 600 м, товщина шару 800 м (позначаються як припущення). */
export const DEFAULT_CLOUD = Object.freeze({ lower: 600, thickness: 800 });

/**
 * Клуби хмари над пунктом у координатах сцени: кількість — від хмарності (10 на бал), радіус
 * розкиду росте з хмарністю, висота — між НМХ і ВМХ над рельєфом. `assumed` — межі не вказані.
 */
export function cloudPuffs(station, groundMetres = 0) {
  const cover = finite(station?.cover) ? station.cover : 0;
  if (cover <= 0) return { puffs: [], assumed: false };
  const assumed = !finite(station.lower);
  const lower = assumed ? DEFAULT_CLOUD.lower : station.lower;
  const upper = finite(station.upper) && station.upper > lower ? station.upper : lower + DEFAULT_CLOUD.thickness;
  const random = seededRandom(station.label);
  const centre = reliefProject(station.longitude, station.latitude);
  const radius = 30 + cover * 9;
  const count = Math.round(cover * 10);
  const puffs = [];
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    const height = lower + random() * (upper - lower);
    puffs.push({
      x: centre.x + Math.cos(angle) * distance,
      z: centre.z + Math.sin(angle) * distance,
      y: reliefY(groundMetres + height),
      size: 34 + random() * 46 + cover * 3,
      alpha: (0.18 + random() * 0.32) * (0.45 + cover / 18),
    });
  }
  return { puffs, assumed, lower, upper };
}

export const dashboardModuleWeatherCore = {
  FRAME_LIMIT, CLOUD_LEVELS, WEATHER_BOUNDS, RELIEF_META, RELIEF_EXAGGERATION, DEFAULT_CLOUD,
  weatherText, weatherHazard, idwGrid, contourSegments, weatherModel,
  reliefSize, reliefProject, reliefY, decodeHeights, smoothHeights, sampleRelief, seededRandom, cloudPuffs,
};
