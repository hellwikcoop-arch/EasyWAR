// Чотири дашборди (ПС, РВ, ПВК, УДШВ): кожен відкриває лише таблицю свого виду.
// Модулі «Повітряні Сили» і РВ не показують дашборди ПВК та УДШВ, навіть якщо в їхньому слоті
// опинилася таблиця іншого виду (старі прив'язки, перетягування файлу, «останній файл» браузера).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

/** Дістає чисту функцію wrongKindMessage зі сторінки модуля й виконує її ізольовано. */
function gateOf(html, label) {
  const match = html.match(/function wrongKindMessage\(command, kind\) \{[\s\S]*?\n\}\n/);
  assert.ok(match, `${label}: функція wrongKindMessage має бути в сторінці`);
  return vm.runInNewContext(`${match[0]}; wrongKindMessage`);
}

test('ПС: звичайна таблиця відкривається, таблиця ПВК лише у вікні Повітряного командування', async () => {
  const gate = gateOf(await read('air.html'), 'air.html');
  assert.equal(gate(undefined, 'std'), '', 'ПС ← таблиця ПС');
  assert.equal(gate('', 'std'), '');
  assert.match(gate(undefined, 'pvk'), /Це таблиця ПВК: її відкриває плитка «Повітряне командування»/, 'ПС ← таблиця ПВК відхиляється');
  assert.equal(gate('pvk', 'pvk'), '', 'ПВК ← таблиця ПВК');
  assert.match(gate('pvk', 'std'), /Це не таблиця ПВК/, 'ПВК ← таблиця ПС відхиляється');
});

test('РВ: звичайна таблиця відкривається, таблиця УДШВ лише у вікні Командування ДШВ', async () => {
  const gate = gateOf(await read('rocket.html'), 'rocket.html');
  assert.equal(gate(undefined, 'std'), '', 'РВ ← таблиця РВ');
  assert.equal(gate('', 'std'), '');
  assert.match(gate(undefined, 'udshv'), /Це таблиця УДШВ: її відкриває плитка «Командування ДШВ»/, 'РВ ← таблиця УДШВ відхиляється');
  assert.equal(gate('dshv', 'udshv'), '', 'УДШВ ← таблиця УДШВ');
  assert.match(gate('dshv', 'std'), /Це не таблиця УДШВ/, 'УДШВ ← таблиця РВ відхиляється');
});

test('connect() обох модулів перевіряє вид таблиці за режимом вікна і повідомляє про відхилення', async () => {
  const air = await read('air.html');
  assert.match(air, /const wrongKind = wrongKindMessage\(document\.documentElement\.dataset\.command, wb\.kind\);\s*\n\s*if \(wrongKind\) throw Object\.assign\(new Error\(wrongKind\), \{ wrongKind: true \}\);/);
  assert.match(air, /return e && e\.wrongKind \? 'wrong-kind' : false;/);
  const rocket = await read('rocket.html');
  assert.match(rocket, /wrongKindMessage\(document\.documentElement\.dataset\.command, 'std'\)/);
  assert.match(rocket, /wrongKindMessage\(document\.documentElement\.dataset\.command, 'udshv'\)/);
  assert.match(rocket, /return e && e\.wrongKind \? 'wrong-kind' : false;/);
  // Дашборд УДШВ показується лише після перевірки виду.
  assert.ok(rocket.indexOf("wrongKindMessage(document.documentElement.dataset.command, 'udshv')") < rocket.indexOf('showUdshv(ud, u8, name, handle);'));
});

test('таблиця чужого виду не запам\'ятовується як «останній файл» модуля, а старий запис забувається', async () => {
  for (const name of ['air.html', 'rocket.html']) {
    const html = await read(name);
    assert.match(html, /if \(opened === 'wrong-kind'\) return;/, `${name}: вибір файлу`);
    assert.match(html, /if \(perm === 'granted' && opened !== 'wrong-kind'\) idbSet\(HANDLE_KEY, fh\)/, `${name}: перетягування файлу`);
    assert.match(html, /if \(opened === 'wrong-kind'\) \{ S\.storedHandle = null; idbSet\(HANDLE_KEY, null\)/, `${name}: відновлення останнього файлу`);
  }
});

test('лончер відкриває кожен вид у власному вікні: ПС і РВ без режиму командування, ПВК і УДШВ з ним', async () => {
  const html = await read('index.html');
  const sources = html.match(/const MODULE_SRC = (\{[^}]+\});/);
  assert.ok(sources, 'MODULE_SRC');
  const map = vm.runInNewContext(`(${sources[1].replace(/(\w+):'/g, '"$1":\'')})`);
  assert.deepEqual({ ...map }, { air: './air.html', rocket: './rocket.html', artillery: './artillery.html', pvk: './air.html?command=pvk', dshv: './rocket.html?command=dshv', custom: './custom.html' });
  assert.equal(new Set(Object.values(map)).size, 6, 'шість різних адрес');
  for (const branch of ['air', 'rocket', 'artillery', 'pvk', 'dshv', 'custom']) assert.match(html, new RegExp(`id="frame-${branch}"`), `frame-${branch}`);
  assert.match(html, /branch-card" data-branch="air"/);
  assert.match(html, /branch-card" data-branch="rocket"/);
  assert.match(html, /command-tile" data-command="pvk"/);
  assert.match(html, /command-tile" data-command="dshv"/);
});

test('автозавантаження таблиці профілю показує в лончері причину відмови модуля', async () => {
  const js = await read('local-profiles.js');
  assert.match(js, /frame\?\.document\?\.getElementById\('error'\)/);
  assert.match(js, /Модуль не відкрив таблицю профілю «\$\{name\}»: \$\{reason\}/);
});
