import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
  LITE_FILE,
  LITE_MODULES,
  SHIM_SOURCE,
  STUB_SOURCES,
  assembleLite,
  buildLite,
  jsonBlob,
  liteModulePage,
  liteProblems,
  readBlob,
} from '../script/build_lite.mjs';

const root = new URL('../', import.meta.url);
const readSource = (path) => readFileSync(new URL(path, root), 'utf8');

// Синтетичні сторінки: лише розмітка, без жодних даних.
const page = (name, body = '') => `<!DOCTYPE html>\n<html lang="uk">\n<head><meta charset="utf-8"><title>${name}</title></head>\n<body>${body}</body>\n</html>`;
const launcher = (body = '') => page('Лаунчер', `<div id="ew-splash"></div><div class="ew-start-tools"></div>${body}`);
const modules = (over = {}) => ({ ...Object.fromEntries(LITE_MODULES.map((id) => [id, page(id)])), ...over });
const assemble = (over = {}) => assembleLite({ launcher: launcher(), modules: modules(), version: '9.9.9', ...over });
const blobOf = (html, id) => readBlob(new RegExp(`<script type="application/json" id="easywar-lite-page-${id}">([\\s\\S]*?)</script>`).exec(html)[1]);

// Запускає сценарій lite у пісочниці з підробним iframe: присвоєння src має перейти в srcdoc.
function runShim(html) {
  const nodes = {};
  for (const id of LITE_MODULES) nodes[`easywar-lite-page-${id}`] = { textContent: new RegExp(`id="easywar-lite-page-${id}">([\\s\\S]*?)</script>`).exec(html)[1] };
  const sandbox = { document: { getElementById: (id) => nodes[id] || null } };
  sandbox.HTMLIFrameElement = function HTMLIFrameElement() {};
  Object.defineProperty(sandbox.HTMLIFrameElement.prototype, 'src', {
    configurable: true,
    enumerable: true,
    get() { return this.plainSrc; },
    set(value) { this.plainSrc = value; this.assigned.push(value); },
  });
  vm.runInNewContext(SHIM_SOURCE, sandbox);
  const frame = Object.create(sandbox.HTMLIFrameElement.prototype);
  frame.assigned = [];
  return frame;
}

test('lite is one launcher plus the three modules, and the launcher knows every address it opens', () => {
  assert.deepEqual([...LITE_MODULES], ['air', 'rocket', 'artillery']);
  const index = readSource('src/index.html');
  const map = /const MODULE_SRC = \{([^}]*)\}/.exec(index);
  assert.ok(map, 'launcher must keep MODULE_SRC');
  const addresses = [...map[1].matchAll(/'(\.\/[^']+)'/g)].map((match) => match[1]);
  assert.ok(addresses.length >= 5, 'ПС, РВ, Артилерія, ПВК і УДШВ');
  const frame = runShim(assemble());
  for (const address of addresses) {
    frame.srcdoc = undefined;
    frame.src = address;
    assert.equal(typeof frame.srcdoc, 'string', `${address} must open an embedded page, otherwise lite would load a missing file`);
  }
  assert.deepEqual(frame.assigned, [], 'nothing may fall through to a real file address');
});

test('setting iframe.src opens the embedded page; command dashboards get their mode, unknown addresses pass through', () => {
  const html = assemble({ modules: modules({ air: page('Повітряні сили'), rocket: page('Ракетні війська') }) });
  const frame = runShim(html);
  frame.src = './air.html';
  assert.equal(frame.srcdoc, liteModulePage(page('Повітряні сили')));
  assert.doesNotMatch(frame.srcdoc, /data-command/);
  frame.src = './air.html?command=pvk';
  assert.match(frame.srcdoc, /^<!DOCTYPE html>\n<html data-command="pvk" lang="uk" data-lite>/);
  frame.src = './rocket.html?command=dshv';
  assert.match(frame.srcdoc, /<html data-command="dshv" lang="uk" data-lite>/);
  assert.match(frame.srcdoc, /<title>Ракетні війська<\/title>/);
  // Чужі адреси й вигадане значення командного режиму не підміняються й не потрапляють у розмітку.
  frame.srcdoc = undefined;
  frame.src = './map.html?embed=1';
  frame.src = './air.html?command=evil"><script>';
  frame.src = 'https://example.com/';
  assert.equal(frame.srcdoc, undefined);
  assert.deepEqual(frame.assigned, ['./map.html?embed=1', './air.html?command=evil"><script>', 'https://example.com/']);
});

test('page text survives the JSON block and can never close the script tag', () => {
  const nasty = ['</script><script>alert(1)</script>', '<!-- -->', '<!--<script>', '</ScRiPt >', 'a b c', 'nul\u0000x', '😀 і «ґ»', 'lone\ud800', '"quote" \\ back\\', 'a\r\nb\rc'];
  for (const text of nasty) {
    const blob = jsonBlob(text);
    assert.ok(!blob.includes('<'), `no raw "<" in ${JSON.stringify(text)}`);
    assert.equal(readBlob(blob), text);
  }
  const hostile = nasty.join('\n');
  const html = assemble({ modules: modules({ air: page('x', `<script>var s = ${JSON.stringify(hostile)}</script>${hostile}`) }) });
  assert.equal(html.split('<script').length, html.split('</script>').length, 'every script tag has exactly one end tag');
  assert.ok(blobOf(html, 'air').includes(hostile));
});

test('assembled file is marked, themed for lite and passes its own check', () => {
  assert.doesNotMatch(SHIM_SOURCE, /<\/script|<!--/, 'the shim is placed in the page as it is');
  const html = assemble();
  assert.match(html, /^<!DOCTYPE html>\n<!-- EasyWAR 9\.9\.9 standalone: lite/);
  assert.match(html, /<html lang="uk" data-lite>/, 'launcher is marked');
  assert.match(html, /html\[data-lite\] #ew-splash \{ display: none !important; \}/, 'the splash cover must not hide the launcher: its script is not in lite');
  assert.match(html, /\.command-tile \.ct-phone/, 'phone-file button is hidden on the tiles');
  assert.equal(html.match(/HTMLIFrameElement\.prototype/g).length >= 1, true);
  for (const id of LITE_MODULES) {
    const text = blobOf(html, id);
    assert.match(text, /<html lang="uk" data-lite>/, `${id} is marked for map-3d-bridge.js and the styles`);
    assert.match(text, /html\[data-lite\] #tab-ref/, `${id} hides the reference tab`);
  }
  assert.deepEqual(liteProblems(html), []);
});

test('the check refuses reference books, models, video, missing files and a missing module', () => {
  const bad = (text) => liteProblems(assemble({ modules: modules({ air: page('x', text) }) }));
  assert.ok(bad('<script>new GLTFLoader()</script>').some((p) => /GLTFLoader/.test(p)));
  assert.ok(bad('<script>load("m.glb")</script>').some((p) => /\.glb/.test(p)));
  assert.ok(bad('<script>play("intro.mp4")</script>').some((p) => /\.mp4/.test(p)));
  assert.ok(bad('<script>import("./ref-viewer.js")</script>').some((p) => /ref-viewer/.test(p)));
  assert.ok(bad('<script src="./extra.js"></script>').some((p) => /extra\.js/.test(p)));
  assert.ok(bad('<img src="./logo.png">').some((p) => /logo\.png/.test(p)));
  assert.ok(liteProblems('<!doctype html><html></html>').some((p) => /позначки lite/.test(p)));
  const missing = assemble().replace(/id="easywar-lite-page-rocket"/, 'id="other"');
  assert.ok(liteProblems(missing).some((p) => /rocket/.test(p)));
  assert.throws(() => assembleLite({ launcher: launcher(), modules: { air: page('a') }, version: '1' }), /Немає сторінки модуля rocket/);
  assert.throws(() => assembleLite({ launcher: '<p>no html</p>', modules: modules(), version: '1' }), /<html>/);
});

test('every stubbed module is a real source file, so a rename cannot silently let a reference book into lite', () => {
  for (const name of Object.keys(STUB_SOURCES)) assert.ok(existsSync(new URL(`src/${name}`, root)), `src/${name} must exist`);
  assert.deepEqual(Object.keys(STUB_SOURCES).sort(), ['launcher-tools.js', 'ref-viewer.js', 'ref-wiki.js', 'startup-splash.js']);
  // Артилерія імпортує mount із ref-wiki.js, сторінки ПС і РВ викликають window.RefWiki.mount.
  assert.match(readSource('src/artillery-app.js'), /import \{ mount as mountRef \} from '\.\/ref-wiki\.js';/);
  assert.match(readSource('src/artillery-app.js'), /typeof __EW_LITE__ !== 'undefined' && __EW_LITE__/);
  assert.match(readSource('src/public/map-3d-bridge.js'), /hasAttribute\('data-lite'\)/);
});

test('the reference stub tells the user where the book is instead of failing', () => {
  const sandbox = { window: null };
  sandbox.window = sandbox;
  vm.runInNewContext(STUB_SOURCES['ref-wiki.js'].replace('export function mount', 'function mount'), sandbox);
  const host = { textContent: '' };
  const controller = sandbox.window.RefWiki.mount(host, { initial: 'x' });
  assert.match(host.textContent, /не входить до lite-версії/);
  for (const method of ['select', 'refresh', 'dispose']) assert.equal(typeof controller[method], 'function');
  assert.doesNotThrow(() => { controller.select('a'); controller.refresh(); controller.dispose(); });
  assert.doesNotThrow(() => sandbox.window.RefWiki.mount(null));
});

test('нова збірка складається в dist/standalone разом із файлами для телефона', () => {
  const pkg = JSON.parse(readSource('package.json'));
  assert.equal(pkg.scripts['build:lite'], 'node script/build_lite.mjs');
  assert.match(pkg.scripts['build:app'], /&& node script\/build_lite\.mjs --out dist\/standalone$/);
});

test('справжня збірка lite: один файл, усі модулі, жодного довідника з моделями', { timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'easywar-lite-'));
  try {
    const { target, bytes } = await buildLite(dir);
    assert.equal(basename(target), LITE_FILE);
    const html = readFileSync(target, 'utf8');
    assert.equal(Buffer.byteLength(html), bytes);
    assert.deepEqual(liteProblems(html), []);
    assert.ok(bytes < 40e6, `lite-файл має лишатися «легким»: ${(bytes / 1e6).toFixed(1)} МБ`);
    assert.match(html, /<html[^>]* data-lite>/);
    for (const id of LITE_MODULES) {
      const text = blobOf(html, id);
      assert.match(text, /<html[^>]* data-lite>/);
      assert.match(text, /Довідник із моделями не входить до lite-версії/, `${id} bundles the stub, not the real reference book`);
    }
    // Командні режими ПВК й УДШВ сторінка розпізнає за атрибутом data-command, який ставить сценарій головної сторінки.
    assert.match(blobOf(html, 'air'), /html\[data-command="pvk"\] #tab-entry/);
    assert.match(blobOf(html, 'rocket'), /html\[data-command="dshv"\] #tab-entry/);
    // Вкладки «Довідник» в Артилерії немає, а картка вильоту ПС лишає процедурну 3D-схему.
    assert.doesNotMatch(blobOf(html, 'artillery'), /\[\s*['"`]ref['"`]\s*,\s*['"`]Довідник['"`]\s*\]/);
    assert.match(blobOf(html, 'air'), /WebGLRenderer/);
    // Дані користувача не вбудовуються: жодного блока з таблицею ні в головній сторінці, ні в модулях.
    const slot = /<script[^>]*id="easywar-embedded-table"/;
    assert.doesNotMatch(html, slot);
    for (const id of LITE_MODULES) assert.doesNotMatch(blobOf(html, id), slot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
