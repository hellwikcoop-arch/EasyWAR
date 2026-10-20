const BRANCHES = new Set(['air', 'rocket', 'pvk', 'dshv']);
const VISUAL_KINDS = new Set([
  'kpi', 'line', 'area', 'columns', 'horizontal-bar', 'grouped-columns', 'donut',
  'radial-progress', 'multi-ring', 'radar', 'gauge', 'progress-bars', 'calendar',
  'table', 'funnel', 'map', 'cohort', 'activity', 'waveform',
  'combo', 'stacked-columns', 'diverging-bars', 'leaderboard', 'weather',
]);
const FIELD_TYPES = new Set(['text', 'integer', 'real', 'date', 'datetime', 'boolean']);
const FIELD_ROLES = new Set(['dimension', 'metric', 'label', 'series', 'status', 'latitude', 'longitude', 'order', 'note']);

const text = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const safeKey = value => /^[a-z][a-z0-9_]{0,63}$/.test(value || '') ? value : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function branchFromLocation(pathname = '', search = '') {
  const command = new URLSearchParams(search).get('command');
  if (command === 'pvk' || command === 'dshv') return command;
  return /rocket\.html$/i.test(pathname) ? 'rocket' : 'air';
}

export function normalizeField(source) {
  const key = safeKey(source?.key);
  const label = text(source?.label, 80);
  const dataType = FIELD_TYPES.has(source?.dataType) ? source.dataType : '';
  const role = FIELD_ROLES.has(source?.role) ? source.role : '';
  const aggregation = text(source?.aggregation, 16);
  if (!key || !label || !dataType || !role || !aggregation) return null;
  return { key, label, dataType, role, aggregation, required: source?.required === true, position: Number.isInteger(source?.position) ? source.position : null };
}

export function normalizeCatalog(source) {
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  return source.slice(0, 64).flatMap(item => {
    const rawId = typeof item?.id === 'string' ? item.id : '';
    const id = safeKey(rawId.replaceAll('-', '_')) ? text(rawId, 64) : '';
    const title = text(item?.title, 80);
    const category = text(item?.category, 40);
    const description = text(item?.description, 240);
    const visualKind = VISUAL_KINDS.has(item?.visualKind) ? item.visualKind : '';
    const fields = Array.isArray(item?.fields) ? item.fields.map(normalizeField).filter(Boolean) : [];
    if (!id || seen.has(id) || !title || !category || !visualKind || !fields.length) return [];
    seen.add(id);
    return [{ id, title, category, description, visualKind, defaultSpan: item?.defaultSpan === 2 ? 2 : 1, fields }];
  });
}

/**
 * Типову назву шаблону «flight-hours» замінено на «Журнал хронометражу польотів». Модуль, створений
 * зі старою типовою назвою, показує нову; збережена назва в базі не переписується, змінюється лише підпис.
 * Назву, яку користувач змінив сам, не чіпаємо.
 */
const RENAMED_DEFAULT_TITLES = new Map([
  ['flight-hours', { from: 'Загальний наліт за типом ПС', to: 'Журнал хронометражу польотів' }],
]);

export function moduleTitle(templateId, title) {
  const renamed = RENAMED_DEFAULT_TITLES.get(templateId);
  return renamed && renamed.from === title ? renamed.to : title;
}

export function normalizeModules(source) {
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  return source.slice(0, 64).flatMap(item => {
    const id = text(item?.id, 64);
    const branch = BRANCHES.has(item?.branch) ? item.branch : '';
    const visualKind = VISUAL_KINDS.has(item?.visualKind) ? item.visualKind : '';
    const title = moduleTitle(item?.templateId, text(item?.title, 80));
    const table = /^dashboard_data_[0-9a-f]{24}$/.test(item?.storageTable || '') ? item.storageTable : '';
    const fields = Array.isArray(item?.fields) ? item.fields.map(normalizeField).filter(Boolean) : [];
    if (!id || seen.has(id) || !branch || !visualKind || !title || !table || !fields.length) return [];
    seen.add(id);
    return [{ ...item, id, branch, visualKind, title, storageTable: table, fields, rowCount: Math.max(0, Number(item.rowCount) || 0) }];
  });
}

export function schemaSummary(fields) {
  return (Array.isArray(fields) ? fields : []).map(field => `${field.label} · ${field.dataType}`).join('  |  ');
}

export function matchesCatalogItem(item, query) {
  const needle = text(query, 80).toLocaleLowerCase('uk');
  if (!needle) return true;
  return [item?.title, item?.category, item?.description, ...(item?.fields || []).map(field => field.label)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('uk')
    .includes(needle);
}

export function formatValue(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Так' : 'Ні';
  if (finite(value)) return new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value);
  return String(value);
}

/**
 * Форма слова за числом: 1 запис, 2–4 записи, 0 і 5+ записів; 11–14 — завжди «записів»,
 * а 21 — знову «запис».
 */
export function pluralForm(count, one, few, many) {
  const n = Math.abs(Math.trunc(Number(count) || 0));
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo > 10 && lastTwo < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Підпис кількості записів таблиці: «1 запис», «2 записи», «5 записів». */
export function rowCountLabel(count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  return `${n} ${pluralForm(n, 'запис', 'записи', 'записів')}`;
}

/**
 * Питання перед видаленням модуля з дашборда: назва, що саме зникне разом із ним
 * (локальна таблиця з записами), і що дію не скасувати.
 */
export function deleteModulePrompt(module) {
  const title = String(module?.title || '').trim() || 'без назви';
  const count = Math.max(0, Math.trunc(Number(module?.rowCount) || 0));
  const data = count ? `його таблицю з ${count} ${pluralForm(count, 'записом', 'записами', 'записами')}` : 'його порожню таблицю';
  return `Видалити модуль «${title}» і ${data}? Дію не можна скасувати.`;
}

/** Підпис кількості колонок таблиці: «1 колонка», «3 колонки», «34 колонки», «35 колонок». */
export function columnCountLabel(count) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  return `${n} ${pluralForm(n, 'колонка', 'колонки', 'колонок')}`;
}

/** Густина авіаційного палива, кг/л. Кілограми лише розраховуються з літрів: у базі їх немає. */
export const FUEL_DENSITY_KG_PER_L = 0.8;

/**
 * Поля журналу польотів із власним форматом введення й показу. Ключі — з вбудованого
 * каталогу Rust. У базі всі вони лишаються числами: тривалість — десятковими годинами,
 * висота (польоту, нижньої й верхньої межі хмар) — метрами, паливо — літрами, тому
 * схема й міграції не змінюються.
 */
const MEASURED_FIELDS = new Map([
  ['airborne_hours', 'duration'],
  ['total_hours', 'duration'],
  ['engine_test_time', 'duration'],
  ['time_in_clouds', 'duration'],
  ['hood_time', 'duration'],
  ['flight_altitude', 'height'],
  ['cloud_base_upper', 'height'],
  ['cloud_base_lower', 'height'],
  ['fuel_consumption', 'fuel'],
]);
const DURATION_PATTERN = /^(\d{1,4}):([0-5]\d)$/;
const HEIGHT_PATTERN = /^(\d+(?:[.,]\d+)?)\s*(км|km|м|m)?$/iu;
const kilogramsFormat = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

/**
 * Допустимі межі числових полів. Хмарність — за 10-бальною шкалою; видимість, витрата
 * палива, вантаж, пасажири й заходи/посадки за РСП не бувають від'ємними. Межі
 * перевіряє лише форма: Rust приймає значення як є, щоб старий запис із
 * «неправильним» числом не блокував збереження всієї таблиці.
 */
const FIELD_LIMITS = new Map([
  ['cloud_cover', { min: 0, max: 10 }],
  ['visibility', { min: 0 }],
  ['fuel_consumption', { min: 0 }],
  ['cargo_kg', { min: 0 }],
  ['passengers', { min: 0 }],
  ['rsp_approaches', { min: 0 }],
  ['rsp_landings', { min: 0 }],
]);

/** `'duration'` | `'height'` | `'fuel'` для полів із власним форматом, інакше `null`. */
export function fieldKind(field) {
  return field?.dataType === 'real' ? MEASURED_FIELDS.get(field.key) ?? null : null;
}

/** `{ min?, max? }` для числового поля з межами, інакше `null`. */
export function fieldLimits(field) {
  return field?.dataType === 'integer' || field?.dataType === 'real'
    ? FIELD_LIMITS.get(field.key) ?? null
    : null;
}

/** Чи лежить збережене значення поза межами поля (старий запис до введення меж). */
export function outsideLimits(field, value) {
  const limits = fieldLimits(field);
  if (!limits || !finite(value)) return false;
  return (limits.min != null && value < limits.min) || (limits.max != null && value > limits.max);
}

/**
 * «1:25» → 1,4166… год. Хвилини завжди двоцифрові, щоб «1:5» не читалося двояко;
 * десятковий запис («1,5», «1.30») тут свідомо не приймається — його легко сплутати
 * з годинами й хвилинами. Будь-що інше — `null`.
 */
export function parseDuration(raw) {
  const match = DURATION_PATTERN.exec(typeof raw === 'string' ? raw.trim() : '');
  return match ? (Number(match[1]) * 60 + Number(match[2])) / 60 : null;
}

/** Десяткові години → «год:хв», округлено до хвилини. */
export function formatDuration(hours) {
  if (!finite(hours) || hours < 0) return formatValue(hours);
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Висота в метрах (висота польоту, нижня й верхня межа хмар): «300» і «300 м» — метри,
 * «0,3 км» — кілометри. Дробове число менше за 1 без одиниці («0,3») неоднозначне —
 * це метри чи кілометри, — тому його не приймаємо.
 */
export function parseHeight(raw) {
  const match = HEIGHT_PATTERN.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'км' || unit === 'km') return Math.round(amount * 100_000) / 100;
  if (!unit && amount > 0 && amount < 1) return null;
  return amount;
}

export function fuelKilograms(litres) {
  return litres * FUEL_DENSITY_KG_PER_L;
}

/** «255 л (204 кг)»: літри зберігаються, кілограми розраховуються за густиною. */
export function formatFuel(litres) {
  return `${formatValue(litres)} л (${kilogramsFormat.format(fuelKilograms(litres))} кг)`;
}

/** Значення поля в таблиці: «0:32» для тривалості, «255 л (204 кг)» для палива. */
export function formatFieldValue(field, value) {
  if (!finite(value)) return formatValue(value);
  switch (fieldKind(field)) {
    case 'duration': return formatDuration(value);
    case 'fuel': return formatFuel(value);
    default: return formatValue(value);
  }
}

/** Текст, з яким поле відкривається у формі; `parseFieldInput` читає його назад без втрат. */
export function fieldInputText(field, value) {
  if (value == null) return '';
  if (field?.dataType === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
  const kind = fieldKind(field);
  if (kind === 'duration' && finite(value) && value >= 0) return formatDuration(value);
  if (kind === 'height' && finite(value) && value > 0 && value < 1) return `${value} м`;
  return String(value);
}

/** Підказки в порожніх текстових полях екіпажу. */
const TEXT_PLACEHOLDERS = new Map([
  ['crew_ke', 'прізвище'],
  ['crew_lsh', 'прізвище'],
  ['crew_bt', 'прізвище'],
  ['crew_other', 'прізвища через кому'],
]);

export function fieldPlaceholder(field) {
  switch (fieldKind(field)) {
    case 'duration': return '0:32';
    case 'height': return '300 або 0,3 км';
    case 'fuel': return 'літри';
    default: return field?.dataType === 'text' ? TEXT_PLACEHOLDERS.get(field.key) ?? '' : '';
  }
}

/** Підказка під полем під час введення: кілограми для літрів, метри для «0,3 км». */
export function fieldHint(field, rawText) {
  const raw = typeof rawText === 'string' ? rawText.trim() : '';
  if (!raw) return '';
  const kind = fieldKind(field);
  if (kind === 'fuel') {
    const litres = Number(raw.replace(',', '.'));
    return finite(litres) && litres >= 0
      ? `≈ ${kilogramsFormat.format(fuelKilograms(litres))} кг (густина ${FUEL_DENSITY_KG_PER_L.toLocaleString('uk-UA')} кг/л)`
      : '';
  }
  if (kind === 'height' && /км|km/iu.test(raw)) {
    const metres = parseHeight(raw);
    return metres == null ? '' : `= ${formatValue(metres)} м`;
  }
  return '';
}

export function fieldInputType(field) {
  if (field?.dataType === 'boolean') return 'select';
  const kind = fieldKind(field);
  if (kind === 'duration' || kind === 'height') return 'text';
  if (field?.dataType === 'integer' || field?.dataType === 'real') return 'number';
  if (field?.dataType === 'date') return 'date';
  if (field?.dataType === 'datetime') return 'datetime-local';
  if (['takeoff_time', 'landing_time'].includes(field?.key)) return 'time';
  return 'text';
}

/**
 * Помилка значення поля. `fieldKey` — поле, яке треба виправити: запис — це один
 * довгий рядок таблиці, тож редактор переносить курсор у цю клітинку, а не лишає
 * користувача шукати її серед десятків колонок за назвою в повідомленні.
 */
export class FieldValueError extends Error {
  constructor(message, fieldKey = '') {
    super(message);
    this.name = 'FieldValueError';
    this.fieldKey = typeof fieldKey === 'string' ? fieldKey : '';
  }
}

/**
 * Ширини колонок таблиці, px. Запис — один рядок із десятків полів, тому кожне поле має
 * власну ширину за змістом: час і числа вузькі, прізвища екіпажу й текст широкі.
 */
const COLUMN_WIDTHS = new Map([
  ['aircraft_number', 112],
  ['crew_ke_callsign', 128],
  ['day_night', 96],
  ['cloud_cover', 108],
  ['crew_ke', 148],
  ['crew_lsh', 148],
  ['crew_bt', 148],
  ['crew_other', 232],
]);

export function fieldColumnWidth(field) {
  const known = COLUMN_WIDTHS.get(field?.key);
  if (known) return known;
  switch (fieldKind(field)) {
    case 'duration': return 92;
    case 'height': return 132;
    case 'fuel': return 116;
    default: break;
  }
  switch (fieldInputType(field)) {
    case 'select': return 96;
    case 'number': return 92;
    case 'time': return 108;
    case 'date': return 156;
    case 'datetime-local': return 216;
    default: return 148;
  }
}

function parseMeasured(field, kind, label, raw) {
  const value = typeof raw === 'number'
    ? (finite(raw) && raw >= 0 ? raw : null)
    : kind === 'duration' ? parseDuration(raw) : parseHeight(raw);
  if (value != null) return value;
  throw new FieldValueError(kind === 'duration'
    ? `Поле «${label}» має містити час у форматі год:хв, наприклад 0:32.`
    : `Поле «${label}» має містити метри (300) або кілометри з позначкою (0,3 км).`, field?.key);
}

function limitsMessage(label, { min, max }) {
  if (min != null && max != null) return `Поле «${label}» має бути від ${min} до ${max}.`;
  if (min === 0) return `Поле «${label}» не може бути від'ємним.`;
  return min != null
    ? `Поле «${label}» не може бути меншим за ${min}.`
    : `Поле «${label}» не може бути більшим за ${max}.`;
}

function withinLimits(field, label, value) {
  if (outsideLimits(field, value)) throw new FieldValueError(limitsMessage(label, fieldLimits(field)), field?.key);
  return value;
}

export function parseFieldInput(field, rawValue) {
  const label = text(field?.label, 80) || 'Поле';
  const fail = message => new FieldValueError(message, field?.key);
  const raw = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (raw === '' || raw == null) {
    if (field?.required) throw fail(`Поле «${label}» є обов'язковим.`);
    return null;
  }
  if (field?.dataType === 'boolean') {
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    throw fail(`Поле «${label}» має містити «Так» або «Ні».`);
  }
  if (field?.dataType === 'integer') {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isSafeInteger(value)) throw fail(`Поле «${label}» має містити ціле число.`);
    return withinLimits(field, label, value);
  }
  if (field?.dataType === 'real') {
    const kind = fieldKind(field);
    if (kind === 'duration' || kind === 'height') return parseMeasured(field, kind, label, raw);
    const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(value)) throw fail(`Поле «${label}» має містити число.`);
    return withinLimits(field, label, value);
  }
  const value = String(raw);
  if (value.length > 4096) throw fail(`Поле «${label}» перевищує 4096 символів.`);
  return value;
}

/**
 * Групи полів запису. Усі поля стоять в одному рядку таблиці, а групи лише дають редактору
 * підказки. Метеоумови записують не щоразу, а раз на 5–10 записів однієї льотної зміни,
 * тому нові записи беруть їх із попереднього (`inherit`). Екіпаж: КЕ, ЛШ і БТ окремими
 * полями, решта через кому; пораду про склад (`note`) і лічильник «n з 8» показано над
 * рядком. «Політ у СМУ» — ознака самого польоту, а не погоди, тому до групи не входить.
 * Позивний командира (`crew_ke_callsign`) теж поза групами: у шаблоні він стоїть одразу
 * після номера ПС.
 */
const FIELD_GROUPS = [
  {
    id: 'meteo',
    title: 'Метеоумови',
    note: '',
    inherit: true,
    keys: ['cloud_base_upper', 'cloud_base_lower', 'cloud_cover', 'visibility'],
  },
  {
    id: 'crew',
    title: 'Екіпаж',
    note: 'Прізвища. Разом до 8 осіб: КЕ, ЛШ, БТ і до 5 інших через кому (інструктор, ПКЕ, штурман, бортмеханік, радист…). Посаду можна дописати: «інструктор Прізвище».',
    inherit: false,
    keys: ['crew_ke', 'crew_lsh', 'crew_bt', 'crew_other'],
  },
];

/**
 * Поля запису за розділами: спершу основні (без заголовка), далі групи з наявних полів.
 * Для модуля без згрупованих полів — один основний розділ.
 */
export function fieldSections(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const grouped = new Set(FIELD_GROUPS.flatMap(group => group.keys));
  const main = list.filter(field => !grouped.has(field.key));
  const sections = main.length ? [{ id: 'main', title: '', note: '', inherit: false, fields: main }] : [];
  for (const group of FIELD_GROUPS) {
    const members = list.filter(field => group.keys.includes(field.key));
    if (members.length) {
      sections.push({ id: group.id, title: group.title, note: group.note, inherit: group.inherit, fields: members });
    }
  }
  return sections;
}

/**
 * Метеоумови для нового запису: поля групи з найновішого запису, де вказано хоч одне з
 * них, — цілим набором, щоб не змішувати погоду з різних моментів. `null`, якщо
 * переносити нічого.
 */
export function inheritedValues(fields, rows) {
  const keys = fieldSections(fields).filter(section => section.inherit).flatMap(section => section.fields.map(field => field.key));
  const list = Array.isArray(rows) ? rows : [];
  if (!keys.length) return null;
  for (let rowIndex = list.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const found = keys.filter(key => list[rowIndex]?.[key] != null);
    if (found.length) return { rowIndex, values: Object.fromEntries(found.map(key => [key, list[rowIndex][key]])) };
  }
  return null;
}

/**
 * Групи колонок для фільтра над таблицею сторінки модуля. Це лише показ: запис і далі
 * редагується в одному рядку з усіма полями, а на час правки видно всі колонки. «Політ у СМУ»,
 * час у хмарах і під шторкою — ознаки польоту, тому вони в «Політ і наліт», а не в метеоумовах.
 * Поля, яких немає в жодній групі, ідуть в «Основне».
 */
const TABLE_GROUPS = [
  { id: 'main', title: 'Основне', keys: null },
  {
    id: 'flight',
    title: 'Політ і наліт',
    keys: [
      'flight_count', 'engine_test_time', 'takeoff_time', 'landing_time', 'airborne_hours', 'total_hours', 'flight_altitude',
      'instrument_meteorological_conditions', 'time_in_clouds', 'hood_time', 'rsp_approaches', 'rsp_landings',
    ],
  },
  { id: 'meteo', title: 'Метеоумови', keys: FIELD_GROUPS.find(group => group.id === 'meteo').keys },
  { id: 'crew', title: 'Екіпаж', keys: ['crew_ke_callsign', ...FIELD_GROUPS.find(group => group.id === 'crew').keys] },
  { id: 'cargo', title: 'Паливо й вантаж', keys: ['training_program_fuel', 'fuel_consumption', 'passengers', 'cargo_kg'] },
  { id: 'grades', title: 'Оцінки', keys: ['combat_application_grade', 'flight_grade'] },
];
/** Колонки, видимі в кожній групі: з ними зрозуміло, чий це рядок. */
const ANCHOR_KEYS = ['aircraft_type', 'aircraft_number'];

/**
 * Групи колонок модуля для фільтра: «Усі» й групи, у яких є поля цього модуля. Порожній
 * список — фільтр не потрібен (менше двох груп, як у модулів без журналу польотів).
 */
export function tableColumnGroups(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const present = new Set(list.map(field => field.key));
  const grouped = new Set(TABLE_GROUPS.flatMap(group => group.keys || []));
  const groups = TABLE_GROUPS
    .map(group => ({
      id: group.id,
      title: group.title,
      keys: group.keys ? group.keys.filter(key => present.has(key)) : list.map(field => field.key).filter(key => !grouped.has(key)),
    }))
    .filter(group => group.keys.length);
  if (groups.length < 2) return [];
  return [{ id: 'all', title: 'Усі', keys: list.map(field => field.key) }, ...groups];
}

/** Ключі видимих колонок для групи `groupId`; невідома група або «Усі» — усі поля. */
export function visibleColumnKeys(fields, groupId) {
  const list = Array.isArray(fields) ? fields : [];
  const all = new Set(list.map(field => field.key));
  const group = tableColumnGroups(list).find(item => item.id === groupId);
  if (!group || group.id === 'all') return all;
  const anchors = ANCHOR_KEYS.filter(key => all.has(key));
  return new Set([...(anchors.length ? anchors : list.slice(0, 1).map(field => field.key)), ...group.keys]);
}

/**
 * Чи підходить запис під пошук: кожне слово запиту має трапитися в показаному значенні якогось
 * поля або в самому значенні (так «1500» знаходить «1 500»). Регістр не важить.
 */
export function rowMatchesQuery(fields, row, query) {
  const terms = String(query ?? '').toLocaleLowerCase('uk').split(/\s+/u).filter(Boolean);
  if (!terms.length) return true;
  const list = Array.isArray(fields) ? fields : [];
  const text = list
    .filter(field => row?.[field.key] != null && row[field.key] !== '')
    .map(field => `${formatFieldValue(field, row[field.key])} ${String(row[field.key])}`)
    .join(' ')
    .toLocaleLowerCase('uk');
  return terms.every(term => text.includes(term));
}

/** Щільність таблиці: «Звичайно» (типова) або «Компактно». */
export function normalizeDensity(value) {
  return value === 'compact' ? 'compact' : 'comfortable';
}

/** Найбільший склад екіпажу з інструкторами: КЕ, ЛШ, БТ і до 5 інших. */
export const MAX_CREW = 8;
/** Поля з прізвищами. Позивний командира (`crew_ke_callsign`) — не особа, тому тут його немає. */
const CREW_KEYS = ['crew_ke', 'crew_lsh', 'crew_bt', 'crew_other'];

/** Скільки осіб записано в екіпажі: прізвища в кожному з полів рахуються за комами. */
export function crewCount(values) {
  return CREW_KEYS.reduce((sum, key) => {
    const value = values?.[key];
    return sum + (typeof value === 'string' ? value.split(/[,;]/).filter(name => name.trim()).length : 0);
  }, 0);
}

/** Підпис під полями екіпажу: «Екіпаж: 3 з 8 осіб»; порожній, поки прізвищ немає. */
export function crewSummary(values) {
  const count = crewCount(values);
  if (!count) return '';
  return count > MAX_CREW
    ? `Екіпаж: ${count} з ${MAX_CREW} осіб — забагато`
    : `Екіпаж: ${count} з ${MAX_CREW} осіб`;
}

/**
 * Правила, що зв'язують кілька полів одного запису. Повертає помилку або `null`.
 * Форма відхиляє запис із такою помилкою, а підтягування даних з таблиці лише попереджає.
 */
export function rowRuleProblem(row) {
  if (finite(row.cloud_base_lower) && finite(row.cloud_base_upper) && row.cloud_base_lower > row.cloud_base_upper) {
    return new FieldValueError('Нижня межа хмар (НМХ) не може бути вищою за верхню (ВМХ).', 'cloud_base_lower');
  }
  const crew = crewCount(row);
  if (crew > MAX_CREW) {
    // Курсор — в останнє заповнене поле екіпажу: звідти найлегше прибрати зайве прізвище.
    const last = [...CREW_KEYS].reverse().find(key => typeof row[key] === 'string' && row[key].trim());
    return new FieldValueError(`В екіпажі ${crew} осіб, а може бути не більше ${MAX_CREW}.`, last);
  }
  return null;
}

function checkRowRules(row) {
  const problem = rowRuleProblem(row);
  if (problem) throw problem;
}

/**
 * Рядок для запису з текстів форми. `original` — запис, який відкрито для правки:
 * якщо текст поля не змінено, лишається збережене значення, а не його повторне
 * перетворення (так «1,42 год» зі старого запису не округлюється до «1:25» мовчки).
 */
export function rowForWrite(fields, rawValues, original = {}) {
  const row = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    const raw = rawValues?.[field.key];
    const before = original?.[field.key];
    const value = before != null && raw === fieldInputText(field, before)
      ? before
      : parseFieldInput(field, raw);
    if (value !== null) row[field.key] = value;
  }
  checkRowRules(row);
  return row;
}

/**
 * Рядок у вигляді, який приймає `replace_dashboard_module_rows`: лише поля
 * каталогу та `rowId` — ідентифікатор запису, за яким Rust зберігає його
 * `created_at`. Службові `createdAt` і порожні значення не передаються.
 */
export function rowForStorage(fields, row) {
  const stored = {};
  if (Number.isSafeInteger(row?.rowId) && row.rowId >= 1) stored.rowId = row.rowId;
  for (const field of Array.isArray(fields) ? fields : []) {
    const value = row?.[field.key];
    if (value != null) stored[field.key] = value;
  }
  return stored;
}

/** Повний набір рядків після додавання (`rowIndex` не число) або правки запису. */
export function rowsAfterSave(fields, rows, rowIndex, edited) {
  const next = (Array.isArray(rows) ? rows : []).map(row => rowForStorage(fields, row));
  if (Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < next.length) {
    const rowId = next[rowIndex].rowId;
    next[rowIndex] = rowId == null ? edited : { ...edited, rowId };
  } else {
    next.push(edited);
  }
  return next;
}

/** Повний набір рядків без запису `rowIndex`; решта зберігає свої `rowId`. */
export function rowsAfterDelete(fields, rows, rowIndex) {
  return (Array.isArray(rows) ? rows : []).flatMap((row, index) => (
    index === rowIndex ? [] : [rowForStorage(fields, row)]
  ));
}

/**
 * Аргументи команди збереження. `expectedUpdatedAt` — позначка змін, з якою
 * таблицю відкрито: якщо її вже змінили деінде, Rust відхилить запис. Без
 * позначки запис мовчки став би «останній перемагає», тому її відсутність —
 * помилка, а не безумовне збереження.
 */
export function replaceRowsRequest(module, rows) {
  if (typeof module?.id !== 'string' || !module.id) throw new Error('Немає ідентифікатора модуля.');
  if (typeof module.updatedAt !== 'string' || !module.updatedAt) {
    throw new Error('Немає позначки версії таблиці. Закрийте вікно й відкрийте таблицю знову.');
  }
  return { moduleId: module.id, rows, expectedUpdatedAt: module.updatedAt };
}

/** Відповідь Rust «таблицю змінено в іншому вікні» (див. `DashboardModuleError::Conflict`). */
export function isConflictError(error) {
  return /змінено в іншому вікні/i.test(String(error?.message ?? error ?? ''));
}

/**
 * Чи можна змінювати таблицю. Збереження замінює весь набір рядків, тому після
 * збою читання або за межею перегляду (10 000 рядків) змінювати таблицю не
 * можна: запис стер би рядки, яких користувач не бачить.
 */
export function tableEditState(payload) {
  if (!payload || typeof payload !== 'object' || payload.failed === true) {
    return { editable: false, reason: 'Не вдалося прочитати таблицю, тому її відкрито лише для перегляду.' };
  }
  if (payload?.truncated === true) {
    return { editable: false, reason: 'Таблиця перевищує межу 10 000 рядків і відкрита лише для читання.' };
  }
  return { editable: true, reason: '' };
}

export function previewModel(module, rows) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, 10_000) : [];
  const fields = Array.isArray(module?.fields) ? module.fields : [];
  const dimensions = fields.filter(field => ['dimension', 'label', 'series', 'status'].includes(field.role));
  const isFlightHours = module?.templateId === 'flight-hours'
    || fields.some(field => field.key === 'aircraft_type')
      && fields.some(field => field.key === 'airborne_hours')
      && fields.some(field => field.key === 'total_hours');
  const metrics = isFlightHours
    ? fields.filter(field => ['airborne_hours', 'total_hours'].includes(field.key))
    : fields.filter(field => field.role === 'metric');
  const dimension = isFlightHours
    ? fields.find(field => field.key === 'aircraft_type')
    : dimensions.find(field => field.role === 'dimension' || field.role === 'label') || dimensions[0];
  const statusField = fields.find(field => field.role === 'status');
  const grouped = new Map();
  safeRows.forEach((row, index) => {
    const rawLabel = row?.[dimension?.key] ?? index + 1;
    const key = `${typeof rawLabel}:${String(rawLabel)}`;
    const group = grouped.get(key) || { label: formatValue(rawLabel), rows: [] };
    group.rows.push(row || {});
    grouped.set(key, group);
  });
  const points = [...grouped.values()].map(group => ({
    label: group.label,
    values: metrics.map(field => aggregateMetric(group.rows, field)),
    status: formatValue(group.rows.find(row => row?.[statusField?.key] != null)?.[statusField?.key]),
  }));
  const values = points.flatMap(point => point.values).filter(finite);
  const max = Math.max(0, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const first = safeRows[0] || {};
  const currentField = fields.find(field => field.key === 'current_value') || metrics[0];
  const targetField = fields.find(field => field.key === 'target_value') || fields.find(field => field.key === 'maximum') || metrics[1];
  const current = finite(first?.[currentField?.key]) ? first[currentField.key] : 0;
  const target = finite(first?.[targetField?.key]) && first[targetField.key] !== 0 ? first[targetField.key] : 0;
  return {
    kind: VISUAL_KINDS.has(module?.visualKind) ? module.visualKind : 'table',
    points,
    max,
    total,
    percent: target ? Math.max(0, Math.min(100, current / target * 100)) : 0,
    empty: safeRows.length === 0,
  };
}

function aggregateMetric(rows, field) {
  const values = rows.map(row => row?.[field.key]).filter(finite);
  switch (field.aggregation) {
    case 'count': return values.length;
    case 'average': return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    case 'minimum': return values.length ? Math.min(...values) : 0;
    case 'maximum': return values.length ? Math.max(...values) : 0;
    case 'none': return values[0] ?? 0;
    default: return values.reduce((sum, value) => sum + value, 0);
  }
}

export const dashboardModuleCore = {
  branchFromLocation,
  normalizeCatalog,
  normalizeModules,
  moduleTitle,
  schemaSummary,
  matchesCatalogItem,
  formatValue,
  pluralForm,
  rowCountLabel,
  deleteModulePrompt,
  columnCountLabel,
  fieldKind,
  fieldLimits,
  outsideLimits,
  parseDuration,
  formatDuration,
  parseHeight,
  fuelKilograms,
  formatFuel,
  formatFieldValue,
  fieldInputText,
  fieldPlaceholder,
  fieldHint,
  fieldInputType,
  fieldColumnWidth,
  fieldSections,
  inheritedValues,
  tableColumnGroups,
  visibleColumnKeys,
  rowMatchesQuery,
  normalizeDensity,
  crewCount,
  crewSummary,
  FieldValueError,
  parseFieldInput,
  rowRuleProblem,
  rowForWrite,
  rowForStorage,
  rowsAfterSave,
  rowsAfterDelete,
  replaceRowsRequest,
  isConflictError,
  tableEditState,
  previewModel,
};
