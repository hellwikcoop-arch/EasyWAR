// Вкладка «Бібліотека» оболонки «Робочого середовища» (головне вікно настільного застосунку):
// захищене сховище документів профілю. Екрани за станом library_status: створити бібліотеку,
// розблокувати паролем профілю (або кодом відновлення), список документів з пошуком, історія
// версій, документи з шаблонів, пов'язані документи й «Застарілі документи». Документи
// зашифровано в базі EasyWAR; відкриваються в окремому вікні редактора (library_open_in_editor).
// Усі виклики Tauri — через libraryApi (library-ui-core.js, точні назви команд контракту);
// будь-яка помилка «бібліотека заблокована…» повертає на екран розблокування (30 хвилин без
// дій, вихід із профілю). DOM лише через createElement і textContent.
import JSZip from 'jszip';
import { findInvoke } from './workspace-host.js';
import { MAX_ITEM_NAME_CHARS, formatDateTime, isLockedError, regenerationPlan, sortItems, validateItemName } from './library-core.js';
import { SOURCE_KINDS } from './field-dictionary-core.js';
import {
  BRANCHES, PASSWORD_MAX, defaultDocumentName, errorText, fieldReport, generateDocument, itemBadges, kindLine, libraryApi,
  libraryScreen, linkDescription, linkStatusMap, newPasswordProblem, openedInEditorText, passwordProblem, readTemplateFields,
  recoveryCodeProblem, regenerateAll, regenerateItem, searchRows, skipReasonText, sourceParams, staleCount, tableItems,
  templateItems, versionLabel,
} from './library-ui-core.js';

const LOCK_NOTICE = 'Бібліотеку заблоковано: 30 хвилин без дій, вихід із профілю або закриття «Робочого середовища». Розблокуйте її паролем профілю.';
const SEARCH_DELAY_MS = 250;

/** Елемент з атрибутами й дітьми; `text` — textContent, `on<подія>` — обробник. */
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
const field = (caption, control, hint) => el('label', { class: 'ws-lib-field' },
  el('span', { class: 'ws-lib-caption', text: caption }), control, hint ? el('small', { class: 'ws-lib-hint', text: hint }) : null);
const passwordInput = (label, autocomplete = 'current-password') => el('input', {
  type: 'password', autocomplete, maxLength: PASSWORD_MAX, 'aria-label': label, class: 'ws-input',
});
const localOffset = () => -new Date().getTimezoneOffset();

/**
 * Монтує вкладку в `root`. `invoke` — Tauri invoke головного вікна; `onBadge(count)` — кількість
 * пов'язаних документів на застарілих даних (позначка на вкладці). → { activate() } — оновити стан,
 * коли вкладку відкрито.
 */
export function mountLibrary(root, { invoke = findInvoke(window), onBadge = () => {} } = {}) {
  let relocking = null;
  const guarded = async (command, args) => {
    try {
      return await invoke(command, args);
    } catch (error) {
      if (isLockedError(error)) onLocked();
      throw error;
    }
  };
  const api = libraryApi(guarded);

  const state = {
    status: undefined, // undefined — ще не прочитано, null — не вдалося прочитати
    code: null, // { code, kind } — код відновлення, показується один раз
    recovering: false,
    lockedNotice: '',
    items: [],
    statuses: [],
    links: new Map(),
    includeHidden: false,
    query: '',
    search: null,
    panel: 'list', // list | generate | stale | reissue
    report: null, // { title, lines, tone, actions }
    renaming: null,
    confirmUnlink: null,
    versions: new Map(), // itemId → LibraryVersion[] (відкрита історія)
    stale: null,
    gen: null,
  };
  let busy = false;
  let view = null; // постійні вузли розблокованого екрана (пошук не втрачає фокус)
  let searchTimer = null;
  let searchSeq = 0;

  const message = el('p', { class: 'ws-lib-message', role: 'status', 'aria-live': 'polite' });
  function say(text, tone = '') {
    message.textContent = text || '';
    message.dataset.tone = tone;
  }

  function onLocked() {
    if (relocking) return;
    state.lockedNotice = LOCK_NOTICE;
    resetUnlocked();
    relocking = refreshStatus().finally(() => { relocking = null; });
  }

  function resetUnlocked() {
    state.items = [];
    state.statuses = [];
    state.links = new Map();
    state.search = null;
    state.query = '';
    state.panel = 'list';
    state.report = null;
    state.renaming = null;
    state.confirmUnlink = null;
    state.versions = new Map();
    state.stale = null;
    state.gen = null;
    view = null;
    onBadge(0);
  }

  /** Дія з позначкою зайнятості; помилку показує в рядку стану (крім блокування — там свій екран). */
  async function run(action, pendingText = '') {
    if (busy) return undefined;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    if (pendingText) say(pendingText);
    try {
      return await action();
    } catch (error) {
      if (!isLockedError(error)) say(`Не вдалося: ${errorText(error)}`, 'error');
      return undefined;
    } finally {
      busy = false;
      root.removeAttribute('aria-busy');
    }
  }

  async function refreshStatus() {
    try {
      state.status = await api.status();
    } catch (error) {
      state.status = null;
      say(`Не вдалося прочитати стан бібліотеки: ${errorText(error)}`, 'error');
    }
    if (libraryScreen(state.status) === 'unlocked') {
      try {
        await loadItems();
      } catch (error) {
        if (!isLockedError(error)) say(`Не вдалося завантажити документи: ${errorText(error)}`, 'error');
      }
    } else {
      resetUnlocked();
    }
    render();
  }

  async function loadItems() {
    const [items, statuses] = await Promise.all([api.list(state.includeHidden), api.linkStatuses()]);
    state.items = sortItems(items);
    state.statuses = Array.isArray(statuses) ? statuses : [];
    state.links = linkStatusMap(state.statuses);
    updateBadge(staleCount(state.statuses));
    if (state.query.trim()) await runSearch();
  }

  function updateBadge(count) {
    onBadge(count);
    if (view) {
      view.staleBadge.textContent = count ? String(count) : '';
      view.staleBadge.hidden = !count;
    }
  }

  function render() {
    const screen = state.code ? 'code' : state.status === undefined ? 'loading' : libraryScreen(state.status);
    const builders = {
      loading: () => card('Бібліотека', el('p', { class: 'ws-lib-hint', text: 'Перевірка стану бібліотеки…' })),
      code: codeScreen,
      no_profile: noProfileScreen,
      no_password: noPasswordScreen,
      none: createScreen,
      locked: lockedScreen,
      unlocked: unlockedScreen,
      unknown: unknownScreen,
    };
    root.replaceChildren(message, builders[screen]());
  }

  // ---------------------------------------------------------------------------------------
  // Екрани без розблокованої бібліотеки

  function card(title, ...children) {
    return el('section', { class: 'ws-lib-card' }, el('h2', { class: 'ws-lib-title', text: title }), ...children);
  }

  const refreshButton = () => button('Оновити стан', () => run(refreshStatus));

  function unknownScreen() {
    return card('Бібліотека', el('p', { text: 'Стан бібліотеки невідомий. Спробуйте оновити його.' }), refreshButton());
  }

  function noProfileScreen() {
    return card('Бібліотека',
      el('p', { text: 'Спершу увійдіть у локальний профіль EasyWAR. Бібліотека належить профілю й відкривається його паролем.' }),
      refreshButton());
  }

  function noPasswordScreen() {
    return card('Бібліотека',
      el('p', { text: 'Бібліотека шифрується паролем профілю, а в цього профілю пароля немає.' }),
      el('p', { text: 'Встановіть пароль: «Профіль» на стартовому екрані → «Встановити пароль…», — і поверніться сюди.' }),
      refreshButton());
  }

  function createScreen() {
    const password = passwordInput('Пароль профілю');
    const withRecovery = el('input', { type: 'checkbox', checked: true });
    const form = el('form', { class: 'ws-lib-form' },
      el('p', { text: 'Бібліотека — захищене сховище документів профілю на цьому пристрої: таблиці, документи, презентації й шаблони зберігаються в базі EasyWAR лише зашифрованими. Відкривається тим самим паролем, що й профіль.' }),
      field('Пароль профілю', password),
      el('label', { class: 'ws-lib-check' }, withRecovery, el('span', { text: 'Створити код відновлення' })),
      el('p', { class: 'ws-lib-hint', text: 'Код допоможе, якщо пароль забудете: з ним можна задати новий пароль. Без пароля й без коду документи бібліотеки не відновити.' }),
      el('div', { class: 'ws-lib-actions' }, el('button', { type: 'submit', class: 'ws-btn ws-primary', text: 'Створити бібліотеку' })));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const problem = passwordProblem(password.value);
      if (problem) return say(problem, 'error');
      const value = password.value;
      password.value = '';
      run(async () => {
        const created = await api.create(value, withRecovery.checked);
        state.status = created?.status ?? null;
        state.lockedNotice = '';
        say('Бібліотеку створено й розблоковано.', 'ok');
        if (created?.recoveryCode) state.code = { code: created.recoveryCode, kind: 'created' };
        if (libraryScreen(state.status) === 'unlocked') await loadItems();
        render();
      }, 'Створення бібліотеки…');
    });
    return card('Створити бібліотеку', form);
  }

  function lockedScreen() {
    const password = passwordInput('Пароль профілю');
    const unlock = el('form', { class: 'ws-lib-form' },
      state.lockedNotice ? el('p', { class: 'ws-lib-notice', text: state.lockedNotice }) : el('p', { text: 'Бібліотеку заблоковано. Введіть пароль профілю.' }),
      field('Пароль профілю', password),
      el('div', { class: 'ws-lib-actions' },
        el('button', { type: 'submit', class: 'ws-btn ws-primary', text: 'Розблокувати' }),
        button('Забули пароль?', () => { state.recovering = !state.recovering; render(); }, { 'aria-expanded': String(state.recovering) })));
    unlock.addEventListener('submit', event => {
      event.preventDefault();
      const problem = passwordProblem(password.value);
      if (problem) return say(problem, 'error');
      const value = password.value;
      password.value = '';
      run(async () => {
        state.status = await api.unlock(value);
        state.lockedNotice = '';
        state.recovering = false;
        say('Бібліотеку розблоковано.', 'ok');
        if (libraryScreen(state.status) === 'unlocked') await loadItems();
        render();
      }, 'Розблокування…');
    });
    const parts = [unlock];
    if (state.recovering) parts.push(recoveryForm());
    queueMicrotask(() => password.focus());
    return card('Бібліотека заблокована', ...parts);
  }

  function recoveryForm() {
    if (!state.status?.hasRecovery) {
      return el('div', { class: 'ws-lib-form' },
        el('p', { text: 'Для цієї бібліотеки коду відновлення не створювали. Без пароля профілю її документи не відкрити.' }),
        el('p', { class: 'ws-lib-hint', text: 'Можна лише видалити профіль разом з бібліотекою («Профіль» → «Видалити»): документи буде знищено.' }));
    }
    const code = el('input', { type: 'text', class: 'ws-input ws-mono', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Код відновлення' });
    const first = passwordInput('Новий пароль профілю', 'new-password');
    const second = passwordInput('Повторіть новий пароль', 'new-password');
    const form = el('form', { class: 'ws-lib-form' },
      el('h3', { class: 'ws-lib-subtitle', text: 'Відновлення кодом' }),
      el('p', { text: 'Код відновлення задає новий пароль профілю: ним ви й надалі входите в профіль і відкриваєте бібліотеку. Старий код після цього перестає діяти — ви отримаєте новий.' }),
      field('Код відновлення', code),
      field('Новий пароль (від 6 символів)', first),
      field('Повторіть новий пароль', second),
      el('div', { class: 'ws-lib-actions' }, el('button', { type: 'submit', class: 'ws-btn ws-primary', text: 'Задати новий пароль і розблокувати' })));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const problem = recoveryCodeProblem(code.value) || newPasswordProblem(first.value, second.value);
      if (problem) return say(problem, 'error');
      const values = [code.value.trim(), first.value];
      first.value = '';
      second.value = '';
      run(async () => {
        const recovered = await api.recover(values[0], values[1]);
        code.value = '';
        state.status = recovered?.status ?? null;
        state.recovering = false;
        state.lockedNotice = '';
        say('Новий пароль профілю задано, бібліотеку розблоковано.', 'ok');
        if (recovered?.recoveryCode) state.code = { code: recovered.recoveryCode, kind: 'recovered' };
        if (libraryScreen(state.status) === 'unlocked') await loadItems();
        render();
      }, 'Відновлення доступу…');
    });
    return form;
  }

  function codeScreen() {
    const { code, kind } = state.code;
    const titles = {
      created: 'Код відновлення бібліотеки',
      recovered: 'Новий код відновлення',
      reissued: 'Новий код відновлення',
    };
    const codeNode = el('p', { class: 'ws-lib-code', text: code, tabIndex: 0, 'aria-label': 'Код відновлення' });
    const selectCode = () => {
      const range = document.createRange();
      range.selectNodeContents(codeNode);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    codeNode.addEventListener('click', selectCode);
    const canCopy = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
    const copy = canCopy ? button('Скопіювати', async () => {
      try {
        await navigator.clipboard.writeText(code);
        say('Код скопійовано. Вставте його туди, де зберігаєте, і очистьте буфер обміну.', 'ok');
      } catch {
        selectCode();
        say('Не вдалося скопіювати: код виділено, скопіюйте його вручну (Ctrl+C або ⌘C).', 'error');
      }
    }) : null;
    const done = button('Я записав код — далі', () => {
      state.code = null;
      say('');
      render();
    }, { class: 'ws-btn ws-primary' });
    queueMicrotask(() => codeNode.focus());
    return card(titles[kind] ?? titles.created,
      el('p', { class: 'ws-lib-warning', text: 'Код показується лише зараз: EasyWAR його не зберігає й більше не покаже.' }),
      codeNode,
      el('ul', { class: 'ws-lib-lines' },
        el('li', { text: 'Запишіть код на папері й тримайте окремо від цього комп’ютера.' }),
        el('li', { text: 'Хто має код, може задати новий пароль профілю й відкрити бібліотеку.' }),
        el('li', { text: 'Якщо втратите і пароль, і код, документи бібліотеки не відновити.' }),
        kind === 'created' ? null : el('li', { text: 'Попередній код більше не діє.' })),
      canCopy ? null : el('p', { class: 'ws-lib-hint', text: 'Виділіть код і скопіюйте вручну (Ctrl+C або ⌘C).' }),
      el('div', { class: 'ws-lib-actions' }, copy, done));
  }

  // ---------------------------------------------------------------------------------------
  // Розблокована бібліотека

  function unlockedScreen() {
    if (!view) view = createUnlockedView();
    renderContent();
    return view.node;
  }

  function createUnlockedView() {
    const staleBadge = el('span', { class: 'ws-badge', hidden: true });
    const toolbar = el('div', { class: 'ws-lib-toolbar', role: 'toolbar', 'aria-label': 'Дії бібліотеки' },
      button('Імпортувати…', () => importFile(false)),
      button('Імпортувати шаблон…', () => importFile(true)),
      button('Створити з шаблону…', openGenerate),
      el('button', { type: 'button', class: 'ws-btn', onclick: openStale }, 'Застарілі документи', staleBadge),
      button('Зберегти архів…', exportArchive),
      button('Новий код відновлення', () => { state.panel = 'reissue'; renderContent(); }),
      button('Заблокувати', lock, { class: 'ws-btn ws-danger' }));
    const search = el('input', {
      type: 'search', class: 'ws-input', placeholder: 'Пошук за назвою й вмістом', 'aria-label': 'Пошук у бібліотеці', maxLength: 200,
    });
    search.value = state.query;
    search.addEventListener('input', () => {
      state.query = search.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS);
    });
    const hidden = el('input', { type: 'checkbox', checked: state.includeHidden });
    hidden.addEventListener('change', () => {
      state.includeHidden = hidden.checked;
      run(async () => { await loadItems(); renderContent(); });
    });
    const content = el('div', { class: 'ws-lib-content' });
    const node = el('div', { class: 'ws-lib' },
      toolbar,
      el('div', { class: 'ws-lib-searchbar' }, search,
        el('label', { class: 'ws-lib-check' }, hidden, el('span', { text: 'Показати приховані' }))),
      content);
    const created = { node, content, staleBadge };
    const count = staleCount(state.statuses);
    staleBadge.textContent = count ? String(count) : '';
    staleBadge.hidden = !count;
    return created;
  }

  async function runSearch() {
    const query = state.query.trim();
    const seq = ++searchSeq;
    if (!query) {
      state.search = null;
      renderContent();
      return;
    }
    try {
      const response = await api.search(query);
      if (seq !== searchSeq) return;
      state.search = response;
    } catch (error) {
      if (!isLockedError(error)) say(`Пошук не вдався: ${errorText(error)}`, 'error');
      return;
    }
    renderContent();
  }

  function renderContent() {
    if (!view) return;
    const panels = { list: listPanel, generate: generatePanel, stale: stalePanel, reissue: reissuePanel };
    view.content.replaceChildren(...[state.report ? reportNode() : null, (panels[state.panel] ?? listPanel)()].filter(Boolean));
  }

  function reportNode() {
    const { title, lines = [], tone = '', actions = [] } = state.report;
    return el('section', { class: 'ws-lib-report', 'data-tone': tone, role: 'status' },
      el('h3', { class: 'ws-lib-subtitle', text: title }),
      lines.length ? el('ul', { class: 'ws-lib-lines' }, lines.map(line => el('li', { text: line }))) : null,
      el('div', { class: 'ws-lib-actions' },
        actions.map(action => button(action.label, action.run)),
        button('Закрити', () => { state.report = null; renderContent(); })));
  }

  function generationLines(result) {
    const lines = [];
    if (result.missing?.length) lines.push(`Незаповнені поля (у документі порожньо): ${result.missing.join(', ')}.`);
    for (const warning of result.warnings ?? []) lines.push(`Попередження: ${warning}`);
    return lines;
  }

  // Список документів ---------------------------------------------------------------------

  function listPanel() {
    const damaged = Array.isArray(state.status?.damaged) ? state.status.damaged : [];
    const searching = Boolean(state.query.trim() && state.search);
    const rows = searching ? searchRows(state.items, state.search) : state.items.map(item => ({ item, snippet: null }));
    const wrap = el('div', { class: 'ws-lib-list' });
    if (searching && !state.search.indexReady) wrap.append(el('p', { class: 'ws-lib-hint', text: 'Індекс будується — пошук лише за назвами' }));
    if (!rows.length) {
      wrap.append(el('p', { class: 'ws-lib-empty', text: searching
        ? 'Нічого не знайдено.'
        : 'У бібліотеці ще немає документів. «Імпортувати…» додає сюди зашифровану копію файла з диска; сам файл не змінюється.' }));
      return wrap;
    }
    for (const row of rows) wrap.append(itemNode(row.item, row.snippet, damaged));
    return wrap;
  }

  function itemNode(item, snippet, damaged) {
    const isDamaged = damaged.includes(item.id);
    const link = state.links.get(item.id) ?? null;
    const head = state.renaming === item.id
      ? renameForm(item)
      : el('h3', { class: 'ws-lib-name', text: item.name });
    const badges = itemBadges(item, { damaged, link }).map(badge => el('span', { class: 'ws-lib-badge', 'data-tone': badge.tone, text: badge.text }));
    const actions = el('div', { class: 'ws-lib-actions' },
      button('Відкрити', () => openVersion(item, item.currentVersionId), { disabled: isDamaged || !item.currentVersionId }),
      button(state.versions.has(item.id) ? 'Сховати історію' : 'Історія версій', () => toggleVersions(item), {
        'aria-expanded': String(state.versions.has(item.id)),
      }),
      button('Перейменувати', () => { state.renaming = item.id; renderContent(); }),
      button(item.hidden ? 'Показати' : 'Сховати', () => setHidden(item)),
      button('Зберегти копію…', () => exportCopy(item.currentVersionId), { disabled: isDamaged || !item.currentVersionId }),
      item.link ? button('Оновити з джерела', () => regenerate(item)) : null,
      item.link ? button('Відв’язати', () => { state.confirmUnlink = item.id; renderContent(); }) : null);
    return el('article', { class: 'ws-lib-item' },
      el('div', { class: 'ws-lib-item-head' }, head, el('span', { class: 'ws-lib-kind', text: kindLine(item) }), badges),
      el('p', { class: 'ws-lib-meta', text: `Змінено ${formatDateTime(item.updatedAt, { offsetMinutes: localOffset() })} · версій: ${item.versionCount ?? 0}` }),
      item.link ? el('p', { class: 'ws-lib-meta', text: `Джерело: ${linkDescription(item, { items: state.items })}${link?.status === 'source_error' && link.detail ? ` (${link.detail})` : ''}` }) : null,
      snippet ? el('p', { class: 'ws-lib-snippet', text: snippet }) : null,
      state.confirmUnlink === item.id ? unlinkConfirm(item) : actions,
      state.versions.has(item.id) ? versionsNode(item) : null);
  }

  function renameForm(item) {
    const input = el('input', { type: 'text', class: 'ws-input', value: item.name, maxLength: MAX_ITEM_NAME_CHARS * 2, 'aria-label': `Нова назва «${item.name}»` });
    const cancel = () => { state.renaming = null; renderContent(); };
    const form = el('form', { class: 'ws-lib-rename' }, input,
      el('button', { type: 'submit', class: 'ws-btn ws-primary', text: 'Зберегти' }),
      button('Скасувати', cancel));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const checked = validateItemName(input.value);
      if (!checked.ok) return say(checked.error, 'error');
      run(async () => {
        await api.rename(item.id, checked.name);
        state.renaming = null;
        say(`Перейменовано: «${checked.name}».`, 'ok');
        await loadItems();
        renderContent();
      });
    });
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } });
    queueMicrotask(() => { input.focus(); input.select(); });
    return form;
  }

  function unlinkConfirm(item) {
    return el('div', { class: 'ws-lib-confirm', role: 'alertdialog', 'aria-label': 'Відв’язати документ' },
      el('span', { text: `Відв’язати «${item.name}» від джерела? Версії лишаться, але «Оновити з джерела» більше не буде.` }),
      button('Скасувати', () => { state.confirmUnlink = null; renderContent(); }),
      button('Відв’язати', () => run(async () => {
        await api.unlink(item.id);
        state.confirmUnlink = null;
        say(`«${item.name}» відв’язано від джерела.`, 'ok');
        await loadItems();
        renderContent();
      }), { class: 'ws-btn ws-danger' }));
  }

  function versionsNode(item) {
    const versions = state.versions.get(item.id) ?? [];
    return el('ol', { class: 'ws-lib-versions', 'aria-label': `Історія версій «${item.name}»` },
      versions.map(version => el('li', { class: 'ws-lib-version' },
        el('span', { text: versionLabel(version, { offsetMinutes: localOffset() }) }),
        el('span', { class: 'ws-lib-actions' },
          button('Відкрити', () => openVersion(item, version.id)),
          version.current ? null : button('Зробити поточною', () => makeCurrent(item.id, version.id)),
          button('Зберегти копію…', () => exportCopy(version.id))))));
  }

  function toggleVersions(item) {
    if (state.versions.has(item.id)) {
      state.versions.delete(item.id);
      renderContent();
      return;
    }
    run(async () => {
      state.versions.set(item.id, await api.versions(item.id));
      renderContent();
    });
  }

  async function reloadVersions() {
    for (const itemId of state.versions.keys()) state.versions.set(itemId, await api.versions(itemId));
  }

  // Дії ---------------------------------------------------------------------------------

  function importFile(asTemplate) {
    run(async () => {
      const item = await api.importFile(asTemplate);
      if (!item) {
        say('Імпорт скасовано.');
        return;
      }
      const notes = [`Імпортовано «${item.name}» (${kindLine(item)}). Файл на диску не змінено.`];
      if (asTemplate && item.kind !== 'template') notes.push('Шаблоном може бути лише DOCX, PPTX чи XLSX — файл додано як звичайний документ.');
      if (item.profileTableCopy) notes.push('Це копія таблиці профілю: зміни в бібліотеці в саму таблицю не потрапляють.');
      say(notes.join(' '), 'ok');
      await loadItems();
      renderContent();
    }, 'Оберіть файл для імпорту…');
  }

  function openVersion(item, versionId) {
    if (!versionId) return;
    run(async () => {
      await api.openInEditor(versionId);
      say(openedInEditorText(item), 'ok');
    }, 'Відкриття у вікні редактора…');
  }

  function setHidden(item) {
    run(async () => {
      await api.setHidden(item.id, !item.hidden);
      say(item.hidden ? `«${item.name}» знову в списку.` : `«${item.name}» приховано: його видно з позначкою «Показати приховані».`, 'ok');
      await loadItems();
      renderContent();
    });
  }

  function exportCopy(versionId) {
    if (!versionId) return;
    run(async () => {
      const path = await api.exportCopy(versionId);
      say(path ? `Копію збережено: ${path}. Файл на диску не зашифровано.` : 'Збереження скасовано.', path ? 'ok' : '');
    }, 'Оберіть, куди зберегти копію…');
  }

  function exportArchive() {
    run(async () => {
      const path = await api.exportArchive();
      say(path
        ? `Архів збережено: ${path}. Документи в ньому не зашифровано — зберігайте архів як чутливий файл.`
        : 'Збереження архіву скасовано.', path ? 'ok' : '');
    }, 'Оберіть, куди зберегти архів…');
  }

  function makeCurrent(itemId, versionId) {
    run(async () => {
      await api.setCurrent(itemId, versionId);
      say('Поточну версію змінено.', 'ok');
      if (state.report?.actions?.length) state.report = { ...state.report, actions: [] };
      await loadItems();
      await reloadVersions();
      renderContent();
    });
  }

  function lock() {
    run(async () => {
      state.status = await api.lock();
      state.lockedNotice = 'Бібліотеку заблоковано.';
      resetUnlocked();
      say('');
      render();
    });
  }

  function regenerate(item) {
    run(async () => {
      const result = await regenerateItem({ api, JSZip, item, now: new Date() });
      const lines = generationLines(result);
      const actions = [];
      if (!result.madeCurrent && result.version) {
        lines.unshift(`Нову версію (№ ${result.version.versionNo}) з даних джерела збережено в історії версій. Поточною лишилася версія з ручними правками.`);
        actions.push({ label: 'Зробити поточною', run: () => makeCurrent(item.id, result.version.id) });
      }
      state.report = { title: `«${item.name}»: оновлено з джерела`, lines, tone: 'ok', actions };
      say('');
      await loadItems();
      await reloadVersions();
      renderContent();
    }, `Оновлення «${item.name}» з джерела…`);
  }

  // Новий код відновлення -------------------------------------------------------------------

  function reissuePanel() {
    const password = passwordInput('Пароль профілю');
    const form = el('form', { class: 'ws-lib-form' },
      el('h3', { class: 'ws-lib-subtitle', text: 'Новий код відновлення' }),
      el('p', { text: 'Новий код замінить попередній: старий перестане діяти. Підтвердьте паролем профілю.' }),
      field('Пароль профілю', password),
      el('div', { class: 'ws-lib-actions' },
        el('button', { type: 'submit', class: 'ws-btn ws-primary', text: 'Видати новий код' }),
        button('Скасувати', () => { state.panel = 'list'; renderContent(); })));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const problem = passwordProblem(password.value);
      if (problem) return say(problem, 'error');
      const value = password.value;
      password.value = '';
      run(async () => {
        const issued = await api.reissueRecovery(value);
        state.panel = 'list';
        if (issued?.recoveryCode) state.code = { code: issued.recoveryCode, kind: 'reissued' };
        if (state.status) state.status = { ...state.status, hasRecovery: true };
        say('');
        render();
      }, 'Видача нового коду…');
    });
    queueMicrotask(() => password.focus());
    return form;
  }

  // Створити з шаблону ----------------------------------------------------------------------

  function openGenerate() {
    const templates = templateItems(state.items);
    state.gen = {
      templateId: templates[0]?.id ?? '',
      sourceKind: SOURCE_KINDS[0].id,
      from: '',
      to: '',
      branch: BRANCHES[0].id,
      modules: null,
      moduleId: '',
      tableId: '',
      name: templates[0] ? defaultDocumentName(templates[0].name) : '',
      nameTouched: false,
      templateFields: new Map(), // versionId → { fields, blocks, errors } | { error }
      tableData: new Map(), // itemId → data з library_source_data (назви колонок для довідки)
      tableLoading: new Set(),
    };
    state.panel = 'generate';
    renderContent();
    loadTemplateFields();
  }

  const currentTemplate = () => templateItems(state.items).find(item => item.id === state.gen?.templateId) ?? null;

  async function loadTemplateFields() {
    const gen = state.gen;
    const template = currentTemplate();
    if (!gen || !template || gen.templateFields.has(template.currentVersionId)) return;
    try {
      gen.templateFields.set(template.currentVersionId, await readTemplateFields({ api, JSZip, item: template }));
    } catch (error) {
      if (isLockedError(error)) return;
      gen.templateFields.set(template.currentVersionId, { error: errorText(error) });
    }
    if (state.gen === gen && state.panel === 'generate') renderContent();
  }

  async function loadModules() {
    const gen = state.gen;
    const branch = gen.branch;
    gen.modules = null;
    gen.moduleId = '';
    renderContent();
    let modules = [];
    try {
      modules = await api.dashboardModules(branch);
    } catch (error) {
      if (isLockedError(error)) return;
      say(`Не вдалося завантажити модулі: ${errorText(error)}`, 'error');
    }
    if (state.gen !== gen || gen.branch !== branch) return;
    gen.modules = Array.isArray(modules) ? modules : [];
    gen.moduleId = gen.modules[0]?.id ?? '';
    renderContent();
  }

  async function loadTableData() {
    const gen = state.gen;
    const itemId = gen?.tableId;
    if (!itemId || gen.tableData.has(itemId) || gen.tableLoading.has(itemId)) return;
    gen.tableLoading.add(itemId);
    try {
      const source = await api.sourceData('library_table', { itemId });
      gen.tableData.set(itemId, source?.data ?? null);
    } catch (error) {
      if (isLockedError(error)) return;
      gen.tableData.set(itemId, null);
      say(`Не вдалося прочитати таблицю: ${errorText(error)}`, 'error');
    } finally {
      gen.tableLoading.delete(itemId);
    }
    if (state.gen === gen && state.panel === 'generate') renderContent();
  }

  function sourceDataForFields(gen) {
    if (gen.sourceKind === 'dashboard_module') {
      const module = (gen.modules ?? []).find(entry => entry.id === gen.moduleId);
      return module ? { module } : null;
    }
    if (gen.sourceKind === 'library_table') return gen.tableData.get(gen.tableId) ?? null;
    return null;
  }

  function select(label, options, value, onchange) {
    const node = el('select', { class: 'ws-input', 'aria-label': label },
      options.map(option => el('option', { value: option.value, text: option.label })));
    node.value = value;
    node.addEventListener('change', () => onchange(node.value));
    return node;
  }

  function generatePanel() {
    const gen = state.gen;
    const templates = templateItems(state.items);
    const back = button('Скасувати', () => { state.panel = 'list'; state.gen = null; renderContent(); });
    if (!templates.length) {
      return el('section', { class: 'ws-lib-form' },
        el('h3', { class: 'ws-lib-subtitle', text: 'Створити з шаблону' }),
        el('p', { text: 'У бібліотеці немає шаблонів. Імпортуйте DOCX, PPTX чи XLSX кнопкою «Імпортувати шаблон…». У шаблоні поле пишеться як {{поле}}, блок, що повторюється для кожного запису, — {{#блок}}…{{/блок}}.' }),
        el('div', { class: 'ws-lib-actions' }, button('Імпортувати шаблон…', () => importFile(true)), back));
    }
    const template = currentTemplate();
    const form = el('form', { class: 'ws-lib-form' },
      el('h3', { class: 'ws-lib-subtitle', text: 'Створити з шаблону' }),
      field('Шаблон', select('Шаблон', templates.map(item => ({ value: item.id, label: `${item.name} (${String(item.ext).toUpperCase()})` })), gen.templateId, value => {
        gen.templateId = value;
        const chosen = currentTemplate();
        if (!gen.nameTouched && chosen) gen.name = defaultDocumentName(chosen.name);
        renderContent();
        loadTemplateFields();
      })),
      field('Джерело даних', select('Джерело даних', SOURCE_KINDS.map(kind => ({ value: kind.id, label: kind.label })), gen.sourceKind, value => {
        gen.sourceKind = value;
        renderContent();
        if (value === 'dashboard_module' && gen.modules === null) loadModules();
      })),
      sourceFields(gen),
      field('Назва документа', nameInput(gen)),
      el('div', { class: 'ws-lib-actions' }, el('button', { type: 'submit', class: 'ws-btn ws-primary', text: 'Створити документ' }), back),
      fieldsHelp(gen, template));
    form.addEventListener('submit', event => {
      event.preventDefault();
      createFromTemplate();
    });
    return form;
  }

  function nameInput(gen) {
    const input = el('input', { type: 'text', class: 'ws-input', value: gen.name, maxLength: MAX_ITEM_NAME_CHARS * 2, 'aria-label': 'Назва документа' });
    input.addEventListener('input', () => { gen.name = input.value; gen.nameTouched = true; });
    return input;
  }

  function sourceFields(gen) {
    if (gen.sourceKind === 'approved_revisions') {
      const from = el('input', { type: 'date', class: 'ws-input', value: gen.from, 'aria-label': 'Початок періоду' });
      const to = el('input', { type: 'date', class: 'ws-input', value: gen.to, 'aria-label': 'Кінець періоду' });
      from.addEventListener('input', () => { gen.from = from.value; });
      to.addEventListener('input', () => { gen.to = to.value; });
      return el('div', { class: 'ws-lib-row' },
        field('Період з', from), field('по', to),
        el('small', { class: 'ws-lib-hint', text: 'Порожня дата — без обмеження. Беруться лише схвалені записи.' }));
    }
    if (gen.sourceKind === 'dashboard_module') {
      const branch = select('Рід військ або командування', BRANCHES.map(entry => ({ value: entry.id, label: entry.label })), gen.branch, value => {
        gen.branch = value;
        loadModules();
      });
      let modules;
      if (gen.modules === null) modules = el('span', { class: 'ws-lib-hint', text: 'Завантаження модулів…' });
      else if (!gen.modules.length) modules = el('span', { class: 'ws-lib-hint', text: 'У цього профілю немає модулів дашборда для цього роду військ.' });
      else {
        modules = select('Модуль дашборда', gen.modules.map(module => ({ value: module.id, label: `${module.title} (рядків: ${module.rowCount ?? 0})` })), gen.moduleId, value => {
          gen.moduleId = value;
          renderContent();
        });
      }
      return el('div', { class: 'ws-lib-row' }, field('Рід військ / командування', branch), field('Модуль', modules));
    }
    const tables = tableItems(state.items);
    if (!tables.length) return el('p', { class: 'ws-lib-hint', text: 'У бібліотеці немає таблиць: імпортуйте XLSX чи CSV.' });
    if (!tables.some(item => item.id === gen.tableId)) gen.tableId = tables[0].id;
    if (!gen.tableData.has(gen.tableId)) queueMicrotask(loadTableData);
    return field('Таблиця з бібліотеки', select('Таблиця з бібліотеки', tables.map(item => ({ value: item.id, label: item.name })), gen.tableId, value => {
      gen.tableId = value;
      renderContent();
    }), 'Береться перший аркуш (до 10 000 рядків і 64 колонок).');
  }

  function fieldsHelp(gen, template) {
    const info = template ? gen.templateFields.get(template.currentVersionId) : null;
    const report = fieldReport({ sourceKind: gen.sourceKind, data: sourceDataForFields(gen), template: info && !info.error ? info : null });
    const plain = report.available.filter(entry => !entry.block);
    const sourceList = el('div', { class: 'ws-lib-fields' },
      el('h4', { text: 'Поля джерела' }),
      el('ul', {}, plain.map(entry => el('li', {}, el('code', { text: `{{${entry.name}}}` }), el('span', { text: ` — ${entry.label}` })))),
      report.blocks.map(block => el('div', { class: 'ws-lib-block' },
        el('p', {}, el('code', { text: `{{#${block.name}}}…{{/${block.name}}}` }), el('span', { text: ` — ${block.label}; усередині:` })),
        el('ul', {}, report.available.filter(entry => entry.block === block.name)
          .map(entry => el('li', {}, el('code', { text: `{{${entry.name}}}` }), el('span', { text: ` — ${entry.label}` })))))));
    let templateList;
    if (!template) templateList = null;
    else if (!info) templateList = el('p', { class: 'ws-lib-hint', text: 'Читання полів шаблону…' });
    else if (info.error) templateList = el('p', { class: 'ws-lib-warning', text: `Шаблон не прочитано: ${info.error}` });
    else {
      const entries = [...report.templateBlocks.map(entry => ({ ...entry, block: true })), ...report.fields];
      templateList = el('div', { class: 'ws-lib-fields' },
        el('h4', { text: `Поля шаблону «${template.name}»` }),
        entries.length
          ? el('ul', {}, entries.map(entry => el('li', { 'data-known': String(entry.known) },
            el('code', { text: entry.block ? `{{#${entry.name}}}` : `{{${entry.name}}}` }),
            el('span', { text: entry.known ? '' : ' — немає в цьому джерелі: у документі буде порожньо' }))))
          : el('p', { class: 'ws-lib-hint', text: 'У шаблоні немає полів {{…}}: документ буде копією шаблону.' }),
        report.unknown.length ? el('p', { class: 'ws-lib-warning', text: `Невідомих полів: ${report.unknown.length}.` }) : null,
        report.errors.length ? el('ul', { class: 'ws-lib-lines' }, report.errors.map(text => el('li', { class: 'ws-lib-warning', text }))) : null);
    }
    return el('div', { class: 'ws-lib-help' }, templateList, sourceList);
  }

  function createFromTemplate() {
    const gen = state.gen;
    const template = currentTemplate();
    if (!template) return say('Оберіть шаблон.', 'error');
    const params = sourceParams(gen.sourceKind, { from: gen.from, to: gen.to, moduleId: gen.moduleId, itemId: gen.tableId });
    if (!params.ok) return say(params.error, 'error');
    const name = validateItemName(gen.name || defaultDocumentName(template.name));
    if (!name.ok) return say(name.error, 'error');
    return run(async () => {
      const result = await generateDocument({
        api,
        JSZip,
        templateVersionId: template.currentVersionId,
        ext: template.ext,
        sourceKind: gen.sourceKind,
        params: params.params,
        name: name.name,
        itemId: null,
        makeCurrent: true,
        now: new Date(),
      });
      state.panel = 'list';
      state.gen = null;
      state.report = { title: `Створено «${result.item?.name ?? name.name}»`, lines: generationLines(result), tone: 'ok', actions: [] };
      say('');
      await loadItems();
      renderContent();
    }, 'Створення документа…');
  }

  // Застарілі документи -----------------------------------------------------------------------

  function openStale() {
    state.panel = 'stale';
    state.stale = null;
    renderContent();
    run(async () => {
      const [items, statuses] = await Promise.all([api.list(true), api.linkStatuses()]);
      const list = sortItems(items);
      state.stale = { items: list, statuses, plan: regenerationPlan(list, statuses) };
      updateBadge(staleCount(statuses));
      say('');
      renderContent();
    }, 'Перевірка пов’язаних документів…');
  }

  function stalePanel() {
    const back = button('До списку', () => { state.panel = 'list'; state.stale = null; renderContent(); });
    if (!state.stale) return el('section', { class: 'ws-lib-form' }, el('p', { class: 'ws-lib-hint', text: 'Перевірка пов’язаних документів…' }), back);
    const { items, statuses, plan } = state.stale;
    const byId = new Map(items.map(item => [item.id, item]));
    const details = linkStatusMap(statuses);
    const nameOf = id => byId.get(id)?.name ?? id;
    return el('section', { class: 'ws-lib-form' },
      el('h3', { class: 'ws-lib-subtitle', text: 'Застарілі документи' }),
      el('p', { text: `Дані джерела змінилися: ${plan.update.length}. Актуальні: ${plan.upToDate.length}. Пропущено: ${plan.skipped.length}.` }),
      plan.update.length
        ? el('ul', { class: 'ws-lib-lines' }, plan.update.map(id => el('li', { text: `${nameOf(id)} — ${linkDescription(byId.get(id), { items })}` })))
        : el('p', { class: 'ws-lib-hint', text: 'Документів, які можна оновити автоматично, немає.' }),
      plan.skipped.length ? el('h4', { text: '«Оновити всі» їх не чіпає' }) : null,
      plan.skipped.length
        ? el('ul', { class: 'ws-lib-lines' }, plan.skipped.map(entry => el('li', { text: `${nameOf(entry.id)} — ${skipReasonText(entry.reason, details.get(entry.id)?.detail)}` })))
        : null,
      el('div', { class: 'ws-lib-actions' },
        button('Оновити всі', updateAll, { class: 'ws-btn ws-primary', disabled: !plan.update.length }),
        back));
  }

  function updateAll() {
    const stale = state.stale;
    if (!stale) return;
    run(async () => {
      const { results, summary } = await regenerateAll({
        api,
        JSZip,
        items: stale.items,
        statuses: stale.statuses,
        now: new Date(),
        onProgress: (index, total, item) => say(`Оновлення ${index + 1} з ${total}: «${item.name}»…`),
      });
      const lines = [];
      for (const result of results) {
        if (result.outcome === 'error') lines.push(`${result.name}: помилка — ${result.error}`);
        else if (result.outcome === 'skipped') lines.push(`${result.name}: пропущено — ${skipReasonText(result.reason)}`);
        else if (result.missing?.length) lines.push(`${result.name}: незаповнені поля — ${result.missing.join(', ')}`);
      }
      state.report = { title: summary, lines, tone: results.some(result => result.outcome === 'error') ? 'error' : 'ok', actions: [] };
      state.panel = 'list';
      state.stale = null;
      say('');
      await loadItems();
      renderContent();
    }, 'Оновлення застарілих документів…');
  }

  render();
  return Object.freeze({
    /** Вкладку відкрито: свіжий стан бібліотеки, список і статуси зв'язків. */
    activate: () => refreshStatus(),
  });
}
