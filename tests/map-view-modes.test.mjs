import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Вигляди 3D-карти «Рельєф України»: вісім режимів (супутник, рельєф, відмивка, креслення, макет, каркас, точки, неон).
// Тести перевіряють контракт між map.html, map-app.js і map.css без WebGL: кнопки, таблицю стилів, гілки шейдера,
// матеріали забудови й контраст написів на кожному тлі.
const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const html = read('map.html'), js = read('map-app.js'), css = read('map.css');

// Константи MODE і SCENE_STYLES — літерали; виконуємо лише їх, без решти модуля.
function loadStyles() {
  const start = js.indexOf('const MODE = {');
  const end = js.indexOf('};', js.indexOf('const SCENE_STYLES = {')) + 2;
  assert.ok(start > 0 && end > start, 'MODE і SCENE_STYLES мають лишатися поруч як літерали');
  const ctx = {};
  new vm.Script(`${js.slice(start, end)}\nresult = { MODE, SCENE_STYLES };`).runInNewContext(ctx);
  return JSON.parse(JSON.stringify(ctx.result));   // об'єкти з іншого контексту vm мають інший прототип
}
const hex = (c) => { assert.match(c, /^#[0-9a-f]{6}$/, `колір ${c}`); return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255); };
const lum = (c) => { const [r, g, b] = hex(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const BUTTONS = [['m-sat', 'Супутник'], ['m-hyp', 'Рельєф'], ['m-shade', 'Відмивка'], ['m-con', 'Креслення'], ['m-model', 'Макет'], ['m-wire', 'Каркас'], ['m-dots', 'Точки'], ['m-neon', 'Неон']];

test('перемикач вигляду: вісім кнопок у порядку від фото до стилізацій, лише «Супутник» натиснута спочатку', () => {
  const seg = html.slice(html.indexOf('class="seg"'), html.indexOf('</div>', html.indexOf('class="seg"')));
  const found = [...seg.matchAll(/<button id="(m-[a-z]+)" aria-pressed="(true|false)">([^<]+)<\/button>/g)].map((m) => [m[1], m[3], m[2]]);
  assert.deepEqual(found.map((f) => [f[0], f[1]]), BUTTONS);
  assert.deepEqual(found.filter((f) => f[2] === 'true').map((f) => f[0]), ['m-sat']);
  for (const [id] of BUTTONS) assert.ok(js.includes(`$('${id}')`), `map-app.js має прив'язувати ${id}`);
});

test('MODE нумерує вісім виглядів 0…7, а SCENE_STYLES задає папір, туш, тло й стіну для шести стилізацій', () => {
  const { MODE, SCENE_STYLES } = loadStyles();
  assert.deepEqual(MODE, { sat: 0, hyp: 1, con: 2, model: 3, wire: 4, shade: 5, dots: 6, neon: 7 });
  assert.deepEqual(Object.keys(SCENE_STYLES).map(Number).sort(), [2, 3, 4, 5, 6, 7], 'супутник і рельєф беруть кольори з теми сторінки');
  for (const [m, s] of Object.entries(SCENE_STYLES)) {
    assert.ok(s.light, `вигляд ${m}: світла тема обов'язкова`);
    for (const variant of [s.light, s.dark].filter(Boolean)) {
      assert.deepEqual(Object.keys(variant).sort(), ['bg', 'fg', 'ink', 'muted', 'paper', 'wall']);
      for (const c of Object.values(variant)) hex(c);
    }
  }
  // чорні вигляди однакові в обох темах; макет, відмивка й креслення підлаштовуються під тему
  for (const m of [MODE.wire, MODE.dots, MODE.neon]) { assert.equal(SCENE_STYLES[m].dark, null); assert.ok(lum(SCENE_STYLES[m].light.bg) < 0.01, `вигляд ${m} на чорному тлі`); }
  for (const m of [MODE.con, MODE.model, MODE.shade]) assert.ok(SCENE_STYLES[m].dark, `вигляд ${m} має темний варіант`);
  // макет і відмивка — світла поверхня на будь-якій темі; креслення вночі — світла туш на темному папері
  for (const m of [MODE.model, MODE.shade]) for (const v of ['light', 'dark']) assert.ok(lum(SCENE_STYLES[m][v].paper) > 0.6, `вигляд ${m}/${v}: біла поверхня`);
  assert.ok(lum(SCENE_STYLES[MODE.con].dark.ink) > lum(SCENE_STYLES[MODE.con].dark.paper));
  assert.ok(lum(SCENE_STYLES[MODE.con].light.ink) < lum(SCENE_STYLES[MODE.con].light.paper));
});

test('написи міст читаються на кожному тлі: контраст fg/bg ≥ 7, muted/bg ≥ 3, туш/папір ≥ 3', () => {
  const { SCENE_STYLES } = loadStyles();
  for (const [m, s] of Object.entries(SCENE_STYLES)) for (const [name, v] of Object.entries(s)) {
    if (!v) continue;
    assert.ok(contrast(v.fg, v.bg) >= 7, `вигляд ${m}/${name}: fg на bg ${contrast(v.fg, v.bg).toFixed(2)}`);
    assert.ok(contrast(v.muted, v.bg) >= 3, `вигляд ${m}/${name}: muted на bg ${contrast(v.muted, v.bg).toFixed(2)}`);
    assert.ok(contrast(v.ink, v.paper) >= 3, `вигляд ${m}/${name}: туш на папері ${contrast(v.ink, v.paper).toFixed(2)}`);
  }
});

test('шейдер поверхні має гілку для кожного вигляду, горизонталі й термоградієнт, а уніформи оголошено й ініціалізовано', () => {
  const frag = js.slice(js.indexOf('const frag = '), js.indexOf('const rampHex'));
  for (const m of [1, 2, 3, 4, 5, 6]) assert.ok(frag.includes(`uMode == ${m}`), `гілка uMode == ${m}`);
  assert.match(frag, /float contour\(float h, float step\)/);
  assert.match(frag, /vec3 neon\(float h\)/);
  for (const u of ['uInk', 'uPaper', 'uGridDiv']) {
    assert.ok(frag.includes(`uniform vec${u === 'uGridDiv' ? 2 : 3} ${u};`) || frag.includes(`uniform vec3 ${u};`) || frag.includes(`uniform vec2 ${u};`), `оголошення ${u}`);
    assert.ok(/const uniforms = \{[\s\S]*?\n\};/.exec(js)[0].includes(`${u}:{value:`), `ініціалізація ${u}`);
  }
  // крок сітки каркаса — 0,25°, а не піксельний: клітинки не залежать від роздільності heights.png
  assert.match(js, /uGridDiv:\{value:new THREE\.Vector2\(\(META\.lon1-META\.lon0\)\/0\.25, \(META\.lat1-META\.lat0\)\/0\.25\)\}/);
  // режим «Точки» має власний матеріал THREE.Points, а не лише інший колір поверхні
  assert.match(js, /const dotsMat = new THREE\.ShaderMaterial\(/);
  assert.match(js, /gl_PointSize = /);
  assert.match(js, /ch\.dots = new THREE\.Points\(geo, dotsMat\)/);
  assert.match(js, /farDots = new THREE\.Points\(geo, dotsMat\)/);
  assert.match(js, /function syncOverlays\(\)/);
});

test('applyTheme бере папір, туш і тло з таблиці вигляду, а setMode міняє матеріали забудови, легенду й запам’ятовує вибір', () => {
  const apply = js.slice(js.indexOf('function applyTheme(){'), js.indexOf('applyTheme();'));
  for (const u of ['uWall', 'uBg', 'uInk', 'uPaper']) assert.ok(apply.includes(`uniforms.${u}.value = new THREE.Color(s ? s.`), `applyTheme → ${u}`);
  assert.match(apply, /renderer\.setClearColor\(uniforms\.uBg\.value, 1\)/);
  assert.match(apply, /Labels\.restyle\(s \? \{fg:/);
  const set = js.slice(js.indexOf('function setMode(m){'), js.indexOf('Object.entries(modeBtns)'));
  assert.match(set, /legend\.classList\.toggle\('neon', m === MODE\.neon\)/);
  assert.match(set, /legend\.style\.display = m === MODE\.hyp \|\| m === MODE\.neon \? 'flex' : 'none'/);
  assert.match(set, /dotsOn = m === MODE\.dots; syncOverlays\(\)/);
  assert.match(set, /const set = bldSetFor\(m\); for \(const c of CITY3D\) if \(c\.bldMesh\) c\.bldMesh\.material = set;/);
  assert.match(set, /localStorage\.setItem\('ukr3d\.mode', m\)/);
  assert.match(js, /if \(!\(m in modeBtns\)\) m = MODE\.sat;/, 'невідоме збережене значення повертає до супутника');
  // забудова: глиняний макет, папір, сіра відмивка, білий і блакитний каркас — за режимом, фото-фасади лише в супутнику й рельєфі
  assert.match(js, /const bldSetFor = m => m === 3 \? clayMats : m === 2 \? paperMats : m === 5 \? shadeMats : m === 4 \|\| m === 6 \? wireBld : m === 7 \? neonBld : bldMats;/);
  assert.match(js, /const monoMats = \(color, wire = false\) =>/);
  assert.match(css, /#legend\.neon i\{background:linear-gradient/);
});
