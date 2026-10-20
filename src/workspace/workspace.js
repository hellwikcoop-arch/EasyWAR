// Оболонка модуля «Робоче середовище»: розділ «Офіс» з картками застосунків і перегляд одного
// застосунку в iframe (app.html?app=<id>). Незбережені зміни застосунок повідомляє через
// postMessage; перед закриттям оболонка просить підтвердження у власній смузі, без системних
// діалогів. Лаунчер (workspace-launcher.js) питає дозволу закритися через EW_WORKSPACE.requestClose().
// У настільному застосунку застосунок працює не в головному вікні, а в окремому вікні
// редактора з дозволом лише на команди office_* (shellMode, docs/WORKSPACE.md, «Ізоляція»).
// Вкладка «Бібліотека» (лише в головному вікні застосунку) — library.js, окремий чанк, що
// вантажиться при першому відкритті вкладки; закриття сторінки блокує бібліотеку (library_lock).
// У вікні редактора смуга підказує, як відкрити документ, що чекає з бібліотеки (EasyDoc, EasySlide).
import {
  OFFICE_APPS, WORKSPACE_SECTIONS, appById, appPageUrl, frameTitle, parseFrameMessage, pendingFileNotice, shellMode,
} from './workspace-core.js';
import { findInvoke, findPendingFile } from './workspace-host.js';
import { isConnected } from './workspace-registry.js';

const home = document.getElementById('ws-home');
const sections = document.getElementById('ws-sections');
const view = document.getElementById('ws-app');
const frame = document.getElementById('ws-frame');
const titleNode = document.getElementById('ws-app-title');
const back = document.getElementById('ws-back');
const confirmBar = document.getElementById('ws-confirm');
const tabs = document.getElementById('ws-tabs');
const libraryPanel = document.getElementById('ws-library');
const libraryBadge = document.getElementById('ws-library-badge');
const notice = document.getElementById('ws-notice');

const invoke = findInvoke(window);
const shell = shellMode(window.__EW_EDITOR_APP, Boolean(invoke));

let current = null; // { app, dirty, card }
let pendingConfirm = null; // resolve смуги підтвердження
let pendingClose = null;   // проміс, який чекає на відповідь
let library = null;        // проміс { activate } вкладки «Бібліотека» після першого відкриття

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSections() {
  for (const section of WORKSPACE_SECTIONS) {
    const block = element('section', 'ws-section');
    block.setAttribute('aria-labelledby', `ws-section-${section.id}`);
    const heading = element('h2', '', section.title);
    heading.id = `ws-section-${section.id}`;
    const cards = element('div', 'ws-cards');
    for (const id of section.apps) {
      const app = appById(id);
      const card = element('button', 'ws-card');
      card.type = 'button';
      card.dataset.app = app.id;
      card.append(
        element('span', 'ws-kind', app.kind),
        element('h3', '', app.title),
        element('p', 'ws-hint', app.hint),
        element('span', 'ws-status', isConnected(app.id) ? 'Відкрити' : 'У розробці'),
      );
      card.addEventListener('click', () => {
        if (shell.mode === 'desktop' && isConnected(app.id)) openEditorWindow(app.id, card);
        else openApp(app.id, card);
      });
      cards.append(card);
    }
    block.append(heading, cards);
    sections.append(block);
  }
}

// Вкладки «Офіс» і «Бібліотека» (шаблон WAI-ARIA tabs: стрілки, Home, End).
const tabButtons = () => [...tabs.querySelectorAll('[role="tab"]')];

function selectTab(id, focus = false) {
  for (const tab of tabButtons()) {
    const selected = tab.dataset.tab === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  sections.hidden = id !== 'office';
  libraryPanel.hidden = id !== 'library';
  if (id === 'library') openLibrary();
}

function setLibraryBadge(count) {
  const tab = document.getElementById('ws-tab-library');
  libraryBadge.textContent = count ? String(count) : '';
  libraryBadge.hidden = !count;
  if (count) tab.setAttribute('aria-label', `Бібліотека, застарілих документів: ${count}`);
  else tab.removeAttribute('aria-label');
}

function openLibrary() {
  if (shell.mode !== 'desktop') {
    if (!libraryPanel.childElementCount) libraryPanel.append(element('p', 'ws-lib-note', 'Бібліотека доступна лише в застосунку EasyWAR.'));
    return;
  }
  if (!library) library = import('./library.js').then(module => module.mountLibrary(libraryPanel, { invoke, onBadge: setLibraryBadge }));
  library.then(mounted => mounted.activate()).catch(error => {
    console.error(error);
    library = null;
    libraryPanel.replaceChildren(element('p', 'ws-lib-note', 'Не вдалося відкрити бібліотеку. Закрийте «Робоче середовище» й відкрийте його знову.'));
  });
}

tabs.addEventListener('click', event => {
  const tab = event.target.closest('[role="tab"]');
  if (tab && tab.getAttribute('aria-selected') !== 'true') selectTab(tab.dataset.tab);
});
tabs.addEventListener('keydown', event => {
  const list = tabButtons();
  const index = list.indexOf(document.activeElement);
  if (index < 0) return;
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: list.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selectTab(list[(next + list.length) % list.length].dataset.tab, true);
});

function showPendingNotice(text) {
  if (!text) return;
  document.getElementById('ws-notice-text').textContent = text;
  notice.hidden = false;
}
document.getElementById('ws-notice-close').addEventListener('click', () => {
  notice.hidden = true;
  back.focus();
});

function openEditorWindow(id, card) {
  const status = card.querySelector('.ws-status');
  invoke('workspace_open_editor', { appId: id }).catch(error => {
    console.error(error);
    status.textContent = 'Не вдалося відкрити';
  });
}

function openApp(id, card) {
  const app = appById(id);
  current = { app, dirty: false, card };
  titleNode.textContent = frameTitle(app, '', false);
  document.title = `${app.title} — EasyWAR`;
  frame.src = appPageUrl(id);
  home.hidden = true;
  view.hidden = false;
  back.focus();
}

function closeApp() {
  hideConfirm(false);
  if (shell.mode === 'editor') {
    // Вікно редактора закриває Rust; стан сторінки зникає разом із вікном.
    invoke('office_editor_close').catch(error => console.error(error));
    return;
  }
  frame.src = 'about:blank';
  view.hidden = true;
  home.hidden = false;
  document.title = 'Робоче середовище — EasyWAR';
  const card = current?.card;
  current = null;
  card?.focus();
}

function hideConfirm(result) {
  confirmBar.hidden = true;
  const resolve = pendingConfirm;
  pendingConfirm = null;
  resolve?.(result);
}

/** true — застосунок закрито (або нічого не було відкрито), false — користувач залишився. */
function appIsDirty() {
  if (current.dirty) return true;
  try {
    return Boolean(frame.contentWindow?.EW_WORKSPACE_APP?.isDirty());
  } catch {
    return false;
  }
}

function requestCloseApp() {
  if (!current) return Promise.resolve(true);
  if (!appIsDirty()) {
    closeApp();
    return Promise.resolve(true);
  }
  if (pendingClose) return pendingClose;
  confirmBar.hidden = false;
  confirmBar.querySelector('[data-confirm="stay"]').focus();
  pendingClose = new Promise(resolve => { pendingConfirm = resolve; }).then(leave => {
    pendingClose = null;
    if (leave) closeApp();
    else back.focus();
    return leave;
  });
  return pendingClose;
}

confirmBar.addEventListener('click', event => {
  const choice = event.target.closest('[data-confirm]')?.dataset.confirm;
  if (choice) hideConfirm(choice === 'leave');
});
back.addEventListener('click', () => { requestCloseApp(); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !current) return;
  if (pendingConfirm) hideConfirm(false);
  else requestCloseApp();
});
window.addEventListener('message', event => {
  if (!current || event.origin !== location.origin || event.source !== frame.contentWindow) return;
  const state = parseFrameMessage(event.data, current.app.id);
  if (!state) return;
  current.dirty = state.dirty;
  titleNode.textContent = frameTitle(current.app, state.title, state.dirty);
});

window.EW_WORKSPACE = Object.freeze({ requestClose: requestCloseApp, apps: OFFICE_APPS.map(app => app.id) });
if (shell.mode === 'editor') {
  home.hidden = true;
  if (shell.app) {
    openApp(shell.app.id, null);
    showPendingNotice(pendingFileNotice(shell.app.id, findPendingFile(window)));
  } else {
    invoke('office_editor_close').catch(error => console.error(error));
  }
} else {
  renderSections();
  if (shell.mode === 'desktop') {
    // Закриття «Робочого середовища» в головному вікні блокує бібліотеку: ключі в Rust знищуються.
    window.addEventListener('pagehide', () => { invoke('library_lock').catch(() => {}); });
  }
}
