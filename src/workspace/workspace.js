// Оболонка модуля «Робоче середовище»: розділи «Офіс», «Обстановка» і «Особисте» з картками застосунків і перегляд одного
// застосунку в iframe (app.html?app=<id>) під верхньою смугою «← Розділи · назва · Закрити».
// Незбережені зміни застосунок повідомляє через postMessage; перед закриттям оболонка просить
// підтвердження у власній смузі, без системних діалогів. Лаунчер (workspace-launcher.js) питає
// дозволу закритися через EW_WORKSPACE.requestClose(), а «← На стартову» просить його закритися.
// У настільному застосунку застосунок працює не в головному вікні, а в окремому вікні
// редактора з дозволом лише на команди office_* (shellMode, docs/WORKSPACE.md, «Ізоляція»).
// Застосунки «Обстановки» (погода) лишаються в iframe головного вікна (opensInEditorWindow).
// Вкладка «Бібліотека» (лише в головному вікні застосунку) — library.js, окремий чанк, що
// вантажиться при першому відкритті вкладки; закриття сторінки блокує бібліотеку (library_lock).
// Вкладка «Файли» (теж лише в головному вікні) — files.js, окремий чанк: сховище файлів
// профілю в теці на диску (команди workspace_files_*).
// У вікні редактора смуга підказує, як відкрити документ, що чекає з бібліотеки (EasyDoc, EasySlide).
import {
  CLOSE_MESSAGE,
  WORKSPACE_APPS,
  WORKSPACE_SECTIONS,
  appById,
  appPageUrl,
  formatsLabel,
  frameTitle,
  opensInEditorWindow,
  branchFromSearch,
  parseFrameMessage,
  pendingFileNotice,
  shellMode,
  titleParts,
} from './workspace-core.js';
import { findInvoke, findPendingFile } from './workspace-host.js';
import { appIcon, arrowIcon, element as make } from './workspace-dom.js';
import { isConnected } from './workspace-registry.js';

// Акцент роду військ, з якого відкрили модуль (?branch=<id>, див. workspace-core.js).
// Окреме вікно редактора (настільний застосунок) відкривається без параметра: там типовий рід.
const branch = branchFromSearch(location.search);
document.documentElement.dataset.branch = branch;

const home = document.getElementById('ws-home');
const sections = document.getElementById('ws-sections');
const view = document.getElementById('ws-app');
const frame = document.getElementById('ws-frame');
const iconNode = document.getElementById('ws-app-icon');
const nameNode = document.getElementById('ws-app-name');
const fileNode = document.getElementById('ws-app-file');
const dirtyNode = document.getElementById('ws-app-dirty');
const back = document.getElementById('ws-back');
const closeButton = document.getElementById('ws-close');
const exitButton = document.getElementById('ws-exit');
const confirmBar = document.getElementById('ws-confirm');
const tabs = document.getElementById('ws-tabs');
const libraryPanel = document.getElementById('ws-library');
const libraryBadge = document.getElementById('ws-library-badge');
const filesPanel = document.getElementById('ws-files');
const notice = document.getElementById('ws-notice');

const invoke = findInvoke(window);
const shell = shellMode(window.__EW_EDITOR_APP, Boolean(invoke));

let current = null; // { app, dirty, card }
let pendingConfirm = null; // resolve смуги підтвердження
let pendingClose = null;   // проміс, який чекає на відповідь
let library = null;        // проміс { activate } вкладки «Бібліотека» після першого відкриття
let files = null;          // проміс { activate } вкладки «Файли» після першого відкриття

const element = (tag, className, text) => make(document, tag, className, text);

function appCard(app) {
  const connected = isConnected(app.id);
  const card = element('button', connected ? 'ws-card' : 'ws-card is-unavailable');
  card.type = 'button';
  card.dataset.app = app.id;
  card.setAttribute('aria-label', `${connected ? 'Відкрити' : 'У розробці'} ${app.title}: ${app.kind.toLowerCase()}`);
  if (!connected) {
    card.disabled = true;
    card.setAttribute('aria-disabled', 'true');
  }
  const spine = element('span', 'ws-card-spine');
  spine.setAttribute('aria-hidden', 'true');
  const tile = element('span', 'ws-icon-tile');
  tile.append(appIcon(document, app.id, 48));
  const top = element('span', 'ws-card-top');
  top.append(tile, element('span', 'ws-card-type', app.kind.toUpperCase()));
  const arrow = element('span', 'ws-card-arrow');
  arrow.setAttribute('aria-hidden', 'true');
  if (connected) arrow.append(arrowIcon(document));
  else arrow.textContent = '—';
  const action = element('span', 'ws-card-action');
  action.append(element('span', '', connected ? 'Відкрити' : 'У розробці'), arrow);
  card.append(
    spine,
    top,
    element('strong', 'ws-card-name', app.title),
    element('span', 'ws-card-desc', app.hint),
    element('span', 'ws-card-formats', formatsLabel(app) || 'Без файлів'),
    action,
  );
  if (connected) {
    card.addEventListener('click', () => {
      if (shell.mode === 'desktop' && opensInEditorWindow(app.id)) openEditorWindow(app.id, card);
      else openApp(app.id, card);
    });
  }
  return card;
}

function renderSections() {
  for (const section of WORKSPACE_SECTIONS) {
    const block = element('section', 'ws-section');
    block.setAttribute('aria-labelledby', `ws-section-${section.id}`);
    const heading = element('div', 'ws-home-heading');
    const title = element('h1', '', section.title);
    title.id = `ws-section-${section.id}`;
    heading.append(
      element('p', 'ws-eyebrow', section.eyebrow),
      title,
      element('p', 'ws-home-subtitle', section.subtitle),
    );
    const cards = element('div', 'ws-cards');
    cards.setAttribute('aria-label', `Застосунки розділу «${section.title}»`);
    for (const id of section.apps) cards.append(appCard(appById(id)));
    block.append(heading, cards);
    sections.append(block);
  }
}

// Вкладки «Розділи», «Бібліотека» і «Файли» (шаблон WAI-ARIA tabs: стрілки, Home, End).
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
  filesPanel.hidden = id !== 'files';
  if (id === 'library') openLibrary();
  if (id === 'files') openFiles();
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

function openFiles() {
  if (shell.mode !== 'desktop') {
    if (!filesPanel.childElementCount) filesPanel.append(element('p', 'ws-lib-note', 'Сховище файлів доступне лише в застосунку EasyWAR.'));
    return;
  }
  if (!files) files = import('./files.js').then(module => module.mountFiles(filesPanel, { invoke }));
  files.then(mounted => mounted.activate()).catch(error => {
    console.error(error);
    files = null;
    filesPanel.replaceChildren(element('p', 'ws-lib-note', 'Не вдалося відкрити сховище файлів. Закрийте «Робоче середовище» й відкрийте його знову.'));
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

function showTitle(app, title, dirty) {
  const parts = titleParts(app, title, dirty);
  nameNode.textContent = parts.name;
  fileNode.textContent = parts.file ? `— ${parts.file}` : '';
  fileNode.hidden = !parts.file;
  dirtyNode.hidden = !parts.dirty;
  document.title = `${frameTitle(app, title, dirty)} — EasyWAR`;
}

function openEditorWindow(id, card) {
  const status = card.querySelector('.ws-card-action span');
  invoke('workspace_open_editor', { appId: id }).catch(error => {
    console.error(error);
    status.textContent = 'Не вдалося відкрити';
  });
}

function openApp(id, card) {
  const app = appById(id);
  current = { app, dirty: false, card };
  iconNode.replaceChildren(appIcon(document, app.id, 24));
  showTitle(app, '', false);
  frame.src = appPageUrl(id, branch);
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

function appIsDirty() {
  if (current.dirty) return true;
  try {
    return Boolean(frame.contentWindow?.EW_WORKSPACE_APP?.isDirty());
  } catch {
    return false;
  }
}

/** Після «Залишитися» фокус повертається в застосунок, а не на кнопку «← Розділи». */
function focusApp() {
  try {
    const app = frame.contentWindow?.EW_WORKSPACE_APP;
    if (typeof app?.focus === 'function') { app.focus(); return; }
  } catch { /* сторінку застосунку ще не завантажено */ }
  frame.focus();
}

/** true — застосунок закрито (або нічого не було відкрито), false — користувач залишився. */
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
    else focusApp();
    return leave;
  });
  return pendingClose;
}

/** «← На стартову»: у накладці лаунчера — попросити його закритися, окремо — перейти на старт. */
function exitWorkspace() {
  if (window.parent !== window) window.parent.postMessage({ type: CLOSE_MESSAGE }, location.origin);
  else location.href = '../index.html';
}

confirmBar.addEventListener('click', event => {
  const choice = event.target.closest('[data-confirm]')?.dataset.confirm;
  if (choice) hideConfirm(choice === 'leave');
});
back.addEventListener('click', () => { requestCloseApp(); });
closeButton.addEventListener('click', () => { requestCloseApp(); });
exitButton.addEventListener('click', exitWorkspace);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!current) exitWorkspace();
  else if (pendingConfirm) hideConfirm(false);
  else requestCloseApp();
});
window.addEventListener('message', event => {
  if (!current || event.origin !== location.origin || event.source !== frame.contentWindow) return;
  const state = parseFrameMessage(event.data, current.app.id);
  if (!state) return;
  current.dirty = state.dirty;
  showTitle(current.app, state.title, state.dirty);
});

window.EW_WORKSPACE = Object.freeze({ requestClose: requestCloseApp, apps: WORKSPACE_APPS.map(app => app.id) });
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
