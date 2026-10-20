// Синтетичний демонстраційний набір EasyFLY: 12 вигаданих екіпажів (позивні, без прізвищ і
// реальних бортових номерів). Дати задаються зсувом у днях від DEMO_TODAY, щоб набір не
// «старів» у тестах. Зведення командира на цьому наборі дає 4 прострочено / 11 скоро /
// 71 дійсно; містить приклади з макетів: Беркут-14 (прострочена медицина), Сокіл-21 (за 55
// днів — дійсна, ОВП через 22 дні), Кречет-33 (допуск на маршрут у СМУ втрачено),
// Яструб-07 (4 польоти на пілотаж за зміну 20.10.2026).

import { addDays, addMonths, checkTypesForPerson } from './fly-core.js';
import { createEmpty } from './fly-store.js';

/** «Сьогодні» демонстраційного набору. */
export const DEMO_TODAY = '2026-10-20';

const PEOPLE = [
  { id: 'p01', callsign: 'Сокіл-21', role: 'КЕ', classQual: '1', link: 'Ланка-1', aircraftType: 'Мі-8' },
  { id: 'p02', callsign: 'Беркут-14', role: 'КЕ', classQual: '2', link: 'Ланка-1', aircraftType: 'Мі-8' },
  { id: 'p03', callsign: 'Кречет-33', role: 'КЕ', classQual: '2', link: 'Ланка-2', aircraftType: 'Мі-24' },
  { id: 'p04', callsign: 'Яструб-07', role: 'КЕ', classQual: '3', link: 'Ланка-2', aircraftType: 'Мі-24' },
  { id: 'p05', callsign: 'Лелека-09', role: 'КЕ', classQual: 'sniper', link: 'Ланка-3', aircraftType: 'Мі-8' },
  { id: 'p06', callsign: 'Орлан-18', role: 'ЛШ', classQual: '1', link: 'Ланка-1', aircraftType: 'Мі-8' },
  { id: 'p07', callsign: 'Шуліка-26', role: 'ЛШ', classQual: '3', link: 'Ланка-2', aircraftType: 'Мі-24' },
  { id: 'p08', callsign: 'Сапсан-31', role: 'ЛШ', classQual: '2', link: 'Ланка-3', aircraftType: 'Мі-8' },
  { id: 'p09', callsign: 'Грім-02', role: 'Борттехнік', classQual: 'none', link: 'Ланка-1', aircraftType: 'Мі-8' },
  { id: 'p10', callsign: 'Стріла-05', role: 'Борттехнік', classQual: 'none', link: 'Ланка-2', aircraftType: 'Мі-24' },
  { id: 'p11', callsign: 'Вогник-11', role: 'Борттехнік', classQual: 'none', link: 'Ланка-3', aircraftType: 'Мі-8' },
  { id: 'p12', callsign: 'Гвинт-40', role: 'Борттехнік', classQual: 'none', link: 'Ланка-3', aircraftType: 'Мі-8' },
];

/** Зсув строків у днях від DEMO_TODAY (від'ємний — прострочено). Решта строків — типові 60…299 днів. */
const DUE = {
  p01: { medical: 55, ovp: 22 },
  p02: { ovp: 29 },
  p03: { medical: 12 },
  p04: { article205: 18 },
  p05: { 'check:instr_landing': 25 },
  p06: { 'check:lsh_technique': 9 },
  p07: { 'check:lsh_technique': -10, jumps: 21 },
  p08: { medical: 28 },
  p09: { ovp: -3, medical: 31 },
  p10: { 'check:flight_engineer': 14 },
  p11: { ovp: 7 },
  p12: { 'check:flight_engineer': -5, medical: 30 },
};

/** Стрибки: Сокіл-21 має два у 2026 році; Грім-02 і Стріла-05 тимчасово звільнені від стрибків. */
const JUMPS = { p01: ['2026-03-05', '2026-08-18'] };
const JUMP_EXEMPT = { p09: '2027-01-31', p10: '2027-01-31' };

function defaultDays(index, keyIndex) {
  return 60 + ((index * 37 + keyIndex * 53) % 240);
}

const dateFor = (days, months) => addMonths(addDays(DEMO_TODAY, days), -months);

/** Створює новий демонстраційний набір (кожен виклик — незалежна копія). */
export function createDemo() {
  const data = createEmpty();
  data.unit = {
    name: 'Демонстраційна частина (синтетичні дані)',
    airfield: 'Зоря',
    signers: { first: 'ПЕТРЕНКО', second: 'КОВАЛЬ' },
    settings: {
      aerobaticsLimit: 4,
      onbMaxShiftMin: 180,
      onbMaxFlightMin: 120,
      ovpMonths: 12,
      ovpBlocks: true,
      onbCriterionPercent: 50,
      timezone: 'Europe/Kyiv',
    },
  };

  let checkNo = 0;
  PEOPLE.forEach((base, index) => {
    const person = { ...base, aircraftKind: 'helicopter', instructor: false, note: null };
    const types = checkTypesForPerson(person);
    const keys = ['medical', 'article205', 'ovp', 'jumps', ...types.map(t => `check:${t.id}`)];
    const days = key => DUE[base.id]?.[key] ?? defaultDays(index, keys.indexOf(key));

    // Медицина: остання подія — за 6 міс до строку; вид чергується.
    const medKind = index % 2 === 0 ? 'ПМО' : 'ВЛК';
    person.medical = base.id === 'p02'
      ? [{ kind: 'ВЛК', date: '2025-10-12' }, { kind: 'ПМО', date: '2026-04-12' }] // наступна ВЛК до 12.10.2026
      : [{ kind: medKind, date: dateFor(days('medical'), 6) }];

    // Стаття 205: найраніший напрям має строк `days`, решта — пізніші.
    const art = days('article205');
    person.article205 = {
      ao: { date: dateFor(art + 40, 6), acceptedBy: 'Спеціаліст АО' },
      reo: { date: dateFor(art + 12, 6), acceptedBy: 'Спеціаліст РЕО' },
      vd_sd: { date: dateFor(art, 6), acceptedBy: 'Спеціаліст ВД' },
      aoz: { date: dateFor(art + 25, 6), acceptedBy: 'Спеціаліст АОз' },
    };

    person.ovp = { date: dateFor(days('ovp'), 12) };

    if (JUMP_EXEMPT[base.id]) {
      person.jumps = [];
      person.jumpExemptUntil = JUMP_EXEMPT[base.id];
    } else {
      person.jumps = (JUMPS[base.id] || [dateFor(days('jumps'), 15)]).map(date => ({ date }));
      person.jumpExemptUntil = null;
    }
    data.persons.push(person);

    for (const type of types) {
      checkNo += 1;
      data.checks.push({
        id: `c${checkNo}`,
        personId: person.id,
        kind: type.id,
        date: dateFor(days(`check:${type.id}`), type.months),
        note: null,
      });
    }
  });

  data.shifts.push({ id: 's1', date: DEMO_TODAY, name: 'Льотна зміна 20.10.2026', note: null });

  // Збережений розрахунок штурмана (синтетичний маршрут; без імен осіб).
  data.navFlights.push({
    id: 'n1',
    title: '20.10.2026 · аер. Зоря – Дубки – Калина – аер. Зоря',
    savedAt: `${DEMO_TODAY}T08:30:00.000Z`,
    flight: {
      date: DEMO_TODAY,
      typeId: 'mi8mtv1',
      board: '123',
      callsign: 'Сокіл-21',
      exercise: '14',
      empty: 7300,
      crew: 270,
      fuelKg: 2092,
      groundMin: 10,
      reserveMin: 30,
      equipment: {},
      cargoOther: 0,
      surcharges: ['evu'],
      departure: { name: 'аер. Зоря', lat: 50.0, lon: 30.0 },
      legs: [
        { kind: 'ppm', name: 'Дубки', mshk: 45, h: 300, v: 200, s: 48, landing: false, lat: 50.2, lon: 30.2 },
        { kind: 'ppm', name: 'Калина', mshk: 120, h: 300, v: 220, s: 65, landing: false, lat: 50.4, lon: 30.5 },
        { kind: 'kpm', name: 'аер. Зоря', mshk: 10, h: 300, v: 200, s: 55, landing: false },
      ],
      takeoff: '09:00',
    },
  });

  // Допуски (самовідмітка пілота, без затвердження).
  data.admissions.push(
    { id: 'a1', personId: 'p03', kind: 'circle', dayNight: 'day', exercise: '3', grantedAt: '2025-09-10', orderRef: null, status: 'valid' },
    { id: 'a2', personId: 'p03', kind: 'zone', dayNight: 'day', exercise: '7', grantedAt: '2025-09-12', orderRef: null, status: 'valid' },
    { id: 'a3', personId: 'p03', kind: 'route', dayNight: 'day', exercise: '14', grantedAt: '2025-10-02', orderRef: null, status: 'valid' },
    { id: 'a4', personId: 'p03', kind: 'route_smu', dayNight: 'day', exercise: '28', grantedAt: '2026-02-10', orderRef: null, status: 'valid' },
    { id: 'a5', personId: 'p03', kind: 'site', dayNight: 'day', exercise: '9', grantedAt: '2026-08-12', orderRef: null, status: 'valid' },
    { id: 'a6', personId: 'p01', kind: 'circle', dayNight: 'day', exercise: '3', grantedAt: '2025-05-20', orderRef: null, status: 'valid' },
    { id: 'a7', personId: 'p01', kind: 'route', dayNight: 'day', exercise: '14', grantedAt: '2026-10-20', orderRef: null, status: 'valid' },
    { id: 'a8', personId: 'p06', kind: 'route', dayNight: 'day', exercise: '14', grantedAt: '2026-06-01', orderRef: null, status: 'valid' },
    { id: 'a9', personId: 'p10', kind: 'bt_solo', dayNight: 'day', exercise: '260', grantedAt: '2026-06-01', orderRef: null, status: 'valid' },
    { id: 'a10', personId: 'p12', kind: 'bt_solo', dayNight: 'day', exercise: '260', grantedAt: '2026-04-15', orderRef: null, status: 'valid' },
  );

  // Хронометраж зміни 20.10.2026: 6 екіпажів, 23 польоти, 11:40.
  const flight = (n, personId, crew, exercise, count, airtimeMin, extra = {}) => ({
    id: `f${n}`,
    date: DEMO_TODAY,
    shiftId: 's1',
    personId,
    crew,
    exercise,
    count,
    airtimeMin,
    dayNight: 'day',
    meteo: 'ПМУ',
    aircraftType: null,
    tailNumber: null,
    source: 'timekeeper',
    note: null,
    ...extra,
  });
  data.flights.push(
    flight(1, 'p01', ['Сокіл-21', 'Орлан-18', 'Стріла-05'], '14', 2, 85),
    flight(2, 'p04', ['Яструб-07', 'Сапсан-31', 'Вогник-11'], '20', 4, 150),
    flight(3, 'p03', ['Кречет-33', 'Орлан-18', 'Вогник-11'], '14', 4, 120),
    flight(4, 'p05', ['Лелека-09', 'Сапсан-31', 'Стріла-05'], '9', 5, 125),
    flight(5, 'p05', ['Лелека-09', 'Орлан-18', 'Вогник-11'], '7', 4, 105),
    flight(6, 'p03', ['Кречет-33', 'Сапсан-31', 'Стріла-05'], '3', 4, 115),
  );
  return data;
}
