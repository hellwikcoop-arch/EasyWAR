// Вкладка «Довідник» модуля «Повітряні Сили»: вікі по засобах (літаки-носії) і боєприпасах.
// Ліворуч список зі пошуком, праворуч стаття: 3D-модель, картка з ТТХ, опис, пов’язані статті й підсумок по вашій таблиці.
// Дані статей — ref-data.js, 3D-переглядач — ref-viewer.js (підвантажується, коли відкривають першу статтю з моделлю).
import { GROUPS, ENTRIES, entryById, carriersOf, munitionsOf, searchEntries, usageFor } from './ref-data.js';

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
const groupTitle = id => (GROUPS.find(g => g.id === id) || {}).title || '';
const VIEW_BUTTONS = [['three-quarter', '3/4'], ['side', 'Збоку'], ['front', 'Спереду'], ['top', 'Зверху'], ['rear', 'Ззаду']];
const RESULTS = [['hit', 'Уражено', 'var(--hit)'], ['part', 'Пошкоджено', 'var(--part)'], ['miss', 'Не уражено', 'var(--miss)'], ['unk', 'Не відомо', 'var(--unk)']];

// host — порожній контейнер вкладки. options:
//   rows()   — рядки завантаженої таблиці вильотів ({ aircraft, munition, count, kind, date });
//   media    — { thumb(id), photo(id), pair(carrierId, munitionId) } → data-URL зображення або null;
//   motion() — чи дозволено анімацію;
//   initial  — id статті, яку показати першою; onSelect(id) — виклик при виборі статті.
export function mount(host, options = {}) {
  const { rows = () => [], media = {}, motion = () => true, onSelect } = options;
  const state = { group: '', q: '', id: '' };
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

  const slider = (id, label, onInput, texts) => {
    const out = h('span', { class: 'rw-val', text: '100 %' });
    const input = h('input', { type: 'range', id, min: '0', max: '1', step: '0.01', value: '1', 'aria-label': label });
    const set = v => { input.value = String(v); out.textContent = Math.round(v * 100) + ' %'; };
    input.addEventListener('input', () => { cancelAnimationFrame(input._raf); set(+input.value); onInput(+input.value); });
    const go = to => {
      cancelAnimationFrame(input._raf);
      const from = +input.value;
      if (!motion() || from === to) { set(to); onInput(to); return; }
      const t0 = performance.now(), dur = 1400;
      const step = now => {
        const k = Math.min((now - t0) / dur, 1), e = k * k * (3 - 2 * k), v = from + (to - from) * e;
        set(v); onInput(v);
        if (k < 1) input._raf = requestAnimationFrame(step);
      };
      input._raf = requestAnimationFrame(step);
    };
    const name = h('label', { for: id, text: label });
    const row = h('div', { class: 'rw-slider' },
      name, input, out,
      h('button', { type: 'button', class: 'btn quiet', text: texts[0], onclick: () => go(0) }),
      h('button', { type: 'button', class: 'btn', text: texts[1], onclick: () => go(1) }));
    return { row, set, label: name };
  };
  const wingsCtl = slider('rw-wings', 'Крила', v => viewer && viewer.setOpen(v), ['Скласти', 'Розкрити']);
  const apartCtl = slider('rw-apart', 'Блоки', v => viewer && viewer.setApart(v), ['Зібрати', 'Розкласти']);
  const viewSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ракурс' });
  for (const [v, label] of VIEW_BUTTONS) viewSeg.append(h('button', { type: 'button', 'aria-pressed': 'false', 'data-view': v, text: label, onclick: () => { if (!viewer) return; viewer.setView(v); markView(v); } }));
  const markView = v => viewSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  const autoBtn = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: 'Обертати', onclick: () => setAuto(!(viewer && viewer.auto)) });
  const setAuto = on => { if (viewer) viewer.auto = on; autoBtn.classList.toggle('on', on); autoBtn.setAttribute('aria-pressed', String(on)); };
  tools.append(h('div', { class: 'rw-toolrow' }, viewSeg, autoBtn), wingsCtl.row, apartCtl.row);

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
      const caps = await v.show(entry.model, { onProgress: p => { if (mine === token) status.textContent = 'Завантаження моделі… ' + Math.round(p * 100) + ' %'; } });
      if (mine !== token || !caps) return;
      status.hidden = true;
      wingsCtl.row.hidden = !caps.winged; apartCtl.row.hidden = !caps.modular;
      wingsCtl.label.textContent = entry.model.wingsLabel || 'Крила';
      wingsCtl.set(1); apartCtl.set(0);
      if (caps.modular) hint.textContent = 'Потягніть, щоб повернути. Повзунок «Блоки» розкладає бомбу.';
      else hint.textContent = 'Потягніть, щоб повернути. Коліщатко наближає.';
      markView('three-quarter');
      setAuto(motion());
    } catch (e) {
      console.warn('Довідник: модель не завантажилась', e);
      if (mine === token) fallback(entry, 'Не вдалося завантажити модель.');
    }
  }

  function fallback(entry, why) {
    stageBox.hidden = true;
    const photo = media.photo && media.photo(entry.id);
    slot.replaceChildren(h('p', { class: 'rw-note', text: why }), photo ? h('img', { class: 'rw-photo', src: photo, alt: entry.name }) : null);
  }

  // ---------- стаття ----------
  const slot = h('div', { class: 'rw-slot' });
  const usageEl = h('section', { class: 'rw-sec rw-usage' });

  function relatedBlock(entry) {
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

  function renderArticle(entry) {
    const photo = media.photo && media.photo(entry.id);
    const info = h('aside', { class: 'rw-info', 'aria-label': 'Основні дані' },
      h('h3', { text: entry.name }), h('p', { class: 'rw-role', text: entry.role }),
      photo && !entry.model ? h('img', { class: 'rw-photo', src: photo, alt: entry.name }) : null,
      h('dl', { class: 'rw-facts' }, entry.facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))),
      entry.note ? h('p', { class: 'rw-fine', text: entry.note }) : null);
    const main = h('div', { class: 'rw-main' },
      entry.model ? stageBox : null,
      slot,
      h('p', { class: 'rw-summary', text: entry.summary }),
      entry.sections.map(s => h('section', { class: 'rw-sec' }, h('h3', { text: s.title }),
        s.text ? h('p', { text: s.text }) : null, s.list ? h('ul', {}, s.list.map(t => h('li', { text: t }))) : null)),
      relatedBlock(entry), usageEl,
      entry.credit && entry.credit.generated ? h('p', { class: 'rw-credit', text: entry.credit.note }) : null,
      entry.credit && !entry.credit.generated ? h('p', { class: 'rw-credit' }, 'Модель: «' + entry.credit.title + '», автор ',
        h('a', { href: entry.credit.authorUrl, target: '_blank', rel: 'noopener noreferrer', text: entry.credit.author }),
        ', ліцензія ', h('a', { href: entry.credit.licenseUrl, target: '_blank', rel: 'noopener noreferrer', text: entry.credit.license }),
        '. Джерело: ', h('span', { class: 'rw-src', text: entry.credit.url.replace(/^https?:\/\//, '') }), '. Файл стиснуто для застосунку, форму моделі не змінено.' + (entry.credit.note ? ' ' + entry.credit.note : '')) : null);
    article.replaceChildren(
      h('header', { class: 'rw-head' }, h('p', { class: 'rw-eyebrow', text: groupTitle(entry.group) + ' · ' + entry.origin }),
        h('h2', { text: entry.name }, entry.status ? h('span', { class: 'rw-badge', text: entry.status }) : null), h('p', { class: 'rw-alias', text: entry.alias })),
      h('div', { class: 'rw-body' }, main, info));
    slot.replaceChildren();
    renderUsage(entry);
  }

  // ---------- список ----------
  function renderNav() {
    seg.replaceChildren(...[['', 'Усе'], ...GROUPS.map(g => [g.id, g.title])].map(([id, label]) =>
      h('button', { type: 'button', text: label, 'aria-pressed': String(state.group === id), onclick: () => { state.group = id; renderNav(); } })));
    const found = searchEntries(state.q, state.group);
    list.replaceChildren();
    for (const g of GROUPS) {
      const items = found.filter(e => e.group === g.id);
      if (!items.length) continue;
      list.append(h('p', { class: 'rw-grp', role: 'presentation', text: g.title + ' · ' + items.length }));
      for (const e of items) {
        const thumb = media.thumb && media.thumb(e.id);
        list.append(h('button', { type: 'button', class: 'rw-item', role: 'listitem', 'data-id': e.id, 'aria-current': String(e.id === state.id),
          onclick: () => select(e.id, true) },
          thumb ? h('img', { src: thumb, alt: '', draggable: 'false' }) : h('span', { class: 'rw-mono', 'aria-hidden': 'true', text: e.short || e.name }),
          h('span', { class: 'rw-it' }, h('b', { text: e.name }), h('small', { text: e.status ? e.status + ' · ' + e.role : e.role })),
          e.model ? h('span', { class: 'rw-3d', text: '3D', title: 'Є тривимірна модель' }) : null));
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
    const entry = entryById(id) || ENTRIES[0];
    state.id = entry.id;
    const mine = ++token;
    renderNav();
    renderArticle(entry);
    if (entry.model) showModel(entry, mine);
    else stageBox.hidden = true;
    if (onSelect) onSelect(entry.id);
    if (user && article.getBoundingClientRect().top < 0) article.scrollIntoView({ block: 'start', behavior: motion() ? 'smooth' : 'auto' });
  }

  renderNav();
  select(options.initial);
  return {
    select: id => select(id, false),
    refresh: () => { const e = entryById(state.id); if (e) renderUsage(e); },
    get id() { return state.id; },
    dispose: () => { token++; if (viewer) viewer.dispose(); viewer = null; },
  };
}

if (typeof window !== 'undefined') window.RefWiki = { mount };
