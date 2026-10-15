import { UNKNOWN_ANSWER } from './assistant-knowledge-core.js';

// Personality is presentation only: it never changes a cited answer or a finding.
export const WELCOME_TEXT = Object.freeze({
  heading: 'Так. Що цього разу?',
  body: 'КОМБАТ. Інновації прийняв. Безлад — ні. Запитуй українською й по суті.',
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

export function explainLead(result) {
  if (!result) return null;
  return result.status === 'found' ? 'Дивись сюди. Доповідаю.' : 'Цього в довідці немає, а вигадувати не буду.';
}

export function reviewLead(review) {
  const counts = review?.counts;
  if (!counts || !['error', 'warning', 'advice'].every(kind => Number.isSafeInteger(counts[kind]) && counts[kind] >= 0)) return null;
  if (counts.error >= 2) return 'Хто б сумнівався: помилка на помилці. Гаразд, давай виправляти.';
  if (counts.error === 1) return 'Одна помилка. Майже порядок. Гаразд, розберімося.';
  if (counts.warning > 0) return 'Помилок за правилами немає, але є попередження. Розслаблятися зарано — перевірмо їх.';
  if (counts.advice > 0) return 'Помилок і попереджень за правилами немає. Є поради — навіть КОМБАТ іноді їх слухає.';
  return 'Наявні правила зауважень не знайшли. Рано святкувати: це не схвалення даних.';
}

// Фірмові репліки полковника. Це лише оформлення: вони не змінюють відповідь, джерела й зауваження.
const frozen = list => Object.freeze([...list]);
export const COLONEL_PHRASES = Object.freeze({
  // Для зауважень рівня «Помилка».
  error: frozen([
    'Провести роботу з усунення виявлених недоліків!',
    'Посилити контроль за виконанням контролю!',
    'Вжити відповідних організаційних заходів!',
    'З метою недопущення подібного в майбутньому…',
    'Винних притягнути до відповідальності!',
    'А хто за це відповідатиме?',
    'Недоліки є, але робота ведеться!',
    'Питання перебуває на контролі!',
    'Мені не потрібні причини, мені потрібен результат!',
    'Ти мені тут раціоналізацію не розводь!',
    'Щоб до ранку було зроблено!',
  ]),
  // Для попереджень і порад.
  warning: frozen([
    'Прошу не створювати труднощів там, де їх ще немає!',
    'Зауваження слушне, але несвоєчасне!',
    'Тимчасові труднощі мають постійний характер!',
    'Поставити питання на порядок денний!',
    'На виконання вказівки вищого керівництва…',
    'Не знаєш — навчимо, не вмієш — покажемо!',
    'Не можеш — навчимо, не хочеш — змусимо!',
    'Товаришу, ви що, найрозумніший?',
  ]),
  // Коли правила нічого не знайшли.
  clean: frozen([
    'Заслухали, обговорили, постановили!',
    'Доповісти про виконання!',
    'Щоб усе було, але щоб за це нічого не було!',
    'Головне — відзвітувати, а там хоч трава не рости!',
    'Товариші, досить займатися окозамилюванням!',
    'Немає людини — немає проблеми!',
  ]),
  // Для вітання на початку розмови.
  welcome: frozen([
    'Є думка, товариші, і думка ця правильна!',
    'Не будемо розводити тут демократію!',
    'Ініціатива карається виконанням!',
    'Без самодіяльності, товаришу!',
    'У нас незамінних немає!',
    'Буде наказ — буде результат!',
    'Накази не обговорюють, а виконують!',
    'Відставити балачки!',
    'Є така професія — Батьківщину захищати!',
    'Поки я командир, думати буду я!',
    'Без папірця ти комашка, а з папірцем — людина!',
    'Крок ліворуч, крок праворуч — вважатиметься втечею!',
    'Не плутайте особисту ініціативу з партійною дисципліною!',
    'Ми тут не для того зібралися, щоб думати, а щоб ухвалювати рішення!',
    'Сьогодні ти ставиш запитання, а завтра вже підриваєш авторитет керівництва!',
    'А тобі що, більше за всіх треба?',
    'Ти спочатку заслужи, а потім вимагай!',
    'Держава про тебе подбає!',
    'Раніше такого неподобства не було!',
    'От за нашого часу був порядок!',
    'Не подобається — пиши скаргу!',
    'Усі рівні, але дехто рівніший!',
  ]),
});

function pick(list, seed) {
  const index = Number.isSafeInteger(seed) && seed >= 0 ? seed % list.length : 0;
  return list[index];
}

export function welcomeRemark(seed) {
  return pick(COLONEL_PHRASES.welcome, seed);
}

export function reviewRemark(review, seed) {
  const counts = review?.counts;
  if (!counts || !['error', 'warning', 'advice'].every(kind => Number.isSafeInteger(counts[kind]) && counts[kind] >= 0)) return null;
  if (counts.error > 0) return pick(COLONEL_PHRASES.error, seed);
  if (counts.warning > 0 || counts.advice > 0) return pick(COLONEL_PHRASES.warning, seed);
  return pick(COLONEL_PHRASES.clean, seed);
}
