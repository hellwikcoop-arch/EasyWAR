// Вкладка «Бібліотека» (src/workspace/library.js, library-ui-core.js): точні назви команд і
// аргументів контракту IPC (текстом і викликами з підміненим invoke, а коли команди вже підключено
// в Rust — і звірянням з їхніми сигнатурами), вибір екрана, перевірки форм, створення документа з
// шаблону, «Оновити з джерела» й «Оновити всі». Лише синтетичні дані.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import JSZip from 'jszip';
import {
  BRANCHES, archiveResult, defaultDocumentName, errorText, fieldReport, generateDocument, itemBadges, keyActionResult, kindLine, libraryApi, libraryScreen,
  linkDescription, linkStatusMap, newPasswordProblem, openedInEditorText, passwordProblem, readTemplateFields, recoveryCodeProblem,
  regenerateAll, regenerateItem, searchRows, skipReasonText, sourceParams, staleCount, tableItems, templateExtForItem, templateItems,
  versionLabel,
} from '../src/workspace/library-ui-core.js';
import { isLockedError } from '../src/workspace/library-core.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

const LOCKED = 'бібліотека заблокована: розблокуйте її паролем профілю';

// Контракт IPC бібліотеки: команда → ключі аргументів верхнього рівня (camelCase).
const CONTRACT = Object.freeze({
  library_status: [],
  library_create: ['password', 'withRecovery'],
  library_unlock: ['password'],
  library_lock: [],
  library_list: ['includeHidden'],
  library_versions: ['itemId'],
  library_import: ['asTemplate'],
  library_rename: ['itemId', 'name'],
  library_set_hidden: ['itemId', 'hidden'],
  library_set_current: ['itemId', 'versionId'],
  library_export_copy: ['versionId'],
  library_export_archive: [],
  library_open_in_editor: ['versionId'],
  library_read_version: ['versionId'],
  library_search: ['query', 'includeHidden'],
  library_source_data: ['sourceKind', 'params'],
  library_save_generated: ['itemId', 'name', 'templateVersionId', 'sourceKind', 'params', 'fingerprint', 'ext', 'bytes', 'makeCurrent', 'expectedCurrentVersionId'],
  library_link_statuses: [],
  library_unlink: ['itemId'],
  library_recover: ['code', 'newPassword'],
  library_reissue_recovery: ['password'],
  list_dashboard_modules: ['branch'],
});

/** Виклики `<fn>('команда'[, { … }])` у тексті: [{ command, keys }] (ключі верхнього рівня об'єкта). */
function invokeCalls(source, fn = 'invoke') {
  const calls = [];
  const pattern = new RegExp(`\\b${fn}\\('([a-z_]+)'\\s*(\\)|,\\s*\\{)`, 'g');
  for (const match of source.matchAll(pattern)) {
    if (match[2] === ')') {
      calls.push({ command: match[1], keys: [] });
      continue;
    }
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth && index < source.length) {
      const ch = source[index];
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
      index += 1;
    }
    const body = source.slice(start, index - 1);
    const parts = [];
    let level = 0;
    let current = '';
    for (const ch of body) {
      if ('{([<'.includes(ch)) level += 1;
      if ('})]>'.includes(ch)) level -= 1;
      if (ch === ',' && level === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current);
    const keys = parts.map(part => part.trim()).filter(Boolean).map(part => /^([A-Za-z_$][\w$]*)/.exec(part)[1]);
    calls.push({ command: match[1], keys });
  }
  return calls;
}

function fakeInvoke(responses = {}) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args]);
    const response = responses[command];
    return typeof response === 'function' ? response(args, calls) : response;
  };
  return { invoke, calls };
}

test('library.js і library-ui-core.js викликають лише команди контракту з точними аргументами', async () => {
  const ui = await read('src/workspace/library.js');
  const core = await read('src/workspace/library-ui-core.js');
  assert.deepEqual(invokeCalls(ui), [], 'library.js не викликає invoke напряму, лише libraryApi');
  assert.match(ui, /import JSZip from 'jszip';/);
  assert.match(ui, /import \{ findInvoke, listenTauriEvent \} from '\.\/workspace-host\.js';/);
  // Події Rust: блокування (зокрема за 30 хвилин без дій) і закриття вікна редактора.
  assert.match(ui, /subscribe\('library-state', onLibraryState\)/);
  assert.match(ui, /subscribe\('office-editor-closed', \(\) => refreshList\(\{ force: true \}\)\)/);
  assert.match(ui, /addEventListener\('visibilitychange', visibility\)/);
  // «Заблокувати» не йде через run(): працює й під час довгої дії.
  assert.match(ui, /async function lock\(\) \{\n    try \{\n      state\.status = await api\.lock\(\);/);
  assert.match(ui, /invoke = findInvoke\(window\)/);
  assert.match(ui, /const api = libraryApi\(guarded\);/);
  assert.match(ui, /isLockedError\(error\)\) onLocked\(\)/, 'помилка блокування повертає на екран розблокування');

  const calls = invokeCalls(core);
  const seen = new Map();
  for (const { command, keys } of calls) {
    assert.ok(Object.hasOwn(CONTRACT, command), `невідома команда ${command}`);
    assert.equal(seen.has(command), false, `${command} викликається один раз`);
    seen.set(command, keys);
    assert.deepEqual(keys, CONTRACT[command], `аргументи ${command}`);
  }
  assert.deepEqual([...seen.keys()].sort(), Object.keys(CONTRACT).sort(), 'усі команди контракту');

  // Оболонка блокує бібліотеку, профілі видаляють її окремою командою.
  assert.deepEqual(invokeCalls(await read('src/workspace/workspace.js')).filter(call => call.command.startsWith('library_')),
    [{ command: 'library_lock', keys: [] }]);
  assert.deepEqual(invokeCalls(await read('src/local-profiles-core.js'), 'invokeCommand')
    .filter(call => call.command.startsWith('delete_local_profile')), [
    { command: 'delete_local_profile', keys: ['profileId'] },
    { command: 'delete_local_profile_with_library', keys: ['profileId'] },
  ]);
});

test('libraryApi передає в invoke точні назви й аргументи', async () => {
  const { invoke, calls } = fakeInvoke();
  const api = libraryApi(invoke);
  await api.status();
  await api.create('синтетичний-пароль', true);
  await api.unlock('синтетичний-пароль');
  await api.lock();
  await api.list(false);
  await api.versions('doc-1');
  await api.importFile(true);
  await api.rename('doc-1', 'Нова назва');
  await api.setHidden('doc-1', true);
  await api.setCurrent('doc-1', 'ver-1');
  await api.exportCopy('ver-1');
  await api.exportArchive();
  await api.openInEditor('ver-1');
  await api.readVersion('ver-1');
  await api.search('звіт');
  await api.search('звіт', true);
  await api.sourceData('dashboard_module', { moduleId: 'm-1' });
  await api.saveGenerated({ itemId: null, name: 'Д', templateVersionId: 'ver-t', sourceKind: 'library_table', params: { itemId: 'doc-t' }, fingerprint: 'f', ext: 'xlsx', bytes: [1], makeCurrent: true, extra: 'не йде в Rust' });
  await api.linkStatuses();
  await api.unlink('doc-1');
  await api.recover('AAAAA-BBBBB', 'новий-пароль');
  await api.reissueRecovery('синтетичний-пароль');
  await api.dashboardModules('rocket');
  assert.deepEqual(calls, [
    ['library_status', undefined],
    ['library_create', { password: 'синтетичний-пароль', withRecovery: true }],
    ['library_unlock', { password: 'синтетичний-пароль' }],
    ['library_lock', undefined],
    ['library_list', { includeHidden: false }],
    ['library_versions', { itemId: 'doc-1' }],
    ['library_import', { asTemplate: true }],
    ['library_rename', { itemId: 'doc-1', name: 'Нова назва' }],
    ['library_set_hidden', { itemId: 'doc-1', hidden: true }],
    ['library_set_current', { itemId: 'doc-1', versionId: 'ver-1' }],
    ['library_export_copy', { versionId: 'ver-1' }],
    ['library_export_archive', undefined],
    ['library_open_in_editor', { versionId: 'ver-1' }],
    ['library_read_version', { versionId: 'ver-1' }],
    ['library_search', { query: 'звіт', includeHidden: false }],
    ['library_search', { query: 'звіт', includeHidden: true }],
    ['library_source_data', { sourceKind: 'dashboard_module', params: { moduleId: 'm-1' } }],
    ['library_save_generated', { itemId: null, name: 'Д', templateVersionId: 'ver-t', sourceKind: 'library_table', params: { itemId: 'doc-t' }, fingerprint: 'f', ext: 'xlsx', bytes: [1], makeCurrent: true, expectedCurrentVersionId: null }],
    ['library_link_statuses', undefined],
    ['library_unlink', { itemId: 'doc-1' }],
    ['library_recover', { code: 'AAAAA-BBBBB', newPassword: 'новий-пароль' }],
    ['library_reissue_recovery', { password: 'синтетичний-пароль' }],
    ['list_dashboard_modules', { branch: 'rocket' }],
  ]);
});

// Параметри Rust-команди без станів Tauri: snake_case-назви, у які Tauri перекладає camelCase-ключі JS.
function rustCommandParams(sources) {
  const commands = new Map();
  for (const source of sources) {
    for (const match of source.matchAll(/#\[tauri::command[^\]]*\]\s*(?:(?:#\[[^\]]*\]|\/\/[^\n]*)\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)) {
      let depth = 1;
      let index = match.index + match[0].length;
      const start = index;
      while (depth && index < source.length) {
        if (source[index] === '(') depth += 1;
        else if (source[index] === ')') depth -= 1;
        index += 1;
      }
      const list = source.slice(start, index - 1);
      const params = [];
      let level = 0;
      let current = '';
      for (const ch of list) {
        if (ch === '<' || ch === '(' || ch === '[') level += 1;
        if (ch === '>' || ch === ')' || ch === ']') level -= 1;
        if (ch === ',' && level === 0) {
          params.push(current);
          current = '';
        } else current += ch;
      }
      params.push(current);
      const names = params.map(param => param.trim()).filter(Boolean)
        .filter(param => !/:\s*(?:tauri::)?(?:State|AppHandle|Webview|WebviewWindow|Window)\b/.test(param))
        .map(param => /^(?:mut\s+)?([a-z0-9_]+)\s*:\s*(.*)$/s.exec(param))
        .filter(Boolean)
        .map(([, name, type]) => ({ name, optional: /^Option\s*</.test(type.trim()) }));
      commands.set(match[1], names);
    }
  }
  return commands;
}

const snake = key => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

test('команди контракту в Rust мають ті самі назви й параметри (коли їх уже підключено)', async t => {
  const dir = new URL('src-tauri/src/', root);
  const files = (await readdir(dir)).filter(name => name.endsWith('.rs'));
  const sources = await Promise.all(files.map(name => readFile(new URL(name, dir), 'utf8')));
  const commands = rustCommandParams(sources);
  assert.deepEqual(commands.get('list_dashboard_modules'), [{ name: 'branch', optional: false }], 'розбір сигнатур працює');
  if (!commands.has('library_status')) {
    t.skip('команди library_* ще не зареєстровано як #[tauri::command]');
    return;
  }
  for (const [command, keys] of Object.entries({ ...CONTRACT, delete_local_profile_with_library: ['profileId'] })) {
    assert.ok(commands.has(command), `у Rust немає команди ${command}`);
    const params = commands.get(command);
    const sent = keys.map(snake).sort();
    // Кожен ключ, який передає JS, Rust приймає; обов'язкові параметри Rust JS передає.
    // Необов'язковий параметр Rust (Option<…>) поза контрактом допустимий: Tauri підставить None.
    assert.deepEqual(params.filter(param => !param.optional || sent.includes(param.name)).map(param => param.name).sort(), sent, `параметри ${command}`);
  }
  // «Забули пароль?» на екрані входу (local-profiles-core.js) додає profileId — необов'язковий у Rust.
  const gate = invokeCalls(await read('src/local-profiles-core.js'), 'invokeCommand').filter(call => call.command === 'library_recover');
  assert.deepEqual(gate.map(call => call.keys), [['code', 'newPassword', 'profileId']]);
  assert.deepEqual(commands.get('library_recover').map(param => `${param.name}${param.optional ? '?' : ''}`).sort(), ['code', 'new_password', 'profile_id?']);
});

test('текст помилки блокування з Rust розпізнається як блокування', async () => {
  const rust = await read('src-tauri/src/office_library.rs');
  const message = /pub const LOCKED_MESSAGE: &str = "([^"]+)";/.exec(rust)[1];
  assert.equal(message, LOCKED);
  assert.equal(isLockedError(message), true);
});

test('екран за станом бібліотеки, тексти помилок і перевірки форм', () => {
  for (const state of ['no_profile', 'no_password', 'none', 'locked', 'unlocked']) assert.equal(libraryScreen({ state }), state);
  assert.equal(libraryScreen({ state: 'unavailable' }), 'unknown');
  assert.equal(libraryScreen(null), 'unknown');
  assert.equal(errorText(LOCKED), LOCKED);
  assert.equal(errorText(new Error('збій')), 'збій');
  assert.match(passwordProblem(''), /Введіть пароль/);
  assert.equal(passwordProblem('x'), null, 'довжину пароля входу перевіряє Rust');
  // Вхід/розблокування перевіряє лише порожнє поле: пароль, встановлений раніше коротшим за 8, і далі впускає.
  assert.equal(passwordProblem('секрет'), null);
  assert.match(newPasswordProblem('1234567', '1234567'), /щонайменше 8/);
  assert.match(newPasswordProblem('x'.repeat(129), 'x'.repeat(129)), /не більше 128/);
  assert.match(newPasswordProblem('пароль-1', 'пароль-2'), /не збігаються/);
  assert.equal(newPasswordProblem('пароль-1', 'пароль-1'), null);
  assert.match(recoveryCodeProblem('   '), /код відновлення/);
  assert.equal(recoveryCodeProblem('ABCDE-FGHIJ'), null);
  assert.deepEqual(BRANCHES.map(branch => `${branch.id}=${branch.label}`), ['air=ПС', 'rocket=РВ', 'pvk=ПВК', 'dshv=УДШВ']);
});

test('параметри джерела з форми', () => {
  assert.deepEqual(sourceParams('approved_revisions', { from: '', to: '' }), { ok: true, params: { from: null, to: null }, error: null });
  assert.deepEqual(sourceParams('approved_revisions', { from: '2026-10-01', to: '2026-10-20' }).params, { from: '2026-10-01', to: '2026-10-20' });
  assert.match(sourceParams('approved_revisions', { from: '2026-10-21', to: '2026-10-20' }).error, /пізніше/);
  assert.match(sourceParams('approved_revisions', { from: '01.10.2026' }).error, /неправильно/);
  assert.deepEqual(sourceParams('dashboard_module', { moduleId: 'module-1' }).params, { moduleId: 'module-1' });
  assert.match(sourceParams('dashboard_module', {}).error, /модуль/);
  assert.deepEqual(sourceParams('library_table', { itemId: 'doc-t' }).params, { itemId: 'doc-t' });
  assert.match(sourceParams('library_table', { itemId: ' ' }).error, /таблицю/);
  assert.equal(sourceParams('щось', {}).ok, false);
});

const ITEMS = [
  { id: 'doc-t1', kind: 'template', name: 'Шаблон довідки', ext: 'docx', currentVersionId: 'ver-t1', currentOrigin: 'imported', link: null },
  { id: 'doc-t2', kind: 'template', name: 'Порожній', ext: 'docx', currentVersionId: null, link: null },
  { id: 'doc-x', kind: 'table', name: 'Синтетична таблиця', ext: 'csv', currentVersionId: 'ver-x', currentOrigin: 'imported', link: null },
  { id: 'doc-g', kind: 'document', name: 'Довідка за жовтень', ext: 'docx', currentVersionId: 'ver-g2', currentOrigin: 'generated', versionCount: 2,
    link: { sourceKind: 'approved_revisions', params: { from: '2026-10-01', to: null }, templateVersionId: 'ver-t1', lastGeneratedVersionId: 'ver-g2' } },
  { id: 'doc-e', kind: 'slides', name: 'Нарада', ext: 'pptx', currentVersionId: 'ver-e3', currentOrigin: 'edited', hidden: true,
    link: { sourceKind: 'library_table', params: { itemId: 'doc-x' }, templateVersionId: 'ver-t9', lastGeneratedVersionId: 'ver-e2' } },
];

test('шаблони й таблиці для форми, формат шаблону пов’язаного документа, назва за замовчуванням', () => {
  assert.deepEqual(templateItems(ITEMS).map(item => item.id), ['doc-t1']);
  assert.deepEqual(tableItems(ITEMS).map(item => item.id), ['doc-x']);
  assert.equal(templateExtForItem(ITEMS[3]), 'docx');
  assert.equal(templateExtForItem(ITEMS[4]), 'pptx');
  assert.equal(templateExtForItem({ kind: 'table', ext: 'csv' }), 'xlsx');
  assert.equal(templateExtForItem({ kind: 'template', ext: 'txt' }), null);
  assert.equal(defaultDocumentName('Шаблон  довідки ', new Date(2026, 9, 20)), 'Шаблон довідки — 20.10.2026');
  const long = defaultDocumentName('ж'.repeat(200), new Date(2026, 0, 2));
  assert.equal(Array.from(long).length, 120);
  assert.ok(long.endsWith(' — 02.01.2026'));
});

test('довідка про поля: що дає джерело й які поля шаблону невідомі', () => {
  const report = fieldReport({
    sourceKind: 'dashboard_module',
    data: { module: { title: 'Журнал', fields: [{ key: 'flight_date', label: 'Дата польоту', dataType: 'date' }] } },
    template: { fields: ['flight_date', 'дата', 'невідоме_поле'], blocks: ['рядки', 'записи'], errors: ['синтетична помилка'] },
  });
  assert.ok(report.available.some(entry => entry.name === 'flight_date' && entry.block === 'рядки'));
  assert.deepEqual(report.blocks.map(block => block.name), ['рядки']);
  assert.deepEqual(report.fields, [{ name: 'flight_date', known: true }, { name: 'дата', known: true }, { name: 'невідоме_поле', known: false }]);
  assert.deepEqual(report.templateBlocks, [{ name: 'рядки', known: true }, { name: 'записи', known: false }]);
  assert.deepEqual(report.unknown, ['записи', 'невідоме_поле']);
  assert.deepEqual(report.errors, ['синтетична помилка']);
  assert.deepEqual(fieldReport({ sourceKind: 'approved_revisions' }).unknown, []);
});

test('позначки, підписи версій, опис джерела, пошук і статуси зв’язків', () => {
  const statuses = [
    { itemId: 'doc-g', status: 'source_changed', detail: null },
    { itemId: 'doc-e', status: 'edited_stale', detail: null },
    { itemId: 'doc-z', status: 'source_error', detail: 'таблицю видалено' },
    { itemId: 'doc-c', status: 'current', detail: null },
  ];
  assert.equal(staleCount(statuses), 2);
  assert.equal(staleCount(null), 0);
  const links = linkStatusMap(statuses);
  assert.deepEqual(links.get('doc-z'), { status: 'source_error', detail: 'таблицю видалено' });
  assert.deepEqual(itemBadges(ITEMS[4], { damaged: ['doc-e'], link: links.get('doc-e') }).map(badge => badge.text),
    ['Пошкоджено', 'Ручні правки', 'Ручні правки на застарілих даних', 'Приховано']);
  assert.deepEqual(itemBadges({ ...ITEMS[2], profileTableCopy: true }).map(badge => badge.text), ['Імпортовано', 'Копія таблиці профілю']);
  assert.equal(kindLine(ITEMS[0]), 'Шаблон · DOCX');
  assert.equal(versionLabel({ versionNo: 3, origin: 'edited', ext: 'docx', size: 2560, createdAt: '2026-10-20T07:15:00Z', current: true }),
    'Версія 3 · Ручні правки · DOCX · 2,5 КБ · 20.10.2026 07:15 · поточна');
  assert.equal(versionLabel({ versionNo: 1, origin: 'generated', ext: 'docx', size: 10, createdAt: '2026-10-20T07:15:00Z' }, { offsetMinutes: 180 }),
    'Версія 1 · Згенеровано з шаблону · DOCX · 10 Б · 20.10.2026 10:15');
  assert.equal(linkDescription(ITEMS[3]), 'Схвалені записи · з 01.10.2026');
  // Однобічний період: без «сьогодні» й без зламаного «початку – …».
  assert.equal(linkDescription({ link: { sourceKind: 'approved_revisions', params: { from: null, to: '2026-10-20' } } }), 'Схвалені записи · по 20.10.2026');
  assert.equal(linkDescription({ link: { sourceKind: 'approved_revisions', params: { from: '2026-10-01', to: '2026-10-20' } } }), 'Схвалені записи · 01.10.2026 – 20.10.2026');
  assert.equal(linkDescription({ link: { sourceKind: 'approved_revisions', params: { from: null, to: null } } }), 'Схвалені записи · увесь період');
  assert.equal(linkDescription(ITEMS[4], { items: ITEMS }), 'Таблиця з бібліотеки · Синтетична таблиця');
  assert.equal(linkDescription(ITEMS[0]), '');
  assert.match(skipReasonText('edited'), /ручні правки/);
  assert.equal(skipReasonText('source_error', 'таблицю видалено'), 'джерело недоступне: таблицю видалено');
  const rows = searchRows(ITEMS, { indexReady: false, results: [
    { itemId: 'doc-g', name: 'Довідка за жовтень', snippet: '…уражено 3…', byName: false },
    { itemId: 'doc-hidden', name: 'Немає в списку', snippet: null, byName: true },
    { itemId: 'doc-g', name: 'Довідка за жовтень', snippet: null, byName: true },
  ] });
  assert.deepEqual(rows.map(row => [row.item.id, row.snippet]), [['doc-g', '…уражено 3…']]);
  assert.deepEqual(archiveResult({ path: '/синтетичний/архів.zip', skipped: ['Зламаний звіт', ''] }), { path: '/синтетичний/архів.zip', skipped: ['Зламаний звіт'] });
  assert.deepEqual(archiveResult(null), { path: null, skipped: [] });
  assert.deepEqual(archiveResult('/архів.zip'), { path: '/архів.zip', skipped: [] });
  assert.match(openedInEditorText({ name: 'Таблиця', app: 'easygreen' }), /EasyGreen/);
  assert.match(openedInEditorText({ name: 'Довідка', app: 'easydoc' }), /«Відкрити…»/);
  // Блокування посеред створення чи відновлення: код показано, але бібліотека заблокована.
  assert.deepEqual(keyActionResult('created', { state: 'unlocked' }), { text: 'Бібліотеку створено й розблоковано.', tone: 'ok' });
  assert.equal(keyActionResult('created', { state: 'locked' }).tone, 'error');
  assert.match(keyActionResult('created', { state: 'locked' }).text, /заблоковано.*Розблокуйте її паролем профілю\./);
  assert.equal(keyActionResult('recovered', { state: 'unlocked' }).text, 'Новий пароль профілю задано, бібліотеку розблоковано.');
  assert.match(keyActionResult('recovered', null).text, /Розблокуйте її новим паролем профілю\./);
});

// Синтетичний шаблон DOCX з полями зведення, блоком записів і одним невідомим полем.
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = text => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function templateDocx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`);
  zip.file('word/document.xml', `${XML_HEAD}<w:document ${W_NS}><w:body>${[
    para('Довідка {{профіль.назва}} на {{дата}}'),
    para('Період {{період.з}} – {{період.по}}: усього {{зведення.усього}}, уражено {{зведення.уражено}}'),
    para('{{#записи}}'),
    para('{{номер}}. {{тип_ла}} — {{результат}}'),
    para('{{/записи}}'),
    para('Підпис: {{підпис_командира}}'),
  ].join('')}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

async function documentText(bytes) {
  const xml = await (await JSZip.loadAsync(Uint8Array.from(bytes))).file('word/document.xml').async('string');
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(match => match[1]).join('\n');
}

const SOURCE = Object.freeze({
  fingerprint: 'fp-синтетичний',
  sourceKind: 'approved_revisions',
  profile: { displayName: 'Навчальний профіль', position: null, role: null },
  data: {
    period: { from: '2026-10-01', to: '2026-10-20' },
    overview: { totalRecords: 2, abortedRecords: 0, evaluatedRecords: 2, hitRecords: 1, partialRecords: 1, missRecords: 0, unknownRecords: 0, overallEffectPercent: 75, dpiEffectPercent: null },
    breakdowns: [],
    records: [
      { date: '2026-10-02', aircraft: 'Синтетичний ЛА-1', result: 'hit' },
      { date: '2026-10-03', aircraft: 'Синтетичний ЛА-2', result: 'partial' },
    ],
  },
});

/** ArrayBuffer з іншого realm, як байти library_read_version від invoke головного вікна. */
function foreignBuffer(bytes) {
  const context = vm.createContext({ source: Array.from(bytes) });
  return vm.runInContext('new Uint8Array(source).buffer', context);
}

test('«Створити з шаблону»: байти шаблону → дані джерела → заповнений DOCX → library_save_generated', async () => {
  const template = await templateDocx();
  const foreign = foreignBuffer(template);
  assert.equal(foreign instanceof ArrayBuffer, false, 'буфер справді з іншого realm');
  const { invoke, calls } = fakeInvoke({
    library_read_version: () => foreign,
    library_source_data: SOURCE,
    library_save_generated: args => ({
      item: { id: 'doc-new', name: args.name, kind: 'document', ext: 'docx' },
      version: { id: 'ver-new', versionNo: 1, origin: 'generated', current: true },
    }),
  });
  const api = libraryApi(invoke);
  const info = await readTemplateFields({ api, JSZip, item: ITEMS[0] });
  assert.ok(info.fields.includes('підпис_командира'));
  assert.deepEqual(info.blocks, ['записи']);

  const result = await generateDocument({
    api, JSZip, templateVersionId: 'ver-t1', ext: 'docx', sourceKind: 'approved_revisions',
    params: { from: '2026-10-01', to: '2026-10-20' }, name: 'Довідка за жовтень', now: new Date(2026, 9, 20),
  });
  assert.deepEqual(calls.map(call => call[0]), ['library_read_version', 'library_read_version', 'library_source_data', 'library_save_generated']);
  assert.deepEqual(calls[2][1], { sourceKind: 'approved_revisions', params: { from: '2026-10-01', to: '2026-10-20' } });
  const saved = calls[3][1];
  assert.deepEqual(Object.keys(saved), CONTRACT.library_save_generated);
  assert.equal(saved.itemId, null);
  assert.equal(saved.name, 'Довідка за жовтень');
  assert.equal(saved.templateVersionId, 'ver-t1');
  assert.equal(saved.fingerprint, 'fp-синтетичний');
  assert.equal(saved.ext, 'docx');
  assert.equal(saved.makeCurrent, true);
  assert.equal(saved.expectedCurrentVersionId, null, 'новий документ — без очікуваної версії');
  assert.equal(result.created, true);
  assert.ok(Array.isArray(saved.bytes) && saved.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte < 256), 'байти — масив чисел');
  const text = await documentText(saved.bytes);
  assert.match(text, /Довідка Навчальний профіль на 20\.10\.2026/);
  assert.match(text, /Період 01\.10\.2026 – 20\.10\.2026: усього 2, уражено 1/);
  assert.match(text, /1\. Синтетичний ЛА-1 — Уражено/);
  assert.match(text, /2\. Синтетичний ЛА-2 — Частково/);
  assert.doesNotMatch(text, /\{\{/);
  assert.deepEqual(result.missing, ['підпис_командира']);
  assert.equal(result.item.id, 'doc-new');
  assert.equal(result.version.current, true);
});

function regenerationInvoke(template, { failFor = null } = {}) {
  let next = 10;
  return fakeInvoke({
    library_read_version: () => template.slice().buffer,
    library_source_data: (args) => {
      if (failFor && args.params?.itemId === failFor) throw 'джерело недоступне: таблицю не знайдено';
      return SOURCE;
    },
    library_save_generated: args => {
      next += 1;
      return { item: { id: args.itemId }, version: { id: `ver-${next}`, versionNo: next, origin: 'generated', current: args.makeCurrent } };
    },
  });
}

test('«Оновити з джерела»: нова версія поточна лише без ручних правок', async () => {
  const template = await templateDocx();
  const { invoke, calls } = regenerationInvoke(template);
  const api = libraryApi(invoke);
  const generated = await regenerateItem({ api, JSZip, item: ITEMS[3], now: new Date(2026, 9, 20) });
  const first = calls.find(call => call[0] === 'library_save_generated')[1];
  assert.equal(first.itemId, 'doc-g');
  assert.equal(first.name, null, 'назва пов’язаного документа не змінюється');
  assert.equal(first.templateVersionId, 'ver-t1');
  assert.deepEqual(first.params, { from: '2026-10-01', to: null });
  assert.equal(first.makeCurrent, true);
  assert.equal(first.expectedCurrentVersionId, 'ver-g2', 'Rust перевірить, що поточна версія та сама');
  assert.equal(generated.madeCurrent, true);
  assert.equal(generated.created, true);

  const edited = await regenerateItem({ api, JSZip, item: { ...ITEMS[3], currentOrigin: 'edited' }, now: new Date(2026, 9, 20) });
  assert.equal(calls.filter(call => call[0] === 'library_save_generated')[1][1].makeCurrent, false);
  assert.equal(edited.madeCurrent, false, 'версія лягла в історію; вибір за користувачем');
  // Обрану вручну з історії версію (detached) нова теж не витісняє.
  const pinned = await regenerateItem({ api, JSZip, item: ITEMS[3], status: 'detached', now: new Date(2026, 9, 20) });
  assert.equal(calls.filter(call => call[0] === 'library_save_generated')[2][1].makeCurrent, false);
  assert.equal(pinned.madeCurrent, false);
  await assert.rejects(regenerateItem({ api, JSZip, item: ITEMS[0] }), /не пов’язаний/);
});

test('«Оновити з джерела»: «зроблено поточною» — лише за відповіддю Rust; повтор без нової версії розпізнається', async () => {
  const template = await templateDocx();
  // Rust відмовився робити поточною (або повернув наявну версію): madeCurrent — з version.current.
  const declined = fakeInvoke({
    library_read_version: () => template.slice().buffer,
    library_source_data: SOURCE,
    library_save_generated: () => ({ item: { id: 'doc-g' }, version: { id: 'ver-g2', versionNo: 2, origin: 'generated', current: false } }),
  });
  const result = await regenerateItem({ api: libraryApi(declined.invoke), JSZip, item: ITEMS[3], now: new Date(2026, 9, 20) });
  assert.equal(result.madeCurrent, false);
  assert.equal(result.created, false, 'та сама остання згенерована версія — нової не створено');
  // Якщо Rust сам каже created — віримо йому.
  const explicit = fakeInvoke({
    library_read_version: () => template.slice().buffer,
    library_source_data: SOURCE,
    library_save_generated: () => ({ item: { id: 'doc-g' }, version: { id: 'ver-g2', versionNo: 2, current: true }, created: true }),
  });
  assert.equal((await regenerateItem({ api: libraryApi(explicit.invoke), JSZip, item: ITEMS[3] })).created, true);
  // Документ змінився між списком і збереженням — помилка Rust іде далі.
  const changed = fakeInvoke({
    library_read_version: () => template.slice().buffer,
    library_source_data: SOURCE,
    library_save_generated: () => { throw 'документ змінився після оновлення списку; оновіть список і повторіть'; },
  });
  await assert.rejects(regenerateItem({ api: libraryApi(changed.invoke), JSZip, item: ITEMS[3] }), /документ змінився/);
});

test('«Оновити всі»: документ на таблиці з бібліотеки оновлюється після таблиці й у наступному проході', async () => {
  const template = await templateDocx();
  const link = { sourceKind: 'approved_revisions', params: { from: null, to: null }, templateVersionId: 'ver-t1', lastGeneratedVersionId: null };
  const onTable = { sourceKind: 'library_table', params: { itemId: 'doc-t' }, templateVersionId: 'ver-t1', lastGeneratedVersionId: null };
  const items = [
    { id: 'doc-b', name: 'А-довідка', kind: 'document', ext: 'docx', currentVersionId: 'ver-b1', currentOrigin: 'generated', link: onTable },
    { id: 'doc-a', name: 'Б-довідка', kind: 'document', ext: 'docx', currentVersionId: 'ver-a1', currentOrigin: 'generated', link: onTable },
    // Джерело «Таблиця з бібліотеки» визначає зв'язок, а не вид; DOCX — щоб узяти той самий шаблон.
    { id: 'doc-t', name: 'В-таблиця', kind: 'document', ext: 'docx', currentVersionId: 'ver-t1', currentOrigin: 'generated', link },
  ];
  let round = 0;
  const statuses = [
    { itemId: 'doc-b', status: 'source_changed' },
    { itemId: 'doc-a', status: 'current' },
    { itemId: 'doc-t', status: 'source_changed' },
  ];
  const { invoke, calls } = fakeInvoke({
    library_read_version: () => template.slice().buffer,
    library_source_data: SOURCE,
    library_save_generated: args => ({ item: { id: args.itemId }, version: { id: `ver-${args.itemId}-new`, versionNo: 2, current: true } }),
    library_list: () => items.map(item => ({ ...item, currentVersionId: `ver-${item.id}-new` })),
    library_link_statuses: () => {
      round += 1;
      // Після оновлення таблиці застарів і документ, що був актуальним.
      return [{ itemId: 'doc-b', status: 'current' }, { itemId: 'doc-a', status: round === 1 ? 'source_changed' : 'current' }, { itemId: 'doc-t', status: 'current' }];
    },
  });
  const { results, remaining, summary } = await regenerateAll({ api: libraryApi(invoke), JSZip, items, statuses, now: new Date(2026, 9, 20) });
  const saves = calls.filter(call => call[0] === 'library_save_generated').map(call => [call[1].itemId, call[1].expectedCurrentVersionId]);
  assert.deepEqual(saves, [['doc-t', 'ver-t1'], ['doc-b', 'ver-b1'], ['doc-a', 'ver-doc-a-new']], 'спершу таблиця, потім залежні; другий прохід — зі свіжого списку');
  assert.deepEqual(results.map(result => [result.id, result.outcome]), [['doc-t', 'updated'], ['doc-b', 'updated'], ['doc-a', 'updated']]);
  assert.equal(remaining, 0);
  assert.equal(summary, 'Оновлено: 3; пропущено: 0; помилки: 0');

  // Залежний документ не оновився — підсумок каже, скільки ще застарілих.
  const failing = fakeInvoke({
    library_read_version: () => template.slice().buffer,
    library_source_data: SOURCE,
    library_save_generated: args => {
      if (args.itemId === 'doc-a') throw 'синтетична помилка збереження';
      return { item: { id: args.itemId }, version: { id: `ver-${args.itemId}-new`, versionNo: 2, current: true } };
    },
    library_list: () => items,
    library_link_statuses: () => [{ itemId: 'doc-b', status: 'current' }, { itemId: 'doc-a', status: 'source_changed' }, { itemId: 'doc-t', status: 'current' }],
  });
  const partial = await regenerateAll({ api: libraryApi(failing.invoke), JSZip, items, statuses, now: new Date(2026, 9, 20) });
  assert.equal(partial.remaining, 1);
  assert.equal(partial.summary, 'Оновлено: 2; пропущено: 0; помилки: 1; досі застарілих: 1');
});

test('«Оновити всі» оновлює лише «Джерело змінилося», решту пропускає й підсумовує', async () => {
  const template = await templateDocx();
  const items = [
    { ...ITEMS[3], id: 'doc-a', name: 'А' },
    { ...ITEMS[3], id: 'doc-b', name: 'Б', link: { ...ITEMS[3].link, sourceKind: 'library_table', params: { itemId: 'doc-missing' } } },
    { ...ITEMS[4], id: 'doc-c', name: 'В' },
    { ...ITEMS[3], id: 'doc-d', name: 'Г' },
    { ...ITEMS[3], id: 'doc-f', name: 'Ґ', currentOrigin: 'edited' },
  ];
  const statuses = [
    { itemId: 'doc-a', status: 'source_changed' },
    { itemId: 'doc-b', status: 'source_changed' },
    { itemId: 'doc-c', status: 'edited_stale' },
    { itemId: 'doc-d', status: 'current' },
    { itemId: 'doc-f', status: 'source_changed' },
  ];
  const { invoke, calls } = regenerationInvoke(template, { failFor: 'doc-missing' });
  const progress = [];
  const { plan, results, summary } = await regenerateAll({
    api: libraryApi(invoke), JSZip, items, statuses, now: new Date(2026, 9, 20), onProgress: (index, total, item) => progress.push(`${index + 1}/${total} ${item.name}`),
  });
  assert.deepEqual(plan.update, ['doc-a', 'doc-b', 'doc-f']);
  const saves = calls.filter(call => call[0] === 'library_save_generated').map(call => call[1]);
  assert.deepEqual(saves.map(args => [args.itemId, args.makeCurrent]), [['doc-a', true]], 'документи з ручними правками не оновлюються');
  assert.deepEqual(results.map(result => [result.id, result.outcome]), [
    ['doc-a', 'updated'], ['doc-b', 'error'], ['doc-f', 'skipped'], ['doc-c', 'skipped'],
  ]);
  assert.match(results[1].error, /таблицю не знайдено/);
  assert.deepEqual(progress, ['1/3 А', '2/3 Б']);
  assert.equal(summary, 'Оновлено: 1; пропущено: 2; помилки: 1');

  const locked = fakeInvoke({ library_read_version: () => { throw LOCKED; } });
  await assert.rejects(regenerateAll({ api: libraryApi(locked.invoke), JSZip, items, statuses }), error => error === LOCKED, 'блокування зупиняє оновлення');
});

test('«Оновити з джерела»: підпис очікування бере назву зі знімка, а не з змінної всередині дії', async () => {
  const { readFile } = await import('node:fs/promises');
  const code = await readFile(new URL('../src/workspace/library.js', import.meta.url), 'utf8');
  const start = code.indexOf('function regenerate(snapshot)');
  const end = code.indexOf('// Новий код відновлення', start);
  const body = code.slice(start, end);
  assert.ok(body.includes('`Оновлення «${snapshot.name}» з джерела…`'));
  // Поза внутрішньою дією `item` не оголошено: звернення до нього кинуло б ReferenceError при кліку.
  assert.ok(!/\}, `[^`]*\$\{item\./.test(body));
});
