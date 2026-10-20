// EasyFLY: чиста логіка екранів «Штурман» і «Сонце і Місяць» (views/navigator-core.js).
// Лише синтетичні дані (умовні ПЕТРЕНКО, КОВАЛЬ, аеродром Зоря).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPoints,
  csvBytes,
  csvCell,
  csvFileName,
  dateUk,
  daySegments,
  defaultDraft,
  demoDraft,
  docRows,
  draftToFlight,
  fmtDuration,
  fmtInt,
  formatCoord,
  fuelForPreset,
  fuelPresetsFor,
  navSession,
  newLeg,
  onbThreshold,
  parseCoord,
  parseNum,
  resetNavSession,
  shiftDate,
  signersFromUnit,
  signersNote,
  summarize,
  sunMoonModel,
  toCsv,
} from '../src/workspace/easyfly/views/navigator-core.js';
import { calcIshr } from '../src/workspace/easyfly/nav-core.js';
import { renderIshrHtml } from '../src/workspace/easyfly/nav-docs.js';

const UNIT = { name: 'Синтетична частина', airfield: 'Зоря', signers: { first: 'ПЕТРЕНКО', second: 'КОВАЛЬ' }, settings: { onbCriterionPercent: 50 } };

test('parseNum: кома, пробіли, порожнє й хибне', () => {
  assert.equal(parseNum('2 092'), 2092);
  assert.equal(parseNum('11,55'), 11.55);
  assert.equal(parseNum(' -4 '), -4);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('abc'), null);
  assert.equal(parseNum('1e3'), null);
  assert.equal(parseNum(NaN), null);
  assert.equal(parseNum(7), 7);
});

test('fmtInt ставить нерозривний пробіл і не ламається на порожньому', () => {
  assert.equal(fmtInt(10759), '10 759');
  assert.equal(fmtInt(13000), '13 000');
  assert.equal(fmtInt(null), '—');
  assert.equal(fmtInt(NaN), '—');
});

test('defaultDraft: порожня вага й борт, аеродром із налаштувань', () => {
  const d = defaultDraft({ today: '2026-10-20', unit: UNIT });
  assert.equal(d.date, '2026-10-20');
  assert.equal(d.empty, '');
  assert.equal(d.board, '');
  assert.equal(d.departure.name, 'аер. Зоря');
  assert.equal(d.legs.length, 2);
  const s = summarize(d, UNIT);
  assert.equal(s.blocking, true);
  assert.equal(s.state, 'incomplete');
  assert.ok(s.issues.some(m => m.includes('вагу порожнього')));
  assert.equal(s.total, null);
  assert.equal(s.ishr, null);
});

test('демо-чернетка дає 10 759 кг і збігається з calcIshr прототипу', () => {
  const d = demoDraft({ today: '2026-10-20', unit: UNIT });
  const s = summarize(d, UNIT);
  assert.deepEqual(s.issues, []);
  assert.equal(s.blocking, false);
  assert.equal(s.total, 10759);
  assert.equal(s.mtow, 13000);
  assert.equal(s.massOk, true);
  assert.equal(s.state, 'ok');
  assert.equal(s.massLine, 'Злітна маса в межах: 10 759 / 13 000 кг');
  assert.equal(s.cargo, 1097);
  assert.equal(s.fuelL, 2615);
  assert.equal(s.qAir, 689);
  assert.equal(s.qGround, 370);
  assert.equal(s.totalKm, 290);
  assert.equal(s.reserveKg, 344);
  assert.equal(s.routeFuelKg, 161 + 207 + 195 + 218 + 184);
  assert.equal(s.remainKg, 721);
  assert.equal(fmtDuration(s.airTimeMin), '1:25:43');
  assert.equal(calcIshr(s.flight).total, s.total);
});

test('перевищення маси — попередження, не блокування', () => {
  const d = demoDraft({ unit: UNIT });
  d.empty = '11000';
  const s = summarize(d, UNIT);
  assert.equal(s.massOk, false);
  assert.equal(s.state, 'over');
  assert.equal(s.blocking, false);
  assert.ok(s.warnings[0].startsWith('Злітна маса'));
  assert.ok(s.massLine.includes('перевищена'));
});

test('нестача палива дає стан fuel', () => {
  const d = demoDraft({ unit: UNIT });
  d.fuelKg = '900';
  const s = summarize(d, UNIT);
  assert.equal(s.state, 'fuel');
  assert.ok(s.warnings.some(m => m.includes('Палива не вистачає')));
});

test('Мі-2: норми маси немає — перевірку маси пропущено', () => {
  const d = demoDraft({ unit: UNIT });
  d.typeId = 'mi2msb';
  const s = summarize(d, UNIT);
  assert.equal(s.mtow, null);
  assert.equal(s.massOk, null);
  assert.ok(s.massLine.includes('норму маси'));
});

test('draftToFlight: порожні ділянки відкидаються, відсутні числа → помилки валідації', () => {
  const d = demoDraft({ unit: UNIT });
  d.legs.push(newLeg());
  d.legs[1].v = '';
  const f = draftToFlight(d, UNIT);
  assert.equal(f.legs.length, 5);
  const s = summarize(d, UNIT);
  assert.ok(s.issues.some(m => m.includes('Ділянка 2') && m.includes('швидкість')));
  d.legs[0].mshk = '';
  assert.ok(summarize(d, UNIT).issues.some(m => m.includes('Ділянка 1') && m.includes('шляховий кут')));
});

test('draftToFlight: вітер, нарахування й обладнання', () => {
  const f = draftToFlight(demoDraft({ unit: UNIT }), UNIT);
  assert.deepEqual(f.wind, { from: 270, speedMs: 8 });
  assert.deepEqual(f.windActual, { from: 250, speedMs: 10 });
  assert.deepEqual(f.surcharges, ['evu', 'trussesBlock']);
  assert.deepEqual(f.equipment, { trusses: 2, blocksB8V20: 2, s8: 40, armor: true });
  const d = defaultDraft({ unit: UNIT });
  d.wind.speedMs = '5';
  assert.deepEqual(draftToFlight(d, UNIT).wind, { from: 0, speedMs: 5 });
  d.wind.speedMs = '';
  assert.equal(draftToFlight(d, UNIT).wind, undefined);
});

test('підписанти з налаштувань частини: необов’язкові', () => {
  const { iasChief, seniorNav } = signersFromUnit(UNIT);
  assert.deepEqual(iasChief, { rank: '', name: 'ПЕТРЕНКО' });
  assert.deepEqual(seniorNav, { rank: '', name: 'КОВАЛЬ' });
  assert.equal(signersNote(UNIT), 'Підписанти (ПЕТРЕНКО, КОВАЛЬ) беруться з Налаштувань частини, необов’язкові.');
  assert.deepEqual(signersFromUnit({}), { iasChief: undefined, seniorNav: undefined });
  assert.ok(signersNote({}).includes('необов’язкові'));
  const html = renderIshrHtml(draftToFlight(demoDraft({ unit: UNIT }), UNIT));
  assert.ok(html.includes('ПЕТРЕНКО') && html.includes('КОВАЛЬ'));
  // без підписантів документ усе одно будується
  assert.ok(renderIshrHtml(draftToFlight(demoDraft({ unit: UNIT }), null)).includes('<!doctype html>'));
});

test('заправка типу: кг із довідника, Мі-8 МТПБ без варіантів', () => {
  assert.equal(fuelForPreset('mi8mtv1', 'main'), 2092);
  assert.equal(fuelForPreset('mi8mtv1', 'dpb1'), 2824);
  assert.equal(fuelForPreset('mi8mtpb', 'main'), null);
  assert.deepEqual(fuelPresetsFor('mi8mtpb').map(p => p.id), ['manual']);
  assert.deepEqual(fuelPresetsFor('mi8mtv1').map(p => p.id), ['main', 'dpb1', 'dpb2', 'manual']);
});

test('csvCell: числа з комою, цитування, захист від формул', () => {
  assert.equal(csvCell(11.55), '11,55');
  assert.equal(csvCell(-4), '-4');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(true), 'так');
  assert.equal(csvCell('а;б'), '"а;б"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('рядок\nдва'), '"рядок\nдва"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+7'), "'+7");
  assert.equal(csvCell('@SUM'), "'@SUM");
  assert.equal(csvCell('-abc'), "'-abc");
  assert.equal(csvCell('-5 км'), '-5 км');
  assert.equal(csvCell(' пробіл'), '" пробіл"');
});

test('toCsv: BOM, роздільник «;», CRLF, UTF-8', () => {
  const csv = toCsv([['Назва', 'Вага'], ['Ферми', 2.5], []]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv, '﻿Назва;Вага\r\nФерми;2,5\r\n\r\n');
  assert.equal(toCsv([['a', 'b']], { bom: false, delimiter: ',' }), 'a,b\r\n');
  assert.equal(toCsv([]), '﻿');
  const bytes = csvBytes([['Щ']]);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(bytes.slice(3)), 'Щ\r\n');
});

test('csvFileName: лише латиниця й цифри', () => {
  assert.equal(csvFileName('ishr', { date: '2026-10-20', board: '123' }), 'ishr_2026-10-20_board-123.csv');
  assert.equal(csvFileName('shpp', { date: '', board: 'Б 5/1' }), 'shpp_bez-daty_board-5-1.csv');
  assert.equal(csvFileName('bortjournal', { date: '2026-10-20', board: '' }), 'bortjournal_2026-10-20.csv');
});

test('docRows: ІШР містить числа аркуша, БЖ і ШПП — таблиці без NaN', () => {
  const flight = draftToFlight(demoDraft({ unit: UNIT }), UNIT);
  const ishr = docRows('ishr', flight);
  const header = ishr.find(row => row[0] === 'Контрольні рубежі');
  assert.deepEqual(header, ['Контрольні рубежі', 'Зліт', 'ППМ 1 Дубки', 'ППМ 2 Калина', 'ППМ 3 Полігон', 'ППМ 4 Явір', 'КПМ аер. Зоря', 'НЗ']);
  const total = ishr.find(row => row[0] === 'РАЗОМ');
  assert.equal(total[1], 10759);
  const remains = ishr.find(row => row[0] === 'Залишок палива (кг)');
  assert.deepEqual(remains.slice(1), [2030, 1869, 1662, 1467, 1249, 1065, 721]);
  assert.ok(ishr.some(row => String(row[1]).includes('ПЕТРЕНКО')));
  for (const kind of ['ishr', 'bortjournal', 'shpp']) {
    const csv = toCsv(docRows(kind, flight));
    assert.ok(!csv.includes('NaN') && !csv.includes('undefined'), kind);
    assert.ok(csv.split('\r\n').length > 6, kind);
  }
  const bj = docRows('bortjournal', flight);
  assert.ok(bj.some(row => row[0] === 'Усього за маршрутом'));
  assert.ok(bj.some(row => row[0] === 'Пункти'));
  const shpp = docRows('shpp', flight);
  assert.equal(shpp[3].length, shpp[4].length);
  assert.ok(shpp.some(row => row[1] === 'Разом'));
  assert.throws(() => docRows('xxx', flight), RangeError);
});

test('parseCoord / formatCoord / dateUk / shiftDate', () => {
  assert.equal(parseCoord('50,45', 'lat'), 50.45);
  assert.equal(parseCoord('91', 'lat'), null);
  assert.equal(parseCoord('181', 'lon'), null);
  assert.equal(parseCoord('-30.5', 'lon'), -30.5);
  assert.equal(parseCoord('', 'lat'), null);
  assert.equal(formatCoord(50.0, 30.0), '50,0° пн. ш., 30,0° сх. д.');
  assert.equal(formatCoord(-10.25, -5), '10,3° пд. ш., 5,0° зх. д.');
  assert.equal(dateUk('2026-10-20'), '20.10.2026');
  assert.equal(shiftDate('2026-10-31', 1), '2026-11-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDate('xx', 1), 'xx');
});

test('buildPoints: аеродром, пункти з координатами, додані вручну; імена не повторюються', () => {
  const flight = draftToFlight(demoDraft({ unit: UNIT }), UNIT);
  const points = buildPoints({ flight, unit: UNIT });
  assert.deepEqual(points.map(p => p.name), ['аер. Зоря', 'Дубки', 'Калина', 'Полігон', 'Явір']);
  assert.equal(points[0].source, 'flight');
  const extra = buildPoints({ flight, unit: UNIT, extra: [{ name: 'Дубки', lat: 1, lon: 1 }, { name: 'Ліс', lat: 49.5, lon: 31 }] });
  assert.equal(extra.length, 6);
  assert.equal(extra[5].source, 'extra');
  const manual = buildPoints({ flight: null, unit: UNIT, airfield: { lat: 50.45, lon: 30.52 } });
  assert.deepEqual(manual, [{ name: 'аер. Зоря', lat: 50.45, lon: 30.52, source: 'manual' }]);
  const conditional = buildPoints({ unit: UNIT });
  assert.equal(conditional[0].source, 'conditional');
  assert.equal(conditional[0].lat, 50);
  const settings = buildPoints({ unit: { ...UNIT, settings: { airfieldLat: '48,5', airfieldLon: '35' } } });
  assert.deepEqual([settings[0].lat, settings[0].lon, settings[0].source], [48.5, 35, 'settings']);
});

test('onbThreshold: за замовчуванням 50, береться з налаштувань', () => {
  assert.equal(onbThreshold(UNIT), 50);
  assert.equal(onbThreshold({ settings: { onbCriterionPercent: 70 } }), 70);
  assert.equal(onbThreshold({ settings: { onbCriterionPercent: 700 } }), 50);
  assert.equal(onbThreshold(null), 50);
});

test('sunMoonModel 20.10.2026, 50.0 / 30.0: збігається з еталоном прототипу', () => {
  const points = buildPoints({ unit: UNIT });
  const m = sunMoonModel({ date: '2026-10-20', points, threshold: 50 });
  assert.equal(m.dateLabel, '20.10.2026');
  assert.equal(m.sun.sunrise, '07:29');
  assert.equal(m.sun.sunset, '17:59');
  assert.equal(m.sun.nauticalDawn, '06:19');
  assert.equal(m.sun.dusk, '18:32');
  assert.equal(m.sun.dayLengthText, '10 год 30 хв');
  assert.equal(m.moon.illumination, 71);
  assert.equal(m.moon.phaseText, 'Зростаючий');
  assert.equal(m.moon.ageText, 'вік 9,4 дня');
  assert.equal(m.moon.rise, '15:48');
  assert.equal(m.moon.set, '01:31 (21.10)');
  assert.ok(Math.abs(Number(m.moon.transit.slice(3)) + 60 * Number(m.moon.transit.slice(0, 2)) - (20 * 60 + 39)) <= 2);
  assert.equal(m.moon.maxAltitudeText, '24,6°');
  assert.equal(m.onb.favourable, true);
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].moonText, '71 % · зростаючий');
  assert.equal(m.rows[0].coordsText, '50,0° пн. ш., 30,0° сх. д.');
  const total = m.strip.segments.reduce((sum, seg) => sum + seg.pct, 0);
  assert.ok(Math.abs(total - 100) < 1e-9);
  assert.deepEqual(m.strip.segments.map(seg => seg.kind), ['night', 'nautical', 'civil', 'day', 'civil', 'nautical', 'night']);
  assert.deepEqual(m.strip.ticks, ['00:00', '06:19', '07:29', '17:59', '19:09', '24:00']);
});

test('ОНБ: поріг із налаштувань змінює індикатор; молодик — несприятлива ніч', () => {
  const points = buildPoints({ unit: UNIT });
  assert.equal(sunMoonModel({ date: '2026-10-20', points, threshold: 80 }).onb.favourable, false);
  const newMoon = sunMoonModel({ date: '2026-10-10', points, threshold: 50 });
  assert.equal(newMoon.moon.illumination, 0);
  assert.equal(newMoon.onb.favourable, false);
});

test('sunMoonModel: хибна дата чи порожні точки → null; індекс обрізається', () => {
  const points = buildPoints({ unit: UNIT });
  assert.equal(sunMoonModel({ date: 'xx', points }), null);
  assert.equal(sunMoonModel({ date: '2026-10-20', points: [] }), null);
  assert.equal(sunMoonModel({ date: '2026-10-20', points, index: 9 }).point.name, 'аер. Зоря');
});

test('polar: смужка доби без падіння', () => {
  const polar = sunMoonModel({ date: '2026-06-21', points: [{ name: 'Північ', lat: 70, lon: 30 }] });
  assert.equal(polar.sun.rows[2].value, '—');
  assert.equal(polar.sun.dayLengthText, '—');
  assert.ok(polar.strip.segments.length >= 1);
  assert.equal(daySegments({}).length, 1);
});

test('navSession: скидання', () => {
  navSession.draft = { x: 1 };
  navSession.tab = 'ishr';
  resetNavSession();
  assert.equal(navSession.draft, null);
  assert.equal(navSession.tab, 'calc');
});
