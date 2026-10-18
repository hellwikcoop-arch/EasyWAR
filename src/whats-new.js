// «Що нового» на головному екрані: кнопка в панелі інструментів і накладка з нотатками до випусків.
// Нотатки лежать у збірці (whats-new/releases.json, генерується з docs/releases), мережі немає. Текст нотаток
// вставляється лише через textContent. Керування: ≡ — зміст (усі версії), ‹ › — новіша/старіша версія, × — закрити;
// з клавіатури: Esc, ← → між версіями, стрілки й Home/End у змісті.
import './whats-new.css';
import { getDatabaseStatus } from './backup-core.js';
import { canStep, hasUnseen, inlineSegments, isVersion, releaseHeading, visibleReleases } from './whats-new-core.js';

const SEEN_KEY = 'ew.whatsnew.seen.v1';
const ICONS = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.2 6.5h.01M4.2 12h.01M4.2 17.5h.01" stroke-width="3"/></svg>',
  newer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
  older: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function readSeen() {
  try { return window.localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}

function writeSeen(version) {
  try { window.localStorage.setItem(SEEN_KEY, version); } catch { /* запам'ятовування необов'язкове */ }
}

let releasesPromise = null;
function loadReleases() {
  releasesPromise ??= import('./whats-new/releases.json').then((module) => (module.default ?? module).releases ?? []);
  return releasesPromise;
}

let installed = '';
async function installedVersion() {
  if (installed) return installed;
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return '';
  try {
    const { appVersion } = await getDatabaseStatus();
    if (isVersion(appVersion)) installed = appVersion;
  } catch { /* команда статусу бази недоступна (збій читання бази): показуємо всі нотатки зі збірки */ }
  return installed;
}

const motionAllowed = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function initializeWhatsNew() {
  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet ew-wn-open';
  openButton.textContent = 'Що нового';
  openButton.title = 'Нотатки до випусків: що змінилося в EasyWAR';
  openButton.setAttribute('aria-haspopup', 'dialog');
  toolbar.prepend(openButton);

  const root = document.createElement('div');
  root.className = 'ew-wn';
  root.lang = 'uk';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'ew-wn-title');
  root.innerHTML = `
    <div class="ew-wn-bar">
      <button type="button" class="ew-wn-round ew-wn-menu-btn" aria-haspopup="true" aria-expanded="false" aria-controls="ew-wn-menu" aria-label="Зміст: усі версії" title="Зміст">${ICONS.menu}</button>
      <div class="ew-wn-pill" role="group" aria-label="Перехід між версіями">
        <button type="button" class="ew-wn-step" data-step="newer" aria-label="Новіша версія" title="Новіша версія (←)">${ICONS.newer}</button>
        <button type="button" class="ew-wn-step" data-step="older" aria-label="Старіша версія" title="Старіша версія (→)">${ICONS.older}</button>
      </div>
      <button type="button" class="ew-wn-round ew-wn-close" aria-label="Закрити «Що нового»" title="Закрити (Esc)">${ICONS.close}</button>
    </div>
    <nav class="ew-wn-menu" id="ew-wn-menu" aria-label="Версії" hidden><ul class="ew-wn-list"></ul></nav>
    <div class="ew-wn-scroll" tabindex="-1">
      <article class="ew-wn-page">
        <p class="ew-wn-eyebrow" hidden></p>
        <h1 id="ew-wn-title"></h1>
        <div class="ew-wn-body"></div>
      </article>
    </div>
    <p class="ew-wn-sr" role="status" aria-live="polite"></p>`;
  document.body.append(root);

  const menuButton = root.querySelector('.ew-wn-menu-btn');
  const closeButton = root.querySelector('.ew-wn-close');
  const menu = root.querySelector('.ew-wn-menu');
  const list = root.querySelector('.ew-wn-list');
  const scroll = root.querySelector('.ew-wn-scroll');
  const page = root.querySelector('.ew-wn-page');
  const eyebrow = root.querySelector('.ew-wn-eyebrow');
  const title = root.querySelector('#ew-wn-title');
  const body = root.querySelector('.ew-wn-body');
  const status = root.querySelector('.ew-wn-sr');
  const steps = { newer: root.querySelector('[data-step="newer"]'), older: root.querySelector('[data-step="older"]') };

  let releases = [];
  let index = 0;
  let launcherWasInert = false;
  let enteringTimer = 0;

  const menuItems = () => [...list.querySelectorAll('.ew-wn-item')];
  const menuIsOpen = () => !menu.hidden;

  function paragraph(className) {
    const node = document.createElement('p');
    if (className) node.className = className;
    return node;
  }

  function renderRelease(direction) {
    const release = releases[index];
    body.replaceChildren();
    if (!release) {
      title.textContent = 'Що нового';
      eyebrow.hidden = true;
      const empty = paragraph('ew-wn-empty');
      empty.textContent = 'Нотатки до випусків недоступні.';
      body.append(empty);
    } else {
      title.textContent = releaseHeading(release.version);
      eyebrow.hidden = release.version !== installed;
      eyebrow.textContent = 'Встановлена версія';
      if (release.intro) {
        const intro = paragraph('ew-wn-intro');
        intro.textContent = release.intro;
        body.append(intro);
      }
      for (const entry of release.paragraphs) {
        const node = paragraph('');
        if (entry.lead) {
          const lead = document.createElement('strong');
          lead.className = 'ew-wn-lead';
          lead.textContent = entry.lead;
          node.append(lead, ' ');
        }
        for (const segment of inlineSegments(entry.text)) {
          if (segment.code) {
            const code = document.createElement('code');
            code.textContent = segment.text;
            node.append(code);
          } else {
            node.append(document.createTextNode(segment.text));
          }
        }
        body.append(node);
      }
      status.textContent = `Версія ${release.version}, ${index + 1} з ${releases.length}`;
    }
    for (const direction_ of ['newer', 'older']) {
      steps[direction_].setAttribute('aria-disabled', String(!canStep(releases.length, index, direction_)));
    }
    menuItems().forEach((item, position) => item.setAttribute('aria-current', String(position === index)));
    scroll.scrollTop = 0;
    if (direction && motionAllowed() && typeof page.animate === 'function') {
      page.animate(
        [{ opacity: 0, transform: `translateX(${direction * 28}px)` }, { opacity: 1, transform: 'translateX(0)' }],
        { duration: 300, easing: 'cubic-bezier(.16, 1, .3, 1)' },
      );
    }
  }

  function showIndex(next) {
    if (releases.length === 0) return;
    const bounded = Math.min(Math.max(next, 0), releases.length - 1);
    if (bounded === index) return;
    const direction = Math.sign(bounded - index);
    index = bounded;
    renderRelease(direction);
  }

  function buildMenu() {
    list.replaceChildren();
    releases.forEach((release, position) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ew-wn-item';
      button.dataset.index = String(position);
      const version = document.createElement('span');
      version.className = 'ew-wn-item-v';
      version.textContent = release.version;
      button.append(version);
      if (release.version === installed) {
        const badge = document.createElement('span');
        badge.className = 'ew-wn-item-badge';
        badge.textContent = 'Встановлена';
        button.append(badge);
      }
      const summary = document.createElement('span');
      summary.className = 'ew-wn-item-s';
      summary.textContent = release.summary;
      button.append(summary);
      item.append(button);
      list.append(item);
    });
  }

  function openMenu() {
    if (releases.length === 0) return;
    menu.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    const current = menuItems()[index];
    current?.focus();
    current?.scrollIntoView({ block: 'nearest' });
  }

  function closeMenu(returnFocus) {
    if (!menuIsOpen()) return;
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) menuButton.focus();
  }

  function close() {
    closeMenu(false);
    root.hidden = true;
    root.classList.remove('is-entering');
    window.clearTimeout(enteringTimer);
    const launcher = document.getElementById('view-start');
    if (launcher) launcher.inert = launcherWasInert;
    openButton.focus();
  }

  let opening = false;
  async function open() {
    // Другий клик, поки нотатки ще вантажаться, не повинен відкривати накладку вдруге: тоді `inert`, уже
    // виставлений першим відкриттям, потрапив би в launcherWasInert і головний екран лишився б заблокованим.
    if (!root.hidden || opening) return;
    opening = true;
    try {
      const [all] = await Promise.all([loadReleases(), installedVersion()]);
      releases = visibleReleases(all, installed);
    } catch {
      releases = [];
    } finally {
      opening = false;
    }
    index = 0;
    buildMenu();
    renderRelease(0);
    if (releases.length > 0) {
      writeSeen(releases[0].version);
      openButton.dataset.unseen = 'false';
    }
    const launcher = document.getElementById('view-start');
    launcherWasInert = Boolean(launcher?.inert);
    if (launcher) launcher.inert = true;
    root.hidden = false;
    root.classList.add('is-entering');
    enteringTimer = window.setTimeout(() => root.classList.remove('is-entering'), 800);
    scroll.focus({ preventScroll: true });
  }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  menuButton.addEventListener('click', () => (menuIsOpen() ? closeMenu(false) : openMenu()));
  for (const direction of ['newer', 'older']) {
    steps[direction].addEventListener('click', () => showIndex(index + (direction === 'newer' ? -1 : 1)));
  }
  list.addEventListener('click', (event) => {
    const item = event.target.closest?.('.ew-wn-item');
    if (!item) return;
    closeMenu(false);
    showIndex(Number(item.dataset.index));
    scroll.focus({ preventScroll: true });
  });
  root.addEventListener('pointerdown', (event) => {
    if (menuIsOpen() && !menu.contains(event.target) && !menuButton.contains(event.target)) closeMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (root.hidden || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (menuIsOpen()) closeMenu(true);
      else close();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll('button')].filter((node) => node.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Фокус на тексті статті (після відкриття чи вибору версії) або поза накладкою: Tab веде до першої чи
      // останньої кнопки, а не виходить із діалогу.
      if (!root.contains(active) || active === scroll) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (menuIsOpen()) {
      const items = menuItems();
      const position = items.indexOf(document.activeElement);
      const target = { ArrowDown: position + 1, ArrowUp: position - 1, Home: 0, End: items.length - 1 }[event.key];
      if (target !== undefined && items.length > 0) {
        event.preventDefault();
        items[Math.min(Math.max(target, 0), items.length - 1)].focus();
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); showIndex(index - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); showIndex(index + 1); }
  });

  // Крапка на кнопці, поки користувач не відкрив найновіший випуск.
  (async () => {
    try {
      const [all] = await Promise.all([loadReleases(), installedVersion()]);
      openButton.dataset.unseen = String(hasUnseen(visibleReleases(all, installed), readSeen()));
    } catch { /* без нотаток крапки немає */ }
  })();
}

initializeWhatsNew();
