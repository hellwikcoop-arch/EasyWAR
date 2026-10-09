import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openWorkbook, readSheet, saveWorkbook, setCells, writeMeta } from '../src/artillery-xlsx.js';
import {
  GROUP_ORDER, buildEdits, byCaliberGroup, byUnit, classify, diffModels, groupEdits, parseArtilleryWorkbook, totals, unitKey, valueOf,
} from '../src/artillery-core.js';

const fixture = () => readFile(new URL('./fixtures/artillery-sample.xlsx', import.meta.url));
const load = async () => { const wb = await openWorkbook(await fixture()); return { wb, model: await parseArtilleryWorkbook(wb) }; };
const item = (model, part) => model.items.find(i => i.label.includes(part));
const unit = (model, part) => model.units.find(u => u.name.includes(part));

test('classifies shells by caliber and class from the row label', () => {
  assert.deepEqual(classify('155 мм постріл М483  (КАС)'), { caliber: 155, cls: 'cluster' });
  assert.deepEqual(classify('155 мм постріл М741 (Д/М)'), { caliber: 155, cls: 'scatter' });
  assert.deepEqual(classify('155 мм постріл DM105 (ДИМ)'), { caliber: 155, cls: 'smoke' });
  assert.deepEqual(classify('122 мм постріли  РС 21ОФ'), { caliber: 122, cls: 'rocket' });
  assert.deepEqual(classify('82мм міна O-832ДУ'), { caliber: 82, cls: 'he' });
  assert.equal(classify('ВСЬОГО').caliber, null);
});

test('unit keys ignore spacing, punctuation and ошбр/одшбр spelling', () => {
  assert.equal(unitKey('95  ошбр'), unitKey('95 одшбр'));
  assert.equal(unitKey('АГр,  РУК 148 оабр'), unitKey('агр рук 148 оабр'));
});

test('parses units, items, charges, fire and losses by labels', async () => {
  const { model } = await load();
  assert.deepEqual(model.units.map(u => u.name), ['11 одшбр', '12 одшбр', '13 ошп', 'АГр, РУК 14 оабр', '21 омбр']);
  assert.equal(model.items.filter(i => i.kind === 'precision').length, 5);
  assert.equal(model.items.filter(i => i.kind === 'regular').length, 14);
  assert.equal(model.chargeItems.length, 3);
  assert.equal(model.fire.size, 5);
  assert.equal(model.losses.columns.length, 7);
  assert.equal(model.losses.rows.size, 3);
  const m107 = item(model, 'М107');
  assert.deepEqual(valueOf(model, m107.id, unit(model, '12 одшбр').id), { spent: 7, left: 2640 });
  assert.deepEqual(valueOf(model, m107.id, unit(model, '13 ошп').id), { spent: null, left: null });
});

test('names a column pair that has no header from the formulas of the fire sheet', async () => {
  const { model } = await load();
  const u = unit(model, '21 омбр');
  assert.equal(u.nameFrom, 'fire');
  assert.equal(model.fire.get(u.id).row, 7);
});

test('keeps an unnamed pair as a free slot when nothing names it', async () => {
  const wb = await openWorkbook(await fixture());
  await setCells(wb, 'Витрата снарядів', [{ ref: 'A7', value: null }]);
  const model = await parseArtilleryWorkbook(wb);
  const free = model.units.find(u => u.free);
  assert.ok(free);
  assert.match(free.name, /Вільні колонки J–K/);
  assert.ok(model.issues.some(i => i.level === 'info' && /J–K/.test(i.text)));
});

test('matches the same unit written differently on other sheets', async () => {
  const { model } = await load();
  const agr = unit(model, 'АГр, РУК 14');
  assert.ok(agr.chargeUnitId, 'заряди «АГр 14 оабр» належать «АГр, РУК 14 оабр»');
  assert.ok(model.losses.rows.has(agr.id));
  assert.equal(model.fire.get(agr.id).vgz, 13);
  const orphan = model.chargeUnits.find(c => c.name === '99 омбр');
  assert.equal(orphan.unitId, null);
  assert.ok(model.issues.some(i => /99 омбр/.test(i.text)), 'підрозділ зарядів без пари позначено');
});

test('totals match the sums written in the table', async () => {
  const { wb, model } = await load();
  const t = totals(model);
  assert.equal(t.spent, 99);
  assert.equal(t.left, 8752);
  assert.equal(t.precisionSpent, 0);
  assert.equal(t.precisionLeft, 15);
  assert.equal(t.chargesSpent, 9);
  assert.equal(t.chargesLeft, 446, 'у підсумки зарядів входять і підрозділи без пари');
  assert.equal(t.vgz, 46);
  assert.equal(t.kbb, 22);
  const sh = await readSheet(wb, 'витр.залиш.-СН');
  assert.equal(sh.isFormula(12, 26), true);
});

test('groups by caliber in a stable order and by unit', async () => {
  const { model } = await load();
  const groups = byCaliberGroup(model);
  const names = groups.map(g => g.group);
  assert.deepEqual(names, ['155 мм ОФ', '155 мм касетні', '155 мм дист. мінування', '155 мм димові й освітлювальні', '152 мм', '122 мм РС', '122 мм', '120 мм', '82 мм', '60 мм', '203 мм', '227 мм']);
  assert.ok(names.slice(0, 10).every((n, i) => GROUP_ORDER.indexOf(n) === GROUP_ORDER.indexOf(names[i])));
  const he155 = groups.find(g => g.group === '155 мм ОФ');
  assert.equal(he155.spent, 27);
  const rows = byUnit(model);
  assert.equal(rows.length, 5);
  assert.equal(rows.find(r => r.unit.name === '11 одшбр').spent, 3 + 10 + 25 + 8);
  assert.equal(rows.find(r => r.unit.name === '11 одшбр').vgz, 10);
  const filtered = byCaliberGroup(model, [unit(model, '12 одшбр').id]).find(g => g.group === '155 мм ОФ');
  assert.equal(filtered.spent, 7);
});

test('builds edits only for changed cells of the chosen unit', async () => {
  const { model } = await load();
  const u = unit(model, '12 одшбр');
  const m107 = item(model, 'М107'), mina82 = item(model, '82 мм');
  const { edits, changed } = buildEdits(model, u.id, {
    shells: { [m107.id]: { spent: 9, left: 2640 }, [mina82.id]: { spent: 4, left: 245 } },
    charges: { [model.chargeItems[1].id]: { spent: 3, left: 190 } },
    vgz: 11, kbb: 8,
    losses: { [model.losses.columns[0].id]: 2 },
  });
  assert.equal(changed, 5, 'без змін залишилися 2640, 4 і 3');
  assert.deepEqual(groupEdits(edits).get('витр.залиш.-СН'), [{ ref: 'E14', value: 245 }, { ref: 'D19', value: 9 }]);
  assert.deepEqual(groupEdits(edits).get('витр.залиш.-ЗАР'), [{ ref: 'E6', value: 190 }]);
  assert.deepEqual(groupEdits(edits).get('Витрата снарядів'), [{ ref: 'C4', value: 8 }]);
  assert.deepEqual(groupEdits(edits).get('втр.прот!'), [{ ref: 'B5', value: 2 }]);
});

test('clearing a value empties the cell', async () => {
  const { model } = await load();
  const u = unit(model, '12 одшбр');
  const { edits } = buildEdits(model, u.id, { shells: { [item(model, 'М107').id]: { spent: '', left: 2640 } } });
  assert.deepEqual(edits, [{ sheet: 'витр.залиш.-СН', ref: 'D19', value: null }]);
});

test('rejects charge input for a unit without charge columns', async () => {
  const { model } = await load();
  assert.throws(() => buildEdits(model, unit(model, '13 ошп').id, { charges: { [model.chargeItems[0].id]: { spent: 1, left: 1 } } }), /заряд/);
});

test('names a free slot when saving a brigade into it', async () => {
  const wb = await openWorkbook(await fixture());
  await setCells(wb, 'Витрата снарядів', [{ ref: 'A7', value: null }]);
  const model = await parseArtilleryWorkbook(wb);
  const free = model.units.find(u => u.free);
  const { edits } = buildEdits(model, free.id, { name: ' 5 ошп ', shells: { [item(model, '60 мм').id]: { spent: 2, left: 10 } } });
  assert.deepEqual(edits[0], { sheet: 'витр.залиш.-СН', ref: 'J2', value: '5 ошп' });
  assert.equal(edits.length, 3);
  await setCells(wb, 'витр.залиш.-СН', edits.filter(e => e.sheet === 'витр.залиш.-СН'));
  const re = await parseArtilleryWorkbook(await openWorkbook(await saveWorkbook(wb)));
  assert.equal(re.units.at(-1).name, '5 ошп');
  assert.deepEqual(valueOf(re, item(re, '60 мм').id, re.units.at(-1).id), { spent: 2, left: 10 });
});

test('saves a brigade entry end to end and re-reads the same numbers', async () => {
  const { wb, model } = await load();
  const u = unit(model, '12 одшбр');
  const { edits } = buildEdits(model, u.id, { shells: { [item(model, 'М795').id]: { spent: 3, left: 77 } }, vgz: 12 });
  for (const [sheet, list] of groupEdits(edits)) await setCells(wb, sheet, list);
  await writeMeta(wb, { date: '2026-10-08', period: '00:00', unit: u.name, changed: edits.length, at: '2026-10-09T00:04:00' });
  const out = await saveWorkbook(wb);
  const wb2 = await openWorkbook(out);
  const model2 = await parseArtilleryWorkbook(wb2, null);
  assert.deepEqual(valueOf(model2, item(model2, 'М795').id, unit(model2, '12 одшбр').id), { spent: 3, left: 77 });
  assert.equal(model2.fire.get(unit(model2, '12 одшбр').id).vgz, 12);
  assert.equal(model2.units.length, model.units.length);
  assert.equal(totals(model2).spent, 99 + 3);
});

test('diff between two snapshots lists only changed expenditure', async () => {
  const { wb, model: before } = await load();
  const u = unit(before, '12 одшбр');
  const { edits } = buildEdits(before, u.id, { shells: { [item(before, 'М795').id]: { spent: 3, left: 77 } } });
  await setCells(wb, 'витр.залиш.-СН', edits);
  const after = await parseArtilleryWorkbook(await openWorkbook(await saveWorkbook(wb)));
  const rows = diffModels(before, after);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spentDelta, 3);
  assert.equal(rows[0].unit.name, '12 одшбр');
});

test('reports problems found in the data', async () => {
  const wb = await openWorkbook(await fixture());
  await setCells(wb, 'витр.залиш.-СН', [{ ref: 'B13', value: -2 }, { ref: 'C14', value: 1.5 }]);
  const model = await parseArtilleryWorkbook(wb);
  assert.equal(model.issues.filter(i => i.level === 'error').length, 2);
});

test('rejects a workbook that is not the artillery ledger', async () => {
  const wb = await openWorkbook(await fixture());
  wb.sheets = wb.sheets.filter(s => s.name !== 'витр.залиш.-СН');
  await assert.rejects(() => parseArtilleryWorkbook(wb), /витр\.залиш\.-СН/);
});
