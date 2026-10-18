// Каталог шаблонів модулів, прочитаний з коду Rust (`catalog()` у dashboard_modules.rs).
// Тести підтягування даних з таблиці перевіряють на ньому всі 20 шаблонів, а не лише журнал польотів.
import { readFile } from 'node:fs/promises';

const FIELD = /(field|dimension|metric)\(\s*"([a-z_0-9]+)",\s*"([^"]+)"(?:,\s*"(\w+)",\s*"(\w+)",\s*"(\w+)",\s*(true|false))?\s*,?\s*\)/g;

export async function rustCatalog() {
  const source = await readFile(new URL('../../src-tauri/src/dashboard_modules.rs', import.meta.url), 'utf8');
  const start = source.indexOf('pub fn catalog()');
  const end = source.indexOf('fn valid_branch');
  if (start < 0 || end < start) throw new Error('catalog() не знайдено в dashboard_modules.rs');
  return source.slice(start, end).split(/\n {8}template\(\n/u).slice(1).map(chunk => {
    const id = /^\s*"([^"]+)"/u.exec(chunk)[1];
    const fields = [...chunk.matchAll(FIELD)].map(([, kind, key, label, dataType, role, aggregation, required]) => {
      if (kind === 'field') return { key, label, dataType, role, aggregation, required: required === 'true' };
      if (kind === 'dimension') return { key, label, dataType: 'text', role: 'dimension', aggregation: 'none', required: true };
      return { key, label, dataType: 'real', role: 'metric', aggregation: 'sum', required: true };
    });
    return { id, fields };
  });
}
