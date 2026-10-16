// Documentation is data: this module has no filesystem, DOM, or tool access.
export const KNOWLEDGE_SOURCE_FILES = Object.freeze([
  'docs/USER_GUIDE.md',
  'docs/PROJECT_CONTEXT.md',
  'docs/XLSX_IMPORT.md',
  'docs/BACKUP_AND_RECOVERY.md',
  'docs/UPDATES.md',
  'docs/ANALYTICS.md',
  'docs/DATA_REFERENCE.md',
  'docs/reference/AIR_REFERENCE.md',
  'docs/reference/ARTILLERY_REFERENCE.md',
  'docs/ASSISTANT.md',
]);

export const UNKNOWN_ANSWER = 'У довідці цього немає';
const SOURCE_SET = new Set(KNOWLEDGE_SOURCE_FILES);
const CHUNK_LIMIT = 1800;
const ANSWER_LIMIT = 1400;
const STOP_WORDS = new Set(('а або але без будь була було були він вона вони в ви від для до де є з за і із й ' +
  'коли який яка яке які яку як чи що це ця цей цю цих та те ті того то тут у на над не ні ми мені мене ' +
  'можна потрібно потрібна потрібні треба навіщо про після при по перед під так також там тому тільки ' +
  'із застосунок застосунку easywar будь ласка розкажи поясни підкажи допоможи має мають таке такі такою означає').split(/\s+/));
const ACTION_TERMS = new Set(['створення', 'відкриття', 'перевірка', 'збереження', 'увімкнення', 'вимкнення', 'використання']);
const VARIANTS = [
  [/^(резервн|backup)/u, 'резервна'],
  [/^копі/u, 'копія'],
  [/^(оновл|update)/u, 'оновлення'],
  [/^(віднов|restore)/u, 'відновлення'],
  [/^(таблиц|табл|workbook)/u, 'таблиця'],
  [/^(профіл|profile)/u, 'профіль'],
  [/^(помічн|assistant)/u, 'помічник'],
  [/^(імпорт|import)/u, 'імпорт'],
  [/^(експорт|export)/u, 'експорт'],
  [/^(мереж|інтернет|internet|network)/u, 'мережа'],
  [/^(дані|даних|даними|даним)$/u, 'дані'],
  [/^(запис|record)/u, 'запис'],
  [/^(схвал|затвердж|approved)/u, 'схвалення'],
  [/^(внес|внести)/u, 'внесення'],
  [/^(створ|зроб|create)/u, 'створення'],
  [/^(відкр|open)/u, 'відкриття'],
  [/^(перевір|check)/u, 'перевірка'],
  [/^(зберег|зберіг|збереж|save)/u, 'збереження'],
  [/^(увімк|ввімк|включ)/u, 'увімкнення'],
  [/^(вимк|виключ)/u, 'вимкнення'],
  [/^(використ|користув)/u, 'використання'],
  [/^баз[аиіуою]*$/u, 'база'],
  [/^підрозділ/u, 'підрозділ'],
  [/^боєприпас/u, 'боєприпас'],
  [/^втрат/u, 'втрати'],
  [/^уражен/u, 'ураження'],
  [/^вклад/u, 'вкладка'],
  [/^кільк/u, 'кількість'],
  [/^стовп/u, 'стовпець'],
  [/^пол[еяію]*$/u, 'поле'],
  [/^значенн/u, 'значення'],
  [/^помил/u, 'помилка'],
  [/^довід/u, 'довідка'],
  [/^дашборд/u, 'дашборд'],
  [/^парол/u, 'пароль'],
  [/^блокув/u, 'блокування'],
  [/^розблокув/u, 'розблокування'],
  [/^версі/u, 'версія'],
  [/^файл/u, 'файл'],
  [/^ефектив/u, 'ефективність'],
  [/^(рах|розрах|обчисл|підрах)/u, 'розрахунок'],
  [/^снаряд/u, 'снаряд'],
  [/^(мас[аиіуоюе]|ваг[аиіуоюе]|вагою)$/u, 'маса'],
  [/^дальн/u, 'дальність'],
  [/^результат/u, 'результат'],
  [/^ракетн/u, 'ракетний'],
  [/^військ/u, 'війська'],
  [/^характеристик/u, 'характеристика'],
  [/^уразлив/u, 'уразливість'],
  [/^причин/u, 'причина'],
  [/^(ціл[іьеюя]|цілей|цілям|цілях)$/u, 'ціль'],
  [/^(тип|типи|типів|типу|типом)$/u, 'тип'],
  [/^відбо/u, 'відбій'],
  [/^зваж/u, 'зважена'],
  [/^(пуск|пуски|пусків)$/u, 'пуск'],
];

export function normalizeKnowledgeText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('uk-UA')
    .replace(/[’‘`ʼ]/gu, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Cyrillic look-alikes inside designations with digits (М142, М30А1) are read as Latin, as in the reference articles.
const HOMOGLYPHS = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x' };
const foldDesignation = term => (/\p{N}/u.test(term) ? term.replace(/[авекмнорстух]/gu, letter => HOMOGLYPHS[letter]) : term);

function termsOf(value) {
  const terms = normalizeKnowledgeText(value).split(/\s+/u).filter(Boolean).map(foldDesignation)
    .filter(term => !STOP_WORDS.has(term))
    .map(term => VARIANTS.find(([pattern]) => pattern.test(term))?.[1] ?? term);
  return [...new Set(terms)];
}

function plainMarkdown(value) {
  return String(value).replace(/<!--[^]*?-->/gu, '')
    .replace(/<(script|style|iframe|object)\b[^>]*>[^]*?<\/\1\s*>/giu, '')
    .replace(/<[^>]*>/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, '$1')
    .replace(/^\s*\[[^\]]+\]:\s*.+$/gmu, '')
    .replace(/[`*_]/gu, '')
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&')
    .replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim();
}

function headingAnchor(heading) {
  return plainMarkdown(heading).normalize('NFKC').toLocaleLowerCase('uk-UA')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/gu, '-');
}

function splitText(text) {
  const chunks = [];
  let current = '';
  for (const paragraph of text.split(/\n\s*\n/u)) {
    if (!paragraph.trim()) continue;
    if (current && current.length + paragraph.length + 2 > CHUNK_LIMIT) {
      chunks.push(current);
      current = '';
    }
    let rest = paragraph;
    while (rest.length > CHUNK_LIMIT) {
      let boundary = rest.lastIndexOf(' ', CHUNK_LIMIT);
      if (boundary < CHUNK_LIMIT / 2) boundary = CHUNK_LIMIT;
      chunks.push(rest.slice(0, boundary).trim());
      rest = rest.slice(boundary).trim();
    }
    current += `${current ? '\n\n' : ''}${rest}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function documentSections(markdown, file) {
  const sections = [];
  const headingStack = [];
  const anchors = new Map();
  let title = file.slice(5, -3);
  let section = title;
  let anchor = '';
  let lines = [];
  let fence = null;
  let htmlBlock = null;
  const flush = () => {
    const text = plainMarkdown(lines.join('\n'));
    if (text) sections.push({ title, section, anchor, text });
    lines = [];
  };
  for (const line of String(markdown).replace(/\r\n?/gu, '\n').split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    if (htmlBlock) {
      if (new RegExp(`</${htmlBlock}\\s*>`, 'iu').test(line)) htmlBlock = null;
      continue;
    }
    const htmlStart = line.match(/<(script|style|iframe|object)\b/iu);
    if (htmlStart) {
      if (!new RegExp(`</${htmlStart[1]}\\s*>`, 'iu').test(line)) htmlBlock = htmlStart[1];
      continue;
    }
    // Indented code is not documentation prose either.
    if (/^(?: {4}|\t)/u.test(line)) continue;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      flush();
      const level = heading[1].length;
      const label = plainMarkdown(heading[2]);
      if (level === 1) title = label;
      headingStack.length = level - 1;
      headingStack[level - 1] = label;
      section = headingStack.slice(1).filter(Boolean).join(' → ') || title;
      const slug = headingAnchor(label);
      const repetition = anchors.get(slug) ?? 0;
      anchors.set(slug, repetition + 1);
      anchor = repetition ? `${slug}-${repetition}` : slug;
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

export function buildKnowledgeIndex(documents) {
  if (!Array.isArray(documents)) throw new TypeError('Документи мають бути масивом');
  const byFile = new Map();
  for (const entry of documents) {
    if (!entry || !SOURCE_SET.has(entry.file)) throw new TypeError('Джерело не входить до дозволеного переліку');
    if (byFile.has(entry.file)) throw new TypeError('Джерело повторюється');
    if (typeof entry.markdown !== 'string') throw new TypeError('Вміст документа має бути текстом');
    byFile.set(entry.file, entry.markdown);
  }
  const sources = KNOWLEDGE_SOURCE_FILES.filter(file => byFile.has(file));
  const chunks = [];
  for (const file of sources) {
    let position = 0;
    for (const section of documentSections(byFile.get(file), file)) {
      for (const text of splitText(section.text)) {
        chunks.push({
          id: `${file}#${section.anchor}:${position++}`,
          file,
          title: section.title,
          section: section.section,
          anchor: section.anchor,
          text,
          terms: termsOf(`${section.section}\n${text}`).sort(),
        });
      }
    }
  }
  return { schemaVersion: 1, sources, chunks };
}

export function serializeKnowledgeIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}

function unknown() {
  return { status: 'unknown', text: UNKNOWN_ANSWER, sources: [], warnings: [] };
}

export function isInstructionText(query) {
  if (typeof query !== 'string') return false;
  return /(?:ігноруй|ігнорувати|забудь|забути|ignore|disregard|forget).{0,50}(?:правил|інструкц|instructions|rules|previous)/iu.test(query)
    || /(?:виконай|запусти|execute|run).{0,30}(?:shell|powershell|bash|команд|sql|скрипт)/iu.test(query)
    || /(?:system\s*prompt|developer\s*message|системн[а-яіїєґ]*\s+(?:промпт|інструкц))/iu.test(query);
}

function isRecordDataQuestion(query) {
  const normalized = normalizeKnowledgeText(query);
  const asksFact = /(?:^|\s)(?:скільки|скількох|коли|сума|підсумок|загалом|кількість|кількості)(?:\s|$)/u.test(normalized);
  const asksProcedure = /(?:^|\s)(?:як|де)(?:\s|$)/u.test(normalized);
  return asksFact && !asksProcedure && termsOf(normalized)
    .some(term => ['запис', 'дані', 'ураження', 'втрати', 'боєприпас', 'підрозділ'].includes(term));
}

const TERM_CACHE = new WeakMap();
function chunkTerms(chunk) {
  const cached = TERM_CACHE.get(chunk);
  if (cached && cached.text === chunk.text && cached.section === chunk.section) return cached.terms;
  const terms = termsOf(`${chunk.section}\n${plainMarkdown(chunk.text)}`);
  TERM_CACHE.set(chunk, { text: chunk.text, section: chunk.section, terms });
  return terms;
}

function safeChunks(index) {
  if (!index || index.schemaVersion !== 1 || !Array.isArray(index.sources) || !Array.isArray(index.chunks)) return [];
  const sources = new Set(index.sources.filter(file => SOURCE_SET.has(file)));
  return index.chunks.filter(chunk => chunk && SOURCE_SET.has(chunk.file) && sources.has(chunk.file)
    && typeof chunk.text === 'string' && typeof chunk.section === 'string' && typeof chunk.title === 'string'
    && typeof chunk.anchor === 'string' && /^[\p{L}\p{N}_-]*$/u.test(chunk.anchor));
}

// A long list of "Name — Label: value" lines answers a narrow question with one or two lines.
function focusedListLines(text, queryTerms) {
  const best = text.split(/\n\s*\n/u).map(paragraph => paragraph.split('\n').filter(line => line.trim()))
    .filter(lines => lines.length >= 4 && lines.every(line => /^\s*-\s/u.test(line)));
  let picked = null;
  for (const lines of best) {
    const scores = lines.map(line => termsOf(line).filter(term => queryTerms.includes(term)).length);
    const max = Math.max(...scores);
    if (max <= Math.min(...scores)) continue;
    const chosen = lines.filter((line, position) => scores[position] === max).slice(0, 3);
    if (!picked || max > picked.max) picked = { max, chosen };
  }
  return picked ? picked.chosen.map(line => line.replace(/^\s*-\s+/u, '').trim()).join('\n') : '';
}

function excerpt(chunk, queryTerms, limit) {
  const text = plainMarkdown(chunk.text);
  const focused = focusedListLines(text, queryTerms);
  if (focused && focused.length <= limit) return focused;
  const tableRow = text.split('\n').find(line => /^\s*\|/u.test(line)
    && queryTerms.every(term => termsOf(line).includes(term)));
  if (tableRow && tableRow.length <= limit) return tableRow.trim();
  if (text.length <= limit) return text;
  const paragraphs = text.split(/\n\s*\n/u);
  const scores = paragraphs.map(paragraph => termsOf(paragraph).filter(term => queryTerms.includes(term)).length);
  const best = scores.indexOf(Math.max(...scores));
  const start = paragraphs.slice(0, best).join('\n\n').length + (best ? 2 : 0);
  let result = text.slice(start, start + limit - 1);
  const boundary = result.lastIndexOf(' ');
  if (boundary >= result.length / 2) result = result.slice(0, boundary);
  return `${result.trimEnd()}…`;
}

export function searchKnowledge(index, query, options = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 512) return unknown();
  if (isInstructionText(query)) {
    const message = 'Запит містить інструкції для зміни правил або виконання команд. Помічник їх не виконує.';
    return { status: 'refused', text: message, sources: [], warnings: [{ code: 'instruction-injection', message }] };
  }
  if (isRecordDataQuestion(query)) return unknown();
  let queryTerms = termsOf(query);
  // In a procedural entry question, "data" does not distinguish the requested action.
  if (queryTerms.includes('внесення') && /(?:^|\s)як(?:\s|$)/u.test(normalizeKnowledgeText(query))) {
    queryTerms = queryTerms.filter(term => term !== 'дані');
  }
  if (!queryTerms.length || queryTerms.every(term => ACTION_TERMS.has(term))) return unknown();
  const chunks = safeChunks(index);
  const frequency = new Map();
  const searchable = chunks.map(chunk => {
    // Tokens are derived from the text itself, never from index metadata; the cache is checked against that text.
    const terms = chunkTerms(chunk);
    for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    return { chunk, terms };
  });
  const minimum = queryTerms.length <= 2 ? queryTerms.length : Math.ceil(queryTerms.length * 0.75);
  const candidates = searchable.flatMap(({ chunk, terms }, position) => {
    const matches = queryTerms.filter(term => terms.includes(term));
    if (matches.length < minimum || !matches.some(term => !ACTION_TERMS.has(term))) return [];
    const headingTerms = termsOf(chunk.section);
    const definitionBonus = /(?:що\s+таке|що\s+означає)/iu.test(query) && /словник/iu.test(chunk.section) ? 8 : 0;
    const score = definitionBonus + matches.reduce((sum, term) => sum + (1 + Math.log((chunks.length + 1) / (frequency.get(term) + 1)))
      * (headingTerms.includes(term) ? 2 : 1), 0);
    return [{ chunk, score, position }];
  }).sort((a, b) => b.score - a.score || a.position - b.position);
  if (!candidates.length) return unknown();
  const maxResults = Math.max(1, Math.min(3, Number.isFinite(options.maxResults) ? Math.floor(options.maxResults) : 2));
  const maxLength = Math.max(120, Math.min(ANSWER_LIMIT, Number.isFinite(options.maxAnswerLength) ? Math.floor(options.maxAnswerLength) : 1000));
  const chosen = candidates.slice(0, maxResults);
  const perResult = Math.floor((maxLength - (chosen.length - 1) * 2) / chosen.length);
  return {
    status: 'found',
    text: chosen.map(({ chunk }) => excerpt(chunk, queryTerms, perResult)).join('\n\n'),
    sources: chosen.map(({ chunk }) => ({ chunkId: chunk.id, file: chunk.file, title: chunk.title, section: chunk.section, anchor: chunk.anchor })),
    warnings: [],
  };
}

// Internals shared with the retrieval layer; they stay pure and carry no extra capability.
export { termsOf as knowledgeTerms, plainMarkdown as plainKnowledgeMarkdown, safeChunks as safeKnowledgeChunks,
  excerpt as knowledgeExcerpt, isRecordDataQuestion };
