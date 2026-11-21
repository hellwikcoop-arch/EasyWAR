/* Шар DIMAP на карті дашборда ПС і РВ.
   Мережу викликає лише команда Tauri dimap_poll. Тут — перемикач, опитування поки
   дашборд видно, стрілки на 2D-карті й список тривог. Без Tauri шар показує фікстуру,
   якщо її передали через EWDimap.useFixture. */
(function (root) {
  'use strict';

  var core = root.EWDimapCore;
  if (!core) return;
  var SVG = 'http://www.w3.org/2000/svg';
  var state = {
    enabled: false,
    fixture: null,
    snapshot: null,
    failed: false,
    timer: 0,
    api: null
  };

  function invokeFn() {
    var local = root.__TAURI_INTERNALS__ && root.__TAURI_INTERNALS__.invoke;
    if (typeof local === 'function') return local;
    try {
      var parentInvoke = root.parent && root.parent.__TAURI_INTERNALS__ && root.parent.__TAURI_INTERNALS__.invoke;
      if (typeof parentInvoke === 'function') return parentInvoke;
    } catch (e) { /* батьківське вікно недоступне */ }
    return null;
  }

  function model() {
    if (!state.enabled && !state.fixture) return null;
    var source = state.fixture || state.snapshot;
    if (!source) {
      return { targets: [], halos: [], alerts: [], statusText: core.EMPTY, updatedLabel: '', attribution: core.ATTR, updatedAtMs: null };
    }
    var view = core.present(source);
    if (state.failed && !view.targets.length && !view.alerts.length) view.statusText = core.EMPTY;
    return view;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function svgEl(name, attrs) {
    var node = document.createElementNS(SVG, name);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function paint(svg, project) {
    if (!svg) return;
    var old = svg.querySelectorAll('.dimap-layer');
    for (var i = 0; i < old.length; i++) old[i].remove();
    var view = model();
    if (!view || typeof project !== 'function') return;
    var halos = core.layoutHalos(view.halos, project);
    var tracks = core.layoutTracks(view.targets, project);
    var marks = core.layoutMarkers(view.targets, project);
    if (halos.length || tracks.length) {
      var wash = svgEl('g', { class: 'dimap-layer', 'pointer-events': 'none' });
      halos.forEach(function (h) {
        wash.appendChild(svgEl('circle', {
          cx: h.x.toFixed(1), cy: h.y.toFixed(1), r: '28', fill: h.fill, stroke: h.fill, 'stroke-width': '1.5'
        }));
      });
      tracks.forEach(function (t) {
        wash.appendChild(svgEl('path', {
          d: t.d, fill: 'none', stroke: t.stroke, 'stroke-opacity': '0.55', 'stroke-width': '1.4', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
      });
      svg.insertBefore(wash, svg.firstChild);
    }
    if (!marks.length) return;
    var g = svgEl('g', { class: 'dimap-layer dimap-targets' });
    marks.forEach(function (m) {
      if (m.x < -30 || m.x > 930 || m.y < -30 || m.y > 500) return;
      var item = svgEl('g', { class: 'dimap-target', transform: 'translate(' + m.x.toFixed(1) + ' ' + m.y.toFixed(1) + ') rotate(' + m.rot.toFixed(1) + ')' });
      item.appendChild(svgEl('path', { d: m.d, fill: m.fill, stroke: 'rgba(0,0,0,.75)', 'stroke-width': '0.8', 'stroke-linejoin': 'round' }));
      var title = svgEl('title', {});
      title.textContent = m.title;
      item.appendChild(title);
      g.appendChild(item);
    });
    svg.appendChild(g);
  }

  function renderHud() {
    var api = state.api;
    if (!api || !api.hud) return;
    var view = model();
    var on = !!(state.enabled || state.fixture);
    api.hud.hidden = !on;
    api.attr.hidden = !on;
    api.box.checked = !!state.enabled;
    if (!on || !view) return;
    api.list.textContent = '';
    view.alerts.forEach(function (alert) {
      var li = el('li');
      li.appendChild(el('i', { style: 'background:' + alert.fill }));
      li.appendChild(el('span', { class: 'rg', text: alert.label }));
      api.list.appendChild(li);
    });
    api.status.textContent = view.statusText || '';
    api.status.hidden = !view.statusText;
    api.when.textContent = view.updatedLabel ? 'Оновлено ' + view.updatedLabel : '';
    api.when.hidden = !view.updatedLabel;
    api.attr.textContent = core.ATTR;
  }

  function publish() {
    var view = model();
    var api = state.api;
    renderHud();
    if (api && api.post) {
      api.post({
        type: 'dimap',
        targets: view ? view.targets : [],
        halos: view ? view.halos : []
      });
    }
    if (api && api.redraw) api.redraw();
  }

  function schedule(ms) {
    clearTimeout(state.timer);
    state.timer = setTimeout(step, ms);
  }

  function step() {
    if (state.fixture || !state.enabled) return;
    var api = state.api;
    if (!api || !api.visible || !api.visible()) { schedule(1000); return; }
    var invoke = invokeFn();
    if (!invoke) { publish(); schedule(core.POLL_MS); return; }
    Promise.resolve(invoke('dimap_poll')).then(function (res) {
      res = res || {};
      if (res.status === 'ok' && res.snapshot) {
        state.snapshot = res.snapshot;
        state.failed = false;
      } else if (res.status === 'not_modified') state.failed = false;
      else if (res.status === 'error' || res.status === 'denied') state.failed = true;
      publish();
      if (state.enabled) schedule(res.retryAfterMs || core.POLL_MS);
    }).catch(function () {
      state.failed = true;
      publish();
      if (state.enabled) schedule(core.backoffMs(1));
    });
  }

  function setEnabled(on) {
    var invoke = invokeFn();
    var next = !!on;
    var write = invoke
      ? invoke('profile_data_set', { key: 'dimap.state', value: JSON.stringify({ enabled: next }) })
      : Promise.resolve();
    return Promise.resolve(write).then(function () {
      state.enabled = next;
      try { localStorage.setItem('aviahub.dimapLayer', next ? '1' : '0'); } catch (e) {}
      if (!next) { state.failed = false; clearTimeout(state.timer); }
      publish();
      if (next && !state.fixture) schedule(0);
    }).catch(function () {
      if (state.api && state.api.box) state.api.box.checked = state.enabled;
    });
  }

  function syncFromProfile() {
    var invoke = invokeFn();
    if (!invoke) {
      try { state.enabled = localStorage.getItem('aviahub.dimapLayer') === '1'; } catch (e) { state.enabled = false; }
      publish();
      if (state.enabled) schedule(0);
      return;
    }
    Promise.resolve(invoke('profile_data_get', { key: 'dimap.state' })).then(function (rec) {
      state.enabled = core.savedEnabled(rec && rec.value);
      try { localStorage.setItem('aviahub.dimapLayer', state.enabled ? '1' : '0'); } catch (e) {}
      publish();
      if (state.enabled) schedule(0);
    }).catch(function () {
      state.enabled = false;
      publish();
    });
  }

  function mount(api) {
    if (!api || !api.wrap || api.wrap.dataset.dimapMounted) return;
    api.wrap.dataset.dimapMounted = '1';
    var box = el('input', { type: 'checkbox', 'aria-label': 'Шар DIMAP' });
    var sw = el('label', { class: 'dimap-sw', title: 'Показувати цілі й тривоги DIMAP на карті. Застосунок запитує публічну службу і не надсилає записи таблиці. Служба бачить IP-адресу пристрою.' });
    sw.appendChild(box);
    sw.appendChild(document.createTextNode('Шар DIMAP'));
    if (api.head) api.head.insertBefore(sw, api.head.firstChild);
    var hud = el('div', { class: 'dimap-hud', hidden: '' });
    var list = el('ul');
    var status = el('p', { class: 'st' });
    var when = el('p', { class: 'st' });
    hud.appendChild(list);
    hud.appendChild(status);
    hud.appendChild(when);
    var attr = el('div', { class: 'dimap-attr', hidden: '' });
    api.wrap.appendChild(hud);
    api.wrap.appendChild(attr);
    state.api = { wrap: api.wrap, head: api.head, post: api.post, redraw: api.redraw, visible: api.visible, hud: hud, list: list, status: status, when: when, attr: attr, box: box };
    box.addEventListener('change', function () { setEnabled(box.checked); });
    document.addEventListener('visibilitychange', function () { if (state.enabled && !state.fixture) schedule(0); });
    if (state.fixture || root.__EW_DIMAP_FIXTURE__) useFixture(state.fixture || root.__EW_DIMAP_FIXTURE__);
    else syncFromProfile();
  }

  function onMode(is3d) {
    if (is3d) publish();
  }

  function useFixture(raw) {
    state.fixture = raw;
    state.enabled = true;
    state.failed = false;
    clearTimeout(state.timer);
    if (state.api && state.api.box) state.api.box.checked = true;
    publish();
  }

  root.EWDimap = { mount: mount, paint: paint, onMode: onMode, useFixture: useFixture, setEnabled: setEnabled };
})(typeof window !== 'undefined' ? window : globalThis);
