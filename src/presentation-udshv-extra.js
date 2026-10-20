/* Доповнення слайдів колоди УДШВ: діаграма «Типи уражених цілей», кругові діаграми
   «Втрати артилерії противника в порівнянні з нашими» й текст для анотацій слайда.
   Чисте ядро без DOM. Лише колода УДШВ; колоди модулів ПС і РВ цього не використовують. */

import { inRange, sumGroup } from './own-losses-core.js';
import { isoFromDay, dayNumber, longDate, rollingRange } from './presentation-format.js';

/** Категорії діаграми «Типи уражених цілей»: за назвою стовпця таблиці УДШВ, перший збіг виграє.
    Що не збіглось і є технікою — «ОВТ»; об'єкти поза переліком у діаграму не потрапляють. Шаблони правляться тут або в options.config.targetTypes. */
export const DEFAULT_TARGET_TYPES = [
  { label: 'ПУ БпЛА', pattern: 'пу бпла' },
  { label: 'КСП', pattern: 'ксп' },
  { label: 'Артсистеми', pattern: 'арт|гаубиц|сау|(^|[^а-яіїєґ0-9])2с\\d|м777|д-30|гармат|міномет|рсзв|град|ураган|смерч|коксан' },
  { label: 'ІФС', pattern: 'іфс|фортиф|укритт|бліндаж|опорн' },
];
const EQUIPMENT_LABEL = 'ОВТ';
const normName = name => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Категорія стовпця або '' (поза діаграмою). classify — classifyTarget з presentation-core: 'equipment' | 'object'. */
export function targetTypeOf(name, classify, config) {
  const text = normName(name);
  for (const { label, pattern } of config.targetTypes || DEFAULT_TARGET_TYPES) if (new RegExp(pattern, 'iu').test(text)) return label;
  return classify(name, config) === 'equipment' ? EQUIPMENT_LABEL : '';
}

const metricsOf = (records, group) => {
  const totals = new Map();
  for (const r of records) for (const [id, v] of Object.entries(r.values)) if (id.startsWith(`${group}|`)) totals.set(id.slice(group.length + 1), (totals.get(id.slice(group.length + 1)) || 0) + v);
  return totals;
};

/** Діаграма «Типи уражених цілей»: знищено й пошкоджено за категоріями (групи ЗНИЩЕНО, ПОШКОДЖЕНО таблиці УДШВ). Серії «не уражено» в таблиці УДШВ немає. */
export function targetTypeChart(records, classify, config) {
  const labels = [EQUIPMENT_LABEL, ...(config.targetTypes || DEFAULT_TARGET_TYPES).map(t => t.label)];
  const count = group => {
    const sums = Object.fromEntries(labels.map(l => [l, 0]));
    for (const [name, total] of metricsOf(records, group)) { const label = targetTypeOf(name, classify, config); if (label) sums[label] += total; }
    return labels.map(l => sums[l]);
  };
  return { id: 'target-types', title: 'Типи уражених цілей', horizontal: true, categories: labels, series: [{ name: 'знищено', values: count('destroyed') }, { name: 'пошкоджено', values: count('damaged') }] };
}

/** Артилерія противника (знищено + пошкоджено) за записами таблиці УДШВ. */
export function enemyArtillery(records, classify, config) {
  let total = 0;
  for (const group of ['destroyed', 'damaged']) for (const [name, n] of metricsOf(records, group)) if (targetTypeOf(name, classify, config) === 'Артсистеми') total += n;
  return total;
}

/** Дві кругові діаграми: попередні 7 діб і останні 7 діб. Наші арт. втрати — знищені + пошкоджені з таблиці НАШІ ВТРАТИ. */
export function artilleryPies({ workbook, own, anchor, classify, config }) {
  const last = rollingRange(anchor, 7);
  const before = { from: isoFromDay(dayNumber(last.from) - 7), to: isoFromDay(dayNumber(last.from) - 1) };
  const ownRecords = own.records.filter(r => !r.suspect);
  return [before, last].map(range => ({
    title: `Втрати артилерії противника в порівнянні з нашими за період ${longDate(range.from)}–${longDate(range.to)}`,
    labels: ['противник', 'наші втрати'],
    values: [
      enemyArtillery(workbook.records.filter(r => inRange(r, range)), classify, config),
      sumGroup(ownRecords.filter(r => inRange(r, range)), 'destroyed') + sumGroup(ownRecords.filter(r => inRange(r, range)), 'damaged'),
    ],
  }));
}

/** Текст блоків слайда для анотацій: заголовок і рядки. Те, що раніше стояло в правій панелі. */
export function annotationOf(data) {
  const sections = [
    ['Що змінилось', data.changes, 'Суттєвих змін (від 20 %) не виявлено.'],
    ['На що звернути увагу', data.attention, 'Відхилень не виявлено.'],
    [data.thirdTitle || 'Можливі причини', data.hypotheses || [], 'Змін і відхилень, що потребують пояснення, немає.'],
  ];
  return sections.flatMap(([title, items, empty]) => [title, ...(items && items.length ? items : [{ text: empty }]).map(i => `• ${i.text}`)]).join('\n');
}
