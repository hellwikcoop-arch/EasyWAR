// Бібліотека «Офісу»: чиста логіка вкладки «Бібліотека» (library.js) — виклики команд library_*
// з точними назвами й аргументами контракту IPC, вибір екрана за станом, перевірка паролів і
// параметрів джерела, створення документа з шаблону («Створити з шаблону», «Оновити з
// джерела», «Оновити всі»), довідка про поля, підписи версій і позначок. Без DOM: invoke і
// JSZip передає виклик. Перевірка — tests/library-ui.test.mjs.
import { listFields, listBlocks, buildContext, sourceKindLabel } from './field-dictionary-core.js';
import {
  KIND_LABELS, ORIGIN_LABELS, STATUS_LABELS, formatDateTime, formatSize, isLockedError, regenerationPlan, shouldMakeCurrent,
  summarizeBulk,
} from './library-core.js';
import { TEMPLATE_EXTENSIONS, fillTemplate, listTemplateFields } from './template-core.js';
import { bytesForInvoke, toBytes } from './workspace-core.js';

/**
 * Команди бібліотеки (контракт IPC: назви snake_case, аргументи camelCase). Усі виклики Tauri
 * вкладки «Бібліотека» йдуть лише звідси — tests/library-ui.test.mjs звіряє їх із контрактом.
 */
export function libraryApi(invoke) {
  return Object.freeze({
    status: () => invoke('library_status'),
    create: (password, withRecovery) => invoke('library_create', { password, withRecovery }),
    unlock: password => invoke('library_unlock', { password }),
    lock: () => invoke('library_lock'),
    list: includeHidden => invoke('library_list', { includeHidden }),
    versions: itemId => invoke('library_versions', { itemId }),
    importFile: asTemplate => invoke('library_import', { asTemplate }),
    rename: (itemId, name) => invoke('library_rename', { itemId, name }),
    setHidden: (itemId, hidden) => invoke('library_set_hidden', { itemId, hidden }),
    setCurrent: (itemId, versionId) => invoke('library_set_current', { itemId, versionId }),
    exportCopy: versionId => invoke('library_export_copy', { versionId }),
    exportArchive: () => invoke('library_export_archive'),
    openInEditor: versionId => invoke('library_open_in_editor', { versionId }),
    readVersion: versionId => invoke('library_read_version', { versionId }),
    search: (query, includeHidden = false) => invoke('library_search', { query, includeHidden }),
    sourceData: (sourceKind, params) => invoke('library_source_data', { sourceKind, params }),
    saveGenerated: ({ itemId, name, templateVersionId, sourceKind, params, fingerprint, ext, bytes, makeCurrent, expectedCurrentVersionId = null }) =>
      invoke('library_save_generated', {
        itemId, name, templateVersionId, sourceKind, params, fingerprint, ext, bytes, makeCurrent, expectedCurrentVersionId,
      }),
    linkStatuses: () => invoke('library_link_statuses'),
    unlink: itemId => invoke('library_unlink', { itemId }),
    recover: (code, newPassword) => invoke('library_recover', { code, newPassword }),
    reissueRecovery: password => invoke('library_reissue_recovery', { password }),
    dashboardModules: branch => invoke('list_dashboard_modules', { branch }),
  });
}

/** Роди військ і командування для джерела «Модуль дашборда» (як у профілі EasyWAR). */
export const BRANCHES = Object.freeze([
  Object.freeze({ id: 'air', label: 'ПС' }),
  Object.freeze({ id: 'rocket', label: 'РВ' }),
  Object.freeze({ id: 'pvk', label: 'ПВК' }),
  Object.freeze({ id: 'dshv', label: 'УДШВ' }),
]);

/** Межі пароля профілю — як у profile-gate-core.js і local_profiles.rs (ядро перевіряє ще раз). */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

const SCREENS = new Set(['no_profile', 'no_password', 'none', 'locked', 'unlocked']);

/** Екран вкладки за відповіддю library_status: стан або 'unknown' (зламана відповідь). */
export function libraryScreen(status) {
  return SCREENS.has(status?.state) ? status.state : 'unknown';
}

/**
 * Підсумок «Створити бібліотеку» (`kind` 'created') чи відновлення кодом ('recovered') за статусом
 * відповіді → { text, tone }. Якщо посеред дії профіль заблокували чи з нього вийшли, Rust усе одно
 * віддає код відновлення, але бібліотека лишається заблокованою (статус не `unlocked`).
 */
export function keyActionResult(kind, status) {
  const unlocked = libraryScreen(status) === 'unlocked';
  if (kind === 'created') {
    return unlocked
      ? { text: 'Бібліотеку створено й розблоковано.', tone: 'ok' }
      : { text: 'Бібліотеку створено, але поки вона створювалася, її заблоковано (блокування чи вихід із профілю). Розблокуйте її паролем профілю.', tone: 'error' };
  }
  return unlocked
    ? { text: 'Новий пароль профілю задано, бібліотеку розблоковано.', tone: 'ok' }
    : { text: 'Новий пароль профілю задано, але поки йшло відновлення, бібліотеку заблоковано. Розблокуйте її новим паролем профілю.', tone: 'error' };
}

/** Текст помилки з invoke (рядок Rust) або Error. */
export function errorText(error) {
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string' && error.message) return error.message;
  return String(error ?? 'невідома помилка');
}

const codePoints = text => Array.from(String(text ?? '')).length;

/** Пароль профілю для розблокування чи створення: лише непорожній (решту перевіряє Rust). */
export function passwordProblem(password) {
  return String(password ?? '') ? null : 'Введіть пароль профілю.';
}

/** Новий пароль профілю двічі (відновлення кодом): довжина й збіг. */
export function newPasswordProblem(password, repeat) {
  const length = codePoints(password);
  if (length < PASSWORD_MIN) return `Новий пароль має містити щонайменше ${PASSWORD_MIN} символів.`;
  if (length > PASSWORD_MAX) return `Новий пароль має містити не більше ${PASSWORD_MAX} символів.`;
  if (String(password) !== String(repeat ?? '')) return 'Паролі не збігаються.';
  return null;
}

/** Код відновлення: лише непорожній (формат і контрольну суму перевіряє Rust). */
export function recoveryCodeProblem(code) {
  return String(code ?? '').trim() ? null : 'Введіть код відновлення.';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Параметри джерела з полів форми → { ok, params, error }. approved_revisions: { from, to }
 * (РРРР-ММ-ДД або null — без межі); dashboard_module: { moduleId }; library_table: { itemId }.
 */
export function sourceParams(sourceKind, input = {}) {
  if (sourceKind === 'approved_revisions') {
    const from = String(input.from ?? '').trim() || null;
    const to = String(input.to ?? '').trim() || null;
    if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) return { ok: false, params: null, error: 'Дату періоду вказано неправильно.' };
    if (from && to && from > to) return { ok: false, params: null, error: 'Початок періоду пізніше за його кінець.' };
    return { ok: true, params: { from, to }, error: null };
  }
  if (sourceKind === 'dashboard_module') {
    const moduleId = String(input.moduleId ?? '').trim();
    return moduleId ? { ok: true, params: { moduleId }, error: null } : { ok: false, params: null, error: 'Оберіть модуль дашборда.' };
  }
  if (sourceKind === 'library_table') {
    const itemId = String(input.itemId ?? '').trim();
    return itemId ? { ok: true, params: { itemId }, error: null } : { ok: false, params: null, error: 'Оберіть таблицю з бібліотеки.' };
  }
  return { ok: false, params: null, error: 'Оберіть джерело даних.' };
}

const usable = item => Boolean(item && item.currentVersionId);

/** Шаблони, з яких можна створити документ: вид «Шаблон», DOCX/PPTX/XLSX, є поточна версія. */
export function templateItems(items) {
  return (Array.isArray(items) ? items : []).filter(item => usable(item) && item.kind === 'template' && TEMPLATE_EXTENSIONS.includes(item.ext));
}

/** Таблиці бібліотеки для джерела «Таблиця з бібліотеки». */
export function tableItems(items) {
  return (Array.isArray(items) ? items : []).filter(item => usable(item) && item.kind === 'table');
}

const GENERATED_EXT = Object.freeze({ document: 'docx', slides: 'pptx', table: 'xlsx' });

/**
 * Формат шаблону пов'язаного документа: вид документа задано розширенням згенерованого файлу
 * (DOCX → документ, PPTX → презентація, XLSX → таблиця) і далі не змінюється.
 */
export function templateExtForItem(item) {
  if (item && Object.hasOwn(GENERATED_EXT, item.kind)) return GENERATED_EXT[item.kind];
  return TEMPLATE_EXTENSIONS.includes(item?.ext) ? item.ext : null;
}

const pad = number => String(number).padStart(2, '0');

/** Назва нового документа: «<шаблон> — ДД.ММ.РРРР» (місцева дата), не довша за 120 символів. */
export function defaultDocumentName(templateName, now = new Date()) {
  const date = now instanceof Date && !Number.isNaN(now.getTime())
    ? `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
    : '';
  const base = String(templateName ?? '').replace(/\s+/g, ' ').trim() || 'Документ';
  const suffix = date ? ` — ${date}` : '';
  return Array.from(base).slice(0, 120 - codePoints(suffix)).join('').trim() + suffix;
}

/**
 * Довідка про поля: що дає джерело (listFields, listBlocks) і що просить шаблон
 * (listTemplateFields). → { available, blocks, fields: [{ name, known }], templateBlocks:
 * [{ name, known }], unknown: [назви], errors }. Невідоме поле в документі буде порожнім.
 */
export function fieldReport({ sourceKind, data = null, template = null }) {
  const available = listFields(sourceKind, data);
  const blocks = listBlocks(sourceKind);
  const fieldNames = new Set(available.map(field => field.name));
  const blockNames = new Set(blocks.map(block => block.name));
  const fields = (Array.isArray(template?.fields) ? template.fields : []).map(name => ({ name, known: fieldNames.has(name) }));
  const templateBlocks = (Array.isArray(template?.blocks) ? template.blocks : []).map(name => ({ name, known: blockNames.has(name) }));
  const unknown = [...templateBlocks, ...fields].filter(entry => !entry.known).map(entry => entry.name);
  return { available, blocks, fields, templateBlocks, unknown, errors: Array.isArray(template?.errors) ? [...template.errors] : [] };
}

/** Поля, блоки й помилки шаблону з його поточної версії (library_read_version → listTemplateFields). */
export async function readTemplateFields({ api, JSZip, item }) {
  const bytes = toBytes(await api.readVersion(item.currentVersionId));
  return listTemplateFields(bytes, item.ext, { JSZip });
}

/**
 * Створює документ із шаблону: байти шаблону (library_read_version) → дані джерела з відбитком
 * (library_source_data) → контекст полів → заповнений файл → library_save_generated. `itemId`
 * null — новий документ (з назвою `name`), інакше нова версія пов'язаного документа;
 * `expectedCurrentVersionId` — поточна версія, на яку спиралося рішення (Rust відмовить, якщо
 * документ тим часом змінився). → { item, version, created, missing, warnings, used }; `created`
 * — false, коли Rust не створив нової версії (дані й шаблон ті самі, повернуто наявну).
 */
export async function generateDocument({
  api, JSZip, templateVersionId, ext, sourceKind, params, name = null, itemId = null, makeCurrent = true, now = new Date(),
  expectedCurrentVersionId = null, lastGeneratedVersionId = null,
}) {
  const template = toBytes(await api.readVersion(templateVersionId));
  const source = await api.sourceData(sourceKind, params);
  const context = buildContext({ sourceKind, data: source?.data, profile: source?.profile, now });
  const filled = await fillTemplate(template, ext, context, { JSZip });
  const saved = await api.saveGenerated({
    itemId,
    name,
    templateVersionId,
    sourceKind,
    params,
    fingerprint: source?.fingerprint,
    ext,
    bytes: bytesForInvoke(filled.bytes),
    makeCurrent,
    expectedCurrentVersionId,
  });
  const version = saved?.version ?? null;
  // Rust може повернути наявну версію з тим самим вмістом замість нової (тоді її id — останньої
  // згенерованої до виклику); поле `created`, якщо воно є у відповіді, точніше.
  const created = typeof saved?.created === 'boolean'
    ? saved.created
    : Boolean(version) && (!lastGeneratedVersionId || version.id !== lastGeneratedVersionId);
  return { item: saved?.item ?? null, version, created, missing: filled.missing, warnings: filled.warnings, used: filled.used };
}

/**
 * «Оновити з джерела» для пов'язаного документа: той самий шаблон і параметри зв'язку, свіжі дані.
 * Поточною нова версія стає сама лише тоді, коли поточна не має ручних правок і не обрана вручну
 * з історії (shouldMakeCurrent, `status` — статус зв'язку); інакше вона лягає в історію
 * (madeCurrent: false), а вибір — за користувачем. Rust отримує поточну версію, на якій ґрунтується
 * рішення, і відмовляє, якщо документ тим часом змінився (наприклад, збережено з редактора).
 */
export async function regenerateItem({
  api, JSZip, item, now = new Date(), status = null, makeCurrent = shouldMakeCurrent(item?.currentOrigin, status),
}) {
  if (!item?.link) throw new Error('Документ не пов’язаний із джерелом даних.');
  const ext = templateExtForItem(item);
  if (!ext) throw new Error('Невідомий формат шаблону пов’язаного документа.');
  const result = await generateDocument({
    api,
    JSZip,
    templateVersionId: item.link.templateVersionId,
    ext,
    sourceKind: item.link.sourceKind,
    params: item.link.params,
    name: null,
    itemId: item.id,
    makeCurrent,
    now,
    expectedCurrentVersionId: item.currentVersionId ?? null,
    lastGeneratedVersionId: item.link.lastGeneratedVersionId ?? null,
  });
  return { ...result, madeCurrent: Boolean(result.version?.current) };
}

const MAX_UPDATE_ROUNDS = 5;

// Документи, побудовані на таблиці з бібліотеки, оновлюються після самої таблиці: інакше вони
// беруть її стару версію. Порядок списку зберігається, цикли зв'язків не зациклюють.
function dependencyOrder(ids, byId) {
  const pending = new Set(ids);
  const ordered = [];
  const visiting = new Set();
  const visit = id => {
    if (!pending.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const link = byId.get(id)?.link;
    const source = link?.sourceKind === 'library_table' ? link.params?.itemId : null;
    if (source) visit(source);
    visiting.delete(id);
    if (pending.delete(id)) ordered.push(id);
  };
  for (const id of ids) visit(id);
  return ordered;
}

const isTableSource = (id, items) =>
  items.some(item => item?.link?.sourceKind === 'library_table' && item.link.params?.itemId === id);

/**
 * «Оновити всі»: за планом regenerationPlan оновлює по черзі документи «Джерело змінилося»
 * (документи з ручними правками й обрані вручну з історії не чіпає ніколи), решту пов'язаних
 * рахує пропущеними. Документ на таблиці з бібліотеки оновлюється після самої таблиці; коли
 * оновлена таблиця є джерелом інших документів, статуси читаються знову й черговий прохід
 * оновлює документи, що застаріли через неї (до 5 проходів). Блокування бібліотеки зупиняє
 * оновлення (помилка йде далі). `onProgress(index, total, item)`.
 * → { plan, results: [{ id, name, outcome, reason?, error?, missing? }], remaining, summary };
 * `remaining` — скільки документів після оновлення досі «Джерело змінилося».
 */
export async function regenerateAll({ api, JSZip, items, statuses, now = new Date(), onProgress = () => {} }) {
  let list = Array.isArray(items) ? items : [];
  const plan = regenerationPlan(list, statuses);
  const results = [];
  const attempted = new Set();
  let queue = plan.update;
  let stale = null; // застарілі за останнім перечитуванням статусів, ще не оновлені
  for (let round = 0; queue.length && round < MAX_UPDATE_ROUNDS; round += 1) {
    const byId = new Map(list.map(item => [item.id, item]));
    const ordered = dependencyOrder(queue, byId);
    let feedsOthers = false;
    for (const [index, id] of ordered.entries()) {
      attempted.add(id);
      const item = byId.get(id);
      if (!item || !shouldMakeCurrent(item.currentOrigin)) {
        results.push({ id, name: item?.name ?? id, outcome: 'skipped', reason: 'edited' });
        continue;
      }
      onProgress(index, ordered.length, item);
      try {
        const result = await regenerateItem({ api, JSZip, item, now, makeCurrent: true });
        results.push({ id, name: item.name, outcome: 'updated', missing: result.missing, warnings: result.warnings });
        stale?.delete(id);
        if (isTableSource(id, list)) feedsOthers = true;
      } catch (error) {
        if (isLockedError(error)) throw error;
        results.push({ id, name: item.name, outcome: 'error', error: errorText(error) });
      }
    }
    if (!feedsOthers) break;
    const [freshItems, freshStatuses] = await Promise.all([api.list(true), api.linkStatuses()]);
    list = Array.isArray(freshItems) ? freshItems : list;
    const next = regenerationPlan(list, freshStatuses);
    stale = new Set(next.update);
    queue = next.update.filter(id => !attempted.has(id));
  }
  const remaining = stale ? stale.size : null;
  const byId = new Map(list.map(item => [item.id, item]));
  for (const entry of plan.skipped) {
    results.push({ id: entry.id, name: byId.get(entry.id)?.name ?? entry.id, outcome: 'skipped', reason: entry.reason });
  }
  const summary = summarizeBulk(results);
  return { plan, results, remaining, summary: remaining ? `${summary}; досі застарілих: ${remaining}` : summary };
}

const STALE_STATUSES = new Set(['source_changed', 'edited_stale']);

/** Скільки пов'язаних документів зроблено на застарілих даних (позначка на вкладці й кнопці). */
export function staleCount(statuses) {
  return (Array.isArray(statuses) ? statuses : []).filter(entry => STALE_STATUSES.has(entry?.status)).length;
}

/** Статуси зв'язків за id документа: Map(itemId → { status, detail }). */
export function linkStatusMap(statuses) {
  const map = new Map();
  for (const entry of Array.isArray(statuses) ? statuses : []) {
    if (entry && typeof entry.itemId === 'string') map.set(entry.itemId, { status: entry.status, detail: entry.detail ?? null });
  }
  return map;
}

const SKIP_REASONS = Object.freeze({
  edited: 'поточна версія має ручні правки — оновіть документ окремо («Оновити з джерела») і оберіть версію',
  edited_stale: 'ручні правки на застарілих даних — оновіть документ окремо й перенесіть правки',
  detached: 'поточну версію обрано вручну з історії — оновіть документ окремо («Оновити з джерела») і оберіть версію',
  source_error: 'джерело недоступне',
});

/** Чому «Оновити всі» пропускає документ (код статусу, detail з Rust для «Джерело недоступне»). */
export function skipReasonText(reason, detail = null) {
  const text = SKIP_REASONS[reason] ?? `статус «${STATUS_LABELS[reason] ?? String(reason)}»`;
  return reason === 'source_error' && detail ? `${text}: ${detail}` : text;
}

/**
 * Позначки документа в списку: [{ text, tone }]; tone — 'muted', 'accent', 'warn' чи 'danger'.
 * `damaged` — ids з library_status.damaged, `link` — { status, detail } з library_link_statuses.
 */
export function itemBadges(item, { damaged = [], link = null } = {}) {
  const badges = [];
  if (damaged.includes(item?.id)) badges.push({ text: 'Пошкоджено', tone: 'danger' });
  if (item?.currentOrigin && ORIGIN_LABELS[item.currentOrigin]) badges.push({ text: ORIGIN_LABELS[item.currentOrigin], tone: 'muted' });
  if (item?.link && link?.status) {
    const tone = link.status === 'current' ? 'accent' : link.status === 'source_error' || link.status === 'edited_stale' ? 'danger' : 'warn';
    badges.push({ text: STATUS_LABELS[link.status] ?? String(link.status), tone });
  }
  if (item?.profileTableCopy) badges.push({ text: 'Копія таблиці профілю', tone: 'muted' });
  if (item?.hidden) badges.push({ text: 'Приховано', tone: 'muted' });
  return badges;
}

/** Підпис виду й формату: «Документ · DOCX». */
export function kindLine(item) {
  const kind = KIND_LABELS[item?.kind] ?? 'Документ';
  return item?.ext ? `${kind} · ${String(item.ext).toUpperCase()}` : kind;
}

/** Рядок версії в історії: «Версія 3 · Ручні правки · DOCX · 12 КБ · 20.10.2026 10:15 · поточна». */
export function versionLabel(version, { offsetMinutes } = {}) {
  return [
    `Версія ${version?.versionNo ?? '?'}`,
    ORIGIN_LABELS[version?.origin] ?? String(version?.origin ?? ''),
    version?.ext ? String(version.ext).toUpperCase() : null,
    formatSize(version?.size),
    formatDateTime(version?.createdAt, { offsetMinutes }),
    version?.current ? 'поточна' : null,
  ].filter(Boolean).join(' · ');
}

/** Опис джерела пов'язаного документа: «Схвалені записи · 01.10.2026 – 20.10.2026». */
export function linkDescription(item, { modules = [], items = [] } = {}) {
  const link = item?.link;
  if (!link) return '';
  const label = sourceKindLabel(link.sourceKind) || String(link.sourceKind ?? '');
  const params = link.params && typeof link.params === 'object' ? link.params : {};
  if (link.sourceKind === 'approved_revisions') {
    // Межа без дати — без обмеження з того боку (записи й «з майбутніми» датами теж беруться).
    const from = params.from ? formatDateTime(params.from) : null;
    const to = params.to ? formatDateTime(params.to) : null;
    const period = from && to ? `${from} – ${to}` : from ? `з ${from}` : to ? `по ${to}` : 'увесь період';
    return `${label} · ${period}`;
  }
  if (link.sourceKind === 'dashboard_module') {
    const module = modules.find(entry => entry?.id === params.moduleId);
    return module?.title ? `${label} · ${module.title}` : label;
  }
  if (link.sourceKind === 'library_table') {
    const table = items.find(entry => entry?.id === params.itemId);
    return table?.name ? `${label} · ${table.name}` : label;
  }
  return label;
}

/**
 * Результати library_search поверх списку: [{ item, snippet, byName }] у порядку пошуку; документів,
 * яких немає в показаному списку (наприклад, прихованих), не показуємо.
 */
export function searchRows(items, response) {
  const byId = new Map((Array.isArray(items) ? items : []).map(item => [item.id, item]));
  const rows = [];
  for (const result of Array.isArray(response?.results) ? response.results : []) {
    const item = byId.get(result?.itemId);
    if (item && !rows.some(row => row.item === item)) rows.push({ item, snippet: result.snippet ?? null, byName: Boolean(result.byName) });
  }
  return rows;
}

/**
 * Відповідь library_export_archive → { path, skipped }: Rust повертає { path, skipped } (назви
 * пошкоджених документів, яких немає в архіві) або null, коли збереження скасовано.
 */
export function archiveResult(response) {
  if (typeof response === 'string') return { path: response || null, skipped: [] };
  const path = typeof response?.path === 'string' && response.path ? response.path : null;
  const skipped = Array.isArray(response?.skipped) ? response.skipped.filter(name => typeof name === 'string' && name) : [];
  return { path, skipped };
}

/** Повідомлення після library_open_in_editor: EasyGreen відкриває файл сам, EasyDoc і EasySlide — з «Відкрити…». */
export function openedInEditorText(item) {
  const name = String(item?.name ?? 'Документ');
  if (item?.app === 'easygreen') return `«${name}» відкривається у вікні EasyGreen.`;
  return `«${name}» чекає у вікні редактора: натисніть там «Відкрити…» — файл відкриється без вибору.`;
}
