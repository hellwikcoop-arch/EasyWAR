// Реєстр визначень модулів (етап E1): повнота, узгодженість із кодом сторінок і обома каталогами.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  LEGACY_DEFINITIONS, NON_MODULE_SECTIONS, ROLES, SURFACES, WORKSPACE_APPS,
  dependencyGraph, dependentsOf, listDefinitions, psCatalogUsage, registryMarkdown, requirementsFor, validateRegistry,
} from '../src/module-definition-core.js';
import { CATALOG, KPI_TILES, VIEW_BY_BLOCK } from '../src/ps-kpi.js';
import { KPI as UDSHV_KPI } from '../src/udshv-dashboard-core.js';
import { createOwnLossesModel } from '../src/own-losses-dashboard-core.js';
import { rustCatalog } from './helpers/rust-catalog.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const rustTemplates = await rustCatalog();
const definitions = listDefinitions({ rustTemplates, catalogs: [CATALOG], catalogUsage: psCatalogUsage(KPI_TILES, VIEW_BY_BLOCK) });
const sources = Object.fromEntries(await Promise.all(Object.entries(SURFACES).map(async ([key, surface]) => [key, await read(surface.file)])));
const layIds = html => JSON.parse(/const LAY_IDS = (\[[^\]]+\]);/u.exec(html)[1].replaceAll("'", '"'));
const placesOn = surface => definitions.flatMap(item => item.usedIn.filter(place => place.surface === surface).map(place => place.block));

test('реєстр узгоджений: унікальні ідентифікатори, відомі ролі й місця, описане обчислення', () => {
  assert.deepEqual(validateRegistry(definitions), []);
  assert.equal(new Set(definitions.map(item => item.definitionId)).size, definitions.length);
});

test('кожен шаблон Rust — одне визначення з тими самими полями (без власної копії каталогу)', () => {
  const fromRust = definitions.filter(item => item.sourceCatalog === 'rust-template');
  assert.deepEqual(fromRust.map(item => item.sourceId), rustTemplates.map(template => template.id));
  for (const template of rustTemplates) {
    const columns = requirementsFor(definitions, `rust-template:${template.id}`).map(item => item.column);
    assert.deepEqual(columns, template.fields.map(field => field.key), template.id);
  }
  for (const item of fromRust) assert.deepEqual(item.branchTags, ['air', 'rocket', 'pvk', 'dshv'], 'шаблони універсальні');
});

test('шість карток основних показників ПС — шість визначень каталогу v1, усі на p-kpis', () => {
  const tiles = definitions.filter(item => item.sourceCatalog === 'catalog-v1' && item.sourceId.startsWith('tile.'));
  assert.equal(tiles.length, 6);
  assert.deepEqual(tiles.map(item => item.sourceId), KPI_TILES);
  for (const item of tiles) assert.deepEqual(item.usedIn, [{ surface: 'air', block: 'p-kpis' }]);
  for (const tile of CATALOG.tiles) assert.ok(definitions.some(item => item.definitionId === `catalog-v1:${tile.id}`), tile.id);
  assert.equal(definitions.filter(item => item.usedIn.some(place => place.surface === 'rocket' && place.block === 'p-kpis')).length, 6, 'і шість карток РВ');
});

test('кожен блок розкладки ПС і РВ (LAY_IDS) описано в реєстрі, зайвих блоків немає', () => {
  for (const surface of ['air', 'rocket']) {
    const ids = layIds(sources[surface]);
    const used = new Set(placesOn(surface).filter(block => !block.startsWith('view:')));
    assert.deepEqual([...used].sort(), [...ids].sort(), surface);
  }
  assert.equal(layIds(sources.air).length, 14);
  assert.equal(layIds(sources.rocket).length, 15);
  for (const block of placesOn('air').filter(item => item.startsWith('view:'))) {
    assert.ok(sources.air.includes(`${block.slice(5)}: { id: 'p-`), `${block} є серед видів air.html`);
  }
});

test('картки KPI УДШВ і «Наших втрат» збігаються з масивами ядра', () => {
  const kpiKeys = surface => placesOn(surface).filter(block => block.startsWith('kpi:')).map(block => block.slice(4));
  assert.deepEqual(kpiKeys('dshv'), UDSHV_KPI.map(item => item.key));
  assert.deepEqual(kpiKeys('own-losses'), createOwnLossesModel({ records: [], sheets: [] }).kpis.map(item => item.key));
});

test('кожен розділ сторінок ПВК, УДШВ і «Наших втрат» має визначення, і кожен якір є в коді', () => {
  const literal = (source, pattern) => [...source.matchAll(pattern)].map(match => match[1]);
  const expected = {
    pvk: [...literal(sources.pvk, /kpi\('([^']+)'/gu), ...literal(sources.pvk, /'h3', \{ text: '([^']+)'/gu), ...literal(sources.pvk, /'h2', \{ text: '([^']+)'/gu)]
      .filter(title => title !== 'Зведення ПВК'), // заголовок сторінки, не модуль
    dshv: literal(sources.dshv, /section\('([^']+)'/gu),
    'own-losses': literal(sources['own-losses'], /section\('([^']+)'/gu),
  };
  for (const [surface, titles] of Object.entries(expected)) {
    const covered = new Set(placesOn(surface));
    const skip = new Set(NON_MODULE_SECTIONS[surface] || []);
    for (const title of titles) if (!skip.has(title)) assert.ok(covered.has(title), `${surface}: «${title}» немає в реєстрі`);
    for (const block of covered) {
      if (block.startsWith('kpi:')) continue;
      assert.ok(sources[surface].includes(block), `${surface}: якоря «${block}» немає в ${SURFACES[surface].file}`);
    }
  }
});

test('застосунки «Робочого середовища» не є віджетами каталогу', () => {
  for (const app of WORKSPACE_APPS) {
    assert.ok(!definitions.some(item => item.title.toLowerCase().includes(app.toLowerCase())), app);
  }
  assert.ok(validateRegistry([{ ...definitions[0], definitionId: 'legacy:x', title: 'EasyFLY' }]).some(text => text.includes('Робочого середовища')));
});

test('validateRegistry ловить невідому роль, повтор і відсутній відповідник', () => {
  const base = definitions.find(item => item.sourceCatalog === 'legacy');
  const problems = validateRegistry([
    base, base,
    { ...base, definitionId: 'legacy:bad', requirements: [{ role: 'вигадана', required: true }], counterpart: 'legacy:нема' },
  ]);
  assert.ok(problems.some(text => text.includes('повторний')));
  assert.ok(problems.some(text => text.includes('невідома роль вигадана')));
  assert.ok(problems.some(text => text.includes('немає відповідника')));
  const v1 = listDefinitions({ catalogs: [{ ...CATALOG, columns: [...CATALOG.columns, { id: 'col.new', type: 'text', labels: ['Нове'] }],
    tiles: [{ id: 'tile.new', label: 'Нова', measure: { agg: 'count', filter: [{ column: 'col.new', op: 'notempty' }] } }], blocks: [] }], legacy: [] });
  assert.ok(validateRegistry(v1).some(text => text.includes('?col.new')), 'стовпець каталогу v1 без ролі');
});

test('граф залежностей відтворюється з реєстру', () => {
  const graph = dependencyGraph(definitions);
  assert.deepEqual(Object.keys(graph.byRole), Object.keys(ROLES));
  for (const [id, roles] of Object.entries(graph.byDefinition)) {
    for (const role of roles) assert.ok(graph.byRole[role].includes(id), `${role} → ${id}`);
  }
  assert.ok(dependentsOf(definitions, 'contact-line').includes('legacy:strike-depth'));
  assert.ok(dependentsOf(definitions, 'platform-type').includes('legacy:platform-types'));
  assert.ok(!dependentsOf(definitions, 'munition-type', { requiredOnly: true }).includes('legacy:strike-depth'));
  assert.throws(() => requirementsFor(definitions, 'legacy:немає'), /немає визначення/u);
});

test('спільні блоки ПС і РВ позначено обома родами, «Наші втрати» — ПВК і УДШВ', () => {
  const tags = id => definitions.find(item => item.definitionId === id).branchTags;
  assert.deepEqual(tags('legacy:strike-map'), ['air', 'rocket']);
  assert.deepEqual(tags('legacy:firing-units'), ['rocket']);
  assert.deepEqual(tags('legacy:own-kpi-200'), ['pvk', 'dshv']);
  assert.equal(LEGACY_DEFINITIONS.length, new Set(LEGACY_DEFINITIONS.map(item => item.id)).size);
});

test('docs/MODULE_DEFINITIONS.md містить актуальну згенеровану частину', async () => {
  const doc = await read('docs/MODULE_DEFINITIONS.md');
  const start = '<!-- registry:start -->\n';
  const end = '<!-- registry:end -->';
  assert.ok(doc.includes(start) && doc.includes(end), 'немає міток згенерованої частини');
  const body = doc.slice(doc.indexOf(start) + start.length, doc.indexOf(end));
  assert.equal(body, registryMarkdown(definitions), 'перегенеруйте: node script/module_definitions.mjs');
});
