#!/usr/bin/env node
// Builds each command dashboard as ONE self-contained .html file that can be sent
// to a phone (messenger, e-mail, cable) and opened from the file manager without
// a server, without internet and without installing anything:
//   dist-standalone/EasyWAR-PVK.html   - ПВК   (air.html,    command mode "pvk")
//   dist-standalone/EasyWAR-UDSHV.html - УДШВ  (rocket.html, command mode "dshv")
//   dist-standalone/EasyWAR-Artillery.html - Артилерія (artillery.html; `npm run build:standalone -- artillery`)
// Scripts, styles and images are inlined; 3D models (*.glb) are left out because the
// command dashboards do not use them. The .xlsx table is picked on the device and
// is read in the browser; nothing is sent anywhere.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const defaultOutDir = fileURLToPath(new URL('../dist-standalone/', import.meta.url));

export const PAGES = [
  { page: 'air', command: 'pvk', file: 'EasyWAR-PVK.html' },
  { page: 'rocket', command: 'dshv', file: 'EasyWAR-UDSHV.html' },
];

// Артилерія — запасний автономний файл: у застосунок (build:app) не вбудовується, вбудованої таблиці не має,
// збирається окремо командою `npm run build:standalone -- artillery`.
export const ARTILLERY = { page: 'artillery', command: null, file: 'EasyWAR-Artillery.html' };

// Порожній слот для вбудованої таблиці й сценарій, що її відкриває. Застосунок заповнює слот
// на вимогу (src-tauri/src/phone_export.rs); текст слота має збігатися з EMBED_PLACEHOLDER.
export const EMBED_SLOT = '<script type="application/x-easywar-table" id="easywar-embedded-table"></script>';
const embedBootstrap = readFileSync(new URL('./standalone-embedded-table.js', import.meta.url), 'utf8');

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
  if (command === null) return out;            // сторінка без командного режиму й вбудованої таблиці
  // The launcher normally opens the page with ?command=…; a lone file has no query string.
  const probe = `new URLSearchParams(location.search).get('command') === '${command}'`;
  if (!out.includes(probe)) throw new Error(`Command-mode probe for ${command} not found`);
  out = out.replace(probe, 'true');
  // Режим армійської авіації (?module=army) є лише в лончері: у файлі командування його стиль і скрипт зайві.
  out = out.replace(/<style id="easywar-army-aviation-css">[\s\S]*?<\/style>\n?/, '');
  out = out.replace(/<script id="easywar-army-aviation-mode">[\s\S]*?<\/script>\n?/, '');
  out = out.replace(/\n\s*if \(new URLSearchParams\(location\.search\)\.get\('module'\) === 'army'\)[^\n]*/, '');
  out = out.replace(/\n\s*const ARMY = document\.documentElement\.dataset\.module === 'army';\n\s*const NS = ARMY \? 'easywar\.army::' : 'easywar\.air::';\n\s*window\.__EASYWAR_MODULE__ = ARMY \? 'army' : 'air';/,
    "\n  const NS = 'easywar.air::';\n  window.__EASYWAR_MODULE__ = 'air';");
  const close = out.lastIndexOf('</body>');
  if (close < 0) throw new Error('No </body> to place the embedded-table slot before');
  out = `${out.slice(0, close)}${EMBED_SLOT}<script>${scriptSafe(embedBootstrap)}</script>\n${out.slice(close)}`;
  return out;
}

export function leftoverReferences(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) found.add(match[1]);
  for (const match of html.matchAll(/url\((["']?)(\.\/[^)"']+)\1\)/g)) found.add(match[2]);
  return [...found];
}

export async function buildPage({ page, command, file }, outDir) {
  const result = await build({
    root: src(''),
    configFile: false,
    base: './',
    logLevel: 'warn',
    publicDir: false,
    // ПВК (air.html) у командному режимі не має кнопки «Презентація»: код презентації в його файл не потрапляє.
    // 3D-рельєф погоди потребує висот із map-assets, яких в автономному файлі немає: three.js туди не вбудовується.
    // Каталог модулів працює лише з SQLite застосунку: в автономному файлі його код мертвий і не вбудовується.
    define: page === 'air'
      ? { __EW_NO_MODULE_PRESENTATION__: 'true', __EW_NO_WEATHER_RELIEF__: 'true', __EW_NO_MODULE_CATALOG__: 'true' }
      : { __EW_NO_WEATHER_RELIEF__: 'true', __EW_NO_MODULE_CATALOG__: 'true' },
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
  single = single.replace(/^(\s*<!doctype html>)/i, `$1\n<!-- EasyWAR ${version} standalone: автономний файл, працює без інтернету -->`);
  const left = leftoverReferences(single);
  const allowed = left.filter((ref) => !ref.endsWith('.glb'));
  if (allowed.length) throw new Error(`${file} still points at external files: ${allowed.join(', ')}`);
  mkdirSync(outDir, { recursive: true });
  const target = resolve(outDir, file);
  writeFileSync(target, single);
  return { file, target, bytes: Buffer.byteLength(single) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.chdir(root);
  // `npm run build:standalone -- dshv` builds only the УДШВ file;
  // `--out dist/standalone` puts the files where the desktop app embeds them
  // (`npm run build:app`, used by `tauri build`).
  const args = process.argv.slice(2);
  const wanted = [];
  let outDir = defaultOutDir;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') {
      if (!args[i + 1]) throw new Error('--out needs a folder');
      outDir = resolve(root, args[i + 1]);
      i += 1;
    } else wanted.push(args[i]);
  }
  const pages = wanted.length ? [...PAGES, ARTILLERY].filter((entry) => wanted.includes(entry.command ?? entry.page)) : PAGES;
  if (!pages.length) throw new Error(`Unknown target: ${wanted.join(', ')} (use pvk, dshv or artillery)`);
  for (const entry of pages) {
    const { file, bytes } = await buildPage(entry, outDir);
    console.log(`${file}  ${(bytes / 1e6).toFixed(2)} MB`);
  }
}
