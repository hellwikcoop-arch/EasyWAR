#!/usr/bin/env node
// Збирає lite-версію EasyWAR: ОДИН html-файл, який відкривається з файлової системи в будь-якому
// сучасному браузері (комп'ютер, планшет, телефон) без сервера, інтернету й встановлення:
//   dist-standalone/EasyWAR-Lite.html
// У файлі той самий головний екран і ті самі модулі: Повітряні Сили, Ракетні Війська, Артилерія,
// дашборди ПВК й УДШВ. Не входять довідники з моделями (вкладки «Довідник», 3D-переглядач, GLB),
// 3D-карта з рельєфом (понад 100 МБ ресурсів), заставка та засоби застосунку (профілі, резервна
// копія, оновлення, Signal): вони потребують десктопної оболонки.
//
// Як це працює. Лаунчер відкриває модулі в iframe (`frame.src = './air.html'`). У файлі кожен модуль
// зібрано окремою самодостатньою сторінкою (script/build_standalone.mjs: скрипти, стилі й зображення
// всередині) і покладено в JSON-блок `<script type="application/json">`. Невеликий сценарій на
// головній сторінці перехоплює присвоєння `iframe.src` і замість адреси ставить `iframe.srcdoc`: така
// сторінка успадковує походження батьківської, тож тема, таблиці й сховище працюють так само, як у
// застосунку. Сторінка модуля розбирається лише тоді, коли модуль відкривають. Дані користувача у
// файл не потрапляють: таблиці .xlsx обирають на пристрої й читають у браузері.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundlePage, inlinePage, leftoverReferences, packageVersion, publicText } from './build_standalone.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const defaultOutDir = fileURLToPath(new URL('../dist-standalone/', import.meta.url));

export const LITE_FILE = 'EasyWAR-Lite.html';
// Модулі, що лежать усередині файлу; їхні адреси лаунчер бере з MODULE_SRC у src/index.html.
export const LITE_MODULES = Object.freeze(['air', 'rocket', 'artillery']);
export const LITE_LAUNCHER = 'index';
const BLOB_ID = (id) => `easywar-lite-page-${id}`;

// Модулі, яких у lite немає. Збірка підставляє замість них заглушки (за повним шляхом файлу).
const REF_WIKI_NOTE = 'Довідник із моделями не входить до lite-версії. Він є в повній версії застосунку EasyWAR.';
export const STUB_SOURCES = Object.freeze({
  // Довідник моделей: сторінки ПС і РВ звертаються до window.RefWiki, Артилерія імпортує mount.
  'ref-wiki.js': `export function mount(host) {
  if (host) host.textContent = ${JSON.stringify(REF_WIKI_NOTE)};
  return { select() {}, refresh() {}, dispose() {}, id: '' };
}
if (typeof window !== 'undefined') window.RefWiki = { mount };
`,
  // 3D-переглядач довідника (GLTFLoader, моделі .glb) і заставка з відео (.mp4).
  'ref-viewer.js': 'export {};\n',
  'startup-splash.js': 'export {};\n',
  // Профілі, резервна копія, оновлення, Signal, «Файл для телефона» та кнопка lite — лише для застосунку.
  'launcher-tools.js': 'export {};\n',
});

const STUB_PREFIX = '\0easywar-lite-stub:';
const STUB_NAMES = new Set(Object.keys(STUB_SOURCES));
const slash = (path) => path.split('\\').join('/');

export function liteStubs() {
  const targets = new Map(Object.keys(STUB_SOURCES).map((name) => [slash(src(name)), name]));
  return {
    name: 'easywar-lite-stubs',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (id.startsWith(STUB_PREFIX)) return id;
      if (!importer || !STUB_NAMES.has(id.split('/').pop().split('?')[0])) return null;
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
      const name = resolved && targets.get(slash(resolved.id.split('?')[0]));
      return name ? `${STUB_PREFIX}${name}` : null;
    },
    load(id) {
      return id.startsWith(STUB_PREFIX) ? STUB_SOURCES[id.slice(STUB_PREFIX.length)] : null;
    },
  };
}

// Сценарій на головній сторінці: `iframe.src = './air.html?command=pvk'` відкриває вбудовану сторінку.
// Писати треба старим синтаксисом (без ?. та ??): файл відкривають і на застарілих планшетах.
export const SHIM_SOURCE = `(function () {
  'use strict';
  var PAGE = /^\\.\\/(${LITE_MODULES.join('|')})\\.html(?:\\?command=(pvk|dshv))?$/;
  function compose(address) {
    var match = PAGE.exec(String(address));
    if (!match) return null;
    var node = document.getElementById('${BLOB_ID('')}' + match[1]);
    if (!node) return null;
    var html = JSON.parse(node.textContent);
    // Командний режим (дашборд ПВК чи УДШВ) сторінка розпізнає за ?command=…; у srcdoc рядка запиту немає.
    return match[2] ? html.replace(/<html\\b/i, '<html data-command="' + match[2] + '"') : html;
  }
  var proto = HTMLIFrameElement.prototype;
  var original = Object.getOwnPropertyDescriptor(proto, 'src');
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: original.enumerable,
    get: original.get,
    set: function (value) {
      var html = compose(value);
      if (html === null) original.set.call(this, value);
      else this.srcdoc = html;
    }
  });
})();`;

// Стилі головної сторінки. Заставку (відео) у файл не вкладено, а її оболонка накриває екран, доки скрипт заставки
// її не прибере, тож у lite оболонки немає зовсім. Профілів, прив'язки таблиць і «Файлу для телефона» теж немає:
// на плитках командувань лишається «Відкрити дашборд».
const LAUNCHER_CSS = `
html[data-lite] #ew-splash { display: none !important; }
html[data-lite] .command-tile .ct-own,
html[data-lite] .command-tile .ct-bind,
html[data-lite] .command-tile .ct-phone,
html[data-lite] .command-tile .ct-embed,
html[data-lite] .command-tile .ct-note { display: none !important; }
html[data-lite] .ew-start-tools { position: absolute; top: max(14px, env(safe-area-inset-top)); right: 16px; left: 16px; z-index: 6; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; pointer-events: none; }
html[data-lite] .ew-lite-badge { pointer-events: auto; cursor: help; font-weight: 600; font-size: 13px; line-height: 1.2; color: #e6edf7; background: rgba(6, 16, 26, .72); border: 1px solid rgba(255, 255, 255, .16); border-radius: 10px; padding: 8px 13px; -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
`;
const LITE_BADGE_TEXT = 'Lite-версія';
const LITE_BADGE_HINT = 'Усі модулі без довідників із моделями та 3D-карти. Повна версія — у застосунку EasyWAR.';
const TILE_TABLE_TEXT = 'Таблицю .xlsx оберіть у дашборді.';
const INIT_SCRIPT = `(function () {
  var splash = document.getElementById('ew-splash');
  if (splash) splash.remove();
  var tables = document.querySelectorAll('.command-tile [data-role="table"]');
  for (var i = 0; i < tables.length; i += 1) tables[i].textContent = ${JSON.stringify(TILE_TABLE_TEXT)};
  var bar = document.querySelector('.ew-start-tools');
  if (!bar) return;
  var badge = document.createElement('span');
  badge.className = 'ew-lite-badge';
  badge.textContent = ${JSON.stringify(LITE_BADGE_TEXT)};
  badge.title = ${JSON.stringify(LITE_BADGE_HINT)};
  bar.append(badge);
})();`;

// Стилі модулів: вкладки довідника (ПС, РВ) приховано. Артилерія не будує вкладку взагалі (__EW_LITE__).
const MODULE_CSS = `
/* Lite-версія: довідників із моделями немає. */
html[data-lite] #tab-ref, html[data-lite] .snav-ref, html[data-lite] #view-ref { display: none !important; }
`;

// Сторінка в srcdoc бере базову адресу в батьківської, тож клік по <a href="#…"> веде на сторінку-оболонку й
// завантажив би її всередину модуля. Переходи за якорями виконуємо самі. Сьогодні таких посилань у модулях немає.
export const MODULE_SCRIPT = `(function () {
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    event.preventDefault();
    var id = link.getAttribute('href').slice(1), target = null;
    try { target = document.getElementById(decodeURIComponent(id)); } catch (error) { target = null; }
    if (target && target.scrollIntoView) target.scrollIntoView();
  }, true);
})();`;

const scriptSafe = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

function withHtmlAttribute(html, attribute) {
  if (!/<html\b[^>]*>/i.test(html)) throw new Error('У сторінці немає тега <html>.');
  return html.replace(/<html\b([^>]*)>/i, (_, attrs) => `<html${attrs} ${attribute}>`);
}

function beforeHeadEnd(html, text) {
  // Рівно один </head>: інакше вставка могла б потрапити всередину рядка в скрипті.
  if (html.split('</head>').length !== 2) throw new Error('У сторінці має бути рівно один </head>.');
  const at = html.indexOf('</head>');
  return `${html.slice(0, at)}${text}\n${html.slice(at)}`;
}

// Сторінка модуля для вбудови: позначка lite (її читає map-3d-bridge.js) і стилі, що ховають довідник.
export function liteModulePage(html) {
  return beforeHeadEnd(withHtmlAttribute(html, 'data-lite'), `<style id="easywar-lite-modules">${MODULE_CSS}</style>\n<script>${MODULE_SCRIPT}</script>`);
}

// JSON-рядок, безпечний усередині <script>: кожен «<» записано як \u003c, тож ні </script>, ні <!--
// не можуть з'явитися в тексті. JSON.parse повертає точно той самий рядок.
export function jsonBlob(text) {
  return JSON.stringify(text).replace(/</g, '\\u003c');
}

export function readBlob(blobHtml) {
  return JSON.parse(blobHtml);
}

// Складає головну сторінку й модулі в один файл. Усі аргументи — готові HTML-рядки.
export function assembleLite({ launcher, modules, version }) {
  for (const id of LITE_MODULES) if (typeof modules[id] !== 'string') throw new Error(`Немає сторінки модуля ${id}.`);
  let out = withHtmlAttribute(launcher, 'data-lite');
  out = beforeHeadEnd(out, `<style id="easywar-lite">${LAUNCHER_CSS}</style>\n<script>${SHIM_SOURCE}</script>`);
  const blobs = LITE_MODULES.map((id) => `<script type="application/json" id="${BLOB_ID(id)}">${jsonBlob(liteModulePage(modules[id]))}</script>`).join('\n');
  const close = out.lastIndexOf('</body>');
  if (close < 0) throw new Error('У головній сторінці немає </body>.');
  out = `${out.slice(0, close)}<script>${scriptSafe(INIT_SCRIPT)}</script>\n${blobs}\n${out.slice(close)}`;
  const marker = `<!-- EasyWAR ${version} standalone: lite-версія, один файл для будь-якого пристрою, працює без інтернету -->`;
  if (!/^\s*<!doctype html>/i.test(out)) throw new Error('Головна сторінка не починається з <!doctype html>.');
  return out.replace(/^(\s*<!doctype html>)/i, `$1\n${marker}`);
}

// Що не має бути в lite-файлі: довідники з моделями, їхні завантажувачі й відео заставки.
const FORBIDDEN = [
  [/GLTFLoader/, 'завантажувач 3D-моделей (GLTFLoader)'],
  [/\.glb\b/i, 'посилання на 3D-модель (.glb)'],
  [/\.mp4\b/i, 'посилання на відео (.mp4)'],
  [/ref-viewer/, 'довідник моделей (ref-viewer)'],
  [/\bmap-assets\b/, 'ресурси 3D-карти (map-assets)'],
];

// Перевірка готового файлу; порожній список — файл придатний. Помилки — читабельні рядки.
export function liteProblems(html) {
  const problems = [];
  if (!/^\s*<!doctype html>\s*<!-- EasyWAR [^>]* standalone: lite/i.test(html.slice(0, 600))) problems.push('немає позначки lite на початку файлу');
  if (!html.includes('id="easywar-lite"') || !html.includes('HTMLIFrameElement.prototype')) problems.push('немає сценарію, що відкриває модулі');
  const left = leftoverReferences(html);
  if (left.length) problems.push(`посилання на зовнішні файли: ${left.slice(0, 5).join(', ')}`);
  const pages = { launcher: html };
  for (const id of LITE_MODULES) {
    const match = new RegExp(`<script type="application/json" id="${BLOB_ID(id)}">([\\s\\S]*?)</script>`).exec(html);
    if (!match) { problems.push(`немає сторінки модуля ${id}`); continue; }
    try {
      const page = readBlob(match[1]);
      if (!/^\s*<!doctype html>/i.test(page)) problems.push(`сторінка ${id} не починається з <!doctype html>`);
      if (!/<html\b[^>]*\bdata-lite\b/i.test(page)) problems.push(`сторінка ${id} без позначки data-lite`);
      pages[id] = page;
      for (const ref of leftoverReferences(page)) problems.push(`сторінка ${id} посилається на файл ${ref}`);
    } catch (error) {
      problems.push(`сторінка ${id} не читається як JSON: ${error.message}`);
    }
  }
  for (const [name, text] of Object.entries(pages)) {
    // Рядки з позначками GLB/MP4 у заглушках не рахуються: перевіряємо повний текст сторінки.
    for (const [pattern, label] of FORBIDDEN) if (pattern.test(text)) problems.push(`у ${name} лишилось: ${label}`);
  }
  return problems;
}

async function inlined(page) {
  const { html, files } = await bundlePage(page, { define: { __EW_LITE__: 'true' }, plugins: [liteStubs()] });
  return inlinePage(html, files, publicText, null);
}

export async function buildLite(outDir) {
  const launcher = await inlined(LITE_LAUNCHER);
  const modules = {};
  for (const id of LITE_MODULES) modules[id] = await inlined(id);
  const single = assembleLite({ launcher, modules, version: packageVersion() });
  const problems = liteProblems(single);
  if (problems.length) throw new Error(`${LITE_FILE} не пройшов перевірку:\n - ${problems.join('\n - ')}`);
  mkdirSync(outDir, { recursive: true });
  const target = resolve(outDir, LITE_FILE);
  writeFileSync(target, single);
  return { file: LITE_FILE, target, bytes: Buffer.byteLength(single) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.chdir(root);
  // `npm run build:lite` кладе файл у dist-standalone; `--out dist/standalone` — туди, звідки його бере застосунок
  // (`npm run build:app`, який викликає `tauri build`).
  const args = process.argv.slice(2);
  let outDir = defaultOutDir;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') {
      if (!args[i + 1]) throw new Error('--out needs a folder');
      outDir = resolve(root, args[i + 1]);
      i += 1;
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const { file, bytes } = await buildLite(outDir);
  console.log(`${file}  ${(bytes / 1e6).toFixed(2)} MB`);
}
