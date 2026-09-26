#!/usr/bin/env node
// Встановлює пароль власника для «Редактора модуля».
// У застосунок потрапляє лише сіль і хеш PBKDF2-SHA256 (src/public/module-editor-access.js), не сам пароль.
//
//   node script/set_editor_password.mjs          — запитає пароль двічі (без відображення)
//   EW_EDITOR_PASSWORD=… node script/set_editor_password.mjs
//
// Після зміни пароля зберіть застосунок наново — старі збірки й далі прийматимуть старий пароль.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const ITERATIONS = 600000;
const target = new URL('../src/public/module-editor-access.js', import.meta.url);

function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

let password = process.env.EW_EDITOR_PASSWORD;
if (!password) {
  password = await ask('Новий пароль редактора: ');
  if ((await ask('Повторіть пароль: ')) !== password) { console.error('Паролі не збігаються.'); process.exit(1); }
}
if (password.length < 10) { console.error('Пароль має містити щонайменше 10 символів.'); process.exit(1); }

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const access = { v: 1, salt: salt.toString('base64'), iterations: ITERATIONS, hash: hash.toString('base64') };
await writeFile(target, `/* EasyWAR — доступ до «Редактора модуля»: сіль і хеш PBKDF2-SHA256 пароля власника (не сам пароль).
   Змінюється командою: node script/set_editor_password.mjs */
window.EW_EDITOR_ACCESS = ${JSON.stringify(access)};
`);
console.log('Пароль редактора оновлено у src/public/module-editor-access.js. Зберіть застосунок наново.');
