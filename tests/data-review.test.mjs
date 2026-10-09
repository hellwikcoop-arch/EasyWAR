import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReview, defaultDecisions, reviewData } from '../src/data-review-core.js';
import { parseOwnLosses } from '../src/own-losses-core.js';
import { parseStrikes } from '../src/strikes-core.js';
import { buildDeck } from '../src/presentation-core.js';

// Лише синтетичні дані. Книга УДШВ збирається напряму в формі parseUdshvWorkbook.
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const SHEETS = { '07': 'ЛИПЕНЬ-26', '08': 'СЕРПЕНЬ-26', '09': 'ВЕРЕСЕНЬ-26' };

function udshv({ stray = false, duplicate = false, gap = false } = {}) {
  const records = [];
  let row = 5;
  for (let n = 0; n < 40; n++) {
    const date = addDays('2026-08-01', n);
    if (gap && n >= 10 && n <= 12) continue;
    for (const unit of ['Підрозділ А', 'Підрозділ Б']) {
      // Блок першого підрозділу з 20-ї доби має хибну дату з іншого місяця (описка).
      const wrong = stray && n === 20;
      records.push({ sheet: SHEETS[date.slice(5, 7)], rowNumber: row++, date: wrong ? '2026-04-15' : date, unit, values: { 'personnel|200': 1 } });
    }
  }
  if (duplicate) records.push({ sheet: 'СЕРПЕНЬ-26', rowNumber: row++, date: '2026-08-05', unit: 'Підрозділ А', values: { 'personnel|200': 4 } });
  return { kind: 'udshv', readOnly: true, sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], units: ['Підрозділ А', 'Підрозділ Б'], records, issues: [] };
}

const HEAD = { A: '№ з/п', B: 'Дата', C: 'Підрозділ', D: 'Втрати О/С', G: 'Дія противника' };
const SUB = { D: '200', E: '300', F: '500', G: 'РУ' };
const serial = iso => String(Date.parse(`${iso}T00:00:00Z`) / 864e5 + 25569);
function own(dates, extra = {}) {
  const rows = [{ r: 5, cells: HEAD }, { r: 6, cells: SUB }];
  dates.forEach((d, i) => rows.push({ r: 7 + i, cells: { A: String(i + 1), B: d.startsWith('x') ? d.slice(1) : serial(d), C: 'садн 79 одшбр', E: '1', ...extra } }));
  return parseOwnLosses([{ name: 'НАШІ ВТРАТИ', rows }]);
}

const AIR_HEAD = { A: '№', B: 'Дата', E: 'В інтересах', H: 'Тип цілі', J: 'Тип ЛА', K: 'Тип боєприпасу', L: 'К-сть боєприпасів', M: 'Результат ураження', N: 'Причина' };
function strikes(events) {
  const rows = [{ r: 1, cells: AIR_HEAD }];
  events.forEach((e, i) => rows.push({ r: 2 + i, cells: { A: String(i + 1), B: e.date.startsWith('x') ? e.date.slice(1) : serial(e.date), E: '80 ОДШБр', H: 'ПУ БПЛА', J: 'МіГ-29', K: 'GBU-39', L: e.count ?? '2', M: e.result ?? 'УРАЖЕНО' } }));
  return parseStrikes([{ name: 'Зведена', rows }]);
}

test('a clean set of tables gives an empty review', () => {
  const review = reviewData({ udshv: udshv(), ownLosses: own(['2026-09-01', '2026-09-02']), groups: [{ id: 'ps', title: 'ПС', strikes: strikes([{ date: '2026-09-01' }]) }] });
  assert.equal(review.clean, true);
  assert.deepEqual(review.counts, { total: 0, error: 0, warning: 0, info: 0, actionable: 0 });
});

test('a wrong-month block is one item that suggests the date of the row it follows', () => {
  const review = reviewData({ udshv: udshv({ stray: true }) });
  const item = review.items.find(i => i.kind === 'date-outside-month');
  assert.ok(item);
  assert.equal(item.severity, 'error');
  assert.equal(item.rows.length, 2);
  assert.match(item.title, /15\.04\.2026/);
  assert.equal(item.options[0].value, '2026-08-20'); // дата рядка перед блоком... (попередній рядок у тому ж аркуші)
  assert.equal(item.defaultAction, 'skip');
});

test('missing days are grouped into runs and only informational', () => {
  const item = reviewData({ udshv: udshv({ gap: true }) }).items.find(i => i.kind === 'missing-date');
  assert.equal(item.title, 'Немає рядків за 3 доби');
  assert.equal(item.severity, 'info');
  assert.deepEqual(item.options.map(o => o.action), ['keep']);
});

test('duplicates with data on both rows are offered, empty repeats are not', () => {
  const dup = reviewData({ udshv: udshv({ duplicate: true }) }).items.filter(i => i.kind === 'duplicate');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].defaultAction, 'keep');
  const wb = udshv();
  wb.records.push({ sheet: 'СЕРПЕНЬ-26', rowNumber: 999, date: '2026-08-05', unit: 'Підрозділ А', values: {} });
  assert.equal(reviewData({ udshv: wb }).items.filter(i => i.kind === 'duplicate').length, 0);
});

test('own-losses outlier: neighbours come from the table order, not from date order', () => {
  const dates = ['2026-06-10', '2026-06-11', '2026-09-12', '2026-06-12', '2026-06-13', '2026-06-14'];
  const item = reviewData({ ownLosses: own(dates) }).items.find(i => i.kind === 'date-outlier');
  assert.ok(item, 'викид знайдено');
  assert.deepEqual(item.options.filter(o => o.value).map(o => o.value), ['2026-06-12', '2026-06-11']);
  assert.match(item.detail, /перед ним 11\.06\.2026, після нього 12\.06\.2026/);
});

test('strikes: identical unknown results are one item; bad dates and counts are separate items', () => {
  const t = strikes([{ date: '2026-09-01' }, { date: '2026-09-02', result: 'НЕ ВІДОМО' }, { date: '2026-09-03', result: 'НЕ ВІДОМО' }, { date: 'xне дата' }, { date: '2026-09-04', count: 'багато' }]);
  const items = reviewData({ groups: [{ id: 'rvia', title: 'РВ', strikes: t }] }).items;
  assert.deepEqual(items.map(i => i.kind).sort(), ['invalid-count', 'invalid-date', 'unknown-result']);
  const unknown = items.find(i => i.kind === 'unknown-result');
  assert.equal(unknown.rows.length, 2);
  assert.equal(unknown.title, 'Результат не розпізнано (2)');
  assert.equal(items.find(i => i.kind === 'invalid-date').severity, 'error');
  assert.equal(items[0].severity, 'error'); // помилки зверху
});

test('applying a fix works on copies: the parsed input is untouched and every change is logged', () => {
  const wb = udshv({ stray: true });
  const before = JSON.stringify(wb);
  const review = reviewData({ udshv: wb });
  const item = review.items.find(i => i.kind === 'date-outside-month');
  const res = applyReview({ udshv: wb }, review, { [item.id]: { action: 'fix', value: '2026-08-21' } });
  assert.equal(JSON.stringify(wb), before, 'розібрані дані не змінено');
  assert.equal(res.udshv.records.filter(r => r.date === '2026-04-15').length, 0);
  assert.equal(res.udshv.records.filter(r => r.date === '2026-08-21').length, 2);
  assert.equal(res.corrections.length, 2);
  assert.deepEqual(res.corrections[0], { source: 'udshv', sourceLabel: 'УДШВ', sheet: 'СЕРПЕНЬ-26', rows: item.rows, field: 'date', from: '2026-04-15', to: '2026-08-21', action: 'fix', title: item.title });
  assert.equal(reviewData({ udshv: res.udshv }).items.some(i => i.kind === 'date-outside-month'), false);
});

test('skip drops the rows from the copy, keep changes nothing, bad values are rejected', () => {
  const wb = udshv({ stray: true });
  const review = reviewData({ udshv: wb });
  const item = review.items.find(i => i.kind === 'date-outside-month');
  const skipped = applyReview({ udshv: wb }, review, defaultDecisions(review.items));
  assert.equal(skipped.udshv.records.length, wb.records.length - 2);
  const kept = applyReview({ udshv: wb }, review, { [item.id]: { action: 'keep' } });
  assert.equal(kept.udshv.records.length, wb.records.length);
  assert.equal(kept.corrections.length, 0);
  const bad = applyReview({ udshv: wb }, review, { [item.id]: { action: 'fix', value: '31.02.2026' } });
  assert.deepEqual(bad.rejected, [{ id: item.id, reason: 'Некоректне значення виправлення' }]);
  assert.equal(bad.udshv.records.length, wb.records.length);
  assert.equal(bad.corrections.length, 0);
});

test('own losses: a fixed outlier returns to the analysis, a skipped one stays out', () => {
  const dates = ['2026-06-10', '2026-06-11', '2026-09-12', '2026-06-12', '2026-06-13', '2026-06-14'];
  const table = own(dates);
  const review = reviewData({ ownLosses: table });
  const item = review.items[0];
  const fixed = applyReview({ ownLosses: table }, review, { [item.id]: { action: 'fix', value: '2026-06-12' } }).ownLosses;
  assert.equal(fixed.records.filter(r => r.suspect).length, 0);
  assert.equal(fixed.records.filter(r => r.date === '2026-06-12').length, 2);
  const skipped = applyReview({ ownLosses: table }, review, defaultDecisions(review.items)).ownLosses;
  assert.equal(skipped.records.filter(r => r.suspect).length, 1);
  assert.equal(table.records.filter(r => r.suspect).length, 1, 'вхідні дані не змінено');
});

test('strikes: a fixed date, count and result enter the analysis; the corrected table feeds the deck', () => {
  const t = strikes([{ date: '2026-09-01' }, { date: '2026-09-02', result: 'НЕ ВІДОМО' }, { date: 'xне дата', result: 'УРАЖЕНО' }, { date: '2026-09-04', count: 'багато' }]);
  const group = { id: 'ps', title: 'ПС', strikes: t };
  const review = reviewData({ groups: [group] });
  const by = kind => review.items.find(i => i.kind === kind);
  const res = applyReview({ groups: [group] }, review, {
    [by('invalid-date').id]: { action: 'fix', value: '2026-09-03' },
    [by('invalid-count').id]: { action: 'fix', value: '3' },
    [by('unknown-result').id]: { action: 'fix', value: 'partial' },
  });
  const fixed = res.groups[0].strikes;
  assert.equal(fixed.records.length, 4);
  assert.equal(fixed.undated.length, 0);
  assert.deepEqual(fixed.records.map(r => r.date), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
  assert.equal(fixed.records.find(r => r.date === '2026-09-04').count, 3);
  assert.equal(fixed.records.find(r => r.date === '2026-09-02').result, 'partial');
  assert.equal(t.undated.length, 1, 'вхідну таблицю не змінено');
  assert.equal(res.corrections.length, 3);
  assert.equal(reviewData({ groups: res.groups }).clean, true);
  const deck = buildDeck(udshv(), { groups: res.groups });
  assert.equal(deck.slides.find(s => s.id === 'group:ps').tiles.find(x => x.key === 'total').total, 4);
});

test('data problems are never put on the slides', () => {
  const t = strikes([{ date: '2026-09-01' }, { date: '2026-09-02', result: 'НЕ ВІДОМО' }, { date: 'xне дата' }]);
  const deck = buildDeck(udshv({ stray: true, gap: true, duplicate: true }), { ownLosses: own(['2026-06-10', '2026-09-12', '2026-06-12', '2026-06-13']), groups: [{ id: 'ps', title: 'ПС', strikes: t }] });
  const text = JSON.stringify(deck);
  assert.ok(!/Зауваження|Не враховано|Без жодного рядка|Результат не розпізнано|Якість даних/.test(text));
  assert.ok(!('quality' in deck.slides[0]));
});
