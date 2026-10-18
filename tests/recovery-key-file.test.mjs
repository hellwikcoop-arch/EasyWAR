import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  KEY_SCREEN_TEXT,
  failureSentence,
  keyFileSavedMessage,
  loadRecoveryKeyFromFile,
  saveRecoveryKeyToFile,
} from '../src/recovery-key-core.js';
import { readRecoveryKeyFile, saveRecoveryKeyFile } from '../src/local-profiles-core.js';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const readRustFile = name => readFile(new URL(`../src-tauri/src/${name}`, import.meta.url), 'utf8');

// Синтетичний ключ: лише для тестів, жодного профілю не відкриває.
const PRETTY = 'ABCDE-FGHJK-MNPQR-STVWX-YZ012';
const PATH = 'E:\\Флешка\\EasyWAR_ключ_Тест.txt';

test('core errors become sentences: capital letter and a full stop', () => {
  assert.equal(failureSentence('у файлі не знайдено ключа відновлення'), 'У файлі не знайдено ключа відновлення.');
  assert.equal(failureSentence(new Error('не вдалося записати файл: диск захищено від запису')), 'Не вдалося записати файл: диск захищено від запису.');
  assert.equal(failureSentence('Уже з крапкою.'), 'Уже з крапкою.');
  assert.equal(failureSentence('Питання?'), 'Питання?');
  assert.equal(failureSentence('  з пробілами  '), 'З пробілами.');
  assert.equal(failureSentence(''), 'Не вдалося виконати дію.');
  assert.equal(failureSentence(undefined), 'Не вдалося виконати дію.');
});

test('the saved message names the file and says the write was read back', () => {
  const message = keyFileSavedMessage(PATH);
  assert.ok(message.includes(PATH));
  assert.match(message, /перевірено читанням/);
  assert.ok(!message.includes(PRETTY), 'a message never repeats the key');
});

test('saving to a file reports the path, a closed dialog or a failure — and never throws', async () => {
  const saved = await saveRecoveryKeyToFile(async () => PATH);
  assert.equal(saved.saved, true);
  assert.equal(saved.message, keyFileSavedMessage(PATH));

  const closed = await saveRecoveryKeyToFile(async () => null);
  assert.deepEqual(closed, { saved: false, message: '' });

  const refused = await saveRecoveryKeyToFile(async () => { throw 'не вдалося записати файл: недостатньо місця'; });
  assert.equal(refused.saved, false);
  assert.equal(refused.message, 'Не вдалося записати файл: недостатньо місця.');

  const broken = await saveRecoveryKeyToFile(() => { throw new Error('синхронна помилка'); });
  assert.deepEqual(broken, { saved: false, message: 'Синхронна помилка.' });
});

test('taking the key from a file fills only a key the form would accept', async () => {
  assert.deepEqual(await loadRecoveryKeyFromFile(async () => PRETTY), { key: PRETTY, error: null });
  assert.deepEqual(await loadRecoveryKeyFromFile(async () => 'abcde fghjk mnpqr stvwx yz012'), { key: PRETTY, error: null });
  // вікно вибору закрили: нічого не змінюємо й не лаємося
  assert.deepEqual(await loadRecoveryKeyFromFile(async () => null), { key: null, error: null });
  assert.deepEqual(await loadRecoveryKeyFromFile(async () => ''), { key: null, error: null });
  // ядро повернуло те, що не є ключем: у поле нічого не потрапляє
  const odd = await loadRecoveryKeyFromFile(async () => 'не ключ');
  assert.equal(odd.key, null);
  assert.match(odd.error, /немає чинного ключа/);
  // помилки ядра показуємо як є
  const bad = await loadRecoveryKeyFromFile(async () => { throw 'у файлі кілька різних ключів: залиште один'; });
  assert.deepEqual(bad, { key: null, error: 'У файлі кілька різних ключів: залиште один.' });
});

test('IPC wrappers call the file commands with the arguments the core expects', async () => {
  const calls = [];
  const invoke = async (command, args) => { calls.push([command, args]); return null; };
  await saveRecoveryKeyFile('profile-1', PRETTY, invoke);
  await readRecoveryKeyFile(invoke);
  assert.deepEqual(calls[0], ['save_recovery_key_file', { profileId: 'profile-1', recoveryKey: PRETTY }]);
  assert.deepEqual(calls[1], ['read_recovery_key_file', undefined]);
});

test('Rust commands for the key file exist, are registered and need what they should', async () => {
  const lib = await readRustFile('lib.rs');
  const save = lib.match(/async fn save_recovery_key_file\(([\s\S]*?)\) -> Result<Option<String>, String>\s*\{([\s\S]*?)\n\}\n/);
  const pick = lib.match(/async fn read_recovery_key_file\(([\s\S]*?)\) -> Result<Option<String>, String>\s*\{([\s\S]*?)\n\}\n/);
  assert.ok(save && pick, 'both commands exist and return an optional string');
  for (const name of ['profile_id', 'recovery_key']) assert.ok(save[1].includes(`${name}: String`), `save: ${name}`);
  assert.match(save[2], /ensure_profile_unlocked\(/, 'the key is written only for an unlocked profile');
  assert.match(save[2], /recovery_key_file::file_text\([\s\S]*?blocking_save_file\(\)/, 'the text is checked before the dialog opens');
  assert.match(save[2], /recovery_key_file::write_file\(/);
  assert.match(pick[2], /blocking_pick_file\(\)/);
  assert.match(pick[2], /recovery_key_file::read_key\(/);
  assert.doesNotMatch(pick[1], /profile_id|session/, 'reading a key from a file needs no profile or session: the password is forgotten');
  assert.match(lib, /\n\s+save_recovery_key_file,/, 'save command registered');
  assert.match(lib, /\n\s+read_recovery_key_file,/, 'read command registered');
  assert.match(lib, /pub mod recovery_key_file;/);
});

test('the Rust file module logs nothing, uses no network and holds no ready-made key', async () => {
  const rust = await readRustFile('recovery_key_file.rs');
  const code = rust.split('#[cfg(test)]')[0];
  assert.doesNotMatch(code, /println!|eprintln!|dbg!|log::|tracing::|tauri::|reqwest|TcpStream|UdpSocket/);
  assert.doesNotMatch(code, /\b[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}\b/, 'no key-shaped literal outside tests');
});

test('the instructions inside the saved file use the real button names', async () => {
  const rust = await readRustFile('recovery_key_file.rs');
  const gate = await read('profile-gate.js');
  assert.ok(rust.includes(`«${KEY_SCREEN_TEXT.fromFile}»`), 'file text names the "take key from file" button');
  assert.ok(rust.includes('«Забули пароль?»') && gate.includes('Забули пароль?'), 'file text names the "forgot password" link');
});

test('every key screen can save to a file, and the recovery form can load from one', async () => {
  const gate = await read('profile-gate.js');
  const calls = [...gate.matchAll(/(?<!function )\bkeyScreen\(\{/g)];
  assert.equal(calls.length, 4, 'registration, new key, sign-in of an old profile, password reset');
  for (const { index } of calls) {
    assert.match(gate.slice(index, index + 260), /profileId/, `keyScreen call at ${index} passes profileId`);
  }
  assert.match(gate, /saveRecoveryKeyToFile\(\(\) => saveRecoveryKeyFile\(profileId, shown\)\)/);
  assert.match(gate, /loadRecoveryKeyFromFile\(\(\) => readRecoveryKeyFile\(\)\)/);
  assert.match(gate, /KEY_SCREEN_TEXT\.saveFile/);
  assert.match(gate, /KEY_SCREEN_TEXT\.fromFile/);
  assert.match(gate, /save\.disabled = true;[\s\S]*?save\.disabled = false;/, 'no second dialog while the first is open');
  assert.match(gate, /fromFile\.disabled = true;[\s\S]*?fromFile\.disabled = false;/);
  const recoveryForm = gate.slice(gate.indexOf('function recoveryForm()'), gate.indexOf('function loginForm()'));
  assert.ok(recoveryForm.length > 500, 'recovery form found');
  assert.doesNotMatch(recoveryForm, /FileReader|type: 'file'/, 'the file dialog is the native one from the core');

  const settings = await read('local-profiles.js');
  assert.match(settings, /showRecoveryKey\(recoveryKey, profile\.id\)/);
  assert.match(settings, /saveRecoveryKeyToFile\(\(\) => saveRecoveryKeyFile\(profileId, shown\)\)/);
  assert.match(settings, /KEY_SCREEN_TEXT\.saveFile/);
});

test('the key screen texts mention the flash drive and keep the old warnings', () => {
  assert.match(KEY_SCREEN_TEXT.lead, /флешку/);
  assert.match(KEY_SCREEN_TEXT.lead, /папері/);
  assert.equal(KEY_SCREEN_TEXT.saveFile, 'Зберегти на флешку');
  assert.match(KEY_SCREEN_TEXT.fileHint, /не зашифрований/);
  assert.match(KEY_SCREEN_TEXT.fileHint, /окремо від комп’ютера/);
  assert.match(KEY_SCREEN_TEXT.warning, /не кладіть поруч із таблицями/);
});
