// Вибір стовпців мишею у вікні створення модуля: перші рядки таблиці користувача, де заголовок кожного
// стовпця — кнопка. Клацнули — стовпець лягає в найбільш підхожу колонку модуля, а нижче з'являються інші
// модулі каталогу, у які вкладається те саме. Уся логіка зіставлення — у `dashboard-module-mapping-core.js`
// (тестується окремо), тут лише розмітка й обробники. Файл таблиці не змінюється: тут тільки читаються
// рядки, які вже прочитав Rust.
import {
  COUNT,
  NONE,
  PREVIEW_ROWS,
  bindTemplate,
  canCount,
  columnSummary,
  compatibility,
  countAllowed,
  detectHeaderIndex,
  previewText,
  profileColumns,
  rankTemplates,
} from './dashboard-module-mapping-core.js';
import { importRows, planImport } from './dashboard-module-source-core.js';
import { pluralForm, rowCountLabel } from './dashboard-module-catalog-core.js';

/** Скільки пропозицій видно одразу; решту відкриває кнопка. */
const SUGGEST_VISIBLE = 4;
/** З яких перших рядків аркуша можна обрати рядок заголовків. */
const HEADER_CHOICES = 12;
const NO_HEADER = '-1';

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}

const columnsWord = count => `${count} ${pluralForm(count, 'стовпець', 'стовпці', 'стовпців')}`;

/**
 * `item` — шаблон, у якому працює користувач; `templates` — увесь каталог для пропозицій; `sheet` —
 * прочитаний аркуш (`{ rows: [{ number, cells }] }`); `visual(template, rows, compact)` малює картку модуля;
 * `initial` — `{ headerIndex, selected }`, коли вибір переходить із іншого шаблону. `onChange(binding)`
 * викликається після кожної зміни користувача, `onChoose(entry, snapshot)` — коли він обрав пропозицію.
 */
export function columnPicker({ item, templates, sheet, visual, initial = {}, onChange = () => {}, onChoose = () => {} }) {
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const fieldByKey = new Map(item.fields.map(field => [field.key, field]));
  let headerIndex = Number.isInteger(initial.headerIndex) ? initial.headerIndex : detectHeaderIndex(rows);
  let columns = profileColumns(rows, headerIndex);
  const known = () => new Set(columns.map(column => column.index));
  let selected = (Array.isArray(initial.selected) ? initial.selected : []).filter(choice => choice === COUNT || known().has(choice));
  // Закріплене у списку «Куди піде»: індекс стовпця, `COUNT` або `NONE` (колонку свідомо лишено порожньою).
  let pinned = {};
  let showAll = false;
  let result = bind();

  function bind() {
    return bindTemplate(item, columns, { prefer: selected, pinned });
  }

  const canCountHere = countAllowed(item) && item.fields.some(canCount);

  // --- Рядок заголовків і «кількість записів»
  const headerSelect = el('select', { 'aria-label': 'Рядок заголовків таблиці' });
  headerSelect.addEventListener('change', () => {
    headerIndex = Number(headerSelect.value);
    columns = profileColumns(rows, headerIndex);
    const present = known();
    selected = selected.filter(choice => choice === COUNT || present.has(choice));
    pinned = {};
    buildTable();
    buildMap();
    refresh();
  });
  const countChip = el('button', {
    type: 'button',
    class: 'ewmc-pick-count',
    'aria-pressed': 'false',
    'data-action': 'pick-count',
    title: 'Кожен рядок таблиці рахується за одиницю: модуль сам підсумує їх за категоріями й покаже частки.',
    hidden: !canCountHere,
    onclick: toggleCount,
  }, el('b', { text: '∑', 'aria-hidden': 'true' }), el('span', { text: 'Кількість записів' }));

  function fillHeaderSelect() {
    const options = [];
    rows.slice(0, HEADER_CHOICES).forEach((row, index) => {
      const names = (Array.isArray(row?.cells) ? row.cells : []).filter(cell => typeof cell === 'string' && cell.trim()).slice(0, 3).map(cell => previewText(cell));
      if (names.length) options.push(el('option', { value: String(index), text: `Рядок ${row.number}: ${names.join(', ')}` }));
    });
    options.push(el('option', { value: NO_HEADER, text: 'Заголовків немає — дані з першого рядка' }));
    headerSelect.replaceChildren(...options);
    if (![...headerSelect.options].some(option => Number(option.value) === headerIndex)) {
      headerSelect.prepend(el('option', { value: String(headerIndex), text: `Рядок ${rows[headerIndex]?.number ?? headerIndex + 1}` }));
    }
    headerSelect.value = String(headerIndex);
  }

  // --- Перегляд таблиці: заголовки — кнопки
  const tableHost = el('div', { class: 'ewmc-pick-scroll', role: 'region', 'aria-label': 'Перші рядки таблиці', tabindex: '0' });
  const headers = new Map();

  function buildTable() {
    headers.clear();
    const head = el('tr');
    for (const column of columns) {
      const tag = el('em', { class: 'ewmc-pick-tag' });
      const button = el('button', {
        type: 'button',
        class: 'ewmc-pick-col',
        'aria-pressed': 'false',
        'data-col': column.index,
        title: `${column.label}: ${columnSummary(column)}`,
        disabled: column.kind === 'empty',
        onclick: () => toggleChoice(column.index),
      }, el('span', { class: 'ewmc-pick-name', text: column.label }), el('small', { text: columnSummary(column) }), tag);
      headers.set(column.index, { button, tag });
      head.append(el('th', { scope: 'col', 'data-col': column.index }, button));
    }
    const first = headerIndex + 1;
    const body = rows.slice(first, first + PREVIEW_ROWS).map(row => el('tr', {},
      columns.map(column => {
        const cell = Array.isArray(row?.cells) ? row.cells[column.index] : null;
        return el('td', { 'data-col': column.index, title: cell == null ? false : String(cell), text: previewText(cell) });
      })));
    tableHost.replaceChildren(el('table', { class: 'ewmc-pick-table' }, el('thead', {}, head), el('tbody', {}, body)));
  }

  // --- «Куди піде»: кожна колонка модуля й стовпець, який у неї лягає; тут його можна змінити
  const mapHost = el('div', { class: 'ewmc-pick-map' });
  const slots = new Map();

  function buildMap() {
    slots.clear();
    for (const field of item.fields) {
      const select = el('select', { 'aria-label': `Стовпець таблиці для колонки «${field.label}»`, 'data-key': field.key });
      select.append(el('option', { value: NONE, text: '— не заповнювати —' }));
      if (countAllowed(item) && canCount(field)) select.append(el('option', { value: COUNT, text: 'кількість записів' }));
      for (const column of columns) {
        if (compatibility(field, column) > 0) select.append(el('option', { value: String(column.index), text: `${column.label} · ${columnSummary(column)}` }));
      }
      select.addEventListener('change', () => pin(field.key, select.value));
      slots.set(field.key, select);
    }
    mapHost.replaceChildren(el('h4', { text: 'Куди піде' }), ...item.fields.map(field => el('label', { class: 'ewmc-pick-slot' },
      el('span', {}, field.label, field.required ? el('abbr', { title: 'Обов\'язкова колонка', text: ' *' }) : null),
      slots.get(field.key))));
  }

  const status = el('p', { class: 'ewmc-pick-status', 'aria-live': 'polite' });
  const suggestHost = el('div', { class: 'ewmc-pick-suggest' });

  // --- Дії користувача
  function toggleChoice(choice) {
    if (selected.includes(choice)) {
      selected = selected.filter(value => value !== choice);
      for (const [key, value] of Object.entries(pinned)) if (value === choice) delete pinned[key];
    } else {
      selected = [...selected, choice];
    }
    refresh();
  }

  // «Кількість записів» може стояти в колонці й без клацання (єдиний вибір — категорія), тому вимикається вона явним закріпленням порожнього місця.
  function toggleCount() {
    const counted = Object.values(result.picks).includes(COUNT);
    if (counted) {
      selected = selected.filter(value => value !== COUNT);
      for (const field of item.fields) if (result.picks[field.key] === COUNT) pinned[field.key] = NONE;
    } else {
      if (!selected.includes(COUNT)) selected = [...selected, COUNT];
      for (const field of item.fields) if (pinned[field.key] === NONE && canCount(field)) delete pinned[field.key];
    }
    refresh();
  }

  function pin(key, value) {
    const choice = value === NONE || value === COUNT ? value : Number(value);
    // Один стовпець — одна колонка: колонка, яка його мала, стає порожньою.
    for (const [other, current] of Object.entries(result.picks)) if (other !== key && current === choice) pinned[other] = NONE;
    pinned[key] = choice;
    if (choice !== NONE && !selected.includes(choice)) selected = [...selected, choice];
    refresh();
  }

  // --- Оновлення вигляду без перебудови таблиці, щоб не губити фокус на кнопці, яку щойно натиснули
  function refresh(notify = true) {
    result = bind();
    const labelOf = new Map();
    for (const [key, pick] of Object.entries(result.picks)) if (pick !== COUNT) labelOf.set(pick, fieldByKey.get(key)?.label ?? key);
    for (const column of columns) {
      const entry = headers.get(column.index);
      if (!entry) continue;
      const on = selected.includes(column.index);
      entry.button.setAttribute('aria-pressed', String(on));
      entry.button.dataset.state = !on ? '' : labelOf.has(column.index) ? 'placed' : 'left';
      entry.tag.textContent = !on ? '' : labelOf.has(column.index) ? `→ ${labelOf.get(column.index)}` : 'цей модуль не бере';
      for (const cell of tableHost.querySelectorAll(`td[data-col="${column.index}"]`)) cell.classList.toggle('is-picked', on);
    }
    const counted = Object.values(result.picks).includes(COUNT);
    countChip.setAttribute('aria-pressed', String(counted));
    for (const [key, select] of slots) select.value = result.picks[key] === undefined ? NONE : String(result.picks[key]);
    paintStatus();
    paintSuggestions();
    if (notify) onChange(binding());
  }

  function paintStatus() {
    const missing = result.missing.map(key => `«${fieldByKey.get(key)?.label ?? key}»`);
    const unusedNames = result.unused.map(choice => columns.find(column => column.index === choice)?.label).filter(Boolean);
    status.classList.toggle('warn', Boolean(missing.length || unusedNames.length));
    if (!selected.length) status.textContent = 'Клацніть заголовки стовпців, які хочете бачити в модулі: вони самі лягають у потрібні колонки.';
    else if (missing.length) status.textContent = `Ще потрібно вказати: ${missing.join(', ')}. Клацніть стовпець таблиці або оберіть його у списку «Куди піде».`;
    else if (unusedNames.length) status.textContent = `Цей модуль не бере: ${unusedNames.join(', ')}. Нижче — модулі, які підходять до обраного.`;
    else status.textContent = `Обрано: ${columnsWord(selected.filter(choice => choice !== COUNT).length)}${selected.includes(COUNT) ? ' і кількість записів' : ''}. Усе лягло в модуль.`;
  }

  // --- Інші модулі, у які вкладається обране: міні-картка з вашими даними й кнопка «Створити такий модуль»
  function paintSuggestions() {
    if (!selected.length) {
      suggestHost.replaceChildren(el('p', { class: 'ewmc-pick-empty', text: 'Оберіть стовпці — тут з\'являться модулі, які до них підходять.' }));
      return;
    }
    const entries = rankTemplates(templates, columns, selected, { exclude: item.id });
    if (!entries.length) {
      suggestHost.replaceChildren(el('p', { class: 'ewmc-pick-empty', text: 'Жоден інший модуль не бере такий набір стовпців. Зніміть позначку з одного зі стовпців.' }));
      return;
    }
    const shown = showAll ? entries : entries.slice(0, SUGGEST_VISIBLE);
    const cards = shown.map(entry => suggestionCard(entry));
    const more = entries.length - shown.length;
    suggestHost.replaceChildren(
      // Коли жоден модуль не бере все обране, показуються найближчі: кожен каже, що лишає осторонь.
      el('h4', { text: entries[0].unused.length ? `Жоден модуль не бере все обране. Найближчі: ${entries.length}` : `Підходять до обраного: ${entries.length}` }),
      el('div', { class: 'ewmc-suggest-grid' }, cards),
      more > 0 ? el('button', { type: 'button', class: 'btn quiet', 'data-action': 'more-suggestions', text: `Показати ще ${more}`, onclick: () => { showAll = true; paintSuggestions(); } }) : null,
    );
  }

  function suggestionCard(entry) {
    const plan = planImport(entry.template.fields, sheet, { binding: { headerIndex, picks: entry.picks } });
    const data = importRows(plan);
    const left = entry.unused.map(choice => columns.find(column => column.index === choice)?.label).filter(Boolean);
    return el('article', { class: 'ewmc-suggest', 'data-template': entry.template.id },
      el('h5', { text: entry.template.title }),
      data.length ? visual(entry.template, data, true) : el('p', { class: 'ewmc-pick-empty', text: 'У цих стовпцях немає записів для картки.' }),
      el('p', { class: 'ewmc-suggest-line', text: entry.line }),
      left.length ? el('p', { class: 'ewmc-suggest-left', text: `Не бере: ${left.join(', ')}` }) : null,
      el('button', {
        type: 'button',
        class: 'btn',
        'data-action': 'choose-template',
        text: `Створити такий модуль${data.length ? ` · ${rowCountLabel(data.length)}` : ''}`,
        onclick: () => onChoose(entry, snapshot()),
      }));
  }

  function binding() {
    return { headerIndex, picks: { ...result.picks } };
  }

  /** Що переходить у вікно іншого шаблону: рядок заголовків і клацнуті стовпці (закріплення колонок — ні, вони з іншого шаблону). */
  function snapshot() {
    return { headerIndex, selected: [...selected] };
  }

  const node = el('div', { class: 'ewmc-pick' },
    el('div', { class: 'ewmc-pick-tools' },
      el('label', { class: 'ewmc-pick-header' }, el('span', { text: 'Рядок заголовків' }), headerSelect),
      countChip),
    tableHost,
    status,
    mapHost,
    suggestHost);

  fillHeaderSelect();
  buildTable();
  buildMap();
  refresh(false);

  return { node, binding, snapshot };
}
