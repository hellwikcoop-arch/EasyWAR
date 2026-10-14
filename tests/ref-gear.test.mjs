// Ходова частина (ref-gear.js): контур гусениці за центрами ланок, колеса, вирізані зі злитих мешів, і таблиці катків,
// звірені з геометрією справжніх моделей довідника (M270, Bergepanzer 2, HIMARS).
import assert from 'node:assert/strict';
import test from 'node:test';
import { TRACKED, WHEELED } from '../src/ref-rig-data.js';
import { Tracks, TRACK_SAMPLES, buildLoops, buildWheels, loopPosition, nearestWheel, pathAt } from '../src/ref-gear.js';
import { meshesOf, triangleCount } from '../src/ref-mesh.js';
import { loadGlbScene } from './helpers/glb-scene.mjs';

// Ланки «стадіону»: нижня гілка y = 0 (x від −3 до 3), півколо навколо (3, .5), верхня y = 1, півколо навколо (−3, .5).
function stadium(n, z) {
  const R = .5, straight = 6, per = 2 * straight + 2 * Math.PI * R, out = [];
  for (let i = 0; i < n; i++) {
    let d = i / n * per;
    let x, y;
    if (d < straight) { x = -3 + d; y = 0; }
    else if ((d -= straight) < Math.PI * R) { const a = -Math.PI / 2 + d / R; x = 3 + R * Math.cos(a); y = .5 + R * Math.sin(a); }
    else if ((d -= Math.PI * R) < straight) { x = 3 - d; y = 1; }
    else { d -= straight; const a = Math.PI / 2 + d / R; x = -3 + R * Math.cos(a); y = .5 + R * Math.sin(a); }
    out.push({ x, y, side: z > 0 ? 1 : 0 });
  }
  return out;
}

test('the track loop follows the links clockwise and moves them from one link to the next', () => {
  const n = 120, ns = 128;
  const centers = [...stadium(n, -1), ...stadium(n, 1)];
  const { path, loops, ds } = buildLoops(centers, ns);
  assert.equal(path.length, ns * 2 * 4);
  assert.ok(Math.abs(ds * ns - (12 + Math.PI)) < .2, 'the loop length is the perimeter of the stadium');
  // напрям: у верхній гілці вперед (+x), у нижній назад — так гусениця їде під машиною при русі вперед
  const rowTop = loops[1].xy.reduce((best, p, i) => (p[1] > loops[1].xy[best][1] ? i : best), 0);
  const rowBottom = loops[1].xy.reduce((best, p, i) => (p[1] < loops[1].xy[best][1] ? i : best), 0);
  assert.ok(path[(ns + rowTop) * 4 + 2] > .9, 'the top run goes forward');
  assert.ok(path[(ns + rowBottom) * 4 + 2] < -.9, 'the bottom run goes backward');
  for (let s = 0; s < ns; s++) assert.ok(Math.abs(Math.hypot(path[s * 4 + 2], path[s * 4 + 3]) - 1) < 1e-5, 'unit tangents');
  // кожна ланка лежить на контурі, і зсув на крок ланки веде до сусідньої ланки
  const pos = centers.filter(c => c.side === 1).map(c => loopPosition(loops[1].xy, c.x, c.y));
  centers.filter(c => c.side === 1).forEach((c, i) => {
    const p = pathAt(path, ns, pos[i], 1);
    assert.ok(Math.hypot(p[0] - c.x, p[1] - c.y) < .12, `link ${i} sits on the loop (згладжування зрізає кути)`);
  });
  const pitch = ns / n, side1 = centers.filter(c => c.side === 1);
  let moved = 0;
  pos.forEach((p, i) => {
    const next = side1[(i + n - 1) % n], q = pathAt(path, ns, p + pitch, 1); // ланки задано проти годинникової стрілки, контур іде за нею
    if (Math.hypot(q[0] - next.x, q[1] - next.y) < .15) moved++;
  });
  assert.ok(moved > n * .9, `shifting by a pitch lands on the next link (${moved} of ${n})`);
  assert.ok(Math.abs(pathAt(path, ns, 5.5, 0)[0] - pathAt(path, ns, 5.5 + ns, 0)[0]) < 1e-6, 'the path is periodic');
  assert.throws(() => buildLoops(stadium(2, 1), ns), /без ланок/);
});

test('the nearest wheel of the table is chosen by the centre of the body', () => {
  const table = [[0, 0, .3], [2, 0, .4], [4, 1, .1]];
  assert.deepEqual(nearestWheel(table, 1.8, .2), [2, 0, .4]);
  assert.deepEqual(nearestWheel(table, 3.2, 1), [4, 1, .1]);
});

for (const [id, file] of [['m270', 'm270-mlrs'], ['bpz2', 'bergepanzer2']]) {
  test(`${id}: every link has a place on its loop and every body of the running gear has a wheel from the table`, async () => {
    const { scene } = await loadGlbScene(file, { fresh: true });
    const tr = new Tracks(scene, TRACKED[id]);
    assert.equal(tr.meshes.length, 5, 'tracks, horns, tyres, hubs and rollers');
    const used = new Set();
    for (const mesh of tr.meshes) {
      const A = mesh.geometry.attributes.aMove, kinds = new Set();
      assert.ok(A && A.itemSize === 4 && A.count === mesh.geometry.attributes.position.count, `${mesh.name}: move data per vertex`);
      for (let v = 0; v < A.count; v++) {
        kinds.add(A.getX(v));
        if (A.getX(v) === 2) used.add(`${A.getY(v)},${A.getZ(v)},${A.getW(v)}`);
        if (A.getX(v) === 1) assert.ok(A.getY(v) >= 0 && A.getY(v) < TRACK_SAMPLES && (A.getZ(v) === 0 || A.getZ(v) === 1));
      }
      assert.deepEqual([...kinds], [mesh.name.startsWith('track') ? 1 : 2], `${mesh.name}: all vertices move the same way`);
      assert.ok(mesh.material.onBeforeCompile && mesh.material.customProgramCacheKey, `${mesh.name}: the shader is attached`);
    }
    assert.equal(used.size, TRACKED[id].wheels.length, 'every row of the wheel table is used');
    // Кожна ланка — два тіла (пластина й шплінт на одній позиції): кроки між ланками рівномірні, ланки не накладаються.
    const pads = tr.meshes.find(m => m.name === 'tracks'), A = pads.geometry.attributes.aMove, side1 = new Set();
    for (let v = 0; v < A.count; v++) if (A.getZ(v) === 1) side1.add(A.getY(v));
    const sorted = [...side1].sort((a, b) => a - b), links = [];
    for (const p of sorted) if (!links.length || p - links[links.length - 1] > .45) links.push(p);
    const gaps = links.map((p, i) => (links[(i + 1) % links.length] - p + TRACK_SAMPLES) % TRACK_SAMPLES), mean = TRACK_SAMPLES / links.length;
    assert.ok(links.length > 50 && Math.min(...gaps) > mean * .85 && Math.max(...gaps) < mean * 1.15, `${links.length} links, gaps ${Math.min(...gaps).toFixed(2)}…${Math.max(...gaps).toFixed(2)} around ${mean.toFixed(2)}`);
    tr.update(12.5);
    assert.equal(tr.uniforms.uDist.value, 12.5);
    assert.ok(Math.abs(tr.uniforms.uShift.value - 12.5 / tr.ds) < 1e-9);
    tr.update(1e6);
    assert.ok(tr.uniforms.uShift.value >= 0 && tr.uniforms.uShift.value < TRACK_SAMPLES, 'the shift wraps round the loop');
    tr.dispose();
  });
}

test('wheel tables of the tracked vehicles match the bodies in the model files', async () => {
  for (const [id, file] of [['m270', 'm270-mlrs'], ['bpz2', 'bergepanzer2']]) {
    const { scene } = await loadGlbScene(file, { fresh: true });
    const tr = new Tracks(scene, TRACKED[id]);
    const roadWheels = TRACKED[id].wheels.filter(w => w[2] > .3 && w[2] < .35 && w[1] < .5);
    assert.ok(roadWheels.length >= 6, `${id}: road wheels in the table`);
    const tyres = tr.meshes.find(m => m.name === 'tyres'), A = tyres.geometry.attributes.aMove, P = tyres.geometry.attributes.position;
    // кожна вершина шини лежить не далі радіуса шини + протектора від осі свого катка
    let worst = 0;
    for (let v = 0; v < P.count; v++) worst = Math.max(worst, Math.hypot(P.getX(v) - A.getY(v), P.getY(v) - A.getZ(v)) - A.getW(v));
    assert.ok(worst < .05, `${id}: tyre vertices lie within the wheel radius (${worst.toFixed(3)} m over)`);
    tr.dispose();
  }
});

test('HIMARS wheels are cut out of the merged tyre, rim and bolt meshes without losing a triangle', async () => {
  const { scene } = await loadGlbScene('m142-himars', { fresh: true });
  const names = ['tyres', 'rims', 'wheel_bolts'], count = () => names.reduce((s, n) => s + meshesOf(scene.getObjectByName(n)).reduce((a, m) => a + (m.visible ? triangleCount(m.geometry) : 0), 0), 0);
  const before = count();
  const rig = buildWheels(scene, WHEELED.himars);
  assert.equal(rig.wheels.length, 6);
  const inWheels = rig.wheels.map(w => meshesOf(w.spin).reduce((a, m) => a + triangleCount(m.geometry), 0));
  assert.ok(inWheels.every(n => n === inWheels[0] && n > 0), `equal wheels ${inWheels}`);
  assert.equal(count() + inWheels.reduce((a, n) => a + n, 0), before, 'nothing is lost');
  for (const w of rig.wheels) {
    assert.equal(meshesOf(w.spin).length, 3, 'tyre, rim and bolts');
    assert.ok(Math.abs(w.rr - .534) < .012, `rolling radius ${w.rr.toFixed(3)} m`);
    assert.equal(w.pivot.parent, scene);
  }
  rig.update(10, .2);
  for (const w of rig.wheels) {
    assert.ok(Math.abs(w.spin.rotation.z + 10 / w.rr) < 1e-9, 'all wheels roll the same way');
    assert.equal(w.pivot.rotation.y, w.steer ? .2 : 0);
  }
  assert.equal(rig.wheels.filter(w => w.steer).length, 2, 'only the front axle steers');
  rig.reset();
  assert.ok(rig.wheels.every(w => w.spin.rotation.z === 0 && w.pivot.rotation.y === 0));
  rig.dispose();
  assert.equal(rig.wheels[0].pivot.parent, null);
});

test('a model without wheels gives no wheel rig and loses nothing', async () => {
  const { scene } = await loadGlbScene('gmlrs-m31', { fresh: true });
  const before = scene.children.length;
  assert.equal(buildWheels(scene, WHEELED.himars), null);
  assert.equal(scene.children.length, before, 'the empty wheel pivots are removed');
});
