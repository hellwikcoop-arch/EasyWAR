// Колонки комісування ролі КЕ: уже наявні строки лишаються, бракує лише окремі, і їх додано
// як припущення. Інші ролі свого набору не змінюють. Друкованої таблиці немає.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTypesForPerson, commanderSummary, keBoard, keStatusLabel, normalizeExercise } from '../src/workspace/easyfly/fly-core.js';
import { recordCheck, updateUnit } from '../src/workspace/easyfly/fly-state.js';
import { createDemo, DEMO_TODAY } from '../src/workspace/easyfly/fly-demo.js';
import { createEmpty } from '../src/workspace/easyfly/fly-store.js';

const IDS = [
  'ke_technique', 'instr_landing', 'instr_backup', 'ke_navigation', 'ke_combat',
  'engine_failure', 'instructor_seat', 'duty_leave', 'ke_sim_aircraft', 'ke_sim_egress', 'jumps',
];

test('КЕ: усі колонки є, ЛШ і борттехнік їх не отримують', () => {
  const ke = keBoard({ id: 'p', role: 'КЕ', classQual: '1' }, createEmpty(), '2026-10-20');
  assert.deepEqual(ke.map(row => row.id), IDS);
  assert.equal(keBoard({ id: 'p', role: 'ЛШ', classQual: '1' }, createEmpty(), '2026-10-20').length, 0);
  assert.equal(keBoard({ id: 'p', role: 'Борттехнік' }, createEmpty(), '2026-10-20').length, 0);
  for (const row of ke) {
    assert.equal(row.status, null);
    assert.equal(keStatusLabel(row.status), 'немає даних');
  }
});

test('уже були в довіднику: захід, дублюючі, відмова двигуна, стрибки; інструкторське сидіння — для інструктора без припущення', () => {
  const data = createEmpty();
  data.persons.push({ id: 'p', callsign: 'Сокіл-21', role: 'КЕ', classQual: '1', instructor: true, jumps: [{ date: '2026-03-05' }] });
  data.checks.push(
    { id: 'c1', personId: 'p', kind: 'instr_landing', date: '2026-06-01' },
    { id: 'c2', personId: 'p', kind: 'instr_backup', date: '2026-06-01' },
    { id: 'c3', personId: 'p', kind: 'engine_failure', date: '2026-01-01' },
    { id: 'c4', personId: 'p', kind: 'instructor_seat', date: '2026-04-01' },
  );
  const board = Object.fromEntries(keBoard(data.persons[0], data, '2026-10-20').map(row => [row.id, row]));
  assert.equal(board.instr_landing.assumed, false);
  assert.equal(board.instr_landing.status, 'valid');
  assert.equal(board.instr_backup.assumed, false);
  assert.equal(board.engine_failure.assumed, false);
  assert.equal(board.instructor_seat.assumed, false);
  assert.equal(board.instructor_seat.blocks, true);
  assert.equal(board.jumps.assumed, false);
  assert.equal(board.jumps.status, 'valid');
  assert.equal(keStatusLabel('soon'), 'скоро');
  assert.equal(keStatusLabel('overdue'), 'прострочено');
});

test('додані колонки КЕ: період 12 міс. — припущення, без дати не прострочені і не блокують', () => {
  const person = { id: 'p', role: 'КЕ', classQual: '2', instructor: false };
  const added = ['ke_technique', 'ke_navigation', 'ke_combat', 'duty_leave', 'ke_sim_aircraft', 'ke_sim_egress', 'instructor_seat'];
  const board = Object.fromEntries(keBoard(person, { persons: [person], checks: [], leaves: [] }, '2026-10-20').map(row => [row.id, row]));
  for (const id of added) {
    assert.equal(board[id].assumed, true, id);
    assert.equal(board[id].months, 12, id);
    assert.equal(board[id].blocks, false, id);
    assert.equal(board[id].status, null, id);
  }
  const types = checkTypesForPerson({ role: 'ЛШ', classQual: '3' });
  assert.equal(types.some(type => type.id.startsWith('ke_') || type.id === 'duty_leave'), false);
  assert.equal(types.some(type => type.id === 'lsh_technique'), true);
});

test('період припущення змінюється, чергова відпустка бере кінець уже минулої відпустки', () => {
  const person = { id: 'p', callsign: 'Сокіл-21', role: 'КЕ', classQual: '1' };
  let data = createEmpty();
  data.persons.push(person);
  data.leaves.push({ id: 'l1', personId: 'p', kind: 'basic', from: '2027-02-01', to: '2027-02-15', status: 'planned' });
  let board = keBoard(person, data, '2026-10-20').find(row => row.id === 'duty_leave');
  assert.equal(board.status, null);
  data.leaves.push({ id: 'l2', personId: 'p', kind: 'basic', from: '2025-06-01', to: '2025-06-15', status: 'taken' });
  board = keBoard(person, data, '2026-10-20').find(row => row.id === 'duty_leave');
  assert.equal(board.lastDate, '2025-06-15');
  assert.equal(board.dueDate, '2026-06-15');
  assert.equal(board.status, 'overdue');
  assert.equal(board.blocks, false);
  const changed = updateUnit(data, { settings: { keMonths: { duty_leave: 18 } } });
  assert.equal(changed.ok, true);
  board = keBoard(person, changed.data, '2026-10-20').find(row => row.id === 'duty_leave');
  assert.equal(board.months, 18);
  assert.equal(board.assumed, false);
  assert.equal(board.dueDate, '2026-12-15');
  const recorded = recordCheck(changed.data, 'p', { kind: 'check:ke_technique', date: '2026-09-01' });
  assert.equal(recorded.ok, true);
  const technique = keBoard(person, recorded.data, '2026-10-20').find(row => row.id === 'ke_technique');
  assert.equal(technique.status, 'valid');
  assert.equal(keStatusLabel(technique.status), 'чинне');
});

test('демо-лічильники не змінюються: нові колонки без дат не входять у зведення', () => {
  const data = createDemo();
  const summary = commanderSummary(data.persons, { checks: data.checks, settings: data.unit.settings }, DEMO_TODAY);
  assert.deepEqual(summary.counters, { overdue: 4, soon: 11, valid: 71, total: 86 });
  assert.equal(normalizeExercise('БП'), 'БП');
  assert.equal(normalizeExercise('сбп'), 'СБП');
});
