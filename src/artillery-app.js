// Модуль «Артилерія»: зведення витрати й залишку боєприпасів і внесення даних бригадою у спільну таблицю.
import { ensureMetaSheet, openWorkbook, readMeta, saveWorkbook, setCells, writeMeta } from './artillery-xlsx.js';
import {
  PERIODS, buildEdits, byCaliberGroup, byUnit, groupEdits, parseArtilleryWorkbook, remapEntry, stampEdits, stampFromTitle, sumItems, totals, valueOf,
} from './artillery-core.js';

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
  tab: 'summary', unitId: lsGet('unit') || '', date: '', period: '',
  form: null,                                   // { unitId, name, shells:{id:{spent,left}}, charges:{}, vgz, kbb, losses:{} } — рядки введеного як у полях
  showAll: false, search: '', notice: null,
  openGroups: new Set(), closedGroups: new Set(), detailUnit: '', ammoGroup: '', ammoSearch: '',
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

const TABS = [
  ['summary', 'Зведення'], ['entry', 'Внесення'], ['units', 'Підрозділи'], ['ammo', 'Боєприпаси'], ['charges', 'Заряди'], ['losses', 'Втрати противника'], ['check', 'Перевірка'],
];
function renderTabs() {
  const nav = $('tabs'); nav.textContent = '';
  if (!S.model) return;
  const errors = S.model.issues.filter(i => i.level === 'error').length, warns = S.model.issues.filter(i => i.level === 'warn').length;
  for (const [id, label] of TABS) {
    const btn = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(S.tab === id), onclick: () => { S.tab = id; renderAll(); } }, label);
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
    h('td', null, g.group), cellNum(g.spent), cellNum(g.left),
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
function viewAmmo() {
  const m = S.model;
  const groups = [...new Set(m.items.map(i => i.group))];
  const q = S.ammoSearch.trim().toLowerCase();
  let items = m.items.filter(i => (!S.ammoGroup || i.group === S.ammoGroup) && (!q || i.label.toLowerCase().includes(q)));
  const rows = [];
  for (const it of items) {
    const s = sumItems(m, [it]);
    if (!q && !s.spent && !s.left) continue;
    const holders = m.units.filter(u => { const v = valueOf(m, it.id, u.id); return v.spent || v.left; });
    const expanded = S.openGroups.has('ammo:' + it.id);
    rows.push(h('tr', { class: 'link', onclick: () => { const k = 'ammo:' + it.id; if (S.openGroups.has(k)) S.openGroups.delete(k); else S.openGroups.add(k); renderAll(); } },
      h('td', null, (expanded ? '▾ ' : '▸ ') + it.label), h('td', { class: 'muted' }, it.group), cellNum(s.spent), cellNum(s.left), h('td', { class: 'num muted' }, holders.length ? `${holders.length}` : '')));
    if (expanded) for (const u of holders) { const v = valueOf(m, it.id, u.id); rows.push(h('tr', { class: 'sub' }, h('td', { style: 'padding-left:32px' }, u.name), h('td'), cellNum(v.spent || 0), cellNum(v.left || 0), h('td'))); }
  }
  const tools = h('div', { class: 'toolbar' },
    h('label', { class: 'field' }, h('span', null, 'Калібр'), h('select', { onchange: e => { S.ammoGroup = e.target.value; renderAll(); } }, h('option', { value: '' }, 'Усі'), groups.map(g => h('option', { value: g, selected: g === S.ammoGroup }, g)))),
    h('label', { class: 'field' }, h('span', null, 'Пошук'), h('input', { type: 'search', placeholder: 'наприклад, М795', value: S.ammoSearch, id: 'ammoSearch', oninput: e => { S.ammoSearch = e.target.value; renderAll(); $('ammoSearch').focus(); $('ammoSearch').setSelectionRange(S.ammoSearch.length, S.ammoSearch.length); } })));
  return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'Боєприпаси за типами'), h('span', { class: 'muted small' }, 'рядки без витрати й залишку приховано; пошук показує все')),
    tools, table(['Боєприпас', 'Калібр', { label: 'Витрата', num: true }, { label: 'Залишок', num: true }, { label: 'Підрозділів із запасом', num: true }], rows));
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

function viewEntry() {
  const m = S.model;
  const unit = m.units.find(u => u.id === S.unitId);
  const wrap = h('div', { style: 'display:grid;gap:16px' });
  const unitSelect = h('select', { id: 'unitSel', onchange: e => { S.unitId = e.target.value; lsSet('unit', S.unitId); S.form = null; renderAll(); } },
    h('option', { value: '' }, '— оберіть бригаду —'),
    m.units.map(u => h('option', { value: u.id, selected: u.id === S.unitId }, u.name)));
  const head = h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Внесення даних бригадою'), h('span', { class: 'muted small' }, 'записуються лише колонки обраного підрозділу, формули й чужі дані не чіпаються')),
    h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, h('span', null, 'Бригада (підрозділ)'), unitSelect),
      h('label', { class: 'field' }, h('span', null, 'Дата звіту'), h('input', { type: 'date', value: S.date, onchange: e => { S.date = e.target.value; renderHeader(); renderSaveBar(); } })),
      h('label', { class: 'field' }, h('span', null, 'Звіт на'), h('select', { onchange: e => { S.period = e.target.value; renderHeader(); } }, PERIODS.map(p => h('option', { value: p, selected: p === S.period }, p === '00:00' ? '24:00' : p))))));
  wrap.append(head);
  if (!unit) { wrap.append(h('p', { class: 'muted' }, 'Оберіть свою бригаду, щоб внести витрату й залишок.')); return wrap; }
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
  const body = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, unit.name), h('span', { class: 'muted small' }, 'цілі невід\'ємні числа; порожнє поле — немає даних')), toolbar);

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
      h('summary', null, g, h('span', { class: 'muted' }, dirty ? `змінено: ${dirty}` : rowsWord(visible.length))));
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
    h('button', { class: 'btn primary', type: 'button', disabled: !p.edits.length || !!p.bad || needName, onclick: save }, S.handle ? 'Зберегти у файл' : 'Зберегти й завантажити файл'));
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
  const views = { summary: viewSummary, entry: viewEntry, units: viewUnits, ammo: viewAmmo, charges: viewCharges, losses: viewLosses, check: viewCheck };
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
