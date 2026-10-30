// Картка блока реєстру з основної таблиці (E5, кроки 4–5): чиста логіка без DOM. Блок, доданий у основну таблицю
// (module-add-columns-core.js), стає карткою «Мого дашборда» і рахується з рядків цієї таблиці за ролями, які
// користувач підтвердив у схемі профілю (`readRow`). Числа — тим самим ядром, що й картки дашборда РВ
// (module-adapters/rv-kpi-core.js), тож «Знищено» з таблиці й з вкладки РВ рахуються однаково. Нічого не записує.

import { agg, computeRvKpis, eff, resKind, rocketOutcome, shareOfOps } from './module-adapters/rv-kpi-core.js';
import { chartModel } from './dashboard-module-charts-core.js';
import { availability, readRow } from './profile-schema-core.js';
import { addInstance, moveInstance, resizeInstance } from './module-instance-core.js';

const share = (A, x) => `${shareOfOps(A, x)}% від пусків`;

// Прості об'єкти без `Object.freeze`: виклик на верхньому рівні не вилучається зі збірки ПВК-lite (ліміт 5 МБ).
/**
 * Картки, які вміють рахуватися з основної таблиці: визначення реєстру → показник, підпис, тон (як на вкладці РВ:
 * пуски — сині, БП і пошкоджені — бурштинові, знищені — зелені, не уражені — червоні, невідомі — сірі), ключ зміни
 * в `computeRvKpis` і дві плитки під числом (`tiles(A, K)`; K — підсумок ядра за датований період або `null`).
 */
const decimal = value => (value == null ? '—' : value.toFixed(1).replace('.', ','));
const perDayMax = key => (A, K) => ['Макс. за добу', K ? number(K.maxPerDay[key]) : '—'];
const shareTile = x => A => ['Від пусків', `${shareOfOps(A, x(A))}%`];
const CARDS = {
  'legacy:rv-kpi-launches': { label: 'Пуски', tone: 'blue', key: 'n', value: A => A.n, note: () => '', tiles: [(A, K) => ['Сер. за добу', K ? decimal(K.perDay) : '—'], perDayMax('n')] },
  'legacy:rv-kpi-munitions': { label: 'Використано БП', tone: 'amber', key: 'mun', value: A => A.mun, note: A => (A.n ? `${decimal(A.mun / A.n)} БП на пуск` : ''), tiles: [A => ['БП на пуск', A.n ? decimal(A.mun / A.n) : '—'], perDayMax('mun')] },
  'legacy:rv-kpi-destroyed': { label: 'Знищено', tone: 'green', key: 'destroyed', share: true, value: A => A.destroyed, note: A => share(A, A.destroyed), tiles: [shareTile(A => A.destroyed), perDayMax('destroyed')] },
  'legacy:rv-kpi-damaged': { label: 'Пошкоджено / подавлено', tone: 'amber', key: 'dmgSup', share: true, value: A => A.damaged + A.suppressed, note: A => share(A, A.damaged + A.suppressed), tiles: [shareTile(A => A.damaged + A.suppressed), perDayMax('dmgSup')] },
  'legacy:rv-kpi-miss': { label: 'Не уражено', tone: 'red', key: 'miss', share: true, value: A => A.miss, note: A => share(A, A.miss), tiles: [shareTile(A => A.miss), (A, K) => ['Мін. за місяць', K ? number(K.minMonthMiss) : '—']] },
  'legacy:rv-kpi-unknown': { label: 'Не відомо', tone: 'grey', key: 'unk', share: true, value: A => A.unk, note: A => share(A, A.unk), tiles: [shareTile(A => A.unk), A => ['Чекає перевірки', number(A.unk)]] },
};

// Блоки-діаграми спільних вкладок ПС і РВ: рядки моделі РВ зводяться до рядків службового «модуля» з полями
// `category`/`day`/`series`/`value`, і малюнок будує той самий `chartModel`, що й шаблони «Мого дашборда».
const RESULT_LABELS = { destroyed: 'Знищено', suppressed: 'Подавлено', damaged: 'Пошкоджено', miss: 'Не уражено' };
const resultLabel = row => RESULT_LABELS[rocketOutcome(row.resRaw)] || (row.kind === 'hit' ? 'Уражено' : 'Не відомо');
const one = (category, value = 1) => ({ category, value });
const textField = (key, label, role = 'dimension') => ({ key, label, dataType: 'text', role, aggregation: 'none' });
const sumField = (key, label) => ({ key, label, dataType: 'integer', role: 'metric', aggregation: 'sum' });
const DAY = { key: 'day', label: 'Дата', dataType: 'date', role: 'dimension', aggregation: 'none' };
const counted = (label, pick) => ({
  kind: 'horizontal-bar', fields: [textField('category', label), sumField('value', 'Записи')],
  rows: list => list.map(row => one(pick(row) || 'Не вказано')),
});
// Описи будуються під час першого звертання: виклики `textField`/`counted` на верхньому рівні лишилися б у збірці ПВК-lite.
let chartSpecs = null;
const charts = () => (chartSpecs ??= {
  'legacy:result-distribution': { kind: 'donut', fields: [textField('category', 'Результат'), sumField('value', 'Записи')], rows: list => list.map(row => one(resultLabel(row))) },
  'legacy:result-dynamics': {
    kind: 'stacked-columns', fields: [DAY, textField('series', 'Результат', 'series'), sumField('value', 'Записи')],
    rows: list => list.filter(row => row.date).map(row => ({ day: row.date, series: resultLabel(row), value: 1 })),
  },
  'legacy:platform-types': counted('Тип носія', row => row.aircraft),
  'legacy:firing-units': counted('Вогнева бригада', row => row.firingUnit),
  'legacy:target-types': { ...counted('Тип цілі', () => ''), rows: list => list.flatMap(row => (row.types.length ? row.types : ['Не вказано']).map(type => one(type))) },
  'legacy:munition-use': {
    kind: 'horizontal-bar', fields: [textField('category', 'Тип боєприпасу'), sumField('value', 'Кількість БП')],
    rows: list => list.filter(row => row.munition).map(row => one(row.munition, row.count)),
  },
  'legacy:activity-by-day': {
    kind: 'combo', fields: [DAY, sumField('value', 'Записи'), sumField('reference_value', 'Кількість БП')],
    rows: list => list.filter(row => row.date).map(row => ({ day: row.date, value: 1, reference_value: row.count })),
  },
  'legacy:hour-of-day': {
    kind: 'stacked-columns', fields: [textField('category', 'Година'), textField('series', 'Результат', 'series'), sumField('value', 'Записи')],
    rows: list => list.map(row => ({ hour: /^(\d{1,2}):\d{2}/.exec(row.time)?.[1], row }))
      .filter(item => item.hour != null && Number(item.hour) < 24)
      .sort((a, b) => Number(a.hour) - Number(b.hour))
      .map(item => ({ category: `${item.hour.padStart(2, '0')}:00`, series: resultLabel(item.row), value: 1 })),
  },
  // Ефективність підрозділу — як на вкладках: (уражено + частково) / (записи − відбої), лише підрозділи з 5+ записами.
  'legacy:top-units': {
    kind: 'horizontal-bar', fields: [textField('category', 'Підрозділ'), sumField('value', 'Ефективність, %')],
    rows: list => [...agg(list).byUnit].filter(([, unit]) => unit.n >= 5 && eff(unit, 'sum') != null)
      .map(([name, unit]) => one(name, Math.round(eff(unit, 'sum')))).sort((a, b) => b.value - a.value).slice(0, 5),
  },
  // Повторні цілі: номери, що трапляються у 2+ записах, перші 8.
  'legacy:repeat-targets': {
    kind: 'horizontal-bar', fields: [textField('category', 'Номер цілі'), sumField('value', 'Записи')],
    rows: list => {
      const counts = new Map();
      for (const row of list) if (row.targetId) counts.set(row.targetId, (counts.get(row.targetId) || 0) + 1);
      return [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => one(id, n));
    },
  },
});

/** Чи вміє визначення бути карткою з основної таблиці. */
export const hasBlockCard = definitionId => Object.hasOwn(CARDS, definitionId) || Object.hasOwn(charts(), definitionId);

const text = value => (value == null ? '' : String(value).trim());
const NO_FLAG = /^(?:|ні|нет|no|false|0|-|—)$/i;

/** Значення за ролями → рядок моделі РВ (поля, які читає `agg`). Ролі, яких немає, дають порожні значення. */
export function rvRow(byRole) {
  const resRaw = text(byRole['strike-result']);
  const day = text(byRole['event-date']).slice(0, 10);
  const count = /^(\d+)/.exec(text(byRole['munition-count']));
  const flag = text(byRole['abort-flag']);
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '',
    resRaw,
    kind: resKind(resRaw),
    abort: /відбій/i.test(resRaw) || !NO_FLAG.test(flag),
    count: count ? Number(count[1]) : 0,
    time: text(byRole['event-time']),
    aircraft: text(byRole['platform-type']),
    firingUnit: text(byRole['firing-unit']),
    targetId: text(byRole['target-id']),
    munition: text(byRole['munition-type']).toUpperCase(),
    unit: text(byRole.unit),
    types: text(byRole['target-type']).split(/\s*,\s*/).filter(Boolean),
  };
}

const number = value => new Intl.NumberFormat('uk-UA').format(value);

/**
 * Модель картки для `mountChart` (вид `kpi`): значення за рядки періоду, примітка й міні-графік за днями.
 * `definition` — визначення реєстру (для перевірки ролей); `rows` — рядки основної таблиці в межах періоду картки.
 * `{ ok: true, model }` або `{ ok: false, message }`, якщо ролі блока в таблиці не зіставлено.
 */
// Вид діаграми, який людина вибирає в «⋯» (`instance.style.view`): варіанти для тих самих рядків; типовий — перший.
const VIEW_LABELS = { donut: 'Кільце', 'horizontal-bar': 'Горизонтальні смуги', columns: 'Вертикальні стовпчики', 'stacked-columns': 'Стовпчики', line: 'Лінії', area: 'Області', combo: 'Стовпчики з лінією БП' };
const VIEW_GROUPS = { combo: ['combo', 'columns', 'line'], 'stacked-columns': ['stacked-columns', 'line', 'area'] };

/** Види діаграми блока для вибору: `[{ id, label }]`, типовий першим; порожньо для показників і невідомих блоків. */
export function chartViews(definitionId) {
  const spec = Object.hasOwn(charts(), definitionId) ? charts()[definitionId] : null;
  if (!spec) return [];
  const group = VIEW_GROUPS[spec.kind] || [spec.kind, ...['donut', 'horizontal-bar', 'columns'].filter(kind => kind !== spec.kind)];
  return group.map(id => ({ id, label: VIEW_LABELS[id] }));
}

/** Кольори картки (`instance.style.accent`): «За змістом» — як на вкладках; решта — одна гама на всю картку. */
export const CARD_PALETTES = [
  { id: '', label: 'За змістом' },
  { id: 'branch', label: 'Колір роду військ' },
  { id: 'blue', label: 'Синій' },
  { id: 'green', label: 'Зелений' },
  { id: 'amber', label: 'Бурштиновий' },
  { id: 'red', label: 'Червоний' },
];

// Результат ураження має свій колір незалежно від порядку (номер кольору палітри діаграм, `--ewmc-sN`):
// знищено — зелений, пошкоджено — бурштиновий, подавлено — жовтий, не уражено — червоний, інше — фіолетовий.
const RESULT_SLOTS = { Знищено: 3, Уражено: 3, Пошкоджено: 2, Подавлено: 5, 'Не уражено': 8, 'Не відомо': 4 };
const RESULT_CHARTS = new Set(['legacy:result-distribution', 'legacy:result-dynamics', 'legacy:hour-of-day']);
function resultColors(model) {
  const slot = (name, fallback) => RESULT_SLOTS[name] ?? fallback;
  if (Array.isArray(model.slices)) return { ...model, slices: model.slices.map(item => ({ ...item, slot: slot(item.label, item.slot) })) };
  if (Array.isArray(model.series)) return { ...model, series: model.series.map(item => ({ ...item, slot: slot(item.name, item.slot) })) };
  return model;
}

// `title` — назва картки на дашборді: відмінна від назви визначення (зразок ПС: «Вильоти») стає підписом показника.
export function blockCardModel({ definition, schema, sourceId, rows, view = '', title = '' }) {
  const card = CARDS[definition?.definitionId];
  const chart = Object.hasOwn(charts(), definition?.definitionId) ? charts()[definition.definitionId] : null;
  if (!card && !chart) return { ok: false, message: 'Цей блок ще не вміє рахуватися з основної таблиці.' };
  if (!schema) return { ok: false, message: 'Схему профілю не прочитано: ролі стовпців невідомі.' };
  const verdict = availability([definition], schema, sourceId);
  if (!verdict.ok) return { ok: false, message: verdict.message };
  const status = verdict.definitions[0];
  if (status.status !== 'available') {
    return { ok: false, message: `Бракує зіставлених ролей: ${status.adds.join(', ') || 'невідомо'}. Зіставте їх у «Ролях стовпців» основної таблиці.` };
  }
  const list = (Array.isArray(rows) ? rows : []).map(row => rvRow(readRow(schema, sourceId, row).byRole || {}));
  if (chart) {
    const kind = chartViews(definition.definitionId).some(item => item.id === view) ? view : chart.kind;
    const module = { id: definition.definitionId, templateId: definition.definitionId, visualKind: kind, fields: chart.fields.map((field, position) => ({ ...field, position })) };
    const model = chartModel(module, chart.rows(list));
    return { ok: true, kind, model: RESULT_CHARTS.has(definition.definitionId) ? resultColors(model) : model };
  }
  const A = agg(list);
  const value = card.value(A);
  const days = new Map();
  for (const row of list) if (row.date) days.set(row.date, [...(days.get(row.date) || []), row]);
  const dates = [...days.keys()].sort();
  const history = dates.slice(-12).map(day => card.value(agg(days.get(day))));
  // Максимуми за добу, середнє й зміна — тим самим `computeRvKpis`, що й вкладка РВ, у межах дат цих рядків.
  const K = dates.length ? computeRvKpis({ rows: list, from: dates[0], to: dates.at(-1), dmin: dates[0], effMode: 'sum' }) : null;
  const change = K ? K.change[card.key] : null;
  return {
    ok: true,
    kind: 'kpi',
    model: {
      kind: 'kpi',
      empty: !list.length,
      label: title && title !== definition.title ? title : card.label,
      value,
      valueText: number(value),
      unit: list.length ? card.note(A) : '',
      delta: change,
      deltaText: change == null ? '' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}%`,
      deltaNote: change == null ? '' : K.dlLabel,
      tone: card.tone,
      share: card.share && list.length ? shareOfOps(A, value) : null,
      tiles: card.tiles.map(tile => tile(A, K)),
      history: history.length > 1 ? history : [],
      historyMax: Math.max(1e-9, ...history),
      historyMin: Math.min(0, ...history),
    },
  };
}

/**
 * Ставить картку блока на «Мій дашборд»: показник — третина ширини (три в рядок, як на вкладці РВ), діаграма —
 * половина. Нова картка стає перед карткою своєї основної таблиці, тож блоки збираються зверху, а перелік записів
 * лишається під ними, як на вкладках ПС і РВ. Щойно створена таблиця (`freshTable`) дістає всю ширину.
 * Повертає `{ ok, layout }` ядра розкладки.
 */
export function placeBlockCard(layout, { definition, sourceId, freshTable = false }) {
  const added = addInstance(layout, { definitionId: definition.definitionId, sourceId, title: definition.title, size: definition.visual === 'kpi' ? { w: 4, h: 2 } : { w: 6, h: 4 } });
  const table = added.ok && added.layout.instances.find(item => item.sourceId === sourceId && !hasBlockCard(item.definitionId));
  if (!table) return added;
  const card = added.layout.instances.find(item => !layout.instances.some(old => old.id === item.id));
  const wide = freshTable ? resizeInstance(added.layout, table.id, 12) : added;
  const base = wide.ok ? wide : added;
  const moved = moveInstance(base.layout, card.id, table.id);
  return moved.ok ? moved : base;
}
