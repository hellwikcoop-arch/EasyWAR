// Оболонка модуля «Робоче середовище»: розділ «Офіс» з картками застосунків і перегляд одного
// застосунку в iframe (app.html?app=<id>) під верхньою смугою «← Офіс · назва · Закрити».
// Незбережені зміни застосунок повідомляє через postMessage; перед закриттям оболонка просить
// підтвердження у власній смузі, без системних діалогів. Лаунчер (workspace-launcher.js) питає
// дозволу закритися через EW_WORKSPACE.requestClose(), а «← На стартову» просить його закритися.
import {
  CLOSE_MESSAGE,
  OFFICE_APPS,
  WORKSPACE_SECTIONS,
  appById,
  appPageUrl,
  formatsLabel,
  frameTitle,
  parseFrameMessage,
  titleParts,
} from './workspace-core.js';
import { appIcon, arrowIcon, element as make } from './workspace-dom.js';
import { isConnected } from './workspace-registry.js';

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

let current = null; // { app, dirty, card }
let pendingConfirm = null; // resolve смуги підтвердження
let pendingClose = null;   // проміс, який чекає на відповідь

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
    element('span', 'ws-card-formats', formatsLabel(app)),
    action,
  );
  if (connected) card.addEventListener('click', () => openApp(app.id, card));
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
      element('p', 'ws-eyebrow', 'ЛОКАЛЬНІ ЗАСТОСУНКИ'),
      title,
      element('p', 'ws-home-subtitle', 'Оберіть застосунок для роботи з файлами на цьому комп’ютері.'),
    );
    const cards = element('div', 'ws-cards');
    cards.setAttribute('aria-label', `Застосунки розділу «${section.title}»`);
    for (const id of section.apps) cards.append(appCard(appById(id)));
    block.append(heading, cards);
    sections.append(block);
  }
}

function showTitle(app, title, dirty) {
  const parts = titleParts(app, title, dirty);
  nameNode.textContent = parts.name;
  fileNode.textContent = parts.file ? `— ${parts.file}` : '';
  fileNode.hidden = !parts.file;
  dirtyNode.hidden = !parts.dirty;
  document.title = `${frameTitle(app, title, dirty)} — EasyWAR`;
}

function openApp(id, card) {
  const app = appById(id);
  current = { app, dirty: false, card };
  iconNode.replaceChildren(appIcon(document, app.id, 24));
  showTitle(app, '', false);
  frame.src = appPageUrl(id);
  home.hidden = true;
  view.hidden = false;
  back.focus();
}

function closeApp() {
  hideConfirm(false);
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
    else back.focus();
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

window.EW_WORKSPACE = Object.freeze({ requestClose: requestCloseApp, apps: OFFICE_APPS.map(app => app.id) });
renderSections();
