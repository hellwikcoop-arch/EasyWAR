// EasyFLY для телефона (src/mobile/easyfly): зашифроване сховище (vault-core.js), host без Tauri
// (phone-host-core.js) і текстові контракти сторінки. Лише синтетичні дані; WebCrypto — з Node.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  MAX_TOTAL_BYTES, MIN_PASSPHRASE_LEN, VAULT_KEY, VaultError, createVault, fromBase64, isValidKey,
  passphraseProblem, toBase64,
} from '../src/mobile/easyfly/vault-core.js';
import {
  APP_ENTRY, acceptAttribute, createPhoneHost, nameWithExtension, shareViaNavigator, toBytes,
} from '../src/mobile/easyfly/phone-host-core.js';
import { createEmpty, parse, serialize } from '../src/workspace/easyfly/fly-store.js';
import { createDemo } from '../src/workspace/easyfly/fly-demo.js';

const src = name => new URL(`../src/${name}`, import.meta.url);
const read = name => readFile(src(name), 'utf8');

/** Сховище в пам'яті з тим самим інтерфейсом, що й IndexedDB-обгортка. */
function memoryStorage() {
  const map = new Map();
  return {
    map,
    async getItem(k) { return map.has(k) ? map.get(k) : null; },
    async setItem(k, v) { map.set(k, v); },
    async removeItem(k) { map.delete(k); },
  };
}

// Менше ітерацій у тестах: алгоритм той самий, лише швидше.
const vaultFor = (storage, options = {}) => createVault({ storage, crypto: webcrypto, iterations: 100_000, now: () => '2026-11-01T10:00:00.000Z', ...options });
const PHRASE = 'синтетична фраза 1';

test('base64 туди й назад, невірне кодування — помилка', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  assert.throws(() => fromBase64('не base64!'), VaultError);
});

test('парольна фраза: мінімум символів, без пробілів по краях', () => {
  assert.equal(MIN_PASSPHRASE_LEN, 8);
  assert.equal(passphraseProblem('коротка'), `Парольна фраза має містити щонайменше ${MIN_PASSPHRASE_LEN} символів.`);
  assert.match(passphraseProblem(' довга фраза '), /пробілом/);
  assert.equal(passphraseProblem(''), 'Введіть парольну фразу.');
  assert.equal(passphraseProblem(PHRASE), null);
});

test('ключі даних профілю: «простір.назва», як у profile-store.js', () => {
  assert.ok(isValidKey('easyfly.main'));
  assert.ok(!isValidKey('easyfly'));
  assert.ok(!isValidKey('Easyfly.main'));
  assert.ok(!isValidKey('easyfly..main'));
});

test('сховище: створення, запис, закриття, відкриття тією ж фразою', async () => {
  const storage = memoryStorage();
  const vault = vaultFor(storage);
  assert.equal(await vault.exists(), false);
  await assert.rejects(vault.read('easyfly.main'), /закрите/);
  await assert.rejects(vault.create('коротка'), /щонайменше/);
  await vault.create(PHRASE);
  assert.ok(vault.unlocked);
  assert.equal(await vault.exists(), true);
  assert.equal(await vault.read('easyfly.main'), null);
  const text = serialize(createDemo());
  assert.equal(await vault.write('easyfly.main', text), '2026-11-01T10:00:00.000Z');
  assert.deepEqual(await vault.list('easyfly.'), [{ key: 'easyfly.main', modified: '2026-11-01T10:00:00.000Z', size: new TextEncoder().encode(text).length }]);

  // У сховищі — лише один зашифрований запис; відкритого тексту (позивних) там немає.
  assert.deepEqual([...storage.map.keys()], [VAULT_KEY]);
  const envelope = JSON.parse(storage.map.get(VAULT_KEY));
  assert.equal(envelope.v, 1);
  assert.equal(envelope.cipher, 'AES-GCM');
  assert.equal(envelope.kdf.iterations, 100_000);
  const demoCallsign = createDemo().persons[0].callsign;
  assert.ok(!storage.map.get(VAULT_KEY).includes(demoCallsign));
  assert.ok(!storage.map.get(VAULT_KEY).includes('persons'));

  vault.lock();
  assert.ok(!vault.unlocked);
  await assert.rejects(vault.write('easyfly.main', 'x'), /закрите/);

  const again = vaultFor(storage);
  await assert.rejects(again.unlock('інша фраза 12'), /Невірна парольна фраза/);
  await assert.rejects(again.create(PHRASE), /вже є/);
  await again.unlock(PHRASE);
  const record = await again.read('easyfly.main');
  assert.equal(record.value, text);
  assert.equal(parse(record.value).ok, true);
  assert.equal(await again.remove('easyfly.main'), true);
  assert.equal(await again.remove('easyfly.main'), false);
  await again.destroy();
  assert.equal(await again.exists(), false);
  await assert.rejects(again.unlock(PHRASE), /ще немає/);
});

test('сховище: кожен запис — новий nonce; пошкоджений запис не відкривається', async () => {
  const storage = memoryStorage();
  const vault = vaultFor(storage);
  await vault.create(PHRASE);
  await vault.write('easyfly.main', 'a');
  const first = JSON.parse(storage.map.get(VAULT_KEY));
  await vault.write('easyfly.main', 'a');
  const second = JSON.parse(storage.map.get(VAULT_KEY));
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.data, second.data);
  assert.equal(first.kdf.salt, second.kdf.salt);

  storage.map.set(VAULT_KEY, JSON.stringify({ ...second, data: toBase64(new Uint8Array(fromBase64(second.data).map((b, i) => (i === 3 ? b ^ 1 : b)))) }));
  await assert.rejects(vaultFor(storage).unlock(PHRASE), /Невірна парольна фраза/);
  storage.map.set(VAULT_KEY, '{"v":2}');
  await assert.rejects(vaultFor(storage).unlock(PHRASE), /іншою версією/);
  storage.map.set(VAULT_KEY, 'не json');
  await assert.rejects(vaultFor(storage).unlock(PHRASE), /пошкоджено/);
});

test('сховище: межі розміру, помилка запису не псує дані в пам\'яті', async () => {
  const storage = memoryStorage();
  const vault = vaultFor(storage);
  await vault.create(PHRASE);
  await assert.rejects(vault.write('easyfly.main', ''), /Порожнє/);
  await assert.rejects(vault.write('easyfly.main', 'x'.repeat(MAX_TOTAL_BYTES + 1)), /5 МБ/);
  await vault.write('easyfly.main', 'ok');
  storage.setItem = async () => { throw new Error('quota'); };
  await assert.rejects(vault.write('easyfly.main', 'new'), /Не вдалося записати сховище: quota/);
  assert.equal((await vault.read('easyfly.main')).value, 'ok');
  await assert.rejects(vault.remove('easyfly.main'), /quota/);
  assert.equal((await vault.read('easyfly.main')).value, 'ok');
});

test('host: назви файлів і accept', () => {
  assert.deepEqual(APP_ENTRY.extensions, ['easyfly']);
  assert.equal(acceptAttribute(['easyfly']), '.easyfly');
  assert.equal(nameWithExtension('ескадрилья', ['easyfly']), 'ескадрилья.easyfly');
  assert.equal(nameWithExtension('ескадрилья.EASYFLY', ['easyfly']), 'ескадрилья.EASYFLY');
  assert.equal(nameWithExtension('a/b:c?', ['easyfly']), 'a_b_c_.easyfly');
  assert.equal(nameWithExtension('', ['easyfly']), 'EasyFLY.easyfly');
  assert.deepEqual(toBytes('ab'), new Uint8Array([97, 98]));
  assert.throws(() => toBytes(5), TypeError);
});

test('host: openFile через вибір файлу, saveFileAs через «Поділитися», запасне завантаження', async () => {
  const storage = memoryStorage();
  const vault = vaultFor(storage);
  await vault.create(PHRASE);
  const text = serialize(createEmpty());
  const fakeFile = { name: 'частина.easyfly', size: text.length, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
  const states = [];
  const shares = [];
  const downloads = [];
  let shareResult = 'shared';
  const host = createPhoneHost({
    vault,
    pickFile: async accept => { assert.equal(accept, '.easyfly'); return fakeFile; },
    shareFile: async (name, bytes) => { shares.push([name, bytes.length]); return shareResult; },
    download: (name, bytes) => downloads.push([name, bytes.length]),
    onState: s => states.push(s),
    rootUrl: 'https://example.invalid/app/',
  });
  assert.equal(host.desktop, false);
  assert.equal(host.phone, true);
  assert.equal(host.language, 'uk');
  assert.equal(host.profile, vault);
  assert.equal(host.resolve('/x.png'), 'https://example.invalid/app/x.png');

  const opened = await host.openFile({ extensions: ['easyfly'] });
  assert.equal(opened.name, 'частина.easyfly');
  assert.equal(parse(opened.bytes).ok, true);
  await host.closeFile(opened.handle);
  await assert.rejects(host.saveFile({ handle: opened.handle, bytes: 'x' }), /більше не відкритий/);

  const bytes = new TextEncoder().encode(text);
  const saved = await host.saveFileAs({ bytes, suggestedName: 'копія' });
  assert.equal(saved.name, 'копія.easyfly');
  assert.deepEqual(shares, [['копія.easyfly', bytes.length]]);
  assert.deepEqual(downloads, []);
  assert.deepEqual(await host.saveFile({ handle: saved.handle, bytes }), saved);

  shareResult = 'cancelled';
  assert.equal(await host.saveFileAs({ bytes, suggestedName: 'копія' }), null, 'скасування — не помилка і не «збережено»');
  assert.deepEqual(downloads, []);

  shareResult = 'unsupported';
  const fallback = await host.saveFileAs({ bytes, suggestedName: 'копія' });
  assert.equal(fallback.name, 'копія.easyfly');
  assert.deepEqual(downloads, [['копія.easyfly', bytes.length]]);

  host.setTitle('Дані профілю');
  host.setDirty(true);
  assert.deepEqual(states.at(-1), { title: 'Дані профілю', dirty: true });
  assert.throws(() => createPhoneHost({ pickFile: async () => null }), /vault/);
});

test('host: великий файл і браузер без «Поділитися» і без завантаження', async () => {
  const vault = vaultFor(memoryStorage());
  await vault.create(PHRASE);
  const host = createPhoneHost({ vault, pickFile: async () => ({ name: 'big.easyfly', size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }) });
  await assert.rejects(host.openFile(), /5 МБ/);
  await assert.rejects(host.saveFileAs({ bytes: 'x' }), /не вміє/);
});

test('shareViaNavigator: підтримка, скасування, інша помилка', async () => {
  class FakeFile { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options?.type; } }
  const bytes = new Uint8Array([1, 2]);
  assert.equal(await shareViaNavigator({}, 'a.easyfly', bytes, { FileCtor: FakeFile }), 'unsupported');
  assert.equal(await shareViaNavigator({ share: async () => {}, canShare: () => false }, 'a.easyfly', bytes, { FileCtor: FakeFile }), 'unsupported');
  const calls = [];
  const nav = { canShare: ({ files }) => files[0] instanceof FakeFile, share: async data => { calls.push(data); } };
  assert.equal(await shareViaNavigator(nav, 'a.easyfly', bytes, { FileCtor: FakeFile }), 'shared');
  assert.equal(calls[0].files[0].name, 'a.easyfly');
  assert.equal(calls[0].files[0].type, 'application/json');
  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  assert.equal(await shareViaNavigator({ ...nav, share: async () => { throw abort; } }, 'a.easyfly', bytes, { FileCtor: FakeFile }), 'cancelled');
  await assert.rejects(shareViaNavigator({ ...nav, share: async () => { throw new Error('boom'); } }, 'a.easyfly', bytes, { FileCtor: FakeFile }), /boom/);
});

test('сторінка телефона: без Tauri-команд і мережі, маніфест встановлюваний', async () => {
  const html = await read('mobile/easyfly/index.html');
  assert.match(html, /<link rel="manifest" href="\.\/easyfly\.webmanifest">/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /<script type="module" src="\.\/main\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>[^]*<\/script>/, 'усі скрипти — модулі з файлів');
  for (const name of ['mobile/easyfly/main.js', 'mobile/easyfly/vault-core.js', 'mobile/easyfly/phone-host-core.js']) {
    const code = await read(name);
    assert.doesNotMatch(code, /__TAURI__|invoke\(|fetch\(|XMLHttpRequest|WebSocket|https?:\/\//, `${name}: без Tauri-команд і мережі`);
  }
  const manifest = JSON.parse(await read('mobile/easyfly/public/easyfly.webmanifest'));
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) await readFile(src(`mobile/easyfly/public/${icon.src.replace(/^\.\//, '')}`));
  const config = await readFile(new URL('../vite.easyfly-phone.config.js', import.meta.url), 'utf8');
  assert.match(config, /root: "src\/mobile\/easyfly"/);
  assert.match(config, /outDir: "\.\.\/\.\.\/\.\.\/dist-easyfly-phone"/);
});

// ───────────── вибір сховища і один HTML-файл ─────────────
import { createLocalStorageAdapter, createMemoryStorage, selectStorage } from '../src/mobile/easyfly/vault-core.js';
import { FILE_NAME, inlinePage, leftoverReferences } from '../script/build_easyfly_html.mjs';

function fakeLocalStorage(broken = false) {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (broken) throw new Error('QuotaExceededError'); map.set(k, v); },
    removeItem: k => { map.delete(k); },
  };
}

test('selectStorage: IndexedDB → localStorage → пам\'ять, пробний запис прибирається', async () => {
  const ls = fakeLocalStorage();
  const viaLocal = await selectStorage({ indexedDB: null, localStorage: ls });
  assert.equal(viaLocal.kind, 'localstorage');
  assert.equal(ls.getItem('easyfly.vault.probe'), null);
  const brokenIdb = { open: () => { throw new Error('SecurityError'); } };
  assert.equal((await selectStorage({ indexedDB: brokenIdb, localStorage: ls })).kind, 'localstorage');
  const memory = await selectStorage({ indexedDB: null, localStorage: fakeLocalStorage(true) });
  assert.equal(memory.kind, 'memory');
  await memory.storage.setItem('a', '1');
  assert.equal(await memory.storage.getItem('a'), '1');
  assert.equal((await selectStorage({})).kind, 'memory');
  const adapter = createLocalStorageAdapter(ls);
  await adapter.setItem('k', 'v');
  assert.equal(await adapter.getItem('k'), 'v');
  await adapter.removeItem('k');
  assert.equal(await adapter.getItem('k'), null);
  assert.throws(() => createLocalStorageAdapter(null), VaultError);
  const mem = createMemoryStorage();
  assert.equal(await mem.getItem('x'), null);
});

test('сховище працює і в пам\'яті (файл без сховища браузера)', async () => {
  const vault = vaultFor(createMemoryStorage());
  await vault.create(PHRASE);
  await vault.write('easyfly.main', 'x');
  assert.equal((await vault.read('easyfly.main')).value, 'x');
});

const PAGE = `<!doctype html><html><head>
<link rel="manifest" href="./easyfly.webmanifest">
<link rel="icon" type="image/png" href="./easyfly-192.png">
<link rel="apple-touch-icon" href="./easyfly-192.png">
<link rel="modulepreload" crossorigin href="./assets/core.js">
<link rel="stylesheet" crossorigin href="./assets/index.css">
</head><body><script type="module" crossorigin src="./assets/index.js"></script></body></html>`;

test('build_easyfly_html: один файл без зовнішніх посилань, PWA-посилання прибрано', () => {
  assert.equal(FILE_NAME, 'EasyFLY.html');
  const out = inlinePage(PAGE, { 'assets/index.css': 'body{color:red}', 'assets/index.js': 'console.log("</script>")' });
  assert.match(out, /<style>body\{color:red\}<\/style>/);
  assert.match(out, /<script type="module">console\.log\("<\\\/script>"\)<\/script>/);
  assert.doesNotMatch(out, /manifest|apple-touch-icon|modulepreload|rel="icon"/);
  assert.deepEqual(leftoverReferences(out), []);
  assert.throws(() => inlinePage(PAGE, {}), /Missing stylesheet/);
  assert.deepEqual(leftoverReferences('<img src="./a.png"><div style="background:url(./b.webp)">').sort(), ['./a.png', './b.webp']);
});
