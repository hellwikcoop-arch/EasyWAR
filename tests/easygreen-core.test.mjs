// EasyGreen (src/workspace/easygreen): протокол обміну з вбудованою таблицею, перевірки файлів,
// а також офлайн-збірка GridCraft (без мережевих адрес і зовнішніх скриптів) і реєстрація сторінки у Vite.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  EASYGREEN_APP_QUERY, MAX_OPEN_BYTES, OPEN_EXTENSIONS, SAVE_EXTENSIONS, cleanFileName, fileExtension, keepsWorkbook,
  openMessage, openProblem, parseFrameMessage, saveAction, saveStatus,
} from '../src/workspace/easygreen/easygreen-core.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('таблиця відкривається в режимі iframe з українським інтерфейсом', () => {
  const query = new URLSearchParams(EASYGREEN_APP_QUERY);
  assert.equal(query.get('host'), 'parent');
  assert.equal(query.get('lang'), 'uk');
});

test('розширення й перевірка файлів перед відкриттям', () => {
  assert.equal(fileExtension('Звіт.XLSX'), 'xlsx');
  assert.equal(fileExtension('без розширення'), '');
  assert.equal(fileExtension('тека.v2/файл'), '');
  assert.equal(openProblem('Звіт.xlsx', 1024), '');
  assert.equal(openProblem('дані.csv', 10), '');
  assert.match(openProblem('скрипт.exe', 10), /відкриває таблиці/);
  assert.match(openProblem('Звіт.xlsx', 0), /порожній/);
  assert.match(openProblem('Звіт.xlsx', MAX_OPEN_BYTES + 1), /завеликий/);
  assert.match(openProblem('Звіт.xlsx', Number.NaN), /порожній/);
  // Оболонка приймає до 8 розширень, латиницею й без крапки.
  assert.ok(OPEN_EXTENSIONS.length <= 8 && OPEN_EXTENSIONS.every((ext) => /^[a-z0-9]+$/.test(ext)));
  assert.ok(SAVE_EXTENSIONS.every((ext) => /^[a-z0-9]+$/.test(ext)));
});

test('назва файлу без теки й керівних символів', () => {
  assert.equal(cleanFileName('../../etc/Звіт.xlsx'), 'Звіт.xlsx');
  assert.equal(cleanFileName('C:\\Users\\x\\Звіт.xlsx'), 'Звіт.xlsx');
  assert.equal(cleanFileName('Зві\u0000т\n.xlsx'), 'Звіт.xlsx');
  assert.equal(cleanFileName('   '), 'Книга.xlsx');
  assert.equal(cleanFileName(undefined), 'Книга.xlsx');
  assert.equal(cleanFileName('а'.repeat(400)).length, 180);
});

test('повідомлення таблиці розбираються лише за протоколом', () => {
  assert.deepEqual(parseFrameMessage({ type: 'gridcraft:ready', version: '0.8.0' }), { type: 'ready', version: '0.8.0' });
  assert.deepEqual(parseFrameMessage({ type: 'gridcraft:dirty', dirty: true }), { type: 'dirty', dirty: true });
  assert.deepEqual(parseFrameMessage({ type: 'gridcraft:dirty', dirty: 'yes' }), { type: 'dirty', dirty: false });
  assert.deepEqual(parseFrameMessage({ type: 'gridcraft:failed', error: 'x'.repeat(900) }).error.length, 500);
  const bytes = new Uint8Array([80, 75]).buffer;
  assert.deepEqual(parseFrameMessage({ type: 'gridcraft:save', name: '../Звіт.xlsx', bytes }), { type: 'save', name: 'Звіт.xlsx', bytes });
  for (const bad of [null, 'gridcraft:ready', {}, { type: 'other' }, { type: 'gridcraft:open', bytes },
    { type: 'gridcraft:save', name: 'a.xlsx', bytes: new ArrayBuffer(0) }, { type: 'gridcraft:save', name: 'a.xlsx', bytes: [1, 2] }]) {
    assert.equal(parseFrameMessage(bad), null, JSON.stringify(bad));
  }
});

test('відкриття файлу й стан збереження', () => {
  const bytes = new ArrayBuffer(4);
  assert.deepEqual(openMessage('/tmp/Звіт.xlsx', bytes), { type: 'gridcraft:open', name: 'Звіт.xlsx', bytes });
  assert.equal(saveStatus('Звіт.xlsx', null), 'Збережено: Звіт.xlsx');
  assert.equal(saveStatus(null, null), 'Збереження скасовано.');
  assert.match(saveStatus(null, 'таблиця профілю'), /^Не збережено: таблиця профілю/);
});

test('«Зберегти» пише у відкритий файл лише книгу з тією самою назвою, решта — «Зберегти як…»', () => {
  const current = { handle: 'h1', name: 'Звіт.xlsx' };
  assert.deepEqual(saveAction('Звіт.xlsx', current), { kind: 'save', handle: 'h1' });
  assert.deepEqual(saveAction('Звіт.xlsx', null), { kind: 'saveAs', extensions: ['xlsx'], suggestedName: 'Звіт.xlsx' });
  assert.deepEqual(saveAction('Інша.xlsx', current), { kind: 'saveAs', extensions: ['xlsx'], suggestedName: 'Інша.xlsx' });
  // Відкрито CSV — книгу .xlsx не записуємо поверх нього.
  assert.equal(saveAction('дані.xlsx', { handle: 'h2', name: 'дані.csv' }).kind, 'saveAs');
  // Експорт не замінює книгу й не стає поточним файлом.
  assert.deepEqual(saveAction('Звіт.pdf', current), { kind: 'saveAs', extensions: ['pdf'], suggestedName: 'Звіт.pdf' });
  assert.deepEqual(saveAction('Звіт.htm', current).extensions, ['html']);
  assert.equal(saveAction('скрипт.sh', current), null);
  assert.equal(keepsWorkbook('Звіт.xlsx'), true);
  assert.equal(keepsWorkbook('Звіт.pdf'), false);
});

test('збірка GridCraft лежить локально, українською, без мережевих адрес', async () => {
  const dir = new URL('src/public/workspace/easygreen/app/', root);
  const files = await readdir(dir);
  assert.ok(files.includes('index.html'));
  const wasm = files.filter((f) => f.endsWith('_bg.wasm'));
  const js = files.filter((f) => f.endsWith('.js'));
  assert.equal(wasm.length, 1);
  assert.equal(js.length, 1);
  const html = await read('src/public/workspace/easygreen/app/index.html');
  assert.match(html, /<html lang="uk">/);
  assert.match(html, /<title>EasyGreen<\/title>/);
  assert.doesNotMatch(html, /https?:\/\//, 'сторінка таблиці не завантажує нічого з мережі');
  assert.ok(html.includes(`./${wasm[0]}`) && html.includes(`./${js[0]}`));
  const glue = await read(`src/public/workspace/easygreen/app/${js[0]}`);
  assert.doesNotMatch(glue, /\bfetch\(\s*["'`]https?:/, 'обв\'язка WASM не звертається до мережі');
  const binary = await readFile(new URL(wasm[0], dir));
  assert.ok(binary.includes(Buffer.from('Українська')), 'у збірці є український переклад');
});

test('EasyGreen підключено до «Робочого середовища» за контрактом 1', async () => {
  const entry = await read('src/workspace/easygreen/app.js');
  assert.match(entry, /export const contract = 1;/);
  assert.match(entry, /export async function mount\(container, host\)/);
  assert.match(entry, /host\.resolve\('workspace\/easygreen\/app\/index\.html'\)/);
  const panel = await read('src/workspace/easygreen/easygreen-panel.js');
  for (const call of ['host.openFile(', 'host.saveFile(', 'host.saveFileAs(', 'host.closeFile(', 'host.setDirty(', 'host.setTitle(']) {
    assert.ok(panel.includes(call), call);
  }
  // Закриття й питання про незбережені зміни — на оболонці; прямих викликів Tauri в панелі немає.
  assert.doesNotMatch(panel, /window\.confirm|__TAURI|invoke\(/);
  const config = await read('vite.config.js');
  // Таблиця (≈19 МБ WASM) не потрапляє в офлайн-кеш телефона.
  assert.ok(config.includes('!/(^|\\/)workspace[-/]/.test(rel)') && config.includes('!name.endsWith(".wasm")'));
});
