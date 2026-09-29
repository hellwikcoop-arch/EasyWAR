import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { KINDS } from '../src/munition-3d.js';
import { ENTRIES, GROUPS, PAIRS, aircraftId, carriersOf, entryById, munitionId, munitionsOf, searchEntries, usageFor } from '../src/ref-data.js';
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

test('glb models exist, are registered and carry the CC BY credit', async () => {
  for (const e of ENTRIES.filter(x => x.model && x.model.file)) {
    assert.ok(MODEL_FILES[e.model.file], `${e.id}: file registered`);
    assert.ok(e.model.nose in NOSE_TURN, `${e.id}: nose axis`);
    assert.equal(e.credit.license, 'CC BY 4.0');
    assert.ok(e.credit.author && e.credit.url && e.credit.authorUrl);
    const file = new URL(`../src/models/${e.model.file}.glb`, import.meta.url);
    assert.ok((await stat(file)).size < 12e6, `${e.id}: stays compact`);
    const bytes = await readFile(file);
    assert.equal(bytes.toString('latin1', 0, 4), 'glTF');
    const len = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + len));
    // Лише розширення, які вміє читати GLTFLoader із meshopt-декодером.
    for (const x of json.extensionsRequired || []) assert.ok(['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(x), x);
    assert.match(json.asset.extras.license, /CC-BY-4\.0/);
  }
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  for (const e of ENTRIES.filter(x => x.credit)) assert.ok(credits.includes(e.credit.url), `${e.id} in CREDITS.md`);
});

test('carrier and munition ids agree with the recognisers of the module', () => {
  const start = html.indexOf('function carrierKey(a)'), end = html.indexOf('const CAR_LIGHT');
  const ctx = {};
  vm.runInNewContext(`${html.slice(start, end)}\nthis.carrierKey = carrierKey; this.munKey = munKey;`, ctx);
  for (const a of ['МіГ-29', 'MiG 29', 'F-16', 'Су-27', 'Su-27P1M', 'Мі Г-29УБ']) assert.equal(aircraftId(a), ctx.carrierKey(a), a);
  for (const m of ['GBU-39', 'GBU-62/B', 'GBU-64', 'AASM-250', 'AGM-88', 'BLU-140', 'С-13', 'C13', 'GBU-53']) assert.equal(munitionId(m), ctx.munKey(m), m);
  assert.equal(aircraftId('Mirage 2000-5'), 'mirage');
  assert.equal(aircraftId('Су-25'), 'su25');
  assert.equal(aircraftId('невідомий'), '');
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
