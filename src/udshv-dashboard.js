import {
  GROUPS,
  OVT_GROUPS,
  allDateRange,
  createDashboardModel,
  csvRows,
  groupIssues,
  lastActiveDate,
  normalizeUnits,
  parseUdshvWorkbook,
  periodRange,
  pivotRows,
  shiftAnchor,
  toCsv,
  validateWorkbook,
} from './udshv-dashboard-core.js';

const state = { workbook: null, view: 'summary', preset: 'week', anchor: '', from: '', to: '', units: [], unitsOpen: false, focusUnit: null, ovt: 'destroyed', sort: 'personnel' };

const number = value => Math.round(Number(value) || 0).toLocaleString('uk-UA');
const decimal = value => (Number(value) || 0).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const dateLabel = value => value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—';
const shortDate = value => value ? `${value.slice(8, 10)}.${value.slice(5, 7)}` : '';
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const monthLabel = iso => iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '';
const TONE = { red: 'var(--ud-red)', amber: 'var(--ud-amber)', violet: 'var(--ud-violet)', blue: 'var(--ud-blue)', green: 'var(--ud-green)' };
const OVT_COLORS = { destroyed: 'var(--ud-red)', damaged: 'var(--ud-amber)', suppressed: 'var(--ud-blue)' };
const groupInfo = key => GROUPS.find(g => g.key === key) || { name: key, short: key };

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

function ensureState(workbook) {
  if (state.workbook === workbook) return;
  const keep = state.workbook && state.workbook.sourceName === workbook.sourceName;
  state.workbook = workbook;
  if (!keep) Object.assign(state, { view: 'summary', preset: 'week', units: [] });
  state.anchor = lastActiveDate(workbook);
  const all = allDateRange(workbook);
  state.from = state.from || all.from;
  state.to = state.to || all.to;
}

function currentRange() {
  return periodRange(state.workbook, state.preset, state.anchor, { from: state.from, to: state.to });
}

function periodTitle(range) {
  if (state.preset === 'week') return `Тиждень ${shortDate(range.from)} – ${dateLabel(range.to)}`;
  if (state.preset === 'month') return monthLabel(range.from).replace(/^./, c => c.toUpperCase());
  if (state.preset === 'all') return `Весь період: ${dateLabel(range.from)} – ${dateLabel(range.to)}`;
  return `${dateLabel(range.from)} – ${dateLabel(range.to)}`;
}

/* ------------------------------ графіки ------------------------------ */

function sparkline(series, color) {
  const width = 160, height = 38;
  if (series.length < 2) return h('div', { class: 'ud-spark' });
  const max = Math.max(1, ...series.map(s => s.value));
  const points = series.map((s, i) => `${(i / (series.length - 1) * width).toFixed(1)},${(height - 3 - s.value / max * (height - 6)).toFixed(1)}`).join(' ');
  return h('svg:svg', { class: 'ud-spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    h('svg:polyline', { points, fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
}

function bucketLabel(item, bucket) {
  if (bucket === 'day') return shortDate(item.from);
  if (bucket === 'week') return `${shortDate(item.from)}–${shortDate(item.to)}`;
  return monthLabel(item.from);
}

/** Стовпчикова діаграма з накопиченням; series[i].value — { key: число }. */
function stackedBars(series, keys, bucket, options = {}) {
  const width = 960, height = 260, left = 44, bottom = 34, top = 12;
  const totals = series.map(s => keys.reduce((sum, k) => sum + (s.value[k.key] || 0), 0));
  const raw = Math.max(1, ...totals);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const max = [1, 2, 2.5, 5, 10].map(f => f * mag).find(v => v >= raw) || raw;
  const step = (width - left - 8) / Math.max(1, series.length);
  const bar = Math.max(2, Math.min(38, step * 0.72));
  const y = v => height - bottom - v / max * (height - bottom - top);
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = max * f;
    return h('svg:g', {}, h('svg:line', { x1: left, x2: width, y1: y(v), y2: y(v), class: 'ud-grid' }), h('svg:text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'ud-axis', text: decimal(v) }));
  });
  const labelEvery = Math.ceil(series.length / (bucket === 'week' ? 9 : 16));
  const bars = series.map((s, i) => {
    let acc = 0;
    const x = left + i * step + (step - bar) / 2;
    const title = `${bucketLabel(s, bucket)}: ${keys.map(k => `${k.label} ${number(s.value[k.key] || 0)}`).join(', ')}`;
    return h('svg:g', { class: 'ud-bar' },
      h('svg:title', { text: title }),
      keys.map(k => {
        const v = s.value[k.key] || 0;
        if (!v) return null;
        const y1 = y(acc + v), y0 = y(acc); acc += v;
        return h('svg:rect', { x, y: y1, width: bar, height: Math.max(1, y0 - y1), rx: 2, fill: k.color });
      }),
      i % labelEvery === 0 ? h('svg:text', { x: x + bar / 2, y: height - bottom + 16, 'text-anchor': 'middle', class: 'ud-axis', text: bucketLabel(s, bucket) }) : null,
      options.onPick ? h('svg:rect', { x: left + i * step, y: top, width: step, height: height - bottom - top, fill: 'transparent', class: 'ud-hit', onclick: () => options.onPick(s) }) : null);
  });
  return h('div', { class: 'ud-chart' },
    h('svg:svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': options.label || 'Динаміка' }, grid, bars),
    h('div', { class: 'ud-legend' }, keys.map(k => h('span', {}, h('i', { style: { background: k.color } }), k.label))));
}

function rankBars(items, color, limit = 14, total = null) {
  const shown = items.slice(0, limit);
  if (!shown.length) return h('p', { class: 'ud-empty', text: 'За обраний період даних немає.' });
  const max = Math.max(1, ...shown.map(i => i.total));
  const sum = total == null ? items.reduce((s, i) => s + i.total, 0) : total;
  return h('div', { class: 'ud-rank' }, shown.map(item => h('div', { class: 'ud-rank-row', title: `${item.name}: ${number(item.total)}` },
    h('span', { class: 'ud-rank-name', text: item.name }),
    h('i', {}, h('b', { style: { width: `${item.total / max * 100}%`, background: color } })),
    h('strong', { text: number(item.total) }),
    h('small', { text: sum ? `${decimal(item.total / sum * 100)}%` : '' }))),
  items.length > limit ? h('p', { class: 'ud-more', text: `Ще ${items.length - limit} позицій — у «Зведеній таблиці».` }) : null);
}

function heatmap(matrix, color, onUnit) {
  const { metrics, rows } = matrix;
  if (!rows.length || !metrics.length) return h('p', { class: 'ud-empty', text: 'За обраний період даних немає.' });
  const cols = metrics.filter(m => m.name !== 'ВСЬОГО').slice(0, 18);
  const max = Math.max(1, ...rows.flatMap(r => cols.map(m => r.cells[m.id] || 0)));
  return h('div', { class: 'ud-scroll' }, h('table', { class: 'ud-heat' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Підрозділ' }), cols.map(m => h('th', { title: m.name }, h('span', { text: m.name }))), h('th', { text: 'Разом' }))),
    h('tbody', {}, rows.sort((a, b) => b.total - a.total).map(r => h('tr', {},
      h('th', {}, onUnit ? h('button', { type: 'button', class: 'ud-link', onclick: () => onUnit(r.unit), text: r.unit }) : r.unit),
      cols.map(m => { const v = r.cells[m.id] || 0; return h('td', { title: `${r.unit} · ${m.name}: ${number(v)}`, style: v ? { background: `color-mix(in srgb, ${color} ${Math.round(12 + v / max * 78)}%, transparent)` } : {} }, v ? number(v) : ''); }),
      h('td', { class: 'ud-total', text: number(r.total) }))))));
}

function weekdayBars(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  return h('div', { class: 'ud-week' }, items.map(i => h('div', { title: `${i.name}: ${number(i.value)}` },
    h('i', {}, h('b', { style: { height: `${i.value / max * 100}%` } })), h('strong', { text: number(i.value) }), h('span', { text: i.name }))));
}

/* ------------------------------ сторінки ------------------------------ */

function kpiCard(k, onClick) {
  const tone = TONE[k.tone] || 'var(--ud-blue)';
  let delta = 'немає попереднього періоду';
  let cls = '';
  if (k.delta != null) {
    const sign = k.delta > 0 ? '▲ +' : k.delta < 0 ? '▼ ' : '● ';
    delta = `${sign}${number(k.delta)}${k.deltaPercent != null ? ` (${k.deltaPercent > 0 ? '+' : ''}${decimal(k.deltaPercent)}%)` : ''} до попер.`;
    cls = k.delta > 0 ? ' up' : k.delta < 0 ? ' down' : '';
  }
  return h('article', { class: 'ud-kpi', style: { '--tone': tone }, onclick: onClick, role: onClick ? 'button' : null, tabindex: onClick ? 0 : null },
    h('span', { class: 'ud-kpi-label', text: k.label }),
    h('strong', { text: number(k.total) }),
    h('span', { class: `ud-delta${cls}`, text: delta }),
    sparkline(k.series, tone),
    h('small', { text: k.hint }));
}

function section(title, meta, ...body) {
  return h('section', { class: 'ud-card' }, h('header', {}, h('h3', { text: title }), meta ? h('span', { text: meta }) : null), ...body);
}

const PERSONNEL_KEYS = [{ key: 'kia', label: '200', color: 'var(--ud-red)' }, { key: 'wia', label: '300', color: 'var(--ud-amber)' }];
const OVT_KEYS = OVT_GROUPS.map(key => ({ key, label: groupInfo(key).short, color: OVT_COLORS[key] }));

/** Клік по стовпчику тижня/місяця відкриває цей тиждень чи місяць. */
function pickerFor(model, go) {
  if (model.bucket === 'day') return null;
  return item => { state.preset = model.bucket; state.anchor = item.from; go(); };
}

function summaryPage(model, go) {
  const units = [...model.units].sort((a, b) => b.personnel - a.personnel);
  const pick = pickerFor(model, go);
  return h('div', { class: 'ud-page' },
    h('div', { class: 'ud-kpis' }, model.kpis.map(k => kpiCard(k, () => { state.view = k.key === 'ammo' ? 'ammo' : ['destroyed', 'damaged', 'suppressed'].includes(k.key) ? 'ovt' : k.key === 'vgz' || k.key === 'kbb' ? 'units' : 'personnel'; if (OVT_GROUPS.includes(k.key)) state.ovt = k.key; go(); }))),
    h('div', { class: 'ud-grid-2' },
      section('Втрати о/с противника', model.bucket === 'day' ? 'по днях' : model.bucket === 'week' ? 'по тижнях' : 'по місяцях',
        stackedBars(model.personnelSeries, PERSONNEL_KEYS, model.bucket, { label: 'Втрати о/с по днях', onPick: pick })),
      section('ОВТ: знищено / пошкоджено / подавлено', null,
        stackedBars(model.ovtSeries, OVT_KEYS, model.bucket, { label: 'ОВТ по днях', onPick: pick }))),
    h('div', { class: 'ud-grid-3' },
      section('Підрозділи за втратами о/с', null, rankBars(units.filter(u => u.personnel).map(u => ({ name: u.unit, total: u.personnel })), 'var(--ud-violet)', 13)),
      section('Знищено ОВТ — топ', null, rankBars(model.groups.destroyed, OVT_COLORS.destroyed, 10)),
      section('Втрати за категоріями', null, rankBars(model.groups.categories, 'var(--ud-green)', 10))));
}

function unitsPage(model, go) {
  const cols = [['personnel', 'О/с'], ['kia', '200'], ['wia', '300'], ['destroyed', 'Знищ.'], ['damaged', 'Пошк.'], ['suppressed', 'Подав.'], ['ammo', 'БК'], ['vgz', 'ВгЗ'], ['kbb', 'КББ'], ['days', 'Днів']];
  const rows = [...model.units].sort((a, b) => (b[state.sort] || 0) - (a[state.sort] || 0));
  const max = Object.fromEntries(cols.map(([k]) => [k, Math.max(1, ...rows.map(r => r[k] || 0))]));
  const totals = Object.fromEntries(cols.map(([k]) => [k, rows.reduce((s, r) => s + (r[k] || 0), 0)]));
  return h('div', { class: 'ud-page' }, section('Підрозділи', 'натисніть заголовок, щоб сортувати; назву — щоб відфільтрувати',
    h('div', { class: 'ud-scroll' }, h('table', { class: 'ud-table' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Підрозділ' }), cols.map(([k, label]) => h('th', { class: state.sort === k ? 'sorted' : '' }, h('button', { type: 'button', onclick: () => { state.sort = k; go(); }, text: label }))))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('th', {}, h('button', { type: 'button', class: 'ud-link', onclick: () => { state.units = [r.unit]; state.view = 'summary'; go(); }, text: r.unit })),
        cols.map(([k]) => h('td', { class: 'ud-num' }, h('span', { class: 'ud-cellbar', style: { width: `${(r[k] || 0) / max[k] * 100}%` } }), h('span', { text: k === 'days' ? `${r[k]}` : number(r[k]) })))))),
      h('tfoot', {}, h('tr', {}, h('th', { text: 'Разом' }), cols.map(([k]) => h('td', { class: 'ud-num', text: k === 'days' ? `${model.activeDays}` : number(totals[k]) }))))))));
}

function personnelPage(model, go) {
  const pick = pickerFor(model, go);
  const units = [...model.units].sort((a, b) => b.personnel - a.personnel).filter(u => u.personnel);
  const perDay = model.activeDays ? model.kpis.find(k => k.key === 'personnel').total / model.activeDays : 0;
  return h('div', { class: 'ud-page' },
    h('div', { class: 'ud-kpis ud-kpis-3' }, model.kpis.filter(k => ['kia', 'wia', 'personnel'].includes(k.key)).map(k => kpiCard(k))),
    section('Динаміка 200 / 300', `у середньому ${decimal(perDay)} на добу з даними`, stackedBars(model.personnelSeries, PERSONNEL_KEYS, model.bucket, { onPick: pick })),
    h('div', { class: 'ud-grid-2' },
      section('Підрозділи: 200 і 300', null, units.length ? h('div', { class: 'ud-rank' }, units.map(u => {
        const max = Math.max(1, ...units.map(x => x.personnel));
        return h('div', { class: 'ud-rank-row', title: `${u.unit}: 200 — ${u.kia}, 300 — ${u.wia}` },
          h('span', { class: 'ud-rank-name', text: u.unit }),
          h('i', {}, h('b', { style: { width: `${u.kia / max * 100}%`, background: 'var(--ud-red)' } }), h('b', { style: { width: `${u.wia / max * 100}%`, background: 'var(--ud-amber)' } })),
          h('strong', { text: number(u.personnel) }), h('small', { text: `${u.kia} / ${u.wia}` }));
      })) : h('p', { class: 'ud-empty', text: 'За обраний період даних немає.' })),
      section('За днями тижня', 'втрати о/с разом', weekdayBars(model.weekday))));
}

function ovtPage(model, go) {
  const key = state.ovt;
  const color = OVT_COLORS[key];
  return h('div', { class: 'ud-page' },
    h('div', { class: 'ud-kpis ud-kpis-3' }, model.kpis.filter(k => OVT_GROUPS.includes(k.key)).map(k => kpiCard(k, () => { state.ovt = k.key; go(); }))),
    h('div', { class: 'ud-tabs' }, OVT_GROUPS.map(g => h('button', { type: 'button', 'aria-pressed': String(g === key), onclick: () => { state.ovt = g; go(); }, text: groupInfo(g).name }))),
    h('div', { class: 'ud-grid-2' },
      section(`${groupInfo(key).name}: типи ОВТ`, null, rankBars(model.groups[key], color, 24)),
      section('Динаміка', null, stackedBars(model.ovtSeries.map(s => ({ ...s, value: { [key]: s.value[key] } })), OVT_KEYS.filter(k => k.key === key), model.bucket))),
    section(`${groupInfo(key).name}: підрозділ × тип`, null, heatmap(model.matrix[key], color, unit => { state.units = [unit]; go(); })));
}

function ammoPage(model, go) {
  const items = model.groups.ammo.filter(i => i.name !== 'ВСЬОГО');
  return h('div', { class: 'ud-page' },
    h('div', { class: 'ud-kpis ud-kpis-3' }, model.kpis.filter(k => ['ammo', 'vgz', 'kbb'].includes(k.key)).map(k => kpiCard(k))),
    h('div', { class: 'ud-grid-2' },
      section('Витрата за типами боєприпасів', null, rankBars(items, 'var(--ud-green)', 20)),
      section('Втрати за категоріями', null, rankBars(model.groups.categories, 'var(--ud-violet)', 20))),
    section('Витрата БК: підрозділ × тип', null, heatmap(model.matrix.ammo, 'var(--ud-green)', unit => { state.units = [unit]; go(); })));
}

function download(name, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function tablePage(model) {
  const pivot = pivotRows(state.workbook, model.range, state.units);
  const groups = GROUPS.map(g => ({ ...g, metrics: pivot.metrics.filter(m => m.group === g.key) })).filter(g => g.metrics.length);
  const file = `УДШВ_${model.range.from}_${model.range.to}${unitsSuffix()}.csv`;
  return h('div', { class: 'ud-page' }, section('Зведена таблиця за період', `${pivot.metrics.length} показників із даними`,
    h('button', { class: 'ud-btn', type: 'button', onclick: () => download(file, csvRows(state.workbook, model.range, state.units)), text: 'Вивантажити CSV' }),
    h('div', { class: 'ud-scroll ud-scroll-tall' }, h('table', { class: 'ud-table ud-pivot' },
      h('thead', {},
        h('tr', {}, h('th', { rowspan: 2, text: 'Підрозділ' }), groups.map(g => h('th', { colspan: g.metrics.length, class: 'ud-group', text: g.name }))),
        h('tr', {}, groups.flatMap(g => g.metrics.map(m => h('th', { text: m.name }))))),
      h('tbody', {}, pivot.rows.map(r => h('tr', {}, h('th', { text: r.unit }), groups.flatMap(g => g.metrics.map(m => h('td', { class: 'ud-num', text: r.cells[m.id] ? number(r.cells[m.id]) : '' })))))),
      h('tfoot', {}, h('tr', {}, h('th', { text: 'Разом' }), groups.flatMap(g => g.metrics.map(m => h('td', { class: 'ud-num', text: number(pivot.totals[m.id]) })))))))));
}

function qualityPage() {
  const issues = validateWorkbook(state.workbook);
  const groups = groupIssues(issues);
  const wb = state.workbook;
  return h('div', { class: 'ud-page' },
    section('Аркуші', `${wb.records.length} рядків «підрозділ × день»`, h('div', { class: 'ud-scroll' }, h('table', { class: 'ud-table' },
      h('thead', {}, h('tr', {}, ['Аркуш', 'Днів', 'Рядків', 'Показників', 'Період'].map(t => h('th', { text: t })))),
      h('tbody', {}, wb.sheets.map(s => h('tr', {}, h('th', { text: s.name }), h('td', { class: 'ud-num', text: s.dates.length }), h('td', { class: 'ud-num', text: s.rowCount }), h('td', { class: 'ud-num', text: s.metricCount }),
        h('td', { text: s.dates.length ? `${dateLabel(s.dates.slice().sort()[0])} – ${dateLabel(s.dates.slice().sort().pop())}` : '—' }))))))),
    section('Перевірка даних', groups.length ? `${issues.length} зауважень` : 'зауважень немає',
      groups.length ? groups.map(g => h('details', { class: 'ud-issue' },
        h('summary', {}, h('strong', { text: g.text }), h('span', { text: ` · ${g.items.length}` })),
        h('ul', {}, g.items.slice(0, 40).map(i => h('li', { text: [i.sheet && `«${i.sheet}»`, i.rowNumber && `рядок ${i.rowNumber}`, i.unit, i.metric, i.raw].filter(Boolean).join(' · ') })),
          g.items.length > 40 ? h('li', { text: `… ще ${g.items.length - 40}` }) : null))) : h('p', { class: 'ud-empty', text: 'Дати, підрозділи й суми «ВСЬОГО» узгоджені.' })));
}

function periodControls(range, go) {
  const all = allDateRange(state.workbook);
  const set = (preset) => { state.preset = preset; if (preset !== 'custom') state.anchor = lastActiveDate(state.workbook); else { state.from = range.from; state.to = range.to; } go(); };
  const nav = step => { state.anchor = shiftAnchor(state.preset, state.anchor || range.from, step); go(); };
  const canNav = state.preset === 'week' || state.preset === 'month';
  const months = [...new Set(state.workbook.records.map(r => r.date.slice(0, 7)))].sort();
  return h('div', { class: 'ud-period' },
    h('div', { class: 'ud-seg', role: 'group', 'aria-label': 'Період' },
      [['week', 'Тиждень'], ['month', 'Місяць'], ['all', 'Весь період'], ['custom', 'Довільний']].map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(state.preset === k), onclick: () => set(k), text: label }))),
    canNav ? h('div', { class: 'ud-step' },
      h('button', { type: 'button', class: 'ud-btn quiet', title: 'Попередній', disabled: range.from <= all.from, onclick: () => nav(-1), text: '‹' }),
      h('strong', { text: periodTitle(range) }),
      h('button', { type: 'button', class: 'ud-btn quiet', title: 'Наступний', disabled: range.to >= all.to, onclick: () => nav(1), text: '›' })) : null,
    state.preset === 'month' ? h('select', { 'aria-label': 'Місяць', onchange: e => { state.anchor = `${e.target.value}-01`; go(); } },
      months.map(m => h('option', { value: m, selected: range.from.startsWith(m), text: monthLabel(`${m}-01`) }))) : null,
    state.preset === 'custom' ? h('div', { class: 'ud-custom' },
      h('label', {}, 'з ', h('input', { type: 'date', value: state.from, min: all.from, max: all.to, onchange: e => { state.from = e.target.value; go(); } })),
      h('label', {}, 'по ', h('input', { type: 'date', value: state.to, min: all.from, max: all.to, onchange: e => { state.to = e.target.value; go(); } }))) : null,
    state.preset === 'all' ? h('strong', { text: periodTitle(range) }) : null,
    unitPicker(go));
}

// Підпис вибраних підрозділів: один — назва, кілька — кількість і перелік у підказці.
function unitsLabel(units, prefix = '') {
  const list = normalizeUnits(units);
  if (!list.length) return '';
  return prefix + (list.length === 1 ? list[0] : `${list.length} підрозділи: ${list.join(', ')}`);
}

function unitsSuffix() {
  return state.units.length ? '_' + (state.units.length === 1 ? state.units[0] : `${state.units.length}-підрозділи`).replace(/[^\p{L}\p{N}]+/gu, '-') : '';
}

// Випадаючий список із прапорцями: можна обрати кілька підрозділів. Відкритий стан і фокус переживають перемальовування.
function unitPicker(go) {
  const all = state.workbook.units;
  const chosen = new Set(state.units);
  const summary = !chosen.size ? 'Усі підрозділи' : chosen.size === 1 ? [...chosen][0] : `Обрано: ${chosen.size} з ${all.length}`;
  const details = h('details', { class: 'ud-multi', open: state.unitsOpen, ontoggle: e => { state.unitsOpen = e.target.open; } },
    h('summary', { class: 'ud-multi-btn', title: chosen.size > 1 ? [...chosen].join(', ') : null, text: summary }),
    h('div', { class: 'ud-multi-pop', role: 'group', 'aria-label': 'Підрозділи' },
      h('div', { class: 'ud-multi-actions' },
        h('button', { type: 'button', class: 'ud-link', onclick: () => { state.units = []; state.focusUnit = null; go(); }, text: 'Усі підрозділи' }),
        h('button', { type: 'button', class: 'ud-link', onclick: () => { state.units = [...all]; state.focusUnit = null; go(); }, text: 'Обрати всі' })),
      all.map(u => h('label', { class: 'ud-multi-row' },
        h('input', { type: 'checkbox', value: u, checked: !chosen.size || chosen.has(u), onchange: e => {
          const next = new Set(state.units.length ? state.units : all);
          if (e.target.checked) next.add(u); else next.delete(u);
          // Позначено все або нічого — це «усі підрозділи» (у списку всі прапорці тоді стоять).
          state.units = !next.size || next.size === all.length ? [] : all.filter(x => next.has(x));
          state.focusUnit = u;
          go();
        } }),
        h('span', { text: u })))));
  if (state.focusUnit) {
    const target = state.focusUnit;
    queueMicrotask(() => { state.focusUnit = null; [...details.querySelectorAll('input')].find(i => i.value === target)?.focus(); });
  }
  return h('div', { class: 'ud-unit' }, h('span', { text: 'Підрозділ' }), details);
}

// Клік поза списком підрозділів закриває його.
document.addEventListener('click', e => {
  if (!state.unitsOpen) return;
  const open = document.querySelector('.ud-multi[open]');
  if (open && !open.contains(e.target)) { open.open = false; state.unitsOpen = false; }
});

export function render(host, workbook, options = {}) {
  if (!host || workbook?.kind !== 'udshv') return;
  ensureState(workbook);
  host.classList.add('udshv-mode');
  let root = host.querySelector(':scope > #udshv-dashboard-root');
  if (!root) { root = h('div', { id: 'udshv-dashboard-root' }); host.append(root); }
  const go = () => render(host, workbook, options);
  const range = currentRange();
  const model = createDashboardModel(workbook, { range, unit: state.units, preset: state.preset });
  const nav = [['summary', 'Зведення УДШВ'], ['units', 'Підрозділи'], ['personnel', 'Втрати о/с'], ['ovt', 'ОВТ'], ['ammo', 'Витрата БК'], ['table', 'Зведена таблиця'], ['quality', 'Перевірка даних']];
  if (!nav.some(([k]) => k === state.view)) state.view = 'summary';
  const page = state.view === 'units' ? unitsPage(model, go)
    : state.view === 'personnel' ? personnelPage(model, go)
      : state.view === 'ovt' ? ovtPage(model, go)
        : state.view === 'ammo' ? ammoPage(model, go)
          : state.view === 'table' ? tablePage(model)
            : state.view === 'quality' ? qualityPage()
              : summaryPage(model, go);
  const compare = model.hasPrevious ? `порівняння з ${dateLabel(model.previousRange.from)} – ${dateLabel(model.previousRange.to)}` : 'попереднього періоду в таблиці немає';
  root.textContent = '';
  root.append(
    h('header', { class: 'ud-hero' },
      h('div', {},
        h('span', { class: 'ud-eyebrow', text: 'Угруповання ДШВ · локальна аналітика' }),
        h('h1', { text: 'Дашборд УДШВ' }),
        h('p', { text: `${workbook.sourceName || 'Таблиця'} · ${workbook.sheets.length} ${workbook.sheets.length === 1 ? 'аркуш' : 'аркуші(в)'} · ${dateLabel(allDateRange(workbook).from)} – ${dateLabel(allDateRange(workbook).to)} · лише читання` })),
      options.canRefresh ? h('button', { class: 'ud-btn', type: 'button', onclick: () => options.refresh?.(), text: 'Оновити з файлу' }) : null),
    periodControls(range, go),
    h('div', { class: 'ud-context' },
      h('span', { text: `${periodTitle(range)}${unitsLabel(state.units, ' · ')}` }),
      h('span', { text: `${model.activeDays} з ${model.days} днів із даними · ${compare}` }),
      state.units.length ? h('button', { type: 'button', class: 'ud-link', onclick: () => { state.units = []; go(); }, text: '× усі підрозділи' }) : null),
    h('nav', { class: 'ud-nav', 'aria-label': 'Розділи дашборда УДШВ' }, nav.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(state.view === key), onclick: () => { state.view = key; go(); }, text: label }))),
    page);
}

export function unmount(host) {
  if (!host) return;
  host.classList.remove('udshv-mode');
  host.querySelector(':scope > #udshv-dashboard-root')?.remove();
}

window.UDSHVDashboard = { parse: parseUdshvWorkbook, render, unmount };
document.dispatchEvent(new Event('udshv:ready'));
