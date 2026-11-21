// Кроки, спільні для тесту і для Cloudflare Worker: довідник кодів, потім кімната колективу.
import { applyDirectory } from './directory.mjs';
import { applyRoom } from './room.mjs';

export async function issueInviteFlow({ directory, room, token, assignedRole, now, randomBytes }) {
  const reserved = Object.keys(directory?.codes || {});
  const issued = await applyRoom(room, {
    op: 'invite', token, assignedRole, now, randomBytes, reserved,
  });
  if (!issued.body.ok) return { directory, room: issued.room, status: issued.status, result: issued.body };
  const registered = applyDirectory(directory, {
    op: 'register',
    code: issued.body.invite.code,
    collectiveId: room.collectiveId,
    expiresAt: issued.body.invite.expiresAt,
  });
  return { directory: registered.directory, room: issued.room, status: issued.status, result: issued.body };
}

export async function joinFlow({ directory, room, code, memberName, now, clientKey, randomBytes }) {
  const looked = applyDirectory(directory, { op: 'lookup', code, clientKey, now });
  if (!looked.body.ok) {
    return { directory: looked.directory, room, status: looked.status, result: looked.body };
  }
  const joined = await applyRoom(room, { op: 'join', code, memberName, now, randomBytes });
  if (!joined.body.ok) {
    const failed = applyDirectory(looked.directory, {
      op: 'fail', clientKey, now, forgetCode: code,
    });
    return { directory: failed.directory, room: joined.room, status: joined.status, result: joined.body };
  }
  const forgotten = applyDirectory(looked.directory, { op: 'forget', code });
  return { directory: forgotten.directory, room: joined.room, status: joined.status, result: joined.body };
}
