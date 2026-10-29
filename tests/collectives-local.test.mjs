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
  const locked = { keyStore: 'locked', identity: { fingerprint: 'ABCDE-FGHIJ' }, collectives: [] };
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
