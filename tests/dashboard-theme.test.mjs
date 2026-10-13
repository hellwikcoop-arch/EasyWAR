import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.doesNotMatch(css, /url\(/, 'тема не тягне нових зображень');
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
