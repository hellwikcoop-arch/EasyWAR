import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { classifyResult, parseStrikes, strikeDate, strikeIssues, strikeStats, tally } from '../src/strikes-core.js';
import { buildDeck } from '../src/presentation-core.js';
import { renderDeckToBytes } from '../src/presentation-pptx.js';

// Лише синтетичні дані тієї самої структури, що й таблиці ПС і РВ («Зведена», контракт із 15 полів).
const AIR_HEAD = { A: '№', B: 'Дата', C: 'Час ураження', D: '№ цілі (TS/KS)', E: 'В інтересах', F: 'Район / н.п.', G: 'DPI / Координати MGRS', H: 'Тип цілі', I: 'Місяць', J: 'Тип ЛА', K: 'Тип боєприпасу', L: 'К-сть боєприпасів', M: 'Результат ураження', N: 'Причина', O: 'Уточнення результату' };
const ROCKET_HEAD = { ...AIR_HEAD, J: 'Тип ПУ', P: 'Підрозділ (від кого машина)', Q: 'Вогнева бригада' };
const serial = iso => String(Date.parse(`${iso}T00:00:00Z`) / 864e5 + 25569);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const textDate = iso => iso.split('-').reverse().join('.');

function table(head, events, name = 'Зведена') {
  const rows = [{ r: 1, cells: head }];
  events.forEach((e, i) => rows.push({ r: 2 + i, cells: {
    A: String(i + 1), B: e.rawDate ?? (e.textDate ? textDate(e.date) : serial(e.date)), E: e.unit ?? '80 ОДШБр', G: 'СЕКРЕТНІ КООРДИНАТИ', F: 'СЕКРЕТНИЙ РАЙОН', D: 'TS0001', O: 'СЕКРЕТНЕ УТОЧНЕННЯ',
    H: e.type ?? 'ПУ БПЛА', J: e.weapon ?? 'МіГ-29', K: e.munition ?? 'GBU-39', L: e.count ?? '2', M: e.result ?? 'УРАЖЕНО', N: e.reason ?? '',
  } }));
  return [{ name, rows }, { name: 'Довідник типів', rows: [{ r: 1, cells: { A: 'Тип цілі' } }] }];
}

// 60 діб: 2026-07-22 .. 2026-09-19; друга половина вдвічі щільніша.
function airEvents() {
  const list = [];
  for (let n = 0; n < 60; n++) {
    const date = addDays('2026-07-22', n);
    const late = n >= 30;
    list.push({ date, textDate: n % 2 === 0, result: 'УРАЖЕНО', unit: late ? (n % 3 === 0 ? '95 ОДШБр' : '80 ОДШБр ') : '95 ОДШБр' });
    if (late) list.push({ date, result: n % 3 === 0 ? 'НЕ УРАЖЕНО.' : 'ЧАСТКОВО УРАЖЕНО', reason: n % 3 === 0 ? 'ППО; РЕБ' : 'РЕБ', munition: 'GBU-62', count: '4', unit: '80 ОДШБр' });
  }
  return list;
}

test('reads dates, results and counts by the EasyWAR rules', () => {
  assert.equal(strikeDate('19.09.2026'), '2026-09-19');
  assert.equal(strikeDate('2026-09-19'), '2026-09-19');
  assert.equal(strikeDate('46149'), '2026-05-07');
  assert.equal(strikeDate('31.02.2026'), '');
  assert.equal(strikeDate('abc'), '');
  assert.deepEqual(['УРАЖЕНО.', 'Частково УРАЖЕНО', 'ЧАСТКОВО УРАЖЕНО:', 'ПОШКОДЖЕНО', 'ПОДАВЛЕНО', 'ЗНИЩЕНО', 'НЕ УРАЖЕНО. ВІДБІЙ ЗАВДАННЯ', 'не підтверджено', 'невідомо', ''].map(classifyResult), ['hit', 'partial', 'partial', 'partial', 'partial', 'hit', 'miss', 'miss', 'unknown', 'unknown']);
});

test('parses the contract, detects the weapon column and never reads coordinates, districts or notes', () => {
  const air = parseStrikes(table(AIR_HEAD, airEvents()), 'air.xlsx');
  assert.equal(air.kind, 'strikes');
  assert.equal(air.weaponLabel, 'Тип ЛА');
  assert.equal(air.records.length, 60 + 30);
  assert.equal(air.records[0].date, '2026-07-22');
  assert.ok(air.records.every(r => r.unit === r.unit.trim()));
  assert.ok(!JSON.stringify(air).includes('СЕКРЕТН'), 'координати, район й уточнення не читаються');
  assert.ok(!('coordinates' in air.records[0]) && !('district' in air.records[0]));
  const rocket = parseStrikes(table(ROCKET_HEAD, [{ date: '2026-09-19', weapon: 'М142', munition: 'M30A2', count: '1' }]));
  assert.equal(rocket.weaponLabel, 'Тип ПУ');
  assert.equal(rocket.records[0].weapon, 'М142');
});

test('rejects other workbooks and ambiguous headers', () => {
  assert.throws(() => parseStrikes([{ name: 'X', rows: [{ r: 1, cells: { A: 'Дата', B: 'Час' } }] }]), e => e.code === 'NOT_STRIKES');
  assert.throws(() => parseStrikes([{ name: 'Зведена', rows: [{ r: 1, cells: { A: 'Дата', B: 'Результат ураження', C: 'Дата' } }] }]), e => e.code === 'AMBIGUOUS_HEADER');
});

test('counts: numeric prefix, none markers, abort in result or reason, unknown results are flagged', () => {
  const t = table(AIR_HEAD, [
    { date: '2026-09-01', count: '4 (2+2)' }, { date: '2026-09-02', count: '—' }, { date: '2026-09-03', count: 'багато' },
    { date: '2026-09-04', result: 'НЕ УРАЖЕНО. ВІДБІЙ ЗАВДАННЯ' }, { date: '2026-09-05', result: 'НЕ УРАЖЕНО', reason: 'Відбій / без роботи' }, { date: '2026-09-06', result: 'щось' },
    { rawDate: 'не дата', result: 'УРАЖЕНО' },
  ]);
  const w = parseStrikes(t);
  assert.deepEqual(w.records.map(r => r.count), [4, 0, 0, 2, 2, 2]);
  assert.deepEqual(w.records.filter(r => r.aborted).map(r => r.date), ['2026-09-04', '2026-09-05']);
  assert.deepEqual(strikeIssues(w).map(i => `${i.type}:${i.raw}`), ['invalid-count:багато', 'unknown-result:щось', 'invalid-date:не дата']);
  const st = strikeStats(w.records);
  assert.equal(st.total, 6);
  assert.equal(st.aborted, 2);
  assert.equal(st.evaluated, 4);
  assert.equal(st.hit, 3);
  assert.equal(st.unknown, 1);
});

test('effectiveness uses both repository formulas and rounds to two decimals', () => {
  const w = parseStrikes(table(AIR_HEAD, [
    { date: '2026-09-01', result: 'УРАЖЕНО' }, { date: '2026-09-02', result: 'УРАЖЕНО' }, { date: '2026-09-03', result: 'ЧАСТКОВО УРАЖЕНО' }, { date: '2026-09-04', result: 'НЕ УРАЖЕНО' }, { date: '2026-09-05', result: 'УРАЖЕНО', reason: 'Відбій' },
  ]));
  const st = strikeStats(w.records);
  assert.equal(st.overall, 75); // (2 + 1) / 4
  assert.equal(st.dpi, 68.75); // (2 + 0,75) / 4
  assert.equal(strikeStats([]).overall, null);
});

test('tally sorts by value and splits list fields', () => {
  const w = parseStrikes(table(AIR_HEAD, airEvents()));
  assert.deepEqual(tally(w.records, r => r.reasons).map(i => i.name), ['РЕБ', 'ППО']);
  assert.equal(tally(w.records, r => r.munition, r => r.count)[0].name, 'GBU-39');
});

const udshv = () => {
  const records = [];
  for (let n = 0; n < 60; n++) { const date = addDays('2026-08-01', n); records.push({ sheet: date.slice(5, 7) === '08' ? 'СЕРПЕНЬ-26' : 'ВЕРЕСЕНЬ-26', rowNumber: n + 5, date, unit: 'Підрозділ А', values: { 'personnel|200': 1, 'ammo|ВСЬОГО': 10, 'ammo|155мм': 10 } }); }
  return { kind: 'udshv', readOnly: true, sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], units: ['Підрозділ А'], records, issues: [] };
};
const groups = () => [
  { id: 'ps', title: 'ПС', strikes: parseStrikes(table(AIR_HEAD, airEvents()), 'air.xlsx') },
  { id: 'rvia', title: 'РВ', strikes: parseStrikes(table(ROCKET_HEAD, [{ date: '2026-09-19', weapon: 'М142', munition: 'M30A2', count: '1', result: 'НЕ УРАЖЕНО' }, { date: '2026-09-20', weapon: 'М142', munition: 'M30A2', count: '1', result: 'ПОШКОДЖЕНО' }])) },
];

test('group slide is built from the group table: anchor is its last date, windows and efficiency follow the repo rules', () => {
  const deck = buildDeck(udshv(), { groups: groups() });
  assert.deepEqual(deck.slides.map(s => s.id), ['title', 'week', 'month', 'all', 'group:ps', 'group:rvia']);
  const ps = deck.slides.find(s => s.id === 'group:ps');
  assert.equal(ps.title, 'ПС · останні 30 діб');
  assert.equal(ps.period.text, '21.08.2026 – 19.09.2026'); // до останнього запису таблиці ПС, не до кінця УДШВ
  assert.equal(ps.previous.text, '22.07.2026 – 20.08.2026');
  assert.equal(ps.previous.complete, true);
  const tile = key => ps.tiles.find(t => t.key === key);
  // Останні 30 діб: 30 «УРАЖЕНО» + 30 додаткових записів (10 «НЕ УРАЖЕНО», 20 «ЧАСТКОВО»).
  assert.equal(tile('total').total, 60);
  assert.ok(ps.ownCallout === null);
  assert.equal(ps.scope.source, 'strikes_table');
});

test('group slide numbers: counts, efficiency in percentage points, reasons and munitions come from the table', () => {
  const ps = buildDeck(udshv(), { groups: groups() }).slides.find(s => s.id === 'group:ps');
  const tile = key => ps.tiles.find(t => t.key === key);
  assert.equal(tile('total').total, 60);
  assert.equal(tile('total').previous, 30);
  assert.equal(tile('total').deltaText, '+100 %');
  assert.equal(tile('hit').total, 30);
  assert.equal(tile('miss').total, 10);
  assert.equal(tile('partial').total, 20);
  assert.equal(tile('effect').totalText, '83,3'); // (30 + 20) / 60
  assert.equal(tile('effect').previous, 100);
  assert.equal(tile('effect').deltaText, '−16,7 п.п.');
  assert.equal(tile('munitions').total, 30 * 2 + 30 * 4);
  assert.match(ps.strip, /^Ефективність DPI: 75 %/); // (30 + 0,75 · 20) / 60
  assert.ok(ps.changes.some(c => c.text.startsWith('Ефективність: 83,3 % проти 100 % (−16,7 п.п.; оцінено 60 проти 30)')), JSON.stringify(ps.changes));
  assert.ok(ps.hypotheses[0].text.startsWith('Причини невдач (у 30 із 60 завдань): РЕБ — 30, ППО — 10.'), ps.hypotheses[0].text);
  assert.ok(ps.hypotheses[2].text.startsWith('Боєприпаси (шт.): GBU-62 — 120, GBU-39 — 60.'), ps.hypotheses[2].text);
  assert.deepEqual(ps.charts.map(c => c.id), ['strike-results', 'strike-reasons']);
  assert.equal(ps.charts[0].grouping, 'stacked');
  assert.deepEqual(ps.charts[0].series.map(s => s.name), ['Уражено', 'Частково', 'Не уражено']);
  assert.ok(ps.attention.some(a => a.text === 'Завдання в інтересах 80 ОДШБр — 83,3 % (50 з 60).'), JSON.stringify(ps.attention));
});

test('a young table is not compared with a window that starts before its first record', () => {
  const rvia = buildDeck(udshv(), { groups: groups() }).slides.find(s => s.id === 'group:rvia');
  assert.equal(rvia.previous.complete, false);
  assert.ok(rvia.attention.some(a => /починається раніше за перший запис таблиці РВ/.test(a.text)));
  assert.ok(rvia.tiles.every(t => t.deltaText === ''));
  assert.ok(rvia.attention.some(a => /Мала вибірка \(2 завдань\)/.test(a.text)));
  assert.equal(rvia.strip.includes('ПУ: М142 — 2'), true);
});

test('a group without its table falls back to the УДШВ units, and an empty table becomes a plain notice', () => {
  const fallback = buildDeck(udshv(), { groups: [{ id: 'a', title: 'Група А', units: ['Підрозділ А'] }] }).slides.at(-1);
  assert.equal(fallback.scope.label, 'Група А');
  const empty = parseStrikes(table(AIR_HEAD, [{ rawDate: 'не дата' }]));
  const slide = buildDeck(udshv(), { groups: [{ id: 'ps', title: 'ПС', strikes: empty }] }).slides.at(-1);
  assert.equal(slide.status, 'no_source');
  assert.match(slide.message, /немає жодного запису/);
});

test('group slides render with a stacked native chart and no coordinates in the file', async () => {
  const deck = buildDeck(udshv(), { owner: 'Тест', groups: groups() });
  const zip = await JSZip.loadAsync(await renderDeckToBytes(deck));
  const names = Object.keys(zip.files);
  const slideXml = await zip.file('ppt/slides/slide5.xml').async('string');
  const text = [...slideXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(' | ');
  assert.ok(text.includes('ПС · останні 30 діб'));
  assert.ok(text.includes('Головні факти за даними таблиці'));
  assert.ok(!/undefined|NaN|\bnull\b/.test(text));
  let all = '';
  for (const name of names.filter(n => n.endsWith('.xml'))) all += await zip.file(name).async('string');
  assert.ok(!all.includes('СЕКРЕТН'));
  const chart = names.filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
  assert.equal(chart.length, 3 * 3 + (deck.slides.length - 4) * 2); // слайди періодів УДШВ мають ще й «Типи уражених цілей»; слайди груп — дві діаграми
  assert.ok((await Promise.all(chart.map(n => zip.file(n).async('string')))).some(x => x.includes('c:grouping val="stacked"')));
});
