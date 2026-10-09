// Модуль «Артилерія»: зведення витрати й залишку боєприпасів і внесення даних бригадою у спільну таблицю.
import { ensureMetaSheet, openWorkbook, readMeta, saveWorkbook, setCells, writeMeta } from './artillery-xlsx.js';
import {
  PERIODS, buildEdits, byCaliberGroup, byUnit, classLabel, groupEdits, groupRank, parseArtilleryWorkbook, remapEntry, stampEdits, stampFromTitle, stockState, sumItems, totals, unitKey, valueOf,
} from './artillery-core.js';
import { mount as mountRef } from './ref-wiki.js';
import * as ART_REF from './artillery-ref-data.js';

// Емблеми підрозділів: файли в unit-art, ключ — назва підрозділу без пробілів і розділових знаків.
const EMBLEM_FILES = { '79одшбр': '79-odshbr', '80одшбр': '80-odshbr', '82одшбр': '82-odshbr', '95одшбр': '95-odshbr', '425ошп': '425-oshp', '1ошп': '1-oshp' };
// Решта підрозділів пізнається за змістом назви: «АГр, РУК 148 оабр» і «АГр 148 оабр» — та сама емблема. «Арез №2» — зведений загін 148 і 44 оабр.
const EMBLEM_PATTERNS = [
  [/арез\s*№\s*2/i, 'arez2-148-44'], [/148\s*оабр/i, '148-oabr'], [/^грв.*107/i, '107-reabr'],
  [/225\s*ошп/i, '225-oshp'], [/475\s*ошп/i, '475-oshp'], [/^78\s*од/i, '78-odshbr'], [/71\s*оє?бр/i, '71-oebr'], [/^67\s*омбр/i, '67-ombr'],
];
const EMBLEM_URLS = import.meta.glob('./unit-art/*.webp', { eager: true, query: '?url', import: 'default' });
const emblemOf = name => {
  const f = EMBLEM_FILES[unitKey(name)] || EMBLEM_PATTERNS.find(([re]) => re.test(name))?.[1];
  return f ? EMBLEM_URLS[`./unit-art/${f}.webp`] || null : null;
};

// Іконки боєприпасів за групою калібру (ammo-art). Групи без своєї іконки (85, 100, 128, 130, 220 мм) дістають загальну.
const AMMO_URLS = import.meta.glob('./ammo-art/*.webp', { eager: true, query: '?url', import: 'default' });
const AMMO_BY_GROUP = {
  '155 мм ОФ': '155-he', '155 мм касетні': '155-cluster', '155 мм дист. мінування': '155-scatter', '155 мм димові й освітлювальні': '155-smoke',
  '152 мм': '152', '122 мм': '122', '122 мм РС': '122-rocket', '105 мм': '105', '203 мм': '203', '227 мм': '227',
  '120 мм': '120-mortar', '82 мм': '82-mortar', '60 мм': '60-mortar', 'Високоточні': 'guided',
};
const ammoIconOf = group => {
  if (group === 'Заряди') return null;
  const f = AMMO_BY_GROUP[group] || 'other';
  return AMMO_URLS[`./ammo-art/${f}.webp`] || null;
};
const ammoIcon = (group, cls = '') => { const src = ammoIconOf(group); return src ? h('img', { class: `ammo-ico ${cls}`.trim(), src, alt: '', loading: 'lazy' }) : null; };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HANDLE_KEY = 'handle';
const $ = id => document.getElementById(id);

// ---------- дрібні помічники ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const nf = new Intl.NumberFormat('uk-UA');
const fmt = n => (n === null || n === undefined ? '' : nf.format(n));
const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || ''); };
const plural = (n, [one, few, many]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const rowsWord = n => `${n} ${plural(n, ['рядок', 'рядки', 'рядків'])}`;
const pad2 = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const lsGet = k => { try { return localStorage.getItem('artillery.' + k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem('artillery.' + k, v); } catch (e) {} };

/** Звітний період за поточним часом: до 05:00 це кінець попередньої доби, до 18:00 — звіт 17:00, далі — звіт 00:00. */
function defaultStamp(now = new Date()) {
  const hh = now.getHours();
  if (hh < 5) { const y = new Date(now); y.setDate(y.getDate() - 1); return { date: isoOf(y), period: '00:00' }; }
  return { date: isoOf(now), period: hh < 18 ? '17:00' : '00:00' };
}

// ---------- збереження дескриптора файлу ----------
let idbPromise = null;
const idb = () => idbPromise || (idbPromise = new Promise((res, rej) => { const r = indexedDB.open('artillery', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }

// ---------- стан ----------
const S = {
  bytes: null, name: '', handle: null, lastModified: 0, storedHandle: null,
  wb: null, model: null, meta: null, titleStamp: null,
  tab: 'summary', unitId: '', lastUnit: lsGet('unit') || '', date: '', period: '',
  form: null,                                   // { unitId, name, shells:{id:{spent,left}}, charges:{}, vgz, kbb, losses:{} } — рядки введеного як у полях
  showAll: false, search: '', notice: null,
  openGroups: new Set(), closedGroups: new Set(), detailUnit: '', ammoGroup: '', ammoSearch: '',
  ammoClass: '', ammoView: 'matrix', ammoMetric: 'left', ammoOnlyLow: false, ammoEmpty: false,
};

function notice(kind, text, ms = 7000) {
  S.notice = { kind, text };
  renderToast();
  clearTimeout(notice.t);
  if (ms) notice.t = setTimeout(() => { S.notice = null; renderToast(); }, ms);
}
function renderToast() {
  document.querySelectorAll('.toast').forEach(n => n.remove());
  if (S.notice) document.body.append(h('div', { class: `toast notice ${S.notice.kind}`, role: 'status' }, S.notice.text));
}

// ---------- відкриття файлу ----------
async function load(bytes, name, handle, lastModified) {
  const wb = await openWorkbook(bytes);
  const model = await parseArtilleryWorkbook(wb);
  S.bytes = bytes; S.name = name; S.handle = handle || null; S.lastModified = lastModified || 0;
  S.wb = wb; S.model = model;
  S.meta = await readMeta(wb);
  S.titleStamp = await stampFromTitle(wb);
  const d = defaultStamp();
  S.date = S.date || S.meta.date || S.titleStamp?.date || d.date;
  S.period = S.period || (PERIODS.includes(S.meta.period) ? S.meta.period : null) || S.titleStamp?.period || d.period;
  if (!model.units.some(u => u.id === S.unitId)) S.unitId = '';
  S.form = null;
  if (REF.ctl) REF.ctl.refresh();
  renderAll();
}

async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [fh] = await window.showOpenFilePicker({ types: [{ description: 'Таблиця Excel (.xlsx)', accept: { [XLSX_MIME]: ['.xlsx'] } }] });
      let perm = 'denied';
      try { perm = await fh.requestPermission({ mode: 'readwrite' }); } catch (e) {}
      const f = await fh.getFile();
      await load(new Uint8Array(await f.arrayBuffer()), f.name, perm === 'granted' ? fh : null, f.lastModified);
      if (perm === 'granted') idbSet(HANDLE_KEY, fh).catch(() => {});
      else notice('warn', 'Дозволу на запис не надано: зміни можна буде лише завантажити файлом.');
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (e && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) { $('fileInput').click(); return; }
      notice('err', 'Не вдалося відкрити файл: ' + (e.message || e));
      return;
    }
  }
  $('fileInput').click();
}
async function fromFile(f) {
  if (!/\.xlsx$/i.test(f.name)) { notice('err', 'Потрібен файл .xlsx.'); return; }
  try { await load(new Uint8Array(await f.arrayBuffer()), f.name, null, f.lastModified); } catch (e) { notice('err', e.message || String(e), 0); }
}
async function resumeStored() {
  const fh = S.storedHandle; if (!fh) return;
  try {
    const perm = await fh.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { notice('warn', 'Дозволу не надано. Відкрийте файл кнопкою «Відкрити таблицю».'); return; }
    const f = await fh.getFile();
    await load(new Uint8Array(await f.arrayBuffer()), f.name, fh, f.lastModified);
  } catch (e) { notice('err', 'Не вдалося відновити доступ до файлу: ' + (e.message || e) + '. Відкрийте його заново.', 0); }
}
async function reload() {
  if (!S.handle) { $('fileInput').click(); return; }
  try {
    const f = await S.handle.getFile();
    S.form = null;
    await load(new Uint8Array(await f.arrayBuffer()), f.name, S.handle, f.lastModified);
    notice('ok', 'Файл прочитано заново.', 3000);
  } catch (e) { notice('err', 'Не вдалося прочитати файл: ' + (e.message || e), 0); }
}
function download(bytes) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  a.download = S.name || 'артилерія.xlsx';
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------- шапка ----------
function renderHeader() {
  const has = !!S.model;
  $('filechip').hidden = !has; $('tabs').hidden = !has; $('stamp').hidden = !has;
  if (!has) return;
  $('fileName').textContent = S.name;
  const tag = $('fileMode');
  tag.textContent = S.handle ? 'прямий запис' : 'через завантаження';
  tag.className = 'tag ' + (S.handle ? 'rw' : 'dl');
  tag.title = S.handle ? 'Зміни записуються просто у цей файл' : 'Після внесення файл буде завантажено — замініть ним спільний';
  $('reloadBtn').hidden = !S.handle;
  $('stampMain').textContent = `${S.period === '00:00' ? '24:00' : S.period} · ${fmtDate(S.date)}`;
  $('stampSub').textContent = S.meta?.journal?.length ? `Останнє внесення: ${S.meta.journal.at(-1).unit}` : 'Звітний період';
}

function goTab(id) {
  if (id === S.tab) return;
  const p = pendingEdits();
  if (p && p.edits.length && !confirm('Є незбережені зміни. Залишити внесення без збереження?')) return;
  S.form = null;
  if (id === 'entry') S.unitId = '';           // на вкладці «Внесення» спершу обирається підрозділ
  S.tab = id; renderAll();
}
const TABS = [
  ['summary', 'Зведення'], ['entry', 'Внесення'], ['units', 'Підрозділи'], ['ammo', 'Боєприпаси'], ['charges', 'Заряди'], ['losses', 'Втрати противника'], ['ref', 'Довідник'], ['check', 'Перевірка'],
];
function renderTabs() {
  const nav = $('tabs'); nav.textContent = '';
  if (!S.model) return;
  const errors = S.model.issues.filter(i => i.level === 'error').length, warns = S.model.issues.filter(i => i.level === 'warn').length;
  for (const [id, label] of TABS) {
    const btn = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(S.tab === id), onclick: () => goTab(id) }, label);
    if (id === 'check' && (errors || warns)) btn.append(h('span', { class: 'badge' + (errors ? ' bad' : '') }, errors || warns));
    nav.append(btn);
  }
}

// ---------- таблиці ----------
function table(heads, rows, opts = {}) {
  const t = h('table', null, h('thead', null, h('tr', null, heads.map(x => h('th', { class: x.num ? 'num' : '' }, x.label || x)))), h('tbody', null, rows));
  return h('div', { class: opts.plain ? '' : 'scroll' }, t);
}
const cellNum = (n, extra = '') => h('td', { class: `num ${n ? '' : 'zero'} ${extra}`.trim() }, n ? fmt(n) : '0');

function kpi(label, value, sub, cls = '') { return h('div', { class: 'kpi ' + cls }, h('small', null, label), h('b', null, fmt(value)), sub ? h('span', null, sub) : null); }

// ---------- вкладка «Зведення» ----------
function viewSummary() {
  const m = S.model, t = totals(m);
  const groups = byCaliberGroup(m).filter(g => g.spent || g.left);
  const maxSpent = Math.max(1, ...groups.map(g => g.spent));
  const units = byUnit(m).filter(r => r.spent || r.left || r.precisionSpent || r.precisionLeft || r.vgz || r.kbb || r.chargesLeft);
  const wrap = h('div', { style: 'display:grid;gap:16px' });
  wrap.append(h('div', { class: 'kpis' },
    kpi('Витрата боєприпасів', t.spent, 'за звітний період, без високоточних', 'accent'),
    kpi('Залишок боєприпасів', t.left, 'у підрозділах'),
    kpi('Високоточні', t.precisionSpent, `витрата · залишок ${fmt(t.precisionLeft)}`),
    kpi('Заряди', t.chargesSpent, `витрата · залишок ${fmt(t.chargesLeft)}`),
    kpi('Виконано ВгЗ', t.vgz, `з них КББ: ${fmt(t.kbb)}`)));
  const byGroupRows = groups.map(g => h('tr', null,
    h('td', null, ammoIcon(g.group, 'sm'), g.group), cellNum(g.spent), cellNum(g.left),
    h('td', null, h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(g.spent / maxSpent * 100)}%` })))));
  byGroupRows.push(h('tr', { class: 'total' }, h('td', null, 'Разом'), h('td', { class: 'num' }, fmt(t.spent)), h('td', { class: 'num' }, fmt(t.left)), h('td')));
  const unitRows = units.map(r => h('tr', { class: 'link', onclick: () => { S.detailUnit = r.unit.id; S.tab = 'units'; renderAll(); } },
    h('td', null, r.unit.name), cellNum(r.spent), cellNum(r.left), cellNum(r.precisionSpent), cellNum(r.vgz), cellNum(r.kbb)));
  wrap.append(h('div', { class: 'cols' },
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'За калібрами')),
      table(['Калібр', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }, ''], byGroupRows)),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'За підрозділами'), h('span', { class: 'muted small' }, 'натисніть рядок, щоб побачити по типах')),
      table(['Підрозділ', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }, { label: 'Високоточні', num: true }, { label: 'ВгЗ', num: true }, { label: 'КББ', num: true }], unitRows))));
  const journal = S.meta?.journal?.slice(-8).reverse() || [];
  if (journal.length) {
    wrap.append(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Останні внесення через застосунок')),
      table(['Час', 'Підрозділ', 'Звіт', { label: 'Змінено клітинок', num: true }], journal.map(j => h('tr', null, h('td', null, j.at.replace('T', ' ').slice(0, 16)), h('td', null, j.unit), h('td', null, `${j.period === '00:00' ? '24:00' : j.period} · ${fmtDate(j.date)}`), h('td', { class: 'num' }, fmt(+j.changed || 0)))), { plain: true })));
  }
  return wrap;
}

// ---------- вкладка «Підрозділи» ----------
function itemRows(items, unitIds, { skipEmpty = true } = {}) {
  const rows = [];
  for (const it of items) {
    const s = sumItems(S.model, [it], unitIds);
    if (skipEmpty && !s.spent && !s.left) continue;
    rows.push({ it, ...s });
  }
  return rows;
}
function viewUnits() {
  const m = S.model;
  const stats = byUnit(m);
  const cur = m.units.find(u => u.id === S.detailUnit) || null;
  const list = table(['Підрозділ', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }, { label: 'Заряди (залишок)', num: true }],
    stats.map(r => h('tr', { class: 'link', 'aria-selected': String(cur?.id === r.unit.id), onclick: () => { S.detailUnit = r.unit.id; renderAll(); } },
      h('td', null, h('b', null, cur?.id === r.unit.id ? '▸ ' : '', r.unit.name)), cellNum(r.spent), cellNum(r.left), cellNum(r.chargesLeft))));
  const detail = h('section', { class: 'panel' });
  if (!cur) detail.append(h('p', { class: 'muted' }, 'Оберіть підрозділ зліва.'));
  else {
    const rows = itemRows(m.items, [cur.id]);
    detail.append(h('div', { class: 'panel-head' }, h('h2', null, cur.name), h('button', { class: 'btn small', type: 'button', onclick: () => { S.unitId = cur.id; lsSet('unit', cur.id); S.tab = 'entry'; S.form = null; renderAll(); } }, 'Внести дані…')));
    detail.append(rows.length ? table(['Боєприпас', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }],
      rows.map(r => h('tr', null, h('td', null, r.it.label, r.it.kind === 'precision' ? h('span', { class: 'muted small' }, ' · високоточні') : ''), cellNum(r.spent), cellNum(r.left))))
      : h('p', { class: 'muted' }, 'У таблиці за цим підрозділом ще немає даних.'));
    const f = m.fire.get(cur.id);
    if (f) detail.append(h('p', { class: 'muted small' }, `Виконано ВгЗ: ${fmt(f.vgz ?? 0)} · з них КББ: ${fmt(f.kbb ?? 0)}`));
  }
  return h('div', { class: 'cols' }, h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Підрозділи')), list), detail);
}

// ---------- вкладка «Боєприпаси» ----------
// Малий залишок: поріг у штуках зберігається на комп'ютері. Колір завжди рахується за залишком, навіть коли в клітинках показано витрату.
const LOW_DEFAULT = 50;
const lowLimit = () => { const n = parseInt(lsGet('low'), 10); return Number.isFinite(n) && n >= 0 ? n : LOW_DEFAULT; };
const STOCK_MARK = { lo: '▼', out: '✕' };
const STOCK_HINT = { lo: 'малий залишок', out: 'залишок вичерпано' };
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const toggle = (set, key) => { if (set.has(key)) set.delete(key); else set.add(key); };

/** Рядки, що проходять фільтри вкладки (калібр, клас, пошук, «лише малий залишок», «показувати порожні»). */
function ammoSelection() {
  const m = S.model, limit = lowLimit(), q = S.ammoSearch.trim().toLowerCase();
  const rows = [];
  for (const it of m.items) {
    if (S.ammoGroup && it.group !== S.ammoGroup) continue;
    if (S.ammoClass && it.cls !== S.ammoClass) continue;
    if (q && !it.label.toLowerCase().includes(q)) continue;
    const per = new Map(m.units.map(u => [u.id, valueOf(m, it.id, u.id)]));
    const sum = sumItems(m, [it]);
    const has = m.units.some(u => per.get(u.id).spent || per.get(u.id).left);
    if (!has && !q && !S.ammoEmpty) continue;
    const flagged = m.units.some(u => { const v = per.get(u.id); return stockState(v.left, v.spent, limit); });
    if (S.ammoOnlyLow && !flagged && !stockState(sum.left, sum.spent, limit)) continue;
    rows.push({ it, per, sum, state: stockState(sum.left, sum.spent, limit) });
  }
  return rows.sort((a, b) => groupRank(a.it.group) - groupRank(b.it.group));   // сортування стабільне: у межах групи лишається порядок таблиці
}
const metricOf = (v, metric) => (v && v[metric]) || 0;

function ammoToolbar(groups, classes) {
  const seg = (items, cur, set) => h('div', { class: 'seg', role: 'group' }, items.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(cur === id), onclick: () => { set(id); renderAll(); } }, label)));
  const check = (label, key, title) => h('label', { class: 'check', title }, h('input', { type: 'checkbox', checked: S[key], onchange: e => { S[key] = e.target.checked; renderAll(); } }), h('span', null, label));
  return h('div', { class: 'toolbar ammo-tools' },
    h('div', { class: 'field' }, h('span', null, 'Вигляд'), seg([['matrix', 'Матриця'], ['list', 'Список']], S.ammoView, v => { S.ammoView = v; })),
    h('div', { class: 'field' }, h('span', null, 'Показувати'), seg([['left', 'Залишок'], ['spent', 'Витрату']], S.ammoMetric, v => { S.ammoMetric = v; })),
    h('label', { class: 'field' }, h('span', null, 'Калібр'), h('select', { onchange: e => { S.ammoGroup = e.target.value; renderAll(); } }, h('option', { value: '' }, 'Усі'), groups.map(g => h('option', { value: g, selected: g === S.ammoGroup }, g)))),
    h('label', { class: 'field' }, h('span', null, 'Клас'), h('select', { onchange: e => { S.ammoClass = e.target.value; renderAll(); } }, h('option', { value: '' }, 'Усі'), classes.map(c => h('option', { value: c, selected: c === S.ammoClass }, classLabel(c))))),
    h('label', { class: 'field' }, h('span', null, 'Пошук'), h('input', { type: 'search', placeholder: 'наприклад, М795', value: S.ammoSearch, id: 'ammoSearch', oninput: e => { S.ammoSearch = e.target.value; renderAll(); $('ammoSearch').focus(); $('ammoSearch').setSelectionRange(S.ammoSearch.length, S.ammoSearch.length); } })),
    h('label', { class: 'field narrow' }, h('span', null, 'Малий залишок, шт. і менше'), h('input', { type: 'number', min: '0', step: '10', value: String(lowLimit()), id: 'ammoLow', onchange: e => { const n = Math.max(0, parseInt(e.target.value, 10) || 0); lsSet('low', String(n)); renderAll(); } })),
    check('Лише з малим залишком', 'ammoOnlyLow', 'Показати тільки типи, де хоч у когось залишок малий або вичерпаний'),
    check('Показувати порожні', 'ammoEmpty', 'Також типи, за якими в таблиці немає ні витрати, ні залишку'));
}

/** Діаграма-«бублик»: частки (value) з підписом у центрі. */
function donut(parts, total, centerLabel) {
  const R = 15.9155, size = 42;
  const circles = [];
  let offset = 0;
  parts.forEach((p, i) => {
    const pct = total ? p.value / total * 100 : 0;
    if (pct <= 0) return;
    circles.push(svg('circle', { cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 6, stroke: p.color, 'stroke-dasharray': `${Math.max(pct - 0.4, 0.1)} ${100 - Math.max(pct - 0.4, 0.1)}`, 'stroke-dashoffset': String(25 - offset) }, svg('title', null, `${p.label}: ${fmt(p.value)} (${pct.toFixed(1).replace('.', ',')} %)`)));
    offset += pct;
  });
  return svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut', role: 'img', 'aria-label': 'Розподіл: ' + parts.map(p => `${p.label} ${fmt(p.value)}`).join(', ') },
    svg('circle', { cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 6, stroke: 'var(--bar-bg)' }), circles,
    svg('text', { x: 21, y: 21.5, class: 'donut-n', 'text-anchor': 'middle' }, fmt(total)),
    svg('text', { x: 21, y: 26.5, class: 'donut-l', 'text-anchor': 'middle' }, centerLabel));
}
const PALETTE = 8;

function ammoCharts(rows, metric, groups) {
  const m = S.model, word = metric === 'left' ? 'залишку' : 'витрати';
  const byKey = new Map();
  const perItem = !!S.ammoGroup;            // коли вибрано калібр, діаграма розбиває його на типи, інакше — на калібри
  for (const r of rows) {
    const key = perItem ? r.it.id : r.it.group;
    const e = byKey.get(key) || { key, label: perItem ? r.it.label : r.it.group, group: r.it.group, value: 0 };
    e.value += metricOf(r.sum, metric); byKey.set(key, e);
  }
  let parts = [...byKey.values()].filter(p => p.value > 0).sort((a, b) => b.value - a.value);
  if (parts.length > PALETTE) {
    const rest = parts.slice(PALETTE - 1);
    parts = [...parts.slice(0, PALETTE - 1), { key: '', label: 'Решта', value: rest.reduce((a, p) => a + p.value, 0), group: '', rest: rest.length }];
  }
  parts.forEach((p, i) => { p.color = p.rest ? 'var(--muted)' : `var(--c${i + 1})`; });
  const total = parts.reduce((a, p) => a + p.value, 0);
  const caliberPanel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, perItem ? `Розподіл ${word} за типами` : `Розподіл ${word} за калібрами`), h('span', { class: 'muted small' }, 'за поточними фільтрами')));
  if (!total) caliberPanel.append(h('p', { class: 'muted' }, 'За цими фільтрами немає даних.'));
  else caliberPanel.append(h('div', { class: 'chart-row' }, donut(parts, total, metric === 'left' ? 'залишок' : 'витрата'),
    h('ul', { class: 'legend' }, parts.map(p => h('li', { class: p.key && !perItem ? 'click' : '', title: p.key && !perItem ? 'Показати лише цей калібр' : '', onclick: p.key && !perItem ? () => { S.ammoGroup = p.key; renderAll(); } : null },
      h('i', { style: `background:${p.color}` }), h('span', { class: 'lbl' }, p.label, p.rest ? h('small', { class: 'muted' }, ` · ще ${p.rest}`) : ''), h('b', { class: 'num' }, fmt(p.value)), h('span', { class: 'pct num muted' }, (p.value / total * 100).toFixed(p.value / total < 0.1 ? 1 : 0).replace('.', ',') + ' %'))))));
  // за підрозділами
  const units = m.units.map(u => ({ u, value: rows.reduce((a, r) => a + metricOf(r.per.get(u.id), metric), 0), low: rows.filter(r => { const v = r.per.get(u.id); return stockState(v.left, v.spent, lowLimit()); }).length }))
    .filter(x => x.value > 0).sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...units.map(x => x.value));
  const unitPanel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, `Розподіл ${word} за підрозділами`), h('span', { class: 'muted small' }, 'позначка ▼ — є типи з малим залишком')));
  if (!units.length) unitPanel.append(h('p', { class: 'muted' }, 'За цими фільтрами немає даних.'));
  else unitPanel.append(h('div', { class: 'hbars' }, units.map(x => h('div', { class: 'hbar' },
    h('span', { class: 'who' }, x.u.name), h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(2, Math.round(x.value / max * 100))}%` })),
    h('b', { class: 'num' }, fmt(x.value)), h('span', { class: 'flag', title: x.low ? `Типів із малим залишком: ${x.low}` : '' }, x.low && metric === 'left' ? '▼' : '')))));
  return h('div', { class: 'cols' }, caliberPanel, unitPanel);
}

function ammoMatrix(rows, metric) {
  const m = S.model, limit = lowLimit();
  const units = m.units.filter(u => S.ammoEmpty || rows.some(r => { const v = r.per.get(u.id); return v.spent || v.left; }));
  if (!rows.length || !units.length) return h('p', { class: 'muted' }, 'За цими фільтрами немає рядків із даними. Змініть фільтри або увімкніть «Показувати порожні».');
  const head = h('tr', null, h('th', { class: 'corner' }, 'Боєприпас'),
    units.map(u => { const em = emblemOf(u.name); return h('th', { class: 'num unit-h', title: u.name }, em ? h('img', { class: 'crest-s', src: em, alt: '' }) : null, h('span', null, u.name)); }),
    h('th', { class: 'num total-h' }, 'Разом'));
  const body = [];
  let lastGroup = null;
  const colTotals = new Map(units.map(u => [u.id, { spent: 0, left: 0 }]));
  for (const r of rows) {
    if (!S.ammoGroup && r.it.group !== lastGroup) {
      lastGroup = r.it.group;
      body.push(h('tr', { class: 'grp' }, h('td', { colspan: units.length + 2 }, ammoIcon(r.it.group, 'xs'), r.it.group)));
    }
    const cells = units.map(u => {
      const v = r.per.get(u.id), st = stockState(v.left, v.spent, limit), n = metricOf(v, metric);
      const t = colTotals.get(u.id); t.spent += v.spent || 0; t.left += v.left || 0;
      const title = `${u.name}: витрата ${fmt(v.spent || 0)}, залишок ${fmt(v.left || 0)}${st ? ' · ' + STOCK_HINT[st] : ''}`;
      return h('td', { class: `num mx ${st} ${n ? '' : 'zero'}`.trim(), title }, st ? h('em', { class: 'mark' }, STOCK_MARK[st]) : null, n ? fmt(n) : (v.left === null && v.spent === null ? '' : '0'));
    });
    const tot = metricOf(r.sum, metric);
    body.push(h('tr', null, h('td', { class: 'first', title: r.it.label }, r.it.label, r.it.kind === 'precision' ? h('span', { class: 'muted small' }, ' · високоточні') : ''), cells,
      h('td', { class: `num mx totalc ${r.state}`.trim(), title: r.state ? STOCK_HINT[r.state] + ' у сумі' : '' }, r.state ? h('em', { class: 'mark' }, STOCK_MARK[r.state]) : null, fmt(tot))));
  }
  const grand = { spent: 0, left: 0 };
  for (const t of colTotals.values()) { grand.spent += t.spent; grand.left += t.left; }
  body.push(h('tr', { class: 'total' }, h('td', { class: 'first' }, 'Разом'), units.map(u => h('td', { class: 'num' }, fmt(colTotals.get(u.id)[metric]))), h('td', { class: 'num' }, fmt(grand[metric]))));
  return h('div', { class: 'scroll matrix' }, h('table', { class: 'matrix-t' }, h('thead', null, head), h('tbody', null, body)));
}

function ammoList(rows, metric) {
  const m = S.model, limit = lowLimit(), q = S.ammoSearch.trim();
  const out = [];
  for (const r of rows) {
    const holders = m.units.filter(u => { const v = r.per.get(u.id); return v.spent || v.left; });
    const expanded = S.openGroups.has('ammo:' + r.it.id);
    out.push(h('tr', { class: 'link', onclick: () => { toggle(S.openGroups, 'ammo:' + r.it.id); renderAll(); } },
      h('td', null, (expanded ? '▾ ' : '▸ '), ammoIcon(r.it.group, 'sm'), r.it.label), h('td', { class: 'muted' }, r.it.group), cellNum(r.sum.spent),
      h('td', { class: `num mx ${r.state} ${r.sum.left ? '' : 'zero'}`.trim() }, r.state ? h('em', { class: 'mark' }, STOCK_MARK[r.state]) : null, r.sum.left ? fmt(r.sum.left) : '0'),
      h('td', { class: 'num muted' }, holders.length ? `${holders.length}` : '')));
    if (expanded) for (const u of holders) {
      const v = r.per.get(u.id), st = stockState(v.left, v.spent, limit);
      out.push(h('tr', { class: 'sub' }, h('td', { style: 'padding-left:32px' }, u.name), h('td'), cellNum(v.spent || 0),
        h('td', { class: `num mx ${st} ${v.left ? '' : 'zero'}`.trim() }, st ? h('em', { class: 'mark' }, STOCK_MARK[st]) : null, v.left ? fmt(v.left) : '0'), h('td')));
    }
  }
  return out.length ? table(['Боєприпас', 'Калібр', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }, { label: 'Підрозділів із запасом', num: true }], out)
    : h('p', { class: 'muted' }, q ? 'Нічого не знайдено.' : 'За цими фільтрами немає рядків із даними.');
}

function viewAmmo() {
  const m = S.model, metric = S.ammoMetric, limit = lowLimit();
  const groups = [...new Set(m.items.map(i => i.group))];
  const classes = [...new Set(m.items.map(i => i.cls))];
  if (S.ammoGroup && !groups.includes(S.ammoGroup)) S.ammoGroup = '';
  if (S.ammoClass && !classes.includes(S.ammoClass)) S.ammoClass = '';
  const rows = ammoSelection();
  // Підсумок станів за всіма клітинками вибраних рядків: скільки позицій «тип × підрозділ» вичерпано і скільки з малим залишком.
  let out = 0, lo = 0;
  for (const r of rows) for (const u of m.units) { const v = r.per.get(u.id); const st = stockState(v.left, v.spent, limit); if (st === 'out') out++; else if (st === 'lo') lo++; }
  const legend = h('div', { class: 'stock-legend' },
    h('span', { class: 'chip out' }, h('em', { class: 'mark' }, STOCK_MARK.out), `Вичерпано: ${out}`),
    h('span', { class: 'chip lo' }, h('em', { class: 'mark' }, STOCK_MARK.lo), `Малий залишок (≤ ${fmt(limit)}): ${lo}`),
    h('span', { class: 'muted small' }, 'Позначка стоїть біля залишку «тип × підрозділ»; колір не залежить від того, що показано в клітинках.'));
  const tools = ammoToolbar(groups, classes);
  const main = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, S.ammoView === 'matrix' ? 'Матриця «тип × підрозділ»' : 'Боєприпаси за типами'),
    h('span', { class: 'muted small' }, `${rowsWord(rows.length)}; рядки без витрати й залишку приховано`)), legend, S.ammoView === 'matrix' ? ammoMatrix(rows, metric) : ammoList(rows, metric));
  return h('div', { style: 'display:grid;gap:16px' }, h('section', { class: 'panel' }, tools), ammoCharts(rows, metric, groups), main);
}

// ---------- вкладка «Заряди» ----------
function viewCharges() {
  const m = S.model;
  if (!m.chargeItems.length) return h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'У таблиці немає аркуша зарядів.'));
  const cuIds = m.chargeUnits.map(c => c.id);
  const itemRowsEls = m.chargeItems.map(it => ({ it, ...sumItems(m, [it], cuIds) })).filter(r => r.spent || r.left).map(r => h('tr', null, h('td', null, r.it.label), cellNum(r.spent), cellNum(r.left)));
  const unitRowsEls = m.chargeUnits.map(c => ({ c, ...sumItems(m, m.chargeItems, [c.id]) })).filter(r => r.spent || r.left).map(r => h('tr', null, h('td', null, r.c.name, r.c.unitId ? '' : h('span', { class: 'muted small' }, ' · немає в аркуші снарядів')), cellNum(r.spent), cellNum(r.left)));
  return h('div', { class: 'cols' },
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'За типами зарядів')), table(['Заряд', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }], itemRowsEls)),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'За підрозділами')), table(['Підрозділ', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }], unitRowsEls)));
}

// ---------- вкладка «Довідник» ----------
// Стаття про кожен тип боєприпасів: ілюстрація, 3D-модель, коротке пояснення й підсумок по вашій таблиці. Сама вікі — ref-wiki.js
// (та сама, що в «Повітряних Силах» і «Ракетних Військах»), дані — artillery-ref-data.js, моделі — artillery-3d.js.
const REF = { host: null, ctl: null };
const refGroups = () => (S.model ? [...new Set([...S.model.items.map(i => i.group), ...(S.model.chargeItems.length ? ['Заряди'] : [])])] : []);
const refItems = entry => {
  const m = S.model;
  if (!m) return [];
  if (entry.charges) return m.chargeItems;
  const groups = ART_REF.groupsOf(entry, refGroups());
  return m.items.filter(i => groups.includes(i.group));
};
const refIcon = id => { const e = ART_REF.entryById(id); return e && e.icon ? AMMO_URLS[`./ammo-art/${e.icon}.webp`] || null : null; };

function refExtra(entry) {
  const m = S.model;
  const box = h('div', { class: 'ref-live' }, h('h3', { text: 'У вашій таблиці' }));
  if (!m) { box.append(h('p', { class: 'rw-fine', text: 'Таблицю ще не завантажено. Відкрийте її, і тут з’явиться підсумок по цьому типу.' })); return box; }
  const items = refItems(entry), limit = lowLimit();
  const unitIds = entry.charges ? m.chargeUnits.map(c => c.id) : m.units.map(u => u.id);
  const rows = items.map(it => ({ it, ...sumItems(m, [it], unitIds), per: unitIds.map(id => valueOf(m, it.id, id)) })).filter(r => r.spent || r.left);
  if (!rows.length) { box.append(h('p', { class: 'rw-fine', text: items.length ? 'Рядки цього типу в таблиці є, але витрати й залишку за ними немає.' : 'У завантаженій таблиці немає рядків цього типу.' })); return box; }
  const spent = rows.reduce((a, r) => a + r.spent, 0), left = rows.reduce((a, r) => a + r.left, 0);
  const holders = unitIds.filter(id => rows.some(r => { const v = valueOf(m, r.it.id, id); return v.left; })).length;
  const tile = (label, value) => h('div', { class: 'rw-tile' }, h('b', { text: fmt(value) }), h('span', { text: label }));
  const stateOf = r => stockState(r.left, r.spent, limit);
  box.append(h('div', { class: 'rw-tiles' }, tile('витрата', spent), tile('залишок', left), tile('підрозділів із запасом', holders)),
    table(['Рядок таблиці', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }], rows.map(r => {
      const st = stateOf(r);
      return h('tr', null, h('td', null, r.it.label), cellNum(r.spent), h('td', { class: `num mx ${st} ${r.left ? '' : 'zero'}`.trim(), title: st ? STOCK_HINT[st] : '' }, st ? h('em', { class: 'mark' }, STOCK_MARK[st]) : null, r.left ? fmt(r.left) : '0'));
    })));
  if (!entry.charges) {
    const groups = ART_REF.groupsOf(entry, refGroups());
    box.append(h('p', null, h('button', { class: 'btn small', type: 'button', onclick: () => { S.ammoGroup = groups.length === 1 ? groups[0] : ''; S.ammoSearch = ''; S.ammoClass = ''; S.ammoOnlyLow = false; S.tab = 'ammo'; renderAll(); } }, 'Показати в матриці «тип × підрозділ»')));
  } else box.append(h('p', null, h('button', { class: 'btn small', type: 'button', onclick: () => { S.tab = 'charges'; renderAll(); } }, 'Відкрити вкладку «Заряди»')));
  return box;
}

function viewRef() {
  if (!REF.ctl) {
    REF.host = h('div', { class: 'ref-host' });
    REF.ctl = mountRef(REF.host, {
      data: ART_REF, usage: false, related: false, initial: lsGet('ref') || 'g155he',
      media: { thumb: refIcon, photo: refIcon }, motion: () => !matchMedia('(prefers-reduced-motion: reduce)').matches,
      extra: refExtra,
      searchText: e => refItems(e).map(i => i.label).join(' '),
      onSelect: id => lsSet('ref', id),
    });
  } else REF.ctl.refresh();                // таблицю могли перезавантажити
  return REF.host;
}

// ---------- вкладка «Втрати противника» ----------
function viewLosses() {
  const m = S.model;
  if (!m.losses.sheet) return h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'У таблиці немає аркуша втрат противника.'));
  const unitOf = id => m.units.find(u => u.id === id);
  const totalsBy = m.losses.columns.map(c => ({ c, sum: [...m.losses.rows.values()].reduce((a, r) => a + (r.values[c.id] || 0), 0) })).filter(x => x.sum);
  const rows = [...m.losses.rows.entries()].map(([id, r]) => ({ u: unitOf(id), r })).filter(x => Object.keys(x.r.values).length);
  return h('div', { class: 'cols' },
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Усього за добу')),
      totalsBy.length ? table(['Показник', { label: 'Кількість', num: true }], totalsBy.map(x => h('tr', null, h('td', null, x.c.label), cellNum(x.sum)))) : h('p', { class: 'muted' }, 'Втрат за звітну добу не внесено.')),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'За підрозділами')),
      rows.length ? rows.map(x => h('div', { style: 'margin-bottom:10px' }, h('b', null, x.u?.name || ''), h('div', { class: 'muted small' }, m.losses.columns.filter(c => x.r.values[c.id]).map(c => `${c.label}: ${fmt(x.r.values[c.id])}`).join(' · ')))) : h('p', { class: 'muted' }, 'Немає даних.')));
}

// ---------- вкладка «Перевірка» ----------
function viewCheck() {
  const issues = S.model.issues;
  const order = { error: 0, warn: 1, info: 2 };
  const label = { error: 'Помилка', warn: 'Увага', info: 'Інформація' };
  return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Перевірка даних таблиці')),
    issues.length ? h('ul', { class: 'issues' }, [...issues].sort((a, b) => order[a.level] - order[b.level]).map(i => h('li', { class: i.level }, h('b', null, label[i.level] + ': '), i.text)))
      : h('p', { class: 'notice ok' }, 'Зауважень до таблиці немає.'));
}

// ---------- вкладка «Внесення» ----------
const strVal = v => (v === null || v === undefined ? '' : String(v));
function newForm(unit) {
  const m = S.model;
  const f = { unitId: unit.id, name: '', shells: {}, charges: {}, vgz: strVal(m.fire.get(unit.id)?.vgz), kbb: strVal(m.fire.get(unit.id)?.kbb), losses: {}, orig: {} };
  for (const it of m.items) { const v = valueOf(m, it.id, unit.id); f.shells[it.id] = { spent: strVal(v.spent), left: strVal(v.left) }; }
  if (unit.chargeUnitId) for (const it of m.chargeItems) { const v = valueOf(m, it.id, unit.chargeUnitId); f.charges[it.id] = { spent: strVal(v.spent), left: strVal(v.left) }; }
  const l = m.losses.rows.get(unit.id);
  for (const c of m.losses.columns) f.losses[c.id] = strVal(l?.values[c.id]);
  f.orig = JSON.parse(JSON.stringify({ shells: f.shells, charges: f.charges, vgz: f.vgz, kbb: f.kbb, losses: f.losses }));
  return f;
}
const parseCell = s => { const t = String(s).trim().replace(/\s+/g, ''); if (t === '') return { v: null }; if (!/^\d+$/.test(t)) return { bad: true }; return { v: +t }; };

/** Збирає entry для buildEdits із полів форми: лише те, що відрізняється від прочитаного. */
function entryFromForm(f) {
  let bad = 0;
  const diffMap = (cur, orig) => {
    const out = {};
    for (const [id, v] of Object.entries(cur)) for (const k of ['spent', 'left']) {
      if (v[k] === orig[id][k]) continue;
      const p = parseCell(v[k]); if (p.bad) { bad++; continue; }
      (out[id] ||= {})[k] = p.v;
    }
    return out;
  };
  const entry = { shells: diffMap(f.shells, f.orig.shells), charges: diffMap(f.charges, f.orig.charges), losses: {} };
  if (f.name) entry.name = f.name;
  for (const k of ['vgz', 'kbb']) if (f[k] !== f.orig[k]) { const p = parseCell(f[k]); if (p.bad) bad++; else entry[k] = p.v; }
  for (const [id, v] of Object.entries(f.losses)) if (v !== f.orig.losses[id]) { const p = parseCell(v); if (p.bad) bad++; else entry.losses[id] = p.v; }
  return { entry, bad };
}

function crest(unit, big) {
  const src = unit.free ? null : emblemOf(unit.name);
  if (src) return h('img', { class: 'crest' + (big ? ' big' : ''), src, alt: '' });
  const num = /^[^\d]*(\d+(?:\/\d+)*)/.exec(unit.name)?.[1] || '';
  const label = unit.free ? '+' : num || unit.name.slice(0, 2);
  return h('span', { class: 'crest ph' + (big ? ' big' : '') + (label.length > 4 ? ' long' : ''), 'aria-hidden': 'true' }, label);
}

function reportedBy(unit) {
  return (S.meta?.journal || []).some(j => j.unit === unit.name && j.date === S.date && j.period === S.period);
}

function viewUnitPicker() {
  const m = S.model;
  const stats = new Map(byUnit(m).map(r => [r.unit.id, r]));
  const cards = [...m.units].sort((a, b) => !!a.free - !!b.free).map(u => {
    const r = stats.get(u.id);
    const has = r && (r.spent || r.left || r.chargesLeft || r.vgz);
    const done = reportedBy(u);
    return h('button', { class: 'unit-card' + (u.free ? ' free' : '') + (S.lastUnit === u.id ? ' last' : ''), type: 'button', onclick: () => { S.unitId = u.id; S.lastUnit = u.id; lsSet('unit', u.id); S.form = null; renderAll(); window.scrollTo(0, 0); } },
      crest(u),
      h('b', null, u.free ? 'Нова колонка' : u.name),
      h('span', { class: 'muted small' }, u.free ? u.name.replace('Вільні колонки ', 'колонки ') : has ? `витрата ${fmt(r.spent)} · залишок ${fmt(r.left)}` : 'даних ще немає'),
      done ? h('span', { class: 'tag ok' }, `внесено на ${S.period === '00:00' ? '24:00' : S.period}`) : S.lastUnit === u.id ? h('span', { class: 'tag' }, 'востаннє обирали') : null);
  });
  return h('div', { style: 'display:grid;gap:16px' },
    h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', null, 'Від якого підрозділу вносимо дані?'),
        h('span', { class: 'muted small' }, `Звіт на ${S.period === '00:00' ? '24:00' : S.period} · ${fmtDate(S.date)}`)),
      h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'Оберіть підрозділ: відкриється форма з його колонок таблиці. Після внесення ви отримаєте цю саму таблицю з оновленими даними.'),
      h('div', { class: 'unit-grid' }, cards)));
}

function viewEntry() {
  const m = S.model;
  const unit = m.units.find(u => u.id === S.unitId);
  if (!unit) return viewUnitPicker();
  const wrap = h('div', { style: 'display:grid;gap:16px' });
  const head = h('section', { class: 'panel' },
    h('div', { class: 'entry-head' },
      crest(unit, true),
      h('div', { class: 'entry-title' }, h('small', { class: 'muted' }, 'Вносимо дані від підрозділу'), h('h2', null, unit.free ? 'Нова колонка таблиці' : unit.name)),
      h('button', { class: 'btn small', type: 'button', onclick: () => { const p = pendingEdits(); if (p && p.edits.length && !confirm('Є незбережені зміни. Обрати інший підрозділ без збереження?')) return; S.form = null; S.unitId = ''; renderAll(); } }, '← Інший підрозділ')),
    h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, h('span', null, 'Дата звіту'), h('input', { type: 'date', value: S.date, onchange: e => { S.date = e.target.value; renderHeader(); renderSaveBar(); } })),
      h('label', { class: 'field' }, h('span', null, 'Звіт на'), h('select', { onchange: e => { S.period = e.target.value; renderHeader(); } }, PERIODS.map(p => h('option', { value: p, selected: p === S.period }, p === '00:00' ? '24:00' : p)))),
      h('span', { class: 'muted small', style: 'align-self:center' }, 'записуються лише колонки цього підрозділу; формули й дані інших підрозділів не змінюються')));
  wrap.append(head);
  if (!S.form || S.form.unitId !== unit.id) S.form = newForm(unit);
  const f = S.form;
  if (unit.free) {
    head.append(h('div', { class: 'notice warn', style: 'margin-top:8px' }, 'Ці колонки в таблиці ще без назви. Вкажіть назву підрозділу — вона запишеться в шапку таблиці.'),
      h('label', { class: 'field', style: 'margin-top:8px' }, h('span', null, 'Назва підрозділу'), h('input', { type: 'text', value: f.name, placeholder: 'наприклад, 5 ошп', oninput: e => { f.name = e.target.value; renderSaveBar(); } })));
  }
  const cellInput = (get, set, orig) => {
    const inp = h('input', { class: 'cell', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: get() });
    const paint = () => { inp.classList.toggle('dirty', get() !== orig); inp.classList.toggle('bad', parseCell(get()).bad === true); };
    inp.addEventListener('input', () => { set(inp.value); paint(); renderSaveBar(); });
    inp.addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); const all = [...document.querySelectorAll('input.cell')]; const next = all[all.indexOf(inp) + 1]; if (next) next.focus(); });
    paint();
    return inp;
  };
  const q = S.search.trim().toLowerCase();
  const toolbar = h('div', { class: 'toolbar' },
    h('label', { class: 'field' }, h('span', null, 'Пошук рядка'), h('input', { id: 'entrySearch', type: 'search', placeholder: 'калібр або марка', value: S.search, oninput: e => { S.search = e.target.value; renderAll(); const i = $('entrySearch'); i.focus(); i.setSelectionRange(S.search.length, S.search.length); } })),
    h('label', { style: 'display:flex;gap:8px;align-items:center;min-height:38px' }, h('input', { type: 'checkbox', checked: S.showAll, onchange: e => { S.showAll = e.target.checked; renderAll(); } }), 'Показувати всі рядки (не лише ті, де вже є дані)'));
  const body = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Витрата й залишок'), h('span', { class: 'muted small' }, 'цілі невід\'ємні числа; порожнє поле — немає даних')), toolbar);

  const groupNames = [...new Set(m.items.map(i => i.group))];
  const sections = [...(groupNames.includes('Високоточні') ? ['Високоточні'] : []), ...groupNames.filter(g => g !== 'Високоточні')];
  for (const g of sections) {
    const items = m.items.filter(i => i.group === g);
    const visible = items.filter(it => {
      if (q) return it.label.toLowerCase().includes(q) || g.toLowerCase().includes(q);
      const s = f.shells[it.id];
      return S.showAll || s.spent !== '' || s.left !== '' || f.orig.shells[it.id].spent !== '' || f.orig.shells[it.id].left !== '';
    });
    if (!visible.length) continue;
    const dirty = visible.filter(it => f.shells[it.id].spent !== f.orig.shells[it.id].spent || f.shells[it.id].left !== f.orig.shells[it.id].left).length;
    const det = h('details', { class: 'group', open: !S.closedGroups.has('e:' + g) || !!q || dirty > 0 },
      h('summary', null, ammoIcon(g, 'md'), g, h('span', { class: 'muted' }, dirty ? `змінено: ${dirty}` : rowsWord(visible.length))));
    det.addEventListener('toggle', () => { if (det.open) S.closedGroups.delete('e:' + g); else S.closedGroups.add('e:' + g); });
    det.append(h('div', { class: 'entry-row head' }, h('span', null, 'Боєприпас'), h('span', { class: 'num' }, 'Витрата'), h('span', { class: 'num' }, 'Залишок')));
    for (const it of visible) {
      const s = f.shells[it.id], o = f.orig.shells[it.id];
      det.append(h('div', { class: 'entry-row' }, h('span', { class: 'lbl' }, it.label), cellInput(() => s.spent, v => { s.spent = v; }, o.spent), cellInput(() => s.left, v => { s.left = v; }, o.left)));
    }
    body.append(det);
  }

  if (m.chargeItems.length) {
    if (!unit.chargeUnitId) body.append(h('p', { class: 'muted small' }, 'Для цього підрозділу в аркуші зарядів немає колонок, тож заряди тут не вносяться.'));
    else {
      const items = m.chargeItems.filter(it => q ? it.label.toLowerCase().includes(q) : S.showAll || f.charges[it.id].spent !== '' || f.charges[it.id].left !== '');
      if (items.length) {
        const det = h('details', { class: 'group', open: !S.closedGroups.has('e:charges') || !!q }, h('summary', null, 'Заряди', h('span', { class: 'muted' }, rowsWord(items.length))));
        det.addEventListener('toggle', () => { if (det.open) S.closedGroups.delete('e:charges'); else S.closedGroups.add('e:charges'); });
        det.append(h('div', { class: 'entry-row head' }, h('span', null, 'Заряд'), h('span', { class: 'num' }, 'Витрата'), h('span', { class: 'num' }, 'Залишок')));
        for (const it of items) { const s = f.charges[it.id], o = f.orig.charges[it.id]; det.append(h('div', { class: 'entry-row' }, h('span', { class: 'lbl' }, it.label), cellInput(() => s.spent, v => { s.spent = v; }, o.spent), cellInput(() => s.left, v => { s.left = v; }, o.left))); }
        body.append(det);
      }
    }
  }
  if (m.fire.has(unit.id)) {
    const det = h('details', { class: 'group', open: true }, h('summary', null, 'Вогневі завдання'), h('div', { class: 'entry-row head' }, h('span', null, 'Показник'), h('span', { class: 'num' }, 'Кількість'), h('span')));
    det.append(h('div', { class: 'entry-row' }, h('span', { class: 'lbl' }, 'Всього виконано ВгЗ'), cellInput(() => f.vgz, v => { f.vgz = v; }, f.orig.vgz), h('span')),
      h('div', { class: 'entry-row' }, h('span', { class: 'lbl' }, 'З них КББ'), cellInput(() => f.kbb, v => { f.kbb = v; }, f.orig.kbb), h('span')));
    body.append(det);
  }
  if (m.losses.rows.has(unit.id)) {
    const det = h('details', { class: 'group', open: S.openGroups.has('e:losses') }, h('summary', null, 'Втрати противника за добу'));
    det.addEventListener('toggle', () => { if (det.open) S.openGroups.add('e:losses'); else S.openGroups.delete('e:losses'); });
    det.append(h('div', { class: 'entry-row head' }, h('span', null, 'Показник'), h('span', { class: 'num' }, 'Кількість'), h('span')));
    for (const c of m.losses.columns) det.append(h('div', { class: 'entry-row' }, h('span', { class: 'lbl' }, c.label), cellInput(() => f.losses[c.id], v => { f.losses[c.id] = v; }, f.orig.losses[c.id]), h('span')));
    body.append(det);
  }
  wrap.append(body);
  return wrap;
}

// ---------- панель збереження ----------
function pendingEdits() {
  const f = S.form;
  if (S.tab !== 'entry' || !f || !S.model) return null;
  const { entry, bad } = entryFromForm(f);
  const { edits } = buildEdits(S.model, f.unitId, entry);
  return { entry, bad, edits };
}
function renderSaveBar() {
  const bar = $('savebar');
  const p = pendingEdits();
  if (!p) { bar.hidden = true; return; }
  bar.hidden = false; bar.textContent = '';
  const unit = S.model.units.find(u => u.id === S.form.unitId);
  const needName = unit.free && !S.form.name.trim() && p.edits.length > 0;
  const msg = p.bad ? `Є некоректні поля (${p.bad}): потрібні цілі числа.` : needName ? 'Вкажіть назву підрозділу.' : p.edits.length ? `Змінено клітинок: ${p.edits.length}` : 'Змін немає.';
  bar.append(h('span', { class: 'msg ' + (p.bad || needName ? 'warn' : 'muted') }, msg),
    h('button', { class: 'btn', type: 'button', disabled: !p.edits.length, onclick: () => { S.form = null; renderAll(); } }, 'Скасувати зміни'),
    h('button', { class: 'btn primary', type: 'button', disabled: !p.edits.length || !!p.bad || needName, onclick: save }, S.handle ? 'Зберегти в таблицю' : 'Зберегти таблицю з новими даними'));
}

async function applyAndSerialize(wb, model, unitId, entry) {
  const unit = model.units.find(u => u.id === unitId);
  const { edits } = buildEdits(model, unitId, entry);
  const stamp = await stampEdits(wb, S.date, S.period);
  for (const [sheet, list] of groupEdits([...edits, ...stamp])) await setCells(wb, sheet, list);
  await ensureMetaSheet(wb);
  const at = new Date(); const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  await writeMeta(wb, { date: S.date, period: S.period, unit: entry.name || unit.name, changed: edits.length, at: local });
  return { bytes: await saveWorkbook(wb), changed: edits.length };
}

async function save() {
  const p = pendingEdits();
  if (!p || !p.edits.length || p.bad) return;
  const f = S.form, m = S.model;
  try {
    let wb = S.wb, model = m, entry = p.entry, unitId = f.unitId, merged = false;
    if (S.handle) {
      // файл спільний: якщо його змінили, поки форма була відкрита, накладаємо правки на свіжу копію
      const file = await S.handle.getFile();
      if (file.lastModified !== S.lastModified) {
        wb = await openWorkbook(new Uint8Array(await file.arrayBuffer()));
        model = await parseArtilleryWorkbook(wb);
        const old = m.units.find(u => u.id === f.unitId);
        const unit = (!old.free && model.units.find(u => u.name === old.name)) || model.units.find(u => u.id === old.id);
        if (!unit) throw new Error('У свіжій версії файлу не знайдено вашого підрозділу.');
        entry = remapEntry(m, model, p.entry); unitId = unit.id; merged = true;
      }
    }
    const { bytes, changed } = await applyAndSerialize(wb, model, unitId, entry);
    if (S.handle) {
      const w = await S.handle.createWritable();
      await w.write(bytes); await w.close();
      const written = await S.handle.getFile();
      S.form = null;
      await load(bytes, S.name, S.handle, written.lastModified);
      notice('ok', `Збережено у файл: ${changed} змін.${merged ? ' Файл за цей час змінили інші бригади — ваші дані дописано до свіжої версії.' : ''} Формули перерахуються, коли таблицю відкриють в Excel чи Nextcloud.`, 9000);
    } else {
      download(bytes);
      S.form = null;
      await load(bytes, S.name, null, Date.now());
      notice('warn', `Файл із ${changed} змінами завантажено. Замініть ним спільний файл у Nextcloud. Формули перерахуються, коли таблицю відкриють в Excel.`, 12000);
    }
  } catch (e) {
    notice('err', 'Не вдалося зберегти: ' + (e.message || e), 0);
  }
}

// ---------- основний рендер ----------
function viewWelcome() {
  const recent = S.storedHandle;
  return h('section', { class: 'panel welcome' },
    h('h2', null, 'Облік витрати й залишку боєприпасів'),
    h('p', { class: 'muted' }, 'Відкрийте спільну таблицю артилерії (файл .xlsx з Nextcloud). Зведення побудується одразу, а бригади зможуть вносити свої дані прямо в цей файл.'),
    h('ol', null, h('li', null, 'Відкрийте спільний файл.'), h('li', null, 'Оберіть свою бригаду на вкладці «Внесення» та введіть витрату й залишок.'), h('li', null, 'Збережіть: запишуться лише колонки вашого підрозділу, формули не змінюються.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: pickFile }, 'Відкрити таблицю…'),
      recent ? h('button', { class: 'btn', type: 'button', onclick: resumeStored }, `Продовжити: ${recent.name}`) : null),
    h('p', { class: 'muted small' }, 'Можна перетягнути файл у це вікно. Дані залишаються на вашому комп\'ютері.'));
}

function renderAll() {
  renderHeader(); renderTabs();
  const view = $('view'); view.textContent = '';
  if (!S.model) { view.append(viewWelcome()); renderSaveBar(); return; }
  const views = { summary: viewSummary, entry: viewEntry, units: viewUnits, ammo: viewAmmo, charges: viewCharges, losses: viewLosses, ref: viewRef, check: viewCheck };
  view.append((views[S.tab] || viewSummary)());
  renderSaveBar();
}

// ---------- запуск ----------
$('openBtn').addEventListener('click', pickFile);
$('reloadBtn').addEventListener('click', reload);
$('fileInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) fromFile(f); });
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
window.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('drag'); const f = e.dataTransfer?.files?.[0]; if (f) fromFile(f); });
window.addEventListener('beforeunload', e => { const p = pendingEdits(); if (p && p.edits.length) { e.preventDefault(); e.returnValue = ''; } });
if (window.showOpenFilePicker && window.indexedDB) idbGet(HANDLE_KEY).then(fh => { if (fh && fh.kind === 'file') { S.storedHandle = fh; if (!S.model) renderAll(); } }).catch(() => {});
window.__artillery = { S, load };          // для перевірок у браузері
renderAll();
