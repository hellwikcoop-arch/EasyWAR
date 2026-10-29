// Підказки зв'язків між таблицями для «Мого дашборда» (E3б, B1 → екран): чиста логіка без DOM, сховищ і
// мережі. Ядро пошуку — table-link-core.js; тут лише добір таблиць зі схеми профілю й прочитаних рядків та
// людські тексти й стан рішень (B3). Нічого не зберігає: рішення людини ухвалює і записує викликач через
// `confirmRelation`/`rejectRelation`/`clearRelation` ядра схеми.

import { CARDINALITY_LABELS, LINK_LIMITS, connectedGroups, describeCandidate, tableFromSchema } from './table-link-core.js';
import { moduleSourceId } from './profile-schema-modules-core.js';
import { LIMITS, groupsOf, relationId, relationsOf, staleRelations } from './profile-schema-core.js';

export const REASON_TEXT = Object.freeze({
  'columns-limited': `Розглянуто не всі стовпці (понад ${LINK_LIMITS.maxColumns}).`,
  'pairs-limited': `Розглянуто не всі пари стовпців (ліміт ${LINK_LIMITS.maxPairs}).`,
  'candidates-limited': `Знайдено більше варіантів, ніж показано (${LINK_LIMITS.maxCandidates}).`,
  truncated: 'Таблицю прочитано не повністю.',
  'type-mismatch': 'Не порівнювались стовпці «дата» й текст, у якому є дати.',
  'role-skipped': 'Підтверджену роль не вдалося порівняти: стовпець непридатний або види стовпців різні.',
  'component-prefilter': 'Складені ключі зі стовпців, що слабко збігаються, не перевірялись.',
  'sample-prefilter': 'Частину складених ключів відсіяно за вибіркою рядків.',
});

export const EXCLUSION_TEXT = Object.freeze({
  measure: 'кількість — це міра, а не ключ',
  sequential: 'порядкові номери',
  'few-values': 'менш як два різні значення',
  blank: 'забагато порожніх клітинок',
  flag: 'ознака «так/ні»',
});

const percent = value => `${Math.floor(value * 100)} %`;

/**
 * Таблиці для пошуку з модулів гілки: лише ті, що вже є в схемі профілю і з прочитаними даними. Решта — у
 * `skipped` з причиною, щоб людина бачила, чого пошук не стосувався. Понад `maxTables` — перші, `limited` каже, скільки пропущено.
 */
export function linkInputs(schema, modules, data) {
  const tables = [];
  const skipped = [];
  const list = Array.isArray(modules) ? modules : [];
  for (const module of list) {
    const title = module?.title || String(module?.id ?? '');
    const payload = data instanceof Map ? data.get(module.id) : data?.[module.id];
    if (!payload || payload.failed === true) { skipped.push({ title, reason: 'дані не прочитано' }); continue; }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) { skipped.push({ title, reason: 'таблиця порожня' }); continue; }
    const made = tableFromSchema(schema, moduleSourceId(module.id), rows.slice(0, LINK_LIMITS.maxRows), { truncated: payload.truncated === true || rows.length > LINK_LIMITS.maxRows });
    if (!made.ok) { skipped.push({ title, reason: 'ще немає в профілі' }); continue; }
    tables.push(made.table);
  }
  const limited = Math.max(0, tables.length - LINK_LIMITS.maxTables);
  return { tables: tables.slice(0, LINK_LIMITS.maxTables), skipped, limited };
}

/** Текст питання до людини за видом із `linkIssues`; `titles` — Map sourceId → назва таблиці. */
export function issueText(issue, titles = new Map()) {
  const where = issue.sourceId ? ` (${titles.get(issue.sourceId) || issue.sourceId})` : '';
  switch (issue.kind) {
    case 'unknown-header': return `Заголовок «${issue.header}»${where} не розпізнано.`;
    case 'ambiguous-column': return `Стовпець «${issue.header}»${where} неоднозначний за заголовком.`;
    case 'date-order-assumed': return `Дати в «${issue.header}»${where} прочитано як день/місяць/рік лише за припущенням: перевірте порядок, перш ніж спиратися на зв'язок.`;
    case 'date-format': return `У «${issue.header}»${where} кілька форматів дат або є нерозпізнані значення (${issue.unparsed}).`;
    case 'date-format-mismatch': return 'Формати дат у ключі в двох таблицях різні.';
    case 'truncated': return `Таблицю${where} прочитано не повністю (${issue.rows} рядків).`;
    case 'unmatched-keys': return `Без пари: ${issue.onlyLeft} значень ключа в лівій таблиці, ${issue.onlyRight} у правій.`;
    default: return `Потрібна увага: ${issue.kind}.`;
  }
}

/**
 * Показ однієї пари: назви, кандидати з підписом і застереженнями, повнота пошуку. `issuesOf(candidate)` дає
 * питання (`linkIssues`), їх рахує викликач, бо це читання всіх рядків. Значень клітинок тут немає.
 */
export function pairView(pair, titles, issuesOf = () => []) {
  const reasons = (pair.reasons || []).map(code => REASON_TEXT[code] || code);
  const exclusions = (pair.exclusions || []).map(item => `«${item.column}» (${titles.get(item.sourceId) || item.sourceId}): ${EXCLUSION_TEXT[item.reason] || item.reason}`);
  const candidates = (pair.candidates || []).map(candidate => ({
    text: describeCandidate(candidate),
    basis: candidate.basis === 'roles' ? 'за підтвердженими ролями' : 'за збігом значень',
    match: percent(candidate.containment),
    candidate,
    issues: issuesOf(candidate).map(issue => issueText(issue, titles)),
  }));
  return {
    leftTitle: titles.get(pair.leftId) || pair.leftId,
    rightTitle: titles.get(pair.rightId) || pair.rightId,
    candidates,
    exhaustive: pair.exhaustive === true,
    completeness: pair.exhaustive === true
      ? 'Пошук вичерпний у межах правил: ключі до трьох стовпців, унікальні хоча б з одного боку.'
      : 'Пошук може бути неповним.',
    reasons,
    exclusions,
  };
}

/** Рядок-підсумок: скільки пар, у скількох знайдено варіанти, скільки пошуків неповні. */
export function summaryLine(views) {
  const found = views.filter(view => view.candidates.length).length;
  const partial = views.filter(view => !view.exhaustive).length;
  const parts = [`Пар таблиць: ${views.length}`, `з варіантами: ${found}`];
  if (partial) parts.push(`пошук неповний у ${partial}`);
  return parts.join(' · ');
}

// ─── Рішення людини (B3) ───────────────────────────────────────────────────────────────────────────────

const sidesOf = candidate => ({
  left: { sourceId: candidate.left.sourceId, columns: [...candidate.left.columns] },
  right: { sourceId: candidate.right.sourceId, columns: [...candidate.right.columns] },
});

/**
 * Стан рішення про кандидата у схемі профілю: `confirmed` (цей ключ підтверджено), `rejected` («це не ключ»),
 * `taken` (пара вже має інший підтверджений ключ; `takenBy` — його id) або `open`.
 */
export function decisionOf(schema, candidate) {
  const { left, right } = sidesOf(candidate);
  const id = relationId(left, right);
  const list = relationsOf(schema);
  const same = list.find(relation => relation.id === id);
  if (same) return { state: same.status, id };
  const other = list.find(relation => relation.status === 'confirmed'
    && [relation.left.sourceId, relation.right.sourceId].sort().join('\u001f') === [left.sourceId, right.sourceId].sort().join('\u001f'));
  return other ? { state: 'taken', id, takenBy: other.id } : { state: 'open', id };
}

/** Чи можна підтвердити кандидата: дати з припущеним порядком «день/місяць» автоматично не підтверджуються. */
export function confirmBlock(candidate) {
  return candidate.caution?.includes('date-order-assumed')
    ? 'Порядок «день/місяць» у датах ключа лише припущено. Перевірте дати на сторінці «Перевірка» й повторіть пошук: такий зв’язок тут не підтверджується.'
    : '';
}

/** Аргументи `confirmRelation` для кандидата; `replace` — замінити інший підтверджений ключ цієї пари. */
export function confirmArgs(candidate, { at = '', replace = false } = {}) {
  return { ...sidesOf(candidate), cardinality: candidate.cardinality, basis: candidate.basis === 'roles' ? 'roles' : 'values', replace, at };
}

/** Аргументи `rejectRelation` для кандидата. */
export function rejectArgs(candidate, { at = '' } = {}) {
  return { ...sidesOf(candidate), at };
}

const headerOf = (schema, side) => {
  const source = (schema?.sources || []).find(item => item.id === side.sourceId);
  return side.columns.map(key => source?.columns.find(column => column.key === key)?.header || key).join(' + ');
};
const titleOf = (schema, sourceId) => (schema?.sources || []).find(item => item.id === sourceId)?.title || sourceId;

/** Текст збереженого зв'язку: «План: Підрозділ ↔ Вильоти: Підрозділ · 1 : N». */
export function relationText(schema, relation) {
  return `${titleOf(schema, relation.left.sourceId)}: ${headerOf(schema, relation.left)} ↔ ${titleOf(schema, relation.right.sourceId)}: ${headerOf(schema, relation.right)} · ${CARDINALITY_LABELS[relation.cardinality] || relation.cardinality}`;
}

/** Підтверджені зв'язки для показу: текст, чи треба перевірити (стовпець ключа змінився), основа. */
export function savedRelationViews(schema) {
  const stale = new Set(staleRelations(schema));
  return relationsOf(schema).filter(relation => relation.status === 'confirmed').map(relation => ({
    id: relation.id,
    text: relationText(schema, relation),
    basis: relation.basis === 'roles' ? 'за підтвердженими ролями' : relation.basis === 'manual' ? 'вказано вручну' : 'за збігом значень',
    stale: stale.has(relation.id),
  }));
}

/** Відхилені пари для показу з можливістю повернути пропозицію. */
export function rejectedRelationViews(schema) {
  return relationsOf(schema).filter(relation => relation.status === 'rejected').map(relation => ({
    id: relation.id,
    text: `${titleOf(schema, relation.left.sourceId)}: ${headerOf(schema, relation.left)} ↔ ${titleOf(schema, relation.right.sourceId)}: ${headerOf(schema, relation.right)}`,
  }));
}

/** Рядок для картки модуля: «Зв'язано з: Вильоти (Підрозділ) …»; порожній, якщо зв'язків немає. */
export function relatedLine(schema, sourceId) {
  const stale = new Set(staleRelations(schema));
  const parts = relationsOf(schema)
    .filter(relation => relation.status === 'confirmed' && (relation.left.sourceId === sourceId || relation.right.sourceId === sourceId))
    .map(relation => {
      const mine = relation.left.sourceId === sourceId ? relation.left : relation.right;
      const other = relation.left.sourceId === sourceId ? relation.right : relation.left;
      return `${titleOf(schema, other.sourceId)} (за «${headerOf(schema, mine)}»)${stale.has(relation.id) ? ' — перевірте' : ''}`;
    });
  return parts.length ? `Зв’язано з: ${parts.join('; ')}` : '';
}

// ─── Групи таблиць і попередження (B4) ─────────────────────────────────────────────────────────────────

const clip = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/**
 * «Розділити по ключах»: групи з двох і більше таблиць, з'єднаних підтвердженими зв'язками. Таблиці без
 * зв'язків у групи не потрапляють. Порядок і ідентифікатори (`g1`, `g2`…) стабільні для тих самих зв'язків.
 */
export function suggestedGroups(schema) {
  const confirmed = relationsOf(schema).filter(relation => relation.status === 'confirmed');
  const involved = [...new Set(confirmed.flatMap(relation => [relation.left.sourceId, relation.right.sourceId]))];
  const links = confirmed.map(relation => ({ leftId: relation.left.sourceId, rightId: relation.right.sourceId }));
  return connectedGroups(involved, links)
    .filter(ids => ids.length >= 2)
    .map(ids => ids.slice().sort())
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
    .map((ids, index) => ({ id: `g${index + 1}`, title: clip(ids.map(id => titleOf(schema, id)).join(' + '), LIMITS.textLength), sourceIds: ids }));
}

/** Чи пропоновані групи відрізняються від збережених (за складом, не за назвою). */
export function groupsNeedSaving(schema) {
  const mark = groups => JSON.stringify(groups.map(group => group.sourceIds.slice().sort()).sort());
  return mark(suggestedGroups(schema)) !== mark(groupsOf(schema));
}

/** Збережені групи для показу: назва й таблиці. */
export function savedGroupViews(schema) {
  return groupsOf(schema).map(group => ({ id: group.id, title: group.title, tables: group.sourceIds.map(id => titleOf(schema, id)) }));
}

/** Попередження перед видаленням модуля: які зв'язки зникнуть разом із ним; порожній рядок, якщо зв'язків немає. */
export function deleteLinksNote(schema, sourceId) {
  const others = relationsOf(schema)
    .filter(relation => relation.status === 'confirmed' && (relation.left.sourceId === sourceId || relation.right.sourceId === sourceId))
    .map(relation => titleOf(schema, relation.left.sourceId === sourceId ? relation.right.sourceId : relation.left.sourceId));
  if (!others.length) return '';
  const names = [...new Set(others)].map(name => `«${name}»`).join(', ');
  return `Зникне й підтверджений зв’язок із ${names}; решта модулів лишиться без змін.`;
}
