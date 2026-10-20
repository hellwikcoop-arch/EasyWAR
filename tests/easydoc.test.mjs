// EasyDoc (прототип): місток між редактором WordCraft і host «Робочого середовища», сторінка
// редактора (офлайн, без зовнішніх адрес) і підключення за контрактом docs/WORKSPACE.md.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { DOCUMENT_EXTENSIONS, OPEN_EXTENSIONS, createEasydocBridge, extensionOf } from '../src/workspace/easydoc/easydoc-bridge-core.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function fakeHost({ open = null, save = null, saveAs = null } = {}) {
  const calls = [];
  const host = {
    calls,
    async openFile(options) { calls.push(['openFile', options]); return open; },
    async saveFile(args) { calls.push(['saveFile', args.handle]); return save; },
    async saveFileAs(args) { calls.push(['saveFileAs', args.suggestedName, args.extensions]); return saveAs; },
    async closeFile(handle) { calls.push(['closeFile', handle]); },
    setTitle(title) { calls.push(['setTitle', title]); },
    setDirty(dirty) { calls.push(['setDirty', dirty]); },
  };
  return host;
}

test('розширення визначається з імені файлу', () => {
  assert.equal(extensionOf('Звіт.DOCX'), 'docx');
  assert.equal(extensionOf('Звіт'), '');
  assert.equal(extensionOf('архів.tar.gz'), 'gz');
  assert.ok(OPEN_EXTENSIONS.length <= 8, 'оболонка приймає не більше 8 розширень');
  assert.ok(DOCUMENT_EXTENSIONS.includes('docx') && !DOCUMENT_EXTENSIONS.includes('pdf'));
});

test('відкриття бере файл через host і показує його назву', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const host = fakeHost({ open: { handle: 'h1', name: 'Синтетичний.docx', bytes } });
  const bridge = createEasydocBridge(host);
  const picked = await bridge.openDocument();
  assert.deepEqual(picked, { name: 'Синтетичний.docx', bytes });
  assert.deepEqual(host.calls[0], ['openFile', { extensions: [...OPEN_EXTENSIONS] }]);
  assert.deepEqual(host.calls.at(-1), ['setTitle', 'Синтетичний.docx']);
});

test('скасоване відкриття нічого не змінює', async () => {
  const host = fakeHost();
  assert.equal(await createEasydocBridge(host).openDocument(), null);
  assert.equal(host.calls.length, 1);
});

test('«Зберегти» з тією самою назвою пише у відкритий файл, нова назва — «Зберегти як…»', async () => {
  const host = fakeHost({ open: { handle: 'h1', name: 'Звіт.docx', bytes: new Uint8Array() }, save: { handle: 'h1', name: 'Звіт.docx' }, saveAs: { handle: 'h2', name: 'Копія.docx' } });
  const bridge = createEasydocBridge(host);
  await bridge.openDocument();
  assert.equal(await bridge.saveDocument('Звіт.docx', new Uint8Array([1])), 'Звіт.docx');
  assert.ok(host.calls.some(([kind, handle]) => kind === 'saveFile' && handle === 'h1'));
  assert.equal(await bridge.saveDocument('Копія.docx', new Uint8Array([1])), 'Копія.docx');
  assert.ok(host.calls.some(([kind, name, ext]) => kind === 'saveFileAs' && name === 'Копія.docx' && ext[0] === 'docx'));
  // Документ тепер у новому файлі, старий номер звільнено.
  assert.ok(host.calls.some(([kind, handle]) => kind === 'closeFile' && handle === 'h1'));
  assert.deepEqual(host.calls.at(-1), ['setTitle', 'Копія.docx']);
});

test('експорт у PDF не підміняє відкритий документ і звільняє номер експорту', async () => {
  const host = fakeHost({ open: { handle: 'h1', name: 'Звіт.docx', bytes: new Uint8Array() }, saveAs: { handle: 'h9', name: 'Звіт.pdf' } });
  const bridge = createEasydocBridge(host);
  await bridge.openDocument();
  assert.equal(await bridge.saveDocument('Звіт.pdf', new Uint8Array([1])), 'Звіт.pdf');
  assert.deepEqual(host.calls.at(-1), ['closeFile', 'h9']);
  assert.equal(await bridge.saveDocument('Звіт.docx', new Uint8Array([1])), null, 'host.saveFile повернув null');
});

test('позначка незбережених змін іде в host і читається через isDirty', async () => {
  const host = fakeHost();
  const bridge = createEasydocBridge(host);
  bridge.setDirty(true);
  assert.equal(bridge.isDirty(), true);
  assert.deepEqual(host.calls.at(-1), ['setDirty', true]);
});

test('сторінка редактора бере місток лише з батьківського вікна', async () => {
  const shim = { exports: {} };
  vm.runInNewContext(await read('src/public/workspace/easydoc/easydoc-host.js'), { module: shim });
  const { findBridge } = shim.exports;
  const bridge = { openDocument() {}, saveDocument() {} };
  assert.equal(findBridge({ parent: { __easydocHost: bridge } }), bridge);
  const lone = {};
  lone.parent = lone;
  assert.equal(findBridge(lone), null);
  assert.equal(findBridge({ parent: { __easydocHost: {} } }), null);
  assert.equal(findBridge({ get parent() { throw new Error('cross-origin'); } }), null);
});

test('сторінка EasyDoc українською, без зовнішніх адрес, вантажить лише локальні файли', async () => {
  const html = await read('src/public/workspace/easydoc/index.html');
  assert.match(html, /<html lang="uk">/);
  assert.match(html, /<title>EasyDoc<\/title>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /src="\.\/easydoc-host\.js"/);
  assert.match(html, /from '\.\/wordcraft-web\.js'/);
  for (const file of ['src/public/workspace/easydoc/easydoc-host.js', 'src/workspace/easydoc/app.js', 'src/workspace/easydoc/easydoc-bridge-core.js']) {
    assert.doesNotMatch(await read(file), /fetch\(|XMLHttpRequest|WebSocket|https?:\/\/|localStorage|indexedDB/, file);
  }
});

test('app.js дотримується контракту «Робочого середовища»', async () => {
  const app = await read('src/workspace/easydoc/app.js');
  assert.match(app, /export const contract = 1;/);
  assert.match(app, /export async function mount\(container, host\)/);
  assert.match(app, /host\.resolve\('workspace\/easydoc\/index\.html'\)/);
  assert.match(app, /unmount\(\)/);
  assert.match(app, /isDirty:/);
});

test('scrubRecentFiles прибирає лише поле recent зі стану WordCraft', async () => {
  const { scrubRecentFiles } = await import('../src/workspace/easydoc/recent-scrub.js');
  const data = new Map([['wordcraft.ui', JSON.stringify({ tab: 'Home', recent: ['Звіт.docx', 'Інший.docx'], zoom: 120 })]]);
  const win = { localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } };
  assert.equal(scrubRecentFiles(win), true);
  assert.deepEqual(JSON.parse(data.get('wordcraft.ui')), { tab: 'Home', recent: [], zoom: 120 });
  assert.equal(scrubRecentFiles(win), false, 'порожній список не переписується');
  assert.equal(scrubRecentFiles({ localStorage: { getItem: () => '{не json', setItem() {} } }), false);
  assert.equal(scrubRecentFiles(null), false);
  assert.equal(scrubRecentFiles({ get localStorage() { throw new Error('заблоковано'); } }), false);
});
