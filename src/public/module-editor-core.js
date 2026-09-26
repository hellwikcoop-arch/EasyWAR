/* EasyWAR — «Редактор модуля»: чиста логіка без DOM (валідація, пошук, застосування до довідників).
   Підключається класичним скриптом у модулі та в node-тестах; результат — globalThis.EWModuleEditorCore. */
(function (root) {
  'use strict';

  const VERSION = 1;
  const MAX_TEXT = 400;
  const MAX_ITEMS = 500;
  const IMAGE_RE = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
  const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const VAR_RE = /^--[a-z][a-z0-9-]{0,40}$/i;
  const BLOCK_RE = /^p-[a-z0-9-]{1,40}$/;
  const ID_RE = /^[a-z0-9]{1,24}$/;
  const FP_RE = /^\d{1,9}:[0-9a-f]{8}$/;
  const KINDS = ['munition', 'carrier'];

  /** Латиниця/кирилиця, що виглядають однаково, зводяться до латиниці; пробіли й дефіси прибираються. */
  const CYR2LAT = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y' };
  function norm(value) {
    return String(value == null ? '' : value).toUpperCase()
      .replace(/[АВСЕНІКМОРТХУ]/g, ch => CYR2LAT[ch])
      .replace(/[\s\-–—_.·/\\()«»"']+/g, '');
  }

  function str(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max || MAX_TEXT) : '';
  }
  function img(value) {
    return typeof value === 'string' && value.length < 12e6 && IMAGE_RE.test(value) ? value : '';
  }

  function empty() {
    return { version: VERSION, units: [], weapons: [], images: {}, texts: [], colors: {}, blocks: {} };
  }

  /** Перевіряє та нормалізує конфігурацію (зокрема з імпортованого файлу). Невалідні елементи відкидаються. */
  function sanitize(input) {
    const out = empty();
    if (!input || typeof input !== 'object') return out;
    const units = Array.isArray(input.units) ? input.units.slice(0, MAX_ITEMS) : [];
    for (const u of units) {
      const name = str(u && u.name, 120), logo = img(u && u.logo);
      if (name && logo && !out.units.some(x => norm(x.name) === norm(name))) out.units.push({ name, logo });
    }
    const weapons = Array.isArray(input.weapons) ? input.weapons.slice(0, MAX_ITEMS) : [];
    for (const w of weapons) {
      if (!w || typeof w !== 'object' || !KINDS.includes(w.kind)) continue;
      const name = str(w.name, 80); if (!name) continue;
      let id = typeof w.id === 'string' && ID_RE.test(w.id) ? w.id : newId();
      while (out.weapons.some(x => x.id === id)) id = newId();
      const aliases = (Array.isArray(w.aliases) ? w.aliases : String(w.aliases || '').split(','))
        .map(a => str(a, 60)).filter(Boolean).slice(0, 20);
      out.weapons.push({
        id, kind: w.kind, name, aliases,
        title: str(w.title, 80), desc: str(w.desc, 200),
        range: str(w.range, 60), guidance: str(w.guidance, 60), warhead: str(w.warhead, 60),
        icon: img(w.icon), photo: img(w.photo), banner: img(w.banner),
      });
    }
    if (input.images && typeof input.images === 'object') {
      for (const [fp, src] of Object.entries(input.images).slice(0, MAX_ITEMS)) if (FP_RE.test(fp) && img(src)) out.images[fp] = src;
    }
    const texts = Array.isArray(input.texts) ? input.texts.slice(0, MAX_ITEMS) : [];
    for (const t of texts) {
      const from = str(t && t.from), to = typeof (t && t.to) === 'string' ? t.to.slice(0, MAX_TEXT) : '';
      if (from && from !== to.trim() && !out.texts.some(x => x.from === from)) out.texts.push({ from, to });
    }
    if (input.colors && typeof input.colors === 'object') {
      for (const [name, value] of Object.entries(input.colors).slice(0, 100)) if (VAR_RE.test(name) && COLOR_RE.test(value)) out.colors[name] = value.toLowerCase();
    }
    if (input.blocks && typeof input.blocks === 'object') {
      for (const [id, b] of Object.entries(input.blocks).slice(0, 100)) {
        if (!BLOCK_RE.test(id) || !b || typeof b !== 'object') continue;
        const hidden = b.hidden === true, order = Number.isInteger(b.order) && Math.abs(b.order) < 1000 ? b.order : null;
        if (hidden || order !== null) out.blocks[id] = { hidden, order };
      }
    }
    return out;
  }

  let idSeq = 0;
  function newId() {
    idSeq = (idSeq + 1) % 1296;
    return (Date.now().toString(36) + idSeq.toString(36)).slice(-12);
  }

  /** Стабільний «відбиток» зображення (довжина + FNV-1a від вибірки символів) — ключ заміни. */
  function fingerprint(src) {
    const s = String(src || ''), len = s.length, step = Math.max(1, Math.floor(len / 2048));
    let h = 0x811c9dc5;
    const mix = code => { h ^= code; h = Math.imul(h, 0x01000193) >>> 0; };
    for (let i = 0; i < len; i += step) mix(s.charCodeAt(i));
    for (let i = Math.max(0, len - 64); i < len; i++) mix(s.charCodeAt(i));
    return len + ':' + h.toString(16).padStart(8, '0');
  }

  /** Знаходить власний запис озброєння для назви з таблиці: збіг за назвою або синонімом, найдовший виграє. */
  function matchWeapon(weapons, kind, value) {
    const v = norm(value); if (!v) return null;
    let best = null, bestLen = 0;
    for (const w of weapons || []) {
      if (w.kind !== kind) continue;
      for (const n of [w.name].concat(w.aliases || [])) {
        const k = norm(n);
        if (k.length >= 2 && v.includes(k) && k.length > bestLen) { best = w; bestLen = k.length; }
      }
    }
    return best;
  }
  const weaponKey = w => 'ew' + w.id;

  /** Точна заміна тексту вузла з урахуванням пробілів навколо. */
  function replaceText(data, map) {
    const trimmed = String(data).trim(); if (!trimmed || !map.has(trimmed)) return null;
    const start = data.indexOf(trimmed);
    return data.slice(0, start) + map.get(trimmed) + data.slice(start + trimmed.length);
  }

  /** Копіює вбудовані значення (з ключем base) у складені ключі на кшталт «m142_m30» → «m142_ewX». */
  function cloneComposite(map, base, key) {
    if (!map || typeof map !== 'object' || !base) return;
    for (const k of Object.keys(map)) {
      const parts = k.split('_'); const i = parts.indexOf(base);
      if (i < 0 || parts.length < 2) continue;
      parts[i] = key; const nk = parts.join('_');
      if (!(nk in map)) map[nk] = map[k];
    }
  }

  /**
   * Застосовує власне озброєння до довідників модуля. get(name) повертає глобальний об'єкт модуля або undefined;
   * origKey(kind, name) — вбудований ключ (до перехоплення), щоб успадкувати наявні зображення й дані.
   */
  function applyWeapons(weapons, get, origKey) {
    const M = n => { const v = get(n); return v && typeof v === 'object' ? v : null; };
    const IMG = M('IMG'), IMG2 = M('IMG2'), MUN_IMG = M('MUN_IMG'), MUN_W = M('MUN_W'), MUN_INFO = M('MUN_INFO'), MUN_SPEC = M('MUN_SPEC'),
      MUN_BANNER = M('MUN_BANNER'), WEAPONS = M('WEAPONS'), CARRIERS = M('CARRIERS'), AC_IMG = M('AC_IMG'), PLAT = M('ROCKET_PLATFORM_MEDIA');
    const set = (map, k, v) => { if (map && v) map[k] = v; };
    const inherit = (map, k, base) => { if (map && base && map[base] !== undefined && map[k] === undefined) map[k] = map[base]; };
    for (const w of weapons || []) {
      const key = weaponKey(w), base = origKey(w.kind, w.name) || '';
      if (w.kind === 'munition') {
        set(MUN_IMG, key, w.icon); inherit(MUN_IMG, key, base);
        if (MUN_W && MUN_IMG && MUN_IMG[key]) MUN_W[key] = MUN_W[base] || 280;
        set(IMG, key, w.photo);
        set(MUN_BANNER, key, w.banner); inherit(MUN_BANNER, key, base);
        if (MUN_INFO) {
          const b = MUN_INFO[base] || {}, bsub = Array.isArray(b.sub) ? b.sub : [];
          const info = Object.assign({}, b, { sub: [w.title || bsub[0] || w.name, w.desc || bsub[1] || ''].filter(Boolean) });
          if (w.photo) { info.src = w.photo; info.img = key; }
          MUN_INFO[key] = info;
        }
        if (MUN_SPEC) {
          const b = MUN_SPEC[base] || {};
          MUN_SPEC[key] = { rng: w.range || b.rng || '', gd: w.guidance || b.gd || '', wh: w.warhead || b.wh || '', desc: w.desc || b.desc || '' };
        }
        cloneComposite(WEAPONS, base, key); cloneComposite(CARRIERS, base, key);
        if (WEAPONS && w.photo) for (const k of Object.keys(WEAPONS)) if (k.endsWith('_' + key)) WEAPONS[k] = w.photo;
      } else {
        set(AC_IMG, key, w.icon); inherit(AC_IMG, key, base);
        set(CARRIERS, key, w.photo); inherit(CARRIERS, key, base);
        set(IMG, key, w.photo); inherit(IMG, key, base);
        if (IMG2 && IMG2.acp && typeof IMG2.acp === 'object') { set(IMG2.acp, key, w.photo); inherit(IMG2.acp, key, base); }
        set(PLAT, key, w.banner || w.photo); inherit(PLAT, key, base);
        cloneComposite(CARRIERS, base, key); cloneComposite(WEAPONS, base, key);
      }
    }
  }

  /** CSS для блоків: приховування та порядок. */
  function blocksCss(blocks) {
    const out = [];
    for (const [id, b] of Object.entries(blocks || {})) {
      if (!BLOCK_RE.test(id)) continue;
      if (b.hidden) out.push('#' + id + '{display:none!important}');
      if (Number.isInteger(b.order)) out.push('#' + id + '{order:' + b.order + '}');
    }
    return out.join('\n');
  }

  root.EWModuleEditorCore = { VERSION, norm, sanitize, empty, newId, fingerprint, matchWeapon, weaponKey, replaceText, cloneComposite, applyWeapons, blocksCss, IMAGE_RE, COLOR_RE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
