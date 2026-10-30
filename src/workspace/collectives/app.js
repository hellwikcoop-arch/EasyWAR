// Локальна підготовка колективу. Справжнє збереження через host.file, без IPC колективів.
import {
  addParticipant, changeParticipantRole, createCollective, decodeCollective,
  encodeCollective, removeParticipant, renameCollective,
} from './collectives-core.js';
import {
  CLASS_OPTIONS, PURPOSE_OPTIONS, TRANSPORT_OPTIONS, canCreateCollective, canCreateIdentity,
  checkHours, checkOperation, checkPassword, collectiveLine, detailLine, expectText, keyStoreText,
  preparedText, reportText, tableLine, transportNote,
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
function area(placeholder, readOnly = false) {
  const e = $('textarea', 'ec-input ec-area');
  e.rows = 3;
  e.spellcheck = false;
  e.placeholder = placeholder;
  e.readOnly = readOnly;
  return e;
}
function select(options) {
  const e = $('select', 'ec-input');
  for (const option of options) {
    const item = $('option', '', option.label);
    item.value = option.value;
    e.append(item);
  }
  return e;
}
function checkbox(text) {
  const label = $('label', 'ec-check');
  const box = $('input');
  box.type = 'checkbox';
  label.append(box, $('span', '', text));
  return { label, box };
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
  let exchangeFp = '';
  let detail = null;
  let shared = null;
  let reportResult = '';
  // Підготовлена доповідь: лише ідентифікатор наміру в Rust і підсумок для показу.
  let prepared = null;
  function passwordInput() {
    const e = $('input', 'ec-input');
    e.type = 'password';
    e.autocomplete = 'current-password';
    e.maxLength = 1024;
    e.placeholder = 'Пароль профілю';
    return e;
  }
  // Помилка показується під тією формою, яка її спричинила (`secureErrorAt`), а не під першою.
  let secureErrorAt = '';
  async function secureAction(fn, at = '') {
    if (secureBusy) return;
    secureBusy = true; secureError = ''; secureErrorAt = ''; renderSecure();
    try {
      await fn();
      secureState = await host.collectives.status();
      detail = exchangeFp ? await host.collectives.detail(exchangeFp).catch(() => null) : null;
    }
    catch (error) { secureError = String(error?.message || error || 'Не вдалося виконати дію.'); secureErrorAt = at; }
    finally { secureBusy = false; renderSecure(); }
  }
  function errorAt(at) {
    if (!secureError || secureErrorAt !== at) return [];
    const err = $('p', 'ec-status', secureError);
    err.dataset.error = 'true';
    err.dataset.at = at;
    return [err];
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
        }, 'identity');
      });
      secure.append(form, ...errorAt('identity'));
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
        }, 'create');
      });
      secure.append(form, ...errorAt('create'));
    }
    secure.append(...errorAt(''));
    if (secureState.identity) renderExchange();
    secure.append($('p', 'ec-caption', 'Обмін іде лише через тексти, які ви пересилаєте самі, і локальну чергу відправки. Мережі на цьому етапі немає.'));
  }

  // Обмін у колективі: склад, таблиці з класом, запрошення, вступ і «Доповісти».
  function sharedBox() {
    if (!shared) return null;
    const box = $('div', 'ec-recovery');
    const text = area('', true);
    text.value = shared.text;
    text.rows = 4;
    const hide = button('Сховати');
    hide.addEventListener('click', () => { shared = null; renderSecure(); });
    box.append($('p', 'ec-label', shared.title), $('p', 'ec-caption', shared.hint), text, hide);
    return box;
  }
  function passwordForm(submitText, fields, run, at = '') {
    const form = $('form', 'ec-inline');
    const pass = passwordInput();
    const submit = button(submitText);
    submit.type = 'submit';
    submit.disabled = secureBusy;
    form.append(...fields, field('Пароль профілю', pass), submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      secureAction(async () => {
        checkPassword(pass.value);
        await run(pass.value);
        pass.value = '';
      }, at);
    });
    return form;
  }
  function withError(form, at) {
    const wrap = $('div', 'ec-with-error');
    wrap.append(form, ...errorAt(at));
    return wrap;
  }
  function renderExchange() {
    const box = $('div', 'ec-exchange');
    box.append($('h3', '', 'Обмін у колективі'));
    if (secureState.collectives.length) {
      const choose = select([{ value: '', label: 'Оберіть колектив' },
        ...secureState.collectives.map(item => ({ value: item.fingerprint, label: `${item.name} · ${item.fingerprint}` }))]);
      choose.value = exchangeFp;
      choose.addEventListener('change', () => {
        exchangeFp = choose.value; reportResult = ''; prepared = null;
        secureAction(async () => {});
      });
      box.append(field('Колектив', choose));
    }
    if (exchangeFp && detail) renderDetail(box);
    const shown = sharedBox();
    if (shown) box.append(shown);
    const invitation = area('EWINV1.…');
    box.append($('p', 'ec-label', 'ВСТУПИТИ ЗА ЗАПРОШЕННЯМ'), withError(passwordForm('Підготувати відповідь', [field('Текст запрошення', invitation)], async password => {
      expectText(invitation.value, 'invitation');
      const made = await host.collectives.joinRequest(password, invitation.value);
      shared = { title: 'ВІДПОВІДЬ НА ЗАПРОШЕННЯ', text: made.text,
        hint: `Колектив ${made.collectiveFingerprint}, запросив ${made.inviterFingerprint}. Звірте відбиток із запрошувачем голосом чи особисто й передайте йому цей текст.` };
    }, 'join-request'), 'join-request'));
    const keys = area('EWKEYS1.…');
    box.append($('p', 'ec-label', 'ПРИЙНЯТИ ПАКЕТ КЛЮЧІВ'), withError(passwordForm('Прийняти й вступити', [field('Пакет ключів', keys)], async password => {
      expectText(keys.value, 'keys');
      const joined = await host.collectives.joinAccept(password, keys.value);
      exchangeFp = joined.collective.fingerprint;
      shared = { title: 'ВИ В КОЛЕКТИВІ', text: joined.members.join('\n'),
        hint: `«${joined.collective.name}»: відбитки учасників за перевіреним журналом. Звірте їх із запрошувачем.` };
      keys.value = '';
    }, 'join-accept'), 'join-accept'));
    secure.append(box);
  }
  function renderDetail(box) {
    box.append($('p', 'ec-caption', detailLine(detail)));
    const members = $('div', 'ec-list');
    for (const member of detail.members) {
      const row = $('div', 'ec-row');
      row.append($('span', 'ec-label', 'Учасник'), $('code', '', member));
      members.append(row);
    }
    box.append(members);

    const tables = $('div', 'ec-list');
    for (const table of detail.tables) {
      const row = $('div', 'ec-row');
      row.append($('span', 'ec-person', table.title), $('code', '', table.fingerprint), $('span', 'ec-caption', tableLine(table)));
      tables.append(row);
    }
    if (detail.tables.length) box.append($('p', 'ec-label', 'ТАБЛИЦІ КОЛЕКТИВУ'), tables);

    const tableForm = $('form', 'ec-inline');
    const title = input('Назва таблиці');
    const cls = select(CLASS_OPTIONS);
    const purpose = select(PURPOSE_OPTIONS);
    const add = button('Додати таблицю');
    add.type = 'submit';
    add.disabled = secureBusy;
    tableForm.append(field('Назва', title), field('Клас', cls), field('Призначення', purpose), add);
    tableForm.addEventListener('submit', event => {
      event.preventDefault();
      secureAction(async () => {
        await host.collectives.setTable({ collective: exchangeFp, title: title.value, cls: cls.value, purpose: purpose.value });
      }, 'table');
    });
    box.append($('p', 'ec-label', 'НОВА ТАБЛИЦЯ (КЛАС ПІДТВЕРДЖУЄТЕ ВИ ЯК ВЛАСНИК)'), withError(tableForm, 'table'));

    const hours = input('24');
    hours.value = '24';
    box.append($('p', 'ec-label', 'ЗАПРОСИТИ УЧАСНИКА'), withError(passwordForm('Створити запрошення', [field('Строк, годин', hours)], async password => {
      const made = await host.collectives.inviteCreate(password, exchangeFp, checkHours(hours.value));
      shared = { title: 'ЗАПРОШЕННЯ', text: made.text,
        hint: 'Одноразове. Передайте текст запрошеному поза EasyWAR; він поверне відповідь, яку ви вставите нижче.' };
    }, 'invite'), 'invite'));
    const request = area('EWJOIN1.…');
    box.append($('p', 'ec-label', 'ВПУСТИТИ ЗА ВІДПОВІДДЮ'), withError(passwordForm('Впустити', [field('Відповідь запрошеного', request)], async password => {
      expectText(request.value, 'request');
      const admitted = await host.collectives.inviteAdmit(password, exchangeFp, request.value);
      shared = { title: 'ПАКЕТ КЛЮЧІВ ДЛЯ НОВОГО УЧАСНИКА', text: admitted.text,
        hint: `Учасник ${admitted.memberFingerprint} у журналі. Передайте йому цей текст; відкритих ключів у ньому немає.` };
      request.value = '';
    }, 'admit'), 'admit'));

    const writable = detail.tables.filter(table => table.canWrite);
    if (!writable.length) return;
    const table = select(writable.map(item => ({ value: item.fingerprint, label: `${item.title} · клас ${item.class}` })));
    const transport = select(TRANSPORT_OPTIONS);
    const note = $('p', 'ec-caption', transportNote(detail, transport.value));
    transport.addEventListener('change', () => { note.textContent = transportNote(detail, transport.value); });
    box.append($('p', 'ec-label', 'ДОПОВІСТИ'));
    if (prepared) {
      // Крок 2: людина бачить підсумок, сформований у Rust, і підтверджує паролем.
      const cancel = button('Скасувати');
      cancel.disabled = secureBusy;
      cancel.addEventListener('click', () => { prepared = null; reportResult = ''; renderSecure(); });
      box.append($('p', 'ec-status', prepared.text), withError(passwordForm('Доповісти', [], async password => {
        const intent = prepared.intent;
        prepared = null;
        reportResult = reportText(await host.collectives.reportConfirm(password, intent));
      }, 'report'), 'report'), cancel);
    } else {
      // Крок 1: Rust перевіряє маршрут і права й запам'ятовує намір на 60 секунд.
      const wan = checkbox('Явно обираю передачу через інтернет');
      const operation = area('Зміна рядка (синтетичний приклад: {"row":"…"})');
      const form = $('form', 'ec-inline');
      const submit = button('Підготувати');
      submit.type = 'submit';
      submit.disabled = secureBusy;
      form.append(field('Таблиця', table), field('Транспорт', transport), wan.label, field('Операція', operation), submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        secureAction(async () => {
          checkOperation(operation.value);
          const outcome = await host.collectives.reportPrepare({ collective: exchangeFp, table: table.value,
            transport: transport.value, explicitWan: wan.box.checked, operation: operation.value });
          reportResult = '';
          if (outcome.allowed) prepared = { intent: outcome.intent, text: preparedText(outcome) };
          else reportResult = reportText(outcome);
        }, 'report');
      });
      box.append(note, withError(form, 'report'));
    }
    if (reportResult) box.append($('p', 'ec-status', reportResult));
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
