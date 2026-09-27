import { invoke } from '@tauri-apps/api/core';

export function activeProfileLabel(state) {
  const active = state?.profiles?.find(profile => profile.id === state.activeProfileId);
  return active ? `Профіль: ${active.displayName}` : 'Профілі';
}

export function getLocalProfiles(invokeCommand = invoke) {
  return invokeCommand('get_local_profiles');
}

export function createLocalProfile(displayName, invokeCommand = invoke) {
  return invokeCommand('create_local_profile', { displayName });
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

export function setLocalProfilePassword(profileId, currentPassword, newPassword, invokeCommand = invoke) {
  return invokeCommand('set_local_profile_password', {
    profileId,
    currentPassword: currentPassword || null,
    newPassword: newPassword || null,
  });
}

export function chooseProfileDatabase(profileId, invokeCommand = invoke) {
  return invokeCommand('choose_profile_database', { profileId });
}

export function clearProfileDatabase(profileId, invokeCommand = invoke) {
  return invokeCommand('clear_profile_database', { profileId });
}

export async function readProfileDatabase(profileId, invokeCommand = invoke) {
  return new Uint8Array(await invokeCommand('read_profile_database', { profileId }));
}

export function writeProfileDatabase(profileId, bytes, invokeCommand = invoke) {
  return invokeCommand('write_profile_database', bytes, {
    headers: { 'x-easywar-profile': profileId },
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
 * Обгортка у форматі FileSystemFileHandle для дашборда: читає й записує
 * прив'язану таблицю через команди застосунку, тож «Оновити» та запис
 * доповідей працюють прямо з файлом профілю.
 */
export function profileDatabaseHandle(profileId, name, invokeCommand = invoke) {
  return {
    kind: 'file',
    name,
    async getFile() {
      const bytes = await readProfileDatabase(profileId, invokeCommand);
      return new File([bytes], name, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    },
    async createWritable() {
      let data = null;
      return {
        async write(chunk) {
          data = chunk instanceof Uint8Array ? chunk : new Uint8Array(await new Blob([chunk]).arrayBuffer());
        },
        async close() {
          if (data) await writeProfileDatabase(profileId, data, invokeCommand);
        },
      };
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
}
