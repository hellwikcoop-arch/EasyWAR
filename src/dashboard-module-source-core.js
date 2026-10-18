// Підтягування даних з таблиці XLSX під час створення модуля: чиста логіка без DOM і Tauri.
//
// Rust віддає аркуш «як є» (src-tauri/src/module_source.rs): текст, число, так/ні, час доби
// «ГГ:ХХ», тривалість «Г:ХХ» або дату. Тут заголовки зіставляються з полями шаблону, а значення
// розбираються тими самими правилами, що й форма запису (`parseFieldInput`). Нічого не
// вгадується: неоднозначне значення (наприклад, «0,3» у висоті без одиниці) не підтягується,
// а потрапляє в попередження. Файл таблиці лише читається — він не змінюється.

import {
  FieldValueError,
  fieldKind,
  fieldSections,
  formatFieldValue,
  parseDuration,
  parseFieldInput,
  parseHeight,
  pluralForm,
  rowCountLabel,
  rowRuleProblem,
} from './dashboard-module-catalog-core.js';

/** Скільки записів можна підтягнути за раз; збігається з межею запису модуля в Rust. */
export const MAX_IMPORT_ROWS = 10_000;
/** Перші непорожні рядки аркуша, серед яких шукається рядок заголовків (стільки віддає Rust). */
const HEADER_SCAN_ROWS = 25;
/** Рядок вважається заголовком, якщо в ньому впізнано щонайменше стільки полів. */
const MIN_HEADER_MATCHES = 2;
const MAX_TEXT = 4096;
/** Густина палива, кг/л: у клітинці з двома числами більше — літри. */
const DENSITY_RATIO = { min: 0.7, max: 0.9 };

// ---------------------------------------------------------------------------------------------
// Заголовки

/** Латинські літери, схожі на кириличні: «ПC» з латинською C читається як «ПС». */
const LATIN_LOOKALIKES = new Map(Object.entries({
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'і', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
}));
const foldLatin = word => (/[Ѐ-ӿ]/u.test(word)
  ? word.replace(/[a-z]/gu, letter => LATIN_LOOKALIKES.get(letter) ?? letter)
  : word);

/**
 * Заголовок для порівняння: малі літери, без розділових знаків і переносів рядка, «№» як
 * «номер», латинські двійники кирилиці замінено. «День/Ніч» → «день ніч».
 */
export function normalizeHeader(value) {
  if (typeof value !== 'string') return '';
  return value
    .toLocaleLowerCase('uk')
    .replace(/№/gu, ' номер ')
    .replace(/['’ʼ`´]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(foldLatin)
    .join(' ');
}

/** Одиниці в кінці підпису колонки: «Висота польоту, м», «Наліт, год:хв», «Хмарність, 0–10». */
const UNIT_TAILS = [['м'], ['км'], ['л'], ['кг'], ['шт'], ['год', 'хв'], ['0', '10'], ['m'], ['km'], ['kg'], ['l']];

function stripUnitTail(text) {
  const words = text.split(' ');
  for (const tail of UNIT_TAILS) {
    const start = words.length - tail.length;
    if (start > 0 && tail.every((word, index) => words[start + index] === word)) return words.slice(0, start).join(' ');
  }
  return text;
}

/**
 * Варіанти заголовка від точного до спрощеного: повний, без одиниці в кінці, без дужок, без
 * дужок і одиниці. Порядок важливий: «Наліт (загальний), год:хв» спершу дає «наліт загальний»,
 * а не «наліт».
 */
export function headerCandidates(value) {
  if (typeof value !== 'string') return [];
  const full = normalizeHeader(value);
  if (!full) return [];
  const list = [full];
  const add = candidate => { if (candidate && !list.includes(candidate)) list.push(candidate); };
  add(stripUnitTail(full));
  const withoutParens = normalizeHeader(value.replace(/\([^)]*\)/gu, ' '));
  add(withoutParens);
  add(stripUnitTail(withoutParens));
  return list;
}

// ---------------------------------------------------------------------------------------------
// Назви колонок таблиці власника (зіставлення з документації «Таблиця власника») та загальні назви

const FLIGHT_ALIASES = {
  list_number: ['№', '№ з/п', 'номер з/п', 'номер п/п', 'з/п', 'п/п', 'номер за списком'],
  flight_shift_number: ['льотна зміна', 'номер льотної зміни', 'номер л/з', 'л/з'],
  aircraft_type: ['тип пс', 'тип повітряного судна', 'тип літака', 'тип літака вертольота'],
  aircraft_number: ['номер пс', '№ пс', 'бортовий номер', 'борт', 'номер борту'],
  crew_ke_callsign: ['позивний', 'позивний командира', 'позивний командира екіпажу', 'позивний ке'],
  day_night: ['день/ніч', 'д/н'],
  training_program_fuel: [
    'програма по якій виділяють паливо', 'програма підготовки', 'програма підготовки паливо',
    'програма', 'програма виділення палива',
  ],
  flight_count: ['кількість польотів', 'к-сть польотів', 'польотів'],
  engine_test_time: ['запуск проба', 'запуск/проба', 'запуск пробою'],
  takeoff_time: ['зліт', 'зльот', 'час зльоту', 'час зліту'],
  landing_time: ['посадка', 'час посадки'],
  airborne_hours: ['наліт', 'наліт повітря', 'наліт у повітрі', 'наліт в повітрі', 'час у повітрі'],
  total_hours: ['наліт загальний', 'загальний наліт', 'наліт заг', 'наліт всього'],
  flight_altitude: ['висота', 'висота польоту'],
  combat_application_grade: ['оцінка за бойове застосування', 'оцінка бойового застосування', 'оцінка за бз'],
  flight_grade: ['оцінка за політ', 'оцінка польоту'],
  cloud_base_upper: ['вмх', 'верхня межа хмар', 'верхня межа', 'верхня межа хмарності'],
  cloud_base_lower: ['нмх', 'нижня межа хмар', 'нижня межа', 'нижня межа хмарності'],
  cloud_cover: ['хмарність', 'бали хмарності'],
  visibility: ['видимість'],
  instrument_meteorological_conditions: ['пму/сму', 'сму/пму', 'сму', 'пму', 'політ у сму'],
  time_in_clouds: ['наліт у хмарах', 'наліт в хмарах', 'час у хмарах', 'у хмарах'],
  hood_time: ['наліт під шторкою', 'час під шторкою', 'під шторкою', 'шторка'],
  fuel_consumption: ['витрата палива', 'паливо', 'витрата пального', 'пальне'],
  crew_ke: ['командир екіпажу', 'командир', 'ке', 'екіпаж ке'],
  crew_lsh: ['льотчик штурман', 'льотчик-штурман', 'лш', 'екіпаж лш'],
  crew_bt: ['бортовий технік', 'бт', 'екіпаж бт'],
  crew_other: ['інший екіпаж', 'інші члени екіпажу', 'екіпаж інші', 'інші'],
  passengers: ['пасажири', 'кількість пасажирів', 'пасажирів'],
  cargo_kg: ['вантаж', 'вантаж кг'],
  rsp_approaches: ['заходів рсп', 'заходи рсп', 'кількість заходів рсп'],
  rsp_landings: ['посадок рсп', 'посадки рсп', 'кількість посадок рсп'],
};

/** Назви для решти шаблонів каталогу: підпис поля завжди впізнається й сам, це лише синоніми. */
const GENERIC_ALIASES = {
  label: ['показник', 'назва', 'найменування', 'подія'],
  value: ['значення', 'величина', 'кількість'],
  delta: ['зміна', 'динаміка'],
  unit: ['одиниця', 'одиниця виміру'],
  period: ['період', 'дата'],
  series: ['ряд', 'серія'],
  category: ['категорія', 'назва', 'найменування'],
  primary_value: ['основне значення', 'основне'],
  secondary_value: ['порівняльне значення', 'порівняльне'],
  current_value: ['поточне значення', 'поточне', 'факт'],
  target_value: ['цільове значення', 'ціль', 'план'],
  ring_order: ['порядок'],
  axis: ['вісь', 'параметр'],
  minimum: ['мінімум', 'мін'],
  maximum: ['максимум', 'макс'],
  date: ['дата', 'день'],
  status: ['стан', 'статус'],
  note: ['примітка', 'примітки', 'коментар'],
  stage: ['етап', 'стадія'],
  stage_order: ['порядок', 'номер етапу', 'порядок етапу'],
  latitude: ['широта', 'lat', 'latitude'],
  longitude: ['довгота', 'lon', 'lng', 'longitude'],
  cohort: ['когорта'],
  occurred_at: ['час події', 'час', 'дата і час', 'дата та час'],
  positive_value: ['верхнє значення', 'позитивне значення'],
  negative_value: ['нижнє значення', 'негативне значення'],
};

/**
 * Повторювані колонки з однією назвою: перша — перше поле, друга — друге… Так «Вправа» ×3
 * у таблиці власника лягає на три поля номера вправи в порядку КБП → №1 → №2.
 */
const GROUPS = [{
  id: 'exercise',
  keys: ['combat_training_exercise_number', 'complex_exercise_number_1', 'complex_exercise_number_2'],
  aliases: ['вправа', 'вправи', 'номер вправи'],
  prefixes: ['вправа'],
}];

/** Одна клітинка таблиці на кілька полів: «Метеоумови» = хмарність, НМХ, ВМХ, видимість. */
const COMBINED = [{
  id: 'weather',
  keys: ['cloud_cover', 'cloud_base_lower', 'cloud_base_upper', 'visibility'],
  aliases: ['метеоумови', 'метеодані', 'метео', 'погода', 'погодні умови'],
  prefixes: ['метеоумови', 'метеодані', 'метео', 'погода', 'погодні умови'],
}];

/** Поля, у які лягає кілька колонок таблиці («Інший екіпаж» ×6 → прізвища через кому). */
const MULTI = [{ key: 'crew_other', prefixes: ['інший екіпаж', 'інші члени екіпажу'] }];

const profiles = new WeakMap();

/** Таблиця назв для набору полів шаблону. Назви, що збігаються у двох полів, перелічено в `collisions`. */
export function sourceProfile(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const cached = profiles.get(list);
  if (cached) return cached;
  const keys = new Set(list.map(field => field.key));
  const aliasToKey = new Map();
  const collisions = [];
  const addAlias = (alias, key) => {
    const normal = normalizeHeader(alias);
    if (!normal) return;
    const owner = aliasToKey.get(normal);
    if (owner && owner !== key) collisions.push({ alias: normal, keys: [owner, key] });
    else aliasToKey.set(normal, key);
  };
  // Спершу підписи самих полів (таблицю могли вивантажити з модуля), потім синоніми.
  for (const field of list) headerCandidates(field.label).slice(0, 2).forEach(alias => addAlias(alias, field.key));
  for (const field of list) {
    for (const alias of [...(FLIGHT_ALIASES[field.key] ?? []), ...(GENERIC_ALIASES[field.key] ?? [])]) addAlias(alias, field.key);
  }
  const groups = GROUPS.map(group => ({ ...group, keys: group.keys.filter(key => keys.has(key)) })).filter(group => group.keys.length);
  const combined = COMBINED.map(item => ({ ...item, keys: item.keys.filter(key => keys.has(key)) })).filter(item => item.keys.length);
  const multi = new Set(MULTI.filter(item => keys.has(item.key)).map(item => item.key));
  const groupByAlias = new Map(groups.flatMap(group => group.aliases.map(alias => [normalizeHeader(alias), group])));
  const combinedByAlias = new Map(combined.flatMap(item => item.aliases.map(alias => [normalizeHeader(alias), item])));
  const prefixRules = [
    ...MULTI.filter(item => multi.has(item.key)).flatMap(item => item.prefixes.map(phrase => ({ phrase, target: { type: 'field', key: item.key } }))),
    ...groups.flatMap(group => group.prefixes.map(phrase => ({ phrase, target: { type: 'group', id: group.id } }))),
    ...combined.flatMap(item => item.prefixes.map(phrase => ({ phrase, target: { type: 'combined', id: item.id } }))),
  ].map(rule => ({ ...rule, phrase: normalizeHeader(rule.phrase) }));
  const profile = { aliasToKey, collisions, groups, combined, multi, groupByAlias, combinedByAlias, prefixRules };
  profiles.set(list, profile);
  return profile;
}

function resolveTarget(profile, candidates) {
  for (const candidate of candidates) {
    const key = profile.aliasToKey.get(candidate);
    if (key) return { type: 'field', key };
    const group = profile.groupByAlias.get(candidate);
    if (group) return { type: 'group', id: group.id };
    const combined = profile.combinedByAlias.get(candidate);
    if (combined) return { type: 'combined', id: combined.id };
  }
  const full = candidates[0];
  const rule = profile.prefixRules.find(item => full === item.phrase || full.startsWith(`${item.phrase} `));
  return rule ? rule.target : null;
}

/**
 * Зіставлення клітинок рядка заголовків із полями. Повертає:
 * `columns` — колонки з полем; `mapped` — ключ поля → індекси колонок; `weather` — колонка
 * «Метеоумови» (одна клітинка на кілька полів); `matchedKeys` — усі поля, які таблиця покриває;
 * `extras` — колонки без поля (або зайві дублікати).
 */
export function matchHeaders(profile, cells) {
  const columns = [];
  const mapped = new Map();
  const extras = [];
  let combined = null;
  (Array.isArray(cells) ? cells : []).forEach((cell, index) => {
    const candidates = headerCandidates(cell);
    if (!candidates.length) return;
    const header = String(cell).trim();
    const target = resolveTarget(profile, candidates);
    if (!target) { extras.push({ index, header, reason: '' }); return; }
    if (target.type === 'field') {
      const taken = mapped.get(target.key) ?? [];
      if (taken.length && !profile.multi.has(target.key)) { extras.push({ index, header, reason: 'дубль' }); return; }
      mapped.set(target.key, [...taken, index]);
      columns.push({ index, header, key: target.key });
    } else if (target.type === 'group') {
      const group = profile.groups.find(item => item.id === target.id);
      const key = group.keys.find(item => !mapped.has(item));
      if (!key) { extras.push({ index, header, reason: 'зайвий' }); return; }
      mapped.set(key, [index]);
      columns.push({ index, header, key, order: group.keys.indexOf(key) + 1 });
    } else if (combined) {
      extras.push({ index, header, reason: 'дубль' });
    } else {
      combined = { index, header, keys: profile.combined.find(item => item.id === target.id).keys };
    }
  });
  const matchedKeys = new Set(mapped.keys());
  // Поля, яких немає окремими колонками, беруться з клітинки «Метеоумови».
  const weatherKeys = combined ? combined.keys.filter(key => !mapped.has(key)) : [];
  weatherKeys.forEach(key => matchedKeys.add(key));
  if (combined && !weatherKeys.length) extras.push({ index: combined.index, header: combined.header, reason: 'поля вже є окремими колонками' });
  return { columns, mapped, weather: weatherKeys.length ? { ...combined, keys: weatherKeys } : null, matchedKeys, extras };
}

/** Рядок заголовків серед перших рядків аркуша: той, де впізнано найбільше полів. */
export function findHeaderRow(profile, rows) {
  let best = null;
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const matched = matchHeaders(profile, row?.cells);
    const size = matched.matchedKeys.size;
    if (size >= MIN_HEADER_MATCHES && (!best || size > best.matched.matchedKeys.size)) best = { index, row, matched };
  });
  return best;
}

/** Достатньо збігів, щоб запропонувати таблицю за замовчуванням: 5 полів або 60% шаблону. */
export function enoughMatches(total, matched) {
  return matched >= Math.min(5, Math.ceil(total * 0.6));
}

/**
 * Аркуші книги від найбільш схожого. `confident` — усі обов'язкові поля знайдено й збігів
 * достатньо, тож підтягування можна вмикати за замовчуванням.
 */
export function rankSheets(fields, workbook) {
  const list = Array.isArray(fields) ? fields : [];
  const profile = sourceProfile(list);
  const required = list.filter(field => field.required);
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  return sheets.map((sheet, order) => {
    const header = findHeaderRow(profile, sheet.sample);
    const matchedKeys = header ? header.matched.matchedKeys : new Set();
    const missingRequired = required.filter(field => !matchedKeys.has(field.key)).map(field => field.label);
    const matched = matchedKeys.size;
    return {
      name: sheet.name,
      order,
      rowCount: sheet.rowCount,
      headerNumber: header ? header.row.number : null,
      dataRows: header ? Math.max(0, (sheet.rowCount ?? 0) - header.index - 1) : 0,
      matched,
      total: list.length,
      missingRequired,
      confident: Boolean(header) && missingRequired.length === 0 && enoughMatches(list.length, matched),
    };
  }).sort((left, right) => right.matched - left.matched || left.order - right.order);
}

// ---------------------------------------------------------------------------------------------
// Значення клітинок

const ok = value => ({ value });
const EMPTY = Object.freeze({ empty: true });
const bad = reason => ({ problem: reason });

const UNIT_WORDS = '(кілометр\\p{L}*|км|km|кілограм\\p{L}*|кг|kg|метр\\p{L}*|м|m|літр\\p{L}*|л|l)';
const NUMBER_TOKEN = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${UNIT_WORDS}?(?![\\p{L}\\p{N}])`, 'giu');

function unitOf(raw) {
  if (!raw) return '';
  const unit = raw.toLowerCase();
  if (unit.startsWith('кілометр') || unit === 'км' || unit === 'km') return 'km';
  if (unit.startsWith('кілограм') || unit === 'кг' || unit === 'kg') return 'kg';
  if (unit.startsWith('метр') || unit === 'м' || unit === 'm') return 'm';
  return 'l';
}

/** Мінус перед числом: на початку, після пропуску чи дужки; «5-300» — розділювач, а не мінус. */
function isMinus(text, index) {
  const before = text[index - 1];
  if (before !== '-' && before !== '−') return false;
  const previous = text[index - 2];
  return previous === undefined || /[\s([;,/]/u.test(previous);
}

/**
 * Числа з клітинки разом з одиницею: «255л (204кг)» → [255 л, 204 кг]. `null`, якщо між числами
 * є ще якийсь текст («2 тонни», «ешелон 300»): такі клітинки не вгадуються.
 */
function numberTokens(text) {
  const tokens = [];
  let rest = '';
  let last = 0;
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    rest += text.slice(last, match.index);
    last = match.index + match[0].length;
    const amount = Number(match[1].replace(',', '.'));
    tokens.push({ amount: isMinus(text, match.index) ? -amount : amount, unit: unitOf(match[2]) });
  }
  rest += text.slice(last);
  return /[\p{L}\p{N}]/u.test(rest) ? null : tokens;
}

/** Число з числа або тексту з одним числом: «3», «1,5». Усе інше — `null`. */
function plainNumber(cell) {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;
  const text = cell.trim().replace(',', '.');
  return /^[+-]?\d+(?:\.\d+)?$/u.test(text) ? Number(text) : null;
}

/** Причина без початку «Поле «…» »: вона йде після назви поля. */
function reasonOf(error) {
  return error.message.replace(/^Поле «[^»]*»\s*/u, '').replace(/\.$/u, '');
}

/** Значення проходить ті самі межі й типи, що й у формі запису. */
function checked(field, value) {
  try {
    return ok(parseFieldInput(field, value));
  } catch (error) {
    if (error instanceof FieldValueError) return bad(reasonOf(error));
    throw error;
  }
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const DURATION_HINT = 'очікується час у форматі год:хв, наприклад 0:32';

function durationValue(field, cell) {
  // Число без формату часу (0,5) неоднозначне: це години, частка доби чи год.хв? Не вгадуємо.
  if (typeof cell !== 'string') return bad(`${DURATION_HINT}, а не число`);
  const hours = parseDuration(cell);
  return hours == null ? bad(DURATION_HINT) : ok(hours);
}

function metresFromToken(token) {
  if (token.unit === 'km') return round(token.amount * 1000, 2);
  if (token.unit === 'm' || token.unit === '') return token.amount;
  return null;
}

const HEIGHT_HINT = 'очікується висота: 300, 300 м або 0,3 км';

function heightValue(field, cell) {
  if (typeof cell === 'number') {
    if (cell > 0 && cell < 1) return bad('неоднозначно: 0,3 — це метри чи кілометри? Потрібна одиниця');
    return checked(field, cell);
  }
  if (typeof cell !== 'string') return bad('очікується висота в метрах');
  const strict = parseHeight(cell);
  if (strict != null) return checked(field, strict);
  // «0,3 км (300 м)»: одна висота двома способами. «0.3 м» поруч із «300 м» — описка в кілометрах,
  // тому значення менше метра відкидаються; різні висоти («300-400 м») не вгадуються.
  const tokens = numberTokens(cell);
  const metres = tokens ? tokens.map(metresFromToken) : [];
  if (!metres.length || metres.some(value => value == null || value < 0)) return bad(HEIGHT_HINT);
  const meaningful = metres.filter(value => value >= 1);
  if (!meaningful.length) return bad(HEIGHT_HINT);
  const [lowest, highest] = [Math.min(...meaningful), Math.max(...meaningful)];
  return highest > lowest * 1.01 ? bad('кілька різних висот') : checked(field, highest);
}

function fuelValue(field, cell) {
  if (typeof cell === 'number') return checked(field, cell);
  if (typeof cell !== 'string') return bad('очікуються літри');
  const plain = plainNumber(cell);
  if (plain != null) return checked(field, plain);
  const tokens = numberTokens(cell);
  if (!tokens?.length) return bad('очікуються літри');
  const litres = tokens.filter(token => token.unit === 'l');
  if (litres.length === 1) return checked(field, litres[0].amount);
  if (litres.length > 1) return bad('кілька значень у літрах');
  if (tokens.every(token => token.unit === 'kg')) return bad('вказано лише кілограми — потрібні літри');
  const bare = tokens.filter(token => token.unit === '');
  if (bare.length === 1 && tokens.every(token => token.unit === '' || token.unit === 'kg')) return checked(field, bare[0].amount);
  if (tokens.length === 2 && bare.length === 2) {
    // Літри й кілограми палива: кілограмів менше, їх відношення до літрів — густина (≈0,8).
    const [large, small] = tokens[0].amount >= tokens[1].amount ? tokens : [tokens[1], tokens[0]];
    const ratio = large.amount > 0 ? small.amount / large.amount : 0;
    if (ratio >= DENSITY_RATIO.min && ratio <= DENSITY_RATIO.max) return checked(field, large.amount);
  }
  return bad('не ясно, які з чисел — літри; вкажіть, наприклад, «255 л»');
}

function visibilityValue(field, cell) {
  if (typeof cell === 'number') return checked(field, cell);
  if (typeof cell !== 'string') return bad('очікується видимість у кілометрах');
  const plain = plainNumber(cell);
  if (plain != null) return checked(field, plain);
  const tokens = numberTokens(cell);
  if (tokens?.length !== 1) return bad('очікується одне число — кілометри');
  const [token] = tokens;
  if (token.unit === '' || token.unit === 'km') return checked(field, token.amount);
  if (token.unit === 'm') return checked(field, round(token.amount / 1000, 3));
  return bad('очікується видимість у кілометрах');
}

function cargoValue(field, cell) {
  if (typeof cell === 'number') return checked(field, cell);
  if (typeof cell !== 'string') return bad('очікуються кілограми');
  const plain = plainNumber(cell);
  if (plain != null) return checked(field, plain);
  const tokens = numberTokens(cell);
  if (tokens?.length === 1 && (tokens[0].unit === '' || tokens[0].unit === 'kg')) return checked(field, tokens[0].amount);
  return bad('очікуються кілограми');
}

const pad2 = number => String(number).padStart(2, '0');
const clock = (hours, minutes) => (hours <= 23 && minutes <= 59 ? ok(`${pad2(hours)}:${pad2(minutes)}`) : bad('очікується час доби, наприклад 14:25'));

/** Час доби «ГГ:ХХ». Приймає «14:25», «9:05», «14:25:30», «1425» і «14.25» (текстом). */
function timeOfDayValue(field, cell) {
  if (typeof cell === 'number') {
    return Number.isInteger(cell) && cell >= 100 && cell <= 2359 ? clock(Math.floor(cell / 100), cell % 100) : bad('очікується час доби, наприклад 14:25');
  }
  if (typeof cell !== 'string') return bad('очікується час доби, наприклад 14:25');
  const text = cell.trim();
  let match = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/u.exec(text) || /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/u.exec(text);
  if (match) return clock(Number(match[1]), Number(match[2]));
  match = /^(\d{1,2})(\d{2})$/u.exec(text);
  return match ? clock(Number(match[1]), Number(match[2])) : bad('очікується час доби, наприклад 14:25');
}

const TRUE_WORDS = new Set(['так', 'т', 'yes', 'y', 'true', '+', '1', 'сму', 'є', 'x', 'х', '✓', '✔']);
const FALSE_WORDS = new Set(['ні', 'н', 'no', 'n', 'false', '0', 'пму']);
const NO_VALUE_MARKS = new Set(['-', '–', '—']);

/** «Політ у СМУ»: «Так»/«СМУ» — так, «Ні»/«ПМУ» — ні; риска означає «немає» і лишає поле порожнім. */
function flagValue(field, cell) {
  if (typeof cell === 'boolean') return ok(cell);
  if (typeof cell === 'number') return cell === 1 ? ok(true) : cell === 0 ? ok(false) : bad('очікується «Так» або «Ні»');
  if (typeof cell !== 'string') return bad('очікується «Так» або «Ні»');
  const word = cell.trim().toLocaleLowerCase('uk');
  if (NO_VALUE_MARKS.has(word)) return EMPTY;
  if (TRUE_WORDS.has(word)) return ok(true);
  if (FALSE_WORDS.has(word)) return ok(false);
  return bad('очікується «Так» або «Ні» (СМУ чи ПМУ)');
}

function integerValue(field, cell) {
  if (typeof cell === 'boolean') return bad('очікується ціле число');
  const number = plainNumber(cell);
  if (number == null) return bad('очікується ціле число');
  if (!Number.isInteger(number)) return bad('не ціле число');
  return checked(field, number);
}

function realValue(field, cell) {
  if (typeof cell === 'boolean') return bad('очікується число');
  const number = plainNumber(cell);
  return number == null ? bad('очікується число') : checked(field, number);
}

function textValue(field, cell) {
  if (typeof cell === 'boolean') return ok(cell ? 'Так' : 'Ні');
  const text = typeof cell === 'number' ? String(cell) : typeof cell === 'string' ? cell.trim() : '';
  if (!text) return EMPTY;
  return text.length > MAX_TEXT ? bad(`понад ${MAX_TEXT} символів`) : ok(text);
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}` : null;
}

/** `{ date, time }` з тексту «2026-01-31», «2026-01-31 14:25» або «31.01.2026 14:25»; інакше `null`. */
function dateParts(text) {
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/u.exec(text);
  if (match) return { date: isoDate(Number(match[1]), Number(match[2]), Number(match[3])), time: match[4] == null ? null : `${match[4]}:${match[5]}` };
  match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/u.exec(text);
  if (match) return { date: isoDate(Number(match[3]), Number(match[2]), Number(match[1])), time: match[4] == null ? null : `${pad2(Number(match[4]))}:${match[5]}` };
  return null;
}

function dateValue(field, cell) {
  const parts = typeof cell === 'string' ? dateParts(cell.trim()) : null;
  return parts?.date ? ok(parts.date) : bad('очікується дата, наприклад 2026-01-31 або 31.01.2026');
}

function dateTimeValue(field, cell) {
  const parts = typeof cell === 'string' ? dateParts(cell.trim()) : null;
  return parts?.date ? ok(`${parts.date}T${parts.time ?? '00:00'}`) : bad('очікуються дата й час, наприклад 2026-01-31 14:25');
}

const SPECIAL = new Map([
  ['takeoff_time', timeOfDayValue],
  ['landing_time', timeOfDayValue],
  ['visibility', visibilityValue],
  ['cargo_kg', cargoValue],
]);
const BY_KIND = { duration: durationValue, height: heightValue, fuel: fuelValue };
const BY_TYPE = { boolean: flagValue, integer: integerValue, real: realValue, date: dateValue, datetime: dateTimeValue };

/**
 * Значення клітинки для поля: `{ value }`, `{ empty: true }` (клітинка порожня) або
 * `{ problem }` (значення не розібрано — поле лишається порожнім).
 */
export function convertCell(field, cell) {
  if (cell == null || (typeof cell === 'string' && !cell.trim())) return EMPTY;
  const convert = SPECIAL.get(field.key) ?? BY_KIND[fieldKind(field)] ?? BY_TYPE[field.dataType] ?? textValue;
  return convert(field, cell);
}

/** Прізвища з кількох колонок «Інший екіпаж» — одним рядком через кому. */
function joinedNames(field, cells) {
  const names = cells
    .map(cell => (typeof cell === 'string' ? cell.trim() : typeof cell === 'number' ? String(cell) : ''))
    .filter(Boolean);
  if (!names.length) return EMPTY;
  const text = names.join(', ');
  return text.length > MAX_TEXT ? bad(`понад ${MAX_TEXT} символів`) : ok(text);
}

/**
 * «Метеоумови» однією клітинкою: рівно чотири числа в порядку «хмарність, НМХ, ВМХ,
 * видимість». Висоти — метри або «0,3 км», видимість — кілометри.
 */
const WEATHER_ORDER = ['cloud_cover', 'cloud_base_lower', 'cloud_base_upper', 'visibility'];
const WEATHER_HINT = 'очікується чотири числа: хмарність, НМХ, ВМХ, видимість';

function weatherValues(cell, wanted, fieldByKey) {
  const text = typeof cell === 'string' ? cell : typeof cell === 'number' ? String(cell) : '';
  const tokens = numberTokens(text);
  if (tokens?.length !== WEATHER_ORDER.length) return { problems: [{ key: 'weather', reason: WEATHER_HINT }], values: {} };
  const values = {};
  const problems = [];
  WEATHER_ORDER.forEach((key, position) => {
    if (!wanted.includes(key)) return;
    const token = tokens[position];
    const field = fieldByKey.get(key);
    let outcome;
    if (key === 'cloud_cover') {
      outcome = token.unit === '' ? integerValue(field, token.amount) : bad('хмарність — число 0–10 без одиниці');
    } else if (key === 'visibility') {
      outcome = visibilityValue(field, `${token.amount}${token.unit === 'km' ? ' км' : token.unit === 'm' ? ' м' : ''}`);
    } else {
      const metres = metresFromToken(token);
      if (metres == null) outcome = bad('очікується висота в метрах або кілометрах');
      else if (token.unit === '' && metres > 0 && metres < 1) outcome = bad('неоднозначно: метри чи кілометри? Потрібна одиниця');
      else outcome = checked(field, metres);
    }
    if (outcome.problem) problems.push({ key, reason: outcome.problem });
    else if (outcome.value != null) values[key] = outcome.value;
  });
  return { problems, values };
}

// ---------------------------------------------------------------------------------------------
// План підтягування

const TOTALS_START = /^\s*(?:разом|всього|усього|підсумок|підсумки|загалом|итого|total)(?![\p{L}\p{N}])/iu;

/** Рядок «Разом…»/«Всього…» — підсумок, а не запис. */
function isTotalsRow(cells) {
  return cells.some(cell => typeof cell === 'string' && cell.length <= 80 && TOTALS_START.test(cell));
}

const sampleOf = cell => {
  const text = cell == null ? '' : typeof cell === 'string' ? cell.trim() : String(cell);
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
};

function readRow(row, context) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  if (isTotalsRow(cells)) return { skip: 'підсумковий рядок' };
  const { fieldByKey, orderedKeys, matched, multi } = context;
  const values = {};
  const issues = [];
  const note = (key, label, cell, reason) => issues.push({ key, label, sample: sampleOf(cell), reason });
  for (const key of orderedKeys) {
    const field = fieldByKey.get(key);
    const columns = matched.mapped.get(key);
    const outcome = multi.has(key)
      ? joinedNames(field, columns.map(index => cells[index]))
      : convertCell(field, cells[columns[0]]);
    if (outcome.problem) note(key, field.label, cells[columns[0]], outcome.problem);
    else if (outcome.value != null) values[key] = outcome.value;
  }
  const { weather } = matched;
  const weatherCell = weather ? cells[weather.index] : null;
  if (weather && weatherCell != null && String(weatherCell).trim()) {
    const result = weatherValues(weatherCell, weather.keys, fieldByKey);
    Object.assign(values, result.values);
    for (const problem of result.problems) {
      const field = fieldByKey.get(problem.key);
      note(problem.key, field ? field.label : 'Метеоумови', weatherCell, problem.reason);
    }
  }
  if (!Object.keys(values).length && !issues.length) return { skip: 'немає даних у знайдених стовпцях' };
  for (const field of context.fields) {
    if (!field.required || values[field.key] != null) continue;
    const failed = issues.find(issue => issue.key === field.key);
    // Значення пропущеного запису не імпортуються, але його метеоумови стоять у таблиці в часі:
    // `planImport` враховує їх, щоб наступні записи не взяли давнішу погоду.
    return { skip: failed ? `«${field.label}»: не вдалося розібрати` : `немає значення в «${field.label}»`, values, issues };
  }
  return { values, issues };
}

// ---------------------------------------------------------------------------------------------
// Метеоумови, протягнуті на наступні записи тієї ж льотної зміни

/** Номер льотної зміни: межі зміни визначаються лише за ним. */
const SHIFT_KEY = 'flight_shift_number';

/** Поля метеоумов шаблону — ті самі, які форма переносить у новий запис (`inheritedValues`). */
const weatherKeysOf = fields => fieldSections(fields)
  .filter(section => section.inherit)
  .flatMap(section => section.fields.map(field => field.key));

const shiftOf = values => (Number.isInteger(values[SHIFT_KEY]) ? values[SHIFT_KEY] : null);

/**
 * Метеоумови записують не в кожному польоті, а коли вони змінюються. Запис без метеоумов
 * бере їх із попереднього запису тієї самої льотної зміни, поки в таблиці не з'явиться нове
 * значення: нове завжди головніше. Погода переходить цілим набором одного запису, без домішок
 * з інших. Не протягується через кордон зміни й там, де номера зміни немає (межі не відомі);
 * через клітинку метеоумов, яку не вдалося розібрати (погода невідома); погода, що порушує
 * правила форми, теж не розмножується. Тут лише вирішується, кому що дістається, — самі записи
 * не змінюються (див. `importRows`).
 *
 * Повертає для кожного запису по порядку: `{ set }` — протягнута погода; `{ left: true }` —
 * погода в таблиці була, але протягнути її не можна (інша зміна чи немає номера); `null` — нічого.
 */
function weatherTracker(keys) {
  let donor = null;
  return (values, unreadable) => {
    const own = keys.filter(key => values[key] != null);
    if (own.length) {
      const set = Object.fromEntries(own.map(key => [key, values[key]]));
      donor = rowRuleProblem(set) ? null : { set, shift: shiftOf(values) };
      return null;
    }
    if (unreadable) donor = null;
    if (!donor) return null;
    const shift = shiftOf(values);
    return shift != null && shift === donor.shift ? { set: donor.set } : { left: true };
  };
}

function bump(map, key, entry) {
  const found = map.get(key);
  if (found) found.count += 1;
  else map.set(key, { ...entry, count: 1 });
}

/** Звідки береться поле: заголовок колонки; повторювані колонки — «Вправа (2-й стовпець)», «Інший екіпаж ×6». */
function sourceLabel(matched, key) {
  const own = matched.columns.filter(column => column.key === key);
  if (!own.length) return matched.weather.header;
  const labels = [];
  for (const column of own) {
    const repeated = matched.columns.filter(item => item.header === column.header).length;
    const label = column.order && repeated > 1
      ? `${column.header} (${column.order}-й стовпець)`
      : own.length > 1 ? `${column.header} ×${own.length}` : column.header;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(', ');
}

function describeColumns(fields, matched) {
  return {
    found: fields
      .filter(field => matched.matchedKeys.has(field.key))
      .map(field => ({ key: field.key, label: field.label, from: sourceLabel(matched, field.key) })),
    missing: fields
      .filter(field => !matched.matchedKeys.has(field.key))
      .map(field => ({ key: field.key, label: field.label, required: field.required === true })),
    extra: matched.extras.map(item => (item.reason ? `${item.header} (${item.reason})` : item.header)),
  };
}

const NO_HEADER = 'У аркуші не знайдено рядка заголовків, схожого на колонки модуля.';

/**
 * План підтягування записів з аркуша: що знайдено, чого немає, які рядки й клітинки
 * пропущено та самі записи (`rows`) у вигляді, який приймає `create_dashboard_module`.
 * Записи, у яких немає обов'язкового поля, пропускаються — модуль без них створився б з
 * помилкою. Неправильна клітинка необов'язкового поля лише лишає поле порожнім.
 */
export function planImport(fields, sheetRows) {
  const list = Array.isArray(fields) ? fields : [];
  const rows = Array.isArray(sheetRows?.rows) ? sheetRows.rows : [];
  const plan = {
    sheet: typeof sheetRows?.name === 'string' ? sheetRows.name : '',
    headerNumber: null,
    total: list.length,
    matched: 0,
    found: [],
    missing: list.map(field => ({ key: field.key, label: field.label, required: field.required === true })),
    extra: [],
    rows: [],
    rowNumbers: [],
    skipped: [],
    skippedCount: 0,
    warnings: [],
    // Рядки, які порушують правила форми (НМХ вище за ВМХ, екіпаж більший за 8). Вони не відкидаються:
    // це зауваження. `items` — по одному запису на вид порушення, зі своїм першим рядком таблиці.
    rules: { count: 0, firstNumber: null, message: '', items: [] },
    // Метеоумови, які можна протягнути на записи без них (`importRows`): `sets[i]` — набір для запису
    // `rows[i]` або null; `possible` — скільки записів його отримають, `unresolved` — скільком не можна.
    carry: { keys: [], possible: 0, firstNumber: null, unresolved: 0, unresolvedFirst: null, sets: [] },
    truncated: false,
    blocked: '',
    firstRecord: [],
  };
  const profile = sourceProfile(list);
  const header = findHeaderRow(profile, rows.slice(0, HEADER_SCAN_ROWS));
  if (!header) return { ...plan, blocked: NO_HEADER };
  const { matched } = header;
  Object.assign(plan, describeColumns(list, matched), { headerNumber: header.row.number, matched: matched.matchedKeys.size });
  const lacking = list.filter(field => field.required && !matched.matchedKeys.has(field.key));
  if (lacking.length) {
    plan.blocked = `У таблиці немає обов'язкових стовпців: ${lacking.map(field => field.label).join(', ')}.`;
    return plan;
  }
  const context = {
    fields: list,
    fieldByKey: new Map(list.map(field => [field.key, field])),
    orderedKeys: list.map(field => field.key).filter(key => matched.mapped.has(key)),
    multi: profile.multi,
    matched,
  };
  const reasons = new Map();
  const problems = new Map();
  const ruleKinds = new Map();
  const { carry } = plan;
  carry.keys = weatherKeysOf(list);
  const track = weatherTracker(carry.keys);
  const weatherUnreadable = issues => issues.some(issue => issue.key === 'weather' || carry.keys.includes(issue.key));
  for (const row of rows.slice(header.index + 1)) {
    if (plan.rows.length >= MAX_IMPORT_ROWS) { plan.truncated = true; break; }
    const read = readRow(row, context);
    if (read.skip) {
      bump(reasons, read.skip, { reason: read.skip, firstNumber: row.number });
      if (read.values) track(read.values, weatherUnreadable(read.issues));
      continue;
    }
    plan.rows.push(read.values);
    plan.rowNumbers.push(row.number);
    const carried = track(read.values, weatherUnreadable(read.issues));
    carry.sets.push(carried?.set ?? null);
    if (carried?.set) {
      carry.possible += 1;
      carry.firstNumber ??= row.number;
    } else if (carried?.left) {
      carry.unresolved += 1;
      carry.unresolvedFirst ??= row.number;
    }
    for (const issue of read.issues) bump(problems, issue.key, { ...issue, firstNumber: row.number });
    const rule = rowRuleProblem(read.values);
    if (rule) {
      plan.rules.count += 1;
      if (plan.rules.firstNumber == null) Object.assign(plan.rules, { firstNumber: row.number, message: rule.message });
      bump(ruleKinds, rule.fieldKey || rule.message, { message: rule.message, firstNumber: row.number });
    }
  }
  plan.rules.items = [...ruleKinds.values()];
  plan.truncated ||= sheetRows?.truncated === true;
  plan.skipped = [...reasons.values()].sort((left, right) => right.count - left.count);
  plan.skippedCount = plan.skipped.reduce((sum, item) => sum + item.count, 0);
  const order = new Map(list.map((field, index) => [field.key, index]));
  plan.warnings = [...problems.values()].sort((left, right) => (order.get(left.key) ?? 1e6) - (order.get(right.key) ?? 1e6));
  const first = plan.rows[0];
  plan.firstRecord = first
    ? list.filter(field => first[field.key] != null).map(field => ({ label: field.label, text: formatFieldValue(field, first[field.key]) }))
    : [];
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Підписи для інтерфейсу

const LIST_LIMIT = 8;

function listed(items) {
  return items.length > LIST_LIMIT
    ? `${items.slice(0, LIST_LIMIT).join(', ')} та ще ${items.length - LIST_LIMIT}`
    : items.join(', ');
}

const rowsWord = count => `${count} ${pluralForm(count, 'рядок', 'рядки', 'рядків')}`;
// Після «до»: «до 1 рядка», «до 2 рядків», «до 5 рядків», «до 21 рядка».
const rowsGenitive = count => `${count} ${pluralForm(count, 'рядка', 'рядків', 'рядків')}`;
const cellsWord = count => `${count} ${pluralForm(count, 'клітинку', 'клітинки', 'клітинок')}`;
// Де шукати в таблиці: «рядок 7» для одного запису, «перший — рядок 7» для кількох.
const whereWord = (count, number) => (count > 1 ? `перший — рядок ${number}` : `рядок ${number}`);

/**
 * Записи для створення модуля. `carryWeather` — протягнути метеоумови на записи тієї ж льотної зміни,
 * де їх не вказано (`plan.carry`); нове значення з таблиці ніколи не перекривається. Без протягування
 * записи такі, як у таблиці.
 */
export function importRows(plan, { carryWeather = true } = {}) {
  const { sets, possible } = plan.carry;
  if (!carryWeather || !possible) return plan.rows;
  return plan.rows.map((row, index) => (sets[index] ? { ...sets[index], ...row } : row));
}

/** Підписи плану для вікна створення. Порожній рядок — нічого показувати. */
export function describePlan(plan) {
  const importable = plan.rows.length;
  const notes = {
    summary: importable ? `Буде підтягнуто ${rowCountLabel(importable)}.` : 'Записів для підтягування немає.',
    columns: `Знайдено стовпців: ${plan.matched} з ${plan.total}.`,
    blocked: plan.blocked,
    missing: '',
    extra: '',
    skipped: '',
    warnings: [],
    // Метеоумови: підпис прапорця «протягнути», пояснення під ним і причина, чому не скрізь вдалося.
    carryLabel: '',
    carry: '',
    carryUnresolved: '',
    truncated: '',
  };
  if (plan.missing.length && plan.matched) {
    notes.missing = `Нові стовпці модуля — у вашій таблиці їх немає: ${listed(plan.missing.map(item => item.label))}. Дані в них вноситимуться вручну.`;
  }
  if (plan.extra.length) notes.extra = `Не використано стовпців таблиці: ${listed(plan.extra)}.`;
  if (plan.skippedCount) {
    notes.skipped = `Пропущено ${rowsWord(plan.skippedCount)}: ${plan.skipped.map(item => `${item.reason} — ${item.count}`).join('; ')}.`;
  }
  notes.warnings = plan.warnings.map(item => (
    `«${item.label}»: не розібрано ${cellsWord(item.count)} (рядок ${item.firstNumber}: «${item.sample}» — ${item.reason}).`
  ));
  for (const item of plan.rules.items) {
    notes.warnings.push(`Зауваження до ${rowsGenitive(item.count)} (${whereWord(item.count, item.firstNumber)}): ${item.message}`);
  }
  const { carry } = plan;
  if (carry.possible) {
    notes.carryLabel = `Протягнути метеоумови на ${rowCountLabel(carry.possible)} тієї ж льотної зміни, де їх не вказано`;
    notes.carry = `Береться значення з попереднього запису тієї ж льотної зміни, поки в таблиці не з'явиться нове (${whereWord(carry.possible, carry.firstNumber)}).`;
  }
  if (carry.unresolved) {
    notes.carryUnresolved = `Не вдалося протягнути метеоумови на ${rowCountLabel(carry.unresolved)} (${whereWord(carry.unresolved, carry.unresolvedFirst)}): `
      + 'почалася нова льотна зміна без метеоумов або в таблиці не вказано номер зміни. Метеополя там лишаться порожніми.';
  }
  if (plan.truncated) notes.truncated = `У таблиці більше ${MAX_IMPORT_ROWS} рядків: підтягнуто перші ${MAX_IMPORT_ROWS} записів.`;
  return notes;
}

/** Підпис аркуша у списку вибору: «Журнал · знайдено стовпців: 34 з 35 · 128 рядків». */
export function sheetOptionLabel(candidate) {
  return `${candidate.name} · знайдено стовпців: ${candidate.matched} з ${candidate.total} · ${rowsWord(candidate.dataRows ?? 0)}`;
}

export const dashboardModuleSourceCore = {
  MAX_IMPORT_ROWS,
  normalizeHeader,
  headerCandidates,
  sourceProfile,
  matchHeaders,
  findHeaderRow,
  enoughMatches,
  rankSheets,
  convertCell,
  planImport,
  importRows,
  describePlan,
  sheetOptionLabel,
};
