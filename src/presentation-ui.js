/* Вікно «Створити звіт» дашборда УДШВ: налаштування → меню перевірки даних → збереження .pptx.
   Усе локально: файли читаються на пристрої, презентація зберігається через системне вікно збереження. */
import { FOCUS_CHOICES, GROUP_SLOTS, composeDeck, parseSlot, presentationFileName, reviewFor } from './presentation-flow.js';
import { unitFreshness } from './udshv-dashboard-core.js';
import { defaultDecisions } from './data-review-core.js';

const OWNER_KEY = 'easywar.presentation.owner';
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
  get() { try { return localStorage.getItem(OWNER_KEY) || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem(OWNER_KEY, v); } catch { /* пам'ять недоступна — не критично */ } },
};
const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

async function saveBytes(bytes, name) {
  const invoke = window.__TAURI_INTERNALS__?.invoke || window.parent?.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === 'function') return invoke('save_presentation', { fileName: name, bytes: Array.from(bytes) });
  const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })), download: name });
  document.body.append(a); a.click(); a.remove();
  return name;
}

/** options.readSheets(Uint8Array) → Promise<sheets> — читання XLSX ядром застосунку. */
export function openPresentationDialog(workbook, options = {}) {
  const fresh = unitFreshness(workbook);
  const s = {
    owner: store.get(), focus: 'all', period: 'rolling', from: '', to: '',
    files: {}, names: {}, errors: {}, excluded: new Set(),
    step: 'settings', review: null, decisions: {}, busy: false, message: '',
  };
  const dialog = h('dialog', { class: 'ud-present-dialog' });
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

  const settings = () => [
    h('h2', { text: 'Створити презентацію' }),
    h('label', { class: 'ud-field' }, h('span', { text: 'Чия аналітика (назва на титулі)' }),
      h('input', { type: 'text', value: s.owner, placeholder: 'Напр. Угруповання ОВП УДШВ', oninput: e => { s.owner = e.target.value; } })),
    h('fieldset', {}, h('legend', { text: 'Фокус' }),
      FOCUS_CHOICES.map(([k, label]) => h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'focus', checked: s.focus === k, onchange: () => { s.focus = k; } }), ` ${label}`))),
    h('fieldset', {}, h('legend', { text: 'Період' }),
      h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'period', checked: s.period === 'rolling', onchange: () => { s.period = 'rolling'; draw(); } }), ' 7 діб, 30 діб і весь період'),
      h('label', { class: 'ud-radio' }, h('input', { type: 'radio', name: 'period', checked: s.period === 'custom', onchange: () => { s.period = 'custom'; draw(); } }), ' Обраний період'),
      s.period === 'custom' ? h('div', { class: 'ud-dates' },
        h('input', { type: 'date', value: s.from, onchange: e => { s.from = e.target.value; } }), ' — ',
        h('input', { type: 'date', value: s.to, onchange: e => { s.to = e.target.value; } })) : null),
    h('fieldset', {}, h('legend', { text: 'Додаткові таблиці (необов’язково: немає файлу — немає слайда)' }),
      SLOTS.map(slot => h('div', { class: 'ud-slot' },
        h('strong', { text: slot.title }), ' ',
        s.names[slot.key] ? h('span', { text: s.names[slot.key] }) : h('span', { class: 'ud-muted', text: `не підключено (${slot.hint})` }),
        s.names[slot.key] ? null : h('input', { type: 'file', accept: '.xlsx', onchange: e => pick(slot.key, e.target.files[0]) }),
        s.names[slot.key] ? h('button', { type: 'button', class: 'ud-link', text: 'прибрати', onclick: () => pick(slot.key, null) }) : null,
        s.errors[slot.key] ? h('div', { class: 'ud-error', text: s.errors[slot.key] }) : null))),
    h('fieldset', {}, h('legend', { text: 'Підрозділи в аналізі (зніміть позначку, щоб виключити)' }),
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
    owner: s.owner.trim(), focus: s.focus, generatedOn: today(),
    custom: s.period === 'custom' ? { from: s.from, to: s.to } : null,
    excludeUnits: [...s.excluded], decisions: s.decisions,
  });

  function next() {
    s.message = '';
    if (s.period === 'custom' && !(s.from && s.to)) { s.message = 'Вкажіть початок і кінець періоду.'; return draw(); }
    if (s.excluded.size >= fresh.rows.length) { s.message = 'Залиште хоча б один підрозділ.'; return draw(); }
    store.set(s.owner.trim());
    s.review = reviewFor(workbook, s.files);
    if (s.review.clean) return generate();
    s.decisions = defaultDecisions(s.review.items);
    s.step = 'review'; draw();
  }

  async function generate() {
    if (s.busy) return;
    s.busy = true; s.message = ''; draw();
    try {
      const out = settingsOut();
      const { deck } = composeDeck(workbook, s.files, out.decisions && s.step === 'review' ? out : { ...out, decisions: undefined });
      const { renderDeckToBytes } = await import('./presentation-pptx.js');
      const { loadArt } = await import('./presentation-art.js');
      const saved = await saveBytes(await renderDeckToBytes(deck, { art: await loadArt() }), presentationFileName(out.owner, out.generatedOn));
      if (saved) { s.message = ''; close(); options.toast?.(`Презентацію збережено: ${saved}`); return; }
    } catch (e) { s.message = `Не вдалося створити презентацію: ${e.message || e}`; }
    s.busy = false; draw();
  }

  draw();
  dialog.showModal();
}
