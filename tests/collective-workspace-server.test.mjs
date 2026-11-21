import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyDirectory, emptyDirectory, GUESS_LIMIT, GUESS_WINDOW_MS } from '../server/collective-workspace/directory.mjs';
import { issueInviteFlow, joinFlow } from '../server/collective-workspace/flow.mjs';
import { applyRoom, INVITE_TTL_MS, publicView } from '../server/collective-workspace/room.mjs';

function randomBytes(size) {
  return crypto.getRandomValues(new Uint8Array(size));
}

async function createCollective(name = 'Навчальна група', memberName = 'Синтетик Керівник', now = 1_000_000) {
  const created = await applyRoom(null, {
    op: 'create', name, memberName, now, randomBytes,
  });
  assert.equal(created.body.ok, true, created.body.error);
  return { room: created.room, token: created.body.token, memberId: created.body.memberId, now };
}

async function invite(state, assignedRole = 'user', who = state.token) {
  const issued = await issueInviteFlow({
    directory: state.directory || emptyDirectory(),
    room: state.room,
    token: who,
    assignedRole,
    now: state.now,
    randomBytes,
  });
  assert.equal(issued.result.ok, true, issued.result.error);
  return { ...state, directory: issued.directory, room: issued.room, invite: issued.result.invite };
}

test('творець стає Керівником, жетон не потрапляє у спільний знімок', async () => {
  const created = await createCollective();
  const view = publicView(created.room, created.memberId);
  assert.equal(view.members[0].role, 'leader');
  assert.equal(view.members[0].founder, true);
  assert.equal(view.yourRole, 'leader');
  assert.deepEqual(view.invites, []);
  const shared = JSON.stringify(view);
  assert.equal(shared.includes(created.token), false);
  assert.equal(shared.includes('tokenHash'), false);
  assert.equal(view.auditLog[0].action, 'collective_created');
});

test('ролі: Користувач не запрошує, Молодший керівник не призначає ролі, останній Керівник лишається', async () => {
  let state = await createCollective();
  state.directory = emptyDirectory();
  state = await invite(state, 'junior_leader');
  const junior = await joinFlow({
    directory: state.directory,
    room: state.room,
    code: state.invite.code,
    memberName: 'Синтетик Молодший',
    now: state.now + 10,
    clientKey: 'ip-a',
    randomBytes,
  });
  assert.equal(junior.result.view.yourRole, 'junior_leader');
  state = { ...state, directory: junior.directory, room: junior.room, now: state.now + 10 };

  const juniorInviteLeader = await issueInviteFlow({
    directory: state.directory, room: state.room, token: junior.result.token,
    assignedRole: 'leader', now: state.now, randomBytes,
  });
  assert.equal(juniorInviteLeader.result.ok, false);
  assert.match(juniorInviteLeader.result.error, /Користувач/);

  state = await invite({ ...state, token: state.token }, 'user');
  const user = await joinFlow({
    directory: state.directory, room: state.room, code: state.invite.code,
    memberName: 'Синтетик Користувач', now: state.now + 5, clientKey: 'ip-b', randomBytes,
  });
  assert.equal(user.result.ok, true);
  const userInvite = await applyRoom(user.room, {
    op: 'invite', token: user.result.token, assignedRole: 'user', now: state.now + 6, randomBytes,
  });
  assert.equal(userInvite.status, 403);

  const userAssign = await applyRoom(user.room, {
    op: 'role', token: user.result.token, targetId: junior.result.memberId, role: 'user', now: state.now + 6,
  });
  assert.equal(userAssign.status, 403);

  const juniorAssign = await applyRoom(user.room, {
    op: 'role', token: junior.result.token, targetId: user.result.memberId, role: 'junior_leader', now: state.now + 6,
  });
  assert.equal(juniorAssign.status, 403);

  const promoted = await applyRoom(user.room, {
    op: 'role', token: state.token, targetId: user.result.memberId, role: 'leader', now: state.now + 7,
  });
  assert.equal(promoted.body.ok, true);
  assert.equal(promoted.body.view.auditLog.at(-1).action, 'role_assigned');
  assert.equal(JSON.stringify(promoted.body.view).includes(state.invite.code), false);

  const demoteLast = await applyRoom(promoted.room, {
    op: 'role', token: user.result.token, targetId: state.memberId, role: 'user', now: state.now + 8,
  });
  assert.equal(demoteLast.body.ok, true, 'другий Керівник може змінити роль першого');
  const only = demoteLast.room.members.filter(member => member.role === 'leader');
  assert.equal(only.length, 1);
  const removeLast = await applyRoom(demoteLast.room, {
    op: 'remove', token: user.result.token, targetId: only[0].id, now: state.now + 9,
  });
  assert.equal(removeLast.status, 403);
  assert.match(removeLast.body.error, /хоча б один Керівник/);
});

test('код одноразовий, прострочений і після ліміту спроб не приймається; у знімку його немає', async () => {
  let state = await createCollective();
  state.directory = emptyDirectory();
  state = await invite(state, 'user');
  const code = state.invite.code;
  assert.match(code, /^\d{6}$/);
  assert.equal(JSON.stringify(state.invite && publicView(state.room, state.memberId)).includes(code), false);
  assert.equal(JSON.stringify(publicView(state.room, state.memberId).auditLog).includes(code), false);

  const expired = await joinFlow({
    directory: state.directory, room: state.room, code, memberName: 'Синтетик Гість',
    now: state.now + INVITE_TTL_MS, clientKey: 'ip-late', randomBytes,
  });
  assert.equal(expired.result.ok, false);
  assert.match(expired.result.error, /прострочен/);

  const joined = await joinFlow({
    directory: state.directory, room: state.room, code, memberName: 'Синтетик Гість',
    now: state.now + 1_000, clientKey: 'ip-ok', randomBytes,
  });
  assert.equal(joined.result.ok, true);
  assert.equal(joined.result.view.members.length, 2);
  assert.equal(JSON.stringify(joined.result.view).includes(code), false);
  assert.equal(joined.directory.codes[code], undefined);

  const again = await joinFlow({
    directory: joined.directory, room: joined.room, code, memberName: 'Синтетик Інший',
    now: state.now + 2_000, clientKey: 'ip-ok', randomBytes,
  });
  assert.equal(again.result.ok, false);

  let directory = emptyDirectory();
  const fresh = await invite({ ...state, directory, room: joined.room, now: state.now + 3_000 });
  directory = fresh.directory;
  for (let attempt = 0; attempt < GUESS_LIMIT; attempt += 1) {
    const wrong = String(100000 + attempt);
    const failed = await joinFlow({
      directory, room: fresh.room, code: wrong === fresh.invite.code ? '222222' : wrong,
      memberName: 'Синтетик Гість', now: state.now + 3_000, clientKey: 'ip-guess', randomBytes,
    });
    assert.equal(failed.status, 400);
    directory = failed.directory;
  }
  const blocked = await joinFlow({
    directory, room: fresh.room, code: fresh.invite.code, memberName: 'Синтетик Гість',
    now: state.now + 3_000, clientKey: 'ip-guess', randomBytes,
  });
  assert.equal(blocked.status, 429);
  const later = await joinFlow({
    directory: blocked.directory, room: fresh.room, code: fresh.invite.code,
    memberName: 'Синтетик Після',
    now: state.now + 3_000 + GUESS_WINDOW_MS, clientKey: 'ip-guess', randomBytes,
  });
  assert.equal(later.result.ok, true, later.result.error);
});

test('файли: Користувач змінює і видаляє, конфлікт версії не затирає чужий запис, журнал дописується', async () => {
  let state = await createCollective();
  state.directory = emptyDirectory();
  const made = await applyRoom(state.room, {
    op: 'file', fileOp: 'create', token: state.token, name: 'Нотатка.txt', kind: 'document',
    content: 'перша версія', summary: 'Початок', now: state.now, randomBytes,
  });
  assert.equal(made.body.ok, true);
  const fileId = made.body.fileId;
  state = await invite({ ...state, room: made.room }, 'user');
  const user = await joinFlow({
    directory: state.directory, room: state.room, code: state.invite.code,
    memberName: 'Синтетик Користувач', now: state.now + 5, clientKey: 'ip-u', randomBytes,
  });
  const saved = await applyRoom(user.room, {
    op: 'file', fileOp: 'save', token: user.result.token, fileId, baseVersion: 1,
    name: 'Нотатка.txt', content: 'друга версія', summary: 'Правка', now: state.now + 20,
  });
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.view.files[0].version, 2);
  assert.equal(saved.body.view.files[0].content, 'друга версія');
  assert.ok(saved.body.view.auditLog.some(item => item.action === 'file_updated' && item.actorRole === 'user'));

  const stale = await applyRoom(saved.room, {
    op: 'file', fileOp: 'save', token: state.token, fileId, baseVersion: 1,
    name: 'Нотатка.txt', content: 'застаріла', now: state.now + 30,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.conflict, true);
  assert.equal(stale.body.view.files[0].content, 'друга версія');

  const renamed = await applyRoom(saved.room, {
    op: 'file', fileOp: 'save', token: user.result.token, fileId, baseVersion: 2,
    name: 'Нотатка-2.txt', content: 'друга версія', now: state.now + 40,
  });
  assert.equal(renamed.body.ok, true);
  assert.ok(renamed.body.view.auditLog.some(item => item.action === 'file_renamed'));

  const removed = await applyRoom(renamed.room, {
    op: 'file', fileOp: 'delete', token: user.result.token, fileId, baseVersion: 3, now: state.now + 50,
  });
  assert.equal(removed.body.ok, true);
  assert.equal(removed.body.view.files.length, 0);
  assert.equal(removed.body.view.auditLog.at(-1).action, 'file_deleted');
  assert.equal(JSON.stringify(removed.body.view.auditLog).includes(state.invite.code), false);
});

test('серверний код не містить секретів і лімітує спроби за IP Cloudflare', async () => {
  const worker = await readFile(new URL('../server/collective-workspace/src/worker.mjs', import.meta.url), 'utf8');
  const config = await readFile(new URL('../server/collective-workspace/wrangler.toml', import.meta.url), 'utf8');
  assert.match(worker, /CF-Connecting-IP/);
  assert.doesNotMatch(worker, /account_id|api[_-]?token|SECRET|workers\.dev/i);
  assert.doesNotMatch(config, /account_id|api[_-]?token/);
  const listed = applyDirectory(emptyDirectory(), { op: 'list' });
  assert.deepEqual(listed.body.codes, []);
});
