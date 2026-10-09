// Модель даних модуля «Артилерія»: розбір таблиці обліку витрати й залишку боєприпасів УДШВ, підсумки й список змін для запису.
// Розбір іде за підписами аркушів, рядків і шапок, а не за номерами клітинок: підрозділи додаються й переставляються.
import { makeRef, readSheet } from './artillery-xlsx.js';

export const PERIODS = ['17:00', '00:00'];

const SHEET_SHELLS = 'витр.залиш.-сн';
const SHEET_CHARGES = 'витр.залиш.-зар';
const SHEET_LOSSES = 'втр.прот!';
const SHEET_FIRE = 'витрата снарядів';

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const lc = s => norm(s).toLowerCase();
const sheetKey = s => lc(s).replace(/[^a-zа-яіїєґ0-9.!-]/gi, '');
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Ключ підрозділу: однакові підрозділи з різним написанням («95 ошбр» / «95  одшбр») збігаються. */
export function unitKey(name) {
  return lc(name).replace(/ошбр/g, 'одшбр').replace(/[^a-zа-яіїєґ0-9]/g, '');
}
export const unitLabel = name => norm(name);

/** Скорочений ключ без позначення групи («АГр», «РУК», «ГРВ», «АРез», «ГРА»): «АГр, РУК 148 оабр» ≈ «АГр 148 оабр». */
function coreKey(name) {
  return unitKey(name).replace(/^(агр|рук|грв|арез|гра|гр)+/, '').replace(/^(агр|рук|грв|арез|гра|гр)+/, '');
}
/** Підрозділ за назвою: спершу точний збіг, потім за скороченим ключем (лише якщо він однозначний). */
function matchUnit(units, name) {
  if (!norm(name)) return null;
  const k = unitKey(name);
  const exact = units.filter(u => u.hasName && unitKey(u.name) === k);
  if (exact.length) return exact[0];
  const c = coreKey(name);
  if (!c || !/\d/.test(c)) return null;
  const loose = units.filter(u => u.hasName && coreKey(u.name) === c);
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) return null;
  const prefix = units.filter(u => u.hasName && k.length >= 4 && (unitKey(u.name).startsWith(k) || k.startsWith(unitKey(u.name))));
  return prefix.length === 1 ? prefix[0] : null;
}

const CLASS_LABEL = { he: 'Осколково-фугасні', cluster: 'Касетні', scatter: 'Дистанційного мінування', smoke: 'Димові', illum: 'Освітлювальні', rocket: 'Реактивні (РС)', mine: 'Міни' };
export const classLabel = cls => CLASS_LABEL[cls] || cls;

/** Калібр і клас боєприпасу за підписом рядка. */
export function classify(label) {
  const t = norm(label);
  const cal = /(\d{2,3})\s*мм/i.exec(t);
  const caliber = cal ? +cal[1] : null;
  let cls = 'he';
  if (/\(КАС\)|кластер|касет/i.test(t)) cls = 'cluster';
  else if (/\(Д\/М\)|дист/i.test(t)) cls = 'scatter';
  else if (/\(ДИМ\)|smoke|\bдим\b|\(дим\)/i.test(t)) cls = 'smoke';
  else if (/\(ОСВ\)|ilumin|illumin|освіт|світло/i.test(t)) cls = 'illum';
  else if (/\bРС\b/i.test(t) || /постріли\s+РС/i.test(t)) cls = 'rocket';
  else if (/\bміна\b/i.test(t)) cls = 'mine';
  return { caliber, cls };
}

const ITEM_CALIBER_GROUPS = [
  ['155 мм ОФ', i => i.caliber === 155 && (i.cls === 'he')],
  ['155 мм касетні', i => i.caliber === 155 && i.cls === 'cluster'],
  ['155 мм дист. мінування', i => i.caliber === 155 && i.cls === 'scatter'],
  ['155 мм димові й освітлювальні', i => i.caliber === 155 && (i.cls === 'smoke' || i.cls === 'illum')],
  ['152 мм', i => i.caliber === 152],
  ['122 мм РС', i => i.caliber === 122 && i.cls === 'rocket'],
  ['122 мм', i => i.caliber === 122],
  ['105 мм', i => i.caliber === 105],
  ['120 мм', i => i.caliber === 120],
  ['82 мм', i => i.caliber === 82],
  ['60 мм', i => i.caliber === 60],
];
/** Група для зведення за калібрами; нестандартні калібри дістають власну групу «NNN мм». */
export function caliberGroup(item) {
  for (const [name, test] of ITEM_CALIBER_GROUPS) if (test(item)) return name;
  return item.caliber ? `${item.caliber} мм` : 'Інше';
}
export const GROUP_ORDER = ITEM_CALIBER_GROUPS.map(g => g[0]);

function findSheet(wb, key) {
  return wb.sheets.find(s => sheetKey(s.name) === sheetKey(key));
}

// ---------- шапка «підрозділи парами витрата / залишок» ----------
function pairColumns(sheet, headerRow) {
  const pairs = [];
  for (let c = 2; c <= sheet.maxCol; c++) {
    if (/витрат/i.test(norm(sheet.value(c, headerRow))) && /залиш/i.test(norm(sheet.value(c + 1, headerRow)))) { pairs.push({ spentCol: c, leftCol: c + 1 }); c++; }
  }
  return pairs;
}

function unitNameAt(sheet, row, col) {
  // назва стоїть у першій клітинці злитого діапазону
  return norm(sheet.value(col, row));
}

function parseLedger(sheet, kind, issues) {
  // рядок шапки: перший, де в колонці B є «витрата»
  let headerRow = 0;
  for (let r = 1; r <= Math.min(sheet.maxRow, 12); r++) if (/витрат/i.test(norm(sheet.value(2, r)))) { headerRow = r; break; }
  if (!headerRow) { issues.push({ level: 'error', text: `На аркуші «${sheet.name}» не знайдено шапку «витрата б/п / залишок б/п».` }); return null; }
  const pairs = pairColumns(sheet, headerRow);
  const nameRow = headerRow - 2 >= 1 && norm(sheet.value(1, headerRow - 2)).toLowerCase().startsWith('сили') ? headerRow - 2 : 2;
  const units = [];
  let totalPair = null;
  for (const p of pairs) {
    const name = unitNameAt(sheet, nameRow, p.spentCol);
    if (/всього/i.test(name)) { totalPair = p; continue; }
    units.push({ ...p, name });
  }
  const items = [];
  // високоточні боєприпаси йдуть першими, до розділу «Кількість витрати боєприпасів»
  let hasRegularSection = false;
  for (let r = headerRow + 1; r <= sheet.maxRow; r++) if (/кількість витрати|кількість зарядів/i.test(norm(sheet.value(1, r)))) { hasRegularSection = true; break; }
  let section = kind === 'shells' && hasRegularSection ? 'precision' : 'regular';
  let seenTotal = false;
  for (let r = headerRow + 1; r <= sheet.maxRow; r++) {
    const label = norm(sheet.value(1, r));
    if (!label) continue;
    if (/витрата та залишок/i.test(label) && seenTotal) break;                       // друга, похідна таблиця за калібрами
    if (/високоточн/i.test(label)) { section = 'precision'; continue; }
    if (/кількість витрати|кількість зарядів/i.test(label)) { section = 'regular'; continue; }
    if (/^всього/i.test(label)) { seenTotal = true; continue; }
    if (/^(снаряди|заряди|сили)/i.test(label) && !classify(label).caliber) continue;
    if (/витрат/i.test(norm(sheet.value(2, r)))) continue;                           // повторна шапка
    const hasValues = units.some(u => isNum(sheet.value(u.spentCol, r)) || isNum(sheet.value(u.leftCol, r)));
    const allFormula = units.length && units.every(u => sheet.isFormula(u.spentCol, r));
    if (allFormula) continue;                                                        // рядок підсумків за калібром
    if (kind === 'shells' && !hasValues && !classify(label).caliber) continue;      // заголовок без даних
    const { caliber, cls } = kind === 'shells' ? classify(label) : { caliber: classify(label).caliber, cls: 'charge' };
    items.push({ id: `${kind}:${r}`, row: r, label, caliber, cls, kind: section === 'precision' ? 'precision' : 'regular' });
  }
  return { sheet: sheet.name, headerRow, nameRow, units, items, totalPair };
}

function cellNumber(sheet, col, row) {
  const v = sheet.value(col, row);
  return isNum(v) ? v : null;
}

function unitIdOf(name, index, col) { return `u${col}`; }

/** Розбирає книгу в модель. */
export async function parseArtilleryWorkbook(wb, meta = null) {
  const issues = [];
  const shellsSheetInfo = findSheet(wb, SHEET_SHELLS);
  if (!shellsSheetInfo) throw new Error('У таблиці немає аркуша «витр.залиш.-СН» — це не облік артилерійських боєприпасів УДШВ.');
  const shells = parseLedger(await readSheet(wb, shellsSheetInfo.name), 'shells', issues);
  if (!shells) throw new Error('Не вдалося розібрати аркуш обліку снарядів.');
  const shellSheet = await readSheet(wb, shellsSheetInfo.name);
  const chInfo = findSheet(wb, SHEET_CHARGES);
  const chSheet = chInfo ? await readSheet(wb, chInfo.name) : null;
  const charges = chSheet ? parseLedger(chSheet, 'charges', issues) : null;

  // підрозділи беремо з аркуша снарядів; решту аркушів зіставляємо за назвою
  const units = shells.units.map((u, i) => ({ id: unitIdOf(u.name, i, u.spentCol), name: u.name, shellCols: { spent: u.spentCol, left: u.leftCol }, hasName: !!u.name, nameCell: { sheet: shellSheet.name, col: u.spentCol, row: shells.nameRow } }));
  const colLetters = u => makeRef(u.shellCols.spent, 1).replace(/\d+/, '') + '–' + makeRef(u.shellCols.left, 1).replace(/\d+/, '');

  // аркуш «Витрата снарядів» містить формули на колонки аркуша снарядів: за ними пізнаємо підрозділ, навіть якщо його назви немає в шапці
  const fireInfo = findSheet(wb, SHEET_FIRE);
  const fireSheet = fireInfo ? await readSheet(wb, fireInfo.name) : null;
  const fireRowUnit = new Map();
  if (fireSheet) {
    for (let r = 3; r <= fireSheet.maxRow; r++) {
      const cols = new Map();
      for (let c = 4; c <= fireSheet.maxCol; c++) {
        const m = /!\$?([A-Z]{1,3})\$?\d+/.exec(fireSheet.formulaText(c, r) || '');
        if (m) cols.set(m[1], (cols.get(m[1]) || 0) + 1);
      }
      if (!cols.size) continue;
      const letter = [...cols.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const unit = units.find(u => makeRef(u.shellCols.spent, 1).replace(/\d+/, '') === letter);
      if (unit) fireRowUnit.set(r, unit);
    }
    for (const [r, unit] of fireRowUnit) {
      const label = norm(fireSheet.value(1, r));
      if (!unit.hasName && label) { unit.name = label; unit.hasName = true; unit.nameFrom = 'fire'; }
    }
  }
  const freeSlots = [];
  for (const u of units) {
    if (!u.hasName) { u.name = `Вільні колонки ${colLetters(u)}`; u.free = true; freeSlots.push(colLetters(u)); }
  }
  if (freeSlots.length) issues.push({ level: 'info', text: `У шапці аркуша снарядів немає назви над колонками: ${freeSlots.join(', ')}. Їх можна використати для нового підрозділу — назву вкаже бригада під час внесення.` });
  const seen = new Map();
  for (const u of units) {
    if (u.free) continue;
    const k = unitKey(u.name);
    if (seen.has(k)) { issues.push({ level: 'warn', text: `Підрозділ «${u.name}» зустрічається двічі в аркуші снарядів (колонки ${seen.get(k)} і ${colLetters(u)}).` }); }
    else seen.set(k, colLetters(u));
  }

  const values = new Map();            // `${itemId}|${unitId}` -> {spent, left}
  for (const it of shells.items) {
    for (const u of units) {
      const spent = cellNumber(shellSheet, u.shellCols.spent, it.row), left = cellNumber(shellSheet, u.shellCols.left, it.row);
      if (spent !== null || left !== null) values.set(`${it.id}|${u.id}`, { spent, left });
    }
  }
  const items = shells.items.map(it => ({ ...it, group: it.kind === 'precision' ? 'Високоточні' : caliberGroup(it) }));

  let chargeItems = [];
  const chargeUnits = [];
  if (charges && chSheet) {
    const orphans = [], dupes = [];
    for (const cu of charges.units) {
      if (!cu.name) continue;
      const entry = { id: `z${cu.spentCol}`, name: norm(cu.name), cols: { spent: cu.spentCol, left: cu.leftCol }, unitId: null };
      chargeUnits.push(entry);
      const match = matchUnit(units, cu.name);
      if (!match) { orphans.push(entry.name); continue; }
      if (match.chargeCols) { dupes.push(entry.name); continue; }
      match.chargeCols = entry.cols; match.chargeUnitId = entry.id; entry.unitId = match.id;
    }
    if (orphans.length) issues.push({ level: 'info', text: `Аркуш зарядів: підрозділи без пари в аркуші снарядів (їх заряди є в підсумках, але не належать жодному підрозділу зведення): ${orphans.join('; ')}.` });
    if (dupes.length) issues.push({ level: 'warn', text: `Аркуш зарядів: підрозділ записано двічі, до підрозділу віднесено першу колонку: ${dupes.join('; ')}.` });
    chargeItems = charges.items.map(it => ({ ...it, group: 'Заряди' }));
    for (const it of chargeItems) {
      for (const cu of chargeUnits) {
        const spent = cellNumber(chSheet, cu.cols.spent, it.row), left = cellNumber(chSheet, cu.cols.left, it.row);
        if (spent !== null || left !== null) values.set(`${it.id}|${cu.id}`, { spent, left });
      }
    }
  }

  // ВгЗ / КББ
  const fire = new Map();
  let fireMeta = null;
  if (fireSheet) {
    fireMeta = { sheet: fireSheet.name, vgzCol: 2, kbbCol: 3 };
    for (let r = 3; r <= fireSheet.maxRow; r++) {
      const name = norm(fireSheet.value(1, r));
      const vgz = cellNumber(fireSheet, 2, r), kbb = cellNumber(fireSheet, 3, r);
      if (/^всього/i.test(name)) continue;
      const u = fireRowUnit.get(r) || matchUnit(units, name);
      if (!u) { if (name && (vgz !== null || kbb !== null)) issues.push({ level: 'warn', text: `Аркуш «${fireSheet.name}»: «${name}» не збігається ні з одним підрозділом аркуша снарядів.` }); continue; }
      if (fire.has(u.id)) continue;
      fire.set(u.id, { row: r, vgz, kbb });
    }
  }

  // втрати противника
  const losses = { sheet: null, columns: [], rows: new Map() };
  const lossInfo = findSheet(wb, SHEET_LOSSES);
  if (lossInfo) {
    const ls = await readSheet(wb, lossInfo.name);
    losses.sheet = lossInfo.name;
    let group = '';
    for (let c = 2; c <= ls.maxCol; c++) {
      const g = norm(ls.value(c, 2)); if (g) group = g;
      const sub = norm(ls.value(c, 3));
      if (!sub && !g) continue;
      if (!sub) continue;
      losses.columns.push({ id: `L${c}`, col: c, group, sub, label: ['200', '300'].includes(sub) ? `О/с ${sub}` : `${group}: ${sub === 'знищ' ? 'знищено' : sub === 'пошк' ? 'пошкоджено' : sub}` });
    }
    for (let r = 4; r <= ls.maxRow; r++) {
      const name = norm(ls.value(1, r));
      if (!name || /^всього/i.test(name)) continue;
      const u = matchUnit(units, name);
      if (!u) { issues.push({ level: 'warn', text: `Аркуш «${lossInfo.name}»: «${name}» не збігається ні з одним підрозділом аркуша снарядів.` }); continue; }
      if (losses.rows.has(u.id)) continue;
      const row = { row: r, values: {} };
      for (const col of losses.columns) { const n = cellNumber(ls, col.col, r); if (n !== null) row.values[col.id] = n; }
      losses.rows.set(u.id, row);
    }
  }

  // контроль стовпця «ВСЬОГО» самої таблиці
  const checkTotals = (sheet, ledger, its, unitCols, label) => {
    if (!ledger?.totalPair) return;
    for (const it of its) {
      let spent = 0, left = 0;
      for (const c of unitCols) { spent += cellNumber(sheet, c.spent, it.row) ?? 0; left += cellNumber(sheet, c.left, it.row) ?? 0; }
      const tp = ledger.totalPair;
      const ts = sheet.value(tp.spentCol, it.row), tl = sheet.value(tp.leftCol, it.row);
      const hasAny = spent || left;
      if (!sheet.isFormula(tp.spentCol, it.row) && !sheet.isFormula(tp.leftCol, it.row) && ts === null && tl === null && hasAny) {
        issues.push({ level: 'warn', text: `${label}: у рядку «${it.label}» стовпець «ВСЬОГО» порожній, хоча в підрозділах є дані (${spent} / ${left}).` });
      } else if (typeof ts === 'number' && typeof tl === 'number' && (ts !== spent || tl !== left)) {
        issues.push({ level: 'warn', text: `${label}: у рядку «${it.label}» «ВСЬОГО» = ${ts} / ${tl}, а сума по підрозділах = ${spent} / ${left}.` });
      }
    }
  };
  checkTotals(shellSheet, shells, shells.items, shells.units.map(u => ({ spent: u.spentCol, left: u.leftCol })), 'Снаряди');
  if (charges && chSheet) checkTotals(chSheet, charges, charges.items, chargeUnits.map(c => c.cols), 'Заряди');

  // дублі рядків (однакові підписи)
  const labels = new Map();
  for (const it of items) {
    const k = lc(it.label);
    if (labels.has(k)) issues.push({ level: 'warn', text: `Рядок «${it.label}» повторюється в аркуші снарядів (рядки ${labels.get(k)} і ${it.row}).` });
    else labels.set(k, it.row);
  }
  // залишок без витрати нічого не означає, але від'ємні й дробові значення — помилка
  for (const [key, v] of values) {
    for (const f of ['spent', 'left']) {
      if (v[f] !== null && (v[f] < 0 || !Number.isInteger(v[f]))) issues.push({ level: 'error', text: `Некоректне число (${v[f]}) у ${f === 'spent' ? 'витраті' : 'залишку'}: ${key.split('|')[0]}.` });
    }
  }

  return {
    meta: meta || { date: null, period: null, journal: [] },
    units, items, chargeItems, chargeUnits, values, fire, fireMeta, losses, issues,
    refs: { shellsSheet: shellSheet.name, chargesSheet: chSheet?.name || null },
  };
}

// ---------- підсумки ----------
const add = (a, b) => (b === null || b === undefined ? a : (a ?? 0) + b);

export function valueOf(model, itemId, unitId) {
  return model.values.get(`${itemId}|${unitId}`) || { spent: null, left: null };
}

/** Сума по підрозділу або по всіх; повертає {spent, left}. */
export function sumItems(model, items, unitIds = null) {
  let spent = 0, left = 0;
  const ids = unitIds || model.units.map(u => u.id);
  for (const it of items) for (const id of ids) { const v = valueOf(model, it.id, id); spent = add(spent, v.spent) ?? 0; left = add(left, v.left) ?? 0; }
  return { spent, left };
}

/** '' — усе гаразд або даних немає; 'lo' — залишок не більший за поріг; 'out' — залишок нульовий, але витрата була. */
export function stockState(left, spent, limit) {
  if (left === null || left === undefined) return '';
  if (left === 0) return spent > 0 ? 'out' : '';
  return left <= limit ? 'lo' : '';
}

/** Порядок груп у зведеннях: відомі калібри за списком, решта за калібром, високоточні й заряди — наприкінці. */
export function groupRank(g) {
  const i = GROUP_ORDER.indexOf(g);
  if (i >= 0) return i;
  if (g === 'Високоточні') return 900;
  if (g === 'Заряди') return 950;
  return 100 + (parseInt(g, 10) || 0);
}

export function byCaliberGroup(model, unitIds = null) {
  const groups = new Map();
  for (const it of model.items) {
    if (it.kind === 'precision') continue;
    const g = it.group;
    if (!groups.has(g)) groups.set(g, { group: g, spent: 0, left: 0, items: [] });
    const s = sumItems(model, [it], unitIds);
    const e = groups.get(g);
    e.spent += s.spent; e.left += s.left; e.items.push(it);
  }
  return [...groups.values()].sort((a, b) => groupRank(a.group) - groupRank(b.group));
}

export function byUnit(model) {
  return model.units.map(u => {
    const regular = sumItems(model, model.items.filter(i => i.kind === 'regular'), [u.id]);
    const precision = sumItems(model, model.items.filter(i => i.kind === 'precision'), [u.id]);
    const charges = u.chargeUnitId ? sumItems(model, model.chargeItems, [u.chargeUnitId]) : { spent: 0, left: 0 };
    const f = model.fire.get(u.id) || {};
    return { unit: u, spent: regular.spent, left: regular.left, precisionSpent: precision.spent, precisionLeft: precision.left, chargesSpent: charges.spent, chargesLeft: charges.left, vgz: f.vgz ?? null, kbb: f.kbb ?? null };
  });
}

export function totals(model) {
  const regular = sumItems(model, model.items.filter(i => i.kind === 'regular'));
  const precision = sumItems(model, model.items.filter(i => i.kind === 'precision'));
  const charges = sumItems(model, model.chargeItems, model.chargeUnits.map(c => c.id));
  let vgz = 0, kbb = 0;
  for (const f of model.fire.values()) { vgz += f.vgz ?? 0; kbb += f.kbb ?? 0; }
  return { spent: regular.spent, left: regular.left, precisionSpent: precision.spent, precisionLeft: precision.left, chargesSpent: charges.spent, chargesLeft: charges.left, vgz, kbb };
}

/** Різниця двох знімків (наприклад, 00:00 мінус 17:00): за підписами рядків і ключами підрозділів. */
export function diffModels(prev, next) {
  const rows = [];
  const prevItems = new Map(prev.items.map(i => [lc(i.label), i]));
  for (const it of next.items) {
    const p = prevItems.get(lc(it.label));
    for (const u of next.units) {
      const pu = prev.units.find(x => unitKey(x.name) === unitKey(u.name));
      const a = p && pu ? valueOf(prev, p.id, pu.id) : { spent: null, left: null };
      const b = valueOf(next, it.id, u.id);
      const ds = (b.spent ?? 0) - (a.spent ?? 0);
      if (ds) rows.push({ item: it, unit: u, spentDelta: ds, left: b.left, prevLeft: a.left });
    }
  }
  return rows;
}

// ---------- запис: список змін клітинок для обраного підрозділу ----------
/**
 * entry = { shells: {itemId: {spent, left}}, charges: {itemId: {spent, left}}, vgz, kbb, losses: {colId: n} }
 * Повертає { edits: [{sheet, ref, value}], changed } — лише те, що справді відрізняється від збереженого.
 */
export function buildEdits(model, unitId, entry) {
  const unit = model.units.find(u => u.id === unitId);
  if (!unit) throw new Error('Підрозділ не знайдено в таблиці.');
  const edits = [];
  const put = (sheet, col, row, value, old) => {
    const next = value === '' || value === undefined || Number.isNaN(value) ? null : value;
    if ((old ?? null) === next) return;
    edits.push({ sheet, ref: makeRef(col, row), value: next });
  };
  const newName = norm(entry.name);
  if (newName && unit.free) put(unit.nameCell.sheet, unit.nameCell.col, unit.nameCell.row, newName, null);
  for (const [kind, items, cols, sheet] of [['shells', model.items, unit.shellCols, model.refs.shellsSheet], ['charges', model.chargeItems, unit.chargeCols, model.refs.chargesSheet]]) {
    const src = entry[kind] || {};
    for (const it of items) {
      const v = src[it.id];
      if (!v) continue;
      if (!cols) throw new Error(`Для підрозділу «${unit.name}» немає колонок на аркуші зарядів.`);
      const cur = valueOf(model, it.id, kind === 'charges' ? unit.chargeUnitId : unit.id);
      if ('spent' in v) put(sheet, cols.spent, it.row, v.spent, cur.spent);
      if ('left' in v) put(sheet, cols.left, it.row, v.left, cur.left);
    }
  }
  const f = model.fire.get(unitId);
  if (f && model.fireMeta) {
    if ('vgz' in entry) put(model.fireMeta.sheet, model.fireMeta.vgzCol, f.row, entry.vgz, f.vgz);
    if ('kbb' in entry) put(model.fireMeta.sheet, model.fireMeta.kbbCol, f.row, entry.kbb, f.kbb);
  }
  const l = model.losses.rows.get(unitId);
  if (l && entry.losses) {
    for (const col of model.losses.columns) if (col.id in entry.losses) put(model.losses.sheet, col.col, l.row, entry.losses[col.id], l.values[col.id]);
  }
  return { edits, changed: edits.length };
}

export function groupEdits(edits) {
  const by = new Map();
  for (const e of edits) { if (!by.has(e.sheet)) by.set(e.sheet, []); by.get(e.sheet).push({ ref: e.ref, value: e.value }); }
  return by;
}

// ---------- штамп «станом на …» у заголовках аркушів ----------
const STAMP_RE = /станом на\s+\d{1,2}[.:]\d{2}\s+\d{1,2}\.\d{1,2}\.\d{4}/i;
const pad2 = n => String(n).padStart(2, '0');

/** «станом на 17.00 08.10.2026»; період 00:00 у таблиці записують як кінець доби — «24.00». */
export function stampText(date, period) {
  const [y, m, d] = String(date).split('-');
  return `станом на ${period === '00:00' ? '24.00' : period.replace(':', '.')} ${pad2(+d)}.${pad2(+m)}.${y}`;
}

/** Зміни заголовків A1 аркушів снарядів і зарядів, де вже є «станом на …». */
export async function stampEdits(wb, date, period) {
  const edits = [];
  for (const key of [SHEET_SHELLS, SHEET_CHARGES]) {
    const info = findSheet(wb, key);
    if (!info) continue;
    const sh = await readSheet(wb, info.name);
    const cur = sh.value(1, 1);
    if (typeof cur !== 'string' || !STAMP_RE.test(cur)) continue;
    const next = cur.replace(STAMP_RE, stampText(date, period));
    if (next !== cur) edits.push({ sheet: info.name, ref: 'A1', value: next });
  }
  return edits;
}

/** Стан, який показати в шапці: дата й період із заголовка таблиці, якщо в службовому аркуші їх немає. */
export async function stampFromTitle(wb) {
  const info = findSheet(wb, SHEET_SHELLS);
  if (!info) return null;
  const cur = (await readSheet(wb, info.name)).value(1, 1);
  const m = typeof cur === 'string' && /станом на\s+(\d{1,2})[.:](\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i.exec(cur);
  if (!m) return null;
  const hh = +m[1];
  return { date: `${m[5]}-${pad2(+m[4])}-${pad2(+m[3])}`, period: hh === 17 ? '17:00' : (hh === 24 || hh === 0) ? '00:00' : `${pad2(hh)}:${m[2]}` };
}

// ---------- перенесення введеного на свіжу копію файлу ----------
/** Якщо файл змінили інші бригади, поки форма була відкрита: той самий набір правок, прив'язаний до підписів рядків. */
export function remapEntry(prevModel, nextModel, entry) {
  const mapKind = (kind, prevItems, nextItems) => {
    const out = {};
    const byLabel = new Map(nextItems.map(i => [lc(i.label), i]));
    for (const [id, v] of Object.entries(entry[kind] || {})) {
      const old = prevItems.find(i => i.id === id);
      const now = old && byLabel.get(lc(old.label));
      if (now) out[now.id] = v;
    }
    return out;
  };
  return { ...entry, shells: mapKind('shells', prevModel.items, nextModel.items), charges: mapKind('charges', prevModel.chargeItems, nextModel.chargeItems) };
}
