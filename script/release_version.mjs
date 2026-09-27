#!/usr/bin/env node
// Checks that every place that carries the EasyWAR version agrees, and that a
// release tag (vX.Y.Z) names that same version. The updater compares the
// version inside the installed app with latest.json, so a mismatch would make
// an update loop or never offer itself.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

export function readVersions(readText = read) {
  const packageJson = JSON.parse(readText('package.json'));
  const packageLock = JSON.parse(readText('package-lock.json'));
  const tauriConf = JSON.parse(readText('src-tauri/tauri.conf.json'));
  const cargoToml = readText('src-tauri/Cargo.toml');
  const cargoLock = readText('src-tauri/Cargo.lock');
  return {
    'package.json': packageJson.version,
    'package-lock.json': packageLock.packages?.['']?.version,
    'src-tauri/tauri.conf.json': tauriConf.version,
    'src-tauri/Cargo.toml': cargoToml.match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m)?.[1],
    'src-tauri/Cargo.lock': cargoLock.match(/\[\[package\]\]\nname = "easywar"\nversion = "([^"]+)"/)?.[1],
  };
}

export function versionProblems(versions, tag = '') {
  const problems = [];
  const expected = versions['package.json'];
  if (!/^\d+\.\d+\.\d+$/.test(expected ?? '')) {
    problems.push(`package.json: версія «${expected}» має бути у форматі X.Y.Z`);
  }
  for (const [file, version] of Object.entries(versions)) {
    if (version !== expected) problems.push(`${file}: ${version ?? 'версію не знайдено'} ≠ ${expected}`);
  }
  if (tag && tag !== `v${expected}`) {
    problems.push(`тег ${tag} не збігається з версією застосунку v${expected}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '';
  const versions = readVersions();
  const problems = versionProblems(versions, tag);
  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log(`EasyWAR ${versions['package.json']}${tag ? ` (тег ${tag})` : ''}: версії узгоджені.`);
}
