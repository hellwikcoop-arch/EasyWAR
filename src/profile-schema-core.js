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
//   - перед видаленням стовпця показуємо, що від нього залежить, нічого не забороняючи;
//   - зв'язки між таблицями (E3б, B2) — лише імена стовпців, без значень: `relations` (підтверджені й відхилені
//     людиною пари ключів, не більш як один підтверджений на пару таблиць) і `groups` (результат «розділити по
//     ключах»). Обидва поля необов'язкові: схема без них читається й не переписується без змін.
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
export const RELATION_STATUSES = BINDING_STATUSES;
export const RELATION_CARDINALITIES = Object.freeze(['one-one', 'one-many', 'many-one', 'many-many']);
export const RELATION_BASES = Object.freeze(['roles', 'values', 'manual']);

export const LIMITS = Object.freeze({
  maxSources: 256,
  maxColumns: 200,
  maxBindings: 2000,
  maxRelations: 256,
  maxGroups: 64,
  maxRelationColumns: 3,
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
  // Стовпець зв'язку (підтвердженого чи відхиленого) теж не зникає мовчки: схема з посиланням на відсутній стовпець не читається.
  for (const relation of next.relations || []) {
    for (const side of [relation.left, relation.right]) if (side.sourceId === sourceId) for (const key of side.columns) bound.add(key);
  }
  const kept = target.columns
    .filter(column => incomingKeys.has(column.key) || bound.has(column.key))
    .map(({ orphan, ...rest }) => (incomingKeys.has(rest.key)
      ? { ...rest, type: incoming.find(item => item.key === rest.key).type }
      : { ...rest, orphan: true }));
  const have = new Set(kept.map(column => column.key));
  const added = incoming.filter(column => !have.has(column.key));
  const merged = [...kept, ...added];
  if (merged.length > LIMITS.maxColumns) return fail('bad_columns', 'Після оновлення стовпців стало б більш як 200: стовпці зв’язків і зіставлень лишаються.');
  const changed = JSON.stringify(merged) !== JSON.stringify(target.columns);
  if (!changed) return done(next, { added: [], orphaned: [] });
  target.columns = merged;
  target.version += 1;
  return done(bump(next), {
    added: added.map(column => column.key),
    orphaned: merged.filter(column => column.orphan).map(column => column.key),
  });
}

/** Прибирає джерело разом із його зіставленнями (наприклад, після видалення модуля). Невідоме джерело — не помилка. */
export function removeSource(schema, sourceId) {
  if (!findSource(schema, sourceId)) return done(fresh(schema), { removedRelations: [], dissolvedGroups: [] });
  const next = fresh(schema);
  next.sources = next.sources.filter(source => source.id !== sourceId);
  next.bindings = next.bindings.filter(binding => binding.sourceId !== sourceId);
  // Зв'язки джерела зникають разом із ним; група, що без нього розпалась чи лишилась з однієї таблиці, розпускається (її можна скласти знову).
  const removedRelations = (next.relations || []).filter(relation => relation.left.sourceId === sourceId || relation.right.sourceId === sourceId).map(relation => relation.id);
  const dissolvedGroups = [];
  if (Array.isArray(next.relations)) next.relations = next.relations.filter(relation => !removedRelations.includes(relation.id));
  if (Array.isArray(next.groups)) {
    next.groups = next.groups.flatMap(group => {
      const rest = group.sourceIds.filter(id => id !== sourceId);
      if (rest.length === group.sourceIds.length) return [group];
      if (rest.length >= 2 && groupConnected(rest, next.relations || [])) return [{ ...group, sourceIds: rest }];
      dissolvedGroups.push(group.id);
      return [];
    });
  }
  return done(bump(next), { removedRelations, dissolvedGroups });
}

/** Назва джерела (наприклад, модуль перейменовано). Без змін — та сама схема й ревізія. */
export function renameSource(schema, sourceId, title) {
  const source = findSource(schema, sourceId);
  if (!source) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
  const label = text(title);
  if (!label) return fail('bad_title', 'Назва не може бути порожньою.');
  if (label === source.title) return done(fresh(schema));
  const next = fresh(schema);
  const target = findSource(next, sourceId);
  target.title = label;
  target.version += 1;
  return done(bump(next));
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
  const relations = relationsOf(schema)
    .filter(relation => relation.status === 'confirmed' && [relation.left, relation.right].some(side => side.sourceId === sourceId && side.columns.includes(columnKey)))
    .map(relation => relation.id);
  const placed = new Set(placedIds);
  const lose = [];
  const degrade = [];
  for (const definition of definitions || []) {
    if (!placed.has(definition.definitionId)) continue;
    const needs = (definition.requirements || []).filter(requirement => roles.includes(requirement.role));
    if (needs.some(requirement => requirement.required)) lose.push(definition.definitionId);
    else if (needs.length) degrade.push(definition.definitionId);
  }
  return { ok: true, roles, lose, degrade, relations };
}

// ─── Зв'язки між таблицями (E3б, B2) ───────────────────────────────────────────────────────────────────

/** Зв'язки схеми (поле необов'язкове: старі схеми його не мають). */
export const relationsOf = schema => (Array.isArray(schema?.relations) ? schema.relations : []);
/** Групи таблиць схеми (поле необов'язкове). */
export const groupsOf = schema => (Array.isArray(schema?.groups) ? schema.groups : []);

// Метки без роздільників у рядку: імена з будь-якими символами не збігаються в різних парах.
const sideMark = side => JSON.stringify([side.sourceId, side.columns]);

/** Ідентифікатор зв'язку не залежить від того, яку таблицю названо першою: однакова пара ключів — однаковий `id`. */
export function relationId(left, right) {
  return `rel:${JSON.stringify([sideMark(left), sideMark(right)].sort())}`;
}

const pairMark = (a, b) => JSON.stringify([a, b].sort());

function normalizeSide(schema, side) {
  const source = findSource(schema, text(side?.sourceId));
  if (!source) return fail('unknown_source', `Джерела «${side?.sourceId}» немає.`);
  const columns = Array.isArray(side.columns) ? side.columns.map(key => text(key)) : [];
  if (!columns.length || columns.length > LIMITS.maxRelationColumns || columns.some(key => !key) || new Set(columns).size !== columns.length) {
    return fail('bad_relation_columns', 'Ключ зв’язку — від одного до трьох різних стовпців.');
  }
  const unknown = columns.find(key => !source.columns.some(column => column.key === key));
  if (unknown) return fail('unknown_column', `Стовпця «${unknown}» немає в джерелі «${source.id}».`);
  return { ok: true, side: { sourceId: source.id, columns }, source };
}

function relationSides(schema, left, right) {
  const a = normalizeSide(schema, left);
  if (!a.ok) return a;
  const b = normalizeSide(schema, right);
  if (!b.ok) return b;
  if (a.side.sourceId === b.side.sourceId) return fail('same_source', 'Зв’язок з’єднує дві різні таблиці.');
  if (a.side.columns.length !== b.side.columns.length) return fail('bad_relation_columns', 'З обох боків має бути однакова кількість стовпців ключа.');
  return { ok: true, left: a.side, right: b.side, leftSource: a.source, rightSource: b.source };
}

/** Типи стовпців ключа на момент рішення: за ними зв'язок позначається «перевірте», якщо стовпець змінився (`staleRelations`). */
const typesOf = (source, columns) => columns.map(key => source.columns.find(column => column.key === key)?.type || '');

/**
 * Підтвердження людини: ці стовпці двох таблиць — ключ зв'язку. Не більш як один підтверджений зв'язок на пару
 * таблиць (інший ключ тієї ж пари — `pair_taken`, якщо не передано `replace: true`). «Багато до багатьох» лише
 * вручну (`basis: 'manual'`) і з `acceptManyToMany: true`: сама пропозиція такого зв'язку не робиться.
 * Значень клітинок схема не зберігає: лише імена стовпців, кардинальність і основа.
 */
export function confirmRelation(schema, { left, right, cardinality, basis, replace = false, acceptManyToMany = false, at = '' }) {
  const sides = relationSides(schema, left, right);
  if (!sides.ok) return sides;
  if (!RELATION_CARDINALITIES.includes(cardinality)) return fail('bad_cardinality', `Кардинальність «${cardinality}» невідома.`);
  if (!RELATION_BASES.includes(basis)) return fail('bad_basis', `Основа «${basis}» невідома.`);
  if (cardinality === 'many-many' && !(basis === 'manual' && acceptManyToMany === true)) {
    return fail('many_many_unconfirmed', 'Зв’язок «багато до багатьох» можна лише вказати вручну й підтвердити застереження.');
  }
  const id = relationId(sides.left, sides.right);
  const mark = pairMark(sides.left.sourceId, sides.right.sourceId);
  const taken = relationsOf(schema).find(relation => relation.status === 'confirmed' && relation.id !== id
    && pairMark(relation.left.sourceId, relation.right.sourceId) === mark);
  if (taken && !replace) return fail('pair_taken', 'Для цієї пари таблиць уже підтверджено інший ключ.', { takenBy: taken.id });
  const next = fresh(schema);
  const list = relationsOf(next).filter(relation => relation.id !== id && !(taken && relation.id === taken.id));
  list.push({
    id, status: 'confirmed', left: sides.left, right: sides.right, cardinality, basis,
    versions: { left: sides.leftSource.version, right: sides.rightSource.version },
    types: { left: typesOf(sides.leftSource, sides.left.columns), right: typesOf(sides.rightSource, sides.right.columns) },
    decidedAtRevision: next.revision + 1, at: text(at, 40),
  });
  if (list.length > LIMITS.maxRelations) return fail('too_many_relations', 'Забагато зв’язків у схемі профілю.');
  next.relations = list;
  return done(bump(next), { id, replaced: taken ? taken.id : '' });
}

/** «Ні, це не ключ»: така пара стовпців більше не пропонується; підтверджений зв'язок цієї пари ключів знімається. */
export function rejectRelation(schema, { left, right, at = '' }) {
  const sides = relationSides(schema, left, right);
  if (!sides.ok) return sides;
  const id = relationId(sides.left, sides.right);
  const next = fresh(schema);
  const list = relationsOf(next).filter(relation => relation.id !== id);
  list.push({ id, status: 'rejected', left: sides.left, right: sides.right, decidedAtRevision: next.revision + 1, at: text(at, 40) });
  if (list.length > LIMITS.maxRelations) return fail('too_many_relations', 'Забагато зв’язків у схемі профілю.');
  next.relations = list;
  const dissolved = dropBrokenGroups(next);
  return done(bump(next), { id, dissolvedGroups: dissolved });
}

/** Знімає рішення про зв'язок (підтверджене чи відхилене): пару знову пропонуватимуть. Невідомий `id` — без змін. */
export function clearRelation(schema, id) {
  if (!relationsOf(schema).some(relation => relation.id === id)) return done(fresh(schema), { dissolvedGroups: [] });
  const next = fresh(schema);
  next.relations = relationsOf(next).filter(relation => relation.id !== id);
  const dissolved = dropBrokenGroups(next);
  return done(bump(next), { dissolvedGroups: dissolved });
}

/** «Скинути зв'язки»: прибирає `relations` і `groups`; джерела й зіставлення ролей цілі. Без зв'язків — без змін. */
export function clearRelations(schema) {
  if (!relationsOf(schema).length && !groupsOf(schema).length) return done(fresh(schema));
  const next = fresh(schema);
  next.relations = [];
  next.groups = [];
  return done(bump(next));
}

/** Чи з'єднані ВСІ ці таблиці підтвердженими зв'язками (порожній чи одноелементний набір — так). */
function groupConnected(sourceIds, relations) {
  const ids = new Set(sourceIds);
  if (ids.size < 2) return true;
  const edges = relations.filter(relation => relation.status === 'confirmed' && ids.has(relation.left.sourceId) && ids.has(relation.right.sourceId));
  const seen = new Set([sourceIds[0]]);
  const queue = [sourceIds[0]];
  while (queue.length) {
    const at = queue.pop();
    for (const edge of edges) {
      const other = edge.left.sourceId === at ? edge.right.sourceId : edge.right.sourceId === at ? edge.left.sourceId : '';
      if (other && !seen.has(other)) { seen.add(other); queue.push(other); }
    }
  }
  return seen.size === ids.size;
}

/** Після зняття зв'язку розпускає групи, які вже не з'єднані; повертає їхні `id`. Змінює `next` на місці. */
function dropBrokenGroups(next) {
  if (!Array.isArray(next.groups) || !next.groups.length) return [];
  const dissolved = next.groups.filter(group => !groupConnected(group.sourceIds, relationsOf(next))).map(group => group.id);
  if (dissolved.length) next.groups = next.groups.filter(group => !dissolved.includes(group.id));
  return dissolved;
}

/**
 * Результат «розділити по ключах»: групи таблиць, які людина лишила. Кожна група — з'єднані підтвердженими
 * зв'язками таблиці; таблиця входить не більш як в одну групу. Замінює всі наявні групи.
 */
export function setGroups(schema, groups) {
  const list = Array.isArray(groups) ? groups : [];
  if (list.length > LIMITS.maxGroups) return fail('too_many_groups', 'Забагато груп у схемі профілю.');
  const seenId = new Set();
  const seenSource = new Set();
  const out = [];
  for (const group of list) {
    const id = text(group?.id, 80);
    const title = text(group?.title);
    const sourceIds = Array.isArray(group?.sourceIds) ? group.sourceIds.map(item => text(item)) : [];
    if (!id || !title || !sourceIds.length) return fail('bad_group', 'Група має ідентифікатор, назву й хоча б одну таблицю.');
    if (seenId.has(id)) return fail('bad_group', `Група «${id}» повторена.`);
    seenId.add(id);
    if (new Set(sourceIds).size !== sourceIds.length) return fail('bad_group', `У групі «${title}» таблицю названо двічі.`);
    for (const sourceId of sourceIds) {
      if (!findSource(schema, sourceId)) return fail('unknown_source', `Джерела «${sourceId}» немає.`);
      if (seenSource.has(sourceId)) return fail('source_in_two_groups', `Таблиця «${sourceId}» уже є в іншій групі.`);
      seenSource.add(sourceId);
    }
    if (!groupConnected(sourceIds, relationsOf(schema))) return fail('group_not_connected', `У групі «${title}» є таблиці без підтвердженого зв’язку між собою.`);
    out.push({ id, title, sourceIds });
  }
  if (JSON.stringify(out) === JSON.stringify(groupsOf(schema))) return done(fresh(schema));
  const next = fresh(schema);
  next.groups = out;
  return done(bump(next));
}

/**
 * Підтверджені зв'язки таблиці для читання (майбутній перехресний фільтр, пропозиції модулів): з якою таблицею,
 * якими стовпцями, яка кардинальність. `stale` — стовпець ключа змінився після рішення, зв'язок треба перевірити.
 */
export function relatedSources(schema, sourceId) {
  const stale = new Set(staleRelations(schema));
  return relationsOf(schema)
    .filter(relation => relation.status === 'confirmed' && (relation.left.sourceId === sourceId || relation.right.sourceId === sourceId))
    .map(relation => {
      const mine = relation.left.sourceId === sourceId ? relation.left : relation.right;
      const other = relation.left.sourceId === sourceId ? relation.right : relation.left;
      return { relationId: relation.id, sourceId: other.sourceId, columns: mine.columns, otherColumns: other.columns, cardinality: relation.cardinality, basis: relation.basis, stale: stale.has(relation.id) };
    });
}

/** `id` підтверджених зв'язків, у яких стовпець ключа зник (`orphan`) чи змінив тип після рішення: їх треба перевірити. */
export function staleRelations(schema) {
  const out = [];
  for (const relation of relationsOf(schema)) {
    if (relation.status !== 'confirmed') continue;
    const moved = ['left', 'right'].some(name => {
      const side = relation[name];
      const source = findSource(schema, side.sourceId);
      if (!source) return true;
      const types = typesOf(source, side.columns);
      return side.columns.some(key => source.columns.find(column => column.key === key)?.orphan) || JSON.stringify(types) !== JSON.stringify(relation.types?.[name] || types);
    });
    if (moved) out.push(relation.id);
  }
  return out;
}

/** Серіалізація схеми для збереження. Текст стабільний: ті самі дані дають той самий текст. */
export function serializeSchema(schema) {
  return JSON.stringify(schema);
}

/** Перевірка `relations` і `groups` (обидва поля необов'язкові): джерела й стовпці існують, ліміти, одна пара — один підтверджений зв'язок. */
function validateRelations(value, sources, err) {
  for (const name of ['relations', 'groups']) {
    if (value[name] !== undefined && !Array.isArray(value[name])) err('bad_shape', `Поле ${name} має бути масивом.`);
  }
  const relations = Array.isArray(value.relations) ? value.relations : [];
  const groups = Array.isArray(value.groups) ? value.groups : [];
  if (relations.length > LIMITS.maxRelations) err('too_many_relations', 'Забагато зв’язків.');
  if (groups.length > LIMITS.maxGroups) err('too_many_groups', 'Забагато груп.');
  if (relations.length > LIMITS.maxRelations || groups.length > LIMITS.maxGroups) return;
  const seen = new Set();
  const confirmedPairs = new Set();
  const checkSide = (side, id) => {
    const keys = sources.get(side?.sourceId);
    const columns = Array.isArray(side?.columns) ? side.columns : [];
    if (!keys) { err('unknown_source', `Зв’язок «${id}» посилається на невідоме джерело «${side?.sourceId}».`); return false; }
    if (!columns.length || columns.length > LIMITS.maxRelationColumns || new Set(columns).size !== columns.length) { err('bad_relation_columns', `Ключ зв’язку «${id}» некоректний.`); return false; }
    for (const key of columns) if (!keys.has(key)) err('unknown_column', `Зв’язок «${id}» посилається на невідомий стовпець «${key}».`);
    return true;
  };
  for (const relation of relations) {
    const id = typeof relation?.id === 'string' ? relation.id : '';
    if (!id) { err('bad_relation', 'У зв’язку немає ідентифікатора.'); continue; }
    if (seen.has(id)) err('duplicate_relation', `Зв’язок «${id}» повторено.`);
    seen.add(id);
    if (!RELATION_STATUSES.includes(relation.status)) err('bad_status', `Стан зв’язку «${id}» невідомий.`);
    const okLeft = checkSide(relation.left, id);
    const okRight = checkSide(relation.right, id);
    if (okLeft && okRight) {
      if (relation.left.sourceId === relation.right.sourceId) err('same_source', `Зв’язок «${id}» з’єднує таблицю саму з собою.`);
      if (relation.left.columns.length !== relation.right.columns.length) err('bad_relation_columns', `У зв’язку «${id}» різна кількість стовпців ключа.`);
      if (relation.status === 'confirmed') {
        if (!RELATION_CARDINALITIES.includes(relation.cardinality)) err('bad_cardinality', `Кардинальність зв’язку «${id}» невідома.`);
        if (!RELATION_BASES.includes(relation.basis)) err('bad_basis', `Основа зв’язку «${id}» невідома.`);
        if (relation.cardinality === 'many-many' && relation.basis !== 'manual') err('many_many_unconfirmed', `Зв’язок «${id}» «багато до багатьох» не з ручним вибором.`);
        const mark = pairMark(relation.left.sourceId, relation.right.sourceId);
        if (confirmedPairs.has(mark)) err('pair_taken', `Для пари таблиць зв’язку «${id}» підтверджено кілька ключів.`);
        confirmedPairs.add(mark);
      }
    }
  }
  const inGroup = new Set();
  const groupIds = new Set();
  for (const group of groups) {
    const id = text(group?.id, 80);
    const ids = Array.isArray(group?.sourceIds) ? group.sourceIds : [];
    if (!id || !text(group?.title) || !ids.length) { err('bad_group', 'Група має ідентифікатор, назву й таблиці.'); continue; }
    if (groupIds.has(id)) err('bad_group', `Групу «${id}» повторено.`);
    groupIds.add(id);
    for (const sourceId of ids) {
      if (!sources.has(sourceId)) err('unknown_source', `Група «${id}» посилається на невідоме джерело «${sourceId}».`);
      if (inGroup.has(sourceId)) err('source_in_two_groups', `Таблиця «${sourceId}» у двох групах.`);
      inGroup.add(sourceId);
    }
    if (ids.every(sourceId => sources.has(sourceId)) && !groupConnected(ids, relations.filter(item => item?.left && item?.right))) {
      err('group_not_connected', `У групі «${id}» є таблиці без підтвердженого зв’язку.`);
    }
  }
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
  validateRelations(value, sources, err);
  if (errors.length) return { ok: false, errors, schema: null };
  return { ok: true, errors: [], schema: deepFreeze(fresh(value)) };
}
