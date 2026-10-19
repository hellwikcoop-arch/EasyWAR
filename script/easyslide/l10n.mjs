// Перетворює словник інтерфейсу EasySlide (uk.tsv) на таблиці Rust для apps/deckcraft-web/src/uk_table.rs.
//   node script/easyslide/l10n.mjs <uk.tsv> <uk_table.rs>
// Формат uk.tsv: «англійський рядок<TAB>український», як рядкові літерали Rust без лапок (`\n` — два
// символи); `{}` — підставлений текст, у перекладі `{}` по порядку або `{1}`, `{2}`… Порожній переклад
// і рядки з `#` пропускаються.
import fs from 'node:fs';

export function parseDictionary(text) {
  const exact = [];
  const patterns = [];
  const problems = [];
  const seen = new Set();
  text.split('\n').forEach((line, index) => {
    if (!line.trim() || line.startsWith('#')) return;
    const tab = line.indexOf('\t');
    const where = `рядок ${index + 1}`;
    if (tab < 0) return problems.push(`${where}: немає табуляції`);
    const en = line.slice(0, tab);
    const uk = line.slice(tab + 1);
    if (!uk) return;
    if (uk.includes('\t')) return problems.push(`${where}: зайва табуляція`);
    for (const value of [en, uk]) {
      if (/(^|[^\\])"/.test(value) || /\\$/.test(value.replace(/\\\\/g, ''))) problems.push(`${where}: лапки або \\ без пари`);
    }
    if (seen.has(en)) return problems.push(`${where}: повтор «${en}»`);
    seen.add(en);
    const holes = en.split('{}').length - 1;
    if (holes) {
      const numbered = [...uk.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      const plain = uk.split('{}').length - 1;
      const ok = numbered.length ? numbered.every((n) => n >= 1 && n <= holes) && new Set(numbered).size === holes && !plain : plain === holes;
      if (!ok) return problems.push(`${where}: місця {} не збігаються: «${en}» → «${uk}»`);
      patterns.push([en, uk]);
    } else {
      if (/\{\d*\}/.test(uk)) return problems.push(`${where}: {} у перекладі без місця в оригіналі`);
      exact.push([en, uk]);
    }
  });
  // Довші шаблони перевіряються першими: «Slide {} of {}» раніше за «{}…».
  patterns.sort((a, b) => b[0].replace(/\{\}/g, '').length - a[0].replace(/\{\}/g, '').length);
  return { exact, patterns, problems };
}

export function renderTable({ exact, patterns }) {
  const rows = (list) => list.map(([en, uk]) => `    ("${en}", "${uk}"),`).join('\n');
  return `// Згенеровано script/easyslide/l10n.mjs з script/easyslide/uk.tsv (EasyWAR). Не редагувати вручну.\n`
    + `static EXACT: &[(&str, &str)] = &[\n${rows(exact)}\n];\n`
    + `static PATTERNS: &[(&str, &str)] = &[\n${rows(patterns)}\n];\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  const dictionary = parseDictionary(fs.readFileSync(input, 'utf8'));
  if (dictionary.problems.length) {
    console.error(dictionary.problems.join('\n'));
    process.exit(1);
  }
  fs.writeFileSync(output, renderTable(dictionary));
  console.log(`EasySlide uk: ${dictionary.exact.length} рядків, ${dictionary.patterns.length} шаблонів`);
}
