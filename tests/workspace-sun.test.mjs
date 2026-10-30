// «Сонце і Місяць» у «Робочому середовищі» → «Обстановка» (src/workspace/sun): чиста логіка вигляду й
// стану, реєстр застосунку і відсутність мережі. Лише вигадані пункти.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  SUN_ROWS,
  addOwnPlace,
  allPlaces,
  emptySunState,
  parseSunState,
  pickPlace,
  removeOwnPlace,
  serializeSunState,
  shiftDate,
  skyView,
  todayIso,
  weatherPlaces,
} from '../src/workspace/sun/sun-view-core.js';
import { serializeState, emptyState, addPlace, parsePlace } from '../src/workspace/weather/weather-core.js';
import { APP_ICONS, SITUATION_APPS, WORKSPACE_SECTIONS, appById, opensInEditorWindow } from '../src/workspace/workspace-core.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const town = { name: 'Вигадане', latitude: 48.46, longitude: 35.04 };

test('вигляд доби: схід, захід, сутінки, тривалість дня й Місяць у київському часі', () => {
  const view = skyView(town, '2026-10-29');
  assert.equal(view.dateLabel, '29.10.2026');
  assert.deepEqual(view.sun.map(row => row.label), ['Навігаційний світанок', 'Світанок', 'Схід', 'Захід', 'Настання темряви', 'Навігаційна темрява']);
  assert.deepEqual(view.sun.map(row => row.value), ['05:11', '05:48', '06:20', '16:25', '16:58', '17:34']);
  assert.equal(view.dayLength, '10:05');
  assert.equal(view.polar, false);
  assert.deepEqual({ rise: view.moon.rise, set: view.moon.set, phase: view.moon.phase, light: view.moon.illumination }, { rise: '18:16', set: '11:47 (+1)', phase: 'спадаючий', light: '81%' });
  assert.equal(SUN_ROWS.length, 6);
});

test('літній час: у червні схід і захід зсунуті на літній час', () => {
  const view = skyView(town, '2026-06-21');
  assert.deepEqual(view.sun.map(row => row.value), ['02:56', '03:56', '04:38', '20:45', '21:27', '22:26']);
});

test('полярна доба: подій немає, вигляд позначає це й не ламається', () => {
  const view = skyView({ latitude: 69, longitude: 33 }, '2026-06-21');
  assert.equal(view.polar, true);
  assert.ok(view.sun.every(row => row.value === '—'));
  assert.equal(view.dayLength, '—');
});

test('нерозпізнана дата чи пункт без координат — порожній вигляд', () => {
  assert.equal(skyView(null, '2026-10-29'), null);
  assert.equal(skyView(town, 'вчора'), null);
  assert.equal(skyView({ latitude: NaN, longitude: 1 }, '2026-10-29'), null);
  assert.equal(skyView(town, '2026-02-30'), null);
});

test('дата: сьогодні за годинником пристрою й зсув на добу через межі місяця та року', () => {
  assert.equal(todayIso(new Date(2026, 9, 29)), '2026-10-29');
  assert.equal(todayIso(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDate('x', 1), '');
});

test('пункти: з «Погоди» (лише читання) і власні, без повторів, вибір має запасний варіант', () => {
  let weather = emptyState();
  weather = addPlace(weather, parsePlace({ name: 'Вигадане', latitude: '48,46', longitude: '35,04' }).place).state;
  const fromWeather = weatherPlaces(serializeState(weather));
  assert.equal(fromWeather.length, 1);
  assert.deepEqual(weatherPlaces('{зіпсовано'), []);
  assert.deepEqual(weatherPlaces(null), []);

  const dup = addOwnPlace(emptySunState(), { name: 'Вигадане', latitude: '48,46', longitude: '35,04' }, fromWeather);
  assert.match(dup.error, /уже є/);

  const added = addOwnPlace(emptySunState(), { name: 'Тестове', latitude: '50,1', longitude: '30,2' }, fromWeather);
  assert.equal(added.state.places.length, 1);
  assert.equal(added.state.selected, added.place.id);
  const list = allPlaces(fromWeather, added.state.places);
  assert.deepEqual(list.map(place => [place.name, place.own]), [['Вигадане', false], ['Тестове', true]]);
  assert.equal(pickPlace(list, added.place.id).name, 'Тестове');
  assert.equal(pickPlace(list, 'немає такого').name, 'Вигадане', 'зниклий вибір — перший пункт');
  assert.equal(pickPlace([], ''), null);

  assert.match(addOwnPlace(emptySunState(), { name: 'X', latitude: '95', longitude: '1' }).error, /Широта/);
  assert.match(addOwnPlace(emptySunState(), { name: '', latitude: '1', longitude: '1' }).error, /назву/);

  const removed = removeOwnPlace(added.state, added.place.id);
  assert.deepEqual(removed, { places: [], selected: '' });
});

test('стан застосунку: зберігається, зламане сховище дає порожній стан, пункти проходять перевірку', () => {
  const added = addOwnPlace(emptySunState(), { name: 'Тестове', latitude: '50,1', longitude: '30,2' }).state;
  assert.deepEqual(parseSunState(serializeSunState(added)), added);
  assert.deepEqual(parseSunState('{зіпсовано'), emptySunState());
  assert.deepEqual(parseSunState(null), emptySunState());
  assert.deepEqual(parseSunState({ places: [{ name: 'X', latitude: 999, longitude: 1 }, 5, null], selected: 7 }), emptySunState());
});

test('реєстр: «Сонце і Місяць» стоїть поряд із «Погодою» в «Обстановці», без файлів і не у вікні редактора', () => {
  assert.deepEqual(SITUATION_APPS.map(app => app.id), ['weather', 'sun']);
  assert.deepEqual(WORKSPACE_SECTIONS.find(section => section.id === 'situation').apps, ['weather', 'sun']);
  const app = appById('sun');
  assert.equal(app.title, 'Сонце і Місяць');
  assert.deepEqual([...app.extensions], []);
  assert.equal(opensInEditorWindow('sun'), false);
  assert.ok(APP_ICONS.sun?.length, 'є власна іконка');
});

test('застосунок працює без мережі й не пише в чужий стан', async () => {
  const code = await read('src/workspace/sun/app.js');
  const core = await read('src/workspace/sun/sun-view-core.js');
  for (const text of [code, core]) {
    assert.doesNotMatch(text, /fetch\(|XMLHttpRequest|WebSocket|invoke\(|http:\/\/|https:\/\//, 'жодної мережі й Rust-команд');
  }
  assert.doesNotMatch(code, /setItem\(WEATHER/, '«Погода» лише читається');
  assert.match(code, /SUN_STORAGE_KEY/);
  assert.match(await read('src/workspace/sun/sun.css'), /\.sn-root/);
});
