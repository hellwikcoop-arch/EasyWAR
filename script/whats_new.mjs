// Генерує src/whats-new/releases.json з docs/releases/vX.Y.Z.md для екрана «Що нового».
// Використання: node script/whats_new.mjs [--check]
// Після нового docs/releases/vX.Y.Z.md запустіть без аргументів і закомітьте оновлений releases.json;
// `--check` (і tests/whats-new-current.test.mjs) падає, якщо файл відстає від нотаток.
import { readFile, readdir, writeFile, mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { UNPUBLISHED_VERSIONS, isVersion, newestFirst, parseReleaseNotes } from '../src/whats-new-core.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releasesDir = resolve(projectRoot, 'docs/releases');
const outputPath = resolve(projectRoot, 'src/whats-new/releases.json');

export async function compile() {
  if (await realpath(releasesDir) !== releasesDir) throw new Error('Каталог docs/releases не може бути символічним посиланням');
  const releases = [];
  for (const name of (await readdir(releasesDir)).sort()) {
    const match = /^v(\d+\.\d+\.\d+)\.md$/u.exec(name);
    if (!match || !isVersion(match[1]) || UNPUBLISHED_VERSIONS.includes(match[1])) continue;
    releases.push(parseReleaseNotes(await readFile(resolve(releasesDir, name), 'utf8'), match[1]));
  }
  if (releases.length === 0) throw new Error('У docs/releases немає жодних нотаток vX.Y.Z.md');
  releases.sort(newestFirst);
  return `${JSON.stringify({ schema: 1, releases }, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--check') || args.length > 1) throw new Error('Використання: node script/whats_new.mjs [--check]');
    const expected = await compile();
    if (args.includes('--check')) {
      let actual;
      try { actual = await readFile(outputPath, 'utf8'); } catch (error) {
        if (error.code === 'ENOENT') throw new Error('src/whats-new/releases.json відсутній; запустіть node script/whats_new.mjs');
        throw error;
      }
      if (actual !== expected) throw new Error('src/whats-new/releases.json застарів; запустіть node script/whats_new.mjs');
      console.log('«Що нового»: releases.json відповідає нотаткам у docs/releases.');
    } else {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, expected);
      console.log(`«Що нового»: записано ${outputPath.replace(`${projectRoot}/`, '')}.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
