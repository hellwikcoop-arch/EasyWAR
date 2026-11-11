import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CATEGORY, cardCategory, currentPage, pageCount, pageOffset, stepPage, wheelDelta } from '../src/start-carousel-core.js';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('category labels tell commands from branches on equal cards', () => {
  assert.equal(cardCategory({ command: true, branch: '' }), CATEGORY.command);
  assert.equal(cardCategory({ branch: 'air' }), CATEGORY.branch);
  assert.equal(cardCategory({ branch: 'custom' }), CATEGORY.custom);
  assert.equal(cardCategory(), CATEGORY.branch);
});

test('pages follow the strip width and the current scroll offset', () => {
  assert.equal(pageCount(1100, 1100), 1);
  assert.equal(pageCount(1105, 1100), 1, 'a few leftover pixels are not a page');
  assert.equal(pageCount(2184, 1100), 2);
  assert.equal(pageCount(0, 0), 1);
  assert.equal(currentPage(0, 1100, 2), 0);
  assert.equal(currentPage(1084, 1100, 2), 1);
  assert.equal(currentPage(5000, 1100, 2), 1, 'clamped to the last page');
  assert.equal(currentPage(10, 0, 2), 0);
  assert.equal(pageOffset(1, 1100, 2184), 1084, 'the last page ends at the strip end');
  assert.equal(pageOffset(0, 1100, 2184), 0);
  assert.equal(stepPage(0, 1, 2), 1);
  assert.equal(stepPage(1, 1, 2), 1);
  assert.equal(stepPage(0, -1, 2), 0);
});

test('vertical wheel turns into horizontal scrolling', () => {
  assert.equal(wheelDelta({ deltaY: 40 }), 40);
  assert.equal(wheelDelta({ deltaX: -30, deltaY: 5 }), -30);
  assert.equal(wheelDelta(), 0);
});

test('index.html loads the carousel without touching launcher markup', async () => {
  const html = await read('index.html');
  assert.match(html, /<link href="\.\/start-emblems\.css" rel="stylesheet"\/>\n<link href="\.\/start-carousel\.css" rel="stylesheet"\/>/);
  assert.match(html, /<script type="module" src="\.\/start-carousel\.js"><\/script>\n<script type="module" src="\.\/start-emblems\.js"><\/script>/);
  assert.match(html, /<div class="branch-cards">\s*<div class="branch-col" data-col="air">/, 'the card grid and its columns stay as they were');
  const js = await read('start-carousel.js');
  assert.match(js, /from '\.\/start-carousel-core\.js'/);
  assert.match(js, /'aria-label': 'Попередні картки'/);
  assert.match(js, /'aria-label': 'Наступні картки'/);
  assert.match(js, /classList\.add\('ew-start-carousel'\)/, 'styles apply only once the script ran');
  assert.doesNotMatch(js, /https?:\/\//, 'no network resources');
  const css = await read('start-carousel.css');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /html\[data-motion="off"\]/);
  assert.match(css, /\.cmd-slot\[data-open\] \.cmd-card \{ display: none !important; \}/, 'an open command slot still swaps its card for the tile');
  assert.ok(css.split('\n').filter((line) => line.trim() && !line.trim().startsWith('/*') && !line.trim().startsWith('*')).every((line) => line.includes('ew-start-carousel') || line.startsWith('}') || line.startsWith('@media') || line.startsWith('  ') || line.startsWith('html[data-motion')), 'every rule is gated by html.ew-start-carousel');
});
