import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { normalizeCatalog } from '../src/dashboard-module-catalog-core.js';
import { psCatalogUsage } from '../src/module-definition-core.js';
import { CATALOG, KPI_TILES, VIEW_BY_BLOCK } from '../src/ps-kpi.js';
import {
  SOURCE_LABELS, VISUAL_LABELS, addRequest, buildRegistry, countLine, definitionView, facets, filterDefinitions,
} from '../src/module-registry-view-core.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

const raw = await rustCatalog();
const catalog = normalizeCatalog(raw);
const { definitions, problems } = buildRegistry({ rustTemplates: catalog, catalogs: [CATALOG], catalogUsage: psCatalogUsage(KPI_TILES, VIEW_BY_BLOCK) });
const available = new Set(catalog.map(item => item.id));
const byId = id => definitions.find(item => item.definitionId === id);

test('реєстр зі шаблонів, нормалізованих як у застосунку, узгоджений і містить усі три джерела', () => {
  assert.deepEqual(problems, []);
  const sources = new Set(definitions.map(item => item.sourceCatalog));
  assert.deepEqual([...sources].sort(), ['catalog-v1', 'legacy', 'rust-template']);
  assert.equal(definitions.filter(item => item.sourceCatalog === 'rust-template').length, raw.length);
  assert.ok(definitions.length > raw.length);
  // Назви джерел і виглядів покривають увесь реєстр: новий вигляд без підпису провалює тест.
  for (const item of definitions) {
    assert.ok(SOURCE_LABELS[item.sourceCatalog], item.definitionId);
    assert.ok(VISUAL_LABELS[item.visual], `немає підпису для виду «${item.visual}» (${item.definitionId})`);
  }
});

test('фільтри: пошук за словами, тип, вигляд, рід військ і їх поєднання', () => {
  assert.equal(filterDefinitions(definitions).length, definitions.length);
  const kpi = filterDefinitions(definitions, { visual: 'kpi' });
  assert.ok(kpi.length > 3 && kpi.every(item => item.visual === 'kpi'));
  const ps = filterDefinitions(definitions, { branch: 'air' });
  assert.ok(ps.every(item => item.branchTags.includes('air')));
  assert.ok(ps.some(item => item.sourceCatalog === 'rust-template') && ps.some(item => item.sourceCatalog === 'legacy'));
  const dshv = filterDefinitions(definitions, { branch: 'dshv', source: 'legacy' });
  assert.ok(dshv.length > 3 && dshv.every(item => item.sourceCatalog === 'legacy' && item.branchTags.includes('dshv')));
  // Слова шукаються за назвою, обчисленням і назвами ролей даних; усі слова мають зустрітись.
  assert.ok(filterDefinitions(definitions, { query: 'результат ураження' }).every(item => item.requirements.some(r => r.role === 'strike-result') || /результат/iu.test(item.title + item.computation)));
  assert.equal(filterDefinitions(definitions, { query: 'ЗНИЩЕНО втрати о/с' }).length, 0);
  assert.ok(filterDefinitions(definitions, { query: 'кільцева' }).some(item => item.definitionId === 'rust-template:donut'));
  assert.equal(filterDefinitions(definitions, { query: 'такого немає ніде' }).length, 0);
  assert.equal(filterDefinitions(definitions, { query: '   ' }).length, definitions.length);
});

test('facets рахують визначення за типом, виглядом і родом військ', () => {
  const found = facets(definitions);
  assert.equal(found.sources.reduce((sum, item) => sum + item.count, 0), definitions.length);
  assert.equal(found.visuals.reduce((sum, item) => sum + item.count, 0), definitions.length);
  assert.ok(found.branches.some(item => item.value === 'dshv' && item.label === 'УДШВ'));
  assert.deepEqual(found.sources.map(item => item.label).sort(), Object.values(SOURCE_LABELS).sort());
});

test('definitionView: шаблон додається, блок вкладки лише описується з місцем, де він стоїть', () => {
  const rust = definitionView(byId('rust-template:donut'), { available, definitions });
  assert.equal(rust.addable, true);
  assert.equal(rust.reason, '');
  assert.equal(rust.visualLabel, 'Кільцева діаграма');
  assert.ok(rust.requirements.some(item => item.required && item.label === 'Категорія (вимір)'));

  // Однакові вимоги зведено: «Журнал хронометражу» має десятки полів однієї ролі, але один рядок на роль.
  const hours = definitionView(byId('rust-template:flight-hours'), { available, definitions });
  assert.equal(new Set(hours.requirements.map(item => `${item.label}|${item.required}`)).size, hours.requirements.length);
  assert.ok(hours.requirements.some(item => item.count > 5));
  assert.equal(hours.requirements.reduce((sum, item) => sum + item.count, 0), byId('rust-template:flight-hours').requirements.length);
  assert.ok(hours.requirements[0].required, 'обов’язкові спершу');

  const block = definitionView(byId('legacy:strike-map'), { available, definitions });
  assert.equal(block.addable, false);
  assert.match(block.reason, /Уже є на дашборді: Дашборд ПС: p-map; Дашборд РВ: p-map/u);
  assert.ok(block.requirements.some(item => item.label === 'Координати'));
  assert.ok(block.branches.includes('ПС') && block.branches.includes('РВ'));

  const tile = definitionView(byId('catalog-v1:tile.ps-hit'), { available, definitions });
  assert.equal(tile.addable, false);
  assert.equal(tile.sourceLabel, 'Картка ПС');

  const unknown = definitionView(byId('rust-template:donut'), { available: new Set(), definitions });
  assert.equal(unknown.addable, false);
  assert.match(unknown.reason, /немає в каталозі/u);

  const paired = definitionView(byId('legacy:rv-kpi-launches'), { available, definitions });
  assert.equal(paired.counterpart, 'Вильоти');
  const detail = definitionView(byId('legacy:rv-kpi-destroyed'), { available, definitions });
  assert.ok(detail.requirements.some(item => item.detail === 'Знищено'));
});

test('addRequest: лише шаблон «Мого дашборда» з відомого каталогу й відомого роду військ', () => {
  assert.deepEqual(addRequest(byId('rust-template:kpi'), 'pvk', { available }), { branch: 'pvk', templateId: 'kpi', title: 'Ключовий показник', style: 'standard' });
  // Ідентифікатор з дефісом лишається таким, яким його знає Rust.
  assert.equal(addRequest(byId('rust-template:horizontal-bars'), 'air', { available }).templateId, 'horizontal-bars');
  assert.equal(addRequest(byId('legacy:strike-map'), 'air', { available }), null);
  assert.equal(addRequest(byId('catalog-v1:tile.ps-hit'), 'air', { available }), null);
  assert.equal(addRequest(byId('rust-template:kpi'), 'mars', { available }), null);
  assert.equal(addRequest(byId('rust-template:kpi'), 'air', { available: new Set() }), null);
  assert.equal(addRequest(null, 'air', { available }), null);
  // Запит не містить рядків, файлів і шляхів: лише шаблон, назва й стиль.
  assert.deepEqual(Object.keys(addRequest(byId('rust-template:kpi'), 'air', { available })).sort(), ['branch', 'style', 'templateId', 'title']);
});

test('countLine', () => {
  assert.equal(countLine(5, 5), 'Визначень: 5');
  assert.equal(countLine(2, 5), 'Показано 2 з 5');
});

test('екран підключено до каталогу; нових викликів Tauri, схеми й небезпечної розмітки немає', async () => {
  const page = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(page, /import \{ registryPanel \} from '\.\/module-registry-panel\.js';/u);
  assert.match(page, /data-action': 'show-registry'/u);
  assert.match(page, /invoke\('create_dashboard_module', request\)/u);
  const panel = await readFile(new URL('../src/module-registry-panel.js', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/module-registry-view-core.js', import.meta.url), 'utf8');
  for (const source of [panel, core]) {
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/u);
    assert.doesNotMatch(source, /\binvoke\b|fetch\(|localStorage|sessionStorage|WebSocket|Date\.now|Math\.random/u);
    assert.doesNotMatch(source, /stroke-dasharray/u);
  }
  assert.match(panel, /data-action': 'add-definition'/u);
});
