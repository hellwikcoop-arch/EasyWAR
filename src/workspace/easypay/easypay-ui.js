// easyPay: інтерфейс особистого калькулятора й журналу виплат за макетами набору 1
// (plans/easypay/vizuali/nabir-1): вкладки «Мої виплати» (список, картка пункту, «Рік у графіку»),
// «Розрахунок» (блоки, живий підсумок, довідник посад №317), «Нагадування», «Довідка».
// Логіка — easypay-core.js; журнал зберігається лише у файлі .easypay через host оболонки.
import {
  COMBAT_CATEGORIES,
  LEDGER_EXTENSION,
  PAYMENT_KINDS,
  RANKS,
  RULES_232_FROM,
  addCalculation,
  addCustomItem,
  addPayment,
  calculateMonth,
  emptyLedger,
  filterItems,
  firstContractPayment,
  formatMoney,
  groupByMonth,
  itemStatus,
  ledgerSummary,
  ledgerYears,
  monthTitle,
  dateTitle,
  parseLedger,
  plural,
  nextMonth,
  previousMonth,
  reminders,
  removeItem,
  removePayment,
  serializeLedger,
  shortDate,
  yearSeries,
} from './easypay-core.js';
import { POSTS_317 } from './posady-317.js';

const FILE_OPTIONS = { extensions: [LEDGER_EXTENSION], filterName: 'Журнал easyPay' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const DAYS = ['день', 'дні', 'днів'];
const DISCLAIMER = 'Суми до утримання податків і зборів. Не юридична консультація.';

// Контури значків 24×24 (лінія 1.6, без заливки) — той самий стиль, що й у макетах.
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 4v5h7V4M8 20v-6h8v6',
  file: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5',
  back: 'M19 12H5m6-6-6 6 6 6',
  next: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8.5v.5',
  warn: 'M12 4 2.5 20h19zm0 6v4m0 3v.5',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zm4 4h4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v4l3 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4m8-4v4',
  check: 'm5 12 5 5 9-10',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  close: 'M6 6l12 12M18 6 6 18',
  flag: 'M5 21V4m0 1h11l-2 4 2 4H5',
  alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v5m0 3v.5',
  chart: 'M4 20h16M7 16v-5m5 5V7m5 9v-8',
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

function icon(name, className = 'ep-ico') {
  return svg('svg', { class: className, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: ICONS[name] }));
}

/** Значок easyPay з набору (icons/easypay-icon-64.svg). */
function appIcon(className) {
  return svg('svg', { class: className, viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { x: 9, y: 10, width: 46, height: 44, rx: 7 }),
    svg('path', { d: 'M17 20h30M17 44h30', opacity: '.7' }),
    svg('path', { d: 'M32 25v14m-5-14h10m-10 6h8c4 0 4 8 0 8h-8' }));
}

function button(label, onclick, { kind = '', iconName = '', attrs = {} } = {}) {
  return el('button', { type: 'button', class: `ep-btn${kind ? ` ep-btn-${kind}` : ''}`, onclick, ...attrs }, iconName ? icon(iconName) : null, label);
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function capital(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Сума великими цифрами з дрібним «грн». */
function bigMoney(amount, className = '') {
  const text = formatMoney(amount, { cents: true });
  return el('strong', { class: `ep-big ${className}` }, text.replace(/ грн$/, ''), el('span', { class: 'ep-unit', text: 'грн' }));
}

function money(amount) {
  return formatMoney(amount, { cents: true });
}

const STATUS_TONE = { paid: 'ok', overpaid: 'ok', overdue: 'bad', pending: 'warn' };

function statusChip(info) {
  const label = info.status === 'overdue' && info.partial ? 'Недоплата' : info.label;
  return el('span', { class: `ep-chip ep-chip-${STATUS_TONE[info.status]}` }, label);
}

function chip(text, tone) {
  return el('span', { class: `ep-chip ep-chip-${tone}` }, text);
}

function eyebrow(text, tone = '') {
  return el('p', { class: `ep-eyebrow${tone ? ` ep-${tone}` : ''}`, text });
}

function postLabel(post) {
  return `${post.title} · код ${post.code}`;
}

/** Звання з переліку №317 («Солдат/матрос», «Майстер-сержант /майстер-старшина») → id звання. */
function rankFromPost(post) {
  const first = post.rank.split('/')[0].trim().toLowerCase();
  const rank = RANKS.find(entry => entry.title.split(' (')[0].toLowerCase() === first);
  return rank ? rank.id : null;
}

function gradePair(option) {
  return option.conscript !== option.contract ? `${option.contract} / ${option.conscript}` : String(option.contract);
}

function normalize(text) {
  return text.toLowerCase().replace(/[’ʼ`]/g, '\'').replace(/\s+/g, ' ').trim();
}

export function mountEasyPay(container, host) {
  const state = {
    ledger: emptyLedger(),
    handle: null,
    fileName: '',
    dirty: false,
    tab: 'ledger',
    view: 'list',
    itemId: '',
    filter: 'all',
    year: '',
    today: localToday(),
    discardArmed: '',
    deleteArmed: false,
    bannerHidden: false,
    post: null,
    optionIndex: 0,
    revealed: new Set(),
    openSections: new Set(['salary', 'combat', 'zones']),
  };

  // ---------- Каркас ----------
  const root = el('div', { class: 'ep' });
  const title = el('h1', { class: 'ep-title' });
  const actions = el('div', { class: 'ep-actions' });
  const tabs = el('nav', { class: 'ep-tabs', role: 'tablist', 'aria-label': 'Розділи easyPay' });
  const tabButtons = {};
  const panels = {};
  const badge = el('span', { class: 'ep-badge', hidden: true });
  for (const [id, label] of [['ledger', 'Мої виплати'], ['calc', 'Розрахунок'], ['reminders', 'Нагадування'], ['help', 'Довідка']]) {
    const tab = el('button', { type: 'button', role: 'tab', class: 'ep-tab', onclick: () => showTab(id) }, label, id === 'reminders' ? badge : null);
    tabButtons[id] = tab;
    tabs.append(tab);
    panels[id] = el('section', { class: 'ep-panel', role: 'tabpanel', hidden: true });
  }
  const banner = el('div', { class: 'ep-banner', role: 'alert', hidden: true });
  const status = el('p', { class: 'ep-status', role: 'status' });
  const overlay = el('div', { class: 'ep-overlay', hidden: true });
  root.append(
    el('header', { class: 'ep-head' },
      el('div', {}, eyebrow('Особисте · грошове забезпечення'), title),
      actions),
    tabs,
    banner,
    status,
    ...Object.values(panels),
    el('footer', { class: 'ep-foot', text: DISCLAIMER }),
    overlay,
  );
  container.append(root);

  function say(text, error = false) {
    status.textContent = text;
    status.classList.toggle('ep-error', error);
  }

  function setDirty(dirty) {
    state.dirty = dirty;
    host.setDirty(dirty);
    host.setTitle(state.fileName ? state.fileName : (state.ledger.items.length ? 'новий журнал' : ''));
  }

  function changeLedger(ledger, message) {
    state.ledger = ledger;
    setDirty(true);
    render();
    if (message) say(message);
  }

  function showTab(id, view = 'list') {
    if (id !== state.tab || view !== state.view) {
      say('');
      container.scrollTop = 0;
      container.closest('.ws-container')?.scrollTo?.(0, 0);
    }
    state.tab = id;
    if (id === 'ledger') state.view = view;
    state.deleteArmed = false;
    for (const [key, tab] of Object.entries(tabButtons)) {
      tab.setAttribute('aria-selected', String(key === id));
      panels[key].hidden = key !== id;
    }
    render();
  }

  function openItem(id) {
    state.itemId = id;
    showTab('ledger', 'item');
  }

  function render() {
    renderHeader();
    renderBanner();
    if (state.tab === 'ledger') renderLedger();
    if (state.tab === 'calc') renderCalc();
    if (state.tab === 'reminders') renderReminders();
    const overdue = reminders(state.ledger, state.today).filter(item => item.level === 'overdue').length;
    badge.textContent = String(overdue);
    badge.hidden = !overdue;
    tabButtons.reminders.setAttribute('aria-label', overdue ? `Нагадування, прострочено: ${overdue}` : 'Нагадування');
  }

  function fileButtons() {
    return [
      button('Новий журнал', () => guarded(newLedger, 'new'), { iconName: 'plus' }),
      button('Відкрити…', () => guarded(openLedger, 'open'), { iconName: 'folder' }),
      button('Зберегти', () => saveLedger(false), { iconName: 'save', kind: 'strong' }),
      button('Зберегти як…', () => saveLedger(true), { iconName: 'file' }),
    ];
  }

  function renderHeader() {
    let heading = 'Мої виплати';
    let buttons = fileButtons();
    if (state.tab === 'ledger' && !state.ledger.items.length) heading = 'Перший запуск';
    else if (state.tab === 'ledger' && state.view === 'item') heading = 'Деталі виплати';
    else if (state.tab === 'ledger' && state.view === 'year') {
      heading = 'Рік у графіку';
      buttons = [button('До журналу', () => showTab('ledger'), { iconName: 'next' })];
    } else if (state.tab === 'calc') {
      heading = 'Розрахунок за місяць';
      buttons = [button('Новий розрахунок', resetCalc, { iconName: 'plus' })];
    } else if (state.tab === 'reminders') {
      heading = 'Нагадування';
      buttons = [button('До моїх виплат', () => showTab('ledger'), { iconName: 'next' })];
    } else if (state.tab === 'help') {
      heading = 'Довідка';
      buttons = [button('До моїх виплат', () => showTab('ledger'), { iconName: 'next' })];
    }
    title.textContent = heading;
    actions.replaceChildren(...buttons);
  }

  function renderBanner() {
    const summary = ledgerSummary(state.ledger, state.today);
    const show = summary.overdueItems > 0 && !state.bannerHidden && (state.tab === 'ledger' && state.view !== 'year');
    banner.hidden = !show;
    if (!show) return;
    banner.replaceChildren(
      icon('flag'),
      el('strong', { text: `Прострочено виплат: ${summary.overdueItems}, разом ${formatMoney(summary.overdue)}` }),
      el('span', { class: 'ep-dim', text: `Станом на ${dateTitle(state.today)}` }),
      el('span', { class: 'ep-grow' }),
      el('button', { type: 'button', class: 'ep-link ep-bad', onclick: () => showTab('reminders') }, 'Переглянути ↗'),
      el('button', { type: 'button', class: 'ep-link ep-bad', 'aria-label': 'Сховати', onclick: () => { state.bannerHidden = true; renderBanner(); } }, '×'),
    );
  }

  // ---------- Файл журналу ----------
  async function guarded(action, key) {
    if (state.dirty && state.discardArmed !== key) {
      state.discardArmed = key;
      say('Є незбережені зміни. Натисніть ще раз, щоб продовжити без збереження, або спершу збережіть журнал.', true);
      return;
    }
    state.discardArmed = '';
    await action();
  }

  async function newLedger() {
    if (state.handle) await host.closeFile(state.handle).catch(() => {});
    state.ledger = emptyLedger();
    state.handle = null;
    state.fileName = '';
    state.bannerHidden = false;
    setDirty(false);
    showTab('ledger');
    say('Створено новий журнал.');
  }

  async function openLedger() {
    try {
      const opened = await host.openFile({ ...FILE_OPTIONS, title: 'Відкрити журнал easyPay' });
      if (!opened) return;
      const ledger = parseLedger(opened.bytes);
      if (state.handle) await host.closeFile(state.handle).catch(() => {});
      state.ledger = ledger;
      state.handle = opened.handle;
      state.fileName = opened.name;
      state.bannerHidden = false;
      setDirty(false);
      applyProfile(ledger.profile);
      fillMonths(monthInput.value);
      showTab('ledger');
      say(`Відкрито ${opened.name}.`);
    } catch (error) {
      say(error.message || 'Не вдалося відкрити файл.', true);
    }
  }

  async function saveLedger(as = false) {
    try {
      const ledger = { ...state.ledger, savedAt: state.today };
      const bytes = serializeLedger(ledger);
      const saved = !as && state.handle
        ? await host.saveFile({ handle: state.handle, bytes })
        : await host.saveFileAs({ ...FILE_OPTIONS, bytes, title: 'Зберегти журнал easyPay', suggestedName: state.fileName || 'мої-виплати.easypay' });
      if (!saved) return;
      state.ledger = ledger;
      state.handle = saved.handle;
      state.fileName = saved.name;
      setDirty(false);
      say(`Збережено: ${saved.name}.`);
    } catch (error) {
      say(error.message || 'Не вдалося зберегти файл.', true);
    }
  }

  // ---------- Мої виплати ----------
  function card(className, ...children) {
    return el('section', { class: `ep-card ${className}` }, ...children);
  }

  function renderLedger() {
    const panel = panels.ledger;
    if (!state.ledger.items.length) {
      panel.replaceChildren(emptyState());
      return;
    }
    if (state.view === 'item' && state.ledger.items.some(item => item.id === state.itemId)) panel.replaceChildren(itemView());
    else if (state.view === 'year') panel.replaceChildren(yearView());
    else {
      state.view = 'list';
      panel.replaceChildren(listView());
    }
  }

  function tiles() {
    const summary = ledgerSummary(state.ledger, state.today);
    const tile = (label, amount, tone = '') => el('div', { class: `ep-tile${tone ? ` ep-tile-${tone}` : ''}` },
      el('span', { class: 'ep-label', text: label }), el('strong', { text: money(amount) }));
    return el('div', { class: 'ep-tiles' },
      tile('Нараховано', summary.expected),
      tile('Отримано', summary.received),
      tile('Ще мають виплатити', summary.owed),
      tile('З них прострочено', summary.overdue, summary.overdue > 0 ? 'bad' : ''));
  }

  function monthsRange(items) {
    const months = [...new Set(items.map(item => item.month))].sort();
    if (!months.length) return '';
    return months.length === 1 ? monthTitle(months[0]) : `${monthTitle(months[0]).split(' ')[0]} — ${monthTitle(months.at(-1))}`;
  }

  function listView() {
    const items = filterItems(state.ledger.items, state.filter, state.today);
    const segment = el('div', { class: 'ep-segment', role: 'group', 'aria-label': 'Фільтр пунктів' },
      [['all', 'Усі'], ['debts', 'Борги'], ['received', 'Отримані']].map(([id, label]) => el('button', {
        type: 'button', 'aria-pressed': String(state.filter === id), onclick: () => { state.filter = id; renderLedger(); },
      }, label)));
    const count = state.ledger.items.length;
    const head = el('div', { class: 'ep-card-head' },
      el('div', {}, el('h2', { text: 'Пункти нарахувань' }),
        el('p', { class: 'ep-sub', text: `${count} ${plural(count, ['пункт', 'пункти', 'пунктів'])} · ${monthsRange(state.ledger.items)}` })),
      el('div', { class: 'ep-card-tools' },
        button('Рік у графіку', () => showTab('ledger', 'year'), { iconName: 'chart' }),
        button('Інша виплата', openCustomModal, { iconName: 'plus' }),
        segment));
    const rows = [];
    for (const group of groupByMonth(items)) {
      rows.push(el('tr', { class: 'ep-group' },
        el('th', { colspan: '4', scope: 'colgroup', text: capital(monthTitle(group.month)) }),
        el('td', { colspan: '2', class: 'ep-right ep-dim', text: `Термін: ${shortDate(group.due)}` })));
      for (const item of group.items) {
        const info = itemStatus(item, state.today);
        const name = item.kind === 'other' ? item.title : (PAYMENT_KINDS[item.kind]?.title || item.title);
        rows.push(el('tr', { class: `ep-row ep-row-${STATUS_TONE[info.status]}`, tabindex: '0', onclick: () => openItem(item.id),
          onkeydown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openItem(item.id); } } },
        el('td', { class: 'ep-name', text: name }),
        el('td', { class: 'ep-num', text: money(item.expected) }),
        el('td', { class: 'ep-dim', text: shortDate(item.due) }),
        el('td', { class: 'ep-num', text: info.received ? money(info.received) : '—' }),
        el('td', { class: `ep-num${info.status === 'overdue' ? ' ep-bad' : ''}`, text: info.owed ? money(info.owed) : '—' }),
        el('td', { class: 'ep-right' }, statusChip(info))));
      }
    }
    const table = items.length
      ? el('table', { class: 'ep-ledger' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: 'Пункт виплати' }),
          el('th', { scope: 'col', class: 'ep-num', text: 'Очікується' }),
          el('th', { scope: 'col', text: 'Строк' }),
          el('th', { scope: 'col', class: 'ep-num', text: 'Отримано' }),
          el('th', { scope: 'col', class: 'ep-num', text: 'Залишок' }),
          el('th', { scope: 'col', class: 'ep-right', text: 'Статус' }))),
        el('tbody', {}, rows))
      : el('p', { class: 'ep-empty-line', text: state.filter === 'debts' ? 'Боргів немає: усе виплачено.' : 'Повністю отриманих пунктів ще немає.' });
    return el('div', { class: 'ep-stack' }, tiles(), card('ep-items', head, el('div', { class: 'ep-scroll' }, table)));
  }

  function itemView() {
    const item = state.ledger.items.find(entry => entry.id === state.itemId);
    const info = itemStatus(item, state.today);
    const kindTitle = PAYMENT_KINDS[item.kind]?.title || 'Інша виплата';
    const share = item.expected > 0 ? Math.min(100, Math.round(info.received / item.expected * 100)) : 0;
    let dueLine = `Строк виплати — ${shortDate(item.due)}`;
    if (info.status === 'overdue') dueLine += ` · прострочено ${info.overdueDays} ${plural(info.overdueDays, DAYS)}`;
    else if (info.status === 'pending') {
      const left = Math.round((Date.parse(`${item.due}T00:00:00Z`) - Date.parse(`${state.today}T00:00:00Z`)) / 86400000);
      dueLine += left === 0 ? ' · сьогодні' : ` · через ${left} ${plural(left, DAYS)}`;
    }
    const parts = item.lines.length
      ? el('div', { class: 'ep-parts' },
        el('h3', { text: 'Складові нарахування' }),
        item.lines.map(entry => el('div', { class: `ep-part${entry.amount < 0 ? ' ep-minus' : ''}` },
          el('div', {}, el('span', { text: entry.title }), entry.formula ? el('small', { text: entry.formula }) : null),
          el('span', { class: 'ep-num', text: money(entry.amount) }))),
        el('div', { class: 'ep-part ep-part-total' }, el('span', { text: `Разом за ${monthTitle(item.month).split(' ')[0]}` }), el('span', { class: 'ep-num', text: money(item.expected) })))
      : el('p', { class: 'ep-sub ep-parts', text: `Строк: ${item.dueBasis}.` });

    const left = card('ep-detail',
      el('div', { class: 'ep-detail-head' },
        el('div', {}, eyebrow(`${monthTitle(item.month)} · ${kindTitle}`), el('h2', { class: 'ep-h2', text: item.title }), el('p', { class: 'ep-sub', text: dueLine })),
        statusChip(info)),
      el('div', { class: 'ep-figures' },
        el('div', {}, el('span', { class: 'ep-label', text: 'Нараховано' }), bigMoney(item.expected)),
        el('div', {}, el('span', { class: 'ep-label', text: 'Отримано' }), bigMoney(info.received, 'ep-ok')),
        el('div', {}, el('span', { class: 'ep-label', text: 'Залишок' }), bigMoney(info.owed, info.status === 'overdue' ? 'ep-bad' : ''))),
      el('div', { class: 'ep-progress-box' },
        el('div', { class: 'ep-progress-head' }, el('strong', { text: `Сплачено ${share} %` }), el('span', { class: 'ep-dim', text: `Ще належить виплатити ${100 - share} %` })),
        el('div', { class: 'ep-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(share) },
          el('span', { style: `width:${share}%` }))),
      parts);

    const date = el('input', { type: 'date', name: 'paymentDate', value: state.today, required: true });
    const amount = el('input', { type: 'number', name: 'paymentAmount', min: '0', step: '0.01', inputmode: 'decimal', value: info.owed ? String(info.owed) : '', required: true });
    const note = el('input', { type: 'text', name: 'paymentNote', maxlength: '200', placeholder: 'Наприклад, «частково»' });
    const payForm = el('form', { class: 'ep-card ep-pay', onsubmit: event => {
      event.preventDefault();
      try {
        changeLedger(addPayment(state.ledger, item.id, { date: date.value, amount: amount.value, note: note.value }), 'Надходження внесено. Збережіть журнал, щоб не втратити.');
      } catch (error) {
        say(error.message, true);
      }
    } },
    el('h2', { text: 'Внести надходження' }),
    el('p', { class: 'ep-sub', text: 'Збережеться як окремий запис цього пункту.' }),
    el('div', { class: 'ep-grid2' }, field('Дата надходження', date), field('Сума, грн', amount)),
    field('Примітка (необов\'язково)', note),
    el('button', { type: 'submit', class: 'ep-btn ep-btn-gold' }, icon('plus'), 'Додати надходження'),
    el('p', { class: 'ep-hint', text: info.owed ? 'Сума залишку підставлена автоматично. Перед збереженням її можна змінити.' : 'Пункт уже сплачено. Надходження можна внести, якщо прийшла доплата.' }));

    const count = item.payments.length;
    const journal = card('ep-journal',
      el('div', { class: 'ep-card-head' }, el('h2', { text: 'Журнал надходжень' }), el('span', { class: 'ep-sub', text: `${count} ${plural(count, ['запис', 'записи', 'записів'])}` })),
      count ? item.payments.map((payment, index) => el('div', { class: 'ep-payment' },
        el('div', {}, el('strong', { text: shortDate(payment.date) }), payment.note ? el('small', { text: `Примітка: «${payment.note}»` }) : null),
        el('span', { class: 'ep-payment-sum', text: `+${money(payment.amount)}` }),
        el('button', { type: 'button', class: 'ep-icon-btn', 'aria-label': `Видалити надходження ${shortDate(payment.date)}`,
          onclick: () => changeLedger(removePayment(state.ledger, item.id, index), 'Надходження видалено.') }, icon('close'))))
        : el('p', { class: 'ep-sub', text: 'Надходжень ще немає.' }),
      el('p', { class: 'ep-hint', text: 'Кілька надходжень можна додавати до одного пункту.' }));

    const removeButtons = state.deleteArmed
      ? el('div', { class: 'ep-row-buttons' },
        button('Скасувати', () => { state.deleteArmed = false; renderLedger(); }),
        button('Так, видалити', () => {
          state.deleteArmed = false;
          state.view = 'list';
          changeLedger(removeItem(state.ledger, item.id), `Пункт «${item.title}» видалено.`);
        }, { kind: 'danger', iconName: 'trash' }))
      : button('Видалити пункт', () => { state.deleteArmed = true; renderLedger(); }, { kind: 'danger', iconName: 'trash' });
    const manage = card('ep-manage',
      el('div', {}, el('h2', { text: 'Керування пунктом' }),
        el('p', { class: 'ep-sub', text: state.deleteArmed ? 'Видалити пункт разом з усіма надходженнями?' : 'Видалення потребує підтвердження.' })),
      removeButtons);

    return el('div', { class: 'ep-stack' },
      el('div', { class: 'ep-crumbs' },
        el('button', { type: 'button', class: 'ep-link', onclick: () => showTab('ledger') }, icon('back'), 'До всіх виплат'),
        el('span', { class: 'ep-dim', text: '/' }),
        el('span', { text: capital(monthTitle(item.month)) }),
        el('span', { class: 'ep-grow' }),
        el('span', { class: 'ep-label', text: 'Робота з одним пунктом' })),
      el('div', { class: 'ep-two' }, left, el('div', { class: 'ep-stack' }, payForm, journal, manage)));
  }

  function emptyState() {
    return el('div', { class: 'ep-two ep-two-even' },
      card('ep-empty',
        el('div', { class: 'ep-empty-icon' }, icon('file')),
        eyebrow('Перший запуск'),
        el('h2', { class: 'ep-h2', text: 'Журнал порожній' }),
        el('p', { class: 'ep-sub', text: 'Ще немає нарахувань або виплат. Порахуйте місяць або відкрийте вже збережений локальний файл.' }),
        el('div', { class: 'ep-row-buttons' },
          button('Порахувати місяць', () => showTab('calc'), { kind: 'gold', iconName: 'plus' }),
          button('Відкрити файл .easypay', () => guarded(openLedger, 'open'), { iconName: 'folder' })),
        el('p', { class: 'ep-hint', text: 'Журнал зберігається тільки на вашому комп\'ютері.' })),
      card('ep-steps',
        eyebrow('Як це працює'),
        el('h2', { text: 'Три кроки' }),
        el('ol', { class: 'ep-numbered' },
          el('li', {}, el('strong', { text: 'Порахуйте місяць' }), el('span', { text: 'Оберіть посаду з наказу №317, внесіть дні й доби. Підсумок оновлюється одразу.' })),
          el('li', {}, el('strong', { text: 'Запишіть у «Мої виплати»' }), el('span', { text: 'Кожен вид виплати стає пунктом зі строком: грошове забезпечення, винагороди, штурмові.' })),
          el('li', {}, el('strong', { text: 'Вносьте надходження' }), el('span', { text: 'easyPay покаже борги й прострочені строки й нагадає, коли варто звернутися з рапортом.' }))),
        el('p', { class: 'ep-hint', text: 'Збережіть журнал кнопкою «Зберегти»: незбережені зміни позначаються крапкою біля назви файлу.' })));
  }

  // ---------- Рік у графіку ----------
  function yearView() {
    const years = ledgerYears(state.ledger);
    if (!years.includes(state.year)) state.year = years.includes(state.today.slice(0, 4)) ? state.today.slice(0, 4) : years[0];
    const series = yearSeries(state.ledger, state.year);
    const withData = series.filter(entry => entry.hasData);
    const max = Math.max(1, ...series.map(entry => Math.max(entry.expected, entry.received)));
    const step = niceStep(max / 4);
    const top = step * Math.max(1, Math.ceil(max / step));
    const width = 760;
    const height = 380;
    const pad = { left: 56, right: 8, top: 12, bottom: 30 };
    const plotH = height - pad.top - pad.bottom;
    const slot = (width - pad.left - pad.right) / 12;
    const y = value => pad.top + plotH - value / top * plotH;
    const grid = [];
    for (let value = 0; value <= top + 1; value += step) {
      grid.push(svg('line', { class: 'ep-grid-line', x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value) }));
      grid.push(svg('text', { class: 'ep-axis', x: pad.left - 8, y: y(value) + 4, 'text-anchor': 'end' }, value ? `${Math.round(value / 1000)} тис.` : '0'));
    }
    const short = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
    const bars = series.map((entry, index) => {
      const x = pad.left + slot * index + slot / 2;
      const barW = Math.min(16, slot / 4);
      const label = svg('text', { class: 'ep-axis', x, y: height - 8, 'text-anchor': 'middle' }, short[index]);
      if (!entry.hasData) {
        return svg('g', {}, svg('line', { class: 'ep-nodata', x1: x - 6, x2: x + 6, y1: y(0) - 2, y2: y(0) - 2 }),
          svg('title', {}, `${capital(monthTitle(entry.month))}: немає даних`), label);
      }
      const h1 = Math.max(2, plotH * entry.expected / top);
      const h2 = entry.received ? Math.max(2, plotH * entry.received / top) : 0;
      return svg('g', {},
        svg('rect', { class: 'ep-bar-exp', x: x - barW - 2, y: y(0) - h1, width: barW, height: h1, rx: 2 }),
        h2 ? svg('rect', { class: 'ep-bar-rec', x: x + 2, y: y(0) - h2, width: barW, height: h2, rx: 2 }) : null,
        svg('title', {}, `${capital(monthTitle(entry.month))}: нараховано ${formatMoney(entry.expected)}, отримано ${formatMoney(entry.received)}`),
        label);
    });
    const chart = svg('svg', { class: 'ep-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Нараховано та отримано за ${state.year} рік` },
      ...grid, svg('line', { class: 'ep-axis-line', x1: pad.left, x2: pad.left, y1: pad.top, y2: y(0) }), ...bars);

    const dataNote = withData.length === 12
      ? 'Є записи за всі місяці року.'
      : `Є записи лише за ${withData.map(entry => monthTitle(entry.month).split(' ')[0]).join(', ') || '—'}. Інші місяці позначені як «немає даних», а не нульове нарахування.`;
    const yearSelect = years.length > 1
      ? el('select', { class: 'ep-year', 'aria-label': 'Рік', onchange: event => { state.year = event.target.value; renderLedger(); } },
        years.map(year => el('option', { value: year, text: year, selected: year === state.year })))
      : null;
    const table = el('table', { class: 'ep-sr-only' }, el('caption', { text: `Нараховано та отримано за ${state.year} рік` }),
      el('tbody', {}, withData.map(entry => el('tr', {}, el('th', { text: capital(monthTitle(entry.month)) }), el('td', { text: formatMoney(entry.expected) }), el('td', { text: formatMoney(entry.received) })))));

    const yearItems = state.ledger.items.filter(item => item.month.startsWith(`${state.year}-`));
    const summary = ledgerSummary({ items: yearItems }, state.today);
    const row = (label, amount, tone = '') => el('div', { class: 'ep-sum-row' }, el('span', { text: label }), el('strong', { class: tone, text: money(amount) }));
    const notYet = yearItems.filter(item => itemStatus(item, state.today).status === 'pending' && itemStatus(item, state.today).owed > 0);
    const overdueMonths = [...new Set(yearItems.filter(item => itemStatus(item, state.today).status === 'overdue').map(item => item.month))].sort()
      .map(month => monthTitle(month).split(' ')[0]);
    const explain = summary.overdueItems
      ? `Станом на ${shortDate(state.today)} до прострочених віднесено ${summary.overdueItems} ${plural(summary.overdueItems, ['пункт', 'пункти', 'пунктів'])} за ${overdueMonths.join(', ')}.${notYet.length ? ` Ще ${notYet.length} ${plural(notYet.length, ['пункт', 'пункти', 'пунктів'])} мають строк попереду, тому їх не зараховано до прострочених.` : ''}`
      : `Станом на ${shortDate(state.today)} прострочених пунктів немає: несплачені суми ще мають строк попереду.`;
    return el('div', { class: 'ep-two ep-two-wide' },
      card('ep-year-card',
        el('div', { class: 'ep-card-head' },
          el('div', {}, eyebrow(`Графік за ${state.year} рік`), el('h2', { text: 'Нараховано та отримано' })),
          el('div', { class: 'ep-card-tools' }, yearSelect,
            el('span', { class: 'ep-legend' }, el('i', { class: 'ep-sw-exp' }), 'Нараховано'),
            el('span', { class: 'ep-legend' }, el('i', { class: 'ep-sw-rec' }), 'Отримано'))),
        el('p', { class: 'ep-sub', text: dataNote }),
        chart, table),
      el('div', { class: 'ep-stack' },
        card('ep-sum-card',
          eyebrow('Підсумок журналу'),
          el('h2', { text: capital(monthsRange(yearItems)) }),
          row('Нараховано', summary.expected),
          row('Отримано', summary.received),
          row('Ще належить', summary.owed, 'ep-gold'),
          row('З них прострочено', summary.overdue, 'ep-bad')),
        card('ep-sum-card',
          eyebrow('Чим відрізняються суми'),
          el('h2', { text: 'Несплачено ≠ прострочено' }),
          el('p', { class: 'ep-sub', text: explain }),
          summary.overdueItems ? el('div', { class: 'ep-note ep-note-bad' }, icon('warn'),
            `${formatMoney(summary.overdue)} · ${summary.overdueItems} ${plural(summary.overdueItems, ['прострочений пункт', 'прострочені пункти', 'прострочених пунктів'])}`) : null)));
  }

  function niceStep(raw) {
    const power = 10 ** Math.floor(Math.log10(raw));
    for (const factor of [1, 2, 2.5, 3, 5, 6, 10]) if (raw <= factor * power) return factor * power;
    return 10 * power;
  }

  // ---------- Інша виплата (модальне вікно) ----------
  function openCustomModal() {
    const name = el('input', { type: 'text', name: 'customTitle', maxlength: '120', placeholder: 'Наприклад, допомога на оздоровлення', required: true });
    const amount = el('input', { type: 'number', name: 'customAmount', min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Введіть або оберіть суму', required: true });
    const due = el('input', { type: 'date', name: 'customDue', required: true });
    const error = el('p', { class: 'ep-error ep-hint', role: 'alert' });
    const presets = el('div', { class: 'ep-presets', role: 'group', 'aria-label': 'Сума першого контракту' },
      [['soldier', 'Рядовий склад'], ['sergeant', 'Сержантський склад'], ['junior-lieutenant', 'Офіцерський склад']].map(([id, label]) => {
        const payment = firstContractPayment(id);
        return el('button', { type: 'button', onclick: () => {
          name.value = 'Допомога при першому контракті';
          amount.value = String(payment.amount);
          for (const other of presets.children) other.setAttribute('aria-pressed', 'false');
          presets.querySelector(`[data-id="${id}"]`).setAttribute('aria-pressed', 'true');
        }, 'data-id': id, 'aria-pressed': 'false' },
        el('span', { text: label }), el('span', { class: 'ep-dim', text: `${payment.multiplier} ПМ` }), el('strong', { class: 'ep-gold', text: formatMoney(payment.amount) }));
      }));
    const form = el('form', { class: 'ep-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ep-modal-title', onsubmit: event => {
      event.preventDefault();
      try {
        const ledger = addCustomItem(state.ledger, { title: name.value, expected: amount.value, due: due.value });
        closeOverlay();
        changeLedger(ledger, 'Виплату додано.');
      } catch (problem) {
        error.textContent = problem.message;
      }
    } },
    el('div', { class: 'ep-modal-head' },
      el('div', {}, eyebrow('Мої виплати · локальний журнал'), el('h2', { class: 'ep-h2', id: 'ep-modal-title', text: 'Інша виплата' })),
      el('button', { type: 'button', class: 'ep-icon-btn ep-boxed', 'aria-label': 'Закрити', onclick: closeOverlay }, icon('close'))),
    el('p', { class: 'ep-sub', text: 'Додайте власний пункт журналу. Це не створює платіж і не передає дані до інших сервісів.' }),
    field('Назва виплати', name),
    el('div', { class: 'ep-grid2' }, field('Очікувана сума, грн', amount), field('Строк виплати', due)),
    el('div', { class: 'ep-field' }, el('span', { text: 'Підставити суму першого контракту' }), presets),
    el('div', { class: 'ep-note' }, icon('info'), 'Шаблон лише підставляє суму. Право на виплату та чинні ставки необхідно перевіряти окремо.'),
    error,
    el('div', { class: 'ep-row-buttons ep-end' },
      button('Скасувати', closeOverlay),
      el('button', { type: 'submit', class: 'ep-btn ep-btn-gold' }, icon('plus'), 'Додати виплату')));
    showOverlay(form, 'center');
    name.focus();
  }

  let overlayReturn = null;
  function showOverlay(content, place) {
    overlayReturn = document.activeElement;
    overlay.className = `ep-overlay ep-overlay-${place}`;
    overlay.replaceChildren(content);
    overlay.hidden = false;
  }

  function closeOverlay() {
    overlay.hidden = true;
    overlay.replaceChildren();
    if (overlayReturn && overlayReturn.isConnected) overlayReturn.focus();
  }

  overlay.addEventListener('click', event => { if (event.target === overlay) closeOverlay(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) closeOverlay(); });

  // ---------- Розрахунок ----------
  function field(label, control, hint) {
    return el('label', { class: 'ep-field' }, el('span', { text: label }), control, hint ? el('small', { text: hint }) : null);
  }

  function numberInput(name, value = '', attrs = {}) {
    return el('input', { type: 'number', name, min: '0', step: '1', inputmode: 'numeric', value: String(value), ...attrs });
  }

  function withSuffix(input, suffix) {
    const tail = el('span', { class: 'ep-suffix' });
    const update = () => { tail.textContent = typeof suffix === 'function' ? suffix(Number(input.value) || 0) : suffix; };
    input.addEventListener('input', update);
    update();
    return el('span', { class: 'ep-affix' }, input, tail);
  }

  const daysSuffix = value => plural(value, DAYS);
  const nightSuffix = value => plural(value, ['доба', 'доби', 'діб']);

  // Власний список місяців замість <input type="month">: назви завжди українською.
  const monthInput = el('select', { name: 'month', required: true });
  function fillMonths(selected) {
    const months = new Set(state.ledger.items.map(item => item.month));
    for (let month = '2025-01', last = state.today.slice(0, 7); month <= last; month = nextMonth(month)) months.add(month);
    if (selected) months.add(selected);
    monthInput.replaceChildren(...[...months].sort().reverse().map(month => el('option', { value: month, text: capital(monthTitle(month)) })));
    monthInput.value = selected;
  }
  fillMonths(previousMonth(state.today.slice(0, 7)));
  const postButton = el('button', { type: 'button', class: 'ep-input ep-post', onclick: openPostDrawer });
  const optionSelect = el('select', { name: 'postOption' });
  const conscript = el('input', { type: 'checkbox', name: 'conscript' });
  const gradeInput = numberInput('grade', 3, { min: '1', max: '60', required: true });
  const gradeHint = el('small', {});
  const rankSelect = el('select', { name: 'rank' }, RANKS.map(rank => el('option', { value: rank.id, text: rank.title })));
  rankSelect.value = 'soldier';
  const yearsInput = numberInput('years', 1, { max: '60' });
  const specialInput = numberInput('specialPct', 65, { max: '100' });
  const mountain = el('input', { type: 'checkbox', name: 'mountain' });
  const premiumInput = numberInput('premium', '', { step: '0.01', placeholder: 'Не задано' });
  const dayInputs = {
    d100: numberInput('d100', '', { max: '31', placeholder: '0' }),
    d50: numberInput('d50', '', { max: '31', placeholder: '0' }),
    d30: numberInput('d30', '', { max: '31', placeholder: '0' }),
    d10: numberInput('d10', '', { max: '31', placeholder: '0' }),
    z170: numberInput('d170', '', { max: '31', placeholder: '0' }),
    z70: numberInput('d70', '', { max: '31', placeholder: '0' }),
    capture: numberInput('capture', '', { max: '31', placeholder: '0' }),
    restore: numberInput('restore', '', { max: '31', placeholder: '0' }),
  };
  const kills = numberInput('kills', '', { placeholder: '0' });
  const participants = numberInput('participants', '', { placeholder: '0' });
  const prisonerShare = numberInput('prisonerShare', '', { step: '0.01', placeholder: '0' });

  const SHORT = {
    d100: 'Бойові дії · 100 000/міс.',
    d50: 'Пункти управління · 50 000/міс.',
    d30: 'Бойові накази · 30 000/міс.',
    d10: 'Обов\'язки служби · 10 000/міс.',
    z170: 'Зональна · 170 000/міс.',
    z70: 'Зональна · 70 000/міс.',
    capture: 'Штурм із захопленням · 40 000/добу',
    restore: 'Відновлення позицій · 20 000/добу',
  };
  const LINK = {
    d100: 'Бойові дії · 100 000', d50: 'Пункти управління · 50 000', d30: 'Бойові накази · 30 000', d10: 'Обов\'язки служби · 10 000',
    z170: 'Зональна 170 000', z70: 'Зональна 70 000', capture: 'Штурм із захопленням', restore: 'Відновлення позицій',
  };
  const DEFAULT_VISIBLE = new Set(['d100', 'd10', 'z170', 'capture']);

  function selectedOption() {
    return state.post?.options?.length ? state.post.options[state.optionIndex] || state.post.options[0] : null;
  }

  function setPost(post, optionIndex = 0) {
    state.post = post;
    state.optionIndex = optionIndex;
    if (post) {
      const rank = rankFromPost(post);
      if (rank) rankSelect.value = rank;
    }
    applyOption();
  }

  function applyOption() {
    const option = selectedOption();
    optionSelect.replaceChildren(...(state.post?.options || []).map((entry, index) => el('option', { value: String(index), text: entry.condition || 'Усі ВОС' })));
    optionSelect.value = String(state.optionIndex);
    optionSelect.disabled = !state.post || (state.post.options || []).length < 2;
    if (!state.post?.options?.length) optionSelect.append(el('option', { value: '0', text: state.post ? (state.post.lead || 'Розряд у переліку не вказано') : 'Спершу оберіть посаду' }));
    if (option) {
      gradeInput.value = String(conscript.checked ? option.conscript : option.contract);
      gradeHint.textContent = `За №317: ${gradePair(option)} (контракт / строкова)`;
    } else {
      gradeHint.textContent = state.post ? 'Розряд у переліку не вказано — введіть вручну.' : 'Офіцерам — розряд за штатом, вручну.';
    }
  }

  optionSelect.addEventListener('change', () => { state.optionIndex = Number(optionSelect.value) || 0; applyOption(); renderCalc(); });
  conscript.addEventListener('change', () => { applyOption(); renderCalc(); });

  function readInput() {
    const value = key => dayInputs[key].value;
    return {
      month: monthInput.value,
      grade: Number(gradeInput.value),
      rank: rankSelect.value,
      years: Number(yearsInput.value),
      specialPct: specialInput.value === '' ? 65 : Number(specialInput.value),
      mountain: mountain.checked,
      premium: premiumInput.value,
      combatDays: { d100: value('d100'), d50: value('d50'), d30: value('d30'), d10: value('d10') },
      zonalDays: { d170: value('z170'), d70: value('z70') },
      assaultDays: { capture: value('capture'), restore: value('restore') },
      kills: { count: kills.value, participants: participants.value },
      prisonerShare: prisonerShare.value,
      postCode: state.post?.code,
    };
  }

  const profileLine = el('div', { class: 'ep-profile' });
  const sectionsBox = el('div', { class: 'ep-stack ep-sections' });
  const summaryCard = el('aside', { class: 'ep-card ep-live', 'aria-live': 'polite' });
  const recordButton = el('button', { type: 'button', class: 'ep-btn ep-btn-gold ep-wide', onclick: recordCalculation }, icon('plus'), 'Записати в «Мої виплати»');
  const form = el('form', { class: 'ep-calc-form', onsubmit: event => event.preventDefault() }, sectionsBox);
  form.addEventListener('input', () => renderCalc());
  panels.calc.append(profileLine, el('div', { class: 'ep-two' }, form, summaryCard));

  const NIGHTS = new Set(['capture', 'restore']);
  const dayFields = Object.fromEntries(Object.keys(dayInputs).map(key => [key,
    field(SHORT[key], withSuffix(dayInputs[key], NIGHTS.has(key) ? nightSuffix : daysSuffix))]));

  /** Блок днів: усі поля створено один раз, приховані — рядком посилань «… : 0 днів». */
  function daysBlock(keys) {
    const grid = el('div', { class: 'ep-grid2' }, keys.map(key => dayFields[key]));
    const links = el('div', { class: 'ep-more-links' });
    return {
      nodes: [grid, links],
      update(available) {
        const hidden = [];
        for (const key of keys) {
          const show = available(key) && (DEFAULT_VISIBLE.has(key) || Number(dayInputs[key].value) > 0 || state.revealed.has(key));
          dayFields[key].hidden = !show;
          if (!show && available(key)) hidden.push(key);
        }
        links.hidden = !hidden.length;
        links.replaceChildren(...hidden.map(key => el('button', { type: 'button', class: 'ep-link ep-dim', onclick: () => {
          state.revealed.add(key);
          renderCalc();
          dayInputs[key].focus();
        } }, `${LINK[key]}: 0 ${NIGHTS.has(key) ? 'діб' : 'днів'}`)));
      },
    };
  }

  /** Згортуваний блок розрахунку; вузли постійні, щоб введення не губило фокус. */
  function section(id, number, label, bodyNodes) {
    const sum = el('span', { class: 'ep-dim' });
    const chevron = el('span', { class: 'ep-chevron' });
    const head = el('button', { type: 'button', class: 'ep-section-head', onclick: () => {
      if (state.openSections.has(id)) state.openSections.delete(id);
      else state.openSections.add(id);
      renderCalc();
    } },
    el('span', { class: 'ep-section-num', text: number }),
    el('span', { class: 'ep-section-title', text: label }),
    el('span', { class: 'ep-grow' }), sum, chevron);
    const body = el('div', { class: 'ep-section-body' }, bodyNodes);
    const error = el('p', { class: 'ep-field-error', role: 'alert', hidden: true });
    const node = el('section', { class: 'ep-card ep-section' }, head, body, error);
    return {
      node,
      update(amount, errorText = '') {
        const open = state.openSections.has(id) || Boolean(errorText);
        head.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
        sum.textContent = open ? formatMoney(amount, { cents: true }) : `${formatMoney(amount, { cents: true })} · згорнуто`;
        chevron.replaceChildren(icon(open ? 'down' : 'next'));
        node.classList.toggle('ep-section-error', Boolean(errorText));
        error.hidden = !errorText;
        error.replaceChildren(...(errorText ? [icon('warn'), errorText] : []));
      },
    };
  }

  const salaryBody = el('div', { class: 'ep-grid2' },
    field('Місяць', monthInput),
    el('div', { class: 'ep-field' }, el('span', { text: 'Посада за наказом №317' }), postButton),
    field('Умова посади', optionSelect),
    el('label', { class: 'ep-field' }, el('span', { text: 'Тарифний розряд' }), gradeInput, gradeHint),
    field('Звання', rankSelect),
    field('Вислуга, повних років', yearsInput),
    field('Надбавка за особливості служби', withSuffix(specialInput, '%'), 'У ЗСУ — 65 %, стеля — 100 %'),
    field('Премія, грн', premiumInput, 'Базового розміру в документах немає'),
    el('div', { class: 'ep-checks' },
      el('label', { class: 'ep-check' }, conscript, 'Строкова служба'),
      el('label', { class: 'ep-check' }, mountain, 'Гірські райони (+25 % окладу)')));
  const resultBody = el('div', { class: 'ep-grid2' },
    field('Підтверджених знищень групою', kills),
    field('Учасників групи', participants),
    field('Ваша частка за полон, грн', prisonerShare, 'Розподіляє командир'));
  const combatDays = daysBlock(['d100', 'd10', 'd50', 'd30']);
  const zoneDays = daysBlock(['z170', 'capture', 'z70', 'restore']);
  const sections = {
    salary: section('salary', '01', 'Оклади', [salaryBody]),
    combat: section('combat', '02', 'Додаткова винагорода', [el('p', { class: 'ep-sub', text: 'Одна категорія на день · перевага більшої суми' }), ...combatDays.nodes]),
    zones: section('zones', '03', 'Зональна і штурмові', zoneDays.nodes),
    result: section('result', '04', 'За результат', [resultBody]),
  };
  const warningsBox = el('div', { class: 'ep-note ep-note-warn', hidden: true });
  sectionsBox.append(...Object.values(sections).map(entry => entry.node), warningsBox);

  let lastCalc = null;
  function renderCalc() {
    if (state.post) postButton.replaceChildren(el('span', { text: postLabel(state.post) }), icon('search'));
    else postButton.replaceChildren(el('span', { class: 'ep-dim', text: 'Оберіть посаду з довідника' }), icon('search'));
    let calc = null;
    let failure = '';
    try {
      calc = calculateMonth(readInput());
    } catch (error) {
      failure = error.message;
    }
    lastCalc = calc && !calc.errors.length ? calc : null;
    const byKind = calc?.byKind || {};
    const errorFor = fieldId => calc?.errors.filter(error => error.field === fieldId).map(error => error.text).join(' ') || '';
    const month = monthInput.value;
    const available = key => key !== 'd10' || !month || month >= RULES_232_FROM || Number(dayInputs.d10.value) > 0;

    const rank = RANKS.find(entry => entry.id === rankSelect.value);
    const option = selectedOption();
    profileLine.replaceChildren(
      el('span', { text: `Профіль: ${[rank ? rank.title.split(' (')[0].toLowerCase() : '', state.post?.title, option?.condition ? option.condition.replace(/^[а-яґєії]\)\s*/i, '').replace(/[;:.]$/, '') : ''].filter(Boolean).join(' · ')}` }),
      el('span', { text: `Оклади: ${formatMoney(byKind.gz || 0, { cents: true })} щомісяця` }));

    combatDays.update(available);
    zoneDays.update(() => true);
    sections.salary.update(byKind.gz || 0);
    sections.combat.update(byKind.dv || 0, errorFor('combat'));
    sections.zones.update((byKind.zonal || 0) + (byKind.assault || 0), [errorFor('zonal'), errorFor('assault')].filter(Boolean).join(' '));
    sections.result.update(byKind.result || 0);
    warningsBox.hidden = !calc?.warnings.length;
    warningsBox.replaceChildren(...(calc?.warnings.length ? [icon('warn'), el('ul', {}, calc.warnings.map(text => el('li', { text })))] : []));

    if (!calc) {
      summaryCard.replaceChildren(eyebrow('Живий підсумок'), el('p', { class: 'ep-error', text: failure }), recordButton);
      recordButton.disabled = true;
      return;
    }
    const rows = [];
    for (const entry of calc.lines.filter(item => item.kind === 'gz')) rows.push(summaryRow(entry.title, entry.formula, entry.amount));
    for (const kind of ['dv', 'zonal', 'assault', 'result', 'other']) {
      const kindLines = calc.lines.filter(item => item.kind === kind && item.id !== 'cap');
      if (!kindLines.length) continue;
      const amount = kindLines.reduce((total, item) => total + item.amount, 0);
      rows.push(summaryRow(PAYMENT_KINDS[kind].title, kindLines.map(item => item.formula).filter(Boolean).join('; '), amount));
    }
    const cap = calc.lines.find(item => item.id === 'cap');
    if (cap) rows.push(summaryRow(cap.title, `${cap.formula} · ${cap.note}`, cap.amount, 'ep-minus'));
    const hasErrors = calc.errors.length > 0;
    summaryCard.replaceChildren(
      el('div', { class: 'ep-card-head' },
        el('div', {}, eyebrow('Живий підсумок'), el('h2', { class: 'ep-h2', text: capital(monthTitle(calc.month)) })),
        hasErrors ? chip('Є помилки', 'bad') : chip('Розраховано', 'warn')),
      el('div', { class: 'ep-sum-lines' }, rows),
      el('div', { class: 'ep-total' }, el('span', { text: 'Разом до утримань' }), bigMoney(calc.total, 'ep-gold ep-huge')),
      hasErrors
        ? el('div', { class: 'ep-note ep-note-bad' }, icon('warn'), el('span', {}, el('strong', { text: calc.errors.map(error => error.text).join(' ') }), ' Виправте дні, щоб записати розрахунок.'))
        : el('p', { class: 'ep-hint', text: 'Показано суми нарахувань. Фактичні надходження відмічаються в журналі окремо. Пропорційні виплати поділено на календарні дні місяця (припущення).' }),
      recordButton);
    recordButton.disabled = hasErrors;
  }

  function summaryRow(label, formula, amount, className = '') {
    return el('div', { class: `ep-sum-line ${className}` },
      el('div', {}, el('span', { text: label }), formula ? el('small', { text: formula }) : null),
      el('strong', { text: formatMoney(amount, { cents: true }) }));
  }

  function recordCalculation() {
    if (!lastCalc) return;
    const month = lastCalc.month;
    changeLedger(addCalculation(state.ledger, lastCalc, readInput()), `Розрахунок за ${monthTitle(month)} записано. Збережіть журнал, щоб не втратити.`);
    showTab('ledger');
  }

  function resetCalc() {
    fillMonths(previousMonth(state.today.slice(0, 7)));
    for (const input of [...Object.values(dayInputs), kills, participants, prisonerShare, premiumInput]) input.value = '';
    state.revealed.clear();
    state.openSections = new Set(['salary', 'combat', 'zones']);
    renderCalc();
    say('Нові дані розрахунку: профіль окладу збережено, дні обнулено.');
  }

  function applyProfile(profile) {
    if (profile.rank) rankSelect.value = profile.rank;
    if (profile.years !== undefined) yearsInput.value = String(profile.years);
    if (profile.specialPct !== undefined) specialInput.value = String(profile.specialPct);
    mountain.checked = Boolean(profile.mountain);
    const post = profile.postCode ? POSTS_317.find(entry => entry.code === profile.postCode) : null;
    state.post = post || null;
    const index = post ? post.options.findIndex(option => option.contract === profile.grade || option.conscript === profile.grade) : -1;
    state.optionIndex = Math.max(0, index);
    applyOption();
    if (profile.grade) gradeInput.value = String(profile.grade);
    if (profile.rank) rankSelect.value = profile.rank;
  }

  // ---------- Довідник посад (бічна панель) ----------
  function openPostDrawer() {
    let current = state.post;
    let choice = state.post ? state.optionIndex : 0;
    const search = el('input', { type: 'search', class: 'ep-search-input', placeholder: 'Почніть вводити назву посади', autocomplete: 'off', 'aria-label': 'Пошук за назвою посади', value: state.post ? state.post.title : '' });
    const results = el('div', { class: 'ep-results', role: 'listbox', 'aria-label': 'Знайдені посади' });
    const details = el('div', { class: 'ep-stack' });
    const confirm = el('button', { type: 'button', class: 'ep-btn ep-btn-gold', onclick: () => {
      if (!current) return;
      setPost(current, choice);
      closeOverlay();
      renderCalc();
      say(`Посада: ${current.title}.`);
    } });

    function drawResults() {
      const query = normalize(search.value);
      const found = query.length < 2 ? [] : POSTS_317.filter(post => normalize(post.title).includes(query) || post.code === query).slice(0, 30);
      results.replaceChildren(...(found.length ? found.map(post => el('button', {
        type: 'button', role: 'option', class: 'ep-result', 'aria-selected': String(post === current), onclick: () => { current = post; choice = 0; drawResults(); drawDetails(); },
      },
      el('div', {}, el('strong', { text: post.title }), el('small', { text: `Код ${post.code} · військове звання: ${post.rank.toLowerCase()}` })),
      post.options.length > 1 ? chip(`${post.options.length} ${plural(post.options.length, ['умова', 'умови', 'умов'])}`, 'warn') : null))
        : [el('p', { class: 'ep-sub', text: query.length < 2 ? 'Введіть щонайменше дві літери назви посади або код.' : 'Нічого не знайдено. Офіцерам і посадам поза переліком розряд вводять вручну.' })]));
    }

    function drawDetails() {
      if (!current) {
        details.replaceChildren();
        confirm.replaceChildren(icon('check'), 'Обрати посаду');
        confirm.disabled = true;
        return;
      }
      confirm.disabled = false;
      const letter = current.options[choice]?.condition?.match(/^([а-яґєії])\)/i)?.[1];
      confirm.replaceChildren(icon('check'), current.options.length > 1 && letter ? `Обрати умову ${letter})` : 'Обрати посаду');
      details.replaceChildren(
        el('p', { class: 'ep-label', text: 'Умови посади' }),
        current.lead && current.options.length ? el('p', { class: 'ep-sub', text: `У переліку: ${current.lead.replace(/:$/, '')}` }) : null,
        current.options.length
          ? el('div', { class: 'ep-options', role: 'radiogroup', 'aria-label': 'Умови посади' }, current.options.map((option, index) => el('label', { class: 'ep-option' },
            el('input', { type: 'radio', name: 'ep-option', value: String(index), checked: index === choice, onchange: () => { choice = index; drawDetails(); } }),
            el('div', {}, el('strong', { text: option.condition || 'Усі ВОС' }),
              el('small', { text: index === choice ? `Застосується розряд ${option.contract} для контрактної служби${option.conscript !== option.contract ? `, ${option.conscript} — для строкової` : ''}.` : 'Оберіть, якщо умова стосується вашої частини.' })),
            el('span', { class: 'ep-gold ep-pair', text: gradePair(option) }))))
          : el('p', { class: 'ep-sub', text: `Розряд для цієї посади в переліку не вказано (${current.lead || 'окремий перелік'}). Після вибору введіть його вручну.` }),
        el('div', { class: 'ep-note' }, icon('info'), 'Перший розряд у записі «5 / 3» — контракт, другий — строкова служба. Офіцерам — розряд за штатом, вручну.'));
    }

    search.addEventListener('input', drawResults);
    const drawer = el('div', { class: 'ep-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ep-drawer-title' },
      el('div', { class: 'ep-modal-head' },
        el('div', {}, eyebrow('Довідник посад · наказ №317'), el('h2', { class: 'ep-h2', id: 'ep-drawer-title', text: 'Вибір посади' })),
        button('Закрити', closeOverlay, { iconName: 'close' })),
      el('label', { class: 'ep-field' }, el('span', { text: 'Пошук за назвою посади' }),
        el('span', { class: 'ep-search' }, icon('search'), search,
          el('button', { type: 'button', class: 'ep-link ep-dim', onclick: () => { search.value = ''; drawResults(); search.focus(); } }, 'Очистити ×'))),
      results,
      details,
      el('div', { class: 'ep-row-buttons ep-end' },
        button('Скасувати', closeOverlay),
        confirm,
        state.post ? button('Без посади', () => { setPost(null); closeOverlay(); renderCalc(); }) : null));
    showOverlay(drawer, 'right');
    drawResults();
    drawDetails();
    search.focus();
  }

  // ---------- Нагадування ----------
  function renderReminders() {
    const list = reminders(state.ledger, state.today);
    const cards = list.map(item => {
      let label = 'Немає розрахунку';
      let tone = 'muted';
      let badgeText = 'Немає розрахунку';
      if (item.level === 'overdue') {
        label = `Прострочено · ${item.days} ${plural(item.days, DAYS)}`;
        tone = 'bad';
        badgeText = 'Прострочено';
      } else if (item.level === 'soon') {
        label = `Очікується · ${item.days === 0 ? 'сьогодні' : `через ${item.days} ${plural(item.days, DAYS)}`}`;
        tone = 'warn';
        badgeText = 'Строк скоро';
      }
      const content = [
        el('div', { class: 'ep-card-head' }, eyebrow(label, tone), chip(badgeText, tone)),
        el('p', { class: 'ep-reminder-text', text: item.text }),
      ];
      return item.id
        ? el('button', { type: 'button', class: `ep-card ep-reminder ep-reminder-${tone}`, onclick: () => openItem(item.id) }, ...content)
        : el('div', { class: `ep-card ep-reminder ep-reminder-${tone}` }, ...content,
          el('div', {}, button('Порахувати місяць', () => showTab('calc'), { iconName: 'plus' })));
    });
    const kindRow = (name, heading, text) => el('div', { class: 'ep-kind' }, el('span', { class: 'ep-kind-icon' }, icon(name)),
      el('div', {}, el('strong', { text: heading }), el('small', { text })));
    panels.reminders.replaceChildren(
      el('div', { class: 'ep-crumbs' },
        el('span', { class: 'ep-dim', text: `Станом на ${dateTitle(state.today)} · Пункти журналу` }),
        el('span', { class: 'ep-grow' }),
        el('span', { class: 'ep-label', text: 'Нагадування про виплати' })),
      el('div', { class: 'ep-two' },
        el('div', { class: 'ep-stack' }, cards.length ? cards : [card('ep-empty-line', el('p', { class: 'ep-sub', text: state.ledger.items.length ? 'Усе виплачено або строки ще не настали.' : 'Нагадувань немає: журнал порожній.' }))]),
        el('div', { class: 'ep-stack' },
          card('ep-kinds',
            eyebrow('Стани нагадувань'),
            el('h2', { text: 'Три типи повідомлень' }),
            kindRow('alert', 'Прострочено', 'Строк уже минув. Понад 30 днів — додається порада звернутися до фінансової служби з рапортом.'),
            kindRow('clock', 'Строк скоро', 'Показується за 5 днів до строку, включно з днем виплати.'),
            kindRow('calendar', 'Немає розрахунку', 'Якщо за попередній місяць ще не створено розрахунок.')),
          card('ep-local',
            el('div', { class: 'ep-card-head' }, eyebrow('Локальний режим'), icon('bell')),
            el('h2', { text: 'Без системних сповіщень' }),
            el('p', { class: 'ep-sub', text: 'Системні сповіщення поки не вмикаються: для них потрібен окремий дозвіл застосунку. Нагадування видно лише всередині easyPay, коли відкрито журнал.' })))));
  }

  // ---------- Довідка ----------
  function helpCard(number, label, heading, paragraphs, rows = [], extra = null) {
    return card('ep-help-card',
      eyebrow(`${number} · ${label}`),
      el('h2', { text: heading }),
      paragraphs.map(text => el('p', { class: 'ep-sub', text })),
      rows.length ? el('div', { class: 'ep-help-rows' }, rows.map(([name, value]) => el('div', { class: 'ep-sum-row' }, el('strong', { text: name }), el('span', { class: 'ep-dim', text: value })))) : null,
      extra);
  }
  const assumption = (number, heading, text) => el('div', { class: 'ep-assume' }, el('span', { class: 'ep-assume-num', text: number }),
    el('div', {}, el('strong', { text: heading }), el('small', { text })));
  panels.help.append(el('div', { class: 'ep-help' },
    el('div', { class: 'ep-stack' },
      helpCard('01', 'Основи розрахунку', 'Оклади й вислуга', [
        'Оклади: 1 762 грн × коефіцієнт тарифного розряду (додаток 1 постанови №704) і × коефіцієнт звання (додаток 14), з округленням до 10 грн: до 4,99 відкидається, від 5 — угору.',
        'Посада обирається з довідника за наказом МОУ №317. Якщо для посади є кілька умов, оберіть відповідну: у бойових частинах розряд часто вищий. Розряд офіцерів вводиться вручну.',
      ], [
        ['Вислуга', '25 / 30 / 35 / 40 / 45 / 50 % від окладів'],
        ['Особливості служби', 'від окладів і вислуги, у ЗСУ 65 %, стеля 100 %'],
        ['Гірська надбавка', '+25 % посадового окладу'],
      ]),
      helpCard('02', 'Категорії винагород', 'Додаткова, зональна та штурмові', [
        'Наказ №232 діє з 1 червня 2026 року. За один день — лише одна категорія додаткової винагороди, більша. Місячна ставка ділиться пропорційно дням місяця.',
      ], [
        ['Додаткова', '100 000 / 50 000 / 30 000 / 10 000 грн на місяць'],
        ['Зональна', '170 000 або 70 000 грн на місяць; до червня — 70 000 за 30 днів'],
        ['Штурмові', '40 000 або 20 000 грн за добу'],
        ['Ліміт', '460 000 грн: 100 000 + зональні + штурмові'],
        ['За результат', '15 000 за знищення порівну між учасниками; полон — частка від командира'],
      ])),
    el('div', { class: 'ep-stack' },
      card('ep-help-card',
        eyebrow('03 · Важливі застереження'),
        el('h2', { text: 'Що прийнято як припущення' }),
        assumption('01', 'Дільник', 'Пропорційні виплати діляться на календарні дні місяця: документи не кажуть, на що саме ділити.'),
        assumption('02', 'Типовий строк', 'Грошове забезпечення — до 20 числа наступного місяця (роз\'яснення Міноборони). Для винагород документи називають лише строк наказу, тож теж узято 20 число.'),
        assumption('03', 'Особливості служби', '65 % — початкове значення поля, а не універсальна ставка.'),
        assumption('04', 'Премія та інше', 'Премія, частка за полон та інші виплати, яких документи не визначають, вносяться вручну.')),
      helpCard('04', 'Файли та конфіденційність', 'Де зберігаються дані', [
        'Журнал — лише у файлі .easypay на вашому комп\'ютері. Збереження — через «Зберегти» та «Зберегти як…», відкриття — через «Відкрити…».',
        'easyPay нічого не надсилає в мережу: без входу, синхронізації, банків чи відправлення рапортів. У файлі — тільки параметри окладу й суми, без імені та номерів документів.',
      ], [], el('div', { class: 'ep-note' }, icon('info'), 'Розрахунок допоміжний. Перед зверненням до фінансової служби звірте цифри з чинними текстами постанови №704 і Порядку №260 на zakon.rada.gov.ua.'))),
  ));

  applyOption();
  showTab('ledger');
  host.setTitle('');

  return {
    unmount() {
      if (state.handle) host.closeFile(state.handle).catch(() => {});
      root.remove();
    },
    isDirty: () => state.dirty,
  };
}
