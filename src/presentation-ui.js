/* Вікно «Створити презентацію»: налаштування → меню перевірки даних → збереження .pptx / .pdf.
   Дашборд УДШВ (openPresentationDialog) і модулі ПС та РВіА (openModulePresentationDialog) мають одне вікно:
   у модуля немає фокусу, додаткових таблиць і підрозділів, бо колода будується з його власної таблиці ударів.
   Усе локально: файли читаються на пристрої, презентація зберігається через системне вікно збереження. */
import './presentation-dialog.css';
import { FOCUS_CHOICES, FORMAT_CHOICES, GROUP_SLOTS, composeDeck, composeModuleDeck, parseSlot, presentationFileName, reviewFor, reviewForModule } from './presentation-flow.js';
import { GROUP_PROFILES } from './presentation-group.js';
import { unitFreshness } from './udshv-dashboard-core.js';
import { defaultDecisions } from './data-review-core.js';
import { longDate } from './presentation-format.js';

const OWNER_KEY = 'easywar.presentation.owner';
const TITLE_KEY = 'easywar.presentation.title';
const FORMAT_KEY = 'easywar.presentation.format';
const FONT_KEY = 'easywar.presentation.font';
const UAF_KEY = 'easywar.presentation.uafsans';

const toBase64 = bytes => { let t = ''; for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(t); };
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const SLOTS = [{ key: 'own', title: 'Наші втрати', hint: 'таблиця «НАШІ ВТРАТИ»' }, ...GROUP_SLOTS.map(g => ({ key: g.key, title: g.title, hint: `таблиця ${g.title}` }))];

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter(c => c != null));
  return el;
}
const store = {
  get(key = OWNER_KEY) { try { return localStorage.getItem(key) || ''; } catch { return ''; } },
  set(v, key = OWNER_KEY) { try { localStorage.setItem(key, v); } catch { /* пам'ять недоступна — не критично */ } },
};
const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

async function saveBytes(bytes, name, kind = 'pptx') {
  const invoke = window.__TAURI_INTERNALS__?.invoke || window.parent?.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === 'function') return invoke('save_presentation', { fileName: name, bytes: Array.from(bytes), kind });
  const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })), download: name });
  document.body.append(a); a.click(); a.remove();
  return name;
}

/** Дашборд УДШВ. options.readSheets(Uint8Array) → Promise<sheets> — читання XLSX ядром застосунку. */
export const openPresentationDialog = (workbook, options = {}) => openDialog(workbook, options, null);

/** Модуль ПС або РВіА: strikes — розібрана таблиця ударів (strikes-core.js), groupKey — 'ps' | 'rvia'. */
export const openModulePresentationDialog = (strikes, groupKey, options = {}) => openDialog(strikes, options, GROUP_PROFILES[groupKey] || GROUP_PROFILES.ps);

function openDialog(workbook, options, profile) {
  // Власник і назва титулу запам'ятовуються окремо для кожного модуля: титул ПС не підміняє титул УДШВ.
  const keyOf = key => (profile ? `${key}.${profile.key}` : key);
  const fresh = profile ? null : unitFreshness(workbook);
  const s = {
    owner: store.get(keyOf(OWNER_KEY)), titleText: store.get(keyOf(TITLE_KEY)), focus: 'all', format: store.get(FORMAT_KEY) || 'pptx', font: store.get(FONT_KEY) || 'standard', uaf: (() => { try { return JSON.parse(store.get(UAF_KEY) || 'null'); } catch { return null; } })(), period: 'rolling', from: '', to: '',
    files: {}, names: {}, errors: {}, excluded: new Set(),
    step: 'settings', review: null, decisions: {}, busy: false, message: '',
  };
  const dialog = h('dialog', { class: profile ? 'ud-present-dialog ud-module' : 'ud-present-dialog' });
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  // Подія cancel спливає і від поля вибору файлу — реагуємо лише на власне закриття вікна.
  dialog.addEventListener('cancel', e => { if (e.target === dialog) dialog.remove(); });

  async function pick(slot, file) {
    s.errors[slot] = '';
    if (!file) { delete s.files[slot]; delete s.names[slot]; return draw(); }
    try {
      const sheets = await options.readSheets(new Uint8Array(await file.arrayBuffer()));
      const parsed = parseSlot(slot, sheets, file.name);
      if (parsed.error) { s.errors[slot] = parsed.error; delete s.files[slot]; delete s.names[slot]; }
      else { s.files[slot] = parsed.workbook; s.names[slot] = file.name; }
    } catch (e) { s.errors[slot] = `Не вдалося прочитати файл: ${e.message || e}`; }
    draw();
  }

  async function pickFont(kind, file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      s.uaf = { ...(s.uaf || {}), [kind]: toBase64(bytes), [`${kind}Name`]: file.name };
      store.set(JSON.stringify(s.uaf), UAF_KEY);
      s.message = '';
    } catch (e) { s.message = `Не вдалося прочитати файл шрифту: ${e.message || e}`; }
    draw();
  }

  const settings = () => [
    h('h2', { text: profile ? `Створити презентацію · ${profile.short}` : 'Створити презентацію' }),
    profile ? h('p', { class: 'ud-muted', text: `Таблиця: ${workbook.sourceName || 'без назви'} · записів з датою: ${workbook.records.length}${workbook.records.length ? `, ${longDate(workbook.records[0].date)} – ${longDate(workbook.records[workbook.records.length - 1].date)}` : ''}. Презентація будується лише з неї; файл не змінюється.` }) : null,
    h('label', { class: 'ud-field' }, h('span', { text: 'Заголовок титулу' }),
      h('input', { type: 'text', value: s.titleText, placeholder: profile ? `Напр. ${profile.defaultTitle}` : 'Напр. Аналітика центру ОВгП', oninput: e => { s.titleText = e.target.value; } })),
    h('label', { class: 'ud-field' }, h('span', { text: profile ? 'Підзаголовок: чия аналітика (підрозділ, угруповання)' : 'Підзаголовок: чия аналітика (угруповання)' }),
      h('input', { type: 'text', value: s.owner, placeholder: profile ? `Напр. ${profile.name}` : 'Напр. Угруповання ОВП УДШВ', oninput: e => { s.owner = e.target.value; } })),
    profile ? null : h('fieldset', {}, h('legend', { text: 'Фокус' }),
      FOCUS_CHOICES.map(([k, label]) => h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'focus', checked: s.focus === k, onchange: () => { s.focus = k; } }), ` ${label}`))),
    h('fieldset', {}, h('legend', { text: 'Формат файлу' }),
      FORMAT_CHOICES.map(([k, label]) => h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'format', checked: s.format === k, onchange: () => { s.format = k; } }), ` ${label}`))),
    h('fieldset', {}, h('legend', { text: 'Шрифт' }),
      h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'font', checked: s.font === 'standard', onchange: () => { s.font = 'standard'; draw(); } }), ' Стандартний (Arial у PPTX, Liberation Sans у PDF)'),
      h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'font', checked: s.font === 'uaf', onchange: () => { s.font = 'uaf'; draw(); } }), ' UAF Sans (ваші файли шрифту)'),
      s.font === 'uaf' ? h('div', { class: 'ud-slot' },
        h('div', { class: 'ud-muted', text: 'У PDF шрифт вбудовується з ваших файлів (вони лишаються на цьому пристрої). У PPTX записується назва «UAF Sans»: на інших комп’ютерах без цього шрифту він замінюється.' }),
        [['regular', 'Звичайний (UAF Sans Regular)'], ['bold', 'Жирний (UAF Sans OnBoard)']].map(([kind, label]) => h('div', {},
          h('strong', { text: label }), ' ', s.uaf && s.uaf[kind] ? h('span', { text: `збережено: ${s.uaf[`${kind}Name`] || 'файл'}` }) : null,
          h('input', { type: 'file', accept: '.ttf,.otf', onchange: e => pickFont(kind, e.target.files[0]) })))) : null),
    h('fieldset', {}, h('legend', { text: 'Період' }),
      h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'period', checked: s.period === 'rolling', onchange: () => { s.period = 'rolling'; draw(); } }), ' 7 діб, 30 діб і весь період'),
      h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'period', checked: s.period === 'custom', onchange: () => { s.period = 'custom'; draw(); } }), ' Обраний період'),
      s.period === 'custom' ? h('div', { class: 'ud-dates' },
        h('input', { type: 'date', value: s.from, onchange: e => { s.from = e.target.value; } }), ' — ',
        h('input', { type: 'date', value: s.to, onchange: e => { s.to = e.target.value; } })) : null),
    profile ? null : h('fieldset', {}, h('legend', { text: 'Додаткові таблиці (необов’язково: немає файлу — немає слайда)' }),
      SLOTS.map(slot => h('div', { class: 'ud-slot' },
        h('strong', { text: slot.title }), ' ',
        s.names[slot.key] ? h('span', { text: s.names[slot.key] }) : h('span', { class: 'ud-muted', text: `не підключено (${slot.hint})` }),
        s.names[slot.key] ? null : h('input', { type: 'file', accept: '.xlsx', onchange: e => pick(slot.key, e.target.files[0]) }),
        s.names[slot.key] ? h('button', { type: 'button', class: 'ud-link', text: 'прибрати', onclick: () => pick(slot.key, null) }) : null,
        s.errors[slot.key] ? h('div', { class: 'ud-error', text: s.errors[slot.key] }) : null))),
    profile ? null : h('fieldset', {}, h('legend', { text: 'Підрозділи в аналізі (зніміть позначку, щоб виключити)' }),
      fresh.rows.map(row => h('label', { class: 'ud-radio' },
        h('input', { type: 'checkbox', checked: !s.excluded.has(row.unit), onchange: e => { if (e.target.checked) s.excluded.delete(row.unit); else s.excluded.add(row.unit); } }),
        ` ${row.unit}`, row.stale ? h('em', { class: 'ud-muted', text: ` — без свіжих даних (остання дата ${row.lastDate ? row.lastDate.split('-').reverse().join('.') : '—'}), пропонується виключити` }) : null))),
    h('div', { class: 'ud-actions' },
      h('button', { type: 'button', class: 'ud-btn', text: 'Скасувати', onclick: close }),
      h('button', { type: 'button', class: 'ud-btn primary', text: 'Далі', onclick: next })),
  ];

  const reviewView = () => [
    h('h2', { text: 'Перевірка даних' }),
    h('p', { class: 'ud-muted', text: `Знайдено пунктів: ${s.review.counts.total}. Виправте дані або пропустіть і створіть презентацію з наявних. Файли-джерела не змінюються.` }),
    ...s.review.items.map(item => h('div', { class: `ud-review ${item.severity}` },
      h('strong', { text: `${item.sourceLabel}: ${item.title}` }), h('div', { class: 'ud-muted', text: item.detail }),
      h('select', { onchange: e => { const [action, idx] = e.target.value.split(':'); const opt = item.options[Number(idx)]; s.decisions[item.id] = { action, value: opt.value }; draw(); } },
        item.options.map((o, i) => h('option', { value: `${o.action}:${i}`, selected: (s.decisions[item.id]?.action || item.defaultAction) === o.action && (s.decisions[item.id]?.value ?? o.value) === o.value, text: o.label }))),
      (() => { const o = item.options.find(opt => opt.editable && opt.action === 'fix'); const d = s.decisions[item.id]; return o && d?.action === 'fix' ? h('input', { type: 'text', value: d.value ?? '', onchange: e => { s.decisions[item.id] = { action: 'fix', value: e.target.value }; } }) : null; })())),
    h('div', { class: 'ud-actions' },
      h('button', { type: 'button', class: 'ud-btn', text: 'Назад', onclick: () => { s.step = 'settings'; draw(); } }),
      h('button', { type: 'button', class: 'ud-btn primary', text: 'Створити з наявних даних', onclick: generate })),
  ];

  const body = () => [
    s.step === 'settings' ? settings() : reviewView(),
    s.message ? h('div', { class: 'ud-error', role: 'status', text: s.message }) : null,
    s.busy ? h('div', { class: 'ud-muted', text: 'Створюю презентацію…' }) : null,
  ];
  function draw() { dialog.textContent = ''; dialog.append(...body().flat().filter(Boolean)); }

  const settingsOut = () => ({
    owner: s.owner.trim(), titleText: s.titleText.trim(), focus: s.focus, generatedOn: today(),
    custom: s.period === 'custom' ? { from: s.from, to: s.to } : null,
    excludeUnits: [...s.excluded], decisions: s.decisions,
  });

  function next() {
    s.message = '';
    if (s.period === 'custom' && !(s.from && s.to)) { s.message = 'Вкажіть початок і кінець періоду.'; return draw(); }
    if (!profile && s.excluded.size >= fresh.rows.length) { s.message = 'Залиште хоча б один підрозділ.'; return draw(); }
    store.set(s.owner.trim(), keyOf(OWNER_KEY));
    store.set(s.titleText.trim(), keyOf(TITLE_KEY));
    store.set(s.format, FORMAT_KEY);
    store.set(s.font, FONT_KEY);
    if (s.font === 'uaf' && (s.format !== 'pptx') && !(s.uaf && s.uaf.regular && s.uaf.bold)) { s.message = 'Для PDF з UAF Sans додайте обидва файли шрифту.'; return draw(); }
    s.review = profile ? reviewForModule(workbook, profile.key) : reviewFor(workbook, s.files);
    if (s.review.clean) return generate();
    s.decisions = defaultDecisions(s.review.items);
    s.step = 'review'; draw();
  }

  async function generate() {
    if (s.busy) return;
    s.busy = true; s.message = ''; draw();
    try {
      const out = settingsOut();
      const composeSettings = out.decisions && s.step === 'review' ? out : { ...out, decisions: undefined };
      const { deck } = profile ? composeModuleDeck(workbook, profile.key, composeSettings) : composeDeck(workbook, s.files, composeSettings);
      const pptx = await import('./presentation-pptx.js');
      const artApi = await import('./presentation-art.js');
      const art = await artApi.loadArt();
      const saved = [];
      if (s.format === 'pptx' || s.format === 'both') {
        const path = await saveBytes(await pptx.renderDeckToBytes(deck, { art, font: s.font === 'uaf' ? 'UAF Sans' : 'Arial' }), presentationFileName(out.owner, out.generatedOn, 'pptx', profile?.short), 'pptx');
        if (path) saved.push(path);
      }
      if (s.format === 'pdf' || s.format === 'both') {
        const base = await artApi.loadFonts();
        const fonts = s.font === 'uaf' ? { regular: fromBase64(s.uaf.regular), bold: fromBase64(s.uaf.bold), fallback: base.regular, fallbackBold: base.bold } : base;
        const path = await saveBytes(await pptx.renderDeckToPdfBytes(deck, { art, fonts, font: s.font === 'uaf' ? 'UAF Sans' : 'Arial' }), presentationFileName(out.owner, out.generatedOn, 'pdf', profile?.short), 'pdf');
        if (path) saved.push(path);
      }
      if (saved.length) { s.message = ''; close(); options.toast?.(`Збережено: ${saved.join(', ')}`); return; }
    } catch (e) { s.message = `Не вдалося створити презентацію: ${e.message || e}`; }
    s.busy = false; draw();
  }

  draw();
  dialog.showModal();
}
