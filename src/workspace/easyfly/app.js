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

  let doc = null; // { data, handle, name, savedFp, today, demo }
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
        renderView({ resetScroll: false, keepFocus: true });
      }
      return outcome;
    },
    rerender() { renderView({ resetScroll: false, keepFocus: true }); },
  };

  const dirty = () => Boolean(doc) && isDirty(doc.data, doc.savedFp);

  function syncDirty() {
    host.setDirty?.(dirty());
    if (parts) updateBar();
  }

  // ───────────── файли ─────────────

  function openDoc({ data, handle = null, name, demo = false }) {
    doc = { data, handle, name, savedFp: fingerprint(data), today: demo ? DEMO_TODAY : todayIso(), demo };
    route = parseRoute('');
    host.setTitle?.(name);
    host.setDirty?.(false);
    buildShell();
    renderView({ resetScroll: true });
  }

  async function releaseHandle() {
    if (doc?.handle) { try { await host.closeFile(doc.handle); } catch { /* уже закрито */ } }
  }

  async function guardUnsaved(title) {
    if (!dirty()) return true;
    return confirmDialog({
      title, message: 'У файлі є незбережені зміни. Якщо продовжити без збереження, вони буде втрачено.',
      confirmLabel: 'Продовжити без збереження', danger: true,
    });
  }

  async function newFile() {
    if (doc && !(await guardUnsaved('Створити новий файл?'))) return;
    await releaseHandle();
    openDoc({ data: createEmpty(), name: 'Новий файл EasyFLY' });
  }

  async function openDemo() {
    if (doc && !(await guardUnsaved('Відкрити демо-дані?'))) return;
    await releaseHandle();
    openDoc({ data: createDemo(), name: 'Демо-дані (синтетичні)', demo: true });
  }

  async function openFromDisk() {
    if (doc && !(await guardUnsaved('Відкрити інший файл?'))) return;
    let opened;
    try {
      opened = await host.openFile({ extensions: ['easyfly'] });
    } catch (error) {
      showStartError([`Не вдалося відкрити файл: ${error?.message || error}`]);
      return;
    }
    if (!opened) return;
    const result = parse(opened.bytes);
    if (!result.ok) {
      try { await host.closeFile(opened.handle); } catch { /* файл не прийнято */ }
      if (doc) toast(result.errors.slice(0, 3).join(' '), 'error');
      else showStartError(result.errors.slice(0, 5));
      return;
    }
    await releaseHandle();
    openDoc({ data: result.data, handle: opened.handle, name: opened.name });
    if (result.warnings.length) toast(result.warnings.slice(0, 2).join(' '));
    else if (result.migratedFrom) toast(`Файл оновлено з версії ${result.migratedFrom}. Збережіть його, щоб зберегти зміни.`);
  }

  async function save(as = false) {
    let bytes;
    try {
      bytes = new TextEncoder().encode(serialize(doc.data));
    } catch (error) {
      toast(error?.message || 'Не вдалося підготувати файл до збереження.', 'error');
      return false;
    }
    try {
      let saved;
      if (doc.handle && !as) {
        saved = await host.saveFile({ handle: doc.handle, bytes });
      } else {
        saved = await host.saveFileAs({ bytes, suggestedName: suggestedFileName(doc.data) });
        if (!saved) return false;
        if (doc.handle && saved.handle !== doc.handle) { try { await host.closeFile(doc.handle); } catch { /* ігноруємо */ } }
      }
      doc.handle = saved.handle;
      doc.name = saved.name || doc.name;
      doc.savedFp = fingerprint(doc.data);
      host.setTitle?.(doc.name);
      syncDirty();
      toast(`Збережено: ${doc.name}`);
      return true;
    } catch (error) {
      toast(`Не вдалося зберегти: ${error?.message || error}`, 'error');
      return false;
    }
  }

  async function closeDoc() {
    if (!(await guardUnsaved('Закрити файл?'))) return;
    await releaseHandle();
    doc = null;
    parts = null;
    host.setTitle?.('EasyFLY');
    host.setDirty?.(false);
    renderToken += 1;
    showStart();
  }

  // ───────────── початковий екран ─────────────

  function showStart() {
    const errorHost = el('div', { class: 'ef-start-errors', role: 'alert' });
    root.className = 'ef-root ef-root-start';
    root.replaceChildren(el('main', { class: 'ef-start' },
      el('div', { class: 'ef-start-card' },
        el('div', { class: 'ef-start-logo', 'aria-hidden': 'true' }, icon('shturman', 28)),
        el('h1', { class: 'ef-start-title', text: 'EasyFLY' }),
        el('p', { class: 'ef-start-lead', text: 'Облік допусків, перевірок і нальоту льотного складу. Дані лишаються на цьому пристрої, інтернет не потрібен.' }),
        errorHost,
        el('div', { class: 'ef-start-actions' },
          button('Новий файл', { variant: 'primary', iconName: 'vnesty', onClick: newFile }),
          button('Відкрити файл', { variant: 'secondary', iconName: 'vidkryty', onClick: openFromDisk }),
          button('Демо-дані (синтетичні)', { variant: 'secondary', iconName: 'moi-piloty', onClick: openDemo })),
        el('p', { class: 'ef-hint ef-hint-block', text: 'Файл .easyfly — звичайний JSON. Тримайте його лише на власному пристрої. Затвердження й підпису в застосунку немає: паперові документи лишаються юридичним оригіналом.' }))));
    root.__errorHost = errorHost;
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
        el('span', { class: 'ef-local', text: 'Локальні дані' }),
        el('span', { class: 'ef-side-date', text: formatDate(doc.today) })));

    const barTitle = el('span', { class: 'ef-bar-title' });
    const barState = el('span', { class: 'ef-bar-state', role: 'status' });
    const demoTag = el('span', { class: 'ef-pill ef-pill-amber', text: 'Демо-дані · дата зафіксована', hidden: !doc.demo });
    const saveBtn = button('Зберегти', { variant: 'primary', iconName: 'zberehty', onClick: () => save(false) });
    const saveAsBtn = button('Зберегти як…', { variant: 'secondary', onClick: () => save(true) });
    const openBtn = button('Відкрити…', { variant: 'ghost', iconName: 'vidkryty', onClick: openFromDisk });
    const closeBtn = button('Закрити файл', { variant: 'ghost', onClick: closeDoc });
    // На телефоні «Відкрити», «Зберегти як» і «Закрити файл» ховаються в меню «⋯».
    const barMenu = el('div', { class: 'ef-bar-menu', role: 'menu', hidden: true },
      [['Відкрити…', openFromDisk], ['Зберегти як…', () => save(true)], ['Закрити файл', closeDoc]].map(([label, handler]) => el('button', {
        type: 'button', class: 'ef-more-item', role: 'menuitem', onClick: () => { barMenu.hidden = true; handler(); },
      }, label)));
    const barMore = el('button', { type: 'button', class: 'ef-btn ef-btn-ghost ef-bar-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Інші дії з файлом', onClick: event => {
      event.stopPropagation();
      barMenu.hidden = !barMenu.hidden;
      barMore.setAttribute('aria-expanded', String(!barMenu.hidden));
    } }, icon('more', 18));
    for (const b of [openBtn, saveAsBtn, closeBtn]) b.classList.add('ef-bar-secondary');
    const bar = el('div', { class: 'ef-bar', role: 'toolbar', 'aria-label': 'Файл' },
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
    parts.barState.textContent = changed ? 'Є незбережені зміни' : (doc.handle ? 'Збережено' : 'Не збережено у файл');
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

  showStart();

  return {
    isDirty: dirty,
    unmount() {
      destroyed = true;
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onDocKey);
      if (doc?.handle) host.closeFile(doc.handle)?.catch?.(() => {});
      doc = null;
      parts = null;
      setOverlayRoot(null);
      container.replaceChildren();
      container.classList.remove('ef-host');
    },
  };
}
