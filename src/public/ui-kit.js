/*
 * EasyWAR ui-kit: Motion-допомога для дашбордів. Нічого не читає й не змінює в даних.
 *  1) html.ew-boot: на перші ~2 с після завантаження вмикає анімацію появи (повторні рендери не анімуються);
 *  2) ковзний індикатор у сегментованих перемикачах (.seg, .pvk-seg, .ud-seg): лише ставить CSS-змінні --ew-x/--ew-w.
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

  function start() {
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
