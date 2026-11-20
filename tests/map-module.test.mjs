import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const src = (name) => new URL(`../src/${name}`, import.meta.url);
const read = (name) => readFileSync(src(name), 'utf8');
const asset = (name) => new URL(`../src/public/map-assets/${name}`, import.meta.url);
const json = (name) => JSON.parse(readFileSync(asset(name), 'utf8'));

// geoCore() — чиста функція проєкції й обробки висот, яку map-app.js віддає і воркеру, і основному потоку.
function loadGeoCore() {
  const code = read('map-app.js');
  const start = code.indexOf('function geoCore(){');
  assert.ok(start > 0, 'geoCore має лишатися окремою функцією');
  let depth = 0, end = start;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  return new vm.Script(`(${code.slice(start, end)})`).runInNewContext({ Math, Float32Array, Uint32Array, Uint8Array, Uint16Array });
}
const META = { w: 2048, h: 1398, lon0: 21.9, lon1: 40.5, lat0: 44.05, lat1: 52.5, sp1: 45.7, sp2: 51, scale: 1 / 68900 };
const km = (a, b) => { // дуга великого кола, ґрунтовна перевірка проєкції
  const R = 6371, r = Math.PI / 180, dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

test('проєкція Ламберта: пряма й обернена збігаються, відстані в сцені правдиві', () => {
  const core = loadGeoCore()();
  core.setup(META);
  const a = [0, 0], b = [0, 0], back = [0, 0];
  for (const [lon, lat] of [[30.52, 50.45], [36.23, 49.99], [24.03, 49.84], [32.0, 46.48], [38.0, 47.1], [34.1, 44.95]]) {
    core.fwd(lon, lat, a); core.inv(a[0], a[1], back);
    assert.ok(Math.abs(back[0] - lon) < 1e-6 && Math.abs(back[1] - lat) < 1e-6, `круговий прохід ${lon},${lat}`);
  }
  // Київ — Харків, Львів — Одеса: сцена в метрах × scale
  for (const [p, q] of [[[30.52, 50.45], [36.23, 49.99]], [[24.03, 49.84], [30.73, 46.48]]]) {
    core.fwd(p[0], p[1], a); core.fwd(q[0], q[1], b);
    const sceneKm = Math.hypot(a[0] - b[0], a[1] - b[1]) / META.scale / 1000;
    const trueKm = km(p, q);
    assert.ok(Math.abs(sceneKm - trueKm) / trueKm < 0.006, `${sceneKm.toFixed(1)} км у сцені проти ${trueKm.toFixed(1)} км`);
  }
});

test('усі файли, на які посилаються JSON-описи карти, лежать у map-assets', () => {
  const need = ['heights.png', 'sat.jpg', 'mask.png', 'borders.png', 'coast.json', 'cities.json', 'oblasts.json', 'front_meta.json', 'facades.json', 'cities3d.json', 'villages.json', 'regions.json', 'regions12_east.json'];
  for (const f of need) assert.ok(existsSync(asset(f)), `немає ${f}`);
  const refs = [];
  for (const e of json('cities3d.json')) refs.push(e.sat, e.bld);
  for (const e of json('villages.json')) refs.push(e.bld);
  for (const f of ['regions.json', 'regions12_east.json']) for (const e of json(f)) refs.push(e.sat);
  for (const e of Object.values(json('facades.json'))) refs.push(e.file);
  assert.ok(refs.length > 150, 'опис карти не має бути порожнім');
  for (const f of refs) assert.ok(f && existsSync(asset(f)), `немає файла з опису: ${f}`);
  const png = readFileSync(asset('heights.png'));
  assert.equal(png.readUInt32BE(16), META.w);
  assert.equal(png.readUInt32BE(20), META.h);
  assert.ok(statSync(asset('sat.jpg')).size > 100_000);
});

test('карта не залежить від мережі: ні CDN, ні Google Fonts, ні зовнішніх адрес', () => {
  for (const f of ['map.html', 'map.css', 'map-app.js', 'public/map-3d-bridge.js']) {
    const text = read(f);
    const urls = [...text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0]).filter((u) => !/w3\.org\/(?:2000\/svg|1999\/xhtml)/.test(u));
    assert.deepEqual(urls, [], `${f} посилається на мережу`);
  }
  assert.doesNotMatch(read('map.html'), /<script type="importmap"/);
  assert.match(read('map-app.js'), /from 'three\/examples\/jsm\/controls\/OrbitControls\.js'/);
});

test('вкладка «Карта» ПС і РВ показує 3D за замовчуванням і має перемикач на 2D', () => {
  for (const page of ['air.html', 'rocket.html']) {
    const html = read(page);
    assert.match(html, /<script src="\.\/map-3d-bridge\.js"><\/script>/, `${page}: міст підключено`);
    assert.match(html, /el\.m3 = Map3D\.create\(\{ wrap: el\.mapWrap/, `${page}: міст створюється разом з панеллю карти`);
    assert.match(html, /el\.m3\.toggle, h\('button'/, `${page}: перемикач у шапці панелі`);
    assert.match(html, /el\.m3\.init\(\);/);
    assert.match(html, /el\.m3\.sync\(false\);\n  fitAnim\(\);/, `${page}: точки йдуть у 3D після кожного перерахунку`);
    assert.match(html, /function zoomAt\(f, px, py\) \{\n  if \(el\.m3 && el\.m3\.active\)/);
    assert.match(html, /function fitAnim\(\) \{\n  if \(el\.m3 && el\.m3\.active\) el\.m3\.fit\(\);/);
    assert.match(html, /\.mapwrap\.m3d \{ aspect-ratio/);
    // стара 2D-карта з онлайн-підкладками лишається
    assert.match(html, /const TSRC = \{/);
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const code of inline) assert.doesNotThrow(() => new vm.Script(code));
  }
});

test('міст і сторінка карти розуміють одні й ті самі повідомлення', () => {
  const bridge = read('public/map-3d-bridge.js');
  const app = read('map-app.js');
  new vm.Script(bridge);
  for (const t of ['points', 'fit', 'select', 'zoom', 'theme']) {
    assert.ok(bridge.includes(`'${t}'`), `міст надсилає ${t}`);
    assert.ok(app.includes(`'${t}'`), `карта обробляє ${t}`);
  }
  for (const t of ['hello', 'ready', 'pick']) {
    assert.ok(app.includes(`'${t}'`), `карта надсилає ${t}`);
    assert.ok(bridge.includes(`'${t}'`), `міст приймає ${t}`);
  }
  assert.match(bridge, /e\.source !== frame\.contentWindow/, 'повідомлення приймаються лише від власного iframe');
  assert.match(app, /e\.source !== parent/, 'карта слухає лише вікно-власника');
  assert.match(bridge, /viewer=1/, 'у телефонному переглядачі 3D-карта не вмикається');
  assert.match(bridge, /file:/, 'в автономному файлі лишається 2D');
});

test('збірка: map.html — окремий вхід, а 100+ МБ ресурсів карти не потрапляють у кеш переглядача', () => {
  const cfg = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(cfg, /map: fileURLToPath\(new URL\("\.\/src\/map\.html"/);
  assert.match(cfg, /startsWith\("map-assets\/"\)/);
});

test('армійська авіація відкриває 3D-карту у своєму зеленому режимі', () => {
  assert.match(read('public/map-3d-bridge.js'), /'\.\/map\.html\?embed=1' \+ \(document\.documentElement\.dataset\.module === 'army' \? '&module=army' : ''\)/);
  assert.match(read('map-app.js'), /get\('module'\) === 'army'\) document\.documentElement\.dataset\.module = 'army';/);
  assert.match(read('map.css'), /:root\[data-module="army"\]:not\(\[data-theme="light"\]\)\{\n  --bg:#0b150c;/);
});
