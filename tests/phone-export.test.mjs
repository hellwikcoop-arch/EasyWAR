import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  EMBED_TABLE_WARNING,
  PHONE_FILES,
  STANDALONE_MARKER,
  isStandaloneHtml,
  phoneAssetUrl,
  phoneExportDownloadedMessage,
  phoneExportErrorMessage,
  phoneExportSavedMessage,
  phoneFile,
} from '../src/phone-export-core.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('each command tile maps to its own file and embedded resource', () => {
  assert.deepEqual(Object.keys(PHONE_FILES), ['pvk', 'dshv']);
  assert.equal(phoneFile('dshv').fileName, 'EasyWAR-UDSHV.html');
  assert.equal(phoneFile('pvk').fileName, 'EasyWAR-PVK.html');
  assert.equal(phoneAssetUrl('dshv'), './standalone/EasyWAR-UDSHV.html');
  assert.throws(() => phoneFile('air'), /Невідоме командування/);
});

test('only pages built by the standalone script count as phone files', () => {
  assert.equal(isStandaloneHtml('<!doctype html>\n<!-- EasyWAR 0.9.6 standalone: автономний файл -->\n<html>'), true);
  assert.equal(isStandaloneHtml('<!doctype html><html><title>launcher</title>'), false);
  assert.equal(isStandaloneHtml(''), false);
  assert.equal(isStandaloneHtml(null), false);
  assert.equal(isStandaloneHtml(`${' '.repeat(600)}${STANDALONE_MARKER}`), false);
});

test('the marker is the same in the build script, the frontend and the Rust check', async () => {
  const build = await read('script/build_standalone.mjs');
  const rust = await read('src-tauri/src/phone_export.rs');
  assert.ok(build.includes(`EasyWAR \${version}${STANDALONE_MARKER} `), 'build script must write the marker');
  assert.ok(rust.includes(`b"${STANDALONE_MARKER}"`), 'Rust must look for the same marker');
});

test('messages tell the user what to do next and keep errors readable', () => {
  const saved = phoneExportSavedMessage('dshv', '/home/user/EasyWAR-UDSHV.html');
  assert.equal(saved.kind, 'ok');
  assert.match(saved.text, /УДШВ збережено: \/home\/user\/EasyWAR-UDSHV\.html/);
  assert.match(saved.text, /Chrome/);
  assert.match(phoneExportDownloadedMessage('pvk').text, /ПВК \(EasyWAR-PVK\.html\) завантажено/);
  assert.deepEqual(phoneExportErrorMessage('Не вдалося зберегти файл: disk full'), { kind: 'error', text: 'Не вдалося зберегти файл: disk full' });
  assert.deepEqual(phoneExportErrorMessage(new Error('boom')), { kind: 'error', text: 'boom' });
  assert.equal(phoneExportErrorMessage(undefined).kind, 'error');
  assert.match(phoneExportErrorMessage(null).text, /Не вдалося створити файл/);
});

test('launcher wires the button on both command tiles and the desktop build ships the files', async () => {
  const html = await read('src/index.html');
  assert.equal((html.match(/data-act="phone"/g) || []).length, 2);
  assert.equal((html.match(/data-role="note"/g) || []).length, 2);
  assert.match(await read('src/launcher-tools.js'), /import '\.\/phone-export\.js';/);
  const conf = JSON.parse(await read('src-tauri/tauri.conf.json'));
  assert.equal(conf.build.beforeBuildCommand, 'npm run build:app');
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.scripts['build:app'], 'vite build && node script/build_standalone.mjs --out dist/standalone');
  const lib = await read('src-tauri/src/lib.rs');
  assert.match(lib, /async fn export_phone_file\(/);
  assert.match(lib, /^\s+export_phone_file,$/m);
});

test('a file with an embedded table says so, warns about the data and stays a snapshot', () => {
  const saved = phoneExportSavedMessage('dshv', '/home/user/EasyWAR-UDSHV-2026-10-01.html', 'УДШВ.xlsx');
  assert.equal(saved.kind, 'ok');
  assert.match(saved.text, /УДШВ із таблицею «УДШВ\.xlsx» збережено: \/home\/user\/EasyWAR-UDSHV-2026-10-01\.html/);
  assert.match(saved.text, /захищеним каналом/);
  assert.doesNotMatch(saved.text, /Відкрити таблицю/, 'the table is already inside; no need to pick it on the phone');
  assert.match(EMBED_TABLE_WARNING, /знімок на день збереження/);
});

test('the embed checkbox sits on both tiles and is enabled only while a table is bound', async () => {
  const html = await read('src/index.html');
  assert.equal((html.match(/data-role="embed" disabled/g) || []).length, 2, 'off and disabled until a table is bound');
  assert.doesNotMatch(html, /data-role="embed"[^>]*checked/, 'embedding data is never the default');
  const profiles = await read('src/local-profiles.js');
  assert.match(profiles, /embed\.disabled = !path;/);
  assert.match(profiles, /if \(!path\) embed\.checked = false;/);
  const script = await read('src/phone-export.js');
  assert.match(script, /invoke\('export_phone_file', \{ dashboard: command, withTable \}\)/);
  assert.match(script, /embed\.checked && !embed\.disabled/);
  const rust = await read('src-tauri/src/lib.rs');
  assert.match(rust, /with_table: Option<bool>/);
  assert.match(rust, /\.set_file_name\(default_name\)/);
});
