// EasyFLY для телефона (iPhone): оболонка без Tauri-команд. Відкриває зашифроване сховище
// парольною фразою, далі монтує той самий EasyFLY, що й у «Робочому середовищі»
// (src/workspace/easyfly/app.js), через host з phone-host-core.js. Файли .easyfly — лише імпорт
// (вибір файлу) і копія (меню «Поділитися» → «Зберегти у Файли»). Мережі немає.
import { mount } from '../../workspace/easyfly/app.js';
import { createPhoneHost, shareViaNavigator } from './phone-host-core.js';
import { createIndexedDbStorage, createVault, passphraseProblem } from './vault-core.js';
import { icon } from '../../workspace/easyfly/icons.js';

/** Через стільки хвилин у фоні сховище закривається і знову просить фразу. */
const AUTO_LOCK_MINUTES = 5;

const root = document.getElementById('easyfly-phone');

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (name === 'text') node.textContent = value;
    else if (name === 'class') node.className = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2).toLowerCase(), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

function download(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const link = el('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 10_000);
}

function unsupported(message) {
  root.replaceChildren(el('main', { class: 'efp-lock' }, el('div', { class: 'efp-card' },
    el('h1', { class: 'efp-title', text: 'EasyFLY' }),
    el('p', { class: 'efp-error', role: 'alert', text: message }))));
}

let vault;
try {
  vault = createVault({ storage: createIndexedDbStorage(globalThis.indexedDB), crypto: globalThis.crypto });
} catch (error) {
  unsupported(`Цей браузер не підходить: ${error?.message || error}`);
}

let mounted = null;

function lockScreen({ exists, error = null }) {
  if (mounted) { try { mounted.unmount?.(); } catch { /* уже знято */ } mounted = null; }
  vault.lock();
  const errorBox = el('p', { class: 'efp-error', role: 'alert', text: error || '' });
  const phrase = el('input', { class: 'efp-input', type: 'password', autocomplete: exists ? 'current-password' : 'new-password', autocapitalize: 'off', spellcheck: 'false', name: 'passphrase', 'aria-label': 'Парольна фраза', required: true });
  const repeat = exists ? null : el('input', { class: 'efp-input', type: 'password', autocomplete: 'new-password', autocapitalize: 'off', spellcheck: 'false', name: 'passphrase-repeat', 'aria-label': 'Повторіть парольну фразу', required: true });
  const submit = el('button', { class: 'efp-btn efp-btn-primary', type: 'submit', text: exists ? 'Відкрити' : 'Створити сховище' });
  const form = el('form', { class: 'efp-form', onSubmit: async event => {
    event.preventDefault();
    errorBox.textContent = '';
    if (!exists) {
      const problem = passphraseProblem(phrase.value);
      if (problem) { errorBox.textContent = problem; phrase.focus(); return; }
      if (phrase.value !== repeat.value) { errorBox.textContent = 'Фрази не збігаються.'; repeat.focus(); return; }
    }
    submit.disabled = true;
    submit.textContent = exists ? 'Відкриваю…' : 'Створюю…';
    try {
      if (exists) await vault.unlock(phrase.value); else await vault.create(phrase.value);
      phrase.value = '';
      if (repeat) repeat.value = '';
      await openApp();
    } catch (err) {
      errorBox.textContent = err?.message || String(err);
      submit.disabled = false;
      submit.textContent = exists ? 'Відкрити' : 'Створити сховище';
      phrase.focus();
    }
  } },
  el('label', { class: 'efp-label' }, 'Парольна фраза', phrase),
  repeat ? el('label', { class: 'efp-label' }, 'Повторіть фразу', repeat) : null,
  errorBox,
  el('div', { class: 'efp-actions' }, submit,
    exists ? el('button', { class: 'efp-btn efp-btn-ghost', type: 'button', text: 'Стерти сховище на цьому пристрої…', onClick: async () => {
      if (!window.confirm('Стерти всі дані EasyFLY на цьому пристрої? Копії у файлах .easyfly лишаться.')) return;
      await vault.destroy();
      lockScreen({ exists: false });
    } }) : null));
  root.replaceChildren(el('main', { class: 'efp-lock' }, el('div', { class: 'efp-card' },
    el('div', { class: 'efp-logo', 'aria-hidden': 'true' }, icon('shturman', 28)),
    el('h1', { class: 'efp-title', text: 'EasyFLY' }),
    el('p', { class: 'efp-lead', text: exists
      ? 'Дані на цьому пристрої зашифровано. Введіть парольну фразу, щоб відкрити їх.'
      : 'Дані зберігатимуться лише на цьому телефоні, зашифровані парольною фразою. Інтернет не потрібен. Фразу відновити неможливо: якщо її забути, допоможе лише копія у файлі .easyfly.' }),
    form,
    el('p', { class: 'efp-hint', text: `Сховище закривається само через ${AUTO_LOCK_MINUTES} хв у фоні. Лише позивні, без ПІБ і номерів документів.` }))));
  phrase.focus();
}

async function openApp() {
  const container = el('div', { class: 'efp-easyfly' });
  root.replaceChildren(container);
  const host = createPhoneHost({
    vault,
    pickFile,
    shareFile: (name, bytes) => shareViaNavigator(navigator, name, bytes),
    download,
    onState: ({ title }) => { document.title = title ? `${title} — EasyFLY` : 'EasyFLY'; },
    rootUrl: new URL('./', location.href).href,
  });
  mounted = await mount(container, host);
}

let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (hiddenAt && vault.unlocked && Date.now() - hiddenAt > AUTO_LOCK_MINUTES * 60_000) lockScreen({ exists: true });
  hiddenAt = null;
});

if (vault) {
  vault.exists().then(exists => lockScreen({ exists })).catch(error => unsupported(`Сховище недоступне: ${error?.message || error}`));
}
