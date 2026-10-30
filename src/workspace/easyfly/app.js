// EasyFLY у «Робочому середовищі» → «Авіація» (контракт docs/WORKSPACE.md): облік допусків,
// перевірок і нальоту льотного складу. Файл .easyfly — JSON, відкривається й зберігається через
// host. Шелл: початковий екран, ліва навігація, роутер у пам'яті (location не змінюється), стан
// даних із позначкою «є незбережені зміни». Екрани — views/*.js, підвантажуються лениво:
// render(ctx) → HTMLElement (може бути async); якщо файлу немає — заглушка «У розробці».
import './easyfly.css';
import { formatDate } from './fly-core.js';
import { DEMO_TODAY, createDemo } from './fly-demo.js';
import {
  NAV_ITEMS, PHONE_NAV, applyMutation, buildRoute, effectiveSettings, fingerprint, isDirty, navFor,
  parseRoute, suggestedFileName, todayIso,
} from './fly-state.js';
import { createEmpty, parse, serialize } from './fly-store.js';
import { icon } from './icons.js';
import {
  button, confirmDialog, el, notice, setOverlayRoot, toast, underDevelopment,
} from './ui.js';

export const contract = 1;

/** Ключ даних профілю (простір імен easyfly — єдиний, який бачить це вікно). */
const STORE_KEY = 'easyfly.main';
/** Пауза після останньої зміни, після якої дані записуються в профіль. */
const SAVE_DELAY_MS = 400;

/** Файли екранів: import.meta.glob, щоб Vite бачив їх у збірці; відсутній файл — заглушка. */
const VIEW_MODULES = import.meta.glob('./views/*.js');
const VIEW_FILES = {
  summary: 'summary', pilots: 'pilots', pilot: 'pilot', chrono: 'chrono', navigator: 'navigator',
  sunmoon: 'sunmoon', import: 'import', reminders: 'reminders', settings: 'settings',
};

const navLabel = name => NAV_ITEMS.find(item => item.route === name)?.label || 'Екран';

export async function mount(container, host) {
  container.classList.add('ef-host');
  const root = el('div', { class: 'ef-root' });
  const overlay = el('div', { class: 'ef-overlay-root' });
  container.replaceChildren(root, overlay);
  setOverlayRoot(overlay);

  // { data, name, savedFp, today, demo, stored }: stored — дані профілю (зберігаються самі),
  // demo — синтетичний набір (ніколи не пишеться в профіль).
  let doc = null;
  let saveTimer = null;
  let saveQueue = Promise.resolve();
  let saveFailed = false;
  let route = parseRoute('');
  let renderToken = 0;
  let parts = null; // { content, main, nav, bottom, bar }
  let destroyed = false;

  // ───────────── стан і контекст для екранів ─────────────

  const ctx = {
    host,
    get data() { return doc.data; },
    get today() { return doc.today; },
    get route() { return route; },
    get settings() { return effectiveSettings(doc.data); },
    go(name, params = {}, options = {}) {
      route = typeof name === 'string' && name.startsWith('#') ? parseRoute(name) : parseRoute(buildRoute(name, params));
      closeMore();
      renderView({ resetScroll: true, focus: options.focus || '[data-ef-focus]' });
    },
    /**
     * Змінює дані: fn(копія) повертає результат редуктора { ok, data } або змінює копію. При ok
     * позначає незбережені зміни й перемальовує екран. Повертає { ok, data, result }.
     */
    mutate(fn) {
      const outcome = applyMutation(doc.data, fn);
      if (outcome.ok) {
        doc.data = outcome.data;
        syncDirty();
        scheduleSave();
        renderView({ resetScroll: false, keepFocus: true });
      }
      return outcome;
    },
    rerender() { renderView({ resetScroll: false, keepFocus: true }); },
  };

  // Демо-набір ніколи не зберігається, тож «незбережених змін» у ньому немає.
  const dirty = () => Boolean(doc) && !doc.demo && isDirty(doc.data, doc.savedFp);

  function syncDirty() {
    host.setDirty?.(dirty());
    if (parts) updateBar();
  }

  // ───────────── дані профілю і файли ─────────────

  function openDoc({ data, name, demo = false, stored = false }) {
    doc = { data, name, savedFp: fingerprint(data), today: demo ? DEMO_TODAY : todayIso(), demo, stored };
    saveFailed = false;
    route = parseRoute('');
    host.setTitle?.(name);
    host.setDirty?.(false);
    buildShell();
    renderView({ resetScroll: true });
  }

  /** Відкладений запис у профіль після останньої зміни. */
  function scheduleSave() {
    if (!doc?.stored || destroyed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; persist(); }, SAVE_DELAY_MS);
  }

  /** Записує дані профілю одразу. Записи йдуть по черзі; → true, якщо дані збережено. */
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const run = async () => {
      const target = doc;
      if (!target?.stored) return true;
      const snapshot = target.data;
      try {
        await host.profile.write(STORE_KEY, serialize(snapshot));
        target.savedFp = fingerprint(snapshot);
        saveFailed = false;
      } catch (error) {
        if (!saveFailed) toast(`Не вдалося зберегти дані в профілі: ${error?.message || error}`, 'error');
        saveFailed = true;
      }
      if (doc === target) syncDirty();
      return !saveFailed;
    };
    saveQueue = saveQueue.then(run, run);
    return saveQueue;
  }

  /** Дані профілю відкриваються самі: увійшов у профіль — і вони вже тут. */
  async function loadStored() {
    let record;
    try {
      record = await host.profile.read(STORE_KEY);
    } catch (error) {
      return { error: error?.message || String(error) };
    }
    if (!record) return { empty: true };
    const result = parse(new TextEncoder().encode(record.value));
    if (!result.ok) return { error: `Дані EasyFLY у профілі не вдалося прочитати: ${result.errors.slice(0, 3).join(' ')}` };
    return { data: result.data, warnings: result.warnings, migratedFrom: result.migratedFrom };
  }

  /** Нова порожня база стає даними профілю. */
  async function startStored(data, toastText) {
    openDoc({ data, name: 'Дані профілю', stored: true });
    // Зберігаємо одразу, щоб наступний вхід відкрив уже цю базу, навіть без жодної зміни.
    doc.savedFp = null;
    const ok = await persist();
    if (ok && toastText) toast(toastText);
  }

  async function newFile() {
    if (doc?.stored && !(await confirmDialog({
      title: 'Створити порожню базу?',
      message: 'Поточні дані EasyFLY у профілі буде замінено порожніми. Якщо вони потрібні, спершу збережіть копію у файл.',
      confirmLabel: 'Замінити порожньою', danger: true,
    }))) return;
    await startStored(createEmpty(), 'Створено порожню базу в профілі.');
  }

  async function openDemo() {
    if (dirty() && !(await guardPending('Відкрити демо-дані?'))) return;
    openDoc({ data: createDemo(), name: 'Демо-дані (синтетичні)', demo: true });
  }

  async function guardPending(title) {
    await persist();
    if (!dirty()) return true;
    return confirmDialog({
      title, message: 'Останні зміни не вдалося записати в профіль. Якщо продовжити, вони буде втрачено.',
      confirmLabel: 'Продовжити без збереження', danger: true,
    });
  }

  /** Імпорт з файлу .easyfly: його вміст стає даними профілю (файл лишається недоторканим). */
  async function importFromDisk() {
    if (doc?.stored && !(await confirmDialog({
      title: 'Замінити дані профілю файлом?',
      message: 'Дані EasyFLY у профілі буде замінено вмістом файлу. Якщо поточні дані потрібні, спершу збережіть копію у файл.',
      confirmLabel: 'Замінити даними з файлу', danger: true,
    }))) return;
    let opened;
    try {
      opened = await host.openFile({ extensions: ['easyfly'] });
    } catch (error) {
      reportStartError([`Не вдалося відкрити файл: ${error?.message || error}`]);
      return;
    }
    if (!opened) return;
    // Файл прочитано повністю; його ручку зберігати не потрібно.
    try { await host.closeFile(opened.handle); } catch { /* уже закрито */ }
    const result = parse(opened.bytes);
    if (!result.ok) {
      reportStartError(result.errors.slice(0, 5));
      return;
    }
    await startStored(result.data, `Імпортовано з файлу «${opened.name}» у профіль.`);
    if (result.warnings.length) toast(result.warnings.slice(0, 2).join(' '));
  }

  function reportStartError(messages) {
    if (doc) toast(messages.slice(0, 3).join(' '), 'error');
    else showStartError(messages);
  }

  /** Копія даних у файл .easyfly (експорт); дані профілю не змінюються. */
  async function exportFile() {
    let bytes;
    try {
      bytes = new TextEncoder().encode(serialize(doc.data));
    } catch (error) {
      toast(error?.message || 'Не вдалося підготувати файл до збереження.', 'error');
      return false;
    }
    try {
      const saved = await host.saveFileAs({ bytes, suggestedName: suggestedFileName(doc.data) });
      if (!saved) return false;
      if (saved.handle) { try { await host.closeFile(saved.handle); } catch { /* ігноруємо */ } }
      toast(`Копію збережено: ${saved.name || 'файл .easyfly'}`);
      return true;
    } catch (error) {
      toast(`Не вдалося зберегти копію: ${error?.message || error}`, 'error');
      return false;
    }
  }

  /** З демо — назад до даних профілю (або на початковий екран, якщо їх ще немає). */
  async function leaveDemo() {
    await bootstrap();
  }

  async function bootstrap() {
    const stored = await loadStored();
    if (destroyed) return;
    if (stored.data) {
      openDoc({ data: stored.data, name: 'Дані профілю', stored: true });
      if (stored.warnings?.length) toast(stored.warnings.slice(0, 2).join(' '));
      else if (stored.migratedFrom) toast(`Дані оновлено з версії ${stored.migratedFrom}.`);
      if (stored.migratedFrom) await persist();
      return;
    }
    doc = null;
    parts = null;
    renderToken += 1;
    host.setTitle?.('EasyFLY');
    host.setDirty?.(false);
    showStart(stored.error || null);
  }

  // ───────────── початковий екран ─────────────

  function showStart(unavailable = null) {
    const errorHost = el('div', { class: 'ef-start-errors', role: 'alert' });
    root.className = 'ef-root ef-root-start';
    root.replaceChildren(el('main', { class: 'ef-start' },
      el('div', { class: 'ef-start-card' },
        el('div', { class: 'ef-start-logo', 'aria-hidden': 'true' }, icon('shturman', 28)),
        el('h1', { class: 'ef-start-title', text: 'EasyFLY' }),
        el('p', { class: 'ef-start-lead', text: 'Облік допусків, перевірок і нальоту льотного складу. Дані належать вашому профілю: зберігаються самі, зашифровані на цьому пристрої, інтернет не потрібен.' }),
        errorHost,
        el('div', { class: 'ef-start-actions' },
          unavailable ? null : button('Створити базу', { variant: 'primary', iconName: 'vnesty', onClick: newFile }),
          unavailable ? null : button('Імпорт із файлу', { variant: 'secondary', iconName: 'vidkryty', onClick: importFromDisk }),
          button('Демо-дані (синтетичні)', { variant: unavailable ? 'primary' : 'secondary', iconName: 'moi-piloty', onClick: openDemo })),
        el('p', { class: 'ef-hint ef-hint-block', text: 'Дані зберігаються в профілі автоматично; файл .easyfly — лише імпорт і копія для перенесення (звичайний JSON, тримайте його лише на власному пристрої). Затвердження й підпису в застосунку немає: паперові документи лишаються юридичним оригіналом.' }))));
    root.__errorHost = errorHost;
    if (unavailable) {
      errorHost.replaceChildren(notice('Дані профілю недоступні', null, { tone: 'red' }), el('p', { class: 'ef-hint', text: `${String(unavailable).replace(/[.\s]+$/, '')}. Створити чи імпортувати базу не можна, поки дані профілю недоступні. Демо-дані відкриваються і працюють без збереження.` }));
    }
    const first = root.querySelector('button');
    if (first) first.focus();
  }

  function showStartError(messages) {
    const host_ = root.__errorHost;
    if (!host_) return;
    host_.replaceChildren(notice('Файл не відкрито', null, { tone: 'red' }), el('ul', { class: 'ef-errors' }, messages.map(m => el('li', { text: m }))));
  }

  // ───────────── шелл ─────────────

  let moreMenu = null;
  function closeMore() {
    if (moreMenu) { moreMenu.hidden = true; parts?.moreButton?.setAttribute('aria-expanded', 'false'); }
  }

  function navButton(item, { compact = false } = {}) {
    const node = el('button', {
      type: 'button', class: compact ? 'ef-bnav-item' : 'ef-nav-item', dataset: { route: item.route },
      onClick: () => ctx.go(item.route),
    }, icon(item.icon, compact ? 22 : 18), el('span', { text: item.label }));
    return node;
  }

  function buildShell() {
    root.className = 'ef-root';
    const nav = el('nav', { class: 'ef-sidebar', 'aria-label': 'Розділи EasyFLY' },
      el('div', { class: 'ef-brand', text: 'EasyFLY' }),
      el('div', { class: 'ef-nav-title', text: 'Навігація' }),
      el('div', { class: 'ef-nav-list' }, NAV_ITEMS.map(item => navButton(item))),
      el('div', { class: 'ef-side-foot' },
        el('span', { class: 'ef-local', text: 'Дані профілю' }),
        el('span', { class: 'ef-side-date', text: formatDate(doc.today) })));

    const barTitle = el('span', { class: 'ef-bar-title' });
    const barState = el('span', { class: 'ef-bar-state', role: 'status' });
    const demoTag = el('span', { class: 'ef-pill ef-pill-amber', text: 'Демо-дані · дата зафіксована', hidden: !doc.demo });
    const saveBtn = button('Копія у файл…', { variant: 'primary', iconName: 'zberehty', onClick: exportFile });
    const saveAsBtn = button('Імпорт із файлу…', { variant: 'secondary', onClick: importFromDisk });
    const openBtn = button('Нова база…', { variant: 'ghost', iconName: 'vidkryty', onClick: newFile });
    const closeBtn = button('Вийти з демо', { variant: 'ghost', onClick: leaveDemo });
    // Імпорт і нова база стосуються даних профілю, тож у демо їх немає; «Вийти з демо» — навпаки.
    saveAsBtn.hidden = doc.demo;
    openBtn.hidden = doc.demo;
    closeBtn.hidden = !doc.demo;
    // На телефоні «Відкрити», «Зберегти як» і «Закрити файл» ховаються в меню «⋯».
    const barMenu = el('div', { class: 'ef-bar-menu', role: 'menu', hidden: true },
      (doc.demo
        ? [['Копія у файл…', exportFile], ['Вийти з демо', leaveDemo]]
        : [['Імпорт із файлу…', importFromDisk], ['Нова база…', newFile], ['Копія у файл…', exportFile]]).map(([label, handler]) => el('button', {
        type: 'button', class: 'ef-more-item', role: 'menuitem', onClick: () => { barMenu.hidden = true; handler(); },
      }, label)));
    const barMore = el('button', { type: 'button', class: 'ef-btn ef-btn-ghost ef-bar-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Інші дії з даними', onClick: event => {
      event.stopPropagation();
      barMenu.hidden = !barMenu.hidden;
      barMore.setAttribute('aria-expanded', String(!barMenu.hidden));
    } }, icon('more', 18));
    for (const b of [openBtn, saveAsBtn, closeBtn]) b.classList.add('ef-bar-secondary');
    const bar = el('div', { class: 'ef-bar', role: 'toolbar', 'aria-label': 'Дані' },
      el('div', { class: 'ef-bar-left' }, barTitle, demoTag, barState),
      el('div', { class: 'ef-bar-right' }, openBtn, saveAsBtn, saveBtn, closeBtn, barMore, barMenu));

    const content = el('div', { class: 'ef-content', tabindex: '-1', 'data-ef-focus': '' });
    const main = el('main', { class: 'ef-main' }, bar, content);

    const phoneItems = PHONE_NAV.map(name => NAV_ITEMS.find(i => i.route === name));
    const rest = NAV_ITEMS.filter(i => !PHONE_NAV.includes(i.route));
    moreMenu = el('div', { class: 'ef-more-menu', hidden: true, role: 'menu' }, rest.map(item => {
      const b = el('button', { type: 'button', class: 'ef-more-item', role: 'menuitem', dataset: { route: item.route }, onClick: () => ctx.go(item.route) },
        icon(item.icon, 18), el('span', { text: item.label }));
      return b;
    }));
    const moreButton = el('button', { type: 'button', class: 'ef-bnav-item', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: event => {
      event.stopPropagation();
      moreMenu.hidden = !moreMenu.hidden;
      moreButton.setAttribute('aria-expanded', String(!moreMenu.hidden));
    } }, icon('more', 22), el('span', { text: 'Ще' }));
    const bottom = el('nav', { class: 'ef-bottom-nav', 'aria-label': 'Розділи EasyFLY (телефон)' }, phoneItems.map(item => navButton(item, { compact: true })), moreButton, moreMenu);

    root.replaceChildren(nav, main, bottom);
    parts = { content, main, nav, bottom, bar, barTitle, barState, saveBtn, moreButton };
    updateBar();
  }

  function updateBar() {
    parts.barTitle.textContent = doc.name;
    const changed = dirty();
    let label = 'Збережено в профілі';
    if (doc.demo) label = 'Демо-дані не зберігаються';
    else if (changed) label = saveFailed ? 'Не вдалося зберегти — повторю' : 'Зберігаю…';
    parts.barState.textContent = label;
    parts.barState.className = `ef-bar-state${changed ? ' ef-bar-dirty' : ''}`;
  }

  function markActive() {
    const active = navFor(route);
    for (const node of root.querySelectorAll('[data-route]')) {
      if (node.dataset.route === active) node.setAttribute('aria-current', 'page');
      else node.removeAttribute('aria-current');
    }
    const restActive = !PHONE_NAV.includes(active);
    parts.moreButton.classList.toggle('ef-active', restActive);
  }

  function focusKey() {
    const node = document.activeElement;
    if (!node || !parts?.content.contains(node)) return null;
    const label = node.getAttribute('aria-label');
    if (label) return { selector: `[aria-label="${CSS.escape(label)}"]` };
    if (node.id && !/^ef-(f|m)-\d+/.test(node.id)) return { selector: `#${CSS.escape(node.id)}` };
    return null;
  }

  async function loadView(name) {
    const file = VIEW_FILES[name];
    const loader = file ? VIEW_MODULES[`./views/${file}.js`] : null;
    if (!loader) return underDevelopment(navLabel(name));
    try {
      const mod = await loader();
      if (typeof mod.render !== 'function') return underDevelopment(navLabel(name));
      return await mod.render(ctx);
    } catch (error) {
      console.error(error);
      return el('div', { class: 'ef-view' }, notice('Не вдалося показати екран.', 'Спробуйте відкрити його ще раз. Дані файлу не змінено.', { tone: 'red', role: 'alert' }));
    }
  }

  async function renderView({ resetScroll = false, keepFocus = false, focus = null } = {}) {
    if (!doc || !parts || destroyed) return;
    const token = ++renderToken;
    const keep = keepFocus ? focusKey() : null;
    const scroll = parts.main.scrollTop;
    const node = await loadView(route.name);
    if (token !== renderToken || !doc || !parts) return;
    parts.content.replaceChildren(node);
    parts.main.scrollTop = resetScroll ? 0 : scroll;
    markActive();
    if (keep) {
      const again = parts.content.querySelector(keep.selector);
      if (again) again.focus({ preventScroll: true });
    } else if (focus !== null) {
      const target = focus && focus !== '[data-ef-focus]' ? parts.content.querySelector(focus) || root.querySelector(focus) : null;
      (target || parts.content).focus({ preventScroll: true });
    }
  }

  const onDocClick = () => {
    closeMore();
    const menu = parts?.bar.querySelector('.ef-bar-menu');
    if (menu && !menu.hidden) { menu.hidden = true; parts.bar.querySelector('.ef-bar-more')?.setAttribute('aria-expanded', 'false'); }
  };
  const onDocKey = event => {
    if (event.key === 'Escape' && moreMenu && !moreMenu.hidden) { event.stopPropagation(); closeMore(); parts?.moreButton?.focus(); }
  };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onDocKey);

  // Запис до закриття вікна: зміни, що чекають паузи, пишуться одразу.
  const flush = () => { if (saveTimer) persist(); };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);

  await bootstrap();

  return {
    isDirty: dirty,
    unmount() {
      flush();
      destroyed = true;
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKey);
      doc = null;
      parts = null;
      setOverlayRoot(null);
      container.replaceChildren();
      container.classList.remove('ef-host');
    },
  };
}
