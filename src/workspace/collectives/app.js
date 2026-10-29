// Локальна підготовка колективу. Справжнє збереження через host.file, без IPC колективів.
import {
  addParticipant, changeParticipantRole, createCollective, decodeCollective,
  encodeCollective, removeParticipant, renameCollective,
} from './collectives-core.js';
import {
  canCreateCollective, canCreateIdentity, checkPassword, collectiveLine, keyStoreText,
} from './secure-core.js';
import './collectives.css';

export const contract = 1;

const $ = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
function button(text) {
  const e = $('button', 'ec-btn', text);
  e.type = 'button';
  return e;
}
function input(placeholder) {
  const e = $('input', 'ec-input');
  e.type = 'text';
  e.maxLength = 80;
  e.autocomplete = 'off';
  e.placeholder = placeholder;
  return e;
}
const roles = Object.freeze({ owner: 'Власник', admin: 'Адміністратор', member: 'Учасник' });

export async function mount(container, host) {
  let draft = null;
  let handle = null;
  let fileName = '';
  let dirty = false;
  let busy = false;

  const root = $('main', 'ec-root');
  const header = $('header', 'ec-header');
  header.append($('p', 'ec-kicker', 'РОБОЧЕ СЕРЕДОВИЩЕ / КОЛЕКТИВИ'),
    $('h1', '', 'Колективи'),
    $('p', 'ec-lead', 'Локальна підготовка складу й ролей. Файл зберігається на вашому комп’ютері.'));
  const warning = $('p', 'ec-warning', 'Лише локальний файл .ewcoll. Це не захищений колектив: немає шифрування, вступу за кодом чи Sync. Не вводьте особові, оперативні або інші чутливі дані.');
  const toolbar = $('div', 'ec-toolbar');
  const fresh = button('Новий колектив');
  const open = button('Відкрити файл');
  const save = button('Зберегти');
  const saveAs = button('Зберегти як…');
  toolbar.append(fresh, open, save, saveAs);
  const status = $('p', 'ec-status', 'Створіть колектив або відкрийте локальний файл.');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const secure = $('section', 'ec-card ec-secure');
  const panel = $('div', 'ec-panel');
  root.append(header, secure, warning, toolbar, status, panel);
  container.append(root);

  // Захищені колективи: ключ учасника профілю і колективи, створені цим профілем (Rust,
  // міграція 0019). Пароль профілю йде лише в Rust; тут показуються відбитки й лічильники.
  let secureState = null;
  let secureError = '';
  let recoveryKey = '';
  let secureBusy = false;
  function passwordInput() {
    const e = $('input', 'ec-input');
    e.type = 'password';
    e.autocomplete = 'current-password';
    e.maxLength = 1024;
    e.placeholder = 'Пароль профілю';
    return e;
  }
  async function secureAction(fn) {
    if (secureBusy) return;
    secureBusy = true; secureError = ''; renderSecure();
    try { await fn(); secureState = await host.collectives.status(); }
    catch (error) { secureError = String(error?.message || error || 'Не вдалося виконати дію.'); }
    finally { secureBusy = false; renderSecure(); }
  }
  function renderSecure() {
    secure.replaceChildren($('p', 'ec-label', 'ЗАХИЩЕНИЙ КОЛЕКТИВ'), $('h2', '', 'Ключ учасника і захищені колективи'));
    if (!host.collectives) {
      secure.append($('p', 'ec-caption', 'Доступно лише в настільному застосунку EasyWAR: ключ зберігається на цьому комп’ютері під паролем профілю.'));
      return;
    }
    if (!secureState) {
      secure.append($('p', 'ec-caption', secureError || 'Читаю стан…'));
      return;
    }
    secure.append($('p', 'ec-caption', keyStoreText(secureState)));
    if (secureState.identity) {
      const id = $('p', 'ec-fingerprint');
      id.append($('span', 'ec-label', 'Ваш відбиток: '), $('code', '', secureState.identity.fingerprint),
        $('span', 'ec-label', '  Пристрій: '), $('code', '', secureState.identity.deviceFingerprint));
      secure.append(id);
    }
    if (recoveryKey) {
      const box = $('div', 'ec-recovery');
      box.append($('p', 'ec-label', 'КЛЮЧ ВІДНОВЛЕННЯ — ПОКАЗУЄТЬСЯ ОДИН РАЗ'),
        $('code', 'ec-recovery-key', recoveryKey),
        $('p', 'ec-caption', 'Запишіть його окремо від комп’ютера. Без пароля профілю і без цього ключа секрети не відновити.'));
      const hide = button('Я записав(ла), сховати');
      hide.addEventListener('click', () => { recoveryKey = ''; renderSecure(); });
      box.append(hide);
      secure.append(box);
    }
    if (canCreateIdentity(secureState)) {
      const form = $('form', 'ec-inline');
      const pass = passwordInput();
      const submit = button('Створити ключ учасника');
      submit.type = 'submit';
      submit.disabled = secureBusy;
      form.append(field('Пароль профілю', pass), submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        secureAction(async () => {
          checkPassword(pass.value);
          const created = await host.collectives.createIdentity(pass.value);
          pass.value = '';
          recoveryKey = created.recoveryKey;
        });
      });
      secure.append(form);
    }
    const list = $('div', 'ec-list');
    for (const item of secureState.collectives) {
      const row = $('div', 'ec-row');
      row.append($('span', 'ec-person', item.name), $('code', '', item.fingerprint), $('span', 'ec-caption', collectiveLine(item)));
      list.append(row);
    }
    if (secureState.collectives.length) secure.append($('h3', '', `Ваші колективи (${secureState.collectives.length}/20)`), list);
    if (canCreateCollective(secureState)) {
      const form = $('form', 'ec-inline');
      const name = input('Назва колективу');
      const pass = passwordInput();
      const submit = button('Створити захищений колектив');
      submit.type = 'submit';
      submit.disabled = secureBusy;
      form.append(field('Назва', name), field('Пароль профілю', pass), submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        secureAction(async () => {
          checkPassword(pass.value);
          await host.collectives.create(pass.value, name.value);
          pass.value = ''; name.value = '';
        });
      });
      secure.append(form);
    }
    if (secureError) {
      const err = $('p', 'ec-status', secureError);
      err.dataset.error = 'true';
      secure.append(err);
    }
    secure.append($('p', 'ec-caption', 'Запрошення, вступ інших учасників і обмін даними з’являться на наступних етапах; зараз колектив існує лише на цьому комп’ютері.'));
  }
  renderSecure();
  if (host.collectives) secureAction(async () => {});

  function notice(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }
  function publish(changed) {
    dirty = changed;
    host.setDirty(changed);
    host.setTitle(fileName || (draft?.name || ''));
    render();
  }
  function apply(next, text) {
    draft = next;
    publish(true);
    notice(text);
  }
  function allowedReplace() {
    return !dirty || window.confirm('Є незбережені зміни. Продовжити без їх збереження?');
  }
  function action(fn) {
    try { fn(); } catch (error) { notice(error.message || 'Не вдалося виконати дію.', true); }
  }
  function field(label, value) {
    const wrap = $('label', 'ec-field');
    wrap.append($('span', 'ec-label', label), value);
    return wrap;
  }
  function render() {
    panel.replaceChildren();
    save.disabled = busy || !draft;
    saveAs.disabled = busy || !draft;
    fresh.disabled = busy;
    open.disabled = busy;
    if (!draft) {
      const form = $('form', 'ec-form');
      const title = input('Наприклад: Навчальна група');
      const owner = input('Наприклад: Користувач А');
      const submit = button('Створити');
      submit.type = 'submit';
      form.append($('h2', '', 'Новий локальний колектив'), field('Назва колективу', title),
        field('Позначення власника', owner), submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        action(() => {
          draft = createCollective(title.value, owner.value);
          fileName = '';
          publish(true);
          notice('Колектив створено в пам’яті. Натисніть «Зберегти», щоб створити файл.');
        });
      });
      panel.append(form);
      return;
    }

    const title = $('section', 'ec-card');
    title.append($('p', 'ec-label', 'ЛОКАЛЬНИЙ КОЛЕКТИВ'), $('h2', '', draft.name),
      $('p', 'ec-caption', 'Учасники нижче — заплановані позначення, не підтверджені цифрові особи.'));
    const renameForm = $('form', 'ec-inline');
    const renameInput = input('Нова назва');
    renameInput.value = draft.name;
    const renameButton = button('Перейменувати');
    renameButton.type = 'submit';
    renameForm.append(field('Назва', renameInput), renameButton);
    renameForm.addEventListener('submit', event => {
      event.preventDefault();
      action(() => apply(renameCollective(draft, renameInput.value), 'Назву змінено.'));
    });
    title.append(renameForm);

    const list = $('section', 'ec-card');
    list.append($('h2', '', 'План складу (' + draft.participants.length + '/100)'));
    const rows = $('div', 'ec-list');
    for (const participant of draft.participants) {
      const row = $('div', 'ec-row');
      row.append($('span', 'ec-person', participant.label));
      if (participant.role === 'owner') {
        row.append($('span', 'ec-tag', roles.owner));
      } else {
        const select = $('select', 'ec-input');
        select.setAttribute('aria-label', 'Роль: ' + participant.label);
        for (const role of ['member', 'admin']) {
          const option = $('option', '', roles[role]);
          option.value = role;
          option.selected = participant.role === role;
          select.append(option);
        }
        select.addEventListener('change', () => action(() =>
          apply(changeParticipantRole(draft, participant.id, select.value), 'Роль оновлено в локальному плані.')));
        const remove = button('Прибрати');
        remove.setAttribute('aria-label', 'Прибрати: ' + participant.label);
        remove.addEventListener('click', () => action(() =>
          apply(removeParticipant(draft, participant.id), 'Позначення прибрано.')));
        row.append(select, remove);
      }
      rows.append(row);
    }
    list.append(rows);
    const addForm = $('form', 'ec-inline');
    const memberName = input('Позначення учасника');
    const role = $('select', 'ec-input');
    for (const kind of ['member', 'admin']) {
      const option = $('option', '', roles[kind]);
      option.value = kind;
      role.append(option);
    }
    const add = button('Додати до плану');
    add.type = 'submit';
    addForm.append(field('Позначення', memberName), field('Роль', role), add);
    addForm.addEventListener('submit', event => {
      event.preventDefault();
      action(() => {
        apply(addParticipant(draft, memberName.value, role.value), 'Позначення додано до локального плану.');
        memberName.value = '';
      });
    });
    list.append(addForm);
    panel.append(title, list);
  }

  fresh.addEventListener('click', () => action(async () => {
    if (!allowedReplace()) return;
    if (handle) await host.closeFile(handle);
    handle = null;
    fileName = '';
    draft = null;
    publish(false);
    notice('Створіть новий локальний колектив.');
  }));
  open.addEventListener('click', async () => {
    if (busy || !allowedReplace()) return;
    busy = true; render();
    try {
      const opened = await host.openFile({ title: 'Відкрити локальний колектив' });
      if (!opened) return;
      let next;
      try { next = decodeCollective(opened.bytes); }
      catch (error) { await host.closeFile(opened.handle).catch(() => {}); throw error; }
      if (handle) await host.closeFile(handle).catch(() => {});
      handle = opened.handle;
      fileName = opened.name;
      draft = next;
      publish(false);
      notice('Відкрито: ' + opened.name);
    } catch (error) { notice(error.message || 'Не вдалося відкрити файл.', true); }
    finally { busy = false; render(); }
  });
  async function persist(as = false) {
    if (busy || !draft) return;
    busy = true; render();
    try {
      const bytes = encodeCollective(draft);
      const saved = handle && !as
        ? await host.saveFile({ handle, bytes })
        : await host.saveFileAs({ bytes, suggestedName: fileName || 'колектив.ewcoll',
          title: 'Зберегти локальний колектив' });
      if (!saved) return;
      if (handle && handle !== saved.handle) await host.closeFile(handle).catch(() => {});
      handle = saved.handle;
      fileName = saved.name;
      publish(false);
      notice('Збережено локальний файл: ' + saved.name);
    } catch (error) { notice(error.message || 'Не вдалося зберегти файл.', true); }
    finally { busy = false; render(); }
  }
  save.addEventListener('click', () => persist());
  saveAs.addEventListener('click', () => persist(true));
  publish(false);
  return {
    isDirty: () => dirty,
    unmount() {
      if (handle) host.closeFile(handle).catch(() => {});
      root.remove();
    },
  };
}
