import {
  SHEET_ORDER,
  aggregateSheet,
  allDateRange,
  createDashboardModel,
  csvRowsForJournal,
  csvRowsForSheet,
  groupIssues,
  searchJournal,
} from './pvk-dashboard-core.js';
import { consumeOwnLossesTabRequest, ownLossesHost, ownLossesPage } from './own-losses-dashboard.js';
import { playMotion, resetMotion } from './dashboard-motion.js';
import { MINE_SLOT, MINE_VIEW, personalNavItem } from './personal-dashboard.js';

const state = {
  workbook: null,
  view: 'summary',
  preset: 'all',
  from: '',
  to: '',
  tableSheet: 'АА',
  journalQuery: '',
  journalLimit: 300,
};
const JOURNAL_PAGE_SIZE = 300;

const number = value => Math.round(Number(value) || 0).toLocaleString('uk-UA');
const decimal = value => (Number(value) || 0).toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const percent = value => value == null ? '—' : `${decimal(value)}%`;
const dateLabel = value => value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—';
const dayNumber = value => value ? Date.parse(`${value}T00:00:00Z`) / 864e5 : NaN;
const isoFromDay = value => new Date(value * 864e5).toISOString().slice(0, 10);

function h(tag, attrs = {}, ...children) {
  const svg = tag.startsWith('svg:');
  const node = svg
    ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4))
    : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    // SVG elements expose className as a read-only SVGAnimatedString.
    if (key === 'class') node.setAttribute('class', value);
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    // CSS custom properties (--level) are set only through setProperty.
    else if (key === 'style' && typeof value === 'object') for (const [name, css] of Object.entries(value)) node.style.setProperty(name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`), css);
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
  state.workbook = workbook;
  const range = allDateRange(workbook);
  const view = workbook?.sheets?.length ? 'summary' : 'journal';
  Object.assign(state, { view, preset: 'all', from: range.from, to: range.to, tableSheet: 'АА', journalQuery: '', journalLimit: JOURNAL_PAGE_SIZE });
}

function setPreset(workbook, preset) {
  const all = allDateRange(workbook);
  state.preset = preset;
  state.to = all.to;
  if (!all.to) state.from = '';
  else if (preset === 'all') state.from = all.from;
  else state.from = isoFromDay(Math.max(dayNumber(all.from), dayNumber(all.to) - Number(preset) + 1));
}

function sparkline(series, color = 'var(--pvk-blue)') {
  const width = 190;
  const height = 50;
  if (!series.length) return h('div', { class: 'pvk-spark pvk-spark-empty', text: 'Немає даних за днями' });
  const maximum = Math.max(1, ...series.map(item => item.value));
  const points = series.map((item, index) => {
    const x = series.length === 1 ? width / 2 : index / (series.length - 1) * width;
    const y = height - 5 - item.value / maximum * (height - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return h('svg:svg', { class: 'pvk-spark', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Динаміка показника за днями' },
    h('svg:polyline', { points, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

function metricCard(widget) {
  const delta = widget.deltaPercent == null ? 'немає бази порівняння' : `${widget.deltaPercent >= 0 ? '+' : ''}${decimal(widget.deltaPercent)}% до попереднього періоду`;
  return h('article', { class: `pvk-metric${widget.known ? '' : ' pvk-metric-unknown'}`, 'data-metric': widget.metric },
    h('div', { class: 'pvk-metric-head' },
      h('h4', { text: widget.metric }),
      widget.marker ? h('span', { class: 'pvk-new', text: widget.marker }) : null),
    h('strong', { class: 'pvk-value', text: number(widget.total) }),
    h('span', { class: 'pvk-delta', text: delta }),
    sparkline(widget.series),
    h('dl', { class: 'pvk-stats' },
      h('div', {}, h('dt', { text: 'Середнє за добу' }), h('dd', { text: decimal(widget.averagePerDay) })),
      h('div', {}, h('dt', { text: 'Максимум' }), h('dd', { text: `${number(widget.maximum)} · ${dateLabel(widget.maximumDate)}` }))));
}

function ranking(group) {
  const maximum = Math.max(1, ...group.widgets.map(widget => widget.total));
  return h('div', { class: 'pvk-ranking', role: 'img', 'aria-label': `Рейтинг: ${group.name}` }, group.widgets.map(widget =>
    h('div', { class: 'pvk-rank-row' },
      h('span', { text: widget.metric }),
      h('i', {}, h('b', { style: { width: `${widget.total / maximum * 100}%` } })),
      h('strong', { text: number(widget.total) }))));
}

function composition(group) {
  const total = group.widgets.reduce((sum, widget) => sum + widget.total, 0);
  const colors = ['#2a8cff', '#e8af35', '#35c57c', '#9d7bff', '#ef6671', '#38b9c9'];
  let offset = 0;
  const stops = group.widgets.map((widget, index) => {
    const start = total ? offset / total * 100 : 0;
    offset += widget.total;
    const end = total ? offset / total * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${end}%`;
  }).join(', ');
  return h('div', { class: 'pvk-composition' },
    h('div', { class: 'pvk-donut', style: { background: total ? `conic-gradient(${stops})` : 'conic-gradient(var(--pvk-track) 0 100%)' } }, h('span', {}, h('b', { text: number(total) }), h('small', { text: 'разом' }))),
    h('div', { class: 'pvk-legend' }, group.widgets.map((widget, index) => h('span', {}, h('i', { style: { background: colors[index % colors.length] } }), `${widget.metric}: ${number(widget.total)}`))));
}

function stackedDynamics(group) {
  const colors = ['#2a8cff', '#e8af35', '#35c57c', '#9d7bff', '#ef6671', '#38b9c9'];
  const dates = [...new Set(group.widgets.flatMap(widget => widget.series.map(item => item.date)))].sort();
  if (!dates.length) return h('p', { class: 'pvk-empty', text: 'Немає даних для накопичувальної динаміки.' });
  const width = 920;
  const height = 190;
  const maps = group.widgets.map(widget => new Map(widget.series.map(item => [item.date, item.value])));
  const totals = dates.map(date => maps.reduce((sum, values) => sum + (values.get(date) || 0), 0));
  const maximum = Math.max(1, ...totals);
  const baseline = Array(dates.length).fill(0);
  const chart = h('svg:svg', { class: 'pvk-stacked', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Динаміка з накопиченням: ${group.name}` });
  for (let grid = 0; grid <= 3; grid++) chart.append(h('svg:line', { x1: 8, x2: width - 8, y1: 8 + grid * 56, y2: 8 + grid * 56, class: 'pvk-gridline' }));
  group.widgets.forEach((widget, index) => {
    const top = dates.map((date, dateIndex) => baseline[dateIndex] + (maps[index].get(date) || 0));
    const x = dateIndex => 8 + dateIndex / Math.max(1, dates.length - 1) * (width - 16);
    const y = value => height - 10 - value / maximum * (height - 20);
    const upper = top.map((value, dateIndex) => `${x(dateIndex).toFixed(1)},${y(value).toFixed(1)}`);
    const lower = baseline.map((value, dateIndex) => `${x(dateIndex).toFixed(1)},${y(value).toFixed(1)}`).reverse();
    chart.append(h('svg:polygon', { points: [...upper, ...lower].join(' '), fill: colors[index % colors.length], opacity: 0.78 }));
    top.forEach((value, dateIndex) => { baseline[dateIndex] = value; });
  });
  return h('div', { class: 'pvk-stacked-wrap' },
    h('strong', { text: 'Динаміка з накопиченням' }),
    chart,
    h('div', { class: 'pvk-lines-legend' }, group.widgets.map((widget, index) => h('span', {}, h('i', { style: { background: colors[index % colors.length] } }), widget.metric))));
}

function objectHeatmap(group, sheet) {
  const months = [...new Set(sheet.rows.map(row => row.date?.slice(0, 7)).filter(Boolean))].sort();
  if (!months.length) return h('p', { class: 'pvk-empty', text: 'Немає дат для теплової карти.' });
  const cells = [];
  let maximum = 0;
  for (const widget of group.widgets) for (const month of months) {
    const value = widget.series.filter(item => item.date.startsWith(month)).reduce((sum, item) => sum + item.value, 0);
    maximum = Math.max(maximum, value);
    cells.push({ metric: widget.metric, month, value });
  }
  return h('div', { class: 'pvk-heat-scroll' }, h('table', { class: 'pvk-heat' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Категорія' }), months.map(month => h('th', { text: month })))),
    h('tbody', {}, group.widgets.map(widget => h('tr', {},
      h('th', { text: widget.metric }),
      months.map(month => {
        const cell = cells.find(item => item.metric === widget.metric && item.month === month);
        const alpha = maximum ? 0.12 + cell.value / maximum * 0.78 : 0.08;
        return h('td', { style: { background: `rgba(42,140,255,${alpha})` }, title: `${widget.metric} · ${month}: ${cell.value}`, text: number(cell.value) });
      }))))));
}

function groupOverview(group, sheet) {
  const items = [ranking(group)];
  if (group.name === 'Вертольоти' || group.name === 'Літаки' || group.name === 'Результат') items.push(composition(group));
  if (group.name === 'Вертольоти' || group.name === 'Літаки' || group.name === 'Результат') items.push(stackedDynamics(group));
  if (group.name === 'Уражені об’єкти') items.push(objectHeatmap(group, sheet));
  return h('div', { class: 'pvk-group-overview' }, items);
}

function sheetPage(sheet) {
  return h('div', { class: 'pvk-page' },
    h('header', { class: 'pvk-page-head' },
      h('div', {}, h('span', { class: 'pvk-eyebrow', text: sheet.name === 'АА' ? 'Армійська авіація' : sheet.name === 'ПС' ? 'Тактична авіація' : 'Уражені об’єкти та витрата' }), h('h2', { text: sheet.name })),
      h('strong', { text: `${sheet.metrics.length} показників` })),
    sheet.groups.map(group => h('section', { class: 'pvk-section' },
      h('header', {}, h('h3', { text: group.name }), group.unknown ? h('span', { class: 'pvk-new', text: 'нові стовпці' }) : null),
      groupOverview(group, sheet),
      group.name === 'Результат' ? h('div', { class: 'pvk-result-rates' },
        h('article', {}, h('span', { text: '% уражених' }), h('strong', { text: percent(sheet.affectedPercent) }), h('small', { text: 'Уражено / (Уражено + НЕ уражено) × 100' }), sparkline(sheet.affectedSeries, '#35c57c')),
        sheet.name === 'ПС' ? h('article', {}, h('span', { text: 'Частка «Дорозвідується»' }), h('strong', { text: percent(sheet.reconnaissancePercent) }), h('small', { text: 'Від усіх трьох результатів' })) : null) : null,
      h('div', { class: 'pvk-metric-grid' }, group.widgets.map(metricCard)))));
}

/** Міні-графік у картці показника: лінія з заливкою й точкою на останньому дні. Без даних за днями — нічого не малює. */
function miniSpark(series) {
  if (!series?.length) return null;
  const width = 120;
  const height = 44;
  const maximum = Math.max(1, ...series.map(item => item.value));
  const points = series.map((item, index) => [
    series.length === 1 ? width / 2 : index / (series.length - 1) * width,
    height - 5 - item.value / maximum * (height - 13),
  ]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = points.at(-1);
  return h('svg:svg', { class: 'pvk-kpi-spark', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Динаміка показника за днями' },
    h('svg:polygon', { class: 'area', points: `${points[0][0].toFixed(1)},${height} ${line} ${lastX.toFixed(1)},${height}` }),
    h('svg:polyline', { class: 'line', points: line }),
    h('svg:circle', { class: 'dot', cx: lastX.toFixed(1), cy: lastY.toFixed(1), r: 3 }));
}

/** Кільце-відсоток у картці показника (замість міні-графіка, коли показник — частка). */
function ratioRing(value) {
  if (value == null || !Number.isFinite(value)) return null;
  const clamped = Math.max(0, Math.min(100, value));
  return h('div', { class: 'pvk-kpi-ring', role: 'img', 'aria-label': `${decimal(clamped)}%`, style: { '--p': clamped.toFixed(1) } });
}

/**
 * Картка показника. icon — ключ плитки-іконки (маски [data-ic] у dashboard-layout.css),
 * series — ряд по днях для міні-графіка, ring — відсоток для кільця. Без них картка лишається текстовою.
 */
function kpi(label, value, detail, tone = '', { icon = '', series = null, ring = null } = {}) {
  const visual = ring != null ? ratioRing(ring) : miniSpark(series);
  return h('article', { class: `pvk-kpi ${tone}` },
    icon ? h('i', { class: 'pvk-kpi-ic', 'data-ic': icon, 'aria-hidden': 'true' }) : null,
    h('div', { class: 'pvk-kpi-text' }, h('span', { text: label }), h('strong', { text: value }), h('small', { text: detail })),
    visual);
}

const MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];

/** Рядок на місяць, стовпець на число місяця; колір дня — частка від найактивнішого дня. */
function activityCalendar(series, range) {
  if (!range.from || !range.to) return h('p', { class: 'pvk-empty', text: 'У таблиці ще немає дат.' });
  const values = new Map(series.map(item => [item.date, item.value]));
  const maximum = Math.max(1, ...values.values());
  const months = new Map();
  for (let day = dayNumber(range.from); day <= dayNumber(range.to); day++) {
    const date = isoFromDay(day);
    const value = values.get(date) || 0;
    const month = date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(h('span', {
      class: value ? 'pvk-day' : 'pvk-day is-empty',
      title: `${dateLabel(date)} · АУ: ${value}`,
      'aria-label': `${dateLabel(date)}, АУ ${value}`,
      style: { '--level': String(value / maximum), gridColumn: String(Number(date.slice(8, 10))) },
    }, h('b', { text: String(Number(date.slice(8, 10))) }), h('small', { text: number(value) })));
  }
  return h('div', { class: 'pvk-calendar' }, [...months].map(([month, days]) => h('div', { class: 'pvk-cal-month' },
    h('span', { class: 'pvk-cal-label', text: `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}` }),
    h('div', { class: 'pvk-cal-days' }, days))));
}

function multiLine(dynamics) {
  const definitions = [
    ['au', 'АУ', '#2a8cff'],
    ['munitions', 'БП', '#e8af35'],
    ['objects', 'Об’єкти', '#35c57c'],
    ['expenditure', 'Витрата', '#ef6671'],
  ];
  const dates = [...new Set(definitions.flatMap(([key]) => dynamics[key].map(item => item.date)))].sort();
  if (!dates.length) return h('p', { class: 'pvk-empty', text: 'Немає даних для динаміки.' });
  const width = 920;
  const height = 250;
  const maximum = Math.max(1, ...definitions.flatMap(([key]) => dynamics[key].map(item => item.value)));
  const svg = h('svg:svg', { class: 'pvk-lines', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Загальна динаміка за обраний період' });
  for (let grid = 0; grid <= 4; grid++) svg.append(h('svg:line', { x1: 12, x2: width - 12, y1: 12 + grid * 55, y2: 12 + grid * 55, class: 'pvk-gridline' }));
  for (const [key, label, color] of definitions) {
    const map = new Map(dynamics[key].map(item => [item.date, item.value]));
    const points = dates.map((date, index) => `${(12 + index / Math.max(1, dates.length - 1) * (width - 24)).toFixed(1)},${(height - 18 - (map.get(date) || 0) / maximum * (height - 36)).toFixed(1)}`).join(' ');
    svg.append(h('svg:polyline', { points, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'data-label': label }));
  }
  return h('div', { class: 'pvk-lines-wrap' }, svg, h('div', { class: 'pvk-lines-legend' }, definitions.map(([, label, color]) => h('span', {}, h('i', { style: { background: color } }), label))));
}

function summaryPage(model) {
  const summary = model.summary;
  return h('div', { class: 'pvk-page' },
    h('header', { class: 'pvk-page-head' }, h('div', {}, h('span', { class: 'pvk-eyebrow', text: 'Усі підпорядковані підрозділи' }), h('h2', { text: 'Зведення ПВК' }))),
    h('div', { class: 'pvk-kpis' },
      kpi('АУ · разом', number(summary.totalAu), `АА ${number(summary.aaAu)} · ПС ${number(summary.airAu)}`, 'blue', { icon: 'plane', series: summary.dynamics.au }),
      kpi('Усього БП', number(summary.munitions), `АА ${number(summary.aaMunitions)} · ПС ${number(summary.airMunitions)}`, 'amber', { icon: 'bullet', series: summary.dynamics.munitions }),
      kpi('Уражено', number(summary.affected), `НЕ уражено ${number(summary.notAffected)}`, 'green', { icon: 'target', series: summary.dynamics.affected }),
      kpi('Дорозвідується', number(summary.reconnaissance), 'Окремий результат ПС', 'violet', { icon: 'radar', series: summary.dynamics.reconnaissance }),
      kpi('% уражених', percent(summary.affectedPercent), 'Уражено / (Уражено + НЕ уражено)', 'green', { icon: 'shield', ring: summary.affectedPercent }),
      kpi('Уражені об’єкти', number(summary.objects), 'Без показника «Витрата»', 'blue', { icon: 'pin', series: summary.dynamics.objects }),
      kpi('Витрата', number(summary.expenditure), 'Окремо від об’єктів', 'red', { icon: 'burst', series: summary.dynamics.expenditure }),
      summary.journalRecords == null ? null : kpi('Таблиця 1', number(summary.journalRecords), 'Записів у журналі ударів', 'violet', { icon: 'doc' })),
    h('section', { class: 'pvk-section' }, h('header', {}, h('h3', { text: 'Календар активності' }), h('span', { text: 'Сума АУ за днями' })), activityCalendar(summary.activity, model.range)),
    h('section', { class: 'pvk-section' }, h('header', {}, h('h3', { text: 'Загальна динаміка' }), h('span', { text: 'Обраний період' })), multiLine(summary.dynamics)));
}

/* ------------------------- «Таблиця 1»: журнал ударів ------------------------- */

function dayBars(series, range) {
  if (!series.length) return h('p', { class: 'pvk-empty', text: 'За період немає записів із датою.' });
  const values = new Map(series.map(item => [item.date, item.value]));
  const first = dayNumber(range.from || series[0].date), last = dayNumber(range.to || series.at(-1).date);
  const days = []; for (let day = first; day <= last; day++) days.push(isoFromDay(day));
  const width = 920, height = 150, maximum = Math.max(1, ...series.map(item => item.value));
  const step = (width - 16) / Math.max(1, days.length);
  const chart = h('svg:svg', { class: 'pvk-daybars', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Кількість ударів за днями' });
  days.forEach((date, index) => {
    const value = values.get(date) || 0; if (!value) return;
    const barHeight = value / maximum * (height - 20);
    chart.append(h('svg:rect', { x: (8 + index * step).toFixed(1), y: (height - 10 - barHeight).toFixed(1), width: Math.max(1, step - 1).toFixed(1), height: barHeight.toFixed(1), rx: 1, fill: 'var(--pvk-blue)' },
      h('svg:title', { text: `${dateLabel(date)}: ${value}` })));
  });
  return h('div', { class: 'pvk-lines-wrap' }, chart,
    h('div', { class: 'pvk-lines-legend' }, h('span', { text: `${dateLabel(days[0])} – ${dateLabel(days.at(-1))}` }), h('span', { text: `максимум ${number(maximum)} за добу` })));
}

function hourBars(hours) {
  const maximum = Math.max(1, ...hours);
  return h('div', { class: 'pvk-hours', role: 'img', 'aria-label': 'Розподіл ударів за годинами доби' }, hours.map((value, hour) =>
    h('span', { title: `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59 · ${value}` },
      h('b', { style: { height: `${Math.round(value / maximum * 100)}%` } }),
      h('small', { text: String(hour).padStart(2, '0') }))));
}

function valueRanking(items, total, limit = 12) {
  if (!items.length) return h('p', { class: 'pvk-empty', text: 'Значень за період немає.' });
  const maximum = Math.max(1, ...items.map(item => item.count));
  return h('div', {},
    h('div', { class: 'pvk-ranking' }, items.slice(0, limit).map(item => h('div', { class: 'pvk-rank-row' },
      h('span', { text: item.value, title: item.value }),
      h('i', {}, h('b', { style: { width: `${item.count / maximum * 100}%` } })),
      h('strong', { text: total ? `${number(item.count)} · ${decimal(item.count / total * 100)}%` : number(item.count) })))),
    items.length > limit ? h('p', { class: 'pvk-more', text: `Ще ${number(items.length - limit)} значень — див. таблицю записів нижче.` }) : null);
}

function journalColumnCard(column, journal) {
  const filledNote = `заповнено ${number(column.filled)} з ${number(journal.total)}`;
  let body;
  switch (column.kind) {
    case 'index': body = [h('strong', { class: 'pvk-value', text: number(journal.total) }), h('span', { class: 'pvk-delta', text: 'записів за період' })]; break;
    case 'date': body = [h('strong', { class: 'pvk-value', text: number(column.days) }), h('span', { class: 'pvk-delta', text: `днів з ударами · ${dateLabel(column.first)} – ${dateLabel(column.last)}` })]; break;
    case 'time': body = [h('strong', { class: 'pvk-value', text: number(column.withTime) }), h('span', { class: 'pvk-delta', text: `записів із часом · розподіл за годинами вище` })]; break;
    case 'coords': body = [h('strong', { class: 'pvk-value', text: number(column.filled) }), h('span', { class: 'pvk-delta', text: `записів із координатами · без координат ${number(column.empty)}` })]; break;
    case 'target': body = [
      h('strong', { class: 'pvk-value', text: number(column.distinct) }), h('span', { class: 'pvk-delta', text: `унікальних цілей · ${filledNote}` }),
      column.repeated.length ? [h('h5', { text: 'Повторні цілі' }), valueRanking(column.repeated, 0, 10)] : h('p', { class: 'pvk-empty', text: 'Повторних цілей немає.' })]; break;
    case 'numeric': body = [
      h('strong', { class: 'pvk-value', text: decimal(column.sum) }), h('span', { class: 'pvk-delta', text: `разом · ${filledNote}` }),
      sparkline(column.series),
      h('dl', { class: 'pvk-stats' },
        h('div', {}, h('dt', { text: 'Середнє на запис' }), h('dd', { text: decimal(column.average) })),
        h('div', {}, h('dt', { text: 'Максимум' }), h('dd', { text: decimal(column.max) })))]; break;
    default: body = [h('span', { class: 'pvk-delta', text: `${number(column.distinct)} різних значень · ${filledNote}` }), valueRanking(column.values, column.filled)];
  }
  const wide = column.kind === 'category' || column.kind === 'target';
  return h('article', { class: `pvk-metric pvk-journal-card${wide ? ' pvk-wide' : ''}`, 'data-column': column.header },
    h('div', { class: 'pvk-metric-head' }, h('h4', { text: column.header })), body);
}

function journalRecords(journal, options) {
  const count = h('span');
  const tbody = h('tbody');
  const more = h('div', { class: 'pvk-table-actions' });
  const paint = () => {
    const rows = searchJournal(journal, state.journalQuery);
    count.textContent = state.journalQuery ? `знайдено ${number(rows.length)} з ${number(journal.total)}` : `${number(rows.length)} записів`;
    tbody.textContent = '';
    tbody.append(...rows.slice(0, state.journalLimit).map(row => h('tr', {},
      journal.headers.map(header => h('td', { text: row.values?.[header] ?? '' })))));
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: journal.headers.length, class: 'pvk-empty', text: 'Записів не знайдено.' })));
    more.textContent = '';
    if (rows.length > state.journalLimit) {
      more.append(h('button', { class: 'btn quiet', type: 'button', onclick: () => { state.journalLimit += JOURNAL_PAGE_SIZE; paint(); } }, `Показати ще (${number(rows.length - state.journalLimit)})`));
    }
    return rows;
  };
  const search = h('input', { type: 'search', value: state.journalQuery, placeholder: 'Пошук: ціль, населений пункт, засоби…', 'aria-label': 'Пошук у Таблиці 1',
    oninput: event => { state.journalQuery = event.target.value; state.journalLimit = JOURNAL_PAGE_SIZE; paint(); } });
  const exportButton = h('button', { class: 'btn primary', type: 'button', onclick: () => {
    const range = [journal.rows[0]?.date, journal.rows.at(-1)?.date].filter(Boolean).sort();
    options.downloadCSV(`EasyWAR_PVK_Таблиця1_${range[0] || 'all'}_${range.at(-1) || 'all'}.csv`, csvRowsForJournal(journal, searchJournal(journal, state.journalQuery)));
  } }, 'Завантажити CSV');
  paint();
  return h('section', { class: 'pvk-section' },
    h('header', {}, h('h3', { text: 'Записи' }), count),
    h('div', { class: 'pvk-table-actions pvk-journal-tools' }, search, exportButton),
    h('div', { class: 'pvk-table-scroll pvk-journal-scroll' }, h('table', { class: 'pvk-table pvk-journal-table' },
      h('thead', {}, h('tr', {}, journal.headers.map(header => h('th', { text: header })))), tbody)),
    more);
}

function journalPage(model, options) {
  const journal = model.journal;
  return h('div', { class: 'pvk-page' },
    h('header', { class: 'pvk-page-head' },
      h('div', {}, h('span', { class: 'pvk-eyebrow', text: 'Журнал ударів' }), h('h2', { text: journal.name })),
      h('strong', { text: `${journal.headers.length} стовпців` })),
    h('div', { class: 'pvk-kpis' },
      kpi('Записів', number(journal.total), 'Ударів за період', 'blue', { icon: 'doc' }),
      kpi('Днів з ударами', number(journal.days), `${dateLabel(model.range.from)} – ${dateLabel(model.range.to)}`, 'amber', { icon: 'clock' }),
      journal.targets == null ? null : kpi('Унікальних цілей', number(journal.targets), 'За «Номер цілі»', 'green', { icon: 'target' }),
      journal.withCoordinates == null ? null : kpi('Із координатами', number(journal.withCoordinates), `Без координат ${number(journal.total - journal.withCoordinates)}`, 'violet', { icon: 'pin' }),
      journal.confirmed ? kpi('Підтверджено відео', percent(journal.confirmed.percent), `Фактичні приходи ${decimal(journal.confirmed.counted)} з витрати АЗУ ${decimal(journal.confirmed.reported)}`, 'green', { icon: 'shield', ring: journal.confirmed.percent }) : null),
    h('section', { class: 'pvk-section' }, h('header', {}, h('h3', { text: 'Удари за днями' }), h('span', { text: 'Кількість записів' })), dayBars(journal.series, model.range)),
    journal.columns.some(column => column.kind === 'time')
      ? h('section', { class: 'pvk-section' }, h('header', {}, h('h3', { text: 'Час удару' }), h('span', { text: 'Розподіл за годинами доби' })), hourBars(journal.hours))
      : null,
    h('section', { class: 'pvk-section' }, h('header', {}, h('h3', { text: 'Усі стовпці журналу' }), h('span', { text: 'Кожен стовпець — окремий блок' })),
      h('div', { class: 'pvk-metric-grid pvk-journal-grid' }, journal.columns.map(column => journalColumnCard(column, journal)))),
    journalRecords(journal, options));
}

function tablePage(model, options) {
  const sheet = model.sheets.find(item => item.name === state.tableSheet) || model.sheets[0];
  const aggregate = aggregateSheet(sheet, model.range);
  const table = h('table', { class: 'pvk-table' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Період' }), aggregate.metrics.map(metric => h('th', { text: metric })))),
    h('tbody', {},
      aggregate.rows.map(row => h('tr', {}, h('th', { text: row.period }), aggregate.metrics.map(metric => h('td', { text: number(row.values[metric]) })))),
      h('tr', { class: 'pvk-total' }, h('th', { text: 'Разом' }), aggregate.metrics.map(metric => h('td', { text: number(aggregate.totals[metric]) })))));
  const select = h('select', { 'aria-label': 'Аркуш зведеної таблиці', onchange: event => { state.tableSheet = event.target.value; options.rerender(); } }, model.sheets.map(item => h('option', { value: item.name, selected: item.name === sheet.name, text: item.name })));
  const exportButton = h('button', { class: 'btn primary', type: 'button', onclick: () => options.downloadCSV(`EasyWAR_PVK_${sheet.name}_${model.range.from || 'all'}_${model.range.to || 'all'}.csv`, csvRowsForSheet(sheet, model.range)) }, 'Завантажити CSV');
  return h('div', { class: 'pvk-page' },
    h('header', { class: 'pvk-page-head' }, h('div', {}, h('span', { class: 'pvk-eyebrow', text: aggregate.granularity === 'day' ? 'Рядки за днями' : 'Рядки за місяцями' }), h('h2', { text: 'Зведена таблиця за період' })), h('div', { class: 'pvk-table-actions' }, select, exportButton)),
    h('div', { class: 'pvk-table-scroll' }, table));
}

function qualityPage(model) {
  const byLevel = level => model.issues.filter(item => item.level === level).length;
  const groups = groupIssues(model.issues);
  const levelLabel = level => level === 'info' ? 'Інформаційно' : level === 'warning' ? 'Попередження' : 'Помилка';
  return h('div', { class: 'pvk-page' },
    h('header', { class: 'pvk-page-head' }, h('div', {}, h('span', { class: 'pvk-eyebrow', text: 'Лише читання · файл не змінюється' }), h('h2', { text: 'Перевірка даних' })), h('strong', { text: `${number(model.issues.length)} повідомлень у ${number(groups.length)} групах` })),
    h('div', { class: 'pvk-quality-kpis' }, kpi('Помилки', number(byLevel('error')), 'Потребують перевірки', 'red', { icon: 'alert' }), kpi('Попередження', number(byLevel('warning')), 'Порожні клітинки й пропущені дати', 'amber', { icon: 'alert' }), kpi('Інформаційно', number(byLevel('info')), 'Не блокує звіт', 'blue', { icon: 'doc' })),
    groups.length ? h('div', { class: 'pvk-issues' }, groups.map(group => h('article', { class: `pvk-issue ${group.level}` },
      h('span', { text: levelLabel(group.level) }),
      h('strong', { text: group.sheet }),
      h('p', {}, group.title, h('b', { class: 'pvk-issue-count', text: ` · ${number(group.count)}` })),
      h('small', { text: [group.details.join('; ') + (group.more ? `; ще ${number(group.more)}` : ''), group.hint].filter(Boolean).join(' · ') }))))
      : h('section', { class: 'pvk-section pvk-empty', text: 'За обраний період помилок не виявлено.' }));
}

function periodControls(workbook, rerender) {
  const all = allDateRange(workbook);
  const button = (preset, label) => h('button', { type: 'button', 'aria-pressed': String(state.preset === preset), onclick: () => { setPreset(workbook, preset); rerender(); } }, label);
  const from = h('input', { type: 'date', value: state.from, min: all.from, max: all.to, 'aria-label': 'Початок періоду', onchange: event => { state.from = event.target.value; state.preset = 'custom'; rerender(); } });
  const to = h('input', { type: 'date', value: state.to, min: all.from, max: all.to, 'aria-label': 'Кінець періоду', onchange: event => { state.to = event.target.value; state.preset = 'custom'; rerender(); } });
  return h('div', { class: 'pvk-period' }, h('span', { text: 'Період' }), h('div', { class: 'pvk-seg' }, button('7', 'Тиждень'), button('30', 'Місяць'), button('all', 'Весь час')), h('label', {}, 'з', from), h('label', {}, 'по', to));
}

function defaultDownload(name, rows) {
  const escape = value => {
    const text = String(value == null ? '' : value);
    return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const blob = new Blob([`\uFEFF${rows.map(row => row.map(escape).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  setTimeout(() => { URL.revokeObjectURL(anchor.href); anchor.remove(); }, 1000);
}

export function render(host, workbook, options = {}) {
  if (!host || workbook?.kind !== 'pvk') return;
  ensureState(workbook);
  host.classList.add('pvk-mode');
  let root = host.querySelector(':scope > #pvk-dashboard-root');
  if (!root) { root = h('div', { id: 'pvk-dashboard-root' }); host.append(root); }
  const rerender = () => render(host, workbook, options);
  // Таблицю «Наші втрати» з профілю лончер передає, коли захоче: дашборд має вміти перемалюватись і показати вкладку.
  ownLossesHost('pvk', rerender, options.readSheets);
  if (options.readSheets && consumeOwnLossesTabRequest('pvk')) state.view = 'own';
  const model = createDashboardModel(workbook, { from: state.from, to: state.to });
  const runtime = { rerender, downloadCSV: options.downloadCSV || defaultDownload };
  const hasSheets = model.sheets.length > 0;
  const nav = [
    hasSheets && ['summary', 'Зведення ПВК'],
    model.journal && ['journal', model.journal.name],
    ...(hasSheets ? model.sheets.map(sheet => [sheet.name, sheet.name === "Об'єкти" ? 'Об’єкти' : sheet.name]) : []),
    hasSheets && ['table', 'Зведена таблиця'],
    // «Наші втрати» — окрема таблиця з власним файлом і періодом: потребує читача xlsx від модуля.
    options.readSheets && ['own', 'Наші втрати'],
    ['quality', 'Перевірка даних'],
    personalNavItem(),
  ].filter(Boolean);
  if (!nav.some(([key]) => key === state.view)) state.view = nav[0][0];
  const own = state.view === 'own';
  const mine = state.view === MINE_VIEW;
  const page = own ? h('div', { class: 'pvk-page' }, ownLossesPage({ scope: 'pvk', readSheets: options.readSheets, rerender }))
    : mine ? h('div', { class: 'pvk-page pvk-mine', [MINE_SLOT]: '' })
    : state.view === 'journal' ? journalPage(model, runtime)
    : state.view === 'summary' ? summaryPage(model)
    : state.view === 'table' ? tablePage(model, runtime)
      : state.view === 'quality' ? qualityPage(model)
        : sheetPage(model.sheets.find(sheet => sheet.name === state.view) || model.sheets[0]);
  root.textContent = '';
  root.append(...[
    h('header', { class: 'pvk-hero' },
      h('div', {}, h('span', { class: 'pvk-eyebrow', text: `${[model.journal && model.journal.name, hasSheets && 'ТАБЛ 2-3'].filter(Boolean).join(' і ')} · локальна аналітика` }), h('h1', { text: 'Дашборд ПВК' }), h('p', { text: 'Усі підпорядковані підрозділи · файл відкрито лише для читання' })),
      options.canRefresh ? h('button', { class: 'btn quiet', type: 'button', onclick: () => options.refresh?.() }, 'Оновити з файлу') : null),
    own || mine ? null : periodControls(workbook, rerender),
    h('nav', { class: 'pvk-nav', 'aria-label': 'Розділи дашборда ПВК' }, nav.map(([key, label]) => h('button', { type: 'button', 'data-nav': key, 'aria-pressed': String(state.view === key), onclick: () => { state.view = key; rerender(); } }, label))),
    page,
  ].filter(Boolean));
  // «Наші втрати» отримують дані пізніше за перехід на вкладку: поява таблиці теж анімується.
  playMotion(root, own && root.querySelector('.ol-kpi') ? 'own:data' : state.view);
}

export function renderBase(host, workbook) {
  if (!host || workbook?.kind !== 'pvk') return;
  host.textContent = '';
  host.append(...[
    h('section', { class: 'pvk-base-hero' }, h('span', { class: 'pvk-eyebrow', text: 'Лише читання' }), h('h1', { text: 'Таблиця ПВК' }), h('p', { text: 'Аркуші показано без можливості змінити сирий XLSX. Дані редагуються в Excel, після чого натисніть «Оновити».' })),
    workbook.journal ? h('section', { class: 'pvk-section' },
      h('header', {}, h('h2', { text: workbook.journal.name }), h('span', { text: `${workbook.journal.rows.length} записів · ${workbook.journal.headers.length} стовпців` })),
      h('div', { class: 'pvk-table-scroll' }, h('table', { class: 'pvk-table' },
        h('thead', {}, h('tr', {}, workbook.journal.headers.map(header => h('th', { text: header })))),
        h('tbody', {}, workbook.journal.rows.length
          ? workbook.journal.rows.map(row => h('tr', {}, workbook.journal.headers.map(header => h('td', { text: row.values?.[header] ?? '' }))))
          : h('tr', {}, h('td', { colspan: workbook.journal.headers.length, class: 'pvk-empty', text: 'Записів немає.' })))))) : null,
    ...workbook.sheets.map(sheet => h('section', { class: 'pvk-section' },
      h('header', {}, h('h2', { text: sheet.name }), h('span', { text: `${sheet.rows.length} рядків даних · ${sheet.headers.length - 1} показників` })),
      h('div', { class: 'pvk-table-scroll' }, h('table', { class: 'pvk-table' },
        h('thead', {}, h('tr', {}, sheet.headers.map(header => h('th', { text: header })))),
        h('tbody', {}, sheet.rows.length ? sheet.rows.map(row => h('tr', {},
          h('td', { text: dateLabel(row.date) }),
          sheet.headers.slice(1).map(metric => h('td', { text: row.raw?.[metric] === '' || row.raw?.[metric] == null ? '' : String(row.raw[metric]) })))) : h('tr', {}, h('td', { colspan: sheet.headers.length, class: 'pvk-empty', text: 'Рядків із даними немає.' })))))))].filter(Boolean));
}

export function unmount(host) {
  if (!host) return;
  host.classList.remove('pvk-mode');
  host.querySelector(':scope > #pvk-dashboard-root')?.remove();
}

window.PVKDashboard = { render, renderBase, unmount };
