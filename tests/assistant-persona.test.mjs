import assert from 'node:assert/strict';
import test from 'node:test';
import { WELCOME_TEXT, languageReply, answerLead, reviewLead } from '../src/assistant/assistant-persona-core.js';
import { UNKNOWN_ANSWER } from '../src/assistant/assistant-knowledge-core.js';

test('clear Russian questions receive a Ukrainian colonel reply without invented sources', () => {
  for (const query of [
    'Как добавить таблицу?', 'Где настройки приложения?', 'Как проверить обновления?',
    'Что делать с ошибками?', 'Какая текущая версия?', 'Покажи привязанные таблицы',
    'Можно на украинском?', 'Как импортировать XLSX?', 'Как открыть файл?', 'Как войти?',
    'Где помощь?', 'Почему не работает?', 'Помоги с таблицей', 'Вы здесь?', 'Привет!', 'Здравствуйте.',
  ]) {
    const answer = languageReply(query);
    assert.equal(answer?.status, 'language', query);
    assert.match(answer.text, /^Можна українською\?/u);
    assert.equal(answer.origin, 'persona');
    assert.deepEqual(answer.sources, []);
    assert.deepEqual(answer.warnings, []);
  }
});

test('Ukrainian, mixed technical terms, quoted labels, file names and paths remain questions', () => {
  for (const query of [
    'Як внести доповідь?', 'Покажи дані профілю', 'Що робити з помилками?',
    'Яка поточна версія easyWAR?', 'Як перевірити оновлення XLSX і SQLite?',
    'Як виконати SELECT COUNT(*) FROM "таблицы"?',
    'Як виправити поле «данные»?', 'Як назвати колонку “ошибки”?', 'Як налаштувати поле „таблицы“?',
    'Як налаштувати поле ‘таблицы’?', 'Як перевірити колонку «Как добавить таблицу»?',
    "Як розібрати колонку 'таблицы' у XLSX?",
    'Як змінити дані у Данные.xlsx?', 'Як імпортувати таблицы.tar.gz?',
    'Як відновити C:\\Данные\\таблицы.xlsx?', 'Як відкрити /tmp/Данные/таблицы.xlsx?',
    'Де інструкція https://example.test/таблицы?', 'Як змінити `ы` у назві?',
    'Поле ошибки порожнє. Що робити?', 'Як виправити таблицу у профілі?',
    'Як працює поле данные приложения?', 'Що означають поля данные приложения?',
    'Чому пусте поле таблицы?', 'Будь ласка, поясни данные приложения',
    'Де знайти поле данные приложения?', 'Підкажи, як заповнити поле таблицы',
    'ПС РВ ПВК УДШВ', 'Can you help me?', 'Bonjour', 'こんにちは', '',
  ]) assert.equal(languageReply(query), null, query);
  for (const query of [null, undefined, { cells: ['таблицы'] }, ['данные']]) assert.equal(languageReply(query), null);
});

test('Russian outside a quoted field or file name is still recognized', () => {
  assert.equal(languageReply('Как добавить "Підрозділ" в таблицу?')?.status, 'language');
  assert.equal(languageReply('Как проверить Данные.xlsx?')?.status, 'language');
  assert.equal(languageReply('Как открыть таблицу «Профіль»?')?.status, 'language');
});

test('found source and application-state answers get a separate deterministic preface', () => {
  const answer = Object.freeze({ status: 'found', text: 'Синтетична точна цитата.', sources: Object.freeze([Object.freeze({ file: 'docs/USER_GUIDE.md', chunkId: 'synthetic' })]) });
  assert.equal(answerLead('Як внести таблицю?', answer), 'Таблиця — за процедурою.');
  assert.match(answerLead('Як перевірити оновлення?', answer), /Оновлення/u);
  assert.equal(answerLead('Як працюють профілі?', answer), 'Профіль — за процедурою.');
  assert.equal(answerLead('Як працюють профілі?', answer), answerLead('Як працюють профілі?', answer));
  assert.equal(answer.text, 'Синтетична точна цитата.');
  assert.deepEqual(answer.sources, [{ file: 'docs/USER_GUIDE.md', chunkId: 'synthetic' }]);
  assert.equal(answerLead('Яка поточна версія?', Object.freeze({ status: 'found', text: 'Синтетична версія: 9.8.7.', origin: 'application-state', sources: [] })), 'Версію — звірити.');
});

test('unknown, refused and language replies keep their exact contract without a preface', () => {
  const unknown = Object.freeze({ status: 'unknown', text: UNKNOWN_ANSWER, sources: Object.freeze([]), warnings: Object.freeze([]) });
  assert.equal(answerLead('Невідоме запитання', unknown), null);
  assert.equal(unknown.text, 'У довідці цього немає');
  assert.equal(answerLead('Як внести таблицю?', { status: 'refused', text: 'Відмова.', sources: [] }), null);
  assert.equal(answerLead('Как добавить таблицу?', languageReply('Как добавить таблицу?')), null);
  assert.equal(answerLead('Тест', { status: 'found', text: UNKNOWN_ANSWER, sources: [{ file: 'docs/USER_GUIDE.md' }] }), null);
  assert.equal(answerLead('Тест', { status: 'found', text: 'Без джерела.', sources: [] }), null);
  assert.equal(answerLead('Тест', null), null);
});

test('review remarks use actual error severity rather than total findings', () => {
  assert.equal(reviewLead({ counts: { total: 2, error: 2, warning: 0, advice: 0 } }), 'Хто б сумнівався: помилка на помилці. Гаразд, давай виправляти.');
  assert.match(reviewLead({ counts: { total: 9, error: 1, warning: 7, advice: 1 } }), /^Одна помилка\./u);
  const warnings = reviewLead({ counts: { total: 12, error: 0, warning: 10, advice: 2 } });
  assert.match(warnings, /^Помилок за правилами немає, але є попередження\./u);
  assert.doesNotMatch(warnings, /помилка на помилці|давай виправляти/u);
  assert.match(reviewLead({ counts: { total: 3, error: 0, warning: 0, advice: 3 } }), /Є поради/u);
  assert.match(reviewLead({ counts: { total: 0, error: 0, warning: 0, advice: 0 } }), /не схвалення даних/u);
});

test('review remarks are pure, inspect counts only and reject incomplete or invalid counts', () => {
  const review = Object.freeze({
    counts: Object.freeze({ total: 1, error: 0, warning: 1, advice: 0 }),
    items: Object.freeze([Object.freeze({ severity: 'warning', message: 'Как проверить таблицы?' })]),
  });
  const before = JSON.stringify(review);
  assert.match(reviewLead(review), /попередження/u);
  assert.equal(JSON.stringify(review), before);
  for (const value of [undefined, null, {}, { counts: { error: 0 } }, { counts: { error: -1, warning: 0, advice: 0 } }, { counts: { error: 0.5, warning: 0, advice: 0 } }, { counts: { error: '2', warning: 0, advice: 0 } }]) assert.equal(reviewLead(value), null);
  assert.equal(WELCOME_TEXT.heading, 'Так. Що цього разу?');
  assert.equal(WELCOME_TEXT.body, 'КОМБАТ. Інновації прийняв. Безлад — ні. Запитуй українською й по суті.');
  assert.ok(Object.isFrozen(WELCOME_TEXT));
});

test('усі фірмові репліки полковника на місці, без дублів і без підміни відповідей', async () => {
  const { COLONEL_PHRASES, welcomeRemark, reviewRemark } = await import('../src/assistant/assistant-persona-core.js');
  const all = Object.values(COLONEL_PHRASES).flat();
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 47);
  for (const phrase of ['Є думка, товариші, і думка ця правильна!', 'Зауваження слушне, але несвоєчасне!', 'Винних притягнути до відповідальності!', 'З метою недопущення подібного в майбутньому…']) assert.ok(all.includes(phrase), phrase);
  for (const phrase of all) assert.ok(!/[«»]/u.test(phrase), phrase);
  assert.equal(welcomeRemark(0), COLONEL_PHRASES.welcome[0]);
  assert.equal(welcomeRemark(COLONEL_PHRASES.welcome.length + 1), COLONEL_PHRASES.welcome[1]);
  assert.equal(welcomeRemark(-1), COLONEL_PHRASES.welcome[0]);
  assert.equal(welcomeRemark(NaN), COLONEL_PHRASES.welcome[0]);
  const counts = (error, warning, advice) => ({ counts: { error, warning, advice, total: error + warning + advice } });
  assert.ok(COLONEL_PHRASES.error.includes(reviewRemark(counts(1, 0, 0), 3)));
  assert.ok(COLONEL_PHRASES.warning.includes(reviewRemark(counts(0, 1, 0), 3)));
  assert.ok(COLONEL_PHRASES.warning.includes(reviewRemark(counts(0, 0, 2), 3)));
  assert.ok(COLONEL_PHRASES.clean.includes(reviewRemark(counts(0, 0, 0), 3)));
  assert.equal(reviewRemark(null, 1), null);
  assert.equal(reviewRemark({ counts: { error: -1, warning: 0, advice: 0 } }, 1), null);
  assert.equal(UNKNOWN_ANSWER, 'У довідці цього немає');
});
