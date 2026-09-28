import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const context = vm.createContext({ atob, TextEncoder, Uint8Array });
vm.runInContext(await read('../src/public/module-editor-core.js'), context);
const core = context.EWModuleEditorCore;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const plain = (value) => JSON.parse(JSON.stringify(value));

test('sanitize keeps valid settings and drops unsafe or malformed values', () => {
  const cfg = plain(core.sanitize({
    version: 2,
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

test('entries keep the owner mark; settings from the owner-only editor are all the owner\'s', () => {
  const entries = {
    units: [{ name: 'A', logo: PNG }, { name: 'B', logo: PNG, owner: true }, { name: 'C', logo: PNG, owner: 'yes' }],
    weapons: [{ id: 'a', kind: 'munition', name: 'X' }, { id: 'b', kind: 'carrier', name: 'Y', owner: true }],
  };
  const current = plain(core.sanitize({ version: 2, ...entries }));
  assert.deepEqual(current.units.map(u => [u.name, u.owner === true]), [['A', false], ['B', true], ['C', false]]);
  assert.deepEqual(current.weapons.map(w => [w.name, w.owner === true]), [['X', false], ['Y', true]]);
  assert.equal(current.version, 2);
  // Before version 2 only the owner could open the editor.
  for (const legacy of [{ version: 1, ...entries }, entries]) {
    const cfg = plain(core.sanitize(legacy));
    assert.ok(cfg.units.every(u => u.owner === true) && cfg.weapons.every(w => w.owner === true));
  }
});

test('an entry added by another user never replaces a built-in or the owner\'s entry', () => {
  const weapons = [
    { id: 'o', kind: 'munition', name: 'M30A2', aliases: [], owner: true },
    { id: 'u', kind: 'munition', name: 'M30', aliases: ['PrSM'] },
  ];
  const builtin = value => (/M3[01]/i.test(value) ? 'm30' : '');
  assert.equal(core.resolveWeapon(weapons, 'munition', 'M30A2 GMLRS', builtin).id, 'o', 'the owner overrides a built-in');
  assert.equal(core.resolveWeapon(weapons, 'munition', 'M30A1', builtin), null, 'the built-in stays');
  assert.equal(core.resolveWeapon(weapons, 'munition', 'PrSM Inc 1', builtin).id, 'u', 'new names are added');
  assert.equal(core.resolveWeapon(weapons, 'carrier', 'PrSM', builtin), null);
});

test('importing the owner\'s file keeps entries added on this computer', () => {
  const current = { version: 2, units: [{ name: '44 ОАБр', logo: PNG }, { name: 'Old', logo: PNG, owner: true }, { name: '12 ОБр', logo: PNG }],
    weapons: [{ id: 'u1', kind: 'munition', name: 'PrSM' }, { id: 'u2', kind: 'carrier', name: 'Rafale' }], colors: { '--accent': '#112233' } };
  const imported = { app: 'EasyWAR', version: 1, units: [{ name: '12 обр', logo: PNG }], weapons: [{ id: 'i1', kind: 'carrier', name: 'RAFALE' }], colors: { '--bg': '#000000' } };
  const cfg = plain(core.mergeImported(current, imported));
  assert.deepEqual(cfg.units.map(u => [u.name, u.owner === true]), [['12 обр', true], ['44 ОАБр', false]], 'the owner\'s old entries are replaced, same names go to the file');
  assert.deepEqual(cfg.weapons.map(w => [w.name, w.owner === true]), [['RAFALE', true], ['PrSM', false]]);
  assert.deepEqual(cfg.colors, { '--bg': '#000000' });
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

test('owner password check uses PBKDF2 and rejects wrong or malformed input', async () => {
  const { pbkdf2Sync, webcrypto } = await import('node:crypto');
  const salt = Buffer.from('0123456789abcdef');
  const access = { v: 1, salt: salt.toString('base64'), iterations: 100000, hash: pbkdf2Sync('правильний-пароль', salt, 100000, 32, 'sha256').toString('base64') };
  assert.equal(core.accessValid(access), true);
  assert.equal(await core.verifyPassword('правильний-пароль', access, webcrypto.subtle), true);
  assert.equal(await core.verifyPassword('неправильний', access, webcrypto.subtle), false);
  assert.equal(await core.verifyPassword('', access, webcrypto.subtle), false);
  assert.equal(await core.verifyPassword('правильний-пароль', { ...access, iterations: 10 }, webcrypto.subtle), false, 'weak settings are refused');
  assert.equal(await core.verifyPassword('правильний-пароль', undefined, webcrypto.subtle), false);
});

test('the shipped access file holds only a strong salted hash', async () => {
  const source = await read('../src/public/module-editor-access.js');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);
  const access = sandbox.window.EW_EDITOR_ACCESS;
  assert.equal(core.accessValid(access), true);
  assert.ok(access.iterations >= 600000);
  assert.deepEqual(Object.keys(access).sort(), ['hash', 'iterations', 'salt', 'v']);
});

test('everyone can add units and weapons; the rest of the editor needs the owner password', async () => {
  const source = await read('../src/public/module-editor.js');
  const start = source.slice(source.indexOf('function start() {'), source.indexOf('window.EWModuleEditor ='));
  assert.match(start, /mountButton\(\)/, 'the public button is there from the start');
  assert.match(source, /const PUBLIC_TABS = \['units', 'weapons'\];/);
  assert.match(source, /const allowedTab = id => unlocked \|\| PUBLIC_TABS\.includes\(id\);/);
  assert.match(source, /if \(tab && !allowedTab\(tab\)\) \{ requestAccess\(tab\); return; \}/, 'owner tabs ask for the password');
  assert.match(source, /TABS\.filter\(\(\[id\]\) => allowedTab\(id\)\)/, 'only allowed tabs are shown');
  assert.match(source, /window\.EWModuleEditor = \{ open: tab => openEditor\(tab\)/);
  // Import, export and reset stay in the owner-only «Файл» tab.
  assert.ok(!['file', 'images', 'texts', 'colors', 'blocks'].some(id => /const PUBLIC_TABS = \[[^\]]*'/.exec(source)[0].includes(`'${id}'`)));
});

test('both branch modules load the editor hook and scripts', async () => {
  const hook = await read('../script/module-editor-hook.js');
  for (const name of ['air.html', 'rocket.html']) {
    const html = await read(`../src/${name}`);
    assert.ok(html.includes(hook + 'window.__DASH = { buildModel,'), `${name}: hook inside the dashboard closure`);
    assert.ok(html.includes('<script src="./module-editor-core.js"></script>\n<script src="./module-editor.js"></script>\n</body>'), `${name}: editor scripts`);
    assert.ok(html.includes('<script src="./module-editor-access.js"></script>'), `${name}: owner access file`);
  }
});
