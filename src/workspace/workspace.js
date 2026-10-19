// Оболонка модуля «Робоче середовище»: розділ «Офіс» з картками застосунків і перегляд одного
// застосунку в iframe (app.html?app=<id>). Незбережені зміни застосунок повідомляє через
// postMessage; перед закриттям оболонка просить підтвердження у власній смузі, без системних
// діалогів. Лаунчер (workspace-launcher.js) питає дозволу закритися через EW_WORKSPACE.requestClose().
import { OFFICE_APPS, WORKSPACE_SECTIONS, appById, appPageUrl, frameTitle, parseFrameMessage } from './workspace-core.js';
import { isConnected } from './workspace-registry.js';

const home = document.getElementById('ws-home');
const sections = document.getElementById('ws-sections');
const view = document.getElementById('ws-app');
const frame = document.getElementById('ws-frame');
const titleNode = document.getElementById('ws-app-title');
const back = document.getElementById('ws-back');
const confirmBar = document.getElementById('ws-confirm');

let current = null; // { app, dirty, card }
let pendingConfirm = null; // resolve смуги підтвердження
let pendingClose = null;   // проміс, який чекає на відповідь

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
      card.addEventListener('click', () => openApp(app.id, card));
      cards.append(card);
    }
    block.append(heading, cards);
    sections.append(block);
  }
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
renderSections();
