// Модуль «Робоче середовище» (src/workspace): реєстр застосунків «Офісу», контракт
// підключення mount(container, host), host з відкриттям/збереженням через Tauri або браузер,
// підключення в лаунчері й у збірці. Лише синтетичні байти.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  CONTRACT_VERSION,
  OFFICE_APPS,
  WORKSPACE_SECTIONS,
  acceptAttribute,
  appById,
  appFromSearch,
  appPageUrl,
  bytesForInvoke,
  dialogOptions,
  entryError,
  entryKey,
  findEntry,
  frameMessage,
  frameTitle,
  nameWithExtension,
  normalizeExtensions,
  normalizeMounted,
  parseFrameMessage,
  parsePendingFile,
  pendingFileNotice,
  shellMode,
  toBytes,
} from '../src/workspace/workspace-core.js';
import { createHost, findInvoke, findPendingFile } from '../src/workspace/workspace-host.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('розділ «Офіс» має три застосунки в порядку EasyGreen, EasyDoc, EasySlide', () => {
  assert.deepEqual(OFFICE_APPS.map(app => app.id), ['easygreen', 'easydoc', 'easyslide']);
  assert.deepEqual(OFFICE_APPS.map(app => app.title), ['EasyGreen', 'EasyDoc', 'EasySlide']);
  assert.deepEqual(WORKSPACE_SECTIONS.map(section => section.title), ['Офіс']);
  assert.deepEqual(WORKSPACE_SECTIONS[0].apps, ['easygreen', 'easydoc', 'easyslide']);
  for (const app of OFFICE_APPS) {
    assert.ok(Object.isFrozen(app) && Object.isFrozen(app.extensions));
    assert.deepEqual(normalizeExtensions(app.extensions), [...app.extensions], `${app.id}: типові розширення коректні`);
    assert.match(app.hint, /[а-яіїєґ]/i, `${app.id}: підказка українською`);
  }
});

test('адреса сторінки застосунку й розбір ?app=', () => {
  assert.equal(appPageUrl('easydoc'), 'app.html?app=easydoc');
  assert.throws(() => appPageUrl('word'), /Невідомий застосунок/);
  assert.equal(appFromSearch('?app=easyslide'), appById('easyslide'));
  assert.equal(appFromSearch('?app=../../index'), null);
  assert.equal(appFromSearch(''), null);
});

test('код застосунку шукається в src/workspace/<id>/app.js; без нього — заглушка', () => {
  const loader = async () => ({});
  assert.equal(entryKey('easygreen'), './easygreen/app.js');
  assert.equal(findEntry({ './easygreen/app.js': loader }, 'easygreen'), loader);
  assert.equal(findEntry({ './easygreen/app.js': loader }, 'easydoc'), null);
  assert.equal(findEntry({}, 'easygreen'), null);
});

test('модуль застосунку перевіряється за контрактом', () => {
  assert.match(entryError(null), /mount/);
  assert.match(entryError({ default: () => {} }), /mount/);
  assert.equal(entryError({ mount() {} }), null);
  assert.equal(entryError({ mount() {}, contract: CONTRACT_VERSION }), null);
  assert.match(entryError({ mount() {}, contract: CONTRACT_VERSION + 1 }), /новішої версії EasyWAR/);
  assert.match(entryError({ mount() {}, contract: '1' }), /недійсну/);
});

test('результат mount: unmount/destroy та isDirty необов\'язкові', () => {
  const empty = normalizeMounted(undefined);
  assert.doesNotThrow(() => empty.unmount());
  assert.equal(empty.isDirty(), false);
  let calls = 0;
  const mounted = { unmount() { calls += this === mounted ? 1 : 100; } };
  normalizeMounted(mounted).unmount();
  assert.equal(calls, 1);
  let destroyed = 0;
  const panel = { destroy() { destroyed += 1; }, isDirty: () => 1 };
  const normalized = normalizeMounted(panel);
  normalized.unmount();
  assert.equal(destroyed, 1, 'destroy() — синонім unmount()');
  assert.equal(normalized.isDirty(), true);
  assert.equal(normalizeMounted({ isDirty() { throw new Error('x'); } }).isDirty(), false);
});

test('розширення й параметри вікон збігаються з правилами Rust', () => {
  assert.deepEqual(normalizeExtensions(['.XLSX', 'csv', 'xlsx']), ['xlsx', 'csv']);
  assert.throws(() => normalizeExtensions([]), /щонайменше одне/);
  assert.throws(() => normalizeExtensions(['../x']), /Недопустиме/);
  assert.throws(() => normalizeExtensions(Array.from({ length: 9 }, (_, i) => `e${i}`)), /Забагато/);
  assert.equal(acceptAttribute(['docx', 'txt']), '.docx,.txt');
  assert.deepEqual(dialogOptions(appById('easygreen')), { extensions: ['xlsx', 'csv'], title: null, filterName: 'Таблиці', suggestedName: null });
  assert.deepEqual(
    dialogOptions(appById('easydoc'), { extensions: ['odt'], title: 'Відкрити наказ', suggestedName: '/tmp/x/наказ.odt' }),
    { extensions: ['odt'], title: 'Відкрити наказ', filterName: 'Документи', suggestedName: 'наказ.odt' },
  );
  assert.equal(nameWithExtension('звіт', ['pptx']), 'звіт.pptx');
  assert.equal(nameWithExtension('звіт.PPTX', ['pptx']), 'звіт.PPTX');
  assert.equal(nameWithExtension('', ['docx']), 'Документ.docx');
});

test('байти файлу', () => {
  assert.deepEqual(bytesForInvoke(new Uint8Array([1, 2, 3])), [1, 2, 3]);
  assert.deepEqual(bytesForInvoke(new Uint8Array([9, 1, 2]).subarray(1)), [1, 2]);
  assert.deepEqual([...toBytes(new Uint8Array([5, 6]).buffer)], [5, 6]);
  assert.throws(() => bytesForInvoke(new Uint8Array()), /порожній/);
  assert.throws(() => toBytes('текст'), /Очікуються байти/);
});

test('заголовок і повідомлення сторінки застосунку до оболонки', () => {
  const app = appById('easygreen');
  assert.equal(frameTitle(app, '', false), 'EasyGreen');
  assert.equal(frameTitle(app, 'звіт.xlsx', true), 'EasyGreen — звіт.xlsx •');
  const message = frameMessage('easygreen', { title: 'звіт.xlsx', dirty: 1 });
  assert.deepEqual(parseFrameMessage(message, 'easygreen'), { title: 'звіт.xlsx', dirty: true });
  assert.equal(parseFrameMessage(message, 'easydoc'), null, 'чужий застосунок');
  assert.equal(parseFrameMessage({ type: 'other' }, 'easygreen'), null);
  assert.equal(parseFrameMessage(null, 'easygreen'), null);
});

function fakeInvoke(responses) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args]);
    return typeof responses[command] === 'function' ? responses[command](args) : responses[command];
  };
  return { invoke, calls };
}

test('host у настільному застосунку: мова, відкриття й збереження через Tauri-команди office_*', async () => {
  const { invoke, calls } = fakeInvoke({
    office_open_file: { handle: 'f1', name: 'зразок.xlsx', bytes: [80, 75, 3, 4] },
    office_save_file: ({ handle }) => ({ handle, name: 'зразок.xlsx' }),
    office_save_file_as: { handle: 'f2', name: 'копія.xlsx' },
    office_close_file: null,
  });
  const states = [];
  const host = createHost({ appEntry: appById('easygreen'), invoke, onState: state => states.push(state) });
  assert.equal(host.contract, CONTRACT_VERSION);
  assert.equal(host.appId, 'easygreen');
  assert.equal(host.language, 'uk');
  assert.equal(host.locale, 'uk-UA');
  assert.equal(host.desktop, true);
  assert.ok(Object.isFrozen(host));

  const opened = await host.openFile();
  assert.equal(opened.handle, 'f1');
  assert.ok(opened.bytes instanceof Uint8Array);
  assert.deepEqual([...opened.bytes], [80, 75, 3, 4]);
  assert.deepEqual(calls[0], ['office_open_file', { options: { extensions: ['xlsx', 'csv'], title: null, filterName: 'Таблиці', suggestedName: null } }]);

  assert.deepEqual(await host.saveFile({ handle: 'f1', bytes: new Uint8Array([1]) }), { handle: 'f1', name: 'зразок.xlsx' });
  assert.deepEqual(calls[1], ['office_save_file', { handle: 'f1', bytes: [1] }]);
  await assert.rejects(host.saveFile({ bytes: new Uint8Array([1]) }), /saveFileAs/);

  assert.deepEqual(await host.saveFileAs({ bytes: new Uint8Array([2]), suggestedName: 'копія' }), { handle: 'f2', name: 'копія.xlsx' });
  assert.deepEqual(calls[2][1].options.suggestedName, 'копія');
  await host.closeFile('f2');
  assert.deepEqual(calls[3], ['office_close_file', { handle: 'f2' }]);

  const rooted = createHost({ appEntry: appById('easygreen'), rootUrl: 'http://localhost/' });
  assert.equal(rooted.resolve('workspace/easygreen/app/index.html'), 'http://localhost/workspace/easygreen/app/index.html');
  host.setTitle('зразок.xlsx');
  host.setDirty(true);
  assert.deepEqual(states.at(-1), { title: 'зразок.xlsx', dirty: true });
});

test('host у браузері без Tauri: вибір файла й завантаження', async () => {
  const downloads = [];
  const browser = {
    pickFile: async accept => {
      assert.equal(accept, '.pptx');
      return { name: 'нарада.pptx', arrayBuffer: async () => new Uint8Array([7, 8]).buffer };
    },
    download: (name, bytes) => downloads.push([name, [...bytes]]),
  };
  const host = createHost({ appEntry: appById('easyslide'), browser });
  assert.equal(host.desktop, false);
  const opened = await host.openFile();
  assert.equal(opened.name, 'нарада.pptx');
  assert.deepEqual([...opened.bytes], [7, 8]);
  await host.saveFile({ handle: opened.handle, bytes: new Uint8Array([9]) });
  const saved = await host.saveFileAs({ bytes: new Uint8Array([1]), suggestedName: 'підсумки' });
  assert.equal(saved.name, 'підсумки.pptx');
  assert.deepEqual(downloads, [['нарада.pptx', [9]], ['підсумки.pptx', [1]]]);
  await host.closeFile(opened.handle);
  await assert.rejects(host.saveFile({ handle: opened.handle, bytes: new Uint8Array([1]) }), /Зберегти як/);
});

test('invoke шукається на сторінці та в батьківських кадрах', () => {
  const invoke = function () { return this; };
  const top = { __TAURI_INTERNALS__: { invoke } };
  top.parent = top;
  const middle = { parent: top };
  const child = { parent: middle };
  assert.equal(findInvoke(child)(), top.__TAURI_INTERNALS__);
  const alone = {};
  alone.parent = alone;
  assert.equal(findInvoke(alone), null);
});

test('режим оболонки: вікно редактора, головне вікно Tauri чи браузер', () => {
  assert.deepEqual(shellMode(undefined, false), { mode: 'browser', app: null });
  assert.deepEqual(shellMode(undefined, true), { mode: 'desktop', app: null });
  assert.equal(shellMode('easydoc', true).mode, 'editor');
  assert.equal(shellMode('easydoc', true).app.id, 'easydoc');
  assert.deepEqual(shellMode('невідомий', true), { mode: 'editor', app: null });
  assert.deepEqual(shellMode(42, true), { mode: 'editor', app: null });
});

test('модуль підключено в лаунчері, у збірці й без мережі', async () => {
  assert.match(await read('src/launcher-tools.js'), /import '\.\/workspace-launcher\.js';/);
  const launcher = await read('src/workspace-launcher.js');
  assert.match(launcher, /'Робоче середовище'/);
  assert.match(launcher, /const WORKSPACE_URL = 'workspace\/index\.html';/);
  assert.match(launcher, /EW_WORKSPACE\?\.requestClose/);
  const vite = await read('vite.config.js');
  assert.match(vite, /workspace: fileURLToPath\(new URL\("\.\/src\/workspace\/index\.html"/);
  assert.match(vite, /"workspace-app": fileURLToPath\(new URL\("\.\/src\/workspace\/app\.html"/);
  assert.match(vite, /workspace\[-\/\]/, 'робоче середовище не входить в офлайн-кеш телефона');
  assert.match(await read('src/workspace/workspace-registry.js'), /import\.meta\.glob\('\.\/\*\/app\.js'\)/);

  const dir = new URL('src/workspace/', root);
  for (const file of (await readdir(dir)).filter(name => /\.(js|html)$/.test(name))) {
    const text = await read(`src/workspace/${file}`);
    assert.doesNotMatch(text, /https?:\/\/|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB/, `${file}: без мережі й сховищ браузера`);
    assert.doesNotMatch(text, /innerHTML/, `${file}: лише textContent`);
  }
  const index = await read('src/workspace/index.html');
  assert.match(index, /<html lang="uk">/);
  assert.match(index, /<script type="module" src="\.\/workspace\.js"><\/script>/);
  assert.match(await read('src/workspace/app.html'), /<script type="module" src="\.\/app-frame\.js"><\/script>/);
  assert.match(await read('src/workspace/app-frame.js'), /у розробці/);
});

test('очікуваний файл з бібліотеки: розбір значення __EW_PENDING_FILE', () => {
  assert.deepEqual(parsePendingFile('Довідка.docx'), { name: 'Довідка.docx' });
  assert.ok(Object.isFrozen(parsePendingFile('Довідка.docx')));
  assert.deepEqual(parsePendingFile(JSON.stringify('Нарада «жовтень».pptx')), { name: 'Нарада «жовтень».pptx' }, 'назва, ще раз закодована як JSON');
  assert.deepEqual(parsePendingFile({ name: '  Таблиця.xlsx ' }), { name: 'Таблиця.xlsx' });
  assert.deepEqual(parsePendingFile('"Звіт".docx'), { name: '"Звіт".docx' }, 'не JSON — сама назва');
  assert.deepEqual(parsePendingFile('Звіт\u202e.docx\n'), { name: 'Звіт.docx' }, 'без керівних символів і зміни напрямку');
  assert.equal(Array.from(parsePendingFile('я'.repeat(500)).name).length, 200);
  for (const value of [null, undefined, '', '   ', 42, ['a'], {}, { name: 7 }]) assert.equal(parsePendingFile(value), null);
});

test('очікуваний файл шукається вгору кадрами, як invoke; чужий кадр не читається', () => {
  const top = { __EW_PENDING_FILE: 'Довідка.docx' };
  top.parent = top;
  const shell = { parent: top };
  const app = { parent: shell };
  assert.deepEqual(findPendingFile(app), { name: 'Довідка.docx' });
  const empty = { __EW_PENDING_FILE: null };
  empty.parent = empty;
  assert.equal(findPendingFile({ parent: empty }), null, 'у вікні редактора без очікуваного файлу — null');
  const alone = {};
  alone.parent = alone;
  assert.equal(findPendingFile(alone), null);
  const foreign = { get __EW_PENDING_FILE() { throw new Error('SecurityError'); } };
  foreign.parent = foreign;
  assert.equal(findPendingFile({ parent: foreign }), null, 'кадр чужого походження');
  assert.equal(findPendingFile(undefined), null);
  // Глибше за чотири кадри не шукає (як findInvoke).
  let deep = top;
  for (let i = 0; i < 4; i += 1) deep = { parent: deep };
  assert.equal(findPendingFile(deep), null);
});

test('host.pendingFile — лише в настільному застосунку', () => {
  const { invoke } = fakeInvoke({});
  const desktop = createHost({ appEntry: appById('easygreen'), invoke, pendingFile: { name: 'Таблиця.xlsx' } });
  assert.deepEqual(desktop.pendingFile, { name: 'Таблиця.xlsx' });
  assert.ok(Object.isFrozen(desktop.pendingFile));
  assert.equal(createHost({ appEntry: appById('easygreen'), invoke }).pendingFile, null, 'без вікна з __EW_PENDING_FILE');
  assert.equal(createHost({ appEntry: appById('easygreen'), pendingFile: { name: 'Таблиця.xlsx' } }).pendingFile, null, 'у браузері немає');
});

test('підказка про файл з бібліотеки — лише для EasyDoc і EasySlide', () => {
  const pending = { name: 'Довідка.docx' };
  assert.equal(pendingFileNotice('easydoc', pending), '«Довідка.docx» з бібліотеки: натисніть «Відкрити…» у редакторі — файл відкриється без вибору.');
  assert.match(pendingFileNotice('easyslide', pending), /^«Довідка\.docx» з бібліотеки/);
  assert.equal(pendingFileNotice('easygreen', pending), null, 'EasyGreen відкриває файл сам');
  assert.equal(pendingFileNotice('easydoc', null), null);
});

test('байти з іншого realm (invoke головного вікна) стають Uint8Array', () => {
  const context = vm.createContext({});
  const buffer = vm.runInContext('new Uint8Array([1, 2, 3]).buffer', context);
  assert.equal(buffer instanceof ArrayBuffer, false);
  assert.deepEqual([...toBytes(buffer)], [1, 2, 3]);
  const view = vm.runInContext('new Uint8Array([4, 5])', context);
  assert.deepEqual([...toBytes(view)], [4, 5]);
});

test('оболонка: вкладки «Офіс» і «Бібліотека», блокування при закритті, підказка у вікні редактора', async () => {
  const index = await read('src/workspace/index.html');
  assert.match(index, /role="tablist"/);
  assert.match(index, /id="ws-tab-office" role="tab" data-tab="office" aria-controls="ws-sections" aria-selected="true">Офіс</);
  assert.match(index, /id="ws-tab-library" role="tab" data-tab="library" aria-controls="ws-library" aria-selected="false" tabindex="-1">Бібліотека</);
  assert.match(index, /<section class="ws-library" id="ws-library" role="tabpanel" aria-labelledby="ws-tab-library" hidden><\/section>/);
  assert.match(index, /<div class="ws-notice" id="ws-notice" role="status" hidden>/);
  const shell = await read('src/workspace/workspace.js');
  assert.match(shell, /import\('\.\/library\.js'\)/, 'бібліотека — окремий чанк, вантажиться з вкладкою');
  assert.match(shell, /'Бібліотека доступна лише в застосунку EasyWAR\.'/);
  assert.match(shell, /if \(shell\.mode !== 'desktop'\)/, 'бібліотека лише в головному вікні застосунку');
  assert.match(shell, /if \(shell\.mode === 'desktop'\) \{\s*\/\/[^\n]*\n\s*window\.addEventListener\('pagehide', \(\) => \{ invoke\('library_lock'\)\.catch\(\(\) => \{\}\); \}\);/);
  assert.match(shell, /showPendingNotice\(pendingFileNotice\(shell\.app\.id, findPendingFile\(window\)\)\)/);
  const library = await read('src/workspace/library.js');
  assert.match(library, /'Індекс будується — пошук лише за назвами'/);
  for (const label of ['Імпортувати…', 'Імпортувати шаблон…', 'Створити з шаблону…', 'Застарілі документи', 'Зберегти архів…', 'Новий код відновлення', 'Заблокувати',
    'Створити бібліотеку', 'Створити код відновлення', 'Розблокувати', 'Забули пароль?', 'Показати приховані', 'Історія версій', 'Перейменувати',
    'Зберегти копію…', 'Оновити з джерела', 'Відв’язати', 'Зробити поточною', 'Оновити всі']) {
    assert.ok(library.includes(`'${label}`) || library.includes(`${label}'`), label);
  }
});
