import assert from 'node:assert/strict';
import test from 'node:test';
import { access } from 'node:fs/promises';
import { OUTFITS, outfitForBranch } from '../src/assistant/assistant-outfit-core.js';

test('кожен модуль має свій одяг КОМБАТ, інше — базовий образ', () => {
  assert.equal(outfitForBranch('air'), 'pilot');
  assert.equal(outfitForBranch('pvk'), 'dress');
  assert.equal(outfitForBranch('dshv'), 'dshv');
  assert.equal(outfitForBranch('rocket'), 'rocket');
  assert.equal(outfitForBranch('artillery'), 'artillery');
  for (const value of [undefined, null, '', 'start', 'constructor', '__proto__', 42]) assert.equal(outfitForBranch(value), 'default');
});

test('для кожного одягу є файл портрета', async () => {
  for (const id of OUTFITS.filter(item => item !== 'default')) {
    await access(new URL(`../src/assistant/assets/colonel-outfit-${id}.webp`, import.meta.url));
  }
});

import { outfitFor } from '../src/assistant/assistant-outfit-core.js';
test('у відкритому довіднику КОМБАТ — лектор, але не на стартовому екрані', () => {
  for (const branch of ['air', 'pvk', 'dshv', 'rocket', 'artillery']) {
    assert.equal(outfitFor(branch, true), 'lecturer');
    assert.notEqual(outfitFor(branch, false), 'lecturer');
  }
  assert.equal(outfitFor(undefined, true), 'default');
  assert.equal(outfitFor('air', 'yes'), 'pilot');
});

import { readFile } from 'node:fs/promises';
test('жести нестандартного одягу: прозорі анімовані WebP 384×576 по 20 кадрів', async () => {
  const names = [];
  for (const outfit of ['pilot', 'dress', 'dshv', 'rocket', 'artillery', 'lecturer']) names.push(`${outfit}-nod`, `${outfit}-shake`);
  names.push('lecturer-point');
  for (const name of names) {
    const data = await readFile(new URL(`../src/assistant/assets/colonel-${name}.webp`, import.meta.url));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF', name);
    assert.equal(data.toString('ascii', 8, 12), 'WEBP', name);
    const flags = data.indexOf('VP8X') + 8;
    assert.ok(data.indexOf('VP8X') > 0 && (data[flags] & 0x12) === 0x12, `${name}: альфа й анімація`);
    assert.equal(data.readUIntLE(flags + 4, 3) + 1, 384, name);
    assert.equal(data.readUIntLE(flags + 7, 3) + 1, 576, name);
    assert.equal(data.toString('latin1').split('ANMF').length - 1, 20, `${name}: 20 кадрів`);
  }
});
