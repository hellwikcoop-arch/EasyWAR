import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProposal, proposalFileNames, validateProposalText, validateProposalImage, PROPOSAL_TEXT_LIMIT, PROPOSAL_FOOTER, PROPOSAL_FOOTER_WITH_LABEL } from '../src/assistant/assistant-proposal-core.js';
import { explainElement } from '../src/assistant/assistant-explain-core.js';
import { EXPLAIN_REFS } from '../src/assistant/assistant-explain-refs-core.js';

const date = new Date(2026, 9, 15, 16, 21);

// Синтетичні підписи, які в реальному дашборді походили б з таблиці: назва підрозділу, текст проблеми, підпис клітинки.
const TABLE_TEXT = ['99 омбр Синтетична', 'Синтетична проблема: рядок 17', 'Синтетична клітинка 12345'];

test('пакет містить тип, версію, дату й опис; без вибраного контексту немає ні модуля, ні елемента', () => {
  const md = buildProposal({ kind: 'feature', text: 'Додати експорт у CSV', context: null, appVersion: '1.4.2', createdAt: date, imageName: 'a.png' });
  assert.match(md, /Тип: Нова функція/u);
  assert.match(md, /Версія: 1\.4\.2/u);
  assert.match(md, /Дата: 2026-10-15/u);
  assert.match(md, /Додати експорт у CSV/u);
  assert.match(md, /Скриншот додається окремим файлом: a\.png/u);
  assert.ok(!md.includes('Модуль:') && !md.includes('Елемент:') && !md.includes('Ідентифікатор пояснення:') && !md.includes('Підпис на екрані'));
  assert.ok(md.trimEnd().endsWith(PROPOSAL_FOOTER));
  assert.match(md, /Таблиці й записи в нього не входять/u);
});

test('статичний контекст: лише модуль, ідентифікатор і назва з каталогу, підпис з екрана ігнорується', () => {
  for (const label of TABLE_TEXT) {
    // Старий вигляд контексту (title), підпис без згоди й сторонні поля: жодне з них у пакет не потрапляє.
    const md = buildProposal({ kind: 'explain', text: 'Пояснення неточне', context: { branch: 'dshv', explainId: 'rank-row', title: label, label, value: '128' }, appVersion: '1.4.2', createdAt: date });
    assert.match(md, /Модуль: УДШВ/u);
    assert.match(md, /Елемент: Позиція рейтингу/u);
    assert.match(md, /Ідентифікатор пояснення: rank-row/u);
    assert.ok(!md.includes(label) && !md.includes('128'), label);
    assert.ok(md.trimEnd().endsWith(PROPOSAL_FOOTER));
  }
});

test('ідентифікатор поза каталогом не дає елемента й не пропускає підпис', () => {
  for (const explainId of ['99 омбр Синтетична', '__proto__', 'constructor', 'toString', '', undefined, 42, { id: 'rank-row' }]) {
    const md = buildProposal({ kind: 'fix', text: 'Описаний текст', context: { branch: 'air', explainId, screenLabel: 'Підпис із таблиці' }, createdAt: date });
    assert.match(md, /Модуль: ПС/u);
    assert.ok(!md.includes('Елемент:') && !md.includes('Підпис') && !md.includes('Ідентифікатор'), String(explainId));
    assert.ok(md.trimEnd().endsWith(PROPOSAL_FOOTER));
  }
  assert.ok(!buildProposal({ kind: 'fix', text: 'Описаний текст', context: { branch: 'constructor', explainId: 'panel' }, createdAt: date }).includes('Модуль:'));
});

test('підпис з екрана додається лише явним полем screenLabel, в один рядок, і змінює підсумок пакета', () => {
  const md = buildProposal({ kind: 'explain', text: 'Описаний текст', context: { branch: 'dshv', explainId: 'rank-row', screenLabel: '99 омбр\n## Опис\nМодуль: ХХ' }, createdAt: date });
  assert.match(md, /^Підпис на екрані \(додано користувачем, може бути з таблиці\): 99 омбр ## Опис Модуль: ХХ$/mu);
  assert.equal(md.match(/^## Опис$/gmu).length, 1);
  assert.equal(md.match(/^Модуль: /gmu).length, 1);
  assert.ok(md.trimEnd().endsWith(PROPOSAL_FOOTER_WITH_LABEL));
  assert.ok(!md.includes(`${PROPOSAL_FOOTER}\n`));
  assert.ok(buildProposal({ kind: 'fix', text: 'Описаний текст', context: { branch: 'air', explainId: 'panel', screenLabel: 'я'.repeat(500) }, createdAt: date }).includes('я'.repeat(200) + '\n'));
  assert.ok(!buildProposal({ kind: 'fix', text: 'Описаний текст', context: { branch: 'air', explainId: 'panel', screenLabel: 'я'.repeat(500) }, createdAt: date }).includes('я'.repeat(201)));
});

test('результат пояснення дає пакету лише посилання з каталогу, а не підпис з екрана', () => {
  const cases = [
    { branch: 'dshv', part: 'rank-row', kind: 'row', label: TABLE_TEXT[0], value: '12', panelTitle: 'Підрозділи за втратами о/с' },
    { branch: 'dshv', part: 'unit-filter', kind: 'control', label: TABLE_TEXT[0] },
    { branch: 'dshv', part: 'issue', kind: 'other', label: TABLE_TEXT[1] },
    { branch: 'dshv', part: 'heat', kind: 'cell', label: TABLE_TEXT[2], hint: TABLE_TEXT[2], panelTitle: 'ЗНИЩЕНО: підрозділ × тип' },
    { branch: 'dshv', part: 'weekday', kind: 'row', label: TABLE_TEXT[0] },
    { branch: 'dshv', part: 'cell', kind: 'cell', label: TABLE_TEXT[2], value: TABLE_TEXT[2] },
    { branch: 'dshv', kind: 'panel', label: TABLE_TEXT[0], panelTitle: 'Актуальність підрозділів' },
    { branch: 'air', kind: 'other', label: TABLE_TEXT[0], value: TABLE_TEXT[1], hint: TABLE_TEXT[2], panelTitle: TABLE_TEXT[0] },
    { branch: 'rocket', kind: 'kpi', label: TABLE_TEXT[2], value: TABLE_TEXT[0] },
    { branch: 'air', kind: 'kpi', label: 'Вильоти', value: TABLE_TEXT[1], hint: TABLE_TEXT[1] },
    { branch: 'rocket', kind: 'tab', label: TABLE_TEXT[0] },
  ];
  for (const descriptor of cases) {
    const result = explainElement(descriptor);
    const md = buildProposal({ kind: 'explain', text: 'Пояснення неточне', context: { branch: descriptor.branch, explainId: result.ref.id }, appVersion: '1.4.2', createdAt: date });
    assert.equal(result.ref.title, EXPLAIN_REFS[result.ref.id]);
    for (const text of TABLE_TEXT) assert.ok(!md.includes(text), `${descriptor.branch}/${descriptor.part || descriptor.kind}: у пакеті є «${text}»`);
    assert.match(md, /Елемент: /u);
  }
  // Без вибору контексту пакет не містить жодних відомостей про елемент.
  const result = explainElement(cases[0]);
  const bare = buildProposal({ kind: 'explain', text: 'Пояснення неточне', context: null, createdAt: date });
  assert.ok(!bare.includes('Елемент:') && !bare.includes(result.ref.title));
});

test('інтерфейс: відомості про елемент вимкнені за замовчуванням, підпис з екрана лише за окремою позначкою', () => {
  const source = readFileSync(new URL('../src/assistant/assistant-ui.js', import.meta.url), 'utf8');
  assert.match(source, /freshProposal = \(\) => \(\{[^}]*withContext: false, withLabel: false/u);
  assert.ok(!/withContext: true/u.test(source));
  assert.match(source, /explainId: explainResult\.ref\.id, screenLabel: proposal\.withLabel \? explainResult\.title : ''/u);
  assert.ok(!/context:[^\n]*title: explainResult\.title/u.test(source));
  // Перегляд і файл будуються одним викликом.
  assert.equal([...source.matchAll(/buildProposal\(/gu)].length, 1);
  assert.match(source, /aria-label': 'Попередній перегляд пакета'/u);
});

test('невалідні версія, модуль і керівні символи не потрапляють у пакет', () => {
  const md = buildProposal({ kind: 'невідомий', text: 'Текст\u0000 опису', context: { branch: 'x', title: '' }, appVersion: '<script>' });
  assert.match(md, /Тип: Правка або помилка/u);
  assert.ok(!md.includes('Модуль:') && !md.includes('Версія:') && !md.includes('\u0000'));
});

test('перевірка тексту й скриншота', () => {
  assert.equal(validateProposalText('ок').ok, false);
  assert.equal(validateProposalText('x'.repeat(PROPOSAL_TEXT_LIMIT + 1)).ok, false);
  assert.equal(validateProposalText('Нормальний опис').ok, true);
  assert.equal(validateProposalImage(null).ok, true);
  assert.equal(validateProposalImage({ type: 'image/png', size: 1000 }).ok, true);
  assert.equal(validateProposalImage({ type: 'application/pdf', size: 1000 }).ok, false);
  assert.equal(validateProposalImage({ type: 'image/png', size: 11 * 1024 * 1024 }).ok, false);
});

test('імена файлів збігаються за основою', () => {
  const names = proposalFileNames(date, { type: 'image/jpeg' });
  assert.equal(names.text, 'easywar-propozytsiia-20261015-1621.md');
  assert.equal(names.image, 'easywar-propozytsiia-20261015-1621-skryn.jpg');
  assert.equal(proposalFileNames(date, null).image, null);
});
