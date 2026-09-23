import './local-profiles.css';
import {
  activateLocalProfile,
  activeProfileLabel,
  createLocalProfile,
  deleteLocalProfile,
  getLocalProfiles,
  getWorkspaceTemplates,
  renameLocalProfile,
  setProfileWorkspaceTemplate,
  workspaceTemplateForProfile,
  workspaceTemplateLabel,
} from './local-profiles-core.js';

function initializeLocalProfiles() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;
  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet ew-profile-open';
  openButton.textContent = 'Профілі';
  toolbar.prepend(openButton);

  const dialog = document.createElement('dialog');
  dialog.className = 'ew-profile-dialog';
  dialog.setAttribute('aria-labelledby', 'ew-profile-title');
  dialog.innerHTML = `
    <div class="ew-profile-head">
      <h2 id="ew-profile-title">Локальні профілі</h2>
      <button type="button" class="btn quiet" id="ew-profile-close" aria-label="Закрити">Закрити</button>
    </div>
    <p>Профілі зберігаються лише в локальній базі цього пристрою. Це не облікові записи й не система авторизації.</p>
    <p class="ew-profile-note">Вибір профілю не змінює схвалені записи, рецензентів або журнал аудиту.</p>
    <p class="ew-profile-note">Рольовий шаблон змінює лише початковий розділ робочого простору. Він не надає і не обмежує доступ.</p>
    <p id="ew-profile-status" class="ew-profile-status" role="status" aria-live="polite"></p>
    <div id="ew-profile-list" class="ew-profile-list"></div>
    <form id="ew-profile-create" class="ew-profile-create">
      <label for="ew-profile-name">Назва нового профілю</label>
      <div>
        <input id="ew-profile-name" name="displayName" maxlength="80" autocomplete="off" required>
        <button type="submit" class="btn primary">Створити</button>
      </div>
    </form>`;
  document.body.append(dialog);

  const list = dialog.querySelector('#ew-profile-list');
  const status = dialog.querySelector('#ew-profile-status');
  const createForm = dialog.querySelector('#ew-profile-create');
  const nameInput = dialog.querySelector('#ew-profile-name');
  let state = { activeProfileId: null, profiles: [] };
  let workspaceState = { defaultTemplateKey: null, templates: [], assignments: [] };
  let pendingDashboardSection = null;
  let busy = false;

  function setBusy(value) {
    busy = value;
    dialog.querySelectorAll('button, input, select').forEach(control => {
      control.disabled = value;
    });
    if (!value) render();
  }

  function render() {
    openButton.textContent = activeProfileLabel(state);
    openButton.title = state.activeProfileId
      ? 'Керувати локальними профілями'
      : 'Створити або вибрати локальний профіль';
    list.textContent = '';
    if (!state.profiles.length) {
      const empty = document.createElement('p');
      empty.className = 'ew-profile-empty';
      empty.textContent = 'Локальних профілів ще немає.';
      list.append(empty);
      return;
    }

    for (const profile of state.profiles) {
      const row = document.createElement('div');
      row.className = 'ew-profile-row';
      if (profile.id === state.activeProfileId) row.classList.add('is-active');

      const input = document.createElement('input');
      input.value = profile.displayName;
      input.maxLength = 80;
      input.setAttribute('aria-label', `Назва профілю ${profile.displayName}`);

      const badge = document.createElement('span');
      badge.className = 'ew-profile-badge';
      badge.textContent = profile.id === state.activeProfileId ? 'Активний' : 'Неактивний';

      const assignedTemplate = workspaceTemplateForProfile(workspaceState, profile.id);
      const templateLabel = document.createElement('label');
      templateLabel.className = 'ew-profile-template';
      const templateCaption = document.createElement('span');
      templateCaption.textContent = 'Рольовий шаблон робочого простору';
      const templateSelect = document.createElement('select');
      templateSelect.setAttribute('aria-label', `Рольовий шаблон профілю ${profile.displayName}`);
      for (const template of workspaceState.templates) {
        const option = document.createElement('option');
        option.value = template.key;
        option.textContent = workspaceTemplateLabel(template);
        templateSelect.append(option);
      }
      if (assignedTemplate) templateSelect.value = assignedTemplate.key;
      templateSelect.addEventListener('change', () => mutateWorkspace(
        profile.id,
        templateSelect.value,
      ));
      const templateDescription = document.createElement('small');
      templateDescription.textContent = assignedTemplate?.description || '';
      templateLabel.append(templateCaption, templateSelect, templateDescription);

      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'btn';
      selectButton.textContent = 'Обрати';
      selectButton.disabled = profile.id === state.activeProfileId;
      selectButton.addEventListener('click', () => mutate(
        () => activateLocalProfile(profile.id),
        'Активний профіль змінено.',
      ));

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.className = 'btn';
      saveButton.textContent = 'Зберегти назву';
      saveButton.addEventListener('click', () => mutate(
        () => renameLocalProfile(profile.id, input.value),
        'Назву профілю збережено.',
      ));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'btn quiet ew-profile-delete';
      deleteButton.textContent = 'Видалити';
      deleteButton.addEventListener('click', () => {
        if (!window.confirm(`Видалити локальний профіль «${profile.displayName}»?`)) return;
        mutate(() => deleteLocalProfile(profile.id), 'Профіль видалено.');
      });

      const actions = document.createElement('div');
      actions.className = 'ew-profile-actions';
      actions.append(selectButton, saveButton, deleteButton);
      row.append(input, badge, templateLabel, actions);
      list.append(row);
    }
  }

  async function mutate(action, successMessage) {
    if (busy) return;
    setBusy(true);
    status.textContent = 'Збереження…';
    try {
      state = await action();
      workspaceState = await getWorkspaceTemplates();
      status.textContent = successMessage;
      applyActiveWorkspaceTemplate();
    } catch (error) {
      status.textContent = `Не вдалося змінити профілі: ${String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  async function mutateWorkspace(profileId, templateKey) {
    if (busy) return;
    setBusy(true);
    status.textContent = 'Збереження рольового шаблону…';
    try {
      workspaceState = await setProfileWorkspaceTemplate(profileId, templateKey);
      status.textContent = 'Рольовий шаблон збережено.';
      if (profileId === state.activeProfileId) applyActiveWorkspaceTemplate();
    } catch (error) {
      status.textContent = `Не вдалося змінити рольовий шаблон: ${String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  function applyPendingDashboardSection() {
    if (!pendingDashboardSection) return;
    const button = [...document.querySelectorAll('.snav-b[data-t]')]
      .find(candidate => candidate.dataset.t === pendingDashboardSection);
    const sidebar = button?.closest('.side');
    if (!button || sidebar?.hidden) return;
    pendingDashboardSection = null;
    button.click();
  }

  function applyActiveWorkspaceTemplate() {
    const template = workspaceTemplateForProfile(workspaceState, state.activeProfileId);
    if (!template) return;
    pendingDashboardSection = template.dashboardSection || null;
    document.querySelector(`#tab-${template.landingView}`)?.click();
    window.requestAnimationFrame(applyPendingDashboardSection);
  }

  async function refresh(silent = false, applyTemplate = false) {
    if (busy) return;
    setBusy(true);
    if (!silent) status.textContent = 'Завантаження профілів…';
    try {
      [state, workspaceState] = await Promise.all([
        getLocalProfiles(),
        getWorkspaceTemplates(),
      ]);
      if (!silent) status.textContent = '';
      if (applyTemplate) applyActiveWorkspaceTemplate();
    } catch (error) {
      if (!silent) status.textContent = `Не вдалося завантажити профілі: ${String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  function close() {
    dialog.close();
    openButton.focus();
  }

  openButton.addEventListener('click', async () => {
    dialog.showModal();
    await refresh();
    nameInput.focus();
  });
  dialog.querySelector('#ew-profile-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  document.addEventListener('av:data', applyPendingDashboardSection);
  createForm.addEventListener('submit', event => {
    event.preventDefault();
    const displayName = nameInput.value;
    mutate(() => createLocalProfile(displayName), 'Профіль створено.').then(() => {
      if (!status.textContent.startsWith('Не вдалося')) nameInput.value = '';
    });
  });

  refresh(true, true);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLocalProfiles, { once: true });
  } else {
    initializeLocalProfiles();
  }
}
