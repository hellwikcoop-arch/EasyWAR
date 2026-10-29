// РВ, «Зведення»: блок «Вогневі бригади» — скільки БП випустила кожна бригада (107 реабр, 148 оабр)
// і скільки з цього на підрозділи 7, 8 і 9 реабатр (перелік змінюється в картці й зберігається). Логіка живе в legacy-сторінці rocket.html, тому чисті
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
  'const mem = {}; function store(k, v) { if (v === undefined) return k in mem ? mem[k] : null; mem[k] = v; return null; }\n',
  take(/const FIRE_CREWS_DEFAULT = [\s\S]*?function fireByBrigade\(rows, crews\) \{[\s\S]*?\n\}\n/, 'FIRE_CREWS_DEFAULT…fireByBrigade'),
  take(/const LAY_IDS = \[[^\n]*\n/, 'LAY_IDS'),
  take(/const LAY_MAXCOLS = [^\n]*\n/, 'LAY_MAXCOLS'),
  take(/const layDefault = \(\) => \(\{ rows: \[[\s\S]*?\], h: \{\} \}\);\n/, 'layDefault'),
  take(/function layValid\(m\) \{[\s\S]*?\n\}\n/, 'layValid'),
  take(/function layUpgrade\(m\) \{[\s\S]*?\n\}\n/, 'layUpgrade')
].join('');
const api = vm.runInNewContext(`${code}; ({ mem, store, crewCmp, cleanFireCrews, loadFireCrews, saveFireCrews, FIRE_CREWS_KEY, FIRE_CREWS_DEFAULT, get crews() { return FIRE_CREWS; }, crewKey, brigadeKey, fireByBrigade, layDefault, layValid, layUpgrade, LAY_IDS })`);

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

test('підрозділи за замовчуванням — 7, 8 і 9 реабатр', () => {
  assert.deepEqual(J(api.crews), ['7 реабатр', '8 реабатр', '9 реабатр']);
  assert.deepEqual(J(api.loadFireCrews()), ['7 реабатр', '8 реабатр', '9 реабатр']);
});

test('зведення по бригадах: БП й операції по 7/8/9 реабатр та решті, сума збігається із загальною', () => {
  const rows = [
    row('УДШВ 148 оабр', '7 реабатр', 6), row('УДШВ 148оабр', '8 РЕАБАТР', 4), row('УДШВ 148 оабр', '7реабатр', 2),
    row('УДШВ 107 реабр', '9 реабатр', 5), row('УДШВ 107 реабр', '7 реабатр', 1),
    row('УДШВ 107 реабр', 'ЗСУ', 3), row('', '', 7), row('УДШВ 148 оабр', '8 реабатр', '3')
  ];
  const out = J(api.fireByBrigade(rows));
  assert.deepEqual(out.map(g => g.key), ['148 оабр', '107 реабр', 'Не вказано'], 'за БП спадно, «Не вказано» — останнім');
  const [a, b, none] = out;
  assert.deepEqual({ n: a.n, mun: a.mun }, { n: 4, mun: 15 });
  assert.deepEqual(a.by, [{ n: 2, mun: 8 }, { n: 2, mun: 7 }, { n: 0, mun: 0 }], 'рядкове число «3» теж рахується; регістр і пробіли не мають значення');
  assert.deepEqual(a.other, { n: 0, mun: 0 });
  assert.deepEqual({ n: b.n, mun: b.mun }, { n: 3, mun: 9 });
  assert.deepEqual(b.by, [{ n: 1, mun: 1 }, { n: 0, mun: 0 }, { n: 1, mun: 5 }]);
  assert.deepEqual(b.other, { n: 1, mun: 3 }, 'чужий підрозділ іде в «інші»');
  assert.deepEqual({ n: none.n, mun: none.mun }, { n: 1, mun: 7 });
  assert.deepEqual(none.other, { n: 1, mun: 7 });
  assert.equal(out.reduce((s, g) => s + g.mun, 0), rows.reduce((s, r) => s + (+r.count || 0), 0));
  for (const g of out) assert.equal(g.mun, g.by.reduce((s, c) => s + c.mun, 0) + g.other.mun, `${g.key}: частини дорівнюють цілому`);
});

test('зведення по бригадах: власний перелік підрозділів (у т.ч. старі РУК / ГРВ) працює так само', () => {
  const rows = [row('148 оабр', 'РУК', 2), row('148 оабр', 'грв', 3), row('148 оабр', '7 реабатр', 4)];
  const [g] = J(api.fireByBrigade(rows, ['РУК', 'ГРВ']));
  assert.deepEqual(g.by, [{ n: 1, mun: 2 }, { n: 1, mun: 3 }]);
  assert.deepEqual(g.other, { n: 1, mun: 4 });
  const [h] = J(api.fireByBrigade(rows, []));
  assert.deepEqual(h.by, []);
  assert.deepEqual(h.other, { n: 3, mun: 9 }, 'порожній перелік: усе в «інші»');
});

test('перелік підрозділів: чиститься, зберігається й відновлюється', () => {
  assert.deepEqual(J(api.cleanFireCrews([' 7  реабатр ', '7РЕАБАТР', '', null, 'РУК'])), ['7 реабатр', 'РУК'], 'дублікати за ключем і порожні відкидаються');
  assert.deepEqual(J(api.cleanFireCrews('x')), []);
  assert.equal(api.cleanFireCrews(Array.from({ length: 20 }, (_, i) => 'п' + i)).length, 8, 'не більше 8 рядків');
  assert.equal(api.cleanFireCrews(['а'.repeat(60)])[0].length, 24, 'назва обрізається до 24 символів');
  assert.deepEqual(J(api.saveFireCrews(['10 реабатр', 'ГРВ'])), ['10 реабатр', 'ГРВ']);
  assert.deepEqual(J(api.crews), ['10 реабатр', 'ГРВ']);
  assert.deepEqual(JSON.parse(api.mem[api.FIRE_CREWS_KEY]), ['10 реабатр', 'ГРВ']);
  assert.deepEqual(J(api.loadFireCrews()), ['10 реабатр', 'ГРВ'], 'після перезавантаження сторінки перелік той самий');
  assert.deepEqual(J(api.saveFireCrews([' ', ''])), ['7 реабатр', '8 реабатр', '9 реабатр'], 'порожній перелік повертає типовий');
  api.mem[api.FIRE_CREWS_KEY] = '{зіпсовано';
  assert.deepEqual(J(api.loadFireCrews()), ['7 реабатр', '8 реабатр', '9 реабатр'], 'зіпсоване сховище не ламає картку');
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
  assert.match(html, /crew: \{ label: 'Підрозділ \(від кого машина\)', keys: r => \[r\.crew \|\| 'Не вказано'\] \}/);
  assert.match(html, /\['p-fire', 'units', 'firingUnit'\]/, '«Докладніше →» відкриває розріз за бригадами');
  assert.match(html, /\['units', 'Вогневі бригади', 'shield', 'firingUnit'\], \['units', 'Підрозділи \(машини\)', 'rocket', 'crew'\]/, 'вкладки розрізів у «Докладніше»');
});

test('панель p-fire є в зведенні, малюється при кожному рендері й має стилі', () => {
  assert.match(html, /panel\('Вогневі бригади', el\.fire, el\.fireSub, '', 'p-fire'\)/);
  assert.match(html, /renderPlatPanel\(A\);\n  renderMunPanel\(A\);\n  renderFirePanel\(A\);\n/);
  assert.match(html, /function renderFirePanel\(A\) \{/);
  assert.match(html, /<style id="fire-brigades-css">/);
  assert.match(html, /\.fb-card\[role="button"\]:hover/);
});

test('картка має редактор підрозділів: кнопка «Змінити», збереження, скидання, Escape', () => {
  assert.match(html, /function fireCrewTools\(A\) \{/);
  assert.match(html, /box\.append\(fireCrewTools\(A\)\);/, 'редактор доступний і коли даних за період немає');
  assert.match(html, /'Змінити'\)\);/);
  assert.match(html, /saveFireCrews\(read\(\)\)/);
  assert.match(html, /'7 \/ 8 \/ 9 за замовчуванням'/);
  assert.match(html, /e\.key === 'Escape'/);
  assert.match(html, /\.fb-edit \{/);
  assert.doesNotMatch(html, /crewRow\('РУК'|crewRow\('ГРВ'|fb-ruk|fb-grv/, 'жорстко закодованих РУК / ГРВ у картці більше немає');
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
