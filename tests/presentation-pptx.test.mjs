import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { buildDeck } from '../src/presentation-core.js';
import { THEMES, renderDeckToBytes } from '../src/presentation-pptx.js';

// Лише синтетичні дані.
const iso = n => new Date(Date.UTC(2026, 6, 1) + n * 864e5).toISOString().slice(0, 10);
const sheetOf = date => ({ '07': 'ЛИПЕНЬ-26', '08': 'СЕРПЕНЬ-26', '09': 'ВЕРЕСЕНЬ-26' }[date.slice(5, 7)]);
function workbook() {
  const units = ['Підрозділ А', 'Підрозділ Б'];
  const records = [];
  for (let n = 0; n <= 91; n++) {
    for (const unit of units) {
      const late = n > 84;
      records.push({ sheet: sheetOf(iso(n)), rowNumber: records.length + 5, date: iso(n), unit, values: unit === 'Підрозділ А'
        ? { 'personnel|200': late ? 4 : 2, 'personnel|300': 1, 'destroyed|танк': 1, 'damaged|БМП': 1, 'destroyed|Склади БК, ПММ': 2, 'ammo|155мм': late ? 50 : 20, 'ammo|ВСЬОГО': late ? 50 : 20, 'fire|ВгЗ': 2 }
        : { 'personnel|200': 1, 'ammo|122мм': 5, 'ammo|ВСЬОГО': 5 } });
    }
  }
  return { kind: 'udshv', readOnly: true, sourceName: 'synthetic.xlsx', sheetName: 'x', sheets: [], metrics: [], units, records, issues: [] };
}

async function open(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const texts = await Promise.all(slides.map(async n => [...(await zip.file(n).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join(' | ')));
  const charts = Object.keys(zip.files).filter(n => /^ppt\/charts\/chart\d+\.xml$/.test(n));
  return { zip, slides, texts, charts };
}

const deckOf = options => buildDeck(workbook(), { owner: 'Тестова група', generatedOn: '30.09.2026', groups: [{ id: 'a', title: 'Група А', units: ['Підрозділ А'] }], ...options });

for (const theme of Object.keys(THEMES)) {
  test(`${theme}: one slide per deck slide, native charts, no placeholders leaking`, async () => {
    const deck = deckOf();
    const { slides, texts, charts } = await open(await renderDeckToBytes(deck, { theme }));
    assert.equal(slides.length, deck.slides.length);
    assert.equal(slides.length, 5); // титул, 7, 30, весь період, група
    assert.equal(charts.length, (deck.slides.length - 1) * 2); // дві діаграми на слайд періоду
    assert.ok(texts[0].includes('Тестова група'));
    assert.ok(texts[0].includes('АНАЛІТИКА'));
    assert.ok(!/Підрозділи в аналізі|Джерела даних|Якість даних/.test(texts[0]), 'актуальність і якість на титул не виносяться');
    assert.ok(texts[1].includes('Останні 7 діб'));
    assert.ok(texts[4].includes('Група А · останні 30 діб'));
    for (const text of texts) assert.ok(!/undefined|NaN|\bnull\b/.test(text), text);
  });
}

test('light is the only theme and the default', () => {
  assert.deepEqual(Object.keys(THEMES), ['light']);
});

test('tile numbers and the three text blocks reach the slide', async () => {
  const deck = deckOf({ focus: 'efficiency' });
  const { texts } = await open(await renderDeckToBytes(deck));
  const week = deck.slides.find(s => s.id === 'week');
  for (const tile of week.tiles) { assert.ok(texts[1].includes(tile.name.replace(/&/g, '&amp;')), tile.name); }
  assert.ok(texts[1].includes(week.tiles[0].totalText.replace(/ /g, ' ')));
  for (const heading of ['Що змінилось', 'На що звернути увагу', 'Тенденція: тиждень до місяця']) assert.ok(texts[1].includes(heading), heading);
  assert.ok(texts[0].includes('Ефективність'));
});

test('an empty block gets a plain sentence instead of staying blank', async () => {
  const flat = workbook();
  for (const r of flat.records) r.values = { 'personnel|200': 1, 'ammo|122мм': 5, 'ammo|ВСЬОГО': 5 };
  const deck = buildDeck(flat, { owner: 'X' });
  const { texts } = await open(await renderDeckToBytes(deck));
  assert.ok(texts[1].includes('Суттєвих змін (від 20 %) не виявлено.'));
});

test('the reserved own-losses slide renders as a plain placeholder without a chart', async () => {
  const deck = deckOf({ reserveOwnLosses: true });
  const { slides, texts, charts } = await open(await renderDeckToBytes(deck));
  assert.equal(slides.length, 6);
  assert.equal(charts.length, (slides.length - 2) * 2); // титул і місце без діаграм
  const slot = texts[deck.slides.findIndex(s => s.id === 'own-losses')];
  assert.ok(slot.includes('Власні втрати') && slot.includes('Місце зарезервовано'));
});

test('custom period gives a title and one period slide', async () => {
  const deck = deckOf({ custom: { from: '2026-08-01', to: '2026-08-10' } });
  const { slides, texts } = await open(await renderDeckToBytes(deck));
  assert.equal(slides.length, 2);
  assert.ok(texts[1].includes('Обраний період'));
});

test('the output is deterministic apart from the zip container timestamps', async () => {
  const deck = deckOf();
  const a = await open(await renderDeckToBytes(deck)), b = await open(await renderDeckToBytes(deck));
  assert.deepEqual(a.texts, b.texts);
});

test('кожен слайд має перехід; transition: none його вимикає', async () => {
  const { default: JSZip } = await import('jszip');
  const wb = { kind: 'udshv', sourceName: 's', sheetName: 'X', sheets: [], metrics: [], units: ['А'], issues: [], records: [{ sheet: 'X', rowNumber: 5, date: '2026-09-20', unit: 'А', values: { 'personnel|200': 1 } }] };
  const deck = buildDeck(wb, {});
  for (const [transition, expected] of [[undefined, true], ['none', false]]) {
    const zip = await JSZip.loadAsync(await renderDeckToBytes(deck, { transition }));
    const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    assert.ok(slides.length > 1);
    for (const name of slides) assert.equal((await zip.file(name).async('string')).includes('<p:transition spd="med"><p:fade/></p:transition>'), expected);
  }
});
