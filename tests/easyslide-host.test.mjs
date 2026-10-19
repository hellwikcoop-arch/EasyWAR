import test from 'node:test';
import assert from 'node:assert/strict';
import { createEasySlideHost, extensionOf, openOptions, saveOptions } from '../src/workspace/easyslide/host-core.js';

test('extensionOf і параметри вікон', () => {
  assert.equal(extensionOf('Звіт.PPTX'), 'pptx');
  assert.equal(extensionOf('без розширення'), '');
  assert.deepEqual(openOptions('presentation').extensions, ['pptx', 'ppsx', 'potx', 'deckcraft']);
  assert.equal(openOptions('picture').filterName, 'Зображення');
  assert.deepEqual(saveOptions('Звіт.pptx'), { suggestedName: 'Звіт.pptx', extensions: ['pptx'], filterName: 'Презентація PowerPoint', title: 'Зберегти з EasySlide' });
  assert.deepEqual(saveOptions('слайд.jpeg').extensions, ['jpg']);
  assert.equal(saveOptions('run.exe'), null);
});

function fakeHost() {
  const calls = [];
  let next = 1;
  return {
    calls,
    async openFile(options) { calls.push(['openFile', options.extensions[0]]); return { handle: `h${next++}`, name: 'синтетика.pptx', bytes: new Uint8Array([80, 75]) }; },
    async saveFileAs({ bytes, suggestedName, extensions }) { calls.push(['saveFileAs', suggestedName, extensions[0], bytes.length]); return { handle: `h${next++}`, name: suggestedName }; },
    async closeFile(handle) { calls.push(['closeFile', handle]); },
    setDirty(flag) { calls.push(['setDirty', flag]); },
    setTitle(text) { calls.push(['setTitle', text]); },
  };
}

test('відкриття презентації й зображення через host оболонки', async () => {
  const host = fakeHost();
  const bridge = createEasySlideHost(host);
  const opened = await bridge.open('presentation');
  assert.equal(opened.name, 'синтетика.pptx');
  assert.deepEqual([...opened.bytes], [80, 75]);
  await bridge.open('picture');
  await bridge.open('presentation');
  assert.deepEqual(host.calls, [['openFile', 'pptx'], ['openFile', 'png'], ['openFile', 'pptx'], ['closeFile', 'h1']]);
});

test('збереження: презентація знімає позначку змін, експорт — ні', async () => {
  const host = fakeHost();
  const messages = [];
  const bridge = createEasySlideHost(host, (text) => messages.push(text));
  assert.equal(await bridge.save('звіт.pptx', new Uint8Array([1, 2, 3])), true);
  assert.equal(await bridge.save('звіт.pdf', new Uint8Array([4])), false);
  assert.equal(await bridge.save('звіт.exe', new Uint8Array([4])), false);
  assert.deepEqual(host.calls, [['saveFileAs', 'звіт.pptx', 'pptx', 3], ['saveFileAs', 'звіт.pdf', 'pdf', 1], ['closeFile', 'h2']]);
  assert.match(messages[0], /Збережено: звіт.pptx/);
  assert.match(messages.at(-1), /не зберігає/);
});

test('скасування й помилки не ламають редактор', async () => {
  const messages = [];
  const cancelled = createEasySlideHost({ openFile: async () => null, saveFileAs: async () => null });
  assert.equal(await cancelled.open('presentation'), null);
  assert.equal(await cancelled.save('a.pptx', new Uint8Array([1])), false);
  const failing = createEasySlideHost({ openFile: async () => { throw new Error('немає профілю'); }, saveFileAs: async () => { throw new Error('таблиця профілю'); } }, (text) => messages.push(text));
  assert.equal(await failing.open('presentation'), null);
  assert.equal(await failing.save('a.pptx', new Uint8Array([1])), false);
  assert.deepEqual(messages, ['Не вдалося відкрити файл: немає профілю', 'Не вдалося зберегти: таблиця профілю']);
});

test('setState передає оболонці позначку змін і назву', () => {
  const host = fakeHost();
  const bridge = createEasySlideHost(host);
  bridge.setState(true, 'синтетика');
  assert.equal(bridge.isDirty(), true);
  bridge.setState(false, '');
  assert.equal(bridge.isDirty(), false);
  assert.deepEqual(host.calls, [['setDirty', true], ['setTitle', 'синтетика'], ['setDirty', false]]);
});
