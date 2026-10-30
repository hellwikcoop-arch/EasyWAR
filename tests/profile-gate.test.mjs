import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  GATE_MODULES,
  MODULE_IDS,
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  POSITION_MAX,
  failureDelayMs,
  loginFailure,
  registerLoginFailure,
  gateScreen,
  loginCardNote,
  modulesError,
  modulesForRows,
  moduleVisible,
  normalizeModules,
  passwordError,
  recoveryFailure,
  rowChosen,
  SOON_MODULE_IDS,
  slotsForModules,
  validateProfileStep,
  validateRecoveryStep,
} from '../src/profile-gate-core.js';
import { consumeSplashSkip, requestSplashSkip, SPLASH_SKIP_KEY } from '../src/startup-splash-core.js';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const ok = { displayName: 'Тестовий Оператор', position: '', password: 'пароль-1', confirm: 'пароль-1' };

test('first screen after the splash: registration without profiles, login with any', () => {
  assert.equal(gateScreen({ profiles: [] }), 'register');
  assert.equal(gateScreen(null), 'register');
  assert.equal(gateScreen({ profiles: [{ id: 'profile-1' }] }), 'login');
});

test('password is mandatory, at least 6 characters, counted by code points', () => {
  assert.equal(PASSWORD_MIN, 6);
  assert.match(passwordError(''), /щонайменше 6/);
  assert.match(passwordError('12345'), /щонайменше 6/);
  assert.equal(passwordError('123456'), null);
  assert.equal(passwordError('😀'.repeat(6)), null);
  assert.equal(passwordError('a'.repeat(PASSWORD_MAX)), null);
  assert.match(passwordError('a'.repeat(PASSWORD_MAX + 1)), /не більше/);
});

test('profile step checks name, uniqueness, lengths and password confirmation', () => {
  assert.deepEqual(validateProfileStep(ok, []), {});
  assert.ok(validateProfileStep({ ...ok, displayName: '   ' }).displayName);
  assert.ok(validateProfileStep({ ...ok, displayName: 'я'.repeat(NAME_MAX + 1) }).displayName);
  assert.ok(validateProfileStep({ ...ok, position: 'я'.repeat(POSITION_MAX + 1) }).position);
  assert.ok(validateProfileStep({ ...ok, confirm: 'інший' }).confirm);
  assert.ok(validateProfileStep({ ...ok, password: '', confirm: '' }).password);
  // дубль без урахування регістру й зайвих пробілів
  assert.ok(validateProfileStep({ ...ok, displayName: '  тестовий   ОПЕРАТОР ' }, ['Тестовий Оператор']).displayName);
  assert.deepEqual(validateProfileStep({ ...ok, displayName: 'Другий' }, ['Тестовий Оператор']), {});
});

test('at least one known module must be chosen; unknown ids are dropped', () => {
  assert.deepEqual(MODULE_IDS, ['air', 'rocket', 'artillery', 'army', 'sso', 'pvk', 'dshv', 'custom']);
  assert.deepEqual(GATE_MODULES.map(row => row.id), ['air', 'rocket', 'artillery', 'army', 'sso', 'command', 'custom']);
  assert.ok(modulesError([]));
  assert.ok(modulesError(['unknown']));
  assert.ok(modulesError(null));
  assert.equal(modulesError(['rocket']), null);
  assert.deepEqual(normalizeModules(['dshv', 'air', 'air', 'x']), ['air', 'dshv']);
});

test('module titles in the registration carry no beta label', () => {
  assert.equal(GATE_MODULES.find(module => module.id === 'artillery').title, 'Артилерія');
  assert.ok(GATE_MODULES.every(module => !/beta|бета/i.test(module.title)));
});

test('«Сили спеціальних операцій» — модуль у розробці: обирається, але не сам і без таблиці', async () => {
  assert.deepEqual(SOON_MODULE_IDS, ['sso']);
  const sso = GATE_MODULES.find(row => row.id === 'sso');
  assert.equal(sso.soon, true);
  assert.match(sso.hint, /У розробці/);
  assert.ok(modulesError(['sso']), 'лише модуль у розробці не дає робочого стартового екрана');
  assert.equal(modulesError(['sso', 'air']), null);
  assert.deepEqual(slotsForModules(['sso']), [], 'таблиці профілю в ССО немає');
  const html = await read('index.html');
  const card = html.match(/<button class="branch-card branch-card-soon" data-branch="sso"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(card, 'картка ССО є на стартовому екрані і не має класу branch-card-live');
  assert.match(card[0], /aria-disabled="true"/);
  assert.match(card[0], /<h3>Сили спеціальних операцій<\/h3>/);
  assert.match(card[0], /<span class="bc-soon">У розробці<\/span>/);
  assert.match(card[0], /data:image\/webp;base64,/, 'тризуб ССО вбудовано у файл');
  assert.doesNotMatch(html, /MODULE_SRC = \{[^}]*sso:/, 'картка нікуди не веде');
});

test('table slots follow the chosen modules; artillery has no own slot', () => {
  assert.deepEqual(slotsForModules(['air']).map(s => s.branch), ['air']);
  assert.deepEqual(slotsForModules(['artillery']), []);
  assert.deepEqual(slotsForModules(['pvk', 'air']).map(s => s.branch), ['air', 'pvk', 'pvk_losses']);
  assert.deepEqual(slotsForModules(['army']).map(s => s.branch), ['army'], 'армійська авіація має власну таблицю');
  assert.deepEqual(slotsForModules(MODULE_IDS).map(s => s.branch),
    ['air', 'rocket', 'army', 'pvk', 'pvk_losses', 'dshv', 'dshv_losses']);
  assert.deepEqual(slotsForModules(['custom']), [], 'власний модуль таблиці не має');
});

test('«Командування військ» є одним рядком для ПВК і УДШВ; «Власний модуль» — без роду військ', () => {
  const command = GATE_MODULES.find(row => row.id === 'command');
  assert.equal(command.title, 'Командування військ');
  assert.deepEqual(command.modules, ['pvk', 'dshv']);
  assert.deepEqual(modulesForRows(['command']), ['pvk', 'dshv']);
  assert.deepEqual(modulesForRows(['custom', 'air']), ['air', 'custom']);
  assert.deepEqual(modulesForRows(['nope']), []);
  assert.equal(rowChosen(command, ['pvk']), true, 'рядок відмічено, якщо обрано хоч один із його модулів');
  assert.equal(rowChosen(command, new Set(['dshv'])), true);
  assert.equal(rowChosen(command, ['air', 'custom']), false);
  const custom = GATE_MODULES.find(row => row.id === 'custom');
  assert.equal(custom.title, 'Власний модуль');
  assert.deepEqual(custom.modules, ['custom']);
  assert.equal(modulesError(['custom']), null);
});

test('start screen shows only chosen modules; a profile without a list sees all', () => {
  const profile = { modules: ['air', 'pvk'] };
  assert.equal(moduleVisible('air', profile), true);
  assert.equal(moduleVisible('rocket', profile), false);
  assert.equal(moduleVisible('rocket', { modules: [] }), true);
  assert.equal(moduleVisible('rocket', {}), true);
  assert.equal(moduleVisible('rocket', null), true);
});

test('failed attempts slow down after five tries, capped at one minute', () => {
  assert.equal(failureDelayMs(0), 0);
  assert.equal(failureDelayMs(4), 0);
  assert.equal(failureDelayMs(5), 5000);
  assert.equal(failureDelayMs(6), 10000);
  assert.equal(failureDelayMs(40), 60000);
  assert.equal(failureDelayMs(NaN), 0);
});

test('the core\'s wording of a failed login is mapped to the page message', () => {
  assert.deepEqual(loginFailure('неправильний пароль'), { message: 'Неправильний пароль.', throttled: false });
  assert.deepEqual(
    loginFailure('забагато невдалих спроб входу, спробуйте знову через 30 с'),
    { message: 'Забагато невдалих спроб входу, спробуйте знову через 30 с.', throttled: true });
  assert.deepEqual(loginFailure('щось інше'), { message: 'Не вдалося увійти: щось інше', throttled: false });
  assert.equal(loginFailure(undefined).throttled, false);
});

test('a pause announced by the core is not counted by the page, a wrong password is', () => {
  const start = { failures: 4, blockedUntil: 0 };
  const wrong = registerLoginFailure(start, 'неправильний пароль', 1000);
  assert.deepEqual(wrong, { failures: 5, blockedUntil: 1000 + failureDelayMs(5), message: 'Неправильний пароль.' });
  const paused = registerLoginFailure(wrong, 'забагато невдалих спроб входу, спробуйте знову через 30 с', 2000);
  assert.equal(paused.failures, 5, 'the page counter does not grow on the core pause');
  assert.equal(paused.blockedUntil, wrong.blockedUntil);
  assert.match(paused.message, /^Забагато невдалих спроб входу/);
});

test('login card says whether the password must still be set', () => {
  assert.match(loginCardNote({ hasPassword: true }), /паролем/);
  assert.match(loginCardNote({ hasPassword: false }), /встановити пароль/);
});

test('every gate module points to an element that exists on the start screen', async () => {
  const html = await read('index.html');
  for (const module of GATE_MODULES) {
    assert.equal(module.cards.length, module.modules.length, `${module.id}: одна картка на модуль`);
    module.cards.forEach((card, index) => {
      const attr = card.match(/\[([\w-]+)="([^"]+)"\]/);
      assert.ok(attr, `${module.id}: card selector`);
      assert.ok(html.includes(`${attr[1]}="${attr[2]}"`), `${module.id}: ${card} exists in index.html`);
      const tile = module.tiles?.[index];
      if (tile) assert.ok(html.includes(`id="${tile.slice(1)}"`), `${module.id}: ${tile} exists`);
    });
  }
});

test('«Забули пароль?»: code and the new password twice are checked before the core is asked', () => {
  assert.deepEqual(validateRecoveryStep({ code: ' ', password: 'пароль-1', confirm: 'пароль-1' }), { code: 'Введіть код відновлення.' });
  assert.deepEqual(validateRecoveryStep({ code: 'КОД', password: '12345', confirm: '12345' }), { password: passwordError('12345') });
  assert.deepEqual(validateRecoveryStep({ code: 'КОД', password: 'пароль-1', confirm: 'пароль-2' }), { confirm: 'Паролі не збігаються.' });
  assert.deepEqual(validateRecoveryStep({ code: 'КОД', password: 'пароль-1', confirm: 'пароль-1' }), {});
  assert.match(recoveryFailure('у профілю немає захищеної бібліотеки'), /^У цього профілю немає бібліотеки «Робочого середовища»/);
  assert.equal(recoveryFailure('код відновлення не підходить до бібліотеки цього профілю'), 'Не вдалося відновити доступ: код відновлення не підходить до бібліотеки цього профілю');
});

test('sign-in screen offers «Забули пароль?» for a protected profile and signs in after the new code', async () => {
  const code = await read('profile-gate.js');
  assert.match(code, /needsPassword \? null : el\('div', \{ class: 'ew-gate-foot' \},\s*el\('button', \{ type: 'button', class: 'ew-gate-link', text: 'Забули пароль\?'/);
  assert.match(code, /recovering && selected\.hasPassword \? recoveryForm\(\) : loginForm\(\)/);
  assert.match(code, /await recoverProfileWithCode\(selected\.id, code\.value\.trim\(\), password\.value\)/);
  assert.match(code, /showNewRecoveryCode\(recovered, \(\) => resolve\('signed-in'\)\)/);
  assert.match(code, /'Я записав код — далі'/);
  assert.match(code, /Код показується лише зараз: EasyWAR його не зберігає й більше не покаже\./);
});

test('gate code stays local: no network, no storage of passwords', async () => {
  for (const file of ['profile-gate.js', 'profile-gate-core.js']) {
    const code = await read(file);
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/, `${file}: no network`);
    assert.doesNotMatch(code, /localStorage|indexedDB|document\.cookie/, `${file}: no persistent browser storage`);
  }
  assert.doesNotMatch(await read('profile-gate.js'), /sessionStorage/, 'gate does not touch sessionStorage itself');
});

test('the page behind the gate is inert and the gate sits under the splash', async () => {
  const code = await read('profile-gate.js');
  assert.match(code, /inert/);
  assert.match(code, /ew-locked/);
  const css = await read('profile-gate.css');
  assert.match(css, /z-index:\s*4000/, 'gate sits under the splash (5000)');
  assert.match(await read('startup-splash.css'), /z-index:\s*5000/);
});

test('splash skip flag survives one reload only and tolerates broken storage', () => {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  assert.equal(consumeSplashSkip(storage), false);
  requestSplashSkip(storage);
  assert.equal(data.get(SPLASH_SKIP_KEY), '1');
  assert.equal(consumeSplashSkip(storage), true);
  assert.equal(consumeSplashSkip(storage), false);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => requestSplashSkip(broken));
  assert.equal(consumeSplashSkip(broken), false);
});

test('splash leaves the launcher inert while the gate is locked', async () => {
  const code = await read('startup-splash.js');
  assert.match(code, /consumeSplashSkip\(\)/);
  assert.match(code, /ew-locked/);
});
