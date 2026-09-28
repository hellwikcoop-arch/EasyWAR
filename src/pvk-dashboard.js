import {
  SHEET_ORDER,
  aggregateSheet,
  allDateRange,
  createDashboardModel,
  csvRowsForSheet,
} from './pvk-dashboard-core.js';

const state = {
  workbook: null,
  view: 'summary',
  preset: 'all',
  from: '',
  to: '',
  tableSheet: 'АА',
};

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
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
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
  Object.assign(state, { view: 'summary', preset: 'all', from: range.from, to: range.to, tableSheet: 'АА' });
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

function kpi(label, value, detail, tone = '') {
  return h('article', { class: `pvk-kpi ${tone}` }, h('span', { text: label }), h('strong', { text: value }), h('small', { text: detail }));
}

function activityCalendar(series, range) {
  if (!range.from || !range.to) return h('p', { class: 'pvk-empty', text: 'У таблиці ще немає дат.' });
  const values = new Map(series.map(item => [item.date, item.value]));
  const maximum = Math.max(1, ...values.values());
  const days = [];
  for (let day = dayNumber(range.from); day <= dayNumber(range.to); day++) {
    const date = isoFromDay(day);
    const value = values.get(date) || 0;
    days.push(h('span', {
      class: 'pvk-day',
      title: `${dateLabel(date)} · АУ: ${value}`,
      'aria-label': `${dateLabel(date)}, АУ ${value}`,
      style: { '--level': String(value / maximum) },
    }, h('b', { text: String(new Date(`${date}T00:00:00Z`).getUTCDate()) }), h('small', { text: number(value) })));
  }
  return h('div', { class: 'pvk-calendar' }, days);
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
      kpi('АУ · разом', number(summary.totalAu), `АА ${number(summary.aaAu)} · ПС ${number(summary.airAu)}`, 'blue'),
      kpi('Усього БП', number(summary.munitions), `АА ${number(summary.aaMunitions)} · ПС ${number(summary.airMunitions)}`, 'amber'),
      kpi('Уражено', number(summary.affected), `НЕ уражено ${number(summary.notAffected)}`, 'green'),
      kpi('Дорозвідується', number(summary.reconnaissance), 'Окремий результат ПС', 'violet'),
      kpi('% уражених', percent(summary.affectedPercent), 'Уражено / (Уражено + НЕ уражено)', 'green'),
      kpi('Уражені об’єкти', number(summary.objects), 'Без показника «Витрата»', 'blue'),
      kpi('Витрата', number(summary.expenditure), 'Окремо від об’єктів', 'red')),
    h('section', { class: 'pvk-section' }, h('header', {}, h('h3', { text: 'Календар активності' }), h('span', { text: 'Сума АУ за днями' })), activityCalendar(summary.activity, model.range)),
    h('section', { class: 'pvk-section' }, h('header', {}, h('h3', { text: 'Загальна динаміка' }), h('span', { text: 'Обраний період' })), multiLine(summary.dynamics)));
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
  return h('div', { class: 'pvk-page' },
    h('header', { class: 'pvk-page-head' }, h('div', {}, h('span', { class: 'pvk-eyebrow', text: 'Лише читання · файл не змінюється' }), h('h2', { text: 'Перевірка даних' })), h('strong', { text: `${model.issues.length} повідомлень` })),
    h('div', { class: 'pvk-quality-kpis' }, kpi('Помилки', number(byLevel('error')), 'Потребують перевірки', 'red'), kpi('Попередження', number(byLevel('warning')), 'Пропуски в періоді', 'amber'), kpi('Інформаційно', number(byLevel('info')), 'Не блокує звіт', 'blue')),
    model.issues.length ? h('div', { class: 'pvk-issues' }, model.issues.map(item => h('article', { class: `pvk-issue ${item.level}` }, h('span', { text: item.level === 'info' ? 'Інформаційно' : item.level === 'warning' ? 'Попередження' : 'Помилка' }), h('strong', { text: item.sheet }), h('p', { text: item.message }), item.row ? h('small', { text: `Рядок ${item.row}${item.metric ? ` · ${item.metric}` : ''}` }) : null))) : h('section', { class: 'pvk-section pvk-empty', text: 'За обраний період помилок не виявлено.' }));
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
  const model = createDashboardModel(workbook, { from: state.from, to: state.to });
  const runtime = { rerender, downloadCSV: options.downloadCSV || defaultDownload };
  const nav = [
    ['summary', 'Зведення ПВК'],
    ['АА', 'АА'],
    ['ПС', 'ПС'],
    ["Об'єкти", 'Об’єкти'],
    ['table', 'Зведена таблиця'],
    ['quality', 'Перевірка даних'],
  ];
  const page = state.view === 'summary' ? summaryPage(model)
    : state.view === 'table' ? tablePage(model, runtime)
      : state.view === 'quality' ? qualityPage(model)
        : sheetPage(model.sheets.find(sheet => sheet.name === state.view) || model.sheets[0]);
  root.textContent = '';
  root.append(
    h('header', { class: 'pvk-hero' },
      h('div', {}, h('span', { class: 'pvk-eyebrow', text: 'ТАБЛ 2-3 · локальна аналітика' }), h('h1', { text: 'Дашборд ПВК' }), h('p', { text: 'Усі підпорядковані підрозділи · файл відкрито лише для читання' })),
      options.canRefresh ? h('button', { class: 'btn quiet', type: 'button', onclick: () => options.refresh?.() }, 'Оновити з файлу') : null),
    periodControls(workbook, rerender),
    h('nav', { class: 'pvk-nav', 'aria-label': 'Розділи дашборда ПВК' }, nav.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(state.view === key), onclick: () => { state.view = key; rerender(); } }, label))),
    page,
  );
}

export function renderBase(host, workbook) {
  if (!host || workbook?.kind !== 'pvk') return;
  host.textContent = '';
  host.append(
    h('section', { class: 'pvk-base-hero' }, h('span', { class: 'pvk-eyebrow', text: 'Лише читання' }), h('h1', { text: 'Таблиця ПВК' }), h('p', { text: 'Аркуші показано без можливості змінити сирий XLSX. Дані редагуються в Excel, після чого натисніть «Оновити».' })),
    workbook.sheets.map(sheet => h('section', { class: 'pvk-section' },
      h('header', {}, h('h2', { text: sheet.name }), h('span', { text: `${sheet.rows.length} рядків даних · ${sheet.headers.length - 1} показників` })),
      h('div', { class: 'pvk-table-scroll' }, h('table', { class: 'pvk-table' },
        h('thead', {}, h('tr', {}, sheet.headers.map(header => h('th', { text: header })))),
        h('tbody', {}, sheet.rows.length ? sheet.rows.map(row => h('tr', {},
          h('td', { text: dateLabel(row.date) }),
          sheet.headers.slice(1).map(metric => h('td', { text: row.raw?.[metric] === '' || row.raw?.[metric] == null ? '' : String(row.raw[metric]) })))) : h('tr', {}, h('td', { colspan: sheet.headers.length, class: 'pvk-empty', text: 'Рядків із даними немає.' }))))))));
}

export function unmount(host) {
  if (!host) return;
  host.classList.remove('pvk-mode');
  host.querySelector(':scope > #pvk-dashboard-root')?.remove();
}

window.PVKDashboard = { render, renderBase, unmount };
