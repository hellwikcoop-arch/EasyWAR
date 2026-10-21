// Read-only recommendations for an inspected local workbook. This layer never imports rows,
// creates modules, or treats a header/type guess as a confirmed ColumnBinding (E3).
import { normalizeHeader, headerCandidates, matchHeaders, sourceProfile } from './dashboard-module-source-core.js';
import { CATALOG_V1_COLUMN_ROLES, ROLES, TECHNICAL_ROLE_MAP } from './module-definition-core.js';

const MAX_COLUMNS = 200; // The existing Rust inspector has the same bound.
const RISKY_VISUALS = new Set(['gauge', 'radial-progress', 'multi-ring', 'progress-bars']);
const TARGET_FIELDS = new Set(['maximum', 'target_value']);
const UNITS = new Map([
  ['км', 'км'], ['km', 'км'], ['м', 'м'], ['m', 'м'],
  ['год', 'год'], ['хв', 'хв'], ['шт', 'шт'], ['кг', 'кг'], ['kg', 'кг'], ['л', 'л'], ['l', 'л'],
]);
const STATUS_ORDER = { ready: 0, needs_confirmation: 1, missing_columns: 2, unsupported: 3 };

const cellsOf = row => Array.isArray(row?.cells) ? row.cells : [];
const nonempty = value => value !== null && value !== undefined && String(value).trim() !== '';
const columnId = index => `c${index + 1}`;
const identity = parts => parts.map(part => encodeURIComponent(String(part))).join(':');

function cellType(value) {
  if (!nonempty(value)) return null;
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  if (typeof value !== 'string') return 'text';
  const text = value.trim();
  if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/u.test(text)) return 'datetime';
  if (/^\d{4}-\d\d-\d\d$/u.test(text) || /^\d{2}\.\d{2}\.\d{4}$/u.test(text)) return 'date';
  if (/^\d+:\d{2}$/u.test(text)) return 'duration';
  if (/^[+-]?\d+(?:[.,]\d+)?$/u.test(text)) return 'number';
  return 'text';
}

function unitOf(value) {
  if (typeof value !== 'string') return null;
  const words = normalizeHeader(value).split(' ');
  return UNITS.get(words.at(-1)) ?? null;
}

function inferColumn(label, values, index, duplicate) {
  const types = [...new Set(values.map(cellType).filter(Boolean))];
  const type = types.length === 1 ? types[0] : types.length ? 'mixed' : 'unknown';
  const units = [...new Set([unitOf(label), ...values.map(unitOf)].filter(Boolean))];
  return {
    columnId: columnId(index), index, label, type,
    unit: units.length === 1 ? units[0] : null,
    unitStatus: units.length > 1 ? 'ambiguous' : units.length ? 'proposed' : 'unknown',
    bindingStatus: duplicate || type === 'mixed' ? 'ambiguous' : 'unknown',
    nullable: values.some(value => !nonempty(value)),
    sampleCount: values.filter(nonempty).length,
  };
}

function headerScore(row) {
  const cells = cellsOf(row).slice(0, MAX_COLUMNS);
  const names = cells.filter(value => typeof value === 'string' && normalizeHeader(value));
  const distinct = new Set(names.map(normalizeHeader)).size;
  return distinct * 2 + names.length - (names.length !== distinct ? 1 : 0);
}

function regions(rows) {
  const result = [];
  for (const row of rows) {
    if (!cellsOf(row).some(nonempty)) continue;
    const previous = result.at(-1)?.at(-1);
    if (!previous || Number(row.number) > Number(previous.number) + 1) result.push([]);
    result.at(-1).push(row);
  }
  return result;
}

/** Build a structural profile from the existing Tauri SourceWorkbook/SourceSheetRows shape. */
export function profileSource(workbook, { sourceId = 'preview', sourceVersion = 'unversioned' } = {}) {
  const tables = [];
  (Array.isArray(workbook?.sheets) ? workbook.sheets : []).forEach((sheet, sheetIndex) => {
    if (sheet?.visible === false || ['hidden', 'veryHidden'].includes(sheet?.state)) return;
    const sampled = !Array.isArray(sheet?.rows);
    const rows = (sampled ? sheet?.sample : sheet.rows) ?? [];
    const partial = sheet?.truncated === true || (sampled && Number(sheet?.rowCount) > rows.length);
    const groups = regions(rows);
    if (!groups.length) {
      tables.push({ tableId: `s${sheetIndex + 1}:empty`, sheet: sheet.name ?? '', columns: [],
        rowCountKnown: 0, truncated: partial, empty: true, warnings: [] });
    }
    for (const group of groups) {
      // A title row is less likely than a wider header row. This is still only a proposal.
      const candidates = group.slice(0, 5);
      const header = candidates.reduce((best, row) => headerScore(row) > headerScore(best) ? row : best);
      const start = group.indexOf(header);
      const data = group.slice(start + 1);
      const headers = cellsOf(header).slice(0, MAX_COLUMNS);
      const normalized = headers.map(normalizeHeader);
      const warnings = [];
      if (partial) warnings.push('Доступна лише частина рядків; точні підсумки неможливі.');
      if (start > 0) warnings.push('Рядок заголовків визначено попередньо; перевірте багаторядкову шапку.');
      const columns = headers.flatMap((value, index) => {
        const label = typeof value === 'string' ? value.trim() : '';
        if (!label) return [];
        const duplicate = normalized.filter(item => item === normalized[index]).length > 1;
        const column = inferColumn(label, data.map(row => cellsOf(row)[index]), index, duplicate);
        if (duplicate) warnings.push(`Повторюється заголовок «${label}»; потрібне зіставлення за колонкою.`);
        if (column.unitStatus === 'ambiguous') warnings.push(`Несумісні одиниці у «${label}»; автоматична конвертація вимкнена.`);
        return [column];
      });
      tables.push({
        tableId: `s${sheetIndex + 1}:r${header.number ?? 1}`, sheet: sheet.name ?? '',
        headerRow: header.number ?? 1, headerStatus: 'proposed', columns,
        rowCountKnown: partial ? null : data.length, truncated: partial,
        empty: data.length === 0 || columns.every(column => column.sampleCount === 0), warnings,
      });
    }
  });
  return { sourceId: String(sourceId), sourceVersion: String(sourceVersion), tables };
}

function compatible(column, requiredType) {
  if (!column || column.type === 'mixed' || column.type === 'unknown') return false;
  if (!requiredType) return true;
  if (['real', 'integer', 'number'].includes(requiredType)) return column.type === 'number';
  if (requiredType === 'date') return column.type === 'date';
  if (requiredType === 'datetime') return column.type === 'datetime';
  if (requiredType === 'boolean') return column.type === 'boolean';
  return column.type === 'text';
}

function roleCompatible(required, offered, column) {
  if (required === offered) return true;
  if (required === 'measure') return offered === 'munition-count' && column.type === 'number';
  if (required === 'category' || required === 'label') {
    return ROLES[offered]?.kind === 'semantic' && ROLES[offered]?.from === 'column'
      && (column.type === 'text' || (offered === 'event-date' && column.type === 'date'));
  }
  if (required === 'status') return offered === 'abort-flag';
  return false;
}

/** Return only hypotheses unless the caller supplies an explicit confirmation. */
export function proposeBindings(profile, { rustTemplates = [], catalogs = [], confirmations = [] } = {}) {
  const out = new Map();
  const add = item => {
    const key = identity([item.tableId, item.columnId, item.role, item.definitionId ?? '', item.fieldKey ?? '']);
    const old = out.get(key);
    if (!old || item.bindingStatus === 'confirmed') out.set(key, item);
  };
  for (const table of profile?.tables ?? []) {
    const byId = new Map(table.columns.map(column => [column.columnId, column]));
    const headers = Array.from({ length: Math.max(0, ...table.columns.map(column => column.index + 1)) }, () => null);
    for (const column of table.columns) headers[column.index] = column.label;
    for (const template of rustTemplates) {
      const matched = matchHeaders(sourceProfile(template.fields), headers);
      for (const [fieldKey, indexes] of matched.mapped) {
        const field = template.fields.find(item => item.key === fieldKey);
        for (const index of indexes) {
          const column = byId.get(columnId(index));
          if (column && compatible(column, field?.dataType)) add({ tableId: table.tableId, columnId: column.columnId,
            role: TECHNICAL_ROLE_MAP[field.role] ?? field.role, definitionId: `rust-template:${template.id}`, fieldKey,
            bindingStatus: 'proposed', reason: 'Назва збігається з полем чинного шаблону.' });
        }
      }
    }
    const aliases = new Map();
    for (const [role, detail] of Object.entries(ROLES)) {
      if (detail.kind === 'semantic' && detail.from === 'column') aliases.set(normalizeHeader(detail.label), role);
    }
    for (const catalog of catalogs) for (const field of catalog.columns ?? []) {
      const role = CATALOG_V1_COLUMN_ROLES[field.id];
      if (role) for (const label of field.labels ?? []) aliases.set(normalizeHeader(label), role);
    }
    for (const column of table.columns) {
      for (const alias of headerCandidates(column.label)) {
        const role = aliases.get(alias);
        if (role) add({ tableId: table.tableId, columnId: column.columnId, role,
          bindingStatus: 'proposed', reason: 'Назва збігається зі смисловою роллю E1.' });
      }
      const roles = column.type === 'number' ? ['measure']
        : column.type === 'date' ? ['event-date', 'category']
          : column.type === 'text' ? ['category', 'label']
            : column.type === 'boolean' ? ['status'] : [];
      for (const role of roles) add({ tableId: table.tableId, columnId: column.columnId, role,
        bindingStatus: 'proposed', reason: 'Можлива роль за типом вибірки; потрібне підтвердження.' });
    }
    for (const confirmed of confirmations) {
      const column = byId.get(confirmed.columnId);
      if (confirmed.tableId !== table.tableId || !column || !ROLES[confirmed.role]) continue;
      add({ tableId: table.tableId, columnId: column.columnId, role: confirmed.role,
        ...(confirmed.definitionId ? { definitionId: confirmed.definitionId } : {}),
        ...(confirmed.fieldKey ? { fieldKey: confirmed.fieldKey } : {}),
        bindingStatus: 'confirmed', unit: confirmed.unit ?? null,
        aggregation: confirmed.aggregation ?? null, reason: 'Відповідність явно підтверджена користувачем.' });
    }
  }
  return [...out.values()].sort((a, b) => identity([a.tableId, a.columnId, a.role, a.definitionId ?? '', a.fieldKey ?? ''])
    .localeCompare(identity([b.tableId, b.columnId, b.role, b.definitionId ?? '', b.fieldKey ?? '']), 'en'));
}

function chooseBinding(requirement, definition, table, proposals, used, preferredColumnId = null) {
  const options = proposals.flatMap(proposal => {
    if (proposal.tableId !== table.tableId || used.has(proposal.columnId)
      || (preferredColumnId && proposal.columnId !== preferredColumnId)) return [];
    const column = table.columns.find(item => item.columnId === proposal.columnId);
    if (!compatible(column, requirement.type) || !roleCompatible(requirement.role, proposal.role, column)) return [];
    if (proposal.definitionId && proposal.definitionId !== definition.definitionId) return [];
    if (proposal.fieldKey && proposal.fieldKey !== requirement.column) return [];
    if (TARGET_FIELDS.has(requirement.column) && (proposal.bindingStatus !== 'confirmed' || proposal.fieldKey !== requirement.column)) return [];
    const exact = proposal.fieldKey === requirement.column;
    const rank = (proposal.bindingStatus === 'confirmed' ? 0 : 2) + (exact ? 0 : 1);
    return [{ proposal, column, rank }];
  });
  options.sort((a, b) => a.rank - b.rank || a.column.index - b.column.index);
  return options[0] ?? null;
}

/** Deterministic suggestions from E1 definitions; no data values are calculated. */
export function recommend(profile, definitions, options = {}) {
  const proposals = proposeBindings(profile, options);
  const templates = new Map((options.rustTemplates ?? []).map(item => [item.id, item]));
  const results = new Map();
  for (const table of profile?.tables ?? []) for (const definition of definitions ?? []) {
    const template = definition.sourceCatalog === 'rust-template' ? templates.get(definition.sourceId) : null;
    const metrics = template?.fields?.filter(field => field.required && field.role === 'metric') ?? [];
    // Every explicitly bound measure gets its own variant for single-measure templates. For
    // unconfirmed candidates keep one reviewable proposal instead of a Cartesian explosion.
    const variants = metrics.length === 1 ? [...new Set(proposals.flatMap(proposal => {
      const column = table.columns.find(item => item.columnId === proposal.columnId);
      if (proposal.tableId !== table.tableId || proposal.bindingStatus !== 'confirmed'
        || (proposal.definitionId && proposal.definitionId !== definition.definitionId)
        || (proposal.fieldKey && proposal.fieldKey !== metrics[0].key)
        || !compatible(column, metrics[0].dataType)
        || !roleCompatible('measure', proposal.role, column)) return [];
      return [proposal.columnId];
    }))].sort() : [];
    for (const variant of variants.length ? variants : [null]) {
      const used = new Set();
      const fields = [];
      let missing = 0;
      let unconfirmed = 0;
      const warnings = [...(table.warnings ?? [])];
      for (const requirement of definition.requirements ?? []) {
        const preferred = metrics.length === 1 && requirement.column === metrics[0].key ? variant : null;
        const found = chooseBinding(requirement, definition, table, proposals, used, preferred);
        if (!found) {
          if (requirement.required) missing += 1;
          fields.push({ role: requirement.role, fieldKey: requirement.column ?? null, required: requirement.required,
            status: 'missing', detail: requirement.detail ?? null });
          continue;
        }
        used.add(found.column.columnId);
        const { proposal, column } = found;
        let confirmed = proposal.bindingStatus === 'confirmed' && column.bindingStatus !== 'ambiguous';
        const templateField = template?.fields?.find(field => field.key === requirement.column);
        if (templateField?.role === 'metric') {
          // A number with no agreed unit or aggregation cannot safely become a total.
          confirmed &&= Boolean(proposal.unit) && proposal.aggregation === templateField.aggregation;
          if (column.unit && proposal.unit && column.unit !== proposal.unit) {
            confirmed = false;
            warnings.push(`Одиниця «${column.label}» не збігається з підтвердженою; конвертацію не виконано.`);
          }
          if (!confirmed) warnings.push(`Підтвердьте одиницю та агрегацію для «${column.label}».`);
        }
        if (column.unitStatus === 'ambiguous') confirmed = false;
        if (!confirmed && requirement.required) unconfirmed += 1;
        fields.push({ role: requirement.role, fieldKey: requirement.column ?? null, columnId: column.columnId,
          label: column.label, required: requirement.required, status: confirmed ? 'confirmed' : 'proposed',
          unit: proposal.unit ?? column.unit ?? null });
      }
      if (table.empty) warnings.push('Немає даних для попереднього перегляду.');
      if (table.truncated) warnings.push('Часткове джерело: точні суми й кількості недоступні.');
      if (RISKY_VISUALS.has(definition.visual) && missing) warnings.push('Потрібне окремо підтверджене цільове значення.');
      const portable = definition.sourceCatalog === 'rust-template' && Boolean(template);
      const readiness = missing ? 'missing_columns' : !portable ? 'unsupported'
        : unconfirmed || table.empty || table.truncated ? 'needs_confirmation' : 'ready';
      if (readiness === 'unsupported') warnings.push('Для цього визначення ще немає універсального адаптера довільної таблиці.');
      const bindingIds = fields.filter(item => item.columnId).map(item => `${item.fieldKey ?? item.role}=${item.columnId}`).sort();
      const suggestion = {
        id: `recommendation:${identity([profile.sourceId, profile.sourceVersion, table.tableId, definition.definitionId, ...bindingIds])}`,
        definitionId: definition.definitionId, sourceId: profile.sourceId, sourceVersion: profile.sourceVersion,
        tableId: table.tableId, title: definition.title, visualKind: definition.visual,
        level: definition.visual === 'kpi' ? 'simple' : (definition.requirements?.filter(item => item.required).length ?? 0) > 2 ? 'complex' : 'combined',
        requiredFields: fields, aggregation: definition.computation, readiness,
        explanation: [definition.computation, ...fields.filter(item => item.columnId).map(item => `${item.role}: «${item.label}»`)],
        warnings: [...new Set(warnings)], dataStatus: table.empty ? 'empty' : table.truncated ? 'partial' : 'available',
      };
      if (!results.has(suggestion.id)) results.set(suggestion.id, suggestion);
    }
  }
  return [...results.values()].sort((a, b) => STATUS_ORDER[a.readiness] - STATUS_ORDER[b.readiness]
    || a.tableId.localeCompare(b.tableId, 'en') || a.definitionId.localeCompare(b.definitionId, 'en')
    || a.id.localeCompare(b.id, 'en'));
}
