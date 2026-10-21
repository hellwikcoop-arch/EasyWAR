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
];

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
