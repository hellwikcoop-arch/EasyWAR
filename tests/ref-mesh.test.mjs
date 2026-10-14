// Розрізання цілих мешів на рухомі частини (ref-mesh.js): зв’язні тіла, відбір трикутників за місцем, поділ геометрії.
// Перевірено на синтетичних тілах і на реальних моделях машин довідника: колеса мають розпастися на окремі тіла,
// а таблиці осей (ref-rig-data.js) — збігатися з геометрією файлів.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPIN_PLANE, attach, bakeFloat, bakeToRoot, carve, componentVertices, componentsIn, componentsInCylinder, labelsByBoxes, labelsByWheels, labelsOfComponents, meshesOf, splitByLabels, triangleCentroids, triangleComponents, triangleCount, vertexLabels, weldMap } from '../src/ref-mesh.js';
import { WHEELED, WHEEL_NODES, axleGroups, wheelsOf } from '../src/ref-rig-data.js';
import { loadGlbScene } from './helpers/glb-scene.mjs';

const box = (w, h, d, x, y, z) => new BoxGeometry(w, h, d).translate(x, y, z);
const tyre = (x, y, z) => new CylinderGeometry(.5, .5, .4, 24).rotateX(Math.PI / 2).translate(x, y, z);

test('welding joins vertices at one position, so texture seams do not split a body', () => {
  const g = box(1, 1, 1, 0, 0, 0); // у BoxGeometry кожна грань має власні вершини
  assert.equal(g.attributes.position.count, 24);
  const rep = weldMap(g);
  assert.equal(new Set(rep).size, 8);
  assert.equal(triangleCount(g), 12);
});

test('connected bodies are found with their boxes and centres', () => {
  const g = mergeGeometries([box(1, 1, 1, 0, 0, 0), box(2, 1, 1, 5, 2, 0), box(1, 1, 1, 0, 0, 3)]);
  const c = triangleComponents(g);
  assert.equal(c.count, 3);
  assert.deepEqual([...c.tris], [12, 12, 12]);
  const big = [...Array(3).keys()].find(i => c.box[i * 6 + 3] - c.box[i * 6] > 1.5);
  assert.deepEqual([...c.center.slice(big * 3, big * 3 + 3)].map(v => +v.toFixed(3)), [5, 2, 0]);
  assert.deepEqual([...c.box.slice(big * 6, big * 6 + 6)], [4, 1.5, -.5, 6, 2.5, .5]);
  // трикутники одного тіла мають одну мітку
  assert.equal(new Set(c.label).size, 3);
});

test('a non-indexed geometry is handled as a list of triangles', () => {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0], 3));
  const c = triangleComponents(g);
  assert.equal(c.count, 2);
  assert.deepEqual([...triangleCentroids(g)].map(v => +v.toFixed(3)), [.333, .333, 0, 5.333, .333, 0]);
});

test('triangles are labelled by box and by wheel; things away from the axles stay in the body', () => {
  const g = mergeGeometries([tyre(0, .5, 1), tyre(0, .5, -1), tyre(3, .5, 1), tyre(3, .5, -1), tyre(1.5, 3, 1), box(4, .3, 2, 1.5, 1.2, 0)]);
  const wheels = [0, 3].flatMap(x => [-1, 1].map(s => ({ x, y: .5, z: s, r: .5, hw: .45 })));
  const labels = labelsByWheels(g, wheels);
  const counts = [0, 0, 0, 0, 0];
  for (const l of labels) counts[l < 0 ? 4 : l]++;
  assert.deepEqual(counts.slice(0, 4), [counts[0], counts[0], counts[0], counts[0]], 'four equal wheels');
  assert.ok(counts[0] > 0 && counts[4] > counts[0], 'the spare tyre and the frame stay in the body');
  const byBox = labelsByBoxes(g, [[-1, -1, -2, 1, 2, 2]]);
  assert.ok(byBox.some(l => l === 0) && byBox.some(l => l < 0));
});

test('splitting keeps every triangle and every attribute, parts are independent geometries', () => {
  const g = mergeGeometries([tyre(0, .5, 1), tyre(4, .5, 1), box(2, 1, 1, 2, 2, 0)]);
  const wheels = [{ x: 0, y: .5, z: 1, r: .5, hw: .45 }, { x: 4, y: .5, z: 1, r: .5, hw: .45 }];
  const labels = labelsByWheels(g, wheels);
  const { parts, rest } = splitByLabels(g, labels, 2);
  assert.equal(parts.length, 2);
  assert.equal(triangleCount(parts[0]) + triangleCount(parts[1]) + triangleCount(rest), triangleCount(g));
  assert.equal(triangleCount(parts[0]), triangleCount(parts[1]));
  for (const p of parts) { assert.ok(p.attributes.normal && p.attributes.uv, 'normals and uv are kept'); assert.equal(p.attributes.normal.count, p.attributes.position.count); }
  parts[0].computeBoundingBox();
  assert.ok(Math.abs((parts[0].boundingBox.min.x + parts[0].boundingBox.max.x) / 2) < 1e-6, 'the first part is the wheel at x = 0');
  assert.equal(splitByLabels(g, new Int32Array(labels.length).fill(-1), 2).parts.every(p => p === null), true, 'empty parts are null');
});

test('carve leaves the rest in the mesh and attach puts a part on its own axle', () => {
  const g = mergeGeometries([tyre(0, .5, 1), box(2, 1, 1, 2, 2, 0)]);
  const mesh = new Mesh(g, new MeshBasicMaterial());
  mesh.name = 'tyres';
  const labels = labelsByWheels(g, [{ x: 0, y: .5, z: 1, r: .5, hw: .45 }]);
  const [part] = carve(mesh, labels, 1);
  assert.ok(triangleCount(mesh.geometry) < triangleCount(g));
  const axle = new Mesh(); axle.position.set(0, .5, 1);
  mesh.add(axle);
  const piece = attach(axle, mesh, part, [0, .5, 1]);
  piece.geometry.computeBoundingBox();
  const b = piece.geometry.boundingBox;
  assert.ok(Math.abs(b.min.x + b.max.x) < 1e-6 && Math.abs(b.min.y + b.max.y) < 1e-6, 'the part is centred on its axle');
  assert.equal(piece.material, mesh.material, 'the material is shared');
  assert.deepEqual(meshesOf(mesh).map(m => m.name), ['tyres', '', 'tyres'], 'the mesh itself, the axle and the part');
});

test('baking moves the node transform into plain float coordinates', () => {
  const mesh = new Mesh(box(1, 1, 1, 0, 0, 0), new MeshBasicMaterial());
  mesh.position.set(2, 3, 4); mesh.rotation.y = Math.PI / 2; mesh.scale.set(2, 1, 1);
  bakeFloat(mesh);
  assert.deepEqual(mesh.position.toArray(), [0, 0, 0]);
  assert.ok(mesh.matrix.equals(new Matrix4()), 'the node is back to identity');
  const b = mesh.geometry.boundingBox;
  assert.deepEqual([b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map(v => +v.toFixed(5)), [1.5, 2.5, 2.5, 3.5, 3, 5]);
  assert.ok(mesh.geometry.attributes.position.array instanceof Float32Array);
  const n = mesh.geometry.attributes.normal;
  for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-5, 'unit normals');
});

test('every vertex takes the label of the body its triangles belong to', () => {
  const g = mergeGeometries([box(1, 1, 1, 0, 0, 0), box(1, 1, 1, 4, 0, 0)]);
  const c = triangleComponents(g), v = vertexLabels(g, c.label);
  assert.equal(v.length, g.attributes.position.count);
  assert.equal(new Set(v).size, 2);
  for (let i = 0; i < v.length; i++) assert.equal(v[i], g.attributes.position.getX(i) < 2 ? v[0] : v[v.length - 1]);
});

// ---------- реальні моделі ----------

function wheelBodies(scene) {
  const out = [];
  for (const m of meshesOf(scene.getObjectByName('tyres'))) {
    const c = triangleComponents(m.geometry);
    for (let i = 0; i < c.count; i++) {
      if (c.tris[i] < 200) continue; // блоки протектора — дрібні тіла по 12 трикутників
      const b = c.box.slice(i * 6, i * 6 + 6);
      out.push({ x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, z: (b[2] + b[5]) / 2, d: b[4] - b[1], w: b[5] - b[2] });
    }
  }
  return out;
}

test('the wheel tables match the geometry of every wheeled model', async () => {
  const FILES = { himars: 'm142-himars', vilkha: 'vilkha', sapsan: 'sapsan', m984: 'm984a2', m1084: 'm1084a1p2', 'hemtt-pods': 'hemtt-pod-carrier' };
  for (const [id, spec] of Object.entries(WHEELED)) {
    const { scene } = await loadGlbScene(FILES[id]);
    const bodies = wheelBodies(scene);
    for (const w of wheelsOf(spec)) {
      const hit = bodies.filter(b => Math.hypot(b.x - w.x, b.y - w.y, b.z - w.z) < .02 && Math.abs(b.d - 2 * w.r) < .03);
      assert.equal(hit.length, 1, `${id}: wheel at x=${w.x}, z=${w.z}`);
    }
    // решта тіл у шинах — запасне колесо (воно вище осей і лишається в корпусі)
    const rest = bodies.length - wheelsOf(spec).length;
    assert.ok(rest === 0 || rest === 1, `${id}: ${rest} extra tyre bodies`);
  }
});

test('real tyre, rim and bolt meshes split into equal wheels and a spare stays on the body', async () => {
  for (const [id, file] of [['himars', 'm142-himars'], ['m984', 'm984a2'], ['m1084', 'm1084a1p2']]) {
    const { scene } = await loadGlbScene(file);
    const wheels = wheelsOf(WHEELED[id]);
    for (const name of WHEEL_NODES) {
      for (const mesh of meshesOf(scene.getObjectByName(name))) {
        const total = triangleCount(mesh.geometry);
        const { parts, rest } = splitByLabels(mesh.geometry, labelsByWheels(mesh.geometry, wheels), wheels.length);
        const sizes = parts.map(p => (p ? triangleCount(p) : 0));
        assert.ok(sizes.every(s => s === sizes[0] && s > 0), `${id}/${name}: equal wheels ${sizes}`);
        const left = rest ? triangleCount(rest) : 0;
        assert.equal(sizes.reduce((s, v) => s + v, 0) + left, total, `${id}/${name}: nothing is lost`);
        if (name === 'tyres') assert.ok(left === 0 || left === sizes[0], `${id}: only the spare tyre stays (${left} of ${sizes[0]})`);
      }
    }
  }
});

test('axle groups: the front and the rear of the wheelbase for the pitch of the body', () => {
  const g = axleGroups(WHEELED.himars.axles);
  assert.equal(g.front, 2.31);
  assert.ok(Math.abs(g.rear - (-1.825)) < 1e-9);
  const h = axleGroups(WHEELED.m984.axles);
  assert.ok(h.front > 0 && h.rear < 0);
  assert.deepEqual(axleGroups([0]), { front: 0, rear: 0 });
});

test('bodies are picked by the region that holds their whole box, and grouped into parts by number', () => {
  const g = mergeGeometries([box(1, 1, 1, 0, 0, 0), box(.2, .2, .2, 5, 1, 0), box(.2, .2, .2, 5, 1, 2), box(3, 1, 1, 9, 0, 0)]);
  const c = triangleComponents(g);
  const idx = f => [...Array(c.count).keys()].find(i => f(c.center.slice(i * 3, i * 3 + 3)));
  const small = idx(p => Math.abs(p[0] - 5) < .01 && Math.abs(p[2]) < .01), farSmall = idx(p => Math.abs(p[0] - 5) < .01 && Math.abs(p[2] - 2) < .01), huge = idx(p => p[0] > 8);
  assert.deepEqual(componentsIn(c, [4.5, .5, -.5, 5.5, 1.5, .5]), [small], 'only the body that lies wholly inside');
  assert.deepEqual(componentsIn(c, [4.5, .5, -.5, 5.5, 1.5, 2.5]).sort(), [small, farSmall].sort());
  assert.deepEqual(componentsIn(c, [4.95, .5, -.5, 5.05, 1.5, .5]), [], 'a box that is too tight holds nothing');
  assert.deepEqual(componentsIn(c, [4.95, .5, -.5, 5.05, 1.5, .5], .1), [small], 'the tolerance widens the region');
  assert.deepEqual(componentsIn(c, [-100, -100, -100, 100, 100, 100]).length, 4);
  // група тіл стає однією частиною, решта — у корпусі (−1)
  const labels = labelsOfComponents(c, [[small, farSmall], [huge]]);
  assert.equal(labels.length, 48);
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  assert.deepEqual([...counts].sort((a, b) => a[0] - b[0]), [[-1, 12], [0, 24], [1, 12]]);
  const mesh = new Mesh(g, new MeshBasicMaterial());
  const parts = carve(mesh, labels, 2);
  assert.equal(triangleCount(parts[0]), 24);
  assert.equal(triangleCount(parts[1]), 12);
  assert.equal(triangleCount(mesh.geometry), 12, 'the first body stays');
});

test('a cylinder around an axis takes the bodies that lie wholly inside it, whichever way the axis points', () => {
  // Маточина (0, 0) і дві лопаті вздовж x на висоті 3, потім одна лопать за межами кола й одне тіло нижче смуги.
  const g = mergeGeometries([box(.4, .3, .4, 0, 3, 0), box(2, .05, .3, 1.5, 3, 0), box(2, .05, .3, -1.5, 3, 0), box(2, .05, .3, 6, 3, 0), box(.4, .3, .4, 0, 1, 0)]);
  const c = triangleComponents(g);
  assert.equal(c.count, 5);
  const inside = componentsInCylinder(c, { axis: 'y', c: [0, 0], band: [2.8, 3.2], r: 2.6 });
  assert.equal(inside.length, 3, 'the hub and the two blades');
  assert.equal(componentsInCylinder(c, { axis: 'y', c: [0, 0], band: [2.8, 3.2], r: 2.4 }).length, 1, 'a blade that sticks out of the circle is not taken');
  assert.equal(componentsInCylinder(c, { axis: 'y', c: [0, 0], band: [2.8, 3.2], r: 2.4 }, .3).length, 3, 'the tolerance widens the cylinder');
  assert.equal(componentsInCylinder(c, { axis: 'y', c: [0, 0], band: [.5, 3.5], r: 2.6 }).length, 4, 'a wider band takes the low body too');
  assert.equal(componentsInCylinder(c, { axis: 'y', c: [6, 0], band: [2.8, 3.2], r: 1.2 }).length, 1, 'a shifted centre finds the far blade');
  // Той самий набір, повернутий так, що вісь гвинта дивиться вздовж x: координати (u, v, вздовж осі) беруться з SPIN_PLANE.
  const turned = mergeGeometries([box(.4, .3, .4, 0, 3, 0), box(2, .05, .3, 1.5, 3, 0)]).applyMatrix4(new Matrix4().makeRotationZ(-Math.PI / 2));
  const ct = triangleComponents(turned);
  assert.deepEqual(SPIN_PLANE.x, [1, 2, 0]);
  // Вісь тепер уздовж x на 3: маточина лежить на осі, лопать (y від −2,5 до −0,5) тягнеться вздовж u = y.
  assert.equal(componentsInCylinder(ct, { axis: 'x', c: [0, 0], band: [2.8, 3.2], r: 2.6 }).length, 2);
  assert.equal(componentsInCylinder(ct, { axis: 'x', c: [0, 0], band: [2.8, 3.2], r: 2.4 }).length, 1, 'the blade is out of a narrower circle');
  assert.equal(componentsInCylinder(ct, { axis: 'x', c: [0, 0], band: [0, 1], r: 9 }).length, 0, 'nothing lies in a band along the axis where there is nothing');
  assert.deepEqual(SPIN_PLANE.y, [0, 2, 1]);
  assert.deepEqual(SPIN_PLANE.z, [0, 1, 2]);
});

test('vertices of chosen bodies come out one by one, welded vertices once', () => {
  const g = mergeGeometries([box(1, 1, 1, 0, 0, 0), box(1, 1, 1, 5, 0, 0)]);
  const c = triangleComponents(g);
  const left = [...Array(c.count).keys()].find(i => c.center[i * 3] < 1);
  const verts = componentVertices(g, c, [left]);
  assert.equal(verts.size, 1);
  const list = verts.get(left);
  assert.equal(list.length / 3, 24, 'a box has 24 separate vertices, as many as the file stores');
  assert.ok(list.every(v => Math.abs(v) <= .5 + 1e-6), 'only the vertices of that body, none of the box at x = 5');
  assert.equal(componentVertices(g, c, []).size, 0);
});

test('baking to a root puts the geometry in the root frame and the mesh under the root with no transform', () => {
  const root = new Group(), arm = new Group(), mesh = new Mesh(new BoxGeometry(1, 2, 3), new MeshBasicMaterial());
  root.add(arm); arm.add(mesh);
  arm.position.set(1, 2, 3); arm.rotation.y = Math.PI / 2; arm.scale.setScalar(2);
  mesh.position.set(.5, 0, 0); mesh.rotation.x = .3;
  root.position.set(10, 0, 0); root.updateMatrixWorld(true); // сам root не входить у перетворення: система root — його власна
  const before = new Vector3(), after = new Vector3(), pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal;
  const inRoot = [], normals = [];
  const toRoot = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  for (let i = 0; i < pos.count; i++) { inRoot.push(before.fromBufferAttribute(pos, i).applyMatrix4(toRoot).toArray()); normals.push(new Vector3().fromBufferAttribute(nor, i).transformDirection(toRoot).toArray()); }
  bakeToRoot(mesh, root);
  assert.equal(mesh.parent, root);
  assert.ok(mesh.position.length() === 0 && mesh.quaternion.w === 1 && mesh.scale.x === 1);
  const p2 = mesh.geometry.attributes.position, n2 = mesh.geometry.attributes.normal;
  for (let i = 0; i < p2.count; i++) {
    after.fromBufferAttribute(p2, i);
    assert.ok(after.distanceTo(new Vector3(...inRoot[i])) < 1e-4, 'the vertex is where the chain of parents put it');
    assert.ok(new Vector3().fromBufferAttribute(n2, i).distanceTo(new Vector3(...normals[i])) < 1e-4, 'the normal turned with it and stayed a unit one');
  }
  root.updateMatrixWorld(true);
  const world = new Vector3().fromBufferAttribute(p2, 0).applyMatrix4(mesh.matrixWorld);
  assert.ok(world.distanceTo(new Vector3(...inRoot[0]).applyMatrix4(root.matrixWorld)) < 1e-4, 'the world position does not change');
  assert.ok(mesh.geometry.boundingBox.max.x > mesh.geometry.boundingBox.min.x, 'the bounds are recomputed');
});
