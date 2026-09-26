import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(await read('../src/public/module-editor-core.js'), context);
const core = context.EWModuleEditorCore;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const plain = (value) => JSON.parse(JSON.stringify(value));

test('sanitize keeps valid settings and drops unsafe or malformed values', () => {
  const cfg = plain(core.sanitize({
    units: [{ name: ' 44 ОАБр ', logo: PNG }, { name: '44 оабр', logo: PNG }, { name: 'Bad', logo: 'javascript:alert(1)' }],
    weapons: [
      { id: 'abc', kind: 'munition', name: 'PrSM', aliases: 'PRSM, Precision Strike', range: 'до 500 км', icon: PNG, photo: 'http://example.org/x.png' },
      { kind: 'tank', name: 'X' }, { kind: 'carrier', name: '' },
    ],
    images: { '123:0000abcd': PNG, 'bad-key': PNG, '5:0000ffff': 'data:text/html;base64,PGI+' },
    texts: [{ from: 'Тип цілі', to: 'Категорія' }, { from: 'Same', to: 'Same' }, { from: '', to: 'x' }],
    colors: { '--accent': '#FFAA00', '--bad': 'red', 'accent': '#fff', '--x': 'url(javascript:1)' },
    blocks: { 'p-units': { hidden: true }, 'p-mun': { order: 20 }, '#evil{}': { hidden: true }, 'p-dyn': { order: 1.5 } },
  }));
  assert.deepEqual(cfg.units, [{ name: '44 ОАБр', logo: PNG }]);
  assert.equal(cfg.weapons.length, 1);
  assert.deepEqual(cfg.weapons[0].aliases, ['PRSM', 'Precision Strike']);
  assert.equal(cfg.weapons[0].photo, '', 'remote images are rejected');
  assert.deepEqual(Object.keys(cfg.images), ['123:0000abcd']);
  assert.deepEqual(cfg.texts, [{ from: 'Тип цілі', to: 'Категорія' }]);
  assert.deepEqual(cfg.colors, { '--accent': '#ffaa00' });
  assert.deepEqual(cfg.blocks, { 'p-units': { hidden: true, order: null }, 'p-mun': { hidden: false, order: 20 } });
  assert.deepEqual(plain(core.sanitize(null)), plain(core.empty()));
});

test('matchWeapon finds custom entries by name or alias, longest match wins', () => {
  const weapons = [
    { id: 'a', kind: 'munition', name: 'M30', aliases: [] },
    { id: 'b', kind: 'munition', name: 'M30A2', aliases: [] },
    { id: 'c', kind: 'munition', name: 'PrSM', aliases: ['Precision Strike'] },
    { id: 'd', kind: 'carrier', name: 'Rafale', aliases: [] },
  ];
  assert.equal(core.matchWeapon(weapons, 'munition', 'M30A2 GMLRS').id, 'b');
  assert.equal(core.matchWeapon(weapons, 'munition', 'м30а1').id, 'a', 'cyrillic look-alikes match');
  assert.equal(core.matchWeapon(weapons, 'munition', 'PRECISION-STRIKE missile').id, 'c');
  assert.equal(core.matchWeapon(weapons, 'munition', 'Rafale'), null, 'kinds are separate');
  assert.equal(core.matchWeapon(weapons, 'carrier', 'Dassault RAFALE M').id, 'd');
  assert.equal(core.matchWeapon(weapons, 'munition', ''), null);
});

test('fingerprint is stable and distinguishes images', () => {
  const a = 'data:image/webp;base64,' + 'A'.repeat(50000) + 'B';
  const b = 'data:image/webp;base64,' + 'A'.repeat(50000) + 'C';
  assert.equal(core.fingerprint(a), core.fingerprint(a));
  assert.notEqual(core.fingerprint(a), core.fingerprint(b));
  assert.match(core.fingerprint(a), /^\d+:[0-9a-f]{8}$/);
});

test('replaceText swaps exact node text and keeps surrounding whitespace', () => {
  const map = new Map([['Тип цілі', 'Категорія цілі']]);
  assert.equal(core.replaceText('  Тип цілі\n', map), '  Категорія цілі\n');
  assert.equal(core.replaceText('Тип цілі та інше', map), null);
  assert.equal(core.replaceText('   ', map), null);
});

test('applyWeapons registers new entries and inherits built-in data', () => {
  const maps = {
    MUN_IMG: { m30: 'thumb-m30' }, MUN_W: { m30: 300 }, IMG: {}, MUN_INFO: { m30: { sub: ['GMLRS M30', 'Керована ракета'], src: 'photo-m30' } },
    MUN_SPEC: { m30: { rng: 'до 84 км', gd: 'GPS/INS', wh: 'альтернативна', desc: 'ракета' } }, MUN_BANNER: { m30: 'banner-m30' },
    WEAPONS: { m142_m30: 'w-m142-m30' }, CARRIERS: { m142: 'c-m142', m142_m30: 'c-m142-m30' }, AC_IMG: {}, ROCKET_PLATFORM_MEDIA: { m142: 'p-m142' },
  };
  const weapons = [
    { id: 'x1', kind: 'munition', name: 'M30A2', aliases: [], title: '', desc: '', range: 'до 70 км', guidance: '', warhead: '', icon: '', photo: '', banner: '' },
    { id: 'x2', kind: 'munition', name: 'PrSM', aliases: [], title: 'PrSM Inc 1', desc: 'ракета', range: 'до 500 км', guidance: 'GPS/INS', warhead: 'унітарна', icon: 'icon-prsm', photo: 'photo-prsm', banner: 'banner-prsm' },
    { id: 'x3', kind: 'carrier', name: 'M142 HIMARS', aliases: [], title: '', desc: '', range: '', guidance: '', warhead: '', icon: 'icon-himars', photo: '', banner: '' },
  ];
  const base = { 'M30A2': 'm30', 'M142 HIMARS': 'm142' };
  core.applyWeapons(weapons, (name) => maps[name], (kind, name) => base[name] || '');
  assert.equal(maps.MUN_SPEC.ewx1.rng, 'до 70 км');
  assert.equal(maps.MUN_SPEC.ewx1.wh, 'альтернативна', 'empty fields inherit from the built-in entry');
  assert.equal(maps.MUN_BANNER.ewx1, 'banner-m30');
  assert.equal(maps.MUN_IMG.ewx1, 'thumb-m30');
  assert.deepEqual(plain(maps.MUN_INFO.ewx1.sub), ['GMLRS M30', 'Керована ракета']);
  assert.equal(maps.WEAPONS.m142_ewx1, 'w-m142-m30');
  assert.equal(maps.MUN_BANNER.ewx2, 'banner-prsm');
  assert.equal(maps.MUN_INFO.ewx2.src, 'photo-prsm');
  assert.equal(maps.MUN_SPEC.ewx2.rng, 'до 500 км');
  assert.equal(maps.AC_IMG.ewx3, 'icon-himars');
  assert.equal(maps.CARRIERS.ewx3, 'c-m142');
  assert.equal(maps.CARRIERS.ewx3_m30, 'c-m142-m30');
  assert.equal(maps.ROCKET_PLATFORM_MEDIA.ewx3, 'p-m142');
});

test('blocksCss hides and orders only valid panel ids', () => {
  const css = core.blocksCss({ 'p-units': { hidden: true, order: null }, 'p-mun': { hidden: false, order: 20 }, 'x{}': { hidden: true } });
  assert.equal(css, '#p-units{display:none!important}\n#p-mun{order:20}');
});

test('module hook exposes maps and lets the editor override weapon keys', async () => {
  const hook = await read('../script/module-editor-hook.js');
  const sandbox = { window: {} };
  vm.runInNewContext(`
    let rendered = 0;
    const AV = { S: { wb: {} } }, EMB = {}, EMBK = {}, IMG = {}, IMG2 = {}, MUN_IMG = {}, MUN_W = {}, MUN_INFO = {}, WEAPONS = {}, CARRIERS = {}, AC_IMG = {};
    let ROWS = [{ unit: 'A' }];
    function unitKey(s) { return String(s).toUpperCase(); }
    function munKey(m) { return /M30/.test(m) ? 'm30' : ''; }
    function carrierKey(a) { return /M142/.test(a) ? 'm142' : ''; }
    function renderAll() { rendered++; }
    ${hook}
    window.result = () => ({ mun: munKey('PrSM'), builtin: munKey('M30A1'), carrier: carrierKey('M142'), rendered, rows: window.__EW_EDITOR_HOOKS__.rows().length });
  `, sandbox);
  const hooks = sandbox.window.__EW_EDITOR_HOOKS__;
  assert.equal(hooks.maps.MUN_SPEC, undefined, 'optional maps are tolerated');
  assert.equal(typeof hooks.maps.EMBK, 'object');
  hooks.munKey = (value) => (/PRSM/i.test(value) ? 'ewx2' : '');
  hooks.rerender();
  assert.deepEqual(plain(sandbox.window.result()), { mun: 'ewx2', builtin: 'm30', carrier: 'm142', rendered: 1, rows: 1 });
  assert.equal(hooks.origMunKey('PrSM'), '');
});

test('both branch modules load the editor hook and scripts', async () => {
  const hook = await read('../script/module-editor-hook.js');
  for (const name of ['air.html', 'rocket.html']) {
    const html = await read(`../src/${name}`);
    assert.ok(html.includes(hook + 'window.__DASH = { buildModel,'), `${name}: hook inside the dashboard closure`);
    assert.ok(html.includes('<script src="./module-editor-core.js"></script>\n<script src="./module-editor.js"></script>\n</body>'), `${name}: editor scripts`);
  }
});
