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
  assert.match(html, /const MODULE_SRC = \{air:'\.\/air\.html', rocket:'\.\/rocket\.html', pvk:'\.\/air\.html\?command=pvk', dshv:'\.\/rocket\.html\?command=dshv'\};/);
  assert.match(html, /frame\.src = MODULE_SRC\[branch\];/);
  assert.doesNotMatch(html, /application\/x-easywar-module/, 'base64 module payloads must not be shipped');
  assert.doesNotMatch(html, /\.srcdoc\s*=/);
});

test('army aviation is a dimmed branch block that does not open a module yet', async () => {
  const html = await read('index.html');
  const card = html.match(/<div class="branch-card branch-card-soon"[^>]*>[\s\S]*?<\/h3>\s*<span class="bc-soon">([^<]+)<\/span>/);
  assert.ok(card, 'army aviation card is on the start screen');
  assert.match(card[0], /aria-disabled="true"/);
  assert.match(card[0], /<h3>Армійська Авіація<\/h3>/);
  assert.equal(card[1], 'У розробці');
  assert.doesNotMatch(card[0], /data-branch=/, 'no module behind it yet');
  assert.match(html, /querySelectorAll\('\.branch-card\[data-branch\]'\)/, 'only real branches get a click handler');
  assert.match(html, /\.branch-card\.branch-card-soon\{[^}]*opacity:\.42[^}]*pointer-events:none/);
});

test('artillery is a separate dimmed block next to army aviation, and the rocket card is just «Ракетні Війська»', async () => {
  const html = await read('index.html');
  const card = html.match(/<div class="branch-card branch-card-soon" data-soon="artillery"[^>]*>[\s\S]*?<\/h3>\s*<span class="bc-soon">([^<]+)<\/span>/);
  assert.ok(card, 'artillery card is on the start screen');
  assert.match(card[0], /aria-disabled="true"/);
  assert.match(card[0], /aria-label="Артилерія — у розробці"/);
  assert.match(card[0], /<h3>Артилерія<\/h3>/);
  assert.equal(card[1], 'У розробці');
  assert.doesNotMatch(card[0], /data-branch=/, 'no module behind it yet');
  assert.match(html, /<h3>Ракетні Війська<\/h3>/);
  assert.doesNotMatch(html, /Війська і Артилерія/);
  // кожен із двох блоків «у розробці» стоїть у своїй колонці, а не на всю ширину
  assert.match(html, /\.branch-card\.branch-card-soon\{grid-column:auto;/);
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

test('PVK emblem is a launcher card that opens the PVK tile and in the PVK dashboard hero', async () => {
  const html = await read('index.html');
  const card = html.match(/<button[^>]*data-cmd-card[^>]*><div class="bc-icon"><img[^>]*src="data:image\/webp;base64,[^"]+"><\/div><h3>([^<]+)<\/h3>/);
  assert.ok(card, 'launcher has a PVK card with the logo, like the other branch cards');
  assert.match(html, /<section class="command-tile" data-command="pvk" id="pvk-tile"[^>]*hidden>/, 'the PVK tile opens from the card and starts hidden');
  assert.match(html, /<button[^>]*data-cmd-card[^>]*aria-controls="dshv-tile"[^>]*><div class="bc-icon"><img[^>]*src="data:image\/webp;base64,/, 'the ДШВ command card carries its logo too');
  assert.match(html, /<section class="command-tile" data-command="dshv" id="dshv-tile"[^>]*hidden>/, 'the ДШВ tile opens from its card');
  const css = await read('pvk-dashboard.css');
  assert.match(css, /\.pvk-hero::before[^}]*pvk-art\/emblem\.webp/, 'dashboard hero uses the emblem');
  const emblem = await readFile(new URL('../src/pvk-art/emblem.webp', import.meta.url));
  assert.ok(emblem.length > 1000 && emblem.length < 40000, 'emblem is a small webp');
});
