import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HYPOTHESES,
  activeRange,
  buildDeck,
  classificationOf,
  classifyTarget,
  daysWord,
  deckPeriods,
  findPeak,
  formatNumber,
  formatPercent,
  rollingRange,
} from '../src/presentation-core.js';

// Лише синтетичні дані. Книга збирається напряму в тій формі, яку повертає parseUdshvWorkbook.
const iso = n => new Date(Date.UTC(2026, 6, 1) + n * 864e5).toISOString().slice(0, 10); // 0 = 2026-07-01
const LAST = 91; // 2026-09-30
const sheetOf = date => ({ '07': 'ЛИПЕНЬ-26', '08': 'СЕРПЕНЬ-26', '09': 'ВЕРЕСЕНЬ-26', '10': 'ЖОВТЕНЬ-26' }[date.slice(5, 7)]);

function makeWorkbook(valuesFor, { from = 0, to = LAST, skip = () => false, units = ['Підрозділ А', 'Підрозділ Б'] } = {}) {
  const records = [];
  for (let n = from; n <= to; n++) {
    if (skip(n)) continue;
    for (const unit of units) records.push({ sheet: sheetOf(iso(n)), rowNumber: records.length + 5, date: iso(n), unit, values: valuesFor(n, unit) });
  }
  return { kind: 'udshv', readOnly: true, sourceName: 'synthetic.xlsx', sheetName: 'ЛИПЕНЬ-26', sheets: [], metrics: [], units, records, issues: [] };
}

const flat = (n, unit) => (unit === 'Підрозділ А' ? { 'personnel|200': 2, 'personnel|300': 1, 'destroyed|танк': 1, 'damaged|танк': 1, 'ammo|155мм': 10, 'ammo|ВСЬОГО': 10, 'fire|ВгЗ': 2 } : { 'personnel|200': 1, 'ammo|122мм': 4, 'ammo|ВСЬОГО': 4 });

test('rolling ranges include the anchor day and deck periods follow the last active date', () => {
  assert.deepEqual(rollingRange('2026-09-30', 7), { from: '2026-09-24', to: '2026-09-30' });
  assert.deepEqual(rollingRange('2026-09-30', 30), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(rollingRange('', 7), { from: '', to: '' });
  const wb = makeWorkbook(flat);
  const periods = deckPeriods(wb);
  assert.deepEqual(periods.map(p => p.id), ['week', 'month', 'all']);
  assert.deepEqual(periods[0].range, { from: '2026-09-24', to: '2026-09-30' });
  assert.deepEqual(periods[2].range, { from: '2026-07-01', to: '2026-09-30' });
  const custom = deckPeriods(wb, { custom: { from: '2026-08-10', to: '2026-08-01' } });
  assert.deepEqual(custom.map(p => p.id), ['custom']);
  assert.deepEqual(custom[0].range, { from: '2026-08-01', to: '2026-08-10' });
});

test('standard deck has title, week, month and whole period in order', () => {
  const deck = buildDeck(makeWorkbook(flat), { owner: 'Тестове угруповання', generatedOn: '2026-10-01' });
  assert.deepEqual(deck.slides.map(s => s.id), ['title', 'week', 'month', 'all']);
  const [title, week] = deck.slides;
  assert.equal(title.owner, 'Тестове угруповання');
  assert.equal(title.dataRange.text, '01.07.2026 – 30.09.2026');
  assert.equal(title.generatedOn, '2026-10-01');
  assert.equal(week.period.days, 7);
  assert.equal(week.tiles.length, 6);
  assert.equal(week.chart.categories.length, 7);
  assert.equal(week.chart.series[0].values.length, 7);
});

test('deck numbers match the dashboard model for the same period', () => {
  const deck = buildDeck(makeWorkbook(flat));
  const week = deck.slides.find(s => s.id === 'week');
  const tile = key => week.tiles.find(t => t.key === key);
  assert.equal(tile('kia').total, 7 * (2 + 1)); // обидва підрозділи
  assert.equal(tile('wia').total, 7 * 1);
  assert.equal(tile('ammo').total, 7 * 14);
  assert.equal(tile('ovtDestroyed').total, 7 * 1);
  assert.equal(tile('ovtDamaged').total, 7 * 1);
  assert.equal(tile('objDestroyed').total, 0);
  const all = deck.slides.find(s => s.id === 'all');
  assert.equal(all.tiles.find(t => t.key === 'kia').total, 92 * 3);
});

test('reports a change with both numbers and a hypothesis line', () => {
  const wb = makeWorkbook((n, unit) => {
    const values = flat(n, unit);
    if (n > LAST - 7 && unit === 'Підрозділ А') values['personnel|200'] = 4; // 7 діб: +2 на добу
    return values;
  });
  const week = buildDeck(wb).slides.find(s => s.id === 'week');
  // 7 діб: (4+1)*7 = 35, попередні: (2+1)*7 = 21, +66,7 %
  const line = week.changes.find(c => c.text.startsWith('Знищено о/с (200)'));
  assert.ok(line, JSON.stringify(week.changes));
  assert.equal(line.text, 'Знищено о/с (200): 35 проти 21 (+66,7 %).');
  assert.ok(week.hypotheses.length >= 1);
  assert.ok(week.hypotheses.every(h => !('flag' in h) && !/гіпотез/i.test(h.text)));
  assert.ok(week.hypotheses[0].text.startsWith('Знищено о/с (200): '));
  const tile = week.tiles.find(t => t.key === 'kia');
  assert.equal(tile.deltaText, '+66,7 %');
});

test('stable data gives no change lines', () => {
  const week = buildDeck(makeWorkbook(flat)).slides.find(s => s.id === 'week');
  assert.deepEqual(week.changes, []);
});

test('small base suppresses percentages and says so', () => {
  const wb = makeWorkbook((n, unit) => {
    if (unit !== 'Підрозділ А') return {};
    if (n > LAST - 7) return { 'personnel|200': n === LAST ? 6 : 0 };
    if (n > LAST - 14) return { 'personnel|200': n === LAST - 7 ? 2 : 0 };
    return {};
  }, { units: ['Підрозділ А'] });
  const week = buildDeck(wb).slides.find(s => s.id === 'week');
  const tile = week.tiles.find(t => t.key === 'kia');
  assert.equal(tile.previous, 2);
  assert.equal(tile.deltaPercent, null);
  assert.equal(tile.reliable, false);
  assert.match(tile.deltaText, /мала база/);
  assert.ok(!week.changes.some(c => c.text.includes('%')));
  assert.ok(week.attention.some(a => /Мала база/.test(a.text) && a.text.includes('Знищено о/с (200)')));
});

test('incomplete previous window is reported instead of compared', () => {
  const wb = makeWorkbook(flat, { from: 3 }); // дані від 04.07
  const deck = buildDeck(wb, { custom: { from: '2026-07-04', to: '2026-07-10' } });
  const custom = deck.slides.find(s => s.id === 'custom');
  assert.equal(custom.previous.complete, false);
  assert.equal(custom.previous.covered, 0 + 0);
  assert.ok(custom.attention.some(a => /Попередній відрізок/.test(a.text)));
  assert.equal(custom.tiles[0].deltaPercent, null);
  assert.ok(custom.hypotheses.some(h => /неповне/.test(h.text)));
  assert.deepEqual(deck.slides.map(s => s.id), ['title', 'custom']);
});

test('custom period narrower than the data reports its own coverage', () => {
  const deck = buildDeck(makeWorkbook(flat, { to: 40 }), { custom: { from: '2026-08-05', to: '2026-08-20' } });
  const custom = deck.slides.find(s => s.id === 'custom');
  assert.equal(custom.period.days, 16);
  assert.equal(custom.previous.complete, true);
  const beyond = buildDeck(makeWorkbook(flat, { to: 40 }), { custom: { from: '2026-08-05', to: '2026-09-10' } }).slides[1];
  assert.ok(beyond.notes.some(n => /охоплюють \d+ із \d+ діб/.test(n)));
});

test('finds a daily peak above the IQR fence and ignores flat series', () => {
  const flatPoints = Array.from({ length: 10 }, (_, i) => ({ from: iso(i), value: 10 }));
  assert.equal(findPeak(flatPoints), null);
  const withPeak = flatPoints.map((p, i) => (i === 4 ? { ...p, value: 80 } : p));
  assert.deepEqual(findPeak(withPeak), { date: iso(4), value: 80, fence: 10 });
  assert.equal(findPeak(withPeak.slice(0, 5)), null); // мало днів
  assert.equal(findPeak(flatPoints.map((p, i) => (i === 4 ? { ...p, value: 8 } : p))), null); // нижче minBase
});

test('peak appears in attention with the date and the typical ceiling', () => {
  const wb = makeWorkbook((n, unit) => {
    const values = flat(n, unit);
    if (n === LAST - 3 && unit === 'Підрозділ А') { values['ammo|155мм'] = 200; values['ammo|ВСЬОГО'] = 200; }
    return values;
  });
  const week = buildDeck(wb).slides.find(s => s.id === 'week');
  const peak = week.attention.find(a => a.text.startsWith('Витрата БК: пік 27.09.2026'));
  assert.ok(peak, JSON.stringify(week.attention));
  assert.match(peak.text, /— 204 при типовому не більше 14\./);
});

test('unit concentration and silent days are reported with numbers', () => {
  const wb = makeWorkbook((n, unit) => (unit === 'Підрозділ А' ? { 'ammo|155мм': 30, 'ammo|ВСЬОГО': 30, 'personnel|200': 2 } : { 'ammo|122мм': 10, 'ammo|ВСЬОГО': 10, 'personnel|200': 2 }), { skip: n => n === LAST - 2 });
  const week = buildDeck(wb).slides.find(s => s.id === 'week');
  assert.ok(week.attention.some(a => a.text === 'Витрата БК: Підрозділ А дає 75 % (180 з 240).'), JSON.stringify(week.attention));
  assert.ok(week.attention.some(a => /1 із 7 діб без жодного ненульового показника/.test(a.text)));
  assert.ok(week.attention.some(a => /Без жодного рядка в таблиці: 1 доба/.test(a.text)));
});

test('whole-period slide compares the recent pace with the overall pace', () => {
  const wb = makeWorkbook((n, unit) => (unit === 'Підрозділ А' ? { 'personnel|200': n > LAST - 30 ? 4 : 1 } : {}), { units: ['Підрозділ А'] });
  const all = buildDeck(wb).slides.find(s => s.id === 'all');
  assert.equal(all.previous, null);
  const line = all.changes.find(c => c.text.startsWith('Знищено о/с (200)'));
  assert.ok(line, JSON.stringify(all.changes));
  // 30*4 + 62*1 = 182 за 92 доби = 1,98/добу; останні 30: 4/добу → +102 %
  assert.equal(line.text, 'Знищено о/с (200): 4 на добу за останні 30 діб проти 2 за весь період (+102 %).');
});

test('short history skips the pace comparison', () => {
  const all = buildDeck(makeWorkbook(flat, { from: 60 })).slides.find(s => s.id === 'all');
  assert.deepEqual(all.changes, []);
});

test('the deck is deterministic and contains no raw record fields', () => {
  const wb = makeWorkbook(flat);
  const a = JSON.stringify(buildDeck(wb, { owner: 'X', generatedOn: '2026-10-01' }));
  const b = JSON.stringify(buildDeck(wb, { owner: 'X', generatedOn: '2026-10-01' }));
  assert.equal(a, b);
  assert.ok(!a.includes('rowNumber'));
  assert.ok(!a.includes('ЛИПЕНЬ-26'));
});

test('every slide block is non-empty text and the hypothesis catalog is well formed', () => {
  const deck = buildDeck(makeWorkbook(flat));
  for (const slide of deck.slides.slice(1)) {
    for (const item of [...slide.changes, ...slide.attention, ...slide.hypotheses]) assert.ok(item.text.trim().length > 0);
    assert.ok(slide.changes.length <= 3 && slide.attention.length <= 3 && slide.hypotheses.length <= 3);
  }
  for (const h of HYPOTHESES) assert.ok(h.signal && h.direction && h.domain && h.text);
});

test('splits equipment (ОВТ) from objects using the configurable name patterns', () => {
  assert.equal(classifyTarget('танк'), 'equipment');
  assert.equal(classifyTarget('РЕБ'), 'equipment');
  assert.equal(classifyTarget('Склади БК, ПММ'), 'object');
  assert.equal(classifyTarget('Переправа'), 'object');
  assert.equal(classifyTarget('будівля (ІФС)'), 'object');
  assert.equal(classifyTarget('ПУ БпЛА'), 'object');
  assert.equal(classifyTarget('152 мм 2С19'), 'equipment');
  assert.equal(classifyTarget('КП, ПУ, КСП'), 'object');
  assert.equal(classifyTarget('танк', { objectPatterns: ['^танк$'] }), 'object');
  const wb = makeWorkbook((n, unit) => (unit === 'Підрозділ А' ? { 'destroyed|танк': 2, 'destroyed|Склади БК, ПММ': 5, 'damaged|РЕБ': 1, 'damaged|Переправа': 3, 'suppressed|КП, ПУ, КСП': 4 } : {}), { units: ['Підрозділ А'] });
  assert.deepEqual(classificationOf(wb), { equipment: ['РЕБ', 'танк'], objects: ['КП, ПУ, КСП', 'Переправа', 'Склади БК, ПММ'] });
  const week = buildDeck(wb).slides.find(s => s.id === 'week');
  const tile = key => week.tiles.find(t => t.key === key).total;
  assert.equal(tile('ovtDestroyed'), 14);
  assert.equal(tile('ovtDamaged'), 7);
  assert.equal(tile('objDestroyed'), 35);
  assert.equal(week.chart.series[1].values.every(v => v === 2 + 1), true); // техніка: 2 + 1 на добу
  assert.equal(week.chart.series[2].values.every(v => v === 5 + 3), true); // об'єкти: 5 + 3 на добу
  assert.ok(!week.tiles.some(t => ['destroyed', 'damaged'].includes(t.key)));
});

test('equipment changes never include objects', () => {
  const wb = makeWorkbook((n, unit) => {
    if (unit !== 'Підрозділ А') return {};
    return { 'destroyed|танк': 2, 'destroyed|Склади БК, ПММ': n > LAST - 7 ? 10 : 2 };
  }, { units: ['Підрозділ А'] });
  const week = buildDeck(wb).slides.find(s => s.id === 'week');
  assert.ok(!week.changes.some(c => c.text.startsWith('ОВТ знищено')), JSON.stringify(week.changes));
  assert.ok(week.changes.some(c => c.text === 'Об’єкти знищено: 70 проти 14 (+400 %).'), JSON.stringify(week.changes));
});

test('whole period ignores pre-filled zero days and rows dated outside the sheet month', () => {
  const wb = makeWorkbook(flat, { from: 10, to: LAST });
  wb.records.push({ sheet: 'ВЕРЕСЕНЬ-26', rowNumber: 900, date: '2026-07-01', unit: 'Підрозділ А', values: { 'personnel|200': 9 } });
  for (let n = LAST + 1; n <= LAST + 10; n++) wb.records.push({ sheet: sheetOf(iso(n)), rowNumber: 950 + n, date: iso(n), unit: 'Підрозділ А', values: {} });
  assert.deepEqual(activeRange(wb), { from: iso(10), to: '2026-09-30' });
  const all = buildDeck(wb).slides.find(s => s.id === 'all');
  assert.equal(all.period.to, '2026-09-30');
  assert.equal(all.tiles.find(t => t.key === 'kia').total, (LAST - 10 + 1) * 3);
  assert.ok(all.tiles.every(t => t.previous == null && t.deltaText === ''));
});

test('plural forms of days', () => {
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25].map(daysWord), ['доба', 'доби', 'діб', 'діб', 'діб', 'доба', 'доби', 'діб']);
});

test('number formatting follows Ukrainian conventions', () => {
  assert.equal(formatNumber(1234), '1 234');
  assert.equal(formatNumber(12.34), '12,3');
  assert.equal(formatPercent(35), '+35 %');
  assert.equal(formatPercent(-12.5), '−12,5 %');
  assert.equal(formatPercent(null), '—');
});
