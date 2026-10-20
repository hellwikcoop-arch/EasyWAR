// Виноски до уразливих місць і рядок ТТХ довідника авіації. Лише чиста логіка, без DOM і three:
// main.js проєктує точки моделі на екран, а тут вирішується, де стоять підписи й що показує рядок ТТХ.

/** Номер виноски з провідним нулем: 1 → «01». */
export const calloutNumber = (index) => String(index + 1).padStart(2, '0');

// Групи рядка ТТХ: з кожної береться перший наявний рядок характеристик, у такому порядку.
const TTX_GROUPS = [
  ['Макс. швидкість', 'Швидкість'],
  ['Дальність', 'Бойовий радіус'],
  ['Стеля', 'Практична стеля'],
  ['Макс. злітна маса', 'Стартова маса', 'Нормальна злітна маса'],
];

/**
 * Чотири головні характеристики для рядка під сценою. Якщо якоїсь групи немає, місце займає
 * наступний числовий рядок характеристик, якого ще немає в рядку; без чисел рядок не показується.
 */
export function ttxItems(specs, limit = 4) {
  const rows = (Array.isArray(specs) ? specs : []).filter((row) => Array.isArray(row) && row[0] && /\d/.test(row[1] ?? ''));
  const picked = [];
  for (const group of TTX_GROUPS) {
    const row = group.map((key) => rows.find(([label]) => label === key)).find(Boolean);
    if (row) picked.push(row);
  }
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (!picked.includes(row) && row[0] !== 'Екіпаж') picked.push(row);
  }
  // У рядку — лише головне число: уточнення в дужках («(перегін 1 110)») лишається в таблиці й підказці.
  return picked.slice(0, limit).map(([label, value]) => ({ label, value: String(value).replace(/\s*\(.*\)\s*$/, ''), full: String(value) }));
}

/**
 * Розкладка виносок: підписи стоять двома стовпцями біля країв сцени, ліворуч — для точок лівої
 * половини, праворуч — для правої. Лінія йде від точки навскіс до «ліктя» і далі горизонтально до
 * підпису. У стовпці підписи не налазять один на одного: сортуються за висотою точки й
 * розсуваються щонайменше на `gap`, не виходячи за межі сцени.
 *
 * points: [{ x, y }] у пікселях сцени. Повертає для кожної точки { side, labelX, labelY, elbowX, maxWidth }
 * або null, коли сцена завузька для стовпців (тоді лишаються самі номери на моделі).
 */
/** Найвужчий стовпець підписів: вужчий читати важко, тоді краще накрити край моделі. */
const MIN_COLUMN = 72;

export function calloutLayout(points, { width, height, column = 150, pad = 14, gap = 30, top = 34, bottom = 30, minWidth = 560 } = {}) {
  if (!(width >= minWidth) || !(height > top + bottom)) return points.map(() => null);
  const out = points.map(() => null);
  const sides = { left: [], right: [] };
  points.forEach((point, index) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    sides[point.x < width / 2 ? 'left' : 'right'].push({ index, ...point });
  });
  for (const [side, items] of Object.entries(sides)) {
    items.sort((a, b) => a.y - b.y);
    const low = top + gap / 2;
    const high = height - bottom - gap / 2;
    // Спершу кожен підпис на висоті своєї точки, потім униз, щоб не налазили, і вгору від нижньої межі.
    const ys = items.map((item) => Math.min(high, Math.max(low, item.y)));
    for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i], ys[i - 1] + gap);
    for (let i = ys.length - 1; i >= 0; i -= 1) {
      const limit = i === ys.length - 1 ? high : ys[i + 1] - gap;
      ys[i] = Math.max(low, Math.min(ys[i], limit));
    }
    // Стовпець стоїть ближче до краю, ніж найкрайніша точка його боку: підпис не накриває номер на моделі.
    const reach = 28;
    const edge = side === 'left' ? Math.min(...items.map((item) => item.x)) - reach : Math.max(...items.map((item) => item.x)) + reach;
    const labelX = side === 'left'
      ? Math.max(pad + MIN_COLUMN, Math.min(pad + column, edge))
      : Math.min(width - pad - MIN_COLUMN, Math.max(width - pad - column, edge));
    const maxWidth = side === 'left' ? labelX - pad : width - pad - labelX;
    items.forEach((item, i) => {
      // Лікоть — на півдорозі між точкою й стовпцем, але не далі за саму точку.
      const elbowX = side === 'left' ? Math.min(item.x, (item.x + labelX) / 2) : Math.max(item.x, (item.x + labelX) / 2);
      out[item.index] = { side, labelX, labelY: ys[i], elbowX, maxWidth };
    });
  }
  return out;
}
