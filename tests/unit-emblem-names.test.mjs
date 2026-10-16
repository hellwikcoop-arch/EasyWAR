import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { EMBLEM_FILE_NAMES, emblemFile } from '../src/unit-emblems-core.js';

// Спільний пошук емблем за назвою підрозділу (Артилерія й дашборд УДШВ). Вбудовані емблеми ПС і РВ перевіряє unit-emblems.test.mjs.
const dir = new URL('../src/unit-art/', import.meta.url);

test('emblem list matches the files in src/unit-art', () => {
  const files = readdirSync(dir).filter(f => f.endsWith('.webp')).map(f => f.replace(/\.webp$/, '')).sort();
  assert.deepEqual([...EMBLEM_FILE_NAMES].sort(), files);
});

test('emblemFile resolves unit names by number and type, ignoring case and spacing', () => {
  const cases = {
    '79 одшбр': '79-odshbr', '79 ОДШБр': '79-odshbr', '80 ОШБр': '80-odshbr', '82одшбр': '82-odshbr', '95 одшбр': '95-odshbr',
    '1 ошп': '1-oshp', '425 ОШП': '425-oshp', '225 ошп': '225-oshp', '475 ошп': '475-oshp',
    '78 ОДШБр': '78-odshbr', '71 оєбр': '71-oebr', '71 оебр': '71-oebr', '67 омбр': '67-ombr',
    'АГр, РУК 148 оабр': '148-oabr', 'АГ 148 оабр': '148-oabr', 'РУК 148 оабр': '148-oabr',
    'ГРВ 1/1/107 реабр': '107-reabr', 'Арез №2': 'arez2-148-44', 'ГРВ 79 одшбр': '79-odshbr',
  };
  for (const [name, file] of Object.entries(cases)) {
    assert.equal(emblemFile(name), file, name);
    assert.ok(EMBLEM_FILE_NAMES.includes(file), `${name} → ${file} must exist`);
  }
});

test('emblemFile returns null for units without an emblem and for junk', () => {
  for (const name of ['А ПС', '1 ДШБ', '99 омбр', '79', 'одшбр', '', null, undefined]) assert.equal(emblemFile(name), null, String(name));
});
