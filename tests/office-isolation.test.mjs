// Ізоляція редакторів «Офісу» (F-01, T-Office-06): конфігурація дозволів Tauri.
// Перевіряє на рівні файлів, що
// 1) кожна власна команда з generate_handler! є в AppManifest::commands (build.rs), інакше Tauri
//    дозволяє її будь-якому вікну;
// 2) вікно редактора має лише дозволи office_* і нічого з core чи плагінів;
// 3) жодна інша capability не застосовується до вікна редактора (об'єднання дозволів);
// 4) головне вікно не має файлових команд редактора, але має всі інші власні команди;
// 5) Rust перевіряє мітку вікна в кожній команді office_*;
// 6) команди захищеної бібліотеки (library_*, видалення профілю з бібліотекою) дозволені
//    лише головному вікну: редактор отримує документ бібліотеки тільки через office_open_file.
// Поведінку справжнього webview цей тест не доводить: див. docs/WORKSPACE.md, «Ізоляція».
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const EDITOR_LABEL = 'office-editor';
const EDITOR_COMMANDS = ['office_open_file', 'office_save_file', 'office_save_file_as', 'office_close_file', 'office_editor_close'];
const LIBRARY_COMMANDS = [
  'library_status', 'library_create', 'library_unlock', 'library_lock', 'library_list',
  'library_versions', 'library_import', 'library_rename', 'library_set_hidden', 'library_set_current',
  'library_export_copy', 'library_export_archive', 'library_open_in_editor', 'library_read_version',
  'library_search', 'library_source_data', 'library_save_generated', 'library_link_statuses',
  'library_unlink', 'library_recover', 'library_reissue_recovery', 'delete_local_profile_with_library',
];
const permission = command => `allow-${command.replaceAll('_', '-')}`;

async function handlerCommands() {
  const lib = await read('src-tauri/src/lib.rs');
  const block = lib.match(/generate_handler!\[([\s\S]*?)\]\)/);
  assert.ok(block, 'generate_handler! у lib.rs');
  return block[1].split(',').map(name => name.trim()).filter(Boolean);
}

async function manifestCommands() {
  const build = await read('src-tauri/build.rs');
  assert.match(build, /AppManifest::new\(\)\.commands\(COMMANDS\)/);
  const block = build.match(/const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/);
  assert.ok(block, 'COMMANDS у build.rs');
  return [...block[1].matchAll(/"([a-z0-9_]+)"/g)].map(match => match[1]);
}

async function capabilities() {
  const dir = new URL('src-tauri/capabilities/', root);
  const files = (await readdir(dir)).filter(name => name.endsWith('.json'));
  return Promise.all(files.map(async name => ({ name, ...JSON.parse(await readFile(new URL(name, dir), 'utf8')) })));
}

// Збіг мітки з шаблоном вікна Tauri (`*` — будь-які символи).
const matches = (pattern, label) => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(label);

test('усі власні команди зареєстровано в дозволах Tauri (AppManifest::commands)', async () => {
  const handler = await handlerCommands();
  const manifest = await manifestCommands();
  assert.equal(new Set(handler).size, handler.length, 'команди без повторів');
  assert.deepEqual([...manifest].sort(), [...handler].sort());
  for (const command of EDITOR_COMMANDS) assert.ok(handler.includes(command), command);
});

test('вікно редактора має лише дозволи office_*, без core і плагінів', async () => {
  const caps = await capabilities();
  const editor = caps.filter(cap => (cap.windows ?? []).some(pattern => matches(pattern, EDITOR_LABEL))
    || (cap.webviews ?? []).some(pattern => matches(pattern, EDITOR_LABEL)));
  assert.deepEqual(editor.map(cap => cap.name), ['office-editor.json'], 'до вікна редактора застосовується лише одна capability');
  const [cap] = editor;
  assert.deepEqual(cap.windows, [EDITOR_LABEL]);
  assert.equal(cap.webviews, undefined);
  assert.equal(cap.remote, undefined, 'жодних віддалених адрес');
  assert.deepEqual([...cap.permissions].sort(), EDITOR_COMMANDS.map(permission).sort());
});

test('головне вікно має всі власні команди, крім файлових команд редактора', async () => {
  const handler = await handlerCommands();
  const caps = await capabilities();
  const main = caps.filter(cap => (cap.windows ?? []).some(pattern => matches(pattern, 'main')) || cap.webviews);
  assert.deepEqual(main.map(cap => cap.name), ['default.json']);
  const granted = new Set(main[0].permissions.filter(item => typeof item === 'string'));
  for (const command of handler) {
    assert.equal(granted.has(permission(command)), !EDITOR_COMMANDS.includes(command), command);
  }
  const plugins = [...granted].filter(item => item.includes(':') && !item.startsWith('core:'));
  assert.deepEqual(plugins, [], 'дозволів плагінів (dialog, sql, updater) з JavaScript немає, як і раніше');
});

test('жодна capability не застосовується до всіх вікон і не дає віддаленим адресам доступу', async () => {
  for (const cap of await capabilities()) {
    for (const pattern of [...(cap.windows ?? []), ...(cap.webviews ?? [])]) {
      assert.ok(!pattern.includes('*'), `${cap.name}: шаблон «${pattern}»`);
    }
    assert.equal(cap.remote, undefined, cap.name);
    assert.equal(cap.platforms, undefined, `${cap.name}: однаково на всіх платформах`);
  }
});

test('кожна команда office_* перевіряє мітку вікна, яку дає Tauri', async () => {
  const lib = await read('src-tauri/src/lib.rs');
  for (const command of EDITOR_COMMANDS) {
    const body = lib.slice(lib.indexOf(`fn ${command}(`)).split('\n#[tauri::command]')[0];
    assert.match(body, /office_files::ensure_editor_window\((webview|window)\.label\(\)\)/, command);
  }
  const open = lib.slice(lib.indexOf('fn workspace_open_editor(')).split('\n#[tauri::command]')[0];
  assert.match(open, /window\.label\(\) != desktop_shell::MAIN_WINDOW_LABEL/);
  assert.match(open, /office_files::editor_app\(&app_id\)/);
  const files = await read('src-tauri/src/office_files.rs');
  assert.match(files, /pub const EDITOR_WINDOW_LABEL: &str = "office-editor";/);
});

test('оболонка відкриває застосунок в окремому вікні, а не в iframe головного вікна', async () => {
  const shell = await read('src/workspace/workspace.js');
  assert.match(shell, /shellMode\(window\.__EW_EDITOR_APP, Boolean\(invoke\)\)/);
  assert.match(shell, /invoke\('workspace_open_editor', \{ appId: id \}\)/);
  assert.match(shell, /invoke\('office_editor_close'\)/);
  const desktop = await read('src-tauri/src/desktop_shell.rs');
  assert.match(desktop, /WebviewUrl::App\("workspace\/index\.html"\.into\(\)\)/);
  assert.match(desktop, /initialization_script\(editor_init_script\(app_id, pending\)\)/);
  const files = await read('src-tauri/src/office_files.rs');
  // Назва документа бібліотеки — JSON-рядок у властивості лише для читання.
  assert.match(files, /serde_json::to_string\(&pending\)/);
  assert.match(files, /'__EW_PENDING_FILE', \{\{ value: \{pending\}, writable: false, configurable: false \}\}/);
});

test('команди захищеної бібліотеки дозволені лише головному вікну', async () => {
  const handler = await handlerCommands();
  const manifest = await manifestCommands();
  assert.deepEqual(
    handler.filter(command => command.startsWith('library_') || command.includes('with_library')).sort(),
    [...LIBRARY_COMMANDS].sort(),
  );
  const caps = await capabilities();
  for (const command of LIBRARY_COMMANDS) {
    assert.ok(manifest.includes(command), `${command} у build.rs`);
    const granting = caps.filter(cap => (cap.permissions ?? []).includes(permission(command))).map(cap => cap.name);
    assert.deepEqual(granting, ['default.json'], command);
  }
  const main = caps.find(cap => cap.name === 'default.json');
  assert.deepEqual(main.windows, ['main']);
  assert.equal(main.webviews, undefined);
  const editor = caps.find(cap => cap.name === 'office-editor.json');
  assert.deepEqual(editor.permissions.filter(item => /library/.test(item)), []);
  for (const command of LIBRARY_COMMANDS) assert.ok(!EDITOR_COMMANDS.includes(command), command);
  // Документ бібліотеки відкривається в редакторі лише з головного вікна.
  const lib = await read('src-tauri/src/lib.rs');
  const open = lib.slice(lib.indexOf('fn library_open_in_editor(')).split('\n#[tauri::command]')[0];
  assert.match(open, /window\.label\(\) != desktop_shell::MAIN_WINDOW_LABEL/);
});
