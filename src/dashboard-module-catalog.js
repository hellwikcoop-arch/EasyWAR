import {
  BRANCH_LABELS,
  MAX_CREW,
  MODULE_STYLES,
  branchFromLocation,
  columnCountLabel,
  crewCount,
  crewSummary,
  deleteModulePrompt,
  draftRow,
  fieldColumnWidth,
  fieldHint,
  fieldInputText,
  fieldInputType,
  fieldKind,
  fieldPlaceholder,
  fieldSections,
  formatFieldValue,
  correctionStatus,
  correctionStatusLabel,
  inheritedValues,
  isConflictError,
  runModuleDelete,
  readModulePayload,
  cardReadState,
  CARD_FAILED_TEXT,
  matchesCatalogItem,
  normalizeCatalog,
  normalizeDensity,
  normalizeModules,
  normalizeStyle,
  pluralForm,
  replaceRowsRequest,
  rowCountLabel,
  rowForWrite,
  rowMatchesQuery,
  rowsAfterDelete,
  rowsAfterSave,
  rowsWithDraft,
  schemaSummary,
  tableColumnGroups,
  tableEditState,
  visibleColumnKeys,
} from './dashboard-module-catalog-core.js';
import { chartModel, takeoffHoursModel, tickerItems } from './dashboard-module-charts-core.js';
import { MINE_LABEL, MINE_SLOT } from './personal-dashboard.js';
import { mountChart } from './dashboard-module-charts.js';
import { columnPicker } from './dashboard-module-picker.js';
import { forgetProfileSchemaModule, loadProfileSchema, syncProfileSchemaModules, updateProfileSchema } from './profile-schema-client.js';
import { loadDashboardLayout, updateDashboardLayout } from './dashboard-layout-client.js';
import { duplicateInstance, moveInstance, removeInstance, resizeInstance, setSharedPeriod, updateInstance } from './module-instance-core.js';
import { ensureModuleInstances, forgetModuleInstances } from './module-instance-modules-core.js';
import { cardModel, cardStyle, orderedCards } from './dashboard-layout-view-core.js';
import { instanceBar, sharedPeriodBar } from './dashboard-layout-panel.js';
import { rolesPanel } from './profile-schema-panel.js';
import { setSnapshot } from './profile-schema-core.js';
import { moduleSourceId } from './profile-schema-modules-core.js';
import { psCatalogUsage } from './module-definition-core.js';
import { CATALOG as PS_CATALOG, KPI_TILES, VIEW_BY_BLOCK } from './ps-kpi.js';
import { addRequest, buildRegistry } from './module-registry-view-core.js';
import { registryPanel } from './module-registry-panel.js';
import { addColumnsPanel } from './module-add-columns-panel.js';
import { supportsColumns, userTables } from './module-add-columns-core.js';
import { bindBlockColumns, saveBlockColumns } from './module-add-columns-client.js';
import { blockCardModel, chartViews, hasBlockCard, placeBlockCard } from './module-block-card-core.js';
import { blockCardView, blockChoices } from './module-block-card-view.js';
import { linkPanel } from './table-link-panel.js';
import { snapshotPanel } from './table-link-snapshot-panel.js';
import { snapshotInfo } from './table-link-snapshot-core.js';
import { replaceSnapshotRows } from './table-link-snapshot-client.js';
import { deleteLinksNote, linkCoverageViews, relatedLine } from './table-link-view-core.js';
import { updatePanel } from './dashboard-module-update.js';
import {
  buildImport,
  correctionOutcome,
  correctionRecords,
  describePlan,
  importGaps,
  importRows,
  planImport,
  rankSheets,
  reviewState,
  sheetOptionLabel,
} from './dashboard-module-source-core.js';

// Автономний файл (script/build_standalone.mjs) не має висот рельєфу, тож 3D-сцена й three.js у нього не
// вбудовуються: збірка підставляє true, і гілка з import() відкидається.
const withoutRelief = typeof __EW_NO_WEATHER_RELIEF__ !== 'undefined' && __EW_NO_WEATHER_RELIEF__;
const loadRelief = withoutRelief ? null : () => import('./dashboard-module-weather-3d.js');

// Модулям потрібна локальна SQLite застосунку; в автономному файлі її немає, тож збірка підставляє true
// і весь каталог із діаграмами з файлу випадає.
const withoutCatalog = typeof __EW_NO_MODULE_CATALOG__ !== 'undefined' && __EW_NO_MODULE_CATALOG__;
const invoke = window.__TAURI_INTERNALS__?.invoke || window.parent?.__TAURI_INTERNALS__?.invoke;
if (!withoutCatalog && typeof invoke === 'function') initialize();

// Запис редагується прямо в рядку таблиці, а форма з підказками стоїть над нею; поля з'єднано з формою
// атрибутом `form`. Колонки «№» і «Дія» закріплено по краях; їх ширину задає CSS (`ewmc-col-number`,
// `ewmc-col-action`), а тут вона потрібна лише для мінімальної ширини всієї таблиці.
const ROW_FORM_ID = 'ewmc-row-form';
const NUMBER_COLUMN_WIDTH = 52;
const ACTION_COLUMN_WIDTH = 176;
// Щільність таблиці — зручність одного користувача на цьому пристрої, не дані: її можна загубити без шкоди.
const DENSITY_KEY = 'easywar.moduleTable.density';
const readDensity = () => { try { return localStorage.getItem(DENSITY_KEY); } catch (error) { return null; } };
const saveDensity = value => { try { localStorage.setItem(DENSITY_KEY, value); } catch (error) { /* діє до перезавантаження */ } };
/** Скільки зауважень показує екран «Перевірка» за раз: решта — у самій таблиці. */
const REVIEW_LIMIT = 200;
const ISSUE_KINDS = { unreadable: 'не розібрано', skipped: 'запис пропущено', rule: 'правило форми' };
const WEATHER_HINT_TEXT = 'Чотири числа: хмарність, НМХ, ВМХ, видимість — наприклад 5/300/1000/10.';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && value && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

// Стилі оформлення модулів — окремий файл у public/: він потрібен лише тут, у застосунку з Tauri.
// Шрифти «Пункт керування» лежать у heightwell-theme.css; ui-kit.js підвантажує його на вимогу.
// Без них картка лишається нічною, лише з системними шрифтами.
function loadStyleSheet() {
  if (document.getElementById('ewmc-style-css')) return;
  document.head.append(el('link', { id: 'ewmc-style-css', rel: 'stylesheet', href: './module-styles.css' }));
}

function loadStyleFonts(style) {
  if (style === 'heightwell') window.EWUiSkin?.loadCss?.();
}

function initialize() {
  const branch = branchFromLocation(location.pathname, location.search);
  const toolbar = document.querySelector('.appbar-right');
  const dashboard = branch === 'dshv' ? document.querySelector('#view-udshv') : document.querySelector('#view-dash');
  if (!toolbar || !dashboard) return;
  loadStyleSheet();

  // `cancelEdit` — скасування рядка, що редагується: Escape скасовує правку, а не закриває вікно разом із набраним рядком.
  // `tableViews` — пошук і група колонок сторінки кожного модуля: після збереження рядка сторінка перебудовується, а вибір лишається.
  const state = { branch, catalog: [], modules: [], data: new Map(), busy: false, profileMissing: false, cancelEdit: null, tableViews: new Map(), leaveReview: null, layout: null, schema: null, registry: null, syncing: null };
  const openButton = el('button', {
    type: 'button',
    class: 'btn quiet ewmc-open',
    text: 'Каталог модулів',
    title: 'Додати аналітичний модуль і створити його локальну таблицю SQLite',
  });
  toolbar.prepend(openButton);

  const host = el('section', { class: 'ewmc-host', 'aria-labelledby': 'ewmc-host-title' });
  // «Мій дашборд» — окрема вкладка лівого меню, а не блок під дашбордом. ПВК і УДШВ самі малюють вкладку
  // й порожню сторінку з позначкою MINE_SLOT; у ПС і РВ вкладку в бічне меню додає цей скрипт (legacy-сторінку
  // не змінюємо). Секція живе лише там, де відкрита вкладка, тож дашборди її не бачать.
  const mineButton = el('button', { type: 'button', class: 'snav-b ewmc-mine-tab', 'aria-pressed': 'false', 'data-action': 'open-my-dashboard' },
    el('span', { class: 'ewmc-mine-icon', 'aria-hidden': 'true' }), el('span', { text: MINE_LABEL }));
  let legacyMine = false;
  const setLegacyMine = open => {
    legacyMine = open;
    document.body.classList.toggle('ewmc-mine-open', open);
    mineButton.setAttribute('aria-pressed', String(open));
    mineButton.classList.toggle('on', open);
    placeHost();
    if (open) {
      markLegacyNav();
      window.scrollTo({ top: 0 });
    // Дашборд сам вирішує, який пункт меню підсвітити, коли прокручується; після повернення просимо його це зробити.
    } else window.dispatchEvent(new Event('scroll'));
  };
  mineButton.addEventListener('click', () => setLegacyMine(true));
  // Підсвітка бічного меню: поки відкрито «Мій дашборд», інші пункти не позначені, а повзунок стоїть на ньому.
  function markLegacyNav() {
    const nav = mineButton.parentElement;
    if (!legacyMine || !nav) return;
    // Лише справжні зміни: кожна зміна класу знову будить спостерігача.
    for (const other of nav.querySelectorAll('.snav-b.on')) if (other !== mineButton) other.classList.remove('on');
    if (!mineButton.classList.contains('on')) mineButton.classList.add('on');
    nav.style.setProperty('--iy', `${mineButton.offsetTop}px`);
    nav.style.setProperty('--ih', `${mineButton.offsetHeight}px`);
  }
  function placeHost() {
    const slot = dashboard.querySelector(`[${MINE_SLOT}]`);
    const nav = dashboard.querySelector(':scope > .side .snav');
    if (nav && !nav.contains(mineButton)) {
      nav.insertBefore(mineButton, nav.querySelector(':scope > .snav-entry'));
      // Будь-який інший пункт меню повертає до дашборда.
      nav.addEventListener('click', event => {
        const button = event.target.closest('.snav-b');
        if (legacyMine && button && button !== mineButton) setLegacyMine(false);
      });
    }
    // Таблицю закрили (бічне меню сховане) або відкрили ПВК: особиста вкладка ПС/РВ закривається разом із меню.
    if (legacyMine && (!nav || nav.closest('.side')?.hidden)) {
      legacyMine = false;
      document.body.classList.remove('ewmc-mine-open');
      mineButton.setAttribute('aria-pressed', 'false');
      mineButton.classList.remove('on');
    }
    const target = slot || (legacyMine ? dashboard.querySelector(':scope > .dmain') : null);
    if (target) { if (host.parentElement !== target) target.append(host); }
    else if (host.isConnected) host.remove();
  }
  const observer = new MutationObserver(() => { placeHost(); markLegacyNav(); });
  observer.observe(dashboard, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  placeHost();

  const dialog = el('dialog', { class: 'ewmc-dialog', 'aria-labelledby': 'ewmc-dialog-title' });
  document.body.append(dialog);
  // Escape на сторінці модуля: спершу скасовує рядок, що редагується, і лише потім повертає на дашборд.
  // Каталог і форма створення закриваються як звичайне вікно.
  dialog.addEventListener('cancel', event => {
    // Escape на екрані «Перевірка» повертає до форми створення, не гублячи ні її, ні виправлень.
    if (dialog.dataset.view === 'review') {
      event.preventDefault();
      state.leaveReview?.();
      return;
    }
    if (dialog.dataset.view !== 'table') return;
    event.preventDefault();
    if (state.busy) return;
    if (state.cancelEdit) state.cancelEdit();
    else closePage();
  });
  dialog.addEventListener('close', () => {
    state.cancelEdit = null;
    if (dialog.dataset.view === 'table') {
      // Роль «Дата події» могли підтвердити на сторінці модуля: період карток читає свіжу схему.
      refreshSchema().then(() => { if (state.layout) renderHost(); focusModuleButton(dialog.dataset.module); });
    }
  });

  // Картки дашборда перемальовуються після кожного збереження, тож фокус іде на нову кнопку цього модуля.
  function focusModuleButton(moduleId) {
    [...host.querySelectorAll('[data-action="open-page"]')].find(button => button.dataset.moduleId === moduleId)?.focus();
  }

  function closePage() {
    const moduleId = dialog.dataset.module;
    dialog.close();
    focusModuleButton(moduleId);
  }

  openButton.addEventListener('click', async () => {
    if (!state.catalog.length) await loadCatalog();
    showCatalog();
  });

  async function loadCatalog() {
    try {
      state.catalog = normalizeCatalog(await invoke('get_dashboard_module_catalog'));
    } catch (error) {
      showToast(String(error || 'Не вдалося відкрити каталог модулів.'), true);
    }
  }

  async function loadModules() {
    state.profileMissing = false;
    try {
      state.modules = normalizeModules(await invoke('list_dashboard_modules', { branch: state.branch }));
      // Порожній набір після збою не можна редагувати: збереження стерло б наявні рядки.
      const loaded = await Promise.all(state.modules.map(async module => [module.id, await readModulePayload(invoke, module)]));
      state.data = new Map(loaded);
      state.syncing = keepProfileSchema(syncProfileSchemaModules(invoke, state.modules));
      await syncLayout().catch(error => { state.layout = null; console.warn('Розкладку дашборда не прочитано:', error); });
    } catch (error) {
      state.modules = [];
      state.data.clear();
      state.layout = null;
      state.profileMissing = /профіл/i.test(String(error));
    }
    renderHost();
  }

  // Розкладка (E4): кожен модуль має картку; збій розкладки не ховає модулі — дашборд тоді малює їх по одній, як раніше.
  async function syncLayout() {
    const result = await updateDashboardLayout(invoke, layout => ensureModuleInstances(layout, state.modules));
    state.layout = result.ok ? result.layout : null;
    if (!result.ok && result.code !== 'profile_required') console.warn('Розкладку дашборда не прочитано:', result.message);
    await refreshSchema();
  }

  async function refreshSchema() {
    const schema = await loadProfileSchema(invoke);
    state.schema = schema.ok ? schema.schema : null;
  }

  // Рішення про зв'язок: прочитати → змінити → зберегти (як решта схеми); при збої схема лишається попередньою.
  async function applyLinkChange(change) {
    const result = await updateProfileSchema(invoke, change);
    if (result.ok) state.schema = result.schema;
    else if (result.code === 'stale') await refreshSchema();
    return result;
  }

  // Об'єднана таблиця стає окремим модулем «Мого дашборда» (той самий `create_dashboard_module`, стовпці задає запит);
  // вихідні таблиці не змінюються. Після успіху панель перемальовується разом зі списком модулів.
  async function createMergedModule(request, origin = null) {
    if (state.busy) return { ok: false, message: 'Зачекайте: інша дія ще триває.' };
    state.busy = true;
    try {
      const created = normalizeModules([await invoke('create_dashboard_module', request)])[0];
      await loadModules();
      showToast(`Модуль «${request.title}» створено: ${rowCountLabel(request.rows.length)}.`);
      // Знімок запам'ятовується окремо: збій його запису не псує створений модуль, а лише забирає «Оновити з вихідних».
      if (created && origin?.relationId) {
        await state.syncing;
        const saved = await applyLinkChange(schema => setSnapshot(schema, { sourceId: moduleSourceId(created.id), relationId: origin.relationId, builtAt: new Date().toISOString(), rowCount: request.rows.length }));
        if (!saved.ok) showToast('Таблицю створено, але оновлення з вихідних для неї недоступне.', true);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error || 'Не вдалося створити модуль.') };
    } finally {
      state.busy = false;
    }
  }

  // Блок реєстру → основна таблиця (E5): стовпці, яких блоку бракує, додаються в таблицю (або створюється основна таблиця
  // гілки), потім ролі блока зіставляються з її стовпцями. Збій зіставлення не псує додані стовпці: їх видно в схемі профілю.
  async function addBlockColumns({ definition, plan, module }) {
    if (state.busy) return { ok: false, message: 'Зачекайте: інша дія ще триває.' };
    state.busy = true;
    try {
      const saved = normalizeModules([await saveBlockColumns(invoke, { branch: state.branch, module, plan })])[0];
      if (!saved) return { ok: false, message: 'Таблицю збережено, але відповідь не прочитано. Закрийте вікно й відкрийте знову.' };
      await loadModules();
      await state.syncing;
      const bound = await bindBlockColumns(invoke, { module: saved, plan, at: new Date().toISOString() });
      if (bound.ok) state.schema = bound.schema;
      const done = [];
      if (plan.fields.length) done.push(`стовпці додано в таблицю «${saved.title}»`);
      if (plan.bindings.length) done.push(bound.ok ? 'ролі блока зіставлено' : `ролі не зіставлено (${bound.message || 'збій схеми'}): зіставте їх у «Ролях стовпців»`);
      // Блок, що вміє рахуватися з основної таблиці, стає карткою «Мого дашборда» на цій таблиці (E5, крок 4).
      if (bound.ok && hasBlockCard(definition.definitionId)) {
        const sourceId = moduleSourceId(saved.id);
        const count = () => state.layout?.instances.filter(item => item.definitionId === definition.definitionId && item.sourceId === sourceId).length ?? 0;
        const before = count();
        await changeLayout(layout => placeBlockCard(layout, { definition, sourceId, freshTable: !module }));
        done.push(count() > before ? `картку «${definition.title}» поставлено на «Мій дашборд»` : 'картку не поставлено');
      }
      const line = done.join(', ') || 'нічого не змінено';
      showToast(`${line[0].toUpperCase()}${line.slice(1)}.`, !bound.ok);
      return { ok: true, message: `${bound.ok ? 'Готово' : 'Частково'}: ${line}.` };
    } catch (error) {
      return { ok: false, message: String(error || 'Не вдалося додати стовпці.') };
    } finally {
      state.busy = false;
    }
  }

  // Вихідні таблиці знімка читаються наново з SQLite (не з кешу сторінки), щоб оновлення спиралося на актуальні дані.
  async function readSnapshotSources(module) {
    const info = state.schema ? snapshotInfo(state.schema, module) : null;
    if (!info?.relation) return { ok: false, message: 'Зв’язок, з якого створено таблицю, знято або замінено. Оновлення неможливе.' };
    const data = new Map(state.data);
    for (const sourceId of info.sourceIds) {
      const source = state.modules.find(item => moduleSourceId(item.id) === sourceId);
      if (!source) return { ok: false, message: 'Вихідну таблицю видалено: оновлення неможливе.' };
      data.set(source.id, await readModulePayload(invoke, source));
    }
    return { ok: true, modules: state.modules, data };
  }

  // Заміна рядків знімка: той самий запис, що й решта правок (з позначкою версії), потім знімок і сторінка перемальовуються.
  async function applySnapshotRefresh(module, view) {
    if (state.busy) return { ok: false, message: 'Зачекайте: інша дія ще триває.' };
    state.busy = true;
    try {
      let result;
      try {
        result = await replaceSnapshotRows(invoke, module, view.request.rows);
      } catch (error) {
        if (isConflictError(error)) {
          state.busy = false;
          await reopenFresh(module.id, 'Таблицю змінено в іншому вікні. Показано актуальні дані — повторіть оновлення.');
          return { ok: true };
        }
        return { ok: false, message: String(error?.message || error || 'Не вдалося оновити таблицю.') };
      }
      const updated = normalizeModules([result?.module])[0] || module;
      state.modules = state.modules.map(item => item.id === module.id ? updated : item);
      state.data.set(module.id, {
        module: updated,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        truncated: result?.truncated === true,
        corrections: Array.isArray(result?.corrections) ? result.corrections : [],
      });
      const info = snapshotInfo(state.schema, module);
      const saved = info ? await applyLinkChange(schema => setSnapshot(schema, { sourceId: moduleSourceId(module.id), relationId: info.entry.relationId, builtAt: new Date().toISOString(), rowCount: view.rowCount })) : { ok: true };
      renderHost();
      showModulePage(updated);
      showToast(saved.ok ? `Таблицю оновлено з вихідних: ${rowCountLabel(view.rowCount)}.` : `Таблицю оновлено: ${rowCountLabel(view.rowCount)}, але дату оновлення не збережено.`, !saved.ok);
      return { ok: true };
    } finally {
      state.busy = false;
    }
  }

  // Рядок «Зв'язано з: …» на картках оновлюється на місці, щоб не перемальовувати панель під час роботи з нею.
  function refreshRelatedLines() {
    for (const node of host.querySelectorAll('[data-related-for]')) {
      const text = state.schema ? relatedLine(state.schema, `module:${node.dataset.relatedFor}`) : '';
      node.textContent = text;
      node.hidden = !text;
    }
    for (const list of host.querySelectorAll('[data-related-stats-for]')) fillCoverage(list, list.dataset.relatedStatsFor);
    for (const node of host.querySelectorAll('[data-delete-links-for]')) {
      const text = state.schema ? deleteLinksNote(state.schema, `module:${node.dataset.deleteLinksFor}`) : '';
      node.textContent = text;
      node.hidden = !text;
    }
  }

  const localDay = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  // Зміна розкладки: прочитати → змінити → зберегти; картки перемальовуються з результату.
  async function changeLayout(change, message = '') {
    const result = await updateDashboardLayout(invoke, change);
    if (!result.ok) {
      showToast(result.code === 'stale' ? 'Розкладку змінено в іншому місці. Спробуйте ще раз.' : `Не збережено: ${result.message}`, true);
      const fresh = await loadDashboardLayout(invoke);
      if (fresh.ok) state.layout = fresh.layout;
    } else {
      state.layout = result.layout;
      if (message) showToast(message);
    }
    renderHost();
  }

  // Схема профілю (E3) допоміжна: збій її запису не повинен заважати модулям, тож лише попередження в консолі.
  function keepProfileSchema(pending) {
    return pending.then(result => {
      if (!result.ok && result.code !== 'profile_required') console.warn('Схема профілю не оновлена:', result.message);
    }).catch(error => console.warn('Схема профілю не оновлена:', error));
  }

  function renderHost() {
    host.replaceChildren(
      el('header', { class: 'ewmc-host-head' },
        el('div', {},
          el('p', { class: 'ewmc-eyebrow', text: 'Користувацькі модулі' }),
          el('h2', { id: 'ewmc-host-title', text: 'Мій дашборд' }),
          el('p', { class: 'ewmc-sub', text: 'Кожен модуль має власну локальну таблицю SQLite з перевіреними колонками.' })),
        el('button', { type: 'button', class: 'btn primary ewmc-add', text: '+ Додати модуль', onclick: openButton.click.bind(openButton) })),
    );
    if (state.profileMissing) {
      host.append(el('p', { class: 'ewmc-empty', text: 'Увійдіть у локальний профіль, щоб створювати й бачити власні модулі.' }));
      return;
    }
    if (!state.modules.length) {
      host.append(el('p', { class: 'ewmc-empty', text: 'Модулів ще немає. Відкрийте каталог і виберіть потрібну візуалізацію.' }));
      return;
    }
    const grid = el('div', { class: 'ewmc-dashboard-grid' });
    if (state.layout) {
      host.append(sharedPeriodBar({ el, layout: state.layout, onChange: period => changeLayout(layout => setSharedPeriod(layout, period)) }));
      const today = localDay();
      const cards = orderedCards(state.layout, state.modules);
      grid.dataset.layout = 'cards';
      cards.forEach(({ instance, module, at }, index) => {
        const payload = state.data.get(module.id);
        const model = cardModel({ layout: state.layout, schema: state.schema, instance, rows: cardReadState(payload).rows, today });
        grid.append(renderModule(module, payload, { instance, model, width: at.w, before: cards[index - 1]?.instance.id || '', after: cards[index + 1]?.instance.id || '' }));
      });
    } else {
      for (const module of state.modules) grid.append(renderModule(module, state.data.get(module.id)));
    }
    // Зв'язки між таблицями (E3б, B1/B3): підказки й рішення людини; потрібні щонайменше дві таблиці.
    if (state.modules.length >= 2 && state.schema) host.append(linkPanel({ el, schema: () => state.schema, modules: () => state.modules, data: () => state.data, apply: applyLinkChange, onChange: refreshRelatedLines, createModule: createMergedModule }));
    host.append(grid, ticker(tickerItems(state.modules, state.data)));
  }

  // Бігучий рядок під картками: стан усіх модулів одним рядком. Друга копія лише для безшовного
  // кола й прихована від читачів екрана; при «зменшити рух» рядок стоїть і прокручується вручну.
  function ticker(items) {
    const node = item => el('li', { class: item.failed ? 'is-failed' : '' }, el('b', { text: item.title }), el('span', { text: item.text }));
    return el('div', { class: 'ewmc-ticker', role: 'region', 'aria-label': 'Стрічка модулів', style: { '--ewmc-ticker-s': `${Math.max(24, items.length * 9)}s` } },
      el('div', { class: 'ewmc-ticker-track' },
        el('ul', {}, items.map(node)),
        el('ul', { 'aria-hidden': 'true' }, items.map(node))));
  }

  // Повторне читання лише цього модуля: решта карток не перемальовується з нуля.
  async function retryRead(module, button) {
    if (button) button.disabled = true;
    const payload = await readModulePayload(invoke, module);
    state.data.set(module.id, payload);
    if (payload.failed) showToast(`Не вдалося прочитати модуль «${module.title}».`, true);
    renderHost();
  }

  function deleteNote(module) {
    const text = state.schema ? deleteLinksNote(state.schema, `module:${module.id}`) : '';
    return el('p', { class: 'ewmc-delete-links', 'data-delete-links-for': module.id, text, hidden: !text });
  }

  function relatedNote(module) {
    const text = state.schema ? relatedLine(state.schema, `module:${module.id}`) : '';
    const stats = el('ul', { class: 'ewmc-related-stats', 'data-related-stats-for': module.id, hidden: true });
    fillCoverage(stats, module.id);
    return el('div', { class: 'ewmc-related-box' }, el('p', { class: 'ewmc-related', 'data-related-for': module.id, text, hidden: !text }), stats);
  }

  // Читання за зв'язком: скільки рядків мають пару за підтвердженим ключем. Рахується після малювання, щоб не затримувати дашборд.
  function fillCoverage(list, moduleId) {
    setTimeout(() => {
      if (!list.isConnected || !state.schema) return;
      const views = linkCoverageViews(state.schema, `module:${moduleId}`, state.modules, state.data);
      list.replaceChildren(...views.map(view => el('li', { class: view.warn ? 'is-warn' : '', 'data-relation-id': view.relationId, text: view.text })));
      list.hidden = !views.length;
    }, 0);
  }

  // Смужка налаштувань картки розкладки: період, копія, прибрати, розмір, стиль, порядок.
  function cardTools(module, placed) {
    return instanceBar({
      el,
      instance: placed.instance,
      model: placed.model,
      onPeriod: period => changeLayout(layout => updateInstance(layout, placed.instance.id, { period })),
      onDuplicate: () => changeLayout(layout => duplicateInstance(layout, placed.instance.id), 'Картку скопійовано: змініть їй період.'),
      onRemove: () => changeLayout(layout => removeInstance(layout, placed.instance.id), 'Картку прибрано; таблиця й дані модуля лишились.'),
      width: placed.width,
      canEarlier: Boolean(placed.before),
      canLater: Boolean(placed.after),
      onSize: width => changeLayout(layout => resizeInstance(layout, placed.instance.id, width)),
      style: cardStyle(module.style, placed.instance),
      onStyle: background => changeLayout(layout => updateInstance(layout, placed.instance.id, { style: { background } })),
      onMove: direction => changeLayout(layout => moveInstance(layout, placed.instance.id, direction < 0 ? placed.before : placed.after)),
    });
  }

  // Картку можна кинути на іншу: вона стає на її місце (ручка перетягування — в смужці картки).
  function dropTarget(card, placed) {
    card.addEventListener('dragover', event => event.preventDefault());
    card.addEventListener('drop', event => {
      event.preventDefault();
      const draggedId = event.dataTransfer?.getData('text/plain');
      if (draggedId && draggedId !== placed.instance.id) changeLayout(layout => moveInstance(layout, draggedId, placed.instance.id));
    });
    return card;
  }

  function renderModule(module, payload, placed = null) {
    const { state: readState, rows: allRows } = cardReadState(payload);
    // Картка розкладки показує рядки свого періоду; без розкладки — усі, як раніше.
    const rows = placed?.model.ok ? placed.model.rows : allRows;
    const failed = readState === 'failed';
    // Картка блока реєстру (E5): рахується з рядків основної таблиці за підтвердженими ролями, а не діаграмою шаблону.
    const definitionId = placed?.instance.definitionId;
    const block = hasBlockCard(definitionId)
      ? blockCardModel({ definition: registryDefinitions().find(item => item.definitionId === definitionId), schema: state.schema, sourceId: placed.instance.sourceId, rows, view: placed.instance.style?.view })
      : null;
    // Картка блока — компактна, у дусі вкладок ПС і РВ; налаштування за «⋯», без дій над таблицею.
    if (block) {
      const style = cardStyle(module.style, placed.instance);
      loadStyleFonts(style);
      return dropTarget(blockCardView({
        el, module, placed, block, style, failed,
        palette: placed.instance.style?.accent || '',
        tools: placed.model.ok ? el('div', { class: 'ewmc-card-menu' }, cardTools(module, placed), blockChoices({
          el,
          views: chartViews(definitionId),
          view: placed.instance.style?.view || '',
          palette: placed.instance.style?.accent || '',
          onView: view => changeLayout(layout => updateInstance(layout, placed.instance.id, { style: { view } })),
          onPalette: accent => changeLayout(layout => updateInstance(layout, placed.instance.id, { style: { accent } })),
        })) : null,
        visual: blockVisual,
        retry: event => retryRead(module, event.currentTarget),
      }), placed);
    }
    // Видалення питає підтвердження прямо в картці: модуль зникає разом зі своєю таблицею SQLite.
    const removeButton = el('button', {
      type: 'button',
      class: 'btn quiet ewmc-danger',
      text: 'Видалити модуль і дані',
      title: 'Назавжди видалити модуль разом із його локальною таблицею та всіма записами',
      'data-action': 'delete-module',
      'data-module-id': module.id,
    });
    const keepButton = el('button', { type: 'button', class: 'btn quiet', text: 'Залишити' });
    const confirmButton = el('button', { type: 'button', class: 'btn ewmc-danger solid', text: 'Так, видалити', 'data-action': 'confirm-delete-module' });
    const confirmBox = el('div', { class: 'ewmc-confirm ewmc-module-confirm', role: 'group', 'aria-label': `Видалення модуля ${module.title}`, hidden: true },
      el('p', { text: deleteModulePrompt(module) }),
      deleteNote(module),
      el('div', { class: 'ewmc-confirm-actions' }, keepButton, confirmButton));
    const ask = asking => {
      confirmBox.hidden = !asking;
      removeButton.hidden = asking;
      (asking ? keepButton : removeButton).focus();
    };
    removeButton.addEventListener('click', () => ask(true));
    keepButton.addEventListener('click', () => ask(false));
    confirmButton.addEventListener('click', () => deleteModule(module, [keepButton, confirmButton]));
    const shownStyle = placed ? cardStyle(module.style, placed.instance) : module.style;
    loadStyleFonts(shownStyle);
    const schemaBox = el('details', { class: 'ewmc-schema' },
      el('summary', { text: 'Структура таблиці' }),
      el('code', { text: module.storageTable }),
      el('p', { text: schemaSummary(module.fields) }));
    // На «Моєму дашборді» налаштування картки, видалення й структура таблиці сховані за «⋯», як у карток блоків.
    const tools = placed?.model.ok
      ? el('details', { class: 'ewmc-block-tools' },
        el('summary', { text: '⋯', title: 'Налаштувати картку', 'aria-label': 'Налаштувати картку' }),
        el('div', { class: 'ewmc-card-menu' }, cardTools(module, placed), removeButton, confirmBox, schemaBox))
      : null;
    const card = el('article', {
      class: placed ? 'ewmc-module' : `ewmc-module span-${module.defaultSpan === 2 ? 2 : 1}`,
      style: placed ? { gridColumn: `span ${placed.width}` } : null,
      'data-kind': module.visualKind,
      'data-style': shownStyle,
      'data-branch': module.branch,
      'data-instance-id': placed?.instance.id,
    },
      el('header', { class: 'ewmc-module-head' },
        el('div', {}, el('h3', { text: placed?.instance.title || module.title }), el('p', { text: `${rowCountLabel(module.rowCount)} · локальна SQLite${placed?.model.ok ? ` · ${placed.model.periodLabel}` : ''}` })),
        el('div', { class: 'ewmc-head-side' },
          el('span', { class: `ewmc-live${failed ? ' is-failed' : ''}`, text: failed ? 'Не прочитано' : module.rowCount ? 'Дані' : 'Створено' }),
          tools)),
      failed
        ? el('div', { class: 'ewmc-visual ewmc-read-failed', role: 'alert' },
          el('p', { text: `${CARD_FAILED_TEXT}. Показник не можна вважати нульовим: записи в таблиці збережені.` }),
          el('button', { type: 'button', class: 'btn quiet', text: 'Прочитати знову', 'data-action': 'retry-read', 'data-module-id': module.id, onclick: event => retryRead(module, event.currentTarget) }))
        : visual(module, rows),
      failed ? null : takeoffVisual(module, rows),
      relatedNote(module),
      el('div', { class: 'ewmc-module-actions' },
        el('button', {
          type: 'button',
          class: 'btn quiet',
          text: 'Відкрити сторінку',
          title: 'Окрема сторінка з усією таблицею модуля',
          'data-action': 'open-page',
          'data-module-id': module.id,
          // Сторінка відкривається з курсором на «+ Додати рядок»: журнал частіше доповнюють, ніж читають.
          onclick: () => showModulePage(module, 'add'),
        }),
        module.visualKind === 'weather' && loadRelief ? el('button', {
          type: 'button',
          class: 'btn quiet',
          text: '3D-рельєф',
          title: 'Рельєф України з хмарами над пунктами на весь екран',
          'data-action': 'open-relief',
          'data-module-id': module.id,
          disabled: !rows.length,
          onclick: event => openRelief(module, rows, event.currentTarget),
        }) : null,
        tools ? null : removeButton),
      tools ? null : confirmBox,
      tools ? null : schemaBox,
    );
    if (readState === 'empty') card.querySelector('.ewmc-visual')?.append(el('p', { class: 'ewmc-no-data', text: 'Таблиця готова · даних ще немає' }));
    return placed ? dropTarget(card, placed) : card;
  }

  async function deleteModule(module, buttons) {
    if (state.busy) return;
    state.busy = true;
    for (const button of buttons) button.disabled = true;
    try {
      const result = await runModuleDelete(invoke, module);
      if (result.status === 'deleted') {
        state.tableViews.delete(module.id);
        keepProfileSchema(forgetProfileSchemaModule(invoke, module.id));
        await updateDashboardLayout(invoke, layout => forgetModuleInstances(layout, module.id)).catch(() => null);
        showToast(`Модуль «${module.title}» видалено.`);
        await loadModules();
        host.querySelector('.ewmc-add')?.focus();
      } else if (result.status === 'conflict') {
        // Нічого не видалено: показуємо актуальну картку й чекаємо нового підтвердження.
        await loadModules();
        showToast(result.message, true);
      } else {
        showToast(result.message, true);
        for (const button of buttons) button.disabled = false;
      }
    } finally {
      state.busy = false;
    }
  }

  // 3D-сцена завантажується лише на вимогу: three.js і висоти рельєфу не потрібні решті дашборда.
  async function openRelief(module, rows, button) {
    if (!loadRelief) return;
    if (button) button.disabled = true;
    try {
      const { openWeatherRelief } = await loadRelief();
      await openWeatherRelief({ model: chartModel(module, rows), title: module.title, returnFocus: button });
    } catch (error) {
      showToast(String(error?.message || error || 'Не вдалося відкрити 3D-рельєф.'), true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function showCatalog() {
    const search = el('input', { type: 'search', class: 'ewmc-search', placeholder: 'Пошук за типом, полем або призначенням…', 'aria-label': 'Пошук у каталозі модулів' });
    const list = el('div', { class: 'ewmc-catalog-grid' });
    const paint = () => {
      list.replaceChildren();
      const filtered = state.catalog.filter(item => matchesCatalogItem(item, search.value));
      for (const item of filtered) list.append(catalogCard(item));
      if (!filtered.length) list.append(el('p', { class: 'ewmc-empty', text: 'За цим запитом модулів не знайдено.' }));
    };
    search.addEventListener('input', paint);
    dialog.replaceChildren(
      el('form', { method: 'dialog', class: 'ewmc-dialog-head' },
        el('div', {}, el('p', { class: 'ewmc-eyebrow', text: 'Аналітика' }), el('h2', { id: 'ewmc-dialog-title', text: 'Каталог модулів' }), el('p', { text: 'Оберіть вигляд. EasyWAR створить картку та окрему таблицю з відповідними колонками.' })),
        el('button', { value: 'cancel', class: 'ewmc-close', 'aria-label': 'Закрити', text: '×' })),
      el('div', { class: 'ewmc-catalog-tools' }, search,
        el('button', { type: 'button', class: 'btn quiet', text: 'Усі визначення', 'data-action': 'show-registry', title: 'Усі блоки дашбордів і шаблони з описом потрібних даних', onclick: showRegistry })),
      list,
    );
    paint();
    dialog.dataset.view = 'catalog';
    if (!dialog.open) dialog.showModal();
    search.focus();
  }

  // Екран «Усі визначення» (реєстр E1): шаблони «Мого дашборда», картки ПС і блоки вкладок з описом потрібних даних.
  // Додати одним натисканням можна лише шаблон «Мого дашборда»: це той самий `create_dashboard_module`, що й у формі
  // створення (назва шаблону, стиль «Звичайний», без підтягування з таблиці); картку на дашборді ставить розкладка E4.
  function registryDefinitions() {
    if (!state.registry) {
      state.registry = buildRegistry({ rustTemplates: state.catalog, catalogs: [PS_CATALOG], catalogUsage: psCatalogUsage(KPI_TILES, VIEW_BY_BLOCK) });
      if (state.registry.problems.length) console.warn('Реєстр визначень модулів:', state.registry.problems.join('; '));
    }
    return state.registry.definitions;
  }

  function showRegistry() {
    registryDefinitions();
    const available = new Set(state.catalog.map(item => item.id));
    const panel = registryPanel({
      el, definitions: state.registry.definitions, available, branch: state.branch, branchLabel: BRANCH_LABELS[state.branch] || '',
      onBack: showCatalog,
      columnsBox: definition => !supportsColumns(definition) ? null : addColumnsPanel({
        el, definition, schema: () => state.schema, apply: addBlockColumns, placeable: hasBlockCard(definition.definitionId),
        tables: () => userTables(state.modules).filter(module => module.branch === state.branch),
      }),
      onAdd: async definition => {
        const request = addRequest(definition, state.branch, { available });
        if (!request || state.busy) return;
        state.busy = true;
        try {
          await invoke('create_dashboard_module', request);
          await loadModules();
          showToast(`Модуль «${request.title}» додано на «Мій дашборд».`);
        } catch (error) {
          showToast(String(error || 'Не вдалося додати модуль.'), true);
        } finally {
          state.busy = false;
        }
      },
    });
    dialog.replaceChildren(
      el('form', { method: 'dialog', class: 'ewmc-dialog-head' },
        el('div', {}, el('p', { class: 'ewmc-eyebrow', text: 'Аналітика' }), el('h2', { id: 'ewmc-dialog-title', text: 'Усі визначення модулів' }),
          el('p', { text: 'Кожен блок дашбордів і шаблон «Мого дашборда» з описом даних, яких він потребує. Додати на «Мій дашборд» можна шаблони; решта вже стоїть на своїх дашбордах.' })),
        el('button', { value: 'cancel', class: 'ewmc-close', 'aria-label': 'Закрити', text: '×' })),
      panel.node);
    dialog.dataset.view = 'registry';
    if (!dialog.open) dialog.showModal();
    panel.focus();
  }

  function catalogCard(item) {
    return el('article', { class: 'ewmc-catalog-card' },
      el('div', { class: 'ewmc-catalog-top' },
        el('span', { class: 'ewmc-category', text: item.category }),
        el('span', { class: 'ewmc-cols', text: `${item.fields.length} кол.` })),
      visual(item, sampleRows(item), true),
      el('h3', { text: item.title }),
      el('p', { text: item.description }),
      el('div', { class: 'ewmc-fields' },
        item.fields.slice(0, 6).map(field => el('span', { text: field.label })),
        item.fields.length > 6 ? el('span', { text: `+${item.fields.length - 6} полів` }) : null),
      el('button', { type: 'button', class: 'btn primary', text: 'Створити', onclick: () => showCreate(item) }),
    );
  }

  // `preset` — вибір, що переходить з іншого шаблону (таблиця, стовпці, назва й стиль), коли користувач обрав
  // у списку пропозицій інший модуль для тих самих стовпців.
  function showCreate(item, preset = null) {
    const title = el('input', { type: 'text', maxlength: '80', value: preset?.title || item.title, required: true, 'aria-label': 'Назва модуля' });
    // Зразок картки показує обраний стиль у кольорах роду військ цього дашборда. Коли стовпці таблиці вже
    // обрано, замість вигаданих рядків він малюється з рядків користувача (`paintPreview`).
    const preview = el('div', { class: 'ewmc-style-preview', 'data-style': 'standard', 'data-branch': state.branch }, visual(item, sampleRows(item), true));
    const previewNote = el('p', { class: 'ewmc-preview-note', 'aria-live': 'polite' });
    const style = stylePicker(preview, preset?.style);
    const status = el('p', { class: 'ewmc-form-status', 'aria-live': 'polite' });
    const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Створити модуль і таблицю' });
    // Поки таблицю читають, створювати модуль рано: підтягування вже вимкнене за замовчуванням, але не обране.
    const syncSubmit = () => {
      submit.disabled = state.busy || source.pending() || source.unconfirmed();
      submit.title = source.unconfirmed() ? 'Підтвердьте частковий імпорт або вимкніть підтягування' : '';
      paintPreview();
    };
    let shownRows = null;
    function paintPreview() {
      const real = source.previewRows();
      if (real !== shownRows) {
        shownRows = real;
        preview.replaceChildren(visual(item, real ?? sampleRows(item), true));
      }
      previewNote.textContent = !real ? ''
        : source.willImport() ? `Так модуль виглядатиме з вашими даними: ${rowCountLabel(real.length)}.`
          : `Зразок з вашими даними (${rowCountLabel(real.length)}). У модуль вони потраплять, якщо ввімкнути «Підтягнути…» нижче.`;
    }
    const choose = (entry, snapshot) => {
      const edited = title.value.trim() && title.value.trim() !== item.title ? title.value.trim() : '';
      showCreate(entry.template, { ...source.handoff(), ...snapshot, title: edited, style: style.value() });
    };
    const source = sourceBlock(item, syncSubmit, () => showReview(source, form), preset, choose);
    const form = el('form', { class: 'ewmc-create-form' },
      el('button', { type: 'button', class: 'ewmc-back', text: '← До каталогу', onclick: showCatalog }),
      el('p', { class: 'ewmc-eyebrow', text: item.category }),
      el('h2', { id: 'ewmc-dialog-title', text: item.title }),
      // Ліва колонка: вигляд, назва й дані з таблиці; праворуч — довгий список колонок нової таблиці.
      el('div', { class: 'ewmc-create-main' },
        // Картка з підписом лишається вгорі вікна, поки гортають таблицю вибору: видно, що змінює кожне клацання.
        el('div', { class: 'ewmc-create-live' }, preview, previewNote),
        el('label', { class: 'ewmc-field' }, el('span', { text: 'Назва на дашборді' }), title),
        style.node,
        source.node),
      el('section', { class: 'ewmc-table-plan' },
        el('h3', { text: 'Колонки нової таблиці' }),
        el('div', {}, item.fields.map(field => el('div', { class: 'ewmc-plan-row' },
          el('b', { text: field.label }),
          el('code', { text: field.key }),
          el('span', { text: field.dataType }))))),
      status,
      el('div', { class: 'ewmc-form-actions' },
        el('button', { type: 'button', class: 'btn quiet', text: 'Скасувати', onclick: () => dialog.close() }),
        submit),
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || source.pending() || source.unconfirmed()) return;
      state.busy = true;
      syncSubmit();
      const name = title.value.trim();
      const rows = source.rows();
      // Виправлення з екрана «Перевірка» йдуть окремо від записів: Rust зберігає їх у своїй таблиці.
      const corrections = rows ? source.corrections() : [];
      status.classList.remove('error');
      status.textContent = rows ? `Створення локальної таблиці й запис: ${rowCountLabel(rows.length)}…` : 'Створення локальної таблиці…';
      try {
        await invoke('create_dashboard_module', {
          branch: state.branch,
          templateId: item.id,
          title: name,
          style: style.value(),
          ...(rows ? { rows } : {}),
          ...(corrections.length ? { corrections } : {}),
        });
        dialog.close();
        await loadModules();
        const fixed = corrections.length ? `, виправлених значень: ${corrections.length}` : '';
        showToast(rows ? `Модуль «${name}» створено, підтягнуто: ${rowCountLabel(rows.length)}${fixed}.` : `Модуль «${name}» створено.`);
      } catch (error) {
        status.textContent = String(error || 'Не вдалося створити модуль.');
        status.classList.add('error');
      } finally {
        state.busy = false;
        syncSubmit();
      }
    });
    dialog.replaceChildren(form);
    dialog.dataset.view = 'create';
    dialog.addEventListener('close', source.dispose, { once: true });
    title.focus();
    title.select();
    source.start();
  }

  // Вибір стилю оформлення у вікні створення: три варіанти, колір — рід військ цього дашборда.
  function stylePicker(preview, initial = '') {
    const name = 'ewmc-style';
    const node = el('fieldset', { class: 'ewmc-style-picker' },
      el('legend', { text: `Стиль оформлення · кольори ${BRANCH_LABELS[state.branch] || 'роду військ'}` }),
      MODULE_STYLES.map((option, index) => el('label', { class: 'ewmc-style-option', 'data-style': option.id, 'data-branch': state.branch },
        el('input', { type: 'radio', name, value: option.id, checked: initial ? option.id === normalizeStyle(initial) : index === 0, onchange: () => paint() }),
        el('i', { class: 'ewmc-style-swatch', 'aria-hidden': 'true' }),
        el('span', {}, el('b', { text: option.label }), el('small', { text: option.hint })))));
    const value = () => normalizeStyle(node.querySelector(`input[name="${name}"]:checked`)?.value);
    function paint() {
      const current = value();
      loadStyleFonts(current);
      preview.dataset.style = current;
    }
    if (initial) paint();
    return { node, value };
  }

  // Блок «Дані з вашої таблиці» у вікні створення: знаходить таблицю профілю (або файл, який обрав
  // користувач), зіставляє її стовпці з колонками модуля й пропонує підтягнути записи. Файл лише
  // читається. Колонки модуля, яких у таблиці немає, лишаються порожніми: дані вносять у самому модулі.
  // Режим «вручну»: користувач сам клацає стовпці таблиці (`dashboard-module-picker.js`), а програма
  // кладе їх у колонки модуля й пропонує інші модулі для тих самих стовпців. Нижче той самий план:
  // зауваження, перевірка, підтвердження часткового імпорту. `preset` — вибір, що перейшов з іншого шаблону.
  function sourceBlock(item, onChange, openReview, preset = null, onChoose = null) {
    // `corrections` — виправлення з екрана «Перевірка» (ідентифікатор → введений текст); `build` — записи з ними.
    const model = {
      phase: 'loading', pending: true, message: '', origin: '', selection: '', workbook: null, ranked: [], sheet: '', plan: null,
      use: false, carry: true, confirmed: false, corrections: new Map(), build: null,
      mode: 'auto', intro: false, sheetRows: null, picker: null, preview: null,
    };
    let request = 0;
    const body = el('div', { class: 'ewmc-source-body', 'aria-live': 'polite' });
    // План (зауваження, перевірка, галочки) перемальовується окремо від таблиці вибору, щоб клацання не губило фокус.
    const planHost = el('div', { class: 'ewmc-source-plan' });
    const node = el('section', { class: 'ewmc-source', 'aria-labelledby': 'ewmc-source-title' },
      el('h3', { id: 'ewmc-source-title', text: 'Дані з вашої таблиці' }),
      el('p', { class: 'ewmc-source-hint', text: 'Записи беруться з вашої таблиці, а стовпці, яких у ній немає, стають новими колонками модуля — їх заповнюють у самому модулі. Файл таблиці лише читається й не змінюється.' }),
      body);

    function setPhase(phase, message = '') {
      model.phase = phase;
      model.message = message;
      model.pending = phase === 'loading' || phase === 'reading';
      render();
      onChange();
    }

    // Забуває попередній огляд таблиці в Rust (після закриття форми чи вибору іншої таблиці).
    function release() {
      const selection = model.selection;
      model.selection = '';
      if (selection) invoke('read_module_source_sheet', { selection, release: true }).catch(() => {});
    }

    async function start() {
      const id = ++request;
      if (preset?.workbook) {
        // Вибір перейшов з іншого шаблону: таблицю вже прочитано, повторно її не відкриваємо.
        Object.assign(model, { workbook: preset.workbook, origin: preset.origin, selection: preset.selection, ranked: preset.ranked, sheet: preset.sheet, sheetRows: preset.sheetRows });
        startManual({ headerIndex: preset.headerIndex, selected: preset.selected });
        setPhase('ready');
        return;
      }
      setPhase('loading');
      try {
        const workbook = await invoke('inspect_linked_module_source', { branch: state.branch });
        if (id !== request) return;
        if (!workbook) setPhase('none');
        else await useWorkbook(workbook, id);
      } catch (error) {
        if (id === request) setPhase('error', String(error));
      }
    }

    async function pickFile() {
      const id = ++request;
      model.pending = true;
      render();
      onChange();
      try {
        const workbook = await invoke('pick_module_source');
        if (id !== request) return;
        if (workbook) await useWorkbook(workbook, id);
        else setPhase(model.phase, model.message);
      } catch (error) {
        if (id === request) setPhase('error', String(error));
      }
    }

    async function useWorkbook(workbook, id) {
      release();
      model.workbook = workbook;
      model.origin = workbook.origin;
      // Непрозорий ідентифікатор огляду: аркуш читається лише за ним, шляху інтерфейс не знає.
      model.selection = workbook.selection;
      model.ranked = rankSheets(item.fields, workbook);
      const best = model.ranked[0];
      if (!best) setPhase('empty');
      // Назви стовпців нічого не підказали: таблицю все одно можна використати, якщо стовпці обрати самому.
      else if (best.matched === 0) await openManual(best.name, id, true);
      else await openSheet(best.name, id);
    }

    function readSheet(name) {
      return invoke('read_module_source_sheet', { selection: model.selection, sheet: name });
    }

    async function openSheet(name, id = ++request) {
      model.sheet = name;
      setPhase('reading', name);
      try {
        const sheet = await readSheet(name);
        if (id !== request) return;
        Object.assign(model, { mode: 'auto', intro: false, picker: null, sheetRows: sheet });
        model.plan = planImport(item.fields, sheet);
        // Виправлення належать рядкам конкретного аркуша: інший аркуш починає перевірку з чистого.
        model.corrections = new Map();
        model.build = null;
        // Сама вмикається лише повна й чиста таблиця, схожа на модуль; частково схожу або неповну
        // (усічення, пропущені рядки, нерозібрані клітинки, правила форми) користувач вмикає свідомо.
        model.use = model.ranked.find(entry => entry.name === name)?.confident === true && importGaps(model.plan).complete;
        model.confirmed = false;
        // Метеоумови, яких у записі не вказано, за умовчанням беруться з попереднього запису тієї ж льотної зміни.
        model.carry = true;
        setPhase('ready');
      } catch (error) {
        if (id === request) setPhase('error', String(error));
      }
    }

    // Режим «вручну» для аркуша: рядки читаються так само, а зіставлення робить користувач.
    async function openManual(name, id = ++request, intro = false) {
      model.sheet = name;
      setPhase('reading', name);
      try {
        const sheet = await readSheet(name);
        if (id !== request) return;
        model.sheetRows = sheet;
        model.intro = intro;
        startManual({});
        setPhase('ready');
      } catch (error) {
        if (id === request) setPhase('error', String(error));
      }
    }

    function startManual(initial) {
      model.mode = 'manual';
      model.picker = columnPicker({
        item,
        templates: state.catalog,
        sheet: model.sheetRows,
        visual,
        initial,
        onChange: applyBinding,
        onChoose: (entry, snapshot) => onChoose?.(entry, snapshot),
      });
      applyBinding(model.picker.binding(), true);
    }

    // План по стовпцях, які обрав користувач. Виправлення й підтвердження належать конкретному зіставленню, тож скидаються.
    function applyBinding(binding, quiet = false) {
      model.plan = planImport(item.fields, model.sheetRows, { binding });
      model.corrections = new Map();
      model.build = null;
      model.confirmed = false;
      model.carry = true;
      // Увімкнено лише повний і чистий імпорт: частковий користувач вмикає й підтверджує свідомо.
      model.use = model.plan.rows.length > 0 && importGaps(model.plan).complete;
      if (quiet) return;
      renderPlan();
      onChange();
    }

    function fileLine() {
      const where = model.origin === 'linked' ? 'підключена до профілю' : 'обрана вручну';
      return el('p', { class: 'ewmc-source-file' }, `Таблиця «${model.workbook.fileName}» · ${where}`);
    }

    // Коли таблиці ще немає, вибір файла — головна дія блоку; далі це лише запасний шлях.
    function pickButton(label, main = false) {
      return el('button', { type: 'button', class: main ? 'btn' : 'btn quiet', text: label, disabled: model.pending, onclick: pickFile });
    }

    function render() {
      const nodes = [];
      switch (model.phase) {
        case 'loading':
          nodes.push(el('p', { text: 'Шукаю таблицю профілю…' }));
          break;
        case 'reading':
          nodes.push(fileLine(), el('p', { text: `Читаю аркуш «${model.message}»…` }));
          break;
        case 'none':
          nodes.push(el('p', { text: 'До профілю не підключено таблицю. Щоб підтягнути записи, оберіть файл XLSX.' }),
            el('div', { class: 'ewmc-source-actions' }, pickButton('Обрати файл XLSX…', true)));
          break;
        case 'error':
          // Таблицю змінено після огляду чи огляд застарів: її можна перечитати, а не лише обрати інший файл.
          nodes.push(el('p', { class: 'error', text: `Не вдалося прочитати таблицю: ${model.message}` }),
            el('div', { class: 'ewmc-source-actions' },
              el('button', { type: 'button', class: 'btn quiet', text: 'Перечитати таблицю профілю', disabled: model.pending, onclick: start }),
              pickButton('Обрати файл XLSX…', true)));
          break;
        case 'empty':
          nodes.push(fileLine(),
            el('p', { text: 'У таблиці не знайдено аркушів із даними. Модуль буде створено з порожньою таблицею.' }),
            el('div', { class: 'ewmc-source-actions' }, pickButton('Обрати інший файл…')));
          break;
        default:
          nodes.push(...(model.mode === 'manual' ? manualNodes() : readyNodes()));
      }
      body.replaceChildren(...nodes);
    }

    // Вибір аркуша, коли їх кілька: підпис каже, скільки там рядків (для ручного режиму збіги назв ні до чого).
    function sheetSelect(onPick, label) {
      if (model.ranked.length <= 1) return null;
      const select = el('select', { 'aria-label': 'Аркуш таблиці' },
        model.ranked.map(entry => el('option', { value: entry.name, selected: entry.name === model.sheet, text: label(entry) })));
      select.addEventListener('change', () => onPick(select.value));
      return select;
    }

    function manualNodes() {
      const nodes = [fileLine()];
      const select = sheetSelect(name => openManual(name), entry => `${entry.name} · ${entry.rowCount ?? 0} ${pluralForm(entry.rowCount ?? 0, 'рядок', 'рядки', 'рядків')}`);
      if (select) nodes.push(select);
      if (model.intro) {
        nodes.push(el('p', { class: 'ewmc-source-intro' },
          'У таблиці немає аркуша зі стовпцями, схожими на колонки цього модуля. Оберіть потрібні стовпці самі — клацніть їхні заголовки.'));
      }
      nodes.push(model.picker.node, planHost);
      renderPlan();
      const actions = [pickButton('Обрати інший файл…')];
      if (model.ranked.find(entry => entry.name === model.sheet)?.matched > 0) {
        actions.unshift(el('button', { type: 'button', class: 'btn quiet', 'data-action': 'auto-columns', text: 'Підібрати стовпці за назвами', onclick: () => openSheet(model.sheet) }));
      }
      nodes.push(el('div', { class: 'ewmc-source-actions' }, actions));
      return nodes;
    }

    function readyNodes() {
      const candidate = model.ranked.find(entry => entry.name === model.sheet);
      const nodes = [fileLine()];
      const select = sheetSelect(openSheet, sheetOptionLabel);
      if (select) nodes.push(select);
      nodes.push(planHost);
      renderPlan();
      nodes.push(el('div', { class: 'ewmc-source-actions' },
        el('button', { type: 'button', class: 'btn quiet', 'data-action': 'pick-columns', text: 'Обрати стовпці вручну…', onclick: () => openManual(model.sheet) }),
        pickButton('Обрати інший файл…')));
      return nodes;
    }

    function renderPlan() {
      if (model.phase !== 'ready' || !model.plan) { planHost.replaceChildren(); return; }
      planHost.replaceChildren(...planNodes());
    }

    // Підсумок плану, зауваження, перевірка й галочки: однакові для підбору за назвами й для вибору мишею.
    function planNodes() {
      const { plan } = model;
      const manual = model.mode === 'manual';
      const notes = describePlan(plan, model.build);
      const importable = (model.build ?? plan).rows.length;
      const candidate = model.ranked.find(entry => entry.name === model.sheet);
      const nodes = [];
      const columnsLine = manual ? `Заповнено колонок модуля: ${plan.matched} з ${plan.total}.` : notes.columns;
      nodes.push(el('p', { class: 'ewmc-source-summary' }, el('strong', { text: notes.summary }), ` ${columnsLine}`));
      const lines = [];
      const add = (text, warn = false) => { if (text) lines.push(el('li', { class: warn ? 'warn' : '', text })); };
      add(notes.blocked, true);
      if (!manual && candidate && !candidate.confident && plan.rows.length) add('Таблиця схожа на модуль лише частково, тому підтягування вимкнено — увімкніть його, якщо записи розібрано правильно.', true);
      else if (notes.partial) add('Імпорт неповний, тому підтягування вимкнено: увімкніть його свідомо й підтвердьте частковий імпорт.', true);
      add(notes.missing);
      add(notes.extra);
      add(notes.skipped, true);
      add(notes.carryUnresolved, true);
      notes.warnings.forEach(text => add(text, true));
      add(notes.truncated, true);
      add(notes.corrected);
      if (lines.length) nodes.push(el('ul', { class: 'ewmc-source-notes' }, lines));
      // Зауваження можна виправити до створення модуля; сире значення таблиці при цьому лишається як є.
      if (plan.issues.length) {
        const review = reviewState(plan, model.build ?? buildImport(item.fields, plan));
        nodes.push(el('div', { class: 'ewmc-source-review' },
          el('p', {},
            el('b', { text: `Зауважень до значень: ${review.total}` }),
            review.fixed ? ` · виправлено ${review.fixed}, залишилось ${review.open}` : ' · їх можна виправити до створення модуля'),
          el('button', { type: 'button', class: 'btn', text: 'Перевірити й виправити…', 'data-action': 'review', onclick: openReview })));
      }
      const use = el('input', { type: 'checkbox', disabled: !importable });
      use.checked = model.use;
      // Протягнути метеоумови можна, лише якщо є на які записи й записи взагалі підтягуються.
      const carry = (model.build ?? plan).carry.possible ? el('input', { type: 'checkbox', disabled: !model.use }) : null;
      if (carry) carry.checked = model.carry;
      // Неповний імпорт створюється лише з окремим підтвердженням, у якому названо фактичні кількості.
      const confirm = notes.partial ? el('input', { type: 'checkbox', disabled: !model.use, 'data-action': 'confirm-partial' }) : null;
      if (confirm) confirm.checked = model.confirmed;
      use.addEventListener('change', () => {
        model.use = use.checked;
        if (carry) carry.disabled = !use.checked;
        if (confirm) confirm.disabled = !use.checked;
        onChange();
      });
      confirm?.addEventListener('change', () => { model.confirmed = confirm.checked; onChange(); });
      carry?.addEventListener('change', () => { model.carry = carry.checked; });
      nodes.push(el('label', { class: 'ewmc-source-use' }, use,
        el('span', { text: importable ? `Підтягнути ${rowCountLabel(importable)} у новий модуль` : 'Підтягувати нічого' })));
      if (confirm) nodes.push(el('label', { class: 'ewmc-source-use ewmc-source-confirm' }, confirm, el('span', { text: notes.confirm })));
      if (carry) {
        nodes.push(el('div', { class: 'ewmc-source-carry' },
          el('label', { class: 'ewmc-source-use' }, carry, el('span', { text: notes.carryLabel })),
          el('p', { class: 'ewmc-source-hint', text: notes.carry })));
      }
      if (plan.found.length && !manual) {
        nodes.push(el('details', {},
          el('summary', { text: 'Які стовпці таблиці куди потраплять' }),
          el('dl', { class: 'ewmc-source-map' }, plan.found.flatMap(entry => [el('dt', { text: entry.label }), el('dd', { text: entry.from })]))));
      }
      if (plan.firstRecord.length) {
        nodes.push(el('details', {},
          el('summary', { text: 'Перший запис таким, яким його буде збережено' }),
          el('dl', { class: 'ewmc-source-map' }, plan.firstRecord.flatMap(entry => [el('dt', { text: entry.label }), el('dd', { text: entry.text })]))));
      }
      return nodes;
    }

    return {
      node,
      start,
      pending: () => model.pending,
      // Підтягування неповного набору увімкнено, але не підтверджено: створювати модуль рано.
      unconfirmed: () => model.phase === 'ready' && model.use && Boolean(model.plan)
        && !importGaps(model.plan, model.build).complete && !model.confirmed,
      rows: () => {
        if (model.phase !== 'ready' || !model.use || !model.plan) return null;
        const rows = importRows(model.plan, { carryWeather: model.carry, build: model.build });
        return rows.length ? rows : null;
      },
      // Записи для зразка картки: ті самі, що підтягнуться, але й до ввімкнення галочки. Той самий масив, поки нічого не змінилося.
      previewRows: () => {
        if (model.phase !== 'ready' || !model.plan || !model.plan.rows.length) return null;
        const cached = model.preview;
        if (cached && cached.plan === model.plan && cached.build === model.build && cached.carry === model.carry) return cached.rows;
        const rows = importRows(model.plan, { carryWeather: model.carry, build: model.build });
        model.preview = { plan: model.plan, build: model.build, carry: model.carry, rows };
        return rows;
      },
      willImport: () => model.phase === 'ready' && model.use && Boolean(model.plan),
      corrections: () => (model.build ? correctionRecords(model.plan, model.build, model.workbook?.fileName) : []),
      refresh: () => { render(); onChange(); },
      // Передає таблицю і вибір стовпців іншому шаблону. Огляд таблиці в Rust тепер належить йому: тут його не забуваємо.
      handoff: () => {
        const snapshot = model.picker ? model.picker.snapshot() : { headerIndex: undefined, selected: [] };
        const given = {
          workbook: model.workbook, origin: model.origin, selection: model.selection, ranked: model.ranked, sheet: model.sheet, sheetRows: model.sheetRows, ...snapshot,
        };
        model.selection = '';
        return given;
      },
      // Екран «Перевірка» працює з тим самим планом: виправлення лишаються в моделі блоку до створення модуля.
      review: () => ({
        plan: model.plan,
        fileName: model.workbook?.fileName ?? '',
        sheet: model.sheet,
        fields: item.fields,
        state: () => reviewState(model.plan, model.build ?? buildImport(item.fields, model.plan)),
        rowsCount: () => (model.build ?? model.plan).rows.length,
        outcome: (key, text) => correctionOutcome(item.fields, model.plan, key, text),
        set: (id, text) => {
          model.confirmed = false;
          model.corrections.set(id, text);
          model.build = buildImport(item.fields, model.plan, model.corrections);
        },
        clear: id => {
          model.confirmed = false;
          model.corrections.delete(id);
          model.build = model.corrections.size ? buildImport(item.fields, model.plan, model.corrections) : null;
        },
      }),
      // Після закриття вікна пізні відповіді таблиці вже нікуди не потраплять, а огляд таблиці забувається.
      dispose: () => { request += 1; release(); },
    };
  }

  // Екран «Перевірка»: кожне зауваження до значень таблиці з сирим текстом клітинки й полем для
  // виправлення. Виправлення лишаються в блоці «Дані з вашої таблиці» до створення модуля; сира
  // клітинка не змінюється, а разом зі створенням Rust зберігає виправлення окремо від записів.
  function showReview(source, form) {
    const review = source.review();
    const fieldByKey = new Map(review.fields.map(field => [field.key, field]));
    const drafts = new Map();
    const view = el('div', { class: 'ewmc-review' });

    function back() {
      state.leaveReview = null;
      dialog.replaceChildren(form);
      dialog.dataset.view = 'create';
      source.refresh();
      form.querySelector('[data-action="review"]')?.focus();
    }

    const metric = (value, label) => el('div', {}, el('strong', { text: String(value) }), el('span', { text: label }));

    function card(issue) {
      const field = fieldByKey.get(issue.key);
      const input = el('input', {
        type: 'text',
        maxlength: '4096',
        // Сирий текст клітинки — основа для виправлення, якщо це клітинка саме цього поля.
        value: drafts.get(issue.id) ?? (issue.corrected || (issue.prefill ? issue.raw : '')),
        placeholder: issue.key === 'weather' ? '5/300/1000/10' : (field ? fieldPlaceholder(field) : '') || false,
        'aria-label': `Виправлене значення: ${issue.label}, рядок ${issue.number}`,
        'data-id': issue.id,
      });
      const error = el('p', { class: 'ewmc-issue-error', 'aria-live': 'polite' });
      const apply = (text = input.value) => {
        drafts.set(issue.id, text);
        const outcome = review.outcome(issue.key, text);
        if (outcome.problem) {
          error.textContent = `Не годиться: ${outcome.problem}.`;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        drafts.delete(issue.id);
        review.set(issue.id, text);
        render(issue.id);
      };
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        apply();
      });
      input.addEventListener('input', () => {
        input.removeAttribute('aria-invalid');
        error.textContent = '';
      });
      // «0,3» без одиниці: метри чи кілометри вирішує людина, а не програма.
      const ambiguous = fieldKind(field) === 'height' && /^\s*0[.,]\d+\s*$/u.test(issue.raw)
        ? el('div', { class: 'ewmc-issue-choices', role: 'group', 'aria-label': 'Одиниця висоти' },
          el('span', { text: 'Одиниця одним натисканням:' }),
          [`${issue.raw.trim()} км`, `${issue.raw.trim()} м`].map(text => el('button', { type: 'button', class: 'btn', text, onclick: () => apply(text) })))
        : null;
      const fixedNote = {
        fixed: issue.kind === 'skipped' ? 'Виправлено: запис підтягнеться.' : 'Виправлено.',
        still: 'Виправлення застосовано, але правило досі порушене.',
        invalid: issue.problem ? `Не годиться: ${issue.problem}.` : '',
        open: issue.kind === 'skipped' ? 'Запис не підтягнеться, доки значення не виправлено.' : issue.kind === 'rule' ? 'Запис підтягнеться й так, але з цим зауваженням.' : 'Без виправлення поле лишиться порожнім.',
      }[issue.status];
      return el('li', { class: 'ewmc-issue', 'data-state': issue.status, 'data-id': issue.id },
        el('div', { class: 'ewmc-issue-head' },
          el('b', { text: `Рядок ${issue.number} · ${issue.label}` }),
          el('span', { class: 'ewmc-issue-kind', text: ISSUE_KINDS[issue.kind] })),
        el('p', { class: 'ewmc-issue-reason', text: issue.reason }),
        el('p', { class: 'ewmc-issue-raw' },
          'У таблиці', issue.column ? ` («${issue.column}»)` : '', ': ',
          el('b', { text: `«${issue.raw || 'порожньо'}»` }),
          issue.corrected && issue.status !== 'open' ? el('span', {}, ' → ', el('b', { text: `«${issue.corrected}»` })) : null),
        issue.key === 'weather' ? el('p', { class: 'ewmc-issue-hint', text: WEATHER_HINT_TEXT }) : null,
        el('div', { class: 'ewmc-issue-fix' },
          input,
          el('button', { type: 'button', class: 'btn', text: issue.corrected ? 'Змінити' : 'Застосувати', 'data-action': 'apply', onclick: () => apply() }),
          issue.corrected ? el('button', {
            type: 'button',
            class: 'btn quiet',
            text: 'Скасувати виправлення',
            onclick: () => { drafts.delete(issue.id); review.clear(issue.id); render(issue.id); },
          }) : null),
        ambiguous,
        el('p', { class: 'ewmc-issue-status', text: fixedNote }),
        error);
    }

    function render(focusId = null) {
      const status = review.state();
      const shown = status.items.slice(0, REVIEW_LIMIT);
      view.replaceChildren(...[
        el('button', { type: 'button', class: 'ewmc-back', text: '← До створення', onclick: back }),
        el('p', { class: 'ewmc-eyebrow', text: 'Перевірка перед підтягуванням' }),
        el('h2', { id: 'ewmc-dialog-title', text: 'Перевірка значень з таблиці' }),
        el('p', {
          class: 'ewmc-review-lead',
          text: `Таблиця «${review.fileName}», аркуш «${review.sheet}» лише читається. Виправлене значення потрапить у запис модуля, а сире значення клітинки збережеться окремо — його буде видно на сторінці модуля.`,
        }),
        el('div', { class: 'ewmc-review-metrics' },
          metric(review.rowsCount(), 'записів підтягнеться'),
          metric(status.total, 'зауважень'),
          metric(status.fixed, 'виправлено'),
          metric(status.open, 'залишилось')),
        el('ol', { class: 'ewmc-review-list' }, shown.map(card)),
        status.items.length > shown.length
          ? el('p', { class: 'ewmc-review-more', text: `Показано перші ${REVIEW_LIMIT} зауважень з ${status.items.length}; решту виправте в модулі після створення.` })
          : null,
        el('div', { class: 'ewmc-form-actions' },
          el('button', { type: 'button', class: 'btn primary', text: 'Готово — до створення модуля', onclick: back })),
      ].filter(Boolean));
      const target = focusId ? view.querySelector(`li[data-id="${CSS.escape(focusId)}"] [data-action="apply"]`) : null;
      (target ?? view.querySelector('.ewmc-issue input'))?.focus();
    }

    state.leaveReview = back;
    dialog.replaceChildren(view);
    dialog.dataset.view = 'review';
    render();
  }

  async function reopenFresh(moduleId, message = '', view = null) {
    await loadModules();
    const fresh = state.modules.find(item => item.id === moduleId);
    if (fresh) showModulePage(fresh, null, view);
    else if (dialog.open) dialog.close();
    if (message) showToast(message, true);
  }

  // Стиль уже створеного модуля змінюється на його сторінці. Це лише вигляд: рядки не перезаписуються,
  // тож перемикач працює й тоді, коли таблиця відкрита лише для читання.
  function styleSelect(module) {
    const select = el('select', { class: 'ewmc-style-select', 'aria-label': 'Стиль оформлення модуля', title: `Стиль оформлення · кольори ${BRANCH_LABELS[module.branch] || 'роду військ'}` },
      MODULE_STYLES.map(option => el('option', { value: option.id, selected: option.id === module.style, text: option.label })));
    select.addEventListener('change', async () => {
      const style = normalizeStyle(select.value);
      if (state.busy) { select.value = module.style; return; }
      state.busy = true;
      select.disabled = true;
      try {
        const saved = normalizeModules([await invoke('set_dashboard_module_style', { moduleId: module.id, style })])[0];
        const current = saved ? saved.style : style;
        for (const item of state.modules) if (item.id === module.id) item.style = current;
        module.style = current;
        loadStyleFonts(current);
        dialog.dataset.style = current;
        renderHost();
        showToast(`Стиль модуля: ${MODULE_STYLES.find(option => option.id === current)?.label || current}.`);
      } catch (error) {
        select.value = module.style;
        showToast(String(error || 'Не вдалося змінити стиль модуля.'), true);
      } finally {
        state.busy = false;
        select.disabled = false;
      }
    });
    return el('label', { class: 'ewmc-style-switch' }, el('span', { text: 'Стиль' }), select);
  }

  // Таблиця модуля відкривається окремою сторінкою на весь екран, а не вікном поверх дашборда.
  // `view` — де стоїть таблиця: після додавання рядка вона гортається до кінця, після правки лишається на місці.
  function showModulePage(module, focusTarget = null, view = null) {
    state.cancelEdit = null;
    const payload = state.data.get(module.id) || { rows: [], truncated: false, failed: true };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    // Значення, виправлені під час підтягування з таблиці: сира клітинка збережена окремо від запису.
    const corrections = Array.isArray(payload.corrections) ? payload.corrections : [];
    const correctionAt = new Map(corrections.map(item => [`${item.rowId}:${item.fieldKey}`, item]));
    const access = tableEditState(payload);
    const readOnly = !access.editable;
    const unreadable = payload.failed === true;
    // Запис — один рядок таблиці, як рядок бази даних: поля редагуються прямо в ньому, а не в окремій формі.
    let editing = false;
    // Повернення на дашборд: кнопка в шапці сторінки закриває її, а Escape спершу скасовує рядок, що редагується.
    const backButton = el('button', { type: 'button', class: 'btn quiet ewmc-page-back', text: '← До дашборда', 'data-action': 'back', onclick: closePage });

    const addButton = el('button', {
      type: 'button',
      class: 'btn primary',
      text: '+ Додати рядок',
      disabled: readOnly,
      'data-action': 'add-row',
      onclick: () => startEdit(null),
    });
    // Пошук, група колонок і щільність лише змінюють показ: записи ті самі, а на час правки видно всі колонки.
    const tableView = state.tableViews.get(module.id) || { query: '', group: 'all' };
    state.tableViews.set(module.id, tableView);
    const groups = tableColumnGroups(module.fields);
    if (!groups.some(group => group.id === tableView.group)) tableView.group = 'all';
    const rowNodes = rows.map((row, index) => el('tr', {}, rowCells(row, index)));
    const body = el('tbody', {}, rowNodes);
    const emptyNote = el('p', {
      class: 'ewmc-table-empty',
      text: unreadable ? 'Дані не прочитано.' : 'Записів ще немає. Натисніть «+ Додати рядок».',
      hidden: rows.length > 0,
    });
    const noMatch = el('p', { class: 'ewmc-table-empty ewmc-no-match', hidden: true });
    // Перегляд модуля під таблицею: збережені рядки, а під час введення — ще й чернетка запису.
    const preview = unreadable ? null : livePreview(module, rows);
    const colgroup = el('colgroup');
    const table = el('table', { class: 'ewmc-data-table' },
      colgroup,
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', class: 'ewmc-row-number', text: '№', title: 'Номер рядка' }),
        module.fields.map(field => el('th', { scope: 'col', class: field.required ? 'ewmc-required' : '', title: field.label, text: field.label, 'data-key': field.key })),
        el('th', { scope: 'col', text: 'Дія' }))),
      body);
    const scroll = el('div', { class: 'ewmc-data-scroll' }, table);

    const search = el('input', {
      type: 'search',
      class: 'ewmc-search',
      value: tableView.query,
      maxlength: '120',
      placeholder: 'Пошук у записах',
      'aria-label': 'Пошук у записах таблиці',
    });
    search.addEventListener('input', () => { tableView.query = search.value; applyView(); });
    // Escape у пошуку спершу очищає запит, а не повертає на дашборд.
    search.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !search.value) return;
      event.preventDefault();
      event.stopPropagation();
      search.value = '';
      tableView.query = '';
      applyView();
    });
    const searchCount = el('span', { class: 'ewmc-search-count', 'aria-live': 'polite' });
    const chips = groups.map(group => el('button', {
      type: 'button',
      class: 'ewmc-chip',
      text: group.title,
      'data-group': group.id,
      onclick: () => { tableView.group = group.id; applyView(); },
    }));
    const densityButtons = [['comfortable', 'Звичайно'], ['compact', 'Компактно']].map(([value, label]) => el('button', {
      type: 'button',
      text: label,
      'data-density': value,
      onclick: () => { paintDensity(value); saveDensity(value); },
    }));
    const toolbar = rows.length
      ? el('div', { class: 'ewmc-table-toolbar' },
        el('label', { class: 'ewmc-search-field' }, el('span', { 'aria-hidden': 'true', text: '⌕' }), search),
        chips.length ? el('div', { class: 'ewmc-group-filter', role: 'group', 'aria-label': 'Групи колонок' }, chips) : null,
        el('div', { class: 'ewmc-density', role: 'group', 'aria-label': 'Щільність таблиці' }, densityButtons),
        searchCount)
      : null;

    function paintDensity(value) {
      const density = normalizeDensity(value);
      scroll.classList.toggle('is-compact', density === 'compact');
      for (const button of densityButtons) button.setAttribute('aria-pressed', String(button.dataset.density === density));
    }

    // Перелік виправлень підтягування: сире значення клітинки, введене значення, причина й місце в таблиці.
    function correctionsList() {
      const position = new Map(rows.map((row, index) => [row.rowId, index + 1]));
      const labelOf = new Map(module.fields.map(field => [field.key, field.label]));
      const current = corrections.filter(item => correctionStatus(item) === 'current').length;
      const history = corrections.length - current;
      return el('details', { class: 'ewmc-corrections' },
        el('summary', { text: `Виправлено під час підтягування з таблиці: ${corrections.length} ${pluralForm(corrections.length, 'значення', 'значення', 'значень')}`
          + (history ? ` (поточних — ${current}, історія імпорту — ${history})` : '') }),
        el('p', { class: 'ewmc-corrections-note', text: 'Файл таблиці не змінювався: сире значення клітинки збережено окремо від запису. У таблиці нижче клітинки, які пояснює виправлення, позначено ✎; '
          + 'виправлення, після якого значення змінили вручну або поточність якого не підтверджена, — лише історія імпорту (↺).' }),
        el('ul', {}, corrections.map(item => {
          const record = rows.find(row => row.rowId === item.rowId);
          const field = module.fields.find(entry => entry.key === item.fieldKey);
          const status = correctionStatus(item);
          return el('li', { 'data-status': status },
            el('b', { text: `Запис ${position.get(item.rowId) ?? '—'} · ${labelOf.get(item.fieldKey) ?? item.fieldKey}: ` }),
            'у таблиці ', el('b', { text: `«${item.rawText || 'порожньо'}»` }), ' → ', el('b', { text: `«${item.correctedText}»` }),
            status === 'current' ? null : el('span', { class: 'ewmc-history-note', text: ` · ${correctionStatusLabel(item)}`
              + (record && field ? `; зараз — «${formatFieldValue(field, record[field.key]) || 'порожньо'}»` : '') }),
            el('small', { text: ` — рядок ${item.sourceRow}${item.sourceColumn ? `, «${item.sourceColumn}»` : ''}, аркуш «${item.sourceSheet}», ${item.sourceFile}. ${item.reason}` }));
        })));
    }

    // Видимі колонки (група) і рядки (пошук). Номер рядка в «№» лишається номером запису в таблиці.
    function applyView() {
      const shown = visibleColumnKeys(module.fields, tableView.group);
      const visibleFields = module.fields.filter(field => shown.has(field.key));
      colgroup.replaceChildren(
        el('col', { class: 'ewmc-col-number' }),
        visibleFields.map(field => el('col', { style: { width: `${fieldColumnWidth(field)}px` } })),
        el('col', { class: 'ewmc-col-action' }));
      const width = visibleFields.reduce((sum, field) => sum + fieldColumnWidth(field), 0);
      table.style.minWidth = `${NUMBER_COLUMN_WIDTH + width + ACTION_COLUMN_WIDTH}px`;
      for (const cell of table.querySelectorAll('[data-key]')) cell.hidden = !shown.has(cell.dataset.key);
      let found = 0;
      rowNodes.forEach((tr, index) => {
        const match = rowMatchesQuery(module.fields, rows[index], tableView.query);
        tr.hidden = !match;
        if (match) found += 1;
      });
      const query = tableView.query.trim();
      searchCount.textContent = query ? `Знайдено: ${found} з ${rows.length}` : '';
      noMatch.hidden = !(query && rows.length && !found);
      noMatch.textContent = query ? `Нічого не знайдено за запитом «${query}».` : '';
      for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.group === tableView.group));
    }
    // Панель над таблицею: підказки, лічильник екіпажу, помилки й видалення рядка, що редагується.
    const editHost = el('div', { class: 'ewmc-edit-host' });

    function rowCells(row, index) {
      return [
        el('td', { class: 'ewmc-row-number', text: String(index + 1) }),
        module.fields.map(field => {
          const shown = formatFieldValue(field, row?.[field.key]);
          const fix = correctionAt.get(`${row?.rowId}:${field.key}`);
          // ✎ — лише коли виправлення підтверджено пояснює поточне значення; інакше це історія імпорту.
          if (fix && correctionStatus(fix) === 'current') {
            return el('td', { class: 'ewmc-corrected', title: correctionText(fix), 'data-key': field.key },
              el('span', { class: 'ewmc-corrected-mark', 'aria-hidden': 'true', text: '✎' }),
              shown,
              el('span', { class: 'ewmc-sr', text: ` (виправлено під час підтягування; у таблиці було «${fix.rawText || 'порожньо'}»)` }));
          }
          if (fix) {
            return el('td', { class: 'ewmc-correction-history', title: correctionText(fix), 'data-key': field.key },
              el('span', { class: 'ewmc-history-mark', 'aria-hidden': 'true', text: '↺' }),
              shown,
              el('span', { class: 'ewmc-sr', text: ` (${correctionStatusLabel(fix)})` }));
          }
          return el('td', { text: shown, title: shown.length > 14 ? shown : false, 'data-key': field.key });
        }),
        el('td', { class: 'ewmc-row-actions' },
          el('button', {
            type: 'button',
            class: 'btn quiet',
            text: 'Редагувати',
            disabled: readOnly || editing,
            'data-action': 'edit-row',
            onclick: () => startEdit(index),
          })),
      ];
    }

    // Поки рядок редагується, інші дії вимкнено: запис замінює весь набір рядків.
    function setEditing(active) {
      editing = active;
      addButton.disabled = readOnly || active;
      for (const button of body.querySelectorAll('[data-action="edit-row"]')) button.disabled = readOnly || active;
      // Пошук і групи на час правки не змінюються: рядок, що редагується, не має зникнути з очей.
      search.disabled = active;
      for (const chip of chips) chip.disabled = active;
      scroll.classList.toggle('is-editing', active);
      if (preview) preview.node.hidden = !active;
    }

    function startEdit(rowIndex) {
      if (editing || readOnly) return;
      // Запис — це всі поля в одному рядку, тож на час правки видно всі колонки, а не лише групу.
      if (tableView.group !== 'all') {
        tableView.group = 'all';
        applyView();
      }
      const isEdit = Number.isInteger(rowIndex) && rows[rowIndex] != null;
      const existing = isEdit ? rows[rowIndex] : {};
      // Погоду записують раз на 5–10 записів льотної зміни: новий запис бере її з попереднього.
      const inherited = isEdit ? null : inheritedValues(module.fields, rows);
      const sections = fieldSections(module.fields);
      const controls = new Map();
      const currentValues = () => Object.fromEntries([...controls].map(([key, control]) => [key, control.value]));
      const cells = module.fields.map(field => {
        const control = createFieldControl(field, existing[field.key] ?? inherited?.values[field.key]);
        // Поля стоять у клітинках таблиці, а форма — над нею: атрибут `form` з'єднує їх (Enter зберігає рядок).
        control.setAttribute('form', ROW_FORM_ID);
        if (inherited?.values[field.key] != null) control.dataset.inherited = 'true';
        controls.set(field.key, control);
        // Підказка (кілограми для літрів, метри для «0,3 км») оновлюється під час введення; порожня — прихована.
        const hint = el('small', { class: 'ewmc-hint', id: `ewmc-hint-${field.key}` });
        const paintHint = () => { hint.textContent = fieldHint(field, control.value); };
        paintHint();
        control.addEventListener('input', paintHint);
        control.setAttribute('aria-describedby', hint.id);
        return el('td', { class: 'ewmc-cell-edit', 'data-key': field.key }, control, hint);
      });

      // Підставлена погода позначена окремо й очищається одним натисканням: стару погоду легко не помітити.
      function inheritedNote(section) {
        const clear = el('button', { type: 'button', class: 'btn quiet', text: 'Очистити' });
        const note = el('p', { class: 'ewmc-inherit' },
          el('span', {}, el('b', { text: `${section.title}. ` }), 'Підставлено з останнього запису, де вказано погоду. Змініть значення, якщо погода інша.'),
          clear);
        clear.addEventListener('click', () => {
          for (const field of section.fields) {
            const control = controls.get(field.key);
            control.value = '';
            control.removeAttribute('data-inherited');
            control.dispatchEvent(new Event('input', { bubbles: true }));
          }
          note.hidden = true;
          controls.get(section.fields[0].key)?.focus();
        });
        return note;
      }

      // Порада про склад і лічильник екіпажу, щоб ліміт був видно до збереження, а не лише в помилці.
      function crewSummaryNote(section) {
        const total = el('small', { class: 'ewmc-hint ewmc-crew-total' });
        const paint = () => {
          const values = currentValues();
          total.textContent = crewSummary(values);
          total.classList.toggle('over', crewCount(values) > MAX_CREW);
        };
        for (const field of section.fields) controls.get(field.key)?.addEventListener('input', paint);
        paint();
        return el('div', { class: 'ewmc-crew-note' }, el('p', { class: 'ewmc-group-note', text: section.note }), total);
      }

      const meteo = sections.find(section => section.inherit);
      const crew = sections.find(section => section.id === 'crew');
      const status = el('p', { class: 'ewmc-form-status', 'aria-live': 'polite' });
      const saveButton = el('button', {
        type: 'submit',
        form: ROW_FORM_ID,
        class: 'btn primary',
        text: isEdit ? 'Зберегти' : 'Додати',
        title: isEdit ? 'Зберегти зміни' : 'Додати рядок',
      });
      const cancelButton = el('button', { type: 'button', class: 'btn quiet', text: 'Скасувати', onclick: () => cancel() });
      // Видалення — лише для наявного запису й лише після підтвердження в самому вікні (без системних діалогів).
      const removeButton = isEdit ? el('button', { type: 'button', class: 'btn ewmc-danger', text: 'Видалити запис' }) : null;
      const keepButton = isEdit ? el('button', { type: 'button', class: 'btn quiet', text: 'Ні, залишити' }) : null;
      const confirmButton = isEdit ? el('button', { type: 'button', class: 'btn ewmc-danger solid', text: 'Так, видалити' }) : null;
      const confirmBox = isEdit
        ? el('div', { class: 'ewmc-confirm', role: 'group', 'aria-labelledby': 'ewmc-confirm-text', hidden: true },
          el('p', { id: 'ewmc-confirm-text', text: 'Видалити цей запис із локальної таблиці? Дію не можна скасувати.' }),
          el('div', { class: 'ewmc-confirm-actions' }, keepButton, confirmButton))
        : null;
      const lockable = [saveButton, cancelButton, removeButton, keepButton, confirmButton, backButton].filter(Boolean);
      const setLocked = locked => lockable.forEach(button => { button.disabled = locked; });
      const showConfirm = asking => {
        if (!isEdit) return;
        confirmBox.hidden = !asking;
        removeButton.hidden = asking;
      };
      const askToRemove = asking => {
        showConfirm(asking);
        // Фокус — на безпечній відповіді, щоб випадковий Enter не видалив запис.
        if (isEdit) (asking ? keepButton : removeButton).focus();
      };
      // Рядок довгий, тому до груп, які записують найчастіше (погода, екіпаж), можна перейти однією кнопкою.
      const groups = sections.filter(section => section.title);
      const jumps = groups.length
        ? el('span', { class: 'ewmc-jumps' }, 'Перейти до:', groups.map(section => el('button', {
          type: 'button',
          class: 'btn quiet',
          text: section.title,
          onclick: () => controls.get(section.fields[0].key)?.focus(),
        })))
        : null;
      const form = el('form', { class: 'ewmc-edit-bar', id: ROW_FORM_ID },
        el('div', { class: 'ewmc-edit-head' },
          el('strong', { text: isEdit ? `Редагування рядка ${rowIndex + 1}` : 'Новий запис' }),
          el('span', { text: 'Усі поля запису — в одному рядку таблиці. Enter — зберегти.' }),
          jumps,
          removeButton),
        inherited && meteo ? inheritedNote(meteo) : null,
        crew ? crewSummaryNote(crew) : null,
        status,
        confirmBox);

      const tr = isEdit ? rowNodes[rowIndex] : el('tr');
      const original = isEdit ? [...tr.children] : [];
      tr.classList.add('ewmc-editing');
      tr.replaceChildren(
        el('td', { class: 'ewmc-row-number', text: String(isEdit ? rowIndex + 1 : rows.length + 1) }),
        ...cells,
        el('td', { class: 'ewmc-row-actions ewmc-editing-actions' }, saveButton, cancelButton));
      if (!isEdit) {
        body.append(tr);
        emptyNote.hidden = true;
      }
      editHost.replaceChildren(form);
      setEditing(true);
      state.cancelEdit = cancel;

      let cancelPreview = () => {};
      function finish() {
        state.cancelEdit = null;
        cancelPreview();
        editHost.replaceChildren();
        tr.classList.remove('ewmc-editing');
        if (isEdit) {
          tr.replaceChildren(...original);
        } else {
          tr.remove();
          emptyNote.hidden = rows.length > 0;
        }
        setEditing(false);
      }

      function cancel() {
        if (state.busy) return;
        finish();
        (isEdit ? tr.querySelector('[data-action="edit-row"]') : addButton)?.focus();
      }

      // Помилку показано над таблицею, а курсор іде в клітинку, яку треба виправити: серед десятків колонок її не видно.
      function showError(error) {
        status.textContent = String(error?.message || error || 'Не вдалося зберегти запис.');
        status.classList.add('error');
        const control = controls.get(error?.fieldKey);
        if (control) {
          control.setAttribute('aria-invalid', 'true');
          control.focus();
        }
      }

      // Запис замінює весь набір рядків; `expectedUpdatedAt` не дає перезаписати зміни з іншого вікна.
      async function persist(nextRows, doneMessage, focusAfter, isDelete = false) {
        if (state.busy) return;
        state.busy = true;
        setLocked(true);
        status.classList.remove('error');
        status.textContent = 'Збереження в локальній SQLite…';
        try {
          const result = await invoke('replace_dashboard_module_rows', replaceRowsRequest(module, nextRows));
          const updated = normalizeModules([result?.module])[0] || module;
          state.modules = state.modules.map(item => item.id === module.id ? updated : item);
          state.data.set(module.id, {
            module: updated,
            rows: Array.isArray(result?.rows) ? result.rows : [],
            truncated: result?.truncated === true,
            corrections: Array.isArray(result?.corrections) ? result.corrections : [],
          });
          renderHost();
          // Новий рядок стоїть у кінці: таблиця гортається до нього; після правки чи видалення вона лишається на місці.
          showModulePage(updated, focusAfter, focusAfter === 'add' && !isDelete ? { top: 'end', left: 0 } : { top: scroll.scrollTop, left: scroll.scrollLeft });
          showToast(doneMessage);
        } catch (error) {
          if (isConflictError(error)) {
            await reopenFresh(module.id, 'Таблицю змінено в іншому вікні. Показано актуальні дані — повторіть дію.', { top: scroll.scrollTop, left: scroll.scrollLeft });
            return;
          }
          showConfirm(false);
          status.textContent = String(error?.message || error || 'Не вдалося зберегти запис.');
          status.classList.add('error');
        } finally {
          state.busy = false;
          setLocked(false);
        }
      }

      form.addEventListener('submit', event => {
        event.preventDefault();
        if (state.busy) return;
        showConfirm(false);
        let edited;
        try {
          edited = rowForWrite(module.fields, currentValues(), existing);
        } catch (error) {
          showError(error);
          return;
        }
        persist(rowsAfterSave(module.fields, rows, isEdit ? rowIndex : null, edited), isEdit ? 'Запис оновлено.' : 'Рядок додано.', isEdit ? rowIndex : 'add');
      });
      // Повідомлення про помилку зникає, щойно користувач береться виправляти поле, і не висить поруч із уже виправленим.
      const onInput = event => {
        event.currentTarget.removeAttribute('data-inherited');
        for (const control of controls.values()) control.removeAttribute('aria-invalid');
        if (state.busy || !status.classList.contains('error')) return;
        status.textContent = '';
        status.classList.remove('error');
      };
      for (const control of controls.values()) control.addEventListener('input', onInput);
      // Перегляд модуля оновлюється під час введення: не частіше разу на кадр, а чернетка не вимагає повного запису.
      let previewFrame = 0;
      const previewBase = isEdit ? existing : (inherited?.values ?? {});
      const paintPreview = () => {
        previewFrame = 0;
        const draft = draftRow(module.fields, currentValues(), previewBase, previewBase);
        preview?.update(rowsWithDraft(rows, isEdit ? rowIndex : null, draft), draft);
      };
      const schedulePreview = () => { if (!previewFrame) previewFrame = requestAnimationFrame(paintPreview); };
      for (const control of controls.values()) {
        control.addEventListener('input', schedulePreview);
        control.addEventListener('change', schedulePreview);
      }
      cancelPreview = () => {
        if (previewFrame) cancelAnimationFrame(previewFrame);
        previewFrame = 0;
        preview?.update(rows, null);
      };
      paintPreview();
      if (isEdit) {
        removeButton.addEventListener('click', () => askToRemove(true));
        keepButton.addEventListener('click', () => askToRemove(false));
        confirmButton.addEventListener('click', () => persist(rowsAfterDelete(module.fields, rows, rowIndex), 'Запис видалено.', 'add', true));
      }
      tr.scrollIntoView({ block: 'nearest' });
      controls.values().next().value?.focus();
    }

    // Шапка сторінки: назад, назва й лічильники, головна дія. Нижче — панель запису й таблиця на всю висоту.
    dialog.replaceChildren(
      el('header', { class: 'ewmc-page-head' },
        el('form', { method: 'dialog', class: 'ewmc-page-nav' }, backButton),
        el('div', { class: 'ewmc-page-title' },
          el('p', { class: 'ewmc-eyebrow', text: 'Локальна SQLite-таблиця' }),
          el('h2', { id: 'ewmc-dialog-title', text: module.title }),
          el('p', { class: 'ewmc-sub' },
            `${unreadable ? 'Дані недоступні' : rowCountLabel(rows.length)} · ${columnCountLabel(module.fields.length)} · `,
            el('code', { text: module.storageTable }))),
        styleSelect(module),
        addButton),
      el('div', { class: 'ewmc-page-body' },
        corrections.length ? correctionsList() : null,
        rolesPanel({ el, invoke, module, modules: () => state.modules }),
        readOnly || !state.schema ? null : snapshotPanel({
          el, module,
          schema: () => state.schema,
          titles: () => new Map(state.modules.map(item => [moduleSourceId(item.id), item.title])),
          readSources: () => readSnapshotSources(module),
          payload: () => state.data.get(module.id),
          apply: view => applySnapshotRefresh(module, view),
        }),
        readOnly ? null : updatePanel({
          el, invoke, module, payload,
          onApplied: result => {
            const updated = normalizeModules([result?.module])[0] || module;
            state.modules = state.modules.map(item => item.id === module.id ? updated : item);
            state.data.set(module.id, {
              module: updated,
              rows: Array.isArray(result?.rows) ? result.rows : [],
              truncated: result?.truncated === true,
              corrections: Array.isArray(result?.corrections) ? result.corrections : [],
            });
            renderHost();
            showModulePage(updated);
            showToast('Таблицю оновлено з нового файла.');
          },
          onConflict: () => reopenFresh(module.id, 'Таблицю змінено в іншому вікні. Показано актуальні дані — повторіть дію.'),
        }),
        ...(readOnly ? [el('div', { class: 'ewmc-readonly' },
          el('p', { class: 'ewmc-form-status error', text: access.reason }),
          payload.failed === true
            ? el('button', { type: 'button', class: 'btn quiet', text: 'Прочитати знову', onclick: () => reopenFresh(module.id) })
            : null)] : []),
        toolbar,
        editHost,
        scroll,
        emptyNote,
        noMatch,
        preview?.node),
    );
    paintDensity(readDensity());
    applyView();
    dialog.dataset.view = 'table';
    dialog.dataset.module = module.id;
    dialog.dataset.style = module.style;
    dialog.dataset.branch = module.branch;
    if (!dialog.open) dialog.showModal();
    if (view) {
      scroll.scrollTop = view.top === 'end' ? scroll.scrollHeight : view.top;
      scroll.scrollLeft = view.left;
    }
    if (focusTarget === 'add') addButton.focus();
    else if (Number.isInteger(focusTarget)) rowNodes[focusTarget]?.querySelector('[data-action="edit-row"]')?.focus();
  }

  function createFieldControl(field, value) {
    const type = fieldInputType(field);
    if (field.key === 'day_night') {
      const select = el('select', { 'aria-label': field.label },
        el('option', { value: '', text: '—' }),
        el('option', { value: 'День', text: 'День' }),
        el('option', { value: 'Ніч', text: 'Ніч' }));
      select.value = value == null ? '' : String(value);
      return select;
    }
    if (type === 'select') {
      const select = el('select', { 'aria-label': field.label },
        el('option', { value: '', text: '—' }),
        el('option', { value: 'true', text: 'Так' }),
        el('option', { value: 'false', text: 'Ні' }));
      select.value = value === true ? 'true' : value === false ? 'false' : '';
      return select;
    }
    const kind = fieldKind(field);
    const attributes = {
      type,
      value: fieldInputText(field, value),
      required: field.required,
      'aria-label': field.label,
      placeholder: fieldPlaceholder(field) || false,
    };
    if (type === 'number') attributes.step = field.dataType === 'integer' ? '1' : 'any';
    // Межі полів (хмарність 0–10, не менше 0) перевіряє parseFieldInput із повідомленням у формі:
    // вбудована перевірка min/max не в усіх WebView показує причину відмови, а старий запис поза межами заблокувала б.
    if (type === 'text') attributes.maxlength = kind ? '16' : '4096';
    return el('input', attributes);
  }

  function showToast(message, error = false) {
    const toast = el('div', { class: `ewmc-toast${error ? ' error' : ''}`, role: 'status', text: message });
    // Сторінка відкрита як модальна: усе поза нею, зокрема сповіщення на <body>, закрите шаром поверх.
    (dialog.open ? dialog : document.body).append(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  loadCatalog();
  loadModules();
}

/** Підказка клітинки, виправленої під час підтягування: що було в таблиці, що введено й звідки. */
function correctionText(item) {
  const where = [`рядок ${item.sourceRow}`, item.sourceColumn && `«${item.sourceColumn}»`, item.sourceSheet && `аркуш «${item.sourceSheet}»`, item.sourceFile]
    .filter(Boolean).join(', ');
  const base = `«${item.rawText || 'порожньо'}» → «${item.correctedText}» (${where}). ${item.reason}`;
  return correctionStatus(item) === 'current'
    ? `Виправлено під час підтягування з таблиці: ${base}`
    : `${correctionStatusLabel(item)[0].toUpperCase()}${correctionStatusLabel(item).slice(1)}. Під час підтягування було виправлено: ${base}`;
}

// Синтетичні рядки для картки каталогу: вигадані підрозділи, дати 2026 року й числа, щоб прев'ю
// показувало форму діаграми. Прізвищ немає — лише умовні назви.
function sampleRows(item) {
  const kind = item.visualKind;
  const byKey = Object.fromEntries(item.fields.map(field => [field.key, field]));
  const has = key => key in byKey;
  const day = index => `2026-10-${String(1 + index).padStart(2, '0')}`;
  const stamp = index => `2026-10-${String(1 + Math.floor(index / 4)).padStart(2, '0')}T${String(8 + (index % 4) * 3).padStart(2, '0')}:00`;
  const values = [42, 68, 54, 88, 74, 61, 79, 95, 70, 83, 66, 90];
  const units = ['1 АЕ', '2 АЕ', '3 АЕ', 'Ланка «Захід»', 'Ланка «Схід»', 'Резерв'];
  const rows = [];
  const push = row => rows.push(Object.fromEntries(Object.entries(row).filter(([key]) => has(key))));
  if (item.id === 'flight-hours' || (has('aircraft_type') && has('airborne_hours') && has('total_hours'))) {
    [['Мі-8', 12.5, 15.25], ['Мі-24', 9.5, 11], ['Ан-26', 4.25, 5]].forEach(([aircraft_type, airborne_hours, total_hours]) => push({ aircraft_type, airborne_hours, total_hours }));
  } else if (['line', 'area'].includes(kind)) {
    values.slice(0, 10).forEach((value, index) => { push({ period: day(index), value, series: 'План' }); push({ period: day(index), value: Math.round(value * 0.8 + (index % 3) * 6), series: 'Факт' }); });
  } else if (kind === 'combo') {
    values.slice(0, 8).forEach((value, index) => push({ period: day(index), value, reference_value: 72 }));
  } else if (['columns', 'horizontal-bar'].includes(kind)) {
    units.slice(0, 5).forEach((category, index) => push({ category, value: values[index], series: 'Разом' }));
  } else if (kind === 'stacked-columns') {
    units.slice(0, 5).forEach((category, index) => ['День', 'Ніч', 'СМУ'].forEach((series, order) => push({ category, value: Math.round(values[index + order] / (order + 1)), series })));
  } else if (kind === 'grouped-columns') {
    units.slice(0, 5).forEach((category, index) => push({ category, primary_value: values[index], secondary_value: Math.round(values[index] * 0.7) }));
  } else if (kind === 'diverging-bars') {
    [['Поповнення', 24], ['Повернуто з ремонту', 9], ['Передано', 4], ['У ремонті', -7], ['Втрати', -12]].forEach(([category, value]) => push({ category, value }));
  } else if (kind === 'donut') {
    ['Мі-8', 'Мі-24', 'Ан-26', 'Мі-2'].forEach((category, index) => push({ category, value: values[index] }));
  } else if (['radial-progress', 'multi-ring', 'progress-bars'].includes(kind)) {
    ['Наліт', 'Вправи', 'Стрільби', 'Готовність'].slice(0, kind === 'radial-progress' ? 3 : 4).forEach((label, index) => push({ label, current_value: values[index], target_value: 100, ring_order: index + 1 }));
  } else if (kind === 'gauge') {
    push({ label: 'Готовність', value: 72, minimum: 0, maximum: 100 });
  } else if (kind === 'kpi') {
    values.slice(0, 8).forEach((value, index) => push({ label: 'Наліт за місяць', value: value * 3, delta: index === 7 ? 6.4 : 1, unit: 'год' }));
  } else if (kind === 'radar') {
    ['Наліт', 'Стрільби', 'Навігація', 'Зв’язок', 'Злагодженість'].forEach((axis, index) => { push({ axis, value: values[index], series: '1 АЕ' }); push({ axis, value: values[index + 3], series: '2 АЕ' }); });
  } else if (kind === 'calendar') {
    [1, 2, 3, 6, 7, 8, 9, 13, 14, 15, 16, 20, 21, 22, 27, 28].forEach((dayOfMonth, index) => push({ date: `2026-10-${String(dayOfMonth).padStart(2, '0')}`, value: values[index % values.length] / 10 }));
  } else if (kind === 'cohort') {
    ['Січень', 'Лютий', 'Березень', 'Квітень'].forEach((cohort, row) => [1, 2, 3, 4, 5].slice(0, 5 - row).forEach(period => push({ cohort, period: String(period), value: Math.round(100 - period * (6 + row * 2)) })));
  } else if (kind === 'table') {
    [['Платформа аналітики', 12, 80, 'Готово'], ['Міграція даних', 4, 35, 'Увага'], ['Навчання екіпажів', 9, 60, 'Виконується'], ['Ремонт техніки', 2, 15, 'Затримка']].forEach(([label, value, progress, status]) => push({ label, value, progress, status, note: '' }));
  } else if (kind === 'funnel') {
    [['Заплановано', 120, 1], ['Підготовлено', 96, 2], ['Виконано', 64, 3], ['Зараховано', 40, 4]].forEach(([stage, value, order]) => push({ stage, value, stage_order: order }));
  } else if (kind === 'map') {
    [['Київ', 50.45, 30.52, 88, 'Готово'], ['Львів', 49.84, 24.03, 54, 'Готово'], ['Одеса', 46.48, 30.73, 61, 'Увага'], ['Харків', 49.99, 36.23, 42, 'Готово'], ['Дніпро', 48.46, 35.04, 70, 'Готово']]
      .forEach(([label, latitude, longitude, value, status]) => push({ label, latitude, longitude, value, status }));
  } else if (kind === 'activity') {
    [['Виліт пари', 'Готово', 2], ['Доповідь прийнято', 'Готово', 1], ['Затримка вильоту', 'Увага', 1], ['Повернення на базу', 'Готово', 2]].forEach(([label, status, value], index) => push({ occurred_at: stamp(index), label, status, value }));
  } else if (kind === 'waveform') {
    values.forEach((value, index) => push({ occurred_at: stamp(index), positive_value: value, negative_value: values[(index + 5) % values.length] * 0.6, series: 'Разом' }));
  } else if (kind === 'ridgeline') {
    [['Мі-8', [7, 8, 8, 9, 10, 13, 14]], ['Мі-24', [5, 6, 6, 7, 16, 17]], ['Ан-26', [11, 12, 12, 13, 21]]]
      .forEach(([series, hours]) => hours.forEach((hour, index) => push({ occurred_at: `2026-10-${String(1 + index).padStart(2, '0')}T${String(hour).padStart(2, '0')}:15`, series })));
  } else if (kind === 'weather') {
    // Вигадані спостереження: три моменти, у третьому — гроза й низька НМХ на одному пункті.
    const points = [['Пункт «Північ»', 51.2, 30.9], ['Пункт «Захід»', 49.6, 24.8], ['Пункт «Центр»', 48.9, 32.4], ['Пункт «Південь»', 46.9, 31.2], ['Пункт «Схід»', 49.4, 36.1]];
    const states = [
      [[3, 1200, 2200, 10, 4, ''], [5, 900, 1800, 8, 6, ''], [2, 1500, 2500, 10, 3, ''], [1, 1800, 2400, 12, 5, ''], [4, 1100, 2000, 9, 7, '']],
      [[6, 700, 1900, 7, 7, ''], [7, 600, 2100, 6, 8, 'Дощ'], [4, 1000, 2000, 9, 5, ''], [2, 1600, 2300, 11, 6, ''], [6, 800, 1700, 6, 9, '']],
      [[8, 300, 2600, 4, 11, 'Злива'], [9, 180, 3200, 1.5, 16, 'Гроза'], [7, 450, 2400, 5, 9, ''], [3, 1400, 2200, 10, 7, ''], [8, 350, 2500, 3, 12, '']],
    ];
    states.forEach((state, step) => points.forEach(([label, latitude, longitude], index) => {
      const [cloud_cover, cloud_base_lower, cloud_base_upper, visibility, wind_speed, phenomenon] = state[index];
      push({ observed_at: `2026-10-18T${String(6 + step * 3).padStart(2, '0')}:00`, label, latitude, longitude, cloud_cover, cloud_base_lower, cloud_base_upper, visibility, wind_speed, phenomenon });
    }));
  } else if (kind === 'leaderboard') {
    units.slice(0, 5).forEach((label, index) => push({ label, group: index < 3 ? 'Ескадрилья' : 'Ланка', value: values[index], delta: [8, -2, 3, 0, 5][index] }));
  } else {
    units.slice(0, 5).forEach((label, index) => push({ label, category: label, value: values[index], status: index % 2 ? 'Виконується' : 'Готово' }));
  }
  return rows;
}

/** Друга діаграма картки журналу польотів: зльоти за годинами доби по типах ПС («гребені»). */
function takeoffVisual(module, rows) {
  if (!module.fields?.some(field => field.key === 'takeoff_time') || !module.fields.some(field => field.key === 'aircraft_type')) return null;
  const host = el('div', { class: 'ewmc-chart-host' });
  const box = el('div', { class: 'ewmc-visual ewmc-visual-extra', 'data-visual': 'ridgeline' }, host);
  mountChart(host, takeoffHoursModel(module, rows), { height: 150 });
  return box;
}

/** Картка блока з основної таблиці: показник чи діаграма тими самими малюнками, що й шаблони; без ролей — пояснення. */
function blockVisual(block) {
  if (!block.ok) return el('div', { class: 'ewmc-visual', 'data-visual': 'kpi' }, el('p', { class: 'ewmc-empty', text: block.message }));
  const host = el('div', { class: 'ewmc-chart-host' });
  const box = el('div', { class: 'ewmc-visual', 'data-visual': block.kind }, host);
  mountChart(host, block.model, { height: chartHeight(block.kind, false) });
  return box;
}

/** Картка з діаграмою модуля (або шаблону) з його рядків; перемальовується під ширину картки. */
function visual(moduleOrTemplate, rows, compact = false) {
  const template = moduleOrTemplate.templateId ? moduleOrTemplate : { ...moduleOrTemplate, templateId: moduleOrTemplate.id };
  // Діаграма живе у вкладеному вузлі: позначка «даних ще немає» поруч із ним не стирається при перемальовуванні.
  const host = el('div', { class: 'ewmc-chart-host' });
  const box = el('div', { class: `ewmc-visual ${compact ? 'compact' : ''}`, 'data-visual': template.visualKind }, host);
  mountChart(host, chartModel(template, rows), { height: chartHeight(template.visualKind, compact), compact });
  return box;
}

/** Висота діаграми картки. Погодна вища: під картою ще шкала часу й рядок показників. */
function chartHeight(kind, compact) {
  return kind === 'weather' ? (compact ? 150 : 360) : (compact ? 120 : 168);
}

/**
 * Живий перегляд модуля на сторінці його таблиці: та сама картка, що на дашборді (розмітка й стиль
 * `ewmc-module`), з рядками таблиці та чернеткою запису, який зараз вводять. `update(rows, draft)`
 * перемальовує діаграму в тих самих вузлах, не будуючи сторінку заново, тож перегляд встигає за кожним символом.
 * Перегляд лише показує дані й нічого не зберігає.
 */
function livePreview(module, savedRows) {
  const template = module.templateId ? module : { ...module, templateId: module.id };
  const height = chartHeight(template.visualKind, false);
  const host = el('div', { class: 'ewmc-chart-host' });
  const noData = el('p', { class: 'ewmc-no-data', text: 'Даних ще немає — введіть перший запис', hidden: true });
  const box = el('div', { class: 'ewmc-visual', 'data-visual': template.visualKind }, host, noData);
  const extra = takeoffVisual(module, savedRows);
  const extraHost = extra?.querySelector('.ewmc-chart-host') ?? null;
  const count = el('p');
  const badge = el('span', { class: 'ewmc-live' });
  const note = el('p', { class: 'ewmc-preview-note', 'aria-live': 'polite' });
  const card = el('article', { class: `ewmc-module ewmc-live-card span-${module.defaultSpan === 2 ? 2 : 1}`, 'data-kind': module.visualKind, 'data-style': module.style, 'data-branch': module.branch, 'data-draft': 'false' },
    el('header', { class: 'ewmc-module-head' }, el('div', {}, el('h3', { text: module.title }), count), badge),
    box,
    extra,
    note);
  const node = el('section', { class: 'ewmc-preview', 'aria-labelledby': 'ewmc-preview-title' },
    el('div', { class: 'ewmc-preview-head' },
      el('h3', { id: 'ewmc-preview-title', text: 'Попередній перегляд модуля' }),
      el('p', { text: 'Так модуль виглядатиме на дашборді. Поки ви вводите дані, картка оновлюється одразу.' })),
    card);
  function update(rows, draft = null) {
    const active = draft?.active === true;
    mountChart(host, chartModel(template, rows), { height, compact: false });
    if (extraHost) mountChart(extraHost, takeoffHoursModel(module, rows), { height: 150 });
    count.textContent = `${rowCountLabel(rows.length)} · локальна SQLite`;
    badge.textContent = active ? 'Чернетка' : rows.length ? 'Дані' : 'Створено';
    badge.classList.toggle('is-draft', active);
    card.dataset.draft = String(active);
    noData.hidden = rows.length > 0;
    const issues = draft?.issues ?? [];
    note.textContent = issues.length
      ? `Не враховано в перегляді: ${issues.slice(0, 3).map(issue => issue.message).join(' ')}`
      : active ? 'Чернетку ще не збережено: збережіть запис (Enter), щоб вона потрапила на дашборд.' : '';
  }
  update(savedRows, null);
  // Перегляд з'являється, коли користувач вводить запис: решту часу таблиця займає всю висоту сторінки.
  node.hidden = true;
  return { node, update };
}
