// Каталог стовпців, плиток і блоків дашборда: формат (v1), обмеження та суворий валідатор.
//
// Чисте ядро без DOM, мережі, сховищ і годинника. Каталог — це дані: нова колонка, плитка чи вид
// журналу додаються записом у JSON, а не правкою сторінок модулів. Код потрібен лише для нового
// ТИПУ віджета. У каталозі немає виразів, скриптів і посилань: плитка є композицією з фіксованих
// частин (підрахунок × стовпець × відбір × вигляд).
//
// Файл каталогу — недовірений вхід (його можна принести з іншого комп’ютера), тому валідатор
// працює суворо й закрито: невідомий ключ, зайвий тип, посилання в нікуди, керівний чи bidi-символ
// у підписі, перевищення ліміту — це помилка, а не мовчазне виправлення. Результат успішної
// перевірки — новий заморожений об’єкт лише з дозволених ключів.
//
// Формат описано в docs/CATALOG.md. Версія 1 ще не заморожена: крок «шість поточних карток як
// описи» може додати способи підрахунку.

/* ------------------------------------------------------------------ */
/*  Словники формату                                                   */
/* ------------------------------------------------------------------ */

export const CATALOG_FORMAT = 'easywar.catalog';
export const CATALOG_VERSION = 1;

/** Від вбудованого до профільного: каталог шару може посилатися лише на свій шар і нижчі. */
export const LAYERS = Object.freeze(['builtin', 'owner', 'profile']);
export const COLUMN_TYPES = Object.freeze(['text', 'number', 'date', 'time', 'duration', 'choice', 'multichoice', 'flag', 'coordinates']);
export const AGGREGATES = Object.freeze(['count', 'share', 'sum', 'avg', 'max', 'min', 'distinct', 'top', 'peak']);
export const FILTER_OPS = Object.freeze(['eq', 'ne', 'in', 'notin', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty']);
export const TILE_VISUALS = Object.freeze(['bars', 'ring', 'pair']);
/** Палітра плиток дашборда ПС (blue, amber, green, orange, red, grey): довільних кольорів немає. */
export const TONES = Object.freeze(['blue', 'amber', 'green', 'orange', 'red', 'grey']);
/** Що вважати добрим: up — зростання, down — зменшення, warn — зростання небажане, neutral — без оцінки. */
export const DELTA_MODES = Object.freeze(['up', 'down', 'warn', 'neutral']);
export const BLOCK_KINDS = Object.freeze(['tiles', 'dynamics', 'breakdown', 'heat', 'map', 'table', 'quality']);
export const GRAINS = Object.freeze(['day', 'week', 'month']);
export const SHAPES = Object.freeze(['bars', 'ring', 'top']);
/** Одиниця, в якій зберігаються й сумуються значення стовпця типу «тривалість». */
export const DURATION_UNITS = Object.freeze(['хв', 'год']);

export const LIMITS = Object.freeze({
  maxBytes: 512 * 1024,
  maxErrors: 50,
  maxLists: 200,
  maxValuesPerList: 500,
  maxAliases: 8,
  maxColumns: 300,
  maxLabels: 8,
  maxColumnAliases: 16,
  maxTiles: 300,
  maxBlocks: 100,
  maxKinds: 50,
  maxFilterTerms: 8,
  maxInValues: 50,
  maxExtras: 2,
  maxBlockTiles: 12,
  maxTableColumns: 30,
  maxTopLimit: 50,
  maxKindColumns: 100,
  maxKindTiles: 60,
  maxKindBlocks: 40,
  layoutMaxRows: 20,
  layoutMaxCols: 4,
  layoutMaxStack: 6,
  layoutMaxWidth: 12,
  maxTextLength: 2000,
  titleLength: 80,
  labelLength: 60,
  tileLabelLength: 40,
  subLength: 60,
  descriptionLength: 300,
  groupLength: 40,
  unitLength: 16,
  valueLength: 80,
  filterTextLength: 120,
  sheetLength: 31,
});

const NUMERIC = Object.freeze(['number', 'duration']);
const ORDERED = Object.freeze(['number', 'duration', 'date', 'time']);
const CATEGORY = Object.freeze(['text', 'choice', 'multichoice']);
const BREAKDOWN_BY = Object.freeze(['text', 'choice', 'multichoice', 'flag']);
const NOT_COORDINATES = Object.freeze(COLUMN_TYPES.filter((type) => type !== 'coordinates'));
const ORDER_OPS = Object.freeze(['gt', 'gte', 'lt', 'lte']);

/** Що приймає кожен підрахунок. column: null — стовпця бути не може. */
const AGG_RULES = Object.freeze({
  count: { column: null },
  share: { column: null, filter: true },
  sum: { column: NUMERIC },
  avg: { column: NUMERIC },
  max: { column: NUMERIC },
  min: { column: NUMERIC },
  distinct: { column: NOT_COORDINATES },
  top: { column: CATEGORY },
  peak: { column: NUMERIC, columnOptional: true, by: true },
});

const TILE_AGGS = Object.freeze(['count', 'share', 'sum', 'avg', 'max', 'min', 'distinct', 'peak']);
const PER_AGGS = Object.freeze(['count', 'sum', 'avg', 'max', 'min', 'distinct']);
const BLOCK_AGGS = PER_AGGS;

/** Ключі блоків за видом: req — обов’язкові, opt — необов’язкові. Решта ключів — помилка. */
const BLOCK_SPEC = Object.freeze({
  tiles: { req: ['tiles'], opt: [] },
  dynamics: { req: ['by', 'measure', 'grain'], opt: [] },
  breakdown: { req: ['by', 'measure', 'shape'], opt: ['limit'] },
  heat: { req: ['by', 'measure'], opt: ['across'] },
  map: { req: ['coordinates'], opt: [] },
  table: { req: ['columns'], opt: [] },
  quality: { req: [], opt: [] },
});
const BLOCK_KIND_KEYS = Object.freeze(['tiles', 'by', 'measure', 'grain', 'shape', 'limit', 'across', 'coordinates', 'columns']);

const NAMESPACES = Object.freeze([
  ['list', 'lists'],
  ['col', 'columns'],
  ['tile', 'tiles'],
  ['block', 'blocks'],
  ['kind', 'kinds'],
]);

const ID_BODY = '[a-z0-9][a-z0-9_.-]{0,57}';
const ID_PATTERNS = Object.freeze({
  cat: new RegExp(`^cat\\.${ID_BODY}$`),
  list: new RegExp(`^list\\.${ID_BODY}$`),
  col: new RegExp(`^col\\.${ID_BODY}$`),
  tile: new RegExp(`^tile\\.${ID_BODY}$`),
  block: new RegExp(`^block\\.${ID_BODY}$`),
  kind: new RegExp(`^kind\\.${ID_BODY}$`),
});
const ICON_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------------------------------------------ */
/*  Текст                                                              */
/* ------------------------------------------------------------------ */

/** Керівні, невидимі й bidi-символи: у підписах вони годяться лише для підміни тексту. */
function isBadChar(code) {
  return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)
    || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e)
    || (code >= 0x2060 && code <= 0x206f) || code === 0xfeff;
}

// Апостроф у різних кодуваннях: ' ’ ‘ ʼ ` ´ — для порівняння це одна літера.
const APOSTROPHES = new Set([0x27, 0x2019, 0x2018, 0x02bc, 0x60, 0xb4]);

/** Ключ порівняння підписів: NFC, регістр, пробіли й апострофи не мають значення. */
export function foldLabel(text) {
  let out = '';
  for (const ch of String(text).normalize('NFC')) {
    out += APOSTROPHES.has(ch.codePointAt(0)) ? "'" : ch;
  }
  return out.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Відлуння чужого тексту в повідомленні про помилку: коротке й без невидимих символів. */
function echo(value) {
  let out = '';
  for (const ch of String(value).slice(0, 40)) out += isBadChar(ch.codePointAt(0)) ? '?' : ch;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Контекст перевірки й базові перевірники                            */
/* ------------------------------------------------------------------ */

const join = (path, key) => (path ? `${path}.${key}` : key);

function makeContext(base) {
  const index = {};
  const taken = {};
  for (const [ns] of NAMESPACES) {
    index[ns] = new Map();
    taken[ns] = new Set();
  }
  for (const doc of base) {
    for (const [ns, key] of NAMESPACES) {
      for (const item of doc[key]) {
        index[ns].set(item.id, item);
        taken[ns].add(item.id);
      }
    }
  }
  const ctx = {
    index,
    taken,
    deferred: [],
    errors: [],
    truncated: false,
    err(path, code, message) {
      if (ctx.errors.length < LIMITS.maxErrors) ctx.errors.push({ path, code, message });
      else ctx.truncated = true;
    },
  };
  return ctx;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Об’єкт із суворим набором ключів. Повертає значення (навіть із помилками, щоб зібрати їх усі). */
function obj(ctx, value, path, spec) {
  if (!isPlainObject(value)) {
    ctx.err(path, 'not_object', 'Очікується об’єкт.');
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!spec.req.includes(key) && !spec.opt.includes(key)) {
      ctx.err(join(path, key), 'unknown_key', `Невідомий ключ «${echo(key)}».`);
    }
  }
  for (const key of spec.req) {
    if (!Object.hasOwn(value, key)) ctx.err(join(path, key), 'missing', `Бракує обов’язкового ключа «${key}».`);
  }
  return value;
}

function arr(ctx, value, path, min, max) {
  if (!Array.isArray(value)) {
    ctx.err(path, 'not_array', 'Очікується масив.');
    return null;
  }
  if (value.length < min) {
    ctx.err(path, 'too_few', `Потрібно щонайменше ${min} елемент(ів).`);
    return null;
  }
  if (value.length > max) {
    ctx.err(path, 'too_many', `Забагато елементів: найбільше ${max}.`);
    return null;
  }
  return value;
}

function str(ctx, value, path, max) {
  if (typeof value !== 'string') {
    ctx.err(path, 'not_string', 'Очікується рядок.');
    return undefined;
  }
  if (value.length > max * 2) {
    ctx.err(path, 'too_long', `Рядок довший за ${max} символів.`);
    return undefined;
  }
  for (const ch of value) {
    if (isBadChar(ch.codePointAt(0))) {
      ctx.err(path, 'forbidden_char', 'Рядок містить керівний або невидимий символ.');
      return undefined;
    }
  }
  const text = value.normalize('NFC').trim();
  const length = [...text].length;
  if (length < 1) {
    ctx.err(path, 'empty', 'Рядок не може бути порожнім.');
    return undefined;
  }
  if (length > max) {
    ctx.err(path, 'too_long', `Рядок довший за ${max} символів.`);
    return undefined;
  }
  return text;
}

function oneOf(ctx, value, path, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    ctx.err(path, 'bad_value', `Дозволено лише: ${allowed.join(', ')}.`);
    return undefined;
  }
  return value;
}

function bool(ctx, value, path) {
  if (typeof value !== 'boolean') {
    ctx.err(path, 'not_boolean', 'Очікується true або false.');
    return undefined;
  }
  return value;
}

function finite(ctx, value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    ctx.err(path, 'not_number', 'Очікується скінченне число.');
    return undefined;
  }
  return value;
}

function integer(ctx, value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    ctx.err(path, 'bad_integer', `Очікується ціле число від ${min} до ${max}.`);
    return undefined;
  }
  return value;
}

/** Ідентифікатор елемента з обов’язковим префіксом його виду: col., tile., block. тощо. */
function ident(ctx, value, path, prefix) {
  if (typeof value !== 'string' || !ID_PATTERNS[prefix].test(value)) {
    ctx.err(path, 'bad_id', `Ідентифікатор має вигляд «${prefix}.назва»: малі латинські літери, цифри, «.», «_», «-» (до 64 символів).`);
    return undefined;
  }
  return value;
}

/** Реєструє id нового елемента; повторення в цьому каталозі чи в нижчих шарах — помилка. */
function claim(ctx, ns, id, path) {
  if (ctx.taken[ns].has(id)) {
    ctx.err(path, 'duplicate_id', `Ідентифікатор «${id}» уже зайнятий.`);
    return false;
  }
  ctx.taken[ns].add(id);
  return true;
}

function basedOn(ctx, value, path, prefix, ownId) {
  const id = ident(ctx, value, path, prefix);
  if (id !== undefined && id === ownId) ctx.err(path, 'self_reference', 'Елемент не може бути основою самого себе.');
  return id;
}

function put(target, key, value) {
  if (value !== undefined) target[key] = value;
}

function isIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/* ------------------------------------------------------------------ */
/*  Посилання на стовпці та відбір                                     */
/* ------------------------------------------------------------------ */

/** Стовпець за id; allowed — допустимі типи (null — будь-який). */
function columnRef(ctx, id, path, allowed) {
  if (typeof id !== 'string' || !ID_PATTERNS.col.test(id)) {
    ctx.err(path, 'bad_id', 'Очікується ідентифікатор стовпця «col.назва».');
    return undefined;
  }
  const column = ctx.index.col.get(id);
  if (!column) {
    ctx.err(path, 'unknown_column', `Стовпця «${id}» немає в каталозі.`);
    return undefined;
  }
  if (allowed && !allowed.includes(column.type)) {
    ctx.err(path, 'wrong_type', `Стовпець «${id}» має тип «${column.type}», а тут потрібен один із: ${allowed.join(', ')}.`);
    return undefined;
  }
  return column;
}

/** Значення для порівняння, перевірене за типом стовпця. */
function scalarFor(ctx, column, value, path) {
  switch (column.type) {
    case 'number':
    case 'duration':
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      break;
    case 'date':
      if (typeof value === 'string' && isIsoDate(value)) return value;
      break;
    case 'time':
      if (typeof value === 'string' && CLOCK_TIME.test(value)) return value;
      break;
    case 'flag':
      if (typeof value === 'boolean') return value;
      break;
    case 'text':
      return str(ctx, value, path, LIMITS.filterTextLength);
    case 'choice':
    case 'multichoice': {
      const text = str(ctx, value, path, LIMITS.valueLength);
      if (text === undefined) return undefined;
      const list = ctx.index.list.get(column.list);
      if (list && !list.allowCustom) {
        const found = list.values.find((entry) => foldLabel(entry.value) === foldLabel(text));
        if (!found) {
          ctx.err(path, 'value_not_in_list', `Значення «${echo(text)}» немає в списку «${list.id}».`);
          return undefined;
        }
        return found.value;
      }
      return text;
    }
    default:
      break;
  }
  ctx.err(path, 'wrong_value_type', `Значення не відповідає типу стовпця «${column.type}».`);
  return undefined;
}

function validateFilter(ctx, value, path) {
  const terms = arr(ctx, value, path, 1, LIMITS.maxFilterTerms);
  if (!terms) return undefined;
  const out = [];
  terms.forEach((raw, i) => {
    const at = `${path}[${i}]`;
    const o = obj(ctx, raw, at, { req: ['column', 'op'], opt: ['value'] });
    if (!o) return;
    const column = columnRef(ctx, o.column, join(at, 'column'), null);
    const op = oneOf(ctx, o.op, join(at, 'op'), FILTER_OPS);
    if (!column || !op) return;
    const term = { column: column.id, op };
    const valuePath = join(at, 'value');
    if (op === 'empty' || op === 'notempty') {
      if (Object.hasOwn(o, 'value')) ctx.err(valuePath, 'value_not_allowed', `Умова «${op}» не має значення.`);
    } else if (column.type === 'coordinates') {
      ctx.err(join(at, 'op'), 'op_not_for_type', 'Координати можна лише перевіряти на наявність (empty, notempty).');
    } else if (ORDER_OPS.includes(op) && !ORDERED.includes(column.type)) {
      ctx.err(join(at, 'op'), 'op_not_for_type', `Порівняння «${op}» не застосовується до типу «${column.type}».`);
    } else if (!Object.hasOwn(o, 'value')) {
      ctx.err(valuePath, 'missing', `Умова «${op}» потребує значення.`);
    } else if (op === 'in' || op === 'notin') {
      const items = arr(ctx, o.value, valuePath, 1, LIMITS.maxInValues);
      if (items) {
        const checked = items.map((item, j) => scalarFor(ctx, column, item, `${valuePath}[${j}]`));
        if (checked.every((item) => item !== undefined)) term.value = checked;
      }
    } else {
      put(term, 'value', scalarFor(ctx, column, o.value, valuePath));
    }
    out.push(term);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Підрахунок (measure)                                               */
/* ------------------------------------------------------------------ */

function validateMeasure(ctx, value, path, allowedAggs) {
  const o = obj(ctx, value, path, { req: ['agg'], opt: ['column', 'filter', 'by', 'grain'] });
  if (!o) return undefined;
  const agg = oneOf(ctx, o.agg, join(path, 'agg'), allowedAggs);
  if (!agg) return undefined;
  const rule = AGG_RULES[agg];
  const out = { agg };

  if (rule.column === null) {
    if (Object.hasOwn(o, 'column')) ctx.err(join(path, 'column'), 'not_allowed_for_agg', `Підрахунок «${agg}» не приймає стовпця.`);
  } else if (Object.hasOwn(o, 'column')) {
    const column = columnRef(ctx, o.column, join(path, 'column'), rule.column);
    if (column) out.column = column.id;
  } else if (!rule.columnOptional) {
    ctx.err(join(path, 'column'), 'missing', `Підрахунок «${agg}» потребує стовпця.`);
  }

  if (rule.by) {
    if (Object.hasOwn(o, 'by')) {
      const column = columnRef(ctx, o.by, join(path, 'by'), ['date']);
      if (column) out.by = column.id;
    } else {
      ctx.err(join(path, 'by'), 'missing', `Підрахунок «${agg}» потребує стовпця дати в «by».`);
    }
    if (Object.hasOwn(o, 'grain')) put(out, 'grain', oneOf(ctx, o.grain, join(path, 'grain'), GRAINS));
    else ctx.err(join(path, 'grain'), 'missing', `Підрахунок «${agg}» потребує «grain».`);
  } else {
    for (const key of ['by', 'grain']) {
      if (Object.hasOwn(o, key)) ctx.err(join(path, key), 'not_allowed_for_agg', `Підрахунок «${agg}» не приймає «${key}».`);
    }
  }

  if (Object.hasOwn(o, 'filter')) put(out, 'filter', validateFilter(ctx, o.filter, join(path, 'filter')));
  else if (rule.filter) ctx.err(join(path, 'filter'), 'missing', `Підрахунок «${agg}» потребує відбору («filter»).`);
  return out;
}

/** Усі стовпці, які читає підрахунок (значення, дата, відбір). */
export function measureColumns(measure) {
  const out = [];
  if (!measure) return out;
  if (measure.column) out.push(measure.column);
  if (measure.by) out.push(measure.by);
  for (const term of Array.isArray(measure.filter) ? measure.filter : []) if (term && term.column) out.push(term.column);
  return out;
}

/** Усі стовпці, без яких плитка не порахується. */
export function tileColumns(tile) {
  const set = new Set(measureColumns(tile.measure));
  for (const id of measureColumns(tile.per)) set.add(id);
  if (tile.by) set.add(tile.by);
  for (const extra of Array.isArray(tile.extras) ? tile.extras : []) for (const id of measureColumns(extra && extra.measure)) set.add(id);
  return [...set];
}

/** Усі стовпці, без яких блок не намалюється. findTile — пошук плитки за id для блоку «tiles». */
export function blockColumns(block, findTile) {
  const set = new Set();
  const add = (id) => { if (id) set.add(id); };
  switch (block.kind) {
    case 'tiles':
      for (const id of Array.isArray(block.tiles) ? block.tiles : []) {
        const tile = findTile(id);
        if (tile) tileColumns(tile).forEach(add);
      }
      break;
    case 'dynamics':
    case 'breakdown':
    case 'heat':
      add(block.by);
      add(block.across);
      measureColumns(block.measure).forEach(add);
      break;
    case 'map':
      add(block.coordinates);
      break;
    case 'table':
      (Array.isArray(block.columns) ? block.columns : []).forEach(add);
      break;
    default:
      break;
  }
  return [...set];
}

/* ------------------------------------------------------------------ */
/*  Елементи каталогу                                                  */
/* ------------------------------------------------------------------ */

function validateList(ctx, raw, path) {
  const o = obj(ctx, raw, path, { req: ['id', 'title', 'values'], opt: ['allowCustom', 'based_on'] });
  if (!o) return undefined;
  const id = ident(ctx, o.id, join(path, 'id'), 'list');
  const out = { id };
  out.title = str(ctx, o.title, join(path, 'title'), LIMITS.titleLength);
  const values = arr(ctx, o.values, join(path, 'values'), 1, LIMITS.maxValuesPerList);
  const seen = new Set();
  const note = (text, at) => {
    const key = foldLabel(text);
    if (seen.has(key)) ctx.err(at, 'duplicate_value', `«${echo(text)}» повторюється в списку (регістр, пробіли й апострофи не розрізняються).`);
    seen.add(key);
  };
  out.values = [];
  (values || []).forEach((rawEntry, i) => {
    const at = `${join(path, 'values')}[${i}]`;
    const entry = obj(ctx, rawEntry, at, { req: ['value'], opt: ['label', 'aliases'] });
    if (!entry) return;
    const item = {};
    item.value = str(ctx, entry.value, join(at, 'value'), LIMITS.valueLength);
    if (item.value !== undefined) note(item.value, join(at, 'value'));
    if (Object.hasOwn(entry, 'label')) put(item, 'label', str(ctx, entry.label, join(at, 'label'), LIMITS.valueLength));
    if (Object.hasOwn(entry, 'aliases')) {
      const aliases = arr(ctx, entry.aliases, join(at, 'aliases'), 1, LIMITS.maxAliases);
      if (aliases) {
        item.aliases = aliases.map((alias, j) => {
          const text = str(ctx, alias, `${join(at, 'aliases')}[${j}]`, LIMITS.valueLength);
          if (text !== undefined) note(text, `${join(at, 'aliases')}[${j}]`);
          return text;
        });
      }
    }
    out.values.push(item);
  });
  if (Object.hasOwn(o, 'allowCustom')) put(out, 'allowCustom', bool(ctx, o.allowCustom, join(path, 'allowCustom')));
  if (Object.hasOwn(o, 'based_on')) put(out, 'based_on', basedOn(ctx, o.based_on, join(path, 'based_on'), 'list', id));
  if (id !== undefined && claim(ctx, 'list', id, join(path, 'id'))) ctx.index.list.set(id, out);
  return out;
}

function validateColumn(ctx, raw, path) {
  const o = obj(ctx, raw, path, {
    req: ['id', 'type', 'labels'],
    opt: ['aliases', 'group', 'description', 'unit', 'list', 'min', 'max', 'integer', 'maxLength', 'based_on'],
  });
  if (!o) return undefined;
  const id = ident(ctx, o.id, join(path, 'id'), 'col');
  const type = oneOf(ctx, o.type, join(path, 'type'), COLUMN_TYPES);
  const out = { id, type };

  const seen = new Set();
  const names = (value, at, max, field) => {
    const items = arr(ctx, value, at, 1, max);
    if (!items) return undefined;
    return items.map((item, i) => {
      const text = str(ctx, item, `${at}[${i}]`, LIMITS.labelLength);
      if (text !== undefined) {
        const key = foldLabel(text);
        if (seen.has(key)) ctx.err(`${at}[${i}]`, 'duplicate_label', `Назва «${echo(text)}» повторюється серед ${field} стовпця.`);
        seen.add(key);
      }
      return text;
    });
  };
  out.labels = names(o.labels, join(path, 'labels'), LIMITS.maxLabels, 'підписів і синонімів');
  if (Object.hasOwn(o, 'aliases')) out.aliases = names(o.aliases, join(path, 'aliases'), LIMITS.maxColumnAliases, 'підписів і синонімів');
  if (Object.hasOwn(o, 'group')) put(out, 'group', str(ctx, o.group, join(path, 'group'), LIMITS.groupLength));
  if (Object.hasOwn(o, 'description')) put(out, 'description', str(ctx, o.description, join(path, 'description'), LIMITS.descriptionLength));

  const notFor = (key, types) => {
    if (Object.hasOwn(o, key) && type !== undefined && !types.includes(type)) {
      ctx.err(join(path, key), 'not_allowed_for_type', `Ключ «${key}» не застосовується до типу «${type}».`);
      return false;
    }
    return Object.hasOwn(o, key);
  };

  if (type === 'duration') {
    if (Object.hasOwn(o, 'unit')) put(out, 'unit', oneOf(ctx, o.unit, join(path, 'unit'), DURATION_UNITS));
    else ctx.err(join(path, 'unit'), 'missing', `Для тривалості потрібна одиниця: ${DURATION_UNITS.join(' або ')}.`);
  } else if (notFor('unit', ['number'])) {
    put(out, 'unit', str(ctx, o.unit, join(path, 'unit'), LIMITS.unitLength));
  }

  if (type === 'choice' || type === 'multichoice') {
    if (Object.hasOwn(o, 'list')) {
      const listId = ident(ctx, o.list, join(path, 'list'), 'list');
      if (listId !== undefined) {
        if (!ctx.index.list.has(listId)) ctx.err(join(path, 'list'), 'unknown_list', `Списку «${listId}» немає в каталозі.`);
        else out.list = listId;
      }
    } else {
      ctx.err(join(path, 'list'), 'missing', 'Для вибору зі списку потрібен «list».');
    }
  } else {
    notFor('list', []);
  }

  const hasMin = notFor('min', NUMERIC);
  const hasMax = notFor('max', NUMERIC);
  if (hasMin) put(out, 'min', finite(ctx, o.min, join(path, 'min')));
  if (hasMax) put(out, 'max', finite(ctx, o.max, join(path, 'max')));
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) ctx.err(join(path, 'min'), 'bad_range', '«min» більший за «max».');
  if (notFor('integer', NUMERIC)) put(out, 'integer', bool(ctx, o.integer, join(path, 'integer')));
  if (notFor('maxLength', ['text'])) put(out, 'maxLength', integer(ctx, o.maxLength, join(path, 'maxLength'), 1, LIMITS.maxTextLength));

  if (Object.hasOwn(o, 'based_on')) put(out, 'based_on', basedOn(ctx, o.based_on, join(path, 'based_on'), 'col', id));
  if (id !== undefined && type !== undefined && claim(ctx, 'col', id, join(path, 'id'))) ctx.index.col.set(id, out);
  return out;
}

function validateTile(ctx, raw, path) {
  const o = obj(ctx, raw, path, {
    req: ['id', 'label', 'measure', 'visual', 'tone'],
    opt: ['sub', 'per', 'by', 'delta', 'icon', 'extras', 'opens', 'based_on'],
  });
  if (!o) return undefined;
  const id = ident(ctx, o.id, join(path, 'id'), 'tile');
  const out = { id };
  out.label = str(ctx, o.label, join(path, 'label'), LIMITS.tileLabelLength);
  if (Object.hasOwn(o, 'sub')) put(out, 'sub', str(ctx, o.sub, join(path, 'sub'), LIMITS.subLength));
  out.measure = validateMeasure(ctx, o.measure, join(path, 'measure'), TILE_AGGS);
  if (Object.hasOwn(o, 'per')) put(out, 'per', validateMeasure(ctx, o.per, join(path, 'per'), PER_AGGS));
  const visual = oneOf(ctx, o.visual, join(path, 'visual'), TILE_VISUALS);
  out.visual = visual;
  if (Object.hasOwn(o, 'by')) {
    const column = columnRef(ctx, o.by, join(path, 'by'), ['date']);
    if (column) out.by = column.id;
  }
  out.tone = oneOf(ctx, o.tone, join(path, 'tone'), TONES);
  if (Object.hasOwn(o, 'delta')) {
    put(out, 'delta', oneOf(ctx, o.delta, join(path, 'delta'), DELTA_MODES));
    if (!Object.hasOwn(o, 'by')) ctx.err(join(path, 'delta'), 'delta_needs_by', 'Зміну до попереднього періоду можна рахувати лише за стовпцем дати («by»).');
  }
  if (Object.hasOwn(o, 'icon')) {
    if (typeof o.icon === 'string' && ICON_PATTERN.test(o.icon)) out.icon = o.icon;
    else ctx.err(join(path, 'icon'), 'bad_icon', 'Ідентифікатор іконки: малі латинські літери, цифри й «-».');
  }

  let extras = [];
  if (Object.hasOwn(o, 'extras')) {
    const list = arr(ctx, o.extras, join(path, 'extras'), 1, LIMITS.maxExtras);
    extras = (list || []).map((rawExtra, i) => {
      const at = `${join(path, 'extras')}[${i}]`;
      const extra = obj(ctx, rawExtra, at, { req: ['label', 'measure'], opt: [] });
      if (!extra) return undefined;
      return {
        label: str(ctx, extra.label, join(at, 'label'), LIMITS.tileLabelLength),
        measure: validateMeasure(ctx, extra.measure, join(at, 'measure'), AGGREGATES),
      };
    });
    out.extras = extras;
  }

  const agg = out.measure && out.measure.agg;
  if (visual === 'ring') {
    if (agg && agg !== 'share') ctx.err(join(path, 'visual'), 'visual_mismatch', 'Кільце показує частку: потрібен підрахунок «share».');
    if (Object.hasOwn(o, 'per')) ctx.err(join(path, 'per'), 'visual_mismatch', 'Кільце не поєднується з «per».');
    if (extras.length) ctx.err(join(path, 'extras'), 'visual_mismatch', 'Кільце не має додаткових показників.');
  } else if (visual) {
    if (agg === 'share') ctx.err(join(path, 'visual'), 'visual_mismatch', 'Частку («share») показує лише кільце.');
    if (!Object.hasOwn(o, 'by')) ctx.err(join(path, 'by'), 'missing', `Вигляд «${visual}» малює ряд за датою: потрібен «by».`);
    if (visual === 'bars' && extras.length > 1) ctx.err(join(path, 'extras'), 'visual_mismatch', 'Стовпчики мають не більше одного додаткового показника.');
    if (visual === 'pair' && extras.length !== 2) ctx.err(join(path, 'extras'), 'visual_mismatch', 'Пара міні-плиток потребує рівно двох додаткових показників.');
  }

  if (Object.hasOwn(o, 'opens')) {
    const target = ident(ctx, o.opens, join(path, 'opens'), 'block');
    if (target !== undefined) {
      put(out, 'opens', target);
      ctx.deferred.push(() => {
        if (!ctx.index.block.has(target)) ctx.err(join(path, 'opens'), 'unknown_block', `Блоку «${target}» немає в каталозі.`);
      });
    }
  }
  if (Object.hasOwn(o, 'based_on')) put(out, 'based_on', basedOn(ctx, o.based_on, join(path, 'based_on'), 'tile', id));
  if (id !== undefined && claim(ctx, 'tile', id, join(path, 'id'))) ctx.index.tile.set(id, out);
  return out;
}

function uniqueIds(ctx, value, path, max, check) {
  const items = arr(ctx, value, path, 1, max);
  if (!items) return undefined;
  const seen = new Set();
  const out = [];
  items.forEach((item, i) => {
    const at = `${path}[${i}]`;
    const id = check(item, at);
    if (id === undefined) return;
    if (seen.has(id)) ctx.err(at, 'duplicate_ref', `«${id}» вказано двічі.`);
    seen.add(id);
    out.push(id);
  });
  return out;
}

function validateBlock(ctx, raw, path) {
  const o = obj(ctx, raw, path, { req: ['id', 'title', 'kind'], opt: ['based_on', ...BLOCK_KIND_KEYS] });
  if (!o) return undefined;
  const id = ident(ctx, o.id, join(path, 'id'), 'block');
  const out = { id };
  out.title = str(ctx, o.title, join(path, 'title'), LIMITS.titleLength);
  const kind = oneOf(ctx, o.kind, join(path, 'kind'), BLOCK_KINDS);
  out.kind = kind;

  if (kind) {
    const spec = BLOCK_SPEC[kind];
    for (const key of BLOCK_KIND_KEYS) {
      if (Object.hasOwn(o, key) && !spec.req.includes(key) && !spec.opt.includes(key)) {
        ctx.err(join(path, key), 'not_allowed_for_kind', `Ключ «${key}» не застосовується до блоку виду «${kind}».`);
      }
    }
    for (const key of spec.req) {
      if (!Object.hasOwn(o, key)) ctx.err(join(path, key), 'missing', `Блок виду «${kind}» потребує ключа «${key}».`);
    }
    const has = (key) => spec.req.includes(key) || spec.opt.includes(key) ? Object.hasOwn(o, key) : false;

    if (has('tiles')) {
      out.tiles = uniqueIds(ctx, o.tiles, join(path, 'tiles'), LIMITS.maxBlockTiles, (item, at) => {
        const tileId = ident(ctx, item, at, 'tile');
        if (tileId !== undefined && !ctx.index.tile.has(tileId)) {
          ctx.err(at, 'unknown_tile', `Плитки «${tileId}» немає в каталозі.`);
          return undefined;
        }
        return tileId;
      });
    }
    if (has('by')) {
      const allowed = kind === 'dynamics' ? ['date'] : kind === 'heat' ? ['time'] : BREAKDOWN_BY;
      const column = columnRef(ctx, o.by, join(path, 'by'), allowed);
      if (column) out.by = column.id;
    }
    if (has('across')) {
      const column = columnRef(ctx, o.across, join(path, 'across'), ['date']);
      if (column) out.across = column.id;
    }
    if (has('measure')) out.measure = validateMeasure(ctx, o.measure, join(path, 'measure'), BLOCK_AGGS);
    if (has('grain')) out.grain = oneOf(ctx, o.grain, join(path, 'grain'), GRAINS);
    if (has('shape')) out.shape = oneOf(ctx, o.shape, join(path, 'shape'), SHAPES);
    if (has('limit')) put(out, 'limit', integer(ctx, o.limit, join(path, 'limit'), 1, LIMITS.maxTopLimit));
    if (has('coordinates')) {
      const column = columnRef(ctx, o.coordinates, join(path, 'coordinates'), ['coordinates']);
      if (column) out.coordinates = column.id;
    }
    if (has('columns')) {
      out.columns = uniqueIds(ctx, o.columns, join(path, 'columns'), LIMITS.maxTableColumns, (item, at) => {
        const column = columnRef(ctx, item, at, null);
        return column ? column.id : undefined;
      });
    }
  }
  if (Object.hasOwn(o, 'based_on')) put(out, 'based_on', basedOn(ctx, o.based_on, join(path, 'based_on'), 'block', id));
  if (id !== undefined && claim(ctx, 'block', id, join(path, 'id'))) ctx.index.block.set(id, out);
  return out;
}

const INVALID_SHEET_CHARS = /[\\/?*[\]:]/;

function validateLayout(ctx, raw, path, offeredBlocks) {
  const o = obj(ctx, raw, path, { req: ['rows'], opt: [] });
  if (!o) return undefined;
  const rows = arr(ctx, o.rows, join(path, 'rows'), 1, LIMITS.layoutMaxRows);
  const seen = new Set();
  const out = { rows: [] };
  (rows || []).forEach((rawRow, ri) => {
    const rowPath = `${join(path, 'rows')}[${ri}]`;
    const row = obj(ctx, rawRow, rowPath, { req: ['cols'], opt: [] });
    if (!row) return;
    const cols = arr(ctx, row.cols, join(rowPath, 'cols'), 1, LIMITS.layoutMaxCols);
    const outRow = { cols: [] };
    (cols || []).forEach((rawCol, ci) => {
      const colPath = `${join(rowPath, 'cols')}[${ci}]`;
      const col = obj(ctx, rawCol, colPath, { req: ['w', 'cards'], opt: [] });
      if (!col) return;
      let w = finite(ctx, col.w, join(colPath, 'w'));
      if (w !== undefined && (w <= 0 || w > LIMITS.layoutMaxWidth)) {
        ctx.err(join(colPath, 'w'), 'bad_width', `Ширина колонки — число більше 0 і не більше ${LIMITS.layoutMaxWidth}.`);
        w = undefined;
      }
      const cards = arr(ctx, col.cards, join(colPath, 'cards'), 1, LIMITS.layoutMaxStack);
      const outCards = [];
      (cards || []).forEach((card, k) => {
        const at = `${join(colPath, 'cards')}[${k}]`;
        const blockId = ident(ctx, card, at, 'block');
        if (blockId === undefined) return;
        if (!offeredBlocks.has(blockId)) ctx.err(at, 'block_not_offered', `Блок «${blockId}» не входить до блоків цього виду журналу.`);
        else if (seen.has(blockId)) ctx.err(at, 'duplicate_ref', `Блок «${blockId}» стоїть у розкладці двічі.`);
        seen.add(blockId);
        outCards.push(blockId);
      });
      outRow.cols.push({ w, cards: outCards });
    });
    out.rows.push(outRow);
  });
  return out;
}

function validateKind(ctx, raw, path) {
  const o = obj(ctx, raw, path, {
    req: ['id', 'title', 'sheet', 'columns'],
    opt: ['description', 'tiles', 'blocks', 'layout', 'based_on'],
  });
  if (!o) return undefined;
  const id = ident(ctx, o.id, join(path, 'id'), 'kind');
  const out = { id };
  out.title = str(ctx, o.title, join(path, 'title'), LIMITS.titleLength);
  if (Object.hasOwn(o, 'description')) put(out, 'description', str(ctx, o.description, join(path, 'description'), LIMITS.descriptionLength));

  const sheet = str(ctx, o.sheet, join(path, 'sheet'), LIMITS.sheetLength);
  if (sheet !== undefined && (INVALID_SHEET_CHARS.test(sheet) || sheet.startsWith("'") || sheet.endsWith("'") || sheet.toLowerCase() === 'history')) {
    ctx.err(join(path, 'sheet'), 'bad_sheet_name', 'Назва аркуша не може містити \\ / ? * [ ] :, починатися чи закінчуватися апострофом або бути «History».');
  } else {
    out.sheet = sheet;
  }

  const columnIds = new Set();
  const columns = arr(ctx, o.columns, join(path, 'columns'), 1, LIMITS.maxKindColumns);
  out.columns = [];
  (columns || []).forEach((rawEntry, i) => {
    const at = `${join(path, 'columns')}[${i}]`;
    const entry = obj(ctx, rawEntry, at, { req: ['column'], opt: ['core', 'default'] });
    if (!entry) return;
    const column = columnRef(ctx, entry.column, join(at, 'column'), null);
    const item = {};
    if (column) {
      if (columnIds.has(column.id)) ctx.err(join(at, 'column'), 'duplicate_ref', `Стовпець «${column.id}» вказано двічі.`);
      columnIds.add(column.id);
      item.column = column.id;
    }
    if (Object.hasOwn(entry, 'core')) put(item, 'core', bool(ctx, entry.core, join(at, 'core')));
    if (Object.hasOwn(entry, 'default')) put(item, 'default', bool(ctx, entry.default, join(at, 'default')));
    out.columns.push(item);
  });

  const findTile = (tileId) => ctx.index.tile.get(tileId);
  const offered = (key, ns, prefix, max) => {
    if (!Object.hasOwn(o, key)) return [];
    const ids = uniqueIds(ctx, o[key], join(path, key), max, (item, at) => {
      const refId = ident(ctx, item, at, prefix);
      if (refId !== undefined && !ctx.index[ns].has(refId)) {
        ctx.err(at, `unknown_${ns}`, `Елемента «${refId}» немає в каталозі.`);
        return undefined;
      }
      return refId;
    });
    out[key] = ids || [];
    return out[key];
  };
  const tileIds = offered('tiles', 'tile', 'tile', LIMITS.maxKindTiles);
  const blockIds = offered('blocks', 'block', 'block', LIMITS.maxKindBlocks);

  // Усе, що пропонує вид, має бути досяжним: потрібні стовпці входять до набору стовпців виду.
  const missing = (required) => required.filter((columnId) => !columnIds.has(columnId));
  tileIds.forEach((tileId, i) => {
    const gaps = missing(tileColumns(findTile(tileId)));
    if (gaps.length) ctx.err(`${join(path, 'tiles')}[${i}]`, 'unreachable_requirement', `Плитці «${tileId}» потрібні стовпці, яких немає у виді: ${gaps.join(', ')}.`);
  });
  blockIds.forEach((blockId, i) => {
    const block = ctx.index.block.get(blockId);
    if (block.kind === 'tiles') {
      for (const tileId of Array.isArray(block.tiles) ? block.tiles : []) {
        if (!tileIds.includes(tileId)) ctx.err(`${join(path, 'blocks')}[${i}]`, 'tile_not_offered', `Блок «${blockId}» містить плитку «${tileId}», яку вид не пропонує.`);
      }
    }
    const gaps = missing(blockColumns(block, findTile));
    if (gaps.length) ctx.err(`${join(path, 'blocks')}[${i}]`, 'unreachable_requirement', `Блоку «${blockId}» потрібні стовпці, яких немає у виді: ${gaps.join(', ')}.`);
  });

  if (Object.hasOwn(o, 'layout')) put(out, 'layout', validateLayout(ctx, o.layout, join(path, 'layout'), new Set(blockIds)));
  if (Object.hasOwn(o, 'based_on')) put(out, 'based_on', basedOn(ctx, o.based_on, join(path, 'based_on'), 'kind', id));
  if (id !== undefined && claim(ctx, 'kind', id, join(path, 'id'))) ctx.index.kind.set(id, out);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Вхідна точка                                                       */
/* ------------------------------------------------------------------ */

const VALIDATED = new WeakSet();

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** Розбір тексту файлу каталогу: розмір обмежено, BOM знімається, помилка JSON без подробиць. */
export function parseCatalogText(text) {
  if (typeof text !== 'string') return { value: null, error: { code: 'not_text', message: 'Очікується текст файлу каталогу.' } };
  if (text.length > LIMITS.maxBytes || new TextEncoder().encode(text).length > LIMITS.maxBytes) {
    return { value: null, error: { code: 'too_large', message: `Файл каталогу більший за ${LIMITS.maxBytes / 1024} КіБ.` } };
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return { value: JSON.parse(body), error: null };
  } catch {
    return { value: null, error: { code: 'invalid_json', message: 'Файл не є коректним JSON.' } };
  }
}

function checkBase(base, layer) {
  if (!Array.isArray(base)) throw new TypeError('base має бути масивом перевірених каталогів');
  for (const doc of base) {
    if (!doc || !VALIDATED.has(doc)) throw new TypeError('base приймає лише результат validateCatalog().catalog');
    if (LAYERS.indexOf(doc.layer) > LAYERS.indexOf(layer)) {
      throw new TypeError('base містить каталог вищого шару, ніж той, що перевіряється');
    }
  }
}

/**
 * Перевіряє каталог. input — об’єкт або текст JSON. base — уже перевірені каталоги нижчих шарів
 * (результат validateCatalog().catalog): на їхні стовпці, списки, плитки й блоки можна посилатися.
 * Ідентифікатори не повторюються між шарами: власний варіант вбудованого елемента — це новий id
 * із «based_on», а не перевизначення.
 * Повертає { ok, errors: [{ path, code, message }], truncated, catalog }.
 */
export function validateCatalog(input, { base = [] } = {}) {
  let value = input;
  if (typeof input === 'string') {
    const parsed = parseCatalogText(input);
    if (parsed.error) return { ok: false, errors: [{ path: '', ...parsed.error }], truncated: false, catalog: null };
    value = parsed.value;
  }

  const rawLayer = isPlainObject(value) && typeof value.layer === 'string' ? value.layer : null;
  checkBase(base, LAYERS.includes(rawLayer) ? rawLayer : LAYERS[LAYERS.length - 1]);
  const ctx = makeContext(base);

  const root = obj(ctx, value, '', {
    req: ['format', 'version', 'id', 'title', 'layer'],
    opt: ['lists', 'columns', 'tiles', 'blocks', 'kinds'],
  });
  if (!root) return { ok: false, errors: ctx.errors, truncated: ctx.truncated, catalog: null };

  if (Object.hasOwn(root, 'format') && root.format !== CATALOG_FORMAT) ctx.err('format', 'bad_format', `Очікується format «${CATALOG_FORMAT}».`);
  if (Object.hasOwn(root, 'version')) {
    if (!Number.isInteger(root.version) || root.version < 1) ctx.err('version', 'bad_version', 'Версія — додатне ціле число.');
    else if (root.version > CATALOG_VERSION) ctx.err('version', 'unsupported_version', 'Каталог створено новішою версією застосунку.');
    else if (root.version !== CATALOG_VERSION) ctx.err('version', 'bad_version', 'Непідтримувана версія формату.');
  }
  const id = ident(ctx, root.id, 'id', 'cat');
  const title = str(ctx, root.title, 'title', LIMITS.titleLength);
  const layer = Object.hasOwn(root, 'layer') ? oneOf(ctx, root.layer, 'layer', LAYERS) : undefined;

  const section = (key, max, validate) => {
    if (!Object.hasOwn(root, key)) return [];
    const items = arr(ctx, root[key], key, 0, max);
    return (items || []).map((item, i) => validate(ctx, item, `${key}[${i}]`));
  };
  const lists = section('lists', LIMITS.maxLists, validateList);
  const columns = section('columns', LIMITS.maxColumns, validateColumn);
  const tiles = section('tiles', LIMITS.maxTiles, validateTile);
  const blocks = section('blocks', LIMITS.maxBlocks, validateBlock);
  for (const check of ctx.deferred) check();
  const kinds = section('kinds', LIMITS.maxKinds, validateKind);

  if (ctx.errors.length) return { ok: false, errors: ctx.errors, truncated: ctx.truncated, catalog: null };
  const catalog = deepFreeze({ format: CATALOG_FORMAT, version: CATALOG_VERSION, id, title, layer, lists, columns, tiles, blocks, kinds });
  VALIDATED.add(catalog);
  return { ok: true, errors: [], truncated: false, catalog };
}
