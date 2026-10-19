import './local-profiles.css';
import {
  activateLocalProfile,
  activeProfileLabel,
  BASE_TABLES,
  chooseProfileDatabase,
  clearProfileDatabase,
  createPositionDatabaseTemplate,
  createProfileBaseTable,
  databaseFileName,
  deleteLocalProfile,
  getLocalProfiles,
  getProfileSession,
  getWorkspaceTemplates,
  isProfileLocked,
  lockLocalProfile,
  ownLossesBranch,
  PROFILE_SLOTS,
  profileDatabaseHandle,
  profileTablePath,
  readProfileDatabase,
  renameLocalProfile,
  setLocalProfileModules,
  setLocalProfilePassword,
  setProfileWorkspaceTemplate,
  signInLocalProfile,
  updateLocalProfileDetails,
  workspaceTemplateForProfile,
  workspaceTemplateLabel,
} from './local-profiles-core.js';
import { createProfileGate } from './profile-gate.js';
import { startWorkLoader } from './work-loader.js';
import { requestSplashSkip } from './startup-splash-core.js';
import { GATE_MODULES, modulesError, moduleVisible } from './profile-gate-core.js';
import { createAssistantUI } from './assistant/assistant-ui.js';
import { getDatabaseStatus } from './backup-core.js';
import { appUpdateState } from './app-update-state-core.js';
import { airWindow, moduleWindow, ownLossesApi, trackAirWork, trackModuleWork, whenAirDashboard, whenModuleDashboard, whenOwnLosses } from './air-bridge.js';

const AVATAR_SIZE = 256;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter(child => child != null && child !== false));
  return node;
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || '?';
}

function avatar(profile, size = 'md') {
  const box = el('span', { class: `ew-avatar ew-avatar-${size}`, 'aria-hidden': 'true' });
  if (profile?.avatarDataUrl) box.append(el('img', { src: profile.avatarDataUrl, alt: '', draggable: 'false' }));
  else box.textContent = initials(profile?.displayName);
  return box;
}

/** Стискає вибране фото до квадрата 256×256 JPEG, щоб воно поміщалося в локальну базу. */
function readAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('Оберіть файл зображення'));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      canvas.getContext('2d').drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        AVATAR_SIZE,
        AVATAR_SIZE,
      );
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не вдалося прочитати зображення'));
    };
    image.src = url;
  });
}

/** Невелике модальне вікно для пароля (window.prompt показує пароль відкритим текстом). */
function askPasswords({ title, fields, submitLabel }) {
  return new Promise(resolve => {
    const dialog = el('dialog', { class: 'ew-password-dialog' });
    const inputs = fields.map(field => el('input', {
      type: 'password',
      autocomplete: field.autocomplete || 'current-password',
      maxlength: '128',
      required: field.required !== false,
      'aria-label': field.label,
    }));
    const error = el('p', { class: 'ew-password-error', role: 'alert' });
    const form = el('form', { method: 'dialog' },
      el('h3', { text: title }),
      fields.map((field, index) => el('label', {}, el('span', { text: field.label }), inputs[index])),
      error,
      el('div', { class: 'ew-profile-actions' },
        el('button', { type: 'button', class: 'btn quiet', text: 'Скасувати', onclick: () => finish(null) }),
        el('button', { type: 'submit', class: 'btn primary', text: submitLabel })));
    function finish(value) {
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const values = inputs.map(input => input.value);
      const confirmIndex = fields.findIndex(field => field.confirms != null);
      if (confirmIndex >= 0 && values[confirmIndex] !== values[fields[confirmIndex].confirms]) {
        error.textContent = 'Паролі не збігаються';
        return;
      }
      finish(values);
    });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(null);
    });
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    inputs[0].focus();
  });
}

function initializeLocalProfiles() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;
  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = el('button', { type: 'button', class: 'btn quiet ew-profile-open' });
  toolbar.prepend(openButton);

  const dialog = el('dialog', { class: 'ew-profile-dialog', 'aria-labelledby': 'ew-profile-title' });
  dialog.innerHTML = `
    <div class="ew-profile-head">
      <h2 id="ew-profile-title">Локальні профілі</h2>
      <button type="button" class="btn quiet" id="ew-profile-close" aria-label="Закрити">Закрити</button>
    </div>
    <p>Профілі зберігаються лише в локальній базі цього пристрою. Пароль обов’язковий.</p>
    <p class="ew-profile-note">Пароль закриває вхід у профіль на цьому пристрої. Файли таблиць на диску він не шифрує.</p>
    <p class="ew-profile-note">До профілю можна прив'язати окремо таблицю Повітряних Сил і таблицю Ракетних військ. Кожна відкривається у своєму модулі після входу в профіль і записується прямо у свій файл.</p>
    <p class="ew-profile-note">Рольовий шаблон змінює лише початковий розділ робочого простору. Він не надає і не обмежує доступ.</p>
    <p id="ew-profile-status" class="ew-profile-status" role="status" aria-live="polite"></p>
    <div id="ew-profile-list" class="ew-profile-list"></div>
    <p class="ew-profile-note">Щоб додати користувача або увійти під іншим, вийдіть з профілю: на екрані входу є кнопка «Додати користувача». Кожен користувач має власний пароль, модулі й таблиці.</p>`;
  document.body.append(dialog);

  const list = dialog.querySelector('#ew-profile-list');
  const status = dialog.querySelector('#ew-profile-status');
  const avatarPicker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  document.body.append(avatarPicker);

  let state = { activeProfileId: null, profiles: [] };
  let workspaceState = { defaultTemplateKey: null, templates: [], assignments: [] };
  let sessionProfileId = null;
  // Per branch: the profile whose table the module has open, and the one being opened.
  const loadedDatabaseFor = Object.fromEntries(PROFILE_SLOTS.map(({ branch }) => [branch, null]));
  const loadingDatabaseFor = Object.fromEntries(PROFILE_SLOTS.map(({ branch }) => [branch, null]));
  let pendingDashboardSection = null;
  let busy = false;

  const assistant = createAssistantUI({ getSession: getProfileSession, getApplicationState: async kind => (
    kind === 'version' ? { appVersion: (await getDatabaseStatus()).appVersion }
      : kind === 'updates' ? appUpdateState.getSnapshot()
      : { boundBranches: PROFILE_SLOTS.filter(slot => profileTablePath(activeProfile(), slot.branch)).map(slot => slot.branch) }
  ) });
  dialog.insertBefore(assistant.settings, list);

  const gate = createProfileGate({ el, avatar, readAvatar });

  const activeProfile = () => state.profiles.find(profile => profile.id === state.activeProfileId) || null;

  function setBusy(value) {
    busy = value;
    dialog.querySelectorAll('button, input, select').forEach(control => {
      control.disabled = value;
    });
    if (!value) render();
  }

  function renderHeaderButton() {
    const profile = activeProfile();
    openButton.textContent = '';
    if (profile) {
      openButton.append(
        avatar(profile, 'sm'),
        el('span', { class: 'ew-profile-open-text' },
          el('span', { class: 'ew-profile-open-name', text: profile.displayName }),
          profile.position ? el('span', { class: 'ew-profile-open-position', text: profile.position }) : null),
      );
      openButton.setAttribute('aria-label', `${activeProfileLabel(state)}${profile.position ? `, ${profile.position}` : ''}`);
    } else {
      openButton.textContent = activeProfileLabel(state);
      openButton.removeAttribute('aria-label');
    }
    openButton.title = state.activeProfileId
      ? 'Керувати локальними профілями'
      : 'Створити або вибрати локальний профіль';
  }

  // Мінівіконця командувань на стартовому екрані (index.html): ПВК над «Повітряними Силами»,
  // УДШВ над РВ. Кожне показує свою прив'язану таблицю; кнопка «Відкрити дашборд» — у лончері.
  function renderCommandTiles() {
    const profile = activeProfile();
    const visible = profile && !isProfileLocked(profile, sessionProfileId);
    for (const tile of document.querySelectorAll('.command-tile[data-command]')) {
      const path = visible ? profileTablePath(profile, tile.dataset.command) : null;
      const line = tile.querySelector('[data-role="table"]');
      line.textContent = path ? databaseFileName(path) : (profile ? 'Таблицю не прив’язано' : 'Профіль не обрано');
      line.title = path || '';
      line.classList.toggle('is-bound', Boolean(path));
      const bind = tile.querySelector('[data-act="bind"]');
      bind.hidden = false;
      bind.textContent = path ? 'Змінити таблицю…' : 'Прив’язати таблицю…';
      // «Наші втрати» плитки: окрема таблиця зі своїм слотом, відкривається на вкладці дашборда.
      const ownPath = visible ? profileTablePath(profile, ownLossesBranch(tile.dataset.command)) : null;
      const ownLine = tile.querySelector('[data-role="own-table"]');
      if (ownLine) {
        ownLine.textContent = `«Наші втрати»: ${ownPath ? databaseFileName(ownPath) : 'не прив’язано'}`;
        ownLine.title = ownPath || '';
        ownLine.classList.toggle('is-bound', Boolean(ownPath));
      }
      const bindOwn = tile.querySelector('[data-act="bind-own"]');
      if (bindOwn) {
        bindOwn.hidden = false;
        // Стан видно в рядку над кнопками, тож підпис короткий і лишається однаковим.
        bindOwn.title = `${ownPath ? 'Змінити' : 'Прив’язати'} окрему таблицю «НАШІ ВТРАТИ»: вона відкривається на вкладці «Наші втрати» дашборда`;
      }
      // «Файл для телефона» може взяти цю таблицю з собою лише коли вона прив'язана й профіль відкрито.
      const embed = tile.querySelector('[data-role="embed"]');
      if (embed) {
        embed.disabled = !path;
        if (!path) embed.checked = false;
      }
    }
  }

  for (const button of document.querySelectorAll('.command-tile [data-act="bind"], .command-tile [data-act="bind-own"]')) {
    button.addEventListener('click', () => {
      const profile = activeProfile();
      if (!profile || isProfileLocked(profile, sessionProfileId)) {
        // Таблиця прив'язується до профілю: спершу потрібен активний профіль.
        openButton.click();
        status.textContent = 'Створіть або оберіть профіль, щоб прив’язати до нього таблицю.';
        return;
      }
      const command = button.closest('.command-tile').dataset.command;
      bindDatabase(profile, button.dataset.act === 'bind-own' ? ownLossesBranch(command) : command);
    });
  }

  // Стартовий екран показує лише модулі, які користувач обрав при реєстрації.
  function applyModules() {
    const profile = activeProfile();
    const signedIn = Boolean(profile) && !isProfileLocked(profile, sessionProfileId);
    for (const module of GATE_MODULES) {
      const visible = !signedIn || moduleVisible(module.id, profile);
      for (const selector of [module.card, module.tile]) {
        if (selector) document.querySelector(selector)?.classList.toggle('ew-module-off', !visible);
      }
    }
    // Коли частини карток немає, решта стає по центру, а не липне до лівого краю.
    const trimmed = Boolean(document.querySelector('.branch-cards .ew-module-off'));
    document.querySelector('.branch-cards')?.classList.toggle('ew-modules-trimmed', trimmed);
  }

  function render() {
    assistant.updateSession(state.activeProfileId === sessionProfileId ? sessionProfileId : null);
    renderHeaderButton();
    renderCommandTiles();
    applyModules();
    list.textContent = '';
    if (!state.profiles.length) {
      list.append(el('p', { class: 'ew-profile-empty', text: 'Локальних профілів ще немає.' }));
      return;
    }
    for (const profile of state.profiles) list.append(renderRow(profile));
  }

  function renderRow(profile) {
    const isActive = profile.id === state.activeProfileId;
    const locked = isProfileLocked(profile, sessionProfileId);
    const row = el('div', { class: `ew-profile-row${isActive ? ' is-active' : ''}${locked ? ' is-locked' : ''}` });
    const badge = el('span', {
      class: 'ew-profile-badge',
      text: [isActive ? 'Активний' : 'Неактивний', profile.hasPassword ? (locked ? '🔒 пароль' : '🔓 вхід виконано') : null].filter(Boolean).join(' · '),
    });

    if (locked) {
      row.append(
        el('div', { class: 'ew-profile-ident' }, avatar(profile, 'lg'),
          el('div', {}, el('strong', { text: profile.displayName }), profile.position ? el('div', { class: 'ew-profile-position-text', text: profile.position }) : null)),
        badge,
        el('p', { class: 'ew-profile-note', text: 'Щоб увійти в цей профіль, вийдіть із поточного.' }),
      );
      return row;
    }

    const nameField = el('input', { value: profile.displayName, maxLength: 80, 'aria-label': `Назва профілю ${profile.displayName}` });
    const positionField = el('input', {
      value: profile.position || '',
      maxLength: 120,
      placeholder: 'Посада, напр. «Начальник групи аналізу»',
      'aria-label': `Посада профілю ${profile.displayName}`,
    });
    const photoButton = el('button', {
      type: 'button',
      class: 'ew-avatar-button',
      title: 'Змінити фото профілю',
      'aria-label': `Змінити фото профілю ${profile.displayName}`,
      onclick: () => pickAvatar(profile),
    }, avatar(profile, 'lg'), el('span', { class: 'ew-avatar-edit', text: 'Фото' }));

    const saveButton = el('button', {
      type: 'button',
      class: 'btn',
      text: 'Зберегти',
      onclick: () => saveNameAndPosition(profile, nameField.value, positionField.value),
    });

    const templateSection = renderTemplateSelect(profile);

    const database = el('div', { class: 'ew-profile-db' },
      el('span', { class: 'ew-profile-field-caption', text: 'Таблиці профілю' }),
      PROFILE_SLOTS.map(({ branch, title }) => {
        const path = profileTablePath(profile, branch);
        const dbName = databaseFileName(path);
        return el('div', { class: 'ew-profile-db-line', 'data-branch': branch },
          el('span', { class: 'ew-profile-db-branch', text: title }),
          el('span', { class: `ew-profile-db-name${dbName ? '' : ' is-empty'}`, title: path || '', text: dbName || 'не прив’язано' }),
          el('button', { type: 'button', class: 'btn', text: dbName ? 'Змінити…' : 'Прив’язати таблицю…', onclick: () => bindDatabase(profile, branch) }),
          dbName ? el('button', { type: 'button', class: 'btn quiet', text: 'Відкрити зараз', disabled: !isActive, title: isActive ? '' : 'Спершу оберіть цей профіль', onclick: () => loadProfileDatabase(profile, branch, true) }) : null,
          dbName ? el('button', { type: 'button', class: 'btn quiet', text: 'Відв’язати', onclick: () => unbindDatabase(profile, branch) }) : null);
      }),
      renderBaseTableCreate(profile));

    const passwordButtons = profile.hasPassword
      ? [
        el('button', { type: 'button', class: 'btn quiet', text: 'Змінити пароль', onclick: () => changePassword(profile) }),
      ]
      : [el('button', { type: 'button', class: 'btn quiet', text: 'Встановити пароль…', onclick: () => setPassword(profile) })];

    const actions = el('div', { class: 'ew-profile-actions' },
      saveButton,
      passwordButtons,
      profile.avatarDataUrl ? el('button', { type: 'button', class: 'btn quiet', text: 'Прибрати фото', onclick: () => saveDetails(profile, profile.position, null, 'Фото прибрано.') }) : null,
      templateSection.createDatabaseButton,
      el('button', {
        type: 'button',
        class: 'btn quiet ew-profile-delete',
        text: 'Видалити',
        onclick: () => {
          if (!window.confirm(`Видалити локальний профіль «${profile.displayName}»? Файли прив’язаних таблиць залишаться на диску.`)) return;
          mutate(() => deleteLocalProfile(profile.id), 'Профіль видалено.');
        },
      }));

    row.append(
      el('div', { class: 'ew-profile-ident' }, photoButton,
        el('div', { class: 'ew-profile-fields' },
          el('label', {}, el('span', { class: 'ew-profile-field-caption', text: 'Ім’я' }), nameField),
          el('label', {}, el('span', { class: 'ew-profile-field-caption', text: 'Посада' }), positionField))),
      badge,
      database,
      renderModules(profile),
      templateSection.label,
      actions,
    );
    return row;
  }

  /** Модулі профілю: які картки показує стартовий екран. Потрібен щонайменше один. */
  function renderModules(profile) {
    const boxes = GATE_MODULES.map(module => el('input', {
      type: 'checkbox',
      value: module.id,
      checked: moduleVisible(module.id, profile),
      'aria-label': `${module.title} — профіль ${profile.displayName}`,
    }));
    return el('div', { class: 'ew-profile-modules' },
      el('span', { class: 'ew-profile-field-caption', text: 'Модулі на стартовому екрані' }),
      el('div', { class: 'ew-profile-module-list' },
        GATE_MODULES.map((module, index) => el('label', { class: 'ew-profile-module' }, boxes[index], el('span', { text: module.title })))),
      el('button', {
        type: 'button',
        class: 'btn',
        text: 'Зберегти модулі',
        onclick: () => {
          const chosen = boxes.filter(box => box.checked).map(box => box.value);
          const problem = modulesError(chosen);
          if (problem) {
            status.textContent = problem;
            return;
          }
          run(() => setLocalProfileModules(profile.id, chosen), 'Модулі збережено.');
        },
      }));
  }

  /** Нова порожня базова таблиця: зберігається в новий файл і прив’язується до свого роду військ. */
  function renderBaseTableCreate(profile) {
    const select = el('select', { 'aria-label': `Базова таблиця для профілю ${profile.displayName}` },
      BASE_TABLES.map(table => el('option', {
        value: table.key,
        text: table.note ? `${table.label} — ${table.note}` : table.label,
      })));
    return el('div', { class: 'ew-profile-db-line ew-profile-db-create' },
      el('span', { class: 'ew-profile-db-branch', text: 'Нова порожня таблиця' }),
      select,
      el('button', { type: 'button', class: 'btn quiet', text: 'Створити…', onclick: () => createBaseTable(profile, select.value) }));
  }

  function renderTemplateSelect(profile) {
    const assignedTemplate = workspaceTemplateForProfile(workspaceState, profile.id);
    const select = el('select', {
      'aria-label': `Рольовий шаблон профілю ${profile.displayName}`,
      onchange: () => mutateWorkspace(profile.id, select.value),
    }, workspaceState.templates.map(template => el('option', { value: template.key, text: workspaceTemplateLabel(template) })));
    if (assignedTemplate) select.value = assignedTemplate.key;
    const label = el('label', { class: 'ew-profile-template' },
      el('span', { text: 'Рольовий шаблон робочого простору' }),
      select,
      el('small', { text: assignedTemplate?.description || '' }));
    const createDatabaseButton = el('button', {
      type: 'button',
      class: 'btn quiet',
      text: 'Створити порожню базу',
      disabled: !assignedTemplate,
      title: assignedTemplate
        ? `Створити окрему порожню базу для позиції «${assignedTemplate.roleLabel}»`
        : 'Спершу оберіть рольовий шаблон',
      onclick: () => { if (assignedTemplate) createPositionDatabase(assignedTemplate); },
    });
    return { label, createDatabaseButton };
  }

  async function run(action, successMessage, failurePrefix = 'Не вдалося змінити профіль') {
    if (busy) return false;
    setBusy(true);
    status.textContent = 'Збереження…';
    try {
      const result = await action();
      if (result && Array.isArray(result.profiles)) state = result;
      status.textContent = successMessage;
      return true;
    } catch (error) {
      status.textContent = `${failurePrefix}: ${String(error)}`;
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function mutate(action, successMessage) {
    const ok = await run(async () => {
      const next = await action();
      workspaceState = await getWorkspaceTemplates();
      sessionProfileId = await getProfileSession();
      return next;
    }, successMessage, 'Не вдалося змінити профілі');
    if (ok) applyActiveWorkspaceTemplate();
    return ok;
  }

  async function saveNameAndPosition(profile, displayName, position) {
    await run(async () => {
      let next = state;
      if (displayName.trim() !== profile.displayName) next = await renameLocalProfile(profile.id, displayName);
      if ((position || '').trim() !== (profile.position || '')) {
        next = await updateLocalProfileDetails(profile.id, position, profile.avatarDataUrl);
      }
      return next;
    }, 'Профіль збережено.');
  }

  function saveDetails(profile, position, avatarDataUrl, message) {
    return run(() => updateLocalProfileDetails(profile.id, position || '', avatarDataUrl), message);
  }

  function pickAvatar(profile) {
    avatarPicker.value = '';
    avatarPicker.onchange = async () => {
      const [file] = avatarPicker.files;
      if (!file) return;
      try {
        const dataUrl = await readAvatar(file);
        await saveDetails(profile, profile.position, dataUrl, 'Фото профілю збережено.');
      } catch (error) {
        status.textContent = `Не вдалося змінити фото: ${String(error.message || error)}`;
      }
    };
    avatarPicker.click();
  }

  async function setPassword(profile) {
    const values = await askPasswords({
      title: `Пароль для профілю «${profile.displayName}»`,
      submitLabel: 'Захистити',
      fields: [
        { label: 'Новий пароль (від 6 символів)', autocomplete: 'new-password' },
        { label: 'Повторіть пароль', autocomplete: 'new-password', confirms: 0 },
      ],
    });
    if (!values) return;
    await run(() => setLocalProfilePassword(profile.id, null, values[0]), 'Профіль захищено паролем.');
    sessionProfileId = await getProfileSession();
    render();
  }

  async function changePassword(profile) {
    const values = await askPasswords({
      title: `Змінити пароль профілю «${profile.displayName}»`,
      submitLabel: 'Змінити',
      fields: [
        { label: 'Поточний пароль' },
        { label: 'Новий пароль (від 6 символів)', autocomplete: 'new-password' },
        { label: 'Повторіть новий пароль', autocomplete: 'new-password', confirms: 1 },
      ],
    });
    if (!values) return;
    await run(() => setLocalProfilePassword(profile.id, values[0], values[1]), 'Пароль змінено.');
  }

  const branchInfo = branch => PROFILE_SLOTS.find(entry => entry.branch === branch);

  async function bindDatabase(profile, branch) {
    const { table } = branchInfo(branch);
    const ok = await run(async () => {
      status.textContent = `Оберіть файл .xlsx: ${table.toLowerCase()}…`;
      const next = await chooseProfileDatabase(profile.id, branch);
      if (next === null) throw new Error('вибір скасовано');
      return next;
    }, `${table} прив’язана до профілю.`, 'Таблицю не прив’язано');
    if (ok && profile.id === state.activeProfileId) {
      loadedDatabaseFor[branch] = null;
      // «Наші втрати» — вкладка всередині дашборда: прив'язка не перемикає екран, таблиця відкриється там.
      await loadProfileDatabase(activeProfile(), branch, !branchInfo(branch).ownLosses);
    }
  }

  async function unbindDatabase(profile, branch) {
    const ok = await run(
      () => clearProfileDatabase(profile.id, branch),
      `${branchInfo(branch).table} відв’язана. Файл на диску не змінено.`,
    );
    const slot = branchInfo(branch);
    if (ok && slot.ownLosses && profile.id === state.activeProfileId) {
      loadedDatabaseFor[branch] = null;
      ownLossesApi(slot.command)?.disconnect(slot.command);
    }
    return ok;
  }

  async function createBaseTable(profile, key) {
    const base = BASE_TABLES.find(entry => entry.key === key);
    if (!base || busy) return;
    const { table } = branchInfo(base.branch);
    const current = profileTablePath(profile, base.branch);
    if (current && !window.confirm(`${table} уже прив’язана: «${databaseFileName(current)}». Прив’язати натомість нову порожню таблицю? Наявний файл залишиться на диску без змін.`)) return;
    let created = null;
    const ok = await run(async () => {
      status.textContent = `Оберіть, куди зберегти нову таблицю «${base.label}»…`;
      created = await createProfileBaseTable(profile.id, key);
      if (created === null) throw new Error('створення скасовано');
      return created.state;
    }, '', 'Таблицю не створено');
    if (!ok) return;
    status.textContent = `Створено «${base.label}»: ${created.path}. ${table} прив’язана до профілю.`
      + (base.note ? ` ${base.note[0].toUpperCase()}${base.note.slice(1)}: поки що вносьте дані в Excel.` : '');
    if (profile.id === state.activeProfileId && !base.note) {
      loadedDatabaseFor[base.branch] = null;
      await loadProfileDatabase(activeProfile(), base.branch, true);
    }
  }

  async function createPositionDatabase(template) {
    if (busy) return;
    setBusy(true);
    status.textContent = `Оберіть місце для порожньої бази позиції «${template.roleLabel}»…`;
    try {
      const result = await createPositionDatabaseTemplate(template.key);
      status.textContent = result === null
        ? 'Створення порожньої бази скасовано.'
        : `Порожню базу для позиції «${result.roleLabel}» створено: ${result.path}`;
    } catch (error) {
      status.textContent = `Не вдалося створити порожню базу: ${String(error)}`;
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

  // Each table opens in its branch module. Automatically it loads when the user
  // opens that module (sign-in does not wait for it); on an explicit request the
  // launcher switches to the module. Other actions in a module (Signal review)
  // wait for this through trackModuleWork.
  function loadProfileDatabases(profile, { reload = false } = {}) {
    for (const branch of Object.keys(loadedDatabaseFor)) {
      if (reload) loadedDatabaseFor[branch] = null;
      loadProfileDatabase(profile, branch, false);
    }
  }

  function loadProfileDatabase(profile, branch, manual) {
    const slot = branchInfo(branch);
    return trackModuleWork(slot.command || branch, slot.ownLosses ? openOwnLosses(profile, slot, manual) : openProfileDatabase(profile, branch, manual));
  }

  // «Наші втрати» читаються лише для перегляду: байти йдуть на вкладку дашборда командування,
  // а «Оновити з файлу» перечитує прив'язаний файл тим самим шляхом.
  async function openOwnLosses(profile, slot, manual) {
    const { branch, command } = slot;
    const path = profileTablePath(profile, branch);
    if (isProfileLocked(profile, sessionProfileId)) return;
    if (!path) {
      // Профіль без прив'язки не повинен успадкувати таблицю попереднього профілю.
      loadedDatabaseFor[branch] = null;
      ownLossesApi(command)?.disconnect(command);
      return;
    }
    if (!manual && loadedDatabaseFor[branch] === profile.id) return;
    if (manual && dialog.open) dialog.close();
    const api = await whenOwnLosses(command, { open: manual });
    if (!api || profile.id !== state.activeProfileId) return;
    if (!manual && loadedDatabaseFor[branch] === profile.id) return;
    if (loadingDatabaseFor[branch] === profile.id) return;
    loadingDatabaseFor[branch] = profile.id;
    const name = databaseFileName(path);
    const frame = moduleWindow(command);
    const reread = () => readProfileDatabase(profile.id, branch, undefined, frame);
    try {
      await api.connect(command, await reread(), name, { reread });
      if (manual) api.showTab(command);
      loadedDatabaseFor[branch] = profile.id;
      status.textContent = `«Наші втрати»: відкрито таблицю профілю «${name}».`;
    } catch (error) {
      status.textContent = `Не вдалося відкрити «Наші втрати» «${name}»: ${String(error?.message || error)}`;
    } finally {
      loadingDatabaseFor[branch] = null;
    }
  }

  async function openProfileDatabase(profile, branch, manual) {
    const path = profileTablePath(profile, branch);
    if (!path || isProfileLocked(profile, sessionProfileId)) return;
    if (!manual && loadedDatabaseFor[branch] === profile.id) return;
    if (manual && dialog.open) dialog.close();
    const dashboard = await whenModuleDashboard(branch, { open: manual });
    if (!dashboard || profile.id !== state.activeProfileId) return;
    if (!manual && loadedDatabaseFor[branch] === profile.id) return;
    // A deferred automatic load and a click on «Відкрити зараз» can both wake
    // when the module opens; only one of them may replace the open table.
    if (loadingDatabaseFor[branch] === profile.id) return;
    loadingDatabaseFor[branch] = profile.id;
    if (dashboard.S?.dirty && !window.confirm('У відкритій таблиці є незбережені записи. Відкрити таблицю профілю замість неї?')) {
      loadingDatabaseFor[branch] = null;
      return;
    }
    const name = databaseFileName(path);
    const frame = moduleWindow(branch);
    const loaderDone = startWorkLoader({ table: branchInfo(branch)?.table, fileName: name });
    try {
      const bytes = await readProfileDatabase(profile.id, branch, undefined, frame);
      // The module reports a table it cannot read itself and keeps the open one.
      await dashboard.connect(bytes, name, profileDatabaseHandle(profile.id, branch, name, undefined, frame), true);
      if (dashboard.S && dashboard.S.bytes !== bytes) {
        // Причину (наприклад, «Це таблиця ПВК: її відкриває плитка…») показує сам модуль; повторюємо її й тут.
        let reason = '';
        try { reason = (frame?.document?.getElementById('error')?.textContent || '').trim(); } catch { /* модуль недоступний */ }
        status.textContent = reason
          ? `Модуль не відкрив таблицю профілю «${name}»: ${reason}`
          : `Модуль не відкрив таблицю профілю «${name}»; причину показано в модулі.`;
        return;
      }
      loadedDatabaseFor[branch] = profile.id;
      dashboard.toast?.(`Відкрито таблицю профілю: ${name}`, 'ok');
    } catch (error) {
      const message = `Не вдалося відкрити таблицю профілю «${name}»: ${String(error)}`;
      status.textContent = message;
      dashboard.showError?.(message);
    } finally {
      loaderDone();
      loadingDatabaseFor[branch] = null;
    }
  }

  function applyPendingDashboardSection() {
    if (!pendingDashboardSection) return;
    const button = [...(airWindow()?.document.querySelectorAll('.snav-b[data-t]') ?? [])]
      .find(candidate => candidate.dataset.t === pendingDashboardSection);
    const sidebar = button?.closest('.side');
    if (!button || sidebar?.hidden) return;
    pendingDashboardSection = null;
    button.click();
  }

  function applyActiveWorkspaceTemplate() {
    return trackAirWork(applyWorkspaceTemplateWhenReady());
  }

  async function applyWorkspaceTemplateWhenReady() {
    const profileId = state.activeProfileId;
    if (!workspaceTemplateForProfile(workspaceState, profileId)) return;
    if (!(await whenAirDashboard()) || profileId !== state.activeProfileId) return;
    const template = workspaceTemplateForProfile(workspaceState, profileId);
    if (!template) return;
    const frame = airWindow();
    pendingDashboardSection = template.dashboardSection || null;
    frame.document.querySelector(`#tab-${template.landingView}`)?.click();
    frame.requestAnimationFrame(applyPendingDashboardSection);
  }

  async function refresh(silent = false) {
    if (busy) return;
    setBusy(true);
    if (!silent) status.textContent = 'Завантаження профілів…';
    try {
      [state, workspaceState, sessionProfileId] = await Promise.all([
        getLocalProfiles(),
        getWorkspaceTemplates(),
        getProfileSession(),
      ]);
      if (!silent) status.textContent = '';
    } catch (error) {
      if (!silent) status.textContent = `Не вдалося завантажити профілі: ${String(error)}`;
    } finally {
      setBusy(false);
    }
  }

  // Після заставки завжди стоїть вхід: без нього стартовий екран недоступний. Реєстрація,
  // додавання користувачів і вхід — у profile-gate.js; тут лише те, що йде після входу.
  async function startup() {
    await gate.requireSignIn();
    await refresh(true);
    render();
    applyActiveWorkspaceTemplate();
    loadProfileDatabases(activeProfile(), { reload: true });
  }

  function close() {
    dialog.close();
    openButton.focus();
  }

  openButton.addEventListener('click', async () => {
    dialog.showModal();
    await refresh();
  });
  dialog.querySelector('#ew-profile-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  whenAirDashboard().then(dashboard => {
    if (dashboard) airWindow().document.addEventListener('av:data', applyPendingDashboardSection);
  });
  // Кнопка «Вийти» в діалозі: блокує захищений профіль і показує екран входу.
  const signOut = el('button', {
    type: 'button',
    class: 'btn quiet',
    text: 'Вийти з профілю',
    onclick: async () => {
      assistant.disable();
      await lockLocalProfile();
      sessionProfileId = null;
      close();
      // Модулі тримають таблиці попереднього користувача в пам’яті, тож вихід перезавантажує
      // вікно: екран входу відкривається на чистому стані, а заставка вдруге не грає.
      requestSplashSkip();
      window.location.reload();
    },
  });
  dialog.querySelector('.ew-profile-head').insertBefore(signOut, dialog.querySelector('#ew-profile-close'));

  startup();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLocalProfiles, { once: true });
  } else {
    initializeLocalProfiles();
  }
}
