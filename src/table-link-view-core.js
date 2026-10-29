// Підказки зв'язків між таблицями для «Мого дашборда» (E3б, B1 → екран): чиста логіка без DOM, сховищ і
// мережі. Ядро пошуку — table-link-core.js; тут лише добір таблиць зі схеми профілю й прочитаних рядків та
// людські тексти. Нічого не зберігає і нічого не підтверджує: це підказки, рішення за людиною.

import { LINK_LIMITS, describeCandidate, tableFromSchema } from './table-link-core.js';
import { moduleSourceId } from './profile-schema-modules-core.js';

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
