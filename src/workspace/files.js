// Вкладка «Файли» оболонки «Робочого середовища» (головне вікно настільного застосунку):
// локальне сховище файлів будь-якого типу — зашифровані блоби в теці на диску
// (workspace_files.rs), окремій для профілю, ключем бібліотеки профілю. Тому вкладка працює
// лише з розблокованою бібліотекою: інакше показує пояснення й кнопку на вкладку «Бібліотека»
// (стан — library_status і подія `library-state`). Список із пошуком за назвою, «Додати
// файли…» (системне вікно, зашифрована копія в теку), «Відкрити» у вікні редактора для
// форматів застосунків модуля, «Зберегти копію…» (розшифрована) на диск і «Видалити» з
// підтвердженням. Усі виклики Tauri — через filesApi (files-core.js); помилка «бібліотека
// заблокована…» повертає на екран пояснення. На `office-editor-closed`, повернення фокусу й
// видимості список перечитується (файл могли змінити в редакторі). DOM лише через
// createElement і textContent.
import { findInvoke, listenTauriEvent } from './workspace-host.js';
import { addSummary, appName, errorText, filesApi, filterFiles, isLockedError, metaLine, sortFiles, storeScreen } from './files-core.js';

const BUSY_TEXT = 'Зачекайте: попередня дія ще виконується.';
const SEARCH_DELAY_MS = 150;
const FOCUS_REFRESH_MS = 2000;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

const button = (text, onclick, extra = {}) => el('button', { type: 'button', class: 'ws-btn', text, onclick, ...extra });
const localOffset = () => -new Date().getTimezoneOffset();

/**
 * Монтує вкладку в `root`. `invoke` — Tauri invoke головного вікна; `listen(event, handler)` —
 * підписка на події Rust. → { activate() } — перечитати список, коли вкладку відкрито.
 */
export function mountFiles(root, { invoke = findInvoke(window), listen = listenTauriEvent } = {}) {
  const api = filesApi(invoke);
  const state = {
    root: '',
    items: [],
    query: '',
    confirmDelete: null, // id файлу, видалення якого чекає підтвердження
    loaded: false,
    screen: 'unknown', // екран за станом бібліотеки (storeScreen)
  };
  let busy = false;
  let refreshQueued = false;
  let lastRefresh = 0;
  let searchTimer = null;

  const message = el('p', { class: 'ws-lib-message', role: 'status', 'aria-live': 'polite' });
  const say = (text, tone = '') => {
    message.textContent = text || '';
    message.dataset.tone = tone;
  };

  const search = el('input', {
    type: 'search', class: 'ws-input', placeholder: 'Пошук за назвою', 'aria-label': 'Пошук файлів за назвою', autocomplete: 'off',
  });
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = search.value; renderList(); }, SEARCH_DELAY_MS);
  });

  const pathNote = el('p', { class: 'ws-lib-meta ws-files-path' });
  const list = el('div', { class: 'ws-lib-list', 'aria-label': 'Файли сховища' });
  const toolbar = el('div', { class: 'ws-lib-toolbar', role: 'toolbar', 'aria-label': 'Дії сховища файлів' },
    button('Додати файли…', () => addFiles(), { class: 'ws-btn ws-primary' }),
    button('Оновити список', () => refresh({ force: true })));
  const unlocked = el('div', { class: 'ws-files-unlocked' }, toolbar, el('div', { class: 'ws-lib-searchbar' }, search), message, list);
  const gateText = el('p', { class: 'ws-lib-notice' });
  const gate = el('div', { class: 'ws-files-gate', hidden: true }, gateText,
    el('div', { class: 'ws-lib-actions' }, button('Перейти до бібліотеки', () => document.getElementById('ws-tab-library')?.click())));

  root.replaceChildren(el('div', { class: 'ws-lib ws-files' },
    el('div', { class: 'ws-lib-card' },
      el('h2', { class: 'ws-lib-title', text: 'Файли' }),
      el('p', { text: 'Локальне сховище файлів будь-якого типу для цього профілю: тека на цьому комп’ютері, без хмари. Файли в ній зашифровані ключем бібліотеки профілю й відкриваються лише з розблокованою бібліотекою. Таблиці, документи й презентації відкриваються в застосунках «Робочого середовища»; решту файлів можна зберегти копією.' }),
      pathNote, gate),
    unlocked));

  function showScreen(status) {
    const { screen, text } = storeScreen(status);
    state.screen = screen;
    gateText.textContent = text;
    gate.hidden = screen === 'unlocked';
    unlocked.hidden = screen !== 'unlocked';
    if (screen !== 'unlocked') {
      state.items = [];
      state.loaded = false;
      state.confirmDelete = null;
      list.replaceChildren();
      say('');
    }
  }

  function onLocked() {
    showScreen({ state: 'locked' });
    refreshStatus();
  }

  async function refreshStatus() {
    let status = null;
    try {
      status = await api.status();
    } catch (error) {
      say(`Не вдалося прочитати стан бібліотеки: ${errorText(error)}`, 'error');
    }
    showScreen(status);
    return state.screen === 'unlocked';
  }

  async function run(action, pendingText = '') {
    if (busy) {
      say(BUSY_TEXT);
      return undefined;
    }
    busy = true;
    root.setAttribute('aria-busy', 'true');
    if (pendingText) say(pendingText);
    try {
      return await action();
    } catch (error) {
      if (isLockedError(error)) onLocked();
      else say(`Не вдалося: ${errorText(error)}`, 'error');
      return undefined;
    } finally {
      busy = false;
      root.removeAttribute('aria-busy');
      if (refreshQueued) {
        refreshQueued = false;
        queueMicrotask(() => refresh({ force: true }));
      }
    }
  }

  async function load() {
    const listing = await api.list();
    state.root = listing?.root ?? '';
    state.items = sortFiles(listing?.items);
    state.loaded = true;
    if (state.confirmDelete && !state.items.some(file => file.id === state.confirmDelete)) state.confirmDelete = null;
    pathNote.textContent = state.root ? `Тека: ${state.root}` : '';
    renderList();
  }

  async function refresh({ force = false } = {}) {
    if (busy) {
      refreshQueued = true;
      return;
    }
    const now = Date.now();
    if (!force && now - lastRefresh < FOCUS_REFRESH_MS) return;
    lastRefresh = now;
    if (!(await refreshStatus())) return;
    try {
      await load();
    } catch (error) {
      if (isLockedError(error)) onLocked();
      else say(`Не вдалося прочитати сховище: ${errorText(error)}`, 'error');
    }
  }

  function addFiles() {
    run(async () => {
      const result = await api.add();
      const summary = addSummary(result);
      await load();
      say(summary.text, summary.tone);
    }, 'Оберіть файли…');
  }

  function openFile(file) {
    run(async () => {
      await api.open(file.id);
      say(`«${file.name}» відкрито у вікні редактора.`, 'ok');
    });
  }

  function exportFile(file) {
    run(async () => {
      const path = await api.exportCopy(file.id);
      say(path ? `Копію збережено: ${path}` : '', path ? 'ok' : '');
    });
  }

  function deleteFile(file) {
    run(async () => {
      await api.remove(file.id);
      state.confirmDelete = null;
      await load();
      say(`«${file.name}» видалено.`, 'ok');
    });
  }

  function deleteConfirm(file) {
    return el('div', { class: 'ws-lib-confirm', role: 'alertdialog', 'aria-label': 'Видалити файл' },
      el('span', { text: `Видалити «${file.name}» зі сховища назавжди? Кошика немає.` }),
      button('Скасувати', () => { state.confirmDelete = null; renderList(); }),
      button('Видалити', () => deleteFile(file), { class: 'ws-btn ws-danger' }));
  }

  function damagedCard(file) {
    return el('article', { class: 'ws-lib-item ws-files-item' },
      el('div', { class: 'ws-lib-item-head' },
        el('h3', { class: 'ws-lib-name', text: file.name }),
        el('span', { class: 'ws-lib-badge', 'data-tone': 'danger', text: 'пошкоджено' })),
      el('p', { class: 'ws-lib-meta', text: metaLine(file, { offsetMinutes: localOffset() }) }),
      state.confirmDelete === file.id ? deleteConfirm(file) : el('div', { class: 'ws-lib-actions' },
        button('Видалити', () => { state.confirmDelete = file.id; renderList(); })));
  }

  function fileCard(file) {
    if (file.damaged) return damagedCard(file);
    const app = appName(file.app);
    const actions = el('div', { class: 'ws-lib-actions' },
      app ? button(`Відкрити в ${app}`, () => openFile(file)) : null,
      button('Зберегти копію…', () => exportFile(file)),
      button('Видалити', () => { state.confirmDelete = file.id; renderList(); }));
    return el('article', { class: 'ws-lib-item ws-files-item' },
      el('div', { class: 'ws-lib-item-head' },
        el('h3', { class: 'ws-lib-name', text: file.name }),
        app ? null : el('span', { class: 'ws-lib-badge', text: 'без редактора' })),
      el('p', { class: 'ws-lib-meta', text: metaLine(file, { offsetMinutes: localOffset() }) }),
      state.confirmDelete === file.id ? deleteConfirm(file) : actions);
  }

  function renderList() {
    if (!state.loaded) return;
    const shown = filterFiles(state.items, state.query);
    if (!shown.length) {
      list.replaceChildren(el('p', { class: 'ws-lib-empty', text: state.items.length ? 'Нічого не знайдено.' : 'Сховище порожнє. Натисніть «Додати файли…».' }));
      return;
    }
    list.replaceChildren(...shown.map(fileCard));
  }

  listen('office-editor-closed', () => refresh({ force: true }));
  // Блокування (30 хвилин без дій, вихід із профілю) чи розблокування бібліотеки одразу змінює екран.
  listen('library-state', status => {
    showScreen(status ?? null);
    if (state.screen === 'unlocked' && !root.hidden) refresh({ force: true });
  });
  window.addEventListener('focus', () => { if (!root.hidden) refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !root.hidden) refresh(); });

  return Object.freeze({
    activate: () => refresh({ force: true }),
  });
}
