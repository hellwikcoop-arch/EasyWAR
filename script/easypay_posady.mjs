// Генерує src/workspace/easypay/posady-317.js з таблиці наказу МОУ №317 (Перелік 2, ред. 07.04.2026),
// збереженої як є у CSV (у файлах проєкту: plans/easypay/rozriady-posad-317.csv). CSV у репозиторій
// не кладемо (.gitignore: *.csv). Запуск: node script/easypay_posady.mjs <шлях до CSV>
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const target = new URL('src/workspace/easypay/posady-317.js', root);

/** Розбір CSV з лапками (RFC 4180). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** «7/6» → [7, 6]; «10» → [10, 10]; порожньо → null. */
function grades(text) {
  const match = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2] ?? match[1])] : null;
}

export function buildPosts(rows) {
  const posts = [];
  for (const [n, code, title, rank, , condition, grade] of rows.slice(1)) {
    if (n) {
      if (!title.trim()) continue; // виключені позиції (лише номер і код)
      posts.push({ code, title: title.trim(), rank: rank.trim(), lead: '', options: [] });
      const current = posts.at(-1);
      const value = grades(grade);
      if (value) current.options.push([condition.trim(), ...value]);
      else current.lead = condition.trim();
    } else if (posts.length) {
      const value = grades(grade);
      if (value) posts.at(-1).options.push([condition.trim(), ...value]);
    }
  }
  return posts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv[2]) throw new Error('Вкажіть шлях до CSV таблиці наказу №317.');
  const posts = buildPosts(parseCsv(await readFile(process.argv[2], 'utf8')));
  const body = posts.map(post => JSON.stringify([post.code, post.title, post.rank, post.lead, post.options])).join(',\n');
  await writeFile(target, `// Згенеровано script/easypay_posady.mjs з таблиці наказу №317 (rozriady-posad-317.csv) — не редагувати вручну.
// Наказ МОУ №317 від 07.09.2020, Перелік 2 (ред. 07.04.2026): посади рядового, сержантського і
// старшинського складу та їхні тарифні розряди. Рядок: [код посади, посада, звання, умова-заголовок,
// [[умова, розряд для контракту/мобілізованих, розряд для строкової служби], …]].
export const POSTS_317 = Object.freeze([
${body},
].map(([code, title, rank, lead, options]) => Object.freeze({ code, title, rank, lead, options: Object.freeze(options.map(([condition, contract, conscript]) => Object.freeze({ condition, contract, conscript }))) })));
`);
  console.log(`posady-317.js: ${posts.length} посад, ${posts.filter(p => !p.options.length).length} без розряду`);
}
