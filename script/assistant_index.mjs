import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { buildKnowledgeIndex, serializeKnowledgeIndex, KNOWLEDGE_SOURCE_FILES } from '../src/assistant/assistant-knowledge-core.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(projectRoot, 'src/assistant/knowledge/index.json');

async function compile() {
  const documents = [];
  const docsRoot = await realpath(resolve(projectRoot, 'docs'));
  if (docsRoot !== resolve(projectRoot, 'docs')) throw new Error('Каталог docs не може бути символічним посиланням');
  for (const file of KNOWLEDGE_SOURCE_FILES) {
    const sourcePath = resolve(projectRoot, file);
    let actualPath;
    try {
      actualPath = await realpath(sourcePath);
    } catch (error) {
      if (file === 'docs/ASSISTANT.md' && error.code === 'ENOENT') continue;
      throw error;
    }
    const inside = relative(docsRoot, actualPath);
    if (inside.startsWith('..') || isAbsolute(inside) || actualPath !== sourcePath) {
      throw new Error(`Джерело має бути звичайним файлом у docs: ${file}`);
    }
    documents.push({ file, markdown: await readFile(actualPath, 'utf8') });
  }
  return serializeKnowledgeIndex(buildKnowledgeIndex(documents));
}

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Використання: node script/assistant_index.mjs [--check]');
  const expected = await compile();
  if (args.includes('--check')) {
    let actual;
    try { actual = await readFile(outputPath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Індекс довідки відсутній; запустіть node script/assistant_index.mjs');
      throw error;
    }
    if (actual !== expected) throw new Error('Індекс довідки застарів; запустіть node script/assistant_index.mjs');
    process.stdout.write('Індекс довідки актуальний.\n');
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, expected, 'utf8');
    process.stdout.write('Індекс довідки згенеровано.\n');
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
