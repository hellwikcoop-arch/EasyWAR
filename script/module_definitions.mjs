// Перегенерувати таблиці реєстру модулів у docs/MODULE_DEFINITIONS.md (між мітками registry:start/end).
// Запуск: node script/module_definitions.mjs
import { readFile, writeFile } from 'node:fs/promises';

import { listDefinitions, psCatalogUsage, registryMarkdown, validateRegistry } from '../src/module-definition-core.js';
import { CATALOG, KPI_TILES, VIEW_BY_BLOCK } from '../src/ps-kpi.js';
import { rustCatalog } from '../tests/helpers/rust-catalog.mjs';

const file = new URL('../docs/MODULE_DEFINITIONS.md', import.meta.url);
const definitions = listDefinitions({ rustTemplates: await rustCatalog(), catalogs: [CATALOG], catalogUsage: psCatalogUsage(KPI_TILES, VIEW_BY_BLOCK) });
const problems = validateRegistry(definitions);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const doc = await readFile(file, 'utf8');
const start = '<!-- registry:start -->\n';
const end = '<!-- registry:end -->';
if (!doc.includes(start) || !doc.includes(end)) throw new Error('у документі немає міток registry:start/end');
const head = doc.slice(0, doc.indexOf(start) + start.length);
const tail = doc.slice(doc.indexOf(end));
await writeFile(file, head + registryMarkdown(definitions) + tail);
console.log(`Реєстр модулів: ${definitions.length} визначень.`);
