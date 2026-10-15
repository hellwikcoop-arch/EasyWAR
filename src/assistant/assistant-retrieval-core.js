// Tolerant retrieval over the shipped documentation index. Pure: no DOM, filesystem, network or tools.
// The strict searchKnowledge() stays the reference; this layer only runs when it finds nothing, and it never
// invents text: it returns existing chunks (or their section names) with the number of query words they cover.
import {
  UNKNOWN_ANSWER, isInstructionText, isRecordDataQuestion, knowledgeTerms, knowledgeExcerpt,
  plainKnowledgeMarkdown, safeKnowledgeChunks,
} from './assistant-knowledge-core.js';

const STEM_LENGTH = 5;
// Words that name an action rather than a topic. They help ranking but never justify an answer alone.

// Groups of words a user can swap for one another. Every word is reduced with the same pipeline as the text.
const SYNONYM_WORDS = [
  ['порахувати', 'вирахувати', 'обчислити', 'розрахувати', 'підрахувати', 'розрахунок', 'рахується'],
  ['ввести', 'внести', 'додати', 'записати', 'занести', 'вписати', 'введення', 'внесення', 'додавання'],
  ['забув', 'забути', 'втратив', 'загубив', 'скинути', 'нагадати'],
  ['сигнал', 'signal', 'сигналі'],
  ['ракета', 'ракети', 'снаряд', 'боєприпас', 'боєприпаси'],
  ['побачити', 'показати', 'переглянути', 'відобразити', 'подивитися', 'глянути'],
  ['результат', 'наслідок', 'ураження', 'підсумок'],
  ['видалити', 'стерти', 'прибрати', 'вилучити', 'видалення'],
  ['помилка', 'збій', 'несправність', 'проблема', 'глюк'],
  ['завантажити', 'підвантажити', 'імпортувати', 'імпорт'],
  ['бекап', 'backup', 'резервна', 'копія'],
  ['відновити', 'відновлення', 'повернути', 'відкотити'],
  ['змінити', 'поміняти', 'редагувати', 'виправити', 'оновити'],
  ['запуск', 'пуск', 'пуски', 'стрільба'],
  ['порожній', 'пустий', 'нічого'],
  ['пароль', 'пароля', 'паролем', 'вхід'],
];

function plainStem(term) {
  return term.length > STEM_LENGTH ? term.slice(0, STEM_LENGTH) : term;
}

// One word -> one comparable token (or null for stop words).
function stemOf(word) {
  const [term] = knowledgeTerms(word);
  return term ? plainStem(term) : null;
}

const SYNONYM = (() => {
  const map = new Map();
  for (const group of SYNONYM_WORDS) {
    const stems = group.map(stemOf).filter(Boolean);
    if (!stems.length) continue;
    for (const stem of stems) if (!map.has(stem)) map.set(stem, `~${stems[0]}`);
  }
  return map;
})();

// Filler a user adds around a question; the strict search's stop list does not cover them.
const LOOSE_STOP = new Set(('чому чого куди звідки нову новий нова нове нові хочу хочемо можу можемо зараз якщо тоді ще вже ' +
  'будь ласка скажи покажи розкажи підкажи допоможи треба потрібно робити').split(/\s+/u));

function tokenList(text) {
  const words = String(text ?? '').normalize('NFKC').toLocaleLowerCase('uk-UA')
    .replace(/[^\p{L}\p{N}'’ʼ]+/gu, ' ').split(/\s+/u).filter(word => word && !LOOSE_STOP.has(word));
  const result = [];
  for (const word of words) {
    const stem = stemOf(word);
    if (stem) result.push(SYNONYM.get(stem) ?? stem);
  }
  return result;
}

const tokensOf = text => [...new Set(tokenList(text))];

const CACHE = new WeakMap();
function chunkProfile(chunk) {
  const cached = CACHE.get(chunk);
  if (cached && cached.text === chunk.text && cached.section === chunk.section) return cached;
  const list = tokenList(`${chunk.section}\n${plainKnowledgeMarkdown(chunk.text)}`);
  const counts = new Map();
  for (const token of list) counts.set(token, (counts.get(token) ?? 0) + 1);
  const profile = { text: chunk.text, section: chunk.section, counts, length: list.length, heading: new Set(tokensOf(String(chunk.section).split(' → ').pop())) };
  CACHE.set(chunk, profile);
  return profile;
}

// Words that name an action rather than a topic. They help ranking but never justify an answer alone.
const GENERIC = new Set(['створення', 'відкриття', 'перевірка', 'збереження', 'увімкнення', 'вимкнення', 'використання'].map(stemOf));
const isGeneric = token => GENERIC.has(token);

const K1 = 1.2, B = 0.75;

export function rankKnowledge(index, query, options = {}) {
  const limit = Math.max(1, Math.min(6, Number.isFinite(options.limit) ? Math.floor(options.limit) : 3));
  const queryTokens = tokensOf(query);
  const chunks = safeKnowledgeChunks(index);
  if (!queryTokens.length || !chunks.length) return { queryTokens, ranked: [] };
  const profiles = chunks.map(chunk => ({ chunk, ...chunkProfile(chunk) }));
  const frequency = new Map();
  for (const { counts } of profiles) for (const token of counts.keys()) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  const average = profiles.reduce((sum, item) => sum + item.length, 0) / profiles.length || 1;
  const idf = token => Math.log(1 + (chunks.length - (frequency.get(token) ?? 0) + 0.5) / ((frequency.get(token) ?? 0) + 0.5));
  const weights = queryTokens.map(idf);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const ceiling = total * (K1 + 1);
  const ranked = profiles.flatMap(({ chunk, counts, length, heading }, position) => {
    const matched = queryTokens.filter(token => counts.has(token));
    if (!matched.length || matched.every(isGeneric)) return [];
    let bm25 = 0, covered = 0;
    queryTokens.forEach((token, at) => {
      const tf = counts.get(token);
      if (!tf) return;
      covered += weights[at];
      bm25 += weights[at] * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * length / average));
    });
    const topical = matched.filter(token => heading.has(token) && !isGeneric(token)).length;
    return [{ chunk, position, matched: matched.length, topical, coverage: covered / total,
      density: bm25 / ceiling, score: bm25 / ceiling + topical * 0.2 }];
  }).sort((a, b) => b.score - a.score || a.position - b.position).slice(0, limit);
  return { queryTokens, ranked };
}

const sourceOf = chunk => ({ chunkId: chunk.id, file: chunk.file, title: chunk.title, section: chunk.section, anchor: chunk.anchor });
const unknown = () => ({ status: 'unknown', text: UNKNOWN_ANSWER, sources: [], warnings: [] });

// Result statuses: 'found' (confident, quoted), 'suggestions' (nearest sections only), 'unknown'.
export function searchKnowledgeLoose(index, query, options = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 512) return unknown();
  if (isInstructionText(query) || isRecordDataQuestion(query)) return unknown();
  const { queryTokens, ranked } = rankKnowledge(index, query, { limit: 3 });
  const best = ranked[0];
  if (!best) return unknown();
  const need = Math.min(2, queryTokens.length);
  if (best.coverage >= 0.7 && best.matched >= need && best.topical > 0) {
    const maxLength = Math.max(120, Math.min(1400, Number.isFinite(options.maxAnswerLength) ? Math.floor(options.maxAnswerLength) : 1000));
    return {
      status: 'found', match: 'loose',
      text: knowledgeExcerpt(best.chunk, knowledgeTerms(query), maxLength),
      sources: [sourceOf(best.chunk)], warnings: [],
    };
  }
  if (best.coverage >= 0.5 && best.matched >= need) {
    const seen = new Set();
    const near = ranked.filter(item => item.coverage >= 0.5 && item.matched >= need && !seen.has(item.chunk.section) && seen.add(item.chunk.section)).slice(0, 3);
    return {
      status: 'suggestions', match: 'loose',
      text: 'Точної відповіді не знайшов. Найближчі розділи довідки:',
      sources: near.map(item => sourceOf(item.chunk)), warnings: [],
    };
  }
  return unknown();
}

// Strict first, tolerant second. The caller decides how to word a 'suggestions' result.
export function answerFromKnowledge(index, query, strictSearch, options = {}) {
  const strict = strictSearch(index, query, { maxResults: 1, ...options });
  if (strict.status !== 'unknown') return strict;
  return searchKnowledgeLoose(index, query, options);
}

// Fact packs for a generator: up to three short chunks with their identifiers.
export function factPack(index, query, options = {}) {
  const limit = Math.max(1, Math.min(3, Number.isFinite(options.limit) ? Math.floor(options.limit) : 3));
  const maxLength = Math.max(120, Math.min(700, Number.isFinite(options.maxLength) ? Math.floor(options.maxLength) : 500));
  return rankKnowledge(index, query, { limit }).ranked.filter(item => item.coverage >= 0.5 && item.matched >= Math.min(2, item.matched)).map(item => ({
    id: item.chunk.id, file: item.chunk.file, section: item.chunk.section, anchor: item.chunk.anchor, title: item.chunk.title,
    text: knowledgeExcerpt(item.chunk, knowledgeTerms(query), maxLength),
  }));
}
