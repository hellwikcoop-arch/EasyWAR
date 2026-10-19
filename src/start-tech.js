/* Технологічний шар стартового екрана: мережа вузлів на canvas за картками, радарний промінь навколо
   тризуба, рамка HUD із годинником і нахил картки за курсором. Лише оформлення: розмітка, обробники
   й дані лаунчера не змінюються; усі вузли додаються тут і мають aria-hidden. Стилі — у start-tech.css. */
import { clockText, createNodes, links, nodeCount, shouldAnimate, spotlight, stepNodes } from './start-tech-core.js';

const view = document.getElementById('view-start');
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedMotion = () => document.documentElement.dataset.motion === 'off' || !!reducedQuery?.matches;

function decor(tag, className, parent, before = null) {
  const node = document.createElement(tag);
  node.className = className;
  node.setAttribute('aria-hidden', 'true');
  parent.insertBefore(node, before);
  return node;
}

function mountField() {
  const canvas = decor('canvas', 'ew-tech-field', view, view.firstChild);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let width = 0;
  let height = 0;
  let nodes = [];
  let frame = 0;
  let last = 0;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = view.clientWidth;
    height = view.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    nodes = createNodes(nodeCount(width, height), width, height);
  };

  const draw = (time) => {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    for (const [i, j, alpha] of links(nodes)) {
      ctx.strokeStyle = `rgba(96,221,232,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(nodes[i].x, nodes[i].y);
      ctx.lineTo(nodes[j].x, nodes[j].y);
      ctx.stroke();
    }
    for (const node of nodes) {
      const glow = 0.55 + 0.45 * Math.sin(time / 900 + node.phase);
      ctx.fillStyle = `rgba(150,236,244,${(0.35 + 0.5 * glow).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const tick = (time) => {
    frame = 0;
    stepNodes(nodes, width, height, last ? time - last : 16);
    last = time;
    draw(time);
    schedule();
  };

  function schedule() {
    const animate = shouldAnimate({
      reducedMotion: reducedMotion(),
      documentHidden: document.hidden,
      activeBranch: document.body.dataset.activeBranch || '',
    });
    if (animate && !frame) frame = requestAnimationFrame(tick);
    if (!animate) last = 0;
  }

  resize();
  draw(0);
  schedule();
  new ResizeObserver(() => { resize(); draw(performance.now()); }).observe(view);
  document.addEventListener('visibilitychange', schedule);
  reducedQuery?.addEventListener?.('change', () => { draw(performance.now()); schedule(); });
  // Модуль відкривається й закривається через data-active-branch на <body>: стежимо, щоб не крутити кадри під iframe.
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['data-active-branch'] });
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
}

function mountHud() {
  const hud = decor('div', 'ew-hud', view, view.firstChild.nextSibling);
  for (const corner of ['tl', 'tr', 'bl', 'br']) decor('span', `ew-hud-corner ew-hud-${corner}`, hud);
  const clock = decor('div', 'ew-hud-clock', hud);
  const time = decor('b', '', clock);
  const date = decor('span', '', clock);
  const render = () => {
    const text = clockText(new Date());
    time.textContent = text.time;
    date.textContent = text.date;
  };
  render();
  setInterval(render, 1000);
}

function mountRadar() {
  const brand = view.querySelector('.start-brand');
  if (!brand) return;
  const radar = decor('div', 'ew-radar', brand);
  decor('span', 'ew-radar-sweep', radar);
  decor('span', 'ew-radar-ping', radar);
}

function mountSpotlight() {
  const cards = view.querySelector('.branch-cards');
  if (!cards) return;
  cards.addEventListener('pointerleave', () => cards.querySelectorAll('.branch-card').forEach((card) => {
    card.style.removeProperty('--ew-tx');
    card.style.removeProperty('--ew-ty');
  }));
  cards.addEventListener('pointermove', (event) => {
    const card = event.target.closest?.('.branch-card');
    if (!card || !cards.contains(card)) return;
    const { x, y } = spotlight(card.getBoundingClientRect(), event.clientX, event.clientY);
    card.style.setProperty('--ew-tx', ((x - 50) / 50).toFixed(3));
    card.style.setProperty('--ew-ty', ((y - 50) / 50).toFixed(3));
  });
}

if (view) {
  mountField();
  mountHud();
  mountRadar();
  mountSpotlight();
  document.documentElement.classList.add('ew-start-tech');
}
