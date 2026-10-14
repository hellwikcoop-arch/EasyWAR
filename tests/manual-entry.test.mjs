// «Довільне внесення» у вкладці «Внесення доповідей» модулів ПС (air.html) і РВ (rocket.html).
// Ядро (src/manual-entry-core.js) перевіряється разом зі справжнім CORE legacy-сторінок: його текст дістається з air.html
// і rocket.html та виконується ізольовано, запис іде в порожні базові таблиці. Дані лише синтетичні.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as ME from '../src/manual-entry-core.js';

const readSrc = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
// Об'єкти з vm мають інший Object.prototype, тому для deepEqual їх спершу переводимо в звичайний JSON.
const J = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const pages = {
  air: await readSrc('air.html'),
  rocket: await readSrc('rocket.html'),
};

function legacyCore(page) {
  const html = pages[page];
  const marker = html.indexOf('CORE — робота з .xlsx');
  assert.notEqual(marker, -1, `${page}.html: CORE-скрипт знайдено`);
  const start = html.lastIndexOf('<script>', marker);
  const end = html.indexOf('</script>', marker);
  const module = { exports: {} };
  // Базові таблиці стиснуті, тому CORE потрібні потокові (де)компресори; решту дає сам vm.
  vm.runInNewContext(html.slice(start + '<script>'.length, end), { module, TextEncoder, TextDecoder, CompressionStream, DecompressionStream }, { filename: `${page}-core.js`, timeout: 5000 });
  return module.exports;
}

const cores = { air: legacyCore('air'), rocket: legacyCore('rocket') };
const template = async (file) => new Uint8Array(await readFile(new URL(`../src-tauri/resources/base-tables/${file}`, import.meta.url)));
const BASE = { air: 'air-base.xlsx', rocket: 'rvia-base.xlsx' };

// Мінімальна книга з довільними заголовками (без довідників і стилів): перевіряє таблиці без необов'язкових стовпців.
const xmlEscape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function column(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}
async function workbookWithHeaders(core, headers) {
  const cells = headers.map((value, index) => `<c r="${column(index)}1" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join('');
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`;
  const encoder = new TextEncoder();
  const parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Зведена" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  return core.writeZip(Object.entries(parts).map(([name, content]) => ({
    name, nameBytes: encoder.encode(name), flags: 0x0800, time: 0, date: 0, newData: encoder.encode(content),
  })));
}

const TODAY = '2026-10-14';

/** Повна чернетка: усе, що може внести користувач. */
function fullDraft(profile, extra = {}) {
  return Object.assign(ME.emptyDraft('2026-10-12'), {
    time: '14:55', targets: 'TS1234', unit: '95 ОДШБр', district: 'Тестове 3',
    dpi: '37U DQ 12345 67890', types: ['КСП'], aircraft: profile === 'rocket' ? 'М142' : 'МіГ-29',
    munition: profile === 'rocket' ? 'M30A2' : 'GBU-39', count: '4', result: profile === 'rocket' ? 'ЗНИЩЕНО' : 'УРАЖЕНО',
    note: 'Синтетичний запис',
  }, profile === 'rocket' ? { targets: 'G-1234', crew: 'рук', firingUnit: 'Тестова ВБр 1' } : {}, extra);
}

/* ------------------------------------------------------------------ */
/*  Поля форми за стовпцями                                             */
/* ------------------------------------------------------------------ */

test('профіль: стовпець «Підрозділ (від кого машина)» є лише в РВ', () => {
  assert.equal(ME.profileOf(cores.air), 'air');
  assert.equal(ME.profileOf(cores.rocket), 'rocket');
});

test('ПС: поля форми — це стовпці таблиці з її власними заголовками й літерами Excel', async () => {
  const wb = await cores.air.openWorkbook(await template(BASE.air));
  const fields = ME.manualFields(cores.air, wb);
  assert.deepEqual(fields.map(f => [f.key, f.label, f.letter]), [
    ['date', 'Дата', 'B'], ['time', 'Час ураження', 'C'], ['targets', '№ цілі (TS/KS)', 'D'], ['unit', 'В інтересах', 'E'],
    ['district', 'Район / н.п.', 'F'], ['aircraft', 'Тип ЛА', 'J'], ['munition', 'Тип боєприпасу', 'K'], ['count', 'К-сть боєприпасів', 'L'],
    ['result', 'Результат ураження', 'M'], ['types', 'Тип цілі', 'H'], ['cause', 'Причина', 'N'],
    ['dpi', 'DPI / Координати MGRS', 'G'], ['note', 'Уточнення результату', 'O'],
  ]);
  assert.deepEqual(fields.find(f => f.key === 'result').options, ['УРАЖЕНО', 'ЧАСТКОВО УРАЖЕНО', 'НЕ УРАЖЕНО']);
  assert.equal(fields.find(f => f.key === 'types').dict, 'typeDict');
  assert.equal(fields.find(f => f.key === 'cause').dict, 'causeDict');
  assert.deepEqual(J(ME.autoColumns(cores.air, wb)), [{ column: 'num', label: '№', letter: 'A' }, { column: 'month', label: 'Місяць', letter: 'I' }]);
});

test('РВ: додаються стовпці «Підрозділ (від кого машина)» і «Вогнева бригада», підписи — як у таблиці РВ', async () => {
  const wb = await cores.rocket.openWorkbook(await template(BASE.rocket));
  const fields = ME.manualFields(cores.rocket, wb);
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  assert.equal(byKey.crew.label, 'Підрозділ (від кого машина)');
  assert.equal(byKey.crew.letter, 'P');
  assert.equal(byKey.firingUnit.label, 'Вогнева бригада');
  assert.equal(byKey.firingUnit.letter, 'Q');
  assert.equal(byKey.aircraft.label, 'Тип ПУ');
  assert.equal(byKey.targets.label, '№ цілі');
  assert.deepEqual(byKey.result.options, ['ПОДАВЛЕНО', 'ПОШКОДЖЕНО', 'ЗНИЩЕНО', 'НЕ УРАЖЕНО']);
  assert.equal(fields.length, 15, 'п’ятнадцять полів: два автоматичні стовпці (№, Місяць) у форму не входять');
  assert.deepEqual(fields.map(f => f.key).slice(0, 6), ['date', 'time', 'targets', 'unit', 'crew', 'firingUnit']);
});

test('РВ без необов’язкових стовпців: у формі їх немає, а запис усе одно додається', async () => {
  const core = cores.rocket;
  const headers = core.FIELD_ORDER.filter(f => f !== 'crew' && f !== 'firingUnit').map(f => core.FIELD_HEADERS[f]);
  const bytes = await workbookWithHeaders(core, headers);
  const wb = await core.openWorkbook(bytes);
  const fields = ME.manualFields(core, wb);
  assert.ok(!fields.some(f => f.key === 'crew' || f.key === 'firingUnit'));
  assert.equal(fields.length, 13);
  const analysis = ME.analyzeDraft(fullDraft('rocket'), { profile: 'rocket', today: TODAY });
  const res = await core.appendRows(bytes, [core.toRow(analysis.record)]);
  const after = await core.openWorkbook(res.bytes);
  assert.equal(after.records.length, 1);
  assert.equal(after.records[0].targets, 'G-1234');
  assert.equal(ME.previewCells(core, wb, analysis.record, 1).length, 15, 'у рядку лише наявні стовпці');
});

test('номер стовпця Excel', () => {
  assert.equal(ME.columnNumber('A'), 1);
  assert.equal(ME.columnNumber('Z'), 26);
  assert.equal(ME.columnNumber('AA'), 27);
  assert.equal(ME.columnNumber(''), 0);
});

/* ------------------------------------------------------------------ */
/*  Окремі значення                                                     */
/* ------------------------------------------------------------------ */

test('час: ГГ:ХХ у різних записах, порожнє — порожньо, неправильне — null', () => {
  assert.equal(ME.normalizeTime('14:55'), '14:55');
  assert.equal(ME.normalizeTime(' 9:05 '), '09:05');
  assert.equal(ME.normalizeTime('14.55'), '14:55');
  assert.equal(ME.normalizeTime('1455'), '14:55');
  assert.equal(ME.normalizeTime('905'), '09:05');
  assert.equal(ME.normalizeTime('14:55:30'), '14:55');
  assert.equal(ME.normalizeTime('00:00'), '00:00');
  assert.equal(ME.normalizeTime('23:59'), '23:59');
  assert.equal(ME.normalizeTime(''), '');
  assert.equal(ME.normalizeTime('   '), '');
  for (const bad of ['24:00', '12:60', '14', '1', 'пів на третю', '14:5', '99:99', '12:345']) assert.equal(ME.normalizeTime(bad), null, bad);
});

test('дата: лише справжні дати у форматі рррр-мм-дд з 2000 до 2100 року', () => {
  assert.ok(ME.isValidIsoDate('2026-10-14'));
  assert.ok(ME.isValidIsoDate('2024-02-29'), 'високосний рік');
  assert.ok(!ME.isValidIsoDate('2026-02-29'));
  assert.ok(!ME.isValidIsoDate('2026-13-01'));
  assert.ok(!ME.isValidIsoDate('2026-04-31'));
  assert.ok(!ME.isValidIsoDate('14.10.2026'));
  assert.ok(!ME.isValidIsoDate('1999-12-31'));
  assert.ok(!ME.isValidIsoDate('20261-01-01'), 'шестизначний рік, який дозволяє поле дати');
  assert.ok(!ME.isValidIsoDate(''));
  assert.ok(!ME.isValidIsoDate(undefined));
  assert.equal(ME.todayIso(new Date(2026, 9, 4)), '2026-10-04');
});

test('кількість БП: ціле число без нулів попереду', () => {
  assert.equal(ME.normalizeCount('4'), '4');
  assert.equal(ME.normalizeCount(' 04 '), '4');
  assert.equal(ME.normalizeCount('0'), '0');
  assert.equal(ME.normalizeCount('9999'), '9999');
  assert.equal(ME.normalizeCount(''), '');
  for (const bad of ['-1', '2.5', '2,5', 'чотири', '10000', '1e3', '4 шт']) assert.equal(ME.normalizeCount(bad), null, bad);
});

test('номери цілей ПС: TS/KS латиницею без пробілу, розділювачі — кома, пробіл, новий рядок', () => {
  assert.equal(ME.normalizeTargets('ts 1234', 'air'), 'TS1234');
  assert.equal(ME.normalizeTargets('ТС-1234', 'air'), 'TS1234', 'кирилична ТС із дефісом');
  assert.equal(ME.normalizeTargets('кс7601', 'air'), 'KS7601');
  assert.equal(ME.normalizeTargets('TS1234 KS7601', 'air'), 'TS1234, KS7601');
  assert.equal(ME.normalizeTargets('TS1234;\nKS7601 , TS1234', 'air'), 'TS1234, KS7601', 'дублі прибираються');
  assert.equal(ME.normalizeTargets('SYN-001', 'air'), 'SYN-001', 'невідомий формат не чіпаємо');
  assert.equal(ME.normalizeTargets('', 'air'), '');
});

test('номери цілей РВ: формат довільний, чіпаємо лише розділювачі', () => {
  assert.equal(ME.normalizeTargets('G-1234', 'rocket'), 'G-1234');
  assert.equal(ME.normalizeTargets('  G - 1234 ', 'rocket'), 'G - 1234', 'пробіли всередині номера не розривають його');
  assert.equal(ME.normalizeTargets('12345, 12346\n12347', 'rocket'), '12345, 12346, 12347');
  assert.equal(ME.normalizeTargets('ts 1234', 'rocket'), 'ts 1234', 'у РВ TS/KS не перетворюється');
});

test('РУК / ГРВ: великі літери, латинські двійники — кирилицею', () => {
  assert.equal(ME.normalizeCrew('рук'), 'РУК');
  assert.equal(ME.normalizeCrew(' грв '), 'ГРВ');
  assert.equal(ME.normalizeCrew('PYK'), 'РУК');
  assert.equal(ME.normalizeCrew('—'), '');
  assert.equal(ME.normalizeCrew(''), '');
});

test('очищення тексту: керувальні й невидимі символи зникають, рядки обрізаються', () => {
  assert.equal(ME.oneLine('  Тестове \t  місце \n\r\n 3 '), 'Тестове місце 3');
  assert.equal(ME.oneLine('A\u0000B\u0007C​﻿D'), 'ABCD');
  assert.equal(ME.oneLine('Лише \uD800 суррогат'), 'Лише суррогат');
  assert.equal(ME.oneLine(null), '');
  assert.equal(ME.multiLine('  перший  \r\n\n\n\n  другий   рядок  \n'), 'перший\n\nдругий рядок');
  assert.equal(ME.multiLine('\n\n'), '');
});

/* ------------------------------------------------------------------ */
/*  Координати MGRS                                                     */
/* ------------------------------------------------------------------ */

test('DPI: голі координати записуються по рядку «DPI n: …», як це робить внесення зі звіту', () => {
  const one = ME.normalizeDpi('37U DQ 12345 67890');
  assert.deepEqual(J(one), { text: 'DPI 1: 37U DQ 12345 67890', points: 1, canonical: true });
  const two = ME.normalizeDpi('37u dq 12345 67890\n  37U DQ 12360 67901 ');
  assert.equal(two.text, 'DPI 1: 37U DQ 12345 67890\nDPI 2: 37U DQ 12360 67901');
  assert.equal(two.points, 2);
});

test('DPI: позначки користувача зберігаються, діапазони зсувають нумерацію, кириличні двійники стають латиницею', () => {
  assert.equal(ME.normalizeDpi('DPI 3: 37U DQ 12345 67890').text, 'DPI 3: 37U DQ 12345 67890');
  assert.equal(ME.normalizeDpi('DPI 1 – 2: 37U DQ 12345 67890\n37U DQ 12360 67901').text, 'DPI 1-2: 37U DQ 12345 67890\nDPI 3: 37U DQ 12360 67901');
  assert.equal(ME.normalizeDpi('37U DQ12345 67890').text, 'DPI 1: 37U DQ 12345 67890', 'пробіли між групами необов’язкові');
  assert.equal(ME.normalizeDpi('37U DQ 12345 67890\n37U DQ 12345 67890').text, 'DPI 1: 37U DQ 12345 67890\nDPI 2: 37U DQ 12345 67890', 'різні позначки — різні рядки');
  // кирилична «С» у квадраті — двійник латинської C
  assert.equal(ME.normalizeDpi('37U СР 12345 67890').text, 'DPI 1: 37U CP 12345 67890');
});

test('DPI: текст поза координатами не губиться — поле лишається як введено', () => {
  const mixed = ME.normalizeDpi('біля мосту 37U DQ 12345 67890');
  assert.deepEqual(J(mixed), { text: 'біля мосту 37U DQ 12345 67890', points: 1, canonical: false });
  const none = ME.normalizeDpi('37U II 12345 67890');
  assert.deepEqual(J(none), { text: '37U II 12345 67890', points: 0, canonical: false }, 'літери I та O не бувають у квадраті MGRS');
  assert.equal(ME.normalizeDpi('37U ДQ 12345 67890').points, 0, 'кирилична Д не має латинського двійника, тож квадрат не розпізнається');
  assert.deepEqual(J(ME.normalizeDpi('')), { text: '', points: 0, canonical: false });
  assert.equal(ME.findMgrs('99U DQ 12345 67890').length, 0, 'зон лише 1–60');
});

/* ------------------------------------------------------------------ */
/*  Чернетка, запис і перевірка                                         */
/* ------------------------------------------------------------------ */

test('чернетка для наступного запису лишає дату й «хто стріляв», решту очищає', () => {
  const draft = fullDraft('rocket', { types: ['КСП'], cause: ['ППО'] });
  const next = ME.stickyDraft(draft, TODAY);
  assert.deepEqual(next, Object.assign(ME.emptyDraft('2026-10-12'), { aircraft: 'М142', crew: 'рук', firingUnit: 'Тестова ВБр 1' }));
  assert.equal(ME.stickyDraft(ME.emptyDraft(''), TODAY).date, TODAY, 'порожня дата замінюється сьогоднішньою');
  assert.notEqual(next.types, draft.types, 'масиви не спільні з попередньою чернеткою');
});

test('запис: типи й причини — масиви, порожній тип стає «Інше», РВ додає РУК/ГРВ і бригаду', () => {
  const air = ME.analyzeDraft(fullDraft('air', { dpi: '37U DQ 12345 67890', types: [], cause: ['ППО', 'ППО', ' РЕБ '] }), { profile: 'air', today: TODAY });
  assert.deepEqual(J(air.record), {
    date: '2026-10-12', time: '14:55', targets: 'TS1234', unit: '95 ОДШБр', district: 'Тестове 3', dpi: 'DPI 1: 37U DQ 12345 67890',
    types: ['Інше'], aircraft: 'МіГ-29', munition: 'GBU-39', count: '4', result: 'УРАЖЕНО', cause: ['ППО', 'РЕБ'], note: 'Синтетичний запис',
  });
  assert.ok(!('crew' in air.record) && !('firingUnit' in air.record));
  const rocket = ME.analyzeDraft(fullDraft('rocket'), { profile: 'rocket', today: TODAY });
  assert.equal(rocket.record.crew, 'РУК');
  assert.equal(rocket.record.firingUnit, 'Тестова ВБр 1');
  assert.equal(rocket.record.targets, 'G-1234');
});

test('перевірка: без дати, цілі й координат або з поганим часом чи кількістю запис не додається', () => {
  const blank = ME.analyzeDraft(ME.emptyDraft(''), { profile: 'air', today: TODAY });
  assert.equal(blank.ok, false);
  assert.deepEqual(Object.keys(blank.errors).sort(), ['date', 'targets']);
  const bad = ME.analyzeDraft(fullDraft('air', { time: '25:99', count: '2,5' }), { profile: 'air', today: TODAY });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['count', 'time']);
  assert.match(bad.errors.time, /ГГ:ХХ/);
  const onlyDpi = ME.analyzeDraft(Object.assign(ME.emptyDraft(TODAY), { dpi: '37U DQ 12345 67890' }), { profile: 'air', today: TODAY });
  assert.equal(onlyDpi.ok, true, 'достатньо координат без номера цілі');
  assert.ok(onlyDpi.empty.includes('targets'), 'але про порожній номер цілі нагадуємо');
  const onlyTarget = ME.analyzeDraft(Object.assign(ME.emptyDraft(TODAY), { targets: 'TS1234' }), { profile: 'air', today: TODAY });
  assert.equal(onlyTarget.ok, true, 'достатньо номера цілі без координат');
  assert.ok(onlyTarget.empty.includes('dpi'));
});

test('перевірка: підозріле дозволене, але з попередженням', () => {
  const future = ME.analyzeDraft(fullDraft('air', { date: '2026-10-15' }), { profile: 'air', today: TODAY });
  assert.ok(future.ok && future.warnings.date);
  const sameDay = ME.analyzeDraft(fullDraft('air', { date: TODAY }), { profile: 'air', today: TODAY });
  assert.equal(sameDay.warnings.date, undefined);
  const noMgrs = ME.analyzeDraft(fullDraft('air', { dpi: 'координати уточнюються' }), { profile: 'air', today: TODAY });
  assert.ok(noMgrs.ok && /не розпізнано/.test(noMgrs.warnings.dpi));
  const mixed = ME.analyzeDraft(fullDraft('air', { dpi: 'біля мосту 37U DQ 12345 67890' }), { profile: 'air', today: TODAY });
  assert.ok(mixed.ok && /інший текст/.test(mixed.warnings.dpi));
  const noTypes = ME.analyzeDraft(fullDraft('air', { types: [] }), { profile: 'air', today: TODAY });
  assert.match(noTypes.warnings.types, /«Інше»/);
  const contradiction = ME.analyzeDraft(fullDraft('air', { result: 'УРАЖЕНО', cause: ['ППО'] }), { profile: 'air', today: TODAY });
  assert.match(contradiction.warnings.cause, /причину невдачі/);
  const miss = ME.analyzeDraft(fullDraft('air', { result: 'НЕ УРАЖЕНО', cause: ['ППО'] }), { profile: 'air', today: TODAY });
  assert.equal(miss.warnings.cause, undefined);
  const rocketHit = ME.analyzeDraft(fullDraft('rocket', { result: 'ЗНИЩЕНО', cause: ['РЕБ'] }), { profile: 'rocket', today: TODAY });
  assert.match(rocketHit.warnings.cause, /ЗНИЩЕНО/);
  const complete = ME.analyzeDraft(fullDraft('air'), { profile: 'air', today: TODAY });
  assert.deepEqual(complete.warnings, {});
  assert.deepEqual(complete.empty, []);
});

test('перевірка: номер цілі в ПС має вигляд TS/KS, у РВ формат довільний', () => {
  const odd = ME.analyzeDraft(fullDraft('air', { targets: 'TC1234' }), { profile: 'air', today: TODAY });
  assert.ok(odd.ok);
  assert.match(odd.warnings.targets, /TS1234/);
  const partlyOdd = ME.analyzeDraft(fullDraft('air', { targets: 'TS1234, ціль біля мосту' }), { profile: 'air', today: TODAY });
  assert.ok(partlyOdd.warnings.targets);
  const usual = ME.analyzeDraft(fullDraft('air', { targets: 'тс 1234, ks-5678, КС 9012A' }), { profile: 'air', today: TODAY });
  assert.equal(usual.record.targets, 'TS1234, KS5678, KS9012A');
  assert.equal(usual.warnings.targets, undefined);
  const rocket = ME.analyzeDraft(fullDraft('rocket', { targets: 'G-1234; 55-А' }), { profile: 'rocket', today: TODAY });
  assert.equal(rocket.warnings.targets, undefined);
  // Лише координати без номера цілі — помилки немає, а попередження про номер не потрібне.
  const onlyDpi = ME.analyzeDraft(Object.assign(ME.emptyDraft(TODAY), { dpi: '37U DQ 12345 67890' }), { profile: 'air', today: TODAY });
  assert.ok(onlyDpi.ok);
  assert.equal(onlyDpi.warnings.targets, undefined);
});

test('порожні «рекомендовані» стовпці перелічуються, РВ додає РУК/ГРВ і бригаду', () => {
  const air = ME.analyzeDraft(Object.assign(ME.emptyDraft(TODAY), { targets: 'TS1234', dpi: '37U DQ 12345 67890' }), { profile: 'air', today: TODAY });
  assert.deepEqual(air.empty.sort(), ['aircraft', 'count', 'district', 'munition', 'result', 'time', 'unit']);
  const rocket = ME.analyzeDraft(Object.assign(ME.emptyDraft(TODAY), { targets: 'G-1', dpi: '37U DQ 12345 67890' }), { profile: 'rocket', today: TODAY });
  assert.deepEqual(rocket.empty.sort(), ['aircraft', 'count', 'crew', 'district', 'firingUnit', 'munition', 'result', 'time', 'unit']);
});

test('наступний номер і рядок-попередній перегляд: стовпці в порядку файлу, № і Місяць позначені як автоматичні', async () => {
  assert.equal(ME.nextNumber([]), 1);
  assert.equal(ME.nextNumber([{ num: '3' }, { num: '10' }, { num: 'x' }, { num: '' }]), 11);
  const wb = await cores.air.openWorkbook(await template(BASE.air));
  const { record } = ME.analyzeDraft(fullDraft('air'), { profile: 'air', today: TODAY });
  const cells = ME.previewCells(cores.air, wb, record, 241);
  assert.deepEqual(cells.map(c => c.letter), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']);
  assert.deepEqual(cells.map(c => c.value), [
    '241', '12.10.2026', '14:55', 'TS1234', '95 ОДШБр', 'Тестове 3', 'DPI 1: 37U DQ 12345 67890', 'КСП', 'Жовтень',
    'МіГ-29', 'GBU-39', '4', 'УРАЖЕНО', '', 'Синтетичний запис',
  ]);
  assert.deepEqual(cells.filter(c => c.auto).map(c => c.column), ['num', 'month']);
  assert.equal(cells[0].header, '№');
  assert.equal(ME.monthName(cores.air, '2026-10-12'), 'Жовтень');
  assert.equal(ME.monthName(cores.air, '2026-13-12'), '');
});

/* ------------------------------------------------------------------ */
/*  Запис у справжню таблицю                                            */
/* ------------------------------------------------------------------ */

for (const profile of ['air', 'rocket']) {
  test(`${profile}: запис із форми потрапляє у свої стовпці, № і місяць проставляються, повторний запис дає наступний №`, async () => {
    const core = cores[profile];
    const base = await template(BASE[profile]);
    const first = ME.analyzeDraft(fullDraft(profile, { cause: ['ППО'], result: 'НЕ УРАЖЕНО', types: ['КСП', 'Укриття'] }), { profile, today: TODAY });
    assert.ok(first.ok);
    const res1 = await core.appendRows(base, [core.toRow(first.record)]);
    assert.deepEqual(J(res1.nums), [1]);
    const wb1 = await core.openWorkbook(res1.bytes);
    assert.equal(wb1.records.length, 1);
    const r1 = wb1.records[0];
    assert.equal(r1.num, '1');
    assert.equal(r1.date, '2026-10-12');
    assert.equal(r1.month, 'Жовтень');
    assert.equal(r1.time, '14:55');
    assert.equal(r1.type, 'КСП, Укриття');
    assert.equal(r1.cause, 'ППО');
    assert.equal(r1.count, '4');
    assert.equal(r1.dpi, 'DPI 1: 37U DQ 12345 67890');
    assert.equal(r1.note, 'Синтетичний запис');
    if (profile === 'rocket') {
      assert.equal(r1.crew, 'РУК');
      assert.equal(r1.firingUnit, 'Тестова ВБр 1');
      assert.equal(r1.aircraft, 'М142');
    } else assert.equal(r1.aircraft, 'МіГ-29');

    const second = ME.analyzeDraft(fullDraft(profile, { time: '15:20', targets: profile === 'rocket' ? 'G-1235' : 'TS1235' }), { profile, today: TODAY });
    const res2 = await core.appendRows(res1.bytes, [core.toRow(second.record)]);
    assert.deepEqual(J(res2.nums), [2]);
    const wb2 = await core.openWorkbook(res2.bytes);
    assert.deepEqual(J(wb2.records.map(r => r.num)), ['1', '2']);
    assert.equal(ME.nextNumber(wb2.records), 3);
  });

  test(`${profile}: той самий запис вдруге знаходиться як дубль, інший час і цілі — ні`, async () => {
    const core = cores[profile];
    const analysis = ME.analyzeDraft(fullDraft(profile), { profile, today: TODAY });
    const res = await core.appendRows(await template(BASE[profile]), [core.toRow(analysis.record)]);
    const wb = await core.openWorkbook(res.bytes);
    assert.ok(core.findDuplicate(analysis.record, wb.records), 'повтор того самого запису');
    const other = ME.analyzeDraft(fullDraft(profile, { time: '03:10', targets: profile === 'rocket' ? 'G-9999' : 'TS9999', dpi: '37U DQ 11111 22222' }), { profile, today: TODAY });
    assert.equal(core.findDuplicate(other.record, wb.records), null);
  });
}

test('запис із «небезпечним» текстом: розмітка, лапки, переноси, емодзі й керувальні символи не ламають таблицю', async () => {
  const core = cores.air;
  const draft = fullDraft('air', {
    unit: '95 <ОДШБр> & "Тест" \'1\'', district: 'Тестове\u0000 ​3﻿',
    note: 'Рядок 1\r\nРядок 2 </t></is> ]]> &amp; 🚀\u0007\n\n\n\nРядок 3', targets: 'ts 1234,\nks 7601',
  });
  const analysis = ME.analyzeDraft(draft, { profile: 'air', today: TODAY });
  assert.equal(analysis.record.district, 'Тестове 3');
  assert.equal(analysis.record.note, 'Рядок 1\nРядок 2 </t></is> ]]> &amp; 🚀\n\nРядок 3');
  assert.equal(analysis.record.targets, 'TS1234, KS7601');
  const res = await core.appendRows(await template(BASE.air), [core.toRow(analysis.record)]);
  const [row] = (await core.openWorkbook(res.bytes)).records;
  assert.equal(row.unit, '95 <ОДШБр> & "Тест" \'1\'');
  assert.equal(row.note, analysis.record.note);
  assert.equal(row.targets, 'TS1234, KS7601');
});

test('кілька записів поспіль у таблицю з рядками: № продовжується від найбільшого, а підказки беруться зі стовпців таблиці', async () => {
  const core = cores.rocket;
  let bytes = await template(BASE.rocket);
  for (const [n, unit, crew, brigade, munition] of [[1, '95 ОДШБр', 'РУК', 'Тестова ВБр 1', 'M30A2'], [2, '95 ОДШБр', 'ГРВ', 'Тестова ВБр 2', 'M31A1'], [3, '24 ОМБр', 'РУК', 'Тестова ВБр 1', 'M30A2, M31A1']]) {
    const a = ME.analyzeDraft(fullDraft('rocket', { targets: `G-${n}`, unit, crew, firingUnit: brigade, munition, district: n === 3 ? 'Тестове 1' : 'Тестове 3', time: `0${n}:10` }), { profile: 'rocket', today: TODAY });
    bytes = (await core.appendRows(bytes, [core.toRow(a.record)])).bytes;
  }
  const wb = await core.openWorkbook(bytes);
  assert.equal(ME.nextNumber(wb.records), 4);
  const hints = J(ME.suggestions(core, wb));
  assert.deepEqual(hints.units, ['95 ОДШБр', '24 ОМБр'], 'найчастіші першими');
  assert.deepEqual(hints.districts, ['Тестове 1', 'Тестове 3']);
  assert.deepEqual(hints.crews, ['РУК', 'ГРВ']);
  assert.deepEqual(hints.firingUnits, ['Тестова ВБр 1', 'Тестова ВБр 2']);
  assert.deepEqual(hints.munitions.slice(0, 3), ['M30A2', 'M31A1', 'M30A1'], 'складений тип БП розбирається, типові доповнюють');
  assert.deepEqual(hints.aircraft, ['М142', 'М270']);
  const airHints = J(ME.suggestions(cores.air, await cores.air.openWorkbook(await template(BASE.air))));
  assert.deepEqual(airHints.munitions, ['GBU-39', 'GBU-62']);
  assert.deepEqual(airHints.aircraft, []);
  assert.deepEqual(airHints.units, []);
});
