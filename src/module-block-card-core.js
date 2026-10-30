// Картка блока реєстру з основної таблиці (E5, кроки 4–5): чиста логіка без DOM. Блок, доданий у основну таблицю
// (module-add-columns-core.js), стає карткою «Мого дашборда» і рахується з рядків цієї таблиці за ролями, які
// користувач підтвердив у схемі профілю (`readRow`). Числа — тим самим ядром, що й картки дашборда РВ
// (module-adapters/rv-kpi-core.js), тож «Знищено» з таблиці й з вкладки РВ рахуються однаково. Нічого не записує.

import { agg, eff, resKind, rocketOutcome, shareOfOps } from './module-adapters/rv-kpi-core.js';
import { chartModel } from './dashboard-module-charts-core.js';
import { availability, readRow } from './profile-schema-core.js';

const share = (A, x) => `${shareOfOps(A, x)}% від пусків`;

// Прості об'єкти без `Object.freeze`: виклик на верхньому рівні не вилучається зі збірки ПВК-lite (ліміт 5 МБ).
/** Картки, які вміють рахуватися з основної таблиці: визначення реєстру → показник і підпис. */
const CARDS = {
  'legacy:rv-kpi-launches': { label: 'Пуски', value: A => A.n, note: () => '' },
  'legacy:rv-kpi-munitions': { label: 'Використано БП', value: A => A.mun, note: A => (A.n ? `${(A.mun / A.n).toFixed(1).replace('.', ',')} БП на пуск` : '') },
  'legacy:rv-kpi-destroyed': { label: 'Знищено', value: A => A.destroyed, note: A => share(A, A.destroyed) },
  'legacy:rv-kpi-damaged': { label: 'Пошкоджено / подавлено', value: A => A.damaged + A.suppressed, note: A => share(A, A.damaged + A.suppressed) },
  'legacy:rv-kpi-miss': { label: 'Не уражено', value: A => A.miss, note: A => share(A, A.miss) },
  'legacy:rv-kpi-unknown': { label: 'Не відомо', value: A => A.unk, note: A => share(A, A.unk) },
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
export function blockCardModel({ definition, schema, sourceId, rows }) {
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
    const module = { id: definition.definitionId, templateId: definition.definitionId, visualKind: chart.kind, fields: chart.fields.map((field, position) => ({ ...field, position })) };
    return { ok: true, kind: chart.kind, model: chartModel(module, chart.rows(list)) };
  }
  const A = agg(list);
  const value = card.value(A);
  const days = new Map();
  for (const row of list) if (row.date) days.set(row.date, [...(days.get(row.date) || []), row]);
  const history = [...days.keys()].sort().slice(-12).map(day => card.value(agg(days.get(day))));
  return {
    ok: true,
    kind: 'kpi',
    model: {
      kind: 'kpi',
      empty: !list.length,
      label: card.label,
      value,
      valueText: number(value),
      unit: list.length ? card.note(A) : '',
      delta: null,
      deltaText: '',
      deltaNote: '',
      history: history.length > 1 ? history : [],
      historyMax: Math.max(1e-9, ...history),
      historyMin: Math.min(0, ...history),
    },
  };
}
