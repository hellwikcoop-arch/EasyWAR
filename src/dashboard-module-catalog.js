import {
  branchFromLocation,
  fieldHint,
  fieldInputText,
  fieldInputType,
  fieldKind,
  fieldPlaceholder,
  formatFieldValue,
  formatValue,
  isConflictError,
  matchesCatalogItem,
  normalizeCatalog,
  normalizeModules,
  previewModel,
  replaceRowsRequest,
  rowForWrite,
  rowsAfterDelete,
  rowsAfterSave,
  schemaSummary,
  tableEditState,
} from './dashboard-module-catalog-core.js';

const invoke = window.__TAURI_INTERNALS__?.invoke || window.parent?.__TAURI_INTERNALS__?.invoke;
if (typeof invoke === 'function') initialize();

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

  const state = { branch, catalog: [], modules: [], data: new Map(), busy: false, profileMissing: false };
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
        el('div', {}, el('h3', { text: module.title }), el('p', { text: `${module.rowCount} записів · локальна SQLite` })),
        el('span', { class: 'ewmc-live', text: module.rowCount ? 'Дані' : 'Створено' })),
      visual(module.visualKind, model),
      el('div', { class: 'ewmc-module-actions' },
        el('button', { type: 'button', class: 'btn quiet', text: 'Відкрити таблицю', onclick: () => showDataTable(module) })),
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
    const form = el('form', { class: 'ewmc-create-form' },
      el('button', { type: 'button', class: 'ewmc-back', text: '← До каталогу', onclick: showCatalog }),
      el('p', { class: 'ewmc-eyebrow', text: item.category }),
      el('h2', { id: 'ewmc-dialog-title', text: item.title }),
      visual(item.visualKind, previewModel({ visualKind: item.visualKind, fields: item.fields }, sampleRows(item)), true),
      el('label', { class: 'ewmc-field' }, el('span', { text: 'Назва на дашборді' }), title),
      el('section', { class: 'ewmc-table-plan' },
        el('h3', { text: 'Колонки нової таблиці' }),
        el('div', {}, item.fields.map(field => el('div', { class: 'ewmc-plan-row' },
          el('b', { text: field.label }),
          el('code', { text: field.key }),
          el('span', { text: field.dataType }))))),
      status,
      el('div', { class: 'ewmc-form-actions' },
        el('button', { type: 'button', class: 'btn quiet', text: 'Скасувати', onclick: () => dialog.close() }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Створити модуль і таблицю' })),
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy) return;
      state.busy = true;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      status.textContent = 'Створення локальної таблиці…';
      try {
        await invoke('create_dashboard_module', { branch: state.branch, templateId: item.id, title: title.value.trim() });
        dialog.close();
        await loadModules();
        showToast(`Модуль «${title.value.trim()}» створено.`);
      } catch (error) {
        status.textContent = String(error || 'Не вдалося створити модуль.');
        status.classList.add('error');
      } finally {
        state.busy = false;
        submit.disabled = false;
      }
    });
    dialog.replaceChildren(form);
    title.focus();
    title.select();
  }

  async function reopenFresh(moduleId, message = '') {
    await loadModules();
    const fresh = state.modules.find(item => item.id === moduleId);
    if (fresh) showDataTable(fresh);
    else if (dialog.open) dialog.close();
    if (message) showToast(message, true);
  }

  function showDataTable(module) {
    const payload = state.data.get(module.id) || { rows: [], truncated: false, failed: true };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const access = tableEditState(payload);
    const readOnly = !access.editable;
    const unreadable = payload.failed === true;
    const body = el('tbody');
    if (!rows.length) {
      body.append(el('tr', {}, el('td', { colspan: String(module.fields.length + 1), class: 'ewmc-table-empty', text: unreadable ? 'Дані не прочитано.' : 'Записів ще немає.' })));
    } else {
      rows.forEach((row, index) => body.append(el('tr', {},
        module.fields.map(field => el('td', { text: formatFieldValue(field, row?.[field.key]) })),
        el('td', { class: 'ewmc-row-actions' },
          el('button', {
            type: 'button',
            class: 'btn quiet',
            text: 'Редагувати',
            disabled: readOnly,
            onclick: () => showRowForm(module, index),
          })))));
    }
    const table = el('table', { class: 'ewmc-data-table' },
      el('thead', {}, el('tr', {},
        module.fields.map(field => el('th', { scope: 'col', text: field.label })),
        el('th', { scope: 'col', text: 'Дія' }))),
      body);
    dialog.replaceChildren(
      el('form', { method: 'dialog', class: 'ewmc-dialog-head' },
        el('div', {},
          el('p', { class: 'ewmc-eyebrow', text: 'Локальна SQLite-таблиця' }),
          el('h2', { id: 'ewmc-dialog-title', text: module.title }),
          el('p', { text: `${unreadable ? 'Дані недоступні' : `${rows.length} записів`} · ${module.fields.length} колонок` })),
        el('button', { value: 'cancel', class: 'ewmc-close', 'aria-label': 'Закрити', text: '×' })),
      el('div', { class: 'ewmc-data-toolbar' },
        el('code', { text: module.storageTable }),
        el('button', {
          type: 'button',
          class: 'btn primary',
          text: '+ Додати рядок',
          disabled: readOnly,
          onclick: () => showRowForm(module, null),
        })),
      ...(readOnly ? [el('div', { class: 'ewmc-readonly' },
        el('p', { class: 'ewmc-form-status error', text: access.reason }),
        payload.failed === true
          ? el('button', { type: 'button', class: 'btn quiet', text: 'Прочитати знову', onclick: () => reopenFresh(module.id) })
          : null)] : []),
      el('div', { class: 'ewmc-data-scroll' }, table),
    );
    if (!dialog.open) dialog.showModal();
  }

  function showRowForm(module, rowIndex) {
    const payload = state.data.get(module.id) || { rows: [], failed: true };
    // Запис замінює весь набір рядків: без повністю прочитаної таблиці форма не відкривається.
    if (!tableEditState(payload).editable) { showDataTable(module); return; }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const isEdit = Number.isInteger(rowIndex) && rows[rowIndex] != null;
    const existing = isEdit ? rows[rowIndex] : {};
    const controls = new Map();
    const formGrid = el('div', { class: 'ewmc-row-form-grid' });
    for (const field of module.fields) {
      const control = createFieldControl(field, existing[field.key]);
      controls.set(field.key, control);
      // Підказка (кілограми для літрів, метри для «0,3 км») оновлюється під час введення; порожня — прихована.
      const hint = el('small', { class: 'ewmc-hint', id: `ewmc-hint-${field.key}` });
      const paintHint = () => { hint.textContent = fieldHint(field, control.value); };
      paintHint();
      control.addEventListener('input', paintHint);
      control.setAttribute('aria-describedby', hint.id);
      formGrid.append(el('label', { class: 'ewmc-field' },
        el('span', { text: `${field.label}${field.required ? ' *' : ''}` }),
        control,
        hint));
    }
    const status = el('p', { class: 'ewmc-form-status', 'aria-live': 'polite' });
    const saveButton = el('button', { type: 'submit', class: 'btn primary', text: isEdit ? 'Зберегти зміни' : 'Додати рядок' });
    const cancelButton = el('button', { type: 'button', class: 'btn quiet', text: 'Скасувати', onclick: () => showDataTable(module) });
    // Видалення — лише для наявного запису й лише після підтвердження в самому вікні (без системних діалогів).
    const removeButton = isEdit ? el('button', { type: 'button', class: 'btn ewmc-danger', text: 'Видалити запис' }) : null;
    const keepButton = isEdit ? el('button', { type: 'button', class: 'btn quiet', text: 'Ні, залишити' }) : null;
    const confirmButton = isEdit ? el('button', { type: 'button', class: 'btn ewmc-danger solid', text: 'Так, видалити' }) : null;
    const confirmBox = isEdit
      ? el('div', { class: 'ewmc-confirm', role: 'group', 'aria-labelledby': 'ewmc-confirm-text', hidden: true },
        el('p', { id: 'ewmc-confirm-text', text: 'Видалити цей запис із локальної таблиці? Дію не можна скасувати.' }),
        el('div', { class: 'ewmc-confirm-actions' }, keepButton, confirmButton))
      : null;
    const lockable = [saveButton, cancelButton, removeButton, keepButton, confirmButton].filter(Boolean);
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
    const form = el('form', { class: 'ewmc-row-form' },
      el('button', { type: 'button', class: 'ewmc-back', text: '← До таблиці', onclick: () => showDataTable(module) }),
      el('p', { class: 'ewmc-eyebrow', text: isEdit ? 'Редагування запису' : 'Новий запис' }),
      el('h2', { id: 'ewmc-dialog-title', text: module.title }),
      formGrid,
      status,
      confirmBox,
      el('div', { class: 'ewmc-form-actions' }, removeButton, cancelButton, saveButton),
    );

    // Запис замінює весь набір рядків; `expectedUpdatedAt` не дає перезаписати зміни з іншого вікна.
    async function persist(nextRows, doneMessage) {
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
        showDataTable(updated);
        showToast(doneMessage);
      } catch (error) {
        if (isConflictError(error)) {
          await reopenFresh(module.id, 'Таблицю змінено в іншому вікні. Показано актуальні дані — повторіть дію.');
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
      let edited;
      try {
        const values = Object.fromEntries([...controls].map(([key, control]) => [key, control.value]));
        edited = rowForWrite(module.fields, values, existing);
      } catch (error) {
        status.textContent = String(error?.message || error || 'Не вдалося зберегти запис.');
        status.classList.add('error');
        return;
      }
      persist(rowsAfterSave(module.fields, rows, isEdit ? rowIndex : null, edited), isEdit ? 'Запис оновлено.' : 'Рядок додано.');
    });
    // Повідомлення про помилку зникає, щойно користувач береться виправляти поле, і не висить поруч із уже виправленим.
    form.addEventListener('input', () => {
      if (state.busy || !status.classList.contains('error')) return;
      status.textContent = '';
      status.classList.remove('error');
    });
    if (isEdit) {
      removeButton.addEventListener('click', () => askToRemove(true));
      keepButton.addEventListener('click', () => askToRemove(false));
      confirmButton.addEventListener('click', () => persist(rowsAfterDelete(module.fields, rows, rowIndex), 'Запис видалено.'));
    }
    dialog.replaceChildren(form);
    if (!dialog.open) dialog.showModal();
    controls.values().next().value?.focus();
  }

  function createFieldControl(field, value) {
    const type = fieldInputType(field);
    if (field.key === 'day_night') {
      const select = el('select', { 'aria-label': field.label },
        el('option', { value: '', text: '— Не вказано' }),
        el('option', { value: 'День', text: 'День' }),
        el('option', { value: 'Ніч', text: 'Ніч' }));
      select.value = value == null ? '' : String(value);
      return select;
    }
    if (type === 'select') {
      const select = el('select', { 'aria-label': field.label },
        el('option', { value: '', text: '— Не вказано' }),
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
    if (type === 'number' && kind === 'fuel') attributes.min = '0';
    if (type === 'text') attributes.maxlength = kind ? '16' : '4096';
    return el('input', attributes);
  }

  function showToast(message, error = false) {
    const toast = el('div', { class: `ewmc-toast${error ? ' error' : ''}`, role: 'status', text: message });
    document.body.append(toast);
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
