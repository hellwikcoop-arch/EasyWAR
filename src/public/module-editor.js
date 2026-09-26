/* EasyWAR — «Редактор модуля»: самостійне спрощене налаштування модуля без програміста.
   Логотипи підрозділів, нове озброєння й засоби, заміна зображень і текстів, кольори, набір і порядок блоків.
   Зберігається локально (IndexedDB модуля) та експортується/імпортується файлом .json. Код модуля не змінюється. */
(function () {
  'use strict';
  const core = window.EWModuleEditorCore;
  if (!core || window.__EW_MODULE_EDITOR__) return;
  window.__EW_MODULE_EDITOR__ = true;

  const MODULE = String(window.__EASYWAR_MODULE__ || 'module');
  const MODULE_TITLE = MODULE === 'air' ? 'Повітряні Сили' : MODULE === 'rocket' ? 'Ракетні Війська і Артилерія' : 'Модуль';
  const CARRIER_LABEL = MODULE === 'air' ? 'Літаки (носії)' : 'Пускові установки / засоби';
  /* Довідники модуля відкриває гачок усередині коду дашборду (window.__EW_EDITOR_HOOKS__). */
  const HOOKS = () => window.__EW_EDITOR_HOOKS__ || null;
  const G = name => {
    const hk = HOOKS(); if (!hk) return undefined;
    if (hk.maps && hk.maps[name] !== undefined) return hk.maps[name];
    return hk.images ? hk.images[name] : undefined;
  };

  let cfg = core.empty();

  /* ------------------------------ збереження (IndexedDB модуля) ------------------------------ */
  const DB = 'ew-module-editor', STORE = 'config', KEY = 'current';
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function loadConfig() {
    try {
      const db = await openDb();
      return await new Promise(resolve => {
        const req = db.transaction(STORE).objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { console.warn('EasyWAR editor: читання налаштувань', e); return null; }
  }
  async function saveConfig() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(JSON.parse(JSON.stringify(cfg)), KEY);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }

  /* ------------------------------ перехоплення ключів озброєння ------------------------------ */
  const hk0 = HOOKS();
  if (hk0) {
    hk0.munKey = value => { const w = core.matchWeapon(cfg.weapons, 'munition', value); return w ? core.weaponKey(w) : ''; };
    hk0.carrierKey = value => { const w = core.matchWeapon(cfg.weapons, 'carrier', value); return w ? core.weaponKey(w) : ''; };
  }
  const origKey = (kind, name) => {
    const hk = HOOKS(), f = hk && (kind === 'munition' ? hk.origMunKey : hk.origCarrierKey);
    try { return typeof f === 'function' ? f(name) || '' : ''; } catch (e) { return ''; }
  };

  /* ------------------------------ довідники модуля: знімок і застосування ------------------------------ */
  const MAPS = ['EMB', 'EMBK', 'IMG', 'MUN_IMG', 'MUN_W', 'MUN_INFO', 'MUN_SPEC', 'MUN_BANNER', 'WEAPONS', 'CARRIERS', 'AC_IMG', 'ROCKET_PLATFORM_MEDIA'];
  const snapshot = new Map();
  function mapTargets() {
    const out = [];
    for (const n of MAPS) { const m = G(n); if (m && typeof m === 'object') out.push([n, m]); }
    const img2 = G('IMG2'); if (img2 && img2.acp && typeof img2.acp === 'object') out.push(['IMG2.acp', img2.acp]);
    return out;
  }
  function restoreMaps() {
    for (const [name, map] of mapTargets()) {
      if (!snapshot.has(name)) { snapshot.set(name, Object.assign({}, map)); continue; }
      const snap = snapshot.get(name);
      for (const k of Object.keys(map)) if (!(k in snap)) delete map[k];
      for (const k of Object.keys(snap)) map[k] = snap[k];
    }
  }
  const unitKeyFn = () => { const hk = HOOKS(); return hk && typeof hk.unitKey === 'function' ? hk.unitKey : null; };
  function applyUnits() {
    const EMB = G('EMB'), EMBK = G('EMBK'), unitKey = unitKeyFn();
    for (const u of cfg.units) {
      if (EMB && typeof EMB === 'object') EMB[u.name] = u.logo;
      if (EMBK && typeof EMBK === 'object' && typeof unitKey === 'function') EMBK[unitKey(u.name)] = u.logo;
    }
  }
  function unitLogo(name) {
    const own = cfg.units.find(u => core.norm(u.name) === core.norm(name)); if (own) return own.logo;
    const EMBK = G('EMBK'), unitKey = unitKeyFn();
    return EMBK && typeof unitKey === 'function' ? EMBK[unitKey(name)] || '' : '';
  }

  /* ------------------------------ кольори й блоки ------------------------------ */
  const COLOR_VARS = [
    ['--accent', 'Акцент (кнопки, виділення)'], ['--bg', 'Тло сторінки'], ['--surface', 'Тло панелей'], ['--surface-2', 'Тло вкладених панелей'],
    ['--ink', 'Основний текст'], ['--muted', 'Другорядний текст'], ['--line', 'Лінії та рамки'],
    ['--hit', 'Уражено / знищено'], ['--part', 'Пошкоджено'], ['--miss', 'Не уражено'], ['--unk', 'Не відомо'],
    ['--ref-gold', 'Золотий акцент'], ['--ref-bg', 'Тло (оформлення РВіА)'], ['--ref-panel', 'Панелі (оформлення РВіА)'], ['--ref-text', 'Текст (оформлення РВіА)'],
  ];
  const appliedColors = new Set();
  function applyColors() {
    const st = document.documentElement.style;
    for (const name of appliedColors) if (!(name in cfg.colors)) st.removeProperty(name);
    appliedColors.clear();
    for (const [name, value] of Object.entries(cfg.colors)) { st.setProperty(name, value); appliedColors.add(name); }
  }
  function applyBlocks() {
    let style = document.getElementById('ewx-blocks-style');
    if (!style) { style = document.createElement('style'); style.id = 'ewx-blocks-style'; document.head.append(style); }
    style.textContent = core.blocksCss(cfg.blocks);
  }

  /* ------------------------------ заміна зображень і текстів ------------------------------ */
  const fpCache = new Map();
  const fpOf = src => { let fp = fpCache.get(src); if (!fp) { fp = core.fingerprint(src); if (fpCache.size > 4000) fpCache.clear(); fpCache.set(src, fp); } return fp; };
  const imgOrig = new Map(), imgWritten = new WeakMap();
  const textOrig = new Map(), textWritten = new WeakMap();
  let textMap = new Map();
  const inEditor = node => { const e = node.nodeType === 1 ? node : node.parentElement; return !!(e && e.closest('.ewx-root, .ewx-pickbar, script, style, textarea')); };

  function fixImg(img) {
    if (inEditor(img)) return;
    const cur = img.getAttribute('src'); if (!cur || !cur.startsWith('data:image/')) return;
    if (imgWritten.get(img) === cur) return;
    const rep = cfg.images[fpOf(cur)];
    if (rep && rep !== cur) { imgOrig.set(img, cur); imgWritten.set(img, rep); img.setAttribute('src', rep); }
  }
  function fixText(node) {
    if (!textMap.size || inEditor(node)) return;
    if (textWritten.get(node) === node.data) return;
    const out = core.replaceText(node.data, textMap);
    if (out !== null && out !== node.data) { if (!textOrig.has(node)) textOrig.set(node, node.data); textWritten.set(node, out); node.data = out; }
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (Object.keys(cfg.images).length) {
      if (root.tagName === 'IMG') fixImg(root);
      if (root.querySelectorAll) root.querySelectorAll('img').forEach(fixImg);
    }
    if (textMap.size) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let t; while ((t = walker.nextNode())) fixText(t);
    }
  }
  function revertReplacements() {
    for (const [img, src] of imgOrig) if (img.isConnected && imgWritten.get(img) === img.getAttribute('src')) img.setAttribute('src', src);
    imgOrig.clear();
    for (const [node, data] of textOrig) if (node.isConnected && textWritten.get(node) === node.data) node.data = data;
    textOrig.clear();
  }
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') fixText(r.target);
      else if (r.type === 'attributes') { if (r.target.tagName === 'IMG' && Object.keys(cfg.images).length) fixImg(r.target); }
      else r.addedNodes.forEach(scan);
    }
  });

  /* ------------------------------ застосування всього ------------------------------ */
  function applyAll(render) {
    restoreMaps();
    applyUnits();
    core.applyWeapons(cfg.weapons, G, origKey);
    applyColors();
    applyBlocks();
    revertReplacements();
    textMap = new Map(cfg.texts.map(t => [t.from, t.to]));
    scan(document.body);
    if (render) rerender();
  }
  function rerender() {
    try { const hk = HOOKS(); if (hk && typeof hk.rerender === 'function') hk.rerender(); } catch (e) { console.warn('EasyWAR editor: оновлення дашборду', e); }
  }
  let saveTimer = null;
  function commit(message) {
    cfg = core.sanitize(cfg);
    applyAll(true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveConfig().then(() => status(message || 'Збережено на цьому комп’ютері.'), e => status('Не вдалося зберегти: ' + (e && e.message || e), true)), 250);
    if (ui.open) ui.paint();
  }

  /* ------------------------------ читання зображень ------------------------------ */
  const PRESETS = { logo: [320, true], icon: [700, true], photo: [1600, false], banner: [2200, false] };
  function readFile(file) {
    return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(file); });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('Файл не є зображенням.')); im.src = src; });
  }
  async function imageFromFile(file, preset) {
    if (!file || !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Підтримуються PNG, JPEG, WebP, GIF або SVG.');
    if (file.size > 30e6) throw new Error('Файл завеликий (понад 30 МБ).');
    const url = await readFile(file);
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') { if (url.length > 8e6) throw new Error('Файл завеликий.'); return url; }
    const [max, alpha] = PRESETS[preset] || PRESETS.photo;
    const im = await loadImage(url), k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/webp', 0.86);
    if (!out.startsWith('data:image/webp')) out = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88);
    return out;
  }
  function pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.style.display = 'none';
      input.addEventListener('change', () => { resolve(input.files && input.files[0] || null); input.remove(); }, { once: true });
      document.body.append(input); input.click();
    });
  }
  async function chooseImage(preset) {
    const file = await pickFile('image/png,image/jpeg,image/webp,image/gif,image/svg+xml');
    if (!file) return '';
    try { return await imageFromFile(file, preset); } catch (e) { status(e.message || String(e), true); return ''; }
  }

  /* ------------------------------ дані з таблиці ------------------------------ */
  function tableValues(field) {
    const hk = HOOKS(); let rows = null; try { rows = hk && typeof hk.rows === 'function' ? hk.rows() : null; } catch (e) { rows = null; }
    const seen = new Map();
    if (Array.isArray(rows)) for (const r of rows) { const v = r && typeof r[field] === 'string' ? r[field].trim() : ''; if (v) seen.set(v, (seen.get(v) || 0) + 1); }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  }

  /* ------------------------------ UI ------------------------------ */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const btn = (label, onclick, cls, title) => h('button', { type: 'button', class: 'ewx-btn' + (cls ? ' ' + cls : ''), onclick, title: title || null }, label);
  const thumb = (src, cls) => src ? h('img', { class: 'ewx-thumb' + (cls ? ' ' + cls : ''), src, alt: '', draggable: 'false' }) : h('span', { class: 'ewx-thumb ewx-none' + (cls ? ' ' + cls : ''), text: '—' });

  let statusEl = null;
  function status(text, bad) { if (statusEl) { statusEl.textContent = text; statusEl.classList.toggle('bad', !!bad); } }

  const TABS = [['units', 'Підрозділи'], ['weapons', 'Озброєння'], ['images', 'Зображення'], ['texts', 'Тексти'], ['colors', 'Кольори'], ['blocks', 'Блоки'], ['file', 'Файл']];
  const ui = { open: false, tab: 'units', root: null, body: null, form: null, paint() {} };

  function openEditor(tab) {
    if (tab) ui.tab = tab;
    if (!ui.root) buildRoot();
    ui.root.hidden = false; ui.open = true; ui.paint();
    const first = ui.root.querySelector('.ewx-tab[aria-selected="true"]'); if (first) first.focus();
  }
  function closeEditor() { if (ui.root) ui.root.hidden = true; ui.open = false; ui.form = null; }

  function buildRoot() {
    const tabs = h('div', { class: 'ewx-tabs', role: 'tablist', 'aria-label': 'Розділи редактора' });
    ui.body = h('div', { class: 'ewx-body' });
    statusEl = h('p', { class: 'ewx-status', role: 'status', 'aria-live': 'polite' });
    ui.root = h('div', { class: 'ewx-root', hidden: true, onkeydown: e => { if (e.key === 'Escape') closeEditor(); } },
      h('div', { class: 'ewx-back', onclick: closeEditor }),
      h('section', { class: 'ewx-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Редактор модуля' },
        h('header', { class: 'ewx-head' }, h('div', {}, h('h2', { text: 'Редактор модуля' }), h('p', { text: MODULE_TITLE + ' · зміни зберігаються лише на цьому комп’ютері' })), btn('Закрити', closeEditor, 'ewx-close')),
        tabs, ui.body, h('footer', { class: 'ewx-foot' }, statusEl)));
    document.body.append(ui.root);
    ui.paint = () => {
      tabs.textContent = '';
      for (const [id, label] of TABS) tabs.append(h('button', { type: 'button', role: 'tab', class: 'ewx-tab', 'aria-selected': String(ui.tab === id), onclick: () => { ui.tab = id; ui.form = null; ui.paint(); } }, label));
      ui.body.textContent = '';
      const render = { units: tabUnits, weapons: tabWeapons, images: tabImages, texts: tabTexts, colors: tabColors, blocks: tabBlocks, file: tabFile }[ui.tab];
      try { render(ui.body); } catch (e) { console.error(e); ui.body.append(h('p', { class: 'ewx-note bad', text: 'Помилка розділу: ' + (e && e.message || e) })); }
    };
  }

  /* --- Підрозділи --- */
  function tabUnits(box) {
    box.append(h('p', { class: 'ewx-note', text: 'Логотип показується біля назви підрозділу в дашборді, таблицях і картках. Назва має збігатися з назвою в таблиці (регістр, пробіли та дефіси не важливі).' }));
    const name = h('input', { type: 'text', class: 'ewx-in', placeholder: 'Назва підрозділу, напр. 44 ОАБр', list: 'ewx-units-dl', 'aria-label': 'Назва підрозділу' });
    const dl = h('datalist', { id: 'ewx-units-dl' }, tableValues('unit').map(v => h('option', { value: v })));
    box.append(h('div', { class: 'ewx-row' }, name, dl, btn('Додати логотип…', async () => {
      const n = name.value.trim(); if (!n) { status('Вкажіть назву підрозділу.', true); name.focus(); return; }
      const logo = await chooseImage('logo'); if (!logo) return;
      cfg.units = cfg.units.filter(u => core.norm(u.name) !== core.norm(n)).concat([{ name: n, logo }]);
      commit('Логотип «' + n + '» збережено.');
    }, 'ewx-primary')));
    const list = h('div', { class: 'ewx-list' });
    if (!cfg.units.length) list.append(h('p', { class: 'ewx-empty', text: 'Власних логотипів ще немає.' }));
    for (const u of cfg.units) list.append(h('div', { class: 'ewx-item' }, thumb(u.logo, 'logo'), h('b', { text: u.name }),
      btn('Замінити…', async () => { const logo = await chooseImage('logo'); if (logo) { u.logo = logo; commit('Логотип оновлено.'); } }),
      btn('Видалити', () => { cfg.units = cfg.units.filter(x => x !== u); commit('Логотип видалено.'); }, 'ewx-danger')));
    box.append(h('h3', { text: 'Власні логотипи' }), list);
    const missing = tableValues('unit').filter(v => !unitLogo(v));
    if (missing.length) box.append(h('h3', { text: 'Підрозділи з таблиці без логотипа' }), h('div', { class: 'ewx-chips' }, missing.slice(0, 60).map(v => btn(v, () => { name.value = v; name.focus(); }, 'ewx-chip'))));
  }

  /* --- Озброєння --- */
  function tabWeapons(box) {
    if (ui.form) { weaponForm(box, ui.form); return; }
    box.append(h('p', { class: 'ewx-note', text: 'Додайте нове озброєння або засіб, або перевизначте вбудований (вкажіть ту саму назву). Модуль розпізнає запис у таблиці за назвою чи синонімом — найдовший збіг. Порожні поля беруться з вбудованого довідника.' }),
      h('div', { class: 'ewx-row' }, btn('+ Боєприпас', () => { ui.form = { kind: 'munition' }; ui.paint(); }, 'ewx-primary'), btn('+ ' + CARRIER_LABEL, () => { ui.form = { kind: 'carrier' }; ui.paint(); }, 'ewx-primary')));
    for (const [kind, title, field] of [['munition', 'Боєприпаси', 'munition'], ['carrier', CARRIER_LABEL, 'aircraft']]) {
      const own = cfg.weapons.filter(w => w.kind === kind);
      const list = h('div', { class: 'ewx-list' });
      if (!own.length) list.append(h('p', { class: 'ewx-empty', text: 'Власних записів немає.' }));
      for (const w of own) list.append(h('div', { class: 'ewx-item' }, thumb(w.icon || w.photo || w.banner), h('div', { class: 'ewx-grow' }, h('b', { text: w.name }), h('small', { text: [w.aliases.join(', '), w.title, w.range].filter(Boolean).join(' · ') || 'без додаткових даних' })),
        btn('Змінити', () => { ui.form = Object.assign({}, w, { aliases: w.aliases.join(', ') }); ui.paint(); }),
        btn('Видалити', () => { cfg.weapons = cfg.weapons.filter(x => x !== w); commit('Запис «' + w.name + '» видалено.'); }, 'ewx-danger')));
      box.append(h('h3', { text: title }), list);
      const inTable = tableValues(field);
      if (inTable.length) box.append(h('div', { class: 'ewx-chips' }, h('span', { class: 'ewx-muted', text: 'У таблиці:' }), inTable.slice(0, 40).map(v => {
        const own = core.matchWeapon(cfg.weapons, kind, v), builtin = origKey(kind, v);
        return btn(v + (own ? ' ✓' : builtin ? '' : ' ?'), () => { ui.form = own ? Object.assign({}, own, { aliases: own.aliases.join(', ') }) : { kind, name: v }; ui.paint(); }, 'ewx-chip' + (!own && !builtin ? ' warn' : ''), own ? 'Власний запис' : builtin ? 'Вбудований — натисніть, щоб перевизначити' : 'Невідомий модулю — натисніть, щоб додати');
      })));
    }
  }
  function weaponForm(box, f) {
    const mun = f.kind === 'munition';
    const field = (key, label, ph) => { const inp = h('input', { type: 'text', class: 'ewx-in', value: f[key] || '', placeholder: ph || '', 'aria-label': label, oninput: () => { f[key] = inp.value; } }); return h('label', { class: 'ewx-field' }, h('span', { text: label }), inp); };
    const imgField = (key, label, preset) => h('div', { class: 'ewx-field' }, h('span', { text: label }), h('div', { class: 'ewx-row' }, thumb(f[key], preset === 'banner' ? 'wide' : ''),
      btn('Вибрати…', async () => { const src = await chooseImage(preset); if (src) { f[key] = src; ui.paint(); } }), f[key] ? btn('Прибрати', () => { f[key] = ''; ui.paint(); }) : null));
    const base = f.name ? origKey(f.kind, f.name) : '';
    box.append(h('h3', { text: (f.id ? 'Змінити: ' : 'Новий запис: ') + (mun ? 'боєприпас' : CARRIER_LABEL.toLowerCase()) }));
    if (base) box.append(h('p', { class: 'ewx-note', text: 'Назва відповідає вбудованому запису модуля — незаповнені поля та зображення буде взято з нього.' }));
    box.append(
      h('div', { class: 'ewx-grid' },
        field('name', 'Назва (як у таблиці)', mun ? 'напр. PrSM' : 'напр. M142 HIMARS'),
        field('aliases', 'Синоніми через кому', 'напр. PRSM, Precision Strike'),
        field('title', 'Підпис / серія', mun ? 'напр. GMLRS M30' : 'напр. РСЗВ'),
        field('desc', 'Опис', mun ? 'напр. керована ракета 227 мм' : 'напр. колісна РСЗВ'),
        mun ? field('range', 'Дальність', 'напр. до 84 км') : null,
        mun ? field('guidance', 'Система наведення', 'напр. GPS/INS') : null,
        mun ? field('warhead', 'Тип БЧ', 'напр. унітарна') : null),
      h('div', { class: 'ewx-grid' },
        imgField('icon', mun ? 'Мініатюра (списки, таблиці)' : 'Іконка (списки, таблиці)', 'icon'),
        imgField('photo', 'Фото / картка', 'photo'),
        imgField('banner', 'Широкий банер', 'banner')),
      h('div', { class: 'ewx-row' }, btn('Зберегти', () => {
        if (!String(f.name || '').trim()) { status('Вкажіть назву.', true); return; }
        const entry = Object.assign({}, f, { id: f.id || core.newId(), aliases: String(f.aliases || '').split(',') });
        cfg.weapons = cfg.weapons.filter(w => w.id !== entry.id).concat([entry]);
        ui.form = null; commit('Запис «' + entry.name + '» збережено.');
      }, 'ewx-primary'), btn('Скасувати', () => { ui.form = null; ui.paint(); })));
  }

  /* --- Зображення --- */
  const IMAGE_SOURCES = () => { const hk = HOOKS(); return hk ? Object.keys(hk.maps || {}).concat(Object.keys(hk.images || {})) : []; };
  function galleryItems() {
    const items = new Map();
    const add = (src, label) => {
      if (typeof src !== 'string' || !src.startsWith('data:image/')) return;
      const fp = fpOf(src); if (!items.has(fp)) items.set(fp, { fp, src, label });
    };
    const walk = (v, label, depth) => {
      if (typeof v === 'string') add(v, label);
      else if (v && typeof v === 'object' && depth < 3) for (const [k, x] of Object.entries(v)) walk(x, label + ' · ' + k, depth + 1);
    };
    for (const name of IMAGE_SOURCES()) { const v = snapshot.has(name) ? snapshot.get(name) : G(name); walk(v, name, 0); }
    document.querySelectorAll('img').forEach(img => { if (!inEditor(img)) add(imgOrig.get(img) || img.getAttribute('src'), 'на екрані'); });
    return [...items.values()];
  }
  function tabImages(box) {
    box.append(h('p', { class: 'ewx-note', text: 'Замініть будь-яке зображення модуля своїм файлом: виберіть його в галереї або натисніть «Вибрати на екрані» й клацніть зображення в модулі.' }),
      h('div', { class: 'ewx-row' }, btn('Вибрати на екрані', () => pickOnScreen('img', src => { ui.tab = 'images'; openEditor(); replaceImage(fpOf(src)); }), 'ewx-primary')));
    const grid = h('div', { class: 'ewx-gallery' });
    for (const it of galleryItems()) {
      const rep = cfg.images[it.fp];
      grid.append(h('figure', { class: 'ewx-fig' + (rep ? ' on' : '') }, h('img', { src: rep || it.src, alt: '', loading: 'lazy', draggable: 'false' }),
        h('figcaption', { text: (rep ? 'Замінено · ' : '') + it.label }),
        h('div', { class: 'ewx-row' }, btn('Замінити…', () => replaceImage(it.fp)), rep ? btn('Скинути', () => { delete cfg.images[it.fp]; commit('Зображення повернуто.'); }) : null)));
    }
    box.append(grid);
  }
  async function replaceImage(fp) {
    const src = await chooseImage('banner'); if (!src) return;
    cfg.images[fp] = src; commit('Зображення замінено.');
  }

  /* --- Тексти --- */
  function tabTexts(box) {
    box.append(h('p', { class: 'ewx-note', text: 'Заміна написів модуля: заголовки, підписи, слогани, описи типів цілей тощо. Замінюється точний текст елемента.' }));
    const from = h('input', { type: 'text', class: 'ewx-in', placeholder: 'Поточний текст', 'aria-label': 'Поточний текст' });
    const to = h('input', { type: 'text', class: 'ewx-in', placeholder: 'Новий текст', 'aria-label': 'Новий текст' });
    box.append(h('div', { class: 'ewx-row' }, from, btn('Вибрати на екрані', () => pickOnScreen('text', text => { ui.tab = 'texts'; openEditor(); const f = ui.body.querySelector('input'); if (f) { f.value = text; const t = ui.body.querySelectorAll('input')[1]; if (t) { t.value = text; t.focus(); t.select(); } } })), to,
      btn('Додати', () => {
        const a = from.value.trim(); if (!a) { status('Вкажіть поточний текст.', true); return; }
        cfg.texts = cfg.texts.filter(t => t.from !== a).concat([{ from: a, to: to.value }]); commit('Заміну тексту збережено.');
      }, 'ewx-primary')));
    const list = h('div', { class: 'ewx-list' });
    if (!cfg.texts.length) list.append(h('p', { class: 'ewx-empty', text: 'Замін ще немає.' }));
    for (const t of cfg.texts) {
      const inp = h('input', { type: 'text', class: 'ewx-in', value: t.to, 'aria-label': 'Новий текст для «' + t.from + '»' });
      list.append(h('div', { class: 'ewx-item' }, h('span', { class: 'ewx-grow ewx-from', text: t.from }), h('span', { text: '→' }), inp,
        btn('Зберегти', () => { t.to = inp.value; commit('Заміну оновлено.'); }), btn('Видалити', () => { cfg.texts = cfg.texts.filter(x => x !== t); commit('Заміну видалено.'); }, 'ewx-danger')));
    }
    box.append(h('h3', { text: 'Заміни' }), list);
  }

  /* --- Кольори --- */
  const colorProbe = document.createElement('canvas').getContext('2d');
  function toHex(value) {
    colorProbe.fillStyle = '#000000'; colorProbe.fillStyle = String(value || '').trim();
    const v = colorProbe.fillStyle; if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(v);
    return m ? '#' + [m[1], m[2], m[3]].map(x => Math.round(+x).toString(16).padStart(2, '0')).join('') : '#000000';
  }
  function tabColors(box) {
    box.append(h('p', { class: 'ewx-note', text: 'Кольори застосовуються до обох тем модуля. «Скинути» повертає колір оформлення.' }));
    const cs = getComputedStyle(document.documentElement), list = h('div', { class: 'ewx-list' });
    for (const [name, label] of COLOR_VARS) {
      const own = cfg.colors[name]; if (!own && !cs.getPropertyValue(name).trim()) continue;
      const inp = h('input', { type: 'color', value: own || toHex(cs.getPropertyValue(name)), 'aria-label': label, onchange: () => { cfg.colors[name] = inp.value; commit('Колір збережено.'); } });
      list.append(h('div', { class: 'ewx-item' }, inp, h('div', { class: 'ewx-grow' }, h('b', { text: label }), h('small', { text: name + (own ? ' · змінено' : '') })),
        own ? btn('Скинути', () => { delete cfg.colors[name]; commit('Колір повернуто.'); }) : null));
    }
    box.append(list, h('div', { class: 'ewx-row' }, btn('Скинути всі кольори', () => { cfg.colors = {}; commit('Кольори повернуто.'); }, 'ewx-danger')));
  }

  /* --- Блоки --- */
  function blockList() {
    return [...document.querySelectorAll('[id^="p-"]')].filter(e => /^p-[a-z0-9-]{1,40}$/.test(e.id) && !inEditor(e)).map(e => {
      const t = e.querySelector('h2, h3, .ph, header'); const title = (t && t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      return { id: e.id, el: e, title: title || e.id };
    });
  }
  function tabBlocks(box) {
    box.append(h('p', { class: 'ewx-note', text: 'Показуйте чи приховуйте панелі дашборду й змінюйте їхній порядок (у межах одного ряду). Відкрийте таблицю, щоб бачити всі блоки.' }));
    const blocks = blockList(), list = h('div', { class: 'ewx-list' });
    if (!blocks.length) list.append(h('p', { class: 'ewx-empty', text: 'Блоки дашборду не знайдено.' }));
    const orderOf = b => { const s = cfg.blocks[b.id]; return s && Number.isInteger(s.order) ? s.order : 0; };
    const siblings = b => blocks.filter(x => x.el.parentElement === b.el.parentElement);
    const move = (b, dir) => {
      const sib = siblings(b); sib.forEach((x, i) => { cfg.blocks[x.id] = Object.assign({ hidden: false }, cfg.blocks[x.id], { order: orderOf(x) || (i + 1) * 10 }); });
      sib.sort((x, y) => orderOf(x) - orderOf(y));
      const i = sib.indexOf(b), j = i + dir; if (j < 0 || j >= sib.length) return;
      const a = cfg.blocks[sib[i].id].order; cfg.blocks[sib[i].id].order = cfg.blocks[sib[j].id].order; cfg.blocks[sib[j].id].order = a;
      commit('Порядок блоків збережено.');
    };
    for (const b of blocks) {
      const st = cfg.blocks[b.id] || {};
      const cb = h('input', { type: 'checkbox', checked: !st.hidden, 'aria-label': 'Показувати «' + b.title + '»', onchange: () => { cfg.blocks[b.id] = Object.assign({ order: null }, cfg.blocks[b.id], { hidden: !cb.checked }); commit(cb.checked ? 'Блок показано.' : 'Блок приховано.'); } });
      const n = siblings(b).length;
      list.append(h('div', { class: 'ewx-item' }, cb, h('div', { class: 'ewx-grow' }, h('b', { text: b.title }), h('small', { text: b.id })),
        n > 1 ? btn('↑', () => move(b, -1), '', 'Вище') : null, n > 1 ? btn('↓', () => move(b, 1), '', 'Нижче') : null));
    }
    box.append(list, h('div', { class: 'ewx-row' }, btn('Показати всі й скинути порядок', () => { cfg.blocks = {}; commit('Блоки повернуто.'); }, 'ewx-danger')));
  }

  /* --- Файл --- */
  function tabFile(box) {
    const count = cfg.units.length + cfg.weapons.length + Object.keys(cfg.images).length + cfg.texts.length + Object.keys(cfg.colors).length + Object.keys(cfg.blocks).length;
    box.append(h('p', { class: 'ewx-note', text: 'Налаштування зберігаються лише на цьому комп’ютері й не потрапляють у таблиці чи базу. Щоб перенести оформлення на інший комп’ютер, експортуйте файл і імпортуйте його там.' }),
      h('p', { class: 'ewx-muted', text: 'Змін у налаштуваннях: ' + count + '.' }),
      h('div', { class: 'ewx-row' },
        btn('Експортувати файл оформлення', () => {
          const data = Object.assign({ app: 'EasyWAR', module: MODULE, exported_at: new Date().toISOString() }, cfg);
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: 'easywar-' + MODULE + '-oformlennia-' + new Date().toISOString().slice(0, 10) + '.json' });
          document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
          status('Файл оформлення експортовано.');
        }, 'ewx-primary'),
        btn('Імпортувати файл…', async () => {
          const file = await pickFile('application/json,.json'); if (!file) return;
          try {
            if (file.size > 80e6) throw new Error('Файл завеликий.');
            const data = JSON.parse(await file.text());
            if (!data || data.app !== 'EasyWAR') throw new Error('Це не файл оформлення EasyWAR.');
            if (data.module && data.module !== MODULE && !window.confirm('Файл створено для іншого модуля. Все одно імпортувати?')) return;
            cfg = core.sanitize(data); commit('Оформлення імпортовано.');
          } catch (e) { status('Не вдалося імпортувати: ' + (e && e.message || e), true); }
        }),
        btn('Скинути все', () => { if (window.confirm('Скинути всі налаштування редактора для цього модуля?')) { cfg = core.empty(); commit('Налаштування скинуто.'); } }, 'ewx-danger')));
  }

  /* --- вибір на екрані --- */
  function pickOnScreen(kind, done) {
    closeEditor();
    const bar = h('div', { class: 'ewx-pickbar', role: 'status' }, kind === 'img' ? 'Клацніть зображення в модулі. Esc — скасувати.' : 'Клацніть текст у модулі. Esc — скасувати.');
    document.body.append(bar);
    const finish = value => { document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); bar.remove(); document.documentElement.classList.remove('ewx-picking'); if (value) done(value); else openEditor(); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
    const onClick = e => {
      if (inEditor(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (kind === 'img') {
        const img = e.target.closest('img') || [...document.elementsFromPoint(e.clientX, e.clientY)].find(x => x.tagName === 'IMG');
        const src = img && (imgOrig.get(img) || img.getAttribute('src'));
        if (src && src.startsWith('data:image/')) finish(src); else bar.textContent = 'Тут немає вбудованого зображення — спробуйте інше місце або Esc.';
      } else {
        const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
        let node = range && range.startContainer && range.startContainer.nodeType === 3 ? range.startContainer : null;
        if (!node) { const w = document.createTreeWalker(e.target, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) if (t.data.trim()) { node = t; break; } }
        const text = node ? (textOrig.get(node) || node.data).trim() : '';
        if (text) finish(text); else bar.textContent = 'Тут немає тексту — спробуйте інше місце або Esc.';
      }
    };
    document.documentElement.classList.add('ewx-picking');
    setTimeout(() => { document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey, true); }, 0);
  }

  /* --- кнопка відкриття --- */
  function mountButton() {
    if (document.getElementById('ewx-open')) return;
    const b = h('button', { type: 'button', id: 'ewx-open', class: 'ewx-open', title: 'Редактор модуля: логотипи, озброєння, зображення, тексти, кольори, блоки', onclick: () => openEditor() }, 'Оформлення');
    const host = document.querySelector('.appbar-right');
    if (host) host.prepend(b); else { b.classList.add('ewx-float'); document.body.append(b); }
  }

  /* ------------------------------ стилі редактора ------------------------------ */
  const css = `
.ewx-open{font:inherit;font-weight:600;font-size:13px;color:var(--ink,#e6edf7);background:transparent;border:1px solid var(--line-strong,#2c4468);border-radius:999px;padding:6px 12px;cursor:pointer;white-space:nowrap}
.ewx-open:hover{border-color:var(--accent,#3d9bff)}.ewx-open.ewx-float{position:fixed;right:14px;bottom:14px;z-index:2147482000;background:var(--surface,#0e1a2e)}
.ewx-root{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;font:14px/1.4 var(--sans,system-ui,sans-serif);color:#e8eef6}
.ewx-root[hidden]{display:none!important}
.ewx-back{position:absolute;inset:0;background:rgba(3,8,14,.62);backdrop-filter:blur(3px)}
.ewx-panel{position:relative;width:min(980px,calc(100vw - 32px));height:min(760px,calc(100vh - 32px));display:flex;flex-direction:column;background:#0f1824;border:1px solid #2a3b52;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);overflow:hidden}
.ewx-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px 8px}
.ewx-head h2{margin:0;font-size:19px}.ewx-head p{margin:2px 0 0;color:#93a6bd;font-size:12.5px}
.ewx-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:0 14px 10px;border-bottom:1px solid #23344a}
.ewx-tab{font:inherit;font-weight:600;color:#9fb2c8;background:transparent;border:1px solid transparent;border-radius:9px;padding:6px 11px;cursor:pointer}
.ewx-tab[aria-selected="true"]{color:#fff;background:#18324f;border-color:#2f5d8f}
.ewx-body{flex:1;overflow:auto;padding:14px 18px 18px}
.ewx-body h3{margin:18px 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#9fb2c8}
.ewx-foot{border-top:1px solid #23344a;padding:8px 18px;min-height:36px}
.ewx-status{margin:0;color:#8fd3a8;font-size:13px}.ewx-status.bad{color:#ff8b80}
.ewx-note{margin:0 0 12px;color:#aebdd0;font-size:13px}.ewx-note.bad{color:#ff8b80}.ewx-muted{color:#8193a8;font-size:12.5px}
.ewx-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0}
.ewx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin:10px 0}
.ewx-field{display:grid;gap:4px}.ewx-field>span{font-size:12px;color:#9fb2c8}
.ewx-in{font:inherit;color:#eef3f9;background:#0a121c;border:1px solid #2a3b52;border-radius:8px;padding:7px 9px;min-width:0;flex:1 1 200px}
.ewx-in:focus,.ewx-btn:focus-visible,.ewx-tab:focus-visible{outline:2px solid #3d9bff;outline-offset:1px}
.ewx-btn{font:inherit;font-weight:600;font-size:13px;color:#dfe8f2;background:#16253a;border:1px solid #2c4262;border-radius:8px;padding:6px 11px;cursor:pointer;white-space:nowrap}
.ewx-btn:hover{border-color:#4f7fb5}.ewx-primary{background:#1d4f86;border-color:#3d7dc4;color:#fff}.ewx-danger{color:#ffb1aa;border-color:#5a2a2a;background:#241315}
.ewx-close{margin-left:auto}
.ewx-list{display:grid;gap:6px}.ewx-item{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#0b1520;border:1px solid #1f3046;border-radius:10px}
.ewx-item .ewx-in{flex:1 1 180px}.ewx-grow{flex:1;min-width:0;display:grid}.ewx-grow small{color:#8193a8}.ewx-from{color:#c9d6e4;overflow-wrap:anywhere}
.ewx-thumb{width:44px;height:44px;object-fit:contain;border-radius:8px;background:#060d15;border:1px solid #1f3046;flex:none}
.ewx-thumb.logo{width:40px;height:40px}.ewx-thumb.wide{width:150px;height:44px;object-fit:cover}.ewx-none{display:grid;place-items:center;color:#56687e}
.ewx-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}.ewx-chip{font-weight:500;padding:4px 9px;border-radius:999px}.ewx-chip.warn{border-color:#8a6420;color:#ffd48a}
.ewx-empty{margin:0;color:#7d8fa5;font-size:13px}
.ewx-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.ewx-fig{margin:0;display:grid;gap:6px;padding:8px;background:#0b1520;border:1px solid #1f3046;border-radius:10px}.ewx-fig.on{border-color:#3d7dc4}
.ewx-fig img{width:100%;height:96px;object-fit:contain;background:#060d15;border-radius:6px}.ewx-fig figcaption{font-size:11.5px;color:#8ea2b8;overflow-wrap:anywhere}
.ewx-pickbar{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483001;background:#1d4f86;color:#fff;font:600 14px/1.3 var(--sans,system-ui,sans-serif);padding:10px 16px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
html.ewx-picking *{cursor:crosshair!important}
`;
  const style = document.createElement('style'); style.id = 'ewx-style'; style.textContent = css; document.head.append(style);

  /* ------------------------------ старт ------------------------------ */
  function start() {
    mountButton();
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src'] });
    loadConfig().then(saved => {
      cfg = core.sanitize(saved);
      applyAll(true);
    });
  }
  window.EWModuleEditor = { open: openEditor, get config() { return JSON.parse(JSON.stringify(cfg)); }, reload: () => loadConfig().then(s => { cfg = core.sanitize(s); applyAll(true); }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
