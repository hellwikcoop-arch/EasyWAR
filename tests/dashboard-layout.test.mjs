import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('меню дашбордів: кнопки мають data-nav, а кожен розділ УДШВ і ПВК — свою іконку', async () => {
  const css = await read('dashboard-layout.css');
  for (const file of ['udshv-dashboard.js', 'pvk-dashboard.js']) assert.match(await read(file), /'data-nav': key/, file);
  for (const key of ['summary', 'units', 'personnel', 'own', 'ovt', 'ammo', 'freshness', 'table', 'quality']) assert.ok(css.includes(`.ud-nav button[data-nav="${key}"]`), `УДШВ: ${key}`);
  for (const key of ['summary', 'journal', 'own', 'table', 'quality', 'АА', 'ПС', "Об'єкти"]) assert.ok(css.includes(`.pvk-nav button[data-nav="${key}"]`), `ПВК: ${key}`);
  // Кожна змінна --nav-icon посилається на оголошену --ic-*.
  const declared = new Set([...css.matchAll(/--(ic-[a-z]+):\s*url/g)].map(m => m[1]));
  for (const [, name] of css.matchAll(/--nav-icon:\s*var\(--(ic-[a-z]+)\)/g)) assert.ok(declared.has(name), name);
});

test('компонування: ліве меню лише від 1200px, поля замість gap, без анімацій і зовнішніх адрес', async () => {
  const css = await read('dashboard-layout.css');
  assert.match(css, /@media \(min-width: 1200px\)/);
  assert.match(css, /grid-column: 1; grid-row: 1 \/ span \d+/);
  assert.doesNotMatch(css, /animation|@keyframes|url\(\s*['"]?https?:/);
  for (const page of ['air.html', 'rocket.html']) {
    const html = await read(page);
    assert.match(html, /<link rel="stylesheet" href="\.\/dashboard-layout\.css">/, page);
    assert.ok(html.indexOf('dashboard-layout.css') < html.indexOf('dashboard-theme.css'), page);
  }
});

test('картки внизу меню: лише локальні зображення з папок *-art, лише темна тема', async () => {
  const css = await read('dashboard-layout.css');
  for (const [, target] of css.matchAll(/url\('?(\.[^')]*)'?\)/g)) assert.match(target, /^\.\/(udshv|pvk)-art\/[\w-]+\.webp$/, target);
  assert.match(css, /html:not\(\[data-theme="light"\]\) #pvk-dashboard-root > \.pvk-nav::after/);
  assert.match(css, /html:not\(\[data-theme="light"\]\) #udshv-dashboard-root > \.ud-nav::after/);
});

test('картки показників ПВК: кожен ключ icon з pvk-dashboard.js має маску, а міні-графік — реальний ряд з моделі', async () => {
  const js = await read('pvk-dashboard.js');
  const css = await read('dashboard-layout.css');
  const core = await read('module-adapters/pvk-dynamics-core.js');
  const keys = new Set([...js.matchAll(/icon:\s*'([\w-]+)'/g)].map(match => match[1]));
  assert.ok(keys.size >= 8, `ключів іконок: ${keys.size}`);
  for (const key of keys) {
    assert.match(css, new RegExp(`\\.pvk-kpi-ic\\[data-ic="${key}"\\]\\s*\\{\\s*--kpi-ic:\\s*var\\(--ic-${key}\\)`), `немає маски для ${key}`);
    assert.match(css, new RegExp(`--ic-${key}:\\s*url\\(`), `немає --ic-${key}`);
  }
  // Ряди для графіків беруться лише з summary.dynamics, який рахує спільне ядро; вигаданих рядів на фронтенді немає.
  for (const [, series] of js.matchAll(/series:\s*summary\.dynamics\.(\w+)/g)) assert.match(core, new RegExp(`\\b${series}:\\s*(mergeDaily|activity)`), `ядро не рахує dynamics.${series}`);
});

test('картки УДШВ: плитка-іконка, міні-графік із заливкою, число лишається прямим нащадком картки', async () => {
  const js = await read('udshv-dashboard.js');
  const css = await read('udshv-dashboard.css');
  assert.match(js, /class: 'ud-kpi-ic'/);
  assert.match(js, /class: 'ud-spark-area'/);
  // Лічильник чисел (dashboard-motion.js) шукає '.ud-kpi > strong': розмітку не вкладаємо.
  assert.match(css, /grid-template-areas:\s*"ic label spark" "ic value spark" "ic delta spark" "hint hint hint"/);
  for (const area of ['ic', 'label', 'value', 'delta', 'spark', 'hint']) assert.match(css, new RegExp(`grid-area:\\s*${area}\\b`), area);
  assert.match(css, /@container ud-kpi \(max-width: 219px\)/);
  const layout = await read('dashboard-layout.css');
  assert.match(layout, /#udshv-dashboard-root \.ud-kpis:not\(\.ud-kpis-3\) \{ grid-template-columns: repeat\(3/);
});
