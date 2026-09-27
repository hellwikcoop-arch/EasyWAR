import assert from 'node:assert/strict';
import test from 'node:test';
import { readVersions, versionProblems } from '../script/release_version.mjs';
import { buildManifest, checkedSignature, releaseFilesUrl } from '../script/update_manifest.mjs';

// Signature of a synthetic file made with a throwaway test key.
const SYNTHETIC_SIGNATURE = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUOVhaZHZZQ2JWanBSdlc1b1dOSVZDT1VIMURzMG9UVkIvZGlxS0VwZjArRGxMNzM5ZWQ1WFo5V1l5R3N3MFJqMHlOYWpZRUs0Z2creFNRTjdpTEo2VEFDQTFPVTZRZWcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwNDk2NjI5CWZpbGU6Zi5iaW4KcnJKZzZZNTdHQXNMZm1RQWwvYmJtMnlLVitlZmpnTkFPeTgvZDBPMkdPSG9WYnJLTW5FeVg5K3laYVVFOVBCV1JkUmtzN1dwMUpOVEFqSEVmT1MyQlE9PQo=';

test('repository version files agree', () => {
  assert.deepEqual(versionProblems(readVersions()), []);
});

test('version check reports each mismatching file and a wrong tag', () => {
  const versions = {
    'package.json': '0.6.0',
    'package-lock.json': '0.6.0',
    'src-tauri/tauri.conf.json': '0.5.0',
    'src-tauri/Cargo.toml': '0.6.0',
    'src-tauri/Cargo.lock': undefined,
  };
  const problems = versionProblems(versions, 'v0.6.1');
  assert.equal(problems.length, 3);
  assert.match(problems[0], /tauri\.conf\.json: 0\.5\.0 ≠ 0\.6\.0/);
  assert.match(problems[1], /Cargo\.lock: версію не знайдено/);
  assert.match(problems[2], /тег v0\.6\.1/);
  assert.deepEqual(versionProblems({ ...versions, 'src-tauri/tauri.conf.json': '0.6.0', 'src-tauri/Cargo.lock': '0.6.0' }, 'v0.6.0'), []);
});

test('update manifest maps every platform key the updater looks up', () => {
  const manifest = buildManifest({
    version: '0.6.0',
    notes: 'Синтетичний опис.',
    pubDate: '2026-09-27T08:00:00Z',
    filesUrl: 'https://updates.example.invalid/easywar/{tag}',
    mac: { file: 'bundle/macos/EasyWAR.app.tar.gz', signature: SYNTHETIC_SIGNATURE },
    windowsNsis: { file: 'bundle/nsis/EasyWAR_0.6.0_x64-setup.exe', signature: SYNTHETIC_SIGNATURE },
    windowsMsi: { file: 'bundle/msi/EasyWAR_0.6.0_x64_en-US.msi', signature: SYNTHETIC_SIGNATURE },
  });
  assert.equal(manifest.version, '0.6.0');
  assert.equal(manifest.notes, 'Синтетичний опис.');
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    'darwin-aarch64', 'darwin-aarch64-app', 'darwin-x86_64', 'darwin-x86_64-app',
    'windows-x86_64', 'windows-x86_64-msi', 'windows-x86_64-nsis',
  ]);
  assert.equal(manifest.platforms['darwin-aarch64-app'].url, 'https://updates.example.invalid/easywar/v0.6.0/EasyWAR.app.tar.gz');
  assert.equal(manifest.platforms['windows-x86_64'].url, 'https://updates.example.invalid/easywar/v0.6.0/EasyWAR_0.6.0_x64-setup.exe');
  assert.equal(manifest.platforms['windows-x86_64-msi'].url, 'https://updates.example.invalid/easywar/v0.6.0/EasyWAR_0.6.0_x64_en-US.msi');
  assert.equal(manifest.platforms['windows-x86_64-nsis'].signature, SYNTHETIC_SIGNATURE);
});

test('update manifest refuses plain http, bad versions and non-signature files', () => {
  assert.throws(() => releaseFilesUrl('http://updates.example.invalid/{tag}/', '0.6.0'), /https/);
  assert.throws(() => buildManifest({ version: 'v0.6', filesUrl: 'https://x.invalid/', mac: { file: 'a', signature: SYNTHETIC_SIGNATURE } }), /версія/);
  assert.throws(() => checkedSignature(Buffer.from('not a signature').toString('base64'), 'a'), /minisign/);
  assert.throws(() => buildManifest({ version: '0.6.0', filesUrl: 'https://x.invalid/' }), /жодного/);
});
