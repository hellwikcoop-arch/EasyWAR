/*
 * EasyWAR ui-kit: Motion-допомога для дашбордів. Нічого не читає й не змінює в даних.
 *  1) html.ew-boot: на перші ~2 с після завантаження вмикає анімацію появи (повторні рендери не анімуються);
 *  2) ковзний індикатор у сегментованих перемикачах (.seg, .pvk-seg, .ud-seg): лише ставить CSS-змінні --ew-x/--ew-w;
 *  3) стиль «Пункт керування» (heightwell-theme.css, кнопка ◈ поруч із кнопкою теми);
 *  4) поля дат показують «дд.мм.рррр» незалежно від мови системи: поверх input[type=date] — текстове поле,
 *     значення (ISO) і події change/input лишаються на самому input[type=date].
 * Без JS усе працює, просто без руху. Поважає html[data-motion="off"] і prefers-reduced-motion.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
  function motionOff() { return reduce || root.getAttribute('data-motion') === 'off'; }

  if (!motionOff()) {
    root.classList.add('ew-boot');
    setTimeout(function () { root.classList.remove('ew-boot'); }, 2200);
  }

  var SEL = '.pvk-seg, .ud-seg'; // .seg у ПС/РВ має власний повзунок
  var queued = false;

  function place(seg) {
    var btns = seg.querySelectorAll(':scope > button');
    if (!btns.length) { seg.classList.remove('ew-ind'); return; }
    var on = null, top = btns[0].offsetTop, oneRow = true;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].offsetTop !== top) oneRow = false;
      if (btns[i].getAttribute('aria-pressed') === 'true') on = btns[i];
    }
    if (!on || !oneRow || !on.offsetWidth) { seg.classList.remove('ew-ind'); return; }
    seg.style.setProperty('--ew-w', on.offsetWidth + 'px');
    seg.style.setProperty('--ew-x', on.offsetLeft + 'px');
    seg.classList.add('ew-ind');
  }

  function update() {
    queued = false;
    var list = document.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) place(list[i]);
  }
  function schedule() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(update);
  }

  // 4) Дати. toUk/fromUk — чиста логіка (тести: tests/ui-kit-date.test.mjs через window.EWDate).
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toUk(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; }
  function fromUk(text) {
    var t = String(text || '').trim(), m;
    if (!t) return '';
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) m = [0, m[3], m[2], m[1]];
    else if ((m = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) m = [0, m[1], m[2], m[3]];
    else m = /^(\d{1,2})\D+(\d{1,2})\D+(\d{2}|\d{4})$/.exec(t);
    if (!m) return null;
    var d = +m[1], mo = +m[2], y = +m[3];
    if (m[3].length === 2) y += 2000;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (y < 1000 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  window.EWDate = { toUk: toUk, fromUk: fromUk };

  var VAL = typeof HTMLInputElement === 'function' ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') : null;
  function fire(n, type) { n.dispatchEvent(new Event(type, { bubbles: true })); }
  function upgrade(n) {
    if (n.ewDate || !VAL) return;
    var cs = getComputedStyle(n), box = document.createElement('span'), t = document.createElement('input');
    n.ewDate = t;
    box.className = 'ew-date';
    box.style.display = /^(inline|inline-block)$/.test(cs.display) ? 'inline-block' : 'block';
    if (cs.flex) box.style.flex = cs.flex;
    t.type = 'text'; t.className = 'ew-date-t'; t.placeholder = 'дд.мм.рррр'; t.inputMode = 'numeric'; t.autocomplete = 'off';
    t.setAttribute('aria-label', n.getAttribute('aria-label') || 'Дата (дд.мм.рррр)');
    function look() {
      var c = getComputedStyle(n);
      t.style.font = c.font; t.style.color = c.color;
      t.style.paddingLeft = (parseFloat(c.paddingLeft) + parseFloat(c.borderLeftWidth)) + 'px';
    }
    function show() { t.value = toUk(VAL.get.call(n)); t.disabled = n.disabled; t.readOnly = n.readOnly; t.removeAttribute('aria-invalid'); }
    function commit() {
      var iso = fromUk(t.value);
      if (iso === null) { t.setAttribute('aria-invalid', 'true'); return; }
      if (iso !== VAL.get.call(n)) { VAL.set.call(n, iso); fire(n, 'input'); fire(n, 'change'); }
      show();
    }
    function pick() { try { n.showPicker(); return true; } catch (e) { return false; } }
    Object.defineProperty(n, 'value', { configurable: true, get: function () { return VAL.get.call(n); }, set: function (v) { VAL.set.call(n, v); show(); } });
    n.focus = function (o) { t.focus(o); };
    n.tabIndex = -1;
    n.classList.add('ew-date-n');
    n.parentNode.insertBefore(box, n);
    box.append(t, n);
    n.addEventListener('input', show);
    n.addEventListener('change', show);
    n.addEventListener('click', function (e) { if (pick()) e.preventDefault(); });
    t.addEventListener('change', commit);
    t.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') show();
      else if ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4') { if (pick()) e.preventDefault(); }
    });
    t.ewLook = look;
    look(); show();
  }
  function dates() {
    var list = document.querySelectorAll('input[type="date"]:not(.ew-date-n)');
    for (var i = 0; i < list.length; i++) if (list[i].parentNode) upgrade(list[i]);
  }
  function relook() {
    var list = document.querySelectorAll('.ew-date-t');
    for (var i = 0; i < list.length; i++) list[i].ewLook();
  }
  function relookSoon() { relook(); setTimeout(relook, 450); } // колір теми змінюється з переходом ~0,3 с

  function start() {
    dates();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(dates).observe(document.body, { childList: true, subtree: true });
      new MutationObserver(relookSoon).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-skin', 'class'] });
    }
    update();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'hidden'] });
    }
    window.addEventListener('resize', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // 3) стиль «Пункт керування» (heightwell-theme.css): html[data-skin="heightwell"], вибір зберігається
  //    в localStorage для всіх модулів; кнопка-перемикач стає поруч із кнопкою теми, якщо вона є.
  //    Стилі й шрифти підвантажуються лише після вмикання, тож вимкнений стиль нічого не важить,
  //    а у файлах командування для телефона (без public/) кнопка просто ховається.
  var SKIN_KEY = 'aviahub.skin';
  var SKIN = 'heightwell';
  var SKIN_CSS = './heightwell-theme.css';
  function readSkin() {
    try { return window.localStorage.getItem(SKIN_KEY) === SKIN; } catch (e) { return false; }
  }
  function loadSkinCss() {
    if (document.getElementById('ew-skin-css') || !document.head) return;
    var l = document.createElement('link');
    l.id = 'ew-skin-css';
    l.rel = 'stylesheet';
    l.href = SKIN_CSS;
    l.onerror = function () {
      root.removeAttribute('data-skin');
      var b = document.getElementById('skinBtn');
      if (b) b.hidden = true;
    };
    document.head.appendChild(l);
  }
  function applySkin(on) {
    if (on) { loadSkinCss(); root.setAttribute('data-skin', SKIN); } else root.removeAttribute('data-skin');
    var b = document.getElementById('skinBtn');
    if (b) {
      var label = 'Стиль «Пункт керування»: ' + (on ? 'увімк.' : 'вимк.');
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', label);
      b.title = label + '. Темне полотно, світло розділу за модулем, шрифти Space Grotesk та IBM Plex Mono. Діє лише в темній темі.';
    }
  }
  function toggleSkin() {
    var on = root.getAttribute('data-skin') !== SKIN;
    try { if (on) window.localStorage.setItem(SKIN_KEY, SKIN); else window.localStorage.removeItem(SKIN_KEY); } catch (e) { /* ignore */ }
    applySkin(on);
  }
  function mountSkinButton() {
    var theme = document.getElementById('themeBtn');
    if (!theme || document.getElementById('skinBtn')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'skinBtn';
    b.className = 'motion-btn ew-skin-btn';
    b.textContent = '◈';
    b.addEventListener('click', toggleSkin);
    theme.parentNode.insertBefore(b, theme.nextSibling);
    applySkin(root.getAttribute('data-skin') === SKIN);
  }
  applySkin(readSkin());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountSkinButton); else mountSkinButton();
  // 5) технологічний шар модулів (module-tech.css): порожній екран і заголовки секцій як на стартовому екрані.
  //    Файл із public/, тож у файли для телефона (file://) не вбудовується й там не вантажиться.
  if (typeof location !== 'undefined' && location.protocol !== 'file:' && document.head && !document.getElementById('ew-tech-css')) {
    var tech = document.createElement('link');
    tech.id = 'ew-tech-css';
    tech.rel = 'stylesheet';
    tech.href = './module-tech.css';
    document.head.appendChild(tech);
  }
  // loadCss — лише шрифти й токени без вмикання стилю: їх бере стиль модуля «Пункт керування» (каталог модулів).
  window.EWUiSkin = { key: SKIN_KEY, name: SKIN, apply: applySkin, toggle: toggleSkin, loadCss: loadSkinCss };
})();
