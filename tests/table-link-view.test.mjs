import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { emptySchema } from '../src/profile-schema-core.js';
import { syncModuleSources } from '../src/profile-schema-modules-core.js';
import { linkIssues, suggestRelations } from '../src/table-link-core.js';
import { EXCLUSION_TEXT, REASON_TEXT, issueText, linkInputs, pairView, summaryLine } from '../src/table-link-view-core.js';

// Лише синтетичні дані: вигадані підрозділи, жодних реальних таблиць.

const field = (key, label, dataType = 'text', position = 0) => ({ key, label, dataType, position });
const modulePlan = { id: 'plan', title: 'План', fields: [field('date', 'Дата', 'date', 0), field('unit', 'Підрозділ', 'text', 1), field('goal', 'Ціль', 'text', 2)] };
const moduleFlights = { id: 'flights', title: 'Вильоти', fields: [field('date', 'Дата', 'date', 0), field('unit', 'Підрозділ', 'text', 1), field('tail', 'Борт', 'text', 2)] };
const UNITS = ['Альфа', 'Браво', 'Чарлі', 'Дельта'];
const day = n => `2026-09-${String(1 + n).padStart(2, '0')}`;

function setup() {
  const synced = syncModuleSources(emptySchema('profile-view'), [modulePlan, moduleFlights]);
  assert.ok(synced.ok, synced.message);
  const plan = [];
  const flights = [];
  for (let d = 0; d < 6; d += 1) for (const unit of UNITS) {
    plan.push({ date: day(d), unit, goal: `ціль-${d}-${unit}` });
    for (let k = 0; k < 2; k += 1) flights.push({ date: day(d), unit, tail: `${100 + flights.length}` });
  }
  const data = new Map([['plan', { rows: plan, truncated: false }], ['flights', { rows: flights, truncated: false }]]);
  return { schema: synced.schema, data };
}

test('linkInputs бере таблиці зі схеми й даних і називає пропущені', () => {
  const { schema, data } = setup();
  const ok = linkInputs(schema, [modulePlan, moduleFlights], data);
  assert.deepEqual(ok.tables.map(table => table.sourceId), ['module:plan', 'module:flights']);
  assert.deepEqual(ok.skipped, []);
  assert.equal(ok.limited, 0);

  const mixed = linkInputs(schema, [
    modulePlan,
    { id: 'broken', title: 'Збій', fields: [] },
    { id: 'empty', title: 'Порожня', fields: [] },
    { id: 'nowhere', title: 'Нова', fields: [] },
  ], new Map([['plan', data.get('plan')], ['broken', { rows: [], failed: true }], ['empty', { rows: [] }], ['nowhere', { rows: [{ a: 1 }] }]]));
  assert.deepEqual(mixed.tables.map(table => table.title), ['План']);
  assert.deepEqual(mixed.skipped, [
    { title: 'Збій', reason: 'дані не прочитано' },
    { title: 'Порожня', reason: 'таблиця порожня' },
    { title: 'Нова', reason: 'ще немає в профілі' },
  ]);
});

test('linkInputs: усічене читання і більше за 10 000 рядків позначаються, таблиць не більш як вісім', () => {
  const { schema } = setup();
  const big = Array.from({ length: 10_001 }, (_, i) => ({ date: day(i % 20), unit: UNITS[i % 4], goal: String(i) }));
  const truncated = linkInputs(schema, [modulePlan], new Map([['plan', { rows: big, truncated: false }]]));
  assert.equal(truncated.tables[0].truncated, true);
  assert.equal(truncated.tables[0].rows.length, 10_000);
  const flagged = linkInputs(schema, [modulePlan], new Map([['plan', { rows: big.slice(0, 5), truncated: true }]]));
  assert.equal(flagged.tables[0].truncated, true);

  const many = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, title: `Т${i}`, fields: modulePlan.fields }));
  const synced = syncModuleSources(emptySchema('profile-view'), many);
  const data = new Map(many.map(item => [item.id, { rows: [{ date: day(0), unit: 'Альфа', goal: 'x' }] }]));
  const limited = linkInputs(synced.schema, many, data);
  assert.equal(limited.tables.length, 8);
  assert.equal(limited.limited, 2);
});

test('pairView: кандидати, повнота й причини без значень клітинок', async () => {
  const { schema, data } = setup();
  const { tables } = linkInputs(schema, [modulePlan, moduleFlights], data);
  const found = await suggestRelations(tables);
  assert.ok(found.ok);
  const titles = new Map(tables.map(table => [table.sourceId, table.title]));
  const byId = new Map(tables.map(table => [table.sourceId, table]));
  const view = pairView(found.pairs[0], titles, candidate => linkIssues(byId.get(found.pairs[0].leftId), byId.get(found.pairs[0].rightId), candidate));
  assert.equal(view.leftTitle, 'План');
  assert.equal(view.rightTitle, 'Вильоти');
  assert.ok(view.candidates.length >= 1);
  assert.match(view.candidates[0].text, /Дата \+ Підрозділ ↔ Дата \+ Підрозділ/u);
  // Ролі в цьому профілі ще не підтверджено, тож ключ знайдено за збігом значень.
  assert.equal(view.candidates[0].basis, 'за збігом значень');
  // Жодне значення клітинки не потрапляє в показ.
  const shown = JSON.stringify(view);
  for (const unit of UNITS) assert.ok(!shown.includes(unit), `значення «${unit}» у показі`);
  assert.ok(!shown.includes('ціль-'));
  // Повнота: або вичерпний, або названі причини.
  assert.equal(view.exhaustive, view.reasons.length === 0);
  assert.equal(view.completeness === 'Пошук може бути неповним.', !view.exhaustive);
});

test('pairView: неповний пошук називає причини, а виключені стовпці — підстави', async () => {
  const { schema } = setup();
  const rows = Array.from({ length: 12 }, (_, i) => ({ date: day(i), unit: UNITS[i % 4], goal: `ціль-${i}` }));
  const data = new Map([['plan', { rows, truncated: true }], ['flights', { rows: rows.map(row => ({ date: row.date, unit: row.unit, tail: row.goal })), truncated: false }]]);
  const { tables } = linkInputs(schema, [modulePlan, moduleFlights], data);
  const found = await suggestRelations(tables);
  const titles = new Map(tables.map(table => [table.sourceId, table.title]));
  const view = pairView(found.pairs[0], titles);
  assert.equal(view.exhaustive, false);
  assert.ok(view.reasons.includes(REASON_TEXT.truncated), JSON.stringify(view.reasons));
  assert.ok(view.reasons.every(text => !/^[a-z-]+$/u.test(text)), 'причини людською мовою');
  assert.equal(view.completeness, 'Пошук може бути неповним.');
});

test('issueText: кожне питання має людський текст, без технічних кодів', () => {
  const titles = new Map([['module:plan', 'План']]);
  const issues = [
    { kind: 'unknown-header', sourceId: 'module:plan', header: 'X' },
    { kind: 'ambiguous-column', sourceId: 'module:plan', header: 'Y' },
    { kind: 'date-order-assumed', sourceId: 'module:plan', header: 'Дата' },
    { kind: 'date-format', sourceId: 'module:plan', header: 'Дата', unparsed: 2 },
    { kind: 'date-format-mismatch' },
    { kind: 'truncated', sourceId: 'module:plan', rows: 10000 },
    { kind: 'unmatched-keys', onlyLeft: 3, onlyRight: 1 },
  ];
  for (const issue of issues) {
    const text = issueText(issue, titles);
    assert.ok(text.length > 10 && !/[a-z]+-[a-z]+/u.test(text), text);
  }
  assert.match(issueText(issues[2], titles), /припущенням/u);
  assert.match(issueText(issues[2], titles), /План/u);
  assert.match(issueText({ kind: 'novel' }, titles), /Потрібна увага/u);
  assert.ok(Object.values(EXCLUSION_TEXT).every(Boolean));
});

test('summaryLine рахує пари, варіанти й неповні пошуки', () => {
  assert.equal(summaryLine([{ candidates: [{}], exhaustive: true }, { candidates: [], exhaustive: false }]), 'Пар таблиць: 2 · з варіантами: 1 · пошук неповний у 1');
  assert.equal(summaryLine([{ candidates: [], exhaustive: true }]), 'Пар таблиць: 1 · з варіантами: 0');
});

test('панель підключена до «Мого дашборда», нічого не зберігає й не виходить за межі пристрою', async () => {
  const page = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(page, /import \{ linkPanel \} from '\.\/table-link-panel\.js';/u);
  assert.match(page, /linkPanel\(\{ el, schema: \(\) => state\.schema, modules: \(\) => state\.modules, data: \(\) => state\.data \}\)/u);
  assert.match(page, /state\.modules\.length >= 2 && state\.schema/u);
  const panel = await readFile(new URL('../src/table-link-panel.js', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/table-link-view-core.js', import.meta.url), 'utf8');
  for (const source of [panel, core]) {
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/u);
    assert.doesNotMatch(source, /\binvoke\b|fetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket/u);
    assert.doesNotMatch(source, /stroke-dasharray/u);
  }
  assert.doesNotMatch(panel, /updateProfileSchema|saveProfileSchema|save_profile_schema/u);
  // Пошук порціями й переривається: між парами віддається керування, зникла панель = скасування.
  assert.match(panel, /tick: async/u);
  assert.match(panel, /!panel\.isConnected/u);
  assert.match(panel, /data-action': 'cancel-links'/u);
});
