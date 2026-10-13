// Вкладка «Довідник» модуля «Повітряні Сили»: вікі по засобах (літаки-носії) і боєприпасах.
// Ліворуч список зі пошуком, праворуч стаття: 3D-модель, картка з ТТХ, опис, пов’язані статті й підсумок по вашій таблиці.
// Дані статей — ref-data.js. 3D-переглядач боєприпасів і наземних засобів — ref-viewer.js (підвантажується, коли відкривають першу статтю з моделлю).
// Літаки й вертольоти показує окрема сторінка aircraft-viewer.html у кадрі: власна сцена з фазами польоту, шасі, вогнями й підвіскою.
import * as AIR_DATA from './ref-data.js';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const N0 = n => Number(n).toLocaleString('uk-UA');
const dmy = iso => (/^(\d{4})-(\d\d)-(\d\d)/.exec(iso || '') || []).slice(1).reverse().join('.');
// Групи, для яких таблиця вильотів нічого не каже: наземні машини, ворожа й чужа техніка (підсумок «У вашій базі» й блок носіїв не будуються).
const NO_TABLE = new Set(['ground', 'support', 'enemy', 'other']);
const VIEW_BUTTONS = [['three-quarter', '3/4'], ['side', 'Збоку'], ['front', 'Спереду'], ['top', 'Зверху'], ['rear', 'Ззаду']];
const RESULTS = [['hit', 'Уражено', 'var(--hit)'], ['part', 'Пошкоджено', 'var(--part)'], ['miss', 'Не уражено', 'var(--miss)'], ['unk', 'Не відомо', 'var(--unk)']];

// host — порожній контейнер вкладки. options:
//   rows()   — рядки завантаженої таблиці вильотів ({ aircraft, munition, count, kind, date });
//   media    — { thumb(id), photo(id), pair(carrierId, munitionId) } → data-URL зображення або null;
//   motion() — чи дозволено анімацію;
//   initial  — id статті, яку показати першою; onSelect(id) — виклик при виборі статті;
//   data     — інший набір статей замість ref-data.js (наприклад, артилерійські боєприпаси): { GROUPS, ENTRIES, entryById, searchEntries,
//              variantsOf, modelOf, creditOf }, відсутнє береться з ref-data.js;
//   extra(entry) — вузол, який стаття показує під розділами (дані з вашої таблиці); refresh() малює його заново;
//   searchText(entry) — додатковий текст для пошуку (наприклад, підписи рядків таблиці).
export function mount(host, options = {}) {
  const { rows = () => [], media = {}, motion = () => true, onSelect, groups = null, only = null, usage = true, related = true, extra = null, searchText = null } = options;
  const { GROUPS, ENTRIES, entryById, carriersOf, munitionsOf, searchEntries, usageFor, variantsOf, modelOf, creditOf, viewerOf, creditsOf } = { ...AIR_DATA, ...(options.data || {}) };
  const groupTitle = id => (GROUPS.find(g => g.id === id) || {}).title || '';
  // groups / only — які розділи й статті показує цей модуль (РВ бачить лише наземні засоби й ракети); usage / related — чи малювати
  // підсумок по таблиці вильотів ПС і блок «носії/боєприпаси».
  const groupList = groups ? GROUPS.filter(g => groups.includes(g.id)) : GROUPS;
  const visible = e => (!groups || groups.includes(e.group)) && (!only || only.includes(e.id));
  const state = { group: '', q: '', id: '', variant: '' };
  let viewer = null, viewerFailed = false, token = 0;

  host.classList.add('rw');
  const search = h('input', { type: 'search', class: 'rw-search', placeholder: 'Пошук: назва, тип, ключове слово…', 'aria-label': 'Пошук у довіднику' });
  const seg = h('div', { class: 'seg rw-seg', role: 'group', 'aria-label': 'Розділ довідника' });
  const list = h('div', { class: 'rw-list', role: 'list' });
  const nav = h('aside', { class: 'rw-nav', 'aria-label': 'Статті довідника' }, search, seg, list);
  const article = h('article', { class: 'rw-article', tabindex: '-1' });
  host.replaceChildren(nav, article);

  // ---------- сцена з переглядачем: одна на всі статті ----------
  const stageEl = h('div', { class: 'rw-stage', tabindex: '0', role: 'img' });
  const status = h('p', { class: 'rw-status' });
  const hint = h('p', { class: 'rw-hint', text: 'Потягніть, щоб повернути. Коліщатко наближає.' });
  stageEl.append(status, hint);
  const tools = h('div', { class: 'rw-tools' });
  const stageBox = h('div', { class: 'rw-stagebox' }, stageEl, tools);

  // dur — тривалість кнопкового переходу (мс); linear — рівномірно (для довгих покрокових анімацій).
  const slider = (id, label, onInput, texts, { dur = 1400, linear = false } = {}) => {
    const out = h('span', { class: 'rw-val', text: '100 %' });
    const input = h('input', { type: 'range', id, min: '0', max: '1', step: '0.01', value: '1', 'aria-label': label });
    const set = v => { input.value = String(v); out.textContent = Math.round(v * 100) + ' %'; };
    input.addEventListener('input', () => { cancelAnimationFrame(input._raf); set(+input.value); onInput(+input.value); });
    const go = to => {
      cancelAnimationFrame(input._raf);
      const from = +input.value;
      if (!motion() || from === to) { set(to); onInput(to); return; }
      const t0 = performance.now(), span = input._dur || dur;
      const time = linear ? span * Math.abs(to - from) : span;
      const step = now => {
        const k = Math.min((now - t0) / time, 1), e = linear ? k : k * k * (3 - 2 * k), v = from + (to - from) * e;
        set(v); onInput(v);
        if (k < 1) input._raf = requestAnimationFrame(step);
      };
      input._raf = requestAnimationFrame(step);
    };
    const name = h('label', { for: id, text: label });
    const b0 = h('button', { type: 'button', class: 'btn quiet', text: texts[0], onclick: () => go(0) });
    const b1 = h('button', { type: 'button', class: 'btn', text: texts[1], onclick: () => go(1) });
    const row = h('div', { class: 'rw-slider' }, name, input, out, b0, b1);
    const stop = () => cancelAnimationFrame(input._raf);
    const setDur = ms => { input._dur = ms; };
    return { row, set, label: name, buttons: [b0, b1], stop, setDur, input };
  };
  const wingsCtl = slider('rw-wings', 'Крила', v => viewer && viewer.setOpen(v), ['Скласти', 'Розкрити']);
  const apartCtl = slider('rw-apart', 'Блоки', v => viewer && viewer.setApart(v), ['Зібрати', 'Розкласти']);
  // Покрокова анімація з файлу моделі (наприклад, заряджання M270): повзунок прокручує кліп, кнопки програють його.
  const actionCtl = slider('rw-action', 'Анімація', v => viewer && viewer.setAction(v), ['На початок', 'Програти'], { linear: true });
  actionCtl.input.step = '0.001';
  const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ракурс' });
  for (const [v, label] of VIEW_BUTTONS) viewSeg.append(h('button', { type: 'button', 'aria-pressed': 'false', 'data-view': v, text: label, onclick: () => { if (!viewer) return; viewer.setView(v); markView(v); } }));
  const markView = v => viewSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  const autoBtn = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: 'Обертати', onclick: () => setAuto(!(viewer && viewer.auto)) });
  const setAuto = on => { if (viewer) viewer.auto = on; autoBtn.classList.toggle('on', on); autoBtn.setAttribute('aria-pressed', String(on)); };
  // «Позначки» — номери уразливих місць на моделі; кнопка з’являється лише в статтях, де такі місця описано.
  const marksBtn = h('button', { type: 'button', class: 'chip on', 'aria-pressed': 'true', text: 'Позначки', hidden: true, onclick: () => setMarks(marksBtn.getAttribute('aria-pressed') !== 'true') });
  const setMarks = on => { marksBtn.classList.toggle('on', on); marksBtn.setAttribute('aria-pressed', String(on)); if (viewer) viewer.setSpotsVisible(on); };
  tools.append(h('div', { class: 'rw-toolrow' }, viewSeg, h('div', { class: 'rw-chips' }, autoBtn, marksBtn)), wingsCtl.row, apartCtl.row, actionCtl.row);

  async function ensureViewer() {
    if (viewer || viewerFailed) return viewer;
    try {
      const mod = await import('./ref-viewer.js');
      viewer = new mod.RefViewer(stageEl, { motion: motion() });
    } catch (e) { viewerFailed = true; console.warn('Довідник: 3D недоступне', e); }
    return viewer;
  }

  async function showModel(entry, mine) {
    stageBox.hidden = false;
    stageEl.setAttribute('aria-label', entry.name + ': тривимірна модель. Стрілки повертають її, «+» і «−» змінюють масштаб.');
    status.hidden = false; status.textContent = 'Завантаження моделі…';
    const v = await ensureViewer();
    if (mine !== token) return;
    if (!v) { fallback(entry, 'WebGL недоступний, тож показано лише ілюстрацію.'); return; }
    try {
      const model = modelOf(entry, state.variant);
      const caps = await v.show(model, { onProgress: p => { if (mine === token) status.textContent = 'Завантаження моделі… ' + Math.round(p * 100) + ' %'; } });
      if (mine !== token || !caps) return;
      status.hidden = true;
      const action = caps.action && model.action;
      wingsCtl.row.hidden = !caps.winged; apartCtl.row.hidden = !caps.modular; actionCtl.row.hidden = !action;
      wingsCtl.label.textContent = model.wingsLabel || 'Крила';
      wingsCtl.set(1); apartCtl.set(0); actionCtl.stop(); actionCtl.set(0);
      if (action) {
        actionCtl.label.textContent = action.label;
        actionCtl.input.setAttribute('aria-label', action.label);
        actionCtl.buttons.forEach((b, i) => { b.textContent = action.ends[i]; });
        actionCtl.setDur((action.seconds || 12) * 1000);
      }
      if (action) hint.textContent = action.hint;
      else if (caps.modular) hint.textContent = 'Потягніть, щоб повернути. Повзунок «Блоки» розкладає виріб на частини.';
      else hint.textContent = 'Потягніть, щоб повернути. Коліщатко наближає.';
      markView('three-quarter');
      setAuto(motion());
      const weak = entry.weak || [];
      marksBtn.hidden = !weak.length;
      v.setSpots(weak.map(w => ({ title: w.t, p: w.p })), onSpot);
      if (weak.length) setMarks(true);
    } catch (e) {
      console.warn('Довідник: модель не завантажилась', e);
      if (mine === token) fallback(entry, 'Не вдалося завантажити модель.');
    }
  }

  // Вибір позначки на моделі (або зняття вибору, idx = -1) підсвічує пункт списку «Уразливі місця»; обертання зупиняється.
  function onSpot(idx, fromMarker) {
    setAuto(false);
    article.querySelectorAll('.rw-weak').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.spot === idx)));
    const on = idx >= 0 && article.querySelector('.rw-weak[data-spot="' + idx + '"]');
    if (on && fromMarker) on.scrollIntoView({ block: 'nearest', behavior: motion() ? 'smooth' : 'auto' });
  }
  async function spotFromList(i) {
    if (state.mode !== 'weak') await setMode('weak');
    if (!viewer) return;
    viewer.pickSpot(i);
    if (window.innerWidth <= 860) stageBox.scrollIntoView({ block: 'center', behavior: motion() ? 'smooth' : 'auto' });
  }

  // Стаття з інтерактивним переглядачем і моделлю для позначок має два вигляди; другий вантажиться лише на вимогу.
  let airBox = null, modeBar = null;
  async function setMode(m) {
    const entry = entryById(state.id);
    if (!entry || !modeBar || state.mode === m) return;
    state.mode = m;
    modeBar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    if (airBox) airBox.hidden = m === 'weak';
    if (m === 'weak') {
      stageBox.hidden = false;
      if (state.weakFor !== entry.id) { state.weakFor = entry.id; await showModel(entry, token); }
    } else { stageBox.hidden = true; setAuto(false); }
  }

  function fallback(entry, why) {
    stageBox.hidden = true;
    const photo = media.photo && media.photo(entry.id);
    slot.replaceChildren(h('p', { class: 'rw-note', text: why }), photo ? h('img', { class: 'rw-photo', src: photo, alt: entry.name }) : null);
  }

  // ---------- літаки: сторінка переглядача в кадрі ----------
  // Кожна стаття літака отримує свіжий кадр: сторінка сама завантажує потрібну модель, а попередній кадр разом зі сценою звільняється.
  let aircraftFrame = null;
  function aircraftBox(entry) {
    const frame = h('iframe', { class: 'rw-air-frame', src: './aircraft-viewer.html?embed=1&a=' + encodeURIComponent(viewerOf(entry)),
      title: entry.name + ': інтерактивна тривимірна модель', allowfullscreen: true });
    frame.addEventListener('load', () => {
      // Сторінка того ж походження: підганяємо висоту кадру під вміст, щоб у ньому не було власної прокрутки.
      try {
        const doc = frame.contentDocument, fig = doc && doc.querySelector('.fig');
        if (!fig || typeof ResizeObserver === 'undefined') return;
        const fit = () => { frame.style.height = Math.ceil(fig.getBoundingClientRect().height) + 'px'; };
        fit(); new ResizeObserver(fit).observe(fig);
      } catch (e) { /* лишається висота за замовчуванням */ }
    });
    aircraftFrame = frame;
    return h('div', { class: 'rw-air' }, frame,
      h('p', { class: 'rw-fine', text: 'Фази, системи, вогні й озброєння перемикаються кнопками під сценою або клавішами, коли сцена в фокусі (клацніть по ній). Підвіска складена для моделі, це не заводська схема.' }));
  }

  // ---------- стаття ----------
  const slot = h('div', { class: 'rw-slot' });
  const usageEl = h('section', { class: 'rw-sec rw-usage' });
  const extraEl = h('section', { class: 'rw-sec rw-extra' });
  function renderExtra(entry) {
    const node = extra ? extra(entry) : null;
    extraEl.hidden = !node;
    extraEl.replaceChildren(...(node ? [node] : []));
  }

  function relatedBlock(entry) {
    if (!related || NO_TABLE.has(entry.group)) return null;
    const ids = entry.group === 'aircraft' ? munitionsOf(entry.id) : carriersOf(entry.id);
    if (!ids.length) return null;
    const title = entry.group === 'aircraft' ? 'Боєприпаси, показані з цим носієм' : 'Носії, показані з цим боєприпасом';
    return h('section', { class: 'rw-sec' }, h('h3', { text: title }),
      h('div', { class: 'rw-rel' }, ids.map(id => {
        const other = entryById(id); if (!other) return null;
        const a = entry.group === 'aircraft' ? entry.id : id, m = entry.group === 'aircraft' ? id : entry.id;
        const img = media.pair && media.pair(a, m);
        return h('button', { type: 'button', class: 'rw-relcard', onclick: () => select(id, true) },
          img ? h('img', { src: img, alt: '', draggable: 'false' }) : null, h('span', { text: other.name }));
      })),
      h('p', { class: 'rw-fine', text: 'Підвіска за ілюстраціями модуля. Що літало насправді, показує розділ «У вашій базі».' }));
  }

  function renderUsage(entry) {
    // Підсумок будується з таблиці вильотів ПС: для наземних засобів його немає.
    usageEl.hidden = !usage || NO_TABLE.has(entry.group);
    if (usageEl.hidden) { usageEl.replaceChildren(); return; }
    usageEl.replaceChildren(h('h3', { text: 'У вашій базі' }));
    const data = rows();
    if (!data.length) { usageEl.append(h('p', { class: 'rw-fine', text: 'Таблицю ще не завантажено. Відкрийте її, і тут з’явиться підсумок по цьому ' + (entry.group === 'aircraft' ? 'засобу.' : 'боєприпасу.') })); return; }
    const u = usageFor(data, entry);
    if (!u.flights) { usageEl.append(h('p', { class: 'rw-fine', text: 'У завантаженій таблиці немає записів за цим ' + (entry.group === 'aircraft' ? 'засобом.' : 'боєприпасом.') })); return; }
    const tile = (label, value) => h('div', { class: 'rw-tile' + (value.length > 12 ? ' long' : '') }, h('b', { text: value }), h('span', { text: label }));
    const total = u.flights;
    const bar = h('div', { class: 'rw-bar', role: 'img', 'aria-label': RESULTS.map(([k, l]) => l + ': ' + u.results[k]).join(', ') },
      RESULTS.filter(([k]) => u.results[k]).map(([k, l, c]) => h('i', { style: `flex:${u.results[k]};background:${c}`, title: l + ': ' + u.results[k] })));
    const legend = h('p', { class: 'rw-legend' }, RESULTS.filter(([k]) => u.results[k]).map(([k, l, c]) => h('span', {}, h('i', { style: 'background:' + c }), l + ' ' + Math.round(u.results[k] / total * 100) + '%')));
    const partnerTitle = entry.group === 'aircraft' ? 'Найчастіші боєприпаси' : 'Найчастіші носії';
    usageEl.append(
      h('div', { class: 'rw-tiles' }, tile('вильотів', N0(u.flights)), tile('використано БП', N0(u.used)), tile('період', u.from ? (u.from === u.to ? dmy(u.from) : dmy(u.from) + ' – ' + dmy(u.to)) : '—')),
      bar, legend,
      u.partners.length ? h('div', { class: 'rw-partners' }, h('span', { class: 'rw-fine', text: partnerTitle + ':' }), u.partners.map(p => {
        const other = p.id && entryById(p.id), label = (other ? other.name : p.label) + ' · ' + N0(p.n);
        return other ? h('button', { type: 'button', class: 'chip', text: label, onclick: () => select(p.id, true) }) : h('span', { class: 'chip', text: label });
      })) : null);
  }

  // Підпис про автора моделі: залежить від вибраного варіанта моделі (розмальовки чи модифікації).
  function creditNode(entry) {
    const credit = creditOf(entry, state.variant);
    if (!credit) return null;
    if (credit.generated) return h('p', { class: 'rw-credit', text: credit.note });
    return h('p', { class: 'rw-credit' }, 'Модель: «' + credit.title + '», автор ',
      h('a', { href: credit.authorUrl, target: '_blank', rel: 'noopener noreferrer', text: credit.author }),
      ', ліцензія ', h('a', { href: credit.licenseUrl, target: '_blank', rel: 'noopener noreferrer', text: credit.license }),
      '. Джерело: ', h('span', { class: 'rw-src', text: credit.url.replace(/^https?:\/\//, '') }), '. Файл стиснуто для застосунку, форму моделі не змінено.' + (credit.note ? ' ' + credit.note : ''));
  }

  // Літак у переглядачі складається з кількох моделей (літак, шасі, боєприпаси, ландшафт): показуємо автора й ліцензію кожної.
  function creditsNode(entry) {
    const list = creditsOf(entry);
    if (!list.length) return null;
    return h('div', { class: 'rw-credit' }, h('p', { class: 'rw-credit-head', text: 'Моделі в переглядачі. Файли стиснуто для застосунку.' }),
      h('ul', {}, list.map(c => h('li', {},
        '«' + c.title + '», автор ', h('a', { href: c.authorUrl, target: '_blank', rel: 'noopener noreferrer', text: c.author }),
        ', ліцензія ', h('a', { href: c.licenseUrl, target: '_blank', rel: 'noopener noreferrer', text: c.license }),
        c.url ? h('span', {}, '. Джерело: ', h('span', { class: 'rw-src', text: c.url.replace(/^https?:\/\//, '') })) : null,
        '.' + (c.note ? ' ' + c.note : '')))));
  }

  // Уразливі місця: нумерований список, пов’язаний із позначками на моделі (якщо модель є, пункти — кнопки).
  function weakBlock(entry) {
    const weak = entry.weak || [];
    if (!weak.length) return null;
    const live = !!entry.model;
    return h('section', { class: 'rw-sec rw-weaksec' }, h('h3', { text: 'Уразливі місця' }),
      live ? h('p', { class: 'rw-fine', text: 'Номер на моделі й пункт списку пов’язані: натисніть, і зона підсвітиться, а модель повернеться до неї.' }) : null,
      h('ol', { class: 'rw-weaklist' }, weak.map((w, i) => h('li', {}, h(live ? 'button' : 'div', { class: 'rw-weak', type: live ? 'button' : null, 'data-spot': String(i), 'aria-pressed': live ? 'false' : null, onclick: live ? () => spotFromList(i) : null },
        h('b', { text: String(i + 1), 'aria-hidden': 'true' }), h('strong', { text: w.t }), h('span', { text: w.d }))))),
      h('p', { class: 'rw-fine', text: 'Відкритий навчальний огляд для розпізнавання, а не бойова інструкція.' + (live ? ' Номери на моделі показують зону приблизно.' : '') }));
  }

  function sourcesNode(entry) {
    if (!entry.sources || !entry.sources.length) return null;
    return h('p', { class: 'rw-fine rw-sources' }, 'Джерела: ', entry.sources.map((src, i) => [i ? ', ' : null,
      h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', text: src.title })]));
  }

  function pickVariant(entry, id) {
    if (state.variant === id || state.id !== entry.id) return;
    state.variant = id;
    article.querySelectorAll('.rw-variants button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.variant === id)));
    const box = article.querySelector('.rw-creditbox');
    if (box) box.replaceChildren(creditNode(entry));
    showModel(entry, ++token);
  }

  function renderArticle(entry) {
    const photo = media.photo && media.photo(entry.id);
    const info = h('aside', { class: 'rw-info', 'aria-label': 'Основні дані' },
      h('h3', { text: entry.name }), h('p', { class: 'rw-role', text: entry.role }),
      photo && !entry.model ? h('img', { class: 'rw-photo', src: photo, alt: entry.name }) : null,
      h('dl', { class: 'rw-facts' }, entry.facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))),
      entry.note ? h('p', { class: 'rw-fine', text: entry.note }) : null);
    const variants = variantsOf(entry);
    const activeVariant = variants.find(v => v.id === state.variant) || variants[0];
    const variantBar = variants.length ? h('div', { class: 'seg rw-variants', role: 'group', 'aria-label': 'Модель' },
      variants.map(v => h('button', { type: 'button', 'data-variant': v.id, 'aria-pressed': String(v === activeVariant), text: v.label, onclick: () => pickVariant(entry, v.id) }))) : null;
    const creditBox = h('div', { class: 'rw-creditbox' }, viewerOf(entry) ? creditsNode(entry) : creditNode(entry));
    const both = !!(viewerOf(entry) && entry.model);
    state.mode = both ? 'live' : 'weak';
    airBox = viewerOf(entry) ? aircraftBox(entry) : null;
    modeBar = both ? h('div', { class: 'seg rw-modes', role: 'group', 'aria-label': 'Вигляд моделі' },
      [['live', 'Інтерактивна модель'], ['weak', 'Уразливі місця']].map(([m, label]) =>
        h('button', { type: 'button', 'data-mode': m, 'aria-pressed': String(m === 'live'), text: label, onclick: () => setMode(m) }))) : null;
    const main = h('div', { class: 'rw-main' },
      variantBar,
      modeBar,
      airBox,
      entry.model ? stageBox : null,
      slot,
      h('p', { class: 'rw-summary', text: entry.summary }),
      entry.dual ? h('p', { class: 'rw-warn' }, h('b', { text: 'Увага. ' }), entry.dual) : null,
      weakBlock(entry),
      entry.sections.map(s => h('section', { class: 'rw-sec' }, h('h3', { text: s.title }),
        s.text ? h('p', { text: s.text }) : null, s.list ? h('ul', {}, s.list.map(t => h('li', { text: t }))) : null)),
      sourcesNode(entry),
      relatedBlock(entry), usageEl, extraEl,
      creditBox);
    article.replaceChildren(
      h('header', { class: 'rw-head' }, h('p', { class: 'rw-eyebrow', text: groupTitle(entry.group) + ' · ' + entry.origin }),
        h('h2', { text: entry.name }, entry.status ? h('span', { class: 'rw-badge', text: entry.status }) : null, entry.dual ? h('span', { class: 'rw-badge rw-both', title: 'Тип є і в ЗСУ', text: 'Обидві сторони' }) : null), h('p', { class: 'rw-alias', text: entry.alias })),
      h('div', { class: 'rw-body' }, main, info));
    slot.replaceChildren();
    renderUsage(entry);
    renderExtra(entry);
  }

  // ---------- список ----------
  function renderNav() {
    seg.classList.toggle('rw-seg-wrap', groupList.length > 3);
    seg.replaceChildren(...[['', 'Усе'], ...groupList.map(g => [g.id, g.tab || g.title])].map(([id, label]) =>
      h('button', { type: 'button', text: label, 'aria-pressed': String(state.group === id), onclick: () => { state.group = id; renderNav(); } })));
    const found = searchEntries(state.q, state.group, searchText).filter(visible);
    list.replaceChildren();
    for (const g of groupList) {
      const items = found.filter(e => e.group === g.id);
      if (!items.length) continue;
      list.append(h('p', { class: 'rw-grp', role: 'presentation', text: g.title + ' · ' + items.length }));
      for (const e of items) {
        const thumb = media.thumb && media.thumb(e.id);
        list.append(h('button', { type: 'button', class: 'rw-item', role: 'listitem', 'data-id': e.id, 'aria-current': String(e.id === state.id),
          onclick: () => select(e.id, true) },
          thumb ? h('img', { src: thumb, alt: '', draggable: 'false' }) : h('span', { class: 'rw-mono', 'aria-hidden': 'true', text: e.short || e.name }),
          h('span', { class: 'rw-it' }, h('b', { text: e.name }), h('small', { text: (e.status ? e.status + ' · ' : '') + (e.dual ? 'Є і в ЗСУ · ' : '') + e.role })),
          e.model || viewerOf(e) ? h('span', { class: 'rw-3d', text: '3D', title: 'Є тривимірна модель' }) : null));
      }
    }
    if (!found.length) list.append(h('p', { class: 'rw-fine rw-empty', text: 'Нічого не знайдено. Спробуйте іншу назву.' }));
  }
  search.addEventListener('input', () => { state.q = search.value; renderNav(); });
  list.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...list.querySelectorAll('.rw-item')], i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); items[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), items.length - 1)].focus();
  });

  function select(id, user) {
    const asked = entryById(id);
    const entry = asked && visible(asked) ? asked : ENTRIES.find(visible) || ENTRIES[0];
    if (state.id !== entry.id) state.variant = '';
    state.id = entry.id;
    const mine = ++token;
    renderNav();
    renderArticle(entry);
    state.weakFor = '';
    if (entry.model && !viewerOf(entry)) showModel(entry, mine);
    else stageBox.hidden = true;
    if (onSelect) onSelect(entry.id);
    if (user && article.getBoundingClientRect().top < 0) article.scrollIntoView({ block: 'start', behavior: motion() ? 'smooth' : 'auto' });
  }

  renderNav();
  select(options.initial);
  return {
    select: id => select(id, false),
    refresh: () => { const e = entryById(state.id); if (e) { renderUsage(e); renderExtra(e); } },
    get id() { return state.id; },
    dispose: () => { token++; if (viewer) viewer.dispose(); viewer = null; if (aircraftFrame) aircraftFrame.src = 'about:blank'; aircraftFrame = null; },
  };
}

if (typeof window !== 'undefined') window.RefWiki = { mount };
