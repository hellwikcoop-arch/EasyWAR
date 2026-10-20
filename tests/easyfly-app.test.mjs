// Тести чистої частини інтерфейсу EasyFLY (src/workspace/easyfly/fly-state.js): маршрути,
// редуктори змін, розбір CSV, моделі екранів, dirty-логіка. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NAV_ITEMS, PHONE_NAV, addAdmission, addFlight, addPerson, admissionRows, analyzeImport, applyImport,
  applyMutation, blockerBanner, breakMonths, buildRoute, deadlineBuckets, decodeText, deleteAdmission,
  deleteCheck, deleteFlight, deletePerson, detectDelimiter, effectiveSettings, entryKinds, filterPilots,
  fingerprint, isDirty, logbookView, lostAdmissions, mappingRows, markAdmissionLost, navFor,
  parseDelimited, parseRoute, pilotOverview, pluralEvents, profileCards, rangeLabel, recordCheck,
  renewAdmissionRecord, shiftReport, suggestedFileName, summaryView, todayIso, toggleReminderDay,
  updatePerson, updateUnit, worstStatus, addNavFlight, updateNavFlight, removeNavFlight, sanitizeNavFlight,
} from '../src/workspace/easyfly/fly-state.js';
import { IMPORT_COLUMN_COUNT } from '../src/workspace/easyfly/fly-core.js';
import { createDemo, DEMO_TODAY } from '../src/workspace/easyfly/fly-demo.js';
import { createEmpty, validate } from '../src/workspace/easyfly/fly-store.js';

const demo = () => createDemo();
const byCallsign = (data, callsign) => data.persons.find(p => p.callsign === callsign);

test('маршрути: розбір і побудова, невідоме — зведення', () => {
  assert.deepEqual(parseRoute('#/pilot/p01/admissions'), { name: 'pilot', params: { id: 'p01', tab: 'admissions' } });
  assert.deepEqual(parseRoute('#/pilot/p01'), { name: 'pilot', params: { id: 'p01', tab: 'checks' } });
  assert.deepEqual(parseRoute('#/pilot/p01/дивна'), { name: 'pilot', params: { id: 'p01', tab: 'checks' } });
  assert.deepEqual(parseRoute('#/pilot'), { name: 'pilots', params: {} });
  assert.deepEqual(parseRoute('#/navigator/p02'), { name: 'navigator', params: { pilot: 'p02' } });
  assert.deepEqual(parseRoute('#/sunmoon'), { name: 'sunmoon', params: {} });
  assert.deepEqual(parseRoute(''), { name: 'summary', params: {} });
  assert.deepEqual(parseRoute('#/щось'), { name: 'summary', params: {} });
  assert.deepEqual(parseRoute('#/pilot/%E0%A4%A/checks').name, 'pilot');
  for (const item of NAV_ITEMS) assert.equal(parseRoute(buildRoute(item.route)).name, item.route);
  assert.equal(buildRoute('pilot', { id: 'p 1', tab: 'logbook' }), '#/pilot/p%201/logbook');
  assert.deepEqual(parseRoute(buildRoute('pilot', { id: 'p 1', tab: 'logbook' })), { name: 'pilot', params: { id: 'p 1', tab: 'logbook' } });
  assert.equal(buildRoute('pilot', {}), '#/pilots');
  assert.equal(buildRoute('невідомий'), '#/summary');
  assert.equal(navFor({ name: 'pilot' }), 'pilots');
  assert.equal(navFor({ name: 'chrono' }), 'chrono');
});

test('навігація: вісім пунктів у порядку макетів, телефон — чотири', () => {
  assert.deepEqual(NAV_ITEMS.map(i => i.label), ['Зведення', 'Мої пілоти', 'Хронометраж', 'Штурман', 'Сонце і Місяць', 'Імпорт з Excel', 'Нагадування', 'Налаштування']);
  assert.deepEqual(PHONE_NAV, ['summary', 'pilots', 'navigator', 'sunmoon']);
});

test('todayIso бере локальну дату годинника', () => {
  assert.equal(todayIso(new Date(2026, 9, 20, 23, 59)), '2026-10-20');
  assert.equal(todayIso(new Date(2027, 0, 5)), '2027-01-05');
});

test('dirty: відбиток, applyMutation не псує дані при помилці', () => {
  const data = demo();
  const fp = fingerprint(data);
  assert.equal(isDirty(data, fp), false);
  const changed = applyMutation(data, d => { d.unit.name = 'Нова'; });
  assert.equal(changed.ok, true);
  assert.equal(data.unit.name, 'Демонстраційна частина (синтетичні дані)');
  assert.equal(isDirty(changed.data, fp), true);
  const bad = applyMutation(data, d => addPerson(d, { callsign: '', role: 'КЕ' }));
  assert.equal(bad.ok, false);
  assert.equal(bad.data, data);
  assert.equal(isDirty(bad.data, fp), false);
  const viaReducer = applyMutation(data, d => addPerson(d, { callsign: 'Новий-01', role: 'КЕ' }));
  assert.equal(viaReducer.ok, true);
  assert.equal(viaReducer.data.persons.length, data.persons.length + 1);
  assert.equal(applyMutation(data, d => { d.persons = [...d.persons]; return d; }).ok, true);
  // повернення до початкового стану прибирає позначку
  assert.equal(isDirty(structuredClone(data), fp), false);
});

test('пілот: додавання, перевірки полів, унікальний позивний', () => {
  const data = demo();
  assert.equal(addPerson(data, { callsign: 'Сокіл-21', role: 'КЕ' }).ok, false);
  assert.equal(addPerson(data, { callsign: 'сокіл-21', role: 'КЕ' }).ok, false);
  assert.equal(addPerson(data, { callsign: 'Тест-1', role: 'Невідома' }).ok, false);
  assert.equal(addPerson(data, { callsign: 'Я'.repeat(41), role: 'КЕ' }).ok, false);
  const added = addPerson(data, { callsign: ' Тест-1 ', role: 'ЛШ', classQual: '2', link: 'Ланка-9', aircraftType: 'Мі-8' });
  assert.equal(added.ok, true);
  assert.equal(added.id, 'p13');
  const person = added.data.persons.at(-1);
  assert.equal(person.callsign, 'Тест-1');
  assert.deepEqual(person.medical, []);
  assert.equal(validate(added.data).ok, true);
});

test('пілот: зміна, перейменування оновлює екіпажі, видалення лише з підтвердженням', () => {
  const data = demo();
  const sokil = byCallsign(data, 'Сокіл-21');
  const renamed = updatePerson(data, sokil.id, { callsign: 'Сокіл-22', role: 'КЕ' });
  assert.equal(renamed.ok, true);
  assert.ok(renamed.data.flights.some(f => f.crew.includes('Сокіл-22')));
  assert.ok(!renamed.data.flights.some(f => f.crew.includes('Сокіл-21')));
  assert.equal(updatePerson(data, sokil.id, { callsign: 'Беркут-14' }).ok, false);
  assert.equal(updatePerson(data, sokil.id, { role: 'X' }).ok, false);
  assert.equal(updatePerson(data, 'нема', { role: 'КЕ' }).ok, false);
  const withClass = updatePerson(data, sokil.id, { classQual: '3', aircraftType: 'Мі-24', link: '' });
  assert.equal(withClass.data.persons.find(p => p.id === sokil.id).link, null);
  assert.equal(deletePerson(data, sokil.id).ok, false);
  const removed = deletePerson(data, sokil.id, { confirmed: true });
  assert.equal(removed.ok, true);
  assert.equal(removed.data.persons.length, 11);
  assert.ok(!removed.data.checks.some(c => c.personId === sokil.id));
  assert.equal(validate(removed.data).ok, true);
});

test('recordCheck: ВЛК/ПМО чергуються, строки перераховуються', () => {
  const data = demo();
  const berkut = byCallsign(data, 'Беркут-14');
  assert.ok(blockerBanner(berkut, data, DEMO_TODAY).text.includes('ВЛК'));
  const next = recordCheck(data, berkut.id, { kind: 'medical:ВЛК', date: '20.10.2026' });
  assert.equal(next.ok, true);
  const updated = byCallsign(next.data, 'Беркут-14');
  assert.equal(blockerBanner(updated, next.data, DEMO_TODAY), null);
  const cards = profileCards(updated, next.data, DEMO_TODAY);
  assert.equal(cards.find(c => c.key === 'medical:ПМО').status, 'valid');
  assert.equal(cards.find(c => c.key === 'medical:ВЛК').status, 'valid');
  assert.equal(recordCheck(data, berkut.id, { kind: 'medical:ВЛК', date: '31.02.2026' }).ok, false);
  assert.equal(recordCheck(data, berkut.id, { kind: 'x', date: '20.10.2026' }).ok, false);
  assert.equal(recordCheck(data, 'нема', { kind: 'ovp', date: '20.10.2026' }).ok, false);
});

test('recordCheck: Стаття 205, ОВП, стрибок, перевірка за роллю', () => {
  const data = demo();
  const lelek = byCallsign(data, 'Лелека-09');
  assert.equal(recordCheck(data, lelek.id, { kind: 'article205', date: '2026-10-01' }).ok, false);
  const a = recordCheck(data, lelek.id, { kind: 'article205', direction: 'ao', date: '01.10.2026', acceptedBy: 'Спеціаліст' });
  assert.equal(byCallsign(a.data, 'Лелека-09').article205.ao.date, '2026-10-01');
  const o = recordCheck(a.data, lelek.id, { kind: 'ovp', date: '2026-10-02' });
  assert.equal(byCallsign(o.data, 'Лелека-09').ovp.date, '2026-10-02');
  const j = recordCheck(o.data, lelek.id, { kind: 'jump', date: '2026-10-03' });
  const j2 = recordCheck(j.data, lelek.id, { kind: 'jump', date: '2026-10-03' });
  assert.equal(byCallsign(j2.data, 'Лелека-09').jumps.filter(x => x.date === '2026-10-03').length, 1);
  const c = recordCheck(j2.data, lelek.id, { kind: 'check:aerobatics', date: '2026-10-04', note: 'Контрольний' });
  assert.equal(c.data.checks.at(-1).id, `c${data.checks.length + 1}`);
  assert.equal(recordCheck(data, lelek.id, { kind: 'check:flight_engineer', date: '2026-10-04' }).ok, false);
  assert.equal(validate(c.data).ok, true);
  assert.ok(entryKinds(lelek).some(k => k.id === 'check:aerobatics'));
  assert.ok(!entryKinds(byCallsign(data, 'Орлан-18')).some(k => k.id === 'check:aerobatics'));
  const del = deleteCheck(c.data, c.data.checks.at(-1).id);
  assert.equal(del.ok, false);
  assert.equal(deleteCheck(c.data, c.data.checks.at(-1).id, { confirmed: true }).data.checks.length, data.checks.length);
});

test('допуски: самовідмітка, повторна відмітка, втрата, видалення з підтвердженням', () => {
  const data = demo();
  const krechet = byCallsign(data, 'Кречет-33');
  const rows = admissionRows(krechet, data, DEMO_TODAY);
  assert.ok(rows.length > 5);
  const lost = lostAdmissions(krechet, data, DEMO_TODAY);
  assert.ok(lost.some(l => l.label === 'Маршрут у СМУ'), 'допуск на маршрут у СМУ втрачено');
  assert.match(lost.find(l => l.label === 'Маршрут у СМУ').hint.text, /вправою 28/);
  const smu = data.admissions.find(a => a.personId === krechet.id && a.kind === 'route_smu');
  const renewed = renewAdmissionRecord(data, smu.id, { date: '20.10.2026', exercise: '28' });
  assert.equal(renewed.ok, true);
  assert.equal(lostAdmissions(krechet, renewed.data, DEMO_TODAY).some(l => l.label === 'Маршрут у СМУ'), false);
  assert.equal(renewAdmissionRecord(data, smu.id, { date: 'не дата' }).ok, false);
  const manual = markAdmissionLost(data, data.admissions[0].id);
  assert.equal(manual.data.admissions[0].status, 'lost');
  // новий допуск і повторна відмітка того самого виду
  const added = addAdmission(data, { personId: krechet.id, kind: 'clouds', dayNight: 'day', exercise: '26', grantedAt: '2026-10-20' });
  assert.equal(added.ok, true);
  const again = addAdmission(added.data, { personId: krechet.id, kind: 'clouds', dayNight: 'day', grantedAt: '2026-10-21' });
  assert.equal(again.data.admissions.length, added.data.admissions.length);
  assert.equal(again.data.admissions.find(a => a.id === added.id).grantedAt, '2026-10-21');
  const night = addAdmission(added.data, { personId: krechet.id, kind: 'clouds', dayNight: 'night', grantedAt: '2026-10-21' });
  assert.equal(night.data.admissions.length, added.data.admissions.length + 1);
  assert.equal(addAdmission(data, { personId: krechet.id, kind: 'bt_solo', grantedAt: '2026-10-20' }).ok, false);
  assert.equal(addAdmission(data, { personId: krechet.id, kind: 'circle', grantedAt: '' }).ok, false);
  assert.equal(deleteAdmission(data, smu.id).ok, false);
  assert.equal(deleteAdmission(data, smu.id, { confirmed: true }).data.admissions.length, data.admissions.length - 1);
  assert.equal(validate(night.data).ok, true);
  assert.ok(breakMonths({ lastUseDate: '2026-02-10' }, '2026-10-20') >= 8);
  assert.equal(breakMonths(null, '2026-10-20'), null);
  assert.ok(!JSON.stringify(data.admissions).includes('approved'));
});

test('політ: додавання створює зміну, невідомий наліт лишається null, видалення з підтвердженням', () => {
  const data = demo();
  const sokil = byCallsign(data, 'Сокіл-21');
  const first = addFlight(data, { personId: sokil.id, date: '21.10.2026', exercise: '14', count: 2, airtime: '1:25', dayNight: 'day', tailNumber: '123' });
  assert.equal(first.ok, true);
  assert.equal(first.data.shifts.length, data.shifts.length + 1);
  const flight = first.data.flights.find(f => f.id === first.id);
  assert.equal(flight.airtimeMin, 85);
  assert.deepEqual(flight.crew, ['Сокіл-21']);
  assert.equal(flight.shiftId, 's2');
  const noTime = addFlight(first.data, { personId: sokil.id, date: '21.10.2026', exercise: '3', count: 1, airtime: '' });
  assert.equal(noTime.ok, true);
  assert.equal(noTime.data.flights.find(f => f.id === noTime.id).airtimeMin, null);
  assert.equal(noTime.data.shifts.length, first.data.shifts.length);
  assert.equal(addFlight(data, { personId: sokil.id, date: '', count: 1 }).ok, false);
  assert.equal(addFlight(data, { personId: sokil.id, date: '21.10.2026', count: 0 }).ok, false);
  assert.equal(addFlight(data, { personId: sokil.id, date: '21.10.2026', count: 1, airtime: '1:99' }).ok, false);
  assert.equal(addFlight(data, { personId: sokil.id, date: '21.10.2026', count: 1, exercise: 'xx' }).ok, false);
  assert.equal(addFlight(data, { date: '21.10.2026', count: 1 }).ok, false);
  assert.equal(addFlight(data, { personId: 'нема', date: '21.10.2026', count: 1 }).ok, false);
  assert.equal(deleteFlight(noTime.data, noTime.id).ok, false);
  assert.equal(deleteFlight(noTime.data, noTime.id, { confirmed: true }).data.flights.length, first.data.flights.length);
  assert.equal(validate(noTime.data).ok, true);
});

test('зведення: лічильники 4 / 11 / 71, фільтри, тижневі відрізки', () => {
  const data = demo();
  const view = summaryView(data, DEMO_TODAY);
  assert.deepEqual([view.counters.overdue, view.counters.soon, view.counters.valid], [4, 11, 71]);
  assert.equal(view.links.length, 3);
  const filtered = summaryView(data, DEMO_TODAY, { role: 'КЕ' });
  assert.ok(filtered.counters.total < view.counters.total);
  assert.ok(view.blocked.some(b => b.callsign === 'Беркут-14'));
  assert.equal(view.buckets[0].from, DEMO_TODAY);
  assert.equal(view.buckets.at(-1).to, '2026-11-19');
  assert.equal(view.buckets.reduce((s, b) => s + b.items.length, 0), view.calendar.filter(i => i.daysLeft >= 0 && i.daysLeft <= 30).length);
  assert.equal(rangeLabel('2026-10-20', '2026-10-26'), '20–26 жовтня');
  assert.equal(rangeLabel('2026-10-27', '2026-11-02'), '27 жовтня – 2 листопада');
  assert.equal(pluralEvents(1), '1 подія');
  assert.equal(pluralEvents(3), '3 події');
  assert.equal(pluralEvents(11), '11 подій');
  assert.equal(pluralEvents(0), '0 подій');
  assert.deepEqual(deadlineBuckets([], '2026-10-20', 30).length, 5);
});

test('зведення порожнього файла не падає й дає нулі', () => {
  const view = summaryView(createEmpty(), DEMO_TODAY);
  assert.equal(view.counters.total, 0);
  assert.equal(view.problems.length, 0);
});

test('таблиця пілотів: клітинки статусів, фільтри, нальоти', () => {
  const data = demo();
  const rows = data.persons.map(p => pilotOverview(p, data, DEMO_TODAY));
  const berkut = rows.find(r => r.person.callsign === 'Беркут-14');
  assert.equal(berkut.cells.medical, 'overdue');
  assert.equal(berkut.blocked, true);
  assert.equal(berkut.hasOverdue, true);
  const sokil = rows.find(r => r.person.callsign === 'Сокіл-21');
  assert.equal(sokil.cells.medical, 'valid');
  assert.equal(sokil.cells.ovp, 'soon');
  assert.equal(sokil.lastFlight, '2026-10-20');
  assert.equal(sokil.yearAirtime, null, 'річний наліт невідомий без початку обліку');
  assert.equal(rows.find(r => r.person.callsign === 'Грім-02').cells.jumps, 'exempt');
  assert.equal(filterPilots(rows, { link: 'Ланка-1' }).length, 4);
  assert.equal(filterPilots(rows, { role: 'ЛШ' }).length, 3);
  assert.equal(filterPilots(rows, { query: 'СОК' }).length, 1);
  assert.equal(filterPilots(rows, { link: 'Ланка-1', role: 'ЛШ', query: 'орл' }).length, 1);
  assert.equal(worstStatus(['valid', 'soon', null]), 'soon');
  assert.equal(worstStatus(['valid', 'overdue', 'soon']), 'overdue');
  assert.equal(worstStatus([null, 'exempt']), null);
});

test('картки профілю: ВЛК прострочена, ПМО без «простроченої», Стаття 205 з напрямами', () => {
  const data = demo();
  const berkut = byCallsign(data, 'Беркут-14');
  const cards = profileCards(berkut, data, DEMO_TODAY);
  const vlk = cards.find(c => c.key === 'medical:ВЛК');
  assert.equal(vlk.status, 'overdue');
  assert.equal(vlk.blocks, true);
  assert.match(vlk.footer, /Прострочено з 12\.10\.2026 · 8 дн\./);
  const art = cards.find(c => c.key === 'article205');
  assert.deepEqual(art.rows.map(r => r.label), ['АО', 'РЕО', 'ВД', 'АОз']);
  const banner = blockerBanner(berkut, data, DEMO_TODAY);
  assert.equal(banner.days, 8);
  assert.deepEqual(cards.filter(c => c.key.startsWith('group:')).map(c => c.title), ['Техніка пілотування', 'Прилади', 'БЗ і навігація на ГМВ']);
  const bt = profileCards(byCallsign(data, 'Грім-02'), data, DEMO_TODAY);
  assert.equal(bt.find(c => c.key === 'jumps').status, 'exempt');
  assert.ok(!bt.some(c => c.key === 'group:instruments'));
});

test('картки профілю: порожній пілот — «немає даних», нічого не вигадується', () => {
  const data = addPerson(createEmpty(), { callsign: 'Порожній-1', role: 'КЕ' }).data;
  const cards = profileCards(data.persons[0], data, DEMO_TODAY);
  assert.ok(cards.length >= 7);
  assert.ok(cards.every(c => c.status === null));
  assert.equal(cards.find(c => c.key === 'article205').rows.length, 4);
  assert.equal(blockerBanner(data.persons[0], data, DEMO_TODAY), null);
});

test('льотна книжка Сокіл-21: 1:25, річний і загальний наліт — тире (null)', () => {
  const data = demo();
  const sokil = byCallsign(data, 'Сокіл-21');
  const view = logbookView(sokil, data, DEMO_TODAY);
  assert.equal(view.entries.length, 1);
  assert.equal(view.monthAirtime, '1:25');
  assert.equal(view.yearAirtime, null);
  assert.equal(view.totalAirtime, null);
  assert.equal(view.summary.flights, 2);
  assert.equal(view.monthLabel, 'Жовтень 2026');
  assert.equal(view.dayAirtime, '1:25');
  assert.equal(view.nightAirtime, null);
  assert.equal(logbookView(sokil, data, DEMO_TODAY, { month: '2026-09' }).entries.length, 0);
  assert.equal(logbookView(sokil, data, DEMO_TODAY, { dayNight: 'night' }).entries.length, 0);
});

test('хронометраж зміни 20.10.2026: 6 екіпажів, 23 польоти, 11:40, межа пілотажу Яструб-07', () => {
  const data = demo();
  const report = shiftReport(data, DEMO_TODAY, DEMO_TODAY);
  assert.equal(report.summary.crews, 6);
  assert.equal(report.summary.takeoffs, 23);
  assert.equal(report.summary.airtime, '11:40');
  assert.equal(report.rows.length, 6);
  const aero = report.rows.find(r => r.flight.exercise === '20');
  assert.equal(aero.state, 'limit');
  assert.ok(report.notices.some(n => /Яструб-07/.test(n.title)));
  assert.ok(report.rows.filter(r => r.state === 'entered').length >= 5);
  const empty = shiftReport(data, '2026-01-01', DEMO_TODAY);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.summary.takeoffs, 0);
});

test('налаштування: перевірка, підписанти, нагадування 30/14/7', () => {
  const data = demo();
  assert.equal(updateUnit(data, { settings: { aerobaticsLimit: 0 } }).ok, false);
  assert.equal(updateUnit(data, { settings: { onbCriterionPercent: 101 } }).ok, false);
  assert.equal(updateUnit(data, { settings: { airfieldLat: '95' } }).ok, false);
  const ok = updateUnit(data, {
    name: ' Частина ',
    airfield: 'Зоря',
    signersFull: { first: { rank: 'Підполковник', name: 'Олег', surname: 'ПЕТРЕНКО' } },
    settings: { aerobaticsLimit: '5', onbCriterionPercent: 60, airfieldLat: '50,45', airfieldLon: '30.5', soonDays: 20 },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.unit.name, 'Частина');
  assert.equal(ok.data.unit.signers.first, 'ПЕТРЕНКО');
  assert.equal(ok.data.unit.signers.second, 'КОВАЛЬ');
  assert.equal(ok.data.unit.settings.airfieldLat, 50.45);
  assert.equal(effectiveSettings(ok.data).aerobaticsLimit, 5);
  assert.equal(effectiveSettings(ok.data).soonDays, 20);
  assert.equal(effectiveSettings(data).onbCriterionPercent, 50);
  assert.equal(effectiveSettings(createEmpty()).aerobaticsLimit, 4);
  assert.equal(validate(ok.data).ok, true);
  const cleared = updateUnit(ok.data, { settings: { airfieldLat: '' } });
  assert.equal('airfieldLat' in cleared.data.unit.settings, false);
  const off = toggleReminderDay(data, 14, false);
  assert.deepEqual(effectiveSettings(off.data).reminderDays, [30, 7]);
  assert.equal(toggleReminderDay(toggleReminderDay(off.data, 30, false).data, 7, false).ok, false);
  assert.deepEqual(effectiveSettings(toggleReminderDay(off.data, 14, true).data).reminderDays, [30, 14, 7]);
  assert.equal(updateUnit(data, { signers: { first: 'Я'.repeat(81) } }).ok, false);
});

test('CSV/TSV: розділювач, лапки, переноси, BOM, порожні рядки', () => {
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a;b;c'), ';');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('"a,b";c;d'), ';');
  assert.equal(detectDelimiter('abc'), '\t');
  assert.deepEqual(parseDelimited('a;b\r\n1;2\r\n\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseDelimited('﻿x,y\n"1,5","a ""q"" b"\n'), [['x', 'y'], ['1,5', 'a "q" b']]);
  assert.deepEqual(parseDelimited('a;"два\nрядки";c'), [['a', 'два\nрядки', 'c']]);
  assert.deepEqual(parseDelimited('a\tb\n\t\n'), [['a', 'b']]);
  assert.deepEqual(parseDelimited(''), []);
  assert.deepEqual(parseDelimited('1;;3'), [['1', '', '3']]);
  assert.equal(decodeText(new TextEncoder().encode('Політ')), 'Політ');
  assert.equal(decodeText(Uint8Array.from([0xcf, 0xee, 0xeb, 0xb3, 0xf2])), 'Політ');
});

function importRow(overrides = {}) {
  const cells = Array(IMPORT_COLUMN_COUNT).fill('');
  Object.assign(cells, { 0: '1', 1: '20.10.2026', 4: 'Мі-8МТВ-1', 5: '123', 7: 'день', 8: 'ПМУ', 9: '2', 10: '14', 15: '1:25', 22: 'Сокіл-21' }, overrides);
  return cells;
}

test('імпорт: підсумок, помилки за номерами рядків, дублікати, застосування лише після кнопки', () => {
  const data = demo();
  const header = Array.from({ length: IMPORT_COLUMN_COUNT }, (_, i) => `Колонка ${i + 1}`);
  const good = importRow({ 0: '1', 22: 'Новий-77', 15: '0:50', 9: '1', 10: '3' });
  const badDate = importRow({ 0: '2', 1: 'вчора' });
  const dupOfDemo = importRow({ 0: '3', 22: 'Сокіл-21', 9: '2', 10: '14', 15: '1:25' });
  const tsv = [header, good, badDate, dupOfDemo].map(r => r.join('\t')).join('\n');
  const analysis = analyzeImport(parseDelimited(tsv), data);
  assert.equal(analysis.summary.rows, 3);
  assert.equal(analysis.summary.records, 2);
  assert.equal(analysis.summary.invalidRows, 1);
  assert.deepEqual(analysis.errorRows.map(e => e.row), [3]);
  assert.deepEqual([...analysis.duplicateRows], [4]);
  assert.deepEqual(analysis.unknownCallsigns, ['Новий-77']);
  assert.equal(analysis.summary.fileError, false);
  const before = data.flights.length;
  const applied = applyImport(data, analysis.records, { skipDuplicates: true, duplicateRows: analysis.duplicateRows });
  assert.equal(applied.ok, true);
  assert.equal(applied.added, 1);
  assert.equal(applied.skipped, 1);
  assert.equal(applied.data.flights.length, before + 1);
  assert.equal(applied.data.flights.at(-1).source, 'import');
  assert.equal(applied.data.flights.at(-1).personId, null);
  assert.equal(data.flights.length, before, 'вхідні дані не змінено');
  assert.equal(validate(applied.data).ok, true);
  const all = applyImport(data, analysis.records, { skipDuplicates: false });
  assert.equal(all.added, 2);
});

test('імпорт: хибна кількість колонок у заголовку — помилка файла, нічого не імпортується', () => {
  const analysis = analyzeImport(parseDelimited('a\tb\tc\n1\t2\t3'), demo());
  assert.equal(analysis.summary.fileError, true);
  assert.equal(analysis.summary.records, 0);
  assert.equal(analysis.errorRows[0].row, 1);
  assert.equal(analyzeImport([], demo()).summary.records, 0);
});

test('імпорт: дата зміни для рядків без дати, зіставлення 38 колонок', () => {
  const data = demo();
  const noDate = importRow({ 1: '' });
  const without = analyzeImport([noDate], data, { header: false });
  assert.equal(without.summary.invalidRows, 1);
  const withDefault = analyzeImport([noDate], data, { header: false, defaultDate: '2026-10-19' });
  assert.equal(withDefault.records[0].date, '2026-10-19');
  const map = mappingRows([noDate], false);
  assert.equal(map.length, 38);
  assert.equal(map[0].number, 1);
  assert.equal(map[4].sample, 'Мі-8МТВ-1');
  assert.equal(map[2].sample, null);
});

test('ім’я файла для збереження безпечне', () => {
  assert.equal(suggestedFileName({ unit: { name: '' } }), 'EasyFLY.easyfly');
  assert.equal(suggestedFileName({ unit: { name: 'Ескадрилья «Перша»: 1/2' } }), 'Ескадрилья «Перша» 1 2.easyfly');
});

// ───────────── збережені розрахунки штурмана ─────────────

test('addNavFlight: додає запис, прибирає імена осіб і NaN, не змінює вхідні дані', () => {
  const data = createEmpty();
  const flight = { date: '2026-10-20', typeId: 'mi8mtv1', commander: 'Петренко Іван', legs: [{ name: 'Дубки', s: NaN }] };
  const out = addNavFlight(data, { title: '  Тест  ', flight, savedAt: '2026-10-20T09:00:00.000Z' });
  assert.equal(out.ok, true);
  assert.equal(out.id, 'n1');
  assert.deepEqual(data.navFlights, []);
  const saved = out.data.navFlights[0];
  assert.equal(saved.title, 'Тест');
  assert.equal(saved.flight.commander, undefined);
  assert.equal(saved.flight.legs[0].s, null);
  assert.equal(validate(out.data).ok, true);
  assert.equal(addNavFlight(out.data, { title: 'Другий', flight }).id, 'n2');
});

test('addNavFlight: порожня або задовга назва, не об’єкт — відмова', () => {
  const data = createEmpty();
  assert.equal(addNavFlight(data, { title: ' ', flight: {} }).ok, false);
  assert.equal(addNavFlight(data, { title: 'а'.repeat(121), flight: {} }).ok, false);
  assert.equal(addNavFlight(data, { title: 'Тест', flight: null }).ok, false);
  assert.equal(addNavFlight(data, { title: 'Тест', flight: [] }).ok, false);
  assert.equal(addNavFlight({ ...data, navFlights: undefined }, { title: 'Тест', flight: {} }).ok, true); // старі дані без колекції
});

test('updateNavFlight / removeNavFlight: перейменування, заміна розрахунку, видалення з підтвердженням', () => {
  const base = addNavFlight(createEmpty(), { title: 'Один', flight: { date: '2026-10-20' } }).data;
  const renamed = updateNavFlight(base, 'n1', { title: 'Новий' });
  assert.equal(renamed.data.navFlights[0].title, 'Новий');
  assert.equal(base.navFlights[0].title, 'Один');
  assert.equal(updateNavFlight(base, 'n1', { title: '' }).ok, false);
  assert.equal(updateNavFlight(base, 'n9', { title: 'X' }).ok, false);
  const replaced = updateNavFlight(base, 'n1', { flight: { date: '2026-11-01' }, savedAt: '2026-11-01T10:00:00Z' });
  assert.equal(replaced.data.navFlights[0].flight.date, '2026-11-01');
  assert.equal(removeNavFlight(base, 'n1').ok, false);
  assert.equal(removeNavFlight(base, 'n9', { confirmed: true }).ok, false);
  assert.deepEqual(removeNavFlight(base, 'n1', { confirmed: true }).data.navFlights, []);
});

test('navFlights через applyMutation: зміна позначає файл як незбережений', () => {
  const data = createEmpty();
  const savedFp = fingerprint(data);
  const outcome = applyMutation(data, d => addNavFlight(d, { title: 'Тест', flight: { date: '2026-10-20' } }));
  assert.equal(outcome.ok, true);
  assert.equal(isDirty(outcome.data, savedFp), true);
  assert.equal(sanitizeNavFlight({ captain: 'ПЕТРЕНКО І.П.', iasChief: { name: 'X' }, board: '1' }).board, '1');
  assert.equal(sanitizeNavFlight({ captain: 'ПЕТРЕНКО І.П.' }).captain, undefined);
});
