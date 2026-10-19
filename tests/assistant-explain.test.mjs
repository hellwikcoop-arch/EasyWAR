import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainElement, normalizeLabel, EXPLAIN_SOURCES, EXPLAIN_UNKNOWN } from '../src/assistant/assistant-explain-core.js';
import { explainLead } from '../src/assistant/assistant-persona-core.js';
import { EXPLAIN_REFS, EXPLAIN_REF_NONE, explainRef, explainRefTitle } from '../src/assistant/assistant-explain-refs-core.js';

const reference = readFileSync(new URL('../docs/DATA_REFERENCE.md', import.meta.url), 'utf8');

test('кожне джерело пояснень існує як розділ довідки', () => {
  const headings = new Set([...reference.matchAll(/^#{2,3}\s+(.+?)\s*$/gmu)].map(match => match[1]));
  for (const source of Object.values(EXPLAIN_SOURCES)) {
    assert.equal(source.file, 'DATA_REFERENCE.md');
    assert.ok(headings.has(source.section), `розділу «${source.section}» немає в DATA_REFERENCE.md`);
  }
});

test('нормалізація підпису прибирає переноси й регістр', () => {
  assert.equal(normalizeLabel('  ПОШКОДЖЕНО\nПОДАВЛЕНО '), 'пошкоджено подавлено');
  assert.equal(normalizeLabel(null), '');
});

test('картки ПС і РВ називають правильний іменник', () => {
  const air = explainElement({ branch: 'air', kind: 'kpi', label: 'Вильоти', value: '128' });
  assert.equal(air.status, 'found');
  assert.match(air.what, /один виліт/u);
  assert.equal(air.live, 'Зараз на екрані: 128');
  const rocket = explainElement({ branch: 'rocket', kind: 'kpi', label: 'ПУСКИ', value: '40' });
  assert.match(rocket.what, /один пуск/u);
});

test('класи результатів пояснюються за правилами довідки', () => {
  const hit = explainElement({ branch: 'rocket', kind: 'kpi', label: 'ЗНИЩЕНО' });
  assert.match(hit.basis.join(' '), /«уражено» або «знищено»/u);
  const part = explainElement({ branch: 'rocket', kind: 'kpi', label: 'ПОШКОДЖЕНО\nПОДАВЛЕНО' });
  assert.match(part.basis.join(' '), /«частково», «пошкоджено», «подавлено»/u);
  const miss = explainElement({ branch: 'air', kind: 'kpi', label: 'Не уражено' });
  assert.match(miss.basis.join(' '), /«не уражено», «не влучено», «не підтверджено»/u);
  const unk = explainElement({ branch: 'air', kind: 'kpi', label: 'Не відомо' });
  assert.match(unk.basis.join(' '), /нульовою вагою/u);
});

test('ефективність показує формулу й обидва коефіцієнти', () => {
  const eff = explainElement({ branch: 'air', kind: 'kpi', label: 'Ефективність', value: '71%' });
  const text = eff.basis.join(' ');
  assert.match(text, /\(влучання \+ k × часткові\) ÷ \(усі записи − відбої\) × 100/u);
  assert.match(text, /k = 1/u);
  assert.match(text, /0,75/u);
});

test('зміна показника пояснює базу порівняння й правило тренду', () => {
  const delta = explainElement({ branch: 'air', kind: 'delta', hint: 'Зміна ефективності' });
  const text = delta.basis.join(' ');
  assert.match(text, /попередній період такої ж тривалості/u);
  assert.match(text, /14 днів/u);
  assert.equal(delta.hint, 'Зміна ефективності');
});

test('панелі пояснюються за заголовком, а поріг підрозділів залежить від модуля', () => {
  const air = explainElement({ branch: 'air', kind: 'other', panelTitle: 'Топ-5 підрозділів (за ефектом)' });
  assert.match(air.basis.join(' '), /щонайменше 5 вильотів/u);
  const rocket = explainElement({ branch: 'rocket', kind: 'other', panelTitle: 'Топ-5 підрозділів (за ефектом)' });
  assert.match(rocket.basis.join(' '), /хоча б один пуск/u);
  const hours = explainElement({ branch: 'air', kind: 'chart', panelTitle: 'Час доби' });
  assert.match(hours.basis.join(' '), /ГГ:ХХ/u);
});

test('перемикачі пояснюються без зміни стану', () => {
  const mode = explainElement({ branch: 'rocket', kind: 'control', label: 'За загальним ефектом', group: 'Формула ефективності' });
  assert.match(mode.basis.join(' '), /не змінено/u);
  const dimension = explainElement({ branch: 'air', kind: 'control', label: 'Тип ЛА', group: 'Розріз даних' });
  assert.equal(dimension.id, 'dimension');
});

test('невідомий елемент і сторонні модулі не отримують вигаданих пояснень', () => {
  const unknown = explainElement({ branch: 'air', kind: 'other', label: 'Щось нове' });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.what, EXPLAIN_UNKNOWN);
  assert.deepEqual(unknown.basis, []);
  const foreign = explainElement({ branch: 'pvk', kind: 'kpi', label: 'Вильоти', value: '3' });
  assert.equal(foreign.status, 'unknown');
  assert.equal(foreign.live, 'Зараз на екрані: 3');
});

test('дескриптор зі сміттям не ламає ядро, довгі тексти обрізаються', () => {
  assert.equal(explainElement().status, 'unknown');
  assert.equal(explainElement({ label: 42, hint: 'я'.repeat(1000) }).status, 'unknown');
  assert.ok(explainElement({ branch: 'air', label: 'Вильоти', hint: 'я'.repeat(1000) }).hint.length <= 220);
});

test('вступна репліка залежить від результату', () => {
  assert.equal(explainLead(null), null);
  assert.match(explainLead({ status: 'found' }), /Доповідаю/u);
  assert.match(explainLead({ status: 'unknown' }), /не буду/u);
});

test('вкладка з назвою показника пояснюється як вкладка', () => {
  const tab = explainElement({ branch: 'air', kind: 'tab', label: 'Вильоти', value: '240' });
  assert.equal(tab.id, 'view-tab');
  assert.match(tab.title, /^Вкладка/u);
  assert.equal(explainElement({ branch: 'air', kind: 'tab', label: 'Невідома вкладка' }).status, 'unknown');
  assert.equal(explainElement({ branch: 'rocket', kind: 'tab', label: 'Пуски' }).id, 'view-tab');
});

test('об’єднана картка РВ розпізнається і з переносом, і без нього', () => {
  for (const label of ['ПОШКОДЖЕНО\nПОДАВЛЕНО', 'ПОШКОДЖЕНОПОДАВЛЕНО', 'Пошкоджено, подавлено']) {
    assert.equal(explainElement({ branch: 'rocket', kind: 'kpi', label }).id, 'part', label);
  }
});

// ---- Дашборд УДШВ (гілка dshv) ----
const udshv = d => explainElement({ branch: 'dshv', scope: '', label: '', value: '', hint: '', panelTitle: '', ...d });

test('УДШВ: усі частини дашборда мають пояснення з джерелами', () => {
  const cases = [
    { part: 'kpi', kind: 'kpi', label: '200' },
    { part: 'kpi', kind: 'kpi', label: 'Втрати о/с разом' },
    { part: 'spark', kind: 'kpi', label: '300' },
    { part: 'delta', kind: 'delta', label: '200' },
    { part: 'nav', kind: 'tab', label: 'Підрозділи' },
    { part: 'nav', kind: 'tab', label: 'Зведення УДШВ' },
    { part: 'ovt-tab', kind: 'control', label: 'ЗНИЩЕНО' },
    { part: 'period', kind: 'control', label: 'Тиждень' },
    { part: 'period', kind: 'control', label: 'Попередній' },
    { part: 'period-field', kind: 'control', label: 'Місяць' },
    { part: 'period-field', kind: 'control', label: 'Початок періоду' },
    { part: 'unit-filter', kind: 'control', label: 'Усі підрозділи' },
    { part: 'unit-filter', kind: 'control', label: 'Підрозділ' },
    { part: 'fresh-hint', kind: 'control', value: '2 підрозділи без свіжих даних' },
    { part: 'context', kind: 'other', label: '12 з 30 днів із даними' },
    { part: 'button', kind: 'control', label: 'Презентація' },
    { part: 'button', kind: 'control', label: 'Оновити з файлу' },
    { part: 'button', kind: 'control', label: 'Вивантажити CSV' },
    { part: 'sort', kind: 'control', label: 'о/с' },
    { part: 'cell', kind: 'cell', label: 'ВгЗ', value: '4' },
    { part: 'total', kind: 'cell', label: 'Підрозділ', value: 'Разом' },
    { part: 'rank-row', kind: 'row', label: '1 ДШБ', value: '12', panelTitle: 'Підрозділи за втратами о/с' },
    { part: 'heat', kind: 'cell', label: 'танк', panelTitle: 'ЗНИЩЕНО: підрозділ × тип' },
    { part: 'weekday', kind: 'row', label: 'Пн', value: '5' },
    { part: 'issue', kind: 'other', label: 'Від’ємне значення' },
    { part: 'fresh-cell', kind: 'cell', label: 'Стан', value: 'Актуально' },
    { part: 'sheets-cell', kind: 'cell', label: 'Аркуш', value: 'Травень 2026' },
    { part: 'title', kind: 'other', label: 'Дашборд УДШВ' },
    { part: 'pivot', kind: 'cell', label: 'Витрата БК' },
    { part: 'layout', kind: 'other', label: 'hero' },
    { part: 'layout', kind: 'other', label: 'period-bar' },
    { part: 'layout', kind: 'other', label: 'page' },
  ];
  for (const item of cases) {
    const result = udshv(item);
    assert.equal(result.status, 'found', `${item.part}/${item.label}`);
    assert.ok(result.title && result.what, `${item.part}/${item.label}: порожній заголовок чи опис`);
    assert.ok(Array.isArray(result.sources) && result.sources.length, `${item.part}/${item.label}: немає джерел`);
  }
});

test('УДШВ: вкладка «Наші втрати» пояснює власні колонки й картки', () => {
  for (const label of ['500', 'Дата', 'Арт. знищено', 'Арт. пошкоджено', 'Вийшли з ладу', 'Дія противника', 'Подій', 'Разом о/с']) {
    assert.equal(udshv({ scope: 'own', part: 'cell', kind: 'cell', label }).status, 'found', label);
  }
  assert.equal(udshv({ scope: 'own', part: 'kpi', kind: 'kpi', label: '500' }).status, 'found');
  for (const label of ['Замінити файл', 'Прибрати', 'Показати ще']) {
    assert.equal(udshv({ scope: 'own', part: 'button', kind: 'control', label }).status, 'found', label);
  }
  for (const title of ['Наші втрати', 'Втрати о/с', 'Підрозділи', 'Журнал подій', 'Арт. системи: знищені']) {
    assert.equal(udshv({ scope: 'own', kind: 'panel', panelTitle: title, label: title }).status, 'found', title);
  }
});

test('УДШВ: кожен розділ дашборда пояснюється за заголовком', () => {
  for (const title of ['Втрати о/с противника', 'ОВТ: знищено / пошкоджено / подавлено', 'Підрозділи за втратами о/с', 'Знищено ОВТ — топ', 'Втрати за категоріями', 'Підрозділи', 'Динаміка 200 / 300', 'Підрозділи: 200 і 300', 'За днями тижня', 'ЗНИЩЕНО: типи ОВТ', 'Динаміка', 'Витрата БК: підрозділ × тип', 'Витрата за типами боєприпасів', 'Зведена таблиця за період', 'Актуальність підрозділів', 'Аркуші', 'Перевірка даних']) {
    const result = udshv({ kind: 'panel', panelTitle: title, label: title });
    assert.equal(result.status, 'found', title);
  }
});

test('УДШВ: невідомий елемент чесно позначено як відсутній у довідці', () => {
  const result = udshv({ part: 'cell', kind: 'cell', label: 'Вигаданий показник', value: '1' });
  assert.equal(result.status, 'unknown');
  assert.equal(result.what, EXPLAIN_UNKNOWN.what ?? result.what);
  assert.deepEqual(result.sources, []);
});

test('УДШВ: джерела посилаються на розділи довідки, що існують', () => {
  const headings = new Set([...reference.matchAll(/^#{2,3}\s+(.+?)\s*$/gmu)].map(match => match[1]));
  const result = udshv({ part: 'delta', kind: 'delta', label: '200' });
  for (const source of result.sources) assert.ok(headings.has(source.section), source.section);
});

// ---- Статичні посилання для пакета пропозиції (assistant-explain-refs-core.js) ----
const coreSource = name => readFileSync(new URL(`../src/assistant/${name}`, import.meta.url), 'utf8');

test('каталог посилань збігається з ідентифікаторами в ядрах пояснень', () => {
  const used = new Set();
  for (const match of coreSource('assistant-explain-core.js').matchAll(/\bid:\s*'([a-z-]+)'/gu)) used.add(match[1]);
  const udshv = coreSource('assistant-explain-udshv-core.js');
  for (const match of udshv.matchAll(/\bok\('([a-z-]+)'/gu)) used.add(match[1]);
  for (const match of udshv.matchAll(/\bid:\s*'([a-z-]+)'/gu)) used.add(match[1]);
  // Ідентифікатори з шаблонних рядків: `kpi-${d.part}` (kpi, spark) і `column-${d.part}` (sort, cell, total).
  assert.ok(/ok\(`kpi-\$\{d\.part\}`/u.test(udshv) && /ok\(`column-\$\{d\.part\}`/u.test(udshv));
  for (const id of ['kpi-kpi', 'kpi-spark', 'column-sort', 'column-cell', 'column-total']) used.add(id);
  assert.ok(used.size >= 40, `знайдено лише ${used.size} ідентифікаторів`);
  const catalog = new Set(Object.keys(EXPLAIN_REFS));
  for (const id of used) assert.ok(catalog.has(id), `в каталозі немає назви для «${id}»`);
  for (const id of catalog) if (id !== EXPLAIN_REF_NONE) assert.ok(used.has(id), `«${id}» є в каталозі, але ядра його не повертають`);
});

test('кожен результат має посилання з каталогу, а не з тексту екрана', () => {
  const sentinel = '99 омбр Синтетична';
  const descriptors = [
    { branch: 'air', kind: 'kpi', label: 'Вильоти', value: '128' }, { branch: 'rocket', kind: 'kpi', label: 'ЗНИЩЕНО' },
    { branch: 'rocket', kind: 'kpi', label: 'ПОШКОДЖЕНО\nПОДАВЛЕНО' }, { branch: 'air', kind: 'kpi', label: 'Не уражено' },
    { branch: 'air', kind: 'kpi', label: 'Не відомо' }, { branch: 'air', kind: 'kpi', label: 'Ефективність' },
    { branch: 'air', kind: 'delta', hint: 'Зміна ефективності' }, { branch: 'rocket', kind: 'tab', label: 'Пуски' },
    { branch: 'air', kind: 'control', label: 'Тип ЛА', group: 'Розріз даних' }, { branch: 'air', kind: 'other', panelTitle: 'Час доби' },
    { branch: 'air', kind: 'other', label: 'Щось нове' }, { branch: 'pvk', kind: 'kpi', label: 'Вильоти' }, {},
    { branch: 'dshv', part: 'kpi', kind: 'kpi', label: '200' }, { branch: 'dshv', part: 'rank-row', kind: 'row', label: sentinel, panelTitle: 'Підрозділи за втратами о/с' },
    { branch: 'dshv', part: 'unit-filter', kind: 'control', label: sentinel }, { branch: 'dshv', part: 'issue', kind: 'other', label: 'Від’ємне значення' },
    { branch: 'dshv', kind: 'panel', panelTitle: 'Аркуші', label: 'Аркуші' }, { branch: 'dshv', part: 'layout', kind: 'other', label: 'hero' },
  ];
  for (const descriptor of descriptors) {
    const result = explainElement(descriptor);
    assert.deepEqual(Object.keys(result.ref).sort(), ['id', 'title']);
    assert.equal(result.ref.title, EXPLAIN_REFS[result.ref.id], JSON.stringify(descriptor));
    assert.ok(!JSON.stringify(result.ref).includes(sentinel));
    if (result.status === 'found') assert.equal(result.ref.id, result.id, JSON.stringify(descriptor));
    else assert.equal(result.ref.id, EXPLAIN_REF_NONE, JSON.stringify(descriptor));
  }
});

test('посилання береться тільки з id і статусу результату', () => {
  assert.equal(explainRef({ status: 'found', id: 'panel', title: '99 омбр Синтетична' }).title, EXPLAIN_REFS.panel);
  for (const result of [null, undefined, {}, { status: 'unknown', id: 'panel' }, { status: 'found', id: '99 омбр Синтетична' }, { status: 'found', id: '__proto__' }, { status: 'found', id: 'constructor' }, { status: 'found', id: 7 }]) {
    assert.equal(explainRef(result).id, EXPLAIN_REF_NONE, JSON.stringify(result));
  }
  assert.equal(explainRefTitle('toString'), '');
  assert.ok(Object.isFrozen(EXPLAIN_REFS) && Object.isFrozen(explainRef(null)));
});
