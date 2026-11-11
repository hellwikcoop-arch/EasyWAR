/* Карусель стартового екрана: усі картки родів військ і командувань одного розміру в одній стрічці
   з прокруткою, стрілками, крапками сторінок, колесом миші й клавішами ← →. Розмітка лаунчера не
   змінюється: .branch-cards загортається в div.ew-carousel, поруч додаються кнопки й крапки
   (усі декоративні вузли aria-hidden або з підписом), у кожну картку — підпис категорії.
   Стилі й рівний розмір карток — у start-carousel.css за html.ew-start-carousel. */
import { cardCategory, currentPage, pageCount, pageOffset, stepPage, wheelDelta } from './start-carousel-core.js';

const view = document.getElementById('view-start');
const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const smooth = () => !(reducedQuery?.matches || document.documentElement.dataset.motion === 'off');

function el(tag, className, parent, attrs = {}) {
  const node = document.createElement(tag);
  node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

function labelCards(grid) {
  for (const card of grid.querySelectorAll('.branch-card')) {
    if (card.querySelector('.ew-cat')) continue;
    const tag = document.createElement('span');
    tag.className = 'ew-cat';
    tag.setAttribute('aria-hidden', 'true');
    tag.textContent = cardCategory({ command: card.hasAttribute('data-cmd-card'), branch: card.dataset.branch || '' });
    card.appendChild(tag);
  }
}

function mount(grid) {
  const wrap = document.createElement('div');
  wrap.className = 'ew-carousel';
  grid.parentNode.insertBefore(wrap, grid);
  wrap.appendChild(grid);
  const prev = el('button', 'ew-carousel-btn ew-carousel-prev', wrap, { type: 'button', 'aria-label': 'Попередні картки' });
  const next = el('button', 'ew-carousel-btn ew-carousel-next', wrap, { type: 'button', 'aria-label': 'Наступні картки' });
  const dots = el('div', 'ew-carousel-dots', wrap, { 'aria-hidden': 'true' });
  prev.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  next.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const pages = () => pageCount(grid.scrollWidth, grid.clientWidth);
  const page = () => currentPage(grid.scrollLeft, grid.clientWidth, pages());
  const goTo = (target) => grid.scrollTo({ left: pageOffset(target, grid.clientWidth, grid.scrollWidth), behavior: smooth() ? 'smooth' : 'auto' });

  let raf = 0;
  const update = () => {
    raf = 0;
    const n = pages();
    const current = page();
    wrap.classList.toggle('ew-carousel-single', n <= 1);
    prev.disabled = current <= 0;
    next.disabled = current >= n - 1;
    if (dots.childElementCount !== n) {
      dots.replaceChildren(...Array.from({ length: n }, () => el('span', 'ew-carousel-dot', dots)));
    }
    [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i === current));
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };

  prev.addEventListener('click', () => goTo(stepPage(page(), -1, pages())));
  next.addEventListener('click', () => goTo(stepPage(page(), 1, pages())));
  grid.addEventListener('scroll', schedule, { passive: true });
  grid.addEventListener('wheel', (event) => {
    if (grid.scrollWidth <= grid.clientWidth + 8) return;
    const delta = wheelDelta(event);
    if (!delta) return;
    event.preventDefault();
    grid.scrollLeft += delta;
  }, { passive: false });
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(stepPage(page(), -1, pages())); }
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(stepPage(page(), 1, pages())); }
  });
  // Картка, що отримала фокус (Tab), має бути видимою цілком.
  grid.addEventListener('focusin', (event) => {
    const card = event.target.closest?.('.branch-card');
    if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth() ? 'smooth' : 'auto' });
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(grid);
  window.addEventListener('resize', schedule);
  // Профіль ховає картки (local-profiles.js) після старту: кількість сторінок змінюється.
  new MutationObserver(schedule).observe(grid, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden', 'data-open'] });
  update();
}

const grid = view?.querySelector('.branch-cards');
if (grid) {
  labelCards(grid);
  mount(grid);
  document.documentElement.classList.add('ew-start-carousel');
}
