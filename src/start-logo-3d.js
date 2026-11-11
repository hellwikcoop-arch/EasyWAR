/* 3D-логотип стартового екрана: тризуб логотипа easyWAR відрендерено в Blender як золотий рельєф
   (13 кадрів повороту, як емблеми карток у start-emblems.js). Розмітка лаунчера не змінюється:
   <img class="start-brand-art"> обгортається у span.ew-logo3d, поверх нього стають плоска основа
   логотипа без тризуба (logo-base.webp) і смуга кадрів тризуба; початкове зображення ховається лише
   після того, як обидва файли завантажились. Кадр обирається за курсором по всьому стартовому
   екрану відносно центра логотипа; при «зменшити рух» або вимкнених анімаціях тризуб стоїть прямо. */
import { EMBLEM_DIR } from './start-emblems-core.js';
import { LOGO, LOGO_CENTER_FRAME, boxStyle, frameIndex, framePosition, logoTilt, shouldTurn } from './start-logo-3d-core.js';

const view = document.getElementById('view-start');
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const turning = () => shouldTurn({ reducedMotion: !!reducedQuery?.matches, motionOff: document.documentElement.dataset.motion === 'off' });

function load(src) {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.decoding = 'async';
    probe.addEventListener('load', () => resolve(src), { once: true });
    probe.addEventListener('error', () => reject(new Error(src)), { once: true });
    probe.src = src;
  });
}

function mount(art) {
  const base = EMBLEM_DIR + LOGO.base;
  const strip = EMBLEM_DIR + LOGO.strip;
  Promise.all([load(base), load(strip)]).then(() => {
    if (!art.isConnected || art.parentElement?.classList.contains('ew-logo3d')) return;
    const wrap = document.createElement('span');
    wrap.className = 'ew-logo3d';
    art.replaceWith(wrap);
    wrap.appendChild(art);
    const flat = document.createElement('span');
    flat.className = 'ew-logo3d-base';
    flat.setAttribute('aria-hidden', 'true');
    flat.style.backgroundImage = `url("${base}")`;
    const frame = document.createElement('span');
    frame.className = 'ew-logo3d-frame';
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, boxStyle());
    frame.style.setProperty('--ew-ar', LOGO.aspect.toFixed(4));
    frame.style.setProperty('--ew-frames', String(LOGO.frames));
    frame.style.backgroundImage = `url("${strip}")`;
    wrap.append(flat, frame);
    wrap.classList.add('ew-logo3d-on');
    mountTurn(wrap);
  }, () => { /* файлів немає — лишається плоский логотип */ });
}

function mountTurn(wrap) {
  const setFrame = (frame) => wrap.style.setProperty('--ew-frame-x', framePosition(frame, LOGO.frames));
  view.addEventListener('pointerleave', () => wrap.style.removeProperty('--ew-frame-x'));
  view.addEventListener('pointermove', (event) => {
    if (!turning()) { setFrame(LOGO_CENTER_FRAME); return; }
    setFrame(frameIndex(logoTilt(event.clientX, wrap.getBoundingClientRect()), LOGO.frames));
  });
}

if (view) {
  const art = view.querySelector('.start-brand-art');
  if (art) mount(art);
  document.documentElement.classList.add('ew-start-logo3d');
}
