import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

// ui-kit.js — класичний скрипт; запускаємо його з мінімальними заглушками DOM і беремо window.EWDate.
function loadDate() {
  const root = { classList: { add() {}, remove() {} }, getAttribute: () => 'off', setAttribute() {}, removeAttribute() {} };
  const window = {};
  class HTMLInputElement {}
  Object.defineProperty(HTMLInputElement.prototype, 'value', { get() { return ''; }, set() {}, configurable: true });
  const document = { documentElement: root, readyState: 'loading', addEventListener() {}, getElementById: () => null };
  vm.runInNewContext(read('public/ui-kit.js'), { window, document, HTMLInputElement, setTimeout });
  return window.EWDate;
}

test('ISO date is shown as дд.мм.рррр', () => {
  const { toUk } = loadDate();
  assert.equal(toUk('2026-10-05'), '05.10.2026');
  assert.equal(toUk(''), '');
  assert.equal(toUk('2026-10'), '');
  assert.equal(toUk(undefined), '');
});

test('typed date is parsed back to ISO, invalid input is rejected', () => {
  const { fromUk } = loadDate();
  assert.equal(fromUk('05.10.2026'), '2026-10-05');
  assert.equal(fromUk(' 5.10.26 '), '2026-10-05');
  assert.equal(fromUk('5/10/2026'), '2026-10-05');
  assert.equal(fromUk('05102026'), '2026-10-05');
  assert.equal(fromUk('2026-10-05'), '2026-10-05');
  assert.equal(fromUk('29.02.2024'), '2024-02-29');
  assert.equal(fromUk(''), '');
  assert.equal(fromUk('31.02.2026'), null);
  assert.equal(fromUk('13.13.2026'), null);
  assert.equal(fromUk('10.2026'), null);
  assert.equal(fromUk('завтра'), null);
});

test('date fields keep the native input and add the overlay styles', () => {
  const js = read('public/ui-kit.js');
  assert.match(js, /input\[type="date"\]:not\(\.ew-date-n\)/);
  assert.match(js, /fire\(n, 'change'\)/, 'зміна з тексту доходить до обробників на input[type=date]');
  const css = read('ui-kit.css');
  assert.match(css, /\.ew-date > \.ew-date-n::-webkit-datetime-edit \{ opacity: 0; \}/);
  assert.match(css, /\.ew-date > \.ew-date-t \{ position: absolute;/);
});
