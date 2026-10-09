/* Меню перевірки даних перед створенням звіту: чисте ядро без DOM.
   Збирає проблеми з усіх таблиць (УДШВ, власні втрати, ПС, РВ), пропонує виправлення й застосовує
   рішення користувача до КОПІЇ розібраних даних. Файли-джерела й розібрані моделі не змінюються
   (raw → parsed → ручні виправлення → результат), кожне виправлення потрапляє в журнал.
   Проблеми даних на слайди не виносяться: вони розв'язуються тут. */

import { validateWorkbook } from './udshv-dashboard-core.js';
import { validateOwnLosses } from './own-losses-core.js';
import { strikeIssues } from './strikes-core.js';
import { dayNumber, daysWord, isoFromDay, longDate } from './presentation-format.js';

export const RESULT_CHOICES = [
  { value: 'hit', label: 'Уражено' },
  { value: 'partial', label: 'Частково' },
  { value: 'miss', label: 'Не уражено' },
];

const SKIP = { action: 'skip', label: 'Пропустити: рядки не враховуються' };
const KEEP = { action: 'keep', label: 'Залишити як є' };
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, l = a % 10; return a > 10 && a < 20 ? many : l === 1 ? one : l >= 2 && l <= 4 ? few : many; };
const rowsText = rows => (rows.length === 1 ? `рядок ${rows[0]}` : `рядки ${rows[0]}–${rows[rows.length - 1]}${rows.length > 2 && rows.length !== rows[rows.length - 1] - rows[0] + 1 ? ` (${rows.length})` : ''}`);
const monthOfSheet = name => {
  const MONTHS = ['січ', 'лют', 'берез', 'квіт', 'трав', 'черв', 'лип', 'серп', 'верес', 'жовт', 'листоп', 'груд'];
  const key = String(name).toLocaleLowerCase('uk-UA').trim();
  const index = MONTHS.findIndex(m => key.startsWith(m));
  const year = /(\d{2,4})\s*$/.exec(key);
  return index < 0 || !year ? '' : `${year[1].length === 2 ? '20' + year[1] : year[1]}-${String(index + 1).padStart(2, '0')}`;
};

/** Об'єднує послідовні рядки однієї групи в один пункт меню. */
function runs(list, sameGroup) {
  const out = [];
  for (const item of list) {
    const last = out[out.length - 1];
    if (last && sameGroup(last[last.length - 1], item) && item.rowNumber === last[last.length - 1].rowNumber + 1) last.push(item); else out.push([item]);
  }
  return out;
}

function reviewUdshv(udshv) {
  const items = [];
  const issues = validateWorkbook(udshv);
  const empty = new Set(udshv.records.filter(r => !Object.keys(r.values).length).map(r => `${r.sheet}|${r.rowNumber}`));
  const bySheet = new Map();
  for (const r of udshv.records) { if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []); bySheet.get(r.sheet).push(r); }
  for (const list of bySheet.values()) list.sort((a, b) => a.rowNumber - b.rowNumber);

  // Дата не з місяця аркуша: блок рядків із однією хибною датою.
  const outside = issues.filter(i => i.type === 'date-outside-month').sort((a, b) => (a.sheet < b.sheet ? -1 : a.sheet > b.sheet ? 1 : a.rowNumber - b.rowNumber));
  for (const group of runs(outside, (a, b) => a.sheet === b.sheet && a.raw === b.raw)) {
    const first = group[0];
    const month = monthOfSheet(first.sheet);
    const before = (bySheet.get(first.sheet) || []).filter(r => r.rowNumber < first.rowNumber && (!month || r.date.slice(0, 7) === month)).pop();
    items.push({
      id: `udshv:date-outside-month:${first.sheet}:${first.rowNumber}`, source: 'udshv', sourceLabel: 'УДШВ', severity: 'error', kind: 'date-outside-month',
      title: `Дата не з місяця аркуша: ${longDate(first.raw)}`,
      detail: `Аркуш «${String(first.sheet).trim()}», ${rowsText(group.map(g => g.rowNumber))}. Блок стоїть одразу після ${before ? longDate(before.date) : 'попередніх рядків'}.`,
      sheet: first.sheet, rows: group.map(g => g.rowNumber), field: 'date', current: first.raw,
      options: [...(before ? [{ action: 'fix', label: `Виправити на ${longDate(before.date)}`, value: before.date }] : []), { action: 'fix', label: 'Вказати іншу дату', editable: 'date' }, SKIP],
      defaultAction: 'skip',
    });
  }

  // Той самий підрозділ двічі за день, у обох рядках є дані.
  for (const d of issues.filter(i => i.type === 'duplicate' && !empty.has(`${i.sheet}|${i.rowNumber}`))) {
    items.push({
      id: `udshv:duplicate:${d.sheet}:${d.rowNumber}`, source: 'udshv', sourceLabel: 'УДШВ', severity: 'warning', kind: 'duplicate',
      title: `Підрозділ ${d.unit} двічі за ${longDate(d.raw)}`,
      detail: `Аркуш «${String(d.sheet).trim()}», рядок ${d.rowNumber}. Дані з обох рядків складаються.`,
      sheet: d.sheet, rows: [d.rowNumber], field: null, current: d.raw,
      options: [KEEP, { action: 'skip', label: 'Не враховувати другий рядок' }], defaultAction: 'keep',
    });
  }

  // Доби без жодного рядка: лише повідомлення.
  const missing = issues.filter(i => i.type === 'missing-date').map(i => i.raw).sort();
  let start = 0;
  for (let i = 1; i <= missing.length; i++) {
    if (i === missing.length || dayNumber(missing[i]) !== dayNumber(missing[i - 1]) + 1) {
      const from = missing[start], to = missing[i - 1], n = i - start;
      items.push({ id: `udshv:missing-date:${from}`, source: 'udshv', sourceLabel: 'УДШВ', severity: 'info', kind: 'missing-date', title: `Немає рядків за ${n} ${daysWord(n)}`, detail: n === 1 ? longDate(from) : `${longDate(from)} – ${longDate(to)}. Вважаються добами без даних.`, rows: [], options: [KEEP], defaultAction: 'keep' });
      start = i;
    }
  }

  // Розбір: рядки, які не вдалося прочитати.
  for (const i of issues.filter(x => ['invalid-date', 'negative', 'text-in-numeric', 'number-without-date'].includes(x.type))) {
    items.push({ id: `udshv:${i.type}:${i.sheet}:${i.rowNumber}:${i.metric || ''}`, source: 'udshv', sourceLabel: 'УДШВ', severity: 'warning', kind: i.type, title: i.text, detail: `Аркуш «${String(i.sheet).trim()}», рядок ${i.rowNumber}${i.metric ? `, показник ${i.metric}` : ''}${i.raw ? `: «${i.raw}»` : ''}. Не враховується.`, sheet: i.sheet, rows: [i.rowNumber], options: [KEEP], defaultAction: 'keep' });
  }
  for (const i of issues.filter(x => x.type === 'ammo-total')) {
    items.push({ id: `udshv:ammo-total:${i.sheet}:${i.rowNumber}`, source: 'udshv', sourceLabel: 'УДШВ', severity: 'info', kind: 'ammo-total', title: 'ВСЬОГО не дорівнює сумі боєприпасів', detail: `Аркуш «${String(i.sheet).trim()}», рядок ${i.rowNumber}: ${i.raw}. У звіті береться значення ВСЬОГО.`, sheet: i.sheet, rows: [i.rowNumber], options: [KEEP], defaultAction: 'keep' });
  }
  return items;
}

function reviewOwn(own) {
  const items = [];
  // Сусідні рядки беруться за порядком у таблиці (номером рядка), а не за датою.
  const records = [...own.records].sort((a, b) => (a.sheet < b.sheet ? -1 : a.sheet > b.sheet ? 1 : a.rowNumber - b.rowNumber));
  for (const r of records.filter(x => x.suspect)) {
    const at = records.findIndex(x => x.rowNumber === r.rowNumber && x.sheet === r.sheet);
    const prev = records.slice(0, at).reverse().find(x => !x.suspect && x.sheet === r.sheet), next = records.slice(at + 1).find(x => !x.suspect && x.sheet === r.sheet);
    const cands = [...new Set([next && next.date, prev && prev.date].filter(Boolean))];
    items.push({
      id: `own:date-outlier:${r.sheet}:${r.rowNumber}`, source: 'own', sourceLabel: 'Власні втрати', severity: 'error', kind: 'date-outlier',
      title: `Дата різко відрізняється від сусідніх рядків: ${longDate(r.date)}`,
      detail: `Рядок ${r.rowNumber}${prev ? `, перед ним ${longDate(prev.date)}` : ''}${next ? `, після нього ${longDate(next.date)}` : ''}. Тепер не враховується.`,
      sheet: r.sheet, rows: [r.rowNumber], field: 'date', current: r.date,
      options: [...cands.map(date => ({ action: 'fix', label: `Виправити на ${longDate(date)}`, value: date })), { action: 'fix', label: 'Вказати іншу дату', editable: 'date' }, SKIP],
      defaultAction: 'skip',
    });
  }
  for (const r of own.undated || []) {
    items.push({ id: `own:invalid-date:${r.sheet}:${r.rowNumber}`, source: 'own', sourceLabel: 'Власні втрати', severity: 'error', kind: 'invalid-date', title: 'Дату не вдалося прочитати', detail: `Рядок ${r.rowNumber}${r.dateRaw ? `: «${r.dateRaw}»` : ''}. Не враховується.`, sheet: r.sheet, rows: [r.rowNumber], field: 'date', current: r.dateRaw, options: [{ action: 'fix', label: 'Вказати дату', editable: 'date' }, SKIP], defaultAction: 'skip' });
  }
  for (const i of validateOwnLosses(own)) {
    if (i.type === 'total-mismatch') items.push({ id: `own:total-mismatch:${i.sheet}:${i.metric}`, source: 'own', sourceLabel: 'Власні втрати', severity: 'warning', kind: 'total-mismatch', title: `Підсумок ${i.metric} не збігається із сумою рядків`, detail: `Сума рядків і рядок «ВСЬОГО» таблиці: ${i.raw}. У звіті береться сума рядків.`, sheet: i.sheet, rows: [], options: [KEEP], defaultAction: 'keep' });
    else if (['negative', 'text-in-numeric'].includes(i.type)) items.push({ id: `own:${i.type}:${i.sheet}:${i.rowNumber}:${i.metric}`, source: 'own', sourceLabel: 'Власні втрати', severity: 'warning', kind: i.type, title: i.text, detail: `Рядок ${i.rowNumber}, ${i.metric}: «${i.raw}».`, sheet: i.sheet, rows: [i.rowNumber], options: [KEEP], defaultAction: 'keep' });
  }
  return items;
}

function reviewStrikes(group) {
  const items = [];
  const label = group.title;
  const src = `strikes:${group.id}`;
  const groupedIssues = new Map();
  for (const i of strikeIssues(group.strikes)) {
    const key = `${i.type}|${i.raw}`;
    if (!groupedIssues.has(key)) groupedIssues.set(key, { ...i, rows: [] });
    groupedIssues.get(key).rows.push(i.rowNumber);
  }
  for (const i of groupedIssues.values()) {
    const base = { source: src, sourceLabel: label, sheet: null, rows: i.rows, current: i.raw };
    const first = i.rows[0];
    const where = `${rowsText(i.rows)}${i.raw ? `: «${i.raw}»` : ''}`;
    if (i.type === 'invalid-date') items.push({ ...base, id: `${src}:invalid-date:${first}`, severity: 'error', kind: 'invalid-date', title: 'Дату не вдалося прочитати', detail: `${where}. Не враховується.`, field: 'date', options: [{ action: 'fix', label: 'Вказати дату', editable: 'date' }, SKIP], defaultAction: 'skip' });
    else if (i.type === 'invalid-count') items.push({ ...base, id: `${src}:invalid-count:${first}`, severity: 'warning', kind: 'invalid-count', title: 'Кількість боєприпасів не число', detail: `${where}. Зараз вважається нулем.`, field: 'count', options: [{ action: 'fix', label: 'Вказати кількість', editable: 'number' }, KEEP], defaultAction: 'keep' });
    else if (i.type === 'unknown-result') items.push({ ...base, id: `${src}:unknown-result:${first}`, severity: 'warning', kind: 'unknown-result', title: `Результат не розпізнано (${i.rows.length})`, detail: `${where}. Не входить в оцінку ефективності.`, field: 'result', options: [...RESULT_CHOICES.map(c => ({ action: 'fix', label: `Вважати: ${c.label}`, value: c.value })), KEEP], defaultAction: 'keep' });
  }
  return items;
}

const ORDER = { error: 0, warning: 1, info: 2 };

/** Збирає пункти меню зі всіх завантажених таблиць. groups: [{ id, title, strikes }]. */
export function reviewData({ udshv = null, ownLosses = null, groups = [] } = {}) {
  const items = [
    ...(udshv ? reviewUdshv(udshv) : []),
    ...(ownLosses ? reviewOwn(ownLosses) : []),
    ...groups.filter(g => g.strikes).flatMap(reviewStrikes),
  ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const counts = { total: items.length, error: 0, warning: 0, info: 0, actionable: 0 };
  for (const item of items) { counts[item.severity]++; if (item.options.some(o => o.action === 'fix' || o.action === 'skip')) counts.actionable++; }
  return { items, counts, clean: items.length === 0 };
}

/** Рішення за замовчуванням («пропустити»): дії за defaultAction кожного пункту. */
export const defaultDecisions = items => Object.fromEntries(items.map(item => [item.id, { action: item.defaultAction }]));

const copyRecord = r => ({ ...r, values: r.values ? { ...r.values } : undefined, types: r.types ? [...r.types] : undefined, reasons: r.reasons ? [...r.reasons] : undefined });
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rowNumber - b.rowNumber);
const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * Застосовує рішення до копій. Повертає { udshv, ownLosses, groups, corrections, rejected }.
 * decisions: { [itemId]: { action: 'fix'|'skip'|'keep', value? } }. Невалідне значення виправлення відхиляється
 * й пункт лишається зі значенням за замовчуванням; відхилені пункти повертаються в rejected.
 */
export function applyReview(input, review, decisions = {}) {
  const corrections = [];
  const rejected = [];
  const out = { udshv: input.udshv ? { ...input.udshv, records: input.udshv.records.map(copyRecord) } : null, ownLosses: null, groups: [], corrections, rejected };
  if (input.ownLosses) out.ownLosses = { ...input.ownLosses, records: input.ownLosses.records.map(copyRecord), undated: (input.ownLosses.undated || []).map(copyRecord) };
  out.groups = (input.groups || []).map(g => (g.strikes ? { ...g, strikes: { ...g.strikes, records: g.strikes.records.map(copyRecord), undated: (g.strikes.undated || []).map(copyRecord), issues: [...(g.strikes.issues || [])] } } : g));

  for (const item of review.items) {
    const decision = decisions[item.id] || { action: item.defaultAction };
    const log = (field, from, to, action) => corrections.push({ source: item.source, sourceLabel: item.sourceLabel, sheet: item.sheet || null, rows: item.rows, field, from, to, action, title: item.title });
    if (decision.action === 'keep') continue;
    const valid = decision.action === 'fix'
      ? (item.field === 'date' ? isIso(decision.value) : item.field === 'count' ? Number.isInteger(Number(decision.value)) && Number(decision.value) >= 0 && decision.value !== '' && decision.value != null : item.field === 'result' ? RESULT_CHOICES.some(c => c.value === decision.value) : false)
      : true;
    if (!valid) { rejected.push({ id: item.id, reason: 'Некоректне значення виправлення' }); continue; }
    const rows = new Set(item.rows);

    if (item.source === 'udshv') {
      if (decision.action === 'skip') { out.udshv.records = out.udshv.records.filter(r => !(r.sheet === item.sheet && rows.has(r.rowNumber))); log('рядки', 'враховувались', 'не враховуються', 'skip'); }
      else if (item.field === 'date') { for (const r of out.udshv.records) if (r.sheet === item.sheet && rows.has(r.rowNumber)) { log('date', r.date, decision.value, 'fix'); r.date = decision.value; } out.udshv.records.sort(byDate); }
    } else if (item.source === 'own') {
      const own = out.ownLosses;
      const findIn = list => list.filter(r => r.sheet === item.sheet && rows.has(r.rowNumber));
      if (decision.action === 'skip') { for (const r of findIn(own.records)) r.suspect = true; }
      else if (item.field === 'date') {
        for (const r of findIn(own.records)) { log('date', r.date, decision.value, 'fix'); r.date = decision.value; r.suspect = false; }
        const moved = findIn(own.undated);
        for (const r of moved) { log('date', r.dateRaw || '', decision.value, 'fix'); r.date = decision.value; own.records.push(r); }
        own.undated = own.undated.filter(r => !moved.includes(r));
        own.records.sort(byDate);
      }
    } else if (item.source.startsWith('strikes:')) {
      const group = out.groups.find(g => `strikes:${g.id}` === item.source);
      const table = group.strikes;
      if (decision.action === 'skip') continue;
      const resolved = type => { table.issues = table.issues.filter(i => !(i.type === type && rows.has(i.rowNumber))); };
      if (item.field === 'date') {
        resolved('invalid-date');
        const moved = table.undated.filter(r => rows.has(r.rowNumber));
        for (const r of moved) { log('date', r.dateRaw || '', decision.value, 'fix'); r.date = decision.value; table.records.push(r); }
        table.undated = table.undated.filter(r => !moved.includes(r));
        table.records.sort(byDate);
      } else if (item.field === 'count') {
        resolved('invalid-count');
        for (const r of [...table.records, ...table.undated]) if (rows.has(r.rowNumber)) { log('count', String(r.count), String(Number(decision.value)), 'fix'); r.count = Number(decision.value); }
      } else if (item.field === 'result') {
        resolved('unknown-result');
        for (const r of [...table.records, ...table.undated]) if (rows.has(r.rowNumber)) { log('result', r.result, decision.value, 'fix'); r.result = decision.value; }
      }
    }
  }
  // Після виправлень перераховується перелік проблем, щоб меню можна було показати повторно.
  return out;
}
