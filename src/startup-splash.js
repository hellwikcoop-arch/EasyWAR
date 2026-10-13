// Заставка easyWAR після запуску: відео (5,3 с, без звуку) → плитки родів військ →
// смужка «Завантаження…» → плавний перехід на стартовий екран.
// Усе локально: жодних запитів назовні, відео лежить поруч із застосунком.
// Логіка таймінгів — у startup-splash-core.js (є тести), тут лише DOM.
import {
  SPLASH,
  SPLASH_TILES,
  progressValue,
  shouldRunSplash,
  splashClockMs,
  splashFinished,
  visibleTileCount,
} from './startup-splash-core.js';

const VIDEO_URL = new URL('./splash/easywar-intro.mp4', import.meta.url).href;

(function startSplash() {
  const root = document.getElementById('ew-splash');
  if (!root) return;
  const launcher = document.getElementById('view-start');
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!shouldRunSplash({ reducedMotion: reduced })) {
    root.remove();
    return;
  }

  let finished = false;
  let ready = false;
  let rafId = 0;
  let endedAt = 0;
  let blobUrl = '';

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Заставка easyWAR');

  const video = el('video', 'ew-splash__video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.disablePictureInPicture = true;
  video.tabIndex = -1;
  video.setAttribute('aria-hidden', 'true');

  const tileEls = SPLASH_TILES.map(tile => el('div', 'ew-splash__tile', tile.label));
  const tiles = el('div', 'ew-splash__tiles');
  tiles.setAttribute('aria-hidden', 'true');
  tiles.append(...tileEls);

  const fill = el('div', 'ew-splash__fill');
  const bar = el('div', 'ew-splash__bar');
  bar.append(fill);
  const loader = el('div', 'ew-splash__loader');
  loader.append(el('span', 'ew-splash__loading-text', 'Завантаження…'), bar);

  const hud = el('div', 'ew-splash__hud');
  hud.append(tiles, loader);

  const skip = el('button', 'ew-splash__skip');
  skip.type = 'button';
  skip.append('Пропустити ', el('kbd', '', 'Esc'));

  root.append(video, hud, skip);
  if (launcher) launcher.inert = true;
  skip.focus({ preventScroll: true });

  // Лаунчер готовий, коли сторінка й шрифти завантажені. Смужка не доходить до кінця раніше.
  const markReady = () => { ready = true; };
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  if (document.readyState === 'complete') fontsReady.then(markReady);
  else window.addEventListener('load', () => fontsReady.then(markReady), { once: true });

  function finish(immediate) {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    clearTimeout(startTimer);
    document.removeEventListener('keydown', onKey, true);
    try { video.pause(); } catch (e) { /* відео вже зупинене */ }
    if (launcher) launcher.inert = false;
    const done = () => {
      root.remove();
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* елемент уже знято */ }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      window.dispatchEvent(new CustomEvent('ew:splash-end'));
    };
    if (immediate) {
      done();
      return;
    }
    root.classList.add('is-leaving');
    setTimeout(done, SPLASH.fadeOutMs + 30);
  }

  function onKey(event) {
    if (event.key === 'Tab') {
      event.preventDefault();
      skip.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  }
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', () => finish());

  function tick(now) {
    if (finished) return;
    if (!endedAt && video.ended) endedAt = now;
    const clock = splashClockMs({
      videoTimeSec: video.currentTime,
      videoEnded: Boolean(endedAt),
      msSinceEnd: endedAt ? now - endedAt : 0,
    });
    const shown = visibleTileCount(clock, tileEls.length);
    tileEls.forEach((tile, index) => tile.classList.toggle('is-in', index < shown));
    const loadingElapsed = clock - SPLASH.videoMs;
    if (loadingElapsed > -400) loader.classList.add('is-in');
    // Страховка: якщо подія load чомусь не прийшла, смужка не висить вічно.
    if (loadingElapsed > SPLASH.progressMinMs + 4000) ready = true;
    fill.style.transform = `scaleX(${progressValue(loadingElapsed, ready)})`;
    if (splashFinished(loadingElapsed, ready)) {
      finish();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  // Якщо відео не можна показати, заставка зникає одразу й не затримує запуск.
  const startTimer = setTimeout(() => finish(true), SPLASH.startTimeoutMs);
  video.addEventListener('playing', () => {
    clearTimeout(startTimer);
    root.classList.add('is-playing');
    rafId = requestAnimationFrame(tick);
  }, { once: true });
  video.addEventListener('error', () => finish(true));

  // Відео береться як blob: WKWebView на macOS може не грати медіа зі схеми tauri://
  // без підтримки Range-запитів. Файл невеликий (≈0,5 МБ), читається локально.
  async function attachVideo() {
    try {
      const response = await fetch(VIDEO_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      blobUrl = URL.createObjectURL(await response.blob());
      video.src = blobUrl;
    } catch (e) {
      video.src = VIDEO_URL;
    }
    await video.play();
  }
  attachVideo().catch(() => finish(true));
})();
