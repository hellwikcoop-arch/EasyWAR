// Read-only recommendations for an inspected local workbook. This layer never imports rows,
// creates modules, or treats a header/type guess as a confirmed ColumnBinding (E3).
import { normalizeHeader, headerCandidates, matchHeaders, sourceProfile } from './dashboard-module-source-core.js';
import { CATALOG_V1_COLUMN_ROLES, ROLES, TECHNICAL_ROLE_MAP } from './module-definition-core.js';

const MAX_COLUMNS = 200; // The existing Rust inspector has the same bound.
const MAX_METRIC_VARIANTS = 16;
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

function previewFingerprint(workbook) {
  // A preview key distinguishes local inspections; it is never a ModuleInstance key.
  let hash = 0xcbf29ce484222325n;
  const serialized = JSON.stringify(workbook ?? {});
  for (let index = 0; index < serialized.length; index += 1) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(serialized.charCodeAt(index))) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

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

function headerScore(row, next = null) {
  const cells = cellsOf(row).slice(0, MAX_COLUMNS);
  const names = cells.filter(value => typeof value === 'string' && normalizeHeader(value));
  const distinct = new Set(names.map(normalizeHeader)).size;
  const following = cellsOf(next);
  const contrast = cells.filter((value, index) => typeof value === 'string' && nonempty(value)
    && nonempty(following[index]) && cellType(following[index]) !== 'text').length;
  return distinct * 2 + names.length + contrast * 2 - (names.length !== distinct ? 1 : 0);
}

function looksLikeHeader(row, next) {
  const cells = cellsOf(row).filter(nonempty);
  const names = cells.filter(value => typeof value === 'string' && normalizeHeader(value));
  return Boolean(next) && names.length >= 2 && names.length === cells.length
    && new Set(names.map(normalizeHeader)).size >= 2;
}

function regions(rows, sheetIndex, sourceKey, confirmations) {
  const groups = [];
  const boundaries = [];
  const nextNonempty = Array(rows.length);
  let upcoming = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    nextNonempty[index] = upcoming;
    if (cellsOf(rows[index]).some(nonempty)) upcoming = rows[index];
  }
  let previousNonempty = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!groups.length) groups.push({ rows: [], boundaries: [], gaps: [] });
    if (cellsOf(row).some(nonempty) && previousNonempty) {
      const gapRows = Math.max(0, Number(row.number) - Number(previousNonempty.number) - 1);
      const headerEvidence = looksLikeHeader(row, nextNonempty[index]);
      const possibleBoundary = gapRows >= 2 || (gapRows >= 1 && headerEvidence);
      if (possibleBoundary) {
        const matching = confirmations.filter(item => item.sourceKey === sourceKey
          && item.sheetIndex === sheetIndex && item.beforeRow === row.number
          && ['split', 'join'].includes(item.action));
        const actions = [...new Set(matching.map(item => item.action))];
        const decision = actions.length === 1 ? actions[0] : null;
        const proposedAction = gapRows >= 2 && headerEvidence ? 'split' : 'join';
        const boundary = {
          sheetIndex, afterRow: previousNonempty.number, beforeRow: row.number, gapRows,
          proposedAction, appliedAction: decision ?? proposedAction,
          status: decision ? 'confirmed' : 'needs_confirmation',
          explanation: headerEvidence
            ? `Після ${gapRows} порожніх рядків рядок ${row.number} схожий на нову шапку.`
            : `Між рядками ${previousNonempty.number} і ${row.number} є проміжок; межа таблиці непевна.`,
        };
        boundaries.push(boundary);
        groups.at(-1).boundaries.push(boundary);
        if (boundary.appliedAction === 'split') groups.push({ rows: [], boundaries: [boundary], gaps: [] });
      } else if (gapRows) {
        groups.at(-1).gaps.push({ afterRow: previousNonempty.number, beforeRow: row.number, count: gapRows });
      }
    }
    groups.at(-1).rows.push(row);
    if (cellsOf(row).some(nonempty)) previousNonempty = row;
  }
  return { groups, boundaries };
}

/** Build a structural profile from Tauri's workbook shape. Header and boundary decisions
 * must carry the sourceKey returned by an initial profileSource call. */
export function profileSource(workbook, {
  sourceId = 'preview', sourceVersion = 'unversioned', previewId = null,
  headerConfirmations = [], boundaryConfirmations = [],
} = {}) {
  const previewOnly = !sourceId || !sourceVersion || sourceId === 'preview' || sourceVersion === 'unversioned';
  const sourceKey = previewOnly ? `preview:${identity([sourceId, sourceVersion,
    previewId == null ? previewFingerprint(workbook) : previewId])}`
    : `source:${identity([sourceId, sourceVersion])}`;
  const tables = [];
  const boundaryProposals = [];
  (Array.isArray(workbook?.sheets) ? workbook.sheets : []).forEach((sheet, sheetIndex) => {
    if (sheet?.visible === false || ['hidden', 'veryHidden'].includes(sheet?.state)) return;
    const sampled = !Array.isArray(sheet?.rows);
    const rows = Array.isArray(sampled ? sheet?.sample : sheet?.rows) ? (sampled ? sheet.sample : sheet.rows) : [];
    const partial = sheet?.truncated === true || (sampled && Number(sheet?.rowCount)
      > rows.filter(row => cellsOf(row).some(nonempty)).length);
    const { groups, boundaries } = regions(rows, sheetIndex, sourceKey, boundaryConfirmations);
    boundaryProposals.push(...boundaries);
    if (!groups.length) {
      tables.push({ tableId: `s${sheetIndex + 1}:empty`, sheet: sheet.name ?? '', columns: [],
        headerStatus: 'missing', boundaryStatus: 'unambiguous', rowCountKnown: 0,
        rowCoverage: { sourceRowNumbers: [], preambleRowNumbers: [], dataRowNumbers: [], blankRowNumbers: [] },
        truncated: partial, empty: true, warnings: [] });
    }
    for (const group of groups) {
      const present = group.rows.filter(row => cellsOf(row).some(nonempty));
      if (!present.length) {
        tables.push({ tableId: `s${sheetIndex + 1}:empty`, sheet: sheet.name ?? '', columns: [],
          headerStatus: 'missing', boundaryStatus: 'unambiguous', rowCountKnown: 0,
          rowCoverage: { sourceRowNumbers: group.rows.map(row => row.number), preambleRowNumbers: [],
            dataRowNumbers: [], blankRowNumbers: group.rows.map(row => row.number) },
          truncated: partial, empty: true, warnings: ['Аркуш містить лише порожні рядки.'] });
        continue;
      }
      const candidates = present.slice(0, 5);
      const scored = candidates.map(row => ({ row, score: headerScore(row, present[present.indexOf(row) + 1]) }));
      const guessed = scored.reduce((best, item) => item.score > best.score ? item : best).row;
      const matching = [...new Set(headerConfirmations.filter(item => item.sourceKey === sourceKey
        && item.sheetIndex === sheetIndex && present.some(row => row.number === item.headerRow))
        .map(item => item.headerRow))];
      const header = matching.length === 1 ? present.find(row => row.number === matching[0]) : guessed;
      const headerStatus = matching.length === 1 ? 'confirmed' : 'proposed';
      const start = group.rows.indexOf(header);
      const data = group.rows.slice(start + 1).filter(row => cellsOf(row).some(nonempty));
      const headers = cellsOf(header).slice(0, MAX_COLUMNS);
      const normalized = headers.map(normalizeHeader);
      const warnings = [];
      if (partial) warnings.push('Доступна лише частина рядків; точні підсумки неможливі.');
      if (start > 0) warnings.push('Рядки перед шапкою збережено як контекст; перевірте багаторядкову шапку.');
      if (headerStatus !== 'confirmed') warnings.push('Підтвердьте рядок заголовків окремо від відповідності колонок.');
      for (const boundary of group.boundaries.filter(item => item.status === 'needs_confirmation')) {
        warnings.push(`${boundary.explanation} Підтвердьте поділ або об’єднання.`);
      }
      for (const gap of group.gaps) warnings.push(`Порожній рядок між ${gap.afterRow} і ${gap.beforeRow}: записи збережено в одній таблиці.`);
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
        headerRow: header.number ?? 1, headerStatus,
        headerOptions: scored.map(item => ({ rowNumber: item.row.number, score: item.score })),
        boundaryStatus: group.boundaries.some(item => item.status === 'needs_confirmation')
          ? 'needs_confirmation' : group.boundaries.length ? 'confirmed' : 'unambiguous',
        columns,
        rowCoverage: { sourceRowNumbers: group.rows.map(row => row.number),
          preambleRowNumbers: group.rows.slice(0, start).map(row => row.number),
          dataRowNumbers: data.map(row => row.number),
          blankRowNumbers: group.rows.filter(row => !cellsOf(row).some(nonempty)).map(row => row.number) },
        rowCountKnown: partial ? null : data.length, truncated: partial,
        empty: data.length === 0 || columns.every(column => column.sampleCount === 0), warnings,
      });
    }
  });
  return { sourceId: String(sourceId), sourceVersion: String(sourceVersion), sourceKey,
    ...(previewOnly ? { previewId: previewId == null ? null : String(previewId) } : {}),
    previewOnly, tables, boundaryProposals };
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

/** Return only hypotheses unless a confirmation matches sourceKey, table, column and field. */
export function proposeBindings(profile, { rustTemplates = [], catalogs = [], confirmations = [] } = {}) {
  const out = new Map();
  const add = item => {
    const key = identity([item.tableId, item.columnId, item.role, item.definitionId ?? '', item.fieldKey ?? '']);
    const old = out.get(key);
    if (!old) { out.set(key, item); return; }
    const origins = [...old.origins];
    for (const origin of item.origins) {
      if (!origins.some(existing => JSON.stringify(existing) === JSON.stringify(origin))) origins.push(origin);
    }
    const conflictingConfirmation = old.confirmationConflict === true
      || old.bindingStatus === 'confirmed' && item.bindingStatus === 'confirmed'
      && (old.unit !== item.unit || old.aggregation !== item.aggregation);
    const bindingStatus = conflictingConfirmation ? 'ambiguous'
      : old.bindingStatus === 'confirmed' || item.bindingStatus === 'confirmed' ? 'confirmed'
        : old.bindingStatus === 'ambiguous' || item.bindingStatus === 'ambiguous' ? 'ambiguous' : 'proposed';
    out.set(key, { ...old, ...item, origins, bindingStatus,
      ...(conflictingConfirmation ? { confirmationConflict: true } : {}),
      ...(conflictingConfirmation ? { reason: 'Суперечливі підтвердження одиниці або агрегації.' } : {}) });
  };
  for (const table of profile?.tables ?? []) {
    const byId = new Map(table.columns.map(column => [column.columnId, column]));
    const headers = Array.from({ length: Math.max(0, ...table.columns.map(column => column.index + 1)) }, () => null);
    for (const column of table.columns) headers[column.index] = column.label;
    for (const template of rustTemplates) {
      const rustProfile = sourceProfile(template.fields);
      const matched = matchHeaders(rustProfile, headers);
      const collisionAliases = new Map();
      for (const collision of rustProfile.collisions) {
        const keys = collisionAliases.get(collision.alias) ?? new Set();
        collision.keys.forEach(key => keys.add(key));
        collisionAliases.set(collision.alias, keys);
      }
      const collidedByIndex = new Map();
      for (const column of table.columns) {
        const collisions = headerCandidates(column.label).filter(alias => collisionAliases.has(alias));
        if (!collisions.length) continue;
        const keys = new Set(collisions.flatMap(alias => [...collisionAliases.get(alias)]));
        collidedByIndex.set(column.index, keys);
        for (const fieldKey of keys) {
          const field = template.fields.find(item => item.key === fieldKey);
          if (!field || !compatible(column, field.dataType)) continue;
          add({ sourceKey: profile.sourceKey, tableId: table.tableId, columnId: column.columnId,
            role: TECHNICAL_ROLE_MAP[field.role] ?? field.role,
            definitionId: `rust-template:${template.id}`, fieldKey, bindingStatus: 'ambiguous',
            reason: 'Одна назва відповідає кільком полям шаблону; потрібне підтвердження.',
            origins: collisions.map(alias => ({ kind: 'rust-alias-collision', templateId: template.id,
              fieldKey, alias })) });
        }
      }
      for (const [fieldKey, indexes] of matched.mapped) {
        const field = template.fields.find(item => item.key === fieldKey);
        for (const index of indexes) {
          const column = byId.get(columnId(index));
          if (column && compatible(column, field?.dataType)) add({ sourceKey: profile.sourceKey,
            tableId: table.tableId, columnId: column.columnId,
            role: TECHNICAL_ROLE_MAP[field.role] ?? field.role, definitionId: `rust-template:${template.id}`, fieldKey,
            bindingStatus: collidedByIndex.get(index)?.has(fieldKey) ? 'ambiguous' : 'proposed',
            reason: 'Назва збігається з полем чинного шаблону.',
            origins: [{ kind: 'rust-template', templateId: template.id, fieldKey }] });
        }
      }
    }
    const aliases = new Map();
    const addAlias = (label, entry) => {
      const alias = normalizeHeader(label);
      if (!alias) return;
      aliases.set(alias, [...(aliases.get(alias) ?? []), entry]);
    };
    for (const [role, detail] of Object.entries(ROLES)) {
      if (detail.kind === 'semantic' && detail.from === 'column') {
        addAlias(detail.label, { role, origin: { kind: 'e1-role', role, label: detail.label } });
      }
    }
    for (const catalog of catalogs) for (const field of catalog.columns ?? []) {
      const role = CATALOG_V1_COLUMN_ROLES[field.id];
      if (role) for (const label of field.labels ?? []) {
        addAlias(label, { role, fieldKey: field.id,
          origin: { kind: 'catalog-v1', catalogId: catalog.id ?? null, fieldId: field.id, label } });
      }
    }
    for (const column of table.columns) {
      for (const alias of headerCandidates(column.label)) {
        const entries = aliases.get(alias) ?? [];
        const alternatives = new Set(entries.map(entry => identity([entry.role, entry.fieldKey ?? ''])));
        for (const entry of entries) add({ sourceKey: profile.sourceKey,
          tableId: table.tableId, columnId: column.columnId, role: entry.role,
          ...(entry.fieldKey ? { fieldKey: entry.fieldKey } : {}),
          bindingStatus: alternatives.size > 1 ? 'ambiguous' : 'proposed',
          reason: alternatives.size > 1
            ? 'Псевдонім відповідає кільком ролям або полям; потрібне підтвердження.'
            : 'Назва збігається зі смисловою роллю E1.',
          origins: [{ ...entry.origin, alias }] });
      }
      const roles = column.type === 'number' ? ['measure']
        : column.type === 'date' ? ['event-date', 'category']
          : column.type === 'text' ? ['category', 'label']
            : column.type === 'boolean' ? ['status'] : [];
      for (const role of roles) add({ sourceKey: profile.sourceKey,
        tableId: table.tableId, columnId: column.columnId, role,
        bindingStatus: 'proposed', reason: 'Можлива роль за типом вибірки; потрібне підтвердження.',
        origins: [{ kind: 'sample-type', type: column.type }] });
    }
    for (const confirmed of confirmations) {
      const column = byId.get(confirmed.columnId);
      if (confirmed.sourceKey !== profile.sourceKey || confirmed.tableId !== table.tableId
        || !column || !ROLES[confirmed.role] || typeof confirmed.fieldKey !== 'string'
        || !confirmed.fieldKey) continue;
      add({ sourceKey: profile.sourceKey, tableId: table.tableId, columnId: column.columnId, role: confirmed.role,
        ...(confirmed.definitionId ? { definitionId: confirmed.definitionId } : {}),
        fieldKey: confirmed.fieldKey,
        bindingStatus: 'confirmed', unit: confirmed.unit ?? null,
        aggregation: confirmed.aggregation ?? null, reason: 'Відповідність явно підтверджена користувачем.',
        origins: [{ kind: 'user-confirmation', sourceKey: profile.sourceKey,
          tableId: table.tableId, columnId: column.columnId, fieldKey: confirmed.fieldKey }] });
    }
  }
  return [...out.values()].sort((a, b) => identity([a.tableId, a.columnId, a.role, a.definitionId ?? '', a.fieldKey ?? ''])
    .localeCompare(identity([b.tableId, b.columnId, b.role, b.definitionId ?? '', b.fieldKey ?? '']), 'en'));
}

function bindingOptions(requirement, definition, table, proposals) {
  const byColumn = new Map();
  for (const proposal of proposals) {
    if (proposal.tableId !== table.tableId) continue;
    const column = table.columns.find(item => item.columnId === proposal.columnId);
    if (!compatible(column, requirement.type) || !roleCompatible(requirement.role, proposal.role, column)) continue;
    if (proposal.definitionId && proposal.definitionId !== definition.definitionId) continue;
    if (proposal.fieldKey && proposal.fieldKey !== requirement.column) continue;
    if (TARGET_FIELDS.has(requirement.column)
      && (proposal.bindingStatus !== 'confirmed' || proposal.fieldKey !== requirement.column)) continue;
    const exact = proposal.fieldKey === requirement.column;
    const rank = proposal.bindingStatus === 'confirmed' ? 0
      : (exact ? 2 : 4) + (proposal.bindingStatus === 'ambiguous' ? 1 : 0);
    const current = byColumn.get(proposal.columnId);
    if (!current || rank < current.rank) byColumn.set(proposal.columnId, { proposal, column, rank });
  }
  return [...byColumn.values()].sort((a, b) => a.rank - b.rank || a.column.index - b.column.index);
}

function metricVariants(requirements, template, optionsByIndex) {
  const targets = [];
  for (let index = 0; index < requirements.length; index += 1) {
    const field = template?.fields?.find(item => item.key === requirements[index].column);
    if (!requirements[index].required || field?.role !== 'metric') continue;
    const confirmed = optionsByIndex[index].filter(item => item.proposal.bindingStatus === 'confirmed');
    if (confirmed.length) targets.push({ index, confirmed });
  }
  let variants = [new Map()];
  let truncated = false;
  for (const target of targets) {
    const next = [];
    for (const variant of variants) for (const option of target.confirmed) {
      if ([...variant.values()].includes(option.column.columnId)) continue;
      if (next.length === MAX_METRIC_VARIANTS) { truncated = true; continue; }
      next.push(new Map([...variant, [target.index, option.column.columnId]]));
    }
    if (next.length) variants = next;
  }
  return { variants, truncated };
}

function matchRequired(requirements, optionsByIndex, forced) {
  const selected = new Map();
  const ownerByColumn = new Map();
  for (const [index, columnIdValue] of forced) {
    const option = optionsByIndex[index].find(item => item.column.columnId === columnIdValue);
    if (!option || ownerByColumn.has(columnIdValue)) return selected;
    selected.set(index, option);
    ownerByColumn.set(columnIdValue, index);
  }
  const required = requirements.map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item.required && !forced.has(index))
    .sort((a, b) => optionsByIndex[a.index].length - optionsByIndex[b.index].length || a.index - b.index);
  const augment = (index, visited) => {
    for (const option of optionsByIndex[index]) {
      const column = option.column.columnId;
      if (visited.has(column)) continue;
      visited.add(column);
      const owner = ownerByColumn.get(column);
      if (owner !== undefined && (forced.has(owner) || !augment(owner, visited))) continue;
      ownerByColumn.set(column, index);
      selected.set(index, option);
      return true;
    }
    return false;
  };
  for (const { index } of required) augment(index, new Set());
  const used = new Set(ownerByColumn.keys());
  requirements.forEach((item, index) => {
    if (item.required) return;
    const option = optionsByIndex[index].find(candidate => !used.has(candidate.column.columnId));
    if (option) { selected.set(index, option); used.add(option.column.columnId); }
  });
  return selected;
}

/** Deterministic E1 suggestions. IDs identify recommendations, never ModuleInstances. */
export function recommend(profile, definitions, options = {}) {
  const proposals = proposeBindings(profile, options);
  const templates = new Map((options.rustTemplates ?? []).map(item => [item.id, item]));
  const results = new Map();
  for (const table of profile?.tables ?? []) for (const definition of definitions ?? []) {
    const template = definition.sourceCatalog === 'rust-template' ? templates.get(definition.sourceId) : null;
    const requirements = definition.requirements ?? [];
    const optionsByIndex = requirements.map(requirement => bindingOptions(requirement, definition, table, proposals));
    const { variants, truncated } = metricVariants(requirements, template, optionsByIndex);
    for (const variant of variants) {
      const selected = matchRequired(requirements, optionsByIndex, variant);
      const fields = [];
      let missing = 0;
      let unconfirmed = 0;
      const warnings = [...(table.warnings ?? [])];
      for (const [index, requirement] of requirements.entries()) {
        const found = selected.get(index);
        if (!found) {
          if (requirement.required) missing += 1;
          fields.push({ role: requirement.role, fieldKey: requirement.column ?? null, required: requirement.required,
            status: 'missing', active: false, detail: requirement.detail ?? null });
          continue;
        }
        const { proposal, column } = found;
        let confirmed = proposal.bindingStatus === 'confirmed';
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
        const optionalMetric = !requirement.required && (templateField?.role === 'metric'
          || requirement.role === 'measure');
        const active = !optionalMetric || confirmed;
        if (optionalMetric && !active) warnings.push(`Необов’язковий показник «${column.label}» не включено без підтвердження.`);
        fields.push({ role: requirement.role, fieldKey: requirement.column ?? null, columnId: column.columnId,
          label: column.label, required: requirement.required,
          status: confirmed ? 'confirmed' : proposal.bindingStatus === 'ambiguous' ? 'ambiguous' : 'proposed',
          active, unit: proposal.unit ?? column.unit ?? null,
          origins: proposal.origins });
      }
      if (table.empty) warnings.push('Немає даних для попереднього перегляду.');
      if (table.truncated) warnings.push('Часткове джерело: точні суми й кількості недоступні.');
      if (table.headerStatus !== 'confirmed') warnings.push('Рядок заголовків ще не підтверджено.');
      if (RISKY_VISUALS.has(definition.visual) && missing) warnings.push('Потрібне окремо підтверджене цільове значення.');
      const portable = definition.sourceCatalog === 'rust-template' && Boolean(template);
      const variantsIncomplete = truncated || optionsByIndex.some((items, index) =>
        items.some(item => item.column.columnId !== selected.get(index)?.column.columnId)
        && !(variant.has(index) && !truncated && items.every(item => item.proposal.bindingStatus === 'confirmed')));
      if (variantsIncomplete) warnings.push('Показано обмежений набір зіставлень колонок; інші варіанти потребують перегляду.');
      const readiness = missing ? 'missing_columns' : !portable ? 'unsupported'
        : unconfirmed || table.empty || table.truncated || table.headerStatus !== 'confirmed'
          || table.boundaryStatus === 'needs_confirmation' ? 'needs_confirmation' : 'ready';
      if (readiness === 'unsupported') warnings.push('Для цього визначення ще немає універсального адаптера довільної таблиці.');
      const bindingIds = fields.filter(item => item.columnId && item.active)
        .map(item => `${item.fieldKey ?? item.role}=${item.columnId}`).sort();
      const suggestion = {
        id: `${profile.previewOnly ? 'preview-recommendation' : 'recommendation'}:${identity([
          profile.sourceKey, table.tableId, definition.definitionId, ...bindingIds])}`,
        definitionId: definition.definitionId, sourceId: profile.sourceId, sourceVersion: profile.sourceVersion,
        sourceKey: profile.sourceKey, previewOnly: profile.previewOnly,
        identityScope: profile.previewOnly ? 'preview' : 'source_version',
        tableId: table.tableId, title: definition.title, visualKind: definition.visual,
        level: definition.visual === 'kpi' ? 'simple' : (definition.requirements?.filter(item => item.required).length ?? 0) > 2 ? 'complex' : 'combined',
        requiredFields: fields, aggregation: definition.computation, readiness,
        explanation: [definition.computation, ...fields.filter(item => item.columnId && item.active)
          .map(item => `${item.role}: «${item.label}»`)],
        variantsIncomplete, warnings: [...new Set(warnings)],
        dataStatus: table.empty ? 'empty' : table.truncated ? 'partial' : 'available',
      };
      if (!results.has(suggestion.id)) results.set(suggestion.id, suggestion);
    }
  }
  return [...results.values()].sort((a, b) => STATUS_ORDER[a.readiness] - STATUS_ORDER[b.readiness]
    || a.tableId.localeCompare(b.tableId, 'en') || a.definitionId.localeCompare(b.definitionId, 'en')
    || a.id.localeCompare(b.id, 'en'));
}
