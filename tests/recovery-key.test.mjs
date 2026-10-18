import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  KEY_SCREEN_TEXT,
  RECOVERY_ALPHABET,
  RECOVERY_KEY_GROUP,
  RECOVERY_KEY_PLACEHOLDER,
  RECOVERY_KEY_SYMBOLS,
  copyRecoveryKey,
  formatRecoveryKey,
  noRecoveryKeyAdvice,
  normalizeRecoveryKey,
  recoveryFailureMessage,
  recoveryKeyError,
  recoveryStatusText,
  validateRecoveryForm,
} from '../src/recovery-key-core.js';
import { passwordError } from '../src/profile-gate-core.js';
import {
  issueLocalProfileRecoveryKey,
  recoverLocalProfilePassword,
  registerLocalProfile,
} from '../src/local-profiles-core.js';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const readRust = () => readFile(new URL('../src-tauri/src/local_profiles.rs', import.meta.url), 'utf8');
// Кириличні двійники й тире задано кодами символів: на око їх не відрізнити від латинських.
const cp = (...codes) => String.fromCodePoint(...codes);

const CANONICAL = 'ABCDEFGHJKMNPQRSTVWXYZ012';
const PRETTY = 'ABCDE-FGHJK-MNPQR-STVWX-YZ012';

test('alphabet has 32 unambiguous symbols; a key is 25 of them in groups of five', () => {
  assert.equal(RECOVERY_ALPHABET.length, 32);
  assert.equal(new Set(RECOVERY_ALPHABET).size, 32);
  for (const banned of 'ILOU') assert.ok(!RECOVERY_ALPHABET.includes(banned), banned);
  assert.equal(RECOVERY_KEY_SYMBOLS, 25);
  assert.equal(RECOVERY_KEY_GROUP, 5);
  assert.match(RECOVERY_KEY_PLACEHOLDER, /^(X{5}-){4}X{5}$/);
});

test('the JS rules match the Rust core: alphabet, size and lookalike letters', async () => {
  const rust = await readRust();
  assert.equal(rust.match(/const RECOVERY_ALPHABET: &\[u8; 32\] = b"([^"]+)";/)?.[1], RECOVERY_ALPHABET);
  assert.equal(Number(rust.match(/const RECOVERY_KEY_SYMBOLS: usize = (\d+);/)?.[1]), RECOVERY_KEY_SYMBOLS);
  assert.equal(Number(rust.match(/const RECOVERY_KEY_GROUP: usize = (\d+);/)?.[1]), RECOVERY_KEY_GROUP);

  const block = rust.match(/const RECOVERY_LOOKALIKES: \[\(char, char\); \d+\] = \[([\s\S]*?)\];/)?.[1];
  assert.ok(block, 'RECOVERY_LOOKALIKES found in local_profiles.rs');
  const pairs = [...block.matchAll(/\('\\u\{([0-9A-Fa-f]+)\}', '(.)'\)/g)]
    .map(([, code, latin]) => [parseInt(code, 16), latin]);
  assert.equal(pairs.length, 12);
  for (const [code, latin] of pairs) {
    assert.equal(
      normalizeRecoveryKey(cp(code).repeat(RECOVERY_KEY_SYMBOLS)),
      latin.repeat(RECOVERY_KEY_SYMBOLS),
      `U+${code.toString(16)} -> ${latin}`,
    );
  }
  // Інші кириличні літери ключем бути не можуть.
  for (const other of [0x0416, 0x0414, 0x0423, 0x0431]) {
    assert.equal(normalizeRecoveryKey(cp(other).repeat(RECOVERY_KEY_SYMBOLS)), null, `U+${other.toString(16)}`);
  }
});

test('input is normalised like in the core: case, spaces, dashes, 1/0 lookalikes', () => {
  assert.equal(normalizeRecoveryKey(PRETTY), CANONICAL);
  assert.equal(normalizeRecoveryKey(`  abcde fghjk${cp(0x2013)}mnpqr_stvwx-yz012 `), CANONICAL);
  assert.equal(normalizeRecoveryKey(`ABCDE${cp(0x2010)}FGHJK${cp(0x2212)}MNPQR${cp(0x2014)}STVWX${cp(0x2015)}YZ012`), CANONICAL);
  assert.equal(normalizeRecoveryKey('ABCDE-FGHJK-MNPQR-STVWX-YZOIL'), 'ABCDEFGHJKMNPQRSTVWXYZ011');
  assert.equal(normalizeRecoveryKey(`ABCDE${cp(0x2028)}FGHJK\tMNPQR\nSTVWX YZ012`), CANONICAL);
});

test('Cyrillic lookalikes typed on a Ukrainian layout are read as Latin letters', () => {
  const typed = `${cp(0x410, 0x412, 0x421)}D${cp(0x415)}-FG${cp(0x41d)}JK-${cp(0x41c)}NPQR-S${cp(0x422)}VW${cp(0x425)}-YZ${cp(0x41e)}1${cp(0x406)}`;
  assert.equal(normalizeRecoveryKey(typed), 'ABCDEFGHJKMNPQRSTVWXYZ011');
  // малі кириличні літери теж
  assert.equal(normalizeRecoveryKey(typed.toLowerCase()), 'ABCDEFGHJKMNPQRSTVWXYZ011');
});

test('wrong length, the letter U and foreign symbols are rejected', () => {
  assert.equal(normalizeRecoveryKey(''), null);
  assert.equal(normalizeRecoveryKey(null), null);
  assert.equal(normalizeRecoveryKey(undefined), null);
  assert.equal(normalizeRecoveryKey('ABCDE-FGHJK-MNPQR-STVWX-YZ01'), null);
  assert.equal(normalizeRecoveryKey('ABCDE-FGHJK-MNPQR-STVWX-YZ0123'), null);
  assert.equal(normalizeRecoveryKey('ABCDE-FGHJK-MNPQR-STVWX-YZ01U'), null);
  assert.equal(normalizeRecoveryKey('ABCDE-FGHJK-MNPQR-STVWX-YZ01!'), null);
  assert.equal(normalizeRecoveryKey(`ABCDE-FGHJK-MNPQR-STVWX-YZ01${cp(0x416)}`), null);
  assert.equal(normalizeRecoveryKey('ABCDE-FGHJK-MNPQR-STVWX-YZ01😀'), null);
});

test('the key is shown in groups of five and unknown input is left alone', () => {
  assert.equal(formatRecoveryKey(CANONICAL), PRETTY);
  assert.equal(formatRecoveryKey('abcde fghjk mnpqr stvwx yz012'), PRETTY);
  assert.equal(formatRecoveryKey('не ключ'), 'не ключ');
  assert.equal(formatRecoveryKey(null), '');
});

test('key field errors are short Ukrainian messages with an example', () => {
  assert.equal(recoveryKeyError(PRETTY), null);
  assert.equal(recoveryKeyError('   '), 'Введіть ключ відновлення.');
  assert.equal(recoveryKeyError(''), 'Введіть ключ відновлення.');
  assert.match(recoveryKeyError('ABC'), /25 символів/);
  assert.ok(recoveryKeyError('ABC').includes(RECOVERY_KEY_PLACEHOLDER));
});

test('the reset form checks the key, the new password and the repeat', () => {
  const good = { recoveryKey: PRETTY, password: 'новий-пароль', confirm: 'новий-пароль' };
  assert.deepEqual(validateRecoveryForm(good, passwordError), {});
  assert.deepEqual(Object.keys(validateRecoveryForm({ ...good, recoveryKey: '' }, passwordError)), ['recoveryKey']);
  assert.deepEqual(Object.keys(validateRecoveryForm({ ...good, recoveryKey: 'ABC' }, passwordError)), ['recoveryKey']);
  const weak = validateRecoveryForm({ ...good, password: '123', confirm: '123' }, passwordError);
  assert.deepEqual(Object.keys(weak), ['password']);
  assert.match(weak.password, /щонайменше 6/);
  assert.deepEqual(Object.keys(validateRecoveryForm({ ...good, confirm: 'інший-пароль' }, passwordError)), ['confirm']);
  // кілька помилок одразу; повтор перевіряється лише для чинного пароля
  assert.deepEqual(
    Object.keys(validateRecoveryForm({ recoveryKey: '', password: '1', confirm: '2' }, passwordError)).sort(),
    ['password', 'recoveryKey'],
  );
});

test('profile settings say whether a recovery key exists', () => {
  assert.equal(recoveryStatusText({ hasRecoveryKey: true }), 'Створено');
  assert.match(recoveryStatusText({ hasRecoveryKey: false }), /^Не створено/);
  assert.match(recoveryStatusText({}), /відновити не вдасться/);
  assert.match(recoveryStatusText(null), /^Не створено/);
});

test('a profile without a key gets an honest explanation and a way forward', () => {
  const advice = noRecoveryKeyAdvice({ displayName: 'Тестовий Оператор' });
  assert.match(advice.lead, /«Тестовий Оператор»/);
  assert.match(advice.lead, /неможливо/);
  assert.match(advice.next, /Додати користувача/);
  assert.match(advice.next, /лишаться на диску/);
  assert.match(noRecoveryKeyAdvice(null).lead, /цього профілю/);
});

test('core errors become short messages; unknown errors keep their text', () => {
  assert.equal(recoveryFailureMessage('неправильний ключ відновлення'), 'Неправильний ключ відновлення.');
  assert.equal(recoveryFailureMessage(new Error('неправильний ключ відновлення')), 'Неправильний ключ відновлення.');
  assert.equal(
    recoveryFailureMessage('для цього профілю ключ відновлення не створювали'),
    'Для цього профілю ключ відновлення не створювали.',
  );
  assert.match(recoveryFailureMessage('пароль має містити від 6 до 128 символів'), /^Не вдалося відновити доступ: пароль/);
  assert.match(recoveryFailureMessage(undefined), /^Не вдалося відновити доступ/);
});

test('key screen texts warn that the key is shown once and must be kept apart', () => {
  assert.match(KEY_SCREEN_TEXT.lead, /один раз/);
  assert.match(KEY_SCREEN_TEXT.lead, /папері/);
  assert.match(KEY_SCREEN_TEXT.warning, /не кладіть поруч із таблицями/);
  assert.match(KEY_SCREEN_TEXT.confirm, /записав/);
  assert.match(KEY_SCREEN_TEXT.copied, /буфер/);
});

test('copying never throws: it reports success or failure', async () => {
  const written = [];
  assert.equal(await copyRecoveryKey(PRETTY, { writeText: async text => { written.push(text); } }), true);
  assert.deepEqual(written, [PRETTY]);
  assert.equal(await copyRecoveryKey(PRETTY, { writeText: async () => { throw new Error('denied'); } }), false);
  assert.equal(await copyRecoveryKey(PRETTY, { writeText() { throw new Error('sync'); } }), false);
  assert.equal(await copyRecoveryKey(PRETTY, {}), false);
  assert.equal(await copyRecoveryKey(PRETTY, null), false);
});

test('IPC wrappers call the new commands with the arguments the core expects', async () => {
  const calls = [];
  const invoke = async (command, args) => { calls.push([command, args]); return { state: { profiles: [] }, recoveryKey: PRETTY }; };

  const issued = await issueLocalProfileRecoveryKey('profile-1', 'пароль-1', invoke);
  assert.equal(issued.recoveryKey, PRETTY);
  const recovered = await recoverLocalProfilePassword('profile-1', PRETTY, 'новий-пароль', invoke);
  assert.equal(recovered.recoveryKey, PRETTY);
  await registerLocalProfile({ displayName: 'Тест', password: 'пароль-1', modules: ['air'] }, invoke);

  assert.deepEqual(calls[0], ['issue_local_profile_recovery_key', { profileId: 'profile-1', currentPassword: 'пароль-1' }]);
  assert.deepEqual(calls[1], ['recover_local_profile_password', { profileId: 'profile-1', recoveryKey: PRETTY, newPassword: 'новий-пароль' }]);
  assert.equal(calls[2][0], 'register_local_profile');
});

test('Rust command names and argument names match the JS wrappers', async () => {
  const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const issue = lib.match(/async fn issue_local_profile_recovery_key\(([\s\S]*?)\) -> Result<RecoveryKeyIssued/)?.[1];
  const recover = lib.match(/async fn recover_local_profile_password\(([\s\S]*?)\) -> Result<RecoveryKeyIssued/)?.[1];
  assert.ok(issue && recover, 'both commands exist and return RecoveryKeyIssued');
  for (const name of ['profile_id', 'current_password']) assert.ok(issue.includes(`${name}: String`), `issue: ${name}`);
  for (const name of ['profile_id', 'recovery_key', 'new_password']) assert.ok(recover.includes(`${name}: String`), `recover: ${name}`);
  assert.match(lib, /\n\s+issue_local_profile_recovery_key,/, 'issue command registered');
  assert.match(lib, /\n\s+recover_local_profile_password,/, 'recover command registered');
  const rust = await readRust();
  assert.match(rust, /pub struct RecoveryKeyIssued[\s\S]{0,80}pub state: LocalProfilesState,\s*pub recovery_key: String/);
  assert.match(rust, /#\[serde\(rename_all = "camelCase"\)\]\s*pub struct RecoveryKeyIssued/);
});

test('recovery code stays local, keeps no key in storage and spells lookalikes as code points', async () => {
  const core = await read('recovery-key-core.js');
  assert.doesNotMatch(core, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/, 'no network');
  assert.doesNotMatch(core, /localStorage|sessionStorage|indexedDB|document\.cookie/, 'no browser storage');
  const code = core.split('\n').filter(line => /LOOKALIKES|SEPARATORS|'\\u/.test(line)).join('\n');
  assert.doesNotMatch(code, /[\u0400-\u04ff\u2010-\u2015\u2212]/u, 'no literal Cyrillic or dash lookalikes in code lines');
  assert.match(core, /\\u0410/);
  assert.match(core, /\\u2010-\\u2015\\u2212/);
});

test('the gate offers recovery on the login screen, in registration and for old profiles', async () => {
  const gate = await read('profile-gate.js');
  assert.match(gate, /Забули пароль\?/);
  assert.match(gate, /recoverLocalProfilePassword\(/);
  assert.match(gate, /issueLocalProfileRecoveryKey\(/);
  assert.match(gate, /const steps = \['Профіль', 'Модулі', 'Ключ', 'Таблиці'\]/);
  assert.match(gate, /const \{ state, recoveryKey \} = await registerLocalProfile\(/);
  assert.match(gate, /selected\.hasRecoveryKey/, 'a profile without a key is explained, not asked for one');
  assert.match(gate, /!profile\.hasRecoveryKey/, 'a profile without a key is offered one after sign-in');
  assert.doesNotMatch(gate, /відновити неможливо/, 'the old "no recovery" hint is gone');
});

test('the gate never keeps the recovery key anywhere but on the screen', async () => {
  const gate = await read('profile-gate.js');
  assert.doesNotMatch(gate, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(gate, /console\.(log|info|debug|warn)\([^)]*(recoveryKey|password)/i);
  const settings = await read('local-profiles.js');
  assert.doesNotMatch(settings, /console\.(log|info|debug|warn)\([^)]*(recoveryKey|password)/i);
  assert.match(settings, /issueLocalProfileRecoveryKey\(/);
  assert.match(settings, /Створити ключ відновлення…/);
  assert.match(settings, /Новий ключ відновлення…/);
  assert.match(settings, /dialog\.addEventListener\('cancel', event => event\.preventDefault\(\)\)/, 'the key dialog ignores Esc');
});
