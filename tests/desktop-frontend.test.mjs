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
  assert.match(html, /const MODULE_SRC = \{air:'\.\/air\.html', rocket:'\.\/rocket\.html', artillery:'\.\/artillery\.html', pvk:'\.\/air\.html\?command=pvk', dshv:'\.\/rocket\.html\?command=dshv'\};/);
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

test('artillery is a live block next to the dimmed army aviation, and the rocket card is just «Ракетні Війська»', async () => {
  const html = await read('index.html');
  const card = html.match(/<button class="branch-card branch-card-soon branch-card-live" data-branch="artillery"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(card, 'artillery card is on the start screen');
  assert.doesNotMatch(card[0], /тестування|bc-live/, 'no beta label on the artillery card');
  assert.match(card[0], /<h3>Артилерія<\/h3>/);
  assert.doesNotMatch(card[0], /aria-disabled/, 'the module opens now');
  assert.match(html, /artillery:'\.\/artillery\.html'/);
  assert.match(html, /<iframe class="module-frame" id="frame-artillery"/);
  assert.match(html, /<div class="branch-card branch-card-soon" data-soon="army-aviation"[^>]*aria-disabled="true"/, 'army aviation is still dimmed');
  assert.match(html, /<h3>Ракетні Війська<\/h3>/);
  assert.doesNotMatch(html, /Війська і Артилерія/);
  assert.match(html, /\.branch-card\.branch-card-soon\{grid-column:auto;/);
  const vite = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /artillery: fileURLToPath\(new URL\("\.\/src\/artillery\.html"/);
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

test('rocket module has the «База даних» tab: sheet columns as imported, hidden in the DShV command mode', async () => {
  const html = await read('rocket.html');
  assert.match(html, /id="tab-base"[^>]*>База даних<\/button>/);
  assert.match(html, /<main id="view-base" class="dash basev"/);
  assert.match(html, /const VORDER = \['dash', 'base', 'entry', 'ref'\];/);
  assert.match(html, /if \(v === 'base'\) renderBase\(\);/);
  assert.match(html, /onclick: \(\) => showView\('base'\) \}, icon\('db'\), h\('span', \{ text: 'База даних' \}\)/);
  assert.match(html, /class: 'snav-b snav-entry2', onclick: \(\) => showView\('entry'\)/);
  // Table = FIELD_ORDER columns that exist in the file, headers from FIELD_HEADERS, raw record values.
  assert.match(html, /const fields = window\.AVCORE\.FIELD_ORDER\.filter\(f => wb\.colByField\[f\]\)/);
  assert.match(html, /\[fields\.map\(f => window\.AVCORE\.FIELD_HEADERS\[f\]\)\]/);
  assert.match(html, /html\[data-command="dshv"\] #tab-base, html\[data-command="dshv"\] \.snav-entry2/);
  // «Мій дашборд» is still inserted before the first separator entry (now «База даних»).
  assert.match(await read('dashboard-module-catalog.js'), /nav\.querySelector\(':scope > \.snav-entry'\)/);
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

test('start screen is neutral and fits 16:9 / 16:10 monitors; tile grids are balanced', async () => {
  const html = await read('index.html');
  assert.match(html, /<style id="easywar-start-wide">[\s\S]*?min-aspect-ratio:3\/2[\s\S]*?repeat\(4,minmax\(0,1fr\)\)/, 'four cards in one row on wide monitors');
  assert.match(html, /function fitStart\(\)[\s\S]*?box\.style\.zoom/, 'start box is scaled down instead of scrolling');
  for (const page of ['air.html', 'rocket.html']) {
    const doc = await read(page);
    assert.match(doc, /<style id="easywar-kpi-balance">[\s\S]*?nth-child\(6\):last-child[\s\S]*?repeat\(3/, `${page}: six tiles lay out as 3×2`);
  }
  const pvk = await read('pvk-dashboard.css');
  assert.match(pvk, /nth-child\(7\):last-child\),\s*\.pvk-kpis:has\(> :nth-child\(8\):last-child\) \{ grid-template-columns: repeat\(4/, 'PVK seven tiles lay out as 4+3');
  assert.match(pvk, /grid-column: 1 \/ -1;\s*justify-self: center;/, 'PVK dashboard is centred in the module grid');
});

test('artillery page is a module of its own with the shared-file entry flow', async () => {
  const html = await read('artillery.html');
  assert.match(html, /<script type="module" src="\.\/artillery-app\.js">/);
  assert.match(html, /aviahub\.theme/, 'follows the launcher theme switch');
  const app = await read('artillery-app.js');
  assert.match(app, /showOpenFilePicker/);
  assert.match(app, /createWritable/);
  assert.match(app, /file\.lastModified !== S\.lastModified/, 'merges onto a newer copy of the shared file');
  assert.match(app, /PERIODS/);
  assert.match(app, /Від якого підрозділу вносимо дані/, 'на вкладці «Внесення» спершу обирається підрозділ');
  assert.match(app, /from '\.\/unit-emblems\.js'/, 'емблеми підрозділів — спільний модуль');
  assert.match(await read('unit-emblems.js'), /unit-art\/\*\.webp/);
  assert.doesNotMatch(app, /innerHTML/, 'table text goes in as text, never as markup');
});

test('artillery shows an ammunition icon for every caliber group and a charge icon for every charge type', async () => {
  const app = await read('artillery-app.js');
  assert.match(app, /import\.meta\.glob\('\.\/ammo-art\/\*\.webp'/);
  assert.match(app, /from '\.\/artillery-icons-core\.js'/);
  const core = await read('artillery-icons-core.js');
  for (const group of ['155 мм ОФ', '155 мм касетні', '155 мм дист. мінування', '155 мм димові й освітлювальні', '122 мм РС', '120 мм', 'Високоточні', 'Заряди']) assert.ok(core.includes(`'${group}'`), group);
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(new URL('../src/ammo-art/', import.meta.url))).sort();
  assert.deepEqual(files, ['105', '120-mortar', '122', '122-rocket', '152', '155-cluster', '155-he', '155-scatter', '155-smoke', '203', '227', '60-mortar', '82-mortar', 'charge-bmcs', 'charge-m119a2', 'charge-m203a1', 'charge-m3a1', 'charge-m4a2', 'guided', 'other'].map((n) => `${n}.webp`).sort());
});

test('дашборд УДШВ показує емблеми підрозділів, а плитки Артилерії мають фони з наявних ілюстрацій', async () => {
  const dash = await read('udshv-dashboard.js');
  assert.match(dash, /from '\.\/unit-emblems\.js'/);
  for (const part of ["h('span', { class: 'ud-rank-name' }, units ? crest(item.name", "class: 'ud-link ud-unitname'", "crest(u, 'ud-crest ud-crest-sm')"]) assert.ok(dash.includes(part), part);
  const css = await read('udshv-dashboard.css');
  for (const part of ['.ud-crest', '.ud-crest.crest-ph', '.ud-unitname']) assert.ok(css.includes(part), part);
  const art = await read('artillery.css');
  for (const key of ['gun', 'crossed', 'shells', 'guided', 'charges']) assert.ok(art.includes(`.kpi[data-art="${key}"]::after`), key);
  assert.match(art, /:root\[data-theme="light"\] \.kpi\[data-art\]::after/);
  assert.match(await read('artillery-app.js'), /'data-art': art \|\| null/);
});

test('ПС і РВ: картка «Відкрийте таблицю» на всю сітку, а список «Тип цілі» в РВ прокручується', async () => {
  for (const page of ['air.html', 'rocket.html']) {
    const html = await read(page);
    assert.match(html, /#view-dash\.shell > \.side\[hidden\] ~ \.dmain \{ grid-column: 1 \/ -1; \}/, page);
    assert.match(html, /\.dmain > \.dpanel\.empty-state \{ justify-self: center; width: min\(640px, 100%\)/, page);
  }
  const kit = await read('ui-kit.css');
  assert.match(kit, /#p-types \.tt-list\.tt-list \{[^}]*overflow-y: auto; overscroll-behavior: contain;/, 'РВ');
  assert.doesNotMatch(kit, /#p-types \.tt-list\.tt-list \{[^}]*overflow: hidden/);
});

test('artillery ammunition tab has a type × unit matrix, filters, low-stock marks and distribution charts', async () => {
  const app = await read('artillery-app.js');
  for (const part of ['Матриця «тип × підрозділ»', 'ammoMatrix', 'ammoCharts', 'stockState', "'Калібр'", "'Клас'", 'Малий залишок', 'Лише з малим залишком', 'Вичерпано', 'Розподіл']) assert.ok(app.includes(part), part);
  assert.match(app, /createElementNS\(SVG_NS/, 'діаграми — SVG без innerHTML');
  const css = await read('artillery.css');
  for (const part of ['.matrix-t', 'td.mx.lo', 'td.mx.out', '.donut', '--c8']) assert.ok(css.includes(part), part);
});

test('вікно УДШВ: підпис «Десантно-штурмові війська» під EASYWAR, без окремої верхньої смуги', async () => {
  const html = await readFile(new URL('../src/rocket.html', import.meta.url), 'utf8');
  assert.match(html, /dataset\.command==='dshv'\?'Десантно-штурмові війська'/u);
  assert.doesNotMatch(html, /udshv-open\)::before \{ content:/u);
});

test('стартові екрани без таблиці: три кроки, перетягування, «Продовжити з …» і ескіз дашборда', async () => {
  for (const page of ['air.html', 'rocket.html']) {
    const html = await read(page);
    assert.match(html, /el\.empty = startScreen\(\);/, page);
    assert.match(html, /h\('section', \{ class: 'dpanel empty-state es', hidden: true \}/, page);
    assert.match(html, /\{ pvk: 'Повітряне командування', dshv: 'Десантно-штурмові війська' \}/, page);
    assert.match(html, /refresh: refreshFromDisk, resume: resumeStored \}/, page);
    assert.match(html, /S\.storedHandle = fh; if \(!S\.wb\) renderFile\(\); document\.dispatchEvent\(new Event\('ew-stored-handle'\)\);/, page);
    assert.match(html, /@media \(max-width: 900px\) \{ \.dmain > \.dpanel\.empty-state\.es \{ grid-template-columns: minmax\(0, 1fr\);[^}]*\} \.es-prev \{ display: none; \}/, page);
  }
  const app = await readFile(new URL('../src/artillery-app.js', import.meta.url), 'utf8');
  assert.match(app, /h\('section', \{ class: 'panel es' \}/);
  assert.match(app, /h\('ol', \{ class: 'es-steps' \}/);
  const css = await readFile(new URL('../src/artillery.css', import.meta.url), 'utf8');
  assert.match(css, /\.panel\.es \{ display: grid;/);
});

test('ПС і РВ: сторінка «Перевірка даних» — заголовок над списком, а не окремим стовпцем ліворуч', async () => {
  for (const page of ['air.html', 'rocket.html']) {
    const html = await read(page);
    assert.match(html, /\.dmain-in\[data-view="quality"\] #p-quality \{ flex-direction: column; \}/, page);
  }
});
