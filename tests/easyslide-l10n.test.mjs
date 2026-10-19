import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDictionary, renderTable } from '../script/easyslide/l10n.mjs';

test('словник інтерфейсу EasySlide без помилок', () => {
  const dictionary = parseDictionary(fs.readFileSync(new URL('../script/easyslide/uk.tsv', import.meta.url), 'utf8'));
  assert.deepEqual(dictionary.problems, []);
  assert.ok(dictionary.exact.length > 1500);
  const exact = new Map(dictionary.exact);
  assert.equal(exact.get('Home'), 'Основне');
  assert.equal(exact.get('Insert'), 'Вставлення');
  assert.equal(exact.get('Save As…'), 'Зберегти як…');
  assert.ok(dictionary.patterns.some(([en]) => en === 'Slide {} of {}'));
});

test('перевірка словника: місця {}, лапки, повтори', () => {
  const { problems } = parseDictionary([
    'Slide {} of {}\tСлайд {}',
    'Bold\tЖирний "B"',
    'Bold\tЖирний',
    'Bold\tЖирний',
    'Open {}\t{1} {2}',
    'Close\tЗакрити {}',
    'без табуляції',
  ].join('\n'));
  assert.equal(problems.length, 7);
});

test('шаблони впорядковано від довших, таблиця Rust', () => {
  const dictionary = parseDictionary('# коментар\n{}…\t{}…\nSlide {} of {}\t{2}: слайд {1}\nAa\t\nHome\tОсновне\n');
  assert.deepEqual(dictionary.patterns.map(([en]) => en), ['Slide {} of {}', '{}…']);
  assert.equal(dictionary.exact.length, 1);
  const rust = renderTable(dictionary);
  assert.match(rust, /static EXACT: &\[\(&str, &str\)\] = &\[\n {4}\("Home", "Основне"\),\n\];/);
  assert.match(rust, /\("Slide \{\} of \{\}", "\{2\}: слайд \{1\}"\)/);
});
