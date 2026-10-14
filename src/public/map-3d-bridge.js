/* Міст між вкладкою «Карта» модулів ПС (air.html) і РВ (rocket.html) та офлайн-3D-картою map.html.
   3D-рельєф показується за замовчуванням; перемикач «2D карта» повертає наявну карту з онлайн-підкладками.
   Міст лише передає точки DPI й дії (масштаб, показати все, вибір точки) через postMessage у вбудований iframe,
   нічого не завантажує з мережі. Автономні файли для телефона (file://) не мають map.html: там лишається 2D. */
(function () {
  'use strict';
  var KEY = 'aviahub.map3d';           // '0' = користувач обрав 2D; решта = 3D
  var SRC = './map.html?embed=1';
  var HINT = '3D-карта працює без інтернету. Зони ураження, зони відповідальності, шари GeoJSON і онлайн-підкладки — в режимі «2D карта». Дані: рельєф — Mapzen Terrain (SRTM), знімки — Esri World Imagery, кордони — geoBoundaries і OpenStreetMap, лінія зіткнення — DeepStateMap.';

  function store(v) { try { if (v === undefined) return localStorage.getItem(KEY); localStorage.setItem(KEY, v); } catch (e) { /* сховище недоступне */ } return null; }
  function hasGl() { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  function supported() {
    if (/[?&]viewer=1/.test(location.search)) return false;                   // телефонний переглядач: 100+ МБ карти йому не потрібні
    if (location.protocol === 'file:') return false;                          // автономний файл: поруч немає map.html
    if (document.getElementById('easywar-embedded-table')) return false;      // збірка для телефона
    if (document.documentElement.hasAttribute('data-lite')) return false;     // lite-версія (script/build_lite.mjs): карти з рельєфом у файлі немає
    return hasGl();
  }
  function theme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
  function mk(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === 'text') n.textContent = props[k]; else if (k === 'class') n.className = props[k]; else n.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { n.append(c); });
    return n;
  }

  /* opts: wrap — блок .mapwrap; points() → [{id, lon, lat, k}]; onPick(id); onMode(is3d) — сховати/показати 2D-керування;
           sel() → id вибраної точки або null */
  function create(opts) {
    var wrap = opts.wrap, ok = supported();
    var want = ok && store() !== '0';
    var frame = null, hello = false, ready = false, timer = 0, queue = [], is3d = false;
    var b3 = mk('button', { type: 'button', text: '3D рельєф', title: 'Офлайн-карта рельєфу України з точками DPI' });
    var b2 = mk('button', { type: 'button', text: '2D карта', title: 'Пласка карта; онлайн-підкладки, зони й шари GeoJSON' });
    var toggle = mk('div', { class: 'seg m3-toggle', role: 'group', 'aria-label': 'Вигляд карти' }, ok ? [b3, b2] : []);
    var hint = mk('p', { class: 'hintline m3-hint', text: HINT, hidden: '' });

    function post(m) {
      m.dst = 'easywar-map';
      if (frame && hello) { try { frame.contentWindow.postMessage(m, location.origin === 'null' ? '*' : location.origin); } catch (e) { /* iframe закрито */ } }
      else {
        // до відповіді iframe зберігаємо лише останній набір точок і один запит «показати все»
        queue = queue.filter(function (q) { return q.type !== m.type || (m.type !== 'points' && m.type !== 'fit'); });
        queue.push(m);
      }
    }
    function pressed() { b3.setAttribute('aria-pressed', String(is3d)); b2.setAttribute('aria-pressed', String(!is3d)); }
    function apply(on) {
      is3d = on; wrap.classList.toggle('m3d', on); hint.hidden = !on; pressed();
      if (on) lazyStart(); if (opts.onMode) opts.onMode(on);
    }
    function fail(why) {
      clearTimeout(timer); if (frame) { frame.remove(); frame = null; } hello = false; ready = false; queue = [];
      b3.disabled = true; b3.title = 'Не вдалося відкрити 3D-карту (' + why + '). Працює 2D.'; apply(false);
    }
    // Карта з рельєфом займає понад 100 МБ відеопам'яті, тому iframe відкривається лише тоді, коли вкладку «Карта» справді видно
    function lazyStart() {
      if (frame) return;
      if (!('IntersectionObserver' in window)) { start(); return; }
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); if (is3d) start(); } });
      io.observe(wrap);
    }
    function start() {
      if (frame) return;
      frame = mk('iframe', { class: 'm3-frame', src: SRC, title: 'Карта рельєфу України (3D)', loading: 'eager', allow: 'fullscreen' });
      wrap.prepend(frame);
      // Сторінка модуля велика й може довго зайняти основний потік, тому відлік «немає відповіді» починається
      // лише після події load самого iframe; запасний ліміт — 2 хвилини.
      timer = setTimeout(function () { if (!hello) fail('немає відповіді'); }, 120000);
      frame.addEventListener('load', function () { clearTimeout(timer); timer = setTimeout(function () { if (!hello) fail('немає відповіді'); }, 5000); });
      frame.addEventListener('error', function () { fail('помилка завантаження'); });
    }
    function sync(fit) {
      if (!ok) return;
      var items = opts.points ? opts.points() : [];
      post({ type: 'points', items: items, sel: opts.sel ? opts.sel() : null, fit: !!fit });
    }
    window.addEventListener('message', function (e) {
      if (!frame || e.source !== frame.contentWindow) return;
      var m = e.data; if (!m || m.src !== 'easywar-map') return;
      if (m.type === 'hello') {
        hello = true; clearTimeout(timer);
        var q = queue; queue = []; post({ type: 'theme', theme: theme() }); q.forEach(function (x) { frame.contentWindow.postMessage(x, location.origin === 'null' ? '*' : location.origin); });
      } else if (m.type === 'ready') ready = true;
      else if (m.type === 'pick' && opts.onPick) opts.onPick(m.id);
    });
    new MutationObserver(function () { post({ type: 'theme', theme: theme() }); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    b3.addEventListener('click', function () { if (!ok || b3.disabled) return; store('1'); if (!is3d) { apply(true); sync(true); } });
    b2.addEventListener('click', function () { store('0'); if (is3d) apply(false); });

    var api = {
      toggle: toggle,
      get active() { return is3d; },
      sync: sync,
      fit: function () { if (is3d) post({ type: 'fit' }); },
      zoom: function (k) { if (is3d) post({ type: 'zoom', k: k }); },
      select: function (id) { post({ type: 'select', id: id }); },
      // викликається, коли сторінка вже побудувала решту панелі
      init: function () { if (!hint.parentNode && wrap.parentNode) wrap.after(hint); if (want) { apply(true); sync(true); } else apply(false); }
    };
    return api;
  }
  window.Map3D = { create: create, supported: supported };
})();
