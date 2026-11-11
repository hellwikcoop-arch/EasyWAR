import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import {
  CENTER_FRAME, EMBLEMS, EMBLEM_DIR, EMBLEM_FRAMES, commandEmblemKey, frameIndex, framePosition, shouldTurn,
} from '../src/start-emblems-core.js';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

// Розміри webp без бібліотек: VP8X (розширений, з альфою) або VP8L (без втрат).
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unexpected webp chunk ${chunk}`);
}

test('frame follows the cursor across the card and rests in the centre', () => {
  assert.equal(EMBLEM_FRAMES % 2, 1, 'odd count so the centre frame is the straight view');
  assert.equal(CENTER_FRAME, 6);
  assert.equal(frameIndex(-1), 0);
  assert.equal(frameIndex(0), 6);
  assert.equal(frameIndex(1), 12);
  assert.equal(frameIndex(-7), 0, 'outside the card: edge frame');
  assert.equal(frameIndex(NaN), 6);
  assert.equal(frameIndex(undefined), 6);
  assert.equal(frameIndex(0.5, 5), 3);
  assert.equal(framePosition(0), '0.000%');
  assert.equal(framePosition(6), '50.000%');
  assert.equal(framePosition(12), '100.000%');
});

test('command cards map to their emblem through aria-controls', () => {
  assert.equal(commandEmblemKey('pvk-tile'), 'pvk');
  assert.equal(commandEmblemKey('dshv-tile'), 'dshv');
  assert.equal(commandEmblemKey('sso-tile'), null);
  assert.equal(commandEmblemKey(undefined), null);
});

test('turning stops for reduced motion and the «Анімації» switch', () => {
  assert.equal(shouldTurn(), true);
  assert.equal(shouldTurn({ reducedMotion: true }), false);
  assert.equal(shouldTurn({ motionOff: true }), false);
});

test('every emblem strip exists, is light, local and holds all frames', async () => {
  assert.equal(EMBLEM_DIR, './emblem-3d/');
  for (const [key, { file, aspect }] of Object.entries(EMBLEMS)) {
    const url = new URL(`../src/public/emblem-3d/${file}`, import.meta.url);
    const { size } = await stat(url);
    assert.ok(size <= 420 * 1024, `${key}: ${size} bytes, the launcher must stay light`);
    const { width, height } = webpSize(await readFile(url));
    assert.equal(width % EMBLEM_FRAMES, 0, `${key}: strip width holds ${EMBLEM_FRAMES} frames`);
    const frameAspect = width / EMBLEM_FRAMES / height;
    assert.ok(Math.abs(frameAspect - aspect) < 0.02, `${key}: frame aspect ${frameAspect} vs ${aspect}`);
  }
});

test('index.html loads the emblem layer without touching launcher markup', async () => {
  const html = await read('index.html');
  assert.match(html, /<link href="\.\/start-tech\.css" rel="stylesheet"\/>\n<link href="\.\/start-emblems\.css" rel="stylesheet"\/>/);
  assert.match(html, /<script type="module" src="\.\/start-emblems\.js"><\/script>\n<script type="module" src="\.\/launcher-tools\.js"><\/script>/);
  assert.match(html, /<button class="branch-card" data-branch="air">\s*<div class="bc-icon">\s*<img/, 'the original images stay in the markup as fallback');
  const js = await read('start-emblems.js');
  assert.match(js, /from '\.\/start-emblems-core\.js'/);
  assert.match(js, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(js, /addEventListener\('load'/, 'the original image hides only after the strip loaded');
  assert.doesNotMatch(js, /https?:\/\//, 'no network resources');
  const css = await read('start-emblems.css');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /html\[data-motion="off"\]/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /\.ew-emblem3d-on > img \{ visibility: hidden !important; \}/);
});
