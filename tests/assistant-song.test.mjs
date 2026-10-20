import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { FAVORITE_SONG_ID, songReply } from '../src/assistant/assistant-persona-core.js';
import { classifyQuery, runDialogueTurn } from '../src/assistant/assistant-dialogue-core.js';
import { SONG_LABELS, SONG_VOLUME, createSongPlayer, songButtonText } from '../src/assistant/assistant-song.js';

const index = JSON.parse(await readFile(new URL('../src/assistant/knowledge/index.json', import.meta.url), 'utf8'));
const readState = async () => ({});

test('короткі питання про улюблену пісню дають пасхалку без джерел і попереджень', () => {
  for (const query of [
    'Яка твоя улюблена пісня?', 'яка твоя улюблена пісня', 'Яка в тебе улюблена пісня?', 'ЯКА ТВОЯ УЛЮБЛЕНА ПІСНЯ???',
    'Твоя улюблена пісня?', 'Улюблена пісня комбата', 'Яку пісню ти любиш?', 'Яку мелодію ти слухаєш?',
    'Яка твоя улюблена мелодія?', 'Яка у вас улюблена композиція?', 'твій улюблений трек',
    '  Яка   твоя   улюблена   пісня  ', 'Яка твоя улюблена пісня, комбат?',
  ]) {
    const reply = songReply(query);
    assert.equal(reply?.media, FAVORITE_SONG_ID, query);
    assert.equal(reply.status, 'found');
    assert.equal(reply.origin, 'persona');
    assert.deepEqual(reply.sources, []);
    assert.deepEqual(reply.warnings, []);
  }
});

test('питання про довідку, довгі речення й чужі типи вводу не вмикають пісню', () => {
  for (const query of [
    'Як внести доповідь?', 'Де резервна копія?', 'Яка поточна версія?', 'Як відкрити профілі?', '',
    'Яка пісня?', 'Пісня', 'Що таке улюблене?', 'Як додати улюблені профілі?',
    `Поясни, як у таблиці позначити улюблену пісню у полі примітки, якщо вона довша за звичайне запитання до довідки ${'х'.repeat(40)}`,
  ]) assert.equal(songReply(query), null, query);
  for (const query of [null, undefined, 42, { text: 'улюблена пісня' }, ['улюблена пісня']]) assert.equal(songReply(query), null);
});

test('діалог маршрутизує пасхалку окремим планом і не кличе ні довідку, ні модель', async () => {
  const plan = classifyQuery('Яка твоя улюблена пісня?', []);
  assert.equal(plan.kind, 'easter');
  assert.equal(plan.easter.media, FAVORITE_SONG_ID);

  let generated = 0;
  let stateReads = 0;
  const turn = await runDialogueTurn({
    query: 'Яка твоя улюблена пісня?', history: [], index,
    readState: async () => { stateReads++; return {}; },
    generate: async () => { generated++; return 'не має викликатись'; },
  });
  assert.equal(generated, 0, 'модель не отримує питання про пісню');
  assert.equal(stateReads, 0, 'стан застосунку не читається');
  assert.equal(turn.media, FAVORITE_SONG_ID);
  assert.equal(turn.topic, 'easter');
  assert.equal(turn.mode, 'exact-fallback', 'готова відповідь без моделі');
  assert.deepEqual(turn.actions, []);
  assert.deepEqual(turn.factIds, []);
  assert.deepEqual(turn.result.sources, []);
  assert.match(turn.answer, /Слухай уважно/u);
});

test('звичайні відповіді не несуть позначки media, а пасхалка не стає темою для «Відкрий»', async () => {
  const normal = await runDialogueTurn({ query: 'Де резервна копія?', history: [], index, readState });
  assert.equal(normal.media, null);
  const egg = await runDialogueTurn({ query: 'Яка твоя улюблена пісня?', history: [normal], index, readState });
  const open = await runDialogueTurn({ query: 'Відкрий', history: [normal, egg], index, readState });
  assert.deepEqual(open.actions.map(action => action.id), ['open-backup'], '«Відкрий» повторює кнопку останньої довідкової теми, а не пісню');
  assert.equal(open.media, null);
});

// Підроблений <audio>: подає ті самі події, що й браузер, без DOM.
function fakeAudio({ playError = null, deferPlay = false } = {}) {
  const listeners = new Map();
  const audio = {
    url: null, preload: '', volume: 1, currentTime: 0, paused: true, calls: [], pending: null,
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type) { listeners.get(type)?.(); },
    play() {
      audio.calls.push('play');
      if (playError) return Promise.reject(Object.assign(new Error(playError), { name: playError }));
      audio.paused = false;
      if (deferPlay) return new Promise((resolve, reject) => { audio.pending = { resolve, reject }; });
      return Promise.resolve();
    },
    pause() { audio.calls.push('pause'); audio.paused = true; },
  };
  return audio;
}

function player(options) {
  const created = [];
  const controller = createSongPlayer({
    url: '/synthetic/song.mp3',
    createAudio: url => { const audio = fakeAudio(options); audio.url = url; created.push(audio); return audio; },
  });
  return { controller, created };
}

test('play вмикає пісню з початку з помірною гучністю й створює елемент один раз', async () => {
  const { controller, created } = player();
  const states = [];
  controller.subscribe(state => states.push(state));
  assert.equal(controller.state(), 'idle');
  assert.equal(created.length, 0, 'до першого запуску нічого не вантажиться');

  assert.equal(await controller.play(), 'playing');
  assert.equal(created.length, 1);
  assert.equal(created[0].url, '/synthetic/song.mp3');
  assert.equal(created[0].volume, SONG_VOLUME);
  assert.equal(created[0].currentTime, 0);
  assert.equal(controller.isPlaying(), true);

  controller.stop();
  await controller.play();
  assert.equal(created.length, 1, 'повторний запуск використовує той самий елемент');
  assert.deepEqual(states, ['playing', 'idle', 'playing']);
});

test('stop зупиняє, перемотує до початку й повідомляє підписників; повторний stop тихий', async () => {
  const { controller, created } = player();
  const states = [];
  await controller.play();
  created[0].currentTime = 33;
  controller.subscribe(state => states.push(state));
  controller.stop();
  assert.equal(controller.state(), 'idle');
  assert.equal(created[0].currentTime, 0);
  assert.equal(created[0].paused, true);
  controller.stop();
  assert.deepEqual(states, ['idle'], 'без зміни стану підписники не кличуться');
});

test('кінець пісні, зупинка системою й спізніла подія pause повертають кнопку до «Увімкнути»', async () => {
  const { controller, created } = player();
  await controller.play();
  created[0].emit('ended');
  assert.equal(controller.state(), 'idle');

  await controller.play();
  created[0].paused = true;
  created[0].emit('pause');
  assert.equal(controller.state(), 'idle', 'медіа-клавіша чи система зупинили звук');

  await controller.play();
  created[0].emit('pause');
  assert.equal(controller.state(), 'playing', 'pause від попередньої зупинки не гасить пісню, що вже грає знову');
});

test('заборонений автозапуск дає стан blocked, а кнопка запускає звук жестом користувача', async () => {
  const blockedEnv = { playError: 'NotAllowedError' };
  const { controller, created } = player(blockedEnv);
  assert.equal(await controller.play(), 'blocked');
  assert.equal(songButtonText('blocked'), SONG_LABELS.idle, 'у стані blocked кнопка пропонує «Увімкнути пісню»');
  created[0].play = () => { created[0].paused = false; return Promise.resolve(); };
  assert.equal(await controller.play(), 'playing');
});

test('файл, який не відтворюється, дає failed без нескінченних повторів; помилка елемента скидає його', async () => {
  const broken = player({ playError: 'NotSupportedError' });
  assert.equal(await broken.controller.play(), 'failed');
  assert.equal(songButtonText('failed'), 'Пісня недоступна');

  const { controller, created } = player();
  await controller.play();
  created[0].emit('error');
  assert.equal(controller.state(), 'failed');
  controller.stop();
  await controller.play();
  assert.equal(created.length, 2, 'після помилки наступний запуск створює новий елемент');
  assert.equal(controller.state(), 'playing');
});

test('stop під час очікування запуску скасовує його без помилки', async () => {
  const { controller, created } = player({ deferPlay: true });
  const started = controller.play();
  controller.stop();
  created[0].pending.reject(Object.assign(new Error('abort'), { name: 'AbortError' }));
  assert.equal(await started, 'idle');
  assert.equal(controller.state(), 'idle');
});

test('dispose зупиняє звук, відписує слухачів і не лишає елемента', async () => {
  const { controller, created } = player();
  const states = [];
  controller.subscribe(state => states.push(state));
  await controller.play();
  controller.dispose();
  assert.equal(created[0].paused, true);
  assert.deepEqual(states, ['playing', 'idle']);
  await controller.play();
  assert.equal(created.length, 2, 'після dispose новий запуск створює свіжий елемент');
  assert.deepEqual(states, ['playing', 'idle'], 'слухачів уже немає');
});

test('ресурс пісні: MP3 у складі застосунку, без тегів, розумного розміру', async () => {
  const url = new URL('../src/assistant/assets/favorite-song.mp3', import.meta.url);
  const data = await readFile(url);
  assert.ok(data.length > 500_000 && data.length < 2_000_000, `розмір ${data.length} байтів`);
  assert.equal(data[0], 0xff, 'починається одразу з MPEG-кадру, без ID3-тегів із назвою файлу чи автором');
  assert.equal(data[1] & 0xe0, 0xe0);
  assert.notEqual(data.toString('latin1', 0, 3), 'ID3');
  assert.notEqual(data.toString('latin1', data.length - 128, data.length - 125), 'TAG');
  assert.ok((await stat(url)).isFile());
});

test('інтерфейс підключає пісню лише через контролер і не торкається мережі та сховищ', async () => {
  for (const file of ['assistant-song.js', 'assistant-ui.js']) {
    const source = await readFile(new URL(`../src/assistant/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/u, file);
  }
  const ui = await readFile(new URL('../src/assistant/assistant-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /new URL\('\.\/assets\/favorite-song\.mp3', import\.meta\.url\)/u);
  assert.match(ui, /song\.stop\(\)/u);
  assert.match(ui, /song\.dispose\(\)/u);
  assert.match(ui, /turn\.media === 'favorite-song'/u);
});
