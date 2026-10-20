// EasyFLY: друковані документи штурмана як HTML-рядки (A4 альбомний, одна сторінка, Times New Roman):
// ІШР (Додаток 4), бортовий журнал штурмана (Додаток 1), штурманський план польоту (ШПП).
// Кожна функція повертає повний документ `<!doctype html>`; усі підставлені значення екрануються.
// Без DOM, мережі, Date.now і Math.random. Числа рахує nav-core.js; тут лише розкладка.
// Розкладка аркушів ІШР і бортжурналу вихідна: колонки й рядки бланків не змінюються.

import {
  calcBortjournal,
  calcIshr,
  calcShpp,
  departureName,
  formatHm,
  formatSigned,
  formatTurn,
  formatMmss,
  kgToLiters,
  planScheme,
} from './nav-core.js';
import { formatDateUk } from './sun-core.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Екранує значення для HTML (текст і атрибути). null/undefined → порожній рядок. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

const esc = escapeHtml;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
/** Комірка таблиці: число або текст; порожнє/NaN → ''. */
const cell = v => (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : esc(v));
const dash = v => (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '–' : esc(v));

const FONT = "'Times New Roman','Liberation Serif',Tinos,serif";

function shell(title, css, body) {
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

/** «Ім'я ПРІЗВИЩЕ» з об'єкта підписанта: або готовий `name`, або `firstName` + `surname`. */
export function personName(person) {
  if (!person || typeof person !== 'object') return '';
  if (typeof person.name === 'string' && person.name.trim()) return person.name.trim();
  const first = String(person.firstName ?? '').trim();
  const last = String(person.surname ?? '').trim().toUpperCase();
  return `${first} ${last}`.trim();
}

function dateLine(flight) {
  return formatDateUk(flight?.date) || (flight?.date ? String(flight.date) : '');
}

// ---------- ІШР ----------

const ISHR_CSS = `
@page{size:A4 landscape;margin:12mm 14mm}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${FONT};font-size:13.5px;color:#000;width:265mm;margin:0 auto}
.ann{text-align:right;font-size:10px;line-height:1.25}
h1{text-align:center;font-size:16px;margin:10px 0 2px;font-weight:600}
.sub{text-align:center;font-size:11px;margin-bottom:8px}
table{border-collapse:collapse}
th,td{border:1px solid #000;padding:3px 5px;text-align:center}
th{text-align:left;font-weight:normal;background:#f3f3f3}
.top{display:flex;gap:12px;align-items:stretch;margin-bottom:8px}
.top table{flex:1}
.top table td:last-child{width:70px}
.main{width:100%;table-layout:fixed}
.main tr:first-child td:first-child{width:26%}
.main td{font-size:13px;padding:2px;word-wrap:break-word;line-height:1.2}
.main th{padding:3px 6px;font-size:13px}
.hdr td{font-weight:600;background:#e9e9e9}
.sig{margin-top:12px;font-size:13px}
.sigt{width:100%}
.sigt td{border:0;text-align:left;padding:6px 10px 6px 0}
.sigt td:first-child{width:46%}
.sigt .rk{width:15%;padding-right:4px}
.sigt .ln{width:20%;border-bottom:1px solid #000}
`;

/**
 * Друкований ІШР (Додаток 4): розрахунок польотної ваги, маршрут, таблиця контрольних рубежів,
 * підписи начальника ІАС і старшого штурмана частини.
 * @param {object} flight опис польоту (див. nav-core.js)
 * @returns {string} HTML-документ
 */
export function renderIshrHtml(flight) {
  const f = flight || {};
  const r = calcIshr(f);
  const cols = r.cols;
  const row = (label, fn, fmt = dash) =>
    `<tr><th>${esc(label)}</th>${cols.map(col => `<td>${fmt(fn(col))}</td>`).join('')}</tr>`;
  const rows = [
    row('S по етапах (км)', c => c.s),
    row('Т по етапах (хв.)', c => c.t),
    row('Швидкість за приладами Vпр (км/год)', c => c.v),
    row('Q, кг/год', c => c.q),
    row('Витрата палива по ділянках (кг)', c => c.legKg),
    row('Витрата палива по ділянках (л)', c => kgToLiters(c.legKg)),
    row('S, км (загальна)', c => c.S),
    row('Т (год/хв.) (загальний)', c => formatHm(c.T)),
    row('Витрати палива (кг)', c => c.used),
    row('Витрати палива (л)', c => kgToLiters(c.used)),
    row('Залишок палива (кг)', c => c.rem),
    row('Залишок палива (л)', c => kgToLiters(c.rem)),
    row('Польотна вага вертольоту, кг', c => c.w),
  ].join('');
  const landings = cols.filter(c => c.landing).map(c => c.name.replace(/ \(посадка\)$/, ''));
  const landingNote = landings.length
    ? `<div style="margin-top:6px;font-size:12px">Посадка на майданчик: ${esc(landings.join(', '))}</div>`
    : '';
  const sub = [
    dateLine(f) || '«____» ____________ 20___ р. (дата)',
    r.typeLabel || '____________ (тип ПС)',
    `борт № ${f.board ? esc(f.board) : '______'}`,
  ].map((part, i) => (i === 2 ? part : esc(part))).join(' &nbsp;·&nbsp; ');
  const sign = (position, person) => {
    const p = person || {};
    return `<tr><td>${esc(position)}</td><td class="rk">${esc(p.rank ?? '')}</td><td class="ln"></td><td>${esc(personName(p))}</td></tr>`;
  };
  const body = `
<div class="ann">Додаток 4<br>до Правил штурманського забезпечення польотів державної авіації України<br>(пункт 8 глави 9 розділу ІV)</div>
<h1>Інженерно-штурманський розрахунок польоту</h1>
<div class="sub">${sub}</div>
<div class="top">
<table><tr><td colspan="2" style="font-weight:600;background:#e9e9e9">Розрахунок польотної ваги (кг)</td></tr>
<tr><th>Вага порожнього ПС</th><td>${dash(r.empty)}</td></tr>
<tr><th>Вага екіпажу</th><td>${dash(r.crew)}</td></tr>
<tr><th>Вага палива, кг</th><td>${dash(r.fuelKg)}</td></tr>
<tr><th>Вага палива, л</th><td>${dash(r.fuelL)}</td></tr>
<tr><th>Вага вантажу</th><td>${dash(r.cargo)}</td></tr>
<tr><th style="font-weight:600">РАЗОМ</th><td style="font-weight:600">${dash(r.total)}</td></tr></table>
<table><tr><td colspan="2" style="font-weight:600;background:#e9e9e9">Маршрут польоту</td></tr><tr><td style="text-align:left">${esc(r.route)}${landingNote}</td></tr></table>
</div>
<table class="main"><tr class="hdr"><td>Контрольні рубежі</td>${cols.map(c => `<td>${esc(c.name)}</td>`).join('')}</tr>${rows}</table>
<div class="sig"><table class="sigt">${sign('Заступник командира авіаційної частини з ІАС – начальник ІАС', f.iasChief)}${sign('Старший штурман (штурман) авіаційної частини', f.seniorNav)}</table></div>`;
  return shell('Інженерно-штурманський розрахунок польоту', ISHR_CSS, body);
}

// ---------- Бортовий журнал ----------

const BJ_CSS = `
@page{size:A4 landscape;margin:10mm 12mm}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${FONT};font-size:12px;color:#000;width:269mm;margin:0 auto}
.ann{text-align:right;font-size:10px;line-height:1.2}
h1{text-align:center;font-size:15px;margin:4px 0 6px;font-weight:600}
.hdr{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:6px 18px;margin-bottom:6px;font-size:12px;line-height:1.6}
table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:1px solid #000;padding:2px 3px;text-align:center;font-size:11.5px;overflow:hidden}
th{font-weight:normal;background:#f3f3f3}
.grp th{font-weight:600}
td.l,th.l{text-align:left}
.ft{display:grid;grid-template-columns:1.2fr 1.5fr 1fr;gap:6px 18px;margin-top:6px;font-size:12px;line-height:1.7}
.ft table{width:auto}
.ft td,.ft th{padding:1px 8px;font-size:11.5px}
.sg{text-align:right;margin-top:6px}
`;

const BJ_COLS = [13, 4.5, 4.5, 5, 4.5, 5, 5.5, 4.5, 5, 5, 7, 4.5, 4.5, 4, 4, 4, 4, 4];

function bjRow(cells, noteHtml) {
  return `<tr>${cells.join('')}<td class="l">${noteHtml}</td></tr>`;
}

/**
 * Друкований бортовий журнал штурмана (Додаток 1): «Розрахунок польоту» (МК без вітру),
 * «З урахуванням вітру» (МК випр., W, T), «Записи в польоті» (час, МШК, КЗ, V, W, Н, РQFE/РQNH/δ°/u/t₀).
 * Мінімум 12 нумерованих рядків; залишки палива беруться з ІШР.
 * @param {object} flight опис польоту (див. nav-core.js)
 * @returns {string} HTML-документ
 */
export function renderBortjournalHtml(flight) {
  const f = flight || {};
  const j = calcBortjournal(f);
  const h = j.header;
  const t = j.totals;
  const empty = n => Array.from({ length: n }, () => '<td></td>');
  const L = v => `<td class="l">${esc(v)}</td>`;
  const D = v => `<td>${cell(v)}</td>`;
  const dep = departureName(f);
  const takeoffRem = j.ishr.cols[0].rem;
  const noteItems = [
    h.qnh !== null && h.qnh !== undefined && h.qnh !== '' ? `РQNH = ${h.qnh} гПа` : '',
    h.wind ? `δ° = ${h.wind.from}°` : '',
    h.wind ? `u = ${h.wind.speedMs} м/с` : '',
    isNum(Number(h.t0)) && h.t0 !== null && h.t0 !== '' ? `t₀ = ${Number(h.t0) >= 0 ? '+' : '−'}${Math.abs(Number(h.t0))} °C` : '',
  ];
  const qfeNote = h.qfe !== null && h.qfe !== undefined && h.qfe !== '' ? `РQFE = ${h.qfe} мм рт. ст.` : '';
  const body = [];
  body.push(bjRow([L('Зліт'), ...empty(5), D(takeoffRem), ...empty(3), L('Зліт'), D(h.takeoff), ...empty(6)], ''));
  body.push(
    bjRow(
      [L(`ВПМ ${dep}`.trim()), ...['–', '–', '–', '–', '–'].map(x => `<td>${x}</td>`), D(takeoffRem), ...empty(3), L('ВПМ'), D(t.ipmClock), ...empty(6)],
      esc(qfeNote),
    ),
  );
  const total = Math.max(12, j.rows.length);
  for (let i = 0; i < total; i += 1) {
    const r = j.rows[i];
    const note = esc(noteItems[i] || '');
    if (r) {
      body.push(
        bjRow(
          [
            L(r.label), D(r.mshk), D(r.h), D(r.v), D(r.s), `<td>${r.ok ? esc(formatMmss(r.tCalcMin)) : ''}</td>`, D(r.rem),
            D(r.ok ? r.mk : null), D(r.ok ? r.w : null), `<td>${r.ok && r.tWindMin !== null ? esc(formatMmss(r.tWindMin)) : ''}</td>`,
            L(i + 1), D(r.clockPlan), ...empty(6),
          ],
          note,
        ),
      );
    } else {
      body.push(bjRow([L(''), ...empty(9), L(i + 1), ...empty(7)], note));
    }
  }
  const colgroup = `<colgroup>${BJ_COLS.map(w => `<col style="width:${w}%">`).join('')}<col></colgroup>`;
  const totalRow = bjRow(
    [
      '<td class="l"><b>Усього за маршрутом</b></td>', ...empty(3), `<td><b>${esc(t.S)}</b></td>`,
      `<td><b>${esc(formatMmss(t.tCalcMin))}</b></td>`, D(t.rem), '<td></td><td></td>',
      `<td><b>${t.tWindMin === null ? '' : esc(formatMmss(t.tWindMin))}</b></td>`, L('Посадка'), D(t.landingClock), ...empty(6),
    ],
    t.flightMin === null ? '' : `Тпольоту = ${esc(formatMmss(t.flightMin))}`,
  );
  const sunRows = j.sun.map(p => `<tr><td class="l">${esc(p.name)}</td><td>${cell(p.rise)}</td><td>${cell(p.set)}</td></tr>`).join('');
  const blank = text => esc(text) || '____________';
  const doc = `
<div class="ann">Додаток 1<br>до Правил штурманського забезпечення польотів державної авіації України<br>(пункт 25 глави 2 розділу ІІІ)</div>
<h1>БОРТОВИЙ ЖУРНАЛ ШТУРМАНА</h1>
<div class="hdr">
<div>Готовність до польоту перевірив<br>${h.checker ? esc(h.checker) : '________________'} ____________<br>${h.date ? esc(h.date) : '«____» ____________ 20___ р.'}</div>
<div>Маршрут польоту:<br>${esc(h.route)}</div>
<div>Командир повітряного судна: ${blank(h.commander)}<br>Штурман: ${blank(h.navigator)} &nbsp; Позивний: ${blank(h.callsign)}<br>Повітряне судно ${h.typeLabel ? esc(h.typeLabel) : '__________'} № ${h.board ? esc(h.board) : '______'} &nbsp; Впр № ${h.exercise ? esc(h.exercise) : '____'}</div>
</div>
<table>${colgroup}
<tr class="grp"><th colspan="7">Розрахунок польоту</th><th colspan="3">З урахуванням вітру</th><th colspan="9">Записи в польоті</th></tr>
<tr><th rowspan="2">маршрут</th><th rowspan="2">МК</th><th rowspan="2">Н (м)</th><th rowspan="2">V (км/год)</th><th rowspan="2">S (км)</th><th rowspan="2">T (хв/с)</th><th rowspan="2">залишок палива</th><th rowspan="2">МК випр.</th><th rowspan="2">W (км/год)</th><th rowspan="2">T (хв/с)</th><th rowspan="2">місце</th><th colspan="2">час</th><th rowspan="2">МШК</th><th rowspan="2">КЗ</th><th rowspan="2">V</th><th rowspan="2">W</th><th rowspan="2">Н</th><th rowspan="2" class="l">РQFE = &nbsp; РQNH = &nbsp; δ° = &nbsp; u =</th></tr>
<tr><th>розр.</th><th>факт.</th></tr>
${body.join('\n')}
${totalRow}
</table>
<div class="ft">
<div>Нмін. = ${h.hMin === null || h.hMin === undefined || h.hMin === '' ? '____' : esc(h.hMin)} м<br>Рубіж повернення: ${esc(h.returnLine)}</div>
<div>Запас палива = ${esc(h.reserveKg)} кг<br>Тзаг. = ${t.flightMin === null ? '' : esc(formatMmss(t.flightMin))}</div>
<table><tr><th>Пункти</th><th>Схід</th><th>Захід</th></tr>${sunRows}</table>
</div>
<div class="sg">Підпис штурмана ______________________</div>`;
  return shell('Бортовий журнал штурмана', BJ_CSS, doc);
}

// ---------- ШПП ----------

const SHPP_CSS = `
@page{size:A4 portrait;margin:8mm}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${FONT};font-size:11px;color:#000;width:194mm;margin:0 auto}
h1{text-align:center;font-size:16px;letter-spacing:.5px;margin:0 0 2px;font-weight:700}
.rt{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:2px}
.rt .cap{white-space:nowrap}
svg{display:block;width:100%;height:auto}
table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:3px}
th,td{border:1px solid #000;padding:2px 1px;text-align:center;font-size:9.5px;line-height:1.2;overflow:hidden;overflow-wrap:anywhere}
th{font-weight:600;background:#f3f3f3}
td.l,th.l{text-align:left}
tr.tot td{font-weight:600}
`;

// ширини колонок (%): №, ділянка, МК, S, t, Н, кут, поправка, V, Uр, Wр, Uи, Wи, W потр., V потр., залишок, примітка
const SHPP_COLS = [2.5, 14.4, 4.3, 4, 3.8, 5.3, 7, 6.5, 5.5, 4.2, 4.2, 4.2, 4.2, 5, 5.6, 7, 12.3];

// розмір поля схеми (портрет ≈190 × 170 мм): 760 × 680 од. ≈ 0,25 мм/од.
export const SHPP_SCHEME_W = 760;
export const SHPP_SCHEME_H = 680;

const signed = formatSigned;
const turnText = formatTurn;

function pointName(p) {
  return p.name ? `${p.code} ${p.name}` : p.code;
}

function nicePow(scale) {
  const options = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  let pick = options[0];
  for (const km of options) if (km * scale <= 170) pick = km;
  return pick;
}

/** Зарезервовані ділянки схеми (стрілка «Пн», масштабна лінія), які підписи не займають. */
function schemeReserved(W, H) {
  return [
    { x0: W - 110, y0: 4, x1: W - 4, y1: 110 },
    { x0: 4, y0: H - 50, x1: 230, y1: H - 4 },
  ];
}

/** SVG-схема маршруту ШПП (масштаб за відстанню, схема повернута так, щоб вписатися в аркуш). */
export function renderSchemeSvg(shpp, scheme) {
  const sc = scheme || planScheme(shpp);
  const W = sc.width;
  const H = sc.height;
  const labels = sc.labels;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Схема маршруту" font-family="${FONT}">`);
  out.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#000"/></marker></defs>`);
  out.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#000" stroke-width="1"/>`);
  const legs = shpp.legs;
  // ділянки (посадка на майданчик — пунктиром: коло 5 км / 5 хв)
  sc.segments.forEach((seg, i) => {
    const leg = legs[i];
    const r = 11;
    const x1 = seg.x1 + seg.ux * r;
    const y1 = seg.y1 + seg.uy * r;
    const x2 = seg.x2 - seg.ux * (r + 1);
    const y2 = seg.y2 - seg.uy * (r + 1);
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="1.6"${leg.landing || leg.afterLanding ? ' stroke-dasharray="7 4"' : ''} marker-end="url(#arr)"/>`);
  });
  // висоти в рамках
  for (const box of labels.heightBoxes) {
    out.push(
      `<rect x="${(box.cx - box.w / 2).toFixed(1)}" y="${(box.cy - box.h / 2).toFixed(1)}" width="${box.w}" height="${box.h}" fill="#fff" stroke="#000" stroke-width="1.2"/>` +
        `<text x="${box.cx}" y="${(box.cy + 4.5).toFixed(1)}" font-size="13" text-anchor="middle">${esc(box.text)}</text>`,
    );
  }
  // МК, S, t і поправка на вітер вздовж ділянки
  for (const label of labels.legLabels) {
    const [line1, line2] = label.lines;
    const off = label.off || 0;
    const y1 = label.side === 1 ? -21 - off : 17 + off;
    const y2 = label.side === 1 ? -7 - off : 31 + off;
    out.push(
      `<g transform="translate(${label.x} ${label.y}) rotate(${label.angle})" font-size="13" text-anchor="middle">` +
        `<text y="${y1}" font-weight="700">${esc(line1)}</text><text y="${y2}">${esc(line2)}</text></g>`,
    );
  }
  // пункти: ВПМ (круг з крапкою), ППМ (коло), КО (трикутник), КПМ (подвійне коло), майданчик (квадрат)
  sc.points.forEach((p, i) => {
    const { x, y, kind } = p;
    let symbol;
    if (kind === 'ko') {
      symbol = `<polygon points="${x},${y - 10} ${x + 9},${y + 7} ${x - 9},${y + 7}" fill="#fff" stroke="#000" stroke-width="1.6"/>`;
    } else if (p.landing) {
      symbol = `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" fill="#fff" stroke="#000" stroke-width="1.6"/>`;
    } else if (kind === 'vpm' || kind === 'kpm') {
      symbol = `<circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="#000" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="${kind === 'vpm' ? 3.5 : 5.5}" fill="${kind === 'vpm' ? '#000' : 'none'}" stroke="#000" stroke-width="1.4"/>`;
    } else {
      symbol = `<circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="#000" stroke-width="1.6"/>`;
    }
    out.push(symbol);
    const label = labels.pointLabels[i];
    const sub = p.landing ? ' (посадка)' : '';
    out.push(
      `<text x="${label.x}" y="${label.y}" font-size="14" text-anchor="${label.anchor}"><tspan font-weight="700">${esc(p.code)}</tspan>${p.name ? ` ${esc(p.name)}` : ''}${esc(sub)}</text>`,
    );
  });
  // кути повороту
  for (const turn of labels.turnLabels) {
    out.push(`<text x="${turn.x}" y="${turn.y}" font-size="12" font-style="italic" text-anchor="${turn.anchor}">${esc(turn.text)}</text>`);
  }
  // стрілка півночі
  const nx = W - 60;
  const ny = 62;
  out.push(
    `<line x1="${nx - sc.north.x * 22}" y1="${ny - sc.north.y * 22}" x2="${nx + sc.north.x * 30}" y2="${ny + sc.north.y * 30}" stroke="#000" stroke-width="1.8" marker-end="url(#arr)"/>` +
      `<text x="${nx + sc.north.x * 44}" y="${ny + sc.north.y * 44 + 5}" font-size="14" font-weight="700" text-anchor="middle">Пн</text>`,
  );
  // масштабна лінійка
  const km = nicePow(sc.scale);
  const len = km * sc.scale;
  out.push(
    `<line x1="26" y1="${H - 26}" x2="${(26 + len).toFixed(1)}" y2="${H - 26}" stroke="#000" stroke-width="2"/>` +
      `<line x1="26" y1="${H - 31}" x2="26" y2="${H - 21}" stroke="#000" stroke-width="1.5"/>` +
      `<line x1="${(26 + len).toFixed(1)}" y1="${H - 31}" x2="${(26 + len).toFixed(1)}" y2="${H - 21}" stroke="#000" stroke-width="1.5"/>` +
      `<text x="${(26 + len / 2).toFixed(1)}" y="${H - 34}" font-size="12" text-anchor="middle">${km} км</text>`,
  );
  out.push('</svg>');
  return out.join('');
}

/**
 * Друкований штурманський план польоту: шапка («по маршруту», «капітана …»), схема маршруту
 * (інлайн-SVG) і таблиця Wр / Wи з потрібною W та швидкістю за приладом V.
 * @param {object} flight опис польоту (див. nav-core.js)
 * @returns {string} HTML-документ
 */
export function renderShppHtml(flight) {
  const f = flight || {};
  const p = calcShpp(f);
  const scheme = planScheme(p, { width: SHPP_SCHEME_W, height: SHPP_SCHEME_H, marginX: 85, marginY: 80, rotationStep: 5, reserve: schemeReserved(SHPP_SCHEME_W, SHPP_SCHEME_H) });
  const svg = renderSchemeSvg(p, scheme);
  const arrow = (value, arrowChar) => `${cell(value)}${arrowChar ? ` ${esc(arrowChar)}` : ''}`;
  const rows = p.legs
    .map(leg => {
      const hCell = arrow(leg.h, leg.heightArrow || (leg.landingArrow && leg.heightArrow !== '↓' ? leg.landingArrow : ''));
      const corr = `${signed(leg.windCorrR)}${leg.windCorrI !== leg.windCorrR ? ` / ${signed(leg.windCorrI)}` : ''}`;
      return `<tr><td>${leg.index + 1}</td><td class="l">${esc(pointName(leg.from))} → ${esc(pointName(leg.to))}</td>` +
        `<td>${cell(leg.mk)}</td><td>${cell(leg.s)}</td><td>${cell(leg.t)}</td><td>${hCell}</td>` +
        `<td>${esc(turnText(leg.turnBefore))}</td><td>${esc(corr)}</td><td>${cell(leg.v)}</td>` +
        `<td>${esc(signed(leg.uR))}</td><td><b>${cell(leg.wR)}</b></td><td>${esc(signed(leg.uI))}</td><td><b>${cell(leg.wI)}</b></td>` +
        `<td>${cell(leg.wNeed)}</td><td><b>${arrow(leg.vNeedI, leg.speedArrow)}</b></td>` +
        `<td>${cell(leg.sRemaining)} / ${cell(leg.tRemaining)}</td><td class="l">${esc(leg.note)}</td></tr>`;
    })
    .join('');
  const colgroup = `<colgroup>${SHPP_COLS.map(w => `<col style="width:${w}%">`).join('')}</colgroup>`;
  const table = `<table>${colgroup}
<tr><th rowspan="2">№</th><th rowspan="2" class="l">Ділянка</th><th rowspan="2">МК, °</th><th rowspan="2">S, км</th><th rowspan="2">t, хв</th><th rowspan="2">Н, м</th><th rowspan="2">Кут повороту</th><th rowspan="2">Поправка на вітер, ° (р/и)</th><th rowspan="2">V за пр.</th><th colspan="2">Wр (розр. вітер)</th><th colspan="2">Wи (випр. вітер)</th><th rowspan="2">W потр. = S / t</th><th rowspan="2">V потр. = W − U</th><th rowspan="2">S ост. / t ост.</th><th rowspan="2" class="l">Примітка</th></tr>
<tr><th>U</th><th>Wр</th><th>U</th><th>Wи</th></tr>
${rows}
<tr class="tot"><td></td><td class="l">Разом</td><td></td><td>${cell(p.totals.S)}</td><td>${cell(p.totals.T)}</td><td colspan="12"></td></tr>
</table>`;
  const captain = p.captain ? esc(p.captainLine) : `${esc(p.captainLine || 'капітана')} ____________`;
  const body = `
<h1>${esc(p.title)}</h1>
<div class="rt"><div>по маршруту: ${esc(p.routeText)}</div><div class="cap">${captain}</div></div>
${svg}
${table}`;
  return shell('Штурманський план польоту', SHPP_CSS, body);
}
