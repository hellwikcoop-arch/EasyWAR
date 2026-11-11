import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORMAT, MAX_PARTICIPANTS, createCollective, renameCollective, addParticipant,
  changeParticipantRole, removeParticipant, encodeCollective, decodeCollective,
} from '../src/workspace/collectives/collectives-core.js';

test('локальний колектив зберігається у файлі без втрати учасників і ролей', () => {
  const initial = createCollective('Навчальна група', 'Власник');
  assert.equal(initial.format, FORMAT);
  const updated = addParticipant(addParticipant(initial, 'Учасник А'), 'Учасник Б', 'admin');
  const saved = decodeCollective(encodeCollective(updated));
  assert.equal(saved.name, 'Навчальна група');
  assert.deepEqual(saved.participants.map(p => p.role), ['owner', 'member', 'admin']);
  assert.deepEqual(saved, updated);
  assert.equal(initial.participants.length, 1, 'операції не змінюють попередній стан');
});

test('редагування ролі, видалення, перейменування, унікальність id', () => {
  let draft = addParticipant(createCollective('Колектив', 'Власник'), 'Перший');
  draft = changeParticipantRole(draft, 2, 'admin');
  draft = removeParticipant(draft, 2);
  draft = addParticipant(draft, 'Другий');
  assert.equal(draft.participants[1].id, 3);
  assert.equal(draft.participants[1].role, 'member');
  assert.equal(renameCollective(draft, 'Нова назва').name, 'Нова назва');
});

test('власника не можна видалити або змінити, дублікати заборонені', () => {
  const draft = createCollective('Група', 'Власник');
  assert.throws(() => removeParticipant(draft, 1), /Власника/);
  assert.throws(() => changeParticipantRole(draft, 1, 'member'), /власника/);
  assert.throws(() => addParticipant(draft, ' власник '), /Повторне/);
  assert.throws(() => addParticipant(draft, 'А', 'owner'), /роль/);
});

test('пошкоджений файл, інший формат та інʼєкції відхиляються', () => {
  assert.throws(() => decodeCollective(new Uint8Array()), /розмір/);
  assert.throws(() => decodeCollective(new TextEncoder().encode('{broken')), /прочитати/);
  assert.throws(() => decodeCollective(new TextEncoder().encode(JSON.stringify({ format: 'other' }))), /Невідомий формат/);
  assert.throws(() => createCollective('Тест\u202e', 'Власник'), /керівних/);
  assert.throws(() => createCollective('  ', 'Власник'), /Назва/);
  assert.throws(() => decodeCollective(new Uint8Array(65537)), /розмір/);
});

test('ліміт 100 і відсутність небезпечних побічних ефектів', () => {
  let draft = createCollective('Колектив', 'Власник');
  for (let i = 1; i < MAX_PARTICIPANTS; i++) draft = addParticipant(draft, 'План ' + i);
  assert.equal(draft.participants.length, 100);
  assert.throws(() => addParticipant(draft, 'Понад ліміт'), /100/);
  assert.ok(encodeCollective(draft).length < 65536);
});

// Захищені колективи (E8, C3b): чиста логіка екрана без DOM і IPC.
import {
  MAX_COLLECTIVES, canCreateCollective, canCreateIdentity, checkPassword, collectiveLine, keyStoreText,
} from '../src/workspace/collectives/secure-core.js';

test('захищені колективи: стани ключа, межі пароля, рядок колективу', () => {
  const absent = { keyStore: 'absent', identity: null, collectives: [] };
  assert.ok(canCreateIdentity(absent));
  assert.ok(!canCreateCollective(absent));
  assert.match(keyStoreText(absent), /ще немає/);
  const locked = { keyStore: 'locked', identity: { fingerprint: 'ABCDEFGHIJ' }, collectives: [] };
  assert.ok(!canCreateIdentity(locked));
  assert.ok(canCreateCollective(locked));
  assert.ok(!canCreateCollective({ ...locked, collectives: Array(MAX_COLLECTIVES).fill({}) }));
  assert.match(keyStoreText({ keyStore: 'damaged' }), /пошкоджене/);
  assert.ok(!canCreateIdentity({ keyStore: 'damaged' }));
  assert.throws(() => checkPassword('кор'), /8 до 1024/);
  assert.doesNotThrow(() => checkPassword('пароль-8'));
  assert.throws(() => checkPassword('a'.repeat(1025)), /8 до 1024/);
  assert.equal(collectiveLine({ members: 1, latestSeq: 2, rejectedRecords: 0 }), 'учасників: 1, записів журналу: 2');
  assert.match(collectiveLine({ members: 0, latestSeq: 0, rejectedRecords: 2 }), /відхилених записів: 2/);
});

import {
  CLASS_OPTIONS, PURPOSE_OPTIONS, TRANSPORT_OPTIONS, checkHours, checkOperation, detailLine,
  expectText, memberInitials, memberLine, membersCount, membersWord, pickCollective, preparedText, reportText, tableLine, textKind, transportNote,
  syncExportText, syncImportText,
} from '../src/workspace/collectives/secure-core.js';

test('обмін у колективі: підписи класу, транспорту, відмов і перевірки форм', () => {
  assert.deepEqual(CLASS_OPTIONS.map(option => option.value), ['A', 'B', 'C', 'D']);
  assert.deepEqual(PURPOSE_OPTIONS.map(option => option.value), ['after-fact', 'planned']);
  assert.deepEqual(TRANSPORT_OPTIONS.map(option => option.value), ['lan', 'peer_wan', 'base44']);
  assert.equal(tableLine({ class: 'B', declaredClass: 'B', purpose: 'after-fact', canWrite: true, mine: true }),
    'клас B, облік після факту, запис дозволено, ваша таблиця');
  assert.match(tableLine({ class: 'D', declaredClass: 'C', purpose: 'planned', canWrite: false, mine: false }),
    /вказано C; діє D.*\(завжди D\), без права запису$/);
  assert.equal(detailLine({ epoch: 0, latestSeq: 3, outbox: 1 }), 'епоха 0, записів журналу: 3, у локальній черзі відправки: 1');
  const current = { wanAccepted: false, base44Accepted: false };
  assert.match(transportNote(current, 'peer_wan'), /не прийнятий власником/);
  assert.match(transportNote(current, 'base44'), /Клас D у хмару не йде/);
  assert.match(transportNote(current, 'lan'), /мережі на цьому етапі немає/);
  assert.match(reportText({ allowed: true, message: 'Конверт у локальній черзі', outbox: 2 }), /У черзі: 2\.$/);
  assert.equal(preparedText({ allowed: true, table: 'Облік', class: 'C', transport: 'lan',
    recipients: 'усі учасники колективу', bytes: 2, expiresIn: 60 }),
  'Таблиця «Облік», клас C, транспорт lan, адресати: усі учасники колективу, 2 байт. Підтвердьте паролем протягом 60 с.');
  assert.equal(preparedText({ allowed: false, code: 'wan-not-ready', message: 'WAN-транспорт не пройшов безпекове приймання' }),
    'Відмова (wan-not-ready): WAN-транспорт не пройшов безпекове приймання.');
  assert.doesNotMatch(transportNote(current, 'peer_wan'), /лише облік класу C/, 'SEC-005: клас не блокує');
  assert.equal(reportText({ allowed: false, code: 'wan-not-ready', message: 'WAN-транспорт не пройшов безпекове приймання' }),
    'Відмова (wan-not-ready): WAN-транспорт не пройшов безпекове приймання.');
  assert.throws(() => checkOperation(''), /64 КіБ/);
  assert.throws(() => checkOperation('я'.repeat(32 * 1024 + 1)), /64 КіБ/, 'межа в байтах UTF-8');
  assert.doesNotThrow(() => checkOperation('{"row":"synthetic"}'));
  assert.equal(checkHours('24'), 24);
  for (const bad of ['0', '169', '1.5', 'день']) assert.throws(() => checkHours(bad), /1 до 168/);
  assert.equal(textKind(' EWINV1.abc\n'), 'invitation');
  assert.equal(textKind('EWJOIN1.abc'), 'request');
  assert.equal(textKind('EWKEYS1.abc'), 'keys');
  assert.equal(textKind('EWSYNC1.abc'), 'sync');
  assert.throws(() => expectText('EWSYNC1.x', 'keys'), /Вставлено пакет оновлення/);
  assert.equal(textKind('щось інше'), null);
  assert.throws(() => expectText('EWKEYS1.x', 'invitation'), /Вставлено пакет ключів/);
  assert.throws(() => expectText('', 'keys'), /EWKEYS1\./);
  assert.doesNotThrow(() => expectText('EWJOIN1.x', 'request'));
});

test('учасник колективу показується з ім’ям, яке він вказав сам', () => {
  assert.equal(memberLine({ fingerprint: 'ABCDEFGHIJ', name: 'Синтетик Петро' }), 'Синтетик Петро · ABCDEFGHIJ');
  assert.equal(memberLine({ fingerprint: 'ABCDEFGHIJ', name: null }), 'ABCDEFGHIJ');
});

test('кількість учасників узгоджується з числом, ініціали й вибір колективу', () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 21, 22, 25, 101, 111].map(membersCount), [
    '1 учасник', '2 учасники', '4 учасники', '5 учасників', '11 учасників', '12 учасників',
    '21 учасник', '22 учасники', '25 учасників', '101 учасник', '111 учасників',
  ]);
  assert.equal(membersWord(0), 'учасників');
  assert.equal(memberInitials('Синтетик Петро'), 'СП');
  assert.equal(memberInitials('  іван  '), 'І');
  assert.equal(memberInitials(null), '?');
  const list = [{ fingerprint: 'AAAAAAAAAA' }, { fingerprint: 'BBBBBBBBBB' }];
  assert.equal(pickCollective(list, ''), 'AAAAAAAAAA');
  assert.equal(pickCollective(list, 'BBBBBBBBBB'), 'BBBBBBBBBB');
  assert.equal(pickCollective(list, 'ZZZZZZZZZZ'), 'AAAAAAAAAA');
  assert.equal(pickCollective([], 'AAAAAAAAAA'), '');
});

test('пакет оновлення: підсумки створення й приймання', () => {
  assert.equal(syncExportText({ records: 6, tables: 1, changes: 2 }),
    'Журнал складу: 6 записів, таблиць: 1, пакетів змін: 2. Передайте текст учасникам колективу самі; прочитати його можуть лише учасники.');
  assert.equal(syncImportText({ newRecords: 0, tables: 1, newChanges: 2, knownChanges: 1, rejected: 0 }),
    'Пакет прийнято: нових записів журналу: 0, таблиць нових або оновлених: 1, нових пакетів змін: 2, вже були: 1.');
  assert.match(syncImportText({ newRecords: 1, tables: 0, newChanges: 0, knownChanges: 0, rejected: 2 }), /не пройшли перевірку й не збережені: 2\.$/);
});
