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
