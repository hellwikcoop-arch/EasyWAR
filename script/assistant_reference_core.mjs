// Перетворює довідникові дані застосунку (ENTRIES) на текст для локальної довідки помічника.
// Чиста функція без файлів і DOM: джерелом є лише вбудовані довідники ПС і Артилерії, без робочих таблиць.
import * as air from '../src/ref-data.js';
import * as artillery from '../src/artillery-ref-data.js';

const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const sentence = value => { const text = clean(value); return /[.!?…]$/u.test(text) ? text : `${text}.`; };

function factsBlock(name, facts) {
  const lines = (facts || []).filter(row => Array.isArray(row) && row.length >= 2)
    .map(([label, value]) => `- ${name} — ${clean(label)}: ${clean(value)}`);
  return lines.length ? lines.join('\n') : '';
}

function sectionBlocks(sections) {
  const blocks = [];
  for (const section of sections || []) {
    const body = [];
    if (section.text) body.push(clean(section.text));
    if (Array.isArray(section.list)) body.push(section.list.map(item => `- ${clean(item)}`).join('\n'));
    if (body.length) blocks.push(`#### ${clean(section.title)}\n\n${body.join('\n\n')}`);
  }
  return blocks;
}

function searchNames(entry) {
  const known = new Set([clean(entry.name), clean(entry.short), clean(entry.alias)].map(item => item.toLocaleLowerCase('uk-UA')));
  const names = [...new Set((entry.tags || []).map(clean).filter(tag => tag && !known.has(tag.toLocaleLowerCase('uk-UA'))))];
  return names.length ? `Інші написання для пошуку: ${names.join(', ')}.` : '';
}

function entryHeader(entry) {
  const parts = [];
  if (entry.alias) parts.push(`Також: ${clean(entry.alias)}.`);
  if (entry.role) parts.push(`Роль: ${clean(entry.role)}.`);
  if (entry.origin) parts.push(`Походження: ${clean(entry.origin)}.`);
  if (entry.status) parts.push(`Стан: ${clean(entry.status)}.`);
  if (entry.note) parts.push(clean(entry.note));
  if (entry.summary) parts.push(clean(entry.summary));
  return parts.join(' ');
}

function airEntry(entry) {
  const name = clean(entry.name);
  const blocks = [`### ${name}`, entryHeader(entry)];
  const facts = factsBlock(name, entry.facts);
  if (facts) blocks.push(`#### Характеристики\n\n${facts}`);
  const weak = (entry.weak || []).map(item => `- ${name} — ${clean(item.t)}: ${clean(item.d)}`);
  if (weak.length) blocks.push(`#### Уразливі місця\n\n${weak.join('\n')}`);
  blocks.push(...sectionBlocks(entry.sections));
  if (entry.group === 'aircraft') {
    const munitions = air.munitionsOf(entry.id).map(id => air.entryById(id)?.name).filter(Boolean);
    if (munitions.length) blocks.push(`#### Боєприпаси з довідника\n\n${name} у довіднику пов’язаний з боєприпасами: ${munitions.join(', ')}.`);
  }
  if (entry.group === 'munition') {
    const carriers = air.carriersOf(entry.id).map(id => air.entryById(id)?.name).filter(Boolean);
    if (carriers.length) blocks.push(`#### Носії з довідника\n\n${name} у довіднику пов’язаний з носіями: ${carriers.join(', ')}.`);
  }
  const names = searchNames(entry);
  if (names) blocks.push(names);
  return blocks.filter(Boolean).join('\n\n');
}

function artilleryEntry(entry) {
  const name = clean(entry.name);
  const blocks = [`### ${name}`, entryHeader(entry)];
  const facts = factsBlock(name, entry.facts);
  if (facts) blocks.push(`#### Загальні характеристики\n\n${facts}`);
  for (const variant of artillery.variantsOf(entry)) {
    const label = clean(variant.label);
    const body = [];
    if (variant.text) body.push(clean(variant.text));
    const variantFacts = factsBlock(`${name}, ${label}`, variant.facts);
    if (variantFacts) body.push(variantFacts);
    if (body.length) blocks.push(`#### ${label}\n\n${body.join('\n\n')}`);
  }
  blocks.push(...sectionBlocks(entry.sections));
  if (entry.tableGroups === artillery.REST) blocks.push(`#### Зв’язок із таблицею\n\n${name}: у таблиці витрати й залишку ця стаття охоплює решту калібрів, яких немає в інших статтях.`);
  else if (Array.isArray(entry.tableGroups) && entry.tableGroups.length) blocks.push(`#### Зв’язок із таблицею\n\n${name}: у таблиці витрати й залишку цей довідник відповідає групам: ${entry.tableGroups.map(clean).join(', ')}.`);
  const names = searchNames(entry);
  if (names) blocks.push(names);
  return blocks.filter(Boolean).join('\n\n');
}

function render(title, intro, groups, entries, renderEntry) {
  const out = [`# ${title}`, intro];
  for (const group of groups) {
    const members = entries.filter(entry => entry.group === group.id);
    if (!members.length) continue;
    out.push(`## ${clean(group.title)}`, `Розділ довідника: ${clean(group.title)} (${clean(group.hint)}). Статей: ${members.length}.`);
    out.push(...members.map(renderEntry));
  }
  return `${out.join('\n\n')}\n`;
}

export const REFERENCE_OUTPUTS = Object.freeze([
  'docs/reference/AIR_REFERENCE.md',
  'docs/reference/ARTILLERY_REFERENCE.md',
]);

export function renderReferences() {
  const note = 'Файл створює `node script/assistant_reference.mjs` з вбудованого довідника застосунку; вручну його не редагують. Це довідкові дані без робочих записів.';
  return new Map([
    [REFERENCE_OUTPUTS[0], render('Довідник Повітряних Сил: засоби, боєприпаси, техніка',
      `${note} Вкладка «Довідник» модуля «Повітряні Сили»: літаки й вертольоти, боєприпаси, наземні засоби, машини забезпечення, ворожа та інша техніка. Числа з відкритих джерел, округлені; знак ≈ означає, що значення залежить від модифікації.`,
      air.GROUPS, air.ENTRIES, airEntry)],
    [REFERENCE_OUTPUTS[1], render('Довідник артилерії: боєприпаси',
      `${note} Вкладка «Довідник» модуля «Артилерія»: снаряди, міни, реактивні, високоточні боєприпаси, заряди й підривники. ${sentence(artillery.ENTRIES[0]?.note)}`,
      artillery.GROUPS, artillery.ENTRIES, artilleryEntry)],
  ]);
}
