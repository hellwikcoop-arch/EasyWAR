// Довільне внесення у вкладці «Внесення доповідей» модулів ПС і РВ — другий спосіб поруч зі «Зі звіту».
//
// Над полем звіту з'являється перемикач «Зі звіту / Довільне внесення». Довільне внесення — форма, поля якої
// відповідають стовпцям відкритої таблиці (біля поля стоїть заголовок стовпця й літера Excel). Запис збирається у формі,
// яку розуміє сторінка, і передається їй через window.__AV.addSelected(false, [запис]) — тим самим шляхом запису, що й
// для звіту: № і «Місяць» проставляє таблиця, запис проходить самоперевірку, потрапляє в «Додано в цій сесії» і
// скасовується тією самою кнопкою «Скасувати останнє додавання».
//
// Чернетка живе лише в пам'яті сторінки й нікуди не надсилається. У localStorage лежить тільки вибраний спосіб
// внесення (ключ ew.entry.mode.<ps|rv>). Чисте ядро — поля, перевірка, рядок-перегляд — у manual-entry-core.js.
import './manual-entry.css';
import * as ME from './manual-entry-core.js';

const MANUAL_LEDE = 'Заповніть поля вручну — запис допишеться в кінець таблиці так само, як і при внесенні зі звіту.';
const INTRO = 'Назви полів — це заголовки стовпців відкритої таблиці, поруч указано літеру стовпця в Excel. Обов’язкові лише дата й номер цілі або координати MGRS; порожнє поле лишає порожню клітинку.';

const PLACEHOLDERS = {
  time: 'ГГ:ХХ',
  district: 'Район або населений пункт',
  dpi: '37U DQ 12345 67890\nКілька точок — кожна з нового рядка',
  note: 'Що відомо про результат',
};
// Ознака номера цілі ПС у тексті: лише тоді поле «№ цілі» переписується на блюрі (інакше вільний текст лишається як введено).
const AIR_TARGET_HINT = /(?<![\p{L}\p{N}])[TТtтKКkк][SСsс]\s?[-–]?\s?\d{3}/u;

const $ = (selector, root = document) => root.querySelector(selector);

function h(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const formatDate = iso => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? String(iso).split('-').reverse().join('.') : String(iso || ''));
const dictNames = list => [...new Set((list || []).map(item => item && item.name).filter(Boolean))];

function start() {
  const AV = window.__AV;
  const C = window.AVCORE;
  const view = $('#view-entry');
  const paste = $('#paste');
  const pasteSection = paste ? paste.closest('section') : null;
  const resultsPanel = $('#resultsPanel');
  const results = $('#results');
  if (!AV || !AV.S || !C || !view || !pasteSection || !resultsPanel || !results) return false;

  const S = AV.S;
  const profile = ME.profileOf(C);
  const MODE_KEY = 'ew.entry.mode.' + profile;
  // Сторінка без точкової правки addSelected(fromAuto, explicit) додала б замість запису з форми розібраний звіт —
  // тому без неї довільне внесення не пропонується взагалі.
  const canAddExplicit = typeof AV.addSelected === 'function' && AV.addSelected.length >= 2;

  let prefersManual = false;
  try { prefersManual = localStorage.getItem(MODE_KEY) === 'manual'; } catch (error) { /* сховище недоступне — лишається «Зі звіту» */ }

  let draft = ME.emptyDraft(ME.todayIso());
  const touched = new Set(); // поля, які користувач уже залишив: лише для них показуємо зауваження
  let attempted = false; // була спроба додати: показуємо всі зауваження
  let confirmDup = false;
  let lastDupId = '';
  let submitting = false;
  let layoutKey = '';
  let dataKey = '';
  let fields = [];
  let savedLede = null;
  const controls = new Map();
  const autoRefs = {};

  /* ------------------------------ каркас ------------------------------ */
  const reportBtn = h('button', { type: 'button', 'data-mode': 'report', onclick: () => setPreferred(false) }, 'Зі звіту');
  const manualBtn = h('button', { type: 'button', 'data-mode': 'manual', onclick: () => setPreferred(true) }, 'Довільне внесення');
  const modeRow = h('div', { class: 'ew-me-mode', id: 'ewMeMode', role: 'group', 'aria-label': 'Спосіб внесення', hidden: true },
    h('span', { class: 'ew-me-mode-lab' }, 'Спосіб внесення'),
    h('div', { class: 'ew-me-seg' }, reportBtn, manualBtn));

  const pendingText = h('p', { class: 'msg' });
  const pending = h('div', { class: 'notice', id: 'ewMePending', hidden: true },
    pendingText,
    h('button', { type: 'button', class: 'btn', onclick: () => setPreferred(false) }, 'Перейти до звіту'));
  const autoBox = h('div', { class: 'ew-me-auto', hidden: true });
  const grid = h('div', { class: 'grid ew-me-grid', id: 'ewMeGrid' });
  const lists = h('div', { hidden: true, 'aria-hidden': 'true' });
  const dupText = h('span');
  const dupCheck = h('input', { type: 'checkbox', id: 'ewMeDupOk' });
  dupCheck.addEventListener('change', () => { confirmDup = dupCheck.checked; renderStatus(); });
  const dupBox = h('div', { class: 'ew-me-dup', hidden: true },
    h('p', { class: 'dupnote' }, dupText),
    h('label', { class: 'switch' }, dupCheck, h('span', {}, 'Додати все одно')));
  const emptyLine = h('p', { class: 'ew-me-empty hint', hidden: true });
  const previewTable = h('table', { class: 'ew-me-table', id: 'ewMePreview' });
  const needLine = h('p', { class: 'ew-me-need', 'aria-live': 'polite' });
  const keepLine = h('p', { class: 'hint ew-me-keep' });
  const submitBtn = h('button', { type: 'button', class: 'btn primary big', id: 'ewMeSubmit', onclick: () => submit() }, 'Додати запис у таблицю');

  const panel = h('section', { class: 'panel', id: 'ewManualPanel', 'aria-labelledby': 'ewMeTitle', hidden: true },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'ewMeTitle' }, 'Довільне внесення'),
      h('div', { class: 'tools' }, h('button', { type: 'button', class: 'link', id: 'ewMeClear', onclick: () => clearForm() }, 'Очистити форму'))),
    pending,
    h('p', { class: 'ew-me-lede' }, INTRO),
    autoBox,
    grid,
    lists,
    dupBox,
    emptyLine,
    h('h3', { class: 'ew-me-sub' }, 'Рядок у таблиці'),
    h('div', { class: 'ew-me-scroll' }, previewTable),
    needLine,
    h('div', { class: 'actions' }, submitBtn, h('span', { class: 'hint kbd' }, 'Ctrl + Enter')),
    keepLine);

  // Натискання кнопки не забирає фокус із поля: інакше поле «блюриться», зауваження під ним змінюють висоту форми,
  // кнопка зсувається між натисканням і відпусканням — і клік по ній губиться (потрібно було б клікати вдруге).
  panel.addEventListener('mousedown', event => {
    if (event.target instanceof Element && event.target.closest('button, .switch')) event.preventDefault();
  });

  pasteSection.classList.add('ew-report-only');
  resultsPanel.classList.add('ew-report-only');
  pasteSection.before(modeRow, panel);

  /* ------------------------------ стан таблиці й режим ------------------------------ */
  function tableState() {
    const wb = S.wb;
    const usable = Boolean(canAddExplicit && wb && wb.kind !== 'pvk' && wb.colByField && Array.isArray(wb.records));
    return { wb, usable, review: Boolean(S.signalReview) };
  }
  const isManual = () => { const t = tableState(); return prefersManual && t.usable && !t.review; };

  // Перегляд Signal пише у ту саму панель перевірки, тому на цей час форма поступається «Зі звіту».
  function syncMode() {
    const t = tableState();
    const available = t.usable && !t.review;
    const manual = prefersManual && available;
    modeRow.hidden = !available;
    reportBtn.setAttribute('aria-pressed', String(!manual));
    manualBtn.setAttribute('aria-pressed', String(manual));
    view.classList.toggle('ew-manual-on', manual);
    panel.hidden = !manual;
    syncLede(manual);
    const waiting = manual ? S.parsed.length : 0;
    pending.hidden = !waiting;
    if (waiting) pendingText.textContent = 'Із тексту звіту розпізнано записів: ' + waiting + '. Вони ще не додані — перейдіть у «Зі звіту», щоб перевірити й додати їх.';
    return manual;
  }

  // Сторінка сама переписує підзаголовок при кожному оновленні, тому підміняємо його й повертаємо назад за потреби.
  function syncLede(manual) {
    const lede = $('.lede', view);
    if (!lede) return;
    if (manual) {
      if (lede.textContent !== MANUAL_LEDE) { savedLede = lede.textContent; lede.textContent = MANUAL_LEDE; }
    } else if (savedLede != null) {
      if (lede.textContent === MANUAL_LEDE) lede.textContent = savedLede;
      savedLede = null;
    }
  }

  function setPreferred(manual) {
    prefersManual = manual;
    try { localStorage.setItem(MODE_KEY, manual ? 'manual' : 'report'); } catch (error) { /* не вдалося запам'ятати вибір — діє до перезавантаження */ }
    refresh();
    if (manual && isManual()) focusKey('time');
    else if (!manual && !paste.disabled) paste.focus();
  }

  /* ------------------------------ поля форми ------------------------------ */
  function chipNames(wb, field) {
    return dictNames(wb[field.dict]).filter(name => field.key === 'types' || name !== 'Інше');
  }

  function renderChips(ctl) {
    const { field } = ctl;
    const selected = draft[field.key] || [];
    const names = [...new Set(ctl.names.concat(selected))];
    if (!names.length) {
      ctl.chips.replaceChildren(h('span', { class: 'hint' }, field.key === 'types' ? 'У таблиці немає довідника типів цілей — запишеться «Інше».' : 'У таблиці немає довідника причин.'));
      return;
    }
    ctl.chips.replaceChildren(...names.map(name => {
      const on = selected.includes(name);
      const button = h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on) }, name);
      button.addEventListener('click', () => {
        const list = draft[field.key];
        const at = list.indexOf(name);
        if (at >= 0) list.splice(at, 1); else list.push(name);
        const now = list.includes(name);
        button.classList.toggle('on', now);
        button.setAttribute('aria-pressed', String(now));
        touched.add(field.key);
        renderStatus();
      });
      return button;
    }));
  }

  // Що перепишеться у полі, коли користувач його залишає: лише безпечне очищення, решту показує рядок-перегляд.
  function tidy(field, value) {
    if (field.key === 'time') { const time = ME.normalizeTime(value); return time == null ? value : time; }
    if (field.key === 'crew') return ME.normalizeCrew(value);
    if (field.key === 'targets') return profile === 'air' && !AIR_TARGET_HINT.test(value) ? ME.oneLine(value) : ME.normalizeTargets(value, profile);
    if (field.control === 'area') return ME.multiLine(value);
    if (field.control === 'text' || field.control === 'number') return ME.oneLine(value);
    return value;
  }

  function makeInput(field, id) {
    let input;
    if (field.control === 'select') {
      input = h('select', { id },
        h('option', { value: '' }, '— не вибрано —'),
        field.options.map(option => h('option', { value: option }, option)));
    } else if (field.control === 'area') {
      input = h('textarea', { id, rows: field.rows, spellcheck: 'false', class: field.mono ? 'mono' : null, placeholder: PLACEHOLDERS[field.key] });
    } else {
      const isDate = field.control === 'date';
      const numeric = field.key === 'time' || field.key === 'count';
      input = h('input', {
        id,
        type: isDate ? 'date' : 'text',
        min: isDate ? '2000-01-01' : null,
        max: isDate ? '2100-12-31' : null,
        inputmode: numeric ? 'numeric' : null,
        maxlength: numeric ? 8 : null,
        list: field.list ? 'ewMeDl-' + field.list : null,
        autocomplete: 'off',
        placeholder: PLACEHOLDERS[field.key] || (field.key === 'targets' ? (profile === 'air' ? 'TS1234, KS5678' : 'Кілька цілей — через кому') : null),
      });
    }
    input.addEventListener(field.control === 'select' ? 'change' : 'input', () => { draft[field.key] = input.value; renderStatus(); });
    input.addEventListener('blur', () => {
      touched.add(field.key);
      const next = tidy(field, input.value);
      if (next !== input.value) { input.value = next; draft[field.key] = next; }
      renderStatus();
    });
    return input;
  }

  function buildGrid(wb, nextFields) {
    fields = nextFields;
    controls.clear();
    grid.replaceChildren(...fields.map(field => {
      const id = 'ewMe-' + field.key;
      const isChips = field.control === 'chips';
      const wrap = h('div', { class: 'f w-' + field.w, 'data-key': field.key });
      const msg = h('span', { class: 'msg', id: id + '-msg', hidden: true });
      const label = h(isChips ? 'span' : 'label', { class: 'lab ew-me-lab', id: id + '-lab', for: isChips ? null : id, title: field.label + ' · стовпець ' + field.letter },
        h('span', {}, field.label),
        h('span', { class: 'ew-me-col' }, h('span', { class: 'ew-me-col-w' }, 'стовпець '), field.letter));
      const ctl = { field, wrap, msg, input: null, chips: null, names: [] };
      if (isChips) {
        ctl.names = chipNames(wb, field);
        ctl.chips = h('div', { class: 'chips', id, role: 'group', 'aria-labelledby': id + '-lab' });
        renderChips(ctl);
        wrap.append(label, ctl.chips, msg);
      } else {
        ctl.input = makeInput(field, id);
        wrap.append(label, ctl.input, msg);
      }
      controls.set(field.key, ctl);
      return wrap;
    }));
  }

  function buildAuto(autos) {
    for (const key of Object.keys(autoRefs)) delete autoRefs[key];
    autoBox.hidden = !autos.length;
    autoBox.replaceChildren(
      h('span', { class: 'ew-me-auto-title' }, 'Таблиця заповнить сама:'),
      ...autos.map(item => {
        const value = h('b', {}, '—');
        autoRefs[item.column] = value;
        return h('span', {}, item.label + ' (стовпець ' + item.letter + ') — ', value, h('span', { class: 'ew-me-auto-note' }, item.column === 'num' ? ' · наступний за останнім' : ' · за датою'));
      }));
  }

  function syncControls() {
    for (const ctl of controls.values()) {
      if (ctl.chips) renderChips(ctl);
      else ctl.input.value = draft[ctl.field.key] || '';
    }
  }

  // Поля перебудовуються лише тоді, коли змінилася сама таблиця (стовпці, довідники): чернетка при цьому зберігається.
  function ensureLayout(wb) {
    const nextFields = ME.manualFields(C, wb);
    const autos = ME.autoColumns(C, wb);
    const key = JSON.stringify([nextFields.map(f => [f.key, f.letter, f.label, f.w]), autos.map(x => [x.column, x.letter]), dictNames(wb.typeDict), dictNames(wb.causeDict)]);
    if (key === layoutKey) return;
    layoutKey = key;
    buildGrid(wb, nextFields);
    buildAuto(autos);
    const keep = ['date', 'aircraft', 'crew', 'firingUnit'].map(k => nextFields.find(f => f.key === k)).filter(Boolean).map(f => f.label);
    keepLine.textContent = 'Після додавання у формі лишаються: ' + keep.join(', ') + ' — решту полів очищено для наступного запису.';
    syncControls();
  }

  function ensureLists(wb) {
    const key = S.name + '|' + wb.records.length;
    if (key === dataKey) return;
    dataKey = key;
    const suggestions = ME.suggestions(C, wb);
    lists.replaceChildren(...Object.entries(suggestions).map(([name, values]) =>
      h('datalist', { id: 'ewMeDl-' + name }, values.slice(0, 300).map(value => h('option', { value })))));
  }

  /* ------------------------------ зауваження, перегляд, стан кнопки ------------------------------ */
  function visibleMessage(key, a, started) {
    const open = attempted || touched.has(key);
    // Помилка «немає цілі» залежить від двох полів, тому до спроби додати її не показуємо.
    if (a.errors[key] && open && (key !== 'targets' || attempted)) return { kind: 'err', text: a.errors[key] };
    if (a.warnings[key] && (open || (key === 'types' && started))) return { kind: 'warn', text: a.warnings[key] };
    return null;
  }

  function setMessage(field, info) {
    const ctl = controls.get(field.key);
    if (!ctl) return;
    const err = Boolean(info) && info.kind === 'err';
    ctl.msg.hidden = !info;
    ctl.msg.textContent = info ? info.text : '';
    ctl.msg.classList.toggle('err', err);
    ctl.wrap.classList.toggle('err', err);
    ctl.wrap.classList.toggle('warn', Boolean(info) && !err);
    const target = ctl.input || ctl.chips;
    if (info) target.setAttribute('aria-describedby', ctl.msg.id); else target.removeAttribute('aria-describedby');
    if (err) target.setAttribute('aria-invalid', 'true'); else target.removeAttribute('aria-invalid');
  }

  function renderPreview(wb, a) {
    const cells = ME.previewCells(C, wb, a.record, ME.nextNumber(wb.records));
    const head = h('tr', {}, cells.map(cell => h('th', { scope: 'col', title: cell.header + ' · стовпець ' + cell.letter },
      h('span', { class: 'ew-me-letter' }, cell.letter), cell.header)));
    const row = h('tr', {}, cells.map(cell => {
      const lines = String(cell.value).split('\n');
      const shown = !cell.value ? '—' : lines.length > 1 ? lines[0] + ' … (ще рядків: ' + (lines.length - 1) + ')' : cell.value;
      return h('td', { class: cell.auto ? 'auto' : !cell.value ? 'nil' : null, title: cell.value || null }, shown);
    }));
    previewTable.replaceChildren(h('thead', {}, head), h('tbody', {}, row));
  }

  function needList(a) {
    const label = key => { const f = fields.find(x => x.key === key); return f ? '«' + f.label + '»' : ''; };
    const parts = [];
    if (a.errors.date) parts.push('вкажіть ' + label('date'));
    if (a.errors.targets) parts.push('вкажіть ' + [label('targets'), label('dpi')].filter(Boolean).join(' або '));
    if (a.errors.time) parts.push('виправте ' + label('time') + ' (ГГ:ХХ)');
    if (a.errors.count) parts.push('виправте ' + label('count') + ' (ціле число)');
    return parts;
  }

  function renderStatus() {
    const t = tableState();
    if (!t.usable || !fields.length) return;
    const wb = t.wb;
    const a = ME.analyzeDraft(draft, { profile, today: ME.todayIso() });
    const started = Boolean(a.record.targets || a.record.dpi);
    for (const field of fields) setMessage(field, visibleMessage(field.key, a, started));

    if (autoRefs.num) autoRefs.num.textContent = String(ME.nextNumber(wb.records));
    if (autoRefs.month) autoRefs.month.textContent = ME.monthName(C, a.record.date) || '—';

    // Той самий запис удруге додається лише з позначкою «Додати все одно».
    const dup = a.ok ? C.findDuplicate(a.record, wb.records) : null;
    const dupId = dup ? [dup.num, dup.date, dup.time].join('|') : '';
    if (dupId !== lastDupId) { lastDupId = dupId; confirmDup = false; dupCheck.checked = false; }
    dupBox.hidden = !dup;
    if (dup) dupText.textContent = 'Схоже, такий запис уже є в таблиці (№' + dup.num + ', ' + formatDate(dup.date) + (dup.time ? ' ' + dup.time : '') + '). Щоб додати його ще раз, поставте позначку.';

    const emptyLabels = started ? a.empty.map(key => fields.find(f => f.key === key)).filter(Boolean).map(f => f.label) : [];
    emptyLine.hidden = !emptyLabels.length;
    emptyLine.textContent = 'Порожніми лишаться стовпці: ' + emptyLabels.join(', ') + '.';

    renderPreview(wb, a);

    let note;
    let kind = '';
    if (!a.ok) note = 'Щоб додати запис: ' + needList(a).join('; ') + '.';
    else if (dup && !confirmDup) { note = 'Такий запис уже є в таблиці — позначте «Додати все одно», якщо це не помилка.'; kind = 'warn'; }
    else { note = 'Запис готовий до додавання.'; kind = 'ok'; }
    needLine.textContent = note;
    needLine.className = 'ew-me-need' + (kind ? ' ' + kind : '');
    submitBtn.disabled = submitting || S.busy || Boolean(dup && !confirmDup);
    submitBtn.textContent = submitting ? 'Додаю…' : 'Додати запис у таблицю';
  }

  function focusKey(key) {
    const ctl = controls.get(key);
    const element = ctl && (ctl.input || (ctl.chips && ctl.chips.querySelector('button')));
    if (element) element.focus();
  }

  /* ------------------------------ дії ------------------------------ */
  function resetState() {
    touched.clear();
    attempted = false;
    confirmDup = false;
    lastDupId = '';
    dupCheck.checked = false;
  }

  function clearForm() {
    draft = ME.emptyDraft(ME.todayIso());
    resetState();
    syncControls();
    renderStatus();
    focusKey('time');
  }

  async function submit() {
    if (submitting || !isManual() || S.busy) return;
    const wb = S.wb;
    const a = ME.analyzeDraft(draft, { profile, today: ME.todayIso() });
    if (!a.ok) {
      attempted = true;
      renderStatus();
      const first = fields.find(f => a.errors[f.key]);
      if (first) focusKey(first.key);
      return;
    }
    const dup = C.findDuplicate(a.record, wb.records);
    if (dup && !confirmDup) {
      attempted = true;
      renderStatus();
      dupCheck.focus();
      return;
    }
    submitting = true;
    renderStatus();
    const before = S.undo.length;
    try {
      await AV.addSelected(false, [a.record]);
    } catch (error) {
      AV.showError(error && error.message ? error.message : String(error));
    } finally {
      submitting = false;
    }
    // Сторінка сама показує і помилку запису, і «Додано…». Успіх — це новий крок у списку скасування.
    if (S.undo.length > before) {
      draft = ME.stickyDraft(draft, ME.todayIso());
      resetState();
      syncControls();
      refresh();
      focusKey('time');
    } else refresh();
  }

  /* ------------------------------ оновлення ------------------------------ */
  function refresh() {
    // Під час запису сторінка кілька разів перемальовується: щойно додане не має бути видно як «дубль» чернетки.
    if (submitting) return;
    if (!syncMode()) return;
    const wb = S.wb;
    ensureLayout(wb);
    ensureLists(wb);
    renderStatus();
  }

  document.addEventListener('av:data', refresh);
  // Перегляд Signal вмикається без події av:data — стежимо за панеллю перевірки й кнопкою додавання.
  const observer = new MutationObserver(() => refresh());
  observer.observe(resultsPanel, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(results, { childList: true });
  const addBtn = $('#addBtn');
  if (addBtn) observer.observe(addBtn, { attributes: true, childList: true, characterData: true, subtree: true });

  // Ctrl/⌘ + Enter: у довільному внесенні додає запис із форми, а не розібраний звіт, який чекає у прихованому полі.
  // Чужі вікна й діалоги поверх вкладки (фокус поза нею) не перехоплюємо.
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    if (view.hidden || !isManual()) return;
    const target = event.target;
    if (target !== document.body && target !== document.documentElement && !(target instanceof Node && view.contains(target))) return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  }, true);

  refresh();
  return true;
}

if (!start()) document.addEventListener('DOMContentLoaded', start, { once: true });
