import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { listDefinitions } from '../src/module-definition-core.js';
import * as core from '../src/module-adapters/rv-kpi-core.js';
import { RV_KPI_DEFINITIONS, agg, computeRvKpis, dayNum, isoOf, shareOfOps } from '../src/module-adapters/rv-kpi-core.js';
import { loadRocketKpi } from './helpers/rocket-kpi.mjs';

// Еталон «до»: формули чисел карток РВ із rocket.html до E2, скопійовані дослівно.
const legacy = (() => {
  const dayNum = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
  const isoOf = n => new Date(n * 864e5).toISOString().slice(0, 10);
  function rocketOutcome(s) {
    const t = String(s || '').trim().toLowerCase();
    if (/^знищен/.test(t)) return 'destroyed';
    if (/^подавлен/.test(t)) return 'suppressed';
    if (/^(?:пошкоджен|частков)/.test(t)) return 'damaged';
    if (/^не\s*(?:уражен|влуч|підтверджен)/.test(t)) return 'miss';
    return null;
  }
  function inc(map, key, by) { map.set(key, (map.get(key) || 0) + by); }
  function agg(rows) {
    const A = { n: rows.length, abort: 0, mun: 0, applied: 0, hit: 0, part: 0, miss: 0, unk: 0, destroyed: 0, suppressed: 0, damaged: 0, byPlat: new Map(), byMun: new Map(), byUnit: new Map(), byType: new Map(), rows };
    for (const r of rows) {
      A[r.kind]++; const ro = rocketOutcome(r.resRaw); if (ro && ro !== 'miss') A[ro]++; if (r.abort) A.abort++; A.mun += r.count; if (r.count > 0) A.applied++;
      inc(A.byPlat, r.aircraft || 'Не вказано', 1);
      if (r.munition) inc(A.byMun, r.munition, r.count);
      const un = r.unit || 'Не вказано'; let u = A.byUnit.get(un);
      if (!u) A.byUnit.set(un, u = { n: 0, abort: 0, hit: 0, part: 0, miss: 0, unk: 0 });
      u.n++; u[r.kind]++; if (r.abort) u.abort++;
      for (const t of r.types) inc(A.byType, t, 1);
    }
    return A;
  }
  function numbers(ROWS, D, DMIN) {
    const eff = x => { const den = x.n - x.abort; if (!den) return null; return ((x.hit + (D.eff === 'w' ? 0.75 : 1) * x.part) / den) * 100; };
    const inRange = r => r.date && r.date >= D.from && r.date <= D.to;
    function kpiSeries(cur) {
      const f = dayNum(D.from), tt = dayNum(D.to), len = Math.max(1, tt - f + 1), NB = Math.min(24, len), B = Array.from({ length: NB }, () => ({ n: 0, mun: 0, hit: 0, part: 0, miss: 0, unk: 0, destroyed: 0, suppressed: 0, damaged: 0, abort: 0 }));
      for (const r of cur) { const d = dayNum(r.date); if (!isFinite(d)) continue; const i = Math.min(NB - 1, Math.max(0, Math.floor((d - f) / len * NB))), b = B[i]; b.n++; b.mun += r.count; b[r.kind]++; const ro = rocketOutcome(r.resRaw); if (ro && ro !== 'miss') b[ro]++; if (r.abort) b.abort++; }
      const w = D.eff === 'w' ? 0.75 : 1, ef = b => { const den = b.n - b.abort; return den ? (b.hit + w * b.part) / den * 100 : 0; };
      return { n: B.map(b => b.n), mun: B.map(b => b.mun), eff: B.map(ef), hit: B.map(b => b.hit), part: B.map(b => b.part), miss: B.map(b => b.miss), unk: B.map(b => b.unk), destroyed: B.map(b => b.destroyed), suppressed: B.map(b => b.suppressed), damaged: B.map(b => b.damaged) };
    }
    const cur = ROWS.filter(inRange), A = agg(cur);
    const len = dayNum(D.to) - dayNum(D.from) + 1, pf = isoOf(dayNum(D.from) - len), pt = isoOf(dayNum(D.from) - 1);
    const prevRows = dayNum(pt) >= dayNum(DMIN) ? ROWS.filter(r => r.date && r.date >= pf && r.date <= pt) : [];
    const P = prevRows.length ? agg(prevRows) : null;
    const e = eff(A);
    let H2 = null; if (!P) { const f0 = dayNum(D.from), l0 = dayNum(D.to) - f0 + 1; if (l0 >= 14) { const mid = f0 + Math.floor(l0 / 2), r1 = [], r2 = []; for (const r of cur) { const d = dayNum(r.date); if (isFinite(d)) (d < mid ? r1 : r2).push(r); } if (r1.length >= 5 && r2.length >= 5) H2 = [agg(r1), agg(r2)]; } }
    const SR = kpiSeries(cur), dlLabel = P ? 'до попер. періоду' : 'друга пол. до першої';
    const lenD = Math.max(1, dayNum(D.to) - dayNum(D.from) + 1);
    const DSt = new Map(); for (const r of cur) { if (!r.date) continue; let o = DSt.get(r.date); if (!o) DSt.set(r.date, o = { n: 0, mun: 0, hit: 0, part: 0, miss: 0, unk: 0, destroyed: 0, suppressed: 0, damaged: 0 }); o.n++; o.mun += r.count; o[r.kind]++; const ro = rocketOutcome(r.resRaw); if (ro && ro !== 'miss') o[ro]++; }
    const maxDay = k => { let m = 0; for (const o of DSt.values()) if (o[k] > m) m = o[k]; return m; };
    const MSt = new Map(); for (const r of cur) { if (!r.date) continue; const mk = r.date.slice(0, 7); let o = MSt.get(mk); if (!o) MSt.set(mk, o = { miss: 0 }); if (r.kind === 'miss') o.miss++; }
    const minMonthMiss = MSt.size ? Math.min(...[...MSt.values()].map(o => o.miss)) : 0;
    const pd = (c, p) => (p == null || !(p > 0)) ? null : Math.round((c - p) / p * 100);
    const dn = k => P ? pd(A[k], P[k]) : H2 ? pd(H2[1][k], H2[0][k]) : null;
    const shr = x => A.n ? Math.round(x / A.n * 100) : 0;
    [A, P, H2 && H2[0], H2 && H2[1]].forEach(o => { if (o) o.dmgSup = (o.damaged || 0) + (o.suppressed || 0); });
    DSt.forEach(o => { o.dmgSup = (o.damaged || 0) + (o.suppressed || 0); });
    const keys = ['n', 'mun', 'destroyed', 'dmgSup', 'miss', 'unk'];
    return {
      cur, A, P, H2, e, SR, lenD, dlLabel, minMonthMiss,
      change: Object.fromEntries(keys.map(k => [k, dn(k)])),
      maxPerDay: Object.fromEntries(keys.map(k => [k, maxDay(k)])),
      perDay: A.n / lenD, munPerSortie: A.n ? A.mun / A.n : null,
      shares: Object.fromEntries(['destroyed', 'dmgSup', 'miss', 'unk'].map(k => [k, shr(A[k])])),
    };
  }
  return { numbers, dayNum, isoOf };
})();

const row = (date, kind, resRaw, count, extra = {}) => ({
  date, kind, resRaw, count, abort: false, aircraft: 'Платформа', munition: 'Тип А', unit: 'Підрозділ', types: [], pts: [], ...extra,
});
const day = n => new Date(Date.UTC(2026, 2, 1) + n * 864e5).toISOString().slice(0, 10);
const asCase = (rows, from, to, effMode = 'sum', dmin) => ({ rows, state: { from, to, eff: effMode }, dmin: dmin ?? (rows.map(r => r.date).filter(Boolean).sort()[0] || from) });

// Дрібний детермінований генератор, щоб випадкові набори були відтворювані.
function lcg(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
function randomCase(rand) {
  const pick = list => list[Math.floor(rand() * list.length)];
  const rows = Array.from({ length: Math.floor(rand() ** 2 * 60) }, () => row(rand() < 0.05 ? '' : day(Math.floor(rand() * 200)), pick(['hit', 'part', 'miss', 'unk']),
    pick(['Знищено', 'Подавлено', 'Пошкоджено', 'Частково', 'Не уражено', 'Не влучено', 'Не підтверджено', '', 'щось', null]), Math.floor(rand() * 7),
    { abort: rand() < 0.15, aircraft: pick(['A', 'B', '']), munition: pick(['M1', 'M2', '']), unit: pick(['U1', 'U2', '']), types: rand() < 0.5 ? ['t'] : [] }));
  const a = Math.floor(rand() * 200);
  const dmin = rand() < 0.5 ? day(Math.max(0, a - Math.floor(rand() * 150))) : day(Math.floor(rand() * 200));
  return asCase(rows, day(a), day(a + Math.floor(rand() * 120)), pick(['sum', 'w']), dmin);
}

const CASES = [
  ['порожні рядки', asCase([], day(0), day(3))],
  ['один день: перший і останній збігаються', asCase([row(day(0), 'hit', 'Знищено', 2)], day(0), day(0))],
  ['попередній період є', asCase([row(day(-4), 'hit', 'Знищено', 2), row(day(-2), 'miss', 'Не уражено', 1), row(day(1), 'hit', 'Знищено', 3), row(day(2), 'part', 'Подавлено', 1)], day(0), day(3), 'sum', day(-10))],
  ['попередній період до початку таблиці: порівняння немає', asCase([row(day(1), 'hit', 'Знищено', 3)], day(0), day(3), 'sum', day(0))],
  ['довгий період: друга половина проти першої', asCase([...Array.from({ length: 5 }, (_, i) => row(day(i), 'hit', 'Знищено', 1)), ...Array.from({ length: 10 }, (_, i) => row(day(10 + i), 'miss', 'Не уражено', 2))], day(0), day(19), 'w', day(0))],
  ['довгий період, але половин менше п’яти записів', asCase([row(day(0), 'hit', 'Знищено', 1), row(day(18), 'hit', 'Знищено', 1)], day(0), day(19), 'sum', day(0))],
  ['рядок без дати, нулі й невідомі результати', asCase([row('', 'hit', 'Знищено', 4), row(day(0), 'unk', '', 0), row(day(0), 'unk', 'щось', 0, { abort: true })], day(0), day(2))],
  ['кілька місяців: мінімум «не уражено» за місяць', asCase([row('2026-01-10', 'miss', 'Не уражено', 1), row('2026-01-11', 'miss', 'Не уражено', 1), row('2026-02-10', 'hit', 'Знищено', 1), row('2026-03-10', 'miss', 'Не уражено', 1)], '2026-01-01', '2026-03-31', 'sum', '2026-01-01')],
];

test('E2 РВ: ядро дає ті самі числа, що еталон «до» для кожного випадку', () => {
  for (const [name, { rows, state, dmin }] of CASES) {
    const before = legacy.numbers(rows, state, dmin);
    const after = computeRvKpis({ rows, from: state.from, to: state.to, dmin, effMode: state.eff });
    for (const key of ['A', 'P', 'H2', 'e', 'SR', 'lenD', 'dlLabel', 'minMonthMiss', 'change', 'maxPerDay', 'perDay', 'munPerSortie', 'cur']) assert.deepEqual(after[key], before[key], `${name}: ${key}`);
    for (const [key, value] of Object.entries(before.shares)) assert.equal(shareOfOps(after.A, after.A[key]), value, `${name}: частка ${key}`);
  }
});

test('E2 РВ: 500 відтворюваних випадкових наборів збігаються з еталоном', () => {
  const rand = lcg(20261029);
  for (let i = 0; i < 500; i++) {
    const { rows, state, dmin } = randomCase(rand);
    const before = legacy.numbers(rows, state, dmin);
    const after = computeRvKpis({ rows, from: state.from, to: state.to, dmin, effMode: state.eff });
    for (const key of ['A', 'P', 'H2', 'e', 'SR', 'minMonthMiss', 'change', 'maxPerDay', 'perDay', 'munPerSortie']) assert.deepEqual(after[key], before[key], `набір ${i}: ${key}`);
  }
});

test('E2 РВ: значення відомого набору збігаються з ручним підрахунком', () => {
  const rows = [
    row('2026-02-25', 'hit', 'Знищено', 2), row('2026-02-27', 'hit', 'Знищено', 2),
    row('2026-03-01', 'hit', 'Знищено', 2), row('2026-03-02', 'miss', 'Не уражено', 1), row('2026-03-03', 'part', 'Подавлено', 3), row('2026-03-04', 'hit', 'Знищено', 0),
  ];
  const k = computeRvKpis({ rows, from: '2026-03-01', to: '2026-03-04', dmin: '2026-02-01', effMode: 'sum' });
  assert.equal(k.A.n, 4);
  assert.equal(k.P.n, 2);
  assert.equal(k.change.n, 100);
  assert.equal(k.change.mun, 50);
  assert.equal(k.change.destroyed, 0);
  assert.equal(k.change.miss, null, 'у попередньому періоді «не уражено» не було');
  assert.equal(k.dlLabel, 'до попер. періоду');
  assert.equal(k.perDay, 1);
  assert.equal(k.munPerSortie, 1.5);
  assert.equal(k.maxPerDay.n, 1);
  assert.equal(k.A.dmgSup, 1);
  assert.equal(k.e, (2 + 1) / 4 * 100);
  assert.equal(computeRvKpis({ rows: [], from: '2026-03-01', to: '2026-03-04', dmin: '2026-03-01', effMode: 'sum' }).munPerSortie, null);
});

test('E2 РВ: допоміжні дати ядра збігаються з rocket.html, а агрегат працює на порожньому вході', async () => {
  const html = await readFile(new URL('../src/rocket.html', import.meta.url), 'utf8');
  const page = new Function(`${/^const dayNum = .*;$/m.exec(html)[0]}\n${/^const isoOf = .*;$/m.exec(html)[0]}\nreturn { dayNum, isoOf };`)();
  for (const iso of ['2026-03-01', '2024-02-29', '2026-12-31', '2026-13-01', '', 'не дата', undefined]) assert.deepEqual([dayNum(iso)], [page.dayNum(iso)], `dayNum(${iso})`);
  for (const n of [0, 20000, 20515.5, -3]) assert.equal(isoOf(n), page.isoOf(n), `isoOf(${n})`);
  const empty = agg([]);
  assert.equal(empty.n, 0);
  assert.equal(shareOfOps(empty, 0), 0);
  assert.equal(core.eff(empty, 'sum'), null);
  assert.ok(await loadRocketKpi(), 'сторінка з ядром збирається у тестову обв’язку');
});

test('E2 РВ: блок охоплює картки реєстру, а сторінка не рахує числа сама', async () => {
  assert.equal(RV_KPI_DEFINITIONS.length, 6);
  const registry = new Map(listDefinitions().map(item => [item.definitionId, item]));
  for (const id of RV_KPI_DEFINITIONS) {
    assert.match(id, /^legacy:rv-kpi-/);
    assert.ok(registry.get(id)?.usedIn.some(use => use.surface === 'rocket'), `${id} немає в реєстрі модулів`);
  }
  const html = await readFile(new URL('../src/rocket.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="\.\/rv-kpi\.js"><\/script>/);
  assert.match(html, /window\.RVKpiCore\.computeRvKpis\(\{ rows: ROWS, from: D\.from, to: D\.to, dmin: DMIN, effMode: D\.eff \}\)/);
  assert.match(html, /document\.addEventListener\('rvkpi:ready'/, 'сторінка домальовується, коли ядро завантажилось пізніше за таблицю');
  for (const gone of [/const MSt = new Map\(\)/, /const DSt = new Map\(\)/, /const pd = \(c, p\)/, /A\[r\.kind\]\+\+; const ro = rocketOutcome/]) assert.doesNotMatch(html, gone, `${gone} лишилось на сторінці`);
  const adapter = await readFile(new URL('../src/module-adapters/rv-kpi-core.js', import.meta.url), 'utf8');
  const code = adapter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document|window|innerHTML/, 'ядро блока не працює з DOM');
  assert.doesNotMatch(code, /^import /m, 'ядро блока не має залежностей');
});

test('E2 РВ: перехідник ставить window.RVKpiCore і подає rvkpi:ready лише коли є window', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const events = [];
  globalThis.window = {};
  globalThis.document = { dispatchEvent: event => events.push(event.type) };
  try {
    await import('../src/rv-kpi.js?window');
    assert.equal(typeof globalThis.window.RVKpiCore.computeRvKpis, 'function');
    assert.ok(Object.isFrozen(globalThis.window.RVKpiCore));
    assert.deepEqual(events, ['rvkpi:ready']);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});
