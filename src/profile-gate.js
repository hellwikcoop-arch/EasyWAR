// Екран реєстрації й входу після заставки. Перед стартовим екраном завжди стоїть вхід у
// профіль; поки в нього не ввійшли, решта сторінки недоступна (inert). Якщо профілів ще
// немає, замість входу — майстер реєстрації: профіль, пароль, модулі, таблиці.
// Усе локально: дані йдуть лише в команди ядра застосунку. Логіка — у profile-gate-core.js.
import './profile-gate.css';
import {
  chooseProfileDatabase,
  databaseFileName,
  getLocalProfiles,
  lockLocalProfile,
  recoverProfileWithCode,
  registerLocalProfile,
  setLocalProfilePassword,
  signInLocalProfile,
} from './local-profiles-core.js';
import {
  GATE_MODULES,
  SOON_MODULES,
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  POSITION_MAX,
  gateScreen,
  loginCardNote,
  modulesError,
  modulesForRows,
  passwordError,
  recoveryFailure,
  registerLoginFailure,
  rowChosen,
  slotsForModules,
  validateProfileStep,
  validateRecoveryStep,
} from './profile-gate-core.js';

const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT']);

/**
 * `el`, `avatar` і `readAvatar` — ті самі помічники, що в діалозі профілів
 * (local-profiles.js), щоб фото й підписи виглядали однаково.
 */
export function createProfileGate({ el, avatar, readAvatar }) {
  const root = el('div', {
    class: 'ew-gate',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'ew-gate-title',
    hidden: true,
  });
  document.body.append(root);

  let inerted = [];

  function lockPage() {
    document.documentElement.classList.add('ew-locked');
    inerted = [...document.body.children].filter(node => (
      node !== root && node.id !== 'ew-splash' && !SKIPPED_TAGS.has(node.tagName)
    ));
    for (const node of inerted) node.inert = true;
    root.hidden = false;
  }

  function unlockPage() {
    for (const node of inerted) node.inert = false;
    inerted = [];
    root.hidden = true;
    root.textContent = '';
    document.documentElement.classList.remove('ew-locked');
  }

  const splashActive = () => Boolean(document.getElementById('ew-splash'));

  function focusFirst() {
    if (splashActive()) return;
    root.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
  }
  window.addEventListener('ew:splash-end', focusFirst);

  function show(...nodes) {
    root.textContent = '';
    root.append(el('div', { class: 'ew-gate-inner' },
      el('header', { class: 'ew-gate-brand' },
        el('span', { class: 'ew-gate-logo', text: 'easyWAR' }),
        el('span', { class: 'ew-gate-tag', text: 'Аналітика, Контроль, Ефективність' })),
      ...nodes));
    root.scrollTop = 0;
    focusFirst();
  }

  const field = (label, input, errorKey, hint) => el('label', { class: 'ew-gate-field' },
    el('span', { class: 'ew-gate-label', text: label }),
    input,
    hint ? el('small', { class: 'ew-gate-hint', text: hint }) : null,
    el('span', { class: 'ew-gate-error', 'data-error': errorKey, role: 'alert' }));

  const textInput = (props) => el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...props });
  const passwordInput = (props) => el('input', {
    type: 'password',
    maxlength: String(PASSWORD_MAX),
    autocomplete: 'new-password',
    ...props,
  });

  function setErrors(form, errors) {
    for (const node of form.querySelectorAll('[data-error]')) {
      node.textContent = errors[node.dataset.error] || '';
    }
    const first = form.querySelector('[data-error]:not(:empty)');
    first?.closest('.ew-gate-field')?.querySelector('input')?.focus();
  }

  function showPasswordToggle(inputs) {
    return el('label', { class: 'ew-gate-check' },
      el('input', {
        type: 'checkbox',
        onchange: event => { for (const input of inputs) input.type = event.target.checked ? 'text' : 'password'; },
      }),
      el('span', { text: 'Показати пароль' }));
  }

  // ---------- вхід ----------

  function loginFlow(state) {
    return new Promise(resolve => {
      let selected = state.profiles.length === 1 ? state.profiles[0] : null;
      let failures = 0;
      let blockedUntil = 0;
      let busy = false;
      let recovering = false;   // «Забули пароль?»: форма коду відновлення замість пароля

      function render() {
        const cards = state.profiles.map(profile => el('button', {
          type: 'button',
          class: `ew-gate-user${selected?.id === profile.id ? ' is-selected' : ''}`,
          'aria-pressed': selected?.id === profile.id ? 'true' : 'false',
          onclick: () => { if (busy) return; selected = profile; recovering = false; render(); },
        },
        avatar(profile, 'lg'),
        el('strong', { text: profile.displayName }),
        el('span', { class: 'ew-gate-user-note', text: profile.position || ' ' }),
        el('span', { class: `ew-gate-user-lock${profile.hasPassword ? '' : ' is-open'}`, text: loginCardNote(profile) })));

        const addButton = el('button', {
          type: 'button',
          class: 'ew-gate-link',
          text: '+ Додати користувача',
          onclick: () => resolve('add'),
        });

        show(
          el('h1', { id: 'ew-gate-title', text: 'Вхід' }),
          el('p', { class: 'ew-gate-lead', text: !selected ? 'Оберіть користувача.' : recovering ? 'Задайте новий пароль кодом відновлення.' : 'Введіть пароль, щоб відкрити easyWAR.' }),
          el('div', { class: 'ew-gate-users' }, cards),
          selected ? (recovering && selected.hasPassword ? recoveryForm() : loginForm()) : null,
          el('div', { class: 'ew-gate-foot' }, addButton),
        );
      }

      function loginForm() {
        const needsPassword = !selected.hasPassword;
        const password = passwordInput({
          autocomplete: needsPassword ? 'new-password' : 'current-password',
          'data-autofocus': true,
          'aria-label': needsPassword ? 'Новий пароль' : 'Пароль',
        });
        const confirm = needsPassword ? passwordInput({ 'aria-label': 'Повторіть пароль' }) : null;
        const error = el('p', { class: 'ew-gate-message', role: 'alert' });
        const submit = el('button', {
          type: 'submit',
          class: 'ew-gate-button',
          text: needsPassword ? 'Встановити пароль і увійти' : 'Увійти',
        });
        const form = el('form', { class: 'ew-gate-form', novalidate: true },
          needsPassword
            ? el('p', { class: 'ew-gate-lead', text: `Для «${selected.displayName}» ще не встановлено пароль. Пароль обов’язковий (від ${PASSWORD_MIN} символів).` })
            : null,
          field(needsPassword ? 'Новий пароль' : 'Пароль', password, 'password'),
          confirm ? field('Повторіть пароль', confirm, 'confirm') : null,
          showPasswordToggle(confirm ? [password, confirm] : [password]),
          error,
          submit,
          needsPassword ? null : el('div', { class: 'ew-gate-foot' },
            el('button', { type: 'button', class: 'ew-gate-link', text: 'Забули пароль?', onclick: () => { if (busy) return; recovering = true; render(); } })));

        form.addEventListener('submit', async event => {
          event.preventDefault();
          if (busy) return;
          error.textContent = '';
          setErrors(form, {});
          const wait = blockedUntil - Date.now();
          if (wait > 0) {
            error.textContent = `Забагато невдалих спроб. Зачекайте ${Math.ceil(wait / 1000)} с.`;
            return;
          }
          if (needsPassword) {
            const problem = passwordError(password.value) ? { password: passwordError(password.value) }
              : (password.value !== confirm.value ? { confirm: 'Паролі не збігаються.' } : {});
            if (Object.keys(problem).length) { setErrors(form, problem); return; }
          } else if (!password.value) {
            setErrors(form, { password: 'Введіть пароль.' });
            return;
          }
          busy = true;
          submit.disabled = true;
          try {
            if (needsPassword) await setLocalProfilePassword(selected.id, null, password.value);
            await signInLocalProfile(selected.id, password.value);
            resolve('signed-in');
          } catch (failure) {
            const next = registerLoginFailure({ failures, blockedUntil }, String(failure?.message || failure), Date.now());
            ({ failures, blockedUntil } = next);
            error.textContent = next.message;
            password.value = '';
            if (confirm) confirm.value = '';
            password.focus();
          } finally {
            busy = false;
            submit.disabled = false;
          }
        });
        return form;
      }

      // «Забули пароль?»: код відновлення бібліотеки «Робочого середовища» задає новий пароль
      // профілю й одразу входить у нього (library_recover з profileId). Профіль без бібліотеки
      // ядро відхиляє. Невдалі спроби тут не рахуються в затримку входу: код перевіряє ядро.
      function recoveryForm() {
        const code = textInput({ 'data-autofocus': true, 'aria-label': 'Код відновлення' });
        const password = passwordInput({ 'aria-label': 'Новий пароль' });
        const confirm = passwordInput({ 'aria-label': 'Повторіть новий пароль' });
        const error = el('p', { class: 'ew-gate-message', role: 'alert' });
        const submit = el('button', { type: 'submit', class: 'ew-gate-button', text: 'Задати пароль і увійти' });
        const form = el('form', { class: 'ew-gate-form', novalidate: true },
          el('p', { class: 'ew-gate-lead', text: `Код відновлення бібліотеки «Робочого середовища» задає новий пароль профілю «${selected.displayName}»: ним ви й надалі входите в профіль і відкриваєте бібліотеку. Старий код після цього перестає діяти — ви отримаєте новий.` }),
          field('Код відновлення', code, 'code'),
          field('Новий пароль', password, 'password', `Від ${PASSWORD_MIN} символів.`),
          field('Повторіть новий пароль', confirm, 'confirm'),
          showPasswordToggle([password, confirm]),
          error,
          el('div', { class: 'ew-gate-actions' },
            el('button', { type: 'button', class: 'ew-gate-link', text: 'Назад до входу', onclick: () => { if (busy) return; recovering = false; render(); } }),
            submit));

        form.addEventListener('submit', async event => {
          event.preventDefault();
          if (busy) return;
          error.textContent = '';
          const errors = validateRecoveryStep({ code: code.value, password: password.value, confirm: confirm.value });
          setErrors(form, errors);
          if (Object.keys(errors).length) return;
          busy = true;
          submit.disabled = true;
          try {
            const recovered = await recoverProfileWithCode(selected.id, code.value.trim(), password.value);
            code.value = '';
            password.value = '';
            confirm.value = '';
            if (recovered?.recoveryCode) showNewRecoveryCode(recovered, () => resolve('signed-in'));
            else resolve('signed-in');
          } catch (failure) {
            error.textContent = recoveryFailure(String(failure?.message || failure));
            password.value = '';
            confirm.value = '';
            code.focus();
          } finally {
            busy = false;
            submit.disabled = false;
          }
        });
        return form;
      }

      render();
    });
  }

  /** Новий код відновлення після «Забули пароль?»: показується один раз, ніде не зберігається. */
  function showNewRecoveryCode({ recoveryCode, status }, done) {
    const codeNode = el('p', { class: 'ew-gate-code', text: recoveryCode, tabindex: '0', 'aria-label': 'Новий код відновлення' });
    const message = el('p', { class: 'ew-gate-hint', role: 'status' });
    const canCopy = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
    const copy = canCopy ? el('button', {
      type: 'button',
      class: 'ew-gate-button ew-gate-button-quiet',
      text: 'Скопіювати',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(recoveryCode);
          message.textContent = 'Код скопійовано. Вставте його туди, де зберігаєте, і очистьте буфер обміну.';
        } catch {
          message.textContent = 'Не вдалося скопіювати: виділіть код і скопіюйте вручну (Ctrl+C або ⌘C).';
        }
      },
    }) : null;
    show(
      el('h1', { id: 'ew-gate-title', text: 'Новий код відновлення' }),
      el('p', { class: 'ew-gate-lead', text: status?.state === 'unlocked'
        ? 'Новий пароль профілю задано, бібліотеку розблоковано.'
        : 'Новий пароль профілю задано.' }),
      el('p', { class: 'ew-gate-message', text: 'Код показується лише зараз: EasyWAR його не зберігає й більше не покаже.' }),
      codeNode,
      el('ul', { class: 'ew-gate-lines' },
        el('li', { text: 'Запишіть код на папері й тримайте окремо від цього комп’ютера.' }),
        el('li', { text: 'Хто має код, може задати новий пароль профілю й відкрити бібліотеку.' }),
        el('li', { text: 'Попередній код більше не діє.' })),
      message,
      el('div', { class: 'ew-gate-actions' },
        copy,
        el('button', { type: 'button', class: 'ew-gate-button', text: 'Я записав код — далі', 'data-autofocus': true, onclick: done })),
    );
  }

  // ---------- реєстрація ----------

  function registerFlow({ canCancel, existingNames }) {
    return new Promise(resolve => {
      const data = { displayName: '', position: '', password: '', confirm: '', avatarDataUrl: null, modules: [] };
      let created = null;
      const bound = {};

      const steps = ['Профіль', 'Модулі', 'Таблиці'];
      const stepper = current => el('ol', { class: 'ew-gate-steps', 'aria-label': 'Кроки реєстрації' },
        steps.map((label, index) => el('li', {
          class: index === current ? 'is-current' : (index < current ? 'is-done' : ''),
          'aria-current': index === current ? 'step' : null,
        }, el('span', { class: 'ew-gate-step-n', text: String(index + 1) }), label)));

      const cancelButton = () => (canCancel
        ? el('button', { type: 'button', class: 'ew-gate-link', text: 'Скасувати', onclick: () => resolve('cancel') })
        : null);

      // Крок 1: профіль і пароль.
      function stepProfile() {
        const name = textInput({ value: data.displayName, maxlength: String(NAME_MAX), 'data-autofocus': true, 'aria-label': 'Ім’я або позивний' });
        const position = textInput({ value: data.position, maxlength: String(POSITION_MAX), placeholder: 'Напр. «Начальник групи аналізу»', 'aria-label': 'Посада' });
        const password = passwordInput({ value: data.password, 'aria-label': 'Пароль' });
        const confirm = passwordInput({ value: data.confirm, 'aria-label': 'Повторіть пароль' });
        const preview = el('span', { class: 'ew-gate-photo-preview' }, avatar({ displayName: data.displayName || '?', avatarDataUrl: data.avatarDataUrl }, 'lg'));
        const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
        const photoNote = el('small', { class: 'ew-gate-hint', text: 'Необов’язково. Фото лишається лише на цьому комп’ютері.' });

        const refreshPreview = () => {
          preview.textContent = '';
          preview.append(avatar({ displayName: name.value || '?', avatarDataUrl: data.avatarDataUrl }, 'lg'));
        };
        name.addEventListener('input', refreshPreview);
        picker.addEventListener('change', async () => {
          const [file] = picker.files;
          if (!file) return;
          try {
            data.avatarDataUrl = await readAvatar(file);
            photoNote.textContent = 'Фото додано.';
          } catch (failure) {
            photoNote.textContent = String(failure?.message || failure);
          }
          refreshPreview();
        });

        const form = el('form', { class: 'ew-gate-form', novalidate: true },
          el('div', { class: 'ew-gate-photo' },
            preview,
            el('div', {},
              el('div', { class: 'ew-gate-photo-actions' },
                el('button', { type: 'button', class: 'ew-gate-button ew-gate-button-quiet', text: 'Обрати фото…', onclick: () => { picker.value = ''; picker.click(); } }),
                el('button', { type: 'button', class: 'ew-gate-link', text: 'Прибрати', onclick: () => { data.avatarDataUrl = null; photoNote.textContent = 'Фото не додано.'; refreshPreview(); } })),
              photoNote),
            picker),
          field('Ім’я або позивний', name, 'displayName'),
          field('Посада (необов’язково)', position, 'position'),
          field('Пароль', password, 'password', `Від ${PASSWORD_MIN} символів. Закриває вхід у застосунок на цьому комп’ютері; файли таблиць не шифрує. Забутий пароль можна задати заново лише кодом відновлення бібліотеки «Робочого середовища».`),
          field('Повторіть пароль', confirm, 'confirm'),
          showPasswordToggle([password, confirm]),
          el('div', { class: 'ew-gate-actions' },
            cancelButton(),
            el('button', { type: 'submit', class: 'ew-gate-button', text: 'Далі' })));

        form.addEventListener('submit', event => {
          event.preventDefault();
          Object.assign(data, {
            displayName: name.value,
            position: position.value,
            password: password.value,
            confirm: confirm.value,
          });
          const errors = validateProfileStep(data, existingNames);
          setErrors(form, errors);
          if (Object.keys(errors).length === 0) stepModules();
        });

        show(
          el('h1', { id: 'ew-gate-title', text: canCancel ? 'Новий користувач' : 'Ласкаво просимо до easyWAR' }),
          el('p', { class: 'ew-gate-lead', text: canCancel
            ? 'Профіль зберігається лише на цьому комп’ютері й має власний пароль, модулі та таблиці.'
            : 'Створіть свій профіль. Він зберігається лише на цьому комп’ютері; після кожного запуску застосунок просить пароль.' }),
          stepper(0),
          form,
        );
      }

      // Крок 2: модулі. Профіль створюється наприкінці цього кроку.
      function stepModules() {
        const boxes = GATE_MODULES.map(module => el('input', {
          type: 'checkbox',
          value: module.id,
          checked: rowChosen(module, data.modules),
          'aria-label': module.title,
        }));
        const error = el('p', { class: 'ew-gate-message', role: 'alert' });
        const create = el('button', { type: 'submit', class: 'ew-gate-button', text: 'Створити профіль' });
        const form = el('form', { class: 'ew-gate-form', novalidate: true },
          el('div', { class: 'ew-gate-modules' },
            GATE_MODULES.map((module, index) => el('label', { class: 'ew-gate-module' },
              boxes[index],
              el('span', {},
                el('strong', { text: module.title }),
                el('small', { text: module.hint })))),
            // Модулі в розробці видно в переліку, але обрати їх ще не можна.
            SOON_MODULES.map(module => el('label', { class: 'ew-gate-module is-soon' },
              el('input', { type: 'checkbox', disabled: true, 'aria-label': `${module.title}: у розробці` }),
              el('span', {},
                el('strong', { text: module.title }),
                el('small', { text: module.hint }))))),
          error,
          el('div', { class: 'ew-gate-actions' },
            el('button', { type: 'button', class: 'ew-gate-link', text: 'Назад', onclick: () => { data.modules = chosen(); stepProfile(); } }),
            create));
        const chosen = () => modulesForRows(boxes.filter(box => box.checked).map(box => box.value));
        boxes[0].setAttribute('data-autofocus', '');

        form.addEventListener('submit', async event => {
          event.preventDefault();
          data.modules = chosen();
          const problem = modulesError(data.modules);
          if (problem) { error.textContent = problem; return; }
          error.textContent = '';
          create.disabled = true;
          try {
            const state = await registerLocalProfile({
              displayName: data.displayName,
              password: data.password,
              position: data.position,
              avatarDataUrl: data.avatarDataUrl,
              modules: data.modules,
            });
            created = state.profiles.find(profile => profile.id === state.activeProfileId);
            data.password = '';
            data.confirm = '';
            stepTables();
          } catch (failure) {
            error.textContent = `Не вдалося створити профіль: ${String(failure?.message || failure)}`;
            create.disabled = false;
          }
        });

        show(
          el('h1', { id: 'ew-gate-title', text: 'Які модулі вам потрібні?' }),
          el('p', { class: 'ew-gate-lead', text: 'Обрані модулі з’являться на стартовому екрані. Змінити вибір можна пізніше в налаштуваннях профілю.' }),
          stepper(1),
          form,
        );
      }

      // Крок 3: таблиці. Профіль уже створено, тож прив'язка необов'язкова й безпечна.
      function stepTables() {
        const slots = slotsForModules(data.modules);
        const error = el('p', { class: 'ew-gate-message', role: 'alert' });
        const rows = slots.map(slot => {
          const status = el('span', { class: 'ew-gate-slot-file', text: 'не прив’язано' });
          const button = el('button', { type: 'button', class: 'ew-gate-button ew-gate-button-quiet', text: 'Прив’язати таблицю…' });
          button.addEventListener('click', async () => {
            error.textContent = '';
            button.disabled = true;
            try {
              const next = await chooseProfileDatabase(created.id, slot.branch);
              if (next) {
                const profile = next.profiles.find(candidate => candidate.id === created.id);
                const path = profile?.tables?.[slot.branch];
                bound[slot.branch] = path;
                status.textContent = databaseFileName(path) || 'не прив’язано';
                status.classList.toggle('is-bound', Boolean(path));
                button.textContent = 'Змінити…';
              }
            } catch (failure) {
              error.textContent = `Таблицю не прив’язано: ${String(failure?.message || failure)}`;
            } finally {
              button.disabled = false;
            }
          });
          return el('div', { class: 'ew-gate-slot' },
            el('span', { class: 'ew-gate-slot-title', text: slot.title }),
            status,
            button);
        });
        const done = el('button', { type: 'button', class: 'ew-gate-button', text: 'Готово', 'data-autofocus': true, onclick: () => resolve('done') });
        show(
          el('h1', { id: 'ew-gate-title', text: 'Таблиці' }),
          el('p', { class: 'ew-gate-lead', text: slots.length
            ? 'Профіль створено. Можна одразу прив’язати свої таблиці .xlsx або пропустити цей крок: зробити це можна пізніше на стартовому екрані.'
            : 'Профіль створено. Для обраних модулів прив’язувати таблиці до профілю не потрібно.' }),
          stepper(2),
          slots.length ? el('div', { class: 'ew-gate-slots' }, rows) : null,
          error,
          el('div', { class: 'ew-gate-actions' }, done),
        );
      }

      stepProfile();
    });
  }

  // ---------- головний цикл ----------

  function showLoadError(failure) {
    return new Promise(resolve => {
      show(
        el('h1', { id: 'ew-gate-title', text: 'Не вдалося відкрити профілі' }),
        el('p', { class: 'ew-gate-message', role: 'alert', text: String(failure?.message || failure) }),
        el('div', { class: 'ew-gate-actions' },
          el('button', { type: 'button', class: 'ew-gate-button', text: 'Спробувати ще раз', 'data-autofocus': true, onclick: () => resolve() })));
    });
  }

  /**
   * Показує вхід і чекає, поки користувач увійде (або зареєструється). Кожен запуск
   * починається без активного входу: сесія в ядрі скидається.
   */
  async function requireSignIn() {
    try { await lockLocalProfile(); } catch { /* ядро недоступне: екран входу все одно показуємо */ }
    lockPage();
    let screen = null;
    for (;;) {
      let state;
      try {
        state = await getLocalProfiles();
      } catch (failure) {
        await showLoadError(failure);
        continue;
      }
      screen ??= gateScreen(state);
      if (screen === 'register') {
        const result = await registerFlow({
          canCancel: state.profiles.length > 0,
          existingNames: state.profiles.map(profile => profile.displayName),
        });
        if (result === 'done') break;
        screen = 'login';
        continue;
      }
      if ((await loginFlow(state)) === 'signed-in') break;
      screen = 'register';
    }
    unlockPage();
  }

  return { requireSignIn };
}
