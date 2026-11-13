// Ознайомлення easyWAR: вітання, тури модулів, чекліст і демо-дані.
// Чиста логіка без DOM і Tauri. Стан живе лише в localStorage браузера (офлайн).
// Демо-записи ніколи не є рядками таблиці: їх не можна віддавати в експорт, звіт чи базу.
// Єдина безпечна дія перед будь-яким вивантаженням — assertExportClean / withoutDemo.

export const STORAGE_KEY = 'easywar.onboarding.v1';
export const DEMO_SOURCE = 'onboarding-demo';
export const UNIT_MAX = 80;

export const ROLES = Object.freeze([
  Object.freeze({ id: 'operator', title: 'Оператор' }),
  Object.freeze({ id: 'analyst', title: 'Аналітик' }),
  Object.freeze({ id: 'commander', title: 'Командир' }),
]);

/** Пункти «З чого почати». Тури є в кожного модуля; чекліст — короткий шлях через них. */
export const CHECKLIST = Object.freeze([
  Object.freeze({ id: 'hangar', title: 'Роздивитись літак в ангарі', module: 'hangar', hint: '3D без таблиці' }),
  Object.freeze({ id: 'air', title: 'Побачити демо-зведення Повітряних Сил', module: 'air', hint: 'Навчальні вильоти' }),
  Object.freeze({ id: 'rocket', title: 'Відкрити модуль ракетних військ', module: 'rocket', hint: 'Пуски на демо-даних' }),
  Object.freeze({ id: 'artillery', title: 'Подивитись облік артилерії', module: 'artillery', hint: 'Витрата і залишок' }),
  Object.freeze({ id: 'own', title: 'Прибрати демо або відкрити свою таблицю', module: 'launcher', hint: 'Демо не потрапляє у звіти' }),
]);

const step = (selector, title, body, extra = {}) => Object.freeze({ selector, title, body, ...extra });

// `marks` — пункт чекліста, який закривається, коли крок показано.
// `action` — окрема кнопка кроку: open-hangar відкриває ангар у накладці, follow переходить за посиланням.
export const TOURS = Object.freeze({
  launcher: Object.freeze([
    step('[data-ew-tour="wiki"]', 'Почнімо з ангара', 'Літак у 3D відкривається без таблиці. Це найшвидший спосіб побачити easyWAR.', { action: 'open-hangar', primary: 'Відкрити ангар' }),
    step('.branch-cards', 'Модулі родів військ', 'Повітряні Сили, ракетні війська, артилерія, армійська авіація і власний модуль. Кожен відкривається зі стартового екрана.'),
    step('#ew-checklist', 'З чого почати', 'П’ять коротких кроків. Прогрес зберігається на цьому комп’ютері, навіть якщо закрити програму.'),
  ]),
  guides: Object.freeze([
    step('a.card[href*="#hangar"]', 'Ангар авіації', 'МіГ-29, F-16, Су-27 та інші. Модель крутиться мишею, інтернет не потрібен.', { action: 'follow', primary: 'Відкрити ангар' }),
    step('a.card[href*="#garage"]', 'Гараж техніки', 'Танки, ББМ, артилерія, ППО і вантажні — окремі зали того самого довідника.'),
    step('a.card[href*="uav"]', 'БпАК і бригади', 'Дронів у ангарі немає: вони лишаються окремим довідником, поруч із довідником бригад.'),
  ]),
  hangar: Object.freeze([
    step('#stage', 'Ангар', 'Лівою кнопкою миші покрутіть літак, колесом наблизьте. Це навчальна модель, не розрахунок характеристик.', { marks: 'hangar' }),
    step('#hxName', 'Назва борту', 'Тут борт, який зараз на стоянці. Картка ТТХ відкривається клавішею з крапкою.'),
    step('#hxR', 'Інший літак', 'Стрілка праворуч — наступний борт: винищувачі, штурмовик, вертольоти, транспорт.'),
    step('#mGar', 'Далі — гараж', 'Та сама сцена, уже для наземної техніки. Повернутись в ангар можна цією ж смугою.'),
    step('#mEn', 'Вкладка «Ворог»', 'Окремий вигляд для розпізнавання техніки і авіації противника. У звіти він нічого не записує.'),
  ]),
  garage: Object.freeze([
    step('#gStage', 'Гараж', 'Наземна техніка в 3D. Покрутіть машину лівою кнопкою, як літак в ангарі.', { marks: 'hangar' }),
    step('#gRowV', 'Вибір машини', 'Картки внизу перемикають зразок: танки, ББМ, артилерія, ППО, інженерні.'),
    step('#mAir', 'Повернутись в ангар', 'Ангар і гараж — один довідник. Клавіша ` теж перемикає їх.'),
  ]),
  enemy: Object.freeze([
    step('#gStage', 'Техніка противника', 'Навчальний довідник розпізнавання. Моделі спрощені і не замінюють бойове впізнання.', { marks: 'hangar' }),
    step('#mEn', 'Наземна і авіація', 'Поруч є перемикач на авіацію противника. Дані звідси у таблицю доповідей не йдуть.'),
  ]),
  'enemy-air': Object.freeze([
    step('#stage', 'Авіація противника', 'Літаки і вертольоти для розпізнавання. Покрутіть модель мишею.', { marks: 'hangar' }),
    step('#mEn', 'Інші вкладки', '«Ангар» і «Гараж» — наша техніка, «Ворог» — довідник розпізнавання.'),
  ]),
  uav: Object.freeze([
    step('#stage', 'Довідник БпАК', 'Чотири машини у польоті. Сцена працює без інтернету і не пише доповідей.'),
    step('#rowV', 'Обрати машину', 'Картки внизу змінюють борт, режим і камеру.'),
    step('#i-name', 'Картка машини', 'Поруч — відкриті дані і що саме рухається в моделі. Це ілюстрація, не ТТХ для розрахунку.'),
  ]),
  brigades: Object.freeze([
    step('#q', 'Пошук бригади', 'Номер, назва або місто. Довідник не містить оперативних даних.'),
    step('#branches', 'Рід військ', 'Чіпи звужують список. «—» у картці означає, що відомості ще не внесено.'),
    step('#grid', 'Картки частин', 'Емблема, назва, тип і призначення. Нічого звідси не потрапляє у звіт.'),
  ]),
  air: Object.freeze([
    step('#tab-dash', 'Дашборд ПС', 'Зведення вильотів, карта і розрізи. Поки своєї таблиці немає, унизу — навчальні числа.'),
    step('#ew-demo-board', 'Демо-зведення', 'Три навчальні вильоти. Вони позначені «ДЕМО» і не входять у файл, експорт і базу.', { marks: 'air' }),
    step('#tab-ref', 'Довідник', 'Літаки і боєприпаси з 3D. Статті, для яких є модель ангара, відкривають її прямо тут.'),
    step('#tab-entry', 'Внесення доповіді', 'Сюди вставляють текст доповіді або заповнюють форму. Запис з’являється лише після вашого підтвердження.'),
    step('#tab-base', 'Своя таблиця', 'Кнопка «Відкрити таблицю…» бере ваш файл .xlsx. Демо-числа туди не записуються і в експорт не потрапляють.', { marks: 'own' }),
  ]),
  rocket: Object.freeze([
    step('#tab-dash', 'Дашборд РВ', 'Пуски, витрата боєприпасів і результати. Без файлу модуль показує навчальний приклад.'),
    step('#ew-demo-board', 'Демо-пуски', 'Два навчальні пуски. Позначка «ДЕМО» означає: у звіт і в таблицю це не піде.', { marks: 'rocket' }),
    step('#tab-ref', 'Довідник машин', 'HIMARS, M270, «Вільха», «Сапсан» і машини забезпечення. Для зіставлених зразків відкривається гараж.'),
    step('#tab-entry', 'Внесення', 'Той самий шлях, що в Повітряних Силах: текст доповіді або форма, потім ваше підтвердження.'),
    step('#tab-base', 'Своя таблиця', '«Відкрити таблицю…» підключає файл РСЗВ. Демо-рядки в ньому не з’являться.', { marks: 'own' }),
  ]),
  army: Object.freeze([
    step('#tab-dash', 'Армійська авіація', 'Той самий модуль, що Повітряні Сили, у своєму кольорі і зі своєю таблицею.'),
    step('#ew-demo-board', 'Навчальні вильоти', 'Приклад для вертолітного підрозділу. У файл армійської авіації він не записується.'),
    step('#tab-ref', 'Довідник', 'Техніка і боєприпаси. Моделі, які є в ангарі, відкриваються звідси.'),
    step('#tab-entry', 'Доповідь', 'Внесення працює так само: зі звіту або довільною формою.'),
  ]),
  artillery: Object.freeze([
    step('#view .es h2', 'Облік боєприпасів', 'Спільна таблиця бригад: витрата і залишок. Файл можна відкрити пізніше.'),
    step('#ew-demo-board', 'Навчальний залишок', 'Один калібр навчальної бригади. У спільний файл ці числа не пишуться.', { marks: 'artillery' }),
    step('.es .btn.primary', 'Своя таблиця', '«Відкрити таблицю…» бере файл .xlsx. Демо зникне, щойно відкриється справжня таблиця, і в збереження не потрапить.', { marks: 'own' }),
  ]),
  pvk: Object.freeze([
    step('#ew-demo-board', 'Зведення ПВК', 'Навчальні підсумки командування. Вони не замінюють книгу ПВК і в CSV не вивантажуються.'),
    step('#tab-dash', 'Дашборд', 'Після відкриття таблиці тут аркуші «АА», «ПС», «Об’єкти» і журнал. Зараз можна просто оглянути розділ.'),
    step('#tab-base', 'База даних', 'Аркуші файлу лише для читання. Своя книга підключається кнопкою відкриття таблиці.'),
  ]),
  dshv: Object.freeze([
    step('#ew-demo-board', 'Зведення УДШВ', 'У навчальному прикладі втрат особового складу немає. Це не звіт і не таблиця підрозділу.'),
    step('#view-dash', 'Дашборд командування', 'Після своєї таблиці тут втрати, ОВТ і витрата. Демо-картка зникне, щойно файл відкрито.'),
  ]),
  custom: Object.freeze([
    step('#cm-intro-title', 'Власний модуль', 'Без роду військ і без файлу .xlsx. Картки живуть у локальній базі вашого профілю.'),
    step('[data-ew-tour="catalog"]', 'Каталог модулів', 'Кнопка створює аналітичний модуль і його таблицю SQLite. Демо-картка унизу — лише зразок вигляду, не запис.'),
    step('[data-ewmc-slot]', 'Мій дашборд', 'Сюди стають картки, які ви створили. Поки каталог порожній, місце лишається вільним.'),
  ]),
  workspace: Object.freeze([
    step('#ws-tabs', 'Робоче середовище', 'Офіс, бібліотека і файли. Усе локально: EasyGreen, EasyDoc, EasySlide, погода, EasyFLY.'),
    step('#ws-sections', 'Розділи', 'Картки застосунків. Вони не читають демо-зведення модулів і не підміняють бойові таблиці.'),
    step('#ws-tab-library', 'Бібліотека', 'Сюди складають файли профілю. Демо-числа ознайомлення в бібліотеку не потрапляють.'),
  ]),
  viewer: Object.freeze([
    step('.tile[data-cmd="pvk"]', 'Файл для телефона', 'Окремий перегляд дашбордів командування. Таблицю обираєте на пристрої, демо туди не підставляється.'),
    step('.tile[data-cmd="dshv"]', 'Два командування', 'ПВК і УДШВ відкриваються в цьому вікні. Ознайомлення на комп’ютері від цього не змішується з файлом.'),
  ]),
});

export const MODULES = Object.freeze(Object.keys(TOURS));

const CHOICES = new Set(['demo', 'self', 'later']);
const ROLE_IDS = new Set(ROLES.map(role => role.id));

const squash = value => String(value ?? '').split(/\s+/).filter(Boolean).join(' ');
const codePoints = value => [...String(value ?? '')];

export function roleHint(role) {
  if (role === 'operator') return 'Для оператора: спершу місце, куди потрапляє доповідь.';
  if (role === 'analyst') return 'Для аналітика: спершу зведення і розрізи.';
  if (role === 'commander') return 'Для командира: спершу картина без ручного зведення.';
  return 'Можна пройти без своєї таблиці.';
}

export function tourSteps(moduleId, role = '') {
  const source = TOURS[moduleId];
  if (!source) return [];
  return source.map((item, index) => (index === 0
    ? { ...item, body: `${item.body} ${roleHint(role)}` }
    : { ...item }));
}

export function freshState() {
  return {
    v: 1,
    welcome: null,
    demo: false,
    checklist: Object.fromEntries(CHECKLIST.map(item => [item.id, false])),
    tours: {},
    updatedAt: 0,
  };
}

function normalizeWelcome(value) {
  if (!value || typeof value !== 'object') return null;
  if (!CHOICES.has(value.choice)) return null;
  const role = ROLE_IDS.has(value.role) ? value.role : '';
  if (value.choice !== 'later' && !role) return null;
  return {
    unitName: squash(value.unitName).slice(0, UNIT_MAX),
    role,
    choice: value.choice,
    at: Number(value.at) || 0,
  };
}

function normalizeTour(value) {
  const status = ['active', 'done', 'skipped'].includes(value?.status) ? value.status : null;
  if (!status) return null;
  const stepIndex = Number(value.step);
  return { status, step: Number.isFinite(stepIndex) && stepIndex >= 0 ? Math.floor(stepIndex) : 0 };
}

export function normalizeState(raw) {
  const base = freshState();
  if (!raw || typeof raw !== 'object') return base;
  const welcome = normalizeWelcome(raw.welcome);
  const checklist = { ...base.checklist };
  for (const item of CHECKLIST) checklist[item.id] = raw.checklist?.[item.id] === true;
  const tours = {};
  for (const id of MODULES) {
    const tour = normalizeTour(raw.tours?.[id]);
    if (tour) tours[id] = tour;
  }
  return {
    v: 1,
    welcome,
    demo: raw.demo === true && Boolean(welcome) && welcome.choice !== 'later',
    checklist,
    tours,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

export function readState(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return freshState();
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return freshState();
  }
}

export function writeState(state) {
  return JSON.stringify(normalizeState(state));
}

export function loadState(storage) {
  try {
    return readState(storage?.getItem?.(STORAGE_KEY));
  } catch {
    return freshState();
  }
}

export function saveState(storage, state) {
  const next = normalizeState(state);
  try {
    storage?.setItem?.(STORAGE_KEY, writeState(next));
  } catch {
    /* приватний режим або заборона сховища: сесія лишається в пам’яті */
  }
  return next;
}

const touch = (state, at) => normalizeState({ ...state, updatedAt: at });

export function welcomeError(input) {
  const choice = input?.choice;
  if (!CHOICES.has(choice)) return 'Оберіть, як почати.';
  const unit = squash(input?.unitName);
  if (codePoints(unit).length > UNIT_MAX) return `Назва підрозділу має бути не довшою за ${UNIT_MAX} символів.`;
  if (choice !== 'later' && !ROLE_IDS.has(input?.role)) return 'Оберіть роль: оператор, аналітик або командир.';
  return '';
}

export function submitWelcome(state, input, at = Date.now()) {
  const error = welcomeError(input);
  if (error) return { ok: false, error, state: normalizeState(state) };
  const welcome = {
    unitName: squash(input.unitName),
    role: input.choice === 'later' ? '' : input.role,
    choice: input.choice,
    at,
  };
  return {
    ok: true,
    state: touch({ ...normalizeState(state), welcome, demo: input.choice === 'demo' }, at),
  };
}

export function reopenWelcome(state, at = Date.now()) {
  return touch({ ...normalizeState(state), welcome: null, demo: false }, at);
}

export function markChecklist(state, id, at = Date.now()) {
  const current = normalizeState(state);
  if (!CHECKLIST.some(item => item.id === id) || current.checklist[id]) return current;
  return touch({ ...current, checklist: { ...current.checklist, [id]: true } }, at);
}

export function setDemo(state, demo, at = Date.now()) {
  const current = normalizeState(state);
  if (!current.welcome || current.welcome.choice === 'later') return touch({ ...current, demo: false }, at);
  if (!demo) return markChecklist({ ...current, demo: false }, 'own', at);
  return touch({ ...current, demo: true }, at);
}

function setTour(state, moduleId, tour) {
  return { ...state, tours: { ...state.tours, [moduleId]: tour } };
}

function markStep(state, moduleId, stepIndex, at) {
  const mark = TOURS[moduleId]?.[stepIndex]?.marks;
  return mark ? markChecklist(state, mark, at) : normalizeState(state);
}

export function tourOf(state, moduleId) {
  return normalizeState(state).tours[moduleId] || { status: 'idle', step: 0 };
}

export function startTour(state, moduleId, at = Date.now()) {
  if (!TOURS[moduleId]) return normalizeState(state);
  return markStep(touch(setTour(normalizeState(state), moduleId, { status: 'active', step: 0 }), at), moduleId, 0, at);
}

export function advanceTour(state, moduleId, at = Date.now()) {
  const steps = TOURS[moduleId];
  if (!steps) return normalizeState(state);
  const current = normalizeState(state);
  const tour = current.tours[moduleId] || { status: 'active', step: 0 };
  const nextIndex = tour.step + 1;
  if (nextIndex >= steps.length) return touch(setTour(current, moduleId, { status: 'done', step: steps.length }), at);
  return markStep(touch(setTour(current, moduleId, { status: 'active', step: nextIndex }), at), moduleId, nextIndex, at);
}

export function retreatTour(state, moduleId, at = Date.now()) {
  if (!TOURS[moduleId]) return normalizeState(state);
  const current = normalizeState(state);
  const stepIndex = Math.max(0, (current.tours[moduleId]?.step || 0) - 1);
  return touch(setTour(current, moduleId, { status: 'active', step: stepIndex }), at);
}

export function skipTour(state, moduleId, at = Date.now()) {
  if (!TOURS[moduleId]) return normalizeState(state);
  const current = normalizeState(state);
  const stepIndex = current.tours[moduleId]?.step || 0;
  return touch(setTour(current, moduleId, { status: 'skipped', step: stepIndex }), at);
}

export function shouldShowWelcome(state, moduleId) {
  return moduleId === 'launcher' && !normalizeState(state).welcome;
}

export function shouldAutoStart(state, moduleId) {
  const current = normalizeState(state);
  if (!TOURS[moduleId] || current.welcome?.choice !== 'demo') return false;
  const status = current.tours[moduleId]?.status;
  return !status || status === 'idle' || status === 'active';
}

export function checklistView(state) {
  const current = normalizeState(state);
  return CHECKLIST.map(item => ({ ...item, done: current.checklist[item.id] === true }));
}

export function checklistLeft(state) {
  return checklistView(state).filter(item => !item.done);
}

export function stepsLeftTitle(count) {
  const n = Number(count) || 0;
  if (n === 1) return 'Залишився 1 крок';
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `Залишилось ${n} кроки`;
  return `Залишилось ${n} кроків`;
}

export function resumeMessage(state) {
  const current = normalizeState(state);
  if (!current.welcome) return null;
  const left = checklistLeft(current);
  if (current.welcome.choice === 'later' && left.length === CHECKLIST.length) {
    return {
      title: 'Знайомство ще попереду',
      text: 'Дві відповіді — і можна подивитись модулі на демо-даних.',
      action: 'welcome',
      left: left.length,
    };
  }
  if (!left.length) return null;
  return {
    title: stepsLeftTitle(left.length),
    text: `Далі: ${left[0].title}.`,
    action: 'checklist',
    left: left.length,
  };
}

export function shouldShowResume(state, moduleId) {
  return moduleId === 'launcher' && resumeMessage(state) !== null;
}

export function unitLabel(state) {
  return normalizeState(state).welcome?.unitName || 'Навчальний підрозділ';
}

const demoRow = (id, fields) => Object.freeze({
  ...fields,
  id: `demo:${id}`,
  demo: true,
  source: DEMO_SOURCE,
});

export function demoView(moduleId, unitName = '') {
  const unit = squash(unitName) || 'Навчальний підрозділ';
  const note = 'Навчальні числа. У файл таблиці, звіт, експорт CSV і локальну базу вони не потрапляють.';
  if (moduleId === 'air') {
    return {
      title: 'Демо-зведення ПС',
      note,
      kpis: [['Вильоти', '3'], ['Уражено', '1'], ['Боєприпасів', '2']],
      rows: [
        demoRow('air-1', { text: `01.01.2024 · ${unit} · навчальний полігон · GBU-39 · 1 · уражено` }),
        demoRow('air-2', { text: `01.01.2024 · ${unit} · навчальний полігон · без застосування · не відомо` }),
        demoRow('air-3', { text: `02.01.2024 · ${unit} · навчальний полігон · відбій` }),
      ],
    };
  }
  if (moduleId === 'rocket') {
    return {
      title: 'Демо-пуски РВ',
      note,
      kpis: [['Пуски', '2'], ['Знищено', '1'], ['Боєприпасів', '4']],
      rows: [
        demoRow('rv-1', { text: `01.01.2024 · ${unit} · HIMARS · навчальна ціль · GMLRS · 2` }),
        demoRow('rv-2', { text: `02.01.2024 · ${unit} · М270 · навчальна ціль · без ураження` }),
      ],
    };
  }
  if (moduleId === 'army') {
    return {
      title: 'Демо-вильоти армійської авіації',
      note,
      kpis: [['Вильоти', '2'], ['Бортів', '1'], ['Застосування', '0']],
      rows: [
        demoRow('army-1', { text: `01.01.2024 · ${unit} · Мі-8 · навчальний маршрут` }),
        demoRow('army-2', { text: `02.01.2024 · ${unit} · Мі-8 · повернення без застосування` }),
      ],
    };
  }
  if (moduleId === 'artillery') {
    return {
      title: 'Демо-облік артилерії',
      note,
      kpis: [['Витрата', '12'], ['Залишок', '48'], ['Бригад', '1']],
      rows: [
        demoRow('art-1', { text: `155 мм · ${unit} · витрата 12 · залишок 48 · навчальний період` }),
      ],
    };
  }
  if (moduleId === 'pvk') {
    return {
      title: 'Демо-зведення ПВК',
      note,
      kpis: [['АУ', '3'], ['Уражено', '1'], ['Витрата', '2']],
      rows: [
        demoRow('pvk-1', { text: `${unit} · навчальна доба · АУ 3 · уражено 1 · витрата 2` }),
      ],
    };
  }
  if (moduleId === 'dshv') {
    return {
      title: 'Демо-зведення УДШВ',
      note: `${note} У навчальному прикладі втрат особового складу немає.`,
      kpis: [['200', '0'], ['300', '0'], ['Макет ОВТ', '1']],
      rows: [
        demoRow('dshv-1', { text: `${unit} · 200: 0 · 300: 0 · навчальний макет ОВТ: 1` }),
      ],
    };
  }
  if (moduleId === 'custom') {
    return {
      title: 'Зразок картки',
      note: 'Це не модуль каталогу і не таблиця SQLite. Справжню картку створює кнопка «Каталог модулів».',
      kpis: [['Показник', '4'], ['Зміна', '0'], ['Записів', '0']],
      rows: [
        demoRow('custom-1', { text: `${unit} · навчальний показник · значення 4` }),
      ],
    };
  }
  return null;
}

export function isDemoRecord(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.demo === true || row.source === DEMO_SOURCE) return true;
  return String(row.id ?? '').startsWith('demo:');
}

export function withoutDemo(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => !isDemoRecord(row));
}

/** Перед експортом, звітом або записом у базу. Демо-рядки викидаються, а виклик вважається невдалим. */
export function assertExportClean(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const demo = list.filter(isDemoRecord);
  if (demo.length) return { ok: false, reason: 'demo', rows: withoutDemo(list) };
  return { ok: true, rows: list.slice() };
}

export function detectHangarModule(hash) {
  const id = String(hash || '').replace(/^#/, '').split('/')[0];
  if (id === 'garage') return 'garage';
  if (id === 'enemy') return 'enemy';
  if (id === 'enemy-air') return 'enemy-air';
  return 'hangar';
}

/** Сторінка → модуль туру. `viewer=1` — телефонний кадр всередині іншого модуля, без другого туру. */
export function detectModule(pathname, search = '', hinted = '') {
  const query = String(search || '');
  const q = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  if (q.get('viewer') === '1') return null;
  const path = String(pathname || '').replace(/\\/g, '/');
  if (path.includes('/hangar/')) return detectHangarModule(q.get('hash') || '');
  if (path.includes('/guides/uav/')) return 'uav';
  if (path.includes('/guides/brigades/')) return 'brigades';
  if (path.includes('/guides/')) return 'guides';
  if (path.includes('/workspace/app.html')) return null;
  if (path.includes('/workspace/')) return 'workspace';
  if (path.endsWith('/air.html')) {
    if (q.get('command') === 'pvk') return 'pvk';
    if (q.get('module') === 'army') return 'army';
    return 'air';
  }
  if (path.endsWith('/rocket.html')) return q.get('command') === 'dshv' ? 'dshv' : 'rocket';
  if (path.endsWith('/artillery.html')) return 'artillery';
  if (path.endsWith('/custom.html')) return 'custom';
  if (path.endsWith('/viewer.html')) return 'viewer';
  if (hinted && TOURS[hinted]) return hinted;
  if (path.endsWith('/index.html') || path.endsWith('/') || path === '') return 'launcher';
  return null;
}
