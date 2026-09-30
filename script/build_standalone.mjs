#!/usr/bin/env node
// Builds each command dashboard as ONE self-contained .html file that can be sent
// to a phone (messenger, e-mail, cable) and opened from the file manager without
// a server, without internet and without installing anything:
//   dist-standalone/EasyWAR-PVK.html   - ПВК   (air.html,    command mode "pvk")
//   dist-standalone/EasyWAR-UDSHV.html - УДШВ  (rocket.html, command mode "dshv")
// Scripts, styles and images are inlined; 3D models (*.glb) are left out because the
// command dashboards do not use them. The .xlsx table is picked on the device and
// is read in the browser; nothing is sent anywhere.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const outDir = fileURLToPath(new URL('../dist-standalone/', import.meta.url));

export const PAGES = [
  { page: 'air', command: 'pvk', file: 'EasyWAR-PVK.html' },
  { page: 'rocket', command: 'dshv', file: 'EasyWAR-UDSHV.html' },
];

const scriptSafe = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const styleSafe = (css) => css.replace(/<\/(style)/gi, '<\\/$1');

// Exported for tests: turns a Vite page build into the single-file HTML.
export function inlinePage(html, files, publicText, command) {
  let out = html;
  out = out.replace(/<link\s+rel="modulepreload"[^>]*>\s*/g, '');
  out = out.replace(/<link\s+rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+)"[^>]*>/g, (_, name) => {
    if (!(name in files)) throw new Error(`Missing stylesheet ${name}`);
    return `<style>${styleSafe(files[name])}</style>`;
  });
  out = out.replace(/<script\s+type="module"[^>]*src="\.\/(assets\/[^"]+)"[^>]*><\/script>/g, (_, name) => {
    if (!(name in files)) throw new Error(`Missing script ${name}`);
    return `<script type="module">${scriptSafe(files[name])}</script>`;
  });
  out = out.replace(/<script\s+src="\.\/([^"/]+\.js)"[^>]*><\/script>/g, (_, name) => {
    const text = publicText(name);
    if (text === null) throw new Error(`Missing classic script ${name}`);
    return `<script>${scriptSafe(text)}</script>`;
  });
  // The launcher normally opens the page with ?command=…; a lone file has no query string.
  const probe = `new URLSearchParams(location.search).get('command') === '${command}'`;
  if (!out.includes(probe)) throw new Error(`Command-mode probe for ${command} not found`);
  out = out.replace(probe, 'true');
  return out;
}

export function leftoverReferences(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) found.add(match[1]);
  for (const match of html.matchAll(/url\((["']?)(\.\/[^)"']+)\1\)/g)) found.add(match[2]);
  return [...found];
}

async function buildPage({ page, command, file }) {
  const result = await build({
    root: src(''),
    configFile: false,
    base: './',
    logLevel: 'warn',
    publicDir: false,
    build: {
      write: false,
      target: 'safari13',
      cssCodeSplit: false,
      modulePreload: false,
      cssMinify: false,
      assetsInlineLimit: (path) => (path.endsWith('.glb') ? false : true),
      rolldownOptions: {
        input: { [page]: src(`${page}.html`) },
        output: { codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result[0] : result).output;
  const files = {};
  let html = null;
  for (const item of outputs) {
    if (item.type === 'chunk') files[item.fileName] = item.code;
    else if (item.fileName === `${page}.html`) html = String(item.source);
    else if (item.fileName.endsWith('.css')) files[item.fileName] = String(item.source);
  }
  if (html === null) throw new Error(`No HTML produced for ${page}`);
  const publicText = (name) => {
    try { return readFileSync(src(`public/${name}`), 'utf8'); } catch { return null; }
  };
  let single = inlinePage(html, files, publicText, command);
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  single = single.replace(/^(\s*<!doctype html>)/i, `$1\n<!-- EasyWAR ${version}: автономний файл, працює без інтернету -->`);
  const left = leftoverReferences(single);
  const allowed = left.filter((ref) => !ref.endsWith('.glb'));
  if (allowed.length) throw new Error(`${file} still points at external files: ${allowed.join(', ')}`);
  mkdirSync(outDir, { recursive: true });
  const target = `${outDir}${file}`;
  writeFileSync(target, single);
  return { file, target, bytes: Buffer.byteLength(single) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.chdir(root);
  // Optional filter: `npm run build:standalone -- dshv` builds only the УДШВ file.
  const wanted = process.argv.slice(2);
  const pages = wanted.length ? PAGES.filter((entry) => wanted.includes(entry.command)) : PAGES;
  if (!pages.length) throw new Error(`Unknown target: ${wanted.join(', ')} (use pvk or dshv)`);
  for (const entry of pages) {
    const { file, bytes } = await buildPage(entry);
    console.log(`${file}  ${(bytes / 1e6).toFixed(2)} MB`);
  }
}
