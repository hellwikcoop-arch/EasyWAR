// Довільне внесення: що саме змінено в legacy-сторінках air.html / rocket.html і як із ними стикується форма.
// Сторінки не переписуються: у кожній — одна рядкова правка addSelected (необов'язковий другий параметр) і один тег <script>.
// Дані в тестах лише синтетичні.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, ROOT), 'utf8');
const PAGES = ['air', 'rocket'];
const MODULE_TAG = '<script type="module" src="./manual-entry.js"></script>';

const occurrences = (text, part) => text.split(part).length - 1;

for (const page of PAGES) {
  test(`${page}.html: модуль довільного внесення підключено один раз, усі inline-скрипти розбираються`, () => {
    const html = read(`src/${page}.html`);
    assert.equal(occurrences(html, MODULE_TAG), 1);
    // Модуль лежить після скриптів сторінки: window.__AV і AVCORE на цей час уже є.
    assert.ok(html.indexOf(MODULE_TAG) > html.indexOf('window.__AV = {'));

    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([^]*?)<\/script>/g)].filter(match => !/type="module"/.test(match[1]));
    assert.ok(scripts.length >= 3, 'inline-скрипти знайдено');
    scripts.forEach((match, index) => assert.doesNotThrow(() => new vm.Script(match[2], { filename: `${page}#${index + 1}` }), `${page}: inline-скрипт ${index + 1}`));
  });

  test(`${page}.html: сторінка віддає модулю addSelected, AVCORE і потрібні елементи вкладки`, () => {
    const html = read(`src/${page}.html`);
    assert.match(html, /window\.__AV = \{[^}]*\baddSelected\b[^}]*\bshowError\b/);
    assert.match(html, /root\.AVCORE = |window\.AVCORE = |AVCORE = api/);
    for (const id of ['view-entry', 'paste', 'resultsPanel', 'results', 'addBtn', 'sessionWrap', 'undoBtn']) {
      assert.ok(html.includes(`id="${id}"`), `${page}: немає #${id}`);
    }
    // Підзаголовок вкладки, який модуль підміняє в довільному внесенні.
    assert.match(html, /<main id="view-entry"[^>]*>\s*<header class="top">\s*<h1>[^<]*<\/h1>\s*<p class="lede">/);
  });
}

/* ---------------- addSelected(fromAuto, explicit): те, що змінено на сторінках ---------------- */

function extractAddSelected(html) {
  const start = html.indexOf('async function addSelected(fromAuto, explicit) {');
  assert.ok(start > 0, 'addSelected має приймати необов’язковий explicit');
  const end = html.indexOf('\n}\n', start);
  return html.slice(start, end + 3);
}

// Справжній текст addSelected зі сторінки, але з підставленими заглушками (файл, DOM і ядро не потрібні).
function harness(html, { signalReview = null, kind = 'standard' } = {}) {
  const calls = { appended: null, errors: [], toasts: [], focus: 0, renderResults: 0, renderAll: 0 };
  const paste = { value: 'текст звіту', focus() { calls.focus += 1; } };
  const S = {
    wb: { kind }, parsed: [{ include: true, id: 'parsed-1' }, { include: false, id: 'parsed-2' }], undo: [], session: [],
    bytes: new Uint8Array([1]), handle: null, dirty: false, busy: false, signalReview, editedAt: null,
  };
  const C = {
    toRow: record => ({ ...record }),
    appendRows: async (base, rows) => { calls.appended = rows; return { bytes: new Uint8Array([2]), nums: rows.map((row, index) => 100 + index) }; },
    openWorkbook: async () => ({ kind }),
  };
  const factory = new Function('S', 'C', '$', 'showError', 'renderResults', 'renderAll', 'toast', 'plural', 'explainWriteError',
    `${extractAddSelected(html)}\nreturn addSelected;`);
  const addSelected = factory(
    S, C, selector => (selector === '#paste' ? paste : null),
    message => calls.errors.push(message), () => { calls.renderResults += 1; }, () => { calls.renderAll += 1; },
    (message, tone) => calls.toasts.push([message, tone]), (n, forms) => forms[0], error => String(error));
  return { S, calls, paste, addSelected };
}

for (const page of PAGES) {
  const html = read(`src/${page}.html`);

  test(`${page}: addSelected без explicit працює як раніше — додає відмічені записи звіту й очищає поле`, async () => {
    const { S, calls, paste, addSelected } = harness(html);
    await addSelected(false);
    assert.deepEqual(calls.appended.map(row => row.id), ['parsed-1']);
    assert.equal(paste.value, '');
    assert.deepEqual(S.parsed, []);
    assert.equal(calls.focus, 1);
    assert.equal(S.undo.length, 1);
    assert.match(calls.toasts[0][0], /^Додано: 1 запис, №100/);
  });

  test(`${page}: addSelected з explicit додає саме ці записи, не чіпає розібраний звіт, текст і фокус`, async () => {
    const { S, calls, paste, addSelected } = harness(html);
    await addSelected(false, [{ id: 'manual' }]);
    assert.deepEqual(calls.appended.map(row => row.id), ['manual']);
    assert.equal(paste.value, 'текст звіту');
    assert.deepEqual(S.parsed.map(r => r.id), ['parsed-1', 'parsed-2']);
    assert.equal(calls.focus, 0);
    assert.equal(S.undo.length, 1);
    assert.deepEqual(S.session[0].rec, [{ id: 'manual' }]);
    assert.deepEqual(S.session[0].nums, [100]);
    assert.match(calls.toasts[0][0], /^Додано: 1 запис, №100/);
    assert.equal(calls.renderAll, 1);
  });

  test(`${page}: порожній explicit не підміняється розібраним звітом, а зайнята сторінка нічого не додає`, async () => {
    const empty = harness(html);
    await empty.addSelected(false, []);
    assert.equal(empty.calls.appended, null);
    assert.equal(empty.S.undo.length, 0);
    assert.equal(empty.S.parsed.length, 2);

    const busy = harness(html);
    busy.S.busy = true;
    await busy.addSelected(false, [{ id: 'manual' }]);
    assert.equal(busy.calls.appended, null);
    assert.equal(busy.S.undo.length, 0);
  });

  test(`${page}: addSelected оголошує два параметри — за цим модуль знає, що сторінка підтримує довільне внесення`, () => {
    assert.equal(harness(html).addSelected.length, 2);
    assert.match(read('src/manual-entry.js'), /AV\.addSelected\.length >= 2/);
  });
}

test('ПС: у режимі перегляду Signal і для таблиці ПВК довільний запис не додається', async () => {
  const html = read('src/air.html');
  const review = harness(html, { signalReview: { reportId: 'r1' } });
  await review.addSelected(false, [{ id: 'manual' }]);
  assert.equal(review.calls.appended, null);
  assert.equal(review.S.undo.length, 0);

  const pvk = harness(html, { kind: 'pvk' });
  await pvk.addSelected(false, [{ id: 'manual' }]);
  assert.equal(pvk.calls.appended, null);
  assert.equal(pvk.calls.errors.length, 1);
  assert.match(pvk.calls.errors[0], /ПВК/);
});

/* ---------------- модуль форми й стилі ---------------- */

test('модуль форми: шлях запису, перехоплення Ctrl+Enter і підміна підзаголовка', () => {
  const source = read('src/manual-entry.js');
  assert.match(source, /import '\.\/manual-entry\.css';/);
  assert.match(source, /import \* as ME from '\.\/manual-entry-core\.js';/);
  // Запис іде через сторінку (addSelected), а не напряму у файл.
  assert.match(source, /AV\.addSelected\(false, \[a\.record\]\)/);
  // Ctrl+Enter перехоплюється до обробника сторінки (фаза занурення на window), інакше він додав би розібраний звіт.
  assert.match(source, /window\.addEventListener\('keydown'[^]*?\}, true\);/);
  assert.match(source, /event\.stopPropagation\(\)/);
  // Натискання кнопки не забирає фокус із поля: інакше після blur-зауваження форма зсувається і клік по «Додати» губиться.
  assert.match(source, /panel\.addEventListener\('mousedown'[^]*?closest\('button, \.switch'\)[^]*?preventDefault\(\)/);
  // Чернетка не зберігається: у localStorage лише вибраний спосіб внесення.
  assert.equal(occurrences(source, 'localStorage.setItem'), 1);
  assert.match(source, /localStorage\.setItem\(MODE_KEY, manual \? 'manual' : 'report'\)/);
  // Нічого не надсилається й не підвантажується ззовні.
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|https?:\/\//);
});

test('стилі форми використовують лише змінні, які визначені в обох сторінках', () => {
  const css = read('src/manual-entry.css');
  const used = [...new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map(match => match[1]))];
  assert.ok(used.length >= 8);
  for (const page of PAGES) {
    const html = read(`src/${page}.html`);
    const defined = new Set([...html.matchAll(/--([a-z0-9-]+)\s*:/g)].map(match => match[1]));
    for (const name of used) assert.ok(defined.has(name), `${page}: немає змінної --${name}`);
  }
  // Стилі не залежать від зовнішніх ресурсів.
  assert.doesNotMatch(css, /url\(|@import/);
});
