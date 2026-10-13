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
