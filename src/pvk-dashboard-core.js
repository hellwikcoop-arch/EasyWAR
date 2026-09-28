const SHEET_ORDER = ['АА', 'ПС', "Об'єкти"];

const GROUP_DEFINITIONS = {
  'АА': [
    { name: 'Удари', metrics: ['АУ'], visualization: 'kpi-delta-dynamics' },
    { name: 'Вертольоти', metrics: ['Mi-8', 'Mi-24'], visualization: 'bars-donut-stacked' },
    { name: 'Боєприпаси', metrics: ['ARS-8', 'С-8 ком', 'PC-80', 'UAR-80', 'C-13', 'Hydra-70', 'Thales-70', 'Thales-FZ', 'МК-40', 'Zuni'], visualization: 'ranking-statistics-sparklines' },
    { name: 'Результат', metrics: ['Уражено', 'НЕ уражено'], visualization: 'stacked-affected-percent' },
  ],
  'ПС': [
    { name: 'Удари', metrics: ['АУ'], visualization: 'kpi-delta-dynamics' },
    { name: 'Літаки', metrics: ['Mirage', 'F-16', 'МіГ-29', 'Су-25', 'Су-27'], visualization: 'bars-donut-stacked' },
    { name: 'Боєприпаси', metrics: ['AGM-88', 'AASM-250', 'GBU-39', 'BLU-140', 'GBU-65', 'GBU-62', 'GBU-64', 'C-13', 'MK-32', 'MK-24'], visualization: 'ranking-statistics-sparklines' },
    { name: 'Результат', metrics: ['Уражено', 'НЕ уражено', 'Дорозвідується'], visualization: 'stacked-affected-percent' },
  ],
  "Об'єкти": [
    { name: 'Уражені об’єкти', metrics: ['ЖС ВЗ', 'Арт. Системи', 'ОВТ', 'ППО', 'Рембаза', 'Склад БК', 'Склад ВТМ', 'ПУ БпЛА', 'СП', 'КСП роти', 'ПУ бат', 'ПУ бриг', 'ПУ див', 'обл. РЕБ', 'пос РЕБ', 'група РЕР', 'РЛС КББ', 'Ретранслятор', 'Вз.зв’язку', 'ПММ', 'ІФС', 'Інфраструктура'], visualization: 'ranking-heatmap-dynamics' },
    { name: 'Витрата', metrics: ['Витрата'], visualization: 'kpi-dynamics' },
  ],
};

const normalize = value => String(value == null ? '' : value)
  .replace(/[’ʼ]/g, "'")
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase('uk-UA');

const isoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
const dayNumber = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) / 864e5 : NaN;
};
const isoFromDay = value => new Date(value * 864e5).toISOString().slice(0, 10);

function sheetByName(workbook, name) {
  return workbook?.sheets?.find(sheet => normalize(sheet.name) === normalize(name)) || null;
}

function metricHeaders(sheet) {
  return (sheet?.headers || []).filter(header => normalize(header) !== normalize('Дата'));
}

function definitionFor(sheetName, metric) {
  const defs = GROUP_DEFINITIONS[SHEET_ORDER.find(name => normalize(name) === normalize(sheetName))] || [];
  return defs.find(group => group.metrics.some(item => normalize(item) === normalize(metric))) || null;
}

export function classifyMetric(sheetName, metric) {
  const definition = definitionFor(sheetName, metric);
  return definition
    ? { group: definition.name, visualization: definition.visualization, known: true }
    : { group: 'Інші показники', visualization: 'bars-dynamics', known: false };
}

export function percentageAffected(affected, notAffected) {
  const numerator = Number(affected) || 0;
  const denominator = numerator + (Number(notAffected) || 0);
  return denominator > 0 ? numerator / denominator * 100 : null;
}

export function allDateRange(workbook) {
  const dates = (workbook?.sheets || [])
    .flatMap(sheet => sheet.rows || [])
    .map(row => isoDay(row.date))
    .filter(Boolean)
    .sort();
  return { from: dates[0] || '', to: dates[dates.length - 1] || '' };
}

export function resolveRange(workbook, range = {}) {
  const all = allDateRange(workbook);
  let from = isoDay(range.from) || all.from;
  let to = isoDay(range.to) || all.to;
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

export function previousRange(range) {
  if (!range?.from || !range?.to) return { from: '', to: '' };
  const from = dayNumber(range.from);
  const to = dayNumber(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { from: '', to: '' };
  const length = Math.max(1, to - from + 1);
  return { from: isoFromDay(from - length), to: isoFromDay(from - 1) };
}

export function rowsInRange(rows, range) {
  if (!range?.from || !range?.to) return [...(rows || [])];
  return (rows || []).filter(row => row.date && row.date >= range.from && row.date <= range.to);
}

function totalFor(rows, metric) {
  return rows.reduce((sum, row) => sum + (Number(row.values?.[metric]) || 0), 0);
}

function seriesFor(rows, metric) {
  const byDate = new Map();
  for (const row of rows) {
    if (!row.date) continue;
    byDate.set(row.date, (byDate.get(row.date) || 0) + (Number(row.values?.[metric]) || 0));
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

function percentageSeries(rows, affectedMetric, notAffectedMetric) {
  if (!affectedMetric || !notAffectedMetric) return [];
  const byDate = new Map();
  for (const row of rows) {
    if (!row.date) continue;
    const current = byDate.get(row.date) || { affected: 0, notAffected: 0 };
    current.affected += Number(row.values?.[affectedMetric]) || 0;
    current.notAffected += Number(row.values?.[notAffectedMetric]) || 0;
    byDate.set(row.date, current);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({
    date,
    value: percentageAffected(values.affected, values.notAffected),
  })).filter(item => item.value != null);
}

function metricWidget(sheet, metric, rows, previousRows) {
  const classification = classifyMetric(sheet.name, metric);
  const series = seriesFor(rows, metric);
  const total = totalFor(rows, metric);
  const previousTotal = totalFor(previousRows, metric);
  const maximum = series.reduce((best, item) => item.value > best.value ? item : best, { date: '', value: 0 });
  return {
    id: `${sheet.name}:${metric}`,
    sheet: sheet.name,
    metric,
    metrics: [metric],
    group: classification.group,
    visualization: classification.visualization,
    known: classification.known,
    marker: classification.known ? '' : 'новий стовпець — група не визначена',
    total,
    previousTotal,
    deltaPercent: previousTotal === 0 ? null : (total - previousTotal) / previousTotal * 100,
    averagePerDay: series.length ? total / series.length : 0,
    maximum: maximum.value,
    maximumDate: maximum.date,
    series,
  };
}

function buildGroups(sheet, rows, previousRows) {
  const groups = [];
  const byName = new Map();
  for (const metric of metricHeaders(sheet)) {
    const widget = metricWidget(sheet, metric, rows, previousRows);
    let group = byName.get(widget.group);
    if (!group) {
      group = {
        name: widget.group,
        visualization: widget.visualization,
        unknown: !widget.known,
        metrics: [],
        widgets: [],
      };
      byName.set(widget.group, group);
      groups.push(group);
    }
    group.metrics.push(metric);
    group.widgets.push(widget);
  }
  return groups;
}

function summarizeSheet(sheet, rows, previousRows) {
  const groups = buildGroups(sheet, rows, previousRows);
  const totals = Object.fromEntries(metricHeaders(sheet).map(metric => [metric, totalFor(rows, metric)]));
  const previousTotals = Object.fromEntries(metricHeaders(sheet).map(metric => [metric, totalFor(previousRows, metric)]));
  const affectedMetric = metricHeaders(sheet).find(metric => normalize(metric) === normalize('Уражено'));
  const notAffectedMetric = metricHeaders(sheet).find(metric => normalize(metric) === normalize('НЕ уражено'));
  return {
    name: sheet.name,
    headers: [...(sheet.headers || [])],
    metrics: metricHeaders(sheet),
    rows,
    previousRows,
    totals,
    previousTotals,
    groups,
    widgets: groups.flatMap(group => group.widgets),
    affectedPercent: percentageAffected(totals['Уражено'], totals['НЕ уражено']),
    affectedSeries: percentageSeries(rows, affectedMetric, notAffectedMetric),
    reconnaissancePercent: (() => {
      const total = (totals['Уражено'] || 0) + (totals['НЕ уражено'] || 0) + (totals['Дорозвідується'] || 0);
      return total ? (totals['Дорозвідується'] || 0) / total * 100 : null;
    })(),
  };
}

function sumGroup(sheetModel, groupName) {
  const group = sheetModel?.groups?.find(item => item.name === groupName);
  return group ? group.widgets.reduce((sum, widget) => sum + widget.total, 0) : 0;
}

function mergeDaily(models, selector) {
  const values = new Map();
  for (const sheet of models) {
    const metrics = selector(sheet);
    for (const metric of metrics) {
      const widget = sheet.widgets.find(item => item.metric === metric);
      for (const item of widget?.series || []) values.set(item.date, (values.get(item.date) || 0) + item.value);
    }
  }
  return [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export function createDashboardModel(workbook, range = {}) {
  const resolvedRange = resolveRange(workbook, range);
  const previous = previousRange(resolvedRange);
  const sheets = SHEET_ORDER.map(name => sheetByName(workbook, name)).filter(Boolean).map(sheet => (
    summarizeSheet(sheet, rowsInRange(sheet.rows, resolvedRange), rowsInRange(sheet.rows, previous))
  ));
  const aa = sheets.find(sheet => normalize(sheet.name) === normalize('АА'));
  const air = sheets.find(sheet => normalize(sheet.name) === normalize('ПС'));
  const objects = sheets.find(sheet => normalize(sheet.name) === normalize("Об'єкти"));
  const affected = (aa?.totals['Уражено'] || 0) + (air?.totals['Уражено'] || 0);
  const notAffected = (aa?.totals['НЕ уражено'] || 0) + (air?.totals['НЕ уражено'] || 0);
  const reconnaissance = air?.totals['Дорозвідується'] || 0;
  const aaMunitions = sumGroup(aa, 'Боєприпаси');
  const airMunitions = sumGroup(air, 'Боєприпаси');
  const summary = {
    aaAu: aa?.totals['АУ'] || 0,
    airAu: air?.totals['АУ'] || 0,
    totalAu: (aa?.totals['АУ'] || 0) + (air?.totals['АУ'] || 0),
    aaMunitions,
    airMunitions,
    munitions: aaMunitions + airMunitions,
    affected,
    notAffected,
    reconnaissance,
    affectedPercent: percentageAffected(affected, notAffected),
    objects: sumGroup(objects, 'Уражені об’єкти'),
    expenditure: objects?.totals['Витрата'] || 0,
  };
  summary.activity = mergeDaily(sheets, sheet => sheet.name === 'АА' || sheet.name === 'ПС' ? ['АУ'] : []);
  summary.dynamics = {
    au: summary.activity,
    munitions: mergeDaily(sheets, sheet => sheet.groups.find(group => group.name === 'Боєприпаси')?.metrics || []),
    objects: mergeDaily(sheets, sheet => sheet.name === "Об'єкти" ? (sheet.groups.find(group => group.name === 'Уражені об’єкти')?.metrics || []) : []),
    expenditure: mergeDaily(sheets, sheet => sheet.name === "Об'єкти" ? ['Витрата'] : []),
  };
  return {
    kind: 'pvk-dashboard',
    range: resolvedRange,
    previousRange: previous,
    sheets,
    summary,
    widgets: sheets.flatMap(sheet => sheet.widgets),
    issues: validateWorkbook(workbook, resolvedRange),
  };
}

function issue(sheet, type, level, message, row = null, metric = '', extra = null) {
  return Object.assign({ sheet, type, level, message, row, metric }, extra);
}

function missingDates(sheet, rows, range) {
  const dates = new Set(rows.map(row => isoDay(row.date)).filter(Boolean));
  if (!dates.size) return [];
  const sorted = [...dates].sort();
  const start = dayNumber(range?.from || sorted[0]);
  const end = dayNumber(range?.to || sorted[sorted.length - 1]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const missing = [];
  for (let day = start; day <= end; day++) {
    const date = isoFromDay(day);
    if (!dates.has(date)) missing.push(issue(sheet.name, 'missing-date', 'warning', `Пропущено дату ${date}.`, null, '', { date }));
  }
  return missing;
}

export function validateSheet(sheet, range = {}) {
  const rows = (sheet?.rows || []).filter(row => !row.date || !range?.from || !range?.to || (row.date >= range.from && row.date <= range.to));
  const issues = [];
  const dates = new Map();
  for (const row of rows) {
    if (row.date) {
      const seen = dates.get(row.date) || [];
      seen.push(row.rowNumber);
      dates.set(row.date, seen);
    }
    for (const item of row.issues || []) {
      const labels = {
        'text-in-numeric': `Текст «${item.raw}» у числовому стовпці «${item.metric}».`,
        negative: `Від’ємне значення у стовпці «${item.metric}».`,
        'missing-value': `Не внесено значення у стовпці «${item.metric}».`,
        'number-without-date': 'Є числові значення без дати.',
        'invalid-date': `Не вдалося прочитати дату «${item.raw}».`,
      };
      issues.push(issue(sheet.name, item.type, item.type === 'missing-value' ? 'warning' : 'error', labels[item.type] || item.message || item.type, row.rowNumber, item.metric || '', { raw: item.raw ?? '', date: row.date || '' }));
    }
  }
  for (const [date, rowNumbers] of dates) {
    if (rowNumbers.length > 1) issues.push(issue(sheet.name, 'duplicate-date', 'error', `Дата ${date} повторюється у рядках ${rowNumbers.join(', ')}.`, null, '', { date, rows: rowNumbers }));
  }
  issues.push(...missingDates(sheet, rows, range));

  const au = metricHeaders(sheet).find(metric => normalize(metric) === normalize('АУ'));
  if (au) {
    const assetGroup = sheet.name === 'АА' ? 'Вертольоти' : sheet.name === 'ПС' ? 'Літаки' : '';
    const assets = metricHeaders(sheet).filter(metric => classifyMetric(sheet.name, metric).group === assetGroup);
    for (const row of rows) {
      if (!row.date) continue;
      const strikes = Number(row.values?.[au]) || 0;
      const assetTotal = assets.reduce((sum, metric) => sum + (Number(row.values?.[metric]) || 0), 0);
      if (strikes !== assetTotal) issues.push(issue(sheet.name, 'au-assets-mismatch', 'info', `АУ (${strikes}) не дорівнює сумі типів засобів (${assetTotal}) за ${row.date}.`, row.rowNumber, au, { date: row.date, strikes, assetTotal }));
    }
  }
  return issues;
}

export function validateWorkbook(workbook, range = {}) {
  return (workbook?.sheets || []).flatMap(sheet => validateSheet(sheet, range));
}

const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };
const GROUP_TITLES = {
  'text-in-numeric': metric => `Текст у числовому стовпці «${metric}»`,
  negative: metric => `Від’ємні значення у стовпці «${metric}»`,
  'missing-value': metric => `Не внесено значення у стовпці «${metric}»`,
  'number-without-date': () => 'Числові значення без дати',
  'invalid-date': () => 'Дату не вдалося прочитати',
  'duplicate-date': () => 'Дати повторюються',
  'missing-date': () => 'Пропущені дати',
  'au-assets-mismatch': () => 'АУ не дорівнює сумі типів засобів',
};
const GROUP_HINTS = {
  'missing-value': 'Клітинка порожня. Якщо за добу було 0, впишіть 0.',
  'au-assets-mismatch': 'Лише для інформації: АУ й типи засобів можуть рахуватися по-різному.',
};
const dayLabel = value => value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '';

/** Суміжні дати зводяться в діапазони: «01.01.2026–03.01.2026». */
function dateRanges(dates) {
  const days = [...new Set(dates.filter(Boolean))].sort().map(date => [date, dayNumber(date)]);
  const out = [];
  for (const [date, day] of days) {
    const last = out[out.length - 1];
    if (last && day === last.endDay + 1) { last.end = date; last.endDay = day; } else out.push({ start: date, end: date, endDay: day });
  }
  return out.map(item => item.start === item.end ? dayLabel(item.start) : `${dayLabel(item.start)}–${dayLabel(item.end)}`);
}

function groupDetail(item) {
  switch (item.type) {
    case 'text-in-numeric': return `рядок ${item.row}: «${item.raw}»`;
    case 'invalid-date': return `рядок ${item.row}: «${item.raw}»`;
    case 'duplicate-date': return `${dayLabel(item.date)}: рядки ${(item.rows || []).join(', ')}`;
    case 'au-assets-mismatch': return `${dayLabel(item.date)}: АУ ${item.strikes}, засобів ${item.assetTotal}`;
    default: return item.row ? `рядок ${item.row}` : '';
  }
}

/**
 * Зводить однакові повідомлення (аркуш + тип + стовпець) в одну групу з кількістю й прикладами,
 * щоб тисячі порожніх клітинок чи пропущених днів не ховали помилки.
 */
export function groupIssues(issues, sampleSize = 12) {
  const groups = new Map();
  for (const item of issues || []) {
    const key = [item.sheet, item.type, item.metric || ''].join('\u0000');
    let group = groups.get(key);
    if (!group) {
      const title = (GROUP_TITLES[item.type] || (() => item.message || item.type))(item.metric);
      group = { sheet: item.sheet, type: item.type, level: item.level, metric: item.metric || '', title, hint: GROUP_HINTS[item.type] || '', count: 0, items: [] };
      groups.set(key, group);
    }
    group.count += 1;
    group.items.push(item);
  }
  return [...groups.values()].map(group => {
    const details = group.type === 'missing-date'
      ? dateRanges(group.items.map(item => item.date))
      : group.items.map(groupDetail).filter(Boolean);
    const { items, ...rest } = group;
    return Object.assign(rest, { details: details.slice(0, sampleSize), more: Math.max(0, details.length - sampleSize) });
  }).sort((a, b) => (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3)
    || SHEET_ORDER.indexOf(a.sheet) - SHEET_ORDER.indexOf(b.sheet) || b.count - a.count);
}

export function aggregateSheet(sheet, range = {}) {
  const rows = rowsInRange(sheet?.rows || [], range);
  const metrics = metricHeaders(sheet);
  const resolved = {
    from: range.from || rows.map(row => row.date).filter(Boolean).sort()[0] || '',
    to: range.to || rows.map(row => row.date).filter(Boolean).sort().at(-1) || '',
  };
  const length = resolved.from && resolved.to ? dayNumber(resolved.to) - dayNumber(resolved.from) + 1 : 0;
  const granularity = length > 31 ? 'month' : 'day';
  const buckets = new Map();
  for (const row of rows) {
    if (!row.date) continue;
    const key = granularity === 'month' ? row.date.slice(0, 7) : row.date;
    if (!buckets.has(key)) buckets.set(key, Object.fromEntries(metrics.map(metric => [metric, 0])));
    const values = buckets.get(key);
    for (const metric of metrics) values[metric] += Number(row.values?.[metric]) || 0;
  }
  const dataRows = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, values]) => ({ period, values }));
  const totals = Object.fromEntries(metrics.map(metric => [metric, dataRows.reduce((sum, row) => sum + row.values[metric], 0)]));
  return { sheet: sheet.name, granularity, metrics, rows: dataRows, totals };
}

export function csvRowsForSheet(sheet, range = {}) {
  const aggregate = aggregateSheet(sheet, range);
  return [
    ['Період', ...aggregate.metrics],
    ...aggregate.rows.map(row => [row.period, ...aggregate.metrics.map(metric => row.values[metric])]),
    ['Разом', ...aggregate.metrics.map(metric => aggregate.totals[metric])],
  ];
}

export function coverage(model) {
  return new Set((model?.widgets || []).map(widget => widget.id));
}

export { GROUP_DEFINITIONS, SHEET_ORDER };
