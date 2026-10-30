import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { emptySchema } from '../src/profile-schema-core.js';
import { syncModuleSources } from '../src/profile-schema-modules-core.js';
import { linkIssues, suggestRelations } from '../src/table-link-core.js';
import { confirmRelation, rejectRelation, clearRelation, clearRelations, setGroups, groupsOf, relationsOf, removeSource } from '../src/profile-schema-core.js';
import {
  EXCLUSION_TEXT, REASON_TEXT, confirmArgs, confirmBlock, decisionOf, issueText, linkInputs, pairView, rejectArgs,
  rejectedRelationViews, relatedLine, savedRelationViews, summaryLine, suggestedGroups, groupsNeedSaving, savedGroupViews, deleteLinksNote, linkCoverageViews, mergePreviewView, mergeDownloadView, tableCsv,
} from '../src/table-link-view-core.js';

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
  assert.match(page, /linkPanel\(\{ el, schema: \(\) => state\.schema, modules: \(\) => state\.modules, data: \(\) => state\.data, apply: applyLinkChange, onChange: refreshRelatedLines \}\)/u);
  assert.match(page, /updateProfileSchema\(invoke, change\)/u);
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

async function firstCandidate() {
  const { schema, data } = setup();
  const { tables } = linkInputs(schema, [modulePlan, moduleFlights], data);
  const found = await suggestRelations(tables);
  assert.ok(found.ok && found.pairs[0].candidates.length);
  return { schema, candidate: found.pairs[0].candidates[0] };
}

test('рішення: підтвердити → «підтверджено», відхилити → «відхилено», зняти → знову відкрито; після перезавантаження так само', async () => {
  const { schema, candidate } = await firstCandidate();
  assert.equal(decisionOf(schema, candidate).state, 'open');
  const confirmed = confirmRelation(schema, confirmArgs(candidate, { at: '2026-10-29T10:00:00Z' }));
  assert.ok(confirmed.ok, confirmed.message);
  assert.equal(decisionOf(confirmed.schema, candidate).state, 'confirmed');
  assert.equal(relationsOf(confirmed.schema)[0].basis, 'values');
  const cleared = clearRelation(confirmed.schema, decisionOf(confirmed.schema, candidate).id);
  assert.equal(decisionOf(cleared.schema, candidate).state, 'open');
  const rejected = rejectRelation(schema, rejectArgs(candidate));
  assert.ok(rejected.ok);
  assert.equal(decisionOf(rejected.schema, candidate).state, 'rejected');
  assert.deepEqual(savedRelationViews(rejected.schema), []);
  assert.equal(rejectedRelationViews(rejected.schema).length, 1);
});

test('рішення: інший ключ тієї ж пари — «taken», заміна лише явна', async () => {
  const { schema, candidate } = await firstCandidate();
  const first = confirmRelation(schema, confirmArgs(candidate)).schema;
  const other = { ...candidate, left: { ...candidate.left, columns: [candidate.left.columns[0]], headers: [candidate.left.headers[0]] }, right: { ...candidate.right, columns: [candidate.right.columns[0]], headers: [candidate.right.headers[0]] } };
  const state = decisionOf(first, other);
  assert.equal(state.state, 'taken');
  assert.equal(confirmRelation(first, confirmArgs(other)).code, 'pair_taken');
  const replaced = confirmRelation(first, confirmArgs(other, { replace: true }));
  assert.ok(replaced.ok);
  assert.equal(relationsOf(replaced.schema).length, 1);
});

test('кандидат з припущеним порядком дат не підтверджується', () => {
  assert.match(confirmBlock({ caution: ['date-order-assumed'] }), /лише припущено/u);
  assert.equal(confirmBlock({ caution: ['incomplete-read'] }), '');
  assert.equal(confirmBlock({}), '');
});

test('збережені зв’язки: текст, «перевірте», рядок «Зв’язано з» на картці', async () => {
  const { schema, candidate } = await firstCandidate();
  const saved = confirmRelation(schema, confirmArgs(candidate)).schema;
  const [view] = savedRelationViews(saved);
  assert.match(view.text, /План: Дата \+ Підрозділ ↔ Вильоти: Дата \+ Підрозділ/u);
  assert.equal(view.stale, false);
  assert.match(relatedLine(saved, 'module:plan'), /^Зв’язано з: Вильоти \(за «Дата \+ Підрозділ»\)$/u);
  assert.match(relatedLine(saved, 'module:flights'), /План/u);
  assert.equal(relatedLine(schema, 'module:plan'), '');
  // жодне значення клітинки не потрапляє ні в схему, ні в показ
  const everything = JSON.stringify([saved, savedRelationViews(saved), relatedLine(saved, 'module:plan')]);
  for (const unit of UNITS) assert.ok(!everything.includes(unit));
});

function threeTables() {
  const third = { id: 'extra', title: 'Склад', fields: [field('date', 'Дата', 'date', 0), field('unit', 'Підрозділ', 'text', 1), field('item', 'Позиція', 'text', 2)] };
  const lonely = { id: 'lonely', title: 'Окрема', fields: [field('a', 'Альфа', 'text', 0), field('b', 'Бета', 'text', 1)] };
  const synced = syncModuleSources(emptySchema('profile-view'), [modulePlan, moduleFlights, third, lonely]);
  assert.ok(synced.ok, synced.message);
  return synced.schema;
}
const keyArgs = (l, r) => ({ left: { sourceId: l, columns: ['date', 'unit'] }, right: { sourceId: r, columns: ['date', 'unit'] }, cardinality: 'one-many', basis: 'values' });

test('групи: з’єднані зв’язками таблиці — одна група, окрема таблиця в групу не потрапляє', () => {
  let schema = threeTables();
  assert.deepEqual(suggestedGroups(schema), []);
  schema = confirmRelation(schema, keyArgs('module:plan', 'module:flights')).schema;
  schema = confirmRelation(schema, keyArgs('module:flights', 'module:extra')).schema;
  const groups = suggestedGroups(schema);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sourceIds, ['module:extra', 'module:flights', 'module:plan']);
  assert.equal(groups[0].title, 'Склад + Вильоти + План');
  assert.equal(groupsNeedSaving(schema), true);
  const saved = setGroups(schema, groups);
  assert.ok(saved.ok, saved.message);
  assert.equal(groupsNeedSaving(saved.schema), false);
  assert.equal(savedGroupViews(saved.schema)[0].tables.length, 3);
});

test('групи: дві окремі пари дають дві групи, зняття зв’язку розпускає групу, «Скинути зв’язки» чистить усе', () => {
  let schema = threeTables();
  schema = confirmRelation(schema, keyArgs('module:plan', 'module:flights')).schema;
  schema = confirmRelation(schema, { left: { sourceId: 'module:extra', columns: ['unit'] }, right: { sourceId: 'module:lonely', columns: ['a'] }, cardinality: 'one-many', basis: 'values' }).schema;
  const groups = suggestedGroups(schema);
  assert.equal(groups.length, 2);
  const grouped = setGroups(schema, groups).schema;
  const [first] = relationsOf(grouped);
  const cut = clearRelation(grouped, first.id).schema;
  assert.equal(groupsOf(cut).length, 1, 'розпалась лише група цієї пари');
  const reset = clearRelations(grouped).schema;
  assert.deepEqual([relationsOf(reset), groupsOf(reset)], [[], []]);
  assert.equal(reset.sources.length, 4, 'таблиці лишаються');
});

test('попередження перед видаленням модуля називає зв’язані таблиці; після видалення зв’язків і груп немає', () => {
  let schema = threeTables();
  assert.equal(deleteLinksNote(schema, 'module:plan'), '');
  schema = confirmRelation(schema, keyArgs('module:plan', 'module:flights')).schema;
  assert.equal(deleteLinksNote(schema, 'module:plan'), 'Зникне й підтверджений зв’язок із «Вильоти»; решта модулів лишиться без змін.');
  assert.match(deleteLinksNote(schema, 'module:flights'), /«План»/u);
  assert.equal(deleteLinksNote(schema, 'module:lonely'), '');
  schema = setGroups(schema, suggestedGroups(schema)).schema;
  const removed = removeSource(schema, 'module:plan');
  assert.deepEqual([relationsOf(removed.schema).length, groupsOf(removed.schema).length], [0, 0]);
  assert.equal(removed.schema.sources.some(source => source.id === 'module:plan'), false);
});

test('екран B4: кнопки груп і скидання, попередження в картці', async () => {
  const panel = await readFile(new URL('../src/table-link-panel.js', import.meta.url), 'utf8');
  for (const action of ['split-groups', 'clear-groups', 'reset-links', 'confirm-reset-links']) assert.match(panel, new RegExp(`data-action': '${action}'`, 'u'));
  const page = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(page, /deleteLinksNote\(state\.schema/u);
  assert.match(page, /data-delete-links-for/u);
});

test('читання за зв’язком: покриття по кожному зв’язку, «перевірте» і непрочитані дані пропускаються з поясненням', async () => {
  const { schema: base, data } = setup();
  const { tables } = linkInputs(base, [modulePlan, moduleFlights], data);
  const found = await suggestRelations(tables);
  const candidate = found.pairs[0].candidates.find(item => item.left.columns.length === 2);
  const schema = confirmRelation(base, confirmArgs(candidate)).schema;
  const modules = [modulePlan, moduleFlights];
  const [view] = linkCoverageViews(schema, 'module:plan', modules, data);
  assert.equal(view.text, '«Вильоти»: пару має 24 з 24 рядків тут і 48 з 48 там; без пари: 0 тут, 0 там.');
  assert.equal(view.warn, false);
  assert.match(linkCoverageViews(schema, 'module:flights', modules, data)[0].text, /«План»: пару має 48 з 48/u);
  // Дані пов'язаної таблиці не прочитано.
  const failed = new Map([['plan', data.get('plan')], ['flights', { rows: [], failed: true }]]);
  assert.match(linkCoverageViews(schema, 'module:plan', modules, failed)[0].text, /дані не прочитано/u);
  // Таблиця з рядком без пари підсвічується.
  const more = new Map(data);
  more.set('plan', { rows: [...data.get('plan').rows, { date: day(20), unit: 'Ехо', goal: 'без пари' }] });
  const odd = linkCoverageViews(schema, 'module:plan', modules, more)[0];
  assert.match(odd.text, /пару має 24 з 25 рядків тут/u);
  assert.equal(odd.warn, true);
  // Зв'язок без залежностей: порожній перелік.
  assert.deepEqual(linkCoverageViews(base, 'module:plan', modules, data), []);
  // Зміна стовпця ключа: «перевірте».
  const changed = { ...schema, sources: schema.sources.map(source => (source.id === 'module:plan' ? { ...source, columns: source.columns.map(column => (column.key === 'unit' ? { ...column, orphan: true } : column)) } : source)) };
  assert.match(linkCoverageViews(changed, 'module:plan', modules, data)[0].text, /перевірити/u);
});

test('екран: покриття зв’язку рахується після малювання й не блокує дашборд', async () => {
  const page = await readFile(new URL('../src/dashboard-module-catalog.js', import.meta.url), 'utf8');
  assert.match(page, /function fillCoverage/u);
  assert.match(page, /setTimeout\(\(\) => \{\s*if \(!list\.isConnected/u);
  assert.match(page, /linkCoverageViews\(state\.schema/u);
});

test('перегляд об’єднання: текст підсумку, застереження, відмови; значень у схемі немає, нічого не створюється', async () => {
  const { schema: base, data } = setup();
  const modules = [modulePlan, moduleFlights];
  const { tables } = linkInputs(base, modules, data);
  const found = await suggestRelations(tables);
  const candidate = found.pairs[0].candidates.find(item => item.left.columns.length === 2);
  const schema = confirmRelation(base, confirmArgs(candidate)).schema;
  const relationId = relationsOf(schema)[0].id;
  const view = mergePreviewView(schema, relationId, modules, data);
  assert.ok(view.ok, view.message);
  assert.equal(view.title, 'План + Вильоти');
  assert.equal(view.summary, 'Об’єднана таблиця мала б 48 рядків і 4 стовпців; з парою: 48.');
  assert.deepEqual(view.columns, ['Дата', 'Підрозділ', 'Ціль', 'Борт']);
  assert.equal(view.sample.length, 5);
  assert.deepEqual(view.notes, []);
  // Рядок без пари дає застереження.
  const odd = new Map(data);
  odd.set('plan', { rows: [...data.get('plan').rows, { date: day(20), unit: 'Ехо', goal: 'без пари' }] });
  assert.match(mergePreviewView(schema, relationId, modules, odd).notes.join(' '), /1 з «План»/u);
  // Відмови.
  assert.match(mergePreviewView(schema, 'rel:нема', modules, data).message, /немає/u);
  assert.match(mergePreviewView(schema, relationId, modules, new Map([['plan', data.get('plan')]])).message, /не прочитано/u);
  assert.match(mergePreviewView(base, relationId, modules, data).message, /немає/u);
  // Схема перегляд не змінює.
  assert.equal(JSON.stringify(schema), JSON.stringify(confirmRelation(base, confirmArgs(candidate)).schema));
  const panel = await readFile(new URL('../src/table-link-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /data-action': 'preview-merge'/u);
  assert.doesNotMatch(panel, /mergePreviewView[^\n]*apply\(/u);
});

test('mergeDownloadView віддає повний CSV нового файлу й не пише в схему', async () => {
  const { schema: base, data } = setup();
  const modules = [modulePlan, moduleFlights];
  const found = await suggestRelations(linkInputs(base, modules, data).tables, {});
  const candidate = found.pairs[0].candidates.find(item => item.left.columns.length === 2);
  const schema = confirmRelation(base, confirmArgs(candidate)).schema;
  const before = JSON.stringify(schema);
  const relationId = relationsOf(schema)[0].id;
  const file = mergeDownloadView(schema, relationId, modules, data, () => '2026-10-30T01:00:00Z');
  assert.ok(file.ok, file.message);
  assert.equal(file.filename, 'eW_obyednana_20261030.csv');
  assert.equal(file.rowCount, 48);
  const lines = file.text.slice(1).split('\r\n');
  assert.equal(file.text[0], '\uFEFF');
  assert.equal(lines.length, 49, 'заголовок + усі 48 рядків, не лише зразок');
  assert.equal(lines[0], 'Дата;Підрозділ;Ціль;Борт');
  assert.equal(JSON.stringify(schema), before);
  // Неповно прочитану таблицю не віддаємо.
  const cut = new Map(data);
  cut.set('plan', { rows: data.get('plan').rows, truncated: true });
  assert.match(mergeDownloadView(schema, relationId, modules, cut).message, /не повністю/u);
  assert.equal(mergePreviewView(schema, relationId, modules, cut).downloadable, false);
  assert.equal(mergePreviewView(schema, relationId, modules, data).downloadable, true);
  assert.match(mergeDownloadView(schema, 'rel:нема', modules, data).message, /немає/u);
  const panel = await readFile(new URL('../src/table-link-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /data-action': 'download-merge'/u);
  assert.doesNotMatch(panel, /invoke\(/u);
});

test('tableCsv екранує роздільник, лапки й переноси', () => {
  assert.equal(tableCsv([['a;b', 'c"d'], ['e\nf', null, 'ok']]), '\uFEFF"a;b";"c""d"\r\n"e\nf";;ok');
});
