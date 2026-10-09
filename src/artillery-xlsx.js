// Читання й точковий запис xlsx для модуля «Артилерія».
// Запис змінює лише вказані клітинки в XML аркуша: формули, злиття, стилі, приховані аркуші й решта частин файлу лишаються як були.
// Кешовані значення формул після запису прибираються, а в книзі вмикається fullCalcOnLoad: Excel, LibreOffice і Nextcloud перерахують
// підсумки самі, замість показувати застарілі числа.
import JSZip from 'jszip';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const META_SHEET_NAME = 'EasyWAR_Артилерія';

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrsOf = tag => { const o = {}; for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) o[m[1]] = unesc(m[2]); return o; };

export function colToNum(col) { let n = 0; for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
export function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Некоректна адреса клітинки «${ref}».`);
  return { col: colToNum(m[1]), row: +m[2] };
}
export const makeRef = (col, row) => `${numToCol(col)}${row}`;

async function textOf(zip, path) {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

/** Відкриває книгу: перелік аркушів, спільні рядки, кеш XML. */
export async function openWorkbook(bytes) {
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('Це не схоже на файл .xlsx (не вдалося розпакувати).'); }
  const wbXml = await textOf(zip, 'xl/workbook.xml');
  if (!wbXml) throw new Error('У файлі немає xl/workbook.xml — це не книга Excel.');
  const relsXml = (await textOf(zip, 'xl/_rels/workbook.xml.rels')) || '';
  const rels = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) { const a = attrsOf(m[0]); if (a.Id) rels[a.Id] = a.Target; }
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const a = attrsOf(m[0]);
    let target = rels[a['r:id']] || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    sheets.push({ name: a.name, sheetId: a.sheetId, hidden: a.state === 'hidden' || a.state === 'veryHidden', path: target });
  }
  const shared = [];
  const sst = await textOf(zip, 'xl/sharedStrings.xml');
  if (sst) {
    for (const si of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
      const parts = si[1] ? [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])) : [];
      shared.push(parts.join(''));
    }
  }
  return { zip, sheets, shared, xml: new Map(), edited: new Set(), cache: new Map() };
}

async function sheetXml(wb, name) {
  const sh = wb.sheets.find(s => s.name === name);
  if (!sh) throw new Error(`У таблиці немає аркуша «${name}».`);
  if (!wb.xml.has(name)) {
    const xml = await textOf(wb.zip, sh.path);
    if (xml == null) throw new Error(`Не вдалося прочитати аркуш «${name}».`);
    wb.xml.set(name, xml);
  }
  return wb.xml.get(name);
}

/** Читає аркуш: клітинки (значення, ознака формули), злиття, розміри. */
export async function readSheet(wb, name) {
  if (wb.cache.has(name)) return wb.cache.get(name);
  const xml = await sheetXml(wb, name);
  const cells = new Map();
  let maxRow = 0, maxCol = 0;
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrsOf(m[1]);
    if (!a.r) continue;
    const inner = m[2] || '';
    const fMatch = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner);
    const hasF = /<f\b/.test(inner);
    const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
    let v = null;
    if (a.t === 'inlineStr') v = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])).join('');
    else if (vMatch) {
      const raw = unesc(vMatch[1]);
      if (a.t === 's') v = wb.shared[+raw] ?? '';
      else if (a.t === 'str' || a.t === 'e') v = raw;
      else if (a.t === 'b') v = raw === '1';
      else { const n = Number(raw); v = Number.isFinite(n) ? n : raw; }
    }
    const { col, row } = parseRef(a.r);
    maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
    if (v !== null || hasF) cells.set(a.r, { v, formula: hasF, f: fMatch ? unesc(fMatch[1]) : null });
  }
  const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)].map(m => {
    const [a, b = a] = m[1].split(':');
    const p = parseRef(a), q = parseRef(b);
    return { c1: p.col, r1: p.row, c2: q.col, r2: q.row };
  });
  const sheet = {
    name, cells, merges, maxRow, maxCol,
    value: (col, row) => cells.get(makeRef(col, row))?.v ?? null,
    isFormula: (col, row) => cells.get(makeRef(col, row))?.formula === true,
    formulaText: (col, row) => cells.get(makeRef(col, row))?.f ?? null,
  };
  wb.cache.set(name, sheet);
  return sheet;
}

const CELL_RE = ref => new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);

function buildCell(ref, style, value) {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === '' || value === undefined) return `<c r="${ref}"${s}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Некоректне число для клітинки ${ref}.`);
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/** Повертає XML аркуша з однією зміненою клітинкою. Клітинки з формулами не перезаписуються. */
export function patchCell(xml, ref, value) {
  const { col, row } = parseRef(ref);
  const emptyData = /<sheetData\s*\/>/.exec(xml);
  if (emptyData) {
    const cell = buildCell(ref, '', value);
    return xml.replace(emptyData[0], `<sheetData><row r="${row}">${cell}</row></sheetData>`);
  }
  const open = xml.indexOf('<sheetData>');
  const close = xml.indexOf('</sheetData>');
  if (open < 0 || close < 0) throw new Error('Несподівана будова аркуша (немає sheetData).');
  const head = xml.slice(0, open + 11), data = xml.slice(open + 11, close), tail = xml.slice(close);

  // рядки: [{row, start, end, text}]
  const rows = [];
  for (const m of data.matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
    const a = attrsOf(m[1]);
    rows.push({ row: +a.r, start: m.index, end: m.index + m[0].length, attrs: m[1], inner: m[3] || '', selfClosed: m[2] === '/>' });
  }
  const found = rows.find(r => r.row === row);
  const stripSpans = attrs => attrs.replace(/\s+spans="[^"]*"/, '');
  if (!found) {
    const cell = buildCell(ref, '', value);
    const next = rows.find(r => r.row > row);
    const rowXml = `<row r="${row}">${cell}</row>`;
    const at = next ? next.start : data.length;
    return head + data.slice(0, at) + rowXml + data.slice(at) + tail;
  }
  let inner = found.inner;
  const cm = CELL_RE(ref).exec(inner);
  let newInner;
  if (cm) {
    if (/<f\b/.test(cm[0])) throw new Error(`Клітинка ${ref} містить формулу — її змінювати не можна.`);
    const style = attrsOf(cm[0].slice(0, cm[0].indexOf('>') + 1)).s || '';
    newInner = inner.slice(0, cm.index) + buildCell(ref, style, value) + inner.slice(cm.index + cm[0].length);
  } else {
    // вставка в правильне місце за номером колонки
    const list = [...inner.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(c => ({ c: parseRef(attrsOf(c[1]).r).col, at: c.index }));
    const after = list.find(c => c.c > col);
    const cell = buildCell(ref, '', value);
    const at = after ? after.at : inner.length;
    newInner = inner.slice(0, at) + cell + inner.slice(at);
  }
  const rowXml = `<row${stripSpans(found.attrs)}>${newInner}</row>`;
  return head + data.slice(0, found.start) + rowXml + data.slice(found.end) + tail;
}

/** Записує пачку змін в аркуш: edits = [{ ref, value }]. */
export async function setCells(wb, name, edits) {
  let xml = await sheetXml(wb, name);
  for (const { ref, value } of edits) xml = patchCell(xml, ref, value);
  wb.xml.set(name, xml);
  wb.edited.add(name);
  wb.cache.delete(name);
}

function stripCachedFormulaValues(xml) {
  return xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, cell => (/<f\b/.test(cell) ? cell.replace(/<v\b[^>]*>[\s\S]*?<\/v>|<v\s*\/>/g, '') : cell));
}

function withFullCalc(wbXml) {
  if (/<calcPr\b/.test(wbXml)) {
    return wbXml.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, a, slash) => `<calcPr${a.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${slash}>`);
  }
  let at = -1;
  for (const tag of ['</sheets>', '</functionGroups>', '</externalReferences>', '</definedNames>']) {
    const i = wbXml.lastIndexOf(tag);
    if (i >= 0) at = Math.max(at, i + tag.length);
  }
  if (at < 0) return wbXml;
  return wbXml.slice(0, at) + '<calcPr fullCalcOnLoad="1"/>' + wbXml.slice(at);
}

// ---------- службовий аркуш EasyWAR_Артилерія: дата, період і журнал внесення ----------
export async function readMeta(wb) {
  if (!wb.sheets.some(s => s.name === META_SHEET_NAME)) return { date: null, period: null, journal: [] };
  const sh = await readSheet(wb, META_SHEET_NAME);
  const journal = [];
  for (let r = 6; r <= sh.maxRow; r++) {
    const at = sh.value(1, r);
    if (at !== null) journal.push({ at: String(at), unit: String(sh.value(2, r) ?? ''), period: String(sh.value(3, r) ?? ''), date: String(sh.value(4, r) ?? ''), changed: sh.value(5, r) });
  }
  return { date: sh.value(2, 2) !== null ? String(sh.value(2, 2)) : null, period: sh.value(2, 3) !== null ? String(sh.value(2, 3)) : null, journal };
}

/** Створює (якщо немає) прихований аркуш-журнал і записує дату/період. */
export async function ensureMetaSheet(wb) {
  if (wb.sheets.some(s => s.name === META_SHEET_NAME)) return;
  const relsPath = 'xl/_rels/workbook.xml.rels';
  let rels = await textOf(wb.zip, relsPath);
  let wbXml = await textOf(wb.zip, 'xl/workbook.xml');
  let types = await textOf(wb.zip, '[Content_Types].xml');
  const used = new Set(wb.sheets.map(s => s.path));
  let n = wb.sheets.length + 1;
  while (used.has(`xl/worksheets/sheet${n}.xml`) || wb.zip.file(`xl/worksheets/sheet${n}.xml`)) n++;
  const path = `xl/worksheets/sheet${n}.xml`;
  const rid = `rIdArt${n}`;
  const sheetId = Math.max(0, ...wb.sheets.map(s => +s.sheetId || 0)) + 1;
  const sheetXmlText = `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>EasyWAR — облік артилерійських боєприпасів (службовий аркуш, не змінювати вручну)</t></is></c></row>` +
    `<row r="2"><c r="A2" t="inlineStr"><is><t>Дата</t></is></c></row>` +
    `<row r="3"><c r="A3" t="inlineStr"><is><t>Період</t></is></c></row>` +
    `<row r="5"><c r="A5" t="inlineStr"><is><t>Журнал внесення: час</t></is></c><c r="B5" t="inlineStr"><is><t>Підрозділ</t></is></c><c r="C5" t="inlineStr"><is><t>Період</t></is></c><c r="D5" t="inlineStr"><is><t>Дата</t></is></c><c r="E5" t="inlineStr"><is><t>Змінено клітинок</t></is></c></row>` +
    `</sheetData></worksheet>`;
  wb.zip.file(path, sheetXmlText);
  rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`);
  wbXml = wbXml.replace('</sheets>', `<sheet name="${esc(META_SHEET_NAME)}" sheetId="${sheetId}" state="hidden" r:id="${rid}"/></sheets>`);
  if (!/xmlns:r=/.test(wbXml)) wbXml = wbXml.replace(/<workbook\b/, '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  types = types.replace('</Types>', `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  wb.zip.file(relsPath, rels);
  wb.zip.file('xl/workbook.xml', wbXml);
  wb.zip.file('[Content_Types].xml', types);
  wb.sheets.push({ name: META_SHEET_NAME, sheetId: String(sheetId), hidden: true, path });
}

/** Дата, період і запис у журнал внесення. */
export async function writeMeta(wb, { date, period, unit, changed, at }) {
  await ensureMetaSheet(wb);
  const sh = await readSheet(wb, META_SHEET_NAME);
  const next = Math.max(6, sh.maxRow + 1);
  await setCells(wb, META_SHEET_NAME, [
    { ref: 'B2', value: date }, { ref: 'B3', value: period },
    { ref: `A${next}`, value: at }, { ref: `B${next}`, value: unit }, { ref: `C${next}`, value: period }, { ref: `D${next}`, value: date }, { ref: `E${next}`, value: changed },
  ]);
}

/** Збирає .xlsx назад. */
export async function saveWorkbook(wb) {
  for (const name of wb.sheets.map(s => s.name)) {
    if (!wb.xml.has(name)) continue;
    const sh = wb.sheets.find(s => s.name === name);
    wb.zip.file(sh.path, wb.edited.has(name) ? stripCachedFormulaValues(wb.xml.get(name)) : wb.xml.get(name));
  }
  if (wb.edited.size) {
    // формули інших аркушів теж залежать від змінених клітинок: прибираємо в них застарілі кешовані значення
    for (const sh of wb.sheets) {
      if (wb.edited.has(sh.name)) continue;
      const xml = wb.xml.get(sh.name) ?? await textOf(wb.zip, sh.path);
      if (xml && /<f\b/.test(xml)) wb.zip.file(sh.path, stripCachedFormulaValues(xml));
    }
    const wbXml = await textOf(wb.zip, 'xl/workbook.xml');
    wb.zip.file('xl/workbook.xml', withFullCalc(wbXml));
  }
  return wb.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
