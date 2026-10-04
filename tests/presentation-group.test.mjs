import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import JSZip from 'jszip';
import { buildGroupDeck, groupPeriods, GROUP_PROFILES } from '../src/presentation-group.js';
import { composeModuleDeck, presentationFileName, reviewForModule } from '../src/presentation-flow.js';
import { openModulePresentation } from '../src/group-presentation.js';
import { parseStrikes, strikeStats } from '../src/strikes-core.js';
import { renderDeckToBytes, renderDeckToPdfBytes } from '../src/presentation-pptx.js';

// Лише синтетичні дані тієї самої структури, що й таблиці ПС і РВіА («Зведена», контракт із 15 полів).
const AIR_HEAD = { A: '№', B: 'Дата', C: 'Час ураження', D: '№ цілі (TS/KS)', E: 'В інтересах', F: 'Район / н.п.', G: 'DPI / Координати MGRS', H: 'Тип цілі', I: 'Місяць', J: 'Тип ЛА', K: 'Тип боєприпасу', L: 'К-сть боєприпасів', M: 'Результат ураження', N: 'Причина', O: 'Уточнення результату' };
const ROCKET_HEAD = { ...AIR_HEAD, J: 'Тип ПУ' };
const serial = iso => String(Date.parse(`${iso}T00:00:00Z`) / 864e5 + 25569);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

function sheets(head, events) {
  const rows = [{ r: 1, cells: head }];
  events.forEach((e, i) => rows.push({ r: 2 + i, cells: {
    A: String(i + 1), B: e.rawDate ?? serial(e.date), E: e.unit ?? '80 ОДШБр', G: 'СЕКРЕТНІ КООРДИНАТИ', F: 'СЕКРЕТНИЙ РАЙОН', D: 'TS0001', O: 'СЕКРЕТНЕ УТОЧНЕННЯ',
    H: 'ПУ БПЛА', J: e.weapon ?? 'МіГ-29', K: 'GBU-39', L: e.count ?? '2', M: e.result ?? 'УРАЖЕНО', N: e.reason ?? '',
  } }));
  return [{ name: 'Зведена', rows }];
}

// 60 діб 2026-07-22 .. 2026-09-19: щодня одне «УРАЖЕНО»; у другій половині ще по одному («НЕ УРАЖЕНО» або «ЧАСТКОВО»).
function events() {
  const list = [];
  for (let n = 0; n < 60; n++) {
    const date = addDays('2026-07-22', n);
    list.push({ date, result: 'УРАЖЕНО' });
    if (n >= 30) list.push({ date, result: n % 3 === 0 ? 'НЕ УРАЖЕНО' : 'ЧАСТКОВО УРАЖЕНО', reason: n % 3 === 0 ? 'РЕБ' : '', count: '4' });
  }
  return list;
}
const airTable = () => parseStrikes(sheets(AIR_HEAD, events()), 'air.xlsx');
const settings = { group: 'ps', owner: 'Тестовий підрозділ', titleText: 'Тестова аналітика', generatedOn: '04.10.2026' };
const slideById = (deck, id) => deck.slides.find(s => s.id === id);
const tile = (slide, key) => slide.tiles.find(t => t.key === key);

test('колода модуля: титул, 7 діб, 30 діб і весь період за таблицею модуля', () => {
  const deck = buildGroupDeck(airTable(), settings);
  assert.equal(deck.kind, 'group_deck');
  assert.deepEqual(deck.slides.map(s => s.id), ['title', 'week', 'month', 'all']);
  const [title, week, month, all] = deck.slides;
  assert.equal(title.theme, 'ps');
  assert.equal(title.titleText, 'Тестова аналітика');
  assert.equal(title.owner, 'Тестовий підрозділ');
  assert.equal(title.dataRange.text, '22.07.2026 – 19.09.2026');
  assert.equal(week.heading, 'Аналітика ПС · 7 діб');
  assert.equal(month.heading, 'Аналітика ПС · 30 діб');
  assert.equal(all.heading, 'Аналітика ПС · весь період');
  // Якір — остання дата самої таблиці.
  assert.equal(week.period.text, '13.09.2026 – 19.09.2026');
  assert.equal(month.period.text, '21.08.2026 – 19.09.2026');
  assert.equal(all.period.text, '22.07.2026 – 19.09.2026');
  assert.ok([week, month, all].every(s => s.theme === 'ps' && s.ownCallout === null && s.scope.source === 'strikes_table'));
});

test('числа слайдів збігаються з підсумками таблиці за той самий період', () => {
  const strikes = airTable();
  const deck = buildGroupDeck(strikes, settings);
  const within = (from, to) => strikes.records.filter(r => r.date >= from && r.date <= to);
  const month = slideById(deck, 'month');
  const now = strikeStats(within('2026-08-21', '2026-09-19'));
  assert.equal(tile(month, 'total').total, now.total);
  assert.equal(tile(month, 'total').total, 60);
  assert.equal(tile(month, 'hit').total, now.hit);
  assert.equal(tile(month, 'partial').total, now.partial);
  assert.equal(tile(month, 'miss').total, now.miss);
  assert.equal(tile(month, 'munitions').total, now.munitions);
  assert.equal(tile(month, 'effect').total, now.overall);
  const before = strikeStats(within('2026-07-22', '2026-08-20'));
  assert.equal(tile(month, 'total').previous, before.total);
  assert.equal(month.previous.text, '22.07.2026 – 20.08.2026');
  assert.equal(month.previous.complete, true);
  const all = slideById(deck, 'all');
  assert.equal(tile(all, 'total').total, 90);
  assert.equal(tile(all, 'total').total, strikeStats(strikes.records).total);
});

test('весь період порівнюється з власними половинами, а не з відрізком до таблиці', () => {
  const all = slideById(buildGroupDeck(airTable(), settings), 'all');
  assert.equal(all.previous, null);
  assert.ok(all.tiles.every(t => t.deltaText === ''), 'на плитках немає порівняння');
  assert.ok(all.changes.some(c => c.text === 'Завдань (записів): 60 у другій половині проти 30 у першій (+100 %).'), JSON.stringify(all.changes));
  assert.deepEqual(all.notes, ['Порівняння половин періоду: 22.07.2026 – 20.08.2026 і 21.08.2026 – 19.09.2026.']);
  assert.ok(all.charts[0].bucket === 'week');
});

test('обраний період: один слайд, межі задані навпаки впорядковуються, попередній відрізок тієї ж довжини', () => {
  const deck = buildGroupDeck(airTable(), { ...settings, custom: { from: '2026-09-10', to: '2026-09-01' } });
  assert.deepEqual(deck.slides.map(s => s.id), ['title', 'custom']);
  const custom = deck.slides[1];
  assert.equal(custom.heading, 'Аналітика ПС · обраний період');
  assert.equal(custom.period.text, '01.09.2026 – 10.09.2026');
  assert.equal(custom.previous.text, '22.08.2026 – 31.08.2026');
  assert.equal(tile(custom, 'total').total, 20);
  const outside = buildGroupDeck(airTable(), { ...settings, custom: { from: '2027-01-01', to: '2027-01-31' } }).slides[1];
  assert.ok(outside.attention.some(a => a.text === 'За обраний період у таблиці ПС немає жодного завдання.'), JSON.stringify(outside.attention));
});

test('таблиця без жодного запису з датою дає титул і повідомлення, а не порожні слайди', () => {
  const empty = parseStrikes(sheets(AIR_HEAD, [{ rawDate: 'не дата' }]));
  const deck = buildGroupDeck(empty, settings);
  assert.deepEqual(deck.slides.map(s => s.id), ['title', 'all']);
  assert.equal(deck.slides[1].status, 'no_source');
  assert.match(deck.slides[1].message, /немає жодного запису/);
});

test('РВіА: власна тема, титул за замовчуванням і слайди за «Тип ПУ»', () => {
  const strikes = parseStrikes(sheets(ROCKET_HEAD, events().map(e => ({ ...e, weapon: 'М142' }))), 'rocket.xlsx');
  const deck = buildGroupDeck(strikes, { group: 'rvia' });
  assert.equal(deck.slides[0].theme, 'rvia');
  assert.equal(deck.slides[0].titleText, GROUP_PROFILES.rvia.defaultTitle);
  assert.equal(deck.slides[1].heading, 'Аналітика РВіА · 7 діб');
  assert.match(deck.slides[1].strip, /ПУ: М142/);
  assert.deepEqual(groupPeriods(GROUP_PROFILES.rvia, strikes).map(p => p.id), ['week', 'month', 'all']);
});

test('координати, райони й уточнення не потрапляють у модель, однакові дані дають однакову колоду', () => {
  const deck = buildGroupDeck(airTable(), settings);
  assert.ok(!JSON.stringify(deck).includes('СЕКРЕТН'));
  assert.deepEqual(buildGroupDeck(airTable(), settings), deck);
});

test('меню перевірки: виправлення застосовується до копії, таблиця модуля не змінюється', () => {
  const list = events().slice(0, 40);
  list.push({ rawDate: 'не дата', result: 'УРАЖЕНО' });
  const strikes = parseStrikes(sheets(AIR_HEAD, list), 'air.xlsx');
  assert.equal(strikes.undated.length, 1);
  const review = reviewForModule(strikes, 'ps');
  const item = review.items.find(i => i.kind === 'invalid-date');
  assert.ok(item, JSON.stringify(review.items));
  const skipped = composeModuleDeck(strikes, 'ps', settings);
  const fixed = composeModuleDeck(strikes, 'ps', { ...settings, decisions: { [item.id]: { action: 'fix', value: '2026-08-05' } } });
  assert.equal(tile(slideById(fixed.deck, 'all'), 'total').total, tile(slideById(skipped.deck, 'all'), 'total').total + 1);
  assert.equal(fixed.corrections.length, 1);
  assert.equal(strikes.records.length, 40);
  assert.equal(strikes.undated.length, 1, 'вхідна таблиця не змінилась');
});

test('назва файлу: власник, а без нього — позначка модуля', () => {
  assert.equal(presentationFileName('', '04.10.2026', 'pptx', 'ПС'), 'Аналітика ПС 04.10.2026.pptx');
  assert.equal(presentationFileName('Підрозділ: А/Б', '04.10.2026', 'pdf', 'РВіА'), 'Аналітика Підрозділ А Б 04.10.2026.pdf');
  assert.equal(presentationFileName('', '04.10.2026'), 'Аналітика УДШВ 04.10.2026.pptx', 'для УДШВ усе як і раніше');
});

const text = async (zip, name) => [...(await zip.file(name).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(' | ');

test('PPTX модуля: титул у кольорі роду військ, підпис без порожнього фокусу, діаграми рідні', async () => {
  const deck = buildGroupDeck(airTable(), settings);
  const zip = await JSZip.loadAsync(await renderDeckToBytes(deck));
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slides.length, 4);
  const first = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.ok(first.includes('293657'), 'фон титулу ПС');
  assert.ok((await text(zip, 'ppt/slides/slide1.xml')).includes('Тестова аналітика | Тестовий підрозділ'));
  const second = await text(zip, 'ppt/slides/slide2.xml');
  assert.ok(second.includes('Аналітика ПС · 7 діб'));
  assert.ok(second.includes('Тестовий підрозділ') && !/Тестовий підрозділ · /.test(second), second);
  assert.ok(!/undefined|NaN|\bnull\b/.test(second));
  assert.equal(Object.keys(zip.files).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n)).length, 6);
  const rvia = parseStrikes(sheets(ROCKET_HEAD, events().map(e => ({ ...e, weapon: 'М142' }))), 'r.xlsx');
  const rzip = await JSZip.loadAsync(await renderDeckToBytes(buildGroupDeck(rvia, { group: 'rvia' })));
  assert.ok((await rzip.file('ppt/slides/slide1.xml').async('string')).includes('6A6539'), 'фон титулу РВіА');
});

test('деку УДШВ титул і підпис не змінились: ДШВ, фокус лишається в підписі', async () => {
  const { buildDeck } = await import('../src/presentation-core.js');
  const records = [];
  for (let n = 0; n < 40; n++) records.push({ sheet: 'С', rowNumber: n + 5, date: addDays('2026-08-01', n), unit: 'А', values: { 'personnel|200': 1 } });
  const deck = buildDeck({ kind: 'udshv', sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], units: ['А'], records, issues: [] }, { owner: 'Власник' });
  const zip = await JSZip.loadAsync(await renderDeckToBytes(deck));
  assert.ok((await zip.file('ppt/slides/slide1.xml').async('string')).includes('7A1F2B'));
  assert.ok((await text(zip, 'ppt/slides/slide2.xml')).includes('Власник · Результат і ефективність'));
});

test('PDF модуля: сторінка на слайд, шрифт вбудований', async () => {
  const dir = new URL('../src/presentation-art/fonts/', import.meta.url);
  const fonts = { regular: readFileSync(new URL('LiberationSans-Regular.ttf', dir)), bold: readFileSync(new URL('LiberationSans-Bold.ttf', dir)), italic: readFileSync(new URL('LiberationSans-Italic.ttf', dir)) };
  const deck = buildGroupDeck(airTable(), settings);
  const bytes = await renderDeckToPdfBytes(deck, { fonts });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const { PDFDocument } = await import('pdf-lib');
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), deck.slides.length);
});

test('кнопка модуля: зрозумілі повідомлення, а не винятки, коли презентацію зробити не з чого', async () => {
  const say = [];
  const toast = message => say.push(message);
  const readSheets = async () => sheets(AIR_HEAD, [{ rawDate: 'не дата' }]);
  await openModulePresentation({ group: 'ps', bytes: null, readSheets, toast });
  await openModulePresentation({ group: 'ps', bytes: new Uint8Array([1]), name: 'a.xlsx', readSheets, toast });
  await openModulePresentation({ group: 'ps', bytes: new Uint8Array([1]), name: 'b.xlsx', readSheets: async () => [{ name: 'Інше', rows: [{ r: 1, cells: { A: 'Дата' } }] }], toast });
  await openModulePresentation({ group: 'ps', bytes: new Uint8Array([1]), name: 'c.xlsx', readSheets: async () => { throw new Error('файл пошкоджено'); }, toast });
  assert.deepEqual(say, [
    'Спочатку відкрийте таблицю.',
    'У таблиці немає жодного запису з розпізнаною датою: презентація була б порожньою.',
    'Це не таблиця ударів: потрібен аркуш із шапкою «Дата» і «Результат ураження».',
    'Не вдалося підготувати презентацію: файл пошкоджено',
  ]);
});
