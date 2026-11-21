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

import {
  ROLES,
  assignMemberRole,
  canAssignRole,
  createCollectiveWorkspace,
  deleteWorkspaceFile,
  formatAuditLine,
  formatInviteCode,
  generateInviteCode,
  issueInviteCode,
  memberRoleLabel,
  mergeWorkspaceStates,
  normalizeRole,
  parseInviteCode,
  redeemInviteCode,
  removeWorkspaceMember,
  roleLabel,
  rolePermissions,
  saveWorkspaceFile,
} from '../src/workspace/collectives/secure-core.js';

function deterministicRandom(seed = 1) {
  let s = seed;
  return n => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out[i] = (s >>> 16) & 0xff;
    }
    return out;
  };
}

test('3 ролі колективу: Керівник (творець), Молодший керівник та Користувач', () => {
  assert.equal(ROLES.leader, 'Керівник');
  assert.equal(ROLES.junior_leader, 'Молодший керівник');
  assert.equal(ROLES.user, 'Користувач');
  assert.equal(normalizeRole('owner'), 'leader');
  assert.equal(normalizeRole('admin'), 'junior_leader');
  assert.equal(normalizeRole('member'), 'user');
  assert.equal(roleLabel('leader'), 'Керівник');
  assert.equal(roleLabel('junior_leader'), 'Молодший керівник');
  assert.equal(roleLabel('user'), 'Користувач');
  assert.equal(memberRoleLabel({ founder: true }), 'Керівник');
  assert.equal(memberRoleLabel({ role: 'junior_leader' }), 'Молодший керівник');
  assert.equal(memberRoleLabel({ role: 'user' }), 'Користувач');

  const leaderPerms = rolePermissions('leader');
  const juniorPerms = rolePermissions('junior_leader');
  const userPerms = rolePermissions('user');
  assert.ok(leaderPerms.canAssignJuniorLeader && leaderPerms.canInvite && leaderPerms.canEditAllFiles);
  assert.ok(!juniorPerms.canAssignJuniorLeader && juniorPerms.canInvite && juniorPerms.canEditAllFiles);
  assert.ok(!userPerms.canInvite && !userPerms.canEditAllFiles && userPerms.canEditAllowedFiles);

  // Керівника не можна змінити
  assert.equal(canAssignRole({
    actorRole: 'leader', actorId: 'm1', targetRole: 'leader', targetId: 'm1', targetIsFounder: true, newRole: 'user',
  }).allowed, false);
  // Керівник може призначити Молодшого керівника
  assert.equal(canAssignRole({
    actorRole: 'leader', actorId: 'm1', targetRole: 'user', targetId: 'm2', newRole: 'junior_leader',
  }).allowed, true);
  // Молодший керівник не може призначити іншого Молодшого керівника
  assert.equal(canAssignRole({
    actorRole: 'junior_leader', actorId: 'm2', targetRole: 'user', targetId: 'm3', newRole: 'junior_leader',
  }).allowed, false);
});

test('запрошення за 6-значним кодом, вступ до колективу, спільне файлове середовище та журнал редагувань', () => {
  const rand = deterministicRandom(42);
  const code = generateInviteCode(rand);
  assert.match(code, /^\d{6}$/);
  assert.equal(parseInviteCode(formatInviteCode(code)), code);
  assert.throws(() => parseInviteCode('12345'), /6 цифр/);
  assert.throws(() => parseInviteCode('12345a'), /6 цифр/);

  // 1. Творець створює колектив і отримує роль «Керівник»
  let ws = createCollectiveWorkspace({
    collectiveId: 'coll-alpha',
    name: 'Оперативна група Альфа',
    founderId: 'u-leader',
    founderName: 'Синтетик Керівник',
    now: 1000,
  });
  assert.equal(ws.members.length, 1);
  assert.equal(ws.members[0].role, 'leader');
  assert.equal(ws.auditLog.length, 1);
  assert.match(formatAuditLine(ws.auditLog[0]), /Керівник.*Створення колективу/);

  // 2. Керівник генерує 6-значний код запрошення
  const issued = issueInviteCode(ws, {
    actorId: 'u-leader',
    assignedRole: 'user',
    randomBytes: rand,
    now: 1010,
  });
  ws = issued.workspace;
  assert.match(issued.invite.code, /^\d{6}$/);
  assert.equal(issued.invite.displayCode.length, 7);

  // 3. Другий користувач записує 6-значний код і потрапляє в колектив
  const joined = redeemInviteCode(ws, {
    code: issued.invite.displayCode,
    memberId: 'u-second',
    memberName: 'Синтетик Другий',
    now: 1020,
  });
  ws = joined.workspace;
  assert.equal(ws.members.length, 2);
  assert.equal(joined.member.role, 'user');
  assert.throws(() => redeemInviteCode(ws, {
    code: issued.invite.code, memberId: 'u-third', memberName: 'Синтетик Третій', now: 1025,
  }), /вже використано/);

  // 4. Керівник призначає другому учаснику роль «Молодший керівник» (фіксується в журналі)
  ws = assignMemberRole(ws, {
    actorId: 'u-leader',
    targetId: 'u-second',
    newRole: 'junior_leader',
    now: 1030,
  });
  assert.equal(ws.members.find(m => m.id === 'u-second').role, 'junior_leader');
  assert.equal(ws.auditLog[0].action, 'role_assigned');
  assert.match(ws.auditLog[0].details, /«Користувач» → «Молодший керівник»/);

  // 5. Молодший керівник генерує 6-значний код і запрошує третього учасника (Користувача)
  const issued2 = issueInviteCode(ws, {
    actorId: 'u-second',
    assignedRole: 'user',
    randomBytes: rand,
    now: 1040,
  });
  ws = redeemInviteCode(issued2.workspace, {
    code: issued2.invite.code,
    memberId: 'u-third',
    memberName: 'Синтетик Користувач',
    now: 1050,
  }).workspace;
  assert.equal(ws.members.length, 3);

  // 6. Робота в колективному файловому середовищі: створення та оновлення файлу різними учасниками
  const fileCreated = saveWorkspaceFile(ws, {
    actorId: 'u-leader',
    name: 'План_роботи.txt',
    kind: 'document',
    content: 'Рядок 1: Початковий план',
    summary: 'Початкова версія плану',
    now: 1060,
  });
  ws = fileCreated.workspace;
  assert.equal(ws.files.length, 1);
  assert.equal(ws.files[0].version, 1);

  // Користувач оновлює файл — версія зростає, у журналі редагувань з'являється запис
  const fileUpdated = saveWorkspaceFile(ws, {
    actorId: 'u-third',
    fileId: fileCreated.file.id,
    name: 'План_роботи.txt',
    kind: 'document',
    content: 'Рядок 1: Початковий план\nРядок 2: Доповнення від користувача',
    summary: 'Додано рядок 2',
    now: 1070,
  });
  ws = fileUpdated.workspace;
  assert.equal(ws.files[0].version, 2);
  assert.equal(ws.files[0].updatedByName, 'Синтетик Користувач');
  assert.equal(ws.files[0].history.length, 2);
  assert.equal(ws.auditLog[0].action, 'file_updated');

  // 7. Синхронізація між учасниками (mergeWorkspaceStates): усі у всіх відображає
  const peerCopy = createCollectiveWorkspace({
    collectiveId: 'coll-alpha',
    name: 'Оперативна група Альфа',
    founderId: 'u-leader',
    founderName: 'Синтетик Керівник',
    now: 1000,
  });
  const synced = mergeWorkspaceStates(peerCopy, ws);
  assert.equal(synced.members.length, 3);
  assert.equal(synced.files.length, 1);
  assert.equal(synced.files[0].version, 2);
  assert.equal(synced.files[0].content, ws.files[0].content);

  // Звичайний Користувач не може видалити файл, а Молодший керівник — може
  assert.throws(() => deleteWorkspaceFile(ws, {
    actorId: 'u-third', fileId: fileCreated.file.id, now: 1080,
  }), /Керівник та Молодший керівник/);
  ws = deleteWorkspaceFile(ws, {
    actorId: 'u-second', fileId: fileCreated.file.id, now: 1085,
  });
  assert.equal(ws.files.length, 0);
  assert.equal(ws.auditLog[0].action, 'file_deleted');

  // Вилучення учасника Керівником
  ws = removeWorkspaceMember(ws, {
    actorId: 'u-leader', targetId: 'u-third', now: 1090,
  });
  assert.equal(ws.members.length, 2);
});

