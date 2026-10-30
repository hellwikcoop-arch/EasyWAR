// Картка блока реєстру з основної таблиці (E5, крок 4): чиста логіка без DOM. Блок, доданий у основну таблицю
// (module-add-columns-core.js), стає карткою «Мого дашборда» і рахується з рядків цієї таблиці за ролями, які
// користувач підтвердив у схемі профілю (`readRow`). Числа — тим самим ядром, що й картки дашборда РВ
// (module-adapters/rv-kpi-core.js), тож «Знищено» з таблиці й з вкладки РВ рахуються однаково. Нічого не записує.

import { agg, resKind, shareOfOps } from './module-adapters/rv-kpi-core.js';
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

/** Чи вміє визначення бути карткою з основної таблиці. */
export const hasBlockCard = definitionId => Object.hasOwn(CARDS, definitionId);

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
    aircraft: text(byRole['platform-type']),
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
  if (!card) return { ok: false, message: 'Цей блок ще не вміє рахуватися з основної таблиці.' };
  if (!schema) return { ok: false, message: 'Схему профілю не прочитано: ролі стовпців невідомі.' };
  const verdict = availability([definition], schema, sourceId);
  if (!verdict.ok) return { ok: false, message: verdict.message };
  const status = verdict.definitions[0];
  if (status.status !== 'available') {
    return { ok: false, message: `Бракує зіставлених ролей: ${status.adds.join(', ') || 'невідомо'}. Зіставте їх у «Ролях стовпців» основної таблиці.` };
  }
  const list = (Array.isArray(rows) ? rows : []).map(row => rvRow(readRow(schema, sourceId, row).byRole || {}));
  const A = agg(list);
  const value = card.value(A);
  const days = new Map();
  for (const row of list) if (row.date) days.set(row.date, [...(days.get(row.date) || []), row]);
  const history = [...days.keys()].sort().slice(-12).map(day => card.value(agg(days.get(day))));
  return {
    ok: true,
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
