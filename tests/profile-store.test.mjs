// Клієнт даних профілю (src/workspace/profile-store.js): режими, перевірка ключів, перенесення старих даних.
// Лише синтетичні значення; Tauri замінює проста імітація команд profile_data_*.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProfileStoreError, createProfileStore, isValidKey, loadText, migrateLegacy, namespaceOf, safeLocalStorage,
} from '../src/workspace/profile-store.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(name) { return this.map.has(name) ? this.map.get(name) : null; }
  setItem(name, value) { this.map.set(name, String(value)); }
  removeItem(name) { this.map.delete(name); }
}

/** Імітація Rust-команд: те саме, що бачить застосунок, але в пам'яті. */
function fakeInvoke({ failWith = null } = {}) {
  const records = new Map();
  const calls = [];
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (failWith) throw failWith;
    switch (command) {
      case 'profile_data_get': {
        const value = records.get(args.key);
        return value === undefined ? null : { key: args.key, value, modified: '2026-10-30T10:00:00Z' };
      }
      case 'profile_data_set': records.set(args.key, args.value); return '2026-10-30T10:00:00Z';
      case 'profile_data_remove': return records.delete(args.key);
      case 'profile_data_list':
        return [...records.entries()]
          .filter(([key]) => key.startsWith(args.prefix || ''))
          .map(([key, value]) => ({ key, modified: '2026-10-30T10:00:00Z', size: value.length }));
      default: throw new Error(`невідома команда ${command}`);
    }
  };
  return { invoke, calls, records };
}

test('ключі: «простір.назва», латиниця в нижньому регістрі', () => {
  for (const good of ['easyfly.main', 'weather.state', 'rocket.firecrews', 'sun.state', 'a.b', 'easyfly.doc-1_x']) {
    assert.equal(isValidKey(good), true, good);
  }
  for (const bad of ['', 'easyfly', 'easyfly.', '.main', 'Easyfly.main', 'easyfly..', 'easy fly.main', 'easyfly/main', '../x.y', 'а.б', null, undefined, 42, 'a.'.padEnd(81, 'b')]) {
    assert.equal(isValidKey(bad), false, String(bad));
  }
  assert.equal(namespaceOf('easyfly.main.sub'), 'easyfly');
});

test('режим визначається за наявністю invoke і сховища', () => {
  assert.equal(createProfileStore({ invoke: fakeInvoke().invoke }).mode, 'profile');
  assert.equal(createProfileStore({ storage: new MemoryStorage() }).mode, 'browser');
  assert.equal(createProfileStore({}).mode, 'none');
  assert.equal(createProfileStore({ invoke: fakeInvoke().invoke, storage: new MemoryStorage() }).mode, 'profile', 'Tauri важливіший за сховище браузера');
  assert.equal(createProfileStore({}).available, false);
  assert.equal(createProfileStore({ storage: new MemoryStorage() }).available, true);
});

test('режим профілю: читання, запис, видалення й перелік ідуть командами Rust', async () => {
  const { invoke, calls, records } = fakeInvoke();
  const store = createProfileStore({ invoke });
  assert.equal(await store.read('easyfly.main'), null);
  await store.write('easyfly.main', '{"a":1}');
  await store.write('weather.state', '{"b":2}');
  assert.equal(records.get('easyfly.main'), '{"a":1}');
  assert.equal((await store.read('easyfly.main')).value, '{"a":1}');
  assert.deepEqual(await store.readJson('easyfly.main'), { a: 1 });
  assert.deepEqual((await store.list('easyfly.')).map(item => item.key), ['easyfly.main']);
  assert.equal((await store.list()).length, 2);
  assert.equal(await store.remove('easyfly.main'), true);
  assert.equal(await store.remove('easyfly.main'), false);
  assert.deepEqual(calls.map(([command]) => command).slice(0, 3), ['profile_data_get', 'profile_data_set', 'profile_data_set']);
  assert.deepEqual(calls[0][1], { key: 'easyfly.main' });
});

test('режим профілю: помилку Rust перетворено на ProfileStoreError з текстом причини', async () => {
  const store = createProfileStore({ invoke: fakeInvoke({ failWith: 'профіль не розблоковано' }).invoke });
  await assert.rejects(() => store.read('easyfly.main'), error => error instanceof ProfileStoreError && error.message === 'профіль не розблоковано');
  await assert.rejects(() => store.write('easyfly.main', 'x'), ProfileStoreError);
  const withObject = createProfileStore({ invoke: fakeInvoke({ failWith: new Error('диск заповнений') }).invoke });
  await assert.rejects(() => withObject.write('easyfly.main', 'x'), /диск заповнений/);
});

test('некоректні ключі й порожні значення відхиляються до звернення до Rust', async () => {
  const { invoke, calls } = fakeInvoke();
  const store = createProfileStore({ invoke });
  await assert.rejects(() => store.read('easyfly'), ProfileStoreError);
  await assert.rejects(() => store.write('Easyfly.main', 'x'), ProfileStoreError);
  await assert.rejects(() => store.write('easyfly.main', ''), ProfileStoreError);
  await assert.rejects(() => store.write('easyfly.main', null), ProfileStoreError);
  await assert.rejects(() => store.remove('../x.y'), ProfileStoreError);
  assert.equal(calls.length, 0);
});

test('браузерний режим: окремий префікс, перелік за префіксом, видалення', async () => {
  const storage = new MemoryStorage();
  storage.setItem('чужий-ключ', 'не чіпати');
  const store = createProfileStore({ storage, now: () => '2026-10-30T10:00:00Z' });
  assert.equal(await store.read('sun.state'), null);
  assert.equal(await store.write('sun.state', '{"x":1}'), '2026-10-30T10:00:00Z');
  await store.write('weather.state', '{"y":1}');
  assert.deepEqual(await store.readJson('sun.state'), { x: 1 });
  assert.deepEqual((await store.list('sun.')).map(item => item.key), ['sun.state']);
  assert.deepEqual((await store.list()).map(item => item.key), ['sun.state', 'weather.state']);
  assert.equal(await store.remove('sun.state'), true);
  assert.equal(await store.remove('sun.state'), false);
  assert.equal(storage.getItem('чужий-ключ'), 'не чіпати');
});

test('браузерний режим: переповнене сховище дає зрозумілу помилку, пошкоджений запис — null', async () => {
  const full = { length: 0, key: () => null, getItem: () => null, removeItem() {}, setItem() { throw new Error('quota'); } };
  await assert.rejects(() => createProfileStore({ storage: full }).write('sun.state', 'x'), /переповнене/);
  const storage = new MemoryStorage();
  storage.setItem('easywar.profile.v1:sun.state', '{не json');
  assert.equal(await createProfileStore({ storage }).read('sun.state'), null);
});

test('режим «none»: читання порожнє, запис — помилка, а не мовчазна втрата', async () => {
  const store = createProfileStore({});
  assert.equal(await store.read('sun.state'), null);
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.remove('sun.state'), false);
  await assert.rejects(() => store.write('sun.state', 'x'), /недоступне/);
});

test('readJson: пошкоджений текст дає null і не видаляється', async () => {
  const { invoke, records } = fakeInvoke();
  const store = createProfileStore({ invoke });
  await store.write('easyfly.main', '{не json');
  assert.equal(await store.readJson('easyfly.main'), null);
  assert.equal(records.get('easyfly.main'), '{не json');
});

test('перенесення: старе значення потрапляє в профіль і лише потім зникає зі сторінки', async () => {
  const { invoke, records } = fakeInvoke();
  const store = createProfileStore({ invoke });
  const legacy = new MemoryStorage();
  legacy.setItem('easywar.weather.v1', '{"places":["Тест"]}');
  assert.equal(await migrateLegacy(store, { key: 'weather.state', legacyStorage: legacy, legacyKey: 'easywar.weather.v1' }), 'migrated');
  assert.equal(records.get('weather.state'), '{"places":["Тест"]}');
  assert.equal(legacy.getItem('easywar.weather.v1'), null);
  assert.equal(await migrateLegacy(store, { key: 'weather.state', legacyStorage: legacy, legacyKey: 'easywar.weather.v1' }), 'none');
});

test('перенесення: якщо в профілі вже є дані, вони не перезаписуються, а залишок прибирається', async () => {
  const { invoke, records } = fakeInvoke();
  const store = createProfileStore({ invoke });
  await store.write('weather.state', '{"places":["Нове"]}');
  const legacy = new MemoryStorage();
  legacy.setItem('old', '{"places":["Старе"]}');
  assert.equal(await migrateLegacy(store, { key: 'weather.state', legacyStorage: legacy, legacyKey: 'old' }), 'present');
  assert.equal(records.get('weather.state'), '{"places":["Нове"]}');
  assert.equal(legacy.getItem('old'), null);
});

test('перенесення: коли профіль недоступний, старе значення лишається на місці', async () => {
  const store = createProfileStore({ invoke: fakeInvoke({ failWith: 'профіль заблоковано' }).invoke });
  const legacy = new MemoryStorage();
  legacy.setItem('old', '{"keep":true}');
  assert.equal(await migrateLegacy(store, { key: 'weather.state', legacyStorage: legacy, legacyKey: 'old' }), 'failed');
  assert.equal(legacy.getItem('old'), '{"keep":true}');
});

test('перенесення: запис, що не читається назад так само, не вважається перенесеним', async () => {
  const { invoke } = fakeInvoke();
  const lossy = async (command, args) => (command === 'profile_data_set' ? invoke(command, { ...args, value: args.value.slice(1) }) : invoke(command, args));
  const store = createProfileStore({ invoke: lossy });
  const legacy = new MemoryStorage();
  legacy.setItem('old', '{"keep":true}');
  assert.equal(await migrateLegacy(store, { key: 'weather.state', legacyStorage: legacy, legacyKey: 'old' }), 'failed');
  assert.equal(legacy.getItem('old'), '{"keep":true}');
});

test('перенесення: значення, яке не пройшло перевірку accept, не переноситься', async () => {
  const { invoke, records } = fakeInvoke();
  const store = createProfileStore({ invoke });
  const legacy = new MemoryStorage();
  legacy.setItem('old', 'сміття');
  assert.equal(await migrateLegacy(store, { key: 'weather.state', legacyStorage: legacy, legacyKey: 'old', accept: text => text.startsWith('{') }), 'none');
  assert.equal(records.size, 0);
  assert.equal(legacy.getItem('old'), 'сміття');
});

test('перенесення: без сховища профілю або без старого сховища нічого не робиться', async () => {
  assert.equal(await migrateLegacy(createProfileStore({}), { key: 'a.b', legacyStorage: new MemoryStorage(), legacyKey: 'x' }), 'none');
  assert.equal(await migrateLegacy(createProfileStore({ invoke: fakeInvoke().invoke }), { key: 'a.b', legacyStorage: null, legacyKey: 'x' }), 'none');
});

test('loadText: повертає текст із профілю, переносячи старе значення, або причину недоступності', async () => {
  const { invoke } = fakeInvoke();
  const store = createProfileStore({ invoke });
  assert.deepEqual(await loadText(store, { key: 'sun.state' }), { text: null, error: null });
  const legacy = new MemoryStorage();
  legacy.setItem('old', '{"v":1}');
  assert.deepEqual(await loadText(store, { key: 'sun.state', legacyStorage: legacy, legacyKey: 'old' }), { text: '{"v":1}', error: null });
  assert.equal(legacy.getItem('old'), null);

  const broken = createProfileStore({ invoke: fakeInvoke({ failWith: 'профіль заблоковано' }).invoke });
  assert.deepEqual(await loadText(broken, { key: 'sun.state' }), { text: null, error: 'профіль заблоковано' });
  assert.deepEqual(await loadText(createProfileStore({}), { key: 'sun.state' }), { text: null, error: null });
});

test('safeLocalStorage: повертає сховище, якщо воно працює, і null, якщо воно кидає помилку або відсутнє', () => {
  const storage = new MemoryStorage();
  assert.equal(safeLocalStorage({ localStorage: storage }), storage);
  assert.equal(storage.length, 0, 'пробний запис прибрано');
  assert.equal(safeLocalStorage({}), null);
  assert.equal(safeLocalStorage(undefined), null);
  assert.equal(safeLocalStorage({ get localStorage() { throw new Error('заборонено'); } }), null);
  assert.equal(safeLocalStorage({ localStorage: { setItem() { throw new Error('quota'); }, removeItem() {} } }), null);
});
