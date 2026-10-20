// easyPay: інтерфейс особистого калькулятора й журналу виплат (вкладки «Розрахунок»,
// «Мої виплати», «Нагадування», «Довідка»). Логіка — easypay-core.js; журнал зберігається лише
// у файлі .easypay, який користувач відкриває й зберігає через host оболонки.
import {
  COMBAT_CATEGORIES,
  LEDGER_EXTENSION,
  RANKS,
  addCalculation,
  addCustomItem,
  addPayment,
  calculateMonth,
  dateTitle,
  emptyLedger,
  firstContractPayment,
  formatMoney,
  itemStatus,
  ledgerSummary,
  monthTitle,
  parseLedger,
  previousMonth,
  reminders,
  removeItem,
  removePayment,
  serializeLedger,
} from './easypay-core.js';
import { POSTS_317 } from './posady-317.js';

const FILE_OPTIONS = { extensions: [LEDGER_EXTENSION], filterName: 'Журнал easyPay' };

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

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function field(label, control, hint) {
  return el('label', { class: 'ep-field' }, el('span', { text: label }), control, hint ? el('small', { text: hint }) : null);
}

function numberInput(name, value = '', attrs = {}) {
  return el('input', { type: 'number', name, min: '0', step: '1', inputmode: 'numeric', value: String(value), ...attrs });
}

function postLabel(post) {
  return `${post.title} — код ${post.code}`;
}

/** Звання з переліку №317 («Солдат/матрос», «Майстер-сержант /майстер-старшина») → id звання. */
function rankFromPost(post) {
  const first = post.rank.split('/')[0].trim().toLowerCase();
  const rank = RANKS.find(entry => entry.title.split(' (')[0].toLowerCase() === first);
  return rank ? rank.id : null;
}

export function mountEasyPay(container, host) {
  const state = {
    ledger: emptyLedger(),
    handle: null,
    fileName: '',
    dirty: false,
    tab: 'calc',
    today: localToday(),
    discardArmed: '',
  };
  const postByLabel = new Map(POSTS_317.map(post => [postLabel(post), post]));

  const root = el('div', { class: 'ep' });
  const status = el('p', { class: 'ep-status', role: 'status' });
  const tabs = el('nav', { class: 'ep-tabs', role: 'tablist', 'aria-label': 'Розділи easyPay' });
  const panels = {};
  const tabButtons = {};
  for (const [id, title] of [['calc', 'Розрахунок'], ['ledger', 'Мої виплати'], ['reminders', 'Нагадування'], ['help', 'Довідка']]) {
    const button = el('button', { type: 'button', role: 'tab', class: 'ep-tab', 'data-tab': id, onclick: () => showTab(id) }, title);
    tabButtons[id] = button;
    tabs.append(button);
    panels[id] = el('section', { class: 'ep-panel', role: 'tabpanel', hidden: true });
  }
  const banner = el('div', { class: 'ep-banner', hidden: true });
  root.append(
    el('header', { class: 'ep-head' },
      el('div', {}, el('h1', { text: 'easyPay' }), el('p', { text: 'Особистий розрахунок грошового забезпечення й облік виплат, які вам мають виплатити' })),
      tabs),
    banner,
    status,
    ...Object.values(panels),
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
    renderLedger();
    renderReminders();
    if (message) say(message);
  }

  function showTab(id) {
    state.tab = id;
    for (const [key, button] of Object.entries(tabButtons)) {
      button.setAttribute('aria-selected', String(key === id));
      panels[key].hidden = key !== id;
    }
    if (id === 'ledger') renderLedger();
    if (id === 'reminders') renderReminders();
  }

  // ---------- Розрахунок ----------
  const form = el('form', { class: 'ep-form', onsubmit: event => event.preventDefault() });
  const monthInput = el('input', { type: 'month', name: 'month', value: previousMonth(state.today.slice(0, 7)), required: true });
  const postList = el('datalist', { id: 'ep-posts' }, POSTS_317.map(post => el('option', { value: postLabel(post) })));
  const postInput = el('input', { type: 'search', name: 'post', list: 'ep-posts', placeholder: 'Почніть вводити назву посади', autocomplete: 'off' });
  const optionSelect = el('select', { name: 'postOption', hidden: true });
  const postNote = el('small', { class: 'ep-post-note' });
  const conscript = el('input', { type: 'checkbox', name: 'conscript' });
  const gradeInput = numberInput('grade', 3, { min: '1', max: '60', required: true });
  const rankSelect = el('select', { name: 'rank' }, RANKS.map(rank => el('option', { value: rank.id, text: rank.title })));
  rankSelect.value = 'soldier';
  const yearsInput = numberInput('years', 1, { max: '60' });
  const specialInput = numberInput('specialPct', 65, { max: '100' });
  const mountain = el('input', { type: 'checkbox', name: 'mountain' });
  const premiumInput = numberInput('premium', '', { step: '0.01', placeholder: '0' });
  const combatInputs = Object.fromEntries(COMBAT_CATEGORIES.map(category => [category.id, numberInput(category.id, '', { max: '31', placeholder: '0' })]));
  const zonal170 = numberInput('d170', '', { max: '31', placeholder: '0' });
  const zonal70 = numberInput('d70', '', { max: '31', placeholder: '0' });
  const capture = numberInput('capture', '', { max: '31', placeholder: '0' });
  const restore = numberInput('restore', '', { max: '31', placeholder: '0' });
  const kills = numberInput('kills', '', { placeholder: '0' });
  const participants = numberInput('participants', '', { placeholder: '0' });
  const prisonerShare = numberInput('prisonerShare', '', { step: '0.01', placeholder: '0' });

  function selectedPost() {
    return postByLabel.get(postInput.value) || null;
  }

  let appliedPost = null;
  function applyPost() {
    const post = selectedPost();
    if (post === appliedPost) return; // change приходить ще й при втраті фокуса
    appliedPost = post;
    optionSelect.replaceChildren();
    optionSelect.hidden = true;
    postNote.textContent = '';
    if (!post) return;
    const rank = rankFromPost(post);
    if (rank) rankSelect.value = rank;
    if (!post.options.length) {
      postNote.textContent = `Звання за штатом: ${post.rank}. Розряд у переліку не вказано (${post.lead || 'окремий перелік'}) — введіть його вручну.`;
      return;
    }
    post.options.forEach((option, index) => optionSelect.append(el('option', { value: String(index), text: `${option.condition || 'усі ВОС'} — розряд ${option.contract}${option.conscript !== option.contract ? ` (строкова ${option.conscript})` : ''}` })));
    optionSelect.hidden = post.options.length < 2;
    applyOption();
  }

  function applyOption() {
    const post = selectedPost();
    if (!post || !post.options.length) return;
    const option = post.options[Number(optionSelect.value) || 0];
    gradeInput.value = String(conscript.checked ? option.conscript : option.contract);
    postNote.textContent = `Звання за штатом: ${post.rank}.${post.lead ? ` ${post.lead}` : ''} Оберіть умову, яка стосується вашої частини (бойова чи ні, ВОС).`;
  }

  postInput.addEventListener('change', () => { applyPost(); renderCalc(); });
  optionSelect.addEventListener('change', () => { applyOption(); renderCalc(); });
  conscript.addEventListener('change', () => { applyOption(); renderCalc(); });

  function readInput() {
    const value = input => input.value;
    return {
      month: monthInput.value,
      grade: Number(gradeInput.value),
      rank: rankSelect.value,
      years: Number(yearsInput.value),
      specialPct: specialInput.value === '' ? 65 : Number(specialInput.value),
      mountain: mountain.checked,
      premium: value(premiumInput),
      combatDays: Object.fromEntries(Object.entries(combatInputs).map(([id, input]) => [id, value(input)])),
      zonalDays: { d170: value(zonal170), d70: value(zonal70) },
      assaultDays: { capture: value(capture), restore: value(restore) },
      kills: { count: value(kills), participants: value(participants) },
      prisonerShare: value(prisonerShare),
      postCode: selectedPost()?.code,
    };
  }

  const result = el('div', { class: 'ep-result', 'aria-live': 'polite' });
  const saveCalc = el('button', { type: 'button', class: 'ws-btn ep-primary', onclick: recordCalculation }, 'Записати в «Мої виплати»');

  form.append(
    el('fieldset', {}, el('legend', { text: 'Оклади' }),
      field('Місяць', monthInput),
      field('Посада за наказом №317 (рядовий, сержантський склад)', el('div', { class: 'ep-stack' }, postInput, postList, optionSelect, postNote), 'Офіцерам — розряд за штатом, вручну'),
      el('label', { class: 'ep-check' }, conscript, ' Строкова служба (розряд після «/»)'),
      field('Тарифний розряд', gradeInput),
      field('Військове звання', rankSelect),
      field('Вислуга, повних років', yearsInput),
      field('Надбавка за особливості служби, %', specialInput, 'У ЗСУ — 65%, стеля — 100%'),
      el('label', { class: 'ep-check' }, mountain, ' Служба в гірських районах (+25% окладу)'),
      field('Премія за місяць, грн', premiumInput, 'Базового розміру в документах немає'),
    ),
    el('fieldset', {}, el('legend', { text: 'Додаткова винагорода, дні' }),
      COMBAT_CATEGORIES.map(category => field(`${formatMoney(category.amount)} — ${category.title}`, combatInputs[category.id])),
      el('small', { class: 'ep-hint', text: 'За один день — лише одна, більша категорія. Доба 00–24 — один день; завдання через північ — два дні.' }),
    ),
    el('fieldset', {}, el('legend', { text: 'Зональна і штурмові' }),
      field('Дні до взводного опорного пункту, ТОТ, сіра зона (170 000)', zonal170),
      field('Дні до ротного опорного пункту (70 000)', zonal70),
      field('Доби штурму із захопленням позицій (40 000)', capture),
      field('Доби відновлення позицій (20 000)', restore),
    ),
    el('fieldset', {}, el('legend', { text: 'За результат' }),
      field('Підтверджених знищень групою', kills),
      field('Учасників групи', participants),
      field('Ваша частка за полон, грн', prisonerShare, 'Розподіляє командир'),
    ),
  );
  form.addEventListener('input', renderCalc);
  panels.calc.append(el('div', { class: 'ep-calc' }, form, el('aside', { class: 'ep-side' }, result, saveCalc)));

  let lastCalc = null;
  function renderCalc() {
    try {
      lastCalc = calculateMonth(readInput());
    } catch (error) {
      lastCalc = null;
      result.replaceChildren(el('p', { class: 'ep-error', text: error.message }));
      saveCalc.disabled = true;
      return;
    }
    saveCalc.disabled = false;
    const rows = lastCalc.lines.map(entry => el('tr', { class: entry.amount < 0 ? 'ep-minus' : '' },
      el('td', {}, el('span', { text: entry.title }), el('small', { text: [entry.basis, entry.note].filter(Boolean).join(' · ') })),
      el('td', { class: 'ep-num', text: formatMoney(entry.amount) })));
    result.replaceChildren(...[
      el('h2', { text: `Розрахунок за ${monthTitle(lastCalc.month)}` }),
      el('table', { class: 'ep-table' }, el('tbody', {}, rows),
        el('tfoot', {}, el('tr', {}, el('th', { text: 'Разом до утримань' }), el('th', { class: 'ep-num', text: formatMoney(lastCalc.total) })))),
      lastCalc.warnings.length ? el('ul', { class: 'ep-warnings' }, lastCalc.warnings.map(text => el('li', { text }))) : null,
      el('p', { class: 'ep-hint', text: 'Суми до утримання податків і зборів. Пропорційні виплати поділено на календарні дні місяця: дільника документи не визначають. Це не юридична консультація — звіряйте з чинними текстами на zakon.rada.gov.ua.' }),
    ].filter(Boolean));
  }

  function recordCalculation() {
    if (!lastCalc) return;
    changeLedger(addCalculation(state.ledger, lastCalc, readInput()), `Розрахунок за ${monthTitle(lastCalc.month)} записано. Збережіть журнал, щоб не втратити.`);
    showTab('ledger');
  }

  function applyProfile(profile) {
    if (profile.rank) rankSelect.value = profile.rank;
    if (profile.grade) gradeInput.value = String(profile.grade);
    if (profile.years !== undefined) yearsInput.value = String(profile.years);
    if (profile.specialPct !== undefined) specialInput.value = String(profile.specialPct);
    mountain.checked = Boolean(profile.mountain);
    const post = profile.postCode ? POSTS_317.find(entry => entry.code === profile.postCode) : null;
    postInput.value = post ? postLabel(post) : '';
    renderCalc();
  }

  // ---------- Мої виплати ----------
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
    setDirty(false);
    renderLedger();
    renderReminders();
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
      setDirty(false);
      applyProfile(ledger.profile);
      renderLedger();
      renderReminders();
      say(`Відкрито ${opened.name}.`);
      updateBanner(true);
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

  const summaryBox = el('div', { class: 'ep-summary' });
  const ledgerBody = el('div', { class: 'ep-items' });
  const customTitle = el('input', { type: 'text', name: 'customTitle', maxlength: '120', placeholder: 'Напр., допомога на оздоровлення' });
  const customAmount = numberInput('customAmount', '', { step: '0.01' });
  const customDue = el('input', { type: 'date', name: 'customDue' });
  const firstContract = el('select', { name: 'firstContract' }, el('option', { value: '', text: 'Підставити суму першого контракту…' }),
    ['soldier', 'sergeant', 'junior-lieutenant'].map(id => {
      const payment = firstContractPayment(id);
      const label = { soldier: 'рядовий склад', sergeant: 'сержантський склад', 'junior-lieutenant': 'офіцерський склад' }[id];
      return el('option', { value: String(payment.amount), text: `${label}: ${payment.multiplier} ПМ = ${formatMoney(payment.amount)}` });
    }));
  firstContract.addEventListener('change', () => {
    if (!firstContract.value) return;
    customTitle.value = 'Одноразова допомога при першому контракті';
    customAmount.value = firstContract.value;
    firstContract.value = '';
  });
  const customForm = el('form', { class: 'ep-custom', onsubmit: event => {
    event.preventDefault();
    try {
      changeLedger(addCustomItem(state.ledger, { title: customTitle.value, expected: customAmount.value, due: customDue.value }), 'Виплату додано.');
      customTitle.value = '';
      customAmount.value = '';
      customDue.value = '';
    } catch (error) {
      say(error.message, true);
    }
  } },
  el('h3', { text: 'Інша виплата з власним строком' }),
  field('Назва', customTitle), field('Сума, грн', customAmount), field('Строк', customDue), firstContract,
  el('button', { type: 'submit', class: 'ws-btn' }, 'Додати'));

  panels.ledger.append(
    el('div', { class: 'ep-toolbar' },
      el('button', { type: 'button', class: 'ws-btn', onclick: () => guarded(newLedger, 'new') }, 'Новий журнал'),
      el('button', { type: 'button', class: 'ws-btn', onclick: () => guarded(openLedger, 'open') }, 'Відкрити…'),
      el('button', { type: 'button', class: 'ws-btn ep-primary', onclick: () => saveLedger(false) }, 'Зберегти'),
      el('button', { type: 'button', class: 'ws-btn', onclick: () => saveLedger(true) }, 'Зберегти як…')),
    summaryBox,
    ledgerBody,
    el('details', { class: 'ep-more' }, el('summary', { text: 'Додати іншу виплату' }), customForm),
  );

  function tile(label, amount, tone = '') {
    return el('div', { class: `ep-tile ${tone}` }, el('span', { text: label }), el('strong', { text: formatMoney(amount) }));
  }

  function paymentForm(item, owed) {
    const date = el('input', { type: 'date', name: 'paymentDate', value: state.today, required: true });
    const amount = numberInput('paymentAmount', owed || '', { step: '0.01', required: true });
    const note = el('input', { type: 'text', name: 'paymentNote', maxlength: '200', placeholder: 'Примітка (необов\'язково)' });
    return el('form', { class: 'ep-pay', onsubmit: event => {
      event.preventDefault();
      try {
        changeLedger(addPayment(state.ledger, item.id, { date: date.value, amount: amount.value, note: note.value }), 'Надходження внесено.');
      } catch (error) {
        say(error.message, true);
      }
    } }, field('Дата', date), field('Сума, грн', amount), field('Примітка', note), el('button', { type: 'submit', class: 'ws-btn' }, 'Внести надходження'));
  }

  function renderLedger() {
    const summary = ledgerSummary(state.ledger, state.today);
    summaryBox.replaceChildren(
      tile('Нараховано', summary.expected),
      tile('Отримано', summary.received),
      tile('Ще мають виплатити', summary.owed, summary.owed > 0 ? 'ep-warn' : ''),
      tile('З них прострочено', summary.overdue, summary.overdue > 0 ? 'ep-bad' : ''),
    );
    if (!state.ledger.items.length) {
      ledgerBody.replaceChildren(el('p', { class: 'ep-empty', text: 'Журнал порожній. Порахуйте місяць на вкладці «Розрахунок» і натисніть «Записати в „Мої виплати“», або відкрийте збережений файл .easypay.' }));
      return;
    }
    ledgerBody.replaceChildren(...state.ledger.items.map(item => {
      const info = itemStatus(item, state.today);
      return el('details', { class: `ep-item ep-${info.status}` },
        el('summary', {},
          el('span', { class: 'ep-item-title', text: item.title }),
          el('span', { class: 'ep-num', text: formatMoney(item.expected) }),
          el('span', { class: 'ep-num', text: info.owed > 0 ? `залишок ${formatMoney(info.owed)}` : '' }),
          el('span', { class: 'ep-due', text: `до ${dateTitle(item.due)}` }),
          el('span', { class: 'ep-badge', text: info.label })),
        el('div', { class: 'ep-item-body' },
          el('p', { class: 'ep-hint', text: `Строк: ${item.dueBasis}.` }),
          item.lines.length ? el('ul', { class: 'ep-lines' }, item.lines.map(entry => el('li', {}, el('span', { text: entry.title }), el('span', { class: 'ep-num', text: formatMoney(entry.amount) })))) : null,
          item.payments.length ? el('ul', { class: 'ep-payments' }, item.payments.map((payment, index) => el('li', {},
            el('span', { text: `${dateTitle(payment.date)}${payment.note ? ` · ${payment.note}` : ''}` }),
            el('span', { class: 'ep-num', text: formatMoney(payment.amount) }),
            el('button', { type: 'button', class: 'ws-btn ws-danger ep-small', 'aria-label': 'Видалити надходження', onclick: () => changeLedger(removePayment(state.ledger, item.id, index), 'Надходження видалено.') }, '×')))) : null,
          info.owed > 0 ? paymentForm(item, info.owed) : null,
          el('button', { type: 'button', class: 'ws-btn ws-danger ep-small', onclick: () => {
            if (state.discardArmed !== `del:${item.id}`) {
              state.discardArmed = `del:${item.id}`;
              say(`Натисніть «Видалити пункт» ще раз, щоб прибрати «${item.title}».`, true);
              return;
            }
            state.discardArmed = '';
            changeLedger(removeItem(state.ledger, item.id), 'Пункт видалено.');
          } }, 'Видалити пункт')));
    }));
  }

  // ---------- Нагадування ----------
  const reminderList = el('ul', { class: 'ep-reminders' });
  panels.reminders.append(
    el('p', { class: 'ep-hint', text: 'Нагадування показуються тут і вгорі вікна щоразу, коли ви відкриваєте журнал. Системні сповіщення поки не вмикаються: для них потрібен окремий дозвіл застосунку.' }),
    reminderList,
  );

  function renderReminders() {
    const list = reminders(state.ledger, state.today);
    const urgent = list.filter(item => item.level !== 'missing').length;
    tabButtons.reminders.textContent = urgent ? `Нагадування (${urgent})` : 'Нагадування';
    reminderList.replaceChildren(...(list.length
      ? list.map(item => el('li', { class: `ep-r-${item.level}` }, el('span', { text: item.text })))
      : [el('li', { class: 'ep-empty', text: state.ledger.items.length ? 'Усе виплачено або строки ще не настали.' : 'Нагадувань немає: журнал порожній.' })]));
    updateBanner(false);
  }

  function updateBanner(force) {
    const overdue = reminders(state.ledger, state.today).filter(item => item.level === 'overdue');
    if (!overdue.length) {
      banner.hidden = true;
      return;
    }
    if (!force && banner.hidden) return;
    const total = ledgerSummary(state.ledger, state.today).overdue;
    banner.replaceChildren(
      el('span', { text: `Прострочено виплат: ${overdue.length}, разом ${formatMoney(total)}.` }),
      el('button', { type: 'button', class: 'ws-btn', onclick: () => showTab('reminders') }, 'Переглянути'),
      el('button', { type: 'button', class: 'ws-btn', 'aria-label': 'Сховати', onclick: () => { banner.hidden = true; } }, '×'));
    banner.hidden = false;
  }

  // ---------- Довідка ----------
  panels.help.append(el('div', { class: 'ep-help' },
    el('h2', { text: 'Як рахує easyPay' }),
    el('ul', {},
      el('li', { text: 'Оклади: 1 762 грн × коефіцієнт тарифного розряду (додаток 1 постанови №704) і × коефіцієнт звання (додаток 14), з округленням до 10 грн: до 4,99 відкидається, від 5 — угору.' }),
      el('li', { text: 'Розряди посад рядового і сержантського складу — з наказу МОУ №317 (Перелік 2, ред. 07.04.2026). У бойових частинах для багатьох посад розряд вищий; розряд «a/b»: a — контракт і мобілізовані, b — строкова служба.' }),
      el('li', { text: 'Вислуга: 25 / 30 / 35 / 40 / 45 / 50% від окладів за 1–5 / 5–10 / 10–15 / 15–20 / 20–25 / 25+ років (додаток 16).' }),
      el('li', { text: 'Надбавка за особливості служби — від окладів і вислуги, у ЗСУ 65%, стеля 100% (п.5 №704).' }),
      el('li', { text: 'Додаткова винагорода з 01.06.2026 (наказ №232): 100 / 50 / 30 / 10 тис. грн на місяць пропорційно дням; за кількох підстав — одна, більша.' }),
      el('li', { text: 'Зональна з 01.06.2026: 170 тис. (до взводного опорного пункту, ТОТ, сіра зона) і 70 тис. (до ротного) пропорційно дням; до червня — 70 тис. за кожні 30 днів.' }),
      el('li', { text: 'Штурмові: 40 тис. за добу захоплення, 20 тис. за добу відновлення позицій. 100 тис. + зональні + штурмові — не більше 460 тис. на місяць.' }),
      el('li', { text: 'Знищення: 15 тис. за кожного, порівну між учасниками групи; полон: 100 тис. за кожного на групу, частку визначає командир.' }),
    ),
    el('h2', { text: 'Що прийнято як припущення' }),
    el('ul', {},
      el('li', { text: 'Пропорційні виплати діляться на календарні дні місяця: документи не кажуть, на що саме ділити.' }),
      el('li', { text: 'Грошове забезпечення очікується до 20 числа наступного місяця (роз\'яснення Міноборони). Для винагород документи називають лише строк наказу (до 5 числа), тож теж узято 20 число.' }),
      el('li', { text: 'Премія й інші виплати, яких документи не визначають, вносяться вручну. Суми показано до утримання податків і зборів.' }),
    ),
    el('h2', { text: 'Де зберігаються дані' }),
    el('p', { text: 'Журнал — лише у файлі .easypay, який ви самі зберігаєте на своєму комп\'ютері. easyPay нічого не надсилає в мережу. У файлі — тільки параметри окладу й суми, без імені та номерів документів.' }),
    el('p', { class: 'ep-hint', text: 'Це не юридична консультація. Перед зверненням до фінансової служби звірте цифри з чинними текстами постанови №704 і Порядку №260 на zakon.rada.gov.ua.' }),
  ));

  renderCalc();
  renderLedger();
  renderReminders();
  showTab('calc');
  host.setTitle('');

  return {
    unmount() {
      if (state.handle) host.closeFile(state.handle).catch(() => {});
      root.remove();
    },
    isDirty: () => state.dirty,
  };
}
