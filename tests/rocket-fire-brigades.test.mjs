// РВ, «Зведення»: блок «Вогневі бригади» — скільки БП випустила кожна бригада (107 реабр, 148 оабр)
// і скільки з цього на виконавців РУК та ГРВ. Логіка живе в legacy-сторінці rocket.html, тому чисті
// функції дістаються з її тексту й виконуються ізольовано. Дані лише синтетичні.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../src/rocket.html', import.meta.url), 'utf8');

function take(re, label) {
  const m = html.match(re);
  assert.ok(m, `rocket.html: не знайдено ${label}`);
  return m[0];
}

const code = [
  take(/const NONE = new Set\([^\n]*\n/, 'NONE'),
  take(/const LAT2UK = \{[^\n]*\n/, 'LAT2UK'),
  take(/const crewKey = [^\n]*\n/, 'crewKey'),
  take(/const brigadeKey = [^\n]*\n/, 'brigadeKey'),
  take(/const FIRE_CREWS = [^\n]*\n/, 'FIRE_CREWS'),
  take(/function fireByBrigade\(rows\) \{[\s\S]*?\n\}\n/, 'fireByBrigade'),
  take(/const LAY_IDS = \[[^\n]*\n/, 'LAY_IDS'),
  take(/const LAY_MAXCOLS = [^\n]*\n/, 'LAY_MAXCOLS'),
  take(/const layDefault = \(\) => \(\{ rows: \[[\s\S]*?\], h: \{\} \}\);\n/, 'layDefault'),
  take(/function layValid\(m\) \{[\s\S]*?\n\}\n/, 'layValid'),
  take(/function layUpgrade\(m\) \{[\s\S]*?\n\}\n/, 'layUpgrade')
].join('');
const api = vm.runInNewContext(`${code}; ({ crewKey, brigadeKey, fireByBrigade, layDefault, layValid, layUpgrade, LAY_IDS })`);

// Об'єкти з vm мають інший Object.prototype, тому для deepEqual їх спершу переводимо в звичайний JSON.
const J = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const row = (firingUnit, crew, count) => ({ firingUnit: api.brigadeKey(firingUnit), crew: api.crewKey(crew), count });

test('виконавець: РУК і ГРВ приводяться до одного запису незалежно від регістру, пробілів і латиниці', () => {
  assert.equal(api.crewKey('РУК'), 'РУК');
  assert.equal(api.crewKey(' рук '), 'РУК');
  assert.equal(api.crewKey('грв'), 'ГРВ');
  assert.equal(api.crewKey('PУК'), 'РУК', 'латинська P замість кириличної Р');
  assert.equal(api.crewKey('PYK'), 'РУК');
  assert.equal(api.crewKey(''), '');
  assert.equal(api.crewKey(null), '');
  assert.equal(api.crewKey('—'), '');
});

test('вогнева бригада: «УДШВ 148оабр», «УДШВ 148 оабр» і «148 ОАБР» — одна бригада', () => {
  assert.equal(api.brigadeKey('УДШВ 148оабр'), '148 оабр');
  assert.equal(api.brigadeKey('УДШВ 148 оабр'), '148 оабр');
  assert.equal(api.brigadeKey('148   ОАБР'), '148 оабр');
  assert.equal(api.brigadeKey('УДШВ 107 реабр'), '107 реабр');
  assert.equal(api.brigadeKey('Тестова ВБр'), 'Тестова ВБр', 'без номера лишається як є');
  assert.equal(api.brigadeKey(''), '');
  assert.equal(api.brigadeKey(undefined), '');
});

test('зведення по бригадах: БП й операції по РУК, ГРВ та решті, сума збігається із загальною', () => {
  const rows = [
    row('УДШВ 148 оабр', 'РУК', 6), row('УДШВ 148оабр', 'ГРВ', 4), row('УДШВ 148 оабр', 'руК', 2),
    row('УДШВ 107 реабр', 'ГРВ', 5), row('УДШВ 107 реабр', 'РУК', 1),
    row('УДШВ 107 реабр', 'ЗСУ', 3), row('', '', 7), row('УДШВ 148 оабр', 'ГРВ', '3')
  ];
  const out = J(api.fireByBrigade(rows));
  assert.deepEqual(out.map(g => g.key), ['148 оабр', '107 реабр', 'Не вказано'], 'за БП спадно, «Не вказано» — останнім');
  const [a, b, none] = out;
  assert.deepEqual({ n: a.n, mun: a.mun }, { n: 4, mun: 15 });
  assert.deepEqual(a.by['РУК'], { n: 2, mun: 8 });
  assert.deepEqual(a.by['ГРВ'], { n: 2, mun: 7 }, 'рядкове число «3» теж рахується');
  assert.deepEqual(a.by.other, { n: 0, mun: 0 });
  assert.deepEqual({ n: b.n, mun: b.mun }, { n: 3, mun: 9 });
  assert.deepEqual(b.by.other, { n: 1, mun: 3 }, 'чужий виконавець іде в «інші»');
  assert.deepEqual({ n: none.n, mun: none.mun }, { n: 1, mun: 7 });
  assert.deepEqual(none.by.other, { n: 1, mun: 7 });
  assert.equal(out.reduce((s, g) => s + g.mun, 0), rows.reduce((s, r) => s + (+r.count || 0), 0));
  for (const g of out) assert.equal(g.mun, g.by['РУК'].mun + g.by['ГРВ'].mun + g.by.other.mun, `${g.key}: частини дорівнюють цілому`);
});

test('зведення по бригадах: порожні дані й рядки без кількості не ламають підрахунок', () => {
  assert.deepEqual(J(api.fireByBrigade([])), []);
  const out = J(api.fireByBrigade([row('148 оабр', 'РУК', undefined), row('148 оабр', 'ГРВ', 'x')]));
  assert.equal(out.length, 1);
  assert.deepEqual({ n: out[0].n, mun: out[0].mun }, { n: 2, mun: 0 });
});

test('модель рядка несе виконавця й бригаду, розрізи «Докладніше» їх знають', () => {
  const build = html.slice(html.indexOf('function buildModel(records)'));
  assert.match(build.slice(0, 3000), /crew: crewKey\(r\.crew\), firingUnit: brigadeKey\(r\.firingUnit\),/);
  assert.match(html, /firingUnit: \{ label: 'Вогнева бригада', keys: r => \[r\.firingUnit \|\| 'Не вказано'\] \}/);
  assert.match(html, /crew: \{ label: 'Виконавець \(РУК \/ ГРВ\)', keys: r => \[r\.crew \|\| 'Не вказано'\] \}/);
  assert.match(html, /\['p-fire', 'units', 'firingUnit'\]/, '«Докладніше →» відкриває розріз за бригадами');
  assert.match(html, /\['units', 'Вогневі бригади', 'shield', 'firingUnit'\], \['units', 'Виконавці', 'rocket', 'crew'\]/, 'вкладки розрізів у «Докладніше»');
});

test('панель p-fire є в зведенні, малюється при кожному рендері й має стилі', () => {
  assert.match(html, /panel\('Вогневі бригади', el\.fire, el\.fireSub, '', 'p-fire'\)/);
  assert.match(html, /renderPlatPanel\(A\);\n  renderMunPanel\(A\);\n  renderFirePanel\(A\);\n/);
  assert.match(html, /function renderFirePanel\(A\) \{/);
  assert.match(html, /<style id="fire-brigades-css">/);
  assert.match(html, /\.fb-card\[role="button"\]:hover/);
});

test('розташування блоків: p-fire у типовій розкладці під плитками «Ракетні удари»', () => {
  assert.ok(api.LAY_IDS.includes('p-fire'));
  const def = api.layDefault();
  assert.ok(api.layValid(def), 'типова розкладка проходить перевірку');
  const at = id => def.rows.findIndex(r => r.cols.some(c => c.cards.includes(id)));
  assert.equal(at('p-fire'), at('p-kpis') + 1);
});

test('розташування блоків: збережена розкладка без p-fire не скидається, а отримує новий рядок', () => {
  const legacy = api.layDefault();
  legacy.rows = legacy.rows.filter(r => !r.cols.some(c => c.cards.includes('p-fire')));
  legacy.rows[0].cols[0].w = 3.1; // власне налаштування користувача
  assert.equal(api.layValid(legacy), false, 'без p-fire стара розкладка недійсна');
  const up = J(api.layUpgrade(JSON.parse(JSON.stringify(legacy))));
  assert.ok(api.layValid(up), 'після оновлення розкладка дійсна');
  assert.equal(up.rows[0].cols[0].w, 3.1, 'налаштування користувача збережено');
  const at = id => up.rows.findIndex(r => r.cols.some(c => c.cards.includes(id)));
  assert.equal(at('p-fire'), at('p-kpis') + 1);
  assert.deepEqual(J(api.layUpgrade(JSON.parse(JSON.stringify(up)))), up, 'повторне оновлення нічого не змінює');
  assert.equal(api.layUpgrade(null), null);
  assert.equal(api.layUpgrade('x'), 'x');
  assert.deepEqual(J(api.layUpgrade({ rows: 5 })), { rows: 5 });
});

test('розташування блоків: без p-kpis новий рядок іде під p-mun, а якщо немає й його — в кінець', () => {
  const noKpis = { rows: [{ cols: [{ w: 1, cards: ['p-map'] }] }, { cols: [{ w: 1, cards: ['p-mun'] }] }, { cols: [{ w: 1, cards: ['p-ops'] }] }] };
  assert.deepEqual(J(api.layUpgrade(noKpis)).rows.map(r => r.cols[0].cards[0]), ['p-map', 'p-mun', 'p-fire', 'p-ops']);
  const bare = { rows: [{ cols: [{ w: 1, cards: ['p-ops'] }] }] };
  assert.deepEqual(J(api.layUpgrade(bare)).rows.map(r => r.cols[0].cards[0]), ['p-ops', 'p-fire']);
});
