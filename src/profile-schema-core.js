// Схема профілю — етап E3 дорожньої карти (docs/MODULES_ROADMAP.md, розділи 4 і 5), перший блок.
//
// Чисте ядро без DOM, сховищ, годинника й мережі. Воно описує, що EasyWAR запам'ятовує про таблицю
// користувача окремо від шаблону модуля:
//   - `DataSource` — звідки беруться дані (поки один тип: `module-table`, наявна таблиця модуля SQLite;
//     перелік типів розширюваний), які в неї стовпці й у якому порядку їх тримає користувач;
//   - `ColumnBinding` — рішення користувача: який стовпець джерела виконує яку смислову роль
//     (E1: `ROLES` у module-definition-core.js) і в яких одиницях.
//
// Правила (рішення власника, розділ 2 і 4 дорожньої карти):
//   - заголовки лише ПРОПОНУЮТЬ відповідність; неоднозначне чи невідоме користувач підтверджує вручну
//     один раз, і наступного разу застосунок не вгадує заново (відхилена пропозиція не повертається);
//   - дашборд читає рядок за ключем стовпця, а не за позицією, тому порядок стовпців довільний;
//   - оновлення шаблону модуля додає нові стовпці, але не стирає підтверджене зіставлення, порядок і
//     підписи користувача (`updateSourceColumns`); стовпець із зіставленням не зникає мовчки;
//   - різні одиниці одного числового показника мовчки не об'єднуються;
//   - перед видаленням стовпця показуємо, що від нього залежить, нічого не забороняючи.
//
// Схема нічого не знає про Rust і SQLite: зберігання — наступний блок E3 (міграція й команди), тому
// тут є лише серіалізація й перевірка (`serializeSchema`, `parseSchema`). Усі функції повертають нові
// заморожені значення й не змінюють вхідні.

import { ROLES } from './module-definition-core.js';
import { headerCandidates, normalizeHeader } from './dashboard-module-source-core.js';

export const SCHEMA_FORMAT = 'easywar.profile-schema';
export const SCHEMA_VERSION = 1;

/** Типи джерел. Новий тип додається записом сюди; решта коду від типу не залежить. */
export const SOURCE_TYPES = Object.freeze({
  'module-table': { label: 'Таблиця модуля' },
});

export const BINDING_STATUSES = Object.freeze(['confirmed', 'rejected']);

export const LIMITS = Object.freeze({
  maxSources: 64,
  maxColumns: 200,
  maxBindings: 2000,
  textLength: 200,
});

/** Ролі, що їх стовпець таблиці може виконувати: смислові й з колонки (не контур ЛБЗ і не показник книги). */
export const BINDABLE_ROLES = Object.freeze(
  Object.entries(ROLES)
    // `journal-column` — довільний стовпець журналу: ролей одразу багато, тож одна роль-один стовпець до нього не пасує.
    .filter(([id, role]) => role.kind === 'semantic' && role.from === 'column' && id !== 'journal-column')
    .map(([id]) => id),
);

/** Числові ролі потребують одиниці (за замовчуванням — з ROLE_DEFAULT_UNIT). */
export const NUMERIC_ROLES = Object.freeze(['munition-count']);
export const ROLE_DEFAULT_UNIT = Object.freeze({ 'munition-count': 'шт' });

/** Типи значень, з якими роль узгоджується; інший тип стовпця — привід перевірити вручну. */
export const ROLE_TYPES = Object.freeze({
  'event-date': ['date'],
  'event-time': ['time', 'text'],
  'munition-count': ['number'],
});

/**
 * Назви стовпців, за якими пропонується роль. Це лише підказка для екрана підтвердження: вона не
 * вмикає зіставлення сама. Порівняння — за `normalizeHeader`, тож регістр, розділові знаки й латинські
 * двійники кирилиці не заважають.
 */
export const ROLE_ALIASES = Object.freeze({
  'event-date': ['дата', 'дата події', 'дата вильоту', 'дата застосування'],
  'event-time': ['час', 'час події', 'час вильоту', 'час застосування'],
  unit: ['підрозділ', 'частина', 'бригада'],
  'firing-unit': ['вогнева бригада'],
  'platform-type': ['тип ла', 'тип пу', 'тип носія', 'тип літака', 'тип пс'],
  'munition-type': ['тип боєприпасу', 'боєприпас', 'тип бп'],
  'munition-count': ['к-сть боєприпасів', 'кількість боєприпасів', 'кількість бп', 'к-сть бп'],
  'strike-result': ['результат', 'результат ураження'],
  'abort-flag': ['відбій'],
  'target-id': ['номер цілі', '№ цілі'],
  'target-type': ['тип цілі', 'тип об’єкта'],
  coordinates: ['координати', 'mgrs'],
});

const ALIAS_INDEX = (() => {
  const index = new Map();
  for (const [role, names] of Object.entries(ROLE_ALIASES)) {
    for (const name of names) {
      const key = normalizeHeader(name);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(role);
    }
  }
  return index;
})();

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const fresh = value => structuredClone(value);
const text = (value, max = LIMITS.textLength) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const done = (schema, extra = {}) => ({ ok: true, schema: deepFreeze(schema), ...extra });

/** Порожня схема профілю. */
export function emptySchema(profileId) {
  const id = text(profileId);
  if (!id) throw new TypeError('emptySchema: потрібен ідентифікатор профілю');
  return deepFreeze({ format: SCHEMA_FORMAT, version: SCHEMA_VERSION, profileId: id, revision: 0, sources: [], bindings: [] });
}

const bump = schema => { schema.revision += 1; return schema; };
const findSource = (schema, sourceId) => schema.sources.find(source => source.id === sourceId);

function normalizeColumns(columns) {
  const out = [];
  const seen = new Set();
  for (const column of Array.isArray(columns) ? columns : []) {
    const key = text(column?.key);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    out.push({ key, header: text(column.header) || key, type: text(column.type, 40) || 'text' });
  }
  return out.length <= LIMITS.maxColumns ? out : null;
}

/**
 * Додає джерело. `source`: { id, type, ref, title, columns: [{ key, header, type }] }. Порядок
 * `columns` — порядок користувача. `ref` — посилання на джерело в його типі (для `module-table` — id модуля).
 */
export function addSource(schema, source) {
  const id = text(source?.id);
  if (!id) return fail('bad_source', 'У джерела немає ідентифікатора.');
  if (!Object.hasOwn(SOURCE_TYPES, source.type)) return fail('unknown_source_type', `Тип джерела «${source.type}» не підтримується.`);
  if (findSource(schema, id)) return fail('duplicate_source', `Джерело «${id}» уже є в схемі.`);
  if (schema.sources.length >= LIMITS.maxSources) return fail('too_many_sources', 'Забагато джерел у схемі профілю.');
  const columns = normalizeColumns(source.columns);
  if (!columns) return fail('bad_columns', 'Ключі стовпців мають бути непорожніми й різними, а їх — не більш як 200.');
  const next = fresh(schema);
  next.sources.push({ id, type: source.type, ref: text(source.ref), title: text(source.title) || id, version: 1, columns, rowIdentity: null });
  return done(bump(next));
}

/**
 * Оновлює стовпці джерела після зміни шаблону. Збережені стовпці лишаються на своїх місцях зі своїми
 * підписами; нові стають у кінець у порядку шаблону; стовпець, якого в шаблону вже немає, лишається,
 * якщо для нього є рішення користувача (`orphan`), і зникає, якщо рішень немає. Рішення користувача
 * цим викликом не змінюються.
 */
export function updateSourceColumns(schema, sourceId, columns) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const incoming = normalizeColumns(columns);
  if (!incoming) return fail('bad_columns', 'Ключі стовпців мають бути непорожніми й різними, а їх — не більш як 200.');
  const next = fresh(schema);
  const target = findSource(next, sourceId);
  const incomingKeys = new Set(incoming.map(column => column.key));
  const bound = new Set(next.bindings.filter(binding => binding.sourceId === sourceId).map(binding => binding.columnKey));
  const kept = target.columns
    .filter(column => incomingKeys.has(column.key) || bound.has(column.key))
    .map(({ orphan, ...rest }) => (incomingKeys.has(rest.key)
      ? { ...rest, type: incoming.find(item => item.key === rest.key).type }
      : { ...rest, orphan: true }));
  const have = new Set(kept.map(column => column.key));
  const added = incoming.filter(column => !have.has(column.key));
  const merged = [...kept, ...added];
  const changed = JSON.stringify(merged) !== JSON.stringify(target.columns);
  if (!changed) return done(next, { added: [], orphaned: [] });
  target.columns = merged;
  target.version += 1;
  return done(bump(next), {
    added: added.map(column => column.key),
    orphaned: merged.filter(column => column.orphan).map(column => column.key),
  });
}

/** Новий порядок стовпців користувача: перестановка наявних ключів. Зіставлення від порядку не залежать. */
export function reorderColumns(schema, sourceId, keys) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const wanted = Array.isArray(keys) ? keys : [];
  const have = source.columns.map(column => column.key);
  if (wanted.length !== have.length || new Set(wanted).size !== have.length || !wanted.every(key => have.includes(key))) {
    return fail('bad_order', 'Новий порядок має містити кожен стовпець рівно один раз.');
  }
  const next = fresh(schema);
  const target = findSource(next, sourceId);
  target.columns = wanted.map(key => target.columns.find(column => column.key === key));
  target.version += 1;
  return done(bump(next));
}

/** Користувацький підпис стовпця. Ключ і зіставлення не змінюються. */
export function renameColumn(schema, sourceId, columnKey, header) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const label = text(header);
  if (!label) return fail('bad_header', 'Підпис не може бути порожнім.');
  const next = fresh(schema);
  const column = findSource(next, sourceId).columns.find(item => item.key === columnKey);
  if (!column) return fail('unknown_column', `Стовпця «${columnKey}» немає в джерелі.`);
  column.header = label;
  findSource(next, sourceId).version += 1;
  return done(bump(next));
}

const decisions = (schema, sourceId, status) => schema.bindings.filter(binding => binding.sourceId === sourceId && binding.status === status);

/** Чи сумісні одиниці: порожня сумісна з будь-якою, різні — ні. */
export function unitsCompatible(a, b) {
  const left = text(a, 40);
  const right = text(b, 40);
  return !left || !right || normalizeHeader(left) === normalizeHeader(right);
}

/**
 * Пропозиції зіставлення для кожного стовпця джерела. Нічого не записує.
 * Підсумок стовпця (`decision`): `bound` — вже підтверджено; `single` — одна правдоподібна роль;
 * `ambiguous` — кілька ролей; `unknown` — жодної (потрібне ручне зіставлення). Відхилені користувачем
 * пари й ролі, зайняті іншим стовпцем, не пропонуються. Невідповідність типу значень роллю — `typeMismatch`.
 */
export function suggestBindings(schema, sourceId) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const confirmed = decisions(schema, sourceId, 'confirmed');
  const rejected = new Set(decisions(schema, sourceId, 'rejected').map(binding => `${binding.columnKey}\u0000${binding.role}`));
  const taken = new Map(confirmed.map(binding => [binding.role, binding.columnKey]));
  const columns = source.columns.map(column => {
    const bound = confirmed.filter(binding => binding.columnKey === column.key).map(binding => binding.role);
    if (bound.length) return { key: column.key, header: column.header, decision: 'bound', roles: bound, candidates: [] };
    const found = new Set();
    for (const candidate of [...headerCandidates(column.header), normalizeHeader(column.key)]) {
      for (const role of ALIAS_INDEX.get(candidate) || []) found.add(role);
    }
    const candidates = [...found]
      .filter(role => !rejected.has(`${column.key}\u0000${role}`) && !taken.has(role))
      .map(role => ({ role, typeMismatch: ROLE_TYPES[role] ? !ROLE_TYPES[role].includes(column.type) : false }));
    const decision = candidates.length === 0 ? 'unknown' : candidates.length === 1 && !candidates[0].typeMismatch ? 'single' : 'ambiguous';
    return { key: column.key, header: column.header, decision, roles: [], candidates };
  });
  return { ok: true, columns };
}

/**
 * Підтвердження користувача: стовпець `columnKey` виконує роль `role`. Одна роль — один стовпець
 * у джерелі; щоб перенести роль, користувач спершу знімає наявне зіставлення (`clearBinding`) або
 * передає `replace: true`. Числова роль потребує одиниці; одиниці, що суперечать наявній, не
 * зводяться мовчки. `at` — позначка часу від викликача (ядро годинника не читає).
 */
export function confirmBinding(schema, { sourceId, columnKey, role, unit = '', replace = false, at = '' }) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  if (!source.columns.some(column => column.key === columnKey)) return fail('unknown_column', `Стовпця «${columnKey}» немає в джерелі.`);
  if (!BINDABLE_ROLES.includes(role)) return fail('unknown_role', `Роль «${role}» не можна зіставити зі стовпцем таблиці.`);
  let unitText = text(unit, 40);
  if (NUMERIC_ROLES.includes(role) && !unitText) unitText = ROLE_DEFAULT_UNIT[role] || '';
  if (NUMERIC_ROLES.includes(role) && !unitText) return fail('unit_required', 'Для числової ролі потрібна одиниця.');
  const existing = decisions(schema, sourceId, 'confirmed').find(binding => binding.role === role);
  if (existing && existing.columnKey !== columnKey && !replace) {
    return fail('role_taken', `Роль «${ROLES[role].label}» уже виконує стовпець «${existing.columnKey}».`, { takenBy: existing.columnKey });
  }
  if (existing && existing.columnKey === columnKey && existing.unit && unitText && !unitsCompatible(existing.unit, unitText)) {
    return fail('unit_conflict', `Одиниця «${unitText}» суперечить підтвердженій «${existing.unit}».`);
  }
  const next = fresh(schema);
  next.bindings = next.bindings.filter(binding => !(binding.sourceId === sourceId
    && ((binding.role === role && binding.status === 'confirmed') || (binding.role === role && binding.columnKey === columnKey))));
  next.bindings.push({ sourceId, columnKey, role, unit: unitText, status: 'confirmed', decidedAtRevision: next.revision + 1, at: text(at, 40) });
  if (next.bindings.length > LIMITS.maxBindings) return fail('too_many_bindings', 'Забагато зіставлень у схемі профілю.');
  findSource(next, sourceId).version += 1;
  return done(bump(next));
}

/** «Ні, це не ця роль»: пара стовпець–роль більше не пропонується. Підтверджене зіставлення цієї пари знімається. */
export function rejectBinding(schema, { sourceId, columnKey, role, at = '' }) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  if (!source.columns.some(column => column.key === columnKey)) return fail('unknown_column', `Стовпця «${columnKey}» немає в джерелі.`);
  if (!BINDABLE_ROLES.includes(role)) return fail('unknown_role', `Роль «${role}» не можна зіставити зі стовпцем таблиці.`);
  const next = fresh(schema);
  next.bindings = next.bindings.filter(binding => !(binding.sourceId === sourceId && binding.columnKey === columnKey && binding.role === role));
  next.bindings.push({ sourceId, columnKey, role, unit: '', status: 'rejected', decidedAtRevision: next.revision + 1, at: text(at, 40) });
  return done(bump(next));
}

/** Знімає рішення користувача про пару стовпець–роль (підтверджене чи відхилене): далі її знову пропонуватимуть. */
export function clearBinding(schema, { sourceId, columnKey, role }) {
  if (!findSource(schema, sourceId)) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const next = fresh(schema);
  const before = next.bindings.length;
  next.bindings = next.bindings.filter(binding => !(binding.sourceId === sourceId && binding.columnKey === columnKey && binding.role === role));
  if (next.bindings.length === before) return done(next);
  return done(bump(next));
}

/** Підтверджені ролі джерела: роль → { columnKey, unit }. Непідтверджене в читанні не бере участі. */
export function resolveRoles(schema, sourceId) {
  const roles = {};
  for (const binding of decisions(schema, sourceId, 'confirmed')) roles[binding.role] = { columnKey: binding.columnKey, unit: binding.unit };
  return roles;
}

/**
 * Читає рядок за схемою в будь-якому порядку. `row` — об'єкт за ключами стовпців або масив у порядку
 * стовпців схеми. Повертає значення за ролями й решту стовпців окремо; нічого не вгадує.
 */
export function readRow(schema, sourceId, row) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const values = Array.isArray(row)
    ? Object.fromEntries(source.columns.map((column, index) => [column.key, row[index]]))
    : { ...(row || {}) };
  const roles = resolveRoles(schema, sourceId);
  const byRole = {};
  const used = new Set();
  for (const [role, { columnKey }] of Object.entries(roles)) {
    byRole[role] = values[columnKey];
    used.add(columnKey);
  }
  const extras = Object.fromEntries(source.columns.filter(column => !used.has(column.key)).map(column => [column.key, values[column.key]]));
  return { ok: true, byRole, extras };
}

/**
 * Що з визначень модулів (реєстр E1) джерело може побудувати. Лише визначення, усі вимоги яких —
 * смислові ролі зі стовпців, оцінюються: `available` — усі обов'язкові ролі підтверджені; `missing` —
 * бракує ролей (`adds` — що додасть або що треба зіставити). Інші (технічні ролі шаблонів Rust, показники
 * книги, контур ЛБЗ) — `not-evaluated`: їхні смислові ролі з'являться окремим кроком.
 */
export function availability(definitions, schema, sourceId) {
  if (!findSource(schema, sourceId)) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const bound = new Set(Object.keys(resolveRoles(schema, sourceId)));
  const list = (Array.isArray(definitions) ? definitions : []).map(definition => {
    const requirements = definition.requirements || [];
    const evaluable = requirements.every(requirement => BINDABLE_ROLES.includes(requirement.role));
    if (!evaluable) return { definitionId: definition.definitionId, status: 'not-evaluated', adds: [] };
    const missing = requirements.filter(requirement => requirement.required && !bound.has(requirement.role)).map(requirement => requirement.role);
    return {
      definitionId: definition.definitionId,
      status: missing.length ? 'missing' : 'available',
      adds: missing.map(role => ROLES[role].label),
    };
  });
  return { ok: true, definitions: list };
}

/**
 * Що залежить від стовпця: розміщені визначення (`placedIds`), яким він забезпечує обов'язкову роль,
 * і ті, для кого він — необов'язкова. Нічого не забороняє: це текст попередження перед видаленням.
 */
export function columnDependents(definitions, schema, sourceId, columnKey, placedIds = []) {
  if (!findSource(schema, sourceId)) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const roles = decisions(schema, sourceId, 'confirmed').filter(binding => binding.columnKey === columnKey).map(binding => binding.role);
  const placed = new Set(placedIds);
  const lose = [];
  const degrade = [];
  for (const definition of definitions || []) {
    if (!placed.has(definition.definitionId)) continue;
    const needs = (definition.requirements || []).filter(requirement => roles.includes(requirement.role));
    if (needs.some(requirement => requirement.required)) lose.push(definition.definitionId);
    else if (needs.length) degrade.push(definition.definitionId);
  }
  return { ok: true, roles, lose, degrade };
}

/** Серіалізація схеми для збереження. Текст стабільний: ті самі дані дають той самий текст. */
export function serializeSchema(schema) {
  return JSON.stringify(schema);
}

/**
 * Читає й перевіряє збережену схему (текст чи об'єкт). Схему новішої версії не читає й не зберігає
 * поверх — користувач не втратить рішення через старий застосунок. Помилки — список із кодами.
 */
export function parseSchema(input) {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input.replace(/^﻿/u, '')); } catch { return { ok: false, errors: [{ code: 'bad_json', message: 'Схема не є правильним JSON.' }], schema: null }; }
  }
  const errors = [];
  const err = (code, message) => errors.push({ code, message });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: [{ code: 'bad_shape', message: 'Схема має бути об’єктом.' }], schema: null };
  if (value.format !== SCHEMA_FORMAT) err('bad_format', `Очікується format «${SCHEMA_FORMAT}».`);
  if (!Number.isInteger(value.version) || value.version < 1) err('bad_version', 'Версія — додатне ціле число.');
  else if (value.version > SCHEMA_VERSION) err('unsupported_version', 'Схему створено новішою версією застосунку.');
  if (!text(value.profileId)) err('bad_profile', 'У схеми немає ідентифікатора профілю.');
  if (!Number.isInteger(value.revision) || value.revision < 0) err('bad_revision', 'Ревізія — невід’ємне ціле число.');
  if (!Array.isArray(value.sources) || !Array.isArray(value.bindings)) {
    err('bad_shape', 'Поля sources і bindings мають бути масивами.');
    return { ok: false, errors, schema: null };
  }
  if (value.sources.length > LIMITS.maxSources) err('too_many_sources', 'Забагато джерел.');
  if (value.bindings.length > LIMITS.maxBindings) err('too_many_bindings', 'Забагато зіставлень.');
  if (errors.length) return { ok: false, errors, schema: null };

  const sources = new Map();
  for (const source of value.sources) {
    const id = text(source?.id);
    if (!id) { err('bad_source', 'У джерела немає ідентифікатора.'); continue; }
    if (sources.has(id)) err('duplicate_source', `Джерело «${id}» повторено.`);
    if (!Object.hasOwn(SOURCE_TYPES, source.type)) err('unknown_source_type', `Тип джерела «${source.type}» не підтримується.`);
    const columns = normalizeColumns(source.columns);
    if (!columns) err('bad_columns', `Стовпці джерела «${id}» некоректні.`);
    if (!Number.isInteger(source.version) || source.version < 1) err('bad_source_version', `Версія джерела «${id}» некоректна.`);
    sources.set(id, new Set((columns || []).map(column => column.key)));
  }
  const seenRole = new Set();
  for (const binding of value.bindings) {
    const keys = sources.get(binding?.sourceId);
    if (!keys) { err('unknown_source', `Зіставлення посилається на невідоме джерело «${binding?.sourceId}».`); continue; }
    if (!keys.has(binding.columnKey)) err('unknown_column', `Зіставлення посилається на невідомий стовпець «${binding.columnKey}».`);
    if (!BINDABLE_ROLES.includes(binding.role)) err('unknown_role', `Роль «${binding.role}» невідома.`);
    if (!BINDING_STATUSES.includes(binding.status)) err('bad_status', `Стан «${binding.status}» невідомий.`);
    if (binding.status === 'confirmed') {
      const mark = `${binding.sourceId}\u0000${binding.role}`;
      if (seenRole.has(mark)) err('role_taken', `Роль «${binding.role}» підтверджено двічі в джерелі «${binding.sourceId}».`);
      seenRole.add(mark);
      if (NUMERIC_ROLES.includes(binding.role) && !text(binding.unit, 40)) err('unit_required', `Числова роль «${binding.role}» без одиниці.`);
    }
  }
  if (errors.length) return { ok: false, errors, schema: null };
  return { ok: true, errors: [], schema: deepFreeze(fresh(value)) };
}
