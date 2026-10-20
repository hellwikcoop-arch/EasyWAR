// Бібліотека «Офісу» (src/workspace/library-core.js): редактор і вид за розширенням, підписи,
// розміри й дати, помилка блокування, перевірка назви, сортування й пошук, план «Оновити всі».
// Лише синтетичні дані.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KIND_LABELS, LOCKED_ERROR_PREFIX, MAX_ITEM_NAME_CHARS, ORIGIN_LABELS, STATUS_LABELS, appForExt, filterItems, formatDateTime,
  formatSize, isLockedError, kindForExt, regenerationPlan, shouldMakeCurrent, sortItems, summarizeBulk, validateItemName,
} from '../src/workspace/library-core.js';

test('редактор і вид документа за розширенням', () => {
  assert.deepEqual(['xlsx', 'CSV', '.docx', 'txt', 'pptx', 'pdf', '', null, 'constructor'].map(appForExt),
    ['easygreen', 'easygreen', 'easydoc', 'easydoc', 'easyslide', null, null, null, null]);
  assert.deepEqual(['xlsx', 'csv', 'docx', 'txt', 'pptx', 'odt'].map(ext => kindForExt(ext)),
    ['table', 'table', 'document', 'document', 'slides', null]);
  assert.deepEqual(['xlsx', 'csv', 'docx', 'txt', 'pptx'].map(ext => kindForExt(ext, true)),
    ['template', 'table', 'template', 'document', 'template']);
});

test('підписи видів, походження версій і статусів зв\'язку', () => {
  assert.deepEqual(KIND_LABELS, { table: 'Таблиця', document: 'Документ', slides: 'Презентація', template: 'Шаблон' });
  assert.deepEqual(ORIGIN_LABELS, { imported: 'Імпортовано', generated: 'Згенеровано з шаблону', edited: 'Ручні правки', saved: 'Збережено' });
  assert.deepEqual(STATUS_LABELS, {
    current: 'Актуальний',
    source_changed: 'Джерело змінилося',
    edited: 'Ручні правки',
    edited_stale: 'Ручні правки на застарілих даних',
    detached: 'Поточна версія не з джерела',
    source_error: 'Джерело недоступне',
  });
  assert.ok([KIND_LABELS, ORIGIN_LABELS, STATUS_LABELS].every(Object.isFrozen));
});

test('розмір файлу українською', () => {
  assert.equal(formatSize(0), '0 Б');
  assert.equal(formatSize(512), '512 Б');
  assert.equal(formatSize(1536), '1,5 КБ');
  assert.equal(formatSize(10 * 1024), '10 КБ');
  assert.equal(formatSize(1024 * 1024 - 1), '1 МБ');
  assert.equal(formatSize(12.3 * 1024 * 1024), '12 МБ');
  assert.equal(formatSize(256 * 1024 * 1024), '256 МБ');
  assert.equal(formatSize(3 * 1024 ** 3), '3 ГБ');
  assert.equal(formatSize(-1), '—');
  assert.equal(formatSize(null), '—');
  assert.equal(formatSize('x'), '—');
});

test('дата й час: як записано в рядку або з явним зсувом, незалежно від поясу пристрою', () => {
  assert.equal(formatDateTime('2026-10-20T08:05:09.123456789Z'), '20.10.2026 08:05');
  assert.equal(formatDateTime('2026-10-20T08:05:09+03:00'), '20.10.2026 08:05');
  assert.equal(formatDateTime('2026-10-20T22:30:00Z', { offsetMinutes: 180 }), '21.10.2026 01:30');
  assert.equal(formatDateTime('2026-10-20T08:05:00+03:00', { offsetMinutes: 0 }), '20.10.2026 05:05');
  assert.equal(formatDateTime('2026-03-01T00:10:00-0130', { offsetMinutes: 120 }), '01.03.2026 03:40');
  assert.equal(formatDateTime('2026-10-20T08:05:00', { offsetMinutes: 180 }), '20.10.2026 08:05');
  assert.equal(formatDateTime('2026-10-20'), '20.10.2026');
  assert.equal(formatDateTime(''), '—');
  assert.equal(formatDateTime(null), '—');
  assert.equal(formatDateTime('вчора'), '—');
});

test('помилка заблокованої бібліотеки: рядок з invoke або Error', () => {
  const message = 'бібліотека заблокована: розблокуйте її паролем профілю';
  assert.ok(message.startsWith(LOCKED_ERROR_PREFIX));
  assert.equal(isLockedError(message), true);
  assert.equal(isLockedError(new Error(message)), true);
  assert.equal(isLockedError({ message: ` ${message}` }), true);
  assert.equal(isLockedError('Бібліотека заблокована'), true);
  assert.equal(isLockedError('спершу закрийте вікно редактора'), false);
  assert.equal(isLockedError('інша помилка: бібліотека заблокована'), false);
  assert.equal(isLockedError(null), false);
  assert.equal(isLockedError({ message: 42 }), false);
});

test('назва документа: пробіли стиснуто, 1..120 символів, без керівних', () => {
  assert.deepEqual(validateItemName('  Звіт \n за   жовтень\t'), { ok: true, name: 'Звіт за жовтень', error: null });
  assert.deepEqual(validateItemName('   '), { ok: false, name: '', error: 'Вкажіть назву документа.' });
  assert.equal(validateItemName(undefined).ok, false);
  assert.deepEqual(validateItemName('Звіт\u0007'), { ok: false, name: 'Звіт\u0007', error: 'Назва містить керівні символи.' });
  assert.equal(validateItemName('звіт‮тxt.exe').ok, false);
  assert.equal(validateItemName('я'.repeat(MAX_ITEM_NAME_CHARS)).ok, true);
  // Символи поза базовою площиною рахуються як один.
  assert.equal(validateItemName('😀'.repeat(MAX_ITEM_NAME_CHARS)).ok, true);
  assert.deepEqual(validateItemName('я'.repeat(MAX_ITEM_NAME_CHARS + 1)), {
    ok: false, name: 'я'.repeat(MAX_ITEM_NAME_CHARS + 1), error: 'Назва задовга: не більше 120 символів (зараз 121).',
  });
});

const ITEMS = [
  { id: 'doc-3', name: 'Звіт 10' },
  { id: 'doc-1', name: 'звіт 2' },
  { id: 'doc-2', name: 'Аналіз' },
  { id: 'doc-5', name: 'Їжак' },
  { id: 'doc-4', name: 'Іменний список' },
  { id: 'doc-6', name: 'Ґанок' },
  { id: 'doc-7', name: 'Аналіз' },
  { id: 'doc-8', name: "Пам'ятка" },
];

test('сортування за назвою: українська абетка, без регістру, числа за значенням', () => {
  const sorted = sortItems(ITEMS);
  assert.deepEqual(sorted.map(item => item.id), ['doc-2', 'doc-7', 'doc-6', 'doc-1', 'doc-3', 'doc-4', 'doc-5', 'doc-8']);
  assert.notEqual(sorted, ITEMS);
  assert.equal(ITEMS[0].id, 'doc-3');
  assert.deepEqual(sortItems(null), []);
});

test('пошук за назвою: усі слова, без регістру й різниці апострофів', () => {
  assert.deepEqual(filterItems(ITEMS, 'ЗВІТ').map(item => item.id), ['doc-3', 'doc-1']);
  assert.deepEqual(filterItems(ITEMS, '  звіт   10 ').map(item => item.id), ['doc-3']);
  assert.deepEqual(filterItems(ITEMS, 'пам’ят').map(item => item.id), ['doc-8']);
  assert.deepEqual(filterItems(ITEMS, 'ґан').map(item => item.id), ['doc-6']);
  assert.deepEqual(filterItems(ITEMS, 'немає').map(item => item.id), []);
  assert.equal(filterItems(ITEMS, '').length, ITEMS.length);
  assert.notEqual(filterItems(ITEMS, ''), ITEMS);
});

test('план «Оновити всі»: оновити змінені, пропустити ручні правки й недоступні джерела', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => ({ id, name: id }));
  const statuses = [
    { itemId: 'b', status: 'current', detail: null },
    { itemId: 'a', status: 'source_changed', detail: null },
    { itemId: 'c', status: 'edited', detail: null },
    { itemId: 'd', status: 'edited_stale', detail: null },
    { itemId: 'e', status: 'source_error', detail: 'модуль видалено' },
    { itemId: 'f', status: 'detached', detail: null },
    { itemId: 'g', status: 'source_changed', detail: null },
    { itemId: 'zzz', status: 'source_changed', detail: null },
  ];
  assert.deepEqual(regenerationPlan(items, statuses), {
    update: ['a', 'g'],
    skipped: [{ id: 'c', reason: 'edited' }, { id: 'd', reason: 'edited_stale' }, { id: 'e', reason: 'source_error' }, { id: 'f', reason: 'detached' }],
    upToDate: ['b'],
  });
  assert.deepEqual(regenerationPlan(null, null), { update: [], skipped: [], upToDate: [] });
});

test('нова згенерована версія стає поточною, лише коли поточна не має ручних правок', () => {
  assert.equal(shouldMakeCurrent('generated'), true);
  assert.equal(shouldMakeCurrent(null), true);
  assert.equal(shouldMakeCurrent(undefined), true);
  assert.equal(shouldMakeCurrent('edited'), false);
  assert.equal(shouldMakeCurrent('saved'), false);
  assert.equal(shouldMakeCurrent('imported'), false);
});

test('підсумок масового оновлення', () => {
  const results = [{ outcome: 'updated' }, { outcome: 'updated' }, { outcome: 'skipped' }, { outcome: 'error', error: 'збій' }, {}];
  assert.equal(summarizeBulk(results), 'Оновлено: 2; пропущено: 1; помилки: 1');
  assert.equal(summarizeBulk({ updated: ['a'], skipped: [{ id: 'b' }, { id: 'c' }], errors: 0 }), 'Оновлено: 1; пропущено: 2; помилки: 0');
  assert.equal(summarizeBulk(null), 'Оновлено: 0; пропущено: 0; помилки: 0');
});
