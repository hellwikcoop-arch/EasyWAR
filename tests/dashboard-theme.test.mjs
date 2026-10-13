import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('тема дашбордів: усі правила лише для темної теми, без зображень і анімацій', async () => {
  const css = (await read('dashboard-theme.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  // Кожен селектор (до «{») починається з html:not([data-theme="light"]) — світла тема лишається як була.
  const selectors = css.split('{').slice(0, -1).map(chunk => chunk.split('}').pop().trim()).filter(Boolean);
  assert.ok(selectors.length > 20);
  // Коми всередині :is(...) не розділяють селектори, тому ділимо лише на нульовому рівні дужок.
  const topLevel = text => { const out = []; let depth = 0; let cur = ''; for (const ch of text) { if (ch === '(') depth += 1; if (ch === ')') depth -= 1; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  for (const group of selectors) for (const one of topLevel(group)) assert.match(one.trim(), /^html:not\(\[data-theme="light"\]\)/, one.trim());
  // Зображення лише локальні файли з папок *-art (фото шапок), жодних зовнішніх адрес.
  for (const [, target] of css.matchAll(/url\(([^)]*)\)/g)) assert.match(target.replace(/['"]/g, ''), /^\.\/(udshv|pvk)-art\/[\w-]+\.(svg|webp)$/, target);
  assert.doesNotMatch(css, /animation|@keyframes/, 'рух живе в dashboard-motion.css');
  for (const marker of ['#udshv-dashboard-root', '#pvk-dashboard-root', '.ol-root', '.ud-hero', '.pvk-hero', '.ud-kpi', '.pvk-kpi']) assert.ok(css.includes(marker), marker);
});

test('тема дашбордів підключена на сторінках ПС і РВ після стилів руху', async () => {
  for (const page of ['air.html', 'rocket.html']) {
    const html = await read(page);
    assert.match(html, /<link rel="stylesheet" href="\.\/dashboard-theme\.css">/, page);
    assert.ok(html.indexOf('dashboard-theme.css') > html.indexOf('dashboard-motion.css'), page);
  }
});

test('картки KPI з фото: кожен ключ data-photo із pvk-dashboard.js має правило в темі та локальний файл', async () => {
  const js = await read('pvk-dashboard.js');
  const css = (await read('dashboard-theme.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  // Ключі беремо з викликів kpi(..., тон, 'ключ') — лише тут фото підключаються до карток.
  const keys = [...js.matchAll(/kpi\([^\n]*?,\s*'(?:blue|amber|green|violet|red)',\s*'([\w-]+)'\)/g)].map(match => match[1]);
  assert.deepEqual([...keys].sort(), ['impact', 'jet', 'munition']);
  for (const key of keys) {
    const rule = css.match(new RegExp(`\\.pvk-kpi\\[data-photo="${key}"\\]\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `немає правила для data-photo="${key}"`);
    const file = rule[1].match(/url\('\.\/pvk-art\/([\w-]+\.webp)'\)/);
    assert.ok(file, `правило ${key} без локального webp`);
    const { size } = await stat(new URL(`../src/pvk-art/${file[1]}`, import.meta.url));
    assert.ok(size > 1000 && size < 200_000, `${file[1]}: ${size} байт`);
  }
  // Текст на фото лишається читабельним: тінь під підписами й вимкнений декоративний кружок.
  assert.match(css, /\.pvk-kpi\[data-photo\]::after\s*\{\s*display:\s*none/);
  assert.match(css, /\.pvk-kpi\[data-photo\] :is\(span, small\)\s*\{[^}]*text-shadow/);
});

test('фото в шапці УДШВ не розтягується, а файл лишається легким', async () => {
  const css = (await read('dashboard-theme.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.ud-hero\s*\{([^}]*)\}/);
  assert.ok(rule, 'немає правила .ud-hero');
  // Перший шар — фото; його розмір «auto 100%» зберігає пропорції на будь-якій ширині вікна.
  assert.match(rule[1], /background-size:\s*auto 100%,/);
  const { size } = await stat(new URL('../src/udshv-art/hero-photo.webp', import.meta.url));
  assert.ok(size > 5_000 && size < 80_000, `hero-photo.webp: ${size} байт`);
});
