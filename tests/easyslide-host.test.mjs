import test from 'node:test';
import assert from 'node:assert/strict';
import { createEasySlideHost, findInvoke, toOpenedFile } from '../src/workspace/easyslide/host-core.js';

test('findInvoke: власний Tauri, батьківський кадр або нічого', () => {
  const own = () => {};
  assert.equal(findInvoke({ __TAURI_INTERNALS__: { invoke: own } }), own);
  const parentInvoke = () => {};
  const child = { parent: { __TAURI_INTERNALS__: { invoke: parentInvoke } } };
  assert.equal(findInvoke(child), parentInvoke);
  const lonely = {}; lonely.parent = lonely;
  assert.equal(findInvoke(lonely), null);
  const foreign = { get parent() { return { get __TAURI_INTERNALS__() { throw new Error('cross-origin'); } }; } };
  assert.equal(findInvoke(foreign), null);
});

test('toOpenedFile перетворює відповідь команди на байти', () => {
  assert.equal(toOpenedFile(null), null);
  assert.equal(toOpenedFile({ name: 'x.pptx' }), null);
  const file = toOpenedFile({ name: 'Тест.pptx', bytes: [80, 75, 3, 4] });
  assert.equal(file.name, 'Тест.pptx');
  assert.ok(file.bytes instanceof Uint8Array);
  assert.deepEqual([...file.bytes], [80, 75, 3, 4]);
});

test('без Tauri міст не створюється', () => {
  assert.equal(createEasySlideHost(undefined), null);
});

test('open і save викликають команди EasyWAR', async () => {
  const calls = [];
  const messages = [];
  const invoke = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'open_easyslide_file') return { name: 'синтетика.pptx', bytes: [1, 2, 3] };
    if (cmd === 'save_easyslide_file') return '/tmp/синтетика.pptx';
    throw new Error('невідома команда');
  };
  const host = createEasySlideHost(invoke, (text) => messages.push(text));
  const opened = await host.open('presentation');
  assert.equal(opened.name, 'синтетика.pptx');
  assert.deepEqual([...opened.bytes], [1, 2, 3]);
  const saved = await host.save('звіт.pptx', new Uint8Array([9, 8]));
  assert.equal(saved, '/tmp/синтетика.pptx');
  assert.deepEqual(calls[0], ['open_easyslide_file', { purpose: 'presentation' }]);
  assert.deepEqual(calls[1], ['save_easyslide_file', { fileName: 'звіт.pptx', bytes: [9, 8] }]);
  assert.match(messages.at(-1), /Збережено/);
});

test('помилки й скасування не ламають редактор', async () => {
  const messages = [];
  const failing = createEasySlideHost(async () => { throw 'немає доступу'; }, (text) => messages.push(text));
  assert.equal(await failing.open('picture'), null);
  assert.equal(await failing.save('a.pptx', new Uint8Array([1])), null);
  assert.equal(messages.length, 2);
  const cancelled = createEasySlideHost(async () => null);
  assert.equal(await cancelled.open(), null);
  assert.equal(await cancelled.save('a.pptx', new Uint8Array([1])), null);
});
