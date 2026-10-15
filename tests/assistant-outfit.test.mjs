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
