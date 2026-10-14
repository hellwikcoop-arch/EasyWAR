// Довільне внесення в модулях «Повітряні Сили» (ПС) і РВ: чисте ядро без DOM.
//
// Форма заповнює ті самі стовпці таблиці, що й внесення зі звіту. Тут — поля форми за стовпцями відкритої таблиці,
// очищення й перевірка введеного та рядок-попередній перегляд. Сам запис у XLSX виконує legacy-сторінка
// (AVCORE.appendRows через window.__AV.addSelected), тому № і «Місяць» проставляються автоматично,
// а самоперевірка запису, пошук дубля та скасування працюють так само, як для звіту.
//
// Ядро приймає AVCORE (FIELD_ORDER, FIELD_HEADERS, toRow, buildContext) як аргумент: так воно однаково працює
// з обома сторінками й у тестах, де AVCORE дістається з тексту air.html / rocket.html.

/* ------------------------------------------------------------------ */
/*  Профіль модуля                                                     */
/* ------------------------------------------------------------------ */

// Ті самі списки, що й у випадному списку «Результат ураження» на картках внесення зі звіту.
export const RESULT_OPTIONS = {
  air: ['УРАЖЕНО', 'ЧАСТКОВО УРАЖЕНО', 'НЕ УРАЖЕНО'],
  rocket: ['ПОДАВЛЕНО', 'ПОШКОДЖЕНО', 'ЗНИЩЕНО', 'НЕ УРАЖЕНО'],
};
// Повне ураження: разом із ним причина невдачі суперечлива (так само попереджає внесення зі звіту).
const FULL_HIT = { air: 'УРАЖЕНО', rocket: 'ЗНИЩЕНО' };
// Підказки для випадних списків, якщо в таблиці таких значень ще немає.
const DEFAULT_MUNITIONS = {
  air: ['GBU-39', 'GBU-62'],
  rocket: ['M30A1', 'M30A2', 'M31A1', 'M31A2', 'M26', 'ER GMLRS', 'ATACMS'],
};
const DEFAULT_AIRCRAFT = { air: [], rocket: ['М142', 'М270'] };
const DEFAULT_CREWS = ['РУК', 'ГРВ'];

/** 'rocket' для таблиці РВ (є стовпець «Підрозділ (від кого машина)»), інакше 'air'. */
export function profileOf(core) {
  return core.FIELD_ORDER.includes('crew') ? 'rocket' : 'air';
}

/* ------------------------------------------------------------------ */
/*  Поля форми за стовпцями таблиці                                    */
/* ------------------------------------------------------------------ */

// key — ключ чернетки; column — ключ стовпця в AVCORE.FIELD_ORDER; w — ширина в 12-колонковій сітці форми.
// Поля, чиїх стовпців у відкритій таблиці немає (необов'язкові стовпці РВ), у форму не потрапляють.
const LAYOUT = [
  { key: 'date', column: 'date', control: 'date', w: 3 },
  { key: 'time', column: 'time', control: 'time', w: 3 },
  { key: 'targets', column: 'targets', control: 'text', w: 6 },
  { key: 'unit', column: 'unit', control: 'text', w: 4, list: 'units' },
  { key: 'crew', column: 'crew', control: 'text', w: 4, list: 'crews' },
  { key: 'firingUnit', column: 'firingUnit', control: 'text', w: 4, list: 'firingUnits' },
  { key: 'district', column: 'district', control: 'text', w: 4, list: 'districts' },
  { key: 'aircraft', column: 'aircraft', control: 'text', w: 4, list: 'aircraft' },
  { key: 'munition', column: 'munition', control: 'text', w: 4, wAir: 3, list: 'munitions' },
  { key: 'count', column: 'count', control: 'number', w: 3 },
  { key: 'result', column: 'result', control: 'select', w: 9, wAir: 6 },
  { key: 'types', column: 'type', control: 'chips', dict: 'typeDict', w: 12 },
  { key: 'cause', column: 'cause', control: 'chips', dict: 'causeDict', w: 12 },
  { key: 'dpi', column: 'dpi', control: 'area', rows: 4, mono: true, w: 12 },
  { key: 'note', column: 'note', control: 'area', rows: 2, w: 12 },
];

/** Поля форми для відкритої таблиці: підписи — це заголовки її стовпців, letter — літера стовпця в Excel. */
export function manualFields(core, wb) {
  const profile = profileOf(core);
  const letters = (wb && wb.colByField) || {};
  const fields = [];
  for (const item of LAYOUT) {
    if (!core.FIELD_ORDER.includes(item.column) || !letters[item.column]) continue;
    fields.push({
      key: item.key,
      column: item.column,
      control: item.control,
      w: profile === 'air' && item.wAir ? item.wAir : item.w,
      list: item.list,
      dict: item.dict,
      rows: item.rows,
      mono: Boolean(item.mono),
      label: core.FIELD_HEADERS[item.column],
      letter: letters[item.column],
      options: item.control === 'select' ? RESULT_OPTIONS[profile] : undefined,
    });
  }
  return fields;
}

/** Стовпці, які таблиця заповнює сама: № (наступний за найбільшим) і «Місяць» (за датою). */
export function autoColumns(core, wb) {
  const letters = (wb && wb.colByField) || {};
  return ['num', 'month']
    .filter(column => core.FIELD_ORDER.includes(column) && letters[column])
    .map(column => ({ column, label: core.FIELD_HEADERS[column], letter: letters[column] }));
}

/** Літери стовпця Excel → номер (A=1, AA=27). */
export function columnNumber(letters) {
  let n = 0;
  for (const ch of String(letters || '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/* ------------------------------------------------------------------ */
/*  Очищення тексту                                                    */
/* ------------------------------------------------------------------ */

// Те, що xmlEsc із CORE все одно вирізав би при записі: після нього значення не збіглося б із прочитаним
// і самоперевірка запису відмовила б. Тому прибираємо заздалегідь.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const INVISIBLE = /[​-‍⁠﻿]/g;

function clean(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(LONE_SURROGATE, '')
    .replace(INVISIBLE, '');
}

/** Однорядкове значення: без керувальних символів, пробіли стиснуті, краї обрізані. */
export function oneLine(value) {
  return clean(value).replace(/\s+/g, ' ').trim();
}

/** Багаторядкове значення: рядки обрізані, порожні рядки на краях і подвійні порожні рядки прибрані. */
export function multiLine(value) {
  return clean(value)
    .split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const unique = list => [...new Set(list)];
const pad2 = n => String(n).padStart(2, '0');

// Кириличні літери, схожі на латинські (у номерах цілей TS/KS і в квадратах MGRS).
const LOOKALIKE = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y', 'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'н': 'h', 'і': 'i', 'к': 'k', 'м': 'm', 'о': 'o', 'р': 'p', 'т': 't', 'х': 'x', 'у': 'y' };
const toLatin = s => s.replace(/[АВСЕНІКМОРТХУавсенікмортху]/g, ch => LOOKALIKE[ch]);
// І навпаки: латинські літери, схожі на кириличні (позначки РУК / ГРВ).
const LAT2UK = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };

/* ------------------------------------------------------------------ */
/*  Окремі значення                                                    */
/* ------------------------------------------------------------------ */

/** Дата у форматі рррр-мм-дд (так її віддає поле дати) і в межах 2000–2100, як у розборі звіту. */
export function isValidIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Локальна дата сьогодні у форматі рррр-мм-дд. */
export function todayIso(now = new Date()) {
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
}

const dmy = iso => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);

/** Час ГГ:ХХ. '' — порожньо, null — не вдалося розпізнати. Приймає 14:55, 9:05, 14.55, 1455, 905, 14:55:30. */
export function normalizeTime(value) {
  const s = oneLine(value);
  if (!s) return '';
  const m = /^(\d{1,2})\s*[:.\-]\s*(\d{2})(?:\s*[:.\-]\s*\d{2})?$/.exec(s) || /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return pad2(h) + ':' + pad2(min);
}

/** Кількість БП — ціле від 0 до 9999 без нулів попереду. '' — порожньо, null — не число. */
export function normalizeCount(value) {
  const s = oneLine(value);
  if (!s) return '';
  return /^\d{1,4}$/.test(s) ? String(Number(s)) : null;
}

const RE_TS_KS = /(?<![\p{L}\p{N}])([TТtт][SСsс]|[KКkк][SСsс])\s?[-–]?\s?(\d{3,5})(?:([A-ZА-ЯІ])(?![\p{L}]))?(?!\d)/gu;
const RE_AIR_TARGET = /^(?:TS|KS)\d{3,6}[A-Z]?$/;

/**
 * Номери цілей: розділювачі — кома, крапка з комою, новий рядок. У ПС «тс 1234» → «TS1234» (латиниця, без пробілу),
 * цілі можна розділяти й пробілом. У РВ формат номера довільний (G-123, 12345), тому там чіпаємо лише розділювачі.
 */
export function normalizeTargets(value, profile = 'air') {
  let text = clean(value).replace(/\n+/g, ',');
  // Префікс зводиться до «TS» або «KS» (за першою літерою), літера-суфікс — до латиниці, як у розборі звіту.
  if (profile === 'air') text = text.replace(RE_TS_KS, (m, prefix, digits, suffix) => (/^[TТtт]/.test(prefix) ? 'TS' : 'KS') + digits + (suffix ? toLatin(suffix).toUpperCase() : ''));
  const parts = text.split(profile === 'air' ? /[,;\s]+/ : /[,;]+/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return unique(parts).join(', ');
}

/** РУК / ГРВ: великі літери, латинські двійники — кирилицею (так само їх зводить дашборд). '—' і '-' — порожньо. */
export function normalizeCrew(value) {
  const s = oneLine(value).toUpperCase().replace(/[A-Z]/g, ch => LAT2UK[ch] || ch);
  return ['', '—', '-', '–'].includes(s) ? '' : s;
}

/* ------------------------------------------------------------------ */
/*  Координати MGRS і DPI                                              */
/* ------------------------------------------------------------------ */

const RE_MGRS = /(?<![\p{L}\p{N}])(\d{2})[ \t]?([A-Za-zА-Яа-я])[ \t]?([A-Za-zА-Яа-я]{2})[ \t]?(\d{4,5})[ \t]?(\d{4,5})(?!\d)/gu;
const RE_DPI_LABEL_END = /(?:DPI|ДПІ|ДПИ)\s*№?\s*(\d+(?:\s*[,\-–—]\s*\d+)*)\s*[:\-–—.)]*\s*$/iu;
const RE_DPI_LABEL = /(?:DPI|ДПІ|ДПИ)\s*№?\s*\d+(?:\s*[,\-–—]\s*\d+)*/giu;

/** Усі коректні координати MGRS у тексті: { index, end, value: '37U DQ 12345 67890' }. */
export function findMgrs(text) {
  const out = [];
  const re = new RegExp(RE_MGRS.source, 'gu');
  let m;
  while ((m = re.exec(text))) {
    const band = toLatin(m[2]).toUpperCase();
    const square = toLatin(m[3]).toUpperCase();
    if (!/^[C-HJ-NP-X]$/.test(band) || !/^[A-HJ-NP-Z]{2}$/.test(square)) continue;
    const zone = +m[1];
    if (zone < 1 || zone > 60) continue;
    out.push({ index: m.index, end: m.index + m[0].length, value: m[1] + band + ' ' + square + ' ' + m[4] + ' ' + m[5] });
  }
  return out;
}

// Текст поза координатами й позначками «DPI n:»: якщо він є, переформатовувати поле не можна — користувач втратив би його.
function hasTextBesidesMgrs(text, points) {
  let rest = '';
  let from = 0;
  for (const p of points) { rest += text.slice(from, p.index); from = p.end; }
  rest += text.slice(from);
  return rest.replace(RE_DPI_LABEL, '').replace(/[\s:;,.\-–—)(№]+/g, '').length > 0;
}

/**
 * Поле «DPI / Координати MGRS». Якщо там лише координати (з позначками «DPI n:» або без них), вони записуються у вигляді,
 * який дає внесення зі звіту: по рядку «DPI 1: 37U DQ 12345 67890». Інакше текст лишається як введено.
 * Повертає { text, points, canonical }.
 */
export function normalizeDpi(value) {
  const text = multiLine(value);
  const points = findMgrs(text);
  if (!points.length || hasTextBesidesMgrs(text, points)) return { text, points: points.length, canonical: false };
  const lines = [];
  const seen = new Set();
  let next = 1;
  for (const p of points) {
    const before = text.slice(Math.max(0, p.index - 40), p.index);
    const found = RE_DPI_LABEL_END.exec(before);
    let label;
    if (found) {
      label = found[1].replace(/\s*([,\-–—])\s*/g, (m, sign) => (sign === ',' ? ', ' : '-'));
      const numbers = label.split(/[,\s]+/).flatMap(part => {
        const range = /^(\d+)-(\d+)$/.exec(part);
        if (range) {
          const out = [];
          for (let i = +range[1]; i <= +range[2] && i - +range[1] < 50; i++) out.push(i);
          return out;
        }
        return part ? [+part] : [];
      });
      next = Math.max(next, ...numbers) + 1;
    } else {
      label = String(next);
      next += 1;
    }
    const line = 'DPI ' + label + ': ' + p.value;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
  }
  return { text: lines.join('\n'), points: points.length, canonical: true };
}

/* ------------------------------------------------------------------ */
/*  Чернетка, запис, перевірка                                         */
/* ------------------------------------------------------------------ */

export function emptyDraft(today = '') {
  return {
    date: today, time: '', targets: '', unit: '', district: '', dpi: '', types: [], aircraft: '', munition: '',
    count: '', result: '', cause: [], note: '', crew: '', firingUnit: '',
  };
}

/** Чернетка для наступного запису: дата й «хто стріляв» (тип ЛА / ПУ, РУК/ГРВ, бригада) лишаються, решта порожня. */
export function stickyDraft(draft, today = '') {
  const next = emptyDraft(draft.date || today);
  next.aircraft = draft.aircraft;
  next.crew = draft.crew;
  next.firingUnit = draft.firingUnit;
  return next;
}

/** Запис у формі, яку приймає legacy-сторінка (addSelected → AVCORE.toRow): types і cause — масиви. */
export function toRecord(draft, profile = 'air') {
  const types = unique((draft.types || []).map(oneLine).filter(Boolean));
  const record = {
    date: oneLine(draft.date),
    time: normalizeTime(draft.time) ?? oneLine(draft.time),
    targets: normalizeTargets(draft.targets, profile),
    unit: oneLine(draft.unit),
    district: oneLine(draft.district),
    dpi: normalizeDpi(draft.dpi).text,
    types: types.length ? types : ['Інше'],
    aircraft: oneLine(draft.aircraft),
    munition: oneLine(draft.munition),
    count: normalizeCount(draft.count) ?? oneLine(draft.count),
    result: oneLine(draft.result),
    cause: unique((draft.cause || []).map(oneLine).filter(Boolean)),
    note: multiLine(draft.note),
  };
  if (profile === 'rocket') {
    record.crew = normalizeCrew(draft.crew);
    record.firingUnit = oneLine(draft.firingUnit);
  }
  return record;
}

// Поля, порожні значення яких варто показати перед записом (причина й уточнення порожні нормально).
const RECOMMENDED = ['time', 'unit', 'crew', 'firingUnit', 'district', 'aircraft', 'munition', 'count', 'result'];

/**
 * Перевіряє чернетку. errors — те, без чого запис не додається; warnings — підозріле, але дозволене;
 * empty — ключі порожніх «рекомендованих» полів. Ключі збігаються з ключами полів форми.
 */
export function analyzeDraft(draft, { profile = 'air', today = '' } = {}) {
  const record = toRecord(draft, profile);
  const errors = {};
  const warnings = {};

  if (!isValidIsoDate(record.date)) errors.date = 'Вкажіть дату.';
  else if (today && record.date > today) warnings.date = 'Дата пізніша за сьогоднішню — перевірте.';

  if (normalizeTime(draft.time) === null) errors.time = 'Час — у форматі ГГ:ХХ, наприклад 14:55.';
  if (!record.targets && !record.dpi) errors.targets = 'Вкажіть номер цілі або координати MGRS.';
  // ПС: номери мають вигляд TS1234 / KS1234 (за ними дашборд впізнає ціль). Інше дозволено, але це схоже на помилку набору.
  else if (profile === 'air' && record.targets && record.targets.split(', ').some(part => !RE_AIR_TARGET.test(part))) warnings.targets = 'Номер цілі не схожий на TS1234 або KS1234 — перевірте, чи немає помилки.';
  if (normalizeCount(draft.count) === null) errors.count = 'Кількість БП — ціле число від 0 до 9999.';

  const dpi = normalizeDpi(draft.dpi);
  if (dpi.text && !dpi.points) warnings.dpi = 'Координат MGRS не розпізнано: на карті запис не з’явиться. Формат: 37U DQ 12345 67890.';
  else if (dpi.text && !dpi.canonical) warnings.dpi = 'Крім координат MGRS у полі є інший текст — він записується як є. Примітки краще писати в «Уточнення результату».';

  if (!(draft.types || []).some(name => oneLine(name))) warnings.types = 'Тип цілі не вибрано — запишеться «Інше».';
  if (record.cause.length && record.result && record.result === FULL_HIT[profile]) warnings.cause = 'Результат «' + record.result + '», але вказано причину невдачі — перевірте.';

  // Порядок не важливий: форма впорядкує за своїми полями. Без і цілі, і координат запису взагалі немає (це помилка).
  const empty = RECOMMENDED.filter(key => key in record && !record[key]);
  if (!record.targets && record.dpi) empty.push('targets');
  if (record.targets && !record.dpi) empty.push('dpi');

  return { record, errors, warnings, empty, ok: Object.keys(errors).length === 0 };
}

/** Наступний № у таблиці — як його проставляє AVCORE.appendRows: найбільший наявний + 1. */
export function nextNumber(records) {
  let max = 0;
  for (const r of records || []) {
    const n = parseInt(r.num, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Рядок, який буде записано: комірки за стовпцями файлу зліва направо. auto — проставляються самі (№, Місяць). */
export function previewCells(core, wb, record, number) {
  const row = core.toRow(record);
  row.num = String(number);
  const cells = [];
  for (const column of core.FIELD_ORDER) {
    const letter = wb.colByField[column];
    if (!letter) continue;
    let value = row[column] == null ? '' : String(row[column]);
    if (column === 'date' && isValidIsoDate(value)) value = dmy(value);
    cells.push({ column, header: core.FIELD_HEADERS[column], letter, value, auto: column === 'num' || column === 'month' });
  }
  return cells.sort((a, b) => columnNumber(a.letter) - columnNumber(b.letter));
}

/** Назва місяця за датою рррр-мм-дд (як у стовпці «Місяць»); '' для неправильної дати. */
export function monthName(core, iso) {
  return isValidIsoDate(iso) ? core.MONTHS_NOM[+iso.slice(5, 7) - 1] || '' : '';
}

/* ------------------------------------------------------------------ */
/*  Підказки для випадних списків                                      */
/* ------------------------------------------------------------------ */

function byFrequency(values) {
  const freq = new Map();
  for (const value of values) if (value) freq.set(value, (freq.get(value) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk')).map(entry => entry[0]);
}

const splitList = value => String(value == null ? '' : value).split(/[,;]/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** Значення зі стовпців відкритої таблиці (найчастіші першими) плюс типові підказки профілю. */
export function suggestions(core, wb) {
  const profile = profileOf(core);
  const records = (wb && wb.records) || [];
  const column = (key, split) => records.flatMap(r => (split ? splitList(r[key]) : [oneLine(r[key])]));
  const ctx = core.buildContext(wb);
  return {
    units: byFrequency(column('unit')),
    districts: ctx.districts.slice().sort((a, b) => a.localeCompare(b, 'uk')),
    aircraft: unique([...byFrequency(column('aircraft')), ...DEFAULT_AIRCRAFT[profile]]),
    munitions: unique([...byFrequency(column('munition', true)), ...DEFAULT_MUNITIONS[profile]]),
    crews: unique([...DEFAULT_CREWS, ...byFrequency(column('crew'))]),
    firingUnits: byFrequency(column('firingUnit')),
  };
}
