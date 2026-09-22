import { invoke } from '@tauri-apps/api/core';
import { createSyntheticInbox, transitionSyntheticItem, SYNTHETIC_REVIEWER } from './signal-inbox-preview.js';
import { describeSignalRuntime } from './signal-runtime.js';
import './signal-settings.css';

function uniqueLines(value) {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
}

function initializeSignalSettings() {
  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;

  const toolbar = document.querySelector('.appbar-right');
  if (!toolbar) return;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn quiet';
  openButton.textContent = 'Signal: не підключено';
  openButton.setAttribute('aria-label', 'Signal не підключено. Відкрити локальні налаштування');
  toolbar.prepend(openButton);

  const dialog = document.createElement('dialog');
  dialog.className = 'ew-signal-dialog';
  dialog.setAttribute('aria-labelledby', 'ew-signal-title');
  dialog.innerHTML = `
    <form id="ew-signal-form">
      <div class="ew-signal-head">
        <h2 id="ew-signal-title">Локальні налаштування Signal</h2>
        <button type="button" class="btn quiet" id="ew-signal-close" aria-label="Закрити налаштування">Закрити</button>
      </div>
      <p id="ew-signal-runtime" class="ew-signal-runtime" role="status" aria-live="polite"></p>
      <p class="ew-signal-note">Вкажіть дозволені джерела. Перевірка локального демона показує акаунти й групи, але не читає повідомлень і не вмикає приймання.</p>
      <section class="ew-signal-discovery" aria-label="Пошук локальних акаунтів і груп">
        <button type="button" class="btn quiet" id="ew-signal-discover">Перевірити локальний signal-cli</button>
        <p class="ew-signal-note">Потрібен уже запущений signal-cli у багатокористувацькому HTTP-режимі з ручним прийманням на збереженій локальній адресі. Це не прив’язує новий пристрій.</p>
        <label class="ew-signal-field" for="ew-signal-account">
          <span>Локальний акаунт</span>
          <select id="ew-signal-account" disabled><option value="">Спершу перевірте демон</option></select>
        </label>
        <button type="button" class="btn quiet" id="ew-signal-groups-discover" disabled>Показати групи акаунта</button>
        <ul id="ew-signal-found-groups" class="ew-signal-found-groups"></ul>
        <p id="ew-signal-discovery-status" class="ew-signal-status" role="status" aria-live="polite"></p>
      </section>
      <label class="ew-signal-field" for="ew-signal-senders">
        <span>Дозволені відправники</span>
        <small>Один ідентифікатор на рядок. Порожній список нічого не допускає.</small>
        <textarea id="ew-signal-senders" rows="5" spellcheck="false" autocomplete="off"></textarea>
      </label>
      <label class="ew-signal-field" for="ew-signal-groups">
        <span>Дозволені групи</span>
        <small>Один ідентифікатор на рядок. Для групи потрібен також дозволений відправник.</small>
        <textarea id="ew-signal-groups" rows="4" spellcheck="false" autocomplete="off"></textarea>
      </label>
      <p class="ew-signal-note">Приймання повідомлень залишатиметься вимкненим. Схвалення записів виконується лише після перевірки.</p>
      <details id="ew-signal-demo" class="ew-signal-demo">
        <summary>Черга Signal — демонстрація</summary>
        <p>Лише вигадані записи. Вони не надходять із Signal, не зберігаються й скидаються після закриття вікна. Не вводьте реальні дані.</p>
        <ul id="ew-signal-demo-list" class="ew-signal-demo-list"></ul>
        <p id="ew-signal-demo-status" class="ew-signal-status" role="status" aria-live="polite"></p>
      </details>
      <p id="ew-signal-status" class="ew-signal-status" role="status" aria-live="polite"></p>
      <div class="ew-signal-actions">
        <button type="button" class="btn" id="ew-signal-cancel">Скасувати</button>
        <button type="submit" class="btn primary" id="ew-signal-save">Зберегти локально</button>
      </div>
    </form>`;
  document.body.append(dialog);

  const form = dialog.querySelector('#ew-signal-form');
  const senders = dialog.querySelector('#ew-signal-senders');
  const groups = dialog.querySelector('#ew-signal-groups');
  const status = dialog.querySelector('#ew-signal-status');
  const runtime = dialog.querySelector('#ew-signal-runtime');
  const saveButton = dialog.querySelector('#ew-signal-save');
  const demo = dialog.querySelector('#ew-signal-demo');
  const demoList = dialog.querySelector('#ew-signal-demo-list');
  const demoStatus = dialog.querySelector('#ew-signal-demo-status');
  const discoverButton = dialog.querySelector('#ew-signal-discover');
  const accountSelect = dialog.querySelector('#ew-signal-account');
  const groupsButton = dialog.querySelector('#ew-signal-groups-discover');
  const foundGroups = dialog.querySelector('#ew-signal-found-groups');
  const discoveryStatus = dialog.querySelector('#ew-signal-discovery-status');
  let currentConfig = null;
  let demoItems = createSyntheticInbox();
  let discoveryEpoch = 0;
  let groupsEpoch = 0;
  const statusLabels = {
    NEW: 'Нове', PARSED: 'Розібрано', NEEDS_REVIEW: 'Потребує перевірки',
    APPROVED: 'Схвалено в демо', REJECTED: 'Відхилено в демо',
  };

  function applyDemoAction(item, action) {
    try {
      const changed = transitionSyntheticItem(item, action, SYNTHETIC_REVIEWER);
      demoItems = demoItems.map(current => current.id === item.id ? changed : current);
      renderDemo();
      demoStatus.textContent = `Тестовий стан змінено: ${statusLabels[changed.status]}. Дані не збережено.`;
    } catch (error) {
      demoStatus.textContent = String(error);
    }
  }

  function renderDemo() {
    demoList.replaceChildren();
    for (const item of demoItems) {
      const row = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = item.title;
      const state = document.createElement('span');
      state.textContent = statusLabels[item.status];
      row.append(heading, state);
      const actions = document.createElement('div');
      actions.className = 'ew-signal-demo-actions';
      const options = item.status === 'NEW'
        ? [['Позначити розібраним', 'MARK_PARSED'], ['На перевірку', 'REQUEST_REVIEW']]
        : item.status === 'PARSED'
          ? [['На перевірку', 'REQUEST_REVIEW']]
          : item.status === 'NEEDS_REVIEW'
            ? [['Схвалити в демо', 'APPROVE'], ['Відхилити в демо', 'REJECT']]
            : [];
      for (const [label, action] of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn quiet';
        button.textContent = label;
        button.addEventListener('click', () => applyDemoAction(item, action));
        actions.append(button);
      }
      row.append(actions);
      demoList.append(row);
    }
  }

  function close() {
    discoveryEpoch += 1;
    groupsEpoch += 1;
    dialog.close();
    openButton.focus();
  }
  dialog.addEventListener('close', () => {
    discoveryEpoch += 1;
    groupsEpoch += 1;
  });

  function resetDiscovery() {
    groupsEpoch += 1;
    accountSelect.replaceChildren(new Option('Спершу перевірте демон', ''));
    accountSelect.disabled = true;
    groupsButton.disabled = true;
    foundGroups.replaceChildren();
    discoveryStatus.textContent = '';
  }

  discoverButton.addEventListener('click', async () => {
    if (!currentConfig) return;
    const epoch = ++discoveryEpoch;
    discoverButton.disabled = true;
    resetDiscovery();
    discoveryStatus.textContent = 'Перевіряємо локальний signal-cli…';
    try {
      const accounts = await invoke('discover_signal_accounts');
      if (epoch !== discoveryEpoch) return;
      accountSelect.replaceChildren(new Option('Виберіть акаунт', ''));
      for (const account of accounts) {
        accountSelect.add(new Option(account.number || account.aci || account.id, account.id));
      }
      accountSelect.disabled = accounts.length === 0;
      discoveryStatus.textContent = accounts.length
        ? `Знайдено локальних акаунтів: ${accounts.length}. EasyWAR не запитував повідомлення.`
        : 'Демон доступний, але локальних акаунтів не знайдено.';
    } catch (error) {
      if (epoch !== discoveryEpoch) return;
      discoveryStatus.textContent = `Не вдалося перевірити локальний демон: ${String(error)}`;
    } finally {
      if (epoch === discoveryEpoch) discoverButton.disabled = false;
    }
  });

  accountSelect.addEventListener('change', () => {
    groupsEpoch += 1;
    groupsButton.disabled = !accountSelect.value;
    foundGroups.replaceChildren();
  });

  groupsButton.addEventListener('click', async () => {
    if (!accountSelect.value) return;
    const account = accountSelect.value;
    const epoch = ++groupsEpoch;
    groupsButton.disabled = true;
    foundGroups.replaceChildren();
    discoveryStatus.textContent = 'Завантажуємо перелік груп…';
    try {
      const groups = await invoke('discover_signal_groups', { account });
      if (epoch !== groupsEpoch || accountSelect.value !== account) return;
      for (const group of groups) {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = group.name || 'Група без назви';
        const id = document.createElement('code');
        id.textContent = group.id;
        const membership = document.createElement('span');
        membership.textContent = group.is_blocked ? 'Заблокована' : group.is_member ? 'Учасник' : 'Не учасник';
        item.append(name, id, membership);
        foundGroups.append(item);
      }
      discoveryStatus.textContent = `Знайдено груп: ${groups.length}. Дозволений список не змінено.`;
    } catch (error) {
      if (epoch !== groupsEpoch) return;
      discoveryStatus.textContent = `Не вдалося отримати перелік груп: ${String(error)}`;
    } finally {
      if (epoch === groupsEpoch) groupsButton.disabled = !accountSelect.value;
    }
  });

  openButton.addEventListener('click', async () => {
    discoveryEpoch += 1;
    const epoch = discoveryEpoch;
    currentConfig = null;
    discoverButton.disabled = true;
    demoItems = createSyntheticInbox();
    demo.open = false;
    demoStatus.textContent = '';
    resetDiscovery();
    renderDemo();
    runtime.textContent = describeSignalRuntime(null).message;
    saveButton.disabled = true;
    status.textContent = 'Завантаження локальних налаштувань…';
    dialog.showModal();
    try {
      const config = await invoke('get_signal_settings');
      if (epoch !== discoveryEpoch) return;
      currentConfig = config;
      runtime.textContent = describeSignalRuntime(config).message;
      senders.value = (config.allowlist?.allowed_senders || []).join('\n');
      groups.value = (config.allowlist?.allowed_groups || []).join('\n');
      status.textContent = config.intake_enabled
        ? 'Збережену політику знайдено. Збереження цієї форми вимкне приймання повідомлень.'
        : 'Налаштування завантажено. Приймання повідомлень вимкнено.';
      saveButton.disabled = false;
      discoverButton.disabled = false;
    } catch (error) {
      if (epoch !== discoveryEpoch) return;
      status.textContent = `Не вдалося відкрити налаштування: ${String(error)}`;
    }
  });

  dialog.querySelector('#ew-signal-close').addEventListener('click', close);
  dialog.querySelector('#ew-signal-cancel').addEventListener('click', close);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!currentConfig) return;
    saveButton.disabled = true;
    status.textContent = 'Збереження…';
    const config = {
      ...currentConfig,
      receive_mode: 'manual',
      intake_enabled: false,
      allowlist: {
        allowed_senders: uniqueLines(senders.value),
        allowed_groups: uniqueLines(groups.value),
      },
      auto_approve: false,
    };
    try {
      await invoke('save_signal_settings', {
        config,
        updatedAt: new Date().toISOString(),
      });
      currentConfig = config;
      runtime.textContent = describeSignalRuntime(config).message;
      status.textContent = 'Збережено в локальній базі. Приймання повідомлень вимкнено.';
    } catch (error) {
      status.textContent = `Не вдалося зберегти: ${String(error)}`;
    } finally {
      saveButton.disabled = false;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSignalSettings, { once: true });
} else {
  initializeSignalSettings();
}
