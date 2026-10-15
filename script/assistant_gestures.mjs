#!/usr/bin/env node
// Fixed-lighting arm rig for the short gesture clips. The resting cutout is
// sourced from colonel-kombat.png, with both hands behind the back.
// Developer tools only: Playwright, Chromium, ImageMagick 7 (`magick`),
// and FFmpeg for optional GIF exports.
// Usage: node script/assistant_gestures.mjs [--gif-dir /absolute/export/path]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'src/assistant/assets');
const width = 384, height = 576, frames = 23, frameMs = 100;
const gestures = ['wave', 'explain', 'point'];
const require = createRequire(import.meta.url);

function argumentsFor(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    console.log('Usage: node script/assistant_gestures.mjs [--gif-dir /absolute/export/path]\nRequires development Playwright, Chromium, and ImageMagick 7. Optional GIF exports also require FFmpeg.');
    return null;
  }
  if (!argv.length) return {};
  if (argv.length === 2 && argv[0] === '--gif-dir' && isAbsolute(argv[1])) return { gifDir: resolve(argv[1]) };
  throw new Error('Expected no arguments, or --gif-dir followed by an absolute export directory.');
}

function magick(args) {
  const result = spawnSync('magick', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ImageMagick failed (${result.status}): ${result.stderr.trim()}`);
}

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg failed (${result.status}): ${result.stderr.trim()}`);
}

// Walk actual GIF blocks. Only the GCE disposal bits are changed; compressed
// image bytes and coincidental byte patterns inside them are never inspected.
function backgroundDisposalGif(encoded) {
  const gif = Buffer.from(encoded);
  function within(offset, length) {
    if (offset < 0 || length < 0 || offset + length > gif.length) throw new Error('Truncated GIF block.');
  }
  function subBlocks(offset) {
    while (true) {
      within(offset, 1);
      const length = gif[offset++];
      if (length === 0) return offset;
      within(offset, length);
      offset += length;
    }
  }
  within(0, 13);
  if (!['GIF87a', 'GIF89a'].includes(gif.toString('ascii', 0, 6))) throw new Error('Expected a GIF export.');
  if (gif.readUInt16LE(6) !== width || gif.readUInt16LE(8) !== height) throw new Error('Unexpected GIF canvas dimensions.');
  let offset = 13;
  if (gif[10] & 0x80) offset += 3 * (1 << ((gif[10] & 7) + 1));
  within(0, offset);
  let imageCount = 0, gceCount = 0, pendingControl = false;
  while (offset < gif.length) {
    const kind = gif[offset];
    if (kind === 0x3b) {
      if (offset + 1 !== gif.length || imageCount !== frames || gceCount !== frames || pendingControl) throw new Error('Unexpected GIF frame/trailer count.');
      return gif;
    }
    if (kind === 0x21) {
      within(offset, 3);
      if (gif[offset + 1] === 0xf9) {
        within(offset, 8);
        if (gif[offset + 2] !== 4 || gif[offset + 7] !== 0 || pendingControl) throw new Error('Invalid GIF graphic control block.');
        if (!(gif[offset + 3] & 1)) throw new Error('GIF frame lacks a transparent palette index.');
        if (gif.readUInt16LE(offset + 4) !== frameMs / 10) throw new Error('Unexpected GIF frame duration.');
        gif[offset + 3] = (gif[offset + 3] & ~0x1c) | (2 << 2);
        gceCount++;
        pendingControl = true;
        offset += 8;
      } else offset = subBlocks(offset + 2);
      continue;
    }
    if (kind === 0x2c) {
      within(offset, 10);
      if (!pendingControl || gif.readUInt16LE(offset + 1) !== 0 || gif.readUInt16LE(offset + 3) !== 0
        || gif.readUInt16LE(offset + 5) !== width || gif.readUInt16LE(offset + 7) !== height) throw new Error('Expected a full-canvas GIF frame.');
      const packed = gif[offset + 9];
      offset += 10;
      if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
      within(offset, 1);
      offset = subBlocks(offset + 1); // Skip the LZW minimum code size and data.
      imageCount++;
      pendingControl = false;
      continue;
    }
    throw new Error('Unexpected GIF block type.');
  }
  throw new Error('Missing GIF trailer.');
}

function uint24(number) {
  if (!Number.isInteger(number) || number < 0 || number > 0xffffff) throw new Error('Invalid WebP 24-bit field.');
  const value = Buffer.alloc(3);
  value.writeUIntLE(number, 0, 3);
  return value;
}

function chunk(tag, data) {
  const header = Buffer.alloc(8);
  header.write(tag, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
}

// Retain the encoded image payload, not any still-image extended header/metadata.
function imageChunks(encoded) {
  if (encoded.toString('ascii', 0, 4) !== 'RIFF' || encoded.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Expected a static WebP frame.');
  if (encoded.readUInt32LE(4) + 8 !== encoded.length) throw new Error('Invalid static WebP length.');
  const chunks = [];
  let imageCount = 0, offset = 12;
  while (offset + 8 <= encoded.length) {
    const tag = encoded.toString('ascii', offset, offset + 4);
    const size = encoded.readUInt32LE(offset + 4);
    const end = offset + 8 + size + size % 2;
    if (end > encoded.length) throw new Error('Truncated static WebP chunk.');
    if (['ALPH', 'VP8 ', 'VP8L'].includes(tag)) chunks.push(encoded.subarray(offset, end));
    if (['VP8 ', 'VP8L'].includes(tag)) imageCount++;
    offset = end;
  }
  if (offset !== encoded.length || imageCount !== 1) throw new Error('Expected exactly one encoded WebP image.');
  return Buffer.concat(chunks);
}

function animatedWebP(encodedFrames) {
  const extended = Buffer.concat([Buffer.from([0x12, 0, 0, 0]), uint24(width - 1), uint24(height - 1)]);
  const animation = Buffer.alloc(6); // Transparent background, infinite container loop.
  const body = [Buffer.from('WEBP'), chunk('VP8X', extended), chunk('ANIM', animation)];
  for (const encoded of encodedFrames) {
    const header = Buffer.concat([
      uint24(0), uint24(0), uint24(width - 1), uint24(height - 1), uint24(frameMs),
      Buffer.from([3]), // NO_BLEND + DISPOSE_BACKGROUND: never accumulate old arms.
    ]);
    body.push(chunk('ANMF', Buffer.concat([header, imageChunks(encoded)])));
  }
  const payload = Buffer.concat(body);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

async function run({ gifDir }) {
  const { chromium } = require('playwright');
  const sources = {};
  for (const [id, filename] of Object.entries({ body: 'body.png', right: 'right-palm.png', left: 'left-rest.png', point: 'left-point.png' })) {
    sources[id] = `data:image/png;base64,${(await readFile(join(assets, 'rig', filename))).toString('base64')}`;
  }
  magick(['-version']);
  if (gifDir) ffmpeg(['-version']);
  const temporary = await mkdtemp(join(tmpdir(), 'easywar-assistant-gestures-'));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    // The rig loads only the four embedded local assets. No server/network is used.
    await page.route('**/*', route => route.abort());
    await page.goto('about:blank');
    await page.evaluate(async ({ sources, width, height }) => {
      const images = {};
      for (const [id, source] of Object.entries(sources)) {
        const image = new Image();
        image.src = source;
        await image.decode();
        images[id] = image;
      }
      const dimensions = { body: [512, 900], right: [200, 230], left: [148, 340], point: [320, 310] };
      for (const [id, [w, h]] of Object.entries(dimensions)) {
        if (images[id].naturalWidth !== w || images[id].naturalHeight !== h) throw new Error(`Unexpected ${id} rig dimensions.`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const radians = angle => angle * Math.PI / 180;
      window.drawGesture = (gesture, time) => {
        context.resetTransform();
        context.clearRect(0, 0, width, height);
        context.save();
        context.scale(.64, .64);
        context.drawImage(images.body, -14, 0);
        let rightAngle = 0;
        if (gesture === 'wave') {
          // One restrained acknowledgement: a slow lift and return, no waving loops.
          rightAngle = 24 * Math.pow(Math.sin(Math.PI * time), 2);
        } else if (gesture === 'explain') rightAngle = -6 * Math.sin(Math.PI * time);
        context.save();
        context.translate(171, 328);
        context.rotate(radians(rightAngle));
        context.scale(.82, .82);
        context.drawImage(images.right, -111, -40);
        context.restore();
        context.save();
        context.translate(438, 326);
        if (gesture === 'point') {
          const angle = 135 - 150 * Math.pow(Math.sin(Math.PI * time), 1.4);
          context.rotate(radians(angle));
          context.scale(.55, .55);
          context.drawImage(images.point, -75, -180);
        } else {
          context.scale(.55, .55);
          context.drawImage(images.left, -58, -32);
        }
        context.restore();
        context.restore();
        return canvas.toDataURL('image/png').split(',')[1];
      };
    }, { sources, width, height });

    await mkdir(assets, { recursive: true });
    magick([join(assets, 'colonel-kombat.png'), '-resize', `${width}x${height}!`, join(assets, 'colonel-kombat-stable.png')]);
    const pngFrames = {};
    for (const gesture of gestures) {
      pngFrames[gesture] = [];
      const encodedFrames = [];
      for (let index = 0; index < frames; index++) {
        const prefix = join(temporary, `${gesture}-${String(index).padStart(2, '0')}`);
        const png = `${prefix}.png`, webp = `${prefix}.webp`;
        const pixels = await page.evaluate(({ gesture, time }) => window.drawGesture(gesture, time), { gesture, time: index / (frames - 1) });
        await writeFile(png, Buffer.from(pixels, 'base64'));
        pngFrames[gesture].push(png);
        magick([png, '-define', 'webp:lossless=true', '-define', 'webp:exact=true', '-quality', '100', webp]);
        encodedFrames.push(await readFile(webp));
      }
      await writeFile(join(assets, `colonel-${gesture}.webp`), animatedWebP(encodedFrames));
    }
    if (gifDir) {
      await mkdir(gifDir, { recursive: true });
      const palette = join(temporary, 'shared-palette.png');
      // One shared palette across all 69 frames, including a reserved transparent
      // entry. No dithering: frozen face pixels always map to the same color.
      const allFrames = Object.values(pngFrames).flat();
      for (let index = 0; index < allFrames.length; index++) {
        await copyFile(allFrames[index], join(temporary, `palette-${String(index).padStart(3, '0')}.png`));
      }
      ffmpeg([
        '-filter_threads', '1', '-framerate', String(1000 / frameMs), '-i', join(temporary, 'palette-%03d.png'),
        '-vf', 'palettegen=max_colors=256:reserve_transparent=1:stats_mode=full',
        '-frames:v', '1', '-update', '1', '-y', palette,
      ]);
      for (const gesture of gestures) {
        const output = join(gifDir, `kombat-${gesture}.gif`);
        ffmpeg([
          '-filter_complex_threads', '1', '-framerate', String(1000 / frameMs), '-i', join(temporary, `${gesture}-%02d.png`), '-i', palette,
          '-lavfi', 'paletteuse=dither=none:alpha_threshold=128', '-frames:v', String(frames),
          '-gifflags', '-offsetting-transdiff', '-loop', '0', '-y', output,
        ]);
        await writeFile(output, backgroundDisposalGif(await readFile(output)));
      }
      await copyFile(join(assets, 'colonel-kombat-stable.png'), join(gifDir, 'kombat-still.png'));
    }
    console.log(`Built ${gestures.length} fixed-lighting clips: ${frames} full ${width}×${height} frames × ${frameMs} ms (${frames * frameMs} ms).`);
    console.log(`Assets: ${assets}${gifDir ? `\nGIF exports: ${gifDir}` : ''}`);
  } finally {
    if (browser) await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  const options = argumentsFor(process.argv.slice(2));
  if (options) await run(options);
} catch (error) {
  console.error(`${basename(fileURLToPath(import.meta.url))}: ${error.message}`);
  process.exitCode = 1;
}
