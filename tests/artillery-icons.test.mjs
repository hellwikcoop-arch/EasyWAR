import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { AMMO_BY_GROUP, ammoFile, chargeIconFile } from '../src/artillery-icons-core.js';

const art = file => existsSync(new URL(`../src/ammo-art/${file}.webp`, import.meta.url));

test('every group icon and the generic one exist in src/ammo-art', () => {
  for (const [group, file] of Object.entries(AMMO_BY_GROUP)) assert.ok(art(file), `${group} → ${file}`);
  assert.ok(art(ammoFile('невідомий калібр')));
  assert.equal(ammoFile('невідомий калібр'), 'other');
  assert.equal(ammoFile('Заряди'), 'charge-bmcs');
});

test('chargeIconFile picks the charge by label, in Latin or Cyrillic letters', () => {
  const cases = {
    '155мм М3А1': 'charge-m3a1', '155мм M3A1': 'charge-m3a1', 'М4А1': 'charge-m4a2', 'M4A2': 'charge-m4a2',
    'М119А1': 'charge-m119a2', 'M119A2': 'charge-m119a2', 'M203': 'charge-m203a1', 'М203А1': 'charge-m203a1',
    'DM 92': 'charge-bmcs', 'TC-F': 'charge-bmcs', 'BMCS': 'charge-bmcs', 'заряд повний': 'charge-bmcs', '': 'charge-bmcs',
  };
  for (const [label, file] of Object.entries(cases)) assert.equal(chargeIconFile(label), file, label);
  assert.equal(chargeIconFile(undefined), 'charge-bmcs');
});

test('every charge icon exists', () => {
  for (const label of ['M3A1', 'M4A2', 'M119A2', 'M203A1', 'DM 92']) assert.ok(art(chargeIconFile(label)), label);
});
