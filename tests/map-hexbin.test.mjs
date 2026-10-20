import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Лише синтетичні точки в км локальної проєкції карти.
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(await read('../src/public/map-hexbin.js'), context);
const { bin, path, levels, cellOf, centerOf, COLORS, LEVELS } = context.EWHexbin;

test('hexbin: nearby points share a cell, the centre of a cell maps back to itself', () => {
  const cells = bin([{ x: 0, y: 0 }, { x: 0.3, y: 0.2 }, { x: 10, y: 10 }], 2);
  assert.equal(cells.length, 2);
  assert.deepEqual([...cells].map(cell => cell.count).sort(), [1, 2]);
  for (const q of [-3, 0, 4]) for (const r of [-2, 0, 5]) {
    const centre = centerOf(q, r, 1.5);
    assert.deepEqual({ ...cellOf(centre.x, centre.y, 1.5) }, { q, r });
  }
});

test('hexbin: invalid points and sizes are ignored', () => {
  assert.deepEqual([...bin([{ x: NaN, y: 0 }, null, { x: 1 }], 1)], []);
  assert.deepEqual([...bin([{ x: 0, y: 0 }], 0)], []);
  assert.deepEqual([...bin(null, 1)], []);
});

test('hexbin levels: rank of distinct counts from 0 to 4, one count for all is the middle level', () => {
  assert.deepEqual([...levels([1, 2, 3, 4, 5])], [0, 1, 2, 3, 4]);
  assert.deepEqual([...levels([7, 1, 7])], [4, 0, 4]);
  assert.deepEqual([...levels([3, 3])], [2, 2]);
  assert.equal(COLORS.length, LEVELS);
});

test('hexbin path: pointy-top hexagon with six vertices, the first straight above the centre', () => {
  const d = path(100, 50, 10);
  assert.match(d, /^M100\.0 40\.0(L[-\d.]+ [-\d.]+){5}Z$/u);
});

test('2D map in air.html and rocket.html: density layer off by default, drawn under markers, script loaded', async () => {
  for (const name of ['air', 'rocket']) {
    const html = await read(`../src/${name}.html`);
    assert.ok(html.includes('<script src="./map-hexbin.js"></script>'), `${name}: скрипт теплокарти`);
    assert.match(html, /hex: store\('aviahub\.hex'\) === '1'/u, `${name}: вимкнено за замовчуванням`);
    assert.match(html, /el\.hexOn, 'Щільність'/u, `${name}: перемикач`);
    const layer = html.indexOf('// щільність доповідей');
    const markers = html.indexOf('// маркери', layer);
    assert.ok(layer > 0 && markers > layer, `${name}: шар під маркерами`);
  }
});
