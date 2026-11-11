import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { LOGO, LOGO_CENTER_FRAME, boxStyle, frameIndex, framePosition, logoTilt } from '../src/start-logo-3d-core.js';
import { EMBLEM_DIR } from '../src/start-emblems-core.js';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

// Розміри webp без бібліотек (як у start-emblems.test.mjs).
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

test('the trident box sits inside the logo and turns into percentages', () => {
  const { box, image } = LOGO;
  assert.ok(box.left > 0 && box.top > 0 && box.left + box.width < image.width && box.top + box.height < image.height);
  assert.ok(Math.abs(box.left + box.width / 2 - image.width / 2) < 12, 'the trident is centred on the logo');
  assert.ok(Math.abs(box.width / box.height - LOGO.aspect) < 0.02, 'box keeps the frame aspect');
  const style = boxStyle({ left: 86, top: 95.8, width: 430, height: 479 }, { width: 860, height: 958 });
  assert.deepEqual(style, { left: '10.000%', top: '10.000%', width: '50.000%', height: '50.000%' });
  assert.equal(LOGO.frames % 2, 1);
  assert.equal(LOGO_CENTER_FRAME, 6);
});

test('cursor across the start screen turns the trident around the logo centre', () => {
  const rect = { left: 100, width: 400 };
  assert.equal(logoTilt(300, rect), 0);
  assert.equal(logoTilt(100, rect), -0.5);
  assert.equal(logoTilt(700, rect), 1);
  assert.equal(logoTilt(-1000, rect), -1);
  assert.equal(logoTilt(300, { left: 0, width: 0 }), 0);
  assert.equal(logoTilt(300, undefined), 0);
  assert.equal(frameIndex(logoTilt(300, rect), LOGO.frames), LOGO_CENTER_FRAME);
  assert.equal(framePosition(LOGO_CENTER_FRAME, LOGO.frames), '50.000%');
});

test('logo files exist, are light, local and hold all frames', async () => {
  const dir = new URL(`../src/public/${EMBLEM_DIR.replace(/^\.\//, '')}`, import.meta.url);
  const strip = await readFile(new URL(LOGO.strip, dir));
  assert.ok(strip.length <= 420 * 1024, `strip ${strip.length} bytes`);
  const { width, height } = webpSize(strip);
  assert.equal(width % LOGO.frames, 0);
  assert.ok(Math.abs(width / LOGO.frames / height - LOGO.aspect) < 0.02, `frame aspect ${width / LOGO.frames / height}`);
  const base = await stat(new URL(LOGO.base, dir));
  assert.ok(base.size <= 420 * 1024, `base ${base.size} bytes`);
  const baseSize = webpSize(await readFile(new URL(LOGO.base, dir)));
  assert.deepEqual(baseSize, { width: LOGO.image.width, height: LOGO.image.height }, 'the base matches the inline logo size');
});

test('index.html loads the logo layer without touching the logo markup', async () => {
  const html = await read('index.html');
  assert.match(html, /<link href="\.\/start-carousel\.css" rel="stylesheet"\/>\n<link href="\.\/start-logo-3d\.css" rel="stylesheet"\/>/);
  assert.match(html, /<script type="module" src="\.\/start-logo-3d\.js"><\/script>\n<script type="module" src="\.\/start-carousel\.js"><\/script>/);
  assert.match(html, /<div aria-label="easyWAR — Обери свій рід військ" class="start-brand start-brand-reference">\n<img alt="easyWAR — Обери свій рід військ" class="start-brand-art"/, 'the inline logo stays as fallback');
  const js = await read('start-logo-3d.js');
  assert.match(js, /from '\.\/start-logo-3d-core\.js'/);
  assert.match(js, /Promise\.all\(\[load\(base\), load\(strip\)\]\)/, 'the inline logo hides only after both files loaded');
  assert.match(js, /setAttribute\('aria-hidden', 'true'\)/);
  assert.doesNotMatch(js, /https?:\/\//, 'no network resources');
  const css = await read('start-logo-3d.css');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /html\[data-motion="off"\]/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /\.ew-logo3d\.ew-logo3d-on > \.start-brand-art \{ visibility: hidden !important; \}/);
});
