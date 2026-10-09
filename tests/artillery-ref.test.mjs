import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { Box3, Vector3 } from 'three';
import { SHELL_KINDS, buildShell } from '../src/artillery-3d.js';
import { ENTRIES, GROUPS, REST, creditOf, entryById, entryForGroup, groupsOf, modelOf, searchEntries, variantsOf } from '../src/artillery-ref-data.js';
import { openWorkbook } from '../src/artillery-xlsx.js';
import { caliberGroup, parseArtilleryWorkbook } from '../src/artillery-core.js';
import { MODEL_FILES } from '../src/ref-viewer.js';

const size = group => new Box3().setFromObject(group).getSize(new Vector3());
const read = async name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('every article has the required fields and unique ids', () => {
  assert.equal(new Set(ENTRIES.map(e => e.id)).size, ENTRIES.length);
  for (const e of ENTRIES) {
    assert.ok(GROUPS.some(g => g.id === e.group), `${e.id}: group`);
    for (const f of ['name', 'alias', 'role', 'origin', 'summary', 'short']) assert.ok(e[f], `${e.id}: ${f}`);
    assert.ok(e.facts.length >= 3, `${e.id}: facts`);
    for (const [k, v] of e.facts) assert.ok(k && v, `${e.id}: fact`);
    assert.ok(e.sections.length >= 2, `${e.id}: sections`);
    for (const s of e.sections) assert.ok(s.title && (s.text || s.list), `${e.id}: section`);
    assert.ok(e.tableGroups === REST || (Array.isArray(e.tableGroups) && e.tableGroups.length), `${e.id}: table groups`);
    assert.ok(e.credit.generated && e.credit.note, `${e.id}: generated models carry a note`);
  }
});

test('articles use only text that reads as Ukrainian prose (no stray Latin letters inside Cyrillic words)', () => {
  const mixed = /[а-яіїєґ][a-z]|[a-z][а-яіїєґ]/i;
  for (const e of ENTRIES) {
    const text = [e.summary, e.role, ...e.facts.flat(), ...e.sections.flatMap(s => [s.text, ...(s.list || [])])].filter(Boolean);
    for (const t of text) for (const word of t.split(/[\s,.;:()«»—–/]+/)) assert.ok(!mixed.test(word) || /^[A-Za-z0-9-]+$/.test(word), `${e.id}: «${word}»`);
  }
});

test('every model of every article exists: procedural kinds build, files are registered', () => {
  for (const e of ENTRIES) for (const v of variantsOf(e).length ? variantsOf(e) : [e]) {
    const m = v.model;
    if (m.file) { assert.ok(MODEL_FILES[m.file], `${e.id}: ${m.file} is registered`); continue; }
    assert.ok(SHELL_KINDS.includes(m.kind), `${e.id}: kind ${m.kind}`);
  }
  assert.equal(modelOf(entryById('g155sm'), 'illum').kind, 'shell-155-illum');
  assert.equal(creditOf(entryById('g155sm'), 'smoke').generated, true);
});

test('3D models share the common length, stay compact and fall apart into labelled blocks', () => {
  for (const kind of SHELL_KINDS) {
    const { group, wings, explode, labels } = buildShell(kind);
    const s = size(group);
    assert.ok([s.x, s.y, s.z].every(Number.isFinite), `${kind}: finite`);
    assert.ok(s.x > 3.9 && s.x < 4.1, `${kind}: length ${s.x.toFixed(2)}`);
    assert.ok(s.y < 1.5 && s.z < 1.5, `${kind}: slender`);
    assert.deepEqual(wings, [], `${kind}: no wings`);
    assert.equal(typeof explode, 'function', `${kind}: explode`);
    assert.ok(labels.length >= 3 && labels.every(l => l.text && l.anchor && ['up', 'down'].includes(l.side)), `${kind}: labels`);
    explode(1);
    group.updateMatrixWorld(true);
    assert.ok(size(group).x > s.x + .5, `${kind}: apart is longer`);
    explode(0);
    group.updateMatrixWorld(true);
    assert.ok(Math.abs(size(group).x - s.x) < 1e-6, `${kind}: folds back`);
  }
});

test('every caliber group the table can produce lands in some article', () => {
  const groups = ['155 мм ОФ', '155 мм касетні', '155 мм дист. мінування', '155 мм димові й освітлювальні', '152 мм', '122 мм РС', '122 мм', '105 мм', '203 мм', '227 мм', '120 мм', '82 мм', '60 мм', 'Високоточні', 'Заряди',
    caliberGroup({ caliber: 85, cls: 'he' }), caliberGroup({ caliber: 130, cls: 'he' }), caliberGroup({ caliber: 220, cls: 'rocket' })];
  for (const g of groups) assert.ok(entryForGroup(g), g);
  assert.equal(entryForGroup('85 мм').id, 'other');
  assert.equal(entryForGroup('155 мм ОФ').id, 'g155he');
  assert.equal(entryForGroup('122 мм РС').id, 'r122');
  assert.deepEqual(groupsOf(entryById('other'), ['155 мм ОФ', '85 мм', '130 мм', 'Заряди']), ['85 мм', '130 мм']);
  assert.deepEqual(groupsOf(entryById('g155he'), ['155 мм ОФ', '85 мм']), ['155 мм ОФ']);
});

test('the fixture table is covered: each of its groups has an article and rows of the same group', async () => {
  const wb = await openWorkbook(await readFile(new URL('./fixtures/artillery-sample.xlsx', import.meta.url)));
  const model = await parseArtilleryWorkbook(wb);
  const groups = [...new Set(model.items.map(i => i.group))];
  const seen = new Set();
  for (const g of groups) { const e = entryForGroup(g); assert.ok(e, g); seen.add(e.id); }
  for (const id of seen) assert.ok(groupsOf(entryById(id), groups).length, id);
});

test('ammunition icons named by the articles exist, and search also looks into the table rows', async () => {
  const files = new Set((await readdir(new URL('../src/ammo-art/', import.meta.url))).map(f => f.replace(/\.webp$/, '')));
  for (const e of ENTRIES) if (e.icon) assert.ok(files.has(e.icon), `${e.id}: ${e.icon}`);
  assert.equal(searchEntries('М795').length, 0);
  assert.deepEqual(searchEntries('М795', '', e => (e.id === 'g155he' ? '155 мм постріл М795 (ОФ)' : '')).map(e => e.id), ['g155he']);
  assert.ok(searchEntries('град').some(e => e.id === 'r122'));
  assert.ok(searchEntries('excalibur', 'guided').some(e => e.id === 'guided'));
  assert.deepEqual(searchEntries('', 'charge').map(e => e.id), ['charges']);
});

test('the artillery page mounts the shared wiki with its own data and shows the live table block', async () => {
  const app = await read('artillery-app.js'), wiki = await read('ref-wiki.js'), html = await read('artillery.html'), viewer = await read('ref-viewer.js');
  assert.match(app, /mountRef\(REF\.host, \{[\s\S]*data: ART_REF/);
  assert.match(app, /\['ref', 'Довідник'\]/);
  assert.match(app, /У вашій таблиці/);
  assert.match(wiki, /options\.data/);
  assert.match(wiki, /extra\(entry\)/);
  assert.match(html, /ref-wiki\.css/);
  assert.match(viewer, /SHELL_KINDS\.includes\(model\.kind\)/);
  assert.doesNotMatch(app, /innerHTML/);
});
