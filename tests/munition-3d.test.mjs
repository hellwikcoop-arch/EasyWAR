import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { Box3, Vector3 } from 'three';
import { KINDS, buildModel } from '../src/munition-3d.js';

// The 3D models in the «Повітряні Сили» mission card are built from primitives.
// Every kind the card can ask for must build, have the common length, and only
// the munitions with deployable wings may carry wings.

const html = await readFile(new URL('../src/air.html', import.meta.url), 'utf8');

function cardKinds() {
  const start = html.indexOf('const MW_SPEC = {');
  const end = html.indexOf('\n};\n', start) + 4;
  const context = {};
  vm.runInNewContext(`${html.slice(start, end)}\nthis.keys = Object.keys(MW_SPEC);`, context);
  return context.keys;
}

const size = group => new Box3().setFromObject(group).getSize(new Vector3());

test('every shape the mission card asks for has a 3D model', () => {
  assert.deepEqual([...cardKinds()].sort(), [...KINDS].sort());
});

test('models share the common length and have finite geometry', () => {
  for (const kind of KINDS) {
    const { group } = buildModel(kind);
    const s = size(group);
    assert.ok([s.x, s.y, s.z].every(Number.isFinite), `${kind}: finite size`);
    assert.ok(s.x > 3.9 && s.x < 4.3, `${kind}: length ${s.x.toFixed(2)}`);
    assert.ok(s.y < 1.4 && s.z < 1.4, `${kind}: folded model stays slender`);
  }
});

test('only GBU-39/53/62/64 unfold wings, and unfolded wings widen the model', () => {
  for (const kind of KINDS) {
    const { group, wings } = buildModel(kind);
    const winged = ['39', '53', '62', '64'].includes(kind);
    assert.equal(wings.length, winged ? 2 : 0, kind);
    if (!winged) continue;
    const folded = size(group).z;
    for (const [mesh, angle] of wings) mesh.rotation.y = angle;
    group.updateMatrixWorld(true);
    assert.ok(size(group).z > folded + 1, `${kind}: wings spread sideways`);
  }
});

test('GBU-62 wings open into the narrow scissor of the drawing, GBU-39 wings open wide', () => {
  const span = kind => {
    const { group, wings } = buildModel(kind);
    for (const [mesh, angle] of wings) mesh.rotation.y = angle;
    group.updateMatrixWorld(true);
    return size(group).z / size(group).x;
  };
  // На кресленні JDAM-ER розмах крил — близько 0,43 довжини бомби, у GBU-39 — понад 0,75.
  assert.ok(span('62') > .38 && span('62') < .48, `GBU-62 span ${span('62').toFixed(2)}`);
  assert.ok(span('39') > .75, `GBU-39 span ${span('39').toFixed(2)}`);
});

test('unknown kinds fall back to the plain bomb', () => {
  const { wings } = buildModel('no-such-kind');
  assert.equal(wings.length, 0);
});

test('the mission card loads the 3D module lazily and keeps the 2D outline as fallback', () => {
  assert.match(html, /<script type="module" src="\.\/munition-3d-loader\.js"><\/script>/);
  assert.match(html, /window\.Munition3D\.mount\(mwStage, mwKind\(r\.munition\), \{ motion: MOTION\.on \}\)/);
  assert.match(html, /\.mw-stage\.is-3d \.mw-svg \{ display: none; \}/);
});
