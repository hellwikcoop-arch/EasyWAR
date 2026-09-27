#!/usr/bin/env node
// Builds latest.json for tauri-plugin-updater from the signed release bundles.
//
//   node script/update_manifest.mjs --version 0.6.0 \
//     --files-url 'https://example.invalid/releases/{tag}/' \
//     --mac-archive EasyWAR.app.tar.gz --windows-nsis EasyWAR_0.6.0_x64-setup.exe \
//     --windows-msi EasyWAR_0.6.0_x64_en-US.msi --out latest.json
//
// Each package must have its `.sig` next to it (written by `tauri build` when
// TAURI_SIGNING_PRIVATE_KEY is set). `{tag}` and `{version}` in --files-url are
// replaced with `v<version>` and `<version>`.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function releaseFilesUrl(template, version) {
  const base = template.replaceAll('{tag}', `v${version}`).replaceAll('{version}', version);
  const url = new URL(base.endsWith('/') ? base : `${base}/`);
  if (url.protocol !== 'https:') throw new TypeError('адреса файлів оновлення має бути https://');
  return url;
}

export function checkedSignature(text, file) {
  const signature = text.trim();
  const decoded = Buffer.from(signature, 'base64').toString('utf8');
  if (!decoded.startsWith('untrusted comment:') || !decoded.includes('\ntrusted comment:')) {
    throw new TypeError(`${file}.sig не схожий на підпис minisign від tauri signer`);
  }
  return signature;
}

export function buildManifest({ version, notes, pubDate, filesUrl, mac, windowsNsis, windowsMsi }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new TypeError(`некоректна версія «${version}»`);
  const base = releaseFilesUrl(filesUrl, version);
  const entry = ({ file, signature }) => ({
    signature: checkedSignature(signature, file),
    url: new URL(encodeURIComponent(basename(file)), base).href,
  });
  const platforms = {};
  if (mac) {
    // One universal bundle serves both Apple silicon and Intel Macs.
    const macEntry = entry(mac);
    for (const arch of ['aarch64', 'x86_64']) {
      platforms[`darwin-${arch}-app`] = macEntry;
      platforms[`darwin-${arch}`] = macEntry;
    }
  }
  if (windowsNsis) {
    platforms['windows-x86_64-nsis'] = entry(windowsNsis);
    platforms['windows-x86_64'] = platforms['windows-x86_64-nsis'];
  }
  // A copy installed from the MSI keeps updating through the MSI.
  if (windowsMsi) platforms['windows-x86_64-msi'] = entry(windowsMsi);
  if (!Object.keys(platforms).length) throw new TypeError('не передано жодного пакета оновлення');
  return {
    version,
    ...(notes ? { notes } : {}),
    pub_date: pubDate,
    platforms,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      'files-url': { type: 'string' },
      'mac-archive': { type: 'string' },
      'windows-nsis': { type: 'string' },
      'windows-msi': { type: 'string' },
      'notes-file': { type: 'string' },
      out: { type: 'string', default: 'latest.json' },
    },
  });
  const signed = (file) => file && { file, signature: readFileSync(`${file}.sig`, 'utf8') };
  const manifest = buildManifest({
    version: values.version ?? '',
    notes: values['notes-file'] ? readFileSync(values['notes-file'], 'utf8').trim() : '',
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    filesUrl: values['files-url'] ?? '',
    mac: signed(values['mac-archive']),
    windowsNsis: signed(values['windows-nsis']),
    windowsMsi: signed(values['windows-msi']),
  });
  writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${values.out}: EasyWAR ${manifest.version}, платформи: ${Object.keys(manifest.platforms).join(', ')}`);
}
