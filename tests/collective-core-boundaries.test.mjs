// E8 / C1: межі чистих ядер колективу (наказ T-0002, червоні лінії). Текстовий контракт:
// у ядрах немає мережі, сховищ, DOM, годинника, Tauri й криптографії, а робочий застосунок їх
// ще не імпортує (їх підключить C5 окремим рішенням).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

/** Ядра C1. Наступні підетапи додають сюди свої файли. */
export const C1_CORES = ['src/sensitivity-core.js'];

const FORBIDDEN = [
  ['fetch(', /\bfetch\s*\(/u],
  ['XMLHttpRequest', /XMLHttpRequest/u],
  ['WebSocket', /WebSocket/u],
  ['EventSource', /EventSource/u],
  ['invoke(', /\binvoke\s*\(/u],
  ['@tauri-apps', /@tauri-apps/u],
  ['localStorage', /localStorage/u],
  ['sessionStorage', /sessionStorage/u],
  ['indexedDB', /indexedDB/u],
  ['document.', /\bdocument\./u],
  ['window.', /\bwindow\./u],
  ['Date.now', /Date\.now/u],
  ['new Date(', /new\s+Date\s*\(/u],
  ['Math.random', /Math\.random/u],
  ['crypto', /\bcrypto\b/u],
  ['node: import', /from\s+['"]node:/u],
  ['process.', /\bprocess\./u],
  ['performance.', /\bperformance\./u],
  ['setTimeout', /\bsetTimeout\b/u],
  ['setInterval', /\bsetInterval\b/u],
  ['Date(', /\bDate\s*\(/u],
  ['Date.parse', /\bDate\.parse\b/u],
  ['eval(', /\beval\s*\(/u],
  ['new Function', /new\s+Function\b/u],
  ['globalThis', /\bglobalThis\b/u],
  ['navigator', /\bnavigator\b/u],
  ['import(', /\bimport\s*\(/u],
];

/** Те, що недопустимо й у транзитивних залежностях ядер: мережа, сховища, DOM, Tauri. */
const FORBIDDEN_TRANSITIVE = FORBIDDEN.filter(([name]) => [
  'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'invoke(', '@tauri-apps', 'localStorage',
  'sessionStorage', 'indexedDB', 'document.', 'window.', 'navigator', 'import(', 'eval(', 'new Function',
].includes(name));

const relImports = code => [...code.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gmu)]
  .map(m => m[1] || m[2]);

test('ядра C1 не мають мережі, сховищ, DOM, годинника, випадковості, Tauri й криптографії', async () => {
  for (const file of C1_CORES) {
    const code = await readFile(new URL(file, root), 'utf8');
    for (const [name, re] of FORBIDDEN) assert.doesNotMatch(code, re, `${file}: ${name}`);
  }
});

test('ядра C1 імпортують лише відносні модулі src/', async () => {
  for (const file of C1_CORES) {
    const code = await readFile(new URL(file, root), 'utf8');
    for (const m of code.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gmu)) {
      assert.match(m[1], /^\.\/[a-z0-9-]+\.js$/u, `${file}: ${m[1]}`);
    }
  }
});

test('транзитивні залежності ядер C1 теж без мережі, сховищ, DOM і Tauri', async () => {
  const seen = new Set();
  const queue = [...C1_CORES];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await readFile(new URL(file, root), 'utf8');
    if (!C1_CORES.includes(file)) {
      for (const [name, re] of FORBIDDEN_TRANSITIVE) assert.doesNotMatch(code, re, `${file} (транзитивно): ${name}`);
    }
    const dir = file.slice(0, file.lastIndexOf('/') + 1);
    for (const spec of relImports(code)) queue.push(new URL(spec, new URL(dir, root)).pathname.slice(new URL(root).pathname.length));
  }
  assert.ok(seen.size > C1_CORES.length, `обійдено: ${[...seen].join(", ")}`);
  assert.ok(seen.has("src/catalog-core.js"), "транзитивний обхід дійшов до catalog-core.js");
});

test('робочий застосунок не імпортує ядра C1', async () => {
  const names = C1_CORES.map(f => f.replace(/^src\//u, ''));
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
      const rel = `${dir}${entry.name}`;
      if (entry.isDirectory()) {
        if (!['models', 'map-assets', 'node_modules'].includes(entry.name)) await walk(`${rel}/`);
      } else if (/\.(m?js|html)$/u.test(entry.name)) {
        files.push(rel);
      }
    }
  }
  await walk('src/');
  const consumers = files.filter(f => !C1_CORES.includes(f));
  for (const file of consumers) {
    const code = await readFile(new URL(file, root), 'utf8');
    for (const name of names) assert.equal(code.includes(name), false, `${file} імпортує ${name}`);
  }
});
