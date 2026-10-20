import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateCatalog } from '../src/catalog-core.js';
import { PS_CATALOG } from '../src/catalogs/ps-builtin.js';
import {
  CATALOG,
  COMPARE_LABEL,
  KPI_TILES,
  RESULT_BY_KIND,
  SERIES_BY_TILE,
  VIEW_BY_BLOCK,
  buildCards,
  toRecord,
} from '../src/ps-kpi.js';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const AIR = await read('src/air.html');
const IMPORT_DOC = await read('docs/XLSX_IMPORT.md');

/* ------------------------------------------------------------------ */
/*  Каталог                                                            */
/* ------------------------------------------------------------------ */

test('вбудований каталог ПС валідний, у шарі builtin, плитки в порядку карток', () => {
  const result = validateCatalog(PS_CATALOG);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(CATALOG.layer, 'builtin');
  assert.deepEqual(KPI_TILES, ['tile.ps-sorties', 'tile.ps-munitions', 'tile.ps-hit', 'tile.ps-partial', 'tile.ps-miss', 'tile.ps-unknown']);
  assert.deepEqual(CATALOG.tiles.map((tile) => tile.id), KPI_TILES);
  assert.deepEqual(CATALOG.tiles.filter((tile) => tile.hideWhenZero).map((tile) => tile.id), ['tile.ps-unknown'], 'ховається лише «Не відомо»');
});

test('заголовки стовпців каталогу — ті, що читає імпорт таблиці', () => {
  const headers = [...IMPORT_DOC.matchAll(/^\d+\. `([^`]+)`$/gm)].map((match) => match[1]);
  assert.equal(headers.length, 15);
  const imported = CATALOG.columns.filter((column) => column.id !== 'col.abort');
  for (const column of imported) {
    assert.ok(headers.includes(column.labels[0]), `«${column.labels[0]}» немає серед заголовків імпорту`);
  }
  assert.equal(CATALOG.columns.find((column) => column.id === 'col.abort').labels[0], 'Відбій', 'відбій виводиться з тексту, окремого заголовка немає');
});

test('кнопки «Докладніше» ведуть у блоки каталогу, а блоки — у розділи сторінки', () => {
  const blocks = new Map(CATALOG.blocks.map((block) => [block.id, block]));
  for (const tile of CATALOG.tiles) assert.ok(blocks.has(tile.opens), `${tile.id} → ${tile.opens}`);
  assert.deepEqual(Object.keys(VIEW_BY_BLOCK).sort(), [...new Set(CATALOG.tiles.map((tile) => tile.opens))].sort());
  assert.deepEqual(Object.keys(SERIES_BY_TILE), KPI_TILES);
});

test('результати: список каталогу, ознаки парсера й KLABEL сторінки збігаються', () => {
  const list = CATALOG.lists.find((item) => item.id === 'list.ps-result');
  assert.deepEqual(Object.values(RESULT_BY_KIND).sort(), list.values.map((entry) => entry.value).sort());
  const klabel = AIR.match(/const KLABEL = (\{[^}]*\});/)?.[1];
  assert.ok(klabel, 'у air.html має бути KLABEL');
  assert.deepEqual(Function(`return ${klabel}`)(), RESULT_BY_KIND);
});

test('toRecord: рядок парсера → запис за id стовпців', () => {
  assert.deepEqual(toRecord({ date: '2026-08-01', munition: 'GBU-39', count: 2, kind: 'hit', abort: false }), {
    'col.date': '2026-08-01', 'col.munition': 'GBU-39', 'col.munition-count': 2, 'col.result': 'Уражено', 'col.abort': false,
  });
  assert.deepEqual(toRecord({ date: '', munition: '', count: 0, kind: 'unk', abort: true }), {
    'col.date': '', 'col.munition': '', 'col.munition-count': 0, 'col.result': 'Не відомо', 'col.abort': true,
  });
});

/* ------------------------------------------------------------------ */
/*  Еталон: код карток із air.html до виносу в каталог                 */
/* ------------------------------------------------------------------ */
// Нижче — дослівні копії функцій і виразів сторінки (agg, mkDelta, kpiSeries-незалежна частина render).
// Картки з каталогу мусять збігатися з ними до символа.

const plural = (n, f) => { const a = n % 100, b = n % 10; if (a > 10 && a < 20) return f[2]; if (b === 1) return f[0]; if (b >= 2 && b <= 4) return f[1]; return f[2]; };
const N0 = (n) => Math.round(n).toLocaleString('uk-UA');
const N1 = (n) => n.toLocaleString('uk-UA', { maximumFractionDigits: 1 });
const dayNum = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const MON3 = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
const CC = { blue: '#4aa8ff', amber: '#f2b544', green: '#33d17a', orange: '#f59a3b', red: '#f05a5a', grey: '#a3aec2' };

function inc(map, key, by) { map.set(key, (map.get(key) || 0) + by); }
function agg(rows) {
  const A = { n: rows.length, abort: 0, mun: 0, applied: 0, hit: 0, part: 0, miss: 0, unk: 0, byPlat: new Map(), byMun: new Map(), byUnit: new Map(), byType: new Map(), rows };
  for (const r of rows) {
    A[r.kind]++; if (r.abort) A.abort++; A.mun += r.count; if (r.count > 0) A.applied++;
    inc(A.byPlat, r.aircraft || 'Не вказано', 1);
    if (r.munition) inc(A.byMun, r.munition, r.count);
  }
  return A;
}
const sorted = (map, minV) => [...map.entries()].filter((e) => e[1] > (minV || 0)).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'uk'));
function mkDelta(r, mode) {
  if (r == null) return null; const dir = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
  const cls = dir === 'flat' || mode === 'neutral' ? 'flat' : mode === 'warn' ? 'warn' : ((mode === 'up') === (dir === 'up')) ? 'good' : 'bad';
  return { dir, cls, txt: (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r) + '%' };
}

/** Що сторінка рахує навколо карток: період, попередній період, друга половина проти першої. */
function pageContext(ROWS, from, to, DMIN) {
  const inRange = (r) => r.date && r.date >= from && r.date <= to;
  const cur = ROWS.filter(inRange);
  const len = dayNum(to) - dayNum(from) + 1, pf = isoOf(dayNum(from) - len), pt = isoOf(dayNum(from) - 1);
  const prevRows = dayNum(pt) >= dayNum(DMIN) ? ROWS.filter((r) => r.date && r.date >= pf && r.date <= pt) : [];
  return { cur, prevRows };
}

/** Картки «Основні показники» так, як їх складала сторінка (до виносу в каталог). */
function legacyCards({ cur, prevRows, from, to, SR, axis }) {
  const D = { from, to };
  const A = agg(cur);
  const P = prevRows.length ? agg(prevRows) : null;
  const munTop = sorted(A.byMun, 0).slice(0, 2).map((x) => x[0] + ' ' + N0(x[1])).join(' · ');
  let H2 = null; if (!P) { const f0 = dayNum(D.from), l0 = dayNum(D.to) - f0 + 1; if (l0 >= 14) { const mid = f0 + Math.floor(l0 / 2), r1 = [], r2 = []; for (const r of cur) { const d = dayNum(r.date); if (isFinite(d)) (d < mid ? r1 : r2).push(r); } if (r1.length >= 5 && r2.length >= 5) H2 = [agg(r1), agg(r2)]; } }
  const lenD = Math.max(1, dayNum(D.to) - dayNum(D.from) + 1);
  const DSt = new Map(); for (const r of cur) { if (!r.date) continue; let o = DSt.get(r.date); if (!o) DSt.set(r.date, o = { n: 0, mun: 0, hit: 0, part: 0, miss: 0, unk: 0 }); o.n++; o.mun += r.count; o[r.kind]++; }
  const maxDay = (k) => { let m = 0; for (const o of DSt.values()) if (o[k] > m) m = o[k]; return m; };
  const MSt = new Map(); for (const r of cur) { if (!r.date) continue; const mk = r.date.slice(0, 7); let o = MSt.get(mk); if (!o) MSt.set(mk, o = { miss: 0 }); if (r.kind === 'miss') o.miss++; }
  const minMonthMiss = MSt.size ? Math.min(...[...MSt.values()].map((o) => o.miss)) : 0;
  const pd = (c, p) => (p == null || !(p > 0)) ? null : Math.round((c - p) / p * 100);
  const dn = (k) => P ? pd(A[k], P[k]) : H2 ? pd(H2[1][k], H2[0][k]) : null;
  const shr = (x) => A.n ? Math.round(x / A.n * 100) : 0;
  const MB = new Map(); for (const r of cur) { if (!r.date) continue; const mk = r.date.slice(0, 7); let o = MB.get(mk); if (!o) MB.set(mk, o = { n: 0, mun: 0 }); o.n++; o.mun += r.count; }
  const months = (k) => [...MB.keys()].sort().slice(-6).map((mk) => ({ t: MON3[+mk.slice(5, 7) - 1], v: MB.get(mk)[k] }));
  const perDay = N1(A.n / lenD), perSortie = A.n ? N1(A.mun / A.n) : '—';
  const card = (tone, ic, label, sub, val, k, mode, go, x, info) => Object.assign({ tone, ic, label, sub, val, go, delta: mkDelta(dn(k), mode), dlLabel: P ? 'до попереднього періоду' : H2 ? 'друга половина до першої' : 'немає бази для порівняння', series: SR[k], color: CC[tone], labels: axis, info }, x);
  const res = (tone, ic, label, sub, k, mode, cap, info) => card(tone, ic, label, sub, N0(A[k]), k, mode, 'ops', { ring: shr(A[k]), ringL: 'Частка ' + { hit: 'уражених', part: 'пошкоджених', miss: 'неуражених', unk: 'невідомих' }[k] + ' від усіх вильотів', cap }, info);
  return [
    card('blue', 'plane', 'Вильоти', 'Всього бойових вильотів', N0(A.n), 'n', 'up', 'ops', { bars: months('n'), wide: { ic: 'avg', l: 'Середній темп', v: perDay + ' ' + (A.n % lenD ? 'вильоту' : plural(A.n / lenD, ['виліт', 'вильоти', 'вильотів'])) + '/день' } }, 'Один запис у таблиці — один виліт (паспорт цілі). Із застосуванням БП: ' + N0(A.applied) + '. З відбоєм: ' + A.abort + '. Макс. за добу: ' + N0(maxDay('n'))),
    card('amber', 'bomb', 'Використано БП', 'Усі типи боєприпасів', N0(A.mun), 'mun', 'up', 'mun', { bars: months('mun'), wide: { ic: 'bomb', l: 'Середня витрата', v: perSortie + ' БП на виліт' } }, (munTop ? munTop + '. ' : '') + 'Макс. за добу: ' + N0(maxDay('mun'))),
    res('green', 'tgtg', 'Уражено', 'Підтверджені результати', 'hit', 'up', 'Ціль знищено / виведено з ладу', 'Макс. за добу: ' + N0(maxDay('hit'))),
    res('orange', 'wrench', 'Пошкоджено', 'Часткове ураження', 'part', 'warn', 'Часткове ураження, потребує дорозвідки', 'У таблиці — «ЧАСТКОВО УРАЖЕНО». Макс. за добу: ' + N0(maxDay('part'))),
    res('red', 'miss', 'Не уражено', 'Без підтвердженого ефекту', 'miss', 'down', 'Погодні умови, РЕБ, відмова АЗУ та ін.', 'Ціль не уражено. Мін. за місяць: ' + N0(minMonthMiss)),
    ...(A.unk ? [res('grey', 'unk', 'Не відомо', 'Очікує перевірки', 'unk', 'neutral', 'Результат не підтверджено або не розпізнано', 'Чекає перевірки: ' + N0(A.unk))] : []),
  ];
}

/** Те саме, але з каталогу; `halves` сторінка бере з тих самих рядків, що й еталон. */
function catalogCards({ cur, prevRows, from, to, SR, axis }) {
  const P = prevRows.length ? agg(prevRows) : null;
  let H2 = null; if (!P) { const f0 = dayNum(from), l0 = dayNum(to) - f0 + 1; if (l0 >= 14) { const mid = f0 + Math.floor(l0 / 2), r1 = [], r2 = []; for (const r of cur) { const d = dayNum(r.date); if (isFinite(d)) (d < mid ? r1 : r2).push(r); } if (r1.length >= 5 && r2.length >= 5) H2 = [agg(r1), agg(r2)]; } }
  return buildCards(
    { rows: cur, from, to, prevRows, halves: H2 ? [H2[0].rows, H2[1].rows] : null, series: SR, axis },
    { mkDelta, colors: CC, monthNames: MON3 },
  );
}

/* ------------------------------------------------------------------ */
/*  Набори даних                                                       */
/* ------------------------------------------------------------------ */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SERIES = { n: [1, 2, 3], mun: [4, 5, 6], eff: [7, 8], hit: [9, 1], part: [2, 3], miss: [4, 5], unk: [6, 7] };
const AXIS = [{ i: 0, t: '01.08' }, { i: 2, t: '03.08' }];
const MUNITIONS = ['GBU-39', 'GBU-62', 'GBU-64', 'AASM-250', 'С-8', 'ОФАБ-250', 'AGM-88 HARM'];

function makeRows(seed, size, spanDays, { kinds = ['hit', 'hit', 'part', 'miss', 'unk'], dateless = 0 } = {}) {
  const next = rng(seed);
  const start = dayNum('2026-01-17');
  const rows = [];
  for (let i = 0; i < size; i += 1) {
    const applied = next() > 0.15;
    const abort = next() < 0.1;
    rows.push({
      date: isoOf(start + Math.floor(next() * (spanDays + 1))),
      kind: kinds[Math.floor(next() * kinds.length)],
      count: applied ? Math.floor(next() * 7) + (next() < 0.1 ? 40 : 0) : 0,
      munition: applied && next() > 0.05 ? MUNITIONS[Math.floor(next() * MUNITIONS.length)] : '',
      abort,
    });
  }
  for (let i = 0; i < dateless; i += 1) rows.push({ date: '', kind: kinds[i % kinds.length], count: i % 4, munition: MUNITIONS[i % MUNITIONS.length], abort: i % 5 === 0 });
  return rows;
}

function periods(rows) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return [];
  const DMIN = dates[0], DMAX = dates[dates.length - 1];
  const last = (n) => isoOf(Math.max(dayNum(DMIN), dayNum(DMAX) - n + 1));
  const mid = isoOf(Math.floor((dayNum(DMIN) + dayNum(DMAX)) / 2));
  return [
    { name: 'увесь період', DMIN, from: DMIN, to: DMAX },
    { name: '7 днів', DMIN, from: last(7), to: DMAX },
    { name: '30 днів', DMIN, from: last(30), to: DMAX },
    { name: 'остання доба', DMIN, from: DMAX, to: DMAX },
    { name: 'друга половина', DMIN, from: mid, to: DMAX },
    { name: 'порожній проміжок після даних', DMIN, from: isoOf(dayNum(DMAX) + 5), to: isoOf(dayNum(DMAX) + 9) },
  ];
}

test('картки з каталогу збігаються з кодом сторінки до виносу на випадкових наборах', () => {
  let compared = 0;
  let withHidden = 0;
  let withPrevious = 0;
  let withHalves = 0;
  let withoutBase = 0;
  for (const spanDays of [0, 4, 20, 45, 120, 420]) {
    for (const size of [1, 7, 60, 300]) {
      for (const seed of [1, 2, 3]) {
        const rows = makeRows(seed * 1000 + size + spanDays, size, spanDays);
        for (const period of periods(rows)) {
          const { cur, prevRows } = pageContext(rows, period.from, period.to, period.DMIN);
          const input = { cur, prevRows, from: period.from, to: period.to, SR: SERIES, axis: AXIS };
          const expected = legacyCards(input);
          assert.deepStrictEqual(catalogCards(input), expected, `${spanDays} діб, ${size} записів, seed ${seed}, ${period.name}`);
          compared += 1;
          if (expected.length === 5) withHidden += 1;
          if (expected[0].dlLabel === COMPARE_LABEL.previous) withPrevious += 1;
          else if (expected[0].dlLabel === COMPARE_LABEL.halves) withHalves += 1;
          else withoutBase += 1;
        }
      }
    }
  }
  assert.ok(compared >= 400, `порівняно ${compared} випадків`);
  assert.ok(withHidden > 20 && withPrevious > 20 && withHalves > 20 && withoutBase > 20, 'набір охоплює всі гілки: приховану картку, попередній період, половини й відсутність бази');
});

test('результати без «Не відомо», записи без дати і довгі періоди теж збігаються', () => {
  for (const kinds of [['hit'], ['miss', 'miss', 'part'], ['unk']]) {
    for (const dateless of [0, 3, 11]) {
      const rows = makeRows(77, 90, 200, { kinds, dateless });
      for (const period of periods(rows)) {
        const { cur, prevRows } = pageContext(rows, period.from, period.to, period.DMIN);
        // записи без дати сторінка в період не бере, але ядро мусить їх пережити, якщо вони все ж потраплять у вибірку
        const withDateless = [...cur, ...rows.filter((r) => !r.date)];
        for (const sample of [cur, withDateless]) {
          const input = { cur: sample, prevRows, from: period.from, to: period.to, SR: SERIES, axis: AXIS };
          assert.deepStrictEqual(catalogCards(input), legacyCards(input), `${JSON.stringify(kinds)}, без дати ${dateless}, ${period.name}`);
        }
      }
    }
  }
});

test('картки без записів: нулі, прочерк у середній витраті, без змін і без картки «Не відомо»', () => {
  const cards = buildCards({ rows: [], from: '2026-08-01', to: '2026-08-10', prevRows: [], halves: null, series: SERIES, axis: AXIS }, { mkDelta, colors: CC, monthNames: MON3 });
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((card) => card.val), ['0', '0', '0', '0', '0']);
  assert.equal(cards[0].wide.v, '0 вильотів/день');
  assert.equal(cards[1].wide.v, '— БП на виліт');
  assert.deepEqual(cards[0].bars, []);
  assert.ok(cards.every((card) => card.delta === null && card.dlLabel === COMPARE_LABEL.none));
  assert.deepEqual(cards.slice(2).map((card) => card.ring), [0, 0, 0]);
});

test('конкретний приклад: три вильоти, підказки й підписи дослівно', () => {
  const rows = [
    { date: '2026-08-01', kind: 'hit', count: 2, munition: 'GBU-39', abort: false },
    { date: '2026-08-01', kind: 'miss', count: 1, munition: 'GBU-62', abort: false },
    { date: '2026-08-03', kind: 'unk', count: 0, munition: '', abort: true },
  ];
  const cards = buildCards({ rows, from: '2026-08-01', to: '2026-08-04', prevRows: [], halves: null, series: SERIES, axis: AXIS }, { mkDelta, colors: CC, monthNames: MON3 });
  assert.deepEqual(cards.map((card) => card.label), ['Вильоти', 'Використано БП', 'Уражено', 'Пошкоджено', 'Не уражено', 'Не відомо']);
  assert.deepEqual(cards.map((card) => card.val), ['3', '3', '1', '0', '1', '1']);
  assert.equal(cards[0].info, 'Один запис у таблиці — один виліт (паспорт цілі). Із застосуванням БП: 2. З відбоєм: 1. Макс. за добу: 2');
  assert.equal(cards[0].wide.v, '0,8 вильоту/день');
  assert.equal(cards[1].info, 'GBU-39 2 · GBU-62 1. Макс. за добу: 3');
  assert.equal(cards[1].wide.v, '1 БП на виліт');
  assert.equal(cards[4].info, 'Ціль не уражено. Мін. за місяць: 1');
  assert.deepEqual(cards[0].bars, [{ t: 'Сер', v: 3 }]);
  assert.deepEqual(cards.map((card) => card.go), ['ops', 'mun', 'ops', 'ops', 'ops', 'ops']);
  assert.deepEqual(cards.map((card) => card.color), [CC.blue, CC.amber, CC.green, CC.orange, CC.red, CC.grey]);
  assert.equal(cards[0].series, SERIES.n);
  assert.equal(cards[5].series, SERIES.unk);
});

/* ------------------------------------------------------------------ */
/*  Підключення до сторінки                                            */
/* ------------------------------------------------------------------ */

test('модуль реєструє window.PSKpi лише коли window є', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  globalThis.window = {};
  try {
    await import('../src/ps-kpi.js?window');
    assert.equal(typeof globalThis.window.PSKpi.buildCards, 'function');
    assert.ok(Object.isFrozen(globalThis.window.PSKpi));
  } finally {
    delete globalThis.window;
  }
});

test('air.html підключає модуль і будує картки через window.PSKpi', () => {
  assert.ok(/<script type="module" src="\.\/ps-kpi\.js"><\/script>/.test(AIR), 'air.html має підключати ./ps-kpi.js');
  assert.ok(/if \(window\.PSKpi\) \{[\s\S]*?window\.PSKpi\.buildCards\(/.test(AIR), 'головний шлях — через window.PSKpi.buildCards');
  // старий код складання карток лишається лише як запасний шлях (гілка else), а не як головний
  const fallback = AIR.match(/if \(window\.PSKpi\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(fallback, 'має бути гілка if (window.PSKpi) … else …');
  assert.ok(/\} else \{[\s\S]*?const card = \(tone, ic, label, sub, val, k, mode, go, x, info\)/.test(AIR), 'старе складання карток лишається лише в гілці else як запасний шлях');
  assert.ok(/\.map\(kpiCard\)/.test(AIR), 'моделі з каталогу перетворюються на DOM через kpiCard');
});
