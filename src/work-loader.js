// Індикатор «Відкриваємо таблицю…» у лаунчері (за мотивом Uplink Loader з AnimatedWebs, власна реалізація).
// Показується поверх модуля, лише коли відкриття триває довше за WORK_LOADER.delayMs; не перехоплює кліки.
// Смуга — нескінченна «хвиля» сегментів: справжнього відсотка читання файла немає, тож він не вигадується.
import './work-loader.css';
import { WORK_LOADER, formatElapsed, hideDelay, loaderText } from './work-loader-core.js';

const jobs = [];
let node = null;
let shownAt = null;
let showTimer = 0;
let hideTimer = 0;
let tickTimer = 0;

function build() {
  const root = document.createElement('div');
  root.className = 'ew-uplink';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.hidden = true;
  const card = document.createElement('div');
  card.className = 'ew-uplink__card';
  const head = document.createElement('div');
  head.className = 'ew-uplink__head';
  const dot = document.createElement('span');
  dot.className = 'ew-uplink__dot';
  dot.setAttribute('aria-hidden', 'true');
  const title = document.createElement('b');
  const time = document.createElement('span');
  time.className = 'ew-uplink__time';
  head.append(dot, title, time);
  const bar = document.createElement('div');
  bar.className = 'ew-uplink__bar';
  bar.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < WORK_LOADER.segments; index += 1) {
    const segment = document.createElement('i');
    segment.style.setProperty('--i', String(index));
    bar.append(segment);
  }
  const detail = document.createElement('p');
  detail.className = 'ew-uplink__detail';
  card.append(head, bar, detail);
  root.append(card);
  document.body.append(root);
  return root;
}

function render() {
  const job = jobs.at(-1);
  if (!node || !job) return;
  const { title, detail } = loaderText(job);
  node.querySelector('b').textContent = title;
  node.querySelector('.ew-uplink__detail').textContent = detail;
  node.querySelector('.ew-uplink__time').textContent = formatElapsed(Date.now() - job.startedAt);
}

function show() {
  showTimer = 0;
  if (!jobs.length) return;
  node ||= build();
  node.hidden = false;
  shownAt = Date.now();
  render();
  tickTimer = setInterval(render, WORK_LOADER.tickMs);
}

function hide() {
  hideTimer = 0;
  if (jobs.length) return;
  clearInterval(tickTimer);
  tickTimer = 0;
  shownAt = null;
  if (node) node.hidden = true;
}

/**
 * Починає показ для однієї роботи; повертає функцію завершення (викликати один раз, у finally).
 * Кілька одночасних робіт показуються одним індикатором з підписом останньої.
 */
export function startWorkLoader({ table = '', fileName = '' } = {}) {
  if (typeof document === 'undefined') return () => {};
  const job = { table, fileName, startedAt: Date.now() };
  jobs.push(job);
  clearTimeout(hideTimer);
  hideTimer = 0;
  if (shownAt != null) render();
  else if (!showTimer) showTimer = setTimeout(show, WORK_LOADER.delayMs);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    jobs.splice(jobs.indexOf(job), 1);
    if (jobs.length) { render(); return; }
    clearTimeout(showTimer);
    showTimer = 0;
    hideTimer = setTimeout(hide, hideDelay(shownAt, Date.now()));
  };
}

// Для перевірки вигляду з консолі й driver.mjs: window.EWWorkLoader.start({ table, fileName }).
window.EWWorkLoader = { start: startWorkLoader };
