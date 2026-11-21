import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const asset = (name) => new URL(`../src/public/map-assets/${name}`, import.meta.url);
const readSrc = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

function loadGeoCoreIsolated() {
  const code = readSrc('map-app.js');
  const start = code.indexOf('function geoCore(){');
  assert.ok(start > 0, 'geoCore має лишатися окремою функцією');
  let depth = 0, end = start;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  // Суворо ізольований контекст Web Worker: без зовнішніх змінних типу SCALE
  return new vm.Script(`(${code.slice(start, end)})`).runInNewContext({
    Math,
    Float32Array,
    Float64Array,
    Uint32Array,
    Uint8Array,
    Uint16Array,
    DataView,
    Error,
    String,
  });
}

test('префаби забудови: 10 багатоповерхівок і 10 приватних будинків у валідному форматі GLB', () => {
  const idxPath = asset('prefabs/index.json');
  assert.ok(existsSync(idxPath), 'prefabs/index.json має існувати');
  const manifest = JSON.parse(readFileSync(idxPath, 'utf8'));
  assert.equal(manifest.highrises.length, 10, 'має бути 10 багатоповерхівок');
  assert.equal(manifest.houses.length, 10, 'має бути 10 приватних будинків');

  for (const item of [...manifest.highrises, ...manifest.houses]) {
    const fileUrl = asset(item.file);
    assert.ok(existsSync(fileUrl), `файл ${item.file} має існувати`);
    const sz = statSync(fileUrl).size;
    assert.ok(sz > 1000 && sz < 512_000, `${item.file}: розмір ${sz} байт у межах ліміту`);
    const buf = readFileSync(fileUrl);
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF', `${item.file}: магічне число glTF`);
    assert.equal(buf.readUInt32LE(4), 2, `${item.file}: версія glTF 2.0`);
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    assert.equal(gltf.asset?.extras?.license, 'CC0-1.0', `${item.file}: ліцензія CC0-1.0`);
    assert.ok(gltf.meshes?.length === 1, `${item.file}: один меш`);
    assert.ok(item.triangles > 20, `${item.file}: достатня кількість трикутників`);
  }
});

test('buildCity у контексті Web Worker штампує 20 архетипів на синтетичних DNB2 і DNB3 без NaN і без зовнішніх глобалів', () => {
  const SCALE = 1 / 68900;
  const META = { w: 2048, h: 1398, lon0: 21.9, lon1: 40.5, lat0: 44.05, lat1: 52.5, sp1: 45.7, sp2: 51, scale: SCALE };
  const core = loadGeoCoreIsolated()();
  core.setup(META);

  // 1) Синтетичний міський пакет DNB2: 10 багатоповерхівок + 10 приватних будинків
  const count = 20;
  const parts = [];
  const hdr = Buffer.alloc(8);
  hdr.write('DNB2', 0);
  hdr.writeUInt32LE(count, 4);
  parts.push(hdr);
  for (let b = 0; b < count; b++) {
    const isHigh = b < 10;
    const h = isHigh ? 260 : 45; // 26.0 м та 4.5 м
    const cat = isHigh ? 1 : 0;
    const rec = Buffer.alloc(4 + 4 * 4 + 2 * 3);
    rec[0] = 4;
    rec.writeUInt16LE(h, 1);
    rec[3] = cat;
    const x0 = b * 80, y0 = 120, w = isHigh ? 60 : 24, l = isHigh ? 32 : 20;
    const pts = [[x0, y0], [x0, y0 + l], [x0 + w, y0 + l], [x0 + w, y0]];
    pts.forEach(([x, y], i) => {
      rec.writeUInt16LE(x, 4 + i * 4);
      rec.writeUInt16LE(y, 4 + i * 4 + 2);
    });
    const tOff = 20;
    rec[tOff] = 0; rec[tOff + 1] = 1; rec[tOff + 2] = 2;
    rec[tOff + 3] = 0; rec[tOff + 4] = 2; rec[tOff + 5] = 3;
    parts.push(rec);
  }
  const u8Dnb2 = new Uint8Array(Buffer.concat(parts));
  const opts = {
    skipCat: -1,
    fac: { 0: [6, 3.2], 1: [15.63, 14], 2: [8, 4], 3: [6, 3.6], 4: [4, 3] },
    colors: [[0.85, 0.78, 0.68], [0.78, 0.8, 0.84], [0.72, 0.75, 0.78], [0.85, 0.69, 0.51], [0.64, 0.61, 0.58]],
  };
  const r2 = core.buildCity(u8Dnb2, { b: [34.85, 35.25, 48.37, 48.56], lonM: 73800 }, opts);
  const vCount2 = r2.pos.length / 3;
  // Плоскі коробки для 20×4=80 кутів дали б лише 320 вершин; з дахами, надбудовами й терасами їх має бути суттєво більше
  assert.ok(vCount2 > 500, `очікується детальна геометрія (>500 вершин), отримано ${vCount2}`);
  assert.ok(r2.groups.length >= 4, 'окремі групи для дахів і стін');
  for (let i = 0; i < r2.pos.length; i++) assert.ok(Number.isFinite(r2.pos[i]), 'усі координати скінченні');
  for (let i = 0; i < r2.idx.length; i++) assert.ok(r2.idx[i] < vCount2, 'індекс у межах масиву вершин');

  // 2) Синтетичний сільський пакет DNB3 (орієнтовані бокси n=0)
  const vCountBoxes = 10;
  const vBuf = Buffer.alloc(8 + vCountBoxes * 10);
  vBuf.write('DNB3', 0);
  vBuf.writeUInt32LE(vCountBoxes, 4);
  for (let b = 0; b < vCountBoxes; b++) {
    const off = 8 + b * 10;
    vBuf[off] = 0; // box record
    vBuf.writeUInt16LE(100 + b * 30, off + 1);
    vBuf.writeUInt16LE(200, off + 3);
    vBuf[off + 5] = 20; // 10m
    vBuf[off + 6] = 16; // 8m
    vBuf[off + 7] = (b * 23) & 255;
    vBuf[off + 8] = 8; // 4m
    vBuf[off + 9] = 0; // house
  }
  const r3 = core.buildCity(new Uint8Array(vBuf), { b: [35.0, 35.5, 48.0, 48.4], lonM: 73800 }, opts);
  const vCount3 = r3.pos.length / 3;
  assert.ok(vCount3 > 160, `DNB3 має містити скатні дахи (>160 вершин), отримано ${vCount3}`);
  for (let i = 0; i < r3.idx.length; i++) assert.ok(r3.idx[i] < vCount3, 'індекс DNB3 у межах вершин');
});
