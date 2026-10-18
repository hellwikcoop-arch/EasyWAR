import { invoke } from '@tauri-apps/api/core';

export function activeProfileLabel(state) {
  const active = state?.profiles?.find(profile => profile.id === state.activeProfileId);
  return active ? `Профіль: ${active.displayName}` : 'Профілі';
}

export function getLocalProfiles(invokeCommand = invoke) {
  return invokeCommand('get_local_profiles');
}

/**
 * Реєстрація: профіль, обов'язковий пароль, посада, фото й обрані модулі створюються
 * одним кроком, а користувач одразу входить у свій профіль. Профілю без пароля
 * застосунок не створює. Відповідь — `{ state, recoveryKey }`: ключ відновлення пароля
 * показується користувачеві один раз і ніде не зберігається.
 */
export function registerLocalProfile({ displayName, password, position, avatarDataUrl, modules }, invokeCommand = invoke) {
  return invokeCommand('register_local_profile', {
    displayName,
    password,
    position: position || null,
    avatarDataUrl: avatarDataUrl || null,
    modules,
  });
}

export function setLocalProfileModules(profileId, modules, invokeCommand = invoke) {
  return invokeCommand('set_local_profile_modules', { profileId, modules });
}

export function renameLocalProfile(profileId, displayName, invokeCommand = invoke) {
  return invokeCommand('rename_local_profile', { profileId, displayName });
}

export function activateLocalProfile(profileId, invokeCommand = invoke) {
  return invokeCommand('activate_local_profile', { profileId });
}

export function deleteLocalProfile(profileId, invokeCommand = invoke) {
  return invokeCommand('delete_local_profile', { profileId });
}

export function getWorkspaceTemplates(invokeCommand = invoke) {
  return invokeCommand('get_workspace_templates');
}

export function setProfileWorkspaceTemplate(profileId, templateKey, invokeCommand = invoke) {
  return invokeCommand('set_profile_workspace_template', { profileId, templateKey });
}

export function createPositionDatabaseTemplate(templateKey, invokeCommand = invoke) {
  return invokeCommand('create_position_database_template', { templateKey });
}

export function workspaceTemplateForProfile(state, profileId) {
  if (!profileId || !Array.isArray(state?.templates)) return null;
  const assignedKey = state?.assignments?.find(
    assignment => assignment.profileId === profileId,
  )?.templateKey;
  const templateKey = assignedKey || state.defaultTemplateKey;
  return state.templates.find(template => template.key === templateKey) || null;
}

export function workspaceTemplateLabel(template) {
  if (!template) return 'Шаблон не вибрано';
  return `${template.roleLabel} — ${template.title}`;
}

export function signInLocalProfile(profileId, password, invokeCommand = invoke) {
  return invokeCommand('activate_local_profile', { profileId, password });
}

export function getProfileSession(invokeCommand = invoke) {
  return invokeCommand('get_profile_session');
}

export function lockLocalProfile(invokeCommand = invoke) {
  return invokeCommand('lock_local_profile');
}

export function updateLocalProfileDetails(profileId, position, avatarDataUrl, invokeCommand = invoke) {
  return invokeCommand('update_local_profile_details', {
    profileId,
    position,
    avatarDataUrl: avatarDataUrl || null,
  });
}

/** Встановлює або змінює пароль. Зняти пароль не можна: він обов'язковий. */
export function setLocalProfilePassword(profileId, currentPassword, newPassword, invokeCommand = invoke) {
  return invokeCommand('set_local_profile_password', {
    profileId,
    currentPassword: currentPassword || null,
    newPassword: newPassword || null,
  });
}

/**
 * Новий ключ відновлення пароля (замінює попередній). Потрібні розблокований профіль і
 * чинний пароль. Відповідь — `{ state, recoveryKey }`; ключ показується один раз.
 */
export function issueLocalProfileRecoveryKey(profileId, currentPassword, invokeCommand = invoke) {
  return invokeCommand('issue_local_profile_recovery_key', { profileId, currentPassword });
}

/**
 * Скидає забутий пароль за ключем відновлення; сесія для цього не потрібна. Після успіху
 * пароль змінено, користувач увійшов у профіль, а використаний ключ замінено новим:
 * відповідь — `{ state, recoveryKey }` з НОВИМ ключем, який теж показується один раз.
 */
export function recoverLocalProfilePassword(profileId, recoveryKey, newPassword, invokeCommand = invoke) {
  return invokeCommand('recover_local_profile_password', { profileId, recoveryKey, newPassword });
}

/**
 * Роди військ і командування, для яких профіль тримає окрему таблицю. ПВК і УДШВ —
 * дашборди командувань: вони відкриваються у власних вікнах над модулями ПС і РВ.
 */
export const PROFILE_BRANCHES = [
  { branch: 'air', short: 'ПС', title: 'Повітряні Сили', table: 'Таблиця Повітряних Сил' },
  { branch: 'pvk', short: 'ПВК', title: 'Повітряне командування (дашборд ПВК)', table: 'Таблиця ПВК' },
  { branch: 'rocket', short: 'РВ', title: 'Ракетні війська', table: 'Таблиця Ракетних військ' },
  { branch: 'dshv', short: 'УДШВ', title: 'Командування ДШВ (дашборд УДШВ)', table: 'Таблиця УДШВ' },
];

/**
 * Таблиця «НАШІ ВТРАТИ» (журнал власних втрат): окрема для кожної плитки командування.
 * Має власний слот у профілі поряд з основною таблицею плитки й відкривається на вкладці
 * «Наші втрати» дашборда свого командування (`command`) лише для читання.
 */
export const OWN_LOSSES_BRANCHES = [
  { branch: 'pvk_losses', command: 'pvk', ownLosses: true, short: 'ПВК · Наші втрати', title: 'Наші втрати (дашборд ПВК)', table: 'Таблиця «Наші втрати» ПВК' },
  { branch: 'dshv_losses', command: 'dshv', ownLosses: true, short: 'УДШВ · Наші втрати', title: 'Наші втрати (дашборд УДШВ)', table: 'Таблиця «Наші втрати» УДШВ' },
];

/** Усі слоти таблиць профілю: роди військ і «Наші втрати» командувань. */
export const PROFILE_SLOTS = [...PROFILE_BRANCHES, ...OWN_LOSSES_BRANCHES];

/** Слот «Наші втрати» плитки командування `command` (`pvk` | `dshv`). */
export const ownLossesBranch = command => `${command}_losses`;

/** Порожні базові таблиці, з яких можна почати. `branch` — модуль, що їх відкриває. */
export const BASE_TABLES = [
  { key: 'air', branch: 'air', label: 'ПС — базова таблиця' },
  { key: 'pvk', branch: 'pvk', label: 'ПС рівня ПВК (ТАБЛ 2-3)' },
  { key: 'rvia', branch: 'rocket', label: 'РВ — базова таблиця' },
];

/** Шлях таблиці профілю для роду військ або null. */
export function profileTablePath(profile, branch) {
  return profile?.tables?.[branch] || null;
}

export function chooseProfileDatabase(profileId, branch, invokeCommand = invoke) {
  return invokeCommand('choose_profile_database', { profileId, branch });
}

export function clearProfileDatabase(profileId, branch, invokeCommand = invoke) {
  return invokeCommand('clear_profile_database', { profileId, branch });
}

/** Зберігає порожню базову таблицю в новий файл і прив'язує її; null — якщо скасовано. */
export function createProfileBaseTable(profileId, table, invokeCommand = invoke) {
  return invokeCommand('create_profile_base_table', { profileId, table });
}

/**
 * Reads the profile's table for `branch` as bytes owned by `realm`, the window
 * of the module that will parse them (the branch iframe when called from the
 * launcher). WebKit (macOS) rejects a view over another window's ArrayBuffer in
 * DecompressionStream with "Invalid type should be ArrayBuffer", which broke
 * opening the profile's XLSX, so the bytes are copied into that window's buffer.
 */
export async function readProfileDatabase(profileId, branch, invokeCommand = invoke, realm = globalThis) {
  const received = new Uint8Array(await invokeCommand('read_profile_database', { profileId, branch }));
  const bytes = new realm.Uint8Array(received.byteLength);
  bytes.set(received);
  return bytes;
}

export function writeProfileDatabase(profileId, branch, bytes, invokeCommand = invoke) {
  return invokeCommand('write_profile_database', bytes, {
    headers: { 'x-easywar-profile': profileId, 'x-easywar-branch': branch },
  });
}

/** Профіль заблоковано, доки в нього не увійшли паролем у цьому запуску. */
export function isProfileLocked(profile, sessionProfileId) {
  return Boolean(profile?.hasPassword) && profile.id !== sessionProfileId;
}

export function databaseFileName(path) {
  if (!path) return '';
  return String(path).split(/[\\/]/).pop();
}

/**
 * Обгортка у форматі FileSystemFileHandle для модуля роду військ: читає й
 * записує таблицю профілю для `branch` через команди застосунку, тож
 * «Оновити» та запис доповідей працюють прямо з її файлом.
 */
export function profileDatabaseHandle(profileId, branch, name, invokeCommand = invoke, realm = globalThis) {
  return {
    kind: 'file',
    name,
    async getFile() {
      const bytes = await readProfileDatabase(profileId, branch, invokeCommand, realm);
      return new realm.File([bytes], name, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    },
    async createWritable() {
      let data = null;
      return {
        async write(chunk) {
          // The module writes from its own frame; keep the IPC body in this window's realm.
          const view = ArrayBuffer.isView(chunk)
            ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
            : new Uint8Array(await new Blob([chunk]).arrayBuffer());
          data = new Uint8Array(view.byteLength);
          data.set(view);
        },
        async close() {
          if (data) await writeProfileDatabase(profileId, branch, data, invokeCommand);
        },
      };
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
}
