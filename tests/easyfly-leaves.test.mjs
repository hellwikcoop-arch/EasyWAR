// Відпустки EasyFLY: колекція leaves у файлі, редуктори, застереження (частина довша за 15 діб,
// перетин, менше 3 місяців після попередньої), ВЛК/ПМО біля відпустки, графік за рік, маршрути й
// вкладка профілю. Лише синтетичні дані (позивні демо-набору).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEAVE_GAP_MIN_MONTHS, LEAVE_KIND_IDS, LEAVE_PART_DAYS, leaveDays, leaveTotals, leaveWarnings, leavesOverlap,
  medicalAfterLeave, wholeMonthsBetween,
} from '../src/workspace/easyfly/fly-core.js';
import {
  NAV_ITEMS, PHONE_NAV, PILOT_TABS, addLeave, buildRoute, deleteLeave, deletePerson, leaveRows, leaveSchedule,
  leaveYears, parseRoute, updateLeave, applyMutation,
} from '../src/workspace/easyfly/fly-state.js';
import { createEmpty, parse, serialize, validate } from '../src/workspace/easyfly/fly-store.js';
import { createDemo, DEMO_TODAY } from '../src/workspace/easyfly/fly-demo.js';

const pilot = (data, callsign) => data.persons.find(p => p.callsign === callsign);

test('leaveDays: обидві дати включно, некоректні — null', () => {
  assert.equal(leaveDays('2027-02-01', '2027-02-15'), 15);
  assert.equal(leaveDays('2027-02-01', '2027-02-01'), 1);
  assert.equal(leaveDays('2027-02-15', '2027-02-01'), null);
  assert.equal(leaveDays('', '2027-02-01'), null);
  assert.equal(leaveDays('01.02.2027', '15.02.2027'), 15);
});

test('wholeMonthsBetween і leavesOverlap', () => {
  assert.equal(wholeMonthsBetween('2027-02-15', '2027-05-15'), 3);
  assert.equal(wholeMonthsBetween('2027-02-15', '2027-05-14'), 2);
  assert.equal(wholeMonthsBetween('2027-05-15', '2027-02-15'), 0);
  assert.equal(leavesOverlap({ from: '2027-01-01', to: '2027-01-15' }, { from: '2027-01-15', to: '2027-01-30' }), true);
  assert.equal(leavesOverlap({ from: '2027-01-01', to: '2027-01-15' }, { from: '2027-01-16', to: '2027-01-30' }), false);
});

test('leaveWarnings: частина основної довша за 15 діб, перетин, менше 3 місяців після попередньої', () => {
  assert.equal(LEAVE_PART_DAYS, 15);
  assert.equal(LEAVE_GAP_MIN_MONTHS, 3);
  const others = [{ id: 'l1', kind: 'basic', from: '2027-02-01', to: '2027-02-15' }];
  assert.deepEqual(leaveWarnings({ id: 'l2', kind: 'basic', from: '2027-06-01', to: '2027-06-15' }, others), []);
  const long = leaveWarnings({ id: 'l2', kind: 'basic', from: '2027-06-01', to: '2027-06-20' }, others);
  assert.match(long[0], /довша за 15 діб \(20\)/);
  assert.deepEqual(leaveWarnings({ id: 'l2', kind: 'ubd', from: '2027-06-01', to: '2027-06-20' }, others), [], 'УБД не ділиться на 15 діб');
  const overlap = leaveWarnings({ id: 'l2', kind: 'ubd', from: '2027-02-10', to: '2027-02-20' }, others);
  assert.match(overlap[0], /Перетинається з відпусткою 01\.02\.2027–15\.02\.2027/);
  const close = leaveWarnings({ id: 'l2', kind: 'basic', from: '2027-04-20', to: '2027-05-04' }, others);
  assert.match(close[0], /Менше 3 місяців після попередньої відпустки \(закінчилась 15\.02\.2027\)/);
  assert.deepEqual(leaveWarnings({ id: 'l1', kind: 'basic', from: '2027-02-01', to: '2027-02-15' }, others), [], 'сам із собою не порівнюється');
});

test('medicalAfterLeave: річна ВЛК не зсувається через пізній ПМО', () => {
  const person = { medical: [{ kind: 'ВЛК', date: '2026-01-10' }, { kind: 'ПМО', date: '2026-09-01' }] };
  const vlk = medicalAfterLeave(person, { from: '2026-12-20', to: '2027-01-03' });
  assert.deepEqual([vlk.kind, vlk.dueDate, vlk.position], ['ВЛК', '2027-01-10', 'after']);
  const pmo = medicalAfterLeave(person, { from: '2027-06-20', to: '2027-07-04' });
  assert.deepEqual([pmo.kind, pmo.dueDate, pmo.position], ['ПМО', '2027-07-10', 'after']);
});

test('medicalAfterLeave: строки ВЛК (12 міс) і ПМО (6 міс) переносяться до відпустки; before/during/after/later', () => {
  const person = { medical: [{ kind: 'ПМО', date: '2026-04-12' }] }; // ВЛК до 12.10.2026, ПМО до 12.04.2027, ВЛК до 12.10.2027
  assert.equal(medicalAfterLeave({ medical: [] }, { from: '2027-01-01', to: '2027-01-15' }), null);
  const after = medicalAfterLeave(person, { from: '2027-03-15', to: '2027-03-29' });
  assert.deepEqual([after.kind, after.dueDate, after.position, after.near], ['ПМО', '2027-04-12', 'after', true]);
  const during = medicalAfterLeave(person, { from: '2027-04-05', to: '2027-04-19' });
  assert.deepEqual([during.kind, during.position], ['ПМО', 'during']);
  const before = medicalAfterLeave(person, { from: '2027-04-20', to: '2027-05-04' });
  assert.deepEqual([before.kind, before.dueDate, before.position], ['ПМО', '2027-04-12', 'before']);
  const later = medicalAfterLeave(person, { from: '2027-06-01', to: '2027-06-15' });
  assert.deepEqual([later.kind, later.dueDate, later.position, later.near], ['ВЛК', '2027-10-12', 'later', false]);
});

test('leaveTotals за рік: діб за видами й кількість частин основної', () => {
  const leaves = [
    { kind: 'basic', from: '2027-02-01', to: '2027-02-15' }, { kind: 'basic', from: '2027-06-01', to: '2027-06-15' },
    { kind: 'ubd', from: '2027-09-01', to: '2027-09-14' }, { kind: 'basic', from: '2026-11-01', to: '2026-11-15' },
  ];
  assert.deepEqual(leaveTotals(leaves, '2027'), { basicDays: 30, ubdDays: 14, otherDays: 0, basicParts: 2, count: 3 });
  assert.equal(leaveTotals(leaves).count, 4);
});

test('fly-store: leaves — необов\'язкова колекція, перевірка полів, круговий обхід, видалення пілота', () => {
  assert.deepEqual(createEmpty().leaves, []);
  const old = createDemo();
  delete old.leaves;
  const parsed = parse(JSON.stringify(old));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.leaves, []);
  const demo = createDemo();
  assert.ok(demo.leaves.length >= 8);
  const round = parse(serialize(demo));
  assert.equal(round.ok, true);
  assert.equal(round.data.leaves.length, demo.leaves.length);

  const bad = createDemo();
  bad.leaves.push({ id: 'l99', personId: 'p01', kind: 'vacation', from: '2027-01-01', to: '2026-12-31', status: 'done', note: 'x'.repeat(501) });
  const result = validate(bad);
  assert.equal(result.ok, false);
  const paths = result.errors.map(e => e.path);
  assert.ok(paths.includes('leaves[8].kind'));
  assert.ok(paths.includes('leaves[8].to'));
  assert.ok(paths.includes('leaves[8].status'));
  assert.ok(paths.includes('leaves[8].note'));
  const ghost = createDemo();
  ghost.leaves.push({ id: 'l99', personId: 'nobody', kind: 'basic', from: '2027-01-01', to: '2027-01-15' });
  assert.match(validate(ghost).errors[0].message, /Невідомий пілот/);
  assert.equal(LEAVE_KIND_IDS.includes('ubd'), true);

  const removed = deletePerson(demo, 'p01', { confirmed: true });
  assert.equal(removed.data.leaves.some(l => l.personId === 'p01'), false);
  assert.equal(validate(removed.data).ok, true);
});

test('редуктори: addLeave / updateLeave / deleteLeave, дати дд.мм.рррр, помилки українською', () => {
  const data = createDemo();
  const added = addLeave(data, { personId: 'p04', kind: 'basic', from: '01.07.2027', to: '15.07.2027', note: ' після — ПМО ' });
  assert.equal(added.ok, true);
  assert.equal(added.id, 'l9');
  assert.deepEqual(added.data.leaves.at(-1), { id: 'l9', personId: 'p04', kind: 'basic', from: '2027-07-01', to: '2027-07-15', status: 'planned', note: 'після — ПМО' });
  assert.equal(data.leaves.length, 8, 'вхідні дані не змінюються');
  assert.deepEqual(addLeave(data, { personId: 'p04', kind: 'basic', from: '2027-07-20', to: '2027-07-10' }).errors, ['Дата закінчення раніше за дату початку.']);
  assert.deepEqual(addLeave(data, { personId: 'nobody', kind: 'basic', from: '2027-07-01', to: '2027-07-15' }).errors, ['Оберіть пілота.']);
  assert.ok(addLeave(data, { personId: 'p04', kind: 'basic', from: '', to: '' }).errors.length === 2);
  assert.equal(addLeave(data, { personId: 'p04', kind: 'basic', from: '2027-07-01', to: '2027-07-15', status: 'odd' }).errors[0], 'Невідомий стан відпустки.');
  assert.equal(addLeave({ ...data, leaves: undefined }, { personId: 'p04', kind: 'ubd', from: '2027-07-01', to: '2027-07-14' }).id, 'l1', 'старі дані без колекції');

  const updated = updateLeave(added.data, 'l9', { to: '20.07.2027', status: 'approved', personId: 'p01' });
  assert.equal(updated.ok, true);
  assert.equal(updated.data.leaves.at(-1).to, '2027-07-20');
  assert.equal(updated.data.leaves.at(-1).status, 'approved');
  assert.equal(updated.data.leaves.at(-1).personId, 'p04', 'пілот не змінюється');
  assert.equal(updateLeave(added.data, 'l404', {}).errors[0], 'Відпустку не знайдено.');
  assert.equal(deleteLeave(added.data, 'l9').ok, false);
  assert.equal(deleteLeave(added.data, 'l9', { confirmed: true }).data.leaves.length, 8);
  assert.equal(validate(updated.data).ok, true);

  const mutated = applyMutation(data, d => addLeave(d, { personId: 'p04', kind: 'other', from: '2027-08-02', to: '2027-08-06' }));
  assert.equal(mutated.ok, true);
  assert.equal(mutated.data.leaves.length, 9);
});

test('leaveRows і leaveSchedule на демо-наборі: застереження Кречет-33, ВЛК/ПМО, сітка за місяцями', () => {
  const data = createDemo();
  const krechet = pilot(data, 'Кречет-33');
  const rows = leaveRows(krechet, data, DEMO_TODAY);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].warnings, []);
  assert.equal(rows[1].gapMonths, 1);
  assert.match(rows[1].warnings[0], /Менше 3 місяців/);
  assert.equal(rows[1].timing, 'future');
  assert.equal(rows[0].kind.label, 'Основна');

  const schedule = leaveSchedule(data, '2027', DEMO_TODAY);
  assert.equal(schedule.pilots, 4);
  assert.equal(schedule.rows.length, 8);
  assert.equal(schedule.totalDays, 118);
  assert.equal(schedule.warningsCount, 1);
  assert.deepEqual(schedule.rows.map(r => r.leave.from), [...schedule.rows.map(r => r.leave.from)].sort(), 'за датою початку');
  const sokil = schedule.grid.find(g => g.callsign === 'Сокіл-21');
  assert.equal(sokil.months[1].length, 1, 'лютий');
  assert.equal(sokil.months[5].length, 1, 'червень');
  assert.equal(sokil.months[9][0].kind.label, 'УБД');
  assert.equal(sokil.totals.basicParts, 2);
  const sokilJune = schedule.rows.find(r => r.callsign === 'Сокіл-21' && r.leave.from === '2027-06-14');
  assert.equal(sokilJune.medical.position, 'during');
  assert.equal(schedule.medicalCount >= 1, true);
  assert.equal(leaveSchedule(data, '2026', DEMO_TODAY).rows.length, 0);
  assert.deepEqual(leaveYears(data, DEMO_TODAY), ['2026', '2027']);
  assert.deepEqual(leaveYears(createEmpty(), '2026-10-20'), ['2026', '2027']);
});

test('маршрут «Відпустки», вкладка профілю, телефонна навігація без змін', () => {
  assert.ok(NAV_ITEMS.some(i => i.route === 'leaves' && i.label === 'Відпустки'));
  assert.deepEqual(parseRoute('#/leaves'), { name: 'leaves', params: {} });
  assert.equal(buildRoute('leaves'), '#/leaves');
  assert.deepEqual(parseRoute('#/pilot/p01/leaves'), { name: 'pilot', params: { id: 'p01', tab: 'leaves' } });
  assert.equal(buildRoute('pilot', { id: 'p01', tab: 'leaves' }), '#/pilot/p01/leaves');
  assert.deepEqual(PILOT_TABS.map(t => t.label), ['Перевірки', 'Допуски', 'Льотна книжка', 'Штурманські документи', 'Відпустки']);
  assert.deepEqual(PHONE_NAV, ['summary', 'pilots', 'navigator', 'sunmoon']);
});

test('екран і форма: текстові контракти (без імен, українські підписи, маршрут у app.js)', () => {
  const view = readFileSync(new URL('../src/workspace/easyfly/views/leaves.js', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../src/workspace/easyfly/views/leaves-form.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/workspace/easyfly/app.js', import.meta.url), 'utf8');
  const pilotView = readFileSync(new URL('../src/workspace/easyfly/views/pilot.js', import.meta.url), 'utf8');
  assert.match(app, /leaves: 'leaves'/);
  assert.match(view, /Графік відпусток/);
  assert.match(view, /ВЛК \/ ПМО/);
  assert.match(form, /Додати відпустку/);
  assert.match(form, /по 15 діб/);
  assert.match(form, /3–4 місяці/);
  assert.match(pilotView, /leaves: leavesTab/);
  for (const text of [view, form]) {
    assert.doesNotMatch(text, /прізвище|surname|fetch\(|__TAURI__/i);
  }
});
