import assert from 'node:assert/strict';
import test from 'node:test';
import { PAGES, inlinePage, leftoverReferences } from '../script/build_standalone.mjs';

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
