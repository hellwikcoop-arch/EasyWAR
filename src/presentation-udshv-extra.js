/* Доповнення слайдів колоди УДШВ: діаграма «Типи уражених цілей», кругові діаграми
   «Втрати артилерії противника в порівнянні з нашими» й текст для анотацій слайда.
   Чисте ядро без DOM. Лише колода УДШВ; колоди модулів ПС і РВ цього не використовують. */

import { inRange, sumGroup } from './own-losses-core.js';
import { isoFromDay, dayNumber, longDate, rollingRange } from './presentation-format.js';

const normName = name => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Артилерія противника в кругових діаграмах: стовпці групи «Втрати противника за категоріями» (перевіряється власником). */
export const DEFAULT_ARTILLERY_CATEGORIES = ['Артилерія'];

const categoryTotals = records => {
  const totals = new Map();
  for (const r of records) for (const [id, v] of Object.entries(r.values)) if (id.startsWith('categories|')) totals.set(id.slice(11), (totals.get(id.slice(11)) || 0) + v);
  return totals;
};

/** Діаграма «Типи уражених цілей»: стовпці групи «Втрати противника за категоріями» таблиці УДШВ (артилерія, міномети, РЕБ, ПУ/КП/КСП, ПУ БпЛА,
    АТ різних типів, танки/ББМ, переправа, склади БК/ПММ, ІФС), за спаданням. Лічильник один на категорію, поділу на знищено/пошкоджено в таблиці немає. */
export function targetTypeChart(records) {
  const rows = [...categoryTotals(records)].filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk'));
  return { id: 'target-types', title: 'Типи уражених цілей', horizontal: true, categories: rows.map(([name]) => name), series: [{ name: 'Уражено', values: rows.map(([, total]) => total) }] };
}

/** Артилерія противника за записами таблиці УДШВ. */
export function enemyArtillery(records, config = {}) {
  const names = new Set((config.artilleryCategories || DEFAULT_ARTILLERY_CATEGORIES).map(normName));
  let total = 0;
  for (const [name, n] of categoryTotals(records)) if (names.has(normName(name))) total += n;
  return total;
}

/** Дві кругові діаграми: попередні 7 діб і останні 7 діб. Наші арт. втрати — знищені + пошкоджені з таблиці НАШІ ВТРАТИ. */
export function artilleryPies({ workbook, own, anchor, config }) {
  const last = rollingRange(anchor, 7);
  const before = { from: isoFromDay(dayNumber(last.from) - 7), to: isoFromDay(dayNumber(last.from) - 1) };
  const ownRecords = own.records.filter(r => !r.suspect);
  return [before, last].map(range => ({
    title: `Втрати артилерії противника в порівнянні з нашими за період ${longDate(range.from)}–${longDate(range.to)}`,
    labels: ['противник', 'наші втрати'],
    values: [
      enemyArtillery(workbook.records.filter(r => inRange(r, range)), config),
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
