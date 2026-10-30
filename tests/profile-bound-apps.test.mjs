// Застосунки «Робочого середовища», дані яких належать профілю: ключі збігаються з id застосунку (інакше вікно
// редактора не побачить власні дані — Rust пускає його лише в простір імен відкритого застосунку), застосунки
// не тримають даних у сховищі браузера й не відкривають файл самі при запуску. Лише текстові контракти.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { opensInEditorWindow } from '../src/workspace/workspace-core.js';
import { PROFILE_KEY as WEATHER_KEY } from '../src/workspace/weather/weather-core.js';
import { SUN_PROFILE_KEY } from '../src/workspace/sun/sun-view-core.js';
import { isValidKey, namespaceOf } from '../src/workspace/profile-store.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('ключі даних профілю коректні, а простір імен збігається з id застосунку', async () => {
  const easyfly = /const STORE_KEY = '([^']+)'/.exec(await read('src/workspace/easyfly/app.js'))?.[1];
  const easypay = /const PROFILE_KEY = '([^']+)'/.exec(await read('src/workspace/easypay/easypay-ui.js'))?.[1];
  const expected = { easyfly, easypay, sun: SUN_PROFILE_KEY, weather: WEATHER_KEY };
  for (const [app, key] of Object.entries(expected)) {
    assert.ok(isValidKey(key), `${app}: ключ «${key}»`);
    assert.equal(namespaceOf(key), app, `${app}: простір імен ключа «${key}»`);
  }
  assert.equal(new Set(Object.values(expected)).size, 4, 'ключі різні');
});

test('застосунки, що відкриваються у вікні редактора, мають доступ лише до свого простору імен', () => {
  // EasyFLY і easyPay працюють у вікні редактора: їхні ключі мають бути в просторі «easyfly.» і «easypay.».
  assert.equal(opensInEditorWindow('easyfly'), true);
  assert.equal(opensInEditorWindow('easypay'), true);
  // «Сонце і Місяць» і «Погода» — у головному вікні, де доступні всі ключі профілю.
  assert.equal(opensInEditorWindow('sun'), false);
  assert.equal(opensInEditorWindow('weather'), false);
});

test('застосунки не пишуть дані у сховище браузера й не гублять помилки запису', async () => {
  for (const file of ['src/workspace/easyfly/app.js', 'src/workspace/easypay/easypay-ui.js', 'src/workspace/sun/app.js', 'src/workspace/weather/app.js']) {
    const text = await read(file);
    assert.doesNotMatch(text, /\blocalStorage\.(setItem|getItem)|sessionStorage|indexedDB/, `${file}: дані лише через host.profile`);
    assert.match(text, /host\.profile|profile\.write/, `${file}: використовує host.profile`);
  }
  const easyfly = await read('src/workspace/easyfly/app.js');
  assert.match(easyfly, /Не вдалося зберегти/, 'EasyFLY повідомляє про помилку запису');
  const easypay = await read('src/workspace/easypay/easypay-ui.js');
  assert.match(easypay, /Не вдалося зберегти журнал у профілі/, 'easyPay повідомляє про помилку запису');
  assert.match(easypay, /Він не буде перезаписаний/, 'easyPay не перезаписує те, що не вдалося прочитати');
});

test('хост передає застосунку клієнта профілю, а Tauri важливіший за сховище браузера', async () => {
  const host = await read('src/workspace/workspace-host.js');
  assert.match(host, /createProfileStore\(\{ invoke, storage: invoke \? null : profileStorage \}\)/);
  assert.match(host, /\bprofile,/, 'host.profile виставлено');
  const frame = await read('src/workspace/app-frame.js');
  assert.match(frame, /profileStorage: safeLocalStorage\(window\)/);
});

test('команди даних профілю не приймають пароль чи id профілю з вікна: профіль бере Rust із сесії', async () => {
  const lib = await read('src-tauri/src/lib.rs');
  for (const name of ['profile_data_get', 'profile_data_set', 'profile_data_remove', 'profile_data_list', 'profile_data_status']) {
    const body = lib.slice(lib.indexOf(`fn ${name}(`)).split('\n#[tauri::command]')[0];
    assert.doesNotMatch(body, /password: String|profile_id: String/, name);
  }
});
