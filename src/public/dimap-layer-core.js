/* EasyWAR — шар DIMAP на карті дашборда: чиста логіка без DOM і без мережі.
   Підключається класичним скриптом в air.html і rocket.html та в node-тестах;
   результат — globalThis.EWDimapCore. Запит до служби робить лише Rust. */
(function (root) {
  'use strict';

  var POLL_MS = 10000;
  var MAX_DRAW = 120;
  /* Центри областей з src/public/map-assets/oblasts.json. Це точки, не контури. */
  var OBLASTS = [
    ['Херсонська', 33.4653, 46.5496], ['Волинська', 24.8705, 51.1909], ['Рівненська', 26.3918, 51.0403],
    ['Житомирська', 28.4761, 50.6402], ['Київська', 30.4582, 50.3028], ['Чернігівська', 32.0038, 51.355],
    ['Сумська', 34.1239, 51.1061], ['Харківська', 36.5048, 49.615], ['Луганська', 39.018, 48.9856],
    ['Донецька', 37.6756, 47.9554], ['Запорізька', 35.7726, 47.1683], ['Львівська', 23.9169, 49.7173],
    ['Івано-Франківська', 24.6194, 48.7011], ['Закарпатська', 23.276, 48.4038], ['Тернопільська', 25.6481, 49.4019],
    ['Чернівецька', 25.9773, 48.2684], ['Одеська', 29.9371, 46.5829], ['Миколаївська', 31.766, 47.3943],
    ['АР Крим', 34.4272, 45.2658], ['Вінницька', 28.6855, 48.9206], ['Хмельницька', 26.9296, 49.5075],
    ['Черкаська', 31.3526, 49.2602], ['Полтавська', 33.7785, 49.7325], ['Дніпропетровська', 34.8437, 48.3009],
    ['Кіровоградська', 32.0819, 48.4723]
  ];
  var TRAJ_TAIL = 8;
  var TYPE_STYLE = {
    fpv: { fill: '#3DDC97', glyph: 'fpv' },
    shahed: { fill: '#FF5A5A', glyph: 'delta' },
    reactive_shahed: { fill: '#FF8A3D', glyph: 'double' },
    avia: { fill: '#7AD7FF', glyph: 'plane' },
    kab: { fill: '#C792EA', glyph: 'kab' },
    missile: { fill: '#C792EA', glyph: 'dart' },
    cruise_missile: { fill: '#9B7BFF', glyph: 'dart' },
    uav: { fill: '#5AA9FF', glyph: 'arrow' },
    drone: { fill: '#5AA9FF', glyph: 'arrow' }
  };
  var GLYPH = {
    arrow: 'M0,-8 L4.6,6.2 L0,3.1 L-4.6,6.2 Z',
    delta: 'M0,-9 L7.2,7 L-7.2,7 Z',
    double: 'M0,-9 L6.2,-0.4 L0,-2.4 L-6.2,-0.4 Z M0,0.6 L5.2,8 L0,5.2 L-5.2,8 Z',
    dart: 'M0,-10 L2.3,6.4 L0,4.2 L-2.3,6.4 Z',
    plane: 'M0,-9 L7,2 L2.2,2 L1.1,7 L-1.1,7 L-2.2,2 L-7,2 Z',
    kab: 'M0,-9 L4.2,0 L0,8 L-4.2,0 Z',
    fpv: 'M0,-8 L5.2,1.4 L0,-1.2 L-5.2,1.4 Z M-1.6,3.2 H1.6 V7.4 H-1.6 Z'
  };
  var ALERT_FILL = {
    red: 'rgba(240,64,64,.40)',
    orange: 'rgba(255,140,40,.40)',
    yellow: 'rgba(240,196,48,.42)',
    green: 'rgba(60,180,90,.34)',
    purple: 'rgba(160,90,220,.36)'
  };
  var ALERT_RANK = { red: 0, orange: 1, yellow: 2, purple: 3, green: 4 };
  var TYPE_LABEL = {
    fpv: 'FPV', shahed: 'Шахед', reactive_shahed: 'реактивний Шахед',
    avia: 'Авіація', kab: 'КАБ',
    missile: 'ракета', cruise_missile: 'крилата ракета', uav: 'БпЛА', drone: 'БпЛА'
  };
  var LOCAL_KIND = { district: 1, community: 1, city: 1 };
  var EMPTY = 'Немає даних DIMAP';
  var ATTR = 'Дані: DIMAP (неофіційно)';

  function backoffMs(failures) {
    var n = failures >>> 0;
    if (!n) return POLL_MS;
    var shift = Math.min(5, n - 1);
    return Math.min(300000, POLL_MS * Math.pow(2, shift));
  }

  function savedEnabled(raw) {
    try {
      var value = JSON.parse(raw || '');
      return !!(value && value.enabled === true);
    } catch (e) { return false; }
  }

  function cleanText(value, max) {
    var text = String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, max || 80);
  }

  function asNumber(value) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      var n = Number(value);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function asMillis(value) {
    var n = asNumber(value);
    if (n == null) {
      if (typeof value !== 'string' || !value.trim()) return null;
      var parsed = Date.parse(value);
      return isFinite(parsed) ? parsed : null;
    }
    if (Math.abs(n) < 10000000000) return Math.round(n * 1000);
    return Math.round(n);
  }

  function rotation(bearing) {
    var n = asNumber(bearing);
    if (n == null) return 0;
    n = n % 360;
    return n < 0 ? n + 360 : n;
  }

  function styleFor(kind) {
    return TYPE_STYLE[kind] || { fill: '#5AA9FF', glyph: 'arrow' };
  }

  function alertFill(color) {
    return ALERT_FILL[String(color || '').toLowerCase()] || 'rgba(240,64,64,.40)';
  }

  function normRegion(value) {
    var drop = { область: 1, обл: 1, район: 1, місто: 1, громада: 1, р: 1, н: 1 };
    return cleanText(value, 120).toLowerCase()
      .replace(/ё/g, 'е').replace(/['’`]/g, '')
      .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ')
      .replace(/\s+/g, ' ').trim()
      .split(' ').filter(function (word) { return word && !drop[word]; }).join(' ');
  }

  function oblastByName(region) {
    var key = normRegion(region);
    if (!key) return null;
    for (var i = 0; i < OBLASTS.length; i++) {
      if (normRegion(OBLASTS[i][0]) === key) return { name: OBLASTS[i][0], lng: OBLASTS[i][1], lat: OBLASTS[i][2] };
    }
    return null;
  }

  function targetList(input) {
    if (!input || typeof input !== 'object') return [];
    var block = input.data && typeof input.data === 'object' ? input.data : input;
    if (Array.isArray(block.targets)) return block.targets;
    if (block.targets && Array.isArray(block.targets.targets)) return block.targets.targets;
    return [];
  }

  function alertList(input) {
    if (!input || typeof input !== 'object') return [];
    var block = input.data && typeof input.data === 'object' ? input.data : input;
    if (Array.isArray(block.alerts)) return block.alerts;
    if (block.alerts && Array.isArray(block.alerts.alerts)) return block.alerts.alerts;
    return [];
  }

  function updatedMs(input) {
    if (!input || typeof input !== 'object') return null;
    var block = input.data && typeof input.data === 'object' ? input.data : input;
    var alerts = block.alerts && !Array.isArray(block.alerts) ? block.alerts : null;
    var targets = block.targets && !Array.isArray(block.targets) ? block.targets : null;
    return asMillis(block.updatedAtMs) || asMillis(alerts && alerts.updatedAt) || asMillis(targets && targets.timestamp) || asMillis(block.updatedAt);
  }

  function formatKyiv(ms) {
    if (!isFinite(ms)) return '';
    try {
      return new Intl.DateTimeFormat('uk-UA', {
        timeZone: 'Europe/Kyiv',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(ms));
    } catch (e) { return ''; }
  }

  function pointOf(raw) {
    if (Array.isArray(raw) && raw.length >= 2) return { lat: asNumber(raw[0]), lng: asNumber(raw[1]) };
    if (raw && typeof raw === 'object') return { lat: asNumber(raw.lat), lng: asNumber(raw.lng) };
    return null;
  }

  /* Короткий хвіст траєкторії. path — [широта, довгота, …]; observed — {lat,lng}. Історію не беремо. */
  function shortTraj(item) {
    var pts = [];
    var traj = item && item.traj;
    if (Array.isArray(traj)) pts = traj;
    else if (traj && typeof traj === 'object') {
      var path = Array.isArray(traj.path) ? traj.path : [];
      for (var i = 0; i < path.length; i++) pts.push(path[i]);
      if (!pts.length && Array.isArray(traj.observed)) {
        for (var j = 0; j < traj.observed.length; j++) pts.push(traj.observed[j]);
      }
    }
    var out = [];
    for (var k = Math.max(0, pts.length - TRAJ_TAIL); k < pts.length; k++) {
      var p = pointOf(pts[k]);
      if (!p || p.lat == null || p.lng == null || p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) continue;
      out.push(p);
    }
    return out;
  }

  function tooltip(name, speed, seen) {
    var parts = [name];
    if (isFinite(speed)) parts.push(Math.round(speed) + ' км/год');
    if (seen) parts.push(seen);
    return parts.join(' · ');
  }

  function present(input) {
    var rawTargets = targetList(input).slice(0, MAX_DRAW);
    var rawAlerts = alertList(input).slice(0, MAX_DRAW);
    var targets = [];
    for (var i = 0; i < rawTargets.length; i++) {
      var item = rawTargets[i];
      if (!item || typeof item !== 'object') continue;
      var lat = asNumber(item.lat);
      var lng = asNumber(item.lng);
      if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      var kind = cleanText(item.kind || item.type, 40);
      var style = styleFor(kind);
      var name = cleanText(item.name, 80) || TYPE_LABEL[kind] || 'Ціль';
      var speed = asNumber(item.speed);
      if (!(speed >= 0 && speed <= 2000)) speed = null;
      var seenMs = asMillis(item.lastSeenMs != null ? item.lastSeenMs : item.lastSeen);
      targets.push({
        id: cleanText(item.id, 64) || ('t' + i),
        lat: lat, lng: lng, bearing: rotation(item.bearing),
        fill: style.fill, glyph: style.glyph, d: GLYPH[style.glyph],
        name: name, title: tooltip(name, speed, formatKyiv(seenMs)),
        traj: shortTraj(item)
      });
    }
    var alerts = [];
    var halos = [];
    var haloAt = {};
    for (var a = 0; a < rawAlerts.length; a++) {
      var alert = rawAlerts[a];
      if (!alert || typeof alert !== 'object') continue;
      var region = cleanText(alert.region, 80);
      if (!region) continue;
      var color = cleanText(alert.color, 20).toLowerCase() || 'red';
      var kindAlert = cleanText(alert.kind, 20).toLowerCase();
      var typeName = cleanText(alert.typeName, 40);
      var placeName = cleanText(alert.city || alert.district || region, 80) || region;
      var id = cleanText(alert.id, 64) || ('a' + a);
      alerts.push({ id: id, region: region, color: color, fill: alertFill(color), kind: kindAlert, label: typeName ? placeName + ' · ' + typeName : placeName });
      if (LOCAL_KIND[kindAlert]) continue;
      var place = oblastByName(region);
      if (!place) continue;
      var rank = ALERT_RANK[color] == null ? 9 : ALERT_RANK[color];
      var prev = haloAt[place.name];
      if (prev && prev.rank <= rank) continue;
      haloAt[place.name] = { rank: rank, id: id, lat: place.lat, lng: place.lng, fill: alertFill(color), title: typeName ? place.name + ' · ' + typeName : place.name, region: place.name };
    }
    for (var key in haloAt) if (Object.prototype.hasOwnProperty.call(haloAt, key)) halos.push(haloAt[key]);
    var when = updatedMs(input);
    var has = targets.length || alerts.length;
    return {
      updatedAtMs: when,
      targets: targets,
      halos: halos,
      alerts: alerts,
      statusText: has ? '' : EMPTY,
      updatedLabel: when ? formatKyiv(when) : '',
      attribution: ATTR
    };
  }

  function layoutMarkers(targets, project) {
    var out = [];
    for (var i = 0; i < (targets || []).length; i++) {
      var t = targets[i];
      var p = project(t.lng, t.lat);
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      out.push({ id: t.id, x: p.x, y: p.y, rot: rotation(t.bearing), d: t.d, fill: t.fill, title: t.title });
    }
    return out;
  }

  function layoutTracks(targets, project) {
    var out = [];
    for (var i = 0; i < (targets || []).length; i++) {
      var t = targets[i];
      if (!t.traj || t.traj.length < 2) continue;
      var d = '';
      var n = 0;
      for (var k = 0; k < t.traj.length; k++) {
        var p = project(t.traj[k].lng, t.traj[k].lat);
        if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
        d += (n ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
        n++;
      }
      if (n >= 2) out.push({ id: t.id, d: d, stroke: t.fill });
    }
    return out;
  }

  function layoutHalos(halos, project) {
    var out = [];
    for (var i = 0; i < (halos || []).length; i++) {
      var h = halos[i];
      var p = project(h.lng, h.lat);
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      out.push({ id: h.id, x: p.x, y: p.y, fill: h.fill, title: h.title });
    }
    return out;
  }

  root.EWDimapCore = {
    POLL_MS: POLL_MS,
    EMPTY: EMPTY,
    ATTR: ATTR,
    OBLASTS: OBLASTS,
    backoffMs: backoffMs,
    savedEnabled: savedEnabled,
    rotation: rotation,
    formatKyiv: formatKyiv,
    present: present,
    layoutMarkers: layoutMarkers,
    layoutTracks: layoutTracks,
    layoutHalos: layoutHalos,
    oblastByName: oblastByName,
    normRegion: normRegion
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
