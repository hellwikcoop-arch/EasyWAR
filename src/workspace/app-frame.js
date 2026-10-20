// Сторінка одного застосунку (app.html?app=<id>): завантажує <id>/app.js і викликає
// mount(container, host). Поки застосунок запускається — екран «Підготовка редактора…» з
// етапами; якщо запуск не вдався — помилка з «Спробувати ще раз»; якщо застосунок ще не
// підключено — заглушка «у розробці». Зміни заголовка й позначки незбережених змін ідуть до
// оболонки через postMessage.
import { LOADING_STEPS, appFromSearch, branchFromSearch, entryError, frameMessage, graphicsProblem, normalizeMounted } from './workspace-core.js';
import { appIcon, element as make } from './workspace-dom.js';
import { browserFallback, createHost, findInvoke } from './workspace-host.js';
import { entryLoader } from './workspace-registry.js';

document.documentElement.dataset.branch = branchFromSearch(location.search);

const container = document.getElementById('ws-container');
const stateArea = document.getElementById('ws-state');

const element = (tag, className, text) => make(document, tag, className, text);

/** Чи є в цьому вікні WebGL2 або WebGPU (редактори «Офісу» без них не запускаються). */
function graphicsSupport() {
  let webgl2 = false;
  try { webgl2 = Boolean(document.createElement('canvas').getContext('webgl2')); } catch { webgl2 = false; }
  return { webgl2, webgpu: Boolean(navigator.gpu) };
}

function backToOffice() {
  try {
    window.parent?.EW_WORKSPACE?.requestClose?.();
  } catch (error) {
    console.error(error);
  }
}

function showState(panel) {
  stateArea.replaceChildren(panel);
  stateArea.hidden = false;
}

function hideState() {
  stateArea.hidden = true;
  stateArea.replaceChildren();
}

function loadingPanel() {
  const panel = element('div', 'ws-state-panel');
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  const spinner = element('span', 'ws-spinner');
  spinner.setAttribute('aria-hidden', 'true');
  const steps = element('ol', 'ws-loading-steps');
  steps.setAttribute('aria-label', 'Етапи запуску');
  const items = LOADING_STEPS.map(text => element('li', 'ws-step', text));
  steps.append(...items);
  panel.append(
    spinner,
    element('p', 'ws-state-eyebrow', 'ВІДКРИТТЯ ЗАСТОСУНКУ'),
    element('h1', '', 'Підготовка редактора…'),
    element('p', 'ws-state-description', 'Це може тривати кілька секунд.'),
    steps,
  );
  return {
    panel,
    step(index) {
      items.forEach((item, position) => {
        item.className = position < index ? 'ws-step done' : position === index ? 'ws-step current' : 'ws-step';
        if (position === index) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
    },
  };
}

function errorPanel(app, text) {
  const panel = element('div', 'ws-state-panel ws-error-panel');
  panel.setAttribute('role', 'alert');
  const symbol = element('span', 'ws-state-symbol ws-error-symbol', '!');
  symbol.setAttribute('aria-hidden', 'true');
  const retry = element('button', 'ws-button ws-button-primary ws-state-button', 'Спробувати ще раз');
  retry.type = 'button';
  retry.addEventListener('click', () => location.reload());
  panel.append(
    symbol,
    element('p', 'ws-state-eyebrow', 'ПОМИЛКА ЗАПУСКУ'),
    element('h1', '', app ? `Не вдалося запустити ${app.title}` : 'Не вдалося запустити застосунок'),
    element('p', 'ws-state-description', text),
    retry,
  );
  return panel;
}

function stubPanel(app, eyebrow, heading, text) {
  const panel = element('div', 'ws-state-panel');
  if (app) {
    const symbol = element('span', 'ws-state-symbol ws-underdev-symbol');
    symbol.setAttribute('aria-hidden', 'true');
    symbol.append(appIcon(document, app.id, 48));
    panel.append(symbol);
  }
  const back = element('button', 'ws-button ws-state-button', '← Розділи');
  back.type = 'button';
  back.addEventListener('click', backToOffice);
  panel.append(element('p', 'ws-state-eyebrow', eyebrow), element('h1', '', heading), element('p', 'ws-state-description', text), back);
  return panel;
}

const RETRY_TEXT = 'Редактор не відкрився. Спробуйте ще раз. Якщо помилка повториться, поверніться до Офісу.';

async function start() {
  const app = appFromSearch(location.search);
  if (!app) {
    showState(stubPanel(null, 'НЕ ЗНАЙДЕНО', 'Застосунок не знайдено', 'Поверніться до робочого середовища й оберіть застосунок ще раз.'));
    return;
  }
  document.title = `${app.title} — EasyWAR`;
  const load = entryLoader(app.id);
  if (!load) {
    showState(stubPanel(app, 'У РОЗРОБЦІ', `${app.title} поки недоступний`, 'Редактор ще не підключено. Поверніться до Офісу та оберіть інший застосунок.'));
    return;
  }
  const graphics = graphicsProblem(graphicsSupport());
  if (graphics) {
    showState(errorPanel(app, graphics));
    return;
  }
  const loading = loadingPanel();
  loading.step(0);
  showState(loading.panel);
  let mounted = null;
  try {
    const entry = await load();
    const problem = entryError(entry);
    if (problem) {
      showState(errorPanel(app, problem));
      return;
    }
    loading.step(1);
    const host = createHost({
      appEntry: app,
      invoke: findInvoke(window),
      browser: browserFallback(document),
      rootUrl: new URL('../', location.href).href,
      onState: state => {
        if (window.parent !== window) window.parent.postMessage(frameMessage(app.id, state), location.origin);
      },
    });
    mounted = normalizeMounted(await entry.mount(container, host));
    // Оболонка питає перед закриттям, чи є незбережені зміни (крім host.setDirty) і повертає
    // фокус у застосунок після «Залишитися» (iframe редактора, якщо застосунок не взяв фокус сам).
    window.EW_WORKSPACE_APP = Object.freeze({
      isDirty: () => mounted.isDirty(),
      focus: () => {
        if (mounted.focus()) return;
        const frame = container.querySelector('iframe');
        try { frame?.contentWindow?.focus(); } catch { /* сторінку ще не завантажено */ }
        (frame ?? container).focus();
      },
    });
    loading.step(2);
    hideState();
  } catch (error) {
    console.error(error);
    container.replaceChildren();
    showState(errorPanel(app, RETRY_TEXT));
    return;
  }
  window.addEventListener('pagehide', () => {
    try { mounted.unmount(); } catch (error) { console.error(error); }
  }, { once: true });
}

start();
