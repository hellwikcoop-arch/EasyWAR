/* 3D-емблеми стартового екрана: рендери з Blender (металевий рельєф, 13 кадрів повороту) замість
   плоских зображень на картках родів військ і командувань. Розмітка й обробники лаунчера не
   змінюються: у .bc-icon додається span.ew-emblem3d (aria-hidden), а початковий <img> ховається
   лише після того, як смуга кадрів завантажилась. Кадр обирається за курсором, як нахил картки
   у start-tech.js; при «зменшити рух» або вимкнених анімаціях емблема стоїть прямо. */
import { CENTER_FRAME, EMBLEMS, EMBLEM_DIR, EMBLEM_FRAMES, commandEmblemKey, frameIndex, framePosition, shouldTurn } from './start-emblems-core.js';

const view = document.getElementById('view-start');
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const turning = () => shouldTurn({ reducedMotion: !!reducedQuery?.matches, motionOff: document.documentElement.dataset.motion === 'off' });

function emblemKey(card) {
  if (card.dataset.branch) return Object.hasOwn(EMBLEMS, card.dataset.branch) ? card.dataset.branch : null;
  if (card.hasAttribute('data-cmd-card')) return commandEmblemKey(card.getAttribute('aria-controls'));
  return null;
}

function mount(card, key) {
  const icon = card.querySelector('.bc-icon');
  if (!icon || icon.querySelector('.ew-emblem3d')) return;
  const { file, aspect } = EMBLEMS[key];
  const src = EMBLEM_DIR + file;
  const probe = new Image();
  probe.decoding = 'async';
  probe.addEventListener('load', () => {
    const wrap = document.createElement('span');
    wrap.className = 'ew-emblem3d';
    wrap.setAttribute('aria-hidden', 'true');
    const frame = document.createElement('span');
    frame.className = 'ew-emblem3d-frame';
    frame.style.setProperty('--ew-ar', aspect.toFixed(4));
    frame.style.setProperty('--ew-frames', String(EMBLEM_FRAMES));
    frame.style.backgroundImage = `url("${src}")`;
    wrap.appendChild(frame);
    icon.appendChild(wrap);
    icon.classList.add('ew-emblem3d-on');
  }, { once: true });
  probe.src = src;
}

function mountTurn(cards) {
  const setFrame = (card, frame) => card.style.setProperty('--ew-frame-x', framePosition(frame));
  cards.addEventListener('pointerleave', () => cards.querySelectorAll('.ew-emblem3d-on').forEach((icon) => icon.closest('.branch-card')?.style.removeProperty('--ew-frame-x')));
  cards.addEventListener('pointermove', (event) => {
    const card = event.target.closest?.('.branch-card');
    if (!card || !cards.contains(card) || !card.querySelector('.ew-emblem3d-on')) return;
    if (!turning()) { setFrame(card, CENTER_FRAME); return; }
    const rect = card.getBoundingClientRect();
    const tx = rect.width ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : 0;
    setFrame(card, frameIndex(tx));
  });
}

if (view) {
  const cards = view.querySelector('.branch-cards');
  for (const card of view.querySelectorAll('.branch-card[data-branch], .branch-card[data-cmd-card]')) {
    const key = emblemKey(card);
    if (key) mount(card, key);
  }
  if (cards) mountTurn(cards);
  document.documentElement.classList.add('ew-start-emblems');
}
