// Ландшафт під наземною машиною (ref-terrain.js): сітка висот, дзеркальні плитки без стиків, поза корпуса на схилі.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { LAND, Terrain, forgetTerrain, groundPose, heightAt, heightGrid, rowLayout, tileLayout } from '../src/ref-terrain.js';

const BOX = new Box3(new Vector3(-10, -1, -5), new Vector3(10, 1, 5));

// Точки площини y = a·x + b·z по всій плитці.
function slopePoints(a, b, n = 80) {
  const p = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const x = BOX.min.x + (BOX.max.x - BOX.min.x) * i / n, z = BOX.min.z + (BOX.max.z - BOX.min.z) * j / n;
    p.push(x, a * x + b * z, z);
  }
  return p;
}

test('the height grid reproduces a slope and fills the empty cells', () => {
  const H = heightGrid(slopePoints(.05, .02), BOX, 24, 12);
  const grid = { H, gw: 24, gh: 12, box: BOX };
  for (const [x, z] of [[-6, -2], [0, 0], [4.2, 3.1], [8, -3]]) assert.ok(Math.abs(heightAt(grid, x, z) - (.05 * x + .02 * z)) < .06, `h(${x}, ${z})`);
  // кілька вершин у кутку: решта сітки добудовується сусідніми комірками
  const sparse = heightGrid([-9.9, .5, -4.9, 9.9, .5, 4.9], BOX, 8, 6);
  assert.equal(sparse.length, 48);
  assert.ok(sparse.every(v => Number.isFinite(v) && Math.abs(v - .5) < 1e-6));
});

test('mirrored tiles meet without a step and the pattern repeats every two tiles', () => {
  const H = heightGrid(slopePoints(.05, .02), BOX, 24, 12);
  const grid = { H, gw: 24, gh: 12, box: BOX }, L = BOX.max.x - BOX.min.x;
  for (const edge of [BOX.max.x, BOX.max.x + L, BOX.min.x - L]) {
    assert.ok(Math.abs(heightAt(grid, edge - 1e-4, 1) - heightAt(grid, edge + 1e-4, 1)) < 1e-3, `no step at ${edge}`);
  }
  assert.ok(Math.abs(heightAt(grid, 3.3, 1) - heightAt(grid, 3.3 + 2 * L, 1)) < 1e-9);
  assert.ok(Math.abs(heightAt(grid, 3.3, 1) - heightAt(grid, 3.3 - 4 * L, 1)) < 1e-9);
  assert.ok(Math.abs(heightAt(grid, BOX.max.x + 3, 1) - heightAt(grid, BOX.max.x - 3, 1)) < 1e-9, 'the neighbour is a mirror image');
  assert.ok(Number.isFinite(heightAt(grid, 1e5, 100)), 'far beyond the tile the height is still defined');
});

test('the side rows are mirrored across the edge in z too, so the field has no step or border', () => {
  const H = heightGrid(slopePoints(.05, .02), BOX, 24, 12);
  const grid = { H, gw: 24, gh: 12, box: BOX }, W = BOX.max.z - BOX.min.z;
  for (const edge of [BOX.max.z, BOX.max.z + W, BOX.min.z - W]) {
    assert.ok(Math.abs(heightAt(grid, 2, edge - 1e-4) - heightAt(grid, 2, edge + 1e-4)) < 1e-3, `no step at z = ${edge}`);
  }
  assert.ok(Math.abs(heightAt(grid, 2, 1.5) - heightAt(grid, 2, 1.5 + 2 * W)) < 1e-9, 'the pattern repeats every two rows');
  assert.ok(Math.abs(heightAt(grid, 2, BOX.max.z + 1) - heightAt(grid, 2, BOX.max.z - 1)) < 1e-9, 'the neighbour row is a mirror image');
});

test('three rows lie across the course: the middle one under the machine, the side ones mirrored', () => {
  const W = BOX.max.z - BOX.min.z, rows = rowLayout(BOX);
  assert.equal(rows.length, LAND.rows);
  assert.deepEqual(rows.map(r => r.n), [-1, 0, 1]);
  assert.deepEqual(rows.map(r => r.flip), [true, false, true]);
  for (const r of rows) {
    const lo = r.flip ? r.z - BOX.max.z : r.z + BOX.min.z, hi = r.flip ? r.z - BOX.min.z : r.z + BOX.max.z;
    assert.ok(Math.abs(lo - (BOX.min.z + r.n * W)) < 1e-9 && Math.abs(hi - (BOX.min.z + (r.n + 1) * W)) < 1e-9, `row ${r.n}`);
  }
  assert.equal(rowLayout(BOX, 1).length, 1);
});

test('tiles are laid around the machine, odd ones mirrored', () => {
  const L = BOX.max.x - BOX.min.x;
  const list = tileLayout(BOX, 0);
  assert.equal(list.length, LAND.tiles);
  assert.deepEqual(list.map(t => t.n), [-2, -1, 0, 1, 2].map(n => n + Math.floor((0 - BOX.min.x) / L)));
  for (const t of list) assert.equal(t.flip, Math.abs(t.n) % 2 === 1);
  // перекриття: кожна плитка займає [min + n·L, min + (n+1)·L] у світі, дзеркальна — теж
  for (const t of list) {
    const lo = t.flip ? t.x - BOX.max.x : t.x + BOX.min.x, hi = t.flip ? t.x - BOX.min.x : t.x + BOX.max.x;
    assert.ok(Math.abs(lo - (BOX.min.x + t.n * L)) < 1e-9 && Math.abs(hi - (BOX.min.x + (t.n + 1) * L)) < 1e-9, `tile ${t.n}`);
  }
  assert.ok(list[2].n * L + BOX.min.x <= 0 && (list[2].n + 1) * L + BOX.min.x > 0, 'the middle tile is under the machine');
});

test('on a slope the body tilts nose-up and rolls toward the low side', () => {
  const h = (a, b) => (x, z) => a * x + b * z;
  const up = groundPose(h(.1, 0), { front: 2, rear: -2, half: 1 });
  assert.ok(Math.abs(up.pitch - Math.atan(.1)) < 1e-9 && Math.abs(up.roll) < 1e-9);
  const side = groundPose(h(0, .1), { front: 2, rear: -2, half: 1 });
  assert.ok(side.roll < 0 && Math.abs(side.roll + Math.atan(.1)) < 1e-9, 'the +z side is higher, so the roll is negative');
  assert.ok(Math.abs(side.pitch) < 1e-9);
  const flat = groundPose(() => 0, { front: 2, rear: -2, half: 1 });
  assert.ok(Math.abs(flat.y - .01) < 1e-12, 'the body rides a centimetre above flat ground');
});

test('the terrain is built once from the model, ready tiles are placed under the machine, and it cleans up', async () => {
  const plane = new Mesh(new PlaneGeometry(20, 10, 20, 10).rotateX(-Math.PI / 2), new MeshBasicMaterial());
  plane.geometry.attributes.position.setY(0, 1);
  const scene = new Group(); scene.add(plane);
  let loads = 0;
  const loader = async model => { loads++; assert.equal(model.global, 'LAND_GLB'); return { scene }; };
  const parent = new Group();
  const t = new Terrain(parent, loader);
  assert.equal(t.heightAt(0, 0), 0, 'flat ground until the model loads');
  await t.loading;
  assert.ok(t.ready && t.group.visible && t.tiles.length === LAND.tiles * LAND.rows);
  assert.equal(parent.children.length, 1);
  assert.ok(Math.abs(t.heightAt(0, 0)) < 1e-9, 'the height under the start is zero');
  t.place(1234);
  const mirroredX = t.tiles.filter(m => m.scale.x < 0).length, mirroredZ = t.tiles.filter(m => m.scale.z < 0).length;
  assert.ok([2, 3].includes(mirroredX / LAND.rows), 'every other tile along the course is mirrored');
  assert.equal(mirroredZ, 2 * LAND.tiles, 'the two side rows are mirrored across the course');
  assert.ok(t.tiles.every(m => m.frustumCulled), 'tiles outside the view are not drawn');
  const second = new Terrain(new Group(), loader);
  await second.loading;
  assert.equal(loads, 1, 'the model is loaded only once');
  t.dispose();
  assert.equal(parent.children.length, 0);
});

test('a failing model leaves the terrain flat instead of breaking the scene', async () => {
  forgetTerrain();
  const t = new Terrain(new Group(), async () => { throw new Error('немає файлу'); });
  await t.loading;
  assert.equal(t.heightAt(5, 5), 0);
});
