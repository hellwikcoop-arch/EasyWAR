// easyPay (src/workspace/easypay): правила окладів №704, розрахунок місяця за Порядком №260
// (ред. №232), журнал виплат .easypay і нагадування. Лише синтетичні дані.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  BASE,
  RANKS,
  addCalculation,
  addCustomItem,
  addPayment,
  calculateMonth,
  dateTitle,
  daysInMonth,
  dueDate,
  emptyLedger,
  filterItems,
  firstContractPayment,
  formatMoney,
  gradeCoefficient,
  groupByMonth,
  itemStatus,
  ledgerYears,
  ledgerSummary,
  monthTitle,
  parseLedger,
  reminders,
  removePayment,
  round2,
  roundSalary,
  seniorityPercent,
  serializeLedger,
  yearSeries,
} from '../src/workspace/easypay/easypay-core.js';
import { POSTS_317 } from '../src/workspace/easypay/posady-317.js';
import { buildPosts, parseCsv } from '../script/easypay_posady.mjs';

const soldier = { month: '2026-06', grade: 2, rank: 'soldier', years: 1, specialPct: 65 };
const line = (calc, id) => calc.lines.find(entry => entry.id === id);

test('оклади: база 1762, тарифна сітка й округлення до 10 грн', () => {
  assert.equal(BASE, 1762);
  assert.equal(gradeCoefficient(1), 1.4);
  assert.equal(gradeCoefficient(12), 1.95);
  assert.equal(gradeCoefficient(13), 2.0);
  assert.equal(gradeCoefficient(60), 5.76);
  assert.throws(() => gradeCoefficient(0), /від 1 до 60/);
  assert.throws(() => gradeCoefficient(2.5), /від 1 до 60/);
  assert.equal(roundSalary(2554.9), 2550, '4,99 і менше відкидається');
  assert.equal(roundSalary(528.6), 530, 'від 5 — до 10 угору');
  assert.equal(roundSalary(1762 * 2.0), 3520);
  assert.equal(roundSalary(2555), 2560);
  assert.equal(RANKS.length, 22);
  assert.deepEqual([RANKS[0].coefficient, RANKS.at(-1).coefficient], [0.25, 1]);
});

test('вислуга: 25–50% за шкалою додатка 16', () => {
  assert.deepEqual([0, 1, 4, 5, 9, 10, 15, 20, 24, 25, 40].map(seniorityPercent), [0, 25, 25, 30, 30, 35, 40, 45, 45, 50, 50]);
});

test('приклад роз\'яснення Міноборони: розряд 2, солдат, вислуга 25%, надбавка 65%', () => {
  const calc = calculateMonth(soldier);
  assert.equal(line(calc, 'po').amount, 2550);
  assert.equal(line(calc, 'oz').amount, 530);
  assert.equal(line(calc, 'nvr').amount, 770);
  assert.equal(line(calc, 'special').amount, 2502.5);
  assert.equal(calc.byKind.gz, 6352.5);
  assert.equal(calc.days, 30);
  assert.deepEqual(calc.warnings, []);
});

test('додаткова винагорода пропорційно дням; 10 000 лише з червня 2026', () => {
  const calc = calculateMonth({ ...soldier, combatDays: { d100: 12, d10: 18 } });
  assert.equal(line(calc, 'd100').amount, 40000);
  assert.equal(line(calc, 'd10').amount, 6000);
  assert.equal(calc.byKind.dv, 46000);
  const may = calculateMonth({ ...soldier, month: '2026-05', combatDays: { d100: 31, d10: 5 } });
  assert.equal(line(may, 'd100').amount, 100000);
  assert.equal(line(may, 'd10'), undefined);
  assert.match(may.warnings[0], /діє з червень 2026/);
  const over = calculateMonth({ ...soldier, combatDays: { d100: 20, d30: 15 } });
  assert.deepEqual(over.errors.map(error => error.field), ['combat'], 'дні понад місяць — помилка, а не попередження');
  assert.match(over.errors[0].text, /одну, більшу/);
  assert.deepEqual(calc.errors, []);
  assert.equal(line(calc, 'd100').formula, '100\u00a0000 × 12 / 30');
  const crowded = calculateMonth({ ...soldier, zonalDays: { d170: 20, d70: 11 }, assaultDays: { capture: 31 } });
  assert.deepEqual(crowded.errors.map(error => error.field), ['zonal', 'assault']);
});

test('зональна: 170 000 і 70 000 пропорційно; до червня — 70 000 за 30 днів', () => {
  const calc = calculateMonth({ ...soldier, zonalDays: { d170: 6, d70: 9 } });
  assert.equal(line(calc, 'z170').amount, 34000);
  assert.equal(line(calc, 'z70').amount, 21000);
  const old = calculateMonth({ ...soldier, month: '2026-04', zonalDays: { d170: 15 } });
  assert.equal(line(old, 'z70old').amount, 35000);
  assert.equal(line(old, 'z170'), undefined);
});

test('штурмові й ліміт 460 000', () => {
  const calc = calculateMonth({ ...soldier, combatDays: { d100: 30 }, zonalDays: { d170: 30 }, assaultDays: { capture: 6, restore: 2 } });
  assert.equal(line(calc, 'capture').amount, 240000);
  assert.equal(line(calc, 'restore').amount, 40000);
  // 100 000 + 170 000 + 280 000 = 550 000 → понад ліміт 90 000
  assert.equal(line(calc, 'cap').amount, -90000);
  assert.equal(calc.byKind.dv + calc.byKind.zonal + calc.byKind.assault, 460000);
  const early = calculateMonth({ ...soldier, month: '2026-03', assaultDays: { capture: 2 } });
  assert.equal(line(early, 'capture'), undefined);
  assert.match(early.warnings[0], /Штурмові/);
});

test('за результат і ручні виплати', () => {
  const calc = calculateMonth({ ...soldier, kills: { count: 2, participants: 3 }, prisonerShare: 25000, premium: 4000, extras: [{ title: 'Оздоровлення', amount: 9000, kind: 'other' }] });
  assert.equal(line(calc, 'kills').amount, 10000);
  assert.equal(line(calc, 'prisoners').amount, 25000);
  assert.equal(line(calc, 'premium').amount, 4000);
  assert.equal(calc.byKind.result, 35000);
  assert.equal(calc.byKind.other, 9000);
  assert.match(calculateMonth({ ...soldier, kills: { count: 1 } }).warnings[0], /учасників/);
  assert.throws(() => calculateMonth({ ...soldier, rank: 'x' }), /звання/);
  assert.throws(() => calculateMonth({ ...soldier, month: '2026-13' }), /місяць/);
});

test('перший контракт: 8 / 9 / 10 прожиткових мінімумів', () => {
  assert.deepEqual(firstContractPayment('soldier'), { multiplier: 8, amount: 26624 });
  assert.deepEqual(firstContractPayment('sergeant'), { multiplier: 9, amount: 29952 });
  assert.deepEqual(firstContractPayment('captain'), { multiplier: 10, amount: 33280 });
});

test('дати й гроші українською', () => {
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(dueDate('2026-06'), '2026-07-20');
  assert.equal(dueDate('2026-12'), '2027-01-20');
  assert.equal(monthTitle('2026-06'), 'червень 2026');
  assert.equal(dateTitle('2026-07-20'), '20 липня 2026');
  assert.equal(formatMoney(46000), '46 000 грн');
  assert.equal(formatMoney(2502.5), '2 502,50 грн');
});

test('журнал: розрахунок створює очікувані виплати зі строками, надходження закривають борг', () => {
  const calc = calculateMonth({ ...soldier, combatDays: { d100: 30 } });
  let ledger = addCalculation(emptyLedger(), calc, soldier);
  assert.deepEqual(ledger.items.map(item => [item.kind, item.expected, item.due]), [['gz', 6352.5, '2026-07-20'], ['dv', 100000, '2026-07-20']]);
  assert.equal(ledger.profile.rank, 'soldier');
  assert.equal(ledger.profile.grade, 2);

  const gz = ledger.items.find(item => item.kind === 'gz');
  assert.equal(itemStatus(gz, '2026-07-10').status, 'pending');
  assert.equal(itemStatus(gz, '2026-07-21').status, 'overdue');
  assert.equal(itemStatus(gz, '2026-07-21').overdueDays, 1);

  ledger = addPayment(ledger, gz.id, { date: '2026-07-18', amount: 6000 });
  const partial = itemStatus(ledger.items.find(item => item.id === gz.id), '2026-07-25');
  assert.deepEqual([partial.status, partial.partial, partial.owed, partial.label], ['overdue', true, 352.5, 'Недоплата, строк минув']);
  ledger = addPayment(ledger, gz.id, { date: '2026-07-26', amount: 352.5 });
  assert.equal(itemStatus(ledger.items.find(item => item.id === gz.id), '2026-07-27').status, 'paid');

  const summary = ledgerSummary(ledger, '2026-07-27');
  assert.deepEqual([summary.expected, summary.received, summary.owed, summary.overdue, summary.overdueItems], [106352.5, 6352.5, 100000, 100000, 1]);

  // Перерахунок того самого місяця зберігає надходження.
  const again = addCalculation(ledger, calculateMonth({ ...soldier, combatDays: { d100: 15 } }), soldier);
  assert.equal(again.items.find(item => item.kind === 'dv').expected, 50000);
  assert.equal(again.items.find(item => item.kind === 'gz').payments.length, 2);

  const removed = removePayment(again, gz.id, 0);
  assert.equal(removed.items.find(item => item.id === gz.id).payments.length, 1);
  assert.equal(again.items.find(item => item.id === gz.id).payments.length, 2, 'журнал не змінюється на місці');
  assert.throws(() => addPayment(ledger, gz.id, { date: '2026-02-30', amount: 1 }), /дату/);
  assert.throws(() => addPayment(ledger, gz.id, { date: '2026-07-01', amount: 0 }), /суму/);
});

test('нагадування: прострочені, близькі строки й місяць без розрахунку', () => {
  let ledger = addCalculation(emptyLedger(), calculateMonth({ ...soldier, combatDays: { d100: 30 } }), soldier);
  ledger = addCalculation(ledger, calculateMonth({ ...soldier, month: '2026-07' }), soldier);
  ledger = addCustomItem(ledger, { title: 'Допомога на оздоровлення', expected: 9000, due: '2026-08-30' });
  const list = reminders(ledger, '2026-08-17');
  assert.deepEqual(list.map(item => item.level), ['overdue', 'overdue', 'soon']);
  assert.match(list[0].text, /не надійшло 6 352,50 грн/);
  assert.match(list[2].text, /через 3 дн\./);
  assert.deepEqual(list.map(item => item.days), [28, 28, 3]);
  const later = reminders(ledger, '2026-10-01');
  assert.ok(later.some(item => item.level === 'missing' && /вересень 2026/.test(item.text)));
  assert.ok(later.some(item => /рапортом/.test(item.text)), 'понад 30 днів — порада звернутися');
  assert.deepEqual(reminders(emptyLedger(), '2026-08-17'), []);
  assert.throws(() => addCustomItem(ledger, { title: 'X', expected: 1, due: '' }), /строк/);
});

test('«Мої виплати»: фільтр, групи за місяцем і графік року', () => {
  let ledger = addCalculation(emptyLedger(), calculateMonth({ ...soldier, month: '2026-07', combatDays: { d100: 22 } }), soldier);
  ledger = addCalculation(ledger, calculateMonth({ ...soldier, month: '2026-08' }), soldier);
  const gz = ledger.items.find(item => item.id === '2026-07:gz');
  ledger = addPayment(ledger, gz.id, { date: '2026-08-15', amount: gz.expected });
  ledger = addPayment(ledger, '2026-07:dv', { date: '2026-08-28', amount: 50000 });
  const today = '2026-10-20';
  assert.deepEqual(filterItems(ledger.items, 'all', today).length, 3);
  assert.deepEqual(filterItems(ledger.items, 'debts', today).map(item => item.id), ['2026-08:gz', '2026-07:dv']);
  assert.deepEqual(filterItems(ledger.items, 'received', today).map(item => item.id), ['2026-07:gz']);
  assert.deepEqual(groupByMonth(ledger.items).map(group => [group.month, group.items.length, group.due]), [['2026-08', 1, '2026-09-20'], ['2026-07', 2, '2026-08-20']]);
  const series = yearSeries(ledger, '2026');
  assert.equal(series.length, 12);
  assert.deepEqual(series.filter(entry => entry.hasData).map(entry => entry.month), ['2026-07', '2026-08']);
  assert.deepEqual([series[6].expected, series[6].received], [round2(gz.expected + 70967.74), round2(gz.expected + 50000)]);
  assert.deepEqual([series[0].expected, series[0].hasData], [0, false], 'місяць без пунктів — «немає даних», не нуль');
  assert.deepEqual(ledgerYears(ledger), ['2026']);
  // Формули складових зберігаються у файлі.
  assert.equal(parseLedger(serializeLedger(ledger)).items.find(item => item.id === '2026-07:dv').lines[0].formula, '100\u00a0000 × 22 / 31');
});

test('файл .easypay: збереження, читання й перевірка', () => {
  let ledger = addCalculation(emptyLedger(), calculateMonth(soldier), soldier);
  ledger = addPayment(ledger, ledger.items[0].id, { date: '2026-07-19', amount: 6352.5, note: 'картка' });
  const bytes = serializeLedger(ledger);
  assert.ok(bytes instanceof Uint8Array);
  const parsed = parseLedger(bytes);
  assert.deepEqual(parsed.items, ledger.items);
  assert.deepEqual(parsed.profile, ledger.profile);
  const encode = value => new TextEncoder().encode(JSON.stringify(value));
  assert.throws(() => parseLedger(new TextEncoder().encode('не json')), /не файл журналу/);
  assert.throws(() => parseLedger(encode({ format: 'other', items: [] })), /не файл журналу/);
  assert.throws(() => parseLedger(encode({ format: 'easypay', version: 2, items: [] })), /новішою/);
  assert.throws(() => parseLedger(encode({ format: 'easypay', version: 1, items: [{ id: 'a', month: '2026-06', due: 'x', expected: 1 }] })), /строк/);
  assert.throws(() => parseLedger(encode({ format: 'easypay', version: 1, items: [{ id: 'a', month: '2026-06', due: '2026-07-20', expected: 1, payments: [{ date: '2026-07-01', amount: -5 }] }] })), /надходження/);
  const dup = { id: 'a', month: '2026-06', due: '2026-07-20', expected: 1 };
  assert.throws(() => parseLedger(encode({ format: 'easypay', version: 1, items: [dup, dup] })), /повторюються/);
  const json = new TextDecoder().decode(bytes);
  assert.doesNotMatch(json, /name|surname|прізвище/i, 'у файлі лише параметри окладу');
});

test('генератор переліку №317: рядки-продовження з умовами а), б), в) і виключені позиції', () => {
  const csv = [
    'n,kod_posady,posada,zvannia,kod_zvannia,vos_abo_umova,rozriad',
    '001,111,Тестова посада,Солдат,406,Усі ВОС,3/2',
    '002,222,"Посада з умовами, синтетична",Сержант,403,Усі ВОС:,',
    ',,,,,"а) для усіх частин, крім ""б"";",7',
    ',,,,,б) для бойових військових частин,8/6',
    '003,333,,,,,',
    '004,444,Посада без розряду,Солдат,406,Перелік 3,',
  ].join('\n');
  const posts = buildPosts(parseCsv(csv));
  assert.deepEqual(posts.map(post => post.code), ['111', '222', '444']);
  assert.deepEqual(posts[0].options, [['Усі ВОС', 3, 2]]);
  assert.equal(posts[1].title, 'Посада з умовами, синтетична');
  assert.equal(posts[1].lead, 'Усі ВОС:');
  assert.deepEqual(posts[1].options, [['а) для усіх частин, крім "б";', 7, 7], ['б) для бойових військових частин', 8, 6]]);
  assert.deepEqual([posts[2].lead, posts[2].options], ['Перелік 3', []]);
});

test('перелік посад наказу №317 у застосунку', () => {
  assert.equal(POSTS_317.length, 927);
  assert.equal(new Set(POSTS_317.map(post => post.code)).size, POSTS_317.length, 'коди посад не повторюються');
  const driver = POSTS_317.find(post => post.title === 'Водій');
  assert.deepEqual(driver.options.map(option => [option.contract, option.conscript]), [[3, 2], [4, 2], [5, 2]]);
  const chief = POSTS_317.find(post => post.title.startsWith('Головний сержант (роти'));
  assert.equal(chief.lead, 'Усі ВОС:');
  assert.deepEqual(chief.options.map(option => option.contract), [11, 12, 20]);
  for (const post of POSTS_317) for (const option of post.options) assert.ok(option.contract >= 1 && option.contract <= 60, post.title);
});

test('easyPay без мережі й сховищ браузера, лише textContent', async () => {
  for (const file of ['app.js', 'easypay-core.js', 'easypay-ui.js']) {
    // Простір імен SVG — ідентифікатор, а не адреса запиту.
    const text = (await readFile(new URL(`../src/workspace/easypay/${file}`, import.meta.url), 'utf8')).replaceAll("'http://www.w3.org/2000/svg'", '');
    assert.doesNotMatch(text, /https?:\/\/|fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|innerHTML/, file);
  }
});
