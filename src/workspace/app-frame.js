// Сторінка одного застосунку (app.html?app=<id>): завантажує <id>/app.js і викликає
// mount(container, host). Якщо застосунок ще не підключено — показує заглушку «у розробці».
// Зміни заголовка й позначки незбережених змін іде до оболонки через postMessage.
import { appFromSearch, entryError, frameMessage, normalizeMounted } from './workspace-core.js';
import { browserFallback, createHost, findInvoke } from './workspace-host.js';
import { entryLoader } from './workspace-registry.js';

const container = document.getElementById('ws-container');

function notice(app, heading, text) {
  const box = document.createElement('section');
  box.className = 'ws-stub';
  const kind = document.createElement('span');
  kind.className = 'ws-kind';
  kind.textContent = app ? `${app.kind} · ${app.title}` : 'Робоче середовище';
  const title = document.createElement('h1');
  title.textContent = heading;
  const body = document.createElement('p');
  body.textContent = text;
  box.append(kind, title, body);
  container.replaceChildren(box);
}

async function start() {
  const app = appFromSearch(location.search);
  if (!app) {
    notice(null, 'Застосунок не знайдено', 'Поверніться до робочого середовища й оберіть застосунок ще раз.');
    return;
  }
  document.title = `${app.title} — EasyWAR`;
  const load = entryLoader(app.id);
  if (!load) {
    notice(app, `${app.title} у розробці`, 'Застосунок ще не підключено до EasyWAR. Щойно його буде готово, він відкриватиметься тут, без інтернету, а файли відкриватимуться й зберігатимуться через EasyWAR.');
    return;
  }
  let mounted = null;
  try {
    const entry = await load();
    const problem = entryError(entry);
    if (problem) {
      notice(app, `${app.title} не запустився`, problem);
      return;
    }
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
    // Оболонка питає перед закриттям, чи є незбережені зміни (крім host.setDirty).
    window.EW_WORKSPACE_APP = Object.freeze({ isDirty: () => mounted.isDirty() });
  } catch (error) {
    console.error(error);
    notice(app, `${app.title} не запустився`, 'Під час запуску застосунку сталася помилка. Закрийте його й спробуйте ще раз.');
    return;
  }
  window.addEventListener('pagehide', () => {
    try { mounted.unmount(); } catch (error) { console.error(error); }
  }, { once: true });
}

start();
