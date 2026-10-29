import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRocketKpi } from './helpers/rocket-kpi.mjs';

// Тест фіксує числа карток основних показників РВ у rocket.html (E2, РВ: спершу тест).
// Виконується справжній код renderAll на синтетичних рядках; нічого не скопійовано.
const run = await loadRocketKpi();

const row = (date, kind, resRaw, count, extra = {}) => ({
  date, kind, resRaw, count, abort: false, aircraft: 'Платформа', munition: 'Тип А', unit: 'Підрозділ', types: [], pts: [], ...extra,
});
const brief = ({ cards, eff }) => ({
  eff,
  cards: cards.map(c => [c.label.replace('\n', ' '), c.val, c.delta ? c.delta.txt : null, c.dlLabel, c.t1.v, c.t2.v]),
});

test('РВ: картки за період без попереднього — числа, частки, максимуми й мінімум за місяць', () => {
  const rows = [
    row('2026-03-01', 'hit', 'Знищено', 2),
    row('2026-03-02', 'miss', 'Не уражено', 1),
    row('2026-03-03', 'part', 'Подавлено', 3, { abort: true }),
    row('2026-03-04', 'unk', '', 0),
  ];
  const out = brief(run(rows, { from: '2026-03-01', to: '2026-03-04', eff: 'sum' }, '2026-03-01'));
  assert.deepEqual(out.cards, [
    ['ПУСКИ', '4', null, 'друга пол. до першої', '1', '1'],
    ['Використано БП', '6', null, 'друга пол. до першої', '1,5', '3'],
    ['ЗНИЩЕНО', '1', null, 'друга пол. до першої', '25%', '1'],
    ['ПОШКОДЖЕНО ПОДАВЛЕНО', '1', null, 'друга пол. до першої', '25%', '1'],
    ['НЕ УРАЖЕНО', '1', null, 'друга пол. до першої', '25%', '1'],
    ['НЕ ВІДОМО', '1', null, 'друга пол. до першої', '25%', '1'],
  ]);
  // ефективність: (1 влучання + 1 часткове) / (4 запити − 1 відбій) = 66,7 %
  assert.equal(out.eff, '67%');
});

test('РВ: зміна до попереднього періоду такої ж тривалості, у відсотках', () => {
  const rows = [
    row('2026-02-25', 'hit', 'Знищено', 2),
    row('2026-02-27', 'hit', 'Знищено', 2),
    row('2026-03-01', 'hit', 'Знищено', 2),
    row('2026-03-02', 'miss', 'Не уражено', 1),
    row('2026-03-03', 'part', 'Подавлено', 3),
    row('2026-03-04', 'hit', 'Знищено', 0),
  ];
  const { cards } = brief(run(rows, { from: '2026-03-01', to: '2026-03-04', eff: 'sum' }, '2026-02-01'));
  const by = Object.fromEntries(cards.map(c => [c[0], c]));
  // попередній період 25.02–28.02: 2 пуски, 4 БП, 2 знищено
  assert.deepEqual(by['ПУСКИ'].slice(1, 4), ['4', '+100%', 'до попер. періоду']);
  assert.deepEqual(by['Використано БП'].slice(1, 3), ['6', '+50%']);
  assert.deepEqual(by['ЗНИЩЕНО'].slice(1, 3), ['2', '0%']);
  assert.equal(by['НЕ УРАЖЕНО'][2], null, 'у попередньому періоді не було — зміни немає');
});

test('РВ: довгий період без попереднього — друга половина проти першої', () => {
  const first = ['01', '02', '03', '04', '05'].map(d => row(`2026-03-${d}`, 'hit', 'Знищено', 1));
  const second = Array.from({ length: 10 }, (_, i) => row(`2026-03-${String(11 + i).padStart(2, '0')}`, 'hit', 'Знищено', 1));
  const { cards, eff } = brief(run([...first, ...second], { from: '2026-03-01', to: '2026-03-20', eff: 'sum' }, '2026-03-01'));
  const by = Object.fromEntries(cards.map(c => [c[0], c]));
  assert.deepEqual(by['ПУСКИ'], ['ПУСКИ', '15', '+100%', 'друга пол. до першої', '0,8', '1']);
  assert.deepEqual(by['ЗНИЩЕНО'].slice(1, 3), ['15', '+100%']);
  assert.equal(by['НЕ УРАЖЕНО'][2], null);
  assert.equal(cards.length, 5, 'картки «НЕ ВІДОМО» немає, коли таких записів нема');
  assert.equal(eff, '100%');
});

test('РВ: порожній період і режим зваженої ефективності', () => {
  const empty = brief(run([], { from: '2026-03-01', to: '2026-03-04', eff: 'sum' }, '2026-03-01'));
  assert.equal(empty.eff, '—');
  assert.deepEqual(empty.cards.map(c => c.slice(0, 3)), [
    ['ПУСКИ', '0', null], ['Використано БП', '0', null], ['ЗНИЩЕНО', '0', null], ['ПОШКОДЖЕНО ПОДАВЛЕНО', '0', null], ['НЕ УРАЖЕНО', '0', null],
  ]);
  assert.equal(empty.cards[1][4], '—', 'БП на пуск без пусків — прочерк');
  const rows = [row('2026-03-01', 'hit', 'Знищено', 1), row('2026-03-02', 'part', 'Подавлено', 1)];
  assert.equal(brief(run(rows, { from: '2026-03-01', to: '2026-03-02', eff: 'sum' }, '2026-03-01')).eff, '100%');
  assert.equal(brief(run(rows, { from: '2026-03-01', to: '2026-03-02', eff: 'w' }, '2026-03-01')).eff, '88%');
});

test('РВ: ряди міні-графіків карток мають довжину min(24, днів періоду)', () => {
  const rows = [row('2026-03-01', 'hit', 'Знищено', 1), row('2026-03-30', 'hit', 'Знищено', 1)];
  const { cards } = run(rows, { from: '2026-03-01', to: '2026-03-30', eff: 'sum' }, '2026-03-01');
  assert.equal(cards[0].series.length, 24);
  assert.equal(cards[0].series.reduce((a, b) => a + b, 0), 2);
  const short = run(rows.slice(0, 1), { from: '2026-03-01', to: '2026-03-03', eff: 'sum' }, '2026-03-01').cards[0];
  assert.equal(short.series.length, 3);
});
