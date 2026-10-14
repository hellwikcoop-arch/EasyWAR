import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LITE_FILE, LITE_MODULES, assembleLite } from '../script/build_lite.mjs';
import { isStandaloneHtml } from '../src/phone-export-core.js';
import {
  LITE_ASSET_URL,
  LITE_BUTTON_LABEL,
  LITE_BUTTON_TITLE,
  LITE_FILE_NAME,
  LITE_UNAVAILABLE,
  isLiteHtml,
  liteExportDownloadedMessage,
  liteExportErrorMessage,
  liteExportSavedMessage,
} from '../src/lite-export-core.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the file name and the embedded resource address are the ones the build script writes', () => {
  assert.equal(LITE_FILE_NAME, LITE_FILE);
  assert.equal(LITE_FILE_NAME, 'EasyWAR-Lite.html');
  assert.equal(LITE_ASSET_URL, './standalone/EasyWAR-Lite.html');
});

test('only the lite build counts as the lite file, not a dashboard file or the fallback index.html', () => {
  const page = (name) => `<!DOCTYPE html>\n<html lang="uk"><head><title>${name}</title></head><body></body></html>`;
  const built = assembleLite({ launcher: page('l'), modules: Object.fromEntries(LITE_MODULES.map((id) => [id, page(id)])), version: '1.2.3' });
  assert.equal(isLiteHtml(built.slice(0, 600)), true, 'marker written by build_lite.mjs is read by the frontend');
  assert.equal(isStandaloneHtml(built.slice(0, 600)), true, 'and by the shared standalone check');
  assert.equal(isLiteHtml('<!doctype html>\n<!-- EasyWAR 0.9.6 standalone: автономний файл, працює без інтернету -->\n<html>'), false);
  assert.equal(isLiteHtml('<!doctype html><html><title>launcher</title>'), false);
  assert.equal(isLiteHtml(''), false);
  assert.equal(isLiteHtml(null), false);
  assert.equal(isLiteHtml(`${' '.repeat(600)} standalone: lite`), false);
});

test('messages say where the file is and how to use it; errors stay readable', () => {
  const saved = liteExportSavedMessage('/home/user/EasyWAR-Lite.html');
  assert.equal(saved.kind, 'ok');
  assert.match(saved.text, /Lite-версію збережено: \/home\/user\/EasyWAR-Lite\.html/);
  assert.match(saved.text, /Chrome/);
  assert.match(saved.text, /Відкрити таблицю/);
  assert.match(saved.text, /дані з цього застосунку у файл не потрапляють/);
  const downloaded = liteExportDownloadedMessage();
  assert.equal(downloaded.kind, 'ok');
  assert.match(downloaded.text, /\(EasyWAR-Lite\.html\) завантажено/);
  assert.deepEqual(liteExportErrorMessage('Не вдалося зберегти файл: disk full'), { kind: 'error', text: 'Не вдалося зберегти файл: disk full' });
  assert.deepEqual(liteExportErrorMessage(new Error('boom')), { kind: 'error', text: 'boom' });
  assert.deepEqual(liteExportErrorMessage(new Error(LITE_UNAVAILABLE)), { kind: 'error', text: 'Lite-версія недоступна в цій збірці.' });
  assert.match(liteExportErrorMessage(null).text, /Не вдалося отримати lite-версію/);
  assert.match(LITE_BUTTON_LABEL, /Lite/);
  assert.match(LITE_BUTTON_TITLE, /без довідників із моделями/);
});

test('the marker and the resource path agree between the build script, the frontend and Rust', async () => {
  const rust = await read('src-tauri/src/lite_export.rs');
  const build = await read('script/build_lite.mjs');
  assert.ok(build.includes('standalone: lite-версія'), 'build script writes the lite marker');
  assert.ok(rust.includes('b" standalone: lite"'), 'Rust looks for the same marker');
  assert.ok(rust.includes(`"standalone/${LITE_FILE_NAME}"`), 'Rust reads the resource the build script writes into dist/standalone');
  assert.ok(rust.includes(`"${LITE_FILE_NAME}"`));
});

test('the start screen button is wired in the browser and in the desktop shell', async () => {
  assert.match(await read('src/launcher-tools.js'), /import '\.\/lite-export\.js';/);
  const ui = await read('src/lite-export.js');
  assert.match(ui, /invoke\('export_lite_file'\)/);
  assert.match(ui, /document\.querySelector\('\.appbar-right'\)/);
  assert.match(ui, /fetch\(LITE_ASSET_URL\)/, 'outside the desktop shell the file is a normal resource next to the page');
  assert.match(ui, /!isLiteHtml\(/, 'the fallback index.html must never be saved as the lite file');
  const lib = await read('src-tauri/src/lib.rs');
  assert.match(lib, /async fn export_lite_file\(/);
  assert.match(lib, /^\s+export_lite_file,$/m);
  assert.match(lib, /lite_export::is_lite_html/);
  const conf = JSON.parse(await read('src-tauri/tauri.conf.json'));
  assert.equal(conf.build.beforeBuildCommand, 'npm run build:app', 'the desktop build runs the script that writes dist/standalone/EasyWAR-Lite.html');
  assert.equal(JSON.parse(await read('src-tauri/capabilities/default.json')).permissions.length, 1, 'no new Tauri permissions for the lite export');
});

test('lite does not ship the desktop-only tools, so its own page has no download button', async () => {
  const build = await read('script/build_lite.mjs');
  assert.match(build, /'launcher-tools\.js': 'export \{\};/);
});
