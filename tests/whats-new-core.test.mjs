// «Що нового»: чиста логіка (src/whats-new-core.js) і розбір справжніх нотаток docs/releases.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  UNPUBLISHED_VERSIONS,
  canStep,
  compareVersions,
  firstSentence,
  hasUnseen,
  inlineSegments,
  isVersion,
  newestFirst,
  parseReleaseNotes,
  plainText,
  releaseHeading,
  splitLead,
  stepIndex,
  visibleReleases,
} from '../src/whats-new-core.js';

const root = new URL('../', import.meta.url);

test('версії: перевірка формату й порівняння за семвером, а не за рядком', () => {
  assert.equal(isVersion('2.1.1'), true);
  for (const bad of ['2.1', 'v2.1.1', '2.1.1-rc1', '', null, undefined, 211]) assert.equal(isVersion(bad), false, String(bad));
  assert.ok(compareVersions('1.0.7', '1.0.10') < 0, '1.0.7 старіша за 1.0.10');
  assert.ok(compareVersions('2.0.1', '1.9.9') > 0);
  assert.equal(compareVersions('0.9.0', '0.9.0'), 0);
  const sorted = ['0.9.6', '1.0.10', '1.0.7', '2.1.1'].map((version) => ({ version })).sort(newestFirst).map((r) => r.version);
  assert.deepEqual(sorted, ['2.1.1', '1.0.10', '1.0.7', '0.9.6']);
});

test('splitLead: коротке перше речення чи підпис до двокрапки стають заголовком, решта тексту не змінюється', () => {
  assert.deepEqual(splitLead('Файл для телефона. Тепер можна зберегти.'), { lead: 'Файл для телефона.', text: 'Тепер можна зберегти.' });
  assert.deepEqual(splitLead('Артилерія: щось нове у довіднику.'), { lead: 'Артилерія:', text: 'щось нове у довіднику.' });
  assert.deepEqual(splitLead('3D-довідники техніки. Нові сторінки.'), { lead: '3D-довідники техніки.', text: 'Нові сторінки.' });
  // Не з великої літери, надто довге або без продовження — заголовка немає.
  assert.deepEqual(splitLead('це абзац без заголовка. Далі текст.'), { lead: '', text: 'це абзац без заголовка. Далі текст.' });
  assert.deepEqual(splitLead('Лише одне речення без продовження.'), { lead: '', text: 'Лише одне речення без продовження.' });
  const long = 'Один два три чотири п\'ять шість сім вісім дев\'ять десять одинадцять. Далі.';
  assert.equal(splitLead(long).lead, '', 'більше десяти слів — це вже не заголовок');
  assert.deepEqual(splitLead('  \n '), { lead: '', text: '' });
});

test('splitLead не губить жодного символу: заголовок + пробіл + текст = початковий абзац', () => {
  for (const paragraph of ['КОМБАТ. Помічник запам\'ятовує репліки.', 'Артилерія: нове.', 'Просто текст без крапки', 'Стартовий екран. Оновлено тла плиток.']) {
    const { lead, text } = splitLead(paragraph);
    assert.equal(lead ? `${lead} ${text}` : text, paragraph);
  }
});

test('firstSentence і plainText', () => {
  assert.equal(firstSentence('Перше речення. Друге речення.'), 'Перше речення');
  assert.equal(firstSentence('Без крапки в кінці'), 'Без крапки в кінці');
  assert.equal(firstSentence('Версія 1.0.7 вийшла. Далі.'), 'Версія 1.0.7 вийшла', 'крапка всередині номера не кінець речення');
  assert.equal(plainText('Див. `docs/WORKFLOW.md` і `.xlsx`'), 'Див. docs/WORKFLOW.md і .xlsx');
});

test('inlineSegments: код у зворотних лапках відокремлюється, решта лишається текстом', () => {
  assert.deepEqual(inlineSegments('Див. `docs/WORKFLOW.md` далі.'), [
    { code: false, text: 'Див. ' },
    { code: true, text: 'docs/WORKFLOW.md' },
    { code: false, text: ' далі.' },
  ]);
  assert.deepEqual(inlineSegments('Без коду'), [{ code: false, text: 'Без коду' }]);
  assert.deepEqual(inlineSegments('`a``b`'), [{ code: true, text: 'a' }, { code: true, text: 'b' }]);
  assert.deepEqual(inlineSegments('Непарна ` лапка'), [{ code: false, text: 'Непарна ` лапка' }]);
  assert.deepEqual(inlineSegments(''), []);
  // HTML не розбирається: сегмент — просто рядок, який екран вставляє через textContent.
  assert.deepEqual(inlineSegments('<img src=x onerror=alert(1)>'), [{ code: false, text: '<img src=x onerror=alert(1)>' }]);
});

test('parseReleaseNotes: вступ «Версія X — …» стає intro, службовий префікс зникає, абзаци зберігають порядок', () => {
  const release = parseReleaseNotes(
    'Версія 2.1.1 — розмова з КОМБАТом і нові вигляди. Міграцій немає.\n\nКОМБАТ. Запам\'ятовує репліки.\n\nСтартовий екран. Оновлено тла.\n',
    '2.1.1',
  );
  assert.equal(release.version, '2.1.1');
  assert.equal(release.intro, 'Розмова з КОМБАТом і нові вигляди. Міграцій немає.');
  assert.equal(release.summary, 'Розмова з КОМБАТом і нові вигляди');
  assert.deepEqual(release.paragraphs, [
    { lead: 'КОМБАТ.', text: 'Запам\'ятовує репліки.' },
    { lead: 'Стартовий екран.', text: 'Оновлено тла.' },
  ]);
});

test('parseReleaseNotes: без вступу підпис для змісту беремо із заголовка чи першого речення; CRLF і зайві порожні рядки не заважають', () => {
  const withLead = parseReleaseNotes('Файл для телефона. Тепер можна зберегти.\r\n\r\n\r\nДругий абзац.', '1.0.3');
  assert.equal(withLead.intro, '');
  assert.equal(withLead.summary, 'Файл для телефона');
  assert.equal(withLead.paragraphs.length, 2);
  const colon = parseReleaseNotes('Артилерія: з\'явилася вкладка. Ще щось.', '1.0.7');
  assert.equal(colon.summary, 'Артилерія: з\'явилася вкладка');
  const plain = parseReleaseNotes('виправлено відкриття таблиці. Ще одне речення.', '0.8.0');
  assert.deepEqual(plain.paragraphs, [{ lead: '', text: 'виправлено відкриття таблиці. Ще одне речення.' }]);
  assert.equal(plain.summary, 'виправлено відкриття таблиці');
  assert.equal(parseReleaseNotes('Версія 2.0.1 — виправлено `код` у підписі. Далі.', '2.0.1').summary, 'Виправлено код у підписі', 'markdown-позначки не потрапляють у зміст');
});

test('parseReleaseNotes відхиляє порожні нотатки й некоректну версію', () => {
  assert.throws(() => parseReleaseNotes('   \n\n  ', '1.0.0'), /порожні/u);
  assert.throws(() => parseReleaseNotes('Текст', 'v1.0'), /Некоректна версія/u);
});

test('visibleReleases: не показує майбутні версії й сортує від найновішої; без відомої версії дає все', () => {
  const releases = ['0.9.0', '2.1.1', '1.0.7', '2.0.1'].map((version) => ({ version }));
  assert.deepEqual(visibleReleases(releases, '2.0.1').map((r) => r.version), ['2.0.1', '1.0.7', '0.9.0']);
  assert.deepEqual(visibleReleases(releases, '').map((r) => r.version), ['2.1.1', '2.0.1', '1.0.7', '0.9.0']);
  assert.deepEqual(visibleReleases(releases, 'нісенітниця').length, 4);
  assert.deepEqual(visibleReleases(null, '1.0.0'), []);
  assert.deepEqual(visibleReleases([{ version: 'x' }, null, { version: '1.0.0' }], ''), [{ version: '1.0.0' }]);
  assert.equal(releases[0].version, '0.9.0', 'вхідний масив не змінюється');
});

test('stepIndex і canStep: ‹ — до новішої (на початок списку), › — до старішої; межі не переступаються', () => {
  assert.equal(stepIndex(5, 2, 'newer'), 1);
  assert.equal(stepIndex(5, 2, 'older'), 3);
  assert.equal(stepIndex(5, 0, 'newer'), 0);
  assert.equal(stepIndex(5, 4, 'older'), 4);
  assert.equal(stepIndex(0, 3, 'older'), 0);
  assert.equal(stepIndex(5, 99, 'newer'), 3, 'індекс поза межами спершу обмежується');
  assert.equal(stepIndex(5, -4, 'older'), 1);
  assert.equal(stepIndex(5, 2, 'sideways'), 2);
  assert.equal(canStep(5, 0, 'newer'), false);
  assert.equal(canStep(5, 0, 'older'), true);
  assert.equal(canStep(5, 4, 'older'), false);
  assert.equal(canStep(1, 0, 'older'), false);
  assert.equal(canStep(0, 0, 'newer'), false);
});

test('hasUnseen: крапка є, поки не відкрито найновіший доступний випуск', () => {
  const releases = [{ version: '2.1.1' }, { version: '2.1.0' }];
  assert.equal(hasUnseen(releases, ''), true, 'ще нічого не відкривали');
  assert.equal(hasUnseen(releases, 'сміття'), true, 'зіпсований запис у сховищі');
  assert.equal(hasUnseen(releases, '2.1.0'), true);
  assert.equal(hasUnseen(releases, '2.1.1'), false);
  assert.equal(hasUnseen(releases, '3.0.0'), false, 'після відкату застосунку крапка не з\'являється знову');
  assert.equal(hasUnseen([], ''), false);
  assert.equal(hasUnseen(null, ''), false);
});

test('releaseHeading', () => {
  assert.equal(releaseHeading('2.1.1'), 'Що нового у версії 2.1.1');
});

test('справжні нотатки docs/releases розбираються: у кожній є текст, версія збігається з іменем файлу, заголовки короткі', async () => {
  const dir = new URL('docs/releases/', root);
  const names = (await readdir(dir)).filter((name) => /^v\d+\.\d+\.\d+\.md$/u.test(name));
  assert.ok(names.length >= 20, `знайдено нотаток: ${names.length}`);
  for (const name of names) {
    const version = name.slice(1, -3);
    const release = parseReleaseNotes(await readFile(new URL(name, dir), 'utf8'), version);
    assert.equal(release.version, version);
    // Зміст обрізає підпис до двох рядків; межа лише ловить випадок, коли розбір не відокремив перше речення.
    assert.ok(release.summary.length > 0 && release.summary.length <= 240, `${version}: підпис для змісту (${release.summary.length})`);
    assert.ok(release.intro || release.paragraphs.length > 0, version);
    assert.ok(!/^Версія\s+\d/u.test(release.intro), `${version}: службовий префікс прибрано`);
    for (const { lead, text } of release.paragraphs) {
      assert.ok(text.length > 0, `${version}: після заголовка «${lead}» є текст`);
      assert.ok(lead.length <= 80, `${version}: заголовок «${lead}» не довший за 80 символів`);
      assert.ok(!/<[a-z!/]/iu.test(lead + text) || /`/u.test(lead + text), `${version}: розмітки HTML у нотатках немає`);
    }
  }
});

test('2.0.0 не публікувалася: її нотатки лежать у docs/releases, але на екран не потрапляють', () => {
  assert.deepEqual([...UNPUBLISHED_VERSIONS], ['2.0.0']);
  assert.ok(Object.isFrozen(UNPUBLISHED_VERSIONS));
});
