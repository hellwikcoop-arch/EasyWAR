// 3D-довідники (src/guides): авторство моделей, відсутність мережі й динамічного коду, реєстрація сторінок у збірці
// та захист від помилок, які вже траплялися під час перенесення зі старих артефактів.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CREDITS, KINDS, creditHtml, creditText, landscapeHtml, landscapeText } from '../src/guides/credits.js';
import { GUIDES, withSection } from '../script/guides-credits.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const IDS = GUIDES.map(([id]) => id);
const PAGES = [...IDS.map((id) => `src/guides/${id}/index.html`), 'src/guides/index.html'];

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const modelFiles = async (id) => (await readdir(new URL(`src/guides/${id}/models/`, root))).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();

test('кожна модель довідників має запис авторства, і навпаки', async () => {
  for (const id of IDS) {
    const credited = Object.keys(CREDITS).filter((key) => key.startsWith(`${id}/`)).map((key) => key.slice(id.length + 1)).sort();
    assert.deepEqual(await modelFiles(id), credited, `${id}: файли в models/ збігаються із записами credits.js`);
  }
  const known = new Set(IDS);
  for (const key of Object.keys(CREDITS)) assert.ok(known.has(key.split('/')[0]), `${key}: невідомий довідник`);
});

test('записи авторства повні: вид, автор, ліцензія й посилання там, де вони потрібні', () => {
  for (const [key, c] of Object.entries(CREDITS)) {
    assert.ok(c.name, `${key}: назва`);
    assert.ok(c.kind in KINDS, `${key}: вид «${c.kind}»`);
    if (c.kind === 'cc') {
      assert.ok(c.title && c.author && c.license && /^https:\/\//.test(c.source), `${key}: cc потребує назви, автора, ліцензії й посилання`);
      // Некомерційна ліцензія: підпис прямо про це каже, як у статтях довідника моделей.
      if (/NC/.test(c.license)) assert.match(c.note || '', /некомерційн/, `${key}: примітка про NC`);
    }
    if (c.kind === 'author') assert.ok(c.title && c.author, `${key}: author потребує назви й автора`);
    if (c.kind === 'game') assert.ok(c.game, `${key}: game потребує назви гри`);
    const text = creditText(key);
    assert.ok(text.length > 20, `${key}: підпис`);
    const html = creditHtml(key);
    assert.doesNotMatch(html.replace(/<a [^>]*>|<\/a>/g, ''), /[<>]/, `${key}: HTML екрановано`);
    if (c.kind === 'cc') assert.match(html, /<a href="https:\/\/[^"]+" target="_blank" rel="noopener">«/, `${key}: назва — посилання на джерело`);
  }
  assert.match(landscapeText(), /CC BY 4\.0/);
  assert.match(landscapeHtml(), /rel="noopener"/);
});

test('розділ «3D-довідники» у src/models/CREDITS.md збігається з credits.js (node script/guides-credits.mjs)', async () => {
  const current = await read('src/models/CREDITS.md');
  assert.equal(withSection(current), current);
  for (const key of Object.keys(CREDITS)) {
    const [id, file] = key.split('/');
    assert.ok(current.includes(`\`${file}.glb\``), `${key} є в CREDITS.md`);
    assert.ok(IDS.includes(id));
  }
});

test('файли моделей: GLB, компактні, лише розширення, які читає GLTFLoader із meshopt', async () => {
  const allowed = ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp'];
  const files = (await walk(new URL('src/guides/', root))).filter((url) => url.pathname.endsWith('.glb'));
  assert.equal(files.length, Object.keys(CREDITS).length + 2, 'усі моделі плюс два ландшафти');
  for (const url of files) {
    const name = fileURLToPath(url).split('/src/guides/')[1];
    assert.ok((await stat(url)).size < 12e6, `${name}: до 12 МБ`);
    const bytes = await readFile(url);
    assert.equal(bytes.toString('latin1', 0, 4), 'glTF', name);
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    for (const x of json.extensionsRequired || []) assert.ok(allowed.includes(x), `${name}: розширення ${x}`);
  }
});

test('models.js перелічує дослівні new URL для кожного файлу: інакше Vite не покладе модель у збірку', async () => {
  for (const id of IDS) {
    const text = await read(`src/guides/${id}/models.js`);
    const listed = [...text.matchAll(/new URL\('\.\/models\/([\w-]+)\.glb', import\.meta\.url\)\.href/g)].map((m) => m[1]).sort();
    assert.deepEqual(listed, await modelFiles(id), `${id}: models.js`);
    const land = text.match(/LAND_URL = new URL\('\.\.\/shared\/(landscape-(?:flight|ground))\.glb', import\.meta\.url\)\.href/);
    assert.ok(land, `${id}: ландшафт`);
    await stat(new URL(`src/guides/shared/${land[1]}.glb`, root));
  }
});

test('довідники не ходять у мережу й не виконують текст як код', async () => {
  const forbidden = [/new Function\(/, /\beval\(/, /importScripts/, /jsdelivr/, /unpkg\.com/, /cdnjs/, /googleapis/, /gstatic/, /claude\.ai/, /\bloadScript\b/, /\batob\(/, /window\.(?:GLB|SPECS?)\b/, /LAND_GLB/, /\bfetch\(\s*['"`]https?:/];
  const sources = (await walk(new URL('src/guides/', root))).filter((url) => /\.(?:js|html|css)$/.test(url.pathname));
  assert.ok(sources.length > 20);
  for (const url of sources) {
    const text = await readFile(url, 'utf8');
    for (const rule of forbidden) assert.doesNotMatch(text, rule, `${fileURLToPath(url).split('/src/guides/')[1]}: ${rule}`);
  }
  for (const page of PAGES) {
    const html = await read(page);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${page}: без вбудованих скриптів`);
    assert.match(html, /<script type="module" src="\.\/(?:main|hub)\.js"><\/script>/, page);
    assert.match(html, /<link rel="stylesheet" href="(?:\.\.\/|\.\/)fonts\/fonts\.css">/, `${page}: локальні шрифти`);
  }
});

test('кожна сторінка довідника веде назад на хаб, а хаб перелічує всі довідники', async () => {
  for (const id of IDS) assert.match(await read(`src/guides/${id}/index.html`), /<a href="\.\.\/index\.html">← easyWIKI<\/a>/, id);
  const hub = await read('src/guides/hub.js');
  for (const id of IDS) assert.match(hub, new RegExp(`id: '${id}'`), `хаб: ${id}`);
  assert.match(await read('src/guides/index.html'), /<a href="\.\.\/index\.html">← До EasyWAR<\/a>/);
});

test('підпис моделі під сценою береться з credits.js, а старі застереження про «надані файли» прибрано', async () => {
  const prefix = { rvia: 'rvia', ppo: 'ppo', 'ground-forces': 'ground-forces', uav: 'uav', aviation: 'aviation', 'enemy-ground': 'enemy-ground' };
  for (const id of IDS) {
    const main = await read(`src/guides/${id}/main.js`);
    assert.match(main, new RegExp(`creditHtml\\('${prefix[id]}/'`), `${id}: підпис із credits.js`);
    assert.doesNotMatch(main + (await read(`src/guides/${id}/index.html`)), /надав користувач|наданих файлах|не зазначено у наданих/, `${id}: старі застереження`);
  }
});

test('збірка: хаб і шість довідників — окремі входи, лаунчер відкриває хаб, кеш телефонного переглядача їх не бере', async () => {
  const cfg = await read('vite.config.js');
  assert.match(cfg, /guides: fileURLToPath\(new URL\("\.\/src\/guides\/index\.html"/);
  for (const id of IDS) assert.match(cfg, new RegExp(`"guides-${id}": fileURLToPath\\(new URL\\("\\./src/guides/${id}/index\\.html"`), id);
  assert.match(cfg, /!name\.endsWith\("\.woff2"\)/);
  assert.match(cfg, /guides\[-\/\]/);
  assert.match(await read('src/launcher-tools.js'), /import '\.\/guides-launcher\.js';/);
  const launcher = await read('src/guides-launcher.js');
  assert.match(launcher, /const HUB_URL = 'guides\/index\.html';/);
  assert.match(launcher, /textContent = 'easyWIKI'/);
  assert.match(launcher, /frame\.src = 'about:blank'/, 'закриття вивантажує WebGL-сцену');
  await stat(new URL('src/guides/index.html', root));
});

test('матеріали моделей пишуть глибину й мають явне середовище: порядок малювання не вирішує, чи видно гусениці', async () => {
  // GLB з alphaMode BLEND ставить depthWrite=false. Матеріали довідників примусово непрозорі; без depthWrite=true
  // ландшафт, створений пізніше за модель, перемальовував гусениці та дрібні деталі.
  for (const id of ['ppo', 'enemy-ground', 'ground-forces', 'uav']) {
    assert.match(await read(`src/guides/${id}/main.js`), /m\.transparent=false;m\.depthWrite=true;/, id);
  }
  assert.match(await read('src/guides/rvia/main.js'), /r\.transparent=false;r\.alphaTest=\.5;\}r\.depthWrite=true;/);
  // У three r186 material.envMapIntensity діє лише разом з material.envMap.
  for (const id of IDS) {
    const main = await read(`src/guides/${id}/main.js`);
    if (/envMapIntensity\s*=/.test(main)) assert.match(main, /envMap=scene\.environment/, `${id}: envMap`);
  }
});

test('правила поділу моделей — готові функції (specs.js без new Function)', async () => {
  for (const id of ['ppo', 'enemy-ground', 'ground-forces']) {
    const { SPECS } = await import(`../src/guides/${id}/specs.js`);
    const models = new Set(await modelFiles(id));
    assert.ok(Object.keys(SPECS).length >= models.size, `${id}: специфікації`);
    for (const [key, spec] of Object.entries(SPECS)) {
      assert.ok(models.has(spec.model), `${id}/${key}: файл моделі ${spec.model}`);
      // Набір танків ділиться за вузлами моделі (byNode), решта — за правилами по трикутниках.
      assert.ok(spec.rules.length > 0 || spec.byNode === true, `${id}/${key}: правила поділу`);
      for (const [name, rule] of spec.rules) {
        assert.equal(typeof name, 'string');
        assert.equal(typeof rule, 'function', `${id}/${key}/${name}`);
      }
    }
  }
});

test('вигляд, затверджений на three r160: відбиття відновлено, RoomEnvironment має слабке головне світло', async () => {
  const { LEGACY_REFLECTIONS } = await import('../src/guides/guide-kit.js');
  const { ShaderChunk } = await import('three');
  assert.equal(LEGACY_REFLECTIONS, true, 'шматок envmap_physical_pars_fragment у встановленому three змінився: перегляньте guide-kit.js');
  assert.match(ShaderChunk.envmap_physical_pars_fragment, /mix\( reflectVec, normal, roughness \* roughness \)/);
  const { RoomEnvironment } = await import('../src/guides/room-env.js');
  const room = new RoomEnvironment();
  const lights = [];
  room.traverse((o) => { if (o.isPointLight) lights.push(o); });
  assert.equal(lights.length, 1);
  assert.equal(lights[0].intensity, 5);
  room.dispose();
});
