import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { DEFAULT_BRIGADES, ownDate, ownUnit, parseOwnLosses, validateOwnLosses } from '../src/own-losses-core.js';
import { buildDeck } from '../src/presentation-core.js';
import { daysAcc } from '../src/presentation-format.js';
import { renderDeckToBytes } from '../src/presentation-pptx.js';

// Лише синтетичні дані тієї самої структури, що й таблиця «НАШІ ВТРАТИ».
const HEAD = { A: '№ з/п', B: 'Дата', C: 'Підрозділ', D: 'Втрати О/С', G: 'Дія противника', M: 'Втрати арт систем  (ЗНИЩЕНІ)', X: 'Дії противника', AC: 'Втрати арт систем (ПОШКОДЖЕНІ)', AS: 'Дії противника', AY: 'Артилерійські системи які \nвйшли з ладу' };
const SUB = { D: '200', E: '300', F: '500', G: 'РУ', H: 'АУ', J: 'удар FPV, ББп', K: 'скид з БпЛА', M: 'Д-30', N: '2С1', X: 'РУ', AA: 'удар FPV, ББп', AC: 'Д-30', AD: 'М777', AS: 'РУ', AY: 'Кількість за технічним станом', AZ: 'Найменування' };
const serial = iso => String(Date.parse(`${iso}T00:00:00Z`) / 864e5 + 25569);
const textDate = iso => iso.split('-').reverse().map((p, i) => (i === 2 ? p.slice(2) : p)).join('.');

function sheet(events, { totals, name = 'НАШІ ВТРАТИ' } = {}) {
  const rows = [{ r: 2, cells: { A: 'ВТРАТИ' } }, { r: 5, cells: HEAD }, { r: 6, cells: SUB }];
  events.forEach((event, i) => rows.push({ r: 7 + i, cells: { A: String(i + 1), B: event.textDate ? textDate(event.date) : serial(event.date), C: event.unit, ...event.cells } }));
  let r = 7 + events.length + 2;
  if (totals) rows.push({ r: r++, cells: { C: 'ВСЬОГО:', ...totals } });
  // Підсумкова таблиця після ВСЬОГО має бути проігнорована.
  rows.push({ r: r + 2, cells: { A: '1', B: 'За період', C: '148 оабр', D: '999' } });
  return { name, rows };
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function events() {
  const list = [];
  for (let n = 0; n < 60; n++) { // 2026-08-01 .. 2026-09-29
    const date = addDays('2026-08-01', n);
    const late = n >= 30;
    list.push({ date, textDate: n % 2 === 0, unit: n % 3 === 0 ? 'садн 79 одшбр' : 'абатр 1 дшб 79 одшбр', cells: { E: late ? '3' : '1', J: '1' } });
    if (n % 10 === 0) list.push({ date, unit: '2 сабатр садн 148 оабр', cells: { D: '1', J: '1', M: '1', AA: '2', AC: '1' } });
  }
  return list;
}

test('reads dates in both formats and normalises free-text units to a brigade', () => {
  assert.equal(ownDate('06.05.26'), '2026-05-06');
  assert.equal(ownDate('6.5.2026'), '2026-05-06');
  assert.equal(ownDate('46183'), '2026-06-10');
  assert.equal(ownDate('abc'), '');
  assert.equal(ownUnit('1 абатр адн 79 одшбр'), '79 одшбр');
  assert.equal(ownUnit('3 сабатр садн 148'), '148 оабр');
  assert.equal(ownUnit('адн 1 ошп'), '1 ошп');
  assert.equal(ownUnit('3 шб 33ошп'), '33 ошп');
  assert.equal(ownUnit('невідомий'), 'невідомий');
  assert.ok(DEFAULT_BRIGADES[95]);
});

test('parses the event log: groups, causes per group, metric names kept verbatim', () => {
  const own = parseOwnLosses([sheet(events(), { totals: { D: '6', E: '120' } }), { name: 'Інше', rows: [{ r: 1, cells: { A: 'щось' } }] }]);
  assert.equal(own.kind, 'own_losses');
  assert.equal(own.records.length, 66);
  assert.deepEqual(own.units, ['79 одшбр', '148 оабр']);
  const ids = own.metrics.map(m => m.id);
  for (const id of ['personnel|200', 'personnel|300', 'personnel|500', 'personnelCause|РУ', 'personnelCause|удар FPV, ББп', 'destroyed|Д-30', 'destroyedCause|удар FPV, ББп', 'damaged|М777', 'damagedCause|РУ', 'outOfOrder|За технічним станом']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some(id => id.includes('Найменування')));
  assert.ok(!own.records.some(r => r.values['personnel|200'] === 999), 'рядки після ВСЬОГО не читаються');
});

test('rejects a workbook that is not the own-losses table', () => {
  assert.throws(() => parseOwnLosses([{ name: 'X', rows: [{ r: 1, cells: { A: 'Дата', B: 'Підрозділ', C: 'ВгЗ' } }] }]), e => e.code === 'NOT_OWN_LOSSES');
});

test('checks row sums against the table totals row and flags a date outlier, not its neighbour', () => {
  const evs = events();
  const okOwn = parseOwnLosses([sheet(evs, { totals: { D: '6', E: '120' } })]);
  assert.deepEqual(validateOwnLosses(okOwn).map(i => i.type), []);
  const bad = parseOwnLosses([sheet(evs, { totals: { D: '7', E: '120' } })]);
  assert.deepEqual(validateOwnLosses(bad).map(i => `${i.type}:${i.metric}:${i.raw}`), ['total-mismatch:200:6 ≠ 7']);
  const shuffled = events();
  shuffled.splice(10, 0, { date: '2026-09-20', unit: 'садн 79 одшбр', cells: { E: '1' } }); // описка в місяці серед серпневих рядків
  const own = parseOwnLosses([sheet(shuffled)]);
  const outliers = validateOwnLosses(own).filter(i => i.type === 'date-outlier');
  assert.equal(outliers.length, 1);
  assert.equal(outliers[0].rowNumber, 7 + 10);
  assert.equal(own.records.filter(r => r.suspect).length, 1);
  // Звичайний перехід між днями не є викидом.
  assert.equal(validateOwnLosses(okOwn).filter(i => i.type === 'date-outlier').length, 0);
});

const sheetOf = date => (date.slice(5, 7) === '08' ? 'СЕРПЕНЬ-26' : 'ВЕРЕСЕНЬ-26');
function udshv() {
  const records = [];
  for (let n = 0; n < 60; n++) { const date = addDays('2026-08-01', n); records.push({ sheet: sheetOf(date), rowNumber: records.length + 5, date, unit: 'Підрозділ А', values: { 'personnel|200': 1, 'ammo|155мм': 10, 'ammo|ВСЬОГО': 10 } }); }
  return { kind: 'udshv', readOnly: true, sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], units: ['Підрозділ А'], records, issues: [] };
}
const ownWorkbook = () => parseOwnLosses([sheet(events(), { totals: { D: '6', E: '120' } })]);
const ownSlide = options => buildDeck(udshv(), { ownLosses: ownWorkbook(), ...options }).slides.find(s => s.id === 'own-losses');

test('own-losses slide: period, tiles and comparison come from the table', () => {
  const slide = ownSlide();
  assert.equal(slide.status, 'ready');
  assert.equal(slide.title, 'Власні втрати · останні 30 діб');
  assert.equal(slide.period.text, '31.08.2026 – 29.09.2026');
  assert.equal(slide.previous.text, '01.08.2026 – 30.08.2026');
  assert.equal(slide.previous.complete, true);
  const tile = key => slide.tiles.find(t => t.key === key);
  assert.equal(tile('k300').total, 90);
  assert.equal(tile('k300').previous, 30);
  assert.equal(tile('k300').deltaText, '+200 %');
  assert.equal(tile('k200').total, 3);
  assert.equal(tile('k200').deltaText, '0 (мала база)');
  assert.equal(tile('artDestroyed').total, 3);
  assert.ok(slide.tiles.every(t => t.better === 'down'));
  assert.equal(slide.strip, 'Останні 7 діб: 200 — 0 · 300 — 21 · 500 — 0   |   Весь період: 200 — 6 · 300 — 120 · 500 — 0');
});

test('own-losses slide: changes, concentration and the cause breakdown are factual', () => {
  const slide = ownSlide();
  assert.ok(slide.changes.some(c => c.text === 'Наші 300: 90 проти 30 (+200 %).'), JSON.stringify(slide.changes));
  assert.ok(slide.attention.some(a => a.text === 'Втрати о/с: 79 одшбр — 96,8 % (90 з 93).'), JSON.stringify(slide.attention));
  assert.equal(slide.thirdTitle, 'Головні причини за даними таблиці');
  assert.ok(slide.hypotheses[0].text.startsWith('Дія противника (випадків 33): удар FPV, ББп — 33 (100 %)'), slide.hypotheses[0].text);
  assert.ok(slide.hypotheses.some(h => h.text === 'Арт. системи знищено: Д-30 — 3.'));
  assert.ok(slide.hypotheses.some(h => h.text === 'Арт. системи пошкоджено: Д-30 — 3.'));
  assert.deepEqual(slide.charts.map(c => c.id), ['own-personnel', 'own-causes']);
  assert.equal(slide.charts[0].categories.length, 30);
  assert.deepEqual(slide.charts[0].series.map(s => s.name), ['200', '300', '500']);
  assert.ok(slide.charts[1].horizontal);
});

test('a suspect-dated row is left out of the windows and named in the attention block', () => {
  const evs = events();
  evs.splice(40, 0, { date: '2026-08-05', unit: 'садн 79 одшбр', cells: { E: '50' } }); // серед вересневих рядків
  const own = parseOwnLosses([sheet(evs)]);
  const slide = buildDeck(udshv(), { ownLosses: own }).slides.find(s => s.id === 'own-losses');
  assert.equal(slide.tiles.find(t => t.key === 'k300').total, 90); // 50 із викиду не враховано
  assert.ok(slide.attention.some(a => /Не враховано рядків із підозрілою датою: 1 \(рядок 47\)/.test(a.text)), JSON.stringify(slide.attention));
});

test('own-losses slide: a window before the first record is not compared, and a custom period is honoured', () => {
  const early = ownSlide({ custom: { from: '2026-08-01', to: '2026-08-10' } });
  assert.equal(early.title, 'Власні втрати · обраний період');
  assert.equal(early.previous.complete, false);
  assert.ok(early.attention.some(a => /починається раніше за перший запис/.test(a.text)));
  assert.ok(early.tiles.every(t => t.deltaPercent == null));
});

test('the own-losses slide replaces the placeholder and sits after the whole period', () => {
  const deck = buildDeck(udshv(), { ownLosses: ownWorkbook(), reserveOwnLosses: true, groups: [{ id: 'a', title: 'Група А', units: ['Підрозділ А'] }] });
  assert.deepEqual(deck.slides.map(s => s.id), ['title', 'week', 'month', 'all', 'own-losses', 'group:a']);
  assert.equal(deck.slides.find(s => s.id === 'own-losses').status, 'ready');
});

test('the own-losses slide renders with two native charts and the cause block', async () => {
  const deck = buildDeck(udshv(), { owner: 'Тест', ownLosses: ownWorkbook() });
  const zip = await JSZip.loadAsync(await renderDeckToBytes(deck));
  const slideNames = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slideNames.length, 5);
  const xml = await zip.file('ppt/slides/slide5.xml').async('string');
  const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(' | ');
  assert.ok(text.includes('Власні втрати · останні 30 діб'));
  assert.ok(text.includes('Головні причини за даними таблиці'));
  assert.ok(text.includes('Наші 300'));
  assert.ok(!/undefined|NaN|\bnull\b/.test(text));
  assert.equal(Object.keys(zip.files).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length, 3 * 2 + 2);
});

test('days are declined in the accusative: за 1 добу, за 3 доби, за 7 діб', () => {
  assert.deepEqual([1, 2, 4, 5, 11, 21, 30, 148].map(daysAcc), ['добу', 'доби', 'доби', 'діб', 'діб', 'добу', 'діб', 'діб']);
});

test('every period and group slide carries one own-losses callout for its own number of days', () => {
  const deck = buildDeck(udshv(), { ownLosses: ownWorkbook(), groups: [{ id: 'a', title: 'Група А', units: ['Підрозділ А'] }] });
  const callout = id => deck.slides.find(s => s.id === id).ownCallout;
  // 7 діб: 300 — 21 (3 × 7), 200/500 — 0. 30 діб: 300 — 90, 200 — 3 (події кожні 10 днів). Весь період: 200 — 6, 300 — 120.
  assert.equal(callout('week').text, 'Наші втрати за 7 діб — 21');
  assert.equal(callout('week').detail, '200 — 0 · 300 — 21 · 500 — 0');
  assert.equal(callout('month').text, 'Наші втрати за 30 діб — 93');
  assert.equal(callout('all').days, 60);
  assert.equal(callout('all').text, 'Наші втрати за 60 діб — 126');
  assert.equal(callout('group:a').text, 'Наші втрати за 30 діб — 93');
  assert.equal(deck.slides.find(s => s.id === 'own-losses').ownCallout, undefined);
  assert.equal(deck.slides[0].ownCallout, undefined);
  // Без таблиці власних втрат виноски немає.
  assert.equal(buildDeck(udshv()).slides.find(s => s.id === 'week').ownCallout, null);
});

test('the own-losses callout excludes suspect-dated rows and renders on the slide', async () => {
  const evs = events();
  evs.splice(40, 0, { date: '2026-08-05', unit: 'садн 79 одшбр', cells: { D: '9' } });
  const deck = buildDeck(udshv(), { ownLosses: parseOwnLosses([sheet(evs)]) });
  assert.equal(deck.slides.find(s => s.id === 'all').ownCallout.parts['200'], 6);
  const zip = await JSZip.loadAsync(await renderDeckToBytes(deck));
  const xml = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.ok(xml.includes('Наші втрати за 7 діб — 21'));
});
