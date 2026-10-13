import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { KINDS } from '../src/munition-3d.js';
import { ENTRIES, GROUPS, PAIRS, aircraftId, carriersOf, creditOf, entryById, modelOf, munitionId, munitionsOf, searchEntries, usageFor, variantsOf } from '../src/ref-data.js';
import { MODEL_FILES, NOSE_TURN, aircraftDistance } from '../src/ref-viewer.js';

const html = await readFile(new URL('../src/air.html', import.meta.url), 'utf8');

test('every article has the required fields and unique ids', () => {
  assert.equal(new Set(ENTRIES.map(e => e.id)).size, ENTRIES.length);
  for (const e of ENTRIES) {
    assert.ok(GROUPS.some(g => g.id === e.group), `${e.id}: group`);
    for (const f of ['name', 'alias', 'role', 'origin', 'summary', 'short']) assert.ok(e[f], `${e.id}: ${f}`);
    assert.ok(e.facts.length, `${e.id}: facts`);
    for (const [k, v] of e.facts) assert.ok(k && v, `${e.id}: fact`);
    for (const s of e.sections) assert.ok(s.title && (s.text || s.list), `${e.id}: section`);
  }
});

test('every munition model kind from the mission card has a munition article', () => {
  for (const e of ENTRIES.filter(x => x.model && x.model.kind)) assert.ok(KINDS.includes(e.model.kind), e.id);
  const ids = ENTRIES.filter(e => e.group === 'munition').map(e => e.id);
  for (const k of KINDS.filter(k => k !== 'bomb')) assert.ok(ids.includes(k), `article for ${k}`);
});

// Усі моделі статті: основна й варіанти (розмальовки чи модифікації), якщо вони є.
const modelsOf = e => (e.variants && e.variants.length > 1 ? e.variants : [e]).filter(v => v.model && v.model.file);
const LICENSES = { 'CC BY 4.0': /CC-BY-4\.0/, 'CC BY-NC-SA 4.0': /CC-BY-NC-SA-4\.0/ };

test('glb models exist, are registered and carry a Creative Commons credit', async () => {
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  for (const entry of ENTRIES) for (const e of modelsOf(entry)) {
    const id = `${entry.id}/${e.id || 'main'}`;
    assert.ok(MODEL_FILES[e.model.file], `${id}: file registered`);
    assert.ok(e.model.nose in NOSE_TURN, `${id}: nose axis`);
    if (e.credit.generated) {
      // Процедурні моделі без сторонніх матеріалів: без ліцензійних вимог, але з поясненням у статті.
      assert.ok(e.credit.note, `${id}: note`);
      // Боєприпаси — маленькі; наземні машини детальні (ходова, заклепки, рухомі вузли й анімація заряджання).
      const limit = entry.group === 'ground' || entry.group === 'support' ? 16e6 : 1e6;
      assert.ok((await stat(new URL(`../src/models/${e.model.file}.glb`, import.meta.url))).size < limit, `${id}: size`);
      assert.ok(credits.includes(`${e.model.file}.glb`), `${id} in CREDITS.md`);
      continue;
    }
    assert.ok(LICENSES[e.credit.license], `${id}: known license ${e.credit.license}`);
    assert.ok(e.credit.author && e.credit.url && e.credit.authorUrl && e.credit.licenseUrl);
    const file = new URL(`../src/models/${e.model.file}.glb`, import.meta.url);
    assert.ok((await stat(file)).size < 12e6, `${id}: stays compact`);
    const bytes = await readFile(file);
    assert.equal(bytes.toString('latin1', 0, 4), 'glTF');
    const len = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + len));
    // Лише розширення, які вміє читати GLTFLoader із meshopt-декодером.
    for (const x of json.extensionsRequired || []) assert.ok(['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(x), x);
    // Ліцензія в самому файлі збігається з ліцензією в підписі статті.
    assert.match(json.asset.extras.license, LICENSES[e.credit.license], `${id}: license inside the file`);
    assert.ok(credits.includes(e.credit.url), `${id} in CREDITS.md`);
    assert.ok(credits.includes(`${e.model.file}.glb`), `${id}: file name in CREDITS.md`);
    // Некомерційна ліцензія: стаття прямо про це каже.
    if (/NC/.test(e.credit.license)) assert.match(e.credit.note, /некомерційне/, `${id}: NC note`);
  }
});

test('every glb in src/models is registered and used by an article', async () => {
  const { readdir } = await import('node:fs/promises');
  const used = new Set(ENTRIES.flatMap(modelsOf).map(e => e.model.file));
  const files = (await readdir(new URL('../src/models/', import.meta.url))).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4));
  for (const f of files) assert.ok(used.has(f), `${f}.glb is not used by any article`);
  for (const f of Object.keys(MODEL_FILES)) assert.ok(files.includes(f), `${f} is registered but missing`);
});

test('articles with several models list a default first and resolve model and credit per variant', () => {
  const mig = entryById('mig29'), su = entryById('su27');
  assert.deepEqual(variantsOf(mig).map(v => v.id), ['falcons', 'ghost']);
  assert.deepEqual(variantsOf(su).map(v => v.id), ['p1m', 'b']);
  assert.equal(variantsOf(entryById('f16')).length, 0);
  // Основна модель статті збігається з першим варіантом, невідомий варіант дає основну.
  assert.equal(mig.model.file, 'mig-29');
  assert.equal(modelOf(mig).file, 'mig-29');
  assert.equal(modelOf(mig, 'nope').file, 'mig-29');
  assert.equal(modelOf(mig, 'ghost').file, 'mig-29-ghost');
  assert.match(creditOf(mig, 'ghost').url, /ghost-of-kiev-mig-29/);
  assert.equal(modelOf(su, 'b').file, 'su-27b');
  assert.equal(modelOf(entryById('f16')).file, 'f-16');
  assert.equal(creditOf(entryById('39')), undefined);
});

test('helicopters and the added munitions have articles that the table recognisers reach', () => {
  for (const [text, id] of [['Мі-8', 'mi8'], ['Mi-8MT', 'mi8'], ['МІ-24П', 'mi24'], ['Mi 24', 'mi24']]) {
    assert.equal(aircraftId(text), id, text);
    assert.equal(entryById(id).group, 'aircraft');
  }
  assert.equal(aircraftId('Мі-28'), '', 'Мі-28 не плутається з Мі-8');
  for (const [text, id] of [['AIM-120C', 'aim120'], ['AMRAAM', 'aim120'], ['AIM-9X', 'aim9'], ['AIM-9M', 'aim9'], ['AGM-65', 'agm65'], ['Р-27Р', 'r27'], ['R-27ER', 'r27'], ['Р-77', 'r77'], ['РВВ-АЕ', 'r77'],
    ['Х-29Л', 'kh29'], ['Kh-29T', 'kh29'], ['КАБ-500Л', 'kab500'], ['KAB-500', 'kab500']]) {
    assert.equal(munitionId(text), id, text);
    assert.equal(entryById(id).group, 'munition');
  }
  // Старі розпізнавання не зачеплено.
  for (const [text, id] of [['AGM-88', 'agm88'], ['GBU-39', '39'], ['С-13', 'c13'], ['Storm Shadow', 'storm']]) assert.equal(munitionId(text), id, text);
  assert.equal(munitionId('Р-273'), '');
  assert.equal(munitionId('GBU-12'), '12', 'GBU-12 лишається номером без статті');
});

test('carrier and munition ids agree with the recognisers of the module', () => {
  const start = html.indexOf('function carrierKey(a)'), end = html.indexOf('const CAR_LIGHT');
  const ctx = {};
  vm.runInNewContext(`${html.slice(start, end)}\nthis.carrierKey = carrierKey; this.munKey = munKey;`, ctx);
  for (const a of ['МіГ-29', 'MiG 29', 'F-16', 'Су-27', 'Su-27P1M', 'Мі Г-29УБ']) assert.equal(aircraftId(a), ctx.carrierKey(a), a);
  for (const m of ['GBU-39', 'GBU-62/B', 'GBU-64', 'AASM-250', 'AGM-88', 'BLU-140', 'С-13', 'C13', 'GBU-53']) assert.equal(munitionId(m), ctx.munKey(m), m);
  assert.equal(aircraftId('Mirage 2000-5'), 'mirage');
  assert.equal(aircraftId('Су-25'), 'su25');
  assert.equal(aircraftId('Су-24М'), 'su24');
  assert.equal(aircraftId('JAS 39C Gripen'), 'gripen');
  assert.equal(aircraftId('невідомий'), '');
  assert.equal(munitionId('Storm Shadow'), 'storm');
  assert.equal(munitionId('SCALP-EG'), 'storm');
  assert.equal(munitionId('GMLRS M31'), 'gmlrs');
});

test('an aircraft that is not in service yet is marked as expected', () => {
  const gripen = entryById('gripen');
  assert.equal(gripen.status, 'Очікується');
  assert.ok(gripen.facts.some(([k, v]) => k === 'Статус в Україні' && /Очікується/.test(v)));
  assert.equal(ENTRIES.filter(e => e.status).length, 1, 'only the Gripen is marked');
});

test('pairs link existing carriers and munitions both ways', () => {
  for (const [a, m] of PAIRS) {
    assert.equal(entryById(a).group, 'aircraft');
    assert.equal(entryById(m).group, 'munition');
    assert.ok(carriersOf(m).includes(a) && munitionsOf(a).includes(m));
  }
});

test('search finds by name, alias and keyword and can be limited to a group', () => {
  assert.deepEqual(searchEntries('hammer').map(e => e.id), ['aasm']);
  assert.deepEqual(searchEntries('gbu-6').map(e => e.id), ['62', '64']);
  assert.ok(searchEntries('міг').some(e => e.id === 'mig29'));
  assert.equal(searchEntries('', '').length, ENTRIES.length);
  assert.ok(searchEntries('', 'aircraft').every(e => e.group === 'aircraft'));
  assert.equal(searchEntries('такого немає').length, 0);
});

test('usage summary counts flights, munitions, results, period and partners', () => {
  const rows = [
    { aircraft: 'МіГ-29', munition: 'GBU-62', count: 2, kind: 'hit', date: '2026-03-02' },
    { aircraft: 'F-16', munition: 'GBU-62', count: 1, kind: 'miss', date: '2026-01-10' },
    { aircraft: 'МіГ-29', munition: 'GBU-39', count: 4, kind: 'part', date: '2026-04-01' },
  ];
  const u = usageFor(rows, entryById('62'));
  assert.deepEqual([u.flights, u.used, u.from, u.to], [2, 3, '2026-01-10', '2026-03-02']);
  assert.deepEqual(u.results, { hit: 1, part: 0, miss: 1, unk: 0 });
  assert.deepEqual(u.partners.map(p => p.id).sort(), ['f16', 'mig29']);
  const air = usageFor(rows, entryById('mig29'));
  assert.equal(air.flights, 2);
  assert.equal(air.partners[0].n, 1);
  assert.equal(usageFor([], entryById('62')).flights, 0);
});

test('aircraft camera distance grows when the stage gets narrower', () => {
  const fp = { r: 2.75, hh: .6 };
  assert.ok(aircraftDistance(fp, .42, 26, 1) > aircraftDistance(fp, .42, 26, 2));
  assert.ok(aircraftDistance(fp, 1.5, 26, 2) > 0);
});

test('the Довідник tab is wired into the module', () => {
  assert.match(html, /id="tab-ref"[^>]*>Довідник<\/button>/);
  assert.match(html, /<main id="view-ref"[^>]*hidden><\/main>/);
  assert.match(html, /const VORDER = \['dash', 'base', 'entry', 'ref'\];/);
  assert.match(html, /<script type="module" src="\.\/ref-wiki\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/ref-wiki\.css">/);
  assert.match(html, /window\.RefWiki\.mount\(\$\('#view-ref'\)/);
});

// Наземні засоби (HIMARS): окрема група без підсумку з таблиці вильотів ПС.
test('the HIMARS article lives in its own ground group, found by its Ukrainian name', () => {
  assert.ok(GROUPS.some(g => g.id === 'ground'));
  const himars = entryById('himars');
  assert.equal(himars.group, 'ground');
  assert.equal(himars.model.file, 'm142-himars');
  assert.ok(himars.credit.generated && himars.credit.note, 'generated model, no third-party licence');
  assert.deepEqual(searchEntries('хаймарс').map(e => e.id), ['himars', 'atacms', 'gmlrs']); // ракети, які несе HIMARS, мають той самий ключ
  assert.deepEqual(searchEntries('', 'ground').map(e => e.id), ['himars', 'm270', 'vilkha', 'sapsan']);
  assert.ok(searchEntries('', 'aircraft').every(e => e.group === 'aircraft'));
  assert.deepEqual(carriersOf('himars'), []);
  assert.deepEqual(munitionsOf('himars'), []);
});

test('the HIMARS model is generated by a script in this repo: a wheeled carrier with cab and one pod', async () => {
  const bytes = await readFile(new URL('../src/models/m142-himars.glb', import.meta.url));
  assert.ok(bytes.length < 16e6, 'textured model stays within the load budget');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal((json.cameras || []).length, 0, 'no cameras');
  assert.ok((json.images || []).length >= 8 && json.materials.some(m => m.normalTexture && m.pbrMetallicRoughness.metallicRoughnessTexture), 'baked PBR textures: colour, normal and roughness/metal maps');
  const names = new Set(json.nodes.map(n => n.name));
  for (const n of ['chassis', 'tyres', 'rims', 'wheel_bolts', 'cab', 'turret', 'module', 'boom_1', 'boom_2', 'hoist_cables', 'spreader', 'pod', 'pod_new', 'strut_a_l']) assert.ok(names.has(n), `${n} present`);
  // Заряджання: з бойового положення модуль опускається й повертається на 180°, рама виносить пакет назад, новий піднімається.
  assert.equal(json.animations.length, 1);
  const [clip] = json.animations;
  assert.equal(clip.name, 'reload');
  const animated = new Set(clip.channels.map(c => json.nodes[c.target.node].name + '.' + c.target.path));
  for (const k of ['turret.rotation', 'module.rotation', 'boom_1.translation', 'boom_2.translation', 'spreader.translation', 'hoist_cables.scale', 'pod.translation', 'pod.scale', 'pod_new.scale', 'strut_a_l.rotation', 'rod_a_r.translation']) assert.ok(animated.has(k), `${k} animated`);
  const node = name => json.nodes.find(n => n.name === name);
  // Кадр 0 — бойове положення: платформа розвернута на 180° (кватерніон навколо y з w ≈ 0), модуль піднято.
  assert.ok(Math.abs(node('turret').rotation[3]) < 1e-6 && Math.abs(Math.abs(node('turret').rotation[1]) - 1) < 1e-6);
  assert.ok(Math.abs(node('module').rotation[2]) > 0.3, 'module raised');
  assert.ok(node('pod_new').scale.every(v => v < 0.01), 'new pod hidden at the start');
  const action = entryById('himars').model.action;
  assert.equal(action.label, 'Заряджання');
  assert.ok(entryById('himars').sections.some(sec => sec.title === 'Заряджання'));
  await stat(new URL('../script/build-himars-model.py', import.meta.url));
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  assert.match(credits, /m142-himars\.glb[^\n]*\n[\s\S]*?script\/build-himars-model\.py/);
  assert.doesNotMatch(credits, /## m142-himars\.glb — M142 HIMARS\n/, 'old third-party section removed');
});

test('ground articles do not show the flights summary or carrier/munition pairs', async () => {
  const wiki = await readFile(new URL('../src/ref-wiki.js', import.meta.url), 'utf8');
  assert.match(wiki, /usageEl\.hidden = !usage \|\| entry\.group === 'ground' \|\| entry\.group === 'support';/);
  assert.match(wiki, /function relatedBlock\(entry\) \{\s*\n\s*if \(!related \|\| entry\.group === 'ground' \|\| entry\.group === 'support'\) return null;/);
});

test('the ATACMS article is a generated munition model recognised in mission tables', async () => {
  const e = entryById('atacms');
  assert.equal(e.group, 'munition');
  assert.equal(e.model.file, 'mgm-140-atacms');
  assert.ok(e.credit.generated && e.credit.note);
  for (const text of ['ATACMS', 'MGM-140', 'mgm140', 'ATACMS (M39)']) assert.equal(munitionId(text), 'atacms', text);
  assert.equal(munitionId('GMLRS M31'), 'gmlrs');
  const file = new URL('../src/models/mgm-140-atacms.glb', import.meta.url);
  assert.ok((await stat(file)).size < 4e5, 'procedural model stays tiny');
  assert.match(entryById('himars').sections.find(s => s.title === 'Боєприпаси').list.join(' '), /MGM-140 ATACMS/);
});

test('the GMLRS model is generated by a script in this repo and credited as such', async () => {
  const e = entryById('gmlrs');
  assert.ok(e.credit.generated && e.credit.note);
  const file = new URL('../src/models/gmlrs-m31.glb', import.meta.url);
  const bytes = await readFile(file);
  assert.ok(bytes.length < 4e5, 'procedural model stays tiny');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const names = new Set(json.nodes.map(n => n.name));
  for (const n of ['tip', 'nose', 'warhead', 'band', 'motor', 'bell', 'canard_0', 'canard_3', 'tail_fin_0', 'tail_fin_5']) assert.ok(names.has(n), `${n} present`);
  await stat(new URL('../script/build-gmlrs-model.py', import.meta.url));
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  assert.match(credits, /gmlrs-m31\.glb[^\n]*\n[\s\S]*?script\/build-gmlrs-model\.py/);
});

test('the M270 article is a generated ground model with its pods, tracks and launcher', async () => {
  const e = entryById('m270');
  assert.equal(e.group, 'ground');
  assert.equal(e.model.file, 'm270-mlrs');
  assert.ok(e.credit.generated && e.credit.note);
  assert.deepEqual(searchEntries('m270').map(x => x.id).filter(id => id === 'm270' || id === 'himars'), ['m270']);
  const bytes = await readFile(new URL('../src/models/m270-mlrs.glb', import.meta.url));
  assert.ok(bytes.length < 16e6, 'textured model stays within the load budget');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const names = new Set(json.nodes.map(n => n.name));
  for (const n of ['hull', 'tracks', 'tyres', 'hubs', 'cab', 'turret', 'launcher', 'boom_1', 'boom_2', 'pod_l', 'pod_r', 'pod_l_new', 'pod_r_new', 'pod_l_cable', 'strut_a_l', 'rod_b_r']) assert.ok(names.has(n), `${n} present`);
  // Заряджання: один кліп, який повзунок прокручує від стану «після пуску» до «заряджено».
  assert.equal(json.animations.length, 1);
  const [clip] = json.animations;
  assert.equal(clip.name, 'reload');
  const animated = new Set(clip.channels.map(c => json.nodes[c.target.node].name + '.' + c.target.path));
  for (const k of ['turret.rotation', 'launcher.rotation', 'boom_1.translation', 'pod_r.translation', 'pod_r.scale', 'pod_r_new.scale', 'pod_l_new.translation', 'pod_r_trolley.translation', 'boom_2.translation', 'strut_a_l.rotation', 'rod_a_l.translation']) assert.ok(animated.has(k), `${k} animated`);
  const times = json.accessors[clip.samplers[0].input];
  assert.equal(times.min[0], 0);
  assert.ok(times.max[0] > 10, 'clip long enough to follow');
  // Нові пакети на початку сховані, старі — на місці.
  const node = name => json.nodes.find(n => n.name === name);
  assert.ok(node('pod_r_new').scale.every(v => v < 0.01));
  assert.ok(Math.abs(node('launcher').rotation[2]) > 0.3, 'launcher raised at the start');
  // Найбільший поворот платформи під час заряджання — 90°.
  const yaw = json.accessors[clip.samplers[clip.channels.find(c => json.nodes[c.target.node].name === 'turret').sampler].output];
  assert.ok(Math.abs(Math.abs(yaw.min[1]) - Math.SQRT1_2) < 1e-3 || Math.abs(Math.abs(yaw.max[1]) - Math.SQRT1_2) < 1e-3, 'turns 90°');
  assert.equal(node('pod_r').scale, undefined);
  const action = e.model.action;
  assert.equal(action.label, 'Заряджання');
  assert.equal(action.ends.length, 2);
  assert.ok(action.seconds > 5 && action.hint);
  await stat(new URL('../script/build-m270-model.py', import.meta.url));
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  assert.match(credits, /m270-mlrs\.glb[^\n]*\n[\s\S]*?script\/build-m270-model\.py/);
  assert.match(entryById('m270').sections.find(sec => sec.title === 'Боєприпаси').list.join(' '), /MGM-140 ATACMS/);
});

// Українські системи в «Наземних засобах»: РСЗВ «Вільха» і ОТРК «Сапсан» — згенеровані моделі на спільному шасі 8×8.
test('Vilkha and Sapsan are generated ground models built on the shared 8x8 chassis', async () => {
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  for (const [id, file, script] of [['vilkha', 'vilkha', 'build-vilkha-model.py'], ['sapsan', 'sapsan', 'build-sapsan-model.py']]) {
    const e = entryById(id);
    assert.equal(e.group, 'ground');
    assert.equal(e.model.file, file);
    assert.ok(e.credit.generated && e.credit.note);
    assert.ok((await stat(new URL(`../src/models/${file}.glb`, import.meta.url))).size < 16e6);
    await stat(new URL(`../script/${script}`, import.meta.url));
    assert.ok(credits.includes(`${file}.glb`));
  }
  await stat(new URL('../script/vehicle_8x8.py', import.meta.url));
  assert.ok(searchEntries('вільха').some(e => e.id === 'vilkha'));
  assert.ok(searchEntries('сапсан').some(e => e.id === 'sapsan'));
});

// Машини забезпечення: евакуація й підвіз до пускових установок; окрема група, без підсумку по вильотах ПС і пар «носій — БП».
test('support vehicles live in their own group with generated models and no air-force summary', async () => {
  assert.ok(GROUPS.some(g => g.id === 'support' && g.title === 'Машини забезпечення'));
  const ids = ['m1084', 'm984', 'bpz2', 'hemtt-pods'];
  assert.deepEqual(searchEntries('', 'support').map(e => e.id), ids);
  const files = { m1084: 'm1084a1p2', m984: 'm984a2', bpz2: 'bergepanzer2', 'hemtt-pods': 'hemtt-pod-carrier' };
  const credits = await readFile(new URL('../src/models/CREDITS.md', import.meta.url), 'utf8');
  const scripts = { m1084: 'build-m1084-model.py', m984: 'build-m984-model.py', bpz2: 'build-bpz2-model.py', 'hemtt-pods': 'build-hemtt-pods-model.py' };
  for (const id of ids) {
    const e = entryById(id);
    assert.equal(e.group, 'support');
    assert.equal(e.model.file, files[id]);
    assert.ok(e.credit.generated && e.credit.note, `${id}: generated model, no third-party licence`);
    assert.deepEqual(carriersOf(id), []);
    assert.deepEqual(munitionsOf(id), []);
    const bytes = await readFile(new URL(`../src/models/${files[id]}.glb`, import.meta.url));
    assert.ok(bytes.length < 16e6, `${id}: textured model stays within the load budget`);
    await stat(new URL(`../script/${scripts[id]}`, import.meta.url));
    assert.match(credits, new RegExp(`${files[id]}\\.glb[^\\n]*\\n[\\s\\S]*?script/${scripts[id].replace(/\./g, '\\.')}`));
  }
  // Ракетні війська шукають і за українською назвою, і за типом.
  assert.deepEqual(searchEntries('брем').map(e => e.id).sort(), ['bpz2', 'm984']);
  assert.ok(searchEntries('пакетовоз').some(e => e.id === 'hemtt-pods'));
  const wiki = await readFile(new URL('../src/ref-wiki.js', import.meta.url), 'utf8');
  assert.match(wiki, /usageEl\.hidden = !usage \|\| entry\.group === 'ground' \|\| entry\.group === 'support';/);
});

// Довідник у модулі РВ: та сама вікі, але лише наземні засоби й ракети, без підсумку по таблиці вильотів ПС.
test('the РВ module has its own reference tab limited to ground systems and rockets', async () => {
  const rocket = await readFile(new URL('../src/rocket.html', import.meta.url), 'utf8');
  assert.match(rocket, /id="tab-ref"[^>]*>Довідник<\/button>/);
  assert.match(rocket, /<main id="view-ref"[^>]*hidden><\/main>/);
  assert.match(rocket, /<link rel="stylesheet" href="\.\/ref-wiki\.css">/);
  assert.match(rocket, /<script type="module" src="\.\/ref-wiki\.js"><\/script>/);
  assert.match(rocket, /window\.RefWiki\.mount\(\$\('#view-ref'\)/);
  const scope = /REF_SCOPE = \{ groups: \[([^\]]*)\], only: \[([^\]]*)\] \}/.exec(rocket);
  assert.ok(scope, 'scope declared');
  const ids = scope[2].match(/'([\w-]+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(ids.sort(), ['atacms', 'bpz2', 'gmlrs', 'hemtt-pods', 'himars', 'm1084', 'm270', 'm984', 'sapsan', 'vilkha']);
  assert.ok(scope[1].includes("'support'"), 'support vehicles group is shown in the РВ reference');
  for (const id of ids) assert.ok(entryById(id), `${id} exists`);
  assert.match(rocket, /usage: false, related: false/);
  // Командний режим УДШВ довідник не показує.
  assert.match(rocket, /html\[data-command="dshv"\] #tab-entry, html\[data-command="dshv"\] #tab-ref/);
  const wiki = await readFile(new URL('../src/ref-wiki.js', import.meta.url), 'utf8');
  for (const opt of ['groups', 'only', 'usage', 'related']) assert.match(wiki, new RegExp('\\b' + opt + '\\b'));
});

test('every ref-art file belongs to an article and comes as a silhouette + outline pair', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(new URL('../src/ref-art/', import.meta.url))).filter(f => f.endsWith('.webp'));
  assert.ok(files.length >= 10, 'ref-art is not empty');
  const ids = new Set(files.map(f => f.replace(/-(sil|lin)\.webp$/, '')));
  for (const id of ids) {
    assert.ok(entryById(id), `${id}: ref-art file has no article`);
    assert.ok(files.includes(`${id}-sil.webp`) && files.includes(`${id}-lin.webp`), `${id}: needs both -sil and -lin`);
  }
  const wiki = await readFile(new URL('../src/ref-wiki.js', import.meta.url), 'utf8');
  assert.match(wiki, /import\('\.\/ref-art-urls\.js'\)/, 'ref-wiki loads art lazily, not through a static import.meta.glob');
  assert.doesNotMatch(wiki, /import\.meta\.glob/, 'import.meta.glob would break the Node tests');
});
