/* Анімації дашбордів ПВК і УДШВ (разом із вкладкою «Наші втрати»).
   Дашборд при кожному кліку по фільтру будує сторінку заново, тому анімацію не можна вішати на саме створення вузлів:
   playMotion вмикає її лише коли змінився розділ або дашборд відкрито вперше, а в інших перемальовуваннях
   прибирає атрибут data-dash-motion — і сторінка з'являється миттєво. Стилі — у dashboard-motion.css. */

const lastView = new WeakMap();

const COUNT_SELECTOR = [
  '.ud-kpi > strong', '.pvk-kpi > strong', '.ol-kpi > strong',
  '.pvk-value', '.pvk-donut b', '.pvk-result-rates strong',
].join(',');
// Затримки по групах: сусідні елементи з'являються по черзі, але загальна «хвиля» не довша за кілька сотень мс.
const STAGGER_GROUPS = [
  { selector: '.ud-kpis, .pvk-kpis, .pvk-quality-kpis, .ol-kpis', items: ':scope > *', step: 45, cap: 360 },
  { selector: '.ud-page, .pvk-page, .ol-root, .ud-grid-2, .ud-grid-3, .ol-grid-2, .ol-grid-3, .pvk-metric-grid', items: ':scope > :is(.ud-card, .pvk-section, .ol-card, .ol-head, .pvk-page-head, .pvk-metric, .ud-issue)', step: 70, cap: 420 },
  { selector: '.ud-rank, .pvk-ranking, .ol-rank', items: ':scope > *', step: 35, cap: 420, inner: 'b' },
  { selector: '.ud-week', items: ':scope > div', step: 45, cap: 315, inner: 'b' },
  { selector: '.pvk-calendar, .pvk-cal-days', items: ':scope > .pvk-day', step: 12, cap: 420 },
  { selector: '.ud-heat tbody', items: ':scope > tr', step: 14, cap: 360, inner: 'td' },
];
const CHART_SELECTOR = '.ud-chart svg, .ol-chart svg, .pvk-stacked, .pvk-daybars';

/** Рух вимкнено системним «зменшити рух» або перемикачем «Анімації» застосунку (атрибут data-motion="off" на <html>). */
export function prefersReducedMotion() {
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.motion === 'off') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const setDelay = (node, ms) => node.style.setProperty('--dm-d', `${Math.round(ms)}ms`);

function stagger(root) {
  for (const group of STAGGER_GROUPS) {
    for (const host of root.querySelectorAll(group.selector)) {
      let index = 0;
      for (const item of host.querySelectorAll(group.items)) {
        const delay = Math.min(index * group.step, group.cap);
        setDelay(item, delay);
        // Смуги всередині рядка рейтингу ростуть трохи пізніше за сам рядок.
        if (group.inner) for (const inner of item.querySelectorAll(group.inner)) setDelay(inner, delay + 120);
        index += 1;
      }
    }
  }
  // Стовпчики SVG-графіків: хвиля зліва направо, не довша за ~0,4 с незалежно від кількості днів
  // (уся вхідна постановка вкладається в 1200 мс — див. тест у tests/dashboard-motion.test.mjs).
  for (const svg of root.querySelectorAll(CHART_SELECTOR)) {
    const bars = [...svg.querySelectorAll('rect')].filter(rect => !rect.classList.contains('ud-hit') && !rect.classList.contains('ol-hit'));
    const step = Math.min(18, 400 / Math.max(1, bars.length));
    bars.forEach((rect, i) => setDelay(rect, 160 + i * step));
  }
  // Лінії, спарклайни й кільця стартують після того, як з'явилась їхня картка.
  for (const node of root.querySelectorAll('.ud-spark, .ol-spark, .pvk-spark, .pvk-kpi-spark, .pvk-lines, .pvk-donut')) setDelay(node, 220);
}

const parseCount = text => {
  const clean = String(text).replace(/[\s  ]/g, '');
  return /^\d{1,12}$/.test(clean) ? Number(clean) : null;
};
const formatCount = value => Math.round(value).toLocaleString('uk-UA');
const easeOutCubic = t => 1 - (1 - t) ** 3;

/** Числа в картках «набігають» від нуля. Лишаються без анімації, якщо текст не просте ціле (відсотки, діапазони, «—»). */
function countUp(root, duration = 750) {
  const targets = [];
  for (const node of root.querySelectorAll(COUNT_SELECTOR)) {
    const original = node.textContent;
    const value = parseCount(original);
    // Нуль і одиниця не анімуються: нема на що «набігати».
    if (value == null || value < 2 || formatCount(value) !== original) continue;
    targets.push({ node, value, original });
  }
  if (!targets.length) return;
  const start = performance.now();
  const frame = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = easeOutCubic(t);
    for (const { node, value, original } of targets) {
      if (!node.isConnected) continue;
      node.textContent = t >= 1 ? original : formatCount(value * eased);
    }
    if (t < 1 && targets.some(item => item.node.isConnected)) requestAnimationFrame(frame);
  };
  for (const { node } of targets) node.textContent = '0';
  requestAnimationFrame(frame);
}

/**
 * Викликається в кінці render() дашборда, коли сторінку вже додано в root.
 * @param {HTMLElement} root корінь дашборда (#pvk-dashboard-root, #udshv-dashboard-root)
 * @param {string} viewKey ключ поточного розділу; зміна ключа вмикає анімацію
 * @returns {boolean} чи було запущено анімацію
 */
export function playMotion(root, viewKey) {
  if (!root) return false;
  const previous = lastView.get(root);
  lastView.set(root, viewKey);
  if (previous === viewKey || prefersReducedMotion()) {
    root.removeAttribute('data-dash-motion');
    return false;
  }
  // Спрощений DOM (наприклад, у тестах) не вміє шукати вузли: тоді анімацію пропускаємо, рендер не страждає.
  if (typeof root.querySelectorAll !== 'function') return false;
  root.setAttribute('data-dash-motion', previous === undefined ? 'first' : 'enter');
  stagger(root);
  countUp(root);
  return true;
}

/** Забуває запам'ятований розділ: наступне відкриття дашборда знову покаже вступну анімацію. */
export function resetMotion(root) {
  if (root) { lastView.delete(root); root.removeAttribute('data-dash-motion'); }
}
