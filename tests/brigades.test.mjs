import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { BRANCHES, BRIGADES, TYPES } from '../src/guides/brigades/brigades-data.js';
import { branchCounts, filterBrigades, purposeOf, shortName } from '../src/guides/brigades/brigades-core.js';

test('довідник бригад: унікальні id, відомі типи й роди військ, емблема існує', async () => {
  assert.equal(new Set(BRIGADES.map(b => b.id)).size, BRIGADES.length);
  const files = new Set([
    ...(await readdir(new URL('../src/unit-art/', import.meta.url))).map(f => f.replace(/\.webp$/, '')),
    ...(await readdir(new URL('../src/guides/brigades/art/', import.meta.url))).map(f => f.replace(/\.webp$/, '')),
  ]);
  for (const b of BRIGADES) {
    assert.ok(TYPES[b.type], b.id);
    assert.ok(b.branch === null || BRANCHES[b.branch], b.id);
    assert.ok(files.has(b.art), `емблема ${b.art}`);
  }
});

test('назви, пошук і фільтр за родом військ', () => {
  const b79 = BRIGADES.find(b => b.id === '79-odshbr');
  assert.equal(shortName(b79), '79 ОДШБр');
  assert.deepEqual(filterBrigades(BRIGADES, { query: 'таврій' }).map(b => b.id), ['79-odshbr']);
  assert.deepEqual(filterBrigades(BRIGADES, { query: 'херсон' }).map(b => b.id), ['11-obraa']);
  assert.deepEqual(filterBrigades(BRIGADES, { query: '' }).length, BRIGADES.length);
  assert.ok(filterBrigades(BRIGADES, { branch: 'aa' }).every(b => b.branch === 'aa'));
  assert.ok(filterBrigades(BRIGADES, { branch: 'none' }).every(b => !b.branch));
  assert.ok(BRIGADES.every(b => purposeOf(b)));
  const c = branchCounts(BRIGADES);
  assert.equal(c[''], BRIGADES.length);
  assert.equal(c.sv + c.dshv + c.rvia + c.aa + c.none, BRIGADES.length);
});
