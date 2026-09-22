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
      <p class="ew-signal-note">Вкажіть дозволені джерела. Ця форма не підключає акаунт і не читає повідомлення.</p>
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
  let currentConfig = null;
  let demoItems = createSyntheticInbox();
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
    dialog.close();
    openButton.focus();
  }

  openButton.addEventListener('click', async () => {
    currentConfig = null;
    demoItems = createSyntheticInbox();
    demo.open = false;
    demoStatus.textContent = '';
    renderDemo();
    runtime.textContent = describeSignalRuntime(null).message;
    saveButton.disabled = true;
    status.textContent = 'Завантаження локальних налаштувань…';
    dialog.showModal();
    try {
      const config = await invoke('get_signal_settings');
      currentConfig = config;
      runtime.textContent = describeSignalRuntime(config).message;
      senders.value = (config.allowlist?.allowed_senders || []).join('\n');
      groups.value = (config.allowlist?.allowed_groups || []).join('\n');
      status.textContent = config.intake_enabled
        ? 'Збережену політику знайдено. Збереження цієї форми вимкне приймання повідомлень.'
        : 'Налаштування завантажено. Приймання повідомлень вимкнено.';
      saveButton.disabled = false;
    } catch (error) {
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
