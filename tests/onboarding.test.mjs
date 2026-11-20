import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CHECKLIST,
  MODULES,
  STORAGE_KEY,
  TOURS,
  advanceTour,
  assertExportClean,
  demoView,
  detectHangarModule,
  detectModule,
  isDemoRecord,
  loadState,
  markChecklist,
  readState,
  reopenWelcome,
  resumeMessage,
  saveState,
  setDemo,
  shouldAutoStart,
  shouldShowWelcome,
  skipTour,
  startTour,
  stepsLeftTitle,
  submitWelcome,
  tourSteps,
  welcomeError,
  withoutDemo,
  writeState,
} from '../src/onboarding-core.js';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

function memory() {
  const data = new Map();
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const welcome = (choice = 'demo', role = 'analyst') => submitWelcome({}, {
  unitName: '  Навчальна   ескадрилья ',
  role,
  choice,
}).state;

test('кожен модуль має тур українською, а чекліст короткий', () => {
  assert.deepEqual(MODULES, Object.keys(TOURS));
  assert.ok(MODULES.length >= 15);
  for (const id of MODULES) {
    assert.ok(TOURS[id].length >= 2, id);
    for (const step of TOURS[id]) {
      assert.match(step.title, /[А-ЯІЇЄҐа-яіїєґ]/, `${id} title`);
      assert.match(step.body, /[А-ЯІЇЄҐа-яіїєґ]/, `${id} body`);
      assert.ok(step.selector, id);
    }
  }
  assert.equal(TOURS.hangar[0].selector, '#stage');
  assert.equal(TOURS.hangar[0].marks, 'hangar');
  assert.equal(CHECKLIST.length, 5);
  assert.deepEqual(CHECKLIST.map(item => item.id), ['hangar', 'air', 'rocket', 'artillery', 'own']);
  assert.equal(tourSteps('air', 'commander')[0].body.includes('Для командира'), true);
});

test('вітання питає лише підрозділ і роль', () => {
  assert.match(welcomeError({ choice: 'demo', role: '', unitName: '' }), /роль/);
  assert.match(welcomeError({ choice: 'demo', role: 'operator', unitName: 'а'.repeat(81) }), /80/);
  assert.equal(welcomeError({ choice: 'later', role: '', unitName: '' }), '');
  const state = welcome();
  assert.equal(state.welcome.unitName, 'Навчальна ескадрилья');
  assert.equal(state.welcome.role, 'analyst');
  assert.equal(state.demo, true);
  assert.equal(shouldShowWelcome(state, 'launcher'), false);
  assert.equal(shouldShowWelcome({}, 'launcher'), true);
  assert.equal(shouldShowWelcome({}, 'air'), false);
  const self = welcome('self', 'operator');
  assert.equal(self.demo, false);
  assert.equal(setDemo(self, true).demo, true);
  assert.equal(welcome('later').demo, false);
  assert.equal(setDemo(welcome('later'), true).demo, false);
});

test('демо-рядки не проходять у експорт, справжні лишаються', () => {
  const shown = ['air', 'rocket', 'army', 'artillery', 'pvk', 'dshv', 'custom'];
  for (const id of shown) {
    const view = demoView(id, 'Навчальна ескадрилья');
    assert.ok(view.rows.length, id);
    assert.match(view.note, /не потрапляють|не модуль каталогу/);
    for (const row of view.rows) {
      assert.equal(isDemoRecord(row), true, id);
      assert.equal(row.id.startsWith('demo:'), true);
      assert.equal(row.demo, true);
    }
    const mixed = [...view.rows, { id: 'real-1', text: 'справжній рядок' }];
    const check = assertExportClean(mixed);
    assert.equal(check.ok, false);
    assert.deepEqual(check.rows, [{ id: 'real-1', text: 'справжній рядок' }]);
    assert.deepEqual(withoutDemo(mixed), check.rows);
  }
  assert.equal(demoView('hangar'), null);
  assert.equal(assertExportClean([{ id: 'real-1' }]).ok, true);
});

test('чекліст і нагадування про крок, що лишився', () => {
  let state = welcome();
  state = startTour(state, 'hangar');
  assert.equal(state.checklist.hangar, true);
  state = startTour(state, 'air');
  state = advanceTour(state, 'air');
  assert.equal(state.checklist.air, true);
  state = markChecklist(state, 'rocket');
  state = markChecklist(state, 'artillery');
  const left = resumeMessage(state);
  assert.equal(left.title, 'Залишився 1 крок');
  assert.match(left.text, /Прибрати демо/);
  state = markChecklist(state, 'own');
  assert.equal(resumeMessage(state), null);
  assert.equal(stepsLeftTitle(2), 'Залишилось 2 кроки');
  assert.equal(stepsLeftTitle(5), 'Залишилось 5 кроків');
  const later = welcome('later');
  assert.equal(resumeMessage(later).title, 'Знайомство ще попереду');
  const skipped = skipTour(startTour(welcome(), 'rocket'), 'rocket');
  assert.equal(skipped.tours.rocket.status, 'skipped');
  assert.equal(skipped.checklist.rocket, false);
  assert.equal(shouldAutoStart(skipped, 'rocket'), false);
  assert.equal(shouldAutoStart(welcome(), 'rocket'), true);
  assert.equal(shouldAutoStart(startTour(welcome(), 'air'), 'air'), true);
});

test('прибрати демо закриває крок своєї таблиці і не стирає решту стану', () => {
  let state = startTour(welcome(), 'hangar');
  state = setDemo(state, false);
  assert.equal(state.demo, false);
  assert.equal(state.checklist.own, true);
  assert.equal(state.checklist.hangar, true);
  const again = reopenWelcome(state);
  assert.equal(again.welcome, null);
  assert.equal(again.demo, false);
  assert.equal(again.checklist.hangar, true);
});

test('зіпсоване сховище не ламає стан, круглий запис зберігає відповіді', () => {
  assert.equal(readState('{').welcome, null);
  assert.equal(readState('').demo, false);
  assert.equal(readState('{"demo":true,"checklist":{"hangar":"так"}}').checklist.hangar, false);
  const store = memory();
  const saved = saveState(store, welcome());
  assert.equal(store.getItem(STORAGE_KEY), writeState(saved));
  assert.equal(loadState(store).welcome.unitName, 'Навчальна ескадрилья');
  assert.equal(loadState({ getItem() { throw new Error('закрито'); } }).v, 1);
});

test('сторінка визначає модуль, телефонний кадр туру не дублює', () => {
  assert.equal(detectModule('/index.html'), 'launcher');
  assert.equal(detectModule('/'), 'launcher');
  assert.equal(detectModule('/air.html'), 'air');
  assert.equal(detectModule('/air.html', '?module=army'), 'army');
  assert.equal(detectModule('/air.html', '?command=pvk'), 'pvk');
  assert.equal(detectModule('/air.html', '?command=pvk&viewer=1'), null);
  assert.equal(detectModule('/rocket.html', '?command=dshv'), 'dshv');
  assert.equal(detectModule('/guides/index.html'), 'guides');
  assert.equal(detectModule('/guides/uav/index.html'), 'uav');
  assert.equal(detectModule('/guides/brigades/index.html'), 'brigades');
  assert.equal(detectModule('/workspace/index.html'), 'workspace');
  assert.equal(detectModule('/workspace/app.html'), null);
  assert.equal(detectHangarModule('#garage'), 'garage');
  assert.equal(detectHangarModule('#enemy-air'), 'enemy-air');
  assert.equal(detectHangarModule(''), 'hangar');
});

test('сторінки модулів підключають ознайомлення, ангар — сталий файл', async () => {
  assert.match(await read('src/launcher-tools.js'), /import '\.\/onboarding\.js';/);
  for (const name of ['src/air.html', 'src/rocket.html', 'src/artillery.html', 'src/custom.html', 'src/viewer.html']) {
    assert.match(await read(name), /<script type="module" src="\.\/onboarding\.js"><\/script>/, name);
  }
  assert.match(await read('src/guides/index.html'), /src="\.\.\/onboarding\.js"/);
  assert.match(await read('src/guides/uav/index.html'), /src="\.\.\/\.\.\/onboarding\.js"/);
  assert.match(await read('src/workspace/index.html'), /src="\.\.\/onboarding\.js"/);
  const hangar = await read('hangar/EasyWAR_hangar.html');
  assert.match(hangar.slice(-400), /<script type="module" src="\.\.\/onboarding-hangar\.js"><\/script>/);
  const vite = await read('vite.config.js');
  assert.match(vite, /"onboarding-hangar": fileURLToPath/);
  assert.match(vite, /chunk\.name === "onboarding-hangar"/);
  assert.match(await read('src/guides-launcher.js'), /window\.EW_GUIDES = \{ open, close \}/);
  assert.match(await read('src/guides-launcher.js'), /dataset\.ewTour = 'wiki'/);
});
