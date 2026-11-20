/* E2, блок РВ: числа карток «Основних показників» дашборда РВ/УДШВ (src/rocket.html) у спільному ядрі.
   Чисте ядро без DOM. Формули перенесено з rocket.html без змін; сторінка викликає їх через
   window.RVKpiCore (src/rv-kpi.js). Підписи, форматування чисел і малювання карток лишаються на сторінці
   (docs/MODULES_ROADMAP.md, етап E2). */

/** Визначення реєстру модулів (docs/MODULE_DEFINITIONS.md), які рахує цей блок. `@__PURE__`: незадіяний масив не лишається у збірці ПВК-lite. */
export const RV_KPI_DEFINITIONS = /* @__PURE__ */ Object.freeze([
  'legacy:rv-kpi-launches',
  'legacy:rv-kpi-munitions',
  'legacy:rv-kpi-destroyed',
  'legacy:rv-kpi-damaged',
  'legacy:rv-kpi-miss',
  'legacy:rv-kpi-unknown',
]);

// Ті самі однорядкові допоміжні функції, що й у rocket.html (там вони потрібні ще й поза картками);
// збіг із сторінкою перевіряє tests/module-adapter-rv.test.mjs.
export const dayNum = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
export const isoOf = n => new Date(n * 864e5).toISOString().slice(0, 10);

/** Результат ураження за текстом клітинки «Результат»: знищено / подавлено / пошкоджено / не уражено / null. */
export function rocketOutcome(s) {
  const t = String(s || '').trim().toLowerCase();
  if (/^знищен/.test(t)) return 'destroyed';
  if (/^подавлен/.test(t)) return 'suppressed';
  if (/^(?:пошкоджен|частков)/.test(t)) return 'damaged';
  if (/^не\s*(?:уражен|влуч|підтверджен)/.test(t)) return 'miss';
  return null;
}

/** Вид результату запису за текстом «Результат» (як `resKind` у rocket.html): hit / part / miss / unk. */
export function resKind(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return 'unk';
  if (/^частков/.test(t)) return 'part';
  if (/^не\s*(?:уражен|влуч|підтверджен)/.test(t)) return 'miss';
  if (/^(?:уражен|знищен)/.test(t)) return 'hit';
  if (/^(?:пошкоджен|подавлен)/.test(t)) return 'part';
  return 'unk';
}

export function inc(map, key, by) { map.set(key, (map.get(key) || 0) + by); }

/** Підсумок за набір рядків моделі РВ: пуски, БП, результати, розрізи за платформою, БП, підрозділом, типом цілі. */
export function agg(rows) {
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

/** Ефективність, %: (влучання + частка часткових) / (запити − відбої); режим 'w' рахує часткові з вагою 0,75. */
export const eff = (x, mode) => { const den = x.n - x.abort; if (!den) return null; return ((x.hit + (mode === 'w' ? 0.75 : 1) * x.part) / den) * 100; };

/** Ряди міні-графіків карток: не більш як 24 відрізки періоду state.from…state.to. */
export function kpiSeries(cur, state) {
  const f = dayNum(state.from), tt = dayNum(state.to), len = Math.max(1, tt - f + 1), NB = Math.min(24, len), B = Array.from({ length: NB }, () => ({ n: 0, mun: 0, hit: 0, part: 0, miss: 0, unk: 0, destroyed: 0, suppressed: 0, damaged: 0, abort: 0 }));
  for (const r of cur) { const d = dayNum(r.date); if (!isFinite(d)) continue; const i = Math.min(NB - 1, Math.max(0, Math.floor((d - f) / len * NB))), b = B[i]; b.n++; b.mun += r.count; b[r.kind]++; const ro = rocketOutcome(r.resRaw); if (ro && ro !== 'miss') b[ro]++; if (r.abort) b.abort++; }
  const w = state.eff === 'w' ? 0.75 : 1, ef = b => { const den = b.n - b.abort; return den ? (b.hit + w * b.part) / den * 100 : 0; };
  return { n: B.map(b => b.n), mun: B.map(b => b.mun), eff: B.map(ef), hit: B.map(b => b.hit), part: B.map(b => b.part), miss: B.map(b => b.miss), unk: B.map(b => b.unk), destroyed: B.map(b => b.destroyed), suppressed: B.map(b => b.suppressed), damaged: B.map(b => b.damaged) };
}

/** Частка від усіх пусків періоду, %, округлена: `shareOfOps(A, A.destroyed)`. */
export const shareOfOps = (A, x) => A.n ? Math.round(x / A.n * 100) : 0;

/** Відсоткова зміна: немає бази порівняння або вона не додатна — null. */
const pd = (c, p) => (p == null || !(p > 0)) ? null : Math.round((c - p) / p * 100);

/**
 * Числа карток за період. Вхід: рядки моделі РВ (`rows`), межі періоду `from`/`to` (ISO),
 * найраніша дата таблиці `dmin` і режим ефективності `effMode` ('sum' | 'w').
 * Повертає суму періоду `A`, базу порівняння (`P` — попередній період такої ж тривалості,
 * інакше `H2` — [перша половина, друга половина] для періодів від 14 діб), ряди міні-графіків,
 * зміни, максимуми за добу та мінімум «не уражено» за місяць.
 */
export function computeRvKpis({ rows, from, to, dmin, effMode }) {
  const inRange = r => r.date && r.date >= from && r.date <= to;
  const cur = rows.filter(inRange), A = agg(cur);
  const len = dayNum(to) - dayNum(from) + 1, pf = isoOf(dayNum(from) - len), pt = isoOf(dayNum(from) - 1);
  const prevRows = dayNum(pt) >= dayNum(dmin) ? rows.filter(r => r.date && r.date >= pf && r.date <= pt) : [];
  const P = prevRows.length ? agg(prevRows) : null;
  const e = eff(A, effMode);
  // якщо попереднього періоду немає (весь період) — друга половина проти першої
  let H2 = null; if (!P) { const f0 = dayNum(from), l0 = dayNum(to) - f0 + 1; if (l0 >= 14) { const mid = f0 + Math.floor(l0 / 2), r1 = [], r2 = []; for (const r of cur) { const d = dayNum(r.date); if (isFinite(d)) (d < mid ? r1 : r2).push(r); } if (r1.length >= 5 && r2.length >= 5) H2 = [agg(r1), agg(r2)]; } }
  const SR = kpiSeries(cur, { from, to, eff: effMode });
  const dlLabel = P ? 'до попер. періоду' : 'друга пол. до першої';
  const lenD = Math.max(1, dayNum(to) - dayNum(from) + 1);
  const DSt = new Map(); for (const r of cur) { if (!r.date) continue; let o = DSt.get(r.date); if (!o) DSt.set(r.date, o = { n: 0, mun: 0, hit: 0, part: 0, miss: 0, unk: 0, destroyed: 0, suppressed: 0, damaged: 0 }); o.n++; o.mun += r.count; o[r.kind]++; const ro = rocketOutcome(r.resRaw); if (ro && ro !== 'miss') o[ro]++; }
  const maxDay = k => { let m = 0; for (const o of DSt.values()) if (o[k] > m) m = o[k]; return m; };
  const MSt = new Map(); for (const r of cur) { if (!r.date) continue; const mk = r.date.slice(0, 7); let o = MSt.get(mk); if (!o) MSt.set(mk, o = { miss: 0 }); if (r.kind === 'miss') o.miss++; }
  const minMonthMiss = MSt.size ? Math.min(...[...MSt.values()].map(o => o.miss)) : 0;
  [A, P, H2 && H2[0], H2 && H2[1]].forEach(o => { if (o) o.dmgSup = (o.damaged || 0) + (o.suppressed || 0); });
  DSt.forEach(o => { o.dmgSup = (o.damaged || 0) + (o.suppressed || 0); });
  const dn = k => P ? pd(A[k], P[k]) : H2 ? pd(H2[1][k], H2[0][k]) : null;
  const change = {}, maxPerDay = {};
  for (const k of ['n', 'mun', 'destroyed', 'dmgSup', 'miss', 'unk']) { change[k] = dn(k); maxPerDay[k] = maxDay(k); }
  return { cur, A, P, H2, e, SR, lenD, dlLabel, change, maxPerDay, minMonthMiss, perDay: A.n / lenD, munPerSortie: A.n ? A.mun / A.n : null };
}
