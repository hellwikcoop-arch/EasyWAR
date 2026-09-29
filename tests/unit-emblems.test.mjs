import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Built-in unit emblems in both modules and the army aviation emblem on the
// start screen. Names in the tables are matched through unitKey, so spelling
// variants of the same unit must reach the same emblem.

const BRIGADES = ['11 ОБрАА', '12 ОБрАА', '16 ОБрАА', '18 ОБрАА'];

async function emblems(file) {
  const html = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const start = html.indexOf('const EMB = {');
  const end = html.indexOf('\nfunction emblem(', start);
  assert.ok(start !== -1 && end !== -1, `${file}: emblem table must exist`);
  const context = {};
  vm.runInNewContext(`${html.slice(start, end)}\nthis.EMB = EMB; this.EMBK = EMBK; this.unitKey = unitKey;`, context);
  return context;
}

for (const file of ['air.html', 'rocket.html']) {
  test(`${file}: army aviation brigades have built-in emblems`, async () => {
    const { EMB, EMBK, unitKey } = await emblems(file);
    for (const unit of BRIGADES) {
      assert.match(EMB[unit] || '', /^data:image\/webp;base64,/, unit);
      assert.equal(EMBK[unitKey(unit)], EMB[unit], unit);
    }
    assert.equal(EMBK[unitKey('11 обрАА')], EMB['11 ОБрАА'], 'case does not matter');
    assert.equal(EMBK[unitKey('16 OБpAA')], EMB['16 ОБрАА'], 'Latin look-alike letters are folded to Cyrillic');
    assert.ok(EMB['79 ОДШБр'], 'the earlier emblems stay');
  });
}

test('the army aviation card on the start screen shows the emblem', async () => {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('data-soon="army-aviation"');
  assert.notEqual(start, -1);
  const icon = html.slice(start, html.indexOf('</div>', html.indexOf('class="bc-icon"', start)));
  assert.match(icon, /<img alt="" src="data:image\/webp;base64,/);
  assert.doesNotMatch(icon, /<svg/);
});
