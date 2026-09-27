import assert from 'node:assert/strict';
import test from 'node:test';
import { readVersions, versionProblems } from '../script/release_version.mjs';
import { readFileSync } from 'node:fs';
import { buildManifest, checkedSignature, releaseFilesUrl, verifySignedFile } from '../script/update_manifest.mjs';

// A throwaway test key pair (the private half was discarded) and its
// signature of the synthetic file content 'hello\n'.
const SYNTHETIC_PUBLIC_KEY = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhFRDUyNjYwNkY5NzVERkQKUldUOVhaZHZZQ2JWanNpMUhZT3VGcnBvNG8xUUNDbDNDSFRFU1NPZHpNRWdkWFJJOGR4OHFOSC8K';
const SYNTHETIC_CONTENT = Buffer.from('hello\n');
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

test('signatures are verified against the public key, not just their format', () => {
  assert.match(verifySignedFile(SYNTHETIC_CONTENT, SYNTHETIC_SIGNATURE, SYNTHETIC_PUBLIC_KEY), /file:f\.bin/);
  assert.throws(
    () => verifySignedFile(Buffer.from('hellO\n'), SYNTHETIC_SIGNATURE, SYNTHETIC_PUBLIC_KEY),
    /не збігається/,
  );
  const ownerKey = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).plugins.updater.pubkey;
  assert.throws(() => verifySignedFile(SYNTHETIC_CONTENT, SYNTHETIC_SIGNATURE, ownerKey), /іншим ключем/);

  // Editing the trusted comment breaks the global signature.
  const lines = Buffer.from(SYNTHETIC_SIGNATURE, 'base64').toString('utf8').split('\n');
  lines[2] = lines[2].replace('file:f.bin', 'file:other.bin');
  const forged = Buffer.from(lines.join('\n')).toString('base64');
  assert.throws(() => verifySignedFile(SYNTHETIC_CONTENT, forged, SYNTHETIC_PUBLIC_KEY), /не збігається/);
});
