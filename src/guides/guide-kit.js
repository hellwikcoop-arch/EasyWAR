// Спільні дрібниці 3D-довідників (src/guides/*). Мережа не використовується: усі моделі лежать у збірці застосунку.
import {ShaderChunk} from 'three';

// Довідники затверджено на three r160. У новіших версіях відбиття від шорстких поверхонь стали дзеркальнішими
// (відхилення вектора відбиття до нормалі — roughness^4 замість roughness^2), через що фарба й метал виглядають глянцевішими.
// Повертаємо колишню формулу в шейдерному шматку. Виконується один раз під час імпорту, до першої компіляції матеріалів.
export const LEGACY_REFLECTIONS = (() => {
  const key = 'envmap_physical_pars_fragment', src = ShaderChunk[key];
  const patched = src.replace('mix( reflectVec, normal, pow4( roughness ) )', 'mix( reflectVec, normal, roughness * roughness )');
  if (patched === src) return false; // у цій версії three шматок інший: лишається вигляд three як є
  ShaderChunk[key] = patched;
  return true;
})();

// Читає локальний файл (наприклад, .glb) як ArrayBuffer для GLTFLoader.parse.
export async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не вдалося прочитати ' + url + ' (' + res.status + ')');
  return res.arrayBuffer();
}

// Заміна THREE.Clock, який у новіших версіях three застарів: секунди між викликами.
export function makeClock() {
  let last = performance.now();
  return {
    getDelta() {
      const now = performance.now(), dt = (now - last) / 1000;
      last = now;
      return dt;
    },
  };
}
