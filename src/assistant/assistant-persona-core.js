import { UNKNOWN_ANSWER } from './assistant-knowledge-core.js';

// Personality is presentation only: it never changes a cited answer or a finding.
export const WELCOME_TEXT = Object.freeze({
  heading: 'Так. Що цього разу?',
  body: 'Полковник КОМБАТ. Інновації прийняв. Безлад — ні. Запитуй українською й по суті.',
});

const RUSSIAN_WORDS = new Set(('как какая какие какой какую какое где что почему зачем сколько чтобы пожалуйста ' +
  'можно украинском русском добавить добавь проверить проверь обновить обнови обновления обновление ' +
  'сохранить сохрани данные таблицу таблицы привязать привязаны привязанные настроить настройки ' +
  'подключить создать текущая установленная делать приложение приложения ошибками ' +
  'импортировать экспортировать открыть открой закрыть войти зайти пользоваться работать работает ' +
  'помоги таблицей помощь инструкция инструкции профиль профиля изменить удалить').split(' '));

function questionWords(query) {
  return query.normalize('NFKC')
    // Quoted labels and code can use any language without becoming a language request.
    .replace(/```[^]*?```/gu, ' ')
    .replace(/`[^`]*`/gu, ' ')
    .replace(/"[^"\r\n]*"|«[^»]*»|“[^”]*”|„[^“]*“|‘[^’]*’/gu, ' ')
    .replace(/(^|[\s([{:\u2014])'[^'\r\n]*'(?=$|[\s),;.!?}\]])/gu, '$1 ')
    // Ignore whole path/URL tokens and file names, including Cyrillic file names.
    .replace(/[^\s<>"«»„“”`]*[/\\][^\s<>"«»„“”`]*/gu, ' ')
    .replace(/[^\s<>"«»„“”`]*\.[a-z0-9]{1,8}(?:\?[^\s]*)?/giu, ' ')
    .toLocaleLowerCase('uk-UA');
}

export function languageReply(query) {
  if (typeof query !== 'string') return null;
  const text = questionWords(query);
  // A Ukrainian question can refer to untranslated field labels without quotes.
  if (/^[\s?!,.;:\u2014-]*(?:як|що|чому|де|коли|які|яка|який|скільки|навіщо|підкажи|допоможи|будь\s+ласка)(?=$|[^\p{L}])/u.test(text)) return null;
  const words = text.match(/[\p{L}]+/gu) || [];
  const distinctiveLetters = /[ыэёъ]/u.test(text);
  const strongWords = words.filter(word => RUSSIAN_WORDS.has(word)).length;
  const greeting = /^\s*(?:привет|здравствуйте)[\s.!?]*$/u.test(text);
  // Two markers avoid rejecting a Ukrainian question with one borrowed term.
  if (!distinctiveLetters && strongWords < 2 && !greeting) return null;
  return {
    status: 'language',
    text: 'Можна українською? Інновації я вже прийняв, а мову інтерфейсу залишимо українською.',
    sources: [],
    warnings: [],
    origin: 'persona',
  };
}

export function answerLead(query, answer) {
  if (!answer || answer.status !== 'found' || typeof answer.text !== 'string' || !answer.text || answer.text === UNKNOWN_ANSWER) return null;
  if (answer.origin !== 'application-state' && !(Array.isArray(answer.sources) && answer.sources.length)) return null;
  const text = typeof query === 'string' ? query.toLocaleLowerCase('uk-UA') : '';
  if (/оновл|update/u.test(text)) return 'Оновлення? Спершу — порядок дій.';
  if (/версі/u.test(text)) return 'Версію — звірити.';
  if (/профіл|парол|блокув/u.test(text)) return 'Профіль — за процедурою.';
  if (/таблиц|xlsx|внес|доповід|імпорт|експорт/u.test(text)) return 'Таблиця — за процедурою.';
  return 'До справи. Ось що маємо.';
}

export function reviewLead(review) {
  const counts = review?.counts;
  if (!counts || !['error', 'warning', 'advice'].every(kind => Number.isSafeInteger(counts[kind]) && counts[kind] >= 0)) return null;
  if (counts.error >= 2) return 'Хто б сумнівався: помилка на помилці. Гаразд, давай виправляти.';
  if (counts.error === 1) return 'Одна помилка. Майже порядок. Гаразд, розберімося.';
  if (counts.warning > 0) return 'Помилок за правилами немає, але є попередження. Розслаблятися зарано — перевірмо їх.';
  if (counts.advice > 0) return 'Помилок і попереджень за правилами немає. Є поради — навіть полковник іноді їх слухає.';
  return 'Наявні правила зауважень не знайшли. Рано святкувати: це не схвалення даних.';
}
