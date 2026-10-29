// Мережеві межі (P1, R3 / T-0016): файловий контракт за ADR docs/adr/network-and-secret-boundaries.md.
// Перевіряє на рівні файлів, що
// 1) у src/*.js прямі мережеві виклики (fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon)
//    є лише у відомих файлах, і всі вони — до власних ресурсів застосунку; штучно доданий fetch
//    у будь-якому іншому файлі (наприклад, src/sensitivity-core.js) ламає тест;
// 2) зовнішні хости в legacy HTML — лише з переліку ADR (плитки карт, dimap, signal.me);
// 3) у Rust reqwest / std::net використовують лише модулі з переліку ADR, а network_policy.rs
//    не робить мережевих викликів і не має команди Tauri (R3 без IPC);
// 4) перелік призначень Purpose у Rust збігається з розділом 1 ADR;
// 5) вікно редактора «Офісу» не має мережевих дозволів, а webview не має HTTP/shell-плагінів;
// 6) CSP головного вікна = рядок за ADR §5 (T-0018, JE-21 а): директиви, хости й dev-варіант — контракт.
// Це регресійний тест меж на рівні файлів, не доказ відсутності мережевих шляхів (ADR, розділ 6):
// динамічні адреси, вендорні бандли в src/public/** і поведінку webview він не бачить; поведінкові
// тести — C3b (run-easywar, Windows/macOS). CSP з 'unsafe-inline' для скриптів закриває P2-1 лише частково.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

// Файли src/*.js, яким дозволено викликати fetch/XHR, і лише до власних ресурсів застосунку.
const JS_NETWORK_ALLOWLIST = new Set([
  'src/dashboard-module-weather-3d.js', // висоти для 3D-погоди: HEIGHTS_URL відносно document.baseURI
  'src/guides/guide-kit.js',            // .glb довідників (fetchBuffer)
  'src/map-app.js',                     // map-assets через ASSET(src) (fetch і XMLHttpRequest)
  'src/phone-export.js',                // шаблони телефону (phoneAssetUrl)
  'src/presentation-art.js',            // зображення презентації з власних ресурсів
  'src/startup-splash.js',              // відео заставки (VIDEO_URL)
]);
const NETWORK_CALL = /\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnew\s+WebSocket\s*\(|\bnew\s+EventSource\s*\(|\bsendBeacon\s*\(/;
const SKIP_DIRS = new Set(['src/public', 'src/models', 'src/map-assets', 'src/assistant/knowledge', 'src/splash']);

async function listJs(dir) {
  const out = [];
  for (const entry of await readdir(new URL(dir + '/', root))) {
    const rel = `${dir}/${entry}`;
    if (SKIP_DIRS.has(rel)) continue;
    const info = await stat(new URL(rel, root));
    if (info.isDirectory()) out.push(...await listJs(rel));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(rel);
  }
  return out;
}

test('прямі мережеві виклики в src/*.js лише у файлах з переліку ADR', async () => {
  const files = await listJs('src');
  const offenders = [];
  for (const file of files) {
    const text = await read(file);
    if (NETWORK_CALL.test(text) && !JS_NETWORK_ALLOWLIST.has(file)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'новий fetch/XHR/WebSocket поза переліком — додай рядок в ADR і сюди');
  for (const file of JS_NETWORK_ALLOWLIST) {
    const text = await read(file);
    assert.match(text, NETWORK_CALL, `${file} у переліку, але мережевих викликів не має — прибери з переліку`);
    assert.doesNotMatch(text, /\b(fetch|open)\s*\(\s*['"`]https?:\/\//, `${file}: виклик на зовнішню адресу`);
  }
});

// Зовнішні хости, які legacy-сторінки завантажують у webview (ADR, розділ 5).
const LEGACY_HOST_ALLOWLIST = new Set([
  'www.w3.org',                 // простори імен SVG, не запит
  'tile.openstreetmap.org',     // плитки карт (img-src)
  'server.arcgisonline.com',    // плитки Esri (img-src)
  'clarity.maptiles.arcgis.com',
  'tiles.planet.com',           // плитки Planet (ключ користувача, беклог P2-2)
  'dimap.live',                 // вбудований dimap (frame-src)
  'signal.me',                  // зовнішнє посилання, відкривається в системному браузері
]);

test('зовнішні хости legacy HTML лише з переліку ADR', async () => {
  for (const page of ['src/air.html', 'src/rocket.html', 'src/index.html']) {
    const text = await read(page);
    const hosts = new Set([...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(match => match[1].toLowerCase()));
    const unknown = [...hosts].filter(host => !LEGACY_HOST_ALLOWLIST.has(host));
    assert.deepEqual(unknown, [], `${page}: нові зовнішні хости — додай рядок у перелік ресурсів ADR`);
  }
});

// Модулі Rust, яким дозволено reqwest / std::net (ADR, розділ 1).
const RUST_NETWORK_ALLOWLIST = new Set([
  'model_install.rs',   // завантаження моделі
  'signal_daemon.rs',   // JSON-RPC до signal-cli на loopback
  'signal_policy.rs',   // перевірка loopback-адреси
  'signal_session.rs',  // сеанс signal-cli
  'weather_online.rs',  // Open-Meteo
  'app_update.rs',      // tauri-plugin-updater (endpoint з tauri.conf.json)
]);
const RUST_NETWORK = /\breqwest\b|\bstd::net\b|\btokio::net\b|TcpListener|TcpStream|UdpSocket/;

async function listRust(dir) {
  const out = [];
  for (const entry of await readdir(new URL(dir + '/', root))) {
    const rel = `${dir}/${entry}`;
    if ((await stat(new URL(rel, root))).isDirectory()) out.push(...await listRust(rel));
    else if (entry.endsWith('.rs')) out.push(rel);
  }
  return out;
}

test('reqwest і std::net у Rust лише в модулях з переліку ADR', async () => {
  const files = await listRust('src-tauri/src');
  const offenders = [];
  for (const rel of files) {
    const name = path.posix.relative('src-tauri/src', rel); // підмодулі — як `collective/lan.rs`
    const text = await read(rel);
    const code = text.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
    if (RUST_NETWORK.test(code) && !RUST_NETWORK_ALLOWLIST.has(name)) offenders.push(name);
  }
  assert.deepEqual(offenders.filter(name => name !== 'lib.rs'), [], 'новий модуль з мережею — додай в ADR і сюди');
  const lib = await read('src-tauri/src/lib.rs');
  const libCode = lib.split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
  // lib.rs лише встановлює TLS-провайдер і викликає модулі; власних запитів не робить.
  assert.doesNotMatch(libCode, /reqwest::(Client|get|Url)/, 'lib.rs не робить запитів напряму');
});

test('network_policy.rs — чиста функція без мережі й без команди Tauri (R3)', async () => {
  const policy = await read('src-tauri/src/network_policy.rs');
  assert.doesNotMatch(policy, RUST_NETWORK);
  assert.doesNotMatch(policy, /#\[tauri::command\]/);
  assert.match(policy, /pub fn network_policy\(/);
  const lib = await read('src-tauri/src/lib.rs');
  assert.match(lib, /^pub mod network_policy;$/m);
  const handler = lib.match(/generate_handler!\[([\s\S]*?)\]\)/);
  assert.ok(handler, 'generate_handler! у lib.rs');
  assert.doesNotMatch(handler[1], /network_policy/, 'у R3 команди для політики немає (C3b)');
});

test('перелік призначень Purpose збігається з розділом 1 ADR', async () => {
  const policy = await read('src-tauri/src/network_policy.rs');
  const names = [...policy.matchAll(/=> "([a-z0-9_]+)",/g)].map(match => match[1]);
  const expected = ['weather_online', 'model_install', 'app_update', 'signal_daemon', 'collective_lan', 'collective_base44'];
  assert.deepEqual(names, expected);
  const adr = await read('docs/adr/network-and-secret-boundaries.md');
  for (const name of expected) assert.match(adr, new RegExp(`\\| \`${name}\``), `ADR, розділ 1: ${name}`);
  assert.match(adr, /collective_lan[^\n]*відхилено завжди/);
  assert.match(adr, /collective_base44[^\n]*відхилено завжди/);
});

test('вікно редактора без мережі, webview без HTTP/shell-плагінів', async () => {
  const editor = JSON.parse(await read('src-tauri/capabilities/office-editor.json'));
  for (const permission of editor.permissions) {
    const id = typeof permission === 'string' ? permission : permission.identifier;
    assert.match(id, /^allow-office-/, `редактор: ${id}`);
  }
  const main = JSON.parse(await read('src-tauri/capabilities/default.json'));
  for (const permission of main.permissions) {
    const id = typeof permission === 'string' ? permission : permission.identifier;
    assert.doesNotMatch(id, /^(http|shell|websocket|upload|opener):/, `main: ${id}`);
  }
  const cargo = await read('src-tauri/Cargo.toml');
  assert.doesNotMatch(cargo, /tauri-plugin-(http|shell|websocket|upload|opener)\b/);
  const pkg = JSON.parse(await read('package.json'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.doesNotMatch(name, /^@tauri-apps\/plugin-(http|shell|websocket|upload|opener)$/, name);
  }
});

// Хости, яким CSP дозволяє віддавати зображення (плитки карт) і фрейми — рівно перелік ADR, розділ 5.
const CSP_IMG_HOSTS = ['https://tile.openstreetmap.org', 'https://server.arcgisonline.com', 'https://clarity.maptiles.arcgis.com', 'https://tiles.planet.com'];
const CSP_FRAME_HOSTS = ['https://dimap.live'];

function cspDirectives(text) {
  const out = new Map();
  for (const part of text.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

test('CSP головного вікна задано за ADR §5 (T-0018, JE-21 а): без зовнішніх хостів поза переліком', async () => {
  const conf = JSON.parse(await read('src-tauri/tauri.conf.json'));
  const security = conf.app?.security ?? {};
  assert.equal(typeof security.csp, 'string', 'csp — рядок, не null (P2-1)');
  const csp = cspDirectives(security.csp);
  assert.deepEqual(csp.get('default-src'), ["'self'"]);
  assert.deepEqual(csp.get('object-src'), ["'none'"]);
  assert.deepEqual(csp.get('base-uri'), ["'self'"]);
  assert.deepEqual(csp.get('form-action'), ["'self'"]);
  assert.deepEqual(csp.get('frame-src'), ["'self'", ...CSP_FRAME_HOSTS], 'iframe лише власні сторінки й dimap');
  assert.deepEqual(csp.get('img-src'), ["'self'", 'data:', 'blob:', ...CSP_IMG_HOSTS], 'плитки лише з переліку ADR');
  assert.deepEqual(csp.get('connect-src'), ["'self'", 'blob:', 'data:', 'ipc:', 'http://ipc.localhost'], 'fetch лише власні ресурси, blob (текстури .glb), IPC Tauri');
  assert.deepEqual(csp.get('worker-src'), ["'self'", 'blob:'], 'worker карти з Blob');
  assert.deepEqual(csp.get('media-src'), ["'self'", 'blob:'], 'відео заставки через blob');
  assert.deepEqual(csp.get('font-src'), ["'self'", 'data:'], 'шрифти legacy у data:');
  assert.deepEqual(csp.get('script-src'), ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"], 'без unsafe-eval; WASM Офісу');
  assert.deepEqual(csp.get('style-src'), ["'self'", "'unsafe-inline'"]);
  // Жодного зовнішнього хоста поза переліком у будь-якій директиві.
  const allowed = new Set([...CSP_IMG_HOSTS, ...CSP_FRAME_HOSTS, 'http://ipc.localhost']);
  for (const [name, values] of csp) {
    for (const v of values) if (/^https?:\/\//.test(v)) assert.ok(allowed.has(v), `${name}: ${v}`);
  }
  assert.ok(!security.csp.includes("'unsafe-eval'"));
  // Tauri додає хеші/nonce до script-src (ігнорує 'unsafe-inline' для скриптів), а style-src лишає як є:
  // динамічні <style> і style="…" у JS потребують 'unsafe-inline' для стилів.
  assert.deepEqual(security.dangerousDisableAssetCspModification, ['style-src']);
  // devCsp = csp + Vite dev server (HMR), і більше нічого.
  assert.equal(typeof security.devCsp, 'string');
  const dev = cspDirectives(security.devCsp);
  for (const [name, values] of csp) {
    if (name === 'connect-src') {
      assert.deepEqual(dev.get(name), [...values, 'ws://localhost:5173', 'http://localhost:5173']);
    } else assert.deepEqual(dev.get(name), values, name);
  }
  // 'unsafe-inline' для скриптів лишається до переходу legacy HTML на хеші: P2-1 закрито частково.
  console.log("network-boundary: CSP увімкнено (T-0018); 'unsafe-inline' для legacy-скриптів — залишковий ризик P2-1");
});
