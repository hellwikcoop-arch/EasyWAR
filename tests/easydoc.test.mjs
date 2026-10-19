// EasyDoc (прототип): місток між вбудованим редактором документів і командами EasyWAR,
// а також текстові контракти сторінки й кнопки лаунчера (офлайн, без зовнішніх адрес).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
// Скрипт лежить у public/ і підключається звичайним <script>, тож читаємо його як класичний скрипт.
const hostModule = { exports: {} };
vm.runInNewContext(await read('src/public/workspace/easydoc/easydoc-host.js'), { module: hostModule, Uint8Array, Array, String });
const { createEasydocHost, findInvoke } = hostModule.exports;

test('відкриття повертає ім\'я й байти документа з команди open_office_document', async () => {
  const calls = [];
  const host = createEasydocHost(async (cmd, args) => {
    calls.push([cmd, args]);
    return { name: 'Синтетичний.docx', bytes: [80, 75, 3, 4] };
  });
  const picked = await host.openDocument();
  assert.deepEqual(calls, [['open_office_document', undefined]]);
  assert.equal(picked.name, 'Синтетичний.docx');
  assert.ok(picked.bytes instanceof Uint8Array);
  assert.deepEqual([...picked.bytes], [80, 75, 3, 4]);
});

test('скасоване вікно відкриття дає null', async () => {
  const host = createEasydocHost(async () => null);
  assert.equal(await host.openDocument(), null);
});

test('збереження передає ім\'я й байти в save_office_document і повертає його відповідь', async () => {
  const calls = [];
  const host = createEasydocHost(async (cmd, args) => {
    calls.push([cmd, args]);
    return '/tmp/Звіт.docx';
  });
  assert.equal(await host.saveDocument('Звіт.docx', new Uint8Array([1, 2, 3])), '/tmp/Звіт.docx');
  // Об'єкт аргументів створено в іншому контексті vm, тож порівнюємо його вміст через JSON.
  assert.equal(JSON.stringify(calls), JSON.stringify([['save_office_document', { fileName: 'Звіт.docx', bytes: [1, 2, 3] }]]));
});

test('invoke береться з власного або батьківського вікна, без Tauri — null', () => {
  const invoke = () => {};
  assert.equal(findInvoke({ __TAURI_INTERNALS__: { invoke } }), invoke);
  const child = { parent: { __TAURI_INTERNALS__: { invoke } } };
  assert.equal(findInvoke(child), invoke);
  const lone = {};
  lone.parent = lone;
  assert.equal(findInvoke(lone), null);
  const blocked = { get parent() { throw new Error('cross-origin'); } };
  assert.equal(findInvoke(blocked), null);
});

test('сторінка EasyDoc українською, без зовнішніх адрес, вантажить лише локальні файли', async () => {
  const html = await read('src/public/workspace/easydoc/index.html');
  assert.match(html, /<html lang="uk">/);
  assert.match(html, /<title>EasyDoc<\/title>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /src="\.\/easydoc-host\.js"/);
  assert.match(html, /from '\.\/wordcraft-web\.js'/);
  const host = await read('src/public/workspace/easydoc/easydoc-host.js');
  assert.doesNotMatch(host, /fetch\(|XMLHttpRequest|WebSocket|https?:\/\//);
});

test('EasyDoc монтується з локальної сторінки; тимчасова кнопка підключена в лаунчері', async () => {
  const launcher = await read('src/workspace/easydoc/easydoc-launcher.js');
  assert.match(launcher, /EASYDOC_URL = 'workspace\/easydoc\/index\.html'/);
  assert.match(launcher, /EASYDOC_TITLE = 'EasyDoc'/);
  assert.match(launcher, /export function mountEasydoc/);
  assert.match(launcher, /about:blank/);
  assert.match(await read('src/launcher-tools.js'), /import '\.\/workspace\/easydoc\/easydoc-launcher\.js';/);
});
