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
})();
