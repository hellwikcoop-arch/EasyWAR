import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { Box3, Vector3 } from 'three';
import { KINDS, buildModel, explodeCycle } from '../src/munition-3d.js';

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

// Кількість крил, що розкриваються: пари в GBU, чотири чорні лопаті «Х» в AASM-250.
const WING_COUNT = { '39': 2, '53': 2, '62': 2, '64': 2, aasm: 4 };

test('only GBU-39/53/62/64 and AASM unfold wings, and unfolded wings widen the model', () => {
  for (const kind of KINDS) {
    const { group, wings } = buildModel(kind);
    assert.equal(wings.length, WING_COUNT[kind] || 0, kind);
    if (!wings.length) continue;
    const folded = size(group);
    for (const [mesh, angle] of wings) mesh.rotation.y = angle;
    group.updateMatrixWorld(true);
    const open = size(group);
    // Пари крил розходяться вбік (z), лопаті AASM — хрестом, тож ширшає найперше висота (у складеному вигляді
    // сама модель дорівнює лише корпусу з хвостовими стабілізаторами).
    assert.ok(Math.max(open.y - folded.y, open.z - folded.z) > .8, `${kind}: wings spread sideways`);
  }
});

test('unfolded wing spans follow the reference drawings', () => {
  const span = kind => {
    const { group, wings, update } = buildModel(kind);
    for (const [mesh, angle] of wings) mesh.rotation.y = angle;
    if (update) update();
    group.updateMatrixWorld(true);
    return size(group).z / size(group).x;
  };
  // Розмах відносно довжини за рендерами з розкритими крилами: GBU-62 (короткі широкі крила) ≈ 0,60,
  // GBU-64 (довгі «ножиці») ≈ 0,86, GBU-39 (Diamond Back) — як у справжньої бомби, близько 0,77.
  assert.ok(span('62') > .54 && span('62') < .68, `GBU-62 span ${span('62').toFixed(2)}`);
  assert.ok(span('64') > .78 && span('64') < .94, `GBU-64 span ${span('64').toFixed(2)}`);
  assert.ok(span('39') > .72 && span('39') < .86, `GBU-39 span ${span('39').toFixed(2)}`);
});

test('AASM blades fold along the tail module and open as an X', () => {
  const { group, wings } = buildModel('aasm');
  const folded = size(group);
  assert.ok(folded.y < .8 && folded.z < 1.4, `folded ${folded.y.toFixed(2)} x ${folded.z.toFixed(2)}`);
  for (const [mesh, angle] of wings) mesh.rotation.y = angle;
  group.updateMatrixWorld(true);
  const open = size(group);
  // Чотири лопаті під 45° від площини стабілізаторів: розмах однаковий по висоті й по ширині, ≈ 0,39 довжини.
  assert.ok(Math.abs(open.y - open.z) < .02, `open ${open.y.toFixed(2)} x ${open.z.toFixed(2)}`);
  assert.ok(open.y / open.x > .33 && open.y / open.x < .45, `AASM span ${(open.y / open.x).toFixed(2)}`);
});

test('AASM splits into four modules along the axis and closes back', () => {
  const { group, explode, labels } = buildModel('aasm');
  assert.equal(typeof explode, 'function');
  assert.equal(labels.length, 4);
  const anchors = () => { group.updateMatrixWorld(true); return labels.map(l => l.anchor.getWorldPosition(new Vector3()).x); };
  const assembled = size(group).x, before = anchors();
  explode(1);
  group.updateMatrixWorld(true);
  const apart = size(group).x, after = anchors();
  assert.ok(apart > assembled + 1, `apart ${apart.toFixed(2)} vs assembled ${assembled.toFixed(2)}`);
  // Ніс іде вперед, хвіст назад, корпус лишається; підписи їдуть за своїми модулями.
  assert.ok(after[0] - before[0] > .5, 'nose module moves forward');
  assert.ok(after[1] - before[1] > .1, 'collar moves forward');
  assert.ok(Math.abs(after[2] - before[2]) < 1e-9, 'body stays');
  assert.ok(before[3] - after[3] > .5, 'tail module moves back');
  const [noseTip, tailTip] = group.userData.tips;
  assert.ok(noseTip > 2.4 && tailTip < -2.4, `lock markers follow the ends ${noseTip.toFixed(2)} / ${tailTip.toFixed(2)}`);
  explode(0);
  group.updateMatrixWorld(true);
  assert.ok(Math.abs(size(group).x - assembled) < 1e-6, 'assembled again');
  assert.deepEqual(anchors(), before);
  for (const kind of KINDS) if (kind !== 'aasm') assert.equal(buildModel(kind).explode, undefined, `${kind} is not modular`);
});

test('the explode cycle starts assembled, holds apart and closes again', () => {
  assert.equal(explodeCycle(0), 0);
  assert.equal(explodeCycle(2.4), 0);
  assert.equal(explodeCycle(4.5), 1);
  assert.ok(explodeCycle(3.2) > 0 && explodeCycle(3.2) < 1, 'opening');
  assert.ok(explodeCycle(9.4) > 0 && explodeCycle(9.4) < 1, 'closing');
  assert.equal(explodeCycle(11), 0);
  assert.ok(explodeCycle(15.4) > 0, 'the cycle repeats');
});

test('GBU-39 struts slide along the housing and stay attached to the wings', () => {
  const { group, wings, update } = buildModel('39');
  const struts = [];
  group.traverse(o => { if (o.name === 'strut') struts.push(o); });
  assert.equal(struts.length, 2);
  for (const open of [0, .5, 1, 1.1]) {
    for (const [mesh, angle] of wings) mesh.rotation.y = angle * open;
    update();
    group.updateMatrixWorld(true);
    for (const strut of struts) {
      const end = strut.localToWorld(new Vector3(strut.geometry.parameters.width, 0, 0));
      const mount = strut.userData.wing.getObjectByName('strut-mount').getWorldPosition(new Vector3());
      assert.ok(Math.hypot(end.x - mount.x, end.z - mount.z) < .01, `open ${open}: strut reaches the wing`);
      assert.ok(strut.position.x > -.95 && strut.position.x < .75, `open ${open}: slider stays in the housing rail`);
    }
  }
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
