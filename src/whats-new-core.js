// «Що нового»: чиста логіка екрана нотаток до випусків (без DOM, сховищ і мережі).
// Джерело правди — docs/releases/vX.Y.Z.md; `script/whats_new.mjs` розбирає їх функцією parseReleaseNotes
// і пише src/whats-new/releases.json. Текст нотаток не переписується: абзац лише ділиться на виділений
// заголовок («КОМБАТ.») і решту, а в абзаці-вступі «Версія X — …» прибирається службовий префікс.

// Версії, яких не публікували: у `docs/releases` їхні нотатки лишились, але користувач такої збірки не мав
// (тег v2.0.0 стояв на коміті з червоними перевірками; усе нове ввійшло в 2.0.1, див. v2.0.1.md і DECISIONS.md).
export const UNPUBLISHED_VERSIONS = Object.freeze(['2.0.0']);

const VERSION = /^\d+\.\d+\.\d+$/u;
// Службовий префікс вступу: «Версія 2.1.1 — » (тире, коротке тире чи дефіс; крапка після «Версія 2.0.» теж зрізається).
const INTRO_PREFIX = /^Версія\s+\d+(?:\.\d+)*\.?\s*(?:[—–-]\s*)?/u;
// Заголовок абзацу: коротке перше речення з великої літери, після якого є ще текст.
const SENTENCE_LEAD = /^(\S[^\n]{0,78}?\.)\s+(?=\S)/u;
const COLON_LEAD = /^(\S[^\n:.]{0,38}:)\s+(?=\S)/u;
const MAX_LEAD_WORDS = 10;
const MAX_COLON_LEAD_WORDS = 4;

export function isVersion(value) {
  return typeof value === 'string' && VERSION.test(value);
}

function parts(version) {
  return version.split('.').map(Number);
}

/** Порівняння за семвером: від'ємне, якщо a старіша за b. */
export function compareVersions(a, b) {
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function newestFirst(a, b) {
  return compareVersions(b.version, a.version);
}

function startsLikeHeading(text) {
  return /^[\p{Lu}\p{Nd}«"„]/u.test(text);
}

/**
 * Ділить абзац на заголовок і текст. Заголовок — перше речення до 78 символів і 10 слів із великої літери
 * («Файл для телефона.»); якщо такого немає, то короткий підпис до двокрапки («Артилерія:»). Решта абзацу
 * не змінюється. Без заголовка (`lead === ''`) абзац показується звичайним текстом.
 */
export function splitLead(paragraph) {
  const text = String(paragraph ?? '').trim();
  const sentence = SENTENCE_LEAD.exec(text);
  if (sentence && startsLikeHeading(sentence[1]) && sentence[1].split(/\s+/u).length <= MAX_LEAD_WORDS) {
    return { lead: sentence[1], text: text.slice(sentence[0].length) };
  }
  const colon = COLON_LEAD.exec(text);
  if (colon && startsLikeHeading(colon[1]) && colon[1].split(/\s+/u).length <= MAX_COLON_LEAD_WORDS) {
    return { lead: colon[1], text: text.slice(colon[0].length) };
  }
  return { lead: '', text };
}

const INLINE_CODE = /`([^`\n]+)`/gu;

/**
 * Ділить текст абзацу на звичайні й «кодові» фрагменти (`так`). У нотатках з markdown лишився тільки цей
 * вбудований код; екран малює його як <code> через textContent, без розбору HTML.
 */
export function inlineSegments(text) {
  const value = String(text ?? '');
  const segments = [];
  let last = 0;
  for (const match of value.matchAll(INLINE_CODE)) {
    if (match.index > last) segments.push({ code: false, text: value.slice(last, match.index) });
    segments.push({ code: true, text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < value.length) segments.push({ code: false, text: value.slice(last) });
  return segments;
}

/** Текст без markdown-позначок вбудованого коду: для підписів у змісті. */
export function plainText(text) {
  return String(text ?? '').replace(INLINE_CODE, '$1');
}

function capitalize(text) {
  return text ? text[0].toLocaleUpperCase('uk') + text.slice(1) : text;
}

function trimEndPunctuation(text) {
  return text.replace(/[\s.:;,]+$/u, '');
}

/** Перше речення для рядка змісту. */
export function firstSentence(text) {
  const value = String(text ?? '').trim();
  const end = /[.!?](?=\s+[\p{Lu}«"„])/u.exec(value);
  return trimEndPunctuation(end ? value.slice(0, end.index + 1) : value);
}

/**
 * Розбирає markdown-нотатки одного випуску.
 * Абзаци розділяє порожній рядок. Абзац «Версія X — …» стає `intro` (з великої літери), решта — `paragraphs`.
 * `summary` — підпис для змісту: речення вступу, а без вступу — заголовок першого абзацу чи його перше речення.
 */
export function parseReleaseNotes(markdown, version) {
  if (!isVersion(version)) throw new Error(`Некоректна версія: ${version}`);
  const blocks = String(markdown ?? '')
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t]*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) throw new Error(`Нотатки ${version} порожні`);

  let intro = '';
  if (INTRO_PREFIX.test(blocks[0])) {
    intro = capitalize(blocks[0].replace(INTRO_PREFIX, ''));
    blocks.shift();
  }
  const paragraphs = blocks.map(splitLead);
  const [first] = paragraphs;
  let summary;
  if (intro) summary = firstSentence(intro);
  else if (first.lead.endsWith('.')) summary = trimEndPunctuation(first.lead);
  else summary = firstSentence(first.lead ? `${first.lead} ${first.text}` : first.text);
  return { version, summary: plainText(summary), intro, paragraphs };
}

/** Випуски до поточної версії включно, найновіший першим; без відомої версії — усі. */
export function visibleReleases(releases, currentVersion) {
  const known = isVersion(currentVersion);
  return (Array.isArray(releases) ? releases : [])
    .filter((release) => isVersion(release?.version) && (!known || compareVersions(release.version, currentVersion) <= 0))
    .sort(newestFirst);
}

/**
 * Перехід у списку «найновіший першим»: `newer` — на крок до початку, `older` — до кінця.
 * Межі не переступає: повертає той самий індекс.
 */
export function stepIndex(length, index, direction) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const bounded = Math.min(Math.max(Number.isInteger(index) ? index : 0, 0), length - 1);
  if (direction === 'newer') return Math.max(bounded - 1, 0);
  if (direction === 'older') return Math.min(bounded + 1, length - 1);
  return bounded;
}

export function canStep(length, index, direction) {
  return stepIndex(length, index, direction) !== Math.min(Math.max(index, 0), Math.max(length - 1, 0));
}

/** Чи є випуск новіший за той, який користувач уже відкривав (`seen` — збережена версія чи порожньо). */
export function hasUnseen(releases, seenVersion) {
  if (!Array.isArray(releases) || releases.length === 0) return false;
  const newest = releases[0].version;
  return !isVersion(seenVersion) || compareVersions(newest, seenVersion) > 0;
}

export function releaseHeading(version) {
  return `Що нового у версії ${version}`;
}
