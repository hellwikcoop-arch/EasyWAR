import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderReferences, REFERENCE_OUTPUTS } from '../script/assistant_reference_core.mjs';
import { searchKnowledge, KNOWLEDGE_SOURCE_FILES, UNKNOWN_ANSWER } from '../src/assistant/assistant-knowledge-core.js';
import * as air from '../src/ref-data.js';
import * as artillery from '../src/artillery-ref-data.js';

const root = new URL('../', import.meta.url);
const index = JSON.parse(await readFile(new URL('src/assistant/knowledge/index.json', root), 'utf8'));
const ask = query => searchKnowledge(index, query, { maxResults: 1 });

test('generated reference files match the built-in reference data and are indexed', async () => {
  const rendered = renderReferences();
  assert.deepEqual([...rendered.keys()], REFERENCE_OUTPUTS);
  for (const [file, text] of rendered) {
    assert.equal(await readFile(new URL(file, root), 'utf8'), text, `${file} застарів: node script/assistant_reference.mjs`);
    assert.ok(KNOWLEDGE_SOURCE_FILES.includes(file));
    assert.ok(index.sources.includes(file));
  }
  assert.ok(KNOWLEDGE_SOURCE_FILES.includes('docs/DATA_REFERENCE.md'));
});

test('every reference article is present in the generated text', () => {
  const [airText, artilleryText] = [...renderReferences().values()];
  for (const entry of air.ENTRIES) assert.ok(airText.includes(`### ${entry.name}`), entry.id);
  for (const entry of artillery.ENTRIES) {
    assert.ok(artilleryText.includes(`### ${entry.name}`), entry.id);
    for (const variant of artillery.variantsOf(entry)) assert.ok(artilleryText.includes(`#### ${variant.label}`), variant.id);
  }
});

test('reference text carries no credits, model files or private data', () => {
  for (const text of renderReferences().values()) {
    assert.doesNotMatch(text, /sketchfab|CC BY|\.glb|authorUrl|base64/iu);
  }
});

test('questions about reference facts get a focused answer with its source', () => {
  const cases = [
    ['Яка дальність МіГ-29?', 'AIR_REFERENCE', /1 400 км/u],
    ['Яка маса снаряда M795?', 'ARTILLERY_REFERENCE', /46,9 кг/u],
    ['Яка вага GBU-39?', 'AIR_REFERENCE', /129 кг/u],
    ['Які уразливі місця Ка-52?', 'AIR_REFERENCE', /Співвісна колонка/u],
  ];
  for (const [query, file, expected] of cases) {
    const answer = ask(query);
    assert.equal(answer.status, 'found', query);
    assert.match(answer.sources[0].file, new RegExp(file, 'u'), query);
    assert.match(answer.text, expected, query);
  }
});

test('dictionary and analytics questions are answered from the data reference', () => {
  const cases = [
    ['Які є причини не ураження?', /Несхід боєприпасу/u],
    ['Які типи цілей є?', /Накопичення о\/с/u],
    ['Які результати ураження в ракетних військах?', /ПОДАВЛЕНО/u],
    ['Що таке відбій?', /не входить до оцінки ефективності/u],
    ['Який коефіцієнт зваженої ефективності?', /0,75/u],
  ];
  for (const [query, expected] of cases) {
    const answer = ask(query);
    assert.equal(answer.status, 'found', query);
    assert.match(answer.sources[0].file, /DATA_REFERENCE/u, query);
    assert.match(answer.text, expected, query);
  }
});

test('Cyrillic look-alikes in designations still find the Latin reference articles', () => {
  const answer = ask('Яка дальність М142?');
  assert.notEqual(answer.status, 'refused');
});

test('questions outside the reference stay unanswered instead of guessed', () => {
  assert.equal(ask('Яка ціна літака МіГ-29?').text.includes('Ціна'), false);
  assert.equal(ask('Скільки записів уражень за вересень?').text, UNKNOWN_ANSWER);
});

test('searching the full index stays fast after the first call', () => {
  ask('Яка дальність МіГ-29?');
  const started = performance.now();
  for (let i = 0; i < 20; i++) ask('Яка маса снаряда M795?');
  assert.ok((performance.now() - started) / 20 < 40);
});
