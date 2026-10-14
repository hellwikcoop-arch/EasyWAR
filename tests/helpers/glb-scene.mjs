// Читає .glb із src/models у сцену three.js без браузера: текстури вирізаються (їм потрібен DOM), геометрія, вузли й анімації
// лишаються як є. Потрібно тестам, що перевіряють розрізання й риги реальних моделей довідника.
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const MODELS = new URL('../../src/models/', import.meta.url);
const cache = new Map();

function stripTextures(buf) {
  const head = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = head.getUint32(12, true);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) {
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
    const p = m.pbrMetallicRoughness;
    if (p) { delete p.baseColorTexture; delete p.metallicRoughnessTexture; }
    if (m.extensions) delete m.extensions;
  }
  json.extensionsUsed = (json.extensionsUsed || []).filter(e => !/texture/i.test(e));
  json.extensionsRequired = (json.extensionsRequired || []).filter(e => !/texture/i.test(e));
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = Buffer.from(text, 'utf8');
  const binStart = 20 + jsonLen;
  const bin = buf.subarray(binStart);
  const out = Buffer.alloc(12 + 8 + jsonBytes.length + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonBytes.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(out, 20);
  bin.copy(out, 20 + jsonBytes.length);
  return out;
}

function parse(name) {
  const raw = readFileSync(new URL(name + '.glb', MODELS));
  const buf = stripTextures(raw);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(ab, '');
}

// name — ім'я файлу без розширення (наприклад, 'm142-himars'). Повертає { scene, animations }; результат кешується.
// fresh — окрема копія, яку можна різати й міняти, не зачіпаючи кеш (інші тести читають оригінал).
export async function loadGlbScene(name, { fresh = false } = {}) {
  if (fresh) { const gltf = await parse(name); return { scene: gltf.scene, animations: gltf.animations }; }
  if (!cache.has(name)) cache.set(name, parse(name));
  const gltf = await cache.get(name);
  return { scene: gltf.scene, animations: gltf.animations };
}
