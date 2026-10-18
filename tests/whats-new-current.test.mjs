// Збірний src/whats-new/releases.json має відповідати нотаткам у docs/releases (як індекс довідки помічника).
// Якщо тест падає: node script/whats_new.mjs і закомітити оновлений файл.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compile } from '../script/whats_new.mjs';
import { UNPUBLISHED_VERSIONS, compareVersions, isVersion } from '../src/whats-new-core.js';

const root = new URL('../', import.meta.url);

test('releases.json згенеровано з поточних нотаток docs/releases', async () => {
  const shipped = await readFile(new URL('src/whats-new/releases.json', root), 'utf8');
  assert.equal(shipped, await compile(), 'src/whats-new/releases.json застарів; запустіть node script/whats_new.mjs');
});

test('releases.json: схема 1, версії унікальні й від найновішої, неопублікованих немає', async () => {
  const { schema, releases } = JSON.parse(await readFile(new URL('src/whats-new/releases.json', root), 'utf8'));
  assert.equal(schema, 1);
  assert.ok(releases.length > 0);
  const versions = releases.map((release) => release.version);
  assert.ok(versions.every(isVersion));
  assert.equal(new Set(versions).size, versions.length, 'версії не повторюються');
  for (let index = 1; index < versions.length; index += 1) {
    assert.ok(compareVersions(versions[index - 1], versions[index]) > 0, `${versions[index - 1]} йде перед ${versions[index]}`);
  }
  for (const unpublished of UNPUBLISHED_VERSIONS) assert.ok(!versions.includes(unpublished), `${unpublished} не публікувалась`);
});

test('найновіший випуск у releases.json — це версія застосунку з package.json', async () => {
  // Випуск без нотаток означав би, що користувач бачить на екрані «Що нового» не ту версію, яку встановив.
  const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const { releases } = JSON.parse(await readFile(new URL('src/whats-new/releases.json', root), 'utf8'));
  assert.equal(releases[0].version, version, 'додайте docs/releases/vX.Y.Z.md для поточної версії і запустіть node script/whats_new.mjs');
});
