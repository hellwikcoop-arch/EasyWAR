import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { addSource, confirmBinding, emptySchema } from '../src/profile-schema-core.js';
import {
  CARDINALITY_LABELS,
  LINK_LIMITS,
  candidateKeys,
  canonicalDate,
  connectedGroups,
  describeCandidate,
  evaluateKey,
  keyConflicts,
  linkIssues,
  suggestRelations,
  tableFromSchema,
} from '../src/table-link-core.js';

// Лише синтетичні дані: вигадані підрозділи й числа, жодних реальних таблиць.

const UNITS = ['Альфа', 'Браво', 'Чарлі', 'Дельта', 'Ехо', 'Фокстрот'];
const day = n => `2026-09-${String(1 + (n % 28)).padStart(2, '0')}`;

function build(specs) {
  let schema = emptySchema('profile-test');
  for (const spec of specs) {
    const added = addSource(schema, { id: spec.id, type: 'module-table', ref: spec.id, title: spec.title || spec.id, columns: spec.columns });
    assert.ok(added.ok, added.message);
    schema = added.schema;
    for (const [role, columnKey] of Object.entries(spec.roles || {})) {
      const bound = confirmBinding(schema, { sourceId: spec.id, columnKey, role });
      assert.ok(bound.ok, bound.message);
      schema = bound.schema;
    }
  }
  const tables = specs.map(spec => {
    const made = tableFromSchema(schema, spec.id, spec.rows, { truncated: spec.truncated === true });
    assert.ok(made.ok, made.message);
    return made.table;
  });
  return { schema, tables };
}

const col = (key, header, type = 'text') => ({ key, header, type });

// План на добу: один рядок на пару (дата, підрозділ). Вильоти: багато рядків на ту саму пару.
function planAndFlights({ days = 6 } = {}) {
  const plan = [];
  const flights = [];
  for (let d = 0; d < days; d += 1) {
    for (const unit of UNITS.slice(0, 4)) {
      plan.push({ date: day(d), unit, goal: `ціль-${d}-${unit}` });
      for (let k = 0; k < 2; k += 1) flights.push({ event: day(d), part: unit, tail: `${100 + flights.length}` });
    }
  }
  return [
    { id: 'module:plan', title: 'План', rows: plan, columns: [col('date', 'Дата', 'date'), col('unit', 'Підрозділ'), col('goal', 'Ціль')], roles: { 'event-date': 'date', unit: 'unit' } },
    { id: 'module:flights', title: 'Вильоти', rows: flights, columns: [col('event', 'Дата події', 'date'), col('part', 'Частина'), col('tail', 'Борт')], roles: { 'event-date': 'event', unit: 'part' } },
  ];
}

test('canonicalDate розпізнає формати й відкидає неіснуючі дати', () => {
  assert.deepEqual(canonicalDate('2026-09-05'), { iso: '2026-09-05', format: 'iso' });
  assert.deepEqual(canonicalDate('2026-09-05T10:20:30Z'), { iso: '2026-09-05', format: 'iso' });
  assert.deepEqual(canonicalDate('5.9.2026'), { iso: '2026-09-05', format: 'dmy-dot' });
  assert.deepEqual(canonicalDate('05/09/2026'), { iso: '2026-09-05', format: 'dmy-slash' });
  assert.deepEqual(canonicalDate('05-09-2026 14:30'), { iso: '2026-09-05', format: 'dmy-dash' });
  assert.deepEqual(canonicalDate('2026.09.05'), { iso: '2026-09-05', format: 'ymd-dot' });
  assert.equal(canonicalDate('31.02.2026'), null);
  assert.equal(canonicalDate('вчора'), null);
  assert.equal(canonicalDate(''), null);
  assert.equal(canonicalDate(null), null);
});

test('ключ за підтвердженими ролями: дата + підрозділ, 1 : N, заголовки різні', () => {
  const { tables } = build(planAndFlights());
  const result = candidateKeys(tables[0], tables[1]);
  assert.ok(result.ok);
  const best = result.candidates[0];
  assert.equal(best.basis, 'roles');
  assert.deepEqual(best.left.columns.slice().sort(), ['date', 'unit']);
  assert.deepEqual(best.right.columns.slice().sort(), ['event', 'part']);
  assert.equal(best.cardinality, 'one-many');
  assert.equal(best.uniqueLeft, true);
  assert.equal(best.uniqueRight, false);
  assert.equal(best.containment, 1);
  assert.equal(best.complete, true);
  assert.equal(best.commonKeys, 24);
  // Парність стовпців: «Дата» ↔ «Дата події», «Підрозділ» ↔ «Частина».
  best.left.columns.forEach((key, index) => {
    assert.equal(key === 'date', best.right.columns[index] === 'event');
  });
  assert.match(describeCandidate(best), /1 : N · збіг 100 %/u);
});

test('сама дата чи сам підрозділ не є унікальним ключем, тож окремо не пропонуються', () => {
  const { tables } = build(planAndFlights());
  const { candidates } = candidateKeys(tables[0], tables[1]);
  assert.ok(candidates.every(item => item.left.columns.length === 2), JSON.stringify(candidates.map(item => item.left.columns)));
});

test('кардинальність: 1 : 1, 1 : N, N : 1', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `Б-${100 + i}`);
  const a = ids.map((id, i) => ({ id, name: `Борт ${i}` }));
  const bOne = ids.map((id, i) => ({ ref: id, hours: String(i) }));
  const bMany = ids.flatMap((id, i) => [{ ref: id, hours: String(i) }, { ref: id, hours: String(i + 50) }]);
  const columnsA = [col('id', 'Номер борту'), col('name', 'Назва')];
  const columnsB = [col('ref', 'Борт'), col('hours', 'Наліт')];
  const one = build([{ id: 'a', rows: a, columns: columnsA }, { id: 'b', rows: bOne, columns: columnsB }]).tables;
  const many = build([{ id: 'a', rows: a, columns: columnsA }, { id: 'b', rows: bMany, columns: columnsB }]).tables;
  const first = candidateKeys(one[0], one[1]).candidates[0];
  assert.deepEqual([first.left.columns, first.right.columns, first.cardinality], [['id'], ['ref'], 'one-one']);
  const second = candidateKeys(many[0], many[1]).candidates[0];
  assert.equal(second.cardinality, 'one-many');
  const swapped = candidateKeys(many[1], many[0]).candidates[0];
  assert.equal(swapped.cardinality, 'many-one');
  assert.equal(CARDINALITY_LABELS[swapped.cardinality], 'N : 1');
});

test('трійка стовпців без ролей: перебір не обривається на коротких наборах', () => {
  // Вісім комбінацій трьох двійкових стовпців: жоден стовпець чи пара не унікальні, унікальна лише трійка.
  const rows = [];
  for (let n = 0; n < 8; n += 1) rows.push({ a: n & 1 ? 'так' : 'ні', b: n & 2 ? 'так' : 'ні', c: n & 4 ? 'так' : 'ні', v: String(n) });
  const columns = [col('a', 'Ознака 1'), col('b', 'Ознака 2'), col('c', 'Ознака 3'), col('v', 'Значення')];
  const { tables } = build([{ id: 'x', rows, columns }, { id: 'y', rows: rows.map(row => ({ ...row })), columns }]);
  const { candidates } = candidateKeys(tables[0], tables[1]);
  const triple = candidates.find(item => item.left.columns.length === 3);
  assert.ok(triple, JSON.stringify(candidates.map(item => item.left.columns)));
  assert.deepEqual(triple.left.columns.slice().sort(), ['a', 'b', 'c']);
  assert.equal(triple.basis, 'values');
  assert.equal(triple.cardinality, 'one-one');
});

test('трійка не губиться, коли пар стовпців більше за ліміт пулу; про обрізання повідомлено', () => {
  const rows = [];
  for (let n = 0; n < 8; n += 1) {
    const row = { a: n & 1 ? 'так' : 'ні', b: n & 2 ? 'так' : 'ні', c: n & 4 ? 'так' : 'ні' };
    // Багато двійкових «відволікаючих» стовпців, що проходять поріг збігу.
    for (let d = 0; d < 14; d += 1) row[`d${d}`] = (n >> (d % 3)) & 1 ? 'x' : 'y';
    rows.push(row);
  }
  const leftColumns = [col('a', 'Ознака 1'), col('b', 'Ознака 2'), col('c', 'Ознака 3'), ...Array.from({ length: 14 }, (_, d) => col(`d${d}`, `Л-${d}`))];
  const rightColumns = [col('a', 'Ознака 1'), col('b', 'Ознака 2'), col('c', 'Ознака 3'), ...Array.from({ length: 14 }, (_, d) => col(`d${d}`, `П-${d}`))];
  const { tables } = build([{ id: 'x', rows, columns: leftColumns }, { id: 'y', rows: rows.map(row => ({ ...row })), columns: rightColumns }]);
  const result = candidateKeys(tables[0], tables[1]);
  assert.ok(result.notes.some(note => note.code === 'pairs-limited'), JSON.stringify(result.notes));
  // Двійкові стовпці взаємозамінні за значеннями; збіг заголовків ставить справжню відповідність a↔a, b↔b, c↔c
  // на початок пулу й на початок списку.
  const first = result.candidates[0];
  assert.equal(first.left.columns.length, 3);
  assert.deepEqual(first.left.columns, first.right.columns);
  assert.equal(first.sameHeaders, 3);
});

test('дублікати з обох боків: автоматично ключа немає, ручна оцінка дає N : M', () => {
  const rows = [];
  for (let d = 0; d < 6; d += 1) for (let k = 0; k < 3; k += 1) rows.push({ day: day(d), unit: UNITS[d % 3], n: String(k) });
  const same = rows.map(row => ({ ...row }));
  const columns = [col('day', 'Доба', 'date'), col('unit', 'Підрозділ'), col('n', 'Запис')];
  // Без стовпця `n` будь-який ключ має повтори в обох таблицях.
  const { tables } = build([
    { id: 'x', rows, columns: columns.slice(0, 2) },
    { id: 'y', rows: same, columns: columns.slice(0, 2) },
  ]);
  const result = candidateKeys(tables[0], tables[1]);
  assert.deepEqual(result.candidates, []);
  const manual = evaluateKey(tables[0], tables[1], ['day', 'unit'], ['day', 'unit']);
  assert.ok(manual.ok);
  assert.equal(manual.cardinality, 'many-many');
  assert.equal(manual.uniqueLeft, false);
  assert.equal(evaluateKey(tables[0], tables[1], ['day'], []).code, 'bad_key');
  assert.equal(evaluateKey(tables[0], tables[1], ['nope'], ['day']).code, 'bad_key');
});

test('порядкові номери 1..N не вважаються ключем між таблицями', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ nr: String(i + 1), tag: `Т-${i}` }));
  const other = Array.from({ length: 20 }, (_, i) => ({ list: i + 1, mark: `М-${i}` }));
  const { tables } = build([
    { id: 'x', rows, columns: [col('nr', 'Номер за списком', 'number'), col('tag', 'Позначка')] },
    { id: 'y', rows: other, columns: [col('list', 'Номер за списком', 'number'), col('mark', 'Мітка')] },
  ]);
  assert.deepEqual(candidateKeys(tables[0], tables[1]).candidates, []);
});

test('кількість боєприпасів — міра, а не ключ, навіть якщо значення збігаються', () => {
  const left = Array.from({ length: 10 }, (_, i) => ({ k: `К-${i}`, count: (i + 2) * 3 }));
  const right = Array.from({ length: 10 }, (_, i) => ({ q: `Н-${i}`, amount: (i + 2) * 3 }));
  const { tables } = build([
    { id: 'x', rows: left, columns: [col('k', 'Код'), col('count', 'Кількість БП', 'number')], roles: { 'munition-count': 'count' } },
    { id: 'y', rows: right, columns: [col('q', 'Номер'), col('amount', 'Кількість БП', 'number')], roles: { 'munition-count': 'amount' } },
  ]);
  assert.deepEqual(candidateKeys(tables[0], tables[1]).candidates, []);
});

test('усічене читання: кандидат неповний, питання про це є, підпис попереджає', () => {
  const specs = planAndFlights();
  specs[1].truncated = true;
  const { tables } = build(specs);
  const { candidates } = candidateKeys(tables[0], tables[1]);
  assert.ok(candidates.length);
  assert.equal(candidates[0].complete, false);
  assert.match(describeCandidate(candidates[0]), /перевірено не на всіх рядках/u);
  const issues = linkIssues(tables[0], tables[1], candidates[0]);
  assert.ok(issues.some(issue => issue.kind === 'truncated' && issue.side === 'right'));
  assert.ok(!issues.some(issue => issue.kind === 'truncated' && issue.side === 'left'));
});

test('понад ліміт рядків: читається початок і таблиця вважається усіченою', () => {
  const rows = Array.from({ length: LINK_LIMITS.maxRows + 50 }, (_, i) => ({ k: `К-${i}`, v: String(i % 7) }));
  const columns = [col('k', 'Код'), col('v', 'Група')];
  const { tables } = build([{ id: 'x', rows, columns }, { id: 'y', rows: rows.slice(0, 500), columns }]);
  const { candidates } = candidateKeys(tables[0], tables[1]);
  assert.ok(candidates.length);
  assert.equal(candidates[0].rowsLeft, LINK_LIMITS.maxRows);
  assert.equal(candidates[0].complete, false);
});

test('різні формати дат: збіг знайдено, розбіжність формату названо', () => {
  const dates = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  const left = dates.map((date, i) => ({ date, note: `Л-${i}` }));
  const right = dates.map((date, i) => ({ when: `${date.slice(8)}.09.2026`, text: `П-${i}` }));
  const { tables } = build([
    { id: 'x', rows: left, columns: [col('date', 'Дата', 'date'), col('note', 'Запис')], roles: { 'event-date': 'date' } },
    { id: 'y', rows: right, columns: [col('when', 'Дата події', 'date'), col('text', 'Текст')], roles: { 'event-date': 'when' } },
  ]);
  const { candidates } = candidateKeys(tables[0], tables[1]);
  assert.equal(candidates[0].containment, 1);
  assert.equal(candidates[0].basis, 'roles');
  const issues = linkIssues(tables[0], tables[1], candidates[0]);
  const mismatch = issues.find(issue => issue.kind === 'date-format-mismatch');
  assert.deepEqual([mismatch.leftFormat, mismatch.rightFormat], ['iso', 'dmy-dot']);
});

test('змішані формати в одному стовпці й нерозпізнані дати — питання «формат дат»', () => {
  const left = [
    { date: '2026-09-01', v: 'а' }, { date: '02.09.2026', v: 'б' }, { date: '2026-09-03', v: 'в' },
    { date: '31.02.2026', v: 'г' }, { date: '2026-09-05', v: 'д' }, { date: '2026-09-06', v: 'е' },
  ];
  const right = left.map(row => ({ ...row }));
  const columns = [col('date', 'Дата', 'date'), col('v', 'Позначка')];
  const { tables } = build([{ id: 'x', rows: left, columns }, { id: 'y', rows: right, columns }]);
  const candidate = candidateKeys(tables[0], tables[1]).candidates.find(item => item.left.columns[0] === 'date');
  const issue = linkIssues(tables[0], tables[1], candidate).find(item => item.kind === 'date-format' && item.side === 'left');
  assert.ok(issue);
  assert.equal(issue.unparsed, 1);
  assert.deepEqual(issue.formats.map(item => item.format).sort(), ['dmy-dot', 'iso']);
});

test('невпізнаний заголовок і неоднозначний стовпець ключа потрапляють у питання', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ code: `К-${i}`, tail: `Б-${i}` }));
  const { tables } = build([
    { id: 'x', rows, columns: [col('code', 'Шифр'), col('tail', 'Борт')] },
    { id: 'y', rows: rows.map(row => ({ ...row })), columns: [col('code', 'Шифр'), col('tail', 'Борт')] },
  ]);
  const candidate = candidateKeys(tables[0], tables[1]).candidates[0];
  const kinds = linkIssues(tables[0], tables[1], candidate).map(issue => issue.kind);
  assert.ok(kinds.includes('unknown-header'));
  // Повністю збіжні множини ключів: ключів без пари немає.
  assert.ok(!kinds.includes('unmatched-keys'));
  const ambiguous = JSON.parse(JSON.stringify(tables));
  ambiguous[0].columns[0].decision = 'ambiguous';
  assert.ok(linkIssues(ambiguous[0], ambiguous[1], candidate).some(issue => issue.kind === 'ambiguous-column'));
});

test('ключі без пари називаються з обох боків', () => {
  const left = Array.from({ length: 10 }, (_, i) => ({ k: `К-${i}`, v: 'а' }));
  const right = Array.from({ length: 10 }, (_, i) => ({ k: `К-${i + 1}`, v: 'б' }));
  const columns = [col('k', 'Код'), col('v', 'Позначка')];
  const { tables } = build([{ id: 'x', rows: left, columns }, { id: 'y', rows: right, columns }]);
  const candidate = candidateKeys(tables[0], tables[1]).candidates[0];
  assert.equal(candidate.containment, 0.9);
  const issue = linkIssues(tables[0], tables[1], candidate).find(item => item.kind === 'unmatched-keys');
  assert.deepEqual([issue.onlyLeft, issue.onlyRight], [1, 1]);
});

test('порожні й різнорегістрові ключі, лапки та пробіли не заважають збігу', () => {
  const names = ["Мар'їнка", 'Київ', 'Львів', 'Одеса', 'Харків', 'Суми', 'Полтава', 'Дніпро'];
  const left = names.map((name, i) => ({ name, id: `Л-${i}` }));
  const right = names.map((name, i) => ({ place: i === 0 ? "  МАР’ЇНКА " : ` ${name.toUpperCase()}`, mark: `П-${i}` }));
  const { tables } = build([
    { id: 'x', rows: left, columns: [col('name', 'Місце'), col('id', 'Код')] },
    { id: 'y', rows: right, columns: [col('place', 'Місце'), col('mark', 'Мітка')] },
  ]);
  const first = candidateKeys(tables[0], tables[1]).candidates.find(item => item.left.columns[0] === 'name');
  assert.ok(first);
  assert.equal(first.containment, 1);
});

test('стовпець із надто багатьма порожніми клітинками не стає ключем', () => {
  const left = Array.from({ length: 10 }, (_, i) => ({ k: i < 5 ? '' : `К-${i}`, v: String(i % 2) }));
  const right = Array.from({ length: 10 }, (_, i) => ({ k: i < 5 ? '' : `К-${i}`, v: String(i % 2) }));
  const columns = [col('k', 'Код'), col('v', 'Парність')];
  const { tables } = build([{ id: 'x', rows: left, columns }, { id: 'y', rows: right, columns }]);
  assert.deepEqual(candidateKeys(tables[0], tables[1]).candidates, []);
});

test('різні значення для одного ключа: лічильники й приклади, порожнє — не конфлікт', () => {
  const left = Array.from({ length: 6 }, (_, i) => ({ target: `Ц-${i}`, result: i === 2 ? 'Уражено' : 'Пошкоджено', note: 'а' }));
  const right = [
    { id: 'Ц-0', res: 'Пошкоджено' }, { id: 'Ц-1', res: 'Не уражено' }, { id: 'Ц-2', res: 'Уражено' },
    { id: 'Ц-3', res: '' }, { id: 'Ц-4', res: 'Уражено' }, { id: 'Ц-5', res: 'Пошкоджено' },
    { id: 'Ц-1', res: 'Не уражено' },
  ];
  const { tables } = build([
    { id: 'x', rows: left, columns: [col('target', 'Номер цілі'), col('result', 'Результат'), col('note', 'Примітка')], roles: { 'target-id': 'target', 'strike-result': 'result' } },
    { id: 'y', rows: right, columns: [col('id', '№ цілі'), col('res', 'Результат ураження')], roles: { 'target-id': 'id', 'strike-result': 'res' } },
  ]);
  const candidate = candidateKeys(tables[0], tables[1]).candidates[0];
  assert.equal(candidate.cardinality, 'one-many');
  const conflicts = keyConflicts(tables[0], tables[1], candidate);
  assert.ok(conflicts.ok);
  assert.equal(conflicts.totals.length, 1);
  // Ц-1 (двічі в правій) і Ц-4 розходяться; Ц-3 порожній — пропущено.
  assert.equal(conflicts.total, 3);
  assert.equal(conflicts.totals[0].compared, 6);
  assert.deepEqual(conflicts.examples.map(item => item.key).sort(), ['ц-1', 'ц-1', 'ц-4']);
  const limited = keyConflicts(tables[0], tables[1], candidate, { limit: 1 });
  assert.equal(limited.examples.length, 1);
  assert.equal(limited.total, 3);
  // Явна пара стовпців, яких немає, — помилка, а не мовчазна відсутність конфліктів.
  assert.equal(keyConflicts(tables[0], tables[1], candidate, { columnPairs: [['result', 'nope']] }).code, 'bad_pair');
});

test('keyConflicts без унікального боку відмовляє', () => {
  const { tables } = build(planAndFlights());
  assert.equal(keyConflicts(tables[0], tables[1], { uniqueLeft: false, uniqueRight: false, left: { columns: [] }, right: { columns: [] } }).code, 'no_unique_side');
});

test('suggestRelations: усі пари, межі кількості, скасування, tick', async () => {
  const specs = planAndFlights();
  const third = { id: 'module:third', rows: specs[0].rows.map(row => ({ d: row.date, u: row.unit })), columns: [col('d', 'Дата', 'date'), col('u', 'Підрозділ')], roles: { 'event-date': 'd', unit: 'u' } };
  const { tables } = build([...specs, third]);
  let ticks = 0;
  const result = await suggestRelations(tables, { tick: async () => { ticks += 1; } });
  assert.ok(result.ok);
  assert.equal(result.pairs.length, 3);
  assert.equal(ticks, 6, 'по одному кроку на профіль таблиці й на пару');
  assert.deepEqual(result.pairs.map(pair => [pair.leftId, pair.rightId]), [['module:plan', 'module:flights'], ['module:plan', 'module:third'], ['module:flights', 'module:third']]);
  assert.equal((await suggestRelations([tables[0]])).code, 'too_few_tables');
  assert.equal((await suggestRelations([tables[0], tables[0]])).code, 'duplicate_table');
  const many = Array.from({ length: LINK_LIMITS.maxTables + 1 }, (_, i) => ({ ...tables[0], sourceId: `s-${i}` }));
  assert.equal((await suggestRelations(many)).code, 'too_many_tables');
  const cancelled = await suggestRelations(tables, { cancelled: () => true });
  assert.equal(cancelled.code, 'cancelled');
});

test('connectedGroups: компоненти зв’язності, окрема таблиця — окрема група', () => {
  const groups = connectedGroups(['a', 'b', 'c', 'd', 'e'], [{ leftId: 'a', rightId: 'b' }, { leftId: 'b', rightId: 'c' }, { leftId: 'x', rightId: 'a' }]);
  assert.deepEqual(groups, [['a', 'b', 'c'], ['d'], ['e']]);
  assert.deepEqual(connectedGroups([], null), []);
});

test('вхідні дані не змінюються, а в кандидатах немає значень клітинок', () => {
  const specs = planAndFlights();
  specs[0].rows[0].goal = 'СЕКРЕТНЕ-ЗНАЧЕННЯ-КЛІТИНКИ';
  const { tables } = build(specs);
  const before = JSON.stringify(tables);
  const result = candidateKeys(tables[0], tables[1]);
  linkIssues(tables[0], tables[1], result.candidates[0]);
  assert.equal(JSON.stringify(tables), before);
  assert.ok(!JSON.stringify(result).includes('СЕКРЕТНЕ'));
  assert.ok(!JSON.stringify(result).includes('Альфа'));
});

test('синтетичний бюджет часу: 8 таблиць × 10 000 рядків × 20 стовпців, усі 28 пар', async () => {
  let seed = 11;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const columns = Array.from({ length: 20 }, (_, c) => col(`c${c}`, `Стовпець ${c}`, c === 1 ? 'date' : 'text'));
  const specs = Array.from({ length: LINK_LIMITS.maxTables }, (_, t) => ({
    id: `t${t}`,
    columns,
    rows: Array.from({ length: 10_000 }, (_, r) => Object.fromEntries(columns.map((column, c) => [column.key, c === 0 ? `ключ-${r}` : c === 1 ? day(Math.floor(random() * 28)) : c < 6 ? `v${Math.floor(random() * 10 ** (c - 1))}` : String(Math.floor(random() * 5000))]))),
  }));
  const { tables } = build(specs);
  const started = performance.now();
  const result = await suggestRelations(tables);
  const elapsed = performance.now() - started;
  assert.ok(result.ok);
  assert.equal(result.pairs.length, 28);
  // У всіх таблицях є унікальний «ключ-N»: він має бути знайдений.
  assert.ok(result.pairs.every(pair => pair.candidates.some(item => item.left.columns.join() === 'c0')));
  // Поріг із запасом для повільного CI; локально у кілька разів менший (див. звіт PR).
  assert.ok(elapsed < 20_000, `пошук тривав ${Math.round(elapsed)} мс`);
  console.log(`# table-link: 8×10000×20, 28 пар за ${Math.round(elapsed)} мс`);
});

test('ядро чисте: не торкається DOM, Tauri, мережі, сховища чи годинника', () => {
  const source = readFileSync(new URL('../src/table-link-core.js', import.meta.url), 'utf8');
  for (const forbidden of ['document.', 'window.', 'localStorage', 'invoke(', 'fetch(', 'Date.now', 'new Date()', 'Math.random', 'setTimeout']) {
    assert.ok(!source.includes(forbidden), `у ядрі не має бути «${forbidden}»`);
  }
});
