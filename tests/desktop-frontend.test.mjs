import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] || '';
    if (/\bsrc=/.test(attrs) || /type="(?!text\/javascript)[^"]+"/.test(attrs)) continue;
    scripts.push(match[2]);
  }
  return scripts;
}

test('launcher opens both branch modules as same-origin pages', async () => {
  const html = await read('index.html');
  assert.match(html, /<iframe class="module-frame" id="frame-air"/);
  assert.match(html, /<iframe class="module-frame" id="frame-rocket"/);
  assert.match(html, /const MODULE_SRC = \{air:'\.\/air\.html', rocket:'\.\/rocket\.html'\};/);
  assert.match(html, /frame\.src = MODULE_SRC\[branch\];/);
  assert.doesNotMatch(html, /application\/x-easywar-module/, 'base64 module payloads must not be shipped');
  assert.doesNotMatch(html, /\.srcdoc\s*=/);
});

test('air module keeps desktop integrations and v3.1 isolation', async () => {
  const html = await read('air.html');
  const bridge = html.indexOf('id="easywar-desktop-frame-bridge"');
  const namespace = html.indexOf("const NS = 'easywar.air::';");
  assert.ok(bridge > 0 && namespace > bridge, 'IPC bridge must run before module code');
  assert.ok(html.indexOf('<meta charset="utf-8">') > namespace);
  for (const script of ['xlsx-inspection', 'sqlite-dashboard-source']) {
    assert.match(html, new RegExp(`<script type="module" src="\\./${script}\\.js"></script>`));
  }
  // Profile, backup/updates and Signal moved to the start screen.
  for (const script of ['signal-settings', 'backup', 'local-profiles']) {
    assert.doesNotMatch(html, new RegExp(`src="\\./${script}\\.js"`));
  }
  assert.match(html, /id="tab-base"/, 'desktop «База даних» tab stays available');
  assert.match(html, /class="branch-service-mark"/);
  assert.match(html, /id="easywar-volja-module-brand"/);
});

test('rocket module is the v3.1 branch module plus the module editor only', async () => {
  const html = await read('rocket.html');
  assert.match(html, /const NS = 'easywar\.rocket::';/);
  assert.doesNotMatch(html, /easywar-desktop/);
  assert.match(html, /window\.__EW_EDITOR_HOOKS__/);
});

test('desktop bridge reuses the parent Tauri IPC inside the iframe', async () => {
  const html = await read('air.html');
  const start = html.indexOf('<script id="easywar-desktop-frame-bridge">');
  const body = html.slice(html.indexOf('>', start) + 1, html.indexOf('</script>', start));
  const internals = { invoke() {} };
  const parent = { __TAURI_INTERNALS__: internals };
  const frame = { parent, console };
  vm.runInNewContext(body, { window: frame, console, Object });
  assert.equal(frame.__TAURI_INTERNALS__, internals);
  assert.equal(frame.isTauri, true);

  const standalone = { console };
  standalone.parent = standalone;
  vm.runInNewContext(body, { window: standalone, console, Object });
  assert.equal(standalone.__TAURI_INTERNALS__, undefined);
});

test('inline scripts of all desktop pages parse', async () => {
  for (const name of ['index.html', 'air.html', 'rocket.html']) {
    const scripts = inlineScripts(await read(name));
    assert.ok(scripts.length > 0, name);
    scripts.forEach((code, index) => {
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${name}#${index}` }), `${name} script ${index}`);
    });
  }
});

test('start screen hosts profile, backup, updates and Signal', async () => {
  const html = await read('index.html');
  const start = html.indexOf('<main class="start-screen" id="view-start">');
  const toolbar = html.indexOf('class="appbar-right ew-start-tools"');
  assert.ok(start > 0 && toolbar > start && toolbar < html.indexOf('</main>', start), 'toolbar sits on the start screen');
  assert.match(html, /<script type="module" src="\.\/launcher-tools\.js"><\/script>/);
  assert.match(html, /window\.EW_LAUNCHER = \{ openBranch, isLoaded: /);
  assert.match(html, /new CustomEvent\('ew:branch-open', \{ detail: \{ branch \} \}\)/);

  const tools = await read('launcher-tools.js');
  const order = ['signal-settings', 'backup', 'local-profiles'].map(name => tools.indexOf(`import './${name}.js';`));
  assert.ok(order.every(index => index > 0), 'all three tools are loaded');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'prepend order gives Профіль, Резервна копія, Оновлення, Signal');
});
