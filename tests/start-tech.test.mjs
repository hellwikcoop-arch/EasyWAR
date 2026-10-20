import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  LINK_DISTANCE,
  MAX_NODES,
  MIN_NODES,
  clockText,
  createNodes,
  linkAlpha,
  links,
  nodeCount,
  shouldAnimate,
  spotlight,
  stepNodes,
} from '../src/start-tech-core.js';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

test('node count follows screen area within bounds', () => {
  assert.equal(nodeCount(0, 0), MIN_NODES);
  assert.equal(nodeCount(390, 844), MIN_NODES);
  assert.equal(nodeCount(1600, 1000), 73);
  assert.equal(nodeCount(5120, 2880), MAX_NODES);
});

test('nodes stay on screen and wrap around the edges', () => {
  const nodes = createNodes(40, 800, 600, seeded(7));
  assert.equal(nodes.length, 40);
  for (let i = 0; i < 200; i += 1) stepNodes(nodes, 800, 600, 16);
  for (const n of nodes) {
    assert.ok(n.x >= 0 && n.x < 800, `x ${n.x}`);
    assert.ok(n.y >= 0 && n.y < 600, `y ${n.y}`);
  }
  const edge = [{ x: 799.9, y: 1, vx: 0.01, vy: -0.01 }]; // x виходить за правий край
  stepNodes(edge, 800, 600, 1000); // довгий кадр обрізається до 64 мс
  assert.ok(Math.abs(edge[0].x - 0.54) < 1e-9);
  assert.ok(Math.abs(edge[0].y - 0.36) < 1e-9);
});

test('links fade with distance and vanish past the limit', () => {
  assert.equal(linkAlpha(LINK_DISTANCE), 0);
  assert.equal(linkAlpha(-1), 0);
  assert.equal(linkAlpha(NaN), 0);
  assert.equal(linkAlpha(0), 0.42);
  assert.ok(linkAlpha(30) > linkAlpha(90));
  const pairs = links([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 500, y: 0 }]);
  assert.deepEqual(pairs.map(([i, j]) => [i, j]), [[0, 1]]);
});

test('spotlight maps the pointer into the card in percent', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };
  assert.deepEqual(spotlight(rect, 200, 100), { x: 50, y: 50 });
  assert.deepEqual(spotlight(rect, 0, 500), { x: 0, y: 100 });
  assert.deepEqual(spotlight({ left: 0, top: 0, width: 0, height: 0 }, 5, 5), { x: 50, y: 50 });
});

test('animation stops for reduced motion, hidden tab and an open module', () => {
  assert.equal(shouldAnimate(), true);
  assert.equal(shouldAnimate({ reducedMotion: true }), false);
  assert.equal(shouldAnimate({ documentHidden: true }), false);
  assert.equal(shouldAnimate({ activeBranch: 'air' }), false);
});

test('clock shows local time and date with leading zeros', () => {
  assert.deepEqual(clockText(new Date(2026, 9, 9, 3, 7, 5)), { time: '03:07:05', date: '09.10.2026' });
});

test('index.html loads the tech layer without touching launcher markup', async () => {
  const html = await read('index.html');
  assert.match(html, /<link href="\.\/startup-splash\.css" rel="stylesheet"\/>\n<link href="\.\/start-tech\.css" rel="stylesheet"\/>/);
  assert.match(html, /<script type="module" src="\.\/launcher-tools\.js"><\/script>\n<script type="module" src="\.\/start-tech\.js"><\/script>\n<script type="module" src="\.\/startup-splash\.js"><\/script>/);
  const js = await read('start-tech.js');
  assert.match(js, /from '\.\/start-tech-core\.js'/);
  assert.match(js, /setAttribute\('aria-hidden', 'true'\)/, 'decor is hidden from screen readers');
  assert.doesNotMatch(js, /https?:\/\//, 'no network resources');
  const css = await read('start-tech.css');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /html\[data-motion="off"\]/);
  assert.match(css, /pointer-events: none/);
});
