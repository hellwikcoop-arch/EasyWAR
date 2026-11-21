// Єдине захищене локально-мережеве колективне файлове середовище:
// - 3 ролі в колективі: Керівник (leader / owner — творець колективу), Молодший керівник
//   (junior_leader / admin), Користувач (user / member);
// - запрошення до колективу за 6-значним кодом: один учасник генерує 6-значний код, інший
//   вводить його й одразу потрапляє в колектив і бачить колективне файлове середовище;
// - колективне файлове середовище: і таблиці колективу, і файли/документи колективу (таблиці,
//   текстові/офісні документи) зі створенням, редагуванням, оновленням та версіями — усі зміни
//   відображаються в усіх учасників;
// - єдиний журнал редагувань і призначення ролей: кожне створення колективу, вступ за кодом,
//   призначення ролі, створення/оновлення/видалення файлу чи таблиці фіксується з часом, автором і роллю.
//
// Чиста логіка без DOM, мережі, сховищ і Tauri — перевіряється в node --test.

export const WORKSPACE_FORMAT = 'easywar-collective-workspace-v1';
export const INVITE_CODE_DIGITS = 6;
export const INVITE_TTL_SECONDS = 10 * 60; // 10 хв за замовчуванням
export const MAX_WORKSPACE_FILES = 100;
export const MAX_FILE_CONTENT_CHARS = 64 * 1024;
export const MAX_AUDIT_ENTRIES = 500;

/** Три ролі колективу. Підтримуються й синоніми ('owner' → 'leader', 'admin' → 'junior_leader', 'member' → 'user'). */
export const ROLES = Object.freeze({
  leader: 'Керівник',
  junior_leader: 'Молодший керівник',
  user: 'Користувач',
});

export const ROLE_KEYS = Object.freeze(['leader', 'junior_leader', 'user']);

const ROLE_ALIASES = Object.freeze({
  leader: 'leader',
  owner: 'leader',
  founder: 'leader',
  junior_leader: 'junior_leader',
  admin: 'junior_leader',
  user: 'user',
  member: 'user',
});

/** Приводить роль до одного з трьох канонічних ключів ('leader' | 'junior_leader' | 'user'). */
export function normalizeRole(role, { isFounder = false } = {}) {
  if (isFounder) return 'leader';
  const mapped = ROLE_ALIASES[String(role ?? '').trim().toLowerCase()];
  if (!mapped) throw new Error('Невідома роль у колективі. Допустимі: Керівник, Молодший керівник, Користувач.');
  return mapped;
}

/** Українська назва ролі. */
export function roleLabel(role, options) {
  return ROLES[normalizeRole(role, options)];
}

/** Опції ролей для вибору при призначенні (Керівник призначається автоматично творцю колективу). */
export const ASSIGNABLE_ROLE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'user', label: ROLES.user }),
  Object.freeze({ value: 'junior_leader', label: ROLES.junior_leader }),
]);

export const ALL_ROLE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'leader', label: ROLES.leader }),
  Object.freeze({ value: 'junior_leader', label: ROLES.junior_leader }),
  Object.freeze({ value: 'user', label: ROLES.user }),
]);

/**
 * Права ролей:
 * - Керівник (творець колективу): повні права (призначення ролей «Молодший керівник» і «Користувач»,
 *   керування учасниками, запрошення за 6-значним кодом, створення/редагування/видалення всіх файлів і таблиць);
 * - Молодший керівник: керування файлами й таблицями (створення, редагування, оновлення), генерування
 *   6-значних кодів запрошення та призначення ролі «Користувач» звичайним учасникам (не може змінювати Керівника
 *   чи призначати інших Молодших керівників);
 * - Користувач: робота з дозволеними файлами й таблицями колективу (перегляд, редагування та оновлення файлів).
 */
export function rolePermissions(role, options) {
  const r = normalizeRole(role, options);
  return Object.freeze({
    role: r,
    label: ROLES[r],
    canInvite: r === 'leader' || r === 'junior_leader',
    canAssignJuniorLeader: r === 'leader',
    canAssignUserRole: r === 'leader' || r === 'junior_leader',
    canRemoveMembers: r === 'leader',
    canCreateFiles: r === 'leader' || r === 'junior_leader' || r === 'user',
    canEditAllFiles: r === 'leader' || r === 'junior_leader',
    canEditAllowedFiles: true,
    canDeleteFiles: r === 'leader' || r === 'junior_leader',
    canManageTables: r === 'leader' || r === 'junior_leader',
  });
}

/**
 * Перевіряє, чи може актор (`actorRole`, `actorId`) призначити `newRole` учаснику (`targetRole`, `targetId`, `targetIsFounder`).
 */
export function canAssignRole({ actorRole, actorId, targetRole, targetId, targetIsFounder = false, newRole }) {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole, { isFounder: targetIsFounder });
  const desired = normalizeRole(newRole);

  if (targetIsFounder || target === 'leader') {
    return Object.freeze({ allowed: false, reason: 'Роль Керівника (творця колективу) змінювати не можна.' });
  }
  if (desired === 'leader') {
    return Object.freeze({ allowed: false, reason: 'У колективі може бути лише один Керівник (творець колективу).' });
  }
  if (actorId && targetId && actorId === targetId) {
    return Object.freeze({ allowed: false, reason: 'Не можна змінювати власну роль.' });
  }
  if (actor === 'leader') {
    return Object.freeze({ allowed: true, reason: '' });
  }
  if (actor === 'junior_leader') {
    if (target === 'junior_leader') {
      return Object.freeze({ allowed: false, reason: 'Молодший керівник не може змінювати роль іншого Молодшого керівника.' });
    }
    if (desired !== 'user') {
      return Object.freeze({ allowed: false, reason: 'Призначати роль «Молодший керівник» може лише Керівник колективу.' });
    }
    return Object.freeze({ allowed: true, reason: '' });
  }
  return Object.freeze({ allowed: false, reason: 'Призначати ролі можуть лише Керівник та Молодший керівник.' });
}

// --- 6-значний код запрошення ---------------------------------------------------------------

/** Форматує 6 цифр як «123 456» для зручного читання та введення. */
export function formatInviteCode(code) {
  const digits = parseInviteCode(code);
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)}`;
}

/** Перевіряє та повертає рівно 6 цифр коду (допускає пробіли й дефіси). */
export function parseInviteCode(text) {
  const raw = String(text ?? '').trim();
  if (!raw || /[^0-9\s\u00a0-]/u.test(raw)) {
    throw new Error('Код запрошення має містити рівно 6 цифр.');
  }
  const digits = raw.replace(/[\s\u00a0-]+/gu, '');
  if (!/^\d{6}$/u.test(digits)) {
    throw new Error('Код запрошення має містити рівно 6 цифр.');
  }
  return digits;
}

/**
 * Генерує новий 6-значний код запрошення (від 000000 до 999999) із переданих випадкових байтів,
 * уникаючи вже активних кодів у `activeCodes`.
 * `randomBytes(n)` → Uint8Array(n).
 */
export function generateInviteCode(randomBytes, activeCodes = new Set()) {
  if (typeof randomBytes !== 'function') throw new Error('Потрібен генератор випадкових байтів.');
  const used = new Set([...activeCodes].map(c => String(c).replace(/\D/g, '')));
  // Відкидання вибірки: 2^32 не ділиться на 1_000_000.
  const limit = 0x100000000 - (0x100000000 % 1000000);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const bytes = randomBytes(4);
    if (!(bytes instanceof Uint8Array) || bytes.length < 4) throw new Error('Недостатньо випадкових байтів.');
    const value = ((bytes[0] << 24) >>> 0) + ((bytes[1] << 16) + (bytes[2] << 8) + bytes[3]);
    if (value >= limit) continue;
    const code = String(value % 1000000).padStart(INVITE_CODE_DIGITS, '0');
    if (!used.has(code)) return code;
  }
  throw new Error('Не вдалося згенерувати унікальний 6-значний код.');
}

// --- Валідація назв і полів -----------------------------------------------------------------

const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SINGLE_LINE_CONTROL = /[\p{Cc}\p{Cf}]/u;

export function cleanSingleLine(value, label = 'Назва', maxLen = 80) {
  if (typeof value !== 'string') throw new Error(`${label}: введіть текст.`);
  const text = value.trim().replace(/\s+/gu, ' ');
  if (!text || [...text].length > maxLen || SINGLE_LINE_CONTROL.test(text)) {
    throw new Error(`${label}: від 1 до ${maxLen} символів без керівних знаків.`);
  }
  return text;
}

export function cleanFileContent(value, label = 'Вміст файлу') {
  const text = String(value ?? '');
  if ([...text].length > MAX_FILE_CONTENT_CHARS || CONTROL_CHARS.test(text)) {
    throw new Error(`${label}: до ${MAX_FILE_CONTENT_CHARS} символів без керівних знаків.`);
  }
  return text;
}

export const FILE_KINDS = Object.freeze({
  document: 'Документ',
  table: 'Таблиця',
  note: 'Робочий файл',
});

export const FILE_KIND_OPTIONS = Object.freeze([
  Object.freeze({ value: 'document', label: 'Документ (.txt / .md / .docx)' }),
  Object.freeze({ value: 'table', label: 'Таблиця (.csv / .xlsx)' }),
  Object.freeze({ value: 'note', label: 'Робочий запис / інструкція' }),
]);

export function normalizeFileKind(kind, fileName = '') {
  const ext = String(fileName).split('.').pop()?.toLowerCase() ?? '';
  if (kind && Object.prototype.hasOwnProperty.call(FILE_KINDS, kind)) return kind;
  if (['csv', 'xlsx', 'tsv'].includes(ext)) return 'table';
  if (['txt', 'md', 'doc', 'docx'].includes(ext)) return 'document';
  return 'document';
}

// --- Журнал редагувань і призначення ролей --------------------------------------------------

export const AUDIT_ACTIONS = Object.freeze({
  collective_created: 'Створення колективу',
  invite_code_created: 'Згенеровано 6-значний код запрошення',
  member_joined_by_code: 'Вступ до колективу за 6-значним кодом',
  member_added: 'Додано учасника до колективу',
  member_removed: 'Вилучено учасника з колективу',
  role_assigned: 'Призначення ролі',
  file_created: 'Створено файл у колективному середовищі',
  file_updated: 'Оновлено файл у колективному середовищі',
  file_deleted: 'Видалено файл із колективного середовища',
  table_created: 'Створено спільну таблицю',
  table_updated: 'Оновлено дані спільної таблиці',
});

export function auditActionLabel(action) {
  return AUDIT_ACTIONS[action] ?? 'Дія в колективі';
}

/**
 * Створює запис журналу редагувань та призначення ролей.
 */
export function createAuditEntry({
  id,
  action,
  actorId,
  actorName,
  actorRole,
  target = '',
  details = '',
  before = null,
  after = null,
  timestamp,
}) {
  if (!AUDIT_ACTIONS[action]) throw new Error(`Невідомий тип запису журналу: ${action}`);
  return Object.freeze({
    id: String(id || 'audit-1'),
    action,
    actionLabel: AUDIT_ACTIONS[action],
    actorId: String(actorId || ''),
    actorName: cleanSingleLine(actorName || 'Учасник', 'Автор дії', 80),
    actorRole: normalizeRole(actorRole || 'user'),
    actorRoleLabel: roleLabel(actorRole || 'user'),
    target: target ? String(target).trim() : '',
    details: details ? String(details).trim() : '',
    before: before == null ? null : String(before),
    after: after == null ? null : String(after),
    timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : 0,
  });
}

/** Форматує рядок запису журналу для показу людині. */
export function formatAuditLine(entry) {
  if (!entry) return '';
  const who = `${entry.actorName} (${entry.actorRoleLabel || roleLabel(entry.actorRole)})`;
  const what = entry.actionLabel || auditActionLabel(entry.action);
  const target = entry.target ? ` — «${entry.target}»` : '';
  const details = entry.details ? `: ${entry.details}` : '';
  return `${who}: ${what}${target}${details}`;
}

// --- Стан колективного файлового середовища -------------------------------------------------

function appendAudit(list, entry) {
  const next = [entry, ...(Array.isArray(list) ? list : [])];
  if (next.length > MAX_AUDIT_ENTRIES) next.length = MAX_AUDIT_ENTRIES;
  return Object.freeze(next);
}

/**
 * Створює нове колективне файлове середовище.
 * Творець автоматично отримує роль `leader` («Керівник»).
 */
export function createCollectiveWorkspace({
  collectiveId,
  name,
  founderId,
  founderName,
  now = 0,
}) {
  const cId = cleanSingleLine(collectiveId || 'coll-1', 'Ідентифікатор колективу', 64);
  const cName = cleanSingleLine(name, 'Назва колективу', 80);
  const fId = cleanSingleLine(founderId || 'member-1', 'Ідентифікатор керівника', 64);
  const fName = cleanSingleLine(founderName, 'Ім’я керівника', 80);

  const founder = Object.freeze({
    id: fId,
    name: fName,
    role: 'leader',
    founder: true,
    joinedAt: now,
  });

  const audit = createAuditEntry({
    id: `log-1`,
    action: 'collective_created',
    actorId: fId,
    actorName: fName,
    actorRole: 'leader',
    target: cName,
    details: `Призначено роль «${ROLES.leader}» творцю колективу`,
    after: ROLES.leader,
    timestamp: now,
  });

  return Object.freeze({
    format: WORKSPACE_FORMAT,
    collectiveId: cId,
    name: cName,
    createdAt: now,
    nextSeq: 2,
    members: Object.freeze([founder]),
    invites: Object.freeze([]),
    files: Object.freeze([]),
    auditLog: Object.freeze([audit]),
  });
}

function findMember(workspace, memberId) {
  const member = workspace?.members?.find(m => m.id === memberId);
  if (!member) throw new Error('Учасника немає в цьому колективі.');
  return member;
}

/**
 * Генерує 6-значний код запрошення до колективу.
 * Можуть викликати Керівник або Молодший керівник.
 */
export function issueInviteCode(workspace, {
  actorId,
  assignedRole = 'user',
  randomBytes,
  now = 0,
  ttlSeconds = INVITE_TTL_SECONDS,
}) {
  const actor = findMember(workspace, actorId);
  const perms = rolePermissions(actor.role, { isFounder: actor.founder });
  if (!perms.canInvite) {
    throw new Error('Генерувати 6-значний код запрошення можуть лише Керівник та Молодший керівник.');
  }
  const roleToAssign = normalizeRole(assignedRole);
  if (roleToAssign === 'leader') {
    throw new Error('Запрошення не може надавати роль Керівника.');
  }
  if (roleToAssign === 'junior_leader' && !perms.canAssignJuniorLeader) {
    throw new Error('Запрошувати на роль «Молодший керівник» може лише Керівник колективу.');
  }

  const activeInvites = workspace.invites.filter(inv => !inv.usedBy && inv.expiresAt > now);
  const activeCodes = new Set(activeInvites.map(inv => inv.code));
  const code = generateInviteCode(randomBytes, activeCodes);
  const seq = workspace.nextSeq;

  const invite = Object.freeze({
    code,
    displayCode: formatInviteCode(code),
    collectiveId: workspace.collectiveId,
    collectiveName: workspace.name,
    issuerId: actor.id,
    issuerName: actor.name,
    assignedRole: roleToAssign,
    createdAt: now,
    expiresAt: now + ttlSeconds,
    usedBy: null,
    usedAt: null,
  });

  const audit = createAuditEntry({
    id: `log-${seq}`,
    action: 'invite_code_created',
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    target: formatInviteCode(code),
    details: `Код для вступу з роллю «${roleLabel(roleToAssign)}»`,
    after: roleLabel(roleToAssign),
    timestamp: now,
  });

  const nextWorkspace = Object.freeze({
    ...workspace,
    nextSeq: seq + 1,
    invites: Object.freeze([invite, ...activeInvites]),
    auditLog: appendAudit(workspace.auditLog, audit),
  });

  return Object.freeze({ workspace: nextWorkspace, invite });
}

/**
 * Вступ другого користувача за 6-значним кодом.
 * Користувач вводить 6-значний код і потрапляє в колектив та його файлове середовище.
 */
export function redeemInviteCode(workspace, {
  code,
  memberId,
  memberName,
  now = 0,
}) {
  const digits = parseInviteCode(code);
  const mId = cleanSingleLine(memberId, 'Ідентифікатор учасника', 64);
  const mName = cleanSingleLine(memberName, 'Ім’я учасника', 80);

  if (workspace.members.some(m => m.id === mId)) {
    throw new Error('Ви вже є учасником цього колективу.');
  }
  const nameKey = mName.toLocaleLowerCase('uk-UA');
  if (workspace.members.some(m => m.name.toLocaleLowerCase('uk-UA') === nameKey)) {
    throw new Error('Учасник із таким ім’ям уже є в колективі.');
  }

  const invite = workspace.invites.find(inv => inv.code === digits);
  if (!invite) {
    throw new Error('Невірний 6-значний код запрошення.');
  }
  if (invite.usedBy) {
    throw new Error('Цей 6-значний код запрошення вже використано.');
  }
  if (now > invite.expiresAt) {
    throw new Error('Строк дії цього 6-значного коду запрошення минув.');
  }

  const role = normalizeRole(invite.assignedRole);
  const member = Object.freeze({
    id: mId,
    name: mName,
    role,
    founder: false,
    joinedAt: now,
    invitedBy: invite.issuerId,
  });

  const seq = workspace.nextSeq;
  const audit = createAuditEntry({
    id: `log-${seq}`,
    action: 'member_joined_by_code',
    actorId: mId,
    actorName: mName,
    actorRole: role,
    target: workspace.name,
    details: `Вступ за кодом ${formatInviteCode(digits)} (запросив ${invite.issuerName}), роль «${roleLabel(role)}»`,
    after: roleLabel(role),
    timestamp: now,
  });

  const nextInvites = workspace.invites.map(inv => (inv.code === digits
    ? Object.freeze({ ...inv, usedBy: mId, usedByName: mName, usedAt: now })
    : inv));

  const nextWorkspace = Object.freeze({
    ...workspace,
    nextSeq: seq + 1,
    members: Object.freeze([...workspace.members, member]),
    invites: Object.freeze(nextInvites),
    auditLog: appendAudit(workspace.auditLog, audit),
  });

  return Object.freeze({ workspace: nextWorkspace, member, invite });
}

/**
 * Призначення або зміна ролі учасника в колективі з обов'язковим записом у журнал.
 */
export function assignMemberRole(workspace, {
  actorId,
  targetId,
  newRole,
  now = 0,
}) {
  const actor = findMember(workspace, actorId);
  const target = findMember(workspace, targetId);
  const desired = normalizeRole(newRole);

  const check = canAssignRole({
    actorRole: actor.role,
    actorId: actor.id,
    targetRole: target.role,
    targetId: target.id,
    targetIsFounder: target.founder,
    newRole: desired,
  });
  if (!check.allowed) throw new Error(check.reason);

  if (target.role === desired) {
    return workspace;
  }

  const previousLabel = roleLabel(target.role, { isFounder: target.founder });
  const nextLabel = roleLabel(desired);
  const seq = workspace.nextSeq;

  const audit = createAuditEntry({
    id: `log-${seq}`,
    action: 'role_assigned',
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    target: target.name,
    details: `Роль змінено: «${previousLabel}» → «${nextLabel}»`,
    before: previousLabel,
    after: nextLabel,
    timestamp: now,
  });

  return Object.freeze({
    ...workspace,
    nextSeq: seq + 1,
    members: Object.freeze(workspace.members.map(m => (m.id === target.id
      ? Object.freeze({ ...m, role: desired })
      : m))),
    auditLog: appendAudit(workspace.auditLog, audit),
  });
}

/**
 * Вилучення учасника з колективу (доступно Керівнику; самого Керівника вилучити не можна).
 */
export function removeWorkspaceMember(workspace, {
  actorId,
  targetId,
  now = 0,
}) {
  const actor = findMember(workspace, actorId);
  const target = findMember(workspace, targetId);
  if (target.founder || target.role === 'leader') {
    throw new Error('Керівника колективу вилучити не можна.');
  }
  const perms = rolePermissions(actor.role, { isFounder: actor.founder });
  if (!perms.canRemoveMembers) {
    throw new Error('Вилучати учасників може лише Керівник колективу.');
  }
  const seq = workspace.nextSeq;
  const audit = createAuditEntry({
    id: `log-${seq}`,
    action: 'member_removed',
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    target: target.name,
    details: `Вилучено учасника з роллю «${roleLabel(target.role)}»`,
    before: roleLabel(target.role),
    timestamp: now,
  });
  return Object.freeze({
    ...workspace,
    nextSeq: seq + 1,
    members: Object.freeze(workspace.members.filter(m => m.id !== target.id)),
    auditLog: appendAudit(workspace.auditLog, audit),
  });
}

// --- Файли й документи колективного файлового середовища ------------------------------------

/**
 * Створює або оновлює файл у колективному файловому середовищі.
 * Усі учасники колективу бачать актуальний стан файлу, його версію, автора останньої зміни
 * та повний журнал редагувань.
 */
export function saveWorkspaceFile(workspace, {
  actorId,
  fileId = null,
  name,
  kind = 'document',
  content = '',
  summary = '',
  writers = null, // null або [] означає, що редагувати можуть усі учасники колективу
  now = 0,
}) {
  const actor = findMember(workspace, actorId);
  const cleanName = cleanSingleLine(name, 'Назва файлу', 120);
  const normalizedKind = normalizeFileKind(kind, cleanName);
  const cleanContent = cleanFileContent(content);
  const cleanSummary = summary ? cleanSingleLine(summary, 'Опис зміни', 160) : '';
  const seq = workspace.nextSeq;

  const existing = fileId
    ? workspace.files.find(f => f.id === fileId)
    : workspace.files.find(f => f.name.toLocaleLowerCase('uk-UA') === cleanName.toLocaleLowerCase('uk-UA'));

  if (!existing) {
    if (workspace.files.length >= MAX_WORKSPACE_FILES) {
      throw new Error(`У колективному середовищі не більше ${MAX_WORKSPACE_FILES} файлів.`);
    }
    const id = fileId ? cleanSingleLine(fileId, 'Ідентифікатор файлу', 64) : `file-${seq}`;
    const allowedWriters = Array.isArray(writers) ? Object.freeze([...new Set(writers.map(String))]) : Object.freeze([]);
    const versionEntry = Object.freeze({
      version: 1,
      authorId: actor.id,
      authorName: actor.name,
      authorRole: actor.role,
      timestamp: now,
      size: cleanContent.length,
      summary: cleanSummary || 'Створено файл',
      content: cleanContent,
    });
    const file = Object.freeze({
      id,
      name: cleanName,
      kind: normalizedKind,
      kindLabel: FILE_KINDS[normalizedKind],
      content: cleanContent,
      size: cleanContent.length,
      version: 1,
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: now,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedByRole: actor.role,
      updatedAt: now,
      writers: allowedWriters,
      history: Object.freeze([versionEntry]),
    });
    const audit = createAuditEntry({
      id: `log-${seq}`,
      action: normalizedKind === 'table' ? 'table_created' : 'file_created',
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      target: cleanName,
      details: cleanSummary || `${FILE_KINDS[normalizedKind]}, версія 1 (${cleanContent.length} симв.)`,
      after: `v1 (${cleanContent.length} симв.)`,
      timestamp: now,
    });
    return Object.freeze({
      workspace: Object.freeze({
        ...workspace,
        nextSeq: seq + 1,
        files: Object.freeze([...workspace.files, file]),
        auditLog: appendAudit(workspace.auditLog, audit),
      }),
      file,
      created: true,
    });
  }

  // Перевірка прав на редагування існуючого файлу.
  const perms = rolePermissions(actor.role, { isFounder: actor.founder });
  const canWrite = perms.canEditAllFiles
    || existing.createdBy === actor.id
    || existing.writers.length === 0
    || existing.writers.includes(actor.id);
  if (!canWrite) {
    throw new Error('У вас немає прав на редагування цього файлу.');
  }

  // Тільки Керівник, Молодший керівник або автор файлу може змінювати список writers.
  const nextWriters = Array.isArray(writers) && (perms.canEditAllFiles || existing.createdBy === actor.id)
    ? Object.freeze([...new Set(writers.map(String))])
    : existing.writers;

  const nextVersion = existing.version + 1;
  const versionEntry = Object.freeze({
    version: nextVersion,
    authorId: actor.id,
    authorName: actor.name,
    authorRole: actor.role,
    timestamp: now,
    size: cleanContent.length,
    summary: cleanSummary || `Оновлено вміст (версія ${nextVersion})`,
    content: cleanContent,
  });

  const updatedFile = Object.freeze({
    ...existing,
    name: cleanName,
    kind: normalizedKind,
    kindLabel: FILE_KINDS[normalizedKind],
    content: cleanContent,
    size: cleanContent.length,
    version: nextVersion,
    updatedBy: actor.id,
    updatedByName: actor.name,
    updatedByRole: actor.role,
    updatedAt: now,
    writers: nextWriters,
    history: Object.freeze([versionEntry, ...existing.history].slice(0, 50)),
  });

  const audit = createAuditEntry({
    id: `log-${seq}`,
    action: normalizedKind === 'table' ? 'table_updated' : 'file_updated',
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    target: cleanName,
    details: cleanSummary || `Версія ${existing.version} → ${nextVersion} (${cleanContent.length} симв.)`,
    before: `v${existing.version} (${existing.size} симв.)`,
    after: `v${nextVersion} (${cleanContent.length} симв.)`,
    timestamp: now,
  });

  return Object.freeze({
    workspace: Object.freeze({
      ...workspace,
      nextSeq: seq + 1,
      files: Object.freeze(workspace.files.map(f => (f.id === existing.id ? updatedFile : f))),
      auditLog: appendAudit(workspace.auditLog, audit),
    }),
    file: updatedFile,
    created: false,
  });
}

/**
 * Видаляє файл із колективного файлового середовища (Керівник або Молодший керівник).
 */
export function deleteWorkspaceFile(workspace, {
  actorId,
  fileId,
  now = 0,
}) {
  const actor = findMember(workspace, actorId);
  const perms = rolePermissions(actor.role, { isFounder: actor.founder });
  if (!perms.canDeleteFiles) {
    throw new Error('Видаляти файли з колективного середовища можуть лише Керівник та Молодший керівник.');
  }
  const existing = workspace.files.find(f => f.id === fileId);
  if (!existing) throw new Error('Файл не знайдено в колективному середовищі.');

  const seq = workspace.nextSeq;
  const audit = createAuditEntry({
    id: `log-${seq}`,
    action: 'file_deleted',
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    target: existing.name,
    details: `Видалено файл (була версія ${existing.version})`,
    before: `v${existing.version}`,
    timestamp: now,
  });

  return Object.freeze({
    ...workspace,
    nextSeq: seq + 1,
    files: Object.freeze(workspace.files.filter(f => f.id !== existing.id)),
    auditLog: appendAudit(workspace.auditLog, audit),
  });
}

/**
 * Зливає стан двох копій того самого колективного файлового середовища під час синхронізації
 * між учасниками (локально між вкладками/профілями або через мережу/Relay/пакет).
 * Детерміновано об'єднує учасників, ролі, файли (за новішою версією/часом) та журнал редагувань.
 */
export function mergeWorkspaceStates(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  if (local.collectiveId !== remote.collectiveId) {
    throw new Error('Неможливо об’єднати різні колективи.');
  }

  // Журнал редагувань об'єднується за унікальним ключем (id + timestamp + action + actorId + target).
  const auditMap = new Map();
  for (const entry of [...(remote.auditLog ?? []), ...(local.auditLog ?? [])]) {
    const key = `${entry.id}:${entry.timestamp}:${entry.action}:${entry.actorId}:${entry.target}`;
    if (!auditMap.has(key)) auditMap.set(key, entry);
  }
  const mergedAudit = Object.freeze(
    [...auditMap.values()]
      .sort((a, b) => (b.timestamp - a.timestamp) || String(b.id).localeCompare(String(a.id)))
      .slice(0, MAX_AUDIT_ENTRIES),
  );

  // Ролі визначаються за останнім записом role_assigned у журналі, або за поточним станом.
  const latestRoleByName = new Map();
  for (const entry of mergedAudit) {
    if (entry.action === 'role_assigned' && entry.target && !latestRoleByName.has(entry.target)) {
      const roleKey = Object.entries(ROLES).find(([, label]) => label === entry.after)?.[0];
      if (roleKey) latestRoleByName.set(entry.target, roleKey);
    }
  }

  // Віддалені учасники + локальні. Якщо учасника вилучено після його вступу — враховуємо журнал.
  const memberMap = new Map();
  for (const member of [...(local.members ?? []), ...(remote.members ?? [])]) {
    const prev = memberMap.get(member.id);
    const founder = Boolean(member.founder || prev?.founder);
    const assigned = founder ? 'leader' : (latestRoleByName.get(member.name) || remote.members?.find(m => m.id === member.id)?.role || member.role);
    memberMap.set(member.id, Object.freeze({
      ...prev,
      ...member,
      founder,
      role: normalizeRole(assigned, { isFounder: founder }),
    }));
  }

  // Об'єднання запрошень.
  const inviteMap = new Map();
  for (const inv of [...(local.invites ?? []), ...(remote.invites ?? [])]) {
    const prev = inviteMap.get(inv.code);
    if (!prev || (!prev.usedBy && inv.usedBy)) {
      inviteMap.set(inv.code, inv);
    }
  }

  // Об'єднання файлів: виграє файл із більшою версією (а при рівній — новіший updatedAt).
  const deletedTimestamps = new Map();
  for (const entry of mergedAudit) {
    if (entry.action === 'file_deleted' && entry.target) {
      const prev = deletedTimestamps.get(entry.target) ?? -1;
      if (entry.timestamp > prev) deletedTimestamps.set(entry.target, entry.timestamp);
    }
  }

  const fileMap = new Map();
  for (const file of [...(local.files ?? []), ...(remote.files ?? [])]) {
    const delAt = deletedTimestamps.get(file.name);
    if (delAt !== undefined && delAt > file.updatedAt) continue;
    const prev = fileMap.get(file.id);
    if (!prev || file.version > prev.version || (file.version === prev.version && file.updatedAt > prev.updatedAt)) {
      fileMap.set(file.id, file);
    }
  }

  return Object.freeze({
    format: WORKSPACE_FORMAT,
    collectiveId: local.collectiveId,
    name: remote.name || local.name,
    createdAt: Math.min(local.createdAt || 0, remote.createdAt || 0),
    nextSeq: Math.max(local.nextSeq || 1, remote.nextSeq || 1) + 1,
    members: Object.freeze([...memberMap.values()]),
    invites: Object.freeze([...inviteMap.values()]),
    files: Object.freeze([...fileMap.values()]),
    auditLog: mergedAudit,
  });
}
