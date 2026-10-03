import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const src = (name) => new URL(`../src/${name}`, import.meta.url);
const read = (name) => readFile(src(name), 'utf8');

test('mobile viewer opens only the two command dashboards and never reaches for the desktop shell', async () => {
  const html = await read('viewer.html');
  assert.match(html, /var SRC = \{ pvk: '\.\/air\.html\?command=pvk&viewer=1', dshv: '\.\/rocket\.html\?command=dshv&viewer=1' \};/);
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.doesNotMatch(html, /__TAURI__|invoke\(/, 'the phone viewer must not call desktop-only commands');
  assert.match(html, /location\.protocol !== 'file:'/, 'service worker must not be registered from file://');
  assert.match(html, /register\('\.\/sw\.js'\)/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
});

test('web manifest is installable and its icons exist', async () => {
  const manifest = JSON.parse(await read('public/manifest.webmanifest'));
  assert.equal(manifest.start_url, './viewer.html');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, './');
  const sizes = manifest.icons.map((icon) => icon.sizes).sort();
  assert.deepEqual(sizes, ['192x192', '512x512']);
  for (const icon of manifest.icons) await access(src(`public/${icon.src.replace(/^\.\//, '')}`));
});

test('build emits the viewer page and a service worker that skips 3D models', async () => {
  const config = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /viewer: fileURLToPath\(new URL\("\.\/src\/viewer\.html"/);
  assert.match(config, /!name\.endsWith\("\.glb"\)/, 'aircraft/munition models are not needed by the command dashboards');
  assert.match(config, /easywar-viewer-\$\{version\}/, 'cache name must follow the package version so new releases replace the old cache');
});

test('command dashboards hide desktop-only header controls on a phone', async () => {
  const air = await read('air.html');
  const rocket = await read('rocket.html');
  assert.match(air, /@media \(max-width: 640px\) \{\s*html\[data-command="pvk"\] #ewx-open, html\[data-command="pvk"\] #dashboardSourceToggle, html\[data-command="pvk"\] #motionBtn \{ display: none !important; \}/);
  assert.match(rocket, /html\[data-command="dshv"\] #ewx-open, html\[data-command="dshv"\] #motionBtn \{ display: none !important; \}/);
});
