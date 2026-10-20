import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('ui-kit loads the module tech layer only outside the phone files', () => {
  const js = read('public/ui-kit.js');
  assert.match(js, /location\.protocol !== 'file:'/);
  assert.match(js, /tech\.href = '\.\/module-tech\.css'/);
});

test('module tech layer is decoration only and respects motion settings', () => {
  const css = read('public/module-tech.css');
  assert.match(css, /\.dpanel\.empty-state/, 'порожній екран ПС і РВ');
  assert.match(css, /\.panel\.welcome/, 'порожній екран артилерії');
  assert.match(css, /\.dpanel > \.ph > h2/, 'заголовки секцій');
  assert.match(css, /pointer-events: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /html\[data-motion="off"\]/);
  assert.doesNotMatch(css, /\.panel\.welcome\)?::after/, '::after вітальної панелі артилерії зайнятий її зображенням');
  assert.doesNotMatch(css, /url\(\s*["']?https?:/, 'без мережевих ресурсів');
});
