#!/usr/bin/env node
// Imports a new single-file "EasyWAR_UNIFIED" HTML into the desktop frontend.
//
//   node script/import_unified_html.mjs <EasyWAR_UNIFIED.html> [--air-out <file>]
//
// - src/index.html  ← launcher, with base64 module payloads removed and the
//                     iframes pointed at ./air.html and ./rocket.html;
// - src/rocket.html ← Rocket Forces module, byte-for-byte;
// - the Air Force module is written to --air-out (default: unified-air.html in
//   the OS temp dir) only for review: src/air.html carries desktop integrations
//   and must be merged by hand with narrow anchored patches (see AGENTS.md).
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith('--'));
const airOutIndex = args.indexOf('--air-out');
const airOut = airOutIndex >= 0 ? args[airOutIndex + 1] : join(tmpdir(), 'unified-air.html');
if (!input || (airOutIndex >= 0 && !airOut)) {
  console.error('Використання: node script/import_unified_html.mjs <EasyWAR_UNIFIED.html> [--air-out <file>]');
  process.exit(2);
}

const root = new URL('../src/', import.meta.url);
const unified = await readFile(input, 'utf8');

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + 1) >= 0) {
    throw new Error(`Не знайдено однозначний якір: ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function extractModule(id) {
  const pattern = new RegExp(`<script id="source-${id}" type="application/x-easywar-module">([\\s\\S]*?)</script>\\n`);
  const match = unified.match(pattern);
  if (!match) throw new Error(`Модуль ${id} не знайдено.`);
  return { block: match[0], html: Buffer.from(match[1].trim(), 'base64') };
}

const air = extractModule('air');
const rocket = extractModule('rocket');

let launcher = unified.replace(air.block, '').replace(rocket.block, '');
const decodeStart = launcher.indexOf('  function decodeModule(id) {');
const decodeEnd = launcher.indexOf('  function frameOf(branch)');
if (decodeStart < 0 || decodeEnd < decodeStart) throw new Error('Не знайдено decodeModule у лаунчері.');
launcher = launcher.slice(0, decodeStart)
  + "  // Desktop shell: modules are separate same-origin pages instead of base64 srcdoc payloads.\n"
  + "  const MODULE_SRC = {air:'./air.html', rocket:'./rocket.html'};\n\n"
  + launcher.slice(decodeEnd);
launcher = replaceOnce(
  launcher,
  "    frame.srcdoc = decodeModule(branch === 'air' ? 'source-air' : 'source-rocket');\n",
  '    frame.src = MODULE_SRC[branch];\n',
  'frame.srcdoc',
);
launcher = replaceOnce(
  launcher,
  '</head>',
  '<style id="easywar-desktop-air-controls">\n'
    + '/* Desktop shell: align the Air Force module controls with the first toolbar row. */\n'
    + 'body[data-active-branch="air"] #branch-controls{top:13px!important}\n'
    + '</style>\n</head>',
  '</head>',
);

await writeFile(new URL('index.html', root), launcher);
await writeFile(new URL('rocket.html', root), rocket.html);
await writeFile(airOut, air.html);
console.log('Оновлено src/index.html і src/rocket.html.');
console.log(`Модуль «Повітряні Сили» збережено для ручного злиття: ${airOut}`);
