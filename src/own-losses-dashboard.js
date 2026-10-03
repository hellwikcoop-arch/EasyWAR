/* Вкладка «Наші втрати» дашбордів УДШВ і ПВК: окрема таблиця «НАШІ ВТРАТИ» (журнал подій).
   Файл читається лише для перегляду й не змінюється. Джерело одне з двох:
   - таблиця, прив'язана до плитки командування в профілі: лончер передає її через window.EWOwnLosses,
     вкладка перечитує її кнопкою «Оновити з файлу», копія в пам'яті не робиться;
   - файл, який обрано на самій вкладці (телефон, профіль без прив'язки): його копія лишається в пам'яті
     застосунку, щоб вкладка відкривалась одразу; «Прибрати» її видаляє. */
import { parseOwnLosses } from './own-losses-core.js';
import { OWN_PRESETS, OWN_SERIES_KEYS, createOwnLossesModel } from './own-losses-dashboard-core.js';
import { shortDate } from './presentation-format.js';

const number = value => Math.round(Number(value) || 0).toLocaleString('uk-UA');
const decimal = value => (Number(value) || 0).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const dateLabel = value => (value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—');
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const SERIES_COLORS = { k200: 'var(--ol-red)', k300: 'var(--ol-amber)', k500: 'var(--ol-violet)' };
const TONES = { red: 'var(--ol-red)', amber: 'var(--ol-amber)', violet: 'var(--ol-violet)', blue: 'var(--ol-blue)', green: 'var(--ol-green)' };
const EVENTS_PAGE = 100;

const scopes = new Map();
const scopeState = scope => {
  if (!scopes.has(scope)) scopes.set(scope, { own: null, fileName: '', savedAt: '', error: '', busy: false, restored: false, preset: 'month', from: '', to: '', units: [], eventLimit: EVENTS_PAGE, remembered: false, bound: null, rerender: null, readSheets: null, wantTab: false });
  return scopes.get(scope);
};

function h(tag, attrs = {}, ...children) {
  const svg = tag.startsWith('svg:');
  const node = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.setAttribute('class', value);
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') for (const [name, css] of Object.entries(value)) node.style.setProperty(name, css);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ------------------------- пам'ять застосунку ------------------------- */
// Та сама база, що й у модулів (`avtovvid`, сховище `kv`), але окремий ключ на кожне командування.
const idb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('avtovvid', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('kv');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const storeKey = scope => `own-losses-${scope}`;
async function idbRun(mode, action) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const request = action(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
const remember = (scope, record) => idbRun('readwrite', store => store.put(record, storeKey(scope))).catch(() => {});
const forget = scope => idbRun('readwrite', store => store.delete(storeKey(scope))).catch(() => {});
const recall = scope => idbRun('readonly', store => store.get(storeKey(scope))).catch(() => null);

const errorText = error => (error && error.code === 'NOT_OWN_LOSSES' ? error.message : `Не вдалося прочитати файл: ${error?.message || error}`);

// `keep`: оновлення того самого файлу зберігає вибраний період і підрозділ, якщо вони ще в таблиці.
async function openBytes(scope, bytes, name, options, { keep = false } = {}) {
  const state = scopeState(scope);
  state.own = parseOwnLosses(await options.readSheets(bytes), name);
  state.fileName = name;
  state.units = keep ? state.units.filter(unit => state.own.units.includes(unit)) : [];
  state.eventLimit = EVENTS_PAGE;
  if (keep && state.preset === 'custom') return;
  const dates = state.own.records.map(record => record.date).sort();
  state.from = dates[0] || '';
  state.to = dates[dates.length - 1] || '';
}

async function pickFile(scope, file, options) {
  const state = scopeState(scope);
  if (!file) return;
  state.error = '';
  state.busy = true;
  options.rerender();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openBytes(scope, bytes, file.name, options);
    state.savedAt = new Date().toISOString();
    state.remembered = true;
    await remember(scope, { name: file.name, bytes, savedAt: state.savedAt });
  } catch (error) { state.error = errorText(error); }
  state.busy = false;
  options.rerender();
}

async function restore(scope, options) {
  const state = scopeState(scope);
  state.restored = true;
  if (state.bound || !options.readSheets || !window.indexedDB) return;
  state.busy = true;
  try {
    const saved = await recall(scope);
    if (saved && saved.bytes && !state.bound) {
      await openBytes(scope, saved.bytes, saved.name || 'НАШІ ВТРАТИ.xlsx', options);
      state.savedAt = saved.savedAt || '';
      state.remembered = true;
    }
  } catch (error) { state.error = `Збережену таблицю не вдалося відкрити: ${errorText(error)}`; }
  state.busy = false;
  options.rerender();
}

function clear(scope, options) {
  const state = scopeState(scope);
  Object.assign(state, { own: null, fileName: '', savedAt: '', error: '', units: [], remembered: false, eventLimit: EVENTS_PAGE });
  forget(scope);
  options.rerender();
}

/* ------------------------------ графіки ------------------------------ */
function sparkline(series, color) {
  const width = 160, height = 38;
  if (series.length < 2) return h('div', { class: 'ol-spark' });
  const max = Math.max(1, ...series.map(item => item.value));
  const points = series.map((item, index) => `${(index / (series.length - 1) * width).toFixed(1)},${(height - 3 - item.value / max * (height - 6)).toFixed(1)}`).join(' ');
  return h('svg:svg', { class: 'ol-spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    h('svg:polyline', { points, fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
}

function bucketLabel(item, bucket) {
  if (bucket === 'day') return shortDate(item.from);
  if (bucket === 'week') return `${shortDate(item.from)}–${shortDate(item.to)}`;
  return `${MONTHS[+item.from.slice(5, 7) - 1]} ${item.from.slice(0, 4)}`;
}

function stackedBars(series, bucket) {
  const width = 960, height = 250, left = 44, bottom = 34, top = 12;
  const keys = OWN_SERIES_KEYS;
  const totals = series.map(item => keys.reduce((sum, key) => sum + (item.value[key.key] || 0), 0));
  const raw = Math.max(1, ...totals);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const max = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(value => value >= raw) || raw;
  const step = (width - left - 8) / Math.max(1, series.length);
  const bar = Math.max(2, Math.min(38, step * 0.72));
  const y = value => height - bottom - value / max * (height - bottom - top);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(factor => h('svg:g', {},
    h('svg:line', { x1: left, x2: width, y1: y(max * factor), y2: y(max * factor), class: 'ol-grid' }),
    h('svg:text', { x: left - 6, y: y(max * factor) + 4, 'text-anchor': 'end', class: 'ol-axis', text: decimal(max * factor) })));
  const labelEvery = Math.ceil(series.length / (bucket === 'week' ? 9 : 16));
  const bars = series.map((item, index) => {
    let acc = 0;
    const x = left + index * step + (step - bar) / 2;
    return h('svg:g', {},
      h('svg:title', { text: `${bucketLabel(item, bucket)}: ${keys.map(key => `${key.label} — ${number(item.value[key.key] || 0)}`).join(', ')}` }),
      keys.map(key => {
        const value = item.value[key.key] || 0;
        if (!value) return null;
        const y1 = y(acc + value), y0 = y(acc);
        acc += value;
        return h('svg:rect', { x, y: y1, width: bar, height: Math.max(1, y0 - y1), rx: 2, fill: SERIES_COLORS[key.key] });
      }),
      index % labelEvery === 0 ? h('svg:text', { x: x + bar / 2, y: height - bottom + 16, 'text-anchor': 'middle', class: 'ol-axis', text: bucketLabel(item, bucket) }) : null);
  });
  return h('div', { class: 'ol-chart' },
    h('svg:svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Втрати о/с за період' }, grid, bars),
    h('div', { class: 'ol-legend' }, keys.map(key => h('span', {}, h('i', { style: { background: SERIES_COLORS[key.key] } }), key.label))));
}

function rankBars(items, color, limit = 10) {
  const shown = items.slice(0, limit);
  if (!shown.length) return h('p', { class: 'ol-empty', text: 'За обраний період у таблиці нічого не вказано.' });
  const max = Math.max(1, ...shown.map(item => item.total));
  const sum = items.reduce((total, item) => total + item.total, 0);
  return h('div', { class: 'ol-rank' }, shown.map(item => h('div', { class: 'ol-rank-row', title: `${item.name}: ${number(item.total)}` },
    h('span', { class: 'ol-rank-name', text: item.name }),
    h('i', {}, h('b', { style: { width: `${item.total / max * 100}%`, background: color } })),
    h('strong', { text: number(item.total) }),
    h('small', { text: sum ? `${decimal(item.total / sum * 100)}%` : '' }))),
  items.length > limit ? h('p', { class: 'ol-more', text: `Ще ${items.length - limit} позицій.` }) : null);
}

/* ------------------------------ блоки ------------------------------ */
function section(title, meta, ...body) {
  return h('section', { class: 'ol-card' }, h('header', {}, h('h3', { text: title }), meta ? h('span', { text: meta }) : null), ...body);
}

function kpiCard(kpi) {
  const tone = TONES[kpi.tone] || 'var(--ol-blue)';
  let delta = 'немає попереднього періоду';
  let cls = '';
  if (kpi.delta != null) {
    const sign = kpi.delta > 0 ? '▲ +' : kpi.delta < 0 ? '▼ ' : '● ';
    delta = `${sign}${number(kpi.delta)}${kpi.deltaPercent != null ? ` (${kpi.deltaPercent > 0 ? '+' : ''}${decimal(kpi.deltaPercent)}%)` : ''} до попер.`;
    cls = kpi.delta > 0 ? ' up' : kpi.delta < 0 ? ' down' : '';
  }
  return h('article', { class: 'ol-kpi', style: { '--tone': tone } },
    h('span', { class: 'ol-kpi-label', text: kpi.label }),
    h('strong', { text: number(kpi.total) }),
    h('span', { class: `ol-delta${cls}`, text: delta }),
    sparkline(kpi.series, tone),
    h('small', { text: kpi.hint }));
}

function unitsTable(model, state, options) {
  if (!model.units.length) return h('p', { class: 'ol-empty', text: 'За обраний період подій немає.' });
  const total = key => model.units.reduce((sum, row) => sum + row[key], 0);
  const cols = [['k200', '200'], ['k300', '300'], ['k500', '500'], ['personnel', 'Разом о/с'], ['destroyed', 'Арт. знищ.'], ['damaged', 'Арт. пошк.'], ['events', 'Подій']];
  const max = Object.fromEntries(cols.map(([key]) => [key, Math.max(1, ...model.units.map(row => row[key]))]));
  return h('div', { class: 'ol-scroll' }, h('table', { class: 'ol-table' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Підрозділ' }), cols.map(([, label]) => h('th', { text: label })))),
    h('tbody', {}, model.units.map(row => h('tr', {},
      h('th', {}, h('button', { type: 'button', class: 'ol-link', title: 'Показати лише цей підрозділ', onclick: () => { state.units = [row.unit]; options.rerender(); }, text: row.unit })),
      cols.map(([key]) => h('td', { class: 'ol-num' }, h('span', { class: 'ol-cellbar', style: { width: `${row[key] / max[key] * 100}%` } }), h('span', { text: number(row[key]) })))))),
    h('tfoot', {}, h('tr', {}, h('th', { text: 'Разом' }), cols.map(([key]) => h('td', { class: 'ol-num', text: number(total(key)) }))))));
}

function eventsTable(model, state, options) {
  if (!model.events.length) return h('p', { class: 'ol-empty', text: 'За обраний період у таблиці немає жодної події.' });
  const shown = model.events.slice(0, state.eventLimit);
  const cols = ['Дата', 'Підрозділ', '200', '300', '500', 'Арт. знищено', 'Арт. пошкоджено', 'Вийшли з ладу', 'Дія противника'];
  const cell = value => h('td', { class: 'ol-num', text: value ? number(value) : '' });
  return h('div', {},
    h('div', { class: 'ol-scroll ol-scroll-tall' }, h('table', { class: 'ol-table ol-events' },
      h('thead', {}, h('tr', {}, cols.map(label => h('th', { text: label })))),
      h('tbody', {}, shown.map(event => h('tr', {},
        h('th', { class: 'ol-date', text: dateLabel(event.date) }),
        h('td', { title: event.unitRaw, text: event.unit }),
        cell(event.k200), cell(event.k300), cell(event.k500), cell(event.destroyed), cell(event.damaged), cell(event.outOfOrder),
        h('td', { text: event.cause })))))),
    model.events.length > shown.length ? h('div', { class: 'ol-more-row' },
      h('span', { text: `Показано ${shown.length} з ${model.events.length}` }),
      h('button', { type: 'button', class: 'ol-btn quiet', onclick: () => { state.eventLimit += EVENTS_PAGE; options.rerender(); }, text: 'Показати ще' })) : null);
}

function issuesBlock(model) {
  const notes = [];
  if (model.suspect) notes.push(`Рядків із підозрілою датою (не враховано): ${model.suspect}`);
  if (model.undated) notes.push(`Рядків без прочитаної дати (не враховано): ${model.undated}`);
  const groups = new Map();
  for (const issue of model.issues) { const list = groups.get(issue.text) || []; list.push(issue); groups.set(issue.text, list); }
  return section('Перевірка даних', groups.size || notes.length ? `${model.issues.length} зауважень` : 'зауважень немає',
    notes.map(text => h('p', { class: 'ol-note', text })),
    groups.size ? [...groups].map(([text, items]) => h('details', { class: 'ol-issue' },
      h('summary', {}, h('strong', { text }), h('span', { text: ` · ${items.length}` })),
      h('ul', {}, items.slice(0, 40).map(item => h('li', { text: [item.sheet && `«${item.sheet}»`, item.rowNumber && `рядок ${item.rowNumber}`, item.metric, item.raw].filter(Boolean).join(' · ') })),
        items.length > 40 ? h('li', { text: `… ще ${items.length - 40}` }) : null))) : h('p', { class: 'ol-empty', text: 'Дати, значення й підсумок «ВСЬОГО» таблиці узгоджені.' }));
}

function filePicker(scope, label, options, quiet = false) {
  return h('label', { class: `ol-btn${quiet ? ' quiet' : ' primary'}` }, label,
    h('input', { type: 'file', accept: '.xlsx', class: 'ol-file', onchange: event => { const [file] = event.target.files || []; event.target.value = ''; pickFile(scope, file, options); } }));
}

function emptyPage(scope, state, options) {
  return h('div', { class: 'ol-root' },
    section('Наші втрати', 'окрема таблиця «НАШІ ВТРАТИ»',
      h('p', { class: 'ol-lead', text: 'Тут показано журнал власних втрат: 200, 300, 500, втрати артилерійських систем, дії противника. Це окрема таблиця, вона не змішується з даними цього дашборда.' }),
      state.busy ? h('p', { class: 'ol-note', role: 'status', text: 'Відкриваю таблицю…' }) : h('div', { class: 'ol-actions' }, filePicker(scope, 'Відкрити таблицю «НАШІ ВТРАТИ»', options)),
      state.error ? h('p', { class: 'ol-error', role: 'alert', text: state.error }) : null,
      h('p', { class: 'ol-note', text: 'Файл читається лише на цьому пристрої й не змінюється. Копію буде збережено в пам’яті застосунку, щоб не обирати файл щоразу; кнопка «Прибрати» її видаляє.' })));
}

function periodBar(state, model, options) {
  const set = preset => { state.preset = preset; if (preset === 'custom') { state.from = model.range.from; state.to = model.range.to; } state.eventLimit = EVENTS_PAGE; options.rerender(); };
  const limits = model.dataRange;
  return h('div', { class: 'ol-period' },
    h('div', { class: 'ol-seg', role: 'group', 'aria-label': 'Період «Наших втрат»' },
      OWN_PRESETS.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(state.preset === key), onclick: () => set(key), text: label }))),
    state.preset === 'custom' ? h('div', { class: 'ol-custom' },
      h('label', {}, 'з ', h('input', { type: 'date', value: state.from, min: limits.from, max: limits.to, onchange: event => { state.from = event.target.value; options.rerender(); } })),
      h('label', {}, 'по ', h('input', { type: 'date', value: state.to, min: limits.from, max: limits.to, onchange: event => { state.to = event.target.value; options.rerender(); } }))) : null,
    h('label', { class: 'ol-unit' }, h('span', { text: 'Підрозділ' }),
      h('select', { 'aria-label': 'Підрозділ у «Наших втратах»', onchange: event => { state.units = event.target.value ? [event.target.value] : []; state.eventLimit = EVENTS_PAGE; options.rerender(); } },
        h('option', { value: '', selected: !state.units.length, text: 'Усі підрозділи' }),
        model.allUnits.map(unit => h('option', { value: unit, selected: state.units[0] === unit, text: unit })))));
}

/* ------------------- таблиця, прив'язана до плитки профілю ------------------- */
const defaultReadSheets = bytes => {
  const read = window.AVCORE && window.AVCORE.readAllSheets;
  if (!read) throw new Error('У цьому вікні немає читача таблиць Excel.');
  return read(bytes);
};

/**
 * Лончер передає таблицю, прив'язану до плитки профілю. `source.reread()` повертає її свіжі байти
 * (кнопка «Оновити з файлу»). Прив'язана таблиця має перевагу над запам'ятаною копією; копія не робиться.
 */
async function connectBound(scope, bytes, name, source = {}) {
  const state = scopeState(scope);
  state.restored = true;
  state.error = '';
  try {
    await openBytes(scope, bytes, name, { readSheets: state.readSheets || defaultReadSheets });
    state.bound = { name, reread: typeof source.reread === 'function' ? source.reread : null };
    state.remembered = false;
  } catch (error) {
    state.error = errorText(error);
    state.rerender?.();
    throw error;
  }
  state.rerender?.();
}

async function refreshBound(scope, options) {
  const state = scopeState(scope);
  if (!state.bound?.reread) return;
  state.error = '';
  state.busy = true;
  options.rerender();
  try {
    const bytes = await state.bound.reread();
    await openBytes(scope, bytes, state.bound.name, { readSheets: options.readSheets || defaultReadSheets }, { keep: true });
  } catch (error) { state.error = `Не вдалося оновити таблицю з файлу: ${errorText(error)}`; }
  state.busy = false;
  options.rerender();
}

/** Профіль відв'язав таблицю або змінився: вкладка повертається до вибору файлу (запам'ятану копію буде відновлено). */
function disconnectBound(scope) {
  const state = scopeState(scope);
  if (!state.bound) return;
  Object.assign(state, { own: null, fileName: '', savedAt: '', error: '', units: [], bound: null, restored: false, remembered: false, eventLimit: EVENTS_PAGE });
  state.rerender?.();
}

/** Дашборд повідомляє, як себе перемалювати, щоб таблиця з лончера з'явилась без відкриття вкладки. */
export function ownLossesHost(scope, rerender, readSheets) {
  const state = scopeState(scope);
  state.rerender = rerender;
  if (readSheets) state.readSheets = readSheets;
}

/** Чи просили лончер показати вкладку (одноразово). */
export function consumeOwnLossesTabRequest(scope) {
  const state = scopeState(scope);
  const wanted = state.wantTab;
  state.wantTab = false;
  return wanted;
}

function requestTab(scope) {
  const state = scopeState(scope);
  state.wantTab = true;
  state.rerender?.();
}

if (typeof window !== 'undefined') {
  window.EWOwnLosses = { connect: connectBound, disconnect: disconnectBound, showTab: requestTab, isBound: scope => Boolean(scopeState(scope).bound) };
  if (typeof document?.dispatchEvent === 'function') document.dispatchEvent(new Event('ownlosses:ready'));
}

/**
 * Сторінка вкладки. options: { scope: 'dshv' | 'pvk', readSheets(Uint8Array) → Promise<sheets>, rerender() }.
 * Без readSheets файл обрати неможливо, тому дашборди не показують вкладку, коли модуль не передав читача.
 */
export function ownLossesPage(options) {
  const { scope } = options;
  const state = scopeState(scope);
  state.rerender = options.rerender;
  state.readSheets = options.readSheets || state.readSheets;
  if (!state.restored) restore(scope, options);
  if (!state.own) return emptyPage(scope, state, options);
  const own = state.own;
  const model = createOwnLossesModel(own, { preset: state.preset, custom: { from: state.from, to: state.to }, units: state.units });
  const compare = model.hasPrevious ? `порівняння з ${dateLabel(model.previousRange.from)} – ${dateLabel(model.previousRange.to)}` : 'попереднього відрізка в таблиці немає';
  return h('div', { class: 'ol-root' },
    h('header', { class: 'ol-head' },
      h('div', {},
        h('span', { class: 'ol-eyebrow', text: state.bound ? 'Окрема таблиця · прив’язана до плитки · лише читання' : 'Окрема таблиця · лише читання' }),
        h('h2', { text: 'Наші втрати' }),
        h('p', { text: `${state.fileName || own.sourceName || 'Таблиця'} · ${number(own.records.length)} подій · ${dateLabel(model.dataRange.from)} – ${dateLabel(model.dataRange.to)}` })),
      h('div', { class: 'ol-actions' },
        state.bound
          ? [state.bound.reread ? h('button', { type: 'button', class: 'ol-btn quiet', disabled: state.busy, onclick: () => refreshBound(scope, options), text: 'Оновити з файлу' }) : null]
          : [filePicker(scope, 'Замінити файл', options, true),
            h('button', { type: 'button', class: 'ol-btn quiet', onclick: () => clear(scope, options), text: 'Прибрати' })])),
    state.bound ? h('p', { class: 'ol-note', text: 'Таблицю прив’язано до плитки командування в профілі. Змінити або відв’язати її можна в профілі на стартовому екрані; файл лише читається.' }) : null,
    state.error ? h('p', { class: 'ol-error', role: 'alert', text: state.error }) : null,
    state.busy ? h('p', { class: 'ol-note', role: 'status', text: 'Відкриваю таблицю…' }) : null,
    periodBar(state, model, options),
    h('div', { class: 'ol-context' },
      h('span', { text: `${dateLabel(model.range.from)} – ${dateLabel(model.range.to)}${state.units.length ? ` · ${state.units[0]}` : ''}` }),
      h('span', { text: `${number(model.eventCount)} подій · ${model.activeDays} з ${model.days} днів із подіями · ${compare}` }),
      state.units.length ? h('button', { type: 'button', class: 'ol-link', onclick: () => { state.units = []; options.rerender(); }, text: '× усі підрозділи' }) : null),
    h('div', { class: 'ol-kpis' }, model.kpis.map(kpiCard)),
    h('div', { class: 'ol-grid-2' },
      section('Втрати о/с', model.bucket === 'day' ? 'по днях' : model.bucket === 'week' ? 'по тижнях' : 'по місяцях', model.series.length ? stackedBars(model.series, model.bucket) : h('p', { class: 'ol-empty', text: 'Період не визначено.' })),
      section('Підрозділи', 'натисніть назву, щоб відфільтрувати', unitsTable(model, state, options))),
    h('div', { class: 'ol-grid-3' },
      section('Дія противника (втрати о/с)', 'випадків', rankBars(model.causes, 'var(--ol-red)', 10)),
      section('Арт. системи: знищені', 'за типами', rankBars(model.destroyedTypes, 'var(--ol-amber)', 10)),
      section('Арт. системи: пошкоджені', 'за типами', rankBars(model.damagedTypes, 'var(--ol-blue)', 10))),
    section('Журнал подій', `${number(model.events.length)} за період`, eventsTable(model, state, options)),
    issuesBlock(model));
}

/** Тест і відлагодження: скинути пам'ять вкладки в поточному вікні. */
export function resetOwnLossesState(scope) { scopes.delete(scope); }
