import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Munition names from the tables must reach the right built-in pictures in the
// «Повітряні Сили» dashboard: AASM has its own drawings and no longer borrows
// the GBU-64 ones.

const html = await readFile(new URL('../src/air.html', import.meta.url), 'utf8');

function munKey() {
  const start = html.indexOf('function munKey(m) {');
  assert.notEqual(start, -1, 'munKey must exist');
  const end = html.indexOf('\n}\n', start) + 2;
  return vm.runInNewContext(`(${html.slice(start, end)})`);
}

function builtinKeys(map) {
  const found = new Set();
  const literal = new RegExp(`const ${map} = \\{(.*?)\\};\\n`).exec(html);
  if (literal) for (const [, key] of literal[1].matchAll(/"([\w]+)": "data:/g)) found.add(key);
  for (const [, body] of html.matchAll(new RegExp(`Object\\.assign\\(${map}, \\{(.*?)\\}\\);\\n`, 'g'))) {
    for (const [, key] of body.matchAll(/["']([\w]+)["']: /g)) found.add(key);
  }
  return found;
}

test('munition names from the tables map to their built-in keys', () => {
  const key = munKey();
  const cases = {
    'AASM-250': 'aasm', 'AASM Hammer': 'aasm', 'GBU-64': '64', 'AGM-88': 'agm88', 'AGM-88 HARM': 'agm88',
    'BLU-140': 'blu140', 'BLU-140/B': 'blu140', 'С-13': 'c13', 'C-13': 'c13', 'С-13ОФ': 'c13', 'S-13': 'c13',
    'GBU-53/B': '53', 'GBU-39': '39', 'GBU-62': '62', 'С-8': '', 'ОФАБ-250': '', 'С-130': '', '': '',
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(key(name), expected, name);
});

test('each new munition has a thumbnail, a caption, a breakdown picture and a mission-card picture', () => {
  const thumbs = builtinKeys('MUN_IMG'), info = builtinKeys('MUN_INFO'), images = builtinKeys('IMG'), weapons = builtinKeys('WEAPONS');
  for (const key of ['aasm', 'agm88', '53', 'blu140', 'c13']) {
    assert.ok(thumbs.has(key), `MUN_IMG.${key}`);
    assert.ok(info.has(key), `MUN_INFO.${key}`);
    assert.ok(images.has(`mun_${key}`), `IMG.mun_${key}`);
    assert.ok(weapons.has(`all_${key}`), `WEAPONS.all_${key}`);
  }
  assert.ok(!thumbs.has('64'), 'GBU-64 keeps only its carrier pictures');
});
