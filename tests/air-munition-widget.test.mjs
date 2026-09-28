import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// The munition widget in the «Повітряні Сили» mission card draws a schematic
// from a small shape table. Every munition name must land on a drawable shape,
// and only the munitions that really unfold wings get the wing animation.

const html = await readFile(new URL('../src/air.html', import.meta.url), 'utf8');

function slice(from, to) {
  const start = html.indexOf(from);
  assert.notEqual(start, -1, from);
  const end = html.indexOf(to, start);
  assert.notEqual(end, -1, to);
  return html.slice(start, end);
}

function widget() {
  const munKey = slice('function munKey(m) {', '\n}\n') + '\n}\n';
  const shapes = slice('const MW_Y = ', 'function mwFins(');
  const context = {};
  vm.runInNewContext(`${munKey}${shapes}\nthis.MW_SPEC = MW_SPEC; this.mwSpec = mwSpec; this.mwBody = mwBody;`, context);
  return context;
}

test('every shape outline is a closed path of finite numbers inside the drawing', () => {
  const { MW_SPEC, mwBody } = widget();
  for (const [key, spec] of Object.entries(MW_SPEC)) {
    const d = mwBody(spec);
    assert.match(d, /^M[\d.]+,[\d.]+ C.*Z$/, key);
    const numbers = d.match(/-?[\d.]+/g).map(Number);
    assert.ok(numbers.every(Number.isFinite), `${key}: finite coordinates`);
    assert.ok(numbers.every(n => n >= 0 && n <= 400), `${key}: inside the 400-unit view box`);
  }
});

test('munition names pick the right schematic', () => {
  const { MW_SPEC, mwSpec } = widget();
  assert.equal(mwSpec('GBU-39'), MW_SPEC['39']);
  assert.equal(mwSpec('GBU-53/B'), MW_SPEC['53']);
  assert.equal(mwSpec('GBU-62'), MW_SPEC['62']);
  assert.equal(mwSpec('AGM-88 HARM'), MW_SPEC.agm88);
  assert.equal(mwSpec('С-13'), MW_SPEC.c13);
  assert.equal(mwSpec('С-8'), MW_SPEC.c13, 'other unguided rockets use the rocket outline');
  assert.equal(mwSpec('Hydra-70'), MW_SPEC.c13);
  assert.equal(mwSpec('ОФАБ-250'), MW_SPEC.bomb);
  assert.equal(mwSpec('GBU-65'), MW_SPEC.bomb, 'unknown guided bombs fall back to the plain bomb');
  assert.equal(mwSpec(''), MW_SPEC.bomb);
});

test('only munitions with deployable wings animate wings', () => {
  const { MW_SPEC } = widget();
  const winged = Object.entries(MW_SPEC).filter(([, s]) => s.wing || s.kit).map(([k]) => k).sort();
  assert.deepEqual(winged, ['39', '53', '62', '64']);
});

test('the mission card shows the widget and the motion switch can stop it', () => {
  assert.match(html, /const hud = munHud\(r, coord\)/);
  assert.match(html, /dialog\.pass\[open\] \.mw-wing \{ animation: mwWing /);
  assert.match(html, /html\[data-motion="off"\] \*, html\[data-motion="off"\] \*::before/);
  assert.match(html, /@media print \{ \.pass-hud \{ display: none; \} \}/);
});
