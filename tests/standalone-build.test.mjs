import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { EMBED_SLOT, PAGES, inlinePage, leftoverReferences } from '../script/build_standalone.mjs';

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const PAGE = `<!doctype html><html><head>
<script id="easywar-command-mode">try { if (new URLSearchParams(location.search).get('command') === 'dshv') document.documentElement.dataset.command = 'dshv'; } catch (e) {}</script>
<link rel="modulepreload" crossorigin href="./assets/core.js">
<link rel="stylesheet" crossorigin href="./assets/rocket.css">
<script src="./module-editor.js"></script>
</head><body><script type="module" crossorigin src="./assets/rocket.js"></script></body></html>`;

test('standalone targets are the two command dashboards', () => {
  assert.deepEqual(PAGES.map((p) => [p.page, p.command, p.file]), [
    ['air', 'pvk', 'EasyWAR-PVK.html'],
    ['rocket', 'dshv', 'EasyWAR-UDSHV.html'],
  ]);
});

test('inlinePage puts scripts and styles into the HTML and forces command mode', () => {
  const files = { 'assets/rocket.css': 'body{color:red}', 'assets/rocket.js': 'const s = "</script>";' };
  const out = inlinePage(PAGE, files, (name) => (name === 'module-editor.js' ? 'window.editor = 1;' : null), 'dshv');
  assert.match(out, /<style>body\{color:red\}<\/style>/);
  assert.match(out, /<script type="module">const s = "<\\\/script>";<\/script>/, 'a literal </script> inside code must not end the tag');
  assert.match(out, /<script>window\.editor = 1;<\/script>/);
  assert.doesNotMatch(out, /modulepreload/);
  assert.match(out, /if \(true\) document\.documentElement\.dataset\.command = 'dshv'/);
  assert.deepEqual(leftoverReferences(out), []);
});

test('inlinePage refuses a page it cannot make self-contained', () => {
  assert.throws(() => inlinePage(PAGE, {}, () => null, 'dshv'), /Missing stylesheet/);
  assert.throws(() => inlinePage(PAGE.replace("'dshv'", "'other'"), { 'assets/rocket.css': '', 'assets/rocket.js': '' }, () => '', 'dshv'), /probe/);
});

test('leftoverReferences reports external files but nothing for data URIs', () => {
  const html = '<img src="data:image/png;base64,AAAA"><link href="./x.css"><div style="background:url(./assets/a.webp)"></div>';
  assert.deepEqual(leftoverReferences(html).sort(), ['./assets/a.webp', './x.css']);
});

const FILES = { 'assets/rocket.css': '', 'assets/rocket.js': '' };

test('every standalone page ends with an empty table slot and the script that opens it', () => {
  const out = inlinePage(PAGE, FILES, () => '', 'dshv');
  assert.equal(out.split(EMBED_SLOT).length - 1, 1, 'exactly one slot, so Rust can fill it');
  assert.ok(out.indexOf(EMBED_SLOT) > out.indexOf('<script type="module">'), 'slot comes after the dashboard code');
  assert.ok(out.indexOf(EMBED_SLOT) < out.lastIndexOf('</body>'));
  assert.match(out, /getElementById\('easywar-embedded-table'\)/);
  assert.ok(!out.includes(EMBED_SLOT + EMBED_SLOT));
});

test('the slot is the same tag in the build script and in the Rust embedder', async () => {
  const rust = await readText('src-tauri/src/phone_export.rs');
  const literal = rust.match(/pub const EMBED_PLACEHOLDER: &str =\s*r#"(.*?)"#;/s);
  assert.ok(literal, 'Rust must declare EMBED_PLACEHOLDER');
  assert.equal(literal[1], EMBED_SLOT);
});

// Запускає сценарій відкриття вбудованої таблиці у «браузері» з підставними document/window.
async function runBootstrap({ tagText, av }) {
  const code = await readText('script/standalone-embedded-table.js');
  const timers = [];
  const win = {
    atob: (text) => Buffer.from(text, 'base64').toString('binary'),
    setTimeout: (fn) => { timers.push(fn); },
    __AV: av,
  };
  const doc = { getElementById: (id) => (id === 'easywar-embedded-table' && tagText !== null ? { textContent: tagText } : null) };
  vm.runInNewContext(code, { document: doc, window: win, Uint8Array, Promise, JSON, Date, String, isNaN });
  return { win, timers, flush: () => new Promise((resolve) => setImmediate(resolve)) };
}

function fakeDashboard() {
  const calls = { connect: [], toast: [], error: [] };
  return {
    calls,
    connect: async (...args) => { calls.connect.push(args); },
    toast: (...args) => calls.toast.push(args),
    showError: (message) => calls.error.push(message),
  };
}

const payload = (extra = {}) => JSON.stringify({ v: 1, name: 'УДШВ.xlsx', exportedAt: '2026-10-01T09:15:00+03:00', data: Buffer.from([0x50, 0x4b, 3, 4, 0, 255]).toString('base64'), ...extra });

test('an embedded table is opened in the dashboard without a file handle and announced', async () => {
  const av = fakeDashboard();
  const { flush } = await runBootstrap({ tagText: payload(), av });
  await flush();
  assert.equal(av.calls.connect.length, 1);
  const [bytes, name, handle] = av.calls.connect[0];
  assert.deepEqual([...bytes], [0x50, 0x4b, 3, 4, 0, 255]);
  assert.equal(name, 'УДШВ.xlsx');
  assert.equal(handle, null, 'a phone file never writes back to a table');
  assert.equal(av.calls.toast.length, 1);
  assert.match(av.calls.toast[0][0], /Відкрито вбудовану таблицю «УДШВ\.xlsx» \(станом на \d\d\.\d\d\.2026 \d\d:\d\d\)/);
  assert.equal(av.calls.toast[0][1], 'ok');
});

test('an empty slot, a foreign version or broken JSON leave the dashboard alone', async () => {
  for (const tagText of [null, '', '  \n ', '{broken', payload({ v: 2 }), payload({ data: '' })]) {
    const av = fakeDashboard();
    const { timers, flush } = await runBootstrap({ tagText, av });
    await flush();
    assert.equal(av.calls.connect.length, 0, `no connect for ${JSON.stringify(tagText)}`);
    assert.equal(timers.length, 0, 'and no waiting for the dashboard');
  }
});

test('the table waits for the dashboard to appear and a failure is shown, not thrown', async () => {
  const code = await readText('script/standalone-embedded-table.js');
  const av = fakeDashboard();
  av.connect = async () => { throw new Error('не xlsx'); };
  const timers = [];
  const win = { atob: (t) => Buffer.from(t, 'base64').toString('binary'), setTimeout: (fn) => timers.push(fn) };
  const doc = { getElementById: () => ({ textContent: payload() }) };
  vm.runInNewContext(code, { document: doc, window: win, Uint8Array, Promise, JSON, Date, String, isNaN });
  assert.equal(timers.length, 1, 'dashboard not ready yet: polls again later');
  win.__AV = av;
  timers.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(av.calls.error, ['Не вдалося відкрити вбудовану таблицю: не xlsx']);
  assert.equal(av.calls.toast.length, 0);
});
