import {
  MAX_CREW,
  branchFromLocation,
  columnCountLabel,
  crewCount,
  crewSummary,
  fieldColumnWidth,
  fieldHint,
  fieldInputText,
  fieldInputType,
  fieldKind,
  fieldPlaceholder,
  fieldSections,
  formatFieldValue,
  formatValue,
  inheritedValues,
  isConflictError,
  matchesCatalogItem,
  normalizeCatalog,
  normalizeDensity,
  normalizeModules,
  previewModel,
  replaceRowsRequest,
  rowCountLabel,
  rowForWrite,
  rowMatchesQuery,
  rowsAfterDelete,
  rowsAfterSave,
  schemaSummary,
  tableColumnGroups,
  tableEditState,
  visibleColumnKeys,
} from './dashboard-module-catalog-core.js';
import { describePlan, importRows, planImport, rankSheets, sheetOptionLabel } from './dashboard-module-source-core.js';

const invoke = window.__TAURI_INTERNALS__?.invoke || window.parent?.__TAURI_INTERNALS__?.invoke;
if (typeof invoke === 'function') initialize();

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

function initialize() {
  const branch = branchFromLocation(location.pathname, location.search);
  const toolbar = document.querySelector('.appbar-right');
  const dashboard = branch === 'dshv' ? document.querySelector('#view-udshv') : document.querySelector('#view-dash');
  if (!toolbar || !dashboard) return;

  // `cancelEdit` — скасування рядка, що редагується: Escape скасовує правку, а не закриває вікно разом із набраним рядком.
  // `tableViews` — пошук і група колонок сторінки кожного модуля: після збереження рядка сторінка перебудовується, а вибір лишається.
  const state = { branch, catalog: [], modules: [], data: new Map(), busy: false, profileMissing: false, cancelEdit: null, tableViews: new Map() };
  const openButton = el('button', {
    type: 'button',
    class: 'btn quiet ewmc-open',
    text: 'Каталог модулів',
    title: 'Додати аналітичний модуль і створити його локальну таблицю SQLite',
  });
  toolbar.prepend(openButton);

  const host = el('section', { class: 'ewmc-host', 'aria-labelledby': 'ewmc-host-title' });
  const keepHost = () => { if (!dashboard.contains(host)) dashboard.append(host); };
  const observer = new MutationObserver(keepHost);
  observer.observe(dashboard, { childList: true });
  keepHost();

  const dialog = el('dialog', { class: 'ewmc-dialog', 'aria-labelledby': 'ewmc-dialog-title' });
  document.body.append(dialog);
  // Escape на сторінці модуля: спершу скасовує рядок, що редагується, і лише потім повертає на дашборд.
  // Каталог і форма створення закриваються як звичайне вікно.
  dialog.addEventListener('cancel', event => {
    if (dialog.dataset.view !== 'table') return;
    event.preventDefault();
    if (state.busy) return;
    if (state.cancelEdit) state.cancelEdit();
    else closePage();
  });
  dialog.addEventListener('close', () => {
    state.cancelEdit = null;
    if (dialog.dataset.view === 'table') focusModuleButton(dialog.dataset.module);
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
      const loaded = await Promise.all(state.modules.map(async module => {
        try { return [module.id, await invoke('get_dashboard_module_data', { moduleId: module.id })]; }
        // Порожній набір після збою не можна редагувати: збереження стерло б наявні рядки.
        catch { return [module.id, { module, rows: [], truncated: false, failed: true }]; }
      }));
      state.data = new Map(loaded);
    } catch (error) {
      state.modules = [];
      state.data.clear();
      state.profileMissing = /профіл/i.test(String(error));
    }
    renderHost();
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
    for (const module of state.modules) grid.append(renderModule(module, state.data.get(module.id)?.rows || []));
    host.append(grid);
  }

  function renderModule(module, rows) {
    const model = previewModel(module, rows);
    const card = el('article', { class: `ewmc-module span-${module.defaultSpan === 2 ? 2 : 1}`, 'data-kind': module.visualKind },
      el('header', { class: 'ewmc-module-head' },
        el('div', {}, el('h3', { text: module.title }), el('p', { text: `${rowCountLabel(module.rowCount)} · локальна SQLite` })),
        el('span', { class: 'ewmc-live', text: module.rowCount ? 'Дані' : 'Створено' })),
      visual(module.visualKind, model),
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
        })),
      el('details', { class: 'ewmc-schema' },
        el('summary', { text: 'Структура таблиці' }),
        el('code', { text: module.storageTable }),
        el('p', { text: schemaSummary(module.fields) })),
    );
    if (model.empty) card.querySelector('.ewmc-visual')?.append(el('p', { class: 'ewmc-no-data', text: 'Таблиця готова · даних ще немає' }));
    return card;
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
      search,
      list,
    );
    paint();
    dialog.dataset.view = 'catalog';
    if (!dialog.open) dialog.showModal();
    search.focus();
  }

  function catalogCard(item) {
    const model = previewModel({ visualKind: item.visualKind, fields: item.fields }, sampleRows(item));
    return el('article', { class: 'ewmc-catalog-card' },
      el('div', { class: 'ewmc-catalog-top' },
        el('span', { class: 'ewmc-category', text: item.category }),
        el('span', { class: 'ewmc-cols', text: `${item.fields.length} кол.` })),
      visual(item.visualKind, model, true),
      el('h3', { text: item.title }),
      el('p', { text: item.description }),
      el('div', { class: 'ewmc-fields' },
        item.fields.slice(0, 6).map(field => el('span', { text: field.label })),
        item.fields.length > 6 ? el('span', { text: `+${item.fields.length - 6} полів` }) : null),
      el('button', { type: 'button', class: 'btn primary', text: 'Створити', onclick: () => showCreate(item) }),
    );
  }

  function showCreate(item) {
    const title = el('input', { type: 'text', maxlength: '80', value: item.title, required: true, 'aria-label': 'Назва модуля' });
    const status = el('p', { class: 'ewmc-form-status', 'aria-live': 'polite' });
    const submit = el('button', { type: 'submit', class: 'btn primary', text: 'Створити модуль і таблицю' });
    // Поки таблицю читають, створювати модуль рано: підтягування вже вимкнене за замовчуванням, але не обране.
    const syncSubmit = () => { submit.disabled = state.busy || source.pending(); };
    const source = sourceBlock(item, syncSubmit);
    const form = el('form', { class: 'ewmc-create-form' },
      el('button', { type: 'button', class: 'ewmc-back', text: '← До каталогу', onclick: showCatalog }),
      el('p', { class: 'ewmc-eyebrow', text: item.category }),
      el('h2', { id: 'ewmc-dialog-title', text: item.title }),
      // Ліва колонка: вигляд, назва й дані з таблиці; праворуч — довгий список колонок нової таблиці.
      el('div', { class: 'ewmc-create-main' },
        visual(item.visualKind, previewModel({ visualKind: item.visualKind, fields: item.fields }, sampleRows(item)), true),
        el('label', { class: 'ewmc-field' }, el('span', { text: 'Назва на дашборді' }), title),
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
      if (state.busy || source.pending()) return;
      state.busy = true;
      syncSubmit();
      const name = title.value.trim();
      const rows = source.rows();
      status.classList.remove('error');
      status.textContent = rows ? `Створення локальної таблиці й запис: ${rowCountLabel(rows.length)}…` : 'Створення локальної таблиці…';
      try {
        await invoke('create_dashboard_module', { branch: state.branch, templateId: item.id, title: name, ...(rows ? { rows } : {}) });
        dialog.close();
        await loadModules();
        showToast(rows ? `Модуль «${name}» створено, підтягнуто: ${rowCountLabel(rows.length)}.` : `Модуль «${name}» створено.`);
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

  // Блок «Дані з вашої таблиці» у вікні створення: знаходить таблицю профілю (або файл, який обрав
  // користувач), зіставляє її стовпці з колонками модуля й пропонує підтягнути записи. Файл лише
  // читається. Колонки модуля, яких у таблиці немає, лишаються порожніми: дані вносять у самому модулі.
  function sourceBlock(item, onChange) {
    const model = { phase: 'loading', pending: true, message: '', origin: '', workbook: null, ranked: [], sheet: '', plan: null, use: false, carry: true };
    let request = 0;
    const body = el('div', { class: 'ewmc-source-body', 'aria-live': 'polite' });
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

    async function start() {
      const id = ++request;
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
      model.workbook = workbook;
      model.origin = workbook.origin;
      model.ranked = rankSheets(item.fields, workbook);
      const best = model.ranked[0];
      if (!best || best.matched === 0) setPhase('empty');
      else await openSheet(best.name, id);
    }

    async function openSheet(name, id = ++request) {
      model.sheet = name;
      setPhase('reading', name);
      try {
        const sheet = await invoke('read_module_source_sheet', { origin: model.origin, branch: state.branch, sheet: name });
        if (id !== request) return;
        model.plan = planImport(item.fields, sheet);
        // Таблиця, схожа лише частково, не підтягується сама: користувач вмикає це свідомо.
        model.use = model.ranked.find(entry => entry.name === name)?.confident === true && model.plan.rows.length > 0;
        // Метеоумови, яких у записі не вказано, за умовчанням беруться з попереднього запису тієї ж льотної зміни.
        model.carry = true;
        setPhase('ready');
      } catch (error) {
        if (id === request) setPhase('error', String(error));
      }
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
          nodes.push(el('p', { class: 'error', text: `Не вдалося прочитати таблицю: ${model.message}` }),
            el('div', { class: 'ewmc-source-actions' }, pickButton('Обрати файл XLSX…', true)));
          break;
        case 'empty':
          nodes.push(fileLine(),
            el('p', { text: 'У таблиці немає аркуша зі стовпцями, схожими на колонки цього модуля. Модуль буде створено з порожньою таблицею.' }),
            el('div', { class: 'ewmc-source-actions' }, pickButton('Обрати інший файл…')));
          break;
        default:
          nodes.push(...readyNodes());
      }
      body.replaceChildren(...nodes);
    }

    function readyNodes() {
      const { plan } = model;
      const notes = describePlan(plan);
      const candidate = model.ranked.find(entry => entry.name === model.sheet);
      const nodes = [fileLine()];
      if (model.ranked.length > 1) {
        const select = el('select', { 'aria-label': 'Аркуш таблиці' },
          model.ranked.map(entry => el('option', { value: entry.name, selected: entry.name === model.sheet, text: sheetOptionLabel(entry) })));
        select.addEventListener('change', () => openSheet(select.value));
        nodes.push(select);
      }
      nodes.push(el('p', { class: 'ewmc-source-summary' }, el('strong', { text: notes.summary }), ` ${notes.columns}`));
      const lines = [];
      const add = (text, warn = false) => { if (text) lines.push(el('li', { class: warn ? 'warn' : '', text })); };
      add(notes.blocked, true);
      if (candidate && !candidate.confident && plan.rows.length) add('Таблиця схожа на модуль лише частково, тому підтягування вимкнено — увімкніть його, якщо записи розібрано правильно.', true);
      add(notes.missing);
      add(notes.extra);
      add(notes.skipped, true);
      add(notes.carryUnresolved, true);
      notes.warnings.forEach(text => add(text, true));
      add(notes.truncated, true);
      if (lines.length) nodes.push(el('ul', { class: 'ewmc-source-notes' }, lines));
      const use = el('input', { type: 'checkbox', disabled: !plan.rows.length });
      use.checked = model.use;
      // Протягнути метеоумови можна, лише якщо є на які записи й записи взагалі підтягуються.
      const carry = plan.carry.possible ? el('input', { type: 'checkbox', disabled: !model.use }) : null;
      if (carry) carry.checked = model.carry;
      use.addEventListener('change', () => {
        model.use = use.checked;
        if (carry) carry.disabled = !use.checked;
      });
      carry?.addEventListener('change', () => { model.carry = carry.checked; });
      nodes.push(el('label', { class: 'ewmc-source-use' }, use,
        el('span', { text: plan.rows.length ? `Підтягнути ${rowCountLabel(plan.rows.length)} у новий модуль` : 'Підтягувати нічого' })));
      if (carry) {
        nodes.push(el('div', { class: 'ewmc-source-carry' },
          el('label', { class: 'ewmc-source-use' }, carry, el('span', { text: notes.carryLabel })),
          el('p', { class: 'ewmc-source-hint', text: notes.carry })));
      }
      if (plan.found.length) {
        nodes.push(el('details', {},
          el('summary', { text: 'Які стовпці таблиці куди потраплять' }),
          el('dl', { class: 'ewmc-source-map' }, plan.found.flatMap(entry => [el('dt', { text: entry.label }), el('dd', { text: entry.from })]))));
      }
      if (plan.firstRecord.length) {
        nodes.push(el('details', {},
          el('summary', { text: 'Перший запис таким, яким його буде збережено' }),
          el('dl', { class: 'ewmc-source-map' }, plan.firstRecord.flatMap(entry => [el('dt', { text: entry.label }), el('dd', { text: entry.text })]))));
      }
      nodes.push(el('div', { class: 'ewmc-source-actions' }, pickButton('Обрати інший файл…')));
      return nodes;
    }

    return {
      node,
      start,
      pending: () => model.pending,
      rows: () => (model.phase === 'ready' && model.use && model.plan?.rows.length ? importRows(model.plan, { carryWeather: model.carry }) : null),
      // Після закриття вікна пізні відповіді таблиці вже нікуди не потраплять.
      dispose: () => { request += 1; },
    };
  }

  async function reopenFresh(moduleId, message = '', view = null) {
    await loadModules();
    const fresh = state.modules.find(item => item.id === moduleId);
    if (fresh) showModulePage(fresh, null, view);
    else if (dialog.open) dialog.close();
    if (message) showToast(message, true);
  }

  // Таблиця модуля відкривається окремою сторінкою на весь екран, а не вікном поверх дашборда.
  // `view` — де стоїть таблиця: після додавання рядка вона гортається до кінця, після правки лишається на місці.
  function showModulePage(module, focusTarget = null, view = null) {
    state.cancelEdit = null;
    const payload = state.data.get(module.id) || { rows: [], truncated: false, failed: true };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
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

      function finish() {
        state.cancelEdit = null;
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
          state.data.set(module.id, { module: updated, rows: Array.isArray(result?.rows) ? result.rows : [], truncated: result?.truncated === true });
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
        addButton),
      el('div', { class: 'ewmc-page-body' },
        ...(readOnly ? [el('div', { class: 'ewmc-readonly' },
          el('p', { class: 'ewmc-form-status error', text: access.reason }),
          payload.failed === true
            ? el('button', { type: 'button', class: 'btn quiet', text: 'Прочитати знову', onclick: () => reopenFresh(module.id) })
            : null)] : []),
        toolbar,
        editHost,
        scroll,
        emptyNote,
        noMatch),
    );
    paintDensity(readDensity());
    applyView();
    dialog.dataset.view = 'table';
    dialog.dataset.module = module.id;
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

function sampleRows(item) {
  const labels = ['ПС-1', 'ПС-2', 'ПС-3', 'ПС-4', 'ПС-5'];
  return labels.map((label, index) => Object.fromEntries(item.fields.map(field => {
    if (field.role === 'metric' || ['latitude', 'longitude', 'order'].includes(field.role)) {
      if (field.key.includes('target') || field.key === 'maximum') return [field.key, 100];
      if (field.key === 'minimum') return [field.key, 0];
      if (field.role === 'latitude') return [field.key, 48 + index * .7];
      if (field.role === 'longitude') return [field.key, 24 + index * 2.2];
      return [field.key, [42, 68, 54, 88, 74][index]];
    }
    if (field.dataType === 'date') return [field.key, `2026-10-${String(index + 1).padStart(2, '0')}`];
    if (field.dataType === 'datetime') return [field.key, `2026-10-0${index + 1}T12:00:00Z`];
    if (field.dataType === 'boolean') return [field.key, index % 2 === 0];
    if (field.role === 'status') return [field.key, index % 2 ? 'Виконується' : 'Готово'];
    return [field.key, field.role === 'series' ? (index % 2 ? 'Серія Б' : 'Серія А') : label];
  })));
}

function visual(kind, model, compact = false) {
  const box = el('div', { class: `ewmc-visual ${compact ? 'compact' : ''}`, 'data-visual': kind, 'aria-hidden': 'true' });
  const points = model.points.length ? model.points : [{ label: '—', values: [0] }];
  if (kind === 'kpi') {
    box.append(el('strong', { class: 'ewmc-kpi', text: formatValue(points[0]?.values[0] || model.total) }), el('small', { text: points[0]?.label || 'Показник' }));
  } else if (['line', 'area', 'waveform'].includes(kind)) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 220 92');
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    const max = model.max || 1;
    line.setAttribute('points', points.slice(0, 10).map((point, index, all) => `${10 + index * (200 / Math.max(1, all.length - 1))},${82 - (point.values[0] || 0) / max * 66}`).join(' '));
    line.setAttribute('class', 'ewmc-line');
    svg.append(line); box.append(svg);
  } else if (['columns', 'grouped-columns'].includes(kind)) {
    const bars = points.slice(0, 8).flatMap(point => point.values.slice(0, 2).map(value =>
      el('i', { style: { height: `${12 + (value / (model.max || 1)) * 72}%` } })));
    box.append(el('div', { class: 'ewmc-columns' }, bars));
  } else if (['horizontal-bar', 'progress-bars'].includes(kind)) {
    const bars = points.slice(0, 6).map(point => el('div', {},
      el('span', { text: point.label }),
      point.values.slice(0, 2).map(value => el('i', { style: { width: `${8 + (value / (model.max || 1)) * 88}%` } }))));
    box.append(el('div', { class: 'ewmc-bars' }, bars));
  } else if (['donut', 'radial-progress', 'multi-ring', 'gauge'].includes(kind)) {
    const percent = model.percent || (model.total ? 68 : 0);
    box.append(el('div', { class: `ewmc-ring ${kind}`, style: { '--pct': `${percent}%` } }, el('b', { text: `${Math.round(percent)}%` })));
  } else if (kind === 'radar') {
    box.append(el('div', { class: 'ewmc-radar' }, el('i'), el('i'), el('i')));
  } else if (['calendar', 'cohort'].includes(kind)) {
    box.append(el('div', { class: 'ewmc-cells' }, Array.from({ length: kind === 'calendar' ? 35 : 24 }, (_, index) => el('i', { style: { opacity: String(.2 + ((index * 7) % 9) / 11) } }))));
  } else if (kind === 'funnel') {
    box.append(el('div', { class: 'ewmc-funnel' }, [100, 78, 56, 34].map(width => el('i', { style: { width: `${width}%` } }))));
  } else if (kind === 'map') {
    box.append(el('div', { class: 'ewmc-map' }, points.slice(0, 5).map((_, index) => el('i', { style: { left: `${18 + index * 15}%`, top: `${25 + (index % 3) * 18}%` } }))));
  } else if (kind === 'activity') {
    box.append(el('div', { class: 'ewmc-activity' }, points.slice(0, 4).map(point => el('p', {}, el('i'), el('span', { text: point.label }))))) ;
  } else {
    box.append(el('div', { class: 'ewmc-mini-table' }, points.slice(0, 4).map(point => el('p', {}, el('span', { text: point.label }), el('b', { text: formatValue(point.values[0]) }))))) ;
  }
  return box;
}
