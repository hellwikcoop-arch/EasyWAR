// Вкладка «Файли» «Робочого середовища» (src/workspace/files.js, files-core.js): контракт
// команд workspace_files_* (назви й ключі, звіряння з сигнатурами Rust), підписи видів за
// розширенням, сортування й пошук, підсумок «Додати файли…», текстові контракти оболонки й
// збіг застосунків за розширенням між JS і Rust. Лише синтетичні дані.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  addSummary, appForExt, appName, errorText, extensionOf, filesApi, filterFiles, kindLabel, metaLine, sortFiles,
} from '../src/workspace/files-core.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

// Контракт IPC сховища: команда → ключі аргументів верхнього рівня (camelCase).
const CONTRACT = Object.freeze({
  workspace_files_list: [],
  workspace_files_add: [],
  workspace_files_delete: ['name'],
  workspace_files_export: ['name'],
  workspace_files_open: ['name'],
});

test('filesApi викликає команди контракту з точними назвами й ключами', async () => {
  const calls = [];
  const api = filesApi((command, args) => { calls.push([command, args]); return Promise.resolve('ok'); });
  await api.list();
  await api.add();
  await api.remove('Наказ.pdf');
  await api.exportCopy('Таблиця.xlsx');
  await api.open('Таблиця.xlsx');
  assert.deepEqual(calls, [
    ['workspace_files_list', undefined],
    ['workspace_files_add', undefined],
    ['workspace_files_delete', { name: 'Наказ.pdf' }],
    ['workspace_files_export', { name: 'Таблиця.xlsx' }],
    ['workspace_files_open', { name: 'Таблиця.xlsx' }],
  ]);
  for (const [command, args] of calls) assert.deepEqual(Object.keys(args ?? {}), CONTRACT[command], command);
});

// Параметри Rust-команди без станів Tauri: snake_case-назви, у які Tauri перекладає camelCase-ключі JS.
function rustCommandParams(source) {
  const commands = new Map();
  for (const match of source.matchAll(/#\[tauri::command[^\]]*\]\s*(?:(?:#\[[^\]]*\]|\/\/[^\n]*)\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth && index < source.length) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') depth -= 1;
      index += 1;
    }
    const names = source.slice(start, index - 1).split(/,(?![^<(]*[>)])/).map(param => param.trim()).filter(Boolean)
      .filter(param => !/:\s*(?:tauri::)?(?:State|AppHandle|Webview|WebviewWindow|Window)\b/.test(param))
      .map(param => /^(?:mut\s+)?([a-z0-9_]+)\s*:/.exec(param)?.[1])
      .filter(Boolean);
    commands.set(match[1], names);
  }
  return commands;
}

test('команди workspace_files_* у Rust: сигнатури, generate_handler!, build.rs, лише головне вікно', async () => {
  const lib = await read('src-tauri/src/lib.rs');
  const commands = rustCommandParams(lib);
  for (const [command, keys] of Object.entries(CONTRACT)) {
    assert.deepEqual(commands.get(command), keys.map(key => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)), `параметри ${command}`);
    assert.match(lib, new RegExp(`\\n\\s+${command},?\\n`), `${command} у generate_handler!`);
    assert.ok((await read('src-tauri/build.rs')).includes(`"${command}"`), `${command} у build.rs`);
  }
  const main = JSON.parse(await read('src-tauri/capabilities/default.json'));
  const editor = JSON.parse(await read('src-tauri/capabilities/office-editor.json'));
  for (const command of Object.keys(CONTRACT)) {
    const permission = `allow-${command.replaceAll('_', '-')}`;
    assert.ok(main.permissions.includes(permission), `${permission} у головному вікні`);
    assert.ok(!JSON.stringify(editor).includes(permission), `${permission} не у вікні редактора`);
  }
  // Відкриття в редакторі — лише з головного вікна, і файл іде через очікуваний файл з диска.
  assert.match(lib, /async fn workspace_files_open\([\s\S]*?window\.label\(\) != desktop_shell::MAIN_WINDOW_LABEL[\s\S]*?PendingSource::Disk \{ path \}/);
  assert.match(lib, /office_files::PendingSource::Disk \{ path \} => \{[\s\S]*?handles\.remember\(&profile_id, webview\.label\(\), path\)/, 'office_open_file читає файл сховища з диска');
  // Жодних нових дозволів плагінів: fs і dialog для JS не відкрито.
  assert.ok(!main.permissions.some(permission => /^(fs|dialog):/.test(String(permission))), 'без fs:*/dialog:* у головному вікні');
});

test('застосунок за розширенням збігається з workspace_files::app_for_ext у Rust', async () => {
  const rust = await read('src-tauri/src/workspace_files.rs');
  const block = /pub fn app_for_ext\(ext: &str\) -> Option<&'static str> \{\s*match ext \{([\s\S]*?)_ => None,/.exec(rust);
  assert.ok(block, 'app_for_ext у Rust');
  const pairs = new Map();
  for (const arm of block[1].matchAll(/((?:"[a-z]+"\s*\|?\s*)+)=> Some\("([a-z]+)"\)/g)) {
    for (const ext of arm[1].match(/"([a-z]+)"/g).map(quoted => quoted.slice(1, -1))) pairs.set(ext, arm[2]);
  }
  assert.ok(pairs.size >= 8, 'розширення знайдено');
  for (const [ext, app] of pairs) assert.equal(appForExt(ext), app, ext);
  assert.equal(appForExt('pdf'), null);
  assert.equal(appForExt('.XLSX'), 'easygreen');
  assert.equal(appName('easygreen'), 'EasyGreen');
  assert.equal(appName('collectives'), 'Колективи');
  assert.equal(appName(null), null);
  // Кожен застосунок, що відкриває файли сховища, є у списку вікна редактора.
  const editorApps = /pub const EDITOR_APPS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(await read('src-tauri/src/office_files.rs'))[1].match(/"([a-z]+)"/g).map(q => q.slice(1, -1));
  for (const app of new Set(pairs.values())) assert.ok(editorApps.includes(app), `${app} у EDITOR_APPS`);
});

test('розширення, вид і рядок метаданих', () => {
  assert.equal(extensionOf('Звіт.XLSX'), 'xlsx');
  assert.equal(extensionOf('.bashrc'), '');
  assert.equal(extensionOf('README'), '');
  assert.equal(extensionOf('a.'), '');
  assert.equal(extensionOf(null), '');
  assert.equal(kindLabel('xlsx'), 'Таблиця');
  assert.equal(kindLabel('pdf'), 'PDF');
  assert.equal(kindLabel('JPG'), 'Зображення');
  assert.equal(kindLabel('easyfly'), 'Файл EasyFLY');
  assert.equal(kindLabel('dwg'), 'Файл .dwg');
  assert.equal(kindLabel(''), 'Файл');
  assert.equal(metaLine({ ext: 'pdf', size: 1536, modifiedAt: '2026-10-29T10:00:00Z' }, { offsetMinutes: 120 }), 'PDF · 1,5 КБ · змінено 29.10.2026 12:00');
  assert.equal(metaLine({ ext: '', size: 0, modifiedAt: null }), 'Файл · 0 Б');
});

test('сортування за назвою й пошук за словами', () => {
  const files = [{ name: 'наказ 10.pdf' }, { name: 'Наказ 2.pdf' }, { name: 'Zvit.xlsx' }, { name: 'Звіт’2026.docx' }];
  assert.deepEqual(sortFiles(files).map(file => file.name), ['Звіт’2026.docx', 'Наказ 2.pdf', 'наказ 10.pdf', 'Zvit.xlsx']);
  assert.equal(sortFiles(null).length, 0);
  assert.deepEqual(filterFiles(files, '  ').map(file => file.name), files.map(file => file.name));
  assert.deepEqual(filterFiles(files, 'НАКАЗ').map(file => file.name), ['наказ 10.pdf', 'Наказ 2.pdf']);
  assert.deepEqual(filterFiles(files, "звіт'2026").map(file => file.name), ['Звіт’2026.docx']);
  assert.deepEqual(filterFiles(files, 'наказ 10'), [files[0]]);
  assert.deepEqual(filterFiles(files, 'немає'), []);
});

test('підсумок «Додати файли…» і текст помилки', () => {
  assert.deepEqual(addSummary(null), { text: '', tone: '' });
  assert.deepEqual(addSummary({ added: [], skipped: [] }), { text: 'Нічого не додано.', tone: '' });
  assert.deepEqual(addSummary({ added: [{ name: 'a.pdf' }], skipped: [] }), { text: 'Додано «a.pdf».', tone: 'ok' });
  assert.deepEqual(addSummary({ added: [{ name: 'a.pdf' }, { name: 'b.pdf' }], skipped: [] }), { text: 'Додано файлів: 2.', tone: 'ok' });
  assert.deepEqual(addSummary({ added: [], skipped: [{ name: 'x.bin', reason: 'файл порожній' }] }),
    { text: 'Пропущено: «x.bin» (файл порожній).', tone: 'error' });
  assert.equal(errorText('рядок'), 'рядок');
  assert.equal(errorText(new Error('збій')), 'збій');
  assert.equal(errorText(undefined), 'невідома помилка');
});

test('оболонка: вкладка «Файли», окремий чанк, лише головне вікно, тексти кнопок', async () => {
  const index = await read('src/workspace/index.html');
  assert.match(index, /id="ws-tab-files" role="tab" data-tab="files" aria-controls="ws-files" aria-selected="false" tabindex="-1">Файли</);
  assert.match(index, /<section class="ws-home-main ws-library ws-files-panel" id="ws-files" role="tabpanel" aria-labelledby="ws-tab-files" hidden><\/section>/);
  const shell = await read('src/workspace/workspace.js');
  assert.match(shell, /import\('\.\/files\.js'\)/, 'сховище — окремий чанк, вантажиться з вкладкою');
  assert.match(shell, /'Сховище файлів доступне лише в застосунку EasyWAR\.'/);
  assert.match(shell, /function openFiles\(\) \{\s*if \(shell\.mode !== 'desktop'\)/);
  assert.match(shell, /filesPanel\.hidden = id !== 'files';/);
  const vite = await read('vite.config.js');
  const chunkRule = /chunkFileNames: \(chunk\) =>\s*(\/.+\/)\.test\(/.exec(vite);
  assert.ok(new RegExp(chunkRule[1].slice(1, -1)).test('/x/src/workspace/files.js'), 'чанк files.js має префікс workspace-');
  assert.ok(!new RegExp(chunkRule[1].slice(1, -1)).test('/x/src/workspace/files-core.js'));
  const files = await read('src/workspace/files.js');
  for (const label of ['Додати файли…', 'Оновити список', 'Зберегти копію…', 'Видалити', 'Скасувати', 'Відкрити в ${app}', 'Пошук за назвою']) {
    assert.ok(files.includes(label), label);
  }
  assert.match(files, /listen\('office-editor-closed'/);
  assert.ok(!/innerHTML|localStorage|fetch\(/.test(files), 'без innerHTML, localStorage і мережі');
  // Усі виклики invoke у вкладці — лише через filesApi.
  assert.ok(!/invoke\(/.test(files.replace(/findInvoke\(window\)/g, '')), 'files.js не викликає invoke напряму');
  const sources = await Promise.all((await readdir(new URL('src/workspace/', root))).filter(name => name.endsWith('.js')).map(name => read(`src/workspace/${name}`)));
  const uses = sources.join('\n').match(/workspace_files_[a-z_]+/g) ?? [];
  assert.deepEqual([...new Set(uses)].sort(), Object.keys(CONTRACT).sort(), 'команди сховища лише з контракту');
});
