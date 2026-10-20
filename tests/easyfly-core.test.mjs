// Тести чистої логіки EasyFLY (fly-core, fly-store, fly-demo). Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../src/workspace/easyfly/fly-core.js';
import * as store from '../src/workspace/easyfly/fly-store.js';
import { createDemo, DEMO_TODAY } from '../src/workspace/easyfly/fly-demo.js';

const TODAY = DEMO_TODAY; // 2026-10-20
const demoCtx = data => ({ checks: data.checks, settings: data.unit.settings });
const byCallsign = (data, callsign) => data.persons.find(p => p.callsign === callsign);

// ───────────── Дати ─────────────

test('addMonths: кінець місяця 31 → 30/28/29, високосний рік', () => {
  assert.equal(core.addMonths('2026-08-31', 1), '2026-09-30');
  assert.equal(core.addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(core.addMonths('2027-08-31', 6), '2028-02-29');
  assert.equal(core.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(core.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(core.addMonths('2026-10-12', 6), '2027-04-12');
  assert.equal(core.addMonths('2026-03-15', -6), '2025-09-15');
  assert.equal(core.addMonths('2026-12-31', 2), '2027-02-28');
  assert.equal(core.addMonths('2026-02-30', 1), null);
});

test('addMonthsFrac: дробові місяці Додатка 5', () => {
  assert.equal(core.addMonthsFrac('2026-01-10', 2.5), '2026-03-25');
  assert.equal(core.addMonthsFrac('2026-01-10', 3), '2026-04-10');
});

test('parseDate/formatDate: дд.мм.рррр та ISO, неіснуючі дати відхиляються', () => {
  assert.deepEqual(core.parseDate('12.04.2026'), { year: 2026, month: 4, day: 12 });
  assert.equal(core.normalizeDate('2.4.2026'), '2026-04-02');
  assert.equal(core.normalizeDate('29.02.2028'), '2028-02-29');
  assert.equal(core.normalizeDate('29.02.2027'), null);
  assert.equal(core.normalizeDate('2026-13-01'), null);
  assert.equal(core.normalizeDate('вчора'), null);
  assert.equal(core.normalizeDate(null), null);
  assert.equal(core.formatDate('2026-04-12'), '12.04.2026');
  assert.equal(core.formatDate(null), null);
  assert.equal(core.orDash(core.formatDate(null)), '—');
});

test('addDays/diffDays через межу місяця й року', () => {
  assert.equal(core.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(core.addDays('2026-10-20', -20), '2026-09-30');
  assert.equal(core.diffDays('2026-10-20', '2026-12-14'), 55);
  assert.equal(core.diffDays('2028-02-28', '2028-03-01'), 2);
});

test('статус строку: 30 діб рівно — «скоро», 31 — «дійсно», кінцева дата ще дійсна, після — прострочено', () => {
  const today = '2026-10-20';
  assert.equal(core.deadlineStatus('2026-11-19', today), 'soon'); // рівно 30 діб
  assert.equal(core.deadlineStatus('2026-11-20', today), 'valid'); // 31 доба
  assert.equal(core.deadlineStatus('2026-10-20', today), 'soon'); // кінцева дата — ще дійсна
  assert.equal(core.deadlineStatus('2026-10-19', today), 'overdue');
  assert.equal(core.deadlineStatus(null, today), null);
  assert.equal(core.daysLeft('2026-10-12', today), -8);
});

test('pluralDays', () => {
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map(core.pluralDays), ['день', 'дні', 'днів', 'днів', 'день', 'дні', 'днів']);
});

// ───────────── Медицина ─────────────

test('ВЛК↔ПМО: чергування з кроком 6 місяців', () => {
  const afterVlk = core.medicalState({ medical: [{ kind: 'ВЛК', date: '2026-06-14' }] }, TODAY);
  assert.equal(afterVlk.nextKind, 'ПМО');
  assert.equal(afterVlk.dueDate, '2026-12-14');
  const afterPmo = core.medicalState({ medical: [{ kind: 'ПМО', date: '2026-06-14' }] }, TODAY);
  assert.equal(afterPmo.nextKind, 'ВЛК');
  // береться остання подія, а не остання в масиві
  const mixed = core.medicalState({ medical: [{ kind: 'ПМО', date: '2026-06-14' }, { kind: 'ВЛК', date: '2025-12-14' }] }, TODAY);
  assert.equal(mixed.lastKind, 'ПМО');
  assert.equal(core.medicalState({ medical: [] }, TODAY), null);
});

test('прострочений ПМО так само блокує допуск, як і ВЛК', () => {
  const person = { id: 'x', callsign: 'Тест-01', role: 'КЕ', medical: [{ kind: 'ВЛК', date: '2026-04-12' }] };
  const state = core.medicalState(person, TODAY);
  assert.equal(state.nextKind, 'ПМО');
  assert.equal(state.status, 'overdue');
  const blockers = core.flightBlockers(person, TODAY);
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, 'medical');
  assert.match(blockers[0].label, /ПМО/);
  assert.equal(blockers[0].daysOverdue, 8);
});

// ───────────── Стаття 205 ─────────────

test('Стаття 205: назва напряму залежить від типу ПС (вертоліт → ВД, літак → СД)', () => {
  assert.deepEqual(core.article205Directions('helicopter').map(d => d.label), ['АО', 'РЕО', 'ВД', 'АОз']);
  assert.deepEqual(core.article205Directions('airplane').map(d => d.label), ['АО', 'РЕО', 'СД', 'АОз']);
});

function art205(dates, kind = 'helicopter') {
  const ids = ['ao', 'reo', 'vd_sd', 'aoz'];
  const article205 = {};
  ids.forEach((id, i) => { if (dates[i]) article205[id] = { date: dates[i] }; });
  return { aircraftKind: kind, article205 };
}

test('Стаття 205: «дійсно» лише коли здані всі чотири; «скоро» за найранішим; один прострочений блокує', () => {
  const valid = core.article205State(art205(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']), TODAY);
  assert.equal(valid.status, 'valid');
  assert.equal(valid.dueDate, '2027-03-01');

  const soon = core.article205State(art205(['2026-09-01', '2026-05-10', '2026-09-03', '2026-09-04']), TODAY);
  assert.equal(soon.status, 'soon'); // РЕО: до 10.11.2026 = 21 доба
  assert.equal(soon.earliest.label, 'РЕО');
  assert.equal(soon.daysLeft, 21);

  const oneOverdue = core.article205State(art205(['2026-09-01', '2026-09-02', '2026-03-01', '2026-09-04']), TODAY);
  assert.equal(oneOverdue.status, 'overdue'); // ВД: до 01.09.2026
  assert.equal(oneOverdue.blocks, true);
  assert.equal(oneOverdue.directions.find(d => d.id === 'vd_sd').status, 'overdue');
  assert.equal(oneOverdue.directions.find(d => d.id === 'ao').status, 'valid');
});

test('Стаття 205: напрям без дати — не здано (прострочено); без жодних даних — невідомо', () => {
  const partial = core.article205State(art205(['2026-09-01', '2026-09-02', '2026-09-03']), TODAY);
  assert.equal(partial.status, 'overdue');
  assert.deepEqual(partial.missing, ['АОз']);
  assert.equal(partial.dueDate, null);
  assert.equal(core.article205State({ article205: {} }, TODAY), null);
  assert.equal(core.article205State({}, TODAY), null);
});

// ───────────── ОВП, стрибки ─────────────

test('ОВП: 12 міс за припущенням, блокування — параметр налаштувань', () => {
  const person = { ovp: { date: '2025-11-11' } };
  const state = core.ovpState(person, TODAY);
  assert.equal(state.dueDate, '2026-11-11');
  assert.equal(state.daysLeft, 22);
  assert.equal(state.status, 'soon');
  const old = { ovp: { date: '2025-01-01' } };
  assert.equal(core.ovpState(old, TODAY).blocks, true);
  assert.equal(core.ovpState(old, TODAY, core.resolveSettings({ ovpBlocks: false })).blocks, false);
  assert.equal(core.ovpState(old, TODAY, core.resolveSettings({ ovpMonths: 24 })).status, 'valid');
});

test('стрибки: 2 на календарний рік, перерва ≤ 15 міс', () => {
  const ok = core.jumpsState({ jumps: [{ date: '2025-08-31' }, { date: '2026-03-05' }] }, TODAY);
  assert.equal(ok.yearCount, 1);
  assert.equal(ok.yearDeficit, 1);
  assert.equal(ok.dueDate, '2027-06-05');
  assert.equal(ok.status, 'valid');
  const overdue = core.jumpsState({ jumps: [{ date: '2025-07-01' }] }, TODAY); // 15 міс → 01.10.2026
  assert.equal(overdue.status, 'overdue');
  assert.equal(overdue.blocks, true);
  const edge = core.jumpsState({ jumps: [{ date: '2025-07-20' }] }, TODAY); // 15 міс → 20.10.2026
  assert.equal(edge.status, 'soon');
  assert.equal(core.jumpsState({ jumps: [] }, TODAY), null);
  const exempt = core.jumpsState({ jumps: [], jumpExemptUntil: '2026-12-01' }, TODAY);
  assert.equal(exempt.status, 'exempt');
  assert.equal(exempt.blocks, false);
});

// ───────────── Перевірки за ролями ─────────────

test('КБПВ п. 1.1.10: терміни перевірок за класом і роллю', () => {
  const monthsOf = person => Object.fromEntries(core.checkTypesForPerson(person).map(t => [t.id, t.months]));
  const ke1 = monthsOf({ role: 'КЕ', classQual: '1' });
  const ke3 = monthsOf({ role: 'КЕ', classQual: '3' });
  assert.equal(ke1.aerobatics, 12);
  assert.equal(ke1.instr_landing, 12);
  assert.equal(ke3.instr_landing, 6);
  assert.equal(ke3.instr_backup, 6);
  assert.equal(ke3.engine_failure, 12);
  assert.equal(ke1.instructor_seat, undefined);
  assert.equal(monthsOf({ role: 'КЕ', classQual: '2', instructor: true }).instructor_seat, 12);
  // ЛШ: з власного сидіння раз на 3 міс (1–2 клас — не рідше разу на 6 міс)
  assert.equal(monthsOf({ role: 'ЛШ', classQual: '3' }).lsh_technique, 3);
  assert.equal(monthsOf({ role: 'ЛШ', classQual: '2' }).lsh_technique, 6);
  assert.equal(monthsOf({ role: 'ЛШ', classQual: '3' }).combat_nav, 12);
  // Борттехнік — раз на рік
  assert.deepEqual(monthsOf({ role: 'Борттехнік', classQual: 'none' }), { flight_engineer: 12 });
});

test('checkStates: останній запис, без запису — невідомо (null), не вигадується', () => {
  const person = { id: 'x', role: 'ЛШ', classQual: '3' };
  const checks = [
    { personId: 'x', kind: 'lsh_technique', date: '2026-07-01' },
    { personId: 'x', kind: 'lsh_technique', date: '2026-08-25' },
    { personId: 'y', kind: 'combat_nav', date: '2026-01-01' },
  ];
  const states = core.checkStates(person, checks, TODAY);
  const lsh = states.find(s => s.id === 'lsh_technique');
  assert.equal(lsh.lastDate, '2026-08-25');
  assert.equal(lsh.dueDate, '2026-11-25');
  assert.equal(lsh.status, 'valid'); // 36 діб
  const nav = states.find(s => s.id === 'combat_nav');
  assert.equal(nav.status, null);
  assert.equal(nav.dueDate, null);
});

test('довга перерва: >4 міс — перевірка знань; ЛШ — план введення за класом', () => {
  const lsh3 = { id: 'x', callsign: 'Тест-02', role: 'ЛШ', classQual: '3' };
  const flights = [{ date: '2026-05-25', personId: 'x', count: 1 }];
  const state = core.longBreakState(lsh3, flights, TODAY);
  assert.equal(state.needsKnowledgeCheck, true); // 15.09 < 20.10
  assert.equal(state.needsIntroPlan, false); // 5 міс → 15.10...
  const longer = core.longBreakState(lsh3, [{ date: '2026-05-01', personId: 'x', count: 1 }], TODAY);
  assert.equal(longer.needsIntroPlan, true); // 5 міс → 01.10.2026
  const ke = { id: 'k', callsign: 'Тест-03', role: 'КЕ', classQual: '1' };
  assert.equal(core.longBreakState(ke, [], TODAY), null);
});

// ───────────── Допуски ─────────────

test('Таблиця 1 та Додаток 5: ліміти перерв за класом і добою', () => {
  const site = core.admissionKindById('site');
  assert.equal(core.admissionBreakLimit(site, { classQual: 'sniper' }, 'day'), 8);
  assert.equal(core.admissionBreakLimit(site, { classQual: '1' }, 'night'), 6);
  assert.equal(core.admissionBreakLimit(site, { classQual: '2' }, 'day'), 6);
  assert.equal(core.admissionBreakLimit(site, { classQual: '3' }, 'night'), 3);
  assert.equal(core.admissionBreakLimit(core.admissionKindById('weapons'), { classQual: 'none' }, 'day'), 8);
  assert.equal(core.admissionBreakLimit(core.admissionKindById('route_smu'), { classQual: '2' }, 'day'), 3);
  assert.equal(core.admissionBreakLimit(core.admissionKindById('route_smu'), { classQual: '3' }, 'night'), 2.5);
  assert.equal(core.admissionBreakLimit(core.admissionKindById('circle'), { classQual: '1' }, 'day'), null);
  assert.equal(core.admissionBreakLimit(core.admissionKindById('bt_solo'), { role: 'Борттехнік' }, 'day'), 4);
  assert.equal(core.admissionBreakLimit(core.admissionKindById('lsh_combat'), { role: 'ЛШ', classQual: '3' }, 'day'), 5);
  assert.equal(core.admissionBreakLimit(core.admissionKindById('lsh_combat'), { role: 'ЛШ', classQual: '1' }, 'day'), 6);
});

test('допуск автоматично втрачається після перерви вище ліміту, з підказкою вправи', () => {
  const person = { id: 'k', callsign: 'Тест-04', role: 'КЕ', classQual: '3' };
  const admission = { id: 'a', personId: 'k', kind: 'site', dayNight: 'day', grantedAt: '2026-06-20', status: 'valid' };
  // 3 кл., день: 4 міс → до 20.10.2026 включно
  const edge = core.evaluateAdmission(admission, person, [], '2026-10-20');
  assert.equal(edge.status, 'valid');
  assert.equal(edge.limitDate, '2026-10-20');
  const lost = core.evaluateAdmission(admission, person, [], '2026-10-21');
  assert.equal(lost.status, 'lost');
  assert.equal(lost.auto, true);
  assert.equal(lost.hint.exercise, 9);
  assert.match(lost.hint.text, /вправою 9/);
  // політ за вправою допуску продовжує відлік
  const flown = core.evaluateAdmission(admission, person, [{ personId: 'k', date: '2026-10-01', exercise: '9', count: 1 }], '2026-10-21');
  assert.equal(flown.status, 'valid');
  assert.equal(flown.lastUseDate, '2026-10-01');
  // політ за іншою вправою не продовжує
  const other = core.evaluateAdmission(admission, person, [{ personId: 'k', date: '2026-10-01', exercise: '3', count: 1 }], '2026-10-21');
  assert.equal(other.status, 'lost');
});

test('допуск без нормованої перерви не втрачається автоматично; ручне «втрачено» тримається до повторної відмітки', () => {
  const person = { id: 'k', callsign: 'Тест-05', role: 'КЕ', classQual: '1' };
  const circle = { id: 'a', personId: 'k', kind: 'circle', grantedAt: '2020-01-01', status: 'valid' };
  assert.equal(core.evaluateAdmission(circle, person, [], TODAY).status, 'valid');
  const manual = { ...circle, status: 'lost' };
  const evaluated = core.evaluateAdmission(manual, person, [], TODAY);
  assert.equal(evaluated.status, 'lost');
  assert.equal(evaluated.auto, false);
  const renewed = core.renewAdmission(manual, { date: '2026-10-19', exercise: 3 });
  assert.equal(renewed.status, 'valid');
  assert.equal(renewed.exercise, '3');
  assert.equal(core.evaluateAdmission(renewed, person, [], TODAY).status, 'valid');
});

test('борттехнік: допуск втрачається після перерви понад 4 міс від останнього польоту', () => {
  const bt = { id: 'b', callsign: 'Тест-06', role: 'Борттехнік', classQual: 'none' };
  const admission = { id: 'a', personId: 'b', kind: 'bt_solo', dayNight: 'day', grantedAt: '2026-04-15', status: 'valid' };
  assert.equal(core.evaluateAdmission(admission, bt, [], TODAY).status, 'lost');
  const flights = [{ personId: 'x', crew: ['Тест-06'], date: '2026-09-01', count: 1 }];
  assert.equal(core.evaluateAdmission(admission, bt, flights, TODAY).status, 'valid');
});

test('createAdmission: перевірка полів, статус завжди valid', () => {
  assert.equal(core.createAdmission({ id: 'a', personId: 'p', kind: 'zone', grantedAt: '20.10.2026' }).value.status, 'valid');
  assert.equal(core.createAdmission({ id: 'a', personId: 'p', kind: 'zone', grantedAt: '20.10.2026' }).value.grantedAt, '2026-10-20');
  assert.equal(core.createAdmission({ id: 'a', personId: 'p', kind: 'нема', grantedAt: '2026-10-20' }).ok, false);
  assert.equal(core.createAdmission({ id: 'a', personId: 'p', kind: 'zone', grantedAt: 'абц' }).ok, false);
});

test('renewalHint: нічна вправа та вид без вправ', () => {
  assert.equal(core.renewalHint('route_smu', 'night').exercise, 128);
  assert.equal(core.renewalHint('instructor_work').exercise, null);
  assert.equal(core.renewalHint('невідомо'), null);
});

// ───────────── Блокування, зведення, нагадування (демо-набір) ─────────────

test('демо: валідний файл і 12 пілотів', () => {
  const data = createDemo();
  assert.equal(data.persons.length, 12);
  assert.equal(store.validate(data).ok, true);
  assert.ok(data.persons.every(p => !/\s/.test(p.callsign)));
});

test('зведення командира на демо-наборі: 4 / 11 / 71', () => {
  const data = createDemo();
  const summary = core.commanderSummary(data.persons, demoCtx(data), TODAY);
  assert.equal(summary.counters.overdue, 4);
  assert.equal(summary.counters.soon, 11);
  assert.equal(summary.counters.valid, 71);
  assert.equal(summary.counters.total, 86);
  assert.equal(summary.problems.length, 15);
  assert.equal(summary.blocked.length, 4);
});

test('демо: Беркут-14 — прострочена ВЛК (попередня 12.04.2026, 6 міс), польоти заблоковані', () => {
  const data = createDemo();
  const berkut = byCallsign(data, 'Беркут-14');
  const med = core.medicalState(berkut, TODAY);
  assert.equal(med.lastDate, '2026-04-12');
  assert.equal(core.formatDate(med.lastDate), '12.04.2026');
  assert.equal(med.nextKind, 'ВЛК');
  assert.equal(med.status, 'overdue');
  const blockers = core.flightBlockers(berkut, TODAY, demoCtx(data));
  assert.deepEqual(blockers.map(b => b.label), ['Прострочена ВЛК']);
});

test('демо: Сокіл-21 — ВЛК за 55 днів дійсна, ОВП через 22 дні, блокувань немає', () => {
  const data = createDemo();
  const sokil = byCallsign(data, 'Сокіл-21');
  const med = core.medicalState(sokil, TODAY);
  assert.equal(med.daysLeft, 55);
  assert.equal(med.status, 'valid');
  assert.equal(med.nextKind, 'ВЛК');
  const ovp = core.ovpState(sokil, TODAY);
  assert.equal(ovp.daysLeft, 22);
  assert.equal(core.formatDate(ovp.dueDate), '11.11.2026');
  assert.deepEqual(core.flightBlockers(sokil, TODAY, demoCtx(data)), []);
});

test('демо: Кречет-33 — допуск на маршрут у СМУ втрачено, підказка — вправа 28', () => {
  const data = createDemo();
  const krechet = byCallsign(data, 'Кречет-33');
  const evaluated = core.evaluateAdmissions(krechet, data.admissions, data.flights, TODAY);
  const smu = evaluated.find(e => e.admission.kind === 'route_smu');
  assert.equal(smu.evaluation.status, 'lost');
  assert.equal(smu.evaluation.auto, true);
  assert.equal(smu.evaluation.hint.exercise, 28);
  const statuses = Object.fromEntries(evaluated.map(e => [e.admission.kind, e.evaluation.status]));
  assert.equal(statuses.circle, 'valid');
  assert.equal(statuses.site, 'valid');
  // допуски польоти не блокують
  assert.deepEqual(core.flightBlockers(krechet, TODAY, demoCtx(data)), []);
});

test('фільтри зведення за ланкою й роллю', () => {
  const data = createDemo();
  const ctx = demoCtx(data);
  const link1 = core.commanderSummary(data.persons, ctx, TODAY, { link: 'Ланка-1' });
  assert.ok(link1.items.every(i => i.link === 'Ланка-1'));
  const ke = core.commanderSummary(data.persons, ctx, TODAY, { role: 'КЕ' });
  assert.equal(ke.counters.total, 50);
  const bt = core.commanderSummary(data.persons, ctx, TODAY, { role: 'Борттехнік' });
  assert.equal(bt.counters.total, 18); // 4 × 5 − 2 звільнені від стрибків
  assert.deepEqual(core.filterOptions(data.persons).links, ['Ланка-1', 'Ланка-2', 'Ланка-3']);
  assert.deepEqual(core.filterOptions(data.persons).roles, ['КЕ', 'ЛШ', 'Борттехнік']);
});

test('календар найближчих строків відсортований, прострочені першими', () => {
  const data = createDemo();
  const { calendar } = core.commanderSummary(data.persons, demoCtx(data), TODAY);
  const dates = calendar.map(i => i.dueDate);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(calendar[0].status, 'overdue');
  const upcoming = core.upcomingDeadlines(calendar, TODAY, { horizonDays: 30, includeOverdue: false });
  assert.ok(upcoming.every(i => i.daysLeft >= 0 && i.daysLeft <= 30));
  assert.equal(upcoming.length, 11);
  assert.equal(core.upcomingDeadlines(calendar, TODAY, { limit: 3 }).length, 3);
});

test('нагадування 30/14/7: рівні, прострочене окремо, відсортовано, повідомлення українською', () => {
  assert.equal(core.reminderLevel(30), 30);
  assert.equal(core.reminderLevel(31), null);
  assert.equal(core.reminderLevel(15), 30);
  assert.equal(core.reminderLevel(14), 14);
  assert.equal(core.reminderLevel(8), 14);
  assert.equal(core.reminderLevel(7), 7);
  assert.equal(core.reminderLevel(0), 7);
  assert.equal(core.reminderLevel(-1), 'overdue');
  assert.equal(core.reminderLevel(null), null);

  const data = createDemo();
  const { calendar } = core.commanderSummary(data.persons, demoCtx(data), TODAY);
  const reminders = core.buildReminders(calendar, TODAY);
  assert.equal(reminders.length, 15);
  assert.equal(reminders[0].level, 'overdue');
  const ovp = reminders.find(r => r.callsign === 'Сокіл-21' && r.key === 'ovp');
  assert.equal(ovp.level, 30);
  assert.equal(ovp.message, 'ОВП Сокіл-21: через 22 дні');
  const berkut = reminders.find(r => r.callsign === 'Беркут-14' && r.key === 'medical');
  assert.equal(berkut.level, 'overdue');
  assert.equal(berkut.message, 'ВЛК Беркут-14: прострочено на 8 днів');
  assert.equal(reminders.find(r => r.callsign === 'Вогник-11').level, 7);
  assert.equal(core.buildReminders(calendar, TODAY, [7]).filter(r => r.level === 7).length, 1);
});

// ───────────── Хронометраж ─────────────

test('хронометраж зміни 20.10.2026: 6 екіпажів, 23 польоти, 11:40; Яструб-07 — ліміт пілотажу', () => {
  const data = createDemo();
  const flights = core.flightsOfShift(data.flights, data.shifts[0]);
  const sum = core.shiftSummary(flights, { settings: data.unit.settings, persons: data.persons, today: TODAY, ctx: demoCtx(data) });
  assert.equal(sum.crews, 6);
  assert.equal(sum.takeoffs, 23);
  assert.equal(sum.airtimeMin, 700);
  assert.equal(sum.airtime, '11:40');
  assert.equal(sum.unknownAirtime, 0);
  const yastrub = sum.perPilot.find(p => p.callsign === 'Яструб-07');
  assert.equal(yastrub.aerobaticsFlights, 4);
  assert.equal(yastrub.aerobaticsLimitReached, true);
  assert.equal(yastrub.aerobaticsOver, false);
  assert.equal(sum.perPilot.filter(p => p.aerobaticsLimitReached).length, 1);
  assert.deepEqual(sum.warnings, []); // ніхто з екіпажів не заблокований
});

test('хронометраж: ліміт пілотажу — параметр; перевищення й невідомий наліт', () => {
  const flights = [
    { personId: 'a', crew: ['A-01'], exercise: '20', count: 3, airtimeMin: 60, date: TODAY },
    { personId: 'a', crew: ['A-01'], exercise: '120', count: 2, airtimeMin: null, date: TODAY },
  ];
  const sum = core.shiftSummary(flights, { settings: { aerobaticsLimit: 4 } });
  assert.equal(sum.perPilot[0].aerobaticsFlights, 5);
  assert.equal(sum.perPilot[0].aerobaticsOver, true);
  assert.equal(sum.unknownAirtime, 1);
  assert.equal(sum.airtimeMin, 60);
  assert.ok(sum.warnings.some(w => w.code === 'aerobatics-over'));
  const lax = core.shiftSummary(flights, { settings: { aerobaticsLimit: 6 } });
  assert.equal(lax.perPilot[0].aerobaticsOver, false);
});

test('хронометраж: норма ОНБ ≤ 3 год за зміну, ≤ 2 год за політ; попередження про заблокованого пілота', () => {
  const onb = [
    { personId: 'a', crew: ['A-01'], exercise: '105онб', count: 2, airtimeMin: 200, date: TODAY },
    { personId: 'a', crew: ['A-01', 'B-02'], exercise: '107онб', count: 1, airtimeMin: 150, date: TODAY },
  ];
  const sum = core.shiftSummary(onb);
  assert.equal(sum.perPilot[0].onbMin, 350);
  assert.equal(sum.perPilot[0].onbOver, true);
  assert.ok(sum.warnings.some(w => w.code === 'onb-shift'));
  assert.ok(sum.warnings.some(w => w.code === 'onb-flight')); // 150 хв за один політ
  assert.equal(core.shiftSummary([{ personId: 'a', crew: ['A-01'], exercise: '103', count: 1, airtimeMin: 400, date: TODAY }]).warnings.length, 0);

  const data = createDemo();
  const blockedFlight = [{ personId: 'p02', crew: ['Беркут-14'], exercise: '3', count: 1, airtimeMin: 20, date: TODAY }];
  const blocked = core.shiftSummary(blockedFlight, { persons: data.persons, today: TODAY, ctx: demoCtx(data) });
  assert.ok(blocked.warnings.some(w => w.code === 'blocked'));
});

// ───────────── Льотна книжка ─────────────

test('тривалість HH:MM: розбір і формат, невідоме — null', () => {
  assert.equal(core.parseDuration('1:25'), 85);
  assert.equal(core.parseDuration('0:00'), 0);
  assert.equal(core.parseDuration('12:05'), 725);
  assert.equal(core.parseDuration('1:75'), null);
  assert.equal(core.parseDuration('абв'), null);
  assert.equal(core.parseDuration(''), null);
  assert.equal(core.formatDuration(85), '1:25');
  assert.equal(core.formatDuration(700), '11:40');
  assert.equal(core.formatDuration(null), null);
});

test('льотна книжка Сокіл-21: єдиний запис 20.10.2026, вправа 14, 2 польоти, 1:25; річні/загальні — невідомі', () => {
  const data = createDemo();
  const sokil = byCallsign(data, 'Сокіл-21');
  const entries = core.filterLogbook(core.flightsOfPerson(data.flights, sokil));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].exercise, '14');
  assert.equal(entries[0].count, 2);
  assert.equal(core.formatDuration(entries[0].airtimeMin), '1:25');
  assert.equal(core.formatDate(entries[0].date), '20.10.2026');
  const summary = core.logbookSummary(entries);
  assert.equal(summary.flights, 2);
  assert.equal(summary.airtime, '1:25');
  const totals = core.airtimeTotals(sokil, data.flights, TODAY);
  assert.equal(totals.totalMin, null);
  assert.equal(totals.yearMin, null);
  assert.equal(core.orDash(core.formatDuration(totals.totalMin)), '—');
});

test('нальоти: з початком обліку (baseline) — сума, з пропуском нальоту — невідомо', () => {
  const person = { id: 'x', callsign: 'Тест-07', baseline: { totalMin: 6000, yearMin: 600, asOf: '2026-10-01' } };
  const flights = [
    { personId: 'x', date: '2026-09-15', count: 1, airtimeMin: 50 }, // до asOf — вже в baseline
    { personId: 'x', date: '2026-10-10', count: 1, airtimeMin: 30 },
    { personId: 'x', date: '2026-10-12', count: 1, airtimeMin: 45 },
  ];
  assert.deepEqual(core.airtimeTotals(person, flights, TODAY), { totalMin: 6075, yearMin: 675 });
  const gap = [...flights, { personId: 'x', date: '2026-10-15', count: 1, airtimeMin: null }];
  assert.deepEqual(core.airtimeTotals(person, gap, TODAY), { totalMin: null, yearMin: null });
});

test('normalizeFlight: валідація і нормалізація, невідомі значення — null', () => {
  const ok = core.normalizeFlight({ id: 'f1', date: '20.10.2026', exercise: 14, count: 2, airtime: '1:25', source: 'logbook' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.date, '2026-10-20');
  assert.equal(ok.value.exercise, '14');
  assert.equal(ok.value.airtimeMin, 85);
  const unknown = core.normalizeFlight({ date: '2026-10-20', count: 1 });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.value.airtimeMin, null);
  assert.equal(unknown.value.exercise, null);
  const bad = core.normalizeFlight({ date: '31.02.2026', count: 0, airtime: '1:99', exercise: 'х' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 4);
});

test('фільтри й підсумки льотної книжки', () => {
  const entries = [
    { date: '2026-10-20', exercise: '14', count: 2, airtimeMin: 85, dayNight: 'day', source: 'logbook', personId: 'a' },
    { date: '2026-09-02', exercise: '3', count: 10, airtimeMin: 90, dayNight: 'day', source: 'trip', personId: 'a' },
    { date: '2026-09-02', exercise: '103', count: 4, airtimeMin: null, dayNight: 'night', source: 'import', personId: 'a' },
  ];
  assert.deepEqual(core.filterLogbook(entries).map(e => e.date), ['2026-10-20', '2026-09-02', '2026-09-02']);
  assert.equal(core.filterLogbook(entries, { from: '2026-10-01' }).length, 1);
  assert.equal(core.filterLogbook(entries, { to: '2026-09-30', dayNight: 'night' }).length, 1);
  assert.equal(core.filterLogbook(entries, { exercise: '3' }).length, 1);
  assert.equal(core.filterLogbook(entries, { source: 'trip' }).length, 1);
  const all = core.logbookSummary(entries);
  assert.equal(all.flights, 16);
  assert.equal(all.airtimeMin, 175);
  assert.equal(all.unknownAirtimeEntries, 1);
  assert.equal(all.complete, false);
  assert.equal(core.logbookSummary([]).airtime, null);
});

// ───────────── Імпорт Excel ─────────────

/** Рядок шаблону з 38 клітинок із типовими синтетичними значеннями, поверх — перевизначення за ключем. */
function importRow(overrides = {}) {
  const values = {
    seq: 1, shift: '20.10.2026', airfieldFrom: 'ZR1', airfieldTo: 'ZR1', aircraftType: 'Мі-8', tailNumber: 'Т-001',
    launch: 'запуск', dayNight: 'день', meteoCond: 'ПМУ', count: 2, exercise1: '14', exercise2: '', exercise3: '',
    takeoff: '10:05', landing: '11:30', airtime: '1:25', airtimeTotal: '1:25', airtimeClouds: '', airtimeHood: '',
    altitude: 300, fuel: '255/208', fuelProgram: '', commander: 'Сокіл-21', navigator: 'Орлан-18', flightEngineer: 'Стріла-05',
    crew1: '', crew2: '', crew3: '', crew4: '', crew5: '', crew6: '', passengers: 0, cargo: '', gradeCombat: '', gradeFlight: 5,
    meteo: '4/800/1200/10', rspEvents: '', rspLandings: '',
    ...overrides,
  };
  return core.IMPORT_COLUMNS.map(c => (c.key in values ? values[c.key] : ''));
}
const importHeader = () => core.IMPORT_COLUMNS.map(c => c.title);

test('шаблон імпорту: 38 колонок за позицією; повторювані назви; аеродроми після зміни', () => {
  assert.equal(core.IMPORT_COLUMNS.length, 38);
  assert.equal(core.IMPORT_COLUMN_COUNT, 38);
  assert.deepEqual(core.IMPORT_COLUMNS.slice(0, 4).map(c => c.title), ['Номер з/п', 'Льотна зміна', 'Аеродром зльоту', 'Аеродром посадки']);
  assert.equal(core.IMPORT_COLUMNS.filter(c => c.title === 'Вправа').length, 3);
  assert.equal(core.IMPORT_COLUMNS.filter(c => c.title === 'Інший екіпаж').length, 6);
  assert.equal(core.IMPORT_COLUMNS.at(-1).title, 'Посадки РСП');
  assert.ok(core.IMPORT_COLUMNS.every((c, i) => c.index === i));
});

test('розбір «255/208» (витрата) і «4/800/1200/10» (метео)', () => {
  assert.deepEqual(core.parseFuel('255/208'), { first: 255, second: 208 });
  assert.deepEqual(core.parseFuel('255,5/208'), { first: 255.5, second: 208 });
  assert.equal(core.parseFuel('255'), null);
  assert.equal(core.parseFuel('a/b'), null);
  assert.deepEqual(core.parseMeteo('4/800/1200/10'), { cloudScore: 4, cloudBase: 800, cloudTop: 1200, visibilityKm: 10 });
  assert.equal(core.parseMeteo('4/800/1200'), null);
  assert.equal(core.parseMeteo(''), null);
});

test('час доби й тривалість клітинок Excel: текст і частка доби', () => {
  assert.equal(core.parseTimeOfDay('10:05'), 605);
  assert.equal(core.parseTimeOfDay(0.5), 720);
  assert.equal(core.parseTimeOfDay('24:00'), null);
  assert.equal(core.parseDurationCell('1:25'), 85);
  assert.equal(core.parseDurationCell(85 / 1440), 85);
  assert.equal(core.parseDurationCell(0), 0);
  assert.equal(core.parseDurationCell('x'), null);
  assert.equal(core.excelSerialToIso(46315), '2026-10-20');
});

test('імпорт: коректні рядки розбираються за позицією', () => {
  const rows = [importHeader(), importRow(), importRow({ seq: 2, commander: 'Яструб-07', exercise1: 20, count: 4, airtime: '2:30', takeoff: 0.5, landing: 0.6 })];
  const result = core.parseImportRows(rows, { persons: createDemo().persons });
  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.header, true);
  assert.equal(result.records.length, 2);
  const [first, second] = result.records;
  assert.equal(first.row, 2);
  assert.equal(first.date, '2026-10-20');
  assert.equal(first.dayNight, 'day');
  assert.equal(first.meteoCond, 'ПМУ');
  assert.equal(first.takeoffMin, 605);
  assert.equal(first.landingMin, 690);
  assert.equal(first.airtimeMin, 85);
  assert.deepEqual(first.fuel, { first: 255, second: 208 });
  assert.deepEqual(first.meteo, { cloudScore: 4, cloudBase: 800, cloudTop: 1200, visibilityKm: 10 });
  assert.deepEqual(first.crew, ['Сокіл-21', 'Орлан-18', 'Стріла-05']);
  assert.deepEqual(first.exercises, ['14']);
  assert.equal(first.airfieldFrom, 'ZR1');
  assert.equal(second.row, 3);
  assert.deepEqual(second.exercises, ['20']);
  assert.equal(second.takeoffMin, 720);
  assert.equal(second.airtimeMin, 150);
});

test('імпорт: три колонки «Вправа» й шість «Інший екіпаж» читаються за позицією', () => {
  const row = importRow({ exercise1: '3', exercise2: '7', exercise3: '76м', crew1: 'А-1', crew6: 'Ф-6' });
  const { records, errors } = core.parseImportRows([row], { header: false });
  assert.equal(errors.length, 0);
  assert.deepEqual(records[0].exercises, ['3', '7', '76м']);
  assert.deepEqual(records[0].crew.slice(-2), ['А-1', 'Ф-6']);
});

test('імпорт: помилки з реальними номерами рядків, валідні рядки не втрачаються', () => {
  const rows = [
    importHeader(),
    importRow(), // рядок 2 — ок
    importRow({ seq: 2, dayNight: 'вечір' }), // 3 — день/ніч
    [], // 4 — порожній, пропускається
    importRow({ seq: 3, fuel: '255-208', meteo: '4/800' }), // 5 — два формати
    importRow({ seq: 4, count: 0, commander: '' }), // 6 — кількість і командир
    importRow({ seq: 5, takeoff: '25:61', airtime: '99' }), // 7 — час, наліт
    importRow({ seq: 6, airfieldFrom: '50.12345, 30.54321' }), // 8 — координати замість коду
    importRow({ seq: 7, exercise1: 'вправа чотирнадцять' }), // 9
  ];
  const result = core.parseImportRows(rows);
  assert.equal(result.records.length, 1);
  assert.equal(result.stats.ok, 1);
  assert.equal(result.stats.invalid, 6);
  const rowsWithErrors = [...new Set(result.errors.map(e => e.row))];
  assert.deepEqual(rowsWithErrors, [3, 5, 6, 7, 8, 9]);
  const at = (row, title) => result.errors.filter(e => e.row === row && e.columnTitle === title);
  assert.equal(at(3, 'День/ніч').length, 1);
  assert.equal(at(5, 'Витрата палива').length, 1);
  assert.equal(at(5, 'Метеоумови').length, 1);
  assert.equal(at(6, 'Кількість польотів').length, 1);
  assert.equal(at(6, 'Командир екіпажу').length, 1);
  assert.equal(at(7, 'Зліт').length, 1);
  assert.equal(at(7, 'Наліт').length, 1);
  assert.equal(at(8, 'Аеродром зльоту').length, 1);
  assert.equal(result.errors.find(e => e.row === 3).column, 8); // 1-based позиція стовпця
});

test('імпорт: заголовок не з 38 стовпців — зрозуміла помилка, імпорту немає', () => {
  const short = importHeader().slice(0, 36);
  const result = core.parseImportRows([short, importRow()]);
  assert.equal(result.records.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 1);
  assert.match(result.errors[0].message, /38 стовпців/);
});

test('імпорт: дублікати у файлі та серед наявних польотів — попередження', () => {
  const rows = [importRow(), importRow({ seq: 2 })];
  const result = core.parseImportRows(rows, { header: false });
  assert.equal(result.records.length, 2);
  assert.equal(result.stats.duplicates, 1);
  assert.match(result.warnings.find(w => /дублює/.test(w.message)).message, /Рядок 2 дублює рядок 1/);

  const data = createDemo();
  const existing = core.parseImportRows([importRow()], { header: false, persons: data.persons, existingFlights: data.flights });
  assert.ok(existing.warnings.some(w => /вже є в льотній книжці/.test(w.message)));
});

test('імпорт: дата зміни — з клітинки, із запасної defaultDate або помилка', () => {
  const noDate = importRow({ shift: '1' });
  const err = core.parseImportRows([noDate], { header: false });
  assert.equal(err.records.length, 0);
  assert.equal(err.errors[0].columnTitle, 'Льотна зміна');
  const ok = core.parseImportRows([noDate], { header: false, defaultDate: '2026-10-20' });
  assert.equal(ok.records[0].date, '2026-10-20');
  assert.equal(ok.records[0].shiftLabel, '1');
  const serial = core.parseImportRows([importRow({ shift: 46315 })], { header: false });
  assert.equal(serial.records[0].date, '2026-10-20');
});

test('імпорт: попередження (невідомий позивний, оцінка текстом, незбіжний наліт) не блокують рядок', () => {
  const persons = createDemo().persons;
  const rows = [importRow({ commander: 'Невідомий-99', gradeFlight: 'зачот', airtime: '3:00', count: 1 })];
  const result = core.parseImportRows(rows, { header: false, persons });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].gradeFlight, 'зачот');
  assert.ok(result.warnings.some(w => /немає в особовому складі/.test(w.message)));
  assert.ok(result.warnings.some(w => /не збігається/.test(w.message)));
  assert.ok(core.parseImportRows([importRow({ airfieldFrom: 'QQQ' })], { header: false, airfieldCodes: ['ZR1'] }).errors.length > 0);
});

test('importRecordToFlight: зіставлення позивного, джерело import, валідний запис', () => {
  const data = createDemo();
  const [record] = core.parseImportRows([importRow()], { header: false }).records;
  const flight = core.importRecordToFlight(record, data.persons, 'f100');
  assert.equal(flight.personId, 'p01');
  assert.equal(flight.source, 'import');
  assert.equal(flight.airtimeMin, 85);
  const withFlight = { ...data, flights: [...data.flights, flight] };
  assert.equal(store.validate(withFlight).ok, true);
  assert.equal(core.importRecordToFlight(record, [], 'f1').personId, null);
});

// ───────────── Налаштування ─────────────

test('resolveSettings: типові значення та захист від некоректних', () => {
  const s = core.resolveSettings({ ovpMonths: 18, ovpBlocks: false, aerobaticsLimit: -1, reminderDays: [7, 30, 14, 7], soonDays: 'x' });
  assert.equal(s.ovpMonths, 18);
  assert.equal(s.ovpBlocks, false);
  assert.equal(s.aerobaticsLimit, 4);
  assert.deepEqual(s.reminderDays, [30, 14, 7]);
  assert.equal(s.soonDays, 30);
  assert.equal(core.resolveSettings(null).ovpMonths, 12);
  assert.ok(Object.isFrozen(core.DEFAULT_SETTINGS));
});

test('«скоро» залежить від налаштованого порога', () => {
  const data = createDemo();
  const strict = core.commanderSummary(data.persons, { checks: data.checks, settings: { soonDays: 7 } }, TODAY);
  assert.equal(strict.counters.soon, 1); // лише строк рівно через 7 діб
  assert.equal(strict.counters.overdue, 4);
});

// ───────────── fly-store ─────────────

test('createEmpty: схема версії 1 з усіма розділами, валідна', () => {
  const empty = store.createEmpty();
  assert.equal(empty.version, 1);
  assert.deepEqual(Object.keys(empty), ['version', 'unit', 'persons', 'checks', 'admissions', 'flights', 'shifts', 'navFlights']);
  assert.deepEqual(Object.keys(empty.unit), ['name', 'airfield', 'signers', 'settings']);
  assert.equal(store.validate(empty).ok, true);
});

test('serialize → parse: круговий обхід без втрат, рядок і байти', () => {
  const data = createDemo();
  const text = store.serialize(data);
  assert.ok(text.endsWith('\n'));
  const parsed = store.parse(text);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data, data);
  assert.equal(parsed.migratedFrom, null);
  const bytes = new TextEncoder().encode(text);
  assert.deepEqual(store.parse(bytes).data, data);
  assert.deepEqual(store.parse(bytes.buffer).data, data);
  assert.deepEqual(store.parse(`﻿${text}`).data, data); // BOM
  assert.ok(text.includes('Сокіл-21')); // кирилиця без \u-екранування
});

test('parse: помилки українською — порожній файл, не JSON, не об\'єкт, чужий JSON', () => {
  const messages = [
    store.parse('').errors[0],
    store.parse('не json {').errors[0],
    store.parse('[1,2]').errors[0],
    store.parse('{"foo":1}').errors[0],
    store.parse(42).errors[0],
  ];
  assert.match(messages[0], /порожній/);
  assert.match(messages[1], /JSON/);
  assert.match(messages[2], /не файл EasyFLY/);
  assert.match(messages[3], /версі/);
  assert.match(messages[4], /текст або байти/);
  assert.match(store.parse(new Uint8Array([0xff, 0xfe, 0x00, 0x80])).errors[0], /UTF-8/);
});

test('parse: версія з майбутнього — зрозуміла помилка', () => {
  const future = JSON.stringify({ ...store.createEmpty(), version: 2 });
  const result = store.parse(future);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /новішою версією EasyFLY/);
  assert.match(result.errors[0], /версія схеми 2/);
  assert.equal(store.parse(JSON.stringify({ ...store.createEmpty(), version: 0 })).ok, false);
  assert.equal(store.parse(JSON.stringify({ ...store.createEmpty(), version: '1' })).ok, false);
});

test('parse: ліміт 5 МБ', () => {
  const big = 'a'.repeat(store.MAX_FILE_BYTES + 1);
  assert.match(store.parse(big).errors[0], /5 МБ/);
  assert.match(store.parse(new Uint8Array(store.MAX_FILE_BYTES + 1)).errors[0], /5 МБ/);
});

test('parse: відсутні необов\'язкові розділи доповнюються, невідомі поля зберігаються', () => {
  const minimal = { version: 1, persons: [{ id: 'p1', callsign: 'Тест-01', role: 'КЕ', custom: 'збережено' }] };
  const result = store.parse(JSON.stringify(minimal));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.checks, []);
  assert.deepEqual(result.data.unit.signers, { first: '', second: '' });
  assert.equal(result.data.persons[0].custom, 'збережено');
});

test('міграції: крок застосовується до старих версій (механізм)', () => {
  const stepBefore = store.MIGRATIONS;
  assert.ok(Object.isFrozen(stepBefore));
  assert.equal(store.migrate({ version: 1 }).from, 1);
  assert.match(store.migrate({ version: 0 }).error, /версії/);
  assert.match(store.migrate({}).error, /версії/);
});

test('validate: помилки полів зі шляхами та українськими повідомленнями', () => {
  const data = createDemo();
  const bad = structuredClone(data);
  bad.persons[0].role = 'Командир';
  bad.persons[1].callsign = 'Сокіл-21'; // дублікат
  bad.persons[2].callsign = 'Дуже-довге-значення-яке-більше-схоже-на-повне-прізвище-ім\'я-по-батькові';
  bad.persons[3].medical = [{ kind: 'МСЕК', date: '2026-02-30' }];
  bad.checks[0].personId = 'нема';
  bad.checks[1].kind = 'вигадана';
  bad.admissions[0].status = 'approved';
  bad.flights[0].count = 0;
  bad.flights[1].airtimeMin = -5;
  bad.flights[2].shiftId = 'нема';
  bad.flights[3].source = 'інше';
  const result = store.validate(bad);
  assert.equal(result.ok, false);
  const paths = result.errors.map(e => e.path);
  for (const expected of ['persons[0].role', 'persons[1].callsign', 'persons[2].callsign', 'persons[3].medical[0].kind',
    'persons[3].medical[0].date', 'checks[0].personId', 'checks[1].kind', 'admissions[0].status', 'flights[0].count',
    'flights[1].airtimeMin', 'flights[2].shiftId', 'flights[3].source']) {
    assert.ok(paths.includes(expected), `очікується помилка ${expected}`);
  }
  assert.ok(result.errors.every(e => /[А-Яа-яІіЇїЄє]/.test(e.message)));
  assert.match(result.errors.find(e => e.path === 'persons[2].callsign').message, /позивний, а не повне ім'я/);
});

test('validate: повторні id, колекція не масив, статус допуску лише valid|lost', () => {
  const dup = store.createEmpty();
  dup.persons.push({ id: 'p', callsign: 'А-1', role: 'КЕ' }, { id: 'p', callsign: 'Б-2', role: 'ЛШ' });
  assert.ok(store.validate(dup).errors.some(e => /повторюється/.test(e.message)));
  const broken = { ...store.createEmpty(), flights: {} };
  assert.equal(store.validate(broken).ok, false);
  assert.equal(store.validate(null).ok, false);
});

test('serialize: некоректні дані не записуються', () => {
  const bad = store.createEmpty();
  bad.persons.push({ id: 'p', callsign: '', role: 'КЕ' });
  assert.throws(() => store.serialize(bad), /Не вдалося зберегти/);
});

test('допоміжні функції колекцій не змінюють вихідні дані', () => {
  const items = [{ id: 'f1', v: 1 }, { id: 'f2', v: 2 }];
  assert.equal(store.nextId('f', items), 'f3');
  assert.equal(store.nextId('f', []), 'f1');
  const updated = store.upsertById(items, { id: 'f2', v: 9 });
  assert.equal(updated[1].v, 9);
  assert.equal(items[1].v, 2);
  assert.equal(store.upsertById(items, { id: 'f3', v: 3 }).length, 3);
  assert.equal(store.removeById(items, 'f1').length, 1);

  const data = createDemo();
  const without = store.removePerson(data, 'p03');
  assert.equal(without.persons.length, 11);
  assert.ok(without.checks.every(c => c.personId !== 'p03'));
  assert.ok(without.admissions.every(a => a.personId !== 'p03'));
  assert.ok(without.flights.every(f => f.personId !== 'p03'));
  assert.equal(without.flights.length, data.flights.length);
  assert.equal(data.persons.length, 12);
  assert.equal(store.validate(without).ok, true);
});

test('демо-набір незалежний між викликами і не містить реальних даних', () => {
  const a = createDemo();
  const b = createDemo();
  a.persons[0].callsign = 'Змінено';
  assert.equal(b.persons[0].callsign, 'Сокіл-21');
  const isoDates = [...b.flights.map(f => f.date), ...b.checks.map(c => c.date), ...b.shifts.map(s => s.date)];
  assert.ok(isoDates.every(date => /^\d{4}-\d{2}-\d{2}$/.test(date)), 'дати зберігаються як ISO');
});

test('файл і ядро не залежать від DOM, Tauri і Date.now()', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const name of ['fly-core.js', 'fly-store.js', 'fly-demo.js']) {
    const source = await readFile(new URL(`../src/workspace/easyfly/${name}`, import.meta.url), 'utf8');
    assert.ok(!/Date\.now\(|new Date\(\)|document\.|window\.|__TAURI__|localStorage/.test(source), `${name}: заборонені глобали`);
  }
});

// ───────────── fly-store: збережені розрахунки штурмана (navFlights) ─────────────

const navRecord = (extra = {}) => ({ id: 'n1', title: 'Тест · маршрут', savedAt: '2026-10-20T08:30:00.000Z', flight: { date: '2026-10-20', typeId: 'mi8mtv1', legs: [] }, ...extra });

test('navFlights: старий файл без колекції читається з порожнім масивом, SCHEMA_VERSION лишається 1', () => {
  const old = store.createEmpty();
  delete old.navFlights;
  const parsed = store.parse(JSON.stringify(old));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data.navFlights, []);
  assert.equal(store.SCHEMA_VERSION, 1);
  assert.equal(store.validate(old).ok, true); // колекція необов'язкова
});

test('navFlights: круговий обхід збережених розрахунків і демо-набір', () => {
  const data = store.createEmpty();
  data.navFlights.push(navRecord(), navRecord({ id: 'n2', savedAt: undefined }));
  const parsed = store.parse(store.serialize(data));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.navFlights.length, 2);
  const demo = createDemo();
  assert.equal(demo.navFlights.length, 1);
  assert.equal(store.parse(store.serialize(demo)).ok, true);
});

test('navFlights: перевірка id, назви, savedAt, flight, розміру й імен осіб', () => {
  const check = record => {
    const data = store.createEmpty();
    data.navFlights.push(...[].concat(record));
    return store.validate(data);
  };
  assert.equal(check(navRecord()).ok, true);
  assert.equal(check([navRecord(), navRecord()]).ok, false); // id унікальний
  assert.equal(check(navRecord({ id: '' })).ok, false);
  assert.equal(check(navRecord({ title: '   ' })).ok, false);
  assert.equal(check(navRecord({ title: 'а'.repeat(store.MAX_NAV_TITLE_LEN) })).ok, true);
  assert.equal(check(navRecord({ title: 'а'.repeat(store.MAX_NAV_TITLE_LEN + 1) })).ok, false);
  assert.equal(check(navRecord({ savedAt: 'вчора' })).ok, false);
  assert.equal(check(navRecord({ savedAt: '2026-10-20' })).ok, true);
  assert.equal(check(navRecord({ flight: null })).ok, false);
  assert.equal(check(navRecord({ flight: [] })).ok, false);
  assert.equal(check(navRecord({ flight: { note: 'я'.repeat(store.MAX_NAV_FLIGHT_BYTES) } })).ok, false);
  const named = check(navRecord({ flight: { commander: 'Петренко Іван Петрович' } }));
  assert.equal(named.ok, false);
  assert.match(named.errors[0].path, /flight\.commander/);
  assert.equal(check(navRecord({ flight: { commander: '' } })).ok, true);
  const notArray = store.createEmpty();
  notArray.navFlights = {};
  assert.equal(store.validate(notArray).ok, false);
});
