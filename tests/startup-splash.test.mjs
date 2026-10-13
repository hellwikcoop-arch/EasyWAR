import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import {
  SPLASH,
  SPLASH_SLOGAN,
  SPLASH_TILES,
  VIDEO_ZOOM_KEYS,
  progressValue,
  shouldRunSplash,
  splashClockMs,
  splashFinished,
  tileDelayMs,
  videoZoom,
  visibleTileCount,
} from '../src/startup-splash-core.js';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('splash lists the same branches and commands as the start screen, in Ukrainian', async () => {
  assert.deepEqual(SPLASH_TILES.map(t => t.id), ['air', 'rocket', 'artillery', 'pvk', 'dshv']);
  assert.deepEqual(SPLASH_TILES.map(t => t.label), ['Повітряні Сили', 'Ракетні Війська', 'Артилерія', 'Командування ПС', 'Командування ДШВ']);
  const html = await read('index.html');
  for (const label of ['Повітряні Сили', 'Ракетні Війська', 'Артилерія']) {
    assert.ok(html.includes(`<h3>${label}</h3>`), `${label} is a launcher card`);
  }
  for (const tile of SPLASH_TILES) assert.match(tile.label, /^[А-ЯІЇЄҐа-яіїєґ’' ]+$/, `${tile.id}: label is Ukrainian text`);
});

test('tiles appear one after another before the video ends', () => {
  assert.equal(tileDelayMs(0), SPLASH.tilesStartMs);
  assert.equal(tileDelayMs(1) - tileDelayMs(0), SPLASH.tileStaggerMs);
  assert.ok(SPLASH.tilesStartMs < SPLASH.videoMs, 'tiles start under the end of the video');
  assert.equal(visibleTileCount(0), 0);
  assert.equal(visibleTileCount(SPLASH.tilesStartMs - 1), 0);
  assert.equal(visibleTileCount(SPLASH.tilesStartMs), 1);
  assert.equal(visibleTileCount(tileDelayMs(2)), 3);
  assert.equal(visibleTileCount(1e9), SPLASH_TILES.length);
});

test('progress never completes before the launcher is ready', () => {
  assert.equal(progressValue(-500, true), 0);
  assert.equal(progressValue(SPLASH.progressMinMs / 2, true), 0.5);
  assert.equal(progressValue(SPLASH.progressMinMs * 10, true), 1);
  assert.equal(progressValue(SPLASH.progressMinMs * 10, false), 0.9, 'waiting for the launcher holds the bar at 90%');
  assert.equal(splashFinished(SPLASH.progressMinMs + SPLASH.holdMs, false), false);
  assert.equal(splashFinished(SPLASH.progressMinMs, true), false, 'bar must be full and held first');
  assert.equal(splashFinished(SPLASH.progressMinMs + SPLASH.holdMs, true), true);
});

test('clock follows the video, then free-runs after it ends', () => {
  assert.equal(splashClockMs({ videoTimeSec: 1.5, videoEnded: false, msSinceEnd: 0 }), 1500);
  assert.equal(splashClockMs({ videoTimeSec: 99, videoEnded: false, msSinceEnd: 0 }), SPLASH.videoMs, 'never ahead of the video length');
  assert.equal(splashClockMs({ videoTimeSec: 5.3, videoEnded: true, msSinceEnd: 400 }), SPLASH.videoMs + 400);
  assert.equal(splashClockMs({ videoTimeSec: undefined, videoEnded: false, msSinceEnd: 0 }), 0);
});

test('reduced motion skips the splash', () => {
  assert.equal(shouldRunSplash({ reducedMotion: true }), false);
  assert.equal(shouldRunSplash({ reducedMotion: false }), true);
  assert.equal(shouldRunSplash(), true);
});

test('video asset is a small silent H.264 clip as long as the plan expects', async () => {
  const file = new URL('../src/splash/easywar-intro.mp4', import.meta.url);
  const bytes = await readFile(file);
  assert.ok(bytes.length > 100e3 && bytes.length < 1.5e6, `size ${bytes.length}: keep it small, every version stays in git history and ships in each update`);
  assert.equal(bytes.subarray(4, 8).toString('latin1'), 'ftyp', 'MP4 container');
  assert.ok(bytes.includes(Buffer.from('avc1')), 'H.264 plays in WKWebView and WebView2');
  assert.ok(!bytes.includes(Buffer.from('mp4a')), 'no audio track: the app starts every day');
  assert.ok((await stat(file)).size === bytes.length);
});

test('index.html hosts an empty splash shell and loads its stylesheet and module', async () => {
  const html = await read('index.html');
  assert.match(html, /<link href="\.\/startup-splash\.css" rel="stylesheet"\/>/);
  assert.match(html, /<body>\s*<!--[^>]*-->\s*<div class="ew-splash" id="ew-splash"><\/div>/, 'shell is the first element, so it covers the launcher from the first paint');
  assert.match(html, /<script type="module" src="\.\/startup-splash\.js"><\/script>\s*<\/body>/);
  assert.ok(
    html.indexOf('<script type="module" src="./startup-splash.js">') > html.indexOf('<script type="module" src="./launcher-tools.js">'),
    'launcher tools load first',
  );
});

test('splash is local-only, survives a broken video and cannot trap the user', async () => {
  const js = await read('startup-splash.js');
  const css = await read('startup-splash.css');
  assert.doesNotMatch(js, /https?:\/\//, 'no network addresses');
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB/, 'splash stores nothing');
  assert.match(js, /new URL\('\.\/splash\/easywar-intro\.mp4', import\.meta\.url\)/, 'vite emits the video as a hashed asset');
  assert.match(js, /createObjectURL/, 'video is played from a blob, not from the tauri:// scheme');
  assert.match(js, /video\.addEventListener\('error', \(\) => finish\(true\)\)/, 'a broken video removes the splash at once');
  assert.match(js, /setTimeout\(\(\) => finish\(true\), SPLASH\.startTimeoutMs\)/, 'a video that never starts removes the splash');
  assert.match(js, /e\.key === 'Escape'|event\.key === 'Escape'/, 'Escape skips');
  assert.match(js, /prefers-reduced-motion: reduce/, 'respects reduced motion');
  assert.match(js, /launcher\.inert = true[\s\S]*launcher\.inert = false/, 'launcher is not focusable under the splash and is released afterwards');
  assert.match(css, /animation: ew-splash-failsafe 0s linear 20s forwards/, 'CSS removes the splash even if the script never runs');
  assert.match(css, /\.ew-splash__video\s*\{[^}]*object-fit: cover/, 'video fills any window aspect');
});

test('slogan plate hides the baked-in slogan before it types in and carries the new text', async () => {
  assert.match(SPLASH_SLOGAN, /[А-Яа-яІіЇїЄєҐґ]/, 'slogan is in Ukrainian');
  assert.ok(SPLASH_SLOGAN.length <= 48, 'slogan fits the plate on one line');
  // у відео старий слоган набирається з ~2,6 с: табличка має бути закрита раніше
  assert.ok(SPLASH.plateInMs < 2600, 'plate closes before the old slogan starts to type');
  assert.ok(SPLASH.plateInMs < SPLASH.sloganInMs, 'text appears after the plate');
  assert.ok(SPLASH.sloganInMs < SPLASH.tilesStartMs, 'text appears before the tiles');
  const js = await read('startup-splash.js');
  const css = await read('startup-splash.css');
  assert.match(js, /ew-splash__plate/);
  assert.match(js, /ew-splash__stage/);
  assert.match(js, /plate\.classList\.toggle\('is-in', clock >= SPLASH\.plateInMs\)/);
  assert.match(js, /stage\.style\.transform = `scale\(\$\{videoZoom\(clock\)/, 'plate follows the video zoom');
  assert.match(css, /\.ew-splash__plate\s*\{[^}]*top: 71\.9%/, 'plate sits where the old slogan is');
  assert.match(css, /\.ew-splash__stage\s*\{[^}]*transform-origin: 50% 37\.5%/, 'zoom origin matches the video');
});

test('video zoom is piecewise linear, clamped and ends at 1', () => {
  assert.equal(videoZoom(-100), VIDEO_ZOOM_KEYS[0][1]);
  assert.equal(videoZoom(0), 1.07);
  assert.equal(videoZoom(3600), 1.07);
  assert.ok(Math.abs(videoZoom(3800) - 1.062) < 1e-9, 'midpoint of the 3600..4000 segment');
  assert.equal(videoZoom(SPLASH.videoMs), 1);
  assert.equal(videoZoom(SPLASH.videoMs + 5000), 1);
  assert.equal(VIDEO_ZOOM_KEYS[VIDEO_ZOOM_KEYS.length - 1][0], SPLASH.videoMs, 'last key is the end of the video');
  let prev = Infinity;
  for (let t = 0; t <= SPLASH.videoMs; t += 50) {
    const z = videoZoom(t);
    assert.ok(z <= prev + 1e-12, `zoom never grows (t=${t})`);
    prev = z;
  }
});
