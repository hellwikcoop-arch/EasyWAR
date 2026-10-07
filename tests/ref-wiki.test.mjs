import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { KINDS } from '../src/munition-3d.js';
import { ENTRIES, GROUPS, PAIRS, aircraftId, carriersOf, creditOf, entryById, modelOf, munitionId, munitionsOf, searchEntries, usageFor, variantsOf } from '../src/ref-data.js';
import { MODEL_FILES, NOSE_TURN, aircraftDistance } from '../src/ref-viewer.js';

const html = await readFile(new URL('../src/air.html', import.meta.url), 'utf8');

test('every article has the required fields and unique ids', () => {
  assert.equal(new Set(ENTRIES.map(e => e.id)).size, ENTRIES.length);
  for (const e of ENTRIES) {
    assert.ok(GROUPS.some(g => g.id === e.group), `${e.id}: group`);
    for (const f of ['name', 'alias', 'role', 'origin', 'summary', 'short']) assert.ok(e[f], `${e.id}: ${f}`);
    assert.ok(e.facts.length, `${e.id}: facts`);
    for (const [k, v] of e.facts) assert.ok(k && v, `${e.id}: fact`);
    for (const s of e.sections) assert.ok(s.title && (s.text || s.list), `${e.id}: section`);
  }
});

test('every munition model kind from the mission card has a munition article', () => {
  for (const e of ENTRIES.filter(x => x.model && x.model.kind)) assert.ok(KINDS.includes(e.model.kind), e.id);
  const ids = ENTRIES.filter(e => e.group === 'munition').map(e => e.id);
  for (const k of KINDS.filter(k => k !== 'bomb')) assert.ok(ids.includes(k), `article for ${k}`);
});

// Усі моделі статті: основна й варіанти (розмальовки чи модифікації), якщо вони є.
const modelsOf = e => (e.variants && e.variants.length > 1 ? e.variants : [e]).filter(v => v.model && v.model.file);
const LICENSES = { 'CC BY 4.0': /CC-BY-4\.0/, 'CC BY-NC-SA 4.0': /CC-BY-NC-SA-4\.0/ };

test('glb models exist, are registered and carry a Creative Commons credit', async () => {
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  for (const entry of ENTRIES) for (const e of modelsOf(entry)) {
    const id = `${entry.id}/${e.id || 'main'}`;
    assert.ok(MODEL_FILES[e.model.file], `${id}: file registered`);
    assert.ok(e.model.nose in NOSE_TURN, `${id}: nose axis`);
    if (e.credit.generated) {
      // Процедурні моделі без сторонніх матеріалів: без ліцензійних вимог, але з поясненням у статті.
      assert.ok(e.credit.note, `${id}: note`);
      assert.ok((await stat(new URL(`../src/models/${e.model.file}.glb`, import.meta.url))).size < 1e6, `${id}: tiny`);
      assert.ok(credits.includes(`${e.model.file}.glb`), `${id} in CREDITS.md`);
      continue;
    }
    assert.ok(LICENSES[e.credit.license], `${id}: known license ${e.credit.license}`);
    assert.ok(e.credit.author && e.credit.url && e.credit.authorUrl && e.credit.licenseUrl);
    const file = new URL(`../src/models/${e.model.file}.glb`, import.meta.url);
    assert.ok((await stat(file)).size < 12e6, `${id}: stays compact`);
    const bytes = await readFile(file);
    assert.equal(bytes.toString('latin1', 0, 4), 'glTF');
    const len = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + len));
    // Лише розширення, які вміє читати GLTFLoader із meshopt-декодером.
    for (const x of json.extensionsRequired || []) assert.ok(['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(x), x);
    // Ліцензія в самому файлі збігається з ліцензією в підписі статті.
    assert.match(json.asset.extras.license, LICENSES[e.credit.license], `${id}: license inside the file`);
    assert.ok(credits.includes(e.credit.url), `${id} in CREDITS.md`);
    assert.ok(credits.includes(`${e.model.file}.glb`), `${id}: file name in CREDITS.md`);
    // Некомерційна ліцензія: стаття прямо про це каже.
    if (/NC/.test(e.credit.license)) assert.match(e.credit.note, /некомерційне/, `${id}: NC note`);
  }
});

test('every glb in src/models is registered and used by an article', async () => {
  const { readdir } = await import('node:fs/promises');
  const used = new Set(ENTRIES.flatMap(modelsOf).map(e => e.model.file));
  const files = (await readdir(new URL('../src/models/', import.meta.url))).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4));
  for (const f of files) assert.ok(used.has(f), `${f}.glb is not used by any article`);
  for (const f of Object.keys(MODEL_FILES)) assert.ok(files.includes(f), `${f} is registered but missing`);
});

test('articles with several models list a default first and resolve model and credit per variant', () => {
  const mig = entryById('mig29'), su = entryById('su27');
  assert.deepEqual(variantsOf(mig).map(v => v.id), ['falcons', 'ghost']);
  assert.deepEqual(variantsOf(su).map(v => v.id), ['p1m', 'b']);
  assert.equal(variantsOf(entryById('f16')).length, 0);
  // Основна модель статті збігається з першим варіантом, невідомий варіант дає основну.
  assert.equal(mig.model.file, 'mig-29');
  assert.equal(modelOf(mig).file, 'mig-29');
  assert.equal(modelOf(mig, 'nope').file, 'mig-29');
  assert.equal(modelOf(mig, 'ghost').file, 'mig-29-ghost');
  assert.match(creditOf(mig, 'ghost').url, /ghost-of-kiev-mig-29/);
  assert.equal(modelOf(su, 'b').file, 'su-27b');
  assert.equal(modelOf(entryById('f16')).file, 'f-16');
  assert.equal(creditOf(entryById('39')), undefined);
});

test('helicopters and the added munitions have articles that the table recognisers reach', () => {
  for (const [text, id] of [['Мі-8', 'mi8'], ['Mi-8MT', 'mi8'], ['МІ-24П', 'mi24'], ['Mi 24', 'mi24']]) {
    assert.equal(aircraftId(text), id, text);
    assert.equal(entryById(id).group, 'aircraft');
  }
  assert.equal(aircraftId('Мі-28'), '', 'Мі-28 не плутається з Мі-8');
  for (const [text, id] of [['AIM-120C', 'aim120'], ['AMRAAM', 'aim120'], ['AIM-9X', 'aim9'], ['AIM-9M', 'aim9'], ['AGM-65', 'agm65'], ['Р-27Р', 'r27'], ['R-27ER', 'r27'], ['Р-77', 'r77'], ['РВВ-АЕ', 'r77'],
    ['Х-29Л', 'kh29'], ['Kh-29T', 'kh29'], ['КАБ-500Л', 'kab500'], ['KAB-500', 'kab500']]) {
    assert.equal(munitionId(text), id, text);
    assert.equal(entryById(id).group, 'munition');
  }
  // Старі розпізнавання не зачеплено.
  for (const [text, id] of [['AGM-88', 'agm88'], ['GBU-39', '39'], ['С-13', 'c13'], ['Storm Shadow', 'storm']]) assert.equal(munitionId(text), id, text);
  assert.equal(munitionId('Р-273'), '');
  assert.equal(munitionId('GBU-12'), '12', 'GBU-12 лишається номером без статті');
});

test('carrier and munition ids agree with the recognisers of the module', () => {
  const start = html.indexOf('function carrierKey(a)'), end = html.indexOf('const CAR_LIGHT');
  const ctx = {};
  vm.runInNewContext(`${html.slice(start, end)}\nthis.carrierKey = carrierKey; this.munKey = munKey;`, ctx);
  for (const a of ['МіГ-29', 'MiG 29', 'F-16', 'Су-27', 'Su-27P1M', 'Мі Г-29УБ']) assert.equal(aircraftId(a), ctx.carrierKey(a), a);
  for (const m of ['GBU-39', 'GBU-62/B', 'GBU-64', 'AASM-250', 'AGM-88', 'BLU-140', 'С-13', 'C13', 'GBU-53']) assert.equal(munitionId(m), ctx.munKey(m), m);
  assert.equal(aircraftId('Mirage 2000-5'), 'mirage');
  assert.equal(aircraftId('Су-25'), 'su25');
  assert.equal(aircraftId('Су-24М'), 'su24');
  assert.equal(aircraftId('JAS 39C Gripen'), 'gripen');
  assert.equal(aircraftId('невідомий'), '');
  assert.equal(munitionId('Storm Shadow'), 'storm');
  assert.equal(munitionId('SCALP-EG'), 'storm');
  assert.equal(munitionId('GMLRS M31'), 'gmlrs');
});

test('an aircraft that is not in service yet is marked as expected', () => {
  const gripen = entryById('gripen');
  assert.equal(gripen.status, 'Очікується');
  assert.ok(gripen.facts.some(([k, v]) => k === 'Статус в Україні' && /Очікується/.test(v)));
  assert.equal(ENTRIES.filter(e => e.status).length, 1, 'only the Gripen is marked');
});

test('pairs link existing carriers and munitions both ways', () => {
  for (const [a, m] of PAIRS) {
    assert.equal(entryById(a).group, 'aircraft');
    assert.equal(entryById(m).group, 'munition');
    assert.ok(carriersOf(m).includes(a) && munitionsOf(a).includes(m));
  }
});

test('search finds by name, alias and keyword and can be limited to a group', () => {
  assert.deepEqual(searchEntries('hammer').map(e => e.id), ['aasm']);
  assert.deepEqual(searchEntries('gbu-6').map(e => e.id), ['62', '64']);
  assert.ok(searchEntries('міг').some(e => e.id === 'mig29'));
  assert.equal(searchEntries('', '').length, ENTRIES.length);
  assert.ok(searchEntries('', 'aircraft').every(e => e.group === 'aircraft'));
  assert.equal(searchEntries('такого немає').length, 0);
});

test('usage summary counts flights, munitions, results, period and partners', () => {
  const rows = [
    { aircraft: 'МіГ-29', munition: 'GBU-62', count: 2, kind: 'hit', date: '2026-03-02' },
    { aircraft: 'F-16', munition: 'GBU-62', count: 1, kind: 'miss', date: '2026-01-10' },
    { aircraft: 'МіГ-29', munition: 'GBU-39', count: 4, kind: 'part', date: '2026-04-01' },
  ];
  const u = usageFor(rows, entryById('62'));
  assert.deepEqual([u.flights, u.used, u.from, u.to], [2, 3, '2026-01-10', '2026-03-02']);
  assert.deepEqual(u.results, { hit: 1, part: 0, miss: 1, unk: 0 });
  assert.deepEqual(u.partners.map(p => p.id).sort(), ['f16', 'mig29']);
  const air = usageFor(rows, entryById('mig29'));
  assert.equal(air.flights, 2);
  assert.equal(air.partners[0].n, 1);
  assert.equal(usageFor([], entryById('62')).flights, 0);
});

test('aircraft camera distance grows when the stage gets narrower', () => {
  const fp = { r: 2.75, hh: .6 };
  assert.ok(aircraftDistance(fp, .42, 26, 1) > aircraftDistance(fp, .42, 26, 2));
  assert.ok(aircraftDistance(fp, 1.5, 26, 2) > 0);
});

test('the Довідник tab is wired into the module', () => {
  assert.match(html, /id="tab-ref"[^>]*>Довідник<\/button>/);
  assert.match(html, /<main id="view-ref"[^>]*hidden><\/main>/);
  assert.match(html, /const VORDER = \['dash', 'base', 'entry', 'ref'\];/);
  assert.match(html, /<script type="module" src="\.\/ref-wiki\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/ref-wiki\.css">/);
  assert.match(html, /window\.RefWiki\.mount\(\$\('#view-ref'\)/);
});

// Наземні засоби (HIMARS): окрема група без підсумку з таблиці вильотів ПС.
test('the HIMARS article lives in its own ground group, found by its Ukrainian name', () => {
  assert.ok(GROUPS.some(g => g.id === 'ground'));
  const himars = entryById('himars');
  assert.equal(himars.group, 'ground');
  assert.equal(himars.model.file, 'm142-himars');
  assert.equal(himars.credit.license, 'CC BY 4.0');
  assert.deepEqual(searchEntries('хаймарс').map(e => e.id), ['himars', 'atacms', 'gmlrs']); // ракети, які несе HIMARS, мають той самий ключ
  assert.deepEqual(searchEntries('', 'ground').map(e => e.id), ['himars']);
  assert.ok(searchEntries('', 'aircraft').every(e => e.group === 'aircraft'));
  assert.deepEqual(carriersOf('himars'), []);
  assert.deepEqual(munitionsOf('himars'), []);
});

test('the HIMARS file is a clean vehicle: no scene helpers, no animation, compact', async () => {
  const file = new URL('../src/models/m142-himars.glb', import.meta.url);
  const bytes = await readFile(file);
  assert.ok(bytes.length < 1.5e6, 'stays compact');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal((json.animations || []).length, 0, 'animation removed');
  assert.equal((json.cameras || []).length, 0, 'no cameras');
  for (const n of json.nodes) assert.doesNotMatch(n.name || '', /Camera|Light_|Shadow_Catcher|bonnet_dam/, `service node ${n.name}`);
  // Передні колеса сидять у вузлах «Turntable»: їх не можна вилучати разом зі службовими об’єктами.
  const names = new Set(json.nodes.map((n) => n.name));
  for (const n of ['Turntable_1', 'Turntable_1_1', 'Tire_low_2', 'Tire_low_3']) assert.ok(names.has(n), `${n} kept`);
});

test('ground articles do not show the flights summary or carrier/munition pairs', async () => {
  const wiki = await readFile(new URL('../src/ref-wiki.js', import.meta.url), 'utf8');
  assert.match(wiki, /usageEl\.hidden = entry\.group === 'ground';/);
  assert.match(wiki, /function relatedBlock\(entry\) \{\s*\n\s*if \(entry\.group === 'ground'\) return null;/);
});

test('the ATACMS article is a generated munition model recognised in mission tables', async () => {
  const e = entryById('atacms');
  assert.equal(e.group, 'munition');
  assert.equal(e.model.file, 'mgm-140-atacms');
  assert.ok(e.credit.generated && e.credit.note);
  for (const text of ['ATACMS', 'MGM-140', 'mgm140', 'ATACMS (M39)']) assert.equal(munitionId(text), 'atacms', text);
  assert.equal(munitionId('GMLRS M31'), 'gmlrs');
  const file = new URL('../src/models/mgm-140-atacms.glb', import.meta.url);
  assert.ok((await stat(file)).size < 4e5, 'procedural model stays tiny');
  assert.match(entryById('himars').sections.find(s => s.title === 'Боєприпаси').list.join(' '), /MGM-140 ATACMS/);
});
