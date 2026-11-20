// Ангар замість старих довідників техніки: статті ref-data лишаються, а 3D відкриває hangar/.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ENTRIES, aircraftId, munitionId, searchEntries } from '../src/ref-data.js';
import {
  HUB_LINKS, REF_HANGAR, RETIRED_GUIDE_IDS, UNMAPPED_EQUIPMENT, UNMAPPED_GUIDE, hangarHref, hangarTarget,
} from '../src/hangar-catalog-core.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const quoted = (source, name) => {
  const found = source.match(new RegExp(`${name}=\\[([\\s\\S]*?)\\];`));
  assert.ok(found, name);
  return [...found[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
};

test('кожна зіставлена стаття є в довіднику, а її модель є в ангарі чи гаражі', async () => {
  const garage = await read('hangar/src/garage_data.js');
  const enemy = await read('hangar/src/garage_en.js');
  const airEn = await read('hangar/src/hud_en.js');
  const html = await read('hangar/EasyWAR_hangar.html');
  const uaGround = new Set(quoted(garage, 'let GV_ORDER'));
  const enGround = new Set(quoted(enemy, 'const EN_ORDER'));
  const enAir = new Set(quoted(airEn, 'const EN_AIR'));
  const uaAir = new Set(['mig', 'f16', 'su', 'mi8', 'mi24', 'il', 'su24', 'm2k', 'su25', 'gripen']);
  for (const id of uaAir) assert.match(html, new RegExp(`'${id}'`));
  assert.match(html, /set\.pick=parts\[1\]\|\|hq\.get\('v'\)/);
  const ids = new Set(ENTRIES.map((entry) => entry.id));
  for (const [refId, target] of Object.entries(REF_HANGAR)) {
    assert.ok(ids.has(refId), refId);
    const pool = target.mode === 'hangar' ? uaAir : target.mode === 'enemy-air' ? enAir : target.mode === 'enemy' ? enGround : uaGround;
    assert.ok(pool.has(target.id), `${refId} → ${target.mode}/${target.id}`);
    if (target.cat) assert.ok(['tank', 'ifv', 'art', 'ad', 'eng'].includes(target.cat), target.cat);
    const href = hangarHref(target);
    assert.match(href, /^\.\/hangar\/EasyWAR_hangar\.html\?/);
    assert.match(href, new RegExp(`[?&]v=${target.id}(?:&|#)`));
    assert.match(href, new RegExp(`#${target.mode}$`));
  }
});

test('пошук і розпізнавання назв із таблиці не залежать від ангара', () => {
  assert.equal(aircraftId('МіГ-29'), 'mig29');
  assert.equal(munitionId('GBU-62'), '62');
  assert.equal(hangarTarget('62'), null, 'боєприпас лишається в старому довіднику');
  assert.ok(searchEntries('HIMARS').some((entry) => entry.id === 'himars'));
  assert.equal(hangarTarget('himars').id, 'himars');
  for (const row of UNMAPPED_EQUIPMENT) {
    assert.ok(ENTRIES.some((entry) => entry.id === row.id), row.id);
    assert.equal(hangarTarget(row.id), null, row.id);
    assert.ok(row.why.length > 10, row.id);
  }
});

test('хаб веде в ангар, а старі каталоги техніки не входять у збірку', async () => {
  const cfg = await read('vite.config.js');
  const hub = await read('src/guides/hub.js');
  assert.match(hub, /hangarHref/);
  assert.match(hub, /\.\/uav\/index\.html/);
  assert.match(hub, /\.\/brigades\/index\.html/);
  assert.match(cfg, /!rel\.startsWith\("hangar\/"\)/);
  assert.match(cfg, /easywar-hangar-static/);
  for (const id of RETIRED_GUIDE_IDS) {
    assert.doesNotMatch(cfg, new RegExp(`"guides-${id}":`), id);
    assert.doesNotMatch(hub, new RegExp(`\\./${id}/index\\.html`), id);
  }
  assert.match(cfg, /"guides-uav":/);
  for (const link of HUB_LINKS) {
    const href = hangarHref(link, '../');
    assert.match(href, /^\.\.\/hangar\/EasyWAR_hangar\.html/);
    assert.match(href, new RegExp(`#${link.mode}$`));
  }
  assert.ok(UNMAPPED_GUIDE.length >= 6);
});
